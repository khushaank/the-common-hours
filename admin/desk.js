import { getProjectOrigin } from "./config.js";
import { allRows, fetchAttachment, journalToday, listAttachments, markdownMarker, mediaId, missingColumn, missingFeature, readMediaImage, removeAttachment, request, showFailure, table, uploadAttachment } from "./common.js";
import { articleTopics, entryTags } from "./text.js";
import { readNote, writeNote } from "./note.js";
import { entryExcerpt, isSupportedImage, setupEditorTools, uploadImage } from "./editor-tools.js";
import { setupPhotoTools } from "./photo-tools.js";
import { setupShortcuts } from "./keyboard.js";

if (window.top !== window.self) {
  document.body.replaceChildren();
  throw new Error("Open the writing desk directly in its own tab.");
}

const login = document.querySelector("#login");
const deskLoading = document.querySelector("#desk-loading");
const deskLoadingMessage = document.querySelector("#desk-loading-message");
const mfa = document.querySelector("#mfa");
const setupMfa = document.querySelector("#start-mfa-setup");
const verifyMfa = mfa.querySelector('[type="submit"]');
const authenticatorCode = mfa.elements.namedItem("code");
const mfaEnrollment = document.querySelector("#mfa-enrollment");
const mfaQr = document.querySelector("#mfa-qr");
const mfaKey = document.querySelector("#mfa-key");
const editor = document.querySelector("#editor");
const desk = document.querySelector("#desk");
const status = document.querySelector("#status");
const postList = document.querySelector("#posts");
const entryStatus = document.querySelector("#entry-status");
const comments = document.querySelector("#comments");
const refreshComments = document.querySelector("#refresh-comments");
const newPost = document.querySelector("#new-post");
const newNote = document.querySelector("#new-note");
const entryDetails = document.querySelector("#entry-details");
const editorTitle = document.querySelector("#editor-title");
const titleHeading = document.querySelector("#entry-heading");
const titleInput = editor.elements.namedItem("title");
const search = document.querySelector("#find-entry");
const entryFilter = document.querySelector("#entry-filter");
const entryType = document.querySelector("#entry-type");
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
  if (busy || !canLeaveDraft()) return;
  showSection(listScreen);
  const selected = selectedEntryButton();
  (selected || document.querySelector("#entries-panel h1")).focus({ preventScroll: true });
});
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
function editHeading(editing) {
  titleInput.hidden = !editing;
  titleHeading.parentElement.hidden = editing;
  if (editing) { updateEditorTitle(); titleInput.focus(); }
}
editTitle.addEventListener("click", () => editHeading(true));
titleInput.addEventListener("blur", () => editHeading(false));
titleInput.addEventListener("keydown", event => {
  if (event.isComposing || !["Enter", "Escape"].includes(event.key)) return;
  event.preventDefault();
  editHeading(false);
  editTitle.focus();
});
settingsButton.addEventListener("click", () => showSettings(entryDetails.hidden));
function closeSettings() {
  showSettings(false);
  settingsButton.focus();
}
document.querySelector("#close-entry-settings").addEventListener("click", closeSettings);
entryDetails.addEventListener("keydown", event => {
  if (event.key === "Escape" && !event.defaultPrevented) closeSettings();
});
for (const help of document.querySelectorAll(".field-help")) {
  const resetHelp = () => help.removeAttribute("data-dismissed");
  help.addEventListener("pointerenter", resetHelp);
  help.addEventListener("focusin", resetHelp);
}
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const help = document.querySelector(".field-help:not([data-dismissed]):is(:hover, :focus-within)");
  if (!help) return;
  help.setAttribute("data-dismissed", "");
  event.preventDefault();
}, true);
const editorTools = setupEditorTools(editor, api, {
  upload: uploadFile,
  uploadMedia,
  download: async id => fetchAttachment(id, await sessionToken()),
  carousel: openCarousels,
}, () => posts, () => references);
const photoTools = setupPhotoTools(api, editorTools.openImageLibrary);
let originalBody = "";
let session;
let factorId;
let refresh;
let current;
let compositionSlot;
let selectedEntry;
let isNote = false;
let posts = [];
let drafts = [];
let activeDraft;
let references = [];
let baseline;
let busy = false;
let stats;
let media;
let activePost;
let draftOwner;
let backupStored = false;
let editorialFields = true;
let entriesRevision = 0;
let commentsRevision = 0;
let referencesRevision = 0;
let entryListScroll = 0;
let listScreen = "entries";

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
  if (isNote) {
    fields.is_note = "true";
    fields.body = editorTools.noteBody();
  }
  return fields;
}
const snapshot = () => {
  const { series_order, ...fields } = entryFields();
  return JSON.stringify(fields);
};
const dirty = () => snapshot() !== baseline;
const localSlotPattern = /^new(?:-note|-[0-9a-f-]{36})?$/;
const slot = () => current || compositionSlot;
const editingId = () => current || "local:" + compositionSlot;
const backupKey = (id = slot()) => "common-hours:draft:" + getProjectOrigin() + ":" + draftOwner + ":" + id;
const selectedEntryKey = () => "common-hours:last-entry:" + getProjectOrigin() + ":" + draftOwner + ":selection";
const draftPath = id => "working_drafts?slot=eq." + id;
const slugFromTitle = title => title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").slice(0, 120).replace(/^-+|-+$/g, "");
function noteTitle({ text, photos, carousels = [] }) {
  return [...(text.trim().split(/\r?\n/, 1)[0] || (photos.length || carousels.length ? "Photo note" : "Untitled note"))].slice(0, 180).join("");
}

function draftEntry(row) {
  const source = posts.find(post => post.id === (row.fields.source_post || row.slot));
  const is_note = [true, "true"].includes(row.fields.is_note) || Boolean(source?.is_note);
  const title = is_note ? noteTitle(readNote(row.fields.body)) : row.fields.title?.trim() || "Untitled";
  const slug = source?.slug || slugFromTitle(row.fields.slug || title) || "untitled";
  return { ...row, id: (row.local ? "local:" : "draft:") + row.slot, source, title, slug, is_note, tag: row.fields.tag || "",
    published: false, published_on: row.saved_at.slice(0, 10) };
}

function showDraftStatus(message) {
  if (draftStatus.textContent !== message) draftStatus.textContent = message;
}

