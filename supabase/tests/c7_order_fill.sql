-- =============================================================================
-- c7 · The preview is the fill (ADR-189)
-- =============================================================================
-- The owner's report: "Ich habe für über 100k verkauft und nur 50k bekommen." The order sheet showed
-- quantity x bid; the server filled 58.877,58 shares of a penny player stock along the impact path (ADR-126) at an
-- average of 0,8489 EUR instead of about 1,63 EUR. Now quote_order() and place_order() share one plan: what the
-- preview shows is what is executed, the last share moves the price at most maxImpactBpsPerOrder, the daily band of
-- player stocks is never crossed, and the rest is reported instead of being filled far below the quote.
\set QUIET 1
set client_min_messages = notice;

\set f '''0c7c7c7c-0000-4000-8000-0000000000f1'''
\set a '''0c7c7c7c-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:f, 'Fiona_Fill') is not null and tests.signup(:a, 'Arne_Ausfuehrung') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 12);
select tests.set_level(:a, 12);
select tests.fund(:f, 5000000, 'test:c7:f');
select tests.fund(:a, 30000000, 'test:c7:a');

-- puts a stock at a fixed quote (bid = ask = p) with no pending player flow
create or replace function tests.c7_quote(p_sec uuid, p_e4 bigint, p_prev bigint) returns void language sql as $$
  update public.security_quotes set last_price_e4 = p_e4, bid_e4 = p_e4, ask_e4 = p_e4, prev_close_e4 = p_prev
   where security_id = p_sec;
  update public.security_sim_state set pending_player_flow_e6 = 0, pending_player_volume_e6 = 0 where security_id = p_sec $$;
create or replace function tests.c7_quote_order(p_player uuid, p_ticker text, p_side text, p_q bigint, p_amount bigint)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.login_as('authenticated', p_player);
  r := public.quote_order(p_ticker, p_side, p_q, p_amount);
  reset role;
  return r;
end $$;
create or replace function tests.c7_order(p_player uuid, p_ticker text, p_side text, p_q bigint, p_amount bigint)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.login_as('authenticated', p_player);
  r := public.place_order(gen_random_uuid(), p_ticker, p_side, 'market', p_q, null, p_amount);
  reset role;
  return r;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlerrm);
end $$;
grant execute on all functions in schema tests to public;

begin;
select tests.set_cfg('aiInvestors', '{tickNoiseScale}', '0');
select tests.set_cfg('abuse', '{rateLimits,ordersPerMinute}', '1000');

-- =============================================================================
-- A. A listed player company (penny tier), bid 1,63 EUR, previous close 1,63 EUR
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Fuellstand', 'Volle Kraft', 'tech', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.company_of(:f) as co \gset
update public.player_companies set quality = 1 where company_id = :'co';
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select c.ticker as tkr, c.security_id as sec from public.companies c where c.id = :'co' \gset
-- enough free shares for the owner's position (ADR-153)
update public.companies set shares_outstanding = 10000000 where id = :'co';
select tests.c7_quote(:'sec', 16300, 16300);
select set_config('c7.sec', :'sec', false) is not null and set_config('c7.tkr', :'tkr', false) is not null as ok \gset

-- Arne builds the owner's position: 58.877,583251 shares at 1,63 EUR, in steps the cap lets through
do $$
declare
  v_left bigint := 58877583251;
  v_step bigint;
  r jsonb;
begin
  while v_left > 0 loop
    v_step := least(v_left, 5000000000);
    perform tests.c7_quote(current_setting('c7.sec')::uuid, 16300, 16300);
    r := tests.c7_order('0c7c7c7c-0000-4000-8000-0000000000a1', current_setting('c7.tkr'), 'buy', v_step, null);
    if r ? 'error' then raise exception 'setup buy failed: %', r; end if;
    v_left := v_left - (r ->> 'filled_quantity_e6')::bigint;
  end loop;
end $$ ;
select tests.assert((select quantity_e6 from public.positions where player_id = :a and security_id = :'sec' and status = 'open')
  = 58877583251, 'setup: Arne holds the owner''s 58.877,583251 shares');

-- =============================================================================
-- B. Before ADR-189 (no cap): the preview now at least tells the truth, about 49.980 EUR for 58.877 shares
-- =============================================================================
select tests.c7_quote(:'sec', 16300, 16300);
select tests.set_cfg('trading', '{priceImpact,maxImpactBpsPerOrder}', '1000000');
select tests.set_cfg('trading', '{playerStocks,dailyBandBps}', '0');
select tests.c7_quote_order(:a, :'tkr', 'sell', 58877583251, null) as old \gset
select tests.assert((:'old'::jsonb ->> 'avg_price_e4')::bigint between 8400 and 8600
  and (:'old'::jsonb ->> 'gross_cents')::bigint between 4900000 and 5100000,
  'old model: 58.877 shares at a bid of 1,63 EUR fill at about 0,85 EUR, about 50.000 EUR (the bug report): ' || :'old');
select tests.set_cfg('trading', '{priceImpact,maxImpactBpsPerOrder}', '1500');
select tests.set_cfg('trading', '{playerStocks,dailyBandBps}', '10000');

-- =============================================================================
-- C. The owner's sale now: preview = fill, impact capped, the rest reported
-- =============================================================================
select tests.c7_quote(:'sec', 16300, 16300);
select tests.cash(:a) as c0 \gset
select tests.c7_quote_order(:a, :'tkr', 'sell', 58877583251, null) as q \gset
select tests.c7_order(:a, :'tkr', 'sell', 58877583251, null) as r \gset
select tests.cash(:a) as c1 \gset
select tests.assert(not (:'r'::jsonb ? 'error'), 'the sale executes: ' || :'r');
select tests.assert((:'q'::jsonb ->> 'limited_by') = 'impact' and (:'r'::jsonb ->> 'limited_by') = 'impact'
  and (:'q'::jsonb ->> 'unfilled_quantity_e6')::bigint > 0
  and (:'r'::jsonb ->> 'unfilled_quantity_e6')::bigint = (:'q'::jsonb ->> 'unfilled_quantity_e6')::bigint,
  'the preview and the result say that only part fills (impact limit): ' || :'q');
select tests.assert((:'r'::jsonb ->> 'filled_quantity_e6')::bigint = (:'q'::jsonb ->> 'fill_quantity_e6')::bigint
  and (:'r'::jsonb ->> 'avg_price_e4')::bigint = (:'q'::jsonb ->> 'avg_price_e4')::bigint
  and (:'r'::jsonb ->> 'gross_cents')::bigint = (:'q'::jsonb ->> 'gross_cents')::bigint
  and (:'r'::jsonb ->> 'tax_cents')::bigint = (:'q'::jsonb ->> 'tax_cents')::bigint,
  'sell: fill equals the preview (quantity, price, gross, tax)');
select tests.assert(:c1::bigint - :c0::bigint = (:'q'::jsonb ->> 'net_cents')::bigint,
  'sell: the cash credited is exactly the previewed "Du erhältst" (' || (:c1::bigint - :c0::bigint) || ' vs '
  || (:'q'::jsonb ->> 'net_cents') || ')');
select tests.assert((:'q'::jsonb ->> 'avg_price_e4')::bigint >= 15070
  and (:'q'::jsonb ->> 'impact_bps')::integer between -1500 and -1400
  and (:'q'::jsonb ->> 'last_price_e4')::bigint >= 13855,
  'sell: the average stays within 7,5 % of the bid, the price moves at most 15 %: ' || :'q');
-- ledger: the seller's cash got gross - fee - tax, fee and tax went to the treasury, nothing else
select tests.assert((select t.gross_cents - t.fee_cents - t.tax_cents from public.trades t
                      where t.order_id = (:'r'::jsonb ->> 'order_id')::uuid) = :c1::bigint - :c0::bigint
  and (select t.tax_cents from public.trades t where t.order_id = (:'r'::jsonb ->> 'order_id')::uuid) = 0,
  'ledger: the sale (a loss, no tax) credits the seller with gross minus the 1 EUR fee');

-- a second sale in the same tick: the cap is used up, the order is refused, nothing is booked
select tests.c7_quote_order(:a, :'tkr', 'sell', 10000000000, null) as q2 \gset
select tests.c7_order(:a, :'tkr', 'sell', 10000000000, null) as r2 \gset
select tests.assert((:'q2'::jsonb ->> 'fill_quantity_e6')::bigint = 0 and (:'q2'::jsonb ->> 'net_cents')::bigint = 0
  and (:'r2'::jsonb ->> 'error') = 'order_impact_limit' and tests.cash(:a) = :c1::bigint,
  'in the same tick the cap is used up: preview 0, order refused with order_impact_limit: ' || :'r2');

-- =============================================================================
-- D. The daily band (ADR-170) limits explicitly, never fills below it
-- =============================================================================
-- band low = 30.000 / 2 = 15.000 > cap bound 13.855: the band binds
select tests.c7_quote(:'sec', 16300, 30000);
select tests.c7_quote_order(:a, :'tkr', 'sell', 30000000000, null) as qb \gset
select tests.c7_order(:a, :'tkr', 'sell', 30000000000, null) as rb \gset
select tests.assert((:'qb'::jsonb ->> 'limited_by') = 'band' and (:'rb'::jsonb ->> 'limited_by') = 'band'
  and (:'qb'::jsonb ->> 'last_price_e4')::bigint >= 15000
  and (:'rb'::jsonb ->> 'filled_quantity_e6')::bigint = (:'qb'::jsonb ->> 'fill_quantity_e6')::bigint
  and (:'rb'::jsonb ->> 'avg_price_e4')::bigint = (:'qb'::jsonb ->> 'avg_price_e4')::bigint,
  'band: the sale fills only down to the band (1,50 EUR), as previewed: ' || :'qb');
-- bid already below the band: nothing fills, refused with price_band_limit
select tests.c7_quote(:'sec', 16300, 40000);
select tests.c7_order(:a, :'tkr', 'sell', 1000000000, null) as rb2 \gset
select tests.assert((:'rb2'::jsonb ->> 'error') = 'price_band_limit', 'band reached: price_band_limit: ' || :'rb2');

-- =============================================================================
-- E. 100.000 EUR buys and sells: player stock and AI stocks, preview = fill
-- =============================================================================
create temp table c7_cases (tkr text);
insert into c7_cases values (:'tkr'), ('DRN'), ('ALM'), ('BRZ');
do $$
declare
  c record;
  v_sec uuid;
  q jsonb;
  r jsonb;
  c0 bigint;
  v_held bigint;
  v_side text;
begin
  for c in select tkr from c7_cases loop
    select id into v_sec from public.securities where ticker = c.tkr;
    foreach v_side in array array['buy', 'sell'] loop
      perform tests.c7_quote(v_sec, 16300, 16300);
      c0 := tests.cash('0c7c7c7c-0000-4000-8000-0000000000a1');
      if v_side = 'buy' then
        q := tests.c7_quote_order('0c7c7c7c-0000-4000-8000-0000000000a1', c.tkr, 'buy', null, 10000000);
        r := tests.c7_order('0c7c7c7c-0000-4000-8000-0000000000a1', c.tkr, 'buy', null, 10000000);
      else
        select p.quantity_e6 into v_held from public.positions p
         where p.player_id = '0c7c7c7c-0000-4000-8000-0000000000a1' and p.security_id = v_sec and p.status = 'open';
        q := tests.c7_quote_order('0c7c7c7c-0000-4000-8000-0000000000a1', c.tkr, 'sell', v_held, null);
        r := tests.c7_order('0c7c7c7c-0000-4000-8000-0000000000a1', c.tkr, 'sell', v_held, null);
      end if;
      raise notice 'c7 % % 100k: preview % -> fill %', c.tkr, v_side, q, r;
      perform tests.assert(not (r ? 'error'), c.tkr || ' ' || v_side || ' executes: ' || r::text);
      perform tests.assert((r ->> 'filled_quantity_e6')::bigint = (q ->> 'fill_quantity_e6')::bigint
        and (r ->> 'avg_price_e4')::bigint = (q ->> 'avg_price_e4')::bigint
        and (r ->> 'limited_by') is not distinct from (q ->> 'limited_by'),
        c.tkr || ' ' || v_side || ': fill equals the preview');
      perform tests.assert(abs(tests.cash('0c7c7c7c-0000-4000-8000-0000000000a1') - c0)
                           = (q ->> 'net_cents')::bigint,
        c.tkr || ' ' || v_side || ': cash moves by exactly the previewed amount');
      perform tests.assert(abs((q ->> 'impact_bps')::integer) <= 1500 and (q ->> 'slippage_bps')::integer <= 751,
        c.tkr || ' ' || v_side || ': impact disclosed and capped: ' || q::text);
      if v_side = 'buy' then
        perform tests.assert((q ->> 'net_cents')::bigint <= 10000000, c.tkr || ': a 100.000 EUR buy never spends more');
      end if;
    end loop;
  end loop;
end $$;
-- a blue chip absorbs 100.000 EUR in full (5 % move), a penny stock does not
select tests.assert((tests.c7_quote_order(:a, 'BRZ', 'buy', null, 10000000) ->> 'limited_by') is null,
  'a blue chip takes a 100.000 EUR buy in full');

-- a sale with a gain: the preview shows the capital gains tax, the fill takes exactly that (25 %, never more)
select id as brz from public.securities where ticker = 'BRZ' \gset
select tests.c7_quote(:'brz', 16300, 16300);
select tests.c7_order(:a, 'BRZ', 'buy', 1000000000, null) is not null as ok \gset
select tests.c7_quote(:'brz', 20000, 20000);
update public.player_private set tax_loss_pot_cents = 0 where player_id = :a;
select tests.cash(:a) as t0 \gset
select tests.c7_quote_order(:a, 'BRZ', 'sell', 1000000000, null) as qt \gset
select tests.c7_order(:a, 'BRZ', 'sell', 1000000000, null) as rt \gset
select tests.assert((:'qt'::jsonb ->> 'tax_cents')::bigint > 0
  and (:'rt'::jsonb ->> 'tax_cents')::bigint = (:'qt'::jsonb ->> 'tax_cents')::bigint
  and (:'qt'::jsonb ->> 'tax_cents')::bigint
      = public.apply_bps((:'qt'::jsonb ->> 'realized_pnl_cents')::bigint, 2500)
  and tests.cash(:a) - :t0::bigint = (:'qt'::jsonb ->> 'net_cents')::bigint,
  'gain: the previewed 25 % tax is what is withheld, the cash matches the preview: ' || :'qt');

select tests.assert(tests.money_invariant() = 'ok', 'money invariant: ' || tests.money_invariant());
rollback;
