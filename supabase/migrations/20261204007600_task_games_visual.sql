-- =============================================================================
-- NEXA · 7600 · Nine drag and see company task games (ADR-186)
-- =============================================================================
-- Ports of src/lib/sim/company-tasks-visual.ts (same rules, the server is the authority):
--   tiles    {size, board}                 -> {moves}   sliding puzzle; replay the slides, every tile in place counts
--   bins     {items, by, kinds}            -> {bins}    crates onto shelves by colour (by 0) or shape (by 1)
--   untangle {grid, edges, points}         -> {points}  nodes on grid points; every pair of cables that meets costs step_bps
--   odd      {rounds}                      -> {choices} per round the faulty good
--   rebuild  {size, layout, show_seconds}  -> {layout}  goods back on their cells, each at most once
--   align    {slots, parts}                -> {at}      every part onto the station with its outline
--   pipes    {size, tiles, turns, from, to}-> {turns}   closed line full marks, else the route's right share x open_bps
--   sizes    {sizes}                       -> {order}   parcels from small to big, every right place counts
--   conveyor {items, every_ms, travel_ms}  -> {bins}    right bin +1, wrong bin -1, missed (-1) 0
-- company_task_puzzle() and company_task_grade() hand these games over (migration 7610). The catalogue entries and
-- the game rules come with game_config (companyTasks.tasks, companyTasks.games).
-- Idempotent: runs unchanged as supabase/updates/20261204007600_task_games_visual.sql.

alter table public.company_tasks drop constraint if exists company_tasks_game_check;
alter table public.company_tasks add constraint company_tasks_game_check
  check (game in ('pick', 'count', 'sort', 'order', 'seq', 'math', 'slider', 'rotate', 'match', 'path',
                  'memory', 'timing', 'diff', 'quick', 'route', 'haggle', 'pack', 'catch',
                  'restock', 'receipts', 'offer', 'pattern', 'shelf',
                  'tiles', 'bins', 'untangle', 'odd', 'rebuild', 'align', 'pipes', 'sizes', 'conveyor'));

