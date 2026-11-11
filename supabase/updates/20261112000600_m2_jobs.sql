-- ===== idempotent copy of migrations/20261112000600_m2_jobs.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M2a · 0600 · Bootstrap and scheduled jobs for the closed money
--                     system and the rich list
-- =============================================================================

create or replace function public.market_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz := public.game_now();
  v_bell     timestamptz := public.trading_day_start(public.game_now());
  v_state    jsonb;
  v_fv       integer;
  v_backfill jsonb;
  v_redeemed integer;
  v_issued   integer;
  v_policy   integer;
  v_bonds    jsonb := coalesce(public.config_jsonb('bonds'), '{}'::jsonb);
  v_qpy      double precision := greatest(1, public.config_double('bonds', '{couponsPerGameYear}', 4));
  v_qsec     double precision := public.config_double('time', '{quarterHours}', 6) * 3600;
  v_genesis  jsonb;
  v_tycoons  jsonb;
begin
  perform pg_advisory_xact_lock(7311001);
  perform public.ensure_game_quarters(3);
  select r.state into v_state from public.sim_runtime r where r.id for update;

  update public.security_sim_state st
     set ema_fast = coalesce(st.ema_fast, q.last_price_e4),
         ema_slow = coalesce(st.ema_slow, q.last_price_e4)
    from public.security_quotes q
   where q.security_id = st.security_id and (st.ema_fast is null or st.ema_slow is null);

  if v_state ->> 'fair_values_at' is null then
    v_fv := public.recompute_fair_values();
    update public.sim_runtime set state = state || jsonb_build_object('fair_values_at', now()) where id;
  end if;

  -- closed money system: the one-time genesis (re-sources money that existed before)
  v_genesis  := public.money_genesis();
  v_redeemed := public.redeem_matured_bonds(v_now);
  v_issued   := public.ensure_bond_series();

  -- before the history is generated: bonds start at their yield-implied price
  if not exists (select 1 from public.candles limit 1) then
    v_policy := coalesce((select cb.policy_rate_bps from public.central_bank_state cb where cb.id),
                         public.config_double('centralBank', '{startRateBps}', 300)::integer);
    update public.security_quotes q
       set last_price_e4 = x.p, bid_e4 = greatest(1, x.p - x.h), ask_e4 = x.p + greatest(1, x.h),
           prev_close_e4 = x.p, day_open_e4 = x.p, day_high_e4 = x.p, day_low_e4 = x.p, yield_bps = x.y
      from (select b.security_id,
                   greatest(1, round(public.bond_clean_price(b.coupon_bps,
                                 public.bond_yield_bps(v_policy, y.periods / v_qpy, v_bonds), y.periods, v_qpy)
                               * b.face_value_cents * 100))::bigint as p,
                   round(b.face_value_cents * 100 * coalesce(st.spread_bps, 10) / 20000.0)::bigint as h,
                   public.bond_yield_bps(v_policy, y.periods / v_qpy, v_bonds) as y
              from public.bonds b
              join public.securities s on s.id = b.security_id and s.status = 'listed'
              left join public.security_sim_state st on st.security_id = b.security_id
             cross join lateral (select extract(epoch from (b.matures_at - v_now)) / v_qsec as periods) y
             where b.matures_at > v_now) x
     where q.security_id = x.security_id;

    -- profitable stocks without any trade start at their fundamental fair value
    -- (the seed prices used slightly different sector multiples), and the
    -- NEXA 30 divisor is re-based so that the index starts at its base value
    update public.security_quotes q
       set last_price_e4 = st.fair_value_e4,
           bid_e4 = greatest(1, st.fair_value_e4 - x.h), ask_e4 = st.fair_value_e4 + greatest(1, x.h),
           prev_close_e4 = st.fair_value_e4, day_open_e4 = st.fair_value_e4,
           day_high_e4 = st.fair_value_e4, day_low_e4 = st.fair_value_e4,
           market_cap_cents = public.div_round_half_even(c.shares_outstanding::numeric * st.fair_value_e4, 100)
      from public.security_sim_state st
      join public.securities s on s.id = st.security_id and s.kind = 'stock' and s.status = 'listed'
      join public.companies c on c.id = s.company_id and c.ttm_net_income_cents > 0
     cross join lateral (select round(st.fair_value_e4
                           * public.config_double('trading', array['spread', 'halfSpreadBps', c.tier::text], 15) / 10000.0)::bigint as h) x
     where q.security_id = st.security_id and q.last_price_e4 <> st.fair_value_e4
       and not exists (select 1 from public.trades t where t.security_id = st.security_id);
    update public.security_sim_state st
       set ema_fast = q.last_price_e4, ema_slow = q.last_price_e4
      from public.security_quotes q where q.security_id = st.security_id;
    update public.indices i
       set divisor = x.cap / i.base_value_e4
      from (select m.index_security_id, sum(c.shares_outstanding::numeric * q.last_price_e4)::double precision / 100 as cap
              from public.index_memberships m
              join public.securities s on s.id = m.member_security_id
              join public.companies c on c.id = s.company_id
              join public.security_quotes q on q.security_id = s.id
             where m.left_at is null group by m.index_security_id) x
     where i.security_id = x.index_security_id and x.cap > 0;
    update public.security_quotes q
       set last_price_e4 = i.base_value_e4, prev_close_e4 = i.base_value_e4, day_open_e4 = i.base_value_e4,
           day_high_e4 = i.base_value_e4, day_low_e4 = i.base_value_e4, change_bps = 0
      from public.indices i where q.security_id = i.security_id;
  end if;
  v_backfill := public.backfill_price_history();

  -- day statistics since the last 22:00 bell, from the (backfilled) 5m candles
  if v_state ->> 'day_start' is null or (v_backfill ->> 'backfilled')::boolean is true then
    update public.security_quotes q
       set prev_close_e4 = coalesce((select c.close_e4 from public.candles c
                                      where c.security_id = q.security_id and c.interval = '5m' and c.bucket_start < v_bell
                                      order by c.bucket_start desc limit 1), q.prev_close_e4, q.last_price_e4),
           day_open_e4   = coalesce((select c.open_e4 from public.candles c
                                      where c.security_id = q.security_id and c.interval = '5m' and c.bucket_start >= v_bell
                                      order by c.bucket_start limit 1), q.last_price_e4),
           day_high_e4   = greatest(q.last_price_e4, (select max(c.high_e4) from public.candles c
                                      where c.security_id = q.security_id and c.interval = '5m' and c.bucket_start >= v_bell)),
           day_low_e4    = least(q.last_price_e4, (select min(c.low_e4) from public.candles c
                                      where c.security_id = q.security_id and c.interval = '5m' and c.bucket_start >= v_bell)),
           day_volume_e6 = coalesce((select sum(c.volume_e6) from public.candles c
                                      where c.security_id = q.security_id and c.interval = '5m' and c.bucket_start >= v_bell), 0);
    update public.security_quotes q
       set change_bps = round((q.last_price_e4 - q.prev_close_e4) * 10000.0 / greatest(1, q.prev_close_e4))::integer
     where q.prev_close_e4 is not null;
    update public.sim_runtime set state = state || jsonb_build_object('day_start', v_bell) where id;
  end if;

  -- rich list: AI tycoons (once, after the genesis and at current prices) and a first snapshot
  v_tycoons := public.seed_rich_tycoons();
  if not exists (select 1 from public.rich_list_snapshots) then
    perform public.rich_list_snapshot(true);
  end if;

  return jsonb_build_object('fair_values', v_fv, 'bonds_redeemed', v_redeemed, 'bonds_issued', v_issued,
                            'backfill', v_backfill, 'day_start', v_bell, 'genesis', v_genesis, 'tycoons', v_tycoons);
