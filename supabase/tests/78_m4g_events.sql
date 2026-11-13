-- =============================================================================
-- 78 · M4g: announced events (ADR-090)
-- =============================================================================
-- Every time-dependent step runs at a pinned game time on the next game day (t0 = 13:00 Berlin), so the
-- results do not depend on when the suite runs. Randomness is pinned through the config (trial
-- probability 1, minMove = maxMove) and the hidden success probability.
\set QUIET 1
set client_min_messages = notice;

\set h '''07807807-0000-4000-8000-0000000000e1'''
\set h2 '''07807807-0000-4000-8000-0000000000e2'''
select tests.signup(:h, 'Erika_Ereignis') is not null and tests.signup(:h2, 'Egon_Ereignis') is not null as ok \gset
select tests.set_level(:h, 15);
select tests.set_level(:h2, 15);
select public.ensure_game_quarters(3) is not null as ok \gset

-- clean slate (earlier run_due_jobs calls may have planned events), saved config and policy rate
delete from public.scheduled_events;
delete from public.job_runs where job_name in ('events_plan', 'events_pharma_roll');
select value as cfg_events from public.game_config where key = 'events' \gset
select value as cfg_cb from public.game_config where key = 'centralBank' \gset
-- The bells only exist with market hours (ADR-106: the game runs open around the clock); test them with 8 to 22.
select value as cfg_time from public.game_config where key = 'time' \gset
select tests.set_cfg('time', '{marketOpenHour}', '8');
select tests.set_cfg('time', '{marketCloseHour}', '22');
select policy_rate_bps as rate0 from public.central_bank_state where id \gset
update public.central_bank_state set policy_rate_bps = 300 where id;
select tests.set_cfg('events', '{pharmaTrial,probabilityPerQuarter}', '1');
select tests.set_cfg('events', '{pharmaTrial,minMove}', '0.6');
select tests.set_cfg('events', '{pharmaTrial,maxMove}', '0.6');
select tests.set_cfg('events', '{schedule}', '{"horizonHours": 24, "earningsTopCompanies": 3, "recentHours": 24}');
select tests.set_cfg('centralBank', '{warmupQuarters}', '0');
select tests.set_cfg('centralBank', '{decisionEveryQuarters}', '2');
select tests.set_cfg('centralBank', '{announceLeadQuarters}', '1');
select tests.set_cfg('centralBank', '{measurementWindowQuarters}', '4');
select tests.set_cfg('centralBank', '{minRateBps}', '50');
select tests.set_cfg('centralBank', '{maxRateBps}', '1000');

-- d1 = next game day; t0 = d1 13:00 Berlin (inside quarter 1 of d1, 08:00-14:00)
select public.game_day(now()) + 1 as d1 \gset
select (:'d1'::date::timestamp + interval '13 hours') at time zone 'Europe/Berlin' as t0 \gset
select id as q0, (game_year - 1) * 4 + quarter - 1 as i0, ends_at as q0_end
  from public.game_quarters where starts_at <= :'t0'::timestamptz and ends_at > :'t0'::timestamptz \gset
select tests.assert(:i0 % 2 = 0, 'quarter 1 of a game day has an even running index');

-- =============================================================================
-- A. Planning: bells, earnings for the top 3, pharma trials; idempotent
-- =============================================================================
select public.events_plan(:'t0') as p1 \gset
select public.events_plan(:'t0') as p2 \gset
select public.events_plan(:'t0'::timestamptz + interval '30 minutes') as p3 \gset
select count(*) as pharma_n from public.companies c join public.securities s on s.id = c.security_id
 where c.is_ai and c.phase = 'listed' and s.status = 'listed' and c.sector_key = 'pharma' \gset
