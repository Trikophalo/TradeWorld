-- ===== idempotent copy of migrations/20261204006000_nexamon_half_grades.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 6000 · Nexamon: half grades 8.5 and 9.5, a rarer 10, Black Label for near mint too (ADR-165)
-- =============================================================================
-- Rule (game_config.nexamon.grading; src/config/nexamon-rules.ts):
--   grades          = [1, 2, 3, 4, 5, 6, 7, 8, 8.5, 9, 9.5, 10], worst first; gradeWeightsBps and valueBps follow this
--                     order (twelve entries each)
--   blackLabel      = {chanceBps: {mint: 500, near_mint: 100}, valueBps}: the Black Label takes the highest rolls of
--                     the 10 of every condition named in chanceBps
-- Model: nexamon_copies.grade and nexamon_sales.grade become double precision (1 … 10 in the steps of grades, 11 =
-- Black Label; the schema keeps numeric out of tables, and the half steps are exact in binary). Existing slabs keep
-- their whole grade and their value factor by grade.
--   * nexamon_roll_asp_grade() replaces nexamon_roll_grade() (which returned an integer)
--   * nexamon_grade_index(), nexamon_grade_text() ("9,5")
--   * nexamon_copy_factor_bps() and nexamon_copy_value_cents() take the grade as double precision
--   * nexamon_finish_gradings(): rolls half grades (otherwise as in 5960: no grade in the notification)
--   * get_nexamon_card(): `graded` has one entry per grade of grading.grades (twelve), black_labels as before
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. The columns
-- ---------------------------------------------------------------------------
alter table public.nexamon_copies drop constraint if exists nexamon_copies_grade_check;
do $do$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'nexamon_copies' and column_name = 'grade') <> 'double precision' then
    alter table public.nexamon_copies alter column grade type double precision using grade::double precision;
  end if;
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'nexamon_sales' and column_name = 'grade') <> 'double precision' then
    alter table public.nexamon_sales alter column grade type double precision using grade::double precision;
  end if;
end;
$do$;
alter table public.nexamon_copies add constraint nexamon_copies_grade_check
  check (grade is null or grade in (1, 2, 3, 4, 5, 6, 7, 8, 8.5, 9, 9.5, 10, 11));
comment on column public.nexamon_copies.grade is
  'ASP grade once graded: 1..10 with the half grades 8.5 and 9.5, 11 = Black Label (the tier above a 10, ADR-165); '
  'null = raw or at ASP.';
comment on column public.nexamon_sales.grade is
  'Grade of the copy when it was sold (1..10 with 8.5 and 9.5, 11 = Black Label); null = raw.';

-- ---------------------------------------------------------------------------
-- B. Rules
-- ---------------------------------------------------------------------------
-- nexamonGradeIndex: 0-based position of the nearest grade in grading.grades (a Black Label counts as a 10)
create or replace function public.nexamon_grade_index(p_grade double precision)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (g.o - 1)::integer
                     from jsonb_array_elements_text(coalesce(public.nexamon_cfg() #> '{grading,grades}', '[]'::jsonb))
                          with ordinality g(v, o)
                    order by abs(g.v::double precision - coalesce(p_grade, 1)), g.o desc
                    limit 1), 0);
$$;

-- "9,5" or "10": a grade as German text
create or replace function public.nexamon_grade_text(p_grade double precision)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_grade = trunc(p_grade) then trunc(p_grade)::bigint::text
              else replace(trim(trailing '0' from p_grade::text), '.', ',') end;
$$;

