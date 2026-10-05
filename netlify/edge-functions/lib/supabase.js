// Thin PostgREST wrapper — same pattern as whatsapp-meta-layer's lib/supabase.js
// (deliberately raw fetch, no @supabase/supabase-js dependency). Every
// operational query here is org-scoped: multi-tenant from the start, not a
// retrofit. Only the functions whatsapp-webhook.js needs are ported so far —
// more get added as the other edge functions (broadcast, inbox, etc.) do.

async function sb(path, { method = 'GET', body, headers = {} } = {}) {
  const url = Netlify.env.get('SUPABASE_URL')
  const key = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase env vars not configured')

  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${text}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 10) return `91${digits}`
  return digits
}

// ── Tenant resolution ────────────────────────────────────────────────────
// Meta's webhook payload carries phone_number_id, not any tenant identifier
// of ours — this is how an inbound message gets routed to the right org
// without needing a separate webhook URL per tenant.
export async function getOrgByPhoneNumberId(phoneNumberId) {
  const rows = await sb(`organizations?whatsapp_phone_number_id=eq.${encodeURIComponent(phoneNumberId)}&select=id,name,whatsapp_access_token,bot_config,status&limit=1`)
  return rows?.[0] || null
}

// Meta's GET verification handshake happens once per Meta App, before any
// message has ever been sent, so there's no phone_number_id to key off yet —
// match against every tenant's own verify token instead.
export async function getOrgByVerifyToken(token) {
  const rows = await sb(`organizations?whatsapp_webhook_verify_token=eq.${encodeURIComponent(token)}&select=id&limit=1`)
  return rows?.[0] || null
}

// ── Conversation state (bot FSM) — keyed by (org_id, phone) ────────────────
export async function getConversationState(orgId, phone) {
  try {
    const rows = await sb(`conversation_state?org_id=eq.${encodeURIComponent(orgId)}&phone=eq.${encodeURIComponent(phone)}&select=step,data,last_welcome_at,conversation_status`)
    const row = rows?.[0]
    if (!row) return { step: 'new', data: {}, lastWelcomeAt: '', conversationStatus: 'open' }
    return {
      step: row.step || 'new',
      data: row.data || {},
      lastWelcomeAt: row.last_welcome_at || '',
      conversationStatus: row.conversation_status || 'open',
    }
  } catch (err) {
    console.log(`[lib/supabase] getConversationState error: ${err.message}`)
    return { step: 'new', data: {}, lastWelcomeAt: '', conversationStatus: 'open' }
  }
}

export async function saveConversationState(orgId, phone, step, data, lastWelcomeAt) {
  const body = { org_id: orgId, phone, step, data: data || {}, updated_at: new Date().toISOString() }
  if (lastWelcomeAt !== undefined && lastWelcomeAt !== null) body.last_welcome_at = lastWelcomeAt
  await sb('conversation_state?on_conflict=org_id,phone', {
    method: 'POST',
    body,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  })
}

export async function flagNeedsReview(orgId, phone, intent) {
  await sb('conversation_state?on_conflict=org_id,phone', {
    method: 'POST',
    body: { org_id: orgId, phone, needs_review: true, last_intent: intent || null },
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  })
}

export async function clearNeedsReview(orgId, phone) {
  await sb('conversation_state?on_conflict=org_id,phone', {
    method: 'POST',
    body: { org_id: orgId, phone, needs_review: false },
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  })
}

export async function setConversationStatus(orgId, phone, status) {
  await sb('conversation_state?on_conflict=org_id,phone', {
    method: 'POST',
    body: { org_id: orgId, phone, conversation_status: status },
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  })
}

// ── Media storage (images) ──────────────────────────────────────────────
const MEDIA_BUCKET = 'whatsapp-media'
const EXT_BY_CONTENT_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

