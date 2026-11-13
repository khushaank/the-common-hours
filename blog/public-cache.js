// Only call with anonymously readable data. Review links and the writing desk
// never use this cache. Its short freshness window also bounds unpublishing.
const name = "common-hours-public-v1";
const recent = new Map();
const open = () => typeof caches === "undefined" ? null : caches.open(name).catch(() => null);

export async function publicData(key, fetchData, maxAge = 45000) {
  if (recent.has(key)) return recent.get(key);
  const task = (async () => {
    const cache = await open();
    const address = new URL("./?__journal_cache=" + encodeURIComponent(key), import.meta.url);
    const stored = await cache?.match(address).catch(() => null);
    const age = stored && Date.now() - Number(stored.headers.get("x-journal-time"));
    if (stored && age >= 0 && age < maxAge) {
      try { return await stored.json(); } catch { /* Refresh invalid data. */ }
    }
    const data = await fetchData();
    if (cache) {
      const body = JSON.stringify(data);
      if (body.length <= 1500000) {
        void cache.put(address, new Response(body, { headers: { "x-journal-time": String(Date.now()) } })).then(async () => {
          const keys = await cache.keys();
          for (const old of keys.slice(0, Math.max(0, keys.length - 40))) await cache.delete(old);
        }).catch(() => {});
      }
    }
    return data;
  })();
  recent.set(key, task);
  try { return await task; }
  finally { recent.delete(key); }
}
