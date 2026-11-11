-- =============================================================================
-- NEXA · M2a · 0500 · Missions (quick, daily, weekly, milestone), daily
--                     check-in with streak, client events
-- =============================================================================
-- Templates live in mission_templates (mode IS NOT NULL = new system; the old
-- seed templates have no mode and are never assigned). XP values in the
-- templates are base XP; grant_xp applies progression.xpMultiplier once.
-- params: {"sector": "<key>"} filters buy_sector events, {"unlock": "<key>"}
-- offers the mission only once the feature is unlocked, {"rank": n} for rich
-- list milestones. scale_with_level: money targets x min(5, 1 + 0.2 x (level - 1))
-- (progression.missionTargetScalePerLevel / missionTargetScaleMax, fallbacks).
-- =============================================================================

insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order, scale_with_level, weight)
values
  -- quick (base XP 20-60): a few minutes each
  ('q_trade',          'quick', 'Mach einen Trade',                         'Kaufe oder verkaufe ein beliebiges Wertpapier.',              'mission_trade',   'trade',             'count',    '{}',                     1, 1, 20, 30, 1, null, false, 100),
  ('q_buy',            'quick', 'Kaufe eine Aktie',                         'Ein Bruchstück reicht schon.',                                'mission_trade',   'buy',               'count',    '{}',                     1, 1, 20, 30, 1, null, false, 100),
  ('q_sell',           'quick', 'Verkaufe eine Position',                   'Auch ein Teilverkauf zählt.',                                 'mission_trade',   'sell',              'count',    '{}',                     1, 1, 25, 35, 1, null, false, 60),
  ('q_view',           'quick', 'Sieh dir {target} Aktien an',              'Öffne die Detailseiten verschiedener Aktien.',                'mission_trade',   'view_security',     'distinct', '{}',                     3, 3, 20, 20, 1, null, false, 80),
  ('q_rich_list',      'quick', 'Wirf einen Blick auf die Reichenliste',    'Wer steht ganz oben, und wie weit ist der nächste Platz?',    'mission_growth',  'open_rich_list',    'count',    '{}',                     1, 1, 20, 20, 1, null, false, 60),
  ('q_rules',          'quick', 'Lies die Spielregeln',                     'Ein Blick in die Hilfe lohnt sich.',                          'mission_growth',  'open_rules',        'count',    '{}',                     1, 1, 20, 20, 1, null, false, 30),
  ('q_vault',          'quick', 'Leere deinen Tresor',                      'Hol dir dein Grundeinkommen ab.',                             'mission_vault',   'vault_claim',       'count',    '{}',                     1, 1, 30, 40, 1, null, false, 80),
  ('q_check_in',       'quick', 'Hol dir deinen Tagesbonus',                'Einmal am Tag gibt es XP fürs Vorbeischauen.',                'mission_bell',    'check_in',          'count',    '{}',                     1, 1, 20, 20, 1, null, false, 60),
  ('q_buy_energy',     'quick', 'Kaufe eine Aktie aus der Branche Energie', 'Strom, Gas, Sonne: Wähle einen Energiewert.',                 'mission_sectors', 'buy_sector',        'count',    '{"sector":"energy"}',    1, 1, 30, 50, 1, null, false, 40),
  ('q_buy_tech',       'quick', 'Kaufe eine Aktie aus der Branche Tech',    'Software, Spiele oder Quantenchips.',                         'mission_sectors', 'buy_sector',        'count',    '{"sector":"tech"}',      1, 1, 30, 50, 1, null, false, 40),
  ('q_buy_retail',     'quick', 'Kaufe eine Aktie aus dem Einzelhandel',    'Supermärkte, Mode oder Discounter.',                          'mission_sectors', 'buy_sector',        'count',    '{"sector":"retail"}',    1, 1, 30, 50, 1, null, false, 40),
  ('q_buy_pharma',     'quick', 'Kaufe eine Aktie aus der Branche Pharma',  'Medikamente und Biotech.',                                    'mission_sectors', 'buy_sector',        'count',    '{"sector":"pharma"}',    1, 1, 30, 50, 1, null, false, 40),
  ('q_buy_logistics',  'quick', 'Kaufe eine Aktie aus der Logistik',        'Schiffe, Pakete, Frachtbörsen.',                              'mission_sectors', 'buy_sector',        'count',    '{"sector":"logistics"}', 1, 1, 30, 50, 1, null, false, 40),
  ('q_buy_value',      'quick', 'Kaufe für mindestens {target}',            'Eine einzelne Order zählt.',                                  'mission_volume',  'buy_value',         'max',      '{}',                 20000, 20000, 30, 50, 1, null, true, 70),
  ('q_two_securities', 'quick', 'Handle {target} verschiedene Wertpapiere', 'Kauf oder Verkauf, egal welche.',                             'mission_trade',   'distinct_security', 'distinct', '{}',                     2, 2, 40, 60, 1, null, false, 50),
  ('q_profit',         'quick', 'Verkaufe mit Gewinn',                      'Ein Verkauf über deinem Einstand reicht.',                    'mission_profit',  'realized_profit',   'max',      '{}',                     1, 1, 40, 60, 1, null, false, 40),
  ('q_volume',         'quick', 'Bewege {target} am Markt',                 'Summe aus Käufen und Verkäufen.',                             'mission_volume',  'trade_value',       'sum',      '{}',                 50000, 50000, 30, 50, 1, null, true, 50),
  ('q_limit',          'quick', 'Setze eine Limit-Order',                   'Lege selbst fest, zu welchem Preis du kaufst.',               'mission_limit',   'limit_order',       'count',    '{"unlock":"limit_orders"}', 1, 1, 40, 60, 3, null, false, 60),
  ('q_bond',           'quick', 'Kaufe eine Staatsanleihe',                 'Sichere Zinsen vom Staat.',                                   'mission_bond',    'bond_bought',       'count',    '{"unlock":"bonds"}',     1, 1, 40, 60, 5, null, false, 60),
  ('q_rank_up',        'quick', 'Verbessere dich um einen Platz auf der Reichenliste', 'Überhole irgendjemanden.',                         'mission_growth',  'rich_rank_improve', 'state',    '{}',                     1, 1, 40, 60, 1, null, false, 50),

  -- daily (base XP 200-400): three per Berlin calendar day
  ('d_trades',         'daily', 'Mach {target} Trades',                     'Jede ausgeführte Order zählt.',                               'mission_trade',   'trade',             'count',    '{}',                     3, 5, 200, 300, 1, null, false, 100),
  ('d_buy_value',      'daily', 'Kaufe für mindestens {target}',            'In einer einzigen Order.',                                    'mission_volume',  'buy_value',         'max',      '{}',                 50000, 50000, 200, 300, 1, null, true, 90),
  ('d_volume',         'daily', 'Handle Wertpapiere im Wert von {target}',  'Summe aller Käufe und Verkäufe heute.',                       'mission_volume',  'trade_value',       'sum',      '{}',                200000, 500000, 200, 350, 1, null, true, 90),
  ('d_profit',         'daily', 'Erziele {target} Gewinn mit einem Verkauf','Gewinn nach Gebühren in einer Order.',                        'mission_profit',  'realized_profit',   'max',      '{}',                  5000, 5000, 250, 400, 1, null, true, 70),
  ('d_profit_sum',     'daily', 'Erziele heute insgesamt {target} Gewinn',  'Summe deiner realisierten Gewinne.',                          'mission_profit',  'realized_profit',   'sum',      '{}',                 10000, 20000, 250, 400, 1, null, true, 50),
  ('d_sectors',        'daily', 'Kaufe Aktien aus {target} Branchen',       'Streuen statt alles auf eine Karte.',                         'mission_sectors', 'sectors_bought',    'distinct', '{}',                     2, 3, 250, 350, 1, null, false, 80),
  ('d_hold_sectors',   'daily', 'Halte Aktien aus {target} Branchen',       'Zum Zeitpunkt der Prüfung im Depot.',                         'mission_sectors', 'sectors_held',      'state',    '{}',                     3, 3, 250, 350, 1, null, false, 60),
  ('d_vault',          'daily', 'Leere deinen Tresor {target}-mal',         'Über den Tag verteilt.',                                      'mission_vault',   'vault_claim',       'count',    '{}',                     2, 2, 200, 250, 1, null, false, 80),
  ('d_securities',     'daily', 'Handle {target} verschiedene Wertpapiere', 'Jedes Wertpapier zählt einmal.',                              'mission_trade',   'distinct_security', 'distinct', '{}',                     3, 3, 250, 350, 1, null, false, 70),
  ('d_sells',          'daily', 'Verkaufe {target}-mal',                    'Teilverkäufe zählen auch.',                                   'mission_trade',   'sell',              'count',    '{}',                     2, 2, 200, 300, 1, null, false, 60),
  ('d_check_in',       'daily', 'Hol dir deinen Tagesbonus',                'Und schau, was sich am Markt bewegt.',                        'mission_bell',    'check_in',          'count',    '{}',                     1, 1, 200, 200, 1, null, false, 40),
  ('d_buy_tech',       'daily', 'Kaufe {target} Aktien aus der Branche Tech','Zwei Käufe, auch derselben Aktie.',                          'mission_sectors', 'buy_sector',        'count',    '{"sector":"tech"}',      2, 2, 250, 300, 1, null, false, 30),
  ('d_buy_energy',     'daily', 'Kaufe {target} Aktien aus der Branche Energie','Zwei Käufe, auch derselben Aktie.',                       'mission_sectors', 'buy_sector',        'count',    '{"sector":"energy"}',    2, 2, 250, 300, 1, null, false, 30),
  ('d_limits',         'daily', 'Setze {target} Limit-Orders',              'Kaufen oder verkaufen zu deinem Preis.',                      'mission_limit',   'limit_order',       'count',    '{"unlock":"limit_orders"}', 2, 2, 250, 350, 3, null, false, 60),
  ('d_bond',           'daily', 'Kaufe eine Staatsanleihe',                 'Rendite ohne Kursrisiko bis zur Fälligkeit.',                 'mission_bond',    'bond_bought',       'count',    '{"unlock":"bonds"}',     1, 1, 200, 300, 5, null, false, 50),

  -- weekly (base XP 600-1200): three per week, Monday 00:00 Berlin
  ('w_days',           'weekly', 'Handle an {target} verschiedenen Tagen',  'Mindestens ein Trade pro Tag.',                               'mission_growth',  'trading_day',       'distinct', '{}',                     5, 5, 900, 1200, 1, null, false, 100),
  ('w_trades',         'weekly', 'Mach {target} Trades',                    'Diese Woche.',                                                'mission_trade',   'trade',             'count',    '{}',                    20, 30, 700, 1000, 1, null, false, 100),
  ('w_volume',         'weekly', 'Handle für insgesamt {target}',           'Summe aller Käufe und Verkäufe der Woche.',                   'mission_volume',  'trade_value',       'sum',      '{}',               1000000, 2000000, 700, 1000, 1, null, true, 80),
  ('w_profit',         'weekly', 'Erziele diese Woche {target} Gewinn',     'Summe deiner realisierten Gewinne.',                          'mission_profit',  'realized_profit',   'sum',      '{}',                 50000, 100000, 800, 1200, 1, null, true, 80),
  ('w_vault',          'weekly', 'Leere deinen Tresor {target}-mal',        'Diese Woche.',                                                'mission_vault',   'vault_claim',       'count',    '{}',                    10, 10, 600, 800, 1, null, false, 60),
  ('w_check_in',       'weekly', 'Hol dir an {target} Tagen den Tagesbonus','Tagesbonus an verschiedenen Tagen.',                          'mission_bell',    'check_in',          'count',    '{}',                     5, 5, 600, 800, 1, null, false, 60),
  ('w_all_sectors',    'weekly', 'Kaufe Aktien aus allen {target} Branchen','Tech, Einzelhandel, Energie, Pharma und Logistik.',           'mission_sectors', 'sectors_bought',    'distinct', '{}',                     5, 5, 800, 1100, 1, null, false, 60),
  ('w_limits',         'weekly', 'Setze {target} Limit-Orders',             'Diese Woche.',                                                'mission_limit',   'limit_order',       'count',    '{"unlock":"limit_orders"}', 5, 5, 700, 900, 3, null, false, 50),
  ('w_bonds',          'weekly', 'Kaufe {target}-mal Staatsanleihen',       'Diese Woche.',                                                'mission_bond',    'bond_bought',       'count',    '{"unlock":"bonds"}',     3, 3, 700, 900, 5, null, false, 50),

  -- milestones (base XP 100-2000): one story chain, three visible at a time
  ('m_first_trade',    'milestone', 'Dein erster Trade',                    'Kaufe dein erstes Wertpapier.',                               'mission_trade',   'trade',             'count',    '{}',                       1, 1, 100, 100, 1,  1, false, 100),
  ('m_first_vault',    'milestone', 'Erstes Grundeinkommen',                'Leere zum ersten Mal deinen Tresor.',                         'mission_vault',   'vault_claim',       'count',    '{}',                       1, 1, 100, 100, 1,  2, false, 100),
  ('m_first_profit',   'milestone', 'Dein erster Gewinn',                   'Verkaufe etwas teurer, als du es gekauft hast.',              'mission_profit',  'realized_profit',   'max',      '{}',                       1, 1, 150, 150, 1,  3, false, 100),
  ('m_three_sectors',  'milestone', 'Halte Aktien aus 3 Branchen',          'Ein gestreutes Depot schwankt weniger.',                      'mission_sectors', 'sectors_held',      'state',    '{}',                       3, 3, 200, 200, 1,  4, false, 100),
  ('m_nw_11k',         'milestone', 'Erreiche {target} Vermögen',           'Bargeld plus Wertpapiere zum Verkaufskurs.',                  'mission_growth',  'net_worth',         'state',    '{}',                 1100000, 1100000, 200, 200, 1, 5, false, 100),
  ('m_level_5',        'milestone', 'Erreiche Level {target}',              'Ab Level 5 gibt es Staatsanleihen.',                          'mission_growth',  'level',             'state',    '{}',                       5, 5, 300, 300, 1,  6, false, 100),
  ('m_first_limit',    'milestone', 'Deine erste Limit-Order',              'Setze eine Order mit eigenem Preis.',                         'mission_limit',   'limit_order',       'count',    '{"unlock":"limit_orders"}', 1, 1, 200, 200, 3, 7, false, 100),
  ('m_nw_12k',         'milestone', 'Erreiche {target} Vermögen',           'Bargeld plus Wertpapiere zum Verkaufskurs.',                  'mission_growth',  'net_worth',         'state',    '{}',                 1250000, 1250000, 300, 300, 1, 8, false, 100),
  ('m_first_bond',     'milestone', 'Deine erste Staatsanleihe',            'Kaufe eine Anleihe des Staates.',                             'mission_bond',    'bond_bought',       'count',    '{"unlock":"bonds"}',       1, 1, 300, 300, 5,  9, false, 100),
  ('m_trades_25',      'milestone', 'Mach {target} Trades',                 'Insgesamt, seit diese Mission sichtbar ist.',                 'mission_trade',   'trade',             'count',    '{}',                      25, 25, 300, 300, 1, 10, false, 100),
  ('m_nw_15k',         'milestone', 'Erreiche {target} Vermögen',           'Bargeld plus Wertpapiere zum Verkaufskurs.',                  'mission_growth',  'net_worth',         'state',    '{}',                 1500000, 1500000, 400, 400, 1, 11, false, 100),
  ('m_all_sectors',    'milestone', 'Halte Aktien aus allen 5 Branchen',    'Tech, Einzelhandel, Energie, Pharma und Logistik.',           'mission_sectors', 'sectors_held',      'state',    '{}',                       5, 5, 500, 500, 1, 12, false, 100),
  ('m_level_10',       'milestone', 'Erreiche Level {target}',              'Ab Level 10 kannst du eine Firma gründen.',                   'mission_growth',  'level',             'state',    '{}',                      10, 10, 600, 600, 1, 13, false, 100),
  ('m_nw_20k',         'milestone', 'Erreiche {target} Vermögen',           'Bargeld plus Wertpapiere zum Verkaufskurs.',                  'mission_growth',  'net_worth',         'state',    '{}',                 2000000, 2000000, 600, 600, 1, 14, false, 100),
  ('m_rich_100',       'milestone', 'Erreiche Platz 100 der Reichenliste',  'Unter allen Spielern und KI-Tycoons.',                        'mission_growth',  'rich_rank',         'state',    '{"rank":100}',             1, 1, 500, 500, 1, 15, false, 100),
  ('m_trades_100',     'milestone', 'Mach {target} Trades',                 'Insgesamt, seit diese Mission sichtbar ist.',                 'mission_trade',   'trade',             'count',    '{}',                     100, 100, 700, 700, 1, 16, false, 100),
  ('m_nw_30k',         'milestone', 'Erreiche {target} Vermögen',           'Bargeld plus Wertpapiere zum Verkaufskurs.',                  'mission_growth',  'net_worth',         'state',    '{}',                 3000000, 3000000, 800, 800, 1, 17, false, 100),
  ('m_rich_50',        'milestone', 'Erreiche Platz 50 der Reichenliste',   'Unter allen Spielern und KI-Tycoons.',                        'mission_growth',  'rich_rank',         'state',    '{"rank":50}',              1, 1, 900, 900, 1, 18, false, 100),
  ('m_nw_50k',         'milestone', 'Erreiche {target} Vermögen',           'Bargeld plus Wertpapiere zum Verkaufskurs.',                  'mission_growth',  'net_worth',         'state',    '{}',                 5000000, 5000000, 1000, 1000, 1, 19, false, 100),
  ('m_level_20',       'milestone', 'Erreiche Level {target}',              'Ab Level 20 wartet die GmbH.',                                'mission_growth',  'level',             'state',    '{}',                      20, 20, 1200, 1200, 1, 20, false, 100),
  ('m_nw_100k',        'milestone', 'Erreiche {target} Vermögen',           'Sechsstellig.',                                               'mission_growth',  'net_worth',         'state',    '{}',                10000000, 10000000, 1400, 1400, 1, 21, false, 100),
  ('m_rich_25',        'milestone', 'Erreiche Platz 25 der Reichenliste',   'Unter allen Spielern und KI-Tycoons.',                        'mission_growth',  'rich_rank',         'state',    '{"rank":25}',              1, 1, 1500, 1500, 1, 22, false, 100),
  ('m_nw_250k',        'milestone', 'Erreiche {target} Vermögen',           'Eine Viertelmillion.',                                        'mission_growth',  'net_worth',         'state',    '{}',                25000000, 25000000, 1700, 1700, 1, 23, false, 100),
  ('m_rich_10',        'milestone', 'Erreiche Platz 10 der Reichenliste',   'Die Top 10 der NEXA.',                                        'mission_growth',  'rich_rank',         'state',    '{"rank":10}',              1, 1, 1800, 1800, 1, 24, false, 100),
  ('m_nw_1m',          'milestone', 'Werde Millionär',                      'Erreiche {target} Vermögen.',                                 'mission_growth',  'net_worth',         'state',    '{}',               100000000, 100000000, 2000, 2000, 1, 25, false, 100),
  ('m_rich_1',         'milestone', 'Werde die reichste Person der NEXA',   'Platz 1 der Reichenliste.',                                   'mission_growth',  'rich_rank',         'state',    '{"rank":1}',               1, 1, 2000, 2000, 1, 26, false, 100)
