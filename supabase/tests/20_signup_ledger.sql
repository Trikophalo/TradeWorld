-- =============================================================================
-- 20 · Sign-up trigger, ledger invariants, rate limit, idempotency helpers
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

-- fixed ids, reused by 30_rls.sql
\set user_a '''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'''
\set user_b '''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'''

insert into public.invite_codes (code, max_uses) values ('TEST-INVITE', 5), ('TEST-SINGLE', 1);

-- (b) sign-up is rejected without invite code / age confirmation ----------------
select tests.throws(
  $$insert into auth.users (email, raw_user_meta_data) values ('x@test.dev', '{"age_confirmed": true}')$$,
  'NX005', 'sign-up without invite code is rejected');
select tests.throws(
  $$insert into auth.users (email, raw_user_meta_data) values ('x@test.dev', '{"age_confirmed": true, "invite_code": "WRONG"}')$$,
  'NX005', 'sign-up with unknown invite code is rejected');
select tests.throws(
  $$insert into auth.users (email, raw_user_meta_data) values ('x@test.dev', '{"invite_code": "TEST-INVITE"}')$$,
  'NX007', 'sign-up without 18+ confirmation is rejected');
select tests.assert((select count(*) from auth.users) = 0 and (select count(*) from public.profiles) = 0,
  'rejected sign-ups leave no rows behind');

-- (b) successful sign-ups ---------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  (:user_a, 'a@test.dev', '{"invite_code": "test-invite", "age_confirmed": true, "nickname": "Anna"}'),
  (:user_b, 'b@test.dev', '{"invite_code": " TEST-INVITE ", "age_confirmed": true, "nickname": "Ben"}');

select tests.assert((select nickname from public.profiles where id = :user_a) = 'Anna', 'profile created with the requested nickname');
select tests.assert((select level = 1 and xp_total = 0 and reputation = 50 from public.profiles where id = :user_a), 'profile starts at level 1, reputation 50');
select tests.assert((select age_confirmed_at is not null from public.player_private where player_id = :user_a), 'player_private created with age confirmation');
select tests.assert(exists (select 1 from public.player_settings where player_id = :user_a), 'player_settings created');
select tests.assert(exists (select 1 from public.vaults where player_id = :user_a), 'vault created');
select tests.assert(exists (select 1 from public.login_streaks where player_id = :user_a), 'login streak row created');
select tests.assert(
  (select array_agg(kind::text order by kind) from public.ledger_accounts where owner_player_id = :user_a)
  = array['player_cash', 'player_reserve'],
  'cash and reserve ledger accounts created');
select tests.assert(
  (select balance_cents from public.ledger_accounts where owner_player_id = :user_a and kind = 'player_cash') = 1000000,
  'starting capital = 1 000 000 cents (fallback, game_config is empty)');
select tests.assert(
  (select count(*) from public.ledger_transactions where kind = 'starting_capital' and ref_id = :user_a) = 1
  and (select sum(e.amount_cents) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.kind = 'starting_capital' and t.ref_id = :user_a) = 0
  and (select count(*) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.kind = 'starting_capital' and t.ref_id = :user_a) = 2,
  'starting capital is one balanced transaction with two entries');
select tests.assert((select coalesce(sum(amount_cents), -1) from public.ledger_entries) = 0, 'sum of all ledger entries is zero');
select tests.assert((select count(*) from public.ledger_audit()) = 0, 'ledger_audit(): cached balances match the entries');
select tests.assert(
  (select count(*) from public.notification_preferences where player_id = :user_a)
  = (select count(*) from public.notification_types) and (select count(*) from public.notification_types) >= 20,
  'default notification preferences for every notification type');
select tests.assert(
  (select count(*) from public.player_unlocks where player_id = :user_a)
  = (select count(*) from public.unlocks where level <= 1) and (select count(*) from public.unlocks where level <= 1) >= 2,
  'level-1 unlocks granted');
select tests.assert((select used_count from public.invite_codes where code = 'TEST-INVITE') = 2, 'invite code consumed (case/space insensitive)');
select tests.assert((select count(*) from public.invite_code_redemptions where code = 'TEST-INVITE') = 2, 'invite redemptions recorded');

-- nickname collisions, exhausted codes, config override (rolled back) --------------
begin;
insert into auth.users (email, raw_user_meta_data) values
  ('c@test.dev', '{"invite_code": "TEST-SINGLE", "age_confirmed": true, "nickname": "anna"}');
select tests.assert(
  (select nickname ~ '^anna[0-9]{5}$' from public.profiles p join auth.users u on u.id = p.id where u.email = 'c@test.dev'),
  'taken nickname gets a numeric suffix');
select tests.throws(
  $$insert into auth.users (email, raw_user_meta_data) values ('d@test.dev', '{"invite_code": "TEST-SINGLE", "age_confirmed": true}')$$,
  'NX005', 'used-up invite code is rejected');

