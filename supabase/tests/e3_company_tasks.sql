-- =============================================================================
-- e3 · Company tasks keep working (ADR-211): the whole flow for every game of the catalogue, one broken task never
--      stops the minute run, an empty answer never scores, clones get no tasks, tasks of people who left open again.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''0e3e3e3e-e3e3-4000-8000-0000000000f1'''
\set g '''0e3e3e3e-e3e3-4000-8000-0000000000f2'''
\set w '''0e3e3e3e-e3e3-4000-8000-0000000000a1'''
\set c '''0e3e3e3e-e3e3-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:f, 'Ea_Founder') is not null and tests.signup(:g, 'Ea_Second') is not null
   and tests.signup(:w, 'Ea_Worker') is not null and tests.signup(:c, 'Ea_Cloner') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 30);
select tests.set_level(:g, 30);
select tests.set_level(:w, 10);
select tests.set_level(:c, 25);
select tests.fund(:f, 300000000, 'test:e3:f');
select tests.fund(:g, 300000000, 'test:e3:g');
select tests.fund(:c, 10000000, 'test:e3:c');
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Ea Moden', 'Shirts', 'retail', '#aa3366', 'garage', 'fashion')
  -> 'company' ->> 'id' as cid \gset
select public.company_deposit(gen_random_uuid(), 2000000) is not null as ok \gset
select tests.login_as('authenticated', :g);
select public.found_company(gen_random_uuid(), 'Ea Zwei', 'Kisten', 'retail', '#3366aa', 'garage', 'fashion')
  -> 'company' ->> 'id' as cid2 \gset
reset role;
update public.player_companies set tier = 'small_business' where company_id = :'cid';
select tests.hire(:f, :w, 20000) as wjob \gset
update public.profiles set last_active_at = now() where id in (:f, :g, :w);

-- ---------------------------------------------------------------------------
-- 1. Every game of the catalogue: created, listed, started, answered
-- ---------------------------------------------------------------------------
select tests.assert(
  (select bool_and(public.company_tasks_cfg() -> 'games' ? (x ->> 'game'))
     from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x)
  and (select count(distinct x ->> 'game') from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x) >= 32,
  'e3: every catalogue task has a game with rules (32 games)');
delete from public.company_tasks where company_id = :'cid';
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, due_at)
select :'cid', d ->> 'key', d ->> 'branch', d ->> 'game', 10000, now() + interval '40 minutes'
  from (select distinct on (x ->> 'game') x as d from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x
         order by x ->> 'game', x ->> 'key') s;
create temporary table e3_ids as select id, game from public.company_tasks where company_id = :'cid';
grant select on e3_ids to authenticated;
select tests.login_as('authenticated', :f);
select public.get_company_tasks() as board \gset
create temporary table e3_results (game text, play jsonb, result jsonb);
grant all on e3_results to authenticated;
do $$
declare
  r record;
begin
  for r in select id, game from e3_ids order by game loop
    insert into e3_results values (r.game, public.start_company_task(gen_random_uuid(), r.id), null);
    update e3_results set result = public.submit_company_task(gen_random_uuid(), r.id, '{}'::jsonb) where game = r.game;
  end loop;
end;
$$;
reset role;
select tests.assert(
  jsonb_array_length(:'board'::jsonb -> 'tasks') = (select count(*) from e3_ids)
  and (select count(*) from e3_results) = (select count(*) from e3_ids)
  and (select bool_and(play ->> 'game' = game and jsonb_typeof(play -> 'puzzle') = 'object'
                       and (select count(*) from jsonb_object_keys(play -> 'puzzle')) > 0 and not (play ? 'solution'))
         from e3_results),
  'e3: the board lists a task of every game, each one starts with a puzzle and without its solution');
select tests.assert(
  (select bool_and(result ->> 'status' = 'failure' and (result ->> 'score_bps')::integer = 0) from e3_results),
  'e3: an empty answer scores 0 in every game' || coalesce(' (full marks: '
    || (select string_agg(game, ', ') from e3_results where result ->> 'status' <> 'failure') || ')', ''));
select tests.assert(
  public.company_task_grade('receipts', '{"amounts": [1, 2], "target": 3, "step_bps": 100}', '{"picked": [0, 1]}') = 10000
  and public.company_task_grade('receipts', '{"amounts": [1, 2], "target": 3, "step_bps": 100}', '{}') = 0
  and public.company_task_grade('shelf', '{"grid": [0,1,2,3,2,3,0,1,1,0,3,2,3,2,1,0], "blanks": [0]}', '{}') = 0
  and public.company_task_grade('restock', '{"values": [1]}', '{}') = 0
  and public.company_task_grade('offer', '{"choices": [1]}', '{}') = 0,
  'e3: receipts and shelf: right answers still full marks, a missing list 0 (was 10 000)');

