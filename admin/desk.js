import { publishableKey, getProjectOrigin } from "./config.js";

const login = document.querySelector("#login");
const editor = document.querySelector("#editor");
const desk = document.querySelector("#desk");
const status = document.querySelector("#status");
const logout = document.querySelector("#logout");
const postList = document.querySelector("#posts");
const comments = document.querySelector("#comments");
const refreshComments = document.querySelector("#refresh-comments");
const newPost = document.querySelector("#new-post");
let session;
let refresh;
let current;
let posts = [];
let baseline;
let busy = false;

async function request(path, { method = "GET", body, token, prefer } = {}) {
  const headers = { apikey: publishableKey };
  if (token) headers.Authorization = "Bearer " + token;
  if (prefer) headers.Prefer = prefer;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(getProjectOrigin() + path, {
    method, headers, cache: "no-store", body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  const data = response.headers.get("content-type")?.includes("json") && raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(data?.message || data?.msg || "The request failed.");
  return data;
}

function setSession(data) {
  session = { ...data, expires: Date.now() + (data.expires_in - 30) * 1000 };
}

async function api(path, options = {}) {
  if (session.expires < Date.now()) {
    refresh ??= request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST", body: { refresh_token: session.refresh_token }
    }).then(setSession).catch(() => {
      throw new Error("Your session expired. Sign out and sign in again.");
    }).finally(() => { refresh = undefined; });
    await refresh;
  }
  return request("/rest/v1/qmargin_b74_" + path, { ...options, token: session.access_token });
}

async function allRows(path) {
  const rows = [];
  while (true) {
    const batch = await api(path + "&limit=100&offset=" + rows.length);
    if (!batch.length) return rows;
    rows.push(...batch);
  }
}

const snapshot = () => JSON.stringify([...new FormData(editor)]);
const dirty = () => snapshot() !== baseline;

async function run(button, action) {
  if (busy) return;
  busy = true;
  editor.inert = true;
  button.disabled = true;
  status.textContent = "";
  try {
    await action();
  } catch (error) {
    status.textContent = error.message;
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
  for (const post of posts) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    const state = document.createElement("small");
    button.textContent = post.title;
    state.textContent = post.published ? "Published" : "Draft";
    button.append(state);
    if (post.id === current) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => {
      if (post.id === current || (dirty() && !confirm("Discard the unsaved changes to this entry?"))) return;
      run(button, async () => {
        const [record] = await api("posts?id=eq." + post.id);
        if (!record) throw new Error("This entry is unavailable.");
        openEditor(record);
      });
    });
    li.append(button);
    postList.append(li);
  }
}

function openEditor(post) {
  current = post?.id;
  editor.reset();
  for (const key of ["title", "slug", "tag", "excerpt", "body", "published_on"]) {
    editor.elements.namedItem(key).value = post?.[key] ?? "";
  }
  if (!post) editor.elements.namedItem("published_on").value =
    new Date().toLocaleDateString("sv-SE");
  document.querySelector("#editor-title").textContent = post ? "Edit entry" : "New entry";
  editor.querySelector('[value="publish"]').textContent = post?.published ? "Update published entry" : "Publish";
  baseline = snapshot();
  renderPostList();
}

async function loadPosts() {
  posts = await allRows("posts?select=id,title,published,tag&order=published_on.desc,id.desc");
  renderPostList();
}

async function loadComments() {
  const rows = await allRows("comments?select=id,display_name,body,approved,post_id&order=approved.asc,created_at.desc,id.desc");
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
  getProjectOrigin();
  login.querySelector("button").disabled = false;
} catch {
  status.textContent = "Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the local .env file, then restart the writing desk.";
  login.querySelector("button").disabled = true;
}

login.addEventListener("submit", event => {
  event.preventDefault();
  run(event.submitter, async () => {
    const body = Object.fromEntries(new FormData(login));
    login.elements.namedItem("password").value = "";
    setSession(await request("/auth/v1/token?grant_type=password", { method: "POST", body }));
    try {
      const allowed = await api("admins?select=user_id&limit=1");
      if (!allowed.length) throw new Error("This account does not have access to the writing desk.");
      await loadPosts();
      await loadComments();
      openEditor();
    } catch (error) {
      session = undefined;
      throw error;
    }
    login.reset();
    login.hidden = true;
    desk.hidden = false;
    logout.hidden = false;
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
      desk.hidden = true;
      logout.hidden = true;
      login.hidden = false;
    }
  });
});

newPost.addEventListener("click", () => {
  if (busy || (dirty() && !confirm("Discard the unsaved changes to this entry?"))) return;
  openEditor();
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
    record.published = event.submitter.value === "publish";
    const path = current ? "posts?id=eq." + current : "posts";
    const [saved] = await api(path, { method: current ? "PATCH" : "POST", body: record, prefer: "return=representation" });
    if (!saved) throw new Error("The entry could not be saved.");
    const summary = { id: saved.id, title: saved.title, tag: saved.tag, published: saved.published };
    posts = [summary, ...posts.filter(post => post.id !== saved.id)];
    openEditor(saved);
    status.textContent = saved.published ? "Entry published." : "Draft saved.";
  });
});

window.addEventListener("beforeunload", event => {
  if (!desk.hidden && dirty()) event.preventDefault();
});
