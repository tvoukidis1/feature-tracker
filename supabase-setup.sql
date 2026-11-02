-- Feature tracker: run once in Supabase > SQL Editor > New query > Run

create table if not exists public.feature_requests (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  requested_by    text,
  assigned_to     text,
  status          text not null default 'Request'
                  check (status in ('Request','Accepted','In Development','Complete')),
  expected_date   date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text
);

-- keep updated_at fresh on every edit
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists feature_requests_touch on public.feature_requests;
create trigger feature_requests_touch
  before update on public.feature_requests
  for each row execute function public.touch_updated_at();

-- Security: only signed-in users can read or change anything.
-- Turn off public sign-ups in Authentication > Providers > Email so only
-- people you invite (Authentication > Users > Invite) can get in.
alter table public.feature_requests enable row level security;

drop policy if exists "team can read"   on public.feature_requests;
drop policy if exists "team can insert" on public.feature_requests;
drop policy if exists "team can update" on public.feature_requests;
drop policy if exists "team can delete" on public.feature_requests;

create policy "team can read"   on public.feature_requests for select to authenticated using (true);
create policy "team can insert" on public.feature_requests for insert to authenticated with check (true);
create policy "team can update" on public.feature_requests for update to authenticated using (true) with check (true);
create policy "team can delete" on public.feature_requests for delete to authenticated using (true);

-- live updates so teammates see each other's changes without refreshing
alter publication supabase_realtime add table public.feature_requests;
