import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import CampaignForm from '../components/CampaignForm.jsx'

// Own local fetch (single-reader, same reasoning as FlowBuilderPanel's
// flows table) — campaigns aren't read anywhere else in the dashboard.
export default function CampaignsPanel({ orgId, templates, contacts }) {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [recipients, setRecipients] = useState([])

  async function loadCampaigns() {
    const { data } = await supabase.from('campaigns').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
    setCampaigns(data || [])
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadCampaigns().finally(() => { if (!cancelled) setLoading(false) })

    const channel = supabase
      .channel(`campaigns-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns', filter: `org_id=eq.${orgId}` }, () => loadCampaigns())
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function toggleExpand(campaign) {
    if (expandedId === campaign.id) { setExpandedId(null); return }
    const { data } = await supabase.from('campaign_recipients').select('*').eq('campaign_id', campaign.id).order('created_at', { ascending: true })
    setRecipients(data || [])
    setExpandedId(campaign.id)
  }

  function templateName(id) {
    return templates.find(t => t.id === id)?.name || '—'
  }

  if (loading) return <p className="panel-muted">Loading…</p>

  return (
    <div className="dashboard-panel">
      <div className="flow-toolbar">
        <button type="button" onClick={() => setShowForm(v => !v)}>{showForm ? 'Cancel' : '+ New campaign'}</button>
      </div>

      {showForm && (
        <div className="section-card">
          <CampaignForm
            orgId={orgId} templates={templates} contacts={contacts} allowSchedule={true}
            onDone={() => { setShowForm(false); loadCampaigns() }}
          />
        </div>
      )}

      {campaigns.length === 0 ? (
        <p className="panel-muted">No campaigns yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Template</th>
                <th>Status</th>
                <th>Sent / Total</th>
                <th>Failed</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <Fragment key={c.id}>
                  <tr onClick={() => toggleExpand(c)} className="clickable-row">
                    <td>{c.label}</td>
                    <td>{templateName(c.template_id)}</td>
                    <td><span className="badge badge-warning">{c.status}</span></td>
                    <td className="tabular">{c.sent_count} / {c.total_recipients}</td>
                    <td className="tabular">{c.failed_count}</td>
                    <td className="panel-muted">{new Date(c.created_at).toLocaleString()}</td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={6}>
                        <div className="table-scroll">
                          <table className="data-table">
                            <thead>
                              <tr><th>Phone</th><th>Name</th><th>Status</th><th>Error</th></tr>
                            </thead>
                            <tbody>
                              {recipients.map(r => (
                                <tr key={r.id}>
                                  <td className="tabular">{r.phone}</td>
                                  <td>{r.name || '—'}</td>
                                  <td><span className={`badge ${r.status === 'sent' ? 'badge-active' : r.status === 'failed' ? 'badge-danger' : 'badge-warning'}`}>{r.status}</span></td>
                                  <td className="truncate-cell">{r.error || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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
  )
}
