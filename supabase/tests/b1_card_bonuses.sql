-- =============================================================================
-- b1 · Nexamon: card bonuses, collections and the Black Label hype (ADR-171, migrations 6200-6230)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0e7b1000-0000-4000-8000-0000000000a1'''
\set b '''0e7b1000-0000-4000-8000-0000000000b1'''
\set c '''0e7b1000-0000-4000-8000-0000000000c1'''
\set d '''0e7b1000-0000-4000-8000-0000000000d1'''
\set rv '''0e7b1000-0000-4000-8000-0000000000e1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:a, 'Cb_Anna') is not null and tests.signup(:b, 'Cb_Bruno') is not null
   and tests.signup(:c, 'Cb_Clara') is not null and tests.signup(:d, 'Cb_Dora') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.set_level(:c, 10);
select tests.set_level(:d, 10);
select tests.fund(:a, 2000000000, 'test:b1:a');
select tests.fund(:b, 2000000000, 'test:b1:b');

select value as nx_cfg from public.game_config where key = 'nexamon' \gset
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{ai,legendaryListChanceBps}', '0');
select tests.set_cfg('nexamon', '{value,pressure,perRun}', '0');
select public.nexamon_sync();

create or replace function tests.b1_give(p_player uuid, p_card text, p_grade double precision default null) returns uuid
language plpgsql security definer as $$
declare v uuid;
begin
  v := public.nexamon_mint_copy(p_card, p_player, null, 'mint', 'pack', null, public.game_now());
  if p_grade is not null then
    update public.nexamon_copies set grade = p_grade, graded_at = public.game_now() where id = v;
  end if;
  return v;
end $$;
create or replace function tests.b1_type(p_card text) returns text language sql security definer as $$
  select public.nexamon_types() ->> p_card $$;
create or replace function tests.b1_bonus(p_player uuid, p_kind text) returns integer language sql security definer as $$
  select public.player_nexamon_bonus_bps(p_player, p_kind) $$;
create or replace function tests.b1_raw(p_player uuid, p_kind text) returns integer language sql security definer as $$
  select coalesce((select (raw ->> p_kind)::integer from public.nexamon_player_bonuses where player_id = p_player), 0) $$;
create or replace function tests.b1_notes(p_player uuid, p_type text) returns bigint language sql security definer as $$
  select count(*) from public.notifications where player_id = p_player and type_key = p_type $$;
create or replace function tests.b1_rewards(p_player uuid) returns bigint language sql security definer as $$
  select count(*) from public.ledger_transactions t where t.kind = 'nexamon_set_reward' and t.initiated_by = p_player $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. Rules (port of src/lib/sim/nexamon-bonuses.ts)
-- =============================================================================
select tests.assert(
  public.nexamon_card_bonus_def('common', 'mystic_energy', 1, 'fire') is null
  and public.nexamon_card_bonus_def('ultra', 'mystic_energy', 61, 'fire') = '{"kind": "company", "bps": 50}'::jsonb
  and public.nexamon_card_bonus_def('prisma', 'mystic_energy', 71, 'water') = '{"kind": "vault", "bps": 100}'::jsonb
  and public.nexamon_card_bonus_def('legendary', 'prismatic_peak', 76, 'dark') = '{"kind": "xp", "bps": 375}'::jsonb
  and public.nexamon_card_bonus_def('rare', 'mystic_energy', 60, 'grass') = '{"kind": "daily", "bps": 50}'::jsonb
  and public.nexamon_card_bonus_def('rare', 'mystic_energy', 59, 'grass') is null
  and public.nexamon_slab_boost_bps(null) = 10000 and public.nexamon_slab_boost_bps(8.5) = 10000
  and public.nexamon_slab_boost_bps(9) = 15000 and public.nexamon_slab_boost_bps(11) = 20000
  and public.nexamon_stack_bps(0, 'xp') = 0 and public.nexamon_stack_bps(500, 'xp') = 500
  and public.nexamon_stack_bps(700, 'xp') = 600 and public.nexamon_stack_bps(100000, 'xp') = 1000
  and public.nexamon_bps_text(50) = '0,5 %' and public.nexamon_bps_text(375) = '3,75 %' and public.nexamon_bps_text(100) = '1 %',
  'card bonus definitions, slab boost, stacking with knee and cap (same numbers as the unit tests)');
select tests.assert(
  (select count(*) from public.nexamon_cards k
    where public.nexamon_card_bonus_def(k.rarity, k.set_key, k.number, public.nexamon_types() ->> k.card_key) is not null) = 80,
  '80 of 321 cards give a bonus (every ultra, prisma, legendary, One of One and rare no. 60 of each set)');

