import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../auth/AuthProvider.jsx'

const LANGUAGES = [
  { value: 'en_US', label: 'English (US)' },
  { value: 'en_GB', label: 'English (UK)' },
  { value: 'hi', label: 'Hindi' },
]

const CATEGORIES = [
  { value: 'UTILITY', label: 'Utility', hint: 'Account/order updates, confirmations, alerts — the vast majority of business messages belong here.' },
  { value: 'MARKETING', label: 'Marketing', hint: 'Promotions, offers, announcements. Costs more and faces stricter review for promotional language.' },
  { value: 'AUTHENTICATION', label: 'Authentication', hint: 'One-time passcodes / login codes ONLY. Using this for anything else gets rejected.' },
]

function findVariables(text) {
  return [...(text || '').matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]))
}

function countVariables(text) {
  return new Set(findVariables(text)).size
}

function previewText(text) {
  return (text || '').replace(/\{\{(\d+)\}\}/g, (_, n) => `[Variable ${n}]`)
}

// Local, non-blocking lint against Meta's actual documented rules — catches
// the easy mistakes before a submission round-trip to Meta (which can take
// minutes to days to come back rejected). Not exhaustive — Meta's own
// content review (promotional language, vague wording) still has the final
// say, this is just the mechanical stuff.
function lintBody(text) {
  const warnings = []
  const trimmed = (text || '').trim()
  if (!trimmed) return warnings

  const vars = findVariables(trimmed)
  if (vars.length === 0) return warnings

  if (/^\{\{\d+\}\}/.test(trimmed)) warnings.push("Can't start the message with a variable — add a word or two before it.")
  if (/\{\{\d+\}\}$/.test(trimmed)) warnings.push("Can't end the message with a variable — add a word or two after it.")
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(trimmed)) warnings.push('Two variables are adjacent — put some words between them.')

  const sorted = [...new Set(vars)].sort((a, b) => a - b)
  const sequential = sorted.every((n, i) => n === i + 1)
  if (!sequential) warnings.push(`Variables must be sequential starting at {{1}} — found ${sorted.map(n => `{{${n}}}`).join(', ')}.`)

  // Rough proxy for Meta's "~3 words of real text around each variable" —
  // checks the words immediately before/after each {{n}}, not a strict parse.
  // Strip leading/trailing punctuation first so ", your order" doesn't count
  // the comma as a word and under-flag a genuinely thin gap (this is exactly
  // what let our own real test submission through this check, only to be
  // rejected by Meta for it).
  const segments = trimmed.split(/\{\{\d+\}\}/)
  const thin = segments.some((seg, i) => {
    if (i === 0 || i === segments.length - 1) return false // start/end already flagged above
    const words = seg.trim().replace(/^[^\w]+|[^\w]+$/g, '').split(/\s+/).filter(Boolean)
    return words.length < 3
  })
  if (thin) warnings.push('At least one variable has very little surrounding text — Meta typically wants ~3 words of real context around each one.')

  return warnings
}

