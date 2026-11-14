-- =============================================================================
-- 9e · A living NFT market: demand and trades between AI collectors (ADR-141)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

-- a gallery NFT held by a collector for an hour
select a.id as m from public.artworks a
 where a.owner_id is null and a.ai_owner is null
   and not exists (select 1 from public.artwork_auctions au where au.artwork_id = a.id and au.status = 'open')
 order by a.serial limit 1 \gset
update public.artworks set ai_owner = 'Vera Vermeer', value_cents = 500000, ask_cents = 625000,
       listed_at = now() - interval '1 hour' where id = :'m';

-- demand: an open offer makes it worth more to the collectors
select public.nft_ai_value_cents(:'m', now()) as v0, public.nft_demand_bps(:'m', now()) as d0 \gset
select public.nft_ai_post(:'m', 'Konrad Kollektor', 'offer', 'Ich will es!', 400000) is not null as ok \gset
select public.nft_demand_bps(:'m', now()) as d1, public.nft_ai_value_cents(:'m', now()) as v1 \gset
select tests.assert(
  :d1::bigint = :d0::bigint + 600 and :v1::bigint > :v0::bigint,
  'nft_demand_bps(): an open offer raises what the collectors pay (ADR-141)');

-- the fair value ignores the last price; the trade price moves halfway from the last price to the buyer's target
select tests.assert(
  public.nft_ai_trade_price_cents(null, 100000, 0) = 85000
  and public.nft_ai_trade_price_cents(1000000, 100000, 0) = 542500
  and public.nft_ai_trade_price_cents(10000, 100000, 0.999999) >= 65000,
  'nft_ai_trade_price_cents(): taste 85..125 %, half way from the last price (same as nftAiTradePriceCents)');

-- the collectors trade it among themselves; the money stays with the households, the buyer offers it again
select tests.set_cfg('nfts', '{ai,trade,chanceBps}', '10000');
select tests.set_cfg('nfts', '{ai,trade,maxChanceBps}', '10000');
select tests.set_cfg('nfts', '{ai,trade,perRun}', '50');
select tests.nft_house() as h0 \gset
select public.nfts_run_due(now()) as run \gset
select tests.assert(
  (:'run'::jsonb ->> 'traded')::integer >= 1
  and exists (select 1 from public.artwork_sales s where s.artwork_id = :'m' and s.kind = 'ai' and s.seller_ai is not null
                and s.seller_ai = 'Vera Vermeer' and s.buyer_ai is not null and s.buyer_ai <> 'Vera Vermeer')
  and (select ai_owner <> 'Vera Vermeer' and ask_cents is not null and value_cents <> 500000
         from public.artworks where id = :'m'),
  'nfts_run_due(): a collector buys from another one and offers it again (ADR-141)');
select tests.assert(
  exists (select 1 from public.artwork_messages where artwork_id = :'m' and kind = 'sale')
  and not exists (select 1 from public.artwork_messages where artwork_id = :'m' and offer_status = 'open'),
  'a trade between collectors shows in the chat and closes the open offers');
-- held too briefly: no second trade right away
select public.nfts_run_due(now()) as run2 \gset
select tests.assert(
  (select count(*) from public.artwork_sales where artwork_id = :'m' and kind = 'ai' and seller_ai is not null) = 1,
  'a collector keeps a new NFT for a while before selling it again');

select tests.set_cfg('nfts', '{ai,trade,chanceBps}', '60');
select tests.set_cfg('nfts', '{ai,trade,maxChanceBps}', '1500');
select tests.set_cfg('nfts', '{ai,trade,perRun}', '2');
select tests.assert(not exists (select 1 from public.ledger_audit()) and tests.money_invariant() = 'ok',
  'ledger audit and money invariant hold after trades between collectors');
