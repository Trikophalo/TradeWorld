-- =============================================================================
-- b8 · Company economy overhaul (ADR-180): the TS rules and SQL agree; an AI worker pays for itself when there is
--      demand and costs only the standby share without; awareness moves every hour and marketing shows; the
--      autopilot resolves tasks with the mood rule, logs them and sends a morning summary; task pay grows with the
--      strengths; the money invariant holds.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
-- ADR-183: the reputation moves the demand of every company; the exact numbers here assume it stays neutral
select tests.set_cfg('companyHealth', '{reputation,demandMaxEffect}', '0') is null as rep_neutral \gset
-- the current company scale (ADR-180), whatever earlier files left behind
select tests.set_cfg('startups', '{marketFactorByTier}', '{"garage": 10, "small_business": 40, "gmbh": 150, "ag": 400}') is null as ok \gset
select tests.set_cfg('startups', '{capacityCentsPerProductivity}',
  '{"tech": 450000, "retail": 375000, "energy": 375000, "pharma": 450000, "logistics": 375000}') is null as ok \gset
select tests.set_cfg('startups', '{aiWorkerStandbyBps}', '2500') is null as ok \gset
-- ADR-188: the awareness model of src/config/balance.ts
select tests.set_cfg('startups', '{awareness}',
  '{"initial": 0.03, "min": 0.02, "cap": {"byTier": {"garage": 0.6, "small_business": 0.7, "gmbh": 0.8, "ag": 0.9},
    "perStage": 0.05, "perExpansionLevel": 0.03, "max": 1}, "marketingMaxRatePerHour": 0.06,
    "marketingHalfSaturationShare": 0.01, "marketingMinHalfSaturationCents": 50000, "wordOfMouthPerHour": 0.008,
    "decayPerHour": 0.004, "taskGain": 0.005, "taskAiShareBps": 5000}') is null as ok \gset

-- ---------------------------------------------------------------------------
-- 1. Pure rules: the same numbers as src/lib/sim/startup.ts (awarenessHour, aiUtilizationBps, aiWageDueCents)
-- ---------------------------------------------------------------------------
-- ADR-188: the same numbers as src/lib/sim/awareness.test.ts ("SQL: the same step")
select tests.assert(tests.near((public.company_awareness_step(0.2, 0.6, 0.5, 1.5, 10000, 1e7, 0.8, 70) ->> 'next')::double precision,
                               0.21390690909090912)
                and tests.near((public.company_awareness_step(0.2, 0.6, 0.5, 1.5, 10000, 1e7, 0.8, 70) ->> 'marketing')::double precision,
                               0.01309090909090909),
  'company_awareness_step(): same result as awarenessHour (TS)');
select tests.assert(public.company_ai_utilization_bps(200, 300, 2, 3) = 5000
                and public.company_ai_utilization_bps(250, 300, 2, 3) = 7500
                and public.company_ai_utilization_bps(50, 300, 2, 3) = 0,
  'company_ai_utilization_bps(): founder serves first, AI workers the rest');
select tests.assert(public.company_ai_wage_due_cents(3, 0) = 9000 and public.company_ai_wage_due_cents(3, 7057) = 25405
                and public.company_ai_wage_due_cents(3, 10000) = 36000,
  'company_ai_wage_due_cents(): full wage for used capacity, at least the standby share');
-- every sector: an AI worker's capacity x gross margin is more than its wage
select tests.assert(bool_and((public.config_double('startups', array['capacityCentsPerProductivity', s], 0)
                              / public.config_double('time', '{quarterHours}', 6))
                             * public.config_double('startups', array['grossMargin', s], 0)
                             > public.config_double('startups', '{aiWorkerWageCentsPerHour}', 12000)),
  'balance: a busy AI worker earns more than its wage in every sector')
  from unnest(array['tech', 'retail', 'energy', 'pharma', 'logistics']) s;

