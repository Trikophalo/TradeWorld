-- =============================================================================
-- 93 · Every company can be opened (ADR-125)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''09309309-0000-4000-8000-0000000000a1'''
\set b '''09309309-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Fritz_Firma') is not null and tests.signup(:b, 'Berta_Besuch') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.fund(:a, 20000000, 'test:profile:a');
update public.sim_runtime set is_paused = false;
select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Fritz Fahrradwerk', 'Fahrräder reparieren', 'logistics', '#aa5500', 'garage')
  -> 'company' ->> 'id' as cid \gset
reset role;
select c.id as ai from public.companies c where c.is_ai and c.ticker = 'KLS' \gset

select tests.login_as('authenticated', :b);
select public.get_company_profile(:'cid') as pp, public.get_company_profile(:'ai') as ap,
       public.get_company_org(:'cid') as org \gset
select tests.throws_key($$select public.get_company_profile('00000000-0000-4000-8000-000000000000')$$, 'company_not_found',
  'get_company_profile(): unknown company');
reset role;
select tests.assert(
  :'pp'::jsonb -> 'company' ->> 'name' = 'Fritz Fahrradwerk' and not (:'pp'::jsonb -> 'company' ->> 'is_ai')::boolean
  and :'pp'::jsonb -> 'founder' ->> 'nickname' = 'Fritz_Firma'
  and (:'pp'::jsonb -> 'facts' ->> 'staff')::int >= 1 and :'pp'::jsonb -> 'facts' ? 'value_cents'
  and :'pp'::jsonb -> 'members' = '[]'::jsonb
  and :'ap'::jsonb -> 'company' ->> 'ticker' = 'KLS' and (:'ap'::jsonb -> 'company' ->> 'listed')::boolean
  and :'ap'::jsonb -> 'facts' ->> 'period' = 'ttm' and (:'ap'::jsonb -> 'company' ->> 'price_e4')::bigint > 0
  and :'org'::jsonb -> 'founder' ->> 'nickname' = 'Fritz_Firma',
  'get_company_profile(): an outsider sees a player company (founder, staff, value) and an AI company (stock, last four quarters); the org chart is open');
select tests.assert(not (:'pp'::jsonb::text ~ '(cash|debt|unpaid)'),
  'the profile shows no cash, debts or unpaid bills');
