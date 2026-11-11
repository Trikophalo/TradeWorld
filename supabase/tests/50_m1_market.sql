-- =============================================================================
-- 50 · M1 market: bootstrap, price history, ticks, read RPCs
-- =============================================================================
-- Runs after 10-40. Loads the generated game_config (the earlier files work
-- without it), bootstraps the market (backfill only if no candles exist yet;
-- in NEXA_MIGRATIONS_UPTO mode update-to-latest.sql already did it).
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\ir ../seeds/game_config.sql

-- helpers used by the M1 test files ---------------------------------------------
create or replace function tests.throws_key(p_sql text, p_key text, p_message text) returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_msg = p_key then
      raise notice 'ok - % (% %)', p_message, v_state, v_msg;
      return;
    end if;
    raise exception 'ASSERTION FAILED: % - expected error "%" but got "%" (%)', p_message, p_key, v_msg, v_state;
  end;
  raise exception 'ASSERTION FAILED: % - statement succeeded but should fail with "%"', p_message, p_key;
end;
$$;

-- creates a player through the real sign-up trigger
create or replace function tests.signup(p_id uuid, p_nickname text) returns uuid
language plpgsql
as $$
begin
  insert into public.invite_codes (code, max_uses) values ('M1-TESTS', 100) on conflict do nothing;
  insert into auth.users (id, email, raw_user_meta_data)
  values (p_id, lower(p_nickname) || '@m1.test',
          jsonb_build_object('invite_code', 'M1-TESTS', 'age_confirmed', true, 'nickname', p_nickname));
  return p_id;
end;
$$;

-- sets level and matching total XP directly (superuser only)
create or replace function tests.set_level(p_player uuid, p_level integer) returns void
language sql
as $$
  update public.profiles
     set level = p_level,
         xp_total = public.xp_total_for_level(p_level)
   where id = p_player;
$$;
grant execute on all functions in schema tests to public;

-- bootstrap ------------------------------------------------------------------------
select public.market_bootstrap() as boot \gset
\echo '   bootstrap:' :boot
select tests.assert(public.market_bootstrap() ->> 'backfill' like '%candles_exist%', 'market_bootstrap() is idempotent (no second backfill)');

-- price history ----------------------------------------------------------------------
select tests.assert(
  (select count(*) from public.securities s where s.status = 'listed' and s.kind in ('stock', 'bond', 'index')
      and (select count(*) from public.candles c where c.security_id = s.id and c.interval = '1m') >= 360
      and (select count(*) from public.candles c where c.security_id = s.id and c.interval = '5m') >= 576
      and (select count(*) from public.candles c where c.security_id = s.id and c.interval = '1h') >= 720
      and (select count(*) from public.candles c where c.security_id = s.id and c.interval = '1q') >= 120
      and (select count(*) from public.candles c where c.security_id = s.id and c.interval = '1y') >= 365) = 20,
  'backfill: every stock, bond and NEXA 30 has 6 h of 1m, 2 days of 5m, 30 days of 1h, 120 quarters and 365 game years');
select 'candle rows per interval: ' || string_agg(i || '=' || n, ', ' order by i) as counts
  from (select interval::text as i, count(*) as n from public.candles group by 1) x \gset
\echo '  ' :counts
select tests.assert(
  not exists (select 1 from public.candles c
               where c.high_e4 < greatest(c.open_e4, c.close_e4) or c.low_e4 > least(c.open_e4, c.close_e4) or c.low_e4 < 1),
  'all candles are consistent: high >= open/close >= low >= 1');
select tests.assert(
  not exists (
    select 1 from (
      select c.interval, c.bucket_start,
             lead(c.bucket_start) over (partition by c.security_id, c.interval order by c.bucket_start) as nxt
        from public.candles c where c.interval in ('1m', '5m', '1h')) x
     where x.nxt is not null
       and x.nxt - x.bucket_start <> case x.interval when '1m' then interval '1 minute'
                                                     when '5m' then interval '5 minutes' else interval '1 hour' end),
  '1m, 5m and 1h candles are contiguous (no missing buckets)');
select tests.assert(
  not exists (
    select 1 from (
      select c.interval, c.bucket_start,
             lead(c.bucket_start) over (partition by c.security_id, c.interval order by c.bucket_start) as nxt
        from public.candles c where c.interval in ('1q', '1y')) x
     where x.nxt is not null
       and (x.nxt - x.bucket_start) not between
           case x.interval when '1q' then interval '5 hours' else interval '23 hours' end and
           case x.interval when '1q' then interval '7 hours' else interval '25 hours' end),
  'quarter and game-year candles are contiguous (6 h / 24 h, DST aware)');
select tests.assert(
  not exists (
    select 1 from public.candles c
      join (select security_id, interval, max(bucket_start) as b from public.candles group by 1, 2) l
        on l.security_id = c.security_id and l.interval = c.interval and l.b = c.bucket_start
      join public.security_quotes q on q.security_id = c.security_id
     where c.close_e4 <> q.last_price_e4),
  'the newest candle of every interval closes at the current price');
