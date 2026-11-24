export function showFailure(element, message, retry, label = "Try again") {
  const text = document.createElement("p");
  text.setAttribute("role", "alert");
  text.textContent = message;
  element.replaceChildren(text);
  if (!retry) return;
  const button = document.createElement("button");
  button.className = "quiet-button";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await retry(); }
    catch { text.textContent = message; }
    finally { button.disabled = false; }
  });
  element.append(button);
}

export function watchUnexpectedErrors(message) {
  const banner = document.createElement("div");
  banner.className = "unexpected-error";
  banner.hidden = true;
  document.body.append(banner);
  const show = () => {
    if (!banner.hidden) return;
    banner.hidden = false;
    showFailure(banner, message, () => location.reload(), "Reload");
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "quiet-button";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => { banner.hidden = true; });
    banner.append(dismiss);
  };
  window.addEventListener("error", event => { if (event instanceof ErrorEvent) show(); });
  window.addEventListener("unhandledrejection", show);
}
