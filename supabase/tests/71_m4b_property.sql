-- =============================================================================
-- 71 · M4b: property (ADR-082): homes with trade-in, furniture and layouts,
--      floors, wall colours, garage, resale, public view, net worth, reset
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''07170717-0000-4000-8000-0000000000a1'''
\set b '''07170717-0000-4000-8000-0000000000b2'''
\set c '''07170717-0000-4000-8000-0000000000c3'''
\set d '''07170717-0000-4000-8000-0000000000d4'''
select tests.signup(:a, 'Hanna_Haus') is not null and tests.signup(:b, 'Moritz_Moebel') is not null
   and tests.signup(:c, 'Greta_Garage') is not null and tests.signup(:d, 'Neo_Neuling') is not null as ok \gset
select tests.set_level(:a, 30);
select tests.set_level(:b, 8);
select tests.set_level(:c, 14);
select tests.set_level(:d, 3);
select tests.fund(:a, 100000000, 'test:m4b:a');
select tests.fund(:b, 20000000, 'test:m4b:b');

create or replace function tests.households() returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where system_key = 'households' $$;
create or replace function tests.furniture_ids(p_player uuid, p_key text) returns uuid[] language sql as $$
  select array_agg(id order by bought_at, id) from public.player_furniture where player_id = p_player and item_key = p_key $$;
create or replace function tests.place(p_id uuid, p_x integer, p_y integer, p_rot integer default 0) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'x', p_x, 'y', p_y, 'rot', p_rot) $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. Catalogue, rules, unlock, error codes
-- =============================================================================
select tests.assert(
  (select count(*) from public.furniture_catalog) = 65
  and (select count(*) from public.furniture_catalog where layer = 'floor') = 6
  and (select count(distinct category) from public.furniture_catalog) = 10
  and (select count(*) from public.car_catalog) = 14
  and (select min(price_cents) from public.furniture_catalog) = 2500
  and (select max(price_cents) from public.furniture_catalog) = 150000000,
  'catalogue: 65 pieces of furniture in 10 categories (6 rugs), 14 cars, 25 EUR to 1.5 Mio. EUR (seed ran twice)');
select tests.assert(
  public.property_upgrade_cost_cents(null, 'flat') = 2500000
  and public.property_upgrade_cost_cents('flat', 'house') = 50000000 - 1250000
  and public.property_upgrade_cost_cents('apartment', 'luxury_villa') = 1500000000 - 5000000
  and public.property_trade_in_cents(null) = 0 and public.property_trade_in_cents('villa') = 125000000
  and public.property_resale_cents(240000) = 96000 and public.property_resale_cents(2501) = 1000
  and (public.property_tier('house') ->> 'idx')::int = 2 and (public.property_tier('house') ->> 'garageSlots')::int = 2
  and public.property_tier('castle') is null and public.property_tier(null) is null
  and public.property_floor_price_cents('gold') = 100000000 and public.property_floor_price_cents('laminate') = 0
  and public.property_floor_price_cents('wood') is null
  and public.property_floor_owned('{}', 'laminate') and not public.property_floor_owned('{laminate}', 'marble'),
  'upgradeCostCents, trade-in, resaleCents (floored), tiers, floor prices as in src/lib/sim/property.ts');
select tests.assert(
  exists (select 1 from public.unlocks where key = 'property' and level = 4 and title = 'Grundstück')
  and public.unlock_level('property') = 4,
  'the unlock row "property" (level 4, Grundstück) exists');
do $$
declare
  k text;
  v_state text;
begin
  foreach k in array array['property_locked:NX074', 'no_home:NX075', 'invalid_tier:NX076', 'item_not_found:NX077',
                           'layout_invalid:NX078', 'floor_not_owned:NX079', 'garage_full:NX080'] loop
    begin
      perform public.api_error(split_part(k, ':', 1));
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      if v_state <> split_part(k, ':', 2) then
        raise exception 'ASSERTION FAILED: % raised %', k, v_state;
      end if;
    end;
  end loop;
  raise notice 'ok - api_error: property_locked NX074 .. garage_full NX080';
end;
$$;

-- tables: no client access (RPCs only)
select tests.login_as('authenticated', :a);
select tests.throws($$select * from public.player_homes$$, '42501', 'player_homes is not readable for clients');
select tests.throws($$select * from public.player_furniture$$, '42501', 'player_furniture is not readable for clients');
select tests.throws($$select * from public.player_cars$$, '42501', 'player_cars is not readable for clients');
select tests.throws($$insert into public.player_homes (player_id, tier, wall_color) values (auth.uid(), 'luxury_villa', '#ffffff')$$,
  '42501', 'player_homes is not writable for clients');
select tests.throws($$select * from public.furniture_catalog$$, '42501', 'furniture_catalog is read through the RPCs only');
reset role;

-- =============================================================================
-- B. Level gates: reading is open, writing needs level 4, tiers their minLevel
-- =============================================================================
select tests.login_as('authenticated', :d);
select public.get_property(null) as d_view \gset
select tests.throws_key($$select public.buy_home(gen_random_uuid(), 'flat')$$, 'property_locked', 'level 3: buy_home is locked');
select tests.throws_key($$select public.buy_furniture(gen_random_uuid(), 'chair_wood', 1)$$, 'property_locked', 'level 3: buy_furniture is locked');
select tests.throws_key($$select public.buy_floor(gen_random_uuid(), 'carpet')$$, 'property_locked', 'level 3: buy_floor is locked');
reset role;
select tests.assert(
  :'d_view'::jsonb = jsonb_build_object(
    'property', jsonb_build_object('owner', 'Neo_Neuling', 'tier', null, 'width', 0, 'height', 0, 'garage_slots', 0,
                                   'wall_color', '#f3efe4', 'floor', 'laminate', 'floors_owned', '["laminate"]'::jsonb,
                                   'placed', '[]'::jsonb, 'garage', '[]'::jsonb, 'value_cents', 0),
    'inventory', '{"furniture": [], "cars": []}'::jsonb)
  and not exists (select 1 from public.player_homes where player_id = :d),
  'get_property(): a player without a home: tier null, 0 x 0, laminate, first wall colour, empty inventory (no row written)');
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.buy_home(gen_random_uuid(), 'house')$$, 'property_locked', 'level 8: the house needs level 14');
select tests.throws_key($$select public.buy_home(gen_random_uuid(), 'castle')$$, 'invalid_argument', 'unknown tier');
select tests.throws_key($$select public.buy_home(null, 'flat')$$, 'invalid_argument', 'request_id is required');
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key($$select public.buy_home(gen_random_uuid(), 'flat')$$, 'insufficient_funds', 'the flat (25.000 EUR) needs the cash (start capital 10.000 EUR)');
select tests.throws_key($$select public.buy_car(gen_random_uuid(), 'car_city')$$, 'no_home', 'a car needs a home');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate', '[]'),
  'no_home', 'save_layout needs a home');
reset role;

-- =============================================================================
-- C. The first home: paid to the households, replay-safe
-- =============================================================================
select tests.cash(:a) as a0 \gset
select tests.households() as h0 \gset
select gen_random_uuid() as rq_flat \gset
select tests.login_as('authenticated', :a);
select public.buy_home(:'rq_flat', 'flat') as flat1 \gset
select public.buy_home(:'rq_flat', 'flat') as flat1b \gset
select tests.throws_key($$select public.buy_home(gen_random_uuid(), 'flat')$$, 'invalid_tier', 'the same tier again');
select tests.throws_key($$select public.buy_car(gen_random_uuid(), 'car_city')$$, 'garage_full', 'a flat has no garage (0 slots)');
reset role;
select tests.assert(
  :'flat1b'::jsonb = :'flat1'::jsonb
  and (:'flat1'::jsonb ->> 'cost_cents')::bigint = 2500000
  and tests.cash(:a) = :a0 - 2500000 and tests.households() = :h0 + 2500000
  and :'flat1'::jsonb -> 'property' = jsonb_build_object('owner', 'Hanna_Haus', 'tier', 'flat', 'width', 8, 'height', 6, 'garage_slots', 0,
                                   'wall_color', '#f3efe4', 'floor', 'laminate', 'floors_owned', '["laminate"]'::jsonb,
                                   'placed', '[]'::jsonb, 'garage', '[]'::jsonb, 'value_cents', 1250000)
  and :'flat1'::jsonb -> 'inventory' = '{"furniture": [], "cars": []}'::jsonb
  and (select count(*) from public.ledger_transactions t where t.kind = 'lifestyle_purchase' and t.initiated_by = :a) = 1,
  'buy_home(flat): 25.000 EUR to the households (once, replay-safe), 8 x 6, value = 50 % trade-in');

-- =============================================================================
-- D. Furniture: buying into the inventory
-- =============================================================================
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.buy_furniture(gen_random_uuid(), 'chair_plastic', 21)$$, 'invalid_argument', 'at most 20 pieces');
select tests.throws_key($$select public.buy_furniture(gen_random_uuid(), 'chair_plastic', 0)$$, 'invalid_argument', 'at least 1 piece');
select tests.throws_key($$select public.buy_furniture(gen_random_uuid(), 'chair_gold_plated', 1)$$, 'item_not_found', 'unknown furniture');
select public.buy_furniture(gen_random_uuid(), 'sofa_leather', 2) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'rug_wool', 1) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'table_oak', 2) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'bed_double', 1) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'rug_checker', 2) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'chair_plastic', 20) as bf \gset
reset role;
select tests.assert(
  jsonb_array_length(:'bf'::jsonb #> '{inventory,furniture}') = 28
  and jsonb_array_length(:'bf'::jsonb #> '{property,placed}') = 0
  and tests.cash(:a) = :a0 - 2500000 - (480000 + 65000 + 280000 + 150000 + 28000 + 50000)
  and tests.households() = :h0 + 2500000 + 1053000
  and (select count(*) from public.player_furniture where player_id = :a and price_paid_cents = 2500 and item_key = 'chair_plastic') = 20
  and (:'bf'::jsonb #>> '{property,value_cents}')::bigint = 1250000 + 1053000 * 4 / 10,
  'buy_furniture(): 28 pieces in the inventory, paid to the households, value grows by 40 % of their prices');
select (tests.furniture_ids(:a, 'sofa_leather'))[1] as sofa1, (tests.furniture_ids(:a, 'sofa_leather'))[2] as sofa2,
       (tests.furniture_ids(:a, 'table_oak'))[1] as table1, (tests.furniture_ids(:a, 'table_oak'))[2] as table2,
       (tests.furniture_ids(:a, 'rug_wool'))[1] as rug, (tests.furniture_ids(:a, 'bed_double'))[1] as bed,
       (tests.furniture_ids(:a, 'rug_checker'))[1] as rugc1, (tests.furniture_ids(:a, 'rug_checker'))[2] as rugc2,
       (tests.furniture_ids(:a, 'chair_plastic'))[1] as chair1 \gset

-- =============================================================================
-- E. Layouts: bounds, overlap per layer (rugs under objects), rotation, wall, floor
-- =============================================================================
select tests.login_as('authenticated', :a);
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate',
                               jsonb_build_array(tests.place(:'sofa1', 6, 0))),
  'layout_invalid', 'a 3 x 1 sofa at x = 6 sticks out of the 8 wide flat');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate',
                               jsonb_build_array(tests.place(:'sofa1', 0, 4, 90))),
  'layout_invalid', 'rotated by 90 the sofa is 1 x 3: at y = 4 it sticks out of the 6 high flat');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate',
                               jsonb_build_array(tests.place(:'table1', 4, 2), tests.place(:'table2', 5, 3))),
  'layout_invalid', 'two tables on the same tiles');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate',
                               jsonb_build_array(tests.place(:'rugc1', 0, 0), tests.place(:'rugc2', 1, 1))),
  'layout_invalid', 'two rugs overlapping (same layer floor)');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate',
                               jsonb_build_array(tests.place(:'sofa1', 0, 0), tests.place(:'sofa1', 0, 2))),
  'layout_invalid', 'the same piece twice');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate',
                               jsonb_build_array(tests.place(gen_random_uuid(), 0, 0))),
  'layout_invalid', 'an id the player does not own');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate',
                               jsonb_build_array(tests.place(:'sofa1', 0, 0, 45))),
  'layout_invalid', 'rotation 45');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate',
                               jsonb_build_array(tests.place(:'sofa1', -1, 0))),
  'layout_invalid', 'negative x');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate',
                               jsonb_build_array(jsonb_build_object('id', :'sofa1', 'x', 1.5, 'y', 0, 'rot', 0))),
  'layout_invalid', 'x must be a whole tile');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate',
                               jsonb_build_array(jsonb_build_object('id', :'sofa1', 'x', 1))),
  'layout_invalid', 'y and rot are required');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#123456', 'laminate', '[]'),
  'invalid_argument', 'a wall colour outside property.wallColors');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'laminate', '{}'),
  'invalid_argument', 'p_placed must be an array');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'marble', '[]'),
  'floor_not_owned', 'marble is not bought');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'wood', '[]'),
  'floor_not_owned', 'an unknown material is not owned');
-- valid: rug under a sofa, a rotated sofa at the right wall, two tables, the bed
select public.save_layout(gen_random_uuid(), '#2F5FD0', 'laminate',
         jsonb_build_array(tests.place(:'rug', 0, 0), tests.place(:'sofa1', 0, 0), tests.place(:'sofa2', 7, 0, 90),
                           tests.place(:'table1', 4, 2), tests.place(:'table2', 5, 4), tests.place(:'bed', 0, 3))) as lay1 \gset
reset role;
select tests.assert(
  jsonb_array_length(:'lay1'::jsonb #> '{property,placed}') = 6
  and jsonb_array_length(:'lay1'::jsonb #> '{inventory,furniture}') = 22
  and :'lay1'::jsonb #>> '{property,wall_color}' = '#2f5fd0'
  and (select x = 7 and y = 0 and rot = 90 and placed from public.player_furniture where id = :'sofa2')
  and exists (select 1 from jsonb_array_elements(:'lay1'::jsonb #> '{property,placed}') e
               where e = jsonb_build_object('id', :'rug', 'item_key', 'rug_wool', 'x', 0, 'y', 0, 'rot', 0))
  and not exists (select 1 from jsonb_array_elements(:'lay1'::jsonb #> '{inventory,furniture}') e where e ->> 'id' in (:'sofa1', :'bed')),
  'save_layout(): rug under the sofa is fine, rotation 90 swaps the size, wall colour stored in lower case; placed pieces leave the inventory');
-- the next layout replaces the old one completely
select tests.login_as('authenticated', :a);
select public.save_layout(gen_random_uuid(), '#2f5fd0', 'laminate',
         jsonb_build_array(tests.place(:'rug', 0, 0), tests.place(:'sofa1', 0, 0), tests.place(:'sofa2', 7, 0, 90),
                           tests.place(:'table1', 4, 2), tests.place(:'table2', 5, 4))) as lay2 \gset
reset role;
select tests.assert(
  jsonb_array_length(:'lay2'::jsonb #> '{property,placed}') = 5
  and exists (select 1 from jsonb_array_elements(:'lay2'::jsonb #> '{inventory,furniture}') e where e ->> 'id' = :'bed')
  and (select not placed and x is null and y is null from public.player_furniture where id = :'bed'),
  'save_layout(): a piece missing from the new layout goes back into the inventory');

-- =============================================================================
-- F. Floors: bought once, free laminate, used in the layout
-- =============================================================================
select tests.cash(:a) as a1 \gset
select tests.households() as h1 \gset
select gen_random_uuid() as rq_floor \gset
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.buy_floor(gen_random_uuid(), 'wood')$$, 'invalid_argument', 'unknown floor material');
select public.buy_floor(:'rq_floor', 'parquet') as fl1 \gset
select public.buy_floor(:'rq_floor', 'parquet') as fl1b \gset
select public.buy_floor(gen_random_uuid(), 'parquet') as fl2 \gset
select public.buy_floor(gen_random_uuid(), 'laminate') as fl3 \gset
select public.save_layout(gen_random_uuid(), '#ffd15c', 'parquet',
         jsonb_build_array(tests.place(:'rug', 0, 0), tests.place(:'sofa1', 0, 0), tests.place(:'sofa2', 7, 0, 90),
                           tests.place(:'table1', 4, 2), tests.place(:'table2', 5, 4), tests.place(:'bed', 0, 3))) as lay3 \gset
reset role;
select tests.assert(
  :'fl1b'::jsonb = :'fl1'::jsonb
  and :'fl1'::jsonb #> '{property,floors_owned}' = '["laminate", "parquet"]'::jsonb
  and tests.cash(:a) = :a1 - 600000 and tests.households() = :h1 + 600000
  and :'fl2'::jsonb #> '{property,floors_owned}' = '["laminate", "parquet"]'::jsonb
  and :'fl3'::jsonb #> '{property,floors_owned}' = '["laminate", "parquet"]'::jsonb
  and :'lay3'::jsonb #>> '{property,floor}' = 'parquet' and :'lay3'::jsonb #>> '{property,wall_color}' = '#ffd15c'
  and (:'lay3'::jsonb #>> '{property,value_cents}')::bigint = (:'fl3'::jsonb #>> '{property,value_cents}')::bigint
  and (:'fl1'::jsonb #>> '{property,value_cents}')::bigint - (:'bf'::jsonb #>> '{property,value_cents}')::bigint = 240000,
  'buy_floor(): parquet costs 6.000 EUR once (replay and second purchase free), laminate is free; the floor can be used; value + 40 %');

-- =============================================================================
-- G. Selling: inventory only, 40 % back from the households
-- =============================================================================
select tests.cash(:a) as a2 \gset
select tests.households() as h2 \gset
select gen_random_uuid() as rq_sell \gset
select tests.login_as('authenticated', :a);
select tests.throws_key(format('select public.sell_item(gen_random_uuid(), %L, %L)', 'furniture', :'sofa1'),
  'item_not_found', 'a placed sofa cannot be sold');
select tests.throws_key(format('select public.sell_item(gen_random_uuid(), %L, %L)', 'car', :'chair1'),
  'item_not_found', 'a chair is not a car');
select tests.throws_key(format('select public.sell_item(gen_random_uuid(), %L, %L)', 'house', :'chair1'),
  'invalid_argument', 'p_kind is furniture or car');
select public.sell_item(:'rq_sell', 'furniture', :'chair1') as s1 \gset
select public.sell_item(:'rq_sell', 'furniture', :'chair1') as s1b \gset
select public.sell_item(gen_random_uuid(), 'furniture', :'rugc1') as s2 \gset
select tests.throws_key(format('select public.sell_item(gen_random_uuid(), %L, %L)', 'furniture', :'chair1'),
  'item_not_found', 'sold twice');
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key(format('select public.sell_item(gen_random_uuid(), %L, %L)', 'furniture', :'rugc2'),
  'item_not_found', 'nobody sells the furniture of another player');
reset role;
select tests.assert(
  :'s1b'::jsonb = :'s1'::jsonb
  and (:'s1'::jsonb ->> 'refund_cents')::bigint = 1000 and (:'s2'::jsonb ->> 'refund_cents')::bigint = 5600
  and tests.cash(:a) = :a2 + 6600 and tests.households() = :h2 - 6600
  and not exists (select 1 from public.player_furniture where id in (:'chair1', :'rugc1'))
  and (select count(*) from public.ledger_transactions t where t.kind = 'lifestyle_sale' and t.initiated_by = :a) = 2,
  'sell_item(): 40 % of the price paid (25 EUR chair: 10 EUR, 140 EUR rug: 56 EUR) from the households, replay-safe');

-- =============================================================================
-- H. Moving up: skipping a tier, trade-in, layout back into the inventory
-- =============================================================================
select tests.cash(:a) as a3 \gset
select tests.households() as h3 \gset
select tests.login_as('authenticated', :a);
select public.buy_home(gen_random_uuid(), 'house') as house \gset
select tests.throws_key($$select public.buy_home(gen_random_uuid(), 'apartment')$$, 'invalid_tier', 'no moving down to the apartment');
select tests.throws_key($$select public.buy_home(gen_random_uuid(), 'house')$$, 'invalid_tier', 'the same tier again');
reset role;
select tests.assert(
  (:'house'::jsonb ->> 'cost_cents')::bigint = 50000000 - 1250000
  and tests.cash(:a) = :a3 - 48750000 and tests.households() = :h3 + 48750000
  and :'house'::jsonb #>> '{property,tier}' = 'house'
  and (:'house'::jsonb #>> '{property,width}')::int = 13 and (:'house'::jsonb #>> '{property,height}')::int = 9
  and (:'house'::jsonb #>> '{property,garage_slots}')::int = 2
  and jsonb_array_length(:'house'::jsonb #> '{property,placed}') = 0
  and jsonb_array_length(:'house'::jsonb #> '{inventory,furniture}') = 26
  and :'house'::jsonb #>> '{property,floor}' = 'parquet' and :'house'::jsonb #>> '{property,wall_color}' = '#ffd15c'
  and :'house'::jsonb #> '{property,floors_owned}' = '["laminate", "parquet"]'::jsonb
  and not exists (select 1 from public.player_furniture where player_id = :a and placed),
  'buy_home(house) from the flat (skipping the apartment): 500.000 EUR - 12.500 EUR trade-in; all furniture back into the inventory, floors kept');

-- =============================================================================
-- I. Garage: first free slot, garage_full, selling a car
-- =============================================================================
select tests.cash(:a) as a4 \gset
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.buy_car(gen_random_uuid(), 'car_flying')$$, 'item_not_found', 'unknown car');
select public.buy_car(gen_random_uuid(), 'car_city') as car1 \gset
select public.buy_car(gen_random_uuid(), 'car_compact') as car2 \gset
select tests.throws_key($$select public.buy_car(gen_random_uuid(), 'car_sedan')$$, 'garage_full', 'the house has 2 garage slots');
select public.sell_item(gen_random_uuid(), 'car', (select (e ->> 'id')::uuid from jsonb_array_elements(:'car2'::jsonb #> '{property,garage}') e where (e ->> 'slot')::int = 0)) as sc \gset
select public.buy_car(gen_random_uuid(), 'car_sedan') as car3 \gset
reset role;
select tests.assert(
  :'car1'::jsonb #> '{property,garage}' -> 0 ->> 'car_key' = 'car_city' and (:'car1'::jsonb #> '{property,garage}' -> 0 ->> 'slot')::int = 0
  and jsonb_array_length(:'car2'::jsonb #> '{property,garage}') = 2
  and (:'sc'::jsonb ->> 'refund_cents')::bigint = 360000
  and jsonb_array_length(:'sc'::jsonb #> '{property,garage}') = 1
  and (select array_agg(car_key || ':' || slot order by slot) from public.player_cars where player_id = :a) = array['car_sedan:0', 'car_compact:1']
  and :'car3'::jsonb #> '{inventory,cars}' = '[]'::jsonb
  and tests.cash(:a) = :a4 - 900000 - 1800000 + 360000 - 4800000,
  'buy_car(): slots 0 and 1, a third car does not fit; a sold car frees its slot (40 % back), the next car takes the first free slot');

-- =============================================================================
-- J. Other players: home without a home, apartment directly, the public view
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.buy_furniture(gen_random_uuid(), 'plant_small', 3) is not null as ok \gset
select public.buy_floor(gen_random_uuid(), 'carpet') as b_floor \gset
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'carpet', '[]'),
  'no_home', 'level 8 without a home: no layout');
select public.buy_home(gen_random_uuid(), 'apartment') as b_home \gset
select public.get_property('hanna_haus') as b_sees_a \gset
select tests.throws_key($$select public.get_property('Gibt_Es_Nicht')$$, 'player_not_found', 'unknown nickname');
reset role;
select tests.login_as('authenticated', :a);
select public.get_property(null) as a_own \gset
reset role;
select tests.login_as('authenticated', :d);
select public.get_property('Moritz_Moebel') as d_sees_b \gset
reset role;
select tests.assert(
  :'b_floor'::jsonb #>> '{property,tier}' is null
  and :'b_floor'::jsonb #> '{property,floors_owned}' = '["laminate", "carpet"]'::jsonb
  and jsonb_array_length(:'b_floor'::jsonb #> '{inventory,furniture}') = 3
  and (:'b_home'::jsonb ->> 'cost_cents')::bigint = 10000000
  and :'b_home'::jsonb #>> '{property,tier}' = 'apartment' and (:'b_home'::jsonb #>> '{property,width}')::int = 10,
  'level 8: furniture and floors without a home; the first home may be the apartment (skipping the flat)');
select tests.assert(
  :'b_sees_a'::jsonb -> 'property' = :'a_own'::jsonb -> 'property'
  and :'b_sees_a'::jsonb -> 'inventory' = 'null'::jsonb
  and :'b_sees_a'::jsonb #>> '{property,owner}' = 'Hanna_Haus'
  and jsonb_array_length(:'b_sees_a'::jsonb #> '{property,garage}') = 2
  and jsonb_array_length(:'a_own'::jsonb #> '{inventory,furniture}') = 26
  and :'d_sees_b'::jsonb #>> '{property,tier}' = 'apartment' and :'d_sees_b'::jsonb -> 'inventory' = 'null'::jsonb,
  'get_property(nickname): the home and garage of other players are public (case-insensitive), their inventory is not; level 3 may look');

-- =============================================================================
-- K. Net worth and rich list include the property
-- =============================================================================
select tests.assert(
  public.player_property_value_cents(:a)
    = 25000000                                         -- house: 50 % of 500.000 EUR
      + (96000 * 2 + 26000 + 56000 * 2 + 60000 + 19 * 1000 + 5600) -- furniture: 40 % each (19 chairs, 1 small rug left)
      + (720000 + 1920000)                             -- cars: compact and sedan
      + 240000                                         -- parquet
  and (:'a_own'::jsonb #>> '{property,value_cents}')::bigint = public.player_property_value_cents(:a)
  and public.player_net_worth_cents(:a)
      = (select sum(balance_cents) from public.ledger_accounts where owner_player_id = :a) + public.player_property_value_cents(:a)
  and (select r.net_worth_cents from public.rich_list_entries() r where r.entity_id = :a) = public.player_net_worth_cents(:a)
  and (select r.net_worth_cents from public.rich_list_entries() r where r.entity_id = :b) = public.player_net_worth_cents(:b)
  and public.player_property_value_cents(:b) = 5000000 + 3 * 1200 + 60000
  and public.player_property_value_cents(:d) = 0,
  'propertyValueCents: home at 50 %, furniture, cars and bought floors at 40 %; in player_net_worth_cents and rich_list_entries');

-- =============================================================================
-- L. Missions: first home, furnished, upgrade, car, furniture bought
-- =============================================================================
\set m '''07170717-0000-4000-8000-0000000000e5'''
select tests.signup(:m, 'Mia_Mission') is not null as ok \gset
select tests.set_level(:m, 14);
select tests.fund(:m, 60000000, 'test:m4b:m');
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward) values
  (:m, 'm_home_first', 'milestone', date '1999-01-02', 1, 300),
  (:m, 'm_home_furnish', 'milestone', date '1999-01-02', 5, 400),
  (:m, 'm_home_upgrade', 'milestone', date '1999-01-02', 1, 800),
  (:m, 'm_home_car', 'milestone', date '1999-01-02', 1, 1000),
  (:m, 'q_home_furniture', 'quick', date '1999-01-02', 1, 40);
select tests.login_as('authenticated', :m);
select public.buy_home(gen_random_uuid(), 'flat') is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'chair_wood', 5) as m_bf \gset
select public.save_layout(gen_random_uuid(), '#f3efe4', 'laminate',
         (select jsonb_agg(tests.place((e ->> 'id')::uuid, n::int - 1, 0))
            from jsonb_array_elements(:'m_bf'::jsonb #> '{inventory,furniture}') with ordinality as t(e, n))) is not null as ok \gset
select public.buy_home(gen_random_uuid(), 'house') is not null as ok \gset
select public.buy_car(gen_random_uuid(), 'car_city') is not null as ok \gset
reset role;
select tests.assert(
  (select count(*) from public.player_missions where player_id = :m and period_start = date '1999-01-02' and status = 'completed') = 5
  and (select count(*) from public.mission_templates
        where key in ('q_home_furniture', 'm_home_first', 'm_home_furnish', 'm_home_upgrade', 'm_home_car')
          and params ->> 'unlock' = 'property') = 5,
  'missions: home_bought, furniture_bought (sum), furniture_placed (max per layout), home_upgraded, car_bought');
do $$
declare
  v uuid;
begin
  v := tests.signup(gen_random_uuid(), 'Heimlos_Drei');
  perform tests.set_level(v, 3);
  perform public.missions_assign(v);
  if exists (select 1 from public.player_missions m join public.mission_templates t on t.key = m.template_key
              where m.player_id = v and t.params ->> 'unlock' = 'property') then
    raise exception 'ASSERTION FAILED: property missions offered below level 4';
  end if;
  raise notice 'ok - property missions only from level 4 (params.unlock property)';
end;
$$;

-- =============================================================================
-- M. Account reset removes the property without a refund; money invariant
-- =============================================================================
select tests.cash(:m) as m_before \gset
select tests.login_as('authenticated', :m);
select public.reset_account(gen_random_uuid(), 'Mia_Mission') is not null as ok \gset
select public.get_property(null) as m_after \gset
reset role;
select tests.assert(
  not exists (select 1 from public.player_homes where player_id = :m)
  and not exists (select 1 from public.player_furniture where player_id = :m)
  and not exists (select 1 from public.player_cars where player_id = :m)
  and :'m_after'::jsonb #>> '{property,tier}' is null and (:'m_after'::jsonb #>> '{property,value_cents}')::bigint = 0
  and exists (select 1 from public.player_homes where player_id = :a),
  'reset_account(): home, furniture and cars are gone (no refund), other players keep theirs');
select tests.assert(
  (select count(*) from public.player_homes h join public.profiles p on p.id = h.player_id
    where p.nickname in ('Hanna_Haus', 'Moritz_Moebel', 'Greta_Garage', 'Neo_Neuling')) = 2
  and tests.money_invariant() = 'ok',
  'four players side by side (two homes, one without money, one below the unlock); money invariant holds after all M4b flows');
