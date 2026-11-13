-- =============================================================================
-- 92 · Own net worth over time (ADR-124)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''09209209-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Vera_Verlauf') is not null as ok \gset
begin;
insert into public.rich_list_snapshots (taken_at, entity_kind, entity_id, net_worth_cents, rank_all, rank_players)
select public.game_now() - make_interval(mins => m), 'player', :a, 1000000 + m * 100, 50, 5
  from generate_series(0, 60 * 30, 5) m;
select tests.login_as('authenticated', :a);
select public.get_my_net_worth_history(24) as d, public.get_my_net_worth_history(168) as w \gset
reset role;
select tests.assert(
  jsonb_array_length(:'d'::jsonb -> 'points') between 280 and 290
  and jsonb_array_length(:'w'::jsonb -> 'points') between 30 and 32
  and (:'d'::jsonb -> 'points' -> 0 ->> 'at')::timestamptz < (:'d'::jsonb -> 'points' -> -1 ->> 'at')::timestamptz
  and (:'d'::jsonb -> 'points' -> -1 ->> 'net_worth_cents')::bigint = 1000000,
  'get_my_net_worth_history(): every snapshot for a day, hourly for a week, oldest first, newest value last');
rollback;
