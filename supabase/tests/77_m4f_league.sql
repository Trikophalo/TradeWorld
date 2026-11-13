-- =============================================================================
-- 77 · M4f: weekly league (ADR-089)
-- =============================================================================
-- The league of last week (relative to game_now()) is built, recomputed and closed explicitly,
-- so the file does not depend on the day it runs.
\set QUIET 1
set client_min_messages = notice;

\set a '''07707707-0000-4000-8000-0000000000a1'''
\set b '''07707707-0000-4000-8000-0000000000b2'''
\set c '''07707707-0000-4000-8000-0000000000c3'''
\set d '''07707707-0000-4000-8000-0000000000d4'''
select tests.signup(:a, 'Lia_Liga') is not null and tests.signup(:b, 'Ben_Bilanz') is not null
   and tests.signup(:c, 'Cem_Chance') is not null and tests.signup(:d, 'Dina_Weg') is not null as ok \gset
update public.profiles set is_deactivated = true where id = :d;
select tests.login_as('authenticated', :a);
select public.send_friend_request(gen_random_uuid(), 'Ben_Bilanz') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.respond_friend_request(gen_random_uuid(), 'Lia_Liga', true) is not null as ok \gset
reset role;

-- =============================================================================
-- A. Weeks in Europe/Berlin, season rows, number format
-- =============================================================================
select public.league_ensure_season('2020-01-08 12:00+00') as s2020 \gset
select tests.assert(
  public.league_week_start('2026-11-15 22:30+00') = '2026-11-09' and public.league_week_start('2026-11-15 23:30+00') = '2026-11-16'
  and public.league_week_start('2026-03-29 21:30+00') = '2026-03-23' and public.league_week_start('2026-03-29 22:30+00') = '2026-03-30'
  and (select week_start = '2020-01-06' and starts_at = '2020-01-05 23:00+00' and ends_at = '2020-01-12 23:00+00' and status = 'active'
         from public.league_seasons where id = :'s2020')
  and public.league_ensure_season('2020-01-12 22:59+00') = :'s2020'::uuid,
  'league_week_start(): Monday 00:00 Europe/Berlin (CET and CEST); league_ensure_season() creates one active row per week');
delete from public.league_seasons where id = :'s2020';
select tests.assert(
  public.format_growth_bps(340) = '+3,40 %' and public.format_growth_bps(-25) = '-0,25 %' and public.format_growth_bps(0) = '+0,00 %'
  and public.format_growth_bps(123456) = '+1234,56 %',
  'format_growth_bps(): German percent text');

-- last week's season, rebuilt from scratch
delete from public.league_seasons where week_start = public.league_week_start(public.game_now()) - 7;
select public.league_ensure_season(public.game_now() - interval '7 days') as s \gset

-- =============================================================================
-- B. Baselines: every active player joins with the rich-list net worth; growth 0
-- =============================================================================
select public.league_refresh(:'s') as n1 \gset
select tests.assert(
  :n1 = (select count(*) from public.profiles where not is_deactivated)
  and (select count(*) from public.league_entries where season_id = :'s') = :n1
  and not exists (select 1 from public.league_entries where season_id = :'s' and player_id = :d)
  and (select start_net_worth_cents = public.player_net_worth_cents(:a) and current_net_worth_cents = start_net_worth_cents
              and net_inflow_cents = 0
         from public.league_entry_baselines where season_id = :'s' and player_id = :a)
  and (select bool_and(growth_bps = 0) from public.league_entries where season_id = :'s')
  and (select refreshed_at is not null from public.league_seasons where id = :'s'),
  'league_refresh(): an entry and a baseline (net worth as in the rich list) for every active player, growth 0');

-- =============================================================================
-- C. Free money is inflow, not growth (vault basic income, daily reward cash)
-- =============================================================================
update public.vaults set accrual_started_at = public.game_now() - interval '3 hours' where player_id = :a;
select public.player_net_worth_cents(:a) as nw0 \gset
select tests.login_as('authenticated', :a);
select (public.claim_vault(gen_random_uuid()) ->> 'claimed_cents')::bigint as vault \gset
select (public.claim_daily_reward(gen_random_uuid()) ->> 'cash_cents')::bigint as daily \gset
reset role;
select public.league_refresh(:'s') is not null as ok \gset
select tests.assert(
  :vault > 0 and :daily >= 0
  and (select net_inflow_cents from public.league_entry_baselines where season_id = :'s' and player_id = :a) = :vault + :daily
  and (select current_net_worth_cents from public.league_entry_baselines where season_id = :'s' and player_id = :a) = :nw0 + :vault + :daily
  and (select growth_bps from public.league_entries where season_id = :'s' and player_id = :a) = 0,
  'claim_vault and claim_daily_reward add to net_inflow_cents: net worth rises, growth stays 0');

