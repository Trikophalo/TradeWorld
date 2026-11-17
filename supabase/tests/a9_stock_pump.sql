-- =============================================================================
-- a9 · No money from pumping the own stock (ADR-170)
-- =============================================================================
-- The owner's report: take money out of the company, buy the own stock, the price rises, repeat. Before ADR-170 the
-- loop paid through capital increases: AI investors bought new shares at 90 % of the pushed price (at least 1 EUR)
-- and the founder withdrew their money (250.000 EUR per round for a stock at 0.45 EUR).
\set QUIET 1
set client_min_messages = notice;

-- ADR-180 changed the company scale (market x 10, capacity x 1.5, idle AI workers at the standby share). This file
-- checks the mechanics with the numbers it was written for; the end of the file restores the current values.
select tests.set_cfg('startups', '{marketFactorByTier}', '{"garage": 1, "small_business": 4, "gmbh": 15, "ag": 40}') is null as ok \gset
select tests.set_cfg('startups', '{capacityCentsPerProductivity}',
  '{"tech": 300000, "retail": 250000, "energy": 250000, "pharma": 300000, "logistics": 250000}') is null as ok \gset
select tests.set_cfg('startups', '{aiWorkerStandbyBps}', '10000') is null as ok \gset
select tests.set_cfg('startups', '{gmbh,fixedCostCentsPerQuarter}', '600000') is null as ok \gset

