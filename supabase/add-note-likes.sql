begin;

create table if not exists qmargin_b74_private.note_like_settings (
  singleton boolean primary key default true check (singleton),
  salt text not null default (gen_random_uuid()::text || gen_random_uuid()::text)
);
insert into qmargin_b74_private.note_like_settings default values on conflict do nothing;

create table if not exists qmargin_b74_private.note_likes (
  note_id uuid not null references public.qmargin_b74_posts(id) on delete cascade,
  viewer_key bytea not null check (octet_length(viewer_key) = 32),
  primary key (note_id, viewer_key)
);
alter table qmargin_b74_private.note_like_settings enable row level security;
alter table qmargin_b74_private.note_likes enable row level security;
revoke all on qmargin_b74_private.note_like_settings, qmargin_b74_private.note_likes from public, anon, authenticated;

create or replace function qmargin_b74_private.note_likes(p_notes uuid[], p_like uuid)
returns table (note_id uuid, total bigint, liked boolean, can_like boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  client_ip inet;
  ip_text text;
  secret text;
begin
  if p_notes is null or cardinality(p_notes) > 40 then return; end if;
  ip_text := nullif(current_setting('request.headers', true), '')::jsonb ->> 'cf-connecting-ip';
  begin
    client_ip := split_part(ip_text, '%', 1)::inet;
    if masklen(client_ip) <> (case family(client_ip) when 4 then 32 else 128 end) then
      client_ip := null;
    end if;
  exception when invalid_text_representation then
    client_ip := null;
  end;
  select salt into strict secret from qmargin_b74_private.note_like_settings;

  if p_like is not null and p_like = any(p_notes) and client_ip is not null then
    insert into qmargin_b74_private.note_likes as votes (note_id, viewer_key)
    select p.id, sha256(convert_to(secret || p.id::text || host(client_ip), 'UTF8'))
    from public.qmargin_b74_posts p where p.id = p_like and p.published and p.is_note
    on conflict on constraint note_likes_pkey do nothing;
  end if;

  return query
    select p.id, count(votes.viewer_key),
      coalesce(bool_or(votes.viewer_key = sha256(convert_to(secret || p.id::text || host(client_ip), 'UTF8'))), false),
      client_ip is not null
    from public.qmargin_b74_posts p
    left join qmargin_b74_private.note_likes votes on votes.note_id = p.id
    where p.id = any(p_notes) and p.published and p.is_note
    group by p.id;
end;
$$;

create or replace function public.qmargin_b74_note_likes(p_notes uuid[], p_like uuid default null)
returns table (note_id uuid, total bigint, liked boolean, can_like boolean)
language sql set search_path = ''
as $$ select * from qmargin_b74_private.note_likes(p_notes, p_like) $$;

revoke all on function qmargin_b74_private.note_likes(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.qmargin_b74_note_likes(uuid[], uuid) from public, anon, authenticated;
grant execute on function qmargin_b74_private.note_likes(uuid[], uuid), public.qmargin_b74_note_likes(uuid[], uuid) to anon, authenticated;

commit;
