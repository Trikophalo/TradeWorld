-- =============================================================================
-- 30 · Row level security from the client's point of view (c), (d)
-- =============================================================================
-- Uses the players created in 20_signup_ledger.sql (A = Anna, B = Ben).
-- Everything happens in one transaction that is rolled back at the end.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set user_a '''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'''
\set user_b '''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'''
\set company '''cccccccc-cccc-4ccc-8ccc-cccccccccccc'''

-- share quantities are *_e6 after the M2 schema migration (older-database mode: not yet)
select case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders'
                           and column_name = 'quantity_e6') then 'quantity_e6' else 'quantity' end as qcol,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders'
                           and column_name = 'quantity_e6') then 1000000 else 1 end as qscale \gset

begin;

-- ---- fixtures (as owner) ------------------------------------------------------
insert into public.orders (player_id, security_id, request_id, side, type, :qcol)
select :user_b, id, gen_random_uuid(), 'buy', 'market', 7 from public.securities where ticker = 'VLT';
insert into public.positions (player_id, security_id, :qcol, avg_entry_price_e4, cost_basis_cents)
select p.id, s.id, 10 * :qscale, 800000, 800000 from public.profiles p cross join public.securities s where s.ticker = 'KLS';
insert into public.notifications (player_id, type_key, title)
select p.id, 'system', 'Hallo ' || p.nickname from public.profiles p;
insert into public.watchlist_items (player_id, security_id)
select :user_b, id from public.securities where ticker = 'NPH';
insert into public.xp_events (player_id, source, amount, game_day) values (:user_b, 'trade', 10, current_date);
insert into public.analyst_ratings (security_id, analyst_name, rating, target_price_e4)
select id, 'Test Research', 'buy', 900000 from public.securities where ticker = 'KLS';
insert into public.game_config (key, value) values ('fees', '{"orderFeeCents": 100}'), ('sim', '{"noise": 0.01}');
insert into public.game_config_public_keys (key) values ('fees');
insert into public.feed_items (actor_id, kind, visibility) values (:user_a, 'big_win', 'friends'), (:user_a, 'ipo', 'public');
insert into public.player_achievements (player_id, achievement_key, progress, unlocked_at) values
  (:user_b, 'first_trade', 1, now()), (:user_b, 'trades_100', 42, null);

-- a player company founded by A with internal state and an unpublished report
insert into public.companies (id, name, slug, sector_key, legal_form, founder_id, ceo_id, shares_outstanding)
values (:company, 'Annas Apps', 'annas-apps', 'tech', 'small_business', :user_a, :user_a, 1000);
insert into public.company_state (company_id) values (:company);
insert into public.ledger_accounts (kind, owner_company_id) values ('company_cash', :company);
insert into public.company_quarter_reports (company_id, game_quarter_id, revenue_cents, net_income_cents, shares_outstanding)
select :company, (public.current_game_quarter()).id, 5000000, 400000, 1000;
insert into public.company_products (company_id, name, status) values
  (:company, 'Geheimprojekt', 'in_development'), (:company, 'Todo-App', 'active');

-- a job with a work task and its hidden solution for A
insert into public.player_jobs (id, player_id, company_id, job_definition_id, request_id, tier, title, salary_cents_per_hour)
select 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', :user_a, j.company_id, j.id, gen_random_uuid(), j.tier, j.title, j.salary_cents_per_hour
  from public.job_definitions j where j.key = 'brz_intern_assistant';
insert into public.work_tasks (id, player_id, player_job_id, definition_key, expires_at)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', :user_a, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'sort_inbox', now() + interval '1 hour');
insert into public.work_task_solutions (task_id, solution) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '{"answer": 2}');

-- =============================================================================
-- (c) authenticated as player A
-- =============================================================================
select tests.login_as('authenticated', :user_a);
select tests.assert(auth.uid() = :user_a and current_user = 'authenticated', 'session is role authenticated with A''s JWT');

-- own private rows are visible, B's are not
select tests.assert((select count(*) from public.player_private) = 1
  and (select count(*) from public.player_private where player_id = :user_b) = 0, 'player_private: only own row');
select tests.assert((select count(*) from public.player_settings) = 1, 'player_settings: only own row');
select tests.assert((select count(*) from public.orders) = 1
  and (select count(*) from public.orders where player_id = :user_b) = 0, 'orders: only own (B has one, A sees none of it)');
select tests.assert((select count(*) from public.positions) = 1
  and (select bool_and(player_id = :user_a) from public.positions), 'positions: only own');