function updatePublishActions() {
  const changed = dirty();
  const needsSave = changed || Boolean(activePost);
  draftButton.disabled = busy || !needsSave;
  draftButton.textContent = needsSave ? "Save draft" : activeDraft ? "Draft saved" : "No changes";
  publishButton.textContent = activePost?.published || activeDraft?.source?.published
    ? (isNote ? "Update published note" : "Update published entry") : "Publish";
  publishButton.hidden = Boolean(activePost?.published) && !changed;
  shareButton.hidden = !activePost && !activeDraft;
  const label = activePost?.published ? (isNote ? "Share note" : "Share entry") : "Generate preview link";
  shareButton.title = label;
  shareButton.setAttribute("aria-label", label);
}

function readBackup(id = slot()) {
  try { return JSON.parse(localStorage.getItem(backupKey(id)) || "null"); }
  catch { return null; }
}

function localDrafts() {
  if (!draftOwner) return [];
  const prefix = backupKey("");
  const rows = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (!localSlotPattern.test(id)) continue;
      const backup = readBackup(id);
      if (backup?.fields && typeof backup.saved_at === "string") rows.push({ ...backup, slot: id, local: true });
    }
  } catch { /* Browser storage is optional. */ }
  return rows.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

function removeBackup() {
  try { localStorage.removeItem(backupKey()); } catch { /* Storage can be unavailable. */ }
}

