import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider.jsx'
import { classifyMediaType, MEDIA_LIMITS } from '../lib/media.js'

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

function StatusTicks({ status }) {
  if (status === 'failed') return <span className="tick tick-failed" title="Failed to send">!</span>
  if (status === 'read') return <span className="tick tick-read" title="Read">✓✓</span>
  if (status === 'delivered') return <span className="tick tick-delivered" title="Delivered">✓✓</span>
  if (status === 'sent') return <span className="tick tick-sent" title="Sent">✓</span>
  return null // no status yet — render nothing, not a placeholder spinner
}

function MediaContent({ mediaType, mediaUrl, caption }) {
  if (mediaType === 'image') return <img className="thread-media-image" src={mediaUrl} alt={caption || 'image'} />
  if (mediaType === 'audio') return <audio className="thread-media-audio" controls src={mediaUrl} />
  if (mediaType === 'video') return <video className="thread-media-video" controls src={mediaUrl} />
  if (mediaType === 'document') return <a className="thread-media-document" href={mediaUrl} target="_blank" rel="noreferrer">📎 Download document</a>
  return null
}

// Feature-detect before ever showing the mic button — Chrome/Edge today only
// expose WEBM/OPUS via MediaRecorder, not the OGG/OPUS container WhatsApp
// voice notes require, and sending a WEBM clip is likely to be silently
// rejected or misplayed rather than show as a proper voice-note bubble. No
// fallback container is used here deliberately — see the Inbox chat upgrade
// plan's note on this specific risk.
function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus'
  return null
}

function ThreadView({ orgId, phone, messages }) {
  const { session } = useAuth()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [replyTarget, setReplyTarget] = useState(null) // { wamid, preview }
  const [recording, setRecording] = useState(false)
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const recorderMimeType = useMemo(() => pickRecorderMimeType(), [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const byWamid = useMemo(() => {
    const map = {}
    for (const m of messages) if (m.wamid) map[m.wamid] = m
    return map
  }, [messages])

  // Every row whose reaction_to_wamid points at another message's wamid
  // becomes a small badge on that target bubble, instead of its own line.
  const reactionsByWamid = useMemo(() => {
    const map = {}
    for (const m of messages) {
      if (m.reaction_to_wamid) {
        const emoji = (m.message || '').replace(/^Reacted\s*/, '') || '👍'
        ;(map[m.reaction_to_wamid] ||= []).push(emoji)
      }
    }
    return map
  }, [messages])

  function jumpToMessage(id) {
    const el = document.getElementById(`msg-${id}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('thread-bubble-jumped')
    setTimeout(() => el.classList.remove('thread-bubble-jumped'), 1200)
  }

  async function sendJson(payload) {
    const res = await fetch('/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Send failed')
    return json
  }

  async function sendMedia(file, mediaType) {
    const form = new FormData()
    form.append('orgId', orgId)
    form.append('to', phone)
    form.append('type', mediaType)
    form.append('caption', draft)
    if (replyTarget) form.append('replyToWamid', replyTarget.wamid)
    form.append('file', file)

    const res = await fetch('/send-message', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` }, // no Content-Type — browser sets the multipart boundary
      body: form,
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Send failed')
    return json
  }

  async function handleSend(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setSendError('')
    try {
      await sendJson({ orgId, to: phone, text, replyToWamid: replyTarget?.wamid })
      setDraft('') // the new message arrives via useOrgData's messages Realtime subscription
      setReplyTarget(null)
    } catch (err) {
      setSendError(err.message)
    } finally {
      setSending(false)
    }
  }

  function handleAttachClick() {
    fileInputRef.current?.click()
  }

  async function handleFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again later
    if (!file) return

    const mediaType = classifyMediaType(file.type)
    const limit = MEDIA_LIMITS[mediaType]
    if (limit?.mimes.length && !limit.mimes.includes(file.type)) {
      setSendError(`Unsupported file type for ${mediaType}: ${file.type}`)
      return
    }
    if (limit && file.size > limit.maxBytes) {
      setSendError(`File too large — max ${Math.round(limit.maxBytes / 1024 / 1024)}MB for ${mediaType}`)
      return
    }

    setSending(true)
    setSendError('')
    try {
      await sendMedia(file, mediaType)
      setDraft('')
      setReplyTarget(null)
    } catch (err) {
      setSendError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function handleMicClick() {
    if (recording) {
      mediaRecorderRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: recorderMimeType })
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: recorderMimeType })
        const file = new File([blob], 'voice-note.ogg', { type: recorderMimeType })
        setSending(true)
        setSendError('')
        try {
          await sendMedia(file, 'audio')
          setReplyTarget(null)
        } catch (err) {
          setSendError(err.message)
        } finally {
          setSending(false)
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (err) {
      setSendError(`Couldn't access microphone: ${err.message}`)
    }
  }

  return (
    <div className="thread-column">
      <div className="thread-messages">
        {messages.map(m => {
          const replyTo = m.reply_to_wamid ? byWamid[m.reply_to_wamid] : null
          const reactions = m.wamid ? reactionsByWamid[m.wamid] : null
          return (
            <div key={m.id} id={`msg-${m.id}`} className={`thread-bubble ${m.direction === 'out' ? 'out' : 'in'}`}>
              {m.reply_to_wamid && (
                <div
                  className="thread-reply-quote"
                  onClick={() => replyTo && jumpToMessage(replyTo.id)}
                  style={{ cursor: replyTo ? 'pointer' : 'default' }}
                >
                  {replyTo ? (replyTo.message || '[media]') : 'Original message'}
                </div>
              )}
              {m.media_url ? (
                <div className="thread-bubble-media">
                  <MediaContent mediaType={m.media_type} mediaUrl={m.media_url} caption={m.message} />
                  {m.message && <div className="thread-bubble-text">{m.message}</div>}
                </div>
              ) : (
                <div className="thread-bubble-text">{m.message}</div>
              )}
              <div className="thread-bubble-time">
                {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {m.direction === 'out' && <StatusTicks status={m.status} />}
              </div>
              {reactions?.length > 0 && <span className="thread-reaction-badge">{reactions.join(' ')}</span>}
              <button type="button" className="thread-bubble-reply-btn" onClick={() => setReplyTarget({ wamid: m.wamid, preview: m.message || '[media]' })} title="Reply">↩</button>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {replyTarget && (
        <div className="thread-reply-banner">
          <span>Replying to: {replyTarget.preview}</span>
          <button type="button" className="link-button" onClick={() => setReplyTarget(null)}>✕</button>
        </div>
      )}

      <form className="thread-reply" onSubmit={handleSend}>
        <input ref={fileInputRef} type="file" hidden onChange={handleFileChosen} />
        <button type="button" className="thread-attach-btn" onClick={handleAttachClick} disabled={sending} title="Attach a file">📎</button>
        {recorderMimeType ? (
          <button type="button" className={`thread-mic-btn ${recording ? 'recording' : ''}`} onClick={handleMicClick} disabled={sending} title={recording ? 'Stop recording' : 'Record a voice note'}>
            {recording ? '⏹' : '🎤'}
          </button>
        ) : (
          <button type="button" className="thread-mic-btn" disabled title="Voice notes aren't supported in this browser yet — try Firefox, or attach an audio file instead">🎤</button>
        )}
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
