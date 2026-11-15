-- =============================================================================
-- NEXA · 3500 · Harder missions with the level, missions for the new features (ADR-159)
-- =============================================================================
-- * missions_assign(): counted daily and weekly missions (and quick ones counting more than one) scale their target
--   with the level: x (1 + progression.missionCountScalePerLevel x (level - 1)), at most missionCountScaleMax.
--   Money targets keep their own scale (missionTargetScale*), XP keeps missionXpScale*.
-- * New metrics, fed by triggers so no RPC is redefined: accessory_bought, accessory_legendary, accessory_worn,
--   friend_poke, news_chat, company_chat. mission_doable() knows their preconditions; requirement "accessory".
-- * 19 new mission templates (quick, daily, weekly, milestone) for wardrobe, pokes, the news chat and the team chat.
-- Idempotent: runs unchanged as supabase/updates/20261204003500_missions_level_features.sql.

-- requirement "accessory": owns at least one accessory (wearing another one is possible)
do $do$
declare
  v_def text := pg_get_functiondef('public.mission_requirement_ok(uuid, text)'::regprocedure);
  v_old text := $t$           else false end;$t$;
  v_new text := $t$           when 'accessory' then exists (select 1 from public.player_accessories a where a.player_id = p_player)
           else false end;$t$;
begin
  if position('''accessory''' in v_def) = 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

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
    -- ADR-159: poking needs a friend; the team chat a company; wearing something needs something to wear
    when p_metric = 'friend_poke' then exists (select 1 from public.friendships f
                                                where f.status = 'accepted' and p_player in (f.requester_id, f.addressee_id))
    when p_metric = 'company_chat' then public.mission_requirement_ok(p_player, 'team')
    when p_key = 'm_first_accessory' then not exists (select 1 from public.player_accessories a where a.player_id = p_player)
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
  v_cscale   double precision;
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
  -- ADR-159: counted missions get harder with the level
  v_cscale := least(public.cfg_num(v_prog, '{missionCountScaleMax}', 1),
                    1 + public.cfg_num(v_prog, '{missionCountScalePerLevel}', 0) * (v_level - 1));
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
                   when t.mode in ('count', 'sum') and not public.mission_is_money_metric(t.metric)
                        and (v_kind in ('daily', 'weekly') or (v_kind = 'quick' and t.target_min >= 2))
                   then greatest(t.target_min, round((t.target_min + floor(random() * (t.target_max - t.target_min + 1))) * v_cscale))::bigint
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

-- ---------------------------------------------------------------------------
-- Mission events from the new features (triggers: the RPCs stay as they are)
-- ---------------------------------------------------------------------------
create or replace function public.mission_feature_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rarity text;
begin
  if tg_table_name = 'player_accessories' then
    perform public.mission_event(new.player_id, 'accessory_bought', 1, new.accessory_key);
    select x ->> 'rarity' into v_rarity
      from jsonb_array_elements(coalesce(public.config_jsonb('accessories', '{items}'), '[]'::jsonb)) x
     where x ->> 'key' = new.accessory_key;
    if v_rarity in ('legendary', 'mythic') then
      perform public.mission_event(new.player_id, 'accessory_legendary', 1, new.accessory_key);
    end if;
  elsif tg_table_name = 'player_accessories_worn' then
    if tg_op = 'INSERT' or new.accessory_key is distinct from old.accessory_key then
      perform public.mission_event(new.player_id, 'accessory_worn', 1, new.accessory_key);
    end if;
  elsif tg_table_name = 'friend_pokes' then
    perform public.mission_event(new.poker_id, 'friend_poke', 1, new.target_id::text);
  elsif tg_table_name = 'news_show_messages' then
    if new.player_id is not null then
      perform public.mission_event(new.player_id, 'news_chat', 1, null);
    end if;
  elsif tg_table_name = 'company_messages' then
    if new.kind = 'player' and new.author_id is not null then
      perform public.mission_event(new.author_id, 'company_chat', 1, null);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.mission_feature_events() from public, anon, authenticated;
comment on function public.mission_feature_events() is
  'Trigger: mission events of the wardrobe, pokes, news chat and team chat (ADR-159).';

drop trigger if exists mission_events on public.player_accessories;
create trigger mission_events after insert on public.player_accessories
  for each row execute function public.mission_feature_events();
drop trigger if exists mission_events on public.player_accessories_worn;
create trigger mission_events after insert or update of accessory_key on public.player_accessories_worn
  for each row execute function public.mission_feature_events();
drop trigger if exists mission_events on public.friend_pokes;
create trigger mission_events after insert on public.friend_pokes
  for each row execute function public.mission_feature_events();
drop trigger if exists mission_events on public.news_show_messages;
create trigger mission_events after insert on public.news_show_messages
  for each row execute function public.mission_feature_events();
