-- =============================================================================
-- 84 · M5a: cryptocurrencies and own coins (ADR-101)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set t '''08408408-0000-4000-8000-0000000000a1'''
\set k '''08408408-0000-4000-8000-0000000000b1'''
\set h '''08408408-0000-4000-8000-0000000000c1'''
\set n '''08408408-0000-4000-8000-0000000000d1'''
update public.invite_codes set max_uses = max_uses + 6 where code = 'M1-TESTS';
select tests.signup(:t, 'Krypto_Tom') is not null and tests.signup(:k, 'Krypto_Kim') is not null
   and tests.signup(:h, 'Krypto_Hal') is not null and tests.signup(:n, 'Krypto_Neu') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:t, 10);
select tests.set_level(:k, 14);
select tests.set_level(:h, 10);
select tests.set_level(:n, 9);
select tests.fund(:t, 10000000, 'test:m5a:t');
select tests.fund(:k, 20000000, 'test:m5a:k');
select tests.fund(:h, 5000000, 'test:m5a:h');
select tests.fund(:n, 1000000, 'test:m5a:n');

create or replace function tests.coin(p_ticker text) returns public.crypto_coins language sql as $$
  select c.* from public.crypto_coins c join public.securities s on s.id = c.security_id where s.ticker = p_ticker $$;
-- every pool: ledger balance + not yet booked AI flows = pool cash
create or replace function tests.pools_ok() returns boolean language sql as $$
  select not exists (select 1 from public.crypto_coins c join public.ledger_accounts a on a.id = c.pool_account_id
                      where a.balance_cents + c.pending_flow_cents <> c.pool_cash_cents) $$;
-- the hourly part has run for this hour (so crypto_run_due() only resolves actions)
create or replace function tests.crypto_hour_done() returns void language sql as $$
  update public.crypto_state set hour_done = date_bin('1 hour', public.game_now(), '2000-01-01 00:00:00+00'::timestamptz) $$;
-- no random events (chance 0) / back to the stored config
create or replace function tests.crypto_events_off() returns void language sql as $$
  update public.game_config
     set value = jsonb_set(value, '{events}', (select jsonb_agg(jsonb_set(e, '{chanceBps}', '0') order by o)
                                                 from jsonb_array_elements(value -> 'events') with ordinality x(e, o)))
   where key = 'crypto' $$;
grant execute on all functions in schema tests to public;
select value as crypto_cfg0 from public.game_config where key = 'crypto' \gset
select public.crypto_cfg() as cfg \gset

-- =============================================================================
-- A. Formulas (port of src/lib/sim/crypto.ts, same cases as crypto.test.ts)
-- =============================================================================
select tests.assert(
  public.crypto_pool_tokens_at(1000000, 10000) = 10000000000 and public.crypto_pool_price_e4(1000000, 10000000000) = 10000
  and public.crypto_pool_price_e4(1000000, 0) = 0,
  'poolAt / poolPriceE4: 10.000 € at 1 € are 10.000 coins');
select tests.assert(
  (select round(b.tokens_out_e6 / 1e6, 4) = 99.0099 from public.crypto_swap_buy(1000000, 10000000000, 10000, 0) b)
  and (select round(b.tokens_out_e6 / 1e6, 2) = 3333.33
              and public.crypto_pool_price_e4(b.cash_after_cents, b.tokens_after_e6) = 22500
         from public.crypto_swap_buy(1000000, 10000000000, 500000, 0) b),
  'swapBuy: fewer coins the more is bought, the price rises with the square of the cash (x 2,25)');
select tests.assert(
  (select b.fee_cents = 1000 and b.cash_after_cents = 1100000
          and b.cash_after_cents::numeric * b.tokens_after_e6 >= 1000000::numeric * 10000000000
          and (select s.cash_out_cents < 100000 and s.cash_out_cents > 97000
                 from public.crypto_swap_sell(b.cash_after_cents, b.tokens_after_e6, b.tokens_out_e6, 100) s)
     from public.crypto_swap_buy(1000000, 10000000000, 100000, 100) b),
  'swapBuy/swapSell: the fee stays in the pool, k never shrinks, a round trip loses the fees');
select tests.assert(
  public.crypto_slippage_bps(10000, 10100, 'buy') = 100 and public.crypto_slippage_bps(10000, 9800, 'sell') = 200
  and (select public.crypto_slippage_bps(10000, public.div_round_half_even(100000::numeric * 1e8, b.tokens_out_e6), 'buy') > 900
         from public.crypto_swap_buy(1000000, 10000000000, 100000, 0) b),
  'buySlippageBps: 1.000 € into a pool of 10.000 € slip about 10 %');
select tests.assert(
  (select abs(public.crypto_pool_price_e4(f.cash_cents, f.tokens_e6) - 1200) <= 10
     from public.crypto_apply_flow(5000000, public.crypto_pool_tokens_at(5000000, 1000), ln(1.2)) f)
  and (select abs(public.crypto_pool_price_e4(f.cash_cents, f.tokens_e6) - 500) <= 10
         from public.crypto_apply_flow(5000000, public.crypto_pool_tokens_at(5000000, 1000), ln(0.5)) f),
  'applyFlow: the market''s flow moves the price by a log return');
select tests.assert(
  abs(public.crypto_tick_return(0.4, 1.6, 0, 0.03, 0, 0, 86400) - 0.048) < 1e-9
  and abs(public.crypto_tick_return(0.06, 1, 0, 0, 1, 5, 86400) - 0.06) < 1e-9
  and abs(public.crypto_tick_return(0.35, 1.2, 0.1, 0, 0, 0, 86400) - 0.1) < 1e-9,
  'tickReturn: beta times the regime drift, beta 1 follows only the market shock, extra drift of own coins');
select tests.assert(
  public.crypto_stable_return(9000, 10000, 0.5, 0, 0, 3600) > 0
  and abs(exp(public.crypto_stable_return(9000, 10000, 0.5, 0, 0, 3600)) * 9000 - 9000 * sqrt(10000 / 9000.0)) < 0.01
  and public.crypto_stable_return(10000, 10000, 0.5, 0, 0, 5) = 0,
  'stableReturn: pulled back to the peg');
select tests.assert(
  public.crypto_pick_regime(:'cfg', 0) = 'bull' and public.crypto_pick_regime(:'cfg', 0.5) = 'flat'
  and public.crypto_pick_regime(:'cfg', 0.99) = 'bear'
  and public.crypto_regime_hours(:'cfg', 0) = 24 and public.crypto_regime_hours(:'cfg', 1) = 72,
  'pickRegime / regimeHours: by weight, one to three days');
select tests.assert(
  public.crypto_pool_tokens_at(500000, 1000) = 50000000000
  and public.crypto_launch_team_e6(50000000000, 2000) = 12500000000,
  'launchPool: 50.000 coins at 0,10 €, the team keeps 20 % on top');
