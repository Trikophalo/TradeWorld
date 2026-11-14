-- =============================================================================
-- NEXA · 0200 · Missions cleanup, many new missions and ten new AI companies (ADR-130)
-- =============================================================================
-- 1. Missions about limit orders (ADR-117) are gone for good: the metric "limit_order" of the M4a batch was
--    still active. Running ones end (expired); completed ones can still be claimed.
-- 2. 67 new mission templates: company tasks and business moves, more trading, home, art and work
--    missions. New metrics: task_done, task_perfect, task_delegated (company tasks, ADR-129), move_started,
--    move_success (business moves, ADR-127, through a trigger on company_moves). New requirement "team": founder or
--    employee of a player company.
-- 3. Ten new AI companies, two per sector, each with its own character (ai_companies_add_v2()). On a fresh
--    database seed.sql calls the function after the first 15; on a live database this migration does. They join
--    the market but not the NEXA 30 index (the index keeps its members and divisor). Opening cash (a tenth of a quarter's
--    costs) comes from the mint before the money genesis, afterwards from the households.
-- 4. get_company_profile() also returns the latest market news about the company ("news").
-- Idempotent: runs unchanged as supabase/updates/20261204000200_missions_ai_companies.sql.

-- ---------------------------------------------------------------------------
-- 1. Limit-order missions off
-- ---------------------------------------------------------------------------
update public.mission_templates set is_active = false, updated_at = now()
 where metric in ('limit_order', 'limit_orders_placed', 'limit_orders_filled') and is_active;
update public.player_missions pm set status = 'expired'
  from public.mission_templates t
 where t.key = pm.template_key and pm.status = 'active'
   and t.metric in ('limit_order', 'limit_orders_placed', 'limit_orders_filled');

