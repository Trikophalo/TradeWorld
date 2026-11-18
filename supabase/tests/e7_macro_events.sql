-- =============================================================================
-- e7 · Size, risk and the world outside (ADR-209)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
select tests.money_invariant() = 'ok' as inv0 \gset

\set a '''0e7e7e7e-0000-4000-8000-0000000000a1'''
\set b '''0e7e7e7e-0000-4000-8000-0000000000b1'''
select tests.signup(:a, 'Konzern_Kai') is not null and tests.signup(:b, 'Garagen_Gabi') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(x, 6) from unnest(array[:a, :b]::uuid[]) x;
select tests.fund(x, 1000000, 'test:e7:' || x::text) from unnest(array[:a, :b]::uuid[]) x;

create or replace function tests.e7_found(p_player uuid, p_name text, p_cash bigint) returns uuid language plpgsql as $$
declare
  v_co uuid;
begin
  perform tests.login_as('authenticated', p_player);
  perform public.found_company(gen_random_uuid(), p_name, 'Alles für alle', 'tech', '#335577', 'garage');
  reset role;
  v_co := tests.company_of(p_player);
  perform public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(v_co), p_cash,
                                 'transfer', 'Test-Kapital', 'company', v_co, 'test:e7:cash:' || v_co::text);
  update public.companies set founded_at = now() - interval '10 days' where id = v_co;
  update public.player_companies set ai_workers = 3 where company_id = v_co;
  return v_co;
end;
$$;
-- starts an event, chooses the strongest strategy and lets every step succeed; returns the final status
create or replace function tests.e7_solve(p_player uuid, p_company uuid, p_arch text) returns text language plpgsql as $$
declare
  v_ev    uuid;
  v_strat text;
  v_n     integer;
  v_step  bigint;
begin
  update public.player_company_events set status = 'over', over_at = now()
   where company_id = p_company and status not in ('over', 'expired');
  v_ev := public.company_event_start(p_company, p_arch, 1);
  select s ->> 'key', jsonb_array_length(s -> 'steps') into v_strat, v_n
    from public.player_company_events e, jsonb_array_elements(e.definition -> 'strategies') with ordinality t(s, o)
   where e.id = v_ev and jsonb_array_length(s -> 'steps') > 0
   order by (s ->> 'mitigation')::numeric desc, o limit 1;
  perform tests.login_as('authenticated', p_player);
  perform public.choose_event_strategy(gen_random_uuid(), v_ev, v_strat);
  reset role;
  for i in 1..v_n loop
    perform tests.login_as('authenticated', p_player);
    perform public.start_event_step(gen_random_uuid(), v_ev);
    reset role;
    select id into v_step from public.company_event_steps where event_id = v_ev and status = 'running';
    perform public.company_event_resolve_step(v_step, 0);
  end loop;
  return (select status || ':' || coalesce(strategy, '') from public.player_company_events where id = v_ev);
end;
$$;
grant execute on all functions in schema tests to public;

-- Kai: a company worth about 1 Mrd. €; Gabi: a small garage
select tests.e7_found(:a, 'Konzern Kolossal', 100000000000) as big \gset
select tests.e7_found(:b, 'Garage Gemütlich', 1000000) as small \gset
select public.company_worth_cents(:'big') as worth_big, public.company_worth_cents(:'small') as worth_small \gset

-- =============================================================================
-- A. Friction: small companies untouched, big ones saturate and pay overhead
-- =============================================================================
select tests.assert(
  public.macro_friction(:worth_small, 0) = '{"demand_factor": 1.0, "extra_cost_share": 0}'::jsonb
  and public.macro_size_decades(:worth_small) = 0
  and abs(public.macro_size_decades(200000000000) - 2) < 1e-9
  and public.macro_size_decades(1000000000000000) = 3
  and abs((public.macro_friction(30000000000, 0) ->> 'demand_factor')::float8 - power(0.1, 0.6)) < 1e-9
  and abs((public.macro_friction(30000000000, 0) ->> 'extra_cost_share')::float8 - 0.15) < 1e-9
  and abs((public.macro_friction(30000000000000, 0) ->> 'extra_cost_share')::float8 - 0.4) < 1e-9
  and abs((public.macro_friction(1000, 2) ->> 'extra_cost_share')::float8 - 0.011) < 1e-9,
  'e7: saturation (pivot/value)^0.6 and overhead 15 % per tenfold (max 40 %) above 30 Mio. EUR, premium of the insurance');
