export function showFailure(element, message, retry, label = "Try again", dismiss = false) {
  const text = document.createElement("p");
  text.setAttribute("role", "alert");
  text.textContent = message;
  const feedback = document.createElement("div");
  feedback.className = "failure-message";
  feedback.append(text);
  element.replaceChildren(feedback);
  if (dismiss) {
    const close = document.createElement("button");
    close.className = "notice-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close notice");
    close.textContent = "×";
    close.addEventListener("click", () => {
      feedback.remove();
      if (typeof dismiss === "function") dismiss();
    });
    feedback.append(close);
  }
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
  feedback.append(button);
}

export function watchUnexpectedErrors(message, enabled = () => true) {
  const banner = document.createElement("div");
  banner.className = "unexpected-error";
  banner.hidden = true;
  document.body.append(banner);
  const show = () => {
    if (!banner.hidden || !enabled()) return;
    banner.hidden = false;
    showFailure(banner, message, () => location.reload(), "Reload", () => { banner.hidden = true; });
  };
  window.addEventListener("error", event => {
    if (event instanceof ErrorEvent && event.filename?.startsWith(location.origin + "/")) show();
  });
  window.addEventListener("unhandledrejection", show);
}
