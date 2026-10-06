// Netlify Scheduled Function (Node runtime — netlify/functions, NOT
// netlify/edge-functions, since only classic Functions support cron
// scheduling). Drains due 'scheduled' campaigns across every org without a
// browser tab open to drive the send loop, the way "send now" does via
// CampaignForm.jsx calling broadcast.js's send_one directly.
//
// Self-contained (own sb()/Graph POST, process.env not Netlify.env.get) —
// deliberately not importing the Deno-flavored netlify/edge-functions/lib/*
// files, since this runs on a different runtime.
//
// Processes at most MAX_CAMPAIGNS_PER_TICK due campaigns, and at most
// BATCH_SIZE of each one's recipients, per tick — bounds total Graph API
// calls per invocation regardless of how many tenants have something due,
// so a large or crowded queue just drains over several 5-minute ticks
// instead of one. Revisit these numbers once there's real usage data.
const BATCH_SIZE = 8
const MAX_CAMPAIGNS_PER_TICK = 5
const GRAPH_URL = 'https://graph.facebook.com/v21.0'

async function sb(path, { method = 'GET', body, headers = {} } = {}) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
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
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${await res.text().catch(() => '')}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

async function sendTemplate(accessToken, phoneNumberId, to, templateName, templateLanguage, variables) {
  const components = variables?.length
    ? [{ type: 'body', parameters: variables.map(v => ({ type: 'text', text: String(v ?? '') })) }]
    : []
  const res = await fetch(`${GRAPH_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: templateName, language: { code: templateLanguage }, components },
    }),
  })
  const bodyText = await res.text()
  let wamid = null
  try { wamid = JSON.parse(bodyText)?.messages?.[0]?.id || null } catch { /* non-JSON error body */ }
  return { ok: res.ok, wamid, body: bodyText }
}

export default async () => {
  const nowIso = new Date().toISOString()
  const due = await sb(
    `campaigns?status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(nowIso)}&select=id,org_id,template_id&order=scheduled_at.asc&limit=${MAX_CAMPAIGNS_PER_TICK}`
  )

  for (const campaign of due || []) {
    try {
      // Flip to 'sending' immediately — guards against a second overlapping
      // tick picking up the same campaign before this one finishes.
      await sb(`campaigns?id=eq.${campaign.id}`, { method: 'PATCH', body: { status: 'sending' }, headers: { Prefer: 'return=minimal' } })

      const [org] = await sb(`organizations?id=eq.${encodeURIComponent(campaign.org_id)}&select=whatsapp_access_token,whatsapp_phone_number_id`) || []
      if (!org?.whatsapp_access_token) {
        console.log(`[send-scheduled-campaigns] campaign=${campaign.id} org has no WhatsApp number connected — skipping`)
        continue
      }

      const [template] = await sb(`templates?id=eq.${encodeURIComponent(campaign.template_id)}&select=name,language`) || []
      if (!template) {
        console.log(`[send-scheduled-campaigns] campaign=${campaign.id} template not found — skipping`)
        continue
      }

      const recipients = await sb(
        `campaign_recipients?campaign_id=eq.${campaign.id}&status=eq.pending&select=id,phone,variables&limit=${BATCH_SIZE}`
      )

      for (const r of recipients || []) {
        const result = await sendTemplate(org.whatsapp_access_token, org.whatsapp_phone_number_id, r.phone, template.name, template.language, r.variables)
        if (result.ok) {
          await sb(`campaign_recipients?id=eq.${r.id}`, {
            method: 'PATCH', body: { status: 'sent', wamid: result.wamid, sent_at: new Date().toISOString() }, headers: { Prefer: 'return=minimal' },
          })
        } else {
          await sb(`campaign_recipients?id=eq.${r.id}`, {
            method: 'PATCH', body: { status: 'failed', error: result.body }, headers: { Prefer: 'return=minimal' },
          })
        }
      }

      // No more pending recipients for this campaign -> it's done. Recompute
      // sent/failed counts from the actual rows rather than incrementing
      // counters, so this stays correct even if a previous tick partially
      // processed this campaign before a crash/redeploy.
      const stillPending = await sb(`campaign_recipients?campaign_id=eq.${campaign.id}&status=eq.pending&select=id&limit=1`)
      if (!stillPending || stillPending.length === 0) {
        const allRecipients = await sb(`campaign_recipients?campaign_id=eq.${campaign.id}&select=status`)
        const sentCount = (allRecipients || []).filter(x => x.status === 'sent').length
        const failedCount = (allRecipients || []).filter(x => x.status === 'failed').length
        await sb(`campaigns?id=eq.${campaign.id}`, {
          method: 'PATCH',
          body: { status: 'completed', completed_at: new Date().toISOString(), sent_count: sentCount, failed_count: failedCount },
          headers: { Prefer: 'return=minimal' },
        })
      }
    } catch (err) {
      console.log(`[send-scheduled-campaigns] campaign=${campaign.id} error: ${err.message}`)
    }
  }

  return new Response('OK', { status: 200 })
}

export const config = {
  schedule: '*/5 * * * *',
}
