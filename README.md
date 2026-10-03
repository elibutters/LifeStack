# Life Stack

A private system for one person's life data: sleep, calendar, logs, tasks, supplements,
finances and more, in one Postgres database. It has two readers: you, through an
installable PWA, and your agents, through an MCP endpoint.

- **Own the spine, not the capture.** Pull from the tools you already use; build forms
  only for data with no source.
- **Lean and boring.** One Next.js app on Vercel over a hosted Postgres.
- **Private by default.** Single owner. Every page and API route sits behind the owner
  session or a bearer token.

**This repository holds no one's data.** It is code and templates only; everything
personal lives in your own database and environment variables. See
[PRIVACY.md](PRIVACY.md) if you plan to contribute or fork.

## Architecture

| Piece | Where it runs |
| --- | --- |
| Web UI + HTTP API | Next.js App Router on Vercel (`apps/web`) |
| Database | Any hosted Postgres 16 (Neon, Supabase, Vercel Postgres, ...). One generic `events` table plus a few entity tables. |
| Ingestion workers | Vercel Cron hitting route handlers in `apps/web` |
| MCP server | A Streamable HTTP route in `apps/web`, bearer-token auth |

```
apps/web        Next.js PWA, API, cron routes, MCP route
packages/db     Drizzle schema, migrations, client
infra/          local development database (Docker Compose)
scripts/        privacy check
```

## Deploy your own

1. Fork this repo.
2. Create a Postgres database. [Neon](https://neon.com) is the recommended provider:
   it has a free tier, supports PostGIS for the location features, and its Vercel
   integration sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` for you. Any Postgres 16
   works; use the **pooled** connection string for `DATABASE_URL`.
3. Import the fork into Vercel and set **Root Directory** to `apps/web`.
4. Add environment variables in the Vercel project:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | pooled connection string |
   | `DATABASE_URL_UNPOOLED` | direct connection string, used for migrations (optional) |
   | `APP_PASSWORD` | your login; at least 16 characters, long and random |
   | `SESSION_SECRET` | output of `openssl rand -hex 32` |
   | `APP_TZ` | your IANA timezone, e.g. `UTC` |

5. Deploy. Production builds apply database migrations, then build the app. Preview
   builds never migrate, so connect the database to the Production environment only;
   sign-in is unavailable on previews. The very first deployment of a new Vercel
   project is a production deployment whichever branch it comes from.
6. On your phone, open the deployment URL, sign in, then Share -> Add to Home Screen.

### Security model

The app is reachable from the public internet, so the password is what stands between
the world and your data. Keep it in a password manager.

- Sign-in is rate limited: 5 failed attempts per address and 300 overall per 15
  minutes. If you are ever locked out, wait 15 minutes or run
  `delete from auth_attempts` in your database console.
- Changing `APP_PASSWORD` or `SESSION_SECRET` signs out every device immediately.
- Nothing from signed-in pages is cached on the device; offline shows a blank shell.
- Pages are served with `noindex` and cannot be framed.

## Develop locally

Requires Node 22+, pnpm and Docker (for the local database only).

```bash
pnpm install
git config core.hooksPath .githooks
cp .privacy-denylist.example .privacy-denylist   # add your own name, email, etc.
cp .env.example .env                             # set APP_PASSWORD and SESSION_SECRET
pnpm db:up
pnpm db:migrate
pnpm dev
```

## Status

| Milestone | Scope | State |
| --- | --- | --- |
| M0 Skeleton | Monorepo, schema + migrations, owner login, installable PWA | done |
| M1 Capture | `POST /api/events`, manual log form, Log view, iOS Shortcuts | next |
| M2 Sources | Calendar and sleep workers, `sync_state`, sync-health page | |
| M3 Views | Today, Metrics, Weekly review | |
| M4 MCP | `/api/mcp`: `query_events`, `get_today`, `get_week_summary`, tasks, `log_event`, `run_sql` | |
| M5 Hardening | Encrypted backups + restore test, token revocation, web push | |

## License

MIT