select tests.assert(
  (select count(*) from public.security_quotes q join public.securities s on s.id = q.security_id
    where s.status = 'listed' and q.prev_close_e4 > 0 and q.day_high_e4 >= q.last_price_e4 and q.day_low_e4 <= q.last_price_e4) = 20,
  'quotes have prev close and day high/low after bootstrap');
select tests.assert(
  (select abs(q.last_price_e4 - i.base_value_e4) <= 1
     from public.indices i join public.security_quotes q on q.security_id = i.security_id where i.key = 'NEXA30'),
  'NEXA 30 starts at its base value (1000 points)');

-- ticks ------------------------------------------------------------------------------
select r.tick_seq as seq0 from public.sim_runtime r \gset
select public.market_tick() as t1 \gset
select public.market_tick() as t2 \gset
select public.market_tick() as t3 \gset
\echo '   tick:' :t3
select tests.assert((select r.tick_seq from public.sim_runtime r) = :seq0 + 3, 'market_tick() advances tick_seq');
select tests.assert(
  (select count(*) from public.security_quotes q join public.securities s on s.id = q.security_id
    where s.status = 'listed' and s.kind in ('stock', 'bond') and q.last_price_e4 > 0 and q.bid_e4 > 0 and q.bid_e4 < q.ask_e4
      and q.bid_e4 <= q.last_price_e4 and q.ask_e4 >= q.last_price_e4 and q.tick_seq = :seq0 + 3) = 19,
  'after ticks: every stock and bond has price > 0 and bid < ask around the last price');
select tests.assert(
  (select count(*) from public.price_ticks where tick_seq = :seq0 + 3) = 20,
  'one price tick per security (15 stocks, 4 bonds, NEXA 30) and tick');
select tests.assert(
  (select count(*) from public.sim_tick_log where tick_seq > :seq0) = 3
  and (select max(duration_ms) from public.sim_tick_log where tick_seq > :seq0) < 1000,
  'tick log written; ticks take ' || (select string_agg(duration_ms::text || ' ms', ', ' order by tick_seq) from public.sim_tick_log where tick_seq > :seq0));
select tests.assert(
  (select q.last_price_e4 from public.security_quotes q join public.indices i on i.security_id = q.security_id)
  = (select round(sum(c.shares_outstanding::numeric * q.last_price_e4) / 100 / (select divisor from public.indices)::numeric)
       from public.index_memberships m join public.securities s on s.id = m.member_security_id
       join public.companies c on c.id = s.company_id join public.security_quotes q on q.security_id = s.id
      where m.left_at is null),
  'NEXA 30 = sum(shares x price) / divisor');

-- paused: no tick
update public.sim_runtime set is_paused = true;
select tests.assert(public.market_tick() ->> 'skipped' = 'paused', 'market_tick() does nothing while paused');
update public.sim_runtime set is_paused = false;

-- session: after hours quotes are wider and the 22:00 bell sets the previous close (rolled back)
begin;
select tests.assert(
  (public.market_tick_at(((public.game_day(now() + interval '1 day')::timestamp + interval '12 hours') at time zone 'Europe/Berlin')) ->> 'session') = 'regular'
  and public.market_session_at(((current_date::timestamp + interval '23 hours') at time zone 'Europe/Berlin')) = 'after_hours',
  'session: 12:00 Berlin is regular, 23:00 after hours');
create temp table _spread_regular as
  select q.security_id, (q.ask_e4 - q.bid_e4)::numeric / q.last_price_e4 as rel from public.security_quotes q
    join public.securities s on s.id = q.security_id where s.kind = 'stock';
select public.market_tick_at(((public.game_day(now() + interval '1 day')::timestamp + interval '23 hours 30 minutes') at time zone 'Europe/Berlin')) as ah \gset
select tests.assert(:'ah'::jsonb ->> 'session' = 'after_hours' and (:'ah'::jsonb ->> 'new_day')::boolean,
  'a tick after 22:00 runs after hours and starts a new trading day');
select tests.assert(
  (select bool_and((q.ask_e4 - q.bid_e4)::numeric / q.last_price_e4 > r.rel * 2)
     from public.security_quotes q join _spread_regular r on r.security_id = q.security_id),
  'after hours the spread of every stock is wider (multiplier 3)');
select tests.assert(
  (select count(*) from public.security_quotes q join public.securities s on s.id = q.security_id
    where s.status = 'listed' and q.day_volume_e6 >= 0 and q.day_open_e4 = q.last_price_e4) = 20,
  'the new trading day opens at the first price after the bell');
rollback;

