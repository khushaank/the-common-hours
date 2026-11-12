-- Apply after add-image-library-and-traffic.sql.
begin;

alter table public.qmargin_b74_posts
  add column series text not null default '' check (char_length(series) <= 100),
  add column series_order integer check (series_order between 1 and 9999),
  add column start_here boolean not null default false;
grant insert (series, series_order, start_here), update (series, series_order, start_here)
  on public.qmargin_b74_posts to authenticated;

alter table public.qmargin_b74_weekly_photos
  add column series text not null default '' check (char_length(series) <= 100);
grant update (series) on public.qmargin_b74_weekly_photos to authenticated;

create table public.qmargin_b74_working_drafts (
  user_id uuid not null references public.qmargin_b74_admins(user_id) on delete cascade,
  slot text not null check (slot = 'new' or slot ~ '^[0-9a-f-]{36}$'),
  fields jsonb not null check (jsonb_typeof(fields) = 'object' and length(fields::text) <= 230000),
  saved_at timestamptz not null default now(),
  primary key (user_id, slot)
);
alter table public.qmargin_b74_working_drafts enable row level security;
revoke all on public.qmargin_b74_working_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.qmargin_b74_working_drafts to authenticated;
create policy qmargin_b74_own_working_drafts on public.qmargin_b74_working_drafts for all to authenticated
  using (user_id = (select auth.uid()) and (select exists (select 1 from public.qmargin_b74_admins)))
  with check (user_id = (select auth.uid()) and (select exists (select 1 from public.qmargin_b74_admins)));

create table public.qmargin_b74_asset_details (
  kind text not null check (kind in ('image', 'file')),
  asset_id uuid not null,
  title text not null default '' check (char_length(title) <= 200),
  description text not null default '' check (char_length(description) <= 4000),
  original_name text not null default '' check (char_length(original_name) <= 200),
  primary key (kind, asset_id)
);
alter table public.qmargin_b74_asset_details enable row level security;
revoke all on public.qmargin_b74_asset_details from public, anon, authenticated;
grant select, insert, update on public.qmargin_b74_asset_details to authenticated;
create policy qmargin_b74_admin_asset_details on public.qmargin_b74_asset_details for all to authenticated
  using ((select exists (select 1 from public.qmargin_b74_admins)))
  with check ((select exists (select 1 from public.qmargin_b74_admins)));
grant update (alt) on public.qmargin_b74_media to authenticated;
create policy qmargin_b74_admin_edit_media on public.qmargin_b74_media for update to authenticated
  using ((select exists (select 1 from public.qmargin_b74_admins)))
  with check ((select exists (select 1 from public.qmargin_b74_admins)));

create function public.qmargin_b74_save_asset(p_kind text, p_id uuid, p_title text, p_alt text, p_description text, p_original text default '')
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_kind = 'image' then
    update public.qmargin_b74_media set alt = p_alt where id = p_id;
    if not found then raise exception 'Image unavailable'; end if;
    update public.qmargin_b74_weekly_photos set alt = p_alt where media_id = p_id;
    update public.qmargin_b74_photos set alt = p_alt where media_id = p_id;
  elsif p_kind = 'file' then
    if not exists (select 1 from storage.objects where bucket_id = 'qmargin-b74-attachments' and name = p_id::text) then
      raise exception 'File unavailable';
    end if;
  else
    raise exception 'Invalid media type';
  end if;
  insert into public.qmargin_b74_asset_details (kind, asset_id, title, description, original_name)
    values (p_kind, p_id, p_title, p_description, p_original)
    on conflict (kind, asset_id) do update set title = excluded.title, description = excluded.description,
      original_name = coalesce(nullif(excluded.original_name, ''), qmargin_b74_asset_details.original_name);
end;
$$;
revoke all on function public.qmargin_b74_save_asset(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.qmargin_b74_save_asset(text, uuid, text, text, text, text) to authenticated;

create function public.qmargin_b74_search_posts(p_query text)
returns table (id uuid, slug text, title text, tag text, excerpt text, published_on date)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.slug, p.title, p.tag, p.excerpt, p.published_on
  from public.qmargin_b74_posts p
  where p.published and length(btrim(p_query)) between 1 and 100
    and strpos(lower(concat_ws(' ', p.title, p.tag, p.excerpt, p.body)), lower(btrim(p_query))) > 0
  order by (strpos(lower(p.title), lower(btrim(p_query))) > 0) desc, p.published_on desc, p.id desc
  limit 50;
$$;
revoke all on function public.qmargin_b74_search_posts(text) from public, anon, authenticated;
grant execute on function public.qmargin_b74_search_posts(text) to anon, authenticated;

create table qmargin_b74_private.review_links (
  token_hash bytea primary key,
  owner_id uuid not null references public.qmargin_b74_admins(user_id) on delete cascade,
  fields jsonb not null check (jsonb_typeof(fields) = 'object' and length(fields::text) <= 320000),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index qmargin_b74_review_expiry on qmargin_b74_private.review_links (expires_at);
alter table qmargin_b74_private.review_links enable row level security;
revoke all on qmargin_b74_private.review_links from public, anon, authenticated;

create function qmargin_b74_private.create_review(p_token text, p_fields jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  editor_id uuid := auth.uid();
  expiry timestamptz;
begin
  if editor_id is null or (auth.jwt() ->> 'is_anonymous') = 'true' or
    not exists (select 1 from public.qmargin_b74_admins where user_id = editor_id) then
    raise insufficient_privilege;
  end if;
  if p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid review token'; end if;
  delete from qmargin_b74_private.review_links where expires_at <= now();
  insert into qmargin_b74_private.review_links (token_hash, owner_id, fields)
    values (sha256(convert_to(p_token, 'UTF8')), editor_id, p_fields)
    returning expires_at into expiry;
  return expiry;
end;
$$;

create function qmargin_b74_private.read_review(p_token text, p_image uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_image is null then jsonb_build_object(
    'title', review.fields -> 'title', 'tag', review.fields -> 'tag', 'excerpt', review.fields -> 'excerpt',
    'body', review.fields -> 'body', 'files', review.fields -> 'files', 'expires_at', review.expires_at
  ) else (
    select jsonb_build_object('encoded', media.encoded, 'width', media.width, 'height', media.height, 'alt', media.alt)
    from public.qmargin_b74_media media
    where media.id = p_image and strpos(review.fields ->> 'body', '](media:' || p_image::text || ')') > 0
  ) end
  from qmargin_b74_private.review_links review
  where p_token ~ '^[0-9a-f]{64}$' and review.token_hash = sha256(convert_to(p_token, 'UTF8'))
    and review.expires_at > now();
$$;

create function public.qmargin_b74_create_review(p_token text, p_fields jsonb)
returns timestamptz language sql security invoker set search_path = '' as $$
  select qmargin_b74_private.create_review(p_token, p_fields);
$$;

create function public.qmargin_b74_read_review(p_token text, p_image uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select qmargin_b74_private.read_review(p_token, p_image);
$$;

revoke all on function qmargin_b74_private.create_review(text, jsonb), public.qmargin_b74_create_review(text, jsonb)
  from public, anon, authenticated;
grant execute on function qmargin_b74_private.create_review(text, jsonb), public.qmargin_b74_create_review(text, jsonb)
  to authenticated;
revoke all on function qmargin_b74_private.read_review(text, uuid), public.qmargin_b74_read_review(text, uuid)
  from public, anon, authenticated;
grant execute on function qmargin_b74_private.read_review(text, uuid), public.qmargin_b74_read_review(text, uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
