import { getProjectOrigin } from "./config.js";
import { allRows, fetchAttachment, journalToday, markdownMarker, missingFeature, request, showFailure, table, uploadAttachment } from "./common.js";
import { setupEditorTools } from "./editor-tools.js";
import { setupPhotoTools } from "./photo-tools.js";

const login = document.querySelector("#login");
const editor = document.querySelector("#editor");
const desk = document.querySelector("#desk");
const status = document.querySelector("#status");
const logout = document.querySelector("#logout");
const postList = document.querySelector("#posts");
const comments = document.querySelector("#comments");
const refreshComments = document.querySelector("#refresh-comments");
const newPost = document.querySelector("#new-post");
const entryList = document.querySelector("#entry-list");
const search = document.querySelector("#find-entry");
const inbox = document.querySelector("#privacy-requests");
const sections = [...document.querySelectorAll("[data-section]")];
const narrow = matchMedia("(max-width: 760px)");
const editorTools = setupEditorTools(editor, api, {
  upload: async (id, file) => uploadAttachment(id, file, await sessionToken()),
  download: async id => fetchAttachment(id, await sessionToken()),
});
const photoTools = setupPhotoTools(api);
let originalBody = "";
let session;
let refresh;
let current;
let posts = [];
let baseline;
let busy = false;
let stats;

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

const snapshot = () => JSON.stringify([...new FormData(editor)]);
const dirty = () => snapshot() !== baseline;

function preventExit(event) {
  event.preventDefault();
  event.returnValue = "";
}

function updateExitWarning() {
  if (session && dirty()) window.addEventListener("beforeunload", preventExit);
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
  const tags = document.querySelector("#tags");
  tags.replaceChildren(...[...new Set(posts.map(post => post.tag))].sort().map(tag => new Option(tag)));
  const term = search.value.trim().toLowerCase();
  const filtered = posts.filter(post => !term || post.title.toLowerCase().includes(term) || post.tag.toLowerCase().includes(term));
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
      if (post.id === current || (dirty() && !confirm("Discard the unsaved changes to this entry?"))) return;
      run(button, async () => {
        const [record] = await api("posts?id=eq." + post.id);
        if (!record) throw new Error("This entry is unavailable.");
        openEditor(record);
        if (narrow.matches) entryList.open = false;
      });
    });
    li.append(button);
    postList.append(li);
  }
}

function openEditor(post) {
  current = post?.id;
  editor.reset();
  originalBody = post?.body || "";
  for (const key of ["title", "slug", "tag", "excerpt", "published_on"]) {
    editor.elements.namedItem(key).value = post?.[key] ?? "";
  }
  editor.elements.namedItem("body").value = originalBody.startsWith(markdownMarker)
    ? originalBody.slice(markdownMarker.length) : originalBody;
  if (!post) editor.elements.namedItem("published_on").value = journalToday();
  document.querySelector("#editor-title").textContent = post ? "Edit entry" : "New entry";
  editor.querySelector('[value="publish"]').textContent = post?.published ? "Update published entry" : "Publish";
  baseline = snapshot();
  editorTools.refresh();
  updateExitWarning();
  renderPostList();
}

async function loadPosts() {
  posts = await allRows(api, "posts?select=id,title,published,tag,published_on&order=published_on.desc,id.desc");
  renderPostList();
}

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
      await loadPosts();
      openEditor();
      showSection("entries");
      entryList.open = !narrow.matches;
    } catch (error) {
      session = undefined;
      throw error;
    }
    login.reset();
    login.hidden = true;
    desk.hidden = false;
    logout.hidden = false;
    void photoTools.loadOverview();
  });
});

logout.addEventListener("click", () => {
  if (busy || (dirty() && !confirm("Discard unsaved changes and sign out?"))) return;
  run(logout, async () => {
    try {
      await request("/auth/v1/logout?scope=local", { method: "POST", token: session.access_token });
    } finally {
      session = undefined;
      posts = [];
      openEditor();
      comments.replaceChildren();
      inbox.replaceChildren();
      search.value = "";
      photoTools.clear();
      stats?.clear();
      desk.hidden = true;
      logout.hidden = true;
      login.hidden = false;
    }
  });
});

newPost.addEventListener("click", () => {
  if (busy || (dirty() && !confirm("Discard the unsaved changes to this entry?"))) return;
  openEditor();
  if (narrow.matches) entryList.open = false;
  editor.elements.namedItem("title").focus();
});

refreshComments.addEventListener("click", () => run(refreshComments, async () => {
  await loadComments();
  status.textContent = "Comments refreshed.";
}));

editor.addEventListener("submit", event => {
  event.preventDefault();
  run(event.submitter, async () => {
    const record = Object.fromEntries([...new FormData(editor)].map(([key, value]) => [key, value.trim()]));
    record.slug ||= record.title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").slice(0, 120).replace(/^-+|-+$/g, "");
    if (!record.slug) throw new Error("Enter a slug using lowercase letters, numbers, and hyphens.");
    if (!record.title || !record.tag || !record.excerpt || !record.body) {
      throw new Error("Fill in the title, tag, excerpt, and body.");
    }
    if (record.body !== originalBody || originalBody.startsWith(markdownMarker)) record.body = markdownMarker + record.body;
    record.published = event.submitter.value === "publish";
    const path = current ? "posts?id=eq." + current : "posts";
    const [saved] = await api(path, { method: current ? "PATCH" : "POST", body: record, prefer: "return=representation" });
    if (!saved) throw new Error("The entry could not be saved.");
    const { id, title, tag, published, published_on } = saved;
    const summary = { id, title, tag, published, published_on };
    posts = [summary, ...posts.filter(post => post.id !== id)].sort((a, b) =>
      b.published_on.localeCompare(a.published_on) || b.id.localeCompare(a.id));
    openEditor(saved);
    status.textContent = saved.published ? "Entry published." : "Draft saved.";
  });
});

search.addEventListener("input", renderPostList);
editor.addEventListener("input", updateExitWarning);

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

document.querySelector("#refresh-privacy").addEventListener("click", loadPrivacyRequests);
for (const button of sections) {
  button.addEventListener("click", () => {
    if (busy || button.getAttribute("aria-pressed") === "true") return;
    const section = button.dataset.section;
    showSection(section);
    if (section === "site") void photoTools.loadPhoto();
    if (section === "inbox") void openInbox();
    if (section === "stats") void openStats();
  });
}

document.querySelector("#manage-photos").addEventListener("click", () => {
  if (busy) return;
  showSection("site");
  void photoTools.loadPhoto();
});
