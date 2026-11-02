-- One-time update: adds the "Expected start" date.
-- Supabase > SQL Editor > New query > paste > Run. Safe to run more than once.
alter table public.feature_requests add column if not exists start_date date;
