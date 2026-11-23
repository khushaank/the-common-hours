-- Remove requests sent from the reserved example.com domain.
-- The backup contains the exact rows deleted in this transaction.
begin;
create table if not exists qmargin_b74_private.sample_inbox_backup (
  id uuid primary key, saved_at timestamptz not null default now(), data jsonb not null
);
alter table qmargin_b74_private.sample_inbox_backup enable row level security;
revoke all on qmargin_b74_private.sample_inbox_backup from public, anon, authenticated;

with removed as (
  delete from public.qmargin_b74_privacy_requests
  where lower(split_part(btrim(email), '@', 2)) = 'example.com'
  returning *
)
insert into qmargin_b74_private.sample_inbox_backup (id, data)
select id, to_jsonb(removed) from removed on conflict (id) do nothing;
commit;
