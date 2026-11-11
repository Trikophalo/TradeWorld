-- ===== idempotent copy of migrations/20261114000200_m3c_markets.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M3c · 0200 · Player-driven markets (ADR-056, docs/SIMULATION.md 6a)
-- =============================================================================
-- Mirrors src/lib/sim/player-influence.ts and tick.ts (stepSecurity):
--   * player orders move prices in euros: r = 0.01 x net value / depthCentsPer100Bps / liquidity
--   * value funds accept fair value x (1 + maxHoldingsPremium x tanh(held value / (premiumScaleDepths x depth)))
--   * momentum, retail herd and noise are weighted with w = max(minAiWeight, R / (R + player activity))
--   * bonds: noise x bonds.volatilityMultiplier, player orders in euros
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

alter table public.security_sim_state
  add column if not exists player_activity    double precision not null default 0,
  add column if not exists pending_player_volume_e6 bigint not null default 0;
comment on column public.security_sim_state.player_activity is 'Player traded value in cents (a decayed statistic, not money: double precision) with an exponential half-life (aiInvestors.playerWeight.activityHalfLifeHours); weakens the AI traders.';
comment on column public.security_sim_state.pending_player_volume_e6 is 'Gross player volume (millionths of a share) since the last tick; feeds player_activity.';

-- execute_fill as in M2, plus the gross player volume for the tick
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
       set pending_player_flow_e6 = pending_player_flow_e6 + case when o.side = 'buy' then p_quantity else -p_quantity end,
           pending_player_volume_e6 = pending_player_volume_e6 + p_quantity
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

