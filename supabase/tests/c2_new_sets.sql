-- =============================================================================
-- c2 · Nexamon: Titans Revenge and Yin Yang (ADR-182)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0c2c2c2c-0000-4000-8000-0000000000a1'''
\set b '''0c2c2c2c-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
\set c '''0c2c2c2c-0000-4000-8000-0000000000c1'''
select tests.signup(:a, 'Ns_Anna') is not null and tests.signup(:b, 'Ns_Bruno') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.signup(:c, 'Ns_Clara') is not null as ok \gset
select tests.set_level(:c, 10);
select tests.fund(:c, 1000000000, 'test:c2:c');
select tests.fund(:a, 10000000000, 'test:c2:a');
select tests.fund(:b, 1000000000, 'test:c2:b');
select value as nx_cfg from public.game_config where key = 'nexamon' \gset
select tests.set_cfg('nexamon', '{ai,packsPerHour}',
  '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0, "cosmic_winds": 0, "titans_revenge": 0, "yin_yang": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{packs,perMinute}', '1000');
-- a release time in the future: nothing of the set can be bought or opened, the AI pulls nothing (ADR-182)
select tests.set_cfg('nexamon', '{sets,yin_yang,releaseAt}', to_jsonb((now() + interval '1 hour')::text));
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.buy_nexamon_pack(gen_random_uuid(), 'yin_yang')$$, 'nexamon_set_not_released',
  'buy_nexamon_pack(): refused before the release time');
select tests.throws_key($$select public.buy_nexamon_sealed_pack(gen_random_uuid(), 'yin_yang', 1)$$, 'nexamon_set_not_released',
  'buy_nexamon_sealed_pack(): refused before the release time');
reset role;
select tests.assert(public.nexamon_open_pack('yin_yang', null, 'Karten-Kalle', null, now()) = '[]'::jsonb
  and not public.nexamon_set_released('yin_yang', now()) and public.nexamon_set_released('mystic_energy', now()),
  'an AI pack of an unreleased set pulls nothing');
select tests.set_cfg('nexamon', '{sets,titans_revenge,releaseAt}', 'null');
select tests.set_cfg('nexamon', '{sets,yin_yang,releaseAt}', 'null');
select public.nexamon_sync() is not null as ok \gset

create or replace function tests.ns_ai_open(p_set text) returns jsonb language sql security definer as $$
  select public.nexamon_open_pack(p_set, null, 'Karten-Kalle', null, public.game_now()) $$;
create or replace function tests.ns_slot(p_set text, p_slot integer, p_den integer) returns jsonb language sql security definer as $$
  select jsonb_object_agg(r, n) from (
    select public.nexamon_slot_rarity(p_set, p_slot, (g + 0.5) / p_den) as r, count(*) as n
      from generate_series(0, p_den - 1) g group by 1) x $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. The catalogue: both sets synced, numbered by rarity, start prices in their ranges
-- =============================================================================
select tests.assert(
  (select count(*) from public.nexamon_cards where set_key = 'titans_revenge') = 30
  and (select count(*) from public.nexamon_cards where set_key = 'titans_revenge' and rarity = 'iron' and number between 1 and 15) = 15
  and (select count(*) from public.nexamon_cards where set_key = 'titans_revenge' and rarity = 'titanium' and number between 16 and 22) = 7
  and (select count(*) from public.nexamon_cards where set_key = 'titans_revenge' and rarity = 'diamond' and number between 23 and 26) = 4
  and (select count(*) from public.nexamon_cards where set_key = 'titans_revenge' and rarity = 'uranium' and number between 27 and 30) = 4
  and (select count(*) from public.nexamon_cards where set_key = 'yin_yang') = 110
  and (select count(*) from public.nexamon_cards where set_key = 'yin_yang' and rarity = 'common' and number between 1 and 54) = 54
  and (select count(*) from public.nexamon_cards where set_key = 'yin_yang' and rarity = 'rare' and number between 55 and 84) = 30
  and (select count(*) from public.nexamon_cards where set_key = 'yin_yang' and rarity = 'ultra' and number between 85 and 100) = 16
  and (select count(*) from public.nexamon_cards where set_key = 'yin_yang' and rarity = 'prisma' and number between 101 and 108) = 8
  and (select count(*) from public.nexamon_cards where set_key = 'yin_yang' and rarity = 'legendary' and number between 109 and 110) = 2
  and (select count(*) from public.nexamon_cards) = 461,
  'catalogue: Titans Revenge 15/7/4/4 and Yin Yang 54/30/16/8/2, numbered by rarity, 461 cards in all');
