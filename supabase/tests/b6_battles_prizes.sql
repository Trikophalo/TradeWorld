-- =============================================================================
-- b6 · News battles: five more action games, accessory and sealed booster prizes, sealed packs (ADR-177)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
-- many battles in one hour here: no hourly limit; the original value comes back at the end
select value #> '{lobby,perHour}' as per_hour0 from public.game_config where key = 'battles' \gset
select value #> '{prizes,dailyPrizeCap}' as cap0 from public.game_config where key = 'battles' \gset
select value #> '{prizes,weights}' as weights0 from public.game_config where key = 'battles' \gset
select tests.set_cfg('battles', '{lobby,perHour}', '1000');
select tests.set_cfg('battles', '{prizes,dailyPrizeCap}', '1000');

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
create or replace function tests.b6_reset() returns void language sql as $$
  update public.battle_players set active = false where active;
  update public.battles set status = 'cancelled', finished_at = now() where status in ('open', 'running');
$$;
-- A running action game of p_kind with the players in slot order, started p_ago ago, every stream p_inputs
create or replace function tests.b6_battle(p_kind text, p_prize jsonb, p_players uuid[], p_inputs text[], p_ago interval)
returns bigint language plpgsql as $$
declare
  v_id bigint;
  k integer;
begin
  perform tests.b6_reset();
  insert into public.battles (status, kind, seed, params, prize, started_at, ends_at)
  values ('running', p_kind, 23, public.battle_params(p_kind), p_prize, now() - p_ago, now() - interval '1 second')
  returning id into v_id;
  for k in 1 .. cardinality(p_players) loop
    insert into public.battle_players (battle_id, player_id, slot, inputs) values (v_id, p_players[k], k - 1, p_inputs[k]);
  end loop;
  return v_id;
end;
$$;
create or replace function tests.b6_sealed(p_player uuid) returns bigint language sql security definer as $$
  select count(*) from public.nexamon_sealed_packs where player_id = p_player and opened_at is null $$;
grant execute on all functions in schema tests to public;

