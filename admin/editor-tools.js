import { imageSource, missingFeature, monthNow } from "./common.js";
import { renderText, youtubeId } from "./rich.js";

const MAX_INPUT = 15 * 1024 * 1024;
const MAX_IMAGE = 1000000;
const allowedImages = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

async function encodeImage(file) {
  if (!file?.size || !allowedImages.has(file.type)) throw new Error("Choose a JPEG, PNG, WebP, GIF, or AVIF image.");
  if (file.size > MAX_INPUT) throw new Error("Choose an image under 15 MB.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fffefa";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [.87, .7, .5]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      const encoded = data.slice(data.indexOf(",") + 1);
      if (data.startsWith("data:image/jpeg;base64,") && encoded.length <= Math.ceil(MAX_IMAGE / 3) * 4) {
        return { encoded, width: canvas.width, height: canvas.height };
      }
    }
    throw new Error("The image could not be compressed below 1 MB.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const wrapText = (text, mark, placeholder) => mark + (text || placeholder) + mark;
const markLines = (text, mark) => (text || "Text").split("\n").map(line => mark + line).join("\n");
const markdownLabel = text => text.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");
const formats = {
  heading: text => "\n\n## " + (text || "Heading") + "\n\n",
  bold: text => wrapText(text, "**", "Bold text"),
  italic: text => wrapText(text, "*", "Italic text"),
  list: text => "\n\n" + markLines(text, "- ") + "\n\n",
  quote: text => "\n\n" + markLines(text, "> ") + "\n\n",
};

export function setupEditorTools(editor, api) {
  const body = editor.elements.namedItem("body");
  const dialog = document.querySelector("#insert-dialog");
  const insert = document.querySelector("#insert-form");
  const insertStatus = document.querySelector("#insert-status");
  const preview = document.querySelector("#entry-preview");
  const toggle = document.querySelector("#preview-entry");
  const photoForm = document.querySelector("#photo-form");
  const photoStatus = document.querySelector("#photo-status");
  const photoPreview = document.querySelector("#photo-preview");
  let insertion;
  let photo;
  let photoLoad = 0;
  let photoSaving = false;

  async function upload(file) {
    const record = await encodeImage(file);
    const [saved] = await api("media", { method: "POST", body: record, prefer: "return=representation" });
    if (!saved?.id) throw new Error("The image could not be saved.");
    return saved;
  }
  async function loadImage(id) {
    const [image] = await api("media?select=encoded,width,height&id=eq." + id);
    return image;
  }

  function replace(text, start = body.selectionStart, end = body.selectionEnd) {
    if (body.value.length - (end - start) + text.length > body.maxLength) {
      throw new Error("This entry has reached its length limit.");
    }
    body.setRangeText(text, start, end, "end");
    body.focus();
    body.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function closePreview() {
    preview.hidden = true;
    preview.replaceChildren();
    toggle.textContent = "Preview entry";
    toggle.setAttribute("aria-expanded", "false");
  }

  body.addEventListener("input", closePreview);
  editor.querySelector(".toolbar").addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    const start = body.selectionStart;
    const end = body.selectionEnd;
    const selected = body.value.slice(start, end);
    if (button.dataset.format) {
      try { replace(formats[button.dataset.format](selected)); }
      catch (error) { document.querySelector("#status").textContent = error.message; }
      return;
    }

    const type = button.dataset.insert;
    insertion = { type, start, end };
    insert.reset();
    insertStatus.textContent = "";
    document.querySelector("#insert-title").textContent =
      type === "link" ? "Insert link" : type === "image" ? "Insert image" : "Insert YouTube video";
    const label = insert.elements.namedItem("label");
    const url = insert.elements.namedItem("url");
    const file = insert.elements.namedItem("file");
    label.parentElement.firstChild.textContent = type === "image" ? "Image description " : "Link text ";
    label.parentElement.hidden = label.disabled = type === "video";
    url.parentElement.hidden = url.disabled = type === "image";
    file.parentElement.hidden = file.disabled = type !== "image";
    label.required = type !== "video";
    url.required = type !== "image";
    file.required = type === "image";
    if (type === "link") label.value = selected.slice(0, 200);
    dialog.showModal();
  });

  const cancel = document.querySelector("#cancel-insert");
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => {
    if (cancel.disabled) event.preventDefault();
  });
  insert.addEventListener("submit", async event => {
    event.preventDefault();
    if (cancel.disabled) return;
    const button = insert.querySelector('[type="submit"]');
    const fields = new FormData(insert);
    const { type, start, end } = insertion;
    button.disabled = cancel.disabled = true;
    insertStatus.textContent = type === "image" ? "Preparing image…" : "";
    try {
      const label = markdownLabel(fields.get("label")?.trim() || "");
      let text;
      if (type === "image") {
        if (!label) throw new Error("Describe the image for readers who cannot see it.");
        const image = await upload(fields.get("file"));
        text = "\n\n![" + label + "](media:" + image.id + ")\n\n";
      } else {
        const raw = fields.get("url").trim();
        const url = new URL(raw);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("Enter an HTTPS link.");
        if (type === "video") {
          const id = youtubeId(raw);
          if (!id) throw new Error("Enter a YouTube watch, Shorts, live, or share link.");
          text = "\n\n::youtube " + id + "\n\n";
        } else {
          if (!label) throw new Error("Enter link text.");
          text = "[" + label + "](<" + url.href.replaceAll(">", "%3E").replaceAll("<", "%3C") + ">)";
        }
      }
      replace(text, start, end);
      dialog.close();
      body.focus();
    } catch (error) {
      insertStatus.textContent = missingFeature(error) ? "Run the editorial features SQL to enable image uploads." :
        error instanceof TypeError || error.name === "EncodingError" ? "Check the link or choose a readable image." : error.message;
    } finally {
      button.disabled = cancel.disabled = false;
    }
  });
  toggle.addEventListener("click", () => {
    if (!preview.hidden) { closePreview(); return; }
    renderText(preview, body.value || "Start writing to preview your entry.", loadImage, { markdown: true, loadVideos: false });
    preview.hidden = false;
    toggle.textContent = "Hide preview";
    toggle.setAttribute("aria-expanded", "true");
  });

  function renderPhoto(record) {
    photo = record;
    photoForm.elements.namedItem("alt").value = record?.alt || "";
    photoForm.elements.namedItem("caption").value = record?.caption || "";
    const src = imageSource(record?.media);
    photoPreview.hidden = !src;
    if (src) {
      photoPreview.src = src;
      photoPreview.alt = record.alt;
    } else {
      photoPreview.removeAttribute("src");
      photoPreview.alt = "";
    }
  }

  async function loadPhoto() {
    const revision = ++photoLoad;
    const month = photoForm.elements.namedItem("month").value;
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
      photoStatus.textContent = "Enter a month as YYYY-MM.";
      return;
    }
    photoForm.elements.namedItem("file").value = "";
    photoStatus.textContent = "Loading photo…";
    const button = photoForm.querySelector("button");
    button.disabled = true;
    try {
      const [record] = await api("photos?select=month,media_id,alt,caption,media:qmargin_b74_media(encoded,width,height)&month=eq." + month + "-01");
      if (revision !== photoLoad) return;
      renderPhoto(record);
      photoStatus.textContent = record ? "" : "Choose a photo for this month.";
    } catch (error) {
      if (revision !== photoLoad) return;
      renderPhoto(undefined);
      photoStatus.textContent = missingFeature(error) ? "Run the editorial features SQL to enable monthly photos." : error.message;
    } finally {
      if (revision === photoLoad) button.disabled = false;
    }
  }
  photoForm.elements.namedItem("month").value = monthNow();
  photoForm.elements.namedItem("month").addEventListener("change", loadPhoto);
  photoForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (photoSaving) return;
    const fields = new FormData(photoForm);
    const month = fields.get("month") + "-01";
    const alt = fields.get("alt").trim();
    const caption = fields.get("caption").trim();
    const file = fields.get("file");
    if (!alt) { photoStatus.textContent = "Describe the photo."; return; }
    const button = photoForm.querySelector("button");
    photoSaving = true;
    photoForm.inert = true;
    button.disabled = true;
    photoStatus.textContent = "Saving photo…";
    try {
      const image = file.size ? await upload(file) : photo?.month === month ? photo.media : null;
      const media_id = file.size ? image.id : photo?.month === month ? photo.media_id : null;
      if (!media_id) throw new Error("Choose a photo to upload.");
      await api("photos?on_conflict=month", {
        method: "POST", body: { month, media_id, alt, caption }, prefer: "resolution=merge-duplicates,return=minimal",
      });
      renderPhoto({ month, media_id, alt, caption, media: image });
      photoForm.elements.namedItem("file").value = "";
      photoStatus.textContent = "Monthly photo saved.";
    } catch (error) {
      photoStatus.textContent = missingFeature(error) ? "Run the editorial features SQL to enable monthly photos." : error.message;
    } finally {
      photoSaving = false;
      photoForm.inert = false;
      button.disabled = false;
    }
  });

  return { closePreview, loadPhoto, clearPhoto() { photoLoad++; photoForm.reset(); photoForm.elements.namedItem("month").value = monthNow(); renderPhoto(undefined); } };
}