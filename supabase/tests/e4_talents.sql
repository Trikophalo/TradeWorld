-- =============================================================================
-- e4 · Talente (ADR-199): pool of 15 Stellen, hire only when every demand is met, idempotent, one per Stelle, wage
--      and benefits booked hourly through the ledger, the effect in the close hour, warning and quitting when unmet
--      (the effect stops), poaching with a counter-offer and with a move after the window, the Mit-Geschäftsführung
--      (appointment, decision logged within the budget, never above it, undo), risen demands of hired talents with a
--      grace period and talent_raise (Nachtrag ADR-199), four players, money stays whole.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0e4e4e4e-0000-4000-8000-0000000000a1'''
\set b '''0e4e4e4e-0000-4000-8000-0000000000b1'''
\set c '''0e4e4e4e-0000-4000-8000-0000000000c1'''
\set d '''0e4e4e4e-0000-4000-8000-0000000000d1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:a, 'Tl_Anna') is not null and tests.signup(:b, 'Tl_Bruno') is not null
   and tests.signup(:c, 'Tl_Cleo') is not null and tests.signup(:d, 'Tl_Dana') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 20), tests.set_level(:b, 20), tests.set_level(:c, 20), tests.set_level(:d, 20);
select tests.fund(:a, 90000000, 'test:e4:a'), tests.fund(:b, 90000000, 'test:e4:b'),
       tests.fund(:c, 90000000, 'test:e4:c'), tests.fund(:d, 90000000, 'test:e4:d');
select tests.set_cfg('startups', '{demandNoise}', '0') is null as ok \gset
select tests.money_invariant() = 'ok' as inv0 \gset

do $$
declare
  p uuid;
  n text;
  i integer := 0;
begin
  foreach p in array array['0e4e4e4e-0000-4000-8000-0000000000a1', '0e4e4e4e-0000-4000-8000-0000000000b1',
                           '0e4e4e4e-0000-4000-8000-0000000000c1', '0e4e4e4e-0000-4000-8000-0000000000d1']::uuid[] loop
    i := i + 1;
    n := (array['Talent Eins', 'Talent Zwei', 'Talent Drei', 'Talent Vier'])[i];
    perform tests.login_as('authenticated', p);
    perform public.found_company(gen_random_uuid(), n, 'Talente', 'tech', '#224466', 'garage');
    reset role;
  end loop;
end;
$$;
select tests.company_of(:a) as aco \gset
select tests.company_of(:b) as bco \gset
select tests.company_of(:c) as cco \gset
select tests.company_of(:d) as dco \gset
select tests.set_company_cash(:'aco', 50000000), tests.set_company_cash(:'bco', 50000000),
       tests.set_company_cash(:'cco', 50000000), tests.set_company_cash(:'dco', 50000000);
update public.player_companies set potential_annual_cents = 3000000, quality = 0.5, awareness = 0.3, reputation = 50,
                                   task_momentum = 1
 where company_id in (:'aco', :'bco', :'cco', :'dco');

-- ---------------------------------------------------------------------------
-- 1. Pool
-- ---------------------------------------------------------------------------
select public.talents_ensure() >= 0 as ok \gset
select tests.assert((select count(*) from public.talents) = 660
                    and (select count(distinct role_key) from public.talents) = 15
                    and (select count(distinct first_name || ' ' || last_name) from public.talents) = 660
                    and (select count(*) from public.talents where tier = 4) = 30,
  'e4: 660 talents, 15 Stellen, unique names, two legends per Stelle');
-- make the test talents visible on the market regardless of the day's rotation
update public.game_config set value = jsonb_set(value, '{market,shareBps}', '10000') where key = 'talents';

select talent_key as tj, wage_demand_cents as tj_wage, effect_bps as tj_eff, benefit_demands as tj_ben
  from public.talents where role_key = 'sales' and tier = 0 and company_id is null order by talent_key limit 1 \gset
select talent_key as ts from public.talents where role_key = 'sales' and tier = 3 order by talent_key limit 1 \gset
select talent_key as tk2 from public.talents where role_key = 'sales' and tier = 0 and talent_key <> :'tj' order by talent_key limit 1 \gset

