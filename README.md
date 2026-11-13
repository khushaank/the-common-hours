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

Original journal material and project code are reserved by their respective rights holders. Third-party files retain their accompanying licenses.
