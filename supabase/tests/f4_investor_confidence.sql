-- =============================================================================
-- f4 · Investor confidence, market mood and stock incidents (ADR-216)
-- =============================================================================
-- The owner: "Derzeit steigen Aktien nur. Die KI-Anleger müssen richtigen Einfluss haben. Deren Vertrauen ist das
-- Wichtigste." Formulas as in src/lib/sim/investor-confidence.ts (investor-confidence.test.ts).
\set QUIET 1
set client_min_messages = notice;

\set f '''0f4f4f4f-0000-4000-8000-0000000000f1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:f, 'Vera_Vertrauen') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 12);
select tests.fund(:f, 5000000, 'test:f4:f');

begin;
select tests.set_cfg('aiInvestors', '{tickNoiseScale}', '0');
-- without the premium for shares players hold, the fair value is the only anchor of the value funds
select tests.set_cfg('trading', '{playerImpact,maxHoldingsPremium}', '0');
-- no market forces or stock news in between: the confidence alone moves the prices
update public.game_config set value = jsonb_set(value, '{chance}', '{"basePerHour": 0, "perHeatPerHour": 0, "perColdPerHour": 0, "maxPerHour": 0}')
 where key = 'marketForces';
select public.config_jsonb('investorConfidence') as ic \gset

-- =============================================================================
-- A. Formulas
-- =============================================================================
select tests.assert(
  public.investor_confidence_signal(50, :'ic'::jsonb -> 'flow') = 0
  and public.investor_confidence_signal(100, :'ic'::jsonb -> 'flow') = 1
  and public.investor_confidence_signal(0, :'ic'::jsonb -> 'flow') = -1
  and abs(public.investor_confidence_signal(30, :'ic'::jsonb -> 'flow') + 0.4) < 1e-9
  and abs(public.investor_confidence_signal(75, :'ic'::jsonb -> 'flow') - 0.5) < 1e-9
  and abs(public.investor_confidence_signal(10, :'ic'::jsonb -> 'flow') + 1) < 1e-9
  and abs(public.investor_confidence_signal(20, :'ic'::jsonb -> 'flow') + 0.6) < 1e-9,
  'investor_confidence_signal(): gain × (C − 50) / 50, panic below 15, symmetric (as confidenceSignal)');
select tests.assert(
  abs(public.investor_confidence_ai_growth(800, 50, :'ic') - 0.008) < 1e-9
  and abs(public.investor_confidence_ai_growth(800, 25, :'ic') - (0.008 - 0.04)) < 1e-9,
  'investor_confidence_ai_growth(): sector × trendShare + cycle × (mood − 50) / 50 (as aiGrowthPerGameYear)');
select public.investor_confidence_state(120, 100, 70, 2, 3, 40, 3, true, 0.045, 30, 7, ln(1.2), ln(1.5), 1.25, :'ic') as st \gset
select tests.assert(
  (:'st'::jsonb ->> 'profit')::numeric = round((8 * tanh(0.2))::numeric, 1)
  and (:'st'::jsonb ->> 'reputation')::numeric = 4
  and (:'st'::jsonb ->> 'crisis')::numeric = -6
  and (:'st'::jsonb ->> 'incident_open')::numeric = -15
  and (:'st'::jsonb ->> 'country')::numeric = -4.8
  and (:'st'::jsonb ->> 'management')::numeric = 3.8
  and (:'st'::jsonb ->> 'volatility')::numeric = -2.4
  and (:'st'::jsonb ->> 'macro')::numeric = -10
  and (:'st'::jsonb ->> 'sector')::numeric = 7
  and (:'st'::jsonb ->> 'momentum')::numeric = round((10 * tanh(ln(1.2) / 0.15))::numeric, 1)
  and (:'st'::jsonb ->> 'valuation')::numeric = round((-12 * tanh(ln(1.5) / 0.35))::numeric, 1)
  and (:'st'::jsonb ->> 'chatter')::numeric = 1.3
  and public.investor_confidence_target('{"a": 30, "b": 40}') = 100
  and public.investor_confidence_target('{"a": -10}') = 40,
  'investor_confidence_state() and _target(): the factors as in stateFactors, target 50 + Σ clamped');
select tests.assert(
  public.investor_confidence_reasons('{"macro": -12, "chatter": 1.2, "earnings": 8, "momentum": -3, "valuation": 2, "sector": 7}', :'ic')
    = '[{"key": "macro", "points": -12.0}, {"key": "earnings", "points": 8.0}, {"key": "sector", "points": 7.0}, {"key": "momentum", "points": -3.0}]'::jsonb,
  'investor_confidence_reasons(): strongest first, at most four, small ones left out');

-- =============================================================================
-- B. The tick: low confidence sells a stock down, high confidence buys it up (no news, no noise)
-- =============================================================================
select s.id as lo, s.ticker as lo_t from public.securities s join public.companies c on c.id = s.company_id
 where s.kind = 'stock' and s.status = 'listed' and c.is_ai order by s.ticker limit 1 \gset
select s.id as hi from public.securities s join public.companies c on c.id = s.company_id
 where s.kind = 'stock' and s.status = 'listed' and c.is_ai order by s.ticker offset 1 limit 1 \gset
select s.id as mid from public.securities s join public.companies c on c.id = s.company_id
 where s.kind = 'stock' and s.status = 'listed' and c.is_ai order by s.ticker offset 2 limit 1 \gset
select tests.neutral(:'lo') as n1, tests.neutral(:'hi') as n2, tests.neutral(:'mid') as n3 \gset
update public.security_sim_state set confidence = 12 where security_id = :'lo';
update public.security_sim_state set confidence = 85 where security_id = :'hi';
update public.security_sim_state set confidence = 50 where security_id = :'mid';
select sum(shares_outstanding) as shares0 from public.companies \gset
select last_price_e4 as lo0 from public.security_quotes where security_id = :'lo' \gset
select last_price_e4 as hi0 from public.security_quotes where security_id = :'hi' \gset
select last_price_e4 as mid0 from public.security_quotes where security_id = :'mid' \gset
select tests.run_ticks(:'lo', public.game_now() + interval '1 hour', 360) is not null as ok \gset
select last_price_e4 as lo1 from public.security_quotes where security_id = :'lo' \gset
select last_price_e4 as hi1 from public.security_quotes where security_id = :'hi' \gset
select last_price_e4 as mid1 from public.security_quotes where security_id = :'mid' \gset
select tests.assert(:lo1::bigint < :lo0::bigint * 0.85,
  'confidence 12 (panic): the confidence investors sell, the price falls below its value without any news ('
  || :lo0 || ' -> ' || :lo1 || ', ' || round((:lo1::numeric / :lo0 - 1) * 100) || ' %)');
select tests.assert(:hi1::bigint > :hi0::bigint * 1.1,
  'confidence 85: the confidence investors buy, the price rises above its value (' || :hi0 || ' -> ' || :hi1
  || ', +' || round((:hi1::numeric / :hi0 - 1) * 100) || ' %)');
select tests.assert(abs(:mid1::numeric / :mid0 - 1) < 0.01,
  'confidence 50: no drift (' || :mid0 || ' -> ' || :mid1 || ')');
-- back to 50: the value fund pulls the stock back up (recovery)
update public.security_sim_state set confidence = 50 where security_id = :'lo';
select tests.run_ticks(:'lo', public.game_now() + interval '2 hours', 360) is not null as ok \gset
select last_price_e4 as lo2 from public.security_quotes where security_id = :'lo' \gset
select tests.assert(:lo2::bigint > :lo1::bigint * 1.05,
  'confidence back at 50: the stock recovers (' || :lo1 || ' -> ' || :lo2 || ')');

-- =============================================================================
-- C. A bear phase: the job lowers the confidence of most stocks, the tick lowers their prices
-- =============================================================================
select tests.set_cfg('investorConfidence', '{state,chatterSigma}', '0');
select tests.set_cfg('investorConfidence', '{mood,sigmaPerMinute}', '0');
do $$
declare
  r record;
begin
  for r in select s.id from public.securities s where s.kind = 'stock' and s.status = 'listed' loop
    perform tests.neutral(r.id);
    update public.security_sim_state set confidence = 50 where security_id = r.id;
  end loop;
end;
$$;
update public.market_mood set phase = 'bear', mood = 22, phase_ends_at = public.game_now() + interval '3 days',
                              rotation_at = public.game_now() + interval '3 days', last_run_at = null;
delete from public.stock_confidence;
create temporary table f4_p0 as
  select q.security_id, q.last_price_e4 from public.security_quotes q join public.securities s on s.id = q.security_id
   where s.kind = 'stock' and s.status = 'listed';
select public.investor_confidence_run(public.game_now() + interval '3 hours') as r0 \gset
do $$
declare
  i integer;
  t timestamptz := public.game_now() + interval '3 hours';
begin
  for i in 1 .. 40 loop
    perform public.investor_confidence_run(t + i * interval '3 minutes');
    perform public.market_tick_at(t + i * interval '3 minutes' + interval '10 seconds');
    perform public.market_tick_at(t + i * interval '3 minutes' + interval '20 seconds');
    perform public.market_tick_at(t + i * interval '3 minutes' + interval '30 seconds');
  end loop;
end;
$$;
select count(*) as n_all,
       count(*) filter (where q.last_price_e4 < p.last_price_e4) as n_down,
       round(avg(sc.confidence)::numeric, 1) as avg_conf
  from f4_p0 p join public.security_quotes q on q.security_id = p.security_id
  join public.stock_confidence sc on sc.security_id = p.security_id \gset
select tests.assert(:n_down::integer >= 0.7 * :n_all::integer and :avg_conf::numeric < 45,
  'bear phase (mood 22): ' || :n_down || ' of ' || :n_all || ' stocks fall, average confidence ' || :avg_conf);
select tests.assert(
  (select bool_and((sc.factors ->> 'macro')::numeric < 0) from public.stock_confidence sc)
  and (select jsonb_array_length(history) >= 1 from public.stock_confidence limit 1),
  'every stock carries the weak market mood as a reason (macro < 0) and an hourly history');

select tests.assert((select sum(shares_outstanding) from public.companies) = :shares0::numeric,
  'share invariant: the confidence investors trade, no share is created or destroyed');

-- =============================================================================
-- D. Hooks: stock news, capital increase, a stock incident with steps and a bad strategy
-- =============================================================================
update public.stock_confidence set events = '{}' where security_id = :'mid';
insert into public.stock_tips (security_id, direction, move_bps, strength, comes_true, headline, body, published_at, due_at)
values (:'mid', -1, 1000, 2, true, 'Test', 'Test', public.game_now(), public.game_now()) returning id as tip \gset
update public.stock_tips set applied_at = public.game_now() where id = :tip;
select (events ->> 'news')::numeric as news_bump from public.stock_confidence where security_id = :'mid' \gset
select tests.assert(round(:news_bump::numeric, 6) = -6, 'a bad stock news that came true: news bump −6 (6 points per 10 %)');

select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Vertrauensbruch', 'Glas', 'tech', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.company_of(:f) as co \gset
update public.player_companies set quality = 1 where company_id = :'co';
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select c.ticker as tkr, c.security_id as sec, c.shares_outstanding as so from public.companies c where c.id = :'co' \gset
select tests.neutral(:'sec') as n4 \gset
delete from public.player_company_events where company_id = :'co';
select tests.assert(coalesce((select (events ->> 'dilution')::numeric from public.stock_confidence where security_id = :'sec'), 0) = 0,
  'the shares issued at the IPO are no dilution');
update public.securities set listed_at = now() - interval '1 day' where id = :'sec';
update public.companies set shares_outstanding = shares_outstanding * 12 / 10 where id = :'co';
select (events ->> 'dilution')::numeric as dil from public.stock_confidence where security_id = :'sec' \gset
select tests.assert(round(:dil::numeric, 6) = -8, 'capital increase of 20 %: dilution bump −8');
update public.companies set shares_outstanding = :so where id = :'co';

-- overheated: three times its fair value; an incident follows within a few hours
update public.security_quotes q set last_price_e4 = st.fair_value_e4 * 3
  from public.security_sim_state st where st.security_id = q.security_id and q.security_id = :'sec';
update public.stock_confidence set events = '{}' where security_id = :'sec';
select setseed(0.216);
select set_config('tests.f4_company', :'co', true) is not null as ok \gset
-- other listed player companies left by earlier tests may draw an incident first: wait for this company's own
do $$
declare
  i integer;
begin
  for i in 1 .. 48 loop
    perform public.investor_confidence_incidents_run(public.game_now() + i * interval '1 hour', 60);
    exit when exists (select 1 from public.player_company_events ev
                       where ev.company_id = current_setting('tests.f4_company')::uuid
                         and coalesce((ev.definition ->> 'incident')::boolean, false));
  end loop;
end;
$$;
select ev.id as ev, ev.archetype as arch, ev.severity as sev from public.player_company_events ev
 where ev.company_id = :'co' and (ev.definition ->> 'incident')::boolean \gset
select (events ->> 'incident')::numeric as inc0 from public.stock_confidence where security_id = :'sec' \gset
select tests.assert(:'ev' <> '' and :sev::integer = 3 and :inc0::numeric = -27,
  'an overheated player stock (3 × its value) gets a stock incident (' || :'arch' || ', severity ' || :sev
  || '), confidence bump ' || :inc0);
select tests.assert(
  exists (select 1 from public.news_items n where n.security_id = :'sec' and n.category = 'market'
            and n.headline like '%Vertrauensbruch%' and n.headline not like '%{%')
  and exists (select 1 from public.notifications n where n.player_id = :f and n.payload ->> 'event_id' = :'ev'),
  'the incident is stock news (Mr. Doodle) and the founder is notified');
-- a bad strategy makes it worse, a step that succeeded brings some confidence back
update public.player_company_events set strategy = 'accept' where id = :'ev';
update public.player_company_events set strategy = (definition -> 'strategies' -> 0 ->> 'key') where id = :'ev';
select (events ->> 'incident')::numeric as inc1 from public.stock_confidence where security_id = :'sec' \gset
insert into public.company_event_steps (event_id, idx, strategy, key, status, started_at, ends_at, success_bps)
select :'ev', 0, ev.strategy, ev.definition -> 'strategies' -> 0 -> 'steps' -> 0 ->> 'key', 'running', now(), now(), 8000
  from public.player_company_events ev where ev.id = :'ev' returning id as step \gset
update public.company_event_steps set status = 'succeeded', resolved_at = now() where id = :step;
select (events ->> 'incident')::numeric as inc2 from public.stock_confidence where security_id = :'sec' \gset
select tests.assert(:inc1::numeric = :inc0::numeric and :inc2::numeric = :inc0::numeric + 7.5,
  'a step of the incident that succeeded: +7,5 (' || :inc1 || ' -> ' || :inc2 || ')');
select key as bad from jsonb_array_elements_text(public.config_jsonb('investorConfidence', '{incidents,badStrategies}')) b(key)
 where exists (select 1 from jsonb_array_elements((select definition -> 'strategies' from public.player_company_events where id = :'ev')) s
                where s ->> 'key' = b.key) limit 1 \gset
update public.player_company_events set strategy = :'bad' where id = :'ev';
select (events ->> 'incident')::numeric as inc3 from public.stock_confidence where security_id = :'sec' \gset
select tests.assert(:inc3::numeric = greatest(-30, :inc2::numeric - 18),
  'the cheap way out (' || :'bad' || '): the investors notice (' || :inc2 || ' -> ' || :inc3 || ')');
select public.investor_confidence_run(public.game_now() + interval '1 day') is not null as ok \gset
select tests.assert((select (factors ->> 'incident_open')::numeric = -15 from public.stock_confidence where security_id = :'sec'),
  'while the incident is open the stock carries incident_open −5 × severity');

-- =============================================================================
-- E. RPCs, grants, invariants
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.get_stock_confidence(:'tkr') as gc \gset
select public.get_market_mood() as gm \gset
reset role;
select tests.assert(
  (:'gc'::jsonb ->> 'confidence')::numeric between 0 and 100
  and jsonb_typeof(:'gc'::jsonb -> 'reasons') = 'array'
  and jsonb_array_length(:'gc'::jsonb -> 'reasons') between 1 and 4
  and :'gc'::jsonb -> 'market' ->> 'phase' = 'bear'
  and (:'gm'::jsonb ->> 'mood')::numeric < 40
  and jsonb_array_length(:'gm'::jsonb -> 'leaders') = 3 and jsonb_array_length(:'gm'::jsonb -> 'laggards') = 3,
  'get_stock_confidence() and get_market_mood(): value, reasons, mood, leaders and laggards');
select tests.assert(not has_function_privilege('authenticated', 'public.investor_confidence_run(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.investor_confidence_bump(uuid, text, double precision, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.get_stock_confidence(text)', 'execute')
  and not has_function_privilege('anon', 'public.get_market_mood()', 'execute'),
  'grants: the job and the bumps are internal, the two RPCs for players');
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'money invariant after the confidence run, the incidents and the ticks: ' || tests.money_invariant());
rollback;
