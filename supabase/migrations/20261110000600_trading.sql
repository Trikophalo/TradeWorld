-- =============================================================================
-- NEXA · 0600 · Orders, trades, positions, margin, taxes, distributions,
--               watchlist, portfolio history
-- =============================================================================

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  player_id          uuid not null references public.profiles (id) on delete cascade,
  security_id        uuid not null references public.securities (id),
  request_id         uuid not null,
  source             public.order_source not null default 'player',
  side               public.order_side not null,
  position_side      public.position_side not null default 'long',
  type               public.order_type not null,
  time_in_force      public.time_in_force not null default 'gtc',
  quantity           bigint not null check (quantity > 0),
  filled_quantity    bigint not null default 0 check (filled_quantity >= 0),
  limit_price_e4     bigint check (limit_price_e4 > 0),
  stop_price_e4      bigint check (stop_price_e4 > 0),
  leverage           smallint not null default 1 check (leverage in (1, 2, 5, 10)),
  status             public.order_status not null default 'pending',
  reserved_cents     bigint not null default 0 check (reserved_cents >= 0),
  reserved_quantity  bigint not null default 0 check (reserved_quantity >= 0),
  avg_fill_price_e4  bigint,
  fee_cents          bigint not null default 0 check (fee_cents >= 0),
  reject_reason      text,
  triggered_at       timestamptz,
  expires_at         timestamptz,
  cancelled_at       timestamptz,
  filled_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (player_id, request_id),
  check (filled_quantity <= quantity),
  check (type <> 'limit' or limit_price_e4 is not null),
  check (type <> 'stop'  or stop_price_e4 is not null),
  check (type <> 'market' or (limit_price_e4 is null and stop_price_e4 is null))
);
alter table public.orders enable row level security;
create index orders_player_status_idx on public.orders (player_id, status, created_at desc);
create index orders_player_created_idx on public.orders (player_id, created_at desc);
create index orders_security_idx on public.orders (security_id, created_at desc);
-- matching: best price first, then time priority
create index orders_open_limit_book_idx on public.orders (security_id, side, limit_price_e4, created_at)
  where type = 'limit' and status in ('open', 'partially_filled');
create index orders_open_stop_idx on public.orders (security_id, side, stop_price_e4)
  where type = 'stop' and status = 'open';
create index orders_expiry_idx on public.orders (expires_at)
  where expires_at is not null and status in ('open', 'partially_filled');
comment on table public.orders is 'Player orders. side + position_side express intent: buy/long = open long, sell/long = close long, sell/short = open short, buy/short = cover.';
comment on column public.orders.request_id is 'Client generated idempotency key, unique per player.';

create table public.positions (
  id                     uuid primary key default gen_random_uuid(),
  player_id              uuid not null references public.profiles (id) on delete cascade,
  security_id            uuid not null references public.securities (id),
  side                   public.position_side not null default 'long',
  leverage               smallint not null default 1 check (leverage in (1, 2, 5, 10)),
  status                 public.position_status not null default 'open',
  quantity               bigint not null check (quantity >= 0),
  reserved_quantity      bigint not null default 0 check (reserved_quantity >= 0),
  avg_entry_price_e4     bigint not null check (avg_entry_price_e4 >= 0),
  cost_basis_cents       bigint not null default 0,
  margin_cents           bigint not null default 0 check (margin_cents >= 0),
  borrowed_cents         bigint not null default 0 check (borrowed_cents >= 0),
  liquidation_price_e4   bigint,
  realized_pnl_cents     bigint not null default 0,
  accrued_financing_cents bigint not null default 0,
  last_financing_at      timestamptz,
  opened_at              timestamptz not null default now(),
  closed_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (reserved_quantity <= quantity)
);
alter table public.positions enable row level security;
create unique index positions_open_uq on public.positions (player_id, security_id, side, leverage) where status = 'open';
create index positions_player_status_idx on public.positions (player_id, status);
create index positions_security_open_idx on public.positions (security_id) where status = 'open';
create index positions_liquidation_idx on public.positions (security_id, liquidation_price_e4)
  where status = 'open' and liquidation_price_e4 is not null;
comment on table public.positions is 'Holdings per player, security, direction and leverage (stocks, bonds, later options). Owner only; friends see portfolios via RPC.';

