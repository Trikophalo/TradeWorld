-- =============================================================================
-- 9u · Living bonus, furniture prices by home, furnished home value, free rent prices (ADR-161)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set o '''0e170001-0000-4000-8000-0000000001a1'''
\set t '''0e170001-0000-4000-8000-0000000001b1'''
\set q '''0e170001-0000-4000-8000-0000000001c1'''
\set rq '''0e170001-0000-4000-8000-0000000001e1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:o, 'Wanda_Wohnt') is not null and tests.signup(:t, 'Udo_Untermiete') is not null
   and tests.signup(:q, 'Quentin_Weg') is not null as ok \gset
select tests.set_level(:o, 12);
select tests.set_level(:t, 9);
select tests.set_level(:q, 9);
select tests.fund(:o, 200000000, 'test:living:o');
select tests.fund(:t, 5000000, 'test:living:t');
select tests.fund(:q, 5000000, 'test:living:q');

create or replace function tests.u9_piece(p_player uuid, p_key text) returns uuid language sql as $$
  select f.id from public.player_furniture f where f.player_id = p_player and f.item_key = p_key order by f.id limit 1 $$;
create or replace function tests.u9_xp(p_player uuid) returns bigint language sql as $$
  select coalesce(sum(e.amount), 0)::bigint from public.xp_events e where e.player_id = p_player and e.source = 'home_living' $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. Rules as in src/lib/sim/living.ts and src/lib/sim/property.ts
-- =============================================================================
select tests.assert(
  public.living_bonus_owner('flat', 0) = '{"cents": 800, "xp": 1}'::jsonb
  and public.living_bonus_owner('flat', 50) = '{"cents": 1400, "xp": 2}'::jsonb
  and public.living_bonus_owner('flat', 100) = '{"cents": 2000, "xp": 3}'::jsonb
  and public.living_bonus_owner('house', 90) = '{"cents": 11280, "xp": 5}'::jsonb
  and public.living_bonus_owner('luxury_villa', 100) = '{"cents": 80000, "xp": 10}'::jsonb
  and public.living_bonus_owner('flat', 150) = public.living_bonus_owner('flat', 100)
  and public.living_bonus_tenant('villa', 100, 40000) = '{"cents": 15000, "xp": 4}'::jsonb
  and public.living_bonus_tenant('villa', 100, 1000) = '{"cents": 1000, "xp": 4}'::jsonb
  and public.living_bonus_tenant('flat', 0, 3000) = '{"cents": 400, "xp": 0}'::jsonb
  and public.property_furniture_list_cents(100000, null) = 100000
  and public.property_furniture_list_cents(100000, 'flat') = 100000
  and public.property_furniture_list_cents(100000, 'apartment') = 125000
  and public.property_furniture_list_cents(100000, 'house') = 150000
  and public.property_furniture_list_cents(100000, 'villa') = 200000
  and public.property_furniture_list_cents(100000, 'luxury_villa') = 300000
  and public.property_furniture_list_cents(1999, 'apartment') = 2498,
  'living bonus by tier and Wohnwert, tenant share capped at the rent, furniture price by home as in TypeScript');
select tests.login_as('authenticated', :o);
select tests.throws($$select * from public.living_bonus_payments$$, '42501', 'living_bonus_payments is not readable for clients');
reset role;

-- =============================================================================
-- B. Furniture costs more in a bigger home; the Wohnwert counts the list price
-- =============================================================================
select tests.cash(:o) as o0 \gset
select tests.households() as h0 \gset
select tests.login_as('authenticated', :o);
select public.buy_furniture(gen_random_uuid(), 'chair_wood', 1) is not null as ok \gset
select public.buy_home(gen_random_uuid(), 'apartment') is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'sofa_leather', 1) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'plant_small', 2) as bf \gset
reset role;
select tests.assert(
  (select list_cents = 8000 and price_paid_cents = 8000 from public.player_furniture where player_id = :o and item_key = 'chair_wood')
  and (select list_cents = 300000 and price_paid_cents = 300000 from public.player_furniture where player_id = :o and item_key = 'sofa_leather')
  and (select count(*) from public.player_furniture where player_id = :o and item_key = 'plant_small' and list_cents = 3750) = 2
  and tests.cash(:o) = :o0::bigint - 8000 - 10000000 - 300000 - 7500
  and tests.households() = :h0::bigint + 8000 + 10000000 + 300000 + 7500
  and (select (t.metadata ->> 'list_cents')::bigint = 300000 and t.metadata ->> 'home_tier' = 'apartment'
         from public.ledger_transactions t where t.initiated_by = :o and t.kind = 'lifestyle_purchase'
          and t.metadata ->> 'item_key' = 'sofa_leather')
  and (select bool_and((f ->> 'value_cents')::bigint in (8000, 300000, 3750)) from jsonb_array_elements(:'bf'::jsonb #> '{inventory,furniture}') f)
  and tests.money_invariant() = 'ok',
  'buy_furniture(): without a home the catalogue price, in the apartment x 1,25 (list price stored, shown per piece)');

select tests.u9_piece(:o, 'sofa_leather') as sofa, tests.u9_piece(:o, 'chair_wood') as chair \gset
select tests.login_as('authenticated', :o);
select public.save_layout(gen_random_uuid(), '#f3efe4', 'laminate',
         jsonb_build_array(tests.place(:'sofa', 0, 0), tests.place(:'chair', 4, 0))) as lay \gset
reset role;
select tests.assert(
  (public.home_wohnwert(:o) ->> 'value_cents')::bigint = 308000
  and (select (p ->> 'value_cents')::bigint from jsonb_array_elements(:'lay'::jsonb #> '{property,placed}') p
        where p ->> 'id' = :'sofa') = 300000,
  'home_wohnwert(): the value part counts the list prices of the placed pieces');

-- =============================================================================
-- C. The furnishing is part of the home value, in the net worth and the rich list
-- =============================================================================
select tests.assert(
  public.player_furnishing_value_cents(:o) = 180000 + 4800
  and public.player_property_value_cents(:o) = 5000000 + 180000 + 4800 + 2 * 1500
  and (:'lay'::jsonb #>> '{property,value_cents}')::bigint = public.player_property_value_cents(:o)
  and (:'lay'::jsonb #>> '{property,furnishing_cents}')::bigint = 184800
  and public.player_net_worth_cents(:o)
      = (select sum(balance_cents) from public.ledger_accounts where owner_player_id = :o) + public.player_property_value_cents(:o)
  and (select r.net_worth_cents from public.rich_list_entries() r where r.entity_id = :o) = public.player_net_worth_cents(:o),
  'home value: trade-in + placed furniture at 60 % of the price paid + the inventory at 40 %; net worth and rich list agree');

-- =============================================================================
-- D. Rent prices are free: from 1 EUR per hour up to the safety maximum
-- =============================================================================
select tests.login_as('authenticated', :o);
select tests.throws_key($$select public.set_rental_offer(gen_random_uuid(), 'hour', 99, true)$$, 'rent_price_out_of_range',
  'set_rental_offer(): at least 1 EUR per hour');
select tests.throws_key($$select public.set_rental_offer(gen_random_uuid(), 'hour', 10000001, true)$$, 'rent_price_out_of_range',
  'set_rental_offer(): at most the safety maximum');
select tests.throws_key($$select public.set_rental_offer(gen_random_uuid(), 'day', 2399, true)$$, 'rent_price_out_of_range',
  'set_rental_offer(): a day costs at least 24 EUR');
select public.set_rental_offer(gen_random_uuid(), 'day', 240000000, true) as dmax \gset
select public.set_rental_offer(gen_random_uuid(), 'hour', 100, true) as hmin \gset
select public.set_rental_offer(:rq, 'hour', 6000, true) as off \gset
reset role;
select tests.assert(
  (:'dmax'::jsonb #>> '{offer,price_cents}')::bigint = 240000000 and (:'dmax'::jsonb #>> '{offer,chance_bps}')::int = 0
  and (:'hmin'::jsonb #>> '{offer,price_cents}')::bigint = 100
  and (:'off'::jsonb #>> '{offer,price_cents}')::bigint = 6000
  and (:'off'::jsonb #> '{home,limits,hour}') = jsonb_build_object('min_cents', 100, 'max_cents', 10000000,
        'fair_cents', public.rental_fair_hour_cents('apartment', public.home_wohnwert_total(:o)))
  and public.rental_ai_chance_bps('apartment', 100, 10000000) = 0
  and public.rental_ai_chance_bps('apartment', 100, 3000) > public.rental_ai_chance_bps('apartment', 100, 9000),
  'the owner decides (1 EUR to 100.000 EUR per hour); a dear offer finds no AI tenant, a cheap one more');

-- =============================================================================
-- E. Living bonus every hour: owner, tenant, inactive player; once per hour; through the ledger
-- =============================================================================
select tests.login_as('authenticated', :t);
select public.rent_home(gen_random_uuid(), 'Wanda_Wohnt') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :q);
select public.buy_home(gen_random_uuid(), 'flat') is not null as ok \gset
reset role;
update public.profiles set last_active_at = public.game_now() where id in (:o, :t);
update public.profiles set last_active_at = public.game_now() - interval '4 days' where id = :q;

select public.home_wohnwert_total(:o) as w \gset
select date_trunc('hour', public.game_now()) + interval '10 minutes' as t0 \gset
select tests.cash(:o) as oc, tests.cash(:t) as tc, tests.cash(:q) as qc, tests.households() as hh,
       tests.u9_xp(:o) as ox, tests.u9_xp(:t) as tx \gset
select public.player_living_bonus(:o) as ob, public.player_living_bonus(:t) as tb, public.player_living_bonus(:q) as qb \gset
select public.living_bonus_run_due(:'t0'::timestamptz) as run1 \gset
select public.living_bonus_run_due(:'t0'::timestamptz + interval '20 minutes') as run1b \gset
select tests.assert(
  :'ob'::jsonb = public.living_bonus_owner('apartment', :w::int)
                 || jsonb_build_object('source', 'own', 'tier', 'apartment', 'wohnwert', :w::int, 'owner', null)
  and :'tb'::jsonb = public.living_bonus_tenant('apartment', :w::int, 6000)
                     || jsonb_build_object('source', 'tenant', 'tier', 'apartment', 'wohnwert', :w::int, 'owner', 'Wanda_Wohnt')
  and (:'tb'::jsonb ->> 'cents')::bigint = (:'ob'::jsonb ->> 'cents')::bigint / 2
  and (:'qb'::jsonb ->> 'source') = 'own'
  and (:'run1'::jsonb ->> 'paid')::int >= 2 and (:'run1b'::jsonb ->> 'paid')::int = 0
  and tests.cash(:o) = :oc::bigint + (:'ob'::jsonb ->> 'cents')::bigint
  and tests.cash(:t) = :tc::bigint + (:'tb'::jsonb ->> 'cents')::bigint
  and tests.cash(:q) = :qc::bigint
  -- other players of earlier test files who live somewhere are paid as well
  and tests.households() = :hh::bigint - (select sum(y.cents) from public.living_bonus_payments y
                                          where y.hour_start = date_trunc('hour', :'t0'::timestamptz))
  and tests.u9_xp(:o) = :ox::bigint + (:'ob'::jsonb ->> 'xp')::bigint * 2
  and tests.u9_xp(:t) = :tx::bigint + (:'tb'::jsonb ->> 'xp')::bigint * 2
  and (select count(*) from public.ledger_transactions x where x.kind = 'living_bonus' and x.initiated_by in (:o, :t)) = 2
  and (select count(*) from public.living_bonus_payments y where y.player_id = :o) = 1
  and not exists (select 1 from public.living_bonus_payments y where y.player_id = :q)
  and tests.money_invariant() = 'ok',
  'living_bonus_run_due(): owner and tenant (half) are paid from the households with XP (home_living), once per hour; '
  'a player away for four days gets nothing');

select public.living_bonus_run_due(:'t0'::timestamptz + interval '1 hour') as run2 \gset
select tests.assert(
  (:'run2'::jsonb ->> 'paid')::int >= 2
  and tests.cash(:o) = :oc::bigint + 2 * (:'ob'::jsonb ->> 'cents')::bigint
  and (select count(*) from public.living_bonus_payments y where y.player_id = :o) = 2
  and tests.money_invariant() = 'ok',
  'the next hour pays again');

-- a better-furnished home pays more
select tests.login_as('authenticated', :o);
select bool_and(public.buy_furniture(gen_random_uuid(), k, 1) is not null) as ok
  from unnest(array['bed_double', 'table_oak', 'kitchen_fridge', 'shower', 'rug_wool']) k \gset
reset role;
select tests.u9_piece(:o, 'bed_double') as bed, tests.u9_piece(:o, 'table_oak') as tbl,
       tests.u9_piece(:o, 'kitchen_fridge') as fridge, tests.u9_piece(:o, 'shower') as shower,
       tests.u9_piece(:o, 'rug_wool') as rug \gset
select tests.login_as('authenticated', :o);
select public.save_layout(gen_random_uuid(), '#f3efe4', 'laminate',
         jsonb_build_array(tests.place(:'sofa', 0, 0), tests.place(:'chair', 4, 0), tests.place(:'bed', 0, 3),
                           tests.place(:'tbl', 5, 3), tests.place(:'fridge', 9, 0), tests.place(:'shower', 9, 7),
                           tests.place(:'rug', 5, 5))) as lay2 \gset
select public.get_property(null) as prop \gset
reset role;
select tests.assert(
  public.home_wohnwert_total(:o) > :w::int
  and (public.player_living_bonus(:o) ->> 'cents')::bigint > (:'ob'::jsonb ->> 'cents')::bigint
  and :'prop'::jsonb #> '{rental,living_bonus}' = public.player_living_bonus(:o),
  'more Wohnwert, more bonus; get_property() shows it (rental.living_bonus)');

-- the daily summary of yesterday
select public.living_bonus_run_due(:'t0'::timestamptz + interval '1 day') as run3 \gset
select tests.assert(
  (select count(*) from public.notifications n where n.player_id = :o and n.type_key = 'living_bonus_summary') = 1
  and (select count(*) from public.notifications n where n.player_id = :t and n.type_key = 'living_bonus_summary') = 1
  and not exists (select 1 from public.notifications n where n.player_id = :q and n.type_key = 'living_bonus_summary'),
  'once a day the bonus of yesterday is summed up in a notification');

-- account reset: the payments go
select public.rentals_wipe_player(:q);
select public.rentals_wipe_player(:t);
select tests.assert(
  not exists (select 1 from public.living_bonus_payments y where y.player_id = :t)
  and public.player_living_bonus(:t) is null
  and tests.money_invariant() = 'ok',
  'rentals_wipe_player(): the living bonus payments and the tenancy go; a player living nowhere gets no bonus');
