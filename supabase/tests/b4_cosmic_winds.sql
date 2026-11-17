-- =============================================================================
-- b4 · Nexamon Cosmic Winds and the One of One rarity (ADR-174)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0b4b4b4b-0000-4000-8000-0000000000a1'''
\set b '''0b4b4b4b-0000-4000-8000-0000000000b1'''
\set c '''0b4b4b4b-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Cw_Anna') is not null and tests.signup(:b, 'Cw_Bruno') is not null
   and tests.signup(:c, 'Cw_Clara') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.set_level(:c, 10);
select tests.fund(:a, 500000000, 'test:b4:a');
select tests.fund(:b, 500000000, 'test:b4:b');
insert into public.friendships (requester_id, addressee_id, status, responded_at)
values (:a, :b, 'accepted', now());
select value as nx_cfg from public.game_config where key = 'nexamon' \gset
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0, "cosmic_winds": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{battles,cooldownSeconds}', '0');
select public.nexamon_sync() is not null as ok \gset

create or replace function tests.cw_1of1(p_player uuid) returns bigint language sql security definer as $$
  select count(*) from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
   where k.rarity = 'one_of_one' and c.owner_id = p_player $$;
create or replace function tests.cw_taken() returns bigint language sql security definer as $$
  select count(*) from public.nexamon_one_of_ones $$;
create or replace function tests.cw_ai_open() returns jsonb language sql security definer as $$
  select public.nexamon_open_pack('cosmic_winds', null, 'Karten-Kalle', null, public.game_now()) $$;
create or replace function tests.cw_roll() returns text language sql security definer as $$
  select public.nexamon_roll_one_of_one('cosmic_winds', '0b4b4b4b-0000-4000-8000-0000000000a1'::uuid, 5) $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. The set: 90 cards, its own layout, the pack at 5.000 €
-- =============================================================================
select tests.assert(
  (select count(*) from public.nexamon_cards where set_key = 'cosmic_winds') = 90
  and (select count(*) from public.nexamon_cards where set_key = 'cosmic_winds' and rarity = 'common' and number between 1 and 50) = 50
  and (select count(*) from public.nexamon_cards where set_key = 'cosmic_winds' and rarity = 'rare' and number between 51 and 65) = 15
  and (select count(*) from public.nexamon_cards where set_key = 'cosmic_winds' and rarity = 'ultra' and number between 66 and 80) = 15
  and (select count(*) from public.nexamon_cards where set_key = 'cosmic_winds' and rarity = 'prisma' and number between 81 and 85) = 5
  and (select count(*) from public.nexamon_cards where set_key = 'cosmic_winds' and rarity = 'legendary' and number between 86 and 87) = 2
  and (select count(*) from public.nexamon_cards where set_key = 'cosmic_winds' and rarity = 'one_of_one' and number between 88 and 90) = 3
  and not exists (select 1 from public.nexamon_cards where rarity = 'one_of_one'
                   and (start_e4 < 1600000000::bigint * 100 or start_e4 > 3300000000::bigint * 100))
  and (select count(*) from public.nexamon_cards where set_key <> 'cosmic_winds') = 231,
  'Cosmic Winds: 90 cards 50/15/15/5/2/3 numbered by rarity, One of Ones at 16 to 33 million €; the old sets unchanged');
select tests.assert(
  not exists (select 1 from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key where k.rarity = 'one_of_one')
  and (select count(*) from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
        where k.set_key = 'cosmic_winds' and k.rarity = 'common') = 50 * 6,
  'the AI sellers get their starting stock of the new set, never a One of One');
select tests.login_as('authenticated', :a);
select public.get_nexamon() as ov \gset
reset role;
select tests.assert(
  (select (s ->> 'pack_price_cents')::bigint = 500000 and (s ->> 'cards')::integer = 90
     from jsonb_array_elements(:'ov'::jsonb -> 'sets') s where s ->> 'key' = 'cosmic_winds')
  and jsonb_array_length(:'ov'::jsonb -> 'one_of_ones') = 3
  and not exists (select 1 from jsonb_array_elements(:'ov'::jsonb -> 'one_of_ones') x
                   where (x ->> 'pulled')::boolean or x ->> 'pulled_by' is not null),
  'get_nexamon(): Cosmic Winds at 5.000 € with 90 cards; three One of Ones, none pulled');

