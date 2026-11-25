import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { readNote, writeNote } from "../shared/note.js";
import { carouselMarkup } from "../shared/carousel.js";

test("one carousel can hold many photos and serve both Notes and articles", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema qmargin_b74_private; create schema auth;
      grant usage on schema qmargin_b74_private, auth to anon, authenticated;
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.uid', true), '')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql as $$
        select coalesce(nullif(current_setting('request.jwt', true), '')::jsonb, '{}'::jsonb)
      $$;
      create table public.qmargin_b74_admins (user_id uuid primary key);
      create table public.qmargin_b74_media (id uuid primary key, alt text, width int, height int, encoded text);
      create table public.qmargin_b74_posts (
        id uuid primary key, title text, published_on date, published boolean, is_note boolean, body text,
        constraint qmargin_b74_note_text_and_media check (true)
      );
      alter table public.qmargin_b74_posts enable row level security;
      alter table public.qmargin_b74_media enable row level security;
      grant select on public.qmargin_b74_posts, public.qmargin_b74_media to anon, authenticated;
      create policy public_posts on public.qmargin_b74_posts for select using (published);
      create table public.qmargin_b74_comments (post_id uuid);
      alter table public.qmargin_b74_comments enable row level security;
      grant select, insert on public.qmargin_b74_comments to anon;
      create policy comments on public.qmargin_b74_comments to anon using (true) with check (true);
      create table qmargin_b74_private.review_links (token_hash bytea, is_published boolean, expires_at timestamptz, fields jsonb);
      create function public.qmargin_b74_delete_image(p_id uuid) returns boolean language sql security definer as $$
        with removed as (delete from public.qmargin_b74_media where id = p_id returning id) select exists (select 1 from removed)
      $$;
      create function public.qmargin_b74_note_likes(uuid[], uuid) returns boolean language sql as $$ select true $$;
      create function qmargin_b74_private.note_likes(uuid[], uuid) returns boolean language sql as $$ select true $$;
    `);
    await db.exec(await readFile(new URL("./reusable-carousels.sql", import.meta.url), "utf8"));
    const photos = Array.from({ length: 90 }, (_, index) => ({
      id: "10000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      alt: "Photograph " + (index + 1).toString().padStart(2, "0") + " along an ordinary country road",
    }));
    const note = "20000000-0000-0000-0000-000000000001";
    const article = "20000000-0000-0000-0000-000000000002";
    const editor = "30000000-0000-0000-0000-000000000001";
    await db.query("insert into public.qmargin_b74_admins values ($1)", [editor]);
    for (const photo of photos) await db.query("insert into public.qmargin_b74_media values ($1,$2,800,1000,'encoded')", [photo.id, photo.alt]);
    const body = writeNote("", { photos, references: [] });
    assert.ok(body.length > 6000);
    const { rows: [published] } = await db.query(
      "insert into public.qmargin_b74_posts values ($1,'The road','2026-11-25',true,true,$2) returning body,note_number", [note, body]);
    assert.equal(published.note_number, 1);
    const [carousel] = readNote(published.body).carousels;
    assert.ok(carousel);
    const members = async () => (await db.query(
      "select media_id from public.qmargin_b74_carousel_photos where carousel_id=$1 order by position", [carousel])).rows.map(row => row.media_id);
    assert.deepEqual(await members(), photos.map(photo => photo.id));
    await db.query("insert into public.qmargin_b74_posts values ($1,'Article','2026-11-25',true,false,$2)", [article, carouselMarkup(carousel)]);
    await db.query("insert into public.qmargin_b74_comments values ($1),($2)", [note, article]);
    await db.exec("set role anon");
    assert.equal((await members()).length, 90);
    assert.equal((await db.query("select id from public.qmargin_b74_media")).rows.length, 90);
    assert.deepEqual((await db.query("select post_id from public.qmargin_b74_comments")).rows, [{ post_id: article }]);
    await assert.rejects(db.query("insert into public.qmargin_b74_comments values ($1)", [note]));
    await db.exec("reset role");
    await db.query("update public.qmargin_b74_posts set published=false where id in ($1,$2)", [note, article]);
    await db.exec("set role anon");
    assert.equal((await members()).length, 0);
    assert.equal((await db.query("select id from public.qmargin_b74_media")).rows.length, 0);
    await db.exec("reset role");
    const token = "a".repeat(64);
    await db.query("insert into qmargin_b74_private.review_links values (sha256(convert_to($1,'UTF8')),false,now()+interval '1 day',$2)", [
      token, { body: carouselMarkup(carousel) },
    ]);
    await db.exec("set role anon");
    assert.equal((await db.query("select public.qmargin_b74_review_carousel($1,$2) as photos", [token, carousel])).rows[0].photos.length, 90);
    await db.exec("reset role");
    const { rows: [republished] } = await db.query("update public.qmargin_b74_posts set published=true where id=$1 returning note_number", [note]);
    assert.equal(republished.note_number, 1);
    await db.exec(`set role authenticated; set request.uid = '${editor}'; set request.jwt = '{"aal":"aal2"}';`);
    await db.query("delete from public.qmargin_b74_carousel_photos where carousel_id=$1 and media_id=$2", [carousel, photos[0].id]);
    assert.equal((await members()).length, 89);
    assert.equal((await db.query("select id from public.qmargin_b74_media where id=$1", [photos[0].id])).rows.length, 0);
    assert.equal((await db.query("select public.qmargin_b74_delete_carousel_photo($1,$2) as deleted", [carousel, photos[1].id])).rows[0].deleted, true);
    assert.equal((await members()).length, 88);
    await db.exec("reset role");
    assert.equal((await db.query("select id from public.qmargin_b74_media where id=$1", [photos[0].id])).rows.length, 1);
    assert.equal((await db.query("select id from public.qmargin_b74_media where id=$1", [photos[1].id])).rows.length, 0);
  } finally { await db.close(); }
});