function saveBackup() {
  if (!draftOwner) return;
  if (!dirty()) {
    removeBackup();
    backupStored = false;
    showDraftStatus("");
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

function recoverDraft() {
  const chosen = readBackup();
  if (!chosen) return;
  if (activeDraft && chosen.saved_at < activeDraft.saved_at) { removeBackup(); return; }
  for (const [name, value] of Object.entries(chosen.fields || {})) {
    const field = editor.elements.namedItem(name);
    if (!field || name === "series_order" || typeof value !== "string") continue;
    if (name === "series") setSeries(value);
    else if (field.type === "checkbox") field.checked = value === "true";
    else field.value = value;
  }
  tagInput.value = "";
  renderTagChips();
  updatePart();
  if (isNote) editorTools.setNote(true, chosen.fields.body);
  if (!dirty()) {
    removeBackup();
    return;
  }
  editorTools.refresh();
  updateEditorTitle();
  saveBackup();
  showDraftStatus("Changes recovered from this device.");
}

async function storeDraft(fields, source, id = source?.id || crypto.randomUUID()) {
  const [saved] = await api("working_drafts?on_conflict=user_id,slot", {
    method: "POST", prefer: "resolution=merge-duplicates,return=representation",
    body: { user_id: draftOwner, slot: id, saved_at: new Date().toISOString(), fields: {
      ...fields, title: fields.title?.trim() || "Untitled", ...(source && { source_post: source.id }),
    } },
  });
  if (!saved) throw new Error("The draft could not be saved.");
  // Updates to an existing row also persist the server-visible revision time.
  drafts = [saved, ...drafts.filter(draft => draft.slot !== saved.slot)];
  entriesRevision++;
  return draftEntry(saved);
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
  if (button) button.disabled = true;
  status.textContent = "Working…";
  try {
    await action();
    if (status.textContent === "Working…") status.textContent = "";
  } catch (error) {
    status.textContent = error?.code === "23505" ? "That URL slug is already in use." : error?.message || "The action could not be completed. Try again.";
  } finally {
    busy = false;
    editor.inert = false;
    if (button) button.disabled = false;
    updatePublishActions();
  }
}

function renderPostList() {
  const scrollTop = postList.scrollTop;
  const restoreFocus = document.activeElement?.closest(".entry-open")?.dataset.entryId;
  postList.replaceChildren();
  const term = search.value.trim().toLowerCase();
  const draftEntries = [...localDrafts(), ...drafts].map(draftEntry);
  const linkedDrafts = new Set(draftEntries.map(draft => draft.source?.id));
  const notesOnly = listScreen === "notes";
  const entries = [...draftEntries, ...posts.filter(post => post.published || !linkedDrafts.has(post.id))]
    .filter(post => !notesOnly || post.is_note);
  const type = notesOnly ? "all" : entryType.value;
  const filtered = entries.filter(post =>
    (type === "all" || Boolean(post.is_note) === (type === "notes")) &&
    (entryFilter.value === "all" || post.published === (entryFilter.value === "published")) &&
    (!term || post.title.toLowerCase().includes(term) || post.tag.toLowerCase().includes(term)));
  const tabStop = filtered.find(post => post.id === selectedEntry)?.id || filtered[0]?.id;
  const label = notesOnly ? (entries.length === 1 ? " note" : " notes") : (entries.length === 1 ? " entry" : " entries");
  document.querySelector("#entry-count").textContent = (filtered.length !== entries.length ? filtered.length + " of " : "") + entries.length + label;
  if (!filtered.length) {
    const item = document.createElement("li");
    const plural = notesOnly ? "notes" : "entries";
    item.textContent = term || type !== "all" || entryFilter.value !== "all" ? `No matching ${plural}.` : `No ${plural} yet.`;
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
    button.dataset.entryId = post.id;
    button.tabIndex = post.id === tabStop ? 0 : -1;
    const state = document.createElement("small");
    button.textContent = post.title;
    state.textContent = (post.is_note && !notesOnly ? "Note · " : "") + (post.published ? "Published" : "Draft") + " · " + post.published_on +
      (post.local ? " · On this device" : post.slot && post.source ? " · " + post.slug + "/draft" : "");
    state.dataset.published = String(post.published);
    button.append(state);
    if (post.id === selectedEntry) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => editEntry(post, button));
    const share = entryIcon(post.published ? "Share" : "Generate preview link for", post, "M12 15V3m-4 4 4-4 4 4M7 10H5v11h14V10h-2");
    share.disabled = Boolean(post.local);
    if (post.local) share.title = "Save this draft to share a preview link";
    share.addEventListener("click", () => shareEntry(post, share));
    const remove = entryIcon("Delete", post, "M4 7h16m-10 0V4h4v3M7 7l1 13h8l1-13m-6-9v4m2-4v4");
    remove.addEventListener("click", () => deleteEntry(post, remove));
    li.append(number, button, share, remove);
    postList.append(li);
  }
  postList.scrollTop = scrollTop;
  if (restoreFocus) selectedEntryButton()?.focus({ preventScroll: true });
}

function selectedEntryButton() {
  return postList.querySelector(".entry-open[aria-current]") || postList.querySelector(".entry-open");
}

function rememberEntry(id) {
  selectedEntry = id;
  if (!draftOwner) return;
  try { localStorage.setItem(selectedEntryKey(), id || ""); } catch { /* Selection also works without storage. */ }
}

function selectEntry(button) {
  if (!button || selectedEntry === button.dataset.entryId) return;
  rememberEntry(button.dataset.entryId);
  for (const row of postList.querySelectorAll(".entry-open")) {
    if (row === button) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
    row.tabIndex = row === button ? 0 : -1;
  }
}

postList.addEventListener("focusin", event => selectEntry(event.target.closest(".entry-open")));
postList.addEventListener("pointermove", event => {
  const button = event.pointerType === "mouse" && event.target.closest(".entry-open");
  if (!button || selectedEntry === button.dataset.entryId) return;
  selectEntry(button);
  if (postList.contains(document.activeElement) && document.activeElement.matches(".entry-open")) {
    button.focus({ preventScroll: true });
  }
});

document.addEventListener("keydown", event => {
  if (document.querySelector("#entries-panel").hidden || event.defaultPrevented || event.altKey || event.ctrlKey ||
      event.metaKey || event.shiftKey || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const target = event.target;
  if (document.querySelector("dialog[open]") ||
      !target.matches(".entry-open, #refresh-entries, [data-section=entries], [data-section=notes], #desk-menu") &&
      target.closest("input, select, textarea, button, a, [contenteditable]")) return;
  const rows = [...postList.querySelectorAll(".entry-open")];
  if (!rows.length) return;
  event.preventDefault();
  const index = rows.findIndex(row => row.dataset.entryId === selectedEntry);
  const next = index === -1 ? (event.key === "ArrowDown" ? 0 : rows.length - 1) :
    Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
  const button = rows[next];
  selectEntry(button);
  button.focus({ preventScroll: true });
  button.scrollIntoView({ block: "nearest" });
});

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
  if (!confirm('Permanently delete “' + post.title + '”?' + (post.published ? " Its comments will stay in the desk." : ""))) return;
  await run(button, async () => {
    if (post.local) localStorage.removeItem(backupKey(post.slot));
    else {
      const [removed] = await api(post.slot ? draftPath(post.slot) : "posts?id=eq." + post.id,
        { method: "DELETE", prefer: "return=representation" });
      if (!removed) throw new Error("The entry could not be deleted.");
      try { localStorage.removeItem(backupKey(post.id)); } catch { /* Browser storage is optional. */ }
      if (post.slot) drafts = drafts.filter(draft => draft.slot !== post.slot);
      else posts = posts.filter(entry => entry.id !== post.id);
    }
    if (selectedEntry === post.id) rememberEntry(undefined);
    entriesRevision++;
    if (editingId() === post.id) openEditor();
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
shareButton.addEventListener("click", () => shareEntry(activeDraft || activePost, shareButton));

function shareEntry(post, button) {
  return run(button, async () => {
    const url = new URL("../", location.href);
    const notice = document.querySelector("#share-notice");
    if (post?.published) {
      url.searchParams.set("post", post.slug);
      notice.textContent = "Anyone can open the published entry.";
    } else {
      // Legacy unpublished entries are converted to private working drafts on first share.
      if (!post.slot) {
        const [legacy] = await api("posts?id=eq." + post.id);
        if (!legacy) throw new Error("The draft is unavailable.");
        post = await storeDraft({ ...legacy, body: legacy.body.replace(markdownMarker, "") }, legacy);
        renderPostList();
      }
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const expiry = await adminRpc("create_draft_preview", { p_slot: post.slot, p_token: token });
      url.searchParams.set("view", "review");
      url.hash = token;
      notice.textContent = "Anyone with the link can read this saved copy until " +
        new Date(expiry).toLocaleString(undefined, { timeZone: "Asia/Kolkata" }) + ".";
    }
    shareLink.value = url.href;
    document.querySelector("#share-status").textContent = "";
    shareDialog.showModal();
    shareLink.select();
  });
}

function editEntry(post, button) {
  if (busy || !canLeaveDraft()) return;
  if (button?.dataset.entryId) selectEntry(button);
  run(button, async () => {
    if (post.id !== editingId()) {
      if (post.local) {
        rememberEntry(post.id);
        openEditor(undefined, undefined, post.is_note, post.slot);
      } else if (post.slot) openEditor(undefined, post);
      else {
        const [record] = await api("posts?id=eq." + post.id);
        if (!record) throw new Error("This entry is unavailable.");
        openEditor(record);
      }
      recoverDraft();
    } else {
      rememberEntry(post.id);
      renderPostList();
    }
    showSection("compose");
  }).then(() => {
    if (busy || editingId() !== post.id) return;
    if (isNote) editorTools.focus();
    else editTitle.focus({ preventScroll: true });
  });
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
  const all = entryTags(posts.flatMap(articleTopics).join(",")).filter(tag => !existing.includes(tag.toLowerCase())).sort((a,b) => a.localeCompare(b));
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
const partLabel = document.querySelector("#series-part");
let seriesSelection = "";
function setSeries(value) {
  const names = [...new Set([...posts.map(post => post.series), ...drafts.map(draft => draft.fields.series), value].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const create = new Option("Create", "");
  create.dataset.create = "true";
  seriesField.replaceChildren(create, new Option("No series", ""), ...names.map(name => new Option(name)));
  seriesSelection = value || "";
  seriesField.selectedIndex = seriesSelection ? names.indexOf(seriesSelection) + 2 : 1;
  updatePart();
}

function nextPart(series) {
  if (!series) return "";
  const source = activeDraft?.source || activePost;
  if (source?.published && source.series === series && source.series_order != null) return String(source.series_order);
  return String(posts.filter(post => post.published && post.id !== current && post.series?.toLowerCase() === series.toLowerCase())
    .reduce((highest, post) => Math.max(highest, post.series_order || 0), 0) + 1);
}

function updatePart() {
  partLabel.hidden = !seriesField.value;
  partField.value = nextPart(seriesField.value);
}

seriesField.addEventListener("input", () => {
  if (seriesField.selectedOptions[0]?.dataset.create) {
    const name = prompt("Name the series")?.trim();
    if (!name || [...name].length > 100) {
      if (name) status.textContent = "Use 100 characters or fewer for the series name.";
      setSeries(seriesSelection);
      return;
    }
    const existing = [...seriesField.options].find(option => option.value.toLowerCase() === name.toLowerCase());
    setSeries(existing?.value || name);
  } else {
    seriesSelection = seriesField.value;
    updatePart();
  }
});

function updateEditorTitle() {
  if (!titleInput.hidden) {
    titleInput.style.height = "auto";
    titleInput.style.height = titleInput.scrollHeight + "px";
  }
  const title = isNote ? "Note" : titleInput.value.trim() || "Untitled";
  titleHeading.textContent = title;
  document.querySelector("#editor-breadcrumb").textContent = title;
  const date = editor.elements.namedItem("published_on").value;
  document.querySelector("#editor-date").textContent = date ? " · " + new Date(date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}
new ResizeObserver(updateEditorTitle).observe(editorTitle.parentElement);

function openEditor(post, draft, note = false, localSlot = note ? "new-note" : "new") {
  clearPublishErrors();
  showSettings(false);
  activeDraft = draft;
  activePost = post;
  current = draft?.id || post?.id;
  compositionSlot = localSlot;
  isNote = Boolean(draft?.is_note || post?.is_note || note);
  if (draftOwner && current) rememberEntry(current);
  editor.reset();
  closeTags();
  tagInput.value = "";
  editHeading(false);
  const record = draft?.fields || post;
  originalBody = draft ? (isNote ? "" : markdownMarker) + (record.body || "") : post?.body || "";
  for (const key of ["title", "slug", "tag", "excerpt", "published_on", "reader_prompt"]) {
    editor.elements.namedItem(key).value = record?.[key] ?? "";
  }
  if (isNote && !record?.slug) editor.elements.namedItem("slug").value = "note-" + crypto.randomUUID();
  renderTagChips();
  setSeries(record?.series);
  editor.elements.namedItem("start_here").checked = [true, "true"].includes(record?.start_here);
  editor.elements.namedItem("body").value = !isNote && originalBody.startsWith(markdownMarker)
    ? originalBody.slice(markdownMarker.length) : originalBody;
  if (!editor.elements.namedItem("published_on").value) editor.elements.namedItem("published_on").value = journalToday();
  updateEditorTitle();
  document.querySelector("#editor-state").textContent = post?.published ? "Published" : "Draft";
  document.querySelector("#editor-state").dataset.published = String(Boolean(post?.published));
  document.querySelector("#draft-address").textContent = draft && !isNote ? " · " + draft.slug + "/draft" : "";
  editorTools.refresh(!post || originalBody.startsWith(markdownMarker));
  editorTools.setNote(isNote, originalBody);
  baseline = snapshot();
  backupStored = false;
  updatePublishActions();
  showDraftStatus("");
  if (!document.querySelector("#compose-panel").hidden) updateDeskAddress("compose");
  updateExitWarning();
  renderPostList();
}

async function loadPosts() {
  const revision = ++entriesRevision;
  const fields = "id,slug,title,published,tag,published_on";
  let loaded;
  let supportsEditorial = true;
  const order = "&order=published_on.desc,id.desc";
  for (const extra of [",series,series_order,start_here,is_note", ",series,series_order,start_here", ",is_note", ""]) {
    try {
      loaded = await allRows(api, "posts?select=" + fields + extra + order);
      supportsEditorial = extra.includes(",series");
      break;
    } catch (error) {
      if (!extra || !missingColumn(error)) throw error;
    }
  }
  let savedDrafts;
  try { savedDrafts = await allRows(api, "working_drafts?select=slot,fields,saved_at&order=saved_at.desc,slot.asc"); }
  catch (error) { if (!missingFeature(error)) throw error; savedDrafts = []; }
  if (revision !== entriesRevision) return;
  posts = loaded;
  drafts = savedDrafts;
  editorialFields = supportsEditorial;
  setSeries(seriesField.value);
  renderPostList();
  if (!document.querySelector("#stats-panel").hidden) renderDraftQueue();
}

async function refreshEntries() {
  try {
    await loadPosts();
    entryStatus.replaceChildren();
  } catch {
    if (listVisible()) showFailure(entryStatus, "The entry list could not refresh.", refreshEntries);
    return false;
  }
  return true;
}

document.querySelector("#refresh-entries").addEventListener("click", event => run(event.currentTarget, async () => {
  if (!await refreshEntries()) return;
  const button = selectedEntryButton();
  button?.focus({ preventScroll: true });
  button?.scrollIntoView({ block: "nearest" });
}));

document.addEventListener("visibilitychange", () => {
  if (document.hidden || !session || busy) return;
  void refreshEntries();
  if (!document.querySelector("#stats-panel").hidden) void loadModerationCount();
});

async function loadComments() {
  const revision = ++commentsRevision;
  const filter = document.querySelector("#comment-filter").value;
  const rows = await allRows(api, "comments?select=id,display_name,body,approved,post_id,deleted_entry_title&order=approved.asc,created_at.desc,id.desc" +
    (filter === "all" ? "" : filter === "pending" ? "&approved=eq.false&post_id=not.is.null" : "&approved=eq.true"));
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
    context.textContent = row.post_id ? (row.approved ? "Published" : "Pending") + " · " + (titles.get(row.post_id) || "Entry")
      : "Deleted entry · " + (row.deleted_entry_title || "Untitled");
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
    if (row.post_id) actions.append(moderate);
    actions.append(remove);
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
  const section = deskSection();
  const address = composeAddress(section);
  if (isListScreen(section)) listScreen = section;
  try { selectedEntry = localStorage.getItem(selectedEntryKey()); } catch { /* Selection is optional. */ }
  const draft = drafts.find(row => row.slot === address.draft);
  let post;
  if (posts.some(row => row.id === address.post)) {
    try { [post] = await api("posts?id=eq." + address.post); }
    catch { status.textContent = "This entry could not load."; }
  }
  const restoreComposition = draft || post || address.compose;
  openEditor(post, draft && draftEntry(draft), address.compose === "note", address.local);
  if (restoreComposition) recoverDraft();
  storeSession();
  login.reset();
  login.hidden = true;
  clearAuthenticatorSetup();
  desk.hidden = false;
  document.body.classList.add("desk-open");
  deskMenu.hidden = false;
  openSection(restoreComposition ? "compose" : section);
  if (!restoreComposition && isListScreen(section) && selectedEntry) selectedEntryButton()?.scrollIntoView({ block: "nearest" });
}

function verifiedSession(token) {
  try {
    const payload = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(atob(payload)).aal === "aal2";
  } catch { return false; }
}

function clearAuthenticatorSetup() {
  factorId = undefined;
  mfa.reset();
  mfa.hidden = mfaEnrollment.hidden = true;
  mfaQr.removeAttribute("src");
  mfaKey.textContent = "";
}

function showAuthenticatorStep(factor, enrolling = false) {
  factorId = factor;
  login.hidden = true;
  mfa.hidden = false;
  setupMfa.hidden = Boolean(factor);
  authenticatorCode.disabled = verifyMfa.hidden = document.querySelector("#mfa-code").hidden = !factor;
  document.querySelector("#mfa-title").textContent = enrolling ? "Set up your authenticator" : "Verify sign-in";
  document.querySelector("#mfa-help").textContent = enrolling
    ? factor ? "Scan the QR code in your authenticator app, then enter the six-digit code it generates."
      : "Add the Writing Desk to your authenticator app to complete sign-in."
    : "Enter the six-digit code from your authenticator app.";
  (factor ? authenticatorCode : setupMfa).focus();
}

async function openVerifiedDesk() {
  const token = await sessionToken();
  if (verifiedSession(token)) return openDesk();
  const [allowed, user] = await Promise.all([
    adminRpc("can_start_desk_sign_in", {}),
    request("/auth/v1/user", { token }),
  ]);
  if (allowed !== true) throw new Error("This account is not on the Writing Desk’s admin list.");
  const factors = (user.user ?? user).factors?.filter(item => item.status === "verified") || [];
  const factor = factors.find(item => item.factor_type === "totp" && mediaId.test(item.id));
  if (!factor && factors.length) throw new Error("This account uses another verification method. Update its authenticator in Supabase.");
  showAuthenticatorStep(factor?.id, !factor);
}

setupMfa.addEventListener("click", () => {
  if (!session || factorId || busy) return;
  void run(setupMfa, async () => {
    const enrollment = await request("/auth/v1/factors", {
      method: "POST", token: await sessionToken(),
      body: { factor_type: "totp", issuer: "The Common Hours" },
    });
    const qr = enrollment?.totp?.qr_code;
    const key = enrollment?.totp?.secret;
    if (!mediaId.test(enrollment?.id || "") || typeof qr !== "string" || !/^[A-Z2-7]+=*$/i.test(key || "")) {
      throw new Error("Authenticator setup could not start. Try again.");
    }
    mfaQr.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qr);
    mfaKey.textContent = key;
    mfaEnrollment.hidden = false;
    showAuthenticatorStep(enrollment.id, true);
  });
});

async function verifyAuthenticator(code) {
  const token = await sessionToken();
  const path = "/auth/v1/factors/" + factorId;
  const challenge = await request(path + "/challenge", { method: "POST", token, body: {} });
  try {
    const verified = await request(path + "/verify", {
      method: "POST", token, body: { challenge_id: challenge.id, code },
    });
    if (!verifiedSession(verified.access_token)) throw new Error("The authenticator could not verify this session.");
    setSession(verified);
  } catch (error) {
    if ([400, 401, 403, 422].includes(error.status)) throw new Error("That code could not be verified. Enter the current code from your authenticator.");
    throw error;
  }
}

function resetLogin() {
  session = draftOwner = factorId = undefined;
  storeSession();
  clearAuthenticatorSetup();
  login.hidden = false;
}

function showDeskLoading(message) {
  deskLoadingMessage.textContent = message;
  deskLoading.hidden = false;
}

async function runSignIn(button, message, action) {
  if (busy) return;
  const form = button.form;
  form.hidden = true;
  showDeskLoading(message);
  await run(button, action);
  deskLoading.hidden = true;
  if (desk.hidden && login.hidden && mfa.hidden) {
    form.hidden = false;
    button.focus();
  }
}

document.querySelector("#cancel-mfa").addEventListener("click", () => {
  if (busy) return;
  resetLogin();
  login.elements.namedItem("email").focus();
});
mfa.addEventListener("submit", event => {
  event.preventDefault();
  if (!session || !factorId || busy) return;
  const code = authenticatorCode.value;
  authenticatorCode.value = "";
  void runSignIn(event.submitter, "Verifying sign-in…", async () => {
    if (!verifiedSession(await sessionToken())) await verifyAuthenticator(code);
    await openDesk();
  });
});

async function initializeDesk() {
  const signIn = login.querySelector("button");
  try {
    if (!window.isSecureContext) throw new Error("Use the HTTPS address to sign in.");
    getProjectOrigin();
    signIn.disabled = false;
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(sessionKey())); }
    catch { /* Sign-in is still available if tab storage cannot be read. */ }
    if (saved?.access_token && saved?.refresh_token && Number.isFinite(saved.expires)) {
      session = saved;
      try {
        await openVerifiedDesk();
      } catch (error) {
        resetLogin();
        status.textContent = error.message;
      }
    } else login.hidden = false;
  } catch (error) {
    status.textContent = window.isSecureContext
      ? "The writing desk is not connected. Check its configuration and reload."
      : error.message;
    login.hidden = false;
    signIn.disabled = true;
  } finally {
    deskLoading.hidden = true;
  }
}

login.addEventListener("submit", event => {
  event.preventDefault();
  void runSignIn(event.submitter, "Signing in…", async () => {
    const body = Object.fromEntries(new FormData(login));
    login.elements.namedItem("password").value = "";
    try {
      setSession(await request("/auth/v1/token?grant_type=password", { method: "POST", body }));
    } catch (error) {
      if (error.status === 400 || error.status === 401) throw new Error("Check your email and password, then try again.");
      if (error.status === 429) throw new Error("Too many attempts. Wait a moment and try again.");
      throw error;
    }
    try { await openVerifiedDesk(); }
    catch (error) {
      resetLogin();
      throw error;
    }
  });
});

function newComposition(button, note) {
  if (busy || !canLeaveDraft()) return;
  run(button, () => {
    if (note) listScreen = "notes";
    openEditor(undefined, undefined, note, "new-" + crypto.randomUUID());
    showSection("compose");
  }).then(() => { if (!busy && !current) editorTools.focus(); });
}
newPost.addEventListener("click", () => newComposition(newPost, false));
newNote.addEventListener("click", () => newComposition(newNote, true));

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
    const field = name === "tag" ? tagInput : name === "body" ? editorTools.bodyControl() : editor.elements.namedItem(name);
    const message = document.createElement("span");
    message.id = "publish-error-" + name;
    message.className = "field-error";
    message.textContent = text;
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", message.id);
    publishErrors.set(field, message);
    if (name === "body") field.before(message);
    else if (field === titleInput) document.querySelector(".entry-state").after(message);
    else if (field === seriesField) field.parentElement.after(message);
    else field.after(message);
    return field;
  });
  if (fields.some(field => entryDetails.contains(field))) showSettings(true);
  if (fields[0] === titleInput) editTitle.click();
  else fields[0].focus();
  fields[0].scrollIntoView({ block: "nearest" });
}

function validateEntry(record) {
  const errors = new Map();
  if (!record.title) errors.set("title", "Enter a title.");
  if (record.is_note) {
    const { text, photos, carousels } = readNote(record.body);
    if (!text.trim() && !photos.length && !carousels.length) errors.set("body", "Write a note or add a photo before publishing.");
    else if ([...text.trim()].length > 500) errors.set("body", "Use 500 characters or fewer for the note.");
  } else if (!record.body) errors.set("body", "Write something in the entry body.");
  if (!record.tag) errors.set("tag", "Add at least one tag.");
  else if ([...record.tag].length > 400 || entryTags(record.tag).some(tag => [...tag].length > 40)) {
    errors.set("tag", "Use up to 40 characters per tag and 400 characters across all tags.");
  }
  if (!record.published_on) errors.set("published_on", "Choose a publication date.");
  if ((record.slug || record.title) && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(record.slug)) {
    errors.set("slug", "Enter a URL slug using lowercase letters, numbers, and hyphens.");
  }
  if (record.series_order && Number(record.series_order) > 9999) errors.set("series", "This series has reached 9,999 parts.");
  return errors;
}

editor.addEventListener("submit", event => {
  event.preventDefault();
  if (busy || !event.submitter || event.submitter.disabled) return;
  clearPublishErrors();
  const fields = entryFields();
  const note = isNote ? readNote(fields.body) : null;
  if (note) {
    fields.title = noteTitle(note);
    fields.tag ||= "Notes";
    fields.excerpt = note.text.trim() || (note.photos.length || note.carousels.length ? fields.title : "");
  }
  if (event.submitter.value === "draft") {
    const source = activeDraft?.source || activePost;
    const existing = !activeDraft && source && drafts.find(draft => draft.slot === source.id);
    if (existing && dirty() && !confirm("Replace your saved draft with these edits?")) return;
    void run(event.submitter, async () => {
      const saved = existing && !dirty() ? draftEntry(existing) : await storeDraft(fields, source, activeDraft?.slot);
      removeBackup();
      openEditor(undefined, saved);
      status.textContent = "Draft saved.";
    });
    return;
  }
  const record = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()]));
  if (note) record.body = writeNote(note.text.trim(), note);
  const knownTags = new Map(entryTags(posts.map(post => post.tag).join(",")).map(tag => [tag.toLowerCase(), tag]));
  record.tag = entryTags(record.tag).map(tag => knownTags.get(tag.toLowerCase()) || tag).join(", ");
  record.slug ||= activeDraft?.source?.slug || slugFromTitle(record.title);
  const errors = validateEntry(record);
  if (errors.size) {
    showPublishErrors(errors);
    return;
  }
  let fieldError;
  void run(event.submitter, async () => {
    if (!record.excerpt && !record.is_note) {
      record.excerpt = await entryExcerpt(record.body, record.title, record.body !== originalBody || originalBody.startsWith(markdownMarker));
    }
    if (record.is_note) record.is_note = true;
    if (editorialFields) {
      record.start_here = record.start_here === "true";
      record.series_order = record.series && record.series_order ? Number(record.series_order) : null;
    } else {
      if (record.series || record.start_here === "true") throw new Error("Apply the editor upgrade to publish a series or a starter entry.");
      delete record.series;
      delete record.series_order;
      delete record.start_here;
    }
    if (!record.is_note && (record.body !== originalBody || originalBody.startsWith(markdownMarker))) record.body = markdownMarker + record.body;
    record.published = true;
    const target = activeDraft?.source || activePost;
    const path = target ? "posts?id=eq." + target.id : "posts";
    const options = { method: target ? "PATCH" : "POST", body: record, prefer: "return=representation" };
    let saved;
    try {
      try { [saved] = await api(path, options); }
      catch (error) {
        if (!missingColumn(error)) throw error;
        if (record.reader_prompt) throw new Error("Apply the journal features database upgrade before publishing a reader prompt. Your edits can be saved as a draft.");
        delete record.reader_prompt;
        try { [saved] = await api(path, options); }
        catch (retryError) {
          if (!missingColumn(retryError) || !record.is_note) throw retryError;
          throw new Error("Apply the writing desk Notes upgrade before publishing notes. Your note can be saved as a draft.");
        }
      }
    } catch (error) {
      if (error.code !== "23505") throw error;
      fieldError = ["slug", "That URL slug is already in use. Enter a different one."];
      return;
    }
    if (!saved) throw new Error("The entry could not be saved.");
    entriesRevision++;
    removeBackup();
    let cleared = true;
    if (activeDraft) {
      try {
        await api(draftPath(activeDraft.slot), { method: "DELETE" });
        drafts = drafts.filter(draft => draft.slot !== activeDraft.slot);
      } catch { cleared = false; }
    }
    const { id, slug, title, tag, published, published_on, series, series_order, is_note } = saved;
    const summary = { id, slug, title, tag, published, published_on, series, series_order, is_note };
    posts = [summary, ...posts.filter(post => post.id !== id)].sort((a, b) =>
      b.published_on.localeCompare(a.published_on) || b.id.localeCompare(a.id));
    openEditor(saved);
    status.textContent = (is_note ? "Note published." : "Entry published.") + (cleared ? "" : " The draft copy is still in Entries.");
  }).then(() => { if (fieldError) showPublishErrors(new Map([fieldError])); });
});

