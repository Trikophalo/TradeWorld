-- =============================================================================
-- 61 · M3c: slower first levels (ADR-055) and player-driven markets (ADR-056)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

-- =============================================================================
-- A. Levels
-- =============================================================================
select tests.assert(
  public.xp_for_next_level(1) = 100 and public.xp_for_next_level(2) = 707 and public.xp_for_next_level(10) = 7906
  and public.xp_total_for_level(1) = 0 and public.xp_total_for_level(2) = 100 and public.xp_total_for_level(3) = 807
  and public.xp_total_for_level(6) = 6901
  and public.level_for_xp(99) = 1 and public.level_for_xp(100) = 2 and public.level_for_xp(806) = 2
  and public.level_for_xp(807) = 3
  and (public.level_progress(900) ->> 'xp_into_level')::int = 93 and (public.level_progress(900) ->> 'xp_for_next')::int = 1299,
  'curve (ADR-055): 100 XP to level 2, then round(250 x level^1.5); level_progress / level_for_xp agree');

\set l '''0b3c3c3c-0000-4000-8000-0000000000a1'''
\set m '''0b3c3c3c-0000-4000-8000-0000000000a2'''
select tests.signup(:l, 'Lena_Level') is not null and tests.signup(:m, 'Max_Mehr') is not null as ok \gset
-- Lena reached level 6 under the old curve (100 x n^1.5 for n = 1..5 = 2821 XP), Max is far into level 6
update public.profiles set level = 6, xp_total = 2821 where id = :l;
update public.profiles set level = 6, xp_total = 7500 where id = :m;
insert into public.player_skill_points (player_id, free_points) values (:l, 5), (:m, 5)
on conflict (player_id) do update set free_points = 5;
select public.keep_levels_after_curve_change() as raised1 \gset
select public.keep_levels_after_curve_change() as raised2 \gset
select tests.assert(
  (select level = 6 and xp_total = 6901 from public.profiles where id = :l)
  and (select level = 6 and xp_total = 7500 from public.profiles where id = :m)
  and :raised1 >= 1 and :raised2 = 0
  and (select bool_and(free_points = 5) from public.player_skill_points where player_id in (:l, :m)),
  'nobody loses a level: xp_total raised to the new level-6 threshold (6901), higher totals untouched, idempotent, skill points unchanged');
select public.grant_xp(:l, 'mission', 10, 'test:m3c:level') as gx \gset
select tests.assert(
  (select level = 6 and xp_total = 6921 from public.profiles where id = :l)
  and (select free_points from public.player_skill_points where player_id = :l) = 5,
  'grant_xp() after the change: level stays 6, no extra skill points');
update public.profiles set xp_total = 0 where id = :m;
select public.grant_xp(:m, 'mission', 10, 'test:m3c:level') as gx2 \gset
select tests.assert((select level from public.profiles where id = :m) = 6, 'grant_xp() never lowers a level');
select tests.assert(
  (select xp_to_next from public.levels where level = 2) = 707 and (select xp_cumulative from public.levels where level = 6) = 6901,
  'reference table levels follows the new curve');

-- =============================================================================
-- B. Player-driven markets
-- =============================================================================
-- the penny stock with the least player holdings
select s.id as sec, s.ticker as tkr
  from public.securities s join public.companies c on c.id = s.company_id
 where s.kind = 'stock' and s.status = 'listed' and c.tier = 'penny'
 order by coalesce((select sum(p.quantity_e6) from public.positions p where p.security_id = s.id and p.status = 'open'), 0), s.ticker
 limit 1 \gset
select ((public.game_day(now() + interval '2 days')::timestamp + interval '10 hours') at time zone 'Europe/Berlin') as t0 \gset

