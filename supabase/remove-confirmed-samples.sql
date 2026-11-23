-- Approved cleanup: 68 generated entries, their 57 comments, and 32 sample photos.
-- Keeps Elephant, Love - the test, This shall pass, and genuine photo uploads.
-- Run as postgres. A private backup is saved before anything is removed.
-- A completed cleanup is safe to rerun. Use reset-sample-traffic.sql for the remaining counters.
begin;
set local lock_timeout = '10s';
lock table public.qmargin_b74_posts, public.qmargin_b74_weekly_photos,
  public.qmargin_b74_comments, public.qmargin_b74_entry_slugs,
  public.qmargin_b74_working_drafts, public.qmargin_b74_media,
  public.qmargin_b74_asset_details, public.qmargin_b74_traffic,
  qmargin_b74_private.review_links in share row exclusive mode;

create table if not exists qmargin_b74_private.sample_cleanup_20261116 (
  id integer primary key check (id = 1),
  saved_at timestamptz not null default now(),
  data jsonb not null
);
alter table qmargin_b74_private.sample_cleanup_20261116 enable row level security;
revoke all on qmargin_b74_private.sample_cleanup_20261116 from public, anon, authenticated;

do $$
declare
  sample_posts uuid[];
  sample_photos uuid[];
  sample_media uuid[];
begin
  if exists (select 1 from qmargin_b74_private.sample_cleanup_20261116 where id = 1) then
    raise notice 'The sample entry and photo cleanup already has a backup. Use reset-sample-traffic.sql to reset views and visits.';
    return;
  end if;

  select array_agg(id) into sample_posts from public.qmargin_b74_posts
    where body like '%I stayed a little longer than I had planned. Once the first rush had passed, there was room to notice what I usually walk past.%'
       or body like '%I wrote it down that evening, before the rest of the day had crowded out the detail.%';
  select array_agg(id), array_agg(distinct media_id) into sample_photos, sample_media
    from public.qmargin_b74_weekly_photos
    where title ~ '^(Amber ridge|Blue morning|Rose horizon|Green valley)( · [2-8])?$';

  assert coalesce(cardinality(sample_posts), 0) = 68, 'Sample entry count changed; inspect before continuing';
  assert coalesce(cardinality(sample_photos), 0) = 32, 'Sample photo count changed; inspect before continuing';
  assert (select count(*) from public.qmargin_b74_comments where post_id = any(sample_posts)) = 57,
    'Sample comments changed; inspect before continuing';
  assert not exists (select 1 from public.qmargin_b74_working_drafts where slot = any(sample_posts::text[])),
    'An entry has a working draft; stop to preserve edits';
  assert not exists (select 1 from qmargin_b74_private.review_links where post_id = any(sample_posts)),
    'An entry has a review link; inspect before continuing';
  assert (select count(*) from public.qmargin_b74_posts
    where title in ('Elephant', 'Love - the test', 'This shall pass') and not (id = any(sample_posts))) = 3,
    'The three retained articles must remain outside the sample set';

  insert into qmargin_b74_private.sample_cleanup_20261116 (id, data)
    select 1, jsonb_build_object(
      'posts', (select jsonb_agg(to_jsonb(p)) from public.qmargin_b74_posts p where id = any(sample_posts)),
      'photos', (select jsonb_agg(to_jsonb(p)) from public.qmargin_b74_weekly_photos p where id = any(sample_photos)),
      'comments', (select jsonb_agg(to_jsonb(c)) from public.qmargin_b74_comments c where post_id = any(sample_posts)),
      'slugs', coalesce((select jsonb_agg(to_jsonb(s)) from public.qmargin_b74_entry_slugs s where post_id = any(sample_posts)), '[]'::jsonb),
      'media', (select jsonb_agg(to_jsonb(m)) from public.qmargin_b74_media m where id = any(sample_media)),
      'asset_details', coalesce((select jsonb_agg(to_jsonb(a)) from public.qmargin_b74_asset_details a where kind = 'image' and asset_id = any(sample_media)), '[]'::jsonb),
      'traffic', coalesce((select jsonb_agg(to_jsonb(t)) from public.qmargin_b74_traffic t
        where page in (select 'post/' || id::text from unnest(sample_posts) id)), '[]'::jsonb)
    );

  delete from public.qmargin_b74_traffic where page in (select 'post/' || id::text from unnest(sample_posts) id);
  delete from public.qmargin_b74_comments where post_id = any(sample_posts);
  delete from public.qmargin_b74_posts where id = any(sample_posts);
  delete from public.qmargin_b74_weekly_photos where id = any(sample_photos);

  -- Keep any image referenced by a remaining photo, article, or private review.
  select array_agg(m.id) into sample_media from public.qmargin_b74_media m
    where m.id = any(sample_media)
      and not exists (select 1 from public.qmargin_b74_weekly_photos p where p.media_id = m.id)
      and not exists (select 1 from public.qmargin_b74_photos p where p.media_id = m.id)
      and not exists (select 1 from public.qmargin_b74_posts p where strpos(p.body, m.id::text) > 0)
      and not exists (select 1 from qmargin_b74_private.review_links r where strpos(r.fields ->> 'body', m.id::text) > 0);
  delete from public.qmargin_b74_asset_details where kind = 'image' and asset_id = any(sample_media);
  delete from public.qmargin_b74_media where id = any(sample_media);
end;
$$;
commit;
