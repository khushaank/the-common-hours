const params = new URLSearchParams(location.search);
if (!["view", "post", "month", "tag", "series", "page"].some(key => params.has(key))) {
  const cover = document.querySelector("#week-photo");
  cover.querySelector("img").src = "cover.jpg";
  cover.hidden = false;
}
if (params.get("view") !== "review" && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("./static-cache.js").catch(() => {});
}
import("./journal.js").catch(() => {
  const content = document.querySelector("#content");
  content.setAttribute("aria-busy", "false");
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = "The journal could not start. Reload to try again.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "quiet-button";
  retry.textContent = "Reload";
  retry.addEventListener("click", () => location.reload());
  content.replaceChildren(message, retry);
});
