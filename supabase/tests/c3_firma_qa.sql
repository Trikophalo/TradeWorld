-- =============================================================================
-- c3 · Firma QA (ADR-183): reputation for every company (private and listed, same rules as
--      src/lib/sim/company-reputation.ts), interviews move it, a failing extra step of the hourly close no longer
--      costs the hour (and shows on the page), the page data for "Was jeder leistet", going public keeps the reputation
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
-- earlier files keep the reputation neutral for their exact numbers; here it works as configured
select tests.set_cfg('companyHealth', '{reputation,demandMaxEffect}', '0.2') is null as rep_on \gset

-- ---------------------------------------------------------------------------
-- 1. Pure rules: the same numbers as company-reputation.test.ts
-- ---------------------------------------------------------------------------
select tests.assert(
  public.company_reputation_target(public.company_reputation_drivers(0.4, 10000, 12000, 'normal', 10000, 0, 0, false)) = 50,
  'c3: an average, calm hour is neutral (target 50)');
select tests.assert(
  tests.near(public.company_reputation_target(public.company_reputation_drivers(1, 10000, 12000, 'budget', 10000, 0, 0, true)),
             50 + 10 + 2 + 3),
  'c3: quality, fair prices and a campaign lift the target (TS: base + qualityMax + budgetGain + campaignGain)');
select tests.assert(
  tests.near((public.company_reputation_drivers(0, 10000, 5000, 'normal', 5000, 1, 2, false) ->> 'delivery')::double precision, -4)
  and tests.near((public.company_reputation_drivers(0, 10000, 5000, 'normal', 5000, 1, 2, false) ->> 'wages')::double precision, -5)
  and (public.company_reputation_drivers(0, 10000, 5000, 'normal', 5000, 1, 2, false) ->> 'bills')::double precision = -6
  and (public.company_reputation_drivers(0, 10000, 5000, 'normal', 5000, 1, 2, false) ->> 'crisis')::double precision = -6
  and (public.company_reputation_drivers(0.4, 1, 1, 'premium', 10000, 0, 0, false) ->> 'price')::double precision = -6,
  'c3: sold out, unpaid wages, bills, a crisis and premium without quality press the target');
select tests.assert(public.company_reputation_target('{"quality": 200}'::jsonb, 90) = 100
                and public.company_reputation_target('{"quality": -200}'::jsonb, 10) = 0
                and tests.near(public.company_reputation_demand_factor(100), 1.2)
                and tests.near(public.company_reputation_demand_factor(0), 0.8),
  'c3: the target is clamped 0..100, the demand moves at most ±20 %');