-- =============================================================================
-- B. The AI never pulls a One of One, even at a sure roll
-- =============================================================================
select tests.set_cfg('nexamon', '{oneOfOne,packs}', '1');
select tests.cw_ai_open() as aip \gset
select tests.assert(
  not exists (select 1 from jsonb_array_elements(:'aip'::jsonb) x where x ->> 'rarity' = 'one_of_one') and tests.cw_taken() = 0,
  'an AI pack never rolls a One of One');

-- =============================================================================
-- C. Forced pulls: each One of One once, then the normal table
-- =============================================================================
select tests.cash(:a) as a0 \gset
select coalesce(sum(balance_cents), 0) as hh0 from public.ledger_accounts where system_key = 'households' \gset
select tests.login_as('authenticated', :a);
select public.buy_nexamon_pack(gen_random_uuid(), 'cosmic_winds') as p1 \gset
reset role;
select tests.assert(
  tests.cash(:a) = :a0 - 500000
  and (select sum(balance_cents) from public.ledger_accounts where system_key = 'households') = :hh0 + 500000,
  'a Cosmic Winds pack costs 5.000 €, paid to the households');
select :'p1'::jsonb #>> '{cards,4,card_key}' as k1 \gset
select tests.assert(
  :'p1'::jsonb #>> '{cards,4,rarity}' = 'one_of_one' and (:'p1'::jsonb #>> '{cards,4,serial}')::integer = 1
  and jsonb_array_length(:'p1'::jsonb -> 'cards') = 5
  and (select population from public.nexamon_cards where card_key = :'k1') = 1
  and (select player_id from public.nexamon_one_of_ones where card_key = :'k1') = :a::uuid
  and tests.cw_1of1(:a) = 1,
  'forced roll: slot 5 holds a One of One, serial 1 of 1, registered to the puller');
select tests.assert(
  (select count(*) from public.feed_items where actor_id = :a and kind = 'nexamon_one_of_one') = 1
  and (select count(*) from public.notifications where type_key = 'nexamon_one_of_one' and player_id in (:a, :b, :c)) = 3
  and public.feed_item_label('nexamon_one_of_one', '{"name": "X"}') like 'ONE OF ONE%',
  'a One of One pull: a feed item and a notification for every player');

select tests.login_as('authenticated', :b);
select public.buy_nexamon_pack(gen_random_uuid(), 'cosmic_winds') as p2 \gset
reset role;
select :'p2'::jsonb #>> '{cards,4,card_key}' as k2 \gset
select tests.assert(
  :'p2'::jsonb #>> '{cards,4,rarity}' = 'one_of_one' and :'k2' <> :'k1' and tests.cw_taken() = 2,
  'the second forced pull gets another One of One, never the taken one');

-- a second attempt at a taken card fails at the database: the registry and the population check
select tests.throws(format($$insert into public.nexamon_one_of_ones (card_key, copy_id) values (%L, gen_random_uuid())$$, :'k1'),
  '23505', 'the registry holds every One of One once');
select tests.throws(format($$select public.nexamon_mint_copy(%L, %L::uuid, null, 'mint', 'pack', null, now())$$, :'k1', :b),
  '23514', 'a One of One never gets a second copy');

