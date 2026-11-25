import { request } from "./common.js";

export async function mountNoteLikes(content) {
  const buttons = [...content.querySelectorAll("[data-note-like]")].filter(button => !button.dataset.mounted);
  const load = (ids, like) => request("/rest/v1/rpc/qmargin_b74_note_likes", {
    method: "POST", body: { p_notes: ids, p_like: like || null },
  });
  const display = (button, state) => {
    button.hidden = false;
    button.disabled = false;
    button.setAttribute("aria-pressed", String(state.liked));
    button.setAttribute("aria-disabled", String(state.liked || !state.can_like));
    button.querySelector("[aria-hidden]").textContent = state.liked ? "♥" : "♡";
    button.querySelector(".like-label").textContent = state.liked ? "Liked" : "Like";
    button.querySelector(".like-count").textContent = state.total;
  };
  for (let start = 0; start < buttons.length; start += 40) {
    const group = buttons.slice(start, start + 40);
    group.forEach(button => { button.dataset.mounted = "true"; });
    const states = new Map((await load(group.map(button => button.dataset.noteLike)))
      .map(state => [state.note_id, state]));
    for (const button of group) {
      const id = button.dataset.noteLike;
      const state = states.get(id);
      if (!state) continue;
      display(button, state);
      button.addEventListener("click", async () => {
        if (button.getAttribute("aria-disabled") === "true") return;
        button.setAttribute("aria-disabled", "true");
        const label = button.querySelector(".like-label");
        try {
          const [updated] = await load([id], id);
          if (!updated?.liked) throw new Error("Could not save like.");
          display(button, updated);
        } catch {
          label.textContent = "Try again";
          button.setAttribute("aria-disabled", "false");
        }
      });
    }
  }
}