-- Whether the segments a-b and c-d meet (crossing, touching or overlapping); integer exact like segmentsMeet (TS).
create or replace function public.company_task_segments_meet(ax integer, ay integer, bx integer, by integer,
                                                             cx integer, cy integer, dx integer, dy integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d1 integer := sign((bx - ax)::bigint * (cy - ay) - (by - ay)::bigint * (cx - ax));
  d2 integer := sign((bx - ax)::bigint * (dy - ay) - (by - ay)::bigint * (dx - ax));
  d3 integer := sign((dx - cx)::bigint * (ay - cy) - (dy - cy)::bigint * (ax - cx));
  d4 integer := sign((dx - cx)::bigint * (by - cy) - (dy - cy)::bigint * (bx - cx));
begin
  if d1 <> d2 and d3 <> d4 then
    return true;
  end if;
  return (d1 = 0 and cx between least(ax, bx) and greatest(ax, bx) and cy between least(ay, by) and greatest(ay, by))
      or (d2 = 0 and dx between least(ax, bx) and greatest(ax, bx) and dy between least(ay, by) and greatest(ay, by))
      or (d3 = 0 and ax between least(cx, dx) and greatest(cx, dx) and ay between least(cy, dy) and greatest(cy, dy))
      or (d4 = 0 and bx between least(cx, dx) and greatest(cx, dx) and by between least(cy, dy) and greatest(cy, dy));
end;
$$;

-- Pairs of cables (edges [[a, b], ...]) without a common node that meet, at points [[x, y], ...].
create or replace function public.company_task_crossings(p_edges jsonb, p_points jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
    from jsonb_array_elements(p_edges) with ordinality e(v, i)
    join jsonb_array_elements(p_edges) with ordinality f(v, j) on f.j > e.i
   where (e.v ->> 0) not in (f.v ->> 0, f.v ->> 1) and (e.v ->> 1) not in (f.v ->> 0, f.v ->> 1)
     and public.company_task_segments_meet(
           (p_points -> (e.v ->> 0)::integer ->> 0)::integer, (p_points -> (e.v ->> 0)::integer ->> 1)::integer,
           (p_points -> (e.v ->> 1)::integer ->> 0)::integer, (p_points -> (e.v ->> 1)::integer ->> 1)::integer,
           (p_points -> (f.v ->> 0)::integer ->> 0)::integer, (p_points -> (f.v ->> 0)::integer ->> 1)::integer,
           (p_points -> (f.v ->> 1)::integer ->> 0)::integer, (p_points -> (f.v ->> 1)::integer ->> 1)::integer);
$$;

-- Openings of a pipe (bits N 1, E 2, S 4, W 8): straight (0) N+S or corner (1) N+E, turned clockwise p_turn times.
create or replace function public.company_task_pipe_mask(p_kind integer, p_turn integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select ((m << r) | (m >> (4 - r))) & 15
    from (select case when p_kind = 1 then 3 else 5 end as m, ((p_turn % 4) + 4) % 4 as r) x;
$$;

-- Whether water flows from the left edge at row p_from to the right edge at row p_to (pipesConnected, TS).
create or replace function public.company_task_pipes_connected(p_size integer, p_tiles integer[], p_turns integer[],
                                                               p_from integer, p_to integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_open  integer[];
  v_queue integer[];
  v_head  integer := 1;
  v_cell  integer;
  v_r     integer;
  v_c     integer;
  v_sink  integer := p_to * p_size + p_size - 1;
begin
  select array_agg(public.company_task_pipe_mask(p_tiles[i], coalesce(p_turns[i], 0)) order by i)
    into v_open from generate_series(1, array_length(p_tiles, 1)) i;
  if v_open[p_from * p_size + 1] & 8 = 0 then
    return false;
  end if;
  v_queue := array[p_from * p_size];
  while v_head <= array_length(v_queue, 1) loop
    v_cell := v_queue[v_head];
    v_head := v_head + 1;
    v_r := v_cell / p_size;
    v_c := v_cell % p_size;
    if v_r > 0 and v_open[v_cell + 1] & 1 <> 0 and v_open[v_cell - p_size + 1] & 4 <> 0
       and not (v_cell - p_size) = any (v_queue) then
      v_queue := v_queue || (v_cell - p_size);
    end if;
    if v_c < p_size - 1 and v_open[v_cell + 1] & 2 <> 0 and v_open[v_cell + 2] & 8 <> 0
       and not (v_cell + 1) = any (v_queue) then
      v_queue := v_queue || (v_cell + 1);
    end if;
    if v_r < p_size - 1 and v_open[v_cell + 1] & 4 <> 0 and v_open[v_cell + p_size + 1] & 1 <> 0
       and not (v_cell + p_size) = any (v_queue) then
      v_queue := v_queue || (v_cell + p_size);
    end if;
    if v_c > 0 and v_open[v_cell + 1] & 8 <> 0 and v_open[v_cell] & 2 <> 0
       and not (v_cell - 1) = any (v_queue) then
      v_queue := v_queue || (v_cell - 1);
    end if;
  end loop;
  return v_sink = any (v_queue) and v_open[v_sink + 1] & 2 <> 0;
end;
$$;

create or replace function public.company_task_puzzle_visual(p_task jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_game   text := p_task ->> 'game';
  g        jsonb := public.company_tasks_cfg() -> 'games' -> (p_task ->> 'game');
  v_size   integer;
  v_n      integer;
  v_board  integer[];
  v_gap    integer;
  v_prev   integer;
  v_m      integer;
  v_opts   integer[];
  v_try    integer;
  k        integer;
  i        integer;
  r        integer;
  v_items  jsonb;
  v_by     integer;
  v_pts    jsonb;
  v_start  jsonb;
  v_edges  jsonb;
  v_ring   integer[];
  v_cx     double precision;
  v_cy     double precision;
  v_a      integer;
  v_b      integer;
  v_added  integer;
  v_rounds jsonb := '[]'::jsonb;
  v_sol    jsonb := '[]'::jsonb;
  v_kind   integer;
  v_at     integer;
  v_cells  integer[];
  v_kinds  integer[];
  v_parts  integer[];
  v_slots  integer[];
  v_from   integer;
  v_to     integer;
  v_goal   integer;
  v_path   integer[] := '{}';
  v_need   integer[] := '{}';
  v_tiles  integer[];
  v_turns  integer[];
  v_wrong  integer;
  v_cell   integer;
  v_sizes  integer[];
begin
  if v_game = 'tiles' then
    -- from the solved board, scramble slides that never go straight back; at least minWrong tiles away
    v_size := (g ->> 'size')::integer;
    v_n := v_size * v_size;
    for v_try in 1..20 loop
      select array_agg(case when x < v_n - 1 then x else -1 end order by x) into v_board from generate_series(0, v_n - 1) x;
      v_gap := v_n - 1;
      v_prev := -1;
      for k in 1..(g ->> 'scramble')::integer loop
        select array_agg(c) into v_opts
          from unnest(array[case when v_gap / v_size > 0 then v_gap - v_size end,
                            case when v_gap / v_size < v_size - 1 then v_gap + v_size end,
                            case when v_gap % v_size > 0 then v_gap - 1 end,
                            case when v_gap % v_size < v_size - 1 then v_gap + 1 end]) c
         where c is not null and c <> v_prev;
        v_m := v_opts[1 + floor(random() * array_length(v_opts, 1))::integer];
        v_board[v_gap + 1] := v_board[v_m + 1];
        v_board[v_m + 1] := -1;
        v_prev := v_gap;
        v_gap := v_m;
      end loop;
      exit when v_n - 1 - (select count(*) from generate_series(0, v_n - 1) x where v_board[x + 1] = x)
                >= (g ->> 'minWrong')::integer;
    end loop;
    return jsonb_build_object('puzzle', jsonb_build_object('size', v_size, 'board', to_jsonb(v_board)),
      'solution', jsonb_build_object('size', v_size, 'board', to_jsonb(v_board), 'max_moves', (g ->> 'maxMoves')::integer));
  elsif v_game = 'bins' then
    v_n := (g ->> 'kinds')::integer;
    select jsonb_agg(jsonb_build_array(public.rand_between(0, v_n - 1), public.rand_between(0, v_n - 1)) order by x)
      into v_items from generate_series(1, (g ->> 'items')::integer) x;
    v_by := public.rand_between(0, 1);
    return jsonb_build_object('puzzle', jsonb_build_object('items', v_items, 'by', v_by, 'kinds', v_n),
      'solution', jsonb_build_object('bins', (select jsonb_agg((e ->> v_by)::integer order by o)
                                                from jsonb_array_elements(v_items) with ordinality x(e, o))));
  elsif v_game = 'untangle' then
    v_size := (g ->> 'grid')::integer;
    v_n := (g ->> 'nodes')::integer;
    for v_try in 1..40 loop
      select jsonb_agg(jsonb_build_array(s.c % v_size, s.c / v_size) order by s.rn) into v_pts
        from (select c, row_number() over (order by random()) as rn from generate_series(0, v_size * v_size - 1) c) s
       where s.rn <= v_n;
      -- a ring in angle order around the middle is a simple polygon, so nothing crosses
      select avg((e ->> 0)::double precision), avg((e ->> 1)::double precision) into v_cx, v_cy
        from jsonb_array_elements(v_pts) e;
      select array_agg(o - 1 order by atan2((e ->> 1)::double precision - v_cy, (e ->> 0)::double precision - v_cx), o)
        into v_ring from jsonb_array_elements(v_pts) with ordinality x(e, o);
      select jsonb_agg(jsonb_build_array(v_ring[x], v_ring[x % v_n + 1]) order by x) into v_edges
        from generate_series(1, v_n) x;
      if public.company_task_crossings(v_edges, v_pts) = 0 then
        v_added := 0;
        for k in 1..30 loop
          exit when v_added >= (g ->> 'chords')::integer;
          v_a := public.rand_between(0, v_n - 1);
          v_b := public.rand_between(0, v_n - 1);
          continue when v_a = v_b or v_edges @> jsonb_build_array(jsonb_build_array(v_a, v_b))
                     or v_edges @> jsonb_build_array(jsonb_build_array(v_b, v_a));
          if public.company_task_crossings(v_edges || jsonb_build_array(jsonb_build_array(v_a, v_b)), v_pts) = 0 then
            v_edges := v_edges || jsonb_build_array(jsonb_build_array(v_a, v_b));
            v_added := v_added + 1;
          end if;
        end loop;
        exit;
      end if;
    end loop;
    -- the nodes swap places until enough cables cross
    v_start := v_pts;
    for k in 1..40 loop
      select jsonb_agg(e order by random()) into v_start from jsonb_array_elements(v_pts) e;
      exit when public.company_task_crossings(v_edges, v_start) >= (g ->> 'minCrossings')::integer;
    end loop;
    return jsonb_build_object('puzzle', jsonb_build_object('grid', v_size, 'edges', v_edges, 'points', v_start),
      'solution', jsonb_build_object('grid', v_size, 'edges', v_edges, 'step_bps', (g ->> 'stepBps')::integer,
                                     'untangled', v_pts));
  elsif v_game = 'odd' then
    for r in 1..(g ->> 'rounds')::integer loop
      v_kind := public.rand_between(0, (g ->> 'kinds')::integer - 1);
      v_at := public.rand_between(0, (g ->> 'cells')::integer - 1);
      v_m := public.rand_between(1, (g ->> 'flaws')::integer);
      v_rounds := v_rounds || jsonb_build_array((select jsonb_agg(v_kind * 4 + case when x = v_at then v_m else 0 end order by x)
                                                   from generate_series(0, (g ->> 'cells')::integer - 1) x));
      v_sol := v_sol || to_jsonb(v_at);
    end loop;
    return jsonb_build_object('puzzle', jsonb_build_object('rounds', v_rounds), 'solution', jsonb_build_object('choices', v_sol));
  elsif v_game = 'rebuild' then
    v_size := (g ->> 'size')::integer;
    -- v_cells[k + 1] is the cell of good k
    select array_agg(s.c order by s.rn) into v_cells
      from (select c, row_number() over (order by random()) as rn from generate_series(0, v_size * v_size - 1) c) s
     where s.rn <= (g ->> 'items')::integer;
    select jsonb_agg(coalesce(array_position(v_cells, x) - 1, -1) order by x) into v_items
      from generate_series(0, v_size * v_size - 1) x;
    return jsonb_build_object(
      'puzzle', jsonb_build_object('size', v_size, 'layout', v_items, 'show_seconds', (g ->> 'showSeconds')::integer),
      'solution', jsonb_build_object('layout', v_items));
  elsif v_game = 'align' then
    select array_agg(x order by random()) into v_kinds from generate_series(0, (g ->> 'kinds')::integer - 1) x;
    v_parts := v_kinds[1:(g ->> 'parts')::integer];
    select array_agg(x order by random()) into v_slots from unnest(v_kinds[1:(g ->> 'slots')::integer]) x;
    return jsonb_build_object('puzzle', jsonb_build_object('slots', to_jsonb(v_slots), 'parts', to_jsonb(v_parts)),
      'solution', jsonb_build_object('at', (select jsonb_agg(array_position(v_slots, p) - 1 order by o)
                                              from unnest(v_parts) with ordinality x(p, o))));
  elsif v_game = 'pipes' then
    v_size := (g ->> 'size')::integer;
    v_n := v_size * v_size;
    v_from := public.rand_between(0, v_size - 1);
    v_to := public.rand_between(0, v_size - 1);
    -- the route column by column: down or up to a random row, then one step right
    r := v_from;
    for k in 0..v_size - 1 loop
      v_goal := case when k = v_size - 1 then v_to else public.rand_between(0, v_size - 1) end;
      v_path := v_path || (select array_agg(y * v_size + k order by o)
                             from generate_series(r, v_goal, case when v_goal >= r then 1 else -1 end) with ordinality s(y, o));
      r := v_goal;
    end loop;
    for i in 1..array_length(v_path, 1) loop
      v_need := v_need || (
        (case when i = 1 then 8
              when v_path[i - 1] = v_path[i] - v_size then 1 when v_path[i - 1] = v_path[i] + 1 then 2
              when v_path[i - 1] = v_path[i] + v_size then 4 else 8 end)
        | (case when i = array_length(v_path, 1) then 2
                when v_path[i + 1] = v_path[i] - v_size then 1 when v_path[i + 1] = v_path[i] + 1 then 2
                when v_path[i + 1] = v_path[i] + v_size then 4 else 8 end));
    end loop;
    select array_agg(case when array_position(v_path, x) is null then public.rand_between(0, 1)
                          when v_need[array_position(v_path, x)] in (5, 10) then 0 else 1 end order by x)
      into v_tiles from generate_series(0, v_n - 1) x;
    for v_try in 1..20 loop
      select array_agg(public.rand_between(0, 3) order by x) into v_turns from generate_series(1, v_n) x;
      -- at least minWrong pipes of the route point the wrong way
      for i in 1..array_length(v_path, 1) loop
        select count(*) into v_wrong from generate_series(1, array_length(v_path, 1)) j
         where public.company_task_pipe_mask(v_tiles[v_path[j] + 1], v_turns[v_path[j] + 1]) <> v_need[j];
        exit when v_wrong >= least((g ->> 'minWrong')::integer, array_length(v_path, 1));
        v_cell := v_path[i];
        if public.company_task_pipe_mask(v_tiles[v_cell + 1], v_turns[v_cell + 1]) = v_need[i] then
          v_turns[v_cell + 1] := (v_turns[v_cell + 1] + 1) % 4;
        end if;
      end loop;
      exit when not public.company_task_pipes_connected(v_size, v_tiles, v_turns, v_from, v_to);
    end loop;
    return jsonb_build_object(
      'puzzle', jsonb_build_object('size', v_size, 'tiles', to_jsonb(v_tiles), 'turns', to_jsonb(v_turns),
                                   'from', v_from, 'to', v_to),
      'solution', jsonb_build_object('size', v_size, 'tiles', to_jsonb(v_tiles), 'from', v_from, 'to', v_to,
                                     'path', to_jsonb(v_path), 'need', to_jsonb(v_need),
                                     'open_bps', (g ->> 'openBps')::integer));
  elsif v_game = 'sizes' then
    v_sizes := null;
    for v_try in 1..50 loop
      select array_agg(public.rand_between((g ->> 'min')::integer, (g ->> 'max')::integer) order by x)
        into v_sizes from generate_series(1, (g ->> 'items')::integer) x;
      exit when (select coalesce(bool_and(d >= (g ->> 'minGap')::integer), true)
                   from (select v - lag(v) over (order by v) as d from unnest(v_sizes) v) s where d is not null);
      v_sizes := null;
    end loop;
    if v_sizes is null then
      -- fallback: evenly spread, shuffled
      select array_agg((g ->> 'min')::integer + x * (g ->> 'minGap')::integer order by random()) into v_sizes
        from generate_series(0, (g ->> 'items')::integer - 1) x;
    end if;
    return jsonb_build_object('puzzle', jsonb_build_object('sizes', to_jsonb(v_sizes)),
      'solution', jsonb_build_object('order', (select jsonb_agg(o - 1 order by v, o) from unnest(v_sizes) with ordinality x(v, o))));
  elsif v_game = 'conveyor' then
    select jsonb_agg(public.rand_between(0, (g ->> 'kinds')::integer - 1) order by x) into v_items
      from generate_series(1, (g ->> 'items')::integer) x;
    return jsonb_build_object(
      'puzzle', jsonb_build_object('items', v_items, 'every_ms', (g ->> 'everyMs')::integer, 'travel_ms', (g ->> 'travelMs')::integer),
      'solution', jsonb_build_object('bins', v_items, 'scoring', 'net'));
  end if;
  raise exception 'unknown task game %', v_game;
end;
$$;

-- Whether a jsonb value is a whole number.
create or replace function public.company_task_is_int(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric % 1 = 0;
$$;

create or replace function public.company_task_grade_visual(p_game text, p_solution jsonb, p_answer jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key   text;
  v_total integer;
  v_hits  integer;
  v_size  integer;
  v_board integer[];
  v_gap   integer;
  v_m     integer;
  v_e     jsonb;
  v_n     integer;
  v_items integer;
  v_turns integer[];
  v_net   integer := 0;
begin
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' then
    return 0;
  end if;
  if p_game = 'tiles' then
    -- replay the slides; every tile on its own cell counts
    if jsonb_typeof(p_answer -> 'moves') is distinct from 'array'
       or jsonb_array_length(p_answer -> 'moves') > (p_solution ->> 'max_moves')::integer then
      return 0;
    end if;
    v_size := (p_solution ->> 'size')::integer;
    v_n := v_size * v_size;
    select array_agg((e #>> '{}')::integer order by o) into v_board
      from jsonb_array_elements(p_solution -> 'board') with ordinality x(e, o);
    v_gap := array_position(v_board, -1) - 1;
    for v_e in select e from jsonb_array_elements(p_answer -> 'moves') e loop
      if not public.company_task_is_int(v_e) or (v_e #>> '{}')::numeric not between 0 and v_n - 1 then
        return 0;
      end if;
      v_m := (v_e #>> '{}')::integer;
      if not (v_m = v_gap - v_size or v_m = v_gap + v_size
              or (v_m = v_gap - 1 and v_gap % v_size > 0) or (v_m = v_gap + 1 and v_gap % v_size < v_size - 1)) then
        return 0;
      end if;
      v_board[v_gap + 1] := v_board[v_m + 1];
      v_board[v_m + 1] := -1;
      v_gap := v_m;
    end loop;
    select count(*) into v_hits from generate_series(0, v_n - 1) x where v_board[x + 1] = x;
    return (v_hits * 10000) / greatest(v_n - 1, 1);
  elsif p_game in ('bins', 'odd', 'align', 'sizes') then
    v_key := case p_game when 'bins' then 'bins' when 'odd' then 'choices' when 'align' then 'at' else 'order' end;
    if jsonb_typeof(p_answer -> v_key) is distinct from 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> v_key);
    select count(*) into v_hits
      from jsonb_array_elements(p_solution -> v_key) with ordinality s(v, i)
      join jsonb_array_elements(p_answer -> v_key) with ordinality a(v, i) on a.i = s.i
     where a.v = s.v;
    return (v_hits * 10000) / greatest(v_total, 1);
  elsif p_game = 'untangle' then
    -- every node on its own grid point; every pair of cables that meets costs step_bps
    v_size := (p_solution ->> 'grid')::integer;
    select 1 + max(greatest((e ->> 0)::integer, (e ->> 1)::integer)) into v_n from jsonb_array_elements(p_solution -> 'edges') e;
    if jsonb_typeof(p_answer -> 'points') is distinct from 'array' or jsonb_array_length(p_answer -> 'points') <> v_n then
      return 0;
    end if;
    if exists (select 1 from jsonb_array_elements(p_answer -> 'points') p
                where jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
                   or not public.company_task_is_int(p -> 0) or not public.company_task_is_int(p -> 1)
                   or (p ->> 0)::numeric not between 0 and v_size - 1 or (p ->> 1)::numeric not between 0 and v_size - 1) then
      return 0;
    end if;
    if (select count(distinct ((p ->> 1)::integer * v_size + (p ->> 0)::integer)) from jsonb_array_elements(p_answer -> 'points') p) <> v_n then
      return 0;
    end if;
    return greatest(0, 10000 - public.company_task_crossings(p_solution -> 'edges', p_answer -> 'points')
                               * (p_solution ->> 'step_bps')::integer);
  elsif p_game = 'rebuild' then
    -- each good at most once; the share of goods on their cell counts
    v_total := jsonb_array_length(p_solution -> 'layout');
    if jsonb_typeof(p_answer -> 'layout') is distinct from 'array' or jsonb_array_length(p_answer -> 'layout') <> v_total then
      return 0;
    end if;
    select count(*) into v_items from jsonb_array_elements(p_solution -> 'layout') e where (e #>> '{}')::integer >= 0;
    if exists (select 1 from jsonb_array_elements(p_answer -> 'layout') e
                where not public.company_task_is_int(e) or (e #>> '{}')::numeric not between -1 and v_items - 1) then
      return 0;
    end if;
    if (select count(*) <> count(distinct (e #>> '{}')::integer) from jsonb_array_elements(p_answer -> 'layout') e
         where (e #>> '{}')::integer >= 0) then
      return 0;
    end if;
    select count(*) into v_hits
      from jsonb_array_elements(p_solution -> 'layout') with ordinality s(v, i)
      join jsonb_array_elements(p_answer -> 'layout') with ordinality a(v, i) on a.i = s.i
     where (s.v #>> '{}')::integer >= 0 and a.v = s.v;
    return (v_hits * 10000) / greatest(v_items, 1);
  elsif p_game = 'pipes' then
    -- closed: full marks; else the share of the route's pipes that point right, times open_bps
    v_total := jsonb_array_length(p_solution -> 'tiles');
    if jsonb_typeof(p_answer -> 'turns') is distinct from 'array' or jsonb_array_length(p_answer -> 'turns') <> v_total then
      return 0;
    end if;
    if exists (select 1 from jsonb_array_elements(p_answer -> 'turns') e
                where not public.company_task_is_int(e) or (e #>> '{}')::numeric not between 0 and 3) then
      return 0;
    end if;
    select array_agg((e #>> '{}')::integer order by o) into v_turns
      from jsonb_array_elements(p_answer -> 'turns') with ordinality x(e, o);
    select array_agg((e #>> '{}')::integer order by o) into v_board
      from jsonb_array_elements(p_solution -> 'tiles') with ordinality x(e, o);
    if public.company_task_pipes_connected((p_solution ->> 'size')::integer, v_board, v_turns,
                                           (p_solution ->> 'from')::integer, (p_solution ->> 'to')::integer) then
      return 10000;
    end if;
    select count(*) into v_hits
      from jsonb_array_elements(p_solution -> 'path') with ordinality pa(c, k)
      join jsonb_array_elements(p_solution -> 'need') with ordinality ne(v, k) on ne.k = pa.k
     where public.company_task_pipe_mask(v_board[(pa.c #>> '{}')::integer + 1], v_turns[(pa.c #>> '{}')::integer + 1])
           = (ne.v #>> '{}')::integer;
    return ((v_hits * 10000) / greatest(jsonb_array_length(p_solution -> 'path'), 1))
           * (p_solution ->> 'open_bps')::integer / 10000;
  elsif p_game = 'conveyor' then
    -- right bins minus wrong bins; a missed good (-1) counts neither way
    if jsonb_typeof(p_answer -> 'bins') is distinct from 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> 'bins');
    select coalesce(sum(case when a.v is null or not public.company_task_is_int(a.v) or (a.v #>> '{}')::numeric < 0 then 0
                             when a.v = s.v then 1 else -1 end), 0)
      into v_net
      from jsonb_array_elements(p_solution -> 'bins') with ordinality s(v, i)
      left join jsonb_array_elements(p_answer -> 'bins') with ordinality a(v, i) on a.i = s.i;
    return greatest(0, (v_net * 10000) / greatest(v_total, 1));
  end if;
  return 0;
end;
$$;

revoke all on function public.company_task_segments_meet(integer, integer, integer, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.company_task_crossings(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.company_task_pipe_mask(integer, integer) from public, anon, authenticated;
revoke all on function public.company_task_pipes_connected(integer, integer[], integer[], integer, integer)
  from public, anon, authenticated;
revoke all on function public.company_task_puzzle_visual(jsonb) from public, anon, authenticated;
revoke all on function public.company_task_is_int(jsonb) from public, anon, authenticated;
revoke all on function public.company_task_grade_visual(text, jsonb, jsonb) from public, anon, authenticated;