drop trigger if exists mission_events on public.company_messages;
create trigger mission_events after insert on public.company_messages
  for each row execute function public.mission_feature_events();

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  ('q_poke', 'quick', 'Stups einen Freund an', 'Ein kleiner Stupser zeigt: Ich denk an dich.', 'mission_bell', 'friend_poke', 'count', '{}'::jsonb, 1, 1, 25, 35, 1, 0, false, 40, 0),
  ('q_news_chat', 'quick', 'Schreib im Nachrichten-Chat', 'Sag Mr. Doodle Dangle die Meinung, live.', 'mission_bell', 'news_chat', 'count', '{}'::jsonb, 1, 1, 25, 35, 1, 0, false, 40, 0),
  ('q_team_chat', 'quick', 'Schreib deinem Team', 'Ein Satz ins Büro, alle sehen ihn über deinem Kopf.', 'mission_company', 'company_chat', 'count', '{"requires": "team"}'::jsonb, 1, 1, 25, 35, 1, 0, false, 40, 0),
  ('q_accessory', 'quick', 'Gönn dir ein Accessoire', 'Ein neues Teil für deine Figur. Hauptsache albern.', 'mission_growth', 'accessory_bought', 'count', '{}'::jsonb, 1, 1, 40, 60, 2, 0, false, 40, 0),
  ('q_outfit', 'quick', 'Wechsel dein Outfit', 'Zieh ein anderes Accessoire an.', 'mission_growth', 'accessory_worn', 'count', '{"requires": "accessory"}'::jsonb, 1, 1, 20, 30, 2, 0, false, 30, 0),
  ('d_pokes', 'daily', 'Stups {target}-mal Freunde an', 'Nerv deine Freunde, aber mit Liebe.', 'mission_bell', 'friend_poke', 'count', '{}'::jsonb, 2, 3, 200, 280, 1, 0, true, 40, 0),
  ('d_news_chat', 'daily', 'Schreib {target} Nachrichten im Live-Chat', 'Die Sendung lebt von euch.', 'mission_bell', 'news_chat', 'count', '{}'::jsonb, 3, 5, 200, 280, 1, 0, true, 40, 0),
  ('d_team_chat', 'daily', 'Schreib {target} Nachrichten im Büro', 'Wer redet, arbeitet besser zusammen.', 'mission_company', 'company_chat', 'count', '{"requires": "team"}'::jsonb, 3, 5, 200, 280, 1, 0, true, 40, 0),
  ('w_accessories', 'weekly', 'Kauf {target} Accessoires', 'Der Kleiderschrank ist noch nicht voll genug.', 'mission_growth', 'accessory_bought', 'count', '{}'::jsonb, 2, 3, 700, 1000, 2, 0, true, 40, 1),
  ('w_pokes', 'weekly', 'Stups {target}-mal Freunde an', 'Eine Woche voller Stupser.', 'mission_bell', 'friend_poke', 'count', '{}'::jsonb, 10, 15, 700, 1000, 1, 0, true, 30, 1),
  ('w_news_chat', 'weekly', 'Schreib {target} Nachrichten im Live-Chat', 'Mr. Doodle Dangle liest mit.', 'mission_bell', 'news_chat', 'count', '{}'::jsonb, 15, 25, 700, 1000, 1, 0, true, 30, 1),
  ('m_first_accessory', 'milestone', 'Dein erstes Accessoire', 'Kauf dir im Kleiderschrank dein erstes Teil.', 'mission_growth', 'accessory_bought', 'count', '{}'::jsonb, 1, 1, 500, 500, 2, 62, false, 100, 1),
  ('m_accessories_10', 'milestone', '{target} Accessoires gesammelt', 'Ein Kleiderschrank, der sich sehen lassen kann.', 'mission_growth', 'accessory_bought', 'count', '{}'::jsonb, 10, 10, 1500, 1500, 2, 90, false, 100, 1),
  ('m_accessories_30', 'milestone', '{target} Accessoires gesammelt', 'Du hast für jede Lebenslage ein Kostüm.', 'mission_growth', 'accessory_bought', 'count', '{}'::jsonb, 30, 30, 4000, 4000, 2, 100, false, 100, 1),
  ('m_legendary', 'milestone', 'Ein legendäres Accessoire', 'Zeig allen, was du dir leisten kannst.', 'mission_growth', 'accessory_legendary', 'count', '{}'::jsonb, 1, 1, 3000, 3000, 2, 105, false, 100, 1),
  ('m_first_poke', 'milestone', 'Dein erster Stupser', 'Stups einen Freund an.', 'mission_bell', 'friend_poke', 'count', '{}'::jsonb, 1, 1, 200, 200, 1, 63, false, 100, 1),
  ('m_pokes_100', 'milestone', '{target} Stupser verteilt', 'Du bist der Stupser vom Dienst.', 'mission_bell', 'friend_poke', 'count', '{}'::jsonb, 100, 100, 2500, 2500, 1, 110, false, 100, 1),
  ('m_news_chat_50', 'milestone', '{target} Nachrichten im Live-Chat', 'Stammgast bei Mr. Doodle Dangle.', 'mission_bell', 'news_chat', 'count', '{}'::jsonb, 50, 50, 2000, 2000, 1, 95, false, 100, 1),
  ('m_team_chat_100', 'milestone', '{target} Nachrichten im Büro', 'Die gute Seele der Firma.', 'mission_company', 'company_chat', 'count', '{"requires": "team"}'::jsonb, 100, 100, 2500, 2500, 1, 110, false, 100, 1)
on conflict (key) do update
   set kind = excluded.kind, title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params, target_min = excluded.target_min,
       target_max = excluded.target_max, xp_min = excluded.xp_min, xp_max = excluded.xp_max, min_level = excluded.min_level,
       chain_order = excluded.chain_order, scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true, updated_at = now();
