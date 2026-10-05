-- Run this once in the whatsapp-saas Supabase project's SQL editor.
-- Per-tenant bot content (welcome message, product list, catalog URL, sales
-- contact) — without this, the webhook would have nowhere to pull
-- tenant-specific text from except hardcoding it, which is exactly the
-- single-tenant mistake this platform exists to avoid repeating.
alter table organizations add column if not exists bot_config jsonb not null default '{}'::jsonb;
