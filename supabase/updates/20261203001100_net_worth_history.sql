-- ===== idempotent copy of migrations/20261203001100_net_worth_history.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1100 · The own net worth over time, for the portfolio chart (ADR-124)
-- =============================================================================
-- get_my_net_worth_history(p_hours) (authenticated): the player's net worth from the rich list snapshots (every few
-- minutes, kept 8 days), at most about 300 points: every snapshot for a day, hourly buckets for longer ranges.
--   {"points": [{"at", "net_worth_cents"}]}   -- oldest first
-- Idempotent: runs unchanged as supabase/updates/20261203001100_net_worth_history.sql.

create or replace function public.get_my_net_worth_history(p_hours integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_hours  integer := least(192, greatest(1, coalesce(p_hours, 24)));
  v_from   timestamptz := public.game_now() - make_interval(hours => v_hours);
  v_bucket interval := case when v_hours <= 24 then interval '5 minutes' else interval '1 hour' end;
begin
  return jsonb_build_object('points', coalesce((
    select jsonb_agg(jsonb_build_object('at', b.at, 'net_worth_cents', b.nw) order by b.at)
      from (select date_bin(v_bucket, s.taken_at, '2000-01-01 00:00:00+00') as at,
                   (array_agg(s.net_worth_cents order by s.taken_at desc))[1] as nw
              from public.rich_list_snapshots s
             where s.entity_id = v_player and s.entity_kind = 'player' and s.taken_at >= v_from
             group by 1) b), '[]'::jsonb));
end;
$$;
comment on function public.get_my_net_worth_history(integer) is
  'RPC: the own net worth over the last hours, from the rich list snapshots (ADR-124).';
revoke all on function public.get_my_net_worth_history(integer) from public, anon;
grant execute on function public.get_my_net_worth_history(integer) to authenticated, service_role;
