import { escape, request } from "./common.js";

const voterKey = "common-hours:poll-voter";
let voter;

function savedVoter() {
  try { return localStorage.getItem(voterKey); } catch { return null; }
}

export function mountReaderPoll(article, post) {
  article.querySelector(":scope > .reader-poll")?.remove();
  const poll = post?.poll;
  if (!poll?.question || !Array.isArray(poll.options)) return;
  const section = document.createElement("section");
  section.className = "reader-poll";
  section.setAttribute("aria-label", "Reader poll");
  const prompt = post.is_note || !post.reader_prompt ? "" :
    '<p class="reader-prompt">' + escape(post.reader_prompt) + "</p>";
  section.innerHTML = prompt + '<form method="post"><fieldset><legend>' + escape(poll.question) + '</legend>' +
    poll.options.map((option, index) => '<label><input type="radio" name="choice" value="' + (index + 1) +
      '" required><span>' + escape(option) + '</span></label>').join("") +
    '</fieldset><button type="submit">Vote</button></form><p class="status" role="status"></p>';
  article.append(section);

  const form = section.querySelector("form");
  const status = section.querySelector("[role=status]");
  const submit = form.querySelector("button");
  const voteKey = voterKey + ":" + post.id;
  const read = (id, choice) => request("/rest/v1/rpc/qmargin_b74_reader_poll", {
    method: "POST", body: { p_post: post.id, p_poll: poll, p_voter: id, p_choice: choice },
  });

  function showTally(result) {
    if (!result?.counts || !form.isConnected) return;
    const total = result.counts.reduce((sum, count) => sum + count, 0);
    const results = document.createElement("div");
    results.className = "poll-results";
    results.innerHTML = '<h2>' + escape(poll.question) + '</h2><ul>' +
      poll.options.map((option, index) => '<li><span>' + escape(option) +
        (result.choice === index + 1 ? ' <small>· Your vote</small>' : '') + '</span><strong>' +
        Number(result.counts[index]) + '</strong></li>').join("") + '</ul>';
    const restoreFocus = form.contains(document.activeElement);
    form.replaceWith(results);
    status.textContent = total + (total === 1 ? " vote" : " votes");
    if (restoreFocus) {
      status.tabIndex = -1;
      status.focus();
    }
  }

  const previous = voter || savedVoter();
  try {
    if (previous && localStorage.getItem(voteKey)) {
      void read(previous, null).then(result => {
        if (result) showTally(result);
        else localStorage.removeItem(voteKey);
      }).catch(() => {});
    }
  } catch { /* The current page can still accept a vote. */ }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const selection = new FormData(form).get("choice");
    if (!selection) return;
    submit.disabled = true;
    status.textContent = "Saving your vote…";
    try {
      voter ||= savedVoter() || crypto.randomUUID();
      try { localStorage.setItem(voterKey, voter); } catch { /* Keep this vote for the current page. */ }
      const result = await read(voter, Number(selection));
      if (result) {
        try { localStorage.setItem(voteKey, "1"); } catch { /* Keep this vote for the current page. */ }
        showTally(result);
      }
      else status.textContent = "This poll changed. Reload the page to vote.";
    } catch { status.textContent = "Your vote could not be saved. Try again."; }
    finally { submit.disabled = false; }
  });
}
