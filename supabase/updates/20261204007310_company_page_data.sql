-- ===== idempotent copy of migrations/20261204007310_company_page_data.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 7310 · Company page data: reputation, close warnings and what each hour used (ADR-183)
-- =============================================================================
-- * company_hours_json: the last 24 closed hours now carry demand, capacity, strengths bonus, AI utilization and the
--   wages paid. "Was jeder leistet" splits the revenue like the hour does (founder and players serve first, the AI
--   workers the rest, ADR-180) and counts the wages actually paid (src/features/company/staff-value.ts); before it
--   split by productivity alone and counted every AI worker at the full wage.
-- * company_state: 'reputation' (every company, ADR-183) and 'close_warnings' (extra steps of the hourly close that
--   failed in the last day). Full redefinition of the latest definition (6600), no text patch.
-- Idempotent: runs unchanged as supabase/updates/20261204007310_company_page_data.sql.

create or replace function public.company_hours_json(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('hour_start', x.hour_start, 'revenue_cents', x.revenue_cents,
                                               'contract_revenue_cents', x.contract_revenue_cents,
                                               'profit_cents', x.profit_cents,
                                               'founder_payout_cents', x.founder_payout_cents,
                                               'stake_payout_cents', x.stake_payout_cents,
                                               'supply_revenue_cents', x.supply_revenue_cents,
                                               'supply_fee_paid_cents', x.supply_fee_paid_cents,
                                               'supply_fee_income_cents', x.supply_fee_income_cents,
                                               'supply_goods_cents', x.supply_goods_cents,
                                               'campaign_id', x.campaign_id)
                            -- ADR-183: what the hour used, for "Was jeder leistet", and the reputation
                            || jsonb_build_object('demand_cents', x.demand_cents,
                                                  'capacity_cents', x.capacity_cents,
                                                  'strength_bonus_cents', x.strength_bonus_cents,
                                                  'ai_utilization_bps', x.ai_utilization_bps,
                                                  'ai_wages_paid_cents', x.ai_wages_paid_cents,
                                                  'player_wages_paid_cents', x.player_wages_paid_cents,
                                                  'reputation', round(x.reputation::numeric, 2))
                            order by x.hour_start), '[]'::jsonb)
    from (select h.* from public.player_company_hours h
           where h.company_id = p_company order by h.hour_start desc limit 24) x;
$$;

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
  v_camp   public.company_campaigns;
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
  v_camp := public.company_campaign_at(p_company, public.game_now());
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
         'market_factor', round(v_mf::numeric, 4),
         -- ADR-086: share of the hourly profit paid to the founder automatically
         'founder_payout_bps', pc.founder_payout_bps,
         -- ADR-097: the running campaign and the current prices (from the demand of the last closed hour)
         'campaign', case when v_camp.id is not null then public.campaign_json(v_camp.id) end,
         'campaign_costs', public.company_campaign_costs(p_company),
         -- ADR-176: slow strengths with their reward, and a stuck hourly close
         'strengths', public.company_strengths_json(p_company),
         -- ADR-183: the reputation of every company and extra steps of the close that failed
         'reputation', public.company_reputation_json(p_company),
         'close_warnings', public.company_close_warnings_json(p_company));
end;
$$;
