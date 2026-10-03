# Life Stack

Self-hosted personal data spine: Postgres + Next.js PWA + ingestion workers + MCP server.

## Hard rule: no personal information in this repo

This repo is public. Read PRIVACY.md before changing anything. In short:

- No real names, emails, employers, locations, tailnet names, or any real data in code,
  comments, tests, fixtures, docs, commit messages or PR descriptions. Say "the user".
- Personal data lives only in Postgres. Secrets live only in `.env`. Personal scripts
  and notes live only in `local/`. All three are gitignored.
- Per-user settings come from the database or env, never hardcoded.
- Never bypass the pre-commit privacy check (`--no-verify`).

## Conventions

- pnpm monorepo: `apps/web`, `apps/workers`, `apps/mcp`, `packages/db`, `infra/`.
- TypeScript strict. Drizzle for schema and migrations. zod at every API boundary.
- Keep it lean: no auth library, no state-management library, no services beyond the
  four containers.
- Every ingested row carries `source` + `source_id` and is written with
  `ON CONFLICT DO UPDATE`.
- Store no account numbers, credentials or email bodies.
- After schema changes: `pnpm db:generate`, commit the migration.
