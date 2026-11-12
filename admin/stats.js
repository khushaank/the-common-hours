import { allRows, escape, journalToday, missingFeature } from "./common.js";

const number = new Intl.NumberFormat();
const date = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const formatDay = day => date.format(new Date(day + "T00:00:00Z"));

export function setupStats(api, getPosts) {
  const period = document.querySelector("#stats-period");
  const status = document.querySelector("#stats-status");
  const report = document.querySelector("#stats-report");
  let revision = 0;

  function render(days, rows) {
    const daily = new Map(days.map(day => [day, { day, views: 0, visits: 0 }]));
    const posts = new Map(getPosts().map(post => [post.id, { title: post.title, views: 0 }]));
    const totals = { views: 0, visits: 0, postViews: 0 };
    for (const row of rows) {
      const current = daily.get(row.day);
      if (!current) continue;
      const views = Number(row.views);
      const visits = Number(row.visits);
      current.views += views;
      current.visits += visits;
      totals.views += views;
      totals.visits += visits;
      if (row.page.startsWith("post/")) {
        totals.postViews += views;
        const post = posts.get(row.page.slice(5));
        if (post) post.views += views;
      }
    }
    const records = [...daily.values()];
    const maxViews = Math.max(1, ...records.map(row => row.views));
    const leaders = [...posts.values()].filter(post => post.views > 0).sort((a, b) => b.views - a.views).slice(0, 10);
    const scale = leaders[0]?.views || 1;
    const metric = (label, value) => '<div class="card stats-metric"><span>' + label + '</span><strong>' + number.format(value) + '</strong></div>';
    report.innerHTML = '<div class="stats-metrics">' +
      metric("Site visits", totals.visits) + metric("Page views", totals.views) + metric("Entry views", totals.postViews) + '</div>' +
      '<section class="card stats-chart"><h2>Daily traffic</h2>' +
      '<div class="stats-legend"><span>Page views</span><span>Visits</span></div>' +
      '<div class="traffic-bars" aria-hidden="true"></div>' +
      '<div class="traffic-axis"><span>' + formatDay(days[0]) + '</span><span>' + formatDay(days.at(-1)) + '</span></div>' +
      '<details class="traffic-table"><summary>Daily counts</summary><table><thead><tr><th scope="col">Date</th><th scope="col">Page views</th><th scope="col">Visits</th></tr></thead><tbody>' +
      records.map(row => '<tr><th scope="row">' + formatDay(row.day) + '</th><td>' + number.format(row.views) +
        '</td><td>' + number.format(row.visits) + '</td></tr>').join("") +
      '</tbody></table></details></section>' +
      '<section class="card stats-chart"><h2>Most-read entries</h2>' +
      (leaders.length ? '<ol class="traffic-leaders">' + leaders.map(post => '<li><span>' + escape(post.title) +
        '</span><span>' + number.format(post.views) + '</span><meter aria-label="' + escape(post.title) +
        ' views" max="' + scale + '" value="' + post.views + '"></meter></li>').join("") + '</ol>' :
        '<p>No entry views in this period yet.</p>') + '</section>';
    const chart = report.querySelector(".traffic-bars");
    for (const row of records) {
      const group = document.createElement("div");
      group.title = formatDay(row.day) + " · " + number.format(row.views) + " views · " + number.format(row.visits) + " visits";
      for (const key of ["views", "visits"]) {
        const bar = document.createElement("span");
        bar.style.height = (row[key] / maxViews * 100) + "%";
        group.append(bar);
      }
      chart.append(group);
    }
    status.textContent = totals.views ? "" : "No traffic recorded in this period yet.";
  }

  async function load() {
    const loading = ++revision;
    const count = Number(period.value);
    const today = Date.parse(journalToday() + "T00:00:00Z");
    const days = Array.from({ length: count }, (_, index) =>
      new Date(today - (count - index - 1) * 86400000).toISOString().slice(0, 10));
    status.textContent = "Loading traffic…";
    report.replaceChildren();
    try {
      const rows = await allRows(api, "traffic?select=day,page,views,visits&day=gte." + days[0] + "&order=day,page");
      if (revision === loading) render(days, rows);
    } catch (error) {
      if (revision !== loading) return;
      status.textContent = missingFeature(error) ? "Apply the Supabase traffic upgrade to enable stats." :
        "Traffic could not load. Reopen Stats or choose another period to retry.";
    }
  }

  period.addEventListener("change", load);
  return {
    load,
    clear() {
      revision++;
      report.replaceChildren();
      status.textContent = "";
    },
  };
}
