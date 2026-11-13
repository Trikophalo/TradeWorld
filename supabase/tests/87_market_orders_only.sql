-- =============================================================================
-- 87 · Limit orders can be switched off (ADR-117)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''08708708-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Lina_Limit') is not null as ok \gset
select tests.set_level(:a, 5);
update public.sim_runtime set is_paused = false;

begin;
insert into public.game_config (key, value) values ('trading', '{}') on conflict (key) do nothing;
select tests.set_cfg('trading', array['limitOrders'], 'false'::jsonb);
select tests.login_as('authenticated', :a);
select tests.throws_key(
  $$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'limit', 1000000, 10000)$$,
  'locked', 'place_order(limit): refused while trading.limitOrders is false');
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 1000000) ->> 'status' as st \gset
reset role;
select tests.assert(:'st' is not null and (select count(*) from public.orders where player_id = :a and type = 'limit') = 0,
  'market orders still work, no limit order was stored');
rollback;
