-- Run after live-review-links.sql in the journal project's SQL Editor.
begin;

alter table public.qmargin_b74_posts
  add column if not exists reader_prompt text not null default '' check (char_length(reader_prompt) <= 500),
  add column if not exists paired_photo text check (paired_photo ~ '^([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|month-[0-9]{4}-(0[1-9]|1[0-2]))$'),
  add column if not exists collection text not null default '' check (char_length(collection) <= 100),
  add column if not exists collection_intro text not null default '' check (char_length(collection_intro) <= 500),
  add column if not exists photo_essay boolean not null default false;

grant insert (reader_prompt, paired_photo, collection, collection_intro, photo_essay),
      update (reader_prompt, paired_photo, collection, collection_intro, photo_essay)
  on public.qmargin_b74_posts to authenticated;

create index if not exists qmargin_b74_posts_paired_photo
  on public.qmargin_b74_posts (paired_photo, published_on desc, id desc) where paired_photo is not null;

alter policy qmargin_b74_public_media on public.qmargin_b74_media using (
  exists (
    select 1 from public.qmargin_b74_photos photo
    where photo.media_id = qmargin_b74_media.id
      and photo.month <= (select date_trunc('month', timezone('Asia/Kolkata', now()))::date)
  ) or exists (
    select 1 from public.qmargin_b74_posts post
    where post.published and starts_with(post.body, '<!-- common-hours-markdown -->')
      and (strpos(post.body, '](media:' || qmargin_b74_media.id::text || ')') > 0
        or strpos(post.body, '](media:' || qmargin_b74_media.id::text || ' "') > 0)
  )
);

create or replace function qmargin_b74_private.read_review(p_token text, p_image uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p_image is null and post.published and (review.is_published or review.expires_at <= now())
      then jsonb_build_object('published_slug', post.slug)
    when review.is_published or review.expires_at <= now() then null
    when p_image is null then jsonb_build_object(
      'title', review.fields -> 'title', 'tag', review.fields -> 'tag', 'excerpt', review.fields -> 'excerpt',
      'body', review.fields -> 'body', 'files', review.fields -> 'files',
      'reader_prompt', review.fields -> 'reader_prompt', 'photo_essay', review.fields -> 'photo_essay',
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

commit;
