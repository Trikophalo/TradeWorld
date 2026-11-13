-- ===== idempotent copy of migrations/20261203001200_more_stock_news.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1200 · Many more kinds of stock news, good and bad (ADR-119 follow-up)
-- =============================================================================
-- 15 good and 15 bad events (big orders, raised outlook, star investor, buyback ... affair, capital increase,
-- racism allegations, recall, data leak, raid ...), each with its own headline and text. Up and down stay equally
-- likely. Same rhythm and mechanics as before.
-- Idempotent: runs unchanged as supabase/updates/20261203001200_more_stock_news.sql.

create or replace function public.stock_news_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg      jsonb := public.config_jsonb('stockNews');
  v_now      timestamptz := coalesce(p_now, public.game_now());
  v_every    double precision;
  v_lead_min double precision;
  v_lead_max double precision;
  v_min      integer;
  v_max      integer;
  v_rel      integer;
  v_settled  integer := 0;
  v_new      integer := 0;
  t          public.stock_tips;
  s          record;
  v_dir      smallint;
  v_move     integer;
  v_strength smallint;
  v_head     text;
  v_body     text;
  v_news     bigint;
  v_good     jsonb := jsonb_build_array(
      jsonb_build_array('Rekordauftrag für {name}', '{name} gewinnt einen Großkunden. Der Auftrag dürfte den Umsatz {w} anheben.'),
      jsonb_build_array('{name} hebt die Prognose an', 'Die Geschäfte laufen besser als geplant. Analysten erwarten einen {w} steigenden Kurs.'),
      jsonb_build_array('Neuer Chef-Entwickler wechselt zu {name}', 'Ein bekannter Kopf aus der Branche kommt an Bord. Anleger dürften das {w} honorieren.'),
      jsonb_build_array('{name} gewinnt Branchenpreis', 'Das Unternehmen wird für sein neues Produkt ausgezeichnet. Rückenwind für die Aktie erwartet.'),
      jsonb_build_array('Übernahmegerüchte um {name}', 'Ein großer Konkurrent soll Interesse haben. Spekulanten könnten den Kurs {w} treiben.'),
      jsonb_build_array('{name} startet Aktienrückkauf', 'Das Unternehmen kauft eigene Aktien zurück. Das stützt den Kurs {w}.'),
      jsonb_build_array('Staatlicher Großauftrag für {name}', 'Ein mehrjähriger Vertrag mit der öffentlichen Hand ist unterschrieben.'),
      jsonb_build_array('{name}: Neues Produkt ausverkauft', 'Die Nachfrage übertrifft alle Erwartungen. Händler rechnen mit einem {w} steigenden Kurs.'),
      jsonb_build_array('Patent für {name} erteilt', 'Eine wichtige Technologie ist jetzt geschützt. Der Vorsprung dürfte sich auszahlen.'),
      jsonb_build_array('{name} senkt die Kosten deutlich', 'Ein Sparprogramm wirkt schneller als gedacht. Die Marge steigt.'),
      jsonb_build_array('Star-Investor steigt bei {name} ein', 'Ein bekannter Anleger hat ein großes Paket gekauft. Andere könnten folgen.'),
      jsonb_build_array('{name} erschließt neuen Markt', 'Der Start im Ausland läuft besser als geplant.'),
      jsonb_build_array('Kooperation: {name} und ein Branchenriese', 'Die Partnerschaft soll beiden Seiten neue Kunden bringen.'),
      jsonb_build_array('Analysten-Upgrade: {name} jetzt Kaufempfehlung', 'Mehrere Häuser heben ihr Kursziel {w} an.'),
      jsonb_build_array('Sonderdividende bei {name} erwartet', 'Die Kasse ist voll. Aktionäre dürfen auf eine Extra-Ausschüttung hoffen.'));
  v_bad      jsonb := jsonb_build_array(
      jsonb_build_array('Affäre erschüttert {name}', 'Die Chefetage von {name} steht wegen einer Affäre in der Kritik. Anleger werden nervös.'),
      jsonb_build_array('{name} plant Kapitalerhöhung', 'Neue Aktien sollen ausgegeben werden. Das verwässert die Anteile, der Kurs dürfte {w} nachgeben.'),
      jsonb_build_array('Rassismus-Vorwürfe gegen {name}', 'Ehemalige Mitarbeiter erheben schwere Vorwürfe. Kunden kündigen erste Verträge.'),
      jsonb_build_array('Rückruf bei {name}', 'Ein fehlerhaftes Produkt muss zurück in die Werkstatt. Das wird teuer.'),
      jsonb_build_array('Datenleck bei {name}', 'Kundendaten sind im Netz aufgetaucht. Die Aufsicht prüft.'),
      jsonb_build_array('{name}-Chef tritt überraschend zurück', 'Die Gründe sind unklar. Der Markt mag keine Unsicherheit.'),
      jsonb_build_array('Razzia bei {name}', 'Ermittler durchsuchen die Zentrale wegen des Verdachts auf Bilanztricks.'),
      jsonb_build_array('{name} senkt die Prognose', 'Das Geschäft läuft schwächer als erwartet. Analysten rechnen mit einem {w} fallenden Kurs.'),
      jsonb_build_array('Streik legt {name} lahm', 'Die Belegschaft legt die Arbeit nieder. Lieferungen verzögern sich.'),
      jsonb_build_array('Großkunde springt bei {name} ab', 'Ein wichtiger Vertrag wird nicht verlängert.'),
      jsonb_build_array('Analysten-Downgrade für {name}', 'Mehrere Häuser streichen ihre Kaufempfehlung und senken das Kursziel.'),
      jsonb_build_array('{name} verliert Patentstreit', 'Ein Gericht gibt dem Konkurrenten recht. Lizenzzahlungen drohen.'),
      jsonb_build_array('Umweltskandal bei {name}', 'Ein Werk soll Grenzwerte überschritten haben. Bußgelder sind wahrscheinlich.'),
      jsonb_build_array('Lieferkette reißt bei {name}', 'Ein wichtiger Zulieferer fällt aus. Die Produktion stockt.'),
      jsonb_build_array('Leerverkäufer wetten gegen {name}', 'Ein bekannter Fonds hält die Aktie für überbewertet.'));
  v_pick     jsonb;
  v_words    text[] := array['leicht', 'spürbar', 'deutlich'];
