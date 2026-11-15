-- =============================================================================
-- 9x · News battles: the games of the addendum to ADR-160 (action vectors, round games, the picker)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

-- The bot inputs of src/lib/sim/battle/vectors.ts (as in 9s_battles.sql)
create or replace function tests.battle_bot(p_seed bigint, p_kind text, p_slot integer, p_len integer) returns text
language sql as $$
  select string_agg(case when p_kind = 'pump'
                         then case when public.battle_hash(p_seed + 7, p_slot, t) % 3 > 0 then '1' else '0' end
                         else ((public.battle_hash(p_seed + 7, p_slot, t / 6) % 5)
                               + case when (public.battle_hash(p_seed + 7, p_slot, t / 6) / 16) % 3 = 0 then 5 else 0 end)::text
                    end, '' order by t)
    from generate_series(0, p_len - 1) t;
$$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. The six new action games give the same results in SQL as in TypeScript (vectors.test.ts)
-- =============================================================================
create temp table battle_vectors_more (kind text, seed bigint, n integer, cut integer, expect jsonb);
insert into battle_vectors_more values
  ('bear', 42, 3, -1, '{"end":170,"ranking":[2,1,0],"out":[110,170,-1],"score":[23,32,22]}'),
  ('bear', 7, 6, -1, '{"end":288,"ranking":[0,5,4,2,1,3],"out":[-1,136,146,75,239,288],"score":[53,27,25,16,43,44]}'),
  ('bear', 99, 10, -1, '{"end":421,"ranking":[8,0,7,6,2,5,9,3,4,1],"out":[421,47,259,110,84,194,314,380,-1,136],"score":[69,6,47,20,14,28,58,53,78,23]}'),
  ('bear', 2026, 4, 100, '{"end":179,"ranking":[0,3,2,1],"out":[-1,75,147,179],"score":[33,12,25,14]}'),
  ('dash', 42, 3, -1, '{"end":1199,"ranking":[2,1,0],"out":[-1,-1,-1],"score":[0,0,5]}'),
  ('dash', 7, 6, -1, '{"end":1199,"ranking":[5,1,0,2,3,4],"out":[-1,-1,-1,-1,-1,-1],"score":[4,5,3,3,1,5]}'),
  ('dash', 99, 10, -1, '{"end":1016,"ranking":[4,1,5,7,6,9,2,8,3,0],"out":[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],"score":[2,6,4,3,8,6,5,5,4,5]}'),
  ('dash', 2026, 4, 100, '{"end":1199,"ranking":[0,2,1,3],"out":[-1,-1,-1,179],"score":[3,0,0,0]}'),
  ('margin', 42, 3, -1, '{"end":1799,"ranking":[0,2,1],"out":[-1,-1,-1],"score":[0,0,0]}'),
  ('margin', 7, 6, -1, '{"end":1078,"ranking":[2,3,5,1,0,4],"out":[130,130,-1,1078,130,130],"score":[3,2,0,5,5,1]}'),
  ('margin', 99, 10, -1, '{"end":130,"ranking":[8,4,1,7,5,0,2,6,9,3],"out":[130,130,130,130,130,130,130,130,-1,130],"score":[1,1,2,3,1,1,2,1,0,2]}'),
  ('margin', 2026, 4, 100, '{"end":1468,"ranking":[2,0,1,3],"out":[1468,1468,-1,179],"score":[2,5,0,0]}'),
  ('elevator', 42, 3, -1, '{"end":119,"ranking":[2,1,0],"out":[72,119,-1],"score":[1,4,-1]}'),
  ('elevator', 7, 6, -1, '{"end":188,"ranking":[2,1,3,5,4,0],"out":[64,188,-1,182,76,115],"score":[6,0,-1,1,6,0]}'),
  ('elevator', 99, 10, -1, '{"end":284,"ranking":[1,3,5,0,2,6,9,8,7,4],"out":[204,-1,176,284,112,258,176,119,119,144],"score":[0,-4,1,-3,0,0,3,6,3,3]}'),
  ('elevator', 2026, 4, 100, '{"end":204,"ranking":[2,0,1,3],"out":[204,82,-1,74],"score":[1,4,0,5]}'),
  ('laser', 42, 3, -1, '{"end":340,"ranking":[1,0,2],"out":[340,-1,336],"score":[0,1,0]}'),
  ('laser', 7, 6, -1, '{"end":324,"ranking":[3,5,0,2,1,4],"out":[272,258,262,-1,208,324],"score":[0,0,0,1,0,0]}'),
  ('laser', 99, 10, -1, '{"end":326,"ranking":[4,2,6,5,1,8,9,0,7,3],"out":[208,264,326,200,-1,266,318,204,216,212],"score":[0,0,0,0,1,0,0,0,0,0]}'),
  ('laser', 2026, 4, 100, '{"end":254,"ranking":[1,0,2,3],"out":[254,-1,204,179],"score":[0,3,0,2]}'),
  ('rodeo', 42, 3, -1, '{"end":328,"ranking":[0,2,1],"out":[-1,328,328],"score":[41,14,19]}'),
  ('rodeo', 7, 6, -1, '{"end":346,"ranking":[4,0,5,2,3,1],"out":[346,181,216,216,-1,286],"score":[52,0,24,21,73,25]}'),
  ('rodeo', 99, 10, -1, '{"end":270,"ranking":[4,2,1,6,9,0,3,7,8,5],"out":[169,169,270,169,-1,138,169,169,138,169],"score":[19,23,25,18,57,0,23,13,0,19]}'),
  ('rodeo', 2026, 4, 100, '{"end":268,"ranking":[1,2,0,3],"out":[192,-1,268,179],"score":[18,61,40,47]}');

