// Only call with anonymously readable data. Review links and the writing desk
// never use this cache. Expired data can be used when the network is unavailable.
import { readNote } from "./note.js";
import { searchExcerpt } from "./text.js";

const name = "common-hours-public-v1";
const recent = new Map();
const open = () => typeof caches === "undefined" ? null : caches.open(name).catch(() => null);

export async function publicData(key, fetchData, maxAge = 45000, { fallback = true } = {}) {
  if (recent.has(key)) return recent.get(key);
  const task = (async () => {
    const cache = await open();
    const address = new URL("./?__journal_cache=" + encodeURIComponent(key), import.meta.url);
    const stored = await cache?.match(address).catch(() => null);
    const age = stored && Date.now() - Number(stored.headers.get("x-journal-time"));
    if (stored && age >= 0 && age < maxAge) {
      try { return await stored.json(); } catch { /* Refresh invalid data. */ }
    }
    let data;
    try {
      data = await fetchData();
    } catch (error) {
      if (fallback && stored && (!error.status || error.status >= 500)) {
        try { return await stored.json(); } catch { /* Keep the original error. */ }
      }
      throw error;
    }
    if (cache) {
      const body = JSON.stringify(data);
      if (body.length <= 1500000) {
        void cache.put(address, new Response(body, { headers: { "x-journal-time": String(Date.now()) } })).then(async () => {
          const keys = await cache.keys();
          for (const old of keys.slice(0, Math.max(0, keys.length - 60))) await cache.delete(old);
        }).catch(() => {});
      }
    }
    return data;
  })();
  recent.set(key, task);
  try { return await task; }
  finally { recent.delete(key); }
}

export async function cachedEntries(query) {
  const cache = await open();
  if (!cache) return [];
  const key = id => new URL("./?__journal_cache=" + encodeURIComponent(id), import.meta.url);
  const read = async id => {
    try { return await (await cache.match(key(id)))?.json(); } catch { return null; }
  };
  const posts = await read("posts") || [];
  const term = query.trim();
  if (!term) return [];
  const matches = await Promise.all(posts.map(async post => {
    const entry = await read("post:" + post.slug);
    const body = post.is_note ? readNote(entry?.body ?? post.body).text : entry?.body;
    const snippet = [body, post.excerpt, post.tag, post.title].map(value => searchExcerpt(value, term)).find(Boolean);
    return snippet ? { ...post, snippet } : null;
  }));
  return matches.filter(Boolean).slice(0, 25);
}
