-- =============================================================================
-- f8 · The AI buys the most expensive cards at market value too (ADR-195, Nachtrag)
-- =============================================================================
-- 1. A One of One listed at its value is bought within a few runs and goes to the vault "NEXA-Tresor".
-- 2. A uranium card at its value is bought (vault); a uranium card 10 % above its value never.
-- 3. A 30 M EUR Black Label slab at its value is bought although the households' cash is low: the treasury tops up
--    exactly the shortfall (ledger 'transfer', sum 0). Below the treasury floor it waits (logged) and is bought once
--    the floor allows it.
-- 4. The vault keeps its copies through an AI reset, the AI restock never lists them; the vault relists now and then
--    at value + 15..25 %, the AI never buys that listing, it is withdrawn after vault.listHours.
-- 5. Above +15 % never. Money invariant holds.
\set QUIET 1
set client_min_messages = notice;

\set p '''0f8d8d8d-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:p, 'Top_Seller8') is not null as ok \gset
select tests.set_level(:p, 10);
select value as nx_cfg from public.game_config where key = 'nexamon' \gset
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0, "cosmic_winds": 0, "titans_revenge": 0, "yin_yang": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '100');
select tests.set_cfg('nexamon', '{ai,buyChanceMinShareBps}', '400');
select tests.set_cfg('nexamon', '{vault,relistChancePerDayBps}', '0');
select public.nexamon_sync() is not null as ok \gset
select tests.assert(
  (:'nx_cfg'::jsonb #>> '{ai,treasuryFloorCents}')::bigint > 0
  and (:'nx_cfg'::jsonb #>> '{vault,premiumMinBps}')::integer = 1500
  and (:'nx_cfg'::jsonb #>> '{vault,premiumMaxBps}')::integer = 2500
  and :'nx_cfg'::jsonb #>> '{instantSell,vaultOwner}' = 'NEXA-Tresor',
  'f8: config ai.treasuryFloorCents, vault premium 15..25 %, vault owner NEXA-Tresor');
create or replace function tests.f8_value(p_copy uuid) returns bigint language sql as $$
  select public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade, k.card_key)
    from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key where c.id = p_copy $$;
create or replace function tests.f8_runs(p_from integer, p_to integer) returns integer language sql as $$
  select count(*)::integer from generate_series(p_from, p_to) i,
    lateral public.nexamon_run_due(public.game_now() + make_interval(mins => i)) $$;
grant execute on all functions in schema tests to public;

-- the cards: a One of One (minted if still free, else the existing copy handed to the seller), two uranium copies,
-- a legendary Black Label slab worth 30 M EUR
select k.card_key as oo, (k.population = 0) as oo_free from public.nexamon_cards k where k.rarity = 'one_of_one'
 order by k.population, k.card_key limit 1 \gset
select case when :'oo_free'::boolean
            then public.nexamon_mint_copy(:'oo', :p, null, 'mint', 'pack', gen_random_uuid(), public.game_now())
            else (select c.id from public.nexamon_copies c where c.card_key = :'oo' limit 1) end as one \gset
delete from public.nexamon_listings where copy_id = :'one';
update public.nexamon_copies set owner_id = :p, ai_owner = null, grading_until = null, acquired_at = public.game_now()
 where id = :'one';
select card_key as ur from public.nexamon_cards where rarity = 'uranium' order by card_key limit 1 \gset
select public.nexamon_mint_copy(:'ur', :p, null, 'mint', 'pack', gen_random_uuid(), public.game_now()) as u1 \gset
select public.nexamon_mint_copy(:'ur', :p, null, 'good', 'pack', gen_random_uuid(), public.game_now()) as u2 \gset
select card_key as lg from public.nexamon_cards
 where set_key = 'super_apex' and rarity = 'legendary' order by card_key limit 1 \gset
select public.nexamon_mint_copy(:'lg', :p, null, 'mint', 'pack', gen_random_uuid(), public.game_now()) as bl \gset
update public.nexamon_copies set grade = 11, graded_at = public.game_now() where id = :'bl';
update public.nexamon_cards
   set value_e4 = public.div_round_half_even(3000000000::numeric * 1000000, public.nexamon_copy_factor_bps('mint', 11, :'lg'))
 where card_key = :'lg';
-- no supply and demand step may move these values between the listing and the buy
update public.nexamon_cards set pressure_at = public.game_now() + interval '30 days' where card_key in (:'oo', :'ur', :'lg');
select tests.f8_value(:'bl') as vbl \gset
select tests.assert(:vbl::bigint between 2900000000 and 3100000000, 'f8: the Black Label slab is worth about 30 M EUR: ' || :vbl);

-- 1. + 2. One of One and uranium at their value, uranium 10 % above
select tests.f8_value(:'one') as voo \gset
select tests.f8_value(:'u1') as vu1 \gset
select tests.f8_value(:'u2') as vu2 \gset
select tests.login_as('authenticated', :p);
select public.list_nexamon_card(gen_random_uuid(), :'one', :voo::bigint) is not null as ok \gset
select public.list_nexamon_card(gen_random_uuid(), :'u1', :vu1::bigint) is not null as ok \gset
select public.list_nexamon_card(gen_random_uuid(), :'u2', (:vu2::bigint * 11 / 10)) is not null as ok \gset
reset role;
select tests.cash(:p) as cash0 \gset
select tests.f8_runs(0, 2) as n \gset
select tests.assert(
  (select ai_owner from public.nexamon_copies where id = :'one') = 'NEXA-Tresor'
  and (select owner_id from public.nexamon_copies where id = :'one') is null
  and exists (select 1 from public.nexamon_sales where copy_id = :'one' and kind = 'ai_buy' and price_cents = :voo::bigint
                                                    and buyer_ai = 'NEXA-Tresor'),
  'f8: a One of One at its value is bought within 3 runs, by the vault NEXA-Tresor');
select tests.assert(
  (select ai_owner from public.nexamon_copies where id = :'u1') = 'NEXA-Tresor',
  'f8: a uranium card at its value is bought by the vault');
select tests.assert(tests.cash(:p) > :cash0::bigint, 'f8: the seller is paid');

-- 3. the 30 M EUR slab with the households nearly empty: the treasury tops up the shortfall
select tests.households() as hh_before \gset
select public.ledger_transfer(public.ledger_system_account('households'), public.ledger_system_account('treasury'),
  :hh_before::bigint - 100000000, 'transfer', 'test: households nearly empty', null, null, 'test:f8:drain', null, '{}'::jsonb)
  is not null as ok \gset
select tests.assert(tests.households() = 100000000 and tests.treasury() > 3000000000 + (:'nx_cfg'::jsonb #>> '{ai,treasuryFloorCents}')::bigint,
  'f8: households hold 1 M EUR, the treasury enough above its floor');
-- first: a floor that the treasury cannot keep -> logged, not bought, retried
select tests.set_cfg('nexamon', '{ai,treasuryFloorCents}', to_jsonb(tests.treasury()));
select tests.f8_value(:'bl') as vbl \gset
select tests.login_as('authenticated', :p);
select public.list_nexamon_card(gen_random_uuid(), :'bl', :vbl::bigint) is not null as ok \gset
reset role;
select public.nexamon_run_due(public.game_now() + interval '3 minutes') as r1 \gset
select tests.assert((:'r1'::jsonb ->> 'ai_unaffordable')::integer >= 1
  and (select owner_id from public.nexamon_copies where id = :'bl') = :p
  and exists (select 1 from public.nexamon_listings where copy_id = :'bl'),
  'f8: not affordable below the treasury floor: reported (ai_unaffordable), the listing stays: ' || :'r1');
select tests.set_cfg('nexamon', '{ai,treasuryFloorCents}', :'nx_cfg'::jsonb #> '{ai,treasuryFloorCents}');
select tests.treasury() as tr0 \gset
select tests.households() as hh0 \gset
select tests.cash(:p) as cash1 \gset
select public.nexamon_run_due(public.game_now() + interval '4 minutes') as r2 \gset
select tests.assert((select ai_owner from public.nexamon_copies where id = :'bl') is not null
  and (select ai_owner from public.nexamon_copies where id = :'bl') <> 'NEXA-Tresor'
  and exists (select 1 from public.nexamon_sales where copy_id = :'bl' and kind = 'ai_buy' and price_cents = :vbl::bigint),
  'f8: the 30 M EUR Black Label slab at its value is bought on the next run (AI collector, not the vault): ' || :'r2');
select tests.assert(:tr0::bigint - tests.treasury() = :vbl::bigint - :hh0::bigint
  and (:'r2'::jsonb ->> 'ai_funded_cents')::bigint = :vbl::bigint - :hh0::bigint,
  'f8: the treasury paid exactly the shortfall: ' || (:tr0::bigint - tests.treasury()));
select tests.assert(exists (
    select 1 from public.ledger_transactions t
     where t.kind = 'transfer' and t.idempotency_key like 'nexamon:ai:fund:%'
       and (select sum(e.amount_cents) from public.ledger_entries e where e.transaction_id = t.id) = 0),
  'f8: the top-up is one ledger transfer with sum 0');
select tests.assert(tests.cash(:p) - :cash1::bigint
    = :vbl::bigint - floor(:vbl::numeric * (:'nx_cfg'::jsonb #>> '{market,feeBps}')::integer / 10000)::bigint,
  'f8: the seller gets the price minus the market fee');
-- give the households their cash back
select public.ledger_transfer(public.ledger_system_account('treasury'), public.ledger_system_account('households'),
  :hh_before::bigint - 100000000, 'transfer', 'test: households refilled', null, null, 'test:f8:refill', null, '{}'::jsonb)
  is not null as ok \gset

-- 4. the vault keeps its copies; the AI restock never lists them; the vault relists now and then
update public.nexamon_copies set grade = 10, graded_at = public.game_now(), ai_hold_until = public.game_now() - interval '1 hour'
 where id = :'u1';
select public.nexamon_ai_restock(:'ur', public.game_now() + interval '5 minutes') as n \gset
select tests.assert(not exists (select 1 from public.nexamon_listings where copy_id in (:'one', :'u1')),
  'f8: the AI restock never lists a vault copy, not even a slab whose hold has passed');
update public.nexamon_meta set ai_reset_at = null where id;
select public.nexamon_ai_reset(public.game_now() + interval '5 minutes') is not null as ok \gset
select tests.assert(exists (select 1 from public.nexamon_copies where id = :'one' and ai_owner = 'NEXA-Tresor')
  and exists (select 1 from public.nexamon_copies where id = :'u1' and ai_owner = 'NEXA-Tresor'),
  'f8: an AI reset keeps the vault''s copies');
-- a certain relist (chance per day 1440 x 100 %), no hold
select tests.set_cfg('nexamon', '{vault,relistChancePerDayBps}', '14400000');
select tests.set_cfg('nexamon', '{vault,minHoldHours}', '0');
select tests.set_cfg('nexamon', '{vault,maxListed}', '1');
select public.nexamon_run_due(public.game_now() + interval '6 minutes') as r3 \gset
select tests.assert((:'r3'::jsonb ->> 'vault_listed')::integer = 1
  and (select count(*) from public.nexamon_listings where seller_ai = 'NEXA-Tresor') = 1,
  'f8: the vault relists one copy (vault.maxListed): ' || :'r3');
select l.copy_id as vc, l.price_cents as vp, tests.f8_value(l.copy_id) as vv
  from public.nexamon_listings l where l.seller_ai = 'NEXA-Tresor' \gset
select tests.assert(:vp::bigint >= floor(:vv::numeric * 11500 / 10000) and :vp::bigint <= floor(:vv::numeric * 12500 / 10000),
  'f8: the vault asks value + 15..25 %: ' || :vp || ' for ' || :vv);
update public.nexamon_meta set ai_reset_at = null where id;
select public.nexamon_ai_reset(public.game_now() + interval '7 minutes') is not null as ok \gset
select tests.assert(exists (select 1 from public.nexamon_listings where copy_id = :'vc' and seller_ai = 'NEXA-Tresor'),
  'f8: an AI reset keeps the vault''s listing');
select tests.f8_runs(8, 12) as n \gset
select tests.assert((select ai_owner from public.nexamon_copies where id = :'vc') = 'NEXA-Tresor',
  'f8: the AI never buys the vault''s listing');
select tests.set_cfg('nexamon', '{vault,relistChancePerDayBps}', '0');
select public.nexamon_run_due(public.game_now()
  + make_interval(hours => (:'nx_cfg'::jsonb #>> '{vault,listHours}')::integer, mins => 13)) is not null as ok \gset
select tests.assert(not exists (select 1 from public.nexamon_listings where seller_ai = 'NEXA-Tresor'),
  'f8: an unsold vault listing is withdrawn after vault.listHours');

-- 5. above the value: the vault rarities never, others never above +15 %
select tests.assert(
  public.nexamon_ai_buy_chance_bps(100001, 100000, 'mint', null, 'one_of_one', 1) = 0
  and public.nexamon_ai_buy_chance_bps(105000, 100000, 'mint', 10, 'uranium', 1) = 0
  and public.nexamon_ai_buy_chance_bps(100000, 100000, 'mint', 11, 'one_of_one', 1) = 10000
  and public.nexamon_ai_buy_chance_bps(115001, 100000, 'mint', 11, 'legendary', 0) = 0,
  'f8: above the value never for One of One and uranium; never above +15 % for any card');
select tests.f8_runs(14, 40) as n \gset
select tests.assert((select owner_id from public.nexamon_copies where id = :'u2') = :p
  and exists (select 1 from public.nexamon_listings where copy_id = :'u2'),
  'f8: a uranium card 10 % above its value never sells to the AI');

select tests.set_cfg('nexamon', '{ai,packsPerHour}', :'nx_cfg'::jsonb #> '{ai,packsPerHour}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', :'nx_cfg'::jsonb #> '{ai,buyChanceBps}');
select tests.set_cfg('nexamon', '{ai,buyChanceMinShareBps}', :'nx_cfg'::jsonb #> '{ai,buyChanceMinShareBps}');
select tests.set_cfg('nexamon', '{vault}', :'nx_cfg'::jsonb #> '{vault}');
select tests.assert(tests.money_invariant() = 'ok', 'f8: money invariant: ' || tests.money_invariant());
