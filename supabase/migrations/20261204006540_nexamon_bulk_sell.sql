-- =============================================================================
-- NEXA · 6540 · Nexamon: selling bulk to the game (ADR-174)
-- =============================================================================
-- * Bulk = raw copies of the bulk rarities of their set (quickSell.setRarities[set], else quickSell.rarities:
--   common and rare). The game buys them at once for their current value minus quickSell.bps' fee (35 %, the rule
--   since ADR-174; it was 50 %), paid by the households through the ledger. Every copy sold this way lowers its
--   card's value by quickSell.dropBps like before (a small push down, never counted as a trade).
-- * bulk_sell_nexamon(p_request_id, p_copy_ids): the collection's bulk mode; up to quickSell.maxPerCall (500)
--   copies, rate-limited (quickSell.callsPerMinute), idempotent; the same rules as sell_nexamon_to_ai(), which now
--   also reads the per-set bulk rarities.
-- Idempotent: runs unchanged as supabase/updates/20261204006540_nexamon_bulk_sell.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.sell_nexamon_to_ai(uuid, uuid[])'::regprocedure);
  v_old text := $t$not coalesce(q -> 'rarities', '[]'::jsonb) ? k.rarity$t$;
  v_new text := $t$not coalesce(q #> array['setRarities', k.set_key], q -> 'rarities', '[]'::jsonb) ? k.rarity$t$;
begin
  if position('setRarities' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'sell_nexamon_to_ai() has an unexpected shape; read quickSell.setRarities (ADR-174) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

create or replace function public.bulk_sell_nexamon(p_request_id uuid, p_copy_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'bulk_sell_nexamon');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'nexamon_bulk',
                               coalesce((public.nexamon_cfg() #>> '{quickSell,callsPerMinute}')::integer, 10), 60) then
    perform public.api_error('rate_limited');
  end if;
  return public.request_complete(v_player, p_request_id,
    public.sell_nexamon_to_ai(md5(p_request_id::text || ':bulk')::uuid, p_copy_ids));
end;
$$;
comment on function public.bulk_sell_nexamon(uuid, uuid[]) is
  'RPC: sells raw bulk copies to the game at once for their value minus the bulk fee (ADR-174) -> sold, count, '
  'total_cents; errors as sell_nexamon_to_ai and rate_limited.';

do $do$
begin
  revoke all on function public.bulk_sell_nexamon(uuid, uuid[]) from public, anon;
  grant execute on function public.bulk_sell_nexamon(uuid, uuid[]) to authenticated;
end;
$do$;
