if (!location.search) document.querySelector("#hero-skeleton").hidden = false;
import("./journal.js").catch(() => {
  document.body.removeAttribute("data-loading");
  document.querySelector("#hero-skeleton").hidden = true;
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
