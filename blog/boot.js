(() => {
  const notice = document.querySelector("#site-notice");
  const text = notice.querySelector("p");
  let kind;

  function show(next, message) {
    if (kind === next) return;
    kind = next;
    text.textContent = message;
    notice.hidden = false;
  }

  function hide() { notice.hidden = true; }
  notice.querySelector("button").addEventListener("click", hide);
  const offline = () => show("offline", "You’re offline. You can still read saved articles.");
  window.addEventListener("offline", offline);
  window.addEventListener("online", () => {
    if (kind !== "offline") return;
    hide();
    kind = undefined;
  });
  if (!navigator.onLine || document.documentElement.hasAttribute("data-offline-copy")) offline();

  const javascriptFailed = () => show("script", "The journal’s JavaScript could not load. You can still read and browse.");
  window.addEventListener("error", event => {
    if (event.target?.id === "journal-start" ||
        !document.documentElement.hasAttribute("data-interactive") && event.filename?.startsWith(location.origin + "/")) javascriptFailed();
  }, true);
})();
