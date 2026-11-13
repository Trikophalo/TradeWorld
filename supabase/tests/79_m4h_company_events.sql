-- =============================================================================
-- 79 · M4h: company events, response steps and company news (ADR-091)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''07907907-0000-4000-8000-0000000000a1'''
\set f '''07907907-0000-4000-8000-0000000000f1'''
\set w '''07907907-0000-4000-8000-0000000000e1'''
\set s '''07907907-0000-4000-8000-0000000000c1'''
\set h '''07907907-0000-4000-8000-0000000000d1'''
\set l '''07907907-0000-4000-8000-0000000000b1'''
select tests.signup(:a, 'Ada_Krisenfest') is not null and tests.signup(:f, 'Fritz_Gegenwind') is not null
   and tests.signup(:w, 'Wanda_Mitarbeit') is not null and tests.signup(:s, 'Sven_Aussen') is not null
   and tests.signup(:h, 'Hedi_Taktgeber') is not null and tests.signup(:l, 'Lars_Kursrutsch') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(x, 6) from unnest(array[:a, :f, :w, :s, :h, :l]::uuid[]) x;
select tests.fund(x, 1000000, 'test:m4h:' || x::text) from unnest(array[:a, :f, :h, :l]::uuid[]) x;
select coalesce(value -> 'demandNoise', '0.1') as noise0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{demandNoise}', '0');
select (value #>> '{marketFactorByTier,garage}')::numeric as mf_garage from public.game_config where key = 'startups' \gset
select public.config_double('startups', '{grossMargin,energy}', 0.5) as margin_energy \gset

-- a fresh company with 10 000 EUR extra cash (on top of the founding cost)
create or replace function tests.m4h_found(p_player uuid, p_name text, p_sector text) returns uuid language plpgsql as $$
declare
  v_co uuid;
begin
  perform tests.login_as('authenticated', p_player);
  perform public.found_company(gen_random_uuid(), p_name, 'Ideen für alle', p_sector, '#335577', 'garage');
  reset role;
  v_co := tests.company_of(p_player);
  perform public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(v_co), 1000000,
                                 'transfer', 'Test-Kapital', 'company', v_co, 'test:m4h:cash:' || v_co::text);
  return v_co;
end;
$$;
-- forces the outcome of the running step of an event (10 000 = success, 0 = failure)
create or replace function tests.m4h_force(p_event uuid, p_bps integer) returns void language sql as $$
  update public.company_event_steps set success_bps = p_bps where event_id = p_event and status = 'running' $$;
create or replace function tests.m4h_news(p_company uuid, p_kind text) returns bigint language sql as $$
  select count(*) from public.company_news where company_id = p_company and kind = p_kind $$;
grant execute on all functions in schema tests to public;

select tests.m4h_found(:a, 'Krisenfest Werk', 'tech') as aco \gset
select tests.m4h_found(:f, 'Gegenwind Energie', 'energy') as fco \gset

-- =============================================================================
-- A. Rules (port of company-events.ts)
-- =============================================================================
select tests.assert(
  public.company_event_severity(0.1) = 1 and public.company_event_severity(0.6) = 2 and public.company_event_severity(0.95) = 3,
  'rollSeverity: 0.1 -> 1, 0.6 -> 2, 0.95 -> 3 (weights 0.5 / 0.35 / 0.15)');
select tests.assert(
  public.company_event_pick(0, 'energy', 'crisis') ->> 'key' = 'regulation'
  and public.company_event_pick(0.999, 'energy', 'chance') ->> 'key' = 'partnership'
  and public.company_event_pick(10.0 / 41 - 0.001, 'energy', 'chance') ->> 'key' = 'viral_trend'
  and public.company_event_pick(10.0 / 41 + 0.001, 'energy', 'chance') ->> 'key' = 'big_contract',
  'pickArchetype: catalog order by weight (chances 10/9/8/7/7 of 41)');
select tests.assert(
  (select bool_and(public.company_event_pick(i / 200.0, 'pharma', 'crisis') ->> 'key' <> 'data_breach'
                   and public.company_event_pick(i / 200.0, 'pharma', 'crisis') ->> 'polarity' = 'crisis')
     from generate_series(0, 199) i)
  and (select bool_or(public.company_event_pick(i / 200.0, 'tech', 'crisis') ->> 'key' = 'data_breach') from generate_series(0, 199) i)
  and (select count(distinct public.company_event_pick(i / 200.0, 'tech', 'chance') ->> 'key') from generate_series(0, 199) i) = 5,
  'pickArchetype: only archetypes of the sector (data_breach not for pharma), only the polarity, every chance reachable');
select public.company_event_archetype('regulation') #> '{strategies,0,steps,2}' as hearing \gset
select public.company_event_archetype('regulation') #> '{strategies,0,steps,1}' as alliance \gset
select tests.assert(
  :'hearing'::jsonb ->> 'key' = 'hearing'
  and public.company_event_step_cost(:'hearing'::jsonb, 20000, 1) = 60000
  and public.company_event_step_cost(:'hearing'::jsonb, 20000, 3) = 90000
  and public.company_event_step_cost(:'hearing'::jsonb, 20000, 1, true) = 30000
  and public.company_event_step_bps(:'hearing'::jsonb, 1, 0) = 5500
  and public.company_event_step_bps(:'hearing'::jsonb, 1, 10) = 7000
  and public.company_event_step_bps(:'hearing'::jsonb, 1, 1000) = 8000
  and public.company_event_step_bps(:'hearing'::jsonb, 3, 0) = 4100
  and public.company_event_step_bps(:'hearing'::jsonb || '{"baseBps": 0}', 3, 0) = 500
  and public.company_event_step_bps(public.company_event_archetype('strike') #> '{strategies,1,steps,0}', 1, 50) = 10000,
  'stepCostCents (severity +25 % per level, retry 50 %) and stepSuccessBps (know-how 150 bps/point up to 2 500, -700 per severity, 5..100 %)');
select tests.assert(
  public.company_event_unit_cents(:'aco') = 20000
  and public.company_event_headcount(:'aco') = 1
  and (select array_agg(k order by k) from jsonb_object_keys(public.company_event_team_scores(:'aco')) k)
      = array['craft', 'finance', 'it', 'law', 'logistics', 'management', 'sales', 'science'],
  'costUnitCents: max(20 000, fixed costs x 0.5) for a garage; headcount = founder; team scores in all 8 branches');
-- eventPhase (crisis regulation: deadline 30 h, lasts 72 h; chance viral_trend lasts 48 h)
select tests.assert(
  public.company_event_phase('crisis', 72, now() + interval '20 hours', null, now()) = 'open'
  and public.company_event_phase('crisis', 72, now() - interval '1 hour', null, now()) = 'in_force'
  and public.company_event_phase('crisis', 72, now() - interval '73 hours', null, now()) = 'over'
  and public.company_event_phase('crisis', 72, now() + interval '20 hours', now() - interval '1 hour', now()) = 'in_force'
  and public.company_event_phase('crisis', 72, now() + interval '20 hours', now() - interval '73 hours', now()) = 'over'
  and public.company_event_phase('chance', 48, now() + interval '1 hour', null, now()) = 'open'
  and public.company_event_phase('chance', 48, now() - interval '1 hour', null, now()) = 'over'
  and public.company_event_phase('chance', 48, now() - interval '1 hour', now() - interval '5 hours', now()) = 'in_force',
  'eventPhase: crisis open / in force after the deadline / over; solved early from the solution; chance only after success');
select public.company_event_archetype('regulation') as reg \gset
select public.company_event_archetype('viral_trend') as viral \gset
select tests.assert(
  abs((public.company_event_modifiers(:'reg'::jsonb, 1, 'open', 0) ->> 'demand_factor')::float8 - 0.97) < 1e-9
  and abs((public.company_event_modifiers(:'reg'::jsonb, 1, 'in_force', 0) ->> 'demand_factor')::float8 - 0.88) < 1e-9
  and abs((public.company_event_modifiers(:'reg'::jsonb, 1, 'in_force', 0) ->> 'extra_cost_share')::float8 - 0.06) < 1e-9
  and public.company_event_modifiers(:'reg'::jsonb, 1, 'in_force', 1)
      = '{"demand_factor": 1, "capacity_factor": 1, "extra_cost_share": 0}'::jsonb
  and (public.company_event_modifiers(:'reg'::jsonb, 3, 'in_force', 0) ->> 'demand_factor')::float8
      < (public.company_event_modifiers(:'reg'::jsonb, 1, 'in_force', 0) ->> 'demand_factor')::float8
  and (public.company_event_modifiers(:'viral'::jsonb, 1, 'open', 0) ->> 'demand_factor')::float8 = 1
  and abs((public.company_event_modifiers(:'viral'::jsonb, 1, 'in_force', 1) ->> 'demand_factor')::float8 - 1.35) < 1e-9
  and abs((public.company_event_modifiers(:'reg'::jsonb, 1, 'open', 0, 0.3) ->> 'capacity_factor')::float8 - 0.7) < 1e-9,
  'eventModifiers: 25 % urgency while open, full effect in force, solved = none, chance only in force, capacity hit');

-- =============================================================================
-- B. The daily roll: age, one per Berlin day, luck, active event, gap, roll time
-- =============================================================================
select ((date_trunc('day', now() at time zone 'Europe/Berlin') - interval '10 days' + interval '12 hours')
        at time zone 'Europe/Berlin') as base \gset
update public.companies set founded_at = :'base'::timestamptz - interval '2 hours' where id = :'aco';
select public.company_event_roll(:'aco', :'base'::timestamptz, array[0, 0.9, 0, 0.1]) is null as r0_null \gset
select tests.assert(
  :'r0_null'::boolean
  and exists (select 1 from public.company_event_rolls r where r.company_id = :'aco'
                 and r.berlin_day = (:'base'::timestamptz at time zone 'Europe/Berlin')::date and r.event_id is null),
  'roll: a company younger than minAgeHours (6 h) gets nothing, the roll of the day is used');
update public.companies set founded_at = :'base'::timestamptz - interval '2 days' where id = :'aco';
select tests.assert(
  public.company_event_roll(:'aco', :'base'::timestamptz + interval '1 hour', array[0, 0.9, 0, 0.1]) is null,
  'roll: only one roll per company and Berlin day');
select public.company_event_roll(:'aco', :'base'::timestamptz + interval '1 day', array[0.99, 0.9, 0, 0.1]) is null as r2_null \gset
select tests.assert(
  :'r2_null'::boolean
  and exists (select 1 from public.company_event_rolls r where r.company_id = :'aco'
                 and r.berlin_day = ((:'base'::timestamptz + interval '1 day') at time zone 'Europe/Berlin')::date),
  'roll: no event when u0 >= chancePerDay (0.6)');
select public.company_event_roll(:'aco', :'base'::timestamptz + interval '2 days', array[0, 0.9, 0, 0.1]) as e0 \gset
select * from public.player_company_events where id = :'e0' \gset e0_
select tests.assert(
  :'e0_archetype' = 'regulation' and :'e0_polarity' = 'crisis' and :e0_severity::int = 1
  and :'e0_status' = 'open' and :'e0_started_at'::timestamptz = :'base'::timestamptz + interval '2 days'
  and :'e0_deadline_at'::timestamptz = :'base'::timestamptz + interval '2 days 30 hours'
  and (select announce_shock_bps is null from public.player_company_events where id = :'e0')
  and (select r.event_id from public.company_event_rolls r where r.company_id = :'aco'
        and r.berlin_day = ((:'base'::timestamptz + interval '2 days') at time zone 'Europe/Berlin')::date) = :'e0'::uuid,
  'roll: u = [0, 0.9, 0, 0.1] starts the first crisis (regulation), severity 1, deadline +30 h, no shock when not listed');
select tests.assert(
  public.company_event_roll(:'aco', :'base'::timestamptz + interval '3 days' - interval '1 hour', array[0, 0.9, 0, 0.1]) is null,
  'roll: nothing while an event is active');
select tests.assert(
  public.company_event_start(:'aco', 'strike', 1, now()) is null,
  'company_event_start: at most one active event per company');

-- deadline without a strategy: in force, no credit; then over after lastsHours
select public.company_events_run_due(:'base'::timestamptz + interval '2 days 31 hours', false) as j1 \gset
select tests.assert(
  (:'j1'::jsonb ->> 'deadlines')::int >= 1
  and (select status = 'in_force' and mitigation = 0 from public.player_company_events where id = :'e0')
  and exists (select 1 from public.company_news n where n.company_id = :'aco' and n.kind = 'event_deadline'
                 and n.payload ->> 'event_id' = :'e0' and (n.payload ->> 'mitigation')::float8 = 0),
  'deadline: an open crisis comes into force (mitigation 0 without a strategy), news event_deadline');
select public.company_events_run_due(:'base'::timestamptz + interval '2 days 103 hours', false) as j2 \gset
select tests.assert(
  (select status = 'over' and over_at = :'base'::timestamptz + interval '2 days 102 hours'
     from public.player_company_events where id = :'e0')
  and exists (select 1 from public.company_news n where n.company_id = :'aco' and n.kind = 'event_over'
                 and n.payload ->> 'event_id' = :'e0' and n.payload ->> 'status' = 'in_force'),
  'over: the effect ends lastsHours (72) after the deadline, news event_over');

-- gap: at most one event in minGapHours (22 h)
select public.company_event_roll(:'aco', :'base'::timestamptz + interval '4 days', array[0, 0.9, 0, 0.1]) as e1 \gset
update public.player_company_events set status = 'over', over_at = now() where id = :'e1';
select tests.assert(
  (select archetype = 'regulation' from public.player_company_events where id = :'e1')
  and public.company_event_roll(:'aco', :'base'::timestamptz + interval '5 days' - interval '4 hours', array[0, 0.9, 0, 0.1]) is null,
  'roll: no new event within minGapHours (22) after the last start, even on the next day');
select public.company_event_roll(:'aco', :'base'::timestamptz + interval '6 days', array[0, 0.1, 0, 0.95]) as e2 \gset
select tests.assert(
  (select polarity = 'chance' and archetype = 'viral_trend' and severity = 3 from public.player_company_events where id = :'e2'),
  'roll: u1 < chanceShare (0.4) gives a chance, u3 = 0.95 severity 3');
update public.player_company_events set status = 'over', over_at = now() where id = :'e2';

-- the job rolls at the company's time of the day (rollWindowHours 7..21 Berlin)
select tests.assert(
  (select bool_and(public.company_event_roll_at(:'aco', d) >= (d::timestamp + interval '7 hours') at time zone 'Europe/Berlin'
                   and public.company_event_roll_at(:'aco', d) < (d::timestamp + interval '21 hours') at time zone 'Europe/Berlin')
     from generate_series(current_date - 20, current_date, interval '1 day') g(x), lateral (select g.x::date as d) dd),
  'roll time: once a day between 07:00 and 21:00 Berlin');
select ((date_trunc('day', now() at time zone 'Europe/Berlin') - interval '12 days' + interval '6 hours')
        at time zone 'Europe/Berlin') as early \gset
select public.company_events_run_due(:'early'::timestamptz, true) as j3 \gset
select tests.assert(
  not exists (select 1 from public.company_event_rolls r where r.company_id = :'aco'
                 and r.berlin_day = (:'early'::timestamptz at time zone 'Europe/Berlin')::date),
  'run_due: before the roll time of the day nothing is rolled');
select public.company_events_run_due(:'early'::timestamptz + interval '17 hours', true) as j4 \gset
select tests.assert(
  exists (select 1 from public.company_event_rolls r where r.company_id = :'aco'
             and r.berlin_day = (:'early'::timestamptz at time zone 'Europe/Berlin')::date)
  and (:'j4'::jsonb ->> 'started')::int = 0,
  'run_due: after 21:00 every active company has rolled that day (here without an event: the gap to the later events)');

-- =============================================================================
-- C. Responding: strategy, paid steps from the free cash, failure, retry, staff, switching
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.get_company_event() as st0 \gset
reset role;
select tests.assert(
  :'st0'::jsonb ?& array['company', 'can_act', 'unit_cents', 'headcount', 'branch_scores', 'event', 'history', 'profile_words']
  and :'st0'::jsonb -> 'company' = jsonb_build_object('id', :'fco'::uuid, 'name', 'Gegenwind Energie', 'idea', 'Ideen für alle',
                                                      'sector', 'energy', 'product_key', public.company_product(:'fco') ->> 'key',
                                                      'tier', 'garage')
  and (:'st0'::jsonb ->> 'can_act')::boolean and (:'st0'::jsonb ->> 'unit_cents')::bigint = 20000
  and (:'st0'::jsonb ->> 'headcount')::int = 1 and :'st0'::jsonb -> 'event' = 'null'::jsonb
  and :'st0'::jsonb -> 'history' = '[]'::jsonb and :'st0'::jsonb -> 'profile_words' = 'null'::jsonb,
  'get_company_event(): EVENT_STATE without an event');

select public.company_event_start(:'fco', 'regulation', 2, now()) as ev \gset
select tests.assert(
  (select status = 'open' and severity = 2 and deadline_at = started_at + interval '30 hours' and announce_shock_bps is null
     from public.player_company_events where id = :'ev')
  and exists (select 1 from public.company_news n where n.company_id = :'fco' and n.kind = 'event_started'
                 and n.payload @> jsonb_build_object('event_id', :'ev'::uuid, 'archetype', 'regulation', 'polarity', 'crisis', 'severity', 2)
                 and n.payload ? 'deadline_at' and n.payload -> 'share_shock_bps' = 'null'::jsonb)
  and exists (select 1 from public.notifications x where x.player_id = :f and x.type_key = 'company_event'
                 and x.title = 'Krise bei Gegenwind Energie' and x.link = '/company' and x.body like 'Reagiere bis %'
                 and x.payload ->> 'event_id' = :'ev'),
  'event start: news event_started, notification company_event "Krise bei <Firma>" to the founder');

select tests.login_as('authenticated', :f);
select public.get_company_event() as st1 \gset
select tests.throws_key(format('select public.choose_event_strategy(gen_random_uuid(), %L, %L)', :'ev', 'nope'), 'invalid_argument',
  'choose_event_strategy(): unknown strategy');
select tests.throws_key(format('select public.choose_event_strategy(gen_random_uuid(), %L, null)', :'ev'), 'invalid_argument',
  'choose_event_strategy(): strategy required');
select tests.throws_key(format('select public.choose_event_strategy(gen_random_uuid(), %L, %L)', gen_random_uuid(), 'lobby'),
  'company_not_found', 'choose_event_strategy(): unknown event');
\set rq1 '''07907907-0000-4000-8000-000000000101'''
select public.choose_event_strategy(:rq1, :'ev', 'lobby') as st2 \gset
select public.choose_event_strategy(:rq1, :'ev', 'lobby') as st2b \gset
reset role;
select tests.assert(
  :'st1'::jsonb #>> '{event,id}' = :'ev' and :'st1'::jsonb #>> '{event,status}' = 'open'
  and :'st1'::jsonb #> '{event,strategy}' = 'null'::jsonb and :'st1'::jsonb #> '{event,next}' = 'null'::jsonb
  and :'st1'::jsonb #> '{event,steps}' = '[]'::jsonb
  and :'st1'::jsonb #> '{event,options}' = jsonb_build_array(
        jsonb_build_object('strategy', 'lobby', 'first_step_cost_cents', 50000,
                           'first_step_success_bps', 9000 + least(2500, 150 * (:'st1'::jsonb #>> '{branch_scores,law}')::int) - 700),
        jsonb_build_object('strategy', 'adapt', 'first_step_cost_cents', 100000, 'first_step_success_bps', 9500 - 700),
        jsonb_build_object('strategy', 'accept', 'first_step_cost_cents', null, 'first_step_success_bps', null))
  and (:'st1'::jsonb -> 'event') ?& array['id', 'archetype', 'polarity', 'severity', 'status', 'started_at', 'deadline_at',
                                          'resolved_at', 'over_at', 'strategy', 'mitigation', 'ai_headline', 'ai_body', 'ai_cause',
                                          'steps', 'next', 'options'],
  'EVENT_STATE: open crisis with options (first step price and chance per strategy, severity 2 = x1.25 and -700 bps)');
select tests.assert(
  :'st2'::jsonb #>> '{event,strategy}' = 'lobby' and :'st2'::jsonb = :'st2b'::jsonb
  and :'st2'::jsonb #> '{event,next}' = jsonb_build_object(
        'strategy', 'lobby', 'idx', 0, 'key', 'study', 'cost_cents', 50000,
        'success_bps', 9000 + least(2500, 150 * (:'st2'::jsonb #>> '{branch_scores,law}')::int) - 700,
        'staff', 0, 'staff_ok', true, 'hours', 3, 'retry', false),
  'choose_event_strategy(): strategy stored, next step with price and chance; idempotent per request_id');

-- the price comes from the free cash (cash minus open bills)
update public.player_companies set unpaid_cents = tests.company_cash(:'fco') - 49999 where company_id = :'fco';
select tests.login_as('authenticated', :f);
select tests.throws_key(format('select public.start_event_step(gen_random_uuid(), %L)', :'ev'), 'insufficient_funds',
  'start_event_step(): only from the free cash (open bills first)');
reset role;
update public.player_companies set unpaid_cents = 0 where company_id = :'fco';
select tests.company_cash(:'fco') as cc0 \gset
select balance_cents as hh0 from public.ledger_accounts where system_key = 'households' \gset
\set rq2 '''07907907-0000-4000-8000-000000000102'''
select tests.login_as('authenticated', :f);
select public.start_event_step(:rq2, :'ev') as st3 \gset
select tests.throws_key(format('select public.start_event_step(gen_random_uuid(), %L)', :'ev'), 'invalid_argument',
  'start_event_step(): not while a step runs');
reset role;
select tests.assert(
  tests.company_cash(:'fco') = :cc0::bigint - 50000
  and (select balance_cents from public.ledger_accounts where system_key = 'households') = :hh0::bigint + 50000
  and (select count(*) from public.ledger_transactions t
        where t.idempotency_key = 'event-step:' || :'ev' || ':' || :rq2 and t.kind = 'company_costs' and t.ref_id = :'fco'::uuid) = 1
  and (select sum(e.amount_cents) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.idempotency_key = 'event-step:' || :'ev' || ':' || :rq2) = 0
  and jsonb_array_length(:'st3'::jsonb #> '{event,steps}') = 1
  and :'st3'::jsonb #> '{event,steps,0}' @> jsonb_build_object('idx', 0, 'strategy', 'lobby', 'key', 'study', 'status', 'running',
                                                                'cost_cents', 50000, 'retry', false)
  and (:'st3'::jsonb #>> '{event,steps,0,ends_at}')::timestamptz = (:'st3'::jsonb #>> '{event,steps,0,started_at}')::timestamptz + interval '3 hours'
  and :'st3'::jsonb #> '{event,next}' = 'null'::jsonb
  and not exists (select 1 from public.ledger_audit()),
  'start_event_step(): one balanced posting company cash -> households, the step runs 3 h, next is null while it runs');

-- failure, then a retry at half the price
select tests.m4h_force(:'ev', 0);
select public.company_events_run_due(now() + interval '4 hours', false) as j5 \gset
select tests.login_as('authenticated', :f);
select public.get_company_event() as st4 \gset
reset role;
select tests.assert(
  (:'j5'::jsonb ->> 'steps')::int = 1
  and :'st4'::jsonb #>> '{event,steps,0,status}' = 'failed'
  and :'st4'::jsonb #> '{event,next}' @> '{"idx": 0, "key": "study", "cost_cents": 25000, "retry": true}'::jsonb
  and exists (select 1 from public.company_news n where n.company_id = :'fco' and n.kind = 'event_step_failed'
                 and n.payload @> jsonb_build_object('event_id', :'ev'::uuid, 'strategy', 'lobby', 'idx', 0, 'step', 'study', 'success', false))
  and exists (select 1 from public.notifications x where x.player_id = :f and x.type_key = 'company_event'
                 and x.title = 'Schritt gescheitert bei Gegenwind Energie'),
  'step resolution: failure (u x 10 000 >= success_bps), news event_step_failed, notification; retry costs retryCostShare (50 %)');
select tests.login_as('authenticated', :f);
select public.start_event_step(gen_random_uuid(), :'ev') as st5 \gset
reset role;
select tests.m4h_force(:'ev', 10000);
select public.company_events_run_due(now() + interval '4 hours', false) is not null as ok \gset
select tests.login_as('authenticated', :f);
select public.get_company_event() as st6 \gset
select tests.throws_key(format('select public.start_event_step(gen_random_uuid(), %L)', :'ev'), 'event_needs_staff',
  'start_event_step(): the alliance needs 2 people (founder alone)');
reset role;
select tests.assert(
  :'st5'::jsonb #> '{event,steps,1}' @> '{"idx": 0, "key": "study", "status": "running", "cost_cents": 25000, "retry": true}'::jsonb
  and tests.company_cash(:'fco') = :cc0::bigint - 75000
  and :'st6'::jsonb #>> '{event,steps,1,status}' = 'succeeded'
  and :'st6'::jsonb #> '{event,next}' @> '{"idx": 1, "key": "alliance", "staff": 2, "staff_ok": false, "cost_cents": 25000}'::jsonb
  and exists (select 1 from public.company_news n where n.company_id = :'fco' and n.kind = 'event_step_done'
                 and n.payload @> jsonb_build_object('event_id', :'ev'::uuid, 'step', 'study', 'success', true))
  and exists (select 1 from public.notifications x where x.player_id = :f and x.title = 'Schritt geschafft bei Gegenwind Energie'),
  'retry: half price, success moves on to the next step; news event_step_done; staff_ok false with too few people');

-- switching discards the progress (money spent stays spent), a running step stops
select tests.login_as('authenticated', :f);
select public.choose_event_strategy(gen_random_uuid(), :'ev', 'adapt') as st7 \gset
select public.start_event_step(gen_random_uuid(), :'ev') as st8 \gset
select public.choose_event_strategy(gen_random_uuid(), :'ev', 'lobby') as st9 \gset
reset role;
select tests.assert(
  :'st7'::jsonb #> '{event,steps}' = '[]'::jsonb
  and :'st7'::jsonb #> '{event,next}' @> '{"strategy": "adapt", "idx": 0, "key": "retool", "cost_cents": 100000, "staff": 1, "staff_ok": true}'::jsonb
  and :'st8'::jsonb #> '{event,steps,0}' @> '{"key": "retool", "status": "running"}'::jsonb
  and (select capacity_hit from public.company_event_steps where event_id = :'ev' and key = 'retool') = 0.3
  and :'st9'::jsonb #> '{event,steps}' = '[]'::jsonb
  and :'st9'::jsonb #> '{event,next}' @> '{"strategy": "lobby", "idx": 0, "key": "study", "cost_cents": 50000, "retry": false}'::jsonb
  and (select status = 'failed' and discarded and ends_at <= now() from public.company_event_steps where event_id = :'ev' and key = 'retool')
  and (select count(*) from public.company_event_steps where event_id = :'ev' and not discarded) = 0
  and tests.company_cash(:'fco') = :cc0::bigint - 175000,
  'switching the strategy discards the progress and stops a running step; nothing is refunded');

-- a team member brings people and know-how
insert into public.player_skills (player_id, skill_key) values (:w, 'law_basics'), (:w, 'law_contracts') on conflict do nothing;
select tests.hire(:f, :w, 1500) is not null as ok \gset
select tests.login_as('authenticated', :f);
select public.start_event_step(gen_random_uuid(), :'ev') is not null as ok \gset
reset role;
select tests.m4h_force(:'ev', 10000);
select public.company_events_run_due(now() + interval '4 hours', false) is not null as ok \gset
select tests.login_as('authenticated', :f);
select public.get_company_event() as st10 \gset
select public.start_event_step(gen_random_uuid(), :'ev') is not null as ok \gset
reset role;
select tests.m4h_force(:'ev', 10000);
select public.company_events_run_due(now() + interval '6 hours', false) is not null as ok \gset
select tests.login_as('authenticated', :f);
select public.get_company_event() as st11 \gset
reset role;
select tests.assert(
  (:'st10'::jsonb ->> 'headcount')::int = 2
  and (:'st10'::jsonb #>> '{branch_scores,law}')::int
      = (public.player_branch_scores(:f) ->> 'law')::int + (public.player_branch_scores(:w) ->> 'law')::int
  and (public.player_branch_scores(:w) ->> 'law')::int >= 3
  and :'st10'::jsonb #> '{event,next}' @> '{"idx": 1, "key": "alliance", "staff_ok": true}'::jsonb
  and :'st11'::jsonb #> '{event,next}' @> jsonb_build_object(
        'idx', 2, 'key', 'hearing', 'cost_cents', 75000,
        'success_bps', 5500 + least(2500, 150 * (:'st11'::jsonb #>> '{branch_scores,law}')::int) - 700)
  and exists (select 1 from public.company_news n where n.company_id = :'fco' and n.kind = 'hired'
                 and n.payload = '{"nickname": "Wanda_Mitarbeit", "title": "Werkstudium"}'::jsonb),
  'team: headcount founder + employee, branch scores of founder and employee add up and raise the chance; news hired');

-- the last step solves the crisis: mitigation, bonus once, news, notification
select awareness as aw0 from public.player_companies where company_id = :'fco' \gset
select tests.login_as('authenticated', :f);
select public.start_event_step(gen_random_uuid(), :'ev') is not null as ok \gset
reset role;
select ends_at as last_end from public.company_event_steps where event_id = :'ev' and status = 'running' \gset
select tests.m4h_force(:'ev', 10000);
select public.company_events_run_due(now() + interval '7 hours', false) is not null as ok \gset
select tests.assert(
  (select status = 'solved' and resolved_at = :'last_end'::timestamptz and mitigation = 1 and bonus_applied
          and resolution_shock_bps is null
     from public.player_company_events where id = :'ev')
  and abs((select awareness from public.player_companies where company_id = :'fco') - (:aw0::float8 + 0.02)) < 1e-9
  and exists (select 1 from public.company_news n where n.company_id = :'fco' and n.kind = 'event_solved'
                 and n.payload @> jsonb_build_object('event_id', :'ev'::uuid, 'strategy', 'lobby', 'mitigation', 1))
  and exists (select 1 from public.notifications x where x.player_id = :f and x.title = 'Krise gemeistert: Gegenwind Energie'),
  'solved: every step of the strategy succeeded, mitigation 1, bonus awareness +0.02, news event_solved, notification');
select public.company_event_solve(:'ev', now());
select tests.assert(
  abs((select awareness from public.player_companies where company_id = :'fco') - (:aw0::float8 + 0.02)) < 1e-9
  and tests.m4h_news(:'fco', 'event_solved') = 1,
  'solved: the bonus and the news come only once');
select tests.login_as('authenticated', :f);
select tests.throws_key(format('select public.start_event_step(gen_random_uuid(), %L)', :'ev'), 'event_closed',
  'start_event_step(): not after the event is solved');
select tests.throws_key(format('select public.choose_event_strategy(gen_random_uuid(), %L, %L)', :'ev', 'adapt'), 'event_closed',
  'choose_event_strategy(): not after the event is solved');
reset role;

-- =============================================================================
-- D. Who may see and act
-- =============================================================================
select tests.login_as('authenticated', :w);
select public.get_company_event() as sw1 \gset
select public.get_company_event(:'fco') as sw2 \gset
select public.get_company_news() as nw1 \gset
select tests.throws_key(format('select public.choose_event_strategy(gen_random_uuid(), %L, %L)', :'ev', 'lobby'), 'company_not_found',
  'employee: cannot choose a strategy');
select tests.throws_key(format('select public.start_event_step(gen_random_uuid(), %L)', :'ev'), 'company_not_found',
  'employee: cannot start a step');
reset role;
select tests.assert(
  not (:'sw1'::jsonb ->> 'can_act')::boolean and :'sw1'::jsonb #>> '{event,id}' = :'ev' and :'sw1'::jsonb = :'sw2'::jsonb
  and :'nw1'::jsonb #>> '{company,id}' = :'fco',
  'employee: reads the event (null = the employer) and the news, can_act false');
select tests.login_as('authenticated', :s);
select tests.throws_key(format('select public.get_company_event(%L)', :'fco'), 'company_not_found', 'stranger: no event state');
select tests.throws_key($$select public.get_company_event()$$, 'company_not_found', 'stranger without a company: company_not_found');
select tests.throws_key(format('select public.get_company_news(%L)', :'fco'), 'company_not_found', 'stranger: no news');
select tests.throws_key(format('select public.company_ai_context(%L)', :'fco'), 'company_not_found', 'stranger: no AI context');
select tests.throws(format('select * from public.player_company_events where company_id = %L', :'fco'), '42501',
  'stranger: no direct read of the events table');
reset role;
select tests.assert(
  not exists (select 1 from unnest(array['player_company_events', 'company_event_steps', 'company_event_rolls', 'company_news',
                                          'company_ai_profiles']) t
               where has_table_privilege('authenticated', ('public.' || t)::regclass, 'select, insert, update, delete')),
  'authenticated has no table privileges on the M4h tables (RPCs only)');

-- =============================================================================
-- E. Company news
-- =============================================================================
update public.player_companies set tier = 'small_business' where company_id = :'fco';
update public.player_companies set expansion_level = 1 where company_id = :'fco';
select tests.login_as('authenticated', :f);
select public.get_company_news(null, 3) as nf1 \gset
select public.get_company_news() as nf2 \gset
reset role;
select tests.assert(
  :'nf1'::jsonb ?& array['company', 'profile_words', 'items'] and jsonb_array_length(:'nf1'::jsonb -> 'items') = 3
  and :'nf1'::jsonb #> '{items,0}' ?& array['id', 'kind', 'payload', 'created_at', 'ai_headline', 'ai_body']
  and :'nf1'::jsonb #> '{items,0}' @> '{"kind": "expanded", "payload": {"level": 1}}'::jsonb
  and :'nf1'::jsonb #> '{items,1}' @> '{"kind": "upgraded", "payload": {"tier": "small_business"}}'::jsonb
  and (select array_agg(x ->> 'kind' order by o) from jsonb_array_elements(:'nf2'::jsonb -> 'items') with ordinality t(x, o))
      @> array['founded', 'hired', 'event_started', 'event_step_failed', 'event_step_done', 'event_solved']
  and :'nf2'::jsonb #> '{items,-1}' @> '{"kind": "founded", "payload": {"tier": "garage"}}'::jsonb,
  'get_company_news(): newest first with limit; founded, upgraded, expanded, hired and the event news');

-- =============================================================================
-- F. Texts written by Claude (service role only, validated, never overwritten)
-- =============================================================================
select tests.login_as('authenticated', :f);
select tests.throws(format('select public.store_company_event_text(%L, %L, %L, null)', :'ev', 'Titel', 'Text'), '42501',
  'authenticated cannot store AI texts');
select tests.throws(format('select public.store_company_ai_profile(%L, %L)', :'fco', '{}'), '42501',
  'authenticated cannot store an AI profile');
select public.company_ai_context() as ctx1 \gset
reset role;
select tests.assert(
  :'ctx1'::jsonb ?& array['company', 'has_profile', 'events_without_text', 'news_without_text']
  and :'ctx1'::jsonb -> 'company' = jsonb_build_object('id', :'fco'::uuid, 'name', 'Gegenwind Energie', 'idea', 'Ideen für alle',
                                                       'sector', 'energy', 'product_key', public.company_product(:'fco') ->> 'key')
  and not (:'ctx1'::jsonb ->> 'has_profile')::boolean
  and :'ctx1'::jsonb #> '{events_without_text,0}' = jsonb_build_object('id', :'ev'::uuid, 'archetype', 'regulation',
                                                                        'polarity', 'crisis', 'severity', 2, 'status', 'solved')
  and jsonb_array_length(:'ctx1'::jsonb -> 'news_without_text') = 5,
  'company_ai_context(): company, profile flag, events and the newest 5 news without text');

\set words '''{"product": ["Windrad"], "input": ["Stahl", "Kupfer"], "tax": ["Stromsteuer"], "rule": ["Abstandsregel"], "risk": ["Flaute"], "trend": ["Bürgerstrom"], "buyer": ["Stadtwerke"], "critic": ["Vogelschützer"], "place": ["Nordsee"]}'''
select tests.login_as('service_role');
select tests.assert(
  not public.store_company_ai_profile(:'fco', (:words::jsonb) - 'place')
  and not public.store_company_ai_profile(:'fco', (:words::jsonb) || '{"extra": ["x"]}')
  and not public.store_company_ai_profile(:'fco', jsonb_set(:words::jsonb, '{input}', '[]'))
  and not public.store_company_ai_profile(:'fco', jsonb_set(:words::jsonb, '{input}', '["a", "b", "c", "d", "e", "f"]'))
  and not public.store_company_ai_profile(:'fco', jsonb_set(:words::jsonb, '{input}', to_jsonb(array[repeat('x', 41)])))
  and not public.store_company_ai_profile(:'fco', jsonb_set(:words::jsonb, '{input}', '[1]'))
  and not public.store_company_ai_profile(:'fco', jsonb_set(:words::jsonb, '{critic}', '["Fuck"]'))
  and not public.store_company_ai_profile(:'fco', jsonb_set(:words::jsonb, '{critic}', to_jsonb(array['a' || chr(10) || 'b'])))
  and not public.store_company_ai_profile(gen_random_uuid(), :words::jsonb)
  and public.store_company_ai_profile(:'fco', :words::jsonb)
  and not public.store_company_ai_profile(:'fco', jsonb_set(:words::jsonb, '{product}', '["Solarpark"]')),
  'store_company_ai_profile(): all 9 slots with 1..5 strings of at most 40 characters, no blocked term or control character; once');
select tests.assert(
  not public.store_company_event_text(:'ev', repeat('x', 121), 'Text', null)
  and not public.store_company_event_text(:'ev', 'Titel', repeat('x', 601), null)
  and not public.store_company_event_text(:'ev', 'Titel', 'Text', repeat('x', 61))
  and not public.store_company_event_text(:'ev', 'Titel', 'So ein Wichser', null)
  and not public.store_company_event_text(:'ev', 'Titel' || chr(9), 'Text', null)
  and not public.store_company_event_text(:'ev', '', 'Text', null)
  and public.store_company_event_text(:'ev', 'Neue Abstandsregel trifft Gegenwind', 'Die Stadt will mehr Abstand.', 'Bürgerinitiative')
  and not public.store_company_event_text(:'ev', 'Zweiter Versuch', 'Anderer Text', null),
  'store_company_event_text(): headline 120, body 600, cause 60, no blocked term or control character; never overwritten');
select (select id from public.company_news where company_id = :'fco' and kind = 'founded') as nid \gset
select tests.assert(
  not public.store_company_news_text(:nid, repeat('x', 121), null)
  and not public.store_company_news_text(:nid, 'Fuck', null)
  and public.store_company_news_text(:nid, 'Gegenwind Energie startet', 'Aus der Garage ans Netz.')
  and not public.store_company_news_text(:nid, 'Nochmal', null),
  'store_company_news_text(): validated and stored once');
reset role;
select tests.login_as('authenticated', :f);
select public.get_company_event() as st12 \gset
select public.company_ai_context() as ctx2 \gset
select public.get_company_news() as nf3 \gset
reset role;
select tests.assert(
  :'st12'::jsonb -> 'profile_words' = :words::jsonb
  and :'st12'::jsonb #> '{event,ai_headline}' = '"Neue Abstandsregel trifft Gegenwind"'::jsonb
  and :'st12'::jsonb #> '{event,ai_cause}' = '"Bürgerinitiative"'::jsonb
  and (:'ctx2'::jsonb ->> 'has_profile')::boolean and :'ctx2'::jsonb -> 'events_without_text' = '[]'::jsonb
  and :'nf3'::jsonb -> 'profile_words' = :words::jsonb
  and :'nf3'::jsonb #> '{items,-1}' @> '{"kind": "founded", "ai_headline": "Gegenwind Energie startet", "ai_body": "Aus der Garage ans Netz."}'::jsonb,
  'stored texts show up in EVENT_STATE, the news and the AI context');

-- =============================================================================
-- G. Deadline with partial credit, in force, accept, over; chance missed; chance won
-- =============================================================================
select public.company_event_start(:'aco', 'special_tax', 1, now() - interval '25 hours') as ex \gset
select deadline_at as ex_deadline from public.player_company_events where id = :'ex' \gset
select tests.login_as('authenticated', :a);
select public.choose_event_strategy(gen_random_uuid(), :'ex', 'lobby') is not null as ok \gset
select public.start_event_step(gen_random_uuid(), :'ex') is not null as ok \gset
reset role;
select tests.m4h_force(:'ex', 10000);
select public.company_events_run_due(now() + interval '3 hours', false) is not null as ok \gset
select public.company_events_run_due(now() + interval '6 hours', false) is not null as ok \gset
select tests.assert(
  (select status = 'in_force' and abs(mitigation - 1.0 / 3 * 0.5) < 1e-9 from public.player_company_events where id = :'ex')
  and exists (select 1 from public.company_news n where n.company_id = :'aco' and n.kind = 'event_deadline'
                 and n.payload ->> 'event_id' = :'ex' and (n.payload ->> 'mitigation')::float8 = 0.1667),
  'deadline: partial credit = mitigation x finished steps / steps x 0.5 (1 of 3 -> 0.1667)');
select tests.login_as('authenticated', :a);
select public.start_event_step(gen_random_uuid(), :'ex') as sx1 \gset
select public.choose_event_strategy(gen_random_uuid(), :'ex', 'accept') as sx2 \gset
select tests.throws_key(format('select public.start_event_step(gen_random_uuid(), %L)', :'ex'), 'event_closed',
  'start_event_step(): not after accepting');
select tests.throws_key(format('select public.choose_event_strategy(gen_random_uuid(), %L, %L)', :'ex', 'lobby'), 'event_closed',
  'choose_event_strategy(): not after accepting');
reset role;
select tests.assert(
  :'sx1'::jsonb #>> '{event,status}' = 'in_force'
  and :'sx1'::jsonb #> '{event,steps,1}' @> '{"key": "experts", "status": "running"}'::jsonb
  and :'sx2'::jsonb #>> '{event,status}' = 'accepted' and :'sx2'::jsonb #>> '{event,strategy}' = 'accept'
  and (:'sx2'::jsonb #>> '{event,mitigation}')::float8 = 0.1667
  and :'sx2'::jsonb #> '{event,next}' = 'null'::jsonb
  and not exists (select 1 from public.company_event_steps where event_id = :'ex' and status = 'running'),
  'in force: steps are still allowed; accept sets accepted at once, a running step stops, the credit stays');
select public.company_events_run_due(:'ex_deadline'::timestamptz + interval '97 hours', false) is not null as ok \gset
select tests.assert(
  (select status = 'over' and over_at = :'ex_deadline'::timestamptz + interval '96 hours' from public.player_company_events where id = :'ex')
  and exists (select 1 from public.company_news n where n.company_id = :'aco' and n.kind = 'event_over'
                 and n.payload ->> 'event_id' = :'ex' and n.payload ->> 'status' = 'accepted'),
  'over: an accepted crisis ends lastsHours (96) after the deadline');

select public.company_event_start(:'aco', 'viral_trend', 1, now() - interval '13 hours') as ec \gset
select public.company_events_run_due(now(), false) is not null as ok \gset
select tests.login_as('authenticated', :a);
select public.get_company_event() as sc1 \gset
reset role;
select tests.assert(
  (select status = 'expired' and over_at = deadline_at from public.player_company_events where id = :'ec')
  and exists (select 1 from public.company_news n where n.company_id = :'aco' and n.kind = 'event_expired' and n.payload ->> 'event_id' = :'ec')
  and :'sc1'::jsonb -> 'event' = 'null'::jsonb
  and :'sc1'::jsonb #> '{history,0}' @> jsonb_build_object('id', :'ec'::uuid, 'archetype', 'viral_trend', 'status', 'expired')
  and jsonb_array_length(:'sc1'::jsonb -> 'history') = 5,
  'chance missed: expired at the deadline, news event_expired; EVENT_STATE event null, history newest first (max 5)');

select public.company_event_start(:'aco', 'award', 1, now()) as ew \gset
select tests.login_as('authenticated', :a);
select public.choose_event_strategy(gen_random_uuid(), :'ew', 'badge') is not null as ok \gset
select public.start_event_step(gen_random_uuid(), :'ew') is not null as ok \gset
reset role;
select public.company_events_run_due(now() + interval '2 hours', false) is not null as ok \gset
select resolved_at as ew_res from public.player_company_events where id = :'ew' \gset
select tests.assert(
  (select status = 'solved' and mitigation = 0.5 from public.player_company_events where id = :'ew')
  and abs((public.company_event_hour_effect(:'aco', :'ew_res'::timestamptz + interval '1 hour', :'ew_res'::timestamptz + interval '2 hours')
           ->> 'demand_factor')::float8 - 1.075) < 1e-9
  and exists (select 1 from public.notifications x where x.player_id = :a and x.title = 'Chance genutzt: Krisenfest Werk'),
  'chance won: the effect counts with the strategy''s strength (badge 0.5: demand x 1.075) for lastsHours');
select public.company_events_run_due(:'ew_res'::timestamptz + interval '73 hours', false) is not null as ok \gset
select tests.assert(
  (select status = 'over' and over_at = :'ew_res'::timestamptz + interval '72 hours' from public.player_company_events where id = :'ew'),
  'chance won: over lastsHours (72) after the success');

-- =============================================================================
-- H. Hourly close: no event, demand and costs (regulation), capacity (strike), running steps; record hour
-- =============================================================================
select tests.m4h_found(:h, 'Taktgeber Strom', 'energy') as hco \gset
update public.player_companies set potential_annual_cents = round(1200000 / :mf_garage), awareness = 0.5, quality = 1,
       contract_work = false where company_id = :'hco';
select starts_at as qs from public.game_quarters where quarter = 2 order by ends_at desc limit 1 \gset
select public.player_company_close_hour(:'hco', :'qs'::timestamptz) is not null as ok \gset
select * from public.player_company_hours where company_id = :'hco' and hour_start = :'qs'::timestamptz \gset h0_
select tests.assert(
  :h0_demand_cents::bigint = 25000
  and (select event_id is null from public.player_company_hours where company_id = :'hco' and hour_start = :'qs'::timestamptz) and :h0_profit_cents::bigint > 0
  and (select best_hour_profit_cents from public.player_companies where company_id = :'hco') = :h0_profit_cents::bigint
  and tests.m4h_news(:'hco', 'record_hour') = 0,
  'close_hour(): without an event as before (demand 25 000); the first profitable hour sets the best hour without news');

select public.company_event_start(:'hco', 'regulation', 1, :'qs'::timestamptz + interval '1 hour' - interval '31 hours') as hr \gset
select public.player_company_close_hour(:'hco', :'qs'::timestamptz + interval '1 hour') is not null as ok \gset
select * from public.player_company_hours where company_id = :'hco' and hour_start = :'qs'::timestamptz + interval '1 hour' \gset h1_
select tests.assert(
  :h1_demand_cents::bigint = 22000 and :h1_capacity_cents::bigint = :h0_capacity_cents::bigint and :'h1_event_id' = :'hr'
  and abs(:h1_cogs_cents::bigint
          - round(least(:h1_demand_cents::numeric, :h1_capacity_cents::numeric) * (1 - :margin_energy::numeric)
                  + :h1_revenue_cents::numeric * 0.06)) <= 1,
  'close_hour(): a crisis in force (regulation) cuts demand by 12 % and adds 6 % of the revenue to the goods; event_id stored');

update public.player_company_events set status = 'over' where id = :'hr';
select public.company_event_start(:'hco', 'strike', 1, :'qs'::timestamptz + interval '2 hours' - interval '20 hours') as hs \gset
select public.player_company_close_hour(:'hco', :'qs'::timestamptz + interval '2 hours') is not null as ok \gset
select * from public.player_company_hours where company_id = :'hco' and hour_start = :'qs'::timestamptz + interval '2 hours' \gset h2_
select tests.assert(
  :h2_demand_cents::bigint = 25000 and abs(:h2_capacity_cents::bigint - round(:h0_capacity_cents::numeric * 0.65)) <= 1
  and :'h2_event_id' = :'hs',
  'close_hour(): a strike in force cuts the capacity by 35 %');
insert into public.company_event_steps (event_id, idx, strategy, key, status, started_at, ends_at, success_bps, capacity_hit)
values (:'hs', 0, 'bonus', 'pay_bonus', 'running', :'qs'::timestamptz + interval '3 hours 30 minutes',
        :'qs'::timestamptz + interval '5 hours', 10000, 0.4);
select tests.assert(
  abs((public.company_event_hour_effect(:'hco', :'qs'::timestamptz + interval '3 hours', :'qs'::timestamptz + interval '4 hours')
       ->> 'capacity_factor')::float8 - 0.65 * (1 - 0.4 * 0.5)) < 1e-9,
  'hour effect: a running step ties up its capacity share for the part of the hour it runs');
delete from public.company_event_steps where event_id = :'hs';
delete from public.player_company_events where company_id = :'hco';
select tests.assert(
  (select event_id is null from public.player_company_hours where company_id = :'hco' and hour_start = :'qs'::timestamptz + interval '2 hours'),
  'player_company_hours.event_id is cleared when an event row goes');

-- record hour: news when an earlier best is beaten, one item per Berlin day
update public.player_companies set best_hour_profit_cents = 1 where company_id = :'hco';
select public.player_company_close_hour(:'hco', :'qs'::timestamptz + interval '3 hours') is not null as ok \gset
select profit_cents as p3 from public.player_company_hours where company_id = :'hco' and hour_start = :'qs'::timestamptz + interval '3 hours' \gset
update public.player_companies set best_hour_profit_cents = 2 where company_id = :'hco';
select public.player_company_close_hour(:'hco', :'qs'::timestamptz + interval '4 hours') is not null as ok \gset
select profit_cents as p4 from public.player_company_hours where company_id = :'hco' and hour_start = :'qs'::timestamptz + interval '4 hours' \gset
select tests.assert(
  :p3::bigint > 2 and tests.m4h_news(:'hco', 'record_hour') = 1
  and (select payload = jsonb_build_object('profit_cents', :p4::bigint, 'hour_start', :'qs'::timestamptz + interval '4 hours')
         from public.company_news where company_id = :'hco' and kind = 'record_hour')
  and (select best_hour_profit_cents from public.player_companies where company_id = :'hco') = :p4::bigint,
  'record_hour: news when a new best hour beats an earlier one, at most one item per Berlin day (payload updated)');

-- =============================================================================
-- I. Listed company: share shock on announcement and solution
-- =============================================================================
select tests.m4h_found(:l, 'Kursrutsch Werke', 'energy') as lco \gset
insert into public.securities (kind, ticker, name, company_id, sector_key, status, listed_at)
values ('stock', 'KRSWX', 'Kursrutsch Werke', :'lco', 'energy', 'listed', now()) returning id as lsec \gset
insert into public.security_quotes (security_id, last_price_e4, bid_e4, ask_e4, prev_close_e4, day_open_e4, day_high_e4, day_low_e4,
                                    market_cap_cents)
values (:'lsec', 100000, 99500, 100500, 100000, 100000, 100000, 100000, 1000000000);
insert into public.security_sim_state (security_id, fair_value_e4, ema_fast, ema_slow) values (:'lsec', 100000, 100000, 100000);
update public.companies set security_id = :'lsec', ticker = 'KRSWX', tier = 'penny', phase = 'listed', shares_outstanding = 1000000
 where id = :'lco';
select tests.assert(
  exists (select 1 from public.company_news n where n.company_id = :'lco' and n.kind = 'ipo' and n.payload = '{"ticker": "KRSWX"}'::jsonb),
  'news ipo {ticker} when the company is listed');
select public.company_event_start(:'lco', 'quality_scandal', 2, now()) as el \gset
select tests.assert(
  (select announce_shock_bps = -900 from public.player_company_events where id = :'el')
  and (select last_price_e4 = 91000 and bid_e4 = 90545 and ask_e4 = 91455 and day_low_e4 = 91000 and change_bps = -900
              and market_cap_cents = 910000000
         from public.security_quotes where security_id = :'lsec')
  and (select fair_value_e4 = 91000 and abs(ema_fast - 91000) < 1e-6 and abs(ema_slow - 91000) < 1e-6
         from public.security_sim_state where security_id = :'lsec')
  and exists (select 1 from public.company_news n where n.company_id = :'lco' and n.kind = 'event_started'
                 and (n.payload ->> 'share_shock_bps')::int = -900),
  'listed: a crisis (severity 2) moves price, quote, market cap, fair value and EMAs by -9 %');
select tests.login_as('authenticated', :l);
select public.choose_event_strategy(gen_random_uuid(), :'el', 'pr_offensive') is not null as ok \gset
select public.start_event_step(gen_random_uuid(), :'el') is not null as ok \gset
reset role;
select tests.m4h_force(:'el', 10000);
select public.company_events_run_due(now() + interval '2 hours', false) is not null as ok \gset
select tests.login_as('authenticated', :l);
select public.start_event_step(gen_random_uuid(), :'el') is not null as ok \gset
reset role;
select tests.m4h_force(:'el', 10000);
select public.company_events_run_due(now() + interval '6 hours', false) is not null as ok \gset
select tests.assert(
  (select status = 'solved' and mitigation = 0.6 and resolution_shock_bps = 540 from public.player_company_events where id = :'el')
  and (select last_price_e4 = 95914 from public.security_quotes where security_id = :'lsec')
  and (select fair_value_e4 = 95914 from public.security_sim_state where security_id = :'lsec')
  and exists (select 1 from public.company_news n where n.company_id = :'lco' and n.kind = 'event_solved'
                 and (n.payload ->> 'share_shock_bps')::int = 540),
  'listed: solving wins back size x mitigation (900 x 0.6 = +5.4 %)');
-- keep the market snapshot of the fixtures at the 15 AI stocks
update public.securities set status = 'delisted', delisted_at = now() where id = :'lsec';

-- =============================================================================
-- J. A company that ends: its event ends silently; ledger and grants
-- =============================================================================
select public.company_event_start(:'aco', 'strike', 1, now()) as ed \gset
update public.player_companies set status = 'dissolved', dissolved_at = now() where company_id = :'aco';
select public.company_events_run_due(now(), false) is not null as ok \gset
select tests.assert(
  (select status = 'over' from public.player_company_events where id = :'ed')
  and not exists (select 1 from public.company_news n where n.payload ->> 'event_id' = :'ed' and n.kind = 'event_over'),
  'a dissolved company: its event ends without news');
select tests.assert(
  (select prosrc ~ 'company_events_run_due' from pg_proc where oid = 'public.run_due_jobs()'::regprocedure)
  and not has_function_privilege('authenticated', 'public.company_events_run_due(timestamptz, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.company_event_roll(uuid, timestamptz, double precision[])', 'execute')
  and not has_function_privilege('authenticated', 'public.store_company_news_text(bigint, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.store_company_news_text(bigint, text, text)', 'execute')
  and not exists (select 1 from public.ledger_audit()),
  'run_due_jobs() runs company_events_run_due(); internal functions and AI storage are not for players; ledger audit clean');

select tests.set_cfg('startups', '{demandNoise}', :'noise0'::jsonb);