-- ---------------------------------------------------------------------------
-- 2. Two companies run one hour each
-- ---------------------------------------------------------------------------
\set a '''0b8c0b8c-0000-4000-8000-0000000008a1'''
\set b '''0b8c0b8c-0000-4000-8000-0000000008b2'''
select tests.signup(:a, 'Ov_Laut') is not null and tests.signup(:b, 'Ov_Leise') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 20);
select tests.set_level(:b, 20);
select tests.fund(:a, 90000000, 'test:b8:a');
select tests.fund(:b, 90000000, 'test:b8:b');
select coalesce(value -> 'demandNoise', '0.1') as noise0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{demandNoise}', '0');

select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Laut Handel', 'Viel Werbung', 'retail', '#224466', 'small_business') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.found_company(gen_random_uuid(), 'Leise Handel', 'Ohne Werbung', 'retail', '#446622', 'small_business') is not null as ok \gset
reset role;
select tests.company_of(:a) as aco \gset
select tests.company_of(:b) as bco \gset
select tests.set_company_cash(:'aco', 5000000);
select tests.set_company_cash(:'bco', 5000000);
select tests.login_as('authenticated', :a);
select public.hire_ai_workers(gen_random_uuid(), 3) is not null as ok \gset
select public.set_company_marketing(gen_random_uuid(), 50000) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.hire_ai_workers(gen_random_uuid(), 3) is not null as ok \gset
reset role;

-- A: a large market and good awareness (the AI workers are needed); B: tiny awareness (they idle)
update public.player_companies set potential_annual_cents = 50000000, awareness = 0.3, quality = 0.5 where company_id = :'aco';
update public.player_companies set potential_annual_cents = 1000000, awareness = 0.01, quality = 0.5 where company_id = :'bco';
select date_trunc('hour', public.game_now()) - interval '1 hour' as h0 \gset
update public.player_companies set last_hour_at = :'h0' where company_id in (:'aco', :'bco');
select public.player_company_close_hour(:'aco', :'h0') is not null as ok \gset
select public.player_company_close_hour(:'bco', :'h0') is not null as ok \gset

select tests.assert((select ai_utilization_bps from public.player_company_hours where company_id = :'aco' and hour_start = :'h0') = 10000
                and (select ai_wages_due_cents from public.player_company_hours where company_id = :'aco' and hour_start = :'h0') = 36000,
  'close_hour: with demand the AI workers are fully used and earn their full wage');
select tests.assert((select ai_utilization_bps from public.player_company_hours where company_id = :'bco' and hour_start = :'h0') = 0
                and (select ai_wages_due_cents from public.player_company_hours where company_id = :'bco' and hour_start = :'h0') = 9000,
  'close_hour: without demand ("zu wenig Nachfrage") idle AI workers cost only the standby share');
select tests.assert((select profit_cents from public.player_company_hours where company_id = :'aco' and hour_start = :'h0') > 0,
  'close_hour: a well-known small business with busy AI workers makes a profit');

select tests.assert((select (awareness_parts ->> 'marketing')::double precision > 0
                       from public.player_company_hours where company_id = :'aco' and hour_start = :'h0'),
  'close_hour: marketing shows in the hour as its own awareness part');
select tests.assert((select (awareness_parts ->> 'marketing')::double precision = 0
                       from public.player_company_hours where company_id = :'bco' and hour_start = :'h0'),
  'close_hour: without marketing the marketing part is 0');
select tests.assert((select awareness from public.player_companies where company_id = :'aco')
                    = (select awareness_after from public.player_company_hours where company_id = :'aco' and hour_start = :'h0'),
  'close_hour: the company keeps the new awareness at once (no waiting for the quarter)');

