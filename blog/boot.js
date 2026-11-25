(() => {
  const notice = document.querySelector("#site-notice");
  const text = notice.querySelector("p");
  let shown = false;

  function javascriptFailed() {
    if (shown) return;
    shown = true;
    text.textContent = "The journal’s JavaScript could not load. You can still read and browse.";
    notice.hidden = false;
  }

  function hide() { notice.hidden = true; }
  notice.querySelector("button").addEventListener("click", hide);
  window.addEventListener("error", event => {
    if (event.target?.id === "journal-start" ||
        !document.documentElement.hasAttribute("data-interactive") && event.filename?.startsWith(location.origin + "/")) javascriptFailed();
  }, true);
})();
