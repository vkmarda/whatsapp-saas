import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient.js'

// Fetched once per org (on login / org switch) and kept live via Realtime —
// this is what makes switching nav tabs, and switching Inbox threads, instant
// instead of re-fetching (and flashing "Loading…") every time. Note: this
// pulls every message for the org into memory up front — fine at today's
// volume, but a tenant with a large message history will eventually need
// this windowed/paginated rather than fetched whole.
export function useOrgData(orgId) {
  const [contacts, setContacts] = useState([])
  const [quotes, setQuotes] = useState([])
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadContacts = useCallback(async () => {
    const { data, error } = await supabase.from('contacts').select('*').eq('org_id', orgId).order('updated_at', { ascending: false })
    if (!error) setContacts(data || [])
  }, [orgId])

  const loadQuotes = useCallback(async () => {
    const { data, error } = await supabase.from('quotes').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
    if (!error) setQuotes(data || [])
  }, [orgId])

  const loadConversations = useCallback(async () => {
    const { data, error } = await supabase.from('conversations').select('*').eq('org_id', orgId).order('timestamp', { ascending: false })
    if (!error) setConversations(data || [])
  }, [orgId])

  const loadMessages = useCallback(async () => {
    const { data, error } = await supabase.from('messages').select('*').eq('org_id', orgId).order('created_at', { ascending: true })
    if (!error) setMessages(data || [])
  }, [orgId])

  const loadTemplates = useCallback(async () => {
    const { data, error } = await supabase.from('templates').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
    if (!error) setTemplates(data || [])
  }, [orgId])

  useEffect(() => {
    let cancelled = false

    async function loadAll() {
      setLoading(true)
      setError('')
      const results = await Promise.allSettled([loadContacts(), loadQuotes(), loadConversations(), loadMessages(), loadTemplates()])
      if (cancelled) return
      const firstRejection = results.find(r => r.status === 'rejected')
      if (firstRejection) setError(firstRejection.reason?.message || 'Failed to load org data')
      setLoading(false)
    }
    loadAll()

    const contactsChannel = supabase
      .channel(`org-data-contacts-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter: `org_id=eq.${orgId}` }, () => loadContacts())
      .subscribe()

    const quotesChannel = supabase
      .channel(`org-data-quotes-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes', filter: `org_id=eq.${orgId}` }, () => loadQuotes())
      .subscribe()

    // A new message extends its thread's cache (appended directly, cheap)
    // and changes that phone's latest-message preview in the conversations
    // view (re-fetched, since `conversations` is a view and can't be
    // patched locally the way a plain row-append can). An UPDATE — a status
    // webhook flipping sent/delivered/read/failed on an *existing* row, or
    // logIncomingMessage finishing a media download after the row was
    // already inserted — has to patch that row in place, not append a
    // duplicate; without this branch the tick-mark/media UI would only ever
    // reflect whatever the row looked like at the instant it was inserted.
    const messagesChannel = supabase
      .channel(`org-data-messages-${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `org_id=eq.${orgId}` }, payload => {
        setMessages(prev => [...prev, payload.new])
        loadConversations()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `org_id=eq.${orgId}` }, payload => {
        setMessages(prev => prev.map(m => m.id === payload.new.id ? payload.new : m))
        loadConversations()
      })
      .subscribe()

    const templatesChannel = supabase
      .channel(`org-data-templates-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'templates', filter: `org_id=eq.${orgId}` }, () => loadTemplates())
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(contactsChannel)
      supabase.removeChannel(quotesChannel)
      supabase.removeChannel(messagesChannel)
      supabase.removeChannel(templatesChannel)
    }
  }, [orgId, loadContacts, loadQuotes, loadConversations, loadMessages, loadTemplates])

  const messagesByPhone = useMemo(() => {
    const map = {}
    for (const m of messages) {
      if (!map[m.phone]) map[m.phone] = []
      map[m.phone].push(m)
    }
    return map
  }, [messages])

  return {
    contacts, setContacts,
    quotes,
    conversations,
    messagesByPhone,
    messagesCount: messages.length,
    templates, setTemplates,
    loading, error,
  }
}
