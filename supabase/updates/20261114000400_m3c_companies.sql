-- ===== idempotent copy of migrations/20261114000400_m3c_companies.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M3c · 0400 · Player companies: founding, quarter close, employer side
--                     (ADR-057, docs/PLAYER_COMPANIES.md)
-- =============================================================================
-- Mirrors src/lib/sim/startup.ts (closeStartupQuarter, startupValueCents,
-- potentialFromUniform, potentialEstimate, qualityTarget, marketingGain,
-- capacityCents) and src/lib/sim/skills.ts (productivityBps, matchScore).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tier values: garage from startups.garage, small business from company.tiers
-- ---------------------------------------------------------------------------
create or replace function public.company_tier_cfg(p_tier text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case p_tier
    when 'garage' then jsonb_build_object(
      'minLevel', greatest(public.config_double('startups', '{garage,minLevel}', 3)::integer, public.unlock_level('found_garage')),
      'foundingCostCents', public.config_bigint('startups', '{garage,foundingCostCents}', 250000),
      'fixedCostCentsPerQuarter', public.config_bigint('startups', '{garage,fixedCostCentsPerQuarter}', 15000),
      'maxEmployees', public.config_double('startups', '{garage,maxEmployees}', 2)::integer)
    when 'small_business' then (
      select jsonb_build_object(
        'minLevel', greatest(coalesce((t ->> 'minLevel')::integer, 10), public.unlock_level('found_small_business')),
        'foundingCostCents', coalesce((t ->> 'foundingCostCents')::bigint, 1500000),
        'fixedCostCentsPerQuarter', coalesce((t ->> 'fixedCostCentsPerQuarter')::bigint, 200000),
        'maxEmployees', coalesce((t ->> 'maxEmployees')::integer, 5))
        from (select coalesce((select x from jsonb_array_elements(coalesce(public.config_jsonb('company', '{tiers}'), '[]'::jsonb)) x
                                where x ->> 'id' = 'small_business' limit 1), '{}'::jsonb) as t) s)
  end;
$$;

-- Hidden market size from a uniform u in (0, 1]: Pareto, capped (potentialFromUniform).
create or replace function public.startup_potential_from_uniform(p_u double precision)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select least(public.config_double('startups', '{potential,maxAnnualCents}', 200000000000),
               round(public.config_double('startups', '{potential,minAnnualCents}', 100000)
                     * power(least(1, greatest(coalesce(p_u, 1), 1e-12)),
                             -1 / public.config_double('startups', '{potential,paretoAlpha}', 0.57))))::bigint;
$$;

create or replace function public.company_cash_account(p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.ledger_accounts a where a.owner_company_id = p_company and a.kind = 'company_cash';
$$;

-- Company value: cash - unpaid + max(0, last quarter profit) x 4 x sector P/E x valuationPeDiscount (startupValueCents).
create or replace function public.company_value_cents(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0,
           coalesce((select a.balance_cents from public.ledger_accounts a where a.owner_company_id = pc.company_id and a.kind = 'company_cash'), 0)
           - pc.unpaid_cents
           + round(4 * greatest(0, coalesce((select r.operating_profit_cents from public.player_company_reports r
                                               join public.game_quarters gq on gq.id = r.game_quarter_id
                                              where r.company_id = pc.company_id order by gq.ends_at desc limit 1), 0))
                   * public.config_double('sectors', array[c.sector_key, 'peRatio'], 15)
                   * public.config_double('startups', '{valuationPeDiscount}', 0.5))::bigint)::bigint
    from public.player_companies pc join public.companies c on c.id = pc.company_id
   where pc.company_id = p_company;
$$;

-- Value of the company a player founded (0 without one).
create or replace function public.player_company_value_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.company_value_cents(pc.company_id) from public.player_companies pc where pc.founder_id = p_player), 0)::bigint;
$$;