export default function TemplatesPanel({ orgId, templates }) {
  const { session } = useAuth()
  const [name, setName] = useState('')
  const [language, setLanguage] = useState('en_US')
  const [category, setCategory] = useState('UTILITY')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [campaignCounts, setCampaignCounts] = useState({})

  useEffect(() => {
    let cancelled = false
    async function loadCounts() {
      const { data } = await supabase.from('campaigns').select('template_id').eq('org_id', orgId)
      if (cancelled || !data) return
      const counts = {}
      for (const row of data) counts[row.template_id] = (counts[row.template_id] || 0) + 1
      setCampaignCounts(counts)
    }
    loadCounts()
    return () => { cancelled = true }
  }, [orgId, templates.length])

  async function callBroadcast(action, extra = {}) {
    const res = await fetch('/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ orgId, action, ...extra }),
    })
    const json = await res.json()
    if (!res.ok || json.ok === false) throw new Error(json.error || 'Request failed')
    return json
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      await callBroadcast('create_template', { name: name.trim(), language, category, body })
      setNotice('Submitted — Meta typically reviews within a few minutes to a day. Use "Sync from Meta" to check status.')
      setName('')
      setBody('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setError('')
    setNotice('')
    try {
      const result = await callBroadcast('sync_templates_from_meta')
      setNotice(`Synced ${result.syncedCount} template(s) from Meta.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  const variableCount = countVariables(body)
  const warnings = useMemo(() => lintBody(body), [body])
  const categoryInfo = CATEGORIES.find(c => c.value === category)

  return (
    <div className="dashboard-panel">
      <div className="flow-toolbar">
        <button type="button" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync from Meta'}
        </button>
        <span className="panel-muted">Pulls the real approval status for everything you've submitted, since Meta's review has no webhook.</span>
      </div>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="panel-muted">{notice}</p>}

      <div className="section-card">
        <h2>Submit a new template</h2>

        <div className="template-guidelines">
          <strong>Before you submit</strong>
          <ul>
            <li>Name must be lowercase with underscores only (e.g. <code>order_update</code>) — no spaces or capitals.</li>
            <li>Variables (<code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>…) must be sequential, never skip a number.</li>
            <li>Can't start or end the message with a variable — surround every variable with real words.</li>
            <li>Keep roughly 3 words of actual text around each variable — Meta rejects vague placeholder-heavy messages.</li>
            <li>Pick the category honestly: an order update is <strong>Utility</strong>, not Marketing — using the wrong one risks rejection or account restrictions.</li>
          </ul>
        </div>

        <form className="template-form" onSubmit={handleSubmit}>
          <div className="flow-option-row">
            <input type="text" placeholder="Name (e.g. order_update)" value={name} onChange={e => setName(e.target.value)} required />
            <select className="status-select" value={language} onChange={e => setLanguage(e.target.value)}>
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <select className="status-select" value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          {categoryInfo && <p className="flow-hint">{categoryInfo.hint}</p>}

          <textarea
            placeholder="Hi {{1}}, your order {{2}} has shipped and should arrive within 3 days."
            value={body}
            onChange={e => setBody(e.target.value)}
            required
          />
          <p className="panel-muted">{variableCount} variable(s) detected. Preview: {previewText(body) || '—'}</p>
          {warnings.length > 0 && (
            <ul className="template-warnings">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit for approval'}</button>
        </form>
      </div>

      <div className="section-card">
        <h2>Your templates</h2>
        {templates.length === 0 ? (
          <p className="panel-muted">No templates yet — submit one above, or click "Sync from Meta" if you already have approved templates in WhatsApp Manager.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Language</th>
                  <th>Category</th>
                  <th>Variables</th>
                  <th>Status</th>
                  <th>Used in</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {templates.map(t => (
                  <Fragment key={t.id}>
                    <tr className="clickable-row" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                      <td>{t.name}</td>
                      <td>{t.language}</td>
                      <td>{t.category || '—'}</td>
                      <td className="tabular">{t.variable_count}</td>
                      <td>
                        <span className={`badge ${t.status === 'approved' ? 'badge-active' : t.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="tabular">{campaignCounts[t.id] || 0} campaign(s)</td>
                      <td className="panel-muted">{new Date(t.created_at).toLocaleDateString()}</td>
                    </tr>
                    {expandedId === t.id && (
                      <tr>
                        <td colSpan={7}>
                          <div className="template-detail">
                            <p><strong>Body:</strong> {t.body_preview || '—'}</p>
                            {t.status === 'rejected' && t.rejected_reason && (
                              <p className="form-error"><strong>Rejection reason:</strong> {t.rejected_reason}</p>
                            )}
                            {t.meta_template_id && <p className="panel-muted">Meta template ID: {t.meta_template_id}</p>}
                            <p className="panel-muted">Submitted {new Date(t.created_at).toLocaleString()}</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