-- ---------------------------------------------------------------------------
-- 3. Task pay with the strengths, awareness from tasks
-- ---------------------------------------------------------------------------
insert into public.company_strengths (company_id, scores, hours)
values (:'aco', '{"awareness": 0, "quality": 0, "delivery": 0, "margin": 0, "team": 0, "finance": 0}', 1)
on conflict (company_id) do update set scores = excluded.scores;
select tests.assert(public.company_task_pay_factor_bps(:'aco') = 9000, 'task pay: overall 0 pays 0.9x');
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, created_at, due_at, done_by)
values (:'aco', 'pay_invoices', 'finance', 'sort', 100000, public.game_now(), public.game_now() + interval '30 minutes', :a);
select max(id) as t1 from public.company_tasks where company_id = :'aco' \gset
select awareness as aw_before from public.player_companies where company_id = :'aco' \gset
select (public.company_task_resolve(:t1, 10000, false) ->> 'result_cents')::bigint as r1 \gset
select tests.assert(:r1 = 90000 - 0 + public.apply_bps(90000, public.company_upgrade_bps(:'aco', 'task_pay')) or :r1 = 90000,
  'task pay: a perfect task at overall 0 pays 90 % of its value');
select tests.assert((select awareness from public.player_companies where company_id = :'aco') > :aw_before
                    or :aw_before >= 0.7,
  'task: a solved task adds awareness at once');
update public.company_strengths set scores = '{"awareness": 100, "quality": 100, "delivery": 100, "margin": 100, "team": 100, "finance": 100}'
 where company_id = :'aco';
select tests.assert(public.company_task_pay_factor_bps(:'aco') = 15000, 'task pay: overall 100 pays 1.5x');
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, created_at, due_at, done_by)
values (:'aco', 'pay_invoices', 'finance', 'sort', 100000, public.game_now(), public.game_now() + interval '30 minutes', :a);
select max(id) as t2 from public.company_tasks where company_id = :'aco' \gset
select (public.company_task_resolve(:t2, 10000, false) ->> 'result_cents')::bigint as r2 \gset
select tests.assert(:r2 * 9000 = :r1 * 15000, 'task pay: the same task pays 1.5 / 0.9 more in a strong company');

-- ---------------------------------------------------------------------------
-- 4. Autopilot
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :a);
select public.set_company_autopilot(gen_random_uuid(), true) as ap \gset
reset role;
select tests.assert((:'ap'::jsonb ->> 'on')::boolean and (:'ap'::jsonb ->> 'chance_bps')::int = 12000,
  'set_company_autopilot(): on; the best mood (Team 100) gives 120 %');
select tests.signup('0b8c0b8c-0000-4000-8000-0000000008c3', 'Ov_Ohne') is not null as ok \gset
select tests.login_as('authenticated', '0b8c0b8c-0000-4000-8000-0000000008c3');
select tests.throws_key($$select public.set_company_autopilot(gen_random_uuid(), true)$$, 'company_not_found',
                        'set_company_autopilot(): only a founder') is null as ok \gset
reset role;

-- a task that waited long enough, and one that is too fresh (people get the first minutes)
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, created_at, due_at)
values (:'aco', 'customer_mail', 'sales', 'sort', 100000, public.game_now() - interval '10 minutes', public.game_now() + interval '30 minutes'),
       (:'aco', 'coffee_order', 'management', 'count', 100000, public.game_now(), public.game_now() + interval '30 minutes');
select public.company_autopilot_run() as run1 \gset
select tests.assert((select count(*) from public.company_autopilot_log where company_id = :'aco') = 1
                and (select status from public.company_tasks where company_id = :'aco' and task_key = 'coffee_order'
                      order by id desc limit 1) = 'open',
  'autopilot: takes the task that waited, leaves the fresh one to the people');
-- 120 %: always a success, 70 % of the value x 1.2 x the strengths pay 1.5
select tests.assert((select success and chance_bps = 12000
                            and result_cents = ((100000::bigint * 7000 / 10000) * 12000 / 10000) * 15000 / 10000
                                             + public.apply_bps(((100000::bigint * 7000 / 10000) * 12000 / 10000) * 15000 / 10000,
                                                                public.company_upgrade_bps(:'aco', 'task_pay'))
                       from public.company_autopilot_log where company_id = :'aco'),
  'autopilot: 120 % is a sure success and pays 70 % x 1.2 of the value (x the strengths)');

