-- =============================================================================
-- NEXA · M1 · 0300 · Market tick in PL/pgSQL (replaces the edge-function
--                    runner of ADR-004 for the alpha)
-- =============================================================================
-- public.market_tick() runs every 5 seconds via pg_cron. It is a port of
-- stepMarketTick() in src/lib/sim/tick.ts (docs/SIMULATION.md section 3):
--   1. fill resting limit orders that the current quote makes marketable
--   2. per stock: sentiment decay, player flow -> market maker inventory,
--      pressure of value fund (anchor to fair value), momentum traders,
--      retail herd and market-maker hedging, linear price impact, noise per
--      size class x sector, circuit breaker, stochastic rounding, EMAs, quote
--   3. per bond: price from the yield (policy rate + maturity spread) as
--      present value, plus a small mean-reverting deviation and player flow
--   4. NEXA 30 = sum(shares x price) / divisor
--   5. quotes (day high/low/volume/change, roll at the 22:00 bell),
--      price_ticks, candles 1m/5m/1h/1q/1y, runtime and tick log
-- Pension and index funds of the TS model start at their target holding and
-- the policy rate is constant in M1, so their pressure is zero and they are
-- left out here (placeholders, ROADMAP M1).
-- Ticks never overlap: transaction-level advisory lock 7311001 (try-lock).
-- =============================================================================

-- Yield of a bond for a remaining maturity (bondYieldBps in src/lib/sim/bonds.ts).
create or replace function public.bond_yield_bps(p_policy_rate_bps integer, p_years double precision, p_bonds jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_spread double precision;
  v_lo     record;
  v_hi     record;
  v_raw    double precision;
begin
  -- maturities sorted by years; interpolate the spread linearly
  select (m ->> 'years')::double precision as years, (m ->> 'spreadBps')::double precision as spread
    into v_lo
    from jsonb_array_elements(coalesce(p_bonds -> 'maturities', '[]'::jsonb)) m
   where (m ->> 'years')::double precision <= p_years
   order by 1 desc limit 1;
  select (m ->> 'years')::double precision as years, (m ->> 'spreadBps')::double precision as spread
    into v_hi
    from jsonb_array_elements(coalesce(p_bonds -> 'maturities', '[]'::jsonb)) m
   where (m ->> 'years')::double precision >= p_years
   order by 1 asc limit 1;
  if v_lo.years is null and v_hi.years is null then
    v_spread := 0;
  elsif v_lo.years is null then
    v_spread := v_hi.spread;
  elsif v_hi.years is null or v_hi.years = v_lo.years then
    v_spread := v_lo.spread;
  else
    v_spread := v_lo.spread + (p_years - v_lo.years) / (v_hi.years - v_lo.years) * (v_hi.spread - v_lo.spread);
  end if;
  v_raw := p_policy_rate_bps + v_spread;
  return round(least(public.cfg_num(p_bonds, '{maxYieldBps}', 400),
                     greatest(public.cfg_num(p_bonds, '{minYieldBps}', 200), v_raw)))::integer;
end;
$$;

-- Clean price as a fraction of face value (1.0 = par): present value of the
-- remaining coupons and the redemption minus accrued interest. p_periods is
-- the remaining maturity in coupon periods (may be fractional).
create or replace function public.bond_clean_price(
  p_coupon_bps integer, p_yield_bps double precision, p_periods double precision, p_per_year double precision
)
returns double precision
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_c     double precision := p_coupon_bps / 10000.0 / p_per_year;
  v_y     double precision := p_yield_bps / 10000.0 / p_per_year;
  v_n     integer;
  v_dirty double precision := 0;
  k       integer;
begin
  if p_periods <= 0 then
    return 1;
  end if;
  v_n := ceil(p_periods)::integer;
  for k in 1..v_n loop
    v_dirty := v_dirty + v_c / power(1 + v_y, p_periods - v_n + k);
  end loop;
  v_dirty := v_dirty + 1 / power(1 + v_y, p_periods);
  return v_dirty - v_c * (v_n - p_periods);
end;
$$;

-- Fills resting limit orders that are marketable against the current quote
-- (buy: ask <= limit, sell: bid >= limit) at their limit price.
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
      if o.status in ('open', 'partially_filled') and o.quantity > o.filled_quantity then
        perform public.execute_fill(o.id, o.quantity - o.filled_quantity, o.limit_price_e4, true, false);
        v_n := v_n + 1;
      end if;
    exception when others then
      raise warning 'NEXA: resting order % not filled: % (%)', r.id, sqlerrm, sqlstate;
    end;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- The tick. p_now is the simulated time (tests); market_tick() uses game_now().
-- ---------------------------------------------------------------------------
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
           st.pending_player_flow, st.price_deviation, st.volatility, st.liquidity_shares, st.spread_bps,
           b.coupon_bps, b.matures_at, b.face_value_cents
      from public.securities s
      join public.security_quotes q on q.security_id = s.id
      join public.security_sim_state st on st.security_id = s.id
      left join public.companies c on c.id = s.company_id
      left join public.bonds b on b.security_id = s.id
     where s.status = 'listed' and s.kind in ('stock', 'bond')
  loop
    v_price := r.last_price_e4;
    v_flow  := r.pending_player_flow;
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
      v_vol := round(abs(v_pv) + abs(v_pm) + abs(v_pr) + abs(v_pmm) + v_depth * c_basevol * (0.5 + random()))::bigint;
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
      v_vol := round(v_depth * c_basevol * (0.5 + random()))::bigint;
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
    a_mm := a_mm || v_mm;      a_dev := a_dev || v_dev;    a_flow := a_flow || r.pending_player_flow;
    a_y := a_y || v_yield_out; a_mc := a_mc || v_mcap;
    v_n := v_n + 1;
  end loop;

  update public.security_sim_state st
     set sentiment = u.s, ema_fast = u.ef, ema_slow = u.es, maker_inventory = u.mm,
         price_deviation = u.dev, pending_player_flow = st.pending_player_flow - u.flow
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
         day_volume = case when v_new_day then u.v else q.day_volume + u.v end,
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
  insert into public.price_ticks (security_id, ts, tick_seq, price_e4, volume)
  select u.id, p_now, v_seq, u.p, u.v from unnest(a_id, a_p, a_v) as u(id, p, v)
  on conflict do nothing;

  insert into public.candles as c (security_id, interval, bucket_start, open_e4, high_e4, low_e4, close_e4, volume, tick_count)
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
         volume = c.volume + excluded.volume,
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

create or replace function public.market_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.market_tick_at(public.game_now());
end;
$$;
comment on function public.market_tick() is 'pg_cron every 5 seconds: one market tick at game_now(). Skips while paused or while another tick holds the lock.';

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.bond_yield_bps(integer, double precision, jsonb)',
    'public.bond_clean_price(integer, double precision, double precision, double precision)',
    'public.fill_resting_orders()', 'public.market_tick_at(timestamptz)', 'public.market_tick()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
