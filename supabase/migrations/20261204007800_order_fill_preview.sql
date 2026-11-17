-- =============================================================================
-- NEXA · 7800 · The preview is the fill: one plan for quote and execution, capped impact (ADR-189)
-- =============================================================================
-- Bug: "I sold for over 100k and got 50k." The order sheet showed quantity x bid (96.000 EUR), the server filled
-- along the player-impact price path (ADR-126): 1 % per 1.000 EUR for a penny stock, so 96.000 EUR moved the price
-- by 96 % and the average fill was 52 % of the bid (58.877,58 shares at 0,8489 EUR = 49.981 EUR). Nothing capped it.
-- Fix:
-- 1. market_order_plan(): the one fill plan (src/lib/sim/order-fill.ts). The last share of a market order moves the
--    price at most trading.priceImpact.maxImpactBpsPerOrder (15 %) and, for player stocks, stays inside the daily
--    band (ADR-170). Amounts are solved along the price path. Whatever is beyond is not executed and reported.
-- 2. quote_order(): read-only preview with exactly this plan plus fee and the capital gains tax (FIFO lots, loss pot).
-- 3. place_order(): market orders fill exactly the plan (limited_by, unfilled_quantity_e6, impact_bps in the result);
--    nothing fills -> order_impact_limit / price_band_limit. Limit orders are unchanged.
-- Idempotent: runs unchanged as supabase/updates/20261204007800_order_fill_preview.sql.

