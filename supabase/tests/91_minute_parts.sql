-- =============================================================================
-- 91 · The minute job in short parts (ADR-123)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

select public.run_due_part('core') ? 'crypto' as c1,
       public.run_due_part('companies') ?& array['player_companies', 'company_events', 'deals'] as c2,
       public.run_due_part('jobs') ?& array['quit_notices', 'share_offers', 'job_postings', 'salaries_paid'] as c3,
       public.run_due_part('art') ? 'artworks' as c4,
       public.run_due_part('social') ?& array['rich_list', 'social', 'events'] as c5 \gset
select tests.assert(:'c1'::boolean and :'c2'::boolean and :'c3'::boolean and :'c4'::boolean and :'c5'::boolean,
  'run_due_part(): core, companies, jobs, art and social each run their part of the due jobs');
select tests.throws_key($$select public.run_due_part('nope')$$, 'invalid_argument', 'run_due_part(): unknown part');
select tests.assert(
  not has_function_privilege('authenticated', 'public.run_due_part(text)', 'execute')
  and not exists (select 1 from public.player_missions m join public.mission_templates t on t.key = m.template_key
                   where m.status = 'active' and t.metric in ('limit_orders_placed', 'limit_orders_filled')),
  'run_due_part() is internal; no limit order mission is running any more');
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'closed money system after the split minute job');
