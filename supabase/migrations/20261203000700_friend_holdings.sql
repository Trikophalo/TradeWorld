-- =============================================================================
-- NEXA · 0700 · Friends see each other's investments (ADR-121)
-- =============================================================================
-- get_player_holdings(p_nickname) (authenticated): what a player holds and how much, for the player themselves and
-- for their friends. Everyone else only learns that it is private.
--   {"visible": true,  "total_cents", "positions": [{"ticker", "name", "kind", "sector", "quantity_e6",
--                                                    "value_cents", "share_bps"}]}   -- biggest first
--   {"visible": false, "total_cents": null, "positions": []}
-- Idempotent: runs unchanged as supabase/updates/20261203000700_friend_holdings.sql.

create or replace function public.get_player_holdings(p_nickname text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid;
  v_target uuid;
  v_total  bigint;
begin
  v_me := public.require_player();
  v_target := public.player_by_handle(p_nickname);
  if v_target is null then
    perform public.api_error('player_not_found');
  end if;
  if v_target <> v_me and not public.are_friends(v_me, v_target) then
    return jsonb_build_object('visible', false, 'total_cents', null, 'positions', '[]'::jsonb);
  end if;
  select coalesce(sum(public.value_cents(pos.quantity_e6, coalesce(q.bid_e4, q.last_price_e4))), 0)::bigint into v_total
    from public.positions pos join public.security_quotes q on q.security_id = pos.security_id
   where pos.player_id = v_target and pos.status = 'open' and pos.quantity_e6 > 0;
  return jsonb_build_object(
    'visible', true,
    'total_cents', v_total,
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ticker', x.ticker, 'name', x.name, 'kind', x.kind, 'sector', x.sector_key, 'quantity_e6', x.quantity_e6,
               'value_cents', x.val,
               'share_bps', case when v_total > 0 then round(x.val * 10000.0 / v_total)::integer else 0 end)
             order by x.val desc, x.ticker)
        from (select s.ticker, s.name, s.kind, s.sector_key, sum(pos.quantity_e6)::bigint as quantity_e6,
                     sum(public.value_cents(pos.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))::bigint as val
                from public.positions pos
                join public.securities s on s.id = pos.security_id
                join public.security_quotes q on q.security_id = pos.security_id
               where pos.player_id = v_target and pos.status = 'open' and pos.quantity_e6 > 0
               group by s.ticker, s.name, s.kind, s.sector_key) x), '[]'::jsonb));
end;
$$;
comment on function public.get_player_holdings(text) is
  'RPC: the investments of a player, visible to the player and to friends (ADR-121).';
revoke all on function public.get_player_holdings(text) from public, anon;
grant execute on function public.get_player_holdings(text) to authenticated, service_role;
