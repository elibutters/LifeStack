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
   | `APP_PASSWORD` | your password; at least 16 characters, long and random. Also the first password of the owner account |
   | `OWNER_EMAIL` | your email. With it set, you sign in with email and password; the first sign-in creates your account |
   | `SESSION_SECRET` | output of `openssl rand -hex 32` |
   | `APP_TZ` | your IANA timezone, e.g. `UTC` |
   | `APP_URL` | the deployment's public address, e.g. `https://your-app.vercel.app` |
   | `ENCRYPTION_KEY` | output of `openssl rand -hex 32`; encrypts stored account tokens |
   | `CRON_SECRET` | output of `openssl rand -hex 32`; lets Vercel Cron call the sync |

5. Deploy. Production builds apply database migrations, then build the app. Preview
   builds never migrate, so connect the database to the Production environment only;
   sign-in is unavailable on previews. The very first deployment of a new Vercel
   project is a production deployment whichever branch it comes from.
6. On your phone, open the deployment URL, sign in, then Share -> Add to Home Screen.

### Connect Outlook

The Calendar tab reads a personal Outlook account (outlook.com, hotmail.com, live.com)
through Microsoft's calendar API, read-only. One-time setup, free:

1. Sign in at <https://entra.microsoft.com> with your Microsoft account and open
   **App registrations** -> **New registration**.
2. Name it anything. Under **Supported account types** choose **Personal Microsoft
   accounts only**. Under **Redirect URI** choose **Web** and enter
   `<APP_URL>/api/connections/outlook/callback`. Register. Add a second redirect URI for
   `http://localhost:3000/api/connections/outlook/callback` if you develop locally.
3. **API permissions** -> **Add a permission** -> **Microsoft Graph** -> **Delegated**:
   `Calendars.Read`, `offline_access`, `User.Read`.
4. **Certificates & secrets** -> **New client secret**. Copy the secret **Value** now; it is
   shown once. Secrets expire (at most 24 months), after which you create a new one.
5. Set `MICROSOFT_CLIENT_ID` (the Application ID) and `MICROSOFT_CLIENT_SECRET` in Vercel,
   redeploy, then open **Settings** in the app and choose **Connect Outlook**.

Every calendar on the account is synced. Anything from a calendar whose name contains
"holiday" (such as "United States holidays") is shown in amber; everything else is blue.

The calendar syncs once a day, and again whenever you open the app if the last sync is
more than 15 minutes old. Vercel's free plan only allows daily scheduled jobs.

### Connect banks, cards and brokerages (Plaid)

