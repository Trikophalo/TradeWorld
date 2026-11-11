-- =============================================================================
-- Dumps one real response of every M1 read/write RPC as JSON files, so the
-- frontend's Zod schemas can be tested against the database (contract test:
-- src/features/game/api.test.ts). Run by verify_local.sh when
-- NEXA_FIXTURE_DIR is set. Not an assertion file.
-- =============================================================================
\set QUIET 1
\set p '''f1f1f1f1-0000-4000-8000-0000000000f1'''
select tests.signup(:p, 'Fixture') is not null as ok \gset
update public.sim_runtime set is_paused = false;
-- enough XP for limit orders and bonds
update public.profiles set xp_total = 5000, level = 6 where id = :p;
select public.market_tick() is not null as ok \gset
\pset tuples_only on
\pset format unaligned
select tests.login_as('authenticated', :p) is null as ok \gset

\o :fixture_dir/complete_tutorial.json
select public.complete_tutorial(gen_random_uuid());
\o :fixture_dir/claim_vault.json
select public.claim_vault(gen_random_uuid());
\o :fixture_dir/place_order_market.json
select public.place_order(gen_random_uuid(), 'VLT', 'buy', 'market', 5);
\o :fixture_dir/place_order_limit.json
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'limit', 2, 10000);
\o :fixture_dir/place_order_bond.json
select public.place_order(gen_random_uuid(), 'NXB02', 'buy', 'market', 3);
\o :fixture_dir/place_order_sell.json
select public.place_order(gen_random_uuid(), 'VLT', 'sell', 'market', 2);
\o :fixture_dir/get_market_snapshot.json
select public.get_market_snapshot();
\o :fixture_dir/get_candles.json
select public.get_candles('VLT', '5m', 20);
\o :fixture_dir/get_candles_index.json
select public.get_candles('NEXA30', '1y', 10);
\o :fixture_dir/get_order_book.json
select public.get_order_book('KLS', 6);
\o :fixture_dir/get_security_details.json
select public.get_security_details('VLT');
\o :fixture_dir/get_my_portfolio.json
select public.get_my_portfolio();
\o :fixture_dir/cancel_order.json
select public.cancel_order(gen_random_uuid(), (select id from public.orders where player_id = :p and status = 'open' limit 1));
\o
reset role;
