// Action-dispatch edge function for Templates/Broadcast/Campaigns — three
// actions, all needing the org's WhatsApp credentials (hence an edge
// function at all; plain campaign/recipient CRUD goes straight to Supabase
// from the frontend under RLS, same split as send-message.js vs. the rest
// of the dashboard).
//
// Trust boundary identical to send-message.js: the caller's own Supabase
// session JWT is verified, then checked against `memberships`, before any
// of these actions touch Meta's API with the org's access token.

import { requireOrgMember, getOrgCredentials, updateCampaignRecipient } from './lib/supabase.js'
import { callGraphSend, buildTemplatePayload } from './lib/graph.js'

const GRAPH_URL = 'https://graph.facebook.com/v21.0'

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { orgId, action } = body
  if (!orgId || !action) return json({ error: 'orgId and action are required' }, 400)

  const auth = await requireOrgMember(request, orgId)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const org = await getOrgCredentials(orgId)
  if (!org?.whatsapp_access_token) return json({ error: 'This organization has no WhatsApp number connected' }, 409)

  if (action === 'create_template') return handleCreateTemplate(orgId, org, body)
  if (action === 'sync_templates_from_meta') return handleSync(orgId, org)
  if (action === 'send_one') return handleSendOne(org, body)
  return json({ error: `Unknown action "${action}"` }, 400)
}

export const config = {
  path: '/broadcast',
}

// Counts {{1}}, {{2}}... placeholders — same technique used on both sides
// of this contract (here, when a body is submitted; in handleSync, when
// Meta hands back an already-approved template's real body text).
function countVariables(text) {
  const matches = [...(text || '').matchAll(/\{\{\d+\}\}/g)]
  return new Set(matches.map(m => m[0])).size
}

// ── create_template ──────────────────────────────────────────────────────
// Submits a brand new template to Meta for review. Review is asynchronous
// (minutes to days) — this only ever gets Meta's immediate PENDING ack, not
// the eventual approval/rejection; see sync_templates_from_meta for that.
async function handleCreateTemplate(orgId, org, { name, language, category, body: text }) {
  if (!name || !language || !category || !text?.trim()) {
    return json({ error: 'name, language, category, and body are required' }, 400)
  }

  const metaRes = await fetch(`${GRAPH_URL}/${org.whatsapp_business_account_id}/message_templates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${org.whatsapp_access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name, language, category,
      components: [{ type: 'BODY', text }],
    }),
  })
  const metaJson = await metaRes.json().catch(() => null)

  if (!metaRes.ok) {
    // Template rejections are about specific, fixable content rules (e.g.
    // "variables can't be adjacent") — pass Meta's own message straight
    // through rather than a generic failure, so the user can actually act on it.
    const message = metaJson?.error?.message || `Meta returned ${metaRes.status}`
    return json({ ok: false, error: message }, metaRes.status)
  }

  const variableCount = countVariables(text)
  await upsertTemplate({
    org_id: orgId, name, language, category,
    variable_count: variableCount, body_preview: text,
    status: 'pending', meta_template_id: metaJson.id, rejected_reason: null,
  })

  return json({ ok: true, templateId: metaJson.id, status: 'pending' })
}

// ── sync_templates_from_meta ─────────────────────────────────────────────
// Meta's review has no webhook — this is the only way a submitted template's
// status (pending -> approved/rejected) ever updates. Pulls every template
// regardless of status (unlike a read-only "list approved ones" sync),
// since the whole point here is catching the pending -> approved/rejected
// transition, not just listing what's already usable.
async function handleSync(orgId, org) {
  const templates = []
  let url = `${GRAPH_URL}/${org.whatsapp_business_account_id}/message_templates?fields=name,language,category,status,components,rejected_reason&limit=100`

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${org.whatsapp_access_token}` } })
    if (!res.ok) {
      const errJson = await res.json().catch(() => null)
      return json({ ok: false, error: errJson?.error?.message || `Meta returned ${res.status}` }, res.status)
    }
    const json_ = await res.json()
    templates.push(...(json_.data || []))
    url = json_.paging?.next || null
  }

  const statusMap = { APPROVED: 'approved', REJECTED: 'rejected' }

  for (const t of templates) {
    const bodyComponent = (t.components || []).find(c => c.type === 'BODY')
    await upsertTemplate({
      org_id: orgId, name: t.name, language: t.language, category: t.category,
      variable_count: countVariables(bodyComponent?.text),
      body_preview: bodyComponent?.text || null,
      status: statusMap[t.status] || 'pending',
      // Meta returns the literal string "NONE" for approved templates,
      // not null or an absent field — normalize it.
      rejected_reason: (t.rejected_reason && t.rejected_reason !== 'NONE') ? t.rejected_reason : null,
    })
  }

  return json({ ok: true, syncedCount: templates.length })
}

async function upsertTemplate(fields) {
  const supabaseUrl = Netlify.env.get('SUPABASE_URL')
  const serviceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')
  await fetch(`${supabaseUrl}/rest/v1/templates?on_conflict=org_id,name,language`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(fields),
  })
}

// ── send_one ─────────────────────────────────────────────────────────────
// One recipient, one Graph API call — deliberately not a server-side batch
// loop (see CampaignForm.jsx, which calls this once per recipient client-
// side). Keeps every invocation of this function trivially small regardless
// of campaign size, same reasoning as send-message.js.
async function handleSendOne(org, { recipientId, phone, templateName, templateLanguage, variables }) {
  if (!recipientId || !phone || !templateName) {
    return json({ error: 'recipientId, phone, and templateName are required' }, 400)
  }

  const payload = buildTemplatePayload(phone, templateName, templateLanguage || 'en_US', variables || [])
  const result = await callGraphSend(org.whatsapp_access_token, org.whatsapp_phone_number_id, payload)

  if (!result.ok) {
    await updateCampaignRecipient(recipientId, { status: 'failed', error: result.body }).catch(err =>
      console.log(`[broadcast] updateCampaignRecipient error: ${err.message}`))
    return json({ ok: false, error: result.body })
  }

  await updateCampaignRecipient(recipientId, { status: 'sent', wamid: result.wamid, sentAt: new Date().toISOString() })
    .catch(err => console.log(`[broadcast] updateCampaignRecipient error: ${err.message}`))

  return json({ ok: true, wamid: result.wamid })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
