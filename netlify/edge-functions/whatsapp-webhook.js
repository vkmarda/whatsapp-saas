// WhatsApp Cloud API webhook — multi-tenant version of whatsapp-meta-layer's
// whatsapp-webhook.js. One URL serves every tenant: Meta includes
// phone_number_id in every payload, which is looked up against
// organizations.whatsapp_phone_number_id to resolve which tenant a message
// belongs to before anything else happens. Everything downstream (state,
// contacts, quotes, messages) is scoped by that tenant's org_id.
//
// The conversation flow itself (menu -> catalogue / quote / sales, and the
// quote flow's name/product/details/location/company+email steps) is kept
// generic — it's reusable B2B structure. What's NOT hardcoded here, unlike
// the single-tenant version: the welcome message, product list, catalog
// URL, and sales contact — those come from each org's bot_config (jsonb),
// with generic fallbacks if a tenant hasn't configured them yet.

import {
  getOrgByPhoneNumberId, getOrgByVerifyToken,
  getConversationState, saveConversationState, logMessage as logMessageSb,
  upsertContact, updateContact, getContactByPhone, updateMessageStatusByWamid,
  flagNeedsReview, clearNeedsReview, setConversationStatus, createQuote, uploadMedia,
} from './lib/supabase.js'
import { callGraphSend, fetchMediaBytes } from './lib/graph.js'
import { detectIntent } from './lib/intent.js'
import { detectCity } from './lib/cities.js'

// Applied wherever a tenant hasn't set bot_config yet, or only set some of
// it — merged in as fallbacks, not a requirement to configure everything
// before a tenant's number can receive messages at all.
const DEFAULT_BOT_CONFIG = {
  welcomeMessage: "Hi! Thanks for reaching out — how can we help you today?",
  products: [],       // empty = skip the product-picker list, ask as free text instead
  catalogUrl: null,   // null = skip the "send catalogue" step
  salesPhone: null,
  salesEmail: null,
  productKeywords: {}, // { "Product Name": ["keyword", "phrase", ...] } — see guessProduct
}