-- ---------------------------------------------------------------------------
-- A. The fill plan (mirrors planMarketOrder in src/lib/sim/order-fill.ts)
-- ---------------------------------------------------------------------------
create or replace function public.market_order_plan(
  p_security_id  uuid,
  p_side         public.order_side,
  p_quantity_e6  bigint,
  p_amount_cents bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_trading   jsonb := coalesce(public.config_jsonb('trading'), '{}'::jsonb);
  v_scale     double precision := greatest(1, public.cfg_num(v_trading, '{quantityScale}', 1000000));
  s           public.securities;
  v_bid       bigint;
  v_ask       bigint;
  v_prev      bigint;
  v_last      bigint;
  v_pending   bigint;
  v_touch     bigint;
  v_dir       integer;
  v_a         double precision;
  v_pos       double precision;
  v_fee       bigint;
  v_min_price bigint;
  v_cap       double precision;
  v_band      double precision;
  v_bound     double precision;
  v_band_e4   double precision;
  v_by        text := 'impact';
  v_req       bigint;
  v_max       bigint;
  v_fill      bigint;
  v_avg       bigint;
  v_lastp     bigint;
  v_gross     bigint := 0;
  v_tc        double precision;
  qa          double precision;
  qb          double precision;
  v_disc      double precision;
  v_q         double precision;
begin
  select * into s from public.securities where id = p_security_id;
  select q.bid_e4, q.ask_e4, q.prev_close_e4, q.last_price_e4 into v_bid, v_ask, v_prev, v_last
    from public.security_quotes q where q.security_id = p_security_id;
  if s.id is null or v_bid is null or v_ask is null then
    return null;
  end if;
  select st.pending_player_flow_e6 into v_pending from public.security_sim_state st where st.security_id = s.id;
  v_pending   := coalesce(v_pending, 0);
  v_fee       := greatest(0, public.cfg_num(v_trading, '{orderFeeCents}', 100))::bigint;
  v_min_price := greatest(1, public.cfg_num(v_trading, '{minPriceE4}', 1))::bigint;
  v_cap       := greatest(0, public.cfg_num(v_trading, '{priceImpact,maxImpactBpsPerOrder}', 1500)) / 10000.0;
  v_a         := public.cfg_num(v_trading, '{priceImpact,impactBpsPerDepth}', 100) / 10000.0
                 / public.security_depth(s.id, public.market_session_at(public.game_now()) = 'regular');
  if p_side = 'buy' then
    v_touch := v_ask;  v_dir := 1;  v_pos := greatest(v_pending, 0) / 1000000.0;
  else
    v_touch := v_bid;  v_dir := -1; v_pos := greatest(-v_pending, 0) / 1000000.0;
  end if;
  if s.kind = 'stock' then
    -- ADR-126: 1 % per depthCentsPer100Bps of value
    v_a := greatest(v_a, 0.01 * (v_touch / 100.0)
                         / greatest(1, public.cfg_num(v_trading,
                                         array['playerImpact', 'depthCentsPer100Bps',
                                               coalesce((select c.tier::text from public.companies c where c.id = s.company_id), 'midcap')],
                                         2500000)));
  end if;

  -- quantity: given, or solved along the price path for the amount
  if p_quantity_e6 is not null then
    v_req := p_quantity_e6;
  else
    v_tc := v_touch / 100.0;                 -- cents per whole share
    qa := v_a / 2 * v_tc;
    if p_side = 'buy' then
      qb := v_tc * (1 + v_a * v_pos);
      v_q := case when qa > 0 then (-qb + sqrt(qb * qb + 4 * qa * greatest(0, p_amount_cents - v_fee))) / (2 * qa)
                  else greatest(0, p_amount_cents - v_fee) / qb end;
      v_req := greatest(0, floor(v_q * v_scale))::bigint;
      if v_req > 0 then
        -- never more than the amount: the average price is rounded to 0,0001 EUR
        v_avg := greatest(v_min_price, round(v_touch * (1 + v_a * (v_pos + v_req / v_scale / 2)))::bigint);
        v_gross := public.value_cents(v_req, v_avg);
        if v_gross > p_amount_cents - v_fee then
          v_req := floor(v_req::double precision * (p_amount_cents - v_fee) / v_gross)::bigint;
        end if;
      end if;
    else
      qb := v_tc * (1 - v_a * v_pos);
      if qa <= 0 then
        v_q := p_amount_cents / qb;
      else
        v_disc := qb * qb - 4 * qa * p_amount_cents;
        v_q := case when v_disc >= 0 then (qb - sqrt(v_disc)) / (2 * qa) else qb / (2 * qa) end;
      end if;
      v_req := greatest(0, ceil(v_q * v_scale))::bigint;
    end if;
  end if;

  -- how far the last share may move the price: the cap, the daily band of player stocks, the minimum price
  v_bound := v_touch * (1 + v_dir * v_cap);
  v_band  := greatest(0, public.cfg_num(v_trading, '{playerStocks,dailyBandBps}', 0)) / 10000.0;
  if s.kind = 'stock' and v_band > 0
     and exists (select 1 from public.player_companies pc where pc.company_id = s.company_id) then
    v_band_e4 := case when v_dir > 0 then ceil(coalesce(v_prev, v_last, v_touch) * (1 + v_band))
                      else floor(coalesce(v_prev, v_last, v_touch) / (1 + v_band)) end;
    if (v_dir > 0 and v_band_e4 < v_bound) or (v_dir < 0 and v_band_e4 > v_bound) then
      v_bound := v_band_e4;
      v_by := 'band';
    end if;
  end if;
  if v_dir < 0 and v_min_price > v_bound then
    v_bound := v_min_price;
  end if;
  if v_a <= 0 then
    v_max := v_req;
  else
    v_max := greatest(0, floor((v_dir * (v_bound / v_touch - 1) / v_a - v_pos) * v_scale))::bigint;
  end if;
  v_fill := least(v_req, v_max);

  if v_fill > 0 then
    v_avg   := greatest(v_min_price, round(v_touch * (1 + v_dir * v_a * (v_pos + v_fill / v_scale / 2)))::bigint);
    v_gross := public.value_cents(v_fill, v_avg);
  else
    v_avg   := v_touch;
    v_gross := 0;
  end if;
  v_lastp := greatest(v_min_price, round(v_touch * (1 + v_dir * v_a * (v_pos + v_fill / v_scale)))::bigint);

  return jsonb_build_object(
    'touch_e4',              v_touch,
    'requested_quantity_e6', v_req,
    'fill_quantity_e6',      v_fill,
    'unfilled_quantity_e6',  v_req - v_fill,
    'avg_price_e4',          v_avg,
    'last_price_e4',         v_lastp,
    'gross_cents',           v_gross,
    'fee_cents',             case when v_fill > 0 then v_fee else 0 end,
    'slippage_bps',          round(abs(v_avg - v_touch)::double precision / v_touch * 10000)::integer,
    'impact_bps',            round(v_dir * v_a * (v_fill / v_scale) * 10000)::integer,
    'limited_by',            case when v_fill < v_req then v_by end,
    'max_quantity_e6',       v_max);
end;
$function$;

revoke all on function public.market_order_plan(uuid, public.order_side, bigint, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B. quote_order: the preview the order sheet shows before confirming
-- ---------------------------------------------------------------------------
create or replace function public.quote_order(
  p_ticker       text,
  p_side         text,
  p_quantity_e6  bigint default null,
  p_amount_cents bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_player  uuid := public.require_player();
  v_trading jsonb := coalesce(public.config_jsonb('trading'), '{}'::jsonb);
  s         public.securities;
  v_side    public.order_side;
  v_plan    jsonb;
  v_pos     public.positions;
  v_fill    bigint;
  v_left    bigint;
  v_take    bigint;
  v_cost    bigint := 0;
  v_pnl     bigint;
  v_pot     bigint;
  v_tax     bigint := 0;
  v_gross   bigint;
  v_fee     bigint;
  lot       record;
begin
  if lower(coalesce(p_side, '')) not in ('buy', 'sell') or (p_quantity_e6 is null) = (p_amount_cents is null)
     or coalesce(p_quantity_e6, p_amount_cents) < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_side := lower(p_side)::public.order_side;
  select * into s from public.securities where id = public.resolve_security(p_ticker);
  if s.id is null then
    perform public.api_error('unknown_security');
  end if;
  v_plan := public.market_order_plan(s.id, v_side, p_quantity_e6, p_amount_cents);
  if v_plan is null then
    perform public.api_error('not_tradable');
  end if;
  v_fill  := (v_plan ->> 'fill_quantity_e6')::bigint;
  v_gross := (v_plan ->> 'gross_cents')::bigint;
  v_fee   := (v_plan ->> 'fee_cents')::bigint;

  -- sells: capital gains tax exactly like execute_fill (FIFO lots, loss pot)
  if v_side = 'sell' and v_fill > 0 then
    select * into v_pos from public.positions p
     where p.player_id = v_player and p.security_id = s.id and p.side = 'long' and p.leverage = 1 and p.status = 'open';
    if v_pos.id is not null then
      v_left := v_fill;
      for lot in
        select l.quantity_open_e6, l.price_e4 from public.position_lots l
         where l.position_id = v_pos.id and l.quantity_open_e6 > 0 order by l.acquired_at, l.id
      loop
        exit when v_left = 0;
        v_take := least(v_left, lot.quantity_open_e6);
        v_cost := v_cost + public.value_cents(v_take, lot.price_e4);
        v_left := v_left - v_take;
      end loop;
      if v_left > 0 then
        v_cost := v_cost + public.value_cents(v_left, v_pos.avg_entry_price_e4);
      end if;
      v_pnl := v_gross - v_fee - v_cost;
      select pp.tax_loss_pot_cents into v_pot from public.player_private pp where pp.player_id = v_player;
      if v_pnl > 0 then
        v_tax := public.apply_bps(v_pnl - least(v_pnl, coalesce(v_pot, 0)),
                                  public.cfg_num(v_trading, '{capitalGainsTaxBps}', 2500)::numeric);
      end if;
    end if;
  end if;

  return v_plan || jsonb_build_object(
    'ticker',             s.ticker,
    'side',               v_side,
    'tax_cents',          v_tax,
    'realized_pnl_cents', v_pnl,
    -- what the player pays (buy) or receives (sell) in cash
    'net_cents',          case when v_fill = 0 then 0
                               when v_side = 'buy' then v_gross + v_fee
                               else v_gross - v_fee - v_tax end);
end;
$function$;

revoke all on function public.quote_order(text, text, bigint, bigint) from public, anon;
grant execute on function public.quote_order(text, text, bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- C. place_order: market orders fill exactly the plan (full latest definition, incl. ADR-153 and ADR-170)
-- ---------------------------------------------------------------------------
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
as $function$
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
  v_plan       jsonb;
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
  -- ADR-170: no buying the own stock with money just taken out of the company
  if v_side = 'buy' and s.kind = 'stock' and public.player_stock_insider_blocked(v_player, s.id) then
    perform public.api_error('insider_cooldown');
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
  -- Stocks: a fill pays for the move it causes (ADR-126). The next tick moves the price by the player impact
  -- (0.01 x value / depthCentsPer100Bps); the fill pays half of that on average, so buying and selling right away
  -- can never earn the move one causes oneself.
  if s.kind = 'stock' then
    v_a := greatest(v_a, 0.01 * (v_touch / 100.0)
                         / greatest(1, public.cfg_num(v_trading,
                                         array['playerImpact', 'depthCentsPer100Bps',
                                               coalesce((select c.tier::text from public.companies c where c.id = s.company_id), 'midcap')],
                                         2500000)));
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
        -- ADR-189: the quantity the amount buys along the price path, the same plan the preview shows
        v_qty := (public.market_order_plan(s.id, v_side, null, p_amount_cents) ->> 'requested_quantity_e6')::bigint;
      end if;
    else
      -- the amount is the gross proceeds before fee and tax
      if p_amount_cents < v_min_value then
        perform public.api_error('order_too_small');
      end if;
      if v_type = 'limit' then
        v_qty := ceil(p_amount_cents * 100000000.0 / v_limit)::bigint;
      else
        v_qty := (public.market_order_plan(s.id, v_side, null, p_amount_cents) ->> 'requested_quantity_e6')::bigint;
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

  -- ADR-153: a stock has a supply. Buyers of one stock go one after the other, so the float cannot be oversold.
  if v_side = 'buy' and s.kind = 'stock' then
    perform 1 from public.securities x where x.id = s.id for update;
    if public.security_free_float_e6(s.id) is not null then
      if public.security_free_float_e6(s.id) < 1 then
        perform public.api_error('no_shares_left');
      end if;
      v_qty := least(v_qty, public.security_free_float_e6(s.id));
    end if;
  end if;

  -- minimum order value at the price it would execute or rest at
  if public.value_cents(v_qty, coalesce(v_limit, v_touch)) < v_min_value
     and not (v_side = 'sell' and v_qty = v_avail) then
    perform public.api_error('order_too_small');
  end if;

  -- how much executes now ---------------------------------------------------------
  if v_type = 'market' then
    -- ADR-189: the fill is exactly the plan the preview (quote_order) showed: the last share moves the price at
    -- most priceImpact.maxImpactBpsPerOrder and stays inside the daily band of player stocks; the rest of a
    -- market order is not executed and reported (limited_by, unfilled_quantity_e6).
    v_plan := public.market_order_plan(s.id, v_side, v_qty, null);
    v_fill_qty := (v_plan ->> 'fill_quantity_e6')::bigint;
    v_fill_price := (v_plan ->> 'avg_price_e4')::bigint;
    if v_fill_qty < 1 then
      perform public.api_error(case when v_plan ->> 'limited_by' = 'band' then 'price_band_limit'
                                    else 'order_impact_limit' end);
    end if;
    v_qty := v_fill_qty;
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
      if v_type = 'limit' then
        v_fill_price := round(v_touch * (1 + v_a * (v_pos + v_fill_qty / v_scale / 2)))::bigint;
      end if;
      if v_type = 'limit' then
        v_fill_price := least(v_fill_price, v_limit);
      end if;
    else
      if v_type = 'limit' then
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
    'amount_cents',       p_amount_cents,
    'requested_quantity_e6', coalesce((v_plan ->> 'requested_quantity_e6')::bigint, o.quantity_e6),
    'unfilled_quantity_e6',  coalesce((v_plan ->> 'requested_quantity_e6')::bigint - o.quantity_e6, 0),
    'limited_by',            v_plan ->> 'limited_by',
    'impact_bps',            coalesce((v_plan ->> 'impact_bps')::integer, 0)));
end;
$function$;

revoke all on function public.place_order(uuid, text, text, text, bigint, bigint, bigint) from public, anon;
grant execute on function public.place_order(uuid, text, text, text, bigint, bigint, bigint) to authenticated;