-- =============================================================================
-- D. Pack Battle: the last One of One goes to the winner like any card
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.nexamon_lobby(true) is not null as ok \gset
select tests.login_as('authenticated', :a);
select public.nexamon_lobby(true) is not null as ok \gset
select (public.challenge_nexamon_battle(gen_random_uuid(), 'Cw_Bruno', 'cosmic_winds') #>> '{battle,id}')::uuid as bt \gset
reset role;
select tests.login_as('authenticated', :b);
select public.respond_nexamon_battle(gen_random_uuid(), :'bt', true) is not null as ok \gset
reset role;
select winner_id as win from public.nexamon_battles where id = :'bt' \gset
select tests.assert(
  tests.cw_taken() = 3
  and (select c.owner_id from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
        where k.rarity = 'one_of_one' and c.pack_id = :'bt') = :'win'::uuid
  and (select count(*) from public.nexamon_copies where pack_id = :'bt' and owner_id = :'win') = 10,
  'Pack Battle: one side pulls the last One of One, the winner takes it with all ten cards');

-- all three gone: the chance is 0, the slot rolls the normal table
select tests.assert(tests.cw_roll() is null, 'no One of One left: the roll gives none');
select tests.login_as('authenticated', :a);
select public.buy_nexamon_pack(gen_random_uuid(), 'cosmic_winds') as p4 \gset
select public.get_nexamon() as ov2 \gset
reset role;
select tests.assert(
  :'p4'::jsonb #>> '{cards,4,rarity}' <> 'one_of_one' and jsonb_array_length(:'p4'::jsonb -> 'cards') = 5 and tests.cw_taken() = 3
  and (select bool_and((x ->> 'pulled')::boolean and x ->> 'pulled_by' in ('Cw_Anna', 'Cw_Bruno'))
         from jsonb_array_elements(:'ov2'::jsonb -> 'one_of_ones') x),
  'fallback: the slot rolls the normal table; the overview names who pulled each One of One');
select tests.set_cfg('nexamon', '{oneOfOne,packs}', '5000');

-- =============================================================================
-- E. The AI never holds or buys a One of One; players trade it
-- =============================================================================
select c.id as c1 from public.nexamon_copies c where c.card_key = :'k1' \gset
select tests.throws_key(format($$update public.nexamon_copies set owner_id = null, ai_owner = 'Karten-Kalle' where id = %L$$, :'c1'),
  'nexamon_ai_excluded', 'the AI can never own a One of One (NX271)');
select tests.assert(
  public.nexamon_ai_buy_chance_bps(1, 100, 'mint', null, 'one_of_one', 1) = 0
  and public.nexamon_ai_buy_chance_bps(1, 100, 'mint', null, 'legendary', 1) = 10000
  and public.nexamon_pressure_bps('one_of_one', 1, 0, 5) = 0
  and public.nexamon_rarity_rank('one_of_one') > public.nexamon_rarity_rank('legendary'),
  'AI collectors never buy a One of One; its value has no supply-and-demand step; it ranks above a legendary');
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'c1', 100) as li \gset
reset role;
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '3000');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '300');
select public.nexamon_run_due() is not null as ok \gset
select tests.assert(
  (select owner_id from public.nexamon_copies where id = :'c1') = :a::uuid
  and exists (select 1 from public.nexamon_listings where copy_id = :'c1'),
  'a One of One listed far below its value stays on the market: the AI does not buy it');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.login_as('authenticated', :b);
