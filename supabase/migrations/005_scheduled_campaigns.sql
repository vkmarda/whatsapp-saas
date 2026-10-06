-- Run this once in the whatsapp-saas Supabase project's SQL editor.
-- A campaign can be created for future delivery instead of sending
-- immediately: campaigns.status gets a new value 'scheduled', and
-- scheduled_at holds when send-scheduled-campaigns.js (a Netlify Scheduled
-- Function, Node runtime — separate from the Deno edge functions) should
-- start working through that campaign's recipients.
alter table campaigns add column if not exists scheduled_at timestamptz;
create index if not exists idx_campaigns_scheduled on campaigns(scheduled_at) where status = 'scheduled';
