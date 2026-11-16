-- =============================================================================
-- 9z · Nexamon: collectible cards with booster packs, grading and a card market (ADR-165)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0e7a3000-0000-4000-8000-0000000000a1'''
\set b '''0e7a3000-0000-4000-8000-0000000000b1'''
\set c '''0e7a3000-0000-4000-8000-0000000000c1'''
\set d '''0e7a3000-0000-4000-8000-0000000000d1'''
\set rq '''0e7a3000-0000-4000-8000-0000000000e1'''
\set rl '''0e7a3000-0000-4000-8000-0000000000e2'''
\set rb '''0e7a3000-0000-4000-8000-0000000000e3'''
\set rg '''0e7a3000-0000-4000-8000-0000000000e4'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:a, 'Nx_Anna') is not null and tests.signup(:b, 'Nx_Bruno') is not null
   and tests.signup(:c, 'Nx_Clara') is not null and tests.signup(:d, 'Nx_Dora') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.set_level(:c, 10);
select tests.set_level(:d, 9);
select tests.fund(:a, 2000000000, 'test:9z:a');
select tests.fund(:b, 2000000000, 'test:9z:b');
select tests.fund(:c, 5000000, 'test:9z:c');

create or replace function tests.nx(p_key text) returns public.nexamon_cards language sql security definer as $$
  select * from public.nexamon_cards where card_key = p_key $$;
create or replace function tests.nx_give(p_player uuid, p_card text, p_condition text default 'mint') returns uuid language sql security definer as $$
  select public.nexamon_mint_copy(p_card, p_player, null, p_condition, 'pack', null, public.game_now()) $$;
create or replace function tests.nx_value(p_card text, p_condition text default 'mint', p_grade integer default null)
returns bigint language sql security definer as $$
  select public.nexamon_copy_value_cents((tests.nx(p_card)).value_e4, p_condition, p_grade) $$;
create or replace function tests.nx_ask(p_card text, p_condition text default 'mint') returns bigint language sql security definer as $$
  select public.nexamon_ai_ask_cents(tests.nx_value(p_card, p_condition)) $$;
create or replace function tests.nx_copy(p_copy uuid) returns public.nexamon_copies language sql security definer as $$
  select * from public.nexamon_copies where id = p_copy $$;
create or replace function tests.nx_listing(p_copy uuid) returns uuid language sql security definer as $$
  select id from public.nexamon_listings where copy_id = p_copy $$;
create or replace function tests.nx_pop() returns bigint language sql security definer as $$
  select sum(population)::bigint from public.nexamon_cards $$;
create or replace function tests.nx_notes(p_player uuid, p_type text) returns bigint language sql security definer as $$
  select count(*) from public.notifications where player_id = p_player and type_key = p_type $$;
-- the caller buys the cheapest AI listing of a card at its current price
create or replace function tests.nx_buy_ai(p_card text) returns jsonb language sql security definer as $$
  select public.buy_nexamon_listing(gen_random_uuid(), l.id, l.price_cents)
    from public.nexamon_listings l where l.card_key = p_card and l.seller_ai is not null order by l.price_cents, l.id limit 1 $$;
-- the caller lists all own copies of a card at their value
create or replace function tests.nx_list_all(p_card text) returns bigint language sql security definer as $$
  select count(public.list_nexamon_card(gen_random_uuid(), c.id, tests.nx_value(p_card, c.condition)))
    from public.nexamon_copies c where c.card_key = p_card and c.owner_id = (select auth.uid()) $$;
grant execute on all functions in schema tests to public;

-- the rules as seeded; the AI stays quiet unless a section wakes it
select value as nx_cfg from public.game_config where key = 'nexamon' \gset
select value as nx_cat from public.game_config where key = 'nexamon_cards' \gset
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,legendaryListChanceBps}', '0');
select tests.set_cfg('nexamon', '{value,pressure,perRun}', '0');
select tests.set_cfg('nexamon', '{packs,perMinute}', '1000');

-- =============================================================================
-- A. Rules (port of src/lib/sim/nexamon.ts)
-- =============================================================================
select tests.assert(
  public.nexamon_slot_rarity(1, 0) = 'common' and public.nexamon_slot_rarity(3, 0) = 'common'
  and public.nexamon_slot_rarity(4, 0) = 'ultra' and public.nexamon_slot_rarity(4, 149.5 / 3600) = 'ultra'
  and public.nexamon_slot_rarity(4, 150.5 / 3600) = 'rare' and public.nexamon_slot_rarity(4, 1049.5 / 3600) = 'rare'
  and public.nexamon_slot_rarity(4, 1050.5 / 3600) = 'common'
  and public.nexamon_slot_rarity(5, 0) = 'legendary' and public.nexamon_slot_rarity(5, 3.5 / 3600) = 'legendary'
  and public.nexamon_slot_rarity(5, 4.5 / 3600) = 'prisma' and public.nexamon_slot_rarity(5, 48.5 / 3600) = 'prisma'
  and public.nexamon_slot_rarity(5, 49.5 / 3600) = 'ultra' and public.nexamon_slot_rarity(5, 198.5 / 3600) = 'ultra'
  and public.nexamon_slot_rarity(5, 199.5 / 3600) = 'rare' and public.nexamon_slot_rarity(5, 1098.5 / 3600) = 'rare'
  and public.nexamon_slot_rarity(5, 1099.5 / 3600) = 'common' and public.nexamon_slot_rarity(5, 0.9999999) = 'common',
  'nexamon_slot_rarity(): slots 1-3 common, slot 4 ultra/rare/common, slot 5 legendary/prisma/ultra/rare/common');
select tests.assert(
  (select jsonb_object_agg(x.r, x.n) from (select public.nexamon_slot_rarity(5, (g + 0.5) / 3600) as r, count(*) as n
                                             from generate_series(0, 3599) g group by 1) x)
    = '{"legendary": 4, "prisma": 45, "ultra": 150, "rare": 900, "common": 2501}'::jsonb
  and (select jsonb_object_agg(x.r, x.n) from (select public.nexamon_slot_rarity(4, (g + 0.5) / 3600) as r, count(*) as n
                                                 from generate_series(0, 3599) g group by 1) x)
    = '{"ultra": 150, "rare": 900, "common": 2550}'::jsonb,
  'exact odds over the 3600 rolls: per pack 1/2 rare, 1/12 ultra, 1/80 prisma, 1/900 legendary');
select tests.assert(
  public.nexamon_roll_condition(0) = 'poor' and public.nexamon_roll_condition(0.0199) = 'poor'
  and public.nexamon_roll_condition(0.02) = 'good' and public.nexamon_roll_condition(0.1999) = 'good'
  and public.nexamon_roll_condition(0.2) = 'near_mint' and public.nexamon_roll_condition(0.7) = 'mint'
  and public.nexamon_roll_condition(0.999999) = 'mint'
  and public.nexamon_roll_grade('mint', 0) = 8 and public.nexamon_roll_grade('mint', 0.02) = 9
  and public.nexamon_roll_grade('mint', 0.1) = 10 and public.nexamon_roll_grade('near_mint', 0.3999) = 9
  and public.nexamon_roll_grade('near_mint', 0.4) = 10 and public.nexamon_roll_grade('good', 0) = 4
  and public.nexamon_roll_grade('good', 0.8999) = 9 and public.nexamon_roll_grade('good', 0.9) = 10
  and public.nexamon_roll_grade('poor', 0) = 1 and public.nexamon_roll_grade('poor', 0.9989) = 9
  and public.nexamon_roll_grade('poor', 0.999) = 10,
  'conditions poor 2 % / good 18 % / near mint 50 % / mint 30 %; a 10: good 10 %, near mint 60 %, mint 90 %, poor 0.1 %');
select tests.assert(
  public.nexamon_copy_factor_bps('mint', null) = 10000 and public.nexamon_copy_factor_bps('near_mint', null) = 10000
  and public.nexamon_copy_factor_bps('good', null) = 10000 and public.nexamon_copy_factor_bps('poor', null) = 9500
  and public.nexamon_copy_factor_bps('poor', 10) = 30000 and public.nexamon_copy_factor_bps('mint', 9) = 16000
  and public.nexamon_copy_factor_bps('good', 8) = 12000 and public.nexamon_copy_factor_bps('mint', 7) = 9000
  and public.nexamon_copy_factor_bps('mint', 1) = 3000
  and public.nexamon_copy_value_cents(1234500, 'mint', null) = 12345
  and public.nexamon_copy_value_cents(1234500, 'poor', null) = 11728
  and public.nexamon_copy_value_cents(1000, 'poor', null) = 10 and public.nexamon_copy_value_cents(3000, 'poor', null) = 28
  and public.nexamon_copy_value_cents(10000000, 'poor', 10) = 300000
  and public.nexamon_ai_ask_cents(10000) = 11000,
  'a copy is worth the value from good upwards, 5 % less below; slabs 8 to 10 more than raw; the AI asks 10 % more');
