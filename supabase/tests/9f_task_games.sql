-- =============================================================================
-- 9f · Hands-on task games: slider, rotate, match, path (ADR-144)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

-- the catalogue entries of the new games, one per game
select x as slider_def from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x where x ->> 'key' = 'align_labels' \gset
select x as rotate_def from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x where x ->> 'key' = 'fix_antenna' \gset
select x as match_def from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x where x ->> 'key' = 'file_documents' \gset
select x as path_def from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x where x ->> 'key' = 'office_route' \gset

select tests.assert(
  :'slider_def'::jsonb ->> 'game' = 'slider' and :'rotate_def'::jsonb ->> 'game' = 'rotate'
  and :'match_def'::jsonb ->> 'game' = 'match' and :'path_def'::jsonb ->> 'game' = 'path'
  and (select count(*) from jsonb_array_elements(public.company_tasks_cfg() -> 'tasks') x
        where x ->> 'game' in ('slider', 'rotate', 'match', 'path')) >= 20,
  'game_config.companyTasks: the new games have their own tasks (ADR-144)');

-- --- slider -----------------------------------------------------------------------------------------------------
select tests.assert(
  (select bool_and(jsonb_array_length(z -> 'puzzle' -> 'targets') = 3
                   and z -> 'puzzle' -> 'targets' = z -> 'solution' -> 'positions'
                   and (z -> 'solution' ->> 'tolerance')::int = 3
                   and public.company_task_grade('slider', z -> 'solution',
                         jsonb_build_object('positions', z -> 'puzzle' -> 'targets')) = 10000
                   and (select bool_and(v::int between 20 and 92) from jsonb_array_elements_text(z -> 'puzzle' -> 'targets') v))
     from generate_series(1, 20) g, lateral (select public.company_task_puzzle(:'slider_def'::jsonb) as z) p),
  'company_task_puzzle(slider): three gaps between 20 and 92, the gaps themselves score full marks');
select tests.assert(
  public.company_task_grade('slider', '{"positions": [30, 50, 70], "tolerance": 3}', '{"positions": [33, 47, 70]}') = 10000
  and public.company_task_grade('slider', '{"positions": [30, 50, 70], "tolerance": 3}', '{"positions": [34, 50, 70]}') = 8333
  and public.company_task_grade('slider', '{"positions": [30, 50, 70], "tolerance": 3}', '{"positions": [40, 50, 0]}') = 3333
  and public.company_task_grade('slider', '{"positions": [30, 50, 70], "tolerance": 3}', '{"positions": [0, 0, 0]}') = 0
  and public.company_task_grade('slider', '{"positions": [30, 50, 70], "tolerance": 3}', '{"positions": [30, "x"]}') = 3333
  and public.company_task_grade('slider', '{"positions": [30, 50, 70], "tolerance": 3}', '{"positions": 30}') = 0,
  'company_task_grade(slider): within the tolerance full, within three times half, else nothing (same as gradeAnswer)');

-- --- rotate -----------------------------------------------------------------------------------------------------
select tests.assert(
  (select bool_and(jsonb_array_length(z -> 'puzzle' -> 'start') = 3
                   and z -> 'puzzle' -> 'target' = z -> 'solution' -> 'dials'
                   and public.company_task_grade('rotate', z -> 'solution',
                         jsonb_build_object('dials', z -> 'puzzle' -> 'target')) = 10000
                   and public.company_task_grade('rotate', z -> 'solution',
                         jsonb_build_object('dials', z -> 'puzzle' -> 'start')) = 0)
     from generate_series(1, 20) g, lateral (select public.company_task_puzzle(:'rotate_def'::jsonb) as z) p),
  'company_task_puzzle(rotate): every dial starts at least two steps away, the marks score full marks');
