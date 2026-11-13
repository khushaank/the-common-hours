document.addEventListener("contextmenu", event => {
  if (event.target.closest("img")) event.preventDefault();
});
if (new URLSearchParams(location.search).get("view") !== "review" && "serviceWorker" in navigator) {
  const register = () => void navigator.serviceWorker.register("./static-cache.js").catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(register);
  else window.addEventListener("load", register, { once: true });
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
