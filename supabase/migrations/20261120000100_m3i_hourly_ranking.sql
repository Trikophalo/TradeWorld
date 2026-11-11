-- =============================================================================
-- NEXA · M3i · 0100 · Hourly operations (ADR-072) and company ranking (ADR-074)
-- =============================================================================
-- Player companies earn every hour (docs/COMPANY_GROWTH.md, section 2). Mirrors
-- closeStartupHour in src/lib/sim/startup.ts:
--   demand/h   = potential / 4 / quarterHours × awareness × (0.5 + 0.5 × quality) × exp(noise × gauss)
--   capacity/h = team capacity × (1 + capacityBonusPerStage × stage) / quarterHours
--   revenue/h  = min(demand, capacity); goods = revenue × (1 − grossMargin)
--   wages due  = AI workers × aiWorkerWageCentsPerHour + Σ hourly contract wages of the players
--   payFactor  = due ≤ 0 ? 10000 : clamp(floor(max(0, gross) × 10000 / due), 0, 10000)
-- Players and AI workers are paid in the same hourly close with the same factor,
-- never with more than the hour earned (revenue − goods). Fixed costs and marketing
-- (per quarter / quarterHours) come from the company cash; what it cannot pay is
-- added to unpaid_cents (distress, ADR-058, still counted per quarter).
--
-- Player-company jobs are paid only in the hourly close (accrue_job_salary with
-- the hour's factor). accrue_salaries pays AI-company jobs only, in whole hours.
-- Paths that settle a job mid-hour (quit, fire, quit at once, dissolution,
-- account reset, training) keep calling accrue_job_salary, which pays the partial
-- hour at the company's current pay_factor_bps (the last hour's factor), capped
-- by the company cash.
--
-- The quarter close no longer books money for operations: it aggregates the
-- quarter's hours into player_company_reports (same columns), then updates
-- awareness and quality, pays the profit bonus (ADR-058) from the quarter's
-- profit, grants XP, counts distress quarters and posts the chat line.
--
-- get_company_ranking (ADR-074): player companies by value (listed: market value),
-- with scope 'all' also the listed AI companies by market value.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.player_companies add column if not exists last_hour_at timestamptz;
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) where last_hour_at is null;
alter table public.player_companies alter column last_hour_at set default date_trunc('hour', public.game_now());
alter table public.player_companies alter column last_hour_at set not null;
comment on column public.player_companies.last_hour_at is
  'End of the last closed operating hour = start of the next hour to close (ADR-072).';
comment on column public.player_companies.pay_factor_bps is
  'Pay factor of the last closed operating hour (ADR-072); mid-hour settlements use it.';

create table if not exists public.player_company_hours (
  company_id              uuid not null references public.player_companies (company_id) on delete cascade,
  hour_start              timestamptz not null,
  game_quarter_id         bigint references public.game_quarters (id),
  demand_cents            bigint not null,
  capacity_cents          bigint not null,
  revenue_cents           bigint not null check (revenue_cents >= 0),
  cogs_cents              bigint not null check (cogs_cents >= 0),
  fixed_cents             bigint not null check (fixed_cents >= 0),
  marketing_cents         bigint not null check (marketing_cents >= 0),
  player_wages_due_cents  bigint not null default 0 check (player_wages_due_cents >= 0),
  player_wages_paid_cents bigint not null default 0 check (player_wages_paid_cents >= 0),
  ai_wages_due_cents      bigint not null default 0 check (ai_wages_due_cents >= 0),
  ai_wages_paid_cents     bigint not null default 0 check (ai_wages_paid_cents >= 0),
  pay_factor_bps          integer not null check (pay_factor_bps between 0 and 10000),
  paid_costs_cents        bigint not null default 0 check (paid_costs_cents >= 0),
  unpaid_added_cents      bigint not null default 0 check (unpaid_added_cents >= 0),
  profit_cents            bigint not null,
  created_at              timestamptz not null default now(),
  primary key (company_id, hour_start)
);
alter table public.player_company_hours enable row level security;
create index if not exists player_company_hours_quarter_idx on public.player_company_hours (company_id, game_quarter_id);
create index if not exists player_company_hours_start_idx on public.player_company_hours (hour_start);
comment on table public.player_company_hours is
  'Operating hours of player companies (closeStartupHour, ADR-072); about the last 7 days are kept.';
