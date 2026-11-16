-- =============================================================================
-- b2 · Nexamon Pack Battles and live openings (ADR-172)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0b2b2b2b-0000-4000-8000-0000000000a1'''
\set b '''0b2b2b2b-0000-4000-8000-0000000000b1'''
\set c '''0b2b2b2b-0000-4000-8000-0000000000c1'''
\set d '''0b2b2b2b-0000-4000-8000-0000000000d1'''
\set rq '''0b2b2b2b-0000-4000-8000-0000000000e1'''
\set rr '''0b2b2b2b-0000-4000-8000-0000000000e2'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:a, 'Pb_Anna') is not null and tests.signup(:b, 'Pb_Bruno') is not null
   and tests.signup(:c, 'Pb_Clara') is not null and tests.signup(:d, 'Pb_Dora') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.set_level(:c, 10);
select tests.set_level(:d, 9);
select tests.fund(:a, 50000000, 'test:b2:a');
select tests.fund(:b, 50000000, 'test:b2:b');
select tests.fund(:c, 50000000, 'test:b2:c');
insert into public.friendships (requester_id, addressee_id, status, responded_at)
values (:a, :b, 'accepted', now()), (:a, :c, 'accepted', now()), (:a, :d, 'accepted', now()), (:b, :c, 'accepted', now());
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{battles,cooldownSeconds}', '0');

create or replace function tests.pb(p_id uuid) returns public.nexamon_battles language sql security definer as $$
  select * from public.nexamon_battles where id = p_id $$;
create or replace function tests.pb_owned(p_player uuid) returns bigint language sql security definer as $$
  select count(*) from public.nexamon_copies where owner_id = p_player $$;
create or replace function tests.pb_pop() returns bigint language sql security definer as $$
  select sum(population)::bigint from public.nexamon_cards $$;
-- the battle's clock moves: everything shifted p_ms into the past
create or replace function tests.pb_age(p_id uuid, p_ms integer) returns void language sql security definer as $$
  update public.nexamon_battles
     set created_at = created_at - make_interval(secs => p_ms / 1000.0), expires_at = expires_at - make_interval(secs => p_ms / 1000.0),
         accepted_at = accepted_at - make_interval(secs => p_ms / 1000.0), starts_at = starts_at - make_interval(secs => p_ms / 1000.0),
         decide_at = decide_at - make_interval(secs => p_ms / 1000.0), ends_at = ends_at - make_interval(secs => p_ms / 1000.0)
   where id = p_id;
  update public.nexamon_live set ends_at = ends_at - make_interval(secs => p_ms / 1000.0) where battle_id = p_id $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. Presence: who is on the tab
-- =============================================================================
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Bruno', 'mystic_energy')$$,
  'nexamon_battle_not_here', 'challenge: the friend must be on the Collectibles tab (NX242)');
reset role;
select tests.login_as('authenticated', :b);
select public.nexamon_lobby(true) as lb \gset
select tests.login_as('authenticated', :c);
select public.nexamon_lobby(false) is not null as ok \gset
select tests.login_as('authenticated', :a);
select public.nexamon_lobby(true) as la \gset
reset role;
select tests.assert(
  jsonb_array_length(:'la'::jsonb -> 'players') = 2
  and (select bool_and(x ? 'avatar_key' and x ? 'accessories' and (x ->> 'is_friend')::boolean) from jsonb_array_elements(:'la'::jsonb -> 'players') x)
  and not exists (select 1 from jsonb_array_elements(:'la'::jsonb -> 'players') x where x ->> 'nickname' in ('Pb_Anna', 'Pb_Dora')),
  'nexamon_lobby(): friends on the tab as figures (Bruno, Clara), not the caller, not Dora who was never there');
select tests.assert(
  (select allow_watch from public.nexamon_presence where player_id = :c) = false
  and (select allow_watch from public.nexamon_presence where player_id = :b),
  'the watching setting is stored with the presence');
select tests.login_as('authenticated', :d);
select tests.throws_key($$select public.nexamon_lobby(true)$$, 'nexamon_locked', 'nexamon_lobby(): locked below level 10');
reset role;

-- =============================================================================
-- B. Challenge rules
-- =============================================================================
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Anna', 'mystic_energy')$$,
  'nexamon_battle_self', 'challenge: not oneself (NX247)');
select tests.throws_key($$select public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Dora', 'mystic_energy')$$,
  'nexamon_battle_opponent_locked', 'challenge: the friend must have Nexamon unlocked (NX248)');
select tests.throws_key($$select public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Bruno', 'nope')$$,
  'nexamon_unknown', 'challenge: a known set');
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key($$select public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Dora', 'mystic_energy')$$,
  'nexamon_battle_not_friend', 'challenge: only friends (NX241)');
