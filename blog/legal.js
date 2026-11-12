import { missingFeature, request, table } from "./common.js";

const notice = `<h1>Privacy</h1><div class="prose">
  <p>The Common Hours is an independent journal operated from India.</p>
  <h2>What the journal collects</h2>
  <p>You can read without an account. If you leave a comment, the journal stores your display name, comment, the entry it belongs to, and when it was submitted. The editor reviews it before publication. An approved comment and its display name are public. Choose a display name you are comfortable sharing.</p>
  <p>If you send a privacy request, the journal stores your reply email, your message, and when you sent it. The editor uses this information to handle your request. Please avoid including documents or other sensitive information.</p>
  <h2>Services and embeds</h2>
  <p>GitHub Pages hosts the website and logs visitor IP addresses for security. Supabase hosts the journal database and downloadable files and processes requests to them. When an embedded video loads, your browser connects to its provider, such as YouTube or Vimeo. The provider handles that connection under its own privacy policy.</p>
  <p>The journal keeps daily totals for page views and visits. Your browser stores a timestamp in the current tab to estimate a new visit after 30 minutes without opening another page. The journal’s traffic counters store no IP addresses, visitor identifiers, or browsing history. Traffic counting respects Do Not Track and Global Privacy Control.</p>
  <ul>
    <li><a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub privacy statement</a></li>
    <li><a href="https://supabase.com/privacy">Supabase privacy policy</a></li>
    <li><a href="https://policies.google.com/privacy">Google and YouTube privacy policy</a></li>
    <li><a href="https://vimeo.com/privacy">Vimeo privacy policy</a></li>
  </ul>
  <h2>Retention and requests</h2>
  <p>Comments remain in the journal database until removed by the editor. You can ask to access, correct, or remove information you submitted, withdraw permission to display your comment, or raise a privacy concern using the form below. Include the entry title and display name for a comment request. The editor may need to verify which submission is yours.</p>
</div>`;

const terms = `<h1>Terms</h1><div class="prose">
  <h2>Reading and sharing</h2>
  <p>The Common Hours publishes personal essays and photographs. You may link to entries. Copyright stays with the respective rights holders. Contact the editor before republishing an essay or photograph beyond what applicable law permits.</p>
  <h2>Comments</h2>
  <p>By submitting a comment, you give the journal permission to display it under your chosen display name if approved. Submit material you have the right to share. Keep comments relevant and avoid personal information, harassment, unlawful material, and spam. The editor may decline, hide, or remove comments. See <a href="?view=privacy">Privacy</a> for removal requests.</p>
  <h2>External content</h2>
  <p>Links and embedded videos are provided for context. Their publishers control that material and may change or remove it. The journal’s essays express personal views.</p>
  <h2>Contact</h2>
  <p>Use the <a href="?view=privacy#contact">contact form</a> for rights, correction, or takedown requests.</p>
</div>`;

export function renderLegal(content, view, demo) {
  content.innerHTML = `<article class="legal">${view === "privacy" ? notice : terms}</article>`;
  if (view !== "privacy") return;
  const contact = document.createElement("section");
  contact.id = "contact";
  contact.innerHTML = `<h2>Contact the editor</h2>
    <form method="post"><label>Reply email <input type="email" name="email" required maxlength="254" autocomplete="email"></label>
      <label>Message <textarea name="message" required maxlength="2000" rows="5"></textarea></label>
      <p class="status">Your message and reply email go to the editor privately.</p>
      <button type="submit">Send request</button><p role="status" class="status"></p>
    </form>`;
  content.firstElementChild.append(contact);
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
      status.textContent = missingFeature(error) ? "The contact form is temporarily unavailable." : "Your request could not be sent. Please try again.";
    } finally {
      button.disabled = false;
    }
  });
  if (location.hash === "#contact") contact.scrollIntoView();
}
