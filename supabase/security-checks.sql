-- The Common Hours: ONE combined read-only security report.
-- Run this ENTIRE file in the journal project's Supabase SQL Editor as postgres.
-- The last result table contains all catalog, anonymous, and non-editor checks.
-- Expand/export the result JSON cells to see the rows inside each named group.
-- No application records, schemas, policies, functions, grants, or accounts change.
-- Report data is held only in a transaction-local session setting, then rolled back.
-- No temporary tables or permanent helper functions are created.
-- A09 includes database function definitions; A15 includes editor UUIDs.
-- This checks database controls, not HTTP headers, exposed frontend secrets,
-- XSS, MFA/CAPTCHA settings, or abuse controls configured outside PostgreSQL.
-- Interpret A's policies/grants together with B/C: zero visible rows alone can
-- also mean the tables contain no private records. Review every SECURITY DEFINER
-- function's authorization; anonymous EXECUTE can be intentional for read_review.
-- Expected: A01 objects present; A02 RLS enabled; anon/authenticated must not have
-- superuser/BYPASSRLS; B02 RLS active; B03 sensitive grants false;
-- B04 and C02 private-row counts zero; C01 role authenticated with an unlisted UUID.
-- A10 attachment bucket should be private with a 26214400-byte limit.
-- Ordinary authenticated write grants can be legitimate when editor-only RLS
-- blocks non-editors. This script does not attempt production writes.
-- For storage.objects, inspect ALL policies, including policies from other apps.

begin read only;
set local statement_timeout = '30s';

-- A: collect the privileged catalog inspection, not a privileged data-leak test.
select set_config('qmargin_audit.report',
jsonb_build_object(
  'A01_expected_objects', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
with expected(schema_name, table_name) as (values
  ('public', 'qmargin_b74_admins'),
  ('public', 'qmargin_b74_posts'),
  ('public', 'qmargin_b74_comments'),
  ('public', 'qmargin_b74_media'),
  ('public', 'qmargin_b74_photos'),
  ('public', 'qmargin_b74_weekly_photos'),
  ('public', 'qmargin_b74_privacy_requests'),
  ('public', 'qmargin_b74_traffic'),
  ('public', 'qmargin_b74_working_drafts'),
  ('public', 'qmargin_b74_asset_details'),
  ('public', 'qmargin_b74_entry_slugs'),
  ('qmargin_b74_private', 'review_links'),
  ('storage', 'objects')
)
select schema_name, table_name,
  case when to_regclass(format('%I.%I', schema_name, table_name)) is null
    then 'MISSING' else 'present' end as object_status
from expected order by schema_name, table_name
) audit_row), '[]'::jsonb),
  'A02_rls_flags', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select n.nspname as schema_name, c.relname as table_name,
  c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls,
  pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and (
  n.nspname in ('public', 'qmargin_b74_private')
  or (n.nspname = 'storage' and c.relname = 'objects')
) order by n.nspname, c.relname
) audit_row), '[]'::jsonb),
  'A03_database_roles', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select rolname, rolsuper, rolbypassrls, rolcanlogin
from pg_roles where rolname in ('anon', 'authenticated', 'service_role')
) audit_row), '[]'::jsonb),
  'A04_table_grants', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select n.nspname as schema_name, c.relname as table_name, r.role_name,
  has_any_column_privilege(r.role_name::name, c.oid, 'SELECT') as can_select_any_column,
  has_any_column_privilege(r.role_name::name, c.oid, 'INSERT') as can_insert_any_column,
  has_any_column_privilege(r.role_name::name, c.oid, 'UPDATE') as can_update_any_column,
  has_table_privilege(r.role_name::name, c.oid, 'DELETE') as can_delete,
  has_table_privilege(r.role_name::name, c.oid, 'TRUNCATE') as can_truncate
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'::text), ('authenticated'::text)) r(role_name)
where c.relkind in ('r', 'p') and (
  n.nspname in ('public', 'qmargin_b74_private')
  or (n.nspname = 'storage' and c.relname = 'objects')
) order by n.nspname, c.relname, r.role_name
) audit_row), '[]'::jsonb),
  'A05_sensitive_column_grants', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select c.relname as table_name, a.attname as column_name, r.role_name,
  a.attnotnull as not_null,
  has_column_privilege(r.role_name::name, c.oid, a.attnum, 'SELECT') as can_select,
  has_column_privilege(r.role_name::name, c.oid, a.attnum, 'INSERT') as can_insert,
  has_column_privilege(r.role_name::name, c.oid, a.attnum, 'UPDATE') as can_update
from pg_class c join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid
cross join (values ('anon'::text), ('authenticated'::text)) r(role_name)
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and c.relname in ('qmargin_b74_admins', 'qmargin_b74_posts',
    'qmargin_b74_comments', 'qmargin_b74_privacy_requests')
  and a.attnum > 0 and not a.attisdropped
order by c.relname, r.role_name, a.attnum
) audit_row), '[]'::jsonb),
  'A06_policies', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'qmargin_b74_private')
  or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname
) audit_row), '[]'::jsonb),
  'A07_views', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select n.nspname as schema_name, c.relname as view_name, c.relkind, c.reloptions,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'qmargin_b74_private') and c.relkind in ('v', 'm')
order by n.nspname, c.relname
) audit_row), '[]'::jsonb),
  'A08_function_grants', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select n.nspname as schema_name, p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer, p.proconfig as function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'qmargin_b74_private') and p.prokind = 'f'
order by n.nspname, p.proname
) audit_row), '[]'::jsonb),
  'A09_definer_function_bodies', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select n.nspname as schema_name, p.proname as function_name,
  pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'qmargin_b74_private')
  and p.prokind = 'f' and p.prosecdef
