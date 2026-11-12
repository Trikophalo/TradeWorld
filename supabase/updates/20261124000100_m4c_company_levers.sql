-- ===== idempotent copy of migrations/20261124000100_m4c_company_levers.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M4c · 0100 · Company levers: contract work, price strategy, market by
--                     legal form, founding bigger, endless expansion (ADR-083)
-- =============================================================================
-- Mirrors src/lib/sim/startup.ts (effectivePotentialCents, expansionCapacityFactor,
-- canExpand, expansionCostCents, priceEffect, fixedCostCents / maxEmployees with
-- the expansion level, initialStartup(tier), closeStartupHour, closeStartupQuarter):
--   potential   = niche × marketFactorByTier[tier] × (1 + marketBonusPerLevel × level)
--   demand/h    = potential / 4 / quarterHours × awareness × (0.5 + 0.5 × quality) × exp(noise) × pricing.demand
--                 (premium below premiumMinQuality: demand × premiumLowQualityDemand)
--   capacity/h  = team capacity × (1 + capacityBonusPerStage × stage) × (1 + capacityBonusPerLevel × level) / quarterHours
--   sold        = min(demand, capacity); own revenue = sold × pricing.price
--   contract    = contract_work ? (capacity − sold) × shareOfFreeCapacity : 0 (revenue at the normal price)
--   goods       = sold × (1 − grossMargin[sector]) + contract × (1 − contractWork.grossMargin)
--   fixed costs = base × (1 + fixedCostPerLevel × level); places = base + employeesPerLevel × level
-- Quarter: the marketing gain uses the effective potential, word of mouth × pricing.awareness.
-- New RPCs: set_company_strategy, expand_company (paid from the company cash to the
-- households). found_company accepts the GmbH; the IPO follows startups.ipo
-- (fromTiers, minLevel). Existing companies keep their stored potential.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.player_companies add column if not exists price_level text not null default 'normal';
alter table public.player_companies add column if not exists contract_work boolean not null default true;
alter table public.player_companies add column if not exists expansion_level integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'player_companies_price_level_check'
                    and conrelid = 'public.player_companies'::regclass) then
    alter table public.player_companies add constraint player_companies_price_level_check
      check (price_level in ('budget', 'normal', 'premium'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'player_companies_expansion_level_check'
                    and conrelid = 'public.player_companies'::regclass) then
    alter table public.player_companies add constraint player_companies_expansion_level_check
      check (expansion_level >= 0);
  end if;
end;
$$;
comment on column public.player_companies.price_level is 'Price strategy budget | normal | premium (ADR-083).';
comment on column public.player_companies.contract_work is 'Sell a share of the unused capacity as contract work (ADR-083).';
comment on column public.player_companies.expansion_level is
  'Bought expansion levels (ADR-083): more places, capacity and market, higher fixed costs. No upper limit.';
grant select (price_level, contract_work, expansion_level) on public.player_companies to authenticated;

alter table public.player_company_hours add column if not exists contract_revenue_cents bigint not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'player_company_hours_contract_revenue_check'
                    and conrelid = 'public.player_company_hours'::regclass) then
    alter table public.player_company_hours add constraint player_company_hours_contract_revenue_check
      check (contract_revenue_cents >= 0);
  end if;
end;
$$;
comment on column public.player_company_hours.contract_revenue_cents is
  'Part of revenue_cents from contract work (ADR-083); also paid by the households.';

-- ---------------------------------------------------------------------------
-- B. Rules (port of src/lib/sim/startup.ts)
-- ---------------------------------------------------------------------------
-- effectivePotentialCents / potential: marketFactorByTier[tier] × (1 + marketBonusPerLevel × level)
create or replace function public.company_market_factor(p_tier text, p_level integer)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_double('startups', array['marketFactorByTier', p_tier],
                                       case p_tier when 'small_business' then 4 when 'gmbh' then 15 when 'ag' then 40 else 1 end),
                  1)
       * (1 + public.config_double('startups', '{expansion,marketBonusPerLevel}', 0.5) * greatest(0, coalesce(p_level, 0)));
$$;
comment on function public.company_market_factor(text, integer) is
  'Market reach of a player company (ADR-083): marketFactorByTier[tier] × (1 + marketBonusPerLevel × expansion level).';

-- expansionCapacityFactor
create or replace function public.company_capacity_factor(p_level integer)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select 1 + public.config_double('startups', '{expansion,capacityBonusPerLevel}', 0.1) * greatest(0, coalesce(p_level, 0));
$$;

-- fixedCostCents(tier, level) per quarter
create or replace function public.company_fixed_cost_cents(p_tier text, p_level integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select round(coalesce((public.company_tier_cfg(p_tier) ->> 'fixedCostCentsPerQuarter')::bigint, 0)
               * (1 + public.config_double('startups', '{expansion,fixedCostPerLevel}', 0.25) * greatest(0, coalesce(p_level, 0))))::bigint;
$$;

-- maxEmployees(tier, level): places for players and AI workers
create or replace function public.company_max_employees(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.company_tier_cfg(pc.tier) ->> 'maxEmployees')::integer, 0)
       + public.config_double('startups', '{expansion,employeesPerLevel}', 10)::integer * pc.expansion_level
    from public.player_companies pc where pc.company_id = p_company;
$$;
comment on function public.company_max_employees(uuid) is
  'Places for players and AI workers (maxEmployees of the tier + employeesPerLevel × expansion level, ADR-083).';

-- canExpand
create or replace function public.company_can_expand(p_tier text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('startups', '{expansion,fromTiers}'), '["gmbh", "ag"]'::jsonb) ? coalesce(p_tier, '');
$$;

