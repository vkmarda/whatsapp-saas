-- Run this once in the whatsapp-saas Supabase project's SQL editor.
-- Both matched by wamid (same loose-matching convention
-- updateMessageStatusByWamid already uses for status) — no FK, since the
-- target message may not exist in our table (sent before this existed, or
-- never captured).
alter table messages add column if not exists reply_to_wamid text;
alter table messages add column if not exists reaction_to_wamid text;

create index if not exists idx_messages_reply_to_wamid on messages(reply_to_wamid) where reply_to_wamid is not null;
create index if not exists idx_messages_reaction_to_wamid on messages(reaction_to_wamid) where reaction_to_wamid is not null;

-- No realtime publication change needed — messages is already in
-- supabase_realtime (003_enable_realtime.sql); new columns ride along.
