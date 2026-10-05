// Lets a signed-in tenant user send a WhatsApp text message (Inbox reply) —
// the one write operation Supabase RLS alone can't safely cover, since it
// needs the org's whatsapp_access_token, which must never reach the browser.
//
// Trust boundary: the caller's own Supabase session JWT (not the service
// role) is sent as the Authorization header. It's verified against
// Supabase Auth first, then checked against `memberships` — both with the
// service role, same as whatsapp-webhook.js — before anything is sent.

import { logMessage } from './lib/supabase.js'
import { callGraphSend } from './lib/graph.js'

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = request.headers.get('authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Missing Authorization header' }, 401)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { orgId, to, text } = body
  if (!orgId || !to || !text?.trim()) {
    return json({ error: 'orgId, to, and text are required' }, 400)
  }

  const supabaseUrl = Netlify.env.get('SUPABASE_URL')
  const serviceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')

  // Validates the caller's own session token against Supabase Auth — this is
  // what actually proves "this is a real signed-in user", not just any string.
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: serviceKey },
  })
  if (!userRes.ok) return json({ error: 'Invalid or expired session' }, 401)
  const user = await userRes.json()

  const membership = await sb(supabaseUrl, serviceKey,
    `memberships?user_id=eq.${encodeURIComponent(user.id)}&org_id=eq.${encodeURIComponent(orgId)}&select=role&limit=1`)
  if (!membership?.[0]) return json({ error: 'Not a member of this organization' }, 403)

  const org = await sb(supabaseUrl, serviceKey,
    `organizations?id=eq.${encodeURIComponent(orgId)}&select=whatsapp_access_token,whatsapp_phone_number_id&limit=1`)
  const { whatsapp_access_token: accessToken, whatsapp_phone_number_id: phoneNumberId } = org?.[0] || {}
  if (!accessToken || !phoneNumberId) return json({ error: 'This organization has no WhatsApp number connected' }, 409)

  const result = await callGraphSend(accessToken, phoneNumberId, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  })

  if (!result.ok) {
    console.log(`[send-message] org=${orgId} to=${to} send failed: ${result.status} ${result.body}`)
    return json({ error: 'Send failed', details: result.body }, 502)
  }

  await logMessage({ orgId, phone: to, direction: 'out', message: text, phoneNumberId, wamid: result.wamid })
    .catch(err => console.log(`[send-message] logMessage error: ${err.message}`))

  return json({ ok: true, wamid: result.wamid })
}

export const config = {
  path: '/send-message',
}

async function sb(supabaseUrl, serviceKey, path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  if (!res.ok) throw new Error(`Supabase GET ${path} -> ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