-- expansionCostCents: price of the step from level n to n + 1
create or replace function public.company_expansion_cost_cents(p_level integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select round(public.config_double('startups', '{expansion,baseCostCents}', 10000000)
               * power(public.config_double('startups', '{expansion,costGrowth}', 1.8), greatest(0, coalesce(p_level, 0))))::bigint;
$$;

-- priceEffect: {price, demand, awareness}; premium below premiumMinQuality scares customers away
create or replace function public.company_price_effect(p_price_level text, p_quality double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lvl    text := case when p_price_level in ('budget', 'premium') then p_price_level else 'normal' end;
  v_price  double precision;
  v_demand double precision;
  v_aw     double precision;
begin
  v_price := public.config_double('startups', array['pricing', v_lvl, 'price'],
                                  case v_lvl when 'budget' then 0.8 when 'premium' then 1.3 else 1 end);
  v_demand := public.config_double('startups', array['pricing', v_lvl, 'demand'],
                                   case v_lvl when 'budget' then 1.35 when 'premium' then 0.75 else 1 end);
  v_aw := public.config_double('startups', array['pricing', v_lvl, 'awareness'],
                               case v_lvl when 'budget' then 1.5 when 'premium' then 0.7 else 1 end);
  if v_lvl = 'premium' and coalesce(p_quality, 0) < public.config_double('startups', '{pricing,premiumMinQuality}', 0.5) then
    v_demand := v_demand * public.config_double('startups', '{pricing,premiumLowQualityDemand}', 0.5);
  end if;
  return jsonb_build_object('price', v_price, 'demand', v_demand, 'awareness', v_aw);
end;
$$;

-- ---------------------------------------------------------------------------
-- C. One operating hour (closeStartupHour with price, contract work, expansion)
-- ---------------------------------------------------------------------------
create or replace function public.player_company_close_hour(p_company uuid, p_hour_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc        public.player_companies;
  c         public.companies;
  v_su      jsonb := coalesce(public.config_jsonb('startups'), '{}'::jsonb);
  v_hours   double precision := greatest(1, public.config_double('time', '{quarterHours}', 6));
  v_start   timestamptz := date_trunc('hour', p_hour_start);
  v_end     timestamptz;
  v_qid     bigint;
  v_team    jsonb;
  v_price   jsonb;
  v_stage   integer;
  v_demand  double precision;
  v_cap     double precision;
  v_sold    double precision;
  v_ctr     double precision;
  v_own     bigint;
  v_crev    bigint;
  v_hhbal   bigint;
  v_rev     bigint;
  v_cogs    bigint;
  v_gross   bigint;
  v_aidue   bigint;
  v_aipaid  bigint;
  v_pdue    bigint := 0;
  v_ppaid   bigint := 0;
  v_due     bigint;
  v_factor  integer;
  v_fixed   bigint;
  v_mk      bigint;
  v_costs   bigint;
  v_paid    bigint := 0;
  v_unpaid  bigint := 0;
  v_settle  bigint := 0;
  v_cash    bigint;
  v_acc     uuid;
  v_hh      uuid;
  v_profit  bigint;
  v_until   timestamptz;
  k         text;
  j         record;
begin
  if p_company is null or p_hour_start is null then
    return null;
  end if;
  select * into pc from public.player_companies where company_id = p_company and status = 'active' for update;
  if pc.company_id is null then
    return null;
  end if;
  if exists (select 1 from public.player_company_hours h where h.company_id = p_company and h.hour_start = v_start) then
    update public.player_companies set last_hour_at = greatest(last_hour_at, v_start + interval '1 hour')
     where company_id = p_company and last_hour_at < v_start + interval '1 hour';
    return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'skipped', 'already_closed');
  end if;
  v_end := v_start + interval '1 hour';
  select * into c from public.companies where id = p_company;
  select gq.id into v_qid from public.game_quarters gq where gq.starts_at <= v_start and gq.ends_at > v_start;
  v_team := public.player_company_team(p_company);
  v_acc := public.company_cash_account(p_company);
  v_hh := public.ledger_system_account('households');
  k := 'pch:' || p_company::text || ':' || to_char(v_start at time zone 'UTC', 'YYYYMMDDHH24');

  -- sales of the hour with the quarter's awareness and quality; demand and capacity count in units at the
  -- normal price, the price strategy changes both price and demand (ADR-083)
  v_price := public.company_price_effect(pc.price_level, pc.quality);
  v_stage := least(greatest(coalesce((v_team ->> 'stage')::integer, 0), 0),
                   greatest(jsonb_array_length(coalesce(v_su #> '{stages,awarenessCaps}', '[1]'::jsonb)) - 1, 0));
  v_demand := pc.potential_annual_cents * public.company_market_factor(pc.tier, pc.expansion_level) / 4.0 / v_hours
            * pc.awareness * (0.5 + 0.5 * pc.quality)
            * exp(public.cfg_num(v_su, '{demandNoise}', 0.1) * public.gauss_random())
            * (v_price ->> 'demand')::double precision;
  v_cap := (v_team ->> 'team_productivity_bps')::double precision / 10000.0
         * public.cfg_num(v_su, array['capacityCentsPerProductivity', c.sector_key], 250000)
         * (1 + public.cfg_num(v_su, '{stages,capacityBonusPerStage}', 0.25) * v_stage)
         * public.company_capacity_factor(pc.expansion_level) / v_hours;
  v_sold := least(v_demand, v_cap);
  -- contract work: a share of the unused capacity at the normal price (ADR-083)
  v_ctr := case when pc.contract_work
                then greatest(0, v_cap - v_sold) * public.cfg_num(v_su, '{contractWork,shareOfFreeCapacity}', 0.25)
                else 0 end;
  v_own := round((v_sold * (v_price ->> 'price')::double precision)::numeric)::bigint;
  v_crev := round(v_ctr::numeric)::bigint;
  -- closed money system: the households pay at most what they have (own sales first)
  v_hhbal := greatest(0, coalesce((select a.balance_cents from public.ledger_accounts a where a.id = v_hh), 0));
  if v_own + v_crev > v_hhbal then
    v_own := least(v_own, v_hhbal);
    v_crev := least(v_crev, v_hhbal - v_own);
    v_sold := least(v_sold, v_own / greatest((v_price ->> 'price')::double precision, 0.0001));
    v_ctr := v_crev;
  end if;
  v_rev := v_own + v_crev;
  v_cogs := round((v_sold * (1 - public.cfg_num(v_su, array['grossMargin', c.sector_key], 0.5)))::numeric)::bigint
          + round((v_ctr * (1 - public.cfg_num(v_su, '{contractWork,grossMargin}', 0.3)))::numeric)::bigint;
  v_gross := v_rev - v_cogs;

  -- wages due: AI workers and the hourly contract wages of the players (the founder draws no wage)
  v_aidue := pc.ai_workers * public.config_bigint('startups', '{aiWorkerWageCentsPerHour}', 12000);
  for j in select pj.id, pj.salary_cents_per_hour, pj.notice_ends_at from public.player_jobs pj
            where pj.company_id = p_company and pj.status = 'active' order by pj.id loop
    v_until := least(v_end, coalesce(j.notice_ends_at, v_end));
    v_pdue := v_pdue + j.salary_cents_per_hour * public.job_payable_minutes(j.id, v_until) / 60;
  end loop;
  v_due := v_aidue + v_pdue;
  -- never more than the hour earned; everyone gets the same share (ADR-072)
  v_factor := case when v_due <= 0 then 10000 else least(10000, greatest(0, v_gross) * 10000 / v_due)::integer end;
  v_aipaid := v_aidue * v_factor / 10000;

  -- money: revenue (own sales and contract work) from the households, goods and AI wages back to them
  if v_rev > 0 then
    perform public.ledger_transfer(v_hh, v_acc, v_rev, 'company_revenue',
                                   'Umsatz ' || to_char(v_start at time zone 'Europe/Berlin', 'HH24') || ' Uhr',
                                   'company', p_company, k || ':revenue', pc.founder_id);
  end if;
  if v_cogs + v_aipaid > 0 then
    perform public.ledger_transfer(v_acc, v_hh, v_cogs + v_aipaid, 'company_costs', 'Wareneinsatz und KI-Kräfte',
                                   'company', p_company, k || ':goods', pc.founder_id);
  end if;
  -- players: the hour (up to the end of a notice) at contract wage x factor, with XP and branch minutes
  update public.player_companies set pay_factor_bps = v_factor where company_id = p_company;
  for j in select pj.id, pj.player_id, pj.notice_ends_at from public.player_jobs pj
            where pj.company_id = p_company and pj.status = 'active' order by pj.id loop
    v_until := least(v_end, coalesce(j.notice_ends_at, v_end));
    perform public.lock_player_accounts(j.player_id);
    v_ppaid := v_ppaid + public.accrue_job_salary(j.id, v_until);
  end loop;

  -- fixed costs (with the expansion level) and marketing from the cash; the rest becomes an open bill
  v_fixed := round((public.company_fixed_cost_cents(pc.tier, pc.expansion_level) / v_hours)::numeric)::bigint;
  v_mk := round((pc.marketing_cents_per_quarter / v_hours)::numeric)::bigint;
  v_costs := v_fixed + v_mk;
  select greatest(0, a.balance_cents) into v_cash from public.ledger_accounts a where a.id = v_acc;
  v_paid := least(v_costs, coalesce(v_cash, 0));
  if v_paid > 0 then
    perform public.ledger_transfer(v_acc, v_hh, v_paid, 'company_costs', 'Fixkosten und Marketing',
                                   'company', p_company, k || ':costs', pc.founder_id);
  end if;
  v_unpaid := v_costs - v_paid;
  if v_unpaid = 0 and pc.unpaid_cents > 0 then
    select greatest(0, a.balance_cents) into v_cash from public.ledger_accounts a where a.id = v_acc;
    v_settle := least(pc.unpaid_cents, coalesce(v_cash, 0));
    if v_settle > 0 then
      perform public.ledger_transfer(v_acc, v_hh, v_settle, 'company_costs', 'Offene Rechnungen',
                                     'company', p_company, k || ':settle', pc.founder_id);
    end if;
  end if;

  v_profit := v_rev - v_cogs - v_ppaid - v_aipaid - v_fixed - v_mk;
  update public.player_companies
     set unpaid_cents = pc.unpaid_cents + v_unpaid - v_settle,
         distress = pc.unpaid_cents + v_unpaid - v_settle > 0,
         last_hour_at = greatest(pc.last_hour_at, v_end)
   where company_id = p_company;
  insert into public.player_company_hours (company_id, hour_start, game_quarter_id, demand_cents, capacity_cents, revenue_cents,
                                           contract_revenue_cents, cogs_cents, fixed_cents, marketing_cents, player_wages_due_cents,
                                           player_wages_paid_cents, ai_wages_due_cents, ai_wages_paid_cents, pay_factor_bps,
                                           paid_costs_cents, unpaid_added_cents, profit_cents)
  values (p_company, v_start, v_qid, round(v_demand::numeric)::bigint, round(v_cap::numeric)::bigint, v_rev,
          v_crev, v_cogs, v_fixed, v_mk, v_pdue, v_ppaid, v_aidue, v_aipaid, v_factor, v_paid, v_unpaid, v_profit);

  return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'quarter_id', v_qid, 'revenue_cents', v_rev,
                            'contract_revenue_cents', v_crev, 'profit_cents', v_profit, 'pay_factor_bps', v_factor,
                            'player_wages_paid_cents', v_ppaid, 'ai_wages_paid_cents', v_aipaid, 'unpaid_added_cents', v_unpaid);
end;
$$;
comment on function public.player_company_close_hour(uuid, timestamptz) is
  'Closes one operating hour of a player company (closeStartupHour, ADR-072/083); idempotent per (company, hour).';

-- ---------------------------------------------------------------------------
-- D. Quarter close as in M3i: marketing gain from the effective potential,
--    word of mouth x pricing.awareness (closeStartupQuarter, ADR-083)
-- ---------------------------------------------------------------------------
create or replace function public.player_company_close_quarter(p_company uuid, p_quarter_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc        public.player_companies;
  c         public.companies;
  q         public.game_quarters;
  v_su      jsonb := coalesce(public.config_jsonb('startups'), '{}'::jsonb);
  v_team    jsonb;
  v_target  double precision;
  v_quality double precision;
  v_mkq     bigint;
  v_half    double precision;
  v_gain    double precision := 0;
  v_aw      double precision;
  v_stage   integer;
  h         record;
  v_factor  integer;
  v_bwages  bigint;
  v_pool    bigint;
  v_weight  bigint;
  v_btotal  bigint := 0;
  v_bpaid   bigint := 0;
  v_b       bigint;
  v_cash    bigint;
  v_acc     uuid;
  v_xp      integer := 0;
  v_ai      integer;
  v_dq      integer;
  v_grace   integer := public.config_double('startups', '{insolvency,graceQuarters}', 4)::integer;
  v_plp     jsonb := coalesce(public.config_jsonb('jobs', '{profitLinkedPay}'), '{}'::jsonb);
  v_prev    integer;
  k         text;
  b         record;
begin
  select * into pc from public.player_companies where company_id = p_company and status = 'active' for update;
  select * into q from public.game_quarters where id = p_quarter_id;
  if pc.company_id is null or q.id is null then
    return null;
  end if;
  if exists (select 1 from public.player_company_reports r where r.company_id = p_company and r.game_quarter_id = p_quarter_id) then
    return jsonb_build_object('company_id', p_company, 'skipped', 'already_closed');
  end if;
  select * into c from public.companies where id = p_company;
  v_team := public.player_company_team(p_company);
  v_acc := public.company_cash_account(p_company);
  k := 'pcq:' || p_company::text || ':' || p_quarter_id::text;

  -- the quarter's operating hours (money was booked hourly)
  select count(*) as n,
         coalesce(sum(x.demand_cents), 0)::bigint as demand, coalesce(sum(x.capacity_cents), 0)::bigint as cap,
         coalesce(sum(x.revenue_cents), 0)::bigint as rev, coalesce(sum(x.cogs_cents), 0)::bigint as cogs,
         coalesce(sum(x.fixed_cents), 0)::bigint as fixed, coalesce(sum(x.marketing_cents), 0)::bigint as mk,
         coalesce(sum(x.player_wages_due_cents), 0)::bigint as pdue, coalesce(sum(x.player_wages_paid_cents), 0)::bigint as ppaid,
         coalesce(sum(x.ai_wages_due_cents), 0)::bigint as aidue, coalesce(sum(x.ai_wages_paid_cents), 0)::bigint as aipaid,
         coalesce(sum(x.paid_costs_cents), 0)::bigint as paidcosts, coalesce(sum(x.unpaid_added_cents), 0)::bigint as unpaid,
         coalesce(sum(x.profit_cents), 0)::bigint as profit
    into h
    from public.player_company_hours x where x.company_id = p_company and x.game_quarter_id = q.id;
  v_factor := case when h.pdue + h.aidue <= 0 then 10000
                   else least(10000, (h.ppaid + h.aipaid) * 10000 / (h.pdue + h.aidue))::integer end;

  -- quality towards what the team can do, awareness by word of mouth (x pricing.awareness) and marketing
  -- (half saturation from the effective potential, ADR-083) for the next quarter
  v_target := public.cfg_num(v_su, '{quality,base}', 0.25)
            + (1 - public.cfg_num(v_su, '{quality,base}', 0.25))
              * (greatest(0, (v_team ->> 'team_sector_score')::double precision)
                 / (greatest(0, (v_team ->> 'team_sector_score')::double precision) + public.cfg_num(v_su, '{quality,halfSaturationScore}', 20)));
  v_stage := least(greatest((v_team ->> 'stage')::integer, 0),
                   greatest(jsonb_array_length(coalesce(v_su #> '{stages,awarenessCaps}', '[1]'::jsonb)) - 1, 0));
  v_target := least(1, v_target + public.cfg_num(v_su, '{stages,qualityBonusPerStage}', 0.05) * v_stage);
  -- AI workers do standard work (ADR-069)
  v_target := v_target * (1 - public.cfg_num(v_su, '{aiQualityPenalty}', 0.3)
              * pc.ai_workers::double precision
              / greatest(1, 1 + coalesce((v_team ->> 'employees')::integer, 0) + pc.ai_workers));
  v_quality := least(1, greatest(0, pc.quality + public.cfg_num(v_su, '{quality,adjustPerQuarter}', 0.35) * (v_target - pc.quality)));
  v_mkq := pc.marketing_cents_per_quarter;
  if v_mkq > 0 then
    v_half := greatest(public.cfg_num(v_su, '{awareness,marketingMinHalfSaturationCents}', 50000),
                       pc.potential_annual_cents * public.company_market_factor(pc.tier, pc.expansion_level) / 4.0
                       * public.cfg_num(v_su, '{awareness,marketingHalfSaturationShare}', 0.1));
    v_gain := public.cfg_num(v_su, '{awareness,marketingMaxGain}', 0.12) * v_mkq / (v_mkq + v_half);
  end if;
  v_aw := least(greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
                         coalesce((v_su #>> array['stages', 'awarenessCaps', v_stage::text])::double precision, 1)),
          greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
            pc.awareness
            + public.cfg_num(v_su, '{awareness,growthPerQuarter}', 0.3)
              * (public.company_price_effect(pc.price_level, pc.quality) ->> 'awareness')::double precision
              * pc.awareness * (1 - pc.awareness) * (0.5 + v_quality)
            + v_gain
            - public.cfg_num(v_su, '{awareness,decayPerQuarter}', 0.03) * pc.awareness));

  -- profit bonus (ADR-058): bonusShareOfProfit of the quarter's profit (after wages) by base-wage weight,
  -- at most maxBonusFactor x the base wages of the quarter
  select coalesce(sum(coalesce(sp.base_amount_cents, sp.minutes_paid::bigint * j.salary_cents_per_hour / 60)), 0) into v_bwages
    from public.salary_payouts sp join public.player_jobs j on j.id = sp.player_job_id
   where j.company_id = p_company and sp.period_end > q.starts_at and sp.period_end <= q.ends_at;
  if to_regclass('pg_temp.nexa_bonus') is null then
    create temporary table nexa_bonus (job_id uuid, player_id uuid, bonus bigint) on commit drop;
  end if;
  delete from pg_temp.nexa_bonus;
  if h.profit > 0 then
    select coalesce(sum(x.w), 0) into v_weight
      from (select sum(coalesce(sp.base_amount_cents, sp.minutes_paid::bigint * j.salary_cents_per_hour / 60)) as w
              from public.salary_payouts sp join public.player_jobs j on j.id = sp.player_job_id
             where j.company_id = p_company and j.status = 'active' and sp.period_end > q.starts_at and sp.period_end <= q.ends_at
             group by j.id) x;
    if v_weight > 0 then
      v_pool := floor(h.profit * public.cfg_num(v_plp, '{bonusShareOfProfit}', 0.2))::bigint;
      insert into pg_temp.nexa_bonus (job_id, player_id, bonus)
      select x.id, x.player_id, least(v_pool * x.w / v_weight, floor(x.w * public.cfg_num(v_plp, '{maxBonusFactor}', 1))::bigint)
        from (select j.id, j.player_id, sum(coalesce(sp.base_amount_cents, sp.minutes_paid::bigint * j.salary_cents_per_hour / 60)) as w
                from public.salary_payouts sp join public.player_jobs j on j.id = sp.player_job_id
               where j.company_id = p_company and j.status = 'active' and sp.period_end > q.starts_at and sp.period_end <= q.ends_at
               group by j.id, j.player_id) x;
      delete from pg_temp.nexa_bonus where bonus <= 0;
      select coalesce(sum(bonus), 0) into v_btotal from pg_temp.nexa_bonus;
    end if;
  end if;
  if v_btotal > 0 then
    -- paid only from the cash that is there (scaled down proportionally)
    select greatest(0, a.balance_cents) into v_cash from public.ledger_accounts a where a.id = v_acc;
    for b in select * from pg_temp.nexa_bonus order by job_id loop
      v_b := case when v_cash >= v_btotal then b.bonus else b.bonus * v_cash / v_btotal end;
      if v_b > 0 then
        perform public.lock_player_accounts(b.player_id);
        perform public.ledger_transfer(v_acc, public.ledger_player_account(b.player_id, 'player_cash'), v_b, 'work_bonus',
                                       'Bonus ' || public.game_quarter_label(q.id), 'player_job', b.job_id,
                                       k || ':bonus:' || b.job_id::text, b.player_id);
        perform public.loan_withhold(b.player_id, v_b, k || ':bonus:' || b.job_id::text);
        insert into public.salary_payouts (player_job_id, player_id, pay_day, period_start, period_end, minutes_paid, amount_cents,
                                           bonus_cents, base_amount_cents)
        values (b.job_id, b.player_id, (q.ends_at at time zone 'Europe/Berlin')::date, q.starts_at, q.ends_at, 0, 0, v_b, 0);
        v_bpaid := v_bpaid + v_b;
      end if;
    end loop;
  end if;

  if h.profit > 0 then
    v_xp := public.grant_xp(pc.founder_id, 'company_quarter_profit',
                            public.config_double('progression', '{xpSources,profitableCompanyQuarter,xp}', 500)::integer,
                            'company_quarter:' || p_company::text || ':' || q.id::text, 'company', p_company);
  end if;

  -- distress (ADR-058): open bills at the close count one quarter; new bills this quarter let the AI workers go
  v_ai := case when pc.unpaid_cents > 0 and h.unpaid > 0 then 0 else pc.ai_workers end;
  v_dq := case when pc.unpaid_cents > 0 then pc.distress_quarters + 1 else 0 end;
  update public.player_companies
     set awareness = v_aw, quality = v_quality, quarters_active = quarters_active + 1, last_closed_quarter_id = q.id,
         distress = pc.unpaid_cents > 0, distress_quarters = v_dq, ai_workers = v_ai
   where company_id = p_company;

  select r.pay_factor_bps into v_prev
    from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
   where r.company_id = p_company order by gq.ends_at desc limit 1;
  insert into public.player_company_reports (company_id, game_quarter_id, label, demand_cents, capacity_cents, revenue_cents,
                                             cogs_cents, fixed_cents, ai_worker_cents, marketing_cents, wages_cents,
                                             operating_profit_cents, utilization_bps, paid_costs_cents, unpaid_added_cents,
                                             awareness_bps, quality_bps, team_productivity_bps, team_sector_score,
                                             base_wages_cents, bonus_cents, pay_factor_bps)
  values (p_company, q.id, public.game_quarter_label(q.id), h.demand, h.cap, h.rev, h.cogs, h.fixed, h.aipaid, h.mk, h.ppaid,
          h.profit, round(case when h.cap > 0 then least(1, h.demand::double precision / h.cap) else 1 end * 10000)::integer,
          h.cogs + h.aipaid + h.paidcosts, h.unpaid, round(v_aw * 10000)::integer, round(v_quality * 10000)::integer,
          (v_team ->> 'team_productivity_bps')::integer, (v_team ->> 'team_sector_score')::integer,
          v_bwages, v_bpaid, v_factor);

  -- listed: fair value per share = company value / shares outstanding (ADR-067)
  if c.phase = 'listed' and c.security_id is not null then
    update public.security_sim_state
       set fair_value_e4 = greatest(1, public.company_value_cents(p_company) * 100 / greatest(c.shares_outstanding, 1))
     where security_id = c.security_id;
  end if;

  -- company chat
  perform public.company_system_message(p_company, 'Quartal ' || public.game_quarter_label(q.id) || ': Umsatz '
                                                   || public.format_eur(h.rev) || ', Gewinn ' || public.format_eur(h.profit) || '.');
  if v_bpaid > 0 then
    perform public.company_system_message(p_company, 'Bonus für das Team: ' || public.format_eur(v_bpaid) || '.');
  end if;
  if v_factor <> coalesce(v_prev, 10000) then
    perform public.company_system_message(p_company, 'Lohnfaktor im Quartal: ' || floor(v_factor / 100.0) || ' %.');
  end if;
  -- insolvency after graceQuarters closes with open bills (isInsolvent)
  if v_dq >= v_grace then
    perform public.company_dissolve(p_company, 'insolvent');
  elsif v_dq > 0 then
    perform public.company_system_message(p_company, 'Achtung: offene Rechnungen. Noch ' || (v_grace - v_dq)
                                                     || case when v_grace - v_dq = 1 then ' Quartal' else ' Quartale' end
                                                     || ' bis zur Insolvenz.');
  end if;

  return jsonb_build_object('company_id', p_company, 'quarter_id', q.id, 'hours', h.n, 'revenue_cents', h.rev,
                            'operating_profit_cents', h.profit, 'unpaid_added_cents', h.unpaid, 'xp', v_xp,
                            'base_wages_cents', v_bwages, 'bonus_cents', v_bpaid, 'pay_factor_bps', v_factor,
                            'distress_quarters', v_dq, 'dissolved', v_dq >= v_grace);
end;
$$;

-- ---------------------------------------------------------------------------
-- E. COMPANY: live details, contract revenue per hour, levers
-- ---------------------------------------------------------------------------
create or replace function public.company_live_json(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc        public.player_companies;
  v_day     timestamptz := ((public.game_now() at time zone 'Europe/Berlin')::date)::timestamp at time zone 'Europe/Berlin';
  v_qid     bigint := (public.current_game_quarter()).id;
  v_rev     bigint;
  v_profit  bigint;
  v_trev    bigint;
  v_tprofit bigint;
  v_qrev    bigint;
  v_qprofit bigint;
  h         public.player_company_hours;
begin
  select * into pc from public.player_companies where company_id = p_company;
  select * into h from public.player_company_hours x where x.company_id = p_company order by x.hour_start desc limit 1;
  v_rev := h.revenue_cents;
  v_profit := h.profit_cents;
  select coalesce(sum(x.revenue_cents), 0), coalesce(sum(x.profit_cents), 0) into v_trev, v_tprofit
    from public.player_company_hours x
   where x.company_id = p_company and x.hour_start >= v_day
     and x.hour_start < ((v_day at time zone 'Europe/Berlin') + interval '1 day') at time zone 'Europe/Berlin';
  select coalesce(sum(x.revenue_cents), 0), coalesce(sum(x.profit_cents), 0) into v_qrev, v_qprofit
    from public.player_company_hours x where x.company_id = p_company and x.game_quarter_id = v_qid;
  return jsonb_build_object(
    'last_hour_at', pc.last_hour_at,
    'revenue_per_hour_cents', coalesce(v_rev, 0),
    'profit_per_hour_cents', coalesce(v_profit, 0),
    'pay_factor_bps', pc.pay_factor_bps,
    'today_revenue_cents', v_trev,
    'today_profit_cents', v_tprofit,
    'quarter_revenue_cents', v_qrev,
    'quarter_profit_cents', v_qprofit,
    -- the last closed hour in detail (ADR-083: profit coach)
    'contract_revenue_per_hour_cents', coalesce(h.contract_revenue_cents, 0),
    'demand_per_hour_cents', coalesce(h.demand_cents, 0),
    'capacity_per_hour_cents', coalesce(h.capacity_cents, 0),
    'fixed_per_hour_cents', coalesce(h.fixed_cents, 0),
    'ai_wages_per_hour_cents', coalesce(h.ai_wages_paid_cents, 0),
    'marketing_per_hour_cents', coalesce(h.marketing_cents, 0));
end;
$$;
comment on function public.company_live_json(uuid) is
  'COMPANY.live: last closed hour (with its details, ADR-083), Berlin day and running quarter of a player company (ADR-072).';

create or replace function public.company_hours_json(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('hour_start', x.hour_start, 'revenue_cents', x.revenue_cents,
                                               'contract_revenue_cents', x.contract_revenue_cents,
                                               'profit_cents', x.profit_cents) order by x.hour_start), '[]'::jsonb)
    from (select h.hour_start, h.revenue_cents, h.contract_revenue_cents, h.profit_cents from public.player_company_hours h
           where h.company_id = p_company order by h.hour_start desc limit 24) x;
$$;
comment on function public.company_hours_json(uuid) is 'COMPANY.hours: the last 24 closed operating hours, oldest first.';

-- company_state as in M3j plus the levers of ADR-083 (appended: jsonb_build_object takes at most 100 arguments);
-- max_employees, capacity_cents and the estimate now include legal form and expansion
create or replace function public.company_state(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc       public.player_companies;
  c        public.companies;
  v_team   jsonb;
  v_tier   jsonb;
  v_sb     jsonb;
  v_level  integer;
  v_cash   bigint;
  v_spread double precision;
  v_last   jsonb;
  v_hist   jsonb;
  v_cost   bigint;
  v_mf     double precision;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  select * into c from public.companies where id = p_company;
  v_team := public.player_company_team(p_company);
  v_tier := public.company_tier_cfg(pc.tier);
  v_sb := public.company_tier_cfg('small_business');
  select p.level into v_level from public.profiles p where p.id = pc.founder_id;
  v_cash := coalesce((select a.balance_cents from public.ledger_accounts a where a.owner_company_id = p_company and a.kind = 'company_cash'), 0);
  v_spread := public.config_double('startups', '{estimate,initialSpread}', 2.3)
            * power(public.config_double('startups', '{estimate,decayPerQuarter}', 0.85), pc.quarters_active);
  select jsonb_build_object(
           'label', r.label, 'demand_cents', r.demand_cents, 'capacity_cents', r.capacity_cents,
           'revenue_cents', r.revenue_cents, 'cogs_cents', r.cogs_cents, 'fixed_cents', r.fixed_cents,
           'ai_worker_cents', r.ai_worker_cents, 'marketing_cents', r.marketing_cents, 'wages_cents', r.wages_cents,
           'operating_profit_cents', r.operating_profit_cents, 'utilization_bps', r.utilization_bps,
           'bonus_cents', r.bonus_cents)
    into v_last
    from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
   where r.company_id = p_company order by gq.ends_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('label', h.label, 'revenue_cents', h.revenue_cents,
                                               'profit_cents', h.operating_profit_cents) order by h.ends_at), '[]'::jsonb)
    into v_hist
    from (select r.label, r.revenue_cents, r.operating_profit_cents, gq.ends_at
            from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
           where r.company_id = p_company order by gq.ends_at desc limit 12) h;
  v_cost := public.company_upgrade_cost(pc.tier);
  -- the estimate describes the market the company reaches (ADR-083)
  v_mf := public.company_market_factor(pc.tier, pc.expansion_level);
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'idea', pc.idea,
    'sector', c.sector_key,
    'color', c.brand_color,
    'logo', public.company_logo(p_company),
    'logo_hidden', pc.logo_hidden,
    'founder_has_job', exists (select 1 from public.player_jobs x where x.player_id = pc.founder_id and x.status = 'active'),
    'full_time_from', public.config_double('startups', '{fullTimeFromEmployees}', 5)::integer,
    'training_from', public.config_double('startups', '{training,fromEmployees}', 5)::integer,
    'headcount', public.company_headcount(p_company),
    'tier', pc.tier,
    'founded_at', c.founded_at,
    'cash_cents', v_cash,
    'value_cents', public.company_value_cents(p_company),
    'unpaid_cents', pc.unpaid_cents,
    'distress', pc.distress,
    'distress_quarters', pc.distress_quarters,
    'grace_quarters', public.config_double('startups', '{insolvency,graceQuarters}', 4)::integer,
    'pay_factor_bps', pc.pay_factor_bps,
    'product_key', public.company_product(p_company) ->> 'key',
    'stage', (v_team ->> 'stage')::integer,
    'stages', public.company_stages_json(p_company),
    'awareness_bps', round(pc.awareness * 10000)::integer,
    'quality_bps', round(pc.quality * 10000)::integer,
    'quarters_active', pc.quarters_active,
    'estimate_low_cents', round(pc.potential_annual_cents * v_mf
                                * exp(-v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':low'))))::bigint,
    'estimate_high_cents', round(pc.potential_annual_cents * v_mf
                                 * exp(v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':high'))))::bigint,
    'marketing_cents_per_quarter', pc.marketing_cents_per_quarter,
    'ai_workers', pc.ai_workers,
    'ai_worker_cost_cents', public.config_bigint('startups', '{aiWorkerCostCentsPerQuarter}', 72000),
    'ai_wage_cents_per_hour', public.config_bigint('startups', '{aiWorkerWageCentsPerHour}', 12000),
    'ai_worker_skills', to_jsonb(pc.ai_worker_skills),
    'max_employees', public.company_max_employees(p_company),
    'employees', (v_team ->> 'employees')::integer,
    'open_postings', (select count(*) from public.job_postings jp where jp.company_id = p_company and jp.status = 'open')::integer,
    'pending_applications', (select count(*) from public.job_applications a join public.job_postings jp on jp.id = a.posting_id
                              where jp.company_id = p_company and a.status = 'pending')::integer,
    'founder_productivity_bps', (v_team ->> 'founder_productivity_bps')::integer,
    'team_productivity_bps', (v_team ->> 'team_productivity_bps')::integer,
    'capacity_cents', round((v_team ->> 'capacity_cents')::bigint * public.company_capacity_factor(pc.expansion_level))::bigint,
    'next_quarter_at', coalesce((public.current_game_quarter()).ends_at, public.game_now()),
    'can_upgrade', public.company_next_tier(pc.tier) is not null
                   and coalesce(v_level, 1) >= (public.company_tier_cfg(public.company_next_tier(pc.tier)) ->> 'minLevel')::integer,
    'listing', public.company_listing_json(p_company, pc.founder_id),
    'can_go_public', c.phase = 'private' and public.company_open_offer(p_company) is null
                     and coalesce(public.config_jsonb('startups', '{ipo,fromTiers}'), '["garage", "small_business", "gmbh"]'::jsonb) ? pc.tier
                     and coalesce(v_level, 1) >= public.config_double('startups', '{ipo,minLevel}', 6),
    'can_capital_increase', c.phase = 'listed' and public.company_open_offer(p_company) is null,
    'upgrade_cost_cents', v_cost,
    'last_quarter', v_last,
    'history', v_hist,
    'live', public.company_live_json(p_company),
    'hours', public.company_hours_json(p_company))
    || jsonb_build_object(
         'banner', pc.banner,
         -- ADR-083: price strategy, contract work, expansion
         'price_level', pc.price_level,
         'contract_work', pc.contract_work,
         'expansion_level', pc.expansion_level,
         'can_expand', public.company_can_expand(pc.tier),
         'expansion_cost_cents', case when public.company_can_expand(pc.tier)
                                      then public.company_expansion_cost_cents(pc.expansion_level) end,
         'market_factor', round(v_mf::numeric, 4));
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Founding as a GmbH, places with expansion levels
-- ---------------------------------------------------------------------------
-- found_company as in M3f, also as a GmbH (startups.gmbh), with the awareness head start of the tier (ADR-083)
create or replace function public.found_company(p_request_id uuid, p_name text, p_idea text, p_sector text, p_color text,
                                                p_tier text, p_product text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_idea   text := btrim(coalesce(p_idea, ''));
  v_reason text;
  v_tier   jsonb;
  v_level  integer;
  v_cost   bigint;
  v_cash   bigint;
  v_id     uuid := gen_random_uuid();
  v_acc    uuid;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'found_company');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  if coalesce(p_tier, '') not in ('garage', 'small_business', 'gmbh')
     or not exists (select 1 from public.sectors s where s.key = p_sector)
     or public.config_jsonb('startups', array['capacityCentsPerProductivity', p_sector]) is null
     or coalesce(p_color, '') !~ '^#[0-9a-fA-F]{6}$'
     or char_length(v_idea) not between 1 and 120
     or (p_product is not null
         and not exists (select 1 from jsonb_array_elements(coalesce(public.config_jsonb('startups', array['products', p_sector]), '[]'::jsonb)) x
                          where x ->> 'key' = p_product)) then
    perform public.api_error('invalid_argument');
  end if;
  if public.text_has_profanity(v_idea) then
    perform public.api_error('name_profanity');
  end if;
  perform 1 from public.profiles p where p.id = v_player for update;
  if exists (select 1 from public.player_companies pc where pc.founder_id = v_player and pc.status = 'active') then
    perform public.api_error('company_exists');
  end if;
  if exists (select 1 from public.profiles p where p.id = v_player and p.founding_locked_until > now()) then
    perform public.api_error('founding_locked');
  end if;
  v_reason := public.name_violation(p_name, 'company');
  if v_reason is not null then
    perform public.api_error(v_reason);
  end if;
  v_tier := public.company_tier_cfg(p_tier);
  select p.level into v_level from public.profiles p where p.id = v_player;
  if v_level < (v_tier ->> 'minLevel')::integer then
    perform public.api_error('company_level_too_low');
  end if;
  v_cost := (v_tier ->> 'foundingCostCents')::bigint;
  perform public.lock_player_accounts(v_player);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;

  insert into public.companies (id, name, slug, description, sector_key, is_ai, legal_form, phase, founder_id, ceo_id,
                                brand_color, shares_outstanding, max_employees, founded_quarter_id, founded_at)
  values (v_id, p_name, trim(both '-' from lower(regexp_replace(p_name, '[^A-Za-z0-9]+', '-', 'g'))) || '-' || left(v_id::text, 8),
          v_idea, p_sector, false, case when p_tier = 'gmbh' then 'gmbh' else 'small_business' end::public.legal_form, 'private', v_player, v_player, lower(p_color), 1,
          (v_tier ->> 'maxEmployees')::integer, (public.current_game_quarter()).id, now());
  insert into public.ledger_accounts (kind, owner_company_id, label) values ('company_cash', v_id, 'Firmenkasse')
  returning id into v_acc;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), v_acc, v_cost, 'company_founding',
                                   'Gründung ' || p_name, 'company', v_id, 'found:' || v_id::text, v_player);
  end if;
  insert into public.player_companies (company_id, founder_id, idea, tier, potential_annual_cents, awareness, quality, request_id,
                                       product_key)
  values (v_id, v_player, v_idea, p_tier, public.startup_potential_from_uniform(1 - random()),
          -- founding bigger buys a head start (ADR-083, initialStartup(tier))
          least(1, greatest(0, public.config_double('startups', array['foundingAwareness', p_tier],
                                                    public.config_double('startups', '{awareness,initial}', 0.03)))),
          public.config_double('startups', '{quality,base}', 0.25),
          p_request_id,
          coalesce(p_product, public.config_jsonb('startups', array['products', p_sector]) -> 0 ->> 'key'));
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_id)));
end;
$$;

