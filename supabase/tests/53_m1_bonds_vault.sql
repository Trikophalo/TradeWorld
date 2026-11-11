-- =============================================================================
-- 53 · M1 bonds and quarter close (via admin_close_quarter), vault, admin
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set h '''0a0a0a0a-0000-4000-8000-0000000000aa'''
\set i '''0b0b0b0b-0000-4000-8000-0000000000bb'''
\set v '''07070707-0000-4000-8000-000000000077'''

select tests.signup(:h, 'Hanna') is not null and tests.signup(:i, 'Ingo') is not null as ok \gset
insert into public.admin_users (user_id, note) values (:h, 'm1 test admin');
select tests.set_level(:i, 5);

-- =============================================================================
-- 1. bond: buy, quarter closes until maturity, coupons net of tax, face value
-- =============================================================================
begin;
select tests.cash(:i) as i_cash0 \gset
select count(*) as closed0 from public.game_quarters where status = 'closed' \gset
select tests.login_as('authenticated', :i);
select public.place_order(gen_random_uuid(), 'NXB01', 'buy', 'market', 50) as bb \gset
select tests.throws_key($$select public.admin_close_quarter()$$, 'forbidden', 'admin_close_quarter() needs an admin');
reset role;
\echo '   bond buy:' :bb

select tests.login_as('authenticated', :h);
select public.admin_close_quarter() as q1 \gset
select public.admin_close_quarter() as q2 \gset
select public.admin_close_quarter() as q3 \gset
select public.admin_close_quarter() as q4 \gset
select public.admin_close_quarter() as q5 \gset
reset role;
\echo '   quarter close:' :q1

select tests.assert(
  (select count(*) from public.game_quarters where status = 'closed') = :closed0 + 5
  and (select q.status from public.game_quarters q where q.id = (public.current_game_quarter()).id) = 'active'
  and (:'q5'::jsonb ->> 'next_quarter_id')::bigint = (public.current_game_quarter()).id,
  'admin_close_quarter() x 5: five quarters closed, game time moved on, the next quarter is active');
select tests.assert(
  (select count(*) from public.company_quarter_reports r where r.game_quarter_id = (:'q1'::jsonb ->> 'closed_quarter_id')::bigint) = 15
  and (select count(*) from public.news_items n where n.category = 'earnings' and n.game_quarter_id = (:'q1'::jsonb ->> 'closed_quarter_id')::bigint) = 15
  and (select bool_and(fair_value_e4 > 0) from public.security_sim_state),
  'every close publishes 15 quarterly reports and 15 earnings news; fair values stay positive');
select 'e.g. "' || headline || '" / ' || coalesce(body, '') as sample from public.news_items where category = 'earnings' order by id desc limit 1 \gset
\echo '  ' :sample
select tests.assert(
  (select count(*) from public.job_runs where job_name = 'quarter_close' and status = 'succeeded') >= 5
  and public.close_game_quarter((:'q1'::jsonb ->> 'closed_quarter_id')::bigint) ->> 'skipped' is not null,
  'quarter close is idempotent per quarter (job_runs)');

select tests.assert(
  (select s.status = 'matured' and not s.is_tradable from public.securities s where s.ticker = 'NXB01')
  and tests.qty(:i, 'NXB01') = 0,
  'NXB01 matured within 5 quarter closes; the position is closed');
select tests.assert(
  (select t.price_e4 = 1000000 and t.fee_cents = 0 and t.counterparty = 'issuer' and t.quantity = 50
     from public.trades t join public.securities s on s.id = t.security_id
    where t.player_id = :i and s.ticker = 'NXB01' and t.side = 'sell'),
  'redemption: 50 bonds sold to the issuer at face value (100 EUR), no fee');
select tests.assert(
  (select count(*) >= 3 and bool_and(p.tax_cents = public.apply_bps(p.gross_cents, 2500) and p.net_cents = p.gross_cents - p.tax_cents)
     from public.distribution_payouts p join public.security_distributions d on d.id = p.distribution_id
     join public.securities s on s.id = d.security_id where p.player_id = :i and s.ticker = 'NXB01'),
  'coupons paid every quarter, taxed at 25 %: ' ||
  (select string_agg(p.gross_cents || '/' || p.net_cents, ', ' order by p.id) from public.distribution_payouts p where p.player_id = :i) || ' cents gross/net');
select tests.assert(
  tests.cash(:i) = :i_cash0 - (:'bb'::jsonb ->> 'gross_cents')::bigint - 100
     + (select sum(p.net_cents) from public.distribution_payouts p where p.player_id = :i)
     + (select t.gross_cents - t.tax_cents from public.trades t where t.player_id = :i and t.side = 'sell'),
  'cash = start - purchase - fee + net coupons + face value (minus tax on a redemption gain)');
