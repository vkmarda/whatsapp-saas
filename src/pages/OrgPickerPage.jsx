import { useActiveOrg } from '../auth/ActiveOrgProvider.jsx'
import { useAuth } from '../auth/AuthProvider.jsx'

// Shown only when a user belongs to more than one org (e.g. an agency
// managing several businesses) — a single-org user is auto-routed past this
// by ActiveOrgProvider.
export default function OrgPickerPage({ memberships }) {
  const { setActiveOrgId } = useActiveOrg()
  const { signOut } = useAuth()

  return (
    <div className="centered-page">
      <div className="auth-box">
        <h1>Choose a business</h1>
        {memberships.map(m => (
          <button key={m.org_id} type="button" className="org-picker-item" onClick={() => setActiveOrgId(m.org_id)}>
            <span>{m.organizations.name}</span>
            <span className="org-picker-role">{m.role}</span>
          </button>
        ))}
        <button type="button" className="link-button" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
