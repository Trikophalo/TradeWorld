-- =============================================================================
-- 52 · M1 trading: place_order, cancel_order, fees, tax with loss pot,
--      limit orders and the order book, XP, unlocks, rate limit
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set c '''0c0c0c0c-0000-4000-8000-00000000000c'''
\set d '''0d0d0d0d-0000-4000-8000-00000000000d'''
\set e '''0e0e0e0e-0000-4000-8000-00000000000e'''
\set f '''0f0f0f0f-0000-4000-8000-00000000000f'''
\set g '''09090909-0000-4000-8000-000000000009'''

select tests.signup(:c, 'Carla') is not null and tests.signup(:d, 'Dora') is not null and tests.signup(:e, 'Emil') is not null
   and tests.signup(:f, 'Frieda') is not null and tests.signup(:g, 'Gustav') is not null as ok \gset
-- no resting orders from other tests may interfere
update public.sim_runtime set is_paused = false;

create or replace function tests.cash(p_player uuid) returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where owner_player_id = p_player and kind = 'player_cash' $$;
create or replace function tests.reserve(p_player uuid) returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where owner_player_id = p_player and kind = 'player_reserve' $$;
create or replace function tests.qty(p_player uuid, p_ticker text) returns bigint language sql as $$
  select coalesce(sum(p.quantity), 0)::bigint from public.positions p join public.securities s on s.id = p.security_id
   where p.player_id = p_player and s.ticker = p_ticker and p.status = 'open' $$;
-- moves the quote of a stock by a factor (simulates the market between ticks)
create or replace function tests.move_quote(p_ticker text, p_factor numeric) returns void language sql as $$
  update public.security_quotes q
     set last_price_e4 = round(q.last_price_e4 * p_factor), bid_e4 = round(q.bid_e4 * p_factor), ask_e4 = round(q.ask_e4 * p_factor)
    from public.securities s where s.id = q.security_id and s.ticker = p_ticker;
  update public.security_sim_state st set pending_player_flow = 0
    from public.securities s where s.id = st.security_id and s.ticker = p_ticker $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- 1. market buy, idempotency, ledger
-- =============================================================================
select tests.cash(:c) as c_cash0 \gset
select q.ask_e4 as kls_ask from public.security_quotes q join public.securities s on s.id = q.security_id where s.ticker = 'KLS' \gset
select gen_random_uuid() as r1 \gset
select tests.login_as('authenticated', :c);
select public.place_order(:'r1', 'KLS', 'buy', 'market', 10) as o1 \gset
select public.place_order(:'r1', 'KLS', 'buy', 'market', 10) as o1b \gset
reset role;
\echo '   buy:' :o1
select tests.assert(
  :'o1'::jsonb ->> 'status' = 'filled' and (:'o1'::jsonb ->> 'filled_quantity')::int = 10
  and (:'o1'::jsonb ->> 'fee_cents')::bigint = 100 and (:'o1'::jsonb ->> 'tax_cents')::bigint = 0
  and (:'o1'::jsonb ->> 'gross_cents')::bigint = public.order_value_cents(10, (:'o1'::jsonb ->> 'avg_price_e4')::bigint)
  and (:'o1'::jsonb ->> 'avg_price_e4')::bigint >= :kls_ask
  and :'o1'::jsonb ?& array['order_id', 'status', 'filled_quantity', 'avg_price_e4', 'gross_cents', 'fee_cents', 'tax_cents',
                            'realized_pnl_cents', 'cash_cents', 'xp_awarded', 'level', 'xp_total'],
  'market buy 10 KLS: filled at >= ask, gross = round_half_even(10 x avg / 100), fee 1 EUR, full contract');
select tests.assert(
  tests.cash(:c) = :c_cash0 - (:'o1'::jsonb ->> 'gross_cents')::bigint - 100
  and (:'o1'::jsonb ->> 'cash_cents')::bigint = tests.cash(:c),
  'cash dropped by gross + fee (' || (:'o1'::jsonb ->> 'gross_cents') || ' + 100 cents)');