on conflict (key) do update
   set kind = excluded.kind, title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params, target_min = excluded.target_min,
       target_max = excluded.target_max, xp_min = excluded.xp_min, xp_max = excluded.xp_max, min_level = excluded.min_level,
       chain_order = excluded.chain_order, scale_with_level = excluded.scale_with_level, weight = excluded.weight, is_active = true;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.mission_is_money_metric(p_metric text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_metric in ('trade_value', 'buy_value', 'realized_profit', 'net_worth');
$$;

-- "{target}" in titles and descriptions: euros for money metrics ("2.000 €"), else the number
create or replace function public.mission_text(p_text text, p_metric text, p_target bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(p_text, '{target}',
           case when public.mission_is_money_metric(p_metric)
                then replace(to_char(p_target / 100, 'FM999G999G999G990'), ',', '.') || ' €'
                else p_target::text end);
$$;

-- Current value of a state metric for a player.
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
    else
      return 0;
  end case;
end;
$$;

-- Advances the player's active missions for one event.
create or replace function public.mission_event(p_player uuid, p_metric text, p_amount bigint default 1, p_ref text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m     record;
  v_new bigint;
  v_st  jsonb;
  v_n   integer := 0;
begin
  if p_player is null then
    return 0;
  end if;
  for m in
    select pm.id, pm.progress, pm.target, pm.state, t.mode, t.params
      from public.player_missions pm
      join public.mission_templates t on t.key = pm.template_key
     where pm.player_id = p_player and pm.status = 'active' and t.metric = p_metric and t.mode <> 'state'
       and (pm.expires_at is null or pm.expires_at > public.game_now())
       for update of pm
  loop
    continue when m.params ? 'sector' and (m.params ->> 'sector') is distinct from p_ref;
    v_st := m.state;
    v_new := case m.mode
               when 'count' then m.progress + 1
               when 'sum' then m.progress + greatest(coalesce(p_amount, 0), 0)
               when 'max' then greatest(m.progress, coalesce(p_amount, 0))
               when 'distinct' then m.progress
               else m.progress end;
    if m.mode = 'distinct' then
      continue when p_ref is null or coalesce(v_st -> 'seen', '[]'::jsonb) ? p_ref;
      v_st := jsonb_set(v_st, '{seen}', coalesce(v_st -> 'seen', '[]'::jsonb) || to_jsonb(p_ref));
      v_new := m.progress + 1;
    end if;
    update public.player_missions
       set progress = least(v_new, target), state = v_st,
           status = case when v_new >= target then 'completed'::public.mission_status else status end,
           completed_at = case when v_new >= target then now() else completed_at end
     where id = m.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Recomputes state missions (net worth, level, sectors held, rich list rank).
create or replace function public.mission_refresh_state(p_player uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m     record;
  v_val bigint;
  v_n   integer := 0;
begin
  for m in
    select pm.id, pm.progress, pm.target, pm.state, t.metric, t.params
      from public.player_missions pm
      join public.mission_templates t on t.key = pm.template_key
     where pm.player_id = p_player and pm.status = 'active' and t.mode = 'state'
       and (pm.expires_at is null or pm.expires_at > public.game_now())
       for update of pm
  loop
    v_val := public.mission_state_value(p_player, m.metric, m.params, m.state);
    if least(v_val, m.target) <> m.progress or v_val >= m.target then
      update public.player_missions
         set progress = least(v_val, target),
             status = case when v_val >= target then 'completed'::public.mission_status else status end,
             completed_at = case when v_val >= target then now() else completed_at end
       where id = m.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Lazily assigns the missing missions of every kind (idempotent; serialised per player).
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
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_my_missions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_mult   double precision := public.config_double('progression', '{xpMultiplier}', 2);
  v_today  date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_monday date;
begin
  v_player := public.require_player();
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  perform public.missions_assign(v_player);
  perform public.mission_refresh_state(v_player);
  return jsonb_build_object(
    'server_time', public.game_now(),
    'groups', (
      select jsonb_agg(jsonb_build_object(
               'kind', g.kind,
               'resets_at', case g.kind when 'daily' then ((v_today + 1)::timestamp) at time zone 'Europe/Berlin'
                                        when 'weekly' then ((v_monday + 7)::timestamp) at time zone 'Europe/Berlin' end,
               'missions', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', m.id, 'key', m.template_key,
                          'title', public.mission_text(t.title, t.metric, m.target),
                          'description', public.mission_text(t.description, t.metric, m.target),
                          'progress', m.progress, 'target', m.target,
                          'xp', greatest(0, round(m.xp_reward * v_mult))::integer,
                          'status', m.status, 'expires_at', m.expires_at)
                          order by t.chain_order nulls last, m.created_at, m.id)
                   from public.player_missions m
                   join public.mission_templates t on t.key = m.template_key
                  where m.player_id = v_player and m.kind = g.kind
                    and case g.kind
                          when 'quick' then m.status in ('active', 'completed')
                          when 'daily' then m.period_start = v_today and m.status <> 'expired'
                          when 'weekly' then m.period_start = v_monday and m.status <> 'expired'
                          else m.status in ('active', 'completed') end), '[]'::jsonb))
               order by g.ord)
        from (values ('quick', 1), ('daily', 2), ('weekly', 3), ('milestone', 4)) as g(kind, ord)));
