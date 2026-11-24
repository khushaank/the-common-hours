import { allRows, escape, journalToday, missingFeature } from "./common.js";

const number = new Intl.NumberFormat();
const date = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });
const formatDay = day => date.format(new Date(day + "T00:00:00Z"));
const dayMs = 86400000;

export function periodDays(period, today) {
  const end = Date.parse(today + "T00:00:00Z");
  const first = new Date(end);
  if (period === "five-years") {
    const originalMonth = first.getUTCMonth();
    first.setUTCFullYear(first.getUTCFullYear() - 5);
    if (first.getUTCMonth() !== originalMonth) first.setUTCDate(0);
  } else {
    first.setUTCDate(first.getUTCDate() - Number(period) + 1);
  }
  return Array.from({ length: (end - first.getTime()) / dayMs + 1 }, (_, index) =>
    new Date(first.getTime() + index * dayMs).toISOString().slice(0, 10));
}

export function publishingSummary(posts, today = journalToday()) {
  const last = posts.filter(post => post.published && post.published_on <= today)
    .reduce((latest, post) => !latest || post.published_on > latest.published_on ? post : latest, null);
  return { last, days: last ? Math.floor((Date.parse(today) - Date.parse(last.published_on)) / 86400000) : null };
}

export function setupStats(api, getPosts, editEntry) {
  const period = document.querySelector("#stats-period");
  const status = document.querySelector("#stats-status");
  const report = document.querySelector("#stats-report");
  const lastEntry = document.querySelector("#last-published-entry");
  let latest;
  let revision = 0;
  lastEntry.addEventListener("click", () => { if (latest) editEntry(latest, lastEntry); });

  function renderPublishing() {
    const { last, days } = publishingSummary(getPosts());
    latest = last;
    lastEntry.textContent = last?.title || "No published entries yet";
    lastEntry.disabled = !last;
    document.querySelector("#last-published-date").textContent = last ?
      "Published " + new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(new Date(last.published_on + "T00:00:00Z")) : "Your next entry starts here.";
    document.querySelector("#publishing-age").textContent = days === null ? "-" : number.format(days);
    document.querySelector("#publishing-note").textContent = days === null ? "No publications yet" : days === 0 ? "Published today" : "Based on the publication date";
  }

  function render(days, rows, selectedPeriod) {
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
    const peak = records.reduce((best, row) => row.views > (best?.views || 0) ? row : best, null);
    document.querySelector("#active-day").textContent = peak ? formatDay(peak.day) : "-";
    document.querySelector("#active-day-note").textContent = peak ? number.format(peak.views) + " page views" : "No daily activity recorded yet";
    const chartPeriod = selectedPeriod === "five-years" ? "Monthly" : selectedPeriod === "365" ? "Weekly" : "Daily";
    const buckets = new Map();
    for (const [index, record] of records.entries()) {
      const label = chartPeriod === "Monthly" ? month.format(new Date(record.day + "T00:00:00Z")) :
        chartPeriod === "Weekly" ? formatDay(records[index - index % 7].day) : formatDay(record.day);
      const bucket = buckets.get(label) || { views: 0, visits: 0 };
      bucket.views += record.views;
      bucket.visits += record.visits;
      buckets.set(label, bucket);
    }
    const maxViews = Math.max(1, ...[...buckets.values()].map(row => row.views));
    const leaders = [...posts.values()].filter(post => post.views > 0).sort((a, b) => b.views - a.views).slice(0, 10);
    const scale = leaders[0]?.views || 1;
    const metric = (label, value) => '<div class="card stats-metric"><span>' + label + '</span><strong>' + number.format(value) + '</strong></div>';
    report.innerHTML = '<div class="stats-metrics">' +
      metric("Site visits", totals.visits) + metric("Page views", totals.views) + metric("Entry views", totals.postViews) + '</div>' +
      '<section class="card stats-chart"><h2>' + chartPeriod + ' traffic</h2>' +
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
    for (const [label, row] of buckets) {
      const group = document.createElement("div");
      group.title = label + " · " + number.format(row.views) + " views · " + number.format(row.visits) + " visits";
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
    const selectedPeriod = period.value;
    const days = periodDays(selectedPeriod, journalToday());
    renderPublishing();
    document.querySelector("#active-day").textContent = "-";
    document.querySelector("#active-day-note").textContent = "Loading activity…";
    status.textContent = "Loading traffic…";
    report.replaceChildren();
    try {
      const rows = await allRows(api, "traffic?select=day,page,views,visits&day=gte." + days[0] + "&day=lte." + days.at(-1) + "&order=day,page");
      if (revision === loading) render(days, rows, selectedPeriod);
    } catch (error) {
      if (revision !== loading) return;
      status.textContent = missingFeature(error) ? "Apply the Supabase traffic upgrade to enable stats." :
        "Traffic could not load. Reopen Dashboard or choose another period to retry.";
      document.querySelector("#active-day-note").textContent = "Daily activity could not load";
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
