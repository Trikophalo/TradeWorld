-- =============================================================================
-- f7 · Pack fixes: every card of a pack shows in a Pack Battle, multi-buys back to back, 30-pack lineups
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0f7c7c7c-0000-4000-8000-0000000000a1'''
\set b '''0f7c7c7c-0000-4000-8000-0000000000b1'''
\set c '''0f7c7c7c-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Pf_Lena') is not null and tests.signup(:b, 'Pf_Max') is not null
   and tests.signup(:c, 'Pf_Ida') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.set_level(:c, 10);
select tests.fund(:a, 50000000, 'test:f7:a');
select tests.fund(:b, 50000000, 'test:f7:b');
select tests.fund(:c, 50000000, 'test:f7:c');
insert into public.friendships (requester_id, addressee_id, status, responded_at)
values (:a, :b, 'accepted', now());
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{battles,cooldownSeconds}', '0');
select tests.set_cfg('nexamon', '{battles,perHour}', '20');
select tests.set_cfg('nexamon', '{sets,mystic_energy,packPriceCents}', '20000');
select tests.set_cfg('nexamon', '{packs,perMinute}', '20');
select tests.set_cfg('nexamon', '{packs,maxPacksPerMinute}', '100');
select tests.set_cfg('nexamon', '{packBattle,maxPacks}', '30');

create or replace function tests.pf(p_id uuid) returns public.nexamon_battles language sql security definer as $$
  select * from public.nexamon_battles where id = p_id $$;
-- moves the whole clock of a battle so that it started p_ms ago
create or replace function tests.pf_started(p_id uuid, p_ms integer) returns void language plpgsql security definer as $$
declare
  v_shift interval;
begin
  select (clock_timestamp() - make_interval(secs => p_ms / 1000.0)) - starts_at into v_shift
    from public.nexamon_battles where id = p_id;
  update public.nexamon_battles
     set created_at = created_at + v_shift, expires_at = expires_at + v_shift, accepted_at = accepted_at + v_shift,
         starts_at = starts_at + v_shift, decide_at = decide_at + v_shift, ends_at = ends_at + v_shift
   where id = p_id;
  update public.nexamon_live set started_at = started_at + v_shift, ends_at = ends_at + v_shift where battle_id = p_id;
