export function setupShortcuts(title, commands, enabled = () => true, fallbackFocus) {
  const dialog = document.createElement("dialog");
  dialog.id = "shortcut-dialog";
  dialog.className = "shortcut-dialog";
  dialog.setAttribute("closedby", "any");
  dialog.setAttribute("aria-labelledby", "shortcut-title");
  dialog.innerHTML = '<div class="shortcut-heading"><h2 id="shortcut-title"></h2><button type="button" autofocus>Close</button></div><dl></dl>';
  dialog.querySelector("h2").textContent = title;
  dialog.querySelector("button").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (document.activeElement === document.body && fallbackFocus?.getClientRects().length) fallbackFocus.focus();
  });

  const list = dialog.querySelector("dl");
  for (const [keys, description] of [["Ctrl + / or Ctrl + ?", "Open or close this list"], ...commands]) {
    const row = document.createElement("div");
    const name = document.createElement("dt");
    const binding = document.createElement("dd");
    const kbd = document.createElement("kbd");
    name.textContent = description;
    kbd.textContent = keys;
    binding.append(kbd);
    row.append(name, binding);
    list.append(row);
  }
  document.body.append(dialog);

  if (!("closedBy" in dialog)) {
    let pressedOutside;
    const outsideDialog = event => {
      const target = event.target;
      if (!target.matches?.('dialog[open][closedby="any"]')) return null;
      const bounds = target.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom ? target : null;
    };
    document.addEventListener("pointerdown", event => { pressedOutside = outsideDialog(event); });
    document.addEventListener("pointerup", event => {
      const target = outsideDialog(event);
      if (!target || target !== pressedOutside) return;
      if (target.requestClose) target.requestClose();
      else if (target.dispatchEvent(new Event("cancel", { cancelable: true }))) target.close();
    });
  }

  function toggle() {
    if (dialog.open) dialog.close();
    else if (!document.querySelector("dialog[open]")) dialog.showModal();
  }
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.isComposing || event.repeat || !enabled()) return;
    const openDialog = document.querySelector("dialog[open]");
    const slash = event.code === "Slash" || event.key === "/" || event.key === "?";
    if ((event.ctrlKey || event.metaKey) && !event.altKey && slash && (!openDialog || openDialog === dialog)) {
      event.preventDefault();
      toggle();
      return;
    }
    if (openDialog || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const command = commands.find(([keys, , action]) => action && keys.toLowerCase() === "alt + " + event.key.toLowerCase());
    const [, , action, available] = command || [];
    if (!action || (available ? !available() : event.target.closest?.("input, textarea, select, [contenteditable]"))) return;
    event.preventDefault();
    action();
  });
}
