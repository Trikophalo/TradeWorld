-- =============================================================================
-- f1 · Withdrawals from the own company every 6 hours (ADR-213)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
select tests.money_invariant() = 'ok' as inv0 \gset

\set a '''0f1f1f1f-0000-4000-8000-0000000000a1'''
\set b '''0f1f1f1f-0000-4000-8000-0000000000b1'''
\set c '''0f1f1f1f-0000-4000-8000-0000000000c1'''
\set d '''0f1f1f1f-0000-4000-8000-0000000000d1'''
\set rq1 '''0f1f1f1f-0000-4000-8000-000000000101'''
select tests.signup(:a, 'Entnahme_Anna') is not null and tests.signup(:b, 'Entnahme_Ben') is not null
   and tests.signup(:c, 'Entnahme_Cem') is not null and tests.signup(:d, 'Entnahme_Dora') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(x, 6) from unnest(array[:a, :b, :c, :d]::uuid[]) x;
select tests.fund(x, 1000000, 'test:f1:' || x::text) from unnest(array[:a, :b, :c, :d]::uuid[]) x;

-- a fresh garage with 10 000 EUR in the company cash and no open bills
create or replace function tests.f1_found(p_player uuid, p_name text) returns uuid language plpgsql as $$
declare
  v_co uuid;
begin
  perform tests.login_as('authenticated', p_player);
  perform public.found_company(gen_random_uuid(), p_name, 'Alles für alle', 'tech', '#335577', 'garage');
  reset role;
  select company_id into v_co from public.player_companies where founder_id = p_player;
  perform public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(v_co),
                                 1000000 - tests.company_cash(v_co), 'transfer', 'Test-Kapital', 'company', v_co,
                                 'test:f1:cash:' || v_co::text);
  update public.player_companies set unpaid_cents = 0 where company_id = v_co;
  return v_co;
end;
$$;
grant execute on all functions in schema tests to public;

select tests.f1_found(:a, 'Anna Kasse') as aco \gset
select tests.f1_found(:b, 'Ben Kasse') as bco \gset
select tests.f1_found(:c, 'Cem Kasse') as cco \gset
select tests.f1_found(:d, 'Dora Kasse') as dco \gset

-- =============================================================================
-- A. Before the first withdrawal: allowed, the card knows the rhythm
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.get_my_company() -> 'company' -> 'withdraw' as w0 \gset
reset role;
select tests.assert(
  (:'w0'::jsonb ->> 'interval_hours')::numeric = 6
  and :'w0'::jsonb -> 'last_at' = 'null'::jsonb and :'w0'::jsonb -> 'next_at' = 'null'::jsonb
  and (:'w0'::jsonb ->> 'issue_locked_cents')::bigint = 0 and :'w0'::jsonb -> 'issue_locked_until' = 'null'::jsonb,
  'f1: company_state() withdraw: 6 h interval, never withdrawn, allowed now, nothing locked');

-- =============================================================================
-- B. One withdrawal, then 6 hours pause
-- =============================================================================
select tests.cash(:a) as ap0, tests.company_cash(:'aco') as ac0 \gset
select tests.login_as('authenticated', :a);
select public.company_withdraw(:rq1, 100000) -> 'company' -> 'withdraw' as w1 \gset
reset role;
select tests.assert(
  tests.cash(:a) = :ap0::bigint + 100000 and tests.company_cash(:'aco') = :ac0::bigint - 100000
  and (select last_withdraw_at from public.player_companies where company_id = :'aco')
      between public.game_now() - interval '1 minute' and public.game_now()
  and (:'w1'::jsonb ->> 'last_at')::timestamptz
      = (select last_withdraw_at from public.player_companies where company_id = :'aco')
  and (:'w1'::jsonb ->> 'next_at')::timestamptz = (:'w1'::jsonb ->> 'last_at')::timestamptz + interval '6 hours',
  'f1: a withdrawal books the money and sets the next possible one 6 h later');

select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.company_withdraw(gen_random_uuid(), 1000)$$, 'withdraw_cooldown',
  'f1: a second withdrawal within 6 h is refused');