reset role;

-- decline
select tests.login_as('authenticated', :a);
select public.challenge_nexamon_battle(:rq, 'Pb_Bruno', 'mystic_energy') as ch \gset
select public.challenge_nexamon_battle(:rq, 'Pb_Bruno', 'mystic_energy') as ch2 \gset
select tests.throws_key($$select public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Clara', 'mystic_energy')$$,
  'nexamon_battle_busy', 'one battle at a time (NX243)');
reset role;
select (:'ch'::jsonb #>> '{battle,id}')::uuid as b1 \gset
select tests.assert(:'ch'::jsonb = :'ch2'::jsonb and (select count(*) from public.nexamon_battles where challenger_id = :a) = 1,
  'challenge: idempotent per request id');
select tests.assert(:'ch'::jsonb #>> '{battle,status}' = 'pending' and :'ch'::jsonb #>> '{battle,opponent,nickname}' = 'Pb_Bruno'
  and (select count(*) from public.notifications where player_id = :b and type_key = 'nexamon_battle') = 1,
  'challenge: pending, the friend gets a notification');
select tests.cash(:a) as a0 \gset
select tests.cash(:b) as b0 \gset
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.respond_nexamon_battle(gen_random_uuid(), %L, true)$$, :'b1'),
  'nexamon_battle_not_yours', 'only the challenged friend answers (NX250)');
reset role;
select tests.login_as('authenticated', :b);
select public.respond_nexamon_battle(gen_random_uuid(), :'b1', false) as dec \gset
select tests.throws_key(format($$select public.respond_nexamon_battle(gen_random_uuid(), %L, true)$$, :'b1'),
  'nexamon_battle_closed', 'a declined battle is closed (NX246)');
reset role;
select tests.assert(:'dec'::jsonb #>> '{battle,status}' = 'declined' and tests.cash(:a) = :a0 and tests.cash(:b) = :b0,
  'decline: nobody pays');

-- expiry
select tests.login_as('authenticated', :a);
select (public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Bruno', 'mystic_energy') #>> '{battle,id}')::uuid as b2 \gset
reset role;
select tests.pb_age(:'b2', 61000);
select tests.login_as('authenticated', :b);
select public.respond_nexamon_battle(gen_random_uuid(), :'b2', true) as exp \gset
reset role;
select tests.assert(:'exp'::jsonb #>> '{battle,status}' = 'expired' and (tests.pb(:'b2')).status = 'expired'
  and tests.cash(:a) = :a0 and tests.cash(:b) = :b0, 'an accept after the expiry finds it expired, nobody pays');

-- abort: the challenger cannot pay any more
select tests.login_as('authenticated', :a);
select (public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Bruno', 'mystic_energy') #>> '{battle,id}')::uuid as b3 \gset
reset role;
select tests.set_cfg('nexamon', '{sets,mystic_energy,packPriceCents}', '900000000');
update public.nexamon_battles set price_cents = 900000000 where id = :'b3';
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.respond_nexamon_battle(gen_random_uuid(), %L, true)$$, :'b3'),
  'insufficient_funds', 'accept: the friend must have the money');
reset role;
select tests.fund(:b, 900000000, 'test:b2:b:rich');
select tests.cash(:b) as b0 \gset
select tests.login_as('authenticated', :b);
select public.respond_nexamon_battle(gen_random_uuid(), :'b3', true) as ab \gset
reset role;
select tests.assert(:'ab'::jsonb #>> '{battle,status}' = 'aborted' and :'ab'::jsonb #>> '{battle,abort_reason}' = 'challenger_funds'
  and tests.cash(:a) = :a0 and tests.cash(:b) = :b0 and tests.pb_owned(:a) = 0 and tests.pb_owned(:b) = 0,
  'abort before the pulls: nobody pays (nothing to refund), nothing is pulled');
select tests.set_cfg('nexamon', '{sets,mystic_energy,packPriceCents}', '20000');