end $$;
-- elapsed ms of an answer on its own clock plus the lead (as nexamon_battle_json counts)
create or replace function tests.pf_ms(p jsonb) returns numeric language sql as $$
  select extract(epoch from ((p #>> '{battle,server_time}')::timestamptz - (p #>> '{battle,starts_at}')::timestamptz)) * 1000 + 800 $$;
create or replace function tests.pf_hits(p_player uuid, p_action text) returns bigint language sql security definer as $$
  select coalesce(sum(hits), 0) from public.rate_limits where player_id = p_player and action = p_action $$;
-- waits for a fresh rate-limit minute when the current one ends within p_margin seconds
create or replace function tests.pf_fresh_minute(p_margin integer) returns void language plpgsql as $$
begin
  if extract(second from clock_timestamp()) > 60 - p_margin then
    perform pg_sleep(60.2 - extract(second from clock_timestamp()));
  end if;
end $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. Pack Battle: the fifth card of every pack is revealed before the next pack tears (owner bug)
-- =============================================================================
select tests.login_as('authenticated', :a);
select (public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy', 'mystic_energy', 'mystic_energy'], 2,
                                          array['Pf_Max'], false, false) #>> '{battle,id}')::uuid as r1 \gset
reset role;
select tests.login_as('authenticated', :b);
select public.join_nexamon_pack_battle(gen_random_uuid(), :'r1') is not null as ok \gset
reset role;
select tests.assert((tests.pf(:'r1')).status = 'accepted'
  and (select bool_and(jsonb_array_length(cards) = 15
                       and (select array_agg((x ->> 'idx')::integer order by (x ->> 'idx')::integer) from jsonb_array_elements(cards) x)
                           = (select array_agg(g) from generate_series(1, 15) g))
         from public.nexamon_battle_seats where battle_id = :'r1'),
  'timeline: every seat holds 15 cards, idx 1..15 over the lineup');
-- card 5 is known from 8.8 s on (tear 2400 + 4 × slot 1800 − lead 800), card 6 from 13.0 s (2 × 2400 + 5 × 1800 − 800)
select tests.pf_started(:'r1', 10500);
select tests.login_as('authenticated', :b);
select public.get_nexamon_battle(:'r1') as g1 \gset
reset role;
select tests.assert(tests.pf_ms(:'g1') between 9600 and 13799
  and (select bool_and(jsonb_array_length(x -> 'cards') = 5
                       and (select bool_and((c ->> 'pack')::integer = 1) from jsonb_array_elements(x -> 'cards') c)
                       and x #>> '{cards,4,slot}' = '5')
         from jsonb_array_elements(:'g1'::jsonb #> '{battle,seats}') x),
  'timeline: between the fifth card and the next pack every seat shows all five cards of pack 1, none of pack 2');
select tests.assert(:'g1'::jsonb #>> '{battle,status}' = 'running' and :'g1'::jsonb #> '{battle,winner_seat}' = 'null'::jsonb,
  'timeline: still running, no winner yet');
-- the last card (15) is known from 31.6 s on; the decision from 33.4 s (decide 34.2 s − lead)
select tests.pf_started(:'r1', 32000);
select tests.login_as('authenticated', :b);
select public.get_nexamon_battle(:'r1') as g2 \gset
reset role;
select tests.assert(tests.pf_ms(:'g2') between 32400 and 34199
  and (select bool_and(jsonb_array_length(x -> 'cards') = 15) from jsonb_array_elements(:'g2'::jsonb #> '{battle,seats}') x)
  and :'g2'::jsonb #> '{battle,winner_seat}' = 'null'::jsonb,
  'timeline: the last card of the last pack shows before the decision');
select tests.assert(
  ((tests.pf(:'r1')).decide_at - (tests.pf(:'r1')).starts_at) = make_interval(secs => 3 * (2.4 + 5 * 1.8)),
  'timeline: the decision comes one slot after the last card (packs × (tear + 5 slots))');
select tests.pf_started(:'r1', 60000);
select tests.login_as('authenticated', :a);
select public.get_nexamon_battle(:'r1') as g3 \gset
reset role;
select tests.assert(:'g3'::jsonb #>> '{battle,status}' = 'done' and :'g3'::jsonb #> '{battle,winner_seat}' <> 'null'::jsonb
  and (select bool_and(jsonb_array_length(x -> 'cards') = 15) from jsonb_array_elements(:'g3'::jsonb #> '{battle,seats}') x),
  'timeline: done, every card of every pack shown');

-- =============================================================================
-- B. Multi-buys back to back: one action each, the packs count against the volume cap
-- =============================================================================
select tests.cash(:c) as cash0 \gset
select tests.login_as('authenticated', :c);
select public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 10) as m1 \gset
select public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 10) as m2 \gset
select public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 10) as m3 \gset
select public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 10) as m4 \gset
select public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 10) as m5 \gset
reset role;
select tests.assert(
  (select bool_and((m ->> 'count')::integer = 10 and jsonb_array_length(m -> 'packs') = 10)
     from unnest(array[:'m1'::jsonb, :'m2'::jsonb, :'m3'::jsonb, :'m4'::jsonb, :'m5'::jsonb]) m)
  and (select count(*) from public.nexamon_packs where player_id = :c) = 50
  and tests.cash(:c) < :cash0::bigint,
  'multi-buy: five buys of ten packs in a row all go through (was: the third failed with rate_limited)');
select tests.assert(tests.pf_hits(:c, 'nexamon_pack') = 5 and tests.pf_hits(:c, 'nexamon_pack_volume') = 50,
  'multi-buy: each buy is one action of packs.perMinute; every pack counts for packs.maxPacksPerMinute');

-- the volume cap still holds, all or nothing, and the error says how long to wait (another player: a fresh count)
select tests.pf_fresh_minute(10);
select tests.set_cfg('nexamon', '{packs,maxPacksPerMinute}', '15');
select tests.cash(:b) as cash1 \gset
select tests.login_as('authenticated', :b);
select (public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 10) ->> 'count')::integer = 10 as ok \gset
reset role;
select tests.cash(:b) as cash2 \gset
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 10)$$, 'rate_limited',
  'multi-buy: more than packs.maxPacksPerMinute packs a minute are refused');
do $$
declare
  v_state  text;
  v_detail text;
begin
  perform public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 10);
  raise exception 'ASSERTION FAILED: the buy over the cap went through';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
  if v_state <> 'NX004' or v_detail !~ '^retry_after=([1-9]|[1-5][0-9]|60)$' then
    raise exception 'ASSERTION FAILED: rate_limited carries the wait (got % / %)', v_state, v_detail;
  end if;
  raise notice 'ok - rate_limited carries the seconds to wait (%)', v_detail;
end $$;
reset role;
select tests.assert(tests.cash(:b) < :cash1::bigint and tests.cash(:b) = :cash2::bigint and (select count(*) from public.nexamon_packs where player_id = :b) = 10,
  'multi-buy: a refused buy takes no money and opens no pack');

-- a single buy still counts per pack; its error says the wait too
select tests.set_cfg('nexamon', '{packs,maxPacksPerMinute}', '100');
select tests.set_cfg('nexamon', '{packs,perMinute}', '1');
select tests.pf_fresh_minute(10);
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy'),
                                 public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy')$$, 'rate_limited',
  'buy_nexamon_pack(): at most packs.perMinute purchases a minute');
reset role;
select tests.set_cfg('nexamon', '{packs,perMinute}', '20');
select tests.assert(not has_function_privilege('authenticated', 'public.nexamon_buy_pack_as(uuid, uuid, text, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.api_rate_limited(integer)', 'execute'),
  'the internal purchase and the error helper are not callable by players');

-- =============================================================================
-- C. Lineups of up to packBattle.maxPacks (30): ten packs of three sets fit
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.create_nexamon_pack_battle(gen_random_uuid(),
         array_fill('mystic_energy'::text, array[10]) || array_fill('super_apex'::text, array[10]) || array_fill('mystic_energy'::text, array[10]),
         2, '{}', false, false) as big \gset
reset role;
select tests.assert(jsonb_array_length(:'big'::jsonb #> '{battle,packs}') = 30,
  'create: a lineup of 30 packs is accepted');
select tests.login_as('authenticated', :a);
select public.cancel_nexamon_battle(gen_random_uuid(), (:'big'::jsonb #>> '{battle,id}')::uuid) is not null as ok \gset
reset role;
select tests.assert((tests.pf((:'big'::jsonb #>> '{battle,id}')::uuid)).status = 'cancelled',
  'create: the 30-pack lobby can be cancelled (stake back)');