-- The team of a player company: founder (matchScore over the sector's first two branches),
-- active player employees (their job productivity), AI workers (10 000 bps each).
create or replace function public.player_company_team(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc       public.player_companies;
  v_sector text;
  v_list   jsonb;
  v_req    jsonb;
  v_fs     jsonb;
  v_found  integer;
  v_prod   bigint;
  v_score  integer;
  v_emp    integer := 0;
  v_s      jsonb;
  r        record;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  select c.sector_key into v_sector from public.companies c where c.id = p_company;
  v_list := coalesce(public.config_jsonb('jobs', array['sectorBranches', v_sector]), '[]'::jsonb);
  select coalesce(jsonb_agg(jsonb_build_object('branch', b, 'min_score', 0) order by o), '[]'::jsonb) into v_req
    from jsonb_array_elements_text(v_list) with ordinality x(b, o) where o <= 2;
  v_fs := public.player_branch_scores(pc.founder_id);
  v_found := public.job_productivity_bps(public.job_match_score(v_fs, v_req));
  select coalesce(sum(coalesce((v_fs ->> b)::integer, 0)), 0) into v_score from jsonb_array_elements_text(v_list) b;
  v_prod := v_found;
  for r in select j.player_id, j.required from public.player_jobs j where j.company_id = p_company and j.status = 'active' loop
    v_s := public.player_branch_scores(r.player_id);
    v_prod := v_prod + public.job_productivity_bps(public.job_match_score(v_s, r.required));
    v_score := v_score + (select coalesce(sum(coalesce((v_s ->> b)::integer, 0)), 0) from jsonb_array_elements_text(v_list) b);
    v_emp := v_emp + 1;
  end loop;
  v_prod := v_prod + pc.ai_workers * 10000;
  return jsonb_build_object(
    'founder_productivity_bps', v_found,
    'team_productivity_bps', v_prod,
    'employees', v_emp,
    'team_sector_score', v_score,
    'capacity_cents', round(v_prod / 10000.0
                            * public.config_double('startups', array['capacityCentsPerProductivity', v_sector], 250000))::bigint);
end;
$$;

-- Uniform number in [0, 1) derived from a text (estimate seeds per company and quarter).
create or replace function public.uniform_from_text(p_text text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select (hashtext(p_text)::bigint + 2147483648) / 4294967296.0;
$$;

create or replace function public.game_quarter_label(p_quarter_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'J' || gq.game_year || ' Q' || gq.quarter from public.game_quarters gq where gq.id = p_quarter_id;
$$;

-- COMPANY shape (get_my_company and every company RPC)
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
           'operating_profit_cents', r.operating_profit_cents, 'utilization_bps', r.utilization_bps)
    into v_last
    from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
   where r.company_id = p_company order by gq.ends_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('label', h.label, 'revenue_cents', h.revenue_cents,
                                               'profit_cents', h.operating_profit_cents) order by h.ends_at), '[]'::jsonb)
    into v_hist
    from (select r.label, r.revenue_cents, r.operating_profit_cents, gq.ends_at
            from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
           where r.company_id = p_company order by gq.ends_at desc limit 12) h;
  if pc.tier = 'garage' then
    v_cost := greatest(0, (v_sb ->> 'foundingCostCents')::bigint
                          - round((v_tier ->> 'foundingCostCents')::bigint
                                  * public.config_double('startups', '{upgradeCreditShare}', 1))::bigint);
  end if;
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'idea', pc.idea,
    'sector', c.sector_key,
    'color', c.brand_color,
    'tier', pc.tier,
    'founded_at', c.founded_at,
    'cash_cents', v_cash,
    'value_cents', public.company_value_cents(p_company),
    'unpaid_cents', pc.unpaid_cents,
    'distress', pc.distress,
    'awareness_bps', round(pc.awareness * 10000)::integer,
    'quality_bps', round(pc.quality * 10000)::integer,
    'quarters_active', pc.quarters_active,
    'estimate_low_cents', round(pc.potential_annual_cents
                                * exp(-v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':low'))))::bigint,
    'estimate_high_cents', round(pc.potential_annual_cents
                                 * exp(v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':high'))))::bigint,
    'marketing_cents_per_quarter', pc.marketing_cents_per_quarter,
    'ai_workers', pc.ai_workers,
    'ai_worker_cost_cents', public.config_bigint('startups', '{aiWorkerCostCentsPerQuarter}', 70000),
    'max_employees', (v_tier ->> 'maxEmployees')::integer,
    'employees', (v_team ->> 'employees')::integer,
    'open_postings', (select count(*) from public.job_postings jp where jp.company_id = p_company and jp.status = 'open')::integer,
    'pending_applications', (select count(*) from public.job_applications a join public.job_postings jp on jp.id = a.posting_id
                              where jp.company_id = p_company and a.status = 'pending')::integer,
    'founder_productivity_bps', (v_team ->> 'founder_productivity_bps')::integer,
    'team_productivity_bps', (v_team ->> 'team_productivity_bps')::integer,
    'capacity_cents', (v_team ->> 'capacity_cents')::bigint,
    'next_quarter_at', coalesce((public.current_game_quarter()).ends_at, public.game_now()),
    'can_upgrade', pc.tier = 'garage' and coalesce(v_level, 1) >= (v_sb ->> 'minLevel')::integer,
    'upgrade_cost_cents', v_cost,
    'last_quarter', v_last,
    'history', v_hist);
end;
$$;

-- ---------------------------------------------------------------------------
-- Quarter close of one player company (closeStartupQuarter), idempotent per quarter
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
  v_tier    jsonb;
  v_qpot    double precision;
  v_target  double precision;
  v_quality double precision;
  v_mk      bigint;
  v_half    double precision;
  v_gain    double precision := 0;
  v_aw      double precision;
  v_demand  double precision;
  v_cap     double precision;
  v_rev     double precision;
  v_rev_c   bigint;
  v_cogs    bigint;
  v_fixed   bigint;
  v_aiw     bigint;
  v_op      bigint;
  v_costs   bigint;
  v_pay     bigint := 0;
  v_unpaid  bigint := 0;
  v_settle  bigint := 0;
  v_cash    bigint;
  v_acc     uuid;
  v_hh      uuid;
  v_wages   bigint;
  v_xp      integer := 0;
  v_ai      integer;
  k         text;