select tests.assert(
  tests.qty(:c, 'KLS') = 10
  and (select p.cost_basis_cents = (:'o1'::jsonb ->> 'gross_cents')::bigint and p.avg_entry_price_e4 = (:'o1'::jsonb ->> 'avg_price_e4')::bigint
         from public.positions p where p.player_id = :c and p.status = 'open')
  and (select count(*) from public.position_lots l where l.player_id = :c and l.quantity_open = 10) = 1,
  'position appears with cost basis and one FIFO lot');
select tests.assert(
  :'o1b'::jsonb = :'o1'::jsonb and (select count(*) from public.orders where player_id = :c and request_id = :'r1') = 1
  and (select count(*) from public.trades where player_id = :c) = 1,
  'same request_id twice: one order, one trade, identical result');
select tests.assert(
  (select count(*) = 3 and sum(e.amount_cents) = 0 from public.ledger_entries e join public.trades t on t.ledger_transaction_id = e.transaction_id
    where t.order_id = (:'o1'::jsonb ->> 'order_id')::uuid),
  'the fill is one ledger transaction with 3 entries (cash, market, fees) summing to 0');
select tests.assert((select sum(amount_cents) from public.ledger_entries) = 0 and (select count(*) from public.ledger_audit()) = 0,
  'ledger: all entries sum to 0, cached balances match');
select tests.assert((:'o1'::jsonb ->> 'xp_awarded')::int = 20 and (:'o1'::jsonb ->> 'xp_total')::int = 20,
  'trade XP: 10 base x multiplier 2 for an order >= 100 EUR');

-- =============================================================================
-- 2. sell with profit: 25 % tax; wash-trade rule: no XP
-- =============================================================================
select tests.move_quote('KLS', 1.10);
select tests.cash(:c) as c_cash1 \gset
select tests.login_as('authenticated', :c);
select public.place_order(gen_random_uuid(), 'KLS', 'sell', 'market', 10) as o2 \gset
reset role;
\echo '   sell:' :o2
select tests.assert(
  (:'o2'::jsonb ->> 'realized_pnl_cents')::bigint
     = (:'o2'::jsonb ->> 'gross_cents')::bigint - 100 - (:'o1'::jsonb ->> 'gross_cents')::bigint
  and (:'o2'::jsonb ->> 'realized_pnl_cents')::bigint > 0
  and (:'o2'::jsonb ->> 'tax_cents')::bigint = public.div_round_half_even((:'o2'::jsonb ->> 'realized_pnl_cents')::numeric * 2500, 10000),
  'sell with profit: realised gain after fees taxed at 25 % (' || (:'o2'::jsonb ->> 'tax_cents') || ' cents)');
select tests.assert(
  tests.cash(:c) = :c_cash1 + (:'o2'::jsonb ->> 'gross_cents')::bigint - 100 - (:'o2'::jsonb ->> 'tax_cents')::bigint
  and tests.qty(:c, 'KLS') = 0
  and (select status from public.positions where player_id = :c and security_id = (select id from public.securities where ticker = 'KLS')) = 'closed',
  'cash grows by gross - fee - tax; position closed');
select tests.assert(
  (select count(*) = 4 and sum(e.amount_cents) = 0 from public.ledger_entries e join public.trades t on t.ledger_transaction_id = e.transaction_id
    where t.order_id = (:'o2'::jsonb ->> 'order_id')::uuid),
  'the sell is one balanced ledger transaction (cash, market, fees, taxes)');
select tests.assert(
  (:'o2'::jsonb ->> 'xp_awarded')::int = 0
  and (select is_wash_trade from public.trades where order_id = (:'o2'::jsonb ->> 'order_id')::uuid),
  'wash-trade rule: closing a position opened inside the window gives no XP');

