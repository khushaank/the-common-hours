import { getProjectOrigin } from "./config.js";
import { allRows, fetchAttachment, journalToday, listAttachments, markdownMarker, missingColumn, missingFeature, readMediaImage, request, showFailure, table, uploadAttachment } from "./common.js";
import { setupEditorTools } from "./editor-tools.js";
import { setupReviewLinks } from "./review-links.js";
import { setupPhotoTools } from "./photo-tools.js";

const login = document.querySelector("#login");
const editor = document.querySelector("#editor");
const desk = document.querySelector("#desk");
const status = document.querySelector("#status");
const postList = document.querySelector("#posts");
const comments = document.querySelector("#comments");
const refreshComments = document.querySelector("#refresh-comments");
const newPost = document.querySelector("#new-post");
const entryList = document.querySelector("#entry-list");
const search = document.querySelector("#find-entry");
const inbox = document.querySelector("#privacy-requests");
const draftStatus = document.querySelector("#draft-status");
const deskMenu = document.querySelector("#desk-menu");
const deskNav = document.querySelector("#desk-nav");
const sections = [...document.querySelectorAll("[data-section]")];
const narrow = matchMedia("(max-width: 760px)");
const editorTools = setupEditorTools(editor, api, {
  upload: async (id, file) => {
    await uploadAttachment(id, file, await sessionToken());
    const filename = file.name.slice(0, 200);
    try { await saveAsset({ id, kind: "file" }, { title: filename, original: filename, alt: "", description: "" }); }
    catch (error) { if (error.code !== "PGRST202") throw error; }
  },
  download: async id => fetchAttachment(id, await sessionToken()),
}, () => posts);
const photoTools = setupPhotoTools(api);
let originalBody = "";
let session;
let refresh;
let current;
let posts = [];
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


function setSession(data) {
  session = { ...data, expires: Date.now() + (data.expires_in - 30) * 1000 };
}

async function sessionToken() {
  if (!session) throw new Error("Sign in again to continue.");
  if (session.expires < Date.now()) {
    refresh ??= request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST", body: { refresh_token: session.refresh_token }
    }).then(setSession).catch(() => {
      throw new Error("Your session expired. Sign out and sign in again.");
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

function entryFields() {
  const fields = Object.fromEntries(new FormData(editor));
  fields.start_here = String(editor.elements.namedItem("start_here").checked);
  return fields;
}
const snapshot = () => JSON.stringify(entryFields());
const dirty = () => snapshot() !== baseline;
const slot = () => current || "new";
const backupKey = () => "common-hours:draft:" + getProjectOrigin() + ":" + draftOwner + ":" + slot();
const lastEntryKey = () => "common-hours:last-entry:" + getProjectOrigin() + ":" + draftOwner;
const cloudPath = () => "working_drafts?slot=eq." + slot();
const reviews = setupReviewLinks(adminRpc, sessionToken, () => ({ owner: draftOwner, slot: slot(), fields: entryFields(), dirty: dirty() }), run, status, showDraftStatus);

function showDraftStatus(message) {
  if (draftStatus.textContent !== message) draftStatus.textContent = message;
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
    if (!field || typeof value !== "string") continue;
    if (field.type === "checkbox") field.checked = value === "true";
    else field.value = value;
  }
  if (!dirty()) {
    removeBackup();
    cloudDraft = false;
    return;
  }
  editorTools.refresh();
  saveBackup();
  showDraftStatus(chosen === local ? "Draft recovered from this device." : "Saved draft restored.");
  reviews.changed();
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
  }
}

function renderPostList() {
  postList.replaceChildren();
  const term = search.value.trim().toLowerCase();
  const filtered = posts.filter(post => !term || post.title.toLowerCase().includes(term) || post.tag.toLowerCase().includes(term));
  document.querySelector("#entry-count").textContent = (term ? filtered.length + " of " : "") + posts.length + (posts.length === 1 ? " entry" : " entries");
  if (!filtered.length) {
    const item = document.createElement("li");
    item.textContent = term ? "No matching entries." : "No entries yet.";
    postList.append(item);
  }
  for (const post of filtered) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    const state = document.createElement("small");
    button.textContent = post.title;
    state.textContent = (post.published ? "Published" : "Draft") + " · " + post.published_on;
    button.append(state);
    if (post.id === current) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => {
      if (post.id === current || !canLeaveDraft()) return;
      run(button, async () => {
        const [record] = await api("posts?id=eq." + post.id);
        if (!record) throw new Error("This entry is unavailable.");
        openEditor(record);
        await recoverDraft();
        if (narrow.matches) entryList.open = false;
      });
    });
    li.append(button);
    postList.append(li);
  }
}