comment on column public.player_company_hours.paid_costs_cents is 'Fixed costs and marketing paid from the cash this hour.';
comment on column public.player_company_hours.profit_cents is
  'Revenue − goods − player wages paid − AI wages paid − fixed costs − marketing.';

do $$
begin
  grant select (last_hour_at) on public.player_companies to authenticated;

  revoke all on public.player_company_hours from public, anon, authenticated;
  grant select on public.player_company_hours to authenticated;
  grant all on public.player_company_hours to service_role;
  drop policy if exists "members read" on public.player_company_hours;
  create policy "members read" on public.player_company_hours for select to authenticated
    using (exists (select 1 from public.player_companies pc
                    where pc.company_id = player_company_hours.company_id and pc.founder_id = (select auth.uid()))
           or exists (select 1 from public.player_jobs j
                       where j.company_id = player_company_hours.company_id and j.player_id = (select auth.uid())
                         and j.status = 'active'));
end;
$$;

-- ---------------------------------------------------------------------------
-- B. Wages: minutes a job can be paid up to a time (as in accrue_job_salary)
-- ---------------------------------------------------------------------------
create or replace function public.job_payable_minutes(p_job uuid, p_until timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when floor(extract(epoch from (p_until - j.last_paid_at)) / 60) < 1 then 0
                else least(floor(extract(epoch from (p_until - j.last_paid_at)) / 60)::integer,
                           greatest(0, (public.config_double('careers', '{paidHoursPerDayCap}', 12) * 60)::integer
                                       - case when j.paid_day = (p_until at time zone 'Europe/Berlin')::date
                                              then j.paid_minutes_today else 0 end)) end
      from public.player_jobs j
     where j.id = p_job and j.status = 'active'), 0);
$$;
comment on function public.job_payable_minutes(uuid, timestamptz) is
  'Minutes accrue_job_salary(p_job, p_until) would pay (elapsed whole minutes, limited by careers.paidHoursPerDayCap).';

