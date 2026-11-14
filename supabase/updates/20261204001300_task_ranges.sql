-- ===== idempotent copy of migrations/20261204001300_task_ranges.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1300 · Task games you solve by thinking (ADR-140)
-- =============================================================================
-- The order game drew every value from 1..99, so a shift could start at "73 Uhr". Each order task now has its own
-- realistic range (companyTasks.tasks[].range, e.g. 6..22 Uhr); without one the game's default applies.
-- Only company_task_puzzle() changes. Idempotent: runs unchanged as supabase/updates/20261204001300_task_ranges.sql.

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
  end if;
  raise exception 'unknown task game %', v_game;
end;
$$;