create table public.trades (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders (id),
  player_id             uuid not null references public.profiles (id) on delete cascade,
  security_id           uuid not null references public.securities (id),
  position_id           uuid references public.positions (id),
  side                  public.order_side not null,
  position_side         public.position_side not null default 'long',
  quantity              bigint not null check (quantity > 0),
  price_e4              bigint not null check (price_e4 > 0),
  gross_cents           bigint not null check (gross_cents >= 0),
  fee_cents             bigint not null default 0 check (fee_cents >= 0),
  tax_cents             bigint not null default 0,
  realized_pnl_cents    bigint,
  counterparty          public.trade_counterparty not null default 'market_maker',
  counterparty_order_id uuid references public.orders (id),
  ledger_transaction_id uuid references public.ledger_transactions (id),
  tick_seq              bigint,
  is_wash_trade         boolean not null default false,
  xp_awarded            integer not null default 0,
  executed_at           timestamptz not null default now()
);
alter table public.trades enable row level security;
create index trades_player_executed_idx on public.trades (player_id, executed_at desc);
create index trades_security_executed_idx on public.trades (security_id, executed_at desc);
create index trades_order_idx on public.trades (order_id);
create index trades_position_idx on public.trades (position_id);
create index trades_counterparty_order_idx on public.trades (counterparty_order_id) where counterparty_order_id is not null;
create index trades_ledger_tx_idx on public.trades (ledger_transaction_id);
-- wash-trade detection: recent trades of a player in one security
create index trades_player_security_executed_idx on public.trades (player_id, security_id, executed_at desc);
comment on table public.trades is 'Executions (fills). gross_cents = round_half_even(quantity * price_e4 / 100) per ADR-003. Immutable.';

create trigger trades_immutable
  before update or delete on public.trades
  for each row execute function public.prevent_mutation();

-- FIFO lots for tax, holding-period achievements and wash-trade checks.
create table public.position_lots (
  id               bigint generated always as identity primary key,
  position_id      uuid not null references public.positions (id) on delete cascade,
  player_id        uuid not null references public.profiles (id) on delete cascade,
  security_id      uuid not null references public.securities (id),
  trade_id         uuid references public.trades (id),
  quantity_initial bigint not null check (quantity_initial > 0),
  quantity_open    bigint not null check (quantity_open >= 0),
  price_e4         bigint not null check (price_e4 >= 0),
  acquired_at      timestamptz not null default now(),
  closed_at        timestamptz,
  check (quantity_open <= quantity_initial)
);
alter table public.position_lots enable row level security;
create index position_lots_position_idx on public.position_lots (position_id, acquired_at);
create index position_lots_player_idx on public.position_lots (player_id, security_id);
create index position_lots_security_idx on public.position_lots (security_id);
create index position_lots_trade_idx on public.position_lots (trade_id);
comment on table public.position_lots is 'Acquisition lots (FIFO) behind a position.';

