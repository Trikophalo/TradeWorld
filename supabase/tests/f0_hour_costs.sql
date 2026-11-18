-- =============================================================================
-- f0 · Fixed and variable costs of the last closed hour (ADR-208, Nachtrag)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
select tests.money_invariant() = 'ok' as inv0 \gset

\set a '''0f0f0f0f-0000-4000-8000-0000000000a1'''
\set b '''0f0f0f0f-0000-4000-8000-0000000000b1'''
select tests.signup(:a, 'Kosten_Karla') is not null and tests.signup(:b, 'Ohne_Olli') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(x, 6) from unnest(array[:a, :b]::uuid[]) x;
select tests.fund(x, 1000000, 'test:f0:' || x::text) from unnest(array[:a, :b]::uuid[]) x;

select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Kostenwerk Karla', 'Wir zählen jeden Cent', 'tech', '#335577', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:a) as co \gset
select public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(:'co'), 50000000,
                              'transfer', 'Test-Kapital', 'company', :'co', 'test:f0:cash') is not null as ok \gset
update public.player_companies set marketing_cents_per_quarter = 600000 where company_id = :'co';

-- before the first hour: zero, no parts
select tests.login_as('authenticated', :a);
select public.get_company_hour_costs() as c0 \gset
reset role;
select tests.assert(
  :'c0'::jsonb ->> 'hour_start' is null and (:'c0'::jsonb ->> 'fixed_cents')::bigint = 0
  and jsonb_array_length(:'c0'::jsonb -> 'fixed') = 0,
  'f0: before the first closed hour the costs are zero');

select public.player_company_close_hour(:'co', date_trunc('hour', now()) - interval '1 hour') is not null as ok \gset
select tests.login_as('authenticated', :a);
select public.get_company_hour_costs() as c1 \gset
reset role;
select * from public.player_company_hours where company_id = :'co' order by hour_start desc limit 1 \gset h_

select tests.assert(
  (:'c1'::jsonb ->> 'hour_start')::timestamptz = :'h_hour_start'::timestamptz
  and (:'c1'::jsonb ->> 'company_id') = :'co'
  and (select array_agg(x ->> 'key') from jsonb_array_elements(:'c1'::jsonb -> 'fixed') x)
      = array['wages_players', 'wages_ai', 'talents', 'rent', 'marketing', 'upkeep', 'advisor', 'subsidiaries',
              'insurance', 'overhead']
  and (select array_agg(x ->> 'key') from jsonb_array_elements(:'c1'::jsonb -> 'variable') x)
      = array['goods', 'profit_share', 'location_fee', 'supply_fees'],
  'f0: the last closed hour with every fixed and variable part');

select tests.assert(
  (:'c1'::jsonb ->> 'fixed_cents')::bigint
    = (select sum((x ->> 'cents')::bigint) from jsonb_array_elements(:'c1'::jsonb -> 'fixed') x)
  and (:'c1'::jsonb ->> 'variable_cents')::bigint
    = (select sum((x ->> 'cents')::bigint) from jsonb_array_elements(:'c1'::jsonb -> 'variable') x)
  and not exists (select 1 from jsonb_array_elements((:'c1'::jsonb -> 'fixed') || (:'c1'::jsonb -> 'variable')) x
                   where (x ->> 'cents')::bigint < 0),
  'f0: the totals are the sums of their parts, no part is negative');

-- the parts match the hour: wages, marketing, fixed costs and goods add up to what the hour recorded
select tests.assert(
  (select (x ->> 'cents')::bigint from jsonb_array_elements(:'c1'::jsonb -> 'fixed') x where x ->> 'key' = 'marketing')
    = :h_marketing_cents::bigint
  and :h_marketing_cents::bigint > 0
  and (select sum((x ->> 'cents')::bigint) from jsonb_array_elements(:'c1'::jsonb -> 'fixed') x
        where x ->> 'key' in ('rent', 'upkeep', 'advisor', 'subsidiaries')) = :h_fixed_cents::bigint
  and (select sum((x ->> 'cents')::bigint) from jsonb_array_elements((:'c1'::jsonb -> 'fixed') || (:'c1'::jsonb -> 'variable')) x
        where x ->> 'key' in ('goods', 'insurance', 'overhead')) = :h_cogs_cents::bigint
  and (select (x ->> 'cents')::bigint from jsonb_array_elements(:'c1'::jsonb -> 'fixed') x where x ->> 'key' = 'wages_ai')
    = :h_ai_wages_paid_cents::bigint,
  'f0: marketing, fixed costs, goods and AI wages match the recorded hour');

-- only the founder; others without a company get company_not_found
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.get_company_hour_costs()$$, 'company_not_found',
                       'f0: without an own company get_company_hour_costs() fails');
reset role;

select tests.assert(tests.money_invariant() = 'ok', 'f0: money invariant holds');
