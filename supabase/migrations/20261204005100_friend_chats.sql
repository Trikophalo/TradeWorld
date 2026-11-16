-- =============================================================================
-- NEXA · 5100 · Chats with friends: direct chats and groups (ADR-164)
-- =============================================================================
-- * friend_chats (direct or group), friend_chat_members (admin flag, last read message, first visible message) and
--   friend_chat_messages (player or system lines). Internal tables: read and written only by the RPCs below.
-- * Direct chats only between accepted friends; when the friendship ends the chat stays readable but read-only.
-- * Groups: a name (social.chat.groupName*, profanity filter), social.chat.groupMinMembers to groupMaxMembers members
--   including the creator, who is the admin. Every member may add own friends; the admin removes members and renames.
--   Who leaves last closes the group; when the admin leaves, the longest member takes over.
-- * Messages: social.chat.maxMessageLength characters, social.chat.maxMessagesPerMinute, profanity filter.
-- * Notification friend_chat for the other members, at most one unread per chat (like the company chat).
-- * Missions: metric friend_chat (own trigger), quick and daily templates, mission_doable() needs a friend.
-- * Errors: chat_unknown NX157, chat_read_only NX158, chat_not_admin NX159, chat_group_full NX160,
--   chat_group_too_small NX161, chat_already_member NX162.
-- Idempotent: runs unchanged as supabase/updates/20261204005100_friend_chats.sql.

-- ---------------------------------------------------------------------------
-- A. Error keys, notification type
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''chat_already_member''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'battle_unknown'             then 'NX156'
$q$, $q$    when 'battle_unknown'             then 'NX156'
    when 'chat_unknown'               then 'NX157'
    when 'chat_read_only'             then 'NX158'
    when 'chat_not_admin'             then 'NX159'
    when 'chat_group_full'            then 'NX160'
    when 'chat_group_too_small'       then 'NX161'
    when 'chat_already_member'        then 'NX162'