begin
  select * into pc from public.player_companies where company_id = p_company for update;
  select * into q from public.game_quarters where id = p_quarter_id;
  if pc.company_id is null or q.id is null then
    return null;
  end if;
  if exists (select 1 from public.player_company_reports r where r.company_id = p_company and r.game_quarter_id = p_quarter_id) then
    return jsonb_build_object('company_id', p_company, 'skipped', 'already_closed');
  end if;
  select * into c from public.companies where id = p_company;
  v_team := public.player_company_team(p_company);
  v_tier := public.company_tier_cfg(pc.tier);
  k := 'pcq:' || p_company::text || ':' || p_quarter_id::text;

  -- quality towards what the team can do, awareness by word of mouth and marketing
  v_qpot := pc.potential_annual_cents / 4.0;
  v_target := public.cfg_num(v_su, '{quality,base}', 0.25)
            + (1 - public.cfg_num(v_su, '{quality,base}', 0.25))
              * (greatest(0, (v_team ->> 'team_sector_score')::double precision)
                 / (greatest(0, (v_team ->> 'team_sector_score')::double precision) + public.cfg_num(v_su, '{quality,halfSaturationScore}', 20)));
  v_quality := least(1, greatest(0, pc.quality + public.cfg_num(v_su, '{quality,adjustPerQuarter}', 0.35) * (v_target - pc.quality)));
  v_mk := pc.marketing_cents_per_quarter;
  if v_mk > 0 then
    v_half := greatest(public.cfg_num(v_su, '{awareness,marketingMinHalfSaturationCents}', 50000),
                       pc.potential_annual_cents / 4.0 * public.cfg_num(v_su, '{awareness,marketingHalfSaturationShare}', 0.1));
    v_gain := public.cfg_num(v_su, '{awareness,marketingMaxGain}', 0.12) * v_mk / (v_mk + v_half);
  end if;
  v_aw := least(1, greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
            pc.awareness
            + public.cfg_num(v_su, '{awareness,growthPerQuarter}', 0.3) * pc.awareness * (1 - pc.awareness) * (0.5 + v_quality)
            + v_gain
            - public.cfg_num(v_su, '{awareness,decayPerQuarter}', 0.03) * pc.awareness));

  v_demand := v_qpot * v_aw * (0.5 + 0.5 * v_quality) * exp(public.cfg_num(v_su, '{demandNoise}', 0.1) * public.gauss_random());
  v_cap := (v_team ->> 'team_productivity_bps')::double precision / 10000.0
         * public.cfg_num(v_su, array['capacityCentsPerProductivity', c.sector_key], 250000);
  v_rev := least(v_demand, v_cap);
  v_rev_c := round(v_rev::numeric)::bigint;
  v_cogs := round((v_rev * (1 - public.cfg_num(v_su, array['grossMargin', c.sector_key], 0.5)))::numeric)::bigint;
  v_fixed := (v_tier ->> 'fixedCostCentsPerQuarter')::bigint;
  v_aiw := pc.ai_workers * round(public.cfg_num(v_su, '{aiWorkerCostCentsPerQuarter}', 70000))::bigint;
  v_op := v_rev_c - v_cogs - v_fixed - v_aiw - v_mk;

  -- money (closed system): revenue from the households, costs back to them
  v_acc := public.company_cash_account(p_company);
  v_hh := public.ledger_system_account('households');
  if v_rev_c > 0 then
    v_pay := least(v_rev_c, greatest(0, (select a.balance_cents from public.ledger_accounts a where a.id = v_hh)));
    if v_pay > 0 then
      perform public.ledger_transfer(v_hh, v_acc, v_pay, 'company_revenue', 'Umsatz ' || public.game_quarter_label(q.id),
                                     'company', p_company, k || ':revenue', pc.founder_id);
    end if;
  end if;
  v_costs := v_cogs + v_fixed + v_aiw + v_mk;
  select a.balance_cents into v_cash from public.ledger_accounts a where a.id = v_acc;
  v_pay := least(v_costs, greatest(0, coalesce(v_cash, 0)));
  if v_pay > 0 then
    perform public.ledger_transfer(v_acc, v_hh, v_pay, 'company_costs', 'Kosten ' || public.game_quarter_label(q.id),
                                   'company', p_company, k || ':costs', pc.founder_id);
  end if;
  v_unpaid := v_costs - v_pay;
  v_ai := pc.ai_workers;
  if v_unpaid > 0 then
    v_ai := 0;                                  -- distress: the AI workers are let go
  elsif pc.unpaid_cents > 0 then
    select a.balance_cents into v_cash from public.ledger_accounts a where a.id = v_acc;
    v_settle := least(pc.unpaid_cents, greatest(0, coalesce(v_cash, 0)));
    if v_settle > 0 then
      perform public.ledger_transfer(v_acc, v_hh, v_settle, 'company_costs', 'Offene Rechnungen',
                                     'company', p_company, k || ':settle', pc.founder_id);
    end if;
  end if;

  select coalesce(sum(sp.amount_cents), 0) into v_wages
    from public.salary_payouts sp join public.player_jobs j on j.id = sp.player_job_id
   where j.company_id = p_company and sp.period_end > q.starts_at and sp.period_end <= q.ends_at;

  if v_op > 0 then
    v_xp := public.grant_xp(pc.founder_id, 'company_quarter_profit',
                            public.config_double('progression', '{xpSources,profitableCompanyQuarter,xp}', 500)::integer,
                            'company_quarter:' || p_company::text || ':' || q.id::text, 'company', p_company);
  end if;

  update public.player_companies
     set awareness = v_aw, quality = v_quality, quarters_active = quarters_active + 1, last_closed_quarter_id = q.id,
         unpaid_cents = unpaid_cents + v_unpaid - v_settle,
         distress = (unpaid_cents + v_unpaid - v_settle) > 0,
         ai_workers = v_ai
   where company_id = p_company;

  insert into public.player_company_reports (company_id, game_quarter_id, label, demand_cents, capacity_cents, revenue_cents,
                                             cogs_cents, fixed_cents, ai_worker_cents, marketing_cents, wages_cents,
                                             operating_profit_cents, utilization_bps, paid_costs_cents, unpaid_added_cents,
                                             awareness_bps, quality_bps, team_productivity_bps, team_sector_score)
  values (p_company, q.id, public.game_quarter_label(q.id), round(v_demand::numeric)::bigint, round(v_cap::numeric)::bigint,
          v_rev_c, v_cogs, v_fixed, v_aiw, v_mk, v_wages, v_op,
          round(case when v_cap > 0 then least(1, v_demand / v_cap) else 1 end * 10000)::integer,
          v_pay, v_unpaid, round(v_aw * 10000)::integer, round(v_quality * 10000)::integer,
          (v_team ->> 'team_productivity_bps')::integer, (v_team ->> 'team_sector_score')::integer);

  return jsonb_build_object('company_id', p_company, 'quarter_id', q.id, 'revenue_cents', v_rev_c,
                            'operating_profit_cents', v_op, 'unpaid_added_cents', v_unpaid, 'xp', v_xp);
