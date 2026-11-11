-- =============================================================================
-- 56 · M2 closed money system: genesis, invariant, state flows, basic income
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set m '''0c1c1c1c-0000-4000-8000-00000000001c'''
select public.config_bigint('money', '{totalSupplyCents}', -1) as total \gset

create or replace function tests.money_invariant() returns text language sql as $$
  select case
    when (select sum(balance_cents) from public.ledger_accounts where system_key is distinct from 'world_genesis')
         = public.config_bigint('money', '{totalSupplyCents}', -1)
     and (select balance_cents from public.ledger_accounts where system_key = 'world_genesis')
         = -public.config_bigint('money', '{totalSupplyCents}', -1)
     and (select balance_cents from public.ledger_accounts where system_key = 'mint') = 0
     and not exists (select 1 from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                      where e.account_id = public.ledger_system_account('mint')
                        and e.id > (select max(e2.id) from public.ledger_entries e2 join public.ledger_transactions g on g.id = e2.transaction_id
                                     where g.idempotency_key = 'money:genesis')
                        and coalesce(t.idempotency_key, '') not like 'money:resource:%')
     and not exists (select 1 from public.ledger_accounts where kind = 'system' and system_key <> 'world_genesis' and (allow_negative or balance_cents < 0))
     and (select sum(amount_cents) from public.ledger_entries) = 0
     and not exists (select 1 from public.ledger_audit())
    then 'ok' else 'BROKEN' end $$;
grant execute on function tests.money_invariant() to public;

select tests.assert(
  (select count(*) from public.ledger_transactions where idempotency_key = 'money:genesis') = 1
  and (public.money_genesis() ->> 'skipped') = 'genesis_done',
  'exactly one genesis transaction; money_genesis() is idempotent');
select tests.assert(tests.money_invariant() = 'ok',
  'invariant: all accounts except world_genesis sum to ' || :total || ' cents, the mint is 0 and closed, no system account can go negative');
select 'accounts: ' || string_agg(system_key || ' ' || round(balance_cents / 100.0)::text, ', ' order by system_key) as acc
  from public.ledger_accounts where kind = 'system' and balance_cents <> 0 \gset
\echo '  ' :acc
select tests.throws($$select public.ledger_transfer(public.ledger_system_account('mint'), public.ledger_system_account('fees'), 100, 'transfer')$$,
  'NX003', 'the mint cannot post after the genesis');
select tests.throws($$select public.ledger_transfer(public.ledger_system_account('world_genesis'), public.ledger_system_account('treasury'), 100, 'transfer')$$,
  'NX003', 'world_genesis accepts no second transaction');
select tests.throws($$select public.ledger_transfer(public.ledger_system_account('treasury'), public.ledger_system_account('households'), 1000000000000000, 'transfer')$$,
  'NX001', 'the treasury cannot go negative');

-- starting capital after the genesis comes from the treasury -----------------------
select public.treasury_balance_cents() as t0 \gset
select tests.signup(:m, 'Mona') is not null as ok \gset
select tests.assert(
  public.treasury_balance_cents() = :t0 - 1000000
  and (select count(*) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.idempotency_key = 'starting_capital:' || :m and e.account_id = public.ledger_system_account('treasury')
          and e.amount_cents = -1000000) = 1,
  'starting capital (10 000 EUR) is paid by the treasury');

-- basic income factor follows the treasury (rolled back) ------------------------------
begin;
select public.ledger_transfer(public.ledger_system_account('treasury'), public.ledger_system_account('households'),
       public.treasury_balance_cents() - 1000000000, 'transfer', 'test: drain the treasury') is not null as ok \gset