-- market_tick_at as in M2 with player-driven prices (ADR-056)
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
  -- ADR-056: player-driven prices
  v_pimp      jsonb := coalesce(public.config_jsonb('trading', '{playerImpact}'), '{}'::jsonb);
  v_pwt       jsonb := coalesce(public.config_jsonb('aiInvestors', '{playerWeight}'), '{}'::jsonb);
  c_actdecay  double precision;
  c_minw      double precision;
  c_maxprem   double precision;
  c_premscale double precision;
  c_bonddepth double precision;
  c_bondvol   double precision;
  v_pdepth    double precision;
  v_act       double precision;
  v_w         double precision;
  v_fva       double precision;
  v_held      double precision;
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
  a_act  double precision[] := '{}';
  a_pvol bigint[] := '{}';
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
               * public.cfg_num(v_ai, '{archetypes,value_fund,reactionSpeed}', 0.0005) * c_liq;
  c_vf_gap    := public.cfg_num(v_ai, '{archetypes,value_fund,params,gapScale}', 0.5);
  c_vf_dead   := public.cfg_num(v_ai, '{archetypes,value_fund,params,deadBand}', 0.01);
  c_mo_cap    := public.cfg_num(v_ai, '{archetypes,momentum_trader,capitalShare}', 0.1)
               * public.cfg_num(v_ai, '{archetypes,momentum_trader,reactionSpeed}', 0.0002) * c_liq;
  c_mo_ts     := public.cfg_num(v_ai, '{archetypes,momentum_trader,params,trendScale}', 0.02);
  c_rh_cap    := public.cfg_num(v_ai, '{archetypes,retail_herd,capitalShare}', 0.1)
               * public.cfg_num(v_ai, '{archetypes,retail_herd,reactionSpeed}', 0.002) * c_liq;
  c_rh_chase  := public.cfg_num(v_ai, '{archetypes,retail_herd,params,chaseGain}', 0.1);
  c_rh_ts     := public.cfg_num(v_ai, '{archetypes,retail_herd,params,trendScale}', 0.02);
  c_mm_speed  := public.cfg_num(v_ai, '{archetypes,market_maker,reactionSpeed}', 0.005) * c_liq;
  c_basevol   := public.cfg_num(v_ai, '{baselineVolumeDepthFraction}', 0.02);
  -- Scale on tickNoiseBps for stocks (ADR-056: 0.45, livelier than the M1 target of 0.2).
  c_nscale    := public.cfg_num(v_ai, '{tickNoiseScale}', 0.45);
  c_qpy       := greatest(1, public.cfg_num(v_bonds, '{couponsPerGameYear}', 4));
  c_qsec      := public.cfg_num(v_time, '{quarterHours}', 6) * 3600;
  -- player activity: exponential decay per tick with activityHalfLifeHours
  c_actdecay  := power(0.5, public.cfg_num(v_time, '{tickSeconds}', 5)
                            / (greatest(public.cfg_num(v_pwt, '{activityHalfLifeHours}', 6), 0.001) * 3600));
  c_minw      := public.cfg_num(v_pwt, '{minAiWeight}', 0.15);
  c_maxprem   := public.cfg_num(v_pimp, '{maxHoldingsPremium}', 0.6);
  c_premscale := public.cfg_num(v_pimp, '{premiumScaleDepths}', 20);
  c_bonddepth := greatest(1, public.cfg_num(v_pimp, '{bondDepthCentsPer100Bps}', 5000000));
  c_bondvol   := public.cfg_num(v_bonds, '{volatilityMultiplier}', 3);

  -- 1. resting limit orders against the quote players currently see ----------
  v_filled := public.fill_resting_orders();

  -- 2./3. stocks and bonds ---------------------------------------------------------
  for r in
    select s.id, s.kind, s.sector_key, c.tier::text as tier, c.shares_outstanding,
           q.last_price_e4,
           st.fair_value_e4, st.sentiment, st.ema_fast, st.ema_slow, st.maker_inventory,
           st.pending_player_flow_e6, st.price_deviation, st.volatility, st.liquidity_shares, st.spread_bps,
           st.player_activity, st.pending_player_volume_e6, coalesce(h.held_e6, 0) as held_e6,
           b.coupon_bps, b.matures_at, b.face_value_cents
      from public.securities s
      join public.security_quotes q on q.security_id = s.id
      join public.security_sim_state st on st.security_id = s.id
      left join (select p.security_id, sum(p.quantity_e6) as held_e6
                   from public.positions p
                  where p.status = 'open' and p.side = 'long'
                  group by p.security_id) h on h.security_id = s.id
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
    -- player activity (cents): decayed old value plus this tick's gross player volume at the last price
    v_act   := coalesce(r.player_activity, 0) * c_actdecay
             + abs(coalesce(r.pending_player_volume_e6, 0)) / 1000000.0 * v_price / 100.0;

    if r.kind = 'stock' and r.shares_outstanding is not null then
      v_depth := greatest(1, r.shares_outstanding * c_depthfrac * c_liq);
      v_pdepth := greatest(1, public.cfg_num(v_pimp, array['depthCentsPer100Bps', coalesce(r.tier, 'midcap')], 2500000));
      -- AI traders fade with player activity: w = max(minAiWeight, R / (R + activity))
      v_w := greatest(c_minw, public.cfg_num(v_pwt, array['referenceActivityCents', coalesce(r.tier, 'midcap')], 25000000)
                              / (public.cfg_num(v_pwt, array['referenceActivityCents', coalesce(r.tier, 'midcap')], 25000000)
                                 + greatest(v_act, 0)));
      -- value fund: anchor = fair value x (1 + maxPremium x tanh(player held value / (scale x depth)))
      v_held := greatest(0, r.held_e6 / 1000000.0 * v_price / 100.0);
      v_fva := r.fair_value_e4 * (1 + c_maxprem * tanh(v_held / (c_premscale * v_pdepth)));
      v_gap := ln(v_fva / v_price);
      if abs(v_gap) <= c_vf_dead then
        v_pv := 0;
      else
        v_pv := r.shares_outstanding * c_vf_cap
              * greatest(-1, least(1, (v_gap - sign(v_gap) * c_vf_dead) / c_vf_gap));
      end if;
      v_trend := case when v_es > 0 then v_ef / v_es - 1 else 0 end;
      v_pm  := r.shares_outstanding * c_mo_cap * tanh(v_trend / c_mo_ts) * v_w;
      v_pr  := r.shares_outstanding * c_rh_cap * greatest(-1, least(1, v_sent + c_rh_chase * tanh(v_trend / c_rh_ts))) * v_w;
      v_pmm := -v_mm * c_mm_speed * c_hedge;
      -- AI order flow through the depth model; player orders in euros (fully immediate):
      -- 0.01 x net value / depthCentsPer100Bps / liquidity
      v_ret := sign(v_pv + v_pm + v_pr + v_pmm) * c_impact * power(abs(v_pv + v_pm + v_pr + v_pmm) / v_depth, c_exp)
             + 0.01 * (v_flow * v_price / 100.0) / v_pdepth / c_liq;
      v_sigma := v_w * public.cfg_num(v_ai, array['tickNoiseBps', coalesce(r.tier, 'midcap')], 15) / 10000.0
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
      -- player orders in euros: 0.01 x net value / bondDepthCentsPer100Bps / liquidity
      v_imp_flow := 0.01 * (v_flow * v_price / 100.0) / c_bonddepth / c_liq;
      v_dev := v_dev * (1 - c_decay) + coalesce(r.volatility, 0) * c_bondvol * c_noise * public.gauss_random() + v_imp_flow;
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
    a_act := a_act || v_act;   a_pvol := a_pvol || coalesce(r.pending_player_volume_e6, 0);
    v_n := v_n + 1;
  end loop;

  update public.security_sim_state st
     set sentiment = u.s, ema_fast = u.ef, ema_slow = u.es, maker_inventory = u.mm,
         price_deviation = u.dev, pending_player_flow_e6 = st.pending_player_flow_e6 - u.flow,
         player_activity = u.act, pending_player_volume_e6 = st.pending_player_volume_e6 - u.pvol
    from unnest(a_id, a_s, a_ef, a_es, a_mm, a_dev, a_flow, a_act, a_pvol) as u(id, s, ef, es, mm, dev, flow, act, pvol)
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

do $$
declare
  f text;
begin
  foreach f in array array['public.execute_fill(uuid, bigint, bigint, boolean, boolean)', 'public.market_tick_at(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
