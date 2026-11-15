-- =============================================================================
-- 9s · News battles: lobby, lockstep games, round games, prizes (ADR-160)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

-- The bot inputs of src/lib/sim/battle/vectors.ts
create or replace function tests.battle_bot(p_seed bigint, p_kind text, p_slot integer, p_len integer) returns text
language sql as $$
  select string_agg(case when p_kind = 'pump'
                         then case when public.battle_hash(p_seed + 7, p_slot, t) % 3 > 0 then '1' else '0' end
                         else ((public.battle_hash(p_seed + 7, p_slot, t / 6) % 5)
                               + case when (public.battle_hash(p_seed + 7, p_slot, t / 6) / 16) % 3 = 0 then 5 else 0 end)::text
                    end, '' order by t)
    from generate_series(0, p_len - 1) t;
$$;
-- Ends every live battle (between the sections)
create or replace function tests.battle_reset() returns void language sql as $$
  update public.battle_players set active = false where active;
  update public.battles set status = 'cancelled', finished_at = now() where status in ('open', 'running');
$$;
create or replace function tests.live_battle() returns public.battles language sql as $$
  select * from public.battles where status in ('open', 'running') order by id desc limit 1;
$$;
create or replace function tests.households() returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where system_key = 'households';
$$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. The simulations in SQL give the same results as in TypeScript (vectors.test.ts)
-- =============================================================================
select tests.assert(
  public.battle_hash(0, 0, 0) = 3904035322 and public.battle_hash(12345, 1, 2) = 2478510442
  and public.battle_hash(4294967295, 999, 7) = 3673303681,
  'battle_hash() equals the TypeScript hash (lowbias32)');

create temp table battle_vectors (kind text, seed bigint, n integer, cut integer, expect jsonb);
insert into battle_vectors values
('floor', 42, 3, -1, '{"end":198,"ranking":[1,2,0],"out":[148,-1,198],"score":[30,36,28]}'),
  ('floor', 7, 6, -1, '{"end":198,"ranking":[4,0,1,5,3,2],"out":[198,188,144,144,-1,160],"score":[39,36,25,34,36,27]}'),
  ('floor', 99, 10, -1, '{"end":264,"ranking":[8,0,1,7,9,5,4,6,3,2],"out":[264,258,122,138,188,196,182,222,-1,200],"score":[44,34,22,27,35,26,32,39,42,39]}'),
  ('floor', 2026, 4, 100, '{"end":204,"ranking":[0,2,1,3],"out":[-1,196,204,171],"score":[38,34,37,18]}'),
  ('bulls', 42, 3, -1, '{"end":498,"ranking":[2,0,1],"out":[498,430,-1],"score":[0,0,1]}'),
  ('bulls', 7, 6, -1, '{"end":626,"ranking":[1,0,2,3,5,4],"out":[626,-1,618,588,538,564],"score":[0,1,0,0,0,0]}'),
  ('bulls', 99, 10, -1, '{"end":648,"ranking":[3,2,1,9,8,7,0,6,5,4],"out":[590,644,648,-1,362,432,527,592,596,638],"score":[0,0,0,1,0,0,0,0,0,0]}'),
  ('bulls', 2026, 4, 100, '{"end":496,"ranking":[1,2,0,3],"out":[490,-1,496,179],"score":[0,3,0,3]}'),
  ('coins', 42, 3, -1, '{"end":899,"ranking":[2,0,1],"out":[-1,-1,-1],"score":[15,9,17]}'),
  ('coins', 7, 6, -1, '{"end":899,"ranking":[2,4,0,3,1,5],"out":[-1,-1,-1,-1,-1,-1],"score":[19,14,23,14,21,14]}'),
  ('coins', 99, 10, -1, '{"end":899,"ranking":[7,0,4,8,2,6,5,9,1,3],"out":[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],"score":[25,14,21,12,25,16,17,32,24,15]}'),
  ('coins', 2026, 4, 100, '{"end":899,"ranking":[0,2,1,3],"out":[-1,-1,-1,179],"score":[27,13,26,0]}'),
  ('sumo', 42, 3, -1, '{"end":520,"ranking":[0,2,1],"out":[520,520,520],"score":[1,0,1]}'),
  ('sumo', 7, 6, -1, '{"end":740,"ranking":[1,4,5,3,2,0],"out":[233,-1,520,520,740,622],"score":[1,6,3,3,1,3]}'),
  ('sumo', 99, 10, -1, '{"end":796,"ranking":[0,1,4,7,3,9,2,8,5,6],"out":[-1,796,190,478,520,107,76,520,178,281],"score":[8,7,1,10,7,0,0,2,3,4]}'),
  ('sumo', 2026, 4, 100, '{"end":520,"ranking":[2,0,1,3],"out":[520,224,-1,179],"score":[2,1,1,2]}'),
  ('potato', 42, 3, -1, '{"end":480,"ranking":[0,1,2],"out":[-1,480,240],"score":[182,19,201]}'),
  ('potato', 7, 6, -1, '{"end":1060,"ranking":[5,0,4,3,1,2],"out":[1060,400,220,620,840,-1],"score":[304,181,8,181,181,10]}'),
  ('potato', 99, 10, -1, '{"end":1480,"ranking":[0,2,7,5,3,1,9,8,6,4],"out":[-1,860,1480,1020,180,1140,360,1300,520,680],"score":[79,48,284,52,31,295,59,158,79,44]}'),
  ('potato', 2026, 4, 100, '{"end":480,"ranking":[0,2,1,3],"out":[-1,260,480,179],"score":[0,81,321,0]}'),
  ('pump', 42, 3, -1, '{"end":599,"ranking":[1,0,2],"out":[-1,-1,-1],"score":[84,84,82]}'),
  ('pump', 7, 6, -1, '{"end":599,"ranking":[0,3,1,4,2,5],"out":[-1,-1,-1,-1,-1,-1],"score":[109,103,96,103,97,95]}'),
  ('pump', 99, 10, -1, '{"end":599,"ranking":[2,4,8,6,3,9,1,0,5,7],"out":[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],"score":[126,130,147,136,145,125,141,125,145,132]}'),
  ('pump', 2026, 4, 100, '{"end":599,"ranking":[2,0,1,3],"out":[-1,-1,-1,179],"score":[58,53,62,27]}');

