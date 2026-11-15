-- =============================================================================
-- NEXA · 2800 · Accessories for the pixel figure, the friends plaza, poking friends (ADR-154)
-- =============================================================================
-- * Accessories: catalogue in game_config.accessories (src/config/accessories.ts: key, name, slot, rarity,
--   priceCents, minLevel). A player buys each one once (money to the households, like furniture) and wears at most
--   one per slot. Tables player_accessories (owned) and player_accessories_worn (one row per slot); both internal.
--   RPCs get_accessories(), buy_accessory(request, key) (wears it right away), wear_accessory(request, key, wear).
--   A legendary purchase is news for the friends (feed kind accessory_bought).
-- * Others see it: get_player_card() and friends_json() return the worn keys ("accessories", back to front) and
--   friends_json() also each friend's avatar_key, so the friends plaza can draw the dressed figures.
-- * Poking: poke_friend(request, nickname) between accepted friends sends the notification friend_poke. The same
--   friend again after social.poke.cooldownMinutes (10), at most social.poke.dailyCap (30) pokes in 24 hours.
-- * Errors: accessory_unknown NX130, accessory_locked NX131, accessory_owned NX132, accessory_not_owned NX133,
--   not_friends NX134, poke_too_soon NX135, poke_daily_limit NX136.
-- Idempotent: runs unchanged as supabase/updates/20261204002800_accessories_pokes.sql.

-- ---------------------------------------------------------------------------
-- A. Error keys
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''poke_daily_limit''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'no_shares_left'             then 'NX129'
$q$, $q$    when 'no_shares_left'             then 'NX129'
    when 'accessory_unknown'          then 'NX130'
    when 'accessory_locked'           then 'NX131'
    when 'accessory_owned'            then 'NX132'
    when 'accessory_not_owned'        then 'NX133'
    when 'not_friends'                then 'NX134'
    when 'poke_too_soon'              then 'NX135'
    when 'poke_daily_limit'           then 'NX136'
