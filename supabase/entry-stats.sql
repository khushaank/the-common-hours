-- Apply after reader-polls.sql and require-desk-mfa.sql.
begin;
set local lock_timeout = '5s';

alter table public.qmargin_b74_traffic
  add column source_counts jsonb not null default '{}'::jsonb;
create index qmargin_b74_traffic_page on public.qmargin_b74_traffic (page);

create function qmargin_b74_private.record_view_source(p_page text, p_post uuid, p_visit boolean, p_source text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  page_key text := p_page;
  source_key text;
begin
  if p_page = 'post' then
    if not exists (select 1 from public.qmargin_b74_posts where id = p_post and published) then return; end if;
    page_key := 'post/' || p_post::text;
    if p_source in ('direct', 'home', 'internal', 'next', 'external') then source_key := p_source; end if;
  elsif p_page is null or p_post is not null or
    p_page not in ('journal', 'archive', 'photos', 'photo', 'privacy', 'terms') then
    return;
  end if;

  insert into public.qmargin_b74_traffic as traffic (day, page, views, visits, source_counts)
    values (timezone('Asia/Kolkata', now())::date, page_key, 1, case when p_visit then 1 else 0 end,
      case when source_key is null then '{}'::jsonb else jsonb_build_object(source_key, 1) end)
  on conflict (day, page) do update
    set views = traffic.views + 1,
        visits = traffic.visits + excluded.visits,
        source_counts = case when source_key is null then traffic.source_counts
          else jsonb_set(traffic.source_counts, array[source_key],
            to_jsonb(coalesce((traffic.source_counts->>source_key)::bigint, 0) + 1)) end;
end;
$$;

create or replace function qmargin_b74_private.record_view(p_page text, p_post uuid, p_visit boolean)
returns void language sql security definer set search_path = ''
as $$ select qmargin_b74_private.record_view_source(p_page, p_post, p_visit, null) $$;

create function public.qmargin_b74_record_view_source(p_page text, p_post uuid, p_visit boolean, p_source text)
returns void language sql security invoker set search_path = ''
return qmargin_b74_private.record_view_source(p_page, p_post, p_visit, p_source);

create function qmargin_b74_private.entry_stats(p_post uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  post_poll jsonb;
  poll_counts jsonb;
  comment_counts jsonb;
  traffic_counts record;
  arrival_counts jsonb;
  page_key text := 'post/' || p_post::text;
begin
  if auth.uid() is null or (auth.jwt() ->> 'is_anonymous') = 'true'
     or (auth.jwt() ->> 'aal') is distinct from 'aal2'
     or not exists (select 1 from public.qmargin_b74_admins where user_id = auth.uid()) then
    raise insufficient_privilege;
  end if;

  select poll into post_poll from public.qmargin_b74_posts where id = p_post and published;
  if not found then return null; end if;

  select coalesce(sum(views), 0) as views, coalesce(sum(visits), 0) as visits into traffic_counts
    from public.qmargin_b74_traffic where page = page_key;
  select coalesce(jsonb_object_agg(source, total), '{}'::jsonb) into arrival_counts from (
    select source, sum(value::bigint) as total from public.qmargin_b74_traffic
      cross join lateral jsonb_each(source_counts) as arrivals(source, value)
      where page = page_key group by source
  ) as totals;
  select jsonb_build_object('total', count(*), 'published', count(*) filter (where approved and not ignored),
    'pending', count(*) filter (where not approved and not ignored), 'ignored', count(*) filter (where ignored))
    into comment_counts from public.qmargin_b74_comments where post_id = p_post;

  if post_poll is not null then
    select jsonb_agg(coalesce(votes.total, 0) order by option.number) into poll_counts
      from generate_series(1, jsonb_array_length(post_poll->'options')) as option(number)
      left join (
        select choice, count(*) as total from qmargin_b74_private.reader_poll_votes
          where post_id = p_post and poll_version = md5(post_poll::text) group by choice
      ) votes on votes.choice = option.number;
    post_poll := post_poll || jsonb_build_object('counts', poll_counts);
  end if;

  return jsonb_build_object('views', traffic_counts.views, 'visits', traffic_counts.visits,
    'sources', arrival_counts, 'comments', comment_counts, 'poll', post_poll);
end;
$$;

create function public.qmargin_b74_entry_stats(p_post uuid)
returns jsonb language sql stable security invoker set search_path = ''
return qmargin_b74_private.entry_stats(p_post);

revoke all on function qmargin_b74_private.record_view_source(text, uuid, boolean, text),
  public.qmargin_b74_record_view_source(text, uuid, boolean, text),
  qmargin_b74_private.entry_stats(uuid), public.qmargin_b74_entry_stats(uuid) from public, anon, authenticated;
grant execute on function qmargin_b74_private.record_view_source(text, uuid, boolean, text),
  public.qmargin_b74_record_view_source(text, uuid, boolean, text) to anon, authenticated;
grant execute on function qmargin_b74_private.entry_stats(uuid),
  public.qmargin_b74_entry_stats(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
