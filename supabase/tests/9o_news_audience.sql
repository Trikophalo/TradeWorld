-- =============================================================================
-- 9o · The studio audience of NEXA Nachrichten and players on the TV with their figure (ADR-157)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set m '''09a0d1e0-0000-4000-8000-0000000000a1'''
\set f '''09a0d1e0-0000-4000-8000-0000000000b1'''
\set s '''09a0d1e0-0000-4000-8000-0000000000c1'''
\set o '''09a0d1e0-0000-4000-8000-0000000000d1'''
\set x '''09a0d1e0-0000-4000-8000-0000000000e1'''
update public.invite_codes set max_uses = max_uses + 5 where code = 'M1-TESTS';
select tests.signup(:m, 'Pub_Mila') is not null and tests.signup(:f, 'Pub_Fritz') is not null
   and tests.signup(:s, 'Pub_Sven') is not null and tests.signup(:o, 'Pub_Olga') is not null
   and tests.signup(:x, 'Pub_Xaver') is not null as ok \gset
update public.profiles set avatar_key = 'punk' where id = :f;
insert into public.friendships (requester_id, addressee_id, status, responded_at) values (:f, :m, 'accepted', now());
insert into public.player_accessories (player_id, accessory_key, price_paid_cents) values (:f, 'party_hat', 0), (:f, 'beanie', 0);
insert into public.player_accessories_worn (player_id, slot, accessory_key) values (:f, 'head', 'party_hat');

select tests.assert(
  public.player_figure_json(:f) = jsonb_build_object('nickname', 'Pub_Fritz', 'avatar_key', 'punk',
                                                      'accessories', '["party_hat"]'::jsonb)
  and public.player_figure_json('00000000-0000-4000-8000-000000000000') is null,
  'player_figure_json(): nickname, portrait and worn accessories; null for nobody');
select tests.assert(
  not has_function_privilege('authenticated', 'public.player_figure_json(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.news_show_audience_json(uuid)', 'execute'),
  'the helpers are internal');

-- A show that aired a minute ago: a loser (the friend), gossip (a stranger), an NFT without a known creator
delete from public.news_shows;
delete from public.news_show_messages;
delete from public.news_show_viewers;
insert into public.news_shows (airs_at, status, started_at, segments)
values (date_trunc('hour', public.game_now()), 'aired', public.game_now() - interval '1 minute',
        jsonb_build_array(
          jsonb_build_object('kind', 'loser', 'mood', 'laughing', 'headline', 'Pub_Fritz verliert', 'text', 'Autsch.',
                             'effects', '[]'::jsonb, 'apply', '[]'::jsonb,
                             'subject', jsonb_build_object('type', 'player', 'player_id', :f, 'name', 'Pub_Fritz')),
          jsonb_build_object('kind', 'gossip', 'mood', 'smug', 'headline', 'Pub_Xaver zieht um', 'text', 'Ach.',
                             'effects', '[]'::jsonb, 'apply', '[]'::jsonb,
                             'subject', jsonb_build_object('type', 'player', 'player_id', :x, 'name', 'Pub_Xaver')),
          jsonb_build_object('kind', 'nft', 'mood', 'confused', 'headline', 'Ein Bild', 'text', 'Teuer.',
                             'effects', '[]'::jsonb, 'apply', '[]'::jsonb,
                             'subject', jsonb_build_object('type', 'nft', 'name', 'Unbekannt'))));
-- Who watches: the friend and the stranger now, Olga long ago, Xaver now but deactivated
insert into public.news_show_viewers (player_id, seen_at) values
  (:s, public.game_now() - interval '2 seconds'), (:f, public.game_now() - interval '5 seconds'),
  (:o, public.game_now() - interval '5 minutes'), (:x, public.game_now() - interval '1 second');
update public.profiles set is_deactivated = true where id = :x;
insert into public.news_show_messages (player_id, bot_name, body, created_at)
values (null, 'Jürgen Test', 'Unverschämt!', public.game_now() - interval '3 seconds'),
       (:f, null, 'Hallo Mila 👋', public.game_now() - interval '2 seconds');