select tests.assert(
  not exists (select 1 from public.nexamon_cards where set_key = 'titans_revenge' and rarity = 'iron'
               and (start_e4 < 281250::bigint * 100 or start_e4 > 675000::bigint * 100))
  and not exists (select 1 from public.nexamon_cards where set_key = 'titans_revenge' and rarity = 'uranium'
                   and (start_e4 < 878629275::bigint * 100 or start_e4 > 3617885250::bigint * 100))
  and not exists (select 1 from public.nexamon_cards where set_key = 'yin_yang' and rarity = 'legendary'
                   and (start_e4 < 100800000::bigint * 100 or start_e4 > 201600000::bigint * 100))
  and public.nexamon_rarity_rank('iron') = 0 and public.nexamon_rarity_rank('titanium') = 2
  and public.nexamon_rarity_rank('diamond') = 3 and public.nexamon_rarity_rank('uranium') = 5,
  'start prices in their ranges (Titans x 1.125, diamond x 1.3 and uranium x 0.918828 since ADR-207), the new rarities rank from game_config');

-- =============================================================================
-- B. The shop: pack prices; the AI stock holds iron and titanium, no diamond, never uranium
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.get_nexamon() as ov \gset
reset role;
select tests.assert(
  (select (s ->> 'pack_price_cents')::bigint = 10000000 and (s ->> 'cards')::integer = 30
     from jsonb_array_elements(:'ov'::jsonb -> 'sets') s where s ->> 'key' = 'titans_revenge')
  and (select (s ->> 'pack_price_cents')::bigint = 200000 and (s ->> 'cards')::integer = 110
     from jsonb_array_elements(:'ov'::jsonb -> 'sets') s where s ->> 'key' = 'yin_yang'),
  'get_nexamon(): Titans Revenge at 100.000 € (30 cards), Yin Yang at 2.000 € (110 cards)');
select tests.assert(
  (select count(*) from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
    where k.rarity = 'iron' and c.ai_owner is not null) = 15 * 6
  and (select count(*) from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
        where k.rarity = 'titanium' and c.ai_owner is not null) = 7 * 2
  and not exists (select 1 from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
                   where k.rarity in ('diamond', 'uranium') and c.ai_owner is not null)
  and (select count(*) from public.nexamon_listings l join public.nexamon_cards k on k.card_key = l.card_key
        where k.set_key = 'titans_revenge' and l.seller_ai is not null) = 15 * 4 + 7 * 2,
  'AI stock: iron 6 and titanium 2 copies per card, listed 4 and 2; no diamond, no uranium');

-- =============================================================================
-- C. A Titans Revenge pack: 100.000 € to the households, five cards, iron by default
-- =============================================================================
select tests.cash(:a) as a0 \gset
select coalesce(sum(balance_cents), 0) as hh0 from public.ledger_accounts where system_key = 'households' \gset
select tests.set_cfg('nexamon', '{packRules,titans_revenge,tiers}',
  '[{"rarity": "uranium", "packs": 1000000000, "min": 1, "max": 1},
    {"rarity": "diamond", "packs": 1000000000, "min": 1, "max": 1},
    {"rarity": "titanium", "packs": 1000000000, "min": 1, "max": 2}]');