select tests.assert(
  public.nexamon_popularity_bps('legendary', 1) = 10000
  and public.nexamon_popularity_bps('common', 6) = 500 + floor(3000 * 2000.0 / 2006)
  and public.nexamon_popularity_bps('prisma', 2) > public.nexamon_popularity_bps('prisma', 200)
  and public.nexamon_demand_milli('common', 6, 0) = 4000 and public.nexamon_demand_milli('rare', 4, 0) = 3000
  and public.nexamon_demand_milli('ultra', 2, 0) = 2000 and public.nexamon_demand_milli('prisma', 1, 0) = 1000
  and public.nexamon_pressure_bps('common', 6, 4, 0) = 0 and public.nexamon_pressure_bps('prisma', 1, 1, 0) = 0
  and public.nexamon_pressure_bps('prisma', 12, 0, 2) = 10000 and public.nexamon_pressure_bps('prisma', 12, 6, 0) = -10000
  and public.nexamon_pressure_bps('legendary', 0, 0, 0) = 0 and public.nexamon_pressure_bps('legendary', 1, 0, 0) = 8000
  and public.nexamon_pressure_bps('legendary', 10, 0, 0) < 4000 and public.nexamon_pressure_bps('legendary', 10, 1, 0) < 0,
  'popularity, demand and pressure: the start is in balance, hoarding a rare card pushes up, dumping down');

-- =============================================================================
-- B. The catalogue comes from game_config; the AI sellers get their starting stock
-- =============================================================================
select public.nexamon_sync() as synced \gset
select public.nexamon_sync() as synced2 \gset
select tests.assert(
  :synced = 231 and :synced2 = 0
  and (select count(*) from public.nexamon_cards) = 231
  and (select count(*) from public.nexamon_cards where set_key = 'super_apex' and rarity = 'common') = 50
  and (select count(*) from public.nexamon_cards where rarity = 'legendary') = 6
  and not exists (select 1 from public.nexamon_cards where value_e4 <> start_e4 or moved_at is not null)
  and not exists (select 1 from public.nexamon_cards k, jsonb_array_elements(public.nexamon_catalogue()) x
                   where x ->> 'key' = k.card_key and (x ->> 'startPriceCents')::bigint * 100 <> k.start_e4)
  and (select count(*) from public.nexamon_set_state) = 3,
  'nexamon_sync(): 231 cards with the catalogue''s start prices, idempotent');
select tests.assert(
  (select count(*) from public.nexamon_copies) = 3 * (50 * 6 + 10 * 4 + 10 * 2 + 2)
  and not exists (select 1 from public.nexamon_copies where owner_id is not null or source <> 'seed')
  and not exists (select 1 from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key where k.rarity = 'legendary')
  and (select count(*) from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key where k.rarity = 'prisma') = 6
  -- only the two cheapest prismas of every set
  and not exists (select 1 from public.nexamon_cards k
                   where k.rarity = 'prisma'
                     and (k.population > 0) <> ((select count(*) from public.nexamon_cards o
                                                  where o.set_key = k.set_key and o.rarity = 'prisma'
                                                    and (o.start_e4, o.number) < (k.start_e4, k.number)) < 2))
  and not exists (select 1 from public.nexamon_cards k
                   where k.population <> (select count(*) from public.nexamon_copies c where c.card_key = k.card_key)
                      or (k.population > 0) <> (k.first_pulled_at is not null))
  and not exists (select 1 from public.nexamon_copies c group by c.card_key having max(c.serial) <> count(*)),
  'the AI starts with 6 commons, 4 rares, 2 ultras per card, the two cheapest prismas of a set once and no legendary; '
  'the population counts them');
select tests.assert(
  (select count(*) from public.nexamon_listings) = 3 * (50 * 4 + 10 * 3 + 10 * 2 + 2)
  and not exists (select 1 from public.nexamon_listings where seller_ai is null)
  and not exists (select 1 from public.nexamon_listings l join public.nexamon_cards k on k.card_key = l.card_key
                   where k.rarity = 'legendary')
  and not exists (select 1 from public.nexamon_listings l
                    join public.nexamon_copies c on c.id = l.copy_id join public.nexamon_cards k on k.card_key = l.card_key
                   where l.price_cents <> public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(k.value_e4, c.condition, null))
                      or (c.condition <> 'poor' and l.price_cents <> greatest(10, public.div_round_half_even(k.start_e4 * 11, 1000)))),
  'the AI offers 4 / 3 / 2 / 1 / 0 copies per card at the start price + 10 %, no legendary');

-- a changed catalogue: start prices follow, values only while the card never moved; nothing is seeded twice
update public.nexamon_cards set moved_at = now(), value_e4 = 90000 where card_key = 'me-002';
update public.game_config
   set value = (select jsonb_agg(case when x ->> 'key' in ('me-001', 'me-002') then jsonb_set(x, '{startPriceCents}', '777') else x end)
                  from jsonb_array_elements(value) x)
 where key = 'nexamon_cards';
select public.nexamon_sync() as synced3 \gset
select tests.assert(
  :synced3 = 231
  and (tests.nx('me-001')).start_e4 = 77700 and (tests.nx('me-001')).value_e4 = 77700
  and (tests.nx('me-002')).start_e4 = 77700 and (tests.nx('me-002')).value_e4 = 90000
  and (tests.nx('me-001')).population = 6 and (select count(*) from public.nexamon_copies) = 1086
  and not exists (select 1 from public.nexamon_listings l join public.nexamon_copies c on c.id = l.copy_id
                   where l.card_key = 'me-001' and l.price_cents <> tests.nx_ask('me-001', c.condition)),
  'a new start price in the catalogue moves a card that never traded (and the AI''s asks), not one that did');
update public.game_config set value = :'nx_cat'::jsonb where key = 'nexamon_cards';
update public.nexamon_cards set moved_at = null where card_key = 'me-002';
select public.nexamon_sync() is not null as ok \gset
select tests.assert(not exists (select 1 from public.nexamon_cards where value_e4 <> start_e4), 'the catalogue is back');

-- =============================================================================
-- C. Level gate
-- =============================================================================
select tests.login_as('authenticated', :d);
select public.get_nexamon() as locked \gset
select tests.throws_key($$select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy')$$, 'nexamon_locked',
  'buy_nexamon_pack(): level 10 needed (NX163)');
select tests.throws_key($$select public.get_nexamon_collection()$$, 'nexamon_locked', 'get_nexamon_collection(): locked below level 10');
select tests.throws_key($$select public.get_nexamon_market()$$, 'nexamon_locked', 'get_nexamon_market(): locked below level 10');
select tests.throws_key($$select public.get_nexamon_card('me-001')$$, 'nexamon_locked', 'get_nexamon_card(): locked below level 10');
select tests.throws_key($$select public.grade_nexamon_card(gen_random_uuid(), gen_random_uuid())$$, 'nexamon_locked',
  'grade_nexamon_card(): locked below level 10');