-- ---------------------------------------------------------------------------
-- 2. Hire: refused unless every demand is met, then hired (idempotent), one per Stelle
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.talent_offer(gen_random_uuid(), %L, %s, %L)$$, :'tj', :tj_wage::bigint - 100, :'tj_ben'),
  'demands_not_met', 'e4: a wage below the demand is refused');
select tests.throws_key(format($$select public.talent_offer(gen_random_uuid(), %L, 99999900, '{}')$$, :'ts'),
  'demands_not_met', 'e4: an expert refuses a garage company (legal form, reputation, benefits)');
select tests.throws_key(format($$select public.talent_offer(gen_random_uuid(), %L, 4050, '{}')$$, :'tj'),
  'invalid_argument', 'e4: wages are whole euros');
select public.talent_offer('0e4e4e4e-0000-4000-8000-00000000f001', :'tj', :tj_wage, :'tj_ben') as h1 \gset
select public.talent_offer('0e4e4e4e-0000-4000-8000-00000000f001', :'tj', :tj_wage, :'tj_ben') as h2 \gset
select tests.throws_key(format($$select public.talent_offer(gen_random_uuid(), %L, 99999900, '{homeoffice,company_car,bonus,training,say,gym,flextime}')$$, :'tk2'),
  'seat_taken', 'e4: one talent per Stelle');
select public.get_company_talents() as g1 \gset
reset role;
select tests.assert(:'h1'::jsonb ->> 'result' = 'hired' and :'h1'::jsonb = :'h2'::jsonb
                    and (select company_id from public.talents where talent_key = :'tj') = :'aco'::uuid
                    and jsonb_array_length(:'g1'::jsonb -> 'seats') = 15
                    and (select count(*) from jsonb_array_elements(:'g1'::jsonb -> 'seats') s where s -> 'talent' <> 'null'::jsonb) = 1,
  'e4: hired when all is met, the replay returns the same answer, 15 seats with one filled');
-- the org chart (open to every player) lists the talent above the AI workers, without wage or satisfaction
select tests.login_as('authenticated', :b);
select public.get_company_org(:'aco') as org1 \gset
reset role;
select tests.assert(jsonb_array_length(:'org1'::jsonb -> 'talents') = 1
                    and :'org1'::jsonb #>> '{talents,0,key}' = :'tj'
                    and :'org1'::jsonb #>> '{talents,0,role}' = 'sales'
                    and not (:'org1'::jsonb -> 'talents' -> 0) ? 'wage_cents'
                    and not (:'org1'::jsonb -> 'talents' -> 0) ? 'satisfaction_bps',
  'e4: the org chart shows the hired talent (public facts only) to other players');

