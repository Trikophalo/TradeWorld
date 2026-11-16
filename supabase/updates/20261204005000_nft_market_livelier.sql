-- ===== idempotent copy of migrations/20261204005000_nft_market_livelier.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5000 · A livelier NFT market: several collectors bid at once (ADR-163)
-- =============================================================================
-- Until now an NFT got a new AI offer only while no collector had an open one, so with offers open for a day a
-- player NFT saw at most one AI offer a day. Now up to nfts.ai.maxOpenAiOffers (3) different collectors may have an
-- open offer on the same NFT; a collector who already bids on it is not picked again. More activity comes from
-- game_config (higher offer and trade chances, more trades per run and day).
-- Idempotent: runs unchanged as supabase/updates/20261204005000_nft_market_livelier.sql.

-- a collector without an open offer on this NFT (null when all of them bid already)
create or replace function public.nft_free_collector(p_artwork uuid, p_u double precision)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c from jsonb_array_elements_text(public.nfts_cfg() #> '{ai,collectors}') with ordinality t(c, ord)
   where not exists (select 1 from public.artwork_messages m where m.artwork_id = p_artwork and m.ai_name = c
                       and m.offer_status = 'open')
   order by abs(ord - 1 - floor(greatest(p_u, 0) * jsonb_array_length(public.nfts_cfg() #> '{ai,collectors}'))), ord
   limit 1;
$$;
revoke all on function public.nft_free_collector(uuid, double precision) from public, anon, authenticated;
grant execute on function public.nft_free_collector(uuid, double precision) to service_role;

do $do$
declare
  v_def text := pg_get_functiondef('public.nfts_run_due(timestamptz)'::regprocedure);
  -- 1. listed NFTs above the value: up to maxOpenAiOffers collectors, each picked among those without an offer
  v_old1 text := $t$          and not exists (select 1 from public.artwork_messages m where m.artwork_id = a.id and m.ai_name is not null
                            and m.offer_status = 'open') then
      v_id := public.nft_ai_post(a.id, public.nft_pick('{ai,collectors}', random()), 'offer',$t$;
  v_new1 text := $t$          and (select count(*) from public.artwork_messages m where m.artwork_id = a.id and m.ai_name is not null
                 and m.offer_status = 'open') < coalesce((ai ->> 'maxOpenAiOffers')::integer, 1)
          and public.nft_free_collector(a.id, random()) is not null then
      v_id := public.nft_ai_post(a.id, public.nft_free_collector(a.id, random()), 'offer',$t$;
  -- 2. NFTs players keep: the same
  v_old2 text := $t$              and not exists (select 1 from public.artwork_messages m where m.artwork_id = x.id and m.ai_name is not null
                                and m.offer_status = 'open')
            order by random() limit greatest(0, (ai ->> 'maxMessagesPerRun')::integer - v_msgs) loop
    continue when random() * 10000 >= (ai ->> 'unlistedOfferChanceBps')::integer;
    v_id := public.nft_ai_post(r.id, public.nft_pick('{ai,collectors}', random()), 'offer',$t$;
  v_new2 text := $t$              and (select count(*) from public.artwork_messages m where m.artwork_id = x.id and m.ai_name is not null
                     and m.offer_status = 'open') < coalesce((ai ->> 'maxOpenAiOffers')::integer, 1)
            order by random() limit greatest(0, (ai ->> 'maxMessagesPerRun')::integer - v_msgs) loop
    continue when random() * 10000 >= (ai ->> 'unlistedOfferChanceBps')::integer;
    continue when public.nft_free_collector(r.id, 0.5) is null;
    v_id := public.nft_ai_post(r.id, public.nft_free_collector(r.id, random()), 'offer',$t$;
begin
  if position('nft_free_collector' in v_def) = 0 then
    if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then
      raise exception 'nfts_run_due() has an unexpected shape; add the multi-collector offers by hand';
    end if;
    execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
  end if;
end;
$do$;
