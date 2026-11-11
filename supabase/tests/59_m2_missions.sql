-- =============================================================================
-- 59 · M2 missions (quick, daily, weekly, milestone), daily check-in, events
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set x '''0f1f1f1f-0000-4000-8000-00000000001f'''
select tests.signup(:x, 'Xaver') is not null as ok \gset
update public.sim_runtime set is_paused = false;

select tests.assert(
  (select count(*) from public.mission_templates where mode is not null) >= 50
  and (select count(*) from public.mission_templates where mode is not null and kind = 'milestone') >= 25,
  'mission templates: ' || (select string_agg(kind || ' ' || n, ', ') from (select kind, count(*) n from public.mission_templates
                                                                         where mode is not null group by kind) k));

-- assignment ---------------------------------------------------------------------------
select tests.login_as('authenticated', :x);
select public.get_my_missions() as g1 \gset
select public.get_my_missions() as g2 \gset
reset role;
select tests.assert(
  (select array_agg(g ->> 'kind' order by o) from jsonb_array_elements(:'g1'::jsonb -> 'groups') with ordinality a(g, o))
    = array['quick', 'daily', 'weekly', 'milestone']
  and (select bool_and(jsonb_array_length(g -> 'missions') = 3) from jsonb_array_elements(:'g1'::jsonb -> 'groups') g)
  and (select bool_and(m ?& array['id', 'key', 'title', 'description', 'progress', 'target', 'xp', 'status', 'expires_at'])
         from jsonb_array_elements(:'g1'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m)
  and (select bool_and((g ->> 'resets_at') is not null) = true from jsonb_array_elements(:'g1'::jsonb -> 'groups') g
        where g ->> 'kind' in ('daily', 'weekly')),
  'get_my_missions(): 3 quick, 3 daily, 3 weekly, 3 milestones with every field; daily/weekly reset times');
select tests.assert(
  (select array_agg(m ->> 'id' order by m ->> 'id') from jsonb_array_elements(:'g1'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m)
  = (select array_agg(m ->> 'id' order by m ->> 'id') from jsonb_array_elements(:'g2'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m),
  'assignment is idempotent (second call returns the same missions)');
select tests.assert(
  (select array_agg(m ->> 'key' order by m ->> 'key') from jsonb_array_elements(:'g1'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m
    where g ->> 'kind' = 'milestone') = array['m_first_profit', 'm_first_trade', 'm_first_vault'],
  'the first three milestones of the story chain are visible');
select tests.assert(true, 'sample: ' || string_agg(m ->> 'title' || ' (' || (m ->> 'xp') || ' XP)', '; '))
  from jsonb_array_elements(:'g1'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m where g ->> 'kind' in ('quick', 'daily');

-- locked features are never offered (many level-1 players)
do $$
declare
  i integer;
  v uuid;
begin
  for i in 1..12 loop
    v := tests.signup(gen_random_uuid(), 'Mission_' || i);
    perform public.missions_assign(v);
  end loop;
end;
$$;
select tests.assert(
  not exists (select 1 from public.player_missions m join public.mission_templates t on t.key = m.template_key
                join public.profiles p on p.id = m.player_id
               where t.params ? 'unlock' and p.level < public.unlock_level(t.params ->> 'unlock')),
  'locked features (limit orders, bonds) are never offered below their unlock level (' ||
  (select count(*) from public.player_missions) || ' missions checked)');

-- progress from a trade, claim once -----------------------------------------------------
select m.id as m_trade from public.player_missions m where m.player_id = :x and m.template_key = 'm_first_trade' \gset
select gen_random_uuid() as rq \gset
select tests.login_as('authenticated', :x);
select tests.throws_key(format('select public.claim_mission(gen_random_uuid(), %L)', :'m_trade'), 'mission_not_completed', 'claiming before completion');
select public.place_order(gen_random_uuid(), 'BRZ', 'buy', 'market', 3000000) is not null as ok \gset
select public.get_my_portfolio() as pf \gset
select public.claim_mission(:'rq', :'m_trade') as c1 \gset
select public.claim_mission(:'rq', :'m_trade') as c1b \gset
select tests.throws_key(format('select public.claim_mission(gen_random_uuid(), %L)', :'m_trade'), 'mission_already_claimed', 'claiming twice');
select tests.throws_key($$select public.claim_mission(gen_random_uuid(), gen_random_uuid())$$, 'mission_not_found', 'unknown mission');
select public.get_my_missions() as g3 \gset
reset role;
select tests.assert((:'pf'::jsonb ->> 'missions_claimable')::int >= 1, 'get_my_portfolio(): missions_claimable after the first trade');
select tests.assert(
  (:'c1'::jsonb ->> 'xp_awarded')::int = 200 and :'c1b'::jsonb = :'c1'::jsonb
  and (select status from public.player_missions where id = :'m_trade') = 'claimed',
  'a trade completes "Dein erster Trade"; claim_mission() pays 100 x 2 = 200 XP once (replay safe)');
select tests.assert(
  (select count(*) from jsonb_array_elements(:'g3'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m
    where g ->> 'kind' = 'milestone' and m ->> 'status' in ('active', 'completed')) = 3
  and exists (select 1 from jsonb_array_elements(:'g3'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m
               where g ->> 'kind' = 'milestone' and m ->> 'key' = 'm_three_sectors'),
  'the next milestone of the chain becomes visible after a claim');

-- a claimed quick mission is replaced immediately
update public.player_missions set progress = target, status = 'completed', completed_at = now()
 where id = (select id from public.player_missions where player_id = :x and kind = 'quick' and status = 'active' limit 1);
select id as m_quick from public.player_missions where player_id = :x and kind = 'quick' and status = 'completed' limit 1 \gset
select tests.login_as('authenticated', :x);
select public.claim_mission(gen_random_uuid(), :'m_quick') as c2 \gset
reset role;
select tests.assert(
  (:'c2'::jsonb ->> 'xp_awarded')::int > 0
  and (select count(*) from public.player_missions where player_id = :x and kind = 'quick' and status in ('active', 'completed')) = 3,
  'claiming a quick mission assigns a new one right away (still 3 open)');

-- client events ----------------------------------------------------------------------------
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward)
values (:x, 'q_view', 'quick', date '1999-01-01', 3, 20);
select tests.login_as('authenticated', :x);
select public.track_event('view_security', 'KLS') = '{"ok": true}'::jsonb and public.track_event('view_security', 'KLS') is not null
   and public.track_event('view_security', 'PXW') is not null and public.track_event('view_security', 'NOPE') is not null as ok \gset
select tests.throws_key($$select public.track_event('buy_everything')$$, 'invalid_argument', 'only whitelisted client events');
reset role;
select tests.assert(
  (select progress from public.player_missions where player_id = :x and template_key = 'q_view' and period_start = date '1999-01-01') = 2,
  'track_event(view_security): distinct known tickers count (KLS, KLS, PXW, NOPE -> 2)');

-- daily check-in and streak ------------------------------------------------------------------
select tests.login_as('authenticated', :x);
select public.daily_check_in(gen_random_uuid()) as d1 \gset
select public.daily_check_in(gen_random_uuid()) as d2 \gset
reset role;
select tests.assert(
  (:'d1'::jsonb ->> 'xp_awarded')::int = 100 and (:'d1'::jsonb ->> 'streak_days')::int = 1
  and not (:'d1'::jsonb ->> 'already_checked_in')::boolean
  and (:'d2'::jsonb ->> 'xp_awarded')::int = 0 and (:'d2'::jsonb ->> 'already_checked_in')::boolean,
  'daily_check_in(): 50 x 2 = 100 XP once per Berlin day');

create or replace function tests.reset_check_in(p_player uuid, p_last date, p_streak integer, p_freeze smallint) returns void language sql as $$
  delete from public.daily_logins where player_id = p_player and login_day = (public.game_now() at time zone 'Europe/Berlin')::date;
  delete from public.xp_events where player_id = p_player and dedupe_key = 'login:' || (public.game_now() at time zone 'Europe/Berlin')::date;
  update public.login_streaks set last_login_day = p_last, current_streak = p_streak, freeze_tokens = p_freeze,
         freeze_granted_week = (public.game_now() at time zone 'Europe/Berlin')::date
                               - (extract(isodow from (public.game_now() at time zone 'Europe/Berlin')::date)::integer - 1)
   where player_id = p_player $$;
select current_date as today \gset
select (public.game_now() at time zone 'Europe/Berlin')::date as bday \gset
select tests.reset_check_in(:x, (:'bday'::date - 1), 4, 0::smallint);
select tests.login_as('authenticated', :x);
select public.daily_check_in(gen_random_uuid()) as d3 \gset
reset role;
select tests.reset_check_in(:x, (:'bday'::date - 3), 7, 0::smallint);
select tests.login_as('authenticated', :x);
select public.daily_check_in(gen_random_uuid()) as d4 \gset
reset role;
select tests.reset_check_in(:x, (:'bday'::date - 2), 9, 1::smallint);
select tests.login_as('authenticated', :x);
select public.daily_check_in(gen_random_uuid()) as d5 \gset
select public.get_my_portfolio() as pf2 \gset
reset role;
select tests.assert(
  (:'d3'::jsonb ->> 'streak_days')::int = 5 and (:'d3'::jsonb ->> 'xp_awarded')::int = 180,
  'streak continues after yesterday: day 5, (50 + 4 x 10) x 2 = 180 XP');
select tests.assert((:'d4'::jsonb ->> 'streak_days')::int = 1, 'streak breaks after two missed days without a freeze');
select tests.assert(
  (:'d5'::jsonb ->> 'streak_days')::int = 10 and (:'d5'::jsonb ->> 'freeze_used')::boolean
  and (:'pf2'::jsonb ->> 'streak_days')::int = 10,
  'one missed day is bridged by the weekly streak freeze; portfolio shows streak_days');