\set f '''0a90a90a-0000-4000-8000-0000000000f1'''
\set a '''0a90a90a-0000-4000-8000-0000000000a1'''
\set b '''0a90a90a-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:f, 'Pia_Pumpe') is not null and tests.signup(:a, 'Anna_Hinundher') is not null
   and tests.signup(:b, 'Bert_Hinundher') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 12);
select tests.set_level(:a, 12);
select tests.set_level(:b, 12);
select tests.fund(:f, 5000000, 'test:a9:f');
select tests.fund(:a, 50000000, 'test:a9:a');
select tests.fund(:b, 50000000, 'test:a9:b');

-- sells everything above p_keep_e6 in chunks of at most maxOrderQuantity
create or replace function tests.sell_down(p_player uuid, p_sec uuid, p_keep_e6 bigint) returns void language plpgsql as $$
declare
  q bigint;
begin
  loop
    select coalesce(sum(x.quantity_e6 - x.reserved_quantity_e6), 0) - p_keep_e6 into q from public.positions x
     where x.player_id = p_player and x.security_id = p_sec and x.status = 'open';
    exit when q <= 0;
    perform tests.login_as('authenticated', p_player);
    perform public.place_order(gen_random_uuid(), (select ticker from public.securities where id = p_sec), 'sell', 'market',
                               least(q, 100000000000));
    reset role;
  end loop;
end;
$$;
grant execute on all functions in schema tests to public;

begin;
select tests.set_cfg('aiInvestors', '{tickNoiseScale}', '0');

-- =============================================================================
-- A. The formula in SQL as in src/lib/sim/startup.ts (issueAiFactor, startup.test.ts)
-- =============================================================================
select tests.assert(
  public.issue_ai_factor(100, 100) = 1 and public.issue_ai_factor(100, 50) = 1
  and public.issue_ai_factor(80, 100) = 0 and public.issue_ai_factor(100, 101) = 0
  and public.issue_ai_factor(0, 100) = 0 and public.issue_ai_factor(100, 0) = 0,
  'issue_ai_factor(): AI investors subscribe up to the fair value, nothing above it');

-- =============================================================================
-- B. A listed player company: founder 60 %, AI investors 40 % at the minimum issue price
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Pumpwerk', 'Nach oben', 'tech', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.company_of(:f) as co \gset
update public.player_companies set quality = 1 where company_id = :'co';
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select c.ticker as tkr, c.security_id as sec from public.companies c where c.id = :'co' \gset
select tests.neutral(:'sec');
update public.security_quotes set prev_close_e4 = last_price_e4 where security_id = :'sec';
select set_config('a9.tkr', :'tkr', false) is not null and set_config('a9.sec', :'sec', false) is not null as ok \gset
select tests.company_cash(:'co') as k0, tests.cash(:f) as c0,
       (select last_price_e4 from public.security_quotes where security_id = :'sec') as p0 \gset

-- the IPO money belongs to the company for issueProceedsLockHours
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.company_withdraw(gen_random_uuid(), 30000000)$$, 'issue_proceeds_locked',
  'company_withdraw(): the IPO proceeds cannot be withdrawn right away');
reset role;
select tests.set_cfg('startups', '{ipo,issueProceedsLockHours}', '0');  -- three days later

-- =============================================================================
-- C. The exploit loop: withdraw, buy the own stock, capital increase, withdraw the AI money, sell
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.company_withdraw(gen_random_uuid(), 30000000) is not null as ok \gset
select tests.throws_key(format($$select public.place_order(gen_random_uuid(), %L, 'buy', 'market', null, null, 1000000)$$, :'tkr'),
  'insider_cooldown', 'place_order(): no buying the own stock right after taking money out of the company');
reset role;
-- others may buy at once; the founder may sell
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), :'tkr', 'buy', 'market', null, null, 100000) ->> 'status' as abuy \gset
reset role;
select tests.assert(:'abuy' = 'filled', 'place_order(): other players buy the stock as usual');

select tests.set_cfg('trading', '{playerStocks,insiderCooldownHours}', '0');  -- a day later
select tests.cash(:f) + tests.company_cash(:'co') as w0 \gset
select tests.login_as('authenticated', :f);
select public.place_order(gen_random_uuid(), :'tkr', 'buy', 'market', null, null, 1000000) ->> 'status' as b1 \gset
select public.place_order(gen_random_uuid(), :'tkr', 'buy', 'market', null, null, 1000000) ->> 'status' as b2 \gset
select public.place_order(gen_random_uuid(), :'tkr', 'buy', 'market', null, null, 1000000) ->> 'status' as b3 \gset
reset role;
select (select sum(x) from unnest(tests.run_ticks(:'sec', public.game_now(), 12)) x) as g1 \gset
select last_price_e4 as p1 from public.security_quotes where security_id = :'sec' \gset
select tests.assert(:'b1' = 'filled' and :p1::bigint > :p0::bigint and :p1::bigint <= ceil(:p0::bigint * 2.0),
  'the founder''s buying lifts the price, but at most dailyBandBps (100 %) over the previous close ('
  || :p0 || ' -> ' || :p1 || ')');

select tests.login_as('authenticated', :f);
select public.capital_increase(gen_random_uuid(), 25) -> 'company' -> 'listing' -> 'offer' ->> 'id' as ci \gset
reset role;
select ai_factor as cif, price_cents as cip from public.company_share_offers where id = :'ci' \gset
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'ci';
select public.close_due_offers() is not null as ok \gset
select shares_ai_e6 as ciai from public.company_share_offers where id = :'ci' \gset
select tests.assert(:cif::double precision = 0 and :ciai::bigint = 0,
  'capital increase at the pushed price: AI investors pay nothing above the fair value (factor ' || :cif
  || ', price ' || :cip || ' ct)');
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.capital_increase(gen_random_uuid(), 25)$$, 'capital_increase_cooldown',
  'capital_increase(): at most once per capitalIncreaseCooldownHours');
reset role;

select coalesce(sum(p.quantity_e6 - p.reserved_quantity_e6), 0) - 600000000000 as q from public.positions p
 where p.player_id = :f and p.security_id = :'sec' and p.status = 'open' \gset
select tests.login_as('authenticated', :f);
select public.place_order(gen_random_uuid(), :'tkr', 'sell', 'market', :q::bigint) ->> 'status' as s1 \gset
reset role;
select tests.cash(:f) + tests.company_cash(:'co') as w1 \gset
select tests.assert(:'s1' = 'filled' and :w1::bigint < :w0::bigint,
  'withdraw, buy own stock, capital increase, sell: the founder (cash + company cash) loses '
  || ((:w0::bigint - :w1::bigint) / 100.0) || ' EUR');

-- =============================================================================
-- D. Pushing harder: ten buys of 10.000 EUR within an hour stay inside the band
-- =============================================================================
select last_price_e4 as p2 from public.security_quotes where security_id = :'sec' \gset
update public.security_quotes set prev_close_e4 = last_price_e4 where security_id = :'sec';
select tests.cash(:f) as d0 \gset
do $$
declare
  i integer;
begin
  for i in 1 .. 10 loop
    perform tests.login_as('authenticated', '0a90a90a-0000-4000-8000-0000000000f1'::uuid);
    perform public.place_order(gen_random_uuid(), current_setting('a9.tkr'),
                               'buy', 'market', null, null, 1000000);
    reset role;
    perform tests.run_ticks(current_setting('a9.sec')::uuid, public.game_now() + i * interval '6 minutes', 60);
  end loop;
end;
$$;
select last_price_e4 as p3, (select max(last_price_e4) from public.security_quotes where security_id = :'sec') as pmax
  from public.security_quotes where security_id = :'sec' \gset
select tests.sell_down(:f, :'sec', 600000000000);
select tests.assert(:p3::bigint <= ceil(:p2::bigint * 2.0) and tests.cash(:f) < :d0::bigint,
  '100.000 EUR of buying in an hour: price ' || :p2 || ' -> ' || :p3 || ' (band 100 %), selling again loses '
  || ((:d0::bigint - tests.cash(:f)) / 100.0) || ' EUR');

-- =============================================================================
-- E. Two players trading back and forth lose together
-- =============================================================================
select tests.neutral(:'sec');
update public.security_quotes set prev_close_e4 = last_price_e4 where security_id = :'sec';
select coalesce(sum(p.quantity_e6 - p.reserved_quantity_e6), 0) as qa from public.positions p
 where p.player_id = :a and p.security_id = :'sec' and p.status = 'open' \gset
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), :'tkr', 'sell', 'market', :qa::bigint) is not null as ok \gset
reset role;
select tests.cash(:a) + tests.cash(:b) as ab0 \gset
do $$
declare
  i integer;
  q bigint;
  p uuid;
begin
  for i in 1 .. 4 loop
    foreach p in array array['0a90a90a-0000-4000-8000-0000000000a1', '0a90a90a-0000-4000-8000-0000000000b1']::uuid[] loop
      perform tests.login_as('authenticated', p);
      perform public.place_order(gen_random_uuid(), current_setting('a9.tkr'),
                                 'buy', 'market', null, null, 500000);
      reset role;
    end loop;
    perform tests.run_ticks(current_setting('a9.sec')::uuid, public.game_now() + interval '2 hours' + i * interval '1 minute', 3);
    foreach p in array array['0a90a90a-0000-4000-8000-0000000000a1', '0a90a90a-0000-4000-8000-0000000000b1']::uuid[] loop
      select coalesce(sum(x.quantity_e6 - x.reserved_quantity_e6), 0) into q from public.positions x
       where x.player_id = p and x.security_id = current_setting('a9.sec')::uuid and x.status = 'open';
      perform tests.login_as('authenticated', p);
      perform public.place_order(gen_random_uuid(), current_setting('a9.tkr'),
                                 'sell', 'market', q);
      reset role;
    end loop;
  end loop;
end;
$$;
select tests.assert(tests.cash(:a) + tests.cash(:b) < :ab0::bigint,
  'two friends buying and selling to each other four times lose '
  || ((:ab0::bigint - tests.cash(:a) - tests.cash(:b)) / 100.0) || ' EUR together');

-- =============================================================================
-- F. Normal investing still works
-- =============================================================================
select s.ticker as atkr from public.securities s join public.companies c on c.id = s.company_id
 where s.kind = 'stock' and s.status = 'listed' and c.tier = 'midcap'
   and not exists (select 1 from public.player_companies pc where pc.company_id = c.id) order by s.ticker limit 1 \gset
select tests.login_as('authenticated', :f);
select public.place_order(gen_random_uuid(), :'atkr', 'buy', 'market', null, null, 100000) ->> 'status' as nb \gset
reset role;
select tests.assert(:'nb' = 'filled', 'the founder still buys other stocks right after a withdrawal');
-- a fair capital increase still finds AI investors
select tests.neutral(:'sec');
update public.company_share_offers set created_at = now() - interval '2 days' where id = :'ci';
select tests.set_company_cash(:'co', 500000000);
update public.security_quotes set last_price_e4 = 30000 where security_id = :'sec';
select tests.login_as('authenticated', :f);
select public.capital_increase(gen_random_uuid(), 10) -> 'company' -> 'listing' -> 'offer' ->> 'id' as ci2 \gset
reset role;
select ai_factor as cif2 from public.company_share_offers where id = :'ci2' \gset
select tests.assert(:cif2::double precision = 1,
  'capital increase below the fair value: AI investors take their full share (factor ' || :cif2 || ')');

select tests.assert(tests.money_invariant() = 'ok', 'money invariant: ' || tests.money_invariant());
rollback;

-- ADR-180: back to the current company scale
select tests.set_cfg('startups', '{marketFactorByTier}', '{"garage": 10, "small_business": 40, "gmbh": 150, "ag": 400}') is null as ok \gset
select tests.set_cfg('startups', '{capacityCentsPerProductivity}',
  '{"tech": 450000, "retail": 375000, "energy": 375000, "pharma": 450000, "logistics": 375000}') is null as ok \gset
select tests.set_cfg('startups', '{aiWorkerStandbyBps}', '2500') is null as ok \gset
select tests.set_cfg('startups', '{gmbh,fixedCostCentsPerQuarter}', '360000') is null as ok \gset
