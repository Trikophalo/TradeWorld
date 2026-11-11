-- =============================================================================
-- NEXA · M3d · 0100 · Schema: profit-linked pay, insolvency and forced loans,
--                     company chat, work tasks (ADR-052, ADR-058..060)
-- =============================================================================
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- Error keys (M3d: NX053..NX057)
create or replace function public.api_error(p_key text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
begin
  v_code := case p_key
    when 'insufficient_funds'          then 'NX001'
    when 'rate_limited'                then 'NX004'
    when 'forbidden'                   then 'NX006'
    when 'invalid_quantity'            then 'NX007'
    when 'invalid_price'               then 'NX007'
    when 'invalid_argument'            then 'NX007'
    when 'invalid_interval'            then 'NX007'
    when 'not_authenticated'           then 'NX010'
    when 'unknown_security'            then 'NX011'
    when 'not_tradable'                then 'NX012'
    when 'insufficient_position'       then 'NX013'
    when 'order_not_found'             then 'NX014'
    when 'order_not_open'              then 'NX015'
    when 'market_paused'               then 'NX016'
    when 'nothing_to_claim'            then 'NX017'
    when 'locked'                      then 'NX018'
    when 'name_too_short'              then 'NX019'
    when 'name_too_long'               then 'NX019'
    when 'name_invalid_chars'          then 'NX019'
    when 'name_profanity'              then 'NX019'
    when 'name_reserved'               then 'NX019'
    when 'name_taken'                  then 'NX019'
    when 'name_change_too_soon'        then 'NX020'
    when 'order_too_small'             then 'NX021'
    when 'market_illiquid'             then 'NX022'
    when 'mission_not_found'           then 'NX023'
    when 'mission_not_completed'       then 'NX024'
    when 'mission_already_claimed'     then 'NX025'
    when 'avatar_unknown'              then 'NX026'
    when 'avatar_locked'               then 'NX027'
    when 'daily_reward_claimed'        then 'NX028'
    when 'skill_unknown'               then 'NX029'
    when 'skill_learned'               then 'NX030'
    when 'skill_locked'                then 'NX031'
    when 'skill_points_insufficient'   then 'NX032'
    when 'job_not_found'               then 'NX033'
    when 'job_level_too_low'           then 'NX034'
    when 'job_skills_missing'          then 'NX035'
    when 'application_limit'           then 'NX036'
    when 'application_exists'          then 'NX037'
    when 'application_not_found'       then 'NX038'
    when 'application_not_offered'     then 'NX039'
    when 'offer_expired'               then 'NX040'
    when 'job_active_exists'           then 'NX041'
    when 'no_active_job'               then 'NX042'
    when 'raise_too_soon'              then 'NX043'
    when 'raise_too_high'              then 'NX044'
    when 'player_not_found'            then 'NX045'
    when 'employer_only'               then 'NX046'
    when 'company_exists'              then 'NX047'
    when 'company_not_found'           then 'NX048'
    when 'company_level_too_low'       then 'NX049'
    when 'owns_company'                then 'NX050'
    when 'employee_limit'              then 'NX051'
    when 'company_upgrade_unavailable' then 'NX052'
    when 'founding_locked'             then 'NX053'
    when 'not_in_company'              then 'NX054'
    when 'work_task_not_found'         then 'NX055'
    when 'work_task_expired'           then 'NX056'
    when 'work_task_done'              then 'NX057'
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- A. Profit-linked pay
-- ---------------------------------------------------------------------------
alter table public.player_companies
  add column if not exists pay_factor_bps    integer not null default 10000 check (pay_factor_bps between 0 and 10000),
  add column if not exists distress_quarters integer not null default 0 check (distress_quarters >= 0),
  add column if not exists status            text not null default 'active' check (status in ('active', 'dissolved')),
  add column if not exists dissolved_at      timestamptz;
comment on column public.player_companies.pay_factor_bps is 'Share of the contract wage paid in the running quarter (payFactorBps of the last result before wages).';
comment on column public.player_companies.distress_quarters is 'Consecutive quarter closes with open bills; insolvent at startups.insolvency.graceQuarters.';

-- one ACTIVE company per founder (dissolved companies stay as history)
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'player_companies_founder_id_key'
                and conrelid = 'public.player_companies'::regclass) then
    alter table public.player_companies drop constraint player_companies_founder_id_key;
  end if;
