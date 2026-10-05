-- Run this once in the whatsapp-saas Supabase project's SQL editor.
-- Column-level hardening on organizations: RLS's "members can see their own
-- org" policy controls which ROWS an authenticated tenant user can read, but
-- says nothing about which COLUMNS — a careless `select('*')` from the
-- frontend would otherwise hand back whatsapp_access_token,
-- whatsapp_webhook_verify_token, and groq_api_key straight to the browser.
-- This closes that off at the database level, independent of frontend
-- discipline, by only granting SELECT on the columns a tenant should ever see.
-- service_role (used by edge functions) is untouched — Supabase grants it
-- full table access separately, and this only revokes from `authenticated`.

revoke select on organizations from authenticated;
grant select (id, name, slug, status, bot_config, created_at, updated_at) on organizations to authenticated;