const referenceForm = document.querySelector("#reference-form");
const referenceList = document.querySelector("#reference-list");
const referenceStatus = document.querySelector("#reference-status");
const referenceEmpty = document.querySelector("#reference-empty");
const addReference = document.querySelector("#add-reference");
const cancelReference = document.querySelector("#cancel-reference");
const saveReference = referenceForm.querySelector('[type="submit"]');
let editingReference;

function referenceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url;
  } catch { /* Invalid URLs remain plain text in the list. */ }
}

function editReference(reference, open = Boolean(reference)) {
  editingReference = reference;
  referenceForm.reset();
  referenceForm.hidden = !open;
  addReference.setAttribute("aria-expanded", String(open));
  document.querySelector("#reference-form-title").textContent = reference ? "Edit reference" : "New reference";
  referenceForm.elements.namedItem("alias").readOnly = Boolean(reference);
  if (reference) {
    for (const name of ["alias", "label", "url"]) referenceForm.elements.namedItem(name).value = reference[name];
  }
  if (open) referenceForm.elements.namedItem(reference ? "label" : "alias").focus();
}
addReference.addEventListener("click", () => {
  if (referenceForm.hidden) editReference(undefined, true);
  else referenceForm.elements.namedItem(editingReference ? "label" : "alias").focus();
});
cancelReference.addEventListener("click", () => { editReference(); addReference.focus(); });