insert into public.game_config (key, value) values
  ('economy', '{"startingCapitalCents": 2500000}'), ('auth', '{"inviteRequired": false}');
insert into auth.users (email, raw_user_meta_data) values ('e@test.dev', '{"age_confirmed": "true", "nickname": "!!"}');
select tests.assert(
  (select a.balance_cents from public.ledger_accounts a join auth.users u on u.id = a.owner_player_id
    where u.email = 'e@test.dev' and a.kind = 'player_cash') = 2500000,
  'starting capital is read from game_config (economy.startingCapitalCents)');
select tests.assert(
  (select nickname ~ '^Trader[0-9]{5}$' from public.profiles p join auth.users u on u.id = p.id where u.email = 'e@test.dev'),
  'invalid nickname falls back to TraderNNNNN; invite optional when auth.inviteRequired = false');
rollback;

-- (e) ledger immutability -----------------------------------------------------------
select tests.throws($$update public.ledger_entries set amount_cents = amount_cents + 1$$, 'NX003', 'ledger entries cannot be updated');
select tests.throws($$delete from public.ledger_entries$$, 'NX003', 'ledger entries cannot be deleted');
select tests.throws($$truncate public.ledger_entries$$, 'NX003', 'ledger entries cannot be truncated');
select tests.throws($$update public.ledger_transactions set description = 'x'$$, 'NX003', 'ledger transactions cannot be updated');
select tests.throws($$delete from public.ledger_transactions$$, 'NX003', 'ledger transactions cannot be deleted');
select tests.throws(
  $$update public.ledger_accounts set balance_cents = balance_cents + 100000 where owner_player_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'NX003', 'cached balance cannot be edited directly');
select tests.throws(
  $$insert into public.ledger_accounts (kind, system_key, balance_cents, allow_negative) values ('system', 'cheat', 500, true)$$,
  'NX003', 'accounts cannot be created with a balance');

-- (e) unbalanced / malformed transactions ---------------------------------------------
select tests.throws($$
  do $t$
  declare v_tx uuid;
  begin
    insert into public.ledger_transactions (kind) values ('transfer') returning id into v_tx;
    insert into public.ledger_entries (transaction_id, account_id, amount_cents, balance_after_cents)
    values (v_tx, public.ledger_system_account('mint'), -500, 0),
           (v_tx, public.ledger_player_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 400, 0);
    set constraints all immediate;
  end $t$;
$$, 'NX002', 'unbalanced transaction (raw inserts) fails at constraint check');
select tests.throws($$
  do $t$
  declare v_tx uuid;
  begin
    insert into public.ledger_transactions (kind) values ('transfer') returning id into v_tx;
    insert into public.ledger_entries (transaction_id, account_id, amount_cents, balance_after_cents)
    values (v_tx, public.ledger_system_account('mint'), -500, 0);
    set constraints all immediate;
  end $t$;
$$, 'NX002', 'single-entry transaction fails');
select tests.throws($$
  do $t$
  begin
    insert into public.ledger_transactions (kind) values ('transfer');
    set constraints all immediate;
  end $t$;
$$, 'NX002', 'transaction without entries fails');

-- the deferred check also fires at COMMIT (not only with SET CONSTRAINTS)
begin;
insert into public.ledger_transactions (id, kind) values ('00000000-0000-4000-8000-00000000dead', 'transfer');
insert into public.ledger_entries (transaction_id, account_id, amount_cents, balance_after_cents)
values ('00000000-0000-4000-8000-00000000dead', public.ledger_system_account('mint'), -777, 0);
\echo '   (the next ERROR line is expected: COMMIT of an unbalanced transaction)'
\set ON_ERROR_STOP 0
commit;
\set ON_ERROR_STOP 1
select tests.assert(:'SQLSTATE' = 'NX002', 'COMMIT failed with SQLSTATE NX002');
select tests.assert(
  not exists (select 1 from public.ledger_transactions where id = '00000000-0000-4000-8000-00000000dead')
  and not exists (select 1 from public.ledger_entries where amount_cents = -777),
  'COMMIT of an unbalanced transaction is rolled back by the deferred constraint trigger');

select tests.throws($$
  select public.ledger_post('transfer', jsonb_build_array(
    jsonb_build_object('account_id', public.ledger_system_account('mint'), 'amount_cents', -100),
    jsonb_build_object('account_id', public.ledger_system_account('fees'), 'amount_cents', 99)))
$$, 'NX002', 'ledger_post rejects unbalanced entries');
select tests.throws($$
  select public.ledger_post('transfer', jsonb_build_array(
    jsonb_build_object('account_id', public.ledger_system_account('mint'), 'amount_cents', 0.5),
    jsonb_build_object('account_id', public.ledger_system_account('fees'), 'amount_cents', -0.5)))
$$, 'NX007', 'ledger_post rejects fractional cents');
select tests.throws($$
  select public.ledger_transfer(
    public.ledger_player_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), public.ledger_system_account('fees'),
    1000001, 'fee')