select tests.assert(
  :'p1'::jsonb = jsonb_build_object('bells', 2, 'earnings', 12, 'pharma_trials', :pharma_n, 'rate_decisions', 0)
  and :'p2'::jsonb = '{"bells": 0, "earnings": 0, "pharma_trials": 0, "rate_decisions": 0}'::jsonb
  and :'p3'::jsonb = '{"bells": 0, "earnings": 0, "pharma_trials": 0, "rate_decisions": 0}'::jsonb
  and (select count(*) from public.scheduled_events) = 14 + :pharma_n and :pharma_n >= 2,
  'events_plan(): 2 bells, 4 quarters x 3 earnings, one trial per pharma AI company; repeating plans nothing');

select tests.assert(
  (select scheduled_at from public.scheduled_events where kind = 'closing_bell')
    = (:'d1'::date::timestamp + interval '22 hours') at time zone 'Europe/Berlin'
  and (select scheduled_at from public.scheduled_events where kind = 'opening_bell')
    = ((:'d1'::date + 1)::timestamp + interval '8 hours') at time zone 'Europe/Berlin'
  and (select bool_and(status = 'scheduled' and outcome is null and company_id is null and announced_at = :'t0'::timestamptz)
         from public.scheduled_events where kind in ('opening_bell', 'closing_bell')),
  'bells at 22:00 and 08:00 Berlin, no company, announced at planning time');

select tests.assert(
  (select count(distinct game_quarter_id) from public.scheduled_events where kind = 'earnings') = 4
  and not exists (
    select 1 from public.scheduled_events e join public.game_quarters gq on gq.id = e.game_quarter_id
     where e.kind = 'earnings' and (e.scheduled_at <> gq.ends_at or e.security_id is null or e.sector_key is null))
  and (select array_agg(company_id order by company_id) from public.scheduled_events
        where kind = 'earnings' and game_quarter_id = :q0)
      = (select array_agg(x.id order by x.id) from (
           select c.id from public.companies c join public.security_quotes q on q.security_id = c.security_id
             join public.securities s on s.id = c.security_id
            where c.is_ai and c.phase = 'listed' and s.status = 'listed'
            order by q.market_cap_cents desc, c.ticker limit 3) x),
  'earnings at each quarter end for the 3 largest AI companies by market cap');

select gq.id as qt, gq.starts_at + (gq.ends_at - gq.starts_at) / 2 as trial_at
  from public.game_quarters gq where (gq.game_year - 1) * 4 + gq.quarter - 1 = :i0 + 2 \gset
