-- =============================================================================
-- d7 · Pack Battle modes "Umgekehrt" and "Twist" (ADR-205)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0d7d7d7d-0000-4000-8000-0000000000a1'''
\set b '''0d7d7d7d-0000-4000-8000-0000000000b1'''
\set c '''0d7d7d7d-0000-4000-8000-0000000000c1'''
\set d '''0d7d7d7d-0000-4000-8000-0000000000d1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:a, 'Bm_Lena') is not null and tests.signup(:b, 'Bm_Max') is not null
   and tests.signup(:c, 'Bm_Ida') is not null and tests.signup(:d, 'Bm_Tom') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.set_level(:c, 10);
select tests.set_level(:d, 10);
select tests.fund(:a, 50000000, 'test:d7:a');
select tests.fund(:b, 50000000, 'test:d7:b');
select tests.fund(:c, 50000000, 'test:d7:c');
select tests.fund(:d, 50000000, 'test:d7:d');
insert into public.friendships (requester_id, addressee_id, status, responded_at)
values (:a, :b, 'accepted', now()), (:a, :c, 'accepted', now()), (:a, :d, 'accepted', now());
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{battles,cooldownSeconds}', '0');
select tests.set_cfg('nexamon', '{battles,perHour}', '20');
select tests.set_cfg('nexamon', '{sets,mystic_energy,packPriceCents}', '20000');
select tests.set_cfg('nexamon', '{sets,super_apex,packPriceCents}', '35000');
select tests.set_cfg('nexamon', '{packBattle,twistMs}', '3200');

create or replace function tests.bm(p_id uuid) returns public.nexamon_battles language sql security definer as $$
  select * from public.nexamon_battles where id = p_id $$;
create or replace function tests.bm_escrow() returns bigint language sql security definer as $$
  select balance_cents from public.ledger_accounts where system_key = 'nexamon_battle_escrow' $$;
create or replace function tests.bm_seats(p_id uuid) returns jsonb language sql security definer as $$
  select jsonb_agg(s.cards order by s.seat) from public.nexamon_battle_seats s where s.battle_id = p_id $$;
create or replace function tests.bm_scores(p_id uuid) returns bigint[] language sql security definer as $$
  select array_agg(s.score_cents order by s.seat) from public.nexamon_battle_seats s where s.battle_id = p_id $$;
create or replace function tests.bm_age(p_id uuid, p_ms integer) returns void language sql security definer as $$
  update public.nexamon_battles
     set created_at = created_at - make_interval(secs => p_ms / 1000.0), expires_at = expires_at - make_interval(secs => p_ms / 1000.0),
         accepted_at = accepted_at - make_interval(secs => p_ms / 1000.0), starts_at = starts_at - make_interval(secs => p_ms / 1000.0),
         decide_at = decide_at - make_interval(secs => p_ms / 1000.0), ends_at = ends_at - make_interval(secs => p_ms / 1000.0)
   where id = p_id;
  update public.nexamon_live set ends_at = ends_at - make_interval(secs => p_ms / 1000.0) where battle_id = p_id $$;
