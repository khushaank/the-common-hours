import { getProjectOrigin } from "./config.js";
import { allRows, fetchAttachment, journalToday, listAttachments, markdownMarker, mediaId, missingColumn, missingFeature, readMediaImage, removeAttachment, request, showFailure, table, uploadAttachment, weekOf } from "./common.js";
import { entryTags } from "./text.js";
import { entryExcerpt, isSupportedImage, setupEditorTools, uploadImage } from "./editor-tools.js";
import { setupPhotoTools } from "./photo-tools.js";

if (window.top !== window.self) {
  document.body.replaceChildren();
  throw new Error("Open the writing desk directly in its own tab.");
}

const login = document.querySelector("#login");
const editor = document.querySelector("#editor");
const desk = document.querySelector("#desk");
const status = document.querySelector("#status");
const postList = document.querySelector("#posts");
const comments = document.querySelector("#comments");
const refreshComments = document.querySelector("#refresh-comments");
const newPost = document.querySelector("#new-post");
const entryDetails = document.querySelector("#entry-details");
const editorTitle = document.querySelector("#editor-title");
const titleInput = editor.elements.namedItem("title");
const search = document.querySelector("#find-entry");
const entryFilter = document.querySelector("#entry-filter");
const inbox = document.querySelector("#privacy-requests");
const draftStatus = document.querySelector("#draft-status");
const deskMenu = document.querySelector("#desk-menu");
const deskNav = document.querySelector("#desk-nav");
const sections = [...document.querySelectorAll("[data-section]")];
const wide = matchMedia("(min-width: 1100px)");
function syncNavigation() {
  if (deskNav.matches(":popover-open")) deskNav.hidePopover();
  if (wide.matches) deskNav.removeAttribute("popover");
  else deskNav.setAttribute("popover", "auto");
}
wide.addEventListener("change", syncNavigation);
syncNavigation();
const collapseRail = document.querySelector("#collapse-rail");
collapseRail.addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("rail-collapsed");
  collapseRail.setAttribute("aria-expanded", String(!collapsed));
  collapseRail.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  collapseRail.setAttribute("aria-label", collapseRail.title);
});
document.querySelector("#back-entries").addEventListener("click", () => {
  if (busy) return;
  showSection("entries");
  document.querySelector("#entries-panel h1").focus({ preventScroll: true });
});
const entryActions = document.querySelector("#entry-actions");
const settingsButton = document.querySelector("#edit-entry-settings");
const draftButton = editor.querySelector('[value="draft"]');
const publishButton = editor.querySelector('[value="publish"]');
const shareButton = document.querySelector("#share-entry");
const editTitle = document.querySelector("#edit-entry-title");
function showSettings(open) {
  entryDetails.hidden = !open;
  settingsButton.setAttribute("aria-expanded", String(open));
  if (open) entryDetails.focus();
}
settingsButton.addEventListener("click", () => showSettings(entryDetails.hidden));
editTitle.addEventListener("click", () => {
  titleInput.readOnly = false;
  titleInput.tabIndex = 0;
  titleInput.focus();
});
titleInput.addEventListener("blur", () => {
  titleInput.readOnly = true;
  titleInput.tabIndex = -1;
});
titleInput.addEventListener("keydown", event => {
  if (event.isComposing || !["Enter", "Escape"].includes(event.key)) return;
  event.preventDefault();
  editTitle.focus();
});
entryActions.addEventListener("click", event => {
  if (!event.target.closest("button")) return;
  if (entryActions.matches(":popover-open")) entryActions.hidePopover();
  if (event.target.closest("#preview-mode")) document.querySelector("#entry-preview").focus();
  else editor.elements.namedItem("body").focus();
});
const featureFields = ["reader_prompt", "paired_photo", "collection", "collection_intro", "photo_essay"];
const featurePanel = document.querySelector("#entry-features");
const photoPicker = editor.elements.namedItem("paired_photo");
const pairingStatus = document.querySelector("#pairing-status");
const editorTools = setupEditorTools(editor, api, {
  upload: uploadFile,
  uploadMedia,
  download: async id => fetchAttachment(id, await sessionToken()),
}, () => posts, () => references);
const photoTools = setupPhotoTools(api, editorTools.openImageLibrary);
let originalBody = "";
let session;
let refresh;
let current;
let posts = [];
let references = [];
let baseline;
let busy = false;
let stats;
let media;
let activePost;
let draftOwner;
let backupStored = false;
let cloudDraft = false;
let editorialFields = true;
let entriesRevision = 0;
let commentsRevision = 0;
let referencesRevision = 0;
let entryListScroll = 0;
let savedDraftSnapshot;

const sessionKey = () => "common-hours:desk-session:" + getProjectOrigin();

function storeSession() {
  try {
    if (session) sessionStorage.setItem(sessionKey(), JSON.stringify(session));
    else sessionStorage.removeItem(sessionKey());
  } catch { /* The desk can still sign in if tab storage is unavailable. */ }
}

function setSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires: Date.now() + (data.expires_in - 30) * 1000,
  };
}

async function sessionToken() {
  if (!session) throw new Error("Sign in again to continue.");
  if (session.expires < Date.now()) {
    refresh ??= request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST", body: { refresh_token: session.refresh_token }
    }).then(data => {
      setSession(data);
      storeSession();
    }).catch(error => {
      if ([400, 401, 403].includes(error.status)) {
        session = undefined;
        storeSession();
        throw new Error("Your session expired. Log out and sign in again.");
      }
      throw error;
    }).finally(() => { refresh = undefined; });
    await refresh;
  }
  return session.access_token;
}

async function api(path, options = {}) {
  return request(table(path), { ...options, token: await sessionToken() });
}

async function adminRpc(name, body) {
  return request("/rest/v1/rpc/qmargin_b74_" + name, { method: "POST", body, token: await sessionToken() });
}

