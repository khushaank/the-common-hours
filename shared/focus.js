export function trackFocusInput() {
  const root = document.documentElement;
  document.addEventListener("pointerdown", () => root.setAttribute("data-pointer-input", ""), true);
  document.addEventListener("keydown", () => root.removeAttribute("data-pointer-input"), true);
}
