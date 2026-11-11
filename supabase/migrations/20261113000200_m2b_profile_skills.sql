-- =============================================================================
-- NEXA · M2b · 0200 · Avatars, skills, daily rewards, player card
-- =============================================================================

-- ---------------------------------------------------------------------------
-- API errors (adds the M2b keys)
-- ---------------------------------------------------------------------------
create or replace function public.api_error(p_key text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
begin
  v_code := case p_key
    when 'insufficient_funds'        then 'NX001'
    when 'rate_limited'              then 'NX004'
    when 'forbidden'                 then 'NX006'
    when 'invalid_quantity'          then 'NX007'
    when 'invalid_price'             then 'NX007'
    when 'invalid_argument'          then 'NX007'
    when 'invalid_interval'          then 'NX007'
    when 'not_authenticated'         then 'NX010'
    when 'unknown_security'          then 'NX011'
    when 'not_tradable'              then 'NX012'
    when 'insufficient_position'     then 'NX013'
    when 'order_not_found'           then 'NX014'
    when 'order_not_open'            then 'NX015'
    when 'market_paused'             then 'NX016'
    when 'nothing_to_claim'          then 'NX017'
    when 'locked'                    then 'NX018'
    when 'name_too_short'            then 'NX019'
    when 'name_too_long'             then 'NX019'
    when 'name_invalid_chars'        then 'NX019'
    when 'name_profanity'            then 'NX019'
    when 'name_reserved'             then 'NX019'
    when 'name_taken'                then 'NX019'
    when 'name_change_too_soon'      then 'NX020'
    when 'order_too_small'           then 'NX021'
    when 'market_illiquid'           then 'NX022'
    when 'mission_not_found'         then 'NX023'
    when 'mission_not_completed'     then 'NX024'
    when 'mission_already_claimed'   then 'NX025'
    when 'avatar_unknown'            then 'NX026'
    when 'avatar_locked'             then 'NX027'
    when 'daily_reward_claimed'      then 'NX028'
    when 'skill_unknown'             then 'NX029'
    when 'skill_learned'             then 'NX030'
    when 'skill_locked'              then 'NX031'
    when 'skill_points_insufficient' then 'NX032'
    when 'job_not_found'             then 'NX033'
    when 'job_level_too_low'         then 'NX034'
    when 'job_skills_missing'        then 'NX035'
    when 'application_limit'         then 'NX036'
    when 'application_exists'        then 'NX037'
    when 'application_not_found'     then 'NX038'
    when 'application_not_offered'   then 'NX039'
    when 'offer_expired'             then 'NX040'
    when 'job_active_exists'         then 'NX041'
    when 'no_active_job'             then 'NX042'
    when 'raise_too_soon'            then 'NX043'
    when 'raise_too_high'            then 'NX044'
    when 'player_not_found'          then 'NX045'
    when 'employer_only'             then 'NX046'
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- Skills
-- ---------------------------------------------------------------------------
-- The 8 branches as a JSON object with 0 values (all keys always present).
create or replace function public.skill_branch_zero()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(b, 0), '{}'::jsonb)
    from (select distinct jsonb_array_elements_text(n -> 'branches') as b
            from jsonb_array_elements(coalesce(public.config_jsonb('skills', '{tree}'), '[]'::jsonb)) n) x;
$$;

