// Shared WhatsApp Cloud API send helper — adapted from whatsapp-meta-layer's
// lib/graph.js. The one structural change: every function here takes the
// access token as a parameter instead of reading a single global
// WHATSAPP_ACCESS_TOKEN env var, since each tenant has their own WhatsApp
// number and their own token (stored on their organizations row).

const GRAPH_URL = 'https://graph.facebook.com/v21.0'

// Returns wamid (the outbound message's Graph API id) alongside the raw
// response so callers can log it and match later status webhooks against it.
export async function callGraphSend(accessToken, phoneNumberId, payload) {
  if (!accessToken || !phoneNumberId) {
    return { ok: false, status: null, wamid: null, body: 'missing accessToken or phoneNumberId' }
  }
  try {
    const res = await fetch(`${GRAPH_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const bodyText = await res.text()
    let wamid = null
    try {
      wamid = JSON.parse(bodyText)?.messages?.[0]?.id || null
    } catch {
      // Non-JSON error body — wamid stays null, caller still gets ok/status/body to log.
    }
    return { ok: res.ok, status: res.status, wamid, body: bodyText }
  } catch (err) {
    return { ok: false, status: null, wamid: null, body: err.message }
  }
}

// Downloads the bytes of an inbound media message. Meta's webhook only
// gives us a media id — the actual file lives behind a second, short-lived
// (~5min) URL that has to be looked up right away, so this is called
// synchronously from the webhook handler rather than deferred.
export async function fetchMediaBytes(accessToken, mediaId) {
  if (!accessToken || !mediaId) throw new Error('missing accessToken or mediaId')

  const metaRes = await fetch(`${GRAPH_URL}/${mediaId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!metaRes.ok) throw new Error(`media lookup failed: ${metaRes.status} ${await metaRes.text()}`)
  const meta = await metaRes.json()

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!fileRes.ok) throw new Error(`media download failed: ${fileRes.status}`)

  const contentType = fileRes.headers.get('content-type') || meta.mime_type || 'application/octet-stream'
  const bytes = new Uint8Array(await fileRes.arrayBuffer())
  return { bytes, contentType }
}

export function buildTemplatePayload(to, templateName, languageCode, variableValues) {
  const components = variableValues && variableValues.length
    ? [{ type: 'body', parameters: variableValues.map(v => ({ type: 'text', text: String(v ?? '') })) }]
    : []
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name: templateName, language: { code: languageCode }, components },
  }
}
