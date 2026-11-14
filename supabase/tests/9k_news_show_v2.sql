-- =============================================================================
-- 9k · NEXA Nachrichten 2: personal news, NFTs, digressions, moods, made-up chat viewers (ADR-152)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set g '''09b19b19-0000-4000-8000-0000000000a1'''
\set b '''09b19b19-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:g, 'Klatsch_Gut') is not null and tests.signup(:b, 'Klatsch_Pech') is not null as ok \gset

select tests.assert(
  (select jsonb_array_length(value #> '{chat,bots,lines,angry}') >= 10 and jsonb_array_length(value #> '{chat,bots,lines,glaze}') >= 10
          and jsonb_array_length(value #> '{ramble,people}') >= 5 and value #> '{moods,gossipBad}' is not null
          and (value ->> 'introSeconds')::int = 12
     from public.game_config where key = 'newsShow'),
  'config: moods, digressions with public figures, lines of the made-up viewers, a longer intro');

-- A. the draft: personal news from what players did, the NFT sale, a digression that moves a stock; all with a mood
delete from public.news_shows;
delete from public.news_show_messages;
delete from public.news_show_used where key like 'fact:%';
select tests.set_cfg('newsShow', '{gossip,count}', '500');
select tests.set_cfg('newsShow', '{company,count}', '0');
select tests.set_cfg('newsShow', '{maxSegments}', '600');
select tests.set_cfg('newsShow', '{ramble,chanceBps}', '10000');
select tests.set_cfg('newsShow', '{ramble,investShareBps}', '10000');
select tests.set_cfg('newsShow', '{chat,bots,names}', '["Jürgen Test", "Chantal Test"]');
insert into public.feed_items (actor_id, kind, payload) values (:g, 'level_up', '{"level": 7}') returning id as feed_g \gset
insert into public.feed_items (actor_id, kind, payload) values (:b, 'rug_pull', '{"name": "Mondcoin"}') returning id as feed_b \gset
insert into public.artwork_sales (artwork_id, kind, buyer_ai, price_cents, at)
select a.id, 'ai', 'Vera Vermeer', 987654300, now() from public.artworks a where a.creator_id is null order by a.serial limit 1
returning id as sale, artwork_id as art \gset
select title as art_title from public.artworks where id = :'art' \gset
select public.news_show_build(now()) as segs \gset
select (select x from jsonb_array_elements(:'segs'::jsonb) x where x ->> 'kind' = 'gossip' and x -> 'subject' ->> 'name' = 'Klatsch_Gut') as sg,
       (select x from jsonb_array_elements(:'segs'::jsonb) x where x ->> 'kind' = 'gossip' and x -> 'subject' ->> 'name' = 'Klatsch_Pech') as sb,
       (select x from jsonb_array_elements(:'segs'::jsonb) x where x ->> 'kind' = 'nft') as sn,
       (select x from jsonb_array_elements(:'segs'::jsonb) x where x ->> 'kind' = 'ramble') as sr \gset
select tests.assert(
  (:'sg'::jsonb ->> 'headline') || (:'sg'::jsonb ->> 'text') like '%Klatsch_Gut%' and :'sg'::jsonb ->> 'text' like '%Level 7 erreicht%'
  and :'sg'::jsonb ->> 'text' not like '%{%' and :'sg'::jsonb -> 'apply' = '[]'::jsonb
  and :'sg'::jsonb ->> 'mood' in ('shocked', 'proud')
  and :'sg'::jsonb -> 'subject' ->> 'ukey' = 'fact:feed:' || :feed_g,
  'gossip: good personal news from the feed (level up), with a mood, no effect');
select tests.assert(
  (:'sb'::jsonb ->> 'headline') || (:'sb'::jsonb ->> 'text') like '%Rug Pull bei Mondcoin%' and :'sb'::jsonb ->> 'text' not like '%{%'
  and :'sb'::jsonb -> 'apply' -> 0 ->> 'type' = 'cash' and (:'sb'::jsonb -> 'apply' -> 0 ->> 'cents')::int = 10000
  and (:'sb'::jsonb -> 'apply' -> 0 ->> 'player_id')::uuid = :b
  and :'sb'::jsonb -> 'effects' -> 0 ->> 'label' like '%Schmerzensgeld' and :'sb'::jsonb ->> 'mood' in ('laughing', 'smug', 'shocked'),
  'gossip: bad personal news roast the player and pay gossip.hushMoneyCents');
select tests.assert(
  (:'sn'::jsonb ->> 'headline') || (:'sn'::jsonb ->> 'text') like '%' || :'art_title' || '%'
  and :'sn'::jsonb ->> 'text' like '%Vera Vermeer%' and :'sn'::jsonb ->> 'text' like '%9.876.543%'
  and :'sn'::jsonb ->> 'text' not like '%{%'
  and not (:'sn'::jsonb -> 'subject') ? 'player_id' and :'sn'::jsonb -> 'subject' ->> 'ukey' = 'fact:nft:' || :sale,
  'nft: the most expensive sale of the last hours with title, buyer and price; no player id when the creator is unknown');
select tests.assert(
  :'sr'::jsonb -> 'apply' -> 0 ->> 'type' = 'stock' and (:'sr'::jsonb -> 'apply' -> 0 ->> 'bps')::int between 300 and 900
  and :'sr'::jsonb ->> 'text' not like '%{%'
  and exists (select 1 from jsonb_array_elements_text((select value #> '{ramble,people}' from public.game_config where key = 'newsShow')) pp
               where (:'sr'::jsonb ->> 'headline') || (:'sr'::jsonb ->> 'text') like '%' || pp || '%')
  and :'sr'::jsonb ->> 'mood' in ('shocked', 'smug'),
  'ramble: a rumour about a public figure and a stock, which lifts the stock by ramble.minBps..maxBps');
select tests.assert(
  not exists (select 1 from jsonb_array_elements(:'segs'::jsonb) x
               where x ? 'ord' or x ->> 'mood' not in ('neutral', 'shocked', 'crying', 'laughing', 'angry', 'smug', 'confused', 'proud'))
  and :'segs'::jsonb -> -1 ->> 'kind' = 'tip'
  and (select min(ord) from jsonb_array_elements(:'segs'::jsonb) with ordinality t(x, ord) where x ->> 'kind' = 'gossip')
      < (select min(ord) from jsonb_array_elements(:'segs'::jsonb) with ordinality t(x, ord) where x ->> 'kind' = 'stock'),
  'every segment has a known mood; people come before the AI stock, the hint stays last');
select tests.set_cfg('newsShow', '{ramble,investShareBps}', '0');
select tests.assert(
  (select x -> 'apply' = '[]'::jsonb and x ->> 'text' not like '%{%' and x ->> 'mood' in ('confused', 'angry', 'crying')
     from jsonb_array_elements(public.news_show_build(now())) x where x ->> 'kind' = 'ramble'),
  'ramble: pure nonsense has no effect');
select tests.set_cfg('newsShow', '{ramble,investShareBps}', '5000');

-- B. the show starts: facts count as told, hush money is paid, made-up viewers get their lines for the whole show
insert into public.news_shows (airs_at, segments) values (date_trunc('hour', now()), :'segs'::jsonb) returning id as show \gset
select tests.set_cfg('newsShow', '{waitMinutes}', '60');
select tests.cash(:g) as g0, tests.cash(:b) as b0 \gset
select tests.login_as('authenticated', :g);
select public.get_news_show() as v1 \gset
reset role;
select count(*) as bots, min(created_at) as bot_first, max(created_at) as bot_last
  from public.news_show_messages where bot_name is not null \gset
select tests.assert(
  (select status = 'aired' from public.news_shows where id = :show)
  and tests.cash(:g) = :g0::bigint and tests.cash(:b) = :b0::bigint + 10000
  and exists (select 1 from public.news_show_used where key = 'fact:feed:' || :feed_g)
  and exists (select 1 from public.news_show_used where key = 'fact:feed:' || :feed_b)
  and exists (select 1 from public.news_show_used where key = 'fact:nft:' || :sale)
  and exists (select 1 from public.notifications n where n.player_id = :b and n.type_key = 'news_show')
  and exists (select 1 from public.news_items i where i.category = 'player' and i.headline = :'sb'::jsonb ->> 'headline')
  and :'v1'::jsonb -> 'show' -> 'segments' -> 0 ->> 'mood' is not null
  and not (:'v1'::jsonb -> 'show' -> 'segments' -> 0) ? 'subject',
  'start: hush money, facts stored as told, notification, the feed files it under players, segments carry the mood');
select tests.assert(
  :bots::int >= 10 and :'bot_first'::timestamptz > (select started_at from public.news_shows where id = :show)
  and :'bot_last'::timestamptz < (select started_at from public.news_shows where id = :show)
        + make_interval(secs => 12 + 22 * jsonb_array_length(:'segs'::jsonb) + 6)
  and not exists (select 1 from public.news_show_messages where bot_name is not null and bot_name not in ('Jürgen Test', 'Chantal Test'))
  and not exists (select 1 from public.news_show_messages where bot_name is not null and body like '%{%')
  and not exists (select 1 from jsonb_array_elements(:'v1'::jsonb -> 'chat') c where c ->> 'nickname' in ('Jürgen Test', 'Chantal Test')),
  'made-up viewers: lines for the whole show, written at the start, none visible before its time');
update public.news_show_messages set created_at = now() - interval '1 second' where bot_name is not null;
select tests.login_as('authenticated', :b);
select public.post_news_show_message(gen_random_uuid(), 'Frechheit') is not null as ok \gset
select public.get_news_show() as v2 \gset
reset role;
select tests.assert(
  (select count(*) from jsonb_array_elements(:'v2'::jsonb -> 'chat') c
    where c ->> 'nickname' in ('Jürgen Test', 'Chantal Test') and not (c ->> 'mine')::boolean) >= 10
  and :'v2'::jsonb -> 'chat' -> -1 ->> 'body' = 'Frechheit' and (:'v2'::jsonb -> 'chat' -> -1 ->> 'mine')::boolean
  and (:'v2'::jsonb -> 'show' ->> 'started_at') = (:'v1'::jsonb -> 'show' ->> 'started_at')
  and (select count(*) from public.news_show_messages where bot_name is not null) = :bots::int,
  'the chat shows the made-up viewers once their time has come, between the players; they are written only once');

-- C. nothing is told twice
select public.news_show_build(now()) as segs2 \gset
select tests.assert(
  not exists (select 1 from jsonb_array_elements(:'segs2'::jsonb) x
               where x -> 'subject' ->> 'ukey' in ('fact:feed:' || :feed_g, 'fact:feed:' || :feed_b, 'fact:nft:' || :sale)),
  'the next show does not repeat a fact that was already told');

-- D. Claude may choose another face, unknown moods are ignored
insert into public.news_shows (airs_at, segments) values (date_trunc('hour', now()) + interval '1 hour', :'segs2'::jsonb)
returning id as next_show \gset
select (select jsonb_agg(jsonb_build_object('headline', 'Neu ' || repeat('o', ord::int), 'text', 'Mr. Doodle Dangle sagt etwas Neues' || repeat('!', ord::int),
                                            'mood', case when ord = 1 then 'crying' else 'begeistert' end))
          from jsonb_array_elements(:'segs2'::jsonb) with ordinality t(x, ord)) as script \gset
select public.store_news_show_script(:next_show, :'script'::jsonb) as stored \gset
select tests.assert(
  :'stored'::boolean and jsonb_array_length(:'segs2'::jsonb) >= 2
  and (select segments -> 0 ->> 'mood' = 'crying' and segments -> 1 ->> 'mood' = :'segs2'::jsonb -> 1 ->> 'mood'
         from public.news_shows where id = :next_show)
  and (public.news_show_script_context(:next_show) -> 'segments' -> 0) ? 'mood'
  and not exists (select 1 from jsonb_array_elements(public.news_show_script_context(:next_show) -> 'segments') x where x -> 'facts' ? 'ukey'),
  'store_news_show_script(): a known mood replaces the face, anything else keeps it; the context shows moods, no internal keys');

select tests.assert(not exists (select 1 from public.ledger_audit()) and tests.money_invariant() = 'ok',
  'ledger audit and money invariant hold after the show');
select tests.set_cfg('newsShow', '{waitMinutes}', '10');
select tests.set_cfg('newsShow', '{gossip,count}', '2');
select tests.set_cfg('newsShow', '{company,count}', '2');
select tests.set_cfg('newsShow', '{maxSegments}', '10');
select tests.set_cfg('newsShow', '{ramble,chanceBps}', '7000');
delete from public.news_shows;
delete from public.news_show_messages;
