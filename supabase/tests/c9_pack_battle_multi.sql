-- =============================================================================
-- c9 · Nexamon Pack Battles with several packs and up to four players (ADR-192)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0c9c9c9c-0000-4000-8000-0000000000a1'''
\set b '''0c9c9c9c-0000-4000-8000-0000000000b1'''
\set c '''0c9c9c9c-0000-4000-8000-0000000000c1'''
\set d '''0c9c9c9c-0000-4000-8000-0000000000d1'''
\set e '''0c9c9c9c-0000-4000-8000-0000000000e1'''
\set rq '''0c9c9c9c-0000-4000-8000-0000000000f1'''
\set rj '''0c9c9c9c-0000-4000-8000-0000000000f2'''
update public.invite_codes set max_uses = max_uses + 5 where code = 'M1-TESTS';
select tests.signup(:a, 'Mb_Anna') is not null and tests.signup(:b, 'Mb_Bruno') is not null
   and tests.signup(:c, 'Mb_Clara') is not null and tests.signup(:d, 'Mb_Dora') is not null
   and tests.signup(:e, 'Mb_Emil') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.set_level(:c, 10);
select tests.set_level(:d, 10);
select tests.set_level(:e, 10);
select tests.fund(:a, 50000000, 'test:c9:a');
select tests.fund(:b, 50000000, 'test:c9:b');
select tests.fund(:c, 50000000, 'test:c9:c');
select tests.fund(:d, 50000000, 'test:c9:d');
select tests.fund(:e, 50000000, 'test:c9:e');
insert into public.friendships (requester_id, addressee_id, status, responded_at)
values (:a, :b, 'accepted', now()), (:a, :c, 'accepted', now()), (:a, :d, 'accepted', now()), (:b, :e, 'accepted', now());
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{battles,cooldownSeconds}', '0');
select tests.set_cfg('nexamon', '{battles,perHour}', '20');
select tests.set_cfg('nexamon', '{sets,mystic_energy,packPriceCents}', '20000');
select tests.set_cfg('nexamon', '{sets,super_apex,packPriceCents}', '35000');

create or replace function tests.mb(p_id uuid) returns public.nexamon_battles language sql security definer as $$
  select * from public.nexamon_battles where id = p_id $$;
create or replace function tests.mb_escrow() returns bigint language sql security definer as $$
  select balance_cents from public.ledger_accounts where system_key = 'nexamon_battle_escrow' $$;
create or replace function tests.mb_owned(p_player uuid) returns bigint language sql security definer as $$
  select count(*) from public.nexamon_copies where owner_id = p_player $$;
create or replace function tests.mb_pop() returns bigint language sql security definer as $$
  select sum(population)::bigint from public.nexamon_cards $$;
create or replace function tests.mb_age(p_id uuid, p_ms integer) returns void language sql security definer as $$
  update public.nexamon_battles
     set created_at = created_at - make_interval(secs => p_ms / 1000.0), expires_at = expires_at - make_interval(secs => p_ms / 1000.0),
         accepted_at = accepted_at - make_interval(secs => p_ms / 1000.0), starts_at = starts_at - make_interval(secs => p_ms / 1000.0),
         decide_at = decide_at - make_interval(secs => p_ms / 1000.0), ends_at = ends_at - make_interval(secs => p_ms / 1000.0)
   where id = p_id;
  update public.nexamon_live set ends_at = ends_at - make_interval(secs => p_ms / 1000.0) where battle_id = p_id $$;
grant execute on all functions in schema tests to public;

select tests.mb_escrow() as esc0 \gset
select tests.cash(:a) as acash \gset

-- =============================================================================
-- A. Lineup and size rules
-- =============================================================================
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy'], 5)$$,
  'invalid_argument', 'create: at most packBattle.maxPlayers (4) players');
select tests.throws_key($$select public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy'], 1)$$,
  'invalid_argument', 'create: at least two players');
select tests.throws_key($$select public.create_nexamon_pack_battle(gen_random_uuid(), array[]::text[], 2)$$,
  'invalid_argument', 'create: at least one pack');
select tests.throws_key($$select public.create_nexamon_pack_battle(gen_random_uuid(), array_fill('mystic_energy'::text, array[11]), 2)$$,
  'invalid_argument', 'create: at most packBattle.maxPacks (10) packs');
select tests.throws_key($$select public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy', 'nope'], 2)$$,
  'nexamon_unknown', 'create: every pack of a known set');
select tests.throws_key($$select public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy'], 2, array['Mb_Emil'])$$,
  'nexamon_battle_not_friend', 'create: only friends are invited');
reset role;
select tests.set_cfg('nexamon', '{sets,super_apex,releaseAt}', to_jsonb((now() + interval '3 days')::text));
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy', 'super_apex'], 2)$$,
  'nexamon_set_not_released', 'create: release gating for every pack of the lineup');
reset role;
update public.game_config set value = value #- '{sets,super_apex,releaseAt}' where key = 'nexamon';
select tests.assert(tests.cash(:a) = :acash and tests.mb_escrow() = :esc0, 'refused creations cost nothing');

-- =============================================================================
-- B. Cancel before full: every seat gets the stake back
-- =============================================================================
select tests.cash(:a) as a0 \gset
select tests.cash(:b) as b0 \gset
select tests.login_as('authenticated', :a);
select public.create_nexamon_pack_battle(:rq, array['mystic_energy', 'super_apex'], 3, array['Mb_Bruno']) as cr \gset
select public.create_nexamon_pack_battle(:rq, array['mystic_energy', 'super_apex'], 3, array['Mb_Bruno']) as cr2 \gset
select tests.throws_key($$select public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy'], 2)$$,
  'nexamon_battle_busy', 'one battle at a time');
reset role;
select (:'cr'::jsonb #>> '{battle,id}')::uuid as m1 \gset
select tests.assert(:'cr'::jsonb = :'cr2'::jsonb and (select count(*) from public.nexamon_battles where challenger_id = :a) = 1,
  'create: idempotent per request id');
select tests.assert(:'cr'::jsonb #>> '{battle,status}' = 'pending' and :'cr'::jsonb #>> '{battle,mode}' = 'multi'
  and (:'cr'::jsonb #>> '{battle,size}')::integer = 3 and (:'cr'::jsonb #>> '{battle,price_cents}')::bigint = 55000
  and jsonb_array_length(:'cr'::jsonb #> '{battle,packs}') = 2 and :'cr'::jsonb #>> '{battle,packs,1,set}' = 'super_apex'
  and jsonb_array_length(:'cr'::jsonb #> '{battle,seats}') = 1 and (:'cr'::jsonb #>> '{battle,my_seat}')::integer = 0,
  'create: a lobby with the lineup in order, the stake is the sum of the packs, the creator on seat 0');
select tests.assert(tests.cash(:a) = :a0 - 55000 and tests.mb_escrow() = :esc0 + 55000
  and (select count(*) from public.notifications where player_id = :b and type_key = 'nexamon_battle'
         and dedupe_key = 'nexamon:battle:invite:' || :'m1' || ':' || :b) = 1,
  'create: the creator pays into escrow, the invited friend is notified');
-- friends see the open lobby, a stranger does not
select tests.login_as('authenticated', :c);
select public.nexamon_lobby(true) as lc \gset
reset role;
select tests.login_as('authenticated', :e);
select tests.throws_key(format($$select public.join_nexamon_pack_battle(gen_random_uuid(), %L)$$, :'m1'),
  'nexamon_battle_unknown', 'join: only friends of the creator');
select tests.throws_key(format($$select public.get_nexamon_battle(%L)$$, :'m1'), 'nexamon_battle_unknown',
  'a stranger cannot look into the lobby');
reset role;
select tests.assert(exists (select 1 from jsonb_array_elements(:'lc'::jsonb -> 'open_battles') x
                             where x ->> 'id' = :'m1' and not (x ->> 'invited')::boolean),
  'lobby: a friend of the creator sees the open battle (not invited)');
select tests.login_as('authenticated', :b);
select public.join_nexamon_pack_battle(:rj, :'m1') as jb \gset
select public.join_nexamon_pack_battle(:rj, :'m1') as jb2 \gset
select tests.throws_key(format($$select public.join_nexamon_pack_battle(gen_random_uuid(), %L)$$, :'m1'),
  'nexamon_battle_joined', 'join: one seat per player');
select tests.throws_key(format($$select public.respond_nexamon_battle(gen_random_uuid(), %L, true)$$, :'m1'),
  'nexamon_battle_not_yours', 'a lobby battle is joined, not answered');
select tests.throws_key(format($$select public.cancel_nexamon_battle(gen_random_uuid(), %L)$$, :'m1'),
  'nexamon_battle_not_yours', 'only the creator cancels');
reset role;
select tests.assert(:'jb'::jsonb = :'jb2'::jsonb and tests.cash(:b) = :b0 - 55000 and tests.mb_escrow() = :esc0 + 110000
  and (:'jb'::jsonb #>> '{battle,my_seat}')::integer = 1 and :'jb'::jsonb #>> '{battle,status}' = 'pending'
  and (select invited from public.nexamon_battle_seats where battle_id = :'m1' and player_id = :b),
  'join: idempotent, pays the same stake into escrow, takes seat 1, the lobby waits for the third');
select tests.login_as('authenticated', :a);
select public.cancel_nexamon_battle(gen_random_uuid(), :'m1') as ca \gset
reset role;
select tests.assert(:'ca'::jsonb #>> '{battle,status}' = 'cancelled' and tests.cash(:a) = :a0 and tests.cash(:b) = :b0
  and tests.mb_escrow() = :esc0
  and (select count(*) from public.ledger_transactions where ref_type = 'nexamon_battle' and ref_id = :'m1') = 4
  and (select count(*) from public.nexamon_battle_seats where battle_id = :'m1' and refunded_at is not null) = 2
  and (select count(*) from public.notifications where player_id = :b and dedupe_key = 'nexamon:battle:refund:' || :'m1' || ':' || :b) = 1,
  'cancel before full: both stakes back in full (two payments, two refunds), escrow empty, the joined friend is told');
select tests.login_as('authenticated', :c);
select tests.throws_key(format($$select public.join_nexamon_pack_battle(gen_random_uuid(), %L)$$, :'m1'),
  'nexamon_battle_closed', 'a cancelled lobby cannot be joined');
reset role;
-- a second cancel/update does not refund twice
update public.nexamon_battles set status = 'expired' where id = :'m1';
select tests.assert(tests.cash(:a) = :a0 and tests.mb_escrow() = :esc0, 'refunds happen once');

-- =============================================================================
-- C. A lobby that does not fill in time expires and refunds
-- =============================================================================
select tests.login_as('authenticated', :a);
select (public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy'], 4) #>> '{battle,id}')::uuid as m2 \gset
reset role;
select tests.login_as('authenticated', :c);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'m2') is not null as ok \gset
reset role;
select tests.assert(tests.cash(:a) = :a0 - 20000 and tests.mb_escrow() = :esc0 + 40000, 'two stakes of one pack in escrow');
select tests.mb_age(:'m2', 121000);
select public.nexamon_pack_battle_expire() as expired \gset
select tests.assert(:expired >= 1 and (tests.mb(:'m2')).status = 'expired' and tests.cash(:a) = :a0 and tests.mb_escrow() = :esc0
  and (select bool_and(refunded_at is not null) from public.nexamon_battle_seats where battle_id = :'m2'),
  'expiry after packBattle.lobbySeconds: every stake back, escrow empty');

-- =============================================================================
-- D. Four players, three packs of two sets: everyone opens the same lineup, the winner takes all 60 cards
-- =============================================================================
select tests.set_cfg('nexamon', '{bigPullNotifyCents}', '0');
select tests.set_cfg('nexamon', '{bigPullNotifySeconds}', '0');
select tests.cash(:a) as a0 \gset
select tests.cash(:b) as b0 \gset
select tests.cash(:c) as c0 \gset
select tests.cash(:d) as d0 \gset
select tests.mb_pop() as pop0 \gset
select coalesce(sum(balance_cents), 0) as hh0 from public.ledger_accounts where system_key = 'households' \gset
select count(*) as big0 from public.notifications where type_key = 'nexamon_big_pull' \gset
select tests.login_as('authenticated', :a);
select (public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy', 'super_apex', 'mystic_energy'], 4,
                                          array['Mb_Bruno', 'Mb_Clara']) #>> '{battle,id}')::uuid as m3 \gset
reset role;
select tests.login_as('authenticated', :b);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'m3') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'m3') is not null as ok \gset
reset role;
select tests.assert((tests.mb(:'m3')).status = 'pending' and tests.mb_escrow() = :esc0 + 3 * 75000, 'three of four seats: still waiting');
select tests.login_as('authenticated', :d);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'m3') as jd \gset
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.join_nexamon_pack_battle(gen_random_uuid(), %L)$$, :'m3'),
  'nexamon_battle_joined', 'already seated');
reset role;
select tests.assert(:'jd'::jsonb #>> '{battle,status}' = 'running' and (:'jd'::jsonb #>> '{battle,my_seat}')::integer = 3
  and jsonb_array_length(:'jd'::jsonb #> '{battle,seats}') = 4
  and (select bool_and(jsonb_array_length(x -> 'cards') = 0) from jsonb_array_elements(:'jd'::jsonb #> '{battle,seats}') x)
  and :'jd'::jsonb #> '{battle,winner_seat}' = 'null'::jsonb,
  'the fourth seat starts the battle; no peeking before the shared start');
select tests.assert(tests.cash(:a) = :a0 - 75000 and tests.cash(:b) = :b0 - 75000 and tests.cash(:c) = :c0 - 75000
  and tests.cash(:d) = :d0 - 75000 and tests.mb_escrow() = :esc0
  and (select sum(balance_cents) from public.ledger_accounts where system_key = 'households') = :hh0 + 4 * 75000,
  'cost per player = sum of the lineup (20 000 + 35 000 + 20 000); escrow goes to the households at the start');
select tests.assert(
  (select bool_and(jsonb_array_length(s.cards) = 15
                   and (select array_agg(distinct x ->> 'set' order by x ->> 'set') from jsonb_array_elements(s.cards) x)
                       = array['mystic_energy', 'super_apex']
                   and (select count(*) from jsonb_array_elements(s.cards) x where (x ->> 'pack')::integer = 2 and x ->> 'set' = 'super_apex') = 5
                   and s.total_cents = (select sum((x ->> 'value_cents')::bigint) from jsonb_array_elements(s.cards) x))
     from public.nexamon_battle_seats s where s.battle_id = :'m3'),
  'every seat opened the same lineup in order: 3 packs, 15 cards, pack 2 from Super Apex');
select tests.assert(tests.mb_pop() = :pop0 + 60, 'every pulled copy counts for the population');
select (tests.mb(:'m3')).winner_id as win \gset
select tests.assert(
  tests.mb_owned(:'win') >= 60
  and (select count(*) from public.nexamon_copies where pack_id = :'m3') = 60
  and (select bool_and(owner_id = :'win') from public.nexamon_copies where pack_id = :'m3')
  and (select count(*) from public.nexamon_copies where owner_id in (:a, :b, :c, :d) and owner_id <> :'win') = 0,
  'the winner owns all 60 copies, the others none');
select tests.assert(
  (tests.mb(:'m3')).winner_seat = (public.nexamon_pack_battle_decide(
     (select jsonb_agg(s.cards order by s.seat) from public.nexamon_battle_seats s where s.battle_id = :'m3'),
     (tests.mb(:'m3')).coin_seed) ->> 'winner')::integer
  and (select player_id from public.nexamon_battle_seats where battle_id = :'m3' and seat = (tests.mb(:'m3')).winner_seat) = :'win'
  and (select max(total_cents) from public.nexamon_battle_seats where battle_id = :'m3')
      = (select total_cents from public.nexamon_battle_seats where battle_id = :'m3' and player_id = :'win'),
  'the stored winner follows the rule: the highest total over all packs');
select tests.assert(:big0 < (select count(*) from public.notifications where type_key = 'nexamon_big_pull')
  and exists (select 1 from public.nexamon_big_pull_broadcasts x where x.player_id in (:a, :b, :c, :d)),
  'big pulls from battle packs still notify everyone (7900 trigger)');
select tests.set_cfg('nexamon', '{bigPullNotifyCents}', '10000000');
select tests.set_cfg('nexamon', '{bigPullNotifySeconds}', '60');
-- the shared clock: pack by pack, card by card on every seat
select tests.mb_age(:'m3', 4600);
select tests.login_as('authenticated', :b);
select public.get_nexamon_battle(:'m3') as r1 \gset
reset role;
-- (a loaded machine can take a moment between mb_age and the read: one or two cards, but the same on every seat)
select tests.assert((select count(distinct jsonb_array_length(x -> 'cards')) = 1 and min(jsonb_array_length(x -> 'cards')) between 1 and 2
                       from jsonb_array_elements(:'r1'::jsonb #> '{battle,seats}') x)
  and :'r1'::jsonb #> '{battle,winner_seat}' = 'null'::jsonb and (:'r1'::jsonb #>> '{battle,my_seat}')::integer = 1,
  'lockstep: the first card on all four seats, the winner not yet');
-- pack 2 tears after card 5: 3000 + 2*2400 + 5*1800 - 800 = 16 000 ms in -> 6 cards
select tests.mb_age(:'m3', 11400);
select tests.login_as('authenticated', :b);
select public.get_nexamon_battle(:'m3') as r2 \gset
reset role;
select tests.assert((select bool_and(jsonb_array_length(x -> 'cards') = 6 and (x #>> '{cards,5,pack}')::integer = 2)
                       from jsonb_array_elements(:'r2'::jsonb #> '{battle,seats}') x),
  'the next pack tears after the last card of the one before');
select tests.mb_age(:'m3', 60000);
select tests.login_as('authenticated', :c);
select public.get_nexamon_battle(:'m3') as fin \gset
reset role;
select tests.assert(:'fin'::jsonb #>> '{battle,status}' = 'done'
  and (select bool_and(jsonb_array_length(x -> 'cards') = 15) from jsonb_array_elements(:'fin'::jsonb #> '{battle,seats}') x)
  and (:'fin'::jsonb #>> '{battle,winner_seat}')::integer = (tests.mb(:'m3')).winner_seat
  and (select (x ->> 'cents')::bigint from jsonb_array_elements(:'fin'::jsonb #> '{battle,seats}') x where (x ->> 'seat')::integer = 2)
      = (select total_cents from public.nexamon_battle_seats where battle_id = :'m3' and seat = 2)
  and not (:'fin'::jsonb #> '{battle,seats,0,cards,0}' ? 'copy_id'),
  'after the reveal: all 15 cards per seat, the totals and the winner seat');
select tests.assert(exists (select 1 from public.feed_items where kind = 'nexamon_battle_won' and dedupe_key = 'nexamon:battle:won:' || :'m3'
                             and (payload ->> 'players')::integer = 4 and (payload ->> 'packs')::integer = 3),
  'the win is a feed item');
select tests.assert(exists (select 1 from public.nexamon_live where battle_id = :'m3' and kind = 'battle'),
  'the battle is a live opening for spectators');

-- tie rules for more than two seats
select tests.assert(
  public.nexamon_pack_battle_decide('[[{"value_cents":100,"rarity":"common"}],[{"value_cents":300,"rarity":"common"}],[{"value_cents":200,"rarity":"rare"}]]', 0) ->> 'winner' = '1'
  and public.nexamon_pack_battle_decide('[[{"value_cents":500,"rarity":"rare"}],[{"value_cents":500,"rarity":"ultra"}],[{"value_cents":100,"rarity":"legendary"}]]', 0)
      = '{"winner":1,"tie_break":"rarest","totals":[500,500,100]}'::jsonb
  and public.nexamon_pack_battle_decide('[[{"value_cents":5,"rarity":"rare"}],[{"value_cents":1,"rarity":"rare"}],[{"value_cents":5,"rarity":"rare"}],[{"value_cents":5,"rarity":"rare"}]]', 1) ->> 'winner' = '2'
  and public.nexamon_pack_battle_decide('[[{"value_cents":5,"rarity":"rare"}],[{"value_cents":1,"rarity":"rare"}],[{"value_cents":5,"rarity":"rare"}],[{"value_cents":5,"rarity":"rare"}]]', 5) ->> 'tie_break' = 'coin',
  'decide: highest total, then the rarest card among the leaders, then the coin among those still tied');

-- =============================================================================
-- E. Two players, one pack: the classic battle through the lobby
-- =============================================================================
select tests.cash(:a) as a0 \gset
select tests.cash(:b) as b0 \gset
select tests.mb_owned(:a) as ao0 \gset
select tests.mb_owned(:b) as bo0 \gset
select tests.login_as('authenticated', :a);
select (public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy'], 2, array['Mb_Bruno']) #>> '{battle,id}')::uuid as m4 \gset
reset role;
select tests.login_as('authenticated', :b);
select public.nexamon_lobby(true) as lb \gset
select public.join_nexamon_pack_battle(gen_random_uuid(), :'m4') as j4 \gset
reset role;
select tests.assert(exists (select 1 from jsonb_array_elements(:'lb'::jsonb -> 'open_battles') x where x ->> 'id' = :'m4' and (x ->> 'invited')::boolean),
  'the invited friend sees the lobby as invited');
select tests.assert(:'j4'::jsonb #>> '{battle,status}' = 'running' and tests.cash(:a) = :a0 - 20000 and tests.cash(:b) = :b0 - 20000
  and (tests.mb_owned(:a) - :ao0) + (tests.mb_owned(:b) - :bo0) = 10
  and ((tests.mb_owned(:a) - :ao0) = 10 or (tests.mb_owned(:b) - :bo0) = 10),
  'two players, one pack: both pay one pack, the winner takes all ten');
select tests.assert(
  (tests.mb(:'m4')).winner_id = case when (public.nexamon_battle_decide((tests.mb(:'m4')).challenger_cards, (tests.mb(:'m4')).opponent_cards,
                                                                       (tests.mb(:'m4')).coin_seed) ->> 'winner') = 'challenger' then :a::uuid else :b::uuid end
  and (tests.mb(:'m4')).opponent_id = :b::uuid,
  'two seats decide exactly like the classic duel');
select tests.mb_age(:'m4', 30000);
select tests.login_as('authenticated', :a);
select public.get_nexamon_battle(:'m4') as f4 \gset
reset role;
select tests.assert(:'f4'::jsonb #>> '{battle,status}' = 'done' and jsonb_array_length(:'f4'::jsonb #> '{battle,challenger_cards}') = 5
  and jsonb_array_length(:'f4'::jsonb #> '{battle,opponent_cards}') = 5 and :'f4'::jsonb #>> '{battle,me}' = 'challenger'
  and :'f4'::jsonb #>> '{battle,winner}' in ('challenger', 'opponent'),
  'the classic fields (challenger/opponent cards, me, winner) still answer');

-- nobody reads the tables directly
select tests.login_as('authenticated', :a);
select tests.throws($$select * from public.nexamon_battle_seats$$, '42501', 'nexamon_battle_seats: no direct reads');
select tests.throws($$select * from public.nexamon_battle_invites$$, '42501', 'nexamon_battle_invites: no direct reads');
reset role;

select tests.assert(tests.mb_escrow() = :esc0, 'escrow is empty when no lobby is open');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after multi Pack Battles');
