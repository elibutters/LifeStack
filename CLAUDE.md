# Life Stack

Single-owner personal data spine: one Next.js app on Vercel over a hosted Postgres.
Workers are Vercel Cron route handlers; the MCP server is a route in the same app.

## Hard rule: no personal information in this repo

This repo is public. Read PRIVACY.md before changing anything. In short:

- No real names, emails, employers, locations, tailnet names, or any real data in code,
  comments, tests, fixtures, docs, commit messages or PR descriptions. Say "the user".
- Personal data lives only in Postgres. Secrets live only in `.env`
  locally and Vercel environment variables in production. Personal scripts
  and notes live only in `local/`. All three are gitignored.
- Per-user settings come from the database or env, never hardcoded.
- Never bypass the pre-commit privacy check (`--no-verify`).

## Conventions

- pnpm monorepo: `apps/web` (UI, API, cron routes, MCP route), `packages/db`, `infra/`
  (local dev database only).
- The app is on the public internet. `apps/web/proxy.ts` gates requests, but it is not
  enough on its own: every page, server action and route handler that touches data must
  also call `requireSession()` from `apps/web/lib/auth.ts` (or verify a bearer token).
  Fail closed. Public paths are the exact list in `proxy.ts`; never put data behind one.
- Never cache authenticated responses in the service worker.
- Scheduled work: Vercel's free plan allows daily cron only. Sources sync on a daily
  cron and on demand when the app is opened or an agent asks; do not assume a
  sub-daily schedule.
- Migrations run only on production builds (`apps/web/vercel.json`), over
  `DATABASE_URL_UNPOOLED` when set.
- Serverless: no long-lived processes, no in-memory state between requests, keep
  database connections pooled (`prepare: false`).
- TypeScript strict. Drizzle for schema and migrations. zod at every API boundary.
- Keep it lean: no auth library, no state-management library, no extra services.
- Every ingested row carries `source` + `source_id` and is written with
  `ON CONFLICT DO UPDATE`.
- Store no account numbers, credentials or email bodies.
- After schema changes: `pnpm db:generate`, commit the migration.

## Native iOS app (the end goal)

The owner wants a full native iOS app with home-screen widgets, built once the web app has
real data. A PWA or a web wrapper cannot do widgets, App Intents, HealthKit or Live
Activities, so the app will be SwiftUI + WidgetKit, talking to this deployment over HTTPS
with bearer tokens. The web app stays for desktop and as a fallback. What that means now:

- Every feature gets a versioned JSON API under `/api/v1/*` (bearer-token auth,
  zod-validated, stable shapes). Server components may call the same functions in
  `apps/web/lib/`, but the API is the contract for clients.
- Never make something only reachable through the cookie session if a native client needs it.
- Design for widgets: small, cheap endpoints that return pre-digested summaries
  (for example `/api/v1/overview`), since widgets refresh on a tight system budget.
- Dates cross the API as ISO 8601 with offset; all-day items carry a plain `YYYY-MM-DD`.
