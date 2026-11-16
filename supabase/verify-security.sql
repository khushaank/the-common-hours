-- Run as postgres after both hardening scripts. Metadata + zero/count checks only.
-- No writes, setting values, profile details, or draft contents are returned.
begin read only;
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (has_table_privilege('anon', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
  ) then raise exception 'FAIL: visitor TRUNCATE privilege remains'; end if;
  if has_function_privilege('anon', 'public.qmargin_b74_review_attachment(text,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.qmargin_b74_review_attachment(text,uuid)', 'EXECUTE') then
    raise exception 'FAIL: review attachment helper must be service-only';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgenabled in ('O', 'A') and tgname in
    ('qmargin_b74_limit_comments', 'qmargin_b74_limit_contact', 'qmargin_b74_limit_traffic')) <> 3 then
    raise exception 'FAIL: submission limit triggers missing or disabled';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass
    and tgname = 'protect_profile_membership' and tgenabled in ('O', 'A') and tgtype & 4 = 4 and tgtype & 16 = 16) then
    raise exception 'FAIL: profiles must protect both INSERT and UPDATE';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'qmargin_b74_public_profiles'
    and column_name not in ('id', 'username', 'about', 'avatar_url')) then
    raise exception 'FAIL: unexpected public profile column';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '', true),
  set_config('request.jwt.claim.role', 'anon', true),
  set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  target text;
  visible boolean;
  report jsonb := '{}'::jsonb;
begin
  foreach target in array array['blogs', 'profiles', 'site_settings'] loop
    -- No SELECT grant is already a denial; do not grant access just to test RLS.
    if not has_any_column_privilege(current_user, 'public.' || target, 'SELECT') then
      report := report || jsonb_build_object(target, jsonb_build_object('status', 'denied_without_select_grant'));
      continue;
    end if;
    if target = 'site_settings' and not has_column_privilege(current_user, 'public.site_settings', 'id', 'SELECT') then
      report := report || jsonb_build_object(target, jsonb_build_object('status', 'incomplete_column_grants'));
      continue;
    end if;
    begin
      execute format('select exists (select 1 from public.%I%s)', target,
        case when target = 'site_settings' then ' where id not in (''broadcast_message'', ''maintenance_mode'')' else '' end)
        into visible;
      if visible then raise exception 'FAIL: anonymous private rows visible in %', target; end if;
      report := report || jsonb_build_object(target, jsonb_build_object('status', 'no_private_rows_visible'));
    exception when insufficient_privilege then
      report := report || jsonb_build_object(target, jsonb_build_object('status', 'blocked_by_policy_permissions', 'detail', sqlerrm));
    end;
  end loop;
  perform set_config('qmargin_audit.anonymous_access', report::text, true);
end;
$$;
reset role;

select jsonb_build_object(
  'status', case when exists (
    select 1 from jsonb_each(current_setting('qmargin_audit.anonymous_access')::jsonb)
    where value ->> 'status' in ('blocked_by_policy_permissions', 'incomplete_column_grants')
  ) then 'INCOMPLETE: anonymous query permissions need attention' else 'PASS: metadata and anonymous read checks' end,
  'anonymous_access', current_setting('qmargin_audit.anonymous_access')::jsonb,
  'profile_trigger', (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'protect_profile_membership'),
  'submission_limits', jsonb_build_object('comments', '30 / 15 minutes', 'contact', '10 / hour', 'traffic', '300 / minute'),
  'deployment_checks_remaining', jsonb_build_array(
    'Verify an active/expired review attachment',
    'Publish the journal and writing desk together',
    'Enable production HTTP response headers',
    'Test the older application public profile view integration'
  )
) as security_verification;
rollback;