create temp table battle_vector_more_results as
  select v.kind, v.seed, v.n, v.cut, v.expect,
         public.battle_sim(v.kind, v.seed, public.battle_params(v.kind),
                           (select array_agg(case when v.cut >= 0 and s = v.n - 1 then left(tests.battle_bot(v.seed, v.kind, s, 2000), v.cut)
                                                  else tests.battle_bot(v.seed, v.kind, s, 2000) end order by s)
                              from generate_series(0, v.n - 1) s), 2000) as got
    from battle_vectors_more v;
select tests.assert(
  (r.got ->> 'end_tick')::integer = (r.expect ->> 'end')::integer and r.got -> 'ranking' = r.expect -> 'ranking'
  and r.got -> 'out' = r.expect -> 'out' and r.got -> 'score' = r.expect -> 'score' and (r.got ->> 'done')::boolean,
  format('battle_sim_%s(seed %s, %s players%s) = TypeScript: %s', r.kind, r.seed, r.n,
         case when r.cut >= 0 then ', one disconnects' else '' end, r.got::text))
  from battle_vector_more_results r order by r.kind, r.seed;
select tests.assert(public.battle_is_tick('bear') and public.battle_is_tick('rodeo') and not public.battle_is_tick('vault')
  and public.battle_is_tick('floor') and not public.battle_is_tick('quiz'),
  'battle_is_tick(): the new action games are lockstep games, the new round games are not');

-- Ends every live battle (between the sections)
create or replace function tests.battle_reset() returns void language sql as $$
  update public.battle_players set active = false where active;
  update public.battles set status = 'cancelled', finished_at = now() where status in ('open', 'running');
$$;
create or replace function tests.live_battle() returns public.battles language sql as $$
  select * from public.battles where status in ('open', 'running') order by id desc limit 1;
$$;
-- A running round game with three players, started p_ago ago
create or replace function tests.round_battle(p_kind text, p_plan jsonb, p_ago interval, p_players uuid[],
                                              p_params jsonb default null) returns bigint
language plpgsql as $$
declare
  v_id bigint;
  k integer;
begin
  perform tests.battle_reset();
  insert into public.battles (status, kind, seed, params, plan, prize, started_at, ends_at)
  values ('running', p_kind, 17, coalesce(p_params, public.battle_params(p_kind)), p_plan, '{"kind":"xp"}',
          now() - p_ago, now() - p_ago + interval '3 minutes')
  returning id into v_id;
  for k in 1 .. cardinality(p_players) loop
    insert into public.battle_players (battle_id, player_id, slot) values (v_id, p_players[k], k - 1);
  end loop;
  return v_id;
