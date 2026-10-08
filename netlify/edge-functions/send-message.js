// Lets a signed-in tenant user send a WhatsApp message (Inbox reply) — text
// or media — the one write operation Supabase RLS alone can't safely cover,
// since it needs the org's whatsapp_access_token, which must never reach
// the browser.
//
// Trust boundary: the caller's own Supabase session JWT (not the service
// role) is sent as the Authorization header. It's verified against
// Supabase Auth first, then checked against `memberships` — both with the
// service role, same as whatsapp-webhook.js — before anything is sent.
//
// Two request shapes on the same endpoint: JSON (existing, text-only) vs.
// multipart/form-data (new, media) — branched on Content-Type so the
// existing text contract stays exactly as it was.

import { requireOrgMember, getOrgCredentials, logMessage, uploadMedia } from './lib/supabase.js'
import { callGraphSend, uploadMediaToGraph, buildMediaPayload } from './lib/graph.js'
import { classifyMediaType } from './lib/media.js'

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    return handleMediaSend(request)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { orgId, to, text, replyToWamid } = body
  if (!orgId || !to || !text?.trim()) {
    return json({ error: 'orgId, to, and text are required' }, 400)
  }

  const auth = await requireOrgMember(request, orgId)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const org = await getOrgCredentials(orgId)
  const { whatsapp_access_token: accessToken, whatsapp_phone_number_id: phoneNumberId } = org || {}
  if (!accessToken || !phoneNumberId) return json({ error: 'This organization has no WhatsApp number connected' }, 409)

  const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }
  if (replyToWamid) payload.context = { message_id: replyToWamid }

  const result = await callGraphSend(accessToken, phoneNumberId, payload)

  if (!result.ok) {
    console.log(`[send-message] org=${orgId} to=${to} send failed: ${result.status} ${result.body}`)
    return json({ error: 'Send failed', details: result.body }, 502)
  }

  await logMessage({ orgId, phone: to, direction: 'out', message: text, phoneNumberId, wamid: result.wamid, replyToWamid })
    .catch(err => console.log(`[send-message] logMessage error: ${err.message}`))

  return json({ ok: true, wamid: result.wamid })
}

// orgId, to, type ('image'|'audio'|'video'|'document'), optional caption,
// optional replyToWamid, and the file itself, as multipart fields.
async function handleMediaSend(request) {
  const form = await request.formData().catch(() => null)
  if (!form) return json({ error: 'Invalid form data' }, 400)

  const orgId = form.get('orgId')
  const to = form.get('to')
  const type = form.get('type')
  const caption = form.get('caption') || ''
  const replyToWamid = form.get('replyToWamid') || ''
  const file = form.get('file')

  if (!orgId || !to || !type || !file) {
    return json({ error: 'orgId, to, type, and file are required' }, 400)
  }

  const auth = await requireOrgMember(request, orgId)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const org = await getOrgCredentials(orgId)
  const { whatsapp_access_token: accessToken, whatsapp_phone_number_id: phoneNumberId } = org || {}
  if (!accessToken || !phoneNumberId) return json({ error: 'This organization has no WhatsApp number connected' }, 409)

  const contentType = file.type || 'application/octet-stream'
  const bytes = new Uint8Array(await file.arrayBuffer())

  // Our own copy first — Meta's own media isn't permanently retrievable
  // either, so without this the Inbox's history would stop being able to
  // render it once Meta's copy expires. Mirrors logIncomingMessage's
  // inbound pattern (same reasoning, same uploadMedia helper).
  let mediaUrl = null
  try {
    mediaUrl = await uploadMedia(bytes, contentType)
  } catch (err) {
    console.log(`[send-message] uploadMedia error: ${err.message}`)
  }

  let mediaId
  try {
    mediaId = await uploadMediaToGraph(accessToken, phoneNumberId, new Blob([bytes], { type: contentType }), contentType, file.name)
  } catch (err) {
    return json({ error: 'Media upload to WhatsApp failed', details: err.message }, 502)
  }

  const payload = buildMediaPayload(type, to, mediaId, { caption, filename: file.name, replyToWamid })
  const result = await callGraphSend(accessToken, phoneNumberId, payload)

  if (!result.ok) {
    console.log(`[send-message] org=${orgId} to=${to} media send failed: ${result.status} ${result.body}`)
    return json({ error: 'Send failed', details: result.body }, 502)
  }

  await logMessage({
    orgId, phone: to, direction: 'out', message: caption, phoneNumberId,
    wamid: result.wamid, mediaUrl, mediaType: classifyMediaType(contentType), replyToWamid,
  }).catch(err => console.log(`[send-message] logMessage error: ${err.message}`))

  return json({ ok: true, wamid: result.wamid })
}

export const config = {
  path: '/send-message',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
