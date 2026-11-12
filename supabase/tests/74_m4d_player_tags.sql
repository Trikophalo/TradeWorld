-- =============================================================================
-- 74 · M4d: player tags, lookalike-free names, player search (ADR-085)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set m '''07407407-0000-4000-8000-0000000000a1'''
\set n '''07407407-0000-4000-8000-0000000000a2'''
\set o '''07407407-0000-4000-8000-0000000000a3'''
\set q '''07407407-0000-4000-8000-0000000000a4'''
-- room on the shared test invite code for the sign-ups below
update public.invite_codes set max_uses = max_uses + 50 where code = 'M1-TESTS';

-- =============================================================================
-- A. Every player has a valid, unique tag; sign-ups get one
-- =============================================================================
select tests.signup(:m, 'Mira') is not null and tests.signup(:n, 'Nepomuk_Tag') is not null as ok \gset
select tests.assert(
  (select count(*) from public.profiles) > 2
  and not exists (select 1 from public.profiles where tag is null or tag !~ '^[A-HJ-NP-Z2-9]{4}$')
  and (select count(distinct tag) = count(*) from public.profiles)
  and (select tag is not null from public.profiles where id = :m),
  'every profile (old and new) has a unique tag from the alphabet without 0/O/1/I');
select tests.throws($$update public.profiles set tag = 'K0Q1' where id = '07407407-0000-4000-8000-0000000000a1'$$, '23514',
  'tag check: 0 and 1 are not in the alphabet');
select tests.throws($$update public.profiles set tag = (select tag from public.profiles where id = '07407407-0000-4000-8000-0000000000a2')
                       where id = '07407407-0000-4000-8000-0000000000a1'$$, '23505', 'tags are unique');
select tests.assert(
  (select count(distinct public.new_player_tag()) from generate_series(1, 200)) > 150
  and (select bool_and(t ~ '^[A-HJ-NP-Z2-9]{4}$') from (select public.new_player_tag() as t from generate_series(1, 200)) x),
  'new_player_tag(): random tags from the alphabet');

select tag as m_tag from public.profiles where id = :m \gset
select tag as n_tag from public.profiles where id = :n \gset

-- =============================================================================
-- B. Lookalike names are taken (name key), different names are allowed
-- =============================================================================
select tests.assert(
  public.name_key('M1ra') = 'mira' and public.name_key('Mi_ra') = 'mira' and public.name_key('MIRA') = 'mira'
  and public.name_key('Mira2') = 'mira2' and public.name_key('Matthias') <> public.name_key('Mathias'),
  'name_key(): lower case, leet digits, underscores removed; no collapsing of repeated letters');
select tests.assert(
  public.name_violation('M1ra', 'player') = 'name_taken'
  and public.name_violation('Mi_ra', 'player') = 'name_taken'
  and public.name_violation('mira', 'player') = 'name_taken'
  and public.name_violation('M_1_R_4', 'player') = 'name_taken'
  and public.name_violation('Mira2', 'player') is null
  and public.name_violation('Miraa', 'player') is null
  and public.name_violation('M1ra', 'player', :m) is null,
  'name_violation(): lookalikes of a taken nickname are name_taken; other names and the own name are allowed');

select tests.login_as('authenticated', :n);
select tests.throws_key($$select public.change_nickname(gen_random_uuid(), 'M1ra')$$, 'name_taken',
  'change_nickname(): a lookalike of another player is refused');
select public.check_nickname('Mi_ra') as chk \gset
select public.change_nickname(gen_random_uuid(), 'Nepo_Neu') ->> 'nickname' as nn \gset
reset role;
select tests.assert(
  :'chk'::jsonb = '{"allowed": false, "reason": "name_taken"}'::jsonb
  and :'nn' = 'Nepo_Neu'
  and (select tag from public.profiles where id = :n) = :'n_tag',
  'check_nickname() reports lookalikes; the tag survives a nickname change');

