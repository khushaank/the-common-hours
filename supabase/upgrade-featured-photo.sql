-- Apply after upgrade-notes-and-photos.sql and live-review-links.sql.
begin;
set local lock_timeout = '5s';

-- An undated row belongs to the homepage selection. Keep other dated photos at their old addresses.
do $$
begin
  if (select attnotnull from pg_attribute
      where attrelid = 'public.qmargin_b74_weekly_photos'::regclass and attname = 'week') then
    alter table public.qmargin_b74_weekly_photos alter column week drop not null;
    update public.qmargin_b74_weekly_photos
      set week = null
      where featured and week = (
        select max(week) from public.qmargin_b74_weekly_photos
        where featured and week <> date '1900-01-01'
          and week <= date_trunc('week', timezone('Asia/Kolkata', now()))::date
      );
  end if;
end;
$$;

create index if not exists qmargin_b74_featured_photo_order
  on public.qmargin_b74_weekly_photos (created_at, id) where week is null and featured;

alter policy qmargin_b74_public_weekly_photos on public.qmargin_b74_weekly_photos
  using (featured and (
    week is null or (week <> date '1900-01-01'
      and week <= (select date_trunc('week', timezone('Asia/Kolkata', now()))::date))
  ));

alter policy qmargin_b74_public_weekly_media on public.qmargin_b74_media
  using (exists (
    select 1 from public.qmargin_b74_weekly_photos photo where photo.media_id = qmargin_b74_media.id
  ));

create or replace function public.qmargin_b74_home_photos()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with photos as (
    select id, media_id, title, alt, created_at from public.qmargin_b74_weekly_photos
    where week is null and featured
  )
  select jsonb_build_object(
    'photos', coalesce((select jsonb_agg(to_jsonb(p) - 'created_at' order by p.created_at, p.id) from photos p), '[]'::jsonb),
    'image', (select jsonb_build_object('encoded', m.encoded, 'width', m.width, 'height', m.height, 'alt', m.alt)
      from public.qmargin_b74_media m where m.id = (select media_id from photos order by created_at, id limit 1))
  );
$$;
revoke all on function public.qmargin_b74_home_photos() from public, anon, authenticated;
grant execute on function public.qmargin_b74_home_photos() to anon, authenticated;

create or replace function qmargin_b74_private.delete_image(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(qmargin_b74_private.can_delete_asset(p_id::text, 'image'), false)
    or exists (
      select 1 from public.qmargin_b74_weekly_photos
      where media_id = p_id and week is null and featured
    ) then
    return false;
  end if;
  delete from public.qmargin_b74_weekly_photos where media_id = p_id;
  delete from public.qmargin_b74_photos where media_id = p_id;
  delete from public.qmargin_b74_asset_details where kind = 'image' and asset_id = p_id;
  delete from public.qmargin_b74_media where id = p_id;
  return true;
end;
$$;

notify pgrst, 'reload schema';
commit;
