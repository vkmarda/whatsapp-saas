import { createContext, useContext, useEffect, useState } from 'react'

const ActiveOrgContext = createContext(null)
const STORAGE_KEY = 'wa-saas-active-org-id'

// Tracks which of the user's orgs is active, persisted across visits.
// Auto-selects when there's exactly one — a solo-tenant user should never
// see an org picker. Drops a stale selection (revoked access, or a leftover
// value from a previous account on this browser) rather than trusting it.
export function ActiveOrgProvider({ memberships, children }) {
  const [activeOrgId, setActiveOrgIdState] = useState(() => localStorage.getItem(STORAGE_KEY))

  function setActiveOrgId(orgId) {
    setActiveOrgIdState(orgId)
    if (orgId) localStorage.setItem(STORAGE_KEY, orgId)
    else localStorage.removeItem(STORAGE_KEY)
  }

  useEffect(() => {
    const stillValid = activeOrgId && memberships.some(m => m.org_id === activeOrgId)
    if (stillValid) return
    if (memberships.length === 1) {
      setActiveOrgId(memberships[0].org_id)
    } else if (activeOrgId) {
      setActiveOrgId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberships, activeOrgId])

  const activeMembership = memberships.find(m => m.org_id === activeOrgId) || null

  return (
    <ActiveOrgContext.Provider value={{ activeOrgId, activeMembership, setActiveOrgId }}>
      {children}
    </ActiveOrgContext.Provider>
  )
}

export function useActiveOrg() {
  const ctx = useContext(ActiveOrgContext)
  if (!ctx) throw new Error('useActiveOrg must be used within ActiveOrgProvider')
  return ctx
}
