-- ==============================================================================
-- Supabase Administration: Grant Super Admin / Admin Privileges
-- ==============================================================================
--
-- This project contains two permission models in the same Supabase database:
--
-- 1. Common Hours Journal (Writing Desk & Editorial System):
--    - Admin table: public.qmargin_b74_admins (user_id uuid)
--    - Controls access to the Writing Desk (/folio-...), draft management,
--      publishing entries, comment moderation, media catalog, photo archive,
--      and private analytics.
--
-- 2. Main / Legacy Application:
--    - Profile table: public.profiles
--    - Evaluated by:
--      * public.is_admin_member() -> checks (membership_status = 'approved' AND (role = 'admin' OR is_admin is true))
--      * public.is_admin()        -> checks (is_admin is true)
--    - Enforced by trigger: public.protect_profile_membership()
--      (Must run as postgres, service_role, or an existing admin to modify).
--
-- 3. Supabase Auth (JWT App Metadata):
--    - Table: auth.users (raw_app_meta_data)
--    - Sets claims in JWT (e.g., {"role": "super_admin", "claims_admin": true})
--
-- Instructions:
-- Run this script in the Supabase Dashboard -> SQL Editor (executes as `postgres`).
-- Choose the method that best matches your workflow below.
-- ==============================================================================

begin;

-- ==============================================================================
-- METHOD 1: QUICK PROMOTE BY EMAIL (Recommended)
-- ==============================================================================
-- Replace 'admin@example.com' with the user's actual login email address.
-- This grants admin rights across BOTH the Writing Desk and App Profiles.

do $$
declare
  target_email text := 'admin@example.com'; -- <-- REPLACE WITH TARGET USER EMAIL
  target_user_id uuid;
begin
  -- 1. Find user ID from Supabase auth.users
  select id into target_user_id
  from auth.users
  where email = target_email;

  if target_user_id is null then
    raise exception 'User with email % not found in auth.users. Please register the user first.', target_email;
  end if;

  -- 2. Grant Common Hours Writing Desk Admin (qmargin_b74_admins)
  insert into public.qmargin_b74_admins (user_id)
  values (target_user_id)
  on conflict (user_id) do nothing;

  -- 3. Grant Legacy/App Profile Admin & Super Admin Role (public.profiles)
  -- If profile exists, upgrade it to approved super admin:
  update public.profiles
  set
    role = 'super_admin',
    is_admin = true,
    membership_status = 'approved',
    approved_at = coalesce(approved_at, now()),
    approved_by = coalesce(approved_by, target_user_id)
  where id = target_user_id;

  -- If profile does not exist yet, insert an approved super admin record:
  if not found then
    insert into public.profiles (
      id,
      email,
      username,
      role,
      is_admin,
      membership_status,
      approved_at,
      approved_by
    )
    values (
      target_user_id,
      target_email,
      split_part(target_email, '@', 1),
      'super_admin',
      true,
      'approved',
      now(),
      target_user_id
    )
    on conflict (id) do update set
      role = 'super_admin',
      is_admin = true,
      membership_status = 'approved',
      approved_at = coalesce(public.profiles.approved_at, now());
  end if;

  -- 4. Set Supabase Auth raw_app_meta_data (for JWT role checks)
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) ||
    '{"role": "super_admin", "claims_admin": true}'::jsonb
  where id = target_user_id;

  raise notice 'Successfully granted Super Admin privileges to % (UUID: %)', target_email, target_user_id;
end;
$$;

commit;


-- ==============================================================================
-- METHOD 2: DIRECT SQL COMMANDS BY USER UUID
-- ==============================================================================
-- If you already have the target user's UUID (from Supabase Authentication panel),
-- you can run these individual statements directly:

/*
-- A. Common Hours Writing Desk Admin
insert into public.qmargin_b74_admins (user_id)
values ('00000000-0000-0000-0000-000000000000'::uuid)
on conflict (user_id) do nothing;

-- B. Legacy/Core Application Profile Admin & Super Admin
update public.profiles
set
  role = 'super_admin',
  is_admin = true,
  membership_status = 'approved',
  approved_at = coalesce(approved_at, now()),
  approved_by = coalesce(approved_by, id)
where id = '00000000-0000-0000-0000-000000000000'::uuid;

-- C. Supabase Auth Custom Claims
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) ||
  '{"role": "super_admin", "claims_admin": true}'::jsonb
where id = '00000000-0000-0000-0000-000000000000'::uuid;
*/


-- ==============================================================================
-- METHOD 3: VERIFICATION QUERIES
-- ==============================================================================
-- Run these queries to verify who has admin / super admin access.

-- 1. List Writing Desk admins:
-- select
--   a.user_id,
--   u.email,
--   u.created_at as user_created_at
-- from public.qmargin_b74_admins a
-- left join auth.users u on u.id = a.user_id;

-- 2. List Application Profile admins:
-- select
--   p.id,
--   p.username,
--   p.email,
--   p.role,
--   p.is_admin,
--   p.membership_status,
--   p.approved_at
-- from public.profiles p
-- where p.is_admin is true
--    or p.role in ('admin', 'super_admin')
--    or p.membership_status = 'approved';


-- ==============================================================================
-- METHOD 4: REVOKING / REMOVING ADMIN PRIVILEGES
-- ==============================================================================
-- If you ever need to revoke super admin privileges:

/*
-- 1. Revoke Writing Desk access:
delete from public.qmargin_b74_admins
where user_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- 2. Downgrade Profile to standard member:
update public.profiles
set
  role = 'member',
  is_admin = false
where id = '00000000-0000-0000-0000-000000000000'::uuid;

-- 3. Remove admin claim from Auth metadata:
update auth.users
set raw_app_meta_data = raw_app_meta_data - 'claims_admin' || '{"role": "authenticated"}'::jsonb
where id = '00000000-0000-0000-0000-000000000000'::uuid;
*/
