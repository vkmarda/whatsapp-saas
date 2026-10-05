import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider.jsx'

// conversations and messagesByPhone both come from useOrgData (fetched once
// at login, kept live via Realtime) — this panel and ThreadView are now
// purely presentational, so switching threads is instant, same as switching
// nav tabs.
export default function InboxPanel({ orgId, conversations, messagesByPhone }) {
  const [selectedPhone, setSelectedPhone] = useState(null)

  return (
    <div className="inbox-layout">
      <div className="inbox-list">
        {conversations.length === 0 ? (
          <p className="panel-muted">No conversations yet.</p>
        ) : conversations.map(c => (
          <button
            key={c.phone}
            type="button"
            className={`inbox-row ${selectedPhone === c.phone ? 'active' : ''}`}
            onClick={() => setSelectedPhone(c.phone)}
          >
            <div className="inbox-row-main">
              <span className="conversation-name">{c.name || c.phone}</span>
              <span className="conversation-preview">{c.direction === 'out' ? 'You: ' : ''}{c.message}</span>
            </div>
            {c.needs_review && <span className="badge badge-warning">Needs review</span>}
          </button>
        ))}
      </div>

      <div className="inbox-thread">
        {selectedPhone ? (
          <ThreadView orgId={orgId} phone={selectedPhone} messages={messagesByPhone[selectedPhone] || []} />
        ) : (
          <p className="panel-muted">Select a conversation.</p>
        )}
      </div>
    </div>
  )
}

function ThreadView({ orgId, phone, messages }) {
  const { session } = useAuth()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  async function handleSend(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setSendError('')
    try {
      const res = await fetch('/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ orgId, to: phone, text }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Send failed')
      setDraft('') // the new message arrives via useOrgData's messages Realtime subscription
    } catch (err) {
      setSendError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="thread-column">
      <div className="thread-messages">
        {messages.map(m => (
          <div key={m.id} className={`thread-bubble ${m.direction === 'out' ? 'out' : 'in'}`}>
            <div className="thread-bubble-text">{m.message}</div>
            <div className="thread-bubble-time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="thread-reply" onSubmit={handleSend}>
        <input
          type="text"
          placeholder="Type a reply…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      </form>
      {sendError && <p className="form-error">{sendError}</p>}
    </div>
  )
}

