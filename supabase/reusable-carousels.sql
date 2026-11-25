begin;
set local lock_timeout = '5s';

create table public.qmargin_b74_carousels (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 180)
);

create table public.qmargin_b74_carousel_photos (
  carousel_id uuid not null references public.qmargin_b74_carousels(id) on delete cascade,
  media_id uuid not null references public.qmargin_b74_media(id),
  position bigint generated always as identity,
  alt text not null default '' check (char_length(alt) <= 200),
  primary key (carousel_id, media_id)
);
create index qmargin_b74_carousel_photo_order on public.qmargin_b74_carousel_photos (carousel_id, position);
create index qmargin_b74_carousel_media_id on public.qmargin_b74_carousel_photos (media_id);

create function qmargin_b74_private.carousel_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and (auth.jwt()->>'aal') is not distinct from 'aal2'
    and (auth.jwt()->>'is_anonymous') is distinct from 'true'
    and exists (select 1 from public.qmargin_b74_admins where user_id = auth.uid());
$$;
revoke all on function qmargin_b74_private.carousel_admin() from public;
grant execute on function qmargin_b74_private.carousel_admin() to anon, authenticated;

alter table public.qmargin_b74_carousels enable row level security;
alter table public.qmargin_b74_carousel_photos enable row level security;
revoke all on public.qmargin_b74_carousels, public.qmargin_b74_carousel_photos from public, anon, authenticated;
grant select on public.qmargin_b74_carousels, public.qmargin_b74_carousel_photos to anon, authenticated;
grant insert (title), update (title) on public.qmargin_b74_carousels to authenticated;
grant insert (carousel_id, media_id, alt), delete on public.qmargin_b74_carousel_photos to authenticated;
create policy carousel_editor on public.qmargin_b74_carousels for all to authenticated
  using ((select qmargin_b74_private.carousel_admin())) with check ((select qmargin_b74_private.carousel_admin()));
create policy carousel_photo_editor on public.qmargin_b74_carousel_photos for all to authenticated
  using ((select qmargin_b74_private.carousel_admin())) with check ((select qmargin_b74_private.carousel_admin()));
create policy carousel_reader on public.qmargin_b74_carousels for select to anon, authenticated using (
  exists (select 1 from public.qmargin_b74_posts post
    where post.published and strpos(post.body, '![carousel](carousel:' || qmargin_b74_carousels.id || ')') > 0)
);
create policy carousel_photo_reader on public.qmargin_b74_carousel_photos for select to anon, authenticated using (
  exists (select 1 from public.qmargin_b74_carousels carousel where carousel.id = carousel_id)
);
create policy qmargin_b74_public_carousel_media on public.qmargin_b74_media for select to anon, authenticated using (
  exists (select 1 from public.qmargin_b74_carousel_photos photo where photo.media_id = qmargin_b74_media.id)
);

