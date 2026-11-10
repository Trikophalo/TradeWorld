-- =============================================================================
-- NEXA · 0800 · Business angels, IPO (prospectus, bookbuilding, subscriptions),
--               guidance, corporate actions, shareholder votes, reputation,
--               insider rule
-- =============================================================================

create table public.angel_offers (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  direction          public.angel_offer_direction not null,
  created_by         uuid references public.profiles (id) on delete set null,
  investor_player_id uuid references public.profiles (id) on delete cascade,
  ai_investor_key    text references public.ai_investors (key),
  request_id         uuid not null,
  shares             bigint not null check (shares > 0),
  price_per_share_e4 bigint not null check (price_per_share_e4 > 0),
  total_cents        bigint not null check (total_cents > 0),
  message            text check (length(message) <= 500),
  status             public.offer_status not null default 'open',
  expires_at         timestamptz not null,
  resolved_at        timestamptz,
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (investor_player_id is null or ai_investor_key is null)
);
alter table public.angel_offers enable row level security;
create index angel_offers_company_idx on public.angel_offers (company_id, status);
create index angel_offers_investor_idx on public.angel_offers (investor_player_id, status);
create index angel_offers_created_by_idx on public.angel_offers (created_by);
create index angel_offers_ai_idx on public.angel_offers (ai_investor_key);
create index angel_offers_ledger_tx_idx on public.angel_offers (ledger_transaction_id);
create unique index angel_offers_request_uq on public.angel_offers (created_by, request_id) where created_by is not null;
comment on table public.angel_offers is 'Pre-IPO share deals: the company offers shares (to a player, an AI angel or openly) or an investor bids.';

create table public.ipos (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete cascade,
  status                  public.ipo_status not null default 'draft',
  request_id              uuid not null,
  filed_by                uuid references public.profiles (id) on delete set null,
  ticker                  text not null check (ticker ~ '^[A-Z0-9]{2,8}$'),
  shares_offered          bigint not null check (shares_offered > 0),
  shares_offered_bps      integer not null check (shares_offered_bps between 1 and 10000),
  price_range_low_e4      bigint check (price_range_low_e4 > 0),
  price_range_high_e4     bigint,
  final_price_e4          bigint,
  founder_lockup_quarters smallint not null default 4 check (founder_lockup_quarters >= 0),
  filed_quarter_id        bigint references public.game_quarters (id),
  subscription_opens_at   timestamptz,
  subscription_closes_at  timestamptz,
  total_demand_shares     bigint not null default 0 check (total_demand_shares >= 0),
  proceeds_cents          bigint,
  underwriter_fee_cents   bigint,
  failure_reason          text,
  security_id             uuid references public.securities (id),
  listed_at               timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (company_id, request_id),
  check (price_range_high_e4 is null or price_range_high_e4 >= price_range_low_e4)
);
alter table public.ipos enable row level security;
create index ipos_company_idx on public.ipos (company_id, created_at desc);
create index ipos_status_idx on public.ipos (status, subscription_closes_at);
create index ipos_filed_by_idx on public.ipos (filed_by);
create index ipos_filed_quarter_idx on public.ipos (filed_quarter_id);
create index ipos_security_idx on public.ipos (security_id);
create unique index ipos_one_running_uq on public.ipos (company_id) where status in ('draft', 'filed', 'bookbuilding', 'priced');
comment on table public.ipos is 'IPO process incl. prospectus header: share of stock offered, founder lock-up, price range from the AI underwriter, result.';

-- Binding revenue forecast for the next 4 quarters; checked automatically.
create table public.ipo_prospectus_forecasts (
  ipo_id                 uuid not null references public.ipos (id) on delete cascade,
  quarter_offset         smallint not null check (quarter_offset between 1 and 4),
  game_quarter_id        bigint references public.game_quarters (id),
  revenue_forecast_cents bigint not null check (revenue_forecast_cents >= 0),
  actual_revenue_cents   bigint,
  deviation_bps          integer,
  is_met                 boolean,
  checked_at             timestamptz,
  primary key (ipo_id, quarter_offset)
);
alter table public.ipo_prospectus_forecasts enable row level security;
create index ipo_prospectus_forecasts_quarter_idx on public.ipo_prospectus_forecasts (game_quarter_id);
comment on table public.ipo_prospectus_forecasts is 'Prospectus: revenue forecast per quarter after the IPO and the automatic check result.';

-- Binding use of proceeds in percent; planned_bps of one IPO sum to 10000
-- (enforced by the file_ipo RPC).
create table public.ipo_use_of_proceeds (
  ipo_id       uuid not null references public.ipos (id) on delete cascade,
  category     public.proceeds_category not null,
  planned_bps  integer not null check (planned_bps between 0 and 10000),
  actual_bps   integer check (actual_bps between 0 and 10000),
  checked_at   timestamptz,
  primary key (ipo_id, category)
);
alter table public.ipo_use_of_proceeds enable row level security;
comment on table public.ipo_use_of_proceeds is 'Prospectus: planned vs. actual use of proceeds (expansion, personnel, reserve, financial investments).';