\set a '''0b6b6b6b-0000-4000-8000-0000000000a1'''
\set b '''0b6b6b6b-0000-4000-8000-0000000000b1'''
\set c '''0b6b6b6b-0000-4000-8000-0000000000c1'''
\set d '''0b6b6b6b-0000-4000-8000-0000000000d1'''
\set rq '''0b6b6b6b-0000-4000-8000-0000000000e1'''
\set rs '''0b6b6b6b-0000-4000-8000-0000000000e2'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:a, 'B6_Anna') is not null and tests.signup(:b, 'B6_Bruno') is not null
   and tests.signup(:c, 'B6_Clara') is not null and tests.signup(:d, 'B6_Dora') is not null as ok \gset
select count(tests.set_level(x, 10)) as ok from unnest(array[:a, :b, :c]::uuid[]) x \gset
select tests.set_level(:d, 3);
select tests.fund(:a, 5000000, 'test:b6:a');

-- =============================================================================
-- A. The five new action games give the same results in SQL as in TypeScript (vectors.test.ts)
-- =============================================================================
create temp table b6_vectors (kind text, seed bigint, n integer, cut integer, expect jsonb);
insert into b6_vectors values
  ('zone', 42, 3, -1, '{"end":750,"ranking":[2,0,1],"out":[750,410,-1],"score":[11,5,8]}'),
  ('zone', 7, 6, -1, '{"end":750,"ranking":[1,4,5,3,2,0],"out":[240,-1,410,580,750,580],"score":[1,8,1,0,6,3]}'),
  ('zone', 99, 10, -1, '{"end":750,"ranking":[6,9,5,2,4,0,3,1,7,8],"out":[410,410,750,410,580,750,-1,410,240,750],"score":[6,3,9,4,1,12,16,0,4,17]}'),
  ('zone', 2026, 4, 100, '{"end":580,"ranking":[2,1,0,3],"out":[410,580,-1,179],"score":[0,3,0,0]}'),
  ('tag', 42, 3, -1, '{"end":1199,"ranking":[1,2,0],"out":[-1,-1,-1],"score":[918,69,213]}'),
  ('tag', 7, 6, -1, '{"end":1199,"ranking":[2,4,5,3,1,0],"out":[-1,-1,-1,-1,-1,-1],"score":[765,153,51,102,57,72]}'),
  ('tag', 99, 10, -1, '{"end":1199,"ranking":[1,4,5,9,0,8,7,2,3,6],"out":[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],"score":[87,0,201,216,0,54,243,183,153,63]}'),
  ('tag', 2026, 4, 100, '{"end":1199,"ranking":[2,0,1,3],"out":[-1,-1,-1,179],"score":[507,522,171,0]}'),
  ('tiles', 42, 3, -1, '{"end":80,"ranking":[0,1,2],"out":[-1,80,76],"score":[17,10,11]}'),
  ('tiles', 7, 6, -1, '{"end":92,"ranking":[3,1,2,4,0,5],"out":[48,92,90,-1,84,40],"score":[10,17,15,19,12,8]}'),
  ('tiles', 99, 10, -1, '{"end":123,"ranking":[2,1,0,3,6,7,9,8,5,4],"out":[104,123,-1,88,54,58,80,76,58,60],"score":[15,13,20,13,11,9,12,10,10,11]}'),
  ('tiles', 2026, 4, 100, '{"end":94,"ranking":[2,3,0,1],"out":[86,46,-1,94],"score":[14,8,16,17]}'),
  ('paint', 42, 3, -1, '{"end":899,"ranking":[2,0,1],"out":[-1,-1,-1],"score":[36,21,42]}'),
  ('paint', 7, 6, -1, '{"end":899,"ranking":[4,3,5,0,2,1],"out":[-1,-1,-1,-1,-1,-1],"score":[14,8,11,25,26,15]}'),
  ('paint', 99, 10, -1, '{"end":899,"ranking":[7,8,6,2,3,0,4,9,5,1],"out":[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],"score":[9,6,12,10,8,7,13,14,13,7]}'),
  ('paint', 2026, 4, 100, '{"end":899,"ranking":[0,1,2,3],"out":[-1,-1,-1,179],"score":[50,34,14,0]}'),
  ('crash', 42, 3, -1, '{"end":526,"ranking":[2,1,0],"out":[526,526,-1],"score":[0,0,3]}'),
  ('crash', 7, 6, -1, '{"end":784,"ranking":[2,0,4,3,5,1],"out":[784,314,-1,476,706,424],"score":[0,0,1,0,0,0]}'),
  ('crash', 99, 10, -1, '{"end":854,"ranking":[0,9,1,7,2,3,5,6,4,8],"out":[-1,784,706,620,424,620,424,746,370,854],"score":[1,0,0,0,0,0,0,0,0,0]}'),
  ('crash', 2026, 4, 100, '{"end":854,"ranking":[2,1,0,3],"out":[526,854,854,179],"score":[0,0,0,3]}');
create temp table b6_vector_results as
  select v.kind, v.seed, v.n, v.cut, v.expect,
         public.battle_sim(v.kind, v.seed, public.battle_params(v.kind),
                           (select array_agg(case when v.cut >= 0 and s = v.n - 1 then left(tests.battle_bot(v.seed, v.kind, s, 2000), v.cut)
                                                  else tests.battle_bot(v.seed, v.kind, s, 2000) end order by s)
                              from generate_series(0, v.n - 1) s), 2000) as got
    from b6_vectors v;
select tests.assert(
  (r.got ->> 'end_tick')::integer = (r.expect ->> 'end')::integer and r.got -> 'ranking' = r.expect -> 'ranking'
  and r.got -> 'out' = r.expect -> 'out' and r.got -> 'score' = r.expect -> 'score' and (r.got ->> 'done')::boolean,
  format('battle_sim_%s(seed %s, %s players%s) = TypeScript: %s', r.kind, r.seed, r.n,
         case when r.cut >= 0 then ', one disconnects' else '' end, r.got::text))
  from b6_vector_results r order by r.kind, r.seed;
select tests.assert(
  public.battle_is_tick('zone') and public.battle_is_tick('tag') and public.battle_is_tick('tiles')
  and public.battle_is_tick('paint') and public.battle_is_tick('crash') and public.battle_is_tick('rodeo')
  and not public.battle_is_tick('quiz'),
  'battle_is_tick(): the five new games are lockstep games');
select tests.assert(
  (select count(*) from jsonb_object_keys((select value -> 'weights' from public.game_config where key = 'battles')) k
    where k in ('zone', 'tag', 'tiles', 'paint', 'crash')) = 5
  and public.battle_params('crash') -> 'game' ? 'warnTicks' and public.battle_params('zone') -> 'game' ? 'radiusMin',
  'the five new games have weights and rules in game_config.battles');

-- =============================================================================
-- B. A new game judged by the server: Crash-Regen over battle_maintain, the sealed booster prize
-- =============================================================================
select tests.b6_battle('crash', jsonb_build_object('kind', 'packs', 'packs', public.battle_pick_packs(2000000, 8, 0, 0, 0.1, 0.99)),
                       array[:a, :b, :c]::uuid[],
                       array[repeat('1234', 500), repeat('0', 2000), repeat('0', 2000)], interval '100 seconds') as cid \gset
select (select sum((x ->> 'count')::integer) from jsonb_array_elements(prize -> 'packs') x) as cpacks
  from public.battles where id = :cid \gset
select tests.assert(
  (select prize -> 'packs' from public.battles where id = :cid)
    = '[{"set": "prismatic_peak", "count": 1}, {"set": "mystic_energy", "count": 7}]'::jsonb,
  'battle_pick_packs() = pickPackPrize(): 1 × Prismatic Peak + 7 × Mystic Energy for the same random numbers');
select public.battle_sim('crash', 23, public.battle_params('crash'),
                         array[repeat('1234', 500), repeat('0', 2000), repeat('0', 2000)], 2000) as csim \gset
select tests.cash(:a) as cash_a0 \gset
select public.battle_maintain(now());
select (select slot from public.battle_players where battle_id = :cid and player_id = winner_id) as cwin,
       winner_id as cwid, result as cres
  from public.battles where id = :cid \gset
select tests.assert(
  (select status from public.battles where id = :cid) = 'finished'
  and :cwin::integer = (:'csim'::jsonb #>> '{ranking,0}')::integer
  and (:'cres'::jsonb #>> '{prize,kind}') = 'packs'
  and (:'cres'::jsonb #>> '{prize,cents}')::bigint <= 2000000
  and tests.b6_sealed(:'cwid') = :cpacks::bigint
  and (select count(*) from public.nexamon_sealed_packs where battle_id = :cid and source = 'battle' and price_cents = 0) = :cpacks::bigint,
  'Crash-Regen is judged by the server simulation; the winner gets the sealed packs, worth at most 20.000 €');
select tests.assert(public.battle_prize_label(:'cres'::jsonb -> 'prize') = '1 × Nexamon: Prismatic Peak + 7 × Nexamon: Mystic Energy (ungeöffnet)',
  'the prize label names the packs');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after a pack prize');

-- the pack pick never exceeds the cap or the pack limit
select tests.assert(bool_and(
         (select coalesce(sum((x ->> 'count')::bigint * (public.nexamon_cfg() #>> array['sets', x ->> 'set', 'packPriceCents'])::bigint), 0)
            from jsonb_array_elements(p) x) <= 2000000
         and (select coalesce(sum((x ->> 'count')::integer), 0) from jsonb_array_elements(p) x) between 1 and 8),
  'battle_pick_packs(): 300 draws, never above 20.000 € or 8 packs')
  from (select public.battle_pick_packs(2000000, 8, random(), random(), random(), random()) as p
          from generate_series(1, 300)) z;
select tests.assert(public.battle_pick_packs(10000, 8, 0.5, 0.5, 0.1, 0.5) = '[]'::jsonb,
  'battle_pick_packs(): nothing when no set fits the cap');

-- the opening draws the new kinds
select tests.set_cfg('battles', '{prizes,weights}', '{"packs": 1}');
select tests.b6_reset();
select public.battle_open(now()) as oid \gset
select tests.assert((select prize ->> 'kind' from public.battles where id = :oid) = 'packs'
  and jsonb_array_length((select prize -> 'packs' from public.battles where id = :oid)) between 1 and 2,
  'battle_open(): a packs prize carries its packs (shown before the battle)');
select tests.set_cfg('battles', '{prizes,weights}', '{"accessory": 1}');
select tests.b6_reset();
select public.battle_open(now()) as oid2 \gset
select tests.assert((select prize ->> 'tier' from public.battles where id = :oid2) in ('rare', 'epic', 'legendary')
  and public.battle_prize_json((select b from public.battles b where b.id = :oid2), 3) ->> 'kind' = 'accessory',
  'battle_open(): an accessory prize carries its tier');
select tests.set_cfg('battles', '{prizes,weights}', :'weights0'::jsonb);

-- =============================================================================
-- C. Accessory prize: a random shop accessory of the tier the winner does not own; else money
-- =============================================================================
-- Bruno owns every epic but one
select i ->> 'key' as last_epic from jsonb_array_elements(public.accessories_cfg() -> 'items') i
 where i ->> 'rarity' = 'epic' and not coalesce((i ->> 'exclusive')::boolean, false) order by i ->> 'key' limit 1 \gset
insert into public.player_accessories (player_id, accessory_key, price_paid_cents)
select :b, i ->> 'key', 0 from jsonb_array_elements(public.accessories_cfg() -> 'items') i
 where i ->> 'rarity' = 'epic' and not coalesce((i ->> 'exclusive')::boolean, false) and i ->> 'key' <> :'last_epic';
select tests.b6_battle('paint', '{"kind": "accessory", "tier": "epic"}', array[:b, :c, :a]::uuid[],
                       array[repeat('5123', 300), repeat('0', 1000), repeat('0', 1000)], interval '60 seconds') as pid \gset
select public.battle_sim('paint', 23, public.battle_params('paint'),
                         array[repeat('5123', 300), repeat('0', 1000), repeat('0', 1000)], 2000) -> 'ranking' as prank \gset
select public.battle_maintain(now());
select tests.assert(
  (select status from public.battles where id = :pid) = 'finished'
  and (:'prank'::jsonb ->> 0)::integer = 0
  and (select winner_id from public.battles where id = :pid) = :b
  and (select result #>> '{prize,key}' from public.battles where id = :pid) = :'last_epic'
  and exists (select 1 from public.player_accessories where player_id = :b and accessory_key = :'last_epic'),
  'Farbrausch judged by the server; the accessory prize is the one epic accessory the winner did not own');
select tests.cash(:b) as cash_b0 \gset
select tests.b6_battle('paint', '{"kind": "accessory", "tier": "epic"}', array[:b, :c, :a]::uuid[],
                       array[repeat('5123', 300), repeat('0', 1000), repeat('0', 1000)], interval '60 seconds') as pid2 \gset
select public.battle_maintain(now());
select tests.assert(
  (select result #>> '{prize,kind}' from public.battles where id = :pid2) = 'money'
  and (select (result #>> '{prize,fallback}')::boolean from public.battles where id = :pid2)
  and tests.cash(:b) = :cash_b0::bigint + (select (result #>> '{prize,cents}')::bigint from public.battles where id = :pid2),
  'owning every accessory of the tier: the money prize instead');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after accessory prizes');

-- the other three new games end and are judged too
select tests.b6_battle('zone', '{"kind": "xp"}', array[:a, :b, :c]::uuid[],
                       array[repeat('0', 2000), repeat('0', 2000), repeat('0', 2000)], interval '100 seconds') as zid \gset
select public.battle_maintain(now());
select tests.b6_battle('tag', '{"kind": "xp"}', array[:a, :b, :c]::uuid[],
                       array[repeat('1234', 500), repeat('2143', 500), repeat('3412', 500)], interval '100 seconds') as tid \gset
select public.battle_maintain(now());
select tests.b6_battle('tiles', '{"kind": "xp"}', array[:a, :b, :c]::uuid[],
                       array[repeat('0', 2000), repeat('1313', 500), repeat('2424', 500)], interval '100 seconds') as lid \gset
select public.battle_maintain(now());
select tests.assert(
  (select count(*) from public.battles where id in (:zid, :tid, :lid) and status = 'finished' and winner_id is not null) = 3,
  'Goldrausch-Zone, Bulle und Bär and Wackelparkett end and get a winner on the server');

-- =============================================================================
-- D. Sealed packs: list, open exactly once (idempotent), not someone else's
-- =============================================================================
update public.nexamon_sealed_packs set player_id = :a where player_id = :'cwid' and opened_at is null;
select (select sum(population) from public.nexamon_cards) as pop0 \gset
select tests.login_as('authenticated', :a);
select public.get_nexamon_sealed_packs() as gs \gset
select :'gs'::jsonb #>> '{packs,0,id}' as sp1 \gset
select :'gs'::jsonb #>> '{packs,0,set}' as sp1_set \gset
select public.open_nexamon_sealed_pack(:rq, :'sp1') as op1 \gset
select public.open_nexamon_sealed_pack(:rq, :'sp1') as op1b \gset
reset role;
select tests.assert(
  jsonb_array_length(:'gs'::jsonb -> 'packs') = :cpacks::integer and (:'gs'::jsonb ->> 'unlocked')::boolean
  and jsonb_array_length(:'op1'::jsonb -> 'cards') = (public.nexamon_cfg() ->> 'packSize')::integer
  and :'op1'::jsonb ->> 'sealed_id' = :'sp1' and (:'op1'::jsonb ->> 'price_cents')::bigint = 0
  and :'op1b'::jsonb -> 'pack_id' = :'op1'::jsonb -> 'pack_id'
  and (select opened_at is not null and pack_id::text = :'op1'::jsonb ->> 'pack_id' from public.nexamon_sealed_packs where id = :'sp1')
  and exists (select 1 from public.nexamon_packs where id::text = :'op1'::jsonb ->> 'pack_id' and player_id = :a and set_key = :'sp1_set')
  and (select count(*) from public.nexamon_copies where owner_id = :a and pack_id::text = :'op1'::jsonb ->> 'pack_id') = 5
  and (select sum(population) from public.nexamon_cards) = :pop0::bigint + 5
  and tests.b6_sealed(:a) = :cpacks::bigint - 1,
  'open_nexamon_sealed_pack(): a pack opens like a bought one (five copies, population, nexamon_packs), once; a replay answers the same');
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.open_nexamon_sealed_pack(gen_random_uuid(), %L)$$, :'sp1'),
  'sealed_pack_unknown', 'an opened pack cannot be opened again (NX290)');
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key(format($$select public.open_nexamon_sealed_pack(gen_random_uuid(), %L)$$, :'gs'::jsonb #>> '{packs,1,id}'),
  'sealed_pack_unknown', 'someone else''s sealed pack cannot be opened');
reset role;
select tests.login_as('authenticated', :d);
select tests.assert(jsonb_array_length(public.get_nexamon_sealed_packs() -> 'packs') = 0
  and not (public.get_nexamon_sealed_packs() ->> 'unlocked')::boolean, 'get_nexamon_sealed_packs() works while Nexamon is locked');
reset role;

-- =============================================================================
-- E. Buy now, open later: charged like buy_nexamon_pack, then opened from the inventory
-- =============================================================================
select (public.nexamon_cfg() #>> '{sets,mystic_energy,packPriceCents}')::bigint as me_price \gset
select tests.cash(:a) as cash_a1 \gset
select tests.households() as hh1 \gset
select tests.login_as('authenticated', :a);
select public.buy_nexamon_sealed_pack(:rs, 'mystic_energy', 3) as bs \gset
select public.buy_nexamon_sealed_pack(:rs, 'mystic_energy', 3) as bs2 \gset
select tests.throws_key($$select public.buy_nexamon_sealed_pack(gen_random_uuid(), 'mystic_energy', 0)$$,
  'invalid_argument', 'buy_nexamon_sealed_pack(): at least one pack');
select tests.throws_key($$select public.buy_nexamon_sealed_pack(gen_random_uuid(), 'nope', 1)$$,
  'nexamon_unknown', 'buy_nexamon_sealed_pack(): an unknown set');
select tests.throws_key($$select public.buy_nexamon_sealed_pack(gen_random_uuid(), 'prismatic_peak', 20)$$,
  'insufficient_funds', 'buy_nexamon_sealed_pack(): not enough money');
reset role;
select tests.assert(
  tests.cash(:a) = :cash_a1::bigint - 3 * :me_price::bigint
  and (:'bs'::jsonb ->> 'price_cents')::bigint = 3 * :me_price::bigint and :'bs2'::jsonb = :'bs'::jsonb
  and tests.b6_sealed(:a) = :cpacks::bigint + 2
  and (select count(*) from public.nexamon_sealed_packs where player_id = :a and source = 'bought' and price_cents = :me_price::bigint) = 3
  and exists (select 1 from public.ledger_transactions t where t.kind = 'nexamon_pack'
                and (t.metadata ->> 'sealed')::boolean and (t.metadata ->> 'count')::integer = 3),
  'buy_nexamon_sealed_pack(): 3 packs charged once (cash -> households, ledger kind nexamon_pack), all sealed; a replay pays nothing');
select id as bought1 from public.nexamon_sealed_packs where player_id = :a and source = 'bought' and opened_at is null
 order by created_at, id limit 1 \gset
select tests.cash(:a) as cash_a2 \gset
select tests.login_as('authenticated', :a);
select public.open_nexamon_sealed_pack(gen_random_uuid(), :'bought1') as op2 \gset
reset role;
select tests.assert(
  jsonb_array_length(:'op2'::jsonb -> 'cards') = 5 and (:'op2'::jsonb ->> 'set') = 'mystic_energy'
  and (:'op2'::jsonb ->> 'price_cents')::bigint = :me_price::bigint
  and tests.cash(:a) = :cash_a2::bigint and tests.b6_sealed(:a) = :cpacks::bigint + 1,
  'a bought sealed pack opens later without a second charge');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after buying and opening sealed packs');

-- account_wipe takes the sealed packs along
select tests.assert(position('nexamon_sealed_packs' in pg_get_functiondef('public.account_wipe(uuid, text)'::regprocedure)) > 0,
  'account_wipe() deletes the sealed packs');

select tests.b6_reset();
select tests.set_cfg('battles', '{lobby,perHour}', :'per_hour0'::jsonb);
select tests.set_cfg('battles', '{prizes,dailyPrizeCap}', :'cap0'::jsonb);
