-- =============================================================================
-- 55 · M1 security: who may execute what, player isolation
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set user_a '''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'''
\set c '''0c0c0c0c-0000-4000-8000-00000000000c'''

select tests.assert(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute'))
  = (select array_agg(x order by x collate "C") from unnest(array['admin_close_quarter', 'admin_run_tick', 'admin_set_paused', 'apply_for_job', 'are_friends', 'bid_artwork', 'buy_car', 'buy_floor', 'buy_furniture', 'buy_home',
          'can_read_ledger_transaction', 'cancel_auction', 'cancel_order', 'cancel_quit', 'capital_increase', 'change_nickname',
          'check_company_name', 'check_nickname', 'claim_daily_reward', 'claim_mission', 'claim_vault',
          'close_company', 'close_job_posting', 'company_deposit', 'company_withdraw', 'complete_tutorial',
          'counter_offer', 'create_artwork', 'create_job_posting', 'current_game_quarter', 'daily_check_in', 'delete_account', 'dismiss_ai_worker', 'expand_company', 'fire_employee',
          'found_company', 'game_day', 'game_now', 'get_art_rankings', 'get_art_studio', 'get_artwork',
          'get_artworks', 'get_candles', 'get_collection', 'get_company_applications', 'get_company_chat',
          'get_company_postings', 'get_company_ranking', 'get_company_team', 'get_daily_reward', 'get_employer', 'get_friends', 'get_job_board',
          'get_market_snapshot', 'get_my_applications', 'get_my_company', 'get_my_job', 'get_my_missions',
          'get_my_portfolio', 'get_my_skills', 'get_offers', 'get_order_book', 'get_player_card', 'get_property', 'get_rich_list',
          'get_rich_list_news', 'get_security_details', 'get_work_task', 'go_public', 'has_unlock', 'hire_ai_workers', 'is_admin',
          'is_company_insider', 'learn_skill', 'like_artwork', 'owns_ledger_account', 'place_order', 'post_company_message',
          'quit_job', 'remove_friend', 'report_company_logo', 'request_raise', 'reset_account', 'respond_application', 'respond_friend_request', 'respond_raise',
          'save_layout', 'search_players', 'sell_item', 'send_friend_request', 'set_ai_workers', 'set_avatar', 'set_company_banner', 'set_company_logo', 'set_company_marketing',
          'set_company_strategy', 'set_founder_payout', 'sign_contract',
          'start_auction', 'submit_work_task', 'subscribe_offer', 'track_event', 'train_employee', 'upgrade_company',
          'withdraw_application']
          -- M4f (76, 77): feed, notifications, league
          || array['get_feed', 'get_league', 'get_notifications', 'mark_notifications_read', 'react_feed']
          -- M4g (78): announced events
          || array['get_events']
          -- M4h (79): company events and news
          || array['choose_event_strategy', 'company_ai_context', 'get_company_event', 'get_company_news', 'start_event_step']
          -- M4i (80): upgrades and promotions
          || array['buy_upgrade', 'decline_promotion', 'get_upgrades', 'promote_employee', 'request_promotion']
          -- M4j (81): campaigns, deals and trust
          || array['break_deal', 'cancel_deal', 'forgive_loan', 'get_deal_board', 'get_deals', 'propose_deal', 'repay_loan',
                   'respond_deal', 'start_campaign']
          -- M4k (83): unique artwork titles, org chart
          || array['check_artwork_title', 'get_company_org']
          -- M5a (84): cryptocurrencies and own coins
          || array['burn_coin_tokens', 'check_coin_name', 'create_coin', 'crypto_trade', 'discontinue_coin', 'get_coin',
                   'get_crypto_market', 'get_my_coin', 'launch_coin', 'start_coin_action']
          -- friend code (85)
          || array['get_friend_code', 'redeem_friend_code']
          -- stock news (89)
          || array['get_stock_news']
          -- friends' investments (90)
          || array['get_player_holdings']) x),
  'authenticated can execute exactly the 9 helpers and the RPCs up to the friends'' investments (90)');
select tests.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname <> 'check_nickname'),
  'anon cannot execute any function except check_nickname');