-- read RPCs as a player --------------------------------------------------------------
select tests.login_as('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.get_market_snapshot() as snap \gset
select tests.assert(
  (:'snap'::jsonb ?& array['server_time', 'tick_seq', 'session', 'paused', 'policy_rate_bps', 'index', 'securities'])
  and (:'snap'::jsonb -> 'index' ->> 'ticker') = 'NEXA30'
  and (:'snap'::jsonb ->> 'policy_rate_bps')::int = 300
  and (:'snap'::jsonb ->> 'session') in ('regular', 'after_hours'),
  'get_market_snapshot(): top-level contract, index NEXA30, policy rate 3 %');
select tests.assert(
  (select count(*) filter (where e ->> 'kind' = 'stock') = 15 and count(*) filter (where e ->> 'kind' = 'bond') = 4
          and bool_and(e ?& array['id', 'ticker', 'name', 'kind', 'sector_key', 'size_class', 'last_price_e4', 'bid_e4', 'ask_e4',
                                  'prev_close_e4', 'change_bps', 'day_high_e4', 'day_low_e4', 'day_volume_e6', 'market_cap_cents',
                                  'term_game_years', 'coupon_bps', 'yield_bps', 'matures_at', 'face_value_cents'])
          and bool_and(e ->> 'kind' <> 'stock' or (e ->> 'sector_key' in ('tech', 'retail', 'energy', 'pharma', 'logistics')
                                                    and e ->> 'size_class' in ('bluechip', 'midcap', 'penny')
                                                    and (e ->> 'market_cap_cents')::bigint > 0))
          and bool_and(e ->> 'kind' <> 'bond' or ((e ->> 'yield_bps')::int between 100 and 600
                                                   and (e ->> 'face_value_cents')::bigint = 10000 and e ->> 'size_class' is null))
     from jsonb_array_elements(:'snap'::jsonb -> 'securities') e),
  'get_market_snapshot(): 15 stocks and 4 bonds with every contract field');

select public.get_candles('NEXA30', '1h', 10) as c \gset
select tests.assert(
  jsonb_array_length(:'c'::jsonb) = 10
  and (select bool_and(z.t > z.p) from (select (x ->> 't')::bigint as t, lag((x ->> 't')::bigint) over (order by o) as p
                                            from jsonb_array_elements(:'c'::jsonb) with ordinality a(x, o)) z where z.p is not null)
  and (select bool_and(x ?& array['t', 'o', 'h', 'l', 'c', 'v']) from jsonb_array_elements(:'c'::jsonb) x),
  'get_candles(NEXA30, 1h, 10): 10 candles, ascending, {t,o,h,l,c,v}');
select tests.assert(jsonb_array_length(public.get_candles('kls', '1y')) = 300, 'get_candles() default limit 300, ticker case-insensitive');
select tests.assert(jsonb_array_length(public.get_candles('NXB10', '1m', 5)) = 5, 'get_candles() works for bonds');
select tests.throws_key($$select public.get_candles('KLS', '2m')$$, 'invalid_interval', 'get_candles: unknown interval');
select tests.throws_key($$select public.get_candles('NOPE', '1m')$$, 'unknown_security', 'get_candles: unknown ticker');

select public.get_order_book('KLS') as ob \gset
select tests.assert(
  jsonb_array_length(:'ob'::jsonb -> 'bids') = 8 and jsonb_array_length(:'ob'::jsonb -> 'asks') = 8
  and ((:'ob'::jsonb -> 'bids' -> 0 ->> 'price_e4')::bigint < (:'ob'::jsonb -> 'asks' -> 0 ->> 'price_e4')::bigint)
  and (select bool_and((b ->> 'quantity_e6')::bigint >= 1000000 and (b ->> 'players')::int = 0) from jsonb_array_elements(:'ob'::jsonb -> 'bids') b)
  and (select (array_agg((b ->> 'price_e4')::bigint))[1] > (array_agg((b ->> 'price_e4')::bigint))[8] from jsonb_array_elements(:'ob'::jsonb -> 'bids') b)
  and (select (array_agg((b ->> 'price_e4')::bigint))[1] < (array_agg((b ->> 'price_e4')::bigint))[8] from jsonb_array_elements(:'ob'::jsonb -> 'asks') b),
  'get_order_book(KLS): 8 market-maker levels per side, best prices first, bid < ask');
select tests.assert(jsonb_array_length(public.get_order_book('NXB05', 3) -> 'asks') = 3, 'get_order_book() for bonds with p_levels');

select public.get_security_details('VLT') as d \gset
select tests.assert(
  (:'d'::jsonb ?& array['ticker', 'name', 'kind', 'description', 'sector_key', 'size_class', 'color', 'market_cap_cents',
                        'shares_outstanding', 'pe_x100', 'dividend_yield_bps', 'revenue_cents', 'net_income_cents', 'margin_bps', 'news'])
  and :'d'::jsonb ->> 'color' ~ '^#[0-9A-Fa-f]{6}$'
  and (:'d'::jsonb ->> 'pe_x100')::bigint between 500 and 3000
  and (:'d'::jsonb ->> 'dividend_yield_bps')::int > 0
  and (:'d'::jsonb ->> 'revenue_cents')::bigint > 0,
  'get_security_details(VLT): fundamentals, brand colour, P/E, dividend yield');
select tests.assert(
  (public.get_security_details('NXB02') ->> 'kind') = 'bond' and (public.get_security_details('NXB02') ->> 'description') like 'Staatsanleihe%'
  and (public.get_security_details('NEXA30') ->> 'ticker') = 'NEXA30',
  'get_security_details() for bonds and the index');
reset role;
