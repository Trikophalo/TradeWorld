-- =============================================================================
-- 65 · M3f: logos and reports, quit at once, founders with a job, GmbH,
--      IPO with subscription, capital increase
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''0f3f3f3f-0000-4000-8000-0000000000f1'''
\set r1 '''0f3f3f3f-0000-4000-8000-0000000000a1'''
\set r2 '''0f3f3f3f-0000-4000-8000-0000000000a2'''
\set r3 '''0f3f3f3f-0000-4000-8000-0000000000a3'''
select tests.signup(:f, 'Fenja_Firma') is not null and tests.signup(:r1, 'Rolf_Eins') is not null
   and tests.signup(:r2, 'Rita_Zwei') is not null and tests.signup(:r3, 'Rudi_Drei') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 15);
select tests.set_level(:r1, 6);
select tests.set_level(:r2, 6);
select tests.set_level(:r3, 6);
select tests.fund(:f, 20000000, 'test:m3f:f');
select tests.fund(:r1, 5000000, 'test:m3f:r1');
select tests.fund(:r2, 5000000, 'test:m3f:r2');
select tests.fund(:r3, 5000000, 'test:m3f:r3');
\set logo '''{"palette": ["#112233", "#ffcc00"], "grid": ["................", "................", "....00000000....", "....01111110....", "....01111110....", "....00000000....", "................", "................", "................", "................", "................", "................", "................", "................", "................", "................"]}'''

-- =============================================================================
-- A. Logos (ADR-065)
-- =============================================================================
select tests.assert(
  public.logo_valid(:logo::jsonb)
  and not public.logo_valid(jsonb_set(:logo::jsonb, '{palette,0}', '"#AABBCC"'))
  and not public.logo_valid(jsonb_set(:logo::jsonb, '{palette}', '["#000000","#000001","#000002","#000003","#000004","#000005","#000006"]'))
  and not public.logo_valid(jsonb_set(:logo::jsonb, '{grid,0}', '"..............."'))
  and not public.logo_valid(jsonb_set(:logo::jsonb, '{grid,0}', '"2..............."'))
  and not public.logo_valid(jsonb_set(:logo::jsonb, '{grid}', (select jsonb_agg(case when n = 3 then '....0000000.....' else '................' end) from generate_series(1, 16) n)))
  and not public.logo_valid('{"palette": ["#112233"]}'),
  'logo_valid(): like isValidLogo (lowercase hex, at most 6 colours, 16 x 16, indices of the palette, at least 8 pixels)');

-- =============================================================================
-- C. Founders with a job (ADR-066)
-- =============================================================================
select tests.login_as('authenticated', :f);
select x ->> 'id' as fpost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean order by x ->> 'id' limit 1 \gset
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'fpost', null, null) ->> 'id')::uuid, 'M1 1')
       is not null as ok \gset
select public.found_company(gen_random_uuid(), 'Fenja Pixel', 'Logos für Vereine', 'tech', '#123456', 'garage') -> 'company' as fc \gset
select tests.throws_key($$select public.set_company_logo(gen_random_uuid(), '{"palette": ["#000000"], "grid": []}')$$,
  'invalid_argument', 'set_company_logo(): invalid logo');
select public.set_company_logo(gen_random_uuid(), :logo::jsonb) -> 'company' as fl \gset
select tests.throws_key(format($$select public.report_company_logo(gen_random_uuid(), %L)$$, :'fc'::jsonb ->> 'id'),
  'invalid_argument', 'report_company_logo(): not the own logo');
select public.get_my_job() -> 'job' as fj \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.assert(
  (:'fc'::jsonb ->> 'founder_has_job')::boolean and (:'fc'::jsonb ->> 'full_time_from')::int = 5
  and (:'fc'::jsonb ->> 'headcount')::int = 0 and (:'fc'::jsonb ->> 'founder_productivity_bps')::int = 7500
  and :'fc'::jsonb -> 'logo' = 'null'::jsonb and not (:'fc'::jsonb ->> 'logo_hidden')::boolean
  and :'fl'::jsonb -> 'logo' = :logo::jsonb
  and (:'fj'::jsonb ->> 'quit_now_cost_cents')::bigint = (:'fj'::jsonb ->> 'salary_cents_per_hour')::bigint * 12,
  'found_company() while employed; the founder works at half productivity (founderFactor); set_company_logo(); quit_now_cost_cents');

-- logo everywhere a company goes to the client; reports hide it
select tests.login_as('authenticated', :r1);
select public.get_market_snapshot() -> 'securities' -> 0 as snap0 \gset
select public.report_company_logo(gen_random_uuid(), :'fco') as rep1 \gset
select public.report_company_logo(gen_random_uuid(), :'fco') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :r2);
select public.report_company_logo(gen_random_uuid(), :'fco') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_my_company() -> 'company' as fc2 \gset
reset role;
select tests.login_as('authenticated', :r3);
select public.report_company_logo(gen_random_uuid(), :'fco') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_my_company() -> 'company' as fc3 \gset
select public.set_company_logo(gen_random_uuid(), jsonb_set(:logo::jsonb, '{palette,1}', '"#00ff00"')) -> 'company' as fc4 \gset
reset role;
select tests.assert(
  :'rep1'::jsonb = '{"reported": true}'::jsonb
  and :'snap0'::jsonb ->> 'company_kind' = 'ai' and :'snap0'::jsonb -> 'logo' = 'null'::jsonb
  and :'fc2'::jsonb -> 'logo' = :logo::jsonb
  and :'fc3'::jsonb -> 'logo' = 'null'::jsonb and (:'fc3'::jsonb ->> 'logo_hidden')::boolean
  and not (:'fc4'::jsonb ->> 'logo_hidden')::boolean and :'fc4'::jsonb -> 'logo' -> 'palette' ->> 1 = '#00ff00'
  and public.company_json(:'fco') -> 'logo' -> 'palette' ->> 1 = '#00ff00'
  and (public.company_json((select company_id from public.player_jobs where player_id = :f and status = 'active')) -> 'logo') = 'null'::jsonb,
  'reports: one per player and logo, the third hides it; a new logo is visible again; company objects and the snapshot carry logo and kind');

-- =============================================================================
-- B. Quit at once
-- =============================================================================
select company_id as fjco, salary_cents_per_hour as fwage from public.player_jobs where player_id = :f and status = 'active' \gset
select tests.company_cash(:'fjco') as jcc \gset
select tests.cash(:f) as fcash \gset
select tests.login_as('authenticated', :f);
select public.quit_job(gen_random_uuid()) ->> 'notice_ends_at' as fnotice \gset
select public.quit_job(gen_random_uuid(), true) as fq \gset
select public.get_my_job() as fj2 \gset
reset role;
select tests.assert(
  :'fnotice' is not null
  and :'fq'::jsonb = jsonb_build_object('ended', true, 'paid_cents', :fwage::bigint * 12)
  and :'fj2'::jsonb = '{"job": null}'::jsonb
  and tests.company_cash(:'fjco') >= :jcc::bigint + :fwage::bigint * 12
  and tests.cash(:f) <= :fcash::bigint - :fwage::bigint * 12 + 2 * :fwage::bigint
  and (select end_reason = 'quit' from public.player_jobs where player_id = :f order by started_at desc limit 1),
  'quit_job(p_immediate): also during a notice; quitNowCostHours x wage to the employer, the job ends at once');
select tests.login_as('authenticated', :r1);
select x ->> 'id' as rpost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean order by x ->> 'id' limit 1 \gset
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'rpost', null, null) ->> 'id')::uuid, 'M1 1')
       is not null as ok \gset
reset role;
select public.ledger_transfer(public.ledger_player_account(:r1, 'player_cash'), public.ledger_system_account('households'),
  tests.cash(:r1), 'transfer', 'Test: leeren', 'player', :r1, 'test:m3f:r1drain') is not null as ok \gset
select tests.login_as('authenticated', :r1);
select tests.throws_key($$select public.quit_job(gen_random_uuid(), true)$$, 'insufficient_funds', 'quit_job(p_immediate): needs the money');
reset role;

-- full time from 5 people: the founder gives notice at the other job
select tests.login_as('authenticated', :f);
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'fpost', null, null) ->> 'id')::uuid, 'M1 1')
       is not null as ok \gset
select public.upgrade_company(gen_random_uuid()) -> 'company' ->> 'tier' as up1 \gset
select public.set_ai_workers(gen_random_uuid(), 4) -> 'company' as h4 \gset
reset role;
select notice_ends_at is null as nonotice from public.player_jobs where player_id = :f and status = 'active' \gset
select tests.login_as('authenticated', :f);
select public.set_ai_workers(gen_random_uuid(), 5) -> 'company' as h5 \gset
reset role;
select tests.assert(
  :'up1' = 'small_business' and (:'h4'::jsonb ->> 'headcount')::int = 4 and :'nonotice'::boolean
  and (:'h5'::jsonb ->> 'headcount')::int = 5
  and (select notice_ends_at > now() + interval '23 hours' from public.player_jobs where player_id = :f and status = 'active')
  and exists (select 1 from public.company_messages where company_id = :'fco'
                and body = 'Ab 5 Mitarbeitern arbeitet Fenja_Firma Vollzeit in der Firma.'),
  'from 5 people (players + AI workers) the founder works full time: notice at the other job, chat line');
select tests.login_as('authenticated', :f);
select public.quit_job(gen_random_uuid(), true) is not null as ok \gset
select tests.throws_key(format($$select public.sign_contract(gen_random_uuid(), %L, 'M1 1')$$,
  public.apply_for_job(gen_random_uuid(), :'fpost', null, null) ->> 'id'),
  'owns_company', 'sign_contract(): no job for founders of companies with 5 or more people');
reset role;
