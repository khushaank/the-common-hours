const home = "https://commonhours.qd.je/";
const xml = value => String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);

export async function renderFeed(config) {
  let entries = [];
  if (config.origin) {
    const endpoint = config.origin +
      "/rest/v1/qmargin_b74_posts?select=slug,title,tag,excerpt,published_on&published=eq.true&order=published_on.desc,id.desc&limit=30";
    const response = await fetch(endpoint, { headers: { apikey: config.key }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("Could not refresh RSS from the journal database (" + response.status + ").");
    entries = await response.json();
  }
  const items = entries.map(entry => {
    const link = home + "?post=" + encodeURIComponent(entry.slug);
    return "    <item><title>" + xml(entry.title) + "</title><link>" + xml(link) + "</link><guid>" + xml(link) +
      "</guid><pubDate>" + new Date(entry.published_on + "T00:00:00+05:30").toUTCString() + "</pubDate><category>" +
      xml(entry.tag) + "</category><description>" + xml(entry.excerpt) + "</description></item>";
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel><title>The Common Hours</title><link>' + home + '</link>',
    '    <description>An independent journal by Ellis Vale.</description><language>en</language>',
    '    <atom:link href="' + home + 'feed.xml" rel="self" type="application/rss+xml"/>',
    ...items, '  </channel>', '</rss>', ""].join("\n");
}