-- sign-up with a lookalike gets a numeric suffix
select tests.signup(:o, 'M1ra') is not null as ok \gset
select tests.assert(
  (select nickname ~ '^M1ra[0-9]{5}$' and tag ~ '^[A-HJ-NP-Z2-9]{4}$' and tag <> :'m_tag' from public.profiles where id = :o),
  'sign-up: a lookalike nickname gets a numeric suffix, the player a tag of their own');

-- =============================================================================
-- C. Account reset keeps the tag
-- =============================================================================
select tests.login_as('authenticated', :m);
select public.reset_account(gen_random_uuid(), 'Mira') ->> 'ok' as rok \gset
select public.get_my_portfolio() as pf \gset
reset role;
select tests.assert(
  :'rok'::boolean and (select tag from public.profiles where id = :m) = :'m_tag'
  and :'pf'::jsonb ->> 'tag' = :'m_tag',
  'reset_account() keeps the tag; get_my_portfolio() shows it');

-- =============================================================================
-- D. Player card and friends by tag
-- =============================================================================
select tests.signup(:q, 'Quirin_Such') is not null as ok \gset
select tests.set_level(:q, 9);
select tag as q_tag from public.profiles where id = :q \gset
select tests.login_as('authenticated', :m);
select public.get_player_card('quirin_such') as c1 \gset
select public.get_player_card('#' || lower(:'q_tag')) as c2 \gset
select public.get_player_card(:'q_tag') as c3 \gset
select tests.throws_key($$select public.get_player_card('#ZZZZ9')$$, 'player_not_found', 'get_player_card(): no such tag');
select public.send_friend_request(gen_random_uuid(), '#' || :'q_tag') as fr \gset
select public.get_rich_list(500, 0, 'all') as rl \gset
select public.get_rich_list(500, 0, 'players') as rp \gset
reset role;
select tests.assert(
  :'c1'::jsonb ->> 'tag' = :'q_tag' and :'c1'::jsonb ->> 'nickname' = 'Quirin_Such'
  and :'c2'::jsonb = :'c1'::jsonb and :'c3'::jsonb = :'c1'::jsonb,
  'get_player_card(): carries the tag; found by nickname or by tag (with or without #, any case)');
select tests.assert(
  :'fr'::jsonb -> 'outgoing' -> 0 ->> 'nickname' = 'Quirin_Such' and :'fr'::jsonb -> 'outgoing' -> 0 ->> 'tag' = :'q_tag',
  'send_friend_request(): by tag; FRIENDS entries carry the tag');
select tests.login_as('authenticated', :q);
select public.respond_friend_request(gen_random_uuid(), :'m_tag', true) as fa \gset
reset role;
select tests.assert(
  :'fa'::jsonb -> 'friends' -> 0 ->> 'tag' = :'m_tag' and public.are_friends(:m, :q),
  'respond_friend_request(): by tag; friends carry the tag');
select tests.assert(
  (select bool_and(case when e ->> 'kind' = 'player' then e ->> 'tag' ~ '^[A-HJ-NP-Z2-9]{4}$' else e -> 'tag' = 'null'::jsonb end)
     from jsonb_array_elements(:'rl'::jsonb -> 'entries') e)
  and exists (select 1 from jsonb_array_elements(:'rl'::jsonb -> 'entries') e where e ->> 'kind' = 'tycoon')
  and exists (select 1 from jsonb_array_elements(:'rp'::jsonb -> 'entries') e where e ->> 'id' = :q and e ->> 'tag' = :'q_tag'),
  'get_rich_list(): players carry their tag, tycoons null');

