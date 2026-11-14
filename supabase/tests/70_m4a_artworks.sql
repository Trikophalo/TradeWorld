-- =============================================================================
-- 70 · M4a: artworks (ADR-080): gallery, painting, likes, auctions with escrow,
--      collections, net worth; new mission metrics
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''07070707-0000-4000-8000-0000000000a1'''
\set b '''07070707-0000-4000-8000-0000000000b2'''
\set c '''07070707-0000-4000-8000-0000000000c3'''
\set l '''07070707-0000-4000-8000-0000000000d4'''
select tests.signup(:a, 'Anna_Pinsel') is not null and tests.signup(:b, 'Bruno_Bieter') is not null
   and tests.signup(:c, 'Carla_Kunst') is not null and tests.signup(:l, 'Lea_Neuling') is not null as ok \gset
select tests.set_level(:a, 8);
select tests.set_level(:b, 9);
select tests.set_level(:c, 12);
select tests.set_level(:l, 3);
select tests.fund(:a, 6000000, 'test:m4a:a');
select tests.fund(:b, 3000000, 'test:m4a:b');

-- 32 x 32 artworks: a frame in colour 0 around a filling in colour 1 (+ a stripe in colour p_extra)
create or replace function tests.art(p_palette text[] default array['#112233', '#ffcc00'], p_fill text default '1',
                                     p_rows integer default 32, p_cols integer default 32) returns jsonb language sql as $$
  select jsonb_build_object('palette', to_jsonb(p_palette),
           'grid', (select to_jsonb(array_agg(case when y in (0, p_rows - 1) then repeat('0', p_cols)
                                                   else '0' || repeat(p_fill, p_cols - 2) || '0' end order by y))
                      from generate_series(0, p_rows - 1) y)) $$;
create or replace function tests.escrow() returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where system_key = 'art_escrow' $$;
create or replace function tests.households() returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where system_key = 'households' $$;
create or replace function tests.treasury() returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where system_key = 'treasury' $$;
create or replace function tests.end_auction(p_auction uuid) returns jsonb language sql as $$
  update public.artwork_auctions set ends_at = public.game_now() - interval '1 second' where id = p_auction;
  select public.artworks_run_due() $$;
grant execute on all functions in schema tests to public;
\set cross '''{x.xxx,x.x..,xxxxx,..x.x,xxx.x}'''
select (select id from public.artworks where serial = 1) as g1, (select id from public.artworks where serial = 2) as g2,
       (select id from public.artworks where serial = 3) as g3 \gset

-- =============================================================================
-- A. Gallery seed and rules
-- =============================================================================
select tests.assert(
  (select count(*) from public.artworks where origin = 'game') = 36
  and (select count(*) from public.artworks where origin = 'game' and rarity = 'common') = 25
  and (select count(*) from public.artworks where origin = 'game' and rarity = 'rare') = 8
  and (select count(*) from public.artworks where origin = 'game' and rarity = 'legendary') = 3
  and (select array_agg(serial order by serial) from public.artworks where origin = 'game') = (select array_agg(g::bigint) from generate_series(1, 36) g)
  and not exists (select 1 from public.artworks where origin = 'game' and (owner_id is not null or creator_id is not null))
  and (select bool_and(public.artwork_valid(pixels)) from public.artworks where origin = 'game'),
  'gallery: 36 valid artworks (25 common, 8 rare, 3 legendary) owned by the NEXA gallery, ART-0001..ART-0036 without gaps although the seed ran twice');
select tests.assert(
  public.artwork_code(42) = 'NFT-0042' and public.artwork_code(12345) = 'NFT-12345'
  and public.artwork_create_cost_cents(0) = 1500000 and public.artwork_create_cost_cents(1) = 2250000
  and public.artwork_create_cost_cents(3) = 5062500
  and public.artwork_min_bid_cents(500000, null) = 500000
  and public.artwork_min_bid_cents(500000, 500000) = 525000
  and public.artwork_min_bid_cents(100000, 105000) = 110300
  and abs(public.artwork_hot(0, 0, now(), now()) - 1 / power(2, 1.5)) < 1e-9
  and abs(public.artwork_hot(2, 1, now() - interval '2 hours', now()) - 6 / 8.0) < 1e-9,
  'artworkCode (NFT-0042, ADR-135), artworkCreateCostCents (x1.5, ADR-135), minNextBidCents (+5 %, whole euros), hotScore as in src/lib/sim/artworks.ts');

-- isValidArtwork
select tests.assert(
  public.artwork_valid(tests.art())
  and public.artwork_valid(tests.art(array['#000000', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777',
                                            '#888888', '#999999', '#aaaaaa', '#bbbbbb'], 'b'))
  and public.artwork_valid(jsonb_build_object('palette', '["#123456"]'::jsonb,
                             'grid', to_jsonb(array['0000000000000000' || repeat('.', 16)] || array_fill(repeat('.', 32), array[31])))),
  'artwork_valid(): 32 x 32, palette indices 0-9a-f below the palette length, exactly 16 pixels are enough');
select tests.assert(
  not public.artwork_valid(tests.art(p_rows => 31))
  and not public.artwork_valid(tests.art(p_cols => 33))
  and not public.artwork_valid(tests.art(array['#112233', '#ffcc00'], '2'))
  and not public.artwork_valid(tests.art(array['#112233', '#FFCC00']))
  and not public.artwork_valid(tests.art(array['#112233', 'red']))
  and not public.artwork_valid(tests.art((select array_agg('#0000' || lpad(to_hex(i), 2, '0')) from generate_series(1, 17) i)))
  and not public.artwork_valid(tests.art(array[]::text[]))
  and not public.artwork_valid(jsonb_build_object('palette', '["#123456"]'::jsonb,
                                 'grid', to_jsonb(array['000000000000000' || repeat('.', 17)] || array_fill(repeat('.', 32), array[31]))))
  and not public.artwork_valid('{"palette": ["#123456"]}'::jsonb)
  and not public.artwork_valid(null),
  'artwork_valid(): wrong size, index beyond the palette, upper case or named colours, 17 colours, no palette, 15 pixels, no grid');

-- =============================================================================
-- B. Unlock level: reading is open, writing needs level 4 (ADR-099)
-- =============================================================================
select tests.login_as('authenticated', :l);
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', 'Mein Bild', tests.art()),
  'artworks_locked', 'level 3: create_artwork is locked');
select tests.throws_key(format('select public.like_artwork(gen_random_uuid(), %L, true)', :'g1'),
  'artworks_locked', 'level 3: like_artwork is locked');
select public.get_art_studio() as st_l \gset
select public.get_artworks('hot', 'all', false, 5, 0) as list_l \gset
reset role;
select tests.assert(
  :'st_l'::jsonb - 'royalty_bps' - 'mint_xp' = '{"painted": 0, "next_cost_cents": 1500000, "unlocked": false, "royalties_cents": 0}'::jsonb
  and (:'list_l'::jsonb ->> 'total')::int >= 36 and jsonb_array_length(:'list_l'::jsonb -> 'entries') = 5,
  'level 3: get_art_studio (unlocked false) and get_artworks can be read');
select tests.assert(
  exists (select 1 from public.unlocks where key = 'artworks' and level = 4 and title = 'NFTs')
  and public.unlock_level('artworks') = 4,
  'the unlock row "artworks" (level 4) exists for has_unlock() and the level-up');

-- =============================================================================
-- C. Painting: validation, forbidden symbols, cost doubling to the treasury
-- =============================================================================
select tests.cash(:a) as a0 \gset
select tests.treasury() as t0 \gset
select term as bad_term from public.blocked_name_terms where category = 'profanity' and match_mode = 'substring' order by term limit 1 \gset
select gen_random_uuid() as rq_paint \gset
select tests.login_as('authenticated', :a);
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', 'Ab', tests.art()), 'name_too_short', 'title too short');
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', repeat('Lang ', 9), tests.art()), 'name_too_long', 'title longer than titleMaxLength');
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', '<b>Bild</b>', tests.art()), 'name_invalid_chars', 'title with markup');
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', 'Bild ' || :'bad_term', tests.art()), 'name_profanity', 'title through the name filter');
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', 'Mein Bild', tests.art(p_rows => 31)), 'invalid_argument', 'invalid pixels');
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', 'Mein Kreuz',
                                jsonb_build_object('palette', '["#112233"]'::jsonb, 'grid', tests.draw(:cross, 2, 9, 11, '0', array_fill(repeat('.', 32), array[32])))),
  'logo_forbidden', 'a forbidden symbol anywhere in the 32 x 32 grid');
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', 'Bunte Fahne',
                                jsonb_build_object('palette', '["#000000","#111111","#222222","#333333","#444444","#555555","#666666","#777777","#888888","#999999","#aaaaaa","#bbbbbb"]'::jsonb,
                                                   'grid', tests.draw(:cross, 1, 20, 20, 'b', (select array_agg(case when y < 4 then repeat('3', 32) else repeat('.', 32) end order by y) from generate_series(0, 31) y)))),
  'logo_forbidden', 'forbidden symbols are found in the mask of a hex palette colour (b)');
select public.create_artwork(:'rq_paint', '  Abendlicht   am  Kanal ', tests.art()) as p1 \gset
select public.create_artwork(:'rq_paint', 'Abendlicht am Kanal', tests.art()) as p1b \gset
select public.create_artwork(gen_random_uuid(), 'Gelbe Stunde', tests.art(array['#334455', '#ffee00', '#00ff00'], '2')) as p2 \gset
select public.get_art_studio() as st_a \gset
reset role;
select (:'p1'::jsonb #>> '{artwork,id}')::uuid as art1, (:'p2'::jsonb #>> '{artwork,id}')::uuid as art2 \gset
select tests.assert(
  :'p1b'::jsonb = :'p1'::jsonb
  and (:'p1'::jsonb ->> 'cost_cents')::bigint = 1500000 and (:'p1'::jsonb ->> 'next_cost_cents')::bigint = 2250000
  and (:'p2'::jsonb ->> 'cost_cents')::bigint = 2250000 and (:'p2'::jsonb ->> 'next_cost_cents')::bigint = 3375000
  and tests.cash(:a) = :a0 - 3750000 and tests.treasury() = :t0 + 3750000
  and :'st_a'::jsonb - 'royalty_bps' - 'mint_xp' = '{"painted": 2, "next_cost_cents": 3375000, "unlocked": true, "royalties_cents": 0}'::jsonb,
  'create_artwork(): 15.000 EUR, then 22.500 EUR (x1.5, ADR-135) to the treasury; replay-safe; get_art_studio counts the paintings');
select tests.assert(
  :'p1'::jsonb #>> '{artwork,title}' = 'Abendlicht am Kanal'
  and :'p1'::jsonb #>> '{artwork,code}' = 'NFT-0037' and :'p2'::jsonb #>> '{artwork,code}' = 'NFT-0038'
  and :'p1'::jsonb #>> '{artwork,origin}' = 'player' and :'p1'::jsonb #>> '{artwork,creator}' = 'Anna_Pinsel'
  and :'p1'::jsonb #>> '{artwork,owner}' = 'Anna_Pinsel' and (:'p1'::jsonb #> '{artwork,rarity}') = 'null'::jsonb
  and (:'p1'::jsonb #> '{artwork,value_cents}') = 'null'::jsonb and (:'p1'::jsonb #> '{artwork,auction}') = 'null'::jsonb
  and (:'p1'::jsonb #>> '{artwork,likes}')::int = 0 and not (:'p1'::jsonb #>> '{artwork,liked}')::boolean
  and (:'p1'::jsonb #> '{artwork,pixels}') = tests.art()
  and (:'p1'::jsonb #> '{artwork}') ?& array['id', 'code', 'title', 'origin', 'rarity', 'creator', 'owner', 'pixels', 'value_cents',
                                             'likes', 'liked', 'created_at', 'hot', 'auction'],
  'ARTWORK: trimmed title, code NFT-0037 (after the gallery), origin player, creator = owner, no value, no auction');
select tests.login_as('authenticated', :c);
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', 'Kein Geld', tests.art()),
  'insufficient_funds', 'painting needs the cash (10.000 EUR start capital < 15.000 EUR)');
reset role;

-- =============================================================================
-- D. Likes
-- =============================================================================
select gen_random_uuid() as rq_like \gset
select tests.login_as('authenticated', :b);
select public.like_artwork(:'rq_like', :'art1', true) as lk1 \gset
select public.like_artwork(:'rq_like', :'art1', true) as lk1b \gset
select public.like_artwork(gen_random_uuid(), :'art1', true) as lk2 \gset
select public.get_artwork(:'art1') as g_liked \gset
select public.like_artwork(gen_random_uuid(), :'art1', false) as lk3 \gset
select public.like_artwork(gen_random_uuid(), :'art1', true) as lk4 \gset
select public.like_artwork(gen_random_uuid(), :'g2', true) as lk5 \gset
select tests.throws_key($$select public.like_artwork(gen_random_uuid(), gen_random_uuid(), true)$$, 'artwork_not_found', 'like: unknown artwork');
reset role;
select tests.login_as('authenticated', :a);
select tests.throws_key(format('select public.like_artwork(gen_random_uuid(), %L, true)', :'art1'), 'own_artwork', 'nobody likes their own artwork');
reset role;
select tests.login_as('authenticated', :c);
select public.like_artwork(gen_random_uuid(), :'art1', true) as lk6 \gset
reset role;
select tests.assert(
  :'lk1'::jsonb = '{"likes": 1, "liked": true}'::jsonb and :'lk1b'::jsonb = :'lk1'::jsonb
  and :'lk2'::jsonb = '{"likes": 1, "liked": true}'::jsonb
  and (:'g_liked'::jsonb #>> '{artwork,liked}')::boolean and (:'g_liked'::jsonb #>> '{artwork,likes}')::int = 1
  and :'lk3'::jsonb = '{"likes": 0, "liked": false}'::jsonb and :'lk4'::jsonb = '{"likes": 1, "liked": true}'::jsonb
  and (:'lk5'::jsonb ->> 'liked')::boolean and :'lk6'::jsonb = '{"likes": 2, "liked": true}'::jsonb,
  'like_artwork(): once per player (a second like changes nothing), can be taken back, gallery works can be liked');

-- =============================================================================
-- E. Auction of a player artwork: escrow, outbid refund, anti-snipe, fee, owner change
-- =============================================================================
select tests.login_as('authenticated', :a);
select tests.throws_key(format('select public.start_auction(gen_random_uuid(), %L, 100000, 2)', :'art1'), 'invalid_argument', 'duration must be 1, 6 or 24 hours');
select tests.throws_key(format('select public.start_auction(gen_random_uuid(), %L, 9999, 6)', :'art1'), 'invalid_argument', 'start price at least 100 EUR');
select tests.throws_key(format('select public.start_auction(gen_random_uuid(), %L, 100000, 6)', :'g3'),
  'forbidden', 'only the owner can auction an artwork');
select public.start_auction(gen_random_uuid(), :'art1', 100000, 6) as sa1 \gset
select tests.throws_key(format('select public.start_auction(gen_random_uuid(), %L, 100000, 6)', :'art1'), 'already_on_auction', 'one open auction per artwork');
reset role;
select (:'sa1'::jsonb #>> '{artwork,auction,id}')::uuid as au1 \gset
select tests.assert(
  (:'sa1'::jsonb #>> '{artwork,auction,start_cents}')::bigint = 100000
  and (:'sa1'::jsonb #> '{artwork,auction,current_cents}') = 'null'::jsonb
  and (:'sa1'::jsonb #>> '{artwork,auction,min_bid_cents}')::bigint = 100000
  and (:'sa1'::jsonb #>> '{artwork,auction,bids}')::int = 0
  and :'sa1'::jsonb #>> '{artwork,auction,seller}' = 'Anna_Pinsel'
  and (:'sa1'::jsonb #> '{artwork,auction,leader}') = 'null'::jsonb
  and abs(extract(epoch from ((:'sa1'::jsonb #>> '{artwork,auction,ends_at}')::timestamptz - public.game_now())) - 6 * 3600) < 60,
  'start_auction(): 6 hours, minimum bid = start price, seller shown');

select tests.escrow() as e0 \gset
select tests.cash(:b) as b0 \gset
select tests.cash(:c) as c0 \gset
select tests.cash(:a) as a1 \gset
select tests.households() as h0 \gset
select tests.login_as('authenticated', :b);
select tests.throws_key(format('select public.bid_artwork(gen_random_uuid(), %L, 99999)', :'au1'), 'bid_too_low', 'below the start price');
select public.bid_artwork(gen_random_uuid(), :'au1', 100000) as bid1 \gset
reset role;
select tests.cash(:b) as b1 \gset
select tests.escrow() as e1 \gset
select tests.login_as('authenticated', :a);
select tests.throws_key(format('select public.bid_artwork(gen_random_uuid(), %L, 200000)', :'au1'), 'own_artwork', 'the seller cannot bid');
select tests.throws_key(format('select public.cancel_auction(gen_random_uuid(), %L)', :'au1'), 'auction_has_bids', 'no cancelling after a bid');
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key(format('select public.bid_artwork(gen_random_uuid(), %L, 104999)', :'au1'), 'bid_too_low', 'a bid must beat the current one by 5 %');
select tests.throws_key(format('select public.bid_artwork(gen_random_uuid(), %L, 99000000)', :'au1'), 'insufficient_funds', 'bids need the cash');
select public.bid_artwork(gen_random_uuid(), :'au1', 105000) as bid2 \gset
select tests.throws_key($$select public.bid_artwork(gen_random_uuid(), gen_random_uuid(), 105000)$$, 'auction_not_found', 'unknown auction');
reset role;
select tests.assert(
  :b1 = :b0 - 100000 and :e1 = :e0 + 100000
  and (:'bid1'::jsonb #>> '{artwork,auction,my_bid_cents}')::bigint = 100000
  and :'bid1'::jsonb #>> '{artwork,auction,leader}' = 'Bruno_Bieter'
  and tests.cash(:b) = :b0 and tests.cash(:c) = :c0 - 105000 and tests.escrow() = :e0 + 105000
  and (:'bid2'::jsonb #>> '{artwork,auction,current_cents}')::bigint = 105000
  and (:'bid2'::jsonb #>> '{artwork,auction,min_bid_cents}')::bigint = 110300
  and (:'bid2'::jsonb #>> '{artwork,auction,bids}')::int = 2
  and (:'bid2'::jsonb #>> '{artwork,auction,my_bid_cents}')::bigint = 105000,
  'bid_artwork(): the bid moves into art_escrow; the outbid leader gets the money back at once; next minimum 110.250 -> 110.300 EUR-cents');

-- anti-snipe: a bid in the last 2 minutes extends the auction to 2 minutes from the bid
update public.artwork_auctions set ends_at = public.game_now() + interval '30 seconds' where id = :'au1';
select tests.login_as('authenticated', :b);
select public.bid_artwork(gen_random_uuid(), :'au1', 110300) as bid3 \gset
select public.get_artwork(:'art1') as g_bids \gset
reset role;
select tests.assert(
  (select ends_at from public.artwork_auctions where id = :'au1') between public.game_now() + interval '119 seconds' and public.game_now() + interval '121 seconds'
  and tests.cash(:c) = :c0 and tests.cash(:b) = :b0 - 110300 and tests.escrow() = :e0 + 110300,
  'anti-snipe: 30 s before the end a bid extends the auction to 2 minutes; the previous leader is refunded');
select tests.assert(
  (select array_agg(x ->> 'nickname' order by o) from jsonb_array_elements(:'g_bids'::jsonb -> 'bids') with ordinality a(x, o))
    = array['Bruno_Bieter', 'Carla_Kunst', 'Bruno_Bieter']
  and (select array_agg((x ->> 'amount_cents')::bigint order by o) from jsonb_array_elements(:'g_bids'::jsonb -> 'bids') with ordinality a(x, o))
    = array[110300, 105000, 100000]::bigint[]
  and jsonb_array_length(:'g_bids'::jsonb -> 'sales') = 0,
  'get_artwork(): bids of the running auction, newest first');

-- the end: price 1.103 EUR, 10 % fee to the households, the rest to the seller
select tests.end_auction(:'au1') as due1 \gset
select tests.login_as('authenticated', :b);
select tests.throws_key(format('select public.bid_artwork(gen_random_uuid(), %L, 200000)', :'au1'), 'auction_ended', 'no bids after the end');
select public.get_artwork(:'art1') as g_sold \gset
reset role;
select tests.assert(
  (:'due1'::jsonb ->> 'sold')::int >= 1
  and tests.cash(:a) = :a1 + 110300 - 11030 and tests.households() = :h0 + 11030 and tests.escrow() = :e0
  and (select owner_id from public.artworks where id = :'art1') = :b
  and (select value_cents from public.artworks where id = :'art1') = 110300
  and (select status from public.artwork_auctions where id = :'au1') = 'sold'
  and (select (seller_id, buyer_id, price_cents, fee_cents) from public.artwork_sales where auction_id = :'au1') = (:a::uuid, :b::uuid, 110300::bigint, 11030::bigint),
  'artworks_run_due(): the leader gets the artwork, value = price, the seller gets 90 %, the households 10 %, escrow is empty again');
select tests.assert(
  :'g_sold'::jsonb #>> '{artwork,owner}' = 'Bruno_Bieter' and :'g_sold'::jsonb #>> '{artwork,creator}' = 'Anna_Pinsel'
  and (:'g_sold'::jsonb #>> '{artwork,value_cents}')::bigint = 110300 and (:'g_sold'::jsonb #> '{artwork,auction}') = 'null'::jsonb
  and jsonb_array_length(:'g_sold'::jsonb -> 'sales') = 1
  and :'g_sold'::jsonb #>> '{sales,0,seller}' = 'Anna_Pinsel' and :'g_sold'::jsonb #>> '{sales,0,buyer}' = 'Bruno_Bieter'
  and (:'g_sold'::jsonb #>> '{sales,0,price_cents}')::bigint = 110300
  and jsonb_array_length(:'g_sold'::jsonb -> 'bids') = 3,
  'get_artwork(): new owner, sales history with seller and buyer, bids of the last auction');
select tests.assert(public.artworks_run_due() ->> 'sold' = '0', 'artworks_run_due() is idempotent');

-- =============================================================================
-- F. Unsold and cancelled auctions
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.start_auction(gen_random_uuid(), :'art1', 500000, 1) as sa2 \gset
reset role;
select (:'sa2'::jsonb #>> '{artwork,auction,id}')::uuid as au2 \gset
select tests.end_auction(:'au2') as due2 \gset
select tests.assert(
  (:'due2'::jsonb ->> 'unsold')::int >= 1
  and (select status from public.artwork_auctions where id = :'au2') = 'unsold'
  and (select owner_id from public.artworks where id = :'art1') = :b
  and (select value_cents from public.artworks where id = :'art1') = 110300,
  'without a bid the artwork stays with its owner, the value stays the last sale price');
select tests.login_as('authenticated', :b);
select public.start_auction(gen_random_uuid(), :'art1', 500000, 24) as sa3 \gset
select public.cancel_auction(gen_random_uuid(), (:'sa3'::jsonb #>> '{artwork,auction,id}')::uuid) as ca3 \gset
select tests.throws_key(format('select public.cancel_auction(gen_random_uuid(), %L)', :'sa3'::jsonb #>> '{artwork,auction,id}'),
  'auction_ended', 'a cancelled auction cannot be cancelled again');
select tests.throws_key($$select public.cancel_auction(gen_random_uuid(), gen_random_uuid())$$, 'auction_not_found', 'cancel: unknown auction');
select public.start_auction(gen_random_uuid(), :'art1', 500000, 24) as sa4 \gset
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key(format('select public.cancel_auction(gen_random_uuid(), %L)', :'sa4'::jsonb #>> '{artwork,auction,id}'),
  'forbidden', 'only the seller cancels');
reset role;
select tests.assert(
  (:'ca3'::jsonb #> '{artwork,auction}') = 'null'::jsonb
  and (select status from public.artwork_auctions where id = (:'sa3'::jsonb #>> '{artwork,auction,id}')::uuid) = 'cancelled',
  'cancel_auction(): an auction without bids can be cancelled by the seller');

-- =============================================================================
-- G. Gallery: auctionsPerDay per Berlin day, staggered, rarity start prices, 100 % to the households
-- =============================================================================
select ((public.game_now() at time zone 'Europe/Berlin')::date)::timestamp at time zone 'Europe/Berlin' as day0 \gset
select public.artworks_gallery_schedule() as gs1 \gset
select public.artworks_gallery_schedule() as gs2 \gset
select tests.assert(
  (select count(*) from public.artwork_auctions where by_gallery and created_at >= :'day0' and created_at < :'day0'::timestamptz + interval '1 day')
    = least(4, floor(extract(epoch from (public.game_now() - :'day0'::timestamptz)) / 21600)::int + 1)
  and :gs2 = 0
  and not exists (select 1 from public.artwork_auctions x join public.artworks a on a.id = x.artwork_id
                   where x.by_gallery and (x.seller_id is not null or a.owner_id is not null
                         or x.start_cents <> public.artwork_gallery_start_cents(a.rarity)
                         or abs(extract(epoch from (x.ends_at - x.created_at)) - 6 * 3600) > 1)),
  'gallery: one auction per 6-hour slot of the Berlin day so far (' || :gs1 || ' started now), 6 hours at the rarity start price; idempotent');
begin;
select public.artworks_gallery_schedule(:'day0'::timestamptz + interval '23 hours') as gs3 \gset
select tests.assert(
  (select count(*) from public.artwork_auctions where by_gallery and created_at >= :'day0' and created_at < :'day0'::timestamptz + interval '1 day') = 4
  and public.artworks_gallery_schedule(:'day0'::timestamptz + interval '23 hours 30 minutes') = 0
  and (select count(distinct artwork_id) from public.artwork_auctions where by_gallery and created_at >= :'day0') = 4
  and (select array_agg(start_cents order by start_cents) <@ array[500000, 2500000, 15000000]::bigint[]
         from public.artwork_auctions where by_gallery),
  'gallery: at most 4 per day (late slots are caught up), 4 different artworks, start prices 5.000 / 25.000 / 150.000 EUR');
rollback;

select x.id as gau, x.start_cents as gstart, x.artwork_id as gart
  from public.artwork_auctions x where x.by_gallery and x.status = 'open' order by x.start_cents, x.id limit 1 \gset
select tests.fund(:c, :gstart * 2, 'test:m4a:c-gallery');
select tests.households() as h1 \gset
select tests.cash(:c) as c1 \gset
select tests.login_as('authenticated', :c);
select public.bid_artwork(gen_random_uuid(), :'gau', :gstart) as gbid \gset
reset role;
select tests.end_auction(:'gau') as due3 \gset
select tests.login_as('authenticated', :c);
select public.get_artwork(:'gart') as g_gal \gset
reset role;
select tests.assert(
  (:'gbid'::jsonb #> '{artwork,auction,seller}') = 'null'::jsonb and (:'gbid'::jsonb #> '{artwork,owner}') = 'null'::jsonb
  and tests.cash(:c) = :c1 - :gstart and tests.households() = :h1 + :gstart
  and (select owner_id from public.artworks where id = :'gart') = :c
  and (:'g_gal'::jsonb #>> '{artwork,value_cents}')::bigint = :gstart
  and (:'g_gal'::jsonb #> '{sales,0,seller}') = 'null'::jsonb and :'g_gal'::jsonb #>> '{sales,0,buyer}' = 'Carla_Kunst',
  'gallery sale: the whole price goes to the households, the buyer owns the artwork, seller shown as gallery (null)');

-- =============================================================================
-- H. Net worth, rankings, collections, marketplace
-- =============================================================================
select tests.assert(
  public.player_art_value_cents(:b) = 110300
  and public.player_net_worth_cents(:b) = (select sum(balance_cents) from public.ledger_accounts where owner_player_id = :b) + 110300
  and (select net_worth_cents from public.rich_list_entries() where entity_id = :b) = public.player_net_worth_cents(:b)
  and (select net_worth_cents from public.rich_list_entries() where entity_id = :c) = public.player_net_worth_cents(:c)
  and public.player_art_value_cents(:a) = 0,
  'net worth (player_net_worth_cents, rich list) includes owned artworks at their last price; never sold = 0');

select tests.login_as('authenticated', :b);
select public.get_art_rankings(50) as rk \gset
select public.get_collection('bruno_bieter') as col_b \gset
select public.get_collection(null) as col_me \gset
select public.get_collection('Anna_Pinsel') as col_a \gset
select tests.throws_key($$select public.get_collection('Niemand_Hier')$$, 'player_not_found', 'get_collection: unknown player');
select public.get_artworks('hot', 'all', false, 100, 0) as m_hot \gset
select public.get_artworks('price', 'all', false, 100, 0) as m_price \gset
select public.get_artworks('new', 'player', false, 100, 0) as m_new \gset
select public.get_artworks('ending', 'all', true, 100, 0) as m_end \gset
select public.get_artworks('hot', 'game', false, 5, 5) as m_page \gset
select tests.throws_key($$select public.get_artworks('cheap', 'all', false, 10, 0)$$, 'invalid_argument', 'unknown sort');
select tests.throws_key($$select public.get_artworks('hot', 'aliens', false, 10, 0)$$, 'invalid_argument', 'unknown origin');
reset role;
select tests.assert(
  exists (select 1 from jsonb_array_elements(:'rk'::jsonb -> 'collections') x
           where x ->> 'nickname' = 'Bruno_Bieter' and (x ->> 'count')::int = 1 and (x ->> 'value_cents')::bigint = 110300
             and (x ->> 'is_me')::boolean and x ->> 'avatar_key' is not null)
  and exists (select 1 from jsonb_array_elements(:'rk'::jsonb -> 'collections') x
               where x ->> 'nickname' = 'Anna_Pinsel' and (x ->> 'count')::int = 1 and (x ->> 'value_cents')::bigint = 0
                 and not (x ->> 'is_me')::boolean)
  and (select bool_and((x ->> 'rank')::int = o) from jsonb_array_elements(:'rk'::jsonb -> 'collections') with ordinality a(x, o))
  and (select bool_and(coalesce((p ->> 'value_cents')::bigint >= (x ->> 'value_cents')::bigint, true))
         from jsonb_array_elements(:'rk'::jsonb -> 'collections') with ordinality a(x, o)
         left join lateral (select y from jsonb_array_elements(:'rk'::jsonb -> 'collections') with ordinality b(y, o2) where o2 = o - 1) pp(p) on true)
  and exists (select 1 from jsonb_array_elements(:'rk'::jsonb -> 'artworks') x
               where x #>> '{artwork,id}' = :'art1' and (x #>> '{artwork,value_cents}')::bigint = 110300)
  and not exists (select 1 from jsonb_array_elements(:'rk'::jsonb -> 'artworks') x where x #> '{artwork,value_cents}' = 'null'::jsonb),
  'get_art_rankings(): collections by value (with count, avatar, is_me), most valuable artworks (only sold ones)');
select tests.assert(
  :'col_b'::jsonb ->> 'nickname' = 'Bruno_Bieter' and (:'col_b'::jsonb ->> 'count')::int = 1
  and (:'col_b'::jsonb ->> 'value_cents')::bigint = 110300 and :'col_b'::jsonb #>> '{artworks,0,id}' = :'art1'
  and (:'col_me'::jsonb - 'artworks') = (:'col_b'::jsonb - 'artworks') and :'col_me'::jsonb #>> '{artworks,0,id}' = :'art1'
  and (:'col_a'::jsonb ->> 'count')::int = 1 and :'col_a'::jsonb #>> '{artworks,0,id}' = :'art2',
  'get_collection(): by nickname (any case) or null for the own collection, with count and value');
select tests.assert(
  (:'m_hot'::jsonb ->> 'total')::int = (select count(*) from public.artworks)
  and (select bool_and((x ->> 'hot')::double precision <= coalesce((p ->> 'hot')::double precision, 1e9))
         from jsonb_array_elements(:'m_hot'::jsonb -> 'entries') with ordinality a(x, o)
         left join lateral (select y from jsonb_array_elements(:'m_hot'::jsonb -> 'entries') with ordinality b(y, o2) where o2 = o - 1) pp(p) on true)
  and (select bool_and(coalesce((x #>> '{auction,current_cents}')::bigint, (x ->> 'value_cents')::bigint, (x #>> '{auction,start_cents}')::bigint, -1)
                       <= coalesce((p #>> '{auction,current_cents}')::bigint, (p ->> 'value_cents')::bigint, (p #>> '{auction,start_cents}')::bigint, 1e15::bigint))
         from jsonb_array_elements(:'m_price'::jsonb -> 'entries') with ordinality a(x, o)
         left join lateral (select y from jsonb_array_elements(:'m_price'::jsonb -> 'entries') with ordinality b(y, o2) where o2 = o - 1) pp(p) on true)
  and (select bool_and(x ->> 'origin' = 'player') from jsonb_array_elements(:'m_new'::jsonb -> 'entries') x)
  and :'m_new'::jsonb #>> '{entries,0,id}' = (select id::text from public.artworks where origin = 'player' order by created_at desc, serial desc limit 1)
  and (select bool_and(x -> 'auction' <> 'null'::jsonb) from jsonb_array_elements(:'m_end'::jsonb -> 'entries') x)
  and (:'m_end'::jsonb ->> 'total')::int = (select count(*) from public.artwork_auctions where status = 'open')
  and (select bool_and((x #>> '{auction,ends_at}')::timestamptz >= coalesce((p #>> '{auction,ends_at}')::timestamptz, '-infinity'))
         from jsonb_array_elements(:'m_end'::jsonb -> 'entries') with ordinality a(x, o)
         left join lateral (select y from jsonb_array_elements(:'m_end'::jsonb -> 'entries') with ordinality b(y, o2) where o2 = o - 1) pp(p) on true)
  and (:'m_page'::jsonb ->> 'total')::int = 36 and jsonb_array_length(:'m_page'::jsonb -> 'entries') = 5,
  'get_artworks(): hot, price, new and ending sort; origin and on-auction filters; total and paging');

-- =============================================================================
-- I. Missions from artworks
-- =============================================================================
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward) values
  (:b, 'd_art_bids', 'daily', date '1999-01-02', 2, 200),
  (:b, 'd_art_likes', 'daily', date '1999-01-02', 3, 200),
  (:c, 'w_art_win', 'weekly', date '1999-01-02', 1, 900),
  (:a, 'm_art_paint', 'milestone', date '1999-01-02', 1, 1000),
  (:b, 'w_art_auction', 'weekly', date '1999-01-02', 1, 600),
  (:b, 'm_art_collection', 'milestone', date '1999-01-02', 100000, 1500);
select tests.fund(:a, 6000000, 'test:m4a:a-third');
select tests.login_as('authenticated', :a);
select public.create_artwork(gen_random_uuid(), 'Dritter Versuch', tests.art(array['#101010', '#fafafa'])) as p3 \gset
reset role;
select (:'p3'::jsonb #>> '{artwork,id}')::uuid as art3 \gset
select tests.login_as('authenticated', :b);
select public.like_artwork(gen_random_uuid(), :'art3', true) is not null as ok \gset
select public.like_artwork(gen_random_uuid(), :'art3', false) is not null as ok \gset
select public.like_artwork(gen_random_uuid(), :'art3', true) is not null as ok \gset
select public.like_artwork(gen_random_uuid(), :'art2', true) is not null as ok \gset
select public.cancel_auction(gen_random_uuid(), (:'sa4'::jsonb #>> '{artwork,auction,id}')::uuid) is not null as ok \gset
select public.start_auction(gen_random_uuid(), :'art1', 100000, 1) as sa5 \gset
reset role;
select tests.login_as('authenticated', :c);
select public.bid_artwork(gen_random_uuid(), (:'sa5'::jsonb #>> '{artwork,auction,id}')::uuid, 100000) is not null as ok \gset
select public.start_auction(gen_random_uuid(), :'gart', 100000, 1) as sa6 \gset
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key(format('select public.bid_artwork(gen_random_uuid(), %L, 200000)', :'sa5'::jsonb #>> '{artwork,auction,id}'),
  'own_artwork', 'the owner cannot bid on their own auction');
select public.bid_artwork(gen_random_uuid(), (:'sa6'::jsonb #>> '{artwork,auction,id}')::uuid, 100000) is not null as ok \gset
reset role;
select tests.end_auction((:'sa5'::jsonb #>> '{artwork,auction,id}')::uuid) is not null as ok \gset
select public.mission_refresh_state(:b) is not null as ok \gset
select tests.assert(
  (select progress from public.player_missions where player_id = :b and template_key = 'd_art_bids' and period_start = date '1999-01-02') = 1
  and (select progress from public.player_missions where player_id = :b and template_key = 'd_art_likes' and period_start = date '1999-01-02') = 2
  and (select status from public.player_missions where player_id = :c and template_key = 'w_art_win' and period_start = date '1999-01-02') = 'completed'
  and (select status from public.player_missions where player_id = :a and template_key = 'm_art_paint' and period_start = date '1999-01-02') = 'completed'
  and (select status from public.player_missions where player_id = :b and template_key = 'w_art_auction' and period_start = date '1999-01-02') = 'completed'
  and (select progress from public.player_missions where player_id = :b and template_key = 'm_art_collection' and period_start = date '1999-01-02')
      = public.player_art_value_cents(:b),
  'missions: art_bid, art_like (distinct artworks, unlike + like counts once), art_won, art_painted, art_auction_started, art_collection_value');
select tests.assert(
  public.mission_text('Sammlung im Wert von {target}', 'art_collection_value', 10000000) = 'Sammlung im Wert von 100.000 €',
  'mission_text(): the collection value is shown in euros');

-- =============================================================================
-- J. Account reset releases everything; money invariant with art_escrow
-- =============================================================================
\set r '''07070707-0000-4000-8000-0000000000e5'''
select tests.signup(:r, 'Rudi_Reset') is not null as ok \gset
select tests.set_level(:r, 8);
select tests.fund(:r, 5000000, 'test:m4a:r');
select tests.login_as('authenticated', :a);
select (public.start_auction(gen_random_uuid(), :'art2', 50000, 24) #>> '{artwork,auction,id}')::uuid as rau \gset
reset role;
\set rstart 50000
select tests.login_as('authenticated', :r);
select public.create_artwork(gen_random_uuid(), 'Rudis Werk', tests.art(array['#202020', '#a0a0a0'])) as pr \gset
select public.start_auction(gen_random_uuid(), (:'pr'::jsonb #>> '{artwork,id}')::uuid, 20000, 24) as sar \gset
select public.bid_artwork(gen_random_uuid(), :'rau', :rstart) is not null as ok \gset
select public.like_artwork(gen_random_uuid(), :'art2', true) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select public.bid_artwork(gen_random_uuid(), (:'sar'::jsonb #>> '{artwork,auction,id}')::uuid, 20000) is not null as ok \gset
reset role;
select tests.cash(:c) as c_before_reset \gset
select tests.login_as('authenticated', :r);
select public.reset_account(gen_random_uuid(), 'Rudi_Reset') is not null as ok \gset
reset role;
select tests.assert(
  (select owner_id from public.artworks where id = (:'pr'::jsonb #>> '{artwork,id}')::uuid) is null
  and (select creator_id from public.artworks where id = (:'pr'::jsonb #>> '{artwork,id}')::uuid) = :r
  and (select status from public.artwork_auctions where id = (:'sar'::jsonb #>> '{artwork,auction,id}')::uuid) = 'cancelled'
  and tests.cash(:c) = :c_before_reset + 20000
  and (select (leader_id, current_cents) from public.artwork_auctions where id = :'rau') = (null::uuid, null::bigint)
  and not exists (select 1 from public.artwork_likes where player_id = :r)
  and not exists (select 1 from public.artwork_bids where bidder_id = :r and auction_id = :'rau')
  and coalesce((select sum(balance_cents) from public.ledger_accounts where owner_player_id = :r), 0) = 1000000,
  'reset_account(): own artworks back to the gallery, own auction cancelled (bidder refunded), leading bid released, likes gone');
select tests.assert(
  tests.escrow() = (select coalesce(sum(current_cents), 0) from public.artwork_auctions where status = 'open' and leader_id is not null)
  and tests.money_invariant() = 'ok',
  'art_escrow holds exactly the leading bids of the open auctions; money invariant holds (painting, bids, refunds, sales, fees, reset)');

-- =============================================================================
-- K. New mission metrics outside artworks (jobs, skills, company, profiles, streak)
-- =============================================================================
\set f '''07070707-0000-4000-8000-0000000000f6'''
\set w '''07070707-0000-4000-8000-0000000000a7'''
select tests.signup(:f, 'Fiona_Firma') is not null and tests.signup(:w, 'Willi_Werker') is not null as ok \gset
select tests.set_level(:f, 10);
select tests.set_level(:w, 4);
select tests.fund(:f, 2000000, 'test:m4a:f');
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward) values
  (:f, 'w_job_posting', 'weekly', date '1999-01-02', 1, 600),
  (:f, 'q_deposit', 'quick', date '1999-01-02', 1, 30),
  (:f, 'w_ai_workers', 'weekly', date '1999-01-02', 2, 700),
  (:f, 'd_view_profiles', 'daily', date '1999-01-02', 3, 200),
  (:w, 'd_work_hours', 'daily', date '1999-01-02', 3, 200),
  (:w, 'w_raise', 'weekly', date '1999-01-02', 1, 800),
  (:w, 'q_learn_skill', 'quick', date '1999-01-02', 1, 40),
  (:w, 'm_skills_5', 'milestone', date '1999-01-02', 5, 600),
  (:w, 'w_streak', 'weekly', date '1999-01-02', 5, 700);
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Kunst Kontor', 'Rahmen und Leinwände', 'retail', '#336699', 'garage') is not null as ok \gset
select public.company_deposit(gen_random_uuid(), 50000) is not null as ok \gset
select public.track_event('view_profile', 'willi_werker') is not null and public.track_event('view_profile', 'Willi_Werker') is not null
   and public.track_event('view_profile', 'Anna_Pinsel') is not null and public.track_event('view_profile', 'Fiona_Firma') is not null
   and public.track_event('view_profile', 'Gibt_Es_Nicht') is not null as ok \gset
reset role;
select tests.hire(:f, :w, 20000) as wjob \gset
update public.player_companies set ai_workers = ai_workers + 2 where founder_id = :f;
select tests.work_hours(:'wjob', 4) is not null as ok \gset
update public.player_jobs set salary_cents_per_hour = salary_cents_per_hour + 1000 where id = :'wjob';
insert into public.player_skills (player_id, skill_key) values (:w, 'm4a_test_skill');
update public.login_streaks set current_streak = 6, last_login_day = (public.game_now() at time zone 'Europe/Berlin')::date where player_id = :w;
select public.mission_refresh_state(:w) is not null as ok \gset
select tests.assert(
  (select status from public.player_missions where player_id = :f and template_key = 'w_job_posting' and period_start = date '1999-01-02') = 'completed'
  and (select status from public.player_missions where player_id = :f and template_key = 'q_deposit' and period_start = date '1999-01-02') = 'completed'
  and (select status from public.player_missions where player_id = :f and template_key = 'w_ai_workers' and period_start = date '1999-01-02') = 'completed'
  and (select progress from public.player_missions where player_id = :f and template_key = 'd_view_profiles' and period_start = date '1999-01-02') = 2
  and (select status from public.player_missions where player_id = :w and template_key = 'd_work_hours' and period_start = date '1999-01-02') = 'completed'
  and (select status from public.player_missions where player_id = :w and template_key = 'w_raise' and period_start = date '1999-01-02') = 'completed'
  and (select status from public.player_missions where player_id = :w and template_key = 'q_learn_skill' and period_start = date '1999-01-02') = 'completed'
  and (select progress from public.player_missions where player_id = :w and template_key = 'm_skills_5' and period_start = date '1999-01-02')
      = (select count(*) from public.player_skills where player_id = :w)
  and (select status from public.player_missions where player_id = :w and template_key = 'w_streak' and period_start = date '1999-01-02') = 'completed',
  'missions: job_posted, company_deposit, ai_worker_hired, view_profile (distinct others), work_hours, raise, skill_learned, skills_total, login_streak');

-- requirements: no job, company or skill point -> no such missions; artworks only from level 4
do $$
declare
  i integer;
  v uuid;
begin
  for i in 1..8 loop
    v := tests.signup(gen_random_uuid(), 'Missionar_' || i);
    perform tests.set_level(v, case when i <= 4 then 3 else 12 end);
    update public.player_skill_points set free_points = 0 where player_id = v;
    perform public.missions_assign(v);
  end loop;
end;
$$;
select tests.assert(
  not exists (select 1 from public.player_missions m join public.mission_templates t on t.key = m.template_key
               join public.profiles p on p.id = m.player_id
              where p.nickname like 'Missionar\_%'
                and (t.params ->> 'requires' in ('job', 'company', 'skill_point', 'artwork')
                     or (t.params ->> 'unlock' = 'artworks' and p.level < 4)))
  and (select count(*) from public.mission_templates where key in (
         'q_trades_3', 'q_sectors_2', 'q_view_profile', 'q_learn_skill', 'q_deposit', 'q_ai_worker', 'q_art_like', 'q_art_bid',
         'd_trades_10', 'd_buys', 'd_buy_pharma', 'd_buy_retail', 'd_buy_logistics', 'd_rich_list', 'd_view_profiles', 'd_work_hours',
         'd_profit_hours', 'd_art_likes', 'd_art_bids', 'w_sells', 'w_buy_value', 'w_profiles', 'w_streak', 'w_work_hours', 'w_raise',
         'w_skills', 'w_profit_hours', 'w_ai_workers', 'w_job_posting', 'w_art_bids', 'w_art_win', 'w_art_auction',
         'm_first_skill', 'm_first_hours', 'm_streak_7', 'm_first_raise', 'm_first_ai_worker', 'm_skills_5', 'm_first_posting',
         'm_art_first_like', 'm_art_first_bid', 'm_art_first_win', 'm_art_paint', 'm_work_100', 'm_profit_100', 'm_art_collection',
         'm_streak_30')) = 47,
  'missions_assign(): params.requires (job, company, skill point, own artwork) and the artworks unlock are respected; 47 new templates');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after all M4a flows');
