# WhatsApp SaaS Platform

Multi-tenant version of the WhatsApp/Groq/Supabase integration — the product
version of what [whatsapp-meta-layer](../ukep/whatsapp-meta-layer) and
[ukep-site](../ukep/ukep-site)'s `/admin` run as a single-business setup.

**Status: schema design, not yet running.** No Supabase project or Netlify
site exists for this yet.

## Relationship to the other two repos

- **ukep-site/`netlify-groq-proxy`** and **whatsapp-meta-layer** — UKEP's own
  live setup. Untouched by this project. Its own Supabase project, its own
  Netlify site, its own WhatsApp number, accessed via `/admin`'s shared
  `ADMIN_TOKEN`.
- **This repo** — a separate product, starting from zero data, meant for
  other businesses to sign up to. Own Supabase project, own Netlify site, own
  WhatsApp numbers per tenant, real per-user login via Supabase Auth. UKEP is
  not a tenant here unless deliberately migrated in later.

## Setup (once you've created the Supabase project)

1. supabase.com/dashboard → New Project → name it, pick a region, set a DB
   password.
2. Project Settings → API → copy the Project URL and `service_role` key into
   a local `.env` here (see `.env.example` once it exists) — don't paste
   them into chat.
3. Paste `supabase/schema.sql` into the new project's SQL Editor and run it
   once. That creates `organizations`, `memberships`, and every operational
   table (contacts, quotes, messages, templates, campaigns...), each scoped
   by `org_id` from the start, with real RLS policies keyed off
   `auth.uid()`.
4. From here: backend edge functions (adapted from `whatsapp-meta-layer`,
   made tenant-aware) and a frontend (adapted from `ukep-site`'s admin
   panels, wired to Supabase Auth instead of a shared token) still need to
   be built — not done yet.

## Design notes

- `organizations.whatsapp_phone_number_id` is how one shared webhook URL
  routes an inbound message to the right tenant — Meta includes this in
  every webhook payload, so no per-tenant webhook URL is needed.
- Onboarding a tenant's own WhatsApp number is still a manual/Meta-side
  process for now (create their Meta app, get their tokens, insert an
  `organizations` row). A self-serve "connect your WhatsApp number" flow
  requires becoming a registered Meta Tech Provider — a commercial step, not
  just code, and out of scope until there's real demand for it.
