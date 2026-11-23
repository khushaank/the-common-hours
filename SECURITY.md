# Applying the security fixes

## Writing Desk and preview

[`supabase/verify-desk-security.sql`](supabase/verify-desk-security.sql) passed
against the journal database. It checks journal RLS, visitor and non-admin access,
private drafts/inbox/analytics, attachment-helper permissions, and the private
cleanup backup when present. The renderer tests verify escaping, and the desk
refuses to initialize in a frame. A signed-in draft owner can generate a private
preview link. Public readers need the token to open the snapshot or its files.

After publishing the MFA-capable Writing Desk, apply
[`supabase/require-desk-mfa.sql`](supabase/require-desk-mfa.sql). Each desk
administrator needs a verified authenticator app factor before applying it.
Supabase denies privileged requests unless the session has completed MFA.
[`supabase/secure-published-media.sql`](supabase/secure-published-media.sql)
limits weekly photos to entries in the slideshow and photos paired with a
published entry. Rebuild the public site after applying it to remove stale static copies.

The live host did not return CSP, X-Frame-Options, X-Content-Type-Options,
Referrer-Policy, or HSTS response headers during inspection. The HTML retains
its CSP/referrer meta policies; response-header protection still needs hosting
configuration. The database advisor also reports
[leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
These checks do not establish that every possible attack is prevented.

The following sections document the earlier hardening/deployment procedures.

For a new installation, run the Supabase steps below. The journal and legacy SQL
are separate because the older tables serve
another application. Neither script deletes application records. Take a database
backup before applying either migration.

## 1. Harden the journal database

In the journal project's **SQL Editor**, run the entire
[`supabase/harden-journal.sql`](supabase/harden-journal.sql) as `postgres`.
It requires the existing upgrades through `add-journal-features.sql`.

The database now limits successful inserts across all clients to:

| Submission | Global budget |
| --- | --- |
| Comments | 30 per 15 minutes |
| Contact/privacy requests | 10 per hour |
| Traffic events | 300 per minute |

These atomic budgets also cover direct REST requests, multi-row inserts, and
traffic RPC calls. A rejected request returns HTTP 429. Each window starts with
its first accepted submission and resets after its duration. Moderation and
deleting submissions do not replenish the budget. No IP addresses are stored.
The three counter rows have no visitor read/write grants.

These are small-journal ceilings, not bot identification: an attacker can exhaust
a shared budget and temporarily prevent legitimate submissions. For a busier
journal, add CAPTCHA and per-client limits at a trusted gateway before increasing
the ceilings. Traffic totals are estimates and can still include fake events
within the budget.

## 2. Deploy the review download function

Run these commands in PowerShell from `A:\Software\CH`. Node.js 20 or later is
required. `npx.cmd` downloads/runs the Supabase CLI without requiring a global
`supabase` command; using `.cmd` also avoids PowerShell script execution-policy
errors. Replace `PROJECT_REF` with the project reference shown in your Supabase
dashboard; do not paste secrets into the repo.

```powershell
Set-Location 'A:\Software\CH'
npx.cmd --yes supabase@latest --version
npx.cmd --yes supabase@latest login
npx.cmd --yes supabase@latest functions deploy review-attachment --project-ref PROJECT_REF --no-verify-jwt --use-api
```

Complete the browser sign-in opened by `login`, then run the deploy command.
`--use-api` bundles the function on Supabase, so Docker is not required. If
PowerShell says `supabase` is not recognized, use the complete `npx.cmd` commands
above. If `npx.cmd` is also missing, install Node.js LTS and reopen PowerShell.
See the [CLI setup guide](https://supabase.com/docs/guides/local-development/cli/getting-started)
and [deploy command reference](https://supabase.com/docs/reference/cli/introduction).

The checked-in `supabase/config.toml` also disables the JWT gateway check for this
one function. This is intentional: reviewers use a secret 64-character review
token rather than a Supabase account. The function checks that token, its database
expiry, publication state, and the attachment's presence in the current draft on
every download. It checks again after opening Storage, streams the binary, and
returns `Cache-Control: private, no-store`. It never returns a signed storage URL.

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed
functions. Keep the service role key server-side. It must never be copied into
the public `.env` build variables, browser configuration, or GitHub repository.
If those legacy function environment variables are unavailable in your project,
configure them in Edge Function secrets before testing.

The SQL stops returning previously stored signed links without deleting review
records or changing their expiry. Already-disclosed signed URLs remain valid
until their original expiry (the old editor requested 86,460 seconds).
After publishing the editor, close/reload old writing-desk tabs and allow at least
24 hours and 60 seconds after the last old URL was minted for those URLs to expire.
Downloaded copies and downloads already authorized cannot be recalled.

## 3. Harden the older application tables

In the same SQL Editor, run the entire
[`supabase/harden-legacy.sql`](supabase/harden-legacy.sql) as `postgres`.
This script uses the exact policy names and columns you supplied on 2026-11-16;
an unexpected schema or policy mismatch aborts the transaction.

It closes the unrestricted blog/settings reads and blog/profile inserts, while
preserving approved-member access, authors' drafts, and approved-admin controls.
Profile creation requires a pending, non-admin member with no approval fields.
Ordinary users cannot change profile identity, membership, role, or approval
fields. Backend signup and service-role jobs retain their access.

The old `profiles` read policy exposed **all profile fields, including email**.
Direct profile reads now return only the caller's own row or rows accessible to
an approved administrator. Public profiles are available through
`public.qmargin_b74_public_profiles`, which includes only `id`, `username`,
`about`, and `avatar_url` for approved accounts that opted into public visibility.

**Older app integration:** change its public profile/directory queries from
`profiles` to `qmargin_b74_public_profiles`, selecting only those four fields.
Keep account settings and admin queries on `profiles`. That application's source
is not in this repository, so its callers cannot be changed here. Coordinate that
change with this SQL; public profile pages using the old query will otherwise
stop receiving other users' rows.

The script removes only `TRUNCATE` on public tables where `anon` or
`authenticated` currently has it; it preserves every other grant and all data.
If an inherited parent-role grant still provides `TRUNCATE`, the whole script
aborts and names the table. Inspect that role grant rather than removing unrelated
roles or policies.

## 4. Verify and publish

Run [`supabase/verify-security.sql`](supabase/verify-security.sql) as `postgres`.
Its final result is a single JSON report. It checks metadata and anonymous
visibility without returning setting values, profile details, or drafts.
If `anon` has no SELECT grant on a checked table, that is already a secure denial
and the row query is skipped. Do not add a SELECT grant to make verification run.
If an older copy of the hardening SQL made anonymous policies call an account-only
helper, run [`supabase/fix-anonymous-policy-checks.sql`](supabase/fix-anonymous-policy-checks.sql)
as `postgres`, then rerun verification. This separates anonymous policies from
authenticated checks without granting access to the helper. Anonymous settings
reads retain only the two public settings; private profile/blog reads stay denied.
Verification reports policy permission errors as `INCOMPLETE`, with the affected
table and error, rather than claiming they passed. Actual visible private rows
still raise an error. These checks do not replace testing the
older application's account and admin flows.

Publish this repository's app changes through **Publish journal** after deploying
the SQL and function. The editor and reader must update together. Verify:

1. An active review can download a referenced attachment. Its HTTP response is
   binary, has `Cache-Control: private, no-store`, and has no redirect URL.
2. Changing a token, requesting an unreferenced attachment, or using an expired
   review fails. A published review continues to open its public article.
3. Comments and contact requests still work; a rate-limited request displays a
   useful message. Use a staging project to deliberately exhaust the budgets.
4. Ordinary members cannot create/promote admin profiles or change approval
   fields. Approved admins can still approve membership. Test public profile
   pages after switching the older app to the safe view.

## 5. Enable production HTTP security headers

The journal currently deploys to **GitHub Pages**. The generated `dist/_headers`
file is supported by Cloudflare Pages/Netlify, but GitHub Pages does not apply it.
Existing HTML CSP and referrer meta tags remain in place. The new HTTP CSP adds
anti-framing rules; the HTML CSP continues to restrict scripts, connections,
images, and media. `frame-ancestors` requires an HTTP header.

If you manage the domain through Cloudflare, proxy the journal hostname, then
create a **Response Header Transform Rule** matching only
`http.host eq "commonhours.qd.je"`. Set these headers (do not append):

| Header | Value |
| --- | --- |
| Content-Security-Policy | `frame-ancestors 'none'; base-uri 'none'; object-src 'none'` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `no-referrer` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| Strict-Transport-Security | `max-age=31536000` |

Keep the GitHub Pages custom domain and certificate configured; use Cloudflare
**Full (strict)** TLS. Enable HSTS only while this hostname will remain on HTTPS.
If you cannot configure a proxy for this domain, deploy `dist/` to a static host
that supports `_headers` and move the custom domain there. Production header
protection remains incomplete until one of these hosting steps is performed.

Check both the journal and the writing desk, including a missing page:

```powershell
curl.exe -I https://commonhours.qd.je/
curl.exe -I https://commonhours.qd.je/folio-80f54af81f7d/
curl.exe -I https://commonhours.qd.je/missing-page
```

References: [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
[Supabase function configuration](https://supabase.com/docs/guides/functions/function-configuration),
[Supabase function secrets](https://supabase.com/docs/guides/functions/secrets),
[Cloudflare response header rules](https://developers.cloudflare.com/rules/transform/response-header-modification/create-dashboard/),
[Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/),
[Netlify headers](https://docs.netlify.com/manage/routing/headers/),
[CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).

## Local checks

`node --test` runs rendering, endpoint authorization, and preview-header tests.
`node build.mjs --offline-feed` creates a disconnected, empty build for local use.
The preview server defaults to a disconnected backend even when production
settings are present. Set `PREVIEW_SUPABASE_URL` and
`PREVIEW_SUPABASE_PUBLISHABLE_KEY` to connect a separate test project.

The SQL regression test runs the actual migrations against an in-memory
PostgreSQL instance with synthetic legacy policies, accounts, and journal data.
It checks repeat application, visitor RLS, safe profile fields, escalation attempts,
MFA, media visibility, budget exhaustion/reset, and expired/unreferenced review files.

This is a local fixture test, not a verification of production grants, Storage,
Edge Function deployment, or the older app's integration.
