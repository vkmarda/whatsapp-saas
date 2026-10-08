import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import CampaignForm from '../components/CampaignForm.jsx'

// The quick-action screen: pick a template + recipients, send now. No
// scheduling (that's Campaigns' fuller creation flow) — see CampaignForm.jsx.
// A broadcast still creates a real campaigns row under the hood, so recent
// sends made here show up in Campaigns' history too — this panel's own
// "Recent broadcasts" strip is just a shortcut back to what you just sent.
export default function BroadcastPanel({ orgId, templates, contacts }) {
  const [sentNotice, setSentNotice] = useState(false)
  const [recent, setRecent] = useState([])

  async function loadRecent() {
    const { data } = await supabase
      .from('campaigns').select('*').eq('org_id', orgId)
      .neq('status', 'scheduled').order('created_at', { ascending: false }).limit(5)
    setRecent(data || [])
  }

  useEffect(() => {
    loadRecent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  return (
    <div className="dashboard-panel">
      <div className="section-card">
        <h2>Send a quick broadcast</h2>
        <p className="panel-muted">
          Pick an approved template and a segment of contacts, and send immediately —
          no scheduling. For scheduled or recurring sends, use Campaigns instead.
        </p>
      </div>

      {sentNotice ? (
        <div className="section-card">
          <p className="panel-muted">Broadcast sent — check below or Campaigns for delivery status.</p>
          <button type="button" onClick={() => { setSentNotice(false); loadRecent() }}>Send another</button>
        </div>
      ) : (
        <CampaignForm
          orgId={orgId}
          templates={templates}
          contacts={contacts}
          allowSchedule={false}
          onDone={() => setSentNotice(true)}
        />
      )}

      <div className="section-card">
        <h2>Recent broadcasts</h2>
        {recent.length === 0 ? (
          <p className="panel-muted">Nothing sent from here yet.</p>
        ) : (
          <ul className="conversation-list">
            {recent.map(c => (
              <li key={c.id} className="conversation-row">
                <div className="conversation-main">
                  <span className="conversation-name">{c.label}</span>
                  <span className="conversation-preview">{c.sent_count}/{c.total_recipients} sent{c.failed_count ? `, ${c.failed_count} failed` : ''}</span>
                </div>
                <div className="conversation-meta">
                  <span className={`badge ${c.status === 'completed' ? 'badge-active' : 'badge-warning'}`}>{c.status}</span>
                  <span className="conversation-time">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