function saveAsset(asset, details) {
  return adminRpc("save_asset", {
    p_id: asset.id, p_kind: asset.kind, p_title: details.title, p_alt: details.alt, p_description: details.description,
    p_original: details.original || "",
  });
}

async function saveUploadDetails(asset, details) {
  try { await saveAsset(asset, details); }
  catch (error) { if (error.code !== "PGRST202") throw error; }
}

async function uploadFile(id, file) {
  await uploadAttachment(id, file, await sessionToken());
  const filename = file.name.slice(0, 200);
  await saveUploadDetails({ id, kind: "file" }, { title: filename, original: filename, alt: "", description: "" });
  return { id, kind: "file", title: filename, original: filename };
}

async function uploadMedia(file, alt) {
  if (!isSupportedImage(file)) return uploadFile(crypto.randomUUID(), file);
  const image = await uploadImage(api, file, alt);
  const details = { title: alt, original: file.name.slice(0, 200), alt, description: "" };
  await saveUploadDetails({ id: image.id, kind: "image" }, details);
  return { ...details, id: image.id, kind: "image" };
}

function entryFields() {
  const fields = Object.fromEntries(new FormData(editor));
  fields.tag = entryTags([fields.tag, tagInput.value].filter(Boolean).join(",")).join(", ");
  fields.start_here = String(editor.elements.namedItem("start_here").checked);
  fields.photo_essay = String(editor.elements.namedItem("photo_essay").checked);
  return fields;
}

function selectPairedPhoto(id) {
  if (id && ![...photoPicker.options].some(option => option.value === id)) {
    photoPicker.add(new Option("Previously selected photo", id));
  }
  photoPicker.value = id || "";
}

featurePanel.addEventListener("toggle", async () => {
  if (!featurePanel.open || !session) return;
  pairingStatus.textContent = "Loading weekly photos…";
  try {
    const [photos, monthly] = await Promise.all([
      allRows(api, "weekly_photos?select=id,title&and=(week.lte." + weekOf() + ",week.neq.1900-01-01)&featured=eq.true&order=created_at.desc,id.desc"),
      allRows(api, "photos?select=month,caption&month=lte." + journalToday().slice(0, 7) + "-01&order=month.desc"),
    ]);
    const selected = photoPicker.value;
    photoPicker.replaceChildren(new Option("No paired photo", ""), ...photos.map(photo => new Option(photo.title, photo.id)),
      ...monthly.map(photo => new Option(photo.caption || photo.month.slice(0, 7), "month-" + photo.month.slice(0, 7))));
    selectPairedPhoto(selected);
    pairingStatus.textContent = photos.length || monthly.length ? "" : "Add a Photo of the Week to pair it with an entry.";
  } catch {
    pairingStatus.textContent = "Weekly photos could not load. Reopen this section to try again.";
  }
});
const snapshot = () => {
  const { series_order, ...fields } = entryFields();
  return JSON.stringify(fields);
};
const dirty = () => snapshot() !== baseline;
const slot = () => current || "new";
const backupKey = (id = slot()) => "common-hours:draft:" + getProjectOrigin() + ":" + draftOwner + ":" + id;
const lastEntryKey = () => "common-hours:last-entry:" + getProjectOrigin() + ":" + draftOwner;
const cloudPath = () => "working_drafts?slot=eq." + slot();

function showDraftStatus(message) {
  if (draftStatus.textContent !== message) draftStatus.textContent = message;
}

function updatePublishActions() {
  const changed = dirty();
  const needsSave = changed && snapshot() !== savedDraftSnapshot;
  draftButton.hidden = Boolean(activePost?.published) && !changed;
  draftButton.disabled = busy || !needsSave;
  draftButton.textContent = needsSave ? "Save draft" : activePost || savedDraftSnapshot ? "Draft saved" : "No changes";
  publishButton.textContent = activePost?.published ? "Update published entry" : "Publish";
  publishButton.hidden = Boolean(activePost?.published) && !changed;
  shareButton.hidden = !activePost && !cloudDraft;
}

function readBackup() {
  try { return JSON.parse(localStorage.getItem(backupKey()) || "null"); }
  catch { return null; }
}

function removeBackup() {
  try { localStorage.removeItem(backupKey()); } catch { /* Storage can be unavailable. */ }
}

function saveBackup() {
  if (!draftOwner) return;
  if (!dirty()) {
    removeBackup();
    backupStored = false;
    showDraftStatus(cloudDraft ? "A saved draft is available." : "");
  } else {
    try {
      localStorage.setItem(backupKey(), JSON.stringify({
        fields: entryFields(), saved_at: new Date().toISOString(),
      }));
      backupStored = true;
    } catch { backupStored = false; }
    showDraftStatus(backupStored ? "Draft backed up on this device." : "Unsaved changes. Use Save draft.");
  }
  updatePublishActions();
  updateExitWarning();
}

async function recoverDraft() {
  const local = readBackup();
  let cloud;
  try { [cloud] = await api(cloudPath() + "&select=fields,saved_at", { timeout: 3500 }); }
  catch { /* A device backup can still be restored offline. */ }
  cloudDraft = Boolean(cloud);
  const chosen = local && (!cloud || local.saved_at >= cloud.saved_at) ? local : cloud;
  if (!chosen) return;
  for (const [name, value] of Object.entries(chosen.fields || {})) {
    const field = editor.elements.namedItem(name);
    if (!field || name === "series_order" || typeof value !== "string") continue;
    if (name === "series") setSeries(value);
    else if (field === photoPicker) selectPairedPhoto(value);
    else if (field.type === "checkbox") field.checked = value === "true";
    else field.value = value;
  }
  tagInput.value = "";
  renderTagChips();
  partField.value = nextPart(seriesField.value);
  if (!dirty()) {
    removeBackup();
    cloudDraft = false;
    return;
  }
  editorTools.refresh();
  updateEditorTitle();
  savedDraftSnapshot = chosen === cloud ? snapshot() : undefined;
  saveBackup();
  showDraftStatus(chosen === local ? "Draft recovered from this device." : "Saved draft restored.");
}

