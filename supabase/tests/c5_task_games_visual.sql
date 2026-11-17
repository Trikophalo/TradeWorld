-- =============================================================================
-- c5 · Drag and see task games, fewer maths and typing tasks (ADR-186)
-- =============================================================================
-- 1. company_task_grade() gives exactly the scores of src/lib/sim/company-tasks-visual.ts on the shared cases.
-- 2. Every generated puzzle of the nine games is solvable on the server with full marks; tiles, untangle and pipes
--    start out of order.
-- 3. A player plays the new games through start/submit_company_task: right answers pay, wrong ones cost.
-- 4. The draw is weighted: maths and typing come up at most 20 % of the time (here: one fashion company, 300 draws).
\set QUIET 1
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- 1. Shared cases
-- ---------------------------------------------------------------------------
\ir task_games_visual_cases.inc
select tests.assert(
  (select bool_and(public.company_task_grade(c ->> 'game', c -> 'solution', c -> 'answer') = (c ->> 'score')::integer)
     from jsonb_array_elements(:'cases'::jsonb) c),
  'company_task_grade(): the same scores as gradeVisual (TS) on ' || jsonb_array_length(:'cases'::jsonb) || ' cases'
  || coalesce(': differs at ' || (select string_agg(c ->> 'name', ', ')
                                     from jsonb_array_elements(:'cases'::jsonb) c
                                    where public.company_task_grade(c ->> 'game', c -> 'solution', c -> 'answer')
                                          <> (c ->> 'score')::integer), ''));
select tests.assert(
  public.company_task_grade('tiles', '{"size": 3, "board": [0, 1, 2, 3, 4, 5, 6, -1, 7], "max_moves": 400}', '{"moves": [8]}') = 10000
  and public.company_task_grade('tiles', '{"size": 3, "board": [0, 1, 2, 3, 4, 5, 6, -1, 7], "max_moves": 400}', '{"moves": [0]}') = 0
  and public.company_task_grade('untangle', '{"grid": 3, "edges": [[0, 1], [2, 3]], "step_bps": 2000}',
                                '{"points": [[0, 0], [2, 2], [2, 0], [0, 2]]}') = 8000
  and public.company_task_grade('conveyor', '{"bins": [0, 1, 2, 0]}', '{"bins": [0, 1, 0, -1]}') = 2500
  and public.company_task_grade('rebuild', '{"layout": [0, -1, 1, -1]}', '{"layout": [0, 0, -1, -1]}') = 0
  and public.company_task_grade('sizes', '{"order": [2, 0, 1, 3]}', '{"order": [0, 2, 1, 3]}') = 5000,
  'company_task_grade(): tiles replay slides, untangle counts crossings, conveyor nets, rebuild rejects twins');

-- ---------------------------------------------------------------------------
-- 2. Generated puzzles
-- ---------------------------------------------------------------------------
create temporary table c5_puzzles as
select g, n, public.company_task_puzzle(jsonb_build_object('game', g)) as z
  from unnest(array['tiles', 'bins', 'untangle', 'odd', 'rebuild', 'align', 'pipes', 'sizes', 'conveyor']) g,
       generate_series(1, 12) n;

