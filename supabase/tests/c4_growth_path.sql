-- =============================================================================
-- c4 · Wachstum & Ausbau as one path (ADR-188): a change of the legal form (upgrade_company, the IPO) keeps the bought
--      expansion places and level, the next cost follows the level, the stored places always match the rule, and
--      company_growth_path returns stage, level and step as one path.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set g '''0c4c4c4c-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:g, 'Wachstum_Test') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:g, 40);
select tests.fund(:g, 900000000, 'test:c4:g');
select tests.login_as('authenticated', :g);
select public.found_company(gen_random_uuid(), 'Weg Nach Oben', 'Ein Weg ohne Ende', 'retail', '#336699', 'small_business') is not null as ok \gset
reset role;
select tests.company_of(:g) as co \gset
select coalesce(public.config_double('startups', '{expansion,employeesPerLevel}', 10), 10)::integer as per_level \gset

-- 1. Levels bought earlier (the small business could not expand itself; older data or config) survive the GmbH step.
update public.player_companies set expansion_level = 2 where company_id = :'co';
select tests.assert(
  (select max_employees from public.companies where id = :'co') = public.company_max_employees(:'co'),
  'c4: a new expansion level updates the stored places at once (trigger)');
select tests.login_as('authenticated', :g);
select public.upgrade_company(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.assert((select tier from public.player_companies where company_id = :'co') = 'gmbh', 'c4: the company is a GmbH now');
select tests.assert((select expansion_level from public.player_companies where company_id = :'co') = 2,
  'c4: the legal form step keeps the expansion level');
select tests.assert(
  (select max_employees from public.companies where id = :'co')
    = (public.company_tier_cfg('gmbh') ->> 'maxEmployees')::integer + 2 * :per_level,
  'c4: the legal form step keeps the bought places (before: reset to the bare tier value)');

-- 2. The next expansion continues at level 3 with the price of level 3, paid once.
select tests.set_company_cash(:'co', public.company_expansion_cost_cents(2) + 100);
select public.company_expansion_cost_cents(2) as cost2 \gset
select tests.login_as('authenticated', :g);
select public.expand_company(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.assert((select expansion_level from public.player_companies where company_id = :'co') = 3,
  'c4: expanding after the stage change continues the path (level 3, no reset)');
select tests.assert(
  (select max_employees from public.companies where id = :'co')
    = (public.company_tier_cfg('gmbh') ->> 'maxEmployees')::integer + 3 * :per_level,
  'c4: places count every level once');
select tests.assert(
  (public.company_growth_path(:'co') ->> 'next_cost_cents')::bigint = public.company_expansion_cost_cents(3)
    and public.company_expansion_cost_cents(3) > :cost2,
  'c4: the next cost follows the level');

-- 3. The IPO writes the bare AG value into the row; the guard keeps the expansion places.
update public.companies set legal_form = 'ag', max_employees = (public.company_tier_cfg('ag') ->> 'maxEmployees')::integer
 where id = :'co';
update public.player_companies set tier = 'ag' where company_id = :'co';
select tests.assert(
  (select max_employees from public.companies where id = :'co')
    = (public.company_tier_cfg('ag') ->> 'maxEmployees')::integer + 3 * :per_level
    and (select expansion_level from public.player_companies where company_id = :'co') = 3,
  'c4: going public keeps level and places');
select tests.assert(
  tests.near(public.company_market_factor('ag', 3),
             public.config_double('startups', array['marketFactorByTier', 'ag'], 40)
             * (1 + public.config_double('startups', '{expansion,marketBonusPerLevel}', 0.5) * 3)),
  'c4: the market reach is legal form × level, each counted once');

-- 4. One path: step = stage + level, next is the next stage while one is open, then the next level.
select public.company_growth_path(:'co') as path \gset
select tests.assert(
  (:'path'::jsonb ->> 'expansion_level')::integer = 3
    and (:'path'::jsonb ->> 'step')::integer = (:'path'::jsonb ->> 'stage')::integer + 3
    and (:'path'::jsonb ->> 'max_employees')::integer = public.company_max_employees(:'co')
    and (:'path'::jsonb -> 'next' ->> 'kind') = case when (:'path'::jsonb ->> 'stage')::integer < (:'path'::jsonb ->> 'stages')::integer
                                                     then 'stage' else 'level' end,
  'c4: company_growth_path returns the whole path');

\echo 'c4 · growth path: ok'