async function loadReferences() {
  const revision = ++referencesRevision;
  try {
    const rows = await allRows(api, "references?select=alias,label,url&order=alias");
    if (revision !== referencesRevision) return false;
    references = rows;
    referenceStatus.textContent = "";
    referenceEmpty.hidden = references.length > 0;
    referenceList.replaceChildren(...references.map(reference => {
      const item = document.createElement("li");
      const label = document.createElement("strong");
      const alias = document.createElement("code");
      const details = document.createElement("div");
      details.className = "reference-details";
      label.textContent = reference.label;
      alias.textContent = "@" + reference.alias;
      const address = referenceUrl(reference.url);
      const url = document.createElement(address ? "a" : "small");
      if (address) {
        url.href = address.href;
        url.target = "_blank";
        url.rel = "noopener noreferrer";
      }
      url.textContent = reference.url;
      details.append(label, alias, url);
      const edit = document.createElement("button");
      const remove = document.createElement("button");
      edit.type = remove.type = "button";
      edit.textContent = "Edit";
      remove.textContent = "Delete";
      edit.setAttribute("aria-label", "Edit @" + reference.alias);
      remove.setAttribute("aria-label", "Delete @" + reference.alias);
      edit.addEventListener("click", () => editReference(reference));
      remove.addEventListener("click", () => {
        if (!confirm("Delete @" + reference.alias + " from References?")) return;
        void run(remove, async () => {
          await api("references?alias=eq." + reference.alias, { method: "DELETE" });
          if (editingReference?.alias === reference.alias) editReference();
          await loadReferences();
        });
      });
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.append(edit, remove);
      item.append(details, actions);
      return item;
    }));
    return true;
  } catch (error) {
    if (revision === referencesRevision) {
      referenceEmpty.hidden = true;
      showFailure(referenceStatus, missingFeature(error) ? "Apply the writing desk workflow SQL to enable References." : "References could not load.", loadReferences);
    }
    return false;
  }
}