select tests.login_as('authenticated', :a);
select public.buy_nexamon_pack(gen_random_uuid(), 'titans_revenge') as t1 \gset
reset role;
select tests.assert(
  tests.cash(:a) = :a0 - 10000000
  and (select sum(balance_cents) from public.ledger_accounts where system_key = 'households') = :hh0 + 10000000
  and jsonb_array_length(:'t1'::jsonb -> 'cards') = 5
  and not exists (select 1 from jsonb_array_elements(:'t1'::jsonb -> 'cards') x where x ->> 'rarity' <> 'iron')
  and (select count(distinct x ->> 'card_key') from jsonb_array_elements(:'t1'::jsonb -> 'cards') x) = 5
  and not exists (select 1 from jsonb_array_elements(:'t1'::jsonb -> 'cards') x where x ->> 'card_key' not like 'tr-%'),
  'a Titans pack costs 100.000 €; without a tier hit it holds five different iron cards');

-- every tier hits: uranium in slot 5, diamond in slot 4, one or two titanium before, iron in front
select tests.set_cfg('nexamon', '{packRules,titans_revenge,tiers}',
  '[{"rarity": "uranium", "packs": 1, "min": 1, "max": 1},
    {"rarity": "diamond", "packs": 1, "min": 1, "max": 1},
    {"rarity": "titanium", "packs": 1, "min": 1, "max": 2}]');
select tests.login_as('authenticated', :a);
select public.buy_nexamon_pack(gen_random_uuid(), 'titans_revenge') as t2 \gset
reset role;
select tests.assert(
  :'t2'::jsonb #>> '{cards,4,rarity}' = 'uranium'
  and :'t2'::jsonb #>> '{cards,3,rarity}' = 'diamond'
  and :'t2'::jsonb #>> '{cards,2,rarity}' = 'titanium'
  and :'t2'::jsonb #>> '{cards,1,rarity}' in ('titanium', 'iron')
  and :'t2'::jsonb #>> '{cards,0,rarity}' = 'iron'
  and (select count(*) from public.feed_items where actor_id = :a and kind = 'nexamon_pull'
        and payload ->> 'rarity' = 'uranium') = 1,
  'all tiers hit: uranium slot 5, diamond slot 4, titanium slot 3 (and 2), iron in front; a uranium pull is news');
select tests.assert(public.feed_item_label('nexamon_pull', '{"rarity": "uranium", "serial": 1}') like 'Uranium-Karte gezogen%'
  and public.feed_item_label('nexamon_pull', '{"rarity": "legendary", "serial": 2}') like 'legendäre Nexamon-Karte gezogen%',
  'the feed names a uranium pull');

-- the AI opens the same pack: the uranium tier is skipped, no error, no uranium in AI hands
select tests.ns_ai_open('titans_revenge') as aip \gset
select tests.assert(
  not exists (select 1 from jsonb_array_elements(:'aip'::jsonb) x where x ->> 'rarity' = 'uranium')
  and :'aip'::jsonb #>> '{4,rarity}' = 'diamond' and :'aip'::jsonb #>> '{0,rarity}' = 'iron'
  and not exists (select 1 from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
                   where k.rarity = 'uranium' and c.ai_owner is not null),
  'an AI Titans pack never holds uranium (the next tier moves up, the rest stays iron), even when every tier hits');
select tests.throws_key(format($$select public.nexamon_mint_copy('tr-027', null, 'Karten-Kalle', 'mint', 'seed', null, now())$$),
  'nexamon_ai_excluded', 'the AI guard refuses a uranium copy for the AI');

