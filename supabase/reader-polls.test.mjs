import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("readers see a tally after one vote per poll and cannot vote on an unpublished or changed poll", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema qmargin_b74_private;
      create table public.qmargin_b74_posts (id uuid primary key, published boolean not null);
    `);
    await db.exec(await readFile(new URL("./reader-polls.sql", import.meta.url), "utf8"));
    const post = "10000000-0000-4000-a000-000000000001";
    const voter = "10000000-0000-4000-a000-000000000002";
    const secondVoter = "10000000-0000-4000-a000-000000000003";
    const poll = { question: "Coffee or tea?", options: ["Coffee", "Tea"] };
    const updated = { question: "Coffee, tea, or water?", options: ["Coffee", "Tea", "Water"] };
    const save = definition => db.query("update public.qmargin_b74_posts set poll = $1 where id = $2", [JSON.stringify(definition), post]);
    const vote = async (id, choice, definition = poll) => {
      const { rows: [result] } = await db.query("select public.qmargin_b74_reader_poll($1, $2, $3, $4) as tally",
        [post, JSON.stringify(definition), id, choice]);
      return result.tally;
    };

    await db.query("insert into public.qmargin_b74_posts values ($1, true, $2)", [post, JSON.stringify(poll)]);
    await db.exec("set role anon");
    assert.equal(await vote(voter, null), null);
    await assert.rejects(() => vote(voter, 3), { code: "22023" });
    assert.deepEqual(await vote(voter, 2), { choice: 2, counts: [0, 1] });
    assert.deepEqual(await vote(voter, 1), { choice: 2, counts: [0, 1] });
    assert.equal(await vote(secondVoter, null), null);
    assert.deepEqual(await vote(secondVoter, 1), { choice: 1, counts: [1, 1] });
    assert.deepEqual(await vote(voter, null), { choice: 2, counts: [1, 1] });
    await db.exec("reset role");
    await assert.rejects(() => save({ question: "Invalid", options: ["First", " "] }), { code: "23514" });
    await save(updated);
    await db.exec("set role anon");
    assert.equal(await vote(voter, 1), null);
    assert.deepEqual(await vote(voter, 3, updated), { choice: 3, counts: [0, 0, 1] });
    await db.exec("reset role; update public.qmargin_b74_posts set published = false; set role anon");
    assert.equal(await vote(voter, null, updated), null);
  } finally {
    await db.close();
  }
});
