# Deploy The Common Hours

## Redeploy the existing Netlify site

1. Commit and push your changes to `main`. If the release includes a database upgrade, apply the matching SQL in the Supabase SQL Editor before deploying.
2. Netlify automatically builds and deploys pushes to `main`.
3. In Netlify, wait for the production deploy to publish. Open the journal, check `/notes`, and sign in to the Writing Desk.

After a Supabase-only change, use **Deploys → Trigger deploy** in Netlify to refresh the generated public pages or RSS.

## First-time setup with GitHub Pages

You need access to the GitHub repository settings, the Supabase project URL and publishable key, and a Writing Desk admin account for the final check.

1. If the Supabase project is new, follow the database setup in [README.md](README.md) and the journal hardening and review function steps in [SECURITY.md](SECURITY.md). To add a desk admin, use the Auth user UUID with the example at the end of [install.sql](supabase/install.sql).
2. In GitHub, go to **Settings → Pages** and set the source to **GitHub Actions**. [GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
3. In **Settings → Secrets and variables → Actions**, add two repository secrets. [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
   - `SUPABASE_URL` — the production Supabase project URL
   - `SUPABASE_PUBLISHABLE_KEY` — the production Supabase publishable key from **Connect**
4. Open **Actions → Publish journal → Run workflow** on GitHub and select `main`. The workflow installs Node.js 24, runs the tests, and publishes to GitHub Pages. The scheduled workflow runs every six hours when enabled.

## First-time setup with Netlify

1. Import this GitHub repo and choose `main`. Add the same two values as build environment variables. [Netlify repository setup](https://docs.netlify.com/start/quickstarts/deploy-from-repository/)
2. Deploy using [netlify.toml](netlify.toml). It sets Node.js 24, the build command `node build.mjs --clean-dist`, and the publish directory `dist`.
3. Verify the journal and Writing Desk on the Netlify URL. Future pushes to `main` trigger a deploy. For Supabase-only changes, use **Deploys → Trigger deploy**.
