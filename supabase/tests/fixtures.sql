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
select public.rich_list_snapshot(true) is not null as ok \gset
select public.rich_news('rich_rank_entry', :p, 'Fixture', null, 87, 100, 1234567, null) is null as ok \gset
\pset tuples_only on
\pset format unaligned
select tests.login_as('authenticated', :p) is null as ok \gset
-- assign missions first, so the trades below complete some of them
select public.get_my_missions() is not null as ok \gset

\o :fixture_dir/complete_tutorial.json
select public.complete_tutorial(gen_random_uuid());
\o :fixture_dir/claim_vault.json
select public.claim_vault(gen_random_uuid());
\o :fixture_dir/place_order_market.json
select public.place_order(gen_random_uuid(), 'VLT', 'buy', 'market', 5000000);
\o :fixture_dir/place_order_limit.json
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'limit', 2000000, 10000);
\o :fixture_dir/place_order_bond.json
select public.place_order(gen_random_uuid(), 'NXB02', 'buy', 'market', 3000000);
\o :fixture_dir/place_order_sell.json
select public.place_order(gen_random_uuid(), 'VLT', 'sell', 'market', 2000000);
\o :fixture_dir/place_order_amount.json
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', null, null, 25000);
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
\o :fixture_dir/get_rich_list.json
select public.get_rich_list(5, 0, 'all');
\o :fixture_dir/get_rich_list_players.json
select public.get_rich_list(5, 0, 'players');
\o :fixture_dir/get_rich_list_news.json
select public.get_rich_list_news(5);
\o :fixture_dir/check_nickname.json
select public.check_nickname('Fixture_Zwei');
\o :fixture_dir/check_nickname_rejected.json
select public.check_nickname('Admin');
\o :fixture_dir/change_nickname.json
select public.change_nickname(gen_random_uuid(), 'Fixture_Neu');
\o :fixture_dir/daily_check_in.json
select public.daily_check_in(gen_random_uuid());
\o :fixture_dir/track_event.json
select public.track_event('open_rich_list');
\o :fixture_dir/get_my_missions.json
select public.get_my_missions();
\o :fixture_dir/claim_mission.json
select public.claim_mission(gen_random_uuid(),
  (select m.id from public.player_missions m where m.player_id = :p and m.status = 'completed' order by m.created_at limit 1));
\o :fixture_dir/get_my_portfolio_after_missions.json
select public.get_my_portfolio();
\o
reset role;