create table public.ipo_subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  ipo_id                uuid not null references public.ipos (id) on delete cascade,
  player_id             uuid references public.profiles (id) on delete cascade,
  ai_investor_key       text references public.ai_investors (key),
  request_id            uuid not null default gen_random_uuid(),
  shares_requested      bigint not null check (shares_requested > 0),
  limit_price_e4        bigint not null check (limit_price_e4 > 0),
  reserved_cents        bigint not null default 0 check (reserved_cents >= 0),
  shares_allocated      bigint not null default 0 check (shares_allocated >= 0),
  status                public.subscription_status not null default 'pending',
  reserve_transaction_id uuid references public.ledger_transactions (id),
  settle_transaction_id  uuid references public.ledger_transactions (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check ((player_id is not null) <> (ai_investor_key is not null)),
  check (shares_allocated <= shares_requested)
);
alter table public.ipo_subscriptions enable row level security;
create unique index ipo_subscriptions_player_uq on public.ipo_subscriptions (ipo_id, player_id) where player_id is not null;
create unique index ipo_subscriptions_ai_uq on public.ipo_subscriptions (ipo_id, ai_investor_key) where ai_investor_key is not null;
create unique index ipo_subscriptions_request_uq on public.ipo_subscriptions (player_id, request_id) where player_id is not null;
create index ipo_subscriptions_player_idx on public.ipo_subscriptions (player_id);
create index ipo_subscriptions_ai_idx on public.ipo_subscriptions (ai_investor_key);
create index ipo_subscriptions_reserve_tx_idx on public.ipo_subscriptions (reserve_transaction_id);
create index ipo_subscriptions_settle_tx_idx on public.ipo_subscriptions (settle_transaction_id);
comment on table public.ipo_subscriptions is 'Bookbuilding orders of players and AI funds. Players see only their own; the public sees ipos.total_demand_shares.';

create table public.guidance (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  target_quarter_id    bigint not null references public.game_quarters (id),
  issued_quarter_id    bigint references public.game_quarters (id),
  issued_by            uuid references public.profiles (id) on delete set null,
  request_id           uuid not null default gen_random_uuid(),
  revenue_low_cents    bigint not null check (revenue_low_cents >= 0),
  revenue_high_cents   bigint not null,
  actual_revenue_cents bigint,
  deviation_bps        integer,
  outcome              public.guidance_outcome not null default 'pending',
  evaluated_at         timestamptz,
  created_at           timestamptz not null default now(),
  unique (company_id, target_quarter_id),
  check (revenue_high_cents >= revenue_low_cents)
);
alter table public.guidance enable row level security;
create index guidance_target_quarter_idx on public.guidance (target_quarter_id);
create index guidance_issued_quarter_idx on public.guidance (issued_quarter_id);
create index guidance_issued_by_idx on public.guidance (issued_by);
comment on table public.guidance is 'Founder forecast for the next quarter of a listed company; deviation moves reputation.';

create table public.shareholder_votes (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  kind              public.vote_kind not null,
  title             text not null,
  description       text,
  proposal          jsonb not null default '{}'::jsonb,
  proposed_by       uuid references public.profiles (id) on delete set null,
  request_id        uuid not null default gen_random_uuid(),
  status            public.vote_status not null default 'scheduled',
  opens_at          timestamptz not null,
  closes_at         timestamptz not null,
  record_at         timestamptz,
  threshold_bps     integer not null default 5000 check (threshold_bps between 0 and 10000),
  quorum_bps        integer not null default 0 check (quorum_bps between 0 and 10000),
  yes_shares        bigint not null default 0 check (yes_shares >= 0),
  no_shares         bigint not null default 0 check (no_shares >= 0),
  abstain_shares    bigint not null default 0 check (abstain_shares >= 0),
  result_applied_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (closes_at > opens_at)
);
alter table public.shareholder_votes enable row level security;
create index shareholder_votes_company_idx on public.shareholder_votes (company_id, closes_at desc);
create index shareholder_votes_status_idx on public.shareholder_votes (status, closes_at);
create index shareholder_votes_proposed_by_idx on public.shareholder_votes (proposed_by);
comment on table public.shareholder_votes is 'General meeting votes: dividend, removal of the CEO (> 50 %), takeovers. Tallies are public.';