select tests.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false)),
  'every SECURITY DEFINER function (incl. M1) pins search_path = ''''');
select tests.assert(
  (select bool_and(p.provolatile = 's') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('get_market_snapshot', 'get_candles', 'get_order_book', 'get_security_details', 'get_my_portfolio')),
  'read RPCs are STABLE');

-- anon: every RPC is refused by the privilege system
select tests.login_as('anon');
select tests.throws($$select public.get_market_snapshot()$$, '42501', 'anon: get_market_snapshot');
select tests.throws($$select public.get_candles('KLS', '1m')$$, '42501', 'anon: get_candles');
select tests.throws($$select public.get_order_book('KLS')$$, '42501', 'anon: get_order_book');
select tests.throws($$select public.get_security_details('KLS')$$, '42501', 'anon: get_security_details');
select tests.throws($$select public.get_my_portfolio()$$, '42501', 'anon: get_my_portfolio');
select tests.throws($$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 1000000)$$, '42501', 'anon: place_order');
select tests.throws($$select public.cancel_order(gen_random_uuid(), gen_random_uuid())$$, '42501', 'anon: cancel_order');
select tests.throws($$select public.claim_vault(gen_random_uuid())$$, '42501', 'anon: claim_vault');
select tests.throws($$select public.complete_tutorial(gen_random_uuid())$$, '42501', 'anon: complete_tutorial');
select tests.throws($$select public.admin_set_paused(true)$$, '42501', 'anon: admin_set_paused');
select tests.throws($$select public.admin_run_tick()$$, '42501', 'anon: admin_run_tick');
select tests.throws($$select public.admin_close_quarter()$$, '42501', 'anon: admin_close_quarter');
select tests.throws($$select public.change_nickname(gen_random_uuid(), 'Neuer_Name')$$, '42501', 'anon: change_nickname');
select tests.throws($$select public.get_rich_list()$$, '42501', 'anon: get_rich_list');
select tests.throws($$select public.get_rich_list_news()$$, '42501', 'anon: get_rich_list_news');
select tests.throws($$select public.get_my_missions()$$, '42501', 'anon: get_my_missions');
select tests.throws($$select public.claim_mission(gen_random_uuid(), gen_random_uuid())$$, '42501', 'anon: claim_mission');
select tests.throws($$select public.daily_check_in(gen_random_uuid())$$, '42501', 'anon: daily_check_in');
select tests.throws($$select public.track_event('open_rules')$$, '42501', 'anon: track_event');
select tests.assert((public.check_nickname('Freundlich_42') ->> 'allowed')::boolean, 'anon may pre-check a nickname (registration form)');
reset role;

-- authenticated without a JWT subject
select tests.login_as('authenticated', null);
select tests.throws_key($$select public.get_my_portfolio()$$, 'not_authenticated', 'authenticated role without user: not_authenticated');
reset role;

-- internal functions are not callable by players
select tests.login_as('authenticated', :user_a);
select tests.throws($$select public.market_tick()$$, '42501', 'players cannot run market_tick()');
select tests.throws($$select public.market_tick_at(now())$$, '42501', 'players cannot run market_tick_at()');
select tests.throws($$select public.run_due_jobs()$$, '42501', 'players cannot run run_due_jobs()');
select tests.throws($$select public.market_bootstrap()$$, '42501', 'players cannot run market_bootstrap()');
select tests.throws($$select public.close_game_quarter(1)$$, '42501', 'players cannot close quarters directly');
select tests.throws($$select public.execute_fill(gen_random_uuid(), 1, 1)$$, '42501', 'players cannot book fills');
select tests.throws($$select public.grant_xp('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'trade', 1000)$$, '42501', 'players cannot grant XP');
select tests.throws($$select * from public.security_sim_state$$, '42501', 'players cannot read the fair value');
reset role;

-- player isolation: C has an open order, A can neither see nor cancel it
select tests.set_level(:c, 5);
select tests.login_as('authenticated', :c);
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'limit', 1000000, 10000) as co \gset
reset role;
select tests.login_as('authenticated', :user_a);
select public.get_my_portfolio() as apf \gset
select tests.assert(
  (select count(*) from public.orders where player_id = :c) = 0
  and not exists (select 1 from jsonb_array_elements(:'apf'::jsonb -> 'open_orders') o where o ->> 'id' = :'co'::jsonb ->> 'order_id')
  and jsonb_array_length(:'apf'::jsonb -> 'recent_trades') = (select count(*) from public.trades)
  and (select count(*) from public.trades where player_id <> :user_a) = 0,
  'player A sees neither C''s orders nor C''s trades (table or get_my_portfolio)');
select tests.throws_key(format('select public.cancel_order(gen_random_uuid(), %L)', :'co'::jsonb ->> 'order_id'), 'order_not_found',
  'player A cannot cancel C''s order');
reset role;
select tests.assert((select status from public.orders where id = (:'co'::jsonb ->> 'order_id')::uuid) = 'open', 'C''s order is untouched');
select tests.login_as('authenticated', :c);
select public.cancel_order(gen_random_uuid(), (:'co'::jsonb ->> 'order_id')::uuid) as cco \gset
reset role;
