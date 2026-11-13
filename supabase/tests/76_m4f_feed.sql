-- =============================================================================
-- 76 · M4f: friends feed, reactions, notifications (ADR-088)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''07607607-0000-4000-8000-0000000000a1'''
\set b '''07607607-0000-4000-8000-0000000000b2'''
\set c '''07607607-0000-4000-8000-0000000000c3'''
\set rq '''07607607-0000-4000-8000-0000000000f1'''
select tests.signup(:a, 'Feli_Feed') is not null and tests.signup(:b, 'Fritz_Freund') is not null
   and tests.signup(:c, 'Clara_Fremd') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.fund(:a, 40000000, 'test:m4f:a');
select tests.fund(:b, 2000000, 'test:m4f:b');
select tests.fund(:c, 2000000, 'test:m4f:c');
create or replace function tests.feed_kinds(p_player uuid) returns text[] language sql as $$
  select coalesce(array_agg(kind order by id), '{}') from public.feed_items where actor_id = p_player $$;
create or replace function tests.feed_item(p_player uuid, p_kind text) returns public.feed_items language sql as $$
  select * from public.feed_items where actor_id = p_player and kind = p_kind order by id desc limit 1 $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. level_up: only when a multiple of social.feed.levelEvery (5) is reached, the highest one
-- =============================================================================
select tests.set_level(:a, 4);
select tests.feed_kinds(:a) as k0 \gset
select tests.set_level(:a, 16);
select tests.set_level(:b, 15);
select tests.set_level(:c, 9);
select tests.assert(
  :'k0'::text[] = '{}' and tests.feed_kinds(:a) = array['level_up']
  and (tests.feed_item(:a, 'level_up')).payload = '{"level": 15}'::jsonb
  and (tests.feed_item(:a, 'level_up')).visibility = 'friends'
  and (tests.feed_item(:c, 'level_up')).payload = '{"level": 5}'::jsonb,
  'level_up: nothing below 5; 4 -> 16 posts once for level 15; 1 -> 9 posts level 5');

-- =============================================================================
-- B. friends_now on an accepted request (both sides), nothing for a pending one
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.send_friend_request(gen_random_uuid(), 'Fritz_Freund') is not null as ok \gset
reset role;
select count(*) as fn0 from public.feed_items where kind = 'friends_now' and actor_id in (:a, :b) \gset
select tests.login_as('authenticated', :b);
select public.respond_friend_request(gen_random_uuid(), 'Feli_Feed', true) is not null as ok \gset
reset role;
select tests.assert(
  :fn0 = 0
  and (tests.feed_item(:a, 'friends_now')).payload = '{"other_nickname": "Fritz_Freund"}'::jsonb
  and (tests.feed_item(:b, 'friends_now')).payload = '{"other_nickname": "Feli_Feed"}'::jsonb,
  'friends_now: one item per side once the request is accepted, none while pending');

-- =============================================================================
-- C. Companies: founded, upgraded, expanded, IPO; job application notification
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Feed Fabrik', 'Neuigkeiten am Fließband', 'tech', '#225588', 'garage')
  is not null as ok \gset
select public.upgrade_company(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.company_of(:a) as co \gset
update public.player_companies set expansion_level = expansion_level + 1 where company_id = :'co';
update public.player_companies set ai_workers = ai_workers where company_id = :'co';
select tests.assert(
  (tests.feed_item(:a, 'company_founded')).payload = '{"name": "Feed Fabrik", "tier": "garage"}'::jsonb
  and (tests.feed_item(:a, 'company_upgraded')).payload = '{"name": "Feed Fabrik", "tier": "small_business"}'::jsonb
  and (tests.feed_item(:a, 'company_expanded')).payload = '{"name": "Feed Fabrik", "level": 1}'::jsonb
  and (select count(*) from public.feed_items where actor_id = :a and kind like 'company_%') = 3,
  'company_founded / company_upgraded / company_expanded with name and tier or level; other updates post nothing');
update public.companies set ticker = 'FEDF' where id = :'co';
update public.player_companies set tier = 'ag' where company_id = :'co';
select tests.assert(
  (tests.feed_item(:a, 'company_ipo')).payload = '{"name": "Feed Fabrik", "ticker": "FEDF"}'::jsonb
  and (select count(*) from public.feed_items where actor_id = :a and kind = 'company_upgraded') = 1,
  'company_ipo {name, ticker} when the company becomes an AG (not a company_upgraded)');

select tests.login_as('authenticated', :a);
select public.create_job_posting(gen_random_uuid(), :'co', 'intern', 'Werkstudium Feed', '[{"branch": "it", "min_score": 0}]',
                                 18000, 1) is not null as ok \gset
reset role;
select id as post from public.job_postings where company_id = :'co' \gset
select tests.login_as('authenticated', :b);
select public.apply_for_job(gen_random_uuid(), :'post', 20000, 'Ich lese gern Feeds.') ->> 'id' as app \gset
reset role;
select tests.assert(
  (select count(*) from public.notifications where player_id = :a and type_key = 'job_application') = 1
  and (select title from public.notifications where player_id = :a and type_key = 'job_application') = 'Fritz_Freund hat sich beworben'
  and (select body from public.notifications where player_id = :a and type_key = 'job_application') = 'Stelle: Werkstudium Feed'
  and (select payload ->> 'application_id' from public.notifications where player_id = :a and type_key = 'job_application') = :'app'
  and not exists (select 1 from public.notifications where player_id = :b and type_key = 'job_application'),
  'job_application: the founder is notified of a new application (German title, posting in the body)');

-- =============================================================================
-- D. job_started from a signed contract (Clara, AI company)
-- =============================================================================
insert into public.player_skill_points (player_id, free_points) values (:c, 6)
on conflict (player_id) do update set free_points = 6;
select tests.login_as('authenticated', :c);
select public.learn_skill(gen_random_uuid(), 'it_basics') is not null as ok \gset
select x ->> 'id' as cjob, x ->> 'salary_cents_per_hour' as cwage
  from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean
 order by x ->> 'id' limit 1 \gset
select public.apply_for_job(gen_random_uuid(), :'cjob', :cwage, null) is not null as ok \gset
select public.sign_contract(gen_random_uuid(),
  (select a.id from public.job_applications a where a.player_id = :c and a.status = 'offered' order by a.created_at limit 1),
  'M2 14 C6 4 10 4 14 12') is not null as ok \gset
reset role;
select tests.assert(
  (tests.feed_item(:c, 'job_started')).payload ?& array['company_name', 'title', 'title_key']
  and (tests.feed_item(:c, 'job_started')).payload ->> 'company_name'
      = (select c.name from public.player_jobs j join public.companies c on c.id = j.company_id where j.player_id = :c and j.status = 'active')
  and (tests.feed_item(:c, 'job_started')).payload ->> 'title'
      = (select j.title from public.player_jobs j where j.player_id = :c and j.status = 'active'),
  'job_started {company_name, title, title_key} when a contract is signed');

-- =============================================================================
-- E. big_trade: a sell that realises >= 1 000 EUR and >= 15 %
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), 'VLT', 'buy', 'market', null, null, 2000000) is not null as ok \gset
reset role;
select p.quantity_e6 as vq from public.positions p join public.securities s on s.id = p.security_id
 where p.player_id = :a and s.ticker = 'VLT' and p.status = 'open' \gset
select tests.move_quote('VLT', 1.30);
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), 'VLT', 'sell', 'market', :vq / 2) is not null as ok \gset
reset role;
select tests.move_quote('VLT', 0.80);
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), 'VLT', 'sell', 'market', :vq - :vq / 2) as small_sell \gset
reset role;
select tests.move_quote('VLT', 1 / 1.04);
select t.realized_pnl_cents as pnl, t.gross_cents - t.fee_cents - t.realized_pnl_cents as cost, t.id as tid
  from public.trades t join public.securities s on s.id = t.security_id
 where t.player_id = :a and s.ticker = 'VLT' and t.side = 'sell' order by t.executed_at limit 1 \gset
select tests.assert(
  (select count(*) from public.feed_items where actor_id = :a and kind = 'big_trade') = 1
  and (tests.feed_item(:a, 'big_trade')).payload
      = jsonb_build_object('ticker', 'VLT', 'security_name', (select name from public.securities where ticker = 'VLT'),
                           'profit_cents', :pnl, 'profit_bps', public.div_round_half_even(:pnl::numeric * 10000, :cost))
  and (tests.feed_item(:a, 'big_trade')).dedupe_key = 'big_trade:' || :'tid'
  and :pnl >= 100000,
  'big_trade {ticker, security_name, profit_cents, profit_bps} for the +30 % sell; the +4 % sell posts nothing');

-- =============================================================================
-- F. Artworks: created, outbid notification, won (>= 10 000 EUR); home and car
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.create_artwork(gen_random_uuid(), 'Feed im Morgenrot', tests.art()) #>> '{artwork,id}' as art \gset
reset role;
select tests.assert(
  (tests.feed_item(:a, 'art_created')).payload
    = jsonb_build_object('title', 'Feed im Morgenrot', 'code', (select public.artwork_code(serial) from public.artworks where id = :'art')),
  'art_created {title, code} for a painted artwork');

insert into public.artwork_auctions (artwork_id, by_gallery, start_cents, ends_at)
select a.id, true, 1000000, public.game_now() + interval '6 hours'
  from public.artworks a
 where a.owner_id is null and a.origin = 'game'
   and not exists (select 1 from public.artwork_auctions x where x.artwork_id = a.id and x.status = 'open')
 order by a.serial desc limit 1
returning id as au, artwork_id as gart \gset
select tests.login_as('authenticated', :c);
select public.bid_artwork(gen_random_uuid(), :'au', 1000000) is not null as ok \gset
select public.bid_artwork(gen_random_uuid(), :'au', 1100000) is not null as ok \gset
reset role;
select count(*) as ob0 from public.notifications where player_id = :c and type_key = 'art_outbid' \gset
select tests.login_as('authenticated', :a);
select public.bid_artwork(gen_random_uuid(), :'au', 1200000) is not null as ok \gset
reset role;
select tests.end_auction(:'au') is not null as ok \gset
select tests.assert(
  :ob0 = 0
  and (select count(*) from public.notifications where player_id = :c and type_key = 'art_outbid') = 1
  and (select title from public.notifications where player_id = :c and type_key = 'art_outbid') = 'Feli_Feed hat dich überboten'
  and (select body from public.notifications where player_id = :c and type_key = 'art_outbid') like '%neues Gebot 12.000 NX'
  and (select (payload ->> 'amount_cents')::bigint from public.notifications where player_id = :c and type_key = 'art_outbid') = 1200000
  and (tests.feed_item(:a, 'art_won')).payload
      = jsonb_build_object('title', (select title from public.artworks where id = :'gart'),
                           'code', (select public.artwork_code(serial) from public.artworks where id = :'gart'), 'price_cents', 1200000),
  'art_outbid: only the previous leader, not when raising the own bid; art_won {title, code, price_cents} for the winner');

select tests.login_as('authenticated', :a);
select public.buy_home(gen_random_uuid(), 'flat') is not null as ok \gset
reset role;
insert into public.player_cars (player_id, car_key, slot, price_paid_cents) values (:a, 'car_city', 0, 900000), (:a, 'car_classic', 1, 14000000);
select tests.assert(
  (tests.feed_item(:a, 'home_bought')).payload = '{"tier": "flat"}'::jsonb
  and (select count(*) from public.feed_items where actor_id = :a and kind = 'car_bought') = 1
  and (tests.feed_item(:a, 'car_bought')).payload = '{"car_key": "car_classic", "price_cents": 14000000}'::jsonb,
  'home_bought {tier}; car_bought {car_key, price_cents} only from 100 000 EUR');

-- =============================================================================
-- G. streak milestones
-- =============================================================================
insert into public.login_streaks (player_id, current_streak, last_login_day) values (:a, 5, current_date)
on conflict (player_id) do update set current_streak = 5;
update public.login_streaks set current_streak = 6 where player_id = :a;
update public.login_streaks set current_streak = 7 where player_id = :a;
update public.login_streaks set current_streak = 7, longest_streak = 7 where player_id = :a;
select tests.assert(
  (select count(*) from public.feed_items where actor_id = :a and kind = 'streak') = 1
  and (tests.feed_item(:a, 'streak')).payload = '{"days": 7}'::jsonb,
  'streak {days} once when the streak reaches a milestone (7), not for 6');

-- =============================================================================
-- H. get_feed: own + accepted friends, newest first, pagination, deactivated actors left out
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.get_feed() as fb \gset
select public.get_feed(null, 3) as p1 \gset
select public.get_feed((:'p1'::jsonb ->> 'next_before')::bigint, 3) as p2 \gset
select public.get_feed(null, 500) as fbig \gset
reset role;
select tests.login_as('authenticated', :c);
select public.get_feed() as fc \gset
reset role;
select tests.assert(
  (select array_agg((x ->> 'id')::bigint order by o) from jsonb_array_elements(:'fb'::jsonb -> 'items') with ordinality t(x, o))
    = (select array_agg(id order by id desc) from public.feed_items where actor_id in (:a, :b))
  and :'fb'::jsonb -> 'next_before' = 'null'::jsonb
  and not exists (select 1 from jsonb_array_elements(:'fb'::jsonb -> 'items') x where x -> 'actor' ->> 'nickname' = 'Clara_Fremd')
  and (select array_agg(y -> 'actor' ->> 'nickname') from jsonb_array_elements(:'fc'::jsonb -> 'items') y) <@ array['Clara_Fremd']
  and jsonb_array_length(:'fc'::jsonb -> 'items') = (select count(*) from public.feed_items where actor_id = :c),
  'get_feed: own and friends'' items newest first, no strangers; a player without friends sees only own items');
select tests.assert(
  jsonb_array_length(:'p1'::jsonb -> 'items') = 3
  and (:'p1'::jsonb ->> 'next_before')::bigint = (:'p1'::jsonb -> 'items' -> 2 ->> 'id')::bigint
  and jsonb_array_length(:'p2'::jsonb -> 'items') = 3
  and (:'p2'::jsonb -> 'items' -> 0 ->> 'id')::bigint < (:'p1'::jsonb ->> 'next_before')::bigint
  and (:'p2'::jsonb -> 'items' -> 0) = (:'fb'::jsonb -> 'items' -> 3)
  and jsonb_array_length(:'fbig'::jsonb -> 'items') = least(50, jsonb_array_length(:'fb'::jsonb -> 'items')),
  'get_feed: keyset pagination by id (next_before = last id of a full page), limit capped at 50');

select x as fx from jsonb_array_elements(:'fb'::jsonb -> 'items') x where x ->> 'kind' = 'level_up' and x -> 'actor' ->> 'nickname' = 'Feli_Feed' \gset
select tests.assert(
  :'fx'::jsonb ?& array['id', 'kind', 'payload', 'created_at', 'is_me', 'actor', 'reactions', 'reacted']
  and :'fx'::jsonb -> 'actor' = jsonb_build_object('nickname', 'Feli_Feed', 'tag', (select tag from public.profiles where id = :a),
                                                   'avatar_key', 'rookie', 'level', 16)
  and not (:'fx'::jsonb ->> 'is_me')::boolean and (:'fx'::jsonb ->> 'reactions')::int = 0 and not (:'fx'::jsonb ->> 'reacted')::boolean
  and (select bool_and((x ->> 'is_me')::boolean = (x -> 'actor' ->> 'nickname' = 'Fritz_Freund'))
         from jsonb_array_elements(:'fb'::jsonb -> 'items') x),
  'FEED_ITEM: id, kind, payload, created_at, is_me, actor {nickname, tag, avatar_key, level}, reactions, reacted');

update public.profiles set is_deactivated = true where id = :a;
select tests.login_as('authenticated', :b);
select public.get_feed() as fbd \gset
reset role;
update public.profiles set is_deactivated = false where id = :a;
select tests.assert(
  not exists (select 1 from jsonb_array_elements(:'fbd'::jsonb -> 'items') x where x -> 'actor' ->> 'nickname' = 'Feli_Feed')
  and jsonb_array_length(:'fbd'::jsonb -> 'items') > 0,
  'get_feed: items of a deactivated player are left out');

-- =============================================================================
-- I. react_feed: toggle, notification once per (item, reactor), visibility, preferences
-- =============================================================================
select (:'fx'::jsonb ->> 'id')::bigint as item \gset
select (tests.feed_item(:c, 'level_up')).id as citem \gset
select (tests.feed_item(:b, 'friends_now')).id as bitem \gset
select tests.login_as('authenticated', :b);
select public.react_feed(:rq, :item) as r1 \gset
select public.react_feed(:rq, :item) as r1b \gset
select public.react_feed(gen_random_uuid(), :item) as r2 \gset
select public.react_feed(gen_random_uuid(), :item) as r3 \gset
select public.react_feed(gen_random_uuid(), :bitem) as rown \gset
select tests.throws_key(format('select public.react_feed(gen_random_uuid(), %s)', :citem), 'feed_item_not_found',
  'react_feed(): not on items of strangers');
select tests.throws_key('select public.react_feed(gen_random_uuid(), -1)', 'feed_item_not_found', 'react_feed(): unknown item');
select tests.throws_key('select public.react_feed(gen_random_uuid(), null)', 'invalid_argument', 'react_feed(): item required');
reset role;
select tests.assert(
  :'r1'::jsonb -> 'item' ->> 'id' = :'item' and (:'r1'::jsonb -> 'item' ->> 'reactions')::int = 1
  and (:'r1'::jsonb -> 'item' ->> 'reacted')::boolean and :'r1b'::jsonb = :'r1'::jsonb
  and (:'r2'::jsonb -> 'item' ->> 'reactions')::int = 0 and not (:'r2'::jsonb -> 'item' ->> 'reacted')::boolean
  and (:'r3'::jsonb -> 'item' ->> 'reactions')::int = 1
  and (select count(*) from public.feed_reactions where item_id = :item) = 1
  and (:'rown'::jsonb -> 'item' ->> 'reacted')::boolean and (:'rown'::jsonb -> 'item' ->> 'is_me')::boolean,
  'react_feed(): toggles (idempotent per request_id), returns {item}; own items can be liked');
select tests.assert(
  (select count(*) from public.notifications where player_id = :a and type_key = 'feed_reaction') = 1
  and (select title from public.notifications where player_id = :a and type_key = 'feed_reaction') = 'Fritz_Freund gefällt dein Beitrag'
  and (select body from public.notifications where player_id = :a and type_key = 'feed_reaction') = 'Level 15 erreicht'
  and (select link from public.notifications where player_id = :a and type_key = 'feed_reaction') = '/friends'
  and not exists (select 1 from public.notifications where player_id = :b and type_key = 'feed_reaction'),
  'feed_reaction: the actor is notified once per (item, reactor) although the reaction was toggled; none for own items');

-- switched off: no notification
insert into public.notification_preferences (player_id, type_key, in_app_enabled) values (:a, 'feed_reaction', false)
on conflict (player_id, type_key) do update set in_app_enabled = false;
select (tests.feed_item(:a, 'company_founded')).id as item2 \gset
select tests.login_as('authenticated', :b);
select public.react_feed(gen_random_uuid(), :item2) is not null as ok \gset
reset role;
select tests.assert(
  (select count(*) from public.notifications where player_id = :a and type_key = 'feed_reaction') = 1
  and (select count(*) from public.feed_reactions where item_id = :item2) = 1,
  'feed_reaction respects notification_preferences (switched off: reaction counted, no notification)');
update public.notification_preferences set in_app_enabled = true where player_id = :a and type_key = 'feed_reaction';

-- =============================================================================
-- J. get_notifications / mark_notifications_read
-- =============================================================================
insert into public.notifications (player_id, type_key, title, expires_at) values (:a, 'system', 'Abgelaufen', now() - interval '1 minute');
insert into public.notifications (player_id, type_key, title, body, created_at)
values (:a, 'system', 'Alt', 'Ganz alt', now() - interval '1 day');
select tests.login_as('authenticated', :a);
select public.get_notifications() as n1 \gset
select public.get_notifications(1) as n1l \gset
select public.mark_notifications_read(array[(select id from public.notifications where player_id = :a and type_key = 'feed_reaction'),
                                            (select id from public.notifications where player_id = :c and type_key = 'art_outbid')]) as m1 \gset
select public.mark_notifications_read(array[(select id from public.notifications where player_id = :a and type_key = 'feed_reaction')]) as m1b \gset
select public.get_notifications() as n2 \gset
select public.mark_notifications_read() as m2 \gset
select public.mark_notifications_read(null) as m2b \gset
reset role;
select tests.assert(
  (:'n1'::jsonb ->> 'unread')::int = jsonb_array_length(:'n1'::jsonb -> 'items')
  and (:'n1'::jsonb ->> 'unread')::int = (select count(*) from public.notifications where player_id = :a and (expires_at is null or expires_at > now()))
  and not exists (select 1 from jsonb_array_elements(:'n1'::jsonb -> 'items') x where x ->> 'title' = 'Abgelaufen')
  and :'n1'::jsonb -> 'items' -> 0 ?& array['id', 'type_key', 'title', 'body', 'link', 'payload', 'created_at', 'read_at']
  and :'n1'::jsonb #>> '{items,-1,title}' = 'Alt'
  and (select bool_and(x ->> 'type_key' <> 'art_outbid') from jsonb_array_elements(:'n1'::jsonb -> 'items') x)
  and jsonb_array_length(:'n1l'::jsonb -> 'items') = 1 and :'n1l'::jsonb -> 'items' -> 0 = :'n1'::jsonb -> 'items' -> 0,
  'get_notifications(): only mine, not expired, newest first, with unread count and limit');
select tests.assert(
  (:'m1'::jsonb ->> 'unread')::int = (:'n1'::jsonb ->> 'unread')::int - 1 and :'m1b'::jsonb = :'m1'::jsonb
  and (select read_at is null from public.notifications where player_id = :c and type_key = 'art_outbid')
  and (select x ->> 'read_at' from jsonb_array_elements(:'n2'::jsonb -> 'items') x where x ->> 'type_key' = 'feed_reaction') is not null
  and :'m2'::jsonb = '{"unread": 0}'::jsonb and :'m2b'::jsonb = '{"unread": 0}'::jsonb,
  'mark_notifications_read(): only own ids, idempotent; null marks all -> {unread}');

-- =============================================================================
-- K. Clean-up of old items (social_run_due, keepDays 30) and the empty feed
-- =============================================================================
update public.feed_items set created_at = now() - interval '31 days' where id = :citem;
update public.league_seasons set refreshed_at = null where week_start = public.league_week_start(public.game_now());
select public.social_run_due() as sr \gset
select tests.signup('07607607-0000-4000-8000-0000000000d4', 'Dora_Leer') is not null as ok \gset
select tests.login_as('authenticated', '07607607-0000-4000-8000-0000000000d4');
select public.get_feed() as fe \gset
reset role;
select tests.assert(
  not exists (select 1 from public.feed_items where id = :citem) and (:'sr'::jsonb ->> 'feed_deleted')::int >= 1
  and :'fe'::jsonb = '{"items": [], "next_before": null}'::jsonb,
  'feed items older than keepDays are deleted by social_run_due(); empty feed shape');
