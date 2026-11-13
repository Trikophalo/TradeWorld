-- =============================================================================
-- 86 · Sign-up without an invite code is the default (ADR-114)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

select tests.assert(
  not exists (select 1 from public.game_config where key = 'auth')
  and not public.config_boolean('auth', '{inviteRequired}', false),
  'no auth section in game_config: invite codes are off');

begin;
insert into auth.users (email, raw_user_meta_data) values
  ('frei@open.test', '{"age_confirmed": true, "nickname": "Frei_Dabei"}'),
  ('code@open.test', '{"age_confirmed": true, "nickname": "Mit_Altcode", "invite_code": "GIBTSNICHT"}');
select tests.assert(
  (select count(*) from public.profiles where nickname in ('Frei_Dabei', 'Mit_Altcode')) = 2
  and (select count(*) from public.ledger_accounts a join public.profiles p on p.id = a.owner_player_id
        where p.nickname = 'Frei_Dabei' and a.kind = 'player_cash' and a.balance_cents > 0) = 1,
  'sign-up without an invite code: profile and starting capital; an unknown code is ignored');
select tests.throws(
  $$insert into auth.users (email, raw_user_meta_data) values ('jung@open.test', '{"nickname": "Zu_Jung"}')$$,
  'NX007', 'the 18+ confirmation is still required');
-- the switch still works
insert into public.game_config (key, value) values ('auth', '{"inviteRequired": true}');
select tests.throws(
  $$insert into auth.users (email, raw_user_meta_data) values ('zu@open.test', '{"age_confirmed": true, "nickname": "Zu_Spaet"}')$$,
  'NX005', 'with auth.inviteRequired = true the doors are closed again');
rollback;