select tests.assert(
  (public.company_event_hour_effect(:'small', date_trunc('hour', now()), date_trunc('hour', now()) + interval '1 hour') ->> 'demand_factor')::float8 = 1
  and (public.company_event_hour_effect(:'big', date_trunc('hour', now()), date_trunc('hour', now()) + interval '1 hour') ->> 'demand_factor')::float8 < 1
  and (public.company_event_hour_effect(:'big', date_trunc('hour', now()), date_trunc('hour', now()) + interval '1 hour') ->> 'extra_cost_share')::float8 > 0
  and public.company_event_unit_cents(:'small') = 20000
  and public.company_event_unit_cents(:'big') >= :worth_big * 12 / 10000 - 1,
  'e7: the hour of a big company carries the friction, a small one does not; the cost unit follows the value');

-- =============================================================================
-- B. Frequency and severity scale with the size
-- =============================================================================
select tests.assert(
  (select count(*) from generate_series(0, 399) i
    where coalesce((public.company_event_pick_sized(i / 400.0, 'tech', 'crisis', :worth_small, null, 0) ->> 'external')::boolean, false)) = 0
  and (select count(*) from generate_series(0, 399) i
        where coalesce((public.company_event_pick_sized(i / 400.0, 'tech', 'crisis', 3000000000, null, 0) ->> 'external')::boolean, false))
      < (select count(*) from generate_series(0, 399) i
          where coalesce((public.company_event_pick_sized(i / 400.0, 'tech', 'crisis', :worth_big, null, 0) ->> 'external')::boolean, false))
  and (select count(distinct public.company_event_pick_sized(i / 400.0, 'tech', 'crisis', 100000000000000, null, 0) ->> 'key')
         from generate_series(0, 399) i) >= 20
  and public.company_event_pick_sized(0.5, 'tech', 'crisis', 0, null, 0) ->> 'key'
      = public.company_event_pick(0.5, 'tech', 'crisis') ->> 'key',
  'e7: small companies draw no external event (same pick as before), bigger ones more of them; every kind reachable');
select tests.assert(
  public.company_event_roll(:'small', now(), array[0.7, 0.9, 0.5, 0.1]) is null
  and public.company_event_roll(:'big', now(), array[0.7, 0.9, 0.5, 0.1]) is not null,
  'e7: the same luck that gives a small company a quiet day brings an event to a billion-euro group');
select public.company_risks_json(:'big') as rbig, public.company_risks_json(:'small') as rsmall \gset
select tests.assert(
  (:'rsmall'::jsonb ->> 'chance_per_day_bps')::int = 6000 and jsonb_array_length(:'rsmall'::jsonb -> 'exposure') = 0
  and (:'rbig'::jsonb ->> 'chance_per_day_bps')::int > 8500
  and (:'rbig'::jsonb ->> 'crisis_share_bps')::int > (:'rsmall'::jsonb ->> 'crisis_share_bps')::int
  and jsonb_array_length(:'rbig'::jsonb -> 'exposure') >= 10
  and (:'rbig'::jsonb ->> 'overhead_bps')::int > 0 and :'rbig'::jsonb -> 'country' = 'null'::jsonb,
  'e7: risks: daily chance 60 % small, > 85 % big; more crises; ten or more external risks; no headquarters = neutral');

-- =============================================================================
-- C. Every external kind can be answered and solved
-- =============================================================================
select tests.assert(
  (select bool_and(tests.e7_solve(:a, :'big', x ->> 'key') like 'solved:%')
     from jsonb_array_elements(public.company_events_cfg() -> 'archetypes') x
    where coalesce((x ->> 'external')::boolean, false))
  and (select count(*) from jsonb_array_elements(public.company_events_cfg() -> 'archetypes') x
        where coalesce((x ->> 'external')::boolean, false)) >= 10,
  'e7: all external events (at least ten kinds) are solved with their strongest strategy');

-- =============================================================================
-- D. Lobby: a won campaign raises the level, the next campaign is easier, politics rarer
-- =============================================================================
select lobby_level as lobby1 from public.player_companies where company_id = :'big' \gset
select tests.assert(:lobby1 >= 1 and tests.m4h_news(:'big', 'lobby_level') >= 1,
  'e7: winning the lobby campaign raised the lobby level, with news');
