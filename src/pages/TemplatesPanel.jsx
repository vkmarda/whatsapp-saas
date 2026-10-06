import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../auth/AuthProvider.jsx'

const LANGUAGES = [
  { value: 'en_US', label: 'English (US)' },
  { value: 'en_GB', label: 'English (UK)' },
  { value: 'hi', label: 'Hindi' },
]

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION']

function countVariables(text) {
  return new Set([...(text || '').matchAll(/\{\{\d+\}\}/g)].map(m => m[0])).size
}

function previewText(text) {
  return (text || '').replace(/\{\{(\d+)\}\}/g, (_, n) => `[Variable ${n}]`)
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

  return (
    <div className="dashboard-panel">
      <div className="flow-toolbar">
        <button type="button" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync from Meta'}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="panel-muted">{notice}</p>}

      <div className="section-card">
        <h2>Submit a new template</h2>
        <form className="template-form" onSubmit={handleSubmit}>
          <div className="flow-option-row">
            <input type="text" placeholder="Name (e.g. order_update)" value={name} onChange={e => setName(e.target.value)} required />
            <select className="status-select" value={language} onChange={e => setLanguage(e.target.value)}>
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <select className="status-select" value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <textarea
            placeholder="Hi {{1}}, your order {{2}} has shipped."
            value={body}
            onChange={e => setBody(e.target.value)}
            required
          />
          <p className="panel-muted">{variableCount} variable(s) detected. Preview: {previewText(body) || '—'}</p>
          <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit for approval'}</button>
        </form>
      </div>

      <div className="section-card">
        <h2>Your templates</h2>
        {templates.length === 0 ? (
          <p className="panel-muted">No templates yet — submit one above.</p>
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
                </tr>
              </thead>
              <tbody>
                {templates.map(t => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{t.language}</td>
                    <td>{t.category || '—'}</td>
                    <td className="tabular">{t.variable_count}</td>
                    <td>
                      <span className={`badge ${t.status === 'approved' ? 'badge-active' : t.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                        {t.status}
                      </span>
                      {t.status === 'rejected' && t.rejected_reason && (
                        <div className="panel-muted">{t.rejected_reason}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
