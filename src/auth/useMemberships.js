import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from './AuthProvider.jsx'

// Which businesses the signed-in user can access, and their role in each.
// No org_id filter is applied here — RLS ("members can see their own
// memberships" / "...their own org") already scopes both tables to
// auth.uid(), so this is exactly the set the user is allowed to see.
export function useMemberships() {
  const { user } = useAuth()
  const [memberships, setMemberships] = useState(undefined) // undefined = loading
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!user) {
      setMemberships([])
      return
    }
    const { data, error } = await supabase
      .from('memberships')
      .select('role, org_id, organizations ( id, name, slug, status )')
    if (error) {
      setError(error.message)
      setMemberships([])
      return
    }
    setError('')
    setMemberships(data || [])
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { memberships, loading: memberships === undefined, error, refresh }
}
