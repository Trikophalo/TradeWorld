-- =============================================================================
-- d5 · Clone with its own job, skill-scaled pay, profit share and employee shares (ADR-206): the clone from level 20,
--      one per player, never at the own company, earns a wage into the owner's cash; pay follows the skills; the
--      profit share stops at 5 % per job and at the company cap per hour; employee shares come from the free float and
--      never grow the share supply; the money stays whole.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0d5d5d5d-0000-4000-8000-0000000000a1'''
\set b '''0d5d5d5d-0000-4000-8000-0000000000b1'''
\set f '''0d5d5d5d-0000-4000-8000-0000000000f1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Kl_Anna') is not null and tests.signup(:b, 'Kl_Bruno') is not null
   and tests.signup(:f, 'Kl_Frida') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 19);
select tests.set_level(:b, 25);
select tests.set_level(:f, 20);
select tests.fund(:a, 50000000, 'test:d5:a');
select tests.fund(:f, 90000000, 'test:d5:f');
-- Anna knows some IT: score 12, 6 skills
insert into public.player_skills (player_id, skill_key)
select :a, k from unnest(array['it_basics', 'it_programming', 'it_data', 'it_networks', 'it_web', 'it_architecture']) k
on conflict do nothing;
select tests.money_invariant() = 'ok' as inv0 \gset

-- ---------------------------------------------------------------------------
-- 1. Level gate, one clone per player, fee through the ledger
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.create_clone(gen_random_uuid())$$, 'clone_level_too_low',
  'd5: no clone below level 20');
select tests.throws_key($$select public.clone_apply_for_job(gen_random_uuid(), gen_random_uuid(), 1, null)$$, 'clone_missing',
  'd5: without a clone there is no clone job');
reset role;
select tests.set_level(:a, 20);
select tests.cash(:a) as cash0 \gset
\set rq '''0d5d5d5d-1111-4000-8000-000000000001'''
select tests.login_as('authenticated', :a);
select public.create_clone(:rq) as c1 \gset
select public.create_clone(:rq) as c1b \gset
select tests.throws_key($$select public.create_clone(gen_random_uuid())$$, 'clone_exists', 'd5: only one clone per player');
reset role;
select tests.assert(:'c1'::jsonb = :'c1b'::jsonb and :'c1'::jsonb #>> '{clone,name}' = 'Klon von Kl_Anna'
                    and :'c1'::jsonb -> 'job' = 'null'::jsonb
                    and tests.cash(:a) = :cash0::bigint - 2500000
                    and (select count(*) from public.player_clones where player_id = :a) = 1,
  'd5: the clone costs 25 000 € once (idempotent request id) and is called "Klon von Kl_Anna"');

-- ---------------------------------------------------------------------------
-- 2. Own job and clone job at two AI companies
-- ---------------------------------------------------------------------------
select c.id as ai1, c.security_id as sec1 from public.companies c where c.is_ai and c.phase = 'listed' and c.security_id is not null
 order by c.ticker limit 1 \gset
select c.id as ai2 from public.companies c where c.is_ai and c.phase = 'listed' and c.security_id is not null
 order by c.ticker offset 1 limit 1 \gset
insert into public.job_postings (company_id, tier, title_key, required, salary_cents_per_hour, is_ai, status)
values (:'ai1', 'intern', 'it_intern', '[{"branch": "it", "min_score": 0}]', 15000, true, 'open'),
       (:'ai2', 'senior', 'it_senior', '[{"branch": "it", "min_score": 6}]', 70000, true, 'open');
select id as p_own from public.job_postings where company_id = :'ai1' and title_key = 'it_intern' and is_ai and slots is null
 and ai_slot is null order by created_at desc limit 1 \gset
select id as p_clone from public.job_postings where company_id = :'ai2' and title_key = 'it_senior' and is_ai and ai_slot is null
 order by created_at desc limit 1 \gset
select tests.login_as('authenticated', :a);
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'p_own', 15000, null) ->> 'id')::uuid,
                            'M1 1') is not null as ok \gset
-- the clone cannot sign the own application, the owner cannot sign the clone's
select (public.clone_apply_for_job(gen_random_uuid(), :'p_clone', 1, null) ->> 'id') as capp \gset
select tests.throws_key(format($$select public.sign_contract(gen_random_uuid(), %L, 'M1 1')$$, :'capp'), 'application_not_found',
  'd5: the owner cannot sign the clone''s application');
