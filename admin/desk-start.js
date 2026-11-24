import("./desk.js").catch(() => {
  if (window.top !== window.self) return;
  document.querySelector("#desk-loading").hidden = true;
  document.querySelector("#desk-start-error").hidden = false;
});