create table public.shareholder_vote_ballots (
  vote_id    uuid not null references public.shareholder_votes (id) on delete cascade,
  player_id  uuid not null references public.profiles (id) on delete cascade,
  choice     public.vote_choice not null,
  shares     bigint not null check (shares > 0),
  request_id uuid not null,
  cast_at    timestamptz not null default now(),
  primary key (vote_id, player_id),
  unique (player_id, request_id)
);
alter table public.shareholder_vote_ballots enable row level security;
comment on table public.shareholder_vote_ballots is 'One ballot per shareholder with the share weight at record time. Secret ballot: owner read only.';

create table public.corporate_actions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  kind               public.corporate_action_kind not null,
  status             public.corporate_action_status not null default 'announced',
  request_id         uuid not null,
  requested_by       uuid references public.profiles (id) on delete set null,
  shares             bigint check (shares > 0),
  price_e4           bigint check (price_e4 >= 0),
  budget_cents       bigint check (budget_cents >= 0),
  amount_per_share_e4 bigint check (amount_per_share_e4 >= 0),
  vote_id            uuid references public.shareholder_votes (id) on delete set null,
  distribution_id    uuid references public.security_distributions (id) on delete set null,
  game_quarter_id    bigint references public.game_quarters (id),
  announced_at       timestamptz not null default now(),
  executed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, request_id)
);
alter table public.corporate_actions enable row level security;
create index corporate_actions_company_idx on public.corporate_actions (company_id, announced_at desc);
create index corporate_actions_requested_by_idx on public.corporate_actions (requested_by);
create index corporate_actions_vote_idx on public.corporate_actions (vote_id);
create index corporate_actions_distribution_idx on public.corporate_actions (distribution_id);
create index corporate_actions_quarter_idx on public.corporate_actions (game_quarter_id);
comment on table public.corporate_actions is 'Dividends, share buybacks, capital increases (dilution) of listed companies.';

-- Reputation journal (0..100 per founder, not per company).
create table public.reputation_events (
  id               bigint generated always as identity primary key,
  player_id        uuid not null references public.profiles (id) on delete cascade,
  kind             public.reputation_event_kind not null,
  delta            smallint not null,
  reputation_after smallint not null check (reputation_after between 0 and 100),
  company_id       uuid references public.companies (id) on delete set null,
  ref_type         text,
  ref_id           uuid,
  reason           text,
  game_quarter_id  bigint references public.game_quarters (id),
  created_at       timestamptz not null default now()
);
alter table public.reputation_events enable row level security;
create index reputation_events_player_idx on public.reputation_events (player_id, created_at desc);
create index reputation_events_company_idx on public.reputation_events (company_id);
create index reputation_events_quarter_idx on public.reputation_events (game_quarter_id);
comment on table public.reputation_events is 'Public journal of reputation changes; profiles.reputation is its cache.';

-- ---------------------------------------------------------------------------
-- Insider rule
-- ---------------------------------------------------------------------------
create table public.insider_blackout_windows (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  security_id     uuid not null references public.securities (id) on delete cascade,
  game_quarter_id bigint references public.game_quarters (id),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  reason          text not null default 'earnings',
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.insider_blackout_windows enable row level security;
create index insider_blackout_windows_security_idx on public.insider_blackout_windows (security_id, starts_at, ends_at);
create index insider_blackout_windows_company_idx on public.insider_blackout_windows (company_id);
create index insider_blackout_windows_quarter_idx on public.insider_blackout_windows (game_quarter_id);
comment on table public.insider_blackout_windows is 'Windows (default 2 h before earnings) in which insiders must not trade the stock. Public so the client can warn.';

create table public.insider_violations (
  id                    uuid primary key default gen_random_uuid(),
  player_id             uuid not null references public.profiles (id) on delete cascade,
  company_id            uuid not null references public.companies (id) on delete cascade,
  security_id           uuid not null references public.securities (id),
  window_id             uuid references public.insider_blackout_windows (id) on delete set null,
  order_id              uuid references public.orders (id) on delete set null,
  trade_id              uuid references public.trades (id) on delete set null,
  status                public.insider_violation_status not null default 'undetected',
  detection_chance_bps  integer not null,
  detection_roll_bps    integer,
  fine_cents            bigint,
  reputation_delta      smallint,
  ledger_transaction_id uuid references public.ledger_transactions (id),
  detected_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.insider_violations enable row level security;
create index insider_violations_player_idx on public.insider_violations (player_id, created_at desc);
create index insider_violations_company_idx on public.insider_violations (company_id);
create index insider_violations_security_idx on public.insider_violations (security_id);
create index insider_violations_window_idx on public.insider_violations (window_id);
create index insider_violations_order_idx on public.insider_violations (order_id);
create index insider_violations_trade_idx on public.insider_violations (trade_id);
create index insider_violations_ledger_tx_idx on public.insider_violations (ledger_transaction_id);
comment on table public.insider_violations is 'Trades of insiders inside a blackout window, incl. undetected ones. Internal (AI regulator).';