end;
$$;
create unique index if not exists player_companies_active_founder_uq on public.player_companies (founder_id) where status = 'active';
create index if not exists player_companies_founder_idx on public.player_companies (founder_id);
grant select (pay_factor_bps, distress_quarters, status, dissolved_at) on public.player_companies to authenticated;

alter table public.player_company_reports
  add column if not exists base_wages_cents bigint not null default 0,
  add column if not exists bonus_cents      bigint not null default 0,
  add column if not exists pay_factor_bps   integer not null default 10000;
comment on column public.player_company_reports.bonus_cents is 'Bonus paid to the employees at this close (distributeBonus, limited by the cash).';
comment on column public.player_company_reports.pay_factor_bps is 'Pay factor set for the next quarter at this close.';

alter table public.salary_payouts add column if not exists base_amount_cents bigint check (base_amount_cents >= 0);
comment on column public.salary_payouts.base_amount_cents is 'Wage of the period at the contract wage, before the pay factor and a cash shortfall (base wages for the bonus).';

-- ---------------------------------------------------------------------------
-- B. Insolvency, private liability, forced loans
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists founding_locked_until timestamptz;
comment on column public.profiles.founding_locked_until is 'After an insolvency no new company until then (startups.insolvency.foundingLockoutDays).';

create table if not exists public.company_dissolutions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  founder_id         uuid not null references public.profiles (id) on delete cascade,
  company_name       text not null,
  reason             text not null check (reason in ('insolvent', 'closed')),
  unpaid_cents       bigint not null default 0,
  severances_cents   bigint not null default 0,
  total_debt_cents   bigint not null default 0,
  from_company_cents bigint not null default 0,
  from_founder_cents bigint not null default 0,
  loan_cents         bigint not null default 0,
  to_founder_cents   bigint not null default 0,
  employees          integer not null default 0,
  created_at         timestamptz not null default now()
);
alter table public.company_dissolutions enable row level security;
create index if not exists company_dissolutions_founder_idx on public.company_dissolutions (founder_id, created_at desc);
create index if not exists company_dissolutions_company_idx on public.company_dissolutions (company_id);
comment on table public.company_dissolutions is 'Dissolved player companies (insolvency or voluntary close) with the settlement (dissolve()).';

