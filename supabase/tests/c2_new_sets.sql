-- =============================================================================
-- c2 · Nexamon: Titans Revenge and Yin Yang (ADR-182)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0c2c2c2c-0000-4000-8000-0000000000a1'''
\set b '''0c2c2c2c-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Ns_Anna') is not null and tests.signup(:b, 'Ns_Bruno') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.fund(:a, 10000000000, 'test:c2:a');
select tests.fund(:b, 1000000000, 'test:c2:b');
select value as nx_cfg from public.game_config where key = 'nexamon' \gset
select tests.set_cfg('nexamon', '{ai,packsPerHour}',
  '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0, "cosmic_winds": 0, "titans_revenge": 0, "yin_yang": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{packs,perMinute}', '1000');
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
                   and (start_e4 < 956250000::bigint * 100 or start_e4 > 3937500000::bigint * 100))
  and not exists (select 1 from public.nexamon_cards where set_key = 'yin_yang' and rarity = 'legendary'
                   and (start_e4 < 100800000::bigint * 100 or start_e4 > 201600000::bigint * 100))
  and public.nexamon_rarity_rank('iron') = 0 and public.nexamon_rarity_rank('titanium') = 2
  and public.nexamon_rarity_rank('diamond') = 3 and public.nexamon_rarity_rank('uranium') = 5,
  'start prices in their ranges (Titans x 1.125), the new rarities rank from game_config');

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
  and :'aip'::jsonb #>> '{4,rarity}' = 'iron' and :'aip'::jsonb #>> '{3,rarity}' = 'diamond'
  and not exists (select 1 from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
                   where k.rarity = 'uranium' and c.ai_owner is not null),
  'an AI Titans pack never holds uranium (its slot stays iron), even when every tier hits');
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

update public.game_config set value = :'nx_cfg'::jsonb where key = 'nexamon';
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after Titans Revenge and Yin Yang');
