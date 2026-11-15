-- =============================================================================
-- NEXA · 2700 · Missions are always doable; one-off mission: buy a property (ADR-154)
-- =============================================================================
-- mission_doable(player, key, metric) says whether a mission can still be finished by this player. missions_assign()
-- hands out only doable missions, and an active quick or milestone mission without progress that became impossible
-- (company full, home already bought) expires and makes room for another one.
-- m_home_first becomes "Kauf dir ein Grundstück": once, fixed 2500 base XP (5000 with the global multiplier),
-- shown first among the milestones once property is unlocked.
-- Idempotent: runs unchanged as supabase/updates/20261204002700_missions_doable.sql.

create or replace function public.mission_doable(p_player uuid, p_key text, p_metric text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with co as (
    select pc.company_id, pc.ai_workers, c.max_employees, public.company_headcount(pc.company_id) as heads
      from public.player_companies pc join public.companies c on c.id = pc.company_id
     where pc.founder_id = p_player and pc.status = 'active'
     limit 1
  ), home as (
    select h.tier, coalesce((select (t ->> 'garageSlots')::integer
                               from jsonb_array_elements(public.config_jsonb('property', '{tiers}')) t
                              where t ->> 'key' = h.tier), 0) as garage,
           (select max(ord) from jsonb_array_elements(public.config_jsonb('property', '{tiers}')) with ordinality x(t, ord)) as top,
           (select ord from jsonb_array_elements(public.config_jsonb('property', '{tiers}')) with ordinality x(t, ord)
             where t ->> 'key' = h.tier) as pos
      from public.player_homes h where h.player_id = p_player
  )
  select case
    -- hiring needs a free place in the company; the "first" one only for who never had an AI worker
    when p_metric = 'ai_worker_hired' then
      exists (select 1 from co where co.heads < co.max_employees
                                 and (p_key <> 'm_first_ai_worker' or co.ai_workers = 0))
    when p_metric = 'job_posted' then
      exists (select 1 from co where co.heads < co.max_employees
                                 and (p_key <> 'm_first_posting'
                                      or not exists (select 1 from public.job_postings j where j.company_id = co.company_id)))
    -- property: buy one only without a home, move only below the top tier, cars only with a free garage place
    when p_metric = 'home_bought' then not exists (select 1 from home)
    when p_metric = 'home_upgraded' then exists (select 1 from home where home.pos < home.top)
    when p_metric = 'car_bought' then
      exists (select 1 from home where home.garage > (select count(*) from public.player_cars c where c.player_id = p_player))
    when p_metric in ('furniture_bought', 'furniture_placed') then exists (select 1 from home)
    -- "your first ..." only for who has not done it yet
    when p_key = 'm_first_skill' then not exists (select 1 from public.player_skills s where s.player_id = p_player)
    when p_key = 'm_first_move' then not exists (select 1 from public.company_moves m where m.started_by = p_player)
    when p_key = 'm_first_trade' then not exists (select 1 from public.trades t where t.player_id = p_player)
    when p_key = 'm_art_paint' then not exists (select 1 from public.artworks a where a.creator_id = p_player)
    when p_key = 'm_first_bond' then not exists (select 1 from public.trades t join public.securities s on s.id = t.security_id
                                                  where t.player_id = p_player and s.kind = 'bond')
    else true end;
$$;
revoke all on function public.mission_doable(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mission_doable(uuid, text, text) to service_role;
comment on function public.mission_doable(uuid, text, text) is
  'Internal: whether the player can still finish a mission of this template (ADR-154).';

create or replace function public.missions_assign(p_player uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prog     jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_now      timestamptz := public.game_now();
  v_today    date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_monday   date;
  v_level    integer;
  v_scale    double precision;
  v_xpscale  double precision;
  v_need     integer;
  v_n        integer := 0;
  v_kind     text;
  v_period   date;
  v_expires  timestamptz;
  v_rank     integer;
  t          record;
begin
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  select p.level into v_level from public.profiles p where p.id = p_player for update;
  if v_level is null then
    return 0;
  end if;
  v_scale := least(public.cfg_num(v_prog, '{missionTargetScaleMax}', 5),
                   1 + public.cfg_num(v_prog, '{missionTargetScalePerLevel}', 0.2) * (v_level - 1));
  -- ADR-142: mission XP grows with the level, so missions stay worth it as levels need more XP
  v_xpscale := least(public.cfg_num(v_prog, '{missionXpScaleMax}', 1),
                     1 + public.cfg_num(v_prog, '{missionXpScalePerLevel}', 0) * (v_level - 1));

  -- ADR-154: a mission nobody can finish any more (the company is full, the home is bought) makes room for another
  update public.player_missions m set status = 'expired', expires_at = least(coalesce(m.expires_at, v_now), v_now)
    from public.mission_templates mt
   where mt.key = m.template_key and m.player_id = p_player and m.status = 'active' and m.progress = 0
     and m.kind in ('quick', 'milestone') and mt.mode <> 'state'
     and not public.mission_doable(p_player, mt.key, mt.metric);

  -- expire what ran out
  update public.player_missions set status = 'expired'
   where player_id = p_player and status in ('active', 'completed') and expires_at is not null and expires_at <= v_now;

  foreach v_kind in array array['quick', 'daily', 'weekly', 'milestone'] loop
    if v_kind = 'quick' then
      v_need := public.cfg_num(v_prog, '{xpSources,quickMission,active}', 3)::integer
              - (select count(*) from public.player_missions m where m.player_id = p_player and m.kind = 'quick' and m.status in ('active', 'completed'));
      v_period := v_today; v_expires := null;
    elsif v_kind = 'daily' then
      v_need := public.cfg_num(v_prog, '{xpSources,dailyMission,perDay}', 3)::integer
              - (select count(*) from public.player_missions m where m.player_id = p_player and m.kind = 'daily' and m.period_start = v_today);
      v_period := v_today; v_expires := ((v_today + 1)::timestamp) at time zone 'Europe/Berlin';
    elsif v_kind = 'weekly' then
      v_need := public.cfg_num(v_prog, '{xpSources,weeklyMission,perWeek}', 3)::integer
              - (select count(*) from public.player_missions m where m.player_id = p_player and m.kind = 'weekly' and m.period_start = v_monday);
      v_period := v_monday; v_expires := ((v_monday + 7)::timestamp) at time zone 'Europe/Berlin';
    else
      v_need := public.cfg_num(v_prog, '{xpSources,milestoneMission,visible}', 3)::integer
              - (select count(*) from public.player_missions m where m.player_id = p_player and m.kind = 'milestone' and m.status in ('active', 'completed'));
      v_period := date '2000-01-01'; v_expires := null;
    end if;
    continue when v_need <= 0;

    for t in
      select mt.*
        from public.mission_templates mt
       where mt.kind = v_kind and mt.mode is not null and mt.is_active
         and mt.min_level <= v_level
         and (not (mt.params ? 'unlock') or v_level >= public.unlock_level(mt.params ->> 'unlock'))
         and public.mission_requirement_ok(p_player, mt.params ->> 'requires')
         and public.mission_doable(p_player, mt.key, mt.metric)
         and not exists (select 1 from public.player_missions m
                          where m.player_id = p_player and m.template_key = mt.key
                            and (m.period_start = v_period
                                 or (v_kind = 'quick' and (m.status in ('active', 'completed') or m.created_at > v_now - interval '24 hours'))
                                 or v_kind = 'milestone'))
       order by case when v_kind = 'milestone' then mt.chain_order end,
                -ln(1 - random()) / greatest(mt.weight, 1)
       limit v_need
    loop
      if t.metric = 'rich_rank_improve' then
        v_rank := public.player_rich_rank(p_player);
        continue when v_rank is null or v_rank <= 1;
      end if;
      insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward, expires_at, state)
      values (p_player, t.key, v_kind, v_period,
              case when t.scale_with_level and public.mission_is_money_metric(t.metric)
                   then round((t.target_min + floor(random() * (t.target_max - t.target_min + 1))) * v_scale / 100)::bigint * 100
                   else t.target_min + floor(random() * (t.target_max - t.target_min + 1))::bigint end,
              case when coalesce((t.params ->> 'fixedXp')::boolean, false)
                   then t.xp_min + floor(random() * (t.xp_max - t.xp_min + 1))::integer
                   else round((t.xp_min + floor(random() * (t.xp_max - t.xp_min + 1))) * v_xpscale)::integer end,
              v_expires,
              case when t.metric = 'rich_rank_improve' then jsonb_build_object('baseline_rank', v_rank) else '{}'::jsonb end)
      on conflict (player_id, template_key, period_start) do nothing;
      if found then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  if v_n > 0 then
    perform public.mission_refresh_state(p_player);
  end if;
  return v_n;
end;
$$;

update public.mission_templates
   set title = 'Kauf dir ein Grundstück',
       description = 'Deine erste eigene Bleibe: eine Wohnung, ein Haus oder gleich mehr. Einmalig 5.000 XP.',
       xp_min = 2500, xp_max = 2500, chain_order = 1, weight = 100,
       params = params || '{"fixedXp": true}'::jsonb, updated_at = now()
 where key = 'm_home_first';