-- =============================================================================
-- C. The battle: both pay, both packs at once, the winner takes all ten
-- =============================================================================
select tests.pb_pop() as pop0 \gset
select coalesce(sum(balance_cents), 0) as hh0 from public.ledger_accounts where system_key = 'households' \gset
select tests.login_as('authenticated', :a);
select (public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Bruno', 'mystic_energy') #>> '{battle,id}')::uuid as b4 \gset
reset role;
select tests.login_as('authenticated', :b);
select public.respond_nexamon_battle(:rr, :'b4', true) as acc \gset
select public.respond_nexamon_battle(:rr, :'b4', true) as acc2 \gset
reset role;
select tests.pb(:'b4') as bt \gset
select tests.assert(:'acc'::jsonb = :'acc2'::jsonb and (select count(*) from public.ledger_transactions where ref_type = 'nexamon_battle' and ref_id = :'b4') = 2,
  'accept: idempotent, two payments');
select tests.assert(tests.cash(:a) = :a0 - 20000 and tests.cash(:b) = :b0 - 20000
  and (select sum(balance_cents) from public.ledger_accounts where system_key = 'households') = :hh0 + 40000,
  'both pay one pack to the households');
select tests.assert(tests.pb_pop() = :pop0 + 10, 'every pulled copy counts for the population');
select tests.assert(
  :'acc'::jsonb #>> '{battle,status}' = 'running'
  and jsonb_array_length(:'acc'::jsonb #> '{battle,challenger_cards}') = 0 and jsonb_array_length(:'acc'::jsonb #> '{battle,opponent_cards}') = 0
  and :'acc'::jsonb #> '{battle,winner}' = 'null'::jsonb and (:'acc'::jsonb #>> '{battle,challenger_cents}')::bigint = 0,
  'no peeking: before the start the answer holds no pulls, no totals and no winner');
select (tests.pb(:'b4')).winner_id as win \gset
select tests.assert(
  (select count(*) from public.nexamon_copies where owner_id = :'win') = 10
  and (select count(*) from public.nexamon_copies where owner_id in (:a, :b) and owner_id <> :'win') = 0,
  'the winner owns all ten copies, the loser none');
select tests.assert(
  (tests.pb(:'b4')).winner_id = case when (public.nexamon_battle_decide((tests.pb(:'b4')).challenger_cards, (tests.pb(:'b4')).opponent_cards,
                                                                       (tests.pb(:'b4')).coin_seed) ->> 'winner') = 'challenger' then :a::uuid else :b::uuid end,
  'the stored winner follows the rule');
-- spectators and the opponent see the same, nothing early
select tests.login_as('authenticated', :c);
select public.get_nexamon_battle(:'b4') as sp0 \gset
reset role;
select tests.assert(jsonb_array_length(:'sp0'::jsonb #> '{battle,opponent_cards}') = 0 and :'sp0'::jsonb #> '{battle,me}' = 'null'::jsonb
  and (select count(*) from public.nexamon_live_viewers v join public.nexamon_live l on l.id = v.live_id where l.battle_id = :'b4') = 1,
  'a spectator sees no pulls before the start and is counted');
-- 3000 start + 2400 tear - 800 lead + 1800 = 6400 ms in: two slots known
select tests.pb_age(:'b4', 6400);
select tests.login_as('authenticated', :c);
select public.get_nexamon_battle(:'b4') as sp1 \gset
reset role;
select tests.assert(jsonb_array_length(:'sp1'::jsonb #> '{battle,challenger_cards}') = 2
  and jsonb_array_length(:'sp1'::jsonb #> '{battle,opponent_cards}') = 2 and :'sp1'::jsonb #> '{battle,winner}' = 'null'::jsonb,
  'lockstep: slot by slot on both sides, the winner not yet');
select tests.pb_age(:'b4', 20000);
select tests.login_as('authenticated', :a);
select public.get_nexamon_battle(:'b4') as fin \gset
select tests.throws_key($$select public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Bruno', 'nope')$$, 'nexamon_unknown', 'still checked');
reset role;
select tests.assert(:'fin'::jsonb #>> '{battle,status}' = 'done' and jsonb_array_length(:'fin'::jsonb #> '{battle,challenger_cards}') = 5
  and (:'fin'::jsonb #>> '{battle,challenger_cents}')::bigint = (tests.pb(:'b4')).challenger_cents
  and :'fin'::jsonb #>> '{battle,winner}' in ('challenger', 'opponent') and :'fin'::jsonb #>> '{battle,me}' = 'challenger',
  'after the reveal: all pulls, the totals and the winner');
select tests.assert(exists (select 1 from public.feed_items where kind = 'nexamon_battle_won' and dedupe_key = 'nexamon:battle:won:' || :'b4'),
  'the win is a feed item');

-- tie-break rules
select tests.assert(
  public.nexamon_battle_decide('[{"value_cents":100,"rarity":"common"}]', '[{"value_cents":90,"rarity":"rare"}]', 1) ->> 'winner' = 'challenger'
  and public.nexamon_battle_decide('[{"value_cents":100,"rarity":"common"}]', '[{"value_cents":100,"rarity":"rare"}]', 0)
      = '{"winner":"opponent","tie_break":"rarest","challenger_cents":100,"opponent_cents":100}'::jsonb
  and public.nexamon_battle_decide('[{"value_cents":100,"rarity":"rare"}]', '[{"value_cents":100,"rarity":"rare"}]', 4) ->> 'winner' = 'challenger'
  and public.nexamon_battle_decide('[{"value_cents":100,"rarity":"rare"}]', '[{"value_cents":100,"rarity":"rare"}]', 5) ->> 'tie_break' = 'coin'
  and public.nexamon_battle_decide('[{"value_cents":100,"rarity":"rare"}]', '[{"value_cents":100,"rarity":"rare"}]', 5) ->> 'winner' = 'opponent',
  'decide: value, then the rarest card, then the coin (even seed: challenger)');

-- hour limit
select tests.set_cfg('nexamon', '{battles,perHour}', '1');
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Bruno', 'mystic_energy')$$,
  'nexamon_battle_limit', 'battles.perHour (NX244)');
reset role;
select tests.set_cfg('nexamon', '{battles,perHour}', '6');
select tests.set_cfg('nexamon', '{battles,cooldownSeconds}', '600');
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.challenge_nexamon_battle(gen_random_uuid(), 'Pb_Bruno', 'mystic_energy')$$,
  'nexamon_battle_cooldown', 'battles.cooldownSeconds (NX245)');
reset role;
select tests.set_cfg('nexamon', '{battles,cooldownSeconds}', '0');

-- =============================================================================
-- D. Live openings: a bought pack, spectators only see what the opener has seen
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy') as pk \gset
reset role;
select id as live1 from public.nexamon_live where pack_id = (:'pk'::jsonb ->> 'pack_id')::uuid \gset
select tests.login_as('authenticated', :a);
select public.nexamon_lobby(true) as la2 \gset
select public.get_nexamon_live(:'live1') as lv0 \gset
reset role;
select tests.assert(exists (select 1 from jsonb_array_elements(:'la2'::jsonb -> 'live') x where x ->> 'id' = :'live1' and x #>> '{player,nickname}' = 'Pb_Bruno')
  and exists (select 1 from jsonb_array_elements(:'la2'::jsonb -> 'players') x where x ->> 'nickname' = 'Pb_Bruno' and (x ->> 'opening')::boolean),
  'lobby: the live opening is listed, Bruno''s figure says he is opening');
select tests.assert((:'lv0'::jsonb ->> 'progress')::integer = 0 and jsonb_array_length(:'lv0'::jsonb -> 'cards') = 0,
  'a spectator sees no card before the opener');
select tests.login_as('authenticated', :b);
select public.nexamon_live_progress((:'pk'::jsonb ->> 'pack_id')::uuid, 2) as pr \gset
reset role;
select tests.assert((:'pr'::jsonb ->> 'viewers')::integer = 1, 'the opener sees one viewer');
select tests.login_as('authenticated', :a);
select public.get_nexamon_live(:'live1') as lv1 \gset
select public.nexamon_live_react(gen_random_uuid(), :'live1', '🔥') as re \gset
select tests.throws_key(format($$select public.nexamon_live_react(gen_random_uuid(), %L, 'x')$$, :'live1'), 'invalid_argument', 'only the listed emojis');
reset role;
select tests.assert(jsonb_array_length(:'lv1'::jsonb -> 'cards') = 2
  and :'lv1'::jsonb #>> '{cards,0,card_key}' = :'pk'::jsonb #>> '{cards,0,card_key}'
  and jsonb_array_length(:'re'::jsonb -> 'reactions') = 1,
  'after the opener showed two cards the spectator sees exactly those; reactions arrive');
-- the opener goes quiet: the fixed pace takes over
update public.nexamon_live set progress_at = progress_at - interval '13 seconds' where id = :'live1';
select tests.login_as('authenticated', :a);
select public.get_nexamon_live(:'live1') as lv2 \gset
reset role;
select tests.assert(jsonb_array_length(:'lv2'::jsonb -> 'cards') = 4, 'fallback: one more card per fallbackSlotMs after staleMs');
-- Clara switched watching off: her pack is not live
select tests.login_as('authenticated', :c);
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy') as pkc \gset
select public.nexamon_live_progress((:'pkc'::jsonb ->> 'pack_id')::uuid, 1) as prc \gset
reset role;
select tests.assert(not exists (select 1 from public.nexamon_live where pack_id = (:'pkc'::jsonb ->> 'pack_id')::uuid)
  and :'prc'::jsonb -> 'live_id' = 'null'::jsonb, 'watching off: no live opening');
-- nobody reads the tables directly
select tests.login_as('authenticated', :a);
select tests.throws($$select * from public.nexamon_battles$$, '42501', 'nexamon_battles: no direct reads');
select tests.throws($$select * from public.nexamon_live$$, '42501', 'nexamon_live: no direct reads');
reset role;

select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after the Pack Battles');