async function deleteCloudDraft() {
  try { await api(cloudPath(), { method: "DELETE" }); }
  catch (error) { if (!missingFeature(error)) throw error; }
}

const canLeaveDraft = () => !dirty() || backupStored || confirm("This browser could not back up your changes. Leave this entry?");

function preventExit(event) {
  event.preventDefault();
  event.returnValue = "";
}

function updateExitWarning() {
  if (session && dirty() && !backupStored) window.addEventListener("beforeunload", preventExit);
  else window.removeEventListener("beforeunload", preventExit);
}

async function run(button, action) {
  if (busy) return;
  busy = true;
  editor.inert = true;
  button.disabled = true;
  status.textContent = "Working…";
  try {
    await action();
    if (status.textContent === "Working…") status.textContent = "";
  } catch (error) {
    status.textContent = error.code === "23505" ? "That URL slug is already in use." : error.message;
  } finally {
    busy = false;
    editor.inert = false;
    button.disabled = false;
    updatePublishActions();
  }
}

function renderPostList() {
  const scrollTop = postList.scrollTop;
  postList.replaceChildren();
  const term = search.value.trim().toLowerCase();
  const filtered = posts.filter(post =>
    (entryFilter.value === "all" || post.published === (entryFilter.value === "published")) &&
    (!term || post.title.toLowerCase().includes(term) || post.tag.toLowerCase().includes(term)));
  document.querySelector("#entry-count").textContent = (filtered.length !== posts.length ? filtered.length + " of " : "") + posts.length + (posts.length === 1 ? " entry" : " entries");
  if (!filtered.length) {
    const item = document.createElement("li");
    item.textContent = term || entryFilter.value !== "all" ? "No matching entries." : "No entries yet.";
    postList.append(item);
  }
  for (const [index, post] of filtered.entries()) {
    const li = document.createElement("li");
    const number = document.createElement("span");
    number.className = "entry-number";
    number.textContent = index + 1 + ".";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entry-open";
    const state = document.createElement("small");
    button.textContent = post.title;
    state.textContent = (post.published ? "Published" : "Draft") + " · " + post.published_on;
    state.dataset.published = String(post.published);
    button.append(state);
    if (post.id === current) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => editEntry(post, button));
    const share = entryIcon("Share", post, "M12 15V3m-4 4 4-4 4 4M7 10H5v11h14V10h-2");
    share.addEventListener("click", () => shareEntry(post, share));
    const remove = entryIcon("Delete", post, "M4 7h16m-10 0V4h4v3M7 7l1 13h8l1-13m-6-9v4m2-4v4");
    remove.addEventListener("click", () => deleteEntry(post, remove));
    li.append(number, button, share, remove);
    postList.append(li);
  }
  postList.scrollTop = scrollTop;
}

function entryIcon(action, post, path) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button entry-list-action";
  button.title = action + " entry";
  button.setAttribute("aria-label", action + " " + post.title);
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  return button;
}

async function deleteEntry(post, button) {
  if (!confirm('Delete “' + post.title + '” and its comments permanently?')) return;
  await run(button, async () => {
    const [removed] = await api("posts?id=eq." + post.id, { method: "DELETE", prefer: "return=representation" });
    if (!removed) throw new Error("The entry could not be deleted.");
    try { localStorage.removeItem(backupKey(post.id)); } catch { /* Browser storage is optional. */ }
    posts = posts.filter(entry => entry.id !== post.id);
    entriesRevision++;
    if (current === post.id) openEditor();
    else renderPostList();
    status.textContent = "Entry deleted.";
  });
}

const shareDialog = document.querySelector("#share-dialog");
const shareLink = document.querySelector("#share-link");
document.querySelector("#close-share").addEventListener("click", () => shareDialog.close());
document.querySelector("#copy-share").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareLink.value);
    document.querySelector("#share-status").textContent = "Link copied.";
  } catch { shareLink.select(); }
});
shareButton.addEventListener("click", () => shareEntry(activePost, shareButton));

function shareEntry(post, button) {
  if (!post?.published && !confirm("Create a draft review link? Anyone with the link can read this copy until it expires.")) return;
  return run(button, async () => {
    const url = new URL("../", location.href);
    const notice = document.querySelector("#share-notice");
    if (post?.published) {
      url.searchParams.set("post", post.slug);
      notice.textContent = "Anyone can open the published entry.";
    } else {
      const fields = !post || post.id === current ? entryFields() : (await api("posts?id=eq." + post.id))[0];
      if (!fields?.body.trim()) throw new Error("Write something before sharing this draft.");
      const { title, tag, excerpt, body, published_on, reader_prompt, photo_essay } = fields;
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const expiry = await adminRpc("sync_reviews", {
        p_slot: post?.id || "new", p_post: post?.id || null, p_token: token,
        p_fields: { title, tag, excerpt: excerpt || await entryExcerpt(body, title),
          body: body.startsWith(markdownMarker) ? body.slice(markdownMarker.length) : body,
          published_on, reader_prompt, photo_essay: photo_essay === true || photo_essay === "true" },
      });
      url.searchParams.set("view", "review");
      url.hash = token;
      notice.textContent = "Draft review link expires " + new Date(expiry).toLocaleString(undefined, { timeZone: "Asia/Kolkata" }) + ".";
    }
    shareLink.value = url.href;
    document.querySelector("#share-status").textContent = "";
    shareDialog.showModal();
    shareLink.select();
  });
}

