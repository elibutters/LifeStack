#!/usr/bin/env bash
# Runs every test suite. They use mocked Plaid responses and only the throwaway lifestack_test
# database, never the development or live ones.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
bash scripts/test-db.sh
export DATABASE_URL=postgres://lifestack:lifestack@127.0.0.1:5432/lifestack_test
export DATABASE_URL_UNPOOLED= # never let a .env pointing at the live database leak into a test run
for t in plaid finance-calc finance-data; do
  pnpm --filter @lifestack/db exec tsx --conditions=react-server "../../apps/web/tests/$t.test.mts"
done
