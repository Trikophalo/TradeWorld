-- =============================================================================
-- d5 · Nexamon: Titans Revenge rebalance (ADR-207): diamond x 1.3, uranium x 0.918828 in the catalogue with the
--      pack's expected value unchanged; migration 9900 scales live values relative (drift kept), the value history
--      and the AI asking prices, leaves player listings alone and runs only once (data_migrations).
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set p '''0d5d5d5d-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:p, 'Tr_Paula') is not null as ok \gset
select tests.set_level(:p, 10);
select public.nexamon_sync() is not null as ok \gset

select tests.assert(exists (select 1 from public.data_migrations where key = 'nexamon_titans_rebalance_207'),
  'd5: the rebalance is marked as done (data_migrations)');

-- the catalogue: start prices as in game_config, expected value per pack 1/50 x mean(diamond) + 1/500 x mean(uranium)
-- = 56.103,75 EUR before (diamond 597.375 EUR, uranium 22.078.125 EUR on average) and within a euro of it after
select tests.assert(
  (select count(*) from public.nexamon_cards k
     join jsonb_array_elements((select value from public.game_config where key = 'nexamon_cards')) x
       on x ->> 'key' = k.card_key
    where k.set_key = 'titans_revenge' and k.rarity in ('diamond', 'uranium')
      and k.start_e4 = (x ->> 'startPriceCents')::bigint * 100) = 8
  and (select start_e4 from public.nexamon_cards where card_key = 'tr-026') = 118755000::bigint * 100
  and (select start_e4 from public.nexamon_cards where card_key = 'tr-030') = 3452496200::bigint * 100
  and abs((select avg(start_e4) / 100 / 50 from public.nexamon_cards where set_key = 'titans_revenge' and rarity = 'diamond')
          + (select avg(start_e4) / 100 / 500 from public.nexamon_cards where set_key = 'titans_revenge' and rarity = 'uranium')
          - 5610375) < 100,
  'd5: diamond and uranium start prices from the catalogue (tr-026 1.187.550 EUR, tr-030 34.524.962 EUR), '
  'their share of the expected value unchanged (56.103,75 EUR per pack)');
select tests.assert(
  not exists (select 1 from public.nexamon_cards where set_key = 'titans_revenge' and rarity = 'diamond'
               and (start_e4 < 43875000::bigint * 100 or start_e4 > 124312500::bigint * 100))
  and not exists (select 1 from public.nexamon_cards where set_key = 'titans_revenge' and rarity = 'uranium'
                   and (start_e4 < 878629275::bigint * 100 or start_e4 > 3617885250::bigint * 100)),
  'd5: diamond and uranium start prices inside their new ranges');

-- -----------------------------------------------------------------------------
-- The live push, inside a transaction that is rolled back: a moved diamond card with history, an AI and a player
-- listing; the migration runs again without its mark.
-- -----------------------------------------------------------------------------
begin;
update public.nexamon_cards
   set value_e4 = 700000000000, day_ref_e4 = 690000000000, moved_at = public.game_now()
 where card_key = 'tr-023';
update public.nexamon_cards set value_e4 = 20000000000000, moved_at = public.game_now() where card_key = 'tr-027';
insert into public.nexamon_value_points (card_key, at, value_e4)
values ('tr-023', public.game_now() - interval '3 hours', 650000000001) on conflict (card_key, at) do update set value_e4 = excluded.value_e4;
select public.nexamon_mint_copy('tr-023', null, 'Karten-Kalle', 'mint', 'seed', null, public.game_now()) as ai_copy \gset
select public.nexamon_mint_copy('tr-023', :p, null, 'good', 'pack', gen_random_uuid(), public.game_now()) as my_copy \gset
insert into public.nexamon_listings (copy_id, card_key, seller_ai, price_cents) values (:'ai_copy', 'tr-023', 'Karten-Kalle', 1)
  on conflict (copy_id) do update set price_cents = 1;
insert into public.nexamon_listings (copy_id, card_key, seller_id, price_cents) values (:'my_copy', 'tr-023', :p, 55555555);
select start_e4 as s23 from public.nexamon_cards where card_key = 'tr-023' \gset
select start_e4 as s27 from public.nexamon_cards where card_key = 'tr-027' \gset
select value_e4 as i01 from public.nexamon_cards where card_key = 'tr-001' \gset

-- run twice with the mark: nothing changes
\ir ../migrations/20261204009900_nexamon_titans_rebalance.sql
select tests.assert(
  (select value_e4 from public.nexamon_cards where card_key = 'tr-023') = 700000000000
  and (select price_cents from public.nexamon_listings where copy_id = :'ai_copy') = 1,
  'd5: with its mark the migration changes nothing (idempotent)');

delete from public.data_migrations where key = 'nexamon_titans_rebalance_207';
\ir ../migrations/20261204009900_nexamon_titans_rebalance.sql
\ir ../migrations/20261204009900_nexamon_titans_rebalance.sql
select tests.assert(
  (select value_e4 from public.nexamon_cards where card_key = 'tr-023') = 910000000000
  and (select day_ref_e4 from public.nexamon_cards where card_key = 'tr-023') = 897000000000
  and (select start_e4 from public.nexamon_cards where card_key = 'tr-023') = public.div_round_half_even(:s23::numeric * 13, 10)
  and (select value_e4 from public.nexamon_value_points where card_key = 'tr-023' and at = public.game_now() - interval '3 hours')
      = public.div_round_half_even(650000000001::numeric * 13, 10)
  and (select value_e4 from public.nexamon_cards where card_key = 'tr-027') = 18376560000000
  and (select start_e4 from public.nexamon_cards where card_key = 'tr-027')
      = public.div_round_half_even(:s27::numeric * 918828, 1000000)
  and (select value_e4 from public.nexamon_cards where card_key = 'tr-001') = :i01,
  'd5: once without its mark: diamond value, day reference, start and history x 1.3 (70 -> 91 Mio. EUR), uranium '
  'x 0.918828 (2 Mrd. -> 1,84 Mrd. EUR), iron untouched; a second run changes nothing');
select tests.assert(
  (select price_cents from public.nexamon_listings where copy_id = :'ai_copy')
    = public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(910000000000, 'mint', null::double precision, 'tr-023'))
  and (select price_cents from public.nexamon_listings where copy_id = :'my_copy') = 55555555
  and (select catalogue_hash from public.nexamon_meta) is null,
  'd5: AI listings follow the new value, player listings keep their price, the next sync rereads the catalogue');
-- the next sync puts start prices on the catalogue again, moved values stay where the push put them
select public.nexamon_sync() is not null as ok \gset
select tests.assert(
  (select start_e4 from public.nexamon_cards where card_key = 'tr-023') = :s23
  and (select value_e4 from public.nexamon_cards where card_key = 'tr-023') = 910000000000,
  'd5: the sync after the push: start price from the catalogue, the moved value kept');
rollback;