function editEntry(post, button) {
  if (busy || !canLeaveDraft()) return;
  run(button, async () => {
    if (post.id !== current) {
      const [record] = await api("posts?id=eq." + post.id);
      if (!record) throw new Error("This entry is unavailable.");
      openEditor(record);
      await recoverDraft();
    }
    showSection("compose");
  }).then(() => { if (!busy && current === post.id) editTitle.focus({ preventScroll: true }); });
}

const tags = document.querySelector("#tags");
const tagInput = document.querySelector("#entry-tag");
const tagField = editor.elements.namedItem("tag");
const tagChips = document.querySelector("#tag-chips");
let activeTag = -1;

function closeTags() {
  tags.hidden = true;
  activeTag = -1;
  tagInput.setAttribute("aria-expanded", "false");
  tagInput.removeAttribute("aria-activedescendant");
}

function acceptTag(value) {
  clearPublishError(tagInput);
  tagField.value = entryTags([tagField.value, value].filter(Boolean).join(",")).join(", ");
  tagInput.value = "";
  renderTagChips();
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  closeTags();
}

function renderTagChips() {
  tagChips.replaceChildren(...entryTags(tagField.value).map(tag => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag + " ×";
    button.setAttribute("aria-label", "Remove tag " + tag);
    button.addEventListener("click", () => {
      tagField.value = entryTags(tagField.value).filter(value => value !== tag).join(", ");
      clearPublishError(tagInput);
      renderTagChips();
      tagInput.focus();
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return button;
  }));
}

function showTags() {
  const value = tagInput.value.trim();
  const query = value.toLowerCase();
  const existing = entryTags(tagField.value).map(tag => tag.toLowerCase());
  const all = entryTags(posts.map(post => post.tag).join(",")).filter(tag => !existing.includes(tag.toLowerCase())).sort((a,b) => a.localeCompare(b));
  const matches = (query ? all.filter(topic => topic.toLowerCase().includes(query)) : all)
    .sort((a,b) => Number(b.toLowerCase().startsWith(query)) - Number(a.toLowerCase().startsWith(query)));
  const exact = matches.findIndex(topic => topic.toLowerCase() === query);
  if (exact > 0) matches.unshift(...matches.splice(exact, 1));
  if (value && exact < 0) matches.push(value);
  tags.replaceChildren(...matches.map((topic, index) => {
    const option = document.createElement("div");
    option.id = "tag-suggestion-" + index;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.textContent = value && exact < 0 && index === matches.length - 1 ? 'Use new tag: ' + topic : topic;
    option.addEventListener("pointerdown", event => event.preventDefault());
    option.addEventListener("click", () => acceptTag(topic));
    return option;
  }));
  activeTag = -1;
  tagInput.removeAttribute("aria-activedescendant");
  if (!matches.length) { closeTags(); return; }
  tags.hidden = false;
  tags.scrollTop = 0;
  tagInput.setAttribute("aria-expanded", "true");
}

tagInput.addEventListener("focus", showTags);
tagInput.addEventListener("click", () => { if (tags.hidden) showTags(); });
tagInput.addEventListener("input", event => {
  if (event.isComposing) return;
  if (tagInput.value.includes(",")) {
    const parts = tagInput.value.split(",");
    const pending = parts.pop();
    acceptTag(parts.join(","));
    tagInput.value = pending;
  }
  if (tagInput.value) showTags();
  else closeTags();
});
tagInput.addEventListener("blur", () => {
  if (tagInput.value.trim()) acceptTag(tagInput.value);
  else closeTags();
});
tagInput.addEventListener("keydown", event => {
  if (event.isComposing) return;
  if (event.key === "Escape" && !tags.hidden) { event.preventDefault(); closeTags(); return; }
  if (event.key === "Enter") {
    event.preventDefault();
    if (activeTag >= 0) tags.children[activeTag]?.click();
    else acceptTag(tagInput.value.trim());
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  if (tags.hidden) showTags();
  if (tags.hidden) return;
  event.preventDefault();
  const options = tags.children;
  activeTag = event.key === "ArrowDown" ? (activeTag + 1) % options.length :
    (activeTag <= 0 ? options.length - 1 : activeTag - 1);
  [...options].forEach((option, index) => option.setAttribute("aria-selected", String(index === activeTag)));
  tagInput.setAttribute("aria-activedescendant", options[activeTag].id);
  options[activeTag].scrollIntoView({ block: "nearest" });
});

const seriesField = editor.elements.namedItem("series");
const partField = editor.elements.namedItem("series_order");
function setSeries(value) {
  const names = [...new Set(posts.map(post => post.series).filter(Boolean).concat(value || []))].sort((a, b) => a.localeCompare(b));
  seriesField.replaceChildren(new Option("No series", ""), ...names.map(name => new Option(name)));
  seriesField.value = value || "";
}

function nextPart(series) {
  if (!series) return "";
  if (activePost?.published && activePost.series === series && activePost.series_order != null) return String(activePost.series_order);
  return String(posts.filter(post => post.published && post.id !== current && post.series?.toLowerCase() === series.toLowerCase())
    .reduce((highest, post) => Math.max(highest, post.series_order || 0), 0) + 1);
}

seriesField.addEventListener("input", () => { partField.value = nextPart(seriesField.value); });
document.querySelector("#add-series").addEventListener("click", () => {
  const name = prompt("Name the series")?.trim();
  if (!name) return;
  if (name.length > 100) { status.textContent = "Use 100 characters or fewer for the series name."; return; }
  const existing = [...seriesField.options].find(option => option.value.toLowerCase() === name.toLowerCase());
  setSeries(existing?.value || name);
  partField.value = nextPart(seriesField.value);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  seriesField.focus();
});

function updateEditorTitle() {
  titleInput.style.height = "auto";
  titleInput.style.height = titleInput.scrollHeight + "px";
  document.querySelector("#editor-breadcrumb").textContent = titleInput.value.trim() || (activePost ? "Untitled entry" : "New entry");
  const date = editor.elements.namedItem("published_on").value;
  document.querySelector("#editor-date").textContent = date ? " · " + new Date(date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}
new ResizeObserver(updateEditorTitle).observe(editorTitle.parentElement);

function openEditor(post) {
  clearPublishErrors();
  showSettings(false);
  if (post?.id !== current) {
    featurePanel.open = false;
    editorTools.write();
  }
  activePost = post;
  current = post?.id;
  if (draftOwner) {
    try { localStorage.setItem(lastEntryKey(), slot()); } catch { /* Entry switching also works without storage. */ }
  }
  editor.reset();
  closeTags();
  tagInput.value = "";
  titleInput.readOnly = true;
  titleInput.tabIndex = -1;
  originalBody = post?.body || "";
  for (const key of ["title", "slug", "tag", "excerpt", "published_on", "reader_prompt", "collection", "collection_intro"]) {
    editor.elements.namedItem(key).value = post?.[key] ?? "";
  }
  renderTagChips();
  setSeries(post?.series);
  partField.value = nextPart(seriesField.value);
  editor.elements.namedItem("start_here").checked = Boolean(post?.start_here);
  editor.elements.namedItem("photo_essay").checked = Boolean(post?.photo_essay);
  selectPairedPhoto(post?.paired_photo);
  editor.elements.namedItem("body").value = originalBody.startsWith(markdownMarker)
    ? originalBody.slice(markdownMarker.length) : originalBody;
  if (!post) editor.elements.namedItem("published_on").value = journalToday();
  updateEditorTitle();
  document.querySelector("#editor-state").textContent = post?.published ? "Published" : "Draft";
  document.querySelector("#editor-state").dataset.published = String(Boolean(post?.published));
  baseline = snapshot();
  savedDraftSnapshot = undefined;
  backupStored = cloudDraft = false;
  updatePublishActions();
  showDraftStatus("");
  editorTools.refresh();
  updateExitWarning();
  renderPostList();
}

async function loadPosts() {
  const revision = ++entriesRevision;
  const fields = "id,slug,title,published,tag,published_on";
  let loaded;
  let supportsEditorial = true;
  try {
    loaded = await allRows(api, "posts?select=" + fields + ",series,series_order,start_here&order=published_on.desc,id.desc");
  } catch (error) {
    if (!missingColumn(error)) throw error;
    loaded = await allRows(api, "posts?select=" + fields + "&order=published_on.desc,id.desc");
    supportsEditorial = false;
  }
  if (revision !== entriesRevision) return;
  posts = loaded;
  editorialFields = supportsEditorial;
  setSeries(seriesField.value);
  partField.value = nextPart(seriesField.value);
  renderPostList();
}

document.querySelector("#refresh-entries").addEventListener("click", event => run(event.currentTarget, loadPosts));

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && session && !busy) void loadPosts().catch(() => {});
});

