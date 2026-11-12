-- =============================================================================
-- NEXA · M4c · 0200 · Friends (ADR-084)
-- =============================================================================
-- RPCs on the existing table public.friendships (one row per unordered pair):
--   get_friends()                                     -> FRIENDS
--   send_friend_request(request_id, nickname)         -> FRIENDS (a counter request accepts at once)
--   respond_friend_request(request_id, nickname, accept) -> FRIENDS (decline deletes the request)
--   remove_friend(request_id, nickname)               -> FRIENDS (friendship or own open request)
-- FRIENDS = {friends: [{nickname, level, since}], incoming: [{nickname, level, at}], outgoing: [{nickname, level, at}]}
-- Errors: player_not_found (unknown nickname), invalid_argument (self, no open request, bad input), rate_limited.
-- In-app notifications: friend_request (to the addressee), friend_accepted (to the requester).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Notification type for an accepted request
-- ---------------------------------------------------------------------------
insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('friend_accepted', 'social', 'Freundschaft angenommen', 'Jemand hat deine Freundschaftsanfrage angenommen.',
        'notif_friend', true, false, false, 275)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Helpers
-- ---------------------------------------------------------------------------
-- FRIENDS from the point of view of p_player (deactivated players are left out)
create or replace function public.friends_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'level', p.level,
                                          'since', coalesce(f.responded_at, f.updated_at)) order by lower(p.nickname), p.id)
        from public.friendships f
        join public.profiles p on p.id = case when f.requester_id = p_player then f.addressee_id else f.requester_id end
       where f.status = 'accepted' and p_player in (f.requester_id, f.addressee_id) and not p.is_deactivated), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'level', p.level, 'at', f.updated_at)
                       order by f.updated_at desc, p.id)
        from public.friendships f join public.profiles p on p.id = f.requester_id
       where f.status = 'pending' and f.addressee_id = p_player and not p.is_deactivated), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'level', p.level, 'at', f.updated_at)
                       order by f.updated_at desc, p.id)
        from public.friendships f join public.profiles p on p.id = f.addressee_id
       where f.status = 'pending' and f.requester_id = p_player and not p.is_deactivated), '[]'::jsonb));
$$;
comment on function public.friends_json(uuid) is
  'FRIENDS of a player (ADR-084): friends by nickname, incoming and outgoing open requests newest first.';