const tags = document.querySelector("#tags");
const tagInput = editor.elements.namedItem("tag");
let activeTag = -1;

function closeTags() {
  tags.hidden = true;
  activeTag = -1;
  tagInput.setAttribute("aria-expanded", "false");
  tagInput.removeAttribute("aria-activedescendant");
}

function acceptTag(value) {
  tagInput.value = value;
  // Bubble directly to the editor's draft listener without reopening the list.
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  closeTags();
}

function showTags() {
  const value = tagInput.value.trim();
  const query = value.toLowerCase();
  const all = [...new Set(posts.map(post => post.tag).filter(Boolean))].sort((a,b) => a.localeCompare(b));
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
tagInput.addEventListener("input", showTags);
tagInput.addEventListener("blur", closeTags);
tagInput.addEventListener("keydown", event => {
  if (event.isComposing) return;
  if (event.key === "Escape" && !tags.hidden) { event.preventDefault(); closeTags(); return; }
  if (event.key === "Enter" && !tags.hidden) {
    event.preventDefault();
    if (activeTag >= 0) tags.children[activeTag]?.click();
    else acceptTag(posts.find(post => post.tag.toLowerCase() === tagInput.value.trim().toLowerCase())?.tag || tagInput.value.trim());
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

function openEditor(post) {
  activePost = post;
  current = post?.id;
  if (draftOwner) {
    try { localStorage.setItem(lastEntryKey(), slot()); } catch { /* Entry switching also works without storage. */ }
  }
  editor.reset();
  closeTags();
  originalBody = post?.body || "";
  for (const key of ["title", "slug", "tag", "excerpt", "published_on", "series", "series_order"]) {
    editor.elements.namedItem(key).value = post?.[key] ?? "";
  }
  editor.elements.namedItem("start_here").checked = Boolean(post?.start_here);
  editor.elements.namedItem("body").value = originalBody.startsWith(markdownMarker)
    ? originalBody.slice(markdownMarker.length) : originalBody;
  if (!post) editor.elements.namedItem("published_on").value = journalToday();
  document.querySelector("#editor-title").textContent = post ? "Edit entry" : "New entry";
  editor.querySelector('[value="publish"]').textContent = post?.published ? "Update published entry" : "Publish";
  baseline = snapshot();
  reviews.open();
  backupStored = cloudDraft = false;
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
  renderPostList();
}

document.querySelector("#refresh-entries").addEventListener("click", event => run(event.currentTarget, loadPosts));

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && session && !busy) void loadPosts().catch(() => {});
});

async function loadComments() {
  const rows = await allRows(api, "comments?select=id,display_name,body,approved,post_id&order=approved.asc,created_at.desc,id.desc");
  comments.replaceChildren();
  if (!rows.length) comments.textContent = "No comments yet.";
  const titles = new Map(posts.map(post => [post.id, post.title]));
  for (const row of rows) {
    const article = document.createElement("article");
    article.className = "comment";
    const name = document.createElement("strong");
    name.textContent = row.display_name;
    const context = document.createElement("small");
    context.textContent = (row.approved ? "Visible" : "Pending") + " · " + (titles.get(row.post_id) || "Entry");
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

try {
  if (!window.isSecureContext) throw new Error("Use the HTTPS address to sign in.");
  getProjectOrigin();
  login.querySelector("button").disabled = false;
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
    try {
      const allowed = await api("admins?select=user_id&limit=1");
      if (!allowed.length) throw new Error("This account does not have access to the writing desk.");
      draftOwner = allowed[0].user_id;
      await loadPosts();
      let lastEntry;
      try {
        const remembered = localStorage.getItem(lastEntryKey());
        if (posts.some(post => post.id === remembered)) [lastEntry] = await api("posts?id=eq." + remembered);
      } catch { /* A remembered entry is optional. */ }
      openEditor(lastEntry);
      await recoverDraft();
      showSection("entries");
      entryList.open = !narrow.matches;
    } catch (error) {
      session = undefined;
      draftOwner = undefined;
      throw error;
    }
    login.reset();
    login.hidden = true;
    desk.hidden = false;
    deskMenu.hidden = false;
  });
});

newPost.addEventListener("click", () => {
  if (busy || !canLeaveDraft()) return;
  run(newPost, async () => {
    openEditor();
    await recoverDraft();
    if (narrow.matches) entryList.open = false;
  }).then(() => editor.elements.namedItem("title").focus());
});

