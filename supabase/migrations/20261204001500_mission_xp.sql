-- =============================================================================
-- NEXA · 1500 · Missions: more XP at higher levels, and work for another player once (ADR-142)
-- =============================================================================
-- Mission XP grows with the level: x min(missionXpScaleMax, 1 + missionXpScalePerLevel x (level - 1)), set when a
-- mission is handed out (templates with params.fixedXp keep their XP). New milestone m_work_for_player: take a job at
-- another real player's company; it comes before every other milestone (chain 0) once jobs are unlocked. Metric player_job:
-- starting a job at a player company, or every worked hour there (so players who already work for someone get it).
-- Idempotent: runs unchanged as supabase/updates/20261204001500_mission_xp.sql.

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

create or replace function public.player_job_mission_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and exists (select 1 from public.player_companies pc
                  where pc.company_id = new.company_id and pc.founder_id <> new.player_id)
     and (tg_op = 'INSERT' or old.status is distinct from new.status
          or new.experience_minutes / 60 > old.experience_minutes / 60) then
    perform public.mission_event(new.player_id, 'player_job', 1, null);
  end if;
  return null;
end;
$$;
comment on function public.player_job_mission_trigger() is
  'Mission event player_job: a job at another real player''s company starts, or an hour is worked there (ADR-142).';
revoke all on function public.player_job_mission_trigger() from public, anon, authenticated;
drop trigger if exists player_job_mission on public.player_jobs;
create trigger player_job_mission
  after insert or update of status, experience_minutes on public.player_jobs
  for each row execute function public.player_job_mission_trigger();

-- 1250 base XP x the global XP multiplier (2) = 2500 XP; fixed, not scaled by level
insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  ('m_work_for_player', 'milestone', 'Arbeite bei einem echten Spieler',
   'Bewirb dich bei der Firma eines anderen Spielers und fang dort an. Gemeinsam wächst ihr schneller.', 'mission_job',
   'player_job', 'count', '{"unlock":"first_job","fixedXp":true}'::jsonb, 1, 1, 1250, 1250, 1, 0, false, 100, 1)
on conflict (key) do update
   set kind = excluded.kind, title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params, target_min = excluded.target_min,
       target_max = excluded.target_max, xp_min = excluded.xp_min, xp_max = excluded.xp_max, min_level = excluded.min_level,
       chain_order = excluded.chain_order, scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true, updated_at = now();