end;
$$;
comment on function public.market_bootstrap() is 'Idempotent world setup: calendar, EMAs, fair values (once), money genesis (once), bond series, price history (only without candles), day statistics, AI tycoons (once), first rich list snapshot. Run by setup/update scripts and run_due_jobs().';


create or replace function public.run_due_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz;
  v_result   jsonb := '{}'::jsonb;
  v_closed   jsonb := '[]'::jsonb;
  v_latest   bigint;
  q          record;
  v_run      bigint;
begin
  -- waits for a running tick (ticks only try the lock and skip)
  perform pg_advisory_xact_lock(7311001);
  v_now := public.game_now();
  perform public.ensure_game_quarters(3);

  if not exists (select 1 from public.candles limit 1) or not public.money_genesis_done()
     or not exists (select 1 from public.rich_tycoons) then
    v_result := v_result || jsonb_build_object('bootstrap', public.market_bootstrap());
  end if;

  -- first run on a database: older quarters are skipped, only the latest ended one is closed
  if not exists (select 1 from public.job_runs j where j.job_name = 'quarter_close') then
    select gq.id into v_latest from public.game_quarters gq
     where gq.ends_at <= v_now and gq.status <> 'closed' order by gq.ends_at desc limit 1;
    for q in select gq.id from public.game_quarters gq
              where gq.ends_at <= v_now and gq.status <> 'closed' and gq.id <> coalesce(v_latest, -1)
    loop
      update public.game_quarters set status = 'closed', closed_at = now() where id = q.id;
      insert into public.job_runs (job_name, run_key, status, finished_at, details)
      values ('quarter_close', q.id::text, 'succeeded', now(), '{"skipped": "before_first_run"}'::jsonb)
      on conflict do nothing;
    end loop;
  end if;

  for q in select gq.id from public.game_quarters gq
            where gq.ends_at <= v_now and gq.status <> 'closed'
            order by gq.ends_at limit 8
  loop
    v_closed := v_closed || public.close_game_quarter(q.id);
  end loop;
  v_result := v_result || jsonb_build_object('quarters', v_closed);

  -- bonds that matured between quarter closes (or after a downtime)
  if exists (select 1 from public.bonds bd join public.securities s on s.id = bd.security_id
              where s.status = 'listed' and bd.matures_at <= v_now) then
    v_result := v_result || jsonb_build_object('bonds_redeemed', public.redeem_matured_bonds(v_now));
  end if;
  v_result := v_result || jsonb_build_object('bonds_issued', public.ensure_bond_series());

  -- rich list snapshot every richList.snapshotMinutes (rank news, 24 h changes, state missions)
  v_result := v_result || jsonb_build_object('rich_list', public.rich_list_snapshot(false));

  -- daily maintenance (first run per UTC day)
  insert into public.job_runs (job_name, run_key) values ('maintenance', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'))
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is not null then
    v_result := v_result || jsonb_build_object('maintenance', public.run_maintenance());
    -- price_ticks: keep about one day (candles hold the history), cron log: one day
    perform public.maintain_price_tick_partitions(3, 1);
    if to_regclass('cron.job_run_details') is not null then
      begin
        execute 'delete from cron.job_run_details where end_time < now() - interval ''1 day''';
      exception when others then
        raise warning 'NEXA: could not prune cron.job_run_details: %', sqlerrm;
      end;
    end if;
    delete from public.job_runs j where j.job_name = 'maintenance' and j.started_at < now() - interval '30 days';
    update public.job_runs set status = 'succeeded', finished_at = now() where id = v_run;
  end if;
  return v_result;
end;
$$;
comment on function public.run_due_jobs() is 'pg_cron every minute: calendar, lazy bootstrap, due quarter closes, bond maturities and new series, rich list snapshots, daily maintenance.';

do $$
declare
  f text;
begin
  foreach f in array array['public.market_bootstrap()', 'public.run_due_jobs()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