begin
  if v_cfg is null or jsonb_typeof(v_cfg) <> 'object' then
    return jsonb_build_object('skipped', 'no_config');
  end if;
  -- same lock as the minute job: never beside a running tick
  perform pg_advisory_xact_lock(7311001);
  v_every    := greatest(1, public.cfg_num(v_cfg, '{everyMinutes}', 12));
  v_lead_min := greatest(1, public.cfg_num(v_cfg, '{leadMinMinutes}', 10));
  v_lead_max := greatest(v_lead_min, public.cfg_num(v_cfg, '{leadMaxMinutes}', 40));
  v_min      := greatest(1, public.cfg_num(v_cfg, '{minMoveBps}', 300))::integer;
  v_max      := greatest(v_min, public.cfg_num(v_cfg, '{maxMoveBps}', 1200)::integer);
  v_rel      := least(10000, greatest(0, public.cfg_num(v_cfg, '{reliabilityBps}', 7500)))::integer;

  -- 1. hints whose time has come
  for t in select * from public.stock_tips x where x.applied_at is null and x.due_at <= v_now order by x.due_at for update loop
    select sec.name, sec.status into s from public.securities sec where sec.id = t.security_id;
    if t.comes_true and s.status = 'listed' then
      perform public.event_price_shock(t.security_id, t.direction * t.move_bps, v_now);
      v_head := case when t.direction > 0 then s.name || ' legt zu: Die Erwartungen haben sich bestätigt'
                     else s.name || ' gibt nach: Die Warnungen haben sich bestätigt' end;
    else
      v_head := 'Entwarnung bei ' || s.name || ': Die Meldung hat sich nicht bestätigt';
    end if;
    insert into public.news_items (category, headline, body, importance, security_id, published_at)
    values ('company', v_head, null, 1, t.security_id, v_now) returning id into v_news;
    update public.stock_tips set applied_at = v_now, result_news_id = v_news where id = t.id;
    v_settled := v_settled + 1;
  end loop;

  -- 2. a new hint when the last one is old enough
  if not exists (select 1 from public.stock_tips x where x.published_at > v_now - make_interval(secs => v_every * 60 - 5)) then
    select sec.id, sec.name into s
      from public.securities sec
     where sec.kind = 'stock' and sec.status = 'listed'
       and not exists (select 1 from public.stock_tips x where x.security_id = sec.id and x.applied_at is null)
     order by random() limit 1;
    if s.id is not null then
      v_dir := case when random() < 0.5 then 1 else -1 end;
      v_move := v_min + floor(random() * (v_max - v_min + 1))::integer;
      v_strength := least(3, 1 + floor(3.0 * (v_move - v_min) / greatest(1, v_max - v_min + 1)))::smallint;
      v_pick := case when v_dir > 0 then v_good -> floor(random() * jsonb_array_length(v_good))::integer
                     else v_bad -> floor(random() * jsonb_array_length(v_bad))::integer end;
      v_head := replace(v_pick ->> 0, '{name}', s.name);
      v_body := replace(replace(v_pick ->> 1, '{name}', s.name), '{w}', v_words[v_strength]) || ' Sicher ist das nicht.';
      insert into public.news_items (category, headline, body, importance, security_id, published_at)
      values ('company', v_head, v_body, v_strength, s.id, v_now) returning id into v_news;
      insert into public.stock_tips (security_id, news_item_id, direction, move_bps, strength, comes_true, headline, body,
                                     published_at, due_at)
      values (s.id, v_news, v_dir, v_move, v_strength, random() * 10000 < v_rel, v_head, v_body, v_now,
              v_now + make_interval(secs => 60 * (v_lead_min + random() * (v_lead_max - v_lead_min))));
      v_new := 1;
    end if;
  end if;

  delete from public.stock_tips x
   where x.applied_at is not null
     and x.published_at < v_now - make_interval(hours => greatest(1, public.cfg_num(v_cfg, '{keepHours}', 24))::integer);
  return jsonb_build_object('settled', v_settled, 'published', v_new);
end;
$$;