async function loadComments() {
  const revision = ++commentsRevision;
  const filter = document.querySelector("#comment-filter").value;
  const rows = await allRows(api, "comments?select=id,display_name,body,approved,post_id&order=approved.asc,created_at.desc,id.desc" +
    (filter === "all" ? "" : "&approved=eq." + (filter === "published")));
  if (revision !== commentsRevision) return;
  comments.replaceChildren();
  if (!rows.length) comments.textContent = filter === "all" ? "No comments yet." : "No " + filter + " comments.";
  const titles = new Map(posts.map(post => [post.id, post.title]));
  for (const row of rows) {
    const article = document.createElement("article");
    article.className = "comment";
    const name = document.createElement("strong");
    name.textContent = row.display_name;
    const context = document.createElement("small");
    context.textContent = (row.approved ? "Published" : "Pending") + " · " + (titles.get(row.post_id) || "Entry");
    const body = document.createElement("p");
    body.textContent = row.body;
    const actions = document.createElement("div");
    actions.className = "actions";
    const moderate = document.createElement("button");
    moderate.textContent = row.approved ? "Hide" : "Approve";
    const remove = document.createElement("button");
    remove.textContent = "Delete";
    const path = "comments?id=eq." + row.id;
    moderate.addEventListener("click", () => run(moderate, async () => {
      const changed = await api(path, { method: "PATCH", body: { approved: !row.approved }, prefer: "return=representation" });
      if (!changed.length) throw new Error("The comment is unavailable.");
      await loadComments();
      status.textContent = row.approved ? "Comment hidden." : "Comment approved.";
    }));
    remove.addEventListener("click", () => {
      if (!confirm("Delete this comment permanently?")) return;
      run(remove, async () => {
        const deleted = await api(path, { method: "DELETE", prefer: "return=representation" });
        if (!deleted.length) throw new Error("The comment is unavailable.");
        await loadComments();
        status.textContent = "Comment deleted.";
      });
    });
    actions.append(moderate, remove);
    article.append(name, context, body, actions);
    comments.append(article);
  }
}

async function openDesk() {
  const allowed = await api("admins?select=user_id&limit=1");
  if (!allowed.length) {
    session = undefined;
    storeSession();
    throw new Error("This account does not have access to the writing desk.");
  }
  draftOwner = allowed[0].user_id;
  void loadReferences();
  await loadPosts();
  let lastEntry;
  try {
    const remembered = localStorage.getItem(lastEntryKey());
    if (posts.some(post => post.id === remembered)) [lastEntry] = await api("posts?id=eq." + remembered);
  } catch { /* A remembered entry is optional. */ }
  openEditor(lastEntry);
  await recoverDraft();
  showSection("stats");
  storeSession();
  login.reset();
  login.hidden = true;
  desk.hidden = false;
  document.body.classList.add("desk-open");
  deskMenu.hidden = false;
  void openStats();
}