-- the clone at the own job's company: refused
select (public.clone_apply_for_job(gen_random_uuid(), :'p_own', 1, null) ->> 'id') as capp2 \gset
select tests.throws_key(format($$select public.clone_sign_contract(gen_random_uuid(), %L, 'M1 1')$$, :'capp2'), 'clone_same_company',
  'd5: owner and clone never work at the same company');
select public.clone_sign_contract(gen_random_uuid(), :'capp', 'M2 2') as cs \gset
select public.get_job_board() as board \gset
select public.get_clone() as cl \gset
select public.get_my_job() as mine \gset
reset role;
select tests.assert(:'cs'::jsonb #>> '{job,company,id}' = :'ai2' and (:'cs'::jsonb #>> '{job,is_clone}')::boolean
                    and :'cs'::jsonb #>> '{job,holder_name}' = 'Klon von Kl_Anna'
                    and :'mine'::jsonb #>> '{job,company,id}' = :'ai1' and not (:'mine'::jsonb #>> '{job,is_clone}')::boolean
                    and :'cl'::jsonb #>> '{job,company,id}' = :'ai2'
                    and (select count(*) from public.player_jobs where player_id = :a and status = 'active') = 2,
  'd5: two active jobs, the own one and the clone''s, each shown by its own state');
select tests.assert((select x -> 'my_clone_application' ->> 'status' from jsonb_array_elements(:'board'::jsonb -> 'postings') x
                      where x ->> 'id' = :'p_clone') = 'signed'
                    and (select x -> 'my_application' from jsonb_array_elements(:'board'::jsonb -> 'postings') x
                          where x ->> 'id' = :'p_clone') = 'null'::jsonb
                    and (:'board'::jsonb ->> 'has_clone')::boolean,
  'd5: the job board tells the own and the clone''s application apart');
select tests.login_as('authenticated', :a);
select public.clone_apply_for_job(gen_random_uuid(), :'p_own', 1, null) is not null as ok \gset
select tests.throws_key(format($$select public.clone_apply_for_job(gen_random_uuid(), %L, 1, null)$$, :'p_own'), 'application_exists',
  'd5: one application per posting and holder');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Skill-scaled pay
-- ---------------------------------------------------------------------------
select tests.assert(public.job_skill_pay_bps('{"it": 12}', 15, '[{"branch": "it", "min_score": 6}]') = 14350
                    and public.job_skill_pay_bps('{"it": 30}', 40, '[{"branch": "it", "min_score": 6}]') = 21000
                    and public.job_skill_pay_bps('{"it": 90, "management": 90}', 80,
                                                 '[{"branch": "it", "min_score": 12}, {"branch": "management", "min_score": 6}]') = 30000
                    and public.job_skill_pay_bps('{"law": 30}', 0, '[{"branch": "it", "min_score": 6}]') = 10000,
  'd5: pay factor = 1 + 3 % per relevant score point (40 per branch) + 0.5 % per skill, at most 3x');