end;
$$;
-- Moves a battle (and its answers and tries) p_by into the past
create or replace function tests.battle_age(p_id bigint, p_by interval) returns void language sql as $$
  update public.battles set started_at = started_at - p_by, ends_at = ends_at - p_by where id = p_id;
  update public.battle_answers set answered_at = answered_at - p_by, revealed_at = revealed_at - p_by where battle_id = p_id;
  update public.battle_guesses set guessed_at = guessed_at - p_by where battle_id = p_id;
$$;
grant execute on all functions in schema tests to public;

\set a '''0ba77200-0000-4000-8000-0000000000a1'''
\set b '''0ba77200-0000-4000-8000-0000000000b1'''
\set c '''0ba77200-0000-4000-8000-0000000000c1'''
\set d '''0ba77200-0000-4000-8000-0000000000d1'''
update public.invite_codes set max_uses = max_uses + 10 where code = 'M1-TESTS';
select tests.signup(:a, 'Bg_Anna') is not null and tests.signup(:b, 'Bg_Bruno') is not null
   and tests.signup(:c, 'Bg_Clara') is not null and tests.signup(:d, 'Bg_Dora') is not null as ok \gset
select count(tests.set_level(x, 3)) as ok from unnest(array[:a, :b, :c, :d]::uuid[]) x \gset

-- =============================================================================
-- B. The picker: the new games are in the weights, never the same game twice in a row
-- =============================================================================
select value -> 'weights' as weights0 from public.game_config where key = 'battles' \gset
select tests.assert(
  (select count(*) from jsonb_object_keys(:'weights0'::jsonb) k
    where k in ('bear', 'dash', 'margin', 'elevator', 'laser', 'rodeo', 'vault', 'ticker', 'higher', 'auction')) = 10
  and (public.battle_params('vault') #>> '{game,digits}')::integer = 3
  and public.battle_params('bear') -> 'game' ? 'pillars',
  'the ten new games have weights and rules in game_config.battles');
select tests.set_cfg('battles', '{weights}', '{"bear": 1, "vault": 1}');
create or replace function tests.battle_pick(p_last text, p_players uuid[]) returns text
language plpgsql as $$
declare
  v_id bigint;
  r uuid;
begin
  perform tests.battle_reset();
  insert into public.battles (status, kind, seed, prize, started_at, ends_at, finished_at)
  values ('finished', p_last, 1, '{"kind":"xp"}', now() - interval '2 minutes', now() - interval '1 minute', now());
  insert into public.battles (status, seed, prize, countdown_ends_at) values ('open', 5, '{"kind":"xp"}', now() - interval '1 second')
  returning id into v_id;
  foreach r in array p_players loop
    insert into public.battle_players (battle_id, player_id) values (v_id, r);
  end loop;
  perform public.battle_start(v_id, now());
  return (select kind from public.battles where id = v_id);
end;
$$;
grant execute on all functions in schema tests to public;
select tests.assert(
  tests.battle_pick('bear', array[:a, :b, :c]::uuid[]) = 'vault' and tests.battle_pick('vault', array[:a, :b, :c]::uuid[]) = 'bear'
  and tests.battle_pick('bear', array[:a, :b, :c]::uuid[]) = 'vault',
  'battle_start() picks the new games by weight and never the last game again');
select tests.assert(
  (select (plan -> 'questions' -> 0 ->> 'code') ~ '^[1-6]{3}$' from public.battles where status = 'running')
  and (select ends_at - started_at from public.battles where status = 'running') = interval '84 seconds',
  'a Tresorknacker battle gets its secret codes and lasts its three rounds');
select tests.set_cfg('battles', '{weights}', :'weights0'::jsonb);

-- =============================================================================
-- C. Tresorknacker: the server answers every try, the code stays secret, tries are limited
-- =============================================================================
select tests.round_battle('vault', '{"questions":[{"q":"Tresor 1","code":"352"},{"q":"Tresor 2","code":"146"}]}',
                          interval '1 second', array[:a, :b, :c]::uuid[],
                          jsonb_set(public.battle_params('vault'), '{game,rounds}', '2')) as vid \gset
select tests.login_as('authenticated', :a);
select public.battle_answer(gen_random_uuid(), :vid, 0, 123, null) as v1 \gset
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, 355, null)', :vid), 'invalid_argument',
  'Tresorknacker: a try with a digit twice is refused');
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, 789, null)', :vid), 'invalid_argument',
  'Tresorknacker: digits above 6 are refused');
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, 3521, null)', :vid), 'invalid_argument',
  'Tresorknacker: a try of the wrong length is refused');
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, null, 352)', :vid), 'invalid_argument',
  'Tresorknacker: a try without digits is refused');
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 1, 146, null)', :vid), 'battle_round_closed',
  'Tresorknacker: the next vault cannot be tried before it opens');
