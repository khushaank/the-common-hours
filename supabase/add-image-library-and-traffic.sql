-- Apply after upgrade-writing-desk.sql.
begin;

alter table public.qmargin_b74_media
  add column alt text not null default '' check (char_length(alt) <= 200);
grant insert (alt) on public.qmargin_b74_media to authenticated;

create table public.qmargin_b74_traffic (
  day date not null,
  page text not null,
  views bigint not null default 0 check (views >= 0),
  visits bigint not null default 0 check (visits between 0 and views),
  primary key (day, page)
);

alter table public.qmargin_b74_traffic enable row level security;
revoke all on public.qmargin_b74_traffic from public, anon, authenticated;
grant select on public.qmargin_b74_traffic to authenticated;

create policy qmargin_b74_admin_read_traffic on public.qmargin_b74_traffic
  for select to authenticated using ((select exists (select 1 from public.qmargin_b74_admins)));

create schema if not exists qmargin_b74_private;
revoke all on schema qmargin_b74_private from public;
grant usage on schema qmargin_b74_private to anon, authenticated;

-- Atomically update counters without granting visitors table access.
create function qmargin_b74_private.record_view(p_page text, p_post uuid, p_visit boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  page_key text := p_page;
begin
  if p_page = 'post' then
    if not exists (select 1 from public.qmargin_b74_posts where id = p_post and published) then
      return;
    end if;
    page_key := 'post/' || p_post::text;
  elsif p_page is null or p_post is not null or
    p_page not in ('journal', 'archive', 'photos', 'photo', 'privacy', 'terms') then
    return;
  end if;

  insert into public.qmargin_b74_traffic (day, page, views, visits)
    values (timezone('Asia/Kolkata', now())::date, page_key, 1, case when p_visit then 1 else 0 end)
  on conflict (day, page) do update
    set views = qmargin_b74_traffic.views + 1,
        visits = qmargin_b74_traffic.visits + excluded.visits;
end;
$$;

create function public.qmargin_b74_record_view(p_page text, p_post uuid, p_visit boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  select qmargin_b74_private.record_view(p_page, p_post, p_visit);
$$;

revoke all on function qmargin_b74_private.record_view(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.qmargin_b74_record_view(text, uuid, boolean) from public, anon, authenticated;
grant execute on function qmargin_b74_private.record_view(text, uuid, boolean) to anon, authenticated;
grant execute on function public.qmargin_b74_record_view(text, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
