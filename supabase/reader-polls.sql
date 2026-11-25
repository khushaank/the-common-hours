-- Apply after upgrade-editor-and-reading.sql.
begin;
set local lock_timeout = '5s';

alter table public.qmargin_b74_posts add column poll jsonb
  check (poll is null or case
    when jsonb_typeof(poll->'question') = 'string' and jsonb_typeof(poll->'options') = 'array' then
      char_length(btrim(poll->>'question')) between 1 and 180
      and jsonb_array_length(poll->'options') between 2 and 6
      and not jsonb_path_exists(poll, '$.options[*] ? (@.type() != "string" || @ like_regex "^\\s*$|^.{121,}$" flag "s")')
    else false
  end);
grant insert (poll), update (poll) on public.qmargin_b74_posts to authenticated;

create table qmargin_b74_private.reader_poll_votes (
  post_id uuid not null references public.qmargin_b74_posts(id) on delete cascade,
  poll_version text not null,
  voter uuid not null,
  choice integer not null check (choice between 1 and 6),
  primary key (post_id, poll_version, voter)
);
alter table qmargin_b74_private.reader_poll_votes enable row level security;
revoke all on qmargin_b74_private.reader_poll_votes from public, anon, authenticated;

create function qmargin_b74_private.reader_poll(p_post uuid, p_poll jsonb, p_voter uuid, p_choice integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_poll jsonb;
  version text;
  selected integer;
  totals jsonb;
begin
  select poll into current_poll from public.qmargin_b74_posts
    where id = p_post and published;
  if current_poll is null or current_poll is distinct from p_poll or p_voter is null then
    return null;
  end if;
  version := md5(current_poll::text);
  if p_choice is not null then
    if p_choice < 1 or p_choice > jsonb_array_length(current_poll->'options') then
      raise exception 'Invalid poll option' using errcode = '22023';
    end if;
    insert into qmargin_b74_private.reader_poll_votes (post_id, poll_version, voter, choice)
      values (p_post, version, p_voter, p_choice) on conflict do nothing;
  end if;
  select choice into selected from qmargin_b74_private.reader_poll_votes
    where post_id = p_post and poll_version = version and voter = p_voter;
  if not found then return null; end if;
  select jsonb_agg(coalesce(v.total, 0) order by option.number) into totals
    from generate_series(1, jsonb_array_length(current_poll->'options')) option(number)
    left join (
      select choice, count(*) as total from qmargin_b74_private.reader_poll_votes
        where post_id = p_post and poll_version = version group by choice
    ) v on v.choice = option.number;
  return jsonb_build_object('choice', selected, 'counts', totals);
end;
$$;

create function public.qmargin_b74_reader_poll(p_post uuid, p_poll jsonb, p_voter uuid, p_choice integer default null)
returns jsonb language sql security invoker set search_path = ''
return qmargin_b74_private.reader_poll(p_post, p_poll, p_voter, p_choice);

revoke all on function qmargin_b74_private.reader_poll(uuid, jsonb, uuid, integer),
  public.qmargin_b74_reader_poll(uuid, jsonb, uuid, integer) from public, anon, authenticated;
grant execute on function qmargin_b74_private.reader_poll(uuid, jsonb, uuid, integer),
  public.qmargin_b74_reader_poll(uuid, jsonb, uuid, integer) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
