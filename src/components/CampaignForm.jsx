import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../auth/AuthProvider.jsx'

const STATUS_OPTIONS = ['New', 'Quote Requested', 'Contacted', 'Won', 'Lost']

// Must stay in lockstep with updateContact in netlify/edge-functions/lib/supabase.js
// — same contract FlowBuilderPanel.jsx's save_to_contact mappings already use.
const CONTACT_COLUMNS = ['name', 'company', 'email', 'product_interest', 'city', 'status', 'notes']

// Shared by BroadcastPanel (allowSchedule=false, quick send-now) and
// CampaignsPanel (allowSchedule=true, full creation flow). Campaign
// creation itself is plain CRUD (direct Supabase insert, RLS-protected) —
// only the actual per-recipient send touches the WhatsApp token, via
// broadcast.js's send_one action.
export default function CampaignForm({ orgId, templates, contacts, allowSchedule, onDone }) {
  const { session } = useAuth()
  const approvedTemplates = useMemo(() => templates.filter(t => t.status === 'approved'), [templates])

  const [templateId, setTemplateId] = useState('')
  const [segment, setSegment] = useState('all')
  const [slots, setSlots] = useState([]) // [{ mode: 'fixed'|'contact', value, contactField }]
  const [scheduleMode, setScheduleMode] = useState('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState(null) // { sent, total }
  const [error, setError] = useState('')

  const template = approvedTemplates.find(t => t.id === templateId)

  function selectTemplate(id) {
    setTemplateId(id)
    const t = approvedTemplates.find(x => x.id === id)
    const count = t?.variable_count || 0
    setSlots(Array.from({ length: count }, () => ({ mode: 'fixed', value: '', contactField: CONTACT_COLUMNS[0] })))
  }

  function updateSlot(index, patch) {
    setSlots(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s))
  }

  const recipients = useMemo(() => {
    if (segment === 'all') return contacts
    return contacts.filter(c => c.status === segment)
  }, [contacts, segment])

  function resolveVariables(contact) {
    return slots.map(slot => slot.mode === 'fixed' ? slot.value : (contact[slot.contactField] || ''))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!template) { setError('Choose a template.'); return }
    if (recipients.length === 0) { setError('No recipients match this segment.'); return }

    let scheduledIso = null
    if (allowSchedule && scheduleMode === 'schedule') {
      if (!scheduledAt) { setError('Pick a date and time to schedule for.'); return }
      scheduledIso = new Date(scheduledAt).toISOString()
      if (new Date(scheduledIso) <= new Date()) { setError('Scheduled time must be in the future.'); return }
    }

    setSubmitting(true)
    try {
      const { data: campaign, error: campaignError } = await supabase.from('campaigns').insert({
        org_id: orgId,
        template_id: template.id,
        label: label.trim() || template.name,
        status: scheduledIso ? 'scheduled' : 'sending',
        scheduled_at: scheduledIso,
        total_recipients: recipients.length,
      }).select().single()
      if (campaignError) throw campaignError

      const recipientRows = recipients.map(c => ({
        org_id: orgId,
        campaign_id: campaign.id,
        contact_id: c.id,
        phone: c.phone,
        name: c.name,
        variables: resolveVariables(c),
      }))
      const { data: insertedRecipients, error: recipientsError } = await supabase
        .from('campaign_recipients').insert(recipientRows).select()
      if (recipientsError) throw recipientsError

      if (!scheduledIso) {
        setProgress({ sent: 0, total: insertedRecipients.length })
        for (let i = 0; i < insertedRecipients.length; i++) {
          const r = insertedRecipients[i]
          await fetch('/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({
              orgId, action: 'send_one',
              recipientId: r.id, phone: r.phone,
              templateName: template.name, templateLanguage: template.language,
              variables: r.variables,
            }),
          }).catch(() => null) // a failed call here still leaves the recipient 'pending' — visible in Campaigns detail, not silently lost
          setProgress({ sent: i + 1, total: insertedRecipients.length })
        }
      }

      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="dashboard-panel" onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}

      <label className="flow-field">
        Campaign name (optional)
        <input type="text" placeholder={template?.name || 'Untitled'} value={label} onChange={e => setLabel(e.target.value)} />
      </label>

      <label className="flow-field">
        Template
        <select className="status-select" value={templateId} onChange={e => selectTemplate(e.target.value)} required>
          <option value="">— Choose an approved template —</option>
          {approvedTemplates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
        </select>
        {approvedTemplates.length === 0 && (
          <span className="flow-hint">No approved templates yet — submit one in Templates and wait for Meta's review.</span>
        )}
      </label>

      <label className="flow-field">
        Recipients
        <select className="status-select" value={segment} onChange={e => setSegment(e.target.value)}>
          <option value="all">All contacts ({contacts.length})</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s} ({contacts.filter(c => c.status === s).length})</option>
          ))}
        </select>
        <span className="flow-hint">{recipients.length} recipient(s) will be included.</span>
      </label>

      {slots.length > 0 && (
        <div className="section-card">
          <h2>Fill in the template's variables</h2>
          {slots.map((slot, i) => (
            <div className="flow-option-row" key={i}>
              <span className="flow-step-number">{`{{${i + 1}}}`}</span>
              <select className="status-select" value={slot.mode} onChange={e => updateSlot(i, { mode: e.target.value })}>
                <option value="fixed">Fixed value</option>
                <option value="contact">From contact field</option>
              </select>
              {slot.mode === 'fixed' ? (
                <input type="text" placeholder="Same for everyone" value={slot.value} onChange={e => updateSlot(i, { value: e.target.value })} />
              ) : (
                <select className="status-select" value={slot.contactField} onChange={e => updateSlot(i, { contactField: e.target.value })}>
                  {CONTACT_COLUMNS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      )}

      {allowSchedule && (
        <label className="flow-field">
          <div className="flow-option-row">
            <label><input type="radio" name="scheduleMode" checked={scheduleMode === 'now'} onChange={() => setScheduleMode('now')} /> Send now</label>
            <label><input type="radio" name="scheduleMode" checked={scheduleMode === 'schedule'} onChange={() => setScheduleMode('schedule')} /> Schedule for later</label>
          </div>
          {scheduleMode === 'schedule' && (
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          )}
        </label>
      )}

      {progress && (
        <p className="panel-muted">Sending {progress.sent} / {progress.total}…</p>
      )}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Working…' : (allowSchedule && scheduleMode === 'schedule') ? 'Schedule campaign' : 'Send now'}
      </button>
    </form>
  )
}
