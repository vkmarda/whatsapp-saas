import { useState } from 'react'
import CampaignForm from '../components/CampaignForm.jsx'

// The quick-action screen: pick a template + recipients, send now. No
// scheduling (that's Campaigns' fuller creation flow) — see CampaignForm.jsx.
export default function BroadcastPanel({ orgId, templates, contacts }) {
  const [sentNotice, setSentNotice] = useState(false)

  if (sentNotice) {
    return (
      <div className="dashboard-panel">
        <p className="panel-muted">Broadcast sent — check Campaigns for delivery status.</p>
        <button type="button" onClick={() => setSentNotice(false)}>Send another</button>
      </div>
    )
  }

  return (
    <CampaignForm
      orgId={orgId}
      templates={templates}
      contacts={contacts}
      allowSchedule={false}
      onDone={() => setSentNotice(true)}
    />
  )
}
