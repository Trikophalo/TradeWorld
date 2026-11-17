-- ===== idempotent copy of migrations/20261204001600_task_games.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1600 · Hands-on task games: slider, rotate, match, path (ADR-144)
-- =============================================================================
-- Four new company task games you drag, turn and draw, like a captcha, solved by looking and thinking:
--   slider  {targets}                  -> {positions}  each piece within tolerance of its gap
--   rotate  {start, target, steps}     -> {dials}      each dial pointing at its mark
--   match   {items, boxes}             -> {boxes}      each card in the box its rule names
--   path    {size, start, goal, walls} -> {path}       shortest route around the walls
-- The solution carries what grading needs (tolerance, steps, the grid), so company_task_grade() stays immutable.
-- Same rules as src/lib/sim/company-tasks.ts. Idempotent: runs unchanged as supabase/updates/20261204001600_task_games.sql.

-- (update copy only, ADR-173: once 6400 allowed more games, rows may use them; this older constraint is then skipped
--  and 6400 sets the full one again further down)
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_tasks_game_check'
                    and pg_get_constraintdef(oid) like '%memory%') then
    alter table public.company_tasks drop constraint if exists company_tasks_game_check;
    alter table public.company_tasks add constraint company_tasks_game_check
      check (game in ('pick', 'count', 'sort', 'order', 'seq', 'math', 'slider', 'rotate', 'match', 'path'));
  end if;
end;
$do$;

-- Moves of the shortest route from p_start to p_goal on a p_size × p_size grid around the walls (breadth-first);
-- null if there is none. Cells are numbered row by row from 0.
create or replace function public.company_task_path_length(p_size integer, p_start integer, p_goal integer,
                                                           p_walls integer[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_dist  integer[] := array_fill(-1, array[p_size * p_size]);
  v_queue integer[] := array[p_start];
  v_head  integer := 1;
  v_cell  integer;
  v_nb    integer;
  v_r     integer;
  v_c     integer;
begin
  v_dist[p_start + 1] := 0;
  while v_head <= array_length(v_queue, 1) loop
    v_cell := v_queue[v_head];
    v_head := v_head + 1;
    if v_cell = p_goal then
      return v_dist[v_cell + 1];
    end if;
    v_r := v_cell / p_size;
    v_c := v_cell % p_size;
    foreach v_nb in array array[case when v_r > 0 then v_cell - p_size else -1 end,
                                case when v_r < p_size - 1 then v_cell + p_size else -1 end,
                                case when v_c > 0 then v_cell - 1 else -1 end,
                                case when v_c < p_size - 1 then v_cell + 1 else -1 end] loop
      if v_nb >= 0 and v_dist[v_nb + 1] = -1 and not (v_nb = any (coalesce(p_walls, '{}'))) then
        v_dist[v_nb + 1] := v_dist[v_cell + 1] + 1;
        v_queue := v_queue || v_nb;
      end if;
    end loop;
  end loop;
  return null;
end;
$$;

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
begin
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
begin
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' then
    return 0;
  end if;
  if p_game = 'pick' then
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
  elsif p_game in ('slider', 'rotate') then
    -- ADR-144: per piece or dial exact (slider: within the tolerance) full marks, close half; the average counts
    v_key := case p_game when 'slider' then 'positions' else 'dials' end;
    if jsonb_typeof(p_answer -> v_key) <> 'array' then
      return 0;
    end if;
    if p_game = 'slider' then
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
                        when p_game = 'slider' then abs((a.v #>> '{}')::numeric - (s.v #>> '{}')::numeric)
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
  else
    v_key := case p_game when 'sort' then 'sides' when 'order' then 'order' when 'match' then 'boxes' else 'sequence' end;
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

revoke all on function public.company_task_path_length(integer, integer, integer, integer[]) from public, anon, authenticated;
