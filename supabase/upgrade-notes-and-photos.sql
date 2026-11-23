-- Apply after the writing desk, published media, and MFA upgrades.
begin;
set local lock_timeout = '5s';

alter table public.qmargin_b74_posts
  add column if not exists is_note boolean not null default false
    check (not is_note or char_length(btrim(body)) between 1 and 500);
grant insert (is_note), update (is_note) on public.qmargin_b74_posts to authenticated;

revoke insert (paired_photo, collection, collection_intro, photo_essay),
       update (paired_photo, collection, collection_intro, photo_essay)
  on public.qmargin_b74_posts from authenticated;

alter policy qmargin_b74_public_weekly_photos on public.qmargin_b74_weekly_photos
  using (
    week <= (select date_trunc('week', timezone('Asia/Kolkata', now()))::date)
    and featured and week <> date '1900-01-01'
  );

create or replace function qmargin_b74_private.delete_image(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(qmargin_b74_private.can_delete_asset(p_id::text, 'image'), false)
    or exists (
      select 1 from public.qmargin_b74_weekly_photos
      where media_id = p_id and featured and week <> date '1900-01-01'
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

create or replace function qmargin_b74_private.create_draft_preview(p_slot text, p_token text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  draft jsonb;
  expiry timestamptz;
begin
  if owner_id is null or (auth.jwt() ->> 'is_anonymous') = 'true'
     or (auth.jwt() ->> 'aal') is distinct from 'aal2'
     or not exists (select 1 from public.qmargin_b74_admins where user_id = owner_id) then
    raise insufficient_privilege;
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise invalid_parameter_value;
  end if;
  select fields into draft from public.qmargin_b74_working_drafts
    where user_id = owner_id and slot = p_slot for share;
  if draft is null then raise insufficient_privilege; end if;

  insert into qmargin_b74_private.review_links (token_hash, owner_id, entry_slot, fields)
  values (sha256(convert_to(p_token, 'UTF8')), owner_id, p_slot, jsonb_build_object(
    'title', coalesce(nullif(btrim(draft ->> 'title'), ''), 'Untitled'),
    'tag', draft ->> 'tag', 'excerpt', draft ->> 'excerpt', 'body', draft ->> 'body',
    'published_on', draft ->> 'published_on', 'reader_prompt', draft ->> 'reader_prompt',
    'is_note', coalesce(draft ->> 'is_note' = 'true', false)
  )) returning expires_at into expiry;
  return expiry;
end;
$$;

create or replace function qmargin_b74_private.read_review(p_token text, p_image uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p_image is null and post.published and (review.is_published or review.expires_at <= now())
      then jsonb_build_object('published_slug', post.slug)
    when review.is_published or review.expires_at <= now() then null
    when p_image is null then jsonb_build_object(
      'title', review.fields -> 'title', 'tag', review.fields -> 'tag', 'excerpt', review.fields -> 'excerpt',
      'body', review.fields -> 'body', 'reader_prompt', review.fields -> 'reader_prompt',
      'is_note', review.fields -> 'is_note',
      'published_on', review.fields -> 'published_on', 'expires_at', review.expires_at
    )
    else (
      select jsonb_build_object('encoded', media.encoded, 'width', media.width, 'height', media.height, 'alt', media.alt)
      from public.qmargin_b74_media media
      where media.id = p_image
        and (strpos(review.fields ->> 'body', '](media:' || p_image::text || ')') > 0
          or strpos(review.fields ->> 'body', '](media:' || p_image::text || ' "') > 0)
    )
  end
  from qmargin_b74_private.review_links review
  left join public.qmargin_b74_posts post on post.id = review.post_id
  where p_token ~ '^[0-9a-f]{64}$' and review.token_hash = sha256(convert_to(p_token, 'UTF8'));
$$;

notify pgrst, 'reload schema';
commit;
