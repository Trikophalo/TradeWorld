-- =============================================================================
-- 73 · M4c: friends (ADR-084)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''07307307-0000-4000-8000-0000000000f1'''
\set g '''07307307-0000-4000-8000-0000000000f2'''
\set h '''07307307-0000-4000-8000-0000000000f3'''
\set rq '''07307307-0000-4000-8000-0000000000a1'''
select tests.signup(:f, 'Fiona_Freund') is not null and tests.signup(:g, 'Gustav_Gegen') is not null
   and tests.signup(:h, 'Hilde_Hallo') is not null as ok \gset
select tests.set_level(:g, 7);

-- =============================================================================
-- A. Request, counter request accepts at once
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.get_friends() as e0 \gset
select public.send_friend_request(:rq, 'gustav_gegen') as r1 \gset
select public.send_friend_request(:rq, 'gustav_gegen') as r1b \gset
select public.send_friend_request(gen_random_uuid(), 'Gustav_Gegen') as r1c \gset
select tests.throws_key($$select public.send_friend_request(gen_random_uuid(), 'Niemand_Da')$$, 'player_not_found',
  'send_friend_request(): unknown nickname');
select tests.throws_key($$select public.send_friend_request(gen_random_uuid(), 'FIONA_FREUND')$$, 'invalid_argument',
  'send_friend_request(): not to oneself');
select tests.throws_key($$select public.respond_friend_request(gen_random_uuid(), 'Gustav_Gegen', true)$$, 'invalid_argument',
  'respond_friend_request(): only the addressee of an open request');
reset role;
select tests.assert(
  :'e0'::jsonb = '{"friends": [], "incoming": [], "outgoing": []}'::jsonb
  and jsonb_array_length(:'r1'::jsonb -> 'outgoing') = 1
  and :'r1'::jsonb -> 'outgoing' -> 0 ->> 'nickname' = 'Gustav_Gegen' and (:'r1'::jsonb -> 'outgoing' -> 0 ->> 'level')::int = 7
  and (:'r1'::jsonb -> 'outgoing' -> 0) ? 'at'
  and :'r1'::jsonb = :'r1b'::jsonb and :'r1c'::jsonb = :'r1'::jsonb
  and (select count(*) from public.friendships where requester_id = :f and addressee_id = :g and status = 'pending') = 1
  and (select count(*) from public.notifications where player_id = :g and type_key = 'friend_request') = 1,
  'send_friend_request(): case-insensitive nickname, FRIENDS shape, idempotent; a second request changes nothing; notification');

select tests.login_as('authenticated', :g);
select public.get_friends() as g0 \gset
select public.send_friend_request(gen_random_uuid(), 'Fiona_Freund') as g1 \gset
reset role;
select tests.assert(
  :'g0'::jsonb -> 'incoming' -> 0 ->> 'nickname' = 'Fiona_Freund' and jsonb_array_length(:'g0'::jsonb -> 'outgoing') = 0
  and :'g1'::jsonb -> 'friends' -> 0 ->> 'nickname' = 'Fiona_Freund' and (:'g1'::jsonb -> 'friends' -> 0) ? 'since'
  and jsonb_array_length(:'g1'::jsonb -> 'incoming') = 0
  and public.are_friends(:f, :g)
  and (select count(*) from public.notifications where player_id = :f and type_key = 'friend_accepted') = 1,
  'a counter request makes the friendship at once; the requester is notified');

-- =============================================================================
-- B. Decline deletes, a new request is possible, accept
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.send_friend_request(gen_random_uuid(), 'Hilde_Hallo') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :h);
select public.respond_friend_request(gen_random_uuid(), 'fiona_freund', false) as d1 \gset
select tests.throws_key($$select public.respond_friend_request(gen_random_uuid(), 'Fiona_Freund', true)$$, 'invalid_argument',
  'respond_friend_request(): no open request any more');
reset role;
select tests.login_as('authenticated', :f);
select public.get_friends() as f1 \gset
select public.send_friend_request(gen_random_uuid(), 'Hilde_Hallo') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :h);
select public.respond_friend_request(gen_random_uuid(), 'Fiona_Freund', true) as a1 \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_friends() as f2 \gset
reset role;
select tests.assert(
  :'d1'::jsonb = '{"friends": [], "incoming": [], "outgoing": []}'::jsonb
  and jsonb_array_length(:'f1'::jsonb -> 'outgoing') = 0
  and :'a1'::jsonb -> 'friends' -> 0 ->> 'nickname' = 'Fiona_Freund'
  and (select array_agg(x ->> 'nickname' order by o) from jsonb_array_elements(:'f2'::jsonb -> 'friends') with ordinality t(x, o))
      = array['Gustav_Gegen', 'Hilde_Hallo'],
  'declining deletes the request; a new request can be accepted; friends sorted by nickname');

-- a declined row (older data) may be requested again by either side
select tests.login_as('authenticated', :f);
select public.remove_friend(gen_random_uuid(), 'Hilde_Hallo') is not null as ok \gset
reset role;
insert into public.friendships (requester_id, addressee_id, status) values (:h, :f, 'declined');
select tests.login_as('authenticated', :f);
select public.send_friend_request(gen_random_uuid(), 'Hilde_Hallo') as f3 \gset
reset role;
select tests.assert(
  :'f3'::jsonb -> 'outgoing' -> 0 ->> 'nickname' = 'Hilde_Hallo'
  and (select requester_id = :f and status = 'pending' from public.friendships
        where least(requester_id, addressee_id) = least(:f::uuid, :h::uuid)
          and greatest(requester_id, addressee_id) = greatest(:f::uuid, :h::uuid)),
  'send_friend_request(): a declined row becomes a new request with the sender as requester');

-- =============================================================================
-- C. Remove a friend, withdraw a request
-- =============================================================================
select tests.login_as('authenticated', :h);
select public.remove_friend(gen_random_uuid(), 'Fiona_Freund') as h1 \gset
reset role;
select tests.login_as('authenticated', :f);
select public.remove_friend(gen_random_uuid(), 'Hilde_Hallo') as f4 \gset
select public.remove_friend(gen_random_uuid(), 'Gustav_Gegen') as f5 \gset
reset role;
select tests.login_as('authenticated', :g);
select public.get_friends() as g2 \gset
reset role;
select tests.assert(
  jsonb_array_length(:'h1'::jsonb -> 'incoming') = 1
  and jsonb_array_length(:'f4'::jsonb -> 'outgoing') = 0
  and :'f5'::jsonb = '{"friends": [], "incoming": [], "outgoing": []}'::jsonb
  and :'g2'::jsonb = '{"friends": [], "incoming": [], "outgoing": []}'::jsonb
  and not public.are_friends(:f, :g)
  and (select count(*) from public.friendships where :f in (requester_id, addressee_id)) = 0,
  'remove_friend(): the addressee cannot withdraw a request (decline instead); the requester can; friendships end for both');

-- RPCs only for signed-in players
select tests.login_as('anon');
select tests.throws($$select public.get_friends()$$, '42501', 'get_friends(): not for anon');
reset role;
