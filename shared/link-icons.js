const driveMark = "M126 42c29 23 44 56 69 83l40 47c3 4 2 6-3 6l-70 2c-35 3-73 1-118 5-2 0-2-2 0-5 17-24 29-53 46-82 8-15 20-29 34-45m-12 88c4-10 16-24 23-35 3 11 12 16 23 26 9 8 17 18 8 17-25-5-39-6-54-5m44-24c18 1 37-2 56-7l10 2m-33-18c-2 20-2 37 1 57";
const icons = {
  linkedin: "M8 11v5 M8 8v.01 M12 16v-5 M16 16v-3a2 2 0 1 0 -4 0 M3 7a4 4 0 0 1 4 -4h10a4 4 0 0 1 4 4v10a4 4 0 0 1 -4 4h-10a4 4 0 0 1 -4 -4l0 -10",
  instagram: "M4 8a4 4 0 0 1 4 -4h8a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-8a4 4 0 0 1 -4 -4l0 -8 M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0 M16.5 7.5v.01",
  x: "M4 4l11.733 16h4.267l-11.733 -16l-4.267 0 M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772",
  youtube: "M2 8a4 4 0 0 1 4 -4h12a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-12a4 4 0 0 1 -4 -4v-8 M10 9l5 3l-5 3l0 -6",
  github: "M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5",
  dropbox: "M7.5 10.625l-4.5 -2.813l4.5 -2.812l4.5 2.813m-4.5 2.812l4.5 -2.813m-4.5 2.813l-4.5 2.823l4.5 2.802m0 -5.625l4.5 2.823m0 -5.636l4.5 2.791l4.5 -2.812l-4.5 -2.791l-4.5 2.813m-4.5 8.438l4.5 -2.802m-4.5 2.802v1.123l4.5 2.627l4.5 -2.627v-1.123m-4.5 -2.802l4.5 -2.823l4.5 2.823l-4.5 2.802m-4.5 -2.802l4.5 2.802",
  reddit: "M12 8c2.648 0 5.028 .826 6.675 2.14a2.5 2.5 0 0 1 2.326 4.36c0 3.59 -4.03 6.5 -9 6.5c-4.875 0 -8.845 -2.8 -9 -6.294l-1 -.206a2.5 2.5 0 0 1 2.326 -4.36c1.646 -1.313 4.026 -2.14 6.674 -2.14l.999 0 M12 8l1 -5l6 1 M18 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M8.5 13a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0 M14.5 13a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0 M10 17c.667 .333 1.333 .5 2 .5s1.333 -.167 2 -.5",
};
const hosts = new Map([
  ["drive.google.com", "drive"], ["docs.google.com", "drive"],
  ["linkedin.com", "linkedin"], ["instagram.com", "instagram"],
  ["x.com", "x"], ["twitter.com", "x"],
  ["youtube.com", "youtube"], ["youtu.be", "youtube"],
  ["github.com", "github"], ["dropbox.com", "dropbox"], ["reddit.com", "reddit"],
]);

export function linkIcon(href) {
  if (!/^https:\/\/\S+$/i.test(href)) return "";
  let url;
  try { url = new URL(href); } catch { return ""; }
  if (url.username || url.password) return "";
  const brand = hosts.get(url.hostname.replace(/^(?:www|m)\./, ""));
  if (!brand) return "";
  const drive = brand === "drive";
  return '<svg class="service-link-icon" viewBox="' + (drive ? '34 33 211 162' : '0 0 24 24') +
    '" width="16" height="16" fill="none" stroke="currentColor" stroke-width="' + (drive ? '11' : '2') +
    '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' +
    (drive ? driveMark : icons[brand]) + '"/></svg>';
}
