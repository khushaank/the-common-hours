-- Run after add-journal-features.sql as postgres, before publishing the app update.
-- Journal objects only. Existing content, review expiries, and grants are preserved.
begin;
set local lock_timeout = '5s';

create table if not exists qmargin_b74_private.submission_limits (
  action text primary key,
  started_at timestamptz not null,
  used integer not null check (used > 0)
);
alter table qmargin_b74_private.submission_limits enable row level security;
revoke all on qmargin_b74_private.submission_limits from public, anon, authenticated;

-- Global ceilings cannot be bypassed by changing email, cookies, JWTs, or IP headers.
-- shortcut: these are small-journal global budgets; add per-client protection/CAPTCHA if traffic grows.
create or replace function qmargin_b74_private.limit_submissions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  budget integer;
  window_size interval;
  accepted integer;
begin
  case tg_table_name
    when 'qmargin_b74_comments' then budget := 30; window_size := interval '15 minutes';
    when 'qmargin_b74_privacy_requests' then budget := 10; window_size := interval '1 hour';
    when 'qmargin_b74_traffic' then budget := 300; window_size := interval '1 minute';
    else raise exception 'Unsupported submission table';
  end case;

  insert into qmargin_b74_private.submission_limits as limits (action, started_at, used)
    values (tg_table_name, statement_timestamp(), 1)
  on conflict (action) do update
    set started_at = case when limits.started_at <= statement_timestamp() - window_size
          then statement_timestamp() else limits.started_at end,
        used = case when limits.started_at <= statement_timestamp() - window_size
          then 1 else limits.used + 1 end
    where limits.started_at <= statement_timestamp() - window_size or limits.used < budget
  returning used into accepted;
  if accepted is null then
    raise sqlstate 'PT429' using message = 'Too many submissions. Please try again later.';
  end if;
  return new;
end;
$$;
revoke all on function qmargin_b74_private.limit_submissions() from public, anon, authenticated;

create or replace trigger qmargin_b74_limit_comments
  before insert on public.qmargin_b74_comments
  for each row execute function qmargin_b74_private.limit_submissions();
create or replace trigger qmargin_b74_limit_contact
  before insert on public.qmargin_b74_privacy_requests
  for each row execute function qmargin_b74_private.limit_submissions();
create or replace trigger qmargin_b74_limit_traffic
  before insert on public.qmargin_b74_traffic
  for each row execute function qmargin_b74_private.limit_submissions();

-- The Edge Function is the only caller. It never issues a transferable storage URL.
create or replace function public.qmargin_b74_review_attachment(p_token text, p_file uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from qmargin_b74_private.review_links review
    where p_token ~ '^[0-9a-f]{64}$'
      and review.token_hash = sha256(convert_to(p_token, 'UTF8'))
      and review.expires_at > statement_timestamp() and not review.is_published
      and (strpos(review.fields ->> 'body', '](attachment:' || p_file::text || ')') > 0
        or strpos(review.fields ->> 'body', '](attachment:' || p_file::text || ' "') > 0)
  );
$$;
revoke all on function public.qmargin_b74_review_attachment(text, uuid) from public, anon, authenticated;
grant execute on function public.qmargin_b74_review_attachment(text, uuid) to service_role;

-- Stop returning legacy signed URLs, including from reviews created before this update.
create or replace function qmargin_b74_private.read_review(p_token text, p_image uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p_image is null and post.published and (review.is_published or review.expires_at <= now())
      then jsonb_build_object('published_slug', post.slug)
    when review.is_published or review.expires_at <= now() then null
    when p_image is null then jsonb_build_object(
      'title', review.fields -> 'title', 'tag', review.fields -> 'tag', 'excerpt', review.fields -> 'excerpt',
      'body', review.fields -> 'body',
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

notify pgrst, 'reload schema';
commit;
