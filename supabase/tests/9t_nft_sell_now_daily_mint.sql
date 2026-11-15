-- =============================================================================
-- 9t · NFT owners sell to the highest bid at once; the mint price starts again every day
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set o '''09f39f39-0000-4000-8000-0000000000a1'''
\set b '''09f39f39-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:o, 'Sofort_Olga') is not null and tests.signup(:b, 'Sofort_Bodo') is not null as ok \gset
select tests.set_level(:o, 10);
select tests.set_level(:b, 10);
select tests.fund(:b, 5000000, 'test:9t:b');

-- two gallery works for the owner: one minted today, one yesterday
select id as w1 from public.artworks a where a.owner_id is null and a.ai_owner is null
   and not exists (select 1 from public.artwork_auctions x where x.artwork_id = a.id and x.status = 'open') order by serial limit 1 \gset
select id as w2 from public.artworks a where a.owner_id is null and a.ai_owner is null and a.id <> :'w1'
   and not exists (select 1 from public.artwork_auctions x where x.artwork_id = a.id and x.status = 'open') order by serial limit 1 \gset
update public.artworks set owner_id = :o, creator_id = :o, created_at = now() where id = :'w1';
update public.artworks set owner_id = :o, creator_id = :o, created_at = now() - interval '2 days' where id = :'w2';
select tests.login_as('authenticated', :o);
select public.get_art_studio() as st \gset
reset role;
select tests.assert(
  public.player_artworks_minted_today(:o) = 1
  and (:'st'::jsonb ->> 'next_cost_cents')::bigint = public.player_artwork_create_cost_cents(:o, 1)
  and public.player_artwork_create_cost_cents(:o, 1) < public.player_artwork_create_cost_cents(:o, 2),
  'the mint price counts only the NFTs minted today: yesterday''s do not make it dearer');
update public.artworks set created_at = now() - interval '2 days' where id = :'w1';
select tests.login_as('authenticated', :o);
select public.get_art_studio() as st2 \gset
reset role;
select tests.assert(
  (:'st2'::jsonb ->> 'next_cost_cents')::bigint = public.player_artwork_create_cost_cents(:o, 0)
  and public.artwork_create_cost_cents(0) = 1500000,
  'a new day: the next NFT costs the base price (15.000 €) again');

-- sell now: an auction with a bid ends at once and the highest bid buys
select tests.login_as('authenticated', :o);
select (public.start_auction(gen_random_uuid(), :'w1', 50000, 24) #>> '{artwork,auction,id}')::uuid as au \gset
select tests.throws_key(format('select public.accept_auction(gen_random_uuid(), %L)', :'au'), 'invalid_argument',
  'accept_auction(): not without a bid');
reset role;
select tests.login_as('authenticated', :b);
select public.bid_artwork(gen_random_uuid(), :'au', 80000) is not null as ok \gset
select tests.throws_key(format('select public.accept_auction(gen_random_uuid(), %L)', :'au'), 'forbidden',
  'accept_auction(): only the seller');
reset role;
select tests.cash(:o) as o0, tests.cash(:b) as b0 \gset
select tests.login_as('authenticated', :o);
select public.accept_auction(gen_random_uuid(), :'au') as acc \gset
select tests.throws_key(format('select public.accept_auction(gen_random_uuid(), %L)', :'au'), 'auction_ended',
  'accept_auction(): only once');
reset role;
select tests.assert(
  (:'acc'::jsonb ->> 'price_cents')::bigint = 80000
  and (select status = 'sold' from public.artwork_auctions where id = :'au')
  and (select owner_id = :b from public.artworks where id = :'w1')
  and tests.cash(:o) > :o0::bigint and tests.cash(:b) = :b0::bigint,
  'accept_auction(): sold at once to the highest bid, the seller is paid, the bid came from the escrow');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds');
