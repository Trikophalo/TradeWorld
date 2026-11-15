-- =============================================================================
-- 9q · Wohnwert and renting out places in the home (ADR-158)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set o '''0e170001-0000-4000-8000-0000000000a1'''
\set t '''0e170001-0000-4000-8000-0000000000b1'''
\set p '''0e170001-0000-4000-8000-0000000000c1'''
\set x '''0e170001-0000-4000-8000-0000000000d1'''
\set rq '''0e170001-0000-4000-8000-0000000000e1'''
\set rr '''0e170001-0000-4000-8000-0000000000e2'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:o, 'Vera_Vermieter') is not null and tests.signup(:t, 'Tim_Mieter') is not null
   and tests.signup(:p, 'Pia_Pleite') is not null and tests.signup(:x, 'Xaver_Neu') is not null as ok \gset
select tests.set_level(:o, 10);
select tests.set_level(:t, 9);
select tests.set_level(:p, 9);
select tests.set_level(:x, 3);
select tests.fund(:o, 20000000, 'test:rentals:o');
select tests.fund(:t, 5000000, 'test:rentals:t');

create or replace function tests.r9q_mission(p_player uuid, p_key text, p_target bigint) returns void language sql as $$
  insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward)
  select p_player, t.key, t.kind, date '2000-01-01', p_target, 100 from public.mission_templates t where t.key = p_key
  on conflict (player_id, template_key, period_start) do update set status = 'active', progress = 0, completed_at = null $$;
create or replace function tests.r9q_status(p_player uuid, p_key text) returns text language sql as $$
  select m.status::text || ':' || m.progress from public.player_missions m
   where m.player_id = p_player and m.template_key = p_key order by m.created_at desc limit 1 $$;
create or replace function tests.r9q_layout(p_player uuid) returns jsonb language sql as $$
  -- the flat of src/lib/sim/rentals.test.ts: nine standard pieces, a rug, two things on the oak table
  with f as (select f.id, f.item_key, row_number() over (partition by f.item_key order by f.id) as n
               from public.player_furniture f where f.player_id = p_player),
       pos(k, x, y) as (values ('bed_double', 0, 0), ('sofa_leather', 5, 0), ('table_oak', 5, 2), ('lamp_table', 5, 2),
                               ('vase_flowers', 6, 3), ('kitchen_fridge', 7, 5), ('shower', 0, 5), ('plant_monstera', 7, 2),
                               ('rug_wool', 1, 3))
  select jsonb_agg(jsonb_build_object('id', f.id, 'x', pos.x, 'y', pos.y, 'rot', 0))
    from pos join f on f.item_key = pos.k and f.n = 1 $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. Rules as in src/lib/sim/rentals.ts; error keys
-- =============================================================================
select tests.assert(
  public.rental_fair_hour_cents('flat', 0) = 600 and public.rental_fair_hour_cents('flat', 50) = 1800
  and public.rental_fair_hour_cents('flat', 90) = 2760 and public.rental_fair_hour_cents('luxury_villa', 100) = 100000
  and public.rental_limits('flat', 90, 'hour') = '{"min_cents": 150, "max_cents": 4140, "fair_cents": 2760}'::jsonb
  and public.rental_limits('flat', 90, 'day') = '{"min_cents": 3600, "max_cents": 99360, "fair_cents": 66240}'::jsonb
  and public.rental_ai_chance_bps('flat', 24, 100) = 0 and public.rental_ai_chance_bps('flat', 50, 1800) = 3000
  and public.rental_ai_chance_bps('flat', 100, 3000) = 6000 and public.rental_ai_chance_bps('flat', 100, 4500) = 3000
  and public.rental_ai_chance_bps('flat', 90, 150) = 10000
  and public.rental_stay_hours(0, 'hour') = 24 and public.rental_stay_hours(0.999999, 'hour') = 120
  and public.rental_stay_hours(0.5, 'day') % 24 = 0
  and public.rental_notice_end('2026-01-01 00:00Z', '2026-01-01 00:00Z', 'hour') = '2026-01-02 00:00Z'
  and public.rental_notice_end('2026-01-01 00:00Z', '2026-01-01 20:00Z', 'hour') = '2026-01-02 08:00Z'
  and public.rental_notice_end('2026-01-01 00:00Z', '2026-01-01 20:30Z', 'hour') = '2026-01-02 09:00Z'
  and public.rental_notice_end('2026-01-01 00:00Z', '2026-01-01 20:00Z', 'day') = '2026-01-03 00:00Z'
  and public.rental_tenant_xp(100, 1) = 5 and public.rental_tenant_xp(50, 1) = 2 and public.rental_tenant_xp(90, 24) = 108
  and public.rental_places('flat') = 1 and public.rental_places('luxury_villa') = 6 and public.rental_places(null) = 0,
  'fair rent, limits, AI chance, stay, notice end and tenant XP as in src/lib/sim/rentals.ts');
do $$
declare
  k text;
  v_state text;
begin
  foreach k in array array['rent_price_out_of_range:NX140', 'rent_own_home:NX141', 'rental_not_offered:NX142',
                           'rental_full:NX143', 'already_renting:NX144', 'tenancy_not_found:NX145', 'poke_daily_limit:NX136'] loop
    begin
      perform public.api_error(split_part(k, ':', 1));
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      if v_state <> split_part(k, ':', 2) then
        raise exception 'ASSERTION FAILED: % raised %', k, v_state;
      end if;
    end;
  end loop;
  raise notice 'ok - api_error: rent_price_out_of_range NX140 .. tenancy_not_found NX145 (older keys kept)';
end;
$$;
select tests.login_as('authenticated', :o);
select tests.throws($$select * from public.rental_offers$$, '42501', 'rental_offers is not readable for clients');
select tests.throws($$select * from public.rental_tenancies$$, '42501', 'rental_tenancies is not readable for clients');
select tests.throws($$select * from public.rental_payments$$, '42501', 'rental_payments is not readable for clients');
reset role;

-- =============================================================================
-- B. Wohnwert: the same as the TS formula; saving counts for missions
-- =============================================================================
select tests.r9q_mission(:o, 'm_wohnwert_60', 60);
select tests.login_as('authenticated', :o);
select tests.throws_key($$select public.set_rental_offer(gen_random_uuid(), 'hour', 500, true)$$, 'no_home',
  'set_rental_offer(): only with a home');
select public.buy_home(gen_random_uuid(), 'flat') is not null as ok \gset
select public.get_rentals() as r0 \gset
select bool_and(public.buy_furniture(gen_random_uuid(), k, 1) is not null) as ok
  from unnest(array['bed_double', 'sofa_leather', 'table_oak', 'lamp_table', 'vase_flowers', 'kitchen_fridge', 'shower',
                    'plant_monstera', 'rug_wool']) k \gset
reset role;
select tests.r9q_layout(:o) as layout \gset
select tests.login_as('authenticated', :o);
select public.save_layout(gen_random_uuid(), '#f3efe4', 'laminate', :'layout'::jsonb) as saved \gset
select public.get_rentals() as r1 \gset
reset role;
select tests.assert(
  :'r0'::jsonb #>> '{home,wohnwert,total}' = '0' and :'r0'::jsonb -> 'offer' = 'null'::jsonb
  and :'r0'::jsonb -> 'renting' = 'null'::jsonb and :'r0'::jsonb #>> '{home,places}' = '1'
  and :'r1'::jsonb #> '{home,wohnwert,parts}' = '{"value": 30, "variety": 20, "fill": 20, "layers": 10, "style": 10, "floor": 0}'::jsonb
  and (:'r1'::jsonb #>> '{home,wohnwert,total}')::int = 90
  and (:'r1'::jsonb #>> '{home,wohnwert,value_cents}')::bigint = 806000
  and (:'r1'::jsonb #>> '{home,wohnwert,coverage_bps}')::int = 3958
  and (:'r1'::jsonb #>> '{home,wohnwert,categories}')::int = 8
  and :'r1'::jsonb #> '{home,limits,hour}' = '{"min_cents": 150, "max_cents": 4140, "fair_cents": 2760}'::jsonb
  and (:'saved'::jsonb #>> '{rental,wohnwert}')::int = 90
  and tests.r9q_status(:o, 'm_wohnwert_60') = 'completed:60',
  'home_wohnwert(): empty 0, the furnished flat 90 with the same parts as wohnwert() in TS; the save completes "Wohnwert 60"');
select tests.assert(
  (public.home_wohnwert(:o) ->> 'total')::int = 90
  and public.home_wohnwert(:x) is null
  and public.mission_doable(:o, 'm_rent_offer', 'rental_offered')
  and not public.mission_doable(:x, 'm_rent_offer', 'rental_offered')
  and public.mission_is_money_metric('rent_earned')
  and public.mission_text('Nimm {target} Miete ein', 'rent_earned', 20000) = 'Nimm 200 € Miete ein',
  'no home: no Wohnwert and no rental missions; rent counts as money in mission texts');

-- =============================================================================
-- C. Offering: limits, errors, idempotent; the first offer is a mission
-- =============================================================================
select tests.r9q_mission(:o, 'm_rent_offer', 1);
select tests.r9q_mission(:o, 'm_rent_tenant', 1);
select tests.login_as('authenticated', :x);
select tests.throws_key($$select public.set_rental_offer(gen_random_uuid(), 'hour', 500, true)$$, 'property_locked',
  'set_rental_offer(): only from the property level');
reset role;
select tests.login_as('authenticated', :o);
select tests.throws_key($$select public.set_rental_offer(gen_random_uuid(), 'hour', 149, true)$$, 'rent_price_out_of_range',
  'set_rental_offer(): not below 5 % of the reference rent (NX140)');
select tests.throws_key($$select public.set_rental_offer(gen_random_uuid(), 'hour', 4141, true)$$, 'rent_price_out_of_range',
  'set_rental_offer(): not above 150 % of the fair rent');
select tests.throws_key($$select public.set_rental_offer(gen_random_uuid(), 'week', 500, true)$$, 'invalid_argument',
  'set_rental_offer(): per hour or per day only');
select public.set_rental_offer(:rq, 'hour', 4140, true) as off1 \gset
select public.set_rental_offer(:rq, 'hour', 4140, true) as off1b \gset
reset role;
select tests.assert(
  :'off1'::jsonb #>> '{offer,period}' = 'hour' and (:'off1'::jsonb #>> '{offer,price_cents}')::bigint = 4140
  and (:'off1'::jsonb #>> '{offer,is_open}')::boolean and (:'off1'::jsonb #>> '{offer,chance_bps}')::int = 2700
  and :'off1b'::jsonb = :'off1'::jsonb
  and tests.r9q_status(:o, 'm_rent_offer') = 'completed:1'
  and not public.mission_doable(:o, 'm_rent_offer', 'rental_offered'),
  'set_rental_offer(): 41,40 € per hour (the maximum), AI chance 27 %, replayed per request; "first offer" done');

-- =============================================================================
-- D. AI tenants: chance per free place, paid by the households, then every period
-- =============================================================================
select tests.households() as hh0 \gset
select tests.cash(:o) as cash0 \gset
select public.rental_ai_arrivals(:o, public.game_now(), array[0.5]::double precision[]) as miss \gset
update public.rental_offers set ai_check_at = public.game_now() where owner_id = :o;
select public.rental_ai_arrivals(:o, public.game_now(), array[0.1]::double precision[]) as hit \gset
select public.rental_ai_arrivals(:o, public.game_now(), array[0.0]::double precision[]) as full \gset
select tests.assert(
  :miss::int = 0 and :hit::int = 1 and :full::int = 0
  and (select count(*) from public.rental_tenancies where owner_id = :o and status = 'active' and is_ai) = 1
  and (select ends_at - started_at between interval '24 hours' and interval '120 hours' and tenant_id is null
              and paid_cents = 4140 and next_due_at = started_at + interval '1 hour'
         from public.rental_tenancies where owner_id = :o and is_ai)
  and (select ai_check_at > public.game_now() + interval '59 minutes' from public.rental_offers where owner_id = :o)
  and tests.households() = :hh0::bigint - 4140 and tests.cash(:o) = :cash0::bigint + 4140
  and (select count(*) from public.notifications where player_id = :o and type_key = 'rental_new_tenant') = 1
  and tests.r9q_status(:o, 'm_rent_tenant') = 'completed:1'
  and tests.money_invariant() = 'ok',
  'an AI tenant moves in on a roll below the chance (not above), pays the first hour from the households, the place is full');

select (select started_at from public.rental_tenancies where owner_id = :o and is_ai) as ai_start \gset
select public.rentals_run_due(:'ai_start'::timestamptz + interval '1 hour 30 seconds') as run1 \gset
select tests.assert(
  (:'run1'::jsonb ->> 'paid')::int = 1
  and (select paid_cents from public.rental_tenancies where owner_id = :o and is_ai) = 8280
  and (select count(*) from public.rental_payments where owner_id = :o) = 2
  and tests.cash(:o) = :cash0::bigint + 8280 and tests.households() = :hh0::bigint - 8280
  and (select count(*) from public.ledger_transactions where kind = 'rent' and idempotency_key like 'rent:%'
          and initiated_by = :o) = 2
  and tests.money_invariant() = 'ok',
  'rentals_run_due(): the next hour is charged through the ledger (kind rent), once');
select public.rentals_run_due(:'ai_start'::timestamptz + interval '1 hour 40 seconds') as run1b \gset
select tests.assert((:'run1b'::jsonb ->> 'paid')::int = 0, 'rentals_run_due(): nothing twice');

-- the owner clears the room: at the next payment the AI tenant moves out without paying
select tests.login_as('authenticated', :o);
select public.save_layout(gen_random_uuid(), '#f3efe4', 'laminate', '[]'::jsonb) is not null as ok \gset
reset role;
select public.rentals_run_due(:'ai_start'::timestamptz + interval '2 hours 10 seconds') as run2 \gset
select tests.assert(
  (select status = 'ended' and end_reason = 'ai_unhappy' and paid_cents = 8280 from public.rental_tenancies where owner_id = :o and is_ai)
  and tests.cash(:o) = :cash0::bigint + 8280
  and (select count(*) from public.notifications where player_id = :o and type_key = 'rental_ended') = 1
  and public.rental_ai_arrivals(:o, public.game_now(), array[0.0]::double precision[]) = 0,
  'below Wohnwert 25 the AI tenant leaves at the next payment (ai_unhappy) and no new one comes');

-- =============================================================================
-- E. A player rents a place: market, errors, first day paid, XP, missions, feed
-- =============================================================================
select tests.login_as('authenticated', :o);
select public.save_layout(gen_random_uuid(), '#f3efe4', 'laminate', :'layout'::jsonb) is not null as ok \gset
select public.set_rental_offer(gen_random_uuid(), 'day', 3600, true) is not null as ok \gset
select tests.throws_key($$select public.rent_home(gen_random_uuid(), 'Vera_Vermieter')$$, 'rent_own_home',
  'rent_home(): not in the own home (NX141)');
reset role;
select tests.r9q_mission(:t, 'm_rent_home', 1);
select tests.r9q_mission(:o, 'm_rent_tenant', 1);
select tests.cash(:t) as tcash0 \gset
select tests.cash(:o) as cash1 \gset
select (select xp_total from public.profiles where id = :t) as txp0 \gset
select tests.login_as('authenticated', :t);
select public.get_rental_market() as market \gset
select tests.throws_key($$select public.rent_home(gen_random_uuid(), 'Niemand_Da')$$, 'player_not_found',
  'rent_home(): unknown owner');
select tests.throws_key($$select public.rent_home(gen_random_uuid(), 'Pia_Pleite')$$, 'rental_not_offered',
  'rent_home(): only where an offer is open (NX142)');
select public.rent_home(:rr, 'vera_vermieter') as rent1 \gset
select public.rent_home(:rr, 'vera_vermieter') as rent1b \gset
select tests.throws_key($$select public.rent_home(gen_random_uuid(), 'Vera_Vermieter')$$, 'already_renting',
  'rent_home(): one place at a time (NX144)');
select public.get_property(null) as tprop \gset
reset role;
select tests.login_as('authenticated', :p);
select tests.throws_key($$select public.rent_home(gen_random_uuid(), 'Vera_Vermieter')$$, 'rental_full',
  'rent_home(): not when every place is taken (NX143)');
select public.get_rental_market() as market2 \gset
select public.get_property('Vera_Vermieter') as oprop \gset
reset role;
select tests.assert(
  jsonb_array_length(:'market'::jsonb -> 'offers') >= 1
  and (select o2 ->> 'owner' = 'Vera_Vermieter' and (o2 ->> 'wohnwert')::int = 90 and o2 ->> 'period' = 'day'
              and (o2 ->> 'price_cents')::bigint = 3600 and (o2 ->> 'free')::int = 1 and (o2 ->> 'places')::int = 1
              and o2 #>> '{property,tier}' = 'flat' and jsonb_array_length(o2 #> '{property,placed}') = 9
              and o2 ? 'avatar_key' and o2 ? 'accessories' and o2 -> 'tenants' = '[]'::jsonb
         from jsonb_array_elements(:'market'::jsonb -> 'offers') o2 where o2 ->> 'owner' = 'Vera_Vermieter')
  and not exists (select 1 from jsonb_array_elements(:'market2'::jsonb -> 'offers') o2 where o2 ->> 'owner' = 'Vera_Vermieter'),
  'get_rental_market(): the open offer with Wohnwert, price, places, the room and the owner''s figure; gone once full');
select tests.assert(
  :'rent1'::jsonb #>> '{renting,owner}' = 'Vera_Vermieter' and :'rent1'::jsonb #>> '{renting,period}' = 'day'
  and (:'rent1'::jsonb #>> '{renting,paid_cents}')::bigint = 3600 and (:'rent1'::jsonb #>> '{renting,wohnwert}')::int = 90
  and (:'rent1'::jsonb #>> '{renting,xp_total}')::int = 216
  and jsonb_array_length(:'rent1'::jsonb #> '{renting,tenants}') = 1
  and :'rent1b'::jsonb = :'rent1'::jsonb
  and tests.cash(:t) = :tcash0::bigint - 3600 and tests.cash(:o) = :cash1::bigint + 3600
  and (select xp_total from public.profiles where id = :t) = :txp0::bigint + 216
  and tests.r9q_status(:t, 'm_rent_home') = 'completed:1' and tests.r9q_status(:o, 'm_rent_tenant') = 'completed:1'
  and (select count(*) from public.notifications where player_id = :o and type_key = 'rental_new_tenant' and title = 'Tim_Mieter ist eingezogen') = 1
  and not exists (select 1 from public.feed_items where actor_id = :t and kind = 'home_rented')
  and :'tprop'::jsonb #>> '{rental,renting,owner}' = 'Vera_Vermieter'
  and :'oprop'::jsonb #> '{rental,tenants,0}' ->> 'name' = 'Tim_Mieter'
  and not (:'oprop'::jsonb #> '{rental,tenants,0}' ->> 'is_ai')::boolean
  and :'oprop'::jsonb #> '{rental,tenants,0}' ? 'accessories'
  and tests.money_invariant() = 'ok',
  'rent_home(): the first day (36 €) goes from tenant to owner, 216 XP (108 base), missions for both, the tenant shows up in the home');
select tests.assert(
  public.feed_item_label('home_rented', '{"owner": "Vera_Vermieter"}') = 'Wohnt jetzt bei Vera_Vermieter'
  and not public.mission_doable(:t, 'm_rent_home', 'home_rented')
  and not public.mission_doable(:p, 'm_rent_home', 'home_rented'),
  'a flat is no feed news (villas are); renting is not doable while renting or when nothing is free');

-- =============================================================================
-- F. Notice: the tenant gives notice, it ends at the period end after the minimum
-- =============================================================================
-- no AI tenants from here on (the jobs below run days ahead)
update public.rental_offers set ai_check_at = public.game_now() + interval '30 days' where owner_id = :o;
select (select id from public.rental_tenancies where tenant_id = :t and status = 'active') as ten \gset
select (select started_at from public.rental_tenancies where id = :'ten') as tstart \gset
select tests.login_as('authenticated', :p);
select tests.throws_key(format($$select public.end_tenancy(gen_random_uuid(), %L)$$, :'ten'), 'tenancy_not_found',
  'end_tenancy(): only owner and tenant (NX145)');
reset role;
select tests.login_as('authenticated', :t);
select public.end_tenancy(gen_random_uuid(), :'ten') as notice \gset
reset role;
select public.rentals_run_due(:'tstart'::timestamptz + interval '23 hours') as run3 \gset
select tests.assert(
  (:'notice'::jsonb #>> '{renting,ends_at}')::timestamptz = :'tstart'::timestamptz + interval '24 hours'
  and :'notice'::jsonb #>> '{renting,notice_by}' = 'tenant'
  and (select count(*) from public.notifications where player_id = :o and type_key = 'rental_ended' and title = 'Tim_Mieter hat gekündigt') = 1
  and (select status from public.rental_tenancies where id = :'ten') = 'active',
  'end_tenancy(): a day tenancy ends after its minimum of 24 hours; the owner is told');
select public.rentals_run_due(:'tstart'::timestamptz + interval '24 hours 1 minute') as run4 \gset
select tests.assert(
  (select status = 'ended' and end_reason = 'notice_tenant' and paid_cents = 3600 from public.rental_tenancies where id = :'ten')
  and (select count(*) from public.rental_payments where tenancy_id = :'ten') = 1
  and (select count(*) from public.notifications where player_id = :t and type_key = 'rental_ended') = 1
  and tests.money_invariant() = 'ok',
  'at the end no further day is charged; both get a "rental_ended"');

-- =============================================================================
-- G. A player tenant who cannot pay is out at once
-- =============================================================================
select tests.fund(:p, 10000, 'test:rentals:p');
select tests.login_as('authenticated', :p);
select public.rent_home(gen_random_uuid(), 'Vera_Vermieter') is not null as ok \gset
reset role;
select (select id from public.rental_tenancies where tenant_id = :p and status = 'active') as ten2 \gset
select tests.m4j_drain_player(:p, 100, 'test:rentals:drain');
select public.rentals_run_due((select next_due_at from public.rental_tenancies where id = :'ten2') + interval '1 second') as run5 \gset
select tests.assert(
  (select status = 'ended' and end_reason = 'unpaid' and paid_cents = 3600 from public.rental_tenancies where id = :'ten2')
  and tests.cash(:p) = 100
  and (select count(*) from public.notifications where player_id = :p and type_key = 'rental_ended'
          and body = 'Die Miete konnte nicht bezahlt werden.') = 1
  and tests.money_invariant() = 'ok',
  'a tenant without the money for the next day: the tenancy ends (unpaid), nothing is booked');

-- =============================================================================
-- H. The owner gives notice; the daily rent summary
-- =============================================================================
select tests.login_as('authenticated', :t);
select public.rent_home(gen_random_uuid(), 'Vera_Vermieter') is not null as ok \gset
reset role;
select (select id from public.rental_tenancies where tenant_id = :t and status = 'active') as ten3 \gset
select tests.login_as('authenticated', :o);
select public.end_tenancy(gen_random_uuid(), :'ten3') as onotice \gset
reset role;
select public.rentals_run_due(public.game_now() + interval '1 day') as run6 \gset
select tests.assert(
  (select notice_by = 'owner' from public.rental_tenancies where id = :'ten3')
  and (select count(*) from public.notifications where player_id = :t and type_key = 'rental_ended' and title = 'Vera_Vermieter hat dir gekündigt') = 1
  and (select count(*) from public.notifications where player_id = :o and type_key = 'rental_rent_summary') = 1
  and (select title from public.notifications where player_id = :o and type_key = 'rental_rent_summary') like 'Mieteinnahmen gestern: % €'
  and (:'onotice'::jsonb -> 'tenants' -> 0 ->> 'notice_by') = 'owner',
  'the owner can give notice too (the tenant is told); once a day the owner gets yesterday''s rent');

-- =============================================================================
-- I. Account reset: as a tenant the owner is told; as an owner everything goes
-- =============================================================================
select tests.login_as('authenticated', :t);
select public.rent_home(gen_random_uuid(), 'Vera_Vermieter') is not null as ok \gset
reset role;
select (select id from public.rental_tenancies where tenant_id = :t and status = 'active') as ten4 \gset
select tests.login_as('authenticated', :t);
select public.reset_account(gen_random_uuid(), 'Tim_Mieter') is not null as ok \gset
reset role;
select tests.assert(
  (select status = 'ended' and end_reason = 'account_reset' and tenant_id is null from public.rental_tenancies where id = :'ten4')
  and not exists (select 1 from public.rental_payments where tenant_id = :t)
  and (select count(*) from public.notifications where player_id = :o and type_key = 'rental_ended' and title = 'Tim_Mieter ist ausgezogen'
          and payload ->> 'reason' = 'account_reset') = 1,
  'reset as a tenant: the tenancy ends, the owner keeps the history without the player');
select tests.login_as('authenticated', :o);
select public.reset_account(gen_random_uuid(), 'Vera_Vermieter') is not null as ok \gset
reset role;
select tests.assert(
  not exists (select 1 from public.rental_offers where owner_id = :o)
  and not exists (select 1 from public.rental_tenancies where owner_id = :o)
  and not exists (select 1 from public.rental_payments where owner_id = :o)
  and tests.money_invariant() = 'ok',
  'reset as an owner: offer, tenancies and payments are gone; the ledger still balances');

-- =============================================================================
-- J. The job is safe to run any time
-- =============================================================================
select tests.assert(
  public.rentals_run_due() ?& array['paid', 'ended', 'moved_in', 'summaries'],
  'rentals_run_due() reports paid, ended, moved in and summaries');