-- =============================================================================
-- 3. loss pot: a loss is not taxed, a later gain only above the pot
-- =============================================================================
select tests.login_as('authenticated', :d);
select public.place_order(gen_random_uuid(), 'BRZ', 'buy', 'market', 20) as d1 \gset
reset role;
select tests.move_quote('BRZ', 0.8);
select tests.login_as('authenticated', :d);
select public.place_order(gen_random_uuid(), 'BRZ', 'sell', 'market', 20) as d2 \gset
reset role;
select tests.assert(
  (:'d2'::jsonb ->> 'realized_pnl_cents')::bigint < 0 and (:'d2'::jsonb ->> 'tax_cents')::bigint = 0
  and (select tax_loss_pot_cents from public.player_private where player_id = :d) = -(:'d2'::jsonb ->> 'realized_pnl_cents')::bigint,
  'sell with loss: no tax, loss pot = ' || (select tax_loss_pot_cents from public.player_private where player_id = :d) || ' cents');
select tax_loss_pot_cents as pot from public.player_private where player_id = :d \gset
select tests.login_as('authenticated', :d);
select public.place_order(gen_random_uuid(), 'BRZ', 'buy', 'market', 20) as d3 \gset
reset role;
select tests.move_quote('BRZ', 1.6);
select tests.login_as('authenticated', :d);
select public.place_order(gen_random_uuid(), 'BRZ', 'sell', 'market', 20) as d4 \gset
reset role;
select tests.assert(
  (:'d4'::jsonb ->> 'realized_pnl_cents')::bigint > :pot
  and (:'d4'::jsonb ->> 'tax_cents')::bigint
      = public.div_round_half_even(((:'d4'::jsonb ->> 'realized_pnl_cents')::bigint - :pot)::numeric * 2500, 10000)
  and (select tax_loss_pot_cents from public.player_private where player_id = :d) = 0,
  'later gain of ' || (:'d4'::jsonb ->> 'realized_pnl_cents') || ' cents is taxed only above the pot of ' || :pot || ' cents');
select tests.assert(
  (select realized_gains_cents > 0 and realized_losses_cents > 0 and tax_paid_cents = (:'d4'::jsonb ->> 'tax_cents')::bigint
     from public.player_tax_years where player_id = :d),
  'player_tax_years keeps realised gains, losses and tax paid');

-- =============================================================================
-- 4. error keys
-- =============================================================================
select tests.login_as('authenticated', :c);
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 100000)$$, 'insufficient_funds', 'buy beyond cash');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'VLT', 'sell', 'market', 5)$$, 'insufficient_position', 'sell without position');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 0)$$, 'invalid_quantity', 'quantity 0');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 100001)$$, 'invalid_quantity', 'quantity above 100 000');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'hold', 'market', 1)$$, 'invalid_argument', 'unknown side');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'NOPE', 'buy', 'market', 1)$$, 'unknown_security', 'unknown ticker');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'NEXA30', 'buy', 'market', 1)$$, 'not_tradable', 'the index is not tradable');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'limit', 1, 800000)$$, 'locked', 'limit orders are locked below level 3');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'NXB01', 'buy', 'market', 1)$$, 'locked', 'bonds are locked below level 5');
reset role;
update public.sim_runtime set is_paused = true;
select tests.login_as('authenticated', :c);
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 1)$$, 'market_paused', 'orders are rejected while paused');
reset role;
update public.sim_runtime set is_paused = false;
select tests.assert(
  (select count(*) from public.orders where player_id = :c) = 2,
  'rejected orders leave no order rows behind');

-- =============================================================================
-- 5. a big order moves the price and fills worse than a small one (rolled back)
-- =============================================================================
begin;
select public.ledger_transfer(public.ledger_system_account('mint'), public.ledger_player_account(:e), 100000000, 'admin_adjustment') as tx \gset
select q.ask_e4 as fgd_ask, q.last_price_e4 as fgd_last from public.security_quotes q join public.securities s on s.id = q.security_id where s.ticker = 'FGD' \gset
select tests.login_as('authenticated', :e);
select public.place_order(gen_random_uuid(), 'FGD', 'buy', 'market', 1) as small \gset
select public.place_order(gen_random_uuid(), 'FGD', 'buy', 'market', 100000) as big \gset
reset role;
select tests.assert(
  (:'big'::jsonb ->> 'avg_price_e4')::bigint > (:'small'::jsonb ->> 'avg_price_e4')::bigint
  and (:'big'::jsonb ->> 'avg_price_e4')::bigint > :fgd_ask * 1.001,
  'big order (100 000 FGD) fills worse: avg ' || (:'big'::jsonb ->> 'avg_price_e4') || ' vs small ' || (:'small'::jsonb ->> 'avg_price_e4')
  || ' (ask ' || :fgd_ask || ')');