// Lets a brand-new contact's first message ("how much for garbage bags")
// skip the product-picker step entirely, the same shortcut UKEP's bot always
// had — generalized here from UKEP's hardcoded regex table into a per-tenant
// bot_config.productKeywords map so any tenant can opt into it. Keywords are
// plain phrases, not regex — escaped before matching so tenant-authored
// config can't inject regex syntax or cause catastrophic backtracking.
// First product (in object key order) whose keyword list matches wins.
function guessProduct(config, text) {
  if (!text) return null
  for (const [product, keywords] of Object.entries(config.productKeywords || {})) {
    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i')
      if (pattern.test(text)) return product
    }
  }
  return null
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default async (request) => {
  const url = new URL(request.url)
  console.log(`[whatsapp-webhook] ${request.method} ${url.pathname}${url.search}`)

  // Meta's one-time webhook verification handshake — happens once per Meta
  // App, before any message has ever been sent, so there's no
  // phone_number_id yet to resolve a tenant from. Match the incoming token
  // against every tenant's own verify token instead.
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token) {
      const org = await getOrgByVerifyToken(token).catch(() => null)
      if (org) return new Response(challenge, { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // Resolve tenant first — everything else depends on it. A payload for a
  // phone_number_id we don't recognize (never happens for a real configured
  // tenant, but cheap to guard) is accepted and dropped rather than erroring,
  // since Meta retries on non-2xx responses.
  const phoneNumberIdFromPayload = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id
  const org = phoneNumberIdFromPayload ? await getOrgByPhoneNumberId(phoneNumberIdFromPayload).catch(() => null) : null
  if (!org) {
    console.log(`[whatsapp-webhook] no organization found for phone_number_id=${phoneNumberIdFromPayload} — dropping`)
    return new Response('OK', { status: 200 })
  }
  const ctx = {
    orgId: org.id,
    phoneNumberId: phoneNumberIdFromPayload,
    accessToken: org.whatsapp_access_token,
    config: { ...DEFAULT_BOT_CONFIG, ...(org.bot_config || {}) },
  }

  // Delivery/read status callbacks (sent/delivered/read/failed) land in
  // value.statuses, not value.messages — handled here before extractIncoming
  // (which only looks at value.messages) so these don't fall through to the
  // "not a message" bail-out below and get silently dropped.
  const statusUpdate = body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]
  if (statusUpdate) {
    try {
      await updateMessageStatusByWamid(
        statusUpdate.id,
        statusUpdate.status,
        new Date(Number(statusUpdate.timestamp) * 1000).toISOString(),
        statusUpdate.errors || null
      )
    } catch (err) {
      console.log(`[whatsapp-webhook] status update error: ${err.message}`)
    }
    return new Response('OK', { status: 200 })
  }

  const incoming = extractIncoming(body)
  if (!incoming) {
    return new Response('OK', { status: 200 }) // neither a message nor a status update
  }

  const { from, text, buttonId, listId, name, mediaId, mediaMimeType, isReaction } = incoming
  console.log(`[whatsapp-webhook] org=${ctx.orgId} from ${from} (${name}): text="${text}" buttonId="${buttonId}" listId="${listId}"`)

  // Only classify genuine free text — a button/list tap's "text" is just the
  // option's own label (e.g. "Request a Quote"), not something to interpret.
  const intent = (!buttonId && !listId) ? detectIntent(text) : null

  // A reaction is logged for context but never routed through the bot — no
  // one wants a 👍 to reopen their conversation or re-send the main menu.
  if (isReaction) {
    await logIncomingMessage(ctx, from, text, name, intent, mediaId, mediaMimeType)
    return new Response('OK', { status: 200 })
  }

  // Background work that shouldn't block message sends — collected here and
  // all awaited together before we return, so nothing is silently dropped
  // even though it doesn't block the user-facing path.
  const bg = [logIncomingMessage(ctx, from, text, name, intent, mediaId, mediaMimeType)]
  const statePromise = getConversationState(ctx.orgId, from)

  try {
    const state = await statePromise
    console.log(`[whatsapp-webhook] state for ${from}: step=${state.step} intent=${intent}`)
    // A contact messaging back in after their thread was marked resolved
    // means it needs attention again — reopen it rather than leaving it
    // silently marked "done" while a new message sits in it.
    if (state.conversationStatus === 'resolved') {
      bg.push(setConversationStatus(ctx.orgId, from, 'open').catch(err =>
        console.log(`[whatsapp-webhook] reopen error: ${err.message}`)))
    }
    await handleIncoming(ctx, { from, text, buttonId, listId, name, state, bg, intent })
  } catch (err) {
    console.log(`[whatsapp-webhook] handler error: ${err.message}`)
  }

  await Promise.allSettled(bg)
  return new Response('OK', { status: 200 })
}

export const config = {
  path: '/whatsapp-webhook',
}

async function setState(ctx, phone, state, lastWelcomeAt) {
  try {
    await saveConversationState(ctx.orgId, phone, state.step, state.data, lastWelcomeAt)
  } catch (err) {
    console.log(`[whatsapp-webhook] setState error: ${err.message}`)
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

// Typing any of these always restarts the conversation from scratch, regardless
// of what step someone's on — clearing the chat on your phone doesn't touch our
// server-side state, so this is the only real "start over" users have.
const RESTART_WORDS = new Set(['hi', 'hello', 'hey', 'menu', 'start', 'restart', 'main menu'])

const DECLINE_BUTTON_TEXTS = new Set(['not right now', 'no thanks', 'not interested', 'maybe later'])
const DECLINE_REPLY = "No problem! We'll be here whenever you're ready — feel free to message us anytime. 🙂"

const FOLLOWUP_REPLY_BUTTON_TEXTS = new Set(["i'd like to proceed", 'i have a question'])

// Routes free text straight into the right flow when detectIntent is
// confident, instead of making the person wade through the menu they
// already didn't tap. Returns true if it routed (caller shouldn't also show
// the menu / flag for review), false if nothing matched.
async function tryRouteByIntent(ctx, from, intent, bg, name, text) {
  if (intent === 'purchase' || intent === 'pricing' || intent === 'product_need') {
    bg.push(clearNeedsReview(ctx.orgId, from).catch(err => console.log(`[whatsapp-webhook] clearNeedsReview error: ${err.message}`)))
    await startQuoteFlow(ctx, from, bg, { name, prefillText: text })
    return true
  }
  if (intent === 'sample') {
    bg.push(clearNeedsReview(ctx.orgId, from).catch(err => console.log(`[whatsapp-webhook] clearNeedsReview error: ${err.message}`)))
    await handleSalesRequest(ctx, from, bg)
    return true
  }
  if (intent === 'catalog') {
    bg.push(clearNeedsReview(ctx.orgId, from).catch(err => console.log(`[whatsapp-webhook] clearNeedsReview error: ${err.message}`)))
    await handleCatalogRequest(ctx, from, bg)
    return true
  }
  return false
}

// ── Main routing ────────────────────────────────────────────────────────────
async function handleIncoming(ctx, { from, text, buttonId, listId, name, state, bg, intent }) {
  if (buttonId && DECLINE_BUTTON_TEXTS.has(text.trim().toLowerCase())) {
    await sendText(ctx, from, DECLINE_REPLY, bg)
    bg.push(setConversationStatus(ctx.orgId, from, 'resolved').catch(err =>
      console.log(`[whatsapp-webhook] setConversationStatus error: ${err.message}`)))
    return
  }

  if (buttonId && FOLLOWUP_REPLY_BUTTON_TEXTS.has(text.trim().toLowerCase())) {
    bg.push(flagNeedsReview(ctx.orgId, from, 'quote_followup_reply').catch(err =>
      console.log(`[whatsapp-webhook] flagNeedsReview error: ${err.message}`)))
    return
  }

  // Top-level menu selections work from anywhere, so someone can bail out of
  // the quote flow (or reach sales from any step in it) without getting stuck.
  if (buttonId === 'menu_catalog') return handleCatalogRequest(ctx, from, bg)
  if (buttonId === 'menu_quote') return startQuoteFlow(ctx, from, bg, { name })
  if (buttonId === 'menu_sales' || listId === 'menu_sales') return handleSalesRequest(ctx, from, bg)
  if (buttonId === 'quote_cancel' || listId === 'quote_cancel') return handleCancelQuote(ctx, from, bg)
  if (buttonId === 'show_main_menu') return returnToMenu(ctx, from, bg)

  const isRestart = !buttonId && !listId && RESTART_WORDS.has(text.trim().toLowerCase())

  if (isRestart || state.step === 'new') {
    const sentRecently = state.lastWelcomeAt &&
      (Date.now() - new Date(state.lastWelcomeAt).getTime()) < ONE_DAY_MS

    if (state.step === 'new') {
      bg.push(upsertContact({ orgId: ctx.orgId, phone: from, name, source: 'whatsapp_inbound' }).catch(err =>
        console.log(`[whatsapp-webhook] upsertContact error: ${err.message}`)))
    }
    if (!sentRecently) await sendText(ctx, from, ctx.config.welcomeMessage, bg)

    const welcomeStampedAt = sentRecently ? state.lastWelcomeAt : new Date().toISOString()

    if (!isRestart && await tryRouteByIntent(ctx, from, intent, bg, name, text)) {
      return
    }

    await sendMainMenu(ctx, from, bg)
    await setState(ctx, from, { step: 'menu', data: {} }, welcomeStampedAt)
    return
  }

  // A team member replied manually from the dashboard — the bot stays quiet
  // for this contact (their message is still logged above) until they type
  // a restart word again, so it never talks over a human mid-conversation.
  if (state.step === 'human') {
    console.log(`[whatsapp-webhook] human takeover active for ${from} — bot standing down`)
    return
  }

  if (state.step.startsWith('quote_')) {
    return continueQuoteFlow(ctx, from, state, text, listId, bg)
  }

  // Anything else (e.g. free text while sitting at the menu) — try to route
  // by intent; if nothing matches confidently, flag for human review instead
  // of silently re-showing the same menu they already didn't respond to.
  if (await tryRouteByIntent(ctx, from, intent, bg, name, text)) return
  bg.push(flagNeedsReview(ctx.orgId, from, intent).catch(err => console.log(`[whatsapp-webhook] flagNeedsReview error: ${err.message}`)))
  await sendMainMenu(ctx, from, bg)
}

async function sendMainMenu(ctx, to, bg) {
  await sendButtons(ctx, to, 'How can we help you today?', [
    { id: 'menu_catalog', title: 'Product Catalogue' },
    { id: 'menu_quote', title: 'Request a Quote' },
    { id: 'menu_sales', title: 'Talk to Sales Team' },
  ], bg)
}

async function handleCatalogRequest(ctx, from, bg) {
  if (ctx.config.catalogUrl) {
    await sendDocument(ctx, from, ctx.config.catalogUrl, 'catalogue.pdf', 'Here is our product catalogue.', bg)
  } else {
    await sendText(ctx, from, "We don't have a digital catalogue set up just yet — let us know what you're looking for and we'll help directly.", bg)
  }
  await promptMainMenuButton(ctx, from, bg)
}

async function handleSalesRequest(ctx, from, bg) {
  const { salesPhone, salesEmail } = ctx.config
  if (salesPhone || salesEmail) {
    const lines = [
      salesPhone ? `📞 ${salesPhone}` : null,
      salesEmail ? `✉️ ${salesEmail}` : null,
    ].filter(Boolean).join('\n')
    await sendText(ctx, from, `You can reach our sales team directly:\n${lines}\n\nOr let us know here and our team will get back to you shortly.`, bg)
  } else {
    await sendText(ctx, from, "Let us know here and our team will get back to you shortly.", bg)
  }
  await promptMainMenuButton(ctx, from, bg)
}

async function handleCancelQuote(ctx, from, bg) {
  await sendText(ctx, from, 'No problem — thanks for stopping by! Reach out anytime you need us.', bg)
  await promptMainMenuWithSales(ctx, from, bg)
}

const MAIN_MENU_BUTTON = { id: 'show_main_menu', title: 'Main Menu' }

async function promptMainMenuButton(ctx, from, bg) {
  await sendButtons(ctx, from, 'Is there anything else I can help with?', [MAIN_MENU_BUTTON], bg)
  await setState(ctx, from, { step: 'idle', data: {} })
}

async function promptMainMenuWithSales(ctx, from, bg) {
  await sendButtons(ctx, from, 'Is there anything else I can help with?', [SALES_BUTTON, MAIN_MENU_BUTTON], bg)
  await setState(ctx, from, { step: 'idle', data: {} })
}

async function returnToMenu(ctx, from, bg) {
  await sendMainMenu(ctx, from, bg)
  await setState(ctx, from, { step: 'menu', data: {} })
}

// ── Quote flow ───────────────────────────────────────────────────────────
const SALES_BUTTON = { id: 'menu_sales', title: 'Talk to Sales Team' }
const SKIP_BUTTON = { id: 'skip', title: 'Skip' }
const CANCEL_BUTTON = { id: 'quote_cancel', title: 'Exit' }

// prefillText: the free-text message that routed someone into this flow
// (e.g. "how much for garbage bags") — lets guessProduct skip the whole
// product-picker step for anyone who already named what they want.
async function startQuoteFlow(ctx, from, bg, { name, prefillText } = {}) {
  const known = await getContactByPhone(ctx.orgId, from).catch(err => {
    console.log(`[whatsapp-webhook] getContactByPhone error: ${err.message}`)
    return null
  })
  const knownFields = {
    knownCompany: known?.company || '',
    knownEmail: known?.email || '',
    knownCity: known?.city || '',
  }

  if (!name) {
    await sendButtons(ctx, from, "Great! Let's get your quote started.\n\nWhat's your name?", [CANCEL_BUTTON], bg)
    await setState(ctx, from, { step: 'quote_name', data: { prefillText: prefillText || '', ...knownFields } })
    return
  }
  await advanceFromName(ctx, from, { name, ...knownFields }, prefillText, bg)
}

async function advanceFromName(ctx, from, data, prefillText, bg) {
  const guessedProduct = prefillText ? guessProduct(ctx.config, prefillText) : null
  if (guessedProduct) {
    data.product = guessedProduct
    await sendButtons(ctx, from,
      `Got it — ${guessedProduct}. How much do you need, and any specific requirements (size, colour, packaging)?`,
      [SKIP_BUTTON, CANCEL_BUTTON], bg)
    await setState(ctx, from, { step: 'quote_details', data })
    return
  }

  const products = ctx.config.products
  if (!products.length) {
    // No product list configured for this tenant — ask as free text instead
    // of trying to build a WhatsApp list UI with nothing in it.
    await sendButtons(ctx, from, 'Which product are you interested in?', [SKIP_BUTTON, CANCEL_BUTTON], bg)
    await setState(ctx, from, { step: 'quote_product_freetext', data })
    return
  }
  // WhatsApp list messages cap out at 10 rows total — truncate rather than
  // fail the whole send if a tenant configures more than that.
  await sendList(ctx, from, 'Which product are you interested in?', 'Select product',
    products.slice(0, 10).map(p => ({ id: `product_${p}`, title: p })), bg)
  await setState(ctx, from, { step: 'quote_product', data })
}

async function continueQuoteFlow(ctx, from, state, text, listId, bg) {
  const { step, data } = state

  if (step === 'quote_name') {
    data.name = text.trim()
    const prefillText = data.prefillText || ''
    delete data.prefillText
    await advanceFromName(ctx, from, data, prefillText, bg)
    return
  }

  if (step === 'quote_product' || step === 'quote_product_freetext') {
    const product = listId ? listId.replace('product_', '') : (isSkip(text) ? '' : text.trim())
    data.product = product
    await sendButtons(ctx, from, 'How much do you need, and any specific requirements (size, colour, packaging)?', [SKIP_BUTTON, CANCEL_BUTTON], bg)
    await setState(ctx, from, { step: 'quote_details', data })
    return
  }

  // Quantity and "additional requirements" are one merged question, stored
  // in both fields so a Quotes admin view's Quantity and Message columns
  // both stay populated. Delivery location is asked separately after this.
  if (step === 'quote_details') {
    const details = isSkip(text) ? '' : text.trim()
    data.quantity = details
    data.message = details
    await advanceAfterDetails(ctx, from, data, bg)
    return
  }

  if (step === 'quote_location') {
    data.location = isSkip(text) ? '' : text.trim()
    await advanceAfterLocation(ctx, from, data, bg)
    return
  }

  if (step === 'quote_company_email') {
    if (isSkip(text)) {
      data.company = ''
      data.email = ''
    } else {
      const { company, email } = splitCompanyEmail(text.trim())
      data.company = company
      data.email = email
    }
    await finalizeQuote(ctx, from, data, bg)
    return
  }
}

// A repeat quoter's delivery city is already on file (contacts.city) —
// reuse it silently instead of asking again.
async function advanceAfterDetails(ctx, from, data, bg) {
  if (data.knownCity) {
    data.location = data.knownCity
    delete data.knownCity
    await advanceAfterLocation(ctx, from, data, bg)
    return
  }
  await sendButtons(ctx, from, 'Where should we deliver this — city or full delivery location?', [SKIP_BUTTON, CANCEL_BUTTON], bg)
  await setState(ctx, from, { step: 'quote_location', data })
}

async function advanceAfterLocation(ctx, from, data, bg) {
  if (data.knownCompany && data.knownEmail) {
    data.company = data.knownCompany
    data.email = data.knownEmail
    delete data.knownCompany
    delete data.knownEmail
    await finalizeQuote(ctx, from, data, bg)
    return
  }
  await sendButtons(ctx, from, "Lastly — your company name and email? (optional, reply \"skip\" to leave blank)", [SKIP_BUTTON, CANCEL_BUTTON], bg)
  await setState(ctx, from, { step: 'quote_company_email', data })
}

async function finalizeQuote(ctx, from, data, bg) {
  if (data.location) {
    data.message = data.message ? `${data.message}\nDelivery location: ${data.location}` : `Delivery location: ${data.location}`
  }
  bg.push(submitQuote(ctx, from, data))
  await sendText(ctx, from, `Thank you, ${data.name}! We've received your enquiry and will get back to you within 24 hours.`, bg)
  await promptMainMenuWithSales(ctx, from, bg)
}

function isSkip(text) {
  return (text || '').trim().toLowerCase() === 'skip'
}

function splitCompanyEmail(text) {
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  if (!emailMatch) return { company: text, email: '' }
  const email = emailMatch[0]
  const company = text.replace(email, '').replace(/[,;|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return { company, email }
}

// NOTE: no email notification yet — whatsapp-meta-layer's lib/notify.js
// posts to ushakiranecoplast.com/submit.php, which is UKEP-specific and has
// no equivalent here. A quote submission is stored (so it shows up in a
// future admin UI) but nobody gets emailed about it yet — worth building
// once there's a real notification target per tenant.
async function submitQuote(ctx, phone, data) {
  try {
    await createQuote({
      orgId: ctx.orgId, phone, name: data.name, company: data.company,
      email: data.email, product: data.product, quantity: data.quantity, message: data.message,
    })
    const contactUpdate = { status: 'Quote Requested' }
    if (data.company) contactUpdate.company = data.company
    if (data.email) contactUpdate.email = data.email
    const detectedCity = data.location ? detectCity(data.location) : null
    if (detectedCity) contactUpdate.city = detectedCity
    await updateContact(ctx.orgId, phone, contactUpdate)
  } catch (err) {
    console.log(`[whatsapp-webhook] submitQuote error: ${err.message}`)
  }
}

// ── Payload parsing ──────────────────────────────────────────────────────
function extractIncoming(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value
  const msg = value?.messages?.[0]
  if (!msg) return null

  const from = msg.from
  const name = value?.contacts?.[0]?.profile?.name || ''
  let text = ''
  let buttonId = ''
  let listId = ''
  let mediaId = ''
  let mediaMimeType = ''

  if (msg.type === 'text') {
    text = msg.text?.body || ''
  } else if (msg.type === 'image') {
    text = msg.image?.caption || ''
    mediaId = msg.image?.id || ''
    mediaMimeType = msg.image?.mime_type || ''
  } else if (msg.type === 'interactive') {
    if (msg.interactive?.type === 'button_reply') {
      buttonId = msg.interactive.button_reply.id
      text = msg.interactive.button_reply.title
    } else if (msg.interactive?.type === 'list_reply') {
      listId = msg.interactive.list_reply.id
      text = msg.interactive.list_reply.title
    }
  } else if (msg.type === 'button') {
    buttonId = msg.button?.payload || ''
    text = msg.button?.text || ''
  } else if (msg.type === 'reaction') {
    text = msg.reaction?.emoji ? `Reacted ${msg.reaction.emoji}` : 'Reacted'
  } else {
    text = `[${msg.type || 'unsupported message'}]`
  }

  return { from, text, buttonId, listId, name, mediaId, mediaMimeType, isReaction: msg.type === 'reaction' }
}

// ── Send helpers ─────────────────────────────────────────────────────────
async function graphSend(ctx, payload, bg) {
  const result = await callGraphSend(ctx.accessToken, ctx.phoneNumberId, payload)
  console.log(`[whatsapp-webhook] send status: ${result.status} ${result.body}`)
  if (result.ok) {
    const logPromise = logMessage(ctx, payload.to, 'out', describeOutbound(payload), undefined, result.wamid)
    if (bg) bg.push(logPromise)
    else await logPromise
  }
}

function describeOutbound(payload) {
  if (payload.type === 'text') return payload.text.body
  if (payload.type === 'document') return payload.document.caption || payload.document.filename
  if (payload.type === 'interactive') {
    const body = payload.interactive.body?.text || ''
    if (payload.interactive.type === 'button') {
      const options = payload.interactive.action.buttons.map(b => b.reply.title).join(' / ')
      return `${body} [${options}]`
    }
    if (payload.interactive.type === 'list') {
      const options = payload.interactive.action.sections[0].rows.map(r => r.title).join(' / ')
      return `${body} [${options}]`
    }
  }
  return '[message]'
}

function sendText(ctx, to, text, bg) {
  return graphSend(ctx, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  }, bg)
}

function sendButtons(ctx, to, bodyText, buttons, bg) {
  return graphSend(ctx, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  }, bg)
}

function sendList(ctx, to, bodyText, buttonLabel, rows, bg) {
  if (rows.length > 10) {
    console.log(`[whatsapp-webhook] sendList: ${rows.length} rows exceeds WhatsApp's 10-row cap — this send will fail`)
  }
  return graphSend(ctx, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonLabel,
        sections: [{ title: 'Products', rows }],
      },
    },
  }, bg)
}

function sendDocument(ctx, to, link, filename, caption, bg) {
  return graphSend(ctx, {
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: { link, filename, caption },
  }, bg)
}

async function logMessage(ctx, phone, direction, message, name, wamid, intent, mediaUrl, mediaType) {
  try {
    await logMessageSb({ orgId: ctx.orgId, phone, direction, message, phoneNumberId: ctx.phoneNumberId, name, wamid, intent, mediaUrl, mediaType })
  } catch (err) {
    console.log(`[whatsapp-webhook] logMessage error: ${err.message}`)
  }
}

async function logIncomingMessage(ctx, phone, text, name, intent, mediaId, mediaMimeType) {
  let mediaUrl = null
  if (mediaId) {
    try {
      const { bytes, contentType } = await fetchMediaBytes(ctx.accessToken, mediaId)
      mediaUrl = await uploadMedia(bytes, contentType || mediaMimeType)
    } catch (err) {
      console.log(`[whatsapp-webhook] media download/upload error: ${err.message}`)
    }
  }
  const message = text || (mediaUrl ? '📷 Photo' : '')
  await logMessage(ctx, phone, 'in', message, name, undefined, intent, mediaUrl, mediaUrl ? 'image' : null)
}