create table if not exists public.player_loans (
  id                uuid primary key default gen_random_uuid(),
  player_id         uuid not null references public.profiles (id) on delete cascade,
  kind              text not null default 'forced' check (kind in ('forced')),
  dissolution_id    uuid references public.company_dissolutions (id) on delete set null,
  principal_cents   bigint not null check (principal_cents > 0),
  outstanding_cents bigint not null check (outstanding_cents >= 0 and outstanding_cents <= principal_cents),
  status            text not null default 'open' check (status in ('open', 'repaid')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz
);
alter table public.player_loans enable row level security;
create index if not exists player_loans_player_idx on public.player_loans (player_id, status);
create index if not exists player_loans_dissolution_idx on public.player_loans (dissolution_id);
comment on table public.player_loans is 'Forced private loans after a dissolution (no interest); repaid by withholding a share of every private income (withholdIncome).';

-- ---------------------------------------------------------------------------
-- C. Company chat
-- ---------------------------------------------------------------------------
create table if not exists public.company_messages (
  id         bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  kind       text not null check (kind in ('player', 'system')),
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  check (kind = 'player' or author_id is null)
);
alter table public.company_messages enable row level security;
create index if not exists company_messages_company_idx on public.company_messages (company_id, id desc);
create index if not exists company_messages_author_idx on public.company_messages (author_id, created_at desc);
comment on table public.company_messages is 'Company chat: members only (founder, players with an active job there). System messages have no author.';

-- member of a player company: founder of the active company or active employee there
create or replace function public.is_company_member(p_company uuid, p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.player_companies pc
                  where pc.company_id = p_company and pc.founder_id = p_player and pc.status = 'active')
      or exists (select 1 from public.player_jobs j
                  where j.company_id = p_company and j.player_id = p_player and j.status = 'active');
$$;

-- System line in a company chat (no-op for companies that are not player companies).
create or replace function public.company_system_message(p_company uuid, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.company_messages (company_id, kind, body)
  select p_company, 'system', left(p_body, 1000)
   where exists (select 1 from public.player_companies pc where pc.company_id = p_company);
$$;

-- German money text for system messages: "1.234 €", "-56 €"
create or replace function public.format_eur(p_cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_cents < 0 then '-' else '' end
      || reverse(regexp_replace(reverse(round(abs(p_cents) / 100.0)::bigint::text), '(\d{3})(?=\d)', '\1.', 'g'))
      || ' €';
$$;

-- ---------------------------------------------------------------------------
-- D. Work tasks
-- ---------------------------------------------------------------------------
create table if not exists public.player_work_tasks (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.profiles (id) on delete cascade,
  player_job_id  uuid not null references public.player_jobs (id) on delete cascade,
  kind           text not null check (kind in ('finance_choice', 'sales_pick', 'analyst_estimate')),
  params         jsonb not null,
  correct_index  smallint not null,
  status         text not null default 'open' check (status in ('open', 'started', 'done', 'expired')),
  choice         smallint,
  correct        boolean,
  xp_awarded     integer not null default 0,
  bonus_cents    bigint not null default 0,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  expires_at     timestamptz not null,
  answered_at    timestamptz
);
alter table public.player_work_tasks enable row level security;
create index if not exists player_work_tasks_player_idx on public.player_work_tasks (player_id, created_at desc);
create index if not exists player_work_tasks_job_idx on public.player_work_tasks (player_job_id, created_at desc);
comment on table public.player_work_tasks is 'Work tasks (ADR-059, replaces the unused work_tasks draft). correct_index is hidden (no column grant).';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
begin
  revoke all on public.company_dissolutions from public, anon, authenticated;
  grant select on public.company_dissolutions to authenticated;
  grant all on public.company_dissolutions to service_role;
  drop policy if exists "owner read" on public.company_dissolutions;
  create policy "owner read" on public.company_dissolutions for select to authenticated using (founder_id = (select auth.uid()));

  revoke all on public.player_loans from public, anon, authenticated;
  grant select on public.player_loans to authenticated;
  grant all on public.player_loans to service_role;
  drop policy if exists "owner read" on public.player_loans;
  create policy "owner read" on public.player_loans for select to authenticated using (player_id = (select auth.uid()));

  revoke all on public.company_messages from public, anon, authenticated;
  grant select on public.company_messages to authenticated;
  grant all on public.company_messages to service_role;
  drop policy if exists "members read" on public.company_messages;
  create policy "members read" on public.company_messages for select to authenticated
    using (exists (select 1 from public.player_companies pc
                    where pc.company_id = company_messages.company_id and pc.founder_id = (select auth.uid()) and pc.status = 'active')
           or exists (select 1 from public.player_jobs j
                       where j.company_id = company_messages.company_id and j.player_id = (select auth.uid()) and j.status = 'active'));

  revoke all on public.player_work_tasks from public, anon, authenticated;
  grant select (id, player_id, player_job_id, kind, params, status, choice, correct, xp_awarded, bonus_cents,
                created_at, started_at, expires_at, answered_at) on public.player_work_tasks to authenticated;
  grant all on public.player_work_tasks to service_role;
  drop policy if exists "owner read" on public.player_work_tasks;
  create policy "owner read" on public.player_work_tasks for select to authenticated using (player_id = (select auth.uid()));

  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.player_loans'::regclass) then
    create trigger set_updated_at before update on public.player_loans for each row execute function public.set_updated_at();
  end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.is_company_member(uuid, uuid)', 'public.company_system_message(uuid, text)',
                           'public.format_eur(bigint)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
