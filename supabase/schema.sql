-- Multi-tenant WhatsApp platform — Supabase schema (DRAFT, not yet applied).
-- Run this once in the new Supabase project's SQL editor once it exists.
--
-- Adapted from ukep-site/netlify-groq-proxy's single-tenant schema. Same
-- feature set (contacts, quotes, conversation state, templates, campaigns,
-- messages), but every operational table now carries org_id from day one —
-- no retrofit, no backfill, because this is a fresh database with no
-- existing rows. UKEP's own Supabase project is untouched by this file.

create extension if not exists pgcrypto;

-- ── Tenancy ──────────────────────────────────────────────────────────────
-- One row per business using the platform. WhatsApp credentials live here
-- per-org rather than as global env vars — each business connects its own
-- WhatsApp Business number. whatsapp_phone_number_id is how an inbound
-- webhook (Meta sends this in every payload) gets routed to the right org
-- without needing a separate webhook URL per tenant.
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,                    -- URL-friendly, e.g. for a future org-scoped login page
  whatsapp_phone_number_id text unique,          -- null until the business connects WhatsApp
  whatsapp_business_account_id text,
  whatsapp_access_token text,
  whatsapp_webhook_verify_token text,
  groq_api_key text,                             -- null = falls back to a platform-wide shared key
  status text not null default 'active',         -- active | suspended
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Links a Supabase Auth user to the org(s) they can access. One person could
-- belong to more than one org (e.g. an agency managing several businesses),
-- hence a join table rather than a column on auth.users.
create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  role text not null default 'staff',            -- owner | admin | staff
  created_at timestamptz not null default now(),
  unique (user_id, org_id)
);
create index idx_memberships_user on memberships(user_id);

-- ── Operational tables (mirrors ukep-site's schema, org_id added) ─────────

create table contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  phone text not null,
  name text,
  source text not null default 'manual',
  notes text,
  tags text[] not null default '{}',
  status text not null default 'New',
  company text,
  email text,
  product_interest text,
  city text,
  business_type text,
  designation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, phone)                          -- same phone can be a contact of two different businesses
);
create index idx_contacts_org on contacts(org_id);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid references contacts(id),
  phone text not null,
  name text,
  company text,
  email text,
  product text,
  quantity text,
  message text,
  created_at timestamptz not null default now()
);
create index idx_quotes_org_phone on quotes(org_id, phone);

-- Primary key is now (org_id, phone) — the same phone number can be mid-
-- conversation with two different businesses' bots at once, each needing
-- its own independent FSM state.
create table conversation_state (
  org_id uuid not null references organizations(id) on delete cascade,
  phone text not null,
  step text not null default 'new',
  data jsonb not null default '{}'::jsonb,
  last_welcome_at timestamptz,
  needs_review boolean not null default false,
  last_intent text,
  conversation_status text not null default 'open',
  updated_at timestamptz not null default now(),
  primary key (org_id, phone)
);

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  phone text not null,
  type text not null,
  summary text not null,
  created_at timestamptz not null default now()
);
create index idx_activity_log_org_phone on activity_log(org_id, phone, created_at);

create table saved_replies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  label text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index idx_saved_replies_org on saved_replies(org_id);

create table templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  language text not null default 'en_US',
  category text,
  variable_count int not null default 0,
  variable_labels text[],
  body_preview text,
  header_format text,
  created_at timestamptz not null default now(),
  unique (org_id, name, language)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  template_id uuid not null references templates(id),
  label text not null,
  status text not null default 'draft',
  total_recipients int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index idx_campaigns_org on campaigns(org_id);

create table campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  contact_id uuid references contacts(id),
  phone text not null,
  name text,
  variables jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  wamid text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, phone)
);
create index idx_campaign_recipients_campaign on campaign_recipients(campaign_id);

-- wamid stays globally unique (not per-org) — it's Meta's own message id,
-- inherently unique across the whole system regardless of which org's
-- number sent it.
create table messages (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  phone text not null,
  direction text not null,
  message text not null default '',
  phone_number_id text,
  name text,
  wamid text,
  status text,
  status_updated_at timestamptz,
  intent text,
  media_url text,
  media_type text,
  error jsonb,
  campaign_id uuid references campaigns(id),
  created_at timestamptz not null default now()
);
create index idx_messages_org_phone_created on messages(org_id, phone, created_at);
create unique index idx_messages_wamid on messages(wamid) where wamid is not null;
create index idx_messages_campaign on messages(campaign_id) where campaign_id is not null;

create view conversations as
  select distinct on (m.org_id, m.phone) m.org_id, m.phone, m.direction, m.message, m.phone_number_id, m.name, m.status,
         m.created_at as timestamp, coalesce(cs.needs_review, false) as needs_review, cs.last_intent,
         coalesce(cs.conversation_status, 'open') as conversation_status
  from messages m
  left join conversation_state cs on cs.org_id = m.org_id and cs.phone = m.phone
  order by m.org_id, m.phone, m.created_at desc;

-- ── Row Level Security ──────────────────────────────────────────────────
-- Real policies this time (UKEP's schema has RLS enabled with zero
-- policies — decorative, since only the service-role key is ever used
-- there). This platform has real per-user Supabase Auth sessions, so RLS
-- is actual defense in depth: even if a bug in the app layer forgot an
-- org_id filter, the database itself would still refuse cross-org access
-- for anything running as an authenticated user (not the service role,
-- which still bypasses RLS by design for the edge functions' own use).

alter table organizations enable row level security;
alter table memberships enable row level security;
alter table contacts enable row level security;
alter table quotes enable row level security;
alter table conversation_state enable row level security;
alter table activity_log enable row level security;
alter table saved_replies enable row level security;
alter table templates enable row level security;
alter table campaigns enable row level security;
alter table campaign_recipients enable row level security;
alter table messages enable row level security;

create policy "members can see their own org" on organizations
  for select using (id in (select org_id from memberships where user_id = auth.uid()));

create policy "members can see their own memberships" on memberships
  for select using (user_id = auth.uid());

create policy "members can access their org's contacts" on contacts
  for all using (org_id in (select org_id from memberships where user_id = auth.uid()));
create policy "members can access their org's quotes" on quotes
  for all using (org_id in (select org_id from memberships where user_id = auth.uid()));
create policy "members can access their org's conversation_state" on conversation_state
  for all using (org_id in (select org_id from memberships where user_id = auth.uid()));
create policy "members can access their org's activity_log" on activity_log
  for all using (org_id in (select org_id from memberships where user_id = auth.uid()));
create policy "members can access their org's saved_replies" on saved_replies
  for all using (org_id in (select org_id from memberships where user_id = auth.uid()));
create policy "members can access their org's templates" on templates
  for all using (org_id in (select org_id from memberships where user_id = auth.uid()));
create policy "members can access their org's campaigns" on campaigns
  for all using (org_id in (select org_id from memberships where user_id = auth.uid()));
create policy "members can access their org's campaign_recipients" on campaign_recipients
  for all using (org_id in (select org_id from memberships where user_id = auth.uid()));
create policy "members can access their org's messages" on messages
  for all using (org_id in (select org_id from memberships where user_id = auth.uid()));
