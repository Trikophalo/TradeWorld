-- =============================================================================
-- e1 · Lower level curve, mission variety, no repeats, never impossible, daily skip (ADR-202)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set n '''e1a20202-0000-4000-8000-0000000000a1'''
\set m '''e1a20202-0000-4000-8000-0000000000b1'''
\set l '''e1a20202-0000-4000-8000-0000000000c1'''
\set s '''e1a20202-0000-4000-8000-0000000000d1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:n, 'Neu_Nora') is not null and tests.signup(:m, 'Mitte_Mats') is not null
   and tests.signup(:l, 'Kurve_Lea') is not null and tests.signup(:s, 'Skip_Sami') is not null as ok \gset

-- every open mission of a player passes the checks of the draw
create or replace function tests.e1_impossible(p_player uuid) returns text language sql as $$
  select string_agg(m.template_key, ', ')
    from public.player_missions m join public.mission_templates t on t.key = m.template_key
    join public.profiles p on p.id = m.player_id
   where m.player_id = p_player and m.status = 'active' and t.mode <> 'state'
     and (t.min_level > p.level
          or (t.params ? 'unlock' and p.level < public.unlock_level(t.params ->> 'unlock'))
          or not public.mission_requirement_ok(p_player, t.params ->> 'requires')
          or (m.progress = 0 and not public.mission_doable(p_player, t.key, t.metric)));
$$;
-- every draw is logged (a quick mission drawn again the same day replaces its finished row)
create table if not exists tests.e1_log (player_id uuid, kind text, template_key text, draw_seq bigint, primary key (player_id, draw_seq));
create or replace function tests.e1_note(p_player uuid) returns void language sql as $$
  insert into tests.e1_log (player_id, kind, template_key, draw_seq)
  select m.player_id, m.kind, m.template_key, m.draw_seq from public.player_missions m
   where m.player_id = p_player and m.draw_seq is not null
  on conflict do nothing;
$$;
-- repeats: the same key twice among `p_window` consecutive draws of a kind
create or replace function tests.e1_repeats(p_player uuid, p_kind text, p_window integer) returns integer language sql as $$
  with d as (select l.template_key, row_number() over (order by l.draw_seq) as rn
               from tests.e1_log l where l.player_id = p_player and l.kind = p_kind)
  select count(*)::integer from d a join d b on b.template_key = a.template_key and b.rn > a.rn and b.rn - a.rn < p_window;
$$;
create or replace function tests.e1_draws(p_player uuid, p_kind text) returns integer language sql as $$
  select count(*)::integer from tests.e1_log l where l.player_id = p_player and l.kind = p_kind;
$$;
create or replace function tests.e1_distinct(p_player uuid, p_kind text) returns integer language sql as $$
  select count(distinct l.template_key)::integer from tests.e1_log l where l.player_id = p_player and l.kind = p_kind;
$$;
grant execute on all functions in schema tests to public;

-- ---------------------------------------------------------------------------
-- A. The curve: 20 % less XP per level from level 2 on, nobody loses a level
-- ---------------------------------------------------------------------------
select tests.assert(
  public.xp_for_next_level(1) = 100 and public.xp_for_next_level(10) = 6325 and public.xp_for_next_level(30) = 32863
  and public.xp_total_for_level(2) = 100,
  'xp_for_next_level(): firstLevelXp 100, then round(200 x level^1.5) (ADR-202)');
select tests.assert(
  not exists (select 1 from generate_series(2, 120) g(lv)
               where public.xp_total_for_level(g.lv)
                     > 100 + (select coalesce(sum(round(250 * power(k, 1.5))), 0) from generate_series(2, g.lv - 1) k)),
  'every level needs at most as much total XP as under the old curve (levels only go up)');
-- a player who had level 10 with the XP of the old level 12 climbs; one above his XP keeps his level
select tests.set_level(:l, 10);
update public.profiles
   set xp_total = 100 + (select sum(round(250 * power(k, 1.5)))::bigint from generate_series(2, 11) k)
 where id = :l;
select tests.set_level(:s, 20);
update public.profiles set xp_total = 50 where id = :s;
select coalesce((select free_points from public.player_skill_points where player_id = :l), 0) as pts0 \gset
select public.raise_levels_after_curve_change() >= 1 as ok \gset
select tests.assert(
  (select level from public.profiles where id = :l) = public.level_for_xp((select xp_total from public.profiles where id = :l))
  and (select level from public.profiles where id = :l) >= 12
  and (select free_points from public.player_skill_points where player_id = :l) >= :pts0 + 2
  and exists (select 1 from public.player_unlocks u where u.player_id = :l and u.unlock_key = 'leverage_2x')
  and (select level from public.profiles where id = :s) = 20,
  'raise_levels_after_curve_change(): lifts to the level of the XP with skill points and unlocks, never lowers');
select public.raise_levels_after_curve_change() as again \gset
select tests.assert(:again = 0, 'raise_levels_after_curve_change() is idempotent');
select tests.set_level(:s, 1);

-- ---------------------------------------------------------------------------
-- B. A fresh level-1 player: many draws, no repeats, nothing impossible
-- ---------------------------------------------------------------------------
select public.missions_assign(:n) is not null as ok \gset
select tests.e1_note(:n);
select tests.assert(tests.e1_impossible(:n) is null, 'level 1: every first mission is doable, got ' || coalesce(tests.e1_impossible(:n), '-'));

-- 40 rounds of claiming the quick missions; every round has to stay doable
do $$
declare
  i   integer;
  bad text;
begin
  for i in 1 .. 40 loop
    update public.player_missions set status = 'claimed', claimed_at = now(), progress = target
     where player_id = 'e1a20202-0000-4000-8000-0000000000a1' and kind = 'quick' and status = 'active';
    perform public.missions_assign('e1a20202-0000-4000-8000-0000000000a1');
    perform tests.e1_note('e1a20202-0000-4000-8000-0000000000a1');
    bad := tests.e1_impossible('e1a20202-0000-4000-8000-0000000000a1');
    if bad is not null then
      raise exception 'level 1, round %: impossible missions %', i, bad;
    end if;
  end loop;
end;
$$;
select tests.e1_draws(:n, 'quick') as nq, tests.e1_distinct(:n, 'quick') as nqd \gset
select tests.assert(
  :nq >= 120 and tests.e1_repeats(:n, 'quick', 13) = 0
  and (select count(*) from public.player_missions where player_id = :n and kind = 'quick' and status = 'active') = 3,
  format('level 1: %s quick draws (%s different), none twice within 12 draws', :nq, :nqd));

-- 12 days of daily missions (game time moves on): no daily mission twice within 3 days (9 draws)
do $$
declare
  d     integer;
  v_off interval;
begin
  select coalesce(r.time_offset, interval '0') into v_off from public.sim_runtime r;
  for d in 1 .. 12 loop
    update public.sim_runtime set time_offset = v_off + make_interval(days => d);
    perform public.missions_assign('e1a20202-0000-4000-8000-0000000000a1');
    perform tests.e1_note('e1a20202-0000-4000-8000-0000000000a1');
    if tests.e1_impossible('e1a20202-0000-4000-8000-0000000000a1') is not null then
      raise exception 'level 1, day %: impossible missions %', d, tests.e1_impossible('e1a20202-0000-4000-8000-0000000000a1');
    end if;
  end loop;
  update public.sim_runtime set time_offset = v_off;
end;
$$;
select tests.assert(
  tests.e1_draws(:n, 'daily') >= 36
  and tests.e1_repeats(:n, 'daily', 10) = 0,
  'level 1: 12 days of daily missions, none twice within 9 draws');
-- the open board has no two missions counting the same thing while others are doable
select tests.assert(
  (select count(*) = count(distinct t.metric) from public.player_missions m join public.mission_templates t on t.key = m.template_key
    where m.player_id = :n and m.status = 'active' and m.kind = 'quick'),
  'level 1: the open quick missions count different things');

-- ---------------------------------------------------------------------------
-- C. A mid player (level 16, company, money): many draws, nothing impossible, the new features show up
-- ---------------------------------------------------------------------------
select tests.set_level(:m, 16);
select tests.fund(:m, 50000000, 'test:e1:m');
select tests.login_as('authenticated', :m);
select public.found_company(gen_random_uuid(), 'Mitte Werkstatt', 'Alles aus einer Hand', 'tech', '#336699', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:m) as mco \gset
select public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(:'mco'), 5000000,
                              'transfer', 'Test', 'company', :'mco', 'test:e1:mco') is not null as ok \gset
do $$
declare
  i   integer;
  bad text;
begin
  for i in 1 .. 40 loop
    update public.player_missions set status = 'claimed', claimed_at = now(), progress = target
     where player_id = 'e1a20202-0000-4000-8000-0000000000b1' and kind = 'quick' and status = 'active';
    perform public.missions_assign('e1a20202-0000-4000-8000-0000000000b1');
    perform tests.e1_note('e1a20202-0000-4000-8000-0000000000b1');
    bad := tests.e1_impossible('e1a20202-0000-4000-8000-0000000000b1');
    if bad is not null then
      raise exception 'level 16, round %: impossible missions %', i, bad;
    end if;
  end loop;
end;
$$;
select tests.e1_draws(:m, 'quick') as mq, tests.e1_distinct(:m, 'quick') as mqd \gset
select tests.assert(
  tests.e1_repeats(:m, 'quick', 13) = 0 and :mqd >= 40
  and exists (select 1 from public.player_missions m join public.mission_templates t on t.key = m.template_key
               where m.player_id = :m and t.params ? 'unlock'),
  format('level 16: %s quick draws over %s templates, none twice within 12, feature missions among them', :mq, :mqd));

-- fixedCount keeps a count: the Nexamon packs of a day stay 2 to 3 even at level 30
select tests.set_level(:m, 30);
update public.player_missions set status = 'expired', reset_at = public.game_now() - interval '1 day'
 where player_id = :m and kind = 'daily';
-- (no other open mission may count packs or trades, else the draw prefers something else)
update public.mission_templates set is_active = false
 where metric in ('nexamon_pack', 'trade') and key not in ('d_nexamon_packs', 'd_trades');
update public.player_missions m set status = 'claimed', claimed_at = now()
  from public.mission_templates t
 where t.key = m.template_key and m.player_id = :m and m.status in ('active', 'completed') and t.metric in ('nexamon_pack', 'trade');
update public.mission_templates set weight = 1000000 where key in ('d_nexamon_packs', 'd_trades');
select public.missions_assign(:m) is not null as ok \gset
update public.mission_templates set weight = 40 where key = 'd_nexamon_packs';
update public.mission_templates set weight = 100 where key = 'd_trades';
update public.mission_templates set is_active = true where metric in ('nexamon_pack', 'trade') and mode is not null;
select tests.assert(
  (select target between 2 and 3 from public.player_missions where player_id = :m and template_key = 'd_nexamon_packs'
     and period_start = (public.game_now() at time zone 'Europe/Berlin')::date)
  and (select target > 5 from public.player_missions where player_id = :m and template_key = 'd_trades'
         and period_start = (public.game_now() at time zone 'Europe/Berlin')::date),
  'fixedCount: Nexamon packs keep their count at level 30, trades scale with the level');

-- ---------------------------------------------------------------------------
-- D. Impossible missions are replaced: a company mission without a company, a job mission without a job
-- ---------------------------------------------------------------------------
delete from public.player_missions where player_id = :n and kind in ('quick', 'daily') and status = 'active'
   and (period_start = (public.game_now() at time zone 'Europe/Berlin')::date or kind = 'quick');
insert into public.player_missions (player_id, template_key, kind, period_start, target, progress, xp_reward, draw_seq, drawn_at)
values (:n, 'q_campaign', 'quick', (public.game_now() at time zone 'Europe/Berlin')::date, 1, 0, 50, nextval('public.player_missions_draw_seq'), public.game_now()),
       (:n, 'd_work_tasks', 'daily', (public.game_now() at time zone 'Europe/Berlin')::date, 3, 1, 300, nextval('public.player_missions_draw_seq'), public.game_now())
on conflict (player_id, template_key, period_start) do update set status = 'active', progress = excluded.progress, reset_at = null;
select public.missions_assign(:n) is not null as ok \gset
select tests.assert(
  (select status = 'expired' and reset_at is not null and (state ->> 'replaced')::boolean from public.player_missions
    where player_id = :n and template_key = 'q_campaign' and period_start = (public.game_now() at time zone 'Europe/Berlin')::date)
  and (select status = 'expired' and (state ->> 'replaced')::boolean from public.player_missions
        where player_id = :n and template_key = 'd_work_tasks' and period_start = (public.game_now() at time zone 'Europe/Berlin')::date)
  and (select count(*) from public.player_missions where player_id = :n and kind = 'quick' and status in ('active', 'completed')) = 3
  and (select count(*) from public.player_missions where player_id = :n and kind = 'daily' and reset_at is null
         and period_start = (public.game_now() at time zone 'Europe/Berlin')::date) = 3
  and tests.e1_impossible(:n) is null,
  'missions_assign(): a company mission without a company and a job mission without a job (even with progress) are replaced');

-- ---------------------------------------------------------------------------
-- E. skip_mission(): once per Berlin day, free, only open quick/daily/weekly missions
-- ---------------------------------------------------------------------------
\set rq '''e1a20202-0000-4000-8000-00000000ee01'''
select tests.login_as('anon');
select tests.throws($$select public.skip_mission(gen_random_uuid(), gen_random_uuid())$$, '42501', 'anon: skip_mission');
reset role;
select tests.login_as('authenticated', :n);
select public.get_my_missions() as g0 \gset
select (select (x ->> 'id') from jsonb_array_elements(:'g0'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') x
         where g ->> 'kind' = 'quick' and x ->> 'status' = 'active' limit 1) as skip_id,
       (select (x ->> 'key') from jsonb_array_elements(:'g0'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') x
         where g ->> 'kind' = 'quick' and x ->> 'status' = 'active' limit 1) as skip_key,
       (select (x ->> 'id') from jsonb_array_elements(:'g0'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') x
         where g ->> 'kind' = 'milestone' limit 1) as mile_id \gset
select tests.throws_key(format('select public.skip_mission(gen_random_uuid(), %L)', :'mile_id'), 'mission_skip_invalid', 'a milestone cannot be skipped');
select tests.throws_key('select public.skip_mission(gen_random_uuid(), gen_random_uuid())', 'mission_not_found', 'an unknown mission cannot be skipped');
select public.skip_mission(:rq, :'skip_id') as s1 \gset
select public.skip_mission(:rq, :'skip_id') as s1b \gset
select tests.throws_key(format('select public.skip_mission(gen_random_uuid(), %L)',
                           (select (x ->> 'id') from jsonb_array_elements(:'s1'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') x
                             where g ->> 'kind' = 'quick' and x ->> 'status' = 'active' limit 1)),
                    'mission_skip_used', 'the second skip of the day is refused');
reset role;
select tests.assert(
  (:'g0'::jsonb ->> 'skip_available')::boolean and (:'g0'::jsonb ->> 'skips_left')::integer = 1
  and (:'g0'::jsonb ->> 'next_skip_at') is null
  and not (:'s1'::jsonb ->> 'skip_available')::boolean and (:'s1'::jsonb ->> 'skips_left')::integer = 0
  and (:'s1'::jsonb ->> 'next_skip_at') is not null and :'s1'::jsonb ->> 'skipped' = :'skip_key'
  and :'s1'::jsonb = :'s1b'::jsonb
  and (:'s1'::jsonb ->> 'reset_available')::boolean
  and (select jsonb_array_length(g -> 'missions') from jsonb_array_elements(:'s1'::jsonb -> 'groups') g where g ->> 'kind' = 'quick') = 3
  and not exists (select 1 from jsonb_array_elements(:'s1'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') x
                   where x ->> 'id' = :'skip_id')
  and (select status = 'expired' and (state ->> 'skipped')::boolean from public.player_missions where id = :'skip_id'::uuid),
  'skip_mission(): one free skip a day, a new mission takes the place, the daily reset stays, idempotent by request id');

-- ---------------------------------------------------------------------------
-- F. New metrics count through triggers
-- ---------------------------------------------------------------------------
select tests.set_level(:n, 5);
delete from public.player_missions where player_id = :n and template_key in ('q_watchlist', 'q_upgrade', 'q_feed_react');
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward)
values (:n, 'q_watchlist', 'quick', (public.game_now() at time zone 'Europe/Berlin')::date, 1, 20),
       (:n, 'q_upgrade', 'quick', (public.game_now() at time zone 'Europe/Berlin')::date, 1, 50);
insert into public.watchlist_items (player_id, security_id, sort_order)
select :n, s.id, 99 from public.securities s
 where s.kind = 'stock' and not exists (select 1 from public.watchlist_items w where w.player_id = :n and w.security_id = s.id)
 limit 1;
insert into public.player_upgrades (player_id, key, level) values (:n, 'trader', 1)
on conflict (player_id, key) do update set level = public.player_upgrades.level + 1;
select tests.assert(
  (select status = 'completed' from public.player_missions where player_id = :n and template_key = 'q_watchlist'
     and period_start = (public.game_now() at time zone 'Europe/Berlin')::date)
  and (select status = 'completed' from public.player_missions where player_id = :n and template_key = 'q_upgrade'
         and period_start = (public.game_now() at time zone 'Europe/Berlin')::date),
  'watchlist and upgrade missions count through their triggers');
delete from public.player_upgrades where player_id = :n and key = 'trader';

-- the catalogue: many more templates, every metric of ADR-202 in use
select tests.assert(
  (select count(*) from public.mission_templates where is_active and mode is not null) >= 290
  and (select count(distinct metric) from public.mission_templates
        where is_active and metric in ('crypto_trade', 'crypto_buy', 'crypto_distinct', 'crypto_created', 'short_opened',
                                       'watchlist_add', 'nexamon_quick_sold', 'nexamon_grading_sent', 'pack_battle_join',
                                       'news_promo', 'campaign_started', 'company_skill', 'upgrade_bought', 'work_task_done',
                                       'daily_reward', 'feed_react', 'art_painted', 'nexamon_bought', 'nexamon_listed')) = 19,
  'mission catalogue: the new metrics all have templates');

-- a promotion mission only while a free-NFT promotion runs
select tests.assert(
  public.mission_doable(:n, 'q_news_promo', 'news_promo')
    = exists (select 1 from public.news_promos x where x.kind = 'free_nft' and x.starts_at <= public.game_now()
                and x.ends_at > public.game_now() + interval '5 minutes'
                and not exists (select 1 from public.news_promo_claims c where c.promo_id = x.id and c.player_id = :n)),
  'q_news_promo: only while a free-NFT promotion runs that the player has not used');
