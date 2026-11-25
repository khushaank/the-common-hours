-- Run after the carousel-aware reader and Writing Desk are live.
begin;
set local lock_timeout = '5s';

-- The organize_note trigger preserves slide order and replaces inline photo rows with one shared reference.
update public.qmargin_b74_posts post set body = post.body
where post.published and post.is_note
  and strpos(post.body, E'\n\n<!-- common-hours-note-extras -->\n') > 0
  and (
    select count(*) from regexp_split_to_table(
      split_part(post.body, E'\n\n<!-- common-hours-note-extras -->\n', -1), E'\n'
    ) line where line ~ '^!\[.*\]\(media:[a-f0-9-]{36}\)$'
  ) > 1;

commit;
