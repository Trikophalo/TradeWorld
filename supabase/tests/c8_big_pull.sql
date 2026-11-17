-- =============================================================================
-- c8 · Nexamon: a pull above nexamon.bigPullNotifyCents notifies every other active player once (ADR-186); below
--      the threshold, AI pulls and One of Ones do not; one opening with several big pulls makes one notification;
--      at most one broadcast per puller every bigPullNotifySeconds.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0c8c8c8c-0000-4000-8000-0000000000a1'''
\set b '''0c8c8c8c-0000-4000-8000-0000000000b1'''
\set c '''0c8c8c8c-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Bp_Anna') is not null and tests.signup(:b, 'Bp_Bruno') is not null
   and tests.signup(:c, 'Bp_Clara') is not null as ok \gset
select public.nexamon_sync(public.game_now()) is not null as ok \gset

select card_key as big1 from public.nexamon_cards where set_key = 'mystic_energy' and rarity = 'rare' order by number limit 1 \gset
select card_key as big2 from public.nexamon_cards where set_key = 'mystic_energy' and rarity = 'rare' order by number offset 1 limit 1 \gset
select card_key as small from public.nexamon_cards where set_key = 'mystic_energy' and rarity = 'common' order by number limit 1 \gset
select (value ->> 'bigPullNotifyCents')::bigint as min, (value ->> 'bigPullNotifySeconds')::integer as secs
  from public.game_config where key = 'nexamon' \gset
select tests.assert(:min = 10000000 and :secs = 60, 'c8: config bigPullNotifyCents / bigPullNotifySeconds');

select (select value_e4 from public.nexamon_cards where card_key = :'big1') as v1,
       (select value_e4 from public.nexamon_cards where card_key = :'big2') as v2,
       (select value_e4 from public.nexamon_cards where card_key = :'small') as v3 \gset
-- big1 and big2 far above the threshold in any condition, small below it
update public.nexamon_cards set value_e4 = 100000000000 where card_key in (:'big1', :'big2');
update public.nexamon_cards set value_e4 = 1000000 where card_key = :'small';

create or replace function tests.bp_count(p_player uuid) returns bigint language sql security definer as $$
  select count(*) from public.notifications where player_id = p_player and type_key = 'nexamon_big_pull' $$;
create or replace function tests.bp_total() returns bigint language sql security definer as $$
  select count(*) from public.notifications where type_key = 'nexamon_big_pull' $$;
grant execute on all functions in schema tests to public;

select tests.bp_total() as before \gset

-- 1. below the threshold: nothing
select public.nexamon_mint_copy(:'small', :a, null, 'mint', 'pack', gen_random_uuid(), public.game_now()) is not null as ok \gset
select tests.assert(tests.bp_total() = :before, 'c8: a pull below the threshold notifies nobody');

-- 2. AI pull of a big card: never broadcast
select public.nexamon_mint_copy(:'big1', null, 'Karten-Kalle', 'mint', 'ai_pack', gen_random_uuid(), public.game_now()) is not null as ok \gset
select tests.assert(tests.bp_total() = :before, 'c8: an AI pull is never broadcast');

-- 3. a big pull: every other active player once, not the puller; link to the card page; feed item
select public.nexamon_mint_copy(:'big1', :a, null, 'mint', 'pack', gen_random_uuid(), public.game_now()) is not null as ok \gset
select tests.assert(tests.bp_count(:a) = 0, 'c8: the puller gets no notification');
select tests.assert(tests.bp_count(:b) = 1 and tests.bp_count(:c) = 1, 'c8: every other player is notified once');
select tests.assert(
  (select count(*) from public.notifications where type_key = 'nexamon_big_pull' and player_id = :b
      and link = '/nexamon/' || :'big1' and body like 'Bp_Anna hat % gezogen – Wert %!') = 1,
  'c8: text and link of the notification');
select tests.assert(
  (select count(*) from public.feed_items where actor_id = :a and kind = 'nexamon_big_pull') = 1,
  'c8: the big pull posts a feed item');

-- 4. rate limit: a second big pull within bigPullNotifySeconds is not broadcast again
select public.nexamon_mint_copy(:'big2', :a, null, 'mint', 'pack', gen_random_uuid(), public.game_now() + interval '10 seconds') is not null as ok \gset
select tests.assert(tests.bp_count(:b) = 1, 'c8: at most one broadcast per puller per minute');

-- 5. one opening with two big pulls (one transaction), later: one combined notification
select public.nexamon_mint_copy(:'big1', :b, null, 'mint', 'pack', p, public.game_now() + interval '2 minutes') is not null
   and public.nexamon_mint_copy(:'big2', :b, null, 'mint', 'pack', p, public.game_now() + interval '2 minutes') is not null as ok
  from (select gen_random_uuid() as p) x \gset
select tests.assert(tests.bp_count(:a) = 1 and tests.bp_count(:c) = 2 and tests.bp_count(:b) = 1,
                    'c8: several big pulls in one opening make one notification each');
select tests.assert(
  (select (payload ->> 'count')::integer = 2 and body like 'Bp_Bruno hat 2 Karten über 100.000 € gezogen, darunter %'
     from public.notifications where type_key = 'nexamon_big_pull' and player_id = :c and payload ->> 'nickname' = 'Bp_Bruno'),
  'c8: the combined notification counts both cards');

-- 6. after the minute the puller broadcasts again
select public.nexamon_mint_copy(:'big2', :a, null, 'mint', 'pack', gen_random_uuid(), public.game_now() + interval '5 minutes') is not null as ok \gset
select tests.assert(tests.bp_count(:b) = 2, 'c8: after bigPullNotifySeconds the next big pull broadcasts again');

-- 7. a copy given outside a pack (no pack id) is no pull
select public.nexamon_mint_copy(:'big1', :c, null, 'mint', 'pack', null, public.game_now() + interval '10 minutes') is not null as ok \gset
select tests.assert(tests.bp_count(:a) = 1, 'c8: a copy without a pack is not broadcast');

-- the card values back (later scripts read them)
update public.nexamon_cards set value_e4 = case card_key when :'big1' then :v1 when :'big2' then :v2 else :v3 end
 where card_key in (:'big1', :'big2', :'small');

\echo c8 big pull: ok
