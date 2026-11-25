import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("entry stats combine legacy traffic, arrivals, comments, and current poll votes for MFA admins only", async () => {
  const db = new PGlite();
  const post = "531e0000-0000-4000-a000-000000000001";
  const admin = "531e0000-0000-4000-a000-000000000002";
  const voter = "531e0000-0000-4000-a000-000000000003";
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.jwt() returns jsonb language sql as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
      create table public.qmargin_b74_media (id uuid);
      create table public.qmargin_b74_posts (id uuid primary key, published boolean);
      create table public.qmargin_b74_admins (user_id uuid);
      create table public.qmargin_b74_comments (post_id uuid, approved boolean, ignored boolean);
      insert into public.qmargin_b74_admins values ('${admin}');
      insert into public.qmargin_b74_posts values ('${post}', true);
      insert into public.qmargin_b74_comments values ('${post}', true, false), ('${post}', false, true), ('${post}', false, false);
    `);
    for (const migration of ["add-image-library-and-traffic.sql", "reader-polls.sql", "entry-stats.sql"]) {
      await db.exec(await readFile(new URL("./" + migration, import.meta.url), "utf8"));
    }
    const poll = { question: "What should I write next?", options: ["A note", "An article"] };
    const stats = async () => (await db.query("select public.qmargin_b74_entry_stats($1) as result", [post])).rows[0].result;
    await db.query("update public.qmargin_b74_posts set poll=$1", [JSON.stringify(poll)]);
    await db.exec("set role anon");
    await assert.rejects(stats, { code: "42501" });
    await db.query("select public.qmargin_b74_reader_poll($1, $2, $3, 2)", [post, JSON.stringify(poll), voter]);
    await db.query("select public.qmargin_b74_record_view('post',$1,true)", [post]);
    for (const source of ["home", "home", "next", "https://private.example/"]) {
      await db.query("select public.qmargin_b74_record_view_source('post',$1,false,$2)", [post, source]);
    }
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: voter, aal: "aal2" })]);
    await assert.rejects(stats, { code: "42501" });
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: admin, aal: "aal1" })]);
    await assert.rejects(stats, { code: "42501" });
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: admin, aal: "aal2" })]);
    assert.deepEqual(await stats(), {
      views: 5, visits: 1, sources: { home: 2, next: 1 },
      comments: { total: 3, published: 1, pending: 1, ignored: 1 },
      poll: { ...poll, counts: [0, 1] },
    });
  } finally {
    await db.close();
  }
});
