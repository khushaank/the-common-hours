import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { reviewAttachment } from "./supabase/functions/review-attachment/handler.mjs";
import { securityHeaders } from "./site-config.mjs";
import { renderMarkup } from "./shared/rich.js";

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

test("desk shares draft reviews through the review RPC without signed Storage URLs", async () => {
  const editor = await readFile(new URL("./admin/desk.js", import.meta.url), "utf8");
  assert.doesNotMatch(editor, /setupReviewLinks|review-links\.js|expiresIn|signedURL|object\/sign/);
  assert.match(editor, /adminRpc\("sync_reviews"/);
  assert.match(editor, /url\.hash = token/);
  const reader = await readFile(new URL("./blog/reading.js", import.meta.url), "utf8");
  assert.match(reader, /\/functions\/v1\/review-attachment/);
  assert.doesNotMatch(reader, /draft\.files|object\/sign/);
});

test("article markup cannot inject scripts, handlers, frames, or executable URLs", () => {
  for (const input of [
    '<script>alert(1)</script>', '<img src=x onerror="alert(1)">', '<svg onload="alert(1)"></svg>',
    '<iframe src="https://attacker.invalid"></iframe>', '[click](javascript:alert(1))',
    '[click](jav&#x61;script:alert(1))', '[click](data:text/html;base64,PHNjcmlwdD4=)',
    '![" onerror="alert(1)](media:12345678-1234-1234-1234-123456789abc)',
    '![caption](media:12345678-1234-1234-1234-123456789abc "<img src=x onerror=alert(1)>")',
    '^[<script>alert(1)</script>]',
  ]) {
    const html = renderMarkup(input);
    assert.doesNotMatch(html, /<(?:script|iframe|svg|object|embed)\b/i);
    for (const tag of html.match(/<[^>]+>/g) || []) {
      assert.doesNotMatch(tag.replace(/"[^"]*"|'[^']*'/g, '""'), /\son(?:error|load|click)\s*=/i);
    }
    assert.doesNotMatch(html, /(?:href|src)="(?:javascript|data|vbscript):/i);
  }
});

test("the desk refuses to expose its UI inside a frame", async () => {
  const source = await readFile(new URL("./admin/desk.js", import.meta.url), "utf8");
  const guard = source.slice(source.indexOf("if (window.top"), source.indexOf("const login ="));
  let cleared = false;
  assert.throws(() => runInNewContext(guard, { window: { top: {}, self: {} }, document: { body: { replaceChildren() { cleared = true; } } } }), /Open the writing desk directly/);
  assert.equal(cleared, true);
  const sameWindow = {};
  assert.doesNotThrow(() => runInNewContext(guard, { window: { top: sameWindow, self: sameWindow } }));
});