-- =============================================================================
-- E. Search
-- =============================================================================
-- nine players with a common prefix, different levels; one with the name exactly
do $$
begin
  for i in 1..9 loop
    perform tests.signup(('07407407-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'Suchtest_' || i);
    perform tests.set_level(('07407407-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, i);
  end loop;
  perform tests.signup('07407407-0000-4000-8000-000000000200', 'Suchtest');
  perform tests.signup('07407407-0000-4000-8000-000000000201', 'XSuchtestX');
  perform tests.set_level('07407407-0000-4000-8000-000000000201', 40);
  perform tests.signup('07407407-0000-4000-8000-000000000202', 'Pro_zent');
end;
$$;
select tests.login_as('authenticated', :m);
select public.search_players('  suchtest ') as s1 \gset
select public.search_players('uchtest') as s2 \gset
select public.search_players('#' || :'q_tag') as s3 \gset
select public.search_players(lower(:'q_tag')) as s4 \gset
select public.search_players('s') as s5 \gset
select public.search_players('#s') as s6 \gset
select public.search_players('%') as s7 \gset
select public.search_players('%%') as s8 \gset
select public.search_players('te_t') as s9 \gset
select public.search_players('ro_') as s10 \gset
select public.search_players(null) as s11 \gset
select public.search_players(repeat('a', 65)) as s12 \gset
reset role;
select tests.assert(
  (select array_agg(x ->> 'nickname' order by o) from jsonb_array_elements(:'s1'::jsonb -> 'players') with ordinality t(x, o))
    = array['Suchtest', 'Suchtest_9', 'Suchtest_8', 'Suchtest_7', 'Suchtest_6', 'Suchtest_5', 'Suchtest_4', 'Suchtest_3'],
  'search_players(): trimmed, case-insensitive; exact match first, then prefix by level; at most 8 (contains match left out)');
select tests.assert(
  (select array_agg(x ->> 'nickname' order by o) from jsonb_array_elements(:'s2'::jsonb -> 'players') with ordinality t(x, o))
    = array['XSuchtestX', 'Suchtest_9', 'Suchtest_8', 'Suchtest_7', 'Suchtest_6', 'Suchtest_5', 'Suchtest_4', 'Suchtest_3']
  and (select array_agg(k order by k) from jsonb_object_keys(:'s2'::jsonb -> 'players' -> 0) k)
      = array['avatar_key', 'level', 'nickname', 'tag'],
  'search_players(): contains matches by level; entries {nickname, tag, level, avatar_key}');
select tests.assert(
  :'s3'::jsonb -> 'players' -> 0 ->> 'nickname' = 'Quirin_Such' and :'s3'::jsonb -> 'players' -> 0 ->> 'tag' = :'q_tag'
  and :'s4'::jsonb -> 'players' -> 0 ->> 'nickname' = 'Quirin_Such',
  'search_players(): a tag (with or without #, any case) puts its player first');
select tests.assert(
  :'s5'::jsonb = '{"players": []}'::jsonb and :'s6'::jsonb = '{"players": []}'::jsonb
  and :'s11'::jsonb = '{"players": []}'::jsonb and :'s12'::jsonb = '{"players": []}'::jsonb,
  'search_players(): fewer than 2 characters (without #), null or too long: empty list');
select tests.assert(
  :'s8'::jsonb = '{"players": []}'::jsonb
  and :'s9'::jsonb = '{"players": []}'::jsonb
  and exists (select 1 from jsonb_array_elements(:'s10'::jsonb -> 'players') x where x ->> 'nickname' = 'Pro_zent')
  and (select bool_and(strpos(lower(x ->> 'nickname'), 'ro_') > 0) from jsonb_array_elements(:'s10'::jsonb -> 'players') x),
  'search_players(): % and _ in the query are literal characters, not wildcards');
select tests.assert(:'s7'::jsonb = '{"players": []}'::jsonb, 'search_players(): a single % is too short');

-- deactivated players are not found
update public.profiles set is_deactivated = true where id = :q;
select tests.login_as('authenticated', :m);
select public.search_players(:'q_tag') as s13 \gset
select public.search_players('Quirin') as s14 \gset
select tests.throws_key(format('select public.get_player_card(%L)', :'q_tag'), 'player_not_found',
  'get_player_card(): deactivated players are not found by tag');
reset role;
update public.profiles set is_deactivated = false where id = :q;
select tests.assert(
  :'s13'::jsonb = '{"players": []}'::jsonb and :'s14'::jsonb = '{"players": []}'::jsonb,
  'search_players(): deactivated players are left out');

-- only for signed-in players
select tests.login_as('anon');
select tests.throws($$select public.search_players('Mira')$$, '42501', 'search_players(): not for anon');
reset role;
