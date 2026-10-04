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
  The one exception is `/api/cron/*`, which skips the session gate because Vercel Cron cannot
  hold one; every handler there must check `CRON_SECRET` itself and fail closed.
- Finance data comes from Plaid (`lib/plaid.ts`, `lib/finance.ts`) into `events` (domain `finance`,
  source `plaid`). The Plaid environment follows the database (`plaidEnv()`): a local database only ever gets
  Plaid's fake Sandbox, a hosted database only ever gets real Plaid, and nothing can override
  that, so fake and real data never mix. Developing against the live database is allowed (the
  owner chose it), so never run tests, seeds or deletes against it: `pnpm test` only touches
  `lifestack_test`, the seed script refuses hosted databases, and `db:migrate` refuses them
  unless `ALLOW_REMOTE_MIGRATE=1`. Webhooks and the OAuth return page need an https address, so
  banks that sign in on their own site can only be linked from the live site. Never store account numbers. A sync reads everything from Plaid first and writes data
  and cursor in one transaction; an unreadable row fails the sync rather than being skipped.
  `source_id` is unique per source across all kinds, so snapshots are prefixed (`bal:`, `liab:`,
  `hold:`, `inv:`). The Plaid webhook is a public path and must verify Plaid's signature.
- Third-party tokens are stored only encrypted (`lib/crypto.ts`, key in `ENCRYPTION_KEY`).
  Outlook is linked through Microsoft Graph for personal accounts only, with read-only scope.
  Work or employer calendars are never connected.
- MCP: `/api/v1/mcp` (`lib/mcp.ts`) exposes read tools and `log_event` to agents. Each tool is registered only
  when the key holds its scope; a new tool must pick the narrowest scope and return no secrets. It is
  stateless, rejects browser (Origin) requests, and the body is capped.
- Backups: `/api/cron/backup` writes an encrypted full dump to private Vercel Blob daily. New tables are
  included automatically; a new table that must not be backed up goes in `SKIP` in `lib/backup-db.ts`.
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

## Working with multiple agents

Several agents and tools work on this repo. To stop work diverging:

- Never edit files in the shared main folder. Start every task in your own worktree off fresh
  origin/main: `git fetch && git worktree add ../<task> -b <task> origin/main`.
- The shared main folder stays on `main` and clean. It only ever fast-forwards to origin/main.
- Small PRs, merged quickly. Run `pnpm test`, typecheck and build before opening one, and wait for
  CI to finish before merging.
- Stage files by name, read `git diff --cached` before committing, never `git add -A` in a folder
  other agents may have touched.
- Production deploys come only from merges to main. No manual deploys.
- If you find uncommitted changes in the shared folder, do not discard or commit them. Snapshot them
  to a branch from a separate worktree and tell the owner.

## Native iOS app (the end goal)

The owner wants a full native iOS app with home-screen widgets, built once the web app has
real data. A PWA or a web wrapper cannot do widgets, App Intents, HealthKit or Live
Activities, so the app will be SwiftUI + WidgetKit, talking to this deployment over HTTPS
with bearer tokens. The web app stays for desktop and as a fallback. The app lives in `apps/ios` (SwiftUI, generated with
XcodeGen: `cd apps/ios && xcodegen generate`); its project file, Info.plist, signing team and bundle id
are never committed, so nothing personal enters the repo. What that means now:

- Every feature gets a versioned JSON API under `/api/v1/*` (bearer-token auth,
  zod-validated, stable shapes). Server components may call the same functions in
  `apps/web/lib/`, but the API is the contract for clients.
- Never make something only reachable through the cookie session if a native client needs it.
- Design for widgets: small, cheap endpoints that return pre-digested summaries
  (for example `/api/v1/overview`), since widgets refresh on a tight system budget.
- Dates cross the API as ISO 8601 with offset; all-day items carry a plain `YYYY-MM-DD`.

## Finance pages

`/finance` (overview, spending, transactions, recurring, investments) reads the synced `finance.*`
events. All the maths lives in `apps/web/lib/finance-calc.ts` (pure, no database, fully tested);
`lib/finance-data.ts` only loads and shapes rows. Plaid's sign convention holds throughout (positive
= money out), transfers and credit card payments are never counted as spending or income, and
every page calls `requireSession()`. Charts are plain SVG and CSS. Run `pnpm test` (needs Docker)
before changing any of it; it only touches the throwaway `lifestack_test` database.

## Quick capture and API keys

Mood, caffeine and supplements are logged from `/log` (one tap, Undo for six seconds) or through
`POST /api/v1/events` with a bearer key. `/api/v1/*` skips the session gate in `proxy.ts`, so every
handler there must call `verifyBearer` (via `lib/capture-api.ts`) and fail closed. Keys are shown once,
stored only as a SHA-256 hash, scoped (`log:write`, `log:read`), revocable, and at most ten are active.
The rules for what can be logged and how a day is summarised live in `lib/capture-core.ts` (pure,
tested). `deleteLog` only ever removes capture entries. Server actions must be declared as
`export async function` (an arrow function wrapper fails the production build, though typecheck
passes). Never echo request values back in an API error.

