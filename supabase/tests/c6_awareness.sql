-- =============================================================================
-- c6 · Awareness, one model (ADR-188): marketing lifts a garage noticeably within a few closed hours, tasks and
--      campaigns jump at once, decay works, the cap is shown and respected, every change is in the ledger, and the
--      strength "Bekanntheit" agrees with awareness / cap.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
select tests.set_cfg('companyHealth', '{reputation,demandMaxEffect}', '0') is null as rep_neutral \gset
select value -> 'awareness' as aw_cfg0, coalesce(value -> 'demandNoise', '0.1') as noise0
  from public.game_config where key = 'startups' \gset
-- the model of src/config/balance.ts, whatever earlier files left behind
select tests.set_cfg('startups', '{awareness}',
  '{"initial": 0.03, "min": 0.02, "cap": {"byTier": {"garage": 0.6, "small_business": 0.7, "gmbh": 0.8, "ag": 0.9},
    "perStage": 0.05, "perExpansionLevel": 0.03, "max": 1}, "marketingMaxRatePerHour": 0.06,
    "marketingHalfSaturationShare": 0.01, "marketingMinHalfSaturationCents": 50000, "wordOfMouthPerHour": 0.008,
    "decayPerHour": 0.004, "taskGain": 0.005, "taskAiShareBps": 5000}') is null as ok \gset
select tests.set_cfg('startups', '{demandNoise}', '0') is null as ok \gset

-- ---------------------------------------------------------------------------
-- 1. Rules: the same numbers as src/lib/sim/awareness.test.ts
-- ---------------------------------------------------------------------------
select tests.assert(tests.near((public.company_awareness_step(0.2, 0.6, 0.5, 1.5, 10000, 1e7, 0.8, 70) ->> 'next')::double precision,
                               0.21390690909090912)
                and tests.near((public.company_awareness_step(0.2, 0.6, 0.5, 1.5, 10000, 1e7, 0.8, 70) ->> 'word_of_mouth')::double precision,
                               0.001536)
                and tests.near(public.company_awareness_cap('garage', 0, 0), 0.6)
                and tests.near(public.company_awareness_cap('gmbh', 2, 3), 0.99)
                and public.company_awareness_cap('ag', 2, 3) = 1,
  'company_awareness_step() and company_awareness_cap(): same results as awarenessHour and awarenessCap (TS)');
select tests.assert((public.company_awareness_step(0.7, 0.6, 1, 1, 1e9, 1e7, 1, 50) ->> 'marketing')::double precision = 0
                and (public.company_awareness_step(0.7, 0.6, 1, 1, 1e9, 1e7, 1, 50) ->> 'next')::double precision < 0.7
                and (public.company_awareness_step(0.0, 0.6, 0, 1, 0, 1e7, 1, 50) ->> 'next')::double precision = 0.02,
  'company_awareness_step(): above the cap only decay, never below the floor');

-- ---------------------------------------------------------------------------
-- 2. Three garages: A with normal marketing, B without, C well known without marketing
-- ---------------------------------------------------------------------------
\set a '''0c6c0c6c-0000-4000-8000-0000000006a1'''
\set b '''0c6c0c6c-0000-4000-8000-0000000006b2'''
\set c '''0c6c0c6c-0000-4000-8000-0000000006c3'''
select tests.signup(:a, 'Aw6_Laut') is not null and tests.signup(:b, 'Aw6_Still') is not null
   and tests.signup(:c, 'Aw6_Alt') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 20);
select tests.set_level(:b, 20);
select tests.set_level(:c, 20);
select tests.fund(:a, 90000000, 'test:c6:a');
select tests.fund(:b, 90000000, 'test:c6:b');
select tests.fund(:c, 90000000, 'test:c6:c');
select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Laut Sechs', 'Werbung wirkt', 'tech', '#224466', 'garage') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.found_company(gen_random_uuid(), 'Still Sechs', 'Ohne Werbung', 'tech', '#446622', 'garage') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select public.found_company(gen_random_uuid(), 'Alt Sechs', 'Bekannt', 'tech', '#664422', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:a) as aco \gset
select tests.company_of(:b) as bco \gset
select tests.company_of(:c) as cco \gset
select tests.set_company_cash(:'aco', 5000000);
select tests.set_company_cash(:'bco', 5000000);
select tests.set_company_cash(:'cco', 5000000);
-- the half-saturation budget of this market: max(500 €, 30 000 € x garage market factor / 4 x 1 %)
update public.player_companies set potential_annual_cents = 3000000, quality = 0.5 where company_id in (:'aco', :'bco', :'cco');
update public.player_companies set awareness = 0.5 where company_id = :'cco';
select greatest(50000, round(3000000 * public.company_market_factor('garage', 0) / 4.0 * 0.01))::bigint as normal \gset
select tests.login_as('authenticated', :a);
select public.set_company_marketing(gen_random_uuid(), :normal) is not null as ok \gset
select public.get_company_awareness() as j0 \gset
reset role;
select tests.assert(tests.near((:'j0'::jsonb ->> 'awareness')::double precision, 0.03)
                and tests.near((:'j0'::jsonb ->> 'cap')::double precision, 0.6)
                and tests.near((:'j0'::jsonb ->> 'tier_cap')::double precision, 0.6)
                and (:'j0'::jsonb ->> 'tier') = 'garage' and (:'j0'::jsonb -> 'last_hour') = 'null'::jsonb,
  'get_company_awareness(): a new garage starts at 3 % with a visible cap of 60 %');

-- six closed hours
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) - interval '6 hours'
 where company_id in (:'aco', :'bco', :'cco');
update public.companies set founded_at = date_trunc('hour', public.game_now()) - interval '6 hours'
 where id in (:'aco', :'bco', :'cco');