select tests.assert(
  abs(public.crypto_player_drift_day(:'cfg', 0, 0) + 0.06) < 1e-9 and abs(public.crypto_player_drift_day(:'cfg', 50, 50) - 0.08) < 1e-9
  and abs(public.crypto_player_sigma_day(:'cfg', 0) - 0.35) < 1e-9 and abs(public.crypto_player_sigma_day(:'cfg', 100) - 0.175) < 1e-9,
  'playerCoinDriftDay / playerCoinSigmaDay');
select tests.assert(
  public.crypto_action_success_bps(:'cfg', public.crypto_action_cfg(:'cfg', 'smart_contract'), 0) = 5000
  and public.crypto_action_success_bps(:'cfg', public.crypto_action_cfg(:'cfg', 'smart_contract'), 6) = 6800
  and public.crypto_action_success_bps(:'cfg', public.crypto_action_cfg(:'cfg', 'audit'), 0) = 10000,
  'actionSuccessBps: 50 % plus 3 % per IT score, audits always succeed');
select tests.assert(
  not public.crypto_is_rug_pull(:'cfg', 2000, 10000) and public.crypto_is_rug_pull(:'cfg', 2001, 10000)
  and not public.crypto_is_rug_pull(:'cfg', 5, 0),
  'isRugPull: more than 20 % of the team tokens');
select tests.assert(
  public.crypto_discontinue_payout_cents(1000000, 25, 100) = 250000 and public.crypto_discontinue_payout_cents(1000000, 25, 0) = 0,
  'discontinuePayoutCents: the pool by coins');
select tests.assert(
  public.crypto_event_chance_bps(public.crypto_event_cfg(:'cfg', 'depeg'), 'meme', null, null, null) = 0
  and public.crypto_event_chance_bps(public.crypto_event_cfg(:'cfg', 'hack'), 'alt', null, null, null) = 20
  and public.crypto_event_chance_bps(public.crypto_event_cfg(:'cfg', 'hack'), 'player', 100, 0, 0) = 0
  and public.crypto_event_chance_bps(public.crypto_event_cfg(:'cfg', 'hack'), 'player', 0, 0, 0) = 30
  and public.crypto_event_chance_bps(public.crypto_event_cfg(:'cfg', 'influencer'), 'player', 0, 100, 0) = 90,
  'eventChanceBps: scope, own coins move the chance with their stats');
select tests.assert(
  public.crypto_roll_coin_event(:'cfg', 0.99, 0.5, 'major', null, null, null) is null
  and (public.crypto_roll_coin_event(:'cfg', 0, 0, 'major', null, null, null) -> 'scope') ? 'major'
  and public.crypto_roll_coin_event(:'cfg', 0, 0, 'stable', null, null, null) ->> 'key' = 'depeg'
  and public.crypto_roll_market_event(:'cfg', 0.99, 0) is null
  and public.crypto_roll_market_event(:'cfg', 0, 0) ->> 'key' = 'meme_wave',
  'rollCoinEvent / rollMarketEvent');
select tests.assert(
  abs(public.crypto_event_shock(public.crypto_event_cfg(:'cfg', 'influencer'), 0) - 0.25) < 1e-9
  and abs(public.crypto_event_shock(public.crypto_event_cfg(:'cfg', 'influencer'), 1) - 1.2) < 1e-9
  and abs(public.crypto_event_shock(public.crypto_event_cfg(:'cfg', 'depeg'), 1, true) + 0.06) < 1e-9,
  'eventShock: inside the range, algorithmic stablecoins lose the peg twice as hard');
select tests.assert(
  public.crypto_discounted_fee_bps(100, 0, 2500) = 100 and public.crypto_discounted_fee_bps(100, 1, 2500) = 75
  and public.crypto_discounted_fee_bps(100, 2, 2500) = 50 and public.crypto_discounted_fee_bps(5, 1, 2500) = 4
  and public.crypto_player_fee_bps(:t, 'meme') = 100 and public.crypto_player_fee_bps(:t, 'stable') = 5,
  'hardware wallet: fee x (10 000 - level x perLevel) / 10 000, no wallet = the category fee');

-- =============================================================================
-- B. Seeding (run_due_jobs() in 78 already seeded the market)
-- =============================================================================
select public.crypto_run_due() is not null as ok \gset
select tests.assert(
  (select count(*) from public.crypto_coins c join public.securities s on s.id = c.security_id
    where c.seed_ticker is not null and c.status in ('listed', 'dead') and s.kind = 'crypto' and not s.is_shortable
      and s.max_leverage = 1 and s.tick_size_e4 = 1 and c.seed_ticker = s.ticker) = 15
  and public.crypto_bootstrap() ->> 'skipped' = 'seeded'
  and (select seeded_at is not null and regime in ('bull', 'flat', 'bear') and regime_until > now() from public.crypto_state),
  'the 15 coins of crypto.coins are securities of kind crypto (no shorts, no leverage); crypto_bootstrap() runs once');
select tests.assert(
  (select count(*) from public.crypto_coins c
     join jsonb_array_elements(:'cfg'::jsonb -> 'coins') x(e) on c.seed_ticker = x.e ->> 'ticker'
    where c.pool_account_id is not null and c.start_pool_cents = public.cfg_num(x.e, '{poolCents}', 0)
      and c.start_price_e4 = public.cfg_num(x.e, '{priceE4}', 0)
      and (c.category <> 'stable' or c.peg_e4 = c.start_price_e4)
      and (x.e ->> 'algorithmic' is null or c.algorithmic)) = 15
  and tests.pools_ok(),
  'pools at the start price, funded from the financial market (ledger balance + pending flows = pool cash); stablecoins are pegged');
select tests.assert(
  (select count(*) from public.crypto_coins c
    where c.seed_ticker is not null
      and (select count(distinct k.interval) from public.candles k where k.security_id = c.security_id) = 5
      and (select count(*) from public.candles k where k.security_id = c.security_id and k.interval = '5m') >= 800
      and exists (select 1 from public.security_quotes q where q.security_id = c.security_id and q.bid_e4 < q.ask_e4
                     and q.prev_close_e4 > 0 and q.day_high_e4 >= q.last_price_e4 and q.day_low_e4 <= q.last_price_e4)) = 15,
  'every seeded coin has a quote (bid < ask) and a light history (1m, 5m for three days, 1h, 1q, 1y)');

-- =============================================================================
-- C. Ticks: the AI traders trade against the pools (market_tick, every 5 s)
-- =============================================================================
select c.pool_cash_cents as ktl_cash0, c.pool_tokens_e6 as ktl_tok0 from tests.coin('KTL') c \gset
select r.tick_seq as seq0 from public.sim_runtime r \gset
select public.market_tick() as mt1 \gset
select public.market_tick() as mt2 \gset
select public.market_tick() as mt3 \gset
select tests.assert(
  (:'mt3'::jsonb -> 'crypto' ->> 'coins')::integer = (select count(*) from public.crypto_coins where status = 'listed')
  and (:'mt3'::jsonb ->> 'securities')::integer >= 19,
  'market_tick(): the crypto tick moves every listed coin, the stock tick is unchanged (' || (:'mt3'::jsonb ->> 'crypto') || ')');
