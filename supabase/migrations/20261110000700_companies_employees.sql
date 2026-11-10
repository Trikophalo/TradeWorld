-- =============================================================================
-- NEXA · 0700 · Companies, products, quarterly decisions and reports,
--               employees, applicants, stock options, loans, cap table,
--               insolvency, takeovers
-- =============================================================================

create table public.companies (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(name) between 2 and 60),
  slug                 text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  ticker               text check (ticker ~ '^[A-Z0-9]{2,8}$'),
  description          text,
  sector_key           text not null references public.sectors (key),
  is_ai                boolean not null default false,
  tier                 public.company_tier,
  legal_form           public.legal_form not null,
  phase                public.company_phase not null default 'private',
  founder_id           uuid references public.profiles (id) on delete set null,
  ceo_id               uuid references public.profiles (id) on delete set null,
  logo_key             text,
  logo_pixels          jsonb,
  brand_color          text check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  security_id          uuid references public.securities (id),
  shares_outstanding   bigint not null check (shares_outstanding > 0),
  max_employees        integer not null default 5 check (max_employees >= 0),
  employee_count       integer not null default 0 check (employee_count >= 0),
  dividend_policy      public.dividend_policy not null default 'none',
  dividend_payout_bps  integer not null default 0 check (dividend_payout_bps between 0 and 10000),
  ttm_revenue_cents    bigint not null default 0,
  ttm_net_income_cents bigint not null default 0,
  eps_ttm_e4           bigint not null default 0,
  founded_quarter_id   bigint references public.game_quarters (id),
  founded_at           timestamptz not null default now(),
  listed_at            timestamptz,
  dissolved_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (is_ai or founder_id is not null or phase in ('insolvent', 'dissolved')),
  check (logo_pixels is null or pg_column_size(logo_pixels) < 16384)
);
alter table public.companies enable row level security;
create unique index companies_name_lower_uq on public.companies (lower(name));
create unique index companies_slug_uq on public.companies (slug);
create unique index companies_ticker_uq on public.companies (ticker) where ticker is not null;
create unique index companies_security_uq on public.companies (security_id) where security_id is not null;
create index companies_sector_idx on public.companies (sector_key);
create index companies_founder_idx on public.companies (founder_id);
create index companies_ceo_idx on public.companies (ceo_id);
create index companies_phase_idx on public.companies (phase);
create index companies_founded_quarter_idx on public.companies (founded_quarter_id);
comment on table public.companies is 'Public company profile for AI and player companies (same simulation). ttm_* are published KPI caches.';

-- late FKs to companies
alter table public.securities
  add constraint securities_company_fk foreign key (company_id) references public.companies (id) on delete set null;
alter table public.ledger_accounts
  add constraint ledger_accounts_owner_company_fk foreign key (owner_company_id) references public.companies (id) on delete restrict;

