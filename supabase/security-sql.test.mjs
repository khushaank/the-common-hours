// Optional local PostgreSQL engine: see SECURITY.md. Never connects to Supabase.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test("security migrations enforce RLS, profile privileges, submission budgets, and review expiry", {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
  const db = new PGlite();
  const owner = "11111111-1111-1111-1111-111111111111";
  const other = "22222222-2222-2222-2222-222222222222";
  const admin = "33333333-3333-3333-3333-333333333333";
  const pending = "44444444-4444-4444-4444-444444444444";
  const newcomer = "55555555-5555-5555-5555-555555555555";
  const file = "12345678-1234-1234-1234-123456789abc";
  const token = "a".repeat(64);
  const run = file => readFile(new URL(file, import.meta.url), "utf8").then(sql => db.exec(sql));
  const verify = async () => (await run("verify-security.sql")).find(result => result.rows[0]?.security_verification)?.rows[0].security_verification;
  const value = async sql => Object.values((await db.query(sql)).rows[0])[0];
  const as = async (role, uid = "") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await db.exec("set role " + role);
  };
  const denied = (sql, code = "42501") => assert.rejects(db.exec(sql), error => error.code === code);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      grant usage on schema auth, storage to anon, authenticated, service_role;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key, bucket_id text, name text);
      create function storage.allow_any_operation(text[]) returns boolean language sql as $$ select true $$;
      insert into auth.users values ('${owner}'), ('${other}'), ('${admin}'), ('${pending}'), ('${newcomer}');
    `);
    for (const file of ["install.sql", "add-editorial-features.sql", "upgrade-writing-desk.sql", "add-image-library-and-traffic.sql",
      "upgrade-editor-and-reading.sql", "live-review-links.sql", "add-journal-features.sql", "harden-journal.sql"]) await run(file);
    await db.exec(`
      create table public.profiles (
        id uuid primary key references auth.users(id), username text, about text, avatar_url text, email text,
        is_public boolean default false, is_admin boolean default false,
        membership_status text default 'pending', role text default 'member', approved_at timestamptz, approved_by uuid
      );
      create table public.blogs (id bigint primary key, status text, author_id uuid);
      create table public.site_settings (id text primary key, value text);
      grant all on public.profiles, public.blogs, public.site_settings to anon, authenticated;
      create function public.is_admin(check_user_id uuid default auth.uid()) returns boolean
        language sql stable security definer set search_path = '' as $$
          select coalesce(check_user_id = auth.uid(), false) and exists
            (select 1 from public.profiles where id = auth.uid() and is_admin is true) $$;
      create function public.is_admin_member() returns boolean language sql stable security definer set search_path = '' as $$
        select exists (select 1 from public.profiles where id = auth.uid() and membership_status = 'approved' and (role = 'admin' or is_admin is true)) $$;
      create function public.is_approved_member() returns boolean language sql stable security definer set search_path = '' as $$
        select exists (select 1 from public.profiles where id = auth.uid() and membership_status = 'approved') $$;
      create policy "Allow public read access" on public.blogs for select using (true);
      create policy "Authenticated users can insert blogs" on public.blogs for insert to authenticated with check (true);
      create policy "Approved members can read blogs" on public.blogs for select to authenticated using (public.is_approved_member() and status = 'published');
      create policy "Approved members can create blogs" on public.blogs for insert to authenticated with check (public.is_approved_member() and author_id = auth.uid());
      create policy "Approved members can update own blogs" on public.blogs for update to authenticated
        using (public.is_approved_member() and author_id = auth.uid()) with check (public.is_approved_member() and author_id = auth.uid());
      create policy "Allow public read access" on public.site_settings for select to anon, authenticated using (true);
      create policy "Safe site settings are viewable by everyone" on public.site_settings for select using (id in ('broadcast_message', 'maintenance_mode'));
      create policy "Only admins can update site settings" on public.site_settings for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
      create policy "Users can insert their own profile." on public.profiles for insert with check (auth.uid() = id);
      create policy "Accounts can insert own pending profile" on public.profiles for insert to authenticated
        with check (id = auth.uid() and membership_status = 'pending' and role = 'member' and is_admin is not true);
      create policy "Public profiles are viewable by everyone." on public.profiles for select using (true);
      create policy "Users can update own profile." on public.profiles for update using (auth.uid() = id);
    `);
    for (const [table, policies] of [
      ["blogs", { DELETE: ["Admins can delete any blog", "Admins can delete blogs"], UPDATE: ["Admins can update any blog", "Admins can update blogs"] }],
      ["profiles", { DELETE: ["Admins can delete any profile"], UPDATE: ["Admins can update any profile", "Admins can update is_admin"] }],
    ]) for (const [cmd, names] of Object.entries(policies)) for (const name of names) {
      await db.exec(`create policy "${name}" on public.${table} for ${cmd} using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))`);
    }
    await run("harden-legacy.sql");
    // Both migrations must also be safe to run twice.
    await run("harden-journal.sql");
    await run("harden-legacy.sql");
    await db.exec(`
      insert into public.profiles (id, username, email, membership_status, is_public) values
        ('${owner}', 'owner', 'private@example.test', 'approved', true), ('${other}', 'other', 'other@example.test', 'approved', false),
        ('${pending}', 'pending', 'pending@example.test', 'pending', false);
      insert into public.profiles (id, username, membership_status, role, is_admin) values ('${admin}', 'admin', 'approved', 'admin', true);
      insert into public.blogs values (1, 'published', '${owner}'), (2, 'draft', '${owner}'), (3, 'draft', '${other}');
      insert into public.site_settings values ('broadcast_message', 'public'), ('maintenance_mode', 'false'), ('private_setting', 'secret');
      insert into public.qmargin_b74_admins values ('${admin}');
      insert into public.qmargin_b74_posts (id, slug, title, tag, excerpt, body, published) values ('${file}', 'test-entry', 'Test', 'Test', 'Test', 'Body', true);
      insert into qmargin_b74_private.review_links (token_hash, owner_id, fields)
        values (sha256(convert_to('${token}', 'UTF8')), '${admin}',
        jsonb_build_object('body', '[File](attachment:${file})', 'files', jsonb_build_object('${file}', 'legacy-signed-url')));
    `);
    await as("anon");
    assert.equal(await value("select count(*) from public.blogs"), 0);
    assert.equal(await value("select count(*) from public.profiles"), 0);
    assert.equal(await value("select count(*) from public.site_settings"), 2);
    assert.equal(await value("select count(*) from public.qmargin_b74_public_profiles"), 1);
    await denied("select email from public.qmargin_b74_public_profiles", "42703");
    await denied(`select public.qmargin_b74_review_attachment('${token}', '${file}')`);
    assert.equal(await value(`select public.qmargin_b74_read_review('${token}') ? 'files'`), false);
    for (let count = 0; count < 30; count++) await db.exec(`insert into public.qmargin_b74_comments (post_id, display_name, body) values ('${file}', 'Reader', 'Comment')`);
    await denied(`insert into public.qmargin_b74_comments (post_id, display_name, body) values ('${file}', 'Reader', 'Comment')`, "PT429");
    for (let count = 0; count < 9; count++) await db.exec("insert into public.qmargin_b74_privacy_requests (email, message) values ('reader@example.test', 'Contact')");
    await denied("insert into public.qmargin_b74_privacy_requests (email, message) values ('reader@example.test', 'One'), ('reader@example.test', 'Two')", "PT429");
    await db.exec("insert into public.qmargin_b74_privacy_requests (email, message) values ('reader@example.test', 'Tenth')");
    await denied("insert into public.qmargin_b74_privacy_requests (email, message) values ('reader@example.test', 'Contact')", "PT429");
    for (let count = 0; count < 300; count++) await db.exec("select public.qmargin_b74_record_view('journal', null, true)");
    await denied("select public.qmargin_b74_record_view('journal', null, true)", "PT429");
    await denied("update qmargin_b74_private.submission_limits set used = 1");
    await as("authenticated", owner);
    assert.equal(await value("select count(*) from public.blogs"), 2);
    assert.equal(await value("with edited as (update public.blogs set status = status where id = 2 returning id) select count(*) from edited"), 1);
    assert.equal(await value("select count(*) from public.profiles"), 1);
    await db.exec("update public.profiles set username = 'edited' where id = auth.uid()");
    for (const change of ["role = 'admin'", "is_admin = true", "membership_status = 'approved', approved_at = now()", `id = '${newcomer}'`]) {
      await denied("update public.profiles set " + change + " where id = auth.uid()");
    }
    await as("authenticated", pending);
    assert.equal(await value("select count(*) from public.blogs"), 0);
    await denied(`insert into public.blogs values (4, 'published', '${pending}')`);
    await as("authenticated", newcomer);
    for (const fields of ["true, 'member', 'pending'", "null, 'member', 'pending'", "false, 'admin', 'pending'", "false, 'member', 'approved'"]) {
      await denied(`insert into public.profiles (id, is_admin, role, membership_status) values ('${newcomer}', ${fields})`);
    }
    await denied(`insert into public.profiles (id, approved_at) values ('${newcomer}', now())`);
    await db.exec(`insert into public.profiles (id) values ('${newcomer}')`);
    await as("authenticated", admin);
    assert.equal(await value("select count(*) from public.blogs"), 3);
    assert.equal(await value("select count(*) from public.site_settings"), 3);
    await db.exec(`update public.profiles set membership_status = 'approved' where id = '${newcomer}'`);
    await as("service_role");
    assert.equal(await value(`select public.qmargin_b74_review_attachment('${token}', '${file}')`), true);
    await as("postgres");
    await db.exec("update qmargin_b74_private.review_links set expires_at = now() - interval '1 second'");
    await as("service_role");
    assert.equal(await value(`select public.qmargin_b74_review_attachment('${token}', '${file}')`), false);
    await as("postgres");
    await db.exec("update qmargin_b74_private.review_links set expires_at = now() + interval '1 hour', fields = '{}'::jsonb");
    await as("service_role");
    assert.equal(await value(`select public.qmargin_b74_review_attachment('${token}', '${file}')`), false);
    await as("postgres");
    await db.exec("update qmargin_b74_private.submission_limits set started_at = now() - interval '2 hours'");
    await as("anon");
    await db.exec("insert into public.qmargin_b74_privacy_requests (email, message) values ('reader@example.test', 'New window')");
    for (const role of ["anon", "authenticated"]) for (const table of ["profiles", "blogs", "site_settings"]) {
      assert.equal(await value(`select has_table_privilege('${role}', 'public.${table}', 'TRUNCATE')`), false);
    }
    await as("postgres");
    await run("verify-security.sql");
    // Missing SELECT grants are secure denials, not verification failures.
    await db.exec("revoke select on public.blogs from anon");
    await run("verify-security.sql");
    await db.exec("revoke select on public.profiles, public.site_settings from anon");
    await run("verify-security.sql");
    await db.exec("grant select (status) on public.blogs to anon");
    await run("verify-security.sql");
    // A partial setting-value grant cannot silently skip the private-row check.
    await db.exec("grant select (value) on public.site_settings to anon");
    assert.equal((await verify()).anonymous_access.site_settings.status, 'incomplete_column_grants');
    await db.exec("revoke select (value) on public.site_settings from anon; grant select on public.site_settings to anon");
    // Reproduce the original policies against a helper anon cannot execute.
    await db.exec(`
      alter policy qmargin_b74_settings_read_boundary on public.site_settings to anon, authenticated;
      alter policy "Only admins can update site settings" on public.site_settings to public;
      revoke execute on function public.is_admin_member(), public.is_approved_member() from public, anon;
      grant execute on function public.is_admin_member(), public.is_approved_member() to authenticated;
    `);
    const blocked = await verify();
    assert.match(blocked.status, /^INCOMPLETE/);
    assert.equal(blocked.anonymous_access.site_settings.status, 'blocked_by_policy_permissions');
    await run("fix-anonymous-policy-checks.sql");
    await run("fix-anonymous-policy-checks.sql");
    await db.exec("grant select on public.profiles to anon");
    assert.match((await verify()).status, /^PASS/);
    await as("anon");
    assert.equal(await value("select count(*) from public.blogs"), 0);
    assert.equal(await value("select count(*) from public.profiles"), 0);
    assert.equal(await value("select count(*) from public.site_settings"), 2);
    assert.equal(await value("select has_function_privilege('anon', 'public.is_admin_member()', 'EXECUTE')"), false);
    await as("authenticated", admin);
    assert.equal(await value("select count(*) from public.site_settings"), 3);
    await as("postgres");
    // A real leak must still fail verification, rather than being swallowed.
    await db.exec(`
      alter policy qmargin_b74_settings_anon_boundary on public.site_settings using (true);
      create policy test_leak on public.site_settings for select to anon using (true);
    `);
    await assert.rejects(run("verify-security.sql"), /FAIL: anonymous private rows visible in site_settings/);
    await db.exec("rollback; reset role");

    await run("upgrade-desk-workflow.sql");
    await run("upgrade-desk-workflow.sql");
    const image = "66666666-6666-6666-6666-666666666666";
    await db.exec(`
      insert into public.qmargin_b74_media (id, encoded, width, height, alt) values ('${image}', 'AAAA', 1, 1, 'Leaves');
      insert into public.qmargin_b74_weekly_photos (id, week, media_id, title, alt)
      values ('${image}', '2026-11-16', '${image}', 'Leaves', 'Green leaves');
    `);
    await as("authenticated", owner);
    await denied("insert into public.qmargin_b74_references values ('harvey', 'Harvey', 'https://example.test/')");
    assert.equal(await value("select count(*) from public.qmargin_b74_references"), 0);
    assert.equal(await value(`select public.qmargin_b74_delete_image('${image}')`), false);
    assert.equal(await value(`with gone as (delete from public.qmargin_b74_posts where id = '${file}' returning id) select count(*) from gone`), 0);
    await as("authenticated", admin);
    await db.exec(`
      insert into public.qmargin_b74_references values ('harvey', 'Harvey', 'https://example.test/');
      insert into public.qmargin_b74_posts (title, slug, tag, excerpt, body, published, series)
      select 'Part ' || part, 'series-' || part, 'A long tag with words, A second long tag with words', 'Excerpt', 'Body', true, 'Serial'
        from generate_series(1, 10) part;
      insert into public.qmargin_b74_posts (title, slug, tag, excerpt, body, published, series)
      values ('Next', 'series-next', 'Writing, Notes', '', 'Other body', false, 'SERIAL');
    `);
    assert.equal(await value("select series_order from public.qmargin_b74_posts where slug = 'series-next'"), 11);
    await db.exec("update public.qmargin_b74_posts set published = true, excerpt = 'Generated' where slug = 'series-next'");
    assert.equal(await value("select series_order from public.qmargin_b74_posts where slug = 'series-next'"), 11);
    assert.equal(await value(`select public.qmargin_b74_delete_image('${image}')`), false);
    await db.exec(`update public.qmargin_b74_weekly_photos set featured = false where id = '${image}'`);
    assert.equal(await value(`select count(*) from public.qmargin_b74_media where id = '${image}'`), 1);
    await db.exec(`insert into public.qmargin_b74_working_drafts (user_id, slot, fields)
      values ('${admin}', '${file}', jsonb_build_object('body', '![Photo](media:${image})'))`);
    assert.equal(await value(`select public.qmargin_b74_delete_image('${image}')`), false);
    await db.exec(`delete from public.qmargin_b74_posts where id = '${file}'`);
    assert.equal(await value(`select count(*) from public.qmargin_b74_working_drafts where slot = '${file}'`), 0);
    assert.equal(await value(`select public.qmargin_b74_delete_image('${image}')`), true);
    assert.equal(await value(`select count(*) from public.qmargin_b74_media where id = '${image}'`), 0);
    await as("anon");
    await denied("select * from public.qmargin_b74_references");
    await as("postgres");
    await run("reset-sample-traffic.sql");
    assert.equal(await value("select count(*) from public.qmargin_b74_traffic"), 0);
    assert.ok(await value("select jsonb_array_length(rows) from qmargin_b74_private.sample_traffic_20261123") > 0);
    await db.exec("insert into public.qmargin_b74_traffic values (current_date, 'journal', 1, 1)");
    await run("reset-sample-traffic.sql");
    assert.equal(await value("select count(*) from public.qmargin_b74_traffic"), 1);

    await run("keep-entry-links.sql");
    await db.exec(`
      create table qmargin_b74_private.sample_cleanup_20261116 (
        id integer primary key, saved_at timestamptz not null default now(), data jsonb not null
      );
      insert into qmargin_b74_private.sample_cleanup_20261116 (id, data)
      values (1, '{"posts":[],"photos":[],"comments":[]}');
    `);
    const entries = await value("select count(*) from public.qmargin_b74_posts");
    await run("remove-confirmed-samples.sql");
    await run("remove-confirmed-samples.sql");
    assert.equal(await value("select count(*) from public.qmargin_b74_posts"), entries);
    const [verification] = await run("verify-confirmed-samples.sql");
    assert.equal(verification.rows[0].remaining_sample_entries, 0);
    assert.equal(verification.rows[0].remaining_sample_photos, 0);
    assert.equal(verification.rows[0].visitors_can_read_backup, false);
  } finally { await db.close(); }
});
