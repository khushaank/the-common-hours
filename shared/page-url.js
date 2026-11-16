const views = ["archive", "topics", "photos", "start", "privacy", "terms", "collections", "photo-essays"];
const slugPattern = /^[a-z0-9-]{1,120}$/;
const photoPattern = /^(?:[0-9a-f-]{36}|month-\d{4}-\d{2}|cover)$/i;

export function pageParams(search = location.search, pathname = location.pathname) {
  const params = new URLSearchParams(search);
  if (params.has("view") || params.has("post")) return params;
  const file = pathname.split("/").pop().replace(/\.html$/, "");
  if (views.includes(file)) params.set("view", file);
  else if (file.startsWith("entry-") && slugPattern.test(file.slice(6))) params.set("post", file.slice(6));
  else if (file.startsWith("photo-") && photoPattern.test(file.slice(6))) {
    params.set("view", "photo");
    params.set("photo", file.slice(6));
  }
  return params;
}

export function pageHref(values) {
  const params = new URLSearchParams(values);
  let file = "./";
  const view = params.get("view");
  const slug = params.get("post");
  if (!view && slugPattern.test(slug || "")) {
    file = "entry-" + slug + ".html";
    params.delete("post");
  } else if (views.includes(view)) {
    file = view + ".html";
    params.delete("view");
  } else if (view === "photo" && photoPattern.test(params.get("photo") || "")) {
    file = "photo-" + params.get("photo") + ".html";
    params.delete("view");
    params.delete("photo");
  }
  // New publications remain readable before the next static build.
  if (/^(?:entry-|photo-)/.test(file) && file !== "photo-essays.html" && typeof document !== "undefined" &&
      !document.querySelector("#public-pages")?.dataset.files.split(" ").includes(file)) {
    return "./?" + new URLSearchParams(values);
  }
  return file + (params.size ? "?" + params : "");
}