-- ---------------------------------------------------------------------------
-- 3. Effect in the close hour (A with a sales talent vs B without)
-- ---------------------------------------------------------------------------
select tests.assert(tests.near((public.listed_hour_effect(:'aco', public.game_now()) #>> '{talents,demand_factor}')::float8,
                               1 + :tj_eff::float8 / 10000)
                    and tests.near((public.listed_hour_effect(:'bco', public.game_now()) #>> '{talents,demand_factor}')::float8, 1),
  'e4: the hour terms carry the talent''s demand factor');
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) - interval '1 hour'
 where company_id in (:'aco', :'bco');
select public.player_company_close_hour(:'aco', date_trunc('hour', public.game_now()) - interval '1 hour') is not null as ok \gset
select public.player_company_close_hour(:'bco', date_trunc('hour', public.game_now()) - interval '1 hour') is not null as ok \gset
select ha.demand_cents::float8 / greatest(1, hb.demand_cents) as dratio
  from public.player_company_hours ha, public.player_company_hours hb
 where ha.company_id = :'aco' and hb.company_id = :'bco'
   and ha.hour_start = date_trunc('hour', public.game_now()) - interval '1 hour' and hb.hour_start = ha.hour_start \gset
select tests.assert(tests.near(:dratio::float8, 1 + :tj_eff::float8 / 10000),
  format('e4: the close hour lifts the demand by the talent (x %s)', :dratio));

-- ---------------------------------------------------------------------------
-- 4. Wage booked through the ledger, satisfaction rises
-- ---------------------------------------------------------------------------
select tests.company_cash(:'aco') as cash0 \gset
select public.talent_offer_cost(:tj_wage::bigint, :'tj_ben') as tj_cost \gset
update public.talents set paid_until = public.game_now() - interval '2 hours', satisfaction_bps = 7000 where talent_key = :'tj';
select public.talents_run_due() is not null as ok \gset
select tests.assert(tests.company_cash(:'aco') = :cash0::bigint - 2 * :tj_cost::bigint
                    and (select count(*) from public.talent_hours where talent_key = :'tj' and paid) = 2
                    and (select satisfaction_bps from public.talents where talent_key = :'tj') = 7500,
  'e4: two hours of wage and benefits booked from the company cash, satisfaction +250 per hour');
select public.talents_run_due() is not null as ok \gset
select tests.assert(tests.company_cash(:'aco') = :cash0::bigint - 2 * :tj_cost::bigint,
  'e4: running again books nothing twice');

-- ---------------------------------------------------------------------------
-- 5. Unmet: warning, then quitting; the effect stops at once
-- ---------------------------------------------------------------------------
select tests.set_company_cash(:'aco', 0);
update public.talents set paid_until = public.game_now() - interval '1 hour', satisfaction_bps = 5000, warned_at = null,
                          traits = '{sporty,night_owl}'
 where talent_key = :'tj';
select public.talents_run_due() is not null as ok \gset
select tests.assert((select warned_at is not null and company_id = :'aco'::uuid from public.talents where talent_key = :'tj')
                    and exists (select 1 from public.talent_events where talent_key = :'tj' and kind = 'warned')
                    and exists (select 1 from public.notifications n where n.player_id = :a and n.type_key = 'company_talent'),
  'e4: unpaid -> unhappy: a warning and a notification to the owner');
update public.talents set paid_until = public.game_now() - interval '3 hours' where talent_key = :'tj';
select public.talents_run_due() is not null as ok \gset
select tests.assert((select company_id is null and resting_until > public.game_now() from public.talents where talent_key = :'tj')
                    and exists (select 1 from public.talent_events where talent_key = :'tj' and kind = 'quit')
                    and tests.near((public.listed_hour_effect(:'aco', public.game_now()) #>> '{talents,demand_factor}')::float8, 1),
  'e4: still unmet -> the talent quits, rests, and the effect is gone');
select tests.set_company_cash(:'aco', 50000000);

-- ---------------------------------------------------------------------------
-- 6. Poaching with a counter-offer, then a move after the window
-- ---------------------------------------------------------------------------
select talent_key as tp, wage_demand_cents as tp_wage, benefit_demands as tp_ben
  from public.talents where role_key = 'it' and tier = 0 and company_id is null order by talent_key limit 1 \gset
select tests.login_as('authenticated', :a);
select public.talent_offer(gen_random_uuid(), :'tp', :tp_wage, :'tp_ben') is not null as ok \gset
reset role;
select public.talent_poach_min_cost(t) as tp_min from public.talents t where talent_key = :'tp' \gset
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.talent_offer(gen_random_uuid(), %L, %s, %L)$$, :'tp', :tp_wage, :'tp_ben'),
  'offer_too_low', 'e4: poaching needs more than the current contract');
select public.talent_offer(gen_random_uuid(), :'tp', (ceil(:tp_min::numeric * 1.3 / 100) * 100)::bigint, :'tp_ben') as po \gset
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key(format($$select public.talent_offer(gen_random_uuid(), %L, 99999900, %L)$$, :'tp', :'tp_ben'),
  'offer_pending', 'e4: one poaching attempt at a time');
reset role;
select tests.assert(:'po'::jsonb ->> 'result' = 'pending'
                    and exists (select 1 from public.notifications n where n.player_id = :a and n.title = 'Abwerbeversuch'),
  'e4: a strong offer opens a poaching attempt and notifies the owner');
select :'po'::jsonb ->> 'offer_id' as oid \gset
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.talent_counter(gen_random_uuid(), %L, %s, %L)$$, :'oid', :tp_wage, :'tp_ben'),
  'offer_too_low', 'e4: a counter-offer must match the poacher');
