-- Run in the Supabase SQL editor as postgres. One result, metadata only.
-- Checks legacy profiles/site_settings, not the qmargin_b74 journal tables.
-- Does not change permissions, rows, accounts, or policies; never reads setting values.
begin read only;
set local statement_timeout = '30s';

select jsonb_build_object(
  'profile_triggers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'trigger_name', t.tgname,
      'enabled', t.tgenabled,
      'trigger_definition', pg_get_triggerdef(t.oid),
      'function_definition', pg_get_functiondef(t.tgfoid)
    ) order by t.tgname)
    from pg_trigger t
    where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal
  ), '[]'::jsonb),
  'profile_sensitive_columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'column_name', c.column_name,
      'column_default', c.column_default,
      'authenticated_insert', has_column_privilege(
        'authenticated', 'public.profiles', c.column_name, 'INSERT'),
      'authenticated_update', has_column_privilege(
        'authenticated', 'public.profiles', c.column_name, 'UPDATE')
    ) order by c.column_name)
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'profiles'
      and c.column_name in ('id', 'role', 'is_admin', 'membership_status')
  ), '[]'::jsonb),
  'profile_constraints', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', c.conname, 'definition', pg_get_constraintdef(c.oid)
    ) order by c.conname)
    from pg_constraint c where c.conrelid = 'public.profiles'::regclass
  ), '[]'::jsonb),
  'password_named_setting_exists', exists(
    select 1 from public.site_settings where id = 'admin_password'
  )
) as security_follow_up;

rollback;
