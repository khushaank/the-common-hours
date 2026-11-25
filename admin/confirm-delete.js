let pending = false;

export function confirmDelete(title, message) {
  const dialog = document.querySelector("#delete-dialog");
  if (pending || dialog.open) return Promise.resolve(false);
  dialog.querySelector("#delete-title").textContent = title;
  dialog.querySelector("#delete-message").textContent = message;
  dialog.returnValue = "";
  return new Promise(resolve => {
    pending = true;
    dialog.addEventListener("close", () => {
      pending = false;
      resolve(dialog.returnValue === "delete");
    }, { once: true });
    dialog.showModal();
  });
}
