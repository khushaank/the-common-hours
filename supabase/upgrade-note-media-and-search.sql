-- Apply after upgrade-notes-and-photos.sql.
begin;
set local lock_timeout = '5s';

-- The old inline check has a generated name that depends on the installed upgrades.
do $$
declare
  old_check name;
begin
  for old_check in
    select conname from pg_constraint
    where conrelid = 'public.qmargin_b74_posts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%is_note%char_length(btrim(body))%'
  loop
    execute format('alter table public.qmargin_b74_posts drop constraint %I', old_check);
  end loop;
end;
$$;

alter table public.qmargin_b74_posts
  drop constraint if exists qmargin_b74_note_text_and_media,
  add constraint qmargin_b74_note_text_and_media check (
    not is_note or (
      char_length(body) <= 6000
      and char_length(btrim(regexp_replace(body, $pattern$(?s)\A(.*)\n\n<!-- common-hours-note-extras -->\n.*\Z$pattern$, '\1'))) <= 500
      and (
        btrim(regexp_replace(body, $pattern$(?s)\A(.*)\n\n<!-- common-hours-note-extras -->\n.*\Z$pattern$, '\1'), E' \t\n\r') <> ''
        or split_part(body, E'\n\n<!-- common-hours-note-extras -->\n', -1) ~ $pattern$(^|\n)!\[.*\]\(media:[a-f0-9-]{36}\)(\n|$)$pattern$
      )
    )
  );

drop policy if exists qmargin_b74_public_note_media on public.qmargin_b74_media;
create policy qmargin_b74_public_note_media on public.qmargin_b74_media for select to anon, authenticated
  using (exists (
    select 1 from public.qmargin_b74_posts post
    cross join lateral regexp_split_to_table(split_part(post.body, E'\n\n<!-- common-hours-note-extras -->\n', -1), E'\n') asset(markup)
    where post.published and post.is_note
      and strpos(post.body, E'\n\n<!-- common-hours-note-extras -->\n') > 0
      and starts_with(asset.markup, '![')
      and asset.markup like '%](media:' || qmargin_b74_media.id::text || ')'
  ));

create or replace function public.qmargin_b74_search_previews(p_query text)
returns table (id uuid, slug text, title text, tag text, excerpt text, published_on date, is_note boolean, snippet text)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.slug, p.title, p.tag, p.excerpt, p.published_on, p.is_note,
    case when match.at > 56 then '…' else '' end
      || substr(match.display_text, greatest(1, match.at - 55),
        match.at + char_length(query.term) + 75 - greatest(1, match.at - 55))
      || case when match.at + char_length(query.term) + 75 <= char_length(match.display_text) then '…' else '' end
  from public.qmargin_b74_posts p
  cross join (select lower(btrim(p_query)) as term) query
  cross join lateral (
    select source.display_text, strpos(lower(source.display_text), query.term) as at
    from (values
      (1, btrim(regexp_replace(
        case when p.is_note then regexp_replace(p.body, $pattern$(?s)\A(.*)\n\n<!-- common-hours-note-extras -->\n.*\Z$pattern$, '\1')
          else regexp_replace(replace(p.body, E'<!-- common-hours-markdown -->\n', ''),
            $pattern$!?\[([^]]*)\]\([^)]*\)$pattern$, '\1', 'g') end, '\s+', ' ', 'g'))),
      (2, p.excerpt), (3, p.tag), (4, p.title)
    ) source(priority, display_text)
    where strpos(lower(source.display_text), query.term) > 0
    order by source.priority
    limit 1
  ) match
  where p.published and char_length(query.term) between 1 and 100
  order by (strpos(lower(p.title), query.term) > 0) desc, p.published_on desc, p.id desc
  limit 50;
$$;

revoke all on function public.qmargin_b74_search_previews(text) from public, anon, authenticated;
grant execute on function public.qmargin_b74_search_previews(text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
