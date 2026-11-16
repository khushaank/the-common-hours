-- Read-only checks. Returns no article bodies, personal details, credentials, or backups.
begin read only;
set local statement_timeout = '30s';
do $$
begin
  assert not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'qmargin_b74_%'
      and c.relkind in ('r', 'p') and not c.relrowsecurity
  ), 'Every journal table must have RLS';
  assert not has_table_privilege('anon', 'public.qmargin_b74_posts', 'INSERT'), 'Visitors must not insert articles';
  assert not has_table_privilege('anon', 'public.qmargin_b74_posts', 'UPDATE'), 'Visitors must not update articles';
  assert not has_table_privilege('anon', 'public.qmargin_b74_posts', 'DELETE'), 'Visitors must not delete articles';
  assert not has_column_privilege('anon', 'public.qmargin_b74_comments', 'approved', 'INSERT'), 'Visitors must not approve comments';
  assert not has_table_privilege('anon', 'public.qmargin_b74_working_drafts', 'SELECT'), 'Drafts must be private';
  assert not has_table_privilege('anon', 'public.qmargin_b74_traffic', 'SELECT'), 'Analytics must be private';
  assert not has_table_privilege('anon', 'public.qmargin_b74_privacy_requests', 'SELECT'), 'Inbox must be private';
  assert not has_function_privilege('anon', 'public.qmargin_b74_review_attachment(text,uuid)', 'EXECUTE'), 'Attachment helper must be server-only';
  assert not exists (select 1 from storage.buckets where id = 'qmargin-b74-attachments' and public), 'Attachment bucket must not be public';
  if to_regclass('qmargin_b74_private.sample_cleanup_20261116') is not null then
    assert not has_table_privilege('anon', 'qmargin_b74_private.sample_cleanup_20261116', 'SELECT'), 'Cleanup backup must not be public';
    assert not has_table_privilege('authenticated', 'qmargin_b74_private.sample_cleanup_20261116', 'SELECT'), 'Cleanup backup must not be readable by browser accounts';
  end if;
end;
$$;

select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  assert not exists (select 1 from public.qmargin_b74_posts where not published), 'A visitor can read drafts';
  assert not exists (select 1 from public.qmargin_b74_comments where not approved), 'A visitor can read pending comments';
  assert not exists (
    select 1 from public.qmargin_b74_media m
    where not exists (select 1 from public.qmargin_b74_posts p where strpos(p.body, m.id::text) > 0)
      and not exists (select 1 from public.qmargin_b74_weekly_photos p where p.media_id = m.id)
      and not exists (select 1 from public.qmargin_b74_photos p where p.media_id = m.id)
  ), 'A visitor can read unreferenced private media';
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}', true),
  set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
set local role authenticated;
do $$
begin
  assert not exists (select 1 from public.qmargin_b74_admins), 'An ordinary account can impersonate an admin';
  assert not exists (select 1 from public.qmargin_b74_posts where not published), 'An ordinary account can read drafts';
  assert not exists (select 1 from public.qmargin_b74_working_drafts), 'An ordinary account can read working drafts';
  assert not exists (select 1 from public.qmargin_b74_privacy_requests), 'An ordinary account can read inbox messages';
  assert not exists (select 1 from public.qmargin_b74_traffic), 'An ordinary account can read analytics';
end;
$$;
reset role;
select 'PASS: journal metadata, visitor access, and non-admin access checks' as result;
rollback;
