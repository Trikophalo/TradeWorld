-- =============================================================================
-- NEXA · 0900 · Jobs, employment, salary, work tasks, negotiation, job offers
-- =============================================================================

create table public.job_definitions (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null unique check (key ~ '^[a-z0-9_]+$'),
  company_id         uuid not null references public.companies (id) on delete cascade,
  tier               public.job_tier not null,
  title              text not null,
  description        text not null,
  specialty          public.employee_specialty not null,
  task_kind          public.work_task_kind not null default 'generic',
  min_level          integer not null check (min_level between 1 and 50),
  salary_cents_per_hour bigint not null check (salary_cents_per_hour > 0),
  grants_options     boolean not null default false,
  has_decisions      boolean not null default false,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.job_definitions enable row level security;
create index job_definitions_company_idx on public.job_definitions (company_id);
create index job_definitions_tier_idx on public.job_definitions (tier, min_level) where is_active;
comment on table public.job_definitions is 'Job board of AI companies (intern .. C-level). Jobs at player companies are created via job_offers.';

create table public.player_jobs (
  id                    uuid primary key default gen_random_uuid(),
  player_id             uuid not null references public.profiles (id) on delete cascade,
  company_id            uuid not null references public.companies (id) on delete cascade,
  job_definition_id     uuid references public.job_definitions (id) on delete set null,
  employee_id           uuid references public.employees (id) on delete set null,
  request_id            uuid not null,
  tier                  public.job_tier not null,
  title                 text not null,
  status                public.player_job_status not null default 'active',
  salary_cents_per_hour bigint not null check (salary_cents_per_hour >= 0),
  promotion_step        smallint not null default 0 check (promotion_step >= 0),
  experience_minutes    bigint not null default 0 check (experience_minutes >= 0),
  performance_score     smallint not null default 50 check (performance_score between 0 and 100),
  last_paid_at          timestamptz not null default now(),
  next_task_at          timestamptz,
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  end_reason            public.job_end_reason,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (player_id, request_id),
  check ((status = 'ended') = (ended_at is not null))
);
alter table public.player_jobs enable row level security;
create unique index player_jobs_active_uq on public.player_jobs (player_id) where status = 'active';
create index player_jobs_player_idx on public.player_jobs (player_id, started_at desc);
create index player_jobs_company_idx on public.player_jobs (company_id) where status = 'active';
create index player_jobs_definition_idx on public.player_jobs (job_definition_id);
create index player_jobs_employee_idx on public.player_jobs (employee_id);
comment on table public.player_jobs is 'Employment of a player (one active job). At player companies employee_id links the employees row.';

create table public.salary_payouts (
  id                    bigint generated always as identity primary key,
  player_job_id         uuid not null references public.player_jobs (id) on delete cascade,
  player_id             uuid not null references public.profiles (id) on delete cascade,
  pay_day               date not null,
  period_start          timestamptz not null,
  period_end            timestamptz not null,
  minutes_paid          integer not null check (minutes_paid >= 0),
  amount_cents          bigint not null check (amount_cents >= 0),
  bonus_cents           bigint not null default 0 check (bonus_cents >= 0),
  xp_awarded            integer not null default 0,
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at            timestamptz not null default now(),
  check (period_end >= period_start)
);
alter table public.salary_payouts enable row level security;
create index salary_payouts_player_day_idx on public.salary_payouts (player_id, pay_day desc);
create index salary_payouts_job_idx on public.salary_payouts (player_job_id, period_end desc);
create index salary_payouts_ledger_tx_idx on public.salary_payouts (ledger_transaction_id);
comment on table public.salary_payouts is 'Passive salary accruals (max. 12 paid hours per day), also earned offline.';

create table public.work_task_definitions (
  key              text primary key,
  task_kind        public.work_task_kind not null,
  title            text not null,
  description      text not null,
  icon_key         text not null,
  min_tier         public.job_tier not null default 'intern',
  duration_seconds integer not null check (duration_seconds between 10 and 300),
  xp_min           integer not null default 50,
  xp_max           integer not null default 150,
  bonus_bps_of_hourly integer not null default 5000 check (bonus_bps_of_hourly >= 0),
  config           jsonb not null default '{}'::jsonb,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (xp_max >= xp_min)
);
alter table public.work_task_definitions enable row level security;
comment on table public.work_task_definitions is 'Mini task types (20-60 s): estimate earnings, pick the best customer, compare loan offers.';

create table public.work_tasks (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.profiles (id) on delete cascade,
  player_job_id  uuid not null references public.player_jobs (id) on delete cascade,
  definition_key text not null references public.work_task_definitions (key),
  status         public.work_task_status not null default 'available',
  prompt         jsonb not null default '{}'::jsonb,
  answer         jsonb,
  quality_score  smallint check (quality_score between 0 and 100),
  xp_awarded     integer not null default 0,
  bonus_cents    bigint not null default 0,
  request_id     uuid,
  available_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  started_at     timestamptz,
  submitted_at   timestamptz,
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (player_id, request_id)
);
alter table public.work_tasks enable row level security;
create index work_tasks_player_status_idx on public.work_tasks (player_id, status, available_at desc);
create index work_tasks_job_idx on public.work_tasks (player_job_id);
create index work_tasks_definition_idx on public.work_tasks (definition_key);
create index work_tasks_ledger_tx_idx on public.work_tasks (ledger_transaction_id);
comment on table public.work_tasks is 'Task instances. prompt = what the client shows; the solution lives in work_task_solutions.';

-- Hidden solutions: separate table so that owner read access to work_tasks
-- can never leak the correct answer.
create table public.work_task_solutions (
  task_id    uuid primary key references public.work_tasks (id) on delete cascade,
  solution   jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.work_task_solutions enable row level security;
comment on table public.work_task_solutions is 'Correct answers / scoring keys of work tasks. Internal.';

create table public.salary_negotiations (
  id                    uuid primary key default gen_random_uuid(),
  player_id             uuid not null references public.profiles (id) on delete cascade,
  player_job_id         uuid not null references public.player_jobs (id) on delete cascade,
  request_id            uuid not null,
  week_start            date not null,
  requested_raise_bps   integer not null check (requested_raise_bps > 0),
  success_chance_bps    integer not null check (success_chance_bps between 0 and 10000),
  outcome               public.negotiation_outcome not null,
  old_salary_cents_per_hour bigint not null,
  new_salary_cents_per_hour bigint not null,
  created_at            timestamptz not null default now(),
  unique (player_id, request_id),
  unique (player_id, week_start)
);
alter table public.salary_negotiations enable row level security;
create index salary_negotiations_job_idx on public.salary_negotiations (player_job_id);
comment on table public.salary_negotiations is 'One salary negotiation per player and week (chance by experience, performance, company situation).';

-- Job offers between players (and headhunter events).
create table public.job_offers (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  to_player_id          uuid not null references public.profiles (id) on delete cascade,
  offered_by            uuid references public.profiles (id) on delete set null,
  request_id            uuid not null,
  role                  public.employee_role not null default 'staff',
  specialty             public.employee_specialty not null,
  tier                  public.job_tier not null,
  title                 text not null,
  message               text check (length(message) <= 500),
  salary_cents_per_hour bigint not null check (salary_cents_per_hour >= 0),
  option_shares         bigint not null default 0 check (option_shares >= 0),
  option_strike_e4      bigint check (option_strike_e4 >= 0),
  vesting_quarters      smallint not null default 4 check (vesting_quarters > 0),
  status                public.offer_status not null default 'open',
  expires_at            timestamptz not null,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, request_id)
);
alter table public.job_offers enable row level security;
create index job_offers_to_player_idx on public.job_offers (to_player_id, status);
create index job_offers_company_idx on public.job_offers (company_id, status);
create index job_offers_offered_by_idx on public.job_offers (offered_by);
comment on table public.job_offers is 'Job offers from player companies (salary + stock options with vesting) or headhunters.';
