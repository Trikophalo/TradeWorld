-- ===== idempotent copy of migrations/20261204004000_accept_auction.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 4000 · NFT owners can end an auction early and sell to the highest bid
-- =============================================================================
-- accept_auction(p_request_id, p_auction_id): only the seller, only an open auction with at least one bid. The
-- auction ends now and is settled exactly like a due one (artwork_settle_auction: fee, royalty, escrow to seller).
-- Idempotent: runs unchanged as supabase/updates/20261204004000_accept_auction.sql.

create or replace function public.accept_auction(p_request_id uuid, p_auction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  au       public.artwork_auctions;
begin
  v_player := public.require_player();
  perform public.artworks_require_unlock(v_player);
  if p_request_id is null or p_auction_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'accept_auction');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into au from public.artwork_auctions where id = p_auction_id for update;
  if au.id is null then
    perform public.api_error('auction_not_found');
  end if;
  if au.by_gallery or au.seller_id is distinct from v_player then
    perform public.api_error('forbidden');
  end if;
  if au.status <> 'open' then
    perform public.api_error('auction_ended');
  end if;
  if au.leader_id is null or au.current_cents is null then
    perform public.api_error('invalid_argument');
  end if;
  update public.artwork_auctions set ends_at = public.game_now() where id = au.id;
  perform public.artwork_settle_auction(au.id);
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'artwork', public.artwork_json(au.artwork_id, v_player), 'price_cents', au.current_cents));
end;
$$;
revoke all on function public.accept_auction(uuid, uuid) from public, anon;
grant execute on function public.accept_auction(uuid, uuid) to authenticated, service_role;
comment on function public.accept_auction(uuid, uuid) is
  'RPC: the seller ends an open NFT auction with bids now and sells to the highest bid (settled like a due auction).';
