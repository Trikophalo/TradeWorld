-- =============================================================================
-- 9m · Accessories for the pixel figure, the friends plaza, poking friends (ADR-155)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0acce550-0000-4000-8000-0000000000a1'''
\set b '''0acce550-0000-4000-8000-0000000000b1'''
\set c '''0acce550-0000-4000-8000-0000000000c1'''
\set rq '''0acce550-0000-4000-8000-0000000000e1'''
\set rp '''0acce550-0000-4000-8000-0000000000e2'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Acc_Anna') is not null and tests.signup(:b, 'Acc_Bruno') is not null
   and tests.signup(:c, 'Acc_Clara') is not null as ok \gset
select tests.set_level(:a, 6);
select tests.set_level(:b, 3);
select tests.fund(:a, 20000000, 'test:9m:a');

-- =============================================================================
-- A. The catalogue comes from game_config (src/config/accessories.ts)
-- =============================================================================
select tests.assert(
  jsonb_array_length(public.accessories_cfg() -> 'items') >= 120
  and public.accessory_item('cowboy_hat') ->> 'slot' = 'head'
  and (public.accessory_item('cowboy_hat') ->> 'priceCents')::bigint = 3250000
  and public.accessory_item('nope') is null
  and public.accessories_cfg() -> 'slots' = '["back", "body", "face", "head", "hand", "pet"]'::jsonb,
  'accessories_cfg(): at least 120 items with slot and price, six slots back to front');

-- =============================================================================
-- B. Buying: paid to the households, worn at once, idempotent; errors
-- =============================================================================
select tests.cash(:a) as cash0 \gset
select tests.households() as hh0 \gset
select tests.login_as('authenticated', :a);
select public.get_accessories() as s0 \gset
select public.buy_accessory(:rq, 'cowboy_hat') as s1 \gset
select public.buy_accessory(:rq, 'cowboy_hat') as s1b \gset
select tests.throws_key($$select public.buy_accessory(gen_random_uuid(), 'cowboy_hat')$$, 'accessory_owned',
  'buy_accessory(): each accessory only once (NX132)');
select tests.throws_key($$select public.buy_accessory(gen_random_uuid(), 'flux_capacitor')$$, 'accessory_unknown',
  'buy_accessory(): unknown key (NX130)');
select tests.throws_key($$select public.buy_accessory(gen_random_uuid(), 'crown')$$, 'accessory_locked',
  'buy_accessory(): the crown needs level 25 (NX131)');
select tests.throws_key($$select public.buy_accessory(null, 'party_hat')$$, 'invalid_argument',
  'buy_accessory(): a request id is required');
reset role;
select tests.assert(
  :'s0'::jsonb = jsonb_build_object('owned', '[]'::jsonb, 'worn', '[]'::jsonb, 'avatar_key', (select avatar_key from public.profiles where id = :a))
  and :'s1'::jsonb -> 'owned' = '["cowboy_hat"]'::jsonb and :'s1'::jsonb -> 'worn' = '["cowboy_hat"]'::jsonb
  and (:'s1'::jsonb ->> 'paid_cents')::bigint = 3250000
  and :'s1b'::jsonb = :'s1'::jsonb
  and tests.cash(:a) = :cash0::bigint - 3250000
  and tests.households() = :hh0::bigint + 3250000
  and (select count(*) from public.ledger_transactions where idempotency_key = 'accessory:' || :a || ':' || :rq) = 1
  and (select count(*) from public.player_accessories where player_id = :a) = 1,
  'buy_accessory(): 32.500 € to the households, owned and worn at once, the same request id replays');
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after accessory purchases');

-- not enough money: a player with the starting capital cannot buy a jetpack
select tests.set_level(:b, 30);
select tests.cash(:b) as cash_b \gset
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.buy_accessory(gen_random_uuid(), 'jetpack')$$, 'insufficient_funds',
  'buy_accessory(): not enough cash');
reset role;
select tests.assert(tests.cash(:b) = :cash_b::bigint and not exists (select 1 from public.player_accessories where player_id = :b),
  'a failed purchase changes nothing');
select tests.set_level(:b, 3);