select public.talent_counter(gen_random_uuid(), :'oid', (ceil(:tp_min::numeric * 1.3 / 100) * 100 + 1000)::bigint, :'tp_ben') is not null as ok \gset
reset role;
select tests.assert((select company_id = :'aco'::uuid from public.talents where talent_key = :'tp')
                    and (select status from public.talent_offers where id = :'oid') = 'countered',
  'e4: the counter-offer keeps the talent');
select public.talent_poach_min_cost(t) as tp_min2 from public.talents t where talent_key = :'tp' \gset
select tests.login_as('authenticated', :b);
select public.talent_offer(gen_random_uuid(), :'tp', (ceil(:tp_min2::numeric * 1.1 / 100) * 100)::bigint, :'tp_ben') as po2 \gset
reset role;
update public.talent_offers set expires_at = public.game_now() - interval '1 second' where id = (:'po2'::jsonb ->> 'offer_id')::uuid;
select public.talents_run_due() is not null as ok \gset
select tests.assert((select company_id = :'bco'::uuid from public.talents where talent_key = :'tp')
                    and exists (select 1 from public.talent_events where company_id = :'aco' and talent_key = :'tp' and kind = 'poached'),
  'e4: without a counter the talent moves after the window');

-- ---------------------------------------------------------------------------
-- 6b. Risen demand (Nachtrag ADR-199): grace period with notification, then unhappy until the owner pays more
-- ---------------------------------------------------------------------------
select talent_key as tr, wage_demand_cents as tr_wage, benefit_demands as tr_ben
  from public.talents where role_key = 'logistics' and tier = 0 and company_id is null order by talent_key limit 1 \gset
select public.talent_hire_into(:'tr', :'cco', :tr_wage::bigint, :'tr_ben', public.game_now());
select (o - 1)::text as tr_idx from jsonb_array_elements(public.talents_cfg() -> 'pool') with ordinality as p(v, o)
 where v ->> 'key' = :'tr' \gset
update public.game_config set value = jsonb_set(value, array['pool', :'tr_idx', 'wageCents'], to_jsonb(:tr_wage::bigint * 3))
 where key = 'talents';
select public.talents_ensure() >= 0 as ok \gset
select tests.assert((select wage_demand_cents = :tr_wage::bigint * 3 and wage_cents = :tr_wage::bigint
                            and raise_due_at between public.game_now() + interval '23 hours' and public.game_now() + interval '25 hours'
                       from public.talents where talent_key = :'tr')
                    and exists (select 1 from public.talent_events where talent_key = :'tr' and kind = 'demand_raised')
                    and exists (select 1 from public.notifications n where n.player_id = :c and n.title = 'Gehaltsforderung gestiegen'),
  'e4: a changed pool reaches hired talents: the demand rises, 24 hours of grace, the owner is notified');
select public.talents_ensure() = 0 as ok \gset
select tests.assert(:'ok'::boolean, 'e4: an unchanged pool is not synced again');
-- neutral traits (after the sync, which writes the generated fields back)
update public.talents set traits = '{sporty,night_owl}' where talent_key = :'tr';
update public.talents set paid_until = public.game_now() - interval '1 hour', satisfaction_bps = 7000 where talent_key = :'tr';
select public.talents_run_due() is not null as ok \gset
select tests.assert((select satisfaction_bps from public.talents where talent_key = :'tr') = 7250,
  'e4: within the grace period the old wage still satisfies');
update public.talents set paid_until = public.game_now() - interval '90 minutes', raise_due_at = public.game_now() - interval '2 hours'
 where talent_key = :'tr';
select public.talents_run_due() is not null as ok \gset
select tests.assert((select satisfaction_bps from public.talents where talent_key = :'tr') = 7250 - 1500,
  'e4: after the grace period an underpaid talent loses satisfaction every hour');