select tests.assert(public.ai_salary_ceiling(70000, public.job_match_score('{"it": 30}', '[{"branch": "it", "min_score": 6}]')) = 95200
                    and public.job_pay_ceiling(:a, 70000, '[{"branch": "it", "min_score": 6}]')
                        = round(70000 * (10000 + 300 * (select (public.player_branch_scores(:a) ->> 'it')::integer)
                                         + 50 * public.player_skill_count(:a)) / 10000.0)
                    and (:'cs'::jsonb #>> '{job,salary_cents_per_hour}')::bigint = public.job_pay_ceiling(:a, 70000, '[{"branch": "it", "min_score": 6}]'),
  format('d5: the AI senior job pays the skill ceiling (%s instead of the old %s for score 30)',
         round(70000 * 2.1), public.ai_salary_ceiling(70000, 12)));

-- ---------------------------------------------------------------------------
-- 4. The clone earns: wage into the owner's cash, profit share from Senior
-- ---------------------------------------------------------------------------
select id as cjob from public.player_jobs where player_id = :a and status = 'active' and is_clone \gset
update public.player_jobs set last_paid_at = public.game_now() - interval '2 hours', paid_day = null where id = :'cjob';
update public.companies set ttm_net_income_cents = greatest(coalesce(ttm_net_income_cents, 0), 10000000000) where id = :'ai2';
select tests.cash(:a) as cash1 \gset
select public.accrue_salaries() is not null as ok \gset
select coalesce(sum(amount_cents), 0) as cwage from public.salary_payouts where player_job_id = :'cjob' \gset
select coalesce(sum(amount_cents), 0) as cshare from public.job_rewards where player_job_id = :'cjob' and kind = 'profit_share' \gset
select tests.assert(:cwage::bigint > 0 and :cshare::bigint > 0
                    and :cshare::bigint <= (select salary_cents_per_hour * 2 from public.player_jobs where id = :'cjob')
                    and tests.cash(:a) >= :cash1::bigint + :cwage::bigint + :cshare::bigint,
  format('d5: the clone earned %s wage and %s profit share for two hours, paid to the owner', :cwage, :cshare));
select tests.assert((select share_bps from public.job_rewards where player_job_id = :'cjob' and kind = 'profit_share' limit 1) = 50,
  'd5: a Senior gets 0.5 % profit share');

-- ---------------------------------------------------------------------------
-- 5. Founders: own company AND a clone job; the clone never in the own company
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Klon Werk', 'Baut Klone', 'tech', '#663399', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.set_company_cash(:'fco', 10000000);
select tests.login_as('authenticated', :f);
select (public.create_job_posting(gen_random_uuid(), :'fco', 'senior', 'Klon-Entwicklung', '[{"branch": "it", "min_score": 0}]',
                                  50000, 3) ->> 'id') as fpost \gset
select tests.throws_key(format($$select public.set_job_posting_perks(gen_random_uuid(), %L, 301, 0)$$, :'fpost'), 'invalid_argument',
  'd5: a posting offers at most 3 % extra profit share');
select public.set_job_posting_perks(gen_random_uuid(), :'fpost', 300, 500) is not null as ok \gset
select public.create_clone(gen_random_uuid()) is not null as ok \gset
select tests.throws_key(format($$select public.clone_apply_for_job(gen_random_uuid(), %L, 50000, null)$$, :'fpost'), 'clone_own_company',
  'd5: the clone never works at the own company');
select (public.clone_apply_for_job(gen_random_uuid(), :'p_own', 1, null) ->> 'id') as fapp \gset
select public.clone_sign_contract(gen_random_uuid(), :'fapp', 'M1 1') is not null as ok \gset
reset role;
select tests.assert(exists (select 1 from public.player_jobs where player_id = :f and status = 'active' and is_clone and company_id = :'ai1')
                    and exists (select 1 from public.player_companies where founder_id = :f and status = 'active'),
  'd5: a founder owns the company and works elsewhere through the clone');

-- ---------------------------------------------------------------------------
-- 6. Profit share in a player company: 5 % per job at most, the company cap per hour
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :b);
select (public.apply_for_job(gen_random_uuid(), :'fpost', 50000, null) ->> 'id') as bapp \gset
reset role;
select tests.login_as('authenticated', :f);
select public.respond_application(gen_random_uuid(), :'bapp', 'accept', null) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.sign_contract(gen_random_uuid(), :'bapp', 'M1 1') is not null as ok \gset
reset role;
select id as bjob from public.player_jobs where player_id = :b and status = 'active' and company_id = :'fco' \gset
select tests.assert((select profit_share_bonus_bps = 300 and stock_grant_bonus_bps = 500 from public.player_jobs where id = :'bjob')
                    and public.job_profit_share_bps('senior', 300) = 350 and public.job_profit_share_bps('c_level', 300) = 500
                    and public.job_profit_share_bps('c_level', 10000) = 500 and public.job_profit_share_bps('junior', 300) = 0,
  'd5: the posting''s extra goes with the job; every share stops at 5 %, below Senior there is none');
update public.player_jobs set tier = 'c_level' where id = :'bjob';
select tests.company_cash(:'fco') as fc0 \gset
select tests.cash(:b) as bc0 \gset
select public.job_rewards_company_hour(:'fco', date_trunc('hour', now()) - interval '5 hours', 1000000) as paid1 \gset
select public.job_rewards_company_hour(:'fco', date_trunc('hour', now()) - interval '5 hours', 1000000) as paid1b \gset
select public.job_rewards_company_hour(:'fco', date_trunc('hour', now()) - interval '4 hours', -500) as paid0 \gset
select amount_cents as bshare from public.job_rewards where player_job_id = :'bjob' and kind = 'profit_share' \gset
select tests.assert(:bshare::bigint = 50000 and :paid1b::bigint = 0 and :paid0::bigint = 0
                    and tests.company_cash(:'fco') = :fc0::bigint - :paid1::bigint
                    and tests.cash(:b) - :bc0::bigint >= :bshare::bigint,
  format('d5: a C-Level gets 5 %% of a profitable hour (%s of 1 000 000), once per hour, nothing without profit', :bshare));
