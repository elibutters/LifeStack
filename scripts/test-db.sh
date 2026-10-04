#!/usr/bin/env bash
# Creates and migrates the throwaway database that the test suite runs against.
# Tests never touch the development or production databases.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PSQL=(docker compose -f infra/docker-compose.yml exec -T postgres psql -U lifestack -d postgres -tA)
if ! "${PSQL[@]}" -c "select 1 from pg_database where datname='lifestack_test'" | grep -q 1; then
  "${PSQL[@]}" -c "create database lifestack_test" >/dev/null
fi
DATABASE_URL=postgres://lifestack:lifestack@127.0.0.1:5432/lifestack_test pnpm -s db:migrate >/dev/null