$$, 'NX001', 'player cash account cannot go negative');

-- entries cannot be appended to a committed transaction
select tests.throws($$
  insert into public.ledger_entries (transaction_id, account_id, amount_cents, balance_after_cents)
  select t.id, public.ledger_system_account('mint'), 5, 0 from public.ledger_transactions t limit 1
$$, 'NX003', 'entries cannot be appended to an existing transaction');

-- a valid transfer, idempotent replay ---------------------------------------------------
select public.ledger_transfer(
  public.ledger_player_account(:user_a), public.ledger_player_account(:user_a, 'player_reserve'),
  250000, 'order_reserve', 'test reserve', 'test', null, 'test:reserve:1', :user_a) as tx1 \gset
select public.ledger_transfer(
  public.ledger_player_account(:user_a), public.ledger_player_account(:user_a, 'player_reserve'),
  250000, 'order_reserve', 'test reserve', 'test', null, 'test:reserve:1', :user_a) as tx2 \gset
select tests.assert(:'tx1' = :'tx2', 'ledger_post is idempotent per idempotency key');
select tests.assert(
  (select balance_cents from public.ledger_accounts where owner_player_id = :user_a and kind = 'player_cash') = 750000
  and (select balance_cents from public.ledger_accounts where owner_player_id = :user_a and kind = 'player_reserve') = 250000,
  'transfer moved 2 500.00 EUR exactly once (cash 750 000, reserve 250 000)');
select tests.assert(
  (select e.balance_after_cents from public.ledger_entries e
    where e.transaction_id = :'tx1' and e.amount_cents > 0) = 250000,
  'balance_after_cents is recorded on the entry');
select tests.assert((select count(*) from public.ledger_audit()) = 0, 'ledger_audit() still clean');
select tests.assert(
  public.money_supply_cents() =
  (select sum(balance_cents) from public.ledger_accounts where kind <> 'system')
  and (select sum(balance_cents) from public.ledger_accounts) = 0,
  'money supply = non-system balances; all balances sum to zero');

-- frozen account
begin;
update public.ledger_accounts set is_frozen = true where owner_player_id = :user_b and kind = 'player_cash';
select tests.throws($$
  select public.ledger_transfer(public.ledger_system_account('mint'),
    public.ledger_player_account('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 100, 'admin_adjustment')
$$, 'NX008', 'frozen account rejects bookings');
rollback;

-- rate limit + idempotency helpers ---------------------------------------------------------
select tests.assert(
  public.rate_limit_hit(:user_a, 'test_action', 3, 3600)
  and public.rate_limit_hit(:user_a, 'test_action', 3, 3600)
  and public.rate_limit_hit(:user_a, 'test_action', 3, 3600)
  and not public.rate_limit_hit(:user_a, 'test_action', 3, 3600),
  'rate_limit_hit allows 3 hits per window and blocks the 4th');
select tests.throws(
  $$select public.rate_limit_enforce('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test_action', 3, 3600)$$,
  'NX004', 'rate_limit_enforce raises NX004');
select tests.assert(public.rate_limit_hit(:user_b, 'test_action', 3, 3600), 'rate limits are per player');

select tests.assert(public.request_begin(:user_a, '11111111-1111-4111-8111-111111111111', 'test') is null, 'request_begin: new request');
select tests.throws(
  $$select public.request_begin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'test')$$,
  'NX009', 'request_begin: duplicate while in progress raises NX009');
select public.request_complete(:user_a, '11111111-1111-4111-8111-111111111111', '{"ok": true}') \gset
select tests.assert(
  public.request_begin(:user_a, '11111111-1111-4111-8111-111111111111', 'test') = '{"ok": true}'::jsonb,
  'request_begin: replay returns the stored result');

-- share quantities are *_e6 after the M2 schema migration (older-database mode: not yet)
select case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders'
                           and column_name = 'quantity_e6') then 'quantity_e6' else 'quantity' end as qcol \gset

-- unique (player_id, request_id) on orders
insert into public.orders (player_id, security_id, request_id, side, type, :qcol)
select :user_a, id, '22222222-2222-4222-8222-222222222222', 'buy', 'market', 10 from public.securities where ticker = 'KLS';
select tests.throws(format($$
  insert into public.orders (player_id, security_id, request_id, side, type, %I)
  select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, '22222222-2222-4222-8222-222222222222', 'sell', 'market', 5
    from public.securities where ticker = 'BRZ'
$$, :'qcol'), '23505', 'orders.request_id is unique per player (idempotency)');
select tests.throws(format($$
  insert into public.orders (player_id, security_id, request_id, side, type, %I)
  select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, gen_random_uuid(), 'buy', 'limit', 5 from public.securities where ticker = 'BRZ'
$$, :'qcol'), '23514', 'limit order without limit price violates the check constraint');
