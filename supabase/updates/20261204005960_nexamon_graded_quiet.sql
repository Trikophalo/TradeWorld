-- ===== idempotent copy of migrations/20261204005960_nexamon_graded_quiet.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5960 · Nexamon: the ASP notification does not spoil the grade (ADR-165)
-- =============================================================================
-- Owner's wish: a card back from ASP comes as a sealed package that the player opens; the notification (in-app and
-- push) only says the package is waiting. Neither title, text nor payload carries the grade. The Black Label feed
-- item (friends' feed, gossip for NEXA Nachrichten) is no longer posted when the grading finishes: the server does
-- not know when the owner opens the package (that happens on the device), so it would come before the reveal.
-- Mission events stay as they were. Replaces nexamon_finish_gradings() of 5850 entirely (create or replace).
-- Idempotent: runs unchanged as supabase/updates/20261204005960_nexamon_graded_quiet.sql.

create or replace function public.nexamon_finish_gradings(p_player uuid default null, p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now   timestamptz := coalesce(p_now, public.game_now());
  v_n     integer := 0;
  v_grade integer;
  r       record;
begin
  for r in select c.id, c.owner_id, c.card_key, c.condition, c.serial from public.nexamon_copies c
            where c.grading_until is not null and c.grading_until <= v_now
              and (p_player is null or c.owner_id = p_player)
            order by c.grading_until, c.id limit 200
            for update skip locked loop
    v_grade := public.nexamon_roll_grade(r.condition, random());
    update public.nexamon_copies set grade = v_grade, graded_at = v_now, grading_until = null where id = r.id;
    if r.owner_id is not null then
      -- the grade stays a surprise: only the waiting package is announced
      perform public.social_notify(r.owner_id, 'nexamon_graded', 'Paket von ASP',
        'Deine Nexamon-Karte ist zurück von ASP. Das versiegelte Paket wartet darauf, dass du es öffnest.',
        jsonb_build_object('copy_id', r.id, 'card_key', r.card_key, 'serial', r.serial),
        '/nexamon', 'nexamon_graded:' || r.id::text || ':' || extract(epoch from v_now)::bigint::text);
      perform public.mission_event(r.owner_id, 'nexamon_graded', 1, null);
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
  'Finishes due ASP gradings (ADR-165): rolls the grade, notifies the owner without the grade (sealed package), '
  'mission events. No feed item (the reveal happens on the device).';
