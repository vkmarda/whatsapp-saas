-- Run this once in the whatsapp-saas Supabase project's SQL editor.
-- Supabase's Realtime server only streams postgres_changes for tables
-- explicitly added to the supabase_realtime publication — RLS still governs
-- who can see which rows, this just turns on the live-update feed at all.
-- Needed for the Contacts/Leads/Quotes/Inbox panels' live subscriptions.

alter publication supabase_realtime add table contacts;
alter publication supabase_realtime add table quotes;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversation_state;
