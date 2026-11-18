-- =============================================================================
-- f6 · Büroflächen up to 1.000 seats and stock tiers of player companies (ADR-218)
-- =============================================================================
-- The owner: "Man soll mehr Plätze für Mitarbeiter haben. Bis zu 1000. Aber das kostet zu upgraden. Und man soll auch
-- höher kommen als nur eine Pennystock-Aktie." Rules as in src/lib/sim/offices.ts and src/lib/sim/stock-tier.ts.
\set QUIET 1
set client_min_messages = notice;

\set o '''0f6b6b6b-0000-4000-8000-0000000000a1'''
\set s '''0f6b6b6b-0000-4000-8000-0000000000a2'''
\set b '''0f6b6b6b-0000-4000-8000-0000000000a3'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:o, 'Olga_Office') is not null as ok \gset
select tests.signup(:s, 'Sven_Stufe') is not null as ok \gset
select tests.signup(:b, 'Bea_Tiefe') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:o, 40);
select tests.set_level(:s, 40);
select tests.set_level(:b, 40);
select tests.fund(:o, 900000000, 'test:f6:o');
select tests.fund(:s, 5000000, 'test:f6:s');
select tests.fund(:b, 50000000, 'test:f6:b');

create or replace function tests.f6_buy(p_player uuid, p_request uuid default null) returns text language plpgsql as $$
declare r jsonb;
begin
  perform tests.login_as('authenticated', p_player);
  r := public.buy_company_office(coalesce(p_request, gen_random_uuid()));
  reset role;
  return 'ok:' || (r -> 'offices' ->> 'level');
exception when others then
  reset role;
  return sqlerrm;
end $$;
create or replace function tests.f6_offices(p_player uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.login_as('authenticated', p_player);
  r := public.get_company_offices();
  reset role;
  return r;
end $$;
create or replace function tests.f6_ai(p_player uuid, p_count integer) returns text language plpgsql as $$
begin
  perform tests.login_as('authenticated', p_player);
  perform public.hire_ai_workers(gen_random_uuid(), p_count, null);
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlerrm;
end $$;
grant execute on all functions in schema tests to public;

begin;
-- the live values (earlier test files change some of them)
select tests.set_cfg('trading', '{playerImpact,depthCentsPer100Bps}',
  '{"penny": 100000, "smallcap": 250000, "midcap": 500000, "largecap": 1000000, "bluechip": 2000000}');
select tests.set_cfg('trading', '{maxTickReturnBps}', '1000');
select tests.set_cfg('abuse', '{rateLimits,ordersPerMinute}', '1000');
select public.config_jsonb('startups', '{offices}') as ocfg \gset
select public.player_stock_tier_cfg() as tcfg \gset

-- =============================================================================
-- A. Büroflächen: legal form, company value, price, seats, the cap of 1.000
-- =============================================================================
select tests.login_as('authenticated', :o);
select public.found_company(gen_random_uuid(), 'Grossraum Buero', 'Platz für alle', 'logistics', '#336699', 'gmbh') is not null as ok \gset
reset role;
select tests.company_of(:o) as co \gset
select tests.money_invariant() as inv0 \gset
select (public.company_tier_cfg('gmbh') ->> 'maxEmployees')::integer as gmbh_seats \gset
select tests.assert(public.company_max_employees(:'co') = :gmbh_seats
  and (tests.f6_offices(:o) ->> 'level')::integer = 0
  and (tests.f6_offices(:o) -> 'next' ->> 'cost_cents')::bigint = 25000000,
  'f6: a new GmbH has no offices; the first step costs 250.000 €');

-- step 1 as a GmbH, paid once per request id
select tests.set_company_cash(:'co', 30000000);
select public.ledger_system_account('treasury') as tre \gset
select balance_cents as tre0 from public.ledger_accounts where id = :'tre' \gset
select gen_random_uuid() as rq1 \gset
select tests.f6_buy(:o, :'rq1') as r1 \gset
select tests.f6_buy(:o, :'rq1') as r1b \gset
select tests.assert(:'r1' = 'ok:1' and :'r1b' = 'ok:1'
  and tests.company_cash(:'co') = 30000000 - 25000000
  and (select balance_cents from public.ledger_accounts where id = :'tre') = :tre0::bigint + 25000000
  and (select max_employees from public.companies where id = :'co') = :gmbh_seats + 10
  and public.company_max_employees(:'co') = :gmbh_seats + 10,
  'f6: step 1 costs 250.000 € once (replay safe), to the treasury, +10 seats in the stored copy too: ' || :'r1' || '/' || :'r1b');

-- not enough free cash, then the company value gate of step 2 (2 Mio. €)
select tests.set_company_cash(:'co', 1000);
select tests.f6_buy(:o) as r2 \gset
select tests.assert(:'r2' = 'office_worth', 'f6: step 2 needs a company value of 2 Mio. €: ' || :'r2');
select tests.set_company_cash(:'co', 700000000);
select tests.f6_buy(:o) as r2 \gset
select tests.f6_buy(:o) as r3 \gset
select tests.f6_buy(:o) as r4 \gset
select tests.assert(:'r2' = 'ok:2' and :'r3' = 'ok:3' and :'r4' = 'office_legal_form'
  and (tests.f6_offices(:o) ->> 'block') = 'legal_form',
  'f6: steps 2 and 3 as a GmbH, step 4 needs an AG: ' || :'r2' || ' ' || :'r3' || ' ' || :'r4');

-- the AG: the company value gate of step 4 (15 Mio. €)
update public.player_companies set tier = 'ag' where company_id = :'co';
select tests.set_company_cash(:'co', 400000000);
select tests.f6_buy(:o) as r4 \gset
select tests.assert(:'r4' = 'office_worth', 'f6: step 4 needs 15 Mio. € company value: ' || :'r4');

-- the full headquarters (ADR-208: 410 seats) and money for steps 4..11 at their real prices. The households hold
-- about 3 Mrd. €, so the value gates of the big steps (up to 2,5 Mrd. €, tested above with steps 2 and 4) are lifted
-- here; an unlisted company's value is mostly its cash.
insert into public.company_locations (company_id, country_key, hq_tier) values (:'co', 'de', 5)
on conflict (company_id) do update set hq_tier = 5;
update public.companies set max_employees = max_employees where id = :'co';
select (public.company_tier_cfg('ag') ->> 'maxEmployees')::integer as ag_seats \gset
do $$
begin
  for i in 0 .. 11 loop
    perform tests.set_cfg('startups', array['offices', 'steps', i::text, 'minWorthCents'], '0');
  end loop;
end $$;
select tests.set_company_cash(:'co', 96000000000);
select tests.company_cash(:'co') as cash4 \gset
do $$
declare
  r text;
begin
  for i in 4 .. 11 loop
    r := tests.f6_buy('0f6b6b6b-0000-4000-8000-0000000000a1');
    if r <> 'ok:' || i then
      raise exception 'f6: step % failed: %', i, r;
    end if;
  end loop;
end $$;
select sum((x.s ->> 'costCents')::bigint) as cost4_11 from jsonb_array_elements(:'ocfg'::jsonb -> 'steps') with ordinality x(s, n)
 where x.n between 4 and 11 \gset
select tests.assert(tests.company_cash(:'co') = :cash4::bigint - :cost4_11::bigint
  and public.company_max_employees(:'co') = :ag_seats + 410 + public.company_office_seats(11)
  and public.company_office_seats(11) = 425,
  'f6: steps 4–11 cost ' || :cost4_11 || ' cents; AG 100 + headquarters 410 + offices 425 = '
    || public.company_max_employees(:'co'));

-- the cap: with 10 expansion levels the company already has 1.000 seats, step 12 is refused
update public.player_companies set expansion_level = 10 where company_id = :'co';
select tests.f6_buy(:o) as r12 \gset
select tests.assert(:'r12' = 'office_seats_max' and public.company_max_employees(:'co') = 1000
  and (select max_employees from public.companies where id = :'co') = 1000,
  'f6: all seats together are capped at 1.000, a step beyond is refused: ' || :'r12');
update public.player_companies set expansion_level = 0 where company_id = :'co';

-- step 12 (600 Mio. €); then exactly 1.000 seats. The prices paid so far went to the treasury; they go back to the
-- households first (earlier test files leave the households with only a few hundred million).
select public.ledger_transfer(:'tre', public.ledger_system_account('households'),
         (select balance_cents from public.ledger_accounts where id = :'tre') - :tre0::bigint,
         'transfer', 'Test', 'company', :'co', 'test:f6:refill') is not null as ok \gset
select tests.set_company_cash(:'co', 61000000000);
select tests.f6_buy(:o) as r12 \gset
select tests.f6_buy(:o) as r13 \gset
select tests.assert(:'r12' = 'ok:12' and :'r13' = 'office_max_level'
  and public.company_max_employees(:'co') = 1000
  and (select max_employees from public.companies where id = :'co') = 1000
  and (public.company_growth_path(:'co') ->> 'office_level')::integer = 12
  and (public.company_growth_path(:'co') ->> 'max_employees')::integer = 1000
  and (tests.f6_offices(:o) -> 'seats' ->> 'total')::integer = 1000
  and (tests.f6_offices(:o) ->> 'block') = 'max_level',
  'f6: the last step brings the company to 1.000 seats; there is no 13th: ' || :'r12' || ' ' || :'r13');

-- AI workers fill all 1.000 seats (founder aside), not one more
select tests.f6_ai(:o, 1000) as ai1 \gset
select tests.f6_ai(:o, 1) as ai2 \gset
select tests.assert(:'ai1' = 'ok' and :'ai2' = 'employee_limit'
  and (select ai_workers from public.player_companies where company_id = :'co') = 1000,
  'f6: 1.000 AI workers fit, the 1.001st is refused: ' || :'ai1' || ' ' || :'ai2');

-- rent: every office seat costs 10 € an hour, from the free cash only, never a bill
select public.game_now() as t0 \gset
select tests.company_cash(:'co') as c0 \gset
select public.world_hour_costs(:'co', date_trunc('hour', :'t0'::timestamptz), 'test:f6:hour1') as rent1 \gset
select tests.assert(
  :rent1::bigint >= 500 * public.config_double('startups', '{offices,rentCentsPerSeatPerHour}', 1000)::bigint
  and tests.company_cash(:'co') = :c0::bigint - :rent1::bigint
  and exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'test:f6:hour1:office:rent'),
  'f6: 500 office seats pay ' || :rent1 || ' cents rent in the hour');
select tests.set_company_cash(:'co', 0);
select public.world_hour_costs(:'co', date_trunc('hour', :'t0'::timestamptz), 'test:f6:hour2') as rent2 \gset
select tests.assert(:rent2::bigint = 0 and tests.company_cash(:'co') = 0
  and (select unpaid_cents from public.player_companies where company_id = :'co') = 0,
  'f6: an empty cash pays no rent and owes nothing (no soft lock)');

-- the cost table up to 1.000 seats (docs/BALANCING.md)
select sum((s ->> 'costCents')::bigint) as total_cost, sum((s ->> 'seats')::integer) as total_seats
  from jsonb_array_elements(:'ocfg'::jsonb -> 'steps') s \gset
\echo 'f6 · offices: 12 steps,' :total_seats 'seats,' :total_cost 'cents'

-- =============================================================================
-- B. Stock tiers: formula, hysteresis, the periodic check, news and notification
-- =============================================================================
select tests.assert(
  public.player_stock_tier_next('penny', 4999999999, null, :'tcfg') = 'penny'
  and public.player_stock_tier_next('penny', 5000000000, null, :'tcfg') = 'smallcap'
  and public.player_stock_tier_next('penny', 100000000001, null, :'tcfg') = 'largecap'
  and public.player_stock_tier_next('midcap', 19999999999, 100, :'tcfg') = 'midcap'
  and public.player_stock_tier_next('midcap', 16000000000, 100, :'tcfg') = 'midcap'
  and public.player_stock_tier_next('midcap', 15999999999, 100, :'tcfg') = 'smallcap'
  and public.player_stock_tier_next('bluechip', 0, 100, :'tcfg') = 'largecap'
  and public.player_stock_tier_next('smallcap', 100000000000, 5.9, :'tcfg') = 'smallcap'
  and public.player_stock_tier_next('smallcap', 100000000000, 6, :'tcfg') = 'largecap'
  and public.player_stock_tier_next(null, 0, 0, :'tcfg') = 'penny',
  'f6: player_stock_tier_next as nextStockTier (up to the highest rung, down below 80 %, 6 hours apart)');

select tests.login_as('authenticated', :s);
select public.found_company(gen_random_uuid(), 'Stufen Aufzug', 'Nach oben', 'tech', '#993366', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.company_of(:s) as sc \gset
update public.player_companies set quality = 1 where company_id = :'sc';
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select c.ticker as tkr, c.security_id as sec, c.shares_outstanding as so from public.companies c where c.id = :'sc' \gset
update public.companies set tier = null where id = :'sc';
select tests.assert((select tier::text from public.companies where id = :'sc') = 'penny',
  'f6: a listed player company always has an explicit tier (penny), never NULL (read as midcap before)');

-- market cap 60 Mio. € (shares × last price)
create or replace function tests.f6_cap(p_sec uuid, p_shares bigint, p_cents bigint) returns void language sql as $$
  update public.security_quotes
     set last_price_e4 = p_cents * 100 / p_shares, bid_e4 = p_cents * 100 / p_shares, ask_e4 = p_cents * 100 / p_shares
   where security_id = p_sec;
  update public.security_sim_state set pending_player_flow_e6 = 0, pending_player_volume_e6 = 0 where security_id = p_sec $$;
select tests.f6_cap(:'sec', :so, 6000000000);
select public.player_stock_tiers_run(:'t0') as run1 \gset
select tests.assert((select tier::text from public.companies where id = :'sc') = 'smallcap'
  and (:'run1'::jsonb ->> 'changed')::integer >= 1
  and exists (select 1 from public.news_items n where n.company_id = :'sc' and n.headline = 'Stufen Aufzug steigt in den Small Cap auf')
  and exists (select 1 from public.notifications n where n.player_id = :s and n.type_key = 'stock_tier'
                and (n.payload ->> 'tier') = 'smallcap' and (n.payload ->> 'up')::boolean),
  'f6: 60 Mio. € market cap: penny → small cap, stock news for Mr. Doodle and a note to the founder: ' || :'run1');

-- 300 Mio. € within 6 hours: no change yet; after 7 hours mid cap
select tests.f6_cap(:'sec', :so, 30000000000);
select public.player_stock_tiers_run(:'t0'::timestamptz + interval '2 hours') is not null as ok \gset
select tier::text as t2 from public.companies where id = :'sc' \gset
select public.player_stock_tiers_run(:'t0'::timestamptz + interval '7 hours') is not null as ok \gset
select tier::text as t7 from public.companies where id = :'sc' \gset
select tests.assert(:'t2' = 'smallcap' and :'t7' = 'midcap',
  'f6: at least 6 hours between two changes: ' || :'t2' || ' → ' || :'t7');

-- hysteresis: 190 Mio. € (below 200, above 160) keeps the mid cap, 150 Mio. € falls back
select tests.f6_cap(:'sec', :so, 19000000000);
select public.player_stock_tiers_run(:'t0'::timestamptz + interval '14 hours') is not null as ok \gset
select tier::text as t14 from public.companies where id = :'sc' \gset
select tests.f6_cap(:'sec', :so, 15000000000);
select public.player_stock_tiers_run(:'t0'::timestamptz + interval '15 hours') is not null as ok \gset
select tier::text as t15 from public.companies where id = :'sc' \gset
select tests.assert(:'t14' = 'midcap' and :'t15' = 'smallcap'
  and exists (select 1 from public.news_items n where n.company_id = :'sc' and n.headline = 'Stufen Aufzug fällt zurück in den Small Cap')
  and (select peak_tier from public.player_stock_tiers where company_id = :'sc') = 'midcap',
  'f6: no flapping at the threshold (190 Mio. € stays mid cap), below 160 Mio. € back to small cap: ' || :'t14' || ' → ' || :'t15');

-- =============================================================================
-- C. Impact depth follows the tier: the same 2.000 € buy moves a bigger stock less
-- =============================================================================
create or replace function tests.f6_impact(p_player uuid, p_sc uuid, p_sec uuid, p_ticker text, p_tier text) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  execute format('update public.companies set tier = %L where id = %L', p_tier, p_sc);
  update public.security_quotes set last_price_e4 = 100000, bid_e4 = 100000, ask_e4 = 100000 where security_id = p_sec;
  update public.security_sim_state set pending_player_flow_e6 = 0, pending_player_volume_e6 = 0 where security_id = p_sec;
  perform tests.login_as('authenticated', p_player);
  r := public.quote_order(p_ticker, 'buy', null, 200000);
  reset role;
  return r;
end $$;
grant execute on function tests.f6_impact(uuid, uuid, uuid, text, text) to public;
select (tests.f6_impact(:b, :'sc', :'sec', :'tkr', 'penny') ->> 'impact_bps')::integer as i_penny,
       (tests.f6_impact(:b, :'sc', :'sec', :'tkr', 'smallcap') ->> 'impact_bps')::integer as i_small,
       (tests.f6_impact(:b, :'sc', :'sec', :'tkr', 'midcap') ->> 'impact_bps')::integer as i_mid,
       (tests.f6_impact(:b, :'sc', :'sec', :'tkr', 'largecap') ->> 'impact_bps')::integer as i_large,
       (tests.f6_impact(:b, :'sc', :'sec', :'tkr', 'bluechip') ->> 'impact_bps')::integer as i_blue \gset
select tests.assert(:i_penny::integer > :i_small::integer and :i_small::integer > :i_mid::integer
  and :i_mid::integer > :i_large::integer and :i_large::integer >= :i_blue::integer and :i_penny::integer > 0,
  'f6: impact of a 2.000 € buy by tier: penny ' || :i_penny || ' bps, small ' || :i_small || ', mid ' || :i_mid
    || ', large ' || :i_large || ', blue ' || :i_blue);

-- =============================================================================
-- D. Grants, invariants
-- =============================================================================
select tests.assert(has_function_privilege('authenticated', 'public.buy_company_office(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.get_company_offices()', 'execute')
  and not has_function_privilege('authenticated', 'public.player_stock_tiers_run(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.buy_company_office(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.world_hour_costs(uuid, timestamptz, text)', 'execute'),
  'f6: grants (buying and reading offices for players, the tier job and the rent internal)');
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'f6: money invariant after offices, rent and tier changes: ' || tests.money_invariant());
rollback;
\echo 'f6 · seats and tiers: ok'