$q$);
    if position('''poke_daily_limit''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the accessory and poke error keys by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- B. Notification type
-- ---------------------------------------------------------------------------
insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('friend_poke', 'social', 'Angestupst', 'Ein Freund hat dich angestupst.', 'notif_friend', true, false, false, 276)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- C. Tables (internal: read and written only by the RPCs below)
-- ---------------------------------------------------------------------------
create table if not exists public.player_accessories (
  player_id        uuid not null references public.profiles (id) on delete cascade,
  accessory_key    text not null check (char_length(accessory_key) between 1 and 64),
  price_paid_cents bigint not null check (price_paid_cents >= 0),
  bought_at        timestamptz not null default now(),
  primary key (player_id, accessory_key)
);
alter table public.player_accessories enable row level security;
revoke all on public.player_accessories from public, anon, authenticated;
grant all on public.player_accessories to service_role;
comment on table public.player_accessories is
  'Accessories a player bought (ADR-154), each once. Internal (RPCs get_accessories, buy_accessory).';

create table if not exists public.player_accessories_worn (
  player_id     uuid not null,
  slot          text not null check (slot in ('back', 'body', 'face', 'head', 'hand', 'pet')),
  accessory_key text not null,
  worn_at       timestamptz not null default now(),
  primary key (player_id, slot),
  foreign key (player_id, accessory_key) references public.player_accessories (player_id, accessory_key) on delete cascade
);
create index if not exists player_accessories_worn_key_idx on public.player_accessories_worn (player_id, accessory_key);
alter table public.player_accessories_worn enable row level security;
revoke all on public.player_accessories_worn from public, anon, authenticated;
grant all on public.player_accessories_worn to service_role;
comment on table public.player_accessories_worn is
  'The accessory a player wears per slot (ADR-154): only owned ones, one per slot. Internal (RPC wear_accessory).';

create table if not exists public.friend_pokes (
  id         bigint generated always as identity primary key,
  poker_id   uuid not null references public.profiles (id) on delete cascade,
  target_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists friend_pokes_poker_idx on public.friend_pokes (poker_id, created_at desc);
create index if not exists friend_pokes_target_idx on public.friend_pokes (target_id);
alter table public.friend_pokes enable row level security;
revoke all on public.friend_pokes from public, anon, authenticated;
grant all on public.friend_pokes to service_role;
comment on table public.friend_pokes is
  'Pokes between friends (ADR-154), for the pause per friend and the daily cap; older than two days is deleted. Internal.';

-- ---------------------------------------------------------------------------
-- D. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.accessories_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'accessories'), '{}'::jsonb);
$$;

-- One catalogue entry by key; null if unknown
create or replace function public.accessory_item(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select x from jsonb_array_elements(coalesce(public.accessories_cfg() -> 'items', '[]'::jsonb)) x
   where x ->> 'key' = p_key
   limit 1;
$$;

-- Worn keys of a player, back to front (the order of accessories.slots)
create or replace function public.player_worn_accessories(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(w.accessory_key order by coalesce(s.ord, 99), w.slot), '[]'::jsonb)
    from public.player_accessories_worn w
    left join lateral (select x.ord from jsonb_array_elements_text(coalesce(public.accessories_cfg() -> 'slots', '[]'::jsonb))
                                          with ordinality as x(slot, ord)
                        where x.slot = w.slot) s on true
   where w.player_id = p_player;
$$;

-- The wardrobe of a player: owned keys (oldest first), worn keys, the portrait
create or replace function public.accessories_state(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'owned', coalesce((select jsonb_agg(a.accessory_key order by a.bought_at, a.accessory_key)
                         from public.player_accessories a where a.player_id = p_player), '[]'::jsonb),
    'worn', public.player_worn_accessories(p_player),
    'avatar_key', (select p.avatar_key from public.profiles p where p.id = p_player));
$$;

-- ---------------------------------------------------------------------------
-- E. RPCs: accessories
-- ---------------------------------------------------------------------------
create or replace function public.get_accessories()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.accessories_state(public.require_player());
end;
$$;
comment on function public.get_accessories() is 'RPC: the own wardrobe (ADR-154): owned and worn accessories.';

create or replace function public.buy_accessory(p_request_id uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_item   jsonb;
  v_price  bigint;
  v_cash   bigint;
begin
  v_player := public.require_player();
  if p_request_id is null or p_key is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_accessory');
  if v_replay is not null then
    return v_replay;
  end if;
  v_item := public.accessory_item(p_key);
  if v_item is null then
    perform public.api_error('accessory_unknown');
  end if;
  if coalesce((select p.level from public.profiles p where p.id = v_player), 1) < coalesce((v_item ->> 'minLevel')::integer, 1) then
    perform public.api_error('accessory_locked');
  end if;
  v_price := (v_item ->> 'priceCents')::bigint;
  if v_price is null or v_price < 0 then
    perform public.api_error('accessory_unknown');
  end if;
  v_cash := public.lock_player_accounts(v_player);
  if exists (select 1 from public.player_accessories a where a.player_id = v_player and a.accessory_key = p_key) then
    perform public.api_error('accessory_owned');
  end if;
  if v_cash < v_price then
    perform public.api_error('insufficient_funds');
  end if;
  if v_price > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('households'),
                                   v_price, 'lifestyle_purchase', 'Accessoire gekauft: ' || coalesce(v_item ->> 'name', p_key),
                                   'accessory', null, 'accessory:' || v_player::text || ':' || p_request_id::text, v_player,
                                   jsonb_build_object('accessory_key', p_key, 'price_cents', v_price));
  end if;
  insert into public.player_accessories (player_id, accessory_key, price_paid_cents) values (v_player, p_key, v_price);
  -- bought to be worn: it goes on right away (replacing what was in the slot)
  insert into public.player_accessories_worn (player_id, slot, accessory_key)
  values (v_player, v_item ->> 'slot', p_key)
  on conflict (player_id, slot) do update set accessory_key = excluded.accessory_key, worn_at = now();
  if coalesce(public.accessories_cfg() -> 'feedRarities', '[]'::jsonb) ? (v_item ->> 'rarity') then
    perform public.feed_post(v_player, 'accessory_bought',
                             jsonb_build_object('key', p_key, 'name', v_item ->> 'name', 'rarity', v_item ->> 'rarity',
                                                'price_cents', v_price),
                             'accessory:' || v_player::text || ':' || p_key);
  end if;
  return public.request_complete(v_player, p_request_id,
    public.accessories_state(v_player) || jsonb_build_object('paid_cents', v_price));
end;
$$;
comment on function public.buy_accessory(uuid, text) is
  'RPC: buys an accessory once (money to the households) and wears it (ADR-154); errors invalid_argument, '
  'accessory_unknown, accessory_locked, accessory_owned, insufficient_funds.';

create or replace function public.wear_accessory(p_request_id uuid, p_key text, p_wear boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_item   jsonb;
begin
  v_player := public.require_player();
  if p_request_id is null or p_key is null or p_wear is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'wear_accessory');
  if v_replay is not null then
    return v_replay;
  end if;
  v_item := public.accessory_item(p_key);
  if v_item is null then
    perform public.api_error('accessory_unknown');
  end if;
  if not exists (select 1 from public.player_accessories a where a.player_id = v_player and a.accessory_key = p_key) then
    perform public.api_error('accessory_not_owned');
  end if;
  if p_wear then
    insert into public.player_accessories_worn (player_id, slot, accessory_key)
    values (v_player, v_item ->> 'slot', p_key)
    on conflict (player_id, slot) do update set accessory_key = excluded.accessory_key, worn_at = now();
  else
    delete from public.player_accessories_worn w where w.player_id = v_player and w.accessory_key = p_key;
  end if;
  return public.request_complete(v_player, p_request_id, public.accessories_state(v_player));
end;
$$;
comment on function public.wear_accessory(uuid, text, boolean) is
  'RPC: puts an owned accessory on (replacing the one in its slot) or takes it off (ADR-154); errors invalid_argument, '
  'accessory_unknown, accessory_not_owned.';

-- ---------------------------------------------------------------------------
-- F. RPC: poke a friend
-- ---------------------------------------------------------------------------
create or replace function public.poke_friend(p_request_id uuid, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_other  uuid;
  v_me     text;
  v_them   text;
  v_cool   integer := greatest(0, coalesce(public.config_double('social', '{poke,cooldownMinutes}', 10), 10)::integer);
  v_cap    integer := greatest(1, coalesce(public.config_double('social', '{poke,dailyCap}', 30), 30)::integer);
  v_last   timestamptz;
  v_count  integer;
  v_id     bigint;
  v_lines  text[] := array[
    'Stups zurück, bevor es peinlich wird.',
    'Das war ein freundschaftlicher Stups. Vermutlich.',
    'Schau mal vorbei, dein Depot vermisst dich.',
    'Pssst! Jemand denkt an dich.',
    'Stups! Du bist dran.'];
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'poke_friend');
  if v_replay is not null then
    return v_replay;
  end if;
  v_other := public.friend_target(v_player, p_nickname);
  if not exists (select 1 from public.friendships f
                  where f.status = 'accepted'
                    and least(f.requester_id, f.addressee_id) = least(v_player, v_other)
                    and greatest(f.requester_id, f.addressee_id) = greatest(v_player, v_other)) then
    perform public.api_error('not_friends');
  end if;
  -- one poke of the same player at a time
  select p.nickname into v_me from public.profiles p where p.id = v_player for update;
  select p.nickname into v_them from public.profiles p where p.id = v_other;
  select max(x.created_at) into v_last from public.friend_pokes x where x.poker_id = v_player and x.target_id = v_other;
  if v_last is not null and v_last > now() - make_interval(mins => v_cool) then
    perform public.api_error('poke_too_soon');
  end if;
  select count(*) into v_count from public.friend_pokes x where x.poker_id = v_player and x.created_at > now() - interval '24 hours';
  if v_count >= v_cap then
    perform public.api_error('poke_daily_limit');
  end if;
  insert into public.friend_pokes (poker_id, target_id) values (v_player, v_other) returning id into v_id;
  delete from public.friend_pokes x where x.poker_id = v_player and x.created_at < now() - interval '2 days';
  perform public.social_notify(v_other, 'friend_poke', v_me || ' hat dich angestupst! 👉',
                               v_lines[1 + floor(random() * array_length(v_lines, 1))::integer],
                               jsonb_build_object('nickname', v_me), '/players/' || v_me, 'poke:' || v_id::text);
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'nickname', v_them,
    'poked_at', now(),
    'next_at', now() + make_interval(mins => v_cool),
    'left_today', greatest(0, v_cap - v_count - 1)));
end;
$$;
comment on function public.poke_friend(uuid, text) is
  'RPC: pokes a friend (ADR-154): notification friend_poke with a link to the own profile; errors invalid_argument, '
  'player_not_found, not_friends, poke_too_soon, poke_daily_limit.';

-- ---------------------------------------------------------------------------
-- G. Others see the figure: friends list and player card
-- ---------------------------------------------------------------------------
create or replace function public.friends_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'level', p.level,
                                          'since', coalesce(f.responded_at, f.updated_at),
                                          'online', coalesce(p.last_active_at > public.game_now() - make_interval(
                                                      mins => coalesce(public.config_double('social', '{onlineMinutes}', 10), 10)::integer), false),
                                          'last_active_at', p.last_active_at,
                                          'avatar_key', p.avatar_key,
                                          'accessories', public.player_worn_accessories(p.id))
                       order by coalesce(p.last_active_at > public.game_now() - make_interval(
                                  mins => coalesce(public.config_double('social', '{onlineMinutes}', 10), 10)::integer), false) desc,
                                lower(p.nickname), p.id)
        from public.friendships f
        join public.profiles p on p.id = case when f.requester_id = p_player then f.addressee_id else f.requester_id end
       where f.status = 'accepted' and p_player in (f.requester_id, f.addressee_id) and not p.is_deactivated), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'level', p.level, 'at', f.updated_at)
                       order by f.updated_at desc, p.id)
        from public.friendships f join public.profiles p on p.id = f.requester_id
       where f.status = 'pending' and f.addressee_id = p_player and not p.is_deactivated), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'level', p.level, 'at', f.updated_at)
                       order by f.updated_at desc, p.id)
        from public.friendships f join public.profiles p on p.id = f.addressee_id
       where f.status = 'pending' and f.requester_id = p_player and not p.is_deactivated), '[]'::jsonb));
$$;

do $do$
declare
  v_def text := pg_get_functiondef('public.get_player_card(text)'::regprocedure);
  v_old text := $t$    'trust',           public.player_trust(p.id));$t$;
  v_new text := $t$    'accessories',     public.player_worn_accessories(p.id),
    'trust',           public.player_trust(p.id));$t$;
begin
  if position('player_worn_accessories' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'get_player_card() has an unexpected shape; add the accessories by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- H. Account reset and deletion forget the wardrobe and the pokes; the feed names the purchase
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.account_wipe(uuid, text)'::regprocedure);
  v_old text := $t$('player_homes', 'player_id'), ('trust_events', 'player_id')$t$;
  v_new text := $t$('player_homes', 'player_id'), ('trust_events', 'player_id'),
             ('player_accessories_worn', 'player_id'), ('player_accessories', 'player_id'), ('friend_pokes', 'poker_id')$t$;
begin
  if position('player_accessories_worn' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'account_wipe() has an unexpected shape; add the accessory tables by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
  v_old text := $t$    when 'car_bought' then 'Neues Auto'$t$;
  v_new text := $t$    when 'car_bought' then 'Neues Auto'
    when 'accessory_bought' then coalesce(p_payload ->> 'name', 'Accessoire') || ' gekauft'$t$;
begin
  if position('accessory_bought' in v_def) = 0 and position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- I. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.accessories_cfg()', 'public.accessory_item(text)', 'public.player_worn_accessories(uuid)',
    'public.accessories_state(uuid)', 'public.get_accessories()', 'public.buy_accessory(uuid, text)',
    'public.wear_accessory(uuid, text, boolean)', 'public.poke_friend(uuid, text)', 'public.friends_json(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_accessories()', 'public.buy_accessory(uuid, text)', 'public.wear_accessory(uuid, text, boolean)',
    'public.poke_friend(uuid, text)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
