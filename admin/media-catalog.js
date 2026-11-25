import { allRows, markdownMarker, mediaId, missingColumn, missingFeature } from "./common.js";
import { mediaReferences } from "./rich.js";

async function optionalRows(api, path) {
  try { return await allRows(api, path); }
  catch (error) { if (missingFeature(error)) return []; throw error; }
}

async function readImages(api) {
  try { return await allRows(api, "media?select=id,alt,width,height&order=id"); }
  catch (error) {
    if (!missingColumn(error)) throw error;
    return allRows(api, "media?select=id,width,height&order=id");
  }
}

export async function readCarouselCatalog(api) {
  const [carousels, members] = await Promise.all([
    optionalRows(api, "carousels?select=id,title,cover_media_id&order=title,id").catch(error => {
      if (!missingColumn(error)) throw error;
      return optionalRows(api, "carousels?select=id,title&order=title,id");
    }),
    optionalRows(api, "carousel_photos?select=carousel_id,media_id,alt,media:qmargin_b74_media(width,height,alt)&order=position"),
  ]);
  const groups = new Map(carousels.map(item => [item.id, { ...item, kind: "carousel", type: "carousel", photos: [] }]));
  for (const row of members) groups.get(row.carousel_id)?.photos.push({
    id: row.media_id, alt: row.alt || row.media?.alt || "", width: row.media?.width, height: row.media?.height,
  });
  return [...groups.values()];
}

export const photoResolution = photo => photo.width && photo.height ? photo.width + " × " + photo.height + " px" : "";

export function carouselSummary(asset) {
  const sizes = new Set(asset.photos.map(photoResolution).filter(Boolean));
  return asset.photos.length + (asset.photos.length === 1 ? " photo" : " photos") +
    (sizes.size === 1 ? " · " + [...sizes][0] : sizes.size > 1 ? " · Mixed resolutions" : "");
}

export async function loadCatalog(api, listFiles) {
  const [media, posts, drafts, weekly, monthly, details, files, carousels] = await Promise.all([
    readImages(api),
    allRows(api, "posts?select=body&order=published_on.desc,id.desc"),
    optionalRows(api, "working_drafts?select=fields&order=saved_at.desc"),
    optionalRows(api, "weekly_photos?select=media_id,title,alt&order=week.desc,created_at.desc,id"),
    optionalRows(api, "photos?select=media_id,alt,caption&order=month.desc"),
    optionalRows(api, "asset_details?select=kind,asset_id,title,description,original_name&order=kind,asset_id"),
    listFiles ? listFiles() : [],
    listFiles ? readCarouselCatalog(api) : [],
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
  const images = media.map(({ id, alt, width, height }) => {
    const details = metadata.get("image" + id);
    const photo = photos.get(id);
    return {
      kind: "image", id, type: "image", width, height, alt: alt || photo?.alt || titles.get("image" + id)?.alt || "",
      title: details?.title ?? photo?.title ?? "", description: details?.description ?? "",
    };
  });
  const attachments = files.filter(file => mediaId.test(file.name)).map(file => {
    const details = metadata.get("file" + file.name);
    const original = details?.original_name || titles.get("file" + file.name)?.title || "";
    const filename = details?.title || original || "Untitled file";
    const ext = (original || filename).split(".").at(-1).toLowerCase();
    const type = ext === "pdf" ? "pdf" : /^(docx?|odt|rtf|txt|md|xlsx?|ods|csv|pptx?|odp)$/.test(ext) ? "document" : "file";
    return { kind: "file", id: file.name, type, extension: ext, title: filename, original, description: details?.description || "", size: file.metadata?.size };
  });
  return [...images, ...attachments, ...carousels].sort((a, b) => (a.title || a.alt || "\uffff").localeCompare(b.title || b.alt || "\uffff"));
}