create or replace function public.sign_contract(p_request_id uuid, p_application_id uuid, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  a        public.job_applications;
  p        public.job_postings;
  v_scores jsonb;
begin
  v_player := public.require_player();
  if p_request_id is null or p_signature is null or char_length(p_signature) < 1 or char_length(p_signature) > 8000 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'sign_contract');
  if v_replay is not null then
    return v_replay;
  end if;
  perform 1 from public.profiles pr where pr.id = v_player for update;
  select * into a from public.job_applications where id = p_application_id and player_id = v_player for update;
  if a.id is null then
    perform public.api_error('application_not_found');
  end if;
  if a.status <> 'offered' then
    perform public.api_error('application_not_offered');
  end if;
  if a.offer_expires_at <= now() then
    perform public.api_error('offer_expired');
  end if;
  if exists (select 1 from public.player_jobs j where j.player_id = v_player and j.status = 'active') then
    perform public.api_error('job_active_exists');
  end if;
  select * into p from public.job_postings where id = a.posting_id;
  -- founders: a job elsewhere only while the company has fewer than fullTimeFromEmployees people (ADR-066)
  if exists (select 1 from public.player_companies pc where pc.founder_id = v_player and pc.status = 'active'
                and (pc.company_id = p.company_id
                     or public.company_headcount(pc.company_id) >= public.config_double('startups', '{fullTimeFromEmployees}', 5))) then
    perform public.api_error('owns_company');
  end if;
  -- player companies: players with an active job there + AI workers <= max employees (tier and expansion, ADR-083)
  if exists (select 1 from public.player_companies pc where pc.company_id = p.company_id and pc.status = 'active'
                and (select count(*) from public.player_jobs j where j.company_id = pc.company_id and j.status = 'active')
                    + pc.ai_workers + 1 > public.company_max_employees(pc.company_id)) then
    perform public.api_error('employee_limit');
  end if;
  if p.slots is not null
     and (select count(*) from public.player_jobs j where j.posting_id = p.id and j.status = 'active') >= p.slots then
    perform public.api_error('job_not_found');
  end if;
  v_scores := public.player_branch_scores(v_player);
  insert into public.player_jobs (player_id, company_id, request_id, tier, title, title_key, required, salary_cents_per_hour,
                                  ceiling_cents_per_hour, raise_base_score, posting_id, application_id, signature,
                                  last_paid_at, started_at, paid_day, paid_minutes_today)
  values (v_player, p.company_id, p_request_id, p.tier, coalesce(p.title, p.title_key), p.title_key, p.required,
          a.offer_salary_cents_per_hour,
          case when p.is_ai then public.ai_salary_ceiling(p.salary_cents_per_hour, public.job_match_score(v_scores, p.required)) end,
          public.job_match_score(v_scores, p.required), p.id, a.id, p_signature,
          public.game_now(), public.game_now(), (public.game_now() at time zone 'Europe/Berlin')::date, 0);
  update public.job_applications set status = 'signed', signature = p_signature where id = a.id;
  update public.job_applications set status = 'closed'
   where player_id = v_player and id <> a.id and status in ('pending', 'offered');
  perform public.company_system_message(p.company_id,
    (select pr.nickname from public.profiles pr where pr.id = v_player) || ' ist jetzt im Team.');
  perform public.company_full_time_check(p.company_id);
  return public.request_complete(v_player, p_request_id, public.job_state(v_player));
