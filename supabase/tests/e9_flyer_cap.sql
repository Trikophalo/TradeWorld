-- =============================================================================
-- e9 · Flyer price cap for small companies (ADR-212)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
select tests.money_invariant() = 'ok' as inv0 \gset

\set a '''0e9e9e9e-0000-4000-8000-0000000000a1'''
\set b '''0e9e9e9e-0000-4000-8000-0000000000b1'''
\set c '''0e9e9e9e-0000-4000-8000-0000000000c1'''
\set d '''0e9e9e9e-0000-4000-8000-0000000000d1'''
\set rq1 '''0e9e9e9e-0000-4000-8000-000000000101'''
\set rq2 '''0e9e9e9e-0000-4000-8000-000000000102'''
select tests.signup(:a, 'Garagen_Gero') is not null and tests.signup(:b, 'Mittel_Mia') is not null
   and tests.signup(:c, 'Klein_Kurt') is not null and tests.signup(:d, 'Normal_Nora') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(x, 6) from unnest(array[:a, :b, :c, :d]::uuid[]) x;
select tests.fund(x, 1000000, 'test:e9:' || x::text) from unnest(array[:a, :b, :c, :d]::uuid[]) x;

-- a fresh garage with exactly p_cash on the company account and a market of p_potential a year
create or replace function tests.e9_found(p_player uuid, p_name text, p_cash bigint, p_potential bigint)
returns uuid language plpgsql as $$
declare
  v_co uuid;
  v    bigint;
begin
  perform tests.login_as('authenticated', p_player);
  perform public.found_company(gen_random_uuid(), p_name, 'Alles für alle', 'tech', '#335577', 'garage');
  reset role;
  v_co := tests.company_of(p_player);
  v := tests.company_cash(v_co) - p_cash;
  if v > 0 then
    perform public.ledger_transfer(public.company_cash_account(v_co), public.ledger_system_account('households'), v,
                                   'transfer', 'Test-Leerung', 'company', v_co, 'test:e9:cash:' || v_co::text);
  elsif v < 0 then
    perform public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(v_co), -v,
                                   'transfer', 'Test-Kapital', 'company', v_co, 'test:e9:cash:' || v_co::text);
  end if;
  update public.player_companies set potential_annual_cents = p_potential, unpaid_cents = 0 where company_id = v_co;
  return v_co;
end;
$$;
-- the normal price of a campaign kind (no cap, no ad_agency): costHours x the demand of the last hour
create or replace function tests.e9_normal(p_company uuid, p_kind text) returns bigint language sql as $$
  select public.campaign_cost_cents(p_kind, public.company_campaign_base_cents(p_company)) $$;
grant execute on all functions in schema tests to public;

-- a: garage with a huge market and only the starting cash; b: big small business; c: poor small business;
-- d: garage with a small market (price below the cap)
select tests.e9_found(:a, 'Riesenmarkt Gero', 250000, 1000000000000) as aco \gset
select tests.e9_found(:b, 'Mittelstand Mia', 200000000, 1000000000000) as bco \gset
select tests.e9_found(:c, 'Kleinbetrieb Kurt', 250000, 1000000000000) as cco \gset
select tests.e9_found(:d, 'Nische Nora', 250000, 100000) as dco \gset
update public.player_companies set tier = 'small_business' where company_id in (:'bco', :'cco');

-- =============================================================================
-- A. Prices
-- =============================================================================
select tests.assert(
  public.campaign_cap_cents(:'aco', 'flyer') = 200000
  and public.campaign_cap_cents(:'aco', 'online') is null and public.campaign_cap_cents(:'aco', 'tv') is null
  and public.campaign_cap_cents(:'bco', 'flyer') is null
  and public.campaign_cap_cents(:'cco', 'flyer') = 200000
  and public.campaign_cap_cents(:'dco', 'flyer') = 200000
  and public.company_value_cents(:'bco') >= 100000000 and public.company_value_cents(:'cco') < 100000000,
  'e9: campaign_cap_cents(): the flyer of a garage or of a company below 1 Mio. EUR, nothing else');