select tests.assert((select count(*) from public.notifications) = 1
  and (select title from public.notifications) = 'Hallo Anna', 'notifications: only own');
select tests.assert((select count(*) from public.watchlist_items) = 0, 'watchlist: B''s items are invisible');
select tests.assert((select count(*) from public.xp_events) = 0, 'xp_events: B''s events are invisible');
select tests.assert((select count(*) from public.vaults) = 1 and (select count(*) from public.login_streaks) = 1, 'vault / streak: only own');
select tests.assert((select count(*) from public.notification_preferences where player_id = :user_b) = 0
  and (select count(*) from public.notification_preferences) >= 20, 'notification preferences: only own');

-- ledger: own accounts + the company account A is an insider of
select tests.assert(
  (select count(*) from public.ledger_accounts where owner_player_id = :user_a) = 2
  and (select count(*) from public.ledger_accounts where owner_player_id = :user_b) = 0
  and (select count(*) from public.ledger_accounts where kind = 'system') = 0
  and (select count(*) from public.ledger_accounts where owner_company_id = :company) = 1
  and (select count(*) from public.ledger_accounts) = 3,
  'ledger_accounts: own cash/reserve + own company, no system or foreign accounts');
select tests.assert(
  (select count(*) from public.ledger_entries) = 3
  and not exists (select 1 from public.ledger_entries e where not public.owns_ledger_account(e.account_id)),
  'ledger_entries: only entries on own accounts (mint side and B''s entries hidden)');
select tests.assert((select count(*) from public.ledger_transactions) = 2, 'ledger_transactions: only those touching own accounts');
select tests.assert(
  (select balance_cents from public.v_my_accounts where kind = 'player_cash') = 750000
  and (select count(*) from public.v_my_accounts) = 2, 'v_my_accounts shows own balances only');
select tests.assert((select count(*) from public.v_my_ledger) = 3, 'v_my_ledger shows own bookings');
select tests.assert(
  (select count(*) = 1 and min(market_value_cents) = 84000 and min(unrealized_pnl_cents) = 4000 from public.v_my_positions),
  'v_my_positions: own position marked to market (10 x 84.00 = 840.00 EUR, +40.00 EUR)');
select tests.assert((select count(*) from public.v_my_vault) = 1, 'v_my_vault: own vault');

-- no direct writes on game tables
select tests.throws($$insert into public.ledger_entries (transaction_id, account_id, amount_cents, balance_after_cents)
  select t.id, a.id, 100000000, 0 from public.ledger_transactions t, public.ledger_accounts a limit 1$$,
  '42501', 'cannot insert ledger entries');
select tests.throws($$insert into public.ledger_transactions (kind) values ('admin_adjustment')$$, '42501', 'cannot insert ledger transactions');
select tests.throws($$update public.ledger_accounts set balance_cents = 999999999$$, '42501', 'cannot update ledger accounts');
select tests.throws(format($$insert into public.orders (player_id, security_id, request_id, side, type, %I)
  select auth.uid(), id, gen_random_uuid(), 'buy', 'market', 1 from public.securities limit 1$$, :'qcol'),
  '42501', 'cannot insert orders directly (must use place_order RPC)');
select tests.throws($$update public.orders set status = 'filled'$$, '42501', 'cannot update orders');
select tests.throws($$delete from public.orders$$, '42501', 'cannot delete orders');
select tests.throws(format('update public.positions set %I = 1000000', :'qcol'), '42501', 'cannot update positions');
select tests.throws($$update public.profiles set level = 50, xp_total = 999999 where id = auth.uid()$$, '42501', 'cannot update own profile (level/xp)');
select tests.throws($$insert into public.xp_events (player_id, source, amount, game_day) values (auth.uid(), 'admin', 100000, current_date)$$,
  '42501', 'cannot insert XP events');
select tests.throws($$update public.security_quotes set last_price_e4 = 1$$, '42501', 'cannot update quotes');
select tests.throws($$update public.game_config set value = '{}'$$, '42501', 'cannot update game_config');
select tests.throws($$insert into public.admin_users (user_id) values (auth.uid())$$, '42501', 'cannot make oneself admin');
select tests.throws($$update public.vaults set accrual_started_at = now() - interval '100 days'$$, '42501', 'cannot manipulate the vault');
select tests.throws($$insert into public.player_achievements (player_id, achievement_key, unlocked_at) values (auth.uid(), 'level_50', now())$$,
  '42501', 'cannot grant oneself achievements');
select tests.throws($$update public.player_achievements set unlocked_at = now()$$, '42501', 'cannot unlock achievements via the seen_at grant');

