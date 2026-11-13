-- =============================================================================
-- 90 · Friends see each other's investments (ADR-121)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''09009009-0000-4000-8000-0000000000a1'''
\set b '''09009009-0000-4000-8000-0000000000b1'''
\set c '''09009009-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:a, 'Ida_Invest') is not null and tests.signup(:b, 'Bodo_Freund') is not null
   and tests.signup(:c, 'Carl_Fremd') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.fund(:a, 5000000, 'test:holdings:a');

select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', null, null, 1000000) is not null as ok \gset
select public.place_order(gen_random_uuid(), 'VLT', 'buy', 'market', null, null, 300000) is not null as ok \gset
select public.send_friend_request(gen_random_uuid(), 'Bodo_Freund') is not null as ok \gset
select public.get_player_holdings('Ida_Invest') as own \gset
reset role;
select tests.login_as('authenticated', :b);
select public.respond_friend_request(gen_random_uuid(), 'Ida_Invest', true) is not null as ok \gset
select public.get_player_holdings('ida_invest') as friend \gset
reset role;
select tests.login_as('authenticated', :c);
select public.get_player_holdings('Ida_Invest') as stranger \gset
select tests.throws_key($$select public.get_player_holdings('Niemand_Hier')$$, 'player_not_found',
  'get_player_holdings(): unknown player');
reset role;

select tests.assert(
  (:'own'::jsonb ->> 'visible')::boolean and :'friend'::jsonb = :'own'::jsonb
  and jsonb_array_length(:'own'::jsonb -> 'positions') = 2
  and :'own'::jsonb -> 'positions' -> 0 ->> 'ticker' = 'KLS' and :'own'::jsonb -> 'positions' -> 1 ->> 'ticker' = 'VLT'
  and (:'own'::jsonb -> 'positions' -> 0) ?& array['name', 'kind', 'sector', 'quantity_e6', 'value_cents', 'share_bps']
  and (:'own'::jsonb ->> 'total_cents')::bigint
      = (select sum((p ->> 'value_cents')::bigint) from jsonb_array_elements(:'own'::jsonb -> 'positions') p)
  and (select sum((p ->> 'share_bps')::int) between 9999 and 10001 from jsonb_array_elements(:'own'::jsonb -> 'positions') p)
  and (:'own'::jsonb -> 'positions' -> 0 ->> 'share_bps')::int > 7000,
  'get_player_holdings(): the player and a friend see the positions, biggest first, with value and share');
select tests.assert(
  :'stranger'::jsonb = '{"visible": false, "total_cents": null, "positions": []}'::jsonb,
  'get_player_holdings(): everyone else only learns that it is private');
