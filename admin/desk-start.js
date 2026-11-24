document.addEventListener("dragstart", event => {
  if (event.target.closest("a, img")) event.preventDefault();
});

import("./desk.js").catch(() => {
  if (window.top !== window.self) return;
  document.querySelector("#desk-loading").hidden = true;
  document.querySelector("#desk-start-error").hidden = false;
});