order by n.nspname, p.proname
) audit_row), '[]'::jsonb),
  'A10_attachment_bucket', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'qmargin-b74-attachments'
) audit_row), '[]'::jsonb),
  'A11_field_constraints', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select n.nspname as schema_name, c.relname as table_name, con.conname,
  con.contype, pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'qmargin_b74_%'
order by c.relname, con.conname
) audit_row), '[]'::jsonb),
  'A12_submission_indexes', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select schemaname, tablename, indexname, indexdef
from pg_indexes where schemaname = 'public'
  and tablename in ('qmargin_b74_comments', 'qmargin_b74_privacy_requests', 'qmargin_b74_traffic')
order by tablename, indexname
) audit_row), '[]'::jsonb),
  'A13_triggers', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select n.nspname as schema_name, c.relname as table_name,
  t.tgname, pg_get_triggerdef(t.oid) as trigger_definition,
  pg_get_functiondef(t.tgfoid) as trigger_function
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'public' and c.relname like 'qmargin_b74_%'
order by c.relname, t.tgname
) audit_row), '[]'::jsonb),
  'A14_api_settings', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select case when s.setrole = 0 then 'all roles' else pg_get_userbyid(s.setrole) end as role_name,
  setting
from pg_db_role_setting s cross join lateral unnest(s.setconfig) as config(setting)
where setting like 'pgrst.db_pre_request=%' or setting like 'pgrst.db_schemas=%'
) audit_row), '[]'::jsonb),
  'A15_editor_membership', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select user_id as configured_editor_uuid from public.qmargin_b74_admins
) audit_row), '[]'::jsonb)
)::text, true);

-- B: actually query as anon. Clear legacy claims so they cannot override JWT JSON.
select set_config('request.jwt.claim', '', true),
  set_config('request.jwt.claim.sub', '', true),
  set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select set_config('qmargin_audit.report',
  (current_setting('qmargin_audit.report')::jsonb || jsonb_build_object(
  'B01_anonymous_context', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select current_user as tested_role, auth.uid() as expected_null_user
) audit_row), '[]'::jsonb),
  'B02_anonymous_rls_active', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select c.relname as table_name, row_security_active(c.oid) as rls_active_for_this_role
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'qmargin_b74_%'
order by c.relname
) audit_row), '[]'::jsonb),
  'B03_anonymous_sensitive_grants', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select
  has_any_column_privilege(current_user, 'public.qmargin_b74_privacy_requests', 'SELECT') as can_read_contacts,
  has_any_column_privilege(current_user, 'public.qmargin_b74_working_drafts', 'SELECT') as can_read_drafts,
  has_any_column_privilege(current_user, 'public.qmargin_b74_admins', 'INSERT') as can_add_administrator,
  has_any_column_privilege(current_user, 'public.qmargin_b74_posts', 'INSERT') as can_insert_article,
  has_any_column_privilege(current_user, 'public.qmargin_b74_posts', 'UPDATE') as can_edit_article,
  has_column_privilege(current_user, 'public.qmargin_b74_comments', 'approved', 'INSERT') as can_submit_approval,
  has_column_privilege(current_user, 'public.qmargin_b74_comments', 'approved', 'UPDATE') as can_approve_comment,
  has_table_privilege(current_user, 'public.qmargin_b74_comments', 'DELETE') as can_delete_comment
) audit_row), '[]'::jsonb),
  'B04_anonymous_private_rows', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select 'unpublished posts' as check_name, count(*) as visible_private_rows
from public.qmargin_b74_posts where not published
union all
select 'unapproved comments', count(*) from public.qmargin_b74_comments where not approved
union all
select 'comments on unpublished posts', count(*) from public.qmargin_b74_comments c
where not exists (select 1 from public.qmargin_b74_posts p where p.id = c.post_id and p.published)
union all
select 'future monthly photos', count(*) from public.qmargin_b74_photos
where month > date_trunc('month', timezone('Asia/Kolkata', now()))::date
union all
select 'future weekly photos', count(*) from public.qmargin_b74_weekly_photos
where week > date_trunc('week', timezone('Asia/Kolkata', now()))::date
) audit_row), '[]'::jsonb)
))::text, true);
reset role;

-- C: simulate an unlisted signed-in user without creating an Auth account.
select set_config('request.jwt.claim', '', true),
  set_config('request.jwt.claim.sub', '', true),
  set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', gen_random_uuid()::text, 'role', 'authenticated', 'is_anonymous', false
)::text, true);
set local role authenticated;
select set_config('qmargin_audit.report',
  (current_setting('qmargin_audit.report')::jsonb || jsonb_build_object(
  'C01_non_editor_context', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select current_user as tested_role, auth.uid() as simulated_non_editor_uuid
) audit_row), '[]'::jsonb),
  'C02_non_editor_private_rows', coalesce((select jsonb_agg(to_jsonb(audit_row)) from (
select 'administrator membership' as check_name, count(*) as visible_private_rows
from public.qmargin_b74_admins
union all
select 'unpublished posts', count(*) from public.qmargin_b74_posts where not published
union all
select 'unapproved comments', count(*) from public.qmargin_b74_comments where not approved
union all
select 'private contact requests', count(*) from public.qmargin_b74_privacy_requests
union all
select 'working drafts', count(*) from public.qmargin_b74_working_drafts
union all
select 'private asset metadata', count(*) from public.qmargin_b74_asset_details
union all
select 'private traffic', count(*) from public.qmargin_b74_traffic
) audit_row), '[]'::jsonb)
))::text, true);
reset role;

-- One final result set: all 21 named groups, including empty arrays.
select key as check_group, value as result
from jsonb_each(current_setting('qmargin_audit.report')::jsonb)
order by key;

rollback;
