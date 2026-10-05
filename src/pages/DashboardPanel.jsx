// Pure presentational now — data comes from useOrgData (fetched once at
// login and kept live), not its own fetch. See src/hooks/useOrgData.js.
export default function DashboardPanel({ contacts, quotes, conversations, messagesCount }) {
  return (
    <div className="dashboard-panel">
      <div className="stat-row">
        <StatTile label="Contacts" value={contacts.length} />
        <StatTile label="Quotes" value={quotes.length} />
        <StatTile label="Messages" value={messagesCount} />
      </div>

      <div className="section-card">
        <h2>Recent conversations</h2>
        {conversations.length === 0 ? (
          <p className="panel-muted">No conversations yet — once your WhatsApp number receives a message, it'll show up here.</p>
        ) : (
          <ul className="conversation-list">
            {conversations.slice(0, 10).map(c => (
              <li key={c.phone} className="conversation-row">
                <div className="conversation-main">
                  <span className="conversation-name">{c.name || c.phone}</span>
                  <span className="conversation-preview">{c.direction === 'out' ? 'You: ' : ''}{c.message}</span>
                </div>
                <div className="conversation-meta">
                  {c.needs_review && <span className="badge badge-warning">Needs review</span>}
                  <span className="conversation-time">{relativeTime(c.timestamp)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value }) {
  return (
    <div className="stat-tile">
      <span className="stat-value">{value.toLocaleString()}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function relativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