select tests.assert(
  tests.e9_normal(:'aco', 'flyer') > 250000
  and public.company_campaign_cost_cents(:'aco', 'flyer') = 200000
  and public.company_campaign_cost_cents(:'aco', 'online') = tests.e9_normal(:'aco', 'online')
  and public.company_campaign_cost_cents(:'aco', 'tv') = tests.e9_normal(:'aco', 'tv')
  and public.company_campaign_cost_cents(:'cco', 'flyer') = 200000,
  'e9: a garage with a huge market pays 2 000 EUR for the flyer; online and TV keep the normal price');

select tests.assert(
  tests.e9_normal(:'bco', 'flyer') > 200000
  and public.company_campaign_cost_cents(:'bco', 'flyer') = tests.e9_normal(:'bco', 'flyer')
  and public.company_campaign_costs(:'bco') = jsonb_build_object(
        'flyer', tests.e9_normal(:'bco', 'flyer'), 'online', tests.e9_normal(:'bco', 'online'),
        'tv', tests.e9_normal(:'bco', 'tv')),
  'e9: above the threshold the flyer keeps the normal price');

select tests.assert(
  tests.e9_normal(:'dco', 'flyer') < 200000
  and public.company_campaign_cost_cents(:'dco', 'flyer') = tests.e9_normal(:'dco', 'flyer'),
  'e9: the cap never raises a cheaper flyer');

-- the founder's ad_agency still discounts the capped price
insert into public.player_upgrades (player_id, key, level) values (:c, 'ad_agency', 1)
  on conflict (player_id, key) do update set level = 1;
select tests.assert(
  public.company_campaign_cost_cents(:'cco', 'flyer') < 200000
  and public.company_campaign_cost_cents(:'cco', 'flyer')
      = (round((200000 - public.apply_bps(200000, public.company_upgrade_bps(:'cco', 'ad_agency')))::numeric / 100) * 100)::bigint,
  'e9: ad_agency discounts the capped flyer');

-- =============================================================================
-- B. The campaign card and start_campaign charge the same capped price
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.get_my_company() -> 'company' -> 'campaign_costs' as acosts \gset
reset role;
select tests.assert(
  (:'acosts'::jsonb ->> 'flyer')::bigint = 200000
  and (:'acosts'::jsonb ->> 'online')::bigint = tests.e9_normal(:'aco', 'online'),
  'e9: get_my_company() shows the capped flyer price');

select tests.company_cash(:'aco') as ac0 \gset
select balance_cents as hh0 from public.ledger_accounts where system_key = 'households' \gset
select tests.login_as('authenticated', :a);
select public.start_campaign(:rq1, :'aco', 'flyer') as camp \gset
reset role;
select tests.assert(
  (:'camp'::jsonb ->> 'cost_cents')::bigint = 200000
  and tests.company_cash(:'aco') = :ac0::bigint - 200000
  and (select balance_cents from public.ledger_accounts where system_key = 'households') = :hh0::bigint + 200000
  and (select sum(e.amount_cents) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.idempotency_key = 'campaign:' || :'aco' || ':' || :rq1) = 0,
  'e9: a garage with a huge market and 2 500 EUR starts the flyer for 2 000 EUR, one balanced booking');

-- the poor small business cannot afford online (normal price) but can afford the flyer
select tests.login_as('authenticated', :c);
select tests.throws_key(format($$select public.start_campaign(gen_random_uuid(), %L, 'online')$$, :'cco'),
  'insufficient_funds', 'e9: online keeps the normal price');
select public.start_campaign(:rq2, :'cco', 'flyer') ->> 'cost_cents' as ccost \gset
reset role;
select tests.assert(:ccost::bigint < 200000, 'e9: the small business starts the capped flyer');

-- =============================================================================
-- C. Four players, money
-- =============================================================================
select tests.assert(:'inv0'::boolean and tests.money_invariant() = 'ok' and not exists (select 1 from public.ledger_audit()),
  'e9: the money invariant holds');