-- Internal operating state (insiders of a player company may read it).
create table public.company_state (
  company_id               uuid primary key references public.companies (id) on delete cascade,
  quality                  double precision not null default 1 check (quality >= 0),
  awareness                double precision not null default 1 check (awareness >= 0),
  price_index              double precision not null default 1 check (price_index > 0),
  capacity_cents           bigint not null default 0 check (capacity_cents >= 0),
  baseline_revenue_cents   bigint not null default 0,
  baseline_costs_cents     bigint not null default 0,
  fixed_costs_cents        bigint not null default 0 check (fixed_costs_cents >= 0),
  debt_cents               bigint not null default 0 check (debt_cents >= 0),
  credit_limit_cents       bigint not null default 0 check (credit_limit_cents >= 0),
  founder_capital_injected_cents bigint not null default 0 check (founder_capital_injected_cents >= 0),
  uncovered_quarters       smallint not null default 0 check (uncovered_quarters >= 0),
  last_simulated_quarter_id bigint references public.game_quarters (id),
  state                    jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
alter table public.company_state enable row level security;
create index company_state_last_quarter_idx on public.company_state (last_simulated_quarter_id);
comment on table public.company_state is 'Operating state for the quarterly simulation (quality, awareness, price index, capacity, debt). Insiders + service role.';
comment on column public.company_state.uncovered_quarters is 'Consecutive quarters with uncovered running costs; 2 = insolvency.';

create table public.company_products (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies (id) on delete cascade,
  name                      text not null check (length(name) between 2 and 60),
  status                    public.product_status not null default 'in_development',
  quality                   double precision not null default 1 check (quality >= 0),
  price_cents               bigint check (price_cents > 0),
  unit_cost_cents           bigint check (unit_cost_cents >= 0),
  development_budget_cents  bigint not null default 0,
  development_quarters_total smallint not null default 0 check (development_quarters_total >= 0),
  development_quarters_done  smallint not null default 0 check (development_quarters_done >= 0),
  started_quarter_id        bigint references public.game_quarters (id),
  launched_quarter_id       bigint references public.game_quarters (id),
  retired_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
alter table public.company_products enable row level security;
create index company_products_company_idx on public.company_products (company_id, status);
create index company_products_started_quarter_idx on public.company_products (started_quarter_id);
create index company_products_launched_quarter_idx on public.company_products (launched_quarter_id);
comment on table public.company_products is 'Product lines. Active products are public, products in development only for insiders (time gate).';

create table public.company_quarter_decisions (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  game_quarter_id        bigint not null references public.game_quarters (id),
  status                 public.decision_status not null default 'draft',
  price_index            double precision check (price_index > 0),
  marketing_budget_cents bigint not null default 0 check (marketing_budget_cents >= 0),
  rnd_budget_cents       bigint not null default 0 check (rnd_budget_cents >= 0),
  capacity_investment_cents bigint not null default 0 check (capacity_investment_cents >= 0),
  reserve_target_cents   bigint not null default 0 check (reserve_target_cents >= 0),
  dividend_per_share_e4  bigint not null default 0 check (dividend_per_share_e4 >= 0),
  buyback_budget_cents   bigint not null default 0 check (buyback_budget_cents >= 0),
  details                jsonb not null default '{}'::jsonb,
  submitted_by           uuid references public.profiles (id) on delete set null,
  submitted_at           timestamptz,
  applied_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, game_quarter_id)
);
alter table public.company_quarter_decisions enable row level security;
create index company_quarter_decisions_quarter_idx on public.company_quarter_decisions (game_quarter_id);
create index company_quarter_decisions_submitted_by_idx on public.company_quarter_decisions (submitted_by);
comment on table public.company_quarter_decisions is 'Manager decisions per quarter (price, marketing, R&D, finance). details holds per-product and per-department settings.';

create table public.company_quarter_reports (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  game_quarter_id        bigint not null references public.game_quarters (id),
  revenue_cents          bigint not null,
  cogs_cents             bigint not null default 0,
  salaries_cents         bigint not null default 0,
  marketing_cents        bigint not null default 0,
  rnd_cents              bigint not null default 0,
  fixed_costs_cents      bigint not null default 0,
  interest_cents         bigint not null default 0,
  tax_cents              bigint not null default 0,
  net_income_cents       bigint not null,
  cash_end_cents         bigint not null default 0,
  debt_end_cents         bigint not null default 0,
  market_share_bps       integer not null default 0 check (market_share_bps between 0 and 10000),
  capacity_utilization_bps integer,
  employee_count         integer not null default 0,
  shares_outstanding     bigint not null,
  eps_e4                 bigint not null default 0,
  dividend_per_share_e4  bigint not null default 0,
  quality                double precision,
  awareness              double precision,
  price_index            double precision,
  attractiveness         double precision,
  computed_at            timestamptz not null default now(),
  published_at           timestamptz,
  created_at             timestamptz not null default now(),
  unique (company_id, game_quarter_id)
);
alter table public.company_quarter_reports enable row level security;
create index company_quarter_reports_quarter_idx on public.company_quarter_reports (game_quarter_id);
create index company_quarter_reports_published_idx on public.company_quarter_reports (company_id, published_at desc);
comment on table public.company_quarter_reports is 'Quarterly results. Public from published_at; insiders see them earlier (insider rule, blackout window).';

create table public.sector_quarter_stats (
  sector_key       text not null references public.sectors (key) on delete cascade,
  game_quarter_id  bigint not null references public.game_quarters (id),
  demand_cents     bigint not null,
  revenue_cents    bigint not null,
  company_count    integer not null,
  avg_price_index  double precision,
  created_at       timestamptz not null default now(),
  primary key (sector_key, game_quarter_id)
);
alter table public.sector_quarter_stats enable row level security;
create index sector_quarter_stats_quarter_idx on public.sector_quarter_stats (game_quarter_id);
comment on table public.sector_quarter_stats is 'Published sector demand and totals per quarter (shared demand model, spec 6.2).';

create table public.company_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  kind        text not null,
  title       text,
  payload     jsonb not null default '{}'::jsonb,
  game_quarter_id bigint references public.game_quarters (id),
  created_at  timestamptz not null default now()
);
alter table public.company_events enable row level security;
create index company_events_company_idx on public.company_events (company_id, created_at desc);
create index company_events_quarter_idx on public.company_events (game_quarter_id);
comment on table public.company_events is 'Public company timeline: founded, converted, milestone, ipo, index_joined, insolvency ...';

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------
create table public.employee_traits (
  key         text primary key,
  name        text not null,
  description text not null,
  effects     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.employee_traits enable row level security;
comment on table public.employee_traits is 'Traits of AI employees with their effects (e.g. ambitious: +15 % output, quits faster).';

create table public.employees (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete cascade,
  player_id               uuid references public.profiles (id) on delete set null,
  name                    text not null,
  specialty               public.employee_specialty not null,
  role                    public.employee_role not null default 'staff',
  skill                   smallint not null check (skill between 1 and 10),
  salary_cents_per_quarter bigint not null check (salary_cents_per_quarter >= 0),
  loyalty_pct             smallint not null default 70 check (loyalty_pct between 0 and 100),
  trait_key               text references public.employee_traits (key),
  status                  public.employee_status not null default 'active',
  onboarding_quarters_left smallint not null default 1 check (onboarding_quarters_left >= 0),
  productivity_multiplier double precision not null default 1 check (productivity_multiplier >= 0),
  hired_quarter_id        bigint references public.game_quarters (id),
  hired_at                timestamptz not null default now(),
  last_raise_quarter_id   bigint references public.game_quarters (id),
  left_at                 timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table public.employees enable row level security;
create index employees_company_status_idx on public.employees (company_id, status);
create index employees_player_idx on public.employees (player_id) where player_id is not null;
create index employees_trait_idx on public.employees (trait_key);
create index employees_hired_quarter_idx on public.employees (hired_quarter_id);
create index employees_last_raise_quarter_idx on public.employees (last_raise_quarter_id);
-- one holder per leadership role and company
create unique index employees_leadership_uq on public.employees (company_id, role)
  where status in ('active', 'notice') and role in ('cfo', 'cto', 'coo', 'head_of_sales', 'ceo');
-- a player holds at most one active employment (max. one side role)
create unique index employees_player_active_uq on public.employees (player_id)
  where player_id is not null and status in ('active', 'notice');
comment on table public.employees is 'AI employees and player employees (player_id set, productivity x2) of a company.';

create table public.applicants (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  game_quarter_id    bigint not null references public.game_quarters (id),
  name               text not null,
  specialty          public.employee_specialty not null,
  suggested_role     public.employee_role not null default 'staff',
  skill              smallint not null check (skill between 1 and 10),
  asking_salary_cents_per_quarter bigint not null check (asking_salary_cents_per_quarter >= 0),
  loyalty_pct        smallint not null default 70 check (loyalty_pct between 0 and 100),
  trait_key          text references public.employee_traits (key),
  status             public.applicant_status not null default 'available',
  hired_employee_id  uuid references public.employees (id) on delete set null,
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now()
);
alter table public.applicants enable row level security;
create index applicants_company_idx on public.applicants (company_id, status, game_quarter_id);
create index applicants_quarter_idx on public.applicants (game_quarter_id);
create index applicants_trait_idx on public.applicants (trait_key);
create index applicants_employee_idx on public.applicants (hired_employee_id);
comment on table public.applicants is 'Applicant pool, regenerated per company every quarter.';

create table public.poaching_offers (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees (id) on delete cascade,
  from_company_id    uuid not null references public.companies (id) on delete cascade,
  offered_by         uuid references public.profiles (id) on delete set null,
  request_id         uuid not null,
  offered_salary_cents_per_quarter bigint not null check (offered_salary_cents_per_quarter > 0),
  status             public.offer_status not null default 'open',
  success_chance_bps integer,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (from_company_id, request_id)
);
alter table public.poaching_offers enable row level security;
create index poaching_offers_employee_idx on public.poaching_offers (employee_id);
create index poaching_offers_offered_by_idx on public.poaching_offers (offered_by);
comment on table public.poaching_offers is 'Attempts to poach an AI employee from a competitor with a higher salary.';

-- Stock options with vesting for player employees.
create table public.stock_option_grants (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  player_id          uuid not null references public.profiles (id) on delete cascade,
  employee_id        uuid references public.employees (id) on delete set null,
  shares_total       bigint not null check (shares_total > 0),
  shares_vested      bigint not null default 0 check (shares_vested >= 0),
  shares_exercised   bigint not null default 0 check (shares_exercised >= 0),
  strike_price_e4    bigint not null check (strike_price_e4 >= 0),
  vesting_quarters   smallint not null default 4 check (vesting_quarters > 0),
  cliff_quarters     smallint not null default 0 check (cliff_quarters >= 0),
  granted_quarter_id bigint references public.game_quarters (id),
  status             public.option_grant_status not null default 'active',
  expires_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (shares_vested <= shares_total and shares_exercised <= shares_vested)
);
alter table public.stock_option_grants enable row level security;
create index stock_option_grants_company_idx on public.stock_option_grants (company_id);
create index stock_option_grants_player_idx on public.stock_option_grants (player_id);
create index stock_option_grants_employee_idx on public.stock_option_grants (employee_id);
create index stock_option_grants_quarter_idx on public.stock_option_grants (granted_quarter_id);
comment on table public.stock_option_grants is 'Employee stock options (salary component for player employees) with linear vesting.';

create table public.stock_option_vesting_events (
  id              bigint generated always as identity primary key,
  grant_id        uuid not null references public.stock_option_grants (id) on delete cascade,
  game_quarter_id bigint not null references public.game_quarters (id),
  shares_vested   bigint not null check (shares_vested > 0),
  created_at      timestamptz not null default now(),
  unique (grant_id, game_quarter_id)
);
alter table public.stock_option_vesting_events enable row level security;
create index stock_option_vesting_events_quarter_idx on public.stock_option_vesting_events (game_quarter_id);
comment on table public.stock_option_vesting_events is 'Vesting steps per quarter (idempotent quarter close).';

-- ---------------------------------------------------------------------------
-- Loans (company loans and the personal small loan from level 15)
-- ---------------------------------------------------------------------------
create table public.loans (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references public.companies (id) on delete cascade,
  player_id           uuid references public.profiles (id) on delete cascade,
  requested_by        uuid references public.profiles (id) on delete set null,
  request_id          uuid not null,
  principal_cents     bigint not null check (principal_cents > 0),
  outstanding_cents   bigint not null check (outstanding_cents >= 0),
  policy_rate_bps     integer not null,
  risk_premium_bps    integer not null,
  interest_rate_bps   integer not null check (interest_rate_bps >= 0),
  term_quarters       smallint not null check (term_quarters > 0),
  started_quarter_id  bigint references public.game_quarters (id),
  status              public.loan_status not null default 'active',
  missed_payments     smallint not null default 0,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((company_id is not null) <> (player_id is not null)),
  check (outstanding_cents <= principal_cents)
);
alter table public.loans enable row level security;
create index loans_company_idx on public.loans (company_id, status) where company_id is not null;
create index loans_player_idx on public.loans (player_id, status) where player_id is not null;
create index loans_requested_by_idx on public.loans (requested_by);
create index loans_started_quarter_idx on public.loans (started_quarter_id);
create unique index loans_company_request_uq on public.loans (company_id, request_id) where company_id is not null;
create unique index loans_player_request_uq on public.loans (player_id, request_id) where player_id is not null;
comment on table public.loans is 'Loans from the AI bank. Rate = policy rate + risk premium (reputation, leverage, profit).';

create table public.loan_payments (
  id                    bigint generated always as identity primary key,
  loan_id               uuid not null references public.loans (id) on delete cascade,
  game_quarter_id       bigint references public.game_quarters (id),
  kind                  public.loan_payment_kind not null,
  amount_cents          bigint not null check (amount_cents > 0),
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at            timestamptz not null default now()
);
alter table public.loan_payments enable row level security;
create index loan_payments_loan_idx on public.loan_payments (loan_id, created_at desc);
create index loan_payments_quarter_idx on public.loan_payments (game_quarter_id);
create index loan_payments_ledger_tx_idx on public.loan_payments (ledger_transaction_id);
comment on table public.loan_payments is 'Interest and principal payments of a loan.';

-- ---------------------------------------------------------------------------
-- Equity: cap table, issuances, lock-ups, founder capital
-- ---------------------------------------------------------------------------
create table public.cap_table_entries (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  holder_kind     public.cap_holder_kind not null,
  player_id       uuid references public.profiles (id) on delete cascade,
  ai_investor_key text references public.ai_investors (key),
  label           text,
  shares          bigint not null check (shares >= 0),
  invested_cents  bigint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (
    (holder_kind = 'player' and player_id is not null and ai_investor_key is null) or
    (holder_kind = 'ai_investor' and player_id is null) or
    (holder_kind in ('treasury', 'public_float') and player_id is null and ai_investor_key is null)
  )
);
alter table public.cap_table_entries enable row level security;
create unique index cap_table_player_uq on public.cap_table_entries (company_id, player_id) where player_id is not null;
create unique index cap_table_ai_uq on public.cap_table_entries (company_id, ai_investor_key, coalesce(label, '')) where holder_kind = 'ai_investor';
create unique index cap_table_bucket_uq on public.cap_table_entries (company_id, holder_kind) where holder_kind in ('treasury', 'public_float');
create index cap_table_entries_player_idx on public.cap_table_entries (player_id);
create index cap_table_entries_ai_idx on public.cap_table_entries (ai_investor_key);
comment on table public.cap_table_entries is 'Public shareholder register. Pre-IPO it is authoritative; after the IPO it lists founder, insiders, angels and the free float bucket.';

create table public.share_issuances (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  kind            public.share_issuance_kind not null,
  shares          bigint not null check (shares <> 0),
  price_e4        bigint not null check (price_e4 >= 0),
  proceeds_cents  bigint not null default 0,
  shares_outstanding_after bigint not null check (shares_outstanding_after > 0),
  game_quarter_id bigint references public.game_quarters (id),
  created_at      timestamptz not null default now()
);
alter table public.share_issuances enable row level security;
create index share_issuances_company_idx on public.share_issuances (company_id, created_at desc);
create index share_issuances_quarter_idx on public.share_issuances (game_quarter_id);
comment on table public.share_issuances is 'History of share count changes (founding, angel rounds, IPO, capital increases, buybacks = negative).';

create table public.share_lockups (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  player_id    uuid not null references public.profiles (id) on delete cascade,
  reason       public.lockup_reason not null,
  shares       bigint not null check (shares > 0),
  locked_until timestamptz not null,
  until_quarter_id bigint references public.game_quarters (id),
  released_at  timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.share_lockups enable row level security;
create index share_lockups_company_idx on public.share_lockups (company_id);
create index share_lockups_player_idx on public.share_lockups (player_id, locked_until);
create index share_lockups_quarter_idx on public.share_lockups (until_quarter_id);
comment on table public.share_lockups is 'Shares a holder may not sell yet (founder lock-up after IPO ...). Public: part of the prospectus promise.';

create table public.capital_injections (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  player_id             uuid not null references public.profiles (id) on delete cascade,
  request_id            uuid not null,
  amount_cents          bigint not null check (amount_cents > 0),
  legal_form            public.legal_form not null,
  game_quarter_id       bigint references public.game_quarters (id),
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at            timestamptz not null default now(),
  unique (player_id, request_id)
);
alter table public.capital_injections enable row level security;
create index capital_injections_company_idx on public.capital_injections (company_id);
create index capital_injections_quarter_idx on public.capital_injections (game_quarter_id);
create index capital_injections_ledger_tx_idx on public.capital_injections (ledger_transaction_id);
comment on table public.capital_injections is 'Private money a founder put into the company (capped per phase, spec 6.4).';

-- ---------------------------------------------------------------------------
-- Insolvency and takeovers
-- ---------------------------------------------------------------------------
create table public.insolvency_proceedings (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies (id) on delete cascade,
  status                      public.insolvency_status not null default 'warning',
  opened_quarter_id           bigint references public.game_quarters (id),
  rescue_deadline             timestamptz,
  creditors_recovered_cents   bigint,
  shareholders_recovered_cents bigint,
  founder_ban_until           timestamptz,
  closed_at                   timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
alter table public.insolvency_proceedings enable row level security;
create index insolvency_proceedings_company_idx on public.insolvency_proceedings (company_id);
create index insolvency_proceedings_quarter_idx on public.insolvency_proceedings (opened_quarter_id);
create unique index insolvency_proceedings_open_uq on public.insolvency_proceedings (company_id) where status in ('warning', 'rescue_window', 'liquidating');
comment on table public.insolvency_proceedings is 'Insolvency after 2 uncovered quarters: rescue window, liquidation, founder ban (3 game days).';

create table public.takeover_offers (
  id                 uuid primary key default gen_random_uuid(),
  target_company_id  uuid not null references public.companies (id) on delete cascade,
  bidder_player_id   uuid references public.profiles (id) on delete cascade,
  bidder_company_id  uuid references public.companies (id) on delete cascade,
  kind               public.takeover_kind not null,
  request_id         uuid not null,
  price_per_share_e4 bigint not null check (price_per_share_e4 >= 0),
  total_cents        bigint not null check (total_cents >= 0),
  status             public.offer_status not null default 'open',
  insolvency_id      uuid references public.insolvency_proceedings (id) on delete set null,
  expires_at         timestamptz not null,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (bidder_player_id is not null or bidder_company_id is not null)
);
alter table public.takeover_offers enable row level security;
create index takeover_offers_target_idx on public.takeover_offers (target_company_id, status);
create index takeover_offers_bidder_player_idx on public.takeover_offers (bidder_player_id);
create index takeover_offers_bidder_company_idx on public.takeover_offers (bidder_company_id);
create index takeover_offers_insolvency_idx on public.takeover_offers (insolvency_id);
create unique index takeover_offers_request_uq on public.takeover_offers (bidder_player_id, request_id) where bidder_player_id is not null;
comment on table public.takeover_offers is 'Rescue takeovers before insolvency and (level 35, later) friendly/hostile takeover bids.';

-- ---------------------------------------------------------------------------
-- RLS helper: is the caller an insider of the company?
-- (founder, CEO or active player employee)
-- ---------------------------------------------------------------------------
create or replace function public.is_company_insider(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.companies c
            where c.id = p_company_id
              and (select auth.uid()) in (c.founder_id, c.ceo_id)
         )
      or exists (
           select 1 from public.employees e
            where e.company_id = p_company_id
              and e.player_id = (select auth.uid())
              and e.status in ('active', 'notice')
         );
$$;
comment on function public.is_company_insider(uuid) is 'RLS helper: caller is founder, CEO or active player employee of the company.';
