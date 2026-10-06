-- Run this once in the whatsapp-saas Supabase project's SQL editor.
-- Flow Builder: a per-org, step-based bot flow that, when active, takes
-- over whatsapp-webhook.js's routing entirely for that org, replacing the
-- hardcoded menu/quote flow. An org with no row here, or a row with
-- is_active = false, is completely unaffected — the hardcoded flow keeps
-- running exactly as before (see whatsapp-webhook.js's ctx.flow check).
--
-- One flow per org in v1, hence `unique (org_id)` rather than tracking
-- "which of several rows is active" separately. draft_steps is what the
-- Flow Builder UI edits live; published_steps is a frozen snapshot only
-- replaced by an explicit Publish action, so an in-progress edit never
-- affects a conversation that's already mid-flow. is_active is a separate
-- on/off switch so a published flow can be paused without losing it.
create table flows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade unique,
  name text not null default 'Main Flow',
  is_active boolean not null default false,
  draft_steps jsonb not null default '[]'::jsonb,
  published_steps jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table flows enable row level security;
create policy "members can access their org's flows" on flows
  for all using (org_id in (select org_id from memberships where user_id = auth.uid()));
