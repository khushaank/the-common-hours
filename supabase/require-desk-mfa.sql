-- Publish the authenticator-capable writing desk before applying this migration.
begin;
set local lock_timeout = '5s';

alter policy qmargin_b74_own_admin_record on public.qmargin_b74_admins
  using (
    user_id = (select auth.uid())
    and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

-- These older RPCs have no current callers. Existing preview links remain readable.
revoke execute on function public.qmargin_b74_create_review(text,jsonb),
  public.qmargin_b74_sync_reviews(text,jsonb,text,boolean,uuid,boolean),
  qmargin_b74_private.create_review(text,jsonb),
  qmargin_b74_private.sync_reviews(text,jsonb,text,boolean,uuid,boolean)
  from public, anon, authenticated;

-- Owner-executed helpers bypass the admin table's RLS and check the JWT explicitly.
create or replace function qmargin_b74_private.create_draft_preview(p_slot text, p_token text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  draft jsonb;
  expiry timestamptz;
begin
  if owner_id is null or (auth.jwt() ->> 'is_anonymous') = 'true'
     or (auth.jwt() ->> 'aal') is distinct from 'aal2'
     or not exists (select 1 from public.qmargin_b74_admins where user_id = owner_id) then
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

create or replace function qmargin_b74_private.can_delete_asset(p_id text, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and (auth.jwt() ->> 'is_anonymous') is distinct from 'true'
    and (auth.jwt() ->> 'aal') is not distinct from 'aal2'
    and exists (select 1 from public.qmargin_b74_admins where user_id = auth.uid())
    and p_id ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and p_kind in ('image', 'file')
    and not exists (select 1 from public.qmargin_b74_posts where strpos(body, p_id) > 0)
    and not exists (select 1 from public.qmargin_b74_working_drafts where strpos(fields ->> 'body', p_id) > 0)
    and not exists (
      select 1 from qmargin_b74_private.review_links
      where expires_at > now() and not is_published and strpos(fields ->> 'body', p_id) > 0
    );
$$;

notify pgrst, 'reload schema';
commit;