try {
  if (!window.isSecureContext) throw new Error("Use the HTTPS address to sign in.");
  getProjectOrigin();
  const signIn = login.querySelector("button");
  signIn.disabled = false;
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(sessionKey())); }
  catch { /* Sign-in is still available if tab storage cannot be read. */ }
  if (saved?.access_token && saved?.refresh_token && Number.isFinite(saved.expires)) {
    session = saved;
    login.hidden = true;
    void run(signIn, async () => {
      status.textContent = "Restoring your session…";
      try {
        await openDesk();
        status.textContent = "";
      } catch (error) {
        if ([401, 403].includes(error.status)) {
          session = undefined;
          storeSession();
        }
        session = draftOwner = undefined;
        login.hidden = false;
        throw error;
      }
    });
  }
} catch (error) {
  status.textContent = window.isSecureContext
    ? "The writing desk is not connected. Check its configuration and reload."
    : error.message;
  login.querySelector("button").disabled = true;
}

login.addEventListener("submit", event => {
  event.preventDefault();
  run(event.submitter, async () => {
    const body = Object.fromEntries(new FormData(login));
    login.elements.namedItem("password").value = "";
    try {
      setSession(await request("/auth/v1/token?grant_type=password", { method: "POST", body }));
    } catch (error) {
      if (error.status === 400 || error.status === 401) throw new Error("Check your email and password, then try again.");
      if (error.status === 429) throw new Error("Too many attempts. Wait a moment and try again.");
      throw error;
    }
    try { await openDesk(); }
    catch (error) {
      session = draftOwner = undefined;
      throw error;
    }
  });
});

newPost.addEventListener("click", () => {
  if (busy || !canLeaveDraft()) return;
  run(newPost, async () => {
    openEditor();
    await recoverDraft();
    showSection("compose");
  }).then(() => { if (!busy && !current) editTitle.focus({ preventScroll: true }); });
});

refreshComments.addEventListener("click", () => run(refreshComments, async () => {
  await loadComments();
  status.textContent = "Comments refreshed.";
}));

const publishErrors = new Map();

function clearPublishError(field) {
  const message = publishErrors.get(field);
  if (!message) return;
  field.removeAttribute("aria-invalid");
  field.removeAttribute("aria-describedby");
  message.remove();
  publishErrors.delete(field);
  if (!publishErrors.size && status.textContent === "Check the highlighted fields.") status.textContent = "";
}

function clearPublishErrors() {
  for (const field of publishErrors.keys()) clearPublishError(field);
}

function showPublishErrors(errors) {
  status.textContent = "Check the highlighted fields.";
  const fields = [...errors].map(([name, text]) => {
    const field = name === "tag" ? tagInput : editor.elements.namedItem(name);
    const message = document.createElement("span");
    message.id = "publish-error-" + name;
    message.className = "field-error";
    message.textContent = text;
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", message.id);
    publishErrors.set(field, message);
    if (name === "body") document.querySelector(".editor-toolbar").append(message);
    else if (field === titleInput) document.querySelector(".entry-state").after(message);
    else if (field === seriesField) field.parentElement.after(message);
    else field.after(message);
    return field;
  });
  if (fields.some(field => entryDetails.contains(field))) showSettings(true);
  if (fields.some(field => featurePanel.contains(field))) featurePanel.open = true;
  if (fields.includes(editor.elements.namedItem("body"))) editorTools.write();
  if (fields[0] === titleInput) editTitle.click();
  else fields[0].focus();
  fields[0].scrollIntoView({ block: "nearest" });
}

function validateEntry(record) {
  const errors = new Map();
  if (!record.title) errors.set("title", "Enter a title.");
  if (!record.body) errors.set("body", "Write something in the entry body.");
  if (!record.tag) errors.set("tag", "Add at least one tag.");
  else if ([...record.tag].length > 400 || entryTags(record.tag).some(tag => [...tag].length > 40)) {
    errors.set("tag", "Use up to 40 characters per tag and 400 characters across all tags.");
  }
  if (!record.published_on) errors.set("published_on", "Choose a publication date.");
  if ((record.slug || record.title) && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(record.slug)) {
    errors.set("slug", "Enter a URL slug using lowercase letters, numbers, and hyphens.");
  }
  if (record.collection_intro && !record.collection) errors.set("collection", "Name the collection before adding its introduction.");
  if (record.paired_photo && !mediaId.test(record.paired_photo) && !/^month-\d{4}-(0[1-9]|1[0-2])$/.test(record.paired_photo)) {
    errors.set("paired_photo", "Choose a Photo of the Week.");
  }
  if (record.series_order && Number(record.series_order) > 9999) errors.set("series", "This series has reached 9,999 parts.");
  return errors;
}