-- pipes: turn every route pipe until it fits
create or replace function pg_temp.c5_pipe_turns(p_sol jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_turns integer[];
  v_cell  integer;
  k       integer;
begin
  select array_agg(0) into v_turns from jsonb_array_elements(p_sol -> 'tiles');
  for k in 0..jsonb_array_length(p_sol -> 'path') - 1 loop
    v_cell := (p_sol -> 'path' ->> k)::integer;
    while public.company_task_pipe_mask((p_sol -> 'tiles' ->> v_cell)::integer, v_turns[v_cell + 1])
          <> (p_sol -> 'need' ->> k)::integer loop
      v_turns[v_cell + 1] := v_turns[v_cell + 1] + 1;
    end loop;
  end loop;
  return to_jsonb(v_turns);
end;
$$;

select tests.assert(
  (select bool_and(public.company_task_grade(g, z -> 'solution',
                     case g when 'untangle' then jsonb_build_object('points', z -> 'solution' -> 'untangled')
                            when 'pipes' then jsonb_build_object('turns', pg_temp.c5_pipe_turns(z -> 'solution'))
                            else z -> 'solution' end) = 10000)
     from c5_puzzles where g <> 'tiles'),
  'company_task_puzzle(): every new puzzle is solvable with full marks on the server');
select tests.assert(
  (select bool_and((select count(*) from jsonb_array_elements(z #> '{puzzle,board}') with ordinality b(v, o)
                     where (b.v #>> '{}')::integer <> (o - 1)::integer and (b.v #>> '{}')::integer >= 0) >= 5
                   and (select count(distinct v) from jsonb_array_elements(z #> '{puzzle,board}') v) = 9)
     from c5_puzzles where g = 'tiles')
  and (select bool_and(public.company_task_crossings(z #> '{puzzle,edges}', z #> '{puzzle,points}') >= 2
                       and public.company_task_crossings(z #> '{solution,edges}', z #> '{solution,untangled}') = 0)
         from c5_puzzles where g = 'untangle')
  and (select bool_and(not public.company_task_pipes_connected(4,
                         (select array_agg((e #>> '{}')::integer order by o) from jsonb_array_elements(z #> '{puzzle,tiles}') with ordinality x(e, o)),
                         (select array_agg((e #>> '{}')::integer order by o) from jsonb_array_elements(z #> '{puzzle,turns}') with ordinality x(e, o)),
                         (z #>> '{puzzle,from}')::integer, (z #>> '{puzzle,to}')::integer))
         from c5_puzzles where g = 'pipes')
  and (select bool_and(public.company_task_grade(g, z -> 'solution', jsonb_build_object('turns', z #> '{puzzle,turns}')) <= 5000)
         from c5_puzzles where g = 'pipes'),
  'company_task_puzzle(): tiles are scrambled (5+ tiles off), untangle starts crossed, pipes start open');
select tests.assert(
  (select bool_and(not (z -> 'puzzle') ? 'untangled' and not (z -> 'puzzle') ? 'path' and not (z -> 'puzzle') ? 'need')
     from c5_puzzles),
  'company_task_puzzle(): the puzzle never carries the untangled layout or the pipe route');

-- ---------------------------------------------------------------------------
-- 3. Playing the new games
-- ---------------------------------------------------------------------------
\set f '''0c5c5c50-0000-4000-8000-0000000000f1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:f, 'Vera_Visuell') is not null as ok \gset
select tests.set_level(:f, 12);
select tests.fund(:f, 30000000, 'test:c5:f');
update public.sim_runtime set is_paused = false;
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Vera Verpackt', 'Alles an seinem Platz', 'retail', '#3366aa', 'garage', 'fashion')
  -> 'company' ->> 'id' as cid \gset
select public.company_deposit(gen_random_uuid(), 2000000) is not null as ok \gset
reset role;
update public.profiles set last_active_at = now() where id = :f;

insert into public.company_tasks (company_id, task_key, branch, game, value_cents, due_at)
values (:'cid', 'fabric_bins', 'craft', 'bins', 40000, now() + interval '40 minutes'),
       (:'cid', 'pipe_fix', 'craft', 'pipes', 44000, now() + interval '40 minutes'),
       (:'cid', 'belt_sort', 'logistics', 'conveyor', 40000, now() + interval '40 minutes');
select id as tb from public.company_tasks where company_id = :'cid' and task_key = 'fabric_bins' \gset
select id as tp from public.company_tasks where company_id = :'cid' and task_key = 'pipe_fix' \gset
select id as tc from public.company_tasks where company_id = :'cid' and task_key = 'belt_sort' \gset

select tests.login_as('authenticated', :f);
select public.start_company_task(gen_random_uuid(), :tb) as pb \gset
select public.start_company_task(gen_random_uuid(), :tp) as pp \gset
select public.start_company_task(gen_random_uuid(), :tc) as pc \gset
reset role;
select solution as sb from public.company_tasks where id = :tb \gset
select solution as sp from public.company_tasks where id = :tp \gset
select pg_temp.c5_pipe_turns(:'sp'::jsonb) as sp_turns \gset
select (select a.balance_cents from public.ledger_accounts a where a.id = public.company_cash_account(:'cid')) as cash0 \gset
select tests.login_as('authenticated', :f);
select public.submit_company_task(gen_random_uuid(), :tb, jsonb_build_object('bins', :'sb'::jsonb -> 'bins')) as ab \gset
select public.submit_company_task(gen_random_uuid(), :tp, jsonb_build_object('turns', :'sp_turns'::jsonb)) as ap \gset
-- every good into the wrong bin
select public.submit_company_task(gen_random_uuid(), :tc,
  jsonb_build_object('bins', (select jsonb_agg(((v #>> '{}')::integer + 1) % 3 order by o)
                                from jsonb_array_elements(:'pc'::jsonb #> '{puzzle,items}') with ordinality x(v, o)))) as ac \gset
reset role;
select tests.assert(
  :'pb'::jsonb ->> 'game' = 'bins' and jsonb_array_length(:'pb'::jsonb #> '{puzzle,items}') = 8 and not (:'pb'::jsonb ? 'solution')
  and :'pp'::jsonb ->> 'game' = 'pipes' and jsonb_array_length(:'pp'::jsonb #> '{puzzle,tiles}') = 16
  and :'pc'::jsonb ->> 'game' = 'conveyor' and jsonb_array_length(:'pc'::jsonb #> '{puzzle,items}') = 10
  and :'ab'::jsonb ->> 'status' = 'success' and (:'ab'::jsonb ->> 'score_bps')::integer = 10000
  and :'ap'::jsonb ->> 'status' = 'success' and (:'ap'::jsonb ->> 'score_bps')::integer = 10000
  and :'ac'::jsonb ->> 'status' = 'failure' and (:'ac'::jsonb ->> 'score_bps')::integer = 0
  and (select a.balance_cents from public.ledger_accounts a where a.id = public.company_cash_account(:'cid'))
      = :cash0::bigint + (:'ab'::jsonb ->> 'result_cents')::bigint + (:'ap'::jsonb ->> 'result_cents')::bigint
        + (:'ac'::jsonb ->> 'result_cents')::bigint
  and (:'ab'::jsonb ->> 'result_cents')::bigint > 0 and (:'ac'::jsonb ->> 'result_cents')::bigint < 0,
  'start/submit_company_task(): bins and pipes solved pay the company, the conveyor all wrong costs it');

-- ---------------------------------------------------------------------------
-- 4. Weighted draw
-- ---------------------------------------------------------------------------
select tests.assert(
  (select bool_and((x ->> 'weight')::numeric > 0) from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x)
  and (select bool_and((x ->> 'weight')::numeric <= (select min((y ->> 'weight')::numeric)
                                                         from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') y
                                                        where y ->> 'game' in ('tiles', 'bins', 'untangle', 'rebuild', 'align',
                                                                               'pipes', 'sizes', 'conveyor')))
         from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x
        where x ->> 'game' in ('math', 'quick', 'receipts', 'offer', 'pattern', 'pack', 'restock', 'count', 'order', 'haggle')),
  'game_config: every task has a draw weight; maths and typing weigh less than any drag game');

create temporary table c5_draws (game text);
do $$
declare
  v_cid uuid := (select company_id from public.player_companies pc join public.companies c on c.id = pc.company_id
                  where c.name = 'Vera Verpackt');
  v_now timestamptz := now();
  k     integer;
begin
  update public.player_companies set tasks_auto_ai = false where company_id = v_cid;
  for k in 1..300 loop
    delete from public.company_tasks where company_id = v_cid;
    update public.player_companies set tasks_last_created_at = null where company_id = v_cid;
    update public.profiles set last_active_at = v_now
     where id = (select founder_id from public.player_companies where company_id = v_cid);
    perform public.company_tasks_run_due(v_now);
    insert into c5_draws select game from public.company_tasks where company_id = v_cid;
  end loop;
  delete from public.company_tasks where company_id = v_cid;
end;
$$;
select count(*) as draws,
       count(*) filter (where game in ('math', 'quick', 'receipts', 'offer', 'pattern', 'pack', 'restock', 'count', 'order', 'haggle')) as calc,
       count(*) filter (where game in ('tiles', 'bins', 'untangle', 'odd', 'rebuild', 'align', 'pipes', 'sizes', 'conveyor')) as fresh
  from c5_draws \gset
select tests.assert(:draws >= 290 and :calc::numeric / :draws <= 0.2 and :calc > 0 and :fresh::numeric / :draws >= 0.15,
  format('company_tasks_run_due(): weighted draw, maths and typing %s of %s, new drag and see games %s', :calc, :draws, :fresh));

-- ---------------------------------------------------------------------------
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after the drag and see games');