-- internal functions are not callable
select tests.throws($$select public.ledger_post('admin_adjustment', '[]'::jsonb)$$, '42501', 'cannot call ledger_post');
select tests.throws($$select public.ledger_transfer(gen_random_uuid(), gen_random_uuid(), 1, 'transfer')$$, '42501', 'cannot call ledger_transfer');
select tests.throws($$select public.rate_limit_hit(auth.uid(), 'x', 1, 1)$$, '42501', 'cannot call rate_limit_hit');
select tests.throws($$select public.ensure_game_quarters(1)$$, '42501', 'cannot call ensure_game_quarters');
select tests.throws($$select public.config_jsonb('sim')$$, '42501', 'cannot read config through config_jsonb');
select tests.throws($$select public.invoke_edge_function('tick-runner')$$, '42501', 'cannot call invoke_edge_function');
select tests.throws($$select public.money_supply_cents()$$, '42501', 'cannot call money_supply_cents');

-- simulation internals / server-only tables
select tests.throws($$select * from public.security_sim_state$$, '42501', 'cannot read fair values (security_sim_state)');
select tests.throws($$select * from public.ai_investor_holdings$$, '42501', 'cannot read AI investor holdings');
select tests.throws($$select * from public.ai_investors$$, '42501', 'cannot read AI investor parameters');
select tests.throws($$select * from public.sim_runtime$$, '42501', 'cannot read the runner lease (sim_runtime)');
select tests.throws($$select * from public.sim_rng_streams$$, '42501', 'cannot read RNG state');
select tests.throws($$select * from public.sector_sim_state$$, '42501', 'cannot read sector shocks');
select tests.throws($$select * from public.work_task_solutions$$, '42501', 'cannot read work task solutions');
select tests.throws($$select * from public.insider_violations$$, '42501', 'cannot read insider violations');
select tests.throws($$select * from public.scheduled_event_secrets$$, '42501', 'cannot read event secrets');
select tests.throws($$select * from public.random_event_definitions$$, '42501', 'cannot read random event odds');
select tests.throws($$select * from public.admin_users$$, '42501', 'cannot read admin_users');
select tests.throws($$select * from public.internal_settings$$, '42501', 'cannot read internal_settings');
select tests.assert((select count(*) from public.invite_codes) = 0, 'invite_codes: no rows for non-admins');
select tests.assert((select count(*) from public.work_tasks) = 1, 'own work task (prompt) is readable while its solution is not');

-- public data through tables and views
select tests.assert((select count(*) from public.profiles) = 2, 'profiles are public');
select tests.assert((select count(*) from public.v_securities) = (select count(*) from public.companies where is_ai) + 5
  and (select count(*) from public.v_securities where last_price_e4 is not null) = (select count(*) from public.companies where is_ai) + 5, 'v_securities: 25 stocks + 4 bonds + index with quotes');
select tests.assert((select count(*) from public.v_stock_fundamentals where pe_ratio > 0) = case when (select count(*) from public.companies where is_ai) = 25 then 19 else 12 end, 'v_stock_fundamentals: P/E for the 19 profitable companies');
select tests.assert((select round(pe_ratio::numeric, 1) from public.v_stock_fundamentals where ticker = 'KLS') = 28.0, 'KlarSoft P/E = 28');
select tests.assert((select count(*) from public.v_bonds) = 4, 'v_bonds');
select tests.assert((select count(*) from public.v_index_members where index_key = 'NEXA30') = 15, 'v_index_members');
select tests.assert((select count(*) from public.v_company_profiles) = (select count(*) from public.companies where is_ai) + 1, 'v_company_profiles: 25 AI companies + Annas Apps');
select tests.assert((select count(*) from public.v_job_board) >= 15, 'v_job_board');
select tests.assert((select count(*) from public.v_player_profiles) = 2, 'v_player_profiles');
select tests.assert((select count(*) from public.v_cap_table) = (select count(*) from public.companies where is_ai), 'v_cap_table');
select tests.assert((select count(*) from public.v_event_calendar) = 0 and (select count(*) from public.v_news) = 0
  and (select count(*) from public.v_ipo_calendar) = 0 and (select count(*) from public.v_league_standings) = 0
  and (select count(*) from public.v_friends) = 0, 'calendar/news/ipo/league/friends views are readable (empty)');
select tests.assert((select count(*) from public.game_quarters) >= 16 and (public.current_game_quarter()).id is not null,
  'game calendar readable, current_game_quarter() callable');
select tests.assert((select count(*) from public.candles) = 0 and (select count(*) from public.price_ticks) = 0
  and (select count(*) from public.order_book_levels) = 0, 'market data tables readable');
