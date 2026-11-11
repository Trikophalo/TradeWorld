-- =============================================================================
-- NEXA · M2a · 0300 · Trading with fractional shares (millionths), money from
--                     and to the state, amount orders
-- =============================================================================
-- Quantities are bigint millionths of a share (1 share = 1 000 000).
-- value_cents = round_half_even(quantity_e6 x price_e4 / 100 000 000).
-- Counterparties (closed money system): stocks trade against the financial
-- market (system account "market"), bonds against the treasury (the state
-- issues and buys back); fees and taxes go to the treasury.
-- =============================================================================

create or replace function public.value_cents(p_quantity_e6 bigint, p_price_e4 bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select public.div_round_half_even(p_quantity_e6::numeric * p_price_e4, 100000000);
$$;
comment on function public.value_cents(bigint, bigint) is 'round_half_even(quantity_e6 x price_e4 / 1e8): the only place where a price and a (fractional) quantity turn into money.';

-- ---------------------------------------------------------------------------
-- execute_fill: books ONE fill of an order (quantity in millionths)
-- ---------------------------------------------------------------------------
create or replace function public.execute_fill(
  p_order_id    uuid,
  p_quantity bigint,
  p_price_e4    bigint,
  p_resting     boolean default false,
  p_system      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o            public.orders;
  s            public.securities;
  v_trading    jsonb := coalesce(public.config_jsonb('trading'), '{}'::jsonb);
  v_prog       jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_now        timestamptz := public.game_now();
  v_cash       uuid;
  v_reserve    uuid;
  v_counter    uuid;
  v_treasury   uuid;
  v_counter_ok boolean;
  v_counter_bal bigint;
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
  v_first      boolean;
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
  if p_quantity is null or p_quantity <= 0 or p_quantity > o.quantity_e6 - o.filled_quantity_e6 then
    raise exception 'invalid fill quantity % for order %', p_quantity, p_order_id using errcode = 'NX007';
  end if;
  if p_price_e4 is null or p_price_e4 <= 0 then
    raise exception 'invalid fill price %', p_price_e4 using errcode = 'NX007';
  end if;
  select * into s from public.securities where id = o.security_id;
  v_first := o.filled_quantity_e6 = 0;

  v_gross := public.value_cents(p_quantity, p_price_e4);
  if o.fee_cents = 0 and not p_system then
    v_fee := greatest(0, public.cfg_num(v_trading, '{orderFeeCents}', 100))::bigint;
  end if;
  v_cash     := public.ledger_player_account(o.player_id, 'player_cash');
  v_reserve  := public.ledger_player_account(o.player_id, 'player_reserve');
  v_treasury := public.ledger_system_account('treasury');
  v_counter  := case when s.kind = 'bond' then v_treasury else public.ledger_system_account('market') end;
  select a.balance_cents into v_balance from public.ledger_accounts a where a.id = v_cash;
  select a.balance_cents, a.allow_negative into v_counter_bal, v_counter_ok from public.ledger_accounts a where a.id = v_counter;

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
      insert into public.positions (player_id, security_id, quantity_e6, avg_entry_price_e4, cost_basis_cents, opened_at)
      values (o.player_id, o.security_id, 0, p_price_e4, 0, v_now)
      returning * into v_pos;
    end if;
  else
    if v_pos.id is null
       or v_pos.quantity_e6 < p_quantity
       or (not p_resting and v_pos.quantity_e6 - v_pos.reserved_quantity_e6 < p_quantity)
       or (p_resting and v_pos.reserved_quantity_e6 < p_quantity) then
      perform public.api_error('insufficient_position');
    end if;
    -- the financial market (or the treasury for bonds) must be able to pay
    v_counter_bal := v_counter_bal - v_gross;
    if v_counter = v_treasury then
      v_counter_bal := v_counter_bal + v_fee;
    end if;
    if not v_counter_ok and v_counter_bal < 0 then
      perform public.api_error('market_illiquid');
    end if;
    v_left := p_quantity;
    for lot in
      select l.id, l.quantity_open_e6
        from public.position_lots l
       where l.position_id = v_pos.id and l.quantity_open_e6 > 0
       order by l.acquired_at, l.id
         for update
    loop
      exit when v_left = 0;
      v_take := least(v_left, lot.quantity_open_e6);
      update public.position_lots
         set quantity_open_e6 = quantity_open_e6 - v_take,
             closed_at = case when quantity_open_e6 - v_take = 0 then v_now else closed_at end
       where id = lot.id;
      v_left := v_left - v_take;
    end loop;
    select coalesce(sum(public.value_cents(l.quantity_open_e6, l.price_e4)), 0)::bigint
      into v_basis_new
      from public.position_lots l where l.position_id = v_pos.id and l.quantity_open_e6 > 0;
    v_cost := v_pos.cost_basis_cents - v_basis_new;
    if v_left > 0 then
      v_cost := v_cost + public.value_cents(v_left, v_pos.avg_entry_price_e4);
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

  -- ledger: one balanced transaction per fill (entries on the same account merged)
  select coalesce(jsonb_agg(jsonb_build_object('account_id', x.account_id, 'amount_cents', x.amount)), '[]'::jsonb)
    into v_entries
    from (select e.account_id, sum(e.amount)::bigint as amount
            from (values
              (v_cash,     v_cash_delta),
              (v_reserve,  -v_release),
              (v_counter,  case when o.side = 'buy' then v_gross else -v_gross end),
              (v_treasury, v_fee + v_tax)
            ) as e(account_id, amount)
           group by e.account_id
          having sum(e.amount) <> 0) x;
  if jsonb_array_length(v_entries) >= 2 then
    v_tx := public.ledger_post(
      case when p_system then 'bond_redemption'::public.ledger_tx_kind
           when o.side = 'buy' then 'trade_buy'::public.ledger_tx_kind
           else 'trade_sell'::public.ledger_tx_kind end,
      v_entries,
      case when o.side = 'buy' then 'Kauf ' else 'Verkauf ' end || s.ticker,
      'order', o.id, 'fill:' || v_trade_id::text, o.player_id,
      jsonb_build_object('quantity_e6', p_quantity, 'price_e4', p_price_e4, 'trade_id', v_trade_id));
  end if;

  -- XP: one trade XP per order, not below progression.xpSources.trade.minOrderValueCents,
  -- not for closing a position opened inside the wash-trade window
  if not p_system and not v_wash
     and v_gross >= public.cfg_num(v_prog, '{xpSources,trade,minOrderValueCents}', 10000) then
    v_xp := public.grant_xp(o.player_id, 'trade', public.cfg_num(v_prog, '{xpSources,trade,xp}', 10)::integer,
                            'trade:' || o.id::text, 'trade', v_trade_id);
  end if;

  select r.tick_seq into v_tick_seq from public.sim_runtime r where r.id;
  insert into public.trades (
    id, order_id, player_id, security_id, position_id, side, quantity_e6, price_e4, gross_cents, fee_cents,
    tax_cents, realized_pnl_cents, counterparty, ledger_transaction_id, tick_seq, is_wash_trade, xp_awarded, executed_at)
  values (
    v_trade_id, o.id, o.player_id, o.security_id, v_pos.id, o.side, p_quantity, p_price_e4, v_gross, v_fee,
    v_tax, case when o.side = 'sell' then v_pnl end,
    case when p_system then 'issuer'::public.trade_counterparty else 'market_maker'::public.trade_counterparty end,
    v_tx, v_tick_seq, v_wash, v_xp, v_now);

  if o.side = 'buy' then
    insert into public.position_lots (position_id, player_id, security_id, trade_id, quantity_initial_e6, quantity_open_e6, price_e4, acquired_at)
    values (v_pos.id, o.player_id, o.security_id, v_trade_id, p_quantity, p_quantity, p_price_e4, v_now);
    select coalesce(sum(public.value_cents(l.quantity_open_e6, l.price_e4)), 0)::bigint,
           coalesce(public.div_round_half_even(sum(l.quantity_open_e6::numeric * l.price_e4), sum(l.quantity_open_e6)), p_price_e4)
      into v_basis_new, v_avg_new
      from public.position_lots l where l.position_id = v_pos.id and l.quantity_open_e6 > 0;
    update public.positions
       set quantity_e6 = quantity_e6 + p_quantity, cost_basis_cents = v_basis_new, avg_entry_price_e4 = v_avg_new
     where id = v_pos.id;
  else
    select coalesce(public.div_round_half_even(sum(l.quantity_open_e6::numeric * l.price_e4), sum(l.quantity_open_e6)), 0)
      into v_avg_new
      from public.position_lots l where l.position_id = v_pos.id and l.quantity_open_e6 > 0;
    update public.positions
       set quantity_e6 = quantity_e6 - p_quantity,
           reserved_quantity_e6 = case when p_resting then reserved_quantity_e6 - p_quantity else reserved_quantity_e6 end,
           cost_basis_cents = v_basis_new,
           avg_entry_price_e4 = case when quantity_e6 - p_quantity = 0 then avg_entry_price_e4 else v_avg_new end,
           realized_pnl_cents = realized_pnl_cents + v_pnl,
           status = case when quantity_e6 - p_quantity = 0 then 'closed'::public.position_status else status end,
           closed_at = case when quantity_e6 - p_quantity = 0 then v_now else closed_at end
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
     set filled_quantity_e6   = filled_quantity_e6 + p_quantity,
         avg_fill_price_e4    = public.div_round_half_even(
                                  coalesce(avg_fill_price_e4, 0)::numeric * filled_quantity_e6 + p_price_e4::numeric * p_quantity,
                                  filled_quantity_e6 + p_quantity),
         fee_cents            = fee_cents + v_fee,
         reserved_cents       = case when p_resting and side = 'buy' then 0 else reserved_cents end,
         reserved_quantity_e6 = case when p_resting and side = 'sell' then reserved_quantity_e6 - p_quantity else reserved_quantity_e6 end,
         status               = case when filled_quantity_e6 + p_quantity >= quantity_e6 then 'filled'::public.order_status
                                     else 'partially_filled'::public.order_status end,
         filled_at            = case when filled_quantity_e6 + p_quantity >= quantity_e6 then v_now else filled_at end
   where id = o.id;

  update public.security_quotes
     set day_volume_e6 = day_volume_e6 + p_quantity, day_turnover_cents = day_turnover_cents + v_gross
   where security_id = o.security_id;
  if not p_system then
    update public.security_sim_state
       set pending_player_flow_e6 = pending_player_flow_e6 + case when o.side = 'buy' then p_quantity else -p_quantity end
     where security_id = o.security_id;

    -- missions
    if v_first then
      perform public.mission_event(o.player_id, 'trade', 1, null);
      perform public.mission_event(o.player_id, case when o.side = 'buy' then 'buy' else 'sell' end, 1, null);
    end if;
    perform public.mission_event(o.player_id, 'trade_value', v_gross, null);
    perform public.mission_event(o.player_id, 'trading_day', 1, to_char(v_now at time zone 'Europe/Berlin', 'YYYY-MM-DD'));
    perform public.mission_event(o.player_id, 'distinct_security', 1, s.ticker);
    if o.side = 'buy' then
      perform public.mission_event(o.player_id, 'buy_value', v_gross, null);
      if s.kind = 'bond' then
        perform public.mission_event(o.player_id, 'bond_bought', 1, null);
      elsif s.sector_key is not null then
        perform public.mission_event(o.player_id, 'buy_sector', 1, s.sector_key);
        perform public.mission_event(o.player_id, 'sectors_bought', 1, s.sector_key);
      end if;
    elsif v_pnl > 0 then
      perform public.mission_event(o.player_id, 'realized_profit', v_pnl, null);
    end if;
  end if;

  return jsonb_build_object(
    'trade_id', v_trade_id, 'quantity_e6', p_quantity, 'price_e4', p_price_e4, 'gross_cents', v_gross,
    'fee_cents', v_fee, 'tax_cents', v_tax, 'realized_pnl_cents', case when o.side = 'sell' then v_pnl end,
    'xp_awarded', v_xp, 'wash_trade', v_wash);
end;
$$;
comment on function public.execute_fill(uuid, bigint, bigint, boolean, boolean) is 'Internal: books one fill in millionths (ledger against the financial market or, for bonds, the treasury; fee and tax to the treasury; FIFO lots; loss pot; trade XP; missions; player flow).';

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
  if o.side = 'sell' and o.reserved_quantity_e6 > 0 then
    update public.positions p
       set reserved_quantity_e6 = greatest(0, p.reserved_quantity_e6 - o.reserved_quantity_e6)
     where p.player_id = o.player_id and p.security_id = o.security_id
       and p.side = 'long' and p.leverage = 1 and p.status = 'open';
  end if;
  update public.orders
     set status = 'cancelled', cancelled_at = now(), reserved_cents = 0, reserved_quantity_e6 = 0
   where id = o.id;
  return jsonb_build_object('order_id', o.id, 'status', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order (RPC): quantity in millionths OR an amount in cents
-- ---------------------------------------------------------------------------
drop function if exists public.place_order(uuid, text, text, text, bigint, bigint);

create or replace function public.place_order(
  p_request_id     uuid,
  p_ticker         text,
  p_side           text,
  p_type           text,
  p_quantity_e6    bigint default null,
  p_limit_price_e4 bigint default null,
  p_amount_cents   bigint default null
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
  v_scale      numeric := greatest(1, public.cfg_num(v_trading, '{quantityScale}', 1000000))::numeric;
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
  v_qty        bigint;
  v_fill_qty   bigint := 0;
  v_fill_price bigint;
  v_rest       bigint;
  v_fee        bigint;
  v_min_value  bigint;
  v_need       bigint;
  v_reserve    bigint := 0;
  v_avail      bigint;
  v_net_amount bigint;
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
  if lower(coalesce(p_side, '')) not in ('buy', 'sell') or lower(coalesce(p_type, '')) not in ('market', 'limit')
     or (p_quantity_e6 is null) = (p_amount_cents is null) then
    perform public.api_error('invalid_argument');
  end if;
  v_side := lower(p_side)::public.order_side;
  v_type := lower(p_type)::public.order_type;
  if (p_quantity_e6 is not null and p_quantity_e6 < 1) or (p_amount_cents is not null and p_amount_cents < 1) then
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
  select st.pending_player_flow_e6 into v_pending from public.security_sim_state st where st.security_id = s.id;
  if v_bid is null or v_ask is null then
    perform public.api_error('not_tradable');
  end if;
  v_pending   := coalesce(v_pending, 0);
  v_regular   := public.market_session_at(public.game_now()) = 'regular';
  v_depth     := public.security_depth(s.id, v_regular);                 -- whole shares
  v_a         := public.cfg_num(v_trading, '{priceImpact,impactBpsPerDepth}', 100) / 10000.0 / v_depth;
  v_fee       := greatest(0, public.cfg_num(v_trading, '{orderFeeCents}', 100))::bigint;
  v_min_value := greatest(1, public.cfg_num(v_trading, '{minOrderValueCents}', 100))::bigint;
  v_min_price := greatest(1, public.cfg_num(v_trading, '{minPriceE4}', 1))::bigint;
  if v_side = 'buy' then
    v_touch := v_ask;
    v_pos := greatest(v_pending, 0) / 1000000.0;
  else
    v_touch := v_bid;
    v_pos := greatest(-v_pending, 0) / 1000000.0;
  end if;

  -- quantity from the amount (neo-broker semantics) ------------------------------
  if p_amount_cents is not null then
    if v_side = 'buy' then
      -- the player pays at most the amount including the fee
      v_net_amount := p_amount_cents - v_fee;
      if v_net_amount < v_min_value then
        perform public.api_error('order_too_small');
      end if;
      if v_type = 'limit' then
        v_qty := floor(v_net_amount * 100000000.0 / v_limit)::bigint;
      else
        v_qty := floor(v_net_amount * 100000000.0 / v_touch)::bigint;
        -- price of that quantity (>= the price of the final, slightly smaller quantity)
        v_fill_price := round(v_touch * (1 + v_a * (v_pos + v_qty / v_scale / 2)))::bigint;
        v_qty := floor(v_net_amount * 100000000.0 / v_fill_price)::bigint;
      end if;
    else
      -- the amount is the gross proceeds before fee and tax
      if p_amount_cents < v_min_value then
        perform public.api_error('order_too_small');
      end if;
      if v_type = 'limit' then
        v_qty := ceil(p_amount_cents * 100000000.0 / v_limit)::bigint;
      else
        v_qty := ceil(p_amount_cents * 100000000.0 / v_touch)::bigint;
        v_fill_price := greatest(v_min_price, round(v_touch * (1 - v_a * (v_pos + v_qty / v_scale / 2)))::bigint);
        v_qty := ceil(p_amount_cents * 100000000.0 / v_fill_price)::bigint;
      end if;
    end if;
  else
    v_qty := p_quantity_e6;
  end if;

  if v_qty < 1 then
    perform public.api_error('order_too_small');
  end if;
  if v_qty > public.cfg_num(v_trading, '{maxOrderQuantity}', 100000) * v_scale then
    perform public.api_error('invalid_quantity');
  end if;

  -- sells: free position; >= 99.9 % of it is rounded up to the whole position
  if v_side = 'sell' then
    select p.quantity_e6 - p.reserved_quantity_e6 into v_avail
      from public.positions p
     where p.player_id = v_player and p.security_id = s.id and p.side = 'long' and p.leverage = 1 and p.status = 'open'
       for update;
    v_avail := coalesce(v_avail, 0);
    if v_qty < v_avail and v_qty * 1000 >= v_avail * 999 then
      v_qty := v_avail;
    end if;
    if v_avail < v_qty then
      perform public.api_error('insufficient_position');
    end if;
  end if;

  -- minimum order value at the price it would execute or rest at
  if public.value_cents(v_qty, coalesce(v_limit, v_touch)) < v_min_value
     and not (v_side = 'sell' and v_qty = v_avail) then
    perform public.api_error('order_too_small');
  end if;

  -- how much executes now ---------------------------------------------------------
  if v_type = 'market' then
    v_fill_qty := v_qty;
  elsif v_side = 'buy' and v_touch <= v_limit then
    if v_touch * (1 + v_a * (v_pos + v_qty / v_scale)) <= v_limit then
      v_fill_qty := v_qty;
    else
      v_fill_qty := greatest(0, least(v_qty, floor(((v_limit::double precision / v_touch - 1) / v_a - v_pos) * v_scale)::bigint));
    end if;
  elsif v_side = 'sell' and v_touch >= v_limit then
    if v_touch * (1 - v_a * (v_pos + v_qty / v_scale)) >= v_limit then
      v_fill_qty := v_qty;
    else
      v_fill_qty := greatest(0, least(v_qty, floor(((1 - v_limit::double precision / v_touch) / v_a - v_pos) * v_scale)::bigint));
    end if;
  end if;

  if v_fill_qty > 0 then
    if v_side = 'buy' then
      if not (p_amount_cents is not null and v_type = 'market') then
        v_fill_price := round(v_touch * (1 + v_a * (v_pos + v_fill_qty / v_scale / 2)))::bigint;
      end if;
      if v_type = 'limit' then
        v_fill_price := least(v_fill_price, v_limit);
      end if;
    else
      if not (p_amount_cents is not null and v_type = 'market') then
        v_fill_price := greatest(v_min_price, round(v_touch * (1 - v_a * (v_pos + v_fill_qty / v_scale / 2)))::bigint);
      end if;
      if v_type = 'limit' then
        v_fill_price := greatest(v_fill_price, v_limit);
      end if;
    end if;
  end if;
  v_rest := v_qty - v_fill_qty;

  if v_side = 'buy' then
    v_need := 0;
    if v_fill_qty > 0 then
      v_need := public.value_cents(v_fill_qty, v_fill_price) + v_fee;
    end if;
    if v_rest > 0 then
      v_need := v_need + public.value_cents(v_rest, v_limit) + case when v_fill_qty > 0 then 0 else v_fee end;
    end if;
    if v_need > v_cash then
      perform public.api_error('insufficient_funds');
    end if;
  end if;

  -- order, fill, reservation ---------------------------------------------------------
  insert into public.orders (id, player_id, security_id, request_id, side, type, quantity_e6, limit_price_e4, status)
  values (v_order_id, v_player, s.id, p_request_id, v_side, v_type, v_qty, v_limit, 'pending');

  if v_fill_qty > 0 then
    v_fill := public.execute_fill(v_order_id, v_fill_qty, v_fill_price, false, false);
  end if;

  if v_rest > 0 then
    select * into o from public.orders where id = v_order_id;
    if v_side = 'buy' then
      v_reserve := public.value_cents(v_rest, v_limit) + case when o.fee_cents = 0 then v_fee else 0 end;
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
         set reserved_quantity_e6 = p.reserved_quantity_e6 + v_rest
       where p.player_id = v_player and p.security_id = s.id and p.side = 'long' and p.leverage = 1 and p.status = 'open';
      update public.orders set reserved_quantity_e6 = v_rest where id = v_order_id;
    end if;
    update public.orders
       set status = case when v_fill_qty > 0 then 'partially_filled'::public.order_status else 'open'::public.order_status end
     where id = v_order_id;
  end if;
  if v_type = 'limit' then
    perform public.mission_event(v_player, 'limit_order', 1, null);
  end if;

  select * into o from public.orders where id = v_order_id;
  select * into v_prof from public.profiles where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'order_id',           o.id,
    'status',             o.status,
    'quantity_e6',        o.quantity_e6,
    'filled_quantity_e6', o.filled_quantity_e6,
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
    'limit_price_e4',     o.limit_price_e4,
    'amount_cents',       p_amount_cents));
end;
$$;
comment on function public.place_order(uuid, text, text, text, bigint, bigint, bigint) is 'RPC: market or limit order by quantity (millionths) or by amount (cents), idempotent per request_id. See docs/DATA_MODEL.md, Nachtrag M2.';

-- ---------------------------------------------------------------------------
-- Vault: basic income scaled by the treasury (closed money system)
-- ---------------------------------------------------------------------------
create or replace function public.vault_status(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base    bigint := greatest(0, public.config_bigint('economy', '{basicIncomeCentsPerHour}', 10000));
  v_hours   double precision := greatest(0, public.config_double('economy', '{vaultCapHours}', 8));
  v_factor  integer := public.basic_income_factor_bps();
  v_rate    bigint;
  v_now     timestamptz := public.game_now();
  v         public.vaults;
  v_ms      double precision;
begin
  select * into v from public.vaults where player_id = p_player;
  if not found then
    return null;
  end if;
  v_rate := v_base * v_factor / 10000;
  v_ms := least(greatest(0, extract(epoch from (v_now - v.accrual_started_at)) * 1000), v_hours * 3600000);
  return jsonb_build_object(
    'accrued_cents',       floor(v_rate * v_ms / 3600000)::bigint,
    'cap_cents',           round(v_rate * v_hours)::bigint,
    'rate_cents_per_hour', v_rate,
    'base_rate_cents_per_hour', v_base,
    'factor_bps',          v_factor,
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

  v_tx := public.state_payout(v_player, v_amount, 0, 'vault_claim', 'Grundeinkommen aus dem Tresor', 'vault', null,
                              'vault:' || v_player::text || ':' || p_request_id::text);

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
  perform public.mission_event(v_player, 'vault_claim', 1, null);

  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'claimed_cents', v_amount,
    'cash_cents',    (select a.balance_cents from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash'),
    'full_at',       v_now + make_interval(secs => v_hours * 3600),
    'factor_bps',    (v_status ->> 'factor_bps')::integer));
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
    perform public.mission_event(v_player, 'tutorial', 1, null);
  end if;
  select * into v_prof from public.profiles where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'xp_awarded', v_xp, 'level', v_prof.level, 'xp_total', v_prof.xp_total,
    'already_completed', v_done is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- Bonds: coupons and redemptions come from the treasury
-- ---------------------------------------------------------------------------
create or replace function public.pay_bond_coupons(p_quarter_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q        public.game_quarters;
  v_ppy    double precision := greatest(1, public.config_double('bonds', '{couponsPerGameYear}', 4));
  v_taxbps numeric := public.config_double('trading', '{incomeTaxOnCouponsAndDividendsBps}', 2500)::numeric;
  b        record;
  h        record;
  v_dist   uuid;
  v_coupon numeric;
  v_gross  bigint;
  v_tax    bigint;
  v_tx     uuid;
  v_total  bigint;
  v_n      integer := 0;
begin
  select * into q from public.game_quarters where id = p_quarter_id;
  perform public.lock_bond_participants();
  for b in
    select bd.security_id, bd.coupon_bps, bd.face_value_cents, bd.issued_at, s.ticker
      from public.bonds bd join public.securities s on s.id = bd.security_id
     where s.status = 'listed' and bd.issued_at < q.ends_at and bd.matures_at >= q.ends_at
  loop
    v_coupon := b.face_value_cents::numeric * b.coupon_bps / 10000 / v_ppy::numeric;  -- cents per bond and quarter
    insert into public.security_distributions (security_id, kind, game_quarter_id, amount_per_unit_e4, status, ex_at, pay_at, paid_at)
    values (b.security_id, 'coupon', q.id, round(v_coupon * 100)::bigint, 'paid', q.ends_at, now(), now())
    on conflict (security_id, kind, game_quarter_id) do nothing
    returning id into v_dist;
    continue when v_dist is null;
    v_total := 0;
    for h in
      select l.player_id, sum(l.quantity_open_e6)::bigint as qty_e6,
             sum(l.quantity_open_e6::numeric * greatest(0, least(1,
                   extract(epoch from (q.ends_at - greatest(l.acquired_at, q.starts_at, b.issued_at)))::numeric
                   / extract(epoch from (q.ends_at - q.starts_at))::numeric))) as units_e6
        from public.position_lots l
        join public.positions p on p.id = l.position_id and p.status = 'open'
       where l.security_id = b.security_id and l.quantity_open_e6 > 0
       group by l.player_id
       order by l.player_id
    loop
      v_gross := public.div_round_half_even(h.units_e6 * v_coupon, 1000000);
      continue when v_gross <= 0;
      v_tax := public.apply_bps(v_gross, v_taxbps);
      v_tx := public.state_payout(h.player_id, v_gross, v_tax, 'coupon', 'Kupon ' || b.ticker, 'distribution', v_dist,
                                  'coupon:' || v_dist::text || ':' || h.player_id::text);
      insert into public.distribution_payouts (distribution_id, player_id, quantity_e6, gross_cents, tax_cents, net_cents, ledger_transaction_id)
      values (v_dist, h.player_id, h.qty_e6, v_gross, v_tax, v_gross - v_tax, v_tx)
      on conflict (distribution_id, player_id) do nothing;
      v_total := v_total + v_gross;
      v_n := v_n + 1;
    end loop;
    update public.security_distributions set total_paid_cents = v_total where id = v_dist;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unchanged logic, quantities and volumes in millionths
-- ---------------------------------------------------------------------------
create or replace function public.fill_resting_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_players uuid[];
  v_n       integer := 0;
  r         record;
  o         public.orders;
begin
  select array_agg(distinct o2.player_id) into v_players
    from public.orders o2
    join public.security_quotes q on q.security_id = o2.security_id
    join public.securities s on s.id = o2.security_id
   where o2.type = 'limit' and o2.status in ('open', 'partially_filled')
     and s.status = 'listed' and s.is_tradable
     and ((o2.side = 'buy' and q.ask_e4 <= o2.limit_price_e4) or (o2.side = 'sell' and q.bid_e4 >= o2.limit_price_e4));
  if v_players is null then
    return 0;
  end if;

  -- lock every affected player's accounts up front, in id order (deadlock free)
  perform 1 from public.ledger_accounts a where a.owner_player_id = any (v_players) order by a.id for update;

  for r in
    select o2.id
      from public.orders o2
      join public.security_quotes q on q.security_id = o2.security_id
      join public.securities s on s.id = o2.security_id
     where o2.type = 'limit' and o2.status in ('open', 'partially_filled')
       and s.status = 'listed' and s.is_tradable
       and ((o2.side = 'buy' and q.ask_e4 <= o2.limit_price_e4) or (o2.side = 'sell' and q.bid_e4 >= o2.limit_price_e4))
     order by o2.created_at, o2.id
  loop
    begin
      select * into o from public.orders where id = r.id for update;
      if o.status in ('open', 'partially_filled') and o.quantity_e6 > o.filled_quantity_e6 then
        perform public.execute_fill(o.id, o.quantity_e6 - o.filled_quantity_e6, o.limit_price_e4, true, false);
        v_n := v_n + 1;
      end if;
    exception when others then
      raise warning 'NEXA: resting order % not filled: % (%)', r.id, sqlerrm, sqlstate;
    end;
  end loop;
  return v_n;
end;
$$;

create or replace function public.market_tick_at(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started   timestamptz := clock_timestamp();
  rt          public.sim_runtime;
  v_seq       bigint;
  v_time      jsonb := coalesce(public.config_jsonb('time'), '{}'::jsonb);
  v_trading   jsonb := coalesce(public.config_jsonb('trading'), '{}'::jsonb);
  v_ai        jsonb := coalesce(public.config_jsonb('aiInvestors'), '{}'::jsonb);
  v_sectors   jsonb := coalesce(public.config_jsonb('sectors'), '{}'::jsonb);
  v_bonds     jsonb := coalesce(public.config_jsonb('bonds'), '{}'::jsonb);
  v_regular   boolean;
  v_bell      timestamptz;
  v_qstart    timestamptz;
  v_ystart    timestamptz;
  v_new_day   boolean;
  v_filled    integer;
  v_policy    integer;
  v_epoch     constant timestamptz := '2000-01-01 00:00:00+00';
  v_local     timestamp := p_now at time zone 'Europe/Berlin';
  v_open_h    double precision;
  v_close_h   double precision;
  -- config scalars
  c_liq       double precision;
  c_noise     double precision;
  c_spreadf   double precision;
  c_depthfrac double precision;
  c_impact    double precision;
  c_exp       double precision;
  c_imm       double precision;
  c_hedge     double precision;
  c_maxret    double precision;
  c_minprice  bigint;
  c_minhalf   bigint;
  c_widen     double precision;
  c_decay     double precision;
  c_emaf      double precision;
  c_emas      double precision;
  c_vf_cap    double precision;
  c_vf_gap    double precision;
  c_vf_dead   double precision;
  c_mo_cap    double precision;
  c_mo_ts     double precision;
  c_rh_cap    double precision;
  c_rh_chase  double precision;
  c_rh_ts     double precision;
  c_mm_speed  double precision;
  c_basevol   double precision;
  c_nscale    double precision;
  c_qpy       double precision;
  c_qsec      double precision;
  -- per security
  r           record;
  v_price     double precision;
  v_depth     double precision;
  v_sent      double precision;
  v_flow      double precision;
  v_mm        double precision;
  v_ef        double precision;
  v_es        double precision;
  v_gap       double precision;
  v_trend     double precision;
  v_pv        double precision;
  v_pm        double precision;
  v_pr        double precision;
  v_pmm       double precision;
  v_ret       double precision;
  v_sigma     double precision;
  v_exact     double precision;
  v_new       bigint;
  v_half_bps  double precision;
  v_half      bigint;
  v_bid       bigint;
  v_ask       bigint;
  v_vol       bigint;
  v_dev       double precision;
  v_periods   double precision;
  v_years     double precision;
  v_yield     double precision;
  v_yield_out integer;
  v_mcap      bigint;
  v_imp_flow  double precision;
  -- bulk arrays
  a_id   uuid[] := '{}';
  a_p    bigint[] := '{}';
  a_b    bigint[] := '{}';
  a_a    bigint[] := '{}';
  a_v    bigint[] := '{}';
  a_s    double precision[] := '{}';
  a_ef   double precision[] := '{}';
  a_es   double precision[] := '{}';
  a_mm   double precision[] := '{}';
  a_dev  double precision[] := '{}';
  a_flow bigint[] := '{}';
  a_y    integer[] := '{}';
  a_mc   bigint[] := '{}';
  -- index
  ix     record;
  v_cap  numeric;
  v_ixv  bigint;
  v_n    integer := 0;
begin
  if not pg_try_advisory_xact_lock(7311001) then
    return jsonb_build_object('skipped', 'busy');
  end if;
  select * into rt from public.sim_runtime where id;
  if rt.is_paused then
    return jsonb_build_object('skipped', 'paused', 'tick_seq', rt.tick_seq);
  end if;
  v_seq := rt.tick_seq + 1;

  -- session and calendar ----------------------------------------------------
  v_open_h  := public.cfg_num(v_time, '{marketOpenHour}', 8);
  v_close_h := public.cfg_num(v_time, '{marketCloseHour}', 22);
  v_regular := (extract(hour from v_local) + extract(minute from v_local) / 60.0) >= v_open_h
           and (extract(hour from v_local) + extract(minute from v_local) / 60.0) < v_close_h;
  v_bell    := public.trading_day_start(p_now);
  v_qstart  := public.quarter_bucket_start(p_now);
  v_ystart  := public.game_year_bucket_start(p_now);
  v_new_day := coalesce((rt.state ->> 'day_start')::timestamptz, '-infinity'::timestamptz) < v_bell;
  select cb.policy_rate_bps into v_policy from public.central_bank_state cb where cb.id;
  v_policy := coalesce(v_policy, public.config_double('centralBank', '{startRateBps}', 300)::integer);

  -- config ----------------------------------------------------------------------
  c_liq       := case when v_regular then 1 else public.cfg_num(v_time, '{afterHours,liquidityMultiplier}', 0.25) end;
  c_noise     := case when v_regular then 1 else public.cfg_num(v_time, '{afterHours,volatilityMultiplier}', 0.5) end;
  c_spreadf   := case when v_regular then 1 else public.cfg_num(v_time, '{afterHours,spreadMultiplier}', 3) end;
  c_depthfrac := public.cfg_num(v_trading, '{priceImpact,depthFreeFloatFraction}', 0.002);
  c_impact    := public.cfg_num(v_trading, '{priceImpact,impactBpsPerDepth}', 100) / 10000.0;
  c_exp       := public.cfg_num(v_trading, '{priceImpact,exponent}', 1);
  c_imm       := public.cfg_num(v_trading, '{priceImpact,immediateShare}', 0.5);
  c_hedge     := public.cfg_num(v_trading, '{priceImpact,marketMakerHedgeShare}', 0.5);
  c_maxret    := public.cfg_num(v_trading, '{maxTickReturnBps}', 300) / 10000.0;
  c_minprice  := greatest(1, public.cfg_num(v_trading, '{minPriceE4}', 1))::bigint;
  c_minhalf   := greatest(1, public.cfg_num(v_trading, '{spread,minHalfSpreadE4}', 1))::bigint;
  c_widen     := public.cfg_num(v_trading, '{spread,sentimentWideningBps}', 20);
  c_decay     := public.cfg_num(v_ai, '{sentimentDecayPerTick}', 0.0019);
  c_emaf      := public.cfg_num(v_ai, '{emaFastAlpha}', 0.15);
  c_emas      := public.cfg_num(v_ai, '{emaSlowAlpha}', 0.0165);
  c_vf_cap    := public.cfg_num(v_ai, '{archetypes,value_fund,capitalShare}', 0.3)
               * public.cfg_num(v_ai, '{archetypes,value_fund,reactionSpeed}', 0.000167) * c_liq;
  c_vf_gap    := public.cfg_num(v_ai, '{archetypes,value_fund,params,gapScale}', 0.5);
  c_vf_dead   := public.cfg_num(v_ai, '{archetypes,value_fund,params,deadBand}', 0.01);
  c_mo_cap    := public.cfg_num(v_ai, '{archetypes,momentum_trader,capitalShare}', 0.1)
               * public.cfg_num(v_ai, '{archetypes,momentum_trader,reactionSpeed}', 0.0002) * c_liq;
  c_mo_ts     := public.cfg_num(v_ai, '{archetypes,momentum_trader,params,trendScale}', 0.02);
  c_rh_cap    := public.cfg_num(v_ai, '{archetypes,retail_herd,capitalShare}', 0.1)
               * public.cfg_num(v_ai, '{archetypes,retail_herd,reactionSpeed}', 0.0012) * c_liq;
  c_rh_chase  := public.cfg_num(v_ai, '{archetypes,retail_herd,params,chaseGain}', 0.1);
  c_rh_ts     := public.cfg_num(v_ai, '{archetypes,retail_herd,params,trendScale}', 0.02);
  c_mm_speed  := public.cfg_num(v_ai, '{archetypes,market_maker,reactionSpeed}', 0.005) * c_liq;
  c_basevol   := public.cfg_num(v_ai, '{baselineVolumeDepthFraction}', 0.02);
  -- Scale on tickNoiseBps for stocks. The TS values give daily ranges of about
  -- 10 % (blue chips) to 90 % (penny stocks); 0.2 brings them to the M1 target
  -- (1-4 %, 3-8 %, 10-30 %). Fallback until balance.ts has aiInvestors.tickNoiseScale.
  c_nscale    := public.cfg_num(v_ai, '{tickNoiseScale}', 0.2);
  c_qpy       := greatest(1, public.cfg_num(v_bonds, '{couponsPerGameYear}', 4));
  c_qsec      := public.cfg_num(v_time, '{quarterHours}', 6) * 3600;

  -- 1. resting limit orders against the quote players currently see ----------
  v_filled := public.fill_resting_orders();

  -- 2./3. stocks and bonds ---------------------------------------------------------
  for r in
    select s.id, s.kind, s.sector_key, c.tier::text as tier, c.shares_outstanding,
           q.last_price_e4,
           st.fair_value_e4, st.sentiment, st.ema_fast, st.ema_slow, st.maker_inventory,
           st.pending_player_flow_e6, st.price_deviation, st.volatility, st.liquidity_shares, st.spread_bps,
           b.coupon_bps, b.matures_at, b.face_value_cents
      from public.securities s
      join public.security_quotes q on q.security_id = s.id
      join public.security_sim_state st on st.security_id = s.id
      left join public.companies c on c.id = s.company_id
      left join public.bonds b on b.security_id = s.id
     where s.status = 'listed' and s.kind in ('stock', 'bond')
  loop
    v_price := r.last_price_e4;
    v_flow  := r.pending_player_flow_e6 / 1000000.0;
    v_sent  := greatest(-1, least(1, coalesce(r.sentiment, 0) * (1 - c_decay)));
    v_ef    := coalesce(r.ema_fast, v_price);
    v_es    := coalesce(r.ema_slow, v_price);
    v_mm    := coalesce(r.maker_inventory, 0) - v_flow;
    v_dev   := coalesce(r.price_deviation, 0);
    v_yield_out := null;
    v_mcap  := null;

    if r.kind = 'stock' and r.shares_outstanding is not null then
      v_depth := greatest(1, r.shares_outstanding * c_depthfrac * c_liq);
      -- value fund: anchor to the fair value outside the dead band
      v_gap := ln(r.fair_value_e4 / v_price);
      if abs(v_gap) <= c_vf_dead then
        v_pv := 0;
      else
        v_pv := r.shares_outstanding * c_vf_cap
              * greatest(-1, least(1, (v_gap - sign(v_gap) * c_vf_dead) / c_vf_gap));
      end if;
      v_trend := case when v_es > 0 then v_ef / v_es - 1 else 0 end;
      v_pm  := r.shares_outstanding * c_mo_cap * tanh(v_trend / c_mo_ts);
      v_pr  := r.shares_outstanding * c_rh_cap * greatest(-1, least(1, v_sent + c_rh_chase * tanh(v_trend / c_rh_ts)));
      v_pmm := -v_mm * c_mm_speed * c_hedge;
      v_ret := sign(v_pv + v_pm + v_pr + v_pmm) * c_impact * power(abs(v_pv + v_pm + v_pr + v_pmm) / v_depth, c_exp)
             + c_imm * sign(v_flow) * c_impact * power(abs(v_flow) / v_depth, c_exp);
      v_sigma := public.cfg_num(v_ai, array['tickNoiseBps', coalesce(r.tier, 'midcap')], 15) / 10000.0
               * public.cfg_num(v_sectors, array[coalesce(r.sector_key, ''), 'volatilityMultiplier'], 1)
               * c_noise * c_nscale;
      v_ret := greatest(-c_maxret, least(c_maxret, v_ret + v_sigma * public.gauss_random()));
      v_exact := v_price * exp(v_ret);
      v_new := floor(v_exact)::bigint + case when random() < v_exact - floor(v_exact) then 1 else 0 end;
      v_new := greatest(c_minprice, v_new);
      v_mm  := v_mm * (1 - c_mm_speed);
      v_half_bps := (public.cfg_num(v_trading, array['spread', 'halfSpreadBps', coalesce(r.tier, 'midcap')], 15)
                     + c_widen * least(1, abs(v_sent))) * c_spreadf;
      v_vol := round((abs(v_pv) + abs(v_pm) + abs(v_pr) + abs(v_pmm) + v_depth * c_basevol * (0.5 + random())) * 1000000)::bigint;
      v_mcap := public.div_round_half_even(r.shares_outstanding::numeric * v_new, 100);
    elsif r.kind = 'bond' and r.matures_at is not null then
      v_depth   := greatest(1, coalesce(r.liquidity_shares, 100000) * c_liq);
      v_periods := extract(epoch from (r.matures_at - p_now)) / c_qsec;
      v_years   := greatest(v_periods / c_qpy, 0);
      v_yield   := public.bond_yield_bps(v_policy, v_years, v_bonds);
      v_imp_flow := c_imm * sign(v_flow) * c_impact * power(abs(v_flow) / v_depth, c_exp);
      v_dev := v_dev * (1 - c_decay) + coalesce(r.volatility, 0) * c_noise * public.gauss_random() + v_imp_flow;
      if v_periods > 0 then
        v_new := greatest(c_minprice, round(public.bond_clean_price(r.coupon_bps, v_yield, v_periods, c_qpy)
                                            * exp(v_dev) * r.face_value_cents * 100)::bigint);
        v_yield_out := round(v_yield - v_dev * 10000 / greatest(v_years, 0.25))::integer;
      else
        v_new := r.face_value_cents * 100;
        v_yield_out := 0;
      end if;
      v_half_bps := coalesce(r.spread_bps, 10) / 2.0 * c_spreadf;
      v_vol := round(v_depth * c_basevol * (0.5 + random()) * 1000000)::bigint;
    else
      continue;
    end if;

    v_ef := v_ef + c_emaf * (v_new - v_ef);
    v_es := v_es + c_emas * (v_new - v_es);
    v_half := greatest(c_minhalf, round(v_new * v_half_bps / 10000.0)::bigint);
    v_bid := greatest(c_minprice, v_new - v_half);
    v_ask := v_new + v_half;
    if v_ask <= v_bid then
      v_ask := v_bid + 1;
    end if;

    a_id := a_id || r.id;      a_p := a_p || v_new;        a_b := a_b || v_bid;     a_a := a_a || v_ask;
    a_v := a_v || v_vol;       a_s := a_s || v_sent;       a_ef := a_ef || v_ef;    a_es := a_es || v_es;
    a_mm := a_mm || v_mm;      a_dev := a_dev || v_dev;    a_flow := a_flow || r.pending_player_flow_e6;
    a_y := a_y || v_yield_out; a_mc := a_mc || v_mcap;
    v_n := v_n + 1;
  end loop;

  update public.security_sim_state st
     set sentiment = u.s, ema_fast = u.ef, ema_slow = u.es, maker_inventory = u.mm,
         price_deviation = u.dev, pending_player_flow_e6 = st.pending_player_flow_e6 - u.flow
    from unnest(a_id, a_s, a_ef, a_es, a_mm, a_dev, a_flow) as u(id, s, ef, es, mm, dev, flow)
   where st.security_id = u.id;

  update public.security_quotes q
     set last_price_e4 = u.p,
         bid_e4 = u.b,
         ask_e4 = u.a,
         prev_close_e4 = case when v_new_day then q.last_price_e4 else coalesce(q.prev_close_e4, q.last_price_e4) end,
         day_open_e4 = case when v_new_day then u.p else coalesce(q.day_open_e4, u.p) end,
         day_high_e4 = case when v_new_day then u.p else greatest(coalesce(q.day_high_e4, u.p), u.p) end,
         day_low_e4 = case when v_new_day then u.p else least(coalesce(q.day_low_e4, u.p), u.p) end,
         day_volume_e6 = case when v_new_day then u.v else q.day_volume_e6 + u.v end,
         day_turnover_cents = case when v_new_day then 0 else q.day_turnover_cents end,
         change_bps = greatest(-1000000, least(1000000, round(
                        (u.p - case when v_new_day then q.last_price_e4 else coalesce(q.prev_close_e4, q.last_price_e4) end) * 10000.0
                        / greatest(1, case when v_new_day then q.last_price_e4 else coalesce(q.prev_close_e4, q.last_price_e4) end))))::integer,
         market_cap_cents = coalesce(u.mc, q.market_cap_cents),
         yield_bps = coalesce(u.y, q.yield_bps),
         tick_seq = v_seq,
         updated_at = p_now
    from unnest(a_id, a_p, a_b, a_a, a_v, a_y, a_mc) as u(id, p, b, a, v, y, mc)
   where q.security_id = u.id;

  -- 4. indices ---------------------------------------------------------------------
  for ix in
    select i.security_id, i.divisor
      from public.indices i join public.securities s on s.id = i.security_id
     where s.status = 'listed'
  loop
    select sum(c.shares_outstanding::numeric * q.last_price_e4) / 100
      into v_cap
      from public.index_memberships m
      join public.securities s on s.id = m.member_security_id
      join public.companies c on c.id = s.company_id
      join public.security_quotes q on q.security_id = s.id
     where m.index_security_id = ix.security_id and m.left_at is null;
    if v_cap is null or ix.divisor <= 0 then
      continue;
    end if;
    v_ixv := greatest(1, round(v_cap / ix.divisor::numeric))::bigint;
    update public.security_quotes q
       set last_price_e4 = v_ixv,
           prev_close_e4 = case when v_new_day then q.last_price_e4 else coalesce(q.prev_close_e4, q.last_price_e4) end,
           day_open_e4 = case when v_new_day then v_ixv else coalesce(q.day_open_e4, v_ixv) end,
           day_high_e4 = case when v_new_day then v_ixv else greatest(coalesce(q.day_high_e4, v_ixv), v_ixv) end,
           day_low_e4 = case when v_new_day then v_ixv else least(coalesce(q.day_low_e4, v_ixv), v_ixv) end,
           change_bps = round((v_ixv - case when v_new_day then q.last_price_e4 else coalesce(q.prev_close_e4, q.last_price_e4) end) * 10000.0
                        / greatest(1, case when v_new_day then q.last_price_e4 else coalesce(q.prev_close_e4, q.last_price_e4) end))::integer,
           market_cap_cents = round(v_cap)::bigint,
           tick_seq = v_seq,
           updated_at = p_now
     where q.security_id = ix.security_id;
    a_id := a_id || ix.security_id;
    a_p  := a_p || v_ixv;
    a_v  := a_v || 0::bigint;
  end loop;

  -- 5. ticks and candles --------------------------------------------------------------
  insert into public.price_ticks (security_id, ts, tick_seq, price_e4, volume_e6)
  select u.id, p_now, v_seq, u.p, u.v from unnest(a_id, a_p, a_v) as u(id, p, v)
  on conflict do nothing;

  insert into public.candles as c (security_id, interval, bucket_start, open_e4, high_e4, low_e4, close_e4, volume_e6, tick_count)
  select u.id, iv.i, iv.b, u.p, u.p, u.p, u.p, u.v, 1
    from unnest(a_id, a_p, a_v) as u(id, p, v)
   cross join (values
     ('1m'::public.candle_interval, date_bin('1 minute', p_now, v_epoch)),
     ('5m'::public.candle_interval, date_bin('5 minutes', p_now, v_epoch)),
     ('1h'::public.candle_interval, date_bin('1 hour', p_now, v_epoch)),
     ('1q'::public.candle_interval, v_qstart),
     ('1y'::public.candle_interval, v_ystart)) as iv(i, b)
  on conflict (security_id, interval, bucket_start) do update
     set high_e4 = greatest(c.high_e4, excluded.high_e4),
         low_e4 = least(c.low_e4, excluded.low_e4),
         close_e4 = excluded.close_e4,
         volume_e6 = c.volume_e6 + excluded.volume_e6,
         tick_count = c.tick_count + 1;

  -- runtime, public market status, tick log
  update public.sim_runtime
     set tick_seq = v_seq, last_tick_at = p_now,
         state = case when v_new_day then state || jsonb_build_object('day_start', v_bell) else state end
   where id;
  update public.market_status
     set phase = case when v_regular then 'open'::public.market_phase else 'after_hours'::public.market_phase end,
         phase_changed_at = case when phase is distinct from (case when v_regular then 'open'::public.market_phase
                                                                   else 'after_hours'::public.market_phase end)
                                 then p_now else phase_changed_at end,
         next_open_at = case when v_local < v_local::date + make_interval(secs => v_open_h * 3600)
                             then (v_local::date + make_interval(secs => v_open_h * 3600)) at time zone 'Europe/Berlin'
                             else (v_local::date + 1 + make_interval(secs => v_open_h * 3600)) at time zone 'Europe/Berlin' end,
         next_close_at = case when v_local < v_local::date + make_interval(secs => v_close_h * 3600)
                              then (v_local::date + make_interval(secs => v_close_h * 3600)) at time zone 'Europe/Berlin'
                              else (v_local::date + 1 + make_interval(secs => v_close_h * 3600)) at time zone 'Europe/Berlin' end,
         tick_seq = v_seq, last_tick_at = p_now, is_halted = false, halt_reason = null
   where id;
  insert into public.sim_tick_log (tick_seq, started_at, duration_ms, securities_updated, orders_filled)
  values (v_seq, v_started, round(extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer, v_n, v_filled)
  on conflict (tick_seq) do nothing;

  return jsonb_build_object(
    'tick_seq', v_seq, 'session', case when v_regular then 'regular' else 'after_hours' end,
    'securities', v_n, 'orders_filled', v_filled, 'new_day', v_new_day,
    'duration_ms', round(extract(epoch from (clock_timestamp() - v_started)) * 1000, 2));
end;
$$;
comment on function public.market_tick_at(timestamptz) is 'Internal: one market tick at the given (simulated) time. Port of stepMarketTick() (src/lib/sim/tick.ts).';

create or replace function public.backfill_price_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now          timestamptz := public.game_now();
  v_epoch        constant timestamptz := '2000-01-01 00:00:00+00';
  v_m1_end       timestamptz := date_bin('1 minute', public.game_now(), '2000-01-01 00:00:00+00'::timestamptz);
  v_fine_start   timestamptz := date_bin('5 minutes', public.game_now() - interval '6 hours', '2000-01-01 00:00:00+00'::timestamptz);
  v_today        date := public.game_day(public.game_now());
  v_coarse_start timestamptz;
  v_ai           jsonb := coalesce(public.config_jsonb('aiInvestors'), '{}'::jsonb);
  v_sectors      jsonb := coalesce(public.config_jsonb('sectors'), '{}'::jsonb);
  v_depthfrac    double precision := public.config_double('trading', '{priceImpact,depthFreeFloatFraction}', 0.002);
  v_tick_s       double precision := greatest(1, public.config_double('time', '{tickSeconds}', 5));
  v_horizon      constant double precision := 2000;   -- ticks; cosmetic, see above
  v_band_mult    constant double precision := 3;      -- band = 3 x the noise over the horizon
  v_counts       jsonb;
begin
  if exists (select 1 from public.candles limit 1) then
    return jsonb_build_object('skipped', 'candles_exist');
  end if;
  v_coarse_start := ((v_today - 30)::timestamp + interval '8 hours') at time zone 'Europe/Berlin';

  if to_regclass('pg_temp.nexa_bf') is not null then
    drop table pg_temp.nexa_bf;
  end if;
  create temporary table nexa_bf (
    security_id uuid, k integer, iv text, bucket_start timestamptz, ticks integer,
    sigma double precision, band double precision, price double precision, base_vol double precision,
    close_e4 bigint, open_e4 bigint, high_e4 bigint, low_e4 bigint, volume bigint
  ) on commit drop;

  insert into pg_temp.nexa_bf (security_id, k, iv, bucket_start, ticks, sigma, band, price, base_vol)
  with sec as (
    select s.id, q.last_price_e4::double precision as price,
           greatest(1e-6, case when s.kind = 'stock'
                then public.cfg_num(v_ai, array['tickNoiseBps', coalesce(c.tier::text, 'midcap')], 15) / 10000.0
                     * public.cfg_num(v_sectors, array[coalesce(s.sector_key, ''), 'volatilityMultiplier'], 1)
                     * public.cfg_num(v_ai, '{tickNoiseScale}', 0.2)
                else coalesce(st.volatility, 0.0001) end) as sigma_tick,
           case when s.kind = 'stock' then c.shares_outstanding * v_depthfrac else coalesce(st.liquidity_shares, 100000) end
             * public.cfg_num(v_ai, '{baselineVolumeDepthFraction}', 0.02) * 1000000 as vol_per_tick
      from public.securities s
      join public.security_quotes q on q.security_id = s.id
      left join public.security_sim_state st on st.security_id = s.id
      left join public.companies c on c.id = s.company_id
     where s.status = 'listed' and s.kind in ('stock', 'bond')
  ), steps as (
    select 'm'::text as iv, g as bucket_start, round(60 / v_tick_s)::integer as ticks
      from generate_series(v_m1_end, v_fine_start, interval '-1 minute') g
    union all
    select '5', g, round(300 / v_tick_s)::integer
      from generate_series(v_fine_start - interval '5 minutes', v_coarse_start, interval '-5 minutes') g
    union all
    select 'd', (d::date::timestamp + interval '8 hours') at time zone 'Europe/Berlin', round(86400 / v_tick_s)::integer
      from generate_series((v_today - 31)::timestamp, (v_today - 364)::timestamp, interval '-1 day') d
  )
  select sec.id, (row_number() over (partition by sec.id order by st.bucket_start desc) - 1)::integer,
         st.iv, st.bucket_start, st.ticks,
         sec.sigma_tick * sqrt(least(st.ticks, v_horizon)),
         sec.sigma_tick * sqrt(v_horizon) * v_band_mult,
         sec.price, sec.vol_per_tick * st.ticks
    from sec cross join steps st;

  -- closes: bounded walk, exactly the current price at k = 0
  update pg_temp.nexa_bf t
     set close_e4 = x.c
    from (select y.security_id, y.k,
                 greatest(1, round(y.price * exp(y.band * tanh(y.s_cum / y.band))))::bigint as c
            from (select b.security_id, b.k, b.price, b.band,
                         sum(case when b.k = 0 then 0 else b.sigma * public.gauss_random() end)
                           over (partition by b.security_id order by b.k) as s_cum
                    from pg_temp.nexa_bf b) y) x
   where t.security_id = x.security_id and t.k = x.k;

  -- open = previous close, wicks, volume
  update pg_temp.nexa_bf t
     set open_e4 = x.o,
         high_e4 = ceil(greatest(x.o, t.close_e4) * exp(abs(public.gauss_random()) * t.sigma * 0.5))::bigint,
         low_e4  = greatest(1, floor(least(x.o, t.close_e4) * exp(-abs(public.gauss_random()) * t.sigma * 0.5)))::bigint,
         volume  = round(t.base_vol * (0.5 + random()))::bigint
    from (select b.security_id, b.k, coalesce(lead(b.close_e4) over (partition by b.security_id order by b.k), b.close_e4) as o
            from pg_temp.nexa_bf b) x
   where t.security_id = x.security_id and t.k = x.k;

  -- 1m: last 6 hours
  insert into public.candles (security_id, interval, bucket_start, open_e4, high_e4, low_e4, close_e4, volume_e6, tick_count)
  select b.security_id, '1m', b.bucket_start, b.open_e4, b.high_e4, b.low_e4, b.close_e4, b.volume, b.ticks
    from pg_temp.nexa_bf b where b.iv = 'm';

  -- 5m: last 2 days, 1h: 30 days, 1q: 30 days, 1y: 365 game days
  insert into public.candles (security_id, interval, bucket_start, open_e4, high_e4, low_e4, close_e4, volume_e6, tick_count)
  select g.security_id, g.target_iv::public.candle_interval, g.bucket,
         (array_agg(g.open_e4 order by g.bucket_start))[1], max(g.high_e4), min(g.low_e4),
         (array_agg(g.close_e4 order by g.bucket_start desc))[1], sum(g.volume), sum(g.ticks)
    from (
      select b.*, '5m' as target_iv, date_bin('5 minutes', b.bucket_start, v_epoch) as bucket
        from pg_temp.nexa_bf b where b.iv in ('m', '5') and b.bucket_start >= date_bin('5 minutes', v_now - interval '2 days', v_epoch)
      union all
      select b.*, '1h', date_bin('1 hour', b.bucket_start, v_epoch) from pg_temp.nexa_bf b where b.iv in ('m', '5')
      union all
      select b.*, '1q', public.quarter_bucket_start(b.bucket_start) from pg_temp.nexa_bf b where b.iv in ('m', '5')
      union all
      select b.*, '1y', public.game_year_bucket_start(b.bucket_start) from pg_temp.nexa_bf b
    ) g
   group by g.security_id, g.target_iv, g.bucket;

  -- indices: aggregated from the members' candles (same buckets)
  insert into public.candles (security_id, interval, bucket_start, open_e4, high_e4, low_e4, close_e4, volume_e6, tick_count)
  select i.security_id, c.interval, c.bucket_start,
         round(sum(co.shares_outstanding::numeric * c.open_e4) / 100 / i.divisor::numeric)::bigint,
         round(sum(co.shares_outstanding::numeric * c.high_e4) / 100 / i.divisor::numeric)::bigint,
         round(sum(co.shares_outstanding::numeric * c.low_e4) / 100 / i.divisor::numeric)::bigint,
         round(sum(co.shares_outstanding::numeric * c.close_e4) / 100 / i.divisor::numeric)::bigint,
         0, max(c.tick_count)
    from public.indices i
    join public.index_memberships m on m.index_security_id = i.security_id and m.left_at is null
    join public.securities s on s.id = m.member_security_id
    join public.companies co on co.id = s.company_id
    join public.candles c on c.security_id = s.id
   group by i.security_id, i.divisor, c.interval, c.bucket_start
  having count(*) = (select count(*) from public.index_memberships m2 where m2.index_security_id = i.security_id and m2.left_at is null);

  select jsonb_object_agg(x.interval, x.n) into v_counts
    from (select c.interval::text as interval, count(*) as n from public.candles c group by c.interval) x;
  drop table pg_temp.nexa_bf;
  return jsonb_build_object('backfilled', true, 'candles', v_counts);
end;
$$;

create or replace function public.redeem_matured_bonds(p_until timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b        record;
  o        record;
  p        record;
  v_order  uuid;
  v_n      integer := 0;
begin
  perform public.lock_bond_participants();
  for b in
    select bd.security_id, bd.face_value_cents, s.ticker, s.name
      from public.bonds bd join public.securities s on s.id = bd.security_id
     where s.status = 'listed' and bd.matures_at <= p_until
     order by bd.matures_at
  loop
    for o in
      select x.id from public.orders x
       where x.security_id = b.security_id and x.status in ('pending', 'open', 'partially_filled')
    loop
      perform public.cancel_order_internal(o.id);
    end loop;
    for p in
      select x.id, x.player_id, x.quantity_e6 from public.positions x
       where x.security_id = b.security_id and x.status = 'open' and x.quantity_e6 > 0
    loop
      insert into public.orders (player_id, security_id, request_id, source, side, type, quantity_e6, status)
      values (p.player_id, b.security_id, md5('nexa:redeem:' || p.id::text)::uuid, 'system', 'sell', 'market', p.quantity_e6, 'pending')
      on conflict (player_id, request_id) do nothing
      returning id into v_order;
      continue when v_order is null;
      perform public.execute_fill(v_order, p.quantity_e6, b.face_value_cents * 100, false, true);
    end loop;
    update public.securities set status = 'matured', is_tradable = false, delisted_at = now() where id = b.security_id;
    insert into public.news_items (category, headline, body, importance, security_id, template_key, published_at)
    select 'market', replace(t.headline_template, '{name}', b.name), t.body_template, 1, b.security_id, t.key, now()
      from public.news_templates t where t.key = 'bond_matured';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.get_candles(p_ticker text, p_interval text, p_limit integer default 300)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 1000);
  v_out   jsonb;
begin
  perform public.require_player();
  v_id := public.resolve_security(p_ticker);
  if v_id is null then
    perform public.api_error('unknown_security');
  end if;
  if p_interval is null or p_interval not in ('1m', '5m', '1h', '1q', '1y') then
    perform public.api_error('invalid_interval');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           't', extract(epoch from x.bucket_start)::bigint, 'o', x.open_e4, 'h', x.high_e4,
           'l', x.low_e4, 'c', x.close_e4, 'v', x.volume_e6) order by x.bucket_start), '[]'::jsonb)
    into v_out
    from (select c.* from public.candles c
           where c.security_id = v_id and c.interval = p_interval::public.candle_interval
           order by c.bucket_start desc limit v_limit) x;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read RPCs with quantities in millionths
-- ---------------------------------------------------------------------------
create or replace function public.get_order_book(p_ticker text, p_levels integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_kind    public.security_kind;
  v_trading jsonb := coalesce(public.config_jsonb('trading'), '{}'::jsonb);
  v_levels  integer := least(greatest(coalesce(p_levels, 8), 1), 20);
  v_step    double precision;
  v_base    double precision;
  v_jitter  double precision;
  v_bid     bigint;
  v_ask     bigint;
  v_seq     bigint;
  v_bids    jsonb;
  v_asks    jsonb;
begin
  perform public.require_player();
  v_id := public.resolve_security(p_ticker);
  if v_id is null then
    perform public.api_error('unknown_security');
  end if;
  select s.kind into v_kind from public.securities s where s.id = v_id;
  select q.bid_e4, q.ask_e4, q.tick_seq into v_bid, v_ask, v_seq from public.security_quotes q where q.security_id = v_id;
  if v_kind not in ('stock', 'bond') or v_bid is null or v_ask is null then
    return jsonb_build_object('bids', '[]'::jsonb, 'asks', '[]'::jsonb);
  end if;
  v_step   := public.cfg_num(v_trading, '{orderBook,levelStepBps}', 10);
  v_jitter := public.cfg_num(v_trading, '{orderBook,sizeJitter}', 0.2);
  -- whole shares per level
  v_base   := public.security_depth(v_id, public.market_session_at(public.game_now()) = 'regular')
            * v_step / public.cfg_num(v_trading, '{priceImpact,impactBpsPerDepth}', 100);

  with mm as (
    select 'bid'::text as side,
           least(floor(v_bid * (1 - i * v_step / 10000.0))::bigint, v_bid - i) as price_e4,
           greatest(1, floor(v_base * (1 + v_jitter * (2 * ((abs(hashtext(v_id::text || 'b' || i || ':' || v_seq)) % 10000) / 10000.0) - 1))))::bigint * 1000000 as qty
      from generate_series(0, v_levels - 1) i
    union all
    select 'ask',
           greatest(ceil(v_ask * (1 + i * v_step / 10000.0))::bigint, v_ask + i),
           greatest(1, floor(v_base * (1 + v_jitter * (2 * ((abs(hashtext(v_id::text || 'a' || i || ':' || v_seq)) % 10000) / 10000.0) - 1))))::bigint * 1000000
      from generate_series(0, v_levels - 1) i
  ), players as (
    select case when o.side = 'buy' then 'bid' else 'ask' end as side, o.limit_price_e4 as price_e4,
           sum(o.quantity_e6 - o.filled_quantity_e6)::bigint as qty, count(*)::integer as n
      from public.orders o
     where o.security_id = v_id and o.type = 'limit' and o.status in ('open', 'partially_filled')
     group by 1, 2
  ), merged as (
    select coalesce(m.side, p.side) as side, coalesce(m.price_e4, p.price_e4) as price_e4,
           coalesce(m.qty, 0) + coalesce(p.qty, 0) as quantity_e6, coalesce(p.n, 0) as players
      from (select * from mm where price_e4 >= 1) m
      full join players p on p.side = m.side and p.price_e4 = m.price_e4
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('price_e4', x.price_e4, 'quantity_e6', x.quantity_e6, 'players', x.players) order by x.price_e4 desc)
                from (select * from merged where side = 'bid' order by price_e4 desc limit v_levels) x), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('price_e4', x.price_e4, 'quantity_e6', x.quantity_e6, 'players', x.players) order by x.price_e4)
                from (select * from merged where side = 'ask' order by price_e4 limit v_levels) x), '[]'::jsonb)
    into v_bids, v_asks;

  return jsonb_build_object('bids', v_bids, 'asks', v_asks);