-- many big shares: together at most 25 % of the hour's profit
-- Anna's own job is at ai1; move it to Frida's company for this check
update public.player_jobs set company_id = :'fco', tier = 'c_level' where player_id = :a and status = 'active' and not is_clone;
select (select value from public.game_config where key = 'jobs') as jobs_cfg \gset
insert into public.game_config (key, value) values ('jobs', '{}') on conflict (key) do nothing;
update public.game_config set value = jsonb_set(value, '{rewards}',
                                                coalesce(value -> 'rewards', '{}') || '{"maxTotalProfitShareBps": 600}')
 where key = 'jobs';
select public.job_rewards_company_hour(:'fco', date_trunc('hour', now()) - interval '3 hours', 1000000) as paid2 \gset
update public.game_config set value = nullif(:'jobs_cfg', '')::jsonb where key = 'jobs' and :'jobs_cfg' <> '';
delete from public.game_config where key = 'jobs' and :'jobs_cfg' = '';
select tests.assert((select coalesce(sum(amount_cents), 0) from public.job_rewards
                      where company_id = :'fco' and kind = 'profit_share' and source_key like '%:' || floor(extract(epoch from date_trunc('hour', now()) - interval '3 hours'))::bigint::text) <= 60000,
  format('d5: all profit shares of an hour together stay within the company cap (%s of at most 60 000)', :paid2));

-- ---------------------------------------------------------------------------
-- 7. Employee shares: from the free float, the supply never grows
-- ---------------------------------------------------------------------------
select shares_outstanding as shares0 from public.companies where id = :'ai1' \gset
select coalesce(sum(quantity_e6), 0) as held0 from public.positions where security_id = :'sec1' and status = 'open' and side = 'long' \gset
select public.security_free_float_e6(:'sec1') as free0 \gset
select id as ojob from public.player_jobs where player_id = :f and status = 'active' and is_clone \gset
update public.player_jobs set salary_cents_per_hour = 1000000 where id = :'ojob';
select public.job_stock_grant(:'ojob', 'test:d5:1') as g1 \gset
select public.job_stock_grant(:'ojob', 'test:d5:1') as g1b \gset
select quantity_e6 as gq from public.job_rewards where source_key = 'grant:test:d5:1' \gset
select tests.assert(:g1::bigint > 0 and :g1b::bigint = 0 and :gq::bigint > 0 and :gq::bigint % 1000000 = 0
                    and public.security_free_float_e6(:'sec1') = :free0::bigint - :gq::bigint
                    and (select kind from public.job_rewards where source_key = 'grant:test:d5:1') = 'stock_grant'
                    and exists (select 1 from public.notifications n where n.player_id = :f and n.type_key = 'job_reward'),
  format('d5: an employee grant of %s shares comes from the free float, once per key', :gq::bigint / 1000000));
-- nothing left free: only a few shares exist beyond what players hold
update public.companies set shares_outstanding = (:held0::bigint + :gq::bigint + 999999) / 1000000 where id = :'ai1';
select public.job_stock_grant(:'ojob', 'test:d5:2') as g2 \gset
select tests.assert((select kind from public.job_rewards where source_key = 'grant:test:d5:2') = 'stock_grant_cash'
                    and (select coalesce(sum(quantity_e6), 0) from public.positions
                          where security_id = :'sec1' and status = 'open' and side = 'long')
                        <= (select shares_outstanding * 1000000 from public.companies where id = :'ai1'),
  'd5: without free shares the grant is paid in cash, held shares never exceed the supply');
update public.companies set shares_outstanding = :shares0 where id = :'ai1';

-- ---------------------------------------------------------------------------
-- 8. Quit with notice works for the clone and leaves the own job alone
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :a);
select public.clone_quit_job(gen_random_uuid(), false) as q1 \gset
select public.clone_cancel_quit(gen_random_uuid()) as q2 \gset
reset role;
select tests.assert((:'q1'::jsonb ->> 'notice_ends_at') is not null and (:'q2'::jsonb #>> '{job,notice_ends_at}') is null
                    and (select notice_ends_at is null from public.player_jobs where player_id = :a and status = 'active' and not is_clone),
  'd5: notice and taking it back work on the clone''s job only');

select tests.assert(:'inv0'::boolean and tests.money_invariant() = 'ok', 'd5: the money invariant holds');

-- clean up: end the test jobs
update public.player_jobs set status = 'ended', ended_at = now(), end_reason = 'quit' where player_id in (:a, :b, :f) and status = 'active';
update public.job_postings set status = 'closed' where id in (:'p_own', :'p_clone', :'fpost');