-- elapsed ms of a battle answer on its own clock, plus the lead
create or replace function tests.bm_ms(p jsonb) returns numeric language sql as $$
  select extract(epoch from ((p #>> '{battle,server_time}')::timestamptz - (p #>> '{battle,starts_at}')::timestamptz)) * 1000 + 800 $$;
-- cards due (multiRevealAt; p_twist defaults to the answer's twist_ms) and twists due (multiTwistAt) at the answer
create or replace function tests.bm_cards_due(p jsonb, p_twist numeric default null) returns integer language sql as $$
  select count(*)::integer from generate_series(1, jsonb_array_length(p #> '{battle,packs}') * 5) g
   where ((g - 1) / 5 + 1) * 2400 + (g - 1) * 1800 + ((g - 1) / 5) * coalesce(p_twist, (p #>> '{battle,twist_ms}')::numeric)
         <= tests.bm_ms(p) $$;
create or replace function tests.bm_twists_due(p jsonb) returns integer language sql as $$
  select count(*)::integer from generate_series(1, jsonb_array_length(p #> '{battle,packs}')) k
   where k * (2400 + 5 * 1800) + (k - 1) * (p #>> '{battle,twist_ms}')::numeric <= tests.bm_ms(p) $$;
grant execute on all functions in schema tests to public;

select tests.bm_escrow() as esc0 \gset

-- =============================================================================
-- A. The formulas, shared with src/lib/sim/nexamon-battle-modes.test.ts
-- =============================================================================
select tests.assert(
  public.nexamon_battle_twist_perm(0, 1, 2) = '[0,1]'::jsonb
  and public.nexamon_battle_twist_perm(12345, 1, 4) = '[0,1,3,2]'::jsonb
  and public.nexamon_battle_twist_perm(12345, 2, 4) = '[3,1,2,0]'::jsonb
  and public.nexamon_battle_twist_perm(12345, 3, 4) = '[1,3,0,2]'::jsonb
  and public.nexamon_battle_twist_perm(2147483646, 7, 3) = '[1,0,2]'::jsonb
  and public.nexamon_battle_twist_perm(987654321, 10, 4) = '[3,0,1,2]'::jsonb
  and public.nexamon_battle_twist_perm(42, 1, 3) = '[0,2,1]'::jsonb,
  'twist permutation: the same vectors as twistPermutation (TS)');
select tests.assert(
  (select count(distinct public.nexamon_battle_twist_perm(s::bigint * 1000003 + 17, 3, 4)) from generate_series(0, 2399) s) = 24,
  'twist permutation: every one of the 24 orders of four seats occurs');
select tests.assert(
  public.nexamon_pack_battle_decide('[[{"value_cents":100,"rarity":"common"}],[{"value_cents":300,"rarity":"common"}],[{"value_cents":50,"rarity":"rare"}],[]]', 0, true)
    = '{"winner":3,"tie_break":"value","totals":[100,300,50,0]}'::jsonb
  and public.nexamon_pack_battle_decide('[[{"value_cents":500,"rarity":"ultra"}],[{"value_cents":500,"rarity":"rare"}],[{"value_cents":900,"rarity":"legendary"}]]', 0, true)
    = '{"winner":1,"tie_break":"rarest","totals":[500,500,900]}'::jsonb
  and public.nexamon_pack_battle_decide('[[{"value_cents":1,"rarity":"rare"}],[{"value_cents":9,"rarity":"rare"}],[{"value_cents":1,"rarity":"rare"}],[{"value_cents":1,"rarity":"rare"}]]', 1, true) ->> 'winner' = '2'
  and public.nexamon_pack_battle_decide('[[{"value_cents":1,"rarity":"rare"}],[{"value_cents":9,"rarity":"rare"}],[{"value_cents":1,"rarity":"rare"}],[{"value_cents":1,"rarity":"rare"}]]', 5, true)
    = '{"winner":3,"tie_break":"coin","totals":[1,9,1,1]}'::jsonb,
  'reverse: the lowest total wins; ties mirrored (least rare top card, then the coin among those still tied)');
select tests.assert(
  public.nexamon_pack_battle_decide('[[{"value_cents":100,"rarity":"common"}],[{"value_cents":300,"rarity":"common"}]]', 3, false)
    = public.nexamon_pack_battle_decide('[[{"value_cents":100,"rarity":"common"}],[{"value_cents":300,"rarity":"common"}]]', 3),
  'without reverse the decision is the ADR-192 one');
-- seats pull [100 | 10], [200 | 20], [300 | 30] over two packs; twists [2,0,1] then [1,0,2] (as in the TS test)
select public.nexamon_pack_battle_piles(
  '[[{"value_cents":100,"rarity":"common","pack":1,"idx":1},{"value_cents":10,"rarity":"common","pack":2,"idx":2}],
    [{"value_cents":200,"rarity":"rare","pack":1,"idx":1},{"value_cents":20,"rarity":"common","pack":2,"idx":2}],
    [{"value_cents":300,"rarity":"ultra","pack":1,"idx":1},{"value_cents":30,"rarity":"common","pack":2,"idx":2}]]',
  '[[2,0,1],[1,0,2]]', 2) as piles \gset
select tests.assert(
  (select array_agg((select sum((c ->> 'value_cents')::bigint) from jsonb_array_elements(p) c)::bigint order by o)
     from jsonb_array_elements(:'piles'::jsonb) with ordinality t(p, o)) = array[120, 310, 230]::bigint[]
  and :'piles'::jsonb #>> '{1,0,rarity}' = 'ultra'
  and (public.nexamon_pack_battle_decide(:'piles'::jsonb, 0, true) ->> 'winner')::integer = 0
  and (public.nexamon_pack_battle_decide(:'piles'::jsonb, 0, false) ->> 'winner')::integer = 1,
  'piles: pack by pack, then the twist; the cards travel with the pile; reverse and twist combine');

-- =============================================================================
-- B. "Umgekehrt": three players, two packs; the lowest total wins, the winner still takes all
-- =============================================================================
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy'], 2, '{}', null, false)$$,
  'invalid_argument', 'create: the modes are required (not null)');
select public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy', 'super_apex'], 3, array['Bm_Max'], true, false) as cr \gset
reset role;
select (:'cr'::jsonb #>> '{battle,id}')::uuid as r1 \gset
select tests.assert((:'cr'::jsonb #>> '{battle,reverse}')::boolean and not (:'cr'::jsonb #>> '{battle,twist}')::boolean
  and (:'cr'::jsonb #>> '{battle,twist_ms}')::numeric = 0 and :'cr'::jsonb #> '{battle,twists}' = '[]'::jsonb
  and (tests.bm(:'r1')).reverse and not (tests.bm(:'r1')).twist,
  'create: the mode is stored and shown');
select tests.assert(exists (select 1 from public.notifications where player_id = :b and dedupe_key = 'nexamon:battle:invite:' || :'r1' || ':' || :b
                             and body like '%Modus: Umgekehrt.' and (payload ->> 'reverse')::boolean),
  'the invitation names the mode');
select tests.login_as('authenticated', :c);
select public.nexamon_lobby(true) as lc \gset
reset role;
select tests.assert(exists (select 1 from jsonb_array_elements(:'lc'::jsonb -> 'open_battles') x
                             where x ->> 'id' = :'r1' and (x ->> 'reverse')::boolean and not (x ->> 'twist')::boolean),
  'friends see the mode of the open lobby');
select tests.login_as('authenticated', :b);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'r1') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'r1') is not null as ok \gset
reset role;
select (tests.bm(:'r1')).winner_id as w1 \gset
select tests.assert((tests.bm(:'r1')).status = 'accepted'
  and (tests.bm(:'r1')).winner_seat = (public.nexamon_pack_battle_decide(tests.bm_seats(:'r1'), (tests.bm(:'r1')).coin_seed, true) ->> 'winner')::integer
  and (select min(total_cents) from public.nexamon_battle_seats where battle_id = :'r1')
      = (select total_cents from public.nexamon_battle_seats where battle_id = :'r1' and player_id = :'w1')
  and (select bool_and(score_cents = total_cents) from public.nexamon_battle_seats where battle_id = :'r1')
  and (tests.bm(:'r1')).twists is null
  and (tests.bm(:'r1')).decide_at - (tests.bm(:'r1')).starts_at = make_interval(secs => 2 * (2.4 + 5 * 1.8)),
  'reverse: the lowest total over all packs wins; no twists, the classic clock');
select tests.assert((select count(*) from public.nexamon_copies where pack_id = :'r1') = 30
  and (select bool_and(owner_id = :'w1') from public.nexamon_copies where pack_id = :'r1'),
  'reverse: the winner (lowest total) takes all 30 cards');
select tests.assert(exists (select 1 from public.feed_items where dedupe_key = 'nexamon:battle:won:' || :'r1'
                             and (payload ->> 'reverse')::boolean and not (payload ->> 'twist')::boolean)
  and exists (select 1 from public.notifications where dedupe_key = 'nexamon:battle:accepted:' || :'r1' || ':' || :c
                and body like '%Modus: Umgekehrt'),
  'feed and the start notification carry the mode');
select tests.bm_age(:'r1', 60000);

-- =============================================================================
-- C. "Twist": four players, three packs; the piles are permuted after every pack (seeded, stored, on the clock)
-- =============================================================================
select tests.login_as('authenticated', :a);
select (public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy', 'super_apex', 'mystic_energy'], 4,
                                          array['Bm_Max', 'Bm_Ida', 'Bm_Tom'], false, true) #>> '{battle,id}')::uuid as t1 \gset
reset role;
select tests.assert(exists (select 1 from public.notifications where player_id = :d and dedupe_key = 'nexamon:battle:invite:' || :'t1' || ':' || :d
                             and body like '%Modus: Twist.'),
  'twist: the invitation names the mode');
select tests.login_as('authenticated', :b);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'t1') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'t1') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :d);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'t1') as jd \gset
reset role;
select tests.assert(:'jd'::jsonb #>> '{battle,status}' = 'running' and (:'jd'::jsonb #>> '{battle,twist}')::boolean
  and :'jd'::jsonb #> '{battle,twists}' = '[]'::jsonb and :'jd'::jsonb #> '{battle,twist_seed}' = 'null'::jsonb
  and (:'jd'::jsonb #>> '{battle,twist_ms}')::numeric = 3200,
  'twist: no twist and no seed before the shared clock reaches them');
select tests.assert((tests.bm(:'t1')).twist_seed is not null and jsonb_array_length((tests.bm(:'t1')).twists) = 3
  and (tests.bm(:'t1')).twists = (select jsonb_agg(public.nexamon_battle_twist_perm((tests.bm(:'t1')).twist_seed, k, 4) order by k)
                                    from generate_series(1, 3) k),
  'twist: one twist per pack, reproducible from the stored seed');
select tests.assert(
  tests.bm_scores(:'t1') = (select array_agg((x::text)::bigint order by o)
                              from jsonb_array_elements(public.nexamon_pack_battle_decide(
                                     public.nexamon_pack_battle_piles(tests.bm_seats(:'t1'), (tests.bm(:'t1')).twists, 3),
                                     (tests.bm(:'t1')).coin_seed, false) -> 'totals') with ordinality t(x, o))
  and (tests.bm(:'t1')).winner_seat = (public.nexamon_pack_battle_decide(
        public.nexamon_pack_battle_piles(tests.bm_seats(:'t1'), (tests.bm(:'t1')).twists, 3), (tests.bm(:'t1')).coin_seed, false) ->> 'winner')::integer
  and (select sum(score_cents) = sum(total_cents) from public.nexamon_battle_seats where battle_id = :'t1'),
  'twist: the piles after every twist decide (the sum of all piles is the sum of all pulls)');
-- applied after each pack: pile i after pack 1 is the first pack of seat twists[0][i]
select tests.assert(
  (select bool_and(
     (select sum((c ->> 'value_cents')::bigint) from jsonb_array_elements(
        public.nexamon_pack_battle_piles(tests.bm_seats(:'t1'), (tests.bm(:'t1')).twists, 1) -> i) c)
     = (select sum((c ->> 'value_cents')::bigint) from jsonb_array_elements(tests.bm_seats(:'t1') -> ((tests.bm(:'t1')).twists #>> array['0', i::text])::integer) c
         where (c ->> 'pack')::integer = 1))
   from generate_series(0, 3) i),
  'twist: after pack 1 every seat holds the first pack of the seat the twist names');
select (tests.bm(:'t1')).winner_id as w2 \gset
select tests.assert((select count(*) from public.nexamon_copies where pack_id = :'t1') = 60
  and (select bool_and(owner_id = :'w2') from public.nexamon_copies where pack_id = :'t1')
  and (tests.bm(:'t1')).decide_at - (tests.bm(:'t1')).starts_at = make_interval(secs => 3 * (2.4 + 5 * 1.8 + 3.2)),
  'twist: the winner takes all 60 cards; every pack adds packBattle.twistMs to the clock');
-- lockstep: what the clock has reached is computed from each answer's own server_time and starts_at (tear 2400,
-- slot 1800, twist 3200, lead 800), so a slow machine between aging and reading changes nothing
-- card 5 of pack 1 is known after 9.6 s, the first twist after 11.4 s, card 6 (pack 2) after 17 s
select tests.bm_age(:'t1', 12000);
select tests.login_as('authenticated', :b);
select public.get_nexamon_battle(:'t1') as g1 \gset
reset role;
select tests.assert(tests.bm_cards_due(:'g1'::jsonb) >= 5
  and jsonb_array_length(:'g1'::jsonb #> '{battle,twists}') = tests.bm_twists_due(:'g1'::jsonb)
  and (select bool_and(jsonb_array_length(x -> 'cards') = tests.bm_cards_due(:'g1'::jsonb)
                       and (tests.bm_twists_due(:'g1'::jsonb) > 0 or (x ->> 'score_cents')::bigint = (x ->> 'cents')::bigint))
         from jsonb_array_elements(:'g1'::jsonb #> '{battle,seats}') x),
  'lockstep: pack 1 revealed on every seat, a twist only when the clock reached it; before it the score is the own pulls');
select tests.bm_age(:'t1', 3000);
select tests.login_as('authenticated', :c);
select public.get_nexamon_battle(:'t1') as g2 \gset
reset role;
select tests.assert(tests.bm_twists_due(:'g2'::jsonb) >= 1
  and jsonb_array_length(:'g2'::jsonb #> '{battle,twists}') = tests.bm_twists_due(:'g2'::jsonb)
  and :'g2'::jsonb #> '{battle,twists,0}' = (tests.bm(:'t1')).twists -> 0
  and (select bool_and(jsonb_array_length(x -> 'cards') = tests.bm_cards_due(:'g2'::jsonb))
         from jsonb_array_elements(:'g2'::jsonb #> '{battle,seats}') x)
  -- with one twist: seat i holds pack 1 of the seat the twist names, plus its own pulls after it
  and (tests.bm_twists_due(:'g2'::jsonb) > 1 or (select bool_and((x ->> 'score_cents')::bigint
         = (select coalesce(sum((c ->> 'value_cents')::bigint), 0)
              from jsonb_array_elements(:'g2'::jsonb #> array['battle', 'seats', (:'g2'::jsonb #>> array['battle', 'twists', '0', (o - 1)::text]), 'cards']) c
             where (c ->> 'pack')::integer = 1)
           + (select coalesce(sum((c ->> 'value_cents')::bigint), 0) from jsonb_array_elements(x -> 'cards') c where (c ->> 'pack')::integer > 1))
         from jsonb_array_elements(:'g2'::jsonb #> '{battle,seats}') with ordinality t(x, o))),
  'lockstep: the first twist is shown to all, every seat now holds the pile the twist handed it');
select tests.bm_age(:'t1', 5000);
select tests.login_as('authenticated', :d);
select public.get_nexamon_battle(:'t1') as g3 \gset
reset role;
select tests.assert(tests.bm_cards_due(:'g3'::jsonb) >= 6
  and jsonb_array_length(:'g3'::jsonb #> '{battle,twists}') = tests.bm_twists_due(:'g3'::jsonb)
  and (select bool_and(jsonb_array_length(x -> 'cards') = tests.bm_cards_due(:'g3'::jsonb)
                       and (x #>> '{cards,4,pack}')::integer = 1 and (x #>> '{cards,5,pack}')::integer = 2)
         from jsonb_array_elements(:'g3'::jsonb #> '{battle,seats}') x)
  -- without the twist card 6 would have been due 3.2 s earlier
  and tests.bm_cards_due(:'g3'::jsonb) < tests.bm_cards_due(:'g3'::jsonb, 0),
  'lockstep: pack 2 tears after the twist (packBattle.twistMs later than without Twist)');
select tests.bm_age(:'t1', 60000);
select tests.login_as('authenticated', :a);
select public.get_nexamon_battle(:'t1') as g4 \gset
reset role;
select tests.assert(:'g4'::jsonb #>> '{battle,status}' = 'done' and :'g4'::jsonb #> '{battle,twists}' = (tests.bm(:'t1')).twists
  and (:'g4'::jsonb #>> '{battle,twist_seed}')::bigint = (tests.bm(:'t1')).twist_seed
  and (:'g4'::jsonb #>> '{battle,winner_seat}')::integer = (tests.bm(:'t1')).winner_seat
  and (select array_agg((x ->> 'score_cents')::bigint order by (x ->> 'seat')::integer) from jsonb_array_elements(:'g4'::jsonb #> '{battle,seats}') x)
      = tests.bm_scores(:'t1'),
  'at the end: all twists, the seed and the final scores for everyone');
select tests.assert(exists (select 1 from public.feed_items where dedupe_key = 'nexamon:battle:won:' || :'t1' and (payload ->> 'twist')::boolean),
  'twist: the feed item carries the mode');

-- =============================================================================
-- D. Both: two players, one pack; the lower pile after the twist wins
-- =============================================================================
select tests.login_as('authenticated', :a);
select (public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy'], 2, array['Bm_Max'], true, true) #>> '{battle,id}')::uuid as x1 \gset
reset role;
select tests.assert(exists (select 1 from public.notifications where player_id = :b and dedupe_key = 'nexamon:battle:invite:' || :'x1' || ':' || :b
                             and body like '%Modus: Twist + Umgekehrt.'),
  'both: the invitation names both modes');
select tests.login_as('authenticated', :b);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'x1') is not null as ok \gset
reset role;
select tests.assert(jsonb_array_length((tests.bm(:'x1')).twists) = 1
  and (tests.bm(:'x1')).twists -> 0 = public.nexamon_battle_twist_perm((tests.bm(:'x1')).twist_seed, 1, 2)
  and (tests.bm(:'x1')).winner_seat = (public.nexamon_pack_battle_decide(
        public.nexamon_pack_battle_piles(tests.bm_seats(:'x1'), (tests.bm(:'x1')).twists, 1), (tests.bm(:'x1')).coin_seed, true) ->> 'winner')::integer
  and (select score_cents from public.nexamon_battle_seats where battle_id = :'x1' and seat = (tests.bm(:'x1')).winner_seat)
      = (select min(score_cents) from public.nexamon_battle_seats where battle_id = :'x1')
  and (select bool_and(owner_id = (tests.bm(:'x1')).winner_id) from public.nexamon_copies where pack_id = :'x1'),
  'both: the twist runs after the single pack, then the lowest pile wins and takes all ten cards');
select tests.bm_age(:'x1', 60000);

-- =============================================================================
-- E. Refunds and money: a Twist + Umgekehrt lobby that is cancelled refunds every seat; duels cannot carry modes
-- =============================================================================
select tests.cash(:a) as a0 \gset
select tests.cash(:c) as c0 \gset
select tests.login_as('authenticated', :a);
select (public.create_nexamon_pack_battle(gen_random_uuid(), array['super_apex', 'super_apex'], 3, '{}', true, true) #>> '{battle,id}')::uuid as x2 \gset
reset role;
select tests.login_as('authenticated', :c);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'x2') is not null as ok \gset
reset role;
select tests.assert(tests.bm_escrow() = :esc0 + 2 * 70000, 'modes do not change the stake: two seats of 70 000 in escrow');
select tests.login_as('authenticated', :a);
select public.cancel_nexamon_battle(gen_random_uuid(), :'x2') is not null as ok \gset
reset role;
select tests.assert(tests.cash(:a) = :a0 and tests.cash(:c) = :c0 and tests.bm_escrow() = :esc0
  and (tests.bm(:'x2')).twists is null,
  'cancelled Twist + Umgekehrt lobby: every stake back, nothing twisted');
select tests.throws($$insert into public.nexamon_battles (challenger_id, opponent_id, set_key, price_cents, created_at, expires_at, twist)
                      values ('0d7d7d7d-0000-4000-8000-0000000000a1', '0d7d7d7d-0000-4000-8000-0000000000b1', 'mystic_energy', 1, now(), now(), true)$$,
  '23514', 'a classic duel cannot carry a mode');
select tests.assert(tests.bm_escrow() = :esc0, 'escrow is empty when no lobby is open');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after Pack Battles with modes');
