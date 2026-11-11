-- =============================================================================
-- 63 · M3d: profit-linked pay and bonus, insolvency with private liability and
--      forced loan, voluntary close, company chat, work tasks
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''0d3d3d3d-0000-4000-8000-0000000000f1'''
\set w '''0d3d3d3d-0000-4000-8000-0000000000f2'''
\set h '''0d3d3d3d-0000-4000-8000-0000000000f3'''
\set v '''0d3d3d3d-0000-4000-8000-0000000000f4'''
\set x '''0d3d3d3d-0000-4000-8000-0000000000f5'''
select tests.signup(:f, 'Fiona_Fabrik') is not null and tests.signup(:w, 'Willi_Wert') is not null
   and tests.signup(:h, 'Hanno_Haftung') is not null and tests.signup(:v, 'Vera_Verlust') is not null
   and tests.signup(:x, 'Xena_Aussen') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 10);
select tests.set_level(:w, 3);
select tests.set_level(:h, 3);
select tests.set_level(:v, 3);
select tests.fund(:f, 2000000, 'test:m3d:f');
select (public.current_game_quarter()).id as qid \gset
select id as qid2 from public.game_quarters where id <> :qid order by ends_at desc limit 1 \gset

-- helper: a player company with one employee hired through the normal flow
create or replace function tests.hire(p_founder uuid, p_worker uuid, p_wage bigint) returns uuid language plpgsql as $$
declare
  v_co   uuid := tests.company_of(p_founder);
  v_post uuid;
  v_app  uuid;
begin
  perform tests.login_as('authenticated', p_founder);
  v_post := (public.create_job_posting(gen_random_uuid(), v_co, 'intern', 'Werkstudium', '[{"branch": "it", "min_score": 0}]',
                                       p_wage, 1) ->> 'id')::uuid;
  perform tests.login_as('authenticated', p_worker);
  v_app := (public.apply_for_job(gen_random_uuid(), v_post, p_wage, null) ->> 'id')::uuid;
  perform tests.login_as('authenticated', p_founder);
  perform public.respond_application(gen_random_uuid(), v_app, 'accept', null);
  perform tests.login_as('authenticated', p_worker);
  perform public.sign_contract(gen_random_uuid(), v_app, 'M1 1');
  reset role;
  return (select id from public.player_jobs where player_id = p_worker and status = 'active');
end;
$$;
create or replace function tests.work_hours(p_job uuid, p_hours integer) returns bigint language plpgsql as $$
begin
  update public.player_jobs set last_paid_at = now() - make_interval(hours => p_hours),
         paid_day = (now() at time zone 'Europe/Berlin')::date, paid_minutes_today = 0
   where id = p_job;
  return public.accrue_job_salary(p_job, now());
end;
$$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. Profit-linked pay
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Fiona Werke', 'Software für Schreiner', 'tech', '#225588', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.hire(:f, :w, 20000) as wjob \gset
update public.player_companies set pay_factor_bps = 7500, potential_annual_cents = 10000000000, awareness = 0.5 where company_id = :'fco';
select tests.work_hours(:'wjob', 2) as paid2 \gset
select tests.login_as('authenticated', :w);
select public.get_my_job() -> 'job' as wj \gset
reset role;
select tests.assert(
  :paid2::bigint = 30000
  and (select base_amount_cents from public.salary_payouts where player_job_id = :'wjob' order by id desc limit 1) = 40000
  and (:'wj'::jsonb ->> 'pay_factor_bps')::int = 7500 and (:'wj'::jsonb ->> 'effective_salary_cents_per_hour')::bigint = 15000
  and (:'wj'::jsonb ->> 'last_bonus_cents')::bigint = 0 and :'wj'::jsonb ? 'next_work_task_at' and :'wj'::jsonb ? 'work_task_open',
  'payroll at a player company: contract wage x pay factor (75 %), base wages kept for the bonus; get_my_job shows the factor');

select tests.cash(:w) as wc0 \gset
select public.player_company_close_quarter(:'fco', :qid) as fclose \gset
select tests.login_as('authenticated', :w);
select public.get_my_job() -> 'job' as wj2 \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_my_company() as fmc \gset
reset role;
select tests.assert(
  (select r.base_wages_cents = 40000 and r.bonus_cents = 40000 and r.pay_factor_bps = 10000 and r.operating_profit_cents > 40000
     from public.player_company_reports r where r.company_id = :'fco' and r.game_quarter_id = :qid)
  and tests.cash(:w) = :wc0 + 40000
  and (select sum(bonus_cents) from public.salary_payouts where player_job_id = :'wjob') = 40000
  and (:'wj2'::jsonb ->> 'last_bonus_cents')::bigint = 40000 and (:'wj2'::jsonb ->> 'pay_factor_bps')::int = 10000
  and (:'fmc'::jsonb -> 'company' ->> 'pay_factor_bps')::int = 10000
  and (:'fmc'::jsonb -> 'company' -> 'last_quarter' ->> 'bonus_cents')::bigint = 40000
  and (:'fmc'::jsonb -> 'company') ?& array['distress_quarters', 'grace_quarters', 'pay_factor_bps']
  and :'fmc'::jsonb ? 'last_dissolution' and :'fmc'::jsonb -> 'last_dissolution' = 'null'::jsonb,
  'good quarter: pay factor back to 100 %, bonus = 20 % of the surplus by wage weight, capped at 1 x base wages (400 EUR)');

-- a bad quarter lowers the pay factor (at most to minFactor)
select tests.fund(:h, 3000000, 'test:m3d:h');
select tests.login_as('authenticated', :h);
select public.found_company(gen_random_uuid(), 'Hanno Handel', 'Zubehör für Fahrräder', 'retail', '#884422', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:h) as hco \gset
select tests.hire(:h, :v, 10000) as vjob \gset
select tests.work_hours(:'vjob', 2) is not null as ok \gset
update public.player_companies set potential_annual_cents = 100000 where company_id = :'hco';
select public.player_company_close_quarter(:'hco', :qid) as hclose \gset
select tests.assert(
  (:'hclose'::jsonb ->> 'pay_factor_bps')::int = 5000 and (:'hclose'::jsonb ->> 'bonus_cents')::bigint = 0
  and (:'hclose'::jsonb ->> 'base_wages_cents')::bigint = 20000
  and (select pay_factor_bps from public.player_companies where company_id = :'hco') = 5000
  and exists (select 1 from public.company_messages where company_id = :'hco' and body = 'Lohnfaktor ab jetzt 50 %.'),
  'loss quarter: pay factor drops to minFactor (50 %), no bonus, the team is told in the chat');

-- =============================================================================
-- B. Insolvency with private liability and forced loan
-- =============================================================================
select tests.company_cash(:'hco') as hcc \gset
select tests.login_as('authenticated', :h);
select public.company_withdraw(gen_random_uuid(), :hcc) is not null as ok \gset
reset role;
select public.ledger_transfer(public.ledger_player_account(:h, 'player_cash'), public.ledger_system_account('households'),
  tests.cash(:h) - 5000, 'transfer', 'Test: Privatkasse leeren', 'player', :h, 'test:m3d:hdrain') is not null as ok \gset
update public.player_companies set distress_quarters = public.config_double('startups', '{insolvency,graceQuarters}', 4)::int - 1
 where company_id = :'hco';
select balance_cents as mk0 from public.ledger_accounts where system_key = 'market' \gset
select tests.cash(:v) as vc0 \gset
select public.player_company_close_quarter(:'hco', :qid2) as hclose2 \gset
select * from public.company_dissolutions where company_id = :'hco' \gset d_
select tests.assert(
  (:'hclose2'::jsonb ->> 'dissolved')::boolean and :'d_reason' = 'insolvent'
  and :d_severances_cents::bigint = 120000 and :d_from_founder_cents::bigint = 5000
  and :d_total_debt_cents::bigint = :d_unpaid_cents::bigint + 120000
  and :d_loan_cents::bigint = :d_total_debt_cents::bigint - :d_from_company_cents::bigint - 5000 and :d_loan_cents::bigint > 0
  and :d_to_founder_cents::bigint = 0
  and tests.cash(:v) = :vc0 + 120000 and tests.cash(:h) = 0
  and (select status = 'ended' and end_reason = 'company_insolvent' from public.player_jobs where id = :'vjob')
  and (select status = 'dissolved' and ai_workers = 0 from public.player_companies where company_id = :'hco')
  and (select phase = 'dissolved' from public.companies where id = :'hco')
  and tests.company_cash(:'hco') = 0
  and (select balance_cents from public.ledger_accounts where system_key = 'market') = :mk0::bigint - :d_loan_cents::bigint
  and (select principal_cents = :d_loan_cents::bigint and outstanding_cents = :d_loan_cents::bigint and kind = 'forced' and status = 'open'
         from public.player_loans where player_id = :h)
  and (select founding_locked_until > now() + interval '2 days 23 hours' from public.profiles where id = :h),
  'insolvency after graceQuarters: company cash and the founder''s private cash pay bills and one salary severance, the rest is a forced loan from the financial market; founding lockout');
select tests.login_as('authenticated', :h);
select public.get_my_company() as hmc \gset
select public.get_my_portfolio() as hpf \gset
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Neustart', 'Noch ein Versuch', 'tech', '#123456', 'garage')$$,
  'founding_locked', 'found_company(): locked after an insolvency');
select tests.throws_key($$select public.close_company(gen_random_uuid())$$, 'company_not_found', 'close_company(): no company');
reset role;
select tests.assert(
  :'hmc'::jsonb -> 'company' = 'null'::jsonb
  and :'hmc'::jsonb -> 'last_dissolution' ->> 'reason' = 'insolvent'
  and :'hmc'::jsonb -> 'last_dissolution' ->> 'company_name' = 'Hanno Handel'
  and (:'hmc'::jsonb -> 'last_dissolution' ->> 'loan_cents')::bigint = :d_loan_cents::bigint
  and (:'hmc'::jsonb -> 'last_dissolution') ?& array['company_name', 'reason', 'at', 'total_debt_cents', 'from_founder_cents', 'loan_cents']
  and (:'hpf'::jsonb ->> 'debt_cents')::bigint = :d_loan_cents::bigint
  and (:'hpf'::jsonb ->> 'debt_withholding_bps')::int = 5000 and :'hpf'::jsonb ->> 'founding_locked_until' is not null
  and public.player_net_worth_cents(:h) = -:d_loan_cents::bigint
  and (select net_worth_cents from public.rich_list_entries() where entity_id = :h) = -:d_loan_cents::bigint,
  'after the insolvency: get_my_company shows the last dissolution, portfolio debt and lockout, net worth minus the debt');

-- withholding: half of every private income repays the loan
select tests.login_as('authenticated', :h);
select public.claim_daily_reward(gen_random_uuid()) ->> 'cash_cents' as hdr \gset
reset role;
select tests.assert(
  tests.cash(:h) = :hdr::bigint / 2
  and (select outstanding_cents from public.player_loans where player_id = :h) = :d_loan_cents::bigint - :hdr::bigint / 2,
  'claim_daily_reward(): 50 % of the cash goes to the loan');
select tests.fund(:h, 1000000, 'test:m3d:h2');
select tests.login_as('authenticated', :h);
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', null, null, 200000) is not null as ok \gset
reset role;
select tests.cash(:h) as hc1 \gset
select (select outstanding_cents from public.player_loans where player_id = :h) as lo1 \gset
select tests.login_as('authenticated', :h);
select public.place_order(gen_random_uuid(), 'KLS', 'sell', 'market', (select sum(p.quantity_e6) from public.positions p join public.securities sx on sx.id = p.security_id where p.player_id = :h and sx.ticker = 'KLS' and p.status = 'open')::bigint) as hsell \gset
reset role;
select gross_cents - fee_cents - tax_cents as hnet from public.trades where player_id = :h and side = 'sell' order by executed_at desc limit 1 \gset
select tests.assert(
  (select outstanding_cents from public.player_loans where player_id = :h) = :lo1::bigint - :hnet::bigint / 2
  and tests.cash(:h) = :hc1::bigint + :hnet::bigint - :hnet::bigint / 2,
  'sell proceeds: 50 % of the net proceeds repay the loan');
update public.player_loans set outstanding_cents = 100 where player_id = :h;
select tests.login_as('authenticated', :h);
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', null, null, 50000) is not null as ok \gset
select public.place_order(gen_random_uuid(), 'KLS', 'sell', 'market', (select sum(p.quantity_e6) from public.positions p join public.securities sx on sx.id = p.security_id where p.player_id = :h and sx.ticker = 'KLS' and p.status = 'open')::bigint) is not null as ok \gset
select public.get_my_portfolio() ->> 'debt_cents' as hdebt \gset
reset role;
select tests.assert(
  (select status = 'repaid' and outstanding_cents = 0 and closed_at is not null from public.player_loans where player_id = :h)
  and :hdebt::bigint = 0,
  'a loan that reaches 0 is closed');

-- =============================================================================
-- C. Company chat
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.post_company_message(gen_random_uuid(), 'Willkommen im Team!') as m1 \gset
reset role;
select tests.login_as('authenticated', :w);
select public.post_company_message(gen_random_uuid(), '  Danke!  ') as m2 \gset
select public.get_company_chat() as chat \gset
select count(*) as wsee from public.company_messages \gset
select tests.throws_key($$select public.post_company_message(gen_random_uuid(), '   ')$$, 'invalid_argument', 'post_company_message(): empty');
select tests.throws_key($$select public.post_company_message(gen_random_uuid(), repeat('x', 301))$$, 'invalid_argument',
  'post_company_message(): at most chat.maxMessageLength');
select tests.throws_key($$select public.post_company_message(gen_random_uuid(), 'Du Arschloch')$$, 'name_profanity',
  'post_company_message(): name filter');
reset role;
select tests.login_as('authenticated', :x);
select public.get_company_chat() as xchat \gset
select count(*) as xsee from public.company_messages \gset
select tests.throws_key($$select public.post_company_message(gen_random_uuid(), 'Hallo?')$$, 'not_in_company',
  'post_company_message(): only members');
reset role;
select tests.assert(
  :'m1'::jsonb ?& array['id', 'kind', 'author', 'avatar_key', 'is_me', 'is_founder', 'body', 'created_at']
  and :'m1'::jsonb ->> 'kind' = 'player' and (:'m1'::jsonb ->> 'is_me')::boolean and (:'m1'::jsonb ->> 'is_founder')::boolean
  and :'m2'::jsonb ->> 'body' = 'Danke!' and not (:'m2'::jsonb ->> 'is_founder')::boolean
  and :'chat'::jsonb -> 'company' = jsonb_build_object('id', :'fco', 'name', 'Fiona Werke', 'color', '#225588')
  and (:'chat'::jsonb ->> 'members')::int = 2
  and (select bool_and(x.id_ok) from (select (m ->> 'id')::bigint > lag((m ->> 'id')::bigint, 1, 0::bigint) over (order by o) as id_ok
                                         from jsonb_array_elements(:'chat'::jsonb -> 'messages') with ordinality a(m, o)) x)
  and (:'chat'::jsonb -> 'messages' -> -1 ->> 'id')::bigint = (:'m2'::jsonb ->> 'id')::bigint
  and exists (select 1 from jsonb_array_elements(:'chat'::jsonb -> 'messages') m
               where m ->> 'kind' = 'system' and m ->> 'body' = 'Willi_Wert ist jetzt im Team.' and m -> 'author' = 'null'::jsonb)
  and exists (select 1 from jsonb_array_elements(:'chat'::jsonb -> 'messages') m where m ->> 'body' ~ '^Quartal J[0-9]+ Q[1-4]: Umsatz .* €, Gewinn .* €\.$')
  and :wsee::int = jsonb_array_length(:'chat'::jsonb -> 'messages')
  and :'xchat'::jsonb = '{"company": null, "members": 0, "messages": []}'::jsonb and :xsee::int = 0,
  'chat: members read and write, newest last, system lines for joins and quarter closes; outsiders see nothing (RLS)');
select tests.login_as('authenticated', :w);
select jsonb_array_length(public.get_company_chat((:'m2'::jsonb ->> 'id')::bigint) -> 'messages') as before_n \gset
do $$
begin
  for i in 1 .. 10 loop
    begin
      perform public.post_company_message(gen_random_uuid(), 'Nachricht ' || i);
    exception when others then
      perform tests.assert(sqlerrm = 'rate_limited' and i = 10, 'rate limit reached at message ' || i || ': ' || sqlerrm);
      return;
    end;
  end loop;
  perform tests.assert(false, 'chat rate limit never reached');
end;
$$;
reset role;
select tests.assert(:before_n::int = jsonb_array_length(:'chat'::jsonb -> 'messages') - 1,
  'get_company_chat(p_before_id): only older messages');

-- =============================================================================
-- D. Work tasks
-- =============================================================================
select tests.assert(
  public.work_task_kind_for('finance') = 'finance_choice' and public.work_task_kind_for('law') = 'finance_choice'
  and public.work_task_kind_for('sales') = 'sales_pick' and public.work_task_kind_for('logistics') = 'sales_pick'
  and public.work_task_kind_for('management') = 'sales_pick' and public.work_task_kind_for('it') = 'analyst_estimate'
  and public.work_task_kind_for('science') = 'analyst_estimate' and public.work_task_kind_for('craft') = 'analyst_estimate',
  'workTaskKind: finance/law -> finance_choice, sales/logistics/management -> sales_pick, else analyst_estimate');
select tests.assert(
  (select bool_and(public.work_task_is_clear(k, p) and public.work_task_correct(k, p) between 0 and 3
                   and case k when 'finance_choice' then p ?& array['amount_cents', 'years', 'offers'] and jsonb_array_length(p -> 'offers') = 2
                                                        and (p -> 'offers' -> 0) ?& array['rate_bps', 'fee_cents']
                          when 'sales_pick' then jsonb_array_length(p -> 'customers') = 3
                                                 and (p -> 'customers' -> 0) ?& array['units', 'price_cents', 'unit_cost_cents', 'service_cents']
                          else p ?& array['revenue_cents', 'cogs_bps', 'fixed_cents', 'marketing_cents', 'options']
                               and jsonb_array_length(p -> 'options') = 4 end)
     from (select k, public.work_task_generate(k) as p
             from unnest(array['finance_choice', 'sales_pick', 'analyst_estimate']) k, generate_series(1, 150) n) x),
  'generated tasks (450): params in the TS shape, the right answer is clear and found');
select tests.assert(
  public.work_task_correct('finance_choice', '{"amount_cents": 10000000, "years": 2, "offers": [{"rate_bps": 500, "fee_cents": 0}, {"rate_bps": 300, "fee_cents": 200000}]}') = 1
  and public.work_task_correct('sales_pick', '{"customers": [{"units": 100, "price_cents": 1500, "unit_cost_cents": 1000, "service_cents": 10000},
       {"units": 50, "price_cents": 3000, "unit_cost_cents": 1000, "service_cents": 0}, {"units": 10, "price_cents": 9000, "unit_cost_cents": 1000, "service_cents": 0}]}') = 1
  and public.work_task_correct('analyst_estimate', '{"revenue_cents": 10000000, "cogs_bps": 4000, "fixed_cents": 2000000, "marketing_cents": 500000,
       "options": [5500000, 3500000, 1500000, 2500000]}') = 1,
  'correctOption: cheaper loan (100.000 + 6.000 vs. 2.000 + 6.000 EUR), best customer profit, analyst profit 6 Mio. - 2 Mio. - 0,5 Mio.');

-- since M3e no new tasks are handed out (ADR-064); open tasks from before are created here directly
create or replace function tests.work_task(p_job uuid) returns jsonb language sql as $$
  insert into public.player_work_tasks (player_id, player_job_id, kind, params, correct_index, status, started_at, expires_at)
  select j.player_id, j.id, k.kind, k.params, public.work_task_correct(k.kind, k.params), 'started', now(), now() + interval '3 hours'
    from public.player_jobs j,
         lateral (select public.work_task_kind_for(j.required -> 0 ->> 'branch') as kind) k0,
         lateral (select k0.kind, public.work_task_generate(k0.kind) as params) k
   where j.id = p_job
  returning jsonb_build_object('task', public.work_task_json(player_work_tasks.*)) $$;
grant execute on function tests.work_task(uuid) to public;
select tests.work_task(:'wjob') as t1 \gset
select tests.login_as('authenticated', :w);
select tests.throws($$select correct_index from public.player_work_tasks$$, '42501', 'the right answer is not readable');
reset role;
select correct_index as ci from public.player_work_tasks where id = (:'t1'::jsonb -> 'task' ->> 'id')::uuid \gset
select tests.assert(
  :'t1'::jsonb -> 'task' ?& array['id', 'kind', 'params', 'created_at', 'expires_at', 'started_at']
  and :'t1'::jsonb -> 'task' ->> 'kind' = 'analyst_estimate',
  'work task for an IT job: analyst task');
select tests.cash(:w) as wc1 \gset
select tests.login_as('authenticated', :w);
select public.submit_work_task(gen_random_uuid(), (:'t1'::jsonb -> 'task' ->> 'id')::uuid, (:ci::int + 1) % 4) as s1 \gset
select tests.throws_key(format($$select public.submit_work_task(gen_random_uuid(), %L, 0)$$, :'t1'::jsonb -> 'task' ->> 'id'),
  'work_task_done', 'submit_work_task(): only once');
select tests.throws_key($$select public.submit_work_task(gen_random_uuid(), gen_random_uuid(), 0)$$, 'work_task_not_found', 'unknown task');
select public.get_work_task() as t2 \gset
reset role;
select tests.assert(
  :'s1'::jsonb ?& array['correct', 'correct_index', 'xp', 'bonus_cents', 'level', 'xp_total']
  and not (:'s1'::jsonb ->> 'correct')::boolean and (:'s1'::jsonb ->> 'correct_index')::int = :ci::int
  and (:'s1'::jsonb ->> 'xp')::int = 50 * public.config_double('progression', '{xpMultiplier}', 2)::int
  and (:'s1'::jsonb ->> 'bonus_cents')::bigint = 0 and tests.cash(:w) = :wc1::bigint
  and :'t2'::jsonb = '{"task": null, "next_task_at": null}'::jsonb,
  'wrong answer: minXp, no bonus; get_work_task() hands out no new tasks (ADR-064)');
update public.player_work_tasks set created_at = created_at - interval '3 hours' where player_job_id = :'wjob';
select tests.company_cash(:'fco') as fcc \gset
select tests.work_task(:'wjob') as t3 \gset
select correct_index as ci3 from public.player_work_tasks where id = (:'t3'::jsonb -> 'task' ->> 'id')::uuid \gset
select tests.login_as('authenticated', :w);
select public.submit_work_task(gen_random_uuid(), (:'t3'::jsonb -> 'task' ->> 'id')::uuid, :ci3::int) as s3 \gset
reset role;
select tests.assert(
  (:'s3'::jsonb ->> 'correct')::boolean
  and (:'s3'::jsonb ->> 'xp')::int = 150 * public.config_double('progression', '{xpMultiplier}', 2)::int
  and (:'s3'::jsonb ->> 'bonus_cents')::bigint = 20000
  and tests.cash(:w) = :wc1::bigint + 20000 and tests.company_cash(:'fco') = :fcc::bigint - 20000,
  'right and fast: maxXp and a bonus of bonusSalaryHours x effective wage from the employer''s cash');
-- slow answer and expiry
update public.player_work_tasks set created_at = created_at - interval '3 hours' where player_job_id = :'wjob';
select tests.work_task(:'wjob') -> 'task' ->> 'id' as t4 \gset
update public.player_work_tasks set started_at = now() - interval '2 minutes' where id = :'t4';
select correct_index as ci4 from public.player_work_tasks where id = :'t4' \gset
select tests.login_as('authenticated', :w);
select public.submit_work_task(gen_random_uuid(), :'t4', :ci4::int) ->> 'xp' as xp4 \gset
reset role;
select tests.assert(:xp4::int = 100 * public.config_double('progression', '{xpMultiplier}', 2)::int,
  'right but slow: (minXp + maxXp) / 2');
update public.player_work_tasks set created_at = created_at - interval '3 hours' where player_job_id = :'wjob';
select tests.work_task(:'wjob') -> 'task' ->> 'id' as t5 \gset
update public.player_work_tasks set expires_at = now() - interval '1 second' where id = :'t5';
select tests.login_as('authenticated', :w);
select tests.throws_key(format($$select public.submit_work_task(gen_random_uuid(), %L, 0)$$, :'t5'), 'work_task_expired', 'expired task');
reset role;

-- =============================================================================
-- B2. Voluntary close
-- =============================================================================
update public.player_work_tasks set created_at = created_at - interval '3 hours' where player_job_id = :'wjob';
select tests.work_task(:'wjob') -> 'task' ->> 'id' as t6 \gset
select tests.company_cash(:'fco') as fcc2 \gset
select tests.cash(:f) as fpc \gset
select tests.cash(:w) as wc2 \gset
select tests.login_as('authenticated', :f);
select public.close_company(gen_random_uuid()) as cl \gset
select public.get_my_company() as fmc2 \gset
reset role;
select tests.assert(
  :'cl'::jsonb ?& array['from_company_cents', 'from_founder_cents', 'loan_cents', 'to_founder_cents', 'total_debt_cents']
  and (:'cl'::jsonb ->> 'total_debt_cents')::bigint = 12 * 20000 and (:'cl'::jsonb ->> 'loan_cents')::bigint = 0
  and (:'cl'::jsonb ->> 'from_founder_cents')::bigint = 0
  and tests.cash(:w) >= :wc2::bigint + 240000
  and tests.cash(:f) = :fpc::bigint + (:'cl'::jsonb ->> 'to_founder_cents')::bigint
  and (select end_reason = 'fired' from public.player_jobs where id = :'wjob')
  and :'fmc2'::jsonb -> 'company' = 'null'::jsonb and :'fmc2'::jsonb -> 'last_dissolution' ->> 'reason' = 'closed'
  and (select founding_locked_until is null from public.profiles where id = :f),
  'close_company(): severances from the company cash, the rest to the founder, no lockout');
select tests.login_as('authenticated', :w);
select tests.throws_key(format($$select public.submit_work_task(gen_random_uuid(), %L, 0)$$, :'t6'), 'no_active_job',
  'submit_work_task(): the job has ended');
select public.get_company_chat() -> 'company' as wchat2 \gset
reset role;
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Fiona Neu', 'Zweiter Anlauf', 'tech', '#225588', 'garage') -> 'company' ->> 'name' as fnew \gset
reset role;
select tests.assert(:'wchat2' = 'null' and :'fnew' = 'Fiona Neu',
  'after closing: the former employee has no company chat; the founder may found again');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds (bonus, dissolution, forced loan, repayments, work bonus)');