referenceForm.addEventListener("submit", async event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(referenceForm));
  saveReference.disabled = cancelReference.disabled = true;
  referenceForm.inert = true;
  try {
    const url = referenceUrl(fields.url.trim());
    if (!url) throw new Error("Enter an HTTPS URL.");
    const body = { label: fields.label.trim(), url: url.href };
    const alias = fields.alias.trim().toLowerCase();
    if (!body.label) throw new Error("Enter link text.");
    await api(editingReference ? "references?alias=eq." + alias : "references", {
      method: editingReference ? "PATCH" : "POST",
      body: editingReference ? body : { ...body, alias },
    });
    editReference();
    addReference.focus();
    if (await loadReferences()) referenceStatus.textContent = "Reference saved.";
  } catch (error) {
    referenceStatus.textContent = error?.code === "23505" ? "That shortcut already exists. Select Edit to change it." : error?.message || "The reference could not be saved. Try again.";
  } finally { referenceForm.inert = saveReference.disabled = cancelReference.disabled = false; }
});

search.addEventListener("input", renderPostList);
entryFilter.addEventListener("change", renderPostList);
entryType.addEventListener("change", renderPostList);
titleInput.addEventListener("input", updateEditorTitle);
editor.elements.namedItem("published_on").addEventListener("input", updateEditorTitle);
editor.addEventListener("input", event => {
  clearPublishError(event.target);
  if (event.target === editor.elements.namedItem("body")) clearPublishError(editorTools.bodyControl());
  saveBackup();
});

