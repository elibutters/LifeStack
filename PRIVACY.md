# Privacy rules for this repository

This repo is public and is meant to be usable by anyone. It contains code and
configuration templates only. Everything about the person running it lives in
their own Postgres database and their own untracked local files.

## Never commit

- Names, email addresses, phone numbers, addresses, employers, or anything else that
  identifies the person running an instance or the people in their life.
- Real data of any kind: events, tasks, contacts, supplement stacks, account labels,
  places, coordinates, calendar or email content, database dumps, CSV exports, backups.
- Secrets: `.env` files, API keys, OAuth client secrets or tokens, bearer tokens,
  encryption keys, tailnet names or `*.ts.net` hostnames.
- Screenshots or fixtures made from a real instance.

## Where personal things go instead

| Thing | Where it lives |
| --- | --- |
| Life data (events, tasks, people, places, ...) | Postgres |
| Credentials and host settings | `.env` (gitignored; template in `.env.example`) |
| Personal seed scripts, notes, exports | `local/` (gitignored) |
| Your own identifying terms for the commit guard | `.privacy-denylist` (gitignored) |

Per-user settings (timezone, sources, geofences, supplement definitions) are rows in
the database or values in `.env`, never constants in code.

## Writing code and docs

- Refer to "the user" or "the owner". No real names in code, comments, tests, commit
  messages or docs.
- Tests and examples use obviously synthetic data (`Example Person`, `example.com`,
  coordinates `0,0`).
- Defaults must be generic (`UTC`, `127.0.0.1`), not one person's setup.

## Enforcement

`scripts/check-privacy.sh` runs as a pre-commit hook and in CI. It rejects data and
secret file types, common secret formats, tailnet hostnames, and anything matching
your `.privacy-denylist`. Enable the hook once per clone:

```bash
git config core.hooksPath .githooks
cp .privacy-denylist.example .privacy-denylist
```

Then add your own name, email, employer and similar terms to `.privacy-denylist`.

The guard is a backstop, not a substitute for reading your diff.
