-- =============================================================================
-- 96 · Company tasks, supervisors and the news feed (ADR-129)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''09609609-0000-4000-8000-0000000000f1'''
\set s '''09609609-0000-4000-8000-0000000000a1'''
\set i '''09609609-0000-4000-8000-0000000000b1'''
\set o '''09609609-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:f, 'Mona_Mode') is not null and tests.signup(:s, 'Sven_Senior') is not null
   and tests.signup(:i, 'Ida_Intern') is not null and tests.signup(:o, 'Otto_Fremd') is not null as ok \gset
select tests.set_level(:f, 12);
select tests.set_level(:s, 6);
select tests.set_level(:i, 6);
select tests.fund(:f, 30000000, 'test:tasks:f');
update public.sim_runtime set is_paused = false;
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Mona Moden', 'Shirts mit Haltung', 'retail', '#aa3366', 'garage', 'fashion')
  -> 'company' ->> 'id' as cid \gset
select public.company_deposit(gen_random_uuid(), 2000000) is not null as ok \gset
reset role;
select tests.hire(:f, :s, 20000) as sjob \gset
select tests.hire(:f, :i, 20000) as ijob \gset
update public.player_jobs set tier = 'senior' where id = :'sjob';
update public.player_jobs set tier = 'intern' where id = :'ijob';
update public.profiles set last_active_at = now() where id = :f;

-- --- the board fills while someone is active ------------------------------------------------------------------
select public.company_tasks_run_due(now()) as r1 \gset
select public.company_tasks_run_due(now() + interval '5 minutes') as r2 \gset
select tests.assert(
  (select count(*) from public.company_tasks where company_id = :'cid') = 2
  and (select bool_and(task_key in (select x ->> 'key' from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x
                                     where x ->> 'product' in ('*', 'fashion')))
         from public.company_tasks where company_id = :'cid')
  and (select bool_and(value_cents > 0 and due_at > created_at) from public.company_tasks where company_id = :'cid'),
  'company_tasks_run_due(): tasks fit the product (fashion or every company), one new task per few minutes');

-- a task of known kind for the next steps
delete from public.company_tasks where company_id = :'cid';
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, due_at)
values (:'cid', 'pack_shirts', 'logistics', 'pick', 44000, now() + interval '40 minutes'),
       (:'cid', 'payroll_check', 'finance', 'math', 44000, now() + interval '40 minutes'),
       (:'cid', 'runway_order', 'sales', 'seq', 36000, now() + interval '40 minutes');
select id as t1 from public.company_tasks where company_id = :'cid' and task_key = 'pack_shirts' \gset
select id as t2 from public.company_tasks where company_id = :'cid' and task_key = 'payroll_check' \gset
select id as t3 from public.company_tasks where company_id = :'cid' and task_key = 'runway_order' \gset

-- --- hierarchy: the intern reports to the senior ---------------------------------------------------------------
select tests.login_as('authenticated', :f);
select public.set_job_supervisor(gen_random_uuid(), 'Ida_Intern', 'Sven_Senior') as h1 \gset
select tests.throws_key($$select public.set_job_supervisor(gen_random_uuid(), 'Sven_Senior', 'Ida_Intern')$$, 'task_not_allowed',
  'set_job_supervisor(): a supervisor needs a higher rank');
select public.delegate_company_task(gen_random_uuid(), :t1, 'Sven_Senior') as d1 \gset
reset role;
select tests.assert(
  (select supervisor_id from public.player_jobs where id = :'ijob') = :s::uuid
  and exists (select 1 from jsonb_array_elements(:'h1'::jsonb -> 'people') p
               where p ->> 'nickname' = 'Ida_Intern' and p ->> 'supervisor' = 'Sven_Senior')
  and exists (select 1 from public.notifications n where n.player_id = :s::uuid and n.type_key = 'company_task'),
  'set_job_supervisor() and delegate_company_task(): the founder hands a task to the senior, who gets a notification');

-- the senior passes it on to the own intern; the intern may not pass it upwards or to the AI
select tests.login_as('authenticated', :s);
select public.delegate_company_task(gen_random_uuid(), :t1, 'Ida_Intern') as d2 \gset
reset role;
select tests.login_as('authenticated', :i);
select tests.throws_key(format('select public.delegate_company_task(gen_random_uuid(), %s, %L)', :t1, 'Sven_Senior'),
  'task_not_allowed', 'delegate_company_task(): only to own reports (NX112)');