Accounts are linked through [Plaid](https://plaid.com). Plaid's free Trial plan covers up to 10
institutions with real data.

1. Create a Plaid account and enable two-factor authentication on it.
2. In the Plaid dashboard, open **Developers -> Keys** and copy the client ID and the sandbox and
   production secrets into `PLAID_CLIENT_ID`, `PLAID_SANDBOX_SECRET` and `PLAID_PRODUCTION_SECRET`.
3. Under **Developers -> API -> Allowed redirect URIs** add `<APP_URL>/settings/oauth` (needed by
   banks that sign you in on their own site).
4. Set the same variables in Vercel (the production secret is the one the deployed app uses).
5. Open **Settings**, then **Add bank or card** or **Add brokerage**. Your bank login is typed into
   Plaid's window, never into this app.

The Plaid environment follows your database. With the local Docker database (`pnpm db:up`) the app
uses Plaid's fake Sandbox. If you point `DATABASE_URL` at a hosted database it uses real Plaid, so
fake and real data never mix. Banks that sign you in on their own site (OAuth) can only be linked
from a deployment with an https address.
Transactions, balances, holdings and credit card due dates are stored; account numbers never are.
Data syncs when Plaid reports changes and once a day as a backstop.

### Finance

Once accounts are linked, the **Finance** tab shows net worth, accounts, spending by category and
merchant, a searchable transaction list, recurring charges and investment holdings, plus a few
plain-language insights (spending changes, upcoming card payments, savings rate). Run `pnpm test`
to check the logic; `pnpm db:seed-finance` fills a local database with clearly fake data to look at.
Investment holdings need the brokerage's permission: in Connections use **Allow investment data**.

### Quick capture

Things that have no other source (mood, caffeine, supplements) are logged in the **Log** tab: one tap,
with a short Undo. The **API keys** page (Account menu) creates revocable keys for iPhone Shortcuts, widgets or agents,
and explains how to set one up. A key is shown once and only a fingerprint is stored.

```
POST /api/v1/events        Authorization: Bearer ls_...       (key with log:write)
  { "type": "mood", "value": 4, "note": "calm" }
  { "type": "caffeine", "drink": "Coffee", "mg": 95 }
  { "type": "supplement", "name": "Morning stack" }
  optional: "at" (ISO time, up to 30 days back) and "id" (8-64 letters/numbers; a retry with the same id never logs twice)
GET  /api/v1/log/today     Authorization: Bearer ls_...       (key with log:read)
GET  /api/v1/profile       Authorization: Bearer ls_...       (key with log:read; owner profile for agents)
```

### Connect Eight Sleep

Nightly sleep (score, stages, HRV, time in bed) is copied from an Eight Sleep account. Eight Sleep has no public developer API, so this uses the same private app login as Home Assistant. The pod is never controlled.

1. Open **Connections** and enter the Eight Sleep email and password. They are stored encrypted. Accounts with two-factor authentication cannot be linked this way.
2. The first sync pulls the last two weeks, then walks backward through history in chunks on later cron runs and page loads until it runs out of nights.

Data lands in `events` (`domain` sleep, `source` eight) and shows on the **Sleep** tab and Overview. The unofficial API can change without notice.

### Supplements

A supplement is taken or not on a given day, with a dose: logging it again that day updates the entry instead of adding
another, and the app's chip toggles it. Default doses (`SUPPLEMENT_PRESETS`) and caffeine amounts come from the server
(`GET /api/v1/log/options`), so the web app and the iPhone app always show the same buttons. To fold duplicates left
from before this rule, run `pnpm db:dedupe-supplements` (dry run) and add `--apply` to remove them.

### JSON API for the app

Besides quick capture and MCP, these read endpoints back the iPhone app. All take `Authorization: Bearer ls_...`
and each is limited to a scope: `GET /api/v1/log/history` (recent entries with ids) and `DELETE /api/v1/events/{id}` (remove one mood, caffeine or supplement entry), alongside `GET /api/v1/overview` (sections follow the key's scopes), `calendar`
(`from`, `to`, 90 days at most), `sleep` (`nights`), `finance`, `finance/transactions`, `finance/holdings`,
`profile`, and `connections` (`account:read`).

The app signs in with email and password at `POST /api/v1/auth/login` (`{ "email", "password", "device" }`), which returns
a revocable key for that device. It has the same attempt limit as the web form, refuses browser (Origin)
requests, and signing in again on the same device replaces that device's key. Revoke it any time on the
**API keys** page.

### iPhone app

`apps/ios` is a small SwiftUI app (see its README): connect with your address and an API key, log mood,
caffeine and supplements in one tap, and see today. Widgets are next.

### MCP server (agents)

`POST /api/v1/mcp` is a stateless MCP endpoint over HTTP, authenticated with the same revocable keys as
quick capture. On the **API keys** page (Account menu) create a key with access **Agent: read everything and add
logs**. Each tool is only offered to a key that holds its scope (`log:read`, `log:write`, `calendar:read`,
`sleep:read`, `finance:read`).

| Tool | Scope | What it does |
| --- | --- | --- |
| `get_profile` | log:read | Owner identity, physical details and notes for agents (empty fields omitted) |
| `get_today` | log:read | Today's mood, caffeine and supplements |
| `log_event` | log:write | Log a mood, caffeine or supplement (retry-safe with an `id`) |
| `get_calendar` | calendar:read | Events and holidays between two dates (90 days at most) |
| `get_sleep` | sleep:read | Recent nights: score, stages, HRV |
| `get_finance_summary` | finance:read | Net worth, monthly cash flow, top categories, insights |
| `get_transactions` | finance:read | Search transactions by text, date or category |
| `get_holdings` | finance:read | Investment positions |

```
claude mcp add --transport http life-stack https://<your-deployment>/api/v1/mcp \
  --header "Authorization: Bearer ls_..."
```

### Backups

A daily cron (`/api/cron/backup`) copies every table (except login attempts) into one file, gzips it,
encrypts it with a key derived from `ENCRYPTION_KEY`, and stores it in a private Vercel Blob store
(`backups/lifestack-YYYY-MM-DD.bin`, newest 30 kept). Keep a separate copy of `ENCRYPTION_KEY`:
without it the backups cannot be read. To restore into a local database:

```
BLOB_READ_WRITE_TOKEN=<from Vercel env> vercel blob get backups/lifestack-YYYY-MM-DD.bin --access private --output backup.bin
pnpm backup:restore backup.bin                     # replaces the contents of DATABASE_URL
```

Restoring into a hosted database also needs `ALLOW_REMOTE_RESTORE=1`.

### Security model

The app is reachable from the public internet, so the password is what stands between
the world and your data. Keep it in a password manager.

- Sign-in is rate limited: 5 failed attempts per address and 300 overall per 15
  minutes. If you are ever locked out, wait 15 minutes or run
  `delete from auth_attempts` in your database console.
- Change your email and password on the **Security** page (Account menu); no redeploy needed. With `OWNER_EMAIL` set,
  `APP_PASSWORD` is only the first password (used once to create your account) and sessions are signed by
  `SESSION_SECRET` alone, so changing the password signs your phone out but not the web. Rotating `SESSION_SECRET`
  signs out every device. Without `OWNER_EMAIL`, changing `APP_PASSWORD` or `SESSION_SECRET` signs out every device. Accounts live in the `users` table
  (email and a scrypt hash); every key and session names its user. Data is still owned by the one owner: separating
  data per user is the next step and means adding `user_id` to the data tables and scoping each query.
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
