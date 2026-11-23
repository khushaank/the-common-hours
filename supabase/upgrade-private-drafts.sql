-- Apply after upgrade-desk-workflow.sql.
begin;
set local lock_timeout = '5s';

alter table public.qmargin_b74_comments
  add column if not exists deleted_entry_title text,
  alter column post_id drop not null,
  drop constraint if exists qmargin_b74_comments_post_id_fkey;
alter table public.qmargin_b74_comments add constraint qmargin_b74_comments_post_id_fkey
  foreign key (post_id) references public.qmargin_b74_posts(id) on delete set null;

create or replace function qmargin_b74_private.remember_deleted_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.qmargin_b74_comments
    set deleted_entry_title = old.title, post_id = null
    where post_id = old.id;
  return old;
end;
$$;
revoke all on function qmargin_b74_private.remember_deleted_entry() from public, anon, authenticated;
create or replace trigger qmargin_b74_remember_deleted_entry before delete on public.qmargin_b74_posts
  for each row execute function qmargin_b74_private.remember_deleted_entry();

-- Private drafts have their own lifecycle, even if an original is deleted.
drop trigger if exists qmargin_b74_clear_deleted_entry_drafts on public.qmargin_b74_posts;

create or replace function qmargin_b74_private.create_draft_preview(p_slot text, p_token text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  draft jsonb;
  expiry timestamptz;
begin
  if owner_id is null or (auth.jwt() ->> 'is_anonymous') = 'true' or
     not exists (select 1 from public.qmargin_b74_admins where user_id = owner_id) then
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
    'photo_essay', coalesce(draft ->> 'photo_essay' = 'true', false)
  )) returning expires_at into expiry;
  return expiry;
end;
$$;
create or replace function public.qmargin_b74_create_draft_preview(p_slot text, p_token text)
returns timestamptz language sql security invoker set search_path = '' as $$
  select qmargin_b74_private.create_draft_preview(p_slot, p_token);
$$;
revoke all on function qmargin_b74_private.create_draft_preview(text, text),
  public.qmargin_b74_create_draft_preview(text, text) from public, anon, authenticated;
grant execute on function qmargin_b74_private.create_draft_preview(text, text),
  public.qmargin_b74_create_draft_preview(text, text) to authenticated;

create or replace function qmargin_b74_private.remove_draft_previews()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from qmargin_b74_private.review_links
  where owner_id = old.user_id and entry_slot = old.slot and post_id is null and not is_published;
  return old;
end;
$$;
revoke all on function qmargin_b74_private.remove_draft_previews() from public, anon, authenticated;
create or replace trigger qmargin_b74_remove_draft_previews after delete on public.qmargin_b74_working_drafts
  for each row execute function qmargin_b74_private.remove_draft_previews();

notify pgrst, 'reload schema';
commit;