select tests.assert(
  public.company_task_grade('rotate', '{"dials": [0, 3, 7], "steps": 8}', '{"dials": [0, 3, 7]}') = 10000
  and public.company_task_grade('rotate', '{"dials": [0, 3, 7], "steps": 8}', '{"dials": [7, 3, 0]}') = 6666
  and public.company_task_grade('rotate', '{"dials": [0, 3, 7], "steps": 8}', '{"dials": [4, 5, 3]}') = 0
  and public.company_task_grade('rotate', '{"dials": [0, 3, 7], "steps": 8}', '{"dials": [8, 11, 15]}') = 10000,
  'company_task_grade(rotate): one step off is half, turns wrap around');

-- --- match ------------------------------------------------------------------------------------------------------
select tests.assert(
  (select bool_and(jsonb_array_length(z -> 'puzzle' -> 'items') = 6
                   and (z -> 'puzzle' ->> 'boxes')::int = 3
                   and (select bool_and((s.v)::int = (it.v)::int / 3) and count(distinct it.v) = 6
                          from jsonb_array_elements_text(z -> 'puzzle' -> 'items') with ordinality it(v, i)
                          join jsonb_array_elements_text(z -> 'solution' -> 'boxes') with ordinality s(v, i) on s.i = it.i)
                   and (select bool_and(n = 2) from (select count(*) n from jsonb_array_elements_text(z -> 'solution' -> 'boxes') b
                                                      group by b) c)
                   and public.company_task_grade('match', z -> 'solution', z -> 'solution') = 10000)
     from generate_series(1, 20) g, lateral (select public.company_task_puzzle(:'match_def'::jsonb) as z) p),
  'company_task_puzzle(match): two cards of each box, each belongs in the box of its group');
select tests.assert(
  public.company_task_grade('match', '{"boxes": [0, 2, 1, 1, 0, 2]}', '{"boxes": [0, 2, 1, 1, 0, 2]}') = 10000
  and public.company_task_grade('match', '{"boxes": [0, 2, 1, 1, 0, 2]}', '{"boxes": [0, 2, 1, 1, 2, 0]}') = 6666
  and public.company_task_grade('match', '{"boxes": [0, 2, 1, 1, 0, 2]}', '{"boxes": [-1, -1, -1, -1, -1, -1]}') = 0,
  'company_task_grade(match): graded per card');

-- --- path -------------------------------------------------------------------------------------------------------
select tests.assert(
  public.company_task_path_length(3, 0, 2, '{1}') = 4
  and public.company_task_path_length(3, 0, 2, '{1,4,7}') is null
  and public.company_task_path_length(5, 10, 14, '{7,12,17}') = 8,
  'company_task_path_length(): breadth-first shortest route, null without one');
select tests.assert(
  (select bool_and((z -> 'puzzle' ->> 'start')::int % 5 = 0
                   and (z -> 'puzzle' ->> 'goal')::int % 5 = 4
                   and jsonb_array_length(z -> 'puzzle' -> 'walls') between 3 and 9
                   and not (z -> 'puzzle' -> 'walls') @> to_jsonb((z -> 'puzzle' ->> 'start')::int)
                   and not (z -> 'puzzle' -> 'walls') @> to_jsonb((z -> 'puzzle' ->> 'goal')::int)
                   and (z -> 'solution' ->> 'length')::int = public.company_task_path_length(5,
                         (z -> 'puzzle' ->> 'start')::int, (z -> 'puzzle' ->> 'goal')::int,
                         array(select w::int from jsonb_array_elements_text(z -> 'puzzle' -> 'walls') w))
                   and (z -> 'solution' ->> 'length')::int
                       >= abs((z -> 'puzzle' ->> 'start')::int / 5 - (z -> 'puzzle' ->> 'goal')::int / 5) + 4 + 2
                   and (z -> 'solution' ->> 'step_bps')::int = 1000)
     from generate_series(1, 20) g, lateral (select public.company_task_puzzle(:'path_def'::jsonb) as z) p),
  'company_task_puzzle(path): left edge to right edge, walls force a detour, the solution knows the shortest length');