end;
$$;

-- Closes every closed game quarter a player company has not been through yet
-- (from its founding on, at most 8 per company and run). Called by run_due_jobs().
create or replace function public.player_companies_close_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  q   record;
  v_n integer := 0;
begin
  for r in
    select pc.company_id, c.founded_at,
           (select gq.ends_at from public.game_quarters gq where gq.id = pc.last_closed_quarter_id) as last_end
      from public.player_companies pc join public.companies c on c.id = pc.company_id
     order by pc.company_id
  loop
    for q in
      select gq.id from public.game_quarters gq
       where gq.status = 'closed' and gq.ends_at > coalesce(r.last_end, r.founded_at)
       order by gq.ends_at limit 8
    loop
      if (public.player_company_close_quarter(r.company_id, q.id) ->> 'skipped') is null then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- The caller's own player company (founder); company_not_found otherwise.
create or replace function public.require_own_company()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_company uuid;
begin
  select pc.company_id into v_company from public.player_companies pc where pc.founder_id = v_player;
  if v_company is null then
    perform public.api_error('company_not_found');
  end if;
  return v_company;
end;
$$;

create or replace function public.check_company_name(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  perform public.require_player();
  v_reason := public.name_violation(p_name, 'company');
  return jsonb_build_object('allowed', v_reason is null, 'reason', v_reason);
end;
$$;

create or replace function public.found_company(p_request_id uuid, p_name text, p_idea text, p_sector text, p_color text,
                                                p_tier text)
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
  if coalesce(p_tier, '') not in ('garage', 'small_business')
     or not exists (select 1 from public.sectors s where s.key = p_sector)
     or public.config_jsonb('startups', array['capacityCentsPerProductivity', p_sector]) is null
     or coalesce(p_color, '') !~ '^#[0-9a-fA-F]{6}$'
     or char_length(v_idea) not between 1 and 120 then
    perform public.api_error('invalid_argument');
  end if;
  if public.text_has_profanity(v_idea) then
    perform public.api_error('name_profanity');
  end if;
  perform 1 from public.profiles p where p.id = v_player for update;
  if exists (select 1 from public.player_companies pc where pc.founder_id = v_player) then
    perform public.api_error('company_exists');
  end if;
  if exists (select 1 from public.player_jobs j where j.player_id = v_player and j.status = 'active') then
    perform public.api_error('job_active_exists');
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
          v_idea, p_sector, false, 'small_business', 'private', v_player, v_player, lower(p_color), 1,
          (v_tier ->> 'maxEmployees')::integer, (public.current_game_quarter()).id, now());
  insert into public.ledger_accounts (kind, owner_company_id, label) values ('company_cash', v_id, 'Firmenkasse')
  returning id into v_acc;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), v_acc, v_cost, 'company_founding',
                                   'Gründung ' || p_name, 'company', v_id, 'found:' || v_id::text, v_player);
  end if;
  insert into public.player_companies (company_id, founder_id, idea, tier, potential_annual_cents, awareness, quality, request_id)
  values (v_id, v_player, v_idea, p_tier, public.startup_potential_from_uniform(1 - random()),
          public.config_double('startups', '{awareness,initial}', 0.03), public.config_double('startups', '{quality,base}', 0.25),
          p_request_id);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_id)));
