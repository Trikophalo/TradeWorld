-- ===== idempotent copy of migrations/20261204004800_battles_per_hour.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 4800 · Three news battles per hour, all with a prize (ADR-160 addendum)
-- =============================================================================
-- After the hourly show the lobby opens; per full hour exactly battles.lobby.perHour (3) battles start, one after
-- the other. Then no new lobby opens until the next full hour. Every one of them has a prize, so per hour only
-- three players can win something. get_battle() tells how many battles of this hour are played and when the next
-- round starts.
-- Idempotent: runs unchanged as supabase/updates/20261204004800_battles_per_hour.sql.

-- battles of the hour p_now lies in that started (running or finished)
create or replace function public.battles_started_this_hour(p_now timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.battles b
   where b.started_at is not null and b.started_at >= date_trunc('hour', p_now)
     and b.status in ('running', 'finished');
$$;
revoke all on function public.battles_started_this_hour(timestamptz) from public, anon, authenticated;
grant execute on function public.battles_started_this_hour(timestamptz) to service_role;

do $do$
declare
  v_def text := pg_get_functiondef('public.battle_maintain(timestamptz)'::regprocedure);
  v_old text := $t$  if b.id is null then
    perform public.battle_open(p_now);
    return;
  end if;$t$;
  v_new text := $t$  if b.id is null then
    -- three per hour (lobby.perHour), then the next round after the next show
    if public.battles_started_this_hour(p_now) < coalesce((cfg #>> '{lobby,perHour}')::integer, 3) then
      perform public.battle_open(p_now);
    end if;
    return;
  end if;$t$;
begin
  if position('battles_started_this_hour' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'battle_maintain() has an unexpected shape; add the hourly limit by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;

  v_def := pg_get_functiondef('public.battle_state(uuid, timestamptz)'::regprocedure);
  v_old := $t$    'recent', public.battle_json(f, p_player, p_now));$t$;
  v_new := $t$    'recent', public.battle_json(f, p_player, p_now),
    'played_this_hour', public.battles_started_this_hour(p_now),
    'per_hour', coalesce((public.battles_cfg() #>> '{lobby,perHour}')::integer, 3),
    'next_round_at', date_trunc('hour', p_now) + interval '1 hour');$t$;
  if position('played_this_hour' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'battle_state() has an unexpected shape; add the hourly fields by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