-- ---------------------------------------------------------------------------
-- 2. One broken task never stops the minute run
-- ---------------------------------------------------------------------------
delete from public.company_tasks where company_id in (:'cid', :'cid2');
update public.player_companies set tasks_last_created_at = null where company_id in (:'cid', :'cid2');
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, due_at, status, assignee_ai, ai_done_at, ai_chance_bps)
values (:'cid', 'pack_shirts', 'logistics', 'pick', 10000, now() + interval '30 minutes', 'ai', true, now() - interval '1 minute', 10000),
       (:'cid2', 'pack_shirts', 'logistics', 'pick', 10000, now() + interval '30 minutes', 'ai', true, now() - interval '1 minute', 10000);
select id as bad from public.company_tasks where company_id = :'cid' and status = 'ai' \gset
select id as good from public.company_tasks where company_id = :'cid2' and status = 'ai' \gset
create or replace function pg_temp.e3_break() returns trigger language plpgsql as $$
begin
  if new.id = current_setting('e3.bad')::bigint then
    raise exception 'e3 broken task';
  end if;
  return new;
end;
$$;
select set_config('e3.bad', :'bad', false) is not null as ok \gset
create trigger e3_break before update on public.company_tasks for each row execute function pg_temp.e3_break();
select public.company_tasks_run_due(now()) as run \gset
drop trigger e3_break on public.company_tasks;
select tests.assert(
  (:'run'::jsonb ->> 'errors')::integer >= 1 and (:'run'::jsonb ->> 'ai')::integer >= 1
  and (select status from public.company_tasks where id = :good) = 'success'
  and (select status from public.company_tasks where id = :bad) = 'ai'
  and exists (select 1 from public.company_tasks where company_id = :'cid2' and status = 'open')
  and exists (select 1 from public.job_runs where job_name = 'company_tasks' and status = 'failed'
                and details ->> 'step' = 'ai' and details ->> 'ref' = :'bad' and error like '%e3 broken task%'),
  'e3: a task that fails stays for the next minute, written to job_runs; the other company gets its AI result and new work');
select public.company_tasks_run_due(now()) as run2 \gset
select tests.assert( (select status from public.company_tasks where id = :bad) = 'success',
  'e3: the next minute resolves the task once the cause is gone');

-- ---------------------------------------------------------------------------
-- 3. Clones get no tasks; tasks of people who left open again
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :f);
select (public.create_job_posting(gen_random_uuid(), :'cid', 'intern', 'Werkstudium', '[{"branch": "it", "min_score": 0}]',
                                  20000, 1) ->> 'id') as post \gset
select tests.login_as('authenticated', :c);
select public.create_clone(gen_random_uuid()) is not null as ok \gset
select (public.clone_apply_for_job(gen_random_uuid(), :'post', 20000, null) ->> 'id') as app \gset
select tests.login_as('authenticated', :f);
select public.respond_application(gen_random_uuid(), :'app', 'accept', null) is not null as ok \gset
select tests.login_as('authenticated', :c);
select public.clone_sign_contract(gen_random_uuid(), :'app', 'E 3') is not null as ok \gset
reset role;
delete from public.company_tasks where company_id = :'cid';
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, due_at)
values (:'cid', 'pack_shirts', 'logistics', 'pick', 10000, now() + interval '40 minutes'),
       (:'cid', 'size_count', 'logistics', 'count', 10000, now() + interval '40 minutes');
select id as t1 from public.company_tasks where company_id = :'cid' and task_key = 'pack_shirts' \gset
select id as t2 from public.company_tasks where company_id = :'cid' and task_key = 'size_count' \gset
select tests.login_as('authenticated', :f);
select public.get_company_tasks() as b2 \gset
select tests.throws_key(format('select public.delegate_company_task(gen_random_uuid(), %s, %L)', :t1, 'Ea_Cloner'),
  'task_not_allowed', 'e3: no task for a clone (it never opens the board)');
select tests.throws_key(format('select public.set_job_supervisor(gen_random_uuid(), %L, %L)', 'Ea_Worker', 'Ea_Cloner'),
  'task_not_allowed', 'e3: a clone leads nobody');
select public.delegate_company_task(gen_random_uuid(), :t2, 'Ea_Worker') is not null as ok \gset
reset role;
select tests.assert(
  (select (p ->> 'is_clone')::boolean and not (p ->> 'is_me')::boolean
     from jsonb_array_elements(:'b2'::jsonb -> 'people') p where p ->> 'nickname' = 'Ea_Cloner')
  and (select not (p ->> 'is_clone')::boolean from jsonb_array_elements(:'b2'::jsonb -> 'people') p where p ->> 'nickname' = 'Ea_Worker'),
  'e3: the board marks the clone (people[].is_clone)');
-- an old hand-over to the clone and the worker leaving: both tasks are open again within a minute
update public.company_tasks set status = 'assigned', assignee_id = :c, assigned_by = :f, assigned_at = now() where id = :t1;
update public.player_jobs set status = 'ended', ended_at = now(), end_reason = 'quit' where id = :'wjob';
select public.company_tasks_run_due(now()) as run3 \gset
select tests.assert(
  (:'run3'::jsonb ->> 'reopened')::integer >= 2
  and (select bool_and(status = 'open' and assignee_id is null) from public.company_tasks where id in (:t1, :t2)),
  'e3: tasks of a clone or of someone who left go back to open instead of running into the penalty');
