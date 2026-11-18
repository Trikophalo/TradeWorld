-- =============================================================================
-- NEXA · 9400 · A lower level curve and more mission XP (ADR-202)
-- =============================================================================
-- * progression.xpBase 250 -> 200: from level 2 on every level needs 20 % less XP (firstLevelXp stays 100).
--   progression.missionXpScalePerLevel 0.15 -> 0.18: mission XP grow faster with the level (cap 8 unchanged).
--   An active player reaches every level about 1.3 to 1.4 times as fast (docs/BALANCING.md, section 3.2).
-- * Nobody loses a level: the total XP of every level only falls, so xp_total keeps the level or lifts it.
--   raise_levels_after_curve_change() lifts every profile to the level its XP reach under the new curve, with the
--   free skill points and unlocks of grant_xp(); it never lowers a level. Idempotent (a second run changes nothing).
-- * update-to-latest.sql writes the config only after the schema steps, so the two curve values are set here once
--   (only where they still have the old value; the generated seed writes the same values afterwards).
-- Idempotent: runs unchanged as supabase/updates/20261204009400_level_curve_lower.sql.

update public.game_config
   set value = value || jsonb_build_object('xpBase', 200)
 where key = 'progression' and (value ->> 'xpBase') is not null and (value ->> 'xpBase')::numeric = 250;
update public.game_config
   set value = value || jsonb_build_object('missionXpScalePerLevel', 0.18)
 where key = 'progression' and (value ->> 'missionXpScalePerLevel') is not null
   and (value ->> 'missionXpScalePerLevel')::numeric = 0.15;

-- The curve functions (latest definitions, 20261114000100) with the new fallback xpBase 200, so a database whose
-- config is written later (setup-all.sql) computes the same curve.
-- XP needed from p_level to p_level + 1 (0 at the technical maximum).
create or replace function public.xp_for_next_level(p_level integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_level is null or p_level < 1 then null
    when p_level >= public.cfg_num(c.v, '{maxLevel}', 10000)::integer then 0::bigint
    when p_level = 1 then round(public.cfg_num(c.v, '{firstLevelXp}', 100))::bigint
    else round(public.cfg_num(c.v, '{xpBase}', 200) * power(p_level, public.cfg_num(c.v, '{xpExponent}', 1.5)))::bigint
  end
  from (select coalesce(public.config_jsonb('progression'), '{}'::jsonb) as v) c;
$$;
comment on function public.xp_for_next_level(integer) is 'XP from level p_level to p_level + 1 (ADR-055, ADR-202: firstLevelXp, then xpBase x level^xpExponent).';

-- Total XP needed to reach p_level from level 1 with 0 XP.
create or replace function public.xp_total_for_level(p_level integer)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prog  jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_first double precision := public.cfg_num(v_prog, '{firstLevelXp}', 100);
  v_base  double precision := public.cfg_num(v_prog, '{xpBase}', 200);
  v_exp   double precision := public.cfg_num(v_prog, '{xpExponent}', 1.5);
  v_total bigint := 0;
  n       integer;
begin
  if p_level is null or p_level < 1 then
    return null;
  end if;
  for n in 1 .. p_level - 1 loop
    v_total := v_total + case when n = 1 then round(v_first)::bigint else round(v_base * power(n, v_exp))::bigint end;
  end loop;
  return v_total;
end;
$$;
comment on function public.xp_total_for_level(integer) is 'Total XP needed to reach a level (ADR-055 curve, xpBase 200 since ADR-202).';

create or replace function public.level_progress(p_xp bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prog  jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_first double precision := public.cfg_num(v_prog, '{firstLevelXp}', 100);
  v_base  double precision := public.cfg_num(v_prog, '{xpBase}', 200);
  v_exp   double precision := public.cfg_num(v_prog, '{xpExponent}', 1.5);
  v_max   integer := public.cfg_num(v_prog, '{maxLevel}', 10000)::integer;
  v_level integer := 1;
  v_rem   bigint := greatest(coalesce(p_xp, 0), 0);
  v_need  bigint;
begin
  loop
    if v_level >= v_max then
      return jsonb_build_object('level', v_level, 'xp_into_level', v_rem, 'xp_for_next', 0);
    end if;
    v_need := case when v_level = 1 then round(v_first)::bigint else round(v_base * power(v_level, v_exp))::bigint end;
    if v_rem < v_need then
      return jsonb_build_object('level', v_level, 'xp_into_level', v_rem, 'xp_for_next', v_need);
    end if;
    v_rem := v_rem - v_need;
    v_level := v_level + 1;
  end loop;
end;
$$;

revoke all on function public.xp_for_next_level(integer) from public, anon, authenticated;
revoke all on function public.xp_total_for_level(integer) from public, anon, authenticated;
revoke all on function public.level_progress(bigint) from public, anon, authenticated;
grant execute on function public.xp_for_next_level(integer) to service_role;
grant execute on function public.xp_total_for_level(integer) to service_role;
grant execute on function public.level_progress(bigint) to service_role;

-- Lifts every profile to the level its XP reach under the current curve (never down). Returns the number of
-- lifted profiles. Free skill points and unlocks as in grant_xp(); the feed trigger on profiles posts level-ups.
create or replace function public.raise_levels_after_curve_change()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      record;
  v_new  integer;
  v_pts  integer := greatest(0, public.config_double('skills', '{freePointsPerLevel}', 1))::integer;
  v_n    integer := 0;
begin
  for r in select p.id, p.level, p.xp_total from public.profiles p order by p.id for update loop
    v_new := public.level_for_xp(r.xp_total);
    continue when v_new is null or v_new <= r.level;
    update public.profiles p set level = v_new where p.id = r.id;
    perform public.skill_points_ensure(r.id);
    update public.player_skill_points set free_points = free_points + (v_new - r.level) * v_pts where player_id = r.id;
    insert into public.player_unlocks (player_id, unlock_key)
    select r.id, u.key from public.unlocks u where u.level <= v_new
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.raise_levels_after_curve_change() from public, anon, authenticated;
grant execute on function public.raise_levels_after_curve_change() to service_role;
comment on function public.raise_levels_after_curve_change() is
  'ADR-202: lifts every profile to the level its XP reach under the current curve (never down), with skill points and unlocks.';

do $$ begin perform public.raise_levels_after_curve_change(); end $$;

-- Reference table levels (documentation of the curve, levels 1..50)
update public.levels l
   set xp_to_next = case when l.level < 50 then public.xp_for_next_level(l.level) end,
       xp_cumulative = public.xp_total_for_level(l.level)
 where l.xp_cumulative is distinct from public.xp_total_for_level(l.level)
    or l.xp_to_next is distinct from case when l.level < 50 then public.xp_for_next_level(l.level) end;
comment on table public.levels is
  'XP curve (ADR-055, ADR-202): xp_to_next = firstLevelXp at level 1, then round(xpBase * level^1.5); xp_cumulative = XP needed to reach the level.';