-- ---------------------------------------------------------------------------
-- 2. A private company: the reputation moves every hour, the drivers are stored, it moves the demand
-- ---------------------------------------------------------------------------
\set p '''0c3c3c3c-0000-4000-8000-0000000000a1'''
\set i '''0c3c3c3c-0000-4000-8000-0000000000b2'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:p, 'Qa_Privat') is not null and tests.signup(:i, 'Qa_Investor') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:p, 20);
select tests.set_level(:i, 20);
select tests.fund(:p, 90000000, 'test:c3:p');
select tests.fund(:i, 900000000, 'test:c3:i');
select coalesce(value -> 'demandNoise', '0.1') as noise0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{demandNoise}', '0');
select tests.login_as('authenticated', :p);
select public.found_company(gen_random_uuid(), 'Ruf Handel', 'Gute Ware', 'retail', '#224466', 'small_business') is not null as ok \gset
reset role;
select tests.company_of(:p) as co \gset
select tests.set_company_cash(:'co', 5000000);
select tests.login_as('authenticated', :p);
select public.hire_ai_workers(gen_random_uuid(), 3) is not null as ok \gset
-- the arguments the client sends (api-company.ts)
select public.set_company_strategy(gen_random_uuid(), 'budget', false) is not null as ok \gset
reset role;
update public.player_companies set potential_annual_cents = 50000000, awareness = 0.3, quality = 0.9, reputation = 50
 where company_id = :'co';
select date_trunc('hour', public.game_now()) - interval '3 hours' as h0 \gset
update public.player_companies set last_hour_at = :'h0' where company_id = :'co';
select public.player_company_close_hour(:'co', :'h0') is not null as ok \gset
select public.player_company_close_hour(:'co', :'h0'::timestamptz + interval '1 hour') is not null as ok \gset
select public.player_company_close_hour(:'co', :'h0'::timestamptz + interval '2 hours') is not null as ok \gset
select tests.assert(
  (select count(*) from public.player_company_hours h where h.company_id = :'co' and h.reputation is not null
      and h.reputation_target is not null and h.reputation_drivers ? 'quality') = 3
  and (select reputation from public.player_companies where company_id = :'co') > 50
  and (select (reputation_drivers ->> 'price')::double precision from public.player_company_hours
        where company_id = :'co' order by hour_start desc limit 1) = 2,
  'c3: a private company with good quality and fair prices gains reputation every closed hour, drivers stored');
update public.player_companies set reputation = 80 where company_id = :'co';
select tests.assert(tests.near((public.listed_hour_effect(:'co', now()) ->> 'demand_factor')::double precision, 1.12)
                and (public.listed_hour_effect(:'co', now()) ->> 'listed')::boolean = false,
  'c3: the reputation of a private company moves its demand (80 → +12 %)');

-- the page: reputation, history and the hour data for "Was jeder leistet"
select tests.login_as('authenticated', :p);
select public.get_my_company() -> 'company' as c1 \gset
reset role;
select tests.assert(
  (:'c1'::jsonb #>> '{reputation,value}')::double precision = 80
  and jsonb_array_length(:'c1'::jsonb #> '{reputation,history}') = 3
  and :'c1'::jsonb #> '{reputation,drivers}' ? 'campaign'
  and jsonb_typeof(:'c1'::jsonb -> 'close_warnings') = 'array'
  and (:'c1'::jsonb #>> '{hours,0,capacity_cents}')::bigint > 0
  and (:'c1'::jsonb #>> '{hours,0,demand_cents}')::bigint > 0
  and :'c1'::jsonb #> '{hours,0}' ? 'ai_utilization_bps'
  and :'c1'::jsonb #> '{hours,0}' ? 'ai_wages_paid_cents'
  and :'c1'::jsonb #> '{hours,0}' ? 'player_wages_paid_cents',
  'c3: get_my_company carries the reputation and what every hour used ("Was jeder leistet" splits by it)');

-- ---------------------------------------------------------------------------
-- 3. Interviews move the reputation of a private company too
-- ---------------------------------------------------------------------------
select public.company_interview_request(:'co', now()) as iv \gset
select tests.assert(:'iv' <> '', 'c3: an interview request for the private company');
select public.company_interview_finish(:'iv'::bigint, 'declined', null, null, now());
select tests.assert(
  (select reputation from public.player_companies where company_id = :'co') < 80
  and (select reputation_delta from public.company_interviews where id = :'iv'::bigint) < 0,
  'c3: declining an interview costs a private company reputation (before: only listed ones)');

-- ---------------------------------------------------------------------------
-- 4. A failing extra step never costs the hour again; it is shown on the page and cleared by the next good hour
-- ---------------------------------------------------------------------------
select pg_get_functiondef('public.company_reputation_drivers_of(uuid, timestamptz, double precision, double precision, integer)'::regprocedure) as rep_def \gset
create or replace function public.company_reputation_drivers_of(p_company uuid, p_hour_start timestamptz,
  p_demand double precision, p_capacity double precision, p_pay_factor_bps integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  raise exception 'c3 test: broken reputation step';
end;
$$;
set client_min_messages = error;
select date_trunc('hour', public.game_now()) as h3 \gset
update public.player_companies set last_hour_at = :'h3' where company_id = :'co';
select public.player_company_close_hour(:'co', :'h3') is not null as ok \gset
select tests.assert(
  exists (select 1 from public.player_company_hours h where h.company_id = :'co' and h.hour_start = :'h3')
  and jsonb_array_length(public.company_close_warnings_json(:'co')) = 1
  and public.company_close_warnings_json(:'co') #>> '{0,step}' = 'reputation',
  'c3: an error in an extra step is logged as a warning; the hour itself is recorded');
\o /dev/null
select :'rep_def' \gexec
\o
select public.player_company_close_hour(:'co', :'h3'::timestamptz + interval '1 hour') is not null as ok \gset
select tests.assert(jsonb_array_length(public.company_close_warnings_json(:'co')) = 0,
  'c3: the next good hour clears the warning');
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- 5. Going public keeps the reputation; listed hours add the operational drivers and mirror the value
-- ---------------------------------------------------------------------------
update public.player_companies set reputation = 64 where company_id = :'co';
select tests.login_as('authenticated', :p);
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select price_cents as iprice from public.company_share_offers where id = :'offer' \gset
select tests.login_as('authenticated', :i);
select public.subscribe_offer(gen_random_uuid(), :'offer', 250000 * :iprice) is not null as ok \gset
reset role;
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select tests.assert(public.listed_is(:'co'), 'c3: the company went public');
select (public.listed_ensure(:'co')).reputation as lrep \gset
select tests.assert(tests.near(:'lrep'::double precision, 64),
  'c3: a company going public keeps the reputation it earned as a private company (before: back to 50)');
select date_trunc('hour', public.game_now()) + interval '2 hours' as h4 \gset
update public.player_companies set last_hour_at = :'h4' where company_id = :'co';
select public.player_company_close_hour(:'co', :'h4') is not null as ok \gset
select tests.assert(
  (select h.drivers -> 'reputation' ? 'quality' and h.drivers -> 'reputation' ? 'greed'
     from public.listed_company_hours h where h.company_id = :'co' and h.hour_start = :'h4')
  and tests.near((select reputation from public.player_companies where company_id = :'co'),
                 (select reputation from public.listed_companies where company_id = :'co'))
  and (select reputation_drivers ? 'base' from public.player_company_hours where company_id = :'co' and hour_start = :'h4'),
  'c3: a listed hour adds the operational drivers to the shareholder target and mirrors the value');
select public.company_reputation_bump(:'co', -5);
select tests.assert(tests.near((select reputation from public.player_companies where company_id = :'co'),
                               (select reputation from public.listed_companies where company_id = :'co')),
  'c3: one-off changes keep both values equal');

-- ---------------------------------------------------------------------------
-- cleanup
-- ---------------------------------------------------------------------------
select tests.set_cfg('startups', '{demandNoise}', :'noise0');