select tests.throws_key($$select public.company_withdraw(gen_random_uuid(), 99000000)$$, 'insufficient_funds',
  'f1: too much money still says insufficient_funds first');
-- the replay of the first request returns its answer, it is no new withdrawal
select public.company_withdraw(:rq1, 100000) -> 'company' -> 'withdraw' = :'w1'::jsonb as same \gset
select public.company_deposit(gen_random_uuid(), 50000) -> 'company' -> 'withdraw' ->> 'next_at' as dnext \gset
reset role;
select tests.assert(:'same'::boolean and tests.cash(:a) = :ap0::bigint + 100000 - 50000
  and :'dnext'::timestamptz = (:'w1'::jsonb ->> 'next_at')::timestamptz,
  'f1: replay is idempotent; a deposit does not touch the rhythm');

select (select count(*) from public.ledger_transactions t where t.idempotency_key like 'withdraw:%'
          and t.ref_id = :'aco'::uuid) as wn \gset
select tests.assert(:wn::int = 1, 'f1: exactly one withdrawal booking');

-- an error code for the client
select tests.assert(
  position('''withdraw_cooldown''' in pg_get_functiondef('public.api_error(text)'::regprocedure)) > 0
  and position('NX213' in pg_get_functiondef('public.api_error(text)'::regprocedure)) > 0,
  'f1: api_error() knows withdraw_cooldown (NX213)');

-- 6 hours later (game clock): allowed again
update public.player_companies set last_withdraw_at = public.game_now() - interval '6 hours 1 second'
 where company_id = :'aco';
select tests.login_as('authenticated', :a);
select public.get_my_company() -> 'company' -> 'withdraw' ->> 'next_at' is null as anext \gset
select public.company_withdraw(gen_random_uuid(), 100000) is not null as ok \gset
reset role;
select tests.assert(:'anext'::boolean and tests.cash(:a) = :ap0::bigint + 150000,
  'f1: after 6 h the next withdrawal works');

-- 5 h 59 min is not yet enough
update public.player_companies set last_withdraw_at = public.game_now() - interval '5 hours 59 minutes'
 where company_id = :'aco';
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.company_withdraw(gen_random_uuid(), 1000)$$, 'withdraw_cooldown',
  'f1: 5 h 59 min after the last withdrawal it is still refused');
reset role;

-- the interval comes from game_config
select tests.set_cfg('startups', '{withdrawIntervalHours}', '0');
select tests.login_as('authenticated', :a);
select public.company_withdraw(gen_random_uuid(), 1000) is not null as ok \gset
select public.company_withdraw(gen_random_uuid(), 1000) is not null as ok \gset
reset role;
select tests.set_cfg('startups', '{withdrawIntervalHours}', '6');

-- =============================================================================
-- C. Four players: everyone has an own rhythm
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.company_withdraw(gen_random_uuid(), 200000) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select public.company_withdraw(gen_random_uuid(), 300000) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :d);
select public.get_my_company() -> 'company' -> 'withdraw' ->> 'next_at' is null as dn \gset
select public.company_withdraw(gen_random_uuid(), 400000) is not null as ok \gset
select tests.throws_key($$select public.company_withdraw(gen_random_uuid(), 1000)$$, 'withdraw_cooldown',
  'f1: Dora waits after her own withdrawal');
reset role;
select tests.assert(:'dn'::boolean
  and (select count(*) from public.player_companies where company_id in (:'bco', :'cco', :'dco')
        and last_withdraw_at > public.game_now() - interval '1 minute') = 3,
  'f1: the withdrawals of others do not block a founder');

-- the helper functions are internal
select tests.assert(
  not has_function_privilege('authenticated', 'public.company_withdraw_json(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.company_withdraw_next_at(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.company_withdraw(uuid, bigint)', 'execute'),
  'f1: company_withdraw_json() and company_withdraw_next_at() are internal');

select tests.assert(:'inv0'::boolean and tests.money_invariant() = 'ok' and not exists (select 1 from public.ledger_audit()),
  'f1: the money invariant holds');
