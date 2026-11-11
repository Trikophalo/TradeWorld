-- ===== idempotent copy of migrations/20261111000500_m1_read_api_cron.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M1 · 0500 · Read RPCs for the client (polling) and the pg_cron jobs
-- =============================================================================
-- All read RPCs are STABLE SECURITY DEFINER, executable by authenticated only,
-- and return public market data or the caller's own data (auth.uid()).
-- JSON numbers are plain numbers (cents, e4, bps), timestamps ISO strings.
-- =============================================================================

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
           'day_volume', q.day_volume, 'market_cap_cents', case when s.kind = 'stock' then q.market_cap_cents end,
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
    'securities',      v_secs);
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
           'l', x.low_e4, 'c', x.close_e4, 'v', x.volume) order by x.bucket_start), '[]'::jsonb)
    into v_out
    from (select c.* from public.candles c
           where c.security_id = v_id and c.interval = p_interval::public.candle_interval
           order by c.bucket_start desc limit v_limit) x;
  return v_out;
end;
$$;

-- Synthetic market-maker levels (synthesizeOrderBook in src/lib/sim/market-maker.ts)
-- merged with the aggregated open player limit orders. Level i is i x levelStepBps
-- away from the touch and offers depth x levelStepBps / impactBpsPerDepth shares
-- (+- sizeJitter, deterministic per tick). Thinner and wider after hours.
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
  v_base   := public.security_depth(v_id, public.market_session_at(public.game_now()) = 'regular')
            * v_step / public.cfg_num(v_trading, '{priceImpact,impactBpsPerDepth}', 100);

  with mm as (
    select 'bid'::text as side,
           least(floor(v_bid * (1 - i * v_step / 10000.0))::bigint, v_bid - i) as price_e4,
           greatest(1, floor(v_base * (1 + v_jitter * (2 * ((abs(hashtext(v_id::text || 'b' || i || ':' || v_seq)) % 10000) / 10000.0) - 1))))::bigint as qty
      from generate_series(0, v_levels - 1) i
    union all
    select 'ask',
           greatest(ceil(v_ask * (1 + i * v_step / 10000.0))::bigint, v_ask + i),
           greatest(1, floor(v_base * (1 + v_jitter * (2 * ((abs(hashtext(v_id::text || 'a' || i || ':' || v_seq)) % 10000) / 10000.0) - 1))))::bigint
      from generate_series(0, v_levels - 1) i
  ), players as (
    select case when o.side = 'buy' then 'bid' else 'ask' end as side, o.limit_price_e4 as price_e4,
           sum(o.quantity - o.filled_quantity)::bigint as qty, count(*)::integer as n
      from public.orders o
     where o.security_id = v_id and o.type = 'limit' and o.status in ('open', 'partially_filled')
     group by 1, 2
  ), merged as (
    select coalesce(m.side, p.side) as side, coalesce(m.price_e4, p.price_e4) as price_e4,
           coalesce(m.qty, 0) + coalesce(p.qty, 0) as quantity, coalesce(p.n, 0) as players
      from (select * from mm where price_e4 >= 1) m
      full join players p on p.side = m.side and p.price_e4 = m.price_e4
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('price_e4', x.price_e4, 'quantity', x.quantity, 'players', x.players) order by x.price_e4 desc)
                from (select * from merged where side = 'bid' order by price_e4 desc limit v_levels) x), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('price_e4', x.price_e4, 'quantity', x.quantity, 'players', x.players) order by x.price_e4)
                from (select * from merged where side = 'ask' order by price_e4 limit v_levels) x), '[]'::jsonb)
    into v_bids, v_asks;

  return jsonb_build_object('bids', v_bids, 'asks', v_asks);
end;
$$;