select tests.login_as('authenticated', :c);
select (public.get_company_talents() -> 'seats') as tr_seats \gset
select tests.throws_key(format($$select public.talent_raise(gen_random_uuid(), %L, %s, %L)$$, :'tr', :tr_wage::bigint * 3 - 100, :'tr_ben'),
  'demands_not_met', 'e4: a new contract below the demand is refused');
select tests.throws_key(format($$select public.talent_raise(gen_random_uuid(), %L, %s, %L)$$, :'tp', :tr_wage::bigint * 9, :'tr_ben'),
  'invalid_argument', 'e4: only own talents');
select public.talent_raise(gen_random_uuid(), :'tr', :tr_wage::bigint * 3, :'tr_ben') as rz1 \gset
reset role;
select tests.assert(exists (select 1 from jsonb_array_elements(:'tr_seats'::jsonb) x
                             where x #>> '{talent,key}' = :'tr' and x #>> '{talent,raise_due_at}' is not null
                               and (x #>> '{talent,wage_floor_cents}')::bigint = :tr_wage::bigint * 3)
                    and (select wage_cents = :tr_wage::bigint * 3 and raise_due_at is null from public.talents where talent_key = :'tr')
                    and exists (select 1 from public.talent_events where talent_key = :'tr' and kind = 'raised'),
  'e4: the owner sees the deadline and raises the wage; the deadline is gone');
update public.game_config set value = jsonb_set(value, array['pool', :'tr_idx', 'wageCents'], to_jsonb(:tr_wage::bigint))
 where key = 'talents';
select public.talents_ensure() >= 0 as ok \gset
select tests.assert((select wage_demand_cents = :tr_wage::bigint and raise_due_at is null from public.talents where talent_key = :'tr'),
  'e4: back to the old pool, no deadline');

-- ---------------------------------------------------------------------------
-- 7. Mit-Geschäftsführung: appointment, decisions within the budget, never above, undo
-- ---------------------------------------------------------------------------
select talent_key as tc, wage_demand_cents as tc_wage from public.talents
 where role_key = 'strategy' and tier = 2 and company_id is null order by talent_key limit 1 \gset
select talent_key as tjr from public.talents where role_key = 'controlling' and tier = 0 and company_id is null
   and not ('leader' = any (traits)) order by talent_key limit 1 \gset
select public.talent_hire_into(:'tc', :'dco', :tc_wage::bigint, (select benefit_demands from public.talents where talent_key = :'tc'), public.game_now());
select public.talent_hire_into(:'tjr', :'dco', 10000, '{}', public.game_now());
select public.talent_coceo_style(traits) as tc_style from public.talents where talent_key = :'tc' \gset
select tests.login_as('authenticated', :d);
select tests.throws_key(format($$select public.talent_coceo_appoint(gen_random_uuid(), %L, 99999900, 'decide', 100000)$$, :'tjr'),
  'not_eligible', 'e4: a junior cannot become Mit-GF');
select tests.throws_key(format($$select public.talent_coceo_appoint(gen_random_uuid(), %L, %s, 'decide', 100000)$$, :'tc', :tc_wage),
  'offer_too_low', 'e4: Mit-GF needs a higher wage');
select tests.throws_key(format($$select public.talent_coceo_appoint(gen_random_uuid(), %L, 99999900, 'decide', 999999999)$$, :'tc'),
  'invalid_argument', 'e4: the budget has a maximum');
select public.talent_coceo_appoint(gen_random_uuid(), :'tc', (ceil(:tc_wage::numeric * 1.3 / 100) * 100 + 100)::bigint, 'decide', 100000) is not null as ok \gset
reset role;
select tests.assert((select is_coceo and 'say' = any (benefits) from public.talents where talent_key = :'tc'),
  'e4: appointed with Mitspracherecht');
insert into public.player_skills (player_id, skill_key) values (:d, 'it_data') on conflict do nothing;
insert into public.player_company_events (company_id, archetype, polarity, severity, definition, started_at, deadline_at)
values (:'dco', 'd5_test', 'crisis', 1,
        '{"lastsHours":4,"strategies":[{"key":"fast","mitigation":0.3,"steps":[{"k":1}]},{"key":"thorough","mitigation":0.9,"steps":[{"k":1},{"k":2},{"k":3}]}]}',
        public.game_now() - interval '2 hours', public.game_now() + interval '3 hours');
select tests.company_cash(:'dco') as dcash0 \gset
select public.talents_run_due() is not null as ok \gset
select public.talent_coceo_pick('[{"key":"fast","mitigation":0.3,"steps":[1]},{"key":"thorough","mitigation":0.9,"steps":[1,2,3]}]', :'tc_style') as want \gset
select tests.assert((select strategy from public.player_company_events where company_id = :'dco' and archetype = 'd5_test') = :'want'
                    and exists (select 1 from public.talent_events where company_id = :'dco' and kind = 'decision'
                                  and payload ->> 'action' = 'event_strategy' and payload ? 'name')
                    and exists (select 1 from public.company_news where company_id = :'dco' and kind = 'talent_decision')
                    and coalesce((select enabled from public.company_autopilot where company_id = :'dco'), false),
  format('e4: the Mit-GF (%s) responds to the event with "%s", switches the autopilot on, logs it with the name', :'tc_style', :'want'));
select tests.assert((select coceo_spent_cents <= coceo_budget_cents from public.talents where talent_key = :'tc')
                    and (case when :'tc_style' = 'cautious'
                              then not exists (select 1 from public.company_skills where company_id = :'dco')
                              else (select level from public.company_skills where company_id = :'dco' and skill_key = 'data_analysis') = 1
                                   and (select coceo_spent_cents from public.talents where talent_key = :'tc') = 100000 end),
  'e4: a Fertigkeit is bought only within the budget (cautious: half of it)');
update public.talents set coceo_last_run = public.game_now() - interval '2 hours' where talent_key = :'tc';
insert into public.player_skills (player_id, skill_key) values (:d, 'it_programming') on conflict do nothing;
select public.talents_run_due() is not null as ok \gset
select tests.assert((select coceo_spent_cents <= coceo_budget_cents from public.talents where talent_key = :'tc')
                    and coalesce((select sum(spent_cents) from public.company_skills where company_id = :'dco'), 0) <= 100000,
  'e4: never above the day budget');
select id as undo_id from public.talent_events where company_id = :'dco' and payload ->> 'action' = 'autopilot_on' limit 1 \gset
select tests.login_as('authenticated', :d);
select public.talent_undo_decision(gen_random_uuid(), :undo_id) is not null as ok \gset
reset role;
update public.talents set coceo_last_run = public.game_now() - interval '2 hours' where talent_key = :'tc';
select public.talents_run_due() is not null as ok \gset
select tests.assert(not coalesce((select enabled from public.company_autopilot where company_id = :'dco'), false),
  'e4: the owner undoes the autopilot and the Mit-GF respects it');

-- ---------------------------------------------------------------------------
-- 8. RLS and the money invariant
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :c);
select (select count(*) from public.talent_events where company_id = :'aco') as c_sees_a,
       (select count(*) from public.talents) as c_sees_market \gset
reset role;
select tests.assert(:c_sees_a::integer = 0 and :c_sees_market::integer = 660, 'e4: RLS: the market is public, the log is private');
select tests.assert(:'inv0'::boolean and tests.money_invariant() = 'ok', 'e4: the money invariant holds');

-- clean up for later files
delete from public.player_company_events where archetype = 'd5_test';
update public.talents set company_id = null, is_coceo = false, resting_until = null where company_id is not null or resting_until is not null;
update public.game_config set value = jsonb_set(value, '{market,shareBps}', '6500') where key = 'talents';
update public.talents t set traits = array(select jsonb_array_elements_text(p -> 'traits'))
  from jsonb_array_elements(public.talents_cfg() -> 'pool') p where p ->> 'key' = t.talent_key and t.talent_key = :'tj';