create or replace function public.skill_node(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select n from jsonb_array_elements(coalesce(public.config_jsonb('skills', '{tree}'), '[]'::jsonb)) n
   where n ->> 'key' = p_key limit 1;
$$;

create or replace function public.skill_points_ensure(p_player uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.player_skill_points (player_id) values (p_player) on conflict (player_id) do nothing;
$$;

-- Branch score: sum of scoreByTier[tier] of the learned skills per branch (hybrids count for both).
create or replace function public.player_branch_scores(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.skill_branch_zero() || coalesce((
    select jsonb_object_agg(x.branch, x.score)
      from (select b.branch,
                   sum(coalesce((public.config_jsonb('skills', '{scoreByTier}') ->> ((n ->> 'tier')::integer - 1))::integer,
                                 (n ->> 'tier')::integer))::integer as score
              from public.player_skills ps
              join lateral (select public.skill_node(ps.skill_key) as n) nn on true
              cross join lateral jsonb_array_elements_text(nn.n -> 'branches') as b(branch)
             where ps.player_id = p_player and nn.n is not null
             group by b.branch) x), '{}'::jsonb);
$$;

-- get_my_skills() shape for a player
create or replace function public.skills_state(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zero  jsonb := public.skill_branch_zero();
  v_hours double precision := greatest(1, public.config_double('skills', '{workHoursPerBranchPoint}', 6));
  sp      public.player_skill_points;
begin
  select * into sp from public.player_skill_points where player_id = p_player;
  return jsonb_build_object(
    'free_points',     coalesce(sp.free_points, 0),
    'branch_points',   v_zero || coalesce(sp.branch_points, '{}'::jsonb),
    'branch_progress', (select coalesce(jsonb_object_agg(k.key,
                                 round(((coalesce((sp.branch_work_minutes ->> k.key)::numeric, 0) % (v_hours * 60)::numeric)
                                        / (v_hours * 60)::numeric), 3)), '{}'::jsonb)
                          from jsonb_each(v_zero) k),
    'branch_scores',   public.player_branch_scores(p_player),
    'learned',         coalesce((select jsonb_agg(jsonb_build_object('key', s.skill_key, 'learned_at', s.learned_at)
                                                  order by s.learned_at, s.skill_key)
                                   from public.player_skills s where s.player_id = p_player), '[]'::jsonb));
end;
$$;

create or replace function public.get_my_skills()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.skills_state(public.require_player());
end;
$$;

-- Learns a skill: requires all prerequisites; costByTier[tier] points, branch
-- points of the skill's branch(es) first (hybrids: the richer branch first), then free points.
create or replace function public.learn_skill(p_request_id uuid, p_skill_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_node   jsonb;
  v_cost   integer;
  v_left   integer;
  v_bp     jsonb;
  v_take   integer;
  sp       public.player_skill_points;
  b        record;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'learn_skill');
  if v_replay is not null then
    return v_replay;
  end if;
  v_node := public.skill_node(p_skill_key);
  if v_node is null then
    perform public.api_error('skill_unknown');
  end if;
  perform public.skill_points_ensure(v_player);
  select * into sp from public.player_skill_points where player_id = v_player for update;
  if exists (select 1 from public.player_skills s where s.player_id = v_player and s.skill_key = p_skill_key) then
    perform public.api_error('skill_learned');
  end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(v_node -> 'requires', '[]'::jsonb)) r(k)
              where not exists (select 1 from public.player_skills s where s.player_id = v_player and s.skill_key = r.k)) then
    perform public.api_error('skill_locked');
  end if;
  v_cost := coalesce((public.config_jsonb('skills', '{costByTier}') ->> ((v_node ->> 'tier')::integer - 1))::integer,
                     (v_node ->> 'tier')::integer);
  v_bp := coalesce(sp.branch_points, '{}'::jsonb);
  if (select coalesce(sum(coalesce((v_bp ->> x)::integer, 0)), 0) from jsonb_array_elements_text(v_node -> 'branches') x)
     + sp.free_points < v_cost then
    perform public.api_error('skill_points_insufficient');
  end if;
  v_left := v_cost;
  for b in
    select x as branch, coalesce((v_bp ->> x)::integer, 0) as pts
      from jsonb_array_elements_text(v_node -> 'branches') x order by 2 desc, 1
  loop
    exit when v_left = 0;
    v_take := least(v_left, b.pts);
    if v_take > 0 then
      v_bp := jsonb_set(v_bp, array[b.branch], to_jsonb(b.pts - v_take));
      v_left := v_left - v_take;
    end if;
  end loop;
  update public.player_skill_points
     set branch_points = v_bp, free_points = free_points - v_left
   where player_id = v_player;
  insert into public.player_skills (player_id, skill_key) values (v_player, p_skill_key);
  return public.request_complete(v_player, p_request_id,
    public.skills_state(v_player) || jsonb_build_object('learned_key', p_skill_key));
end;
$$;

-- grant_xp as in M1, plus skills.freePointsPerLevel free points per level gained.
create or replace function public.grant_xp(
  p_player     uuid,
  p_source     public.xp_source,
  p_base_xp    integer,
  p_dedupe_key text default null,
  p_ref_type   text default null,
  p_ref_id     uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prog   jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_mult   double precision := public.cfg_num(v_prog, '{xpMultiplier}', 2);
  v_day    date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_amount integer;
  v_cap    integer;
  v_count  integer;
  v_id     bigint;
  v_total  bigint;
  v_old    integer;
  v_level  integer;
begin
  if p_player is null or p_base_xp is null or p_base_xp <= 0 then
    return 0;
  end if;
  v_amount := greatest(0, round(p_base_xp * v_mult))::integer;
  if v_amount <= 0 then
    return 0;
  end if;

  if p_source = 'trade' then
    v_cap := public.cfg_num(v_prog, '{xpSources,trade,maxTradesPerDay}', 30)::integer;
    select c.event_count into v_count
      from public.xp_daily_counters c
     where c.player_id = p_player and c.game_day = v_day and c.source = p_source
       for update;
    if coalesce(v_count, 0) >= v_cap then
      return 0;
    end if;
  end if;

  insert into public.xp_events (player_id, source, amount, multiplier_bps, ref_type, ref_id, dedupe_key, game_day)
  values (p_player, p_source, v_amount, round(v_mult * 10000)::integer, p_ref_type, p_ref_id, p_dedupe_key, v_day)
  on conflict (player_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    return 0;
  end if;

  insert into public.xp_daily_counters as c (player_id, game_day, source, event_count, xp_sum)
  values (p_player, v_day, p_source, 1, v_amount)
  on conflict (player_id, game_day, source)
  do update set event_count = c.event_count + 1, xp_sum = c.xp_sum + excluded.xp_sum;

  select p.level into v_old from public.profiles p where p.id = p_player for update;
  update public.profiles p set xp_total = p.xp_total + v_amount where p.id = p_player
  returning p.xp_total into v_total;
  v_level := public.level_for_xp(v_total);
  update public.profiles p set level = v_level where p.id = p_player and p.level <> v_level;
  update public.xp_events e set level_after = v_level where e.id = v_id;

  if v_level > v_old then
    perform public.skill_points_ensure(p_player);
    update public.player_skill_points
       set free_points = free_points
                       + (v_level - v_old) * greatest(0, public.config_double('skills', '{freePointsPerLevel}', 1))::integer
     where player_id = p_player;
  end if;

  insert into public.player_unlocks (player_id, unlock_key)
  select p_player, u.key from public.unlocks u where u.level <= v_level
  on conflict do nothing;

  return v_amount;
end;
$$;

-- ---------------------------------------------------------------------------
-- Avatars
-- ---------------------------------------------------------------------------
create or replace function public.set_avatar(p_request_id uuid, p_avatar_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_level  integer;
  v_need   integer;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_avatar');
  if v_replay is not null then
    return v_replay;
  end if;
  select (x ->> 'level')::integer into v_need
    from jsonb_array_elements(coalesce(public.config_jsonb('avatars', '{portraits}'), '[]'::jsonb)) x
   where x ->> 'key' = p_avatar_key limit 1;
  if v_need is null then
    perform public.api_error('avatar_unknown');
  end if;
  select p.level into v_level from public.profiles p where p.id = v_player;
  if v_level < v_need then
    perform public.api_error('avatar_locked');
  end if;
  update public.profiles set avatar_key = p_avatar_key where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('avatar_key', p_avatar_key));
end;
$$;

-- Deterministic portrait for an AI tycoon (portraits up to level 25).
create or replace function public.tycoon_avatar_key(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select x.key
    from (select p ->> 'key' as key, row_number() over () - 1 as idx, count(*) over () as n
            from jsonb_array_elements(coalesce(public.config_jsonb('avatars', '{portraits}'), '[]'::jsonb)) p
           where (p ->> 'level')::integer <= 25) x
   where x.idx = abs(hashtext(p_id::text)::bigint) % x.n;
$$;

-- ---------------------------------------------------------------------------
-- Login streak (shared by daily_check_in, the daily reward, portfolio, card)
-- ---------------------------------------------------------------------------
create or replace function public.player_streak_days(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when ls.last_login_day >= d - 1 then ls.current_streak
                when ls.last_login_day = d - 2 and ls.freeze_tokens > 0 then ls.current_streak
                else 0 end
      from public.login_streaks ls,
           (select (public.game_now() at time zone 'Europe/Berlin')::date as d) t
     where ls.player_id = p_player), 0);
$$;

-- Pays up to p_amount from the treasury (before the genesis: the mint); returns what was paid.
create or replace function public.state_pay_partial(p_player uuid, p_amount bigint, p_kind public.ledger_tx_kind,
                                                     p_desc text, p_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay bigint;
begin
  if coalesce(p_amount, 0) <= 0 then
    return 0;
  end if;
  if public.money_genesis_done() then
    v_pay := least(p_amount, greatest(public.treasury_balance_cents(), 0));
  else
    v_pay := p_amount;
  end if;
  if v_pay > 0 then
    perform public.ledger_transfer(
      public.ledger_system_account(case when public.money_genesis_done() then 'treasury' else 'mint' end),
      public.ledger_player_account(p_player, 'player_cash'), v_pay, p_kind, p_desc, 'player', p_player, p_key, p_player);
  end if;
  return v_pay;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily rewards (7-day calendar, ADR-053)
-- ---------------------------------------------------------------------------
-- Cycle day that a claim today would get, and whether it needs the week's freeze.
create or replace function public.daily_reward_next(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today   date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_monday  date;
  ls        public.login_streaks;
  v_freezes integer;
  v_claimed boolean;
  v_day     integer;
  v_freeze  boolean := false;
begin
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  select * into ls from public.login_streaks where player_id = p_player;
  v_freezes := case when ls.freeze_granted_week is null or ls.freeze_granted_week < v_monday
                    then public.config_double('dailyRewards', '{freezesPerWeek}', 1)::integer
                    else coalesce(ls.freeze_tokens, 0) end;
  v_claimed := coalesce(ls.reward_last_day = v_today, false);
  if v_claimed then
    v_day := (coalesce(ls.reward_cycle_day, 0) % 7) + 1;           -- next one, tomorrow
  elsif ls.reward_last_day = v_today - 1 then
    v_day := (coalesce(ls.reward_cycle_day, 0) % 7) + 1;
  elsif ls.reward_last_day = v_today - 2
        and (v_freezes > 0 or exists (select 1 from public.daily_logins d
                                        where d.player_id = p_player and d.login_day = v_today and d.freeze_used)) then
    v_day := (coalesce(ls.reward_cycle_day, 0) % 7) + 1;
    v_freeze := not exists (select 1 from public.daily_logins d
                             where d.player_id = p_player and d.login_day = v_today and d.freeze_used);
  else
    v_day := 1;
  end if;
  return jsonb_build_object('day', v_day, 'claimable', not v_claimed, 'freeze_needed', v_freeze, 'freezes_left', v_freezes);
end;
$$;

create or replace function public.get_daily_reward()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_next   jsonb;
  v_mult   double precision := public.config_double('progression', '{xpMultiplier}', 2);
  v_today  date := (public.game_now() at time zone 'Europe/Berlin')::date;
begin
  v_player := public.require_player();
  v_next := public.daily_reward_next(v_player);
  return jsonb_build_object(
    'day',           (v_next ->> 'day')::integer,
    'claimable',     (v_next ->> 'claimable')::boolean,
    'streak_days',   public.player_streak_days(v_player),
    'freezes_left',  (v_next ->> 'freezes_left')::integer,
    'next_reset_at', ((v_today + 1)::timestamp) at time zone 'Europe/Berlin',
    'cycle',         coalesce((select jsonb_agg(jsonb_build_object(
                                 'day', o, 'xp', (c ->> 'xp')::integer, 'cash_cents', (c ->> 'cashCents')::bigint,
                                 'skill_points', (c ->> 'skillPoints')::integer,
                                 'xp_awarded', round((c ->> 'xp')::integer * v_mult)::integer) order by o)
                                 from jsonb_array_elements(coalesce(public.config_jsonb('dailyRewards', '{cycle}'), '[]'::jsonb))
                                      with ordinality as a(c, o)), '[]'::jsonb));
end;
$$;

-- Claims today's reward and performs the daily check-in (streak, mission event).
create or replace function public.claim_daily_reward(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  v_today   date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_monday  date;
  v_next    jsonb;
  v_day     integer;
  v_cell    jsonb;
  v_old_lvl integer;
  v_xp      integer;
  v_cash    bigint := 0;
  v_sp      integer;
  v_streak  integer;
  v_freeze  boolean;
  ls        public.login_streaks;
  v_prof    public.profiles;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'claim_daily_reward');
  if v_replay is not null then
    return v_replay;
  end if;
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  perform public.lock_player_accounts(v_player);
  insert into public.login_streaks (player_id) values (v_player) on conflict do nothing;
  select * into ls from public.login_streaks where player_id = v_player for update;
  if exists (select 1 from public.daily_reward_claims c where c.player_id = v_player and c.claim_day = v_today) then
    perform public.api_error('daily_reward_claimed');
  end if;

  v_next := public.daily_reward_next(v_player);
  v_day := (v_next ->> 'day')::integer;
  v_freeze := (v_next ->> 'freeze_needed')::boolean;
  if ls.freeze_granted_week is null or ls.freeze_granted_week < v_monday then
    ls.freeze_tokens := public.config_double('dailyRewards', '{freezesPerWeek}', 1)::smallint;
    ls.freeze_granted_week := v_monday;
  end if;

  -- daily check-in: streak and mission event (once per day, shared with daily_check_in)
  if ls.last_login_day is distinct from v_today then
    if ls.last_login_day = v_today - 1 then
      v_streak := ls.current_streak + 1;
    elsif ls.last_login_day = v_today - 2 and (v_freeze or ls.freeze_tokens > 0) then
      v_streak := ls.current_streak + 1;
      v_freeze := true;
    else
      v_streak := 1;
    end if;
    insert into public.daily_logins (player_id, login_day, streak_day, xp_awarded, freeze_used)
    values (v_player, v_today, v_streak, 0, v_freeze)
    on conflict do nothing;
    perform public.mission_event(v_player, 'check_in', 1, v_today::text);
  else
    v_streak := ls.current_streak;
  end if;
  if v_freeze then
    ls.freeze_tokens := greatest(0, ls.freeze_tokens - 1);
  end if;
  update public.login_streaks
     set current_streak = v_streak, longest_streak = greatest(longest_streak, v_streak), last_login_day = v_today,
         freeze_tokens = ls.freeze_tokens, freeze_granted_week = ls.freeze_granted_week,
         reward_cycle_day = v_day, reward_last_day = v_today
   where player_id = v_player;

  -- rewards of the cycle day
  v_cell := coalesce(public.config_jsonb('dailyRewards', '{cycle}'), '[]'::jsonb) -> (v_day - 1);
  select p.level into v_old_lvl from public.profiles p where p.id = v_player;
  v_xp := public.grant_xp(v_player, 'daily_login', coalesce((v_cell ->> 'xp')::integer, 0),
                          'daily_reward:' || v_today::text, 'daily_reward', null);
  v_cash := public.state_pay_partial(v_player, coalesce((v_cell ->> 'cashCents')::bigint, 0), 'login_bonus',
                                     'Tägliche Belohnung, Tag ' || v_day, 'daily_reward:' || v_player::text || ':' || v_today::text);
  v_sp := greatest(0, coalesce((v_cell ->> 'skillPoints')::integer, 0));
  if v_sp > 0 then
    perform public.skill_points_ensure(v_player);
    update public.player_skill_points set free_points = free_points + v_sp where player_id = v_player;
  end if;
  insert into public.daily_reward_claims (player_id, claim_day, cycle_day, xp_awarded, cash_cents, skill_points, freeze_used)
  values (v_player, v_today, v_day, v_xp, v_cash, v_sp, v_freeze);

  select * into v_prof from public.profiles where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'day', v_day, 'xp', v_xp, 'cash_cents', v_cash, 'skill_points', v_sp, 'streak_days', v_streak,
    'level', v_prof.level, 'xp_total', v_prof.xp_total, 'leveled_up', v_prof.level > v_old_lvl,
    'freeze_used', v_freeze));
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_mission: adds the template's free skill points
-- ---------------------------------------------------------------------------
create or replace function public.claim_mission(p_request_id uuid, p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  m        public.player_missions;
  v_xp     integer;
  v_sp     integer;
  v_prof   public.profiles;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'claim_mission');
  if v_replay is not null then
    return v_replay;
  end if;
  perform 1 from public.profiles p where p.id = v_player for update;
  select * into m from public.player_missions pm where pm.id = p_mission_id and pm.player_id = v_player for update;
  if m.id is null or m.status = 'expired' or (m.expires_at is not null and m.expires_at <= public.game_now()) then
    perform public.api_error('mission_not_found');
  end if;
  if m.status = 'claimed' then
    perform public.api_error('mission_already_claimed');
  end if;
  if m.status = 'active' then
    perform public.mission_refresh_state(v_player);
    select * into m from public.player_missions pm where pm.id = p_mission_id;
    if m.status <> 'completed' then
      perform public.api_error('mission_not_completed');
    end if;
  end if;
  update public.player_missions set status = 'claimed', claimed_at = now() where id = m.id;
  v_xp := public.grant_xp(v_player, 'mission', m.xp_reward, 'mission:' || m.id::text, 'mission', m.id);
  select coalesce(t.reward_skill_points, 0) into v_sp from public.mission_templates t where t.key = m.template_key;
  if v_sp > 0 then
    perform public.skill_points_ensure(v_player);
    update public.player_skill_points set free_points = free_points + v_sp where player_id = v_player;
  end if;
  if m.kind = 'quick' or m.kind = 'milestone' then
    perform public.missions_assign(v_player);
  end if;
  select * into v_prof from public.profiles where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'xp_awarded', v_xp, 'level', v_prof.level, 'xp_total', v_prof.xp_total, 'skill_points', coalesce(v_sp, 0)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Player card (public, any authenticated player)
-- ---------------------------------------------------------------------------
create or replace function public.get_player_card(p_nickname text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p      public.profiles;
  v_job  jsonb;
begin
  perform public.require_player();
  select * into p from public.profiles x where lower(x.nickname) = lower(btrim(coalesce(p_nickname, ''))) and not x.is_deactivated;
  if p.id is null then
    perform public.api_error('player_not_found');
  end if;
  select jsonb_build_object('company_name', c.name, 'title_key', j.title_key, 'title', case when j.title_key is null then j.title end,
                            'tier', j.tier, 'since', j.started_at)
    into v_job
    from public.player_jobs j join public.companies c on c.id = j.company_id
   where j.player_id = p.id and j.status = 'active';
  return jsonb_build_object(
    'nickname',        p.nickname,
    'avatar_key',      p.avatar_key,
    'level',           p.level,
    'rank',            public.player_rich_rank(p.id),
    'net_worth_cents', public.player_net_worth_cents(p.id),
    'streak_days',     public.player_streak_days(p.id),
    'skills_learned',  (select count(*) from public.player_skills s where s.player_id = p.id)::integer,
    'branch_scores',   public.player_branch_scores(p.id),
    'top_skills',      coalesce((select jsonb_agg(jsonb_build_object('key', x.skill_key, 'tier', x.tier) order by x.tier desc, x.learned_at)
                                   from (select s.skill_key, s.learned_at, (public.skill_node(s.skill_key) ->> 'tier')::integer as tier
                                           from public.player_skills s where s.player_id = p.id
                                          order by 3 desc nulls last, s.learned_at limit 3) x), '[]'::jsonb),
    'job',             v_job,
    'company',         null,
    'member_since',    p.created_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.api_error(text)', 'public.skill_branch_zero()', 'public.skill_node(text)', 'public.skill_points_ensure(uuid)',
    'public.player_branch_scores(uuid)', 'public.skills_state(uuid)', 'public.get_my_skills()', 'public.learn_skill(uuid, text)',
    'public.grant_xp(uuid, public.xp_source, integer, text, text, uuid)', 'public.set_avatar(uuid, text)',
    'public.tycoon_avatar_key(uuid)', 'public.player_streak_days(uuid)',
    'public.state_pay_partial(uuid, bigint, public.ledger_tx_kind, text, text)', 'public.daily_reward_next(uuid)',
    'public.get_daily_reward()', 'public.claim_daily_reward(uuid)', 'public.claim_mission(uuid, uuid)',
    'public.get_player_card(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.get_my_skills() to authenticated;
  grant execute on function public.learn_skill(uuid, text) to authenticated;
  grant execute on function public.set_avatar(uuid, text) to authenticated;
  grant execute on function public.get_daily_reward() to authenticated;
  grant execute on function public.claim_daily_reward(uuid) to authenticated;
  grant execute on function public.claim_mission(uuid, uuid) to authenticated;
  grant execute on function public.get_player_card(text) to authenticated;
end;
$$;