select tests.assert((select count(*) from public.achievements) >= 40 and (select count(*) from public.lifestyle_items) = 5, 'catalogues readable');

-- game_config: only allowlisted documents
select tests.assert((select array_agg(key) from public.game_config) = array['fees'], 'game_config: only allowlisted keys are visible');

-- level-gated data
select tests.assert((select count(*) from public.analyst_ratings) = 0, 'analyst ratings hidden without the level-7 unlock');

-- achievements of others: unlocked ones only
select tests.assert((select array_agg(achievement_key) from public.player_achievements where player_id = :user_b) = array['first_trade'],
  'player_achievements: others'' unlocked achievements visible, progress hidden');

-- company insider (A is founder)
select tests.assert(public.is_company_insider(:company), 'A is insider of the own company');
select tests.assert((select count(*) from public.company_state) = 1, 'company_state: own company only (AI companies hidden)');
select tests.assert((select count(*) from public.company_quarter_reports) = 1, 'unpublished report visible to the insider');
select tests.assert((select count(*) from public.company_products) = 2, 'insider sees products in development');

-- allowed direct writes (narrow)
select tests.assert(tests.row_count($$update public.player_settings set theme = 'light', sounds_enabled = false$$) = 1, 'may update own settings');
select tests.throws($$update public.player_settings set player_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, '42501', 'cannot change settings owner column');
select tests.assert(tests.row_count($$insert into public.watchlist_items (player_id, security_id)
  select auth.uid(), id from public.securities where ticker in ('KLS', 'BRZ')$$) = 2, 'may add to own watchlist');
select tests.throws($$insert into public.watchlist_items (player_id, security_id)
  select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id from public.securities where ticker = 'KLS'$$, '42501', 'cannot add to B''s watchlist');
select tests.assert(tests.row_count($$delete from public.watchlist_items where security_id = (select id from public.securities where ticker = 'BRZ')$$) = 1,
  'may delete own watchlist item');
select tests.assert(tests.row_count($$delete from public.watchlist_items$$) = 1, 'delete without filter only hits own rows');
select tests.assert(tests.row_count($$update public.notifications set read_at = now()$$) = 1, 'may mark own notification read (and only own)');
select tests.throws($$update public.notifications set title = 'hacked'$$, '42501', 'cannot change notification content');
select tests.assert(tests.row_count($$update public.notification_preferences set push_enabled = false where type_key = 'vault_full'$$) = 1,
  'may update own notification preference');
select tests.assert(tests.row_count($$insert into public.push_subscriptions (player_id, endpoint, p256dh, auth_key)
  values (auth.uid(), 'https://push.example/abc', 'k', 'a')$$) = 1, 'may register a push subscription');
select tests.throws($$insert into public.push_subscriptions (player_id, endpoint, p256dh, auth_key)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'https://push.example/xyz', 'k', 'a')$$, '42501', 'cannot register a push subscription for B');
select tests.assert(tests.row_count($$update public.player_unlocks set seen_at = now()$$) >= 2, 'may mark own unlocks as seen');

-- =============================================================================
-- (c) authenticated as player B
-- =============================================================================
reset role;
select tests.login_as('authenticated', :user_b);

select tests.assert((select count(*) from public.orders) = 1 and (select count(*) from public.watchlist_items) = 1, 'B sees own order and watchlist');
select tests.assert(tests.row_count($$update public.notifications set read_at = now()$$) = 1
  and (select count(*) from public.notifications) = 1, 'B can only touch the own notification');
select tests.assert(tests.row_count($$update public.player_settings set theme = 'light' where player_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$) = 0,
  'B cannot update A''s settings (0 rows)');
select tests.assert(not public.is_company_insider(:company), 'B is no insider of A''s company');
select tests.assert((select count(*) from public.company_state) = 0, 'B cannot read company_state of A''s company');
select tests.assert((select count(*) from public.company_quarter_reports) = 0, 'B cannot read the unpublished report (insider rule)');
select tests.assert((select array_agg(name) from public.company_products) = array['Todo-App'], 'B sees only active products');
select tests.assert((select count(*) from public.ledger_accounts) = 2, 'B sees only own ledger accounts (not A''s company account)');
select tests.assert((select last_revenue_cents is null from public.v_company_profiles where slug = 'annas-apps'),
  'v_company_profiles does not leak unpublished figures');
select tests.assert((select array_agg(kind) from public.feed_items) = array['ipo'], 'feed: B sees A''s public item but not the friends-only one');
select tests.assert((select count(*) from public.work_tasks) = 0 and (select count(*) from public.player_jobs) = 0, 'B cannot read A''s job and tasks');

