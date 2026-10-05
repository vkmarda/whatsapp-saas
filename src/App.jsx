import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx'
import { useMemberships } from './auth/useMemberships.js'
import { ActiveOrgProvider, useActiveOrg } from './auth/ActiveOrgProvider.jsx'
import LandingPage from './pages/LandingPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import SignUpPage from './pages/SignUpPage.jsx'
import OrgPickerPage from './pages/OrgPickerPage.jsx'
import NoAccessPage from './pages/NoAccessPage.jsx'
import DashboardShell from './pages/DashboardShell.jsx'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicOnly><LandingPage /></PublicOnly>} />
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/signup" element={<PublicOnly><SignUpPage /></PublicOnly>} />
          <Route path="/app/*" element={<RequireAuth><AppGate /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

// Landing/login/signup are for logged-out visitors — a signed-in user
// landing on any of them (e.g. a stale bookmark) goes straight into the app.
function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <FullPageMessage text="Loading…" />
  if (user) return <Navigate to="/app" replace />
  return children
}

// Everything under /app needs a signed-in session — anonymous visitors get
// bounced to login instead of seeing a blank gate.
function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <FullPageMessage text="Loading…" />
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Step 2: which business(es) can this signed-in user access?
function AppGate() {
  const { memberships, loading, error } = useMemberships()

  if (loading) return <FullPageMessage text="Loading your account…" />
  if (error) return <FullPageMessage text={`Couldn't load your account: ${error}`} />
  if (memberships.length === 0) return <NoAccessPage />

  return (
    <ActiveOrgProvider memberships={memberships}>
      <OrgGate memberships={memberships} />
    </ActiveOrgProvider>
  )
}

// Step 3: resolve (or ask for) the active org, then hand off to the app shell.
function OrgGate({ memberships }) {
  const { activeOrgId } = useActiveOrg()

  if (!activeOrgId) {
    if (memberships.length > 1) return <OrgPickerPage memberships={memberships} />
    return <FullPageMessage text="Loading your account…" /> // auto-select is about to land
  }

  return <DashboardShell memberships={memberships} />
}

function FullPageMessage({ text }) {
  return (
    <div className="centered-page">
      <p>{text}</p>
    </div>
  )
}