select tests.assert(
  (select count(*) from public.bonds b join public.securities s on s.id = b.security_id
    where s.status = 'listed' and b.term_game_years = 1 and s.ticker like 'NXB01%' and b.matures_at > public.game_now()) = 1
  and (select successor_security_id is not null from public.bonds b join public.securities s on s.id = b.security_id where s.ticker = 'NXB01'),
  'a successor 1-year bond series was issued (' ||
  (select string_agg(s.ticker || ' ' || b.coupon_bps || ' bps', ', ') from public.bonds b join public.securities s on s.id = b.security_id
    where s.status = 'listed' and b.term_game_years = 1) || ')');
select tests.assert(
  (select count(*) from public.securities s join public.bonds b on b.security_id = s.id where s.status = 'listed') = 4,
  'still exactly one listed bond per maturity (1, 2, 5, 10)');
select tests.assert((select sum(amount_cents) from public.ledger_entries) = 0 and (select count(*) from public.ledger_audit()) = 0,
  'ledger balanced after coupons and redemption');
select tests.assert((public.market_tick() ->> 'securities')::int = 19, 'the tick prices the new bond series');
rollback;

-- =============================================================================
-- 2. run_due_jobs() (pg_cron every minute), rolled back
-- =============================================================================
begin;
select public.run_due_jobs() as jobs \gset
select tests.assert(:'jobs'::jsonb ? 'quarters' and :'jobs'::jsonb ? 'bonds_issued'
  and not exists (select 1 from public.game_quarters where ends_at <= now() and status <> 'closed'),
  'run_due_jobs(): every ended quarter is closed afterwards; ' || (:'jobs'::jsonb -> 'quarters')::text);
select tests.assert(public.run_due_jobs() -> 'quarters' = '[]'::jsonb, 'run_due_jobs() is idempotent');
rollback;

-- =============================================================================
-- 3. admin pause
-- =============================================================================
begin;
select tests.login_as('authenticated', :h);
select public.admin_set_paused(true) as p1 \gset
select tests.assert((:'p1'::jsonb ->> 'paused')::boolean and (public.get_market_snapshot() ->> 'paused')::boolean,
  'admin_set_paused(true): snapshot reports paused');
select tests.assert(public.admin_run_tick() ->> 'skipped' = 'paused', 'admin_run_tick() while paused does nothing');
select public.admin_set_paused(false) as p2 \gset
select tests.assert(not (:'p2'::jsonb ->> 'paused')::boolean and (public.admin_run_tick() ->> 'tick_seq') is not null,
  'admin_set_paused(false) + admin_run_tick() runs a tick');
reset role;
select tests.assert((select count(*) from public.admin_actions where admin_id = :h and action = 'set_paused') = 2, 'admin actions are audited');
select tests.login_as('authenticated', :i);
select tests.throws_key($$select public.admin_set_paused(true)$$, 'forbidden', 'non-admin cannot pause');
select tests.throws_key($$select public.admin_run_tick()$$, 'forbidden', 'non-admin cannot run a tick');
reset role;
rollback;

-- =============================================================================
-- 4. vault: new accounts start with economy.vaultInitialHours (2 h) of income
-- =============================================================================
select tests.signup(:v, 'Vera') is not null as ok \gset
select gen_random_uuid() as rv \gset
select tests.login_as('authenticated', :v);
select public.get_my_portfolio() as vp \gset
select public.claim_vault(:'rv') as c1 \gset
select public.claim_vault(:'rv') as c1b \gset
select tests.throws_key($$select public.claim_vault(gen_random_uuid())$$, 'nothing_to_claim', 'claiming again right away');
select public.get_my_portfolio() as vp2 \gset
reset role;
select tests.assert(
  (:'vp'::jsonb -> 'vault' ->> 'accrued_cents')::bigint between 20000 and 20050
  and (:'vp'::jsonb -> 'vault' ->> 'cap_cents')::bigint = 80000
  and (:'vp'::jsonb -> 'vault' ->> 'rate_cents_per_hour')::bigint = 10000
  and :'vp'::jsonb -> 'vault' ?& array['accrued_cents', 'cap_cents', 'rate_cents_per_hour', 'last_claimed_at', 'full_at', 'server_time']
  and (:'vp'::jsonb -> 'vault' ->> 'last_claimed_at') is null,
  'new account: vault holds 2 h of basic income (' || (:'vp'::jsonb -> 'vault' ->> 'accrued_cents') || ' cents), cap 8 h');
select tests.assert(
  (:'c1'::jsonb ->> 'claimed_cents')::bigint >= 20000 and :'c1b'::jsonb = :'c1'::jsonb
  and (:'c1'::jsonb ->> 'cash_cents')::bigint = 1000000 + (:'c1'::jsonb ->> 'claimed_cents')::bigint
  and tests.cash(:v) = (:'c1'::jsonb ->> 'cash_cents')::bigint
  and (select count(*) from public.vault_claims where player_id = :v) = 1,
  'claim_vault(): pays the vault from the mint once per request_id');
select tests.assert(
  (:'vp2'::jsonb -> 'vault' ->> 'accrued_cents')::bigint < 100 and (:'vp2'::jsonb -> 'vault' ->> 'last_claimed_at') is not null
  and (:'vp2'::jsonb ->> 'total_cents')::bigint = tests.cash(:v),
  'after the claim the vault starts again from zero');