select public.player_companies_run_due() is not null as ok \gset
select (select awareness from public.player_companies where company_id = :'aco') as awa,
       (select awareness from public.player_companies where company_id = :'bco') as awb,
       (select awareness from public.player_companies where company_id = :'cco') as awc \gset
select tests.assert((select count(*) from public.player_company_hours where company_id = :'aco') = 6,
  'run_due(): six hours closed');
select tests.assert(:awa::float8 > 0.10 and :awa::float8 < 0.2,
  'normal marketing: a garage climbs from 3 % to over 10 % in six closed hours (harness: 12,7 %)');
select tests.assert(:awb::float8 < 0.04 and :awb::float8 > 0.02,
  'without marketing a new garage barely moves (word of mouth only)');
select tests.assert(:awc::float8 < 0.5, 'decay: a known company without marketing loses awareness slowly');
select tests.assert(
  tests.near((select sum(delta) from public.company_awareness_log where company_id = :'aco'), :awa::float8 - 0.03)
  and (select sum(delta) from public.company_awareness_log where company_id = :'aco' and source = 'marketing') > 0.07
  and (select sum(delta) from public.company_awareness_log where company_id = :'cco' and source = 'decay') < 0,
  'ledger: every change is booked by source and the bookings add up to the value');
select tests.assert((select bool_and(tests.near((awareness_parts ->> 'cap')::double precision, 0.6)
                                     and awareness_parts ? 'sources' and awareness_after >= awareness_before)
                       from public.player_company_hours where company_id = :'aco'),
  'hour rows: awareness_parts carry the cap and the sources of the hour');

-- strength and value agree
select (select (scores ->> 'awareness')::double precision from public.company_strengths where company_id = :'aco') as sta \gset
select tests.assert(:sta::float8 > 0.5 * 100 * :awa::float8 / 0.6 and :sta::float8 <= 100 * :awa::float8 / 0.6 + 1e-9,
  'strength "Bekanntheit" follows awareness / cap within hours (before: 2 % of the gap per hour)');
select tests.login_as('authenticated', :a);
select public.get_company_awareness() as j1 \gset
select public.get_my_company() #>> '{company,awareness_bps}' as mybps \gset
reset role;
select tests.assert(tests.near((:'j1'::jsonb ->> 'strength')::double precision, :sta::float8)
                and tests.near((:'j1'::jsonb ->> 'awareness')::double precision, :awa::float8)
                and (:'j1'::jsonb -> 'last_hour' -> 'parts' ->> 'marketing')::double precision > 0
                and jsonb_array_length(:'j1'::jsonb -> 'history') = 6,
  'get_company_awareness(): value, strength, last hour by source and history from the same field');
-- dashboard and controlling both show get_my_company().awareness_bps against company_awareness_cap (awarenessView)
select tests.assert(:mybps::int = round((:'j1'::jsonb ->> 'awareness')::numeric * 10000)::int
                and tests.near((:'j1'::jsonb ->> 'cap')::double precision,
                               public.company_awareness_cap('garage', (:'j1'::jsonb ->> 'stage')::int, 0)),
  'one value: get_my_company and get_company_awareness send the same awareness and cap');

-- ---------------------------------------------------------------------------
-- 3. Jumps: a task, a campaign; the cap; the floor
-- ---------------------------------------------------------------------------
select public.company_awareness_boost(:'aco', 0.005) as boost \gset
select tests.assert(tests.near(:boost::float8, 0.005)
                and tests.near((select awareness from public.player_companies where company_id = :'aco'), :awa::float8 + 0.005),
  'a solved task adds its 0,5 points at once');
select tests.login_as('authenticated', :a);
select public.start_campaign(gen_random_uuid(), :'aco', 'flyer') is not null as ok \gset
select public.get_company_awareness() as j2 \gset
reset role;
select tests.assert(tests.near((select awareness from public.player_companies where company_id = :'aco'), :awa::float8 + 0.035)
                and tests.near((:'j2'::jsonb -> 'since' ->> 'campaign')::double precision, 0.03)
                and tests.near((:'j2'::jsonb -> 'since' ->> 'tasks')::double precision, 0.005),
  'a flyer adds its 3 points at once; both show in "since the last hour"');
update public.player_companies set awareness = 0.59 where company_id = :'aco';
select public.company_awareness_add(:'aco', 'moves', 0.1) as mv1 \gset
select public.company_awareness_add(:'aco', 'moves', 0.1) as mv2 \gset
select tests.assert(tests.near(:mv1::float8, 0.01) and :mv2::float8 = 0
                and tests.near((select awareness from public.player_companies where company_id = :'aco'), 0.6),
  'company_awareness_add(): a gain stops at the cap of 60 %');
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) - interval '1 hour'
 where company_id = :'aco';
select tests.login_as('authenticated', :a);
select public.set_company_marketing(gen_random_uuid(), 100 * :normal) is not null as ok \gset
reset role;
select public.player_companies_run_due() is not null as ok \gset
select tests.assert((select awareness from public.player_companies where company_id = :'aco') <= 0.6 + 1e-12,
  'the hourly close respects the cap, however much marketing');
select public.company_awareness_add(:'bco', 'protest', -1) as pr \gset
select tests.assert(tests.near(:pr::float8, 0.02 - :awb::float8)
                and tests.near((select awareness from public.player_companies where company_id = :'bco'), 0.02),
  'company_awareness_add(): a loss stops at the floor of 2 %');

select tests.set_cfg('startups', '{awareness}', :'aw_cfg0'::jsonb) is null as ok \gset
select tests.set_cfg('startups', '{demandNoise}', :'noise0'::jsonb) is null as ok \gset
\echo c6 awareness ok