-- state changes by the server ...
reset role;
update public.company_quarter_reports set published_at = now() where company_id = :company;
insert into public.friendships (requester_id, addressee_id, status) values (:user_a, :user_b, 'accepted');
insert into public.player_unlocks (player_id, unlock_key) values (:user_b, 'analyst_reports');
insert into public.admin_users (user_id) values (:user_b);
select tests.login_as('authenticated', :user_b);

-- ... become visible
select tests.assert((select count(*) from public.company_quarter_reports) = 1, 'published report is public');
select tests.assert((select last_revenue_cents from public.v_company_profiles where slug = 'annas-apps') = 5000000, 'v_company_profiles shows published figures');
select tests.assert((select count(*) from public.feed_items) = 2 and (select count(*) from public.v_feed) = 2, 'feed: friends-only item visible after friendship');
select tests.assert((select count(*) from public.v_friends where nickname = 'Anna' and status = 'accepted') = 1, 'v_friends shows the friend');
select tests.assert(public.are_friends(:user_a, :user_b), 'are_friends() for own pair');
select tests.assert(not public.are_friends(:user_a, gen_random_uuid()), 'are_friends() refuses pairs without the caller');
select tests.assert((select count(*) from public.analyst_ratings) = 1, 'analyst ratings visible with the unlock');
select tests.assert(public.is_admin(), 'B is admin now');
select tests.assert((select count(*) from public.invite_codes) >= 2, 'admin can read invite codes');
select tests.assert((select count(*) from public.game_config) = 2, 'admin can read all game_config documents');
select tests.throws($$update public.game_config set value = '{}'$$, '42501', 'even admins have no direct write (RPC only)');
select tests.throws($$select * from public.security_sim_state$$, '42501', 'admins have no direct access to sim internals either');

-- =============================================================================
-- (d) anon
-- =============================================================================
reset role;
select tests.login_as('anon', null);
select tests.assert(current_user = 'anon' and auth.uid() is null, 'session is role anon');
select tests.throws($$select * from public.profiles$$, '42501', 'anon cannot read profiles');
select tests.throws($$select * from public.player_private$$, '42501', 'anon cannot read player_private');
select tests.throws($$select * from public.ledger_accounts$$, '42501', 'anon cannot read ledger accounts');
select tests.throws($$select * from public.ledger_entries$$, '42501', 'anon cannot read ledger entries');
select tests.throws($$select * from public.orders$$, '42501', 'anon cannot read orders');
select tests.throws($$select * from public.security_quotes$$, '42501', 'anon cannot read quotes');
select tests.throws($$select * from public.security_sim_state$$, '42501', 'anon cannot read sim state');
select tests.throws($$select * from public.game_config$$, '42501', 'anon cannot read game_config');
select tests.throws($$select * from public.invite_codes$$, '42501', 'anon cannot read invite codes');
select tests.throws($$select * from public.v_securities$$, '42501', 'anon cannot read public views');
select tests.throws($$select * from public.v_my_accounts$$, '42501', 'anon cannot read private views');
select tests.throws($$select * from public.v_player_profiles$$, '42501', 'anon cannot read player profiles view');
select tests.throws($$insert into public.watchlist_items (player_id, security_id) values (gen_random_uuid(), gen_random_uuid())$$, '42501', 'anon cannot write');
select tests.throws($$select public.is_admin()$$, '42501', 'anon cannot call helper functions');
select tests.throws($$select public.ledger_post('admin_adjustment', '[]'::jsonb)$$, '42501', 'anon cannot call ledger_post');
select tests.throws($$select public.current_game_quarter()$$, '42501', 'anon cannot call current_game_quarter');

-- =============================================================================
-- service_role keeps full access (edge functions / tick runner)
-- =============================================================================
reset role;
select tests.login_as('service_role', null);
select tests.assert((select count(*) from public.security_sim_state) = (select count(*) from public.companies where is_ai) + 4, 'service_role reads sim state');
select tests.assert((select count(*) from public.ledger_accounts where kind = 'system') >= 7, 'service_role reads all ledger accounts');
select tests.assert((select count(*) from public.orders) = 2, 'service_role bypasses RLS');
select tests.assert(public.ensure_game_quarters(3) = 0, 'service_role may call internal functions');
select tests.assert(tests.row_count($$update public.security_quotes set tick_seq = tick_seq + 1$$) = (select count(*) from public.companies where is_ai) + 5, 'service_role may write quotes');

reset role;
rollback;