create function public.qmargin_b74_delete_carousel_photo(p_carousel uuid, p_id uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
  delete from public.qmargin_b74_carousel_photos where carousel_id = p_carousel and media_id = p_id;
  if not found then return false; end if;
  if not public.qmargin_b74_delete_image(p_id) then
    raise exception 'This photo is used elsewhere. Remove it from this carousel to keep the original.';
  end if;
  return true;
exception when foreign_key_violation then
  raise exception 'This photo is in another carousel. Remove it from this carousel to keep the original.';
end;
$$;
revoke all on function public.qmargin_b74_delete_carousel_photo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.qmargin_b74_delete_carousel_photo(uuid, uuid) to authenticated;

create function qmargin_b74_private.review_carousel(p_token text, p_id uuid, p_media uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_media is null then (
    select coalesce(jsonb_agg(jsonb_build_object('id', photo.media_id, 'alt', photo.alt) order by photo.position), '[]'::jsonb)
    from public.qmargin_b74_carousel_photos photo where photo.carousel_id = p_id
  ) else (
    select jsonb_build_object('encoded', media.encoded, 'width', media.width, 'height', media.height, 'alt', media.alt)
    from public.qmargin_b74_carousel_photos photo join public.qmargin_b74_media media on media.id = photo.media_id
    where photo.carousel_id = p_id and photo.media_id = p_media
  ) end
  from qmargin_b74_private.review_links review
  where p_token ~ '^[0-9a-f]{64}$' and review.token_hash = sha256(convert_to(p_token, 'UTF8'))
    and not review.is_published and review.expires_at > now()
    and strpos(review.fields->>'body', '![carousel](carousel:' || p_id || ')') > 0;
$$;
create function public.qmargin_b74_review_carousel(p_token text, p_id uuid, p_media uuid default null)
returns jsonb language sql set search_path = '' as $$
  select qmargin_b74_private.review_carousel(p_token, p_id, p_media);
$$;
revoke all on function qmargin_b74_private.review_carousel(text, uuid, uuid), public.qmargin_b74_review_carousel(text, uuid, uuid) from public, anon, authenticated;
grant execute on function qmargin_b74_private.review_carousel(text, uuid, uuid), public.qmargin_b74_review_carousel(text, uuid, uuid) to anon, authenticated;

alter table public.qmargin_b74_posts add column note_number bigint unique;
create sequence qmargin_b74_private.note_numbers;
with numbered as (
  select id, row_number() over (order by published_on, id) as n from public.qmargin_b74_posts where is_note and published
)
update public.qmargin_b74_posts post set note_number = numbered.n from numbered where post.id = numbered.id;
select setval('qmargin_b74_private.note_numbers', coalesce(max(note_number), 1), count(note_number) > 0)
from public.qmargin_b74_posts;
grant select (note_number) on public.qmargin_b74_posts to anon, authenticated;

create function qmargin_b74_private.organize_note()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  separator constant text := E'\n\n<!-- common-hours-note-extras -->\n';
  photo_pattern constant text := '^!\[(.*)\]\(media:([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})\)$';
  extras text;
  rest text;
  photo_count integer;
  gallery uuid;
begin
  if tg_op = 'UPDATE' then new.note_number := old.note_number;
  else new.note_number := null;
  end if;
  if not new.is_note then return new; end if;
  if new.published and new.note_number is null then
    new.note_number := nextval('qmargin_b74_private.note_numbers');
  end if;
  if strpos(new.body, separator) = 0 then return new; end if;
  extras := split_part(new.body, separator, -1);
  select count(*) into photo_count from regexp_split_to_table(extras, E'\n') line where line ~ photo_pattern;
  if photo_count < 2 then return new; end if;
  if exists (
    select 1 from regexp_split_to_table(extras, E'\n') line
    cross join lateral (select regexp_match(line, photo_pattern) as parts) match
    where match.parts is not null and not exists (select 1 from public.qmargin_b74_media where id = match.parts[2]::uuid)
  ) then return new; end if;
  insert into public.qmargin_b74_carousels (title)
    values (coalesce(nullif(left(btrim(new.title), 180), ''), 'Note photos')) returning id into gallery;
  insert into public.qmargin_b74_carousel_photos (carousel_id, media_id, alt)
    select gallery, media.id, coalesce(nullif(left(btrim(match.parts[1], '"'), 200), ''), media.alt)
    from regexp_split_to_table(extras, E'\n') with ordinality line(markup, ordinal)
    cross join lateral (select regexp_match(line.markup, photo_pattern) as parts) match
    join public.qmargin_b74_media media on media.id = (match.parts[2])::uuid
    order by line.ordinal
    on conflict do nothing;
  select string_agg(line.markup, E'\n' order by ordinal) into rest
    from regexp_split_to_table(extras, E'\n') with ordinality line(markup, ordinal) where line.markup !~ photo_pattern;
  new.body := left(new.body, length(new.body) - length(extras)) ||
    '![carousel](carousel:' || gallery || ')' || case when rest is null then '' else E'\n' || rest end;
  return new;
end;
$$;
revoke all on function qmargin_b74_private.organize_note() from public;
create trigger qmargin_b74_organize_note before insert or update of body, is_note, published on public.qmargin_b74_posts
  for each row execute function qmargin_b74_private.organize_note();

alter table public.qmargin_b74_posts drop constraint qmargin_b74_note_text_and_media,
  add constraint qmargin_b74_note_text_and_media check (
    not is_note or (
      char_length(body) <= 6000 and char_length(btrim(regexp_replace(body, $pattern$(?s)\A(.*)\n\n<!-- common-hours-note-extras -->\n.*\Z$pattern$, '\1'))) <= 500
      and (btrim(regexp_replace(body, $pattern$(?s)\A(.*)\n\n<!-- common-hours-note-extras -->\n.*\Z$pattern$, '\1'), E' \t\n\r') <> ''
        or split_part(body, E'\n\n<!-- common-hours-note-extras -->\n', -1) ~ $pattern$(^|\n)!\[.*\]\((media|carousel):[a-f0-9-]{36}\)(\n|$)$pattern$)
    )
  );

create policy qmargin_b74_article_comments_only on public.qmargin_b74_comments as restrictive
  for insert to anon, authenticated with check (not exists (
    select 1 from public.qmargin_b74_posts post where post.id = post_id and post.is_note
  ));
create policy qmargin_b74_hide_note_comments on public.qmargin_b74_comments as restrictive
  for select to anon, authenticated using ((select qmargin_b74_private.carousel_admin()) or not exists (
    select 1 from public.qmargin_b74_posts post where post.id = post_id and post.is_note
  ));
do $$ begin
  if to_regprocedure('public.qmargin_b74_note_likes(uuid[],uuid)') is not null then
    revoke execute on function public.qmargin_b74_note_likes(uuid[], uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('qmargin_b74_private.note_likes(uuid[],uuid)') is not null then
    revoke execute on function qmargin_b74_private.note_likes(uuid[], uuid) from public, anon, authenticated;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