select tests.login_as('authenticated', :m);
select public.get_my_portfolio() as pf \gset
select public.claim_vault(gen_random_uuid()) as cv \gset
select public.get_market_snapshot() as snap \gset
reset role;
select tests.assert(
  public.basic_income_factor_bps() = 2500
  and (:'pf'::jsonb -> 'vault' ->> 'factor_bps')::int = 2500
  and (:'pf'::jsonb -> 'vault' ->> 'rate_cents_per_hour')::bigint = 2500
  and (:'cv'::jsonb ->> 'factor_bps')::int = 2500
  and (:'cv'::jsonb ->> 'claimed_cents')::bigint between 5000 and 5050,
  'treasury at 10 Mio. EUR (target 250 Mio.): basic income factor 25 % (minimum), 25 EUR/h, the 2 h vault pays ' || (:'cv'::jsonb ->> 'claimed_cents') || ' cents');
select tests.assert(
  :'snap'::jsonb -> 'economy' ?& array['money_supply_cents', 'treasury_cents', 'basic_income_factor_bps']
  and (:'snap'::jsonb -> 'economy' ->> 'treasury_cents')::bigint = public.treasury_balance_cents()
  and (:'snap'::jsonb -> 'economy' ->> 'basic_income_factor_bps')::int = 2500,
  'get_market_snapshot().economy: money supply, treasury, basic income factor');
-- an empty treasury: starting capital is still paid, from the households, and logged
select public.ledger_transfer(public.ledger_system_account('treasury'), public.ledger_system_account('households'),
       public.treasury_balance_cents(), 'transfer', 'test: empty the treasury') is not null as ok \gset
select tests.signup('0c2c2c2c-0000-4000-8000-00000000002c', 'Nils') is not null as ok \gset
select tests.assert(
  tests.cash('0c2c2c2c-0000-4000-8000-00000000002c') = 1000000
  and exists (select 1 from public.admin_actions where action = 'state_payout_from_households'),
  'empty treasury: the starting capital comes from the households (logged in admin_actions)');
select tests.assert(tests.money_invariant() = 'ok', 'invariant holds after the state ran dry');
rollback;

-- the financial market can not pay: market_illiquid (rolled back) -----------------------
begin;
select tests.login_as('authenticated', :m);
select public.place_order(gen_random_uuid(), 'BRZ', 'buy', 'market', 5000000) is not null as ok \gset
reset role;
select public.ledger_transfer(public.ledger_system_account('market'), public.ledger_system_account('households'),
       (select balance_cents from public.ledger_accounts where system_key = 'market'), 'transfer', 'test: drain the market') is not null as ok \gset
select tests.login_as('authenticated', :m);
select tests.throws_key($$select public.place_order(gen_random_uuid(), 'BRZ', 'sell', 'market', 5000000)$$, 'market_illiquid',
  'a sell the financial market cannot pay is rejected');
reset role;
rollback;

-- quarter closes with coupons and redemptions keep the invariant (rolled back) ----------
begin;
select tests.set_level(:m, 5);
select tests.login_as('authenticated', :m);
select public.place_order(gen_random_uuid(), 'NXB01', 'buy', 'market', 20000000) is not null as ok \gset
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', 2500000) is not null as ok \gset
select public.claim_vault(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.login_as('authenticated', '0a0a0a0a-0000-4000-8000-0000000000aa');
select public.admin_close_quarter() is not null as ok \gset
select public.admin_close_quarter() is not null as ok \gset
select public.admin_close_quarter() is not null as ok \gset
select public.admin_close_quarter() is not null as ok \gset
select public.admin_close_quarter() is not null as ok \gset
reset role;
select public.market_tick() is not null as ok \gset
select tests.login_as('authenticated', :m);
select public.place_order(gen_random_uuid(), 'KLS', 'sell', 'market', 2500000) is not null as ok \gset
reset role;
select tests.assert(
  exists (select 1 from public.distribution_payouts where player_id = :m)
  and (select status from public.securities where ticker = 'NXB01') = 'matured',
  'coupons were paid and NXB01 was redeemed');
select tests.assert(tests.money_invariant() = 'ok',
  'invariant after trades, a vault claim, coupons, a redemption and five quarter closes');
rollback;
select tests.assert(tests.money_invariant() = 'ok', 'invariant after all M1/M2 tests so far');