-- 3×3: start 0, goal 2, wall 1 -> 0 3 4 5 2
\set psol '''{"size": 3, "start": 0, "goal": 2, "walls": [1], "length": 4, "step_bps": 1000}'''
select tests.assert(
  public.company_task_grade('path', :psol, '{"path": [0, 3, 4, 5, 2]}') = 10000
  and public.company_task_grade('path', :psol, '{"path": [0, 3, 6, 7, 4, 5, 2]}') = 8000
  and public.company_task_grade('path', :psol, '{"path": [0, 1, 2]}') = 0
  and public.company_task_grade('path', :psol, '{"path": [0, 4, 5, 2]}') = 0
  and public.company_task_grade('path', :psol, '{"path": [0, 3, 4, 5]}') = 0
  and public.company_task_grade('path', :psol, '{"path": [0, 3, 4, 3, 4, 5, 2]}') = 0
  and public.company_task_grade('path', :psol, '{"path": [0, 3, 4.5, 5, 2]}') = 0
  and public.company_task_grade('path', :psol, '{"path": [0, 3, 4, 5, 99]}') = 0
  and public.company_task_grade('path', :psol, '{"path": "0,3,4,5,2"}') = 0,
  'company_task_grade(path): the shortest route full marks, each extra step −10 %, broken routes nothing');

-- --- the whole round: a match task played through the RPCs ---------------------------------------------------------
\set f '''09f09f09-0000-4000-8000-0000000000f1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:f, 'Greta_Griff') is not null as ok \gset
select tests.set_level(:f, 12);
select tests.fund(:f, 30000000, 'test:task-games:f');
update public.sim_runtime set is_paused = false;
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Griff GmbH', 'Alles am richtigen Platz', 'retail', '#3366aa', 'garage', 'online_shop')
  -> 'company' ->> 'id' as cid \gset
reset role;
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, due_at)
values (:'cid', 'warehouse_bins', 'logistics', 'match', 40000, now() + interval '40 minutes'),
       (:'cid', 'office_route', 'logistics', 'path', 32000, now() + interval '40 minutes');
select id as tm from public.company_tasks where company_id = :'cid' and task_key = 'warehouse_bins' \gset
select id as tp from public.company_tasks where company_id = :'cid' and task_key = 'office_route' \gset
select tests.login_as('authenticated', :f);
select public.start_company_task(gen_random_uuid(), :tm) as pm \gset
select public.start_company_task(gen_random_uuid(), :tp) as pp \gset
reset role;
select solution as msol from public.company_tasks where id = :tm \gset
select tests.login_as('authenticated', :f);
select public.submit_company_task(gen_random_uuid(), :tm, :'msol'::jsonb) as am \gset
-- the path task: a route that does not reach the goal
select public.submit_company_task(gen_random_uuid(), :tp,
  jsonb_build_object('path', jsonb_build_array((:'pp'::jsonb -> 'puzzle' ->> 'start')::int))) as ap \gset
reset role;
select tests.assert(
  :'pm'::jsonb ->> 'game' = 'match' and jsonb_array_length(:'pm'::jsonb -> 'puzzle' -> 'items') = 6
  and not (:'pm'::jsonb ? 'solution')
  and :'pp'::jsonb ->> 'game' = 'path' and (:'pp'::jsonb -> 'puzzle' ->> 'size')::int = 5
  and (:'pp'::jsonb ->> 'seconds')::int = 40
  and :'am'::jsonb ->> 'status' = 'success' and (:'am'::jsonb ->> 'score_bps')::int = 10000
  and :'ap'::jsonb ->> 'status' = 'failure' and (:'ap'::jsonb ->> 'score_bps')::int = 0
  and (:'ap'::jsonb -> 'solution' ->> 'length')::int > 0,
  'start/submit_company_task(): match and path go through the RPCs; the server grades');