select tests.throws_key(format('select public.delegate_company_task(gen_random_uuid(), %s, %L)', :t2, 'ai'),
  'task_not_allowed', 'delegate_company_task(): interns cannot use the AI');
select public.get_company_tasks() as ib \gset
-- --- the game: right answer -------------------------------------------------------------------------------------
select public.start_company_task(gen_random_uuid(), :t1) as p1 \gset
reset role;
select solution -> 'targets' as sol1 from public.company_tasks where id = :t1 \gset
select (select a.balance_cents from public.ledger_accounts a where a.id = public.company_cash_account(:'cid')) as cash0 \gset
select tests.login_as('authenticated', :i);
select public.submit_company_task(gen_random_uuid(), :t1, jsonb_build_object('picked', :'sol1'::jsonb)) as a1 \gset
reset role;
select tests.assert(
  :'ib'::jsonb ->> 'role' = 'employee'
  and (select (x ->> 'mine')::boolean from jsonb_array_elements(:'ib'::jsonb -> 'tasks') x where (x ->> 'id')::bigint = :t1)
  and :'p1'::jsonb ->> 'game' = 'pick' and jsonb_array_length(:'p1'::jsonb -> 'puzzle' -> 'tiles') = 12
  and not (:'p1'::jsonb ? 'solution')
  and :'a1'::jsonb ->> 'status' = 'success' and (:'a1'::jsonb ->> 'score_bps')::int = 10000
  and (:'a1'::jsonb ->> 'result_cents')::bigint = 44000
  and (select a.balance_cents from public.ledger_accounts a where a.id = public.company_cash_account(:'cid')) = :cash0::bigint + 44000
  and (:'a1'::jsonb ->> 'xp')::int > 0
  and exists (select 1 from public.company_news n where n.company_id = :'cid' and n.kind = 'task_success'
                and n.payload ->> 'task' = 'pack_shirts' and n.payload ->> 'nickname' = 'Ida_Intern'),
  'start/submit_company_task(): the intern packs every T-shirt; the company earns, the news says so');

-- --- wrong answer costs money ------------------------------------------------------------------------------------
select tests.login_as('authenticated', :f);
select public.start_company_task(gen_random_uuid(), :t2) as p2 \gset
select public.submit_company_task(gen_random_uuid(), :t2, '{"value": -1}') as a2 \gset
select tests.throws_key(format('select public.submit_company_task(gen_random_uuid(), %s, %L)', :t2, '{"value": 1}'),
  'task_closed', 'submit_company_task(): only once (NX113)');
reset role;
select tests.assert(
  :'a2'::jsonb ->> 'status' = 'failure' and (:'a2'::jsonb ->> 'result_cents')::bigint = -26400
  and (select a.balance_cents from public.ledger_accounts a where a.id = public.company_cash_account(:'cid')) = :cash0::bigint + 44000 - 26400
  and exists (select 1 from public.company_news n where n.company_id = :'cid' and n.kind = 'task_failure'),
  'submit_company_task(): a wrong answer costs 60 % of the value (company_costs), news of the failure');

-- --- a stranger sees nothing --------------------------------------------------------------------------------------
select tests.login_as('authenticated', :o);
select tests.throws_key('select public.get_company_tasks()', 'company_not_found', 'get_company_tasks(): only for the team');
select tests.throws_key(format('select public.start_company_task(gen_random_uuid(), %s)', :t3), 'task_not_found',
  'start_company_task(): not for strangers (NX110)');
reset role;

-- --- AI: slower and only with AI workers --------------------------------------------------------------------------
select tests.login_as('authenticated', :f);
select tests.throws_key(format('select public.delegate_company_task(gen_random_uuid(), %s, %L)', :t3, 'ai'), 'no_ai_workers',
  'delegate_company_task(): no AI without AI workers (NX114)');
