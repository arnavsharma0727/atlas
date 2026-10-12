# Deployment

Atlas is deployed as a Next.js app on Vercel and stores collected source evidence in Supabase Postgres. Vercel Cron calls the protected `/api/ingest` route daily. The scheduled source set includes a bounded, keyless public Stack Exchange feed across 12 communities; optional sources remain subject to their own credentials, terms, and configured limits.

## Local development

Next.js 16 requires Node.js 20.9 or newer. Use an active LTS release (the current Vercel production builder must be verified on deployment).

```bash
npm install
npm run dev
```

Set local-only values in the root `.env.local`, which must remain ignored by Git. Required server-side settings are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`. Source connectors are controlled by server-side flags and feed configuration such as `RSS_ENABLED`, `RSS_FEEDS_KR_JSON`, `RSS_FEEDS_US_JSON`, and `STACK_EXCHANGE_ENABLED`. Stack Exchange requires no key; when enabled, its connector samples current questions across 12 English- and other-language communities (including Politics, Law, and Quantitative Finance), keeps only individually CC BY-SA 4.0 items with attribution, and discards question/answer bodies. It makes at most 12 requests per daily ingestion run and respects API backoff. All communities remain one expert-Q&A operator. RSS must point directly to publisher feeds; Google News redirects are rejected and historical Google News rows are hidden from the public evidence view. Review each publisher's permission before configuring it. Do not use a service-role key or cron secret in any `NEXT_PUBLIC_` variable.

### Optional EIA energy context

The EIA source is disabled until the operator registers for a free API key at [EIA](https://www.eia.gov/opendata/register.php), personally accepts the [EIA API terms](https://www.eia.gov/opendata/terms-of-service.php), and adds `EIA_API_KEY` as a private server-side variable in local `.env.local` or Vercel Production. Do not send the key in chat, add it to GitHub, prefix it with `NEXT_PUBLIC_`, or place it in browser code. The source only activates for explicit crude oil/WTI/Brent, natural gas/Henry Hub, or broad energy-price topics; its U.S. benchmarks are not global prices or country opinions. Without the key, Atlas visibly reports the source as not searched. EIA states that its API is free but registration is required; no payment method or paid plan is needed.

### Source takedown

Migrations `0012_source_takedown.sql` and `0013_takedown_lead_cascade.sql` add an operator-only hard-delete workflow. Production currently has the required private `TAKEDOWN_SECRET`; an unauthenticated production request was verified to return HTTP 401 on 2026-10-06. Never reuse `CRON_SECRET`, expose the value in a `NEXT_PUBLIC_` variable, or commit it. Operators submit `POST /api/operator/takedown` with `Authorization: Bearer <TAKEDOWN_SECRET>` and JSON `{ "documentId": "<source UUID>", "reason": "rights_request|privacy_request|operator_review" }`. This endpoint is for trusted operators after verifying a request; it is not a public request intake form. Its credentialed deletion path has not been exercised against a real request.

The database transaction deletes the source item, its attached analyses and entity links, and directly linked research leads; it invalidates affected derived rows and retains only an opaque identifier/reason/outcome audit plus SHA-256 content/URL fingerprints to prevent re-ingestion. The fingerprints are not reversible, but remain personal-data-adjacent identifiers and need counsel-approved retention. This is an on-demand deletion path, not an automatic source-specific expiration schedule. Test on non-production data before processing real takedown requests.

### Private briefs, lead publishing, and Supabase Auth

The Auth UI, cookie-session refresh, callback, private research briefs, watchlists, and CSV import/export are implemented. As of 2026-10-08, the production login page renders the GitHub sign-in action; this verifies provider availability, not a complete end-to-end login with every account. The login uses Supabase GitHub OAuth and requests only basic profile/email identity (no repository scopes). Never put the client secret in this repository or a browser variable. Required app-side variables are:

- `SUPABASE_URL` (already used by the server)
- `SUPABASE_ANON_KEY` (the Supabase anon/publishable key; not the service-role key)
- `SUPABASE_AUTH_ENABLED=true`
- `NEXT_PUBLIC_APP_URL` set to the exact site origin, e.g. `https://signal-scout-xi-ruby.vercel.app` (the existing production URL is retained to avoid disrupting OAuth callbacks and shared links).

In Supabase Auth URL Configuration, allow the exact app callback URL `https://signal-scout-xi-ruby.vercel.app/auth/callback` and local `http://localhost:3000/auth/callback` for development. Supabase's built-in shared email sender is limited to testing, so it is not used for public sign-in. Test with a non-owner GitHub account before turning on `SUPABASE_AUTH_ENABLED`. The callback uses PKCE and only accepts same-site relative return paths.

Watchlist data is read/written through the authenticated server client and owner-scoped RLS. CSV imports accept active profile tickers only (maximum 200 rows / 100 KB); exports are private and non-cacheable. Lists cannot be made public; share links, notes, and alerts are not implemented.

Migration `0015_research_lead_authorship.sql` adds an optional author reference without changing existing operator-created rows; production verification confirms it is installed. The publication action verifies every cited source row server-side, creates a hidden draft, links every citation, and only then makes it active; the author can withdraw it later. It requires explicit researcher confirmation. This workflow is not automatic lead generation, and the current production source sample may not pass its gate. Do not seed synthetic records in production.

Watchlist mutations use a Supabase Postgres per-user hourly quota (10 create, 10 delete, 200 membership changes, 6 CSV imports, 30 CSV exports). Migration `0011_watchlist_action_limits.sql` must be applied before deploying the corresponding server actions. These quotas do not rate-limit anonymous page reads.

Anonymous GDELT searches are rate-limited server-side by migration `0016_public_endpoint_rate_limits.sql`: 10 requests per one-minute window per client and 30 globally. The Vercel-provided `x-forwarded-for` client address is HMAC-SHA256 hashed with the server-only service-role secret before storage; no raw address is stored, and expired buckets are removed after two minutes. The route fails closed (503) if the database limiter is unavailable. Apply migration 0016 before deploying code that calls it.

## Production

Add the same required settings in the Vercel project's private Environment Variables UI for the intended deployment environments. Vercel Cron authenticates using the configured `CRON_SECRET`. Never put credentials in source files, build logs, client-side variables, screenshots, or GitHub. Supabase migrations are maintained in `supabase/migrations`; apply reviewed migrations to the intended project before deploying code that depends on them.

As of 2026-10-11, Vercel showed the GitHub `main` push for commit `253d8e8` (“Link AI overviews to supporting evidence”) as a ready Production deployment. The stable `signal-scout-xi-ruby.vercel.app` URL served the new build in a live search check. This verifies the Git-to-Vercel path for this commit only; inspect the commit and `Ready` status in the Vercel deployment record after each future push. A local Vercel CLI deployment attempt returned “Not authorized,” so do not rely on CLI deploy access unless the operator configures it.

The current schedule is once daily (Vercel Hobby-compatible). Connector response codes and configuration do not by themselves establish successful or legally permitted collection; review freshness and source terms separately.

## Checks

```bash
npm test
npm run typecheck
npm run build
npm run verify:prod
npm audit
```

`verify:prod` checks public routes, confirms protected endpoints reject unauthenticated requests, and queries product data gates when server credentials are available locally. It never logs credential values. It deliberately fails when actual recent conversation coverage or evidence-backed leads are missing. Passing a connector-run check is not proof of current published conversation or representative geographic coverage. Do not fabricate records to make the check pass.
