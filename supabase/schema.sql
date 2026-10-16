-- Run once in your own Supabase SQL editor to enable optional server-side cloud backups.
-- Existing tasks are left untouched. The app always saves locally first.
create table if not exists public.carecompass_profiles (
  id uuid primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.carecompass_profiles enable row level security;
revoke all on public.carecompass_profiles from anon, authenticated;
grant select, insert, update, delete on public.carecompass_profiles to service_role;
-- No browser policies are created: access is through the local Express server only.