select tests.assert(
  (select st.pending_player_flow from public.security_sim_state st join public.securities s on s.id = st.security_id where s.ticker = 'FGD') = 100001,
  'the net player flow waits for the next tick');
select public.market_tick() as tk \gset
select tests.assert(
  (select q.last_price_e4 > :fgd_last * 1.001 from public.security_quotes q join public.securities s on s.id = q.security_id where s.ticker = 'FGD')
  and (select st.pending_player_flow = 0 and st.maker_inventory < -90000 from public.security_sim_state st join public.securities s on s.id = st.security_id where s.ticker = 'FGD'),
  'the next tick moves FGD up (' || :fgd_last || ' -> ' || (select q.last_price_e4 from public.security_quotes q join public.securities s on s.id = q.security_id where s.ticker = 'FGD')
  || '); the market maker holds the inventory and hedges it over the following ticks');
rollback;

-- =============================================================================
-- 6. limit orders, order book, cancel, fill by the tick
-- =============================================================================
select tests.set_level(:c, 3);
select q.bid_e4 - 1 as lim, q.ask_e4 as kls_ask2 from public.security_quotes q join public.securities s on s.id = q.security_id where s.ticker = 'KLS' \gset
select tests.cash(:c) as c_cash2 \gset
select tests.reserve(:c) as c_res2 \gset
select tests.login_as('authenticated', :c);
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'limit', 10, :lim) as l1 \gset
select public.get_order_book('KLS') as book \gset
select public.get_my_portfolio() as pf \gset
reset role;
select tests.assert(
  :'l1'::jsonb ->> 'status' = 'open' and (:'l1'::jsonb ->> 'filled_quantity')::int = 0
  and (:'l1'::jsonb ->> 'reserved_cents')::bigint = public.order_value_cents(10, :lim) + 100
  and tests.cash(:c) = :c_cash2 - public.order_value_cents(10, :lim) - 100
  and tests.reserve(:c) = :c_res2 + public.order_value_cents(10, :lim) + 100,
  'buy limit below the market rests and reserves 10 x limit + fee in the reserve account');
select tests.assert(
  exists (select 1 from jsonb_array_elements(:'book'::jsonb -> 'bids') b
           where (b ->> 'price_e4')::bigint = :lim and (b ->> 'players')::int = 1 and (b ->> 'quantity')::bigint >= 10),
  'the resting limit is visible in get_order_book() (players = 1, no identities)');
select tests.assert(
  (select count(*) from jsonb_array_elements(:'pf'::jsonb -> 'open_orders') o where o ->> 'id' = :'l1'::jsonb ->> 'order_id') = 1
  and (:'pf'::jsonb ->> 'reserved_cents')::bigint = tests.reserve(:c)
  and (:'pf'::jsonb ->> 'cash_cents')::bigint = tests.cash(:c),
  'get_my_portfolio(): open order, cash and reserved amounts');
select tests.login_as('authenticated', :c);
select public.cancel_order(gen_random_uuid(), (:'l1'::jsonb ->> 'order_id')::uuid) as cx \gset
select tests.throws_key(format('select public.cancel_order(gen_random_uuid(), %L)', :'l1'::jsonb ->> 'order_id'), 'order_not_open', 'cancel twice');
select tests.throws_key($$select public.cancel_order(gen_random_uuid(), gen_random_uuid())$$, 'order_not_found', 'cancel unknown order');
reset role;
select tests.assert(
  :'cx'::jsonb = jsonb_build_object('order_id', :'l1'::jsonb ->> 'order_id', 'status', 'cancelled')
  and tests.cash(:c) = :c_cash2 and tests.reserve(:c) = :c_res2,
  'cancel_order releases the reservation completely');

