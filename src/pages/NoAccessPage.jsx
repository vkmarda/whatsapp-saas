import { useAuth } from '../auth/AuthProvider.jsx'

// Reached when a signed-in Supabase Auth user has no row in `memberships` —
// expected only for a misconfigured account, since access is provisioned by
// us (see organizations' RLS: only the service role can create orgs).
export default function NoAccessPage() {
  const { signOut, user } = useAuth()

  return (
    <div className="centered-page">
      <div className="auth-box">
        <h1>No access yet</h1>
        <p>
          {user?.email} isn't linked to a business on this platform yet.
          Contact support to get set up.
        </p>
        <button type="button" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