$q$);
    if position('''chat_already_member''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the chat error keys by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('friend_chat', 'social', 'Chat mit Freunden', 'Ein Freund oder eine Gruppe hat dir geschrieben.',
        'notif_friend', true, true, false, 277)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Tables (internal)
-- ---------------------------------------------------------------------------
create table if not exists public.friend_chats (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('direct', 'group')),
  name            text check (name is null or char_length(name) between 1 and 64),
  -- direct chats: "<smaller uuid>:<bigger uuid>", one chat per pair
  direct_key      text unique,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check ((kind = 'direct') = (direct_key is not null)),
  check ((kind = 'group') = (name is not null))
);
create index if not exists friend_chats_created_by_idx on public.friend_chats (created_by, created_at desc);
alter table public.friend_chats enable row level security;
revoke all on public.friend_chats from public, anon, authenticated;
grant all on public.friend_chats to service_role;
comment on table public.friend_chats is
  'Chats between friends (ADR-164): direct (one per pair) or group with a name. Internal (RPCs get_chats, get_chat, ...).';

create table if not exists public.friend_chat_members (
  chat_id      bigint not null references public.friend_chats (id) on delete cascade,
  player_id    uuid not null references public.profiles (id) on delete cascade,
  is_admin     boolean not null default false,
  -- the newest message the member has seen; messages up to since_id stay hidden (added later to a group)
  last_read_id bigint not null default 0,
  since_id     bigint not null default 0,
  joined_at    timestamptz not null default now(),
  primary key (chat_id, player_id)
);
create index if not exists friend_chat_members_player_idx on public.friend_chat_members (player_id);
alter table public.friend_chat_members enable row level security;
revoke all on public.friend_chat_members from public, anon, authenticated;
grant all on public.friend_chat_members to service_role;
comment on table public.friend_chat_members is
  'Members of a friend chat (ADR-164) with admin flag and read marker. Internal.';

create table if not exists public.friend_chat_messages (
  id         bigint generated always as identity primary key,
  chat_id    bigint not null references public.friend_chats (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete cascade,
  kind       text not null default 'player' check (kind in ('player', 'system')),
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists friend_chat_messages_chat_idx on public.friend_chat_messages (chat_id, id desc);
create index if not exists friend_chat_messages_author_idx on public.friend_chat_messages (author_id, created_at desc);
alter table public.friend_chat_messages enable row level security;
revoke all on public.friend_chat_messages from public, anon, authenticated;
grant all on public.friend_chat_messages to service_role;
comment on table public.friend_chat_messages is
  'Messages of friend chats (ADR-164): player lines and system lines (joined, left, renamed). Internal.';

-- ---------------------------------------------------------------------------
-- C. Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public.friend_chat_is_friend(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.friendships f
                  where f.status = 'accepted'
                    and least(f.requester_id, f.addressee_id) = least(p_a, p_b)
                    and greatest(f.requester_id, f.addressee_id) = greatest(p_a, p_b));
$$;

create or replace function public.friend_chat_cfg(p_key text, p_default double precision)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, coalesce(public.config_double('social', array['chat', p_key], p_default), p_default))::integer;
$$;

-- unread player messages of one member (own lines and system lines do not count)
create or replace function public.friend_chat_unread(p_chat bigint, p_player uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.friend_chat_members cm
    join public.friend_chat_messages m on m.chat_id = cm.chat_id and m.id > greatest(cm.last_read_id, cm.since_id)
   where cm.chat_id = p_chat and cm.player_id = p_player and m.kind = 'player' and m.author_id is distinct from p_player;
$$;

create or replace function public.friend_chat_message_json(p_message bigint, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', m.id, 'kind', m.kind, 'author', p.nickname, 'avatar_key', p.avatar_key,
                            'is_me', m.author_id is not distinct from p_viewer and m.kind = 'player',
                            'body', m.body, 'created_at', m.created_at)
    from public.friend_chat_messages m left join public.profiles p on p.id = m.author_id
   where m.id = p_message;
$$;

-- the summary of a chat as one member sees it: the others, the last message, unread lines, rights
create or replace function public.friend_chat_json(p_chat bigint, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select cm.* from public.friend_chat_members cm where cm.chat_id = p_chat and cm.player_id = p_viewer
  ), others as (
    select cm.player_id, cm.is_admin, cm.joined_at, p.nickname, p.tag, p.level, p.avatar_key, p.last_active_at
      from public.friend_chat_members cm join public.profiles p on p.id = cm.player_id
     where cm.chat_id = p_chat and cm.player_id <> p_viewer
  ), last as (
    select m.id from public.friend_chat_messages m, me
     where m.chat_id = p_chat and m.id > me.since_id order by m.id desc limit 1
  )
  select jsonb_build_object(
    'id', c.id,
    'kind', c.kind,
    'name', case when c.kind = 'group' then c.name
                 else coalesce((select o.nickname from others o limit 1), '?') end,
    'is_admin', me.is_admin,
    'can_write', case when c.kind = 'group' then true
                      else exists (select 1 from others o where public.friend_chat_is_friend(p_viewer, o.player_id)) end,
    'unread', public.friend_chat_unread(p_chat, p_viewer),
    'member_count', 1 + (select count(*) from others),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nickname', o.nickname, 'tag', o.tag, 'level', o.level, 'avatar_key', o.avatar_key,
               'accessories', public.player_worn_accessories(o.player_id), 'is_admin', o.is_admin,
               'online', coalesce(o.last_active_at > public.game_now() - make_interval(
                           mins => coalesce(public.config_double('social', '{onlineMinutes}', 10), 10)::integer), false))
             order by o.is_admin desc, o.joined_at, lower(o.nickname))
        from others o), '[]'::jsonb),
    'last', (select public.friend_chat_message_json(l.id, p_viewer) from last l),
    'last_at', c.last_message_at)
    from public.friend_chats c, me
   where c.id = p_chat;
$$;

-- the member row of the caller, or chat_unknown (also for chats of others: no hint that they exist)
create or replace function public.friend_chat_require(p_chat bigint, p_player uuid)
returns public.friend_chats
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_chat public.friend_chats;
begin
  select c.* into v_chat from public.friend_chats c
   where c.id = p_chat and exists (select 1 from public.friend_chat_members cm where cm.chat_id = c.id and cm.player_id = p_player);
  if v_chat.id is null then
    perform public.api_error('chat_unknown');
  end if;
  return v_chat;
end;
$$;

-- a group name: trimmed, single spaces, social.chat.groupNameMinLength to groupNameMaxLength, no swear words
create or replace function public.friend_chat_name(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if char_length(v_name) < public.friend_chat_cfg('groupNameMinLength', 3) then
    perform public.api_error('name_too_short');
  end if;
  if char_length(v_name) > public.friend_chat_cfg('groupNameMaxLength', 30) then
    perform public.api_error('name_too_long');
  end if;
  if v_name ~ '[[:cntrl:]<>]' then
    perform public.api_error('name_invalid_chars');
  end if;
  if public.text_has_profanity(v_name) or public.text_has_profanity(replace(v_name, ' ', '')) then
    perform public.api_error('name_profanity');
  end if;
  return v_name;
end;
$$;

create or replace function public.friend_chat_system(p_chat bigint, p_body text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.friend_chat_messages (chat_id, author_id, kind, body)
  values (p_chat, null, 'system', left(p_body, 500))
  returning id into v_id;
  update public.friend_chats set last_message_at = now() where id = p_chat;
  return v_id;
end;
$$;

-- tells the other members (or only p_only), at most one unread notification per chat and member
create or replace function public.friend_chat_notify(p_chat bigint, p_from uuid, p_body text, p_message bigint,
                                                     p_only uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat public.friend_chats;
  v_nick text;
  r      record;
begin
  select c.* into v_chat from public.friend_chats c where c.id = p_chat;
  select p.nickname into v_nick from public.profiles p where p.id = p_from;
  for r in select cm.player_id from public.friend_chat_members cm
            where cm.chat_id = p_chat and cm.player_id <> p_from and (p_only is null or cm.player_id = p_only)
              and not exists (select 1 from public.notifications n
                               where n.player_id = cm.player_id and n.type_key = 'friend_chat' and n.read_at is null
                                 and n.payload ->> 'chat_id' = p_chat::text)
            order by cm.player_id loop
    perform public.social_notify(r.player_id, 'friend_chat',
      case when v_chat.kind = 'group' then 'Gruppe ' || v_chat.name else v_nick || ' hat dir geschrieben' end,
      case when v_chat.kind = 'group' then v_nick || ': ' else '' end
        || case when char_length(p_body) > 120 then left(p_body, 117) || '...' else p_body end,
      jsonb_build_object('chat_id', p_chat, 'message_id', p_message),
      '/friends?tab=chats&chat=' || p_chat::text, 'friend-chat:' || p_message::text);
  end loop;
end;
$$;

-- a member goes: the chat closes with the last one, the longest member becomes admin when none is left
create or replace function public.friend_chat_drop_member(p_chat bigint, p_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friend_chat_members where chat_id = p_chat and player_id = p_player;
  delete from public.notifications n
   where n.player_id = p_player and n.type_key = 'friend_chat' and n.read_at is null and n.payload ->> 'chat_id' = p_chat::text;
  if not exists (select 1 from public.friend_chat_members where chat_id = p_chat) then
    delete from public.friend_chats where id = p_chat;
  elsif not exists (select 1 from public.friend_chat_members where chat_id = p_chat and is_admin) then
    update public.friend_chat_members set is_admin = true
     where (chat_id, player_id) = (select cm.chat_id, cm.player_id from public.friend_chat_members cm
                                    where cm.chat_id = p_chat order by cm.joined_at, cm.player_id limit 1);
  end if;
end;
$$;

-- account reset: direct chats go, the player leaves every group, own lines are deleted
create or replace function public.friend_chats_wipe_player(p_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  delete from public.friend_chats c
   where c.kind = 'direct'
     and exists (select 1 from public.friend_chat_members cm where cm.chat_id = c.id and cm.player_id = p_player);
  delete from public.friend_chat_messages where author_id = p_player;
  for r in select cm.chat_id from public.friend_chat_members cm where cm.player_id = p_player order by cm.chat_id loop
    perform public.friend_chat_drop_member(r.chat_id, p_player);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- D. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_chats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_chats  jsonb;
begin
  v_player := public.require_player();
  select coalesce(jsonb_agg(public.friend_chat_json(c.id, v_player) order by c.last_message_at desc, c.id desc), '[]'::jsonb)
    into v_chats
    from (select c.id, c.last_message_at
            from public.friend_chats c join public.friend_chat_members cm on cm.chat_id = c.id and cm.player_id = v_player
           -- an opened direct chat without a line shows only for who opened it
           where c.kind = 'group' or c.created_by = v_player
              or exists (select 1 from public.friend_chat_messages m where m.chat_id = c.id and m.kind = 'player')
           order by c.last_message_at desc, c.id desc
           limit 100) c;
  return jsonb_build_object('chats', v_chats,
                            'unread', coalesce((select sum((x ->> 'unread')::integer) from jsonb_array_elements(v_chats) x), 0));
end;
$$;
comment on function public.get_chats() is
  'RPC: the own friend chats, newest first, with members, last message and unread lines (ADR-164).';

create or replace function public.get_chat(p_chat_id bigint, p_before_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_since  bigint;
  v_page   integer := greatest(1, public.friend_chat_cfg('pageSize', 50));
  v_rows   jsonb;
  v_count  integer;
begin
  v_player := public.require_player();
  perform public.friend_chat_require(p_chat_id, v_player);
  select cm.since_id into v_since from public.friend_chat_members cm where cm.chat_id = p_chat_id and cm.player_id = v_player;
  select coalesce(jsonb_agg(public.friend_chat_message_json(x.id, v_player) order by x.id), '[]'::jsonb), count(*)
    into v_rows, v_count
    from (select m.id from public.friend_chat_messages m
           where m.chat_id = p_chat_id and m.id > v_since and (p_before_id is null or m.id < p_before_id)
           order by m.id desc limit v_page + 1) x;
  if v_count > v_page then
    v_rows := v_rows - 0;
  end if;
  return jsonb_build_object('chat', public.friend_chat_json(p_chat_id, v_player), 'messages', v_rows,
                            'has_more', v_count > v_page);
end;
$$;
comment on function public.get_chat(bigint, bigint) is
  'RPC: one friend chat with its newest messages (older ones with p_before_id), oldest first (ADR-164). Error chat_unknown.';

create or replace function public.mark_chat_read(p_chat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  v_player := public.require_player();
  perform public.friend_chat_require(p_chat_id, v_player);
  update public.friend_chat_members cm
     set last_read_id = greatest(cm.last_read_id,
                                 coalesce((select max(m.id) from public.friend_chat_messages m where m.chat_id = p_chat_id), 0))
   where cm.chat_id = p_chat_id and cm.player_id = v_player;
  update public.notifications n set read_at = now()
   where n.player_id = v_player and n.type_key = 'friend_chat' and n.read_at is null
     and n.payload ->> 'chat_id' = p_chat_id::text;
  return jsonb_build_object('unread', coalesce((select sum(public.friend_chat_unread(cm.chat_id, v_player))
                                                  from public.friend_chat_members cm where cm.player_id = v_player), 0));
end;
$$;
comment on function public.mark_chat_read(bigint) is
  'RPC: marks a friend chat as read (and its notification); idempotent, returns all unread lines (ADR-164).';

create or replace function public.open_direct_chat(p_request_id uuid, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_other  uuid;
  v_key    text;
  v_chat   bigint;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'open_direct_chat');
  if v_replay is not null then
    return v_replay;
  end if;
  v_other := public.friend_target(v_player, p_nickname);
  if not public.friend_chat_is_friend(v_player, v_other) then
    perform public.api_error('not_friends');
  end if;
  v_key := least(v_player, v_other)::text || ':' || greatest(v_player, v_other)::text;
  insert into public.friend_chats (kind, direct_key, created_by) values ('direct', v_key, v_player)
  on conflict (direct_key) do nothing;
  select c.id into v_chat from public.friend_chats c where c.direct_key = v_key;
  insert into public.friend_chat_members (chat_id, player_id) values (v_chat, v_player), (v_chat, v_other)
  on conflict do nothing;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('chat', public.friend_chat_json(v_chat, v_player)));
end;
$$;
comment on function public.open_direct_chat(uuid, text) is
  'RPC: the direct chat with a friend, created on first use (ADR-164). Errors not_friends, player_not_found.';

create or replace function public.create_group_chat(p_request_id uuid, p_name text, p_nicknames text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_name   text;
  v_ids    uuid[] := '{}';
  v_id     uuid;
  v_nick   text;
  v_chat   bigint;
  v_msg    bigint;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'create_group_chat');
  if v_replay is not null then
    return v_replay;
  end if;
  v_name := public.friend_chat_name(p_name);
  if coalesce(cardinality(p_nicknames), 0) > 100 then
    perform public.api_error('chat_group_full');
  end if;
  foreach v_nick in array coalesce(p_nicknames, '{}') loop
    v_id := public.friend_target(v_player, v_nick);
    if not public.friend_chat_is_friend(v_player, v_id) then
      perform public.api_error('not_friends');
    end if;
    if not v_id = any (v_ids) then
      v_ids := v_ids || v_id;
    end if;
  end loop;
  if cardinality(v_ids) + 1 < greatest(2, public.friend_chat_cfg('groupMinMembers', 2)) then
    perform public.api_error('chat_group_too_small');
  end if;
  if cardinality(v_ids) + 1 > public.friend_chat_cfg('groupMaxMembers', 20) then
    perform public.api_error('chat_group_full');
  end if;
  -- one creation at a time per player; a few groups a day at most
  perform 1 from public.profiles p where p.id = v_player for update;
  if (select count(*) from public.friend_chats c where c.created_by = v_player and c.kind = 'group'
         and c.created_at > now() - interval '24 hours') >= public.friend_chat_cfg('maxGroupsPerDay', 10) then
    perform public.api_error('rate_limited');
  end if;
  insert into public.friend_chats (kind, name, created_by) values ('group', v_name, v_player) returning id into v_chat;
  insert into public.friend_chat_members (chat_id, player_id, is_admin) values (v_chat, v_player, true);
  insert into public.friend_chat_members (chat_id, player_id) select v_chat, x from unnest(v_ids) x;
  select p.nickname into v_nick from public.profiles p where p.id = v_player;
  v_msg := public.friend_chat_system(v_chat, v_nick || ' hat die Gruppe „' || v_name || '“ gegründet.');
  update public.friend_chat_members set last_read_id = v_msg where chat_id = v_chat and player_id = v_player;
  perform public.friend_chat_notify(v_chat, v_player, v_nick || ' hat dich in die Gruppe geholt.', v_msg);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('chat', public.friend_chat_json(v_chat, v_player)));
end;
$$;
comment on function public.create_group_chat(uuid, text, text[]) is
  'RPC: a group chat with own friends, the caller is admin (ADR-164). Errors name_*, not_friends, chat_group_too_small, '
  'chat_group_full, rate_limited.';

create or replace function public.post_chat_message(p_request_id uuid, p_chat_id bigint, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_chat   public.friend_chats;
  v_body   text := btrim(coalesce(p_body, ''));
  v_id     bigint;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'post_chat_message');
  if v_replay is not null then
    return v_replay;
  end if;
  v_chat := public.friend_chat_require(p_chat_id, v_player);
  if v_chat.kind = 'direct' and not exists (
       select 1 from public.friend_chat_members cm
        where cm.chat_id = v_chat.id and cm.player_id <> v_player and public.friend_chat_is_friend(v_player, cm.player_id)) then
    perform public.api_error('chat_read_only');
  end if;
  if v_body = '' or char_length(v_body) > public.friend_chat_cfg('maxMessageLength', 300) then
    perform public.api_error('invalid_argument');
  end if;
  if public.text_has_profanity(v_body) then
    perform public.api_error('name_profanity');
  end if;
  perform 1 from public.profiles p where p.id = v_player for update;
  if (select count(*) from public.friend_chat_messages m
       where m.author_id = v_player and m.kind = 'player' and m.created_at > now() - interval '1 minute')
     >= public.friend_chat_cfg('maxMessagesPerMinute', 12) then
    perform public.api_error('rate_limited');
  end if;
  insert into public.friend_chat_messages (chat_id, author_id, kind, body) values (v_chat.id, v_player, 'player', v_body)
  returning id into v_id;
  update public.friend_chats set last_message_at = now() where id = v_chat.id;
  update public.friend_chat_members set last_read_id = v_id where chat_id = v_chat.id and player_id = v_player;
  perform public.friend_chat_notify(v_chat.id, v_player, v_body, v_id);
  return public.request_complete(v_player, p_request_id,
                                 jsonb_build_object('message', public.friend_chat_message_json(v_id, v_player)));
end;
$$;
comment on function public.post_chat_message(uuid, bigint, text) is
  'RPC: writes into a friend chat (ADR-164). Errors chat_unknown, chat_read_only, invalid_argument, name_profanity, rate_limited.';

create or replace function public.add_group_member(p_request_id uuid, p_chat_id bigint, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_chat   public.friend_chats;
  v_other  uuid;
  v_since  bigint;
  v_msg    bigint;
  v_me     text;
  v_them   text;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'add_group_member');
  if v_replay is not null then
    return v_replay;
  end if;
  v_chat := public.friend_chat_require(p_chat_id, v_player);
  if v_chat.kind <> 'group' then
    perform public.api_error('invalid_argument');
  end if;
  v_other := public.friend_target(v_player, p_nickname);
  if not public.friend_chat_is_friend(v_player, v_other) then
    perform public.api_error('not_friends');
  end if;
  perform 1 from public.friend_chats c where c.id = v_chat.id for update;
  if exists (select 1 from public.friend_chat_members cm where cm.chat_id = v_chat.id and cm.player_id = v_other) then
    perform public.api_error('chat_already_member');
  end if;
  if (select count(*) from public.friend_chat_members cm where cm.chat_id = v_chat.id)
     >= public.friend_chat_cfg('groupMaxMembers', 20) then
    perform public.api_error('chat_group_full');
  end if;
  select coalesce(max(m.id), 0) into v_since from public.friend_chat_messages m where m.chat_id = v_chat.id;
  insert into public.friend_chat_members (chat_id, player_id, since_id, last_read_id) values (v_chat.id, v_other, v_since, v_since);
  select p.nickname into v_me from public.profiles p where p.id = v_player;
  select p.nickname into v_them from public.profiles p where p.id = v_other;
  v_msg := public.friend_chat_system(v_chat.id, v_me || ' hat ' || v_them || ' hinzugefügt.');
  perform public.friend_chat_notify(v_chat.id, v_player, v_me || ' hat dich in die Gruppe geholt.', v_msg, v_other);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('chat', public.friend_chat_json(v_chat.id, v_player)));
end;
$$;
comment on function public.add_group_member(uuid, bigint, text) is
  'RPC: a member adds an own friend to a group (ADR-164). Errors chat_unknown, not_friends, chat_already_member, chat_group_full.';

create or replace function public.remove_group_member(p_request_id uuid, p_chat_id bigint, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_chat   public.friend_chats;
  v_other  uuid;
  v_me     text;
  v_them   text;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'remove_group_member');
  if v_replay is not null then
    return v_replay;
  end if;
  v_chat := public.friend_chat_require(p_chat_id, v_player);
  if v_chat.kind <> 'group' then
    perform public.api_error('invalid_argument');
  end if;
  if not exists (select 1 from public.friend_chat_members cm where cm.chat_id = v_chat.id and cm.player_id = v_player and cm.is_admin) then
    perform public.api_error('chat_not_admin');
  end if;
  v_other := public.friend_target(v_player, p_nickname);
  if not exists (select 1 from public.friend_chat_members cm where cm.chat_id = v_chat.id and cm.player_id = v_other) then
    perform public.api_error('player_not_found');
  end if;
  select p.nickname into v_me from public.profiles p where p.id = v_player;
  select p.nickname into v_them from public.profiles p where p.id = v_other;
  perform public.friend_chat_drop_member(v_chat.id, v_other);
  perform public.friend_chat_system(v_chat.id, v_me || ' hat ' || v_them || ' aus der Gruppe genommen.');
  return public.request_complete(v_player, p_request_id, jsonb_build_object('chat', public.friend_chat_json(v_chat.id, v_player)));
end;
$$;
comment on function public.remove_group_member(uuid, bigint, text) is
  'RPC: the admin removes a member from a group (ADR-164). Errors chat_unknown, chat_not_admin, player_not_found.';

create or replace function public.leave_group(p_request_id uuid, p_chat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_chat   public.friend_chats;
  v_me     text;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'leave_group');
  if v_replay is not null then
    return v_replay;
  end if;
  v_chat := public.friend_chat_require(p_chat_id, v_player);
  if v_chat.kind <> 'group' then
    perform public.api_error('invalid_argument');
  end if;
  select p.nickname into v_me from public.profiles p where p.id = v_player;
  perform public.friend_chat_drop_member(v_chat.id, v_player);
  if exists (select 1 from public.friend_chats c where c.id = v_chat.id) then
    perform public.friend_chat_system(v_chat.id, v_me || ' hat die Gruppe verlassen.');
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('chat_id', v_chat.id, 'left', true));
end;
$$;
comment on function public.leave_group(uuid, bigint) is
  'RPC: leaves a group; the last one closes it, a new admin follows the old one (ADR-164). Error chat_unknown.';

create or replace function public.rename_group(p_request_id uuid, p_chat_id bigint, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_chat   public.friend_chats;
  v_name   text;
  v_me     text;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'rename_group');
  if v_replay is not null then
    return v_replay;
  end if;
  v_chat := public.friend_chat_require(p_chat_id, v_player);
  if v_chat.kind <> 'group' then
    perform public.api_error('invalid_argument');
  end if;
  if not exists (select 1 from public.friend_chat_members cm where cm.chat_id = v_chat.id and cm.player_id = v_player and cm.is_admin) then
    perform public.api_error('chat_not_admin');
  end if;
  v_name := public.friend_chat_name(p_name);
  if v_name is distinct from v_chat.name then
    update public.friend_chats set name = v_name where id = v_chat.id;
    select p.nickname into v_me from public.profiles p where p.id = v_player;
    perform public.friend_chat_system(v_chat.id, v_me || ' hat die Gruppe in „' || v_name || '“ umbenannt.');
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('chat', public.friend_chat_json(v_chat.id, v_player)));
end;
$$;
comment on function public.rename_group(uuid, bigint, text) is
  'RPC: the admin renames a group (ADR-164). Errors chat_unknown, chat_not_admin, name_*.';

-- ---------------------------------------------------------------------------
-- E. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.friend_chat_is_friend(uuid, uuid)', 'public.friend_chat_cfg(text, double precision)',
    'public.friend_chat_unread(bigint, uuid)', 'public.friend_chat_message_json(bigint, uuid)',
    'public.friend_chat_json(bigint, uuid)', 'public.friend_chat_require(bigint, uuid)', 'public.friend_chat_name(text)',
    'public.friend_chat_system(bigint, text)', 'public.friend_chat_notify(bigint, uuid, text, bigint, uuid)',
    'public.friend_chat_drop_member(bigint, uuid)', 'public.friend_chats_wipe_player(uuid)',
    'public.get_chats()', 'public.get_chat(bigint, bigint)', 'public.mark_chat_read(bigint)',
    'public.open_direct_chat(uuid, text)', 'public.create_group_chat(uuid, text, text[])',
    'public.post_chat_message(uuid, bigint, text)', 'public.add_group_member(uuid, bigint, text)',
    'public.remove_group_member(uuid, bigint, text)', 'public.leave_group(uuid, bigint)',
    'public.rename_group(uuid, bigint, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_chats()', 'public.get_chat(bigint, bigint)', 'public.mark_chat_read(bigint)',
    'public.open_direct_chat(uuid, text)', 'public.create_group_chat(uuid, text, text[])',
    'public.post_chat_message(uuid, bigint, text)', 'public.add_group_member(uuid, bigint, text)',
    'public.remove_group_member(uuid, bigint, text)', 'public.leave_group(uuid, bigint)',
    'public.rename_group(uuid, bigint, text)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Account reset, missions
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.account_wipe(uuid, text)'::regprocedure);
  v_old text := $t$  perform public.rentals_wipe_player(p_player);$t$;
  v_new text := $t$  perform public.rentals_wipe_player(p_player);

  -- friend chats (ADR-164): direct chats go, groups are left, own lines deleted
  perform public.friend_chats_wipe_player(p_player);$t$;
begin
  if position('friend_chats_wipe_player' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'account_wipe() has an unexpected shape; add friend_chats_wipe_player by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.mission_doable(uuid, text, text)'::regprocedure);
  v_old text := $t$    when p_metric = 'company_chat' then$t$;
  v_new text := $t$    -- ADR-164: writing to a friend needs a friend
    when p_metric = 'friend_chat' then exists (select 1 from public.friendships f
                                                where f.status = 'accepted' and p_player in (f.requester_id, f.addressee_id))
    when p_metric = 'company_chat' then$t$;
begin
  if position('''friend_chat''' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'mission_doable() has an unexpected shape; add friend_chat by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

create or replace function public.friend_chat_mission_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'player' and new.author_id is not null then
    perform public.mission_event(new.author_id, 'friend_chat', 1, new.chat_id::text);
  end if;
  return new;
end;
$$;
revoke all on function public.friend_chat_mission_events() from public, anon, authenticated;
comment on function public.friend_chat_mission_events() is 'Trigger: mission event friend_chat for every own line (ADR-164).';
drop trigger if exists mission_events on public.friend_chat_messages;
create trigger mission_events after insert on public.friend_chat_messages
  for each row execute function public.friend_chat_mission_events();

insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  ('q_friend_chat', 'quick', 'Schreib einem Freund', 'Ein kurzes Hallo im Chat. Freunde freuen sich.', 'mission_bell', 'friend_chat', 'count', '{}'::jsonb, 1, 1, 25, 35, 1, 0, false, 40, 0),
  ('d_friend_chat', 'daily', 'Schreib {target} Nachrichten an Freunde', 'Tratsch über Kurse zählt auch.', 'mission_bell', 'friend_chat', 'count', '{}'::jsonb, 3, 5, 200, 280, 1, 0, true, 30, 0)
on conflict (key) do update
   set kind = excluded.kind, title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params, target_min = excluded.target_min,
       target_max = excluded.target_max, xp_min = excluded.xp_min, xp_max = excluded.xp_max, min_level = excluded.min_level,
       chain_order = excluded.chain_order, scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true, updated_at = now();
