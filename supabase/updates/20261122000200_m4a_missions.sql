-- ===== idempotent copy of migrations/20261122000200_m4a_missions.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M4a · 0200 · More missions: trading, jobs, skills, company, streak,
--                     profiles and artworks
-- =============================================================================
-- New metrics (mission_event):
--   work_hours          paid work hours (sum; player_jobs.experience_minutes crosses an hour)
--   raise               salary raise in the running job (player_jobs.salary_cents_per_hour rises)
--   skill_learned       a skill learned (player_skills insert)
--   ai_worker_hired     AI workers hired (sum; player_companies.ai_workers rises, founder)
--   job_posted          a job posting of a player company (job_postings insert, poster or founder)
--   profitable_hour     an operating hour of the own company with profit > 0 (founder)
--   company_deposit     a deposit into the own company's cash (company_deposit)
--   view_profile        a foreign player profile opened (track_event, distinct nicknames)
--   art_like, art_bid, art_won, art_sold, art_painted, art_auction_started (artwork RPCs, ADR-080)
-- New state metrics (mission_state_value): login_streak, skills_total, art_collection_value
-- (money), art_owned.
-- params.requires ('job', 'company', 'skill_point', 'artwork'): the mission is only offered
-- while the player has it (missions_assign). Feature gates stay in params.unlock.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Templates (base XP; claim_mission applies progression.xpMultiplier)
-- ---------------------------------------------------------------------------
insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  -- quick (base XP 20-60)
  ('q_trades_3',        'quick', 'Mach {target} Trades',                       'Kauf oder Verkauf, egal welches Wertpapier.',               'mission_trade',   'trade',               'count',    '{}',                                        3, 3, 40, 60, 1, null, false, 60, 0),
  ('q_sectors_2',       'quick', 'Kaufe Aktien aus {target} Branchen',         'Zwei verschiedene Branchen reichen.',                       'mission_sectors', 'sectors_bought',      'distinct', '{}',                                        2, 2, 40, 60, 1, null, false, 50, 0),
  ('q_view_profile',    'quick', 'Sieh dir ein Spielerprofil an',              'Tippe auf einen Namen, zum Beispiel in der Reichenliste.',  'mission_growth',  'view_profile',        'distinct', '{}',                                        1, 1, 20, 30, 1, null, false, 60, 0),
  ('q_learn_skill',     'quick', 'Lerne eine Fähigkeit',                       'Setze einen freien Fähigkeitspunkt ein.',                   'mission_skill',   'skill_learned',       'count',    '{"requires":"skill_point"}',                1, 1, 40, 60, 2, null, false, 60, 0),
  ('q_deposit',         'quick', 'Zahle Geld in deine Firmenkasse ein',        'Jede Einlage zählt.',                                       'mission_company', 'company_deposit',     'count',    '{"unlock":"found_garage","requires":"company"}', 1, 1, 30, 50, 3, null, false, 50, 0),
  ('q_ai_worker',       'quick', 'Stelle eine KI-Kraft ein',                   'KI-Kräfte arbeiten rund um die Uhr in deiner Firma.',       'mission_company', 'ai_worker_hired',     'sum',      '{"unlock":"found_garage","requires":"company"}', 1, 1, 40, 60, 3, null, false, 40, 0),
  ('q_art_like',        'quick', 'Like ein Kunstwerk',                         'Auf dem Kunstmarkt, egal ob Galerie oder Spieler.',         'mission_art',     'art_like',            'distinct', '{"unlock":"artworks"}',                     1, 1, 20, 30, 8, null, false, 60, 0),
  ('q_art_bid',         'quick', 'Biete auf ein Kunstwerk',                    'Jedes gültige Gebot zählt.',                                'mission_art',     'art_bid',             'count',    '{"unlock":"artworks"}',                     1, 1, 40, 60, 8, null, false, 50, 0),

  -- daily (base XP 200-400)
  ('d_trades_10',       'daily', 'Mach heute {target} Trades',                 'Jede ausgeführte Order zählt.',                             'mission_trade',   'trade',               'count',    '{}',                                        8, 12, 300, 400, 1, null, false, 60, 0),
  ('d_buys',            'daily', 'Kaufe heute {target}-mal',                   'Auch Bruchstücke zählen.',                                  'mission_trade',   'buy',                 'count',    '{}',                                        3, 4, 200, 300, 1, null, false, 70, 0),
  ('d_buy_pharma',      'daily', 'Kaufe {target} Aktien aus der Branche Pharma','Zwei Käufe, auch derselben Aktie.',                        'mission_sectors', 'buy_sector',          'count',    '{"sector":"pharma"}',                       2, 2, 250, 300, 1, null, false, 30, 0),
  ('d_buy_retail',      'daily', 'Kaufe {target} Aktien aus dem Einzelhandel', 'Zwei Käufe, auch derselben Aktie.',                         'mission_sectors', 'buy_sector',          'count',    '{"sector":"retail"}',                       2, 2, 250, 300, 1, null, false, 30, 0),
  ('d_buy_logistics',   'daily', 'Kaufe {target} Aktien aus der Logistik',     'Zwei Käufe, auch derselben Aktie.',                         'mission_sectors', 'buy_sector',          'count',    '{"sector":"logistics"}',                    2, 2, 250, 300, 1, null, false, 30, 0),
  ('d_rich_list',       'daily', 'Schau auf der Reichenliste vorbei',          'Wer hat dich überholt, wen kannst du einholen?',            'mission_growth',  'open_rich_list',      'count',    '{}',                                        1, 1, 200, 200, 1, null, false, 30, 0),
  ('d_view_profiles',   'daily', 'Sieh dir {target} Spielerprofile an',        'Verschiedene Spieler, zum Beispiel aus der Reichenliste.',  'mission_growth',  'view_profile',        'distinct', '{}',                                        3, 3, 200, 250, 1, null, false, 50, 0),
  ('d_work_hours',      'daily', 'Arbeite heute {target} Stunden',             'Dein Job läuft automatisch, du musst nur angestellt sein.', 'mission_work',    'work_hours',          'sum',      '{"unlock":"first_job","requires":"job"}',   3, 6, 200, 300, 2, null, false, 80, 0),
  ('d_profit_hours',    'daily', 'Erziele heute {target} Stunden mit Gewinn',  'Betriebsstunden deiner Firma, die Gewinn bringen.',         'mission_company', 'profitable_hour',     'count',    '{"unlock":"found_garage","requires":"company"}', 3, 6, 250, 350, 3, null, false, 70, 0),
  ('d_art_likes',       'daily', 'Like {target} Kunstwerke',                   'Verschiedene Werke auf dem Kunstmarkt.',                    'mission_art',     'art_like',            'distinct', '{"unlock":"artworks"}',                     3, 3, 200, 250, 8, null, false, 60, 0),
  ('d_art_bids',        'daily', 'Gib {target} Gebote auf Kunstwerke ab',      'Auch mehrere Gebote auf dasselbe Werk zählen.',             'mission_art',     'art_bid',             'count',    '{"unlock":"artworks"}',                     2, 3, 250, 350, 8, null, false, 50, 0),

  -- weekly (base XP 600-1200)
  ('w_sells',           'weekly', 'Verkaufe diese Woche {target}-mal',         'Teilverkäufe zählen auch.',                                 'mission_trade',   'sell',                'count',    '{}',                                       10, 10, 700, 900, 1, null, false, 60, 1),
  ('w_buy_value',       'weekly', 'Kaufe in einer Order für mindestens {target}','Eine einzige große Order.',                               'mission_volume',  'buy_value',           'max',      '{}',                                   200000, 200000, 700, 1000, 1, null, true, 50, 1),
  ('w_profiles',        'weekly', 'Sieh dir {target} Spielerprofile an',       'Verschiedene Spieler in dieser Woche.',                     'mission_growth',  'view_profile',        'distinct', '{}',                                       10, 10, 600, 700, 1, null, false, 40, 1),
  ('w_streak',          'weekly', 'Halte eine Serie von {target} Tagen',       'Hol dir jeden Tag deinen Tagesbonus.',                      'mission_bell',    'login_streak',        'state',    '{}',                                        5, 5, 700, 900, 1, null, false, 60, 1),
  ('w_work_hours',      'weekly', 'Arbeite diese Woche {target} Stunden',      'Bezahlte Arbeitsstunden in deinem Job.',                    'mission_work',    'work_hours',          'sum',      '{"unlock":"first_job","requires":"job"}',  20, 40, 700, 1000, 2, null, false, 80, 1),
  ('w_raise',           'weekly', 'Hol dir eine Gehaltserhöhung',              'Frag im Job-Tab nach mehr Gehalt.',                         'mission_work',    'raise',               'count',    '{"unlock":"first_job","requires":"job"}',   1, 1, 800, 1000, 2, null, false, 50, 1),
  ('w_skills',          'weekly', 'Lerne diese Woche {target} Fähigkeiten',    'Freie Punkte gibt es mit jedem Level.',                     'mission_skill',   'skill_learned',       'count',    '{"requires":"skill_point"}',                2, 2, 700, 900, 3, null, false, 50, 1),
  ('w_profit_hours',    'weekly', 'Erziele diese Woche {target} Stunden mit Gewinn', 'Betriebsstunden deiner Firma, die Gewinn bringen.',   'mission_company', 'profitable_hour',     'count',    '{"unlock":"found_garage","requires":"company"}', 20, 30, 800, 1100, 3, null, false, 70, 1),
  ('w_ai_workers',      'weekly', 'Stelle diese Woche {target} KI-Kräfte ein', 'Mehr Kapazität für deine Firma.',                           'mission_company', 'ai_worker_hired',     'sum',      '{"unlock":"found_garage","requires":"company"}', 2, 2, 700, 900, 3, null, false, 40, 1),
  ('w_job_posting',     'weekly', 'Schreibe eine Stelle aus',                  'Suche Verstärkung für deine Firma.',                        'mission_company', 'job_posted',          'count',    '{"unlock":"found_garage","requires":"company"}', 1, 1, 600, 800, 3, null, false, 40, 1),
  ('w_art_bids',        'weekly', 'Gib diese Woche {target} Gebote ab',        'Auf beliebige Kunstwerke.',                                 'mission_art',     'art_bid',             'count',    '{"unlock":"artworks"}',                     5, 5, 700, 900, 8, null, false, 60, 1),
  ('w_art_win',         'weekly', 'Ersteigere ein Kunstwerk',                  'Sei am Ende einer Auktion Höchstbietender.',                'mission_art',     'art_won',             'count',    '{"unlock":"artworks"}',                     1, 1, 900, 1200, 8, null, false, 50, 1),
  ('w_art_auction',     'weekly', 'Versteigere ein Kunstwerk',                 'Biete eines deiner Werke in einer Auktion an.',             'mission_art',     'art_auction_started', 'count',    '{"unlock":"artworks","requires":"artwork"}', 1, 1, 600, 800, 8, null, false, 40, 1),

  -- milestones (base XP 100-2000), woven into the story chain (chain_order)
  ('m_first_skill',     'milestone', 'Lerne deine erste Fähigkeit',            'Setze einen Fähigkeitspunkt auf der Skill-Karte ein.',      'mission_skill',   'skill_learned',       'count',    '{"requires":"skill_point"}',                1, 1, 150, 150, 2, 5, false, 100, 1),
  ('m_first_hours',     'milestone', 'Arbeite deine ersten {target} Stunden',  'Dein Job läuft automatisch.',                               'mission_work',    'work_hours',          'sum',      '{"unlock":"first_job"}',                    8, 8, 300, 300, 2, 7, false, 100, 1),
  ('m_streak_7',        'milestone', 'Halte eine Serie von {target} Tagen',    'Jeden Tag ein Tagesbonus.',                                 'mission_bell',    'login_streak',        'state',    '{}',                                        7, 7, 400, 400, 1, 9, false, 100, 1),
  ('m_first_raise',     'milestone', 'Deine erste Gehaltserhöhung',            'Frag im Job-Tab nach mehr Gehalt.',                         'mission_work',    'raise',               'count',    '{"unlock":"first_job","requires":"job"}',   1, 1, 400, 400, 2, 10, false, 100, 1),
  ('m_first_ai_worker', 'milestone', 'Deine erste KI-Kraft',                   'Stelle in deiner Firma eine KI-Kraft ein.',                 'mission_company', 'ai_worker_hired',     'sum',      '{"unlock":"found_garage","requires":"company"}', 1, 1, 400, 400, 3, 11, false, 100, 1),
  ('m_skills_5',        'milestone', 'Lerne {target} Fähigkeiten',             'Insgesamt, auf der Skill-Karte.',                           'mission_skill',   'skills_total',        'state',    '{}',                                        5, 5, 600, 600, 2, 12, false, 100, 1),
  ('m_first_posting',   'milestone', 'Deine erste Stellenanzeige',             'Suche Mitarbeiter für deine Firma.',                        'mission_company', 'job_posted',          'count',    '{"unlock":"found_garage","requires":"company"}', 1, 1, 400, 400, 3, 13, false, 100, 1),
  ('m_art_first_like',  'milestone', 'Like dein erstes Kunstwerk',             'Zeig, welche Werke dir gefallen.',                          'mission_art',     'art_like',            'distinct', '{"unlock":"artworks"}',                     1, 1, 150, 150, 8, 14, false, 100, 1),
  ('m_art_first_bid',   'milestone', 'Dein erstes Gebot auf ein Kunstwerk',    'Die Galerie versteigert jeden Tag neue Werke.',             'mission_art',     'art_bid',             'count',    '{"unlock":"artworks"}',                     1, 1, 300, 300, 8, 15, false, 100, 1),
  ('m_art_first_win',   'milestone', 'Ersteigere dein erstes Kunstwerk',       'Sei am Ende einer Auktion Höchstbietender.',                'mission_art',     'art_won',             'count',    '{"unlock":"artworks"}',                     1, 1, 800, 800, 8, 16, false, 100, 1),
  ('m_art_paint',       'milestone', 'Male dein erstes Kunstwerk',             'Im Kunst-Editor, 32 × 32 Pixel.',                           'mission_art',     'art_painted',         'count',    '{"unlock":"artworks"}',                     1, 1, 1000, 1000, 8, 17, false, 100, 1),
  ('m_work_100',        'milestone', 'Arbeite {target} Stunden',               'Seit diese Mission sichtbar ist.',                          'mission_work',    'work_hours',          'sum',      '{"unlock":"first_job"}',                  100, 100, 1000, 1000, 2, 18, false, 100, 1),
  ('m_profit_100',      'milestone', 'Erziele {target} Stunden mit Gewinn',    'Betriebsstunden deiner Firma, die Gewinn bringen.',         'mission_company', 'profitable_hour',     'count',    '{"unlock":"found_garage","requires":"company"}', 100, 100, 1200, 1200, 3, 19, false, 100, 1),
  ('m_art_collection',  'milestone', 'Baue eine Sammlung im Wert von {target} auf', 'Wert = letzter Auktionspreis deiner Werke.',           'mission_art',     'art_collection_value','state',    '{"unlock":"artworks"}',              10000000, 10000000, 1500, 1500, 8, 22, false, 100, 1),
  ('m_streak_30',       'milestone', 'Halte eine Serie von {target} Tagen',    'Einen ganzen Monat lang.',                                  'mission_bell',    'login_streak',        'state',    '{}',                                       30, 30, 1500, 1500, 1, 24, false, 100, 1)
