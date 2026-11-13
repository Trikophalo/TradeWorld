-- =============================================================================
-- 89 · Stock news with a lead (ADR-119)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''08908908-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Nora_News') is not null as ok \gset
update public.sim_runtime set is_paused = false;

begin;
delete from public.stock_tips;
-- always true, a fixed move of 5 %, a lead of exactly 10 minutes
update public.game_config
   set value = '{"everyMinutes": 12, "leadMinMinutes": 10, "leadMaxMinutes": 10, "minMoveBps": 500, "maxMoveBps": 500,
                 "reliabilityBps": 10000, "keepHours": 24}'::jsonb
 where key = 'stockNews';
select public.game_now() as t0 \gset
select public.stock_news_run_due(:'t0') as r1 \gset
select public.stock_news_run_due(:'t0'::timestamptz + interval '5 minutes') as r2 \gset
select t.security_id as sec, t.direction as dir, t.news_item_id as nid from public.stock_tips t limit 1 \gset
select q.last_price_e4 as p0 from public.security_quotes q where q.security_id = :'sec' \gset
select tests.assert(
  :'r1'::jsonb = '{"settled": 0, "published": 1}'::jsonb and :'r2'::jsonb = '{"settled": 0, "published": 0}'::jsonb
  and (select count(*) from public.stock_tips) = 1
  and (select t.move_bps = 500 and t.strength = 1 and t.comes_true and t.applied_at is null
              and t.due_at = :'t0'::timestamptz + interval '10 minutes' from public.stock_tips t)
  and (select n.security_id = :'sec' and n.headline = (select headline from public.stock_tips)
              and n.body like 'Beobachter rechnen in Kürze mit einem leicht % Kurs. Sicher ist das nicht.'
         from public.news_items n where n.id = :nid),
  'stock_news_run_due(): one hint per everyMinutes for a listed stock, with a news item on that stock and a due time');

select tests.login_as('authenticated', :a);
select public.get_stock_news(5) as n1 \gset
reset role;
select tests.assert(
  (:'n1'::jsonb ->> 'reliability_bps')::int = 10000 and jsonb_array_length(:'n1'::jsonb -> 'items') = 1
  and :'n1'::jsonb -> 'items' -> 0 ->> 'status' = 'open'
  and :'n1'::jsonb -> 'items' -> 0 ->> 'direction' = case when :dir > 0 then 'up' else 'down' end
  and :'n1'::jsonb -> 'items' -> 0 -> 'move_bps' = 'null'::jsonb
  and (:'n1'::jsonb -> 'items' -> 0) ?& array['id', 'ticker', 'name', 'headline', 'body', 'strength', 'published_at', 'due_at'],
  'get_stock_news(): {reliability_bps, items: [{..., direction, status open, move_bps null until it is settled}]}');

-- the lead time passes: the price moves by the announced 5 % in the announced direction
select public.stock_news_run_due(:'t0'::timestamptz + interval '10 minutes') as r3 \gset
select q.last_price_e4 as p1 from public.security_quotes q where q.security_id = :'sec' \gset
select tests.login_as('authenticated', :a);
select public.get_stock_news(5) as n2 \gset
reset role;
select tests.assert(
  (:'r3'::jsonb ->> 'settled')::int = 1
  and abs(:p1::numeric / :p0 - (1 + :dir * 0.05)) < 0.002
  and (select t.applied_at is not null and t.result_news_id is not null from public.stock_tips t where t.security_id = :'sec'
        order by t.id limit 1)
  and exists (select 1 from jsonb_array_elements(:'n2'::jsonb -> 'items') i
               where i ->> 'status' = 'confirmed' and (i ->> 'move_bps')::int = :dir * 500),
  'a hint that comes true moves the price by its size when it is due; the news says so and the size is told');

-- a hint that does not come true leaves the price alone
update public.game_config set value = jsonb_set(value, '{reliabilityBps}', '0') where key = 'stockNews';
delete from public.stock_tips;
select public.stock_news_run_due(:'t0'::timestamptz + interval '1 hour') is not null as ok \gset
select t.security_id as sec2 from public.stock_tips t limit 1 \gset
select q.last_price_e4 as q0 from public.security_quotes q where q.security_id = :'sec2' \gset
select public.stock_news_run_due(:'t0'::timestamptz + interval '71 minutes') is not null as ok \gset
select tests.assert(
  (select q.last_price_e4 = :q0 from public.security_quotes q where q.security_id = :'sec2')
  and (select not t.comes_true and t.applied_at is not null from public.stock_tips t where t.security_id = :'sec2' order by t.id limit 1)
  and exists (select 1 from public.news_items n where n.security_id = :'sec2' and n.headline like 'Entwarnung bei %'),
  'a hint that fizzles: no move, a news item says the report was not confirmed');
rollback;

select tests.assert(
  not has_table_privilege('authenticated', 'public.stock_tips', 'select')
  and not has_function_privilege('authenticated', 'public.stock_news_run_due(timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.get_stock_news(integer)', 'execute'),
  'grants: the plan of a hint is internal, only get_stock_news() is for players');
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'closed money system after the stock news tests');
