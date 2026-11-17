-- =============================================================================
-- b5 · Company reports of the owner (ADR-176): strategy and CEO payout of a listed company read back, the hourly
-- close of a listed company (hours, reputation history), the strengths with their bonus, a stuck close in plain sight
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
-- ADR-183: the reputation moves the demand of every company; the exact numbers here assume it stays neutral
select tests.set_cfg('companyHealth', '{reputation,demandMaxEffect}', '0') is null as rep_neutral \gset

\set f '''0b5c5c5c-0000-4000-8000-0000000000f1'''
\set a '''0b5c5c5c-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:f, 'Bea_Bugfix') is not null and tests.signup(:a, 'Abe_Aktie') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 12);
select tests.set_level(:a, 12);
select tests.fund(:f, 5000000, 'test:b5:f');
select tests.fund(:a, 900000000, 'test:b5:a');
select coalesce(value -> 'demandNoise', '0.1') as noise0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{demandNoise}', '0');

-- a listed company: Abe subscribes 25 %
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Bugfix Werk', 'Alles repariert', 'tech', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.company_of(:f) as co \gset
select price_cents as iprice from public.company_share_offers where id = :'offer' \gset
select tests.login_as('authenticated', :a);
select public.subscribe_offer(gen_random_uuid(), :'offer', 250000 * :iprice) is not null as ok \gset
reset role;
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
update public.player_companies set potential_annual_cents = 30000000, awareness = 0.6, quality = 0.6 where company_id = :'co';
select tests.assert(public.listed_is(:'co'), 'b5: the company is listed');

-- =============================================================================
-- A. Strategy and CEO payout: exactly the arguments the live client sends (api-company.ts), read back by
--    get_my_company as the company page does
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.set_company_strategy(gen_random_uuid(), 'premium', true) -> 'company' ->> 'price_level' as ret_price \gset
select public.set_founder_payout(gen_random_uuid(), 1500) -> 'company' ->> 'founder_payout_bps' as ret_bps \gset
select tests.assert(
  :'ret_price' = 'premium' and public.get_my_company() #>> '{company,price_level}' = 'premium'
  and :'ret_bps' = '1500' and (public.get_my_company() #>> '{company,founder_payout_bps}')::int = 1500,
  'b5: price strategy and CEO payout of a listed company are stored and read back by get_my_company');
reset role;

-- =============================================================================
-- B. The hourly close of a listed company: hours for the dashboard and the staff tab, the reputation history
-- =============================================================================
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) - interval '4 hours' where company_id = :'co';
update public.companies set founded_at = date_trunc('hour', public.game_now()) - interval '4 hours' where id = :'co';
-- an investment counts as reinvestment for the reputation target
select tests.login_as('authenticated', :f);
reset role;
select tests.fund(:f, 2000000, 'test:b5:f2');
select tests.login_as('authenticated', :f);
select public.company_deposit(gen_random_uuid(), 1500000) is not null as ok \gset
select public.company_invest(gen_random_uuid(), 'r_sustainability_1') is not null as ok \gset
reset role;
create temporary table b5_q as
  select gq.id, gq.status from public.game_quarters gq
   where gq.ends_at > date_trunc('hour', public.game_now()) - interval '4 hours' and gq.ends_at <= public.game_now();
select public.player_companies_run_due() as due \gset
select tests.login_as('authenticated', :f);
select public.get_my_company() -> 'company' as c1 \gset
select public.get_listed_company() -> 'listed' as l1 \gset
reset role;
select tests.assert(
  jsonb_array_length(:'c1'::jsonb -> 'hours') = 4 and (:'c1'::jsonb #>> '{live,revenue_per_hour_cents}')::bigint > 0
  and not exists (select 1 from public.job_runs j where j.job_name = 'company_hours' and j.run_key = :'co'),
  'b5: the hourly close of a listed company writes four hours that get_my_company returns (Verlauf, bringt X €)');
select tests.assert(
  jsonb_array_length(:'l1'::jsonb -> 'history') >= 4
  and (select max(h.reputation) from public.listed_company_hours h where h.company_id = :'co') > 50,
  'b5: the reputation moves with the closed hours and its history fills the chart');

-- =============================================================================
-- C. Strengths (ADR-176): the same step as src/lib/sim/company-strengths.test.ts, a slow climb, the bonus
-- =============================================================================
select public.company_strengths_step(
  '{"awareness": 40, "quality": 60, "delivery": 50, "margin": 10, "team": 100, "finance": 80}',
  '{"awareness": 90, "quality": 20, "delivery": 50, "margin": 100, "team": 100, "finance": 0}') as st \gset
select tests.assert(
  abs((:'st'::jsonb ->> 'awareness')::float8 - 41) < 1e-9 and abs((:'st'::jsonb ->> 'quality')::float8 - 58) < 1e-9
  and abs((:'st'::jsonb ->> 'margin')::float8 - 11.8) < 1e-9 and abs((:'st'::jsonb ->> 'finance')::float8 - 76) < 1e-9
  and public.company_strengths_reward_bps('{"awareness": 50, "quality": 50, "delivery": 50, "margin": 50, "team": 50, "finance": 50}') = 200
  and public.company_strengths_reward_bps('{"awareness": 100, "quality": 100, "delivery": 100, "margin": 100, "team": 100, "finance": 100}') = 1500
  and public.company_strengths_reward_bps('{"awareness": 49.9, "quality": 50, "delivery": 50, "margin": 50, "team": 50, "finance": 50}') = 0,
  'b5: strengths step and reward tiers as in TypeScript');
select tests.assert(
  (:'c1'::jsonb #>> '{strengths,hours}')::int = 4 and (:'c1'::jsonb #>> '{strengths,overall}')::float8 < 10
  and (:'c1'::jsonb #>> '{strengths,reward_bps}')::int = 0,
  'b5: four hours move the strengths only a few points (100 takes days)');
update public.company_strengths set scores = '{"awareness": 90, "quality": 90, "delivery": 90, "margin": 90, "team": 90, "finance": 90}'
 where company_id = :'co';
select public.player_company_close_hour(:'co', date_trunc('hour', public.game_now())) as h5 \gset
select tests.assert(
  (select h.strength_bonus_cents = floor((h.revenue_cents - h.strength_bonus_cents) * 1000 / 10000.0) and h.strength_bonus_cents > 0
     from public.player_company_hours h where h.company_id = :'co' and h.hour_start = date_trunc('hour', public.game_now())),
  'b5: an overall score of 90 pays 10 % of the hour''s revenue on top');

-- =============================================================================
-- D. A failing close is visible on the company page
-- =============================================================================
insert into public.job_runs (job_name, run_key, status, finished_at, error, details)
values ('company_hours', :'co', 'failed', now(), 'XX000: b5 test', '{"failures": 3}');
select tests.login_as('authenticated', :f);
select tests.assert(
  public.get_my_company() #>> '{company,strengths,close_error,error}' = 'XX000: b5 test'
  and (public.get_my_company() #>> '{company,strengths,close_error,failures}')::int = 3,
  'b5: get_my_company names a stuck hourly close');
reset role;
delete from public.job_runs where job_name = 'company_hours' and run_key = :'co';
select tests.set_cfg('startups', '{demandNoise}', :'noise0');