-- a resting buy limit becomes marketable and is filled by the tick at the limit price
select tests.login_as('authenticated', :c);
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'limit', 10, :lim) as l2 \gset
reset role;
update public.security_quotes q set ask_e4 = :lim, bid_e4 = :lim - 50 from public.securities s where s.id = q.security_id and s.ticker = 'KLS';
select public.market_tick() as tk2 \gset
select tests.assert(
  (:'tk2'::jsonb ->> 'orders_filled')::int >= 1
  and (select status = 'filled' and avg_fill_price_e4 = :lim and reserved_cents = 0 from public.orders where id = (:'l2'::jsonb ->> 'order_id')::uuid)
  and tests.qty(:c, 'KLS') = 10 and tests.reserve(:c) = :c_res2
  and tests.cash(:c) = :c_cash2 - public.order_value_cents(10, :lim) - 100,
  'market_tick() fills the marketable limit at the limit price and releases the reservation');

-- a buy limit at or above the ask executes immediately, never above the limit
select tests.login_as('authenticated', :c);
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'limit', 1,
  (select q.ask_e4 + 500 from public.security_quotes q join public.securities s on s.id = q.security_id where s.ticker = 'KLS')) as l3 \gset
reset role;
select tests.assert(
  :'l3'::jsonb ->> 'status' = 'filled' and (:'l3'::jsonb ->> 'avg_price_e4')::bigint <= (:'l3'::jsonb ->> 'limit_price_e4')::bigint,
  'marketable buy limit fills immediately at or below its limit');

-- sell limit reserves shares
select tests.login_as('authenticated', :c);
select public.place_order(gen_random_uuid(), 'KLS', 'sell', 'limit', 5,
  (select q.ask_e4 * 2 from public.security_quotes q join public.securities s on s.id = q.security_id where s.ticker = 'KLS')) as l4 \gset
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'sell', 'market', 10)$$, 'insufficient_position',
  'reserved shares cannot be sold twice');
reset role;
select tests.assert(
  :'l4'::jsonb ->> 'status' = 'open'
  and (select reserved_quantity from public.positions p join public.securities s on s.id = p.security_id
        where p.player_id = :c and s.ticker = 'KLS' and p.status = 'open') = 5,
  'sell limit reserves 5 shares of the position');
select tests.login_as('authenticated', :c);
select public.cancel_order(gen_random_uuid(), (:'l4'::jsonb ->> 'order_id')::uuid) as cx2 \gset
reset role;
select tests.assert(
  (select reserved_quantity from public.positions p join public.securities s on s.id = p.security_id
    where p.player_id = :c and s.ticker = 'KLS' and p.status = 'open') = 0,
  'cancelling the sell limit releases the shares');

-- =============================================================================
-- 7. unlocks: bonds from level 5
-- =============================================================================
select tests.set_level(:c, 5);
select tests.login_as('authenticated', :c);
select public.place_order(gen_random_uuid(), 'NXB02', 'buy', 'market', 10) as b1 \gset
reset role;
select tests.assert(
  :'b1'::jsonb ->> 'status' = 'filled' and tests.qty(:c, 'NXB02') = 10
  and (:'b1'::jsonb ->> 'avg_price_e4')::bigint between 950000 and 1100000,
  'level 5 may buy bonds (10 x NXB02 at ' || (:'b1'::jsonb ->> 'avg_price_e4') || ' e4 per 100 EUR bond)');

-- =============================================================================
-- 8. XP rules and the tutorial
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.place_order(gen_random_uuid(), 'BRZ', 'buy', 'market', 1) as x1 \gset
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 5) as x2 \gset
reset role;
select tests.assert((:'x1'::jsonb ->> 'xp_awarded')::int = 0 and (:'x2'::jsonb ->> 'xp_awarded')::int = 20,
  'no trade XP below 100 EUR order value, 20 XP above');