editor.addEventListener("submit", event => {
  event.preventDefault();
  if (busy || !event.submitter || event.submitter.disabled) return;
  clearPublishErrors();
  const fields = entryFields();
  const record = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()]));
  const publishing = event.submitter.value === "publish";
  const knownTags = new Map(entryTags(posts.map(post => post.tag).join(",")).map(tag => [tag.toLowerCase(), tag]));
  record.tag = entryTags(record.tag).map(tag => knownTags.get(tag.toLowerCase()) || tag).join(", ");
  record.slug ||= record.title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").slice(0, 120).replace(/^-+|-+$/g, "");
  const errors = validateEntry(record);
  if (publishing && errors.size) {
    showPublishErrors(errors);
    return;
  }
  let fieldError;
  void run(event.submitter, async () => {
    if (!publishing && (activePost?.published || errors.size)) {
      saveBackup();
      try {
        await api("working_drafts?on_conflict=user_id,slot", {
          method: "POST", body: { user_id: draftOwner, slot: slot(), fields, saved_at: new Date().toISOString() },
          prefer: "resolution=merge-duplicates,return=minimal",
        });
      } catch (error) {
        if (!missingFeature(error) || !backupStored) throw error;
        status.textContent = "Draft saved on this device. Apply the editor upgrade for cloud drafts.";
        return;
      }
      cloudDraft = true;
      backupStored = true;
      savedDraftSnapshot = snapshot();
      updateExitWarning();
      showDraftStatus("Draft saved.");
      status.textContent = (activePost?.published ? "Draft saved. Your published entry is still live." : "Draft saved.");
      return;
    }
    if (publishing && !record.excerpt) {
      record.excerpt = await entryExcerpt(record.body, record.title, record.body !== originalBody || originalBody.startsWith(markdownMarker));
    }
    record.paired_photo ||= null;
    record.photo_essay = record.photo_essay === "true";
    if (publishing && record.photo_essay) {
      const { mediaReferences } = await import("./rich.js");
      const images = mediaReferences(markdownMarker + record.body).filter(item => item.kind === "image");
      if (new Set(images.map(image => image.id)).size < 2) {
        fieldError = ["body", "Add at least two different images to publish a photo essay."];
        return;
      }
    }
    if (editorialFields) {
      record.start_here = record.start_here === "true";
      record.series_order = record.series && record.series_order ? Number(record.series_order) : null;
    } else {
      if (record.series || record.start_here === "true") throw new Error("Apply the editor upgrade to publish a series or a starter entry.");
      delete record.series;
      delete record.series_order;
      delete record.start_here;
    }
    if (record.body !== originalBody || originalBody.startsWith(markdownMarker)) record.body = markdownMarker + record.body;
    record.published = publishing;
    const path = current ? "posts?id=eq." + current : "posts";
    const options = { method: current ? "PATCH" : "POST", body: record, prefer: "return=representation" };
    let saved;
    try {
      try { [saved] = await api(path, options); }
      catch (error) {
        if (!missingColumn(error)) throw error;
        if (featureFields.some(field => record[field])) throw new Error("Apply the journal features database upgrade before publishing these settings. Your edits can be saved as a draft.");
        for (const field of featureFields) delete record[field];
        [saved] = await api(path, options);
      }
    } catch (error) {
      if (error.code !== "23505") throw error;
      fieldError = ["slug", "That URL slug is already in use. Enter a different one."];
      return;
    }
    if (!saved) throw new Error("The entry could not be saved.");
    const savedSlot = slot();
    entriesRevision++;
    removeBackup();
    const cleared = await deleteCloudDraft().then(() => true, () => false);
    const { id, slug, title, tag, published, published_on, series, series_order } = saved;
    const summary = { id, slug, title, tag, published, published_on, series, series_order };
    posts = [summary, ...posts.filter(post => post.id !== id)].sort((a, b) =>
      b.published_on.localeCompare(a.published_on) || b.id.localeCompare(a.id));
    openEditor(saved);
    if (publishing || savedSlot === "new") {
      await adminRpc("sync_reviews", { p_slot: savedSlot, p_post: id, p_publish: publishing }).catch(() => {});
    }
    status.textContent = (saved.published ? "Entry published." : "Draft saved.") +
      (cleared ? "" : " The previous cloud draft could not be cleared.");
  }).then(() => { if (fieldError) showPublishErrors(new Map([fieldError])); });
});

const referenceForm = document.querySelector("#reference-form");
const referenceList = document.querySelector("#reference-list");
const referenceStatus = document.querySelector("#reference-status");
const cancelReference = document.querySelector("#cancel-reference");
const saveReference = referenceForm.querySelector('[type="submit"]');
let editingReference;

function editReference(reference) {
  editingReference = reference;
  referenceForm.reset();
  referenceForm.elements.namedItem("alias").readOnly = Boolean(reference);
  if (reference) {
    for (const name of ["alias", "label", "url"]) referenceForm.elements.namedItem(name).value = reference[name];
    referenceForm.elements.namedItem("label").focus();
  }
  cancelReference.hidden = !reference;
}
cancelReference.addEventListener("click", () => editReference());

async function loadReferences() {
  const revision = ++referencesRevision;
  try {
    const rows = await allRows(api, "references?select=alias,label,url&order=alias");
    if (revision !== referencesRevision) return;
    references = rows;
    referenceStatus.textContent = references.length ? "" : "No saved references yet.";
    referenceList.replaceChildren(...references.map(reference => {
      const item = document.createElement("li");
      const label = document.createElement("strong");
      const url = document.createElement("small");
      label.textContent = "@" + reference.alias + " · " + reference.label;
      url.textContent = reference.url;
      const edit = document.createElement("button");
      const remove = document.createElement("button");
      edit.type = remove.type = "button";
      edit.textContent = "Edit";
      remove.textContent = "Delete";
      edit.addEventListener("click", () => editReference(reference));
      remove.addEventListener("click", () => {
        if (!confirm("Delete @" + reference.alias + " from References?")) return;
        void run(remove, async () => {
          await api("references?alias=eq." + reference.alias, { method: "DELETE" });
          if (editingReference?.alias === reference.alias) editReference();
          await loadReferences();
        });
      });
      item.append(label, url, edit, remove);
      return item;
    }));
  } catch (error) {
    if (revision === referencesRevision) {
      referenceStatus.textContent = missingFeature(error) ? "Apply the writing desk workflow SQL to enable References." : "References could not load.";
    }
  }
}

referenceForm.addEventListener("submit", async event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(referenceForm));
  saveReference.disabled = cancelReference.disabled = true;
  try {
    const url = new URL(fields.url.trim());
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Enter an HTTPS URL.");
    const body = { label: fields.label.trim(), url: url.href };
    const alias = fields.alias.trim().toLowerCase();
    if (!body.label) throw new Error("Enter link text.");
    await api(editingReference ? "references?alias=eq." + alias : "references", {
      method: editingReference ? "PATCH" : "POST",
      body: editingReference ? body : { ...body, alias },
    });
    editReference();
    await loadReferences();
    referenceStatus.textContent = "Reference saved.";
  } catch (error) {
    referenceStatus.textContent = error.code === "23505" ? "That shortcut already exists. Select Edit to change it." : error.message;
  } finally { saveReference.disabled = cancelReference.disabled = false; }
});