create temp table battle_vector_results as
  select v.kind, v.seed, v.n, v.cut, v.expect,
         public.battle_sim(v.kind, v.seed, public.battle_params(v.kind),
                           (select array_agg(case when v.cut >= 0 and s = v.n - 1 then left(tests.battle_bot(v.seed, v.kind, s, 2000), v.cut)
                                                  else tests.battle_bot(v.seed, v.kind, s, 2000) end order by s)
                              from generate_series(0, v.n - 1) s), 2000) as got
    from battle_vectors v;
select tests.assert(
  (r.got ->> 'end_tick')::integer = (r.expect ->> 'end')::integer and r.got -> 'ranking' = r.expect -> 'ranking'
  and r.got -> 'out' = r.expect -> 'out' and r.got -> 'score' = r.expect -> 'score' and (r.got ->> 'done')::boolean,
  format('battle_sim_%s(seed %s, %s players%s) = TypeScript: %s', r.kind, r.seed, r.n,
         case when r.cut >= 0 then ', one disconnects' else '' end, r.got::text))
  from battle_vector_results r order by r.kind, r.seed;
select tests.assert(
  (public.battle_sim('floor', 42, public.battle_params('floor'),
     array[tests.battle_bot(42, 'floor', 0, 120), tests.battle_bot(42, 'floor', 1, 120), tests.battle_bot(42, 'floor', 2, 120)], 120)
   ->> 'done')::boolean = false,
  'a simulation stopped before the end is not done');

-- =============================================================================
-- B. The stream rules: nothing rewritten, late ticks are "x", no inputs from the future
-- =============================================================================
select tests.assert(
  public.battle_accept_chunk('', 0, '1234', 0, 100, 10) = '1234'
  and public.battle_accept_chunk('12', 0, '9999', 0, 100, 10) = '1299'
  and public.battle_accept_chunk('12', 5, '33', 0, 100, 10) = '12xxx33'
  and public.battle_accept_chunk('', 0, '11111', 3, 100, 10) = 'xxx11'
  and public.battle_accept_chunk('', 0, repeat('2', 30), 0, 5, 10) = repeat('2', 16)
  and public.battle_accept_chunk('', 0, 'a1?', 0, 100, 10) = '010'
  and public.battle_accept_chunk('12q', 3, '44', 0, 100, 10) = '12q'
  and public.battle_quit_stream('12', 5) = '12xxxq' and public.battle_quit_stream('1234', 2) = '1234q',
  'battle_accept_chunk(): no rewriting, gaps and final ticks are "x", at most aheadTicks ahead, only 0..9');