-- AI-company jobs only, in whole hours; player-company jobs are paid in the hourly close (ADR-072)
create or replace function public.accrue_salaries(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now   timestamptz := coalesce(p_now, public.game_now());
  r       record;
  v_whole integer;
  v_n     integer := 0;
begin
  for r in select j.id, j.player_id, j.last_paid_at
             from public.player_jobs j join public.companies c on c.id = j.company_id
            where j.status = 'active' and c.is_ai
            order by j.player_id loop
    v_whole := floor(extract(epoch from (v_now - r.last_paid_at)) / 3600)::integer;
    continue when v_whole < 1;
    perform public.lock_player_accounts(r.player_id);
    if public.accrue_job_salary(r.id, r.last_paid_at + make_interval(hours => v_whole)) > 0 then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. One operating hour of a player company (closeStartupHour)
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
  v_tier    jsonb;
  v_stage   integer;
  v_demand  double precision;
  v_cap     double precision;
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
    return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'skipped', 'already_closed');
  end if;
  v_end := v_start + interval '1 hour';
  select * into c from public.companies where id = p_company;
  select gq.id into v_qid from public.game_quarters gq where gq.starts_at <= v_start and gq.ends_at > v_start;
  v_team := public.player_company_team(p_company);
  v_tier := public.company_tier_cfg(pc.tier);
  v_acc := public.company_cash_account(p_company);
  v_hh := public.ledger_system_account('households');
  k := 'pch:' || p_company::text || ':' || to_char(v_start at time zone 'UTC', 'YYYYMMDDHH24');

  -- sales of the hour with the quarter's awareness and quality
  v_stage := least(greatest(coalesce((v_team ->> 'stage')::integer, 0), 0),
                   greatest(jsonb_array_length(coalesce(v_su #> '{stages,awarenessCaps}', '[1]'::jsonb)) - 1, 0));
  v_demand := pc.potential_annual_cents / 4.0 / v_hours * pc.awareness * (0.5 + 0.5 * pc.quality)
            * exp(public.cfg_num(v_su, '{demandNoise}', 0.1) * public.gauss_random());
  v_cap := (v_team ->> 'team_productivity_bps')::double precision / 10000.0
         * public.cfg_num(v_su, array['capacityCentsPerProductivity', c.sector_key], 250000)
         * (1 + public.cfg_num(v_su, '{stages,capacityBonusPerStage}', 0.25) * v_stage) / v_hours;
  v_rev := round(least(v_demand, v_cap)::numeric)::bigint;
  -- closed money system: the households pay at most what they have
  v_rev := least(v_rev, greatest(0, coalesce((select a.balance_cents from public.ledger_accounts a where a.id = v_hh), 0)));
  v_cogs := round((v_rev * (1 - public.cfg_num(v_su, array['grossMargin', c.sector_key], 0.5)))::numeric)::bigint;
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

  -- money: revenue from the households, goods and AI wages back to them
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

  -- fixed costs and marketing from the cash; the rest becomes an open bill
  v_fixed := round(((v_tier ->> 'fixedCostCentsPerQuarter')::bigint / v_hours)::numeric)::bigint;
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
                                           cogs_cents, fixed_cents, marketing_cents, player_wages_due_cents,
                                           player_wages_paid_cents, ai_wages_due_cents, ai_wages_paid_cents, pay_factor_bps,
                                           paid_costs_cents, unpaid_added_cents, profit_cents)
  values (p_company, v_start, v_qid, round(v_demand::numeric)::bigint, round(v_cap::numeric)::bigint, v_rev,
          v_cogs, v_fixed, v_mk, v_pdue, v_ppaid, v_aidue, v_aipaid, v_factor, v_paid, v_unpaid, v_profit);

  return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'quarter_id', v_qid, 'revenue_cents', v_rev,
                            'profit_cents', v_profit, 'pay_factor_bps', v_factor, 'player_wages_paid_cents', v_ppaid,
                            'ai_wages_paid_cents', v_aipaid, 'unpaid_added_cents', v_unpaid);
end;
$$;
comment on function public.player_company_close_hour(uuid, timestamptz) is
  'Closes one operating hour of a player company (closeStartupHour, ADR-072); idempotent per (company, hour).';

-- ---------------------------------------------------------------------------
-- D. Quarter close: aggregate the hours, then what stays quarterly
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

  -- quality towards what the team can do, awareness by word of mouth and marketing (for the next quarter)
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
                       pc.potential_annual_cents / 4.0 * public.cfg_num(v_su, '{awareness,marketingHalfSaturationShare}', 0.1));
    v_gain := public.cfg_num(v_su, '{awareness,marketingMaxGain}', 0.12) * v_mkq / (v_mkq + v_half);
  end if;
  v_aw := least(greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
                         coalesce((v_su #>> array['stages', 'awarenessCaps', v_stage::text])::double precision, 1)),
          greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
            pc.awareness
            + public.cfg_num(v_su, '{awareness,growthPerQuarter}', 0.3) * pc.awareness * (1 - pc.awareness) * (0.5 + v_quality)
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
-- E. Due hours and quarters of all player companies (run_due_jobs)
-- ---------------------------------------------------------------------------
-- Per company, oldest first: operating hours up to the last full hour (at most
-- 48 per run), each quarter as soon as its hours are closed. Hours stop at the
-- end of a quarter that is not reported yet, so a quarter's awareness and
-- quality always apply to the next quarter's hours (matters only when catching up).
create or replace function public.player_companies_run_due()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now    timestamptz := public.game_now();
  v_limit  timestamptz := date_trunc('hour', public.game_now());
  r        record;
  q        record;
  v_at     timestamptz;
  v_last   timestamptz;
  v_hours  integer := 0;
  v_quart  integer := 0;
  v_k      integer;
  v_kq     integer;
  v_moved  boolean;
begin
  for r in
    select pc.company_id, c.founded_at
      from public.player_companies pc join public.companies c on c.id = pc.company_id
     where pc.status = 'active'
     order by pc.company_id
  loop
    v_k := 0;
    v_kq := 0;
    loop
      v_moved := false;
      -- quarters whose hours are all closed
      for q in
        select gq.id from public.game_quarters gq, public.player_companies pc
         where pc.company_id = r.company_id and pc.status = 'active'
           and gq.status = 'closed' and gq.ends_at <= pc.last_hour_at
           and gq.ends_at > coalesce((select x.ends_at from public.game_quarters x where x.id = pc.last_closed_quarter_id), r.founded_at)
           and not exists (select 1 from public.player_company_reports rp where rp.company_id = r.company_id and rp.game_quarter_id = gq.id)
         order by gq.ends_at limit greatest(0, 8 - v_kq)
      loop
        exit when not exists (select 1 from public.player_companies x where x.company_id = r.company_id and x.status = 'active');
        if (public.player_company_close_quarter(r.company_id, q.id) ->> 'skipped') is null then
          v_quart := v_quart + 1;
          v_kq := v_kq + 1;
          v_moved := true;
        end if;
      end loop;
      -- hours up to the next unreported quarter end
      loop
        select pc.last_hour_at,
               coalesce((select x.ends_at from public.game_quarters x where x.id = pc.last_closed_quarter_id), r.founded_at)
          into v_at, v_last
          from public.player_companies pc where pc.company_id = r.company_id and pc.status = 'active';
        exit when v_at is null or v_at + interval '1 hour' > v_limit or v_k >= 48;
        exit when exists (select 1 from public.game_quarters gq
                           where gq.ends_at <= v_at and gq.ends_at > v_last
                             and not exists (select 1 from public.player_company_reports rp
                                              where rp.company_id = r.company_id and rp.game_quarter_id = gq.id));
        perform public.player_company_close_hour(r.company_id, v_at);
        v_hours := v_hours + 1;
        v_k := v_k + 1;
        v_moved := true;
      end loop;
      exit when not v_moved or v_k >= 48 or v_kq >= 8;
    end loop;
  end loop;
  -- keep about one week of hours
  delete from public.player_company_hours where hour_start < v_now - interval '7 days';
  return jsonb_build_object('hours', v_hours, 'quarters', v_quart);
end;
$$;
comment on function public.player_companies_run_due() is
  'run_due_jobs: closes due operating hours (max. 48 per company and run) and quarters of all active player companies.';

-- as before (M3c): number of quarters closed; now with the due hours first
create or replace function public.player_companies_close_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return (public.player_companies_run_due() ->> 'quarters')::integer;
end;
$$;

create or replace function public.run_due_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz;
  v_result   jsonb := '{}'::jsonb;
  v_closed   jsonb := '[]'::jsonb;
  v_latest   bigint;
  q          record;
  v_run      bigint;
begin
  -- waits for a running tick (ticks only try the lock and skip)
  perform pg_advisory_xact_lock(7311001);
  v_now := public.game_now();
  perform public.ensure_game_quarters(3);

  if not exists (select 1 from public.candles limit 1) or not public.money_genesis_done()
     or not exists (select 1 from public.rich_tycoons) then
    v_result := v_result || jsonb_build_object('bootstrap', public.market_bootstrap());
  end if;

  -- first run on a database: older quarters are skipped, only the latest ended one is closed
  if not exists (select 1 from public.job_runs j where j.job_name = 'quarter_close') then
    select gq.id into v_latest from public.game_quarters gq
     where gq.ends_at <= v_now and gq.status <> 'closed' order by gq.ends_at desc limit 1;
    for q in select gq.id from public.game_quarters gq
              where gq.ends_at <= v_now and gq.status <> 'closed' and gq.id <> coalesce(v_latest, -1)
    loop
      update public.game_quarters set status = 'closed', closed_at = now() where id = q.id;
      insert into public.job_runs (job_name, run_key, status, finished_at, details)
      values ('quarter_close', q.id::text, 'succeeded', now(), '{"skipped": "before_first_run"}'::jsonb)
      on conflict do nothing;
    end loop;
  end if;

  for q in select gq.id from public.game_quarters gq
            where gq.ends_at <= v_now and gq.status <> 'closed'
            order by gq.ends_at limit 8
  loop
    v_closed := v_closed || public.close_game_quarter(q.id);
  end loop;
  v_result := v_result || jsonb_build_object('quarters', v_closed);
  -- player companies: operating hours (ADR-072), then every closed quarter since their founding (ADR-057)
  v_result := v_result || jsonb_build_object('player_companies', public.player_companies_run_due());

  -- bonds that matured between quarter closes (or after a downtime)
  if exists (select 1 from public.bonds bd join public.securities s on s.id = bd.security_id
              where s.status = 'listed' and bd.matures_at <= v_now) then
    v_result := v_result || jsonb_build_object('bonds_redeemed', public.redeem_matured_bonds(v_now));
  end if;
  v_result := v_result || jsonb_build_object('bonds_issued', public.ensure_bond_series());

  -- jobs: AI postings of the running quarter, wages of AI-company jobs in whole hours
  v_result := v_result || jsonb_build_object('quit_notices', public.process_quit_notices(null));
  v_result := v_result || jsonb_build_object('share_offers', public.close_due_offers(null));
  v_result := v_result || jsonb_build_object('job_postings', public.refresh_ai_job_postings(),
                                             'salaries_paid', public.accrue_salaries(null));

  -- rich list snapshot every richList.snapshotMinutes (rank news, 24 h changes, state missions)
  v_result := v_result || jsonb_build_object('rich_list', public.rich_list_snapshot(false));

  -- daily maintenance (first run per UTC day)
  insert into public.job_runs (job_name, run_key) values ('maintenance', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'))
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is not null then
    v_result := v_result || jsonb_build_object('maintenance', public.run_maintenance());
    -- price_ticks: keep about one day (candles hold the history), cron log: one day
    perform public.maintain_price_tick_partitions(3, 1);
    if to_regclass('cron.job_run_details') is not null then
      begin
        execute 'delete from cron.job_run_details where end_time < now() - interval ''1 day''';
      exception when others then
        raise warning 'NEXA: could not prune cron.job_run_details: %', sqlerrm;
      end;
    end if;
    delete from public.job_runs j where j.job_name = 'maintenance' and j.started_at < now() - interval '30 days';
    update public.job_runs set status = 'succeeded', finished_at = now() where id = v_run;
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- F. COMPANY: live figures and the last 24 hours
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
begin
  select * into pc from public.player_companies where company_id = p_company;
  select h.revenue_cents, h.profit_cents into v_rev, v_profit
    from public.player_company_hours h where h.company_id = p_company order by h.hour_start desc limit 1;
  select coalesce(sum(h.revenue_cents), 0), coalesce(sum(h.profit_cents), 0) into v_trev, v_tprofit
    from public.player_company_hours h
   where h.company_id = p_company and h.hour_start >= v_day
     and h.hour_start < ((v_day at time zone 'Europe/Berlin') + interval '1 day') at time zone 'Europe/Berlin';
  select coalesce(sum(h.revenue_cents), 0), coalesce(sum(h.profit_cents), 0) into v_qrev, v_qprofit
    from public.player_company_hours h where h.company_id = p_company and h.game_quarter_id = v_qid;
  return jsonb_build_object(
    'last_hour_at', pc.last_hour_at,
    'revenue_per_hour_cents', coalesce(v_rev, 0),
    'profit_per_hour_cents', coalesce(v_profit, 0),
    'pay_factor_bps', pc.pay_factor_bps,
    'today_revenue_cents', v_trev,
    'today_profit_cents', v_tprofit,
    'quarter_revenue_cents', v_qrev,
    'quarter_profit_cents', v_qprofit);
end;
$$;
comment on function public.company_live_json(uuid) is
  'COMPANY.live: last closed hour, Berlin day and running quarter of a player company (ADR-072).';

create or replace function public.company_hours_json(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('hour_start', x.hour_start, 'revenue_cents', x.revenue_cents,
                                               'profit_cents', x.profit_cents) order by x.hour_start), '[]'::jsonb)
    from (select h.hour_start, h.revenue_cents, h.profit_cents from public.player_company_hours h
           where h.company_id = p_company order by h.hour_start desc limit 24) x;
$$;
comment on function public.company_hours_json(uuid) is 'COMPANY.hours: the last 24 closed operating hours, oldest first.';

-- company_state as in M3h plus live, hours and ai_wage_cents_per_hour
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
    'estimate_low_cents', round(pc.potential_annual_cents
                                * exp(-v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':low'))))::bigint,
    'estimate_high_cents', round(pc.potential_annual_cents
                                 * exp(v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':high'))))::bigint,
    'marketing_cents_per_quarter', pc.marketing_cents_per_quarter,
    'ai_workers', pc.ai_workers,
    'ai_worker_cost_cents', public.config_bigint('startups', '{aiWorkerCostCentsPerQuarter}', 72000),
    'ai_wage_cents_per_hour', public.config_bigint('startups', '{aiWorkerWageCentsPerHour}', 12000),
    'ai_worker_skills', to_jsonb(pc.ai_worker_skills),
    'max_employees', (v_tier ->> 'maxEmployees')::integer,
    'employees', (v_team ->> 'employees')::integer,
    'open_postings', (select count(*) from public.job_postings jp where jp.company_id = p_company and jp.status = 'open')::integer,
    'pending_applications', (select count(*) from public.job_applications a join public.job_postings jp on jp.id = a.posting_id
                              where jp.company_id = p_company and a.status = 'pending')::integer,
    'founder_productivity_bps', (v_team ->> 'founder_productivity_bps')::integer,
    'team_productivity_bps', (v_team ->> 'team_productivity_bps')::integer,
    'capacity_cents', (v_team ->> 'capacity_cents')::bigint,
    'next_quarter_at', coalesce((public.current_game_quarter()).ends_at, public.game_now()),
    'can_upgrade', public.company_next_tier(pc.tier) is not null
                   and coalesce(v_level, 1) >= (public.company_tier_cfg(public.company_next_tier(pc.tier)) ->> 'minLevel')::integer,
    'listing', public.company_listing_json(p_company, pc.founder_id),
    'can_go_public', c.phase = 'private' and public.company_open_offer(p_company) is null
                     and coalesce(public.config_jsonb('startups', '{ipo,fromTiers}'), '["small_business", "gmbh"]'::jsonb) ? pc.tier
                     and coalesce(v_level, 1) >= public.config_double('startups', '{ipo,minLevel}', 12),
    'can_capital_increase', c.phase = 'listed' and public.company_open_offer(p_company) is null,
    'upgrade_cost_cents', v_cost,
    'last_quarter', v_last,
    'history', v_hist,
    'live', public.company_live_json(p_company),
    'hours', public.company_hours_json(p_company));
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Company ranking (ADR-074)
-- ---------------------------------------------------------------------------
-- Player companies by value: company_value_cents, listed ones at market value
-- (shares x last price, as the founder's shares count on the rich list).
-- Scope 'all' adds the listed AI companies at market value.
create or replace function public.get_company_ranking(p_scope text default 'players', p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_scope  text := coalesce(p_scope, 'players');
  v_limit  integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_out    jsonb;
begin
  v_player := public.require_player();
  if v_scope not in ('players', 'all') then
    perform public.api_error('invalid_argument');
  end if;

  with lst as materialized (
    select c.id, 'player'::text as kind, c.name, coalesce(c.brand_color, '#808080') as color,
           public.company_logo(c.id) as logo, c.ticker, c.sector_key, pc.tier, pr.nickname as founder,
           case when c.phase = 'listed' and qt.last_price_e4 is not null
                then public.div_round_half_even(c.shares_outstanding::numeric * qt.last_price_e4, 100)::bigint
                else public.company_value_cents(c.id) end as value_cents,
           (select r.revenue_cents from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
             where r.company_id = c.id order by gq.ends_at desc limit 1) as revenue_cents,
           1 + pc.ai_workers + (select count(*) from public.player_jobs j where j.company_id = c.id and j.status = 'active')::integer
             as team_size,
           pc.founder_id = v_player as is_mine
      from public.player_companies pc
      join public.companies c on c.id = pc.company_id
      left join public.profiles pr on pr.id = pc.founder_id
      left join public.security_quotes qt on qt.security_id = c.security_id
     where pc.status = 'active'
    union all
    select c.id, 'ai', c.name, coalesce(c.brand_color, '#808080'), null::jsonb, c.ticker, c.sector_key, null::text, null::text,
           public.div_round_half_even(c.shares_outstanding::numeric * qt.last_price_e4, 100)::bigint,
           null::bigint, null::integer, false
      from public.companies c
      join public.securities s on s.id = c.security_id and s.status = 'listed' and s.kind = 'stock'
      join public.security_quotes qt on qt.security_id = s.id
     where v_scope = 'all' and c.is_ai
  ), ranked as materialized (
    select l.*, (row_number() over (order by l.value_cents desc, l.name, l.id))::integer as rnk from lst l
  )
  select jsonb_build_object(
           'server_time', public.game_now(),
           'total', (select count(*) from ranked)::integer,
           'entries', coalesce((select jsonb_agg(jsonb_build_object(
                                  'rank', x.rnk, 'company_id', x.id, 'kind', x.kind, 'name', x.name, 'color', x.color,
                                  'logo', x.logo, 'ticker', x.ticker, 'sector', x.sector_key, 'tier', x.tier,
                                  'founder', x.founder, 'value_cents', x.value_cents, 'revenue_cents', x.revenue_cents,
                                  'team_size', x.team_size, 'is_mine', x.is_mine) order by x.rnk)
                                  from ranked x where x.rnk <= v_limit), '[]'::jsonb),
           'mine', (select jsonb_build_object('rank', x.rnk, 'value_cents', x.value_cents)
                      from ranked x where x.is_mine and x.kind = 'player' limit 1))
    into v_out;
  return v_out;
end;
$$;
comment on function public.get_company_ranking(text, integer) is
  'RPC: top companies (ADR-074); players: active player companies by value, all: plus listed AI companies by market value.';

-- ---------------------------------------------------------------------------
-- H. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.job_payable_minutes(uuid, timestamptz)', 'public.accrue_salaries(timestamptz)',
    'public.player_company_close_hour(uuid, timestamptz)', 'public.player_company_close_quarter(uuid, bigint)',
    'public.player_companies_run_due()', 'public.player_companies_close_due()', 'public.run_due_jobs()', 'public.company_live_json(uuid)',
    'public.company_hours_json(uuid)', 'public.company_state(uuid)', 'public.get_company_ranking(text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'grant execute on function public.get_company_ranking(text, integer) to authenticated';
end;
$$;
