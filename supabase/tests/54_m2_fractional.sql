-- =============================================================================
-- 54 · M2 fractional shares (millionths) and orders by amount
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set b '''0b1b1b1b-0000-4000-8000-00000000001b'''
select tests.signup(:b, 'Bruno') is not null as ok \gset
select tests.set_level(:b, 3);
update public.sim_runtime set is_paused = false;

-- half a share by quantity ----------------------------------------------------
select public.treasury_balance_cents() as t0 \gset
select tests.login_as('authenticated', :b);
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 500000) as h1 \gset
reset role;
select tests.assert(
  :'h1'::jsonb ->> 'status' = 'filled' and (:'h1'::jsonb ->> 'quantity_e6')::bigint = 500000
  and (:'h1'::jsonb ->> 'filled_quantity_e6')::bigint = 500000
  and (:'h1'::jsonb ->> 'gross_cents')::bigint = public.value_cents(500000, (:'h1'::jsonb ->> 'avg_price_e4')::bigint)
  and not (:'h1'::jsonb ? 'quantity') and not (:'h1'::jsonb ? 'filled_quantity'),
  'buy 0.5 KLS: quantity_e6 500 000, gross = round_half_even(q_e6 x price_e4 / 1e8) = ' || (:'h1'::jsonb ->> 'gross_cents') || ' cents');
select tests.assert(public.treasury_balance_cents() = :t0 + 100, 'the 1 EUR order fee goes to the treasury');

-- by amount: buy for exactly 1 000 EUR including the fee ------------------------
select tests.cash(:b) as c0 \gset
select tests.login_as('authenticated', :b);
select public.place_order(gen_random_uuid(), 'VLT', 'buy', 'market', null, null, 100000) as a1 \gset
reset role;
\echo '   amount buy:' :a1
select tests.assert(
  :'a1'::jsonb ->> 'status' = 'filled'
  and (:'a1'::jsonb ->> 'gross_cents')::bigint + (:'a1'::jsonb ->> 'fee_cents')::bigint between 99999 and 100000
  and tests.cash(:b) between :c0 - 100000 and :c0 - 99999
  and (:'a1'::jsonb ->> 'quantity_e6')::bigint % 1000000 <> 0,
  'buy by amount (1 000 EUR incl. fee): pays ' || ((:'a1'::jsonb ->> 'gross_cents')::bigint + 100) || ' cents for '
  || (:'a1'::jsonb ->> 'quantity_e6') || ' millionths of a share');

-- by amount: sell for 300 EUR gross --------------------------------------------
select tests.login_as('authenticated', :b);
select public.place_order(gen_random_uuid(), 'VLT', 'sell', 'market', null, null, 30000) as a2 \gset
reset role;
select tests.assert(
  :'a2'::jsonb ->> 'status' = 'filled' and (:'a2'::jsonb ->> 'gross_cents')::bigint between 30000 and 30001,
  'sell by amount: gross proceeds ' || (:'a2'::jsonb ->> 'gross_cents') || ' cents for 300 EUR (before fee and tax)');

-- argument and size errors ------------------------------------------------------
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 1000000, null, 10000)$$, 'invalid_argument', 'quantity and amount together');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market')$$, 'invalid_argument', 'neither quantity nor amount');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', null, null, 150)$$, 'order_too_small', 'amount minus fee below 1 EUR');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 1)$$, 'order_too_small', 'one millionth of a share is below the minimum order value');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'VLT', 'sell', 'market', null, null, 100000000)$$, 'insufficient_position', 'selling more by amount than held');
reset role;

-- a sell of >= 99.9 % of the position sells all of it ------------------------------
select p.quantity_e6 as vlt_q from public.positions p join public.securities s on s.id = p.security_id
 where p.player_id = :b and s.ticker = 'VLT' and p.status = 'open' \gset
select tests.login_as('authenticated', :b);
select public.place_order(gen_random_uuid(), 'VLT', 'sell', 'market', (:vlt_q::bigint * 9995 / 10000)) as a3 \gset
reset role;
select tests.assert(
  (:'a3'::jsonb ->> 'filled_quantity_e6')::bigint = :vlt_q and tests.qty(:b, 'VLT') = 0,
  'selling 99.95 % of a position sells the whole position (no dust left)');

-- limit by amount rests with a reservation within the amount ---------------------------
select q.bid_e4 - 100 as lim from public.security_quotes q join public.securities s on s.id = q.security_id where s.ticker = 'NPH' \gset
select tests.login_as('authenticated', :b);
select public.place_order(gen_random_uuid(), 'NPH', 'buy', 'limit', null, :lim, 50000) as a4 \gset
select public.get_my_portfolio() as pf \gset
select public.get_order_book('NPH', 5) as ob \gset
reset role;
select tests.assert(
  :'a4'::jsonb ->> 'status' = 'open'
  and (:'a4'::jsonb ->> 'quantity_e6')::bigint = floor(49900 * 100000000.0 / :lim)
  and (:'a4'::jsonb ->> 'reserved_cents')::bigint = public.value_cents((:'a4'::jsonb ->> 'quantity_e6')::bigint, :lim) + 100
  and (:'a4'::jsonb ->> 'reserved_cents')::bigint <= 50000,
  'limit buy by amount: quantity = floor((amount - fee) / limit), reservation within the amount');
select tests.assert(
  (select bool_and(x ? 'quantity_e6' and x ? 'reserved_quantity_e6' and not (x ? 'quantity')) from jsonb_array_elements(:'pf'::jsonb -> 'positions') x)
  and (select bool_and(x ? 'quantity_e6' and x ? 'filled_quantity_e6') from jsonb_array_elements(:'pf'::jsonb -> 'open_orders') x)
  and (select bool_and(x ? 'quantity_e6') from jsonb_array_elements(:'pf'::jsonb -> 'recent_trades') x)
  and (select bool_and(x ? 'quantity_e6' and not (x ? 'quantity')) from jsonb_array_elements(:'ob'::jsonb -> 'bids') x),
  'portfolio positions/orders/trades and order book levels use *_e6 quantities');
select tests.assert(
  (select (x ->> 'quantity_e6')::bigint % 1000000 <> 0 and (x ->> 'market_value_cents')::bigint > 0
     from jsonb_array_elements(:'pf'::jsonb -> 'positions') x where x ->> 'ticker' = 'KLS'),
  'a fractional position is valued at quantity_e6 x price / 1e8');
select tests.assert(
  (select count(*) from public.positions p
    where p.player_id = :b and p.quantity_e6 <> (select coalesce(sum(l.quantity_open_e6), 0) from public.position_lots l where l.position_id = p.id)) = 0
  and (select sum(amount_cents) from public.ledger_entries) = 0 and (select count(*) from public.ledger_audit()) = 0,
  'fractional fills keep positions = sum of open lots; ledger balanced');
