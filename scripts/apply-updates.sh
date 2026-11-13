#!/usr/bin/env bash
# Brings a live database up to date, step by step (ADR-116).
#
# supabase/update-to-latest.sql replays every schema change since the first version in one transaction. That is fine
# for the SQL Editor, but on a database with players online it holds locks for minutes. This script applies only the
# update files that are new for this database, each in its own short transaction, and remembers them in
# nexa_meta.applied_updates. Then it writes the game config and the seeds, each only when its content changed.
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

# Game config, gallery and home catalogue: each only when its content changed since the last run. Writing them
# again every time kept the tick and every request waiting for minutes on a database with players online. They do
# not take the tick lock: they only upsert their own rows.
# (The market bootstrap is not run here: run_due_jobs() does it by itself on a database that needs it.)
sql -c "create table if not exists nexa_meta.applied_seeds (name text primary key, hash text not null, applied_at timestamptz not null default now())" \
    -c "revoke all on nexa_meta.applied_seeds from public, anon, authenticated"

apply_seed() {
  local name=$1 hash
  hash=$(printf '%s' "$2" | sha256sum | cut -d' ' -f1)
  if [[ "$(sql -tA -c "select exists (select 1 from nexa_meta.applied_seeds where name = '$name' and hash = '$hash')")" == "t" ]]; then
    echo "same $name"
    return 0
  fi
  {
    printf '%s\n' "$2"
    echo "insert into nexa_meta.applied_seeds (name, hash) values ('$name', '$hash')"
    echo "  on conflict (name) do update set hash = excluded.hash, applied_at = now();"
  } | apply "$name"
}

# The config seed inserts with "on conflict do nothing"; for an update the current values must win.
# Only the first insert (the config rows) is turned into an upsert, as in scripts/build-setup-sql.sh.
config=$(awk 'BEGIN{n=0} /^on conflict \(key\) do nothing;$/{n++; if(n==1){print "on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();"; next}} {print}' supabase/seeds/game_config.sql)
apply_seed game_config "$config"
apply_seed artworks "$(cat supabase/seeds/artworks.sql)"
apply_seed furniture "$(cat supabase/seeds/furniture.sql)"
echo "Datenbank ist auf dem neuesten Stand."
