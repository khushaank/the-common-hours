export const photoArchiveShell = `<section class="photo-archive">
  <header class="photo-archive-head"><p class="photo-kicker">The Common Hours · Photography</p><h1>Photo archive</h1><p>Browse the journal’s photo collection by date or series. <a href="photo-essays.html">Explore photo essays →</a></p></header>
  <div class="photo-filter-bar">
    <div class="photo-filters" role="group" aria-label="Filter photos">
      <label>Year <select id="photo-year" disabled><option>All years</option></select></label>
      <label>Month <select id="photo-month" disabled><option>All months</option></select></label>
      <label>Series <select id="photo-series" disabled><option>All series</option></select></label>
    </div>
    <div class="photo-filter-meta"><span id="photo-count" aria-live="polite">Loading photos…</span><button id="photo-clear" class="quiet-button" type="button" disabled>Reset</button></div>
  </div>
  <div id="photo-results"></div>
</section>`;