end;
$$;

create or replace function public.set_ai_workers(p_request_id uuid, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  pc        public.player_companies;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_count is null or p_count < 0 or p_count > 1000 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_ai_workers');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  if p_count + (select count(*) from public.player_jobs j where j.company_id = v_company and j.status = 'active')
     > public.company_max_employees(v_company) then
    perform public.api_error('employee_limit');
  end if;
  update public.player_companies set ai_workers = p_count where company_id = v_company;
  perform public.company_full_time_check(v_company);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

-- hire_ai_workers as in M3h; places include the expansion levels (ADR-083)
create or replace function public.hire_ai_workers(p_request_id uuid, p_count integer, p_skill text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  pc        public.player_companies;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_count is null or p_count < 1 or p_count > 1000
     or (p_skill is not null and p_count <> 1) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'hire_ai_workers');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  if p_skill is not null then
    if not exists (select 1
                     from jsonb_array_elements(coalesce(public.company_product(v_company) -> 'stages', '[]'::jsonb)) st,
                          jsonb_array_elements_text(st) k
                    where k = p_skill) then
      perform public.api_error('invalid_argument');
    end if;
    if p_skill = any (pc.ai_worker_skills) then
      raise exception using errcode = 'NX062', message = 'skill_already_covered';
    end if;
  end if;
  if pc.ai_workers + p_count
     + (select count(*) from public.player_jobs j where j.company_id = v_company and j.status = 'active')
     > public.company_max_employees(v_company) then
    perform public.api_error('employee_limit');
  end if;
  update public.player_companies
     set ai_workers = ai_workers + p_count,
         ai_worker_skills = case when p_skill is null then ai_worker_skills else ai_worker_skills || p_skill end
   where company_id = v_company;
  perform public.company_full_time_check(v_company);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

-- ---------------------------------------------------------------------------
-- G. IPO from startups.ipo (garage included, level 6)
-- ---------------------------------------------------------------------------
-- go_public as in M3f; tiers and level only from startups.ipo (fallback: the values of ADR-083)
create or replace function public.go_public(p_request_id uuid, p_share_percent integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  pc        public.player_companies;
  c         public.companies;
  v_ipo     jsonb := coalesce(public.config_jsonb('startups', '{ipo}'), '{}'::jsonb);
  v_total   bigint;
  v_price   bigint;
  v_level   integer;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_share_percent is null
     or p_share_percent < public.cfg_num(v_ipo, '{minSharePercent}', 10) or p_share_percent > public.cfg_num(v_ipo, '{maxSharePercent}', 49) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'go_public');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  select * into c from public.companies where id = v_company;
  if c.phase in ('ipo', 'listed') or public.company_open_offer(v_company) is not null then
    perform public.api_error('already_listed');
  end if;
  select p.level into v_level from public.profiles p where p.id = v_player;
  if v_level < public.cfg_num(v_ipo, '{minLevel}', 6) then
    perform public.api_error('company_level_too_low');
  end if;
  if not (coalesce(v_ipo -> 'fromTiers', '["garage", "small_business", "gmbh"]'::jsonb) ? pc.tier) then
    perform public.api_error('company_upgrade_unavailable');
  end if;
  v_total := public.cfg_num(v_ipo, '{sharesTotal}', 1000000)::bigint * 1000000;
  -- issuePriceCents: company value over all shares, at least minIssuePriceCents
  v_price := greatest(public.cfg_num(v_ipo, '{minIssuePriceCents}', 100)::bigint,
                      round(public.company_value_cents(v_company)::numeric / public.cfg_num(v_ipo, '{sharesTotal}', 1000000)::numeric)::bigint);
  insert into public.company_share_offers (company_id, kind, price_cents, shares_total_e6, shares_offered_e6, request_id, ends_at)
  values (v_company, 'ipo', v_price, v_total, v_total * p_share_percent / 100, p_request_id,
          now() + make_interval(secs => public.cfg_num(v_ipo, '{subscriptionHours}', 12) * 3600));
  update public.companies set phase = 'ipo' where id = v_company;
  perform public.company_system_message(v_company, 'Börsengang: ' || p_share_percent || ' % der Aktien zu '
                                                   || public.format_eur(v_price) || ' je Aktie, Zeichnung läuft.');
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

-- ---------------------------------------------------------------------------
-- H. RPCs: price strategy and contract work, expansion levels
-- ---------------------------------------------------------------------------
-- set_company_strategy: price level budget | normal | premium and contract work on/off (founder only)
create or replace function public.set_company_strategy(p_request_id uuid, p_price_level text, p_contract_work boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_contract_work is null or coalesce(p_price_level, '') not in ('budget', 'normal', 'premium') then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_company_strategy');
  if v_replay is not null then
    return v_replay;
  end if;
  update public.player_companies set price_level = p_price_level, contract_work = p_contract_work where company_id = v_company;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;
comment on function public.set_company_strategy(uuid, text, boolean) is
  'RPC (founder): price strategy budget | normal | premium and contract work on/off (ADR-083); error invalid_argument.';

-- expand_company: the next expansion level, paid from the company cash to the households (money sink back into the cycle)
create or replace function public.expand_company(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  pc        public.player_companies;
  v_cost    bigint;
  v_free    bigint;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'expand_company');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  if not public.company_can_expand(pc.tier) then
    perform public.api_error('company_upgrade_unavailable');
  end if;
  v_cost := public.company_expansion_cost_cents(pc.expansion_level);
  -- free cash: open bills come first (as company_withdraw)
  select a.balance_cents - pc.unpaid_cents into v_free
    from public.ledger_accounts a where a.owner_company_id = v_company and a.kind = 'company_cash' for update;
  if coalesce(v_free, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.company_cash_account(v_company), public.ledger_system_account('households'), v_cost,
                                   'company_costs', 'Ausbaustufe ' || (pc.expansion_level + 1), 'company', v_company,
                                   'expand:' || v_company::text || ':' || (pc.expansion_level + 1), v_player);
  end if;
  update public.player_companies set expansion_level = pc.expansion_level + 1 where company_id = v_company;
  update public.companies set max_employees = public.company_max_employees(v_company) where id = v_company;
  perform public.company_system_message(v_company, 'Ausbaustufe ' || (pc.expansion_level + 1) || ' für '
                                                   || public.format_eur(v_cost) || ': mehr Plätze, Kapazität und Markt.');
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;
comment on function public.expand_company(uuid) is
  'RPC (founder): buys the next expansion level from the company cash (ADR-083); errors company_upgrade_unavailable, insufficient_funds.';

-- ---------------------------------------------------------------------------
-- I. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.company_market_factor(text, integer)', 'public.company_capacity_factor(integer)',
    'public.company_fixed_cost_cents(text, integer)', 'public.company_max_employees(uuid)', 'public.company_can_expand(text)',
    'public.company_expansion_cost_cents(integer)', 'public.company_price_effect(text, double precision)',
    'public.player_company_close_hour(uuid, timestamptz)', 'public.player_company_close_quarter(uuid, bigint)',
    'public.company_live_json(uuid)', 'public.company_hours_json(uuid)', 'public.company_state(uuid)',
    'public.found_company(uuid, text, text, text, text, text, text)', 'public.sign_contract(uuid, uuid, text)',
    'public.set_ai_workers(uuid, integer)', 'public.hire_ai_workers(uuid, integer, text)', 'public.go_public(uuid, integer)',
    'public.set_company_strategy(uuid, text, boolean)', 'public.expand_company(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.found_company(uuid, text, text, text, text, text, text)', 'public.sign_contract(uuid, uuid, text)',
    'public.set_ai_workers(uuid, integer)', 'public.hire_ai_workers(uuid, integer, text)', 'public.go_public(uuid, integer)',
    'public.set_company_strategy(uuid, text, boolean)', 'public.expand_company(uuid)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
