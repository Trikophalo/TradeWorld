-- =============================================================================
-- 51 · M1 market: one simulated real day (17 280 ticks of 5 s)
-- =============================================================================
-- Runs on a throwaway copy of the database so that every tick is its own
-- transaction (as with pg_cron) and the main test database is not changed.
-- Reports the daily range per size class and the tick duration.
-- =============================================================================
\set QUIET 1
select current_database() as srcdb \gset
\c postgres
drop database if exists nexa_m1_day;
create database nexa_m1_day template :"srcdb";
\c nexa_m1_day
set client_min_messages = notice;

create table public._day_start as
select q.security_id, q.last_price_e4, clock_timestamp() as started_at,
       date_bin('5 seconds', now(), '2000-01-01 00:00:00+00') + interval '5 seconds' as t0
  from public.security_quotes q;
select max(tick_seq) as seq0 from public.sim_tick_log \gset
select coalesce(nullif(:'seq0', ''), '0')::bigint as seq0 \gset

\o /dev/null
select format('select public.market_tick_at(%L)', (select min(t0) from public._day_start) + (i - 1) * interval '5 seconds')
  from generate_series(1, 17280) i \gexec
\o

select tests.assert(
  (select count(*) from public.sim_tick_log where tick_seq > :seq0) = 17280,
  '17 280 ticks (one real day) ran in ' ||
  (select round(extract(epoch from clock_timestamp() - min(started_at)))::text || ' s' from public._day_start) ||
  ', tick avg ' || (select round(avg(duration_ms), 2) || ' ms, p99 ' ||
                           percentile_cont(0.99) within group (order by duration_ms) || ' ms, max ' || max(duration_ms) || ' ms'
                      from public.sim_tick_log where tick_seq > :seq0));

create table public._day_stats as
select coalesce(c.tier::text, s.kind::text) as cls, s.ticker,
       100.0 * (max(p.price_e4) - min(p.price_e4)) / min(p.price_e4) as range_pct,
       100.0 * greatest(abs(max(p.price_e4)::numeric / st.fair_value_e4 - 1), abs(min(p.price_e4)::numeric / st.fair_value_e4 - 1)) as max_dev_fv_pct,
       min(p.price_e4) as min_price
  from public.price_ticks p
  join public.securities s on s.id = p.security_id
  left join public.companies c on c.id = s.company_id
  left join public.security_sim_state st on st.security_id = s.id
 where p.tick_seq > :seq0
 group by 1, 2, st.fair_value_e4;

select tests.assert(true, 'daily range ' || cls || ': avg ' || round(avg(range_pct), 1) || ' %, min ' || round(min(range_pct), 1)
                    || ' %, max ' || round(max(range_pct), 1) || ' % (' || string_agg(ticker || ' ' || round(range_pct, 1), ', ' order by ticker) || ')'
                    || case when cls in ('bluechip', 'midcap', 'penny') then '; max distance to fair value ' || round(max(max_dev_fv_pct), 1) || ' %' else '' end)
  from public._day_stats group by cls order by cls;

select tests.assert((select min(min_price) > 0 from public._day_stats), 'prices stay above zero all day');
select tests.assert(
  (select count(*) from public.security_quotes q join public.securities s on s.id = q.security_id
    where s.kind in ('stock', 'bond') and s.status = 'listed' and q.bid_e4 < q.ask_e4 and q.bid_e4 > 0) = 19,
  'bid < ask for every stock and bond after a day');
select tests.assert(
  (select avg(range_pct) between 0.5 and 6 from public._day_stats where cls = 'bluechip')
  and (select avg(range_pct) between 1.5 and 14 from public._day_stats where cls = 'midcap')
  and (select avg(range_pct) between 4 and 45 from public._day_stats where cls = 'penny'),
  'average daily range plausible: blue chips 0.5-6 %, mid caps 1.5-14 %, penny stocks 4-45 %');
select tests.assert(
  (select avg(range_pct) from public._day_stats where cls = 'bluechip') < (select avg(range_pct) from public._day_stats where cls = 'midcap')
  and (select avg(range_pct) from public._day_stats where cls = 'midcap') < (select avg(range_pct) from public._day_stats where cls = 'penny'),
  'penny stocks are clearly more volatile than mid caps, mid caps more than blue chips');
select tests.assert(
  (select max(max_dev_fv_pct) < 12 from public._day_stats where cls = 'bluechip')
  and (select max(max_dev_fv_pct) < 25 from public._day_stats where cls = 'midcap')
  and (select max(max_dev_fv_pct) < 50 from public._day_stats where cls = 'penny'),
  'prices stay in a band around the fair value (blue chips < 12 %, mid caps < 25 %, penny stocks < 50 %)');
select tests.assert(
  not exists (
    select 1 from (
      select c.bucket_start, lead(c.bucket_start) over (partition by c.security_id order by c.bucket_start) as nxt
        from public.candles c where c.interval = '1m') x
     where x.nxt is not null and x.nxt - x.bucket_start <> interval '1 minute')
  and not exists (select 1 from public.candles c where c.high_e4 < greatest(c.open_e4, c.close_e4) or c.low_e4 > least(c.open_e4, c.close_e4)),
  'after a day of ticks: 1m candles contiguous from history into live data, OHLC consistent');
select tests.assert(
  (select count(*) from public.candles c where c.interval = '1y' and c.bucket_start > now()) = 20,
  'the next game year (08:00 Berlin) opened a new 1y candle for every security');

select tests.assert(
  (select sum(balance_cents) from public.ledger_accounts where system_key is distinct from 'world_genesis')
    = public.config_bigint('money', '{totalSupplyCents}', -1)
  and (select balance_cents from public.ledger_accounts where system_key = 'mint') = 0
  and (select sum(amount_cents) from public.ledger_entries) = 0,
  'closed money system: after a simulated day all accounts except world_genesis still sum to the total supply');

\c postgres
drop database nexa_m1_day;
\c :"srcdb"
