const views = ["archive", "notes", "topics", "photos", "start", "series", "privacy", "terms"];
const retired = ["collections", "photo-essays"];
const slugPattern = /^[a-z0-9-]{1,120}$/;
const photoPattern = /^(?:[0-9a-f-]{36}|month-\d{4}-\d{2}|cover)$/i;
const tagKey = value => btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g, "~").replace(/\//g, "_").replace(/=+$/, "");

export function pageParams(search = location.search, pathname = location.pathname) {
  const params = new URLSearchParams(search);
  if (!params.has("post") && (!params.has("view") || params.get("view") === "archive") && params.get("tag")?.toLowerCase() === "notes") {
    return new URLSearchParams({ view: "notes" });
  }
  if (retired.includes(params.get("view"))) {
    params.set("view", "archive");
    params.delete("collection");
    return params;
  }
  if (params.has("view") || params.has("post")) return params;
  const file = pathname.split("/").pop().replace(/\.html$/, "");
  const archive = /^archive(?:-(year-\d{4}|month-\d{4}-\d{2}|tag-[A-Za-z0-9_~]+))?(?:-page-([1-9]\d*))?$/.exec(file);
  if (archive) {
    params.set("view", "archive");
    if (archive[1]?.startsWith("year-")) params.set("year", archive[1].slice(5));
    if (archive[1]?.startsWith("month-")) params.set("month", archive[1].slice(6));
    if (archive[1]?.startsWith("tag-")) {
      try { params.set("tag", new TextDecoder().decode(Uint8Array.from(atob(archive[1].slice(4).replace(/~/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0)))); }
      catch { /* An unknown archive address falls back to all entries. */ }
    }
    if (archive[2]) params.set("page", archive[2]);
  } else if (retired.includes(file)) params.set("view", "archive");
  else if (views.includes(file)) params.set("view", file);
  else if (file.startsWith("entry-") && slugPattern.test(file.slice(6))) params.set("post", file.slice(6));
  else if (file.startsWith("photo-") && photoPattern.test(file.slice(6))) {
    params.set("view", "photo");
    params.set("photo", file.slice(6));
  }
  return params;
}

export function pageHref(values, { filename = false } = {}) {
  const params = new URLSearchParams(values);
  let file = "./";
  const view = params.get("view");
  const slug = params.get("post");
  if (retired.includes(view)) return filename ? "archive.html" : "archive";
  if (!view && slugPattern.test(slug || "")) {
    file = "entry-" + slug + ".html";
    params.delete("post");
  } else if (view === "archive") {
    file = "archive";
    if (params.get("tag")) { file += "-tag-" + tagKey(params.get("tag")); params.delete("tag"); }
    else if (/^\d{4}-\d{2}$/.test(params.get("month") || "")) { file += "-month-" + params.get("month"); params.delete("month"); }
    else if (/^\d{4}$/.test(params.get("year") || "")) { file += "-year-" + params.get("year"); params.delete("year"); }
    const page = Number.parseInt(params.get("page"), 10);
    if (page > 1) file += "-page-" + page;
    params.delete("page");
    params.delete("view");
    file += ".html";
  } else if (views.includes(view)) {
    file = view + ".html";
    params.delete("view");
  } else if (view === "photo" && photoPattern.test(params.get("photo") || "")) {
    file = "photo-" + params.get("photo") + ".html";
    params.delete("view");
    params.delete("photo");
  }
  // New publications remain readable before the next static build.
  if (!filename && /^(?:entry-|photo-|archive-)/.test(file) && typeof document !== "undefined" &&
      !document.querySelector("#public-pages")?.dataset.files.split(" ").includes(file)) {
    return "./?" + new URLSearchParams(values);
  }
  return (filename ? file : file.replace(/\.html$/, "")) + (params.size ? "?" + params : "");
}