end;
$$;

create or replace function public.get_my_company()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
begin
  return jsonb_build_object('company', (select public.company_state(pc.company_id) from public.player_companies pc
                                         where pc.founder_id = v_player));
end;
$$;

create or replace function public.set_company_marketing(p_request_id uuid, p_marketing_cents bigint)
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
  if p_request_id is null or p_marketing_cents is null or p_marketing_cents < 0 or p_marketing_cents > 1000000000 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_company_marketing');
  if v_replay is not null then
    return v_replay;
  end if;
  update public.player_companies set marketing_cents_per_quarter = p_marketing_cents where company_id = v_company;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
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
     > (public.company_tier_cfg(pc.tier) ->> 'maxEmployees')::integer then
    perform public.api_error('employee_limit');
  end if;
  update public.player_companies set ai_workers = p_count where company_id = v_company;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

-- Pays open bills from the company cash (deposit, quarter close); clears the distress flag.
create or replace function public.player_company_settle_unpaid(p_company uuid, p_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc       public.player_companies;
  v_acc    uuid := public.company_cash_account(p_company);
  v_settle bigint;
begin
  select * into pc from public.player_companies where company_id = p_company for update;
  if pc.unpaid_cents <= 0 then
    return 0;
  end if;
  select least(pc.unpaid_cents, greatest(0, a.balance_cents)) into v_settle from public.ledger_accounts a where a.id = v_acc;
  if v_settle > 0 then
    perform public.ledger_transfer(v_acc, public.ledger_system_account('households'), v_settle, 'company_costs',
                                   'Offene Rechnungen', 'company', p_company, p_key, pc.founder_id);
  end if;
  update public.player_companies
     set unpaid_cents = unpaid_cents - v_settle, distress = unpaid_cents - v_settle > 0
   where company_id = p_company;
  return v_settle;
end;
$$;

create or replace function public.company_deposit(p_request_id uuid, p_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  v_cash    bigint;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_amount_cents is null or p_amount_cents < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'company_deposit');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.lock_player_accounts(v_player);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < p_amount_cents then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.company_cash_account(v_company),
                                 p_amount_cents, 'capital_injection', 'Einlage', 'company', v_company,
                                 'deposit:' || p_request_id::text, v_player);
  perform public.player_company_settle_unpaid(v_company, 'deposit-settle:' || p_request_id::text);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

create or replace function public.company_withdraw(p_request_id uuid, p_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  v_free    bigint;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_amount_cents is null or p_amount_cents < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'company_withdraw');
  if v_replay is not null then
    return v_replay;
  end if;
  perform 1 from public.player_companies pc where pc.company_id = v_company for update;
  select a.balance_cents - pc.unpaid_cents into v_free
    from public.ledger_accounts a join public.player_companies pc on pc.company_id = a.owner_company_id
   where a.owner_company_id = v_company and a.kind = 'company_cash';
  if coalesce(v_free, 0) < p_amount_cents then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.company_cash_account(v_company), public.ledger_player_account(v_player, 'player_cash'),
                                 p_amount_cents, 'transfer', 'Entnahme', 'company', v_company,
                                 'withdraw:' || p_request_id::text, v_player);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

create or replace function public.upgrade_company(p_request_id uuid)
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
  v_sb      jsonb := public.company_tier_cfg('small_business');
  v_cost    bigint;
  v_cash    bigint;
  v_level   integer;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'upgrade_company');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  if pc.tier <> 'garage' then
    perform public.api_error('company_upgrade_unavailable');
  end if;
  select p.level into v_level from public.profiles p where p.id = v_player;
  if v_level < (v_sb ->> 'minLevel')::integer then
    perform public.api_error('company_level_too_low');
  end if;
  v_cost := (public.company_state(v_company) ->> 'upgrade_cost_cents')::bigint;
  perform public.lock_player_accounts(v_player);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.company_cash_account(v_company),
                                   v_cost, 'company_conversion', 'Kleinunternehmen', 'company', v_company,
                                   'upgrade:' || v_company::text, v_player);
  end if;
  update public.player_companies set tier = 'small_business' where company_id = v_company;
  update public.companies set max_employees = (v_sb ->> 'maxEmployees')::integer where id = v_company;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