select tests.assert(
  (select c.pool_cash_cents <> :ktl_cash0 and abs(c.pool_cash_cents::numeric * c.pool_tokens_e6 / (:ktl_cash0::numeric * :ktl_tok0) - 1) < 1e-6
     from tests.coin('KTL') c)
  and (select count(*) from public.crypto_coins where status = 'listed' and pending_flow_cents <> 0) >= 10
  and tests.pools_ok(),
  'the flow keeps k = cash x coins; the cash difference waits in pending_flow_cents (not yet booked)');
select tests.assert(
  (select count(*) from public.price_ticks p join public.crypto_coins c on c.security_id = p.security_id
    where p.tick_seq = :seq0 + 3) = (select count(*) from public.crypto_coins where status = 'listed')
  and (select q.tick_seq = :seq0 + 3 and q.last_price_e4 = public.crypto_pool_price_e4(c.pool_cash_cents, c.pool_tokens_e6)
         from tests.coin('KTL') c join public.security_quotes q on q.security_id = c.security_id)
  and exists (select 1 from public.candles k join public.crypto_coins c on c.security_id = k.security_id
               where c.seed_ticker = 'KTL' and k.interval = '1m'
                 and k.bucket_start = date_bin('1 minute', public.game_now(), '2000-01-01 00:00:00+00'::timestamptz))
  and (select abs(q.last_price_e4 - 10000) <= 100 from tests.coin('EUS') c join public.security_quotes q on q.security_id = c.security_id),
  'quotes, price ticks and candles like stocks; the stablecoin stays at its peg');
update public.sim_runtime set is_paused = true;
select tests.assert(public.market_tick() ->> 'skipped' = 'paused' and (select r.tick_seq from public.sim_runtime r) = :seq0 + 3,
  'market_tick(): nothing moves while paused');
update public.sim_runtime set is_paused = false;
select (select balance_cents from public.ledger_accounts where system_key = 'market') as market0,
       (select sum(pending_flow_cents) from public.crypto_coins) as pending0 \gset
select public.crypto_settle_flows() as settled \gset
select tests.assert(
  not exists (select 1 from public.crypto_coins where pending_flow_cents <> 0) and tests.pools_ok()
  and (select balance_cents from public.ledger_accounts where system_key = 'market') = :market0::bigint - :pending0::bigint
  and tests.money_invariant() = 'ok',
  'crypto_settle_flows(): the AI flows are booked between the financial market and the pools in one transaction ' || :'settled');

-- =============================================================================
-- D. Trading against the pool
-- =============================================================================
select tests.login_as('authenticated', :n);
select tests.throws_key($$select public.crypto_trade(gen_random_uuid(), 'KTL', 'buy', 100000)$$, 'locked',
  'crypto_trade(): from crypto.minLevel (10)');
reset role;
select tests.cash(:t) as t_cash0, (select balance_cents from public.ledger_accounts where system_key = 'treasury') as treas0 \gset
select c.pool_cash_cents as ktl_cash1, c.pool_tokens_e6 as ktl_tok1, c.pending_flow_cents as ktl_pend1 from tests.coin('KTL') c \gset
select public.market_tick() is not null as ok \gset
select c.pool_cash_cents as ktl_cash1, c.pool_tokens_e6 as ktl_tok1, c.pending_flow_cents as ktl_pend1 from tests.coin('KTL') c \gset
select gen_random_uuid() as rq1 \gset
select tests.login_as('authenticated', :t);
select tests.throws_key($$select public.crypto_trade(gen_random_uuid(), 'NOPE', 'buy', 100000)$$, 'coin_not_found',
  'crypto_trade(): unknown ticker (coin_not_found NX096)');
select tests.throws_key($$select public.crypto_trade(gen_random_uuid(), 'VLT', 'buy', 100000)$$, 'coin_not_found',
  'crypto_trade(): stocks are not coins');
select tests.throws_key($$select public.crypto_trade(gen_random_uuid(), 'KTL', 'hold', 100000)$$, 'invalid_argument',
  'crypto_trade(): side buy or sell');
select tests.throws_key($$select public.crypto_trade(gen_random_uuid(), 'KTL', 'buy', null, 5)$$, 'invalid_argument',
  'crypto_trade(): a buy needs an amount');
select tests.throws_key($$select public.crypto_trade(gen_random_uuid(), 'KTL', 'buy', 150)$$, 'order_too_small',
  'crypto_trade(): order fee included, at least minOrderValueCents go into the pool');
select tests.throws_key($$select public.crypto_trade(gen_random_uuid(), 'KTL', 'buy', 100000000000)$$, 'insufficient_funds',
  'crypto_trade(): not more than the cash');
select tests.throws_key($$select public.crypto_trade(gen_random_uuid(), 'MKS', 'buy', 5000000, null, 50)$$, 'slippage_exceeded',
  'crypto_trade(): 50.000 € into a small meme pool slip more than 0,5 % (slippage_exceeded NX102)');
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'KTL', 'buy', 'market', 1000000)$$, 'not_tradable',
  'place_order(): coins trade only through crypto_trade');
select public.crypto_trade(:'rq1', 'KTL', 'buy', 100000, null, 100) as buy1 \gset
select public.crypto_trade(:'rq1', 'KTL', 'buy', 100000, null, 100) as buy1r \gset
reset role;
\echo '   buy:' :buy1
select tests.assert(
  :'buy1'::jsonb = :'buy1r'::jsonb
  and :'buy1'::jsonb ->> 'side' = 'buy' and :'buy1'::jsonb ->> 'ticker' = 'KTL'
  and (:'buy1'::jsonb ->> 'cash_cents')::bigint = 100000
  and (:'buy1'::jsonb ->> 'order_fee_cents')::bigint = 100
  and (:'buy1'::jsonb ->> 'pool_fee_cents')::bigint = 100
  and (:'buy1'::jsonb ->> 'fee_cents')::bigint = 200
  and (:'buy1'::jsonb ->> 'quantity_e6')::bigint
      = (select b.tokens_out_e6 from public.crypto_swap_buy(:ktl_cash1, :ktl_tok1, 99900, 10) b)
  and (:'buy1'::jsonb ->> 'position_e6')::bigint = (:'buy1'::jsonb ->> 'quantity_e6')::bigint
  and (:'buy1'::jsonb ->> 'cash_after_cents')::bigint = :t_cash0::bigint - 100000
  and (:'buy1'::jsonb ->> 'price_e4')::bigint = (select q.last_price_e4 from tests.coin('KTL') c join public.security_quotes q on q.security_id = c.security_id)
  and (:'buy1'::jsonb ->> 'slippage_bps')::integer between 0 and 100,
  'crypto_trade() buy: the amount includes the order fee, the rest is swapped (pool fee 0,1 % stays in the pool); idempotent');
