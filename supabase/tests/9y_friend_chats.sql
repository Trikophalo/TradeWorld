-- =============================================================================
-- 9y · Chats with friends: direct chats and groups (ADR-164)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0c4a7000-0000-4000-8000-0000000000a1'''
\set b '''0c4a7000-0000-4000-8000-0000000000b1'''
\set c '''0c4a7000-0000-4000-8000-0000000000c1'''
\set d '''0c4a7000-0000-4000-8000-0000000000d1'''
\set e '''0c4a7000-0000-4000-8000-0000000000e1'''
\set rq '''0c4a7000-0000-4000-8000-0000000000f1'''
\set rm '''0c4a7000-0000-4000-8000-0000000000f2'''
\set rg '''0c4a7000-0000-4000-8000-0000000000f3'''
update public.invite_codes set max_uses = max_uses + 5 where code = 'M1-TESTS';
select tests.signup(:a, 'Chat_Anna') is not null and tests.signup(:b, 'Chat_Bruno') is not null
   and tests.signup(:c, 'Chat_Clara') is not null and tests.signup(:d, 'Chat_Dora') is not null
   and tests.signup(:e, 'Chat_Emil') is not null as ok \gset
-- Anna is friends with Bruno, Clara and Dora; Bruno with Clara; Emil is nobody's friend
insert into public.friendships (requester_id, addressee_id, status, responded_at)
values (:a, :b, 'accepted', now()), (:a, :c, 'accepted', now()), (:d, :a, 'accepted', now()), (:b, :c, 'accepted', now()),
       (:e, :a, 'pending', null);

-- =============================================================================
-- A. Direct chats only between friends, one per pair, idempotent
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.get_chats() as empty \gset
select public.open_direct_chat(:rq, 'chat_bruno') as o1 \gset
select public.open_direct_chat(:rq, 'chat_bruno') as o1b \gset
select public.open_direct_chat(gen_random_uuid(), 'Chat_Bruno') as o2 \gset
select tests.throws_key($$select public.open_direct_chat(gen_random_uuid(), 'Chat_Emil')$$, 'not_friends',
  'open_direct_chat(): only with accepted friends (a pending request is not enough)');
select tests.throws_key($$select public.open_direct_chat(gen_random_uuid(), 'Chat_Anna')$$, 'invalid_argument',
  'open_direct_chat(): not with oneself');
select tests.throws_key($$select public.open_direct_chat(gen_random_uuid(), 'Niemand_Hier')$$, 'player_not_found',
  'open_direct_chat(): unknown nickname');
select tests.throws_key($$select public.open_direct_chat(null, 'Chat_Bruno')$$, 'invalid_argument',
  'open_direct_chat(): a request id is required');
reset role;
select (:'o1'::jsonb -> 'chat' ->> 'id')::bigint as dm \gset
select tests.assert(
  :'empty'::jsonb = '{"chats": [], "unread": 0}'::jsonb
  and :'o1b'::jsonb = :'o1'::jsonb
  and (:'o2'::jsonb -> 'chat' ->> 'id')::bigint = :dm
  and :'o1'::jsonb -> 'chat' ->> 'kind' = 'direct' and :'o1'::jsonb -> 'chat' ->> 'name' = 'Chat_Bruno'
  and (:'o1'::jsonb -> 'chat' ->> 'can_write')::boolean
  and :'o1'::jsonb -> 'chat' -> 'members' -> 0 ->> 'nickname' = 'Chat_Bruno'
  and not ((:'o1'::jsonb -> 'chat' -> 'members' -> 0) ? 'id')
  and (select count(*) from public.friend_chats where kind = 'direct') = 1
  and (select count(*) from public.friend_chat_members where chat_id = :dm) = 2,
  'open_direct_chat(): one chat per pair, the same request replays, no player ids in the answer');

-- Bruno does not see an empty chat Anna only opened
select tests.login_as('authenticated', :b);
select public.get_chats() as bempty \gset
reset role;
select tests.assert(jsonb_array_length(:'bempty'::jsonb -> 'chats') = 0, 'get_chats(): an opened direct chat without a line shows only for its opener');

-- =============================================================================
-- B. Messages, unread counts, one notification per chat, read marks
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.post_chat_message(:rm, :dm, '  Hallo Bruno!  ') as m1 \gset
select public.post_chat_message(:rm, :dm, '  Hallo Bruno!  ') as m1b \gset
select public.post_chat_message(gen_random_uuid(), :dm, 'Kauf VLT 🚀') is not null as ok \gset
select tests.throws_key(format($$select public.post_chat_message(gen_random_uuid(), %s, '   ')$$, :dm), 'invalid_argument',
  'post_chat_message(): not empty');
select tests.throws_key(format($$select public.post_chat_message(gen_random_uuid(), %s, repeat('x', 301))$$, :dm), 'invalid_argument',
  'post_chat_message(): at most social.chat.maxMessageLength characters');
select tests.throws_key(format($$select public.post_chat_message(gen_random_uuid(), %s, 'du arschloch')$$, :dm), 'name_profanity',
  'post_chat_message(): the profanity filter');
reset role;
select tests.assert(
  :'m1'::jsonb = :'m1b'::jsonb and :'m1'::jsonb -> 'message' ->> 'body' = 'Hallo Bruno!'
  and (:'m1'::jsonb -> 'message' ->> 'is_me')::boolean and :'m1'::jsonb -> 'message' ->> 'author' = 'Chat_Anna'
  and (select count(*) from public.friend_chat_messages where chat_id = :dm and kind = 'player') = 2
  and (select count(*) from public.notifications where player_id = :b and type_key = 'friend_chat' and read_at is null) = 1
  and (select n.title from public.notifications n where n.player_id = :b and n.type_key = 'friend_chat') = 'Chat_Anna hat dir geschrieben'
  and (select n.link from public.notifications n where n.player_id = :b and n.type_key = 'friend_chat') = '/friends?tab=chats&chat=' || :dm
  and not exists (select 1 from public.notifications where player_id = :a and type_key = 'friend_chat'),
  'post_chat_message(): trimmed, idempotent; the friend gets one unread friend_chat notification for two lines');

select tests.login_as('authenticated', :b);
select public.get_chats() as bl \gset
select public.get_chat(:dm) as bc \gset
select public.mark_chat_read(:dm) as br \gset
select public.get_chats() as bl2 \gset
select public.post_chat_message(gen_random_uuid(), :dm, 'Hi Anna') is not null as ok \gset
reset role;
select tests.assert(
  (:'bl'::jsonb ->> 'unread')::int = 2 and (:'bl'::jsonb -> 'chats' -> 0 ->> 'unread')::int = 2
  and :'bl'::jsonb -> 'chats' -> 0 -> 'last' ->> 'body' = 'Kauf VLT 🚀'
  and not (:'bl'::jsonb -> 'chats' -> 0 -> 'last' ->> 'is_me')::boolean
  and jsonb_array_length(:'bc'::jsonb -> 'messages') = 2 and not (:'bc'::jsonb ->> 'has_more')::boolean
  and :'bc'::jsonb -> 'messages' -> 0 ->> 'body' = 'Hallo Bruno!'
  and (:'br'::jsonb ->> 'unread')::int = 0 and (:'bl2'::jsonb ->> 'unread')::int = 0
  and not exists (select 1 from public.notifications where player_id = :b and type_key = 'friend_chat' and read_at is null)
  and (select count(*) from public.notifications where player_id = :a and type_key = 'friend_chat' and read_at is null) = 1,
  'get_chats()/get_chat(): unread lines and the last one; mark_chat_read() clears them and the notification');

-- a new line after reading notifies again
select tests.login_as('authenticated', :a);
select public.post_chat_message(gen_random_uuid(), :dm, 'Noch was') is not null as ok \gset
reset role;
select tests.assert(
  (select count(*) from public.notifications where player_id = :b and type_key = 'friend_chat') = 2,
  'after reading, the next line notifies again');

-- rate limit
update public.friend_chat_messages set created_at = now() - interval '2 minutes' where author_id = :a;
insert into public.friend_chat_messages (chat_id, author_id, body) select :dm, :a, 'spam ' || g from generate_series(1, 12) g;
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.post_chat_message(gen_random_uuid(), %s, 'eins zu viel')$$, :dm), 'rate_limited',
  'post_chat_message(): at most social.chat.maxMessagesPerMinute lines a minute');
reset role;
update public.friend_chat_messages set created_at = now() - interval '2 minutes' where author_id = :a;

-- paging: older lines with p_before_id
update public.game_config set value = jsonb_set(value, '{chat,pageSize}', '5') where key = 'social';
select tests.login_as('authenticated', :b);
select public.get_chat(:dm) as p1 \gset
select public.get_chat(:dm, (:'p1'::jsonb -> 'messages' -> 0 ->> 'id')::bigint) as p2 \gset
reset role;
update public.game_config set value = jsonb_set(value, '{chat,pageSize}', '50') where key = 'social';
select tests.assert(
  jsonb_array_length(:'p1'::jsonb -> 'messages') = 5 and (:'p1'::jsonb ->> 'has_more')::boolean
  and (:'p1'::jsonb -> 'messages' -> 4 ->> 'id')::bigint = (select max(id) from public.friend_chat_messages where chat_id = :dm)
  and (:'p2'::jsonb -> 'messages' -> 4 ->> 'id')::bigint < (:'p1'::jsonb -> 'messages' -> 0 ->> 'id')::bigint,
  'get_chat(): newest page first (oldest to newest), p_before_id loads the older lines');

-- =============================================================================
-- C. Strangers see nothing
-- =============================================================================
select tests.login_as('authenticated', :e);
select tests.throws_key(format($$select public.get_chat(%s)$$, :dm), 'chat_unknown', 'get_chat(): only members (NX157)');
select tests.throws_key(format($$select public.post_chat_message(gen_random_uuid(), %s, 'Hallo?')$$, :dm), 'chat_unknown',
  'post_chat_message(): only members');
select tests.throws_key(format($$select public.mark_chat_read(%s)$$, :dm), 'chat_unknown', 'mark_chat_read(): only members');
select tests.throws_key($$select public.get_chat(987654321)$$, 'chat_unknown', 'get_chat(): an unknown chat looks the same');
select public.get_chats() as el \gset
select tests.throws($$select * from public.friend_chat_messages$$, '42501', 'no direct read of friend_chat_messages');
select tests.throws($$insert into public.friend_chats (kind, name) values ('group', 'Hack')$$, '42501', 'no direct write of friend_chats');
reset role;
select tests.assert(jsonb_array_length(:'el'::jsonb -> 'chats') = 0, 'get_chats(): a stranger sees none');

-- =============================================================================
-- D. Groups: name, size, friends only, admin rights
-- =============================================================================
update public.game_config set value = jsonb_set(value, '{chat,groupMaxMembers}', '4') where key = 'social';
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.create_group_chat(gen_random_uuid(), 'Börsenclub', array['Chat_Emil'])$$, 'not_friends',
  'create_group_chat(): only own friends');
select tests.throws_key($$select public.create_group_chat(gen_random_uuid(), 'Börsenclub', array[]::text[])$$, 'chat_group_too_small',
  'create_group_chat(): at least social.chat.groupMinMembers (NX161)');
select tests.throws_key($$select public.create_group_chat(gen_random_uuid(), 'Börsenclub', array['Chat_Anna'])$$, 'invalid_argument',
  'create_group_chat(): not oneself');
select tests.throws_key($$select public.create_group_chat(gen_random_uuid(), 'X', array['Chat_Bruno'])$$, 'name_too_short',
  'create_group_chat(): the name needs 3 characters');
select tests.throws_key($$select public.create_group_chat(gen_random_uuid(), repeat('a', 31), array['Chat_Bruno'])$$, 'name_too_long',
  'create_group_chat(): at most 30 characters');
select tests.throws_key($$select public.create_group_chat(gen_random_uuid(), 'Club Arschloch', array['Chat_Bruno'])$$, 'name_profanity',
  'create_group_chat(): the name is filtered like other names');
select public.create_group_chat(:rg, '  Börsen   Club  ', array['Chat_Bruno', 'chat_clara', 'Chat_Bruno']) as g1 \gset
reset role;
select (:'g1'::jsonb -> 'chat' ->> 'id')::bigint as grp \gset
select tests.assert(
  :'g1'::jsonb -> 'chat' ->> 'name' = 'Börsen Club' and :'g1'::jsonb -> 'chat' ->> 'kind' = 'group'
  and (:'g1'::jsonb -> 'chat' ->> 'is_admin')::boolean and (:'g1'::jsonb -> 'chat' ->> 'member_count')::int = 3
  and (select count(*) from public.friend_chat_members where chat_id = :grp and is_admin) = 1
  and (select count(*) from public.notifications where player_id in (:b, :c) and type_key = 'friend_chat'
         and payload ->> 'chat_id' = :grp::text) = 2
  and (select body from public.friend_chat_messages where chat_id = :grp order by id limit 1) = 'Chat_Anna hat die Gruppe „Börsen Club“ gegründet.',
  'create_group_chat(): name tidied, duplicates once, the creator is admin, the others are told');

-- Bruno writes, Anna and Clara hear about it; Bruno adds nobody he is not friends with
select tests.login_as('authenticated', :b);
select public.post_chat_message(gen_random_uuid(), :grp, 'Moin zusammen') is not null as ok \gset
select tests.throws_key(format($$select public.add_group_member(gen_random_uuid(), %s, 'Chat_Dora')$$, :grp), 'not_friends',
  'add_group_member(): only own friends of who adds');
select tests.throws_key(format($$select public.rename_group(gen_random_uuid(), %s, 'Bruno-Club')$$, :grp), 'chat_not_admin',
  'rename_group(): only the admin (NX159)');
select tests.throws_key(format($$select public.remove_group_member(gen_random_uuid(), %s, 'Chat_Clara')$$, :grp), 'chat_not_admin',
  'remove_group_member(): only the admin');
reset role;
select tests.assert(
  (select count(*) from public.notifications where player_id = :a and type_key = 'friend_chat' and read_at is null
     and payload ->> 'chat_id' = :grp::text) = 1
  and (select title from public.notifications where player_id = :a and type_key = 'friend_chat' and payload ->> 'chat_id' = :grp::text) = 'Gruppe Börsen Club'
  and (select count(*) from public.notifications where player_id = :c and type_key = 'friend_chat'
         and payload ->> 'chat_id' = :grp::text) = 1,
  'a group line notifies the others once per chat (Clara still has the unread invitation)');

-- Anna adds Dora: Dora sees only what comes after; the group is then full
select tests.login_as('authenticated', :a);
select public.add_group_member(gen_random_uuid(), :grp, 'Chat_Dora') as ad \gset
select tests.throws_key(format($$select public.add_group_member(gen_random_uuid(), %s, 'Chat_Dora')$$, :grp), 'chat_already_member',
  'add_group_member(): not twice (NX162)');
reset role;
insert into public.friendships (requester_id, addressee_id, status, responded_at) values (:a, :e, 'accepted', now())
on conflict do nothing;
update public.friendships set status = 'accepted', responded_at = now() where requester_id = :e and addressee_id = :a;
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.add_group_member(gen_random_uuid(), %s, 'Chat_Emil')$$, :grp), 'chat_group_full',
  'add_group_member(): at most social.chat.groupMaxMembers (NX160)');
select tests.throws_key($$select public.create_group_chat(gen_random_uuid(), 'Zu Viele', array['Chat_Bruno', 'Chat_Clara', 'Chat_Dora', 'Chat_Emil'])$$,
  'chat_group_full', 'create_group_chat(): not more than social.chat.groupMaxMembers');
reset role;
select tests.login_as('authenticated', :d);
select public.get_chat(:grp) as dc \gset
reset role;
select tests.assert(
  (:'ad'::jsonb -> 'chat' ->> 'member_count')::int = 4
  and jsonb_array_length(:'dc'::jsonb -> 'messages') = 1
  and :'dc'::jsonb -> 'messages' -> 0 ->> 'body' = 'Chat_Anna hat Chat_Dora hinzugefügt.'
  and :'dc'::jsonb -> 'messages' -> 0 ->> 'kind' = 'system'
  and (:'dc'::jsonb -> 'chat' ->> 'unread')::int = 0
  and (select count(*) from public.notifications where player_id = :d and type_key = 'friend_chat') = 1,
  'add_group_member(): the new member sees the lines from joining on and is told');

-- rename, remove, leave; the admin passes on
select tests.login_as('authenticated', :a);
select public.rename_group(gen_random_uuid(), :grp, 'Die Bullen') as rn \gset
select public.remove_group_member(gen_random_uuid(), :grp, 'Chat_Dora') as rmv \gset
select tests.throws_key(format($$select public.remove_group_member(gen_random_uuid(), %s, 'Chat_Dora')$$, :grp), 'player_not_found',
  'remove_group_member(): only members');
select tests.throws_key(format($$select public.leave_group(gen_random_uuid(), %s)$$, :dm), 'invalid_argument',
  'leave_group(): not a direct chat');
select public.leave_group(gen_random_uuid(), :grp) as lv \gset
select tests.throws_key(format($$select public.get_chat(%s)$$, :grp), 'chat_unknown', 'after leaving the group is gone for Anna');
reset role;
select tests.login_as('authenticated', :d);
select tests.throws_key(format($$select public.get_chat(%s)$$, :grp), 'chat_unknown', 'a removed member no longer reads the group');
reset role;
select tests.assert(
  :'rn'::jsonb -> 'chat' ->> 'name' = 'Die Bullen' and (:'rmv'::jsonb -> 'chat' ->> 'member_count')::int = 3
  and (:'lv'::jsonb ->> 'left')::boolean
  and (select player_id from public.friend_chat_members where chat_id = :grp and is_admin) = :b
  and (select count(*) from public.friend_chat_members where chat_id = :grp) = 2
  and (select body from public.friend_chat_messages where chat_id = :grp order by id desc limit 1) = 'Chat_Anna hat die Gruppe verlassen.'
  and not exists (select 1 from public.notifications where player_id = :d and type_key = 'friend_chat' and read_at is null),
  'rename, remove, leave: Bruno (longest member) becomes admin, system lines tell the story');
update public.game_config set value = jsonb_set(value, '{chat,groupMaxMembers}', '20') where key = 'social';

-- the last one closes the group
select tests.login_as('authenticated', :b);
select public.leave_group(gen_random_uuid(), :grp) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select public.leave_group(gen_random_uuid(), :grp) is not null as ok \gset
reset role;
select tests.assert(not exists (select 1 from public.friend_chats where id = :grp)
  and not exists (select 1 from public.friend_chat_messages where chat_id = :grp),
  'leave_group(): who leaves last closes the group');

-- =============================================================================
-- E. Unfriending makes the direct chat read-only
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.remove_friend(gen_random_uuid(), 'Chat_Bruno') is not null as ok \gset
select public.get_chat(:dm) as ro \gset
select tests.throws_key(format($$select public.post_chat_message(gen_random_uuid(), %s, 'Hallo?')$$, :dm), 'chat_read_only',
  'post_chat_message(): no new lines after the friendship ended (NX158)');
select tests.throws_key($$select public.open_direct_chat(gen_random_uuid(), 'Chat_Bruno')$$, 'not_friends',
  'open_direct_chat(): not after the friendship ended');
reset role;
select tests.assert(
  not (:'ro'::jsonb -> 'chat' ->> 'can_write')::boolean and jsonb_array_length(:'ro'::jsonb -> 'messages') > 0,
  'after unfriending the direct chat stays readable but read-only');

-- =============================================================================
-- F. Missions count own lines; mission_doable needs a friend
-- =============================================================================
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward)
values (:c, 'q_friend_chat', 'quick', date '1999-02-01', 1, 10);
select tests.login_as('authenticated', :c);
select (public.open_direct_chat(gen_random_uuid(), 'Chat_Anna') -> 'chat' ->> 'id')::bigint as dm2 \gset
select public.post_chat_message(gen_random_uuid(), :dm2, 'Hallo Anna') is not null as ok \gset
reset role;
select tests.assert(
  (select status from public.player_missions where player_id = :c and template_key = 'q_friend_chat'
     and period_start = date '1999-02-01') = 'completed'
  and public.mission_doable(:c, 'q_friend_chat', 'friend_chat')
  and not public.mission_doable(gen_random_uuid(), 'q_friend_chat', 'friend_chat')
  and (select count(*) from public.mission_templates where key in ('q_friend_chat', 'd_friend_chat') and is_active) = 2,
  'a line to a friend completes "Schreib einem Freund"; mission_doable() needs a friend');

-- =============================================================================
-- G. A reset forgets the chats of the player
-- =============================================================================
select tests.login_as('authenticated', :a);
select (public.create_group_chat(gen_random_uuid(), 'Reset Runde', array['Chat_Clara', 'Chat_Dora']) -> 'chat' ->> 'id')::bigint as g2 \gset
select public.post_chat_message(gen_random_uuid(), :g2, 'Bis gleich') is not null as ok \gset
select public.reset_account(gen_random_uuid(), 'Chat_Anna') is not null as ok \gset
reset role;
select tests.assert(
  not exists (select 1 from public.friend_chat_members where player_id = :a)
  and not exists (select 1 from public.friend_chat_messages where author_id = :a)
  and not exists (select 1 from public.friend_chats where id in (:dm, :dm2))
  and (select count(*) from public.friend_chat_members where chat_id = :g2) = 2
  and (select count(*) from public.friend_chat_members where chat_id = :g2 and is_admin) = 1
  and tests.money_invariant() = 'ok',
  'reset_account(): direct chats gone, groups left (a new admin follows), own lines deleted');
