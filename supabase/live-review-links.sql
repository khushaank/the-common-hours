-- Apply after upgrade-editor-and-reading.sql.
begin;

alter table qmargin_b74_private.review_links
  add column if not exists entry_slot text,
  add column if not exists post_id uuid references public.qmargin_b74_posts(id) on delete cascade,
  add column if not exists is_published boolean not null default false;
create index if not exists qmargin_b74_review_entry on qmargin_b74_private.review_links(owner_id, entry_slot);

create or replace function qmargin_b74_private.sync_reviews(
  p_slot text, p_fields jsonb, p_token text, p_reconnect boolean, p_post uuid, p_publish boolean
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  editor_id uuid := auth.uid();
  token_key bytea;
  expiry timestamptz;
begin
  if editor_id is null or (auth.jwt() ->> 'is_anonymous') = 'true' or
     not exists (select 1 from public.qmargin_b74_admins where user_id = editor_id) then
    raise insufficient_privilege;
  end if;
  if p_slot is null or (p_slot <> 'new' and not exists (
    select 1 from public.qmargin_b74_posts where id::text = p_slot
  )) then raise exception 'Invalid entry'; end if;
  if p_post is not null and (p_slot not in ('new', p_post::text) or not exists (
    select 1 from public.qmargin_b74_posts where id = p_post and (not p_publish or published)
  )) then raise exception 'Invalid saved entry'; end if;
  if p_publish and p_post is null then raise exception 'Missing published entry'; end if;

  if p_token is not null then
    if p_fields is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid review token'; end if;
    token_key := sha256(convert_to(p_token, 'UTF8'));
    if p_reconnect then
      update qmargin_b74_private.review_links
      set entry_slot = p_slot, expires_at = greatest(expires_at, now() + interval '24 hours')
      where token_hash = token_key and owner_id = editor_id and not is_published
        and (entry_slot is null or entry_slot = p_slot)
      returning expires_at into expiry;
      if not found then raise exception 'That review link has expired or belongs to a different entry'; end if;
    else
      insert into qmargin_b74_private.review_links (token_hash, owner_id, entry_slot, fields)
      values (token_key, editor_id, p_slot, p_fields) returning expires_at into expiry;
    end if;
  end if;

  if p_fields is not null or p_post is not null then
    update qmargin_b74_private.review_links
    set fields = case when p_publish then '{}'::jsonb else coalesce(p_fields, fields) end,
        entry_slot = coalesce(p_post::text, entry_slot),
        post_id = coalesce(p_post, post_id),
        is_published = p_publish
    where owner_id = editor_id and entry_slot = p_slot and not is_published
      and (expires_at > now() or p_post is not null);
  end if;
  return coalesce(expiry, (
    select max(expires_at) from qmargin_b74_private.review_links
    where owner_id = editor_id and entry_slot = coalesce(p_post::text, p_slot) and not is_published and expires_at > now()
  ));
end;
$$;

create or replace function public.qmargin_b74_sync_reviews(
  p_slot text, p_fields jsonb default null, p_token text default null,
  p_reconnect boolean default false, p_post uuid default null, p_publish boolean default false
) returns timestamptz language sql security invoker set search_path = '' as $$
  select qmargin_b74_private.sync_reviews(p_slot, p_fields, p_token, p_reconnect, p_post, p_publish);
$$;

revoke all on function qmargin_b74_private.sync_reviews(text,jsonb,text,boolean,uuid,boolean),
  public.qmargin_b74_sync_reviews(text,jsonb,text,boolean,uuid,boolean) from public, anon, authenticated;
grant execute on function qmargin_b74_private.sync_reviews(text,jsonb,text,boolean,uuid,boolean),
  public.qmargin_b74_sync_reviews(text,jsonb,text,boolean,uuid,boolean) to authenticated;

-- Old, unconnected links keep their original expiration. A connected link can
-- always open its published entry, but never exposes private edits after expiry.
create or replace function qmargin_b74_private.read_review(p_token text, p_image uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p_image is null and post.published and (review.is_published or review.expires_at <= now())
      then jsonb_build_object('published_slug', post.slug)
    when review.is_published or review.expires_at <= now() then null
    when p_image is null then jsonb_build_object(
      'title', review.fields -> 'title', 'tag', review.fields -> 'tag', 'excerpt', review.fields -> 'excerpt',
      'body', review.fields -> 'body', 'files', review.fields -> 'files',
      'published_on', review.fields -> 'published_on', 'expires_at', review.expires_at
    )
    else (
      select jsonb_build_object('encoded', media.encoded, 'width', media.width, 'height', media.height, 'alt', media.alt)
      from public.qmargin_b74_media media
      where media.id = p_image and strpos(review.fields ->> 'body', '](media:' || p_image::text || ')') > 0
    )
  end
  from qmargin_b74_private.review_links review
  left join public.qmargin_b74_posts post on post.id = review.post_id
  where p_token ~ '^[0-9a-f]{64}$' and review.token_hash = sha256(convert_to(p_token, 'UTF8'));
$$;

-- Older open editor tabs may still call this function. Don't let them delete
-- linked URLs that should continue to open a published article.
create or replace function qmargin_b74_private.create_review(p_token text, p_fields jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  editor_id uuid := auth.uid();
  expiry timestamptz;
begin
  if editor_id is null or (auth.jwt() ->> 'is_anonymous') = 'true' or
    not exists (select 1 from public.qmargin_b74_admins where user_id = editor_id) then
    raise insufficient_privilege;
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid review token'; end if;
  delete from qmargin_b74_private.review_links where expires_at <= now() and entry_slot is null;
  insert into qmargin_b74_private.review_links (token_hash, owner_id, fields)
  values (sha256(convert_to(p_token, 'UTF8')), editor_id, p_fields) returning expires_at into expiry;
  return expiry;
end;
$$;

create or replace function public.qmargin_b74_home_photos()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with latest as (
    select week from public.qmargin_b74_weekly_photos
    where featured and week <= date_trunc('week', timezone('Asia/Kolkata', now()))::date
    order by week desc limit 1
  ), weekly as (
    select id::text, media_id, title, alt, created_at
    from public.qmargin_b74_weekly_photos where featured and week = (select week from latest)
  ), photos as (
    select * from weekly
    union all
    select 'month-' || to_char(month, 'YYYY-MM'), media_id, coalesce(nullif(caption, ''), 'From the journal'), alt, null
    from public.qmargin_b74_photos
    where month = date_trunc('month', timezone('Asia/Kolkata', now()))::date and not exists (select 1 from latest)
  )
  select jsonb_build_object(
    'photos', coalesce((select jsonb_agg(to_jsonb(p) - 'created_at' order by p.created_at, p.id) from photos p), '[]'::jsonb),
    'image', (select jsonb_build_object('encoded', m.encoded, 'width', m.width, 'height', m.height, 'alt', m.alt)
      from public.qmargin_b74_media m where m.id = (select media_id from photos order by created_at, id limit 1))
  );
$$;
revoke all on function public.qmargin_b74_home_photos() from public, anon, authenticated;
grant execute on function public.qmargin_b74_home_photos() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
