-- =============================================================================
-- a5 · Nexamon: a player's collectibles on their profile, get_player_nexamon() (ADR-165)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0a50a50a-0000-4000-8000-0000000000a1'''
\set b '''0a50a50a-0000-4000-8000-0000000000b1'''
\set c '''0a50a50a-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Np_Anna') is not null and tests.signup(:b, 'Np_Bruno') is not null
   and tests.signup(:c, 'Np_Clara') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.set_level(:c, 9);
select public.nexamon_sync(public.game_now()) is not null as ok \gset

-- a copy straight into a collection; with a grade it is a slab, with p_grading it is at ASP
create or replace function tests.np_give(p_player uuid, p_card text, p_condition text default 'mint',
                                         p_grade integer default null, p_grading boolean default false)
returns uuid language plpgsql security definer as $$
declare
  v_id uuid := public.nexamon_mint_copy(p_card, p_player, null, p_condition, 'pack', null, public.game_now());
begin
  update public.nexamon_copies
     set grade = p_grade, graded_at = case when p_grade is not null then public.game_now() end,
         grading_until = case when p_grading then public.game_now() + interval '1 hour' end
   where id = v_id;
  return v_id;
end $$;
create or replace function tests.np_value(p_card text, p_condition text default 'mint', p_grade integer default null)
returns bigint language sql security definer as $$
  select public.nexamon_copy_value_cents(k.value_e4, p_condition, p_grade) from public.nexamon_cards k where k.card_key = p_card $$;
grant execute on all functions in schema tests to public;

select card_key as common1 from public.nexamon_cards where set_key = 'mystic_energy' and rarity = 'common' order by number limit 1 \gset
select card_key as common2 from public.nexamon_cards where set_key = 'mystic_energy' and rarity = 'common' order by number offset 1 limit 1 \gset
select card_key as legend from public.nexamon_cards where set_key = 'mystic_energy' and rarity = 'legendary' order by number limit 1 \gset
select card_key as apex from public.nexamon_cards where set_key = 'super_apex' and rarity = 'common' order by number limit 1 \gset

-- Anna: three copies of one common (raw mint, raw poor, a 10), a legendary, a slab with a 5 and a card at ASP
select tests.np_give(:a, :'common1') is not null and tests.np_give(:a, :'common1', 'poor') is not null
   and tests.np_give(:a, :'common1', 'mint', 10) is not null and tests.np_give(:a, :'legend', 'near_mint') is not null
   and tests.np_give(:a, :'apex', 'good', 5) is not null and tests.np_give(:a, :'common2', 'mint', null, true) is not null as ok \gset
-- Clara is below the Nexamon level; even a copy in her name is not shown
select tests.np_give(:c, :'legend') is not null as ok \gset
select tests.np_value(:'common1') + tests.np_value(:'common1', 'poor') + tests.np_value(:'common1', 'mint', 10) as common_total \gset
select :common_total + tests.np_value(:'legend', 'near_mint') + tests.np_value(:'apex', 'good', 5) + tests.np_value(:'common2') as anna_total \gset

-- =============================================================================
-- A. The own collection
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.get_player_nexamon() as own \gset
select public.get_player_nexamon(p_limit => 2) as own2 \gset
select public.get_player_nexamon(p_limit => 0) as own0 \gset
select public.get_player_nexamon(p_limit => 100000) as own_all \gset
reset role;
select tests.assert(
  :'own'::jsonb ->> 'nickname' = 'Np_Anna' and (:'own'::jsonb ->> 'is_me')::boolean and (:'own'::jsonb ->> 'unlocked')::boolean
  and (:'own'::jsonb #>> '{summary,copies}')::integer = 6 and (:'own'::jsonb #>> '{summary,distinct}')::integer = 4
  and (:'own'::jsonb #>> '{summary,total}')::integer = 321
  and (:'own'::jsonb #>> '{summary,value_cents}')::bigint = :anna_total
  and (:'own'::jsonb #>> '{summary,graded}')::integer = 2 and (:'own'::jsonb #>> '{summary,tens}')::integer = 1,
  'get_player_nexamon(): the own collection in numbers (6 copies, 4 of 321 cards, value, 2 slabs, one 10)');
select tests.assert(
  jsonb_array_length(:'own'::jsonb -> 'sets') = 4
  and :'own'::jsonb #>> '{sets,0,key}' = 'mystic_energy' and (:'own'::jsonb #>> '{sets,0,cards}')::integer = 77
  and (:'own'::jsonb #>> '{sets,0,distinct}')::integer = 3 and (:'own'::jsonb #>> '{sets,0,copies}')::integer = 5
  and :'own'::jsonb #>> '{sets,1,key}' = 'super_apex' and (:'own'::jsonb #>> '{sets,1,distinct}')::integer = 1
  and (:'own'::jsonb #>> '{sets,1,copies}')::integer = 1
  and :'own'::jsonb #>> '{sets,2,key}' = 'cosmic_winds' and (:'own'::jsonb #>> '{sets,2,cards}')::integer = 90
  and :'own'::jsonb #>> '{sets,3,key}' = 'prismatic_peak' and (:'own'::jsonb #>> '{sets,3,distinct}')::integer = 0,
  'the progress per set, cheapest pack first: 3 of 77, 1 of 77, 0 of 77');
select tests.assert(
  jsonb_array_length(:'own'::jsonb -> 'cards') = 4
  and :'own'::jsonb #>> '{cards,0,card_key}' = :'legend' and :'own'::jsonb #>> '{cards,0,rarity}' = 'legendary'
  and :'own'::jsonb #>> '{cards,0,condition}' = 'near_mint' and :'own'::jsonb #> '{cards,0,grade}' = 'null'::jsonb
  and (select array_agg((x ->> 'value_cents')::bigint order by o) = array_agg((x ->> 'value_cents')::bigint order by (x ->> 'value_cents')::bigint desc, o)
         from jsonb_array_elements(:'own'::jsonb -> 'cards') with ordinality as e(x, o)),
  'one row per card, the most valuable first (the legendary leads)');
select tests.assert(
  (select (x ->> 'copies')::integer = 3 and (x ->> 'grade')::integer = 10 and x ->> 'condition' = 'mint'
          and (x ->> 'value_cents')::bigint = tests.np_value(:'common1', 'mint', 10)
          and (x ->> 'total_cents')::bigint = :common_total and x ->> 'set' = 'mystic_energy' and (x ->> 'serial')::bigint > 0
     from jsonb_array_elements(:'own'::jsonb -> 'cards') x where x ->> 'card_key' = :'common1'),
  'a card owned three times shows its best copy (the 10 in its slab), the count and the value of all three');
select tests.assert(
  (select x -> 'grade' = 'null'::jsonb and (x ->> 'copies')::integer = 1 and (x ->> 'value_cents')::bigint = tests.np_value(:'common2')
     from jsonb_array_elements(:'own'::jsonb -> 'cards') x where x ->> 'card_key' = :'common2')
  and (select (x ->> 'grade')::integer = 5 and (x ->> 'value_cents')::bigint = tests.np_value(:'apex', 'good', 5)
         from jsonb_array_elements(:'own'::jsonb -> 'cards') x where x ->> 'card_key' = :'apex'),
  'a copy at ASP shows as the raw card it still is; a slab with a 5 is worth its grade factor');
select tests.assert(
  jsonb_array_length(:'own2'::jsonb -> 'cards') = 2 and :'own2'::jsonb #> '{cards,0}' = :'own'::jsonb #> '{cards,0}'
  and :'own2'::jsonb #> '{cards,1}' = :'own'::jsonb #> '{cards,1}' and :'own2'::jsonb -> 'summary' = :'own'::jsonb -> 'summary'
  and :'own2'::jsonb -> 'sets' = :'own'::jsonb -> 'sets'
  and jsonb_array_length(:'own0'::jsonb -> 'cards') = 1 and jsonb_array_length(:'own_all'::jsonb -> 'cards') = 4,
  'p_limit caps the cards (the top ones) but not the numbers; it is clamped to 1..500');

-- =============================================================================
-- B. Somebody else's collection, the level, unknown players
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.get_player_nexamon('  np_anna ') as foreign_read \gset
select public.get_player_nexamon() as empty_own \gset
select public.get_player_nexamon('Np_Clara') as locked \gset
select tests.throws_key($$select public.get_player_nexamon('Nobody_Here_42')$$, 'player_not_found',
  'get_player_nexamon(): an unknown nickname is player_not_found');
reset role;
select tests.assert(
  :'foreign_read'::jsonb ->> 'nickname' = 'Np_Anna' and not (:'foreign_read'::jsonb ->> 'is_me')::boolean
  and :'foreign_read'::jsonb -> 'summary' = :'own'::jsonb -> 'summary' and :'foreign_read'::jsonb -> 'cards' = :'own'::jsonb -> 'cards'
  and :'foreign_read'::jsonb -> 'sets' = :'own'::jsonb -> 'sets'
  and not (:'foreign_read'::jsonb ? 'copies') and not (:'foreign_read'::jsonb #> '{cards,0}' ? 'listing'),
  'another player reads the same collection by nickname (any case, trimmed), without listings or copy ids');
select tests.assert(
  (:'empty_own'::jsonb ->> 'unlocked')::boolean and (:'empty_own'::jsonb #>> '{summary,copies}')::integer = 0
  and (:'empty_own'::jsonb #>> '{summary,value_cents}')::bigint = 0 and :'empty_own'::jsonb -> 'cards' = '[]'::jsonb
  and jsonb_array_length(:'empty_own'::jsonb -> 'sets') = 3,
  'a player without cards: zeros and an empty list');
select tests.assert(
  not (:'locked'::jsonb ->> 'unlocked')::boolean and (:'locked'::jsonb #>> '{summary,copies}')::integer = 0
  and (:'locked'::jsonb #>> '{summary,distinct}')::integer = 0 and (:'locked'::jsonb #>> '{summary,value_cents}')::bigint = 0
  and :'locked'::jsonb -> 'cards' = '[]'::jsonb and (:'locked'::jsonb #>> '{sets,0,copies}')::integer = 0,
  'a player below the Nexamon level shows nothing, whatever is stored');

-- a viewer below the level may still look at a profile
select tests.login_as('authenticated', :c);
select public.get_player_nexamon('Np_Anna') as by_locked \gset
reset role;
select tests.assert(
  (:'by_locked'::jsonb #>> '{summary,copies}')::integer = 6 and not (:'by_locked'::jsonb ->> 'is_me')::boolean,
  'a viewer below the Nexamon level can still see what others collected');

-- =============================================================================
-- C. Privileges
-- =============================================================================
select tests.login_as('anon', null);
select tests.throws($$select public.get_player_nexamon('Np_Anna')$$, '42501', 'anon cannot call get_player_nexamon()');
reset role;
select tests.assert(
  not has_function_privilege('anon', 'public.get_player_nexamon(text, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.get_player_nexamon(text, integer)', 'execute')
  and (select p.provolatile = 's' and p.prosecdef and p.proconfig @> array['search_path=""']
         from pg_proc p where p.oid = 'public.get_player_nexamon(text, integer)'::regprocedure),
  'get_player_nexamon(): authenticated only, STABLE, SECURITY DEFINER with an empty search_path');

-- the cards made for this file leave again, so later files and the fixtures see the populations they expect
delete from public.nexamon_copies where owner_id in (:a, :b, :c);
