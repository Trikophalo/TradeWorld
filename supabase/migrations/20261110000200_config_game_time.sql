-- =============================================================================
-- NEXA · 0200 · Runtime configuration, simulation runtime, game time
-- =============================================================================

-- ---------------------------------------------------------------------------
-- game_config: one JSON document per balancing area (ADR-009). Values are
-- generated from src/config/balance.ts (`pnpm db:config`), NOT seeded here.
-- ---------------------------------------------------------------------------
create table public.game_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);
alter table public.game_config enable row level security;
create index game_config_updated_by_idx on public.game_config (updated_by);
comment on table public.game_config is 'Runtime balancing values, one JSON document per area. Source of defaults: src/config/balance.ts.';

-- Allowlist of config documents that clients may read (fees, tax rate, vault
-- size ...). Everything not listed stays server-only (simulation parameters).
create table public.game_config_public_keys (
  key        text primary key,
  created_at timestamptz not null default now()
);
alter table public.game_config_public_keys enable row level security;
comment on table public.game_config_public_keys is 'Keys of game_config that are readable by players. No FK on purpose: may be filled before the config seed.';

-- Server-only key/value settings (fallback for Supabase Vault, e.g. edge
-- function base URL for local/self-hosted setups).
create table public.internal_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.internal_settings enable row level security;
comment on table public.internal_settings is 'Server-only settings (service_role). Fallback when Supabase Vault is unavailable.';

-- Typed config readers. p_path addresses a value inside the JSON document.
create or replace function public.config_jsonb(p_key text, p_path text[] default '{}')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select c.value #> p_path from public.game_config c where c.key = p_key;
$$;

