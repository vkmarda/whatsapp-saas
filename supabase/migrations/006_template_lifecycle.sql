-- Run this once in the whatsapp-saas Supabase project's SQL editor.
-- Templates can now be created from inside this platform's own UI and
-- submitted to Meta for review (POST .../message_templates), not just
-- synced read-only after the fact. Meta's review is asynchronous with no
-- webhook for the result, so status starts 'pending' and only updates when
-- a user clicks "Sync from Meta" (see broadcast.js's sync_templates_from_meta).
alter table templates add column if not exists status text not null default 'pending';
alter table templates add column if not exists rejected_reason text;
alter table templates add column if not exists meta_template_id text;
alter table templates add constraint templates_status_check
  check (status in ('pending', 'approved', 'rejected'));
create index if not exists idx_templates_org_status on templates(org_id, status);

-- Needed so useOrgData's live subscription actually fires when
-- sync_templates_from_meta upserts a status change (pending -> approved
-- etc.) — see 003_enable_realtime.sql, which didn't cover this table since
-- it didn't have a UI yet at the time.
alter publication supabase_realtime add table templates;