select tests.assert(
  tests.cash(:t) = :t_cash0::bigint - 100000
  and (select balance_cents from public.ledger_accounts where system_key = 'treasury') = :treas0::bigint + 100
  and (select c.pool_cash_cents = :ktl_cash1::bigint + 99900 and c.pending_flow_cents = 0 from tests.coin('KTL') c)
  and (select a.balance_cents from tests.coin('KTL') c join public.ledger_accounts a on a.id = c.pool_account_id)
      = :ktl_cash1::bigint + 99900
  and tests.pools_ok(),
  'money: player -> pool, order fee -> treasury; the pool''s pending AI flows were booked first');
select tests.assert(
  (select p.cost_basis_cents = 99900 and p.quantity_e6 = (:'buy1'::jsonb ->> 'quantity_e6')::bigint
          and p.avg_entry_price_e4 = (:'buy1'::jsonb ->> 'avg_price_e4')::bigint
     from public.positions p join tests.coin('KTL') c on c.security_id = p.security_id where p.player_id = :t and p.status = 'open')
  and (select count(*) from public.orders o join tests.coin('KTL') c on c.security_id = o.security_id
        where o.player_id = :t and o.status = 'filled' and o.request_id = :'rq1') = 1
  and (select count(*) from public.trades x join tests.coin('KTL') c on c.security_id = x.security_id
        where x.player_id = :t and x.side = 'buy' and x.gross_cents = 99900 and x.fee_cents = 100 and x.xp_awarded > 0) = 1,
  'position with an exact cost basis, one filled order and one trade (with trade XP) for the history');
select tests.login_as('authenticated', :t);
select public.get_my_portfolio() as pf \gset
select public.get_candles('KTL', '1m', 5) as ktl_candles \gset
reset role;
select tests.assert(
  exists (select 1 from jsonb_array_elements(:'pf'::jsonb -> 'positions') x where x ->> 'ticker' = 'KTL' and x ->> 'kind' = 'crypto')
  and public.player_net_worth_cents(:t) = (select e.net_worth_cents from public.rich_list_entries() e where e.entity_id = :t)
  and public.player_net_worth_cents(:t)
      = tests.cash(:t) + coalesce(tests.reserve(:t), 0)
        + (select public.value_cents(p.quantity_e6, q.bid_e4) from public.positions p
             join tests.coin('KTL') c on c.security_id = p.security_id
             join public.security_quotes q on q.security_id = p.security_id where p.player_id = :t and p.status = 'open')
  and jsonb_array_length(:'ktl_candles'::jsonb) between 1 and 5,
  'portfolio (kind crypto), net worth and rich list count the coins at the bid; get_candles works for coins');

-- sell half, then the rest (99.9 % of the free position is all of it)
select (:'buy1'::jsonb ->> 'quantity_e6')::bigint as q1 \gset
select coalesce(tax_loss_pot_cents, 0) as pot0 from public.player_private where player_id = :t \gset
select tests.login_as('authenticated', :t);
select tests.throws_key(format($$select public.crypto_trade(gen_random_uuid(), 'KTL', 'sell', null, %s)$$, :q1 + 1),
  'insufficient_position', 'crypto_trade() sell: not more than the position');
select public.crypto_trade(gen_random_uuid(), 'KTL', 'sell', null, :q1 / 2) as sell1 \gset
select public.crypto_trade(gen_random_uuid(), 'KTL', 'sell', null, :q1 - :q1 / 2 - 1) as sell2 \gset
reset role;
select tests.assert(
  (:'sell1'::jsonb ->> 'quantity_e6')::bigint = :q1 / 2 and (:'sell1'::jsonb ->> 'position_e6')::bigint = :q1 - :q1 / 2
  and (:'sell1'::jsonb ->> 'realized_pnl_cents')::bigint < 0 and (:'sell1'::jsonb ->> 'tax_cents')::bigint = 0
  and (:'sell2'::jsonb ->> 'quantity_e6')::bigint = :q1 - :q1 / 2 and (:'sell2'::jsonb ->> 'position_e6')::bigint = 0
  and not exists (select 1 from public.positions p join tests.coin('KTL') c on c.security_id = p.security_id
                   where p.player_id = :t and p.status = 'open')
  and (select coalesce(tax_loss_pot_cents, 0) from public.player_private where player_id = :t)
      = :pot0::bigint - (:'sell1'::jsonb ->> 'realized_pnl_cents')::bigint - (:'sell2'::jsonb ->> 'realized_pnl_cents')::bigint
  and tests.pools_ok(),
  'crypto_trade() sell: realised losses fill the loss pot (no tax); the last 0,1 % sell the whole position');

-- a gain is taxed like stocks (offset against the loss pot first)
select tests.login_as('authenticated', :t);
select public.crypto_trade(gen_random_uuid(), 'FLX', 'buy', 50000) ->> 'quantity_e6' as fq \gset
reset role;
select public.crypto_apply_event((tests.coin('FLX')).id, public.crypto_event_cfg(:'cfg', 'whale_buy'), 0.4, public.game_now())
       ->> 'shock_bps' as whale_bps \gset
select coalesce(tax_loss_pot_cents, 0) as pot1 from public.player_private where player_id = :t \gset
select tests.login_as('authenticated', :t);
select public.crypto_trade(gen_random_uuid(), 'FLX', 'sell', null, :fq) as sell3 \gset
reset role;
select tests.assert(
  :whale_bps::integer between 4900 and 4930
  and (:'sell3'::jsonb ->> 'realized_pnl_cents')::bigint > 0
  and (:'sell3'::jsonb ->> 'tax_cents')::bigint
      = public.apply_bps(greatest(0, (:'sell3'::jsonb ->> 'realized_pnl_cents')::bigint - :pot1::bigint), 2500)
  and (:'sell3'::jsonb ->> 'cash_cents')::bigint
      = (select x.gross_cents - x.fee_cents - x.tax_cents from public.trades x join tests.coin('FLX') c on c.security_id = x.security_id
          where x.player_id = :t and x.side = 'sell' order by x.executed_at desc limit 1)
  and tests.pools_ok() and tests.money_invariant() = 'ok',
  'a whale buy (+49 %) and a sale: the gain minus the loss pot is taxed with 25 %, the rest is paid out');

-- =============================================================================
-- E. Own coins: name, founding, development, launch, rug pull, burn, closing
-- =============================================================================
\set logo '''{"palette": ["#ff9900", "#222222"], "grid": ["................", "................", "....00000000....", "....01111110....", "....01111110....", "....00000000....", "................", "................", "................", "................", "................", "................", "................", "................", "................", "................"]}'''
select tests.login_as('authenticated', :n);
select tests.throws_key(format($$select public.create_coin(gen_random_uuid(), 'Mondfisch', 'MOFI', %L)$$, :logo), 'locked',
  'create_coin(): from crypto.createMinLevel (14)');