select public.buy_nexamon_listing(gen_random_uuid(), (:'li'::jsonb #>> '{listing,id}')::uuid, 100) is not null as ok \gset
reset role;
select tests.assert((select owner_id from public.nexamon_copies where id = :'c1') = :b::uuid
  and (select population from public.nexamon_cards where card_key = :'k1') = 1,
  'players trade a One of One; its population stays 1');

-- =============================================================================
-- F. Collections leave the One of Ones out
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.get_nexamon_bonuses() as bo \gset
reset role;
select tests.assert(
  (select (x ->> 'need')::integer from jsonb_array_elements(:'bo'::jsonb -> 'collections') x
    where x ->> 'set' = 'cosmic_winds' and x ->> 'kind' = 'complete') = 87
  and (select (x ->> 'need')::integer from jsonb_array_elements(:'bo'::jsonb -> 'collections') x
        where x ->> 'set' = 'cosmic_winds' and x ->> 'kind' = 'master') = 87 + 7
  and (select (x ->> 'need')::integer from jsonb_array_elements(:'bo'::jsonb -> 'collections') x
        where x ->> 'set' = 'mystic_energy' and x ->> 'kind' = 'complete') = 77
  and not exists (select 1 from jsonb_array_elements(:'bo'::jsonb -> 'collections') x, jsonb_array_elements_text(x -> 'missing') m
                   where m in ('cw-088', 'cw-089', 'cw-090')),
  'Set komplett needs the 87 cards without the One of Ones, the master set also the 5 prismas and 2 legendaries as slabs');

-- =============================================================================
-- G. A set's own pack rule (kind "tiers", the shape Titans Revenge uses)
-- =============================================================================
select tests.set_cfg('nexamon', '{packRules}',
  '{"mystic_energy": {"kind": "tiers", "base": "common", "tiers": [{"rarity": "legendary", "packs": 1, "min": 2, "max": 2}, {"rarity": "rare", "packs": 1000000000, "min": 1, "max": 1}]}}');
select tests.login_as('authenticated', :a);
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy') as tp \gset
reset role;
select tests.assert(
  (select string_agg(x ->> 'rarity', ',' order by (x ->> 'slot')::integer) from jsonb_array_elements(:'tp'::jsonb -> 'cards') x)
    = 'common,common,common,legendary,legendary'
  and (select count(distinct x ->> 'card_key') from jsonb_array_elements(:'tp'::jsonb -> 'cards') x where x ->> 'rarity' = 'common') = 3,
  'tier rule: a sure tier fills the last slots, the base rarity the rest, never the same base card twice');

select tests.set_cfg('nexamon', '{packRules}', '{}');

-- =============================================================================
-- H. Several copies at once: list n, take n back
-- =============================================================================
create or replace function tests.cw_give(p_player uuid, p_card text, p_n integer) returns void
language plpgsql security definer as $$
begin
  for i in 1 .. p_n loop
    perform public.nexamon_mint_copy(p_card, p_player, null, 'mint', 'pack', null, public.game_now() + make_interval(secs => i));
  end loop;
end $$;
grant execute on function tests.cw_give(uuid, text, integer) to public;
select tests.cw_give(:c, 'me-005', 4);
select tests.cw_give(:c, 'me-006', 1);
\set rqb '''0b4b4b4b-0000-4000-8000-0000000000f1'''
select tests.login_as('authenticated', :c);
select tests.throws_key($$select public.list_nexamon_cards(gen_random_uuid(), 'me-005', 'mint', null, 5, 500)$$,
  'nexamon_not_enough', 'list_nexamon_cards(): not more copies than owned (NX272)');
select public.list_nexamon_cards(:rqb, 'me-005', 'mint', null, 3, 500) as bl \gset
select public.list_nexamon_cards(:rqb, 'me-005', 'mint', null, 3, 500) as bl2 \gset
reset role;
select tests.assert(
  :'bl'::jsonb = :'bl2'::jsonb and jsonb_array_length(:'bl'::jsonb -> 'listings') = 3
  and (select count(*) from public.nexamon_listings where seller_id = :c and card_key = 'me-005' and price_cents = 500) = 3
  -- the oldest three, the newest stays
  and not exists (select 1 from public.nexamon_listings l join public.nexamon_copies c on c.id = l.copy_id
                   where l.seller_id = :c and c.acquired_at = (select max(acquired_at) from public.nexamon_copies where owner_id = :c and card_key = 'me-005')),
  'list_nexamon_cards(): three copies at one price, oldest first, idempotent');
select tests.set_cfg('nexamon', '{market,maxListings}', '4');
select array_agg(id)::text as cls from public.nexamon_listings where seller_id = :c \gset
select tests.login_as('authenticated', :c);
select tests.throws_key($$select public.list_nexamon_cards(gen_random_uuid(), 'me-005', 'mint', null, 2, 500)$$,
  'nexamon_listing_limit', 'list_nexamon_cards(): the listing limit counts every copy');
select public.unlist_nexamon_cards(gen_random_uuid(), :'cls'::uuid[]) as ul \gset
reset role;
select tests.set_cfg('nexamon', '{market,maxListings}', '30');
select tests.assert(jsonb_array_length(:'ul'::jsonb -> 'copies') = 3
  and not exists (select 1 from public.nexamon_listings where seller_id = :c),
  'unlist_nexamon_cards(): all three back at once');

-- =============================================================================
-- I. The AI's offers reset every six hours; its stock is capped
-- =============================================================================
select count(public.nexamon_mint_copy('me-001', null, 'Karten-Kalle', 'mint', 'seed', null, now())) as ok
  from generate_series(1, 8) \gset
update public.nexamon_listings set price_cents = 1 where seller_ai is not null and card_key = 'me-002';
select public.nexamon_ai_reset() as rs \gset
select public.nexamon_ai_reset() as rs2 \gset
select tests.assert(
  (:'rs'::jsonb ->> 'deleted')::integer > 0 and :'rs2'::jsonb ->> 'skipped' = 'not due'
  and (select count(*) from public.nexamon_copies where card_key = 'me-001' and ai_owner is not null) = 12
  and not exists (select 1 from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
                   where c.ai_owner is not null
                   group by c.card_key, k.rarity
                  having count(*) > (:'nx_cfg'::jsonb #>> array['ai', 'stockCap', k.rarity])::integer)
  and (select count(*) from public.nexamon_listings where seller_ai is not null and card_key = 'me-001') = 4
  and not exists (select 1 from public.nexamon_listings where seller_ai is not null and price_cents = 1)
  and (select population from public.nexamon_cards where card_key = 'me-001') >= 14,
  'nexamon_ai_reset(): AI offers gone and listed anew at the value, stock capped per card, once per period; population still counts every copy');
update public.nexamon_meta set ai_reset_at = ai_reset_at - interval '7 hours';
select (public.nexamon_ai_reset() ->> 'deleted') is not null as ok \gset
select tests.assert(:'ok'::boolean, 'nexamon_ai_reset(): runs again after six hours');

-- =============================================================================
-- J. Bulk to the game: value minus 35 %
-- =============================================================================
select tests.cw_give(:c, 'me-007', 3);
select array_agg(id order by acquired_at) as bk from public.nexamon_copies where owner_id = :c and card_key = 'me-007' \gset
select sum(public.nexamon_copy_value_cents(k.value_e4, c.condition, null) * 6500 / 10000) as bkpay
  from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key where c.id = any (:'bk'::uuid[]) \gset
select tests.cash(:c) as cb0 \gset
\set rqk '''0b4b4b4b-0000-4000-8000-0000000000f2'''
select tests.login_as('authenticated', :c);
select public.bulk_sell_nexamon(:rqk, :'bk'::uuid[]) as bs \gset
select public.bulk_sell_nexamon(:rqk, :'bk'::uuid[]) as bs2 \gset
select tests.throws_key(format($$select public.bulk_sell_nexamon(gen_random_uuid(), array[%L]::uuid[])$$, :'c1'),
  'nexamon_not_owner', 'bulk_sell_nexamon(): only own copies');
reset role;
select tests.assert(:'bs'::jsonb = :'bs2'::jsonb and (:'bs'::jsonb ->> 'count')::integer = 3,
  'bulk_sell_nexamon(): three copies, idempotent ' || :'bs');
-- every sold copy dips the value a little (dropBps), so a later copy of the same card brings a cent less
select tests.assert((:'bs'::jsonb ->> 'total_cents')::bigint between :bkpay::bigint - 3 and :bkpay::bigint
  and tests.cash(:c) = :cb0::bigint + (:'bs'::jsonb ->> 'total_cents')::bigint
  and not exists (select 1 from public.nexamon_copies where owner_id = :c and card_key = 'me-007'),
  'bulk_sell_nexamon(): their value minus 35 %, paid at once ' || :bkpay || ' ' || (tests.cash(:c) - :cb0::bigint));

-- =============================================================================
-- K. A 10 is worth 2.5x to 4x, a 9.5 1.8x to 2.6x, by popularity; the ladder stays in order
-- =============================================================================
select tests.assert(
  public.nexamon_grade_factor_bps(10, 'me-001') between 25000 and 40000
  and public.nexamon_grade_factor_bps(10, 'cw-088') = 40000
  and public.nexamon_grade_factor_bps(10, 'me-001') < public.nexamon_grade_factor_bps(10, 'pp-077')
  and public.nexamon_grade_factor_bps(9.5, 'me-001') between 18000 and 26000
  and public.nexamon_grade_factor_bps(9, 'me-001') = 17000
  and public.nexamon_grade_factor_bps(10, null) = 40000
  and not exists (select 1 from public.nexamon_cards k
                   where not (public.nexamon_grade_factor_bps(8, k.card_key) < public.nexamon_grade_factor_bps(8.5, k.card_key)
                          and public.nexamon_grade_factor_bps(8.5, k.card_key) < public.nexamon_grade_factor_bps(9, k.card_key)
                          and public.nexamon_grade_factor_bps(9, k.card_key) < public.nexamon_grade_factor_bps(9.5, k.card_key)
                          and public.nexamon_grade_factor_bps(9.5, k.card_key) < public.nexamon_grade_factor_bps(10, k.card_key)))
  and public.nexamon_copy_value_cents(1000000, 'mint', 10, 'me-001')
      = public.div_round_half_even(1000000::numeric * public.nexamon_grade_factor_bps(10, 'me-001'), 1000000),
  'grade 10 and 9.5 by popularity (2.5x-4x, 1.8x-2.6x), the ladder 8 < 8.5 < 9 < 9.5 < 10 for every card');

update public.game_config set value = :'nx_cfg'::jsonb where key = 'nexamon';
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after Cosmic Winds');
