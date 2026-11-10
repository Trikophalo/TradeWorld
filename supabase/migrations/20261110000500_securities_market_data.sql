-- =============================================================================
-- NEXA · 0500 · Sectors, securities, quotes, ticks, candles, index, macro,
--               simulation-internal market state
-- =============================================================================

create table public.sectors (
  key                text primary key,
  name               text not null,
  description        text not null,
  icon_key           text not null,
  typical_risk       text,
  base_pe            double precision not null check (base_pe > 0),
  base_demand_cents  bigint not null check (base_demand_cents >= 0),
  demand_growth_bps  integer not null default 0,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.sectors enable row level security;
comment on table public.sectors is 'The five industries. base_demand_cents = quarterly sector demand shared by all companies of the sector.';

-- Internal per-sector simulation state (shocks, current demand multiplier).
create table public.sector_sim_state (
  sector_key         text primary key references public.sectors (key) on delete cascade,
  demand_multiplier  double precision not null default 1,
  cost_multiplier    double precision not null default 1,
  sentiment          double precision not null default 0,
  state              jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);
alter table public.sector_sim_state enable row level security;
comment on table public.sector_sim_state is 'Hidden sector shocks and multipliers. Internal.';

create table public.securities (
  id            uuid primary key default gen_random_uuid(),
  kind          public.security_kind not null,
  ticker        text not null check (ticker ~ '^[A-Z0-9]{2,8}$'),
  name          text not null,
  company_id    uuid,
  sector_key    text references public.sectors (key),
  status        public.security_status not null default 'pending',
  tick_size_e4  bigint not null default 100 check (tick_size_e4 > 0),
  is_tradable   boolean not null default true,
  is_shortable  boolean not null default true,
  max_leverage  smallint not null default 10 check (max_leverage between 1 and 10),
  listed_at     timestamptz,
  delisted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (ticker)
);
alter table public.securities enable row level security;
create index securities_company_idx on public.securities (company_id) where company_id is not null;
create index securities_sector_idx on public.securities (sector_key);
create index securities_kind_status_idx on public.securities (kind, status);
comment on table public.securities is 'Everything that has a price: stocks, government bonds, indices, later options/commodities.';
comment on column public.securities.company_id is 'Issuer for stocks; FK added in the companies migration.';

create table public.bonds (
  security_id      uuid primary key references public.securities (id) on delete cascade,
  issuer           text not null default 'state',
  series           text not null,
  term_game_years  smallint not null check (term_game_years > 0),
  coupon_bps       integer not null check (coupon_bps >= 0),
  face_value_cents bigint not null default 10000 check (face_value_cents > 0),
  rating           text not null default 'AAA',
  default_risk_bps integer not null default 0,
  issued_at        timestamptz not null,
  matures_at       timestamptz not null,
  is_benchmark     boolean not null default true,
  successor_security_id uuid references public.securities (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (matures_at > issued_at)
);
alter table public.bonds enable row level security;
create index bonds_matures_at_idx on public.bonds (matures_at);
create index bonds_successor_idx on public.bonds (successor_security_id);
comment on table public.bonds is 'Bond terms. Coupons are paid per quarter (coupon_bps is per game year), redemption at matures_at.';

-- Placeholder for level-30 options (M7+).
create table public.option_contracts (
  security_id            uuid primary key references public.securities (id) on delete cascade,
  underlying_security_id uuid not null references public.securities (id),
  option_type            public.option_type not null,
  strike_e4              bigint not null check (strike_e4 > 0),
  contract_size          integer not null default 100 check (contract_size > 0),
  expires_at             timestamptz not null,
  settled_at             timestamptz,
  settlement_price_e4    bigint,
  created_at             timestamptz not null default now()
);
alter table public.option_contracts enable row level security;
create index option_contracts_underlying_idx on public.option_contracts (underlying_security_id, expires_at);
comment on table public.option_contracts is 'Placeholder: listed call/put contracts on stocks (cash settled).';

create table public.indices (
  security_id    uuid primary key references public.securities (id) on delete cascade,
  key            text not null unique,
  description    text,
  base_value_e4  bigint not null check (base_value_e4 > 0),
  divisor        double precision not null check (divisor > 0),
  max_members    integer not null default 30 check (max_members > 0),
  last_rebalanced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.indices enable row level security;
comment on table public.indices is 'Index definitions (NEXA 30). Level = sum(market cap of members) / divisor.';

create table public.index_memberships (
  id                 uuid primary key default gen_random_uuid(),
  index_security_id  uuid not null references public.indices (security_id) on delete cascade,
  member_security_id uuid not null references public.securities (id),
  weight_bps         integer not null default 0 check (weight_bps between 0 and 10000),
  joined_at          timestamptz not null default now(),
  left_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (left_at is null or left_at > joined_at)
);
alter table public.index_memberships enable row level security;
create unique index index_memberships_current_uq on public.index_memberships (index_security_id, member_security_id) where left_at is null;
create index index_memberships_index_idx on public.index_memberships (index_security_id, joined_at);
create index index_memberships_member_idx on public.index_memberships (member_security_id);
comment on table public.index_memberships is 'Current and historic index members. Joining is a market event (index funds must buy).';

-- ---------------------------------------------------------------------------
-- Live market data
-- ---------------------------------------------------------------------------
create table public.security_quotes (
  security_id       uuid primary key references public.securities (id) on delete cascade,
  last_price_e4     bigint not null check (last_price_e4 > 0),
  bid_e4            bigint check (bid_e4 > 0),
  ask_e4            bigint check (ask_e4 > 0),
  prev_close_e4     bigint,
  day_open_e4       bigint,
  day_high_e4       bigint,
  day_low_e4        bigint,
  day_volume        bigint not null default 0 check (day_volume >= 0),
  day_turnover_cents bigint not null default 0,
  change_bps        integer not null default 0,
  market_cap_cents  bigint,
  yield_bps         integer,
  tick_seq          bigint not null default 0,
  updated_at        timestamptz not null default now()
);
alter table public.security_quotes enable row level security;
comment on table public.security_quotes is 'One hot row per security with the latest quote. Updated every tick.';

-- Raw ticks: range-partitioned by day. Retention: maintain_price_tick_partitions()
-- creates future partitions and drops partitions older than the retention
-- (default 3 days); long-term history lives in candles.
create table public.price_ticks (
  security_id uuid not null references public.securities (id) on delete cascade,
  ts          timestamptz not null,
  tick_seq    bigint not null,
  price_e4    bigint not null check (price_e4 > 0),
  volume      bigint not null default 0 check (volume >= 0),
  primary key (security_id, ts)
) partition by range (ts);
alter table public.price_ticks enable row level security;
comment on table public.price_ticks is 'Raw price ticks (every 5 s), partitioned per day, short retention. Source for candles and the live chart.';

create table public.price_ticks_default partition of public.price_ticks default;
alter table public.price_ticks_default enable row level security;

create or replace function public.maintain_price_tick_partitions(
  p_days_ahead     integer default 3,
  p_retention_days integer default 3
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day     date;
  v_name    text;
  v_changed integer := 0;
  r         record;
begin
  -- create daily partitions (UTC day boundaries)
  for v_day in
    select d::date from generate_series((now() at time zone 'UTC')::date::timestamp,
                                        ((now() at time zone 'UTC')::date + p_days_ahead)::timestamp,
                                        interval '1 day') as g(d)
  loop
    v_name := 'price_ticks_' || to_char(v_day, 'YYYYMMDD');
    if to_regclass('public.' || v_name) is null then
      execute format(
        'create table public.%I partition of public.price_ticks for values from (%L) to (%L)',
        v_name, (v_day::text || ' 00:00:00+00'), ((v_day + 1)::text || ' 00:00:00+00'));
      execute format('alter table public.%I enable row level security', v_name);
      execute format('revoke all on public.%I from public, anon, authenticated', v_name);
      execute format('grant all on public.%I to service_role', v_name);
      v_changed := v_changed + 1;
    end if;
  end loop;

  -- drop expired partitions
  for r in
    select c.relname
      from pg_catalog.pg_inherits i
      join pg_catalog.pg_class c on c.oid = i.inhrelid
      join pg_catalog.pg_class p on p.oid = i.inhparent
      join pg_catalog.pg_namespace n on n.oid = p.relnamespace
     where n.nspname = 'public' and p.relname = 'price_ticks'
       and c.relname ~ '^price_ticks_[0-9]{8}$'
       and to_date(substr(c.relname, 13), 'YYYYMMDD') < (now() at time zone 'UTC')::date - p_retention_days
  loop
    execute format('drop table public.%I', r.relname);
    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$;
comment on function public.maintain_price_tick_partitions(integer, integer) is 'Creates upcoming daily price_ticks partitions and drops expired ones. Scheduled daily via pg_cron.';

do $$ begin perform public.maintain_price_tick_partitions(); end $$;

create table public.candles (
  security_id    uuid not null references public.securities (id) on delete cascade,
  interval       public.candle_interval not null,
  bucket_start   timestamptz not null,
  open_e4        bigint not null,
  high_e4        bigint not null,
  low_e4         bigint not null,
  close_e4       bigint not null,
  volume         bigint not null default 0,
  turnover_cents bigint not null default 0,
  tick_count     integer not null default 0,
  primary key (security_id, interval, bucket_start),
  check (high_e4 >= low_e4 and high_e4 >= open_e4 and high_e4 >= close_e4 and low_e4 <= open_e4 and low_e4 <= close_e4)
);
alter table public.candles enable row level security;
comment on table public.candles is 'OHLCV candles aggregated server side from ticks (1m, 5m, 1h, 1 quarter, 1 game year). Retention: 1m 7 days, 5m 30 days, rest unlimited.';

-- Order book snapshot (ADR-005): synthetic market-maker levels merged with
-- aggregated player limit orders. Written by the tick; no player identities.
create table public.order_book_levels (
  security_id uuid not null references public.securities (id) on delete cascade,
  side        public.book_side not null,
  level       smallint not null check (level between 1 and 20),
  price_e4    bigint not null check (price_e4 > 0),
  quantity    bigint not null check (quantity >= 0),
  updated_at  timestamptz not null default now(),
  primary key (security_id, side, level)
);
alter table public.order_book_levels enable row level security;
comment on table public.order_book_levels is 'Public aggregated order book depth per security. Contains no player identities.';

create table public.analyst_ratings (
  id              uuid primary key default gen_random_uuid(),
  security_id     uuid not null references public.securities (id) on delete cascade,
  analyst_name    text not null,
  rating          public.analyst_rating_kind not null,
  target_price_e4 bigint not null check (target_price_e4 > 0),
  summary         text,
  game_quarter_id bigint references public.game_quarters (id),
  published_at    timestamptz not null default now(),
  valid_until     timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.analyst_ratings enable row level security;
create index analyst_ratings_security_idx on public.analyst_ratings (security_id, published_at desc);
create index analyst_ratings_quarter_idx on public.analyst_ratings (game_quarter_id);
comment on table public.analyst_ratings is 'Analyst price targets (sometimes wrong on purpose). Readable from the level-7 unlock.';

-- ---------------------------------------------------------------------------
-- Macro: central bank, indicators
-- ---------------------------------------------------------------------------
create table public.central_bank_state (
  id               boolean primary key default true check (id),
  policy_rate_bps  integer not null check (policy_rate_bps between 0 and 5000),
  last_decision_at timestamptz,
  next_decision_at timestamptz,
  updated_at       timestamptz not null default now()
);
alter table public.central_bank_state enable row level security;
comment on table public.central_bank_state is 'Singleton with the current policy rate (start: 300 bps).';

create table public.central_bank_decisions (
  id                        bigint generated always as identity primary key,
  game_quarter_id           bigint references public.game_quarters (id),
  previous_rate_bps         integer not null,
  new_rate_bps              integer not null,
  money_supply_cents        bigint,
  money_supply_target_cents bigint,
  statement                 text,
  decided_at                timestamptz not null default now()
);
alter table public.central_bank_decisions enable row level security;
create index central_bank_decisions_quarter_idx on public.central_bank_decisions (game_quarter_id);
create index central_bank_decisions_decided_idx on public.central_bank_decisions (decided_at desc);
comment on table public.central_bank_decisions is 'History of rate decisions with the money supply that drove them.';

create table public.money_supply_snapshots (
  game_quarter_id   bigint primary key references public.game_quarters (id),
  player_cents      bigint not null,
  company_cents     bigint not null,
  minted_cents      bigint not null default 0,
  burned_cents      bigint not null default 0,
  by_system_account jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);
alter table public.money_supply_snapshots enable row level security;
comment on table public.money_supply_snapshots is 'Per-quarter money supply and source/sink flows from the ledger. Internal (admin dashboards, central bank AI).';

create table public.macro_indicators (
  key         text primary key,
  name        text not null,
  unit        text not null,
  value       double precision not null,
  prev_value  double precision,
  description text,
  updated_at  timestamptz not null default now()
);
alter table public.macro_indicators enable row level security;
comment on table public.macro_indicators is 'Public macro values (oil price, consumer confidence ...) that link sectors.';

create table public.macro_indicator_history (
  indicator_key text not null references public.macro_indicators (key) on delete cascade,
  ts            timestamptz not null,
  value         double precision not null,
  primary key (indicator_key, ts)
);
alter table public.macro_indicator_history enable row level security;
comment on table public.macro_indicator_history is 'Time series of macro indicators.';

-- ---------------------------------------------------------------------------
-- Simulation internals (service role only; players must never see the anchor)
-- ---------------------------------------------------------------------------
create table public.security_sim_state (
  security_id        uuid primary key references public.securities (id) on delete cascade,
  fair_value_e4      bigint not null check (fair_value_e4 > 0),
  sentiment          double precision not null default 0,
  momentum           double precision not null default 0,
  volatility         double precision not null default 0.01 check (volatility >= 0),
  liquidity_shares   bigint not null default 100000 check (liquidity_shares > 0),
  spread_bps         integer not null default 10 check (spread_bps >= 0),
  pending_player_flow bigint not null default 0,
  state              jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);
alter table public.security_sim_state enable row level security;
comment on table public.security_sim_state is 'Hidden price anchor: fair value, sentiment, momentum, liquidity. Internal.';
comment on column public.security_sim_state.pending_player_flow is 'Net player order flow (shares) since the last tick; feeds the price impact.';

create table public.ai_investors (
  key          text primary key,
  name         text not null,
  description  text not null,
  params       jsonb not null default '{}'::jsonb,
  cash_cents   bigint not null default 0,
  is_active    boolean not null default true,
  state        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.ai_investors enable row level security;
comment on table public.ai_investors is 'AI investor archetypes (ADR-005) with strategy parameters and aggregated cash. Internal.';

create table public.ai_investor_holdings (
  investor_key  text not null references public.ai_investors (key) on delete cascade,
  security_id   uuid not null references public.securities (id) on delete cascade,
  quantity      bigint not null default 0,
  avg_price_e4  bigint not null default 0,
  target_weight_bps integer,
  updated_at    timestamptz not null default now(),
  primary key (investor_key, security_id)
);
alter table public.ai_investor_holdings enable row level security;
create index ai_investor_holdings_security_idx on public.ai_investor_holdings (security_id);
comment on table public.ai_investor_holdings is 'Aggregated holdings per AI investor type and security. Internal.';
