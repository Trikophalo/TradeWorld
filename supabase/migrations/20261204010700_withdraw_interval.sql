-- =============================================================================
-- NEXA · 10700 · Withdrawals from the own company every 6 hours (ADR-213)
-- =============================================================================
-- The owner: "Man soll Geld aus der Firma alle 6 Stunden entnehmen können."
-- Until now company_withdraw() had no timing rule at all; it only refused money that is not free (open bills,
-- ADR-083; money the board earmarked, ADR-167; issue proceeds for issueProceedsLockHours, ADR-170) and withdrawals
-- while the board's ban holds (ADR-167). The UI showed neither the issue lock nor any rhythm.
-- * player_companies.last_withdraw_at: the last successful withdrawal (set by company_withdraw()).
-- * company_withdraw(): a further withdrawal only startups.withdrawIntervalHours (6) after the last one, error
--   withdraw_cooldown (NX213). The automatic founder payout (ADR-086) and dividends are not withdrawals and do not
--   count. Full copy of the latest definition (m3d + the listed checks of 20261204005400) with the rule.
-- * company_withdraw_json(): interval, last and next possible withdrawal, issue-locked money and until when;
--   company_state() (full copy of 20261204009500) returns it as 'withdraw' for the money card's countdown.
-- Idempotent: runs unchanged as supabase/updates/.
-- =============================================================================

alter table public.player_companies add column if not exists last_withdraw_at timestamptz;
comment on column public.player_companies.last_withdraw_at is
  'Last successful company_withdraw() (ADR-213); the next one is allowed startups.withdrawIntervalHours later.';

-- Error key withdraw_cooldown (NX213)
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''withdraw_cooldown''' in v_def) = 0 then
    v_def := replace(v_def, $q$    else 'NX007'
$q$, $q$    when 'withdraw_cooldown'          then 'NX213'
    else 'NX007'
$q$);
    if position('''withdraw_cooldown''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add withdraw_cooldown (NX213) by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

-- The next moment the founder may withdraw again; null when a withdrawal is allowed now
create or replace function public.company_withdraw_next_at(p_company uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when x.next_at > public.game_now() then x.next_at end
    from (select pc.last_withdraw_at
                 + make_interval(secs => greatest(0, public.config_double('startups', '{withdrawIntervalHours}', 6)) * 3600)
                 as next_at
            from public.player_companies pc where pc.company_id = p_company) x;
$$;
comment on function public.company_withdraw_next_at(uuid) is
  'When the founder may withdraw from the company again (ADR-213); null when allowed now.';

-- What the money card needs to say when and how much the founder may withdraw
create or replace function public.company_withdraw_json(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_listed boolean := public.listed_is(p_company);
  v_locked bigint := 0;
  v_until  timestamptz;
begin
  if v_listed then
    v_locked := public.listed_issue_locked_cents(p_company);
    if v_locked > 0 then
      select max(e.created_at) + public.config_double('startups', '{ipo,issueProceedsLockHours}', 72) * interval '1 hour'
        into v_until
        from public.ledger_accounts ca
        join public.ledger_entries e on e.account_id = ca.id and e.amount_cents > 0
        join public.ledger_transactions t on t.id = e.transaction_id and t.ref_type = 'share_offer'
       where ca.owner_company_id = p_company and ca.kind = 'company_cash'
         and e.created_at > now() - public.config_double('startups', '{ipo,issueProceedsLockHours}', 72) * interval '1 hour';
    end if;
  end if;
  return (select jsonb_build_object(
            'interval_hours', public.config_double('startups', '{withdrawIntervalHours}', 6),
            'last_at', pc.last_withdraw_at,
            'next_at', public.company_withdraw_next_at(p_company),
            'issue_locked_cents', v_locked,
            'issue_locked_until', v_until)
            from public.player_companies pc where pc.company_id = p_company);
end;
$$;
comment on function public.company_withdraw_json(uuid) is
  'Withdrawal rhythm of the own company (ADR-213): interval, last and next withdrawal, issue proceeds still locked.';

-- company_withdraw as in m3d with the listed checks of 20261204005400 (full copy), plus the 6-hour rhythm
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
  v_next    timestamptz;
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
  perform public.listed_withdraw_check(v_company, p_amount_cents);  -- ADR-167
  select a.balance_cents - pc.unpaid_cents - public.listed_reserved_cents(v_company) into v_free
    from public.ledger_accounts a join public.player_companies pc on pc.company_id = a.owner_company_id
   where a.owner_company_id = v_company and a.kind = 'company_cash';
  if coalesce(v_free, 0) < p_amount_cents then
    perform public.api_error('insufficient_funds');
  end if;
  -- ADR-213: one withdrawal every startups.withdrawIntervalHours (checked last, so a too large amount still says why)
  v_next := public.company_withdraw_next_at(v_company);
  if v_next is not null then
    perform public.api_error('withdraw_cooldown');
  end if;
  perform public.ledger_transfer(public.company_cash_account(v_company), public.ledger_player_account(v_player, 'player_cash'),
                                 p_amount_cents, 'transfer', 'Entnahme', 'company', v_company,
                                 'withdraw:' || p_request_id::text, v_player);
  perform public.loan_withhold(v_player, p_amount_cents, 'withdraw:' || p_request_id::text);
  update public.player_companies set last_withdraw_at = public.game_now() where company_id = v_company;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

-- company_state as in 20261204009500_toplists.sql (full copy), plus 'withdraw'
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
         'close_warnings', public.company_close_warnings_json(p_company),
         -- ADR-203: the value of the company as Top-Unternehmen and the net worth count it
         'worth', public.company_worth_json(p_company),
         -- ADR-213: when the founder may withdraw again and what else holds money back
         'withdraw', public.company_withdraw_json(p_company));
end;
$$;

revoke all on function public.company_withdraw_next_at(uuid) from public, anon, authenticated;
revoke all on function public.company_withdraw_json(uuid) from public, anon, authenticated;
