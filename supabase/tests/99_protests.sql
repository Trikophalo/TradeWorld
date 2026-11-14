-- =============================================================================
-- 99 · Campaigns against other companies (ADR-133)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''09909909-0000-4000-8000-0000000000a1'''
\set b '''09909909-0000-4000-8000-0000000000b1'''
\set f '''09909909-0000-4000-8000-0000000000f1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Kampa_Anna') is not null and tests.signup(:b, 'Kampa_Bert') is not null
   and tests.signup(:f, 'Kampa_Firma') is not null as ok \gset
select tests.set_level(:a, 6);
select tests.set_level(:b, 6);
select tests.set_level(:f, 12);
select tests.fund(:a, 1000000, 'test:camp:a');
select tests.fund(:f, 20000000, 'test:camp:f');
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Zielscheibe', 'Plastikgabeln', 'retail', '#aa5533', 'garage')
  -> 'company' ->> 'id' as cid \gset
select tests.throws_key(format('select public.start_protest(gen_random_uuid(), %L, %L)', :'cid', 'boycott'),
  'protest_own', 'start_protest(): not against the own company (NX120)');
reset role;
select c.id as kls from public.companies c where c.ticker = 'KLS' \gset

select tests.cash(:a) as a0 \gset
select tests.login_as('authenticated', :a);
select public.start_protest(gen_random_uuid(), :'cid', 'shitstorm') as s1 \gset
select tests.throws_key(format('select public.start_protest(gen_random_uuid(), %L, %L)', :'kls', 'petition'),
  'protest_busy', 'start_protest(): one campaign per player in a few hours (NX117)');
select tests.throws_key(format('select public.start_protest(gen_random_uuid(), %L, %L)', :'cid', 'gossip'),
  'invalid_argument', 'start_protest(): only the fixed kinds');
reset role;
select id as k1 from public.company_protests where company_id = :'cid' \gset
select tests.assert(
  tests.cash(:a) = :a0::bigint - 50000
  and (:'s1'::jsonb -> 'protests' -> 0 ->> 'players')::int = 1
  and (:'s1'::jsonb -> 'protests' -> 0 ->> 'mine')::boolean,
  'start_protest(): costs 500 €, the starter supports it');

select tests.login_as('authenticated', :b);
select public.join_protest(gen_random_uuid(), :k1) is not null as ok \gset
select tests.throws_key(format('select public.join_protest(gen_random_uuid(), %s)', :k1), 'protest_joined',
  'join_protest(): only once (NX118)');
reset role;
select tests.login_as('authenticated', :f);
select public.get_protests() as g \gset
select tests.throws_key(format('select public.join_protest(gen_random_uuid(), %s)', :k1), 'protest_own',
  'join_protest(): the target cannot join');
reset role;
select tests.assert(
  (select (x ->> 'against_me')::boolean from jsonb_array_elements(:'g'::jsonb -> 'protests') x where (x ->> 'id')::bigint = :k1),
  'get_protests(): the target sees the campaign against it');

-- AI supporters stop at aiMax; the goal needs players too
update public.company_protests set ai_supporters = 16 where id = :k1;
select public.protests_run_due(now()) is not null as ok \gset
select tests.assert(
  (select status = 'open' and ai_supporters = 16 from public.company_protests where id = :k1),
  'protests_run_due(): AI supporters stop at 16, two players are not enough for 20');

-- at the goal: a rare hit (forced here)
update public.company_protests set ai_supporters = 18 where id = :k1;
select awareness as aw0 from public.player_companies where company_id = :'cid' \gset
select public.protest_check(:k1, 0.0, 0.5) as out1 \gset
select tests.assert(
  :'out1' = 'hit'
  and (select status = 'hit' and effect_bps between 150 and 450 from public.company_protests where id = :k1)
  and (select awareness < :aw0::double precision from public.player_companies where company_id = :'cid')
  and exists (select 1 from public.news_items n where n.company_id = :'cid' and n.headline like 'Shitstorm gegen Zielscheibe%'),
  'protest_check(): at the goal a hit costs the target awareness and makes market news');

-- a campaign against an AI company usually fizzles
select tests.login_as('authenticated', :b);
select public.start_protest(gen_random_uuid(), :'kls', 'petition') is not null as ok \gset
reset role;
select id as k2 from public.company_protests where company_id = :'kls' and status = 'open' \gset
update public.company_protests set ai_supporters = 19 where id = :k2;
select public.protest_check(:k2, 0.99, 0.5) as out2 \gset
select tests.assert(:'out2' = 'fizzled'
  and exists (select 1 from public.news_items n where n.headline like 'Petition gegen KlarSoft%verpufft'),
  'protest_check(): mostly it fizzles out');
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'closed money system after campaigns');
select tests.throws($$select public.api_error('protest_own')$$, 'NX120', 'protest_own is NX120');