-- =============================================================================
-- C. Exclusive accessories: in the catalogue, never for sale
-- =============================================================================
\set a '''0ba771e0-0000-4000-8000-0000000000a1'''
\set b '''0ba771e0-0000-4000-8000-0000000000b1'''
\set c '''0ba771e0-0000-4000-8000-0000000000c1'''
\set d '''0ba771e0-0000-4000-8000-0000000000d1'''
\set e '''0ba771e0-0000-4000-8000-0000000000e1'''
\set rq '''0ba771e0-0000-4000-8000-0000000000f1'''
update public.invite_codes set max_uses = max_uses + 20 where code = 'M1-TESTS';
select tests.signup(:a, 'Bat_Anna') is not null and tests.signup(:b, 'Bat_Bruno') is not null
   and tests.signup(:c, 'Bat_Clara') is not null and tests.signup(:d, 'Bat_Dora') is not null
   and tests.signup(:e, 'Bat_Emil') is not null as ok \gset
select count(tests.set_level(x, 3)) as ok from unnest(array[:a, :b, :c, :d, :e]::uuid[]) x \gset
select tests.fund(:a, 100000000, 'test:9s:a');
select tests.assert(
  public.accessory_item('battle_crown') ->> 'slot' = 'head'
  and (public.accessory_item('battle_crown') ->> 'exclusive')::boolean
  and public.accessory_item('battle_crown') ->> 'priceCents' is null
  and public.accessory_item('cowboy_hat') ->> 'slot' = 'head'
  and jsonb_array_length(public.battles_cfg() -> 'accessories') >= 4,
  'accessories_cfg(): the exclusive battle accessories are part of the catalogue, without a price');
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.buy_accessory(gen_random_uuid(), 'battle_crown')$$, 'accessory_exclusive',
  'buy_accessory(): an exclusive accessory cannot be bought (NX155)');
reset role;
insert into public.player_accessories (player_id, accessory_key, price_paid_cents) values (:a, 'laurel_wreath', 0);
select tests.login_as('authenticated', :a);
select public.wear_accessory(gen_random_uuid(), 'laurel_wreath', true) -> 'worn' as worn \gset
reset role;
select tests.assert(:'worn'::jsonb ? 'laurel_wreath', 'a won exclusive accessory can be worn');

-- =============================================================================
-- D. The lobby: watch to join, countdown from 3, start at 10 or when it runs out
-- =============================================================================
select tests.battle_reset();
select tests.login_as('authenticated', :e);
select tests.throws_key($$select public.battle_join(gen_random_uuid())$$, 'battle_not_viewer',
  'battle_join(): only who watches the news can join (NX150)');
reset role;
select tests.set_level(:e, 1);
select tests.login_as('authenticated', :e);
select public.get_battle() is not null as ok \gset
select tests.throws_key($$select public.battle_join(gen_random_uuid())$$, 'locked',
  'battle_join(): battles come after the tutorial (level 2)');
reset role;
select tests.set_level(:e, 3);

