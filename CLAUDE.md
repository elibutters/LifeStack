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
- The app is on the public internet. Every new route must be covered by the session
  check in `apps/web/proxy.ts` or verify a bearer token itself. Fail closed.
- Serverless: no long-lived processes, no in-memory state between requests, keep
  database connections pooled (`prepare: false`).
- TypeScript strict. Drizzle for schema and migrations. zod at every API boundary.
- Keep it lean: no auth library, no state-management library, no extra services.
- Every ingested row carries `source` + `source_id` and is written with
  `ON CONFLICT DO UPDATE`.
- Store no account numbers, credentials or email bodies.
- After schema changes: `pnpm db:generate`, commit the migration.