end;
$$;

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
  if m.kind = 'quick' or m.kind = 'milestone' then
    perform public.missions_assign(v_player);
  end if;
  select * into v_prof from public.profiles where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'xp_awarded', v_xp, 'level', v_prof.level, 'xp_total', v_prof.xp_total));
end;
$$;

-- Once per Berlin calendar day: progression.xpSources.dailyLogin XP plus a
-- streak bonus. One missed day is bridged by a streak freeze
-- (streakFreezesPerWeek, refilled every Monday).
create or replace function public.daily_check_in(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_login  jsonb := coalesce(public.config_jsonb('progression', '{xpSources,dailyLogin}'), '{}'::jsonb);
  v_today  date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_monday date;
  ls       public.login_streaks;
  v_streak integer;
  v_freeze boolean := false;
  v_xp     integer := 0;
  v_already boolean := false;
  v_prof   public.profiles;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'daily_check_in');
  if v_replay is not null then
    return v_replay;
  end if;
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  insert into public.login_streaks (player_id) values (v_player) on conflict do nothing;
  select * into ls from public.login_streaks where player_id = v_player for update;
  if ls.freeze_granted_week is null or ls.freeze_granted_week < v_monday then
    ls.freeze_tokens := public.cfg_num(v_login, '{streakFreezesPerWeek}', 1)::smallint;
    ls.freeze_granted_week := v_monday;
  end if;

  if ls.last_login_day = v_today then
    v_already := true;
    v_streak := ls.current_streak;
  else
    if ls.last_login_day = v_today - 1 then
      v_streak := ls.current_streak + 1;
    elsif ls.last_login_day = v_today - 2 and ls.freeze_tokens > 0 then
      v_streak := ls.current_streak + 1;
      v_freeze := true;
      ls.freeze_tokens := ls.freeze_tokens - 1;
    else
      v_streak := 1;
    end if;
    v_xp := public.grant_xp(v_player, 'daily_login',
              (public.cfg_num(v_login, '{xp}', 50)
               + least(public.cfg_num(v_login, '{streakBonusCap}', 200),
                       greatest(0, v_streak - 1) * public.cfg_num(v_login, '{streakBonusPerDay}', 10)))::integer,
              'login:' || v_today::text, 'daily_login', null);
    insert into public.daily_logins (player_id, login_day, streak_day, xp_awarded, freeze_used)
    values (v_player, v_today, v_streak, v_xp, v_freeze)
    on conflict do nothing;
    perform public.mission_event(v_player, 'check_in', 1, v_today::text);
  end if;
  update public.login_streaks
     set current_streak = v_streak, longest_streak = greatest(longest_streak, v_streak), last_login_day = v_today,
         freeze_tokens = ls.freeze_tokens, freeze_granted_week = ls.freeze_granted_week
   where player_id = v_player;
  select * into v_prof from public.profiles where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'xp_awarded', v_xp, 'streak_days', v_streak, 'already_checked_in', v_already,
    'freeze_used', v_freeze, 'level', v_prof.level, 'xp_total', v_prof.xp_total));
end;
$$;

-- Client events for low-XP quick missions; whitelisted and capped per day.
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
  v_cap := case p_kind when 'view_security' then 50 when 'open_rich_list' then 20 when 'open_rules' then 20 end;
  if v_cap is null then
    perform public.api_error('invalid_argument');
  end if;
  if p_kind = 'view_security' then
    select s.ticker into v_ref from public.securities s where s.id = public.resolve_security(p_ref);
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.mission_is_money_metric(text)', 'public.mission_text(text, text, bigint)',
    'public.mission_state_value(uuid, text, jsonb, jsonb)', 'public.mission_event(uuid, text, bigint, text)',
    'public.mission_refresh_state(uuid)', 'public.missions_assign(uuid)', 'public.get_my_missions()',
    'public.claim_mission(uuid, uuid)', 'public.daily_check_in(uuid)', 'public.track_event(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.get_my_missions() to authenticated;
  grant execute on function public.claim_mission(uuid, uuid) to authenticated;
  grant execute on function public.daily_check_in(uuid) to authenticated;
  grant execute on function public.track_event(text, text) to authenticated;
end;
$$;
