-- =============================================================================
-- 95 · Business moves of player companies (ADR-127)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''09509509-0000-4000-8000-0000000000a1'''
\set b '''09509509-0000-4000-8000-0000000000b1'''
\set rq '''09509509-0000-4000-8000-000000000101'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Kurt_Kurier') is not null and tests.signup(:b, 'Nora_Nobiz') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.fund(:a, 20000000, 'test:moves:a');
update public.sim_runtime set is_paused = false;
select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Kurt Kurierdienst', 'Pakete mit dem Rad', 'logistics', '#336699', 'garage')
  -> 'company' ->> 'id' as cid \gset
select public.company_deposit(gen_random_uuid(), 500000) is not null as ok \gset
reset role;
update public.player_companies set product_key = 'courier' where company_id = :'cid';

select tests.login_as('authenticated', :a);
select public.get_company_moves() as m0 \gset
reset role;
select tests.assert(
  (:'m0'::jsonb ->> 'slots')::int = 1 and (:'m0'::jsonb ->> 'used')::int = 0 and :'m0'::jsonb ->> 'product' = 'courier'
  and jsonb_array_length(:'m0'::jsonb -> 'moves') = 12
  and exists (select 1 from jsonb_array_elements(:'m0'::jsonb -> 'moves') x where x ->> 'key' = 'hospital_express')
  and not exists (select 1 from jsonb_array_elements(:'m0'::jsonb -> 'moves') x where x ->> 'key' = 'pentest_bank')
  and (select (x ->> 'cost_cents')::bigint = 120000 and (x ->> 'payout_cents')::bigint = 180000
              and (x ->> 'chance_bps')::int = 7000 and (x ->> 'refund_cents')::bigint = 36000
         from jsonb_array_elements(:'m0'::jsonb -> 'moves') x where x ->> 'key' = 'hospital_express')
  and (select (c.contract_work) from public.player_companies c where c.company_id = :'cid'),
  'get_company_moves(): the 6 moves of the product plus 6 for every company, numbers from the tier; contract work is on');

select tests.login_as('authenticated', :a);
select public.start_company_move(:rq, 'hospital_express') as s1 \gset
select public.start_company_move(:rq, 'hospital_express') as s1b \gset
select tests.throws_key($$select public.start_company_move(gen_random_uuid(), 'tax_review')$$, 'move_busy',
  'start_company_move(): one slot for a garage (NX108)');
select tests.throws_key($$select public.start_company_move(gen_random_uuid(), 'pentest_bank')$$, 'move_unknown',
  'start_company_move(): a move of another product (NX107)');
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.get_company_moves()$$, 'company_not_found', 'get_company_moves(): only for founders');
reset role;
select tests.assert(
  :'s1'::jsonb = :'s1b'::jsonb and (:'s1'::jsonb ->> 'used')::int = 1
  and (:'s1'::jsonb ->> 'cash_cents')::bigint = (:'m0'::jsonb ->> 'cash_cents')::bigint - 120000
  and jsonb_array_length(:'s1'::jsonb -> 'running') = 1,
  'start_company_move(): the cost leaves the company cash, the move runs; the same request replays');

-- the move comes due: a sure success with chance 100 %
update public.company_moves set chance_bps = 10000 where company_id = :'cid';
select public.company_moves_run_due(public.game_now() + interval '31 minutes') as r1 \gset
select tests.login_as('authenticated', :a);
select public.get_company_moves() as m1 \gset
select tests.throws_key($$select public.start_company_move(gen_random_uuid(), 'hospital_express')$$, 'move_resting',
  'start_company_move(): the same move rests afterwards (NX109)');
reset role;
select tests.assert(
  (:'r1'::jsonb ->> 'resolved')::int = 1
  and (:'m1'::jsonb ->> 'cash_cents')::bigint = (:'m0'::jsonb ->> 'cash_cents')::bigint - 120000 + 180000
  and :'m1'::jsonb -> 'history' -> 0 ->> 'status' = 'success'
  and (:'m1'::jsonb -> 'history' -> 0 ->> 'payout_cents')::bigint = 180000
  and exists (select 1 from public.company_messages cm where cm.company_id = :'cid' and cm.body like 'Geschäftszug geschafft%'),
  'company_moves_run_due(): success pays cost x payoutBps into the company cash and says so in the chat');

-- an awareness move that fails gives part of the money back, a success raises awareness
select tests.login_as('authenticated', :a);
select public.start_company_move(gen_random_uuid(), 'courier_app') is not null as ok \gset
reset role;
select awareness as aw0 from public.player_companies where company_id = :'cid' \gset
update public.company_moves set chance_bps = 10000 where company_id = :'cid' and status = 'running';
select public.company_moves_run_due(public.game_now() + interval '2 hours') is not null as ok \gset
select tests.assert(
  (select awareness from public.player_companies where company_id = :'cid') > :aw0::double precision + 0.03,
  'an awareness move raises the awareness of the company for good');
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'closed money system after the business moves');
select tests.throws($$select public.api_error('move_resting')$$, 'NX109', 'move_resting is NX109');

-- ADR-128: every area of the skill map has products, e.g. an online legal service that starts with law.
select tests.set_level(:b, 10);
select tests.fund(:b, 20000000, 'test:moves:b');
select tests.login_as('authenticated', :b);
select public.found_company(gen_random_uuid(), 'Nora Recht', 'Verträge per App', 'tech', '#663399', 'garage', 'legal_tech')
  is not null as ok \gset
select public.get_company_moves() as mb \gset
reset role;
select tests.assert(
  :'mb'::jsonb ->> 'product' = 'legal_tech'
  and exists (select 1 from jsonb_array_elements(:'mb'::jsonb -> 'moves') x where x ->> 'key' = 'class_action')
  and (select p.stages -> 0 ->> 0 = 'law_contracts' from jsonb_to_recordset(
         public.config_jsonb('startups', array['products', 'tech'])) as p(key text, stages jsonb) where p.key = 'legal_tech'),
  'found_company(): a legal-tech company starts with law and gets its own moves');