reset role;
select tests.assert(
  not (:'locked'::jsonb ->> 'unlocked')::boolean and (:'locked'::jsonb ->> 'unlock_level')::integer = 10
  and (:'locked'::jsonb ->> 'pack_size')::integer = 5
  and jsonb_array_length(:'locked'::jsonb -> 'sets') = 3
  and :'locked'::jsonb #>> '{sets,0,key}' = 'mystic_energy' and (:'locked'::jsonb #>> '{sets,0,pack_price_cents}')::bigint = 20000
  and :'locked'::jsonb #>> '{sets,0,name}' = 'Nexamon: Mystic Energy'
  and :'locked'::jsonb #>> '{sets,1,key}' = 'super_apex' and (:'locked'::jsonb #>> '{sets,1,pack_price_cents}')::bigint = 100000
  and :'locked'::jsonb #>> '{sets,2,key}' = 'prismatic_peak' and (:'locked'::jsonb #>> '{sets,2,pack_price_cents}')::bigint = 500000
  and (:'locked'::jsonb #>> '{sets,0,cards}')::integer = 77 and (:'locked'::jsonb #>> '{collection,copies}')::integer = 0,
  'get_nexamon(): unlock at level 10, three sets at 200 / 1.000 / 5.000 € with 77 cards and 5 cards per pack');

-- =============================================================================
-- D. Packs: paid to the households, five pulls, populations, idempotent
-- =============================================================================
select tests.cash(:a) as cash0 \gset
select tests.households() as hh0 \gset
select tests.nx_pop() as pop0 \gset
-- (a pack of the third set: the sections below work with cards of the first set and need their populations exact)
select tests.login_as('authenticated', :a);
select public.buy_nexamon_pack(:rq, 'prismatic_peak') as p1 \gset
select public.buy_nexamon_pack(:rq, 'prismatic_peak') as p1b \gset
select tests.throws_key($$select public.buy_nexamon_pack(gen_random_uuid(), 'nope')$$, 'nexamon_unknown',
  'buy_nexamon_pack(): unknown set (NX164)');
select tests.throws_key($$select public.buy_nexamon_pack(null, 'mystic_energy')$$, 'invalid_argument',
  'buy_nexamon_pack(): a request id is required');
reset role;
select tests.assert(
  :'p1b'::jsonb = :'p1'::jsonb
  and tests.cash(:a) = :cash0::bigint - 500000 and tests.households() = :hh0::bigint + 500000
  and (select count(*) from public.ledger_transactions where idempotency_key = 'nexamon:pack:' || :a || ':' || :rq
         and kind = 'nexamon_pack') = 1
  and (:'p1'::jsonb ->> 'price_cents')::bigint = 500000 and :'p1'::jsonb ->> 'set' = 'prismatic_peak'
  and (:'p1'::jsonb ->> 'packs_opened')::integer = 1
  and (select jsonb_agg((x ->> 'slot')::integer) from jsonb_array_elements(:'p1'::jsonb -> 'cards') x) = '[1, 2, 3, 4, 5]'::jsonb
  and not exists (select 1 from jsonb_array_elements(:'p1'::jsonb -> 'cards') x
                   where ((x ->> 'slot')::integer <= 3 and x ->> 'rarity' <> 'common')
                      or x ->> 'card_key' not like 'pp-%'
                      or (tests.nx(x ->> 'card_key')).rarity <> x ->> 'rarity'
                      or (tests.nx_copy((x ->> 'copy_id')::uuid)).owner_id <> :a
                      or (tests.nx_copy((x ->> 'copy_id')::uuid)).serial <> (x ->> 'serial')::bigint
                      or (tests.nx_copy((x ->> 'copy_id')::uuid)).condition <> x ->> 'condition'
                      or (x ->> 'value_cents')::bigint <> tests.nx_value(x ->> 'card_key', x ->> 'condition'))
  and (select count(distinct x ->> 'card_key') from jsonb_array_elements(:'p1'::jsonb -> 'cards') x where x ->> 'rarity' = 'common')
      = (select count(*) from jsonb_array_elements(:'p1'::jsonb -> 'cards') x where x ->> 'rarity' = 'common')
  and (:'p1'::jsonb #>> '{cards,0,is_new}')::boolean
  and (:'p1'::jsonb #>> '{cards,0,population}')::bigint = 7
  and (select count(*) from public.nexamon_copies where owner_id = :a) = 5
  and tests.nx_pop() = :pop0::bigint + 5
  and (select count(*) from public.nexamon_packs where player_id = :a) = 1,
  'buy_nexamon_pack(): 5.000 € to the households, five pulls in slot order (commons first), every pull raises the '
  'population, the same request id replays');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after a pack');

-- forced rolls: ultra in slot 4, legendary in slot 5; a legendary pull is news
select tests.set_cfg('nexamon', '{odds,slot4}', '{"legendary": 0, "prisma": 0, "ultra": 3600, "rare": 0}');
select tests.set_cfg('nexamon', '{odds,slot5}', '{"legendary": 3600, "prisma": 0, "ultra": 0, "rare": 0}');
select tests.login_as('authenticated', :a);
select public.buy_nexamon_pack(gen_random_uuid(), 'super_apex') as p2 \gset
reset role;
select tests.set_cfg('nexamon', '{odds}', :'nx_cfg'::jsonb -> 'odds');
select :'p2'::jsonb #>> '{cards,4,card_key}' as leg \gset
select (:'p2'::jsonb #>> '{cards,4,copy_id}') as leg_copy \gset
select tests.assert(
  :'p2'::jsonb #>> '{cards,3,rarity}' = 'ultra' and :'p2'::jsonb #>> '{cards,4,rarity}' = 'legendary'
  and :'p2'::jsonb #>> '{cards,2,rarity}' = 'common' and :'leg' like 'sa-%'
  and (tests.nx(:'leg')).population = 1 and (:'p2'::jsonb #>> '{cards,4,serial}')::integer = 1
  and (select count(*) from public.feed_items where actor_id = :a and kind = 'nexamon_pull' and payload ->> 'card_key' = :'leg') = 1
  and (select count(*) from public.feed_items where actor_id = :a and kind = 'nexamon_pull') = 1
  and public.feed_item_label('nexamon_pull', '{"serial": 1}') = 'legendäre Nexamon-Karte gezogen (Nummer 1)'
  and position('nexamon_pull' in pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure)) > 0,
  'slot 4 holds the ultra, slot 5 the legendary; the first legendary has population 1 and is news for the friends');

-- many packs (rolled back): better cards only in slots 4 and 5, prisma and legendary only in slot 5
begin;
select jsonb_agg(public.nexamon_open_pack('mystic_energy', null, 'Karten-Kalle', null, public.game_now())) as packs
  from generate_series(1, 400) \gset
select tests.assert(
  not exists (select 1 from jsonb_array_elements(:'packs'::jsonb) p, jsonb_array_elements(p) x
               where ((x ->> 'slot')::integer <= 3 and x ->> 'rarity' <> 'common')
                  or ((x ->> 'slot')::integer = 4 and x ->> 'rarity' in ('prisma', 'legendary')))
  and not exists (select 1 from jsonb_array_elements(:'packs'::jsonb) p
                   where jsonb_array_length(p) <> 5
                      or (select count(*) from jsonb_array_elements(p) x where x ->> 'rarity' = 'common') < 3
                      or (select count(distinct x ->> 'card_key') from jsonb_array_elements(p) x where x ->> 'rarity' = 'common')
                         <> (select count(*) from jsonb_array_elements(p) x where x ->> 'rarity' = 'common'))
  -- 400 packs: 200 rares expected (sd 12), 33 ultras (sd 5.6)
  and (select count(*) from jsonb_array_elements(:'packs'::jsonb) p, jsonb_array_elements(p) x where x ->> 'rarity' = 'rare')
      between 130 and 270
  and (select count(*) from jsonb_array_elements(:'packs'::jsonb) p, jsonb_array_elements(p) x where x ->> 'rarity' = 'ultra')
      between 8 and 70
  and (select count(*) from public.nexamon_copies where source = 'ai_pack' and ai_owner = 'Karten-Kalle') = 2000,
  '400 packs: 3 to 5 different commons in the first slots, rare and ultra only in slots 4 and 5 at their rates');
rollback;

-- not enough money, rate limit
select tests.set_cfg('nexamon', '{sets,prismatic_peak,packPriceCents}', to_jsonb(tests.cash(:c) + 1));
select tests.cash(:c) as cash_c \gset
select tests.login_as('authenticated', :c);
select tests.throws_key($$select public.buy_nexamon_pack(gen_random_uuid(), 'prismatic_peak')$$, 'insufficient_funds',
  'buy_nexamon_pack(): not enough cash');
reset role;
select tests.set_cfg('nexamon', '{sets}', :'nx_cfg'::jsonb -> 'sets');
select tests.set_cfg('nexamon', '{packs,perMinute}', '1');
select tests.login_as('authenticated', :c);
select tests.throws_key($$select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy'),
                                 public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy')$$, 'rate_limited',
  'buy_nexamon_pack(): at most packs.perMinute packs a minute');
reset role;
select tests.set_cfg('nexamon', '{packs,perMinute}', '1000');
select tests.assert(tests.cash(:c) = :cash_c::bigint and not exists (select 1 from public.nexamon_copies where owner_id = :c),
  'a failed pack purchase changes nothing');

-- =============================================================================
-- E. The market between players: list, buy, fee, the value follows a plausible sale
-- =============================================================================
select tests.nx_give(:a, 'me-051') as copy1 \gset
select (tests.nx('me-051')).value_e4 as v0 \gset
select tests.nx_ask('me-051') as ask0 \gset
select tests.cash(:a) as cash_a \gset
select tests.cash(:b) as cash_b \gset
select tests.households() as hh1 \gset
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.list_nexamon_card(gen_random_uuid(), %L, 9)$$, :'copy1'), 'invalid_argument',
  'list_nexamon_card(): the price needs at least market.minPriceCents');
select public.list_nexamon_card(:rl, :'copy1', :ask0) as l1 \gset
select public.list_nexamon_card(:rl, :'copy1', :ask0) as l1b \gset
select tests.throws_key(format($$select public.list_nexamon_card(gen_random_uuid(), %L, 5000)$$, :'copy1'), 'nexamon_listed',
  'list_nexamon_card(): a copy is listed once (NX166)');
select tests.throws_key(format($$select public.grade_nexamon_card(gen_random_uuid(), %L)$$, :'copy1'), 'nexamon_listed',
  'grade_nexamon_card(): not while listed');
select tests.throws_key(format($$select public.buy_nexamon_listing(gen_random_uuid(), %L, %s)$$, :'l1'::jsonb #>> '{listing,id}', :ask0),
  'nexamon_own_listing', 'buy_nexamon_listing(): not the own listing (NX174)');
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.list_nexamon_card(gen_random_uuid(), %L, 5000)$$, :'copy1'), 'nexamon_not_owner',
  'list_nexamon_card(): only own copies (NX165)');
select tests.throws_key(format($$select public.unlist_nexamon_card(gen_random_uuid(), %L)$$, :'l1'::jsonb #>> '{listing,id}'),
  'nexamon_not_owner', 'unlist_nexamon_card(): only own listings');
select tests.throws_key(format($$select public.buy_nexamon_listing(gen_random_uuid(), %L, %s)$$, :'l1'::jsonb #>> '{listing,id}', :ask0 - 1),
  'nexamon_price_changed', 'buy_nexamon_listing(): the price seen must match (NX168)');
select public.buy_nexamon_listing(:rb, (:'l1'::jsonb #>> '{listing,id}')::uuid, :ask0) as b1 \gset
select public.buy_nexamon_listing(:rb, (:'l1'::jsonb #>> '{listing,id}')::uuid, :ask0) as b1b \gset
select tests.throws_key(format($$select public.buy_nexamon_listing(gen_random_uuid(), %L, %s)$$, :'l1'::jsonb #>> '{listing,id}', :ask0),
  'nexamon_not_listed', 'buy_nexamon_listing(): sold is sold (NX167)');
reset role;
select tests.assert(
  :'l1b'::jsonb = :'l1'::jsonb and :'b1b'::jsonb = :'b1'::jsonb
  and (:'l1'::jsonb #>> '{listing,price_cents}')::bigint = :ask0 and (:'l1'::jsonb #>> '{listing,mine}')::boolean
  and :'l1'::jsonb #>> '{listing,seller}' = 'Nx_Anna' and not (:'l1'::jsonb #>> '{listing,seller_ai}')::boolean
  and (:'l1'::jsonb #>> '{copy,listing,price_cents}')::bigint = :ask0
  and tests.cash(:b) = :cash_b::bigint - :ask0
  and tests.cash(:a) = :cash_a::bigint + :ask0 - floor(:ask0::bigint * 0.05)
  and tests.households() = :hh1::bigint + floor(:ask0::bigint * 0.05)
  and (:'b1'::jsonb ->> 'price_cents')::bigint = :ask0 and (:'b1'::jsonb ->> 'fee_cents')::bigint = floor(:ask0::bigint * 0.05)
  and (:'b1'::jsonb ->> 'counted')::boolean and :'b1'::jsonb #>> '{copy,listing}' is null
  and (tests.nx_copy(:'copy1')).owner_id = :b and tests.nx_listing(:'copy1') is null
  and (select count(*) from public.nexamon_sales where copy_id = :'copy1' and kind = 'market' and counted
         and seller_id = :a and buyer_id = :b and value_before_e4 = :v0) = 1
  and tests.nx_notes(:a, 'nexamon_sale') = 1,
  'a player sells to a player: the buyer pays the price, the seller gets it minus 5 %, the fee goes to the households');
-- 10 % above the value: 20 % of the way = the 2 % cap, scaled by the popularity of a rare
select tests.assert(
  (tests.nx('me-051')).value_e4 = :v0 + floor(floor(:v0::bigint * 0.02) * greatest(public.nexamon_popularity_bps('rare', 5), 2500) / 10000.0)
  and (tests.nx('me-051')).value_e4 > :v0 and (tests.nx('me-051')).counted_trades = 1
  and (tests.nx('me-051')).moved_at is not null
  and (:'b1'::jsonb #>> '{card,value_cents}')::bigint = public.div_round_half_even((tests.nx('me-051')).value_e4, 100)
  and not exists (select 1 from public.nexamon_listings l join public.nexamon_copies c on c.id = l.copy_id
                   where l.card_key = 'me-051' and l.seller_ai is not null and l.price_cents <> tests.nx_ask('me-051', c.condition))
  and (select count(*) from public.nexamon_value_points where card_key = 'me-051') = 1,
  'the sale moves the card''s value up a bounded step; the AI''s asks follow the new value at once');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after a sale between players');

-- unlist
select tests.nx_give(:a, 'me-003') as copy_u \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'copy_u', 12345) #>> '{listing,id}' as lu \gset
select public.unlist_nexamon_card(gen_random_uuid(), :'lu') as u1 \gset
select tests.throws_key(format($$select public.unlist_nexamon_card(gen_random_uuid(), %L)$$, :'lu'), 'nexamon_not_listed',
  'unlist_nexamon_card(): only open listings');
reset role;
select tests.assert(:'u1'::jsonb #>> '{copy,listing}' is null and tests.nx_listing(:'copy_u') is null
  and (tests.nx_copy(:'copy_u')).owner_id = :a, 'unlist_nexamon_card(): the copy is back in the collection');

-- =============================================================================
-- F. Buying from an AI seller: value + 10 %, everything to the households, the AI offers the next copy
-- =============================================================================
select l.id as ai_l, l.price_cents as ai_p, l.copy_id as ai_c from public.nexamon_listings l
 where l.card_key = 'me-052' and l.seller_ai is not null order by l.price_cents, l.id limit 1 \gset
select (tests.nx('me-052')).value_e4 as v52 \gset
select tests.cash(:b) as cash_b \gset
select tests.households() as hh2 \gset
select tests.login_as('authenticated', :b);
select public.buy_nexamon_listing(gen_random_uuid(), :'ai_l', :ai_p) as b2 \gset
reset role;
select tests.assert(
  tests.cash(:b) = :cash_b::bigint - :ai_p and tests.households() = :hh2::bigint + :ai_p
  and (:'b2'::jsonb ->> 'fee_cents')::bigint = :ai_p and (:'b2'::jsonb ->> 'counted')::boolean
  and (tests.nx_copy(:'ai_c')).owner_id = :b and (tests.nx_copy(:'ai_c')).ai_owner is null
  and (select count(*) from public.nexamon_copies where card_key = 'me-052' and ai_owner is not null) = 3
  and (select count(*) from public.nexamon_listings where card_key = 'me-052' and seller_ai is not null) = 3
  and (tests.nx('me-052')).value_e4 > :v52 and (tests.nx('me-052')).population = 4,
  'buying from the AI: the whole price goes to the households, the AI offers its next copy, the value rises');

-- =============================================================================
-- G. Absurd prices: such a sale does not move the value
-- =============================================================================
select tests.nx_give(:a, 'me-053') as copy3 \gset
select (tests.nx('me-053')).value_e4 as v53 \gset
select tests.nx_value('me-053') * 100 as absurd \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'copy3', :absurd) #>> '{listing,id}' as l3 \gset
reset role;
select tests.login_as('authenticated', :b);
select public.buy_nexamon_listing(gen_random_uuid(), :'l3', :absurd) as b3 \gset
reset role;
select tests.assert(
  not (:'b3'::jsonb ->> 'counted')::boolean and (tests.nx('me-053')).value_e4 = :v53
  and (tests.nx('me-053')).counted_trades = 0 and (tests.nx('me-053')).moved_at is null
  and (select count(*) from public.nexamon_sales where copy_id = :'copy3' and not counted and value_after_e4 = :v53) = 1,
  'a sale at a hundred times the value is no price signal: the value stays');

-- =============================================================================
-- H. Wash trades: the same two players count once per card and day; a buyer counts three times a day
-- =============================================================================
select tests.nx_give(:a, 'me-054') as copy4 \gset
select (tests.nx('me-054')).value_e4 as v54 \gset
select (tests.nx_value('me-054') * 12 / 10) as wash \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'copy4', :wash) #>> '{listing,id}' as w1 \gset
reset role;
select tests.login_as('authenticated', :b);
select public.buy_nexamon_listing(gen_random_uuid(), :'w1', :wash) as wb1 \gset
select public.list_nexamon_card(gen_random_uuid(), :'copy4', :wash) #>> '{listing,id}' as w2 \gset
reset role;
select (tests.nx('me-054')).value_e4 as v54b \gset
select tests.login_as('authenticated', :a);
select public.buy_nexamon_listing(gen_random_uuid(), :'w2', :wash) as wb2 \gset
select public.list_nexamon_card(gen_random_uuid(), :'copy4', :wash) #>> '{listing,id}' as w3 \gset
reset role;
select tests.login_as('authenticated', :b);
select public.buy_nexamon_listing(gen_random_uuid(), :'w3', :wash) as wb3 \gset
reset role;
select tests.assert(
  (:'wb1'::jsonb ->> 'counted')::boolean and not (:'wb2'::jsonb ->> 'counted')::boolean
  and not (:'wb3'::jsonb ->> 'counted')::boolean
  and :v54b > :v54 and :v54b <= :v54 + floor(:v54::bigint * 0.02)
  and (tests.nx('me-054')).value_e4 = :v54b and (tests.nx('me-054')).counted_trades = 1
  and (select count(*) from public.nexamon_sales where copy_id = :'copy4') = 3,
  'two friends trading a card back and forth above the value: only the first sale counts, at most 2 %');
-- with the pair rule out of the way, a buyer still counts only three times per card and day
select (tests.nx('me-010')).value_e4 as v10 \gset
select tests.login_as('authenticated', :c);
select tests.nx_buy_ai('me-010') ->> 'counted' as c1 \gset
select tests.nx_buy_ai('me-010') ->> 'counted' as c2 \gset
select tests.nx_buy_ai('me-010') ->> 'counted' as c3 \gset
select (tests.nx('me-010')).value_e4 as v10c \gset
select tests.nx_buy_ai('me-010') ->> 'counted' as c4 \gset
reset role;
select tests.assert(
  :'c1'::boolean and :'c2'::boolean and :'c3'::boolean and not :'c4'::boolean
  and :v10c >= :v10 and (tests.nx('me-010')).value_e4 = :v10c and (tests.nx('me-010')).counted_trades = 3
  and (select count(*) from public.nexamon_copies where card_key = 'me-010' and owner_id = :c) = 4
  and (select count(*) from public.nexamon_listings where card_key = 'me-010') = 2,
  'buying the AI out: three purchases of a card count per buyer and day, the fourth changes nothing; the AI runs dry');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after the wash trades');

-- =============================================================================
-- I. AI collectors buy only up to the value, limited per card and week and by the set's daily budget
-- =============================================================================
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '10000');
select tests.set_cfg('nexamon', '{ai,maxBuysPerRun}', '50');
select tests.nx_give(:a, 'me-055') as fair \gset
select tests.nx_give(:a, 'me-056') as silly \gset
select tests.nx_give(:a, 'me-057') as cent \gset
select (tests.nx('me-055')).value_e4 as v55 \gset
select tests.nx_value('me-055') as p55 \gset
select tests.nx_value('me-056') * 50 as p56 \gset
select tests.nx_value('me-057') + 1 as p57 \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'fair', :p55) is not null as ok \gset
select public.list_nexamon_card(gen_random_uuid(), :'silly', :p56) is not null as ok \gset
select public.list_nexamon_card(gen_random_uuid(), :'cent', :p57) is not null as ok \gset
reset role;
select tests.cash(:a) as cash_a \gset
select tests.households() as hh3 \gset
select public.nexamon_run_due() as run1 \gset
select tests.assert(
  (:'run1'::jsonb ->> 'ai_bought')::integer = 1 and (:'run1'::jsonb ->> 'ai_packs')::integer = 0
  and tests.cash(:a) = :cash_a::bigint + :p55 - floor(:p55::bigint * 0.05)
  and tests.households() = :hh3::bigint - :p55 + floor(:p55::bigint * 0.05)
  and (tests.nx_copy(:'fair')).owner_id is null and (tests.nx_copy(:'fair')).ai_owner is not null
  and (select count(*) from public.nexamon_sales where copy_id = :'fair' and kind = 'ai_buy' and counted and buyer_ai is not null) = 1
  -- the value rises by aiBuyBumpBps x popularity
  and (tests.nx('me-055')).value_e4 = :v55 + floor(:v55::bigint * 50.0 * public.nexamon_popularity_bps('rare', 5) / 100000000)
  and tests.nx_listing(:'silly') is not null and tests.nx_listing(:'cent') is not null
  and (tests.nx_copy(:'silly')).owner_id = :a
  and tests.nx_notes(:a, 'nexamon_sale') = 5,
  'the AI buys a listing at the value (households money, 5 % fee) and lifts the value a little; it ignores a listing '
  'one cent above the value and an absurd one');
-- three per card and week for a rare
select tests.nx_give(:a, 'me-055') as f2 \gset
select tests.nx_give(:a, 'me-055') as f3 \gset
select tests.nx_give(:a, 'me-055') as f4 \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'f2', :p55) is not null as ok \gset
select public.list_nexamon_card(gen_random_uuid(), :'f3', :p55) is not null as ok \gset
select public.list_nexamon_card(gen_random_uuid(), :'f4', :p55) is not null as ok \gset
reset role;
select public.nexamon_run_due() is not null and public.nexamon_run_due() is not null as ok \gset
select tests.assert(
  (select count(*) from public.nexamon_sales where card_key = 'me-055' and kind = 'ai_buy') = 3
  and (select count(*) from public.nexamon_listings where card_key = 'me-055' and seller_id = :a) = 1,
  'the AI buys at most ai.buysPerCardWindow copies of a card from players in a week');
-- no budget, no purchase
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.nx_give(:a, 'me-058') as nobudget \gset
select tests.nx_value('me-058') as p58 \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'nobudget', :p58) is not null as ok \gset
reset role;
select public.nexamon_run_due() as run2 \gset
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', :'nx_cfg'::jsonb #> '{ai,dailyBudgetPacks}');
select tests.assert((:'run2'::jsonb ->> 'ai_bought')::integer = 0 and tests.nx_listing(:'nobudget') is not null,
  'the AI stops buying when the set''s daily budget is spent');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after AI purchases');

-- =============================================================================
-- J. Bounds of the value; supply against demand
-- =============================================================================
select (tests.nx('me-060')).start_e4 as s60 \gset
select public.nexamon_set_value('me-060', :s60::bigint * 10, public.game_now()) as up1 \gset
select public.nexamon_set_value('me-060', :s60::bigint * 10, public.game_now()) as up2 \gset
select tests.assert(
  :up1 = public.div_round_half_even(:s60::bigint * 11500, 10000) and :up2 = :up1 and (tests.nx('me-060')).value_e4 = :up1
  and (tests.nx('me-060')).day_ref_e4 = :s60,
  'nexamon_set_value(): at most +15 % against the day''s first value');
do $$
declare
  i integer;
begin
  for i in 1 .. 40 loop
    perform public.nexamon_set_value('me-060', 1000000000000000, public.game_now() + make_interval(days => i));
  end loop;
end;
$$;
select tests.assert(
  (tests.nx('me-060')).value_e4 = (select cap_e4 from public.nexamon_bounds(:s60, (tests.nx('me-060')).first_pulled_at, 0,
                                                                          public.game_now() + interval '40 days'))
  and (tests.nx('me-060')).value_e4 between :s60::bigint * 3 and :s60::bigint * 4,
  'driving a value up day after day ends at the cap: 3 x the start price plus 2 % per day');
do $$
declare
  i integer;
begin
  for i in 41 .. 90 loop
    perform public.nexamon_set_value('me-060', 1, public.game_now() + make_interval(days => i));
  end loop;
end;
$$;
select tests.assert((tests.nx('me-060')).value_e4 = public.div_round_half_even(:s60::bigint * 2000, 10000),
  'and never falls below 20 % of the start price');

-- a seeded prisma: in balance, then bought up and hoarded, then dumped
select k.card_key as pk from public.nexamon_cards k
 where k.rarity = 'prisma' and k.set_key = 'mystic_energy' and k.population = 1 order by k.number limit 1 \gset
select (tests.nx(:'pk')).value_e4 as vp0 \gset
select public.nexamon_pressure_step(:'pk', public.game_now()) as step0 \gset
select l.id as pk_l, l.price_cents as pk_p, l.copy_id as pk_c from public.nexamon_listings l where l.card_key = :'pk' \gset
select tests.login_as('authenticated', :b);
select public.buy_nexamon_listing(gen_random_uuid(), :'pk_l', :pk_p) is not null as ok \gset
reset role;
select (tests.nx(:'pk')).value_e4 as vp1 \gset
select public.nexamon_pressure_step(:'pk', public.game_now()) as step1 \gset
select tests.assert(
  :step0 = :vp0 and :vp1 > :vp0
  and not exists (select 1 from public.nexamon_listings where card_key = :'pk')
  -- nothing on offer, one purchase: full pressure, +0.3 % x popularity
  and :step1 = :vp1 + floor(:vp1 * 10000.0 * 30 * public.nexamon_popularity_bps('prisma', 1) / 1000000000000)
  and :step1 > :vp1 and (tests.nx(:'pk')).pressure_at is not null,
  'a prisma in balance stands still; bought up and held back it rises hour by hour');
-- five more copies appear and are all offered at the value: too much supply
select tests.nx_give(:b, :'pk') is not null and tests.nx_give(:b, :'pk') is not null and tests.nx_give(:b, :'pk') is not null
   and tests.nx_give(:b, :'pk') is not null and tests.nx_give(:b, :'pk') is not null as ok \gset
select tests.login_as('authenticated', :b);
select tests.nx_list_all(:'pk') as n_listed \gset
reset role;
select public.nexamon_pressure_step(:'pk', public.game_now()) as step2 \gset
select tests.assert(:n_listed = 6 and :step2 = :step1 - floor(:step1 * 10000.0 * 30 / 100000000),
  'dumped on the market it falls by 0.3 % per hour');
-- the same copies at absurd prices are no supply
update public.nexamon_listings set price_cents = price_cents * 100 where card_key = :'pk';
select public.nexamon_pressure_step(:'pk', public.game_now()) as step3 \gset
select tests.assert(:step3 > :step2, 'listings far above the value do not count as supply');
delete from public.nexamon_listings where card_key = :'pk';
-- the first legendary: rises slowly, and the AI never offers one
select (tests.nx(:'leg')).value_e4 as vl0 \gset
select public.nexamon_pressure_step(:'leg', public.game_now()) as vl1 \gset
select tests.assert(
  :vl1 = :vl0 + floor(:vl0 * 8000.0 * 30 * 10000 / 1000000000000) and :vl1 < :vl0 * 1.003
  and not exists (select 1 from public.nexamon_listings where card_key = :'leg'),
  'the first legendary (population 1) gains at most 0.24 % an hour and stays inside the cap');

-- =============================================================================
-- K. Condition: a poor copy is worth 5 % less
-- =============================================================================
select tests.nx_give(:a, 'me-061', 'poor') as poor1 \gset
select tests.nx_give(:a, 'me-061', 'good') as good1 \gset
select tests.login_as('authenticated', :a);
select public.get_nexamon_collection('mystic_energy') as col \gset
reset role;
select tests.assert(
  (select (x ->> 'value_cents')::bigint from jsonb_array_elements(:'col'::jsonb -> 'copies') x where x ->> 'id' = :'poor1')
    = public.div_round_half_even((tests.nx('me-061')).value_e4 * 0.95, 100)
  and (select (x ->> 'value_cents')::bigint from jsonb_array_elements(:'col'::jsonb -> 'copies') x where x ->> 'id' = :'good1')
    = public.div_round_half_even((tests.nx('me-061')).value_e4, 100)
  and (select x ->> 'condition' from jsonb_array_elements(:'col'::jsonb -> 'copies') x where x ->> 'id' = :'poor1') = 'poor'
  and jsonb_array_length(:'col'::jsonb -> 'cards') = 77
  and (select (x ->> 'owned')::integer from jsonb_array_elements(:'col'::jsonb -> 'cards') x where x ->> 'card_key' = 'me-061') = 2
  and (select (x ->> 'population')::integer from jsonb_array_elements(:'col'::jsonb -> 'cards') x where x ->> 'card_key' = 'me-061') = 4
  and (select (x ->> 'listed')::integer from jsonb_array_elements(:'col'::jsonb -> 'cards') x where x ->> 'card_key' = 'me-061') = 2
  and not exists (select 1 from jsonb_array_elements(:'col'::jsonb -> 'copies') x where x ->> 'card_key' not like 'me-%'),
  'get_nexamon_collection(): every card with population, listings and the own count; a poor copy is worth 95 %');

-- =============================================================================
-- L. Grading by ASP: half the value, one hour, grade by condition; cracking the slab
-- =============================================================================
select tests.nx_give(:a, 'me-062', 'mint') as g1 \gset
select tests.nx_give(:a, 'me-062', 'poor') as g2 \gset
select tests.nx_give(:a, 'me-062', 'good') as g3 \gset
select tests.nx_value('me-062', 'mint') as gv \gset
select tests.cash(:a) as cash_a \gset
select tests.households() as hh4 \gset
select tests.login_as('authenticated', :a);
select public.grade_nexamon_card(:rg, :'g1') as gr1 \gset
select public.grade_nexamon_card(:rg, :'g1') as gr1b \gset
select tests.throws_key(format($$select public.grade_nexamon_card(gen_random_uuid(), %L)$$, :'g1'), 'nexamon_grading',
  'grade_nexamon_card(): the copy is already at ASP (NX170)');
select tests.throws_key(format($$select public.list_nexamon_card(gen_random_uuid(), %L, 5000)$$, :'g1'), 'nexamon_grading',
  'list_nexamon_card(): not while at ASP');
select tests.throws_key(format($$select public.crack_nexamon_slab(gen_random_uuid(), %L)$$, :'g1'), 'nexamon_grading',
  'crack_nexamon_slab(): not while at ASP');
select tests.throws_key(format($$select public.sell_nexamon_to_ai(gen_random_uuid(), array[%L]::uuid[])$$, :'g1'), 'nexamon_grading',
  'sell_nexamon_to_ai(): not while at ASP');
select tests.throws_key(format($$select public.crack_nexamon_slab(gen_random_uuid(), %L)$$, :'g3'), 'nexamon_not_graded',
  'crack_nexamon_slab(): only slabs (NX172)');
reset role;
select tests.assert(
  :'gr1b'::jsonb = :'gr1'::jsonb
  and (:'gr1'::jsonb ->> 'fee_cents')::bigint = greatest(100, public.div_round_half_even(:gv::bigint * 5000, 10000))
  and tests.cash(:a) = :cash_a::bigint - (:'gr1'::jsonb ->> 'fee_cents')::bigint
  and tests.households() = :hh4::bigint + (:'gr1'::jsonb ->> 'fee_cents')::bigint
  and (select count(*) from public.ledger_transactions where idempotency_key = 'nexamon:grade:' || :a || ':' || :rg
         and kind = 'nexamon_grading') = 1
  and :'gr1'::jsonb #>> '{copy,state}' = 'grading' and :'gr1'::jsonb #>> '{copy,grade}' is null
  and (:'gr1'::jsonb ->> 'ready_at')::timestamptz = (tests.nx_copy(:'g1')).grading_until
  and (tests.nx_copy(:'g1')).grading_until between public.game_now() + interval '59 minutes' and public.game_now() + interval '60 minutes',
  'grade_nexamon_card(): 50 % of the copy''s value to the households, back in one hour');
select public.nexamon_finish_gradings(null, public.game_now() + interval '58 minutes') as early \gset
select tests.set_cfg('nexamon', '{grading,gradeWeightsBps,mint}', '[0, 0, 0, 0, 0, 0, 0, 0, 0, 10000]');
select tests.set_cfg('nexamon', '{grading,gradeWeightsBps,poor}', '[0, 0, 10000, 0, 0, 0, 0, 0, 0, 0]');
select public.nexamon_finish_gradings(null, public.game_now() + interval '61 minutes') as done \gset
select tests.assert(
  :early = 0 and :done = 1
  and (tests.nx_copy(:'g1')).grade = 10 and (tests.nx_copy(:'g1')).grading_until is null
  and (tests.nx_copy(:'g1')).graded_at is not null and (tests.nx_copy(:'g1')).condition = 'mint'
  and tests.nx_value('me-062', 'mint', 10) = :gv::bigint * 3
  and tests.nx_notes(:a, 'nexamon_graded') = 1,
  'ASP needs the full hour; a mint card gets its 10 and is then worth three times the card');
-- the player's own reads finish due gradings too (no cron needed); a poor card gets a low grade
select tests.cash(:a) as cash_a \gset
select tests.login_as('authenticated', :a);
select public.grade_nexamon_card(gen_random_uuid(), :'g2') ->> 'fee_cents' as fee2 \gset
reset role;
update public.nexamon_copies set grading_until = public.game_now() - interval '1 second' where id = :'g2';
select tests.login_as('authenticated', :a);
select public.get_nexamon() as ov \gset
select tests.throws_key(format($$select public.grade_nexamon_card(gen_random_uuid(), %L)$$, :'g1'), 'nexamon_not_raw',
  'grade_nexamon_card(): a slab is not graded again (NX171)');
select public.get_nexamon_card('me-062') as card62 \gset
select public.crack_nexamon_slab(gen_random_uuid(), :'g2') as cr \gset
select tests.throws_key(format($$select public.crack_nexamon_slab(gen_random_uuid(), %L)$$, :'g2'), 'nexamon_not_graded',
  'crack_nexamon_slab(): the slab is gone');
reset role;
select tests.assert(
  (tests.nx_copy(:'g2')).grade is null and (tests.nx_copy(:'g2')).condition = 'poor' and (tests.nx_copy(:'g2')).graded_at is null
  and (:'cr'::jsonb ->> 'old_grade')::integer = 3 and :'cr'::jsonb #>> '{copy,state}' = 'raw'
  and (:'cr'::jsonb #>> '{copy,value_cents}')::bigint = tests.nx_value('me-062', 'poor')
  and :fee2 = greatest(100, public.div_round_half_even(tests.nx_value('me-062', 'poor') * 5000, 10000))
  and tests.cash(:a) = :cash_a::bigint - :fee2
  and (:'ov'::jsonb #>> '{collection,graded}')::integer = 2 and (:'ov'::jsonb #>> '{collection,grading}')::integer = 0
  and (:'ov'::jsonb ->> 'unlocked')::boolean
  and :'card62'::jsonb -> 'graded' = '[0, 0, 1, 0, 0, 0, 0, 0, 0, 1]'::jsonb
  and (select (x ->> 'value_cents')::bigint from jsonb_array_elements(:'card62'::jsonb -> 'copies') x where x ->> 'id' = :'g2')
      = public.div_round_half_even((tests.nx('me-062')).value_e4 * 0.5, 100)
  and (select x ->> 'state' from jsonb_array_elements(:'card62'::jsonb -> 'copies') x where x ->> 'id' = :'g1') = 'graded'
  and jsonb_array_length(:'card62'::jsonb -> 'copies') = 3,
  'a poor card comes back with a 3 (half the value); cracking the slab returns the raw poor card without a refund');
-- graded again for the fee; the limit of open gradings
select tests.set_cfg('nexamon', '{grading,maxOpen}', '1');
select tests.login_as('authenticated', :a);
select public.grade_nexamon_card(gen_random_uuid(), :'g2') ->> 'fee_cents' as fee3 \gset
select tests.throws_key(format($$select public.grade_nexamon_card(gen_random_uuid(), %L)$$, :'g3'), 'nexamon_grading_limit',
  'grade_nexamon_card(): at most grading.maxOpen copies at ASP (NX175)');
reset role;
select tests.set_cfg('nexamon', '{grading}', :'nx_cfg'::jsonb -> 'grading');
select tests.assert(:fee3 = :fee2 and tests.cash(:a) = :cash_a::bigint - :fee2 - :fee3,
  'a cracked card may be graded again, for the fee again');
-- slabs trade with their grade; the AI pays at most 70 % of a slab's value
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '10000');
select tests.nx_value('me-062', 'mint', 10) as slab \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'g1', :slab) as sl1 \gset
reset role;
select public.nexamon_run_due() as run3 \gset
select tests.nx_listing(:'g1') is not null as slab_kept \gset
select tests.login_as('authenticated', :a);
select public.unlist_nexamon_card(gen_random_uuid(), (:'sl1'::jsonb #>> '{listing,id}')::uuid) is not null as ok \gset
select public.list_nexamon_card(gen_random_uuid(), :'g1', :slab::bigint * 7 / 10) is not null as ok \gset
reset role;
select public.nexamon_run_due() as run4 \gset
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.assert(
  (:'sl1'::jsonb #>> '{listing,grade}')::integer = 10 and (:'sl1'::jsonb #>> '{listing,value_cents}')::bigint = :slab
  and :'slab_kept'::boolean and (:'run4'::jsonb ->> 'ai_bought')::integer = 1
  and (tests.nx_copy(:'g1')).ai_owner is not null and (tests.nx_copy(:'g1')).grade = 10
  and (select count(*) from public.nexamon_sales where copy_id = :'g1' and kind = 'ai_buy' and grade = 10
         and price_cents = :slab::bigint * 7 / 10) = 1,
  'slabs trade with their grade: the AI leaves a slab at its full value and buys it at 70 %');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after grading');

-- =============================================================================
-- M. Instant sale of bulk to the AI
-- =============================================================================
select tests.nx_give(:a, 'me-011', 'good') as q1 \gset
select tests.nx_give(:a, 'me-061', 'mint') as q_ultra \gset
select (tests.nx('me-011')).value_e4 as v11 \gset
select tests.nx_value('me-011', 'good') as qv \gset
select tests.cash(:a) as cash_a \gset
select tests.households() as hh5 \gset
select tests.login_as('authenticated', :a);
select public.sell_nexamon_to_ai(gen_random_uuid(), array[:'q1']::uuid[]) as qs \gset
select tests.throws_key(format($$select public.sell_nexamon_to_ai(gen_random_uuid(), array[%L]::uuid[])$$, :'q_ultra'),
  'nexamon_not_sellable', 'sell_nexamon_to_ai(): only commons and rares (NX173)');
select tests.throws_key($$select public.sell_nexamon_to_ai(gen_random_uuid(), '{}'::uuid[])$$, 'invalid_argument',
  'sell_nexamon_to_ai(): at least one copy');
select tests.throws_key(format($$select public.sell_nexamon_to_ai(gen_random_uuid(), array[%L]::uuid[])$$, :'copy1'),
  'nexamon_not_owner', 'sell_nexamon_to_ai(): only own copies');
reset role;
select tests.assert(
  (:'qs'::jsonb ->> 'count')::integer = 1 and (:'qs'::jsonb ->> 'total_cents')::bigint = floor(:qv::bigint * 0.5)
  and tests.cash(:a) = :cash_a::bigint + floor(:qv::bigint * 0.5) and tests.households() = :hh5::bigint - floor(:qv::bigint * 0.5)
  and (tests.nx_copy(:'q1')).ai_owner is not null and (tests.nx_copy(:'q1')).owner_id is null
  and (tests.nx('me-011')).value_e4 = :v11 - floor(:v11::bigint * 25 / 10000.0)
  and (select count(*) from public.nexamon_sales where copy_id = :'q1' and kind = 'quick' and not counted) = 1
  and (tests.nx('me-011')).population = 7,
  'sell_nexamon_to_ai(): half the value at once from the households, the copy joins the AI''s stock, the value dips');

-- =============================================================================
-- N. The AI opens packs: populations grow, its pulls go into its stock, no legendary on sale
-- =============================================================================
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 60, "super_apex": 0, "prismatic_peak": 0}');
select tests.set_cfg('nexamon', '{odds,slot4}', '{"legendary": 0, "prisma": 0, "ultra": 0, "rare": 0}');
select tests.set_cfg('nexamon', '{odds,slot5}', '{"legendary": 3600, "prisma": 0, "ultra": 0, "rare": 0}');
select tests.nx_pop() as pop1 \gset
select (select count(*) from public.nexamon_copies where owner_id is not null) as owned1 \gset
select public.nexamon_run_due(public.game_now() + interval '10 minutes') as run5 \gset
select tests.set_cfg('nexamon', '{odds}', :'nx_cfg'::jsonb -> 'odds');
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0}');
select tests.assert(
  (:'run5'::jsonb ->> 'ai_packs')::integer = 5
  and tests.nx_pop() = :pop1::bigint + 25
  and (select count(*) from public.nexamon_copies where source = 'ai_pack' and ai_owner is not null) = 25
  and (select count(*) from public.nexamon_copies where owner_id is not null) = :owned1
  and (select ai_packs_opened from public.nexamon_set_state where set_key = 'mystic_energy') = 5
  and (select ai_packs_opened from public.nexamon_set_state where set_key = 'super_apex') = 0
  -- five legendaries went to the AI, none is on sale
  and (select count(*) from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
        where k.rarity = 'legendary' and c.ai_owner is not null) = 5
  and not exists (select 1 from public.nexamon_listings l join public.nexamon_cards k on k.card_key = l.card_key
                   where k.rarity = 'legendary')
  and not exists (select 1 from public.nexamon_listings l join public.nexamon_cards k on k.card_key = l.card_key
                   where l.seller_ai is not null and k.rarity <> 'legendary' and l.card_key <> 'me-062'
                   group by l.card_key, k.rarity
                  having count(*) > (:'nx_cfg'::jsonb #>> array['ai', 'listedPerCard', k.rarity])::integer),
  'the AI opens at most ai.maxPacksPerRun packs per run: 25 new copies in its stock, populations up, legendaries kept back');

-- =============================================================================
-- O. Reading: a card and the market
-- =============================================================================
select tests.nx_give(:b, 'me-070') as slab_b \gset
update public.nexamon_copies set grade = 9, graded_at = now() where id = :'slab_b';
select tests.login_as('authenticated', :b);
select public.list_nexamon_card(gen_random_uuid(), :'slab_b', tests.nx_value('me-070', 'mint', 9)) is not null as ok \gset
select public.get_nexamon_card('me-051') as c51 \gset
select public.get_nexamon_market() as m1 \gset
select public.get_nexamon_market(p_sort => 'price_asc', p_set => 'mystic_energy', p_rarity => 'rare') as m2 \gset
select public.get_nexamon_market(p_seller => 'players') as m3 \gset
select public.get_nexamon_market(p_graded => true) as m4 \gset
select public.get_nexamon_market(p_card_key => 'me-051', p_page => 1) as m5 \gset
select public.get_nexamon_market(p_page => 2, p_sort => 'price_desc') as m6 \gset
select public.get_nexamon_collection() as col_b \gset
select tests.throws_key($$select public.get_nexamon_market(p_sort => 'nope')$$, 'invalid_argument', 'get_nexamon_market(): known sorts only');
select tests.throws_key($$select public.get_nexamon_card('zz-999')$$, 'nexamon_unknown', 'get_nexamon_card(): unknown card');
select tests.throws_key($$select public.get_nexamon_collection('nope')$$, 'nexamon_unknown', 'get_nexamon_collection(): unknown set');
reset role;
select tests.assert(
  :'c51'::jsonb #>> '{card,card_key}' = 'me-051' and :'c51'::jsonb #>> '{card,rarity}' = 'rare'
  and (:'c51'::jsonb #>> '{card,value_cents}')::bigint = public.div_round_half_even((tests.nx('me-051')).value_e4, 100)
  and (:'c51'::jsonb #>> '{card,population}')::integer = 5 and (:'c51'::jsonb #>> '{card,owned}')::integer = 1
  and (:'c51'::jsonb #>> '{card,change_bps}')::integer > 0
  and (:'c51'::jsonb #>> '{card,floor_cents}')::bigint < (:'c51'::jsonb #>> '{card,start_cents}')::bigint
  and (:'c51'::jsonb #>> '{card,cap_cents}')::bigint >= 3 * (:'c51'::jsonb #>> '{card,start_cents}')::bigint
  and jsonb_array_length(:'c51'::jsonb -> 'history') in (2, 3)
  and (:'c51'::jsonb -> 'history' -> 0 ->> 'value_cents')::bigint = (:'c51'::jsonb #>> '{card,start_cents}')::bigint
  and (:'c51'::jsonb -> 'history' -> -1 ->> 'value_cents')::bigint = (:'c51'::jsonb #>> '{card,value_cents}')::bigint
  and jsonb_array_length(:'c51'::jsonb -> 'listings') = 3 and (:'c51'::jsonb #>> '{listings,0,seller_ai}')::boolean
  and jsonb_array_length(:'c51'::jsonb -> 'copies') = 1 and :'c51'::jsonb #>> '{copies,0,id}' = :'copy1'
  and jsonb_array_length(:'c51'::jsonb -> 'sales') = 1 and :'c51'::jsonb #>> '{sales,0,seller}' = 'Nx_Anna'
  and :'c51'::jsonb #>> '{sales,0,buyer}' = 'Nx_Bruno' and :'c51'::jsonb #>> '{sales,0,kind}' = 'market'
  and jsonb_array_length(:'c51'::jsonb -> 'graded') = 10,
  'get_nexamon_card(): value, bounds, population, history, listings, own copies, sales');
select tests.assert(
  (:'m1'::jsonb ->> 'total')::bigint = (select count(*) from public.nexamon_listings)
  and (:'m1'::jsonb ->> 'page_size')::integer = 24 and jsonb_array_length(:'m1'::jsonb -> 'listings') = 24
  and (:'m1'::jsonb ->> 'pages')::integer = ceil((select count(*) from public.nexamon_listings) / 24.0)
  and (:'m2'::jsonb #>> '{listings,0,price_cents}')::bigint
      = (select min(l.price_cents) from public.nexamon_listings l join public.nexamon_cards k on k.card_key = l.card_key
          where k.set_key = 'mystic_energy' and k.rarity = 'rare')
  and not exists (select 1 from jsonb_array_elements(:'m2'::jsonb -> 'listings') x where x ->> 'rarity' <> 'rare' or x ->> 'set' <> 'mystic_energy')
  and (:'m3'::jsonb ->> 'total')::bigint = (select count(*) from public.nexamon_listings where seller_id is not null)
  and not exists (select 1 from jsonb_array_elements(:'m3'::jsonb -> 'listings') x where (x ->> 'seller_ai')::boolean)
  and (:'m4'::jsonb ->> 'total')::integer = 1 and (:'m4'::jsonb #>> '{listings,0,grade}')::integer = 9
  and (:'m4'::jsonb #>> '{listings,0,mine}')::boolean and :'m4'::jsonb #>> '{listings,0,seller}' = 'Nx_Bruno'
  and (:'m5'::jsonb ->> 'total')::integer = 3
  and (:'m6'::jsonb ->> 'page')::integer = 2 and jsonb_array_length(:'m6'::jsonb -> 'listings') = 24
  and jsonb_array_length(:'col_b'::jsonb -> 'cards') = 231
  and jsonb_array_length(:'col_b'::jsonb -> 'copies') = (select count(*) from public.nexamon_copies where owner_id = :b),
  'get_nexamon_market(): filters by set, rarity, seller, card and graded, sorts and pages');

-- the limit of open listings
select tests.set_cfg('nexamon', '{market,maxListings}', to_jsonb((select count(*) from public.nexamon_listings where seller_id = :a)));
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.list_nexamon_card(gen_random_uuid(), %L, 5000)$$, :'copy_u'), 'nexamon_listing_limit',
  'list_nexamon_card(): at most market.maxListings open listings (NX169)');
reset role;
select tests.set_cfg('nexamon', '{market}', :'nx_cfg'::jsonb -> 'market');

-- =============================================================================
-- P. Account reset: listings and gradings end, the copies go to the AI, the populations stay
-- =============================================================================
select tests.nx_pop() as pop2 \gset
select (select count(*) from public.nexamon_copies where owner_id = :a) as a_copies \gset
select (select count(*) from public.nexamon_copies where ai_owner is not null) as ai_copies \gset
select tests.login_as('authenticated', :a);
select public.reset_account(gen_random_uuid(), 'Nx_Anna') is not null as ok \gset
select public.get_nexamon() as after_reset \gset
reset role;
select tests.assert(
  :a_copies > 10
  and not exists (select 1 from public.nexamon_copies where owner_id = :a)
  and not exists (select 1 from public.nexamon_listings where seller_id = :a)
  and not exists (select 1 from public.nexamon_packs where player_id = :a)
  and not exists (select 1 from public.nexamon_copies where grading_until is not null)
  and (select count(*) from public.nexamon_copies where ai_owner is not null) = :ai_copies + :a_copies
  and tests.nx_pop() = :pop2
  and (:'after_reset'::jsonb #>> '{collection,copies}')::integer = 0
  and (:'after_reset'::jsonb #>> '{sets,0,packs_opened}')::integer = 0
  and position('nexamon_wipe_player' in pg_get_functiondef('public.account_wipe(uuid, text)'::regprocedure)) > 0,
  'reset_account(): no cards, listings, packs or gradings left; the copies live on with the AI sellers');

-- =============================================================================
-- Q. Missions, notification types, privileges; the config goes back
-- =============================================================================
select tests.assert(
  (select count(*) from public.mission_templates where key like '%nexamon%' and params ->> 'unlock' = 'nexamon' and is_active) = 8
  and (select count(*) from public.notification_types where key in ('nexamon_sale', 'nexamon_graded')) = 2
  and not has_function_privilege('authenticated', 'public.nexamon_run_due(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.nexamon_sell(uuid, uuid, text, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.nexamon_set_value(text, bigint, timestamptz, boolean)', 'execute')
  and not has_table_privilege('authenticated', 'public.nexamon_copies', 'select')
  and has_function_privilege('authenticated', 'public.buy_nexamon_pack(uuid, text)', 'execute'),
  'missions and notification types exist; the internals are closed to clients');
update public.game_config set value = :'nx_cfg'::jsonb where key = 'nexamon';
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after the Nexamon tests');
