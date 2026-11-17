-- =============================================================================
-- d3 · AI collectors buy expensive cards at market value too (ADR-195)
-- =============================================================================
-- 1. A 1.5 M EUR listing at the copy's value sells within a few minute runs, despite a tiny daily budget.
-- 2. A listing below the value sells on the next run.
-- 3. +10 %: a popular card sells sometimes over many trials, an unpopular one rarely.
-- 4. +20 %: never, not even in many runs. Money invariant holds.
\set QUIET 1
set client_min_messages = notice;

\set p '''0d3d3d30-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:p, 'Rich_Seller3') is not null as ok \gset
select tests.set_level(:p, 10);
select value as nx_cfg from public.game_config where key = 'nexamon' \gset
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0, "cosmic_winds": 0, "titans_revenge": 0, "yin_yang": 0}');
-- a budget far below the price: buys at the value must ignore it
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '1');
select public.nexamon_sync() is not null as ok \gset

select card_key as hot from public.nexamon_cards
 where set_key = 'mystic_energy' and rarity = 'legendary' order by population, card_key limit 1 \gset
select card_key as cold from public.nexamon_cards
 where set_key = 'mystic_energy' and rarity = 'common' order by card_key desc limit 1 \gset
-- an expensive card: a mint copy is worth about 1.5 M EUR
update public.nexamon_cards
   set value_e4 = public.div_round_half_even(150000000::numeric * 1000000, public.nexamon_copy_factor_bps('mint', null))
 where card_key = :'hot';

select public.nexamon_mint_copy(:'hot', :p, null, 'mint', 'pack', null, public.game_now()) as c1 \gset
select public.nexamon_mint_copy(:'hot', :p, null, 'mint', 'pack', null, public.game_now()) as c2 \gset
select public.nexamon_mint_copy(:'hot', :p, null, 'mint', 'pack', null, public.game_now()) as c3 \gset
select public.nexamon_copy_value_cents(k.value_e4, 'mint', null, k.card_key) as v from public.nexamon_cards k where k.card_key = :'hot' \gset
select tests.assert(:v::bigint >= 140000000, 'a mint copy is worth about 1.5 M EUR: ' || :v);
select tests.login_as('authenticated', :p);
select public.list_nexamon_card(gen_random_uuid(), :'c1', :v::bigint) is not null as ok \gset
select public.list_nexamon_card(gen_random_uuid(), :'c3', (:v::bigint * 12 / 10)) is not null as ok \gset
reset role;

-- 1. at the value: sold within a few runs
select public.nexamon_run_due(public.game_now()) is not null as ok \gset
select public.nexamon_run_due(public.game_now() + interval '1 minute') is not null as ok \gset
select tests.assert(
  (select ai_owner is not null from public.nexamon_copies where id = :'c1')
  and exists (select 1 from public.nexamon_sales where copy_id = :'c1' and kind = 'ai_buy' and price_cents = :v::bigint),
  'a 1.5 M EUR listing at its value sells to the AI within a few minutes, beyond the daily budget');
select tests.assert((select count(*) from public.nexamon_sales where copy_id = :'c1' and kind = 'ai_buy') = 1,
  'exactly one AI buy of the listing (no double buy)');

-- 2. below the value: the next run buys it
select public.nexamon_copy_value_cents(k.value_e4, 'mint', null, k.card_key) as v2 from public.nexamon_cards k where k.card_key = :'hot' \gset
select tests.login_as('authenticated', :p);
select public.list_nexamon_card(gen_random_uuid(), :'c2', (:v2::bigint * 9 / 10)) is not null as ok \gset
reset role;
select public.nexamon_run_due(public.game_now() + interval '2 minutes') is not null as ok \gset
select tests.assert((select ai_owner is not null from public.nexamon_copies where id = :'c2'),
  'a listing below its value sells on the next run');

-- 3. +10 %: chance per minute; popular sometimes, unpopular rarely
update public.nexamon_cards set population = 1000000 where card_key = :'cold';
select public.nexamon_ai_buy_chance_bps(110000, 100000, 'mint', null, rarity, population) as ch_hot
  from public.nexamon_cards where card_key = :'hot' \gset
select public.nexamon_ai_buy_chance_bps(110000, 100000, 'mint', null, rarity, population) as ch_cold
  from public.nexamon_cards where card_key = :'cold' \gset
select count(*) filter (where random() * 10000 < :ch_hot) as hits_hot,
       count(*) filter (where random() * 10000 < :ch_cold) as hits_cold
  from generate_series(1, 20000) \gset
select tests.assert(:ch_hot > 0 and :ch_hot < 10000 and :hits_hot > 0 and :hits_hot < 2000,
  '+10 % on a popular card: sold sometimes (' || :hits_hot || ' of 20 000 minutes, ' || :ch_hot || ' bps)');
select tests.assert(:ch_cold > 0 and :hits_cold * 4 < :hits_hot,
  '+10 % on an unpopular card: rarely (' || :hits_cold || ' of 20 000 minutes, ' || :ch_cold || ' bps)');

-- 4. +20 %: never, in any run
select tests.assert(
  public.nexamon_ai_buy_chance_bps(120000, 100000, 'mint', 11, 'legendary', 0) = 0
  and public.nexamon_ai_buy_chance_bps(115001, 100000, 'mint', 10, 'legendary', 0) = 0,
  'never above +15 %, not even a Black Label');
select count(*) as n from generate_series(3, 40) i,
  lateral public.nexamon_run_due(public.game_now() + make_interval(mins => i)) \gset
select tests.assert(
  (select ai_owner is null from public.nexamon_copies where id = :'c3')
  and exists (select 1 from public.nexamon_listings where copy_id = :'c3'),
  'a listing 20 % above its value never sells');

select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', :'nx_cfg'::jsonb #> '{ai,dailyBudgetPacks}');
select tests.set_cfg('nexamon', '{ai,packsPerHour}', :'nx_cfg'::jsonb #> '{ai,packsPerHour}');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant: ' || tests.money_invariant());
