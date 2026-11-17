-- =============================================================================
-- c1 · Graded copies never leave circulation: the AI holds a bought slab and relists it (ADR-165)
-- =============================================================================
-- 1. An AI collector buys a player's slab; it becomes AI stock with a hold time within ai.slabHold and is not listed.
-- 2. The 6-hour reset (even with a stock cap of 0) never deletes it; before its hold time it stays unlisted.
-- 3. After the hold time the reset relists it at the AI's ask on its current value; population and money hold.
\set QUIET 1
set client_min_messages = notice;

\set p '''0c1c1c10-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:p, 'Sammy_Slab1') is not null as ok \gset
select tests.set_level(:p, 10);
select value as nx_cfg from public.game_config where key = 'nexamon' \gset
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0, "cosmic_winds": 0}');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '1000000');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '3000');
select public.nexamon_sync() is not null as ok \gset

select public.nexamon_mint_copy('me-010', :p, null, 'mint', 'pack', null, public.game_now()) as s1 \gset
update public.nexamon_copies set grade = 9.5, graded_at = public.game_now() where id = :'s1';
select population as pop0 from public.nexamon_cards where card_key = 'me-010' \gset
select count(*) as slabs0 from public.nexamon_copies where grade is not null \gset

-- 1. listed far below its value, an AI collector buys it on the next run
select tests.login_as('authenticated', :p);
select public.list_nexamon_card(gen_random_uuid(), :'s1', 100) is not null as ok \gset
reset role;
select public.nexamon_run_due() is not null as ok \gset
select ai_owner as holder, ai_hold_until as hold, acquired_at as got from public.nexamon_copies where id = :'s1' \gset
select tests.assert(
  :'holder' <> '' and :'hold'::timestamptz >= :'got'::timestamptz + make_interval(hours => (:'nx_cfg'::jsonb #>> '{ai,slabHold,minHours}')::integer)
  and :'hold'::timestamptz <= :'got'::timestamptz + make_interval(hours => (:'nx_cfg'::jsonb #>> '{ai,slabHold,maxHours}')::integer)
  and not exists (select 1 from public.nexamon_listings where copy_id = :'s1'),
  'an AI collector buys the slab; the AI holds it within ai.slabHold and does not list it yet: ' || :'hold');

-- 2. the reset retires raw stock above the cap, never a slab; before its hold time the slab stays unlisted
select tests.set_cfg('nexamon', '{ai,stockCap,common}', '0');
update public.nexamon_meta set ai_reset_at = null;
select public.nexamon_ai_reset(:'hold'::timestamptz - interval '1 minute') as rs1 \gset
select tests.assert(
  exists (select 1 from public.nexamon_copies where id = :'s1' and ai_owner = :'holder' and grade = 9.5)
  and not exists (select 1 from public.nexamon_listings where copy_id = :'s1')
  and not exists (select 1 from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
                   where k.rarity = 'common' and c.ai_owner is not null and c.grade is null),
  'nexamon_ai_reset(): raw stock above the cap is retired, the held slab stays and stays unlisted ' || :'rs1');

-- 3. after its hold time the reset relists it at the AI's ask on its current value
update public.nexamon_meta set ai_reset_at = null;
select public.nexamon_ai_reset(:'hold'::timestamptz + interval '1 minute') as rs2 \gset
select tests.assert(
  (select l.price_cents = public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(k.value_e4, 'mint', 9.5, k.card_key))
          and l.seller_ai = :'holder'
     from public.nexamon_listings l join public.nexamon_cards k on k.card_key = l.card_key where l.copy_id = :'s1'),
  'nexamon_ai_reset(): after its hold time the slab is listed again at its value plus the AI markup ' || :'rs2');
select tests.assert(
  (select population from public.nexamon_cards where card_key = 'me-010') = :pop0::bigint
  and (select count(*) from public.nexamon_copies where grade is not null) = :slabs0::bigint,
  'graded copies never leave circulation; the population is unchanged');

select tests.set_cfg('nexamon', '{ai,stockCap,common}', :'nx_cfg'::jsonb #>> '{ai,stockCap,common}');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', :'nx_cfg'::jsonb #>> '{ai,dailyBudgetPacks}');
select tests.set_cfg('nexamon', '{ai,packsPerHour}', (:'nx_cfg'::jsonb #> '{ai,packsPerHour}')::text);
update public.nexamon_meta set ai_reset_at = null;
select tests.assert(tests.money_invariant() = 'ok', 'money invariant: ' || tests.money_invariant());
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', :'nx_cfg'::jsonb #>> '{ai,buyChanceBps}');
