-- =============================================================================
-- NEXA · M3c · 0300 · Player companies: schema and error keys (ADR-057,
--                     docs/PLAYER_COMPANIES.md)
-- =============================================================================
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Error keys (M3c: NX047..NX052)
-- ---------------------------------------------------------------------------
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
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- Player companies (one per founder) and their quarterly reports
-- ---------------------------------------------------------------------------
create table if not exists public.player_companies (
  company_id                  uuid primary key references public.companies (id) on delete cascade,
  founder_id                  uuid not null unique references public.profiles (id) on delete cascade,
  idea                        text not null check (char_length(idea) between 1 and 120),
  tier                        text not null default 'garage' check (tier in ('garage', 'small_business')),
  potential_annual_cents      bigint not null check (potential_annual_cents > 0),
  awareness                   double precision not null check (awareness between 0 and 1),
  quality                     double precision not null check (quality between 0 and 1),
  quarters_active             integer not null default 0 check (quarters_active >= 0),
  marketing_cents_per_quarter bigint not null default 0 check (marketing_cents_per_quarter >= 0),
  ai_workers                  integer not null default 0 check (ai_workers >= 0),
  unpaid_cents                bigint not null default 0 check (unpaid_cents >= 0),
  distress                    boolean not null default false,
  last_closed_quarter_id      bigint references public.game_quarters (id),
  request_id                  uuid,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
alter table public.player_companies enable row level security;
create index if not exists player_companies_last_quarter_idx on public.player_companies (last_closed_quarter_id);
comment on table public.player_companies is 'Player companies (garage startup, small business; ADR-057). potential_annual_cents is hidden from everyone (no column grant).';
comment on column public.player_companies.potential_annual_cents is 'Hidden market size of the niche (Pareto draw at founding). Never readable by players.';

create table if not exists public.player_company_reports (
  company_id             uuid not null references public.player_companies (company_id) on delete cascade,
  game_quarter_id        bigint not null references public.game_quarters (id),
  label                  text not null,
  demand_cents           bigint not null,
  capacity_cents         bigint not null,
  revenue_cents          bigint not null,
  cogs_cents             bigint not null,
  fixed_cents            bigint not null,
  ai_worker_cents        bigint not null,
  marketing_cents        bigint not null,
  wages_cents            bigint not null default 0,
  operating_profit_cents bigint not null,
  utilization_bps        integer not null,
  paid_costs_cents       bigint not null default 0,
  unpaid_added_cents     bigint not null default 0,
  awareness_bps          integer not null,
  quality_bps            integer not null,
  team_productivity_bps  integer not null,
  team_sector_score      integer not null,
  created_at             timestamptz not null default now(),
  primary key (company_id, game_quarter_id)
);
alter table public.player_company_reports enable row level security;
create index if not exists player_company_reports_quarter_idx on public.player_company_reports (game_quarter_id);
comment on table public.player_company_reports is 'Quarterly report of a player company (closeStartupQuarter). Wages are the M2b salary payouts of the quarter.';

do $$
begin
  revoke all on public.player_companies from public, anon, authenticated;
  grant select (company_id, founder_id, idea, tier, awareness, quality, quarters_active, marketing_cents_per_quarter,
                ai_workers, unpaid_cents, distress, last_closed_quarter_id, created_at, updated_at)
    on public.player_companies to authenticated;
  grant all on public.player_companies to service_role;
  drop policy if exists "owner read" on public.player_companies;
  create policy "owner read" on public.player_companies for select to authenticated
    using (founder_id = (select auth.uid()));

  revoke all on public.player_company_reports from public, anon, authenticated;
  grant select on public.player_company_reports to authenticated;
  grant all on public.player_company_reports to service_role;
  drop policy if exists "owner read" on public.player_company_reports;
  create policy "owner read" on public.player_company_reports for select to authenticated
    using (exists (select 1 from public.player_companies pc
                    where pc.company_id = player_company_reports.company_id and pc.founder_id = (select auth.uid())));

  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.player_companies'::regclass) then
    create trigger set_updated_at before update on public.player_companies for each row execute function public.set_updated_at();
  end if;
end;
$$;
