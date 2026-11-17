-- =============================================================================
-- d4 · Nexamon: instant sell of fresh pulls (ADR-196): 90 % of the value incl. condition, rounded half-even, only
--      own raw pack copies within instantSell.windowSeconds that were never listed or sold; One of Ones go to the
--      game's vault; idempotent; money invariant. The bulk sale now pays 80 % (20 % fee).
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0d4d4d4d-0000-4000-8000-0000000000a1'''
\set b '''0d4d4d4d-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Is_Anna') is not null and tests.signup(:b, 'Is_Bruno') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0, "cosmic_winds": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select public.nexamon_sync() is not null as ok \gset

select tests.assert(
  (value #>> '{instantSell,payoutBps}')::integer = 9000 and (value #>> '{instantSell,windowSeconds}')::integer > 0
  and (value #>> '{quickSell,bps}')::integer = 8000,
  'd4: config instantSell.payoutBps 9000, quickSell.bps 8000 (20 % bulk fee)')
  from public.game_config where key = 'nexamon';

select card_key as cr from public.nexamon_cards where set_key = 'mystic_energy' and rarity = 'rare' order by number limit 1 \gset
select card_key as cc from public.nexamon_cards where set_key = 'mystic_energy' and rarity = 'common' order by number limit 1 \gset
-- 12,45 € (mint factor 100 %) x 0.9 = 1 120,5 cents -> 1 120 (half-even, not 1 121)
update public.nexamon_cards set value_e4 = 124500 where card_key = :'cr';

select public.nexamon_mint_copy(:'cr', :a, null, 'mint', 'pack', gen_random_uuid(), public.game_now()) as f1 \gset
select public.nexamon_mint_copy(:'cc', :a, null, 'good', 'pack', gen_random_uuid(), public.game_now()) as f2 \gset
select public.nexamon_mint_copy(:'cc', :a, null, 'mint', 'pack', gen_random_uuid(),
  public.game_now() - make_interval(secs => 60 + (select (value #>> '{instantSell,windowSeconds}')::integer from public.game_config where key = 'nexamon'))) as old \gset
select public.nexamon_mint_copy(:'cc', :b, null, 'mint', 'pack', gen_random_uuid(), public.game_now()) as theirs \gset
select public.nexamon_mint_copy(:'cc', :a, null, 'mint', 'pack', gen_random_uuid(), public.game_now()) as lst \gset
-- a One of One fresh from a pack: earlier tests may have pulled every one already, so a free card is minted, else
-- the existing copy is handed to :a as a fresh pull
select k.card_key as oo, (k.population = 0) as oo_free from public.nexamon_cards k where k.rarity = 'one_of_one'
 order by k.population, k.card_key limit 1 \gset
select case when :'oo_free'::boolean
            then public.nexamon_mint_copy(:'oo', :a, null, 'mint', 'pack', gen_random_uuid(), public.game_now())
            else (select c.id from public.nexamon_copies c where c.card_key = :'oo' limit 1) end as one \gset
delete from public.nexamon_listings where copy_id = :'one';
delete from public.nexamon_sales where copy_id = :'one';
update public.nexamon_copies set owner_id = :a, ai_owner = null, grade = null, graded_at = null, grading_until = null,
       source = 'pack', created_at = public.game_now(), acquired_at = public.game_now() where id = :'one';

select sum(public.div_round_half_even(public.nexamon_copy_value_cents(k.value_e4, c.condition, null)::numeric * 9000, 10000))::bigint as exp1
  from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key where c.id = :'f1' \gset
select tests.assert(:exp1 = 1120, 'd4: 90 % of 12,45 € rounds half-even to 11,20 € ' || :exp1);
select public.nexamon_copy_value_cents(k.value_e4, 'good', null) as v2 from public.nexamon_cards k where k.card_key = :'cc' \gset

select tests.cash(:a) as cash0 \gset
select tests.households() as hh0 \gset
\set rq '''0d4d4d4d-0000-4000-8000-0000000000f1'''
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'lst', 100000) is not null as ok \gset
select tests.throws_key(format($$select public.instant_sell_nexamon(gen_random_uuid(), array[%L]::uuid[])$$, :'old'),
  'nexamon_not_sellable', 'instant_sell_nexamon(): not after the window');
select tests.throws_key(format($$select public.instant_sell_nexamon(gen_random_uuid(), array[%L]::uuid[])$$, :'theirs'),
  'nexamon_not_owner', 'instant_sell_nexamon(): not another player''s copy');
select tests.throws_key(format($$select public.instant_sell_nexamon(gen_random_uuid(), array[%L]::uuid[])$$, :'lst'),
  'nexamon_listed', 'instant_sell_nexamon(): not a listed copy');
select tests.throws_key(format($$select public.instant_sell_nexamon(gen_random_uuid(), array[%L, %L]::uuid[])$$, :'f2', :'old'),
  'nexamon_not_sellable', 'instant_sell_nexamon(): one bad copy fails the whole call');
select public.instant_sell_nexamon(:rq, array[:'f1', :'f2']::uuid[]) as s1 \gset
select public.instant_sell_nexamon(:rq, array[:'f1', :'f2']::uuid[]) as s2 \gset
reset role;
select tests.assert(:'s1'::jsonb = :'s2'::jsonb and (:'s1'::jsonb ->> 'count')::integer = 2
  and (select (e ->> 'price_cents')::bigint from jsonb_array_elements(:'s1'::jsonb -> 'sold') e where e ->> 'copy_id' = :'f1') = 1120
  and (select (e ->> 'price_cents')::bigint from jsonb_array_elements(:'s1'::jsonb -> 'sold') e where e ->> 'copy_id' = :'f2')
      = public.div_round_half_even(:v2::numeric * 9000, 10000),
  'instant_sell_nexamon(): 90 % per copy incl. condition, idempotent ' || :'s1');
select tests.assert(tests.cash(:a) = :cash0::bigint + (:'s1'::jsonb ->> 'total_cents')::bigint
  and tests.households() = :hh0::bigint - (:'s1'::jsonb ->> 'total_cents')::bigint
  and not exists (select 1 from public.nexamon_copies where id in (:'f1', :'f2') and owner_id is not null)
  and (select count(*) from public.nexamon_sales where copy_id in (:'f1', :'f2') and kind = 'quick' and not counted) = 2
  and (select value_e4 from public.nexamon_cards where card_key = :'cr') < 124500,
  'instant_sell_nexamon(): paid once from the households, copies gone to the game, value dips like the bulk sale');

-- a sold copy bought back is no fresh pull any more
update public.nexamon_copies set owner_id = :a, ai_owner = null where id = :'f1';
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.instant_sell_nexamon(gen_random_uuid(), array[%L]::uuid[])$$, :'f1'),
  'nexamon_not_sellable', 'instant_sell_nexamon(): not a copy that was sold before');
-- One of One: allowed, goes to the game's vault (the AI may not hold it)
select public.instant_sell_nexamon(gen_random_uuid(), array[:'one']::uuid[]) as s3 \gset
reset role;
select tests.assert((:'s3'::jsonb ->> 'count')::integer = 1
  and (select ai_owner from public.nexamon_copies where id = :'one') = 'NEXA-Tresor'
  and not exists (select 1 from public.nexamon_listings where copy_id = :'one'),
  'instant_sell_nexamon(): a One of One goes to the game''s vault, never listed');
select public.nexamon_ai_reset(public.game_now() + interval '400 days') is not null as ok \gset
select tests.assert(exists (select 1 from public.nexamon_copies where id = :'one'), 'nexamon_ai_reset(): never retires the vault');

-- a won Pack Battle: the winner owns the other player's fresh pulls and may sell them
select public.nexamon_mint_copy(:'cc', :b, null, 'mint', 'pack', gen_random_uuid(), public.game_now()) as bw \gset
update public.nexamon_copies set owner_id = :a, acquired_at = public.game_now() where id = :'bw';
select tests.login_as('authenticated', :a);
select (public.instant_sell_nexamon(gen_random_uuid(), array[:'bw']::uuid[]) ->> 'count')::integer as n4 \gset
reset role;
select tests.assert(:n4 = 1, 'instant_sell_nexamon(): the battle winner sells the won pulls');

-- the bulk sale now pays 80 %
select tests.cash(:a) as cash1 \gset
select floor(public.nexamon_copy_value_cents(k.value_e4, c.condition, null)::numeric * 8000 / 10000)::bigint as bk
  from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key where c.id = :'old' \gset
select tests.login_as('authenticated', :a);
select public.bulk_sell_nexamon(gen_random_uuid(), array[:'old']::uuid[]) as bs \gset
reset role;
select tests.assert((:'bs'::jsonb ->> 'total_cents')::bigint = :bk and tests.cash(:a) = :cash1::bigint + :bk,
  'bulk_sell_nexamon(): value minus 20 % ' || :bk);

select tests.assert(tests.money_invariant() = 'ok', 'd4: money invariant holds after instant sells');
