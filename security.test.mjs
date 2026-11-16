import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { reviewAttachment } from "./supabase/functions/review-attachment/handler.mjs";
import { securityHeaders } from "./site-config.mjs";

const id = "12345678-1234-1234-1234-123456789abc";
const token = "a".repeat(64);
const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only-secret" };
const download = body => new Request("https://example.test/review-attachment", {
  method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
});

test("review downloads validate input before accessing privileged APIs", async () => {
  const send = () => { throw new Error("Unexpected network request"); };
  for (const input of ["{", "null", { token, id: "../private" }, { token: "bad", id }]) {
    assert.equal((await reviewAttachment(download(input), env, send)).status, 400);
  }
  assert.equal((await reviewAttachment(download(" ".repeat(1025)), env, send)).status, 413);
  assert.equal((await reviewAttachment(new Request("https://example.test"), env, send)).status, 405);
  assert.equal((await reviewAttachment(new Request("https://example.test", { method: "OPTIONS" }), env, send)).status, 204);
});

test("expired, revoked, unrelated, and failed review checks fail closed", async () => {
  for (const result of [() => Response.json(false), () => new Response("failed", { status: 500 }), () => { throw new Error(); }]) {
    let calls = 0;
    const response = await reviewAttachment(download({ token, id }), env, async () => { calls++; return result(); });
    assert.ok([404, 503].includes(response.status));
    assert.equal(calls, 1);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.doesNotMatch(await response.text(), /server-only-secret/);
  }
});

test("downloads stream bytes, recheck access, and disclose no storage URL or credential", async () => {
  for (const stillAllowed of [true, false]) {
    const calls = [];
    const response = await reviewAttachment(download({ token, id }), env, async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 2) return new Response("private file bytes", { headers: { "Set-Cookie": "internal=secret" } });
      return Response.json(calls.length === 1 || stillAllowed);
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[1].url, env.SUPABASE_URL + "/storage/v1/object/authenticated/qmargin-b74-attachments/" + id);
    assert.equal(calls[0].options.headers.Authorization, "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY);
    assert.deepEqual(JSON.parse(calls[0].options.body), { p_token: token, p_file: id });
    assert.equal(response.status, stillAllowed ? 200 : 404);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    if (stillAllowed) assert.equal(await response.text(), "private file bytes");
  }
});

test("preview sends security headers on assets and missing pages", async t => {
  const child = spawn(process.execPath, ["preview.mjs", "admin", "0"], { cwd: import.meta.dirname, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { child.kill(); if (child.exitCode === null) await once(child, "exit"); });
  const address = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stderr.once("data", bytes => reject(new Error(bytes.toString())));
    child.stdout.once("data", bytes => resolve(bytes.toString().trim()));
  });
  for (const path of ["favicon.svg", "does-not-exist"]) {
    const response = await fetch(new URL(path, address));
    assert.equal(response.status, path === "favicon.svg" ? 200 : 404);
    for (const [name, value] of Object.entries(securityHeaders)) assert.equal(response.headers.get(name), value);
    await response.arrayBuffer();
  }
});

test("review snapshots no longer mint or return signed URLs", async () => {
  const editor = await readFile(new URL("./admin/review-links.js", import.meta.url), "utf8");
  assert.doesNotMatch(editor, /expiresIn|signedURL|object\/sign/);
  const reader = await readFile(new URL("./blog/reading.js", import.meta.url), "utf8");
  assert.match(reader, /\/functions\/v1\/review-attachment/);
  assert.doesNotMatch(reader, /draft\.files|object\/sign/);
});
