-- =============================================================================
-- a9b · NFT collectors are busy all day, not once a day (ADR-170)
-- =============================================================================
-- Six game hours of the minute job nfts_run_due(): a player NFT listed at its value is bought within minutes, a too
-- expensive one and a kept one get offers again and again, a player auction gets bids, and the collectors trade
-- among themselves every hour. The households pay at most the collectors' valuation and at most their daily budget.
\set QUIET 1
set client_min_messages = notice;

\set c '''0a9b0a9b-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:c, 'Clara_Sammler9') is not null as ok \gset
select tests.set_level(:c, 12);
select tests.fund(:c, 500000000, 'test:a9b:c');

-- per simulated hour: what nfts_run_due() reported
create table if not exists tests.nft_hours (hour integer primary key, sold integer, offers integer, traded integer,
                                           bids integer, answered integer);
grant all on tests.nft_hours to public;
create or replace function tests.nft_simulate(p_hours integer) returns void language plpgsql as $$
declare
  v_base interval := coalesce((select r.time_offset from public.sim_runtime r), interval '0');
  r      jsonb;
  i      integer;
begin
  delete from tests.nft_hours;
  for i in 0 .. p_hours * 60 - 1 loop
    update public.sim_runtime set time_offset = v_base + make_interval(mins => i);
    r := public.nfts_run_due();
    insert into tests.nft_hours as h values (i / 60, coalesce((r ->> 'sold')::int, 0), coalesce((r ->> 'offers')::int, 0),
                                             coalesce((r ->> 'traded')::int, 0), coalesce((r ->> 'bids')::int, 0),
                                             coalesce((r ->> 'answered')::int, 0))
    on conflict (hour) do update set sold = h.sold + excluded.sold, offers = h.offers + excluded.offers,
                                     traded = h.traded + excluded.traded, bids = h.bids + excluded.bids,
                                     answered = h.answered + excluded.answered;
  end loop;
  update public.sim_runtime set time_offset = v_base;
end;
$$;
grant execute on all functions in schema tests to public;

begin;
-- the game's collector settings (earlier files turn some of them off)
select tests.set_cfg('nfts', '{ai,auction,bidChanceBps}', '1000');
-- four NFTs of a player
select tests.login_as('authenticated', :c);
select public.create_artwork(gen_random_uuid(), 'Fairer Preis', tests.nft_art('1')) #>> '{artwork,id}' as n1 \gset
select public.create_artwork(gen_random_uuid(), 'Zu teuer', tests.nft_art('2')) #>> '{artwork,id}' as n2 \gset
select public.create_artwork(gen_random_uuid(), 'Behalten', tests.nft_art('1')) #>> '{artwork,id}' as n3 \gset
select public.create_artwork(gen_random_uuid(), 'Versteigert', tests.nft_art('2')) #>> '{artwork,id}' as n4 \gset
reset role;
select public.nft_ai_value_cents(:'n1') as v1, public.nft_ai_value_cents(:'n2') as v2,
       public.nft_ai_value_cents(:'n4') as v4 \gset
select tests.login_as('authenticated', :c);
select public.set_artwork_price(gen_random_uuid(), :'n1', :v1::bigint) is not null as ok \gset
select public.set_artwork_price(gen_random_uuid(), :'n2', (:v2::bigint * 3 / 2)) is not null as ok \gset
select public.start_auction(gen_random_uuid(), :'n4', (:v4::bigint / 2), 24) is not null as ok \gset
reset role;
-- a dozen NFTs held by collectors (the gallery's unsold ones), so the collectors can trade
with g as (select a.id, row_number() over (order by a.id) as n from public.artworks a
            where a.owner_id is null and a.ai_owner is null
              and not exists (select 1 from public.artwork_auctions au where au.artwork_id = a.id and au.status = 'open')
            order by a.id limit 12)
update public.artworks a
   set ai_owner = (public.nfts_cfg() #>> array['ai', 'collectors', ((g.n % 8))::text]),
       value_cents = coalesce(a.value_cents, 200000), ask_cents = 250000, listed_at = public.game_now() - interval '1 hour'
  from g where a.id = g.id;
select tests.nft_house() as house0, tests.cash(:c) as cash0 \gset

select tests.nft_simulate(6);
select string_agg(format('h%s: %s sold, %s offers, %s trades, %s bids', hour, sold, offers, traded, bids), ' | ' order by hour)
       as hours from tests.nft_hours \gset
\echo :hours

select min(s.at) - (select min(created_at) from public.artworks where id = :'n1') as first_buy
  from public.artwork_sales s where s.artwork_id = :'n1' and s.buyer_ai is not null \gset
select tests.assert(exists (select 1 from public.artwork_sales s where s.artwork_id = :'n1' and s.buyer_ai is not null
                             and s.price_cents <= :v1::bigint),
  'a player NFT listed at its value is bought by a collector, at most at the value (after ' || coalesce(:'first_buy', '-') || ')');
select tests.assert((select count(*) from tests.nft_hours where traded > 0) = 6
                    and (select sum(traded) from tests.nft_hours) >= 12,
  'collectors trade among themselves every hour: ' || :'hours');
select tests.assert((select count(*) from public.artwork_messages m where m.artwork_id in (:'n2', :'n3')
                       and m.ai_name is not null and m.kind = 'offer') >= 6
                    and (select count(*) from tests.nft_hours where offers > 0) >= 5,
  'too expensive and kept NFTs get collector offers again and again ('
  || (select count(*) from public.artwork_messages m where m.artwork_id in (:'n2', :'n3') and m.ai_name is not null and m.kind = 'offer')
  || ' offers in six hours)');
select tests.assert((select bids from public.artwork_auctions where artwork_id = :'n4' and status = 'open') >= 1
                    and (select current_cents from public.artwork_auctions where artwork_id = :'n4' and status = 'open')
                        <= public.nft_ai_value_cents(:'n4'),
  'a player auction gets collector bids, never above the collectors'' valuation');
select tests.assert(
  (select coalesce(sum(s.price_cents), 0) from public.artwork_sales s where s.buyer_ai is not null and s.seller_id = :c)
    <= public.config_double('nfts', '{ai,budgetCentsPerDay}', 0)
  and public.nft_ai_spent_today(public.game_now()) <= public.config_double('nfts', '{ai,budgetCentsPerDay}', 0),
  'what the collectors pay players stays within their daily budget ('
  || (public.nft_ai_spent_today(public.game_now()) / 100) || ' EUR today)');
-- the auction ends: the leading collector gets the NFT, the player the price minus fee
select current_cents as won, leader_ai as winner, id as auc from public.artwork_auctions
 where artwork_id = :'n4' and status = 'open' \gset
select tests.cash(:c) as before_settle \gset
update public.artwork_auctions set ends_at = public.game_now() - interval '1 second' where id = :'auc';
select public.artwork_settle_auction(:'auc') as settled \gset
select tests.assert(:'settled' = 'sold' and (select ai_owner from public.artworks where id = :'n4') = :'winner'
                    and tests.cash(:c) = :before_settle::bigint + :won::bigint
                        - floor(:won::bigint * public.config_double('artworks', '{auction,feeBps}', 1000) / 10000)::bigint,
  'a collector wins the player auction (' || :'winner' || ', ' || (:won::bigint / 100) || ' EUR); the player is paid');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant: ' || tests.money_invariant());
rollback;
