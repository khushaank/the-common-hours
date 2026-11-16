# The Common Hours

An independent journal by Ellis Vale.

[Read the journal](https://commonhours.qd.je/)

To enable file attachments and weekly photos on an existing site, run
`supabase/upgrade-writing-desk.sql` in the journal project's Supabase SQL Editor
before running the **Publish journal** workflow. For a new database, run
`supabase/install.sql` and `supabase/add-editorial-features.sql` first.

Run `supabase/add-image-library-and-traffic.sql` next to store alt text for new
uploads and enable the private traffic dashboard. Traffic counts begin when
the updated journal goes live.

Run `supabase/upgrade-editor-and-reading.sql` after the traffic upgrade to enable
cloud working drafts, media editing, body search, series, and private review links.
Review links expire after 24 hours. The RSS feed is rebuilt by **Publish journal**
on demand and every six hours while the GitHub Actions schedule is active.

Run `supabase/keep-entry-links.sql` to preserve links to published entries when
their slugs change. It starts with the slugs currently stored in the database.

Run `supabase/live-review-links.sql` before publishing the editor update that
keeps review links in sync. To keep using a link created before this update,
open its entry in the writing desk and use **Reconnect a previously shared link**.
Private access still expires after 24 hours. Once published, a review link
opens the public entry, including after a slug change.

**Publish journal** also generates HTML for the journal, archive, photos, public
entries, and policies, plus `sitemap.xml`. These pages can be read without
JavaScript. Legacy query links redirect in the browser; new links use separate
HTML pages so search engines and link previews receive the right content.
GitHub Pages cannot redirect query strings on the server: HTML-only visitors
must use the `.html` links. The archive has 15 entries per page and separate
pages for years, months, and topics, all browsable without JavaScript.
Search, photo filters, comments, and the contact form use JavaScript.
The HTML copy refreshes with each workflow run, including the six-hour schedule;
the app continues to load current public data. Unpublishing an entry or photo
also requires a successful **Publish journal** run to remove its HTML/image copy.
Published attachments are copied as binary downloads with their original link
labels as filenames. Only files readable with the public key and referenced by
published entries are included; private draft attachments stay in Supabase.
Removing a published attachment also requires a successful publishing run.
Offline documents are cached by exact URL; an unavailable page never falls back
to the homepage. Live document requests revalidate the browser’s HTTP cache.

Run `node --test` for the rendering checks, `node build.mjs` to build, and
`node preview.mjs blog 8000 --built` to inspect the generated site locally.

Run [`supabase/add-journal-features.sql`](supabase/add-journal-features.sql) to enable
reader prompts, photo pairings, themed collections, and photo essays. Set them under
**Entries → Reader prompt, photo essay, and collection** in the Writing Desk.
Use the same collection name on each entry and add the introduction to one entry.
To publish a photo essay, add at least two different images to the entry body in the
order you want them to appear. Use `/image` to upload with a caption or `/library`
to reuse an image.

For public archive photos, go to **Writing Desk → Photos → Archive uploads**.
Choose one or more image files and select **Add to archive**. Select an uploaded
photo to edit its title, alt text, description, or photo series. New uploads
require a descriptive title and alt text for each photo before publication.
Existing filename-like public titles and alt text use neutral placeholders until
the editor supplies descriptions; stored originals are preserved in the desk.

Original journal material and project code are reserved by their respective rights holders. Third-party files retain their accompanying licenses.