select tests.assert(
  (select bool_and(e.scheduled_at = :'trial_at'::timestamptz and e.game_quarter_id = :qt and e.importance = 3
                   and (sec.params ->> 'success_probability')::double precision
                       = (:'cfg_events'::jsonb #>> array['pharmaTrial', 'successProbability', c.tier::text])::double precision)
     from public.scheduled_events e join public.companies c on c.id = e.company_id
     join public.scheduled_event_secrets sec on sec.event_id = e.id
    where e.kind = 'pharma_trial')
  and (select count(*) from public.job_runs where job_name = 'events_pharma_roll' and run_key = :'q0') = 1,
  'pharma trials announced 2 quarters ahead (middle of that quarter); hidden success probability by size class');

-- =============================================================================
-- B. Rate decision: announced once the quarter before has ended; steps, drift, bounds
-- =============================================================================
select public.events_plan(:'t0'::timestamptz + interval '90 minutes') as p4 \gset
select id as r1, scheduled_at as r1_at, game_quarter_id as r1_q from public.scheduled_events where kind = 'rate_decision' \gset
select tests.assert(
  (:'p4'::jsonb ->> 'rate_decisions')::int = 1 and (:'p4'::jsonb ->> 'earnings')::int = 3
  and (:'p4'::jsonb ->> 'pharma_trials')::int = 0 and (:'p4'::jsonb ->> 'bells')::int = 0
  and :'r1_at'::timestamptz = (:'d1'::date::timestamp + interval '20 hours') at time zone 'Europe/Berlin'
  and (select next_decision_at from public.central_bank_state where id) = :'r1_at'::timestamptz,
  'rate decision for the odd quarter planned after the announcement quarter ended; no second trial while one is open');

-- an active player (daily login) and the money supply now; the snapshot 4 quarters earlier holds half per capita
select tests.login_as('authenticated', :h);
select public.daily_check_in(gen_random_uuid()) is not null as ok \gset
reset role;
select money_supply_cents as m1, active_players as n1 from public.events_money_sample(:'r1_at') \gset
select tests.assert(:n1 >= 1 and :m1 > 0, 'events_money_sample(): money of players and player companies, active players');
insert into public.money_supply_snapshots (game_quarter_id, player_cents, company_cents, active_players)
select gq.id, :m1 / 2, 0, :n1 from public.game_quarters gq where (gq.game_year - 1) * 4 + gq.quarter - 1 = :i0 + 1 - 4
on conflict (game_quarter_id) do update set player_cents = excluded.player_cents, company_cents = 0, active_players = excluded.active_players;

select public.events_resolve_due(:'r1_at') as res1 \gset
select tests.assert(
  :'res1'::jsonb = '{"resolved": 1, "cancelled": 0, "waiting": 6}'::jsonb
  and (select outcome from public.scheduled_events where id = :'r1')
      = '{"old_bps": 300, "new_bps": 350, "money_growth_bps": 10000}'::jsonb
  and (select status = 'resolved' and resolved_at = :'r1_at'::timestamptz from public.scheduled_events where id = :'r1')
  and (select policy_rate_bps from public.central_bank_state where id) = 350
  and (select count(*) from public.central_bank_decisions where game_quarter_id = :r1_q and new_rate_bps = 350) = 1,
  'rate decision: money per capita doubled -> +2 steps (capped at maxStepsPerDecision); earnings wait for the quarter close');

-- =============================================================================
-- C. Pharma trials: persistent price shock, fair value follows, holders are notified
-- =============================================================================
select tests.fund(:h, 5000000, 'test:m4g:h');
select tests.fund(:h2, 5000000, 'test:m4g:h2');
insert into public.notification_preferences (player_id, type_key, in_app_enabled) values (:h2, 'event_holding', false)
on conflict (player_id, type_key) do update set in_app_enabled = false;
select tests.login_as('authenticated', :h);
select public.place_order(gen_random_uuid(), 'ALM', 'buy', 'market', null, null, 50000) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :h2);
select public.place_order(gen_random_uuid(), 'ALM', 'buy', 'market', null, null, 50000) is not null as ok \gset
reset role;

select e.id as ev_alm, s.id as sec_alm, c.id as co_alm from public.scheduled_events e
  join public.securities s on s.id = e.security_id join public.companies c on c.id = e.company_id
 where e.kind = 'pharma_trial' and s.ticker = 'ALM' \gset
select e.id as ev_gnv, s.id as sec_gnv from public.scheduled_events e join public.securities s on s.id = e.security_id
 where e.kind = 'pharma_trial' and s.ticker = 'GNV' \gset
update public.scheduled_event_secrets set params = '{"success_probability": 1}' where event_id = :'ev_alm';
update public.scheduled_event_secrets set params = '{"success_probability": 0}' where event_id = :'ev_gnv';
select q.last_price_e4 as alm_p0, st.fair_value_e4 as alm_fv0, st.ema_fast as alm_ef0, st.ema_slow as alm_es0,
       st.event_value_factor as alm_f0, coalesce(public.fair_value_from_fundamentals(:'co_alm'), -1) as alm_fund0
  from public.security_quotes q join public.security_sim_state st on st.security_id = q.security_id
 where q.security_id = :'sec_alm' \gset
select q.last_price_e4 as gnv_p0, st.fair_value_e4 as gnv_fv0
  from public.security_quotes q join public.security_sim_state st on st.security_id = q.security_id
 where q.security_id = :'sec_gnv' \gset

select public.events_resolve_due(:'trial_at') as res2 \gset
select public.events_resolve_due(:'trial_at') as res2b \gset
select tests.assert(
  (:'res2'::jsonb ->> 'resolved')::int = 1 + :pharma_n and (:'res2'::jsonb ->> 'cancelled')::int = 0
  and (:'res2b'::jsonb ->> 'resolved')::int = 0
  and (select status = 'resolved' and outcome = '{}'::jsonb from public.scheduled_events where kind = 'closing_bell'),
  'resolution at the trial time: the closing bell (informational) and every trial, once');

select tests.assert(
  (select outcome from public.scheduled_events where id = :'ev_alm')
    = jsonb_build_object('success', true, 'move_bps', 6000, 'price_before_e4', :alm_p0,
                         'price_after_e4', public.div_round_half_even(:alm_p0::numeric * 16000, 10000))
  and (select last_price_e4 from public.security_quotes where security_id = :'sec_alm')
      = public.div_round_half_even(:alm_p0::numeric * 16000, 10000)
  and (select fair_value_e4 from public.security_sim_state where security_id = :'sec_alm')
      = public.div_round_half_even(:alm_fv0::numeric * 16000, 10000)
  and (select abs(event_value_factor - :alm_f0 * 1.6) < 1e-9 and abs(ema_fast - :alm_ef0 * 1.6) < 1e-6
              and abs(ema_slow - :alm_es0 * 1.6) < 1e-6
         from public.security_sim_state where security_id = :'sec_alm')
  and (select bid_e4 < last_price_e4 and ask_e4 > last_price_e4 and market_cap_cents
              = public.div_round_half_even((select shares_outstanding from public.companies where id = :'co_alm')::numeric
                                           * last_price_e4, 100)
         from public.security_quotes where security_id = :'sec_alm')
  and (select close_e4 from public.candles where security_id = :'sec_alm' and interval = '1m'
        and bucket_start = date_bin('1 minute', :'trial_at'::timestamptz, '2000-01-01 00:00:00+00'::timestamptz))
      = public.div_round_half_even(:alm_p0::numeric * 16000, 10000)
  and exists (select 1 from public.price_ticks where security_id = :'sec_alm' and ts = :'trial_at'::timestamptz),
  'successful trial: +60 % on price, bid/ask, market cap and candle; fair value, event factor and EMAs move by the same factor');

select tests.assert(
  (:alm_fund0 = -1 and public.fair_value_from_fundamentals(:'co_alm') is null)
  or abs(public.fair_value_from_fundamentals(:'co_alm') - round(:alm_fund0 * 1.6)) <= 1,
  'fair_value_from_fundamentals() keeps the event factor (quarter closes do not revert the jump)');

select tests.assert(
  (select (outcome ->> 'success')::boolean = false and (outcome ->> 'move_bps')::int = -6000
          and (outcome ->> 'price_after_e4')::bigint = public.div_round_half_even(:gnv_p0::numeric * 4000, 10000)
     from public.scheduled_events where id = :'ev_gnv')
  and (select fair_value_e4 from public.security_sim_state where security_id = :'sec_gnv')
      = greatest(1, public.div_round_half_even(:gnv_fv0::numeric * 4000, 10000))
  and (select bool_and(abs((outcome ->> 'move_bps')::int) = 6000 and (outcome ->> 'success')::boolean = ((outcome ->> 'move_bps')::int > 0)
                       and outcome ?& array['price_before_e4', 'price_after_e4'])
         from public.scheduled_events where kind = 'pharma_trial'),
  'failed trial: -60 % on price and fair value; every trial outcome has success, move_bps and both prices');

select tests.assert(
  (select count(*) from public.notifications where player_id = :h and type_key = 'event_holding') = 1
  and (select title = 'Studie erfolgreich: Alpenmed' and body = 'ALM steigt um 60,0 %.' and link = '/markets/ALM'
              and payload ->> 'ticker' = 'ALM' and (payload ->> 'move_bps')::int = 6000
         from public.notifications where player_id = :h and type_key = 'event_holding')
  and (select count(*) from public.notifications where player_id = :h2 and type_key = 'event_holding') = 0
  and exists (select 1 from public.notification_types where key = 'event_holding' and title = 'Ereignis in deinem Depot'),
  'holders are notified (event_holding) unless they switched the type off');

-- =============================================================================
-- D. Second rate decision drifts back to neutral inside the band; bounds
-- =============================================================================
select ((:'d1'::date + 1)::timestamp + interval '2 hours 30 minutes') at time zone 'Europe/Berlin' as t3 \gset
select public.events_plan(:'t3') as p5 \gset
select id as r2, scheduled_at as r2_at from public.scheduled_events where kind = 'rate_decision' and status = 'scheduled' \gset
select money_supply_cents as m2, active_players as n2 from public.events_money_sample(:'r2_at') \gset
insert into public.money_supply_snapshots (game_quarter_id, player_cents, company_cents, active_players)
select gq.id, round(:m2 / 1.08), 0, :n2 from public.game_quarters gq where (gq.game_year - 1) * 4 + gq.quarter - 1 = :i0 + 3 - 4
on conflict (game_quarter_id) do update set player_cents = excluded.player_cents, company_cents = 0, active_players = excluded.active_players;
select public.events_resolve_due(:'r2_at') as res3 \gset
select tests.assert(
  (:'p5'::jsonb ->> 'rate_decisions')::int = 1
  and :'r2_at'::timestamptz = ((:'d1'::date + 1)::timestamp + interval '8 hours') at time zone 'Europe/Berlin'
  and (select (outcome ->> 'old_bps')::int = 350 and (outcome ->> 'new_bps')::int = 325
              and abs((outcome ->> 'money_growth_bps')::int - 800) <= 1
         from public.scheduled_events where id = :'r2')
  and (select policy_rate_bps from public.central_bank_state where id) = 325
  and (select status from public.scheduled_events where kind = 'opening_bell') = 'resolved',
  'growth on target: the rate drifts one step towards neutral (350 -> 325)');

-- bounds: money per capita fell to a tenth, the floor is 310
select tests.set_cfg('centralBank', '{minRateBps}', '310');
insert into public.money_supply_snapshots (game_quarter_id, player_cents, company_cents, active_players)
select gq.id, :m2::bigint * 10, 0, :n2 from public.game_quarters gq where (gq.game_year - 1) * 4 + gq.quarter - 1 = :i0 + 3 - 4
on conflict (game_quarter_id) do update set player_cents = excluded.player_cents, company_cents = 0, active_players = excluded.active_players;
select public.event_rate_decision(gq.id, :'r2_at') as rb from public.game_quarters gq
 where (gq.game_year - 1) * 4 + gq.quarter - 1 = :i0 + 3 \gset
select tests.assert(
  :'rb'::jsonb = '{"old_bps": 325, "new_bps": 310, "money_growth_bps": -9000}'::jsonb
  and (select policy_rate_bps from public.central_bank_state where id) = 310,
  'rate decision: -2 steps at most and never below minRateBps');
select tests.set_cfg('centralBank', '{minRateBps}', '50');

-- no comparable snapshot (new database, downtime): no measurement, the rate is held
delete from public.money_supply_snapshots m using public.game_quarters gq
 where gq.id = m.game_quarter_id and (gq.game_year - 1) * 4 + gq.quarter - 1 = :i0 + 3 - 4;
select public.event_rate_decision(gq.id, :'r2_at') as rh from public.game_quarters gq
 where (gq.game_year - 1) * 4 + gq.quarter - 1 = :i0 + 3 \gset
select tests.assert(
  :'rh'::jsonb = '{"old_bps": 310, "new_bps": 310, "money_growth_bps": null}'::jsonb
  and (select policy_rate_bps from public.central_bank_state where id) = 310,
  'rate decision without a comparable money snapshot holds the rate');

-- =============================================================================
-- E. Earnings after the quarter close: outcome from the quarter report
-- =============================================================================
select status as q0_status from public.game_quarters where id = :q0 \gset
select public.simulate_ai_companies(:q0) >= 3 as ok \gset
update public.game_quarters set status = 'closed' where id = :q0;
select public.events_resolve_due(:'r2_at') as res4 \gset
update public.game_quarters set status = :'q0_status' where id = :q0;
select tests.assert(
  (:'res4'::jsonb ->> 'resolved')::int = 3
  and (select bool_and(e.status = 'resolved'
                       and (e.outcome ->> 'revenue_cents')::bigint = r.revenue_cents
                       and (e.outcome ->> 'net_income_cents')::bigint = r.net_income_cents
                       and (e.outcome ->> 'eps_e4')::bigint = r.eps_e4
                       and e.outcome ?& array['revenue_change_bps', 'net_income_change_bps']
                       and e.outcome ->> 'surprise' in ('beat', 'miss', 'inline'))
         from public.scheduled_events e
         join public.company_quarter_reports r on r.company_id = e.company_id and r.game_quarter_id = e.game_quarter_id
        where e.kind = 'earnings' and e.game_quarter_id = :q0)
  and (select count(*) from public.scheduled_events where kind = 'earnings' and status <> 'scheduled') = 3,
  'earnings of a closed quarter resolve with revenue, profit, EPS, changes and surprise; the others keep waiting');

-- downtime: a bell missed by more than an hour is dropped, everything else resolves once
select public.events_resolve_due(:'r2_at'::timestamptz + interval '2 days') as res5 \gset
select public.events_resolve_due(:'r2_at'::timestamptz + interval '2 days') as res6 \gset
select tests.assert(
  (:'res6'::jsonb ->> 'resolved')::int = 0 and (:'res6'::jsonb ->> 'cancelled')::int = 0
  and not exists (select 1 from public.scheduled_events where kind in ('opening_bell', 'closing_bell', 'pharma_trial', 'rate_decision')
                                                           and status = 'scheduled'),
  'late events are resolved exactly once');

-- =============================================================================
-- F. get_events: shape, order, no secrets; grants
-- =============================================================================
-- one fresh upcoming bell relative to the real clock
select public.events_plan(now()) is not null as ok \gset
select tests.login_as('authenticated', :h);
select public.get_events(50) as ge \gset
select public.get_events(1) as ge1 \gset
select tests.throws($$select * from public.scheduled_event_secrets$$, '42501', 'players cannot read the hidden event parameters');
select tests.throws($$select public.events_plan(now())$$, '42501', 'players cannot plan events');
select tests.throws($$select public.events_resolve_due(now())$$, '42501', 'players cannot resolve events');
select tests.throws($$select public.events_run_due()$$, '42501', 'players cannot run the event job');
select tests.throws($$select public.event_price_shock(gen_random_uuid(), 100, now())$$, '42501', 'players cannot move prices');
reset role;
select tests.assert(
  (select array_agg(k order by k) from jsonb_object_keys(:'ge'::jsonb) k) = array['recent', 'server_time', 'upcoming']
  and jsonb_array_length(:'ge'::jsonb -> 'upcoming') >= 1 and jsonb_array_length(:'ge'::jsonb -> 'recent') >= 4
  and jsonb_array_length(:'ge1'::jsonb -> 'upcoming') = 1 and jsonb_array_length(:'ge1'::jsonb -> 'recent') = 1
  and (select bool_and((select array_agg(k order by k) from jsonb_object_keys(x) k)
                       = array['announced_at', 'company_name', 'id', 'importance', 'kind', 'outcome', 'scheduled_at',
                               'sector', 'status', 'ticker'])
         from jsonb_array_elements((:'ge'::jsonb -> 'upcoming') || (:'ge'::jsonb -> 'recent')) x)
  and (select bool_and(x ->> 'status' = 'scheduled' and x -> 'outcome' = 'null'::jsonb)
         from jsonb_array_elements(:'ge'::jsonb -> 'upcoming') x)
  and (select bool_and(x ->> 'status' = 'resolved' and jsonb_typeof(x -> 'outcome') = 'object')
         from jsonb_array_elements(:'ge'::jsonb -> 'recent') x)
  and (select bool_and(z.prev is null or z.t >= z.prev)
         from (select (x ->> 'scheduled_at')::timestamptz as t,
                      lag((x ->> 'scheduled_at')::timestamptz) over (order by o) as prev
                 from jsonb_array_elements(:'ge'::jsonb -> 'upcoming') with ordinality a(x, o)) z)
  and exists (select 1 from jsonb_array_elements(:'ge'::jsonb -> 'recent') x
               where x ->> 'kind' = 'pharma_trial' and x ->> 'ticker' = 'ALM' and x ->> 'company_name' = 'Alpenmed'
                 and x ->> 'sector' = 'pharma' and (x ->> 'importance')::int = 3)
  and exists (select 1 from jsonb_array_elements(:'ge'::jsonb -> 'upcoming') x
               where x ->> 'kind' in ('opening_bell', 'closing_bell') and x -> 'ticker' = 'null'::jsonb)
  and position('success_probability' in :'ge'::text) = 0,
  'get_events(): {server_time, upcoming, recent}; EVENT keys; upcoming by time without outcome; recent with outcome; no secrets');

select tests.login_as('anon');
select tests.throws($$select public.get_events()$$, '42501', 'anon: get_events');
reset role;
select tests.login_as('authenticated', null);
select tests.throws_key($$select public.get_events()$$, 'not_authenticated', 'get_events(): signed-in players only');
reset role;

-- =============================================================================
-- G. Minute job: throttled planning, wired into run_due_jobs
-- =============================================================================
delete from public.job_runs where job_name = 'events_plan';
select public.events_run_due() as j1 \gset
select public.events_run_due() as j2 \gset
select public.run_due_jobs() as rdj \gset
select tests.assert(
  :'j1'::jsonb ? 'planned' and not (:'j2'::jsonb ? 'planned') and :'rdj'::jsonb ? 'events'
  and position('public.events_run_due()' in pg_get_functiondef('public.run_due_jobs()'::regprocedure)) > 0,
  'events_run_due(): plans at most every 15 minutes; run_due_jobs() calls it');

-- ADR-106: open around the clock, no bells are planned and the session is always regular
select tests.set_cfg('time', '{marketOpenHour}', '0');
select tests.set_cfg('time', '{marketCloseHour}', '24');
delete from public.scheduled_events;
delete from public.job_runs where job_name = 'events_plan';
select public.events_plan(:'t0') ->> 'bells' as bells24 \gset
select tests.assert(
  public.market_always_open() and :bells24::int = 0
  and not exists (select 1 from public.scheduled_events where kind in ('opening_bell', 'closing_bell'))
  and public.market_session_at((current_date + time '03:00') at time zone 'Europe/Berlin') = 'regular'
  and public.market_session_at((current_date + time '23:30') at time zone 'Europe/Berlin') = 'regular',
  'open around the clock (0 to 24): no bells, every hour is a regular session');

-- restore
update public.game_config set value = :'cfg_events'::jsonb where key = 'events';
update public.game_config set value = :'cfg_cb'::jsonb where key = 'centralBank';
update public.game_config set value = :'cfg_time'::jsonb where key = 'time';
update public.central_bank_state set policy_rate_bps = :rate0, next_decision_at = null where id;