refreshComments.addEventListener("click", () => run(refreshComments, async () => {
  await loadComments();
  status.textContent = "Comments refreshed.";
}));

editor.addEventListener("submit", event => {
  event.preventDefault();
  run(event.submitter, async () => {
    const fields = entryFields();
    const record = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()]));
    const publishing = event.submitter.value === "publish";
    record.tag = posts.find(post => post.tag.toLowerCase() === record.tag.toLowerCase())?.tag || record.tag;
    record.slug ||= record.title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").slice(0, 120).replace(/^-+|-+$/g, "");
    const validSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(record.slug);
    const complete = validSlug && record.title && record.tag && record.excerpt && record.body && record.published_on;
    if (!publishing && (activePost?.published || !complete)) {
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
      updateExitWarning();
      showDraftStatus("Draft saved.");
      status.textContent = (activePost?.published ? "Draft saved. Your published entry is still live." : "Draft saved.") + await reviews.save();
      return;
    }
    if (!validSlug) throw new Error("Enter a slug using lowercase letters, numbers, and hyphens.");
    if (!complete) throw new Error("Fill in the title, tag, excerpt, date, and body.");
    if (editorialFields) {
      record.start_here = record.start_here === "true";
      record.series_order = record.series && record.series_order ? Number(record.series_order) : null;
      if (record.series_order !== null && (!Number.isInteger(record.series_order) || record.series_order < 1 || record.series_order > 9999)) {
        throw new Error("Choose a part number from 1 to 9999.");
      }
    } else {
      if (record.series || record.start_here === "true") throw new Error("Apply the editor upgrade to publish a series or a starter entry.");
      delete record.series;
      delete record.series_order;
      delete record.start_here;
    }
    if (record.body !== originalBody || originalBody.startsWith(markdownMarker)) record.body = markdownMarker + record.body;
    record.published = publishing;
    const path = current ? "posts?id=eq." + current : "posts";
    const [saved] = await api(path, { method: current ? "PATCH" : "POST", body: record, prefer: "return=representation" });
    if (!saved) throw new Error("The entry could not be saved.");
    entriesRevision++;
    const reviewNote = await reviews.save({ p_post: saved.id, p_publish: publishing });
    removeBackup();
    const cleared = await deleteCloudDraft().then(() => true, () => false);
    const { id, slug, title, tag, published, published_on } = saved;
    const summary = { id, slug, title, tag, published, published_on };
    posts = [summary, ...posts.filter(post => post.id !== id)].sort((a, b) =>
      b.published_on.localeCompare(a.published_on) || b.id.localeCompare(a.id));
    openEditor(saved);
    status.textContent = (saved.published ? "Entry published." : "Draft saved.") +
      (cleared ? "" : " The previous cloud draft could not be cleared.") + reviewNote;
  });
});

search.addEventListener("input", renderPostList);
editor.addEventListener("input", () => { saveBackup(); reviews.changed(); });

function showSection(section) {
  for (const button of sections) {
    const selected = button.dataset.section === section;
    button.setAttribute("aria-pressed", String(selected));
    document.querySelector("#" + button.dataset.section + "-panel").hidden = !selected;
  }
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
  comments.textContent = "Loading comments…";
  inbox.textContent = "Loading privacy requests…";
  await Promise.allSettled([
    loadComments().catch(() => showFailure(comments, "Comments could not load.", openInbox)),
    loadPrivacyRequests(),
  ]);
}

async function openStats() {
  try {
    const { setupStats } = await import("./stats.js");
    if (!session || document.querySelector("#stats-panel").hidden) return;
    stats ??= setupStats(api, () => posts);
    await stats.load();
  } catch {
    document.querySelector("#stats-status").textContent = "Stats could not open. Try again.";
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
    });
    await media.load();
  } catch {
    document.querySelector("#media-status").textContent = "Media could not open. Try again.";
  }
}

document.querySelector("#refresh-privacy").addEventListener("click", loadPrivacyRequests);
for (const button of sections) {
  button.addEventListener("click", () => {
    if (busy) return;
    deskNav.hidePopover();
    if (button.getAttribute("aria-pressed") === "true") return;
    const section = button.dataset.section;
    showSection(section);
    if (section === "site") void photoTools.loadPhoto();
    if (section === "inbox") void openInbox();
    if (section === "stats") void openStats();
    if (section === "media") void openMedia();
  });
}