end;
$$;

create or replace function public.get_market_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := public.game_now();
  v_index   jsonb;
  v_secs    jsonb;
begin
  perform public.require_player();

  select jsonb_build_object(
           'ticker', upper(i.key), 'name', s.name, 'value_e4', q.last_price_e4,
           'prev_close_e4', coalesce(q.prev_close_e4, q.last_price_e4), 'change_bps', q.change_bps,
           'day_high_e4', q.day_high_e4, 'day_low_e4', q.day_low_e4)
    into v_index
    from public.indices i
    join public.securities s on s.id = i.security_id
    join public.security_quotes q on q.security_id = s.id
   order by i.created_at
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'ticker', s.ticker, 'name', s.name, 'kind', s.kind,
           'sector_key', s.sector_key, 'size_class', c.tier,
           'last_price_e4', q.last_price_e4, 'bid_e4', q.bid_e4, 'ask_e4', q.ask_e4,
           'prev_close_e4', coalesce(q.prev_close_e4, q.last_price_e4), 'change_bps', q.change_bps,
           'day_high_e4', coalesce(q.day_high_e4, q.last_price_e4), 'day_low_e4', coalesce(q.day_low_e4, q.last_price_e4),
           'day_volume_e6', q.day_volume_e6, 'market_cap_cents', case when s.kind = 'stock' then q.market_cap_cents end,
           'term_game_years', b.term_game_years, 'coupon_bps', b.coupon_bps,
           'yield_bps', case when s.kind = 'bond' then q.yield_bps end,
           'matures_at', b.matures_at, 'face_value_cents', b.face_value_cents,
           'company_id', s.company_id, 'brand_color', c.brand_color)
         order by case s.kind when 'stock' then 0 else 1 end, sec.sort_order, b.term_game_years, s.ticker), '[]'::jsonb)
    into v_secs
    from public.securities s
    join public.security_quotes q on q.security_id = s.id
    left join public.companies c on c.id = s.company_id
    left join public.sectors sec on sec.key = s.sector_key
    left join public.bonds b on b.security_id = s.id
   where s.status = 'listed' and s.kind in ('stock', 'bond');

  return jsonb_build_object(
    'server_time',     v_now,
    'tick_seq',        (select r.tick_seq from public.sim_runtime r where r.id),
    'last_tick_at',    (select r.last_tick_at from public.sim_runtime r where r.id),
    'session',         public.market_session_at(v_now),
    'paused',          coalesce((select r.is_paused from public.sim_runtime r where r.id), false),
    'policy_rate_bps', (select cb.policy_rate_bps from public.central_bank_state cb where cb.id),
    'day_start',       public.trading_day_start(v_now),
    'index',           v_index,
    'securities',      v_secs,
    'economy',         jsonb_build_object(
                         'money_supply_cents',      public.money_supply_cents(),
                         'treasury_cents',          public.treasury_balance_cents(),
                         'basic_income_factor_bps', public.basic_income_factor_bps(),
                         'total_supply_cents',      public.config_bigint('money', '{totalSupplyCents}', 1000000000000)));