create or replace function public.get_security_details(p_ticker text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  s        public.securities;
  c        public.companies;
  q        public.security_quotes;
  b        public.bonds;
  v_rev    bigint;
  v_net    bigint;
  v_desc   text;
  v_news   jsonb;
begin
  perform public.require_player();
  v_id := public.resolve_security(p_ticker);
  if v_id is null then
    perform public.api_error('unknown_security');
  end if;
  select * into s from public.securities where id = v_id;
  select * into q from public.security_quotes where security_id = v_id;
  if s.company_id is not null then
    select * into c from public.companies where id = s.company_id;
    select r.revenue_cents, r.net_income_cents into v_rev, v_net
      from public.company_quarter_reports r
      join public.game_quarters gq on gq.id = r.game_quarter_id
     where r.company_id = c.id and r.published_at is not null and r.published_at <= now()
     order by gq.starts_at desc limit 1;
    v_rev := coalesce(v_rev, round(c.ttm_revenue_cents / 4.0)::bigint);
    v_net := coalesce(v_net, round(c.ttm_net_income_cents / 4.0)::bigint);
    v_desc := c.description;
  elsif s.kind = 'bond' then
    select * into b from public.bonds where security_id = v_id;
    v_desc := 'Staatsanleihe mit ' || b.term_game_years || case when b.term_game_years = 1 then ' Spieljahr' else ' Spieljahren' end
           || ' Laufzeit und ' || replace(to_char(b.coupon_bps / 100.0, 'FM990.00'), '.', ',') || ' % Kupon pro Spieljahr, '
           || 'quartalsweise ausgezahlt. Rückzahlung zum Nennwert bei Fälligkeit.';
  elsif s.kind = 'index' then
    select i.description into v_desc from public.indices i where i.security_id = v_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('published_at', n.published_at, 'headline', n.headline, 'body', n.body)
                            order by n.published_at desc), '[]'::jsonb)
    into v_news
    from (select x.published_at, x.headline, x.body from public.news_items x
           where x.published_at <= now()
             and ((s.company_id is not null and x.company_id = s.company_id) or (s.company_id is null and x.security_id = v_id))
           order by x.published_at desc limit 10) n;

  return jsonb_build_object(
    'ticker',             case when s.kind = 'index' then coalesce((select upper(i.key) from public.indices i where i.security_id = v_id), s.ticker) else s.ticker end,
    'name',               s.name,
    'kind',               s.kind,
    'status',             s.status,
    'description',        v_desc,
    'sector_key',         s.sector_key,
    'size_class',         c.tier,
    'color',              c.brand_color,
    'market_cap_cents',   case when s.kind = 'stock' then q.market_cap_cents end,
    'shares_outstanding', c.shares_outstanding,
    'pe_x100',            case when c.eps_ttm_e4 > 0 then round(q.last_price_e4 * 100.0 / c.eps_ttm_e4)::bigint end,
    'eps_ttm_e4',         c.eps_ttm_e4,
    'dividend_yield_bps', case when c.id is null or c.dividend_policy = 'none' or c.dividend_payout_bps = 0 then null
                               when c.eps_ttm_e4 <= 0 then 0
                               else round(c.eps_ttm_e4::numeric * c.dividend_payout_bps / greatest(1, q.last_price_e4))::integer end,
    'revenue_cents',      v_rev,
    'net_income_cents',   v_net,
    'margin_bps',         case when coalesce(v_rev, 0) > 0 then round(v_net * 10000.0 / v_rev)::integer end,
    'term_game_years',    b.term_game_years,
    'coupon_bps',         b.coupon_bps,
    'matures_at',         b.matures_at,
    'face_value_cents',   b.face_value_cents,
    'news',               v_news);
end;
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
  v_orders    jsonb;
  v_trades    jsonb;
  v_prof      public.profiles;
  v_priv      public.player_private;
  v_level     jsonb;