select public.battle_answer(gen_random_uuid(), :vid, 0, 352, null) as v2 \gset
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, 352, null)', :vid), 'battle_round_closed',
  'Tresorknacker: nothing after cracking (no farming of tries)');
reset role;
select tests.assert(
  :'v1'::jsonb #> '{battle,rounds,list,0,guesses}' = '[{"code": "123", "hits": 0, "near": 2}]'::jsonb
  and :'v1'::jsonb #>> '{battle,rounds,list,0,code}' is null
  and not exists (select 1 from jsonb_array_elements(:'v1'::jsonb #> '{battle,rounds,list}') x where x::text like '%"352"%')
  and jsonb_array_length(:'v2'::jsonb #> '{battle,rounds,list,0,guesses}') = 2
  and :'v2'::jsonb #> '{battle,rounds,list,0,guesses,1}' = '{"code": "352", "hits": 3, "near": 0}'::jsonb
  and (:'v2'::jsonb #>> '{battle,rounds,list,0,mine,pressed}')::boolean,
  'the server answers each try (in place / elsewhere) and never sends the code while the vault is open');
select tests.login_as('authenticated', :b);
select count(public.battle_answer(gen_random_uuid(), :vid, 0, 456, null)) as ok from generate_series(1, 8) \gset
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, 352, null)', :vid), 'battle_round_closed',
  'Tresorknacker: after maxTries tries no more (no brute force)');
reset role;
select tests.login_as('authenticated', :d);
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, 352, null)', :vid), 'battle_not_joined',
  'Tresorknacker: only players of the battle try');
reset role;
select tests.login_as('authenticated', :c);
select public.get_battle() as v3 \gset
reset role;
select tests.assert(
  :'v3'::jsonb #> '{battle,rounds,list,0,progress}'
    = '[{"slot": 0, "tries": 2, "cracked": true}, {"slot": 1, "tries": 8, "cracked": false}, {"slot": 2, "tries": 0, "cracked": false}]'::jsonb
  and :'v3'::jsonb #> '{battle,rounds,list,0,guesses}' = '[]'::jsonb,
  'everybody sees how far the others are (tries, cracked), but only their own tries');
-- the vault closes: A cracked it with the second try after about a second
select tests.battle_age(:vid, interval '25 seconds');
select public.battle_rounds_eval(b, now()) as ve from public.battles b where b.id = :vid \gset
select tests.login_as('authenticated', :c);
select public.get_battle() as v4 \gset
reset role;
select tests.assert(
  (:'ve'::jsonb ->> 'closed')::integer = 1 and (:'ve'::jsonb #>> '{points,0}')::integer between 400 + 550 + 150 and 400 + 600 + 150
  and :'ve'::jsonb #>> '{points,1}' = '0' and :'ve'::jsonb #>> '{points,2}' = '0'
  and :'ve'::jsonb #> '{results,0,answers}' @> '[{"slot": 0, "choice": 2, "right": true}, {"slot": 1, "choice": 8, "right": false}]'::jsonb
  and :'v4'::jsonb #>> '{battle,rounds,list,0,code}' = '352',
  'Tresorknacker scores speed and few tries; the code shows after the round');

-- =============================================================================
-- D. Ticker-Tippen: the first tap counts, a wrong one costs points
-- =============================================================================
select tests.round_battle('ticker', '{"questions":[{"q":"Bullen & Söhne AG","options":["MOND","GOLD","BULL","NXA","DUCK","SOFA"],"correct":2},{"q":"Gummiente International","options":["MOND","GOLD","BULL","NXA","DUCK","SOFA"],"correct":4}]}',
                          interval '1 second', array[:a, :b, :c]::uuid[],
                          jsonb_set(public.battle_params('ticker'), '{game,rounds}', '2')) as tid \gset
select tests.login_as('authenticated', :a);
select public.battle_answer(gen_random_uuid(), :tid, 0, 2, null) as t1 \gset
select public.battle_answer(gen_random_uuid(), :tid, 0, 0, null) is not null as ok \gset
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, 6, null)', :tid), 'invalid_argument',
  'Ticker-Tippen: an option that does not exist is refused');