create or replace function public.get_company_postings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.require_own_company();
begin
  return jsonb_build_object('postings', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'tier', p.tier, 'title', p.title, 'title_key', p.title_key, 'required', p.required,
             'salary_cents_per_hour', p.salary_cents_per_hour, 'slots', coalesce(p.slots, 1),
             'slots_open', greatest(0, coalesce(p.slots, 1) - (select count(*) from public.player_jobs j
                                                                 where j.posting_id = p.id and j.status = 'active'))::integer,
             'status', p.status,
             'applications_pending', (select count(*) from public.job_applications a
                                       where a.posting_id = p.id and a.status = 'pending')::integer,
             'posted_at', p.posted_at)
             order by p.status = 'closed', p.posted_at desc, p.id)
      from public.job_postings p
     where p.company_id = v_company and (p.status = 'open' or p.updated_at > now() - interval '7 days')), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Wiring: contracts, player card, portfolio, net worth, rich list, jobs
-- ---------------------------------------------------------------------------
-- sign_contract as in M2b; founders cannot take a job (owns_company), player companies respect max employees.
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
  if exists (select 1 from public.player_companies pc where pc.founder_id = v_player) then
    perform public.api_error('owns_company');
  end if;
  select * into p from public.job_postings where id = a.posting_id;
  -- player companies: players with an active job there + AI workers <= max employees of the tier
  if exists (select 1 from public.player_companies pc where pc.company_id = p.company_id
                and (select count(*) from public.player_jobs j where j.company_id = pc.company_id and j.status = 'active')
                    + pc.ai_workers + 1 > (public.company_tier_cfg(pc.tier) ->> 'maxEmployees')::integer) then
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
  return public.request_complete(v_player, p_request_id, public.job_state(v_player));
end;
$$;

