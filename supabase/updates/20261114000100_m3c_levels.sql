-- ===== idempotent copy of migrations/20261114000100_m3c_levels.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M3c · 0100 · Slower first levels (ADR-055)
-- =============================================================================
-- Level 1 -> 2 costs progression.firstLevelXp, from level 2 on
-- round(xpBase x level^xpExponent) (mirrors src/lib/sim/progression.ts).
-- Nobody loses a level: xp_total of every player is raised to at least the total
-- XP of the level they already have. Levels (and therefore free skill points)
-- do not change. Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- An older game_config (written before ADR-055) has no firstLevelXp and the old
-- xpBase 100. update-to-latest.sql overwrites the config only after the schema
-- steps, so the curve values of ADR-055 are set here once (the generated seed
-- writes the same values afterwards).
update public.game_config
   set value = value || jsonb_build_object('firstLevelXp', 100, 'xpBase', 250)
 where key = 'progression' and not (value ? 'firstLevelXp');

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
    else round(public.cfg_num(c.v, '{xpBase}', 250) * power(p_level, public.cfg_num(c.v, '{xpExponent}', 1.5)))::bigint
  end
  from (select coalesce(public.config_jsonb('progression'), '{}'::jsonb) as v) c;
$$;
comment on function public.xp_for_next_level(integer) is 'XP from level p_level to p_level + 1 (ADR-055: firstLevelXp, then xpBase x level^xpExponent).';

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
  v_base  double precision := public.cfg_num(v_prog, '{xpBase}', 250);
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
comment on function public.xp_total_for_level(integer) is 'Total XP needed to reach a level (ADR-055 curve).';

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
  v_base  double precision := public.cfg_num(v_prog, '{xpBase}', 250);
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

-- grant_xp as in M2b; the level never goes down (players keep levels reached under an older curve).
create or replace function public.grant_xp(
  p_player     uuid,
  p_source     public.xp_source,
  p_base_xp    integer,
  p_dedupe_key text default null,
  p_ref_type   text default null,
  p_ref_id     uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prog   jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_mult   double precision := public.cfg_num(v_prog, '{xpMultiplier}', 2);
  v_day    date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_amount integer;
  v_cap    integer;
  v_count  integer;
  v_id     bigint;
  v_total  bigint;
  v_old    integer;
  v_level  integer;
begin
  if p_player is null or p_base_xp is null or p_base_xp <= 0 then
    return 0;
  end if;
  v_amount := greatest(0, round(p_base_xp * v_mult))::integer;
  if v_amount <= 0 then
    return 0;
  end if;

  if p_source = 'trade' then
    v_cap := public.cfg_num(v_prog, '{xpSources,trade,maxTradesPerDay}', 30)::integer;
    select c.event_count into v_count
      from public.xp_daily_counters c
     where c.player_id = p_player and c.game_day = v_day and c.source = p_source
       for update;
    if coalesce(v_count, 0) >= v_cap then
      return 0;
    end if;
  end if;

  insert into public.xp_events (player_id, source, amount, multiplier_bps, ref_type, ref_id, dedupe_key, game_day)
  values (p_player, p_source, v_amount, round(v_mult * 10000)::integer, p_ref_type, p_ref_id, p_dedupe_key, v_day)
  on conflict (player_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    return 0;
  end if;

  insert into public.xp_daily_counters as c (player_id, game_day, source, event_count, xp_sum)
  values (p_player, v_day, p_source, 1, v_amount)
  on conflict (player_id, game_day, source)
  do update set event_count = c.event_count + 1, xp_sum = c.xp_sum + excluded.xp_sum;

  select p.level into v_old from public.profiles p where p.id = p_player for update;
  update public.profiles p set xp_total = p.xp_total + v_amount where p.id = p_player
  returning p.xp_total into v_total;
  v_level := greatest(v_old, public.level_for_xp(v_total));
  update public.profiles p set level = v_level where p.id = p_player and p.level <> v_level;
  update public.xp_events e set level_after = v_level where e.id = v_id;

  if v_level > v_old then
    perform public.skill_points_ensure(p_player);
    update public.player_skill_points
       set free_points = free_points
                       + (v_level - v_old) * greatest(0, public.config_double('skills', '{freePointsPerLevel}', 1))::integer
     where player_id = p_player;
  end if;

  insert into public.player_unlocks (player_id, unlock_key)
  select p_player, u.key from public.unlocks u where u.level <= v_level
  on conflict do nothing;

  return v_amount;
end;
$$;

-- Nobody loses a level: raise xp_total to the threshold of the level a player has (idempotent).
-- Levels and free skill points stay as they are. Returns the number of raised profiles.
create or replace function public.keep_levels_after_curve_change()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.profiles p
     set xp_total = t.need
    from (select x.level, public.xp_total_for_level(x.level) as need
            from (select distinct level from public.profiles) x) t
   where p.level = t.level and p.xp_total < t.need;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
do $$ begin perform public.keep_levels_after_curve_change(); end $$;

-- Reference table levels (documentation of the curve, levels 1..50)
update public.levels l
   set xp_to_next = case when l.level < 50 then public.xp_for_next_level(l.level) end,
       xp_cumulative = public.xp_total_for_level(l.level)
 where l.xp_cumulative is distinct from public.xp_total_for_level(l.level)
    or l.xp_to_next is distinct from case when l.level < 50 then public.xp_for_next_level(l.level) end;
comment on table public.levels is 'XP curve (ADR-055): xp_to_next = firstLevelXp at level 1, then round(xpBase * level^1.5); xp_cumulative = XP needed to reach the level.';

do $$
declare
  f text;
begin
  foreach f in array array['public.xp_for_next_level(integer)', 'public.xp_total_for_level(integer)',
                           'public.keep_levels_after_curve_change()',
                           'public.level_progress(bigint)',
                           'public.grant_xp(uuid, public.xp_source, integer, text, text, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
