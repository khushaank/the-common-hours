# The Common Hours

An independent journal by Ellis Vale.

For the security fixes and the Supabase SQL/deployment steps, see
[`SECURITY.md`](SECURITY.md). These changes require database and Edge Function
deployment before publishing the updated editor and reader.

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

Apply [`supabase/upgrade-desk-workflow.sql`](supabase/upgrade-desk-workflow.sql)
after the journal and security upgrades. It enables References, longer tag lists,
automatic series numbers, and deletion in Entries and Media. Apply
[`supabase/upgrade-private-drafts.sql`](supabase/upgrade-private-drafts.sql)
next to preserve comments when entries are removed and enable private preview links.

**Publish journal** also generates HTML for the journal, archive, series, photo
details, public entries with approved comments, and policies, plus `sitemap.xml`.
These pages can be read without
JavaScript. Legacy query links redirect in the browser; new links use separate
HTML pages so search engines and link previews receive the right content.
GitHub Pages cannot redirect query strings on the server: HTML-only visitors
must use the `.html` links. The archive has 15 entries per page and separate
pages for years, months, and topics, all browsable without JavaScript.
The Featured Photo slideshow, full-text search, comment submission, and the
contact form use JavaScript. The privacy page includes an email link.
The HTML copy refreshes with each workflow run, including the six-hour schedule;
the app continues to load current public data. Unpublishing an entry, comment, or photo
also requires a successful **Publish journal** run to remove its HTML/image copy.
Published attachments are copied as binary downloads with their original link
labels as filenames. Only files readable with the public key and referenced by
published entries are included; private draft attachments stay in Supabase.
Removing a published attachment also requires a successful publishing run.
Offline documents are cached by exact URL; an unavailable page never falls back
to the homepage. Live document requests revalidate the browser’s HTTP cache.

Run `node --test` for the rendering checks, `node build.mjs` to build, and
`node preview.mjs blog 8000 --built` to inspect the generated site locally.
Local previews use no backend by default. To test sign-in and writes, set
`PREVIEW_SUPABASE_URL` and `PREVIEW_SUPABASE_PUBLISHABLE_KEY` for your separate
test project. `--live` explicitly connects the preview to the production setup.

The Writing Desk opens on **Dashboard** by default. Section links such as
`#media` reopen that section when refreshed. **All entries** includes your saved
drafts. **Save draft** on a published entry creates a private copy with a
`/draft` suffix in the desk. Select **Generate preview link** to give someone
with the link access to that saved copy for up to 24 hours. Use **↑** and **↓**
to move through Entries and **Enter** to open the highlighted item. Refresh
restores the selected row or the open editor. The editor opens in editable
**Preview** mode. Use the toggle beside the title to switch to **Markdown** and
the gear to open **Publish settings**.
Leave the excerpt blank to generate it from the body when publishing. **Comments** shows
all comments, with Published and Pending filters; privacy requests stay in Inbox.

Dashboard uses the existing daily traffic totals and each entry’s publication
date. No new database migration is required for this layout.

**New note** opens a short, title-free composer. Notes support up to 500
characters, can be saved as drafts, and appear alongside entries in the journal.
Apply [`supabase/upgrade-notes-and-photos.sql`](supabase/upgrade-notes-and-photos.sql)
after the existing security and desk upgrades before deploying this version.
The upgrade enables publishing notes and retires the old editorial photo fields.
The **Reader prompt** field is still available in **Publish settings**.

Apply [the note media and search upgrade](supabase/upgrade-note-media-and-search.sql)
before publishing this version. Notes can include up to four photos.
Type **@image** and press **Enter** to open the Media Library.
Type **/** in a note to find and attach a published article link.

Apply [`supabase/upgrade-featured-photo.sql`](supabase/upgrade-featured-photo.sql)
after the Notes and live review upgrades. It carries the current homepage photos
over to the Featured Photo selection. In **Writing Desk → Photos**, upload or
choose images from **Media** to feature them. They stay on the homepage until
you unfeature them. Unfeatured photos stay in **Media**.

The confirmed sample cleanup and its optional undo are saved as
[`supabase/remove-confirmed-samples.sql`](supabase/remove-confirmed-samples.sql)
and [`supabase/restore-confirmed-samples.sql`](supabase/restore-confirmed-samples.sql).
The cleanup keeps a private database backup with no visitor or signed-in client
grants. It was applied on 16 November 2026: 68 sample entries, 32 sample photos,
and 57 attached comments were removed. Elephant, Love - the test, This shall pass,
and the five actual photo uploads remain. The read-only confirmation is saved in
[`supabase/verify-confirmed-samples.sql`](supabase/verify-confirmed-samples.sql).
Rerunning the content cleanup with its backup in place leaves content alone.
If the SQL Editor reported that `sample_cleanup_20261116` already exists, verify
the earlier cleanup and run only [`supabase/reset-sample-traffic.sql`](supabase/reset-sample-traffic.sql)
to back up and clear the remaining counters once. The counters have no sample
flag, so this clears all views and visits recorded before the first reset.
[`supabase/remove-sample-inbox.sql`](supabase/remove-sample-inbox.sql) backs up and
deletes requests submitted from the reserved `example.com` test domain.
Browser-only development previews contain no sample articles.

Original journal material and project code are reserved by their respective rights holders. Third-party files retain their accompanying licenses.