-- =============================================================================
-- B. A bonus comes with a card and goes with a listing; slabs boost it
-- =============================================================================
select k.card_key as wcard from public.nexamon_cards k
 where k.set_key = 'mystic_energy' and k.rarity = 'prisma' and public.nexamon_types() ->> k.card_key = 'water'
 order by k.number limit 1 \gset
select tests.b1_give(:a, :'wcard') as wcopy \gset
select tests.assert(
  tests.b1_bonus(:a, 'vault') = 100 and tests.b1_bonus(:b, 'vault') = 0
  and public.player_upgrade_bps(:a, 'vault_interest') = 100
  and (public.nexamon_card_bonus_json(:'wcard', :a) ->> 'active')::boolean
  and not (public.nexamon_card_bonus_json(:'wcard', :b) ->> 'active')::boolean,
  'owning a water prisma gives +1 % vault interest (player_upgrade_bps vault_interest)');
select tests.b1_notes(:a, 'nexamon_bonus') as n0 \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'wcopy', 100000000) -> 'listing' ->> 'id' as wlist \gset
reset role;
select tests.assert(
  tests.b1_bonus(:a, 'vault') = 0 and public.player_upgrade_bps(:a, 'vault_interest') = 0
  and tests.b1_notes(:a, 'nexamon_bonus') = :n0 + 1,
  'a listed copy does not count: the bonus is gone, with a notification');
select tests.login_as('authenticated', :a);
select public.unlist_nexamon_card(gen_random_uuid(), :'wlist') is not null as ok \gset
reset role;
select tests.assert(tests.b1_bonus(:a, 'vault') = 100 and tests.b1_notes(:a, 'nexamon_bonus') = :n0 + 2,
  'unlisted again: the bonus is back, with a notification');
update public.nexamon_copies set grade = 9.5, graded_at = public.game_now() where id = :'wcopy';
select tests.assert(tests.b1_bonus(:a, 'vault') = 150, 'a slab of 9.5 boosts the bonus x1.5');
update public.nexamon_copies set grade = 11 where id = :'wcopy';
select tests.assert(tests.b1_bonus(:a, 'vault') = 200
  and (public.nexamon_card_bonus_json(:'wcard', :a) ->> 'boosted_bps')::integer = 200,
  'a Black Label boosts the bonus x2');

-- =============================================================================
-- C. Applied in real paths: vault claim (money from the treasury) and mission XP
-- =============================================================================
update public.vaults set accrual_started_at = public.game_now() - interval '3 hours' where player_id = :a;
select tests.cash(:a) as ac1 \gset
select tests.login_as('authenticated', :a);
select public.claim_vault(:rv) as vc \gset
reset role;
select amount_cents as vbase from public.vault_claims where player_id = :a and request_id = :rv \gset
select tests.assert(
  :vbase::bigint > 0
  and (:'vc'::jsonb ->> 'interest_cents')::bigint = public.apply_bps(:vbase::bigint, 200)
  and tests.cash(:a) = :ac1::bigint + (:'vc'::jsonb ->> 'claimed_cents')::bigint,
  'claim_vault(): the card bonus (+2 %) pays on top of the claim');

select k.card_key as xcard from public.nexamon_cards k
 where k.rarity in ('ultra', 'prisma', 'legendary') and public.nexamon_types() ->> k.card_key in ('psychic', 'fairy')
 order by k.set_key, k.number limit 1 \gset
select tests.b1_give(:b, :'xcard') is not null as ok \gset
select public.cfg_num(coalesce(public.config_jsonb('progression'), '{}'::jsonb), '{xpMultiplier}', 2) as mult \gset
select public.player_xp_bonus_bps(:b, 'mission') as bxb, tests.b1_bonus(:b, 'mission_xp') as bmx \gset
select public.grant_xp(:b, 'mission', 1000, 'b1:mission:b', null, null) as bxp \gset
select tests.assert(
  :bmx::integer > 0 and :bxb::integer >= :bmx::integer
  and public.player_xp_bonus_bps(:b, 'trade') = :bxb::integer - :bmx::integer
  and :bxp::integer = round(1000 * :mult * (10000 + :bxb::integer) / 10000.0)::integer,
  'grant_xp(): mission XP rise by the mission_xp card bonus, other sources do not');

-- =============================================================================
-- D. Stacking and the hard cap
-- =============================================================================
select count(tests.b1_give(:d, k.card_key, 11)) as dn from public.nexamon_cards k
 where public.nexamon_card_bonus_def(k.rarity, k.set_key, k.number, public.nexamon_types() ->> k.card_key) ->> 'kind' = 'company' \gset