select tests.login_as('authenticated', :k);
select public.check_coin_name('Mondfisch', 'MOFI') as cn_ok \gset
select public.check_coin_name('Kryptaler', 'KRYX') as cn_taken \gset
select public.check_coin_name('kryptaler', 'KRYX') as cn_taken2 \gset
select public.check_coin_name('Mondfisch', 'KTL') as cn_ticker \gset
select public.check_coin_name('Mondfisch', 'VLT') as cn_ticker2 \gset
select public.check_coin_name('Mondfisch', 'MO1') as cn_bad \gset
select public.check_coin_name('Mondfisch', 'MOFISCH') as cn_long \gset
select public.check_coin_name('Mo', 'MOFI') as cn_short \gset
select public.check_coin_name(repeat('x', 25), 'MOFI') as cn_toolong \gset
select public.check_coin_name('Arschloch Coin', 'MOFI') as cn_prof \gset
reset role;
select tests.assert(
  :'cn_ok'::jsonb = '{"allowed": true, "reason": null}'::jsonb
  and :'cn_taken'::jsonb ->> 'reason' = 'name_taken' and :'cn_taken2'::jsonb ->> 'reason' = 'name_taken'
  and :'cn_ticker'::jsonb ->> 'reason' = 'ticker_taken' and :'cn_ticker2'::jsonb ->> 'reason' = 'ticker_taken'
  and :'cn_bad'::jsonb ->> 'reason' = 'invalid_argument' and :'cn_long'::jsonb ->> 'reason' = 'invalid_argument'
  and :'cn_short'::jsonb ->> 'reason' = 'name_too_short' and :'cn_toolong'::jsonb ->> 'reason' = 'name_too_long'
  and :'cn_prof'::jsonb ->> 'reason' = 'name_profanity',
  'check_coin_name(): unique names (lookalikes count), tickers 3 to 5 letters and free among all securities, name filter');
select tests.cash(:k) as k_cash0, (select balance_cents from public.ledger_accounts where system_key = 'treasury') as treas1 \gset
select tests.login_as('authenticated', :k);
select tests.throws_key(format($$select public.create_coin(gen_random_uuid(), 'Mondfisch', 'MOFI', %L)$$,
  jsonb_build_object('palette', '["#111318", "#ffffff"]'::jsonb, 'grid', tests.draw('{x.xxx,x.x..,xxxxx,..x.x,xxx.x}', 2, 1, 1))),
  'logo_forbidden', 'create_coin(): forbidden symbols like company logos');
select tests.throws_key($$select public.create_coin(gen_random_uuid(), 'Mondfisch', 'MOFI', '{"palette": ["#112233"]}')$$,
  'invalid_argument', 'create_coin(): the logo must be valid (16 x 16, palette)');
select public.create_coin(gen_random_uuid(), 'Mondfisch', 'mofi', :logo) as mc0 \gset
select tests.throws_key(format($$select public.create_coin(gen_random_uuid(), 'Sonnfisch', 'SOFI', %L)$$, :logo), 'coin_exists',
  'create_coin(): one coin at a time (coin_exists NX097)');
select tests.throws_key($$select public.start_coin_action(gen_random_uuid(), 'staking')$$, 'coin_not_launched',
  'start_coin_action(): staking only after the launch (coin_not_launched NX103)');
select tests.throws_key($$select public.start_coin_action(gen_random_uuid(), 'marketing_burn')$$, 'invalid_argument',
  'start_coin_action(): burning is burn_coin_tokens');
select tests.throws_key($$select public.launch_coin(gen_random_uuid(), 1000, 1000000, 2000)$$, 'coin_tech_too_low',
  'launch_coin(): technology 20 first (coin_tech_too_low NX101)');
select public.start_coin_action(gen_random_uuid(), 'audit') as act1 \gset
select tests.throws_key($$select public.start_coin_action(gen_random_uuid(), 'community')$$, 'coin_action_running',
  'start_coin_action(): one action at a time (coin_action_running NX100)');
select public.get_my_coin() as my0 \gset
reset role;
\echo '   my coin:' :my0
select tests.assert(
  :'mc0'::jsonb ->> 'status' = 'draft' and :'mc0'::jsonb ->> 'ticker' = 'MOFI' and :'mc0'::jsonb ->> 'category' = 'player'
  and :'mc0'::jsonb -> 'price_e4' = 'null'::jsonb and :'mc0'::jsonb -> 'launch' = 'null'::jsonb
  and :'mc0'::jsonb -> 'logo' -> 'palette' = '["#ff9900", "#222222"]'::jsonb
  and :'mc0'::jsonb -> 'creator' ->> 'nickname' = 'Krypto_Kim' and (:'mc0'::jsonb -> 'creator' -> 'trust' ->> 'score')::integer = 50
  and jsonb_array_length(:'mc0'::jsonb -> 'actions') = 7
  and :'my0'::jsonb -> 'coin' -> 'action' ->> 'key' = 'audit'
  and not exists (select 1 from jsonb_array_elements(:'my0'::jsonb -> 'coin' -> 'actions') a where (a ->> 'available')::boolean)
  and tests.cash(:k) = :k_cash0::bigint - 2500000 - 1500000
  and (select balance_cents from public.ledger_accounts where system_key = 'treasury') = :treas1::bigint + 2500000 + 1500000
  and (select s.status = 'pending' and s.kind = 'crypto' and not s.is_tradable from public.securities s where s.ticker = 'MOFI'),
  'create_coin(): 25.000 € to the treasury, a draft that reserves its ticker; the audit costs 15.000 €');
-- the audit ends: resolved by the minute job (always succeeds: +35 technology)
update public.crypto_coin_actions a set ends_at = a.started_at
 where a.coin_id = (tests.coin('MOFI')).id;
select tests.crypto_hour_done();
select public.crypto_run_due() as rd1 \gset
select tests.assert(
  (:'rd1'::jsonb ->> 'actions')::integer = 1
  and (select c.tech = 35 from tests.coin('MOFI') c)
  and exists (select 1 from public.crypto_events e where e.coin_id = (tests.coin('MOFI')).id and e.key = 'action'
                 and e.payload = '{"action": "audit", "success": true}'::jsonb)
  and exists (select 1 from public.notifications x where x.player_id = :k and x.type_key = 'crypto_event'
                 and x.title = 'Security-Audit geschafft' and x.link = '/crypto/MOFI'),
  'the minute job resolves the audit: +35 technology, a log row and a notification for the creator');

select tests.login_as('authenticated', :k);
select tests.throws_key($$select public.launch_coin(gen_random_uuid(), 5000, 1000000, 2000)$$, 'invalid_argument',
  'launch_coin(): the start price is one of the options');
select tests.throws_key($$select public.launch_coin(gen_random_uuid(), 1000, 400000, 2000)$$, 'invalid_argument',
  'launch_coin(): at least 5.000 € liquidity');
select tests.throws_key($$select public.launch_coin(gen_random_uuid(), 1000, 1000000, 6000)$$, 'invalid_argument',
  'launch_coin(): team share 10 to 50 %');
select public.launch_coin(gen_random_uuid(), 1000, 1000000, 2000) as launch \gset
select tests.throws_key($$select public.launch_coin(gen_random_uuid(), 1000, 1000000, 2000)$$, 'already_listed',
  'launch_coin(): only drafts');