create table public.margin_events (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references public.profiles (id) on delete cascade,
  position_id      uuid not null references public.positions (id) on delete cascade,
  level            public.margin_event_level not null,
  mark_price_e4    bigint not null,
  liquidation_price_e4 bigint,
  equity_ratio_bps integer,
  liquidation_order_id uuid references public.orders (id),
  loss_cents       bigint,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
alter table public.margin_events enable row level security;
create index margin_events_player_idx on public.margin_events (player_id, created_at desc);
create index margin_events_position_idx on public.margin_events (position_id);
create index margin_events_order_idx on public.margin_events (liquidation_order_id);
comment on table public.margin_events is 'Margin warnings, margin calls and forced liquidations.';

create table public.financing_charges (
  id                    bigint generated always as identity primary key,
  position_id           uuid not null references public.positions (id) on delete cascade,
  player_id             uuid not null references public.profiles (id) on delete cascade,
  kind                  public.financing_kind not null,
  charge_date           date not null,
  base_cents            bigint not null,
  rate_bps              integer not null,
  amount_cents          bigint not null check (amount_cents >= 0),
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at            timestamptz not null default now(),
  unique (position_id, kind, charge_date)
);
alter table public.financing_charges enable row level security;
create index financing_charges_player_idx on public.financing_charges (player_id, charge_date desc);
create index financing_charges_ledger_tx_idx on public.financing_charges (ledger_transaction_id);
comment on table public.financing_charges is 'Overnight financing of leveraged positions and short borrow fees (one row per position, kind and day).';

-- Capital gains tax with loss offsetting per game year.
create table public.player_tax_years (
  player_id               uuid not null references public.profiles (id) on delete cascade,
  game_year               integer not null,
  realized_gains_cents    bigint not null default 0 check (realized_gains_cents >= 0),
  realized_losses_cents   bigint not null default 0 check (realized_losses_cents >= 0),
  loss_carry_in_cents     bigint not null default 0 check (loss_carry_in_cents >= 0),
  tax_paid_cents          bigint not null default 0,
  updated_at              timestamptz not null default now(),
  primary key (player_id, game_year)
);
alter table public.player_tax_years enable row level security;
comment on table public.player_tax_years is 'Tax pot per player and game year: gains, losses, carry-forward, tax paid (25 % default).';

-- ---------------------------------------------------------------------------
-- Distributions: dividends, bond coupons, redemptions
-- ---------------------------------------------------------------------------
create table public.security_distributions (
  id                 uuid primary key default gen_random_uuid(),
  security_id        uuid not null references public.securities (id),
  kind               public.distribution_kind not null,
  game_quarter_id    bigint references public.game_quarters (id),
  amount_per_unit_e4 bigint not null check (amount_per_unit_e4 >= 0),
  status             public.distribution_status not null default 'declared',
  declared_at        timestamptz not null default now(),
  ex_at              timestamptz,
  pay_at             timestamptz,
  paid_at            timestamptz,
  total_paid_cents   bigint,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (security_id, kind, game_quarter_id)
);
alter table public.security_distributions enable row level security;
create index security_distributions_status_pay_idx on public.security_distributions (status, pay_at);
create index security_distributions_quarter_idx on public.security_distributions (game_quarter_id);
comment on table public.security_distributions is 'Declared dividends (with ex date), bond coupons and redemptions. Paid at quarter close.';

create table public.distribution_payouts (
  id                    bigint generated always as identity primary key,
  distribution_id       uuid not null references public.security_distributions (id) on delete cascade,
  player_id             uuid not null references public.profiles (id) on delete cascade,
  quantity              bigint not null,
  gross_cents           bigint not null,
  tax_cents             bigint not null default 0,
  net_cents             bigint not null,
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at            timestamptz not null default now(),
  unique (distribution_id, player_id)
);
alter table public.distribution_payouts enable row level security;
create index distribution_payouts_player_idx on public.distribution_payouts (player_id, created_at desc);
create index distribution_payouts_ledger_tx_idx on public.distribution_payouts (ledger_transaction_id);
comment on table public.distribution_payouts is 'Per-player payout of a distribution (short positions pay: negative amounts).';

-- ---------------------------------------------------------------------------
-- Watchlist: direct client writes allowed (no game effect)
-- ---------------------------------------------------------------------------
create table public.watchlist_items (
  player_id   uuid not null references public.profiles (id) on delete cascade,
  security_id uuid not null references public.securities (id) on delete cascade,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (player_id, security_id)
);
alter table public.watchlist_items enable row level security;
create index watchlist_items_security_idx on public.watchlist_items (security_id);
comment on table public.watchlist_items is 'Personal watchlist. Owner may insert/update/delete directly (optimistic UI).';

-- ---------------------------------------------------------------------------
-- Portfolio value history (charts 1D/1W/1M/all, league baselines)
-- ---------------------------------------------------------------------------
create table public.portfolio_snapshots (
  player_id          uuid not null references public.profiles (id) on delete cascade,
  granularity        public.snapshot_granularity not null,
  taken_at           timestamptz not null,
  net_worth_cents    bigint not null,
  cash_cents         bigint not null,
  stocks_cents       bigint not null default 0,
  bonds_cents        bigint not null default 0,
  short_liability_cents bigint not null default 0,
  margin_debt_cents  bigint not null default 0,
  company_equity_cents bigint not null default 0,
  primary key (player_id, granularity, taken_at)
);
alter table public.portfolio_snapshots enable row level security;
comment on table public.portfolio_snapshots is 'Periodic net worth snapshots. Retention: 5m 2 days, 1h 30 days, 1d unlimited.';