-- ---------------------------------------------------------------------------
-- 2. New missions
-- ---------------------------------------------------------------------------
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
           when 'team' then exists (select 1 from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active')
                            or exists (select 1 from public.player_jobs j
                                         join public.player_companies pc on pc.company_id = j.company_id and pc.status = 'active'
                                        where j.player_id = p_player and j.status = 'active')
           when 'skill_point' then coalesce((select sp.free_points > 0 from public.player_skill_points sp where sp.player_id = p_player), false)
           when 'artwork' then exists (select 1 from public.artworks a where a.owner_id = p_player
                                         and not exists (select 1 from public.artwork_auctions x
                                                          where x.artwork_id = a.id and x.status = 'open'))
           else false end;
$$;
comment on function public.mission_requirement_ok(uuid, text) is
  'Internal: mission_templates.params.requires (job, company, team, skill_point, artwork) is met by the player.';

insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  ('q_task_done', 'quick', 'Erledige eine Firmenaufgabe', 'Egal ob verpacken, zählen oder rechnen: Hauptsache richtig.', 'mission_company', 'task_done', 'count', '{"requires":"team"}'::jsonb, 1, 1, 40, 60, 3, null, false, 70, 0),
  ('q_task_delegate', 'quick', 'Gib eine Aufgabe ab', 'Delegiere eine Firmenaufgabe an dein Team oder die KI.', 'mission_company', 'task_delegated', 'count', '{"requires":"team"}'::jsonb, 1, 1, 30, 50, 3, null, false, 50, 0),
  ('q_move', 'quick', 'Starte einen Geschäftszug', 'Wähle einen Zug, der zu deiner Firma passt.', 'mission_company', 'move_started', 'count', '{"unlock":"found_garage","requires":"company"}'::jsonb, 1, 1, 40, 60, 3, null, false, 60, 0),
  ('q_buy_2', 'quick', 'Kaufe {target} Aktien', 'Zwei Käufe, egal welche.', 'mission_trade', 'buy', 'count', '{}'::jsonb, 2, 2, 30, 40, 1, null, false, 60, 0),
  ('q_sell_1', 'quick', 'Verkaufe eine Position', 'Gewinne sichern oder Verluste begrenzen.', 'mission_trade', 'sell', 'count', '{}'::jsonb, 1, 1, 30, 40, 1, null, false, 50, 0),
  ('q_buy_tech', 'quick', 'Kaufe eine Tech-Aktie', 'Software, Chips, Cloud.', 'mission_sectors', 'buy_sector', 'count', '{"sector":"tech"}'::jsonb, 1, 1, 30, 40, 1, null, false, 25, 0),
  ('q_buy_energy', 'quick', 'Kaufe eine Energie-Aktie', 'Strom, Netze, Speicher.', 'mission_sectors', 'buy_sector', 'count', '{"sector":"energy"}'::jsonb, 1, 1, 30, 40, 1, null, false, 25, 0),
  ('q_buy_pharma', 'quick', 'Kaufe eine Pharma-Aktie', 'Medikamente und Medizintechnik.', 'mission_sectors', 'buy_sector', 'count', '{"sector":"pharma"}'::jsonb, 1, 1, 30, 40, 1, null, false, 25, 0),
  ('q_buy_retail', 'quick', 'Kaufe eine Handels-Aktie', 'Vom Bäcker bis zum Onlineshop.', 'mission_sectors', 'buy_sector', 'count', '{"sector":"retail"}'::jsonb, 1, 1, 30, 40, 1, null, false, 25, 0),
  ('q_buy_logistics', 'quick', 'Kaufe eine Logistik-Aktie', 'Pakete, Lager, Schiffe.', 'mission_sectors', 'buy_sector', 'count', '{"sector":"logistics"}'::jsonb, 1, 1, 30, 40, 1, null, false, 25, 0),
  ('q_profit', 'quick', 'Mach einen Gewinn', 'Verkaufe etwas teurer, als du es gekauft hast.', 'mission_profit', 'realized_profit', 'max', '{}'::jsonb, 1, 1, 40, 60, 1, null, false, 50, 0),
  ('q_vault', 'quick', 'Leere deinen Tresor', 'Das Geld wartet schon.', 'mission_vault', 'vault_claim', 'count', '{}'::jsonb, 1, 1, 20, 30, 1, null, false, 50, 0),
  ('q_profiles_2', 'quick', 'Sieh dir {target} Profile an', 'Wer spielt sonst noch mit?', 'mission_growth', 'view_profile', 'distinct', '{}'::jsonb, 2, 2, 30, 40, 1, null, false, 40, 0),
  ('q_securities_2', 'quick', 'Kaufe {target} verschiedene Wertpapiere', 'Streuen ist besser als alles auf eine Karte.', 'mission_trade', 'distinct_security', 'distinct', '{}'::jsonb, 2, 2, 40, 50, 1, null, false, 40, 0),
  ('q_check_in', 'quick', 'Melde dich zur Arbeit', 'Stempel ein und los.', 'mission_work', 'check_in', 'count', '{"unlock":"first_job","requires":"job"}'::jsonb, 1, 1, 20, 30, 2, null, false, 40, 0),
  ('q_art_like_2', 'quick', 'Like {target} Kunstwerke', 'Zeig, was dir gefällt.', 'mission_art', 'art_like', 'distinct', '{"unlock":"artworks"}'::jsonb, 2, 2, 30, 40, 8, null, false, 35, 0),
  ('q_furniture', 'quick', 'Kauf ein Möbelstück', 'Dein Zuhause soll gemütlich werden.', 'mission_home', 'furniture_bought', 'count', '{"unlock":"property"}'::jsonb, 1, 1, 30, 50, 4, null, false, 35, 0),
  ('q_bond', 'quick', 'Kauf eine Anleihe', 'Sicherer Zins für dein Depot.', 'mission_bond', 'bond_bought', 'count', '{"unlock":"bonds"}'::jsonb, 1, 1, 30, 50, 5, null, false, 35, 0),
  ('q_job_post', 'quick', 'Schreib eine Stelle aus', 'Mehr Leute, mehr Möglichkeiten.', 'mission_company', 'job_posted', 'count', '{"unlock":"found_garage","requires":"company"}'::jsonb, 1, 1, 40, 60, 3, null, false, 35, 0),
  ('q_big_buy', 'quick', 'Kaufe für mindestens {target} €', 'Ein mutiger Kauf auf einmal.', 'mission_trade', 'buy_value', 'max', '{}'::jsonb, 100000, 100000, 40, 60, 2, null, true, 40, 0),
  ('d_tasks_3', 'daily', 'Erledige {target} Firmenaufgaben', 'Jede richtig gelöste Aufgabe zählt.', 'mission_company', 'task_done', 'count', '{"requires":"team"}'::jsonb, 2, 4, 250, 350, 3, null, false, 80, 0),
  ('d_task_perfect', 'daily', 'Löse eine Aufgabe fehlerfrei', '100 Prozent richtig, keine Ausreden.', 'mission_company', 'task_perfect', 'count', '{"requires":"team"}'::jsonb, 1, 1, 250, 350, 3, null, false, 60, 0),
  ('d_tasks_delegate', 'daily', 'Delegiere {target} Aufgaben', 'Ein guter Chef verteilt die Arbeit.', 'mission_company', 'task_delegated', 'count', '{"requires":"team"}'::jsonb, 2, 3, 200, 300, 3, null, false, 50, 0),
  ('d_moves_2', 'daily', 'Starte {target} Geschäftszüge', 'Verschiedene Züge bringen mehr.', 'mission_company', 'move_started', 'count', '{"unlock":"found_garage","requires":"company"}'::jsonb, 2, 3, 250, 350, 3, null, false, 60, 0),
  ('d_move_win', 'daily', 'Lande einen erfolgreichen Geschäftszug', 'Auch die riskanten zählen.', 'mission_company', 'move_success', 'count', '{"unlock":"found_garage","requires":"company"}'::jsonb, 1, 1, 250, 400, 3, null, false, 60, 0),
  ('d_sells_3', 'daily', 'Verkaufe {target}-mal', 'Nimm Gewinne mit.', 'mission_trade', 'sell', 'count', '{}'::jsonb, 3, 4, 250, 300, 1, null, false, 50, 0),
  ('d_buys_5', 'daily', 'Kaufe {target}-mal', 'Fleißig investieren.', 'mission_trade', 'buy', 'count', '{}'::jsonb, 5, 6, 250, 300, 1, null, false, 50, 0),
  ('d_profit_3', 'daily', 'Mach {target}-mal Gewinn', 'Drei gute Verkäufe am Tag.', 'mission_profit', 'realized_profit', 'count', '{}'::jsonb, 2, 3, 300, 400, 2, null, false, 50, 0),
  ('d_sectors_4', 'daily', 'Kaufe in {target} Branchen', 'Breit aufgestellt sein.', 'mission_sectors', 'sectors_bought', 'distinct', '{}'::jsonb, 4, 4, 300, 400, 3, null, false, 40, 0),
  ('d_securities_5', 'daily', 'Kaufe {target} verschiedene Wertpapiere', 'Ein bunter Korb.', 'mission_trade', 'distinct_security', 'distinct', '{}'::jsonb, 5, 5, 300, 400, 3, null, false, 40, 0),
  ('d_volume_big', 'daily', 'Handle für {target} €', 'Großer Umsatz am Tag.', 'mission_trade', 'trade_value', 'sum', '{}'::jsonb, 1000000, 2000000, 300, 400, 5, null, true, 50, 0),
  ('d_art_bid_1', 'daily', 'Gib ein Gebot auf ein Kunstwerk ab', 'Vielleicht wird es deins.', 'mission_art', 'art_bid', 'count', '{"unlock":"artworks"}'::jsonb, 1, 1, 200, 250, 8, null, false, 40, 0),
  ('d_furniture_2', 'daily', 'Kauf {target} Möbelstücke', 'Einrichten macht Spaß.', 'mission_home', 'furniture_bought', 'count', '{"unlock":"property"}'::jsonb, 2, 2, 250, 300, 4, null, false, 35, 0),
  ('d_skill', 'daily', 'Lerne eine neue Fähigkeit', 'Ein Punkt wartet auf dich.', 'mission_skill', 'skill_learned', 'count', '{"requires":"skill_point"}'::jsonb, 1, 1, 250, 300, 2, null, false, 40, 0),
  ('d_bonds_2', 'daily', 'Kauf {target} Anleihen', 'Sicher ist sicher.', 'mission_bond', 'bond_bought', 'count', '{"unlock":"bonds"}'::jsonb, 2, 2, 250, 300, 5, null, false, 35, 0),
  ('d_deposit', 'daily', 'Stärke deine Firmenkasse', 'Zahle Geld in deine Firma ein.', 'mission_company', 'company_deposit', 'count', '{"unlock":"found_garage","requires":"company"}'::jsonb, 1, 1, 200, 250, 3, null, false, 40, 0),
  ('d_check_in_2', 'daily', 'Melde dich {target}-mal zur Arbeit', 'Pünktlich sein lohnt sich.', 'mission_work', 'check_in', 'count', '{"unlock":"first_job","requires":"job"}'::jsonb, 2, 2, 200, 250, 2, null, false, 40, 0),
  ('w_tasks_15', 'weekly', 'Erledige {target} Firmenaufgaben', 'Die Firma läuft, weil du anpackst.', 'mission_company', 'task_done', 'count', '{"requires":"team"}'::jsonb, 12, 18, 900, 1200, 3, null, false, 80, 1),
  ('w_tasks_perfect', 'weekly', 'Löse {target} Aufgaben fehlerfrei', 'Präzision ist dein zweiter Vorname.', 'mission_company', 'task_perfect', 'count', '{"requires":"team"}'::jsonb, 5, 8, 900, 1200, 3, null, false, 60, 1),
  ('w_delegate_10', 'weekly', 'Delegiere {target} Aufgaben', 'Führen heißt verteilen.', 'mission_company', 'task_delegated', 'count', '{"requires":"team"}'::jsonb, 8, 12, 800, 1000, 3, null, false, 50, 1),
  ('w_moves_10', 'weekly', 'Starte {target} Geschäftszüge', 'Jeden Tag ein neuer Plan.', 'mission_company', 'move_started', 'count', '{"unlock":"found_garage","requires":"company"}'::jsonb, 8, 12, 900, 1200, 3, null, false, 60, 1),
  ('w_move_wins', 'weekly', 'Lande {target} erfolgreiche Geschäftszüge', 'Gewinner ziehen klug.', 'mission_company', 'move_success', 'count', '{"unlock":"found_garage","requires":"company"}'::jsonb, 5, 8, 1000, 1300, 3, null, false, 60, 1),
  ('w_sells_15', 'weekly', 'Verkaufe {target}-mal', 'Ein aktiver Händler.', 'mission_trade', 'sell', 'count', '{}'::jsonb, 12, 18, 800, 1000, 1, null, false, 50, 1),
  ('w_profit_10', 'weekly', 'Mach {target}-mal Gewinn', 'Eine Woche voller grüner Zahlen.', 'mission_profit', 'realized_profit', 'count', '{}'::jsonb, 8, 12, 900, 1200, 2, null, false, 50, 1),
  ('w_sectors_5', 'weekly', 'Kaufe in allen {target} Branchen', 'Der ganze Markt in einer Woche.', 'mission_sectors', 'sectors_bought', 'distinct', '{}'::jsonb, 5, 5, 900, 1100, 3, null, false, 40, 1),
  ('w_securities_10', 'weekly', 'Kaufe {target} verschiedene Wertpapiere', 'Ein richtig breites Depot.', 'mission_trade', 'distinct_security', 'distinct', '{}'::jsonb, 10, 10, 900, 1200, 4, null, false, 40, 1),
  ('w_art_likes', 'weekly', 'Like {target} Kunstwerke', 'Ein Herz für Kunst.', 'mission_art', 'art_like', 'distinct', '{"unlock":"artworks"}'::jsonb, 8, 10, 600, 800, 8, null, false, 35, 1),
  ('w_furniture', 'weekly', 'Kauf {target} Möbelstücke', 'Ein Zuhause wie aus dem Katalog.', 'mission_home', 'furniture_bought', 'count', '{"unlock":"property"}'::jsonb, 6, 8, 700, 900, 4, null, false, 35, 1),
  ('w_vault_10', 'weekly', 'Leere deinen Tresor {target}-mal', 'Regelmäßig abholen.', 'mission_vault', 'vault_claim', 'count', '{}'::jsonb, 8, 12, 600, 800, 1, null, false, 40, 1),
  ('w_check_in', 'weekly', 'Melde dich {target}-mal zur Arbeit', 'Die ganze Woche dabei.', 'mission_work', 'check_in', 'count', '{"unlock":"first_job","requires":"job"}'::jsonb, 5, 7, 700, 900, 2, null, false, 40, 1),
  ('m_first_task', 'milestone', 'Deine erste Firmenaufgabe', 'Erledige eine Aufgabe für deine Firma richtig.', 'mission_company', 'task_done', 'count', '{"requires":"team"}'::jsonb, 1, 1, 300, 300, 3, 12, false, 50, 1),
  ('m_tasks_25', 'milestone', '25 Firmenaufgaben', 'Auf dich ist Verlass.', 'mission_company', 'task_done', 'count', '{"requires":"team"}'::jsonb, 25, 25, 800, 800, 3, 18, false, 50, 1),
  ('m_tasks_100', 'milestone', '100 Firmenaufgaben', 'Eine Legende der Werkbank.', 'mission_company', 'task_done', 'count', '{"requires":"team"}'::jsonb, 100, 100, 1500, 1500, 3, 24, false, 50, 1),
  ('m_first_delegate', 'milestone', 'Deine erste Delegation', 'Gib eine Aufgabe an jemand anderen ab.', 'mission_company', 'task_delegated', 'count', '{"requires":"team"}'::jsonb, 1, 1, 300, 300, 3, 13, false, 50, 1),
  ('m_perfect_10', 'milestone', '10 fehlerfreie Aufgaben', 'Perfektionist.', 'mission_company', 'task_perfect', 'count', '{"requires":"team"}'::jsonb, 10, 10, 800, 800, 3, 19, false, 50, 1),
  ('m_first_move', 'milestone', 'Dein erster Geschäftszug', 'Starte einen Geschäftszug.', 'mission_company', 'move_started', 'count', '{"unlock":"found_garage","requires":"company"}'::jsonb, 1, 1, 300, 300, 3, 12, false, 50, 1),
  ('m_moves_win_20', 'milestone', '20 erfolgreiche Geschäftszüge', 'Ein echter Stratege.', 'mission_company', 'move_success', 'count', '{"unlock":"found_garage","requires":"company"}'::jsonb, 20, 20, 1200, 1200, 3, 20, false, 50, 1),
  ('m_trades_100', 'milestone', '100 Trades', 'Ein echter Börsenprofi.', 'mission_trade', 'trade', 'count', '{}'::jsonb, 100, 100, 1000, 1000, 1, 15, false, 50, 1),
  ('m_trades_500', 'milestone', '500 Trades', 'Die Börse ist dein Zuhause.', 'mission_trade', 'trade', 'count', '{}'::jsonb, 500, 500, 2000, 2000, 1, 24, false, 50, 1),
  ('m_securities_15', 'milestone', '15 verschiedene Wertpapiere', 'Du kennst den ganzen Markt.', 'mission_trade', 'distinct_security', 'distinct', '{}'::jsonb, 15, 15, 1000, 1000, 3, 18, false, 50, 1),
  ('m_level_30', 'milestone', 'Level 30', 'Ganz oben angekommen? Noch lange nicht.', 'mission_growth', 'level', 'state', '{}'::jsonb, 30, 30, 1800, 1800, 1, 26, false, 50, 1),
  ('m_nw_500k', 'milestone', 'Eine halbe Million', '500.000 € Vermögen.', 'mission_profit', 'net_worth', 'state', '{}'::jsonb, 50000000, 50000000, 1900, 1900, 1, 24, false, 50, 1),
  ('m_art_likes_50', 'milestone', '50 Likes verteilt', 'Ein großer Kunstfreund.', 'mission_art', 'art_like', 'distinct', '{"unlock":"artworks"}'::jsonb, 50, 50, 800, 800, 8, 19, false, 50, 1),
  ('m_furniture_20', 'milestone', '20 Möbelstücke gekauft', 'Ein Zuhause zum Vorzeigen.', 'mission_home', 'furniture_bought', 'count', '{"unlock":"property"}'::jsonb, 20, 20, 900, 900, 4, 22, false, 50, 1),
  ('m_job_posts_5', 'milestone', '5 Stellen ausgeschrieben', 'Eine Firma, die wächst.', 'mission_company', 'job_posted', 'count', '{"unlock":"found_garage","requires":"company"}'::jsonb, 5, 5, 800, 800, 3, 17, false, 50, 1),
  ('m_work_200', 'milestone', '200 Arbeitsstunden', 'Fleiß zahlt sich aus.', 'mission_work', 'work_hours', 'sum', '{"unlock":"first_job","requires":"job"}'::jsonb, 200, 200, 1500, 1500, 2, 21, false, 50, 1),
  ('m_vault_100', 'milestone', '100 Mal den Tresor geleert', 'Das Geld fließt.', 'mission_vault', 'vault_claim', 'count', '{}'::jsonb, 100, 100, 900, 900, 1, 18, false, 50, 1)
on conflict (key) do update
   set title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params,
       target_min = excluded.target_min, target_max = excluded.target_max, xp_min = excluded.xp_min,
       xp_max = excluded.xp_max, min_level = excluded.min_level, chain_order = excluded.chain_order,
       scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true, updated_at = now();

-- business moves count for missions
create or replace function public.company_moves_mission_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.mission_event(new.started_by, 'move_started', 1, new.id::text);
  elsif new.status = 'success' and old.status = 'running' then
    perform public.mission_event(new.started_by, 'move_success', 1, new.id::text);
  end if;
  return null;
end;
$$;
revoke all on function public.company_moves_mission_trigger() from public, anon, authenticated;
drop trigger if exists company_moves_missions on public.company_moves;
create trigger company_moves_missions after insert or update of status on public.company_moves
  for each row execute function public.company_moves_mission_trigger();

-- ---------------------------------------------------------------------------
-- 3. Ten new AI companies
-- ---------------------------------------------------------------------------
create or replace function public.ai_companies_add_v2()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_n      integer := 0;
  v_co     uuid;
  v_sec    uuid;
  v_tick   bigint;
  v_spread integer;
  v_half   bigint;
  v_acc    uuid;
  v_from   uuid;
  v_amount bigint;
  v_avail  bigint;
begin
  -- a fresh database gets the companies from seed.sql (sectors and the first companies come first)
  if not exists (select 1 from public.sectors where key = 'tech')
     or not exists (select 1 from public.companies where ticker = 'KLS' and is_ai) then
    return 0;
  end if;
  for r in
    select x.ticker, x.name, x.slug, x.sector_key, x.tier, x.description, x.brand_color, x.shares::bigint as shares,
           x.price_e4::bigint as price_e4, x.revenue_eur::bigint as revenue_eur, x.costs_eur::bigint as costs_eur,
           x.quality::double precision as quality, x.awareness::double precision as awareness,
           x.price_index::double precision as price_index, x.dividend_policy, x.payout_bps::integer as payout_bps,
           x.employees::integer as employees
      from (values
      ('HLX', 'Helix Robotik', 'helix-robotik', 'tech', 'midcap', 'Baut Haushaltsroboter, die putzen, kochen und den Müll rausbringen. Manchmal auch den Hund.', '#3DDC97', 18000000, 214000, 55000000, 50500000, 1.1, 0.95, 1.05, 'none', 0, 1600),
      ('MEM', 'Memeland Media', 'memeland-media', 'tech', 'penny', 'Kurzvideo-App für Memes. Kaum Gewinn, riesige Fangemeinde, und die Aktie macht, was das Internet will.', '#FF4FD8', 90000000, 5100, 3000000, 2850000, 0.75, 0.85, 1.1, 'none', 0, 60),
      ('LUX', 'Glanz & Gloria', 'glanz-und-gloria', 'retail', 'bluechip', 'Luxuskonzern für Uhren, Schmuck und Handtaschen. Verkauft Status, auch wenn die Wirtschaft schwächelt.', '#D4AF37', 40000000, 960000, 520000000, 455000000, 1.35, 1.45, 1.2, 'stable', 4000, 9000),
      ('SNK', 'Knusperkönig', 'knusperkoenig', 'retail', 'penny', 'Chips-Marke mit verrückten Sorten wie Gurke-Vanille. Jeder neue Geschmack ist ein Hit oder ein Desaster.', '#FF9F1C', 55000000, 7400, 12000000, 11700000, 0.95, 0.8, 0.95, 'none', 0, 340),
      ('WND', 'Nordbrise Offshore', 'nordbrise-offshore', 'energy', 'midcap', 'Betreibt Windparks in der Nordsee. Verdient prächtig bei Sturm und leidet bei Flaute.', '#6EC1E4', 25000000, 272000, 95000000, 86000000, 1.1, 0.9, 1.0, 'stable', 3000, 1900),
      ('FSN', 'Sonnenkern Fusion', 'sonnenkern-fusion', 'energy', 'penny', 'Will die Kernfusion in einen Container bauen. Noch kein Strom, aber jede Menge Hoffnung.', '#FF5E5B', 70000000, 3600, 200000, 1800000, 0.85, 0.55, 1.3, 'none', 0, 75),
      ('MTH', 'Methusalem Bio', 'methusalem-bio', 'pharma', 'penny', 'Forscht an Pillen gegen das Altern. Die Mäuse im Labor werden immer älter, die Aktionäre nervöser.', '#B388EB', 65000000, 5800, 1500000, 2200000, 0.9, 0.6, 1.2, 'none', 0, 110),
      ('PFW', 'Pfotenwohl', 'pfotenwohl', 'pharma', 'midcap', 'Medikamente und Futter für Haustiere. Wer Hund und Katze liebt, spart nicht beim Tierarzt.', '#8BC34A', 16000000, 315000, 64000000, 57000000, 1.15, 1.0, 1.0, 'growth', 2000, 2300),
      ('DRN', 'Luftpost Drohnen', 'luftpost-drohnen', 'logistics', 'penny', 'Liefert Pakete per Drohne in 20 Minuten. Wenn kein Wind weht und keine Möwe angreift.', '#00B4D8', 50000000, 6900, 7000000, 7200000, 0.9, 0.7, 0.95, 'none', 0, 180),
      ('OFR', 'Orbitfracht', 'orbitfracht', 'logistics', 'midcap', 'Bringt Satelliten und Fracht ins All. Jeder Start ist ein Ereignis, jeder Fehlstart auch.', '#5C6BC0', 22000000, 188000, 70000000, 66000000, 1.05, 0.85, 1.05, 'none', 0, 1400)
    ) as x(ticker, name, slug, sector_key, tier, description, brand_color, shares, price_e4, revenue_eur, costs_eur,
           quality, awareness, price_index, dividend_policy, payout_bps, employees)
  loop
    v_co := md5('nexa:company:' || r.ticker)::uuid;
    v_sec := md5('nexa:security:' || r.ticker)::uuid;
    continue when exists (select 1 from public.companies where id = v_co);
    v_tick := case when r.price_e4 < 10000 then 10 else 100 end;
    v_spread := case r.tier when 'bluechip' then 6 when 'midcap' then 20 else 150 end;
    v_half := greatest(v_tick, (r.price_e4 * v_spread / 20000 / v_tick) * v_tick);

    insert into public.companies (
      id, name, slug, ticker, description, sector_key, is_ai, tier, legal_form, phase, logo_key, brand_color,
      shares_outstanding, max_employees, employee_count, dividend_policy, dividend_payout_bps,
      ttm_revenue_cents, ttm_net_income_cents, eps_ttm_e4, listed_at)
    values (v_co, r.name, r.slug, r.ticker, r.description, r.sector_key, true, r.tier::public.company_tier, 'ag', 'listed',
            'logo_' || lower(r.ticker), r.brand_color, r.shares, 100000, r.employees,
            r.dividend_policy::public.dividend_policy, r.payout_bps,
            r.revenue_eur * 100 * 4, (r.revenue_eur - r.costs_eur) * 100 * 4,
            round((r.revenue_eur - r.costs_eur)::numeric * 100 * 4 * 100 / r.shares)::bigint, now());
    insert into public.company_state (company_id, quality, awareness, price_index, capacity_cents,
                                      baseline_revenue_cents, baseline_costs_cents, fixed_costs_cents)
    values (v_co, r.quality, r.awareness, r.price_index, r.revenue_eur * 120, r.revenue_eur * 100, r.costs_eur * 100,
            r.costs_eur * 25)
    on conflict (company_id) do nothing;
    insert into public.securities (id, kind, ticker, name, company_id, sector_key, status, tick_size_e4, is_shortable,
                                   max_leverage, listed_at)
    values (v_sec, 'stock', r.ticker, r.name, v_co, r.sector_key, 'listed', v_tick, true,
            case r.tier when 'bluechip' then 10 when 'midcap' then 5 else 2 end, now())
    on conflict (id) do nothing;
    update public.companies set security_id = v_sec where id = v_co;
    insert into public.security_quotes (security_id, last_price_e4, bid_e4, ask_e4, prev_close_e4, day_open_e4,
                                        day_high_e4, day_low_e4, market_cap_cents)
    values (v_sec, r.price_e4, r.price_e4 - v_half, r.price_e4 + v_half, r.price_e4, r.price_e4, r.price_e4, r.price_e4,
            round(r.shares::numeric * r.price_e4 / 100)::bigint)
    on conflict (security_id) do nothing;
    insert into public.security_sim_state (security_id, fair_value_e4, volatility, liquidity_shares, spread_bps)
    values (v_sec, r.price_e4,
            case r.tier when 'bluechip' then 0.0004 when 'midcap' then 0.0008 else 0.0025 end,
            case r.tier when 'bluechip' then 400000 when 'midcap' then 120000 else 600000 end, v_spread)
    on conflict (security_id) do nothing;
    insert into public.cap_table_entries (company_id, holder_kind, label, shares)
    values (v_co, 'public_float', 'Streubesitz', r.shares) on conflict do nothing;
    insert into public.share_issuances (id, company_id, kind, shares, price_e4, proceeds_cents, shares_outstanding_after)
    values (md5('nexa:issuance:' || r.ticker)::uuid, v_co, 'founding', r.shares, r.price_e4, 0, r.shares)
    on conflict (id) do nothing;
    insert into public.ledger_accounts (kind, owner_company_id, label)
    values ('company_cash', v_co, 'Cash ' || r.ticker) on conflict do nothing;
    select a.id into v_acc from public.ledger_accounts a where a.owner_company_id = v_co and a.kind = 'company_cash';
    -- opening cash: a tenth of a quarter's costs (the first 15 got a whole quarter, which left the financial
    -- market little room). Before the money genesis from the mint (as seed.sql), afterwards from the households.
    v_amount := r.costs_eur * 10;
    if public.money_genesis_done() then
      v_from := public.ledger_system_account('households');
      select a.balance_cents into v_avail from public.ledger_accounts a where a.id = v_from;
      v_amount := least(v_amount, greatest(coalesce(v_avail, 0), 0) / 50);
    else
      v_from := public.ledger_system_account('mint');
    end if;
    if v_amount > 0 then
      perform public.ledger_transfer(v_from, v_acc, v_amount, 'opening_balance', 'Opening balance ' || r.ticker,
                                     'company', v_co, 'opening_balance:' || r.ticker);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.ai_companies_add_v2() from public, anon, authenticated;