begin;
update public.game_config set value = jsonb_set(value, '{xpSources,trade,maxTradesPerDay}', '2') where key = 'progression';
select tests.login_as('authenticated', :f);
select public.place_order(gen_random_uuid(), 'BRZ', 'buy', 'market', 5) as x3 \gset
select public.place_order(gen_random_uuid(), 'NPH', 'buy', 'market', 2) as x4 \gset
reset role;
select tests.assert((:'x3'::jsonb ->> 'xp_awarded')::int = 20 and (:'x4'::jsonb ->> 'xp_awarded')::int = 0,
  'daily trade XP cap (set to 2 for the test): the third XP-eligible trade gives 0');
rollback;
begin;
update public.game_config set value = jsonb_set(value, '{washTradeWindowSeconds}', '0') where key = 'trading';
select tests.login_as('authenticated', :f);
select public.place_order(gen_random_uuid(), 'KLS', 'sell', 'market', 5) as x5 \gset
reset role;
select tests.assert((:'x5'::jsonb ->> 'xp_awarded')::int = 20, 'outside the wash-trade window a closing sell earns XP');
rollback;

select gen_random_uuid() as rt \gset
select tests.login_as('authenticated', :f);
select public.complete_tutorial(:'rt') as tut1 \gset
select public.complete_tutorial(:'rt') as tut1b \gset
select public.complete_tutorial(gen_random_uuid()) as tut2 \gset
select public.get_my_portfolio() as fpf \gset
reset role;
select tests.assert(
  (:'tut1'::jsonb ->> 'xp_awarded')::int = 100 and (:'tut1'::jsonb ->> 'already_completed')::boolean = false
  and (:'tut1'::jsonb ->> 'level')::int = 2 and :'tut1b'::jsonb = :'tut1'::jsonb,
  'complete_tutorial(): 50 x 2 = 100 XP, level 2; replay returns the same result');
select tests.assert(
  (:'tut2'::jsonb ->> 'xp_awarded')::int = 0 and (:'tut2'::jsonb ->> 'already_completed')::boolean
  and (select count(*) from public.xp_events where player_id = :f and source = 'tutorial') = 1,
  'complete_tutorial() grants the XP only once');
select tests.assert(
  (:'fpf'::jsonb ->> 'level')::int = 2 and (:'fpf'::jsonb ->> 'xp_total')::int = 120
  and (:'fpf'::jsonb ->> 'xp_into_level')::int = 20 and (:'fpf'::jsonb ->> 'xp_for_next')::int = 283
  and (:'fpf'::jsonb ->> 'tutorial_completed')::boolean
  and exists (select 1 from public.player_unlocks where player_id = :f and unlock_key = 'jobs_intern'),
  'get_my_portfolio(): level 2, 120 XP, 20 into the level, 283 to level 3; level-2 unlocks granted');

-- =============================================================================
-- 9. rate limit (abuse.rateLimits.ordersPerDay set to 2 for the test)
-- =============================================================================
begin;
update public.game_config set value = jsonb_set(value, '{rateLimits,ordersPerDay}', '2') where key = 'abuse';
select tests.login_as('authenticated', :g);
select public.place_order(gen_random_uuid(), 'BRZ', 'buy', 'market', 1) as rl1 \gset
select public.place_order(gen_random_uuid(), 'BRZ', 'buy', 'market', 1) as rl2 \gset
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'BRZ', 'buy', 'market', 1)$$, 'rate_limited', 'third order of the day is rate limited');
reset role;
rollback;

select tests.assert((select sum(amount_cents) from public.ledger_entries) = 0 and (select count(*) from public.ledger_audit()) = 0,
  'after all trades: ledger sums to 0 and cached balances match');
select tests.assert(
  (select count(*) from public.positions p where p.quantity <> (select coalesce(sum(l.quantity_open), 0) from public.position_lots l where l.position_id = p.id)
      and p.player_id in (:c, :d, :e, :f, :g)) = 0,
  'every position equals the sum of its open FIFO lots');