create or replace function tests.neutral(p_sec uuid) returns void language sql as $$
  update public.security_quotes q
     set last_price_e4 = st.fair_value_e4, bid_e4 = st.fair_value_e4 - greatest(1, st.fair_value_e4 / 500),
         ask_e4 = st.fair_value_e4 + greatest(1, st.fair_value_e4 / 500)
    from public.security_sim_state st where st.security_id = q.security_id and q.security_id = p_sec;
  update public.security_sim_state
     set sentiment = 0, ema_fast = fair_value_e4, ema_slow = fair_value_e4, maker_inventory = 0,
         pending_player_flow_e6 = 0, pending_player_volume_e6 = 0, player_activity = 0
   where security_id = p_sec $$;
create table if not exists tests.snap_quotes as select * from public.security_quotes with no data;
create table if not exists tests.snap_state as select * from public.security_sim_state with no data;
create or replace function tests.snap_save(p_sec uuid) returns void language sql as $$
  delete from tests.snap_quotes; delete from tests.snap_state;
  insert into tests.snap_quotes select * from public.security_quotes where security_id = p_sec;
  insert into tests.snap_state select * from public.security_sim_state where security_id = p_sec $$;
create or replace function tests.snap_restore(p_sec uuid) returns void language sql as $$
  update public.security_quotes q set last_price_e4 = s.last_price_e4, bid_e4 = s.bid_e4, ask_e4 = s.ask_e4
    from tests.snap_quotes s where q.security_id = p_sec and s.security_id = p_sec;
  update public.security_sim_state st
     set sentiment = s.sentiment, ema_fast = s.ema_fast, ema_slow = s.ema_slow, maker_inventory = s.maker_inventory,
         pending_player_flow_e6 = s.pending_player_flow_e6, pending_player_volume_e6 = s.pending_player_volume_e6,
         player_activity = s.player_activity, price_deviation = s.price_deviation
    from tests.snap_state s where st.security_id = p_sec and s.security_id = p_sec $$;
-- runs n ticks from p_start (5 s apart) and returns the log returns of one security
create or replace function tests.run_ticks(p_sec uuid, p_start timestamptz, p_n integer, p_activity double precision default null)
returns double precision[] language plpgsql as $$
declare
  v_prev bigint;
  v_now  bigint;
  v_out  double precision[] := '{}';
  i      integer;
begin
  for i in 1 .. p_n loop
    if p_activity is not null then
      update public.security_sim_state set player_activity = p_activity where security_id = p_sec;
    end if;
    select last_price_e4 into v_prev from public.security_quotes where security_id = p_sec;
    perform public.market_tick_at(p_start + (i - 1) * interval '5 seconds');
    select last_price_e4 into v_now from public.security_quotes where security_id = p_sec;
    v_out := v_out || ln(v_now::double precision / v_prev);
  end loop;
  return v_out;
end;
$$;
create or replace function tests.set_cfg(p_key text, p_path text[], p_value jsonb) returns void language sql as $$
  update public.game_config set value = jsonb_set(value, p_path, p_value) where key = p_key $$;
grant execute on all functions in schema tests to public;

select public.config_jsonb('aiInvestors', '{tickNoiseScale}') as noise_cfg \gset
update public.sim_runtime set is_paused = false;

-- a buyer with 50.000 EUR
\set b '''0b3c3c3c-0000-4000-8000-0000000000b1'''
select tests.signup(:b, 'Bea_Boerse') is not null as ok \gset
select tests.set_level(:b, 5);
select public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(:b, 'player_cash'),
  5000000, 'transfer', 'Test-Kapital', 'player', :b, 'test:m3c:buyer') is not null as ok \gset

-- 1. a 10.000 EUR market buy moves a penny stock by about 2 % at the next tick (noise off)
select tests.set_cfg('aiInvestors', '{tickNoiseScale}', '0');
select tests.neutral(:'sec');
select last_price_e4 as p0 from public.security_quotes where security_id = :'sec' \gset
select tests.login_as('authenticated', :b);
select public.place_order(gen_random_uuid(), :'tkr', 'buy', 'market', null, null, 1000000) as buy \gset
reset role;
select pending_player_volume_e6 as pvol, pending_player_flow_e6 as pflow from public.security_sim_state where security_id = :'sec' \gset
select (tests.run_ticks(:'sec', :'t0'::timestamptz, 1))[1] as r1 \gset
select player_activity as act1, pending_player_volume_e6 as pvol1 from public.security_sim_state where security_id = :'sec' \gset
select tests.assert(:pvol::bigint > 0 and :pvol::bigint = :pflow::bigint,
  'execute_fill() records the gross player volume next to the net flow');
