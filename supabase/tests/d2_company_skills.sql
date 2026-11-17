-- =============================================================================
-- d2 · Fertigkeiten of player companies (ADR-194): locked without the skill of the map, learned with it (founder or
--      employee), paid from the company cash through the ledger, idempotent by request id, a level in training counts
--      one lower, the close hour lifts demand and lowers fixed costs modestly, every kind stops at its cap, money stays
--      whole.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0d2d2d2d-0000-4000-8000-0000000000a1'''
\set b '''0d2d2d2d-0000-4000-8000-0000000000b1'''
\set e '''0d2d2d2d-0000-4000-8000-0000000000e1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Fk_Anna') is not null and tests.signup(:b, 'Fk_Bruno') is not null
   and tests.signup(:e, 'Fk_Emil') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 20);
select tests.set_level(:b, 20);
select tests.fund(:a, 90000000, 'test:d2:a');
select tests.fund(:b, 90000000, 'test:d2:b');
select tests.set_cfg('startups', '{demandNoise}', '0') is null as ok \gset

select tests.assert((value ->> 'maxLevel')::integer = 5 and jsonb_array_length(value -> 'skills') = 9
                    and (value #>> '{costCentsByLevel,0}')::bigint = 100000
                    and (value #>> '{capBps,demand}')::integer = 1000,
  'd2: config companySkills') from public.game_config where key = 'companySkills';

select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Daten Zwei', 'Analysiert', 'tech', '#224466', 'garage') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.found_company(gen_random_uuid(), 'Bauch Zwei', 'Aus dem Bauch', 'tech', '#446622', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:a) as aco \gset
select tests.company_of(:b) as bco \gset
select tests.set_company_cash(:'aco', 5000000);
select tests.set_company_cash(:'bco', 5000000);
update public.player_companies set potential_annual_cents = 3000000, quality = 0.5, awareness = 0.3
 where company_id in (:'aco', :'bco');

-- ---------------------------------------------------------------------------
-- 1. Locked without the skill of the map
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :a);
select public.get_company_skills() as g0 \gset
select tests.throws_key($$select public.learn_company_skill(gen_random_uuid(), 'data_analysis')$$, 'skill_locked',
  'd2: data analysis is locked without "Datenanalyse" in the skill map');
reset role;
select tests.assert(jsonb_array_length(:'g0'::jsonb -> 'skills') = 9
                    and (select s ->> 'missing' from jsonb_array_elements(:'g0'::jsonb -> 'skills') s
                          where s ->> 'key' = 'data_analysis') = 'it_data'
                    and (select (s ->> 'next_cost_cents')::bigint from jsonb_array_elements(:'g0'::jsonb -> 'skills') s
                          where s ->> 'key' = 'data_analysis') = 100000,
  'd2: get_company_skills names the missing skill and the price of level 1');

-- ---------------------------------------------------------------------------
-- 2. The founder learns "Datenanalyse"; an employee brings "Buchhaltung"
-- ---------------------------------------------------------------------------
insert into public.player_skills (player_id, skill_key) values (:a, 'it_data') on conflict do nothing;
insert into public.player_skills (player_id, skill_key) values (:e, 'finance_accounting') on conflict do nothing;
select tests.money_invariant() = 'ok' as inv0 \gset
select tests.company_cash(:'aco') as c0 \gset
\set rq '''0d2d2d2d-1111-4000-8000-000000000001'''
select tests.login_as('authenticated', :a);
select public.learn_company_skill(:rq, 'data_analysis') as l1 \gset
select public.learn_company_skill(:rq, 'data_analysis') as l1b \gset
select tests.throws_key($$select public.learn_company_skill(gen_random_uuid(), 'data_analysis')$$, 'locked',
  'd2: no next level while the last one is in training');
select tests.throws_key($$select public.learn_company_skill(gen_random_uuid(), 'cost_control')$$, 'skill_locked',
  'd2: cost control is locked while nobody in the company holds "Buchhaltung"');
reset role;
select tests.assert((:'l1'::jsonb ->> 'learned_level')::integer = 1 and :'l1'::jsonb = :'l1b'::jsonb
                    and tests.company_cash(:'aco') = :c0::bigint - 100000
                    and (select count(*) from public.ledger_transactions where idempotency_key like 'company_skill:' || :'aco' || ':%') = 1
                    and (select level from public.company_skills where company_id = :'aco' and skill_key = 'data_analysis') = 1,
  'd2: level 1 costs 1 000 € once (idempotent request id), booked through the ledger');
select tests.assert(tests.near((public.company_skills_hour_effect(:'aco', public.game_now()) ->> 'demand_factor')::double precision, 1),
  'd2: a level in training does not work yet');

-- the employee: an active job in A's company with "Buchhaltung"
insert into public.player_jobs (player_id, company_id, status, salary_cents_per_hour, started_at, request_id, tier, title)
select :e, :'aco', 'active', 0, now(), gen_random_uuid(), 'intern', 'Praktikum'
 where not exists (select 1 from public.player_jobs where player_id = :e and status = 'active');
select tests.login_as('authenticated', :a);
select public.learn_company_skill(gen_random_uuid(), 'cost_control') as l2 \gset
reset role;
select tests.assert((select level from public.company_skills where company_id = :'aco' and skill_key = 'cost_control') = 1,
  'd2: an employee holding the skill opens the Fertigkeit too');

-- ---------------------------------------------------------------------------
-- 3. The close hour: more demand, lower fixed costs, modest profit lift
-- ---------------------------------------------------------------------------
update public.company_skills set ready_at = public.game_now() - interval '3 hours' where company_id = :'aco';
update public.player_jobs set status = 'ended', ended_at = now() where player_id = :e and company_id = :'aco';
select tests.assert(tests.near((public.company_skills_hour_effect(:'aco', public.game_now()) ->> 'demand_factor')::double precision, 1.01)
                and tests.near((public.company_skills_hour_effect(:'aco', public.game_now()) ->> 'fixed_factor')::double precision, 0.98)
                and tests.near((public.listed_hour_effect(:'aco', public.game_now()) #>> '{skills,demand_factor}')::double precision, 1.01),
  'd2: trained levels work: demand +1 %, fixed costs −2 %, part of the hour terms');
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) - interval '1 hour'
 where company_id in (:'aco', :'bco');
update public.player_companies set reputation = 50, task_momentum = 1 where company_id in (:'aco', :'bco');
select public.player_company_close_hour(:'aco', date_trunc('hour', public.game_now()) - interval '1 hour') is not null as ok \gset
select public.player_company_close_hour(:'bco', date_trunc('hour', public.game_now()) - interval '1 hour') is not null as ok \gset
select ha.demand_cents::float8 / greatest(1, hb.demand_cents) as dratio, ha.fixed_cents::float8 / greatest(1, hb.fixed_cents) as fratio,
       ha.profit_cents as pa, hb.profit_cents as pb, ha.revenue_cents as ra
  from public.player_company_hours ha, public.player_company_hours hb
 where ha.company_id = :'aco' and hb.company_id = :'bco'
   and ha.hour_start = date_trunc('hour', public.game_now()) - interval '1 hour' and hb.hour_start = ha.hour_start \gset
select tests.assert(tests.near(:dratio::float8, 1.01) and :fratio::float8 < 0.99 and :fratio::float8 > 0.97,
  format('d2: the close hour takes the terms (demand x %s, fixed costs x %s)', :dratio, :fratio));
select tests.assert(:pa::bigint > :pb::bigint and :pa::bigint - :pb::bigint <= greatest(abs(:pb::bigint), :ra::bigint) / 10 + 1000,
  format('d2: the profit rises modestly (%s vs %s)', :pa, :pb));

-- ---------------------------------------------------------------------------
-- 4. Caps and the money invariant
-- ---------------------------------------------------------------------------
insert into public.company_skills (company_id, skill_key, level, ready_at)
values (:'aco', 'campaigns', 5, now() - interval '1 day'), (:'aco', 'automation', 5, now() - interval '1 day'),
       (:'aco', 'leadership', 5, now() - interval '1 day'), (:'aco', 'contracts', 5, now() - interval '1 day'),
       (:'aco', 'supply_chain', 5, now() - interval '1 day'), (:'aco', 'craftsmanship', 5, now() - interval '1 day'),
       (:'aco', 'research', 5, now() - interval '1 day')
on conflict (company_id, skill_key) do update set level = 5, ready_at = excluded.ready_at;
update public.company_skills set level = 5 where company_id = :'aco';
select public.company_skills_hour_effect(:'aco', public.game_now()) as cap \gset
select tests.assert((:'cap'::jsonb ->> 'demand_factor')::float8 <= 1.1 + 1e-9
                    and (:'cap'::jsonb ->> 'capacity_factor')::float8 <= 1.1 + 1e-9
                    and (:'cap'::jsonb ->> 'cogs_factor')::float8 >= 0.92 - 1e-9
                    and (:'cap'::jsonb ->> 'fixed_factor')::float8 >= 0.9 - 1e-9
                    and (:'cap'::jsonb ->> 'quality_add')::float8 <= 0.05 + 1e-9,
  'd2: every kind stops at its cap');
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.learn_company_skill(gen_random_uuid(), 'data_analysis')$$, 'invalid_argument',
  'd2: no level above the maximum');
reset role;
select tests.assert(:'inv0'::boolean and tests.money_invariant() = 'ok', 'd2: the money invariant holds');
delete from public.company_skills where company_id = :'aco';
