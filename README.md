# Life Stack

A private, self-hosted system for one person's life data: sleep, calendar, logs,
tasks, supplements, finances and more, in one Postgres database. It has two readers:
you, through an installable PWA, and your agents, through an MCP server.

- **Own the spine, not the capture.** Pull from the tools you already use; build forms
  only for data with no source.
- **Lean and boring.** A CRUD Next.js app over Postgres.
- **Private by default.** Reachable only over your Tailscale tailnet. Nothing accepts
  public inbound traffic.

**This repository holds no one's data.** It is code and templates only; everything
personal lives in your own database and untracked local files. See
[PRIVACY.md](PRIVACY.md) if you plan to contribute or fork.

## Architecture

Four containers on one host, run with Docker Compose:

| Service | What it does |
| --- | --- |
| `postgres` | Postgres 16 + PostGIS. One generic `events` table plus a few entity tables. |
| `web` | Next.js App Router PWA and HTTP API. |
| `workers` | Scheduled, idempotent pulls from upstream APIs into `events`. |
| `mcp` | MCP server giving agents structured read access and narrow write tools. |

```
apps/web        Next.js PWA + API
apps/workers    ingestion workers
apps/mcp        MCP server
packages/db     Drizzle schema, migrations, client
infra/          Dockerfile, Compose, Tailscale notes
scripts/        privacy check
```

## Run it

Requires Docker. For development also Node 22+ and pnpm.

```bash
cp .env.example .env        # then set POSTGRES_PASSWORD
pnpm stack:up               # build and start all four containers, apply migrations
```

Open http://127.0.0.1:3000. To reach it from your phone and install it to the home
screen, put the host on your tailnet and follow [infra/tailscale.md](infra/tailscale.md).

Development against the Compose database:

```bash
pnpm install
git config core.hooksPath .githooks
cp .privacy-denylist.example .privacy-denylist   # add your own name, email, etc.
docker compose -f infra/docker-compose.yml --env-file .env up -d postgres
pnpm db:migrate
pnpm dev
```

`pnpm db:migrate` and `pnpm dev` read `DATABASE_URL` from your shell, so export the
values in `.env` first (for example `set -a; . ./.env; set +a`).

## Status

| Milestone | Scope | State |
| --- | --- | --- |
| M0 Skeleton | Monorepo, Compose stack, schema + migrations, installable PWA | done |
| M1 Capture | `POST /api/events`, manual log form, Log view, iOS Shortcuts | next |
| M2 Sources | Calendar and sleep workers, `sync_state`, sync-health page | |
| M3 Views | Today, Metrics, Weekly review | |
| M4 MCP | `query_events`, `get_today`, `get_week_summary`, tasks, `log_event`, `run_sql` | |
| M5 Hardening | Encrypted backups + restore test, token revocation, web push | |

## License

MIT