-- =============================================================================
-- D. Growth and rank
-- =============================================================================
-- Lia +3 000 EUR, Ben -2 000 EUR, Cem: start 5 000 EUR is below minBaselineCents (10 000 EUR)
update public.league_entry_baselines set start_net_worth_cents = current_net_worth_cents - net_inflow_cents - 300000
 where season_id = :'s' and player_id = :a;
update public.league_entry_baselines set start_net_worth_cents = current_net_worth_cents + 200000
 where season_id = :'s' and player_id = :b;
update public.league_entry_baselines set start_net_worth_cents = 500000 where season_id = :'s' and player_id = :c;
select public.league_refresh(:'s') as n2 \gset
select (select current_net_worth_cents from public.league_entry_baselines where season_id = :'s' and player_id = :c) as cur_c,
       (select start_net_worth_cents from public.league_entry_baselines where season_id = :'s' and player_id = :a) as start_a,
       (select start_net_worth_cents from public.league_entry_baselines where season_id = :'s' and player_id = :b) as start_b \gset
select tests.assert(
  (select growth_bps from public.league_entries where season_id = :'s' and player_id = :a)
    = public.div_round_half_even(300000 * 10000::numeric, greatest(:start_a, 1000000))
  and (select growth_bps from public.league_entries where season_id = :'s' and player_id = :b)
    = public.div_round_half_even(-200000 * 10000::numeric, greatest(:start_b, 1000000))
  and (select growth_bps from public.league_entries where season_id = :'s' and player_id = :c)
    = public.div_round_half_even((:cur_c - 500000) * 10000::numeric, 1000000),
  'growth_bps = round_half_even((current - start - inflow) * 10 000 / max(start, minBaselineCents))');
select tests.assert(
  (select rank from public.league_entries where season_id = :'s' and player_id = :c) = 1
  and (select rank from public.league_entries where season_id = :'s' and player_id = :a) = 2
  and (select rank from public.league_entries where season_id = :'s' and player_id = :b) = :n2
  and (select array_agg(rank order by rank) from public.league_entries where season_id = :'s')
      = (select array_agg(g) from generate_series(1, :n2) g)
  and (select bool_and(x.ok) from (
         select e.rank > lag(e.rank) over w
                and (e.growth_bps < lag(e.growth_bps) over w
                     or (p.created_at, lower(p.nickname)) >= (lag(p.created_at) over w, lag(lower(p.nickname)) over w)) as ok
           from public.league_entries e join public.profiles p on p.id = e.player_id
          where e.season_id = :'s' window w as (order by e.rank)) x where x.ok is not null),
  'rank 1..n by growth, ties by the earlier account, then nickname');

update public.profiles set is_deactivated = true where id = :b;
select public.league_refresh(:'s') as n3 \gset
select tests.assert(
  :n3 = :n2 - 1 and (select rank from public.league_entries where season_id = :'s' and player_id = :b) is null,
  'a deactivated player keeps the entry but is not ranked');
update public.profiles set is_deactivated = false where id = :b;
select public.league_refresh(:'s') is not null as ok \gset

-- =============================================================================
-- E. get_league: all / friends, current / last, me, before the close
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.get_league('all', 'last') as la \gset
select public.get_league('friends', 'last') as lf \gset
select tests.throws_key($$select public.get_league('everyone', 'current')$$, 'invalid_argument', 'get_league(): unknown scope');
select tests.throws_key($$select public.get_league('all', 'next')$$, 'invalid_argument', 'get_league(): unknown week');
reset role;
select tests.assert(
  :'la'::jsonb -> 'season' = jsonb_build_object('week_start', (select week_start from public.league_seasons where id = :'s'),
                                                'starts_at', (select starts_at from public.league_seasons where id = :'s'),
                                                'ends_at', (select ends_at from public.league_seasons where id = :'s'),
                                                'status', 'active')
  and jsonb_array_length(:'la'::jsonb -> 'entries') = least(100, :n2)
  and :'la'::jsonb -> 'entries' -> 0 = jsonb_build_object('rank', 1, 'nickname', 'Cem_Chance', 'tag', (select tag from public.profiles where id = :c),
                                                          'avatar_key', 'rookie', 'level', 1,
                                                          'growth_bps', (select growth_bps from public.league_entries where season_id = :'s' and player_id = :c),
                                                          'is_me', false)
  and (:'la'::jsonb -> 'entries' -> 1 ->> 'is_me')::boolean
  and :'la'::jsonb -> 'me' = jsonb_build_object('rank', 2, 'growth_bps', (select growth_bps from public.league_entries where season_id = :'s' and player_id = :a)),
  'get_league(all, last): season, entries {rank, nickname, tag, avatar_key, level, growth_bps, is_me}, me');
