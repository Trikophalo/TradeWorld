-- =============================================================================
-- a8 · Company awareness end to end: the quarter close moves awareness by word of mouth and marketing, the report and
--      get_my_company carry it as basis points (1 = 10 000), and the founding value is the tier's start value.
--      Regression for "Bekanntheit steht immer bei 0 % oder 1 %" (could not be reproduced: see ADR-167 notes).
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
-- ADR-183: the reputation moves the demand of every company; the exact numbers here assume it stays neutral
select tests.set_cfg('companyHealth', '{reputation,demandMaxEffect}', '0') is null as rep_neutral \gset

\set a '''0a8c0a8c-0000-4000-8000-0000000008a1'''
\set b '''0a8c0a8c-0000-4000-8000-0000000008b2'''
select tests.signup(:a, 'Aw_Werbung') is not null and tests.signup(:b, 'Aw_Still') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 20);
select tests.set_level(:b, 20);
select tests.fund(:a, 90000000, 'test:a8:a');
select tests.fund(:b, 90000000, 'test:a8:b');
select coalesce(value -> 'demandNoise', '0.1') as noise0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{demandNoise}', '0');
-- ADR-188: the awareness model of src/config/balance.ts, whatever earlier files left behind
select coalesce(value -> 'awareness', 'null') as aw_cfg0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{awareness}',
  '{"initial": 0.03, "min": 0.02, "cap": {"byTier": {"garage": 0.6, "small_business": 0.7, "gmbh": 0.8, "ag": 0.9},
    "perStage": 0.05, "perExpansionLevel": 0.03, "max": 1}, "marketingMaxRatePerHour": 0.06,
    "marketingHalfSaturationShare": 0.01, "marketingMinHalfSaturationCents": 50000, "wordOfMouthPerHour": 0.008,
    "decayPerHour": 0.004, "taskGain": 0.005, "taskAiShareBps": 5000}') is null as ok \gset

select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Laut Werke', 'Werbung wirkt', 'tech', '#224466', 'garage') -> 'company' as fa \gset
select public.set_company_marketing(gen_random_uuid(), 500000) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.found_company(gen_random_uuid(), 'Still Werke', 'Ohne Werbung', 'tech', '#446622', 'garage') -> 'company' as fb \gset
reset role;
select tests.assert((:'fa'::jsonb ->> 'awareness_bps')::int = 300 and (:'fb'::jsonb ->> 'awareness_bps')::int = 300,
  'found_company(): a garage starts with 3 % awareness, sent as 300 bps');

select tests.company_of(:a) as aco \gset
select tests.company_of(:b) as bco \gset
-- the same niche for both: the founding draws it from a Pareto tail, and a heavy-tail draw raises the marketing
-- half-saturation (potential share) and leaves the garage sold out, so in some runs marketing barely moved awareness
update public.player_companies set potential_annual_cents = 3000000 where company_id in (:'aco', :'bco');
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) - interval '30 hours'
 where company_id in (:'aco', :'bco');
update public.companies set founded_at = date_trunc('hour', public.game_now()) - interval '30 hours'
 where id in (:'aco', :'bco');
select count(*)::int as nq from public.game_quarters gq
 where gq.ends_at > date_trunc('hour', public.game_now()) - interval '30 hours' and gq.ends_at <= public.game_now() \gset
select public.player_companies_run_due() is not null as ok \gset

select (select awareness from public.player_companies where company_id = :'aco') as awa,
       (select awareness from public.player_companies where company_id = :'bco') as awb \gset
-- (a fresh database has no quarter that ended in the last 30 hours at every time of day; then there is nothing to
--  close and the checks below hold trivially, ADR-176: before, verify_local.sh and the deploy failed by the clock)
select tests.assert((select count(*) from public.player_company_reports where company_id = :'aco') = :nq,
  'player_companies_run_due(): every finished quarter of the company has a report');
select tests.assert(:nq = 0 or :awa > 0.03 + least(0.03 * :nq, 0.15) and :awb >= 0.02 and :awb < :awa,
  'quarter close: marketing lifts awareness by several points per quarter, word of mouth alone a little');
select tests.assert(:nq = 0 or
  (select awareness_bps from public.player_company_reports where company_id = :'aco' order by game_quarter_id desc limit 1)
    between 300 and round(:awa * 10000)::int,
  'report: awareness_bps is the awareness at the quarter close in basis points (ADR-180/188: it moves every hour)');
select tests.login_as('authenticated', :a);
select tests.assert((public.get_my_company() #>> '{company,awareness_bps}')::int = round(:awa * 10000)::int,
  'get_my_company(): awareness_bps = awareness x 10 000 (the client divides by 10 000)');
reset role;

select tests.set_cfg('startups', '{demandNoise}', :'noise0'::jsonb);
select tests.set_cfg('startups', '{awareness}', :'aw_cfg0'::jsonb) is null as ok \gset
