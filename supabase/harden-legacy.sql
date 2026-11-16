-- Based on the policies/columns supplied on 2026-11-16. Run as postgres.
-- No records are removed. No blanket policy removal or changes to storage policies.
-- Legacy public profile pages must use qmargin_b74_public_profiles (see SECURITY.md).
begin;
set local lock_timeout = '5s';

alter table public.blogs enable row level security;
alter table public.site_settings enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "Allow public read access" on public.blogs;
drop policy if exists "Authenticated users can insert blogs" on public.blogs;
drop policy if exists "Allow public read access" on public.site_settings;
drop policy if exists "Users can insert their own profile." on public.profiles;

-- Keep authors' drafts editable after closing the unrestricted SELECT policy.
drop policy if exists qmargin_b74_author_read_blogs on public.blogs;
create policy qmargin_b74_author_read_blogs on public.blogs for select to authenticated
  using (public.is_approved_member() and (author_id = (select auth.uid()) or public.is_admin_member()));

-- A restrictive boundary also covers any remaining overlapping permissive policies.
drop policy if exists qmargin_b74_blog_read_boundary on public.blogs;
create policy qmargin_b74_blog_read_boundary on public.blogs as restrictive for select to authenticated
  using (public.is_approved_member() and
    (status = 'published' or author_id = (select auth.uid()) or public.is_admin_member()));
drop policy if exists qmargin_b74_blog_insert_boundary on public.blogs;
create policy qmargin_b74_blog_insert_boundary on public.blogs as restrictive for insert to authenticated
  with check (public.is_approved_member() and author_id = (select auth.uid()));
drop policy if exists qmargin_b74_blog_anon_boundary on public.blogs;
create policy qmargin_b74_blog_anon_boundary on public.blogs as restrictive for all to anon
  using (false) with check (false);
drop policy if exists qmargin_b74_settings_read_boundary on public.site_settings;
create policy qmargin_b74_settings_read_boundary on public.site_settings as restrictive for select to authenticated
  using (id in ('broadcast_message', 'maintenance_mode') or public.is_admin_member());
drop policy if exists qmargin_b74_settings_anon_boundary on public.site_settings;
create policy qmargin_b74_settings_anon_boundary on public.site_settings as restrictive for select to anon
  using (id in ('broadcast_message', 'maintenance_mode'));
alter policy "Only admins can update site settings" on public.site_settings
  to authenticated
  using (public.is_admin_member())
  with check (id <> 'admin_password' and public.is_admin_member());

-- Replace self-referential profile queries with the existing SECURITY DEFINER helper.
alter policy "Admins can delete any blog" on public.blogs using (public.is_admin_member());
alter policy "Admins can delete blogs" on public.blogs using (public.is_admin_member());
alter policy "Admins can update any blog" on public.blogs using (public.is_admin_member());
alter policy "Admins can update blogs" on public.blogs using (public.is_admin_member());
alter policy "Admins can delete any profile" on public.profiles using (public.is_admin_member());
alter policy "Admins can update any profile" on public.profiles using (public.is_admin_member()) with check (public.is_admin_member());
alter policy "Admins can update is_admin" on public.profiles using (public.is_admin_member()) with check (public.is_admin_member());

-- Private profile columns (especially email) must not be exposed by public SELECT *.
alter policy "Public profiles are viewable by everyone." on public.profiles
  to authenticated
  using (id = (select auth.uid()) or public.is_admin_member());
drop policy if exists qmargin_b74_profile_read_boundary on public.profiles;
create policy qmargin_b74_profile_read_boundary on public.profiles as restrictive for select to authenticated
  using (id = (select auth.uid()) or public.is_admin_member());
drop policy if exists qmargin_b74_profile_anon_boundary on public.profiles;
create policy qmargin_b74_profile_anon_boundary on public.profiles as restrictive for all to anon
  using (false) with check (false);

-- This deliberately projects only non-sensitive fields; owner execution is needed
-- to expose approved, opted-in public profiles without granting private table rows.
create or replace view public.qmargin_b74_public_profiles as
  select id, username, about, avatar_url from public.profiles
  where is_public is true and membership_status = 'approved';
revoke all on public.qmargin_b74_public_profiles from public, anon, authenticated;
grant select on public.qmargin_b74_public_profiles to anon, authenticated;

-- Preserve backend signup/admin jobs. API users cannot forge current_user.
create or replace function public.protect_profile_membership()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then return new; end if;
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise insufficient_privilege using message = 'Profile identity cannot be changed';
  end if;
  if public.is_admin_member() is true then return new; end if;
  if tg_op = 'INSERT' then
    if new.is_admin is distinct from false or new.role is distinct from 'member'
      or new.membership_status is distinct from 'pending'
      or new.approved_at is not null or new.approved_by is not null then
      raise insufficient_privilege using message = 'New profiles must be pending members';
    end if;
  elsif new.membership_status is distinct from old.membership_status
    or new.role is distinct from old.role or new.is_admin is distinct from old.is_admin
    or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by then
    raise insufficient_privilege using message = 'Membership fields cannot be changed by this account';
  end if;
  return new;
end;
$$;
create or replace trigger protect_profile_membership before insert or update on public.profiles
  for each row execute function public.protect_profile_membership();

-- TRUNCATE bypasses RLS. Remove it only where a visitor role currently has it.
-- Other grants, service_role access, and table contents are unchanged.
do $$
declare target record;
begin
  for target in
    select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (has_table_privilege('anon', c.oid, 'TRUNCATE')
        or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
  loop
    execute format('revoke truncate on table %I.%I from public, anon, authenticated', target.nspname, target.relname);
    if has_table_privilege('anon', format('%I.%I', target.nspname, target.relname), 'TRUNCATE')
      or has_table_privilege('authenticated', format('%I.%I', target.nspname, target.relname), 'TRUNCATE') then
      raise exception 'Inherited TRUNCATE remains on %.%; inspect parent-role grants', target.nspname, target.relname;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