update public.player_company_events set status = 'over' where company_id = :'big' and status not in ('over', 'expired');
select public.company_event_start(:'big', 'political_decision', 1) as pol \gset
select tests.assert(
  (select (definition #>> '{strategies,0,steps,3,baseBps}')::int from public.player_company_events where id = :'pol')
    = 5000 + :lobby1 * 350
  and (select (definition #>> '{strategies,1,steps,0,baseBps}')::int from public.player_company_events where id = :'pol') = 9000
  and public.macro_weight(public.company_event_archetype('political_decision'), :worth_big, null, 3)
      < public.macro_weight(public.company_event_archetype('political_decision'), :worth_big, null, 0),
  'e7: lobby bonus on every lobby step (not on the other strategies), fewer political events');
-- a lobby step can fail: the campaign is a gamble
select tests.login_as('authenticated', :a);
select public.choose_event_strategy(gen_random_uuid(), :'pol', 'lobby_campaign') is not null as ok \gset
select public.start_event_step(gen_random_uuid(), :'pol') is not null as ok \gset
reset role;
select id as pstep from public.company_event_steps where event_id = :'pol' and status = 'running' \gset
select tests.assert(public.company_event_resolve_step(:pstep, 0.9999) = false
  and (select status from public.player_company_events where id = :'pol') = 'open',
  'e7: a failed lobby step leaves the crisis open (retry or switch)');

-- =============================================================================
-- E. Insurance: a premium every hour, coverage only after the wait, less damage
-- =============================================================================
update public.player_company_events set status = 'over' where company_id = :'big' and status not in ('over', 'expired');
select tests.login_as('authenticated', :a);
select public.set_company_insurance(gen_random_uuid(), 2) as ins \gset
select tests.throws_key('select public.set_company_insurance(gen_random_uuid(), 7)', 'invalid_argument',
  'e7: set_company_insurance(): unknown level');
reset role;
select tests.assert(
  (:'ins'::jsonb #>> '{insurance,level}')::int = 2 and (:'ins'::jsonb #>> '{insurance,coverage_bps}')::int = 0
  and :'ins'::jsonb #>> '{insurance,full_from}' is not null,
  'e7: a new insurance covers only after the wait (no buying after the quake)');
select public.company_event_start(:'big', 'earthquake', 2) as q0 \gset
update public.player_company_events set status = 'over' where id = :'q0';
update public.player_companies set insurance_changed_at = now() - interval '13 hours' where company_id = :'big';
select public.company_event_start(:'big', 'earthquake', 2) as q1 \gset
select definition as qdef1 from public.player_company_events where id = :'q1' \gset
select definition as qdef0 from public.player_company_events where id = :'q0' \gset
select tests.assert(
  (:'qdef0'::jsonb ->> 'insuredShare')::float8 = 0 and (:'qdef1'::jsonb ->> 'insuredShare')::float8 = 0.8
  and abs((1 - (public.company_event_modifiers(:'qdef1'::jsonb, 2, 'in_force', 0) ->> 'capacity_factor')::float8)
          - 0.2 * (1 - (public.company_event_modifiers(:'qdef0'::jsonb, 2, 'in_force', 0) ->> 'capacity_factor')::float8)) < 1e-9
  and abs((public.company_event_modifiers(:'qdef1'::jsonb, 2, 'in_force', 0) ->> 'extra_cost_share')::float8
          - 0.2 * (public.company_event_modifiers(:'qdef0'::jsonb, 2, 'in_force', 0) ->> 'extra_cost_share')::float8) < 1e-9
  and (public.company_event_hour_effect(:'small', now(), now() + interval '1 hour') ->> 'extra_cost_share')::float8 = 0
  and (public.macro_friction(:worth_big, 2) ->> 'extra_cost_share')::float8
      - (public.macro_friction(:worth_big, 0) ->> 'extra_cost_share')::float8 between 0.0109 and 0.0111
  and (select definition ->> 'insuredShare' from public.player_company_events where id = :'pol') is null,
  'e7: full insurance takes 80 % of the quake''s damage and costs 1.1 % of the revenue; not insurable = no share');

-- =============================================================================
-- F. Taxes: progressive brackets per day, the advisor grows exponentially
-- =============================================================================
select tests.assert(
  public.company_tax_progressive_cents(2400000, 1500, 24) = 360000
  and public.company_tax_progressive_cents(50000000, 1500, 24) = 8700000
  and public.company_tax_progressive_cents(25000000, 1500, 12) = 4350000
  and public.company_tax_progressive_cents(1000000000, 1500, 24) = 242700000
  and public.company_tax_progressive_cents(0, 1500, 24) = 0,
  'e7: 15 % up to 100 000 EUR a day, +3 / +7 / +12 % above 0.1 / 1 / 10 Mio.; the length of the period does not matter');
select tests.assert(
  public.listed_advisor_wage(20000) = 6000 and public.listed_advisor_wage(100000) = 6000
  and public.listed_advisor_wage(1000000) = 36000 and public.listed_advisor_wage(10000000) = 864000
  and public.listed_advisor_wage(1000000000) = 300000000,
  'e7: the advisor: 1.5 % up to 1 000 EUR an hour, x 2.4 per tenfold revenue, at most 30 %');

-- =============================================================================
-- G. Four players, money
-- =============================================================================
select tests.assert(:'inv0'::boolean and tests.money_invariant() = 'ok' and not exists (select 1 from public.ledger_audit()),
  'e7: the money invariant holds (steps are ledger postings, the insurance premium goes with the goods)');
select tests.login_as('authenticated', :b);
select public.get_company_risks() ->> 'company_id' = :'small' as own \gset
reset role;
select tests.assert(:'own'::boolean, 'e7: get_company_risks() shows the own company');
