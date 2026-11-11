-- ===== idempotent copy of migrations/20261111000200_m1_trading.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M1 · 0200 · Trading: fills, place_order, cancel_order, vault,
--                    tutorial
-- =============================================================================
-- Execution model (docs/SIMULATION.md 6-8, ADR-005, ADR-025):
--   * every player order trades against the market maker; a market order
--     walks the synthetic book from the touch price (ask for buys, bid for
--     sells). With linear impact the average price is
--         touch x (1 +- a x (pending + q / 2)),   a = impactBpsPerDepth / 1e4 / depth
--     where "pending" is the same-direction player flow not yet absorbed by
--     the next market tick (so splitting an order inside one tick does not help)
--   * the net flow is stored in security_sim_state.pending_player_flow and
--     moves the price in the next tick (immediate share), the market maker
--     hedges the rest over the following ticks
--   * fee: trading.orderFeeCents once per order (first fill)
--   * tax: trading.capitalGainsTaxBps on realised gains after fees, FIFO lots,
--     loss pot in player_private.tax_loss_pot_cents (never refunded)
--   * lock order (deadlock free): player ledger accounts (id order) ->
--     position / order / player rows -> system ledger accounts (ledger_post)
--     -> security_quotes / security_sim_state
-- =============================================================================

-- Market depth in shares (one depth moves the price by impactBpsPerDepth).
create or replace function public.security_depth(p_security_id uuid, p_regular boolean)
returns double precision
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind   public.security_kind;
  v_shares bigint;
  v_liq    bigint;
  v_base   double precision;
  v_factor double precision := 1;
begin
  select s.kind, c.shares_outstanding, st.liquidity_shares
    into v_kind, v_shares, v_liq
    from public.securities s
    left join public.companies c on c.id = s.company_id
    left join public.security_sim_state st on st.security_id = s.id
   where s.id = p_security_id;
  if v_kind = 'stock' and v_shares is not null then
    v_base := v_shares * public.config_double('trading', '{priceImpact,depthFreeFloatFraction}', 0.002);
  else
    v_base := coalesce(v_liq, 100000);
  end if;
  if not p_regular then
    v_factor := public.config_double('time', '{afterHours,liquidityMultiplier}', 0.25);
  end if;
  return greatest(1, v_base * v_factor);
end;
$$;