reset role;
select tests.login_as('authenticated', :b);
select public.battle_answer(gen_random_uuid(), :tid, 0, 0, null) is not null as ok \gset
reset role;
select tests.assert(not (:'t1'::jsonb #> '{battle,rounds,list,0}' ? 'correct')
  and jsonb_array_length(:'t1'::jsonb #> '{battle,rounds,list,0,options}') = 6,
  'Ticker-Tippen: six tickers, the right one secret while the round is open');
select tests.battle_age(:tid, interval '6 seconds');
select public.battle_rounds_eval(b, now()) as te from public.battles b where b.id = :tid \gset
select tests.assert(
  (:'te'::jsonb #>> '{points,0}')::integer between 200 + 600 and 200 + 800
  and (:'te'::jsonb #>> '{points,1}')::integer = -300 and (:'te'::jsonb #>> '{points,2}')::integer = 0
  and :'te'::jsonb -> 'ranking' = '[0, 2, 1]'::jsonb,
  'Ticker-Tippen: fast and right scores, the second tap does not count, wrong costs 300');

-- =============================================================================
-- E. Mehr oder Weniger: the chart only up to now, hearts, nobody loses when everybody is wrong
-- =============================================================================
select tests.round_battle('higher',
  jsonb_build_object('series', to_jsonb(array(select 10000 + 100 * g from generate_series(0, 17) g)),
                     'questions', '[{"q":"KlarSoft AG","correct":0,"value":115},{"q":"KlarSoft AG","correct":0,"value":116},{"q":"KlarSoft AG","correct":0,"value":117}]'::jsonb),
  interval '1 second', array[:a, :b, :c]::uuid[], jsonb_set(public.battle_params('higher'), '{game,rounds}', '3')) as hid \gset
update public.battles set params = jsonb_set(params, '{game,heartsSmall}', '1') where id = :hid;
select tests.login_as('authenticated', :a);
select public.battle_answer(gen_random_uuid(), :hid, 0, 1, null) as h1 \gset
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, 2, null)', :hid), 'invalid_argument',
  'Mehr oder Weniger: only higher (0) or lower (1)');
reset role;
select tests.login_as('authenticated', :b);
select public.battle_answer(gen_random_uuid(), :hid, 0, 1, null) is not null as ok \gset
reset role;
select tests.assert(
  jsonb_array_length(:'h1'::jsonb #> '{battle,rounds,list,0,chart}') = 15
  and (:'h1'::jsonb #>> '{battle,rounds,list,0,chart,14}')::numeric = 114
  and not (:'h1'::jsonb #> '{battle,rounds,list,0}' ? 'correct') and not (:'h1'::jsonb #> '{battle,rounds,list,0}' ? 'value'),
  'Mehr oder Weniger: the chart ends at the current candle, the next one stays secret');
-- round 0: everybody wrong or silent -> nobody loses; round 1: only A right -> B and C are out
select tests.battle_age(:hid, interval '7500 milliseconds');
insert into public.battle_answers (battle_id, round, player_id, choice, answered_at)
select :hid, 1, p, c, (select started_at from public.battles where id = :hid) + interval '8 seconds'
  from (values (:a::uuid, 0), (:b::uuid, 1)) v(p, c);
select tests.battle_age(:hid, interval '7500 milliseconds');
select public.battle_rounds_eval(b, now()) as he from public.battles b where b.id = :hid \gset
select public.battle_rounds_json(b, :a, now()) as h2 from public.battles b where b.id = :hid \gset
select tests.assert(
  :'he'::jsonb #> '{results,0,lost}' = '[]'::jsonb and :'he'::jsonb #> '{results,1,lost}' = '[1, 2]'::jsonb
  and :'he'::jsonb -> 'out' = '[-1, 1, 1]'::jsonb and (:'he'::jsonb ->> 'done')::boolean
  and :'he'::jsonb #>> '{ranking,0}' = '0'
  and (:'h2'::jsonb #>> '{list,0,value}')::numeric = 115
  and jsonb_array_length(:'h2'::jsonb #> '{list,1,chart}') = 16,
  'Mehr oder Weniger: when all are wrong nobody loses a heart; the next candle shows after the round');
select public.battle_maintain(now());
select tests.assert((select status from public.battles where id = :hid) = 'finished'
  and (select winner_id from public.battles where id = :hid) = :a,
  'Mehr oder Weniger ends after the deciding round; the last one with hearts wins');

-- =============================================================================
-- F. Wer bietet mehr?: sealed bids, never more than what is left, the highest (earlier) bid wins and pays
-- =============================================================================
select tests.round_battle('auction',
  '{"questions":[{"q":"Goldbarren","points":300,"icon":"gold_bar"},{"q":"Gummiente","points":100,"icon":"duck"}]}',
  interval '1 second', array[:a, :b, :c]::uuid[], jsonb_set(public.battle_params('auction'), '{game,rounds}', '2')) as aid \gset
select tests.login_as('authenticated', :a);
select public.battle_answer(gen_random_uuid(), :aid, 0, null, 400) as a1 \gset
reset role;
select tests.login_as('authenticated', :b);
select public.battle_answer(gen_random_uuid(), :aid, 0, null, 400) as a2 \gset
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, null, 1001)', :aid), 'invalid_argument',
  'Wer bietet mehr?: no bid above the play money');
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, null, 12.5)', :aid), 'invalid_argument',
  'Wer bietet mehr?: whole play money only');
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, null, -5)', :aid), 'invalid_argument',
  'Wer bietet mehr?: no negative bids');
reset role;
update public.battle_answers set answered_at = answered_at - interval '1 second' where battle_id = :aid and player_id = :a;
select tests.assert(
  :'a2'::jsonb #> '{battle,rounds,list,0,results}' is null
  and (:'a2'::jsonb #>> '{battle,rounds,list,0,item_points}')::integer = 300
  and (:'a2'::jsonb #>> '{battle,rounds,list,0,budget}')::integer = 1000,
  'Wer bietet mehr?: the bids stay sealed until the gavel');
select tests.battle_age(:aid, interval '13 seconds');
select tests.login_as('authenticated', :a);
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 1, null, 700)', :aid), 'invalid_argument',
  'Wer bietet mehr?: the winner can only bid what is left (600)');
select public.battle_answer(gen_random_uuid(), :aid, 1, null, 600) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.battle_answer(gen_random_uuid(), :aid, 1, null, 0) as a3 \gset
reset role;
select tests.assert(
  :'a3'::jsonb #> '{battle,rounds,list,0,results}' @> '[{"slot": 0, "value": 400, "points": 300, "right": true}, {"slot": 1, "value": 400, "points": 0, "right": false}]'::jsonb
  and :'a3'::jsonb #> '{battle,rounds,list,1,budgets}' = '[600, 1000, 1000]'::jsonb,
  'Wer bietet mehr?: at the same bid the earlier one wins the points and pays; everybody sees the bids afterwards');
select tests.battle_age(:aid, interval '14 seconds');
select public.battle_maintain(now());
select tests.assert(
  (select status from public.battles where id = :aid) = 'finished'
  and (select winner_id from public.battles where id = :aid) = :a
  and (select result -> 'score' from public.battles where id = :aid) = '[400, 0, 0]'::jsonb,
  'Wer bietet mehr?: the most points win (300 + 100), the prize is paid');
select tests.battle_reset();
