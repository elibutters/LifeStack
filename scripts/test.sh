#!/usr/bin/env bash
# Runs every test suite. They use mocked Plaid responses and only the throwaway lifestack_test
# database, never the development or live ones.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# One test run at a time: the suites wipe the shared lifestack_test database, so two agents running them
# together would corrupt each other. A second run waits here (up to 20 minutes) for the first.
lock="$(git rev-parse --path-format=absolute --git-common-dir)/lifestack-test.lock" # shared by every worktree and every sandbox
waited=0
until mkdir "$lock" 2>/dev/null; do
  holder="$(cat "$lock/pid" 2>/dev/null || true)"
  if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then rm -rf "$lock"; continue; fi # the run that held it died
  (( waited == 0 )) && echo "another test run is using lifestack_test; waiting..." >&2
  (( waited >= 1200 )) && { echo "gave up waiting for the test lock ($lock)" >&2; exit 1; }
  sleep 2; waited=$((waited + 2))
done
echo $$ > "$lock/pid"
trap 'rm -rf "$lock"' EXIT
node scripts/guard-git.test.mjs
bash scripts/test-db.sh
export DATABASE_URL=postgres://lifestack:lifestack@127.0.0.1:5432/lifestack_test
export DATABASE_URL_UNPOOLED= # never let a .env pointing at the live database leak into a test run
for t in plaid finance-calc finance-data capture eight backup mcp app-api amazon profile overview strava workouts-core wants todos notes-write email location notion settings goals-core outlook-write goals goals-notion session-log mcp-usage; do
  pnpm --filter @lifestack/db exec tsx --conditions=react-server "../../apps/web/tests/$t.test.mts"
done
