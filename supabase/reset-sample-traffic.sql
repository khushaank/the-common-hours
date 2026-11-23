-- Run in the Supabase SQL Editor after the sample entries and photos are gone.
-- The analytics table has no sample flag. This resets all views and visits
-- recorded so far and keeps a private, one-time backup.
begin;
set local lock_timeout = '10s';
lock table public.qmargin_b74_traffic in share row exclusive mode;

create table if not exists qmargin_b74_private.sample_traffic_20261123 (
  id integer primary key check (id = 1),
  saved_at timestamptz not null default now(),
  rows jsonb not null
);
alter table qmargin_b74_private.sample_traffic_20261123 enable row level security;
revoke all on qmargin_b74_private.sample_traffic_20261123 from public, anon, authenticated;

with backup as (
  insert into qmargin_b74_private.sample_traffic_20261123 (id, rows)
  select 1, coalesce(jsonb_agg(to_jsonb(traffic)), '[]'::jsonb)
  from public.qmargin_b74_traffic traffic
  on conflict (id) do nothing
  returning id
)
delete from public.qmargin_b74_traffic where exists (select 1 from backup);

commit;
