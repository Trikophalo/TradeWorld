-- =============================================================================
-- 9i · NEXA Nachrichten: the hourly live show (ADR-150)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
-- ADR-182: announcements of new sets air in one fixed hour; the show tests must not depend on the clock
update public.game_config set value = jsonb_set(value, '{announcements}', '[]'::jsonb) where key = 'newsShow';

\set f '''09119119-0000-4000-8000-0000000000f1'''
\set l '''09119119-0000-4000-8000-0000000000a1'''
\set w '''09119119-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:f, 'Show_Chefin') is not null and tests.signup(:l, 'Show_Pechvogel') is not null
   and tests.signup(:w, 'Show_Glueck') is not null as ok \gset
select tests.set_level(:f, 10);
select tests.fund(:f, 20000000, 'test:show:f');
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Sendeanstalt', 'Fernseher für Hunde', 'tech', '#225588', 'garage')
  -> 'company' ->> 'id' as cid \gset
reset role;

-- A. scripts: formats, placeholders, and nothing repeats before every combination was used
select tests.assert(
  public.news_show_move(-1240) = '12,4 %' and public.news_show_move(1200) = '12 %'
  and public.news_show_fill('{stock} fällt um {move}, {x}', '{"stock": "BRZ", "move": "12 %"}') = 'BRZ fällt um 12 %, {x}',
  'news_show_move() / news_show_fill(): same as movePercent and fillScript');
delete from public.news_show_used;
select (select jsonb_array_length(value #> '{texts,stockDown,frames}') * jsonb_array_length(value #> '{texts,stockDown,reasons}')
          from public.game_config where key = 'newsShow') as combos \gset
select count(distinct x ->> 'text') as picked
  from generate_series(1, :combos) g, lateral (select public.news_show_pick('stockDown') as x where g > 0) p \gset
select tests.assert(:picked::int = :combos::int and :combos::int >= 40,
  'news_show_pick(): every frame x reason comes once before any repeats (ADR-150)');

-- B. the draft: a loser from the rich list, the player company, stocks, the world, a hint
delete from public.news_shows;
delete from public.rich_list_snapshots where entity_kind = 'player';
-- every player company of the test database gets a segment, so ours is among them
select tests.set_cfg('newsShow', '{company,count}', '500');
-- personal news and the made-up chat viewers have their own test (9k)
select tests.set_cfg('newsShow', '{gossip,count}', '0');
select tests.set_cfg('newsShow', '{chat,bots,names}', '[]');
select tests.set_cfg('newsShow', '{maxSegments}', '600');
insert into public.rich_list_snapshots (taken_at, entity_kind, entity_id, net_worth_cents, rank_all, rank_players)
values (now() - interval '20 hours', 'player', :l, 1000000, 1, 1), (now() - interval '5 minutes', 'player', :l, 600000, 1, 1),
       (now() - interval '20 hours', 'player', :w, 1000000, 2, 2), (now() - interval '5 minutes', 'player', :w, 1500000, 2, 2);
select public.news_show_build(now()) as segs \gset
select tests.assert(
  jsonb_array_length(:'segs'::jsonb) >= 5
  and :'segs'::jsonb -> 0 ->> 'kind' = 'loser'
  and (:'segs'::jsonb -> 0 ->> 'headline') || (:'segs'::jsonb -> 0 ->> 'text') like '%Show_Pechvogel%'
  and (:'segs'::jsonb -> 0 ->> 'headline') || (:'segs'::jsonb -> 0 ->> 'text') like '%40 %'
  and :'segs'::jsonb -> 0 ->> 'text' not like '%{%'
  and :'segs'::jsonb -> 0 -> 'apply' -> 0 ->> 'type' = 'cash'
  and exists (select 1 from jsonb_array_elements(:'segs'::jsonb) x
               where x ->> 'kind' in ('scandal', 'hype') and (x ->> 'headline') || (x ->> 'text') like '%Sendeanstalt%'
                 and (x ->> 'headline') || (x ->> 'text') not like '%{%'
                 and x -> 'subject' ->> 'idea' = 'Fernseher für Hunde')
  and exists (select 1 from jsonb_array_elements(:'segs'::jsonb) x where x ->> 'kind' = 'stock')
  and exists (select 1 from jsonb_array_elements(:'segs'::jsonb) x where x ->> 'kind' = 'winner' and (x ->> 'headline') || (x ->> 'text') like '%Show_Glueck%')
  and :'segs'::jsonb -> -1 ->> 'kind' = 'tip',
  'news_show_build(): loser with consolation, the player''s company with its idea, stocks, winner, the hint last');

select tests.set_cfg('newsShow', '{company,count}', '2');
select tests.set_cfg('newsShow', '{maxSegments}', '7');
select public.news_show_build(now()) as segs7 \gset
select tests.assert(jsonb_array_length(:'segs7'::jsonb) between 4 and 7 and :'segs7'::jsonb -> -1 ->> 'kind' = 'tip',
  'news_show_build(): at most maxSegments, the hint stays last');

-- C. nobody watches: the show is cancelled and nothing happens
insert into public.news_shows (airs_at, segments) values (date_trunc('hour', now()) - interval '2 hours', :'segs'::jsonb)
returning id as old_show \gset
select tests.cash(:l) as l0 \gset
select public.news_show_run_due(now()) as due1 \gset
select tests.assert(
  (select status = 'cancelled' and started_at is null from public.news_shows where id = :old_show)
  and tests.cash(:l) = :l0::bigint,
  'news_show_run_due(): a show nobody watched is cancelled, no effect applies (ADR-150)');
select tests.assert(not public.news_show_start(:old_show, now()), 'news_show_start(): a cancelled show never starts');

-- D. a viewer is there: the show starts once and every effect applies
delete from public.news_shows;
insert into public.news_shows (airs_at, segments) values (date_trunc('hour', now()), :'segs'::jsonb) returning id as show \gset
select tests.set_cfg('newsShow', '{waitMinutes}', '60');
select (x -> 'apply' -> 0 ->> 'security_id')::uuid as sec, (x -> 'apply' -> 0 ->> 'bps')::int as sec_bps
  from jsonb_array_elements(:'segs'::jsonb) x where x ->> 'kind' = 'stock' limit 1 \gset
select last_price_e4 as px0 from public.security_quotes where security_id = :'sec' \gset
select awareness as aw0 from public.player_companies where company_id = :'cid' \gset
select (x -> 'apply' -> 0 ->> 'awareness_bps')::int as aw_bps
  from jsonb_array_elements(:'segs'::jsonb) x where x -> 'subject' ->> 'company_id' = :'cid' \gset
select tests.login_as('authenticated', :l);
select public.get_news_show() as g1 \gset
select public.get_news_show() as g2 \gset
reset role;
select tests.assert(
  (select status = 'aired' and started_at is not null from public.news_shows where id = :show)
  and (:'g1'::jsonb -> 'show' ->> 'id')::bigint = :show and (:'g1'::jsonb ->> 'viewers')::int = 1
  and jsonb_array_length(:'g1'::jsonb -> 'show' -> 'segments') = jsonb_array_length(:'segs'::jsonb)
  and not (:'g1'::jsonb -> 'show' -> 'segments' -> 0) ? 'apply'
  and not (:'g1'::jsonb -> 'show' -> 'segments' -> 0) ? 'subject'
  and :'g2'::jsonb -> 'show' ->> 'started_at' = :'g1'::jsonb -> 'show' ->> 'started_at',
  'get_news_show(): the first viewer starts this hour''s show; segments are public without the internals; it starts once');
select tests.assert(
  tests.cash(:l) = :l0::bigint + 50000
  and (select count(*) from public.ledger_transactions where idempotency_key like 'newsshow:' || :show || ':%') = 1
  -- the stock moved (a sector segment may have moved it once more)
  and (select last_price_e4 <> :px0::bigint and (last_price_e4 > :px0::bigint) = (:sec_bps > 0 or last_price_e4 > :px0::bigint)
         from public.security_quotes where security_id = :'sec')
  and (select abs(awareness - least(1, greatest(0.05, :aw0::numeric * (10000 + :aw_bps) / 10000))) < 1e-9
         from public.player_companies where company_id = :'cid')
  and exists (select 1 from public.stock_tips t where t.applied_at is null and t.published_at > now() - interval '1 minute')
  and exists (select 1 from public.notifications n where n.player_id = :l and n.type_key = 'news_show')
  and exists (select 1 from public.notifications n where n.player_id = :f and n.type_key = 'news_show')
  and (select count(*) from public.news_items i where i.published_at >= now() - interval '1 minute'
                                                   and i.headline = :'segs'::jsonb -> 0 ->> 'headline') = 1,
  'news_show_start(): consolation from the households, price shock, company awareness, the hint, notifications, the feed');
select tests.assert(not exists (select 1 from public.ledger_audit()) and tests.money_invariant() = 'ok',
  'ledger audit and money invariant hold after a news show');

-- E. the chat: emojis welcome, no empty or foul messages, a limit per minute
select tests.set_cfg('newsShow', '{chat,perMinute}', '2');
select tests.login_as('authenticated', :w);
select public.get_news_show() is not null as ok \gset
select public.post_news_show_message(gen_random_uuid(), '  💀📉 was für eine Sendung  ') as c1 \gset
select tests.throws_key($$select public.post_news_show_message(gen_random_uuid(), '   ')$$, 'chat_text_invalid',
  'post_news_show_message(): no empty message (NX128)');
select public.post_news_show_message(gen_random_uuid(), 'zweite') is not null as ok \gset
select tests.throws_key($$select public.post_news_show_message(gen_random_uuid(), 'dritte')$$, 'rate_limited',
  'post_news_show_message(): at most chat.perMinute messages');
reset role;
select tests.login_as('authenticated', :l);
select public.get_news_show() as g3 \gset
reset role;
select tests.assert(
  :'c1'::jsonb -> 'chat' -> -1 ->> 'body' = '💀📉 was für eine Sendung' and (:'c1'::jsonb -> 'chat' -> -1 ->> 'mine')::boolean
  and jsonb_array_length(:'g3'::jsonb -> 'chat') = 2 and not (:'g3'::jsonb -> 'chat' -> 0 ->> 'mine')::boolean
  and :'g3'::jsonb -> 'chat' -> 0 ->> 'nickname' = 'Show_Glueck' and (:'g3'::jsonb ->> 'viewers')::int = 2,
  'the chat is shared, trimmed, with emojis; both viewers count');

-- F. Claude's script: one caller claims, the service role stores, only before the show
insert into public.news_shows (airs_at, segments) values (date_trunc('hour', now()) + interval '1 hour', :'segs'::jsonb)
returning id as next_show \gset
select tests.login_as('authenticated', :w);
select public.news_show_claim_script(:next_show) as claim1, public.news_show_claim_script(:show) as claim_old \gset
select public.news_show_claim_script(:next_show) as claim2 \gset
reset role;
select (select jsonb_agg(jsonb_build_object('headline', 'Neu ' || repeat('o', ord::int), 'text', 'Mr. Doodle Dangle sagt etwas Neues' || repeat('!', ord::int)))
          from jsonb_array_elements(:'segs'::jsonb) with ordinality t(x, ord)) as script \gset
select public.store_news_show_script(:next_show, '[{"headline": "x", "text": "zu wenige"}]'::jsonb) as st_few \gset
select public.store_news_show_script(:next_show, :'script'::jsonb) as st_ok \gset
select public.store_news_show_script(:show, :'script'::jsonb) as st_aired \gset
select tests.assert(
  :'claim1'::boolean and not :'claim2'::boolean and not :'claim_old'::boolean
  and not :'st_few'::boolean and :'st_ok'::boolean and not :'st_aired'::boolean
  and (select writer = 'claude' and segments -> 0 ->> 'headline' = 'Neu o' and segments -> 0 -> 'apply' = :'segs'::jsonb -> 0 -> 'apply'
         from public.news_shows where id = :next_show)
  and (public.news_show_script_context(:next_show) -> 'segments' -> 0 -> 'facts') ? 'name'
  and not (public.news_show_script_context(:next_show) -> 'segments' -> 0 -> 'facts') ? 'player_id',
  'Claude''s script: claimed once, same number of segments, effects untouched, only before the show; the context has no ids');

select tests.set_cfg('newsShow', '{waitMinutes}', '10');
select tests.set_cfg('newsShow', '{chat,perMinute}', '10');
select tests.set_cfg('newsShow', '{gossip,count}', '2');
delete from public.news_shows;
delete from public.news_show_messages;