reset role;
select tests.assert(
  :'launch'::jsonb ->> 'status' = 'listed' and (:'launch'::jsonb ->> 'price_e4')::bigint = 1000
  and (:'launch'::jsonb ->> 'pool_cents')::bigint = 1000000
  and (:'launch'::jsonb ->> 'team_tokens_e6')::bigint = 25000000000 and (:'launch'::jsonb ->> 'team_at_launch_e6')::bigint = 25000000000
  and (:'launch'::jsonb ->> 'rug_limit_e6')::bigint = 5000000000 and (:'launch'::jsonb ->> 'my_quantity_e6')::bigint = 25000000000
  and :'launch'::jsonb -> 'launch' = jsonb_build_object('start_price_e4', 1000, 'liquidity_cents', 1000000, 'team_share_bps', 2000,
                                                        'at', :'launch'::jsonb -> 'launch' -> 'at')
  and (select c.pool_tokens_e6 = 100000000000 and c.pool_cash_cents = 1000000 from tests.coin('MOFI') c)
  and (select p.quantity_e6 = 25000000000 and p.cost_basis_cents = 0 from public.positions p
        where p.player_id = :k and p.security_id = (tests.coin('MOFI')).security_id and p.status = 'open')
  and tests.cash(:k) = :k_cash0::bigint - 2500000 - 1500000 - 1000000
  and tests.pools_ok()
  and exists (select 1 from public.feed_items f where f.actor_id = :k and f.kind = 'coin_launched'
                 and f.payload = '{"ticker": "MOFI", "name": "Mondfisch"}'::jsonb)
  and public.feed_item_label('coin_launched', '{"name": "Mondfisch"}') = 'Kryptowährung Mondfisch gestartet',
  'launch_coin(): 100.000 coins at 0,10 € in the pool, 25.000 team coins as the creator''s position (cost 0), feed coin_launched');

-- a holder buys; the coin shows up in the market
select tests.login_as('authenticated', :h);
select public.crypto_trade(gen_random_uuid(), 'MOFI', 'buy', 200000) ->> 'quantity_e6' as hq \gset
select public.get_coin('MOFI') as gc \gset
select public.get_crypto_market() as gm \gset
reset role;
\echo '   get_coin:' :gc
select tests.assert(
  (:'gc'::jsonb ->> 'holders')::integer = 2 and (:'gc'::jsonb -> 'my_position' ->> 'quantity_e6')::bigint = :hq::bigint
  and (:'gc'::jsonb ->> 'supply_e6')::bigint = (:'gc'::jsonb -> 'pool' ->> 'tokens_e6')::bigint + :hq::bigint + 25000000000
  and (:'gc'::jsonb ->> 'team_tokens_e6')::bigint = 25000000000
  and (:'gc'::jsonb ->> 'my_quantity_e6')::bigint = :hq::bigint
  and :'gc'::jsonb -> 'stats' = '{"tech": 35.0, "hype": 0.0, "utility": 0.0}'::jsonb
  and exists (select 1 from jsonb_array_elements(:'gc'::jsonb -> 'events') e where e ->> 'key' = 'launch')
  and :'gm'::jsonb -> 'regime' ->> 'kind' in ('bull', 'flat', 'bear')
  and exists (select 1 from jsonb_array_elements(:'gm'::jsonb -> 'coins') x
               where x ->> 'ticker' = 'MOFI' and x -> 'creator' ->> 'nickname' = 'Krypto_Kim' and x -> 'logo' is not null)
  and (select count(*) from jsonb_array_elements(:'gm'::jsonb -> 'coins') x where x ->> 'category' = 'stable') = 4
  and (select x ->> 'ticker' from jsonb_array_elements(:'gm'::jsonb -> 'coins') with ordinality y(x, o) order by o limit 1) = 'EUS'
  and not exists (select 1 from jsonb_array_elements(:'gm'::jsonb -> 'events') e where e ->> 'key' in ('action', 'created')),
  'get_coin() and get_crypto_market(): pool, supply, holders, team tokens, own position, events; stablecoins first');

-- an event on a player coin: stats move, holders and creator are told
select public.crypto_apply_event((tests.coin('MOFI')).id, public.crypto_event_cfg(:'cfg', 'influencer'), 0.5, public.game_now()) as infl \gset
select tests.assert(
  (select c.hype = 20 from tests.coin('MOFI') c) and (:'infl'::jsonb ->> 'shock_bps')::integer between 6480 and 6500
  and exists (select 1 from public.notifications x where x.player_id = :h and x.type_key = 'crypto_event'
                 and x.title = 'Influencer feiert Mondfisch')
  and exists (select 1 from public.notifications x where x.player_id = :k and x.title = 'Influencer feiert Mondfisch'),
  'events on own coins: +20 hype, price x e^0,5, holders and creator get a crypto_event notification');

-- the creator sells team tokens: up to 20 % in 24 h is fine, more is a rug pull
select tests.login_as('authenticated', :k);
select public.crypto_trade(gen_random_uuid(), 'MOFI', 'sell', null, 2500000000) as ks1 \gset
select public.get_my_coin() -> 'coin' as my1 \gset
select public.crypto_trade(gen_random_uuid(), 'MOFI', 'sell', null, 3750000000) as ks2 \gset
select public.crypto_trade(gen_random_uuid(), 'MOFI', 'sell', null, 1000000000) as ks3 \gset
reset role;
select tests.assert(
  not (:'ks1'::jsonb ->> 'rug_pull')::boolean and (:'my1'::jsonb ->> 'team_sold_window_e6')::bigint = 2500000000
  and (:'my1'::jsonb ->> 'team_tokens_e6')::bigint = 22500000000
  and (:'ks2'::jsonb ->> 'rug_pull')::boolean and not (:'ks3'::jsonb ->> 'rug_pull')::boolean
  and (select count(*) from public.trust_events t where t.player_id = :k and t.reason = 'rugPull' and t.delta = -20) = 1
  and public.trust_score(:k) = 30
  and (select c.hype = 0 and c.team_tokens_e6 = 25000000000 - 2500000000 - 3750000000 - 1000000000 from tests.coin('MOFI') c)
  and exists (select 1 from public.feed_items f where f.actor_id = :k and f.kind = 'rug_pull'
                 and f.payload = '{"ticker": "MOFI", "name": "Mondfisch"}'::jsonb)
  and exists (select 1 from public.notifications x where x.player_id = :h and x.title = 'Rug Pull bei Mondfisch')
  and not exists (select 1 from public.notifications x where x.player_id = :k and x.title = 'Rug Pull bei Mondfisch')
  and exists (select 1 from public.crypto_events e where e.coin_id = (tests.coin('MOFI')).id and e.key = 'rug_pull'),
  'rug pull: 10 % is fine, 25 % in 24 h costs 20 trust (once per window), hype 0, friends feed, holders are told');

-- burning team tokens: +8 hype, at most once per hour, at least 1 % of the team tokens
select tests.login_as('authenticated', :k);
select tests.throws_key($$select public.burn_coin_tokens(gen_random_uuid(), 1000)$$, 'invalid_quantity',
  'burn_coin_tokens(): at least create.burnMinBps of the team tokens');
