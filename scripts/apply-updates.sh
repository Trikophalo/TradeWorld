#!/usr/bin/env bash
# Brings a live database up to date, step by step (ADR-116).
#
# supabase/update-to-latest.sql replays every schema change since the first version in one transaction. That is fine
# for the SQL Editor, but on a database with players online it holds locks for minutes. This script applies only the
# update files that are new for this database, each in its own short transaction, and remembers them in
# nexa_meta.applied_updates. Then it writes the current game config and seeds.
#
# Usage: NEXA_DB_URL=postgresql://... bash scripts/apply-updates.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${NEXA_DB_URL:?NEXA_DB_URL is not set}"
ATTEMPTS=${NEXA_ATTEMPTS:-6}
# The last update file a database had for certain when this script first met it (see baseline below).
BASELINE=20261203000300_rich_list_speed

sql() { psql "$NEXA_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

# Runs one transaction from stdin; a deadlock with a player request cancels it without changes, so try again.
apply() {
  local label=$1 body attempt
  body=$(cat)
  for attempt in $(seq 1 "$ATTEMPTS"); do
    if printf '%s\n' "$body" | sql -1 -f - > /dev/null; then
      echo "ok   $label"
      return 0
    fi
    echo "::warning::$label: attempt $attempt failed, trying again in 10 seconds"
    sleep 10
  done
  echo "::error::$label could not be applied after $ATTEMPTS attempts"
  return 1
}

# Bookkeeping lives outside the public schema: not reachable through the API, no game table.
first=$(sql -tA -c "select to_regclass('nexa_meta.applied_updates') is null")
sql -c "create schema if not exists nexa_meta" \
    -c "create table if not exists nexa_meta.applied_updates (name text primary key, applied_at timestamptz not null default now())" \
    -c "revoke all on schema nexa_meta from public, anon, authenticated" \
    -c "revoke all on nexa_meta.applied_updates from public, anon, authenticated"

# First meeting with a database that update-to-latest.sql already brought to the baseline (told by the index of the
# baseline file): everything up to it counts as applied. Any other database gets every file once.
if [[ "$first" == "t" ]] && [[ "$(sql -tA -c "select to_regclass('public.rich_list_snapshots_taken_idx') is not null")" == "t" ]]; then
  for f in supabase/updates/*.sql; do
    name=$(basename "$f" .sql)
    [[ "$name" > "$BASELINE" ]] && continue
    sql -c "insert into nexa_meta.applied_updates (name) values ('$name') on conflict do nothing"
  done
  echo "baseline: updates up to $BASELINE count as applied"
fi

for f in supabase/updates/*.sql; do
  name=$(basename "$f" .sql)
  if [[ "$(sql -tA -c "select exists (select 1 from nexa_meta.applied_updates where name = '$name')")" == "t" ]]; then
    continue
  fi
  {
    echo "-- Wait for a running market tick, keep the scheduled jobs out until commit."
    echo "select pg_advisory_xact_lock(7311001);"
    cat "$f"
    echo
    echo "insert into nexa_meta.applied_updates (name) values ('$name') on conflict do nothing;"
  } | apply "$name"
done

# Current game config, gallery, home catalogue and the market bootstrap: the last part of the generated update.
last=$(ls supabase/sql-editor/update-*.sql | sort | tail -1)
# The part brings its own begin/commit; apply() wraps a transaction itself.
grep -v -x -e "begin;" -e "commit;" "$last" | apply "config and seeds ($(basename "$last"))"
echo "Datenbank ist auf dem neuesten Stand."
