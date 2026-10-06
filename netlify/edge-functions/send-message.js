// Lets a signed-in tenant user send a WhatsApp text message (Inbox reply) —
// the one write operation Supabase RLS alone can't safely cover, since it
// needs the org's whatsapp_access_token, which must never reach the browser.
//
// Trust boundary: the caller's own Supabase session JWT (not the service
// role) is sent as the Authorization header. It's verified against
// Supabase Auth first, then checked against `memberships` — both with the
// service role, same as whatsapp-webhook.js — before anything is sent.

import { requireOrgMember, getOrgCredentials, logMessage } from './lib/supabase.js'
import { callGraphSend } from './lib/graph.js'

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

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

  const auth = await requireOrgMember(request, orgId)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const org = await getOrgCredentials(orgId)
  const { whatsapp_access_token: accessToken, whatsapp_phone_number_id: phoneNumberId } = org || {}
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
