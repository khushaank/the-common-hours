import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("each IP contributes one like to each published note", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema qmargin_b74_private;
      grant usage on schema qmargin_b74_private to anon, authenticated;
      create table public.qmargin_b74_posts (id uuid primary key, published boolean, is_note boolean);
    `);
    await db.exec(await readFile(new URL("./add-note-likes.sql", import.meta.url), "utf8"));
    const first = "10000000-0000-0000-0000-000000000000";
    const second = "20000000-0000-0000-0000-000000000000";
    const article = "30000000-0000-0000-0000-000000000000";
    const draft = "40000000-0000-0000-0000-000000000000";
    await db.exec(`
      insert into public.qmargin_b74_posts values
        ('${first}', true, true), ('${second}', true, true), ('${article}', true, false), ('${draft}', false, true);
      set role anon;
      set request.headers = '{"cf-connecting-ip":"192.0.2.10"}';
    `);
    const read = async (ids, like = null) =>
      (await db.query("select * from public.qmargin_b74_note_likes($1::uuid[], $2::uuid) order by note_id", [ids, like])).rows;
    assert.deepEqual(await read([first, second, article, draft], first), [
      { note_id: first, total: 1, liked: true, can_like: true },
      { note_id: second, total: 0, liked: false, can_like: true },
    ]);
    assert.equal((await read([first], first))[0].total, 1);
    assert.equal((await read([second], second))[0].total, 1);
    await db.exec(`set request.headers = '{"cf-connecting-ip":"2001:db8::10"}';`);
    assert.deepEqual((await read([first], first))[0], { note_id: first, total: 2, liked: true, can_like: true });
    await db.exec(`set request.headers = '{}';`);
    assert.deepEqual((await read([first], first))[0], { note_id: first, total: 2, liked: false, can_like: false });
  } finally { await db.close(); }
});
