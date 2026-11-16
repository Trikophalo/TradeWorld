-- =============================================================================
-- NEXA · 6320 · Nexamon Pack Battles: challenge, accept, both packs at once, the winner takes all (ADR-172)
-- =============================================================================
-- * challenge_nexamon_battle(p_request_id, p_nickname, p_set): a friend who is on the Collectibles tab right now,
--   both unlocked, one battle at a time per player, battles.cooldownSeconds between challenges, battles.perHour
--   accepted battles per hour. Open for battles.challengeSeconds. Nothing is paid yet.
-- * respond_nexamon_battle(p_request_id, p_battle_id, p_accept): the challenged friend says yes or no. Yes: both pay
--   one pack of the set (cash -> households, as buy_nexamon_pack), both packs are opened at once with the same pull
--   rules (nexamon_open_pack, every copy counts for the population), the higher total value at pull time wins
--   (tie: rarest single card, then coin_seed % 2 = 0 for the challenger; decideBattle). The winner owns all copies at
--   once; the loser keeps nothing. If the challenger cannot pay any more, the battle is aborted and nobody pays
--   (both payments happen in one transaction with the pulls: a battle never stops between paying and pulling).
--   The result stands even if somebody closes the page during the reveal.
-- * cancel_nexamon_battle(p_request_id, p_battle_id): the challenger takes an open challenge back.
-- * get_nexamon_battle(p_battle_id): the players and anyone watching see the pulls slot by slot from the shared start
--   (nexamon_battle_json); the battle is a live opening for spectators.
-- If public.nexamon_bonus_recompute(uuid) exists (card account bonuses), it runs for both players after the transfer.
-- Errors: nexamon_locked, invalid_argument, nexamon_unknown, nexamon_battle_*, insufficient_funds, rate_limited.
-- Idempotent: runs unchanged as supabase/updates/20261204006320_nexamon_battles.sql.

create or replace function public.nexamon_battle_busy(p_player uuid, p_now timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.nexamon_battles b
                  where p_player in (b.challenger_id, b.opponent_id)
                    and ((b.status = 'pending' and b.expires_at > p_now) or (b.status = 'accepted' and b.ends_at > p_now)));
$$;

