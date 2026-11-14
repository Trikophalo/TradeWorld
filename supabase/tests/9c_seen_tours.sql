-- =============================================================================
-- 9c · Finn's tours on the server
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''09c09c09-0000-4000-8000-0000000000a1'''
\set b '''09c09c09-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Tour_Anna') is not null and tests.signup(:b, 'Tour_Bert') is not null as ok \gset

select tests.login_as('authenticated', :a);
select tests.assert(public.get_seen_tours() = '{"tours": []}'::jsonb, 'get_seen_tours(): empty at first');
select public.mark_tour_seen(gen_random_uuid(), 'bonds') as t1 \gset
select public.mark_tour_seen(gen_random_uuid(), 'visit_company') as t2 \gset
select public.mark_tour_seen(gen_random_uuid(), 'bonds') as t3 \gset
select tests.throws_key(format('select public.mark_tour_seen(gen_random_uuid(), %L)', 'Böse Tour; drop'),
  'invalid_argument', 'mark_tour_seen(): only plain keys');
reset role;
select tests.assert(
  :'t1'::jsonb = '{"tours": ["bonds"]}'::jsonb
  and jsonb_array_length(:'t3'::jsonb -> 'tours') = 2
  and :'t3'::jsonb -> 'tours' ? 'visit_company',
  'mark_tour_seen(): remembers each tour once');

select tests.login_as('authenticated', :b);
select tests.assert(public.get_seen_tours() = '{"tours": []}'::jsonb, 'get_seen_tours(): every player sees only their own');
reset role;
select tests.assert(not has_table_privilege('authenticated', 'public.player_seen_tours', 'select')
  and not has_table_privilege('authenticated', 'public.player_seen_tours', 'insert'),
  'player_seen_tours: no direct client access');
