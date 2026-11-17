-- ===== idempotent copy of migrations/20261204006920_task_games_five.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 6920 · Five more company task games (ADR-180): restock, receipts, offer, pattern, shelf
-- =============================================================================
-- Ports of src/lib/sim/company-tasks-more.ts. company_task_puzzle() and company_task_grade() (patched by replace)
-- hand the five new games to company_task_puzzle_more() and company_task_grade_more(). The catalogue entries and the
-- game rules come with game_config (companyTasks.tasks, companyTasks.games).
-- Idempotent: runs unchanged as supabase/updates/20261204006920_task_games_five.sql.

alter table public.company_tasks drop constraint if exists company_tasks_game_check;
alter table public.company_tasks add constraint company_tasks_game_check
  check (game in ('pick', 'count', 'sort', 'order', 'seq', 'math', 'slider', 'rotate', 'match', 'path',
                  'memory', 'timing', 'diff', 'quick', 'route', 'haggle', 'pack', 'catch',
                  'restock', 'receipts', 'offer', 'pattern', 'shelf'));

create or replace function public.company_task_puzzle_more(p_task jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_game   text := p_task ->> 'game';
  g        jsonb := public.company_tasks_cfg() -> 'games' -> (p_task ->> 'game');
  v_a      integer[];
  v_b      integer[];
  v_pick   integer[];
  v_rounds jsonb := '[]'::jsonb;
  v_sol    jsonb := '[]'::jsonb;
  v_round  jsonb;
  v_rev    integer[];
  v_top    integer;
  v_try    integer;
  v_kind   integer;
  v_start  integer;
  v_k      integer;
  v_seq    integer[];
  v_next   integer;
  v_d      integer;
  v_opts   integer[];
  v_sym    integer[];
  v_grid   integer[];
  v_blanks integer[];
  i        integer;
  r        integer;
begin
  if v_game = 'restock' then
    select array_agg(public.rand_between((g ->> 'minTarget')::integer, (g ->> 'maxTarget')::integer) order by x)
      into v_b from generate_series(1, (g ->> 'items')::integer) x;
    select array_agg(public.rand_between(0, v_b[x] - 2) order by x) into v_a from generate_series(1, array_length(v_b, 1)) x;
    return jsonb_build_object('puzzle', jsonb_build_object('stock', to_jsonb(v_a), 'target', to_jsonb(v_b)),
      'solution', jsonb_build_object('values', (select jsonb_agg(v_b[x] - v_a[x] order by x)
                                                 from generate_series(1, array_length(v_b, 1)) x)));
  elsif v_game = 'receipts' then
    select array_agg(public.rand_between((g ->> 'min')::integer, (g ->> 'max')::integer) order by x)
      into v_a from generate_series(1, (g ->> 'items')::integer) x;
    select array_agg(c order by c) into v_pick
      from (select c from generate_series(0, (g ->> 'items')::integer - 1) c order by random() limit (g ->> 'pick')::integer) s;
    return jsonb_build_object('puzzle', jsonb_build_object('amounts', to_jsonb(v_a),
                                                           'target', (select sum(v_a[c + 1]) from unnest(v_pick) c)),
      'solution', jsonb_build_object('amounts', to_jsonb(v_a), 'target', (select sum(v_a[c + 1]) from unnest(v_pick) c),
                                     'step_bps', (g ->> 'stepBps')::integer, 'picked', to_jsonb(v_pick)));
  elsif v_game = 'offer' then
    for r in 1..(g ->> 'rounds')::integer loop
      for v_try in 1..20 loop
        select array_agg(public.rand_between((g ->> 'minPrice')::integer, (g ->> 'maxPrice')::integer) order by x),
               array_agg(public.rand_between((g ->> 'minQty')::integer, (g ->> 'maxQty')::integer) order by x)
          into v_a, v_b from generate_series(1, (g ->> 'options')::integer) x;
        select array_agg(v_a[x] * v_b[x] order by x) into v_rev from generate_series(1, array_length(v_a, 1)) x;
        select max(x) into v_top from unnest(v_rev) x;
        exit when (select count(*) from unnest(v_rev) x where x = v_top) = 1;
      end loop;
      -- still a tie: one more unit for the first best one
      if (select count(*) from unnest(v_rev) x where x = v_top) > 1 then
        i := array_position(v_rev, v_top);
        v_b[i] := v_b[i] + 1;
        v_rev[i] := v_a[i] * v_b[i];
        v_top := v_rev[i];
      end if;
      select jsonb_agg(jsonb_build_array(v_a[x], v_b[x]) order by x) into v_round from generate_series(1, array_length(v_a, 1)) x;
      v_rounds := v_rounds || jsonb_build_array(v_round);
      v_sol := v_sol || to_jsonb(array_position(v_rev, v_top) - 1);
    end loop;
    return jsonb_build_object('puzzle', jsonb_build_object('offers', v_rounds), 'solution', jsonb_build_object('choices', v_sol));
  elsif v_game = 'pattern' then
    for r in 1..(g ->> 'rounds')::integer loop
      v_kind := public.rand_between(0, 2);
      v_start := case when v_kind = 1 then public.rand_between(1, 6) else public.rand_between(1, 20) end;
      v_k := case when v_kind = 2 then public.rand_between(1, 4) else public.rand_between(2, 9) end;
      v_seq := array[v_start];
      for i in 2..(g ->> 'shown')::integer + 1 loop
        v_seq := v_seq || case v_kind when 1 then v_seq[i - 1] * 2 when 2 then v_seq[i - 1] + v_k + (i - 2)
                                      else v_seq[i - 1] + v_k end;
      end loop;
      v_next := v_seq[(g ->> 'shown')::integer + 1];
      v_d := greatest(2, v_next / 10) * public.rand_between(1, 2);
      select array_agg(o order by random()) into v_opts from unnest(array[v_next, v_next + v_d, v_next - v_d]) o;
      v_rounds := v_rounds || jsonb_build_object('seq', to_jsonb(v_seq[1:(g ->> 'shown')::integer]), 'options', to_jsonb(v_opts));
      v_sol := v_sol || to_jsonb(array_position(v_opts, v_next) - 1);
    end loop;
    return jsonb_build_object('puzzle', jsonb_build_object('rows', v_rounds), 'solution', jsonb_build_object('choices', v_sol));
  elsif v_game = 'shelf' then
    -- a valid 4 x 4 grid (shelfBase) with shuffled goods, then blanks gaps
    select array_agg(s order by random()) into v_sym from unnest(array[0, 1, 2, 3]) s;
    select array_agg(v_sym[((x % 4) + 2 * ((x / 4) % 2) + (x / 4) / 2) % 4 + 1] order by x) into v_grid
      from generate_series(0, 15) x;
    select array_agg(c order by c) into v_blanks
      from (select c from generate_series(0, 15) c order by random() limit (g ->> 'blanks')::integer) s;
    return jsonb_build_object(
      'puzzle', jsonb_build_object('grid', (select jsonb_agg(case when x = any (v_blanks) then -1 else v_grid[x + 1] end order by x)
                                              from generate_series(0, 15) x)),
      'solution', jsonb_build_object('grid', to_jsonb(v_grid), 'blanks', to_jsonb(v_blanks)));
  end if;
  raise exception 'unknown task game %', v_game;
end;
$$;

create or replace function public.company_task_grade_more(p_game text, p_solution jsonb, p_answer jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total integer;
  v_sum   bigint;
  v_n     integer;
  v_cells integer[];
  v_ok    integer := 0;
  v_i     integer;
begin
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' then
    return 0;
  end if;
  if p_game = 'restock' then
    if jsonb_typeof(p_answer -> 'values') <> 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> 'values');
    select coalesce(sum(case when a.v is null or jsonb_typeof(a.v) <> 'number' or (a.v #>> '{}')::numeric % 1 <> 0 then 0
                             when abs((a.v #>> '{}')::numeric - (s.v #>> '{}')::numeric) = 0 then 10000
                             when abs((a.v #>> '{}')::numeric - (s.v #>> '{}')::numeric) = 1 then 5000 else 0 end), 0)
      into v_sum
      from jsonb_array_elements(p_solution -> 'values') with ordinality s(v, i)
      left join jsonb_array_elements(p_answer -> 'values') with ordinality a(v, i) on a.i = s.i;
    return (v_sum / greatest(v_total, 1))::integer;
  elsif p_game = 'receipts' then
    if jsonb_typeof(p_answer -> 'picked') <> 'array' or jsonb_array_length(p_answer -> 'picked') = 0 then
      return 0;
    end if;
    v_n := jsonb_array_length(p_solution -> 'amounts');
    if exists (select 1 from jsonb_array_elements(p_answer -> 'picked') e
                where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric % 1 <> 0
                   or (e #>> '{}')::numeric < 0 or (e #>> '{}')::numeric >= v_n) then
      return 0;
    end if;
    if (select count(distinct e #>> '{}') from jsonb_array_elements(p_answer -> 'picked') e) <> jsonb_array_length(p_answer -> 'picked') then
      return 0;
    end if;
    select sum((p_solution -> 'amounts' ->> ((e #>> '{}')::numeric::integer))::bigint) into v_sum
      from jsonb_array_elements(p_answer -> 'picked') e;
    return greatest(0, least(10000, 10000 - abs(v_sum - (p_solution ->> 'target')::bigint) * (p_solution ->> 'step_bps')::integer))::integer;
  elsif p_game in ('offer', 'pattern') then
    if jsonb_typeof(p_answer -> 'choices') <> 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> 'choices');
    select count(*) into v_n
      from jsonb_array_elements(p_solution -> 'choices') with ordinality s(v, i)
      join jsonb_array_elements(p_answer -> 'choices') with ordinality a(v, i) on a.i = s.i
     where a.v = s.v;
    return (v_n * 10000) / greatest(v_total, 1);
  elsif p_game = 'shelf' then
    if jsonb_typeof(p_answer -> 'grid') <> 'array' or jsonb_array_length(p_answer -> 'grid') <> 16 then
      return 0;
    end if;
    if exists (select 1 from jsonb_array_elements(p_answer -> 'grid') e
                where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric % 1 <> 0
                   or (e #>> '{}')::numeric not between 0 and 3) then
      return 0;
    end if;
    select array_agg((e #>> '{}')::numeric::integer order by i) into v_cells
      from jsonb_array_elements(p_answer -> 'grid') with ordinality x(e, i);
    -- the givens stay
    if exists (select 1 from generate_series(0, 15) c
                where not (p_solution -> 'blanks') @> to_jsonb(c)
                  and v_cells[c + 1] <> (p_solution -> 'grid' ->> c)::integer) then
      return 0;
    end if;
    for v_i in select (b #>> '{}')::integer from jsonb_array_elements(p_solution -> 'blanks') b loop
      if not exists (select 1 from generate_series(0, 15) j
                      where j <> v_i and v_cells[j + 1] = v_cells[v_i + 1]
                        and (j / 4 = v_i / 4 or j % 4 = v_i % 4
                             or ((j / 4) / 2 = (v_i / 4) / 2 and (j % 4) / 2 = (v_i % 4) / 2))) then
        v_ok := v_ok + 1;
      end if;
    end loop;
    return (v_ok * 10000) / greatest(jsonb_array_length(p_solution -> 'blanks'), 1);
  end if;
  return 0;
end;
$$;

-- hand the five games to the new functions
do $patch$
declare
  v_def text := pg_get_functiondef('public.company_task_puzzle(jsonb)'::regprocedure);
  a1 text := $a$  if v_game in ('pick', 'count') then$a$;
begin
  if position('company_task_puzzle_more' in v_def) > 0 then
    return;
  end if;
  if position(a1 in v_def) = 0 then raise exception 'NEXA 6920: company_task_puzzle anchor missing'; end if;
  execute replace(v_def, a1,
    $b$  if v_game in ('restock', 'receipts', 'offer', 'pattern', 'shelf') then  -- ADR-180
    return public.company_task_puzzle_more(p_task);
  end if;
$b$ || a1);
end;
$patch$;

do $patch$
declare
  v_def text := pg_get_functiondef('public.company_task_grade(text, jsonb, jsonb)'::regprocedure);
  a1 text := $a$  if p_game in ('pick', 'diff', 'catch') then$a$;
begin
  if position('company_task_grade_more' in v_def) > 0 then
    return;
  end if;
  if position(a1 in v_def) = 0 then raise exception 'NEXA 6920: company_task_grade anchor missing'; end if;
  execute replace(v_def, a1,
    $b$  if p_game in ('restock', 'receipts', 'offer', 'pattern', 'shelf') then  -- ADR-180
    return public.company_task_grade_more(p_game, p_solution, p_answer);
  end if;
$b$ || a1);
end;
$patch$;

revoke all on function public.company_task_puzzle_more(jsonb) from public, anon, authenticated;
revoke all on function public.company_task_grade_more(text, jsonb, jsonb) from public, anon, authenticated;