// NOTE: the whatsapp-media Storage bucket needs creating in this Supabase
// project before this works (see whatsapp-meta-layer/scripts/setup-media-bucket.js
// for the one-time setup this was based on) — not done yet as of this file.
export async function uploadMedia(bytes, contentType) {
  const url = Netlify.env.get('SUPABASE_URL')
  const key = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase env vars not configured')

  const ext = EXT_BY_CONTENT_TYPE[contentType] || 'bin'
  const path = `${crypto.randomUUID()}.${ext}`
  const res = await fetch(`${url}/storage/v1/object/${MEDIA_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: bytes,
  })
  if (!res.ok) throw new Error(`Supabase storage upload -> ${res.status}: ${await res.text().catch(() => '')}`)
  return `${url}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`
}

// ── Messages ─────────────────────────────────────────────────────────────
export async function logMessage({ orgId, phone, direction, message, phoneNumberId, name, wamid, intent, mediaUrl, mediaType }) {
  await sb('messages', {
    method: 'POST',
    body: {
      org_id: orgId,
      phone,
      direction,
      message: message || '',
      phone_number_id: phoneNumberId || null,
      name: name || null,
      wamid: wamid || null,
      intent: intent || null,
      media_url: mediaUrl || null,
      media_type: mediaType || null,
    },
    headers: { Prefer: 'return=minimal' },
  })
}

export async function updateMessageStatusByWamid(wamid, status, timestampIso, errorJson) {
  const filter = `wamid=eq.${encodeURIComponent(wamid)}&or=(status_updated_at.is.null,status_updated_at.lt.${encodeURIComponent(timestampIso)})`
  await sb(`messages?${filter}`, {
    method: 'PATCH',
    body: { status, status_updated_at: timestampIso, error: errorJson || null },
    headers: { Prefer: 'return=minimal' },
  })
}

// ── Contacts ─────────────────────────────────────────────────────────────
export async function upsertContact({ orgId, phone, name, source }) {
  const body = { org_id: orgId, phone, source: source || 'manual', updated_at: new Date().toISOString() }
  if (name) body.name = name
  await sb('contacts?on_conflict=org_id,phone', {
    method: 'POST',
    body,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  })
}

export async function updateContact(orgId, phone, fields) {
  const body = { updated_at: new Date().toISOString() }
  if (fields.status !== undefined) body.status = fields.status
  if (fields.company !== undefined) body.company = fields.company
  if (fields.email !== undefined) body.email = fields.email
  if (fields.productInterest !== undefined) body.product_interest = fields.productInterest
  if (fields.city !== undefined) body.city = fields.city
  if (fields.name !== undefined) body.name = fields.name
  if (fields.notes !== undefined) body.notes = fields.notes
  await sb(`contacts?org_id=eq.${encodeURIComponent(orgId)}&phone=eq.${encodeURIComponent(phone)}`, {
    method: 'PATCH',
    body,
    headers: { Prefer: 'return=minimal' },
  })
  if (fields.status !== undefined) {
    await logActivity(orgId, phone, 'status_change', `Status changed to ${fields.status}`).catch(err =>
      console.log(`[lib/supabase] logActivity error: ${err.message}`))
  }
}

export async function getContactByPhone(orgId, phone) {
  const rows = await sb(`contacts?org_id=eq.${encodeURIComponent(orgId)}&phone=eq.${encodeURIComponent(phone)}&select=company,email,city&limit=1`)
  return rows?.[0] || null
}

// ── Activity log ─────────────────────────────────────────────────────────
export async function logActivity(orgId, phone, type, summary) {
  await sb('activity_log', {
    method: 'POST',
    body: { org_id: orgId, phone, type, summary },
    headers: { Prefer: 'return=minimal' },
  })
}

// ── Quotes ───────────────────────────────────────────────────────────────
export async function createQuote({ orgId, contactId, phone, name, company, email, product, quantity, message }) {
  await sb('quotes', {
    method: 'POST',
    body: { org_id: orgId, contact_id: contactId || null, phone, name: name || null, company: company || null, email: email || null, product: product || null, quantity: quantity || null, message: message || null },
    headers: { Prefer: 'return=minimal' },
  })
}