-- get_player_card as in M2b; company = {name, ticker} for founders
create or replace function public.get_player_card(p_nickname text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p      public.profiles;
  v_job  jsonb;
begin
  perform public.require_player();
  select * into p from public.profiles x where lower(x.nickname) = lower(btrim(coalesce(p_nickname, ''))) and not x.is_deactivated;
  if p.id is null then
    perform public.api_error('player_not_found');
  end if;
  select jsonb_build_object('company_name', c.name, 'title_key', j.title_key, 'title', case when j.title_key is null then j.title end,
                            'tier', j.tier, 'since', j.started_at)
    into v_job
    from public.player_jobs j join public.companies c on c.id = j.company_id
   where j.player_id = p.id and j.status = 'active';
  return jsonb_build_object(
    'nickname',        p.nickname,
    'avatar_key',      p.avatar_key,
    'level',           p.level,
    'rank',            public.player_rich_rank(p.id),
    'net_worth_cents', public.player_net_worth_cents(p.id),
    'streak_days',     public.player_streak_days(p.id),
    'skills_learned',  (select count(*) from public.player_skills s where s.player_id = p.id)::integer,
    'branch_scores',   public.player_branch_scores(p.id),
    'top_skills',      coalesce((select jsonb_agg(jsonb_build_object('key', x.skill_key, 'tier', x.tier) order by x.tier desc, x.learned_at)
                                   from (select s.skill_key, s.learned_at, (public.skill_node(s.skill_key) ->> 'tier')::integer as tier
                                           from public.player_skills s where s.player_id = p.id
                                          order by 3 desc nulls last, s.learned_at limit 3) x), '[]'::jsonb),
    'job',             v_job,
    'company',         (select jsonb_build_object('name', c.name, 'ticker', c.ticker)
                          from public.player_companies pc join public.companies c on c.id = pc.company_id
                         where pc.founder_id = p.id),
    'member_since',    p.created_at);
end;
$$;

-- get_my_portfolio as in M2b plus company_value_cents
create or replace function public.get_my_portfolio()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player    uuid;
  v_cash      bigint;
  v_reserved  bigint;
  v_positions jsonb;
  v_value     bigint;
  v_bid_value bigint;
  v_orders    jsonb;
  v_trades    jsonb;
  v_prof      public.profiles;
  v_priv      public.player_private;
  v_level     jsonb;
  v_days      double precision := public.config_double('names', '{nicknameChangeDays}', 60);
  v_today     date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_streak    integer;
  ls          public.login_streaks;
begin
  v_player := public.require_player();
  select coalesce(sum(a.balance_cents) filter (where a.kind = 'player_cash'), 0),
         coalesce(sum(a.balance_cents) filter (where a.kind = 'player_reserve'), 0)
    into v_cash, v_reserved
    from public.ledger_accounts a where a.owner_player_id = v_player;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ticker', x.ticker, 'name', x.name, 'kind', x.kind, 'quantity_e6', x.quantity_e6,
           'reserved_quantity_e6', x.reserved_quantity_e6, 'avg_price_e4', x.avg_entry_price_e4,
           'last_price_e4', x.last_price_e4, 'market_value_cents', x.mv, 'cost_basis_cents', x.cost_basis_cents,
           'unrealized_pnl_cents', x.mv - x.cost_basis_cents, 'realized_pnl_cents', x.realized_pnl_cents,
           'change_bps', x.change_bps, 'opened_at', x.opened_at)
           order by x.mv desc), '[]'::jsonb),
         coalesce(sum(x.mv), 0)::bigint,
         coalesce(sum(x.bv), 0)::bigint
    into v_positions, v_value, v_bid_value
    from (select s.ticker, s.name, s.kind, p.quantity_e6, p.reserved_quantity_e6, p.avg_entry_price_e4, p.cost_basis_cents,
                 p.realized_pnl_cents, p.opened_at, q.last_price_e4, q.change_bps,
                 public.value_cents(p.quantity_e6, q.last_price_e4) as mv,
                 public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)) as bv
            from public.positions p
            join public.securities s on s.id = p.security_id
            join public.security_quotes q on q.security_id = p.security_id
           where p.player_id = v_player and p.status = 'open' and p.quantity_e6 > 0) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'ticker', s.ticker, 'side', o.side, 'type', o.type, 'quantity_e6', o.quantity_e6,
           'filled_quantity_e6', o.filled_quantity_e6, 'limit_price_e4', o.limit_price_e4, 'status', o.status,
           'reserved_cents', o.reserved_cents, 'created_at', o.created_at)
           order by o.created_at desc), '[]'::jsonb)
    into v_orders
    from public.orders o join public.securities s on s.id = o.security_id
   where o.player_id = v_player and o.status in ('open', 'partially_filled');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'ticker', t.ticker, 'side', t.side, 'quantity_e6', t.quantity_e6, 'price_e4', t.price_e4,
           'gross_cents', t.gross_cents, 'fee_cents', t.fee_cents, 'tax_cents', t.tax_cents,
           'realized_pnl_cents', t.realized_pnl_cents, 'xp_awarded', t.xp_awarded, 'executed_at', t.executed_at)
           order by t.executed_at desc), '[]'::jsonb)
    into v_trades
    from (select tr.*, s.ticker from public.trades tr join public.securities s on s.id = tr.security_id
           where tr.player_id = v_player order by tr.executed_at desc limit 50) t;

  select * into v_prof from public.profiles where id = v_player;
  select * into v_priv from public.player_private where player_id = v_player;
  select * into ls from public.login_streaks where player_id = v_player;
  v_level := public.level_progress(v_prof.xp_total);
  v_streak := case when ls.last_login_day >= v_today - 1 then ls.current_streak
                   when ls.last_login_day = v_today - 2 and ls.freeze_tokens > 0 then ls.current_streak
                   else 0 end;

  return jsonb_build_object(
    'cash_cents',            v_cash,
    'reserved_cents',        v_reserved,
    'positions_value_cents', v_value,
    'total_cents',           v_cash + v_reserved + v_value,
    'net_worth_cents',       v_cash + v_reserved + v_bid_value,
    'loss_pot_cents',        coalesce(v_priv.tax_loss_pot_cents, 0),
    'vault',                 public.vault_status(v_player) - 'accrued_seconds' - 'base_rate_cents_per_hour',
    'positions',             v_positions,
    'open_orders',           v_orders,
    'recent_trades',         v_trades,
    'level',                 v_prof.level,
    'xp_total',              v_prof.xp_total,
    'xp_into_level',         (v_level ->> 'xp_into_level')::bigint,
    'xp_for_next',           (v_level ->> 'xp_for_next')::bigint,
    'tutorial_completed',    v_priv.tutorial_completed_at is not null,
    'nickname',              v_prof.nickname,
    'nickname_change_available_at',
                             case when v_prof.nickname_changed_at is null
                                    or v_prof.nickname_changed_at + make_interval(secs => v_days * 86400) <= now() then null
                                  else v_prof.nickname_changed_at + make_interval(secs => v_days * 86400) end,
    'missions_claimable',    (select count(*) from public.player_missions m
                               where m.player_id = v_player and m.status = 'completed'
                                 and (m.expires_at is null or m.expires_at > public.game_now()))::integer,
    'streak_days',           coalesce(v_streak, 0),
    'avatar_key',            coalesce(v_prof.avatar_key, 'rookie'),
    'skill_points_free',     coalesce((select sp.free_points from public.player_skill_points sp where sp.player_id = v_player), 0),
    'daily_reward_claimable', not exists (select 1 from public.daily_reward_claims c
                                           where c.player_id = v_player
                                             and c.claim_day = (public.game_now() at time zone 'Europe/Berlin')::date),
    'company_value_cents',   public.player_company_value_cents(v_player),
    'server_time',           public.game_now());
end;
$$;

