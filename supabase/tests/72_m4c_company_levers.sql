-- =============================================================================
-- 72 · M4c: contract work, price strategy, market by legal form, founding a GmbH,
--      endless expansion, IPO from the garage (ADR-083)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''07207207-0000-4000-8000-0000000000a1'''
\set b '''07207207-0000-4000-8000-0000000000b2'''
\set c '''07207207-0000-4000-8000-0000000000c3'''
\set d '''07207207-0000-4000-8000-0000000000d4'''
\set e '''07207207-0000-4000-8000-0000000000e5'''
\set rq '''07207207-0000-4000-8000-0000000000f1'''
select tests.signup(:a, 'Anke_Ausbau') is not null and tests.signup(:b, 'Bodo_Garage') is not null
   and tests.signup(:c, 'Cleo_Klein') is not null and tests.signup(:d, 'Dirk_Billig') is not null
   and tests.signup(:e, 'Edda_Edel') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 15);
select tests.set_level(:b, 9);
select tests.set_level(:c, 6);
select tests.set_level(:d, 6);
select tests.set_level(:e, 6);
select tests.fund(:a, 7000000, 'test:m4c:a');
select tests.fund(:b, 1000000, 'test:m4c:b');
select tests.fund(:c, 1000000, 'test:m4c:c');
select tests.fund(:d, 500000, 'test:m4c:d');
select tests.fund(:e, 500000, 'test:m4c:e');
-- deterministic demand for this file
select coalesce(value -> 'demandNoise', '0.1') as noise0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{demandNoise}', '0');
-- values from game_config (balance.ts): market factor of the GmbH, founding awareness of garage and GmbH
select (value #>> '{marketFactorByTier,gmbh}')::numeric as mf_gmbh,
       (value #>> '{marketFactorByTier,garage}')::numeric as mf_garage,
       round((value #>> '{foundingAwareness,gmbh}')::numeric * 10000)::int as aw_gmbh,
       round((value #>> '{foundingAwareness,garage}')::numeric * 10000)::int as aw_garage
  from public.game_config where key = 'startups' \gset

-- =============================================================================
-- A. Founding a GmbH (startups.gmbh) with a head start; the garage keeps 3 %
-- =============================================================================
select tests.login_as('authenticated', :c);
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Klein Werk', 'Kleine Dinge', 'tech', '#335577', 'gmbh')$$,
  'company_level_too_low', 'found_company(gmbh): from startups.gmbh.minLevel (15)');
reset role;
select tests.cash(:a) as ac0 \gset
select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Ausbau Werke', 'Maschinen nach Maß', 'tech', '#224466', 'gmbh') -> 'company' as ga \gset
reset role;
select tests.company_of(:a) as aco \gset
select tests.assert(
  :'ga'::jsonb ->> 'tier' = 'gmbh' and (:'ga'::jsonb ->> 'awareness_bps')::int = :aw_gmbh
  and tests.cash(:a) = :ac0::bigint - 6000000 and tests.company_cash(:'aco') = 6000000
  and (select legal_form = 'gmbh' from public.companies where id = :'aco')
  and (:'ga'::jsonb ->> 'max_employees')::int = 20 and (:'ga'::jsonb ->> 'market_factor')::numeric = :mf_gmbh
  and (:'ga'::jsonb ->> 'can_expand')::boolean and (:'ga'::jsonb ->> 'expansion_cost_cents')::bigint = 10000000
  and (:'ga'::jsonb ->> 'expansion_level')::int = 0 and :'ga'::jsonb ->> 'price_level' = 'normal'
  and (:'ga'::jsonb ->> 'contract_work')::boolean,
  'found_company(gmbh): 60 000 EUR into the company, foundingAwareness.gmbh, legal form GmbH, 20 places, marketFactorByTier.gmbh, expandable for 100 000 EUR');

select tests.login_as('authenticated', :b);
select public.found_company(gen_random_uuid(), 'Bodos Garage', 'Apps für Bastler', 'tech', '#446622', 'garage') -> 'company' as gb \gset
reset role;
select tests.company_of(:b) as bco \gset
select tests.assert(
  (:'gb'::jsonb ->> 'awareness_bps')::int = :aw_garage and (:'gb'::jsonb ->> 'market_factor')::numeric = :mf_garage
  and not (:'gb'::jsonb ->> 'can_expand')::boolean and :'gb'::jsonb -> 'expansion_cost_cents' = 'null'::jsonb
  and (:'gb'::jsonb -> 'live') ?& array['contract_revenue_per_hour_cents', 'demand_per_hour_cents', 'capacity_per_hour_cents',
                                        'fixed_per_hour_cents', 'ai_wages_per_hour_cents', 'marketing_per_hour_cents']
  and (:'gb'::jsonb -> 'live' ->> 'contract_revenue_per_hour_cents')::bigint = 0,
  'garage: foundingAwareness.garage, marketFactorByTier.garage, no expansion (cost null), live details 0 before the first hour');

-- the estimate describes the market the company reaches
select tests.assert(
  (:'ga'::jsonb ->> 'estimate_low_cents')::numeric / (select potential_annual_cents from public.player_companies where company_id = :'aco')
    between :mf_gmbh * exp(-2.3) and :mf_gmbh * exp(-2.3 * 0.3)
  and (:'ga'::jsonb ->> 'estimate_high_cents')::numeric / (select potential_annual_cents from public.player_companies where company_id = :'aco')
    between :mf_gmbh * exp(2.3 * 0.3) and :mf_gmbh * exp(2.3),
  'COMPANY estimate: niche x market factor of the legal form');

-- =============================================================================
-- B. One hour: own sales and contract work on the unused capacity
-- =============================================================================
select id as qid, starts_at as qs from public.game_quarters order by ends_at desc limit 1 \gset
-- 1 200 000 a year = 50 000 per operating hour (4 quarters x 6 hours); awareness 50 %, quality 100 % -> demand 25 000 / h
update public.player_companies set potential_annual_cents = round(1200000 / :mf_garage), awareness = 0.5, quality = 1
 where company_id = :'bco';
select tests.company_cash(:'bco') as bc0 \gset
select balance_cents as hh0 from public.ledger_accounts where system_key = 'households' \gset
select public.player_company_close_hour(:'bco', :'qs'::timestamptz + interval '3 hours') is not null as ok \gset
select * from public.player_company_hours where company_id = :'bco' and hour_start = :'qs'::timestamptz + interval '3 hours' \gset h1_
select tests.assert(
  :h1_demand_cents::bigint = 25000 and :h1_capacity_cents::bigint > 25000
  and abs(:h1_contract_revenue_cents::bigint - (:h1_capacity_cents::bigint - 25000) * 0.25) <= 1
  and :h1_contract_revenue_cents::bigint > 0
  and :h1_revenue_cents::bigint = 25000 + :h1_contract_revenue_cents::bigint
  and abs(:h1_cogs_cents::bigint - (25000 * 0.25 + :h1_contract_revenue_cents::bigint * 0.7)) <= 2
  and :h1_fixed_cents::bigint = 2500
  and :h1_profit_cents::bigint = :h1_revenue_cents::bigint - :h1_cogs_cents::bigint - :h1_fixed_cents::bigint
  and tests.company_cash(:'bco') = :bc0::bigint + :h1_profit_cents::bigint
  and (select balance_cents from public.ledger_accounts where system_key = 'households') = :hh0::bigint - :h1_profit_cents::bigint,
  'close_hour(): sells the demand (25 000), 25 % of the free capacity as contract work (gross margin 30 %); paid by the households');

select tests.login_as('authenticated', :b);
select public.get_my_company() -> 'company' as bmc \gset
reset role;
select tests.assert(
  (:'bmc'::jsonb -> 'live' ->> 'contract_revenue_per_hour_cents')::bigint = :h1_contract_revenue_cents::bigint
  and (:'bmc'::jsonb -> 'live' ->> 'demand_per_hour_cents')::bigint = 25000
  and (:'bmc'::jsonb -> 'live' ->> 'capacity_per_hour_cents')::bigint = :h1_capacity_cents::bigint
  and (:'bmc'::jsonb -> 'live' ->> 'fixed_per_hour_cents')::bigint = 2500
  and (:'bmc'::jsonb -> 'live' ->> 'ai_wages_per_hour_cents')::bigint = 0
  and (:'bmc'::jsonb -> 'live' ->> 'marketing_per_hour_cents')::bigint = 0
  and (:'bmc'::jsonb -> 'hours' -> -1 ->> 'contract_revenue_cents')::bigint = :h1_contract_revenue_cents::bigint,
  'COMPANY.live: details of the last closed hour; hours[] carry contract_revenue_cents');

-- =============================================================================
-- C. Price strategy and contract work switch
-- =============================================================================
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.set_company_strategy(gen_random_uuid(), 'luxus', true)$$, 'invalid_argument',
  'set_company_strategy(): only budget, normal or premium');
select public.set_company_strategy(:rq, 'budget', false) -> 'company' as s1 \gset
select public.set_company_strategy(:rq, 'budget', false) -> 'company' as s1b \gset
reset role;
select tests.assert(
  :'s1'::jsonb ->> 'price_level' = 'budget' and not (:'s1'::jsonb ->> 'contract_work')::boolean
  and :'s1'::jsonb = :'s1b'::jsonb,
  'set_company_strategy(): stores price level and contract work, {company} like set_company_marketing; idempotent');

select public.player_company_close_hour(:'bco', :'qs'::timestamptz + interval '4 hours') is not null as ok \gset
select * from public.player_company_hours where company_id = :'bco' and hour_start = :'qs'::timestamptz + interval '4 hours' \gset h2_
select tests.assert(
  :h2_demand_cents::bigint = 33750 and :h2_contract_revenue_cents::bigint = 0
  and abs(:h2_revenue_cents::bigint - least(33750, :h2_capacity_cents::bigint) * 0.8) <= 1,
  'budget: demand x 1.35 at price x 0.8; contract work off: no contract revenue');

select tests.login_as('authenticated', :b);
select public.set_company_strategy(gen_random_uuid(), 'premium', false) is not null as ok \gset
reset role;
select public.player_company_close_hour(:'bco', :'qs'::timestamptz + interval '5 hours') is not null as ok \gset
select * from public.player_company_hours where company_id = :'bco' and hour_start = :'qs'::timestamptz + interval '5 hours' \gset h3_
update public.player_companies set quality = 0.4 where company_id = :'bco';
select public.player_company_close_hour(:'bco', :'qs'::timestamptz + interval '6 hours') is not null as ok \gset
select * from public.player_company_hours where company_id = :'bco' and hour_start = :'qs'::timestamptz + interval '6 hours' \gset h4_
select tests.assert(
  :h3_demand_cents::bigint = 18750 and :h3_revenue_cents::bigint = 24375
  and abs(:h4_demand_cents::bigint - 50000 * 0.5 * (0.5 + 0.5 * 0.4) * 0.75 * 0.5) <= 1
  and abs(:h4_revenue_cents::bigint - 50000 * 0.5 * (0.5 + 0.5 * 0.4) * 0.75 * 0.5 * 1.3) <= 1,
  'premium: demand x 0.75 at price x 1.3; below 50 % quality customers stay away (demand halved again)');

-- word of mouth: budget x 1.5, premium x 0.7 (two equal garages, same quarter)
select tests.login_as('authenticated', :d);
select public.found_company(gen_random_uuid(), 'Billig Laden', 'Günstige Kabel', 'tech', '#552211', 'garage') is not null as ok \gset
select public.set_company_strategy(gen_random_uuid(), 'budget', true) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :e);
select public.found_company(gen_random_uuid(), 'Edel Laden', 'Feine Kabel', 'tech', '#112255', 'garage') is not null as ok \gset
select public.set_company_strategy(gen_random_uuid(), 'premium', true) is not null as ok \gset
reset role;
select tests.company_of(:d) as dco \gset
select tests.company_of(:e) as eco \gset
update public.player_companies set awareness = 0.3, quality = 0.5 where company_id in (:'dco', :'eco');
select public.player_company_close_quarter(:'dco', :qid) is not null and public.player_company_close_quarter(:'eco', :qid) is not null as ok \gset
select (select awareness from public.player_companies where company_id = :'dco') as awd,
       (select awareness from public.player_companies where company_id = :'eco') as awe,
       (select quality from public.player_companies where company_id = :'dco') as qd,
       (select quality from public.player_companies where company_id = :'eco') as qe \gset
select tests.assert(
  :qd::float8 = :qe::float8 and :awd::float8 > :awe::float8
  and abs((:awd::float8 - :awe::float8) - 0.3 * (1.5 - 0.7) * 0.3 * 0.7 * (0.5 + :qd::float8)) < 1e-9,
  'quarter close: word of mouth x pricing.awareness (budget 1.5, premium 0.7)');

-- =============================================================================
-- D. Expansion levels from the company cash (GmbH and AG only)
-- =============================================================================
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.expand_company(gen_random_uuid())$$, 'company_upgrade_unavailable',
  'expand_company(): not for a garage (expansion.fromTiers)');
reset role;
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.expand_company(gen_random_uuid())$$, 'insufficient_funds',
  'expand_company(): paid from the company cash (60 000 EUR < 100 000 EUR)');
reset role;
select public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(:'aco'), 30000000, 'transfer',
  'Test-Kapital', 'company', :'aco', 'test:m4c:aco') is not null as ok \gset
select tests.cash(:a) as ac1 \gset
select tests.company_cash(:'aco') as acc1 \gset
select balance_cents as hh1 from public.ledger_accounts where system_key = 'households' \gset
select tests.login_as('authenticated', :a);
select public.expand_company(:rq) -> 'company' as x1 \gset
select public.expand_company(:rq) -> 'company' as x1b \gset
reset role;
select tests.assert(
  (:'x1'::jsonb ->> 'expansion_level')::int = 1 and :'x1'::jsonb = :'x1b'::jsonb
  and tests.company_cash(:'aco') = :acc1::bigint - 10000000 and tests.cash(:a) = :ac1::bigint
  and (select balance_cents from public.ledger_accounts where system_key = 'households') = :hh1::bigint + 10000000
  and (:'x1'::jsonb ->> 'max_employees')::int = 30 and (select max_employees from public.companies where id = :'aco') = 30
  and (:'x1'::jsonb ->> 'expansion_cost_cents')::bigint = 18000000
  and (:'x1'::jsonb ->> 'market_factor')::numeric = round(:mf_gmbh * 1.5, 4),
  'expand_company(): 100 000 EUR from the company cash to the households, level 1: 30 places, market x1.5, next level 180 000 EUR; idempotent');

select tests.login_as('authenticated', :a);
select public.expand_company(gen_random_uuid()) -> 'company' as x2 \gset
reset role;
select tests.assert(
  (:'x2'::jsonb ->> 'expansion_level')::int = 2 and tests.company_cash(:'aco') = :acc1::bigint - 28000000
  and (:'x2'::jsonb ->> 'max_employees')::int = 40 and (:'x2'::jsonb ->> 'expansion_cost_cents')::bigint = 32400000
  and (:'x2'::jsonb ->> 'market_factor')::numeric = round(:mf_gmbh * 2, 4),
  'expand_company(): level 2 for 180 000 EUR (x 1.8 per level): 40 places, market x2, no upper limit');

select tests.login_as('authenticated', :a);
select public.hire_ai_workers(gen_random_uuid(), 40) is not null as ok \gset
select tests.throws_key($$select public.hire_ai_workers(gen_random_uuid(), 1)$$, 'employee_limit',
  'hire_ai_workers(): places = 20 + 10 per expansion level');
select public.set_ai_workers(gen_random_uuid(), 0) is not null as ok \gset
reset role;
select tests.assert((select ai_workers from public.player_companies where company_id = :'aco') = 0,
  'hire_ai_workers(): 40 AI workers fit after two expansion levels');

-- fixed costs and capacity grow with the level
update public.player_companies set potential_annual_cents = 1, awareness = 0.5, quality = 0.5 where company_id = :'aco';
select public.player_company_close_hour(:'aco', :'qs'::timestamptz + interval '3 hours') is not null as ok \gset
select * from public.player_company_hours where company_id = :'aco' and hour_start = :'qs'::timestamptz + interval '3 hours' \gset xa_
select (public.player_company_team(:'aco') ->> 'team_productivity_bps')::bigint as aprod,
       (public.player_company_team(:'aco') ->> 'stage')::int as astage \gset
select tests.assert(
  :xa_fixed_cents::bigint = round(600000 * 1.5 / 6)
  and abs(:xa_capacity_cents::bigint - :aprod::bigint / 10000.0 * 300000 * (1 + 0.25 * :astage) * 1.2 / 6) <= 1,
  'expansion: fixed costs + 25 % and capacity + 10 % per level');

-- =============================================================================
-- E. IPO from the garage at level 9 (startups.ipo, ADR-099)
-- =============================================================================
select tests.login_as('authenticated', :c);
select public.found_company(gen_random_uuid(), 'Cleos Garage', 'Kleine Roboter', 'tech', '#663311', 'garage') -> 'company' as gc \gset
select tests.throws_key($$select public.go_public(gen_random_uuid(), 20)$$, 'company_level_too_low',
  'go_public(): from startups.ipo.minLevel (9)');
reset role;
select tests.login_as('authenticated', :b);
select public.get_my_company() -> 'company' as bmc2 \gset
select public.go_public(gen_random_uuid(), 20) -> 'company' as bipo \gset
reset role;
select tests.assert(
  not (:'gc'::jsonb ->> 'can_go_public')::boolean and (:'bmc2'::jsonb ->> 'can_go_public')::boolean
  and (select phase = 'ipo' from public.companies where id = :'bco'),
  'go_public(): a garage may go public from level 9 (fromTiers incl. garage)');

select tests.set_cfg('startups', '{demandNoise}', :'noise0'::jsonb);