select tests.throws_key($$select public.burn_coin_tokens(gen_random_uuid(), 900000000000)$$, 'insufficient_position',
  'burn_coin_tokens(): only team tokens');
select public.burn_coin_tokens(gen_random_uuid(), 250000000) as burn \gset
select tests.throws_key($$select public.burn_coin_tokens(gen_random_uuid(), 250000000)$$, 'rate_limited',
  'burn_coin_tokens(): once per marketing_burn.hours');
reset role;
select tests.assert(
  (:'burn'::jsonb -> 'stats' ->> 'hype')::numeric = 8
  and (:'burn'::jsonb ->> 'team_tokens_e6')::bigint = 25000000000 - 2500000000 - 3750000000 - 1000000000 - 250000000
  and (select c.burned_e6 = 250000000 from tests.coin('MOFI') c)
  and (select p.quantity_e6 from public.positions p where p.player_id = :k and p.security_id = (tests.coin('MOFI')).security_id
          and p.status = 'open') = 25000000000 - 2500000000 - 3750000000 - 1000000000 - 250000000
  and (:'burn'::jsonb ->> 'burn_available_at') is not null,
  'burn_coin_tokens(): coins leave the supply, +8 hype');

-- closing: the pool goes to all holders by their coins, the ticker is free again
select tests.cash(:h) as h_cash0, tests.cash(:k) as k_cash1 \gset
select c.pool_cash_cents as mofi_pool, public.crypto_held_e6(c.security_id) as mofi_circ, c.security_id as mofi_sec
  from tests.coin('MOFI') c \gset
select tests.login_as('authenticated', :k);
select public.discontinue_coin(gen_random_uuid()) as closed \gset
select public.get_my_coin() as my2 \gset
select public.check_coin_name('Mondfisch', 'MOFI') as cn_free \gset
reset role;
select tests.assert(
  :'closed'::jsonb ->> 'status' = 'closed' and :'my2'::jsonb = '{"coin": null}'::jsonb
  and :'cn_free'::jsonb = '{"allowed": true, "reason": null}'::jsonb
  and tests.cash(:h) - :h_cash0::bigint = public.crypto_discontinue_payout_cents(:mofi_pool, :hq, :mofi_circ)
      - coalesce((select x.tax_cents from public.trades x where x.player_id = :h and x.security_id = :'mofi_sec' and x.counterparty = 'issuer'), 0)
  and tests.cash(:k) > :k_cash1::bigint
  and not exists (select 1 from public.positions p where p.security_id = :'mofi_sec' and p.status = 'open')
  and (select s.status = 'delisted' and s.ticker = 'MOFI1' and not s.is_tradable from public.securities s where s.id = :'mofi_sec')
  and (select a.balance_cents = 0 and c.pool_cash_cents = 0 from public.crypto_coins c join public.ledger_accounts a on a.id = c.pool_account_id
        where c.security_id = :'mofi_sec')
  and exists (select 1 from public.notifications x where x.player_id = :h and x.title = 'Mondfisch eingestellt')
  and exists (select 1 from public.feed_items f where f.actor_id = :k and f.kind = 'coin_closed')
  and tests.money_invariant() = 'ok',
  'discontinue_coin(): the pool is paid to all holders by coins (creator included), positions closed, security delisted, ticker free');

-- =============================================================================
-- F. Hourly job: hacks, market events, dead meme coins and their replacement
-- =============================================================================
select c.pool_cash_cents as flx_cash, public.crypto_pool_price_e4(c.pool_cash_cents, c.pool_tokens_e6) as flx_p0
  from tests.coin('FLX') c \gset
select (select balance_cents from public.ledger_accounts where system_key = 'treasury') as treas2 \gset
select public.crypto_apply_event((tests.coin('FLX')).id, public.crypto_event_cfg(:'cfg', 'hack'), -0.5, public.game_now()) as hack \gset
select tests.assert(
  (:'hack'::jsonb ->> 'loss_cents')::bigint = floor(:flx_cash * 0.2)
  and (select balance_cents from public.ledger_accounts where system_key = 'treasury') = :treas2::bigint + floor(:flx_cash * 0.2)::bigint
  and (select abs(public.crypto_pool_price_e4(c.pool_cash_cents, c.pool_tokens_e6) / :flx_p0::numeric - exp(-0.5)::numeric) < 0.001
         from tests.coin('FLX') c)
  and tests.pools_ok(),
  'hack: 20 % of the pool''s cash goes to the treasury, the price falls by the shock in total');

-- market event: a meme wave lifts every meme coin (chances forced for the test)
select tests.crypto_events_off();
update public.game_config
   set value = jsonb_set(value, '{events}', (select jsonb_agg(case when e ->> 'key' = 'meme_wave' then jsonb_set(e, '{chanceBps}', '10000') else e end order by o)
                                               from jsonb_array_elements(value -> 'events') with ordinality x(e, o)))
 where key = 'crypto';
select jsonb_object_agg(s.ticker, q.last_price_e4) as meme0
  from public.crypto_coins c join public.securities s on s.id = c.security_id join public.security_quotes q on q.security_id = c.security_id
 where c.category = 'meme' and c.status = 'listed' \gset
update public.crypto_state set hour_done = null;
select public.crypto_run_due() as rd2 \gset
select tests.assert(
  (:'rd2'::jsonb ->> 'events')::integer = 1
  and exists (select 1 from public.crypto_events e where e.coin_id is null and e.key = 'meme_wave' and e.shock_bps > 0)
  and (select bool_and(q.last_price_e4 > (:'meme0'::jsonb ->> s.ticker)::bigint)
         from public.crypto_coins c join public.securities s on s.id = c.security_id join public.security_quotes q on q.security_id = c.security_id
        where c.category = 'meme' and c.status = 'listed')
  and (select crypto_state.hour_done = date_bin('1 hour', public.game_now(), '2000-01-01 00:00:00+00'::timestamptz) from public.crypto_state)
  and not exists (select 1 from public.crypto_coins where pending_flow_cents <> 0) and tests.pools_ok(),
  'hourly: a market event (meme_wave) moves all meme coins with one shock, one log row; the hour''s flows are booked');

-- a dead meme coin: frozen, then delisted after 24 h; holders get the dead price; a new meme coin takes its place
select tests.crypto_events_off();
select tests.login_as('authenticated', :t);
select public.crypto_trade(gen_random_uuid(), 'PPD', 'buy', 100000) ->> 'quantity_e6' as pq \gset
reset role;
-- (the coin crashes: many more coins in the pool, same cash, so the books stay balanced)
update public.crypto_coins set pool_tokens_e6 = pool_cash_cents * 100000000 where id = (tests.coin('PPD')).id;
update public.crypto_state set hour_done = null;
select public.crypto_run_due() as rd3 \gset
select tests.login_as('authenticated', :t);
select tests.throws_key($$select public.crypto_trade(gen_random_uuid(), 'PPD', 'sell', null, 1000000)$$, 'coin_not_tradable',
  'crypto_trade(): dead coins do not trade (coin_not_tradable NX099)');