end;
$$;

-- Net worth of a player: cash + reserve + positions at the bid (+ company equity from M4: hook below).
create or replace function public.player_net_worth_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(a.balance_cents) from public.ledger_accounts a where a.owner_player_id = p_player), 0)::bigint
       + coalesce((select sum(public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))
                     from public.positions p join public.security_quotes q on q.security_id = p.security_id
                    where p.player_id = p_player and p.status = 'open' and p.quantity_e6 > 0), 0)::bigint
       -- M4 hook: + company equity (listed at market, private at last round) - debts
       ;
$$;

create or replace function public.get_my_portfolio()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player    uuid;
  v_cash      bigint;
  v_reserved  bigint;
  v_positions jsonb;
  v_value     bigint;
  v_bid_value bigint;
  v_orders    jsonb;
  v_trades    jsonb;
  v_prof      public.profiles;
  v_priv      public.player_private;
  v_level     jsonb;
  v_days      double precision := public.config_double('names', '{nicknameChangeDays}', 60);
  v_today     date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_streak    integer;
  ls          public.login_streaks;
begin
  v_player := public.require_player();
  select coalesce(sum(a.balance_cents) filter (where a.kind = 'player_cash'), 0),
         coalesce(sum(a.balance_cents) filter (where a.kind = 'player_reserve'), 0)
    into v_cash, v_reserved
    from public.ledger_accounts a where a.owner_player_id = v_player;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ticker', x.ticker, 'name', x.name, 'kind', x.kind, 'quantity_e6', x.quantity_e6,
           'reserved_quantity_e6', x.reserved_quantity_e6, 'avg_price_e4', x.avg_entry_price_e4,
           'last_price_e4', x.last_price_e4, 'market_value_cents', x.mv, 'cost_basis_cents', x.cost_basis_cents,
           'unrealized_pnl_cents', x.mv - x.cost_basis_cents, 'realized_pnl_cents', x.realized_pnl_cents,
           'change_bps', x.change_bps, 'opened_at', x.opened_at)
           order by x.mv desc), '[]'::jsonb),
         coalesce(sum(x.mv), 0)::bigint,
         coalesce(sum(x.bv), 0)::bigint
    into v_positions, v_value, v_bid_value
    from (select s.ticker, s.name, s.kind, p.quantity_e6, p.reserved_quantity_e6, p.avg_entry_price_e4, p.cost_basis_cents,
                 p.realized_pnl_cents, p.opened_at, q.last_price_e4, q.change_bps,
                 public.value_cents(p.quantity_e6, q.last_price_e4) as mv,
                 public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)) as bv
            from public.positions p
            join public.securities s on s.id = p.security_id
            join public.security_quotes q on q.security_id = p.security_id
           where p.player_id = v_player and p.status = 'open' and p.quantity_e6 > 0) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'ticker', s.ticker, 'side', o.side, 'type', o.type, 'quantity_e6', o.quantity_e6,
           'filled_quantity_e6', o.filled_quantity_e6, 'limit_price_e4', o.limit_price_e4, 'status', o.status,
           'reserved_cents', o.reserved_cents, 'created_at', o.created_at)
           order by o.created_at desc), '[]'::jsonb)
    into v_orders
    from public.orders o join public.securities s on s.id = o.security_id
   where o.player_id = v_player and o.status in ('open', 'partially_filled');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'ticker', t.ticker, 'side', t.side, 'quantity_e6', t.quantity_e6, 'price_e4', t.price_e4,
           'gross_cents', t.gross_cents, 'fee_cents', t.fee_cents, 'tax_cents', t.tax_cents,
           'realized_pnl_cents', t.realized_pnl_cents, 'xp_awarded', t.xp_awarded, 'executed_at', t.executed_at)
           order by t.executed_at desc), '[]'::jsonb)
    into v_trades
    from (select tr.*, s.ticker from public.trades tr join public.securities s on s.id = tr.security_id
           where tr.player_id = v_player order by tr.executed_at desc limit 50) t;

  select * into v_prof from public.profiles where id = v_player;
  select * into v_priv from public.player_private where player_id = v_player;
  select * into ls from public.login_streaks where player_id = v_player;
  v_level := public.level_progress(v_prof.xp_total);
  v_streak := case when ls.last_login_day >= v_today - 1 then ls.current_streak
                   when ls.last_login_day = v_today - 2 and ls.freeze_tokens > 0 then ls.current_streak
                   else 0 end;

  return jsonb_build_object(
    'cash_cents',            v_cash,
    'reserved_cents',        v_reserved,
    'positions_value_cents', v_value,
    'total_cents',           v_cash + v_reserved + v_value,
    'net_worth_cents',       v_cash + v_reserved + v_bid_value,
    'loss_pot_cents',        coalesce(v_priv.tax_loss_pot_cents, 0),
    'vault',                 public.vault_status(v_player) - 'accrued_seconds' - 'base_rate_cents_per_hour',
    'positions',             v_positions,
    'open_orders',           v_orders,
    'recent_trades',         v_trades,
    'level',                 v_prof.level,
    'xp_total',              v_prof.xp_total,
    'xp_into_level',         (v_level ->> 'xp_into_level')::bigint,
    'xp_for_next',           (v_level ->> 'xp_for_next')::bigint,
    'tutorial_completed',    v_priv.tutorial_completed_at is not null,
    'nickname',              v_prof.nickname,
    'nickname_change_available_at',
                             case when v_prof.nickname_changed_at is null
                                    or v_prof.nickname_changed_at + make_interval(secs => v_days * 86400) <= now() then null
                                  else v_prof.nickname_changed_at + make_interval(secs => v_days * 86400) end,
    'missions_claimable',    (select count(*) from public.player_missions m
                               where m.player_id = v_player and m.status = 'completed'
                                 and (m.expires_at is null or m.expires_at > public.game_now()))::integer,
    'streak_days',           coalesce(v_streak, 0),
    'server_time',           public.game_now());
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
    'public.value_cents(bigint, bigint)', 'public.execute_fill(uuid, bigint, bigint, boolean, boolean)',
    'public.cancel_order_internal(uuid)', 'public.place_order(uuid, text, text, text, bigint, bigint, bigint)',
    'public.vault_status(uuid)', 'public.claim_vault(uuid)', 'public.complete_tutorial(uuid)',
    'public.pay_bond_coupons(bigint)', 'public.fill_resting_orders()', 'public.market_tick_at(timestamptz)',
    'public.backfill_price_history()', 'public.redeem_matured_bonds(timestamptz)',
    'public.get_candles(text, text, integer)', 'public.get_order_book(text, integer)', 'public.get_market_snapshot()',
    'public.player_net_worth_cents(uuid)', 'public.get_my_portfolio()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.place_order(uuid, text, text, text, bigint, bigint, bigint) to authenticated;
  grant execute on function public.claim_vault(uuid) to authenticated;
  grant execute on function public.complete_tutorial(uuid) to authenticated;
  grant execute on function public.get_candles(text, text, integer) to authenticated;
  grant execute on function public.get_order_book(text, integer) to authenticated;
  grant execute on function public.get_market_snapshot() to authenticated;
  grant execute on function public.get_my_portfolio() to authenticated;
end;
$$;
