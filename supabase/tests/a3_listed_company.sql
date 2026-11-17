-- =============================================================================
-- a3 · Listed player companies: research, satisfaction, reputation, dividends, board, books and taxes (ADR-167)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
-- ADR-183: the reputation moves the demand of every company; the exact numbers here assume it stays neutral
select tests.set_cfg('companyHealth', '{reputation,demandMaxEffect}', '0') is null as rep_neutral \gset

-- ADR-180 changed the company scale (market x 10, capacity x 1.5, idle AI workers at the standby share). This file
-- checks the mechanics with the numbers it was written for; the end of the file restores the current values.
select tests.set_cfg('startups', '{marketFactorByTier}', '{"garage": 1, "small_business": 4, "gmbh": 15, "ag": 40}') is null as ok \gset
select tests.set_cfg('startups', '{capacityCentsPerProductivity}',
  '{"tech": 300000, "retail": 250000, "energy": 250000, "pharma": 300000, "logistics": 250000}') is null as ok \gset
select tests.set_cfg('startups', '{aiWorkerStandbyBps}', '10000') is null as ok \gset
select tests.set_cfg('startups', '{gmbh,fixedCostCentsPerQuarter}', '600000') is null as ok \gset
-- and awareness that does not move by the hour, so every hour sells with the same awareness
select coalesce(value -> 'awareness', 'null') as aw_cfg0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{awareness,growthPerQuarter}', '0') is null as ok \gset
select tests.set_cfg('startups', '{awareness,decayPerQuarter}', '0') is null as ok \gset
select tests.set_cfg('startups', '{awareness,marketingMaxGain}', '0') is null as ok \gset