search.addEventListener("input", renderPostList);
entryFilter.addEventListener("change", renderPostList);
titleInput.addEventListener("input", updateEditorTitle);
editor.elements.namedItem("published_on").addEventListener("input", updateEditorTitle);
editor.addEventListener("input", event => {
  clearPublishError(event.target);
  saveBackup();
});

function showSection(section) {
  if (!document.querySelector("#entries-panel").hidden) entryListScroll = window.scrollY;
  document.body.classList.toggle("writing", section === "compose");
  for (const panel of document.querySelectorAll("[data-desk-panel]")) panel.hidden = panel.id !== section + "-panel";
  for (const button of sections) {
    const selected = button.dataset.section === section || section === "compose" && button.dataset.section === "entries";
    button.setAttribute("aria-pressed", String(selected));
  }
  window.scrollTo(0, section === "entries" ? entryListScroll : 0);
}

async function loadPrivacyRequests() {
  try {
    const rows = await allRows(api, "privacy_requests?select=id,email,message,created_at&order=created_at.desc,id.desc");
    inbox.replaceChildren();
    if (!rows.length) { inbox.textContent = "No privacy requests."; return; }
    for (const row of rows) {
      const article = document.createElement("article");
      article.className = "comment";
      const address = document.createElement("strong");
      address.textContent = row.email;
      const date = document.createElement("small");
      date.textContent = new Date(row.created_at).toLocaleDateString();
      const message = document.createElement("p");
      message.textContent = row.message;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete request";
      remove.addEventListener("click", () => {
        if (!confirm("Delete this privacy request permanently?")) return;
        run(remove, async () => {
          const removed = await api("privacy_requests?id=eq." + row.id, { method: "DELETE", prefer: "return=representation" });
          if (!removed?.length) throw new Error("The request is unavailable.");
          article.remove();
          if (!inbox.children.length) inbox.textContent = "No privacy requests.";
          status.textContent = "Privacy request deleted.";
        });
      });
      article.append(address, date, message, remove);
      inbox.append(article);
    }
  } catch (error) {
    showFailure(inbox, missingFeature(error) ? "Run the editorial features SQL to enable the privacy inbox." :
      "Privacy requests could not load.", missingFeature(error) ? undefined : loadPrivacyRequests);
  }
}

async function openInbox() {
  inbox.textContent = "Loading privacy requests…";
  await loadPrivacyRequests();
}

async function openComments() {
  comments.textContent = "Loading comments…";
  await loadComments().catch(() => showFailure(comments, "Comments could not load.", openComments));
}
document.querySelector("#comment-filter").addEventListener("change", openComments);

async function openStats() {
  try {
    const { setupStats } = await import("./stats.js");
    if (!session || document.querySelector("#stats-panel").hidden) return;
    stats ??= setupStats(api, () => posts, editEntry);
    await stats.load();
  } catch {
    document.querySelector("#stats-status").textContent = "Dashboard could not open. Try again.";
  }
}

async function openMedia() {
  try {
    const { setupMediaEditor } = await import("./media-editor.js");
    if (!session || document.querySelector("#media-panel").hidden) return;
    media ??= setupMediaEditor(api, {
      list: async () => listAttachments(await sessionToken()),
      image: id => readMediaImage(api, id),
      download: async id => fetchAttachment(id, await sessionToken()),
      save: saveAsset,
      upload: uploadMedia,
      remove: async asset => {
        if (asset.kind === "image") {
          if (!await adminRpc("delete_image", { p_id: asset.id })) throw new Error("Remove this image from any entries, drafts, or weekly photos that use it first.");
          return;
        }
        const removed = await removeAttachment(asset.id, await sessionToken());
        if (!removed?.some(file => file.name === asset.id)) throw new Error("Remove this file from any entries or drafts that use it first.");
        await api("asset_details?kind=eq.file&asset_id=eq." + asset.id, { method: "DELETE" });
      },
    });
    await media.load();
  } catch {
    document.querySelector("#media-status").textContent = "Media could not open. Try again.";
  }
}

document.querySelector("#refresh-privacy").addEventListener("click", loadPrivacyRequests);
for (const button of sections) {
  button.addEventListener("click", () => {
    if (deskNav.matches(":popover-open")) deskNav.hidePopover();
    if (!wide.matches) deskMenu.focus();
    if (busy) return;
    const section = button.dataset.section;
    if (button.getAttribute("aria-pressed") === "true" && !document.body.classList.contains("writing")) return;
    showSection(section);
    if (section === "site") void photoTools.loadPhoto();
    if (section === "inbox") void openInbox();
    if (section === "comments") void openComments();
    if (section === "stats") void openStats();
    if (section === "media") void openMedia();
    if (section === "references") void loadReferences();
  });
}

document.querySelector("#desk-logout").addEventListener("click", event => {
  if (busy) return;
  saveBackup();
  if (!canLeaveDraft()) return;
  if (deskNav.matches(":popover-open")) deskNav.hidePopover();
  void run(event.currentTarget, async () => {
    try {
      const token = await sessionToken();
      session = undefined;
      storeSession();
      await request("/auth/v1/logout?scope=local", { method: "POST", token, timeout: 4000 });
    } catch { /* Sign out of this tab even if the server cannot be reached. */ }
    finally {
      session = undefined;
      storeSession();
      window.removeEventListener("beforeunload", preventExit);
      location.reload();
    }
  });
});