select tests.assert(
  (select array_agg(x ->> 'nickname' order by o) from jsonb_array_elements(:'lf'::jsonb -> 'entries') with ordinality t(x, o))
    = array['Lia_Liga', 'Ben_Bilanz']
  and (select array_agg((x ->> 'rank')::int order by o) from jsonb_array_elements(:'lf'::jsonb -> 'entries') with ordinality t(x, o))
    = array[1, 2]
  and (:'lf'::jsonb #>> '{me,rank}')::int = 1,
  'get_league(friends): me and accepted friends only, ranks re-numbered within the scope');

-- =============================================================================
-- F. Season close via social_run_due: winner, feed item, notifications, trophies
-- =============================================================================
update public.league_seasons set refreshed_at = null where week_start = public.league_week_start(public.game_now());
select public.social_run_due() as sr \gset
select public.league_close(:'s') is null as again_null \gset
select tests.assert(
  (select status = 'finished' and winner_id = :c from public.league_seasons where id = :'s')
  and :'sr'::jsonb -> 'closed' @> jsonb_build_array(jsonb_build_object('winner', :c::text, 'entries', :n2))
  and :'again_null'::boolean
  and (select count(*) from public.feed_items where actor_id = :c and kind = 'league_won') = 1
  and (select payload from public.feed_items where actor_id = :c and kind = 'league_won')
      = jsonb_build_object('week_start', (select week_start from public.league_seasons where id = :'s'),
                           'growth_bps', (select growth_bps from public.league_entries where season_id = :'s' and player_id = :c))
  and (select status = 'active' from public.league_seasons where week_start = public.league_week_start(public.game_now()))
  and exists (select 1 from public.league_entries e join public.league_seasons ls on ls.id = e.season_id
               where ls.week_start = public.league_week_start(public.game_now()) and e.player_id = :a),
  'social_run_due(): closes the due season (winner = rank 1, feed item league_won once), refreshes the current one');
select tests.assert(
  (select count(*) from public.notifications where type_key = 'league_result' and payload ->> 'week_start'
     = (select week_start::text from public.league_seasons where id = :'s')) = :n2
  and (select title from public.notifications where player_id = :c and type_key = 'league_result') = 'Du hast die Wochenliga gewonnen!'
  and (select title from public.notifications where player_id = :a and type_key = 'league_result') = 'Wochenliga: Platz 2'
  and (select body from public.notifications where player_id = :a and type_key = 'league_result')
      = 'Platz 2 von ' || :n2 || ' · ' || public.format_growth_bps((select growth_bps from public.league_entries where season_id = :'s' and player_id = :a))
  and (select link from public.notifications where player_id = :a and type_key = 'league_result') = '/friends',
  'league_result: every ranked participant is notified once ("Platz 2 von n · +x,xx %")');

select tests.login_as('authenticated', :a);
select public.get_league('all', 'last') as la2 \gset
select public.get_league('friends', 'current') as lc \gset
select public.get_player_card('Cem_Chance') as card_c \gset
select public.get_player_card('Lia_Liga') as card_a \gset
select public.get_player_card('Ben_Bilanz') as card_b \gset
reset role;
select tests.assert(
  :'la2'::jsonb #>> '{season,status}' = 'finished'
  and :'la2'::jsonb -> 'last_winner' = jsonb_build_object('nickname', 'Cem_Chance', 'tag', (select tag from public.profiles where id = :c),
                                                          'avatar_key', 'rookie',
                                                          'growth_bps', (select growth_bps from public.league_entries where season_id = :'s' and player_id = :c),
                                                          'week_start', (select week_start from public.league_seasons where id = :'s'))
  and :'lc'::jsonb #>> '{season,status}' = 'active'
  and (:'lc'::jsonb #>> '{season,week_start}')::date = public.league_week_start(public.game_now())
  and :'lc'::jsonb -> 'last_winner' = :'la2'::jsonb -> 'last_winner'
  and (select array_agg(x ->> 'nickname' order by x ->> 'nickname') from jsonb_array_elements(:'lc'::jsonb -> 'entries') x)
      = array['Ben_Bilanz', 'Lia_Liga']
  and :'lc'::jsonb -> 'me' is not null and :'lc'::jsonb -> 'me' <> 'null'::jsonb,
  'get_league: finished last week with last_winner; current week active with the same last_winner');
select tests.assert(
  :'card_c'::jsonb -> 'trophies' = '{"gold": 1, "silver": 0, "bronze": 0}'::jsonb
  and :'card_a'::jsonb -> 'trophies' = '{"gold": 0, "silver": 1, "bronze": 0}'::jsonb
  and :'card_b'::jsonb -> 'trophies' = '{"gold": 0, "silver": 0, "bronze": 0}'::jsonb,
  'get_player_card(): trophies {gold, silver, bronze} from finished seasons');
