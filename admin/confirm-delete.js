export function confirmDelete(title, message) {
  const dialog = document.querySelector("#delete-dialog");
  if (dialog.open) return Promise.resolve(false);
  dialog.querySelector("#delete-title").textContent = title;
  dialog.querySelector("#delete-message").textContent = message;
  dialog.returnValue = "";
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "delete"), { once: true });
    dialog.showModal();
  });
}