reset role;
select tests.assert(
  (:'rd3'::jsonb ->> 'dead')::integer = 1
  and (select c.status = 'dead' and c.dead_since is not null from tests.coin('PPD') c)
  and (select s.status = 'halted' from public.securities s where s.ticker = 'PPD')
  and exists (select 1 from public.notifications x where x.player_id = :t and x.title = 'Pixelpudel ist tot'),
  'an AI meme coin at or below deadPriceE4 is dead: no trading, holders are told');
select c.id as ppd_id, c.security_id as ppd_sec, c.pool_cash_cents as ppd_pool,
       public.crypto_pool_price_e4(c.pool_cash_cents, c.pool_tokens_e6) as ppd_price
  from tests.coin('PPD') c \gset
select (select balance_cents from public.ledger_accounts where system_key = 'market') as market1, tests.cash(:t) as t_cash1 \gset
select x.name as nm, x.ticker as nt from public.crypto_next_meme_coin() x \gset
update public.crypto_coins set dead_since = now() - interval '25 hours' where id = :'ppd_id';
update public.crypto_state set hour_done = null;
select public.crypto_run_due() as rd4 \gset
\echo '   replaced:' :rd4 :nm :nt
select tests.assert(
  (:'rd4'::jsonb ->> 'replaced')::integer = 1
  and (select c.status = 'closed' from public.crypto_coins c where c.id = :'ppd_id')
  and (select s.status = 'delisted' and s.ticker = 'PPD1' from public.securities s where s.id = :'ppd_sec')
  and tests.cash(:t) - :t_cash1::bigint = public.value_cents(:pq, :ppd_price)
  and exists (select 1 from public.trades x where x.player_id = :t and x.security_id = :'ppd_sec' and x.counterparty = 'issuer'
                 and x.realized_pnl_cents < 0)
  and (select c.category = 'meme' and c.status = 'listed' and c.seed_ticker is null and s.ticker = (:'nt')
              and c.name = (:'nm') and c.start_price_e4 = 150 and c.pool_cash_cents = 8000000
         from public.crypto_coins c join public.securities s on s.id = c.security_id
        where c.name = (:'nm'))
  and exists (select 1 from public.crypto_events e where e.coin_id = :'ppd_id' and e.key = 'delisted')
  and (select balance_cents from public.ledger_accounts where system_key = 'market')
      = :market1::bigint + :ppd_pool::bigint - public.value_cents(:pq, :ppd_price) - 8000000
  and tests.pools_ok() and tests.money_invariant() = 'ok',
  'after deadCoinReplaceHours: delisted (holders get the dead price, the rest goes back to the market), a new meme coin from crypto.memeNames');
select tests.assert((:'nm') = 'Katzenkanone' and (:'nt') = 'KTZ',
  'nextMemeCoin: the first unused name, the ticker from its consonants');
update public.game_config set value = :'crypto_cfg0'::jsonb where key = 'crypto';
select tests.crypto_hour_done();

-- =============================================================================
-- G. Account reset: the own coin is closed first (holders paid)
-- =============================================================================
select tests.login_as('authenticated', :k);
select public.create_coin(gen_random_uuid(), 'Sternfisch', 'STFI', :logo) is not null as ok \gset
reset role;
update public.crypto_coins set tech = 30 where name = 'Sternfisch';
select tests.login_as('authenticated', :k);
select public.launch_coin(gen_random_uuid(), 10000, 500000, 5000) is not null as ok \gset
select tests.login_as('authenticated', :h);
select public.crypto_trade(gen_random_uuid(), 'STFI', 'buy', 100000) is not null as ok \gset
reset role;
select tests.cash(:h) as h_cash1, c.id as stfi_id from tests.coin('STFI') c \gset
select tests.login_as('authenticated', :k);
select public.reset_account(gen_random_uuid(), 'Krypto_Kim') is not null as ok \gset
reset role;
select tests.assert(
  tests.cash(:h) > :h_cash1::bigint
  and (select c.status = 'closed' and c.creator_id is null from public.crypto_coins c where c.id = :'stfi_id')
  and not exists (select 1 from public.crypto_coins c where c.creator_id = :k)
  and not exists (select 1 from public.positions p where p.player_id = :k and p.status = 'open')
  and not exists (select 1 from public.trust_events t where t.player_id = :k)
  and tests.pools_ok() and tests.money_invariant() = 'ok',
  'reset_account(): the own coin is closed first (holders paid), crypto rows go, the player starts fresh');

-- =============================================================================
-- H. Security and the wiring
-- =============================================================================
select tests.login_as('authenticated', :t);
select tests.throws($$select public.crypto_run_due()$$, '42501', 'players cannot run crypto_run_due()');
select tests.throws($$select public.crypto_tick_at(now(), 1)$$, '42501', 'players cannot run crypto_tick_at()');
select tests.throws($$select public.crypto_bootstrap()$$, '42501', 'players cannot run crypto_bootstrap()');
select tests.throws($$select public.crypto_settle_flows()$$, '42501', 'players cannot book flows');
select tests.throws($$update public.crypto_coins set hype = 100$$, '42501', 'no client writes on crypto_coins');
select tests.throws($$insert into public.crypto_events (key) values ('hack')$$, '42501', 'no client writes on crypto_events');
select tests.assert((select count(*) from public.crypto_coins) > 15 and (select count(*) from public.crypto_events) > 0
                    and (select count(*) from public.crypto_state) = 1,
  'coins, events and the regime are readable for players (RLS)');
reset role;
select tests.assert(
  position('public.crypto_run_due(' in pg_get_functiondef('public.run_due_jobs()'::regprocedure)) > 0
  and position('public.crypto_tick_at(' in pg_get_functiondef('public.market_tick()'::regprocedure)) > 0
  and position('crypto_wipe_player' in pg_get_functiondef('public.account_wipe(uuid, text)'::regprocedure)) > 0
  and position('deals_wipe_player' in pg_get_functiondef('public.account_wipe(uuid, text)'::regprocedure)) > 0
  and public.feed_item_label('promoted', '{"company": "X"}') = 'Befördert bei X'
  and public.feed_item_label('rug_pull', '{"name": "Y"}') = 'Rug Pull bei Y'
  and public.feed_item_label('coin_closed', '{"name": "Y"}') = 'Y eingestellt'
  and public.trust_delta('rugPull') = -20,
  'run_due_jobs() runs crypto_run_due(), market_tick() the crypto tick, account_wipe() closes coins; feed labels and trust kept');
select tests.throws($$select public.api_error('coin_not_found')$$, 'NX096', 'coin_not_found is NX096');
select tests.throws($$select public.api_error('coin_not_launched')$$, 'NX103', 'coin_not_launched is NX103');
select tests.throws($$select public.api_error('deal_too_big')$$, 'NX095', 'deal_too_big (M4k) is NX095');
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.pools_ok() and tests.money_invariant() = 'ok',
  'closed money system after all crypto tests: ledger audit clean, every pool matches its account');
