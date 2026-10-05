import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

const STATUS_OPTIONS = ['New', 'Quote Requested', 'Contacted', 'Won', 'Lost']

// Shared by the Leads and Contacts nav items — same underlying list (passed
// down from useOrgData, fetched once at login), just a different default
// slice. "Leads" = contacts who haven't requested a quote yet.
export default function ContactsPanel({ contacts, setContacts, scope }) {
  const [search, setSearch] = useState('')

  const scoped = scope === 'leads' ? contacts.filter(c => c.status === 'New') : contacts

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return scoped
    return scoped.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.company || '').toLowerCase().includes(q))
  }, [scoped, search])

  async function updateStatus(contact, status) {
    setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, status } : c)) // optimistic
    const { error } = await supabase.from('contacts').update({ status }).eq('id', contact.id)
    if (error) console.error('updateStatus failed', error.message) // the contacts Realtime subscription reconciles either way
  }

  return (
    <div className="dashboard-panel">
      <input
        type="search"
        className="search-input"
        placeholder="Search by name, phone, or company…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <p className="panel-muted">{scoped.length === 0 ? 'No contacts yet.' : 'No matches.'}</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Company</th>
                <th>City</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td>{c.name || '—'}</td>
                  <td className="tabular">{c.phone}</td>
                  <td>{c.company || '—'}</td>
                  <td>{c.city || '—'}</td>
                  <td>
                    <select value={c.status} onChange={e => updateStatus(c, e.target.value)} className="status-select">
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="panel-muted">{new Date(c.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
