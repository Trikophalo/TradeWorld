-- =============================================================================
-- 66 · M3g: reset and delete the own account
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''06606606-0000-4000-8000-0000000000f1'''
\set w '''06606606-0000-4000-8000-0000000000f2'''
\set d '''06606606-0000-4000-8000-0000000000f3'''
\set x '''06606606-0000-4000-8000-0000000000f4'''
\set n '''06606606-0000-4000-8000-0000000000f5'''
\set rq '''06606606-0000-4000-8000-0000000000a1'''
select tests.signup(:f, 'Resi_Reset') is not null and tests.signup(:w, 'Willa_Werk') is not null
   and tests.signup(:d, 'Dora_Delete') is not null and tests.signup(:x, 'Xaver_Extra') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 10);
select tests.set_level(:w, 3);
select tests.set_level(:d, 10);
select tests.set_level(:x, 3);
select tests.fund(:f, 3000000, 'test:m3g:f');
select tests.fund(:d, 3000000, 'test:m3g:d');
select public.config_bigint('economy', '{startingCapitalCents}', 1000000) as start \gset

-- =============================================================================
-- A. Reset: a founder with an employee, holdings, an open order, a job, XP
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.complete_tutorial(gen_random_uuid()) is not null as ok \gset
select public.found_company(gen_random_uuid(), 'Resi Rad', 'Fahrradreparatur vor Ort', 'retail', '#336699', 'garage') is not null as ok \gset
select public.place_order(gen_random_uuid(), 'VLT', 'buy', 'market', 5000000) is not null as ok \gset
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'limit', 2000000, 10000) is not null as ok \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.hire(:f, :w, 20000) as wjob \gset
select tests.assert(
  (select level from public.profiles where id = :f) = 10
  and exists (select 1 from public.positions where player_id = :f and status = 'open' and quantity_e6 > 0)
  and exists (select 1 from public.orders where player_id = :f and status = 'open')
  and tests.reserve(:f) > 0
  and exists (select 1 from public.player_jobs where player_id = :w and status = 'active' and company_id = :'fco')
  and tests.money_invariant() = 'ok',
  'reset setup: level 10, company with an employee, a holding, an open limit order');

select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.reset_account(gen_random_uuid(), 'Somebody_Else')$$, 'confirm_mismatch',
  'reset_account(): the confirmation must be the own nickname');
select tests.throws($$select public.reset_account(gen_random_uuid(), null)$$, 'NX061', 'reset_account(): confirm_mismatch is NX061');
select tests.throws_key($$select public.reset_account(null, 'Resi_Reset')$$, 'invalid_argument', 'reset_account(): request_id is required');
select public.reset_account(:rq, '  resi_RESET ') as res1 \gset
select public.reset_account(:rq, '  resi_RESET ') as res2 \gset
select public.get_my_portfolio() as pf \gset
select public.get_my_company() as mc \gset
reset role;
select tests.assert(
  (:'res1'::jsonb ->> 'ok')::boolean and :'res1'::jsonb ? 'reset_at' and :'res1'::jsonb = :'res2'::jsonb
  and (select count(*) from public.ledger_transactions where idempotency_key like 'reset:%' || :rq || ':start') = 1,
  'reset_account(): {ok, reset_at}, nickname case-insensitive and trimmed, replay returns the stored result');
select tests.assert(
  (select level = 1 and xp_total = 0 and nickname = 'Resi_Reset' from public.profiles where id = :f)
  and tests.cash(:f) = :start and tests.reserve(:f) = 0
  and (:'pf'::jsonb ->> 'cash_cents')::bigint = :start and (:'pf'::jsonb ->> 'level')::int = 1
  and jsonb_array_length(:'pf'::jsonb -> 'positions') = 0 and jsonb_array_length(:'pf'::jsonb -> 'open_orders') = 0
  and jsonb_array_length(:'pf'::jsonb -> 'recent_trades') = 0 and not (:'pf'::jsonb ->> 'tutorial_completed')::boolean
  and (:'pf'::jsonb ->> 'debt_cents')::bigint = 0
  and not exists (select 1 from public.xp_events where player_id = :f)
  and (select count(*) from public.player_unlocks where player_id = :f) = (select count(*) from public.unlocks where level <= 1)
  and exists (select 1 from public.trades where player_id = :f),
  'reset: level 1, starting capital, no holdings, orders or XP; trades stay as hidden history');
select tests.assert(
  :'mc'::jsonb -> 'company' = 'null'::jsonb
  and (select status from public.player_companies where company_id = :'fco') = 'dissolved'
  and not exists (select 1 from public.player_jobs where player_id = :w and status = 'active')
  and (select end_reason from public.player_jobs where id = :'wjob') = 'fired',
  'reset: the company is dissolved like close_company, the employee loses the job');
select tests.assert(
  tests.money_invariant() = 'ok' and not exists (select 1 from public.ledger_audit()),
  'reset: every money movement is a balanced posting (money invariant holds)');

-- the reset player can start again
select tests.login_as('authenticated', :f);
select public.place_order(gen_random_uuid(), 'VLT', 'buy', 'market', 1000000) is not null as ok \gset
select public.get_my_portfolio() as pf2 \gset
reset role;
select tests.assert(
  jsonb_array_length(:'pf2'::jsonb -> 'positions') = 1 and jsonb_array_length(:'pf2'::jsonb -> 'recent_trades') = 1,
  'after the reset the player trades normally; only new trades are listed');

-- an employee resets: the job ends without notice or fee
select tests.set_level(:d, 10);
select tests.login_as('authenticated', :d);
select public.found_company(gen_random_uuid(), 'Dora Daten', 'Datenrettung für Vereine', 'tech', '#993366', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:d) as dco \gset
select tests.hire(:d, :x, 15000) as xjob \gset
select tests.hire(:d, :w, 15000) as wjob2 \gset
select tests.cash(:d) as dcash0 \gset
select tests.login_as('authenticated', :w);
select public.reset_account(gen_random_uuid(), 'Willa_Werk') ->> 'ok' as wok \gset
reset role;
select tests.assert(
  :'wok'::boolean
  and (select status = 'ended' from public.player_jobs where id = :'xjob') is false
  and not exists (select 1 from public.player_jobs where player_id = :w)
  and (select count(*) from public.player_jobs where company_id = :'dco' and status = 'active') = 1
  and tests.cash(:w) = :start and (select level from public.profiles where id = :w) = 1
  and exists (select 1 from public.company_messages where company_id = :'dco' and body = 'Willa_Werk hat das Unternehmen verlassen.')
  and tests.money_invariant() = 'ok',
  'reset of an employee: job ended without a fee, the company keeps its other employee');

-- =============================================================================
-- B. Delete: a founder with an employee and holdings
-- =============================================================================
select tests.login_as('authenticated', :d);
select public.place_order(gen_random_uuid(), 'VLT', 'buy', 'market', 2000000) is not null as ok \gset
select tests.throws_key($$select public.delete_account('Dora')$$, 'confirm_mismatch', 'delete_account(): the confirmation must be the own nickname');
reset role;
select tests.assert(exists (select 1 from auth.users where id = :d), 'delete_account(): nothing happens on a wrong confirmation');
select array_agg(id order by id) as dacc from public.ledger_accounts where owner_player_id = :d \gset
select tests.login_as('authenticated', :d);
select public.delete_account('dora_delete') as del \gset
reset role;
select tests.assert(
  :'del'::jsonb = '{"ok": true}'::jsonb
  and not exists (select 1 from auth.users where id = :d) and not exists (select 1 from public.profiles where id = :d)
  and not exists (select 1 from public.player_jobs where player_id = :x and status = 'active')
  and (select phase = 'dissolved' and founder_id is null from public.companies where id = :'dco'),
  'delete_account(): {ok: true}, auth user and profile are gone, the employee lost the job');
select tests.assert(
  (select count(*) = 2 and bool_and(balance_cents = 0 and is_frozen) from public.ledger_accounts where id = any(:'dacc'::uuid[]))
  and exists (select 1 from public.trades where player_id = :d)
  and tests.money_invariant() = 'ok' and not exists (select 1 from public.ledger_audit()),
  'delete_account(): ledger accounts stay with balance 0 (frozen), trade history stays, money invariant holds');
select tests.signup(:n, 'Dora_Delete') is not null as ok \gset
select tests.assert((select nickname from public.profiles where id = :n) = 'Dora_Delete',
  'delete_account(): the nickname is free again');

-- the other players keep working (4-player viability)
select tests.login_as('authenticated', :x);
select public.get_my_job() -> 'job' as xj \gset
select public.get_rich_list(50, 0, 'players') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_my_portfolio() is not null as ok \gset
reset role;
select tests.assert(:'xj'::jsonb = 'null'::jsonb, 'after a deletion the former employee sees no job and the rich list still works');