\set f '''0a30a30a-0000-4000-8000-0000000000f1'''
\set a '''0a30a30a-0000-4000-8000-0000000000a1'''
\set b '''0a30a30a-0000-4000-8000-0000000000b1'''
\set n '''0a30a30a-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:f, 'Lisa_Listed') is not null and tests.signup(:a, 'Anton_Anteil') is not null
   and tests.signup(:b, 'Berta_Klein') is not null and tests.signup(:n, 'Nils_Privat') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 12);
select tests.set_level(:a, 12);
select tests.set_level(:b, 12);
select tests.set_level(:n, 12);
select tests.fund(:f, 5000000, 'test:a3:f');
select tests.fund(:a, 900000000, 'test:a3:a');
select tests.fund(:b, 900000000, 'test:a3:b');
select tests.fund(:n, 5000000, 'test:a3:n');
-- deterministic demand for this file
select coalesce(value -> 'demandNoise', '0.1') as noise0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{demandNoise}', '0');

-- helpers: one operating hour n hours ago; a neutral mood and reputation before a measured hour
create or replace function tests.lx_hour(p_company uuid, p_ago integer) returns jsonb language sql as $$
  select public.player_company_close_hour(p_company, date_trunc('hour', now()) - make_interval(hours => p_ago)) $$;
create or replace function tests.lx_row(p_company uuid, p_ago integer) returns public.player_company_hours language sql as $$
  select h from public.player_company_hours h
   where h.company_id = p_company and h.hour_start = date_trunc('hour', now()) - make_interval(hours => p_ago) $$;
create or replace function tests.lx_set(p_company uuid, p_sat double precision, p_rep double precision) returns void language sql as $$
  update public.listed_companies set satisfaction = p_sat, reputation = p_rep, layoff_heat = 0, red_hours = 0,
         ai_workers_seen = (select ai_workers from public.player_companies where company_id = p_company)
   where company_id = p_company $$;
create or replace function tests.near(p_a double precision, p_b double precision) returns boolean language sql as $$
  select abs(p_a - p_b) < 0.0001 $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. The formulas in SQL give the same numbers as src/lib/sim/listed.ts (listed.test.ts, marked "SQL")
-- =============================================================================
select tests.assert(
  jsonb_array_length(public.listed_cfg() -> 'items') >= 60
  and public.listed_item_cost(public.listed_item('r_quality_3'), 0, 100000, 3) = 4800000
  and public.listed_item_cost(public.listed_item('r_quality_3'), 0, 20000, 3) = 2500000
  and public.listed_item_cost(public.listed_item('m_machines'), 2, 35000, 3) = 896000
  and public.listed_item_cost(public.listed_item('x_teamevent'), 0, 35000, 7) = 72000
  and public.listed_item_cost(public.listed_item('x_teamevent'), 0, 35000, 0) = 36000
  and public.listed_item_upkeep(public.listed_item('p_premium'), 1, 123456, 5) = 3704
  and public.listed_item_upkeep(public.listed_item('m_machines'), 3, 123456, 5) = 1851
  and public.listed_item_upkeep(public.listed_item('b_obstkorb'), 1, 123456, 20) = 800
  and public.listed_item_upkeep(public.listed_item('r_quality_1'), 1, 123456, 20) = 0
  and public.listed_advisor_wage(20000) = 4000 and public.listed_advisor_wage(1000000) = 10000,
  'LISTED: prices and running costs follow the reference revenue exactly as in TypeScript');

select public.listed_satisfaction_target(11, 9000, 10000, 1.2, 2, true, 6, 6500, 1000) as st \gset
select tests.assert(
  tests.near((:'st'::jsonb ->> 'target')::float8, 31.0454545)
  and (:'st'::jsonb #>> '{drivers,base}')::float8 = 50 and (:'st'::jsonb #>> '{drivers,benefits}')::float8 = 11
  and tests.near((:'st'::jsonb #>> '{drivers,wages}')::float8, -2.5)
  and tests.near((:'st'::jsonb #>> '{drivers,workload}')::float8, -5.4545454)
  and (:'st'::jsonb #>> '{drivers,crisis}')::float8 = -14 and (:'st'::jsonb #>> '{drivers,layoffs}')::float8 = -6
  and tests.near((:'st'::jsonb #>> '{drivers,greed}')::float8, -5) and (:'st'::jsonb #>> '{drivers,success}')::float8 = 3
  and (public.listed_satisfaction_target(0, 10000, 10000, 0.7, 0, false, 0, 0, 0) ->> 'target')::float8 = 50
  and (public.listed_satisfaction_target(11, 10000, 10000, 0.7, 0, false, 0, 0, 1) ->> 'target')::float8 = 64
  and (public.listed_satisfaction_target(99, 10000, 10000, 0.2, 0, false, 0, 0, -5) #>> '{drivers,benefits}')::float8 = 40
  and (public.listed_satisfaction_target(0, 0, 0, 3, 3, true, 99, 99999, -1) ->> 'target')::float8 = 0,
  'LISTED: satisfaction target and its drivers as in TypeScript; the base (50) is below the green zone');
select tests.assert(
  public.listed_satisfaction_effect(60) = '{"capacity_factor": 1, "quality_add": 0}'::jsonb
  and tests.near((public.listed_satisfaction_effect(90) ->> 'capacity_factor')::float8, 1.06)
  and tests.near((public.listed_satisfaction_effect(45) ->> 'capacity_factor')::float8, 0.925)
  and tests.near((public.listed_satisfaction_effect(45) ->> 'quality_add')::float8, -0.0375)
  and tests.near((public.listed_satisfaction_effect(0) ->> 'capacity_factor')::float8, 0.7),
  'LISTED: below the green zone capacity and quality fall, above there is a small bonus');

select public.listed_reputation_target(5, 60000, 100000, 500000, 20000, 10000, 2, false) as rt \gset
select tests.assert(
  (:'rt'::jsonb ->> 'payout_ratio_bps')::int = 6000 and tests.near((:'rt'::jsonb ->> 'target')::float8, 52.8)
  and tests.near((:'rt'::jsonb #>> '{drivers,greed}')::float8, -15) and tests.near((:'rt'::jsonb #>> '{drivers,reinvest}')::float8, 4.8)
  and tests.near((:'rt'::jsonb #>> '{drivers,dividends}')::float8, 8)
  and public.listed_payout_ratio_bps(60000, -5, 500000) = 24000 and public.listed_payout_ratio_bps(0, 100, 100) = 0
  and (public.listed_reputation_target(0, 100000, 100000, 500000, 0, 0, 0, false) ->> 'target')::float8 = 15
  and tests.near((public.listed_reputation_target(0, 50000, 100000, 500000, 0, 0, 0, false) ->> 'target')::float8, 40)
  and (public.listed_reputation_target(0, 20000, 100000, 500000, 50000, 20000, 6, false) ->> 'target')::float8 = 80
  and (public.listed_reputation_target(0, 0, 100000, 500000, 0, 0, 0, true) ->> 'target')::float8 = 45,
  'LISTED: reputation target as in TypeScript: greed lowers it, reinvesting and dividends raise it');

select public.listed_hour_effect_calc('{"demandBps": 800, "marketBps": 1000, "capacityBps": 500, "qualityBps": 300, "awarenessBps": 200,
  "marginBps": 200, "fixedCostBps": -500}'::jsonb, 45, 40) as he \gset
select tests.assert(
  tests.near((:'he'::jsonb ->> 'awareness_add')::float8, 0.02) and tests.near((:'he'::jsonb ->> 'quality_add')::float8, -0.0075)
  and tests.near((:'he'::jsonb ->> 'demand_factor')::float8, 1.14048) and tests.near((:'he'::jsonb ->> 'capacity_factor')::float8, 0.97125)
  and tests.near((:'he'::jsonb ->> 'cogs_factor')::float8, 0.98) and tests.near((:'he'::jsonb ->> 'fixed_factor')::float8, 0.95)
  and (public.listed_hour_effect_calc('{}'::jsonb, 60, 50) ->> 'demand_factor')::float8 = 1
  and (public.listed_hour_effect_calc('{"marginBps": 9000, "fixedCostBps": -9000}'::jsonb, 60, 50) ->> 'cogs_factor')::float8 = 0.5,
  'LISTED: items, mood and reputation become the terms of the hour as in TypeScript');

select tests.assert(
  public.listed_ledger_category('company_revenue', 'pch:x:revenue', '{}') = 'revenue'
  and public.listed_ledger_category('company_costs', 'pch:x:goods', '{}') = 'goods'
  and public.listed_ledger_category('company_costs', 'pch:x:costs', '{}') = 'fixed'
  and public.listed_ledger_category('company_costs', 'invest:x', '{"cat": "research"}') = 'research'
  and public.listed_ledger_category('salary', null, null) = 'wages'
  and public.listed_ledger_category('transfer', 'withdraw:x', '{}') = 'payout'
  and public.listed_ledger_category('transfer', 'pch:x:payout', '{}') = 'payout'
  and public.listed_ledger_category('transfer', 'offer-release:x', '{}') = 'capital'
  and public.listed_ledger_category('capital_injection', null, '{}') = 'capital'
  and public.listed_ledger_category('tax', 'ctax:1:0', '{"cat": "tax"}') = 'tax'
  and public.listed_ledger_category('fine', null, '{}') = 'penalty'
  and public.listed_is_operating('research') and public.listed_is_operating('benefit')
  and not public.listed_is_operating('payout') and not public.listed_is_operating('dividend')
  and not public.listed_is_operating('tax') and not public.listed_is_operating('capital'),
  'LISTED: bookings get a category; investments are operating costs, payouts, dividends and taxes are not');

-- =============================================================================
-- B. Private companies stay as they are
-- =============================================================================
select tests.login_as('authenticated', :n);
select public.found_company(gen_random_uuid(), 'Privat Werk', 'Bleibt klein', 'tech', '#225588', 'garage') is not null as ok \gset
select public.get_listed_company() as pl0 \gset
select tests.throws_key($$select public.company_invest(gen_random_uuid(), 'b_obstkorb')$$, 'not_listed',
  'company_invest(): only for listed companies');
select tests.throws_key($$select public.company_books_close(gen_random_uuid(), null, false)$$, 'not_listed',
  'company_books_close(): only for listed companies');
select tests.throws_key($$select public.company_declare_dividend(gen_random_uuid(), 100000)$$, 'not_listed',
  'company_declare_dividend(): only for listed companies');
select tests.throws_key($$select public.get_company_accounting()$$, 'not_listed', 'get_company_accounting(): only for listed companies');
select tests.throws_key($$select public.get_company_board()$$, 'not_listed', 'get_company_board(): only for listed companies');
reset role;
select tests.company_of(:n) as pco \gset
update public.player_companies set potential_annual_cents = 30000000, awareness = 0.5, quality = 0.5, contract_work = false
 where company_id = :'pco';
select tests.lx_hour(:'pco', 30) as ph \gset
select tests.assert(
  :'pl0'::jsonb = '{"listed": null}'::jsonb
  and (public.listed_hour_effect(:'pco', now()) ->> 'listed')::boolean = false
  and public.listed_hour_costs(:'pco', now(), 'x') = 0
  and not exists (select 1 from public.listed_companies where company_id = :'pco')
  and not exists (select 1 from public.listed_company_hours where company_id = :'pco')
  and public.listed_reserved_cents(:'pco') = 0 and public.listed_payout_cap_bps(:'pco', now()) = 10000
  and public.listed_price_factor(:'pco') = 1
  and (tests.lx_row(:'pco', 30)).fixed_cents = round(public.company_fixed_cost_cents('garage', 0) / 6.0)
  and (tests.lx_row(:'pco', 30)).revenue_cents > 0,
  'PRIVATE: no listed row, neutral terms, no running costs, no taxes; the hour is the old hour');

-- =============================================================================
-- C. Going public: a founder (60 %), a big shareholder (25 %), a small one (10 %), AI float (5 %)
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Listwerk', 'Alles für die Börse', 'tech', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.company_of(:f) as co \gset
select price_cents as iprice from public.company_share_offers where id = :'offer' \gset
select tests.login_as('authenticated', :a);
select public.subscribe_offer(gen_random_uuid(), :'offer', 250000 * :iprice) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.subscribe_offer(gen_random_uuid(), :'offer', 100000 * :iprice) is not null as ok \gset
reset role;
update public.player_companies set quality = 1 where company_id = :'co';
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select c.ticker as tkr, c.security_id as sec from public.companies c where c.id = :'co' \gset
update public.player_companies set potential_annual_cents = 30000000, awareness = 0.5, quality = 0.5, contract_work = false,
       marketing_cents_per_quarter = 0, price_level = 'normal'
 where company_id = :'co';
select tests.assert(
  (select phase from public.companies where id = :'co') = 'listed' and public.listed_is(:'co')
  and public.board_total_e6(:'co') = 1000000000000
  and public.board_my_e6(:'co', :f) = 600000000000 and public.board_my_e6(:'co', :a) = 250000000000
  and public.board_my_e6(:'co', :b) = 100000000000 and public.board_my_e6(:'co', :n) = 0
  and (public.player_company_team(:'co') ->> 'team_productivity_bps')::int = 15000
  and (public.player_company_team(:'co') ->> 'stage')::int = 0,
  'LISTED: the company is at the exchange; founder 60 %, Anton 25 %, Berta 10 %, AI float 5 %');
-- the IPO money is locked for issueProceedsLockHours (ADR-170, a9_stock_pump.sql); this file plays days later
select public.config_jsonb('startups', '{ipo,issueProceedsLockHours}') as lock0 \gset
select tests.set_cfg('startups', '{ipo,issueProceedsLockHours}', '0');

select tests.login_as('authenticated', :f);
select public.get_listed_company() -> 'listed' as l0 \gset
reset role;
select tests.assert(
  (:'l0'::jsonb #>> '{satisfaction,value}')::float8 = 60 and :'l0'::jsonb #>> '{satisfaction,zone}' = 'green'
  and (:'l0'::jsonb #>> '{reputation,value}')::float8 = 50
  and jsonb_array_length(:'l0'::jsonb -> 'items') = jsonb_array_length(public.listed_cfg() -> 'items')
  and (:'l0'::jsonb #>> '{hour,demand_factor}')::float8 = 1 and (:'l0'::jsonb #>> '{hour,capacity_factor}')::float8 = 1
  and (:'l0'::jsonb ->> 'reserved_cents')::bigint = 0 and (:'l0'::jsonb ->> 'cash_cents')::bigint = tests.company_cash(:'co')
  and (:'l0'::jsonb #>> '{board,my_share_bps}')::int = 6000 and (:'l0'::jsonb #>> '{board,can_convene}')::boolean
  and (:'l0'::jsonb #>> '{taxes,rate_bps}')::int = 1500 and not (:'l0'::jsonb #>> '{taxes,advisor}')::boolean
  and (:'l0'::jsonb #>> '{books,stage}') = 'none' and not (:'l0'::jsonb #>> '{books,can_close}')::boolean
  and (select count(*) from jsonb_array_elements(:'l0'::jsonb -> 'items') i where i ->> 'status' <> 'none') = 0
  and (select i ->> 'cost_cents' from jsonb_array_elements(:'l0'::jsonb -> 'items') i where i ->> 'key' = 'r_quality_1')::bigint = 120000
  and (select i -> 'missing' from jsonb_array_elements(:'l0'::jsonb -> 'items') i where i ->> 'key' = 'r_quality_2') = '["r_quality_1"]'::jsonb,
  'get_listed_company(): starts at the green line (60), reputation 50, every item of the catalogue with its price');

-- =============================================================================
-- D. The operating hour: neutral first, then with items, mood and reputation (the vector of listed.test.ts)
-- =============================================================================
select tests.lx_hour(:'co', 29) is not null as ok \gset
select tests.assert(
  (tests.lx_row(:'co', 29)).demand_cents = 18750000 and (tests.lx_row(:'co', 29)).capacity_cents = 75000
  and (tests.lx_row(:'co', 29)).revenue_cents = 75000 and (tests.lx_row(:'co', 29)).cogs_cents = 18750
  and (tests.lx_row(:'co', 29)).fixed_cents = 166667
  and (select count(*) from public.listed_company_hours where company_id = :'co') = 1
  and public.listed_ref_revenue(:'co') = 75000,
  'close_hour(): a fresh listed company (mood 60, reputation 50, no items) closes the old hour');

insert into public.company_investments (company_id, key, kind, status, level) values
  (:'co', 'p_second', 'product', 'active', 1), (:'co', 'g_south', 'region', 'active', 1),
  (:'co', 'r_automation_1', 'research', 'active', 1), (:'co', 'r_quality_1', 'research', 'active', 1),
  (:'co', 'r_brand_1', 'research', 'active', 1), (:'co', 'r_efficiency_1', 'research', 'active', 1),
  (:'co', 'r_logistics_3', 'research', 'active', 1);
select tests.lx_set(:'co', 45, 40);
select tests.company_cash(:'co') as cc0 \gset
select tests.households() as hh0 \gset
select tests.lx_hour(:'co', 28) is not null as ok \gset
select 'pch:' || :'co' || ':' || to_char((date_trunc('hour', now()) - interval '28 hours') at time zone 'UTC', 'YYYYMMDDHH24') as k1 \gset
select tests.assert(
  public.listed_effects(:'co') = '{"demandBps": 800, "marketBps": 1000, "capacityBps": 500, "qualityBps": 300, "awarenessBps": 200,
    "marginBps": 200, "fixedCostBps": -500, "taxRateBps": 0, "satisfaction": 0, "reputation": 0}'::jsonb
  and abs((tests.lx_row(:'co', 28)).demand_cents - 22128163) <= 1
  and (tests.lx_row(:'co', 28)).capacity_cents = 72844 and (tests.lx_row(:'co', 28)).revenue_cents = 72844
  and (tests.lx_row(:'co', 28)).cogs_cents = 17847
  and (tests.lx_row(:'co', 28)).fixed_cents = 158334 + 2625
  and (tests.lx_row(:'co', 28)).profit_cents = 72844 - 17847 - 160959
  and tests.company_cash(:'co') = :cc0::bigint + 72844 - 17847 - 160959
  and tests.households() = :hh0::bigint - (72844 - 17847 - 160959),
  'close_hour(): the listed terms give exactly the hour of closeStartupHour() in TypeScript; running costs count as fixed costs');
select tests.assert(
  (select e.amount_cents from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
    where t.idempotency_key = :'k1' || ':lx:product' and e.account_id = public.company_cash_account(:'co')) = -1125
  and (select e.amount_cents from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.idempotency_key = :'k1' || ':lx:expansion' and e.account_id = public.company_cash_account(:'co')) = -1500
  and (select t.metadata ->> 'cat' from public.ledger_transactions t where t.idempotency_key = :'k1' || ':lx:product') = 'product'
  and (select upkeep_cents from public.listed_company_hours where company_id = :'co' order by hour_start desc limit 1) = 2625
  and (select l.last_upkeep from public.listed_companies l where l.company_id = :'co') = '{"product": 1125, "expansion": 1500}'::jsonb,
  'close_hour(): running costs are booked per category from the company cash to the households');

-- the mood moved 15 % toward its target, the reputation 8 %
select * from public.listed_company_hours where company_id = :'co' order by hour_start desc limit 1 \gset lh_
select tests.assert(
  tests.near(:lh_satisfaction, 45 + 0.15 * (:lh_sat_target - 45)) and tests.near(:lh_reputation, 40 + 0.08 * (:lh_rep_target - 40))
  -- demand far above the capacity is overtime (-12), a loss hour hurts (-3): 50 - 12 - 3
  and tests.near(:lh_sat_target, 35)
  and (select tests.near(l.satisfaction, :lh_satisfaction) and tests.near(l.price_factor, 1 + 0.25 * (l.reputation - 50) / 50)
         from public.listed_companies l where l.company_id = :'co'),
  'hour_after(): satisfaction drifts 15 % and reputation 8 % of the gap per hour; overtime and a loss hour lower the mood');

-- cash too low for an item: it pauses and has no effect until it can be paid again
select tests.company_cash(:'co') as ccp \gset
select public.ledger_transfer(public.company_cash_account(:'co'), public.ledger_system_account('households'), :ccp::bigint - 1200,
  'transfer', 'Test: Kasse leeren', 'company', :'co', 'test:a3:drain') is not null as ok \gset
select public.listed_item_upkeep(public.listed_item('p_second'), 1, public.listed_ref_revenue(:'co'), 0) as up_p \gset
select public.listed_item_upkeep(public.listed_item('g_south'), 1, public.listed_ref_revenue(:'co'), 0) as up_g \gset
select public.listed_hour_costs(:'co', now(), 'test:a3:pause') as paused_paid \gset
select tests.assert(
  :paused_paid::bigint = :up_p::bigint and :up_p::bigint < 1200 and :up_g::bigint > 100
  and (select status from public.company_investments where company_id = :'co' and key = 'p_second') = 'active'
  and (select status from public.company_investments where company_id = :'co' and key = 'g_south') = 'paused'
  and (public.listed_effects(:'co') ->> 'marketBps')::int = 0,
  'hour_costs(): what the cash cannot pay pauses (no debt) and loses its effect');
select public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(:'co'), :ccp::bigint - 1200,
  'transfer', 'Test: Kasse zurück', 'company', :'co', 'test:a3:refill') is not null as ok \gset
select public.listed_hour_costs(:'co', now(), 'test:a3:resume') as resumed_paid \gset
select tests.assert(
  :resumed_paid::bigint = :up_p::bigint + :up_g::bigint
  and (select status from public.company_investments where company_id = :'co' and key = 'g_south') = 'active',
  'hour_costs(): a paused item runs again as soon as it is paid');
delete from public.company_investments where company_id = :'co';

-- =============================================================================
-- E. Investments: price, budget, requirements, duration, lasting effect
-- =============================================================================
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.company_invest(gen_random_uuid(), 'nope')$$, 'item_unknown', 'company_invest(): unknown item');
select tests.throws_key($$select public.company_invest(gen_random_uuid(), 'r_quality_2')$$, 'item_locked',
  'company_invest(): the second step needs the first');
select tests.throws_key($$select public.company_invest(gen_random_uuid(), 'g_europe')$$, 'item_locked',
  'company_invest(): Europe needs DACH and the export licence');
reset role;
select tests.company_cash(:'co') as cc1 \gset
select tests.households() as hh1 \gset
select public.listed_ref_revenue(:'co') as ref1 \gset
select tests.login_as('authenticated', :f);
\set rq1 '''0a30a30a-0000-4000-8000-0000000000e1'''
select public.company_invest(:rq1, 'r_quality_1') -> 'listed' as i1 \gset
select public.company_invest(:rq1, 'r_quality_1') -> 'listed' as i1b \gset
select tests.throws_key($$select public.company_invest(gen_random_uuid(), 'r_quality_1')$$, 'item_running',
  'company_invest(): a running research cannot be started twice');
reset role;
select public.listed_item_cost(public.listed_item('r_quality_1'), 0, :ref1, 0) as cost1 \gset
select tests.assert(
  :cost1::bigint = greatest(100000, 6 * :ref1::bigint) and :'i1'::jsonb = :'i1b'::jsonb
  and tests.company_cash(:'co') = :cc1::bigint - :cost1::bigint and tests.households() = :hh1::bigint + :cost1::bigint
  and (select i ->> 'status' from jsonb_array_elements(:'i1'::jsonb -> 'items') i where i ->> 'key' = 'r_quality_1') = 'running'
  and (select (i ->> 'ready_at')::timestamptz > now() + interval '50 minutes' from jsonb_array_elements(:'i1'::jsonb -> 'items') i
        where i ->> 'key' = 'r_quality_1')
  and (public.listed_effects(:'co') ->> 'qualityBps')::int = 0
  and (select t.metadata from public.ledger_transactions t where t.idempotency_key = 'invest:' || :rq1)
      = '{"cat": "research", "item": "r_quality_1", "one_off": true}'::jsonb,
  'company_invest(): a research costs max(1 000 EUR, 6 h of revenue), runs an hour and has no effect before; idempotent');

-- time is up: the research is active, its effect lasts
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward)
values (:f, 'm_first_research', 'milestone', date '2000-01-01', 1, 800);
update public.company_investments set ready_at = now() - interval '1 second' where company_id = :'co' and key = 'r_quality_1';
select tests.login_as('authenticated', :f);
select public.get_listed_company() -> 'listed' as i2 \gset
select public.company_invest(gen_random_uuid(), 'm_machines') is not null as ok \gset
reset role;
update public.company_investments set ready_at = now() - interval '1 second' where company_id = :'co' and key = 'm_machines';
select tests.login_as('authenticated', :f);
select public.company_invest(gen_random_uuid(), 'm_machines') -> 'listed' as i3 \gset
reset role;
select tests.assert(
  (select i ->> 'status' from jsonb_array_elements(:'i2'::jsonb -> 'items') i where i ->> 'key' = 'r_quality_1') = 'active'
  and (:'i2'::jsonb #>> '{effects,qualityBps}')::int = 300
  and (select i -> 'missing' from jsonb_array_elements(:'i2'::jsonb -> 'items') i where i ->> 'key' = 'r_quality_2') = '[]'::jsonb
  and (select status = 'completed' from public.player_missions where player_id = :f and template_key = 'm_first_research')
  and exists (select 1 from public.notifications where player_id = :f and type_key = 'company_project')
  -- the machine park: level 1 is active (+4 % capacity), level 2 is in work and costs 1.6 times as much
  and (select (i ->> 'level')::int = 1 and i ->> 'status' = 'active' and i ->> 'ready_at' is not null
         from jsonb_array_elements(:'i3'::jsonb -> 'items') i where i ->> 'key' = 'm_machines')
  and (:'i3'::jsonb #>> '{effects,capacityBps}')::int = 400
  and (select spent_cents from public.company_investments where company_id = :'co' and key = 'm_machines')
      = public.listed_item_cost(public.listed_item('m_machines'), 0, :ref1, 0) + public.listed_item_cost(public.listed_item('m_machines'), 1, :ref1, 0),
  'company_invest(): finished research is active for good and completes the mission; machines have levels, each 1.6 times the price');

-- =============================================================================
-- F. Employee satisfaction: benefits, actions, the red zone
-- =============================================================================
select tests.lx_set(:'co', 50, 50);
select tests.company_cash(:'co') as cc2 \gset
select tests.login_as('authenticated', :f);
select public.company_invest(gen_random_uuid(), 'b_obstkorb') is not null and public.company_invest(gen_random_uuid(), 'b_kaffee') is not null
   and public.company_invest(gen_random_uuid(), 'b_homeoffice') is not null as ok \gset
select public.company_invest(gen_random_uuid(), 'x_teamevent') -> 'listed' as s1 \gset
select tests.throws_key($$select public.company_invest(gen_random_uuid(), 'x_teamevent')$$, 'item_running',
  'company_invest(): a team action has a cooldown');
reset role;
select tests.assert(
  (:'s1'::jsonb #>> '{effects,satisfaction}')::int = 11
  and (:'s1'::jsonb #>> '{satisfaction,value}')::float8 = 58
  and tests.company_cash(:'co') = :cc2::bigint - 5000 - 8000 - 50000 - (30000 + 6000)
  and (select i ->> 'cooldown_until' is not null and i ->> 'status' = 'none'
         from jsonb_array_elements(:'s1'::jsonb -> 'items') i where i ->> 'key' = 'x_teamevent')
  -- three benefits for one head: 0.40 + 0.50 + 1.00 EUR per hour
  and (:'s1'::jsonb ->> 'upkeep_per_hour_cents')::bigint
      = 190 + public.listed_item_upkeep(public.listed_item('m_machines'), 1, public.listed_ref_revenue(:'co'), 0),
  'benefits lift the target (+11), cost per head and hour; a team event lifts the mood at once (+8)');

-- a benefit taken away hurts at once; a product others need cannot be retired
select tests.login_as('authenticated', :f);
select public.company_invest_stop(gen_random_uuid(), 'b_homeoffice') -> 'listed' as s2 \gset
select tests.throws_key($$select public.company_invest_stop(gen_random_uuid(), 'r_quality_1')$$, 'item_unknown',
  'company_invest_stop(): research cannot be retired');
reset role;
select tests.assert(
  (:'s2'::jsonb #>> '{satisfaction,value}')::float8 = 53 and (:'s2'::jsonb #>> '{effects,satisfaction}')::int = 6
  and (select i ->> 'status' from jsonb_array_elements(:'s2'::jsonb -> 'items') i where i ->> 'key' = 'b_homeoffice') = 'none',
  'company_invest_stop(): a benefit taken away costs its points at once (-5)');

-- the red zone: capacity and quality fall, every third red hour an AI worker quits, the founder is told
update public.player_companies set ai_workers = 2 where company_id = :'co';
select tests.lx_set(:'co', 10, 50);
update public.listed_companies set red_hours = 2 where company_id = :'co';
select tests.lx_hour(:'co', 27) is not null as ok \gset
select tests.assert(
  (select ai_workers from public.player_companies where company_id = :'co') = 1
  and (select l.red_hours = 3 and l.satisfaction < 35 and l.quits_today = 1 and l.ai_workers_seen = 1 and l.layoff_heat = 0
         from public.listed_companies l where l.company_id = :'co')
  and exists (select 1 from public.notifications where player_id = :f and type_key = 'team_mood')
  -- capacity of the hour: (founder 1.5 + 2 AI) x 50 000 x machines 1.04 x mood (1 - 0.3 x 50 / 60)
  and (tests.lx_row(:'co', 27)).capacity_cents = round(3.5 * 50000 * 1.04 * (1 - 0.3 * 50 / 60.0)),
  'red zone: capacity falls with the mood, an AI worker quits (not counted as a dismissal), the founder is notified');

-- dismissing people costs satisfaction
select tests.lx_set(:'co', 60, 50);
update public.player_companies set ai_workers = 4 where company_id = :'co';
update public.listed_companies set ai_workers_seen = 4 where company_id = :'co';
update public.player_companies set ai_workers = 1 where company_id = :'co';
select tests.lx_hour(:'co', 26) is not null as ok \gset
select tests.assert(
  (select l.layoff_heat from public.listed_companies l where l.company_id = :'co') = 9
  and (select (h.drivers #>> '{satisfaction,layoffs}')::float8 from public.listed_company_hours h
        where h.company_id = :'co' order by h.hour_start desc limit 1) = -9,
  'dismissing three AI workers costs 9 points of the target, fading by the hour');

-- =============================================================================
-- G. Reputation: a founder who pays himself everything loses revenue; dividends through the ledger
-- =============================================================================
-- a profitable company whose demand is below the capacity: ten AI workers, a small market
update public.player_companies set ai_workers = 10, potential_annual_cents = 640000 where company_id = :'co';
delete from public.company_investments where company_id = :'co' and kind in ('benefit', 'machine', 'research');
select tests.lx_set(:'co', 60, 50);
select tests.lx_hour(:'co', 25) is not null as ok \gset
select tests.lx_set(:'co', 60, 15);
select tests.lx_hour(:'co', 24) is not null as ok \gset
select tests.assert(
  (tests.lx_row(:'co', 25)).demand_cents = 400000 and (tests.lx_row(:'co', 25)).revenue_cents = 400000
  and (tests.lx_row(:'co', 25)).profit_cents > 0
  and (tests.lx_row(:'co', 24)).demand_cents = 344000 and (tests.lx_row(:'co', 24)).revenue_cents = 344000,
  'reputation 15 instead of 50: demand and revenue fall by 14 %');

select tests.login_as('authenticated', :f);
select public.set_founder_payout(gen_random_uuid(), 10000) is not null as ok \gset
-- he also takes 5 000 EUR out by hand: withdrawals count like the automatic payout
select public.company_withdraw(gen_random_uuid(), 500000) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :f);
reset role;
select tests.lx_set(:'co', 60, 50);
select tests.cash(:f) as fc0 \gset
select tests.lx_hour(:'co', 23) is not null as ok \gset
select * from public.listed_company_hours where company_id = :'co' order by hour_start desc limit 1 \gset lg_
select tests.assert(
  (tests.lx_row(:'co', 23)).founder_payout_cents = (tests.lx_row(:'co', 23)).profit_cents
  and tests.cash(:f) = :fc0::bigint + (tests.lx_row(:'co', 23)).profit_cents
  and (:'lg_drivers'::jsonb ->> 'payout_ratio_bps')::int > 3000
  and (:'lg_drivers'::jsonb #>> '{reputation,greed}')::float8 < 0
  and (:'lg_drivers'::jsonb #>> '{satisfaction,greed}')::float8 < 0
  and :lg_rep_target::float8 < 50 and :lg_reputation::float8 < 50
  and (select l.price_factor < 1 from public.listed_companies l where l.company_id = :'co'),
  'greed: paying out the whole profit lowers the reputation target, the mood and the fair share price');
-- the fair value per share follows the reputation
select fair_value_e4 as fv0 from public.security_sim_state where security_id = :'sec' \gset
select price_factor as pf0 from public.listed_companies where company_id = :'co' \gset
select tests.lx_set(:'co', 60, 90);
select tests.lx_hour(:'co', 22) is not null as ok \gset
select tests.assert(
  (select l.price_factor > :pf0 from public.listed_companies l where l.company_id = :'co')
  and (select s.fair_value_e4 = greatest(1, round(:fv0 / :pf0::float8 * (select l.price_factor from public.listed_companies l where l.company_id = :'co')))
         from public.security_sim_state s where s.security_id = :'sec'),
  'the fair share price moves with the reputation factor');
select tests.login_as('authenticated', :f);
select public.set_founder_payout(gen_random_uuid(), 0) is not null as ok \gset
reset role;

-- dividends: declared as a total, paid by shares through the ledger, the AI float goes to the market
select tests.lx_set(:'co', 60, 50);
select tests.company_cash(:'co') as cc3 \gset
select tests.cash(:f) as fc3 \gset
select tests.cash(:a) as ac3 \gset
select tests.cash(:b) as bc3 \gset
select balance_cents as mk3 from public.ledger_accounts where system_key = 'market' \gset
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.company_declare_dividend(gen_random_uuid(), 500)$$, 'invalid_argument',
  'company_declare_dividend(): at least dividends.minTotalCents');
select tests.throws_key(format($$select public.company_declare_dividend(gen_random_uuid(), %s)$$, :cc3::bigint + 1), 'insufficient_funds',
  'company_declare_dividend(): not more than the free cash');
select tests.throws_key(format($$select public.company_declare_dividend(gen_random_uuid(), %s)$$, :cc3::bigint / 2 + 1), 'dividend_limit',
  'company_declare_dividend(): at most half of the free cash');
select public.company_declare_dividend(gen_random_uuid(), 1000001) as d1 \gset
select tests.throws_key($$select public.company_declare_dividend(gen_random_uuid(), 100000)$$, 'dividend_limit',
  'company_declare_dividend(): once per Berlin day');
reset role;
select tests.assert(
  tests.company_cash(:'co') = :cc3::bigint - 1000001
  and tests.cash(:f) = :fc3::bigint + 600000 and tests.cash(:a) = :ac3::bigint + 250000 and tests.cash(:b) = :bc3::bigint + 100000
  and (select balance_cents from public.ledger_accounts where system_key = 'market') = :mk3::bigint + 50001
  and :'d1'::jsonb -> 'dividend' @> '{"total_cents": 1000001, "players_cents": 950000, "float_cents": 50001, "holders": 3}'::jsonb
  and (:'d1'::jsonb #>> '{listed,dividends,can_declare}')::boolean = false
  and (:'d1'::jsonb #>> '{listed,dividends,streak}')::int = 1
  and jsonb_array_length(:'d1'::jsonb #> '{listed,dividends,last}') = 1
  and (select count(*) from public.ledger_transactions t where t.kind = 'dividend' and t.ref_id = :'co'::uuid and t.metadata ->> 'cat' = 'dividend') = 4
  and exists (select 1 from public.notifications where player_id = :a and type_key = 'company_dividend')
  and exists (select 1 from public.feed_items where actor_id = :f and kind = 'record_dividend')
  and not exists (select 1 from public.ledger_audit()),
  'dividend: every shareholder gets total x own shares / all shares (rounded down), the AI float the rest; ledger balanced');
select tests.lx_hour(:'co', 21) is not null as ok \gset
select tests.assert(
  (select (h.drivers #>> '{reputation,dividends}')::float8 = 13 from public.listed_company_hours h
    where h.company_id = :'co' order by h.hour_start desc limit 1)
  and (select (h.drivers #>> '{reputation,dividends}')::float8 = 0 from public.listed_company_hours h
        where h.company_id = :'co' order by h.hour_start desc offset 1 limit 1),
  'dividends raise the reputation target: +12 for a fifth of the profit or more, +1 per day in a row');

-- =============================================================================
-- H. The board
-- =============================================================================
select tests.set_cfg('listed', '{board,cooldownHours}', '0');
select tests.set_cfg('listed', '{board,maxOpen}', '5');
select tests.login_as('authenticated', :n);
select tests.throws_key(format($$select public.get_company_board(%L)$$, :'co'), 'board_not_shareholder',
  'get_company_board(): only for the founder and shareholders');
reset role;
select tests.login_as('authenticated', :b);
select public.get_company_board(:'co') -> 'board' as bb0 \gset
select tests.throws_key(format($$select public.board_propose(gen_random_uuid(), %L, 'withdraw_ban', '{"days": 1}')$$, :'co'), 'board_no_right',
  'board_propose(): 10 % of the shares are not enough');
reset role;
select tests.assert(
  not (:'bb0'::jsonb ->> 'can_convene')::boolean and (:'bb0'::jsonb ->> 'can_vote')::boolean
  and (:'bb0'::jsonb ->> 'my_share_bps')::int = 1000 and (:'bb0'::jsonb ->> 'float_e6')::bigint = 50000000000
  and jsonb_array_length(:'bb0'::jsonb -> 'holders') = 3 and not (:'bb0'::jsonb ->> 'is_founder')::boolean,
  'get_company_board(): a small shareholder sees the board and may vote, but not convene it');

-- Anton (25 %) convenes: earmark 50 000 EUR for research. Berta votes yes (35 %), the founder no (60 %): rejected.
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.board_propose(gen_random_uuid(), %L, 'earmark', '{"purpose": "yachts", "amount_cents": 100}')$$, :'co'),
  'invalid_argument', 'board_propose(): only known purposes');
select tests.throws_key(format($$select public.board_propose(gen_random_uuid(), %L, 'payout_cap', '{"bps": 1000, "days": 99}')$$, :'co'),
  'invalid_argument', 'board_propose(): at most board.maxDays days');
select public.board_propose(gen_random_uuid(), :'co', 'earmark', '{"purpose": "research", "amount_cents": 5000000}') -> 'board' as m1 \gset
reset role;
select (:'m1'::jsonb #>> '{motions,0,id}')::bigint as mid1 \gset
select tests.login_as('authenticated', :b);
select public.board_vote(gen_random_uuid(), :mid1, true) -> 'board' as m1b \gset
reset role;
select tests.login_as('authenticated', :f);
select public.board_vote(gen_random_uuid(), :mid1, false) -> 'board' as m1f \gset
select tests.throws_key(format($$select public.board_vote(gen_random_uuid(), %s, true)$$, :mid1), 'board_motion_unknown',
  'board_vote(): a closed motion takes no votes');
reset role;
select tests.login_as('authenticated', :n);
select tests.throws_key($$select public.board_vote(gen_random_uuid(), 999999999, true)$$, 'board_motion_unknown', 'board_vote(): unknown motion');
reset role;
select tests.assert(
  :'m1'::jsonb #>> '{motions,0,status}' = 'open' and (:'m1'::jsonb #>> '{motions,0,yes_e6}')::bigint = 250000000000
  and :'m1'::jsonb #>> '{motions,0,my_vote}' = 'yes' and (:'m1'::jsonb #>> '{motions,0,mine}')::boolean
  and (:'m1b'::jsonb #>> '{motions,0,yes_e6}')::bigint = 350000000000 and :'m1b'::jsonb #>> '{motions,0,status}' = 'open'
  and jsonb_array_length(:'m1f'::jsonb -> 'motions') = 0
  and :'m1f'::jsonb #>> '{history,0,status}' = 'rejected' and (:'m1f'::jsonb #>> '{history,0,no_e6}')::bigint = 600000000000
  and public.listed_reserved_cents(:'co') = 0
  and exists (select 1 from public.notifications where player_id = :f and type_key = 'board' and dedupe_key = 'board-new:' || :mid1)
  and exists (select 1 from public.notifications where player_id = :b and type_key = 'board' and dedupe_key = 'board-result:' || :mid1),
  'board: votes count by shares; 35 % yes against the founder''s 60 % no is rejected at once; shareholders are notified');

-- the same motion with the founder's yes passes: the money is earmarked
select tests.company_cash(:'co') as cc4 \gset
select tests.login_as('authenticated', :a);
select public.board_propose(gen_random_uuid(), :'co', 'earmark', '{"purpose": "research", "amount_cents": 5000000}') -> 'board' as m2 \gset
reset role;
select (:'m2'::jsonb #>> '{motions,0,id}')::bigint as mid2 \gset
select tests.login_as('authenticated', :f);
select public.board_vote(gen_random_uuid(), :mid2, true) -> 'board' as m2f \gset
select public.get_listed_company() -> 'listed' as l2 \gset
select tests.throws_key(format($$select public.company_withdraw(gen_random_uuid(), %s)$$, :cc4::bigint), 'budget_reserved',
  'company_withdraw(): money earmarked by the board cannot be withdrawn');
select public.company_withdraw(gen_random_uuid(), :cc4::bigint - 5000000) is not null as ok \gset
select tests.throws_key($$select public.company_withdraw(gen_random_uuid(), 1)$$, 'budget_reserved',
  'company_withdraw(): nothing free is left, only the budget');
-- only its purpose may use the budget: research yes, a product no
select tests.throws_key($$select public.company_invest(gen_random_uuid(), 'p_second')$$, 'budget_reserved',
  'company_invest(): a product cannot be paid from the research budget');
select public.company_invest(gen_random_uuid(), 'r_sustainability_1') -> 'listed' as l3 \gset
reset role;
select public.listed_item_cost(public.listed_item('r_sustainability_1'), 0, public.listed_ref_revenue(:'co'), 10) as cost2 \gset
select tests.assert(
  :'m2f'::jsonb #>> '{history,0,status}' = 'passed' and (:'m2f'::jsonb #>> '{history,0,result,amount_cents}')::bigint = 5000000
  and :'m2f'::jsonb -> 'budgets' = '[{"purpose": "research", "amount_cents": 5000000}]'::jsonb
  and (:'l2'::jsonb ->> 'reserved_cents')::bigint = 5000000 and (:'l2'::jsonb ->> 'free_cash_cents')::bigint = :cc4::bigint - 5000000
  and (:'l3'::jsonb ->> 'reserved_cents')::bigint = 5000000 - :cost2::bigint
  and tests.company_cash(:'co') = 5000000 - :cost2::bigint
  and (:'l3'::jsonb ->> 'free_cash_cents')::bigint = 0,
  'board: earmarked money is not free cash; the founder cannot withdraw it, only spend it on its purpose');
-- the hourly payout never touches earmarked money
select tests.login_as('authenticated', :f);
select public.set_founder_payout(gen_random_uuid(), 10000) is not null as ok \gset
reset role;
select tests.lx_set(:'co', 60, 50);
select tests.lx_hour(:'co', 20) is not null as ok \gset
select tests.assert(
  (tests.lx_row(:'co', 20)).profit_cents > 0
  and (tests.lx_row(:'co', 20)).founder_payout_cents = (tests.lx_row(:'co', 20)).profit_cents
  and tests.company_cash(:'co') = 5000000 - :cost2::bigint,
  'close_hour(): the CEO payout takes the free cash only, the budget stays');

-- payout cap: passed by Anton and the founder; the founder cannot set more, the hour pays the capped share
select tests.login_as('authenticated', :a);
select public.board_propose(gen_random_uuid(), :'co', 'payout_cap', '{"bps": 1000, "days": 3}') -> 'board' as m3 \gset
reset role;
select (:'m3'::jsonb #>> '{motions,0,id}')::bigint as mid3 \gset
select tests.login_as('authenticated', :f);
select public.board_vote(gen_random_uuid(), :mid3, true) -> 'board' as m3f \gset
select tests.throws_key($$select public.set_founder_payout(gen_random_uuid(), 1500)$$, 'payout_capped',
  'set_founder_payout(): not above the board''s cap');
select public.set_founder_payout(gen_random_uuid(), 500) is not null as ok \gset
reset role;
update public.player_companies set founder_payout_bps = 8000 where company_id = :'co';
select tests.lx_set(:'co', 60, 50);
select tests.lx_hour(:'co', 19) is not null as ok \gset
select tests.assert(
  (:'m3f'::jsonb #>> '{restrictions,payout_cap_bps}')::int = 1000 and (:'m3f'::jsonb ->> 'founder_payout_bps')::int = 1000
  and (tests.lx_row(:'co', 19)).founder_payout_cents = (tests.lx_row(:'co', 19)).profit_cents * 1000 / 10000
  and public.listed_payout_cap_bps(:'co', now()) = 1000 and public.listed_payout_cap_bps(:'co', now() + interval '4 days') = 10000,
  'board: the payout cap lowers the current share, blocks a higher one and caps the hourly payout until it ends');

-- the founder holds more than half: his own motion passes at once (withdrawal ban, price level)
select tests.login_as('authenticated', :f);
select public.board_propose(gen_random_uuid(), :'co', 'withdraw_ban', '{"days": 2}') -> 'board' as m4 \gset
select tests.throws_key($$select public.company_withdraw(gen_random_uuid(), 1)$$, 'withdraw_blocked',
  'company_withdraw(): forbidden while the board''s ban holds');
select public.board_propose(gen_random_uuid(), :'co', 'price_level', '{"price_level": "premium", "days": 2}') -> 'board' as m5 \gset
select tests.throws_key($$select public.set_company_strategy(gen_random_uuid(), 'budget', false)$$, 'strategy_locked',
  'set_company_strategy(): the board fixed the price level');
select public.set_company_strategy(gen_random_uuid(), 'premium', true) is not null as ok \gset
reset role;
select tests.assert(
  :'m4'::jsonb #>> '{history,0,status}' = 'passed' and :'m4'::jsonb #>> '{restrictions,withdraw_block_until}' is not null
  and :'m5'::jsonb #>> '{restrictions,price_lock}' = 'premium'
  and (select price_level from public.player_companies where company_id = :'co') = 'premium',
  'board: a holder of more than half of all shares decides at once; ban and price level are binding');
update public.listed_companies set withdraw_block_until = null, price_lock_until = null, payout_cap_until = null where company_id = :'co';
update public.player_companies set price_level = 'normal', contract_work = false, founder_payout_bps = 0 where company_id = :'co';

-- quorum: 25 % alone are not enough when the time is up
select tests.login_as('authenticated', :a);
select public.board_propose(gen_random_uuid(), :'co', 'dividend', '{"amount_cents": 100000}') -> 'board' as m6 \gset
reset role;
select (:'m6'::jsonb #>> '{motions,0,id}')::bigint as mid6 \gset
update public.board_motions set closes_at = now() - interval '1 second' where id = :mid6;
select public.board_close_due(:'co') as closed6 \gset
select tests.assert(
  :closed6::int = 1 and (select status from public.board_motions where id = :mid6) = 'no_quorum'
  and not exists (select 1 from public.company_dividends where company_id = :'co' and source = 'board'),
  'board: without 30 % of all shares voting a motion fails (no quorum)');

-- a bad reputation: the AI float votes yes on shareholder protection; a decision without the founder is a revolt
select tests.lx_set(:'co', 60, 30);
select tests.login_as('authenticated', :a);
select public.board_propose(gen_random_uuid(), :'co', 'payout_cap', '{"bps": 0, "days": 1}') -> 'board' as m7 \gset
reset role;
select (:'m7'::jsonb #>> '{motions,0,id}')::bigint as mid7 \gset
update public.board_motions set closes_at = now() - interval '1 second' where id = :mid7;
select public.board_close_due(:'co') is not null as ok \gset
select tests.assert(
  (:'m7'::jsonb ->> 'ai_votes')::boolean and (:'m7'::jsonb #>> '{motions,0,ai_e6}')::bigint = 50000000000
  and (select status = 'passed' and yes_e6 = 250000000000 and ai_e6 = 50000000000 from public.board_motions where id = :mid7)
  and public.listed_payout_cap_bps(:'co', now()) = 0
  and exists (select 1 from public.feed_items where actor_id = :a and kind = 'board_revolt'),
  'board: with a reputation below 40 the AI float joins (25 % + 5 % reach the quorum); passed without the founder: a revolt');
select tests.lx_set(:'co', 60, 50);
update public.listed_companies set payout_cap_until = null where company_id = :'co';

-- release: the budget is free again
select tests.login_as('authenticated', :f);
select public.board_propose(gen_random_uuid(), :'co', 'release', '{"purpose": "research"}') -> 'board' as m8 \gset
reset role;
select tests.assert(
  :'m8'::jsonb -> 'budgets' = '[]'::jsonb and public.listed_reserved_cents(:'co') = 0
  and jsonb_array_length(:'m8'::jsonb -> 'history') = 8,
  'board: a released budget is free cash again; the history keeps every motion');

-- =============================================================================
-- I. Books and taxes
-- =============================================================================
-- a fresh period with one profitable hour
select tests.fund(:f, 20000000, 'test:a3:f2');
select tests.login_as('authenticated', :f);
select public.company_deposit(gen_random_uuid(), 20000000) is not null as ok \gset
reset role;
update public.listed_companies set books_until = now(), books_day = null, loss_carry_cents = 0, books_streak = 0 where company_id = :'co';
update public.player_companies set potential_annual_cents = 800000 where company_id = :'co';
select tests.lx_set(:'co', 60, 50);
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.company_books_close(gen_random_uuid(), null, false)$$, 'books_nothing',
  'company_books_close(): nothing to do without new revenue');
reset role;
select tests.lx_hour(:'co', 18) is not null as ok \gset
select (tests.lx_row(:'co', 18)).revenue_cents as r18 \gset
select (tests.lx_row(:'co', 18)).profit_cents as p18 \gset
select books_until as bu from public.listed_companies where company_id = :'co' \gset
select array_agg(r ->> 'category' order by (r ->> 'id')::int) as answers from jsonb_array_elements(public.listed_books_receipts(:'co', :'bu')) r \gset
select tests.login_as('authenticated', :f);
select public.get_listed_company() #> '{listed,books}' as bk0 \gset
\set rq2 '''0a30a30a-0000-4000-8000-0000000000e2'''
select public.company_books_close(:rq2, :'answers'::text[], false) as bc1 \gset
select public.company_books_close(:rq2, :'answers'::text[], false) as bc1b \gset
select tests.throws_key($$select public.company_books_close(gen_random_uuid(), null, false)$$, 'books_nothing',
  'company_books_close(): once per Berlin day');
reset role;
select tests.assert(
  (:'bk0'::jsonb ->> 'can_close')::boolean and :'bk0'::jsonb ->> 'stage' = 'open'
  and (:'bk0'::jsonb ->> 'revenue_cents')::bigint = :r18::bigint and (:'bk0'::jsonb ->> 'profit_cents')::bigint = :p18::bigint
  and jsonb_array_length(:'bk0'::jsonb -> 'receipts') = 3 and not (:'bk0'::jsonb #> '{receipts,0}') ? 'category'
  and (:'bk0'::jsonb ->> 'estimated_tax_cents')::bigint = :p18::bigint * 1500 / 10000
  and :'bc1'::jsonb = :'bc1b'::jsonb
  and (:'bc1'::jsonb #>> '{period,profit_cents}')::bigint = :p18::bigint
  and (:'bc1'::jsonb #>> '{period,check_correct}')::int = 3
  and (:'bc1'::jsonb #>> '{period,discount_cents}')::bigint = (:p18::bigint * 1500 / 10000) * 500 / 10000
  and (:'bc1'::jsonb #>> '{period,tax_cents}')::bigint = :p18::bigint * 1500 / 10000 - (:p18::bigint * 1500 / 10000) * 500 / 10000
  and :'bc1'::jsonb #>> '{period,status}' = 'due' and :'bc1'::jsonb #>> '{period,closed_by}' = 'founder'
  and (:'bc1'::jsonb #>> '{listed,taxes,due_cents}')::bigint = (:'bc1'::jsonb #>> '{period,tax_cents}')::bigint
  and (:'bc1'::jsonb #>> '{listed,books,done_today}')::boolean and (:'bc1'::jsonb #>> '{listed,books,streak}')::int = 1,
  'books: the period''s profit from the real bookings; 15 % tax, 5 % off for three receipts sorted right; once a day; idempotent');

select tests.company_cash(:'co') as cc5 \gset
select tests.treasury() as tr5 \gset
select (:'bc1'::jsonb #>> '{period,tax_cents}')::bigint as tax1 \gset
select tests.login_as('authenticated', :f);
select public.company_tax_pay(gen_random_uuid()) as tp1 \gset
select tests.throws_key($$select public.company_tax_pay(gen_random_uuid())$$, 'tax_nothing_due', 'company_tax_pay(): nothing is due any more');
reset role;
select tests.assert(
  (:'tp1'::jsonb ->> 'paid_cents')::bigint = :tax1::bigint and (:'tp1'::jsonb #>> '{listed,taxes,due_cents}')::bigint = 0
  and tests.company_cash(:'co') = :cc5::bigint - :tax1::bigint and tests.treasury() = :tr5::bigint + :tax1::bigint
  and :'tp1'::jsonb #>> '{listed,taxes,periods,0,status}' = 'paid'
  and (select count(*) from public.ledger_transactions t where t.kind = 'tax' and t.ref_id = :'co'::uuid and t.metadata ->> 'cat' = 'tax') = 1,
  'tax: paid from the company cash to the treasury through the ledger');

-- next day: a loss carried forward is used first, wrong receipts give no discount, investments lower the profit
update public.listed_companies set books_day = books_day - 1, loss_carry_cents = 10000 where company_id = :'co';
select tests.lx_set(:'co', 60, 50);
select tests.lx_hour(:'co', 17) is not null as ok \gset
select (tests.lx_row(:'co', 17)).profit_cents as p17 \gset
select tests.login_as('authenticated', :f);
select public.company_invest(gen_random_uuid(), 'b_obstkorb') is not null as ok \gset
select public.company_books_close(gen_random_uuid(), array['tax', 'tax', 'tax'], true) as bc2 \gset
reset role;
select tests.assert(
  (:'bc2'::jsonb #>> '{period,profit_cents}')::bigint = :p17::bigint - 5000
  and (:'bc2'::jsonb #>> '{period,loss_used_cents}')::bigint = 10000
  and (:'bc2'::jsonb #>> '{period,taxable_cents}')::bigint = :p17::bigint - 15000
  and (:'bc2'::jsonb #>> '{period,discount_cents}')::bigint = 0 and (:'bc2'::jsonb #>> '{period,check_correct}')::int = 0
  and (:'bc2'::jsonb #>> '{period,tax_cents}')::bigint = (:p17::bigint - 15000) * 1500 / 10000
  and (:'bc2'::jsonb ->> 'paid_cents')::bigint = (:'bc2'::jsonb #>> '{period,tax_cents}')::bigint
  and :'bc2'::jsonb #>> '{period,status}' = 'paid'
  and (:'bc2'::jsonb #>> '{listed,taxes,loss_carry_cents}')::bigint = 0
  and (:'bc2'::jsonb #>> '{listed,books,streak}')::int = 2,
  'books: investments are costs, the carried loss comes first, wrong receipts only cost the discount; pay at once; a streak of 2');

-- a loss period: no tax, the loss is carried forward
update public.listed_companies set books_day = books_day - 1 where company_id = :'co';
update public.player_companies set ai_workers = 0 where company_id = :'co';
select tests.lx_set(:'co', 60, 50);
select tests.lx_hour(:'co', 16) is not null as ok \gset
select (tests.lx_row(:'co', 16)).profit_cents as p16 \gset
select tests.login_as('authenticated', :f);
select public.company_books_close(gen_random_uuid(), null, false) as bc3 \gset
reset role;
select tests.assert(
  :p16::bigint < 0 and (:'bc3'::jsonb #>> '{period,tax_cents}')::bigint = 0 and :'bc3'::jsonb #>> '{period,status}' = 'paid'
  and (:'bc3'::jsonb #>> '{listed,taxes,loss_carry_cents}')::bigint = 0 - (:p16)::bigint,
  'books: a loss costs no tax and is carried forward');
update public.player_companies set ai_workers = 10 where company_id = :'co';
update public.listed_companies set ai_workers_seen = 10 where company_id = :'co';

-- the tax office: reminder, late fee, estimate with an audit
update public.listed_companies set books_day = books_day - 3, loss_carry_cents = 0 where company_id = :'co';
select tests.lx_set(:'co', 60, 50);
select tests.lx_hour(:'co', 15) is not null as ok \gset
select (tests.lx_row(:'co', 15)).revenue_cents as r15 \gset
select (tests.lx_row(:'co', 15)).profit_cents as p15 \gset
update public.listed_companies set books_until = now() - interval '31 hours' where company_id = :'co';
select (public.listed_period_sums(:'co', now() - interval '31 hours', now()) ->> 'revenue_cents')::bigint as rev31 \gset
select (public.listed_period_sums(:'co', now() - interval '31 hours', now()) ->> 'costs_cents')::bigint as cost31 \gset
select public.listed_tax_office(:'co');
select tests.assert(
  (select books_stage from public.listed_companies where company_id = :'co') = 1
  and exists (select 1 from public.notifications where player_id = :f and type_key = 'tax_office' and title = 'Finanzamt: Bücher fällig')
  and (public.listed_books_preview(:'co') ->> 'stage') = 'reminder'
  and not exists (select 1 from public.company_tax_periods where company_id = :'co' and kind = 'late_fee'),
  'tax office: 30 hours without books: a reminder, nothing else');
select reputation as rep6 from public.listed_companies where company_id = :'co' \gset
update public.listed_companies set books_until = now() - interval '43 hours' where company_id = :'co';
select public.listed_tax_office(:'co');
select public.listed_tax_office(:'co');
select tests.assert(
  (select count(*) from public.company_tax_periods where company_id = :'co' and kind = 'late_fee') = 1
  and (select penalty_cents = greatest(5000, :rev31::bigint * 50 / 10000) and status = 'due' and tax_cents = 0
         from public.company_tax_periods where company_id = :'co' and kind = 'late_fee')
  and (select tests.near(reputation, :rep6::float8 - 3) from public.listed_companies where company_id = :'co')
  and exists (select 1 from public.feed_items where actor_id = :f and kind = 'tax_penalty'),
  'tax office: 42 hours: a late fee (0.5 % of the revenue, at least 50 EUR), once; the reputation drops by 3');
update public.listed_companies set books_until = now() - interval '61 hours' where company_id = :'co';
select public.listed_tax_office(:'co');
select * from public.company_tax_periods where company_id = :'co' and closed_by = 'finanzamt' and kind = 'books' order by id desc limit 1 \gset est_
select tests.assert(
  :est_taxable_cents::bigint = greatest(:rev31::bigint - :cost31::bigint, :rev31::bigint * 2500 / 10000)
  and :est_tax_cents::bigint = :est_taxable_cents::bigint * 1500 / 10000
  and :est_penalty_cents::bigint = :est_tax_cents::bigint * 2500 / 10000
  and (select tests.near(reputation, :rep6::float8 - 3 - 6) and books_streak = 0 and books_stage = 0
         from public.listed_companies where company_id = :'co')
  and exists (select 1 from public.player_company_events e where e.company_id = :'co' and e.archetype = 'tax_audit' and e.status = 'open')
  and exists (select 1 from public.feed_items where actor_id = :f and kind = 'tax_audit'),
  'tax office: 60 hours: it estimates (at least 25 % margin, 25 % surcharge) and sends an audit, a company crisis');

-- unpaid taxes: a surcharge after the deadline, then collection by force
update public.company_tax_periods set due_at = now() - interval '1 hour' where id = :est_id;
update public.company_tax_periods set status = 'paid', paid_at = now() where company_id = :'co' and kind = 'late_fee';
select public.listed_tax_office(:'co');
select tests.assert(
  (select stage = 1 and penalty_cents = :est_penalty_cents::bigint + :est_tax_cents::bigint * 500 / 10000 and status = 'due'
     from public.company_tax_periods where id = :est_id),
  'tax office: an unpaid tax gets a 5 % surcharge after the deadline');
update public.company_tax_periods set due_at = now() - interval '50 hours' where id = :est_id;
select tests.company_cash(:'co') as cc6 \gset
select tests.treasury() as tr6 \gset
select reputation as rep7 from public.listed_companies where company_id = :'co' \gset
select public.listed_tax_office(:'co');
select tests.assert(
  (select stage = 2 and status = 'paid' and paid_cents = tax_cents + penalty_cents
          and penalty_cents = :est_penalty_cents::bigint + :est_tax_cents::bigint * 500 / 10000 + :est_tax_cents::bigint * 1000 / 10000
     from public.company_tax_periods where id = :est_id)
  and tests.company_cash(:'co') = :cc6::bigint - (select paid_cents from public.company_tax_periods where id = :est_id)
  and tests.treasury() = :tr6::bigint + (select paid_cents from public.company_tax_periods where id = :est_id)
  and (select tests.near(reputation, :rep7::float8 - 8) from public.listed_companies where company_id = :'co')
  and (select count(*) from public.ledger_transactions t where t.kind = 'fine' and t.ref_id = :'co'::uuid and t.metadata ->> 'cat' = 'penalty') = 1,
  'tax office: after 48 more hours it collects by force (10 % more), tax and fine go to the treasury; the reputation drops by 8');

-- the tax advisor does the books of a new day and pays; his wage is a running cost
select tests.login_as('authenticated', :f);
select public.company_tax_advisor(gen_random_uuid(), true) -> 'listed' as ad0 \gset
reset role;
update public.listed_companies set books_day = books_day - 1 where company_id = :'co';
select tests.lx_set(:'co', 60, 50);
select tests.lx_hour(:'co', 14) is not null as ok \gset
select * from public.company_tax_periods where company_id = :'co' order by id desc limit 1 \gset adv_
select 'pch:' || :'co' || ':' || to_char((date_trunc('hour', now()) - interval '14 hours') at time zone 'UTC', 'YYYYMMDDHH24') as k14 \gset
select tests.assert(
  (:'ad0'::jsonb #>> '{taxes,advisor}')::boolean
  and :'adv_closed_by' = 'advisor' and :'adv_status' = 'paid'
  and :adv_discount_cents::bigint = (:adv_taxable_cents::bigint * 1500 / 10000) * 800 / 10000
  and (select e.amount_cents from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.idempotency_key = :'k14' || ':lx:advisor' and e.account_id = public.company_cash_account(:'co'))
      = -public.listed_advisor_wage((select ref_revenue_cents from public.listed_companies where company_id = :'co'))
  and (select books_day = (now() at time zone 'Europe/Berlin')::date from public.listed_companies where company_id = :'co'),
  'tax advisor: paid by the hour, closes the books of a new day with 8 % off and pays the tax');

-- the books: every booking with its category, sums per day
select tests.login_as('authenticated', :f);
select public.get_company_accounting(7, null) as acc \gset
select public.get_company_accounting(7, (:'acc'::jsonb ->> 'next_before')::bigint) as acc2 \gset
reset role;
select tests.assert(
  (:'acc'::jsonb ->> 'cash_cents')::bigint = tests.company_cash(:'co')
  and jsonb_array_length(:'acc'::jsonb -> 'entries') = 50 and (:'acc'::jsonb ->> 'next_before') is not null
  and (:'acc'::jsonb #>> '{entries,0,balance_after_cents}')::bigint = tests.company_cash(:'co')
  and (:'acc2'::jsonb #>> '{entries,0,id}')::bigint < (:'acc'::jsonb #>> '{entries,49,id}')::bigint
  and :'acc'::jsonb -> 'totals' ?& array['revenue', 'goods', 'fixed', 'research', 'benefit', 'dividend', 'tax', 'penalty', 'payout',
                                         'capital', 'advisor', 'product', 'expansion']
  and (:'acc'::jsonb #>> '{totals,tax}')::bigint
      = -(select sum(x.paid_cents - least(x.paid_cents, x.penalty_cents)) from public.company_tax_periods x where x.company_id = :'co' and x.kind = 'books')
  and (select sum(v::bigint) from jsonb_each_text(:'acc'::jsonb -> 'totals') t(k, v))
      = (select sum(e.amount_cents) from public.ledger_entries e where e.account_id = public.company_cash_account(:'co'))
  and (select sum((d ->> 'in_cents')::bigint - (d ->> 'out_cents')::bigint) from jsonb_array_elements(:'acc'::jsonb -> 'days') d)
      = tests.company_cash(:'co'),
  'get_company_accounting(): every booking of the company cash with its category; totals and days add up to the cash');

-- =============================================================================
-- J. Missions, feed, news
-- =============================================================================
select tests.assert(
  public.mission_requirement_ok(:f, 'listed') and not public.mission_requirement_ok(:n, 'listed')
  and (select count(*) from public.mission_templates where params ->> 'requires' = 'listed' or key in ('q_board_vote', 'm_first_motion')) = 26
  and public.mission_doable(:f, 'q_listed_research', 'research_started')
  and not public.mission_doable(:n, 'q_listed_research', 'research_started')
  and not public.mission_doable(:b, 'm_first_motion', 'board_motion')
  and public.mission_doable(:f, 'm_first_motion', 'board_motion')
  and not public.mission_doable(:f, 'm_first_dividend', 'dividend_paid')
  and not public.mission_doable(:f, 'm_first_books', 'books_done')
  and public.mission_doable(:f, 'm_audit', 'audit_survived')
  and not public.mission_doable(:b, 'q_board_vote', 'board_vote')
  and public.mission_is_money_metric('dividend_cents'),
  'missions: 26 templates for listed companies, only offered when they can be done');
select tests.assert(
  public.feed_item_label('greedy_founder', '{"company": "Listwerk"}') = 'zahlt sich bei Listwerk fast den ganzen Gewinn selbst aus'
  and public.feed_item_label('tax_audit', '{"company": "Listwerk"}') = 'Betriebsprüfung bei Listwerk'
  and public.feed_item_label('mass_quit', '{"company": "Listwerk"}') = 'Kündigungswelle bei Listwerk'
  and public.feed_item_label('board_revolt', '{"company": "Listwerk"}') = 'Aufstand im Geschäftsrat von Listwerk'
  and public.feed_item_label('record_dividend', '{"company": "Listwerk"}') = 'Rekorddividende bei Listwerk'
  and public.feed_item_label('tax_penalty', '{"company": "Listwerk"}') = 'Strafe vom Finanzamt für Listwerk'
  and position('''greedy_founder'', ''mass_quit'')' in pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure)) > 0
  and position('''record_dividend'', ''board_revolt'')' in pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure)) > 0,
  'feed and news: the new kinds have labels and are personal news of the show');
select tests.assert(tests.money_invariant() = 'ok', 'LISTED: money invariant: ' || tests.money_invariant());

-- =============================================================================
-- K. Closing the company and resetting the account
-- =============================================================================
-- an open tax, a budget and an open motion
update public.listed_companies set advisor = false, books_day = books_day - 1 where company_id = :'co';
select tests.lx_set(:'co', 60, 50);
select tests.lx_hour(:'co', 13) is not null as ok \gset
select tests.login_as('authenticated', :f);
select public.company_books_close(gen_random_uuid(), null, false) #>> '{period,tax_cents}' as tax9 \gset
select public.board_propose(gen_random_uuid(), :'co', 'earmark', '{"purpose": "benefits", "amount_cents": 100000}') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :a);
select public.board_propose(gen_random_uuid(), :'co', 'withdraw_ban', '{"days": 1}') is not null as ok \gset
reset role;
select tests.treasury() as tr9 \gset
select tests.assert(
  :tax9::bigint > 0 and public.listed_reserved_cents(:'co') = 100000
  and (select count(*) from public.board_motions where company_id = :'co' and status = 'open') = 1,
  'before closing: a tax is due, money is earmarked, a motion is open');
update public.securities set status = 'delisted', delisted_at = now() where id = :'sec';
select tests.login_as('authenticated', :f);
select public.close_company(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.assert(
  tests.treasury() = :tr9::bigint + :tax9::bigint
  and public.listed_tax_due_cents(:'co') = 0 and public.listed_reserved_cents(:'co') = 0
  and not exists (select 1 from public.board_motions where company_id = :'co' and status = 'open')
  and (select count(*) from public.board_motions where company_id = :'co' and status = 'cancelled') = 1
  and tests.company_cash(:'co') = 0 and not public.listed_is(:'co'),
  'close_company(): taxes are paid from the cash first, motions end, budgets go, the rest goes to the founder');
-- a shareholder resets the account: the votes go
select (select count(*) from public.board_votes where player_id = :a) as votes_a \gset
select tests.login_as('authenticated', :a);
select public.reset_account(gen_random_uuid(), 'Anton_Anteil') is not null as ok \gset
reset role;
select tests.assert(
  :votes_a::int > 0 and not exists (select 1 from public.board_votes where player_id = :a)
  and tests.money_invariant() = 'ok' and not exists (select 1 from public.ledger_audit()),
  'reset_account(): the player''s board votes are gone; money invariant holds');

update public.game_config set value = jsonb_set(value, '{demandNoise}', :'noise0'::jsonb) where key = 'startups';
select tests.set_cfg('listed', '{board,cooldownHours}', '6');
select tests.set_cfg('listed', '{board,maxOpen}', '2');
select tests.set_cfg('startups', '{ipo,issueProceedsLockHours}', :'lock0'::jsonb);

-- ADR-180: back to the current company scale
select tests.set_cfg('startups', '{marketFactorByTier}', '{"garage": 10, "small_business": 40, "gmbh": 150, "ag": 400}') is null as ok \gset
select tests.set_cfg('startups', '{capacityCentsPerProductivity}',
  '{"tech": 450000, "retail": 375000, "energy": 375000, "pharma": 450000, "logistics": 375000}') is null as ok \gset
select tests.set_cfg('startups', '{aiWorkerStandbyBps}', '2500') is null as ok \gset
select tests.set_cfg('startups', '{gmbh,fixedCostCentsPerQuarter}', '360000') is null as ok \gset
select tests.set_cfg('startups', '{awareness}', :'aw_cfg0'::jsonb) is null as ok \gset