-- the worst mood: 60 %; a failure costs failPenaltyBps
update public.company_strengths set scores = jsonb_set(scores, '{team}', '0') where company_id = :'aco';
select tests.assert(public.company_autopilot_chance_bps(:'aco') = 6000, 'autopilot: the worst mood gives 60 %');
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, created_at, due_at)
select :'aco', 'customer_mail', 'sales', 'sort', 100000, public.game_now() - interval '10 minutes', public.game_now() + interval '30 minutes'
  from generate_series(1, 12);
select public.company_autopilot_run() is not null as ok \gset
select tests.assert((select bool_and(chance_bps = 6000 and case when success then result_cents > 0 else result_cents >= -30000 end)
                       from public.company_autopilot_log where company_id = :'aco' and chance_bps = 6000)
                and (select count(*) from public.company_autopilot_log where company_id = :'aco' and chance_bps = 6000) = 12,
  'autopilot: at 60 % every task is logged; failures cost at most failPenaltyBps of the value');

-- the daily cap
select tests.assert((select count(*) from public.company_autopilot_log where company_id = :'aco')
                    <= public.cfg_num(public.company_tasks_cfg(), '{autopilot,maxPerDay}', 24),
  'autopilot: never more than maxPerDay tasks a day');

-- the morning summary, once per day
select (date_trunc('day', public.game_now() at time zone 'Europe/Berlin') + interval '1 day 8 hours') at time zone 'Europe/Berlin' as morning \gset
update public.company_autopilot set enabled_at = public.game_now() - interval '1 hour' where company_id = :'aco';
update public.company_autopilot_log set at = :'morning'::timestamptz - interval '3 hours' where company_id = :'aco';
select public.company_autopilot_run(:'morning') is not null as ok \gset
select count(*) as n1 from public.notifications where player_id = :a and type_key = 'company_autopilot' \gset
select public.company_autopilot_run(:'morning'::timestamptz + interval '5 minutes') is not null as ok \gset
select tests.assert(:n1 >= 1 and (select count(*) from public.notifications where player_id = :a and type_key = 'company_autopilot') = :n1
                and (select title from public.notifications where player_id = :a and type_key = 'company_autopilot'
                      order by created_at desc limit 1) like 'Autopilot: %',
  'autopilot: a morning summary for the founder, once per day');

select tests.login_as('authenticated', :a);
select public.get_company_autopilot() as st \gset
reset role;
select tests.assert(jsonb_array_length(:'st'::jsonb -> 'log') > 0 and (:'st'::jsonb -> 'last_hour') is not null
                and (:'st'::jsonb #>> '{last_hour,ai_utilization_bps}') is not null,
  'get_company_autopilot(): the log and the last hour with its AI and awareness parts');

-- ---------------------------------------------------------------------------
-- 5. New task games: the solution scores full marks on the server too
-- ---------------------------------------------------------------------------
select tests.assert(bool_and(public.company_task_grade(g, z -> 'solution',
                               case g when 'receipts' then jsonb_build_object('picked', z -> 'solution' -> 'picked')
                                      else z -> 'solution' end) = 10000),
  'new task games: every generated puzzle is solvable with full marks')
  from (select g, public.company_task_puzzle(jsonb_build_object('game', g)) z
          from unnest(array['restock', 'receipts', 'offer', 'pattern', 'shelf']) g, generate_series(1, 10)) s;
select tests.assert(public.company_task_grade('receipts', '{"amounts": [10, 20, 30], "target": 30, "step_bps": 500, "picked": [2]}',
                                              '{"picked": [1]}') = 5000
                and public.company_task_grade('offer', '{"choices": [0, 1, 2]}', '{"choices": [0, 1, 0]}') = 6666
                and public.company_task_grade('restock', '{"values": [4, 5]}', '{"values": [4, 6]}') = 7500,
  'new task games: the same partial scores as gradeMore (TS)');

-- ---------------------------------------------------------------------------
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after the overhaul checks');
update public.company_autopilot set enabled = false where company_id = :'aco';
select tests.set_cfg('startups', '{demandNoise}', :'noise0'::jsonb);
