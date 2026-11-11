-- =============================================================================
-- 67 · M3h: AI workers for stage skills, trainings from a team size (ADR-071)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''06706706-0000-4000-8000-0000000000f1'''
\set w '''06706706-0000-4000-8000-0000000000f2'''
\set rq '''06706706-0000-4000-8000-0000000000a1'''
select tests.signup(:f, 'Kira_Kollege') is not null and tests.signup(:w, 'Uwe_Umsicht') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 12);
select tests.set_level(:w, 3);
select tests.fund(:f, 5000000, 'test:m3h:f');

-- small business (5 places) with the product mobile_app:
-- stages [it_programming] [it_mobile, sales_social] [it_ux, sales_growth] [it_cloud, management_strategy]
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Kira Apps', 'Apps für Kitas', 'tech', '#3377aa', 'small_business', 'mobile_app')
         -> 'company' as c0 \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.assert(
  (:'c0'::jsonb ->> 'stage')::int = 0 and :'c0'::jsonb -> 'ai_worker_skills' = '[]'::jsonb
  and (:'c0'::jsonb ->> 'training_from')::int = 5
  and :'c0'::jsonb -> 'stages' -> 0 -> 'skills' -> 0 = '{"key": "it_programming", "covered_by": null, "covered_by_ai": false}'::jsonb,
  'COMPANY: ai_worker_skills [], training_from 5, stage skills with covered_by_ai');

-- =============================================================================
-- A. Hire an AI worker for a stage skill
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.hire_ai_workers(:rq, 1, 'it_programming') as h1 \gset
select public.hire_ai_workers(:rq, 1, 'it_programming') as h1b \gset
select tests.throws_key($$select public.hire_ai_workers(gen_random_uuid(), 1, 'it_programming')$$, 'skill_already_covered',
  'hire_ai_workers(): a skill is covered by one AI worker at most');
select tests.throws($$select public.hire_ai_workers(gen_random_uuid(), 1, 'it_programming')$$, 'NX062', 'skill_already_covered is NX062');
select tests.throws_key($$select public.hire_ai_workers(gen_random_uuid(), 1, 'it_security')$$, 'invalid_argument',
  'hire_ai_workers(): the skill must belong to a stage of the product');
select tests.throws_key($$select public.hire_ai_workers(gen_random_uuid(), 2, 'it_mobile')$$, 'invalid_argument',
  'hire_ai_workers(): one AI worker per skill');
select tests.throws_key($$select public.hire_ai_workers(gen_random_uuid(), 0)$$, 'invalid_argument', 'hire_ai_workers(): at least one');
select tests.throws_key($$select public.hire_ai_workers(null, 1)$$, 'invalid_argument', 'hire_ai_workers(): request_id is required');
reset role;
select tests.assert(
  :'h1'::jsonb = :'h1b'::jsonb
  and (:'h1'::jsonb -> 'company' ->> 'ai_workers')::int = 1
  and :'h1'::jsonb -> 'company' -> 'ai_worker_skills' = '["it_programming"]'::jsonb
  and (:'h1'::jsonb -> 'company' ->> 'stage')::int = 1
  and :'h1'::jsonb -> 'company' -> 'stages' -> 0
      = '{"stage": 1, "reached": true, "skills": [{"key": "it_programming", "covered_by": null, "covered_by_ai": true}]}'::jsonb
  and (select ai_workers = 1 and ai_worker_skills = '{it_programming}' from public.player_companies where company_id = :'fco')
  and public.company_stage(:'fco') = 1,
  'hire_ai_workers(p_skill): {company}, the AI worker covers it_programming (covered_by_ai), stage 1; replay returns the stored result');

-- general ones next to skilled ones; the tier limit counts all of them
select tests.login_as('authenticated', :f);
select public.hire_ai_workers(gen_random_uuid(), 1, 'it_mobile') is not null as ok \gset
select public.hire_ai_workers(gen_random_uuid(), 2) is not null as ok \gset
select public.hire_ai_workers(gen_random_uuid(), 1, 'sales_social') -> 'company' as h2 \gset
select tests.throws_key($$select public.hire_ai_workers(gen_random_uuid(), 1)$$, 'employee_limit',
  'hire_ai_workers(): small business has 5 places');
reset role;
select tests.assert(
  (:'h2'::jsonb ->> 'ai_workers')::int = 5 and (:'h2'::jsonb ->> 'headcount')::int = 5
  and :'h2'::jsonb -> 'ai_worker_skills' = '["it_programming", "it_mobile", "sales_social"]'::jsonb
  and (:'h2'::jsonb ->> 'stage')::int = 2,
  'hire_ai_workers(): 2 general + 3 skilled AI workers, stage 2');

-- set_ai_workers lowers general ones first, then skilled ones from the end
select tests.login_as('authenticated', :f);
select public.set_ai_workers(gen_random_uuid(), 4) -> 'company' as s4 \gset
select public.set_ai_workers(gen_random_uuid(), 3) -> 'company' as s3 \gset
select public.set_ai_workers(gen_random_uuid(), 2) -> 'company' as s2 \gset
reset role;
select tests.assert(
  :'s4'::jsonb -> 'ai_worker_skills' = '["it_programming", "it_mobile", "sales_social"]'::jsonb
  and :'s3'::jsonb -> 'ai_worker_skills' = '["it_programming", "it_mobile", "sales_social"]'::jsonb
  and :'s2'::jsonb -> 'ai_worker_skills' = '["it_programming", "it_mobile"]'::jsonb
  and (:'s2'::jsonb ->> 'ai_workers')::int = 2 and (:'s2'::jsonb ->> 'stage')::int = 1,
  'set_ai_workers(): general AI workers go first, then skilled ones from the end');

-- =============================================================================
-- B. Dismiss
-- =============================================================================
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.dismiss_ai_worker(gen_random_uuid(), 'sales_social')$$, 'invalid_argument',
  'dismiss_ai_worker(): no AI worker covers the skill');
select public.dismiss_ai_worker(gen_random_uuid(), 'it_programming') -> 'company' as d1 \gset
select public.hire_ai_workers(gen_random_uuid(), 1) is not null as ok \gset
select public.dismiss_ai_worker(gen_random_uuid()) -> 'company' as d2 \gset
select public.dismiss_ai_worker(gen_random_uuid()) -> 'company' as d3 \gset
select tests.throws_key($$select public.dismiss_ai_worker(gen_random_uuid())$$, 'invalid_argument',
  'dismiss_ai_worker(): no AI worker left');
reset role;
select tests.assert(
  (:'d1'::jsonb ->> 'ai_workers')::int = 1 and :'d1'::jsonb -> 'ai_worker_skills' = '["it_mobile"]'::jsonb
  and (:'d1'::jsonb ->> 'stage')::int = 0
  and :'d1'::jsonb -> 'stages' -> 0 -> 'skills' -> 0 = '{"key": "it_programming", "covered_by": null, "covered_by_ai": false}'::jsonb
  and :'d1'::jsonb -> 'stages' -> 1 -> 'skills' -> 0 = '{"key": "it_mobile", "covered_by": null, "covered_by_ai": true}'::jsonb
  and (:'d2'::jsonb ->> 'ai_workers')::int = 1 and :'d2'::jsonb -> 'ai_worker_skills' = '["it_mobile"]'::jsonb
  and (:'d3'::jsonb ->> 'ai_workers')::int = 0 and :'d3'::jsonb -> 'ai_worker_skills' = '[]'::jsonb,
  'dismiss_ai_worker(): by skill, else a general one, else the last skilled one');

-- =============================================================================
-- C. A team member covers a skill: covered_by wins over the AI worker
-- =============================================================================
select tests.hire(:f, :w, 20000) as wjob \gset
insert into public.player_skills (player_id, skill_key) values (:w, 'it_mobile') on conflict do nothing;
select tests.login_as('authenticated', :f);
select public.hire_ai_workers(gen_random_uuid(), 1, 'it_mobile') -> 'company' as p1 \gset
reset role;
select tests.assert(
  :'p1'::jsonb -> 'stages' -> 1 -> 'skills' -> 0 = '{"key": "it_mobile", "covered_by": "Uwe_Umsicht", "covered_by_ai": false}'::jsonb
  and :'p1'::jsonb -> 'ai_worker_skills' = '["it_mobile"]'::jsonb and (:'p1'::jsonb ->> 'headcount')::int = 2,
  'stage skills: a team member is named in covered_by, covered_by_ai only without one');

-- =============================================================================
-- D. Trainings from 5 team members
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.company_deposit(gen_random_uuid(), 2000000) is not null as ok \gset
select tests.throws_key(format($$select public.train_employee(gen_random_uuid(), %L, 'it_programming')$$, :'wjob'), 'training_locked',
  'train_employee(): locked below 5 team members (2 here)');
select tests.throws(format($$select public.train_employee(gen_random_uuid(), %L, 'it_programming')$$, :'wjob'), 'NX063',
  'training_locked is NX063');
select public.hire_ai_workers(gen_random_uuid(), 2) is not null as ok \gset
select tests.throws_key(format($$select public.train_employee(gen_random_uuid(), %L, 'it_programming')$$, :'wjob'), 'training_locked',
  'train_employee(): still locked with 4');
select public.hire_ai_workers(gen_random_uuid(), 1) -> 'company' as t5 \gset
select public.train_employee(gen_random_uuid(), :'wjob', 'it_programming') as tr \gset
reset role;
select tests.assert(
  (:'t5'::jsonb ->> 'headcount')::int = 5 and (:'tr'::jsonb ->> 'skill_key') = 'it_programming'
  and exists (select 1 from public.player_skills where player_id = :w and skill_key = 'it_programming')
  and tests.money_invariant() = 'ok',
  'train_employee(): allowed from 5 team members (AI workers count)');

-- =============================================================================
-- E. Invariant: whatever removes AI workers clears their skills
-- =============================================================================
update public.player_companies set ai_worker_skills = '{it_cloud,it_cloud,it_data,sales_growth,it_mobile}' where company_id = :'fco';
select tests.assert(
  (select ai_worker_skills = '{it_cloud,it_data,sales_growth,it_mobile}' from public.player_companies where company_id = :'fco'),
  'ai_worker_skills: duplicates are dropped');
update public.player_companies set ai_workers = 2 where company_id = :'fco';
select tests.assert(
  (select ai_worker_skills = '{it_cloud,it_data}' from public.player_companies where company_id = :'fco'),
  'ai_worker_skills: never longer than ai_workers (skilled ones dropped from the end)');
select tests.login_as('authenticated', :f);
select public.close_company(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.assert(
  (select status = 'dissolved' and ai_workers = 0 and ai_worker_skills = '{}' from public.player_companies where company_id = :'fco')
  and tests.money_invariant() = 'ok',
  'company_dissolve(): no AI workers and no AI skills left');
