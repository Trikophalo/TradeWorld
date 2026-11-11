-- =============================================================================
-- 62 · M3c: player companies (ADR-057): founding, rules, quarter close,
--      distress, deposit/withdraw, upgrade, net worth, RLS
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''0c3c3c3c-0000-4000-8000-0000000000f1'''
\set w '''0c3c3c3c-0000-4000-8000-0000000000f2'''
\set g '''0c3c3c3c-0000-4000-8000-0000000000f3'''
\set s '''0c3c3c3c-0000-4000-8000-0000000000f4'''
select tests.signup(:f, 'Frida_Firma') is not null and tests.signup(:w, 'Wanda_Werk') is not null
   and tests.signup(:g, 'Gero_Garage') is not null and tests.signup(:s, 'Sven_Small') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 2);
select tests.set_level(:w, 6);
select tests.set_level(:g, 3);
select tests.set_level(:s, 9);
create or replace function tests.fund(p_player uuid, p_cents bigint, p_key text) returns void language sql as $$
  select public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(p_player, 'player_cash'),
                                p_cents, 'transfer', 'Test-Kapital', 'player', p_player, p_key) $$;
create or replace function tests.company_of(p_player uuid) returns uuid language sql as $$
  select company_id from public.player_companies where founder_id = p_player $$;
grant execute on all functions in schema tests to public;
select tests.fund(:f, 5000000, 'test:m3c:f');
select tests.fund(:g, 1000000, 'test:m3c:g');
select tests.fund(:s, 3000000, 'test:m3c:s');

-- names --------------------------------------------------------------------------------
select tests.login_as('authenticated', :f);
select public.check_company_name('Garagen Code') as n1 \gset
select public.check_company_name('Arschloch GmbH') as n2 \gset
select public.check_company_name('KlarSoft') as n3 \gset
select public.check_company_name('ab') as n4 \gset
reset role;
select tests.assert(
  :'n1'::jsonb = '{"allowed": true, "reason": null}'::jsonb
  and :'n2'::jsonb = '{"allowed": false, "reason": "name_profanity"}'::jsonb
  and :'n3'::jsonb = '{"allowed": false, "reason": "name_reserved"}'::jsonb
  and :'n4'::jsonb ->> 'reason' = 'name_too_short',
  'check_company_name(): allowed, profanity, reserved (AI company), too short');

-- founding rules ---------------------------------------------------------------------------
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Garagen Code', 'Apps für Bäcker', 'tech', '#3366ff', 'garage')$$,
  'company_level_too_low', 'found_company(): garage needs level 3 (found_garage)');
reset role;
select tests.set_level(:f, 4);
-- with an active job no company
select tests.login_as('authenticated', :f);
select x ->> 'id' as fintern from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where x ->> 'tier' = 'intern' and (x ->> 'eligible')::boolean order by x ->> 'id' limit 1 \gset
select public.sign_contract(gen_random_uuid(),
  (public.apply_for_job(gen_random_uuid(), :'fintern', 15000, null) ->> 'id')::uuid, 'M1 1') is not null as ok \gset
select public.quit_job(gen_random_uuid()) is not null as ok \gset
reset role;
update public.player_jobs set notice_ends_at = now() - interval '1 second' where player_id = :f and status = 'active';
select public.process_quit_notices() is not null as ok \gset
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Garagen Code', 'Apps für Bäcker', 'mining', '#3366ff', 'garage')$$,
  'invalid_argument', 'found_company(): unknown sector');
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Garagen Code', 'Apps für Bäcker', 'tech', 'blue', 'garage')$$,
  'invalid_argument', 'found_company(): colour must be #rrggbb');
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Garagen Code', repeat('x', 121), 'tech', '#3366ff', 'garage')$$,
  'invalid_argument', 'found_company(): idea at most 120 characters');
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Garagen Code', 'Für jedes Arschloch', 'tech', '#3366ff', 'garage')$$,
  'name_profanity', 'found_company(): the name filter applies to the idea');
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'KlarSoft', 'Apps', 'tech', '#3366ff', 'garage')$$,
  'name_reserved', 'found_company(): reserved name');
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Garagen Code', 'Apps', 'tech', '#3366ff', 'small_business')$$,
  'company_level_too_low', 'found_company(): small business needs level 10');
reset role;
select tests.cash(:f) as fcash0 \gset
select gen_random_uuid() as frq \gset
select tests.login_as('authenticated', :f);
select public.found_company(:'frq', 'Garagen Code', 'Apps für Bäcker', 'tech', '#3366FF', 'garage') as fc \gset
select public.found_company(:'frq', 'Garagen Code', 'Apps für Bäcker', 'tech', '#3366FF', 'garage') as fc_replay \gset
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Zweite Firma', 'Noch eine', 'retail', '#00aa00', 'garage')$$,
  'company_exists', 'found_company(): one company per player');
select public.get_my_company() as mc0 \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.assert(
  (:'fc'::jsonb -> 'company') ?& array['id', 'name', 'idea', 'sector', 'color', 'tier', 'founded_at', 'cash_cents', 'value_cents',
    'unpaid_cents', 'distress', 'awareness_bps', 'quality_bps', 'quarters_active', 'estimate_low_cents', 'estimate_high_cents',
    'marketing_cents_per_quarter', 'ai_workers', 'ai_worker_cost_cents', 'max_employees', 'employees', 'open_postings',
    'pending_applications', 'founder_productivity_bps', 'team_productivity_bps', 'capacity_cents', 'next_quarter_at',
    'can_upgrade', 'upgrade_cost_cents', 'last_quarter', 'history']
  and :'fc'::jsonb = :'fc_replay'::jsonb and :'fc'::jsonb -> 'company' = :'mc0'::jsonb -> 'company'
  and :'fc'::jsonb -> 'company' ->> 'tier' = 'garage' and :'fc'::jsonb -> 'company' ->> 'color' = '#3366ff'
  and (:'fc'::jsonb -> 'company' ->> 'cash_cents')::bigint = 250000
  and (:'fc'::jsonb -> 'company' ->> 'value_cents')::bigint = 250000
  and (:'fc'::jsonb -> 'company' ->> 'max_employees')::int = 2 and (:'fc'::jsonb -> 'company' ->> 'employees')::int = 0
  and (:'fc'::jsonb -> 'company' ->> 'awareness_bps')::int = 300 and (:'fc'::jsonb -> 'company' ->> 'quality_bps')::int = 2500
  and (:'fc'::jsonb -> 'company' ->> 'founder_productivity_bps')::int = 15000
  and (:'fc'::jsonb -> 'company' ->> 'capacity_cents')::bigint = 450000
  and (:'fc'::jsonb -> 'company' ->> 'upgrade_cost_cents')::bigint = 1250000
  and not (:'fc'::jsonb -> 'company' ->> 'can_upgrade')::boolean
  and :'fc'::jsonb -> 'company' -> 'last_quarter' = 'null'::jsonb and :'fc'::jsonb -> 'company' -> 'history' = '[]'::jsonb
  and tests.cash(:f) = :fcash0 - 250000,
  'found_company(): {company: COMPANY}; 2.500 EUR from private cash into the company; capacity 1.5 x 3.000 EUR (tech); replay');
select tests.assert(
  (select (:'fc'::jsonb -> 'company' ->> 'estimate_low_cents')::bigint <= pc.potential_annual_cents
          and (:'fc'::jsonb -> 'company' ->> 'estimate_high_cents')::bigint >= pc.potential_annual_cents
          and pc.potential_annual_cents between 100000 and 200000000000
     from public.player_companies pc where pc.company_id = :'fco'),
  'hidden market size drawn at founding; the estimate range contains it');

-- founders cannot work elsewhere -------------------------------------------------------
select tests.login_as('authenticated', :f);
-- since M3f founders of small companies may work elsewhere (ADR-066); covered in 65_m3f.sql
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'fintern', 15000, null) ->> 'id')::uuid, 'M1 1')
       is not null as ok \gset
select public.quit_job(gen_random_uuid(), true) ->> 'ended' as fq \gset
-- marketing and AI workers
select tests.throws_key($$select public.set_company_marketing(gen_random_uuid(), -1)$$, 'invalid_argument', 'marketing >= 0');
select tests.throws_key($$select public.set_company_marketing(gen_random_uuid(), 1000000001)$$, 'invalid_argument', 'marketing <= 10 Mio. EUR');
select public.set_company_marketing(gen_random_uuid(), 50000) -> 'company' ->> 'marketing_cents_per_quarter' as mk \gset
select tests.throws_key($$select public.set_ai_workers(gen_random_uuid(), 3)$$, 'employee_limit', 'set_ai_workers(): garage has 2 places');
select public.set_ai_workers(gen_random_uuid(), 2) -> 'company' as aw \gset
reset role;
select tests.assert(:'mk'::bigint = 50000 and (:'aw'::jsonb ->> 'ai_workers')::int = 2
  and (:'aw'::jsonb ->> 'team_productivity_bps')::int = 35000 and (:'aw'::jsonb ->> 'capacity_cents')::bigint = 1050000,
  'set_company_marketing(), set_ai_workers(): AI workers add 10 000 bps each to the capacity');
select tests.login_as('authenticated', :w);
select tests.throws_key($$select public.set_ai_workers(gen_random_uuid(), 1)$$, 'company_not_found', 'set_ai_workers(): only with an own company');
select tests.throws_key($$select public.get_company_postings()$$, 'company_not_found', 'get_company_postings(): only with an own company');
reset role;

-- hiring: places are shared by players and AI workers ---------------------------------
select tests.login_as('authenticated', :f);
select public.create_job_posting(gen_random_uuid(), :'fco', 'intern', 'Werkstudium App', '[{"branch": "it", "min_score": 0}]', 12000, 2) ->> 'id' as fpost \gset
reset role;
select tests.login_as('authenticated', :w);
select public.apply_for_job(gen_random_uuid(), :'fpost', 12000, 'Gern!') ->> 'id' as wapp \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_company_postings() as cp \gset
select public.respond_application(gen_random_uuid(), :'wapp', 'accept', null) ->> 'status' as racc \gset
reset role;
select tests.login_as('authenticated', :w);
select tests.throws_key(format($$select public.sign_contract(gen_random_uuid(), %L, 'M1 1')$$, :'wapp'),
  'employee_limit', 'sign_contract(): 2 AI workers fill the garage');
reset role;
select tests.login_as('authenticated', :f);
select public.set_ai_workers(gen_random_uuid(), 1) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :w);
select public.sign_contract(gen_random_uuid(), :'wapp', 'M1 1') -> 'job' ->> 'title' as wtitle \gset
reset role;
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.set_ai_workers(gen_random_uuid(), 2)$$, 'employee_limit', 'set_ai_workers(): players count too');
select public.get_my_company() -> 'company' as mc1 \gset
reset role;
select tests.assert(
  (:'cp'::jsonb -> 'postings' -> 0) ?& array['id', 'tier', 'title', 'title_key', 'required', 'salary_cents_per_hour', 'slots',
                                            'slots_open', 'status', 'applications_pending', 'posted_at']
  and (:'cp'::jsonb -> 'postings' -> 0 ->> 'applications_pending')::int = 1
  and (:'cp'::jsonb -> 'postings' -> 0 ->> 'slots_open')::int = 2
  and :'racc' = 'offered' and :'wtitle' = 'Werkstudium App'
  and (:'mc1'::jsonb ->> 'employees')::int = 1 and (:'mc1'::jsonb ->> 'open_postings')::int = 1
  and (:'mc1'::jsonb ->> 'team_productivity_bps')::int
      = 15000 + public.job_productivity_bps(public.job_match_score(public.player_branch_scores(:w), '[{"branch": "it", "min_score": 0}]')) + 10000,
  'get_company_postings(); employees and AI workers share the places; team = founder + player + AI worker');

-- quarter close (capacity-bound, so revenue is deterministic) ---------------------------
select id as qid from public.game_quarters order by status = 'closed' desc, ends_at <= now() desc, ends_at desc limit 1 \gset
update public.player_companies set potential_annual_cents = 10000000000, awareness = 0.3 where company_id = :'fco';
select public.player_company_team(:'fco') as team \gset
select tests.company_cash(:'fco') as cc0 \gset
select balance_cents as hh0 from public.ledger_accounts where system_key = 'households' \gset
select coalesce(sum(amount), 0) as fxp0 from public.xp_events where player_id = :f and source = 'company_quarter_profit' \gset
select public.player_company_close_quarter(:'fco', :qid) as close1 \gset
select public.player_company_close_quarter(:'fco', :qid) ->> 'skipped' as close2 \gset
select (:'team'::jsonb ->> 'capacity_cents')::bigint as cap \gset
select tests.assert(
  (select r.revenue_cents = :cap and r.demand_cents > :cap and r.utilization_bps = 10000
          and r.cogs_cents = round(:cap * 0.25) and r.fixed_cents = 15000 and r.ai_worker_cents = 70000 and r.marketing_cents = 50000
          and r.operating_profit_cents = :cap - round(:cap * 0.25) - 15000 - 70000 - 50000
          and r.unpaid_added_cents = 0 and r.label ~ '^J[0-9]+ Q[1-4]$'
     from public.player_company_reports r where r.company_id = :'fco' and r.game_quarter_id = :qid)
  and tests.company_cash(:'fco') = :cc0 + :cap - round(:cap * 0.25) - 15000 - 70000 - 50000
  and (select balance_cents from public.ledger_accounts where system_key = 'households') = :hh0 - :cap + round(:cap * 0.25) + 15000 + 70000 + 50000
  and :'close2' = 'already_closed',
  'quarter close: revenue = capacity when demand exceeds it; goods (25 % tech), fixed 150, AI 700, marketing 500 EUR; households pay and receive; idempotent');
select tests.assert(
  -- AI workers lower the target (ADR-069): founder + player + 1 AI worker -> × (1 − 0.3 / 3)
  (select pc.quarters_active = 1 and abs(pc.quality - (0.25 + 0.35 * ((0.25 + 0.75 * (:'team'::jsonb ->> 'team_sector_score')::int
                                                                        / ((:'team'::jsonb ->> 'team_sector_score')::int + 20.0)) * (1 - 0.3 / 3.0) - 0.25))) < 1e-9
          and pc.awareness > 0.3 and pc.last_closed_quarter_id = :qid
     from public.player_companies pc where pc.company_id = :'fco')
  and (select sum(amount) from public.xp_events where player_id = :f and source = 'company_quarter_profit') - :fxp0
      = round(public.config_double('progression', '{xpSources,profitableCompanyQuarter,xp}', 500) * public.config_double('progression', '{xpMultiplier}', 2)),
  'quarter close: quality towards the team target, awareness grows, founder XP for a profitable quarter');
select tests.login_as('authenticated', :f);
select public.get_my_company() -> 'company' as mc2 \gset
reset role;
select tests.assert(
  (:'mc2'::jsonb -> 'last_quarter') ?& array['label', 'demand_cents', 'capacity_cents', 'revenue_cents', 'cogs_cents', 'fixed_cents',
                                             'ai_worker_cents', 'marketing_cents', 'wages_cents', 'operating_profit_cents', 'utilization_bps']
  and (:'mc2'::jsonb -> 'last_quarter' ->> 'revenue_cents')::bigint = :cap
  and jsonb_array_length(:'mc2'::jsonb -> 'history') = 1 and (:'mc2'::jsonb ->> 'quarters_active')::int = 1
  and (:'mc2'::jsonb ->> 'value_cents')::bigint
      = tests.company_cash(:'fco') + round(4 * (:'mc2'::jsonb -> 'last_quarter' ->> 'operating_profit_cents')::bigint * 28 * 0.5),
  'get_my_company(): last quarter, history, value = cash + 4 x profit x P/E 28 x 0.5');

-- distress: costs above the cash ------------------------------------------------------------
select tests.login_as('authenticated', :g);
select public.found_company(gen_random_uuid(), 'Gero Werkstatt', 'Fahrräder reparieren', 'logistics', '#aa5500', 'garage') is not null as ok \gset
select public.set_ai_workers(gen_random_uuid(), 2) is not null as ok \gset
select public.company_withdraw(gen_random_uuid(), 240000) -> 'company' ->> 'cash_cents' as gcash \gset
reset role;
select tests.company_of(:g) as gco \gset
update public.player_companies set potential_annual_cents = 100000 where company_id = :'gco';
select public.player_company_close_quarter(:'gco', :qid) as gclose \gset
select tests.login_as('authenticated', :g);
select public.get_my_company() -> 'company' as gc1 \gset
select tests.throws_key($$select public.company_withdraw(gen_random_uuid(), 1)$$, 'insufficient_funds', 'company_withdraw(): not above cash - unpaid');
select tests.cash(:g) as gpriv \gset
select public.company_deposit(gen_random_uuid(), 300000) -> 'company' as gc2 \gset
reset role;
select tests.assert(
  :'gcash'::bigint = 10000
  and (:'gc1'::jsonb ->> 'distress')::boolean and (:'gc1'::jsonb ->> 'unpaid_cents')::bigint > 0
  and (:'gc1'::jsonb ->> 'ai_workers')::int = 0 and (:'gc1'::jsonb ->> 'cash_cents')::bigint = 0
  and (:'gc1'::jsonb ->> 'unpaid_cents')::bigint = (:'gclose'::jsonb ->> 'unpaid_added_cents')::bigint
  and not (:'gc2'::jsonb ->> 'distress')::boolean and (:'gc2'::jsonb ->> 'unpaid_cents')::bigint = 0
  and (:'gc2'::jsonb ->> 'cash_cents')::bigint = 300000 - (:'gc1'::jsonb ->> 'unpaid_cents')::bigint,
  'distress: costs paid up to the cash, the rest unpaid, AI workers let go; a deposit pays the open bills first');

-- small business: found directly and upgrade ---------------------------------------------
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.upgrade_company(gen_random_uuid())$$, 'company_level_too_low', 'upgrade_company(): level 10');
reset role;
select tests.set_level(:f, 10);
select tests.cash(:f) as fcash1 \gset
select tests.company_cash(:'fco') as cc1 \gset
select tests.login_as('authenticated', :f);
select public.upgrade_company(gen_random_uuid()) -> 'company' as up \gset
select tests.throws_key($$select public.upgrade_company(gen_random_uuid())$$, 'company_level_too_low', 'upgrade_company(): the next step, the GmbH, needs startups.gmbh.minLevel');
reset role;
select tests.set_level(:s, 10);
select tests.login_as('authenticated', :s);
select public.found_company(gen_random_uuid(), 'Sven Handel', 'Regionale Lebensmittel', 'retail', '#118844', 'small_business') -> 'company' as sb \gset
reset role;
select tests.assert(
  :'up'::jsonb ->> 'tier' = 'small_business' and (:'up'::jsonb ->> 'max_employees')::int = 5
  and (:'up'::jsonb ->> 'upgrade_cost_cents')::bigint = 4500000 and not (:'up'::jsonb ->> 'can_upgrade')::boolean
  and tests.cash(:f) = :fcash1 - 1250000 and tests.company_cash(:'fco') = :cc1 + 1250000
  and (select max_employees from public.companies where id = :'fco') = 5
  and :'sb'::jsonb ->> 'tier' = 'small_business' and (:'sb'::jsonb ->> 'cash_cents')::bigint = 1500000,
  'upgrade_company(): pays 12.500 EUR into the company, 5 places; founding a small business costs 15.000 EUR');

-- net worth, rich list, card, portfolio ------------------------------------------------------
select tests.login_as('authenticated', :w);
select public.get_player_card('frida_firma') as card \gset
select public.get_rich_list(500) as rl \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_my_portfolio() as pf \gset
reset role;
select tests.assert(
  :'card'::jsonb -> 'company' = '{"name": "Garagen Code", "ticker": null}'::jsonb
  and (:'pf'::jsonb ->> 'company_value_cents')::bigint = public.company_value_cents(:'fco')
  and (:'pf'::jsonb ->> 'company_value_cents')::bigint > 0
  and (select (x ->> 'net_worth_cents')::bigint from jsonb_array_elements(:'rl'::jsonb -> 'entries') x where x ->> 'id' = :f)
      = public.player_net_worth_cents(:f)
  and public.player_net_worth_cents(:f) = tests.cash(:f) + public.company_value_cents(:'fco')
          + coalesce((select sum(public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))
                        from public.positions p join public.security_quotes q on q.security_id = p.security_id
                       where p.player_id = :f and p.status = 'open'), 0),
  'founders: card shows the company, portfolio company_value_cents, rich list net worth includes the company value');

-- run_due_jobs: every closed quarter since the founding, once ------------------------------
-- simulate a closed running quarter (status restored below)
create table tests.q_status as select id, status from public.game_quarters;
update public.game_quarters set status = 'closed' where starts_at <= now();
update public.companies set founded_at = now() - interval '1 day' where id = :'fco';
update public.player_companies set last_closed_quarter_id = null where company_id = :'fco';
select coalesce(sum(n), 0) as due_expected
  from (select least(8, (select count(*) from public.game_quarters gq
                          where gq.status = 'closed'
                            and gq.ends_at > coalesce((select q2.ends_at from public.game_quarters q2 where q2.id = pc.last_closed_quarter_id), c.founded_at)
                            and not exists (select 1 from public.player_company_reports r
                                             where r.company_id = pc.company_id and r.game_quarter_id = gq.id))) as n
          from public.player_companies pc join public.companies c on c.id = pc.company_id) x \gset
select public.player_companies_close_due() as due1 \gset
select public.player_companies_close_due() as due2 \gset
update public.game_quarters gq set status = t.status from tests.q_status t where t.id = gq.id and gq.status is distinct from t.status;
drop table tests.q_status;
select tests.assert(:due1::int = :due_expected::int and :due1::int >= 1 and :due2::int = 0,
  'player_companies_close_due(): closes every closed quarter since the founding not yet reported (' || :due1 || '), then nothing');
select tests.assert(
  (select prosrc ~ 'player_companies_close_due' from pg_proc where oid = 'public.run_due_jobs()'::regprocedure),
  'run_due_jobs() closes the player companies after the game quarter');

-- RLS ----------------------------------------------------------------------------------------
select tests.login_as('authenticated', :f);
select tests.throws($$select potential_annual_cents from public.player_companies$$, '42501', 'nobody reads the hidden market size');
select tests.throws($$update public.player_companies set ai_workers = 99$$, '42501', 'player_companies: no direct writes');
select count(*) as own_pc from public.player_companies \gset
select count(*) as own_rep from public.player_company_reports \gset
reset role;
select tests.login_as('authenticated', :w);
select count(*) as other_pc from public.player_companies \gset
select count(*) as other_rep from public.player_company_reports \gset
reset role;
select tests.assert(:own_pc = 1 and :own_rep >= 1 and :other_pc = 0 and :other_rep = 0,
  'RLS: founders read their own company and reports, others nothing');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds (founding, revenue, costs, unpaid bills, deposit, withdraw)');