begin
  v_player := public.require_player();
  select coalesce(sum(a.balance_cents) filter (where a.kind = 'player_cash'), 0),
         coalesce(sum(a.balance_cents) filter (where a.kind = 'player_reserve'), 0)
    into v_cash, v_reserved
    from public.ledger_accounts a where a.owner_player_id = v_player;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ticker', x.ticker, 'name', x.name, 'kind', x.kind, 'quantity', x.quantity,
           'reserved_quantity', x.reserved_quantity, 'avg_price_e4', x.avg_entry_price_e4,
           'last_price_e4', x.last_price_e4, 'market_value_cents', x.mv, 'cost_basis_cents', x.cost_basis_cents,
           'unrealized_pnl_cents', x.mv - x.cost_basis_cents, 'realized_pnl_cents', x.realized_pnl_cents,
           'change_bps', x.change_bps, 'opened_at', x.opened_at)
           order by x.mv desc), '[]'::jsonb),
         coalesce(sum(x.mv), 0)::bigint
    into v_positions, v_value
    from (select s.ticker, s.name, s.kind, p.quantity, p.reserved_quantity, p.avg_entry_price_e4, p.cost_basis_cents,
                 p.realized_pnl_cents, p.opened_at, q.last_price_e4, q.change_bps,
                 public.order_value_cents(p.quantity, q.last_price_e4) as mv
            from public.positions p
            join public.securities s on s.id = p.security_id
            join public.security_quotes q on q.security_id = p.security_id
           where p.player_id = v_player and p.status = 'open' and p.quantity > 0) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'ticker', s.ticker, 'side', o.side, 'type', o.type, 'quantity', o.quantity,
           'filled_quantity', o.filled_quantity, 'limit_price_e4', o.limit_price_e4, 'status', o.status,
           'reserved_cents', o.reserved_cents, 'created_at', o.created_at)
           order by o.created_at desc), '[]'::jsonb)
    into v_orders
    from public.orders o join public.securities s on s.id = o.security_id
   where o.player_id = v_player and o.status in ('open', 'partially_filled');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'ticker', t.ticker, 'side', t.side, 'quantity', t.quantity, 'price_e4', t.price_e4,
           'gross_cents', t.gross_cents, 'fee_cents', t.fee_cents, 'tax_cents', t.tax_cents,
           'realized_pnl_cents', t.realized_pnl_cents, 'xp_awarded', t.xp_awarded, 'executed_at', t.executed_at)
           order by t.executed_at desc), '[]'::jsonb)
    into v_trades
    from (select tr.*, s.ticker from public.trades tr join public.securities s on s.id = tr.security_id
           where tr.player_id = v_player order by tr.executed_at desc limit 50) t;

  select * into v_prof from public.profiles where id = v_player;
  select * into v_priv from public.player_private where player_id = v_player;
  v_level := public.level_progress(v_prof.xp_total);

  return jsonb_build_object(
    'cash_cents',            v_cash,
    'reserved_cents',        v_reserved,
    'positions_value_cents', v_value,
    'total_cents',           v_cash + v_reserved + v_value,
    'loss_pot_cents',        coalesce(v_priv.tax_loss_pot_cents, 0),
    'vault',                 public.vault_status(v_player) - 'accrued_seconds',
    'positions',             v_positions,
    'open_orders',           v_orders,
    'recent_trades',         v_trades,
    'level',                 v_prof.level,
    'xp_total',              v_prof.xp_total,
    'xp_into_level',         (v_level ->> 'xp_into_level')::bigint,
    'xp_for_next',           (v_level ->> 'xp_for_next')::bigint,
    'tutorial_completed',    v_priv.tutorial_completed_at is not null,
    'server_time',           public.game_now());
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.get_market_snapshot()', 'public.get_candles(text, text, integer)', 'public.get_order_book(text, integer)',
    'public.get_security_details(text)', 'public.get_my_portfolio()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduling (only where pg_cron exists). Replaces the edge-function jobs of
-- migration 1600: the market tick runs in Postgres every 5 seconds, everything
-- else once a minute in run_due_jobs(). Unscheduling by name makes this
-- block idempotent.
-- ---------------------------------------------------------------------------
do $$
declare
  j text;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
      raise notice 'pg_cron is not available: skipping NEXA schedules (call public.market_tick() / public.run_due_jobs() yourself)';
      return;
    end if;
    create extension if not exists pg_cron;
  end if;

  foreach j in array array['nexa-tick-runner', 'nexa-quarter-runner', 'nexa-ensure-quarters', 'nexa-maintenance',
                           'nexa-market-tick', 'nexa-due-jobs'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;

  begin
    -- second intervals need pg_cron >= 1.5 (Supabase ships 1.6)
    perform cron.schedule('nexa-market-tick', '5 seconds', 'select public.market_tick()');
  exception when others then
    raise warning 'pg_cron cannot schedule every 5 seconds (%): the market ticks once per minute instead', sqlerrm;
    perform cron.schedule('nexa-market-tick', '* * * * *', 'select public.market_tick()');
  end;
  perform cron.schedule('nexa-due-jobs', '* * * * *', 'select public.run_due_jobs()');
end;
$$;