on conflict (key) do update
   set kind = excluded.kind, title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params, target_min = excluded.target_min,
       target_max = excluded.target_max, xp_min = excluded.xp_min, xp_max = excluded.xp_max, min_level = excluded.min_level,
       chain_order = excluded.chain_order, scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true;

-- ---------------------------------------------------------------------------
-- B. Metrics: money formatting, state values, requirements
-- ---------------------------------------------------------------------------
create or replace function public.mission_is_money_metric(p_metric text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_metric in ('trade_value', 'buy_value', 'realized_profit', 'net_worth', 'art_collection_value');
$$;

-- mission_state_value as in M2a plus login_streak, skills_total, art_collection_value, art_owned
create or replace function public.mission_state_value(p_player uuid, p_metric text, p_params jsonb, p_state jsonb)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rank integer;
begin
  case p_metric
    when 'net_worth' then
      return public.player_net_worth_cents(p_player);
    when 'level' then
      return (select p.level from public.profiles p where p.id = p_player);
    when 'sectors_held' then
      return (select count(distinct s.sector_key) from public.positions pos join public.securities s on s.id = pos.security_id
               where pos.player_id = p_player and pos.status = 'open' and pos.quantity_e6 > 0 and s.kind = 'stock');
    when 'rich_rank' then
      v_rank := public.player_rich_rank(p_player);
      return case when v_rank is not null and v_rank <= coalesce((p_params ->> 'rank')::integer, 1) then 1 else 0 end;
    when 'rich_rank_improve' then
      v_rank := public.player_rich_rank(p_player);
      return case when v_rank is not null and (p_state ->> 'baseline_rank') is not null
                       and v_rank < (p_state ->> 'baseline_rank')::integer then 1 else 0 end;
    when 'login_streak' then
      return coalesce(public.player_streak_days(p_player), 0);
    when 'skills_total' then
      return (select count(*) from public.player_skills s where s.player_id = p_player);
    when 'art_collection_value' then
      return public.player_art_value_cents(p_player);
    when 'art_owned' then
      return (select count(*) from public.artworks a where a.owner_id = p_player);
    else
      return 0;
  end case;
end;
$$;

-- params.requires: the mission is only offered while the player has what it needs
create or replace function public.mission_requirement_ok(p_player uuid, p_requires text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case coalesce(p_requires, '')
           when '' then true
           when 'job' then exists (select 1 from public.player_jobs j where j.player_id = p_player and j.status = 'active')
           when 'company' then exists (select 1 from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active')
           when 'skill_point' then coalesce((select sp.free_points > 0 from public.player_skill_points sp where sp.player_id = p_player), false)
           when 'artwork' then exists (select 1 from public.artworks a where a.owner_id = p_player
                                         and not exists (select 1 from public.artwork_auctions x
                                                          where x.artwork_id = a.id and x.status = 'open'))
           else false end;
$$;
comment on function public.mission_requirement_ok(uuid, text) is
  'Internal: mission_templates.params.requires (job, company, skill_point, artwork) is met by the player.';

-- ---------------------------------------------------------------------------
-- C. missions_assign as in M2a plus params.requires
-- ---------------------------------------------------------------------------
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
              t.xp_min + floor(random() * (t.xp_max - t.xp_min + 1))::integer,
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
-- D. Events from tables (every code path that changes them counts)
-- ---------------------------------------------------------------------------
create or replace function public.mission_metric_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  if tg_table_name = 'player_jobs' then
    if new.experience_minutes / 60 > old.experience_minutes / 60 then
      perform public.mission_event(new.player_id, 'work_hours', new.experience_minutes / 60 - old.experience_minutes / 60, null);
    end if;
    if new.salary_cents_per_hour > old.salary_cents_per_hour and new.status = 'active' and old.status = 'active' then
      perform public.mission_event(new.player_id, 'raise', 1, null);
    end if;
  elsif tg_table_name = 'player_skills' then
    perform public.mission_event(new.player_id, 'skill_learned', 1, new.skill_key);
  elsif tg_table_name = 'player_companies' then
    perform public.mission_event(new.founder_id, 'ai_worker_hired', new.ai_workers - old.ai_workers, null);
  elsif tg_table_name = 'job_postings' then
    -- the founder or CEO who posted it (auth.uid() inside the RPC), else the founder
    v_player := (select auth.uid());
    if v_player is null or not exists (select 1 from public.profiles p where p.id = v_player) then
      select pc.founder_id into v_player from public.player_companies pc where pc.company_id = new.company_id;
    end if;
    perform public.mission_event(v_player, 'job_posted', 1, null);
  elsif tg_table_name = 'player_company_hours' then
    select pc.founder_id into v_player from public.player_companies pc where pc.company_id = new.company_id;
    perform public.mission_event(v_player, 'profitable_hour', 1, null);
  end if;
  return null;
end;
$$;
comment on function public.mission_metric_trigger() is
  'Mission events from table changes: work_hours, raise, skill_learned, ai_worker_hired, job_posted, profitable_hour.';

drop trigger if exists mission_metrics on public.player_jobs;
create trigger mission_metrics
  after update of experience_minutes, salary_cents_per_hour on public.player_jobs
  for each row
  when (new.experience_minutes / 60 > old.experience_minutes / 60 or new.salary_cents_per_hour > old.salary_cents_per_hour)
  execute function public.mission_metric_trigger();
drop trigger if exists mission_metrics on public.player_skills;
create trigger mission_metrics
  after insert on public.player_skills
  for each row execute function public.mission_metric_trigger();
drop trigger if exists mission_metrics on public.player_companies;
create trigger mission_metrics
  after update of ai_workers on public.player_companies
  for each row when (new.ai_workers > old.ai_workers)
  execute function public.mission_metric_trigger();
drop trigger if exists mission_metrics on public.job_postings;
create trigger mission_metrics
  after insert on public.job_postings
  for each row when (not new.is_ai)
  execute function public.mission_metric_trigger();
drop trigger if exists mission_metrics on public.player_company_hours;
create trigger mission_metrics
  after insert on public.player_company_hours
  for each row when (new.profit_cents > 0)
  execute function public.mission_metric_trigger();

-- ---------------------------------------------------------------------------
-- E. company_deposit as in M3c plus the mission event
-- ---------------------------------------------------------------------------
create or replace function public.company_deposit(p_request_id uuid, p_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  v_cash    bigint;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_amount_cents is null or p_amount_cents < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'company_deposit');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.lock_player_accounts(v_player);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < p_amount_cents then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.company_cash_account(v_company),
                                 p_amount_cents, 'capital_injection', 'Einlage', 'company', v_company,
                                 'deposit:' || p_request_id::text, v_player);
  perform public.player_company_settle_unpaid(v_company, 'deposit-settle:' || p_request_id::text);
  perform public.mission_event(v_player, 'company_deposit', 1, null);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

-- ---------------------------------------------------------------------------
-- F. track_event as in M2a plus view_profile (ref: nickname of another player)
-- ---------------------------------------------------------------------------
create or replace function public.track_event(p_kind text, p_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_cap    integer;
  v_ref    text := null;
begin
  v_player := public.require_player();
  v_cap := case p_kind when 'view_security' then 50 when 'open_rich_list' then 20 when 'open_rules' then 20
                       when 'view_profile' then 50 end;
  if v_cap is null then
    perform public.api_error('invalid_argument');
  end if;
  if p_kind = 'view_security' then
    select s.ticker into v_ref from public.securities s where s.id = public.resolve_security(p_ref);
    if v_ref is null then
      return jsonb_build_object('ok', true);
    end if;
  elsif p_kind = 'view_profile' then
    select lower(p.nickname) into v_ref from public.profiles p
     where lower(p.nickname) = lower(btrim(coalesce(p_ref, ''))) and p.id <> v_player;
    if v_ref is null then
      return jsonb_build_object('ok', true);
    end if;
  end if;
  if public.rate_limit_hit(v_player, 'track:' || p_kind, v_cap, 86400) then
    perform public.mission_event(v_player, p_kind, 1, v_ref);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.mission_is_money_metric(text)', 'public.mission_state_value(uuid, text, jsonb, jsonb)',
    'public.mission_requirement_ok(uuid, text)', 'public.missions_assign(uuid)', 'public.mission_metric_trigger()',
    'public.company_deposit(uuid, bigint)', 'public.track_event(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.company_deposit(uuid, bigint) to authenticated;
  grant execute on function public.track_event(text, text) to authenticated;
end;
$$;
