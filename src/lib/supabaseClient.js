import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — check .env')
}

// The anon key is safe to ship to the browser — it only grants whatever RLS
// policies allow for the signed-in user. Never put the service role key here.
export const supabase = createClient(url, anonKey)