select tests.assert(:r1::double precision between 0.018 and 0.0225,
  'a 10.000 EUR market buy moves the penny stock ' || :'tkr' || ' by ' || round(:r1::numeric * 100, 2) || ' % at the next tick (target 2 %)');
select tests.assert(:act1::double precision between 900000 and 1100000 and :pvol1::bigint = 0,
  'player activity: ' || round(:act1::numeric) || ' cents after the tick, pending volume consumed');

-- 2. buy and hold keeps a premium: the same 200 ticks with and without the holdings premium (noise off)
select tests.snap_save(:'sec');
select (select sum(x) from unnest(tests.run_ticks(:'sec', :'t0'::timestamptz + interval '10 minutes', 200)) x) as g_hold \gset
select tests.snap_restore(:'sec');
select tests.set_cfg('trading', '{playerImpact,maxHoldingsPremium}', '0');
select (select sum(x) from unnest(tests.run_ticks(:'sec', :'t0'::timestamptz + interval '40 minutes', 200)) x) as g_ctrl \gset
select tests.set_cfg('trading', '{playerImpact,maxHoldingsPremium}', '0.6');
select tests.assert(:g_hold::double precision > :g_ctrl::double precision + 0.006 and :g_hold::double precision > 0,
  'buy and hold: after 200 ticks ' || round(:g_hold::numeric * 100, 2) || ' % vs. ' || round(:g_ctrl::numeric * 100, 2)
  || ' % without the holdings premium');

-- 3. a busy security has weaker AI traders: less noise (noise on)
select tests.set_cfg('aiInvestors', '{tickNoiseScale}', :'noise_cfg'::jsonb);
select tests.snap_restore(:'sec');
select stddev_samp(x) as sd_quiet from unnest(tests.run_ticks(:'sec', :'t0'::timestamptz + interval '70 minutes', 120, 0)) x \gset
select tests.snap_restore(:'sec');
select stddev_samp(x) as sd_busy from unnest(tests.run_ticks(:'sec', :'t0'::timestamptz + interval '90 minutes', 120,
  100 * public.config_double('aiInvestors', '{playerWeight,referenceActivityCents,penny}', 5000000))) x \gset
select tests.assert(:sd_busy::double precision < 0.5 * :sd_quiet::double precision,
  'busy security: tick volatility ' || round(:sd_busy::numeric * 10000, 1) || ' bps vs. ' || round(:sd_quiet::numeric * 10000, 1)
  || ' bps without player activity (AI weight down to minAiWeight)');

-- 4. bonds: a player buy moves the price deviation in euros (noise of the bond itself aside)
select s.id as bsec, s.ticker as btkr from public.securities s where s.kind = 'bond' and s.status = 'listed' order by s.ticker limit 1 \gset
select volatility as bvol from public.security_sim_state where security_id = :'bsec' \gset
update public.security_sim_state set volatility = 0 where security_id = :'bsec';
select price_deviation as dev0 from public.security_sim_state where security_id = :'bsec' \gset
select tests.login_as('authenticated', :b);
select public.place_order(gen_random_uuid(), :'btkr', 'buy', 'market', null, null, 2000000) is not null as ok \gset
reset role;
select tests.run_ticks(:'bsec', :'t0'::timestamptz + interval '110 minutes', 1) is not null as ok \gset
select tests.assert(
  (select price_deviation from public.security_sim_state where security_id = :'bsec')
    - :dev0::double precision * (1 - public.config_double('aiInvestors', '{sentimentDecayPerTick}', 0.0019))
    between 0.0035 and 0.0045,
  'bonds: 20.000 EUR net buying moves the price by about 0.4 % (bondDepthCentsPer100Bps)');
update public.security_sim_state set volatility = :bvol where security_id = :'bsec';

select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds');