reset role;
update public.player_companies set ai_workers = 2 where company_id = :'cid';
select tests.login_as('authenticated', :f);
select public.delegate_company_task(gen_random_uuid(), :t3, 'ai') as d3 \gset
reset role;
select ai_done_at - assigned_at as ai_time from public.company_tasks where id = :t3 \gset
update public.company_tasks set ai_chance_bps = 10000 where id = :t3;
select public.company_tasks_run_due(now() + interval '13 minutes') is not null as ok \gset
select tests.assert(
  :'ai_time'::interval >= interval '12 minutes'
  and (select status = 'success' and result_cents = 36000 * 6000 / 10000 from public.company_tasks where id = :t3),
  'company_tasks_run_due(): the AI finishes after 12 minutes and earns 60 % of the value');

-- --- missed deadline ----------------------------------------------------------------------------------------------
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, due_at)
values (:'cid', 'size_count', 'logistics', 'count', 32000, now() - interval '1 minute') returning id as t4 \gset
update public.player_companies set tasks_auto_ai = false where company_id = :'cid';
select public.company_tasks_run_due(now()) is not null as ok \gset
select tests.assert(
  (select status = 'missed' and result_cents = -19200 from public.company_tasks where id = :t4)
  and exists (select 1 from public.company_news n where n.company_id = :'cid' and n.kind = 'task_missed'),
  'company_tasks_run_due(): a missed deadline costs money and makes news');

-- --- grading ------------------------------------------------------------------------------------------------------
select tests.assert(
  public.company_task_grade('pick', '{"targets": [1, 4, 7]}', '{"picked": [1, 4, 7]}') = 10000
  and public.company_task_grade('pick', '{"targets": [1, 4, 7]}', '{"picked": [1, 4, 2]}') = 3333
  and public.company_task_grade('count', '{"count": 6}', '{"count": 5}') = 5000
  and public.company_task_grade('sort', '{"sides": [0, 1, 1, 0]}', '{"sides": [0, 1, 0, 0]}') = 7500
  and public.company_task_grade('order', '{"order": [2, 0, 1, 4, 3]}', '{"order": [2, 0, 1, 4, 3]}') = 10000
  and public.company_task_grade('seq', '{"sequence": [3, 1, 1, 0, 2]}', '{"sequence": "nope"}') = 0
  and public.company_task_grade('math', '{"value": 42}', '{"value": 42}') = 10000,
  'company_task_grade(): pick, count, sort, order, seq and math');
select tests.assert(
  (select bool_and((public.company_task_grade(x ->> 'game', (public.company_task_puzzle(x)) -> 'solution',
                                               (public.company_task_puzzle(x)) -> 'solution') >= 0))
     from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x)
  and (select bool_and(((public.company_task_puzzle(x) -> 'solution' ->> 'value')::int) >= 0)
         from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x where x ->> 'game' = 'math'),
  'company_task_puzzle(): every task of the catalogue builds a puzzle; math answers are whole and not negative');

-- --- news feed ----------------------------------------------------------------------------------------------------
select public.fun_news_run_due(now()) is not null as ok \gset
select tests.login_as('authenticated', :o);
select public.get_news_feed('all', 40) as nf \gset
select public.get_news_feed('company', 10) as nc \gset
select tests.throws_key($$select public.get_news_feed('gossip', 10)$$, 'invalid_argument', 'get_news_feed(): known kinds only');
reset role;
select tests.assert(
  exists (select 1 from jsonb_array_elements(:'nf'::jsonb -> 'items') x where x ->> 'kind' = 'fun')
  and exists (select 1 from jsonb_array_elements(:'nc'::jsonb -> 'items') x
               where x ->> 'news_kind' = 'task_success' and x ->> 'name' = 'Mona Moden')
  and not exists (select 1 from jsonb_array_elements(:'nc'::jsonb -> 'items') x where x ->> 'kind' <> 'company'),
  'get_news_feed(): funny news and the task results of every company, filter by kind');

-- --- org chart shows the supervisor --------------------------------------------------------------------------------
select tests.login_as('authenticated', :o);
select public.get_company_org(:'cid') as org \gset
reset role;
select tests.assert(
  exists (select 1 from jsonb_array_elements(:'org'::jsonb -> 'members') m
           where m ->> 'nickname' = 'Ida_Intern' and m ->> 'supervisor' = 'Sven_Senior'),
  'get_company_org(): members show who they report to');

select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'closed money system after the company tasks');
select tests.throws($$select public.api_error('no_ai_workers')$$, 'NX114', 'no_ai_workers is NX114');
