import { getProjectOrigin } from "./config.js";
import { markdownMarker, missingFeature, request } from "./common.js";

export function setupReviewLinks(rpc, sessionToken, getEntry, run, status, draftStatus) {
  const result = document.querySelector("#review-result");
  const url = document.querySelector("#review-url");
  const copy = document.querySelector("#copy-review");
  const reconnect = document.querySelector("#reconnect-review");
  const previous = document.querySelector("#previous-review-url");
  const links = new Map();
  const expiryByEntry = new Map();
  const signed = new Map();
  let queue = Promise.resolve();
  let timer;
  let pending;

  const keyFor = ({ owner, slot }) => "common-hours:review:" + getProjectOrigin() + ":" + owner + ":" + slot;
  function getLink(key) {
    try { return links.get(key) || JSON.parse(localStorage.getItem(key)); }
    catch { return links.get(key); }
  }
  function display() {
    const entry = getEntry();
    const link = entry.owner && getLink(keyFor(entry));
    url.value = link ? new URL("../?view=review#" + link.token, location.href).href : "";
    copy.disabled = !link;
    document.querySelector("#review-expiry").textContent = link?.published ? "Opens the published entry" :
      link ? "Draft access expires " + new Date(link.expiry).toLocaleString() : "";
  }

  async function snapshot(fields) {
    const { mediaReferences } = await import("./rich.js");
    const { title, excerpt, tag, body, published_on } = fields;
    const ids = [...new Set(mediaReferences(markdownMarker + body).filter(item => item.kind === "file").map(item => item.id))];
    const files = Object.fromEntries(await Promise.all(ids.map(async id => {
      const known = signed.get(id);
      if (known && known.until > Date.now()) return [id, known.path];
      const response = await request("/storage/v1/object/sign/qmargin-b74-attachments/" + id, {
        method: "POST", token: await sessionToken(), body: { expiresIn: 86460 },
      });
      if (!response?.signedURL?.startsWith("/object/sign/qmargin-b74-attachments/" + id + "?")) {
        throw new Error("Could not prepare a file for review.");
      }
      const path = "/storage/v1" + response.signedURL;
      signed.set(id, { path, until: Date.now() + 3600000 });
      return [id, path];
    })));
    return { title, excerpt, tag, body, published_on, files };
  }

  function sync(entry, options = {}) {
    const key = keyFor(entry);
    const operation = queue.then(async () => {
      if (getEntry().owner !== entry.owner) return;
      const link = getLink(key);
      if (!options.p_post && !options.p_token && (!link || link.published || Date.parse(link.expiry) <= Date.now())) {
        if (!expiryByEntry.has(key)) expiryByEntry.set(key, await rpc("sync_reviews", { p_slot: entry.slot }));
        if (!(Date.parse(expiryByEntry.get(key)) > Date.now())) return;
      }
      if (options.p_token) signed.clear();
      const expiry = await rpc("sync_reviews", {
        p_slot: entry.slot, p_fields: options.p_publish ? null : await snapshot(entry.fields), ...options,
      });
      const next = keyFor({ ...entry, slot: options.p_post || entry.slot });
      expiryByEntry.set(next, expiry);
      if (options.p_token || link) {
        const updated = { token: options.p_token || link.token, expiry: options.p_token ? expiry : link.expiry,
          published: Boolean(options.p_publish || (!options.p_token && link?.published)) };
        links.set(next, updated);
        if (key !== next) links.delete(key);
        try {
          localStorage.setItem(next, JSON.stringify(updated));
          if (key !== next) localStorage.removeItem(key);
        } catch { /* The link still works in this session. */ }
      }
      if (next === keyFor(getEntry())) display();
    });
    queue = operation.catch(() => {});
    return operation;
  }

  function flush() {
    clearTimeout(timer);
    if (!pending) return;
    const entry = pending;
    pending = undefined;
    sync(entry).catch(error => {
      const current = getEntry();
      if (current.owner === entry.owner && current.slot === entry.slot && getLink(keyFor(entry)) && !missingFeature(error)) {
        draftStatus("Review link could not refresh. Save draft to try again.");
      }
    });
  }

  document.querySelector("#review-entry").addEventListener("click", event => {
    result.hidden = !result.hidden;
    if (result.hidden) return;
    run(event.currentTarget, async () => {
      const entry = getEntry();
      const link = getLink(keyFor(entry));
      if (!entry.fields.body.trim()) throw new Error("Add something to the body before creating a review link.");
      if (link?.published && !entry.dirty) return;
      if (link && !link.published && Date.parse(link.expiry) > Date.now()) {
        if (entry.dirty) await sync(entry);
        return;
      }
      const token = (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
      await sync(entry, { p_token: token });
    }).then(() => { if (url.value) { url.focus(); url.select(); } });
  });
  document.querySelector("#attach-review").addEventListener("click", event => {
    run(event.currentTarget, async () => {
      const entry = getEntry();
      if (!entry.fields.body.trim()) throw new Error("Add something to the body before reconnecting a review link.");
      const token = previous.value.trim().split("#").at(-1);
      if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Paste the previously shared review link.");
      try { await sync(entry, { p_token: token, p_reconnect: true }); }
      catch (error) {
        if (error.code === "P0001") throw new Error("This review link cannot be reconnected to the current entry.");
        throw error;
      }
      previous.value = "";
      reconnect.open = false;
      status.textContent = "Previous review link reconnected.";
    });
  });
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url.value); status.textContent = "Review link copied."; }
    catch { url.focus(); url.select(); }
  });

  return {
    changed() {
      clearTimeout(timer);
      pending = getEntry();
      timer = setTimeout(flush, 750);
    },
    open() {
      flush();
      result.hidden = true;
      reconnect.open = false;
      previous.value = "";
      display();
    },
    async save(options) {
      clearTimeout(timer);
      pending = undefined;
      try { await sync(getEntry(), options); return ""; }
      catch { return " The review link could not be updated."; }
    },
  };
}