create or replace function public.nexamon_battles_last_hour(p_player uuid, p_now timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.nexamon_battles b
   where p_player in (b.challenger_id, b.opponent_id) and b.status = 'accepted' and b.accepted_at > p_now - interval '1 hour';
$$;

create or replace function public.nexamon_rarity_rank(p_rarity text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_position(array['common', 'rare', 'ultra', 'prisma', 'legendary'], p_rarity), 0) - 1;
$$;

-- Who wins (decideBattle): the higher total value, then the rarest single card, then the coin (even seed: challenger)
create or replace function public.nexamon_battle_decide(p_challenger jsonb, p_opponent jsonb, p_seed bigint)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_csum  bigint;
  v_osum  bigint;
  v_crank integer;
  v_orank integer;
begin
  select coalesce(sum((x ->> 'value_cents')::bigint), 0), coalesce(max(public.nexamon_rarity_rank(x ->> 'rarity')), -1)
    into v_csum, v_crank from jsonb_array_elements(coalesce(p_challenger, '[]'::jsonb)) x;
  select coalesce(sum((x ->> 'value_cents')::bigint), 0), coalesce(max(public.nexamon_rarity_rank(x ->> 'rarity')), -1)
    into v_osum, v_orank from jsonb_array_elements(coalesce(p_opponent, '[]'::jsonb)) x;
  return jsonb_build_object(
    'challenger_cents', v_csum, 'opponent_cents', v_osum,
    'tie_break', case when v_csum <> v_osum then 'value' when v_crank <> v_orank then 'rarest' else 'coin' end,
    'winner', case when v_csum <> v_osum then case when v_csum > v_osum then 'challenger' else 'opponent' end
                   when v_crank <> v_orank then case when v_crank > v_orank then 'challenger' else 'opponent' end
                   when abs(coalesce(p_seed, 0)) % 2 = 0 then 'challenger' else 'opponent' end);
end;
$$;

create or replace function public.challenge_nexamon_battle(p_request_id uuid, p_nickname text, p_set text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_other  uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_price  bigint;
  v_last   timestamptz;
  b        public.nexamon_battles;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_nickname is null or p_set is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'challenge_nexamon_battle');
  if v_replay is not null then
    return v_replay;
  end if;
  v_price := (cfg #>> array['sets', p_set, 'packPriceCents'])::bigint;
  if v_price is null or v_price < 0 or not exists (select 1 from public.nexamon_cards k where k.set_key = p_set and k.in_catalogue) then
    perform public.api_error('nexamon_unknown');
  end if;
  select p.id into v_other from public.profiles p where lower(p.nickname) = lower(p_nickname) and not p.is_deactivated;
  if v_other is null then
    perform public.api_error('nexamon_battle_unknown');
  end if;
  if v_other = v_player then
    perform public.api_error('nexamon_battle_self');
  end if;
  if not exists (select 1 from public.friendships f
                  where f.status = 'accepted'
                    and ((f.requester_id = v_player and f.addressee_id = v_other) or (f.requester_id = v_other and f.addressee_id = v_player))) then
    perform public.api_error('nexamon_battle_not_friend');
  end if;
  if not public.nexamon_unlocked(v_other) then
    perform public.api_error('nexamon_battle_opponent_locked');
  end if;
  if not public.nexamon_on_tab(v_other, v_now) then
    perform public.api_error('nexamon_battle_not_here');
  end if;
  -- one battle at a time: the two players' rows are locked in a fixed order
  perform 1 from public.profiles p where p.id in (v_player, v_other) order by p.id for update;
  update public.nexamon_battles set status = 'expired', responded_at = expires_at
   where status = 'pending' and expires_at <= v_now and (challenger_id in (v_player, v_other) or opponent_id in (v_player, v_other));
  if public.nexamon_battle_busy(v_player, v_now) or public.nexamon_battle_busy(v_other, v_now) then
    perform public.api_error('nexamon_battle_busy');
  end if;
  select max(x.created_at) into v_last from public.nexamon_battles x where x.challenger_id = v_player;
  if v_last is not null and v_last > v_now - make_interval(secs => coalesce((cfg #>> '{battles,cooldownSeconds}')::integer, 20)) then
    perform public.api_error('nexamon_battle_cooldown');
  end if;
  if public.nexamon_battles_last_hour(v_player, v_now) >= coalesce((cfg #>> '{battles,perHour}')::integer, 6)
     or public.nexamon_battles_last_hour(v_other, v_now) >= coalesce((cfg #>> '{battles,perHour}')::integer, 6) then
    perform public.api_error('nexamon_battle_limit');
  end if;
  if public.lock_player_accounts(v_player) < v_price then
    perform public.api_error('insufficient_funds');
  end if;
  insert into public.nexamon_battles (challenger_id, opponent_id, set_key, price_cents, created_at, expires_at)
  values (v_player, v_other, p_set, v_price, v_now,
          v_now + make_interval(secs => coalesce((cfg #>> '{battles,challengeSeconds}')::integer, 60)))
  returning * into b;
  perform public.social_notify(v_other, 'nexamon_battle', 'Pack Battle!',
    (select p.nickname from public.profiles p where p.id = v_player) || ' fordert dich zum Pack Battle heraus: '
      || coalesce(cfg #>> array['sets', p_set, 'name'], p_set) || ', je ein Pack für ' || public.format_eur(v_price) || '.',
    jsonb_build_object('battle_id', b.id, 'set', p_set, 'price_cents', v_price),
    '/nexamon?battle=' || b.id::text, 'nexamon:battle:challenge:' || b.id::text);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
end;
$$;
comment on function public.challenge_nexamon_battle(uuid, text, text) is
  'RPC (ADR-172): challenges a friend who is on the Collectibles tab to a Pack Battle with one pack of a set; returns '
  '{battle}. Errors nexamon_locked, invalid_argument, nexamon_unknown, nexamon_battle_unknown, nexamon_battle_self, '
  'nexamon_battle_not_friend, nexamon_battle_opponent_locked, nexamon_battle_not_here, nexamon_battle_busy, '
  'nexamon_battle_cooldown, nexamon_battle_limit, insufficient_funds.';

-- One side of an accepted battle: pays the pack and opens it in the player's name (is_new, feed, missions)
create or replace function public.nexamon_battle_pull(b public.nexamon_battles, p_player uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.nexamon_cfg();
  v_cards jsonb;
  r       record;
begin
  if b.price_cents > 0 then
    perform public.ledger_transfer(public.ledger_player_account(p_player, 'player_cash'), public.ledger_system_account('households'),
                                   b.price_cents, 'nexamon_pack', 'Pack Battle: ' || coalesce(cfg #>> array['sets', b.set_key, 'name'], b.set_key),
                                   'nexamon_battle', b.id, 'nexamon:battle:' || b.id::text || ':' || p_player::text, p_player,
                                   jsonb_build_object('set', b.set_key, 'price_cents', b.price_cents, 'battle_id', b.id));
  end if;
  v_cards := public.nexamon_open_pack(b.set_key, p_player, null, b.id, p_now);
  perform public.mission_event(p_player, 'nexamon_pack', 1, null);
  for r in select x ->> 'rarity' as rarity from jsonb_array_elements(v_cards) x loop
    if r.rarity <> 'common' then
      perform public.mission_event(p_player, 'nexamon_rare', 1, null);
    end if;
    if r.rarity in ('ultra', 'prisma', 'legendary') then
      perform public.mission_event(p_player, 'nexamon_ultra', 1, null);
    end if;
  end loop;
  return v_cards;
end;
$$;

create or replace function public.respond_nexamon_battle(p_request_id uuid, p_battle_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  b        public.nexamon_battles;
  v_ccash  bigint;
  v_ocash  bigint;
  v_ca     jsonb;
  v_oa     jsonb;
  v_csum   bigint;
  v_osum   bigint;
  v_seed   bigint;
  v_dec    jsonb;
  v_win    uuid;
  v_lose   uuid;
  v_tie    text;
  v_names  text;
  v_starts timestamptz;
  v_decide timestamptz;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_battle_id is null or p_accept is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'respond_nexamon_battle');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into b from public.nexamon_battles x where x.id = p_battle_id for update;
  if b.id is null or v_player not in (b.challenger_id, b.opponent_id) then
    perform public.api_error('nexamon_battle_unknown');
  end if;
  if v_player <> b.opponent_id then
    perform public.api_error('nexamon_battle_not_yours');
  end if;
  if b.status = 'pending' and b.expires_at <= v_now then
    update public.nexamon_battles set status = 'expired', responded_at = expires_at where id = b.id returning * into b;
    return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
  end if;
  if b.status <> 'pending' then
    perform public.api_error('nexamon_battle_closed');
  end if;

  if not p_accept then
    update public.nexamon_battles set status = 'declined', responded_at = v_now where id = b.id returning * into b;
    perform public.social_notify(b.challenger_id, 'nexamon_battle', 'Pack Battle abgelehnt',
      (select p.nickname from public.profiles p where p.id = b.opponent_id) || ' will gerade nicht battlen.',
      jsonb_build_object('battle_id', b.id), '/nexamon', 'nexamon:battle:declined:' || b.id::text);
    return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
  end if;

  if public.nexamon_battles_last_hour(v_player, v_now) >= coalesce((cfg #>> '{battles,perHour}')::integer, 6)
     or public.nexamon_battles_last_hour(b.challenger_id, v_now) >= coalesce((cfg #>> '{battles,perHour}')::integer, 6) then
    perform public.api_error('nexamon_battle_limit');
  end if;
  perform public.nexamon_sync(v_now);
  -- both accounts in a fixed order
  if b.challenger_id < b.opponent_id then
    v_ccash := public.lock_player_accounts(b.challenger_id);
    v_ocash := public.lock_player_accounts(b.opponent_id);
  else
    v_ocash := public.lock_player_accounts(b.opponent_id);
    v_ccash := public.lock_player_accounts(b.challenger_id);
  end if;
  if v_ocash < b.price_cents then
    perform public.api_error('insufficient_funds');
  end if;
  if v_ccash < b.price_cents or not public.nexamon_unlocked(b.challenger_id) then
    -- the challenger cannot pay any more: nobody pays, nothing is pulled
    update public.nexamon_battles
       set status = 'aborted', responded_at = v_now,
           abort_reason = case when v_ccash < b.price_cents then 'challenger_funds' else 'challenger_locked' end
     where id = b.id returning * into b;
    perform public.social_notify(b.challenger_id, 'nexamon_battle', 'Pack Battle abgebrochen',
      'Für das Pack Battle hat dein Geld nicht mehr gereicht. Niemand hat bezahlt.',
      jsonb_build_object('battle_id', b.id), '/nexamon', 'nexamon:battle:aborted:' || b.id::text);
    return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
  end if;

  v_ca := public.nexamon_battle_pull(b, b.challenger_id, v_now);
  v_oa := public.nexamon_battle_pull(b, b.opponent_id, v_now);
  update public.nexamon_set_state set player_packs_opened = player_packs_opened + 2 where set_key = b.set_key;
  v_seed := floor(random() * 2147483647)::bigint;
  v_dec := public.nexamon_battle_decide(v_ca, v_oa, v_seed);
  v_csum := (v_dec ->> 'challenger_cents')::bigint;
  v_osum := (v_dec ->> 'opponent_cents')::bigint;
  v_tie := v_dec ->> 'tie_break';
  v_win := case when v_dec ->> 'winner' = 'challenger' then b.challenger_id else b.opponent_id end;
  v_lose := case when v_win = b.challenger_id then b.opponent_id else b.challenger_id end;
  -- the winner takes every copy of both packs; listings cannot exist yet
  update public.nexamon_copies c set owner_id = v_win, acquired_at = v_now
   where c.id in (select (x ->> 'copy_id')::uuid from jsonb_array_elements(v_ca || v_oa) x) and c.owner_id = v_lose;
  if to_regprocedure('public.nexamon_bonus_recompute(uuid)') is not null then
    execute 'select public.nexamon_bonus_recompute($1)' using v_win;
    execute 'select public.nexamon_bonus_recompute($1)' using v_lose;
  end if;

  v_starts := v_now + public.nexamon_ms(coalesce((cfg #>> '{battles,startDelayMs}')::numeric, 3000));
  v_decide := v_starts + public.nexamon_ms(coalesce((cfg #>> '{battles,tearMs}')::numeric, 2400)
                                           + coalesce((cfg ->> 'packSize')::numeric, 5) * coalesce((cfg #>> '{battles,slotMs}')::numeric, 1800));
  update public.nexamon_battles
     set status = 'accepted', responded_at = v_now, accepted_at = v_now, starts_at = v_starts, decide_at = v_decide,
         ends_at = v_decide + public.nexamon_ms(coalesce((cfg #>> '{battles,outroMs}')::numeric, 8000)),
         challenger_cards = v_ca, opponent_cards = v_oa, challenger_cents = v_csum, opponent_cents = v_osum,
         winner_id = v_win, tie_break = v_tie, coin_seed = v_seed
   where id = b.id returning * into b;
  insert into public.nexamon_live (player_id, kind, battle_id, set_key, started_at, ends_at)
  values (b.challenger_id, 'battle', b.id, b.set_key, v_now, b.ends_at)
  on conflict (battle_id) do nothing;

  v_names := (select p.nickname from public.profiles p where p.id = b.challenger_id) || ' gegen '
             || (select p.nickname from public.profiles p where p.id = b.opponent_id);
  perform public.feed_post(v_win, 'nexamon_battle_won',
                           jsonb_build_object('set', b.set_key, 'other', (select p.nickname from public.profiles p where p.id = v_lose),
                                              'total_cents', v_csum + v_osum, 'cards', jsonb_array_length(v_ca) + jsonb_array_length(v_oa)),
                           'nexamon:battle:won:' || b.id::text);
  if v_csum + v_osum >= coalesce((cfg #>> '{battles,gossipMinCents}')::bigint, 500000) then
    perform public.feed_post(v_win, 'nexamon_battle_big',
                             jsonb_build_object('set', b.set_key, 'other', (select p.nickname from public.profiles p where p.id = v_lose),
                                                'total_cents', v_csum + v_osum),
                             'nexamon:battle:big:' || b.id::text);
  end if;
  perform public.social_notify(b.challenger_id, 'nexamon_battle', 'Pack Battle läuft', v_names || ': die Packs gehen auf!',
    jsonb_build_object('battle_id', b.id), '/nexamon?battle=' || b.id::text, 'nexamon:battle:accepted:' || b.id::text);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
end;
$$;
comment on function public.respond_nexamon_battle(uuid, uuid, boolean) is
  'RPC (ADR-172): the challenged friend accepts (both pay one pack, both packs open at once, the higher total value '
  'takes all copies) or declines a Pack Battle; returns {battle} (pulls only from the shared start). A challenger '
  'without the money any more ends it as aborted, nobody pays. Errors nexamon_locked, invalid_argument, '
  'nexamon_battle_unknown, nexamon_battle_not_yours, nexamon_battle_closed, nexamon_battle_limit, insufficient_funds.';

create or replace function public.cancel_nexamon_battle(p_request_id uuid, p_battle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  b        public.nexamon_battles;
begin
  v_player := public.require_player();
  if p_request_id is null or p_battle_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'cancel_nexamon_battle');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into b from public.nexamon_battles x where x.id = p_battle_id for update;
  if b.id is null or v_player not in (b.challenger_id, b.opponent_id) then
    perform public.api_error('nexamon_battle_unknown');
  end if;
  if v_player <> b.challenger_id then
    perform public.api_error('nexamon_battle_not_yours');
  end if;
  if b.status <> 'pending' then
    perform public.api_error('nexamon_battle_closed');
  end if;
  update public.nexamon_battles set status = case when expires_at <= v_now then 'expired' else 'cancelled' end, responded_at = v_now
   where id = b.id returning * into b;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
end;
$$;
comment on function public.cancel_nexamon_battle(uuid, uuid) is
  'RPC (ADR-172): the challenger takes an open Pack Battle challenge back; returns {battle}. Errors invalid_argument, '
  'nexamon_battle_unknown, nexamon_battle_not_yours, nexamon_battle_closed.';

create or replace function public.get_nexamon_battle(p_battle_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_now    timestamptz := public.game_now();
  b        public.nexamon_battles;
  l        public.nexamon_live;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  select * into b from public.nexamon_battles x where x.id = p_battle_id;
  if b.id is null then
    perform public.api_error('nexamon_battle_unknown');
  end if;
  if v_player not in (b.challenger_id, b.opponent_id) then
    -- spectators: only a battle that is (or was) live
    select * into l from public.nexamon_live x where x.battle_id = b.id;
    if l.id is null then
      perform public.api_error('nexamon_battle_unknown');
    end if;
    if l.ends_at > v_now then
      insert into public.nexamon_live_viewers (live_id, player_id, seen_at) values (l.id, v_player, v_now)
      on conflict (live_id, player_id) do update set seen_at = excluded.seen_at;
    end if;
  end if;
  return jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now));
end;
$$;
comment on function public.get_nexamon_battle(uuid) is
  'RPC (ADR-172): a Pack Battle for its players and spectators (counted as viewers): the pulls slot by slot from the '
  'shared start, totals, the winner from decide_at; returns {battle}. Errors nexamon_locked, nexamon_battle_unknown.';

do $do$
declare
  f text;
begin
  foreach f in array array['public.challenge_nexamon_battle(uuid, text, text)', 'public.respond_nexamon_battle(uuid, uuid, boolean)',
                           'public.cancel_nexamon_battle(uuid, uuid)', 'public.get_nexamon_battle(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.nexamon_battle_busy(uuid, timestamptz)', 'public.nexamon_battles_last_hour(uuid, timestamptz)',
                           'public.nexamon_battle_pull(public.nexamon_battles, uuid, timestamptz)',
                           'public.nexamon_rarity_rank(text)', 'public.nexamon_battle_decide(jsonb, jsonb, bigint)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$do$;