select tests.login_as('authenticated', :m);
select public.get_news_show() as v \gset
reset role;

select tests.assert(
  jsonb_array_length(:'v'::jsonb -> 'audience') = 3
  and :'v'::jsonb -> 'audience' -> 0 ->> 'nickname' = 'Pub_Mila' and (:'v'::jsonb -> 'audience' -> 0 ->> 'me')::boolean
  and not (:'v'::jsonb -> 'audience' -> 0 ->> 'friend')::boolean
  and :'v'::jsonb -> 'audience' -> 1 = jsonb_build_object('nickname', 'Pub_Fritz', 'avatar_key', 'punk',
                                                         'accessories', '["party_hat"]'::jsonb, 'friend', true, 'me', false)
  and :'v'::jsonb -> 'audience' -> 2 ->> 'nickname' = 'Pub_Sven'
  and not (:'v'::jsonb -> 'audience' -> 2 ->> 'friend')::boolean and not (:'v'::jsonb -> 'audience' -> 2 ->> 'me')::boolean,
  'audience: me first, then friends with their figure, then the others; no one who left or is deactivated');
select tests.assert(
  (select bool_and(c ? 'bot') from jsonb_array_elements(:'v'::jsonb -> 'chat') c)
  and (select (c ->> 'bot')::boolean from jsonb_array_elements(:'v'::jsonb -> 'chat') c where c ->> 'nickname' = 'Jürgen Test')
  and not (select (c ->> 'bot')::boolean from jsonb_array_elements(:'v'::jsonb -> 'chat') c where c ->> 'nickname' = 'Pub_Fritz'),
  'chat: lines of the made-up viewers are marked as bot');
select tests.assert(
  :'v'::jsonb -> 'show' -> 'segments' -> 0 -> 'figure' = jsonb_build_object('nickname', 'Pub_Fritz', 'avatar_key', 'punk',
                                                                           'accessories', '["party_hat"]'::jsonb)
  and not (:'v'::jsonb -> 'show' -> 'segments' -> 1) ? 'figure'
  and not (:'v'::jsonb -> 'show' -> 'segments' -> 2) ? 'figure'
  and not (:'v'::jsonb -> 'show' -> 'segments' -> 0) ? 'subject',
  'segments about a player carry their figure (none for a deactivated player or an unknown creator)');
select tests.assert(
  :'v'::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  and :'v'::text not like '%player_id%',
  'no player id leaks from the audience, the chat or the segments');

-- The friend changes clothes: the next fetch shows the current look, in the audience and on the TV
update public.player_accessories_worn set accessory_key = 'beanie' where player_id = :f and slot = 'head';
select tests.login_as('authenticated', :m);
select public.get_news_show() as v2 \gset
reset role;
select tests.assert(
  :'v2'::jsonb -> 'show' -> 'segments' -> 0 -> 'figure' -> 'accessories' = '["beanie"]'::jsonb
  and :'v2'::jsonb -> 'audience' -> 1 -> 'accessories' = '["beanie"]'::jsonb,
  'the figure is read when the show is fetched: always the current accessories');

-- The friend sees Mila as a friend, and the cap holds
select tests.set_cfg('newsShow', '{audience,max}', '2');
select tests.login_as('authenticated', :f);
select public.get_news_show() as v3 \gset
reset role;
select tests.assert(
  jsonb_array_length(:'v3'::jsonb -> 'audience') = 2
  and :'v3'::jsonb -> 'audience' -> 0 ->> 'nickname' = 'Pub_Fritz' and (:'v3'::jsonb -> 'audience' -> 0 ->> 'me')::boolean
  and :'v3'::jsonb -> 'audience' -> 1 ->> 'nickname' = 'Pub_Mila' and (:'v3'::jsonb -> 'audience' -> 1 ->> 'friend')::boolean
  and (:'v3'::jsonb ->> 'viewers')::int >= 3,
  'audience: friendship works both ways; at most newsShow.audience.max figures, the count stays complete');
select tests.set_cfg('newsShow', '{audience,max}', '12');

update public.profiles set is_deactivated = false where id = :x;
delete from public.news_shows;
delete from public.news_show_messages;
delete from public.news_show_viewers;
