-- Optional undo for remove-confirmed-samples.sql; never overwrites newer records.
-- Run as postgres only if the removed sample data is wanted again.
begin;
-- Exclusive locks prevent visitor writes while historical counters are restored.
lock table public.qmargin_b74_comments, public.qmargin_b74_traffic in access exclusive mode;
alter table public.qmargin_b74_comments disable trigger qmargin_b74_limit_comments;
alter table public.qmargin_b74_traffic disable trigger qmargin_b74_limit_traffic;
do $$
declare
  backup jsonb;
begin
  select data into strict backup from qmargin_b74_private.sample_cleanup_20261116 where id = 1;
  insert into public.qmargin_b74_media select * from jsonb_populate_recordset(null::public.qmargin_b74_media, backup -> 'media') on conflict do nothing;
  insert into public.qmargin_b74_posts select * from jsonb_populate_recordset(null::public.qmargin_b74_posts, backup -> 'posts') on conflict do nothing;
  insert into public.qmargin_b74_weekly_photos select * from jsonb_populate_recordset(null::public.qmargin_b74_weekly_photos, backup -> 'photos') on conflict do nothing;
  insert into public.qmargin_b74_comments select * from jsonb_populate_recordset(null::public.qmargin_b74_comments, backup -> 'comments') on conflict do nothing;
  insert into public.qmargin_b74_entry_slugs select * from jsonb_populate_recordset(null::public.qmargin_b74_entry_slugs, backup -> 'slugs') on conflict do nothing;
  insert into public.qmargin_b74_asset_details select * from jsonb_populate_recordset(null::public.qmargin_b74_asset_details, backup -> 'asset_details') on conflict do nothing;
  insert into public.qmargin_b74_traffic select * from jsonb_populate_recordset(null::public.qmargin_b74_traffic, backup -> 'traffic') on conflict do nothing;
end;
$$;
alter table public.qmargin_b74_comments enable trigger qmargin_b74_limit_comments;
alter table public.qmargin_b74_traffic enable trigger qmargin_b74_limit_traffic;
commit;
