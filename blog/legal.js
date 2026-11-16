import { missingFeature, request, table } from "./common.js";

import { notice, terms } from "./legal-content.js";

export function renderLegal(content, view, demo) {
  content.innerHTML = `<article class="legal">${view === "privacy" ? notice : terms}</article>`;
  if (view !== "privacy") return;
  const contact = content.querySelector("#contact");
  contact.insertAdjacentHTML("beforeend", `<form method="post"><label>Reply email <input type="email" name="email" required maxlength="254" autocomplete="email"></label>
      <label>Message <textarea name="message" required maxlength="2000" rows="5"></textarea></label>
      <p class="status">Your message and reply email go to the editor privately.</p>
      <button type="submit">Send request</button><p role="status" class="status"></p>
    </form>`);
  const form = contact.querySelector("form");
  const status = form.querySelector("[role=status]");
  const button = form.querySelector("button");
  if (demo || !window.isSecureContext) {
    button.disabled = true;
    status.textContent = demo ? "Requests are unavailable in local preview." : "Use the HTTPS address to send a privacy request.";
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (demo || !window.isSecureContext) return;
    const data = new FormData(form);
    const email = data.get("email").trim();
    const message = data.get("message").trim();
    if (!message) { status.textContent = "Enter a message."; return; }
    button.disabled = true;
    status.textContent = "Sending…";
    try {
      await request(table("privacy_requests"), { method: "POST", body: { email, message }, prefer: "return=minimal" });
      form.reset();
      status.textContent = "Your request was sent to the editor.";
    } catch (error) {
      status.textContent = error.status === 429 ? error.message : missingFeature(error) ? "The contact form is temporarily unavailable." : "Your request could not be sent. Please try again.";
    } finally {
      button.disabled = false;
    }
  });
  if (location.hash === "#contact") contact.scrollIntoView();
}
