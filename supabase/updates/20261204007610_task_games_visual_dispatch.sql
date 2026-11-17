-- ===== idempotent copy of migrations/20261204007610_task_games_visual_dispatch.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 7610 · Task games: hand the drag and see games over (ADR-186)
-- =============================================================================
-- company_task_puzzle() and company_task_grade() in full: the latest definitions (6400 with the hand-over of 6920)
-- plus the hand-over of the nine games of 7600 to company_task_puzzle_visual() and company_task_grade_visual().
-- Idempotent: runs unchanged as supabase/updates/20261204007610_task_games_visual_dispatch.sql.

create or replace function public.company_task_puzzle(p_task jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g        jsonb := public.company_tasks_cfg() -> 'games' -> (p_task ->> 'game');
  v_game   text := p_task ->> 'game';
  v_n      integer;
  v_tiles  jsonb;
  v_sol    jsonb;
  v_vals   integer[] := '{}';
  v_v      integer;
  a        integer;
  b        integer;
  v_size   integer;
  v_start  integer;
  v_goal   integer;
  v_walls  integer[];
  v_len    integer;
  v_try    integer;
  v_prev   integer;
  v_cap    integer;
  v_w      integer[];
begin
  if v_game in ('restock', 'receipts', 'offer', 'pattern', 'shelf') then  -- ADR-180
    return public.company_task_puzzle_more(p_task);
  end if;
  if v_game in ('tiles', 'bins', 'untangle', 'odd', 'rebuild', 'align', 'pipes', 'sizes', 'conveyor') then  -- ADR-186
    return public.company_task_puzzle_visual(p_task);
  end if;
  if v_game in ('pick', 'count') then
    v_n := public.rand_between((g ->> 'minTargets')::integer, (g ->> 'maxTargets')::integer);
    with t as (
      select i, case when i <= v_n then 0 else 1 + floor(random() * 2)::integer end as lab
        from generate_series(1, (g ->> 'tiles')::integer) i),
    s as (select lab, row_number() over (order by random()) - 1 as pos from t)
    select jsonb_agg(lab order by pos), coalesce(jsonb_agg(pos order by pos) filter (where lab = 0), '[]'::jsonb)
      into v_tiles, v_sol from s;
    if v_game = 'pick' then
      return jsonb_build_object('puzzle', jsonb_build_object('tiles', v_tiles), 'solution', jsonb_build_object('targets', v_sol));
    end if;
    return jsonb_build_object('puzzle', jsonb_build_object('tiles', v_tiles), 'solution', jsonb_build_object('count', v_n));
  elsif v_game = 'sort' then
    with s as (select i, row_number() over (order by random()) as pos from generate_series(0, (g ->> 'items')::integer - 1) i)
    select jsonb_agg(i order by pos), jsonb_agg(case when i < (g ->> 'items')::integer / 2 then 0 else 1 end order by pos)
      into v_tiles, v_sol from s;
    return jsonb_build_object('puzzle', jsonb_build_object('items', v_tiles), 'solution', jsonb_build_object('sides', v_sol));
  elsif v_game = 'order' then
    while coalesce(array_length(v_vals, 1), 0) < (g ->> 'items')::integer loop
      -- the task's own realistic range (ADR-140), else the game's default
      v_v := public.rand_between(coalesce((p_task -> 'range' ->> 0)::integer, (g ->> 'min')::integer),
                                 coalesce((p_task -> 'range' ->> 1)::integer, (g ->> 'max')::integer));
      if not v_v = any (v_vals) then
        v_vals := v_vals || v_v;
      end if;
    end loop;
    select jsonb_agg(i - 1 order by case when coalesce((p_task ->> 'asc')::boolean, true) then v else -v end)
      into v_sol from unnest(v_vals) with ordinality as x(v, i);
    return jsonb_build_object('puzzle', jsonb_build_object('values', to_jsonb(v_vals)),
                              'solution', jsonb_build_object('order', v_sol));
  elsif v_game = 'seq' then
    select jsonb_agg(floor(random() * 4)::integer) into v_sol from generate_series(1, (g ->> 'length')::integer);
    return jsonb_build_object('puzzle', jsonb_build_object('sequence', v_sol, 'show_seconds', (g ->> 'showSeconds')::integer),
                              'solution', jsonb_build_object('sequence', v_sol));
  elsif v_game = 'math' then
    a := public.rand_between((p_task -> 'a' ->> 0)::integer, (p_task -> 'a' ->> 1)::integer);
    b := public.rand_between((p_task -> 'b' ->> 0)::integer, (p_task -> 'b' ->> 1)::integer);
    if p_task ->> 'op' = 'pct' then
      -- whole results: big amounts in hundreds, small ones in tens with rates in tens
      if (p_task -> 'a' ->> 1)::integer >= 1000 then
        a := greatest(100, (a / 100) * 100);
      else
        a := greatest(10, (a / 10) * 10);
        b := greatest(10, (b / 10) * 10);
      end if;
    end if;
    v_v := case p_task ->> 'op' when 'mul' then a * b when 'add' then a + b when 'sub' then a - b
                                when 'pct' then a * b / 100 end;
    return jsonb_build_object('puzzle', jsonb_build_object('a', a, 'b', b), 'solution', jsonb_build_object('value', v_v));
  elsif v_game = 'slider' then
    -- ADR-144: one gap per slider on a track of 0..100; the piece starts at 0
    select jsonb_agg(public.rand_between((g ->> 'min')::integer, (g ->> 'max')::integer) order by i)
      into v_sol from generate_series(1, (g ->> 'sliders')::integer) i;
    return jsonb_build_object('puzzle', jsonb_build_object('targets', v_sol),
                              'solution', jsonb_build_object('positions', v_sol, 'tolerance', (g ->> 'tolerance')::integer));
  elsif v_game = 'rotate' then
    -- every dial starts minTurn .. steps - minTurn steps away from its mark
    select jsonb_agg(t order by i),
           jsonb_agg((t + public.rand_between((g ->> 'minTurn')::integer, (g ->> 'steps')::integer - (g ->> 'minTurn')::integer))
                     % (g ->> 'steps')::integer order by i)
      into v_sol, v_tiles
      from (select i, public.rand_between(0, (g ->> 'steps')::integer - 1) as t
              from generate_series(1, (g ->> 'dials')::integer) i) x;
    return jsonb_build_object('puzzle', jsonb_build_object('start', v_tiles, 'target', v_sol, 'steps', (g ->> 'steps')::integer),
                              'solution', jsonb_build_object('dials', v_sol, 'steps', (g ->> 'steps')::integer));
  elsif v_game = 'match' then
    -- perBox of the groupSize cards of every box, shuffled; card i belongs in box i / groupSize
    with c as (
      select bx, k, row_number() over (partition by bx order by random()) as rn
        from generate_series(0, (g ->> 'boxes')::integer - 1) bx, generate_series(0, (g ->> 'groupSize')::integer - 1) k),
    s as (select bx * (g ->> 'groupSize')::integer + k as item, bx, row_number() over (order by random()) as pos
            from c where rn <= (g ->> 'perBox')::integer)
    select jsonb_agg(item order by pos), jsonb_agg(bx order by pos) into v_tiles, v_sol from s;
    return jsonb_build_object('puzzle', jsonb_build_object('items', v_tiles, 'boxes', (g ->> 'boxes')::integer),
                              'solution', jsonb_build_object('boxes', v_sol));
  elsif v_game = 'path' then
    -- start on the left edge, goal on the right; the walls must force a detour of at least minDetour steps
    v_size := (g ->> 'size')::integer;
    for v_try in 1..60 loop
      v_start := public.rand_between(0, v_size - 1) * v_size;
      v_goal := public.rand_between(0, v_size - 1) * v_size + v_size - 1;
      v_n := public.rand_between((g ->> 'minWalls')::integer, (g ->> 'maxWalls')::integer);
      select coalesce(array_agg(c order by c), '{}') into v_walls
        from (select c from generate_series(0, v_size * v_size - 1) c
               where c not in (v_start, v_goal) order by random() limit v_n) x;
      v_len := public.company_task_path_length(v_size, v_start, v_goal, v_walls);
      exit when v_len is not null
            and v_len >= abs(v_start / v_size - v_goal / v_size) + v_size - 1 + (g ->> 'minDetour')::integer;
      v_len := null;
    end loop;
    if v_len is null then
      -- fallback: a wall across the middle column
      v_start := (v_size / 2) * v_size;
      v_goal := v_start + v_size - 1;
      select array_agg(k * v_size + v_size / 2 order by k) into v_walls from generate_series(1, v_size - 2) k;
      v_len := public.company_task_path_length(v_size, v_start, v_goal, v_walls);
    end if;
    return jsonb_build_object(
      'puzzle', jsonb_build_object('size', v_size, 'start', v_start, 'goal', v_goal, 'walls', to_jsonb(v_walls)),
      'solution', jsonb_build_object('size', v_size, 'start', v_start, 'goal', v_goal, 'walls', to_jsonb(v_walls),
                                     'length', v_len, 'step_bps', (g ->> 'stepBps')::integer));
  elsif v_game = 'memory' then
    -- ADR-173: every label twice, face down, shuffled
    select jsonb_agg(c.lab order by c.r) into v_sol
      from (select i / 2 as lab, random() as r from generate_series(0, 2 * (g ->> 'pairs')::integer - 1) i) c;
    return jsonb_build_object('puzzle', jsonb_build_object('cards', v_sol),
                              'solution', jsonb_build_object('cards', v_sol, 'miss_bps', (g ->> 'missBps')::integer));
  elsif v_game = 'timing' then
    select jsonb_agg(public.rand_between((g ->> 'min')::integer, (g ->> 'max')::integer) order by i)
      into v_sol from generate_series(1, (g ->> 'rounds')::integer) i;
    return jsonb_build_object('puzzle', jsonb_build_object('targets', v_sol, 'sweep_ms', (g ->> 'sweepMs')::integer),
                              'solution', jsonb_build_object('stops', v_sol, 'tolerance', (g ->> 'tolerance')::integer));
  elsif v_game = 'diff' then
    -- the copy differs from the original in minDiffs..maxDiffs cells, each with another label
    v_size := (g ->> 'cells')::integer;
    v_n := (g ->> 'symbols')::integer;
    select array_agg(public.rand_between(0, v_n - 1) order by i) into v_vals from generate_series(1, v_size) i;
    select coalesce(array_agg(c order by c), '{}') into v_walls
      from (select c from generate_series(0, v_size - 1) c order by random()
             limit public.rand_between((g ->> 'minDiffs')::integer, (g ->> 'maxDiffs')::integer)) x;
    select jsonb_agg(case when (i - 1) = any (v_walls) then (v_vals[i] + 1 + public.rand_between(0, v_n - 2)) % v_n
                          else v_vals[i] end order by i)
      into v_tiles from generate_series(1, v_size) i;
    return jsonb_build_object('puzzle', jsonb_build_object('left', to_jsonb(v_vals), 'right', v_tiles),
                              'solution', jsonb_build_object('targets', to_jsonb(v_walls)));
  elsif v_game = 'quick' then
    -- problems sums with the task's operation; the right result and two near misses, shuffled
    v_tiles := '[]'::jsonb;
    v_sol := '[]'::jsonb;
    for v_try in 1..(g ->> 'problems')::integer loop
      a := public.rand_between((p_task -> 'a' ->> 0)::integer, (p_task -> 'a' ->> 1)::integer);
      b := public.rand_between((p_task -> 'b' ->> 0)::integer, (p_task -> 'b' ->> 1)::integer);
      if p_task ->> 'op' = 'pct' then
        if (p_task -> 'a' ->> 1)::integer >= 1000 then
          a := greatest(100, (a / 100) * 100);
        else
          a := greatest(10, (a / 10) * 10);
          b := greatest(10, (b / 10) * 10);
        end if;
      end if;
      v_v := case coalesce(p_task ->> 'op', 'add') when 'mul' then a * b when 'add' then a + b when 'sub' then a - b
                                                   when 'pct' then a * b / 100 end;
      v_len := greatest(1, abs(v_v) / 10);
      select array_agg(o order by random()) into v_vals
        from unnest(array[v_v, v_v + v_len * public.rand_between(1, 3), v_v - v_len * public.rand_between(1, 3)]) o;
      v_tiles := v_tiles || jsonb_build_object('a', a, 'b', b, 'op', coalesce(p_task ->> 'op', 'add'), 'options', to_jsonb(v_vals));
      v_sol := v_sol || to_jsonb(array_position(v_vals, v_v) - 1);
    end loop;
    return jsonb_build_object('puzzle', jsonb_build_object('problems', v_tiles), 'solution', jsonb_build_object('choices', v_sol));
  elsif v_game = 'route' then
    -- a depot and stops on distinct fields of a grid x grid map; the shortest round trip by brute force
    v_size := (g ->> 'grid')::integer;
    select jsonb_agg(jsonb_build_array(x.c % v_size, x.c / v_size) order by x.rn) into v_tiles
      from (select c, row_number() over (order by random()) as rn from generate_series(0, v_size * v_size - 1) c) x
     where x.rn <= (g ->> 'stops')::integer + 1;
    return jsonb_build_object('puzzle', jsonb_build_object('points', v_tiles),
                              'solution', jsonb_build_object('points', v_tiles, 'best', public.company_task_route_best(v_tiles),
                                                             'step_bps', (g ->> 'stepBps')::integer));
  elsif v_game = 'haggle' then
    -- per round the three replies (0 best, 1 middle, 2 bad) in a shuffled order
    select jsonb_agg((select jsonb_agg(k order by random() + i * 0) from generate_series(0, 2) k) order by i)
      into v_sol from generate_series(1, (g ->> 'rounds')::integer) i;
    return jsonb_build_object('puzzle', jsonb_build_object('rounds', v_sol),
                              'solution', jsonb_build_object('rounds', v_sol, 'ok_bps', (g ->> 'okBps')::integer));
  elsif v_game = 'pack' then
    v_n := (g ->> 'items')::integer;
    select array_agg(public.rand_between((g ->> 'minWeight')::integer, (g ->> 'maxWeight')::integer) order by i)
      into v_w from generate_series(1, v_n) i;
    select array_agg(public.rand_between((g ->> 'minValue')::integer, (g ->> 'maxValue')::integer) order by i)
      into v_vals from generate_series(1, v_n) i;
    v_cap := greatest((g ->> 'maxWeight')::integer,
                      ((select sum(x) from unnest(v_w) x)::bigint * (g ->> 'capShareBps')::integer / 10000)::integer);
    return jsonb_build_object('puzzle', jsonb_build_object('weights', to_jsonb(v_w), 'values', to_jsonb(v_vals), 'cap', v_cap),
                              'solution', jsonb_build_object('weights', to_jsonb(v_w), 'values', to_jsonb(v_vals), 'cap', v_cap,
                                                             'best', public.company_task_pack_best(v_w, v_vals, v_cap)));
  elsif v_game = 'catch' then
    -- tiles pop up one after another, never twice on the same field in a row; at least two good ones
    v_tiles := '[]'::jsonb;
    v_prev := -1;
    for v_try in 0..(g ->> 'events')::integer - 1 loop
      v_v := public.rand_between(0, (g ->> 'cells')::integer - 1);
      if v_v = v_prev then
        v_v := (v_v + 1) % (g ->> 'cells')::integer;
      end if;
      v_prev := v_v;
      v_tiles := v_tiles || jsonb_build_object('cell', v_v, 'good', random() * 10000 < (g ->> 'goodShareBps')::integer);
    end loop;
    v_try := 0;
    while (select count(*) from jsonb_array_elements(v_tiles) e where (e ->> 'good')::boolean) < 2
          and v_try < jsonb_array_length(v_tiles) loop
      v_tiles := jsonb_set(v_tiles, array[v_try::text, 'good'], 'true'::jsonb);
      v_try := v_try + 1;
    end loop;
    select coalesce(jsonb_agg(i - 1 order by i) filter (where (e ->> 'good')::boolean), '[]'::jsonb)
      into v_sol from jsonb_array_elements(v_tiles) with ordinality x(e, i);
    return jsonb_build_object('puzzle', jsonb_build_object('events', v_tiles, 'every_ms', (g ->> 'everyMs')::integer,
                                                           'show_ms', (g ->> 'showMs')::integer),
                              'solution', jsonb_build_object('targets', v_sol));
  end if;
  raise exception 'unknown task game %', v_game;
end;
$$;

create or replace function public.company_task_grade(p_game text, p_solution jsonb, p_answer jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_hits    integer;
  v_wrong   integer;
  v_total   integer;
  v_diff    integer;
  v_key     text;
  v_sum     bigint;
  v_exact   numeric;
  v_half    numeric;
  v_steps   numeric;
  v_size    integer;
  v_route   integer[];
  v_k       integer;
  v_e       jsonb;
  v_i       numeric;
  v_j       numeric;
  v_used    integer[];
begin
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' then
    return 0;
  end if;
  if p_game in ('restock', 'receipts', 'offer', 'pattern', 'shelf') then  -- ADR-180
    return public.company_task_grade_more(p_game, p_solution, p_answer);
  end if;
  if p_game in ('tiles', 'bins', 'untangle', 'odd', 'rebuild', 'align', 'pipes', 'sizes', 'conveyor') then  -- ADR-186
    return public.company_task_grade_visual(p_game, p_solution, p_answer);
  end if;
  if p_game in ('pick', 'diff', 'catch') then
    if jsonb_typeof(p_answer -> 'picked') <> 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> 'targets');
    select count(*) filter (where p_solution -> 'targets' @> to_jsonb(x)),
           count(*) filter (where not p_solution -> 'targets' @> to_jsonb(x))
      into v_hits, v_wrong
      from (select distinct x from jsonb_array_elements(p_answer -> 'picked') x) d;
    return greatest(0, least(10000, ((v_hits - v_wrong) * 10000) / greatest(v_total, 1)));
  elsif p_game in ('count', 'math') then
    v_key := case p_game when 'count' then 'count' else 'value' end;
    if jsonb_typeof(p_answer -> v_key) <> 'number' then
      return 0;
    end if;
    v_diff := abs((p_answer ->> v_key)::numeric - (p_solution ->> v_key)::numeric);
    return case when v_diff = 0 then 10000 when p_game = 'count' and v_diff = 1 then 5000 else 0 end;
  elsif p_game in ('slider', 'rotate', 'timing') then
    -- ADR-144: per piece or dial exact (slider: within the tolerance) full marks, close half; the average counts
    v_key := case p_game when 'slider' then 'positions' when 'timing' then 'stops' else 'dials' end;
    if jsonb_typeof(p_answer -> v_key) <> 'array' then
      return 0;
    end if;
    if p_game in ('slider', 'timing') then
      v_exact := (p_solution ->> 'tolerance')::numeric;
      v_half := 3 * v_exact;
    else
      v_exact := 0;
      v_half := 1;
      v_steps := (p_solution ->> 'steps')::numeric;
    end if;
    v_total := jsonb_array_length(p_solution -> v_key);
    select coalesce(sum(case when d is null then 0 when d <= v_exact then 10000 when d <= v_half then 5000 else 0 end), 0)
      into v_sum
      from (select case when a.v is null or jsonb_typeof(a.v) <> 'number' then null
                        when p_game in ('slider', 'timing') then abs((a.v #>> '{}')::numeric - (s.v #>> '{}')::numeric)
                        else least(abs((a.v #>> '{}')::numeric - (s.v #>> '{}')::numeric) % v_steps,
                                   v_steps - abs((a.v #>> '{}')::numeric - (s.v #>> '{}')::numeric) % v_steps)
                   end as d
              from jsonb_array_elements(p_solution -> v_key) with ordinality s(v, i)
              left join jsonb_array_elements(p_answer -> v_key) with ordinality a(v, i) on a.i = s.i) x;
    return (v_sum / greatest(v_total, 1))::integer;
  elsif p_game = 'path' then
    -- a route from start to goal in single steps, around the walls, no cell twice; each extra step costs step_bps
    if jsonb_typeof(p_answer -> 'path') <> 'array' then
      return 0;
    end if;
    v_size := (p_solution ->> 'size')::integer;
    if exists (select 1 from jsonb_array_elements(p_answer -> 'path') e
                where case when jsonb_typeof(e) <> 'number' then true
                           else (e #>> '{}')::numeric % 1 <> 0
                             or (e #>> '{}')::numeric not between 0 and v_size * v_size - 1 end) then
      return 0;
    end if;
    select array_agg((e #>> '{}')::numeric::integer order by i) into v_route
      from jsonb_array_elements(p_answer -> 'path') with ordinality x(e, i);
    v_total := coalesce(array_length(v_route, 1), 0);
    if v_total < 2 or v_route[1] <> (p_solution ->> 'start')::integer
       or v_route[v_total] <> (p_solution ->> 'goal')::integer then
      return 0;
    end if;
    if (select count(distinct c) from unnest(v_route) c) <> v_total
       or exists (select 1 from jsonb_array_elements_text(p_solution -> 'walls') w where w::integer = any (v_route)) then
      return 0;
    end if;
    for v_k in 2..v_total loop
      if abs(v_route[v_k] / v_size - v_route[v_k - 1] / v_size)
         + abs(v_route[v_k] % v_size - v_route[v_k - 1] % v_size) <> 1 then
        return 0;
      end if;
    end loop;
    return greatest(0, least(10000,
      10000 - (v_total - 1 - (p_solution ->> 'length')::integer) * (p_solution ->> 'step_bps')::integer));
  elsif p_game = 'memory' then
    -- ADR-173: pairs of equal cards, each card once; every wrong flip costs miss_bps
    if jsonb_typeof(p_answer -> 'pairs') <> 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> 'cards');
    v_used := '{}';
    v_hits := 0;
    for v_e in select x from jsonb_array_elements(p_answer -> 'pairs') x loop
      continue when jsonb_typeof(v_e) <> 'array';
      continue when jsonb_array_length(v_e) <> 2;
      continue when jsonb_typeof(v_e -> 0) <> 'number' or jsonb_typeof(v_e -> 1) <> 'number';
      v_i := (v_e ->> 0)::numeric;
      v_j := (v_e ->> 1)::numeric;
      continue when v_i % 1 <> 0 or v_j % 1 <> 0 or v_i < 0 or v_j < 0 or v_i >= v_total or v_j >= v_total or v_i = v_j;
      continue when v_i::integer = any (v_used) or v_j::integer = any (v_used)
                 or p_solution -> 'cards' -> v_i::integer <> p_solution -> 'cards' -> v_j::integer;
      v_used := v_used || v_i::integer || v_j::integer;
      v_hits := v_hits + 1;
    end loop;
    v_wrong := 0;
    if jsonb_typeof(p_answer -> 'misses') = 'number' then
      v_i := (p_answer ->> 'misses')::numeric;
      if v_i % 1 = 0 and v_i > 0 then
        v_wrong := least(v_i, 100000)::integer;
      end if;
    end if;
    return greatest(0, least(10000, (v_hits * 10000) / greatest(v_total / 2, 1) - v_wrong * (p_solution ->> 'miss_bps')::integer));
  elsif p_game in ('route', 'pack') then
    -- route: a full order of the stops 1..n; pack: distinct items 0..n-1 within the capacity
    v_key := case p_game when 'route' then 'order' else 'picked' end;
    if jsonb_typeof(p_answer -> v_key) <> 'array' then
      return 0;
    end if;
    v_total := case p_game when 'route' then jsonb_array_length(p_solution -> 'points') - 1
                           else jsonb_array_length(p_solution -> 'weights') end;
    if exists (select 1 from jsonb_array_elements(p_answer -> v_key) e
                where case when jsonb_typeof(e) <> 'number' then true
                           when p_game = 'route' then (e #>> '{}')::numeric % 1 <> 0 or (e #>> '{}')::numeric not between 1 and v_total
                           else (e #>> '{}')::numeric % 1 <> 0 or (e #>> '{}')::numeric not between 0 and v_total - 1 end) then
      return 0;
    end if;
    select coalesce(array_agg((e #>> '{}')::numeric::integer order by i), '{}') into v_route
      from jsonb_array_elements(p_answer -> v_key) with ordinality x(e, i);
    v_k := coalesce(array_length(v_route, 1), 0);
    if (select count(distinct c) from unnest(v_route) c) <> v_k or (p_game = 'route' and v_k <> v_total) then
      return 0;
    end if;
    if p_game = 'route' then
      return greatest(0, least(10000, 10000 - (public.company_task_tour_length(p_solution -> 'points', v_route)
                                               - (p_solution ->> 'best')::integer) * (p_solution ->> 'step_bps')::integer));
    end if;
    select coalesce(sum((p_solution -> 'weights' ->> c)::integer), 0), coalesce(sum((p_solution -> 'values' ->> c)::integer), 0)
      into v_hits, v_wrong from unnest(v_route) c;
    if v_hits > (p_solution ->> 'cap')::integer then
      return 0;
    end if;
    return greatest(0, least(10000, (v_wrong * 10000) / greatest((p_solution ->> 'best')::integer, 1)));
  elsif p_game = 'haggle' then
    -- per round the rank of the chosen reply: 0 full marks, 1 ok_bps, 2 nothing; the average counts
    if jsonb_typeof(p_answer -> 'choices') <> 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> 'rounds');
    select coalesce(sum(case when c.v is null or jsonb_typeof(c.v) <> 'number' then 0
                             when (c.v #>> '{}')::numeric % 1 <> 0
                               or (c.v #>> '{}')::numeric not between 0 and jsonb_array_length(r.v) - 1 then 0
                             when (r.v ->> ((c.v #>> '{}')::numeric::integer))::integer = 0 then 10000
                             when (r.v ->> ((c.v #>> '{}')::numeric::integer))::integer = 1 then (p_solution ->> 'ok_bps')::integer
                             else 0 end), 0)
      into v_sum
      from jsonb_array_elements(p_solution -> 'rounds') with ordinality r(v, i)
      left join jsonb_array_elements(p_answer -> 'choices') with ordinality c(v, i) on c.i = r.i;
    return (v_sum / greatest(v_total, 1))::integer;
  else
    v_key := case p_game when 'sort' then 'sides' when 'order' then 'order' when 'match' then 'boxes'
                         when 'quick' then 'choices' else 'sequence' end;
    if jsonb_typeof(p_answer -> v_key) <> 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> v_key);
    select count(*) into v_hits
      from jsonb_array_elements(p_solution -> v_key) with ordinality s(v, i)
      join jsonb_array_elements(p_answer -> v_key) with ordinality a(v, i) on a.i = s.i
     where a.v = s.v;
    return (v_hits * 10000) / greatest(v_total, 1);
  end if;
end;
$$;

revoke all on function public.company_task_puzzle(jsonb) from public, anon, authenticated;
revoke all on function public.company_task_grade(text, jsonb, jsonb) from public, anon, authenticated;
