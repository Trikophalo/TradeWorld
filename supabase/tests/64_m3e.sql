-- =============================================================================
-- 64 · M3e: hex skill map, quit notice, automatic work, AI offers, postings with
--      concrete skills, products / growth stages / trainings, employer view
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''0e3e3e3e-0000-4000-8000-0000000000f1'''
\set w '''0e3e3e3e-0000-4000-8000-0000000000f2'''
\set a '''0e3e3e3e-0000-4000-8000-0000000000f3'''
select tests.signup(:f, 'Frieda_Format') is not null and tests.signup(:w, 'Walter_Weg') is not null
   and tests.signup(:a, 'Anke_Angebot') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 10);
select tests.set_level(:w, 6);
select tests.set_level(:a, 6);
select tests.fund(:f, 5000000, 'test:m3e:f');

-- =============================================================================
-- A. Hex skill map (ADR-061)
-- =============================================================================
select tests.give_points(:a, 20);
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.learn_skill(gen_random_uuid(), 'it_networks')$$, 'skill_locked',
  'learn_skill(): a skill whose prerequisite is not learned is locked');
select tests.throws_key($$select public.learn_skill(gen_random_uuid(), 'it_programming')$$, 'skill_locked',
  'learn_skill(): programming needs the IT basics (ADR-115)');
select public.learn_skill(gen_random_uuid(), 'it_basics') is not null as ok \gset
select public.learn_skill(gen_random_uuid(), 'it_programming') -> 'learned' as l1 \gset
select tests.throws_key($$select public.learn_skill(gen_random_uuid(), 'it_ml')$$, 'skill_locked',
  'learn_skill(): a learned neighbour that is not the prerequisite opens nothing (it_ml needs it_data)');
select public.learn_skill(gen_random_uuid(), 'it_networks') ->> 'learned_key' as l2 \gset
select tests.throws_key($$select public.learn_skill(gen_random_uuid(), 'it_mobile')$$, 'skill_locked',
  'learn_skill(): two steps ahead is still locked');
select tests.throws_key($$select public.learn_skill(gen_random_uuid(), 'hybrid_fintech')$$, 'skill_locked',
  'learn_skill(): a hybrid needs its prerequisites from both areas');
reset role;
select tests.assert(
  jsonb_array_length(:'l1'::jsonb) = 2 and :'l2' = 'it_networks'
  and (select count(*) = 168 and bool_and(n ? 'q' and n ? 'r' and n ? 'requires')
              and count(*) filter (where jsonb_array_length(n -> 'requires') = 0) = 8
         from jsonb_array_elements(public.config_jsonb('skills', '{tree}')) n)
  and public.skill_reachable(:a, 'it_architecture') and not public.skill_reachable(:a, 'it_databases')
  and public.skill_reachable(:a, 'finance_basics') and not public.skill_reachable(:a, 'finance_accounting'),
  'skill map: only the 8 basics are open, every other skill needs its prerequisites (it_basics -> it_programming -> it_networks)');
select tests.assert(
  (select public.skill_node('it_programming') ? 'requires'),
  'the tree in game_config carries the prerequisites');

-- =============================================================================
-- D. AI employers offer their maximum (ADR-064)
-- =============================================================================
select tests.login_as('authenticated', :a);
select x ->> 'id' as aip, (x ->> 'max_salary_cents_per_hour')::bigint as aimax
  from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where (x -> 'company' ->> 'is_ai')::boolean and (x ->> 'eligible')::boolean order by x ->> 'id' limit 1 \gset
select public.apply_for_job(gen_random_uuid(), :'aip', null, null) as aiapp \gset
select tests.throws_key(format($$select public.counter_offer(gen_random_uuid(), %L, 1)$$, :'aiapp'::jsonb ->> 'id'),
  'invalid_argument', 'counter_offer(): not at AI employers');
select public.sign_contract(gen_random_uuid(), (:'aiapp'::jsonb ->> 'id')::uuid, 'M1 1') is not null as ok \gset
select public.get_employer() as aemp \gset
select public.get_work_task() as awt \gset
select public.get_my_job() -> 'job' as aj \gset
reset role;
select tests.assert(
  (:'aiapp'::jsonb ->> 'offer_salary_cents_per_hour')::bigint = :aimax
  and (:'aiapp'::jsonb ->> 'salary_wish_cents_per_hour')::bigint = :aimax and :'aiapp'::jsonb ->> 'status' = 'offered',
  'apply_for_job(): AI employers offer the personal ceiling, no wish needed');
select tests.assert(
  :'aemp'::jsonb -> 'employer' ->> 'kind' = 'ai' and :'aemp'::jsonb -> 'employer' -> 'tier' = 'null'::jsonb
  and :'aemp'::jsonb -> 'employer' -> 'company' ->> 'ticker' is not null
  and (:'aemp'::jsonb -> 'employer' ->> 'team_size')::int >= 1 and (:'aemp'::jsonb -> 'employer' ->> 'pay_factor_bps')::int = 10000
  and (:'aemp'::jsonb -> 'employer') ?& array['company', 'kind', 'product_key', 'stage', 'tier', 'founder', 'team_size',
                                             'last_quarter', 'pay_factor_bps'],
  'get_employer(): AI employer with ticker, players working there, pay factor 100 %');
select tests.assert(
  :'awt'::jsonb = '{"task": null, "next_task_at": null}'::jsonb
  and not (:'aj'::jsonb ->> 'work_task_open')::boolean and :'aj'::jsonb -> 'next_work_task_at' = 'null'::jsonb
  and (:'aj'::jsonb ->> 'quit_cost_cents')::bigint = 0 and :'aj'::jsonb -> 'notice_ends_at' = 'null'::jsonb
  and not exists (select 1 from public.player_work_tasks where player_id = :a),
  'automatic work (ADR-064): no new work tasks; get_my_job: no task, no quit cost');
-- old open tasks can still be answered
insert into public.player_work_tasks (player_id, player_job_id, kind, params, correct_index, status, started_at, expires_at)
select :a, j.id, 'finance_choice', '{"amount_cents": 1000000, "years": 1, "offers": [{"rate_bps": 100, "fee_cents": 0}, {"rate_bps": 900, "fee_cents": 0}]}',
       0, 'started', now(), now() + interval '1 hour'
  from public.player_jobs j where j.player_id = :a and j.status = 'active';
select id as oldtask from public.player_work_tasks where player_id = :a \gset
select tests.login_as('authenticated', :a);
select (public.submit_work_task(gen_random_uuid(), :'oldtask', 0) ->> 'correct')::boolean as oldok \gset
reset role;
select tests.assert(:'oldok'::boolean, 'submit_work_task(): old open tasks still work');

-- quit with notice ----------------------------------------------------------------------------
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.cancel_quit(gen_random_uuid())$$, 'invalid_argument', 'cancel_quit(): no notice given');
select public.quit_job(gen_random_uuid()) ->> 'notice_ends_at' as an \gset
select public.quit_job(gen_random_uuid()) ->> 'notice_ends_at' as an2 \gset
select public.apply_for_job(gen_random_uuid(),
  (select x ->> 'id' from jsonb_array_elements(public.get_job_board() -> 'postings') x
    where (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean and x ->> 'id' <> :'aip'
    order by x ->> 'id' limit 1)::uuid, null, null) ->> 'id' as aapp2 \gset
select tests.throws_key(format($$select public.sign_contract(gen_random_uuid(), %L, 'M1 1')$$, :'aapp2'), 'job_active_exists',
  'sign_contract(): not during the notice');
reset role;
select tests.cash(:a) as ac0 \gset
update public.player_jobs set last_paid_at = now() - interval '2 hours', paid_day = (now() at time zone 'Europe/Berlin')::date,
       paid_minutes_today = 0, notice_ends_at = now() - interval '1 hour'
 where player_id = :a and status = 'active';
select public.process_quit_notices() as pn \gset
select tests.assert(
  (:'an')::timestamptz between now() + interval '23 hours' and now() + interval '25 hours' and :'an' = :'an2'
  and :pn::int >= 1
  and (select status = 'ended' and end_reason = 'quit' and ended_at < now() - interval '59 minutes'
         from public.player_jobs where player_id = :a order by started_at desc limit 1)
  and tests.cash(:a) = :ac0::bigint + (select salary_cents_per_hour from public.player_jobs where player_id = :a order by started_at desc limit 1),
  'quit_job(): one day notice; wages run until the end of the notice (1 of 2 hours here), then the job ends without a payment');

-- =============================================================================
-- E/F. Company with a product, postings with concrete skills, stages, trainings
-- =============================================================================
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Frieda Apps', 'Apps', 'tech', '#334455', 'garage', 'teleporter')$$,
  'invalid_argument', 'found_company(): unknown product');
select public.found_company(gen_random_uuid(), 'Frieda Apps', 'Apps für Vereine', 'tech', '#334455', 'garage', 'mobile_app') -> 'company' as fc \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.assert(
  :'fc'::jsonb ->> 'product_key' = 'mobile_app' and (:'fc'::jsonb ->> 'stage')::int = 0
  and jsonb_array_length(:'fc'::jsonb -> 'stages') = 4
  and :'fc'::jsonb -> 'stages' -> 0 = '{"stage": 1, "reached": false, "skills": [{"key": "it_programming", "covered_by": null, "covered_by_ai": false}]}'::jsonb
  and (select bool_and(jsonb_array_length(s -> 'skills') >= 1) from jsonb_array_elements(:'fc'::jsonb -> 'stages') s),
  'found_company(p_product): product, stage 0 and the skills of the four stages');

select tests.login_as('authenticated', :f);
select tests.throws_key(format($$select public.create_job_posting(gen_random_uuid(), %L, 'intern', 'Mobil', '[{"branch": "it", "min_score": 0}]', 15000, 1, '{it_a,it_b,it_c,it_d,it_e}')$$, :'fco'),
  'invalid_argument', 'create_job_posting(): at most 4 skills');
select tests.throws_key(format($$select public.create_job_posting(gen_random_uuid(), %L, 'intern', 'Mobil', '[{"branch": "it", "min_score": 0}]', 15000, 1, '{flying}')$$, :'fco'),
  'invalid_argument', 'create_job_posting(): unknown skill');
select public.create_job_posting(gen_random_uuid(), :'fco', 'intern', 'Mobil-Entwicklung', '[{"branch": "it", "min_score": 0}]',
  15000, 1, '{it_basics}') as post \gset
reset role;
select tests.login_as('authenticated', :w);
select (select x from jsonb_array_elements(public.get_job_board() -> 'postings') x where x ->> 'id' = :'post'::jsonb ->> 'id') as wb1 \gset
select tests.throws_key(format($$select public.apply_for_job(gen_random_uuid(), %L, 15000, null)$$, :'post'::jsonb ->> 'id'),
  'job_skills_missing', 'apply_for_job(): required skill missing');
reset role;
select tests.give_points(:w, 10);
select tests.login_as('authenticated', :w);
select public.learn_skill(gen_random_uuid(), 'it_basics') is not null as ok \gset
select (select (x ->> 'eligible')::boolean from jsonb_array_elements(public.get_job_board() -> 'postings') x
         where x ->> 'id' = :'post'::jsonb ->> 'id') as wb2 \gset
select public.apply_for_job(gen_random_uuid(), (:'post'::jsonb ->> 'id')::uuid, 15000, null) as wapp \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_company_postings() -> 'postings' -> 0 as cp \gset
select (select x -> 'applicant' from jsonb_array_elements(public.get_company_applications(:'fco') -> 'applications') x
         where x ->> 'id' = :'wapp'::jsonb ->> 'id') as applicant \gset
select public.respond_application(gen_random_uuid(), (:'wapp'::jsonb ->> 'id')::uuid, 'accept', null) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :w);
select public.sign_contract(gen_random_uuid(), (:'wapp'::jsonb ->> 'id')::uuid, 'M1 1') is not null as ok \gset
select public.get_employer() -> 'employer' as wemp \gset
reset role;
select id as wjob from public.player_jobs where player_id = :w and status = 'active' \gset
select tests.assert(
  :'wb1'::jsonb -> 'required_skills' = '["it_basics"]'::jsonb and not (:'wb1'::jsonb ->> 'eligible')::boolean
  and :'wb2'::boolean
  and :'wapp'::jsonb -> 'posting' -> 'required_skills' = '["it_basics"]'::jsonb
  and :'cp'::jsonb -> 'required_skills' = '["it_basics"]'::jsonb
  and :'applicant'::jsonb -> 'skills' = '["it_basics"]'::jsonb,
  'postings with concrete skills: board, application, company postings; eligible only with the skill; applicant shows matching skills');
select tests.assert(
  :'wemp'::jsonb ->> 'kind' = 'player' and :'wemp'::jsonb ->> 'founder' = 'Frieda_Format'
  and :'wemp'::jsonb ->> 'tier' = 'garage' and :'wemp'::jsonb ->> 'product_key' = 'mobile_app'
  and (:'wemp'::jsonb ->> 'stage')::int = 0 and (:'wemp'::jsonb ->> 'team_size')::int = 2
  and :'wemp'::jsonb -> 'company' -> 'ticker' = 'null'::jsonb,
  'get_employer(): player company with founder, tier, product, stage and team size');

-- training: the employee learns the stage-1 skill, the company reaches stage 1
-- (trainings unlock from startups.training.fromEmployees since M3h; a garage never gets there, so lowered here)
select coalesce(value #> '{training,fromEmployees}', '5') as tr_from from public.game_config where key = 'startups' \gset
update public.game_config set value = jsonb_set(value, '{training,fromEmployees}', '1') where key = 'startups';
select tests.login_as('authenticated', :f);
select tests.throws_key(format($$select public.train_employee(gen_random_uuid(), %L, 'it_programming')$$, :'wjob'),
  'insufficient_funds', 'train_employee(): paid from the company cash');
select public.company_deposit(gen_random_uuid(), 2000000) is not null as ok \gset
reset role;
select tests.company_cash(:'fco') as cc0 \gset
select balance_cents as hh0 from public.ledger_accounts where system_key = 'households' \gset
select tests.login_as('authenticated', :f);
select public.train_employee(gen_random_uuid(), :'wjob', 'it_programming') as tr \gset
select tests.throws_key(format($$select public.train_employee(gen_random_uuid(), %L, 'it_programming')$$, :'wjob'), 'skill_learned', 'already learned');
select tests.throws_key(format($$select public.train_employee(gen_random_uuid(), %L, 'magic')$$, :'wjob'), 'skill_unknown', 'unknown skill');
select public.get_my_company() -> 'company' as fc2 \gset
select public.get_company_team(:'fco') -> 'members' -> 0 as member \gset
reset role;
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.train_employee(gen_random_uuid(), %L, 'it_ux')$$, :'wjob'), 'employer_only', 'only the employer');
reset role;
select tests.assert(
  :'tr'::jsonb = jsonb_build_object('skill_key', 'it_programming', 'cost_cents', 500000, 'salary_cents_per_hour', 15750)
  and tests.company_cash(:'fco') <= :cc0::bigint - 500000
  and (select balance_cents from public.ledger_accounts where system_key = 'households') >= :hh0::bigint + 500000
  and exists (select 1 from public.player_skills where player_id = :w and skill_key = 'it_programming')
  and (select salary_cents_per_hour from public.player_jobs where id = :'wjob') = 15750
  and (:'fc2'::jsonb ->> 'stage')::int = 1
  and :'fc2'::jsonb -> 'stages' -> 0 = '{"stage": 1, "reached": true, "skills": [{"key": "it_programming", "covered_by": "Walter_Weg", "covered_by_ai": false}]}'::jsonb
  and (:'fc2'::jsonb ->> 'capacity_cents')::bigint
      = round((:'fc2'::jsonb ->> 'team_productivity_bps')::int / 10000.0 * 300000 * 1.25)
  and :'member'::jsonb -> 'skills' @> '["it_basics", "it_programming"]'::jsonb and :'member'::jsonb ? 'notice_ends_at'
  and exists (select 1 from public.company_messages where company_id = :'fco' and body = 'Walter_Weg hat eine Schulung abgeschlossen.'),
  'train_employee(): tier-2 training 5.000 EUR to the households, skill at once, wage +5 %; stage 1 reached, capacity +25 %');
update public.game_config set value = jsonb_set(value, '{training,fromEmployees}', :'tr_from'::jsonb) where key = 'startups';

-- quarter close with stage 1: awareness capped at 0.7
-- (M3i: the hours of the quarter carry the capacity; the employee's time is settled beyond them)
update public.player_companies set awareness = 0.9, potential_annual_cents = 10000000000 where company_id = :'fco';
select (public.current_game_quarter()).starts_at as cqs, (public.current_game_quarter()).ends_at as cqe \gset
select last_paid_at as wpaid from public.player_jobs where id = :'wjob' \gset
update public.player_jobs set last_paid_at = greatest(last_paid_at, :'cqe'::timestamptz) where id = :'wjob';
select count(*) as fhours
  from generate_series(:'cqs'::timestamptz, :'cqe'::timestamptz - interval '1 hour', interval '1 hour') g(h),
       lateral (select public.player_company_close_hour(:'fco', g.h) as r) x \gset
select public.player_company_close_quarter(:'fco', (public.current_game_quarter()).id) is not null as ok \gset
update public.player_jobs set last_paid_at = :'wpaid' where id = :'wjob';
select tests.assert(
  (select awareness <= 0.7 + 1e-12 from public.player_companies where company_id = :'fco')
  and (select abs(r.capacity_cents * 6 / :fhours::int - round((:'fc2'::jsonb ->> 'team_productivity_bps')::int / 10000.0 * 300000 * 1.25)) <= 6
         from public.player_company_reports r where r.company_id = :'fco' order by r.created_at desc limit 1),
  'quarter close: awareness capped by the stage (0.7 at stage 1), capacity with the stage bonus');

-- notice at a player company: employer sees it, chat line when it ends
select tests.login_as('authenticated', :w);
select public.quit_job(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_company_team(:'fco') -> 'members' -> 0 ->> 'notice_ends_at' as mnotice \gset
reset role;
update public.player_jobs set notice_ends_at = now() - interval '1 second' where id = :'wjob';
select public.process_quit_notices() is not null as ok \gset
select tests.assert(:'mnotice' is not null
  and (select status = 'ended' from public.player_jobs where id = :'wjob')
  and exists (select 1 from public.company_messages where company_id = :'fco' and body = 'Walter_Weg hat gekündigt.'),
  'quit notice at a player company: visible in get_company_team, chat line when the job ends');
select tests.login_as('authenticated', :w);
select public.get_employer() as wemp2 \gset
reset role;
select tests.assert(:'wemp2'::jsonb = '{"employer": null}'::jsonb, 'get_employer(): null without a job');
select tests.assert(
  (select prosrc ~ 'process_quit_notices' from pg_proc where oid = 'public.run_due_jobs()'::regprocedure),
  'run_due_jobs() ends jobs after the notice');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds (training costs, wages during the notice)');
