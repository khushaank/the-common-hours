import { allRows, markdownMarker, mediaId, missingColumn, missingFeature } from "./common.js";
import { mediaReferences } from "./rich.js";

async function optionalRows(api, path) {
  try { return await allRows(api, path); }
  catch (error) { if (missingFeature(error)) return []; throw error; }
}

async function readImages(api) {
  try { return await allRows(api, "media?select=id,alt&order=id"); }
  catch (error) {
    if (!missingColumn(error)) throw error;
    return allRows(api, "media?select=id&order=id");
  }
}

export async function loadCatalog(api, listFiles) {
  const [media, posts, drafts, weekly, monthly, details, files] = await Promise.all([
    readImages(api),
    allRows(api, "posts?select=body&order=published_on.desc,id.desc"),
    optionalRows(api, "working_drafts?select=fields&order=saved_at.desc"),
    optionalRows(api, "weekly_photos?select=media_id,title,alt,description&order=week.desc,created_at.desc,id"),
    optionalRows(api, "photos?select=media_id,alt,caption&order=month.desc"),
    optionalRows(api, "asset_details?select=kind,asset_id,title,description,original_name&order=kind,asset_id"),
    listFiles ? listFiles() : [],
  ]);
  const titles = new Map();
  for (const body of [...posts.map(post => post.body), ...drafts.map(draft => markdownMarker + draft.fields.body)]) {
    for (const item of mediaReferences(body)) {
      const key = item.kind + item.id;
      if (!titles.has(key)) titles.set(key, item);
    }
  }
  const photos = new Map();
  for (const photo of [...weekly, ...monthly.map(row => ({ ...row, title: row.caption }))]) {
    if (!photos.has(photo.media_id)) photos.set(photo.media_id, photo);
  }
  const metadata = new Map(details.map(row => [row.kind + row.asset_id, row]));
  const images = media.map(({ id, alt }) => {
    const details = metadata.get("image" + id);
    const photo = photos.get(id);
    return {
      kind: "image", id, type: "image", alt: alt || photo?.alt || titles.get("image" + id)?.alt || "",
      title: details?.title ?? photo?.title ?? "", description: details?.description ?? photo?.description ?? "",
    };
  });
  const attachments = files.filter(file => mediaId.test(file.name)).map(file => {
    const details = metadata.get("file" + file.name);
    const original = details?.original_name || titles.get("file" + file.name)?.title || "";
    const filename = details?.title || original || "Untitled file";
    const ext = (original || filename).split(".").at(-1).toLowerCase();
    const type = ext === "pdf" ? "pdf" : /^(docx?|odt|rtf|txt|md|xlsx?|ods|csv|pptx?|odp)$/.test(ext) ? "document" : "file";
    return { kind: "file", id: file.name, type, title: filename, original, description: details?.description || "", size: file.metadata?.size };
  });
  return [...images, ...attachments].sort((a, b) => (a.title || a.alt || "\uffff").localeCompare(b.title || b.alt || "\uffff"));
}
