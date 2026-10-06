import { useState } from 'react'
import {
  LayoutDashboard, Inbox as InboxIcon, Users, Megaphone,
  ClipboardList, Receipt, BarChart3, LogOut, Workflow, FileText,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useActiveOrg } from '../auth/ActiveOrgProvider.jsx'
import { useOrgData } from '../hooks/useOrgData.js'
import DashboardPanel from './DashboardPanel.jsx'
import InboxPanel from './InboxPanel.jsx'
import ContactsPanel from './ContactsPanel.jsx'
import QuotesPanel from './QuotesPanel.jsx'
import FlowBuilderPanel from './FlowBuilderPanel.jsx'
import BroadcastPanel from './BroadcastPanel.jsx'
import CampaignsPanel from './CampaignsPanel.jsx'
import TemplatesPanel from './TemplatesPanel.jsx'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'leads', label: 'Leads', icon: ClipboardList },
  { id: 'quotes', label: 'Quotes', icon: Receipt },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'flow-builder', label: 'Flow Builder', icon: Workflow },
  { id: 'broadcast', label: 'Broadcast', icon: Megaphone },
  { id: 'campaigns', label: 'Campaigns', icon: BarChart3 },
  { id: 'templates', label: 'Templates', icon: FileText },
]

// The sidebar/content frame every tenant's admin screens mount into.
// Panels themselves (Inbox, Leads, Broadcast, ...) aren't built yet — this
// is just the shell + nav + org context plumbing.
export default function DashboardShell({ memberships }) {
  const { signOut } = useAuth()
  const { activeOrgId, activeMembership, setActiveOrgId } = useActiveOrg()
  const [view, setView] = useState('dashboard')
  const orgData = useOrgData(activeOrgId) // fetched once here, shared across every panel below

  const org = activeMembership?.organizations
  const activeLabel = NAV_ITEMS.find(n => n.id === view)?.label || 'Dashboard'

  return (
    <div className="app-shell">
      <nav className="app-sidebar">
        <div className="app-sidebar-brand">{org?.name || 'WhatsApp SaaS'}</div>

        {memberships.length > 1 && (
          <select
            className="app-org-switcher"
            value={activeOrgId || ''}
            onChange={e => setActiveOrgId(e.target.value)}
          >
            {memberships.map(m => (
              <option key={m.org_id} value={m.org_id}>{m.organizations.name}</option>
            ))}
          </select>
        )}

        {NAV_ITEMS.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              className={`app-nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
            >
              <Icon size={17} />
              {item.label}
            </button>
          )
        })}

        <button type="button" className="app-nav-item app-signout" onClick={signOut}>
          <LogOut size={17} />
          Sign out
        </button>
      </nav>

      <div className="app-content">
        <div className="app-header">
          <h1>{activeLabel}</h1>
          {activeMembership && <span className="app-role-badge">{activeMembership.role}</span>}
        </div>
        {orgData.loading ? (
          <p className="panel-muted">Loading your data…</p>
        ) : orgData.error ? (
          <p className="form-error">Couldn't load org data: {orgData.error}</p>
        ) : view === 'dashboard' ? (
          <DashboardPanel contacts={orgData.contacts} quotes={orgData.quotes} conversations={orgData.conversations} messagesCount={orgData.messagesCount} />
        ) : view === 'inbox' ? (
          <InboxPanel orgId={activeOrgId} conversations={orgData.conversations} messagesByPhone={orgData.messagesByPhone} />
        ) : view === 'leads' ? (
          <ContactsPanel contacts={orgData.contacts} setContacts={orgData.setContacts} scope="leads" />
        ) : view === 'contacts' ? (
          <ContactsPanel contacts={orgData.contacts} setContacts={orgData.setContacts} scope="all" />
        ) : view === 'quotes' ? (
          <QuotesPanel quotes={orgData.quotes} />
        ) : view === 'flow-builder' ? (
          <FlowBuilderPanel orgId={activeOrgId} />
        ) : view === 'broadcast' ? (
          <BroadcastPanel orgId={activeOrgId} templates={orgData.templates} contacts={orgData.contacts} />
        ) : view === 'campaigns' ? (
          <CampaignsPanel orgId={activeOrgId} templates={orgData.templates} contacts={orgData.contacts} />
        ) : view === 'templates' ? (
          <TemplatesPanel orgId={activeOrgId} templates={orgData.templates} />
        ) : null}
      </div>
    </div>
  )
}
