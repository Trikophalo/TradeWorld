-- =============================================================================
-- f5 · Player stocks valued from expected profit, not from piled-up cash (ADR-217)
-- =============================================================================
-- The owner: "Alle Spieler-Aktien steigen immer noch ununterbrochen." Formulas as in src/lib/sim/player-valuation.ts
-- (player-valuation.test.ts).
\set QUIET 1
set client_min_messages = notice;

\set f '''0f5a5a5a-0000-4000-8000-0000000000f1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:f, 'Kurt_Kurswert') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 12);
select tests.fund(:f, 5000000, 'test:f5:f');

begin;
select public.config_jsonb('playerValuation') as pv \gset

-- =============================================================================
-- A. Formulas
-- =============================================================================
-- retail: sin(2π (h / 131 + 0,55)) = 0 at h = 131 × 0,45
select public.player_valuation_value(2400000, 24, 2400000, 24, 1000000, 1000000, 'retail', 14, 0.5, 50, 131 * 0.45, :'pv') as v0 \gset
select tests.assert(
  abs((:'v0'::jsonb ->> 'value_cents')::numeric - 17800000) < 1
  and abs((:'v0'::jsonb ->> 'multiple')::numeric - 1) < 1e-9
  and (:'v0'::jsonb ->> 'yearly_profit_cents')::numeric = 2400000
  and (:'v0'::jsonb ->> 'counted_cash_cents')::numeric = 1000000,
  'player_valuation_value(): cash + yearly profit × P/E × 0,5 × multiple (as playerCompanyValue): ' || :'v0');
select tests.assert(
  abs((public.player_valuation_value(1200000, 12, null, 0, 0, 0, 'retail', 14, 0.5, 50, 131 * 0.45, :'pv') ->> 'yearly_profit_cents')::numeric - 2400000) < 1e-6
  and abs((public.player_valuation_value(100, 2, null, 0, 0, 0, 'retail', 14, 0.5, 50, 131 * 0.45, :'pv') ->> 'yearly_profit_cents')::numeric - 400) < 1e-6,
  'expected yearly profit scaled from the hours that exist (at least 6)');
select tests.assert(
  abs((public.player_valuation_value(2400000, 24, 1200000, 24, 0, 0, 'retail', 14, 0.5, 50, 131 * 0.45, :'pv') ->> 'growth')::numeric
      - exp(0.4)::numeric) < 1e-9
  and abs((public.player_valuation_value(2400000, 24, 2000000, 24, 0, 0, 'retail', 14, 0.5, 50, 131 * 0.45, :'pv') ->> 'growth')::numeric
      - exp(0.8 * ln(1.2))::numeric) < 1e-9
  and abs((public.player_valuation_value(2400000, 24, 3600000, 24, 0, 0, 'retail', 14, 0.5, 50, 131 * 0.45, :'pv') ->> 'growth')::numeric
      - exp(-0.8 * ln(1.5))::numeric) < 1e-9,
  'growth expectation priced in (e^(0,8 × ln growth), at most ±0,4), the multiple contracts when profit falls');
select tests.assert(
  abs((public.player_valuation_value(2400000, 24, 2400000, 24, 0, 0, 'retail', 14, 0.5, 28, 131 * 0.45, :'pv') ->> 'mood')::numeric
      - exp(-0.22)::numeric) < 1e-9
  and abs((public.player_valuation_value(2400000, 24, 2400000, 24, 0, 0, 'tech', 14, 0.5, 50, 83 * 0.15, :'pv') ->> 'cycle')::numeric
      - exp(0.25)::numeric) < 1e-9,
  'a bear market (mood 28) cuts the multiple to × 0,80; the tech P/E cycle peaks at × e^0,25');
select tests.assert(
  (public.player_valuation_value(2400000, 24, 2400000, 24, 1000000 + 28 * 600000, 1000000, 'retail', 14, 0.5, 50, 131 * 0.45, :'pv') ->> 'value_cents')::numeric
    < 17800000 * 1.05
  and abs((public.player_valuation_value(0, 24, 0, 24, 50000000, 0, 'retail', 14, 0.5, 50, 131 * 0.45, :'pv') ->> 'value_cents')::numeric
          - 10000000) < 1,
  'a week of piled-up cash adds less than 5 % (before: +94 %); a cash-rich company keeps 20 % of its cash');
select tests.assert(
  abs(public.player_valuation_fade(0.8, 180, :'pv') - exp(ln(0.8) / 2)) < 1e-9
  and public.player_valuation_fade(0, 10, :'pv') = 1
  and public.player_valuation_anchor(1000, 600, 1000, false) = 600
  and public.player_valuation_anchor(1000, 5000, 1200, false) = 1000
  and public.player_valuation_anchor(1000, 5000, 1200, true) = 4800,
  'shocks fade with 3 hours half-life; the cash anchor stays below the cash and grows with capital increases');

-- =============================================================================
-- B. The minute job on a listed player company
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Kursbremse', 'Glas', 'retail', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.company_of(:f) as co \gset
update public.player_companies set quality = 1 where company_id = :'co';
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select c.security_id as sec, c.shares_outstanding as so from public.companies c where c.id = :'co' \gset
select public.game_now() as t0 \gset
-- 48 closed hours with 1.000 € profit each
insert into public.player_company_hours (company_id, hour_start, demand_cents, capacity_cents, revenue_cents, cogs_cents,
                                         fixed_cents, marketing_cents, pay_factor_bps, profit_cents)
select :'co', date_trunc('hour', :'t0'::timestamptz) - i * interval '1 hour', 0, 0, 200000, 50000, 50000, 0, 10000, 100000
  from generate_series(1, 48) i
on conflict (company_id, hour_start) do nothing;
update public.market_mood set mood = 50;

select fair_value_e4 as fair0 from public.security_sim_state where security_id = :'sec' \gset
select public.player_stock_valuation_run(:'t0') ->> 'stocks' as n1 \gset
select fair_value_e4 as fair1 from public.security_sim_state where security_id = :'sec' \gset
select tests.assert(:n1::integer >= 1 and abs(:fair1::bigint - :fair0::bigint) <= 1
  and exists (select 1 from public.player_stock_valuation v where v.security_id = :'sec' and v.company_id = :'co'
                and v.anchor_cents = greatest(0, tests.company_cash(:'co'))),
  'first run: the stock keeps its fair value (the difference fades as a shock), anchor = cash (' || :fair0 || ' -> ' || :fair1 || ')');

-- without the shock: fair value = model
update public.player_stock_valuation set shock = 1 where security_id = :'sec';
select public.player_stock_valuation_run(:'t0') is not null as ok \gset
select fair_value_e4 as fm, parts from public.security_sim_state st join public.player_stock_valuation v using (security_id)
 where st.security_id = :'sec' \gset
select tests.assert(
  (:'parts'::jsonb ->> 'yearly_profit_cents')::numeric = 2400000
  and abs(:fm::numeric - round((:'parts'::jsonb ->> 'value_cents')::numeric * 100 / :so * public.listed_price_factor(:'co')::numeric)) <= 1,
  'fair value = value / shares × reputation factor, from 24 hours of profit: ' || :'parts');

-- the company piles up cash: the fair value hardly moves (before: one quarter's profit more at every close)
select public.company_value_cents(:'co') as legacy0 \gset
select public.ledger_transfer(public.ledger_system_account('households'),
         (select a.id from public.ledger_accounts a where a.owner_company_id = :'co' and a.kind = 'company_cash'),
         2000000, 'transfer', 'Test-Gewinn', 'player', :f, 'test:f5:pile') is not null as ok \gset
select public.player_stock_valuation_run(:'t0') is not null as ok \gset
select fair_value_e4 as fp from public.security_sim_state where security_id = :'sec' \gset
select public.company_value_cents(:'co') as legacy1 \gset
select tests.assert(:fp::numeric < :fm::numeric * 1.01 and :legacy1::numeric >= :legacy0::numeric + 2000000,
  '20.000 € piled-up cash: fair value ' || :fm || ' -> ' || :fp || ' (old company value +' || (:legacy1::bigint - :legacy0::bigint) || ')');

-- a capital increase brings money the investors count
update public.companies set shares_outstanding = :so * 12 / 10 where id = :'co';
select anchor_cents as a0 from public.player_stock_valuation where security_id = :'sec' \gset
select public.ledger_transfer(public.ledger_system_account('households'),
         (select a.id from public.ledger_accounts a where a.owner_company_id = :'co' and a.kind = 'company_cash'),
         3000000, 'transfer', 'Test-Kapitalerhöhung', 'player', :f, 'test:f5:issue') is not null as ok \gset
select public.player_stock_valuation_run(:'t0') is not null as ok \gset
select tests.assert((select anchor_cents from public.player_stock_valuation where security_id = :'sec') = :a0::bigint + 3000000,
  'capital increase: the anchor grows by the money raised');
update public.companies set shares_outstanding = :so where id = :'co';
select public.player_stock_valuation_run(:'t0') is not null as ok \gset
select fair_value_e4 as fb from public.security_sim_state where security_id = :'sec' \gset

-- the old formula at a quarter close is ignored
update public.security_sim_state set fair_value_e4 = fair_value_e4 * 3 where security_id = :'sec';
update public.player_companies
   set last_closed_quarter_id = (select gq.id from public.game_quarters gq order by gq.starts_at desc limit 1)
 where company_id = :'co';
update public.player_stock_valuation set quarter_id = -1 where security_id = :'sec';
select public.player_stock_valuation_run(:'t0') is not null as ok \gset
select tests.assert(abs((select fair_value_e4 from public.security_sim_state where security_id = :'sec') - :fb::bigint) <= 1
  and (select shock from public.player_stock_valuation where security_id = :'sec') = 1,
  'the quarter close''s old company value does not stick');

-- a crisis shock (ADR-091) stays and fades with a 3-hour half-life
select public.company_event_share_shock(:'co', -1000) is not null as ok \gset
select public.player_stock_valuation_run(:'t0') is not null as ok \gset
select shock as s1 from public.player_stock_valuation where security_id = :'sec' \gset
select public.player_stock_valuation_run(:'t0'::timestamptz + interval '1 hour') is not null as ok \gset
select shock as s2 from public.player_stock_valuation where security_id = :'sec' \gset
select tests.assert(abs(:s1::numeric - 0.9) < 0.001 and abs(:s2::numeric - exp(ln(:s1::numeric) * power(0.5, 1.0 / 3))) < 1e-6,
  'crisis shock −10 %: kept as shock ' || :s1 || ', after an hour ' || :s2);

-- a bear market lowers the fair value of player stocks
update public.player_stock_valuation set shock = 1 where security_id = :'sec';
select public.player_stock_valuation_run(:'t0') is not null as ok \gset
select fair_value_e4 as fcalm from public.security_sim_state where security_id = :'sec' \gset
update public.market_mood set mood = 28;
select public.player_stock_valuation_run(:'t0') is not null as ok \gset
select fair_value_e4 as fbear, (parts ->> 'mood')::numeric as mbear
  from public.security_sim_state st join public.player_stock_valuation v using (security_id) where st.security_id = :'sec' \gset
select tests.assert(abs(:mbear::numeric - exp(-0.22)::numeric) < 1e-9 and :fbear::numeric < :fcalm::numeric * 0.98,
  'bear market (mood 28): multiple × 0,80, fair value ' || :fcalm || ' -> ' || :fbear);

-- =============================================================================
-- C. Grants, invariants
-- =============================================================================
select tests.assert(not has_function_privilege('authenticated', 'public.player_stock_valuation_run(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.player_stock_valuation_run(timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.player_stock_valuation_run(timestamptz)', 'execute'),
  'grants: the valuation job is internal');
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'money invariant after the valuation runs: ' || tests.money_invariant());
rollback;