select tests.assert(
  :dn::integer > 5 and tests.b1_raw(:d, 'company') > 1000 and tests.b1_bonus(:d, 'company') = 1000
  and public.player_upgrade_bps(:d, 'task_pay') = 1000,
  'every company card as a Black Label: raw far above the cap, effective exactly the cap (10 %)');

-- =============================================================================
-- E. Collections: a type collection pays once; a set and the master set
-- =============================================================================
select o.type as stype, count(*) as sneed from public.nexamon_cards k
 cross join lateral (select public.nexamon_types() ->> k.card_key as type) o
 where k.set_key = 'super_apex' group by o.type order by count(*), o.type limit 1 \gset
select tests.cash(:c) as cc0 \gset
select count(tests.b1_give(:c, k.card_key)) as ok from public.nexamon_cards k
 where k.set_key = 'super_apex' and public.nexamon_types() ->> k.card_key = :'stype' \gset
select tests.assert(
  exists (select 1 from public.nexamon_collection_completions x
           where x.player_id = :c and x.set_key = 'super_apex' and x.kind = 'type' and x.type_key = :'stype'
             and x.reward_cents = 3 * 100000 and x.reward_xp > 0)
  and tests.cash(:c) = :cc0::bigint + 300000 and tests.b1_rewards(:c) = 1
  and tests.b1_notes(:c, 'nexamon_set') = 1
  and exists (select 1 from jsonb_array_elements((select sources from public.nexamon_player_bonuses where player_id = :c)) s
               where s ->> 'id' = 'col:super_apex:type:' || :'stype'),
  'a complete type collection: 3 pack prices from the households, XP, a notification and its bonus');
-- sell one away and get it back: the bonus goes and comes, the reward stays paid once
select c.id as ccopy from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
 where c.owner_id = :c and k.set_key = 'super_apex' order by k.number limit 1 \gset
update public.nexamon_copies set owner_id = :b where id = :'ccopy';
select tests.assert(
  not exists (select 1 from jsonb_array_elements((select sources from public.nexamon_player_bonuses where player_id = :c)) s
               where s ->> 'id' like 'col:super_apex:type:%'),
  'one card gone: the collection bonus is gone');
update public.nexamon_copies set owner_id = :c where id = :'ccopy';
select tests.assert(tests.b1_rewards(:c) = 1 and tests.cash(:c) = :cc0::bigint + 300000
  and exists (select 1 from jsonb_array_elements((select sources from public.nexamon_player_bonuses where player_id = :c)) s
               where s ->> 'id' = 'col:super_apex:type:' || :'stype'),
  'complete again: the bonus is back, no second reward');

select tests.cash(:c) as cc1 \gset
select count(tests.b1_give(:c, k.card_key)) as ok from public.nexamon_cards k where k.set_key = 'mystic_energy' \gset
select tests.assert(
  exists (select 1 from public.nexamon_collection_completions x where x.player_id = :c and x.set_key = 'mystic_energy' and x.kind = 'complete'
             and x.reward_cents = 20 * 20000)
  and not exists (select 1 from public.nexamon_collection_completions x where x.player_id = :c and x.set_key = 'mystic_energy' and x.kind = 'master')
  and (select count(*) from public.nexamon_collection_completions x where x.player_id = :c and x.set_key = 'mystic_energy' and x.kind = 'type') = 10
  and tests.cash(:c) = :cc1::bigint + 20 * 20000 + 10 * 3 * 20000,
  'all 77 cards: the set and its ten type collections are complete, the master set not yet (raw prismas)');
update public.nexamon_copies c set grade = 9, graded_at = public.game_now()
  from public.nexamon_cards k
 where k.card_key = c.card_key and c.owner_id = :c and k.set_key = 'mystic_energy' and k.rarity in ('prisma', 'legendary');
select tests.assert(
  exists (select 1 from public.nexamon_collection_completions x where x.player_id = :c and x.set_key = 'mystic_energy' and x.kind = 'master'
             and x.reward_cents = 75 * 20000)
  and exists (select 1 from public.feed_items f where f.actor_id = :c and f.kind = 'nexamon_master_set')
  and tests.b1_bonus(:c, 'wage') >= 100 and tests.b1_bonus(:c, 'daily') >= 100,
  'every prisma and legendary in a 9: the master set, its reward, a feed item and +1 % on every kind');