const isListScreen = section => section === "entries" || section === "notes";

function sectionHash(section) {
  return "#" + ({ stats: "dashboard", site: "photos", compose: listScreen }[section] || section);
}

function deskSection() {
  return sections.find(button => sectionHash(button.dataset.section) === location.hash)?.dataset.section || "stats";
}

function composeAddress(section) {
  if (location.hash && !isListScreen(section)) return {};
  const params = new URLSearchParams(location.search);
  const draft = params.get("draft");
  const post = draft ? null : params.get("post");
  const mode = params.get("compose");
  const compose = !draft && !post && (mode === "note" || mode === "entry") ? mode : null;
  const local = params.get("local");
  return { draft, post, compose, local: compose && localSlotPattern.test(local) ? local : undefined };
}

function updateDeskAddress(section, navigate = false) {
  const url = new URL(location.href);
  url.searchParams.delete("draft");
  url.searchParams.delete("post");
  url.searchParams.delete("compose");
  url.searchParams.delete("local");
  if (section === "compose") {
    if (activeDraft) {
      url.searchParams.set("draft", activeDraft.slot);
      url.searchParams.set("post", activeDraft.slug + "/draft");
    } else if (activePost) url.searchParams.set("post", activePost.id);
    else {
      url.searchParams.set("compose", isNote ? "note" : "entry");
      url.searchParams.set("local", compositionSlot);
    }
  }
  url.hash = sectionHash(section);
  if (url.href === location.href) return;
  if (navigate) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

function showSection(section, navigate = false) {
  if (!document.querySelector("#entries-panel").hidden) entryListScroll = window.scrollY;
  if (isListScreen(section) && listScreen !== section) {
    listScreen = section;
    search.value = "";
    entryFilter.value = "all";
    entryListScroll = 0;
  }
  document.body.classList.toggle("writing", section === "compose");
  const panelId = (isListScreen(section) ? "entries" : section) + "-panel";
  for (const panel of document.querySelectorAll("[data-desk-panel]")) panel.hidden = panel.id !== panelId;
  for (const button of sections) {
    const selected = button.dataset.section === (section === "compose" ? listScreen : section);
    button.setAttribute("aria-pressed", String(selected));
  }
  if (isListScreen(section)) {
    const notes = section === "notes";
    const title = notes ? "Notes" : "Entries";
    document.querySelector("#entry-list-title").textContent = title;
    postList.setAttribute("aria-label", title);
    search.placeholder = notes ? "Search notes…" : "Search entries…";
    search.setAttribute("aria-label", notes ? "Search notes" : "Search entries");
    newPost.hidden = entryType.hidden = notes;
    newNote.classList.toggle("primary", notes);
    renderPostList();
  }
  document.querySelector("#back-entries").setAttribute("aria-label", listScreen === "notes" ? "Back to Notes" : "Back to Entries");
  updateDeskAddress(section, navigate);
  window.scrollTo(0, isListScreen(section) ? entryListScroll : 0);
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

const moderationQueue = document.querySelector("#moderation-queue");
const pendingCount = document.querySelector("#pending-comment-count");
const pendingComments = "comments?select=id&approved=eq.false&post_id=not.is.null";
let moderationRevision = 0;

moderationQueue.addEventListener("click", () => {
  if (busy || !canLeaveDraft()) return;
  document.querySelector("#comment-filter").value = "pending";
  openSection("comments", true);
  document.querySelector("#comment-filter").focus({ preventScroll: true });
});

function renderDraftQueue() {
  const recent = [...localDrafts(), ...drafts].map(row => {
    const backup = row.local ? null : readBackup("draft:" + row.slot);
    return { row, updatedAt: backup?.saved_at > row.saved_at ? backup.saved_at : row.saved_at };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  document.querySelector("#recent-drafts-empty").hidden = recent.length > 0;
  document.querySelector("#recent-drafts").replaceChildren(...recent.map(({ row: draft, updatedAt }) => {
    const post = draftEntry(draft);
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = post.title;
    button.addEventListener("click", () => {
      if (busy || !canLeaveDraft()) return;
      listScreen = post.is_note ? "notes" : "entries";
      editEntry(post, button);
    });
    const time = document.createElement("time");
    time.dateTime = updatedAt;
    time.textContent = new Date(updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    row.append(button, time);
    return row;
  }));
}

async function loadModerationCount() {
  const revision = ++moderationRevision;
  pendingCount.textContent = "Checking…";
  try {
    const count = await api(pendingComments, { method: "HEAD", prefer: "count=exact", count: true });
    if (revision === moderationRevision) pendingCount.textContent = String(count);
  } catch {
    if (revision === moderationRevision) pendingCount.textContent = "View pending comments";
  }
}

async function openStats() {
  renderDraftQueue();
  void loadModerationCount();
  try {
    const { setupStats } = await import("./stats.js");
    if (!session || document.querySelector("#stats-panel").hidden) return;
    stats ??= setupStats(api, () => posts, editEntry);
    await stats.load();
  } catch {
    showFailure(document.querySelector("#stats-status"), "The dashboard could not open.", openStats);
  }
}

let carouselEditor;
async function openCarousels(options) {
  const { setupCarouselEditor } = await import("./carousel-editor.js");
  carouselEditor ??= setupCarouselEditor(api, editorTools.openImageLibrary,
    (carousel, photo) => adminRpc("delete_carousel_photo", { p_carousel: carousel, p_id: photo }));
  return carouselEditor(options);
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
      carousel: openCarousels,
      remove: async asset => {
        if (asset.kind === "image") {
          try {
            if (await adminRpc("delete_image", { p_id: asset.id })) return;
          } catch (error) {
            if (error.code === "23503") throw new Error("Remove this image from its carousels before deleting.");
            throw error;
          }
          throw new Error("Remove this image from any entries or drafts and unfeature it before deleting.");
        }
        const removed = await removeAttachment(asset.id, await sessionToken());
        if (!removed?.some(file => file.name === asset.id)) throw new Error("Remove this file from any entries or drafts that use it first.");
        await api("asset_details?kind=eq.file&asset_id=eq." + asset.id, { method: "DELETE" });
      },
    });
    await media.load();
  } catch {
    showFailure(document.querySelector("#media-status"), "Media could not open.", openMedia);
  }
}

document.querySelector("#refresh-privacy").addEventListener("click", loadPrivacyRequests);
function openSection(section, navigate = false) {
  showSection(section, navigate);
  if (section === "site") void photoTools.loadPhoto();
  if (section === "inbox") void openInbox();
  if (section === "comments") void openComments();
  if (section === "stats") void openStats();
  if (section === "media") void openMedia();
  if (section === "references") void loadReferences();
}

async function restoreDeskSection() {
  if (desk.hidden || busy) return;
  const section = deskSection();
  const address = composeAddress(section);
  const draft = drafts.find(row => row.slot === address.draft);
  const post = posts.find(row => row.id === address.post);
  const screen = draft || post || address.compose ? "compose" : section;
  if (screen === "compose") {
    if (isListScreen(section)) listScreen = section;
    if (draft && current === "draft:" + draft.slot || post && current === post.id ||
        address.compose && !current && compositionSlot === (address.local || (address.compose === "note" ? "new-note" : "new"))) {
      showSection(screen);
      return;
    }
    await run(null, async () => {
      const [record] = post ? await api("posts?id=eq." + post.id) : [];
      if (post && !record) throw new Error("This entry is unavailable.");
      openEditor(record, draft && draftEntry(draft), address.compose === "note", address.local);
      recoverDraft();
      showSection(screen);
    });
    return;
  }
  if (isListScreen(screen) || document.querySelector("#" + screen + "-panel").hidden) openSection(screen);
  else updateDeskAddress(screen);
}
window.addEventListener("popstate", restoreDeskSection);
window.addEventListener("hashchange", restoreDeskSection);

for (const button of sections) {
  button.addEventListener("click", () => {
    if (deskNav.matches(":popover-open")) deskNav.hidePopover();
    if (!wide.matches) deskMenu.focus();
    if (busy || !canLeaveDraft()) return;
    const section = button.dataset.section;
    if (button.getAttribute("aria-pressed") === "true" && !document.body.classList.contains("writing")) return;
    openSection(section, true);
    if (isListScreen(section)) postList.focus({ preventScroll: true });
  });
}

const listVisible = () => !document.querySelector("#entries-panel").hidden;
setupShortcuts("Writing Desk shortcuts", [
  ["Alt + I", "Go to Entries", () => document.querySelector('[data-section="entries"]').click()],
  ["Alt + O", "Go to Notes", () => document.querySelector('[data-section="notes"]').click()],
  ["Alt + N", "New article from Entries", () => newPost.click(), () => listVisible() && !newPost.hidden],
  ["Alt + M", "New note from the list", () => newNote.click(), listVisible],
  ["Alt + K", "Search the current list", () => search.focus(), listVisible],
  ["Alt + S", "Save the current draft", () => draftButton.click(), () => document.body.classList.contains("writing") && !draftButton.disabled],
  ["↑ / ↓, then Enter", "Select and open an entry from the list"],
  ["/ or @", "Find insert commands or references in the article editor"],
], () => !desk.hidden && !busy, deskMenu);

document.querySelector("#desk-logout").addEventListener("click", event => {
  if (busy) return;
  saveBackup();
  if (!canLeaveDraft()) return;
  if (deskNav.matches(":popover-open")) deskNav.hidePopover();
  void run(event.currentTarget, async () => {
    desk.hidden = deskMenu.hidden = true;
    document.body.classList.remove("desk-open", "writing");
    showDeskLoading("Signing out…");
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

void initializeDesk();
