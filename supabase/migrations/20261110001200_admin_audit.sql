-- =============================================================================
-- NEXA · 1200 · Admin actions, rate limiting, idempotent requests,
--               abuse logging
-- =============================================================================

create table public.admin_actions (
  id          bigint generated always as identity primary key,
  admin_id    uuid references auth.users (id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.admin_actions enable row level security;
create index admin_actions_admin_idx on public.admin_actions (admin_id, created_at desc);
create index admin_actions_created_idx on public.admin_actions (created_at desc);
comment on table public.admin_actions is 'Append-only audit log of admin operations (config change, event trigger, time travel, player reset).';

create trigger admin_actions_immutable
  before update or delete on public.admin_actions
  for each row execute function public.prevent_mutation();

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window counters)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  player_id    uuid not null references public.profiles (id) on delete cascade,
  action       text not null,
  window_start timestamptz not null,
  hits         integer not null default 1 check (hits > 0),
  primary key (player_id, action, window_start)
);
alter table public.rate_limits enable row level security;
create index rate_limits_window_idx on public.rate_limits (window_start);
comment on table public.rate_limits is 'Fixed-window counters per player and action. Internal; old windows are pruned by cron.';

-- Counts one hit and returns true while the caller is within the limit.
create or replace function public.rate_limit_hit(
  p_player_id      uuid,
  p_action         text,
  p_max_hits       integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  if p_max_hits is null or p_max_hits < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'invalid rate limit parameters' using errcode = 'NX007';
  end if;
  v_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (player_id, action, window_start, hits)
  values (p_player_id, p_action, v_window, 1)
  on conflict (player_id, action, window_start)
  do update set hits = r.hits + 1
  returning r.hits into v_hits;

  return v_hits <= p_max_hits;
end;
$$;
comment on function public.rate_limit_hit(uuid, text, integer, integer) is 'Internal: registers a hit; false when the fixed window limit is exceeded.';

create table public.suspicious_activity (
  id                bigint generated always as identity primary key,
  player_id         uuid references public.profiles (id) on delete cascade,
  related_player_id uuid references public.profiles (id) on delete set null,
  kind              public.suspicious_kind not null,
  severity          smallint not null default 1 check (severity between 1 and 5),
  details           jsonb not null default '{}'::jsonb,
  ref_type          text,
  ref_id            uuid,
  reviewed_by       uuid references auth.users (id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now()
);
alter table public.suspicious_activity enable row level security;
create index suspicious_activity_player_idx on public.suspicious_activity (player_id, created_at desc);
create index suspicious_activity_related_idx on public.suspicious_activity (related_player_id);
create index suspicious_activity_kind_idx on public.suspicious_activity (kind, created_at desc);
create index suspicious_activity_reviewed_by_idx on public.suspicious_activity (reviewed_by);
create index suspicious_activity_unreviewed_idx on public.suspicious_activity (created_at desc) where reviewed_at is null;
comment on table public.suspicious_activity is 'Log of suspicious patterns (wash trading, multi accounts, rate limit hits). Internal.';

-- Enforcing variant: raises NX004 and logs the hit as suspicious activity
-- is left to the caller (a raise would roll the log entry back).
create or replace function public.rate_limit_enforce(
  p_player_id      uuid,
  p_action         text,
  p_max_hits       integer,
  p_window_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.rate_limit_hit(p_player_id, p_action, p_max_hits, p_window_seconds) then
    raise exception 'rate limit exceeded for action "%"', p_action using errcode = 'NX004';
  end if;
end;
$$;
comment on function public.rate_limit_enforce(uuid, text, integer, integer) is 'Internal: like rate_limit_hit() but raises SQLSTATE NX004 when the limit is exceeded.';

-- ---------------------------------------------------------------------------
-- Generic idempotency journal for player actions that have no own table
-- with (player_id, request_id) (e.g. claim_daily_login, equip_cosmetic).
-- ---------------------------------------------------------------------------
create table public.player_requests (
  player_id    uuid not null references public.profiles (id) on delete cascade,
  request_id   uuid not null,
  action       text not null,
  result       jsonb,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  primary key (player_id, request_id)
);
alter table public.player_requests enable row level security;
create index player_requests_created_idx on public.player_requests (created_at);
comment on table public.player_requests is 'Idempotency journal: one row per (player, client request_id) with the stored RPC result. Internal; pruned after 7 days.';

-- Returns NULL when the request is new (caller proceeds and later calls
-- request_complete), or the stored result when it was already processed.
create or replace function public.request_begin(p_player_id uuid, p_request_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.player_requests;
begin
  if p_request_id is null then
    raise exception 'request_id is required' using errcode = 'NX007';
  end if;

  insert into public.player_requests (player_id, request_id, action)
  values (p_player_id, p_request_id, p_action)
  on conflict (player_id, request_id) do nothing;
  if found then
    return null;
  end if;

  select r.* into v_row
    from public.player_requests r
   where r.player_id = p_player_id and r.request_id = p_request_id;
  if v_row.action is distinct from p_action then
    raise exception 'request_id was already used for action "%"', v_row.action using errcode = 'NX007';
  end if;
  if v_row.completed_at is null then
    raise exception 'request % is still in progress', p_request_id using errcode = 'NX009';
  end if;
  return coalesce(v_row.result, 'null'::jsonb);
end;
$$;
comment on function public.request_begin(uuid, uuid, text) is 'Internal: idempotency gate. NULL = new request; otherwise the stored result of the first execution.';

create or replace function public.request_complete(p_player_id uuid, p_request_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.player_requests
     set result = p_result, completed_at = now()
   where player_id = p_player_id and request_id = p_request_id;
  return p_result;
end;
$$;
comment on function public.request_complete(uuid, uuid, jsonb) is 'Internal: stores the result of an idempotent request.';

-- Hashed login fingerprints for later multi-account detection.
create table public.player_login_events (
  id              bigint generated always as identity primary key,
  player_id       uuid not null references public.profiles (id) on delete cascade,
  ip_hash         text,
  user_agent_hash text,
  device_hash     text,
  created_at      timestamptz not null default now()
);
alter table public.player_login_events enable row level security;
create index player_login_events_player_idx on public.player_login_events (player_id, created_at desc);
create index player_login_events_ip_idx on public.player_login_events (ip_hash) where ip_hash is not null;
create index player_login_events_device_idx on public.player_login_events (device_hash) where device_hash is not null;
comment on table public.player_login_events is 'Salted hashes of IP/user agent/device per login (no raw data). Internal; retention 90 days.';