-- =============================================================================
-- C. Wearing: only owned ones, one per slot
-- =============================================================================
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.wear_accessory(gen_random_uuid(), 'party_hat', true)$$, 'accessory_not_owned',
  'wear_accessory(): only owned accessories (NX133)');
select public.buy_accessory(gen_random_uuid(), 'party_hat') as s2 \gset
select public.buy_accessory(gen_random_uuid(), 'sunglasses') is not null as ok \gset
select public.buy_accessory(gen_random_uuid(), 'superhero_cape') is not null as ok \gset
select public.wear_accessory(gen_random_uuid(), 'cowboy_hat', true) as s3 \gset
select public.wear_accessory(gen_random_uuid(), 'sunglasses', false) as s4 \gset
select public.wear_accessory(gen_random_uuid(), 'sunglasses', false) as s4b \gset
reset role;
select tests.assert(
  :'s2'::jsonb -> 'worn' = '["party_hat"]'::jsonb
  and :'s3'::jsonb -> 'worn' = '["superhero_cape", "sunglasses", "cowboy_hat"]'::jsonb
  and :'s4'::jsonb -> 'worn' = '["superhero_cape", "cowboy_hat"]'::jsonb and :'s4b'::jsonb = :'s4'::jsonb
  and jsonb_array_length(:'s4'::jsonb -> 'owned') = 4
  and (select count(*) from public.player_accessories_worn where player_id = :a and slot = 'head') = 1,
  'one per slot: a new hat replaces the old one; taking off keeps it owned; worn keys come back to front');

-- =============================================================================
-- D. Others see it: player card and friends list; a legendary purchase is news
-- =============================================================================
insert into public.friendships (requester_id, addressee_id, status, responded_at) values (:a, :b, 'accepted', now());
update public.profiles set last_active_at = now() where id = :a;
select tests.login_as('authenticated', :b);
select public.get_player_card('Acc_Anna') as card \gset
select public.get_friends() as fr \gset
reset role;
select tests.assert(
  :'card'::jsonb -> 'accessories' = '["superhero_cape", "cowboy_hat"]'::jsonb
  and :'fr'::jsonb -> 'friends' -> 0 ->> 'nickname' = 'Acc_Anna'
  and :'fr'::jsonb -> 'friends' -> 0 -> 'accessories' = '["superhero_cape", "cowboy_hat"]'::jsonb
  and :'fr'::jsonb -> 'friends' -> 0 ->> 'avatar_key' = (select avatar_key from public.profiles where id = :a)
  and (:'fr'::jsonb -> 'friends' -> 0 ->> 'online')::boolean
  and (:'fr'::jsonb -> 'friends' -> 0) ? 'last_active_at',
  'get_player_card() and friends_json() carry the worn accessories, the friend''s portrait, online and last_active_at');

select tests.set_level(:a, 16);
select tests.fund(:a, 800000000, 'test:9m:a2');
select tests.login_as('authenticated', :a);
select public.buy_accessory(gen_random_uuid(), 'halo') is not null as ok \gset
reset role;
select tests.assert(
  (select count(*) from public.feed_items where actor_id = :a and kind = 'accessory_bought' and payload ->> 'key' = 'halo') = 1
  and not exists (select 1 from public.feed_items where actor_id = :a and kind = 'accessory_bought' and payload ->> 'key' <> 'halo')
  and public.feed_item_label('accessory_bought', '{"name": "Heiligenschein"}') = 'Heiligenschein gekauft'
  and tests.money_invariant() = 'ok',
  'a legendary accessory is news for the friends (feed accessory_bought), common ones are not');

-- the mythic showpieces (ADR-155 addendum) cost hundreds of millions and are news too
select tests.set_level(:a, 45);
select tests.fund(:a, 15000000000, 'test:9m:a3');
select tests.cash(:a) as cash_m \gset
select tests.login_as('authenticated', :a);
select public.buy_accessory(gen_random_uuid(), 'phoenix_wings') as sm \gset
reset role;
select tests.assert(
  public.accessory_item('phoenix_wings') ->> 'rarity' = 'mythic'
  and (:'sm'::jsonb ->> 'paid_cents')::bigint = 15000000000
  and tests.cash(:a) = :cash_m::bigint - 15000000000
  and (select count(*) from public.feed_items where actor_id = :a and kind = 'accessory_bought'
         and payload ->> 'key' = 'phoenix_wings' and payload ->> 'rarity' = 'mythic') = 1
  and tests.money_invariant() = 'ok',
  'a mythic accessory (150 Mio. €) is paid in full and is news for the friends');