select tests.login_as('authenticated', :c);
select public.get_nexamon_bonuses() as cb \gset
select public.get_player_nexamon(null, 5) as cp \gset
reset role;
select tests.assert(
  jsonb_array_length(:'cb'::jsonb -> 'totals') = 7 and jsonb_array_length(:'cb'::jsonb -> 'cards') = 54
  and exists (select 1 from jsonb_array_elements(:'cb'::jsonb -> 'collections') x
               where x ->> 'kind' = 'master' and x ->> 'set' = 'mystic_energy' and (x ->> 'complete')::boolean
                 and x ->> 'completed_at' is not null)
  and exists (select 1 from jsonb_array_elements(:'cb'::jsonb -> 'collections') x
               where x ->> 'kind' = 'complete' and x ->> 'set' = 'prismatic_peak' and not (x ->> 'complete')::boolean
                 and jsonb_array_length(x -> 'missing') = 77)
  and jsonb_array_length(:'cp'::jsonb -> 'badges') >= 13
  and jsonb_array_length(:'cp'::jsonb -> 'slabs') = 7 and (:'cp'::jsonb #>> '{summary,black_labels}')::integer = 0
  and (:'cp'::jsonb #>> '{slabs,0,grade}')::double precision = 9,
  'get_nexamon_bonuses(): totals, the 54 bonus cards, collections with what is missing; profile: badges and slabs');

-- =============================================================================
-- F. Black Label hype
-- =============================================================================
select k.card_key as lcard, k.value_e4 as lval from public.nexamon_cards k where k.rarity = 'legendary' order by k.card_key limit 1 \gset
select tests.b1_give(:b, :'lcard', 11) as lcopy \gset
select tests.set_cfg('nexamon', '{blackLabelHype,rarityChanceBps,legendary}', '10000');
select tests.set_cfg('nexamon', '{blackLabelHype,minJumpBps}', '5000');
select tests.set_cfg('nexamon', '{blackLabelHype,maxJumpBps}', '5000');
select public.nexamon_hype_run_due(public.game_now()) as jumps \gset
select tests.assert(
  :jumps::integer >= 1
  and public.nexamon_black_label_bps(:'lcard') = 150000
  and public.nexamon_copy_value_cents(:lval::bigint, 'mint', 11, :'lcard') = public.div_round_half_even(:lval::numeric * 150000, 1000000)
  and (public.nexamon_copy_json(:'lcopy') ->> 'value_cents')::bigint = public.div_round_half_even(:lval::numeric * 150000, 1000000)
  and (public.nexamon_card_json(:'lcard', :b, public.game_now()) ->> 'black_label_bps')::integer = 150000
  and tests.b1_notes(:b, 'nexamon_hype') = 1
  and exists (select 1 from public.feed_items f where f.actor_id = :b and f.kind = 'nexamon_hype')
  and exists (select 1 from public.nexamon_hype_points h where h.card_key = :'lcard' and h.jump_bps = 5000),
  'a hype jump: +50 % on the Black Label factor (15x), the copy value follows, owner notified, a feed item for a big jump');
select public.nexamon_hype_run_due(public.game_now()) as jumps2 \gset
select tests.assert(public.nexamon_black_label_bps(:'lcard') = 150000, 'one step per card and hour');
select tests.set_cfg('nexamon', '{blackLabelHype,rarityChanceBps,legendary}', '0');
update public.nexamon_cards set bl_hype_at = bl_hype_at - interval '10 hours' where card_key = :'lcard';
select public.nexamon_hype_run_due(public.game_now()) is not null as ok \gset
select tests.assert(
  public.nexamon_black_label_bps(:'lcard') < 150000 and public.nexamon_black_label_bps(:'lcard') > 145000
  and public.nexamon_hype_chance_bps('legendary', 0, 0) = 0,
  'ten hours without a jump: the factor decays toward the base (about 1 % of the excess per hour)');
update public.game_config set value = :'nx_cfg'::jsonb where key = 'nexamon';
select tests.assert(public.nexamon_hype_chance_bps('legendary', 10000, 1) = 240
  and public.nexamon_hype_chance_bps('legendary', 0, 4) = 60,
  'hype chance by rarity, popularity and the number of Black Labels (as in the unit tests)');

-- =============================================================================
-- G. Money and privileges
-- =============================================================================
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after the collection rewards');
select tests.assert(
  not has_function_privilege('authenticated', 'public.nexamon_bonus_recompute(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.nexamon_hype_run_due(timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.get_nexamon_bonuses()', 'execute')
  and not has_table_privilege('authenticated', 'public.nexamon_player_bonuses', 'select'),
  'the internals are closed to clients');

-- the test cards leave the game again: later files (fixtures) must not see a few hundred extra slabs
delete from public.nexamon_copies where owner_id in (:a, :b, :c, :d);
update public.nexamon_cards set bl_factor_bps = null, bl_hype_at = null, bl_jump_at = null;
delete from public.nexamon_hype_points;
