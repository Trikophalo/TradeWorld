-- ===== idempotent copy of migrations/20261204005900_nexamon_condition_values.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- Nexamon (ADR-165): the condition weighs more on a raw copy's value: poor 70 %, good 90 %, near mint and mint 100 %.
-- The factors live in game_config (nexamon.conditions.valueBps); a slab still counts by its grade only.
create or replace function public.nexamon_copy_factor_bps(p_condition text, p_grade integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.nexamon_cfg();
begin
  if p_grade is not null then
    return coalesce((cfg #>> array['grading', 'valueBps', (least(greatest(p_grade, 1), 10) - 1)::text])::integer, 10000);
  end if;
  return coalesce((cfg #>> array['conditions', 'valueBps', p_condition])::integer, 10000);
end;
$$;
