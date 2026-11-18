-- =============================================================================
-- f2 · Stocks without a daily limit, market forces against overheated stocks (ADR-214)
-- =============================================================================
-- The owner: stocks may rise and fall without a daily limit, but overheated stocks should draw more events from
-- outside that slow or reverse the run. Formulas as in src/lib/sim/market-forces.ts (market-forces.test.ts).
\set QUIET 1
set client_min_messages = notice;

\set f '''0f2f2f2f-0000-4000-8000-0000000000f1'''
\set a '''0f2f2f2f-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:f, 'Fiona_Ohnegrenze') is not null and tests.signup(:a, 'Arno_Aufwaerts') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 12);
select tests.set_level(:a, 12);
select tests.fund(:f, 5000000, 'test:f2:f');
select tests.fund(:a, 100000000, 'test:f2:a');

begin;
select tests.set_cfg('aiInvestors', '{tickNoiseScale}', '0');
select public.config_jsonb('marketForces') as mf \gset

-- =============================================================================
-- A. The formulas in SQL as in src/lib/sim/market-forces.ts
-- =============================================================================
select tests.assert(
  (select heat = 0 and cold = 0 from public.market_force_heat(10000, 10000, 10000, 10000, :'mf'))
  and (select abs(heat - (ln(2) - 0.25) / 0.5) < 1e-9 and cold = 0 from public.market_force_heat(20000, 10000, 20000, 20000, :'mf'))
  and (select abs(heat - (ln(2) - 0.2) / 0.4) < 1e-9 from public.market_force_heat(20000, 20000, 10000, 20000, :'mf'))
  and (select abs(heat - (ln(4) - 0.5) / 0.8) < 1e-9 from public.market_force_heat(40000, 40000, 40000, 10000, :'mf'))
  -- a rise the company earned (price below its value) is no bubble; no history counts as no gain
  and (select heat = 0 from public.market_force_heat(20000, 40000, 10000, 5000, :'mf'))
  and (select heat = 0 from public.market_force_heat(10000, 10000, null, null, :'mf'))
  and (select heat = 4 from public.market_force_heat(100000000, 1, 1, 1, :'mf'))
  and (select cold > 0 and heat = 0 from public.market_force_heat(4000, 10000, 4000, 4000, :'mf')),
  'market_force_heat(): premium, 24-hour and 7-day gain over their free share, capped at maxHeat (as stockHeat)');
select tests.assert(
  public.market_force_chance_per_hour(0, 0, :'mf') = 0.012
  and abs(public.market_force_chance_per_hour(1, 0, :'mf') - 0.912) < 1e-9
  and public.market_force_chance_per_hour(4, 4, :'mf') = 3,
  'market_force_chance_per_hour(): base + perHeat × heat + perCold × cold, at most maxPerHour');
select tests.assert(
  (select bool_and((public.market_force_pick(2, 0, u / 100.0, :'mf') ->> 'direction')::integer = -1)
     from generate_series(0, 99) u)
  and (select bool_and((public.market_force_pick(0, 2, u / 100.0, :'mf') ->> 'direction')::integer = 1)
         from generate_series(0, 99) u)
  and (select array_agg(distinct public.market_force_pick(0, 0, u / 100.0, :'mf') ->> 'key' order by public.market_force_pick(0, 0, u / 100.0, :'mf') ->> 'key')
         from generate_series(0, 99) u) = array['fund_entry', 'rotation']
  and public.market_force_pick(1.9, 0, 0.99, jsonb_build_object('forces', jsonb_build_array(:'mf'::jsonb #> '{forces,7}'))) is null,
  'market_force_pick(): hot stocks draw only damping forces, cold ones only lifting ones, calm ones the background');
select tests.assert(
  public.market_force_move_bps(:'mf'::jsonb #> '{forces,0}', 0, 0, 0, :'mf') = 400
  and public.market_force_move_bps(:'mf'::jsonb #> '{forces,0}', 0, 0, 1, :'mf') = 1200
  and public.market_force_move_bps(:'mf'::jsonb #> '{forces,0}', 2, 0, 0.5, :'mf') = round(800 * 1.9)
  and public.market_force_move_bps(:'mf'::jsonb #> '{forces,7}', 4, 0, 1, :'mf') = 4500,
  'market_force_move_bps(): uniform(min, max) × (1 + severityPerHeat × heat), at most maxMoveBps');

-- =============================================================================
-- B. No daily band: a player stock more than doubles in a day (the band held it at +100 %)
-- =============================================================================
select tests.assert(public.config_double('trading', '{playerStocks,dailyBandBps}', -1) = 0,
  'game_config: trading.playerStocks.dailyBandBps is 0 (no daily limit)');
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Grenzenlos', 'Immer weiter', 'tech', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.company_of(:f) as co \gset
update public.player_companies set quality = 1 where company_id = :'co';
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select c.ticker as tkr, c.security_id as sec from public.companies c where c.id = :'co' \gset
select tests.neutral(:'sec');
update public.security_quotes set prev_close_e4 = last_price_e4 where security_id = :'sec';
select set_config('f2.tkr', :'tkr', false) is not null and set_config('f2.sec', :'sec', false) is not null as ok \gset
select last_price_e4 as p0 from public.security_quotes where security_id = :'sec' \gset
-- players buy 120.000 EUR within half an hour: the orders fill on the normal fair path, no share at a band price
do $$
declare
  i integer;
begin
  for i in 1 .. 6 loop
    perform tests.login_as('authenticated', '0f2f2f2f-0000-4000-8000-0000000000a1'::uuid);
    perform public.place_order(gen_random_uuid(), current_setting('f2.tkr'), 'buy', 'market', null, null, 2000000);
    reset role;
    perform tests.run_ticks(current_setting('f2.sec')::uuid, public.game_now() + i * interval '5 minutes', 12);
  end loop;
end;
$$;
select last_price_e4 as p1 from public.security_quotes where security_id = :'sec' \gset
select tests.assert(:p1::bigint > :p0::bigint,
  'six buys of 20.000 EUR fill and lift the player stock: ' || :p0 || ' -> ' || :p1);

-- the old band (ADR-170) pulled a jump back to +100 % in the next tick; without it the jump stays
update public.security_quotes set prev_close_e4 = :p0 where security_id = :'sec';
select tests.set_cfg('trading', '{playerStocks,dailyBandBps}', '10000');
select public.market_force_shock(:'sec', 20000, 0, public.game_now() + interval '1 hour') is not null as ok \gset
select tests.run_ticks(:'sec', public.game_now() + interval '1 hour', 1) is not null as ok \gset
select last_price_e4 as pb from public.security_quotes where security_id = :'sec' \gset
select tests.set_cfg('trading', '{playerStocks,dailyBandBps}', '0');
update public.security_quotes set last_price_e4 = :p1, prev_close_e4 = :p0 where security_id = :'sec';
select public.market_force_shock(:'sec', 20000, 0, public.game_now() + interval '2 hours') is not null as ok \gset
select tests.run_ticks(:'sec', public.game_now() + interval '2 hours', 6) is not null as ok \gset
select last_price_e4 as p2 from public.security_quotes where security_id = :'sec' \gset
select tests.assert(:pb::bigint <= ceil(:p0::bigint * 2.0) and :p2::bigint > 2 * :p0::bigint,
  'no daily band: a jump to +' || round((:p2::numeric / :p0 - 1) * 100) || ' % over the previous close stays ('
  || :p0 || ' -> ' || :p2 || '); with the old band the tick held it at ' || :pb);

-- and down: selling it all and a crash take it below half of the high, no floor at -50 %
select coalesce(sum(p.quantity_e6 - p.reserved_quantity_e6), 0) as qa from public.positions p
 where p.player_id = :a and p.security_id = :'sec' and p.status = 'open' \gset
update public.security_quotes set prev_close_e4 = last_price_e4 where security_id = :'sec';
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), :'tkr', 'sell', 'market', :qa::bigint) ->> 'status' as s1 \gset
reset role;
select public.market_force_shock(:'sec', -6000, -0.5, public.game_now() + interval '3 hours') is not null as ok \gset
select tests.run_ticks(:'sec', public.game_now() + interval '3 hours', 6) is not null as ok \gset
select last_price_e4 as p3 from public.security_quotes where security_id = :'sec' \gset
select tests.assert(:'s1' = 'filled' and :p3::bigint * 2 < :p2::bigint,
  'the sale and a crash take it below half of the day''s close, no floor at -50 % (' || :p2 || ' -> ' || :p3 || ')');

-- =============================================================================
-- C. An overheated stock draws many damping forces, a calm one hardly any
-- =============================================================================
select s.id as hot, s.name as hot_name from public.securities s join public.companies c on c.id = s.company_id
 where s.kind = 'stock' and s.status = 'listed' and c.is_ai order by s.ticker limit 1 \gset
select s.id as calm from public.securities s join public.companies c on c.id = s.company_id
 where s.kind = 'stock' and s.status = 'listed' and c.is_ai order by s.ticker offset 1 limit 1 \gset
delete from public.stock_tips;
update public.security_quotes q set last_price_e4 = st.fair_value_e4 * 3
  from public.security_sim_state st where st.security_id = q.security_id and q.security_id = :'hot';
update public.security_quotes q set last_price_e4 = st.fair_value_e4
  from public.security_sim_state st where st.security_id = q.security_id and q.security_id = :'calm';
select setseed(0.214);
do $$
declare
  i integer;
begin
  for i in 1 .. 600 loop
    perform public.market_forces_run(public.game_now() + i * interval '1 minute');
    -- settle at once (without moving prices) so every minute is a fresh draw
    update public.stock_tips set applied_at = public.game_now() where applied_at is null and source = 'market';
  end loop;
end;
$$;
select count(*) filter (where t.security_id = :'hot') as n_hot,
       count(*) filter (where t.security_id = :'hot' and t.direction < 0) as n_hot_down,
       count(*) filter (where t.security_id = :'calm') as n_calm,
       count(*) filter (where t.security_id = :'hot' and t.move_bps >= 1000) as n_hot_big
  from public.stock_tips t where t.source = 'market' \gset
select tests.assert(:n_hot::integer >= 6 and :n_hot_down::integer = :n_hot::integer and :n_calm::integer <= 2
                    and :n_hot_big::integer > 0,
  'ten hours: the stock at 3 x its fair value draws ' || :n_hot || ' damping forces (' || :n_hot_big
  || ' of 10 % or more), the calm one ' || :n_calm);
select tests.assert(
  (select bool_and(n.category = 'market' and t.headline is not null and t.body not like '%{%')
     from public.stock_tips t join public.news_items n on n.id = t.news_item_id where t.source = 'market'),
  'every force is in the news feed (category market) with its text filled in');

-- =============================================================================
-- D. A force that comes true moves price and mood, not the fair value; ordinary news keep their rhythm
-- =============================================================================
delete from public.stock_tips;
update public.game_config set value = jsonb_set(value, '{chance}', '{"basePerHour": 0, "perHeatPerHour": 0, "perColdPerHour": 0, "maxPerHour": 0}')
 where key = 'marketForces';
update public.game_config set value = jsonb_set(value, '{waves}', '{"basePerHour": 0, "perHeatPerHour": 0, "maxPerHour": 0, "reliefPerHour": 0, "minHeat": 0.2, "maxStocks": 6}')
 where key = 'marketForces';
select q.last_price_e4 as hp0, st.fair_value_e4 as hf0, st.sentiment as hs0
  from public.security_quotes q join public.security_sim_state st on st.security_id = q.security_id
 where q.security_id = :'hot' \gset
insert into public.stock_tips (security_id, direction, move_bps, strength, comes_true, headline, body, published_at, due_at,
                               source, force_key, sentiment_delta)
values (:'hot', -1, 2000, 3, true, 'Gewinnmitnahmen', 'Test', public.game_now(), public.game_now(), 'market',
        'profit_taking', -0.4);
select public.stock_news_run_due(public.game_now() + interval '1 second') as r1 \gset
select q.last_price_e4 as hp1, st.fair_value_e4 as hf1, st.sentiment as hs1
  from public.security_quotes q join public.security_sim_state st on st.security_id = q.security_id
 where q.security_id = :'hot' \gset
select tests.assert(:hp1::bigint = round(:hp0::bigint * 0.8) and :hf1::bigint = :hf0::bigint
                    and :hs1::double precision < :hs0::double precision
                    and (:'r1'::jsonb ->> 'settled')::integer = 1 and (:'r1'::jsonb ->> 'published')::integer = 1,
  'stock_news_run_due(): the force settles (price ' || :hp0 || ' -> ' || :hp1 || ', fair value stays ' || :hf1
  || ', mood ' || round(:hs0::numeric, 3) || ' -> ' || round(:hs1::numeric, 3)
  || '), and an ordinary hint is still published beside it');

select tests.assert(not has_function_privilege('authenticated', 'public.market_forces_run(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.market_force_shock(uuid, integer, double precision, timestamptz)', 'execute'),
  'grants: the market forces are internal');
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'money invariant after the market forces: ' || tests.money_invariant());
rollback;