-- nexamonRollGrade: grading.gradeWeightsBps[condition] in the order of grading.grades; the Black Label (11) takes the
-- highest grading.blackLabel.chanceBps[condition] rolls of the 10
drop function if exists public.nexamon_roll_grade(text, double precision);
create or replace function public.nexamon_roll_asp_grade(p_condition text, p_u double precision)
returns double precision
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.nexamon_cfg();
  v_g     jsonb := coalesce(cfg #> '{grading,grades}', '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]'::jsonb);
  w       jsonb := cfg #> array['grading', 'gradeWeightsBps', p_condition];
  v_top   integer := jsonb_array_length(coalesce(cfg #> '{grading,grades}', '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]'::jsonb)) - 1;
  v_n     integer := floor(least(greatest(coalesce(p_u, 0), 0), 0.999999999) * 10000)::integer;
  v_edge  integer := 0;
  v_black integer;
  i       integer;
begin
  v_black := least(greatest(coalesce((cfg #>> array['grading', 'blackLabel', 'chanceBps', p_condition])::integer, 0), 0),
                   coalesce((w ->> v_top)::integer, 0));
  for i in 0 .. v_top loop
    v_edge := v_edge + coalesce((w ->> i)::integer, 0);
    if v_n < v_edge then
      if i = v_top and v_n >= v_edge - v_black then
        return 11;
      end if;
      return (v_g ->> i)::double precision;
    end if;
  end loop;
  return (v_g ->> v_top)::double precision;
end;
$$;

-- nexamonCopyFactorBps: the grade's factor in a slab (11 = Black Label), else the condition's
drop function if exists public.nexamon_copy_factor_bps(text, integer);
create or replace function public.nexamon_copy_factor_bps(p_condition text, p_grade double precision)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.nexamon_cfg();
begin
  if p_grade >= 10.75 then
    return coalesce((cfg #>> '{grading,blackLabel,valueBps}')::integer, 100000);
  end if;
  if p_grade is not null then
    return coalesce((cfg #>> array['grading', 'valueBps', public.nexamon_grade_index(p_grade)::text])::integer, 10000);
  end if;
  return coalesce((cfg #>> array['conditions', 'valueBps', p_condition])::integer, 10000);
end;
$$;

drop function if exists public.nexamon_copy_value_cents(bigint, text, integer);
create or replace function public.nexamon_copy_value_cents(p_value_e4 bigint, p_condition text, p_grade double precision)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select public.div_round_half_even(p_value_e4::numeric * public.nexamon_copy_factor_bps(p_condition, p_grade), 1000000);
$$;

-- ---------------------------------------------------------------------------
-- C. ASP is done: half grades and the Black Label for every condition with a chance for it. Based on 5960: the
--    notification does not spoil the grade, no feed item; only the roll and the grade's type change.
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_finish_gradings(p_player uuid default null, p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now   timestamptz := coalesce(p_now, public.game_now());
  v_n     integer := 0;
  v_grade double precision;
  r       record;
begin
  for r in select c.id, c.owner_id, c.card_key, c.condition, c.serial from public.nexamon_copies c
            where c.grading_until is not null and c.grading_until <= v_now
              and (p_player is null or c.owner_id = p_player)
            order by c.grading_until, c.id limit 200
            for update skip locked loop
    v_grade := public.nexamon_roll_asp_grade(r.condition, random());
    update public.nexamon_copies set grade = v_grade, graded_at = v_now, grading_until = null where id = r.id;
    if r.owner_id is not null then
      -- the grade stays a surprise: only the waiting package is announced
      perform public.social_notify(r.owner_id, 'nexamon_graded', 'Paket von ASP',
        'Deine Nexamon-Karte ist zurück von ASP. Das versiegelte Paket wartet darauf, dass du es öffnest.',
        jsonb_build_object('copy_id', r.id, 'card_key', r.card_key, 'serial', r.serial),
        '/nexamon', 'nexamon_graded:' || r.id::text || ':' || extract(epoch from v_now)::bigint::text);
      perform public.mission_event(r.owner_id, 'nexamon_graded', 1, null);
      -- a 10 for the missions: a 10 or a Black Label (a 9.5 is not a 10)
      if v_grade >= 10 then
        perform public.mission_event(r.owner_id, 'nexamon_ten', 1, null);
      end if;
      if v_grade >= 11 then
        perform public.mission_event(r.owner_id, 'nexamon_black_label', 1, null);
      end if;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
comment on function public.nexamon_finish_gradings(uuid, timestamptz) is
  'Finishes due ASP gradings (ADR-165): rolls the grade (half grades 8.5 and 9.5 included), notifies the owner '
  'without the grade (sealed package), mission events. No feed item (the reveal happens on the device).';

-- ---------------------------------------------------------------------------
-- D. The card page: slabs per grade of grading.grades
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.get_nexamon_card(text)'::regprocedure);
  v_old text := $t$(select count(*) from public.nexamon_copies c where c.card_key = k.card_key and c.grade = g) order by g)
                 from generate_series(1, 10) g),$t$;
  v_new text := $t$(select count(*) from public.nexamon_copies c where c.card_key = k.card_key and c.grade = g.v::double precision) order by g.o)
                 from jsonb_array_elements_text(coalesce(public.nexamon_cfg() #> '{grading,grades}', '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]'::jsonb))
                      with ordinality g(v, o)),$t$;
begin
  if position('grading,grades' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'get_nexamon_card() has an unexpected shape; count the slabs per grading.grades (ADR-165, half grades) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
comment on function public.get_nexamon_card(text) is
  'RPC: one Nexamon card (ADR-165): value, bounds, population, value history (start, hourly points, now), graded '
  'copies per grade of grading.grades (1 … 8, 8.5, 9, 9.5, 10) and the Black Labels (black_labels), the cheapest '
  'listings, the own copies and the latest sales; errors nexamon_locked, nexamon_unknown.';

-- ---------------------------------------------------------------------------
-- E. Privileges
-- ---------------------------------------------------------------------------
do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.nexamon_grade_index(double precision)', 'public.nexamon_grade_text(double precision)',
    'public.nexamon_roll_asp_grade(text, double precision)', 'public.nexamon_copy_factor_bps(text, double precision)',
    'public.nexamon_copy_value_cents(bigint, text, double precision)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$do$;
