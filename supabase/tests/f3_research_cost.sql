-- =============================================================================
-- f3 · Research priced from the earnings, not from the company value (ADR-215)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
select tests.money_invariant() = 'ok' as inv0 \gset

\set f '''0f3e5e5e-0000-4000-8000-0000000000f1'''
\set a '''0f3e5e5e-0000-4000-8000-0000000000a1'''
\set rq1 '''0f3e5e5e-0000-4000-8000-000000000101'''
\set rq2 '''0f3e5e5e-0000-4000-8000-000000000102'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:f, 'Forscher_Frida') is not null and tests.signup(:a, 'Aktien_Arne') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 12);
select tests.set_level(:a, 12);
select tests.fund(:f, 5000000, 'test:f3:f');
select tests.fund(:a, 900000000, 'test:f3:a');

-- a listed company: Arne subscribes 25 %
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Forschungswerk', 'Wir forschen', 'tech', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.company_of(:f) as co \gset
select price_cents as iprice from public.company_share_offers where id = :'offer' \gset
select tests.login_as('authenticated', :a);
select public.subscribe_offer(gen_random_uuid(), :'offer', 250000 * :iprice) is not null as ok \gset
reset role;
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select tests.assert(public.listed_is(:'co'), 'f3: the company is listed');

-- 48 closed hours with 1 000 EUR profit on 10 000 EUR revenue, older hours with a big loss (outside the window)
create or replace function tests.f3_hours(p_company uuid, p_revenue bigint, p_profit bigint) returns void language plpgsql as $$
begin
  delete from public.player_company_hours where company_id = p_company;
  insert into public.player_company_hours (company_id, hour_start, demand_cents, capacity_cents, revenue_cents, cogs_cents,
                                           fixed_cents, marketing_cents, pay_factor_bps, profit_cents)
  select p_company, date_trunc('hour', now()) - make_interval(hours => g), p_revenue, p_revenue, p_revenue, 0, 0, 0, 10000,
         case when g <= 48 then p_profit else -100000000 end
    from generate_series(1, 60) g;
end;
$$;
grant execute on all functions in schema tests to public;
select tests.f3_hours(:'co', 1000000, 100000);
select tests.login_as('authenticated', :f);
select public.get_listed_company() -> 'listed' as l1 \gset
reset role;
select tests.assert(
  public.listed_avg_profit(:'co') = 100000 and public.listed_ref_profit(:'co') = 100000
  and (:'l1'::jsonb ->> 'ref_profit_cents')::bigint = 100000 and (:'l1'::jsonb ->> 'avg_profit_cents')::bigint = 100000
  and (:'l1'::jsonb ->> 'research_started')::int = 0
  and (select (i ->> 'cost_cents')::bigint from jsonb_array_elements(:'l1'::jsonb -> 'items') i where i ->> 'key' = 'r_quality_1') = 300000
  and (select (i ->> 'cost_cents')::bigint from jsonb_array_elements(:'l1'::jsonb -> 'items') i where i ->> 'key' = 'r_quality_4') = 2800000
  and (select (i ->> 'slow_cost_cents')::bigint from jsonb_array_elements(:'l1'::jsonb -> 'items') i where i ->> 'key' = 'r_quality_4') = 1400000
  and (select (i ->> 'slow_hours')::float8 from jsonb_array_elements(:'l1'::jsonb -> 'items') i where i ->> 'key' = 'r_quality_4') = 72
  and (select i ->> 'slow_cost_cents' from jsonb_array_elements(:'l1'::jsonb -> 'items') i where i ->> 'key' = 'p_second') is null,
  'f3: research costs 3 / 28 hours of the average profit of the last 48 hours; Sparforschung half the price, 3 x the time');

-- the price does not follow the market cap, the company value or the revenue
select public.company_worth_cents(:'co') as worth1 \gset
update public.security_quotes q set last_price_e4 = q.last_price_e4 * 50
  from public.companies c where c.id = :'co' and q.security_id = c.security_id;
select tests.f3_hours(:'co', 50000000, 100000);
select tests.login_as('authenticated', :f);
select public.get_listed_company() -> 'listed' as l2 \gset
reset role;
select tests.assert(
  public.company_worth_cents(:'co') >= 50 * :worth1::bigint - 50
  and (:'l2'::jsonb ->> 'ref_revenue_cents')::bigint = 50000000
  and (select jsonb_agg(i -> 'cost_cents' order by i ->> 'key') from jsonb_array_elements(:'l2'::jsonb -> 'items') i where i ->> 'kind' = 'research')
      = (select jsonb_agg(i -> 'cost_cents' order by i ->> 'key') from jsonb_array_elements(:'l1'::jsonb -> 'items') i where i ->> 'kind' = 'research'),
  'f3: 50 x the market cap and 50 x the revenue leave every research price unchanged');

-- affordable: no research step costs more than two days of the average profit, at any size
select tests.f3_hours(:'co', 100000000, 8587000);
select tests.login_as('authenticated', :f);
select public.get_listed_company() -> 'listed' as l3 \gset
reset role;
select tests.assert(
  (select bool_and((i ->> 'cost_cents')::bigint <= 48 * 8587000) from jsonb_array_elements(:'l3'::jsonb -> 'items') i
    where i ->> 'kind' = 'research')
  and public.listed_research_cost(public.listed_item('r_finance_4'), 8587000, 27) <= 48 * 8587000
  and public.listed_research_cost(public.listed_item('r_finance_4'), 20000, 27) <= 48 * 20000,
  'f3: every research step is affordable within two days of profit (1 Mrd. EUR company: 85 870 EUR/h)');

-- buying: from the company cash to the households, the level growth counts the started steps
select tests.f3_hours(:'co', 1000000, 100000);
select public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(:'co'), 5000000,
  'transfer', 'Test-Kapital', 'company', :'co', 'test:f3:cash') is not null as ok \gset
select tests.company_cash(:'co') as cc0 \gset
select tests.households() as hh0 \gset
select tests.login_as('authenticated', :f);
select public.company_invest(:rq1, 'r_quality_1') -> 'listed' as i1 \gset
select public.company_invest(:rq1, 'r_quality_1') -> 'listed' as i1b \gset
select tests.throws_key($$select public.company_invest(gen_random_uuid(), 'p_second', true)$$, 'invalid_argument',
  'f3: Sparforschung only for research');
select public.company_invest(:rq2, 'r_brand_1', true) -> 'listed' as i2 \gset
reset role;
select tests.assert(
  :'i1'::jsonb = :'i1b'::jsonb
  and tests.company_cash(:'co') = :cc0::bigint - 300000 - 307500 / 2
  and tests.households() = :hh0::bigint + 300000 - 0 + 307500 / 2
  and (:'i2'::jsonb ->> 'research_started')::int = 2
  and (select metadata ->> 'slow' from public.ledger_transactions where idempotency_key = 'invest:' || :rq2) = 'true'
  and (select sum(e.amount_cents) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.idempotency_key in ('invest:' || :rq1, 'invest:' || :rq2)) = 0
  and (select ready_at between now() + interval '179 minutes' and now() + interval '181 minutes'
         from public.company_investments where company_id = :'co' and key = 'r_brand_1')
  and (select ready_at between now() + interval '59 minutes' and now() + interval '61 minutes'
         from public.company_investments where company_id = :'co' and key = 'r_quality_1')
  -- the third step: 3 h x 1.05 x 1 000 EUR
  and (select (i ->> 'cost_cents')::bigint from jsonb_array_elements(:'i2'::jsonb -> 'items') i where i ->> 'key' = 'r_efficiency_1') = 315000,
  'f3: company_invest pays the research price once (idempotent), Sparforschung half of it for 3 x the time; every started step makes the next 2.5 % dearer');

-- the new helpers are internal
select tests.assert(
  not has_function_privilege('authenticated', 'public.listed_research_cost(jsonb, bigint, integer, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.listed_ref_profit(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.company_invest(uuid, text, boolean)', 'execute')
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'company_invest' and p.pronargs = 2),
  'f3: helpers are internal; company_invest has one signature');

select tests.assert(:'inv0'::boolean and tests.money_invariant() = 'ok' and not exists (select 1 from public.ledger_audit()),
  'f3: the money invariant holds');