-- =============================================================================
-- E. Poking: only friends, a pause per friend, a daily cap, the notification arrives
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.poke_friend(:rp, 'acc_anna') as p1 \gset
select public.poke_friend(:rp, 'acc_anna') as p1b \gset
select tests.throws_key($$select public.poke_friend(gen_random_uuid(), 'Acc_Anna')$$, 'poke_too_soon',
  'poke_friend(): the same friend again only after the pause (NX135)');
select tests.throws_key($$select public.poke_friend(gen_random_uuid(), 'Acc_Clara')$$, 'not_friends',
  'poke_friend(): only friends (NX134)');
select tests.throws_key($$select public.poke_friend(gen_random_uuid(), 'Niemand_Da')$$, 'player_not_found',
  'poke_friend(): unknown nickname');
select tests.throws_key($$select public.poke_friend(gen_random_uuid(), 'Acc_Bruno')$$, 'invalid_argument',
  'poke_friend(): not oneself');
reset role;
select tests.assert(
  :'p1'::jsonb ->> 'nickname' = 'Acc_Anna' and :'p1b'::jsonb = :'p1'::jsonb
  and (:'p1'::jsonb ->> 'next_at')::timestamptz > (:'p1'::jsonb ->> 'poked_at')::timestamptz
  and (:'p1'::jsonb ->> 'left_today')::int = 29
  and (select count(*) from public.notifications n where n.player_id = :a and n.type_key = 'friend_poke'
          and n.title = 'Acc_Bruno hat dich angestupst! 👉' and n.link = '/players/Acc_Bruno') = 1
  and (select count(*) from public.friend_pokes where poker_id = :b) = 1,
  'poke_friend(): the friend gets a friend_poke notification linking to the poker; idempotent per request');

-- after the pause it works again; the daily cap stops the next one
update public.friend_pokes set created_at = created_at - interval '11 minutes' where poker_id = :b;
select tests.login_as('authenticated', :b);
select public.poke_friend(gen_random_uuid(), 'Acc_Anna') ->> 'nickname' as p2 \gset
reset role;
update public.friend_pokes set created_at = created_at - interval '11 minutes' where poker_id = :b;
insert into public.friend_pokes (poker_id, target_id, created_at)
select :b, :a, now() - interval '1 hour' from generate_series(1, 28);
update public.friend_pokes set created_at = now() - interval '3 hours' where poker_id = :b;
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.poke_friend(gen_random_uuid(), 'Acc_Anna')$$, 'poke_daily_limit',
  'poke_friend(): at most 30 pokes in 24 hours (NX136)');
reset role;
select tests.assert(:'p2' = 'Acc_Anna'
  and (select count(*) from public.notifications where player_id = :a and type_key = 'friend_poke') = 2,
  'poke_friend(): after the pause the same friend can be poked again');

-- a player who switched friend_poke off gets nothing
delete from public.friend_pokes where poker_id = :a;
insert into public.notification_preferences (player_id, type_key, in_app_enabled) values (:b, 'friend_poke', false)
on conflict (player_id, type_key) do update set in_app_enabled = false;
select tests.login_as('authenticated', :a);
select public.poke_friend(gen_random_uuid(), 'Acc_Bruno') is not null as ok \gset
reset role;
select tests.assert(not exists (select 1 from public.notifications where player_id = :b and type_key = 'friend_poke'),
  'poke_friend(): respects the notification settings of the poked friend');

-- =============================================================================
-- F. A reset forgets the wardrobe and the pokes
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.reset_account(gen_random_uuid(), 'Acc_Anna') is not null as ok \gset
reset role;
select tests.assert(
  not exists (select 1 from public.player_accessories where player_id = :a)
  and not exists (select 1 from public.player_accessories_worn where player_id = :a)
  and not exists (select 1 from public.friend_pokes where poker_id = :a)
  and tests.money_invariant() = 'ok',
  'reset_account(): accessories and pokes are gone, the ledger still balances');
