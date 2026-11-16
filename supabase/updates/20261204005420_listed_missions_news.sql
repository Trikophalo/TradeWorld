-- ===== idempotent copy of migrations/20261204005420_listed_missions_news.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5420 · Listed player companies: missions, feed and news hooks (ADR-167)
-- =============================================================================
-- * Missions: requirement "listed" (founder of a company at the stock exchange), mission_doable() knows what the
--   new metrics need, dividend_cents counts as money, 26 templates.
-- * Feed: labels for tax_penalty, tax_audit, greedy_founder, mass_quit, record_dividend, board_revolt, research_done.
-- * NEXA Nachrichten: the first six are personal news the show can pick up (the first four as bad news).
-- Idempotent: runs unchanged as supabase/updates/20261204005420_listed_missions_news.sql.

-- requirement "listed": founder of an active company at the stock exchange
do $do$
declare
  v_def text := pg_get_functiondef('public.mission_requirement_ok(uuid, text)'::regprocedure);
  v_old text := $t$           else false end;$t$;
  v_new text := $t$           when 'listed' then exists (select 1 from public.player_companies pc join public.companies c on c.id = pc.company_id
                                       where pc.founder_id = p_player and pc.status = 'active' and c.phase = 'listed')
           else false end;$t$;
begin
  if position('''listed''' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'mission_requirement_ok() has an unexpected shape; add the requirement "listed" (ADR-167) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- What a listed mission needs right now
create or replace function public.listed_mission_doable(p_player uuid, p_key text, p_metric text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  l         public.listed_companies;
begin
  select pc.company_id into v_company
    from public.player_companies pc join public.companies c on c.id = pc.company_id
   where pc.founder_id = p_player and pc.status = 'active' and c.phase = 'listed';
  if p_metric = 'board_vote' then
    -- an open motion the player has not voted on, in any company whose shares the player holds
    return exists (select 1 from public.board_motions m
                    where m.status = 'open' and public.board_my_e6(m.company_id, p_player) > 0
                      and not exists (select 1 from public.board_votes v where v.motion_id = m.id and v.player_id = p_player));
  end if;
  if v_company is null then
    return false;
  end if;
  select * into l from public.listed_companies where company_id = v_company;
  return case
    when p_metric in ('research_started', 'research_done') then
      exists (select 1 from jsonb_array_elements(coalesce(public.listed_cfg() -> 'items', '[]'::jsonb)) t(x)
               where t.x ->> 'kind' = 'research'
                 and not exists (select 1 from public.company_investments ci
                                  where ci.company_id = v_company and ci.key = t.x ->> 'key' and ci.status = 'active'))
    when p_metric = 'benefit_added' then
      exists (select 1 from jsonb_array_elements(coalesce(public.listed_cfg() -> 'items', '[]'::jsonb)) t(x)
               where t.x ->> 'kind' = 'benefit'
                 and not exists (select 1 from public.company_investments ci
                                  where ci.company_id = v_company and ci.key = t.x ->> 'key' and ci.status in ('active', 'paused')))
    when p_metric = 'board_motion' then
      public.board_my_e6(v_company, p_player)::numeric * 10000
        > public.board_total_e6(v_company)::numeric * public.cfg_num(public.listed_cfg(), '{board,minShareBps}', 2000)
    when p_metric = 'audit_survived' then
      exists (select 1 from public.player_company_events e
               where e.company_id = v_company and e.archetype = 'tax_audit' and e.status in ('open', 'accepted', 'in_force'))
    when p_key = 'm_first_dividend' then not exists (select 1 from public.company_dividends d where d.company_id = v_company)
    when p_key = 'm_first_books' then not exists (select 1 from public.company_tax_periods x
                                                   where x.company_id = v_company and x.closed_by = 'founder')
    else true end;
end;
$$;
revoke all on function public.listed_mission_doable(uuid, text, text) from public, anon, authenticated;
grant execute on function public.listed_mission_doable(uuid, text, text) to service_role;

do $do$
declare
  v_def text := pg_get_functiondef('public.mission_doable(uuid, text, text)'::regprocedure);
  v_old text := $t$    -- "your first ..." only for who has not done it yet$t$;
  v_new text := $t$    -- listed companies (ADR-167)
    when p_metric in ('research_started', 'research_done', 'product_launched', 'region_opened', 'benefit_added', 'team_action',
                      'satisfaction_green', 'dividend_paid', 'dividend_cents', 'books_done', 'books_streak', 'tax_paid',
                      'board_motion', 'board_vote', 'audit_survived', 'listed_invested') then
      public.listed_mission_doable(p_player, p_key, p_metric)
    -- "your first ..." only for who has not done it yet$t$;
begin
  if position('listed_mission_doable' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'mission_doable() has an unexpected shape; add the listed company metrics (ADR-167) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- dividends count as money in mission texts ("{target}" in euros)
do $do$
declare
  v_def text := pg_get_functiondef('public.mission_is_money_metric(text)'::regprocedure);
begin
  if position('dividend_cents' in v_def) = 0 then
    if position($t$'art_collection_value'$t$ in v_def) = 0 then
      raise exception 'mission_is_money_metric() has an unexpected shape; add dividend_cents (ADR-167) by hand';
    end if;
    execute replace(v_def, $t$'art_collection_value'$t$, $t$'art_collection_value', 'dividend_cents'$t$);
  end if;
end;
$do$;

insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  ('q_listed_books', 'quick', 'Mach die Bücher', 'Einmal am Tag: Belege sortieren, Abschluss bestätigen.', 'mission_company', 'books_done', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 50, 70, 9, null, false, 70, 0),
  ('q_listed_benefit', 'quick', 'Gönn dem Team einen Benefit', 'Obstkorb, Kaffeeflatrate, Tischkicker: Hauptsache, die Laune steigt.', 'mission_company', 'benefit_added', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 40, 60, 9, null, false, 50, 0),
  ('q_listed_action', 'quick', 'Starte eine Aktion fürs Team', 'Pizza für alle oder gleich ein Teamevent.', 'mission_company', 'team_action', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 40, 60, 9, null, false, 50, 0),
  ('q_listed_research', 'quick', 'Starte eine Forschung', 'Such dir einen Zweig aus und leg los.', 'mission_company', 'research_started', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 50, 70, 9, null, false, 50, 0),
  ('q_board_vote', 'quick', 'Stimm im Geschäftsrat ab', 'Ein Antrag wartet auf deine Aktien.', 'mission_company', 'board_vote', 'count', '{"unlock":"ipo"}'::jsonb, 1, 1, 40, 60, 9, null, false, 80, 0),
  ('d_listed_green', 'daily', '{target} Stunden gute Stimmung', 'Halte die Mitarbeiterzufriedenheit im grünen Bereich.', 'mission_company', 'satisfaction_green', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 4, 6, 250, 350, 9, null, false, 60, 0),
  ('d_listed_tax', 'daily', 'Zahl deine Steuer pünktlich', 'Bücher machen, Steuer überweisen, Ruhe vor dem Finanzamt.', 'mission_company', 'tax_paid', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 250, 350, 9, null, false, 60, 0),
  ('d_listed_invest', 'daily', 'Investiere {target}-mal in deine Firma', 'Forschung, Produkte, Maschinen, Benefits: alles zählt.', 'mission_company', 'listed_invested', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 2, 3, 250, 350, 9, null, false, 60, 0),
  ('d_listed_dividend', 'daily', 'Schütte eine Dividende aus', 'Deine Aktionäre freuen sich, dein Ruf auch.', 'mission_company', 'dividend_paid', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 250, 400, 9, null, false, 40, 0),
  ('w_listed_research', 'weekly', 'Schließe {target} Forschungen ab', 'Wer forscht, wächst.', 'mission_company', 'research_done', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 2, 3, 800, 1200, 9, null, false, 50, 1),
  ('w_listed_books', 'weekly', 'Mach an {target} Tagen die Bücher', 'Jeden Tag ein paar Sekunden, dann bleibt das Finanzamt freundlich.', 'mission_company', 'books_done', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 4, 5, 800, 1200, 9, null, false, 50, 1),
  ('w_listed_green', 'weekly', '{target} Stunden gute Stimmung', 'Eine Woche, in der das Team gern zur Arbeit kommt.', 'mission_company', 'satisfaction_green', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 40, 60, 800, 1200, 9, null, false, 40, 1),
  ('w_listed_dividends', 'weekly', 'Schütte an {target} Tagen Dividende aus', 'Verlässliche Dividenden machen eine Aktie beliebt.', 'mission_company', 'dividend_paid', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 3, 4, 800, 1200, 9, null, false, 30, 1),
  ('m_first_research', 'milestone', 'Deine erste Forschung', 'Schließe ein Forschungsprojekt ab.', 'mission_company', 'research_done', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 800, 800, 9, 70, false, 100, 1),
  ('m_research_10', 'milestone', '{target} Forschungen abgeschlossen', 'Dein Labor läuft auf Hochtouren.', 'mission_company', 'research_done', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 10, 10, 3000, 3000, 9, 112, false, 100, 1),
  ('m_research_28', 'milestone', 'Der ganze Forschungsbaum', 'Alle {target} Projekte erforscht. Mehr geht nicht.', 'mission_company', 'research_done', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 28, 28, 10000, 10000, 9, 130, false, 100, 1),
  ('m_first_product', 'milestone', 'Ein zweites Standbein', 'Bring ein neues Produkt auf den Markt.', 'mission_company', 'product_launched', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 1000, 1000, 9, 72, false, 100, 1),
  ('m_products_4', 'milestone', '{target} Produkte am Markt', 'Ein richtiges Sortiment.', 'mission_company', 'product_launched', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 4, 4, 3500, 3500, 9, 114, false, 100, 1),
  ('m_first_region', 'milestone', 'Raus aus der Heimat', 'Eröffne deinen ersten neuen Markt.', 'mission_company', 'region_opened', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 1200, 1200, 9, 74, false, 100, 1),
  ('m_regions_5', 'milestone', 'Weltkonzern', 'Von Süddeutschland bis Asien: alle {target} Märkte eröffnet.', 'mission_company', 'region_opened', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 5, 5, 8000, 8000, 9, 128, false, 100, 1),
  ('m_first_dividend', 'milestone', 'Deine erste Dividende', 'Teile den Gewinn mit deinen Aktionären.', 'mission_company', 'dividend_paid', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 800, 800, 9, 71, false, 100, 1),
  ('m_dividend_big', 'milestone', '{target} € Dividende ausgeschüttet', 'Eine Aktie, auf die man sich verlassen kann.', 'mission_company', 'dividend_cents', 'sum', '{"unlock":"ipo","requires":"listed"}'::jsonb, 10000000, 10000000, 4000, 4000, 9, 116, false, 100, 1),
  ('m_first_books', 'milestone', 'Ordnung muss sein', 'Mach zum ersten Mal die Bücher deiner AG.', 'mission_company', 'books_done', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 500, 500, 9, 69, false, 100, 1),
  ('m_books_streak_7', 'milestone', '{target} Tage saubere Bücher', 'Sieben Tage in Folge die Bücher gemacht.', 'mission_company', 'books_streak', 'max', '{"unlock":"ipo","requires":"listed"}'::jsonb, 7, 7, 3000, 3000, 9, 113, false, 100, 1),
  ('m_first_motion', 'milestone', 'Geschäftsrat einberufen', 'Bring mit über 20 % der Aktien einen Antrag ein.', 'mission_company', 'board_motion', 'count', '{"unlock":"ipo"}'::jsonb, 1, 1, 1000, 1000, 9, 76, false, 100, 1),
  ('m_audit', 'milestone', 'Betriebsprüfung überstanden', 'Das Finanzamt war da. Du hast es geregelt.', 'mission_company', 'audit_survived', 'count', '{"unlock":"ipo","requires":"listed"}'::jsonb, 1, 1, 2000, 2000, 9, 118, false, 100, 1)
on conflict (key) do update
   set kind = excluded.kind, title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params, target_min = excluded.target_min,
       target_max = excluded.target_max, xp_min = excluded.xp_min, xp_max = excluded.xp_max, min_level = excluded.min_level,
       chain_order = excluded.chain_order, scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true, updated_at = now();

-- the feed names what happened at listed companies
do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
  v_old text := $t$    when 'car_bought' then 'Neues Auto'$t$;
  v_new text := $t$    when 'car_bought' then 'Neues Auto'
    when 'tax_penalty' then 'Strafe vom Finanzamt für ' || coalesce(p_payload ->> 'company', '?')
    when 'tax_audit' then 'Betriebsprüfung bei ' || coalesce(p_payload ->> 'company', '?')
    when 'greedy_founder' then 'zahlt sich bei ' || coalesce(p_payload ->> 'company', '?') || ' fast den ganzen Gewinn selbst aus'
    when 'mass_quit' then 'Kündigungswelle bei ' || coalesce(p_payload ->> 'company', '?')
    when 'record_dividend' then 'Rekorddividende bei ' || coalesce(p_payload ->> 'company', '?')
    when 'board_revolt' then 'Aufstand im Geschäftsrat von ' || coalesce(p_payload ->> 'company', '?')
    when 'research_done' then 'Forschungsdurchbruch bei ' || coalesce(p_payload ->> 'company', '?')$t$;
begin
  if position('greedy_founder' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'feed_item_label() has an unexpected shape; add the listed company feed kinds (ADR-167) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- NEXA Nachrichten: personal news from listed companies
do $do$
declare
  v_def  text := pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure);
  v_bad  text := $t$when f.kind in ('rug_pull', 'loan_defaulted', 'deal_broken', 'coin_closed')$t$;
  -- anchored without 'big_trade': the Nexamon migration puts 'nexamon_pull' between it and 'rug_pull'
  v_list text := $t$'rug_pull', 'loan_defaulted', 'deal_broken', 'coin_closed')$t$;
begin
  if position('greedy_founder' in v_def) = 0 then
    if position(v_bad in v_def) = 0 or position(v_list in v_def) = 0 then
      raise exception 'news_show_build() has an unexpected shape; add the listed company feed kinds (ADR-167) to the gossip source by hand';
    end if;
    v_def := replace(v_def, v_bad,
      $t$when f.kind in ('rug_pull', 'loan_defaulted', 'deal_broken', 'coin_closed', 'tax_penalty', 'tax_audit', 'greedy_founder', 'mass_quit')$t$);
    v_def := replace(v_def, v_list,
      $t$'rug_pull', 'loan_defaulted', 'deal_broken', 'coin_closed',
                                  'tax_penalty', 'tax_audit', 'greedy_founder', 'mass_quit', 'record_dividend', 'board_revolt')$t$);
    execute v_def;
  end if;
end;
$do$;
