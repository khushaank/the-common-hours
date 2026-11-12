# The Common Hours

An independent journal by **Ellis Vale**. The public blog and writing desk are separate static apps.

## Preview on your computer

With Node.js 24 or later installed, run these commands in separate terminals from this folder.

```powershell
node preview.mjs blog
node preview.mjs admin
```

Open [the journal](http://127.0.0.1:8000/) and [the writing desk](http://127.0.0.1:8001/). If either port is busy, append `0` to that app’s command and open the URL it prints. The journal has three pages of sample entries before you connect it. Comments on sample entries stay in your current browser. The connected journal displays your published posts.

## Connect your existing Supabase project

1. Run [supabase/install.sql](supabase/install.sql) once in the SQL Editor. It creates three uniquely prefixed tables in the existing `public` schema with row-level security. The project must already expose `public` through its Data API. If you ran the previous version of the installer, its tables and content also work with this version of the apps. The included [permission update](supabase/update-permissions.sql) applies the narrower grants and admin policy to those tables.
2. In **Authentication → Users**, choose or create an email/password user and copy its UUID. Run the commented `insert` at the end of the installer with that UUID. The allowlist controls who can use the desk even when the project has other signed-in users.
3. Copy [`.env.example`](.env.example) to `.env` in the repository root. Set `SUPABASE_URL` to the project URL and `SUPABASE_PUBLISHABLE_KEY` to the publishable key. Both apps read the same ignored file when they start. A legacy `anon` key also works. The generated browser configuration is public, so use only the two browser-safe values. Enter your email and password in the writing desk sign-in form.
4. Sign into the desk with the Auth user's email and password. Use **Publish** to make an entry visible or **Save as draft** to keep it private or take it offline. The publication date controls how an entry is displayed and ordered. Publishing takes effect immediately.

The blog asks readers for a display name and comment text. Comments start in moderation and become public after approval. See the [Supabase API key guide](https://supabase.com/docs/guides/getting-started/api-keys).

## Publish with GitHub Pages

1. Under **Settings → Pages**, choose **GitHub Actions** as the source.
2. Under **Settings → Secrets and variables → Actions**, create repository secrets named `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` with the same browser-safe values as your local `.env`.
3. Under **Actions → Publish journal**, select **Run workflow** on the default branch. The deployment job links to the live site when it succeeds. Run it again to deploy future code changes. Posts published in the writing desk appear through Supabase without a site redeploy.

The build publishes the journal and the [writing desk](https://khushaank.github.io/the-common-hours/folio-80f54af81f7d/) from `dist/`. The desk uses Supabase Auth and the admin allowlist. The path is visible in this repository. To publish with a different static host, run `node build.mjs` and upload only `dist/`.

The default Pages address includes your GitHub username. Set a custom domain in **Settings → Pages** before sharing the site if you want a standalone address. The GitHub repository is public and identifies its owner.