-- the real rule: tiers 1/500, 1/50, 1/5 with iron as the base
update public.game_config set value = jsonb_set(value, '{packRules}', :'nx_cfg'::jsonb -> 'packRules') where key = 'nexamon';
select tests.assert(
  (select value #> '{packRules,titans_revenge}' from public.game_config where key = 'nexamon')
    = '{"kind": "tiers", "base": "iron", "tiers": [{"rarity": "uranium", "packs": 500, "min": 1, "max": 1},
        {"rarity": "diamond", "packs": 50, "min": 1, "max": 1}, {"rarity": "titanium", "packs": 5, "min": 1, "max": 2}]}'::jsonb
  and (select value #> '{quickSell,setRarities,titans_revenge}' from public.game_config where key = 'nexamon') = '["iron"]'::jsonb
  and (select value #> '{ai,excludedRarities}' from public.game_config where key = 'nexamon') ? 'uranium',
  'packRules.titans_revenge: iron base, uranium 1/500, diamond 1/50, titanium 1/5 (1-2); iron is bulk; uranium AI-excluded');

-- an iron pull counts as no rare for the missions, a titanium as an ultra
select tests.assert(
  position('nexamon_rarity_rank(r.rarity) >= 1' in pg_get_functiondef('public.buy_nexamon_pack(uuid, text)'::regprocedure)) > 0
  and position('nexamon_rarity_rank(r.rarity) >= 2' in pg_get_functiondef('public.open_nexamon_sealed_pack(uuid, uuid)'::regprocedure)) > 0
  and position('nexamon_rarity_rank(r.rarity) >= 2'
               in pg_get_functiondef('public.nexamon_battle_pull(public.nexamon_battles, uuid, timestamptz)'::regprocedure)) > 0,
  'pack missions count by rarity rank (iron no rare, titanium an ultra)');

-- =============================================================================
-- D. Yin Yang: classic slots, every chance from ultra up x 0.9, the rest to the rares
-- =============================================================================
select tests.ns_slot('yin_yang', 5, 36000) as yy5 \gset
select tests.ns_slot('yin_yang', 4, 36000) as yy4 \gset
select tests.ns_slot('mystic_energy', 5, 3600) as me5 \gset
select tests.assert(
  :'yy5'::jsonb = '{"legendary": 36, "prisma": 405, "ultra": 1350, "rare": 9199, "common": 25010}'::jsonb
  and :'yy4'::jsonb = '{"ultra": 1350, "rare": 9150, "common": 25500}'::jsonb
  and :'me5'::jsonb = '{"legendary": 4, "prisma": 45, "ultra": 150, "rare": 900, "common": 2501}'::jsonb
  and public.nexamon_slot_rarity(null, 5, 0.0005) = public.nexamon_slot_rarity(5, 0.0005),
  'Yin Yang slot table: legendary 36, prisma 405, ultra 1350 of 36 000 (x 0.9), rare 9199; other sets unchanged');
select tests.cash(:b) as b0 \gset
select tests.login_as('authenticated', :b);
select public.buy_nexamon_pack(gen_random_uuid(), 'yin_yang') as y1 \gset
reset role;
select tests.assert(
  tests.cash(:b) = :b0 - 200000
  and jsonb_array_length(:'y1'::jsonb -> 'cards') = 5
  and :'y1'::jsonb #>> '{cards,0,rarity}' = 'common'
  and not exists (select 1 from jsonb_array_elements(:'y1'::jsonb -> 'cards') x where x ->> 'card_key' not like 'yy-%'),
  'a Yin Yang pack costs 2.000 € and holds five Yin Yang cards, commons first');

-- =============================================================================
-- E. Sealed packs, the market filter and bulk work for the new sets
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.buy_nexamon_sealed_pack(gen_random_uuid(), 'yin_yang', 1) as sp \gset
select (public.get_nexamon_sealed_packs() -> 'packs' -> 0 ->> 'id')::uuid as spid \gset
select public.open_nexamon_sealed_pack(gen_random_uuid(), :'spid') as so \gset
select (public.get_nexamon_market('titans_revenge', 'uranium') ->> 'total') as mu \gset
select (public.get_nexamon_market('titans_revenge', 'iron') ->> 'total')::integer as mi \gset
reset role;
select tests.assert(
  :'so'::jsonb ->> 'set' = 'yin_yang' and jsonb_array_length(:'so'::jsonb -> 'cards') = 5
  and :'mu'::integer = 0 and :mi = 15 * 4,
  'a sealed Yin Yang pack opens; the market filters by the new rarities (no uranium, 60 iron offers)');

select (x ->> 'copy_id')::uuid as iron_copy from jsonb_array_elements(:'t1'::jsonb -> 'cards') x limit 1 \gset
select (x ->> 'copy_id')::uuid as ti_copy from jsonb_array_elements(:'t2'::jsonb -> 'cards') x where x ->> 'rarity' = 'titanium' limit 1 \gset
select tests.cash(:a) as a1 \gset
select tests.login_as('authenticated', :a);
select public.bulk_sell_nexamon(gen_random_uuid(), array[:'iron_copy']::uuid[]) as bi \gset
select tests.throws_key(format($$select public.bulk_sell_nexamon(gen_random_uuid(), array[%L]::uuid[])$$, :'ti_copy'),
  'nexamon_not_sellable', 'bulk: titanium is no bulk');
reset role;
select tests.assert((:'bi'::jsonb ->> 'count')::integer = 1 and tests.cash(:a) = :a1::bigint + (:'bi'::jsonb ->> 'total_cents')::bigint,
  'bulk: an iron card of Titans Revenge sells to the game at once');

select tests.assert(
  not exists (select 1 from public.nexamon_collection_completions
               where set_key = 'titans_revenge' and kind = 'type' and reward_cents > 3 * 1000000)
  and position('minCards' in pg_get_functiondef('public.nexamon_bonus_recompute(uuid)'::regprocedure)) > 0,
  'Titans collections: no one-card types, a reward pack counts 10.000 €');

-- =============================================================================
-- F. Several packs at once, and a live opening that goes on (ADR-182)
-- =============================================================================
select tests.cash(:c) as c0 \gset
\set rqm '''0c2c2c2c-0000-4000-8000-0000000000f7'''
select tests.login_as('authenticated', :c);
select public.buy_nexamon_packs(:rqm, 'mystic_energy', 3) as mb \gset
select public.buy_nexamon_packs(:rqm, 'mystic_energy', 3) as mb2 \gset
select tests.throws_key($$select public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 11)$$, 'invalid_argument',
  'buy_nexamon_packs(): at most packs.maxPerBuy');