-- ---------------------------------------------------------------------------
-- execute_fill: books ONE fill of an order against the market maker.
--   p_resting  true = a resting limit order filled by the tick (buys pay from
--              the reserve account, sells deliver reserved shares)
--   p_system   true = system order (bond redemption): no fee, no XP
-- ---------------------------------------------------------------------------
create or replace function public.execute_fill(
  p_order_id uuid,
  p_quantity bigint,
  p_price_e4 bigint,
  p_resting  boolean default false,
  p_system   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o            public.orders;
  v_trading    jsonb := coalesce(public.config_jsonb('trading'), '{}'::jsonb);
  v_prog       jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_now        timestamptz := public.game_now();
  v_cash       uuid;
  v_reserve    uuid;
  v_gross      bigint;
  v_fee        bigint := 0;
  v_tax        bigint := 0;
  v_pnl        bigint;
  v_cost       bigint := 0;
  v_release    bigint := 0;
  v_cash_delta bigint;
  v_balance    bigint;
  v_pos        public.positions;
  v_basis_new  bigint;
  v_avg_new    bigint;
  v_trade_id   uuid := gen_random_uuid();
  v_tx         uuid;
  v_xp         integer := 0;
  v_wash       boolean := false;
  v_pot        bigint;
  v_offset     bigint;
  v_left       bigint;
  v_take       bigint;
  v_entries    jsonb;
  v_tick_seq   bigint;
  v_year       integer;
  lot          record;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % does not exist', p_order_id using errcode = 'NX007';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > o.quantity - o.filled_quantity then
    raise exception 'invalid fill quantity % for order %', p_quantity, p_order_id using errcode = 'NX007';
  end if;
  if p_price_e4 is null or p_price_e4 <= 0 then
    raise exception 'invalid fill price %', p_price_e4 using errcode = 'NX007';
  end if;

  v_gross := public.order_value_cents(p_quantity, p_price_e4);
  if o.fee_cents = 0 and not p_system then
    v_fee := greatest(0, public.cfg_num(v_trading, '{orderFeeCents}', 100))::bigint;
  end if;
  v_cash    := public.ledger_player_account(o.player_id, 'player_cash');
  v_reserve := public.ledger_player_account(o.player_id, 'player_reserve');
  select a.balance_cents into v_balance from public.ledger_accounts a where a.id = v_cash;

  select * into v_pos
    from public.positions p
   where p.player_id = o.player_id and p.security_id = o.security_id
     and p.side = 'long' and p.leverage = 1 and p.status = 'open'
     for update;

  if o.side = 'buy' then
    if p_resting then
      v_release := o.reserved_cents;
    end if;
    v_cash_delta := v_release - v_gross - v_fee;
    if v_balance + v_cash_delta < 0 then
      perform public.api_error('insufficient_funds');
    end if;
    if v_pos.id is null then
      insert into public.positions (player_id, security_id, quantity, avg_entry_price_e4, cost_basis_cents, opened_at)
      values (o.player_id, o.security_id, 0, p_price_e4, 0, v_now)
      returning * into v_pos;
    end if;
  else
    if v_pos.id is null
       or v_pos.quantity < p_quantity
       or (not p_resting and v_pos.quantity - v_pos.reserved_quantity < p_quantity)
       or (p_resting and v_pos.reserved_quantity < p_quantity) then
      perform public.api_error('insufficient_position');
    end if;
    -- FIFO lots
    v_left := p_quantity;
    for lot in
      select l.id, l.quantity_open
        from public.position_lots l
       where l.position_id = v_pos.id and l.quantity_open > 0
       order by l.acquired_at, l.id
         for update
    loop
      exit when v_left = 0;
      v_take := least(v_left, lot.quantity_open);
      update public.position_lots
         set quantity_open = quantity_open - v_take,
             closed_at = case when quantity_open - v_take = 0 then v_now else closed_at end
       where id = lot.id;
      v_left := v_left - v_take;
    end loop;
    select coalesce(sum(public.order_value_cents(l.quantity_open, l.price_e4)), 0)::bigint
      into v_basis_new
      from public.position_lots l where l.position_id = v_pos.id and l.quantity_open > 0;
    if v_left > 0 then
      -- position without lot history (should not happen): value the rest at the average entry
      v_cost := v_pos.cost_basis_cents - v_basis_new + public.order_value_cents(v_left, v_pos.avg_entry_price_e4);
    else
      v_cost := v_pos.cost_basis_cents - v_basis_new;
    end if;
    v_cost := greatest(v_cost, 0);

    v_pnl := v_gross - v_fee - v_cost;
    select pp.tax_loss_pot_cents into v_pot
      from public.player_private pp where pp.player_id = o.player_id for update;
    v_pot := coalesce(v_pot, 0);
    if v_pnl <= 0 then
      v_pot := v_pot - v_pnl;
    else
      v_offset := least(v_pnl, v_pot);
      v_tax := public.apply_bps(v_pnl - v_offset, public.cfg_num(v_trading, '{capitalGainsTaxBps}', 2500)::numeric);
      v_pot := v_pot - v_offset;
    end if;
    update public.player_private set tax_loss_pot_cents = v_pot where player_id = o.player_id;

    v_cash_delta := v_gross - v_fee - v_tax;
    if v_balance + v_cash_delta < 0 then
      perform public.api_error('insufficient_funds');
    end if;
    v_wash := exists (
      select 1 from public.trades t
       where t.player_id = o.player_id and t.security_id = o.security_id and t.side = 'buy'
         and t.executed_at > v_now - make_interval(secs => public.cfg_num(v_trading, '{washTradeWindowSeconds}', 600)));
  end if;

  -- ledger: one balanced transaction per fill
  select coalesce(jsonb_agg(jsonb_build_object('account_id', e.account_id, 'amount_cents', e.amount)), '[]'::jsonb)
    into v_entries
    from (values
      (v_cash,                                    v_cash_delta),
      (v_reserve,                                 -v_release),
      (public.ledger_system_account('market'),    case when o.side = 'buy' then v_gross else -v_gross end),
      (public.ledger_system_account('fees'),      v_fee),
      (public.ledger_system_account('taxes'),     v_tax)
    ) as e(account_id, amount)
   where e.amount <> 0;
  if jsonb_array_length(v_entries) >= 2 then
    v_tx := public.ledger_post(
      case when p_system then 'bond_redemption'::public.ledger_tx_kind
           when o.side = 'buy' then 'trade_buy'::public.ledger_tx_kind
           else 'trade_sell'::public.ledger_tx_kind end,
      v_entries,
      case when o.side = 'buy' then 'Kauf ' else 'Verkauf ' end || p_quantity || ' Stück',
      'order', o.id, 'fill:' || v_trade_id::text, o.player_id,
      jsonb_build_object('quantity', p_quantity, 'price_e4', p_price_e4, 'trade_id', v_trade_id));
  end if;

  -- XP: one trade XP per order (progression.xpSources.trade), not below the
  -- minimum order value, not for closing a position opened inside the wash-trade window
  if not p_system and not v_wash
     and v_gross >= public.cfg_num(v_prog, '{xpSources,trade,minOrderValueCents}', 10000) then
    v_xp := public.grant_xp(o.player_id, 'trade', public.cfg_num(v_prog, '{xpSources,trade,xp}', 10)::integer,
                            'trade:' || o.id::text, 'trade', v_trade_id);
  end if;

  select r.tick_seq into v_tick_seq from public.sim_runtime r where r.id;
  insert into public.trades (
    id, order_id, player_id, security_id, position_id, side, quantity, price_e4, gross_cents, fee_cents,
    tax_cents, realized_pnl_cents, counterparty, ledger_transaction_id, tick_seq, is_wash_trade, xp_awarded, executed_at)
  values (
    v_trade_id, o.id, o.player_id, o.security_id, v_pos.id, o.side, p_quantity, p_price_e4, v_gross, v_fee,
    v_tax, case when o.side = 'sell' then v_pnl end,
    case when p_system then 'issuer'::public.trade_counterparty else 'market_maker'::public.trade_counterparty end,
    v_tx, v_tick_seq, v_wash, v_xp, v_now);

  -- position and lots
  if o.side = 'buy' then
    insert into public.position_lots (position_id, player_id, security_id, trade_id, quantity_initial, quantity_open, price_e4, acquired_at)
    values (v_pos.id, o.player_id, o.security_id, v_trade_id, p_quantity, p_quantity, p_price_e4, v_now);
    select coalesce(sum(public.order_value_cents(l.quantity_open, l.price_e4)), 0)::bigint,
           coalesce(public.div_round_half_even(sum(l.quantity_open::numeric * l.price_e4), sum(l.quantity_open)), p_price_e4)
      into v_basis_new, v_avg_new
      from public.position_lots l where l.position_id = v_pos.id and l.quantity_open > 0;
    update public.positions
       set quantity = quantity + p_quantity,
           cost_basis_cents = v_basis_new,
           avg_entry_price_e4 = v_avg_new
     where id = v_pos.id;
  else
    select coalesce(public.div_round_half_even(sum(l.quantity_open::numeric * l.price_e4), sum(l.quantity_open)), 0)
      into v_avg_new
      from public.position_lots l where l.position_id = v_pos.id and l.quantity_open > 0;
    update public.positions
       set quantity = quantity - p_quantity,
           reserved_quantity = case when p_resting then reserved_quantity - p_quantity else reserved_quantity end,
           cost_basis_cents = v_basis_new,
           avg_entry_price_e4 = case when quantity - p_quantity = 0 then avg_entry_price_e4 else v_avg_new end,
           realized_pnl_cents = realized_pnl_cents + v_pnl,
           status = case when quantity - p_quantity = 0 then 'closed'::public.position_status else status end,
           closed_at = case when quantity - p_quantity = 0 then v_now else closed_at end
     where id = v_pos.id;

    v_year := coalesce((select q.game_year from public.current_game_quarter() q), 0);
    insert into public.player_tax_years as t (player_id, game_year, realized_gains_cents, realized_losses_cents, tax_paid_cents)
    values (o.player_id, v_year, greatest(v_pnl, 0), greatest(-v_pnl, 0), v_tax)
    on conflict (player_id, game_year) do update
      set realized_gains_cents  = t.realized_gains_cents + excluded.realized_gains_cents,
          realized_losses_cents = t.realized_losses_cents + excluded.realized_losses_cents,
          tax_paid_cents        = t.tax_paid_cents + excluded.tax_paid_cents,
          updated_at            = now();
  end if;

  update public.orders
     set filled_quantity    = filled_quantity + p_quantity,
         avg_fill_price_e4  = public.div_round_half_even(
                                coalesce(avg_fill_price_e4, 0)::numeric * filled_quantity + p_price_e4::numeric * p_quantity,
                                filled_quantity + p_quantity),
         fee_cents          = fee_cents + v_fee,
         reserved_cents     = case when p_resting and side = 'buy' then 0 else reserved_cents end,
         reserved_quantity  = case when p_resting and side = 'sell' then reserved_quantity - p_quantity else reserved_quantity end,
         status             = case when filled_quantity + p_quantity >= quantity then 'filled'::public.order_status
                                   else 'partially_filled'::public.order_status end,
         filled_at          = case when filled_quantity + p_quantity >= quantity then v_now else filled_at end
   where id = o.id;

  -- market data: volume now, price effect in the next tick (player flow)
  update public.security_quotes
     set day_volume = day_volume + p_quantity,
         day_turnover_cents = day_turnover_cents + v_gross
   where security_id = o.security_id;
  if not p_system then
    update public.security_sim_state
       set pending_player_flow = pending_player_flow + case when o.side = 'buy' then p_quantity else -p_quantity end
     where security_id = o.security_id;
  end if;

  return jsonb_build_object(
    'trade_id', v_trade_id, 'quantity', p_quantity, 'price_e4', p_price_e4, 'gross_cents', v_gross,
    'fee_cents', v_fee, 'tax_cents', v_tax, 'realized_pnl_cents', case when o.side = 'sell' then v_pnl end,
    'xp_awarded', v_xp, 'wash_trade', v_wash);
end;
$$;
comment on function public.execute_fill(uuid, bigint, bigint, boolean, boolean) is 'Internal: books one fill (ledger, position, FIFO lots, fee, tax with loss pot, trade XP, player flow). Caller holds the player''s account locks.';

-- Cancels an open order and releases its reservation. Caller holds the account locks.
create or replace function public.cancel_order_internal(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    perform public.api_error('order_not_found');
  end if;
  if o.status not in ('pending', 'open', 'partially_filled') then
    perform public.api_error('order_not_open');
  end if;
  if o.side = 'buy' and o.reserved_cents > 0 then
    perform public.ledger_transfer(
      public.ledger_player_account(o.player_id, 'player_reserve'),
      public.ledger_player_account(o.player_id, 'player_cash'),
      o.reserved_cents, 'order_release', 'Freigabe Limit-Order', 'order', o.id,
      'release:' || o.id::text, o.player_id);
  end if;
  if o.side = 'sell' and o.reserved_quantity > 0 then
    update public.positions p
       set reserved_quantity = greatest(0, p.reserved_quantity - o.reserved_quantity)
     where p.player_id = o.player_id and p.security_id = o.security_id
       and p.side = 'long' and p.leverage = 1 and p.status = 'open';
  end if;
  update public.orders
     set status = 'cancelled', cancelled_at = now(), reserved_cents = 0, reserved_quantity = 0
   where id = o.id;
  return jsonb_build_object('order_id', o.id, 'status', 'cancelled');
end;
$$;

-- Locks the caller's ledger accounts (cash, reserve) in id order and returns the cash balance.
create or replace function public.lock_player_accounts(p_player uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash bigint;
begin
  perform 1 from public.ledger_accounts a where a.owner_player_id = p_player order by a.id for update;
  select a.balance_cents into v_cash from public.ledger_accounts a
   where a.owner_player_id = p_player and a.kind = 'player_cash';
  return coalesce(v_cash, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order (RPC)
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_request_id     uuid,
  p_ticker         text,
  p_side           text,
  p_type           text,
  p_quantity       bigint,
  p_limit_price_e4 bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player     uuid;
  v_replay     jsonb;
  v_trading    jsonb := coalesce(public.config_jsonb('trading'), '{}'::jsonb);
  v_abuse      jsonb := coalesce(public.config_jsonb('abuse'), '{}'::jsonb);
  v_side       public.order_side;
  v_type       public.order_type;
  v_limit      bigint;
  s            public.securities;
  v_level      integer;
  v_cash       bigint;
  v_bid        bigint;
  v_ask        bigint;
  v_pending    bigint;
  v_regular    boolean;
  v_depth      double precision;
  v_a          double precision;
  v_pos        double precision;
  v_touch      bigint;
  v_fill_qty   bigint := 0;
  v_fill_price bigint;
  v_rest       bigint;
  v_fee        bigint;
  v_need       bigint;
  v_reserve    bigint := 0;
  v_avail      bigint;
  v_order_id   uuid := gen_random_uuid();
  v_fill       jsonb;
  o            public.orders;
  v_prof       public.profiles;
  v_min_price  bigint;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'place_order');
  if v_replay is not null then
    return v_replay;
  end if;

  -- inputs -------------------------------------------------------------------
  if lower(coalesce(p_side, '')) not in ('buy', 'sell') or lower(coalesce(p_type, '')) not in ('market', 'limit') then
    perform public.api_error('invalid_argument');
  end if;
  v_side := lower(p_side)::public.order_side;
  v_type := lower(p_type)::public.order_type;
  if p_quantity is null or p_quantity < 1
     or p_quantity > public.cfg_num(v_trading, '{maxOrderQuantity}', 100000) then
    perform public.api_error('invalid_quantity');
  end if;
  if v_type = 'limit' then
    if p_limit_price_e4 is null or p_limit_price_e4 < 1 or p_limit_price_e4 > 100000000000 then
      perform public.api_error('invalid_price');
    end if;
    v_limit := p_limit_price_e4;
  end if;

  select * into s from public.securities where id = public.resolve_security(p_ticker);
  if s.id is null then
    perform public.api_error('unknown_security');
  end if;
  if s.kind not in ('stock', 'bond') or s.status <> 'listed' or not s.is_tradable then
    perform public.api_error('not_tradable');
  end if;
  if (select r.is_paused from public.sim_runtime r where r.id) then
    perform public.api_error('market_paused');
  end if;

  select p.level into v_level from public.profiles p where p.id = v_player;
  if v_type = 'limit' and v_level < public.unlock_level('limit_orders') then
    perform public.api_error('locked');
  end if;
  if s.kind = 'bond' and v_level < public.unlock_level('bonds') then
    perform public.api_error('locked');
  end if;

  if not public.rate_limit_hit(v_player, 'place_order',
           greatest(1, public.cfg_num(v_abuse, '{rateLimits,ordersPerMinute}', 20))::integer, 60)
     or not public.rate_limit_hit(v_player, 'place_order_day',
           greatest(1, public.cfg_num(v_abuse, '{rateLimits,ordersPerDay}', 500))::integer, 86400) then
    perform public.api_error('rate_limited');
  end if;

  -- locks, quote ---------------------------------------------------------------
  v_cash := public.lock_player_accounts(v_player);
  select q.bid_e4, q.ask_e4 into v_bid, v_ask from public.security_quotes q where q.security_id = s.id;
  select st.pending_player_flow into v_pending from public.security_sim_state st where st.security_id = s.id;
  if v_bid is null or v_ask is null then
    perform public.api_error('not_tradable');
  end if;
  v_pending   := coalesce(v_pending, 0);
  v_regular   := public.market_session_at(public.game_now()) = 'regular';
  v_depth     := public.security_depth(s.id, v_regular);
  v_a         := public.cfg_num(v_trading, '{priceImpact,impactBpsPerDepth}', 100) / 10000.0 / v_depth;
  v_fee       := greatest(0, public.cfg_num(v_trading, '{orderFeeCents}', 100))::bigint;
  v_min_price := greatest(1, public.cfg_num(v_trading, '{minPriceE4}', 1))::bigint;

  if v_side = 'buy' then
    v_touch := v_ask;
    v_pos := greatest(v_pending, 0);
  else
    v_touch := v_bid;
    v_pos := greatest(-v_pending, 0);
  end if;

  -- how much executes now --------------------------------------------------------
  if v_type = 'market' then
    v_fill_qty := p_quantity;
  elsif v_side = 'buy' and v_touch <= v_limit then
    if v_touch * (1 + v_a * (v_pos + p_quantity)) <= v_limit then
      v_fill_qty := p_quantity;
    else
      v_fill_qty := greatest(0, least(p_quantity, floor((v_limit::double precision / v_touch - 1) / v_a - v_pos)::bigint));
    end if;
  elsif v_side = 'sell' and v_touch >= v_limit then
    if v_touch * (1 - v_a * (v_pos + p_quantity)) >= v_limit then
      v_fill_qty := p_quantity;
    else
      v_fill_qty := greatest(0, least(p_quantity, floor((1 - v_limit::double precision / v_touch) / v_a - v_pos)::bigint));
    end if;
  end if;

  if v_fill_qty > 0 then
    if v_side = 'buy' then
      v_fill_price := round(v_touch * (1 + v_a * (v_pos + v_fill_qty / 2.0)))::bigint;
      if v_type = 'limit' then
        v_fill_price := least(v_fill_price, v_limit);
      end if;
    else
      v_fill_price := greatest(v_min_price, round(v_touch * (1 - v_a * (v_pos + v_fill_qty / 2.0)))::bigint);
      if v_type = 'limit' then
        v_fill_price := greatest(v_fill_price, v_limit);
      end if;
    end if;
  end if;
  v_rest := p_quantity - v_fill_qty;

  -- funds / shares ---------------------------------------------------------------
  if v_side = 'sell' then
    select p.quantity - p.reserved_quantity into v_avail
      from public.positions p
     where p.player_id = v_player and p.security_id = s.id and p.side = 'long' and p.leverage = 1 and p.status = 'open'
       for update;
    if coalesce(v_avail, 0) < p_quantity then
      perform public.api_error('insufficient_position');
    end if;
  else
    v_need := 0;
    if v_fill_qty > 0 then
      v_need := public.order_value_cents(v_fill_qty, v_fill_price) + v_fee;
    end if;
    if v_rest > 0 then
      v_need := v_need + public.order_value_cents(v_rest, v_limit) + case when v_fill_qty > 0 then 0 else v_fee end;
    end if;
    if v_need > v_cash then
      perform public.api_error('insufficient_funds');
    end if;
  end if;

  -- order, fill, reservation ---------------------------------------------------------
  insert into public.orders (id, player_id, security_id, request_id, side, type, quantity, limit_price_e4, status)
  values (v_order_id, v_player, s.id, p_request_id, v_side, v_type, p_quantity, v_limit, 'pending');

  if v_fill_qty > 0 then
    v_fill := public.execute_fill(v_order_id, v_fill_qty, v_fill_price, false, false);
  end if;

  if v_rest > 0 then
    select * into o from public.orders where id = v_order_id;
    if v_side = 'buy' then
      v_reserve := public.order_value_cents(v_rest, v_limit) + case when o.fee_cents = 0 then v_fee else 0 end;
      if v_reserve > 0 then
        perform public.ledger_transfer(
          public.ledger_player_account(v_player, 'player_cash'),
          public.ledger_player_account(v_player, 'player_reserve'),
          v_reserve, 'order_reserve', 'Reservierung Limit-Order', 'order', v_order_id,
          'reserve:' || v_order_id::text, v_player);
      end if;
      update public.orders set reserved_cents = v_reserve where id = v_order_id;
    else
      update public.positions p
         set reserved_quantity = p.reserved_quantity + v_rest
       where p.player_id = v_player and p.security_id = s.id and p.side = 'long' and p.leverage = 1 and p.status = 'open';
      update public.orders set reserved_quantity = v_rest where id = v_order_id;
    end if;
    update public.orders
       set status = case when v_fill_qty > 0 then 'partially_filled'::public.order_status else 'open'::public.order_status end
     where id = v_order_id;
  end if;

  select * into o from public.orders where id = v_order_id;
  select * into v_prof from public.profiles where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'order_id',           o.id,
    'status',             o.status,
    'filled_quantity',    o.filled_quantity,
    'avg_price_e4',       o.avg_fill_price_e4,
    'gross_cents',        coalesce((v_fill ->> 'gross_cents')::bigint, 0),
    'fee_cents',          o.fee_cents,
    'tax_cents',          coalesce((v_fill ->> 'tax_cents')::bigint, 0),
    'realized_pnl_cents', (v_fill ->> 'realized_pnl_cents')::bigint,
    'cash_cents',         (select a.balance_cents from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash'),
    'reserved_cents',     o.reserved_cents,
    'xp_awarded',         coalesce((v_fill ->> 'xp_awarded')::integer, 0),
    'level',              v_prof.level,
    'xp_total',           v_prof.xp_total,
    'ticker',             s.ticker,
    'side',               o.side,
    'type',               o.type,
    'quantity',           o.quantity,
    'limit_price_e4',     o.limit_price_e4));
end;
$$;
comment on function public.place_order(uuid, text, text, text, bigint, bigint) is 'RPC: market or limit order (stocks and bonds), idempotent per request_id. See docs/DATA_MODEL.md, Nachtrag M1.';

-- ---------------------------------------------------------------------------
-- cancel_order (RPC)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(p_request_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_owner  uuid;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'cancel_order');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  perform public.lock_player_accounts(v_player);
  select o.player_id into v_owner from public.orders o where o.id = p_order_id;
  if v_owner is null or v_owner <> v_player then
    perform public.api_error('order_not_found');
  end if;
  return public.request_complete(v_player, p_request_id, public.cancel_order_internal(p_order_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Vault (basic income) and tutorial
-- ---------------------------------------------------------------------------
create or replace function public.vault_status(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rate    bigint := greatest(0, public.config_bigint('economy', '{basicIncomeCentsPerHour}', 10000));
  v_hours   double precision := greatest(0, public.config_double('economy', '{vaultCapHours}', 8));
  v_now     timestamptz := public.game_now();
  v         public.vaults;
  v_ms      double precision;
begin
  select * into v from public.vaults where player_id = p_player;
  if not found then
    return null;
  end if;
  v_ms := least(greatest(0, extract(epoch from (v_now - v.accrual_started_at)) * 1000), v_hours * 3600000);
  return jsonb_build_object(
    'accrued_cents',       floor(v_rate * v_ms / 3600000)::bigint,
    'cap_cents',           round(v_rate * v_hours)::bigint,
    'rate_cents_per_hour', v_rate,
    'last_claimed_at',     v.last_claimed_at,
    'full_at',             v.accrual_started_at + make_interval(secs => v_hours * 3600),
    'server_time',         v_now,
    'accrued_seconds',     floor(v_ms / 1000)::bigint);
end;
$$;

create or replace function public.claim_vault(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  v_status  jsonb;
  v_amount  bigint;
  v_now     timestamptz := public.game_now();
  v_tx      uuid;
  v_total   integer;
  v_counted integer;
  v_hours   double precision := greatest(0, public.config_double('economy', '{vaultCapHours}', 8));
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'claim_vault');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  perform public.lock_player_accounts(v_player);
  perform 1 from public.vaults where player_id = v_player for update;
  v_status := public.vault_status(v_player);
  v_amount := coalesce((v_status ->> 'accrued_cents')::bigint, 0);
  if v_amount < greatest(1, public.config_bigint('economy', '{vaultMinClaimCents}', 100)) then
    perform public.api_error('nothing_to_claim');
  end if;

  v_tx := public.ledger_transfer(
    public.ledger_system_account('mint'), public.ledger_player_account(v_player, 'player_cash'),
    v_amount, 'vault_claim', 'Grundeinkommen aus dem Tresor', 'vault', null,
    'vault:' || v_player::text || ':' || p_request_id::text, v_player);

  select greatest(0, floor(extract(epoch from (v_now - v.accrual_started_at))))::integer into v_total
    from public.vaults v where v.player_id = v_player;
  v_counted := (v_status ->> 'accrued_seconds')::integer;
  insert into public.vault_claims (player_id, request_id, amount_cents, accrued_seconds, forfeited_seconds, ledger_transaction_id)
  values (v_player, p_request_id, v_amount, v_counted, greatest(0, v_total - v_counted), v_tx)
  on conflict (player_id, request_id) do nothing;
  update public.vaults
     set accrual_started_at = v_now, last_claimed_at = v_now,
         total_claimed_cents = total_claimed_cents + v_amount, full_notified_at = null
   where player_id = v_player;

  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'claimed_cents', v_amount,
    'cash_cents',    (select a.balance_cents from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash'),
    'full_at',       v_now + make_interval(secs => v_hours * 3600)));
end;
$$;

create or replace function public.complete_tutorial(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_done   timestamptz;
  v_xp     integer := 0;
  v_prof   public.profiles;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'complete_tutorial');
  if v_replay is not null then
    return v_replay;
  end if;
  select pp.tutorial_completed_at into v_done from public.player_private pp where pp.player_id = v_player for update;
  if v_done is null then
    update public.player_private set tutorial_completed_at = now() where player_id = v_player;
    v_xp := public.grant_xp(v_player, 'tutorial',
              public.config_double('progression', '{xpSources,tutorial,xp}', 50)::integer, 'tutorial', 'tutorial', null);
  end if;
  select * into v_prof from public.profiles where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'xp_awarded', v_xp, 'level', v_prof.level, 'xp_total', v_prof.xp_total,
    'already_completed', v_done is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.security_depth(uuid, boolean)', 'public.execute_fill(uuid, bigint, bigint, boolean, boolean)',
    'public.cancel_order_internal(uuid)', 'public.lock_player_accounts(uuid)', 'public.vault_status(uuid)',
    'public.place_order(uuid, text, text, text, bigint, bigint)', 'public.cancel_order(uuid, uuid)',
    'public.claim_vault(uuid)', 'public.complete_tutorial(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.place_order(uuid, text, text, text, bigint, bigint) to authenticated;
  grant execute on function public.cancel_order(uuid, uuid) to authenticated;
  grant execute on function public.claim_vault(uuid) to authenticated;
  grant execute on function public.complete_tutorial(uuid) to authenticated;
end;
$$;
