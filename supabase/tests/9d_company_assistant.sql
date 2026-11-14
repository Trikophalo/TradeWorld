-- =============================================================================
-- 9d · Mira, the company assistant (ADR-138): context for Claude and the hourly limit
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''09d09d09-0000-4000-8000-0000000000a1'''
\set n '''09d09d09-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Mira_Anna') is not null and tests.signup(:n, 'Mira_Niemand') is not null as ok \gset
select tests.set_level(:a, 12);
select tests.fund(:a, 20000000, 'test:mira:a');

-- Without a company there is nothing to talk about.
select tests.login_as('authenticated', :n);
select tests.throws_key('select public.company_assistant_context(''Hallo'')', 'company_not_found',
  'company_assistant_context(): only with a company');
reset role;

select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Miras Laden', 'Bunte Socken im Abo', 'retail', '#3355aa', 'garage') is not null as ok \gset
select tests.throws_key('select public.company_assistant_context(''   '')', 'invalid_argument',
  'company_assistant_context(): no empty message');
select public.company_assistant_context('Was steht an?') as ctx \gset
reset role;
select tests.assert(
  :'ctx'::jsonb ->> 'role' = 'founder'
  and :'ctx'::jsonb -> 'company' ->> 'name' = 'Miras Laden'
  and :'ctx'::jsonb -> 'tasks' ? 'people'
  and :'ctx'::jsonb -> 'moves' ? 'slots'
  and :'ctx'::jsonb ->> 'text' = 'Was steht an?',
  'company_assistant_context(): company, team, tasks and moves for Claude');

-- The hourly limit: after claudePerHour calls Mira only reads commands (NX126).
select tests.set_cfg('companyAssistant', '{claudePerHour}', '2');
select tests.login_as('authenticated', :a);
select public.company_assistant_context('Noch eine Frage') is not null as ok \gset
select tests.throws_key('select public.company_assistant_context(''Und noch eine'')', 'assistant_busy',
  'company_assistant_context(): the hourly limit holds (NX126)');
reset role;
select tests.assert((select count(*) from public.company_assistant_calls where player_id = :a) = 2,
  'company_assistant_calls: a refused call is not counted');
select tests.assert(not has_table_privilege('authenticated', 'public.company_assistant_calls', 'select'),
  'company_assistant_calls: no direct client access');
select tests.set_cfg('companyAssistant', '{claudePerHour}', '20');
