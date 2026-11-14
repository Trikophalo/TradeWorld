-- =============================================================================
-- 9b · NFTs (ADR-135): creator royalties on every resale, AI collectors buy only at a
--      good price, offer chat with accept, fixed price, closed money system
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set c '''09b09b09-0000-4000-8000-0000000000c1'''
\set b '''09b09b09-0000-4000-8000-0000000000b1'''
\set d '''09b09b09-0000-4000-8000-0000000000d1'''
\set e '''09b09b09-0000-4000-8000-0000000000e1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:c, 'Nina_Neon') is not null and tests.signup(:b, 'Ben_Bieter') is not null
   and tests.signup(:d, 'Dora_Deal') is not null and tests.signup(:e, 'Emil_Ebbe') is not null as ok \gset
select tests.set_level(:c, 8);
select tests.set_level(:b, 8);
select tests.set_level(:d, 8);
select tests.set_level(:e, 2);
select tests.fund(:c, 5000000, 'test:nft:c');
select tests.fund(:b, 8000000, 'test:nft:b');
select tests.fund(:d, 8000000, 'test:nft:d');

create or replace function tests.nft_house() returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where system_key = 'households' $$;
create or replace function tests.nft_art(p_fill text) returns jsonb language sql as $$
  select jsonb_build_object('palette', '["#102030", "#f0c020", "#20a0f0"]'::jsonb,
           'grid', (select to_jsonb(array_agg(case when y in (0, 31) then repeat('0', 32) else '0' || repeat(p_fill, 30) || '0' end
                                              order by y)) from generate_series(0, 31) y)) $$;
-- AI collectors: deterministic for the test (buy always when the price is good, offer on listings, never elsewhere)
create or replace function tests.nft_ai(p_buy integer, p_offer integer, p_unlisted integer) returns void language sql as $$
  update public.game_config
     set value = jsonb_set(jsonb_set(jsonb_set(value, '{ai,buyChanceBps}', to_jsonb(p_buy)),
                                     '{ai,listedOfferChanceBps}', to_jsonb(p_offer)),
                           '{ai,unlistedOfferChanceBps}', to_jsonb(p_unlisted))
   where key = 'nfts' $$;
grant execute on all functions in schema tests to public;
select tests.nft_ai(10000, 10000, 0);

-- =============================================================================
-- A. Minting: cost, mint_cents (the collectors' anchor), XP; rules as in src/lib/sim/nfts.ts
-- =============================================================================
select tests.cash(:c) as c0 \gset
select tests.login_as('authenticated', :c);
select public.create_artwork(gen_random_uuid(), 'Neon Nacht', tests.nft_art('1')) as m1 \gset
reset role;
select (:'m1'::jsonb #>> '{artwork,id}')::uuid as x \gset
select tests.assert(
  (select mint_cents from public.artworks where id = :'x') = 1500000
  and tests.cash(:c) = :c0::bigint - 1500000
  and (:'m1'::jsonb ->> 'xp')::int > 0
  and exists (select 1 from public.xp_events where player_id = :c and source = 'nft_mint')
  and :'m1'::jsonb #>> '{artwork,code}' like 'NFT-%'
  and (:'m1'::jsonb #>> '{artwork,royalty_bps}')::int = 1000
  and (:'m1'::jsonb #>> '{artwork,royalties_cents}')::bigint = 0
  and (:'m1'::jsonb #> '{artwork,ask_cents}') = 'null'::jsonb
  and (:'m1'::jsonb #> '{artwork,ai_owner}') = 'null'::jsonb,
  'create_artwork(): 15.000 EUR, mint_cents stored, mint XP, code NFT-…, NFT fields in ARTWORK');
select tests.assert(
  public.nft_ai_value_cents(:'x', now()) = 1500000
  and public.nft_ai_value_cents(:'x', now() + interval '3 days') = 1545000
  and public.nft_lowball_cents(1000000, 0) = 650000 and public.nft_lowball_cents(1234567, 0) = 802400
  and public.nft_lowball_cents(1000000, 0.9999999) = 899900
  and public.nft_ai_ask_cents(1000000) = 1250000 and public.nft_ai_ask_cents(1000001) = 1250100,
  'nftAiValueCents (mint anchor, +1 % per day), nftLowballCents, nftAiAskCents as in src/lib/sim/nfts.ts');

-- =============================================================================
-- B. Fixed price above the valuation: the AI does not buy, it writes a lowball offer
-- =============================================================================
select tests.login_as('authenticated', :c);
select tests.throws_key(format('select public.set_artwork_price(gen_random_uuid(), %L, 5000)', :'x'), 'invalid_argument',
  'set_artwork_price(): at least nfts.minAskCents');
select public.set_artwork_price(gen_random_uuid(), :'x', 2000000) as lp \gset
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key(format('select public.set_artwork_price(gen_random_uuid(), %L, 2000000)', :'x'), 'forbidden',
  'set_artwork_price(): only the owner');
select tests.throws_key(format('select public.buy_artwork(gen_random_uuid(), %L, 1999999)', :'x'), 'nft_price_changed',
  'buy_artwork(): the price the buyer saw must still hold (NX125)');
reset role;
select tests.nft_house() as h0 \gset
select public.nfts_run_due(now()) as run1 \gset
select tests.assert(
  (:'lp'::jsonb #>> '{artwork,ask_cents}')::bigint = 2000000
  and (select owner_id = :c and ai_owner is null and ask_cents = 2000000 from public.artworks where id = :'x')
  and tests.nft_house() = :h0::bigint
  and (:'run1'::jsonb ->> 'sold')::int = 0
  and (select count(*) = 1 and bool_and(offer_cents between 975000 and 1350000 and offer_status = 'open' and ai_name is not null)
         from public.artwork_messages where artwork_id = :'x' and kind = 'offer')
  and exists (select 1 from public.notifications n where n.player_id = :c and n.type_key = 'nft_offer'),
  'AI collectors: a listing above the valuation (2.000.000 > 1.500.000) is not bought; a lowball offer (65-90 %) appears and the owner is notified');

-- =============================================================================
-- C. Fixed price at the valuation: an AI collector buys (households money), no royalty for the creator-seller
-- =============================================================================
select tests.login_as('authenticated', :c);
select public.set_artwork_price(gen_random_uuid(), :'x', 1500000) is not null as ok \gset
reset role;
select tests.cash(:c) as c1 \gset
select tests.nft_house() as h1 \gset
select public.nfts_run_due(now()) as run2 \gset
select ai_owner as collector from public.artworks where id = :'x' \gset
select tests.assert(
  (:'run2'::jsonb ->> 'sold')::int = 1
  and (select owner_id is null and ai_owner is not null and value_cents = 1500000 and ask_cents is not null
         from public.artworks where id = :'x')
  and tests.cash(:c) = :c1::bigint + 1500000 - 150000
  and tests.nft_house() = :h1::bigint - 1500000 + 150000
  and (select kind = 'ai' and buyer_ai = :'collector' and seller_id = :c and price_cents = 1500000 and fee_cents = 150000
              and royalty_cents = 0
         from public.artwork_sales where artwork_id = :'x' order by id desc limit 1)
  and not exists (select 1 from public.artwork_messages where artwork_id = :'x' and offer_status = 'open')
  and exists (select 1 from public.artwork_messages where artwork_id = :'x' and kind = 'sale' and body = :'collector')
  and exists (select 1 from public.artwork_messages where artwork_id = :'x' and kind = 'chat' and ai_name = :'collector')
  and exists (select 1 from public.notifications n where n.player_id = :c and n.type_key = 'nft_sale'),
  'AI collectors buy a listing at their valuation: the seller gets price minus 10 % fee, the households pay, open offers close, the chat notes the sale');
select tests.assert(
  (select ask_cents from public.artworks where id = :'x') = public.nft_ai_ask_cents(public.nft_ai_value_cents(:'x')),
  'an NFT the AI holds is offered at its valuation x 1.25');

-- =============================================================================
-- D. Resale by the AI to a player: the creator gets the royalty although it is no longer theirs
-- =============================================================================
select ask_cents as ask1 from public.artworks where id = :'x' \gset
select tests.cash(:b) as b0 \gset
select tests.cash(:c) as c2 \gset
select tests.nft_house() as h2 \gset
select tests.login_as('authenticated', :b);
select public.buy_artwork(gen_random_uuid(), :'x', :ask1) as buy1 \gset
reset role;
select tests.assert(
  (select owner_id = :b and ai_owner is null and ask_cents is null and value_cents = :ask1::bigint
         from public.artworks where id = :'x')
  and tests.cash(:b) = :b0::bigint - :ask1::bigint
  and tests.cash(:c) = :c2::bigint + :ask1::bigint / 10
  and tests.nft_house() = :h2::bigint + :ask1::bigint - :ask1::bigint / 10
  and (:'buy1'::jsonb ->> 'royalty_cents')::bigint = :ask1::bigint / 10
  and (select royalties_cents from public.artworks where id = :'x') = :ask1::bigint / 10
  and exists (select 1 from public.notifications n where n.player_id = :c and n.type_key = 'nft_royalty')
  and exists (select 1 from public.ledger_transactions t where t.kind = 'artwork_royalty' and t.initiated_by = :c),
  'buy_artwork() from an AI collector: the buyer pays the price, the creator (no longer owner) gets 10 % royalty, the rest goes back to the households');

-- =============================================================================
-- E. Offer chat: texts, offers, accept moves ownership and money, royalty again
-- =============================================================================
select term as bad_term from public.blocked_name_terms where category = 'profanity' and match_mode = 'substring' order by term limit 1 \gset
select tests.login_as('authenticated', :d);
select tests.throws_key(format('select public.post_artwork_message(gen_random_uuid(), %L, %L)', :'x', '   '), 'nft_text_invalid',
  'post_artwork_message(): empty text (NX121)');
select tests.throws_key(format('select public.post_artwork_message(gen_random_uuid(), %L, %L)', :'x', repeat('x', 201)), 'nft_text_invalid',
  'post_artwork_message(): longer than 200 characters');
select tests.throws_key(format('select public.post_artwork_message(gen_random_uuid(), %L, %L)', :'x', 'Du ' || :'bad_term'), 'nft_text_invalid',
  'post_artwork_message(): through the word filter');
select tests.throws_key(format('select public.post_artwork_message(gen_random_uuid(), %L, %L, 5000)', :'x', 'Billig?'), 'bid_too_low',
  'post_artwork_message(): an offer needs at least nfts.minOfferCents');
select tests.throws_key(format('select public.post_artwork_message(gen_random_uuid(), %L, %L, 99000000)', :'x', 'Alles!'), 'insufficient_funds',
  'post_artwork_message(): no offer above the own cash');
select public.post_artwork_message(gen_random_uuid(), :'x', 'Wow, tolle Farben!') is not null as ok \gset
select public.post_artwork_message(gen_random_uuid(), :'x', 'Ich biete 20.000', 2000000) is not null as ok \gset
select public.post_artwork_message(gen_random_uuid(), :'x', 'Na gut, 25.000', 2500000) as chat1 \gset
reset role;
select id as offer1 from public.artwork_messages where artwork_id = :'x' and author_id = :d and offer_cents = 2500000 \gset
select id as offer0 from public.artwork_messages where artwork_id = :'x' and author_id = :d and offer_cents = 2000000 \gset
select tests.assert(
  (:'chat1'::jsonb ->> 'my_offer_cents')::bigint = 2500000
  and not (:'chat1'::jsonb ->> 'is_owner')::boolean
  and (select offer_status from public.artwork_messages where id = :offer0) = 'closed'
  and (select count(*) from jsonb_array_elements(:'chat1'::jsonb -> 'messages') m where (m ->> 'mine')::boolean) = 3
  and exists (select 1 from jsonb_array_elements(:'chat1'::jsonb -> 'messages') m
               where m ->> 'kind' = 'sale' and (m ->> 'offer_cents')::bigint = :ask1::bigint and m ->> 'text' = 'Ben_Bieter')
  and exists (select 1 from public.notifications n where n.player_id = :b and n.type_key = 'nft_offer'),
  'post_artwork_message(): chat line and offers; a new offer replaces the own older one; the owner is notified');

select tests.login_as('authenticated', :d);
select tests.throws_key(format('select public.accept_artwork_offer(gen_random_uuid(), %s)', :offer1), 'forbidden',
  'accept_artwork_offer(): only the owner');
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key(format('select public.post_artwork_message(gen_random_uuid(), %L, %L, 3000000)', :'x', 'Meins'), 'own_artwork',
  'post_artwork_message(): no offer on the own NFT');
select tests.throws_key(format('select public.accept_artwork_offer(gen_random_uuid(), %s)', :offer0), 'nft_offer_closed',
  'accept_artwork_offer(): a replaced offer is closed (NX122)');
select public.get_artwork_chat(:'x') as chat_b \gset
reset role;
select tests.cash(:b) as b1 \gset
select tests.cash(:c) as c3 \gset
select tests.cash(:d) as d1 \gset
select tests.nft_house() as h3 \gset
select tests.login_as('authenticated', :b);
select public.accept_artwork_offer(gen_random_uuid(), :offer1) as acc1 \gset
select tests.throws_key(format('select public.accept_artwork_offer(gen_random_uuid(), %s)', :offer1), 'forbidden',
  'accept_artwork_offer(): once sold the old owner cannot accept again');
reset role;
select tests.assert(
  (:'chat_b'::jsonb ->> 'is_owner')::boolean
  and (select owner_id = :d and value_cents = 2500000 from public.artworks where id = :'x')
  and tests.cash(:d) = :d1::bigint - 2500000
  and tests.cash(:b) = :b1::bigint + 2500000 - 250000 - 250000
  and tests.cash(:c) = :c3::bigint + 250000
  and tests.nft_house() = :h3::bigint + 250000
  and (:'acc1'::jsonb ->> 'royalty_cents')::bigint = 250000 and (:'acc1'::jsonb ->> 'fee_cents')::bigint = 250000
  and (select offer_status from public.artwork_messages where id = :offer1) = 'accepted'
  and (select kind = 'offer' and royalty_cents = 250000 and creator_id = :c
         from public.artwork_sales where artwork_id = :'x' order by id desc limit 1),
  'accept_artwork_offer(): the buyer pays 25.000 EUR, the seller gets 20.000 EUR (10 % fee, 10 % royalty), the creator 2.500 EUR');

-- rate limit: at most nfts.chat.perMinute messages a minute
select tests.login_as('authenticated', :d);
select public.post_artwork_message(gen_random_uuid(), :'x', 'Danke!') is not null as ok \gset
select public.post_artwork_message(gen_random_uuid(), :'x', 'Wirklich schön.') is not null as ok \gset
select public.post_artwork_message(gen_random_uuid(), :'x', 'Gute Wahl von mir.') is not null as ok \gset
select tests.throws_key(format('select public.post_artwork_message(gen_random_uuid(), %L, %L)', :'x', 'Spam'), 'rate_limited',
  'post_artwork_message(): at most 6 messages a minute');
reset role;
-- (the minute is over)
update public.artwork_messages set created_at = created_at - interval '2 minutes' where author_id = :d;
select tests.login_as('authenticated', :e);
select tests.throws_key(format('select public.post_artwork_message(gen_random_uuid(), %L, %L)', :'x', 'Hallo'), 'artworks_locked',
  'post_artwork_message(): from the NFT unlock level');
reset role;

-- =============================================================================
-- F. Auction resale: the creator's royalty comes out of the escrow
-- =============================================================================
select tests.login_as('authenticated', :d);
select public.set_artwork_price(gen_random_uuid(), :'x', 9000000) is not null as ok \gset
select public.start_auction(gen_random_uuid(), :'x', 3000000, 1) #>> '{artwork,auction,id}' as au \gset
reset role;
select tests.assert((select ask_cents is null from public.artworks where id = :'x'), 'start_auction(): ends the fixed price');
select tests.login_as('authenticated', :b);
select tests.throws_key(format('select public.buy_artwork(gen_random_uuid(), %L, 9000000)', :'x'), 'nft_not_for_sale',
  'buy_artwork(): not during an auction (NX124)');
select public.bid_artwork(gen_random_uuid(), :'au', 3000000) is not null as ok \gset
reset role;
select tests.cash(:c) as c4 \gset
select tests.cash(:d) as d2 \gset
update public.artwork_auctions set ends_at = public.game_now() - interval '1 second' where id = :'au';
select public.artworks_run_due() is not null as ok \gset
select tests.assert(
  (select owner_id = :b and value_cents = 3000000 and royalties_cents = :ask1::bigint / 10 + 250000 + 300000
         from public.artworks where id = :'x')
  and tests.cash(:c) = :c4::bigint + 300000
  and tests.cash(:d) = :d2::bigint + 3000000 - 300000 - 300000
  and (select balance_cents from public.ledger_accounts where system_key = 'art_escrow') >= 0
  and (select kind = 'auction' and royalty_cents = 300000 from public.artwork_sales where artwork_id = :'x' order by id desc limit 1),
  'artwork_settle_auction(): the creator gets 10 % of the auction price from the escrow, the seller the rest minus the fee');

-- =============================================================================
-- G. NFTs the AI holds: low offers are declined, good ones accepted
-- =============================================================================
select tests.login_as('authenticated', :c);
select (public.create_artwork(gen_random_uuid(), 'Blaue Welle', tests.nft_art('2')) #>> '{artwork,id}')::uuid as y \gset
select public.set_artwork_price(gen_random_uuid(), :'y', 1000000) is not null as ok \gset
reset role;
select public.nfts_run_due(now()) is not null as ok \gset
select ai_owner as collector2 from public.artworks where id = :'y' \gset
select public.nft_ai_value_cents(:'y') as yv \gset
select tests.assert(:'collector2' <> '' and (select owner_id is null from public.artworks where id = :'y'),
  'a listing below the valuation is bought by an AI collector');
select tests.login_as('authenticated', :d);
select public.post_artwork_message(gen_random_uuid(), :'y', 'Wie wäre es damit?', (:yv::bigint * 9 / 10)) is not null as ok \gset
reset role;
select public.nfts_run_due(now()) is not null as ok \gset
select tests.assert(
  (select offer_status from public.artwork_messages where artwork_id = :'y' and author_id = :d order by id desc limit 1) = 'declined'
  and (select ai_owner from public.artworks where id = :'y') = :'collector2'
  and exists (select 1 from public.artwork_messages where artwork_id = :'y' and ai_name = :'collector2' and kind = 'chat'
                and id > (select max(id) from public.artwork_messages where artwork_id = :'y' and author_id = :d)),
  'the AI declines an offer below 105 % of its valuation and says so in the chat');
select tests.cash(:d) as d3 \gset
select tests.cash(:c) as c5 \gset
select tests.login_as('authenticated', :d);
select public.post_artwork_message(gen_random_uuid(), :'y', 'Mein letztes Wort', (:yv::bigint * 11 / 10)) is not null as ok \gset
reset role;
select public.nfts_run_due(now()) is not null as ok \gset
select tests.assert(
  (select owner_id = :d and ai_owner is null from public.artworks where id = :'y')
  and tests.cash(:d) = :d3::bigint - :yv::bigint * 11 / 10
  and tests.cash(:c) = :c5::bigint + (:yv::bigint * 11 / 10) / 10,
  'the AI accepts an offer from 105 % of its valuation; the creator gets the royalty');

-- =============================================================================
-- H. Reads: creators ranking, studio, collection; marketplace sorts
-- =============================================================================
select tests.login_as('authenticated', :c);
select public.get_art_rankings(10) as rk \gset
select public.get_art_studio() as st \gset
select public.get_collection('Nina_Neon') as col \gset
select public.get_artworks('wanted', 'all', false, 5, 0) is not null as ok \gset
select public.get_artworks('for_sale', 'all', false, 5, 0) as fs \gset
select public.get_artwork(:'x') as det \gset
reset role;
select coalesce(sum(royalties_cents), 0) as roy from public.artworks where creator_id = :c \gset
select tests.assert(
  (select (x ->> 'royalties_cents')::bigint = :roy::bigint and (x ->> 'is_me')::boolean and (x ->> 'count')::int = 2
     from jsonb_array_elements(:'rk'::jsonb -> 'creators') x where x ->> 'nickname' = 'Nina_Neon')
  and (:'st'::jsonb ->> 'royalties_cents')::bigint = :roy::bigint and :roy::bigint > 0
  and (:'col'::jsonb ->> 'created')::int = 2 and (:'col'::jsonb ->> 'royalties_cents')::bigint = :roy::bigint
  and not exists (select 1 from jsonb_array_elements(:'fs'::jsonb -> 'entries') x where x -> 'ask_cents' = 'null'::jsonb)
  and (select count(*) from jsonb_array_elements(:'det'::jsonb -> 'sales') s where (s ->> 'royalty_cents')::bigint > 0) = 3,
  'get_art_rankings().creators, get_art_studio() and get_collection() show the royalties; for_sale lists only fixed prices; get_artwork() sales carry royalty_cents');

-- account reset: listings and offers of the player end
select tests.login_as('authenticated', :d);
select public.post_artwork_message(gen_random_uuid(), :'x', 'Noch ein Angebot', 3500000) is not null as ok \gset
reset role;
select public.artworks_wipe_player(:d, 'test:nft:wipe') is null as ok \gset
select tests.assert(
  not exists (select 1 from public.artwork_messages where author_id = :d and offer_status = 'open')
  and (select owner_id is null and ask_cents is null from public.artworks where id = :'y'),
  'artworks_wipe_player(): open offers close, own NFTs go to the gallery without a fixed price');
select tests.assert(
  (select ai_owner is null from public.artworks where id = :'y')
  and public.artworks_gallery_schedule(now()) >= 0
  and not exists (select 1 from public.artwork_auctions au join public.artworks a on a.id = au.artwork_id
                   where au.status = 'open' and au.by_gallery and a.ai_owner is not null),
  'the gallery never auctions NFTs that AI collectors hold');

-- =============================================================================
-- I. Closed money system
-- =============================================================================
select tests.assert(not exists (select 1 from public.ledger_audit()), 'ledger audit clean after NFT sales and royalties');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after NFT sales, royalties and AI purchases');
select tests.nft_ai(2500, 800, 80);