select tests.login_as('authenticated', :a);
select public.get_battle() as g0 \gset
select public.battle_join(:rq) as j1 \gset
select public.battle_join(:rq) as j1b \gset
reset role;
select tests.assert(
  :'g0'::jsonb -> 'battle' ->> 'status' = 'open' and :'g0'::jsonb #>> '{battle,kind}' is null
  and :'g0'::jsonb #>> '{battle,seed}' is null and :'g0'::jsonb #>> '{battle,prize,kind}' in ('xp', 'money', 'skin', 'nft')
  and (:'j1'::jsonb #>> '{battle,joined}')::boolean and jsonb_array_length(:'j1'::jsonb #> '{battle,players}') = 1
  and :'j1b'::jsonb = :'j1'::jsonb and (tests.live_battle()).countdown_ends_at is null,
  'get_battle() opens a lobby (game and seed secret, the prize shown); battle_join() is idempotent per request');
select tests.login_as('authenticated', :b);
select public.get_battle() is not null as ok \gset
select public.battle_join(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.assert((tests.live_battle()).countdown_ends_at is null, 'two players: no countdown yet');
select tests.login_as('authenticated', :c);
select public.get_battle() is not null as ok \gset
select public.battle_join(gen_random_uuid()) as j3 \gset
reset role;
select tests.assert(
  (tests.live_battle()).countdown_ends_at between now() + interval '25 seconds' and now() + interval '31 seconds'
  and (:'j3'::jsonb #>> '{battle,countdown_ends_at}') is not null,
  'the third player starts the countdown (30 s)');
select tests.login_as('authenticated', :c);
select public.battle_leave(gen_random_uuid()) as l3 \gset
reset role;
select tests.assert((tests.live_battle()).countdown_ends_at is null
  and jsonb_array_length(:'l3'::jsonb #> '{battle,players}') = 2 and not (:'l3'::jsonb #>> '{battle,joined}')::boolean,
  'leaving the lobby below 3 stops the countdown');
select tests.login_as('authenticated', :c);
select public.battle_join(gen_random_uuid()) is not null as ok \gset
reset role;
-- an idle player is dropped from the lobby
update public.battle_players set seen_at = now() - interval '1 minute' where player_id = :b and active;
select public.battle_maintain(now());
select tests.assert(not exists (select 1 from public.battle_players where player_id = :b and active)
  and (tests.live_battle()).countdown_ends_at is null,
  'a player not seen for 15 s is taken out of the lobby');
select tests.login_as('authenticated', :b);
select public.get_battle() is not null as ok \gset
select public.battle_join(gen_random_uuid()) is not null as ok \gset
reset role;
-- the countdown runs out: the battle starts with the intro
update public.battles set countdown_ends_at = now() - interval '1 second' where status = 'open';
select (tests.live_battle()).id as bid \gset
select public.battle_maintain(now());
select tests.assert(
  (select status from public.battles where id = :bid) = 'running'
  and (select kind from public.battles where id = :bid) is not null
  and (select started_at from public.battles where id = :bid) between now() + interval '5 seconds' and now() + interval '7 seconds'
  and (select array_agg(slot order by joined_at) from public.battle_players where battle_id = :bid) = array[0, 1, 2]::smallint[]
  and (select params ->> 'tickMs' from public.battles where id = :bid) = '50',
  'when the countdown ends the battle starts: game picked, slots by join order, rules copied, intro first');
select tests.login_as('authenticated', :d);
select public.get_battle() as gd \gset
select tests.throws_key($$select public.battle_join(gen_random_uuid())$$, 'battle_closed',
  'battle_join(): no joining while a battle runs (NX152)');
reset role;
select tests.assert(:'gd'::jsonb #>> '{battle,status}' = 'running' and not (:'gd'::jsonb #>> '{battle,joined}')::boolean
  and :'gd'::jsonb #> '{battle,plan}' is null,
  'others see the running battle (and can watch), never the plan');

-- ten players start at once; the eleventh is refused
select tests.battle_reset();
create temp table battle_crowd as
  select ('0ba771e0-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid as id, i from generate_series(1, 11) i;
select count(tests.signup(id, 'Bat_Crowd' || i)) as ok from battle_crowd \gset
select count(tests.set_level(id, 2)) as ok from battle_crowd \gset
insert into public.news_show_viewers (player_id, seen_at) select id, now() from battle_crowd
on conflict (player_id) do update set seen_at = excluded.seen_at;
select public.battle_maintain(now());
do $$
declare r record;
begin
  for r in select id from battle_crowd where i <= 9 order by i loop
    perform tests.login_as('authenticated', r.id);
    perform public.battle_join(gen_random_uuid());
    reset role;
  end loop;
end;
$$;
select tests.assert((tests.live_battle()).status = 'open' and (tests.live_battle()).countdown_ends_at is not null,
  'nine players: still the countdown');
select tests.login_as('authenticated', (select id from battle_crowd where i = 10));
select public.battle_join(gen_random_uuid()) as j10 \gset
reset role;
select tests.assert(:'j10'::jsonb #>> '{battle,status}' = 'running'
  and jsonb_array_length(:'j10'::jsonb #> '{battle,players}') = 10,
  'the tenth player starts the battle at once');
select tests.login_as('authenticated', (select id from battle_crowd where i = 11));
select public.get_battle() is not null as ok \gset
select tests.throws_key($$select public.battle_join(gen_random_uuid())$$, 'battle_closed',
  'battle_join(): an eleventh player cannot join the running battle');
reset role;
-- =============================================================================
-- E. An action game: inputs over battle_sync, the server re-simulates, money prize
-- =============================================================================
select tests.battle_reset();
select tests.login_as('authenticated', :a);
select public.get_battle() is not null as ok \gset
select public.battle_join(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.get_battle() is not null as ok \gset
select public.battle_join(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select public.get_battle() is not null as ok \gset
select public.battle_join(gen_random_uuid()) is not null as ok \gset
reset role;
update public.battles set countdown_ends_at = now() - interval '1 second', prize = '{"kind":"money"}' where status = 'open';
select (tests.live_battle()).id as bid \gset
select public.battle_maintain(now());
-- Kurssturz, three seconds in (tick 60; ticks before 40 are final)
update public.battles set kind = 'floor', params = public.battle_params('floor'), plan = '{}',
                          started_at = now() - interval '3 seconds',
                          ends_at = now() - interval '3 seconds' + interval '72 seconds'
 where id = :bid;
select tests.login_as('authenticated', :a);
select public.battle_sync(:bid, 0, repeat('2', 75), 0, null) as s1 \gset
select public.battle_sync(:bid, 40, repeat('4', 30), 0, null) as s2 \gset
reset role;
select tests.assert(
  (select inputs from public.battle_players where battle_id = :bid and player_id = :a)
    ~ '^x{40,42}2{20,40}$'
  and (:'s1'::jsonb ->> 'final_tick')::integer between 39 and 42
  and :'s1'::jsonb ->> 'status' = 'running' and jsonb_array_length(:'s1'::jsonb -> 'streams') = 3
  and (select inputs from public.battle_players where battle_id = :bid and player_id = :a)
      = (select (x ->> 'data') from jsonb_array_elements(:'s2'::jsonb -> 'streams') x where (x ->> 'slot')::integer = 0),
  'battle_sync(): final ticks become "x", inputs are never rewritten, nothing far ahead, everyone''s streams back');
-- a spectator cannot send inputs; nobody can claim an end too early
select tests.login_as('authenticated', :d);
select public.battle_sync(:bid, 0, repeat('1', 10), 0, 0) as s3 \gset
reset role;
select tests.assert(:'s3'::jsonb ->> 'status' = 'running'
  and not exists (select 1 from public.battle_players where battle_id = :bid and player_id = :d),
  'battle_sync(): a spectator gets the streams but sends nothing and ends nothing');
select tests.login_as('authenticated', :b);
select public.battle_sync(:bid, 0, '', 0, 1) as s4 \gset
reset role;
select tests.assert(:'s4'::jsonb ->> 'status' = 'running' and (select status from public.battles where id = :bid) = 'running',
  'a claimed end the simulation does not confirm changes nothing (cheating a win is not possible)');
-- the game is over (60 s later): everyone stood still or ran into a wall, the server decides
select tests.cash(:a) + tests.cash(:b) + tests.cash(:c) as cash_before \gset
select tests.households() as hh0 \gset
update public.battles set started_at = now() - interval '75 seconds', ends_at = now() - interval '2 seconds', checked_at = null
 where id = :bid;
select public.battle_maintain(now());
select * from public.battles where id = :bid \gset fb_
select tests.assert(
  :'fb_status' = 'finished' and :'fb_winner_id' is not null
  and (:'fb_result'::jsonb -> 'ranking') = (public.battle_sim('floor', :fb_seed, :'fb_params'::jsonb,
        (select array_agg(inputs order by slot) from public.battle_players where battle_id = :bid), 1400) -> 'ranking')
  and (select array_agg(rank order by slot) from public.battle_players where battle_id = :bid) is not null
  and not exists (select 1 from public.battle_players where battle_id = :bid and active),
  'the server re-simulates the whole game from the inputs and ranks everyone');
select tests.assert(
  (:'fb_result'::jsonb #>> '{prize,kind}') = 'money'
  and (:'fb_result'::jsonb #>> '{prize,cents}')::bigint = 300000 + 75000 * 3
  and tests.cash(:a) + tests.cash(:b) + tests.cash(:c) = :cash_before::bigint + 525000
  and tests.households() = :hh0::bigint - 525000
  and (select count(*) from public.ledger_transactions where idempotency_key = 'battle:' || :bid) = 1
  and exists (select 1 from public.notifications where player_id = :'fb_winner_id'::uuid and type_key = 'battle_won')
  and exists (select 1 from public.feed_items where actor_id = :'fb_winner_id'::uuid and kind = 'battle_won')
  and exists (select 1 from public.news_show_messages where bot_name = 'Mr. Doodle Dangle' and body like '%gewinnt%'),
  'the winner gets 5.250 € from the households, a notification, a feed item and a line in the show''s chat');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after a battle prize');
select tests.assert(public.battle_finish(:bid, now()) = false
  and (select count(*) from public.ledger_transactions where idempotency_key = 'battle:' || :bid) = 1,
  'battle_finish() on a finished battle pays nothing twice');
select tests.login_as('authenticated', :a);
select public.get_battle() as g5 \gset
reset role;
select tests.assert(:'g5'::jsonb #>> '{recent,id}' = :'bid' and :'g5'::jsonb #>> '{recent,status}' = 'finished'
  and :'g5'::jsonb #>> '{battle,status}' = 'open',
  'after the battle the next lobby opens; the last one stays readable (podium)');

-- leaving a running action game ends the stream with "q": the player is out at once
select tests.battle_reset();
insert into public.battles (status, kind, seed, params, prize, started_at, ends_at)
values ('running', 'coins', 5, public.battle_params('coins'), '{"kind":"xp"}', now() - interval '2 seconds', now() + interval '50 seconds')
returning id as qid \gset
insert into public.battle_players (battle_id, player_id, slot) values (:qid, :a, 0), (:qid, :b, 1), (:qid, :c, 2);
select tests.login_as('authenticated', :c);
select public.battle_leave(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.assert((select inputs ~ '^x{35,45}q$' and left_at is not null and not active
                       from public.battle_players where battle_id = :qid and player_id = :c),
  'battle_leave() during an action game forfeits ("q" in the stream)');

-- =============================================================================
-- F. Börsenquiz: answers with the server clock, hearts, XP prize, idempotent payout
-- =============================================================================
select tests.battle_reset();
insert into public.battles (status, kind, seed, params, plan, prize, started_at, ends_at)
values ('running', 'quiz', 11, public.battle_params('quiz'),
        '{"questions":[{"q":"A?","options":["w","r","w","w"],"correct":1},{"q":"B?","options":["r","w","w","w"],"correct":0},{"q":"C?","options":["w","w","r","w"],"correct":2}]}',
        '{"kind":"xp"}', now() - interval '1 second', now() + interval '33 seconds')
returning id as zid \gset
insert into public.battle_players (battle_id, player_id, slot) values (:zid, :a, 0), (:zid, :b, 1), (:zid, :c, 2);
select tests.login_as('authenticated', :a);
select public.battle_answer(gen_random_uuid(), :zid, 0, 1, null) as q1 \gset
select public.battle_answer(gen_random_uuid(), :zid, 0, 2, null) is not null as ok \gset
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 1, 0, null)', :zid), 'battle_round_closed',
  'battle_answer(): a round that is not open yet is closed (NX154)');
reset role;
select tests.login_as('authenticated', :b);
select public.battle_answer(gen_random_uuid(), :zid, 0, 3, null) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :d);
select tests.throws_key(format('select public.battle_answer(gen_random_uuid(), %s, 0, 1, null)', :zid), 'battle_not_joined',
  'battle_answer(): only players of the battle answer (NX153)');
reset role;
select tests.assert(
  (select choice from public.battle_answers where battle_id = :zid and player_id = :a and round = 0) = 1
  and :'q1'::jsonb #> '{battle,rounds,list,0}' ? 'question'
  and not (:'q1'::jsonb #> '{battle,rounds,list,0}' ? 'correct')
  and :'q1'::jsonb #>> '{battle,rounds,list,0,mine,choice}' = '1',
  'the first answer counts; the right one stays secret while the round is open');
-- round 0 is over: A right (fast), B wrong, C nothing -> B and C lose a heart
update public.battles set started_at = now() - interval '9 seconds' where id = :zid;
update public.battle_answers set answered_at = (select started_at from public.battles where id = :zid) + interval '2 seconds'
 where battle_id = :zid and round = 0;
select public.battle_rounds_eval(b, now()) as ev from public.battles b where b.id = :zid \gset
select tests.assert(
  (:'ev'::jsonb ->> 'closed')::integer = 1 and :'ev'::jsonb -> 'hearts' = '[2, 1, 1]'::jsonb
  and (:'ev'::jsonb #>> '{points,0}')::integer = 500 + (500 * 6000) / 8000 and :'ev'::jsonb #> '{results,0,lost}' = '[1, 2]'::jsonb,
  'a right answer after 2 s scores 875; wrong or none costs a heart');
-- round 1: everybody wrong -> nobody loses a heart; round 2: only A right -> B and C are out, A wins
update public.battles set started_at = started_at - interval '25 seconds' where id = :zid;
update public.battle_answers set answered_at = answered_at - interval '25 seconds' where battle_id = :zid;
insert into public.battle_answers (battle_id, round, player_id, choice, answered_at)
select :zid, r, p, c, (select started_at from public.battles where id = :zid) + make_interval(secs => r * 11 + 1)
  from (values (1, :a::uuid, 3), (1, :b::uuid, 3), (1, :c::uuid, 3), (2, :a::uuid, 2), (2, :b::uuid, 0)) v(r, p, c);
select public.battle_rounds_eval(b, now()) as ev2 from public.battles b where b.id = :zid \gset
select tests.assert(
  :'ev2'::jsonb -> 'hearts' = '[2, 0, 0]'::jsonb and :'ev2'::jsonb #> '{results,1,lost}' = '[]'::jsonb
  and (:'ev2'::jsonb ->> 'done')::boolean and :'ev2'::jsonb #>> '{ranking,0}' = '0',
  'when everybody is wrong nobody loses a heart; the last one with hearts wins');
select tests.set_level(:a, 3);
select xp_total as xp0 from public.profiles where id = :a \gset
select public.battle_maintain(now());
select tests.assert(
  (select status from public.battles where id = :zid) = 'finished'
  and (select winner_id from public.battles where id = :zid) = :a
  and (select xp_total from public.profiles where id = :a) > :xp0::bigint
  and (select result #>> '{prize,kind}' from public.battles where id = :zid) = 'xp',
  'the quiz ends after the reveal of the deciding round; the winner gets the XP prize (grant_xp)');

-- =============================================================================
-- G. Die Glocke: false start, reaction from the moment the bell was shown
-- =============================================================================
select tests.battle_reset();
insert into public.battles (status, kind, seed, params, plan, prize, started_at, ends_at)
values ('running', 'bell', 3, public.battle_params('bell'), '{"waits":[2000,2000,2000,2000,2000,2000,2000,2000,2000]}',
        '{"kind":"xp"}', now() - interval '1500 milliseconds', now() + interval '90 seconds')
returning id as lid \gset
insert into public.battle_players (battle_id, player_id, slot) values (:lid, :a, 0), (:lid, :b, 1), (:lid, :c, 2);
select tests.login_as('authenticated', :b);
select public.battle_answer(gen_random_uuid(), :lid, 0, null, null) as early \gset
reset role;
select tests.assert(:'early'::jsonb #>> '{battle,rounds,list,0,bell_at}' is null,
  'before the bell nobody sees when it rings');
-- the bell rang 300 ms ago: A sees it now, presses 250 ms later; C never presses
update public.battles set started_at = started_at - interval '1800 milliseconds' where id = :lid;
update public.battle_answers set answered_at = answered_at - interval '1800 milliseconds' where battle_id = :lid;
select tests.login_as('authenticated', :a);
select public.get_battle() as gb \gset
reset role;
select tests.assert(:'gb'::jsonb #>> '{battle,rounds,list,0,bell_at}' is not null
  and exists (select 1 from public.battle_answers where battle_id = :lid and player_id = :a and round = 0 and revealed_at is not null),
  'once it rang the server shows the bell and remembers when');
update public.battle_answers set answered_at = revealed_at + interval '250 milliseconds' where battle_id = :lid and player_id = :a;
update public.battles set started_at = started_at - interval '2700 milliseconds' where id = :lid;
update public.battle_answers set answered_at = answered_at - interval '2700 milliseconds',
                                 revealed_at = revealed_at - interval '2700 milliseconds' where battle_id = :lid;
select public.battle_rounds_eval(b, now()) as ev3 from public.battles b where b.id = :lid \gset
select tests.assert(
  :'ev3'::jsonb -> 'hearts' = '[2, 1, 1]'::jsonb
  and (select (x ->> 'ms')::integer from jsonb_array_elements(:'ev3'::jsonb #> '{results,0,answers}') x where (x ->> 'slot')::integer = 0) = 250
  and (select (x ->> 'right')::boolean from jsonb_array_elements(:'ev3'::jsonb #> '{results,0,answers}') x where (x ->> 'slot')::integer = 1) = false,
  'the reaction counts from when the bell was shown (250 ms); a false start and no press cost a heart');

-- =============================================================================
-- H. Prizes: an exclusive skin the winner does not own yet, an NFT from the gallery, the daily cap
-- =============================================================================
select tests.battle_reset();
insert into public.battles (status, kind, seed, params, prize, started_at, ends_at)
values ('running', 'pump', 9, public.battle_params('pump'), '{"kind":"skin"}', now() - interval '40 seconds', now() - interval '1 second')
returning id as kid \gset
insert into public.battle_players (battle_id, player_id, slot, inputs)
values (:kid, :d, 0, repeat('1', 600)), (:kid, :b, 1, repeat('0', 600)), (:kid, :c, 2, repeat('0', 600));
insert into public.player_accessories (player_id, accessory_key, price_paid_cents)
select :d, x ->> 'key', 0 from jsonb_array_elements(public.battles_cfg() -> 'accessories') x
 where x ->> 'key' <> 'mini_bull';
select public.battle_maintain(now());
select tests.assert(
  (select winner_id from public.battles where id = :kid) = :d
  and (select result #>> '{prize,key}' from public.battles where id = :kid) = 'mini_bull'
  and exists (select 1 from public.player_accessories where player_id = :d and accessory_key = 'mini_bull'),
  'a skin prize is an exclusive accessory the winner does not own yet');
-- an NFT from the gallery changes hands
select tests.battle_reset();
select id as art from public.artworks where owner_id is null and ai_owner is null and gallery_key is not null
   and not exists (select 1 from public.artwork_auctions x where x.artwork_id = artworks.id and x.status = 'open')
 order by serial limit 1 \gset
insert into public.battles (status, kind, seed, params, prize, artwork_id, started_at, ends_at)
values ('running', 'pump', 9, public.battle_params('pump'), '{"kind":"nft"}', :'art', now() - interval '40 seconds', now() - interval '1 second')
returning id as nid \gset
insert into public.battle_players (battle_id, player_id, slot, inputs)
values (:nid, :e, 0, repeat('1', 600)), (:nid, :b, 1, ''), (:nid, :c, 2, '');
select public.battle_maintain(now());
select tests.assert(
  (select owner_id from public.artworks where id = :'art') = :e
  and (select result #>> '{prize,kind}' from public.battles where id = :nid) = 'nft',
  'an NFT prize: the reserved gallery artwork goes to the winner');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after skin and NFT prizes');
-- the daily cap: E won once today; with a cap of 1 the next win pays nothing
select tests.set_cfg('battles', '{prizes,dailyPrizeCap}', '1');
select tests.battle_reset();
insert into public.battles (status, kind, seed, params, prize, started_at, ends_at)
values ('running', 'pump', 9, public.battle_params('pump'), '{"kind":"money"}', now() - interval '40 seconds', now() - interval '1 second')
returning id as cid \gset
insert into public.battle_players (battle_id, player_id, slot, inputs)
values (:cid, :e, 0, repeat('1', 600)), (:cid, :b, 1, ''), (:cid, :c, 2, '');
select tests.cash(:e) as cash_e \gset
select public.battle_maintain(now());
select tests.assert(
  (select winner_id from public.battles where id = :cid) = :e and tests.cash(:e) = :cash_e::bigint
  and (select (result ->> 'capped')::boolean from public.battles where id = :cid),
  'over the daily cap the winner keeps the glory but gets no prize (no farming)');
select tests.set_cfg('battles', '{prizes,dailyPrizeCap}', '3');

-- =============================================================================
-- I. Missions: playing (at the start) and winning count
-- =============================================================================
select tests.assert(
  (select count(*) from public.mission_templates where key in ('w_battles', 'm_battle_first', 'm_battle_win', 'm_battle_win_10')
      and metric in ('battle_join', 'battle_win')) = 4,
  'mission templates for playing and winning battles');
select tests.battle_reset();
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward) values
  (:e, 'm_battle_first', 'milestone', date '1999-01-02', 1, 300),
  (:e, 'm_battle_win', 'milestone', date '1999-01-02', 1, 800);
select public.battle_maintain(now());
do $$
declare r uuid;
begin
  foreach r in array array['0ba771e0-0000-4000-8000-0000000000e1', '0ba771e0-0000-4000-8000-0000000000b1',
                           '0ba771e0-0000-4000-8000-0000000000c1']::uuid[] loop
    perform tests.login_as('authenticated', r);
    perform public.get_battle();
    perform public.battle_join(gen_random_uuid());
    reset role;
  end loop;
end;
$$;
update public.battles set countdown_ends_at = now() - interval '1 second' where status = 'open';
select (tests.live_battle()).id as mid \gset
select public.battle_maintain(now());
select tests.assert(
  (select progress from public.player_missions where player_id = :e and template_key = 'm_battle_first') = 1
  and (select progress from public.player_missions where player_id = :e and template_key = 'm_battle_win') = 0,
  'mission_event battle_join for every player when the battle starts');
update public.battles set kind = 'pump', params = public.battle_params('pump'), plan = '{}',
                          started_at = now() - interval '40 seconds', ends_at = now() - interval '1 second'
 where id = :mid;
update public.battle_players set inputs = case when player_id = :e then repeat('1', 600) else '' end where battle_id = :mid;
select public.battle_maintain(now());
select tests.assert(
  (select winner_id from public.battles where id = :mid) = :e
  and (select progress from public.player_missions where player_id = :e and template_key = 'm_battle_win') = 1,
  'mission_event battle_win for the winner');
select tests.battle_reset();
