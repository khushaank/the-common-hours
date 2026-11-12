import { attachmentLimit, missingFeature, readMediaImage, videoFrom } from "./common.js";


const MAX_INPUT = 15 * 1024 * 1024;
const MAX_IMAGE = 1000000;
const allowedImages = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export async function encodeImage(file) {
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


const markdownLabel = text => text.replace(/[\\[\]*_`<>&]/g, "\\$&").replace(/[\r\n]+/g, " ");
const imageTypes = [...allowedImages].join(",");
const commands = [
  ["heading", "Heading", "## Heading"],
  ["bold", "Bold", "**Bold text**"],
  ["italic", "Italic", "*Italic text*"],
  ["list", "Bulleted list", "- List item"],
  ["square", "Square list", "+ List item"],
  ["numbered", "Numbered list", "1. List item"],
  ["letters", "Lettered list", "1) List item"],
  ["quote", "Quote", "> Quote"],
  ["image", "Image"],
  ["library", "Image library"],
  ["video", "Embed video"],
  ["file", "File"],
  ["pdf", "PDF"],
  ["link", "Link"],
  ["entry", "Link to entry"],
  ["footnote", "Footnote", "^[Footnote text]"],
  ["divider", "Divider", "---"],
];

export async function uploadImage(api, file, alt) {
  const record = await encodeImage(file);
  if (alt) record.alt = alt;
  let saved;
  try {
    [saved] = await api("media", { method: "POST", body: record, prefer: "return=representation" });
  } catch (error) {
    if (!alt || !["PGRST204", "42703"].includes(error.code)) throw error;
    delete record.alt;
    [saved] = await api("media", { method: "POST", body: record, prefer: "return=representation" });
  }
  if (!saved?.id) throw new Error("The image could not be saved.");
  return saved;
}

export const loadImage = readMediaImage;

export function setupEditorTools(editor, api, attachments, getEntries) {
  const body = editor.elements.namedItem("body");
  const dialog = document.querySelector("#insert-dialog");
  const insert = document.querySelector("#insert-form");
  const insertStatus = document.querySelector("#insert-status");
  const cancel = document.querySelector("#cancel-insert");
  const preview = document.querySelector("#entry-preview");
  const previewBody = document.querySelector("#preview-body");
  const workspace = document.querySelector("#editor-workspace");
  const toggle = document.querySelector("#preview-entry");
  const menu = document.querySelector("#command-menu");
  const count = document.querySelector("#word-count");
  const status = document.querySelector("#status");
  const entryDialog = document.querySelector("#entry-link-dialog");
  const entrySearch = document.querySelector("#entry-link-search");
  const entryResults = document.querySelector("#entry-link-results");
  let insertion;
  let command;
  let active = 0;
  let matches = [];
  let attachmentId;
  let linkRange;
  let library;
  let previewTimer;
  let previewRevision = 0;
  let previousBody;
  const previewImages = new Map();

  function checkSpace(length, start, end) {
    if (body.value.length - (end - start) + length > body.maxLength) {
      throw new Error("This entry has reached its length limit.");
    }
  }

  function replace(text, start, end, selection) {
    checkSpace(text.length, start, end);
    body.setRangeText(text, start, end, "end");
    body.focus();
    if (selection) body.setSelectionRange(start + selection[0], start + selection[1]);
    body.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function closePreview() {
    clearTimeout(previewTimer);
    previewRevision++;
    preview.hidden = true;
    workspace.classList.remove("with-preview");
    previewBody.replaceChildren();
    previousBody = undefined;
    toggle.textContent = "Preview";
    toggle.setAttribute("aria-expanded", "false");
  }

  function closeMenu() {
    command = undefined;
    menu.hidden = true;
    menu.replaceChildren();
  }

  function renderMenu() {
    const options = matches.map(([key, name], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.command = key;
      button.classList.toggle("active", index === active);
      button.textContent = name;
      const shortcut = document.createElement("kbd");
      shortcut.textContent = "/" + key;
      button.append(shortcut);
      return button;
    });
    menu.replaceChildren(...options);
    menu.hidden = !options.length;
    menu.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }

  function updateMenu() {
    const end = body.selectionStart;
    const match = /(?:^|\s)\/([a-z]*)$/i.exec(body.value.slice(0, end));
    if (body.selectionEnd !== end || !match) { closeMenu(); return; }
    const query = match[1].toLowerCase();
    matches = commands.filter(([key, name]) => key.startsWith(query) || name.toLowerCase().startsWith(query));
    command = { start: end - query.length - 1, end };
    active = 0;
    renderMenu();
  }

  function refresh() {
    closeMenu();
    const words = body.value.trim().split(/\s+/).filter(Boolean).length;
    count.textContent = words + (words === 1 ? " word" : " words");
  }

  function choose([type, name, template]) {
    const { start, end } = command;
    closeMenu();
    if (type === "library") {
      library ??= import("./image-library.js").then(({ setupImageLibrary }) => setupImageLibrary(api, id => loadImage(api, id)));
      void library.then(open => open(({ id, alt }) => {
        replace("\n\n![" + markdownLabel(alt) + "](media:" + id + ")\n\n", start, end);
      }, () => body.focus())).catch(() => {
        library = undefined;
        status.textContent = "The image library could not open. Try again.";
      });
      return;
    }
    if (type === "entry") {
      linkRange = { start, end };
      entrySearch.value = "";
      renderEntryLinks();
      entryDialog.showModal();
      entrySearch.focus();
      return;
    }
    if (template) {
      try {
        const line = ["bold", "italic", "footnote"].includes(type) ? template : "\n\n" + template + "\n\n";
        const text = /[A-Za-z].*/.exec(template)?.[0].replace(/[*\]]+$/, "");
        const at = text ? line.indexOf(text) : -1;
        replace(line, start, end, at >= 0 ? [at, at + text.length] : undefined);
      } catch (error) { status.textContent = error.message; }
      return;
    }

    insertion = { type, start, end };
    insert.reset();
    attachmentId = undefined;
    insertStatus.textContent = "";
    document.querySelector("#insert-title").textContent = type === "video" ? "Embed video" :
      type === "pdf" ? "Insert PDF" : "Insert " + name.toLowerCase();
    const label = insert.elements.namedItem("label");
    const url = insert.elements.namedItem("url");
    const file = insert.elements.namedItem("file");
    const isFile = ["image", "file", "pdf"].includes(type);
    label.parentElement.firstChild.textContent = type === "image" ? "Image description " : "Link text ";
    label.parentElement.hidden = label.disabled = !(type === "image" || type === "link");
    url.parentElement.hidden = url.disabled = isFile;
    file.parentElement.hidden = file.disabled = !isFile;
    file.parentElement.firstChild.textContent = name + " ";
    label.required = !label.disabled;
    url.required = !url.disabled;
    file.required = isFile;
    file.accept = type === "image" ? imageTypes : type === "pdf" ? "application/pdf,.pdf" : "";
    dialog.showModal();
  }

  function renderEntryLinks() {
    const query = entrySearch.value.trim().toLowerCase();
    const entries = getEntries().filter(entry => entry.published && entry.title.toLowerCase().includes(query)).slice(0, 20);
    entryResults.replaceChildren();
    if (!entries.length) entryResults.textContent = "No matching published entries.";
    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.title;
      button.addEventListener("click", () => {
        try {
          replace("[" + markdownLabel(entry.title) + "](?post=" + entry.slug + ")", linkRange.start, linkRange.end);
          entryDialog.close();
        } catch (error) { entryResults.textContent = error.message; }
      });
      entryResults.append(button);
    }
  }

  entrySearch.addEventListener("input", renderEntryLinks);
  document.querySelector("#entry-link-close").addEventListener("click", () => entryDialog.close());
  entryDialog.addEventListener("close", () => body.focus());

  body.addEventListener("input", () => { refresh(); updateMenu(); });
  body.addEventListener("click", updateMenu);
  body.addEventListener("blur", event => {
    if (!menu.contains(event.relatedTarget)) closeMenu();
  });
  menu.addEventListener("focusout", event => {
    if (event.relatedTarget !== body && !menu.contains(event.relatedTarget)) closeMenu();
  });
  body.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (menu.hidden) {
      if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const { value, selectionStart: start, selectionEnd: end } = body;
        if (start !== end) return;
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const lineEnd = value.indexOf("\n", start);
        const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        const item = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line);
        if (!item) return;
        const [, indent, marker, spaces, content] = item;
        if (start < lineStart + indent.length + marker.length + spaces.length) return;
        event.preventDefault();
        try {
          if (!content.trim()) {
            replace("", lineStart, lineStart + line.length);
          } else {
            const next = /^\d/.test(marker) ? Math.min(Number.parseInt(marker, 10) + 1, 999999999) + marker.at(-1) : marker;
            replace("\n" + indent + next + " ", start, end);
          }
        } catch (error) { status.textContent = error.message; }
      }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      renderMenu();
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      choose(matches[active]);
    }
  });
  menu.addEventListener("mousedown", event => event.preventDefault());
  menu.addEventListener("click", event => {
    const button = event.target.closest("[data-command]");
    if (button && command) choose(commands.find(([key]) => key === button.dataset.command));
  });
  body.addEventListener("paste", event => {
    const raw = event.clipboardData?.getData("text/plain").trim();
    if (!raw || !videoFrom(raw)) return;
    const { selectionStart: start, selectionEnd: end, value } = body;
    const before = value.slice(value.lastIndexOf("\n", start - 1) + 1, start);
    const after = value.slice(end).split("\n", 1)[0];
    if (before.trim() || after.trim()) return;
    event.preventDefault();
    try { replace("\n\n::video " + raw + "\n\n", start, end); }
    catch (error) { status.textContent = error.message; }
  });

  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => body.focus());
  dialog.addEventListener("cancel", event => { if (cancel.disabled) event.preventDefault(); });
  insert.elements.namedItem("file").addEventListener("change", () => { attachmentId = undefined; });
  insert.addEventListener("submit", async event => {
    event.preventDefault();
    if (cancel.disabled) return;
    const button = insert.querySelector('[type="submit"]');
    const fields = new FormData(insert);
    const { type, start, end } = insertion;
    button.disabled = cancel.disabled = true;
    insertStatus.textContent = "";
    try {
      const plainLabel = fields.get("label")?.trim() || "";
      const label = markdownLabel(plainLabel);
      const file = fields.get("file");
      let text;
      if (type === "image") {
        if (!label) throw new Error("Describe the image for readers who cannot see it.");
        checkSpace(label.length + 51, start, end);
        insertStatus.textContent = "Preparing image…";
        const image = await uploadImage(api, file, plainLabel);
        text = "\n\n![" + label + "](media:" + image.id + ")\n\n";
      } else if (type === "file" || type === "pdf") {
        if (!file?.size || file.size > attachmentLimit) throw new Error("Choose a file up to 25 MB.");
        if (type === "pdf" && !/\.pdf$/i.test(file.name)) throw new Error("Choose a PDF file.");
        const filename = markdownLabel(file.name);
        attachmentId ??= crypto.randomUUID();
        text = "\n\n[" + filename + "](attachment:" + attachmentId + ")\n\n";
        checkSpace(text.length, start, end);
        insertStatus.textContent = "Uploading " + file.name + "…";
        await attachments.upload(attachmentId, file);
      } else {
        const raw = fields.get("url").trim();
        const url = new URL(raw);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("Enter an HTTPS link.");
        if (type === "video") {
          if (!videoFrom(raw)) throw new Error("Enter a YouTube, Vimeo, or direct MP4, WebM or Ogg video link.");
          text = "\n\n::video " + raw + "\n\n";
        } else {
          if (!label) throw new Error("Enter link text.");
          text = "[" + label + "](<" + url.href.replaceAll(">", "%3E").replaceAll("<", "%3C") + ">)";
          if (videoFrom(url.href)) text = "\n\n" + text + "\n\n";
        }
      }
      replace(text, start, end);
      dialog.close();
    } catch (error) {
      insertStatus.textContent = missingFeature(error) ? "Apply the Supabase editorial upgrade to upload media." :
        error instanceof TypeError || error.name === "EncodingError" ? "Check the link or choose a readable file." :
        error.code === "BucketNotFound" || error.code === "NoSuchBucket" ? "Apply the Supabase writing desk upgrade to upload files." : error.message;
    } finally {
      button.disabled = cancel.disabled = false;
    }
  });
  async function renderPreview() {
    if (preview.hidden) return;
    const revision = ++previewRevision;
    const fields = editor.elements;
    document.querySelector("#preview-title").textContent = fields.namedItem("title").value.trim() || "Untitled entry";
    document.querySelector("#preview-meta").textContent = [fields.namedItem("published_on").value, fields.namedItem("tag").value].filter(Boolean).join(" · ");
    document.querySelector("#preview-excerpt").textContent = fields.namedItem("excerpt").value;
    const value = body.value;
    if (value === previousBody) return;
    try {
      const { renderText } = await import("./rich.js");
      if (revision !== previewRevision || preview.hidden) return;
      previousBody = value;
      renderText(previewBody, value || "Start writing to preview your entry.", id => {
        if (!previewImages.has(id)) previewImages.set(id, loadImage(api, id).catch(error => {
          previewImages.delete(id);
          throw error;
        }));
        return previewImages.get(id);
      },
        { markdown: true, loadAttachment: attachments.download, preview: true });
    } catch {
      if (revision === previewRevision) previewBody.textContent = "Preview could not load. Try again.";
    }
  }

  editor.addEventListener("input", () => {
    if (preview.hidden) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 250);
  });
  toggle.addEventListener("click", () => {
    if (!preview.hidden) { closePreview(); return; }
    preview.hidden = false;
    workspace.classList.add("with-preview");
    toggle.textContent = "Hide preview";
    toggle.setAttribute("aria-expanded", "true");
    void renderPreview();
  });

  return {
    refresh() {
      refresh();
      previewImages.clear();
      previousBody = undefined;
      void renderPreview();
    },
    closePreview,
  };
}
