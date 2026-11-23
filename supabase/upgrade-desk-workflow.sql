-- Apply in the SQL Editor after the journal and security upgrades.
begin;
set local lock_timeout = '5s';

alter table public.qmargin_b74_posts drop constraint if exists qmargin_b74_posts_tag_check;
alter table public.qmargin_b74_posts add constraint qmargin_b74_posts_tag_check
  check (char_length(btrim(tag)) between 1 and 400);
alter table public.qmargin_b74_posts drop constraint if exists qmargin_b74_posts_excerpt_check;
alter table public.qmargin_b74_posts add constraint qmargin_b74_posts_excerpt_check
  check (char_length(btrim(excerpt)) between 1 and 500 or (not published and excerpt = ''));

create table if not exists public.qmargin_b74_references (
  alias text primary key check (alias ~ '^[a-z0-9_-]{1,40}$'),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  url text not null check (char_length(url) <= 2000 and url ~ '^https://[^[:space:]]+$')
);
alter table public.qmargin_b74_references enable row level security;
revoke all on public.qmargin_b74_references from public, anon, authenticated;
grant select, insert, update, delete on public.qmargin_b74_references to authenticated;
drop policy if exists qmargin_b74_admin_references on public.qmargin_b74_references;
create policy qmargin_b74_admin_references on public.qmargin_b74_references
  for all to authenticated
  using ((select exists (select 1 from public.qmargin_b74_admins)))
  with check ((select exists (select 1 from public.qmargin_b74_admins)));

create or replace function qmargin_b74_private.assign_series_part()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if nullif(btrim(new.series), '') is null then
    new.series_order := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.series = new.series and old.series_order is not null
    and (old.published or not new.published) then
    new.series_order := old.series_order;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(new.series), 0));
  select coalesce(max(series_order), 0) + 1 into new.series_order
    from public.qmargin_b74_posts
    where published and id <> new.id and lower(series) = lower(new.series);
  return new;
end;
$$;
revoke all on function qmargin_b74_private.assign_series_part() from public, anon, authenticated;
create or replace trigger qmargin_b74_assign_series_part
  before insert or update of series, series_order, published on public.qmargin_b74_posts
  for each row execute function qmargin_b74_private.assign_series_part();

grant delete on public.qmargin_b74_posts, public.qmargin_b74_asset_details to authenticated;
drop policy if exists qmargin_b74_admin_delete_posts on public.qmargin_b74_posts;
create policy qmargin_b74_admin_delete_posts on public.qmargin_b74_posts
  for delete to authenticated using ((select exists (select 1 from public.qmargin_b74_admins)));

create or replace function qmargin_b74_private.clear_deleted_entry_drafts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.qmargin_b74_working_drafts where slot = old.id::text;
  return old;
end;
$$;
revoke all on function qmargin_b74_private.clear_deleted_entry_drafts() from public, anon, authenticated;
create or replace trigger qmargin_b74_clear_deleted_entry_drafts after delete on public.qmargin_b74_posts
  for each row execute function qmargin_b74_private.clear_deleted_entry_drafts();

create or replace function qmargin_b74_private.can_delete_asset(p_id text, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and (auth.jwt() ->> 'is_anonymous') is distinct from 'true'
    and exists (select 1 from public.qmargin_b74_admins where user_id = auth.uid())
    and p_id ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and p_kind in ('image', 'file')
    and not exists (select 1 from public.qmargin_b74_posts where strpos(body, p_id) > 0)
    and not exists (select 1 from public.qmargin_b74_working_drafts where strpos(fields ->> 'body', p_id) > 0)
    and not exists (
      select 1 from qmargin_b74_private.review_links
      where expires_at > now() and not is_published and strpos(fields ->> 'body', p_id) > 0
    );
$$;
revoke all on function qmargin_b74_private.can_delete_asset(text, text) from public, anon, authenticated;
grant execute on function qmargin_b74_private.can_delete_asset(text, text) to authenticated;

create or replace function qmargin_b74_private.delete_image(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(qmargin_b74_private.can_delete_asset(p_id::text, 'image'), false) then
    return false;
  end if;
  if exists (
    select 1 from public.qmargin_b74_weekly_photos photo
    where photo.media_id = p_id and ((photo.featured and photo.week <> '1900-01-01') or exists (
      select 1 from public.qmargin_b74_posts where paired_photo = photo.id::text
      union all select 1 from public.qmargin_b74_working_drafts where fields ->> 'paired_photo' = photo.id::text
    ))
  ) or exists (
    select 1 from public.qmargin_b74_photos photo
    where photo.media_id = p_id and exists (
      select 1 from public.qmargin_b74_posts where paired_photo = 'month-' || to_char(photo.month, 'YYYY-MM')
      union all select 1 from public.qmargin_b74_working_drafts
        where fields ->> 'paired_photo' = 'month-' || to_char(photo.month, 'YYYY-MM')
    )
  ) then
    return false;
  end if;
  delete from public.qmargin_b74_weekly_photos where media_id = p_id and (not featured or week = '1900-01-01');
  delete from public.qmargin_b74_photos where media_id = p_id;
  delete from public.qmargin_b74_asset_details where kind = 'image' and asset_id = p_id;
  delete from public.qmargin_b74_media where id = p_id;
  return true;
end;
$$;
create or replace function public.qmargin_b74_delete_image(p_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select qmargin_b74_private.delete_image(p_id);
$$;
revoke all on function qmargin_b74_private.delete_image(uuid), public.qmargin_b74_delete_image(uuid)
  from public, anon, authenticated;
grant execute on function qmargin_b74_private.delete_image(uuid), public.qmargin_b74_delete_image(uuid)
  to authenticated;

drop policy if exists qmargin_b74_editor_delete_attachments on storage.objects;
create policy qmargin_b74_editor_delete_attachments on storage.objects
  for delete to authenticated using (
    bucket_id = 'qmargin-b74-attachments'
    and qmargin_b74_private.can_delete_asset(name, 'file')
  );

notify pgrst, 'reload schema';
commit;