-- The other player of a friends RPC: active, found by nickname (case-insensitive, as get_player_card)
create or replace function public.friend_target(p_player uuid, p_nickname text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_nickname is null or char_length(btrim(p_nickname)) = 0 or char_length(p_nickname) > 64 then
    perform public.api_error('invalid_argument');
  end if;
  select x.id into v_id from public.profiles x where lower(x.nickname) = lower(btrim(p_nickname)) and not x.is_deactivated;
  if v_id is null then
    perform public.api_error('player_not_found');
  end if;
  if v_id = p_player then
    perform public.api_error('invalid_argument');
  end if;
  return v_id;
end;
$$;

-- In-app notification, unless the player switched the type off (missing preference: the type's default)
create or replace function public.friend_notify(p_player uuid, p_type text, p_title text, p_from_nickname text, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.notification_types t where t.key = p_type) then
    return;
  end if;
  if not coalesce((select np.in_app_enabled from public.notification_preferences np
                    where np.player_id = p_player and np.type_key = p_type),
                  (select t.default_in_app from public.notification_types t where t.key = p_type), true) then
    return;
  end if;
  insert into public.notifications (player_id, type_key, title, body, payload, link, dedupe_key)
  values (p_player, p_type, p_title, p_from_nickname, jsonb_build_object('nickname', p_from_nickname),
          '/players/' || p_from_nickname, p_dedupe)
  on conflict (player_id, dedupe_key) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_friends()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.friends_json(public.require_player());
end;
$$;
comment on function public.get_friends() is 'RPC: FRIENDS of the caller (ADR-084).';

-- A request; if the other player already asked me, this accepts it. Friends or an open own request: nothing happens.
-- A declined row may be requested again.
create or replace function public.send_friend_request(p_request_id uuid, p_nickname text)
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
  v_nick   text;
  f        public.friendships;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'send_friend_request');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  v_other := public.friend_target(v_player, p_nickname);
  -- both players in a fixed order: one pair, one writer at a time
  perform 1 from public.profiles p where p.id in (v_player, v_other) order by p.id for update;
  select p.nickname into v_me from public.profiles p where p.id = v_player;
  select p.nickname into v_nick from public.profiles p where p.id = v_other;
  select * into f from public.friendships x
   where least(x.requester_id, x.addressee_id) = least(v_player, v_other)
     and greatest(x.requester_id, x.addressee_id) = greatest(v_player, v_other);
  if f.id is null then
    insert into public.friendships (requester_id, addressee_id, status, request_id)
    values (v_player, v_other, 'pending', p_request_id);
    perform public.friend_notify(v_other, 'friend_request', v_me || ' möchte mit dir befreundet sein.', v_me,
                                 'friend_request:' || p_request_id::text);
  elsif f.status = 'pending' and f.requester_id = v_other then
    -- counter request: friends at once
    update public.friendships set status = 'accepted', responded_at = now(), updated_at = now() where id = f.id;
    perform public.friend_notify(v_other, 'friend_accepted', v_me || ' hat deine Freundschaftsanfrage angenommen.', v_me,
                                 'friend_accepted:' || p_request_id::text);
  elsif f.status = 'declined' then
    update public.friendships
       set requester_id = v_player, addressee_id = v_other, status = 'pending', request_id = p_request_id,
           responded_at = null, created_at = now(), updated_at = now()
     where id = f.id;
    perform public.friend_notify(v_other, 'friend_request', v_me || ' möchte mit dir befreundet sein.', v_me,
                                 'friend_request:' || p_request_id::text);
  end if;
  -- accepted, own open request or blocked: nothing to do
  return public.request_complete(v_player, p_request_id, public.friends_json(v_player));
end;
$$;
comment on function public.send_friend_request(uuid, text) is
  'RPC: friend request to a player by nickname (ADR-084); a counter request accepts. Errors player_not_found, invalid_argument.';

-- Only the addressee of an open request; declining deletes it
create or replace function public.respond_friend_request(p_request_id uuid, p_nickname text, p_accept boolean)
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
  f        public.friendships;
begin
  v_player := public.require_player();
  if p_request_id is null or p_accept is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'respond_friend_request');
  if v_replay is not null then
    return v_replay;
  end if;
  v_other := public.friend_target(v_player, p_nickname);
  perform 1 from public.profiles p where p.id in (v_player, v_other) order by p.id for update;
  select * into f from public.friendships x
   where x.requester_id = v_other and x.addressee_id = v_player and x.status = 'pending';
  if f.id is null then
    perform public.api_error('invalid_argument');
  end if;
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now(), updated_at = now() where id = f.id;
    select p.nickname into v_me from public.profiles p where p.id = v_player;
    perform public.friend_notify(v_other, 'friend_accepted', v_me || ' hat deine Freundschaftsanfrage angenommen.', v_me,
                                 'friend_accepted:' || p_request_id::text);
  else
    delete from public.friendships where id = f.id;
  end if;
  return public.request_complete(v_player, p_request_id, public.friends_json(v_player));
end;
$$;
comment on function public.respond_friend_request(uuid, text, boolean) is
  'RPC: accept or decline (deletes) an open friend request from a player (ADR-084). Errors player_not_found, invalid_argument.';

-- Ends a friendship or withdraws the own open request; anything else: nothing happens
create or replace function public.remove_friend(p_request_id uuid, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_other  uuid;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'remove_friend');
  if v_replay is not null then
    return v_replay;
  end if;
  v_other := public.friend_target(v_player, p_nickname);
  perform 1 from public.profiles p where p.id in (v_player, v_other) order by p.id for update;
  delete from public.friendships x
   where least(x.requester_id, x.addressee_id) = least(v_player, v_other)
     and greatest(x.requester_id, x.addressee_id) = greatest(v_player, v_other)
     and (x.status = 'accepted' or (x.status = 'pending' and x.requester_id = v_player));
  return public.request_complete(v_player, p_request_id, public.friends_json(v_player));
end;
$$;
comment on function public.remove_friend(uuid, text) is
  'RPC: ends a friendship or withdraws the own open friend request (ADR-084). Error player_not_found.';

-- ---------------------------------------------------------------------------
-- D. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.friends_json(uuid)', 'public.friend_target(uuid, text)', 'public.friend_notify(uuid, text, text, text, text)',
    'public.get_friends()', 'public.send_friend_request(uuid, text)', 'public.respond_friend_request(uuid, text, boolean)',
    'public.remove_friend(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_friends()', 'public.send_friend_request(uuid, text)', 'public.respond_friend_request(uuid, text, boolean)',
    'public.remove_friend(uuid, text)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