select tests.throws_key($$select public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 0)$$, 'invalid_argument',
  'buy_nexamon_packs(): at least one');
reset role;
select tests.assert(
  :'mb'::jsonb = :'mb2'::jsonb and jsonb_array_length(:'mb'::jsonb -> 'packs') = 3
  and (:'mb'::jsonb ->> 'price_cents')::bigint = 3 * 20000 and tests.cash(:c) = :c0::bigint - 3 * 20000
  and (select count(distinct x ->> 'pack_id') from jsonb_array_elements(:'mb'::jsonb -> 'packs') x) = 3
  and (select count(*) from public.nexamon_packs where player_id = :c) = 3,
  'buy_nexamon_packs(): three packs, three prices, in order, idempotent');
select tests.assert(
  (select count(*) from public.nexamon_live where player_id = :c and kind = 'pack') = 1
  and (select pack_no = 1 and jsonb_array_length(queue) = 2 and pack_id = (:'mb'::jsonb #>> '{packs,0,pack_id}')::uuid
         from public.nexamon_live where player_id = :c),
  'live: the three packs are one session, two of them waiting');
select (:'mb'::jsonb #>> '{packs,1,pack_id}') as p2 \gset
select id as live_c from public.nexamon_live where player_id = :c \gset
select tests.login_as('authenticated', :c);
select public.nexamon_live_progress(:'p2', 1) as lp \gset
reset role;
select tests.assert(
  :'lp'::jsonb ->> 'live_id' = :'live_c'
  and (select pack_no = 2 and jsonb_array_length(queue) = 1 and pack_id = :'p2'::uuid and progress = 1
         from public.nexamon_live where id = :'live_c'),
  'live: the opener moves on to pack 2, the session (and its viewers) stay, pack 2 is shown');
-- a pack within live.continueSeconds after the end continues it; later it is a new session
update public.nexamon_live set queue = '[]'::jsonb, ends_at = now() - interval '20 seconds',
       started_at = now() - interval '2 minutes' where id = :'live_c';
select tests.login_as('authenticated', :c);
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy') ->> 'pack_id' as p4 \gset
reset role;
select tests.assert(
  (select pack_no = 3 and pack_id = :'p4'::uuid from public.nexamon_live where id = :'live_c')
  and (select count(*) from public.nexamon_live where player_id = :c and kind = 'pack') = 1,
  'live: a pack 20 s after the end continues the session as pack 3');
update public.nexamon_live set ends_at = now() - interval '40 seconds', started_at = now() - interval '2 minutes'
 where id = :'live_c';
select tests.login_as('authenticated', :c);
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy') is not null as ok \gset
reset role;
select tests.assert((select count(*) from public.nexamon_live where player_id = :c and kind = 'pack') = 2,
  'live: a pack 40 s after the end starts a new session');

-- =============================================================================
-- G. The announcement airs in exactly one show (ADR-182)
-- =============================================================================
select value as ns_cfg from public.game_config where key = 'newsShow' \gset
select tests.set_cfg('newsShow', '{announcements}', '[{"at": "2030-01-01T10:00:00Z", "releaseAt": "2030-01-01T10:30:00Z",
  "sets": [{"set": "titans_revenge", "cardKey": "tr-027", "mood": "shocked", "headline": "Neu: Titans", "text": "Ab {time} Uhr!"},
           {"set": "yin_yang", "cardKey": "yy-109", "mood": "proud", "headline": "Neu: Yin Yang", "text": "Auch ab {time} Uhr."}]}]');
select tests.assert(
  jsonb_array_length(public.news_show_announcements('2030-01-01 08:50:00+00')) = 0
  and jsonb_array_length(public.news_show_announcements('2030-01-01 09:20:00+00')) = 0
  and not exists (select 1 from public.news_announcements_aired where announcement_at = '2030-01-01 10:00:00+00'),
  'announcement: no show before its hour');
select public.news_show_announcements('2030-01-01 09:50:00+00') as an1 \gset
select tests.assert(
  jsonb_array_length(:'an1'::jsonb) = 2 and :'an1'::jsonb #>> '{0,kind}' = 'release'
  and :'an1'::jsonb #>> '{0,text}' = 'Ab 11:30 Uhr!' and :'an1'::jsonb #>> '{0,nexamon,card_key}' = 'tr-027'
  and :'an1'::jsonb #>> '{1,nexamon,set}' = 'yin_yang'
  -- a rebuilt draft of the same show gets it again, as its replacement
  and jsonb_array_length(public.news_show_announcements('2030-01-01 10:05:00+00')) = 2
  -- every later show never
  and jsonb_array_length(public.news_show_announcements('2030-01-01 10:35:00+00')) = 0
  and jsonb_array_length(public.news_show_announcements('2030-01-01 10:50:00+00')) = 0
  and jsonb_array_length(public.news_show_announcements('2030-01-02 09:50:00+00')) = 0
  and (select slot from public.news_announcements_aired where announcement_at = '2030-01-01 10:00:00+00')
      = '2030-01-01 10:00:00+00',
  'announcement: exactly one show slot, its time in Berlin, never again later');
select public.news_show_build('2030-01-01 09:50:00+00') as nsb \gset
select tests.assert(:'nsb'::jsonb #>> '{0,kind}' = 'release' and :'nsb'::jsonb #>> '{1,kind}' = 'release',
  'news_show_build(): the announcement opens the show');
update public.game_config set value = :'ns_cfg'::jsonb where key = 'newsShow';

update public.game_config set value = :'nx_cfg'::jsonb where key = 'nexamon';
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after Titans Revenge and Yin Yang');
