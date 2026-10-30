#!/usr/bin/env bash
# Rebuilds a throwaway local database from the migrations (+ seed, + tests with --test).
# Needs a running Postgres; defaults match the dev setup in DECISIONS.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST=${PGHOST:-/var/tmp/dawri-pg} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
DB=${DB:-dawri_test}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; }
run scripts/local-db/supabase_shim.sql
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/seed.sql
echo "migrations + seed loaded into $DB"
if [[ "${1:-}" == "--test" ]]; then
  psql -q -d "$DB" -c "create extension if not exists pgtap with schema extensions" >/dev/null
  fail=0
  for t in supabase/tests/*.sql; do
    out=$(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c "set search_path = public, extensions" -f "$t" 2>&1) || fail=1
    if grep -qE "^not ok|ERROR" <<<"$out"; then fail=1; echo "$out" | grep -E "not ok|ERROR|#" ; fi
    echo "$t: $(grep -c '^ok' <<<"$out") passed, $(grep -c '^not ok' <<<"$out") failed"
  done
  DB=$DB supabase/tests/concurrency.sh || fail=1
  exit $fail
fi