-- rich list and net worth include the founder's company value
create or replace function public.rich_list_entries()
returns table (entity_kind text, entity_id uuid, name text, description text, net_worth_cents bigint, rank_all integer, rank_players integer)
language sql
stable
security definer
set search_path = ''
as $$
  with players as (
    select p.id,
           coalesce(a.cash, 0) + coalesce(v.val, 0) + coalesce(public.company_value_cents(pc.company_id), 0) as nw,
           p.nickname
      from public.profiles p
      left join (select owner_player_id, sum(balance_cents)::bigint as cash from public.ledger_accounts
                  where owner_player_id is not null group by owner_player_id) a on a.owner_player_id = p.id
      left join (select pos.player_id, sum(public.value_cents(pos.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))::bigint as val
                   from public.positions pos join public.security_quotes q on q.security_id = pos.security_id
                  where pos.status = 'open' and pos.quantity_e6 > 0 group by pos.player_id) v on v.player_id = p.id
      left join public.player_companies pc on pc.founder_id = p.id
     where not p.is_deactivated
  ), tycoons as (
    select t.id, t.name, t.description,
           t.cash_cents + coalesce(sum(public.value_cents(h.quantity_e6, coalesce(q.bid_e4, q.last_price_e4))), 0)::bigint as nw
      from public.rich_tycoons t
      left join public.rich_tycoon_holdings h on h.tycoon_id = t.id
      left join public.security_quotes q on q.security_id = h.security_id
     group by t.id
  ), allx as (
    select 'player'::text as entity_kind, id as entity_id, nickname as name, null::text as description, nw from players
    union all
    select 'tycoon', id, name, description, nw from tycoons
  )
  select x.entity_kind, x.entity_id, x.name, x.description, x.nw,
         (row_number() over (order by x.nw desc, x.entity_kind, x.entity_id))::integer,
         case when x.entity_kind = 'player'
              then (row_number() over (partition by x.entity_kind order by x.nw desc, x.entity_id))::integer end
    from allx x;
$$;

create or replace function public.player_net_worth_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(a.balance_cents) from public.ledger_accounts a where a.owner_player_id = p_player), 0)::bigint
       + coalesce((select sum(public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))
                     from public.positions p join public.security_quotes q on q.security_id = p.security_id
                    where p.player_id = p_player and p.status = 'open' and p.quantity_e6 > 0), 0)::bigint
       -- founder's player company (ADR-057): cash - unpaid + earnings value
       + public.player_company_value_cents(p_player);
$$;

-- run_due_jobs as in M2b plus the quarter close of player companies
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
  -- player companies: every closed quarter since their founding (ADR-057)
  v_result := v_result || jsonb_build_object('player_company_quarters', public.player_companies_close_due());

  -- bonds that matured between quarter closes (or after a downtime)
  if exists (select 1 from public.bonds bd join public.securities s on s.id = bd.security_id
              where s.status = 'listed' and bd.matures_at <= v_now) then
    v_result := v_result || jsonb_build_object('bonds_redeemed', public.redeem_matured_bonds(v_now));
  end if;
  v_result := v_result || jsonb_build_object('bonds_issued', public.ensure_bond_series());

  -- jobs: AI postings of the running quarter, wages since the last run
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.company_tier_cfg(text)', 'public.startup_potential_from_uniform(double precision)', 'public.company_cash_account(uuid)',
    'public.company_value_cents(uuid)', 'public.player_company_value_cents(uuid)', 'public.player_company_team(uuid)',
    'public.uniform_from_text(text)', 'public.game_quarter_label(bigint)', 'public.company_state(uuid)',
    'public.player_company_close_quarter(uuid, bigint)', 'public.player_companies_close_due()', 'public.require_own_company()',
    'public.check_company_name(text)', 'public.found_company(uuid, text, text, text, text, text)', 'public.get_my_company()',
    'public.set_company_marketing(uuid, bigint)', 'public.set_ai_workers(uuid, integer)',
    'public.player_company_settle_unpaid(uuid, text)', 'public.company_deposit(uuid, bigint)',
    'public.company_withdraw(uuid, bigint)', 'public.upgrade_company(uuid)', 'public.get_company_postings()',
    'public.sign_contract(uuid, uuid, text)', 'public.get_player_card(text)', 'public.get_my_portfolio()',
    'public.rich_list_entries()', 'public.player_net_worth_cents(uuid)', 'public.run_due_jobs()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.check_company_name(text)', 'public.found_company(uuid, text, text, text, text, text)', 'public.get_my_company()',
    'public.set_company_marketing(uuid, bigint)', 'public.set_ai_workers(uuid, integer)', 'public.company_deposit(uuid, bigint)',
    'public.company_withdraw(uuid, bigint)', 'public.upgrade_company(uuid)', 'public.get_company_postings()',
    'public.sign_contract(uuid, uuid, text)', 'public.get_player_card(text)', 'public.get_my_portfolio()'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