comment on function public.ai_companies_add_v2() is 'Internal: adds the ten AI companies of ADR-130 (idempotent).';

select public.ai_companies_add_v2();

-- ---------------------------------------------------------------------------
-- 4. Company profile with news
-- ---------------------------------------------------------------------------
create or replace function public.get_company_profile(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  c        public.companies;
  pc       public.player_companies;
  r        public.player_company_reports;
  q        public.security_quotes;
  v_listed boolean := false;
begin
  select * into c from public.companies where id = p_company_id and dissolved_at is null;
  if c.id is null then
    perform public.api_error('company_not_found');
  end if;
  select * into pc from public.player_companies where company_id = c.id;
  if pc.company_id is not null then
    select x.* into r from public.player_company_reports x join public.game_quarters gq on gq.id = x.game_quarter_id
     where x.company_id = c.id order by gq.ends_at desc limit 1;
  end if;
  if c.security_id is not null then
    select * into q from public.security_quotes where security_id = c.security_id;
    v_listed := exists (select 1 from public.securities s where s.id = c.security_id and s.status = 'listed');
  end if;

  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', c.id, 'name', c.name, 'ticker', c.ticker, 'sector', c.sector_key, 'is_ai', c.is_ai,
      'tier', coalesce(pc.tier, c.tier::text), 'brand_color', c.brand_color, 'logo', public.company_logo(c.id),
      'idea', coalesce(pc.idea, c.description), 'founded_at', c.founded_at, 'listed', v_listed,
      'price_e4', case when v_listed then q.last_price_e4 end, 'change_bps', case when v_listed then q.change_bps end),
    'founder', (select jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key)
                  from public.profiles p where p.id = coalesce(pc.founder_id, c.founder_id)),
    'facts', jsonb_build_object(
      'value_cents', case when pc.company_id is not null and not v_listed then public.company_value_cents(c.id)
                          else q.market_cap_cents end,
      'revenue_cents', case when r.company_id is not null then r.revenue_cents
                            when c.is_ai then c.ttm_revenue_cents end,
      'profit_cents', case when r.company_id is not null then r.operating_profit_cents
                           when c.is_ai then c.ttm_net_income_cents end,
      'period', case when r.company_id is not null then 'quarter' when c.is_ai then 'ttm' end,
      'staff', case when pc.company_id is not null
                    then 1 + pc.ai_workers + (select count(*) from public.player_jobs j
                                               where j.company_id = c.id and j.status = 'active')::integer
                    else c.employee_count end,
      'max_staff', c.max_employees,
      'ai_workers', coalesce(pc.ai_workers, 0),
      'product', pc.product_key,
      'stage', case when pc.company_id is not null then public.company_stage(c.id) end,
      'quality_bps', case when r.company_id is not null then r.quality_bps end,
      'awareness_bps', case when r.company_id is not null then r.awareness_bps end),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key, 'tier', j.tier,
                                          'title', coalesce(j.title, j.title_key), 'since', j.started_at)
                       order by case j.tier::text when 'c_level' then 5 when 'team_lead' then 4 when 'senior' then 3
                                                  when 'junior' then 2 else 1 end desc, j.started_at, p.nickname)
        from public.player_jobs j join public.profiles p on p.id = j.player_id
       where j.company_id = c.id and j.status = 'active'), '[]'::jsonb),
    -- ADR-130: latest market news about the company (quarterly results, stock hints, events)
    'news', coalesce((
      select jsonb_agg(jsonb_build_object('headline', n.headline, 'body', n.body, 'category', n.category,
                                          'published_at', n.published_at) order by n.published_at desc)
        from (select ni.headline, ni.body, ni.category, ni.published_at
                from public.news_items ni
               where (ni.company_id = c.id or (c.security_id is not null and ni.security_id = c.security_id))
                 and ni.published_at <= public.game_now()
               order by ni.published_at desc limit 6) n), '[]'::jsonb));
end;
$$;
comment on function public.get_company_profile(uuid) is
  'RPC: public profile of any company with team, facts and latest news (ADR-125, ADR-130).';
