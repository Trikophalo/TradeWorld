-- =============================================================================
-- 9v · Battles per hour (battles.lobby.perHour), then the next round after the next show
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
-- the test runs with three per hour; the live value comes from game_config
select public.config_jsonb('battles', '{lobby,perHour}') as live_per_hour \gset
update public.game_config set value = jsonb_set(value, '{lobby,perHour}', '3') where key = 'battles';

delete from public.battles where status in ('open', 'running');
delete from public.battles where started_at >= date_trunc('hour', now());
insert into public.battles (status, seed, prize, opened_at, started_at, finished_at)
select 'finished', g, '{"kind": "xp"}'::jsonb, now() - interval '1 minute', date_trunc('hour', now()) + make_interval(secs => g), now()
  from generate_series(1, 2) g;
select public.battle_maintain(now()) is null as ok \gset
select tests.assert(
  public.battles_started_this_hour(now()) = 2
  and (select count(*) = 1 from public.battles where status = 'open'),
  'battle_maintain(): with two battles this hour the third lobby opens');
update public.battles set status = 'finished', started_at = date_trunc('hour', now()) + interval '5 seconds', finished_at = now()
 where status = 'open';
select public.battle_maintain(now()) is null as ok \gset
select tests.assert(
  public.battles_started_this_hour(now()) = 3
  and not exists (select 1 from public.battles where status = 'open')
  and public.battle_state(null, now()) ->> 'played_this_hour' = '3'
  and (public.battle_state(null, now()) ->> 'per_hour')::int = 3
  and (public.battle_state(null, now()) ->> 'next_round_at')::timestamptz = date_trunc('hour', now()) + interval '1 hour',
  'battle_maintain(): after three battles no lobby until the next full hour; the state says when');
select public.battle_maintain(date_trunc('hour', now()) + interval '1 hour 1 second') is null as ok \gset
select tests.assert((select count(*) = 1 from public.battles where status = 'open'),
  'the next hour: a new lobby opens');
delete from public.battles where status = 'open';
-- leave no made-up battles behind (the fixtures read the last finished one)
delete from public.battles where kind is null and status = 'finished';
update public.game_config set value = jsonb_set(value, '{lobby,perHour}', :'live_per_hour'::jsonb) where key = 'battles';