create or replace function public.config_bigint(p_key text, p_path text[], p_fallback bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := public.config_jsonb(p_key, p_path);
  if v is null or jsonb_typeof(v) not in ('number', 'string') then
    return p_fallback;
  end if;
  begin
    return round((v #>> '{}')::numeric)::bigint;
  exception when others then
    return p_fallback;
  end;
end;
$$;

create or replace function public.config_boolean(p_key text, p_path text[], p_fallback boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := public.config_jsonb(p_key, p_path);
  if v is null or jsonb_typeof(v) <> 'boolean' then
    return p_fallback;
  end if;
  return (v #>> '{}')::boolean;
end;
$$;

-- ---------------------------------------------------------------------------
-- sim_runtime: singleton with the tick-runner lease, tick counter, admin time
-- offset (ADR-006) and the game epoch. Service role only.
-- ---------------------------------------------------------------------------
create table public.sim_runtime (
  id               boolean primary key default true check (id),
  lease_holder     uuid,
  lease_expires_at timestamptz,
  tick_seq         bigint not null default 0,
  last_tick_at     timestamptz,
  time_offset      interval not null default interval '0',
  game_epoch_date  date,
  is_paused        boolean not null default false,
  state            jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.sim_runtime enable row level security;
insert into public.sim_runtime (id) values (true);
comment on table public.sim_runtime is 'Singleton: runner lease, tick sequence, admin time offset, game epoch. Internal.';
comment on column public.sim_runtime.game_epoch_date is 'Berlin game day (08:00-08:00) that is game year 1. Set by the first ensure_game_quarters() call.';

-- Seedable RNG streams so that ticks are reproducible (ADR-012).
create table public.sim_rng_streams (
  stream_key text primary key,
  seed       bigint not null,
  state      jsonb not null default '{}'::jsonb,
  draws      bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.sim_rng_streams enable row level security;
comment on table public.sim_rng_streams is 'Persisted PRNG state per stream (market, events, hr, ...). Internal.';

-- Tick log for monitoring (retention: prune rows older than 7 days).
create table public.sim_tick_log (
  tick_seq           bigint primary key,
  runner_id          uuid,
  started_at         timestamptz not null default now(),
  duration_ms        integer,
  securities_updated integer,
  orders_filled      integer,
  error              text
);
alter table public.sim_tick_log enable row level security;
create index sim_tick_log_started_at_idx on public.sim_tick_log (started_at desc);
comment on table public.sim_tick_log is 'One row per market tick for monitoring. Internal, short retention.';

-- Idempotent bookkeeping for scheduled jobs (quarter close, daily reset ...).
create table public.job_runs (
  id          bigint generated always as identity primary key,
  job_name    text not null,
  run_key     text not null,
  status      public.job_run_status not null default 'running',
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  details     jsonb not null default '{}'::jsonb,
  error       text,
  unique (job_name, run_key)
);
alter table public.job_runs enable row level security;
comment on table public.job_runs is 'Exactly-once guard for cron driven jobs: (job_name, run_key) is unique. Internal.';

-- Public market status singleton (phase, last tick) for clients.
create table public.market_status (
  id            boolean primary key default true check (id),
  phase         public.market_phase not null default 'closed',
  phase_changed_at timestamptz not null default now(),
  next_open_at  timestamptz,
  next_close_at timestamptz,
  tick_seq      bigint not null default 0,
  last_tick_at  timestamptz,
  is_halted     boolean not null default false,
  halt_reason   text,
  updated_at    timestamptz not null default now()
);
alter table public.market_status enable row level security;
insert into public.market_status (id) values (true);
comment on table public.market_status is 'Singleton with the public market phase (08-22 Europe/Berlin) and last tick. Written by the tick runner.';

-- ---------------------------------------------------------------------------
-- Game time
-- ---------------------------------------------------------------------------
create table public.game_quarters (
  id               bigint generated always as identity primary key,
  game_year        integer not null,
  quarter          smallint not null check (quarter between 1 and 4),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           public.quarter_status not null default 'scheduled',
  close_started_at timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (game_year, quarter),
  unique (starts_at),
  check (ends_at > starts_at),
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
);
alter table public.game_quarters enable row level security;
create index game_quarters_ends_at_idx on public.game_quarters (ends_at);
create index game_quarters_status_idx on public.game_quarters (status) where status <> 'closed';
comment on table public.game_quarters is 'Explicit game calendar (ADR-006). Game time is always read from here, never computed from the clock.';

-- Current game time = wall clock + admin offset.
create or replace function public.game_now()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select now() + coalesce((select r.time_offset from public.sim_runtime r), interval '0');
$$;
comment on function public.game_now() is 'Wall clock plus the admin time offset from sim_runtime.';

create or replace function public.current_game_quarter()
returns public.game_quarters
language sql
stable
security definer
set search_path = ''
as $$
  select q.*
  from public.game_quarters q
  where q.starts_at <= public.game_now()
    and q.ends_at   >  public.game_now()
  limit 1;
$$;
comment on function public.current_game_quarter() is 'The game_quarters row that contains game_now(); NULL row if the calendar is not initialised.';

-- Berlin "game day": the day a quarter cycle (08:00 -> next 08:00) belongs to.
create or replace function public.game_day(p_at timestamptz default null)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select ((coalesce(p_at, public.game_now()) at time zone 'Europe/Berlin') - interval '8 hours')::date;
$$;
comment on function public.game_day(timestamptz) is 'Game day (one game year) for a timestamp: Berlin date of (t - 8h).';

-- Creates the upcoming quarters on Europe/Berlin wall-clock boundaries
-- 08:00 (Q1), 14:00 (Q2), 20:00 (Q3), 02:00 (Q4). Because both starts_at and
-- ends_at are derived from local wall-clock times, DST days automatically get
-- one 5h/7h quarter. Idempotent; returns the number of rows created.
create or replace function public.ensure_game_quarters(p_days_ahead integer default 3)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tz      constant text := 'Europe/Berlin';
  v_today   date;
  v_epoch   date;
  v_day     date;
  v_q       integer;
  v_start   timestamptz;
  v_end     timestamptz;
  v_rows    integer;
  v_created integer := 0;
begin
  if p_days_ahead is null or p_days_ahead < 0 or p_days_ahead > 366 then
    raise exception 'p_days_ahead must be between 0 and 366' using errcode = 'NX007';
  end if;

  v_today := public.game_day();

  -- Serialise concurrent callers and fix the epoch on first use.
  select r.game_epoch_date into v_epoch from public.sim_runtime r where r.id for update;
  if v_epoch is null then
    v_epoch := v_today;
    update public.sim_runtime set game_epoch_date = v_epoch where id;
  end if;

  for v_day in
    select d::date from generate_series(greatest(v_today, v_epoch)::timestamp,
                                        (v_today + p_days_ahead)::timestamp,
                                        interval '1 day') as g(d)
  loop
    for v_q in 1..4 loop
      v_start := (v_day::timestamp + make_interval(hours => 8 + 6 * (v_q - 1))) at time zone c_tz;
      v_end   := (v_day::timestamp + make_interval(hours => 8 + 6 * v_q))       at time zone c_tz;
      insert into public.game_quarters (game_year, quarter, starts_at, ends_at)
      values ((v_day - v_epoch) + 1, v_q, v_start, v_end)
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;
    end loop;
  end loop;

  -- Mark the running quarter as active (close_quarter() owns the later states).
  update public.game_quarters q
     set status = 'active'
   where q.status = 'scheduled'
     and q.starts_at <= public.game_now()
     and q.ends_at   >  public.game_now();

  return v_created;
end;
$$;
comment on function public.ensure_game_quarters(integer) is 'Idempotently creates game_quarters rows for today and the next p_days_ahead game days.';
