-- Allow a password-authenticated user to check their own desk eligibility.
-- All desk data and editing operations continue to require MFA.
begin;

create or replace function qmargin_b74_private.can_start_desk_sign_in()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and (auth.jwt() ->> 'is_anonymous') is distinct from 'true'
    and exists (select 1 from public.qmargin_b74_admins where user_id = auth.uid());
$$;

create or replace function public.qmargin_b74_can_start_desk_sign_in()
returns boolean language sql stable security invoker set search_path = '' as $$
  select qmargin_b74_private.can_start_desk_sign_in();
$$;

revoke all on function qmargin_b74_private.can_start_desk_sign_in(),
  public.qmargin_b74_can_start_desk_sign_in() from public, anon, authenticated;
grant execute on function qmargin_b74_private.can_start_desk_sign_in(),
  public.qmargin_b74_can_start_desk_sign_in() to authenticated;

notify pgrst, 'reload schema';
commit;
