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
  = array['admin_close_quarter', 'admin_run_tick', 'admin_set_paused', 'apply_for_job', 'are_friends',
          'can_read_ledger_transaction', 'cancel_order', 'cancel_quit', 'change_nickname', 'check_company_name',
          'check_nickname', 'claim_daily_reward', 'claim_mission', 'claim_vault', 'close_company',
          'close_job_posting', 'company_deposit', 'company_withdraw', 'complete_tutorial', 'counter_offer',
          'create_job_posting', 'current_game_quarter', 'daily_check_in', 'fire_employee', 'found_company',
          'game_day', 'game_now', 'get_candles', 'get_company_applications', 'get_company_chat',
          'get_company_postings', 'get_company_team', 'get_daily_reward', 'get_employer', 'get_job_board',
          'get_market_snapshot', 'get_my_applications', 'get_my_company', 'get_my_job', 'get_my_missions',
          'get_my_portfolio', 'get_my_skills', 'get_order_book', 'get_player_card', 'get_rich_list',
          'get_rich_list_news', 'get_security_details', 'get_work_task', 'has_unlock', 'is_admin',
          'is_company_insider', 'learn_skill', 'owns_ledger_account', 'place_order', 'post_company_message',
          'quit_job', 'report_company_logo', 'request_raise', 'respond_application', 'respond_raise',
          'set_ai_workers', 'set_avatar', 'set_company_logo', 'set_company_marketing', 'sign_contract',
          'submit_work_task', 'track_event', 'train_employee', 'upgrade_company', 'withdraw_application'],
  'authenticated can execute exactly the 9 helpers and the RPCs up to M3f (61)');
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
