-- ===== idempotent copy of migrations/20261204010900_stock_unbounded.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 010900 · Stocks without a daily limit, market forces against overheated stocks (ADR-214)
-- =============================================================================
-- The owner: "Aktien sollen unendlich steigen und sinken können am Tag ohne Grenze. Aber es steigt gerade zu schnell.
-- Es soll mehr Ereignisse von außen geben, welche das verhindern oder verlangsamen."
--
-- 1. No daily band: trading.playerStocks.dailyBandBps is 0 in game_config (src/config/balance.ts). market_tick_at and
--    market_order_plan already treat 0 as "no band" (ADR-170/ADR-189), so the tick and the fair-fill path run as for
--    any other stock; the per-tick circuit breaker maxTickReturnBps (and with it the fair fill of big orders) stays.
-- 2. Market forces: once a minute (inside stock_news_run_due) every listed stock without an open hint may draw a force
--    from outside: profit taking, analyst downgrade, short-seller report, insider probe, margin calls, special audit,
--    capital-increase rumours, bubble warning; bargain hunters, buyback rumours and upgrades for stocks far below their
--    value; a small background rate (rotation, fund entry) for every stock. Chance and size grow with the heat of the
--    stock (price / fair value, 24-hour and 7-day gain). Waves hit several hot stocks at once (market correction,
--    sector correction, rate fears) or lift the coldest (relief rally). Formulas = src/lib/sim/market-forces.ts.
--    Every force is a stock hint with a lead (stock_tips.source = 'market', ADR-119): announced in the stock news and the
--    news feed, settled by stock_news_run_due through market_force_shock(), which moves the price and the mood
--    (sentiment) but never the fair value.
-- 3. stock_news_run_due: the 1200 definition plus (a) market hints do not hold back the ordinary news rhythm,
--    (b) they settle through market_force_shock, (c) market_forces_run() at the end.
--
-- Values: game_config.marketForces (src/config/market-forces.ts). Without that row no force is drawn.
-- New internal functions: market_force_heat, market_force_chance_per_hour, market_force_weight, market_force_pick,
-- market_force_move_bps, market_force_shock, market_forces_run. No new RPCs, no new error keys.
-- Idempotent: runs unchanged as supabase/updates/20261204010900_stock_unbounded.sql.

alter table public.stock_tips add column if not exists source text not null default 'news';
alter table public.stock_tips add column if not exists force_key text;
alter table public.stock_tips add column if not exists sentiment_delta double precision not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_tips_source_check') then
    alter table public.stock_tips add constraint stock_tips_source_check check (source in ('news', 'market'));
  end if;
end;
$$;
comment on column public.stock_tips.source is
  'news: ordinary stock news (ADR-119); market: a market force against an overheated or a fallen stock (ADR-214).';
comment on column public.stock_tips.force_key is 'Key of the market force (game_config marketForces.forces[].key or wave:<kind>).';
comment on column public.stock_tips.sentiment_delta is 'Mood change applied with a market force when it comes true (ADR-214).';
create index if not exists stock_tips_source_published_idx on public.stock_tips (source, published_at desc);

-- -----------------------------------------------------------------------------
-- Formulas (src/lib/sim/market-forces.ts)
-- -----------------------------------------------------------------------------

-- stockHeat: heat and cold of a stock; p_p24 / p_p7 null while there is no history
create or replace function public.market_force_heat(p_price bigint, p_fair bigint, p_p24 bigint, p_p7 bigint, p_cfg jsonb,
                                                    out heat double precision, out cold double precision)
language plpgsql
immutable
set search_path = ''
as $$
declare
  h       jsonb := coalesce(p_cfg -> 'heat', '{}'::jsonb);
  v_prem  double precision := case when p_fair > 0 and p_price > 0 then ln(p_price::double precision / p_fair) else 0 end;
  v_g24   double precision := case when p_p24 > 0 and p_price > 0 then ln(p_price::double precision / p_p24) else 0 end;
  v_g7    double precision := case when p_p7 > 0 and p_price > 0 then ln(p_price::double precision / p_p7) else 0 end;
  v_max   double precision := public.cfg_num(h, '{maxHeat}', 4);
  v_gains double precision := 0;
begin
  if v_prem >= -public.cfg_num(h, '{gainGate}', 0.1) then
    v_gains := greatest(0, v_g24 - public.cfg_num(h, '{gain24hFree}', 0.2)) / public.cfg_num(h, '{gain24hScale}', 0.4)
             + greatest(0, v_g7 - public.cfg_num(h, '{gain7dFree}', 0.5)) / public.cfg_num(h, '{gain7dScale}', 0.8);
  end if;
  heat := least(v_max, greatest(0, v_prem - public.cfg_num(h, '{premiumFree}', 0.25)) / public.cfg_num(h, '{premiumScale}', 0.5)
                       + v_gains);
  cold := least(v_max, greatest(0, -v_prem - public.cfg_num(h, '{discountFree}', 0.3)) / public.cfg_num(h, '{discountScale}', 0.6)
                       + greatest(0, -v_g24 - public.cfg_num(h, '{loss24hFree}', 0.3)) / public.cfg_num(h, '{loss24hScale}', 0.5));
end;
$$;

-- forceChancePerHour
create or replace function public.market_force_chance_per_hour(p_heat double precision, p_cold double precision, p_cfg jsonb)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select least(public.cfg_num(p_cfg, '{chance,maxPerHour}', 3),
               public.cfg_num(p_cfg, '{chance,basePerHour}', 0.012)
               + public.cfg_num(p_cfg, '{chance,perHeatPerHour}', 0.9) * p_heat
               + public.cfg_num(p_cfg, '{chance,perColdPerHour}', 0.35) * p_cold);
$$;

-- forceWeight
create or replace function public.market_force_weight(p_force jsonb, p_heat double precision, p_cold double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case p_force ->> 'when'
           when 'hot' then case when p_heat > 0 and p_heat >= coalesce((p_force ->> 'minHeat')::double precision, 0)
                                then (p_force ->> 'weight')::double precision * p_heat else 0 end
           when 'cold' then (p_force ->> 'weight')::double precision * p_cold
           else case when (p_heat > 0 and (p_force ->> 'direction')::integer > 0)
                       or (p_cold > 0 and (p_force ->> 'direction')::integer < 0) then 0
                     else (p_force ->> 'weight')::double precision end
         end;
$$;

-- pickForce: the force for a uniform draw p_u in [0, 1), in config order; null when none has weight
create or replace function public.market_force_pick(p_heat double precision, p_cold double precision, p_u double precision,
                                                    p_cfg jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_forces jsonb := coalesce(p_cfg -> 'forces', '[]'::jsonb);
  v_total  double precision := 0;
  v_x      double precision;
  v_w      double precision;
  v_last   jsonb;
  f        jsonb;
begin
  for f in select value from jsonb_array_elements(v_forces) loop
    v_total := v_total + public.market_force_weight(f, p_heat, p_cold);
  end loop;
  if v_total <= 0 then
    return null;
  end if;
  v_x := p_u * v_total;
  for f in select value from jsonb_array_elements(v_forces) loop
    v_w := public.market_force_weight(f, p_heat, p_cold);
    if v_w > 0 then
      v_x := v_x - v_w;
      v_last := f;
      if v_x < 0 then
        return f;
      end if;
    end if;
  end loop;
  return v_last;
end;
$$;

-- forceMoveBps: uniform(min, max) × (1 + severityPerHeat × heat or cold), at most maxMoveBps (positive)
create or replace function public.market_force_move_bps(p_force jsonb, p_heat double precision, p_cold double precision,
                                                        p_u double precision, p_cfg jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(1, least(public.cfg_num(p_cfg, '{maxMoveBps}', 4500),
           round(((p_force ->> 'minMoveBps')::double precision
                  + p_u * ((p_force ->> 'maxMoveBps')::double precision - (p_force ->> 'minMoveBps')::double precision))
                 * (1 + public.cfg_num(p_cfg, '{severityPerHeat}', 0.45)
                        * case when (p_force ->> 'direction')::integer < 0 then p_heat else p_cold end))))::integer;
$$;

-- -----------------------------------------------------------------------------
-- The shock: price and mood move, the fair value and the EMAs stay (the value funds pull back to the anchor)
-- -----------------------------------------------------------------------------
create or replace function public.market_force_shock(p_security uuid, p_move_bps integer, p_sentiment double precision,
                                                     p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st    public.security_sim_state;
  v_res jsonb;
begin
  select * into st from public.security_sim_state where security_id = p_security for update;
  v_res := public.event_price_shock(p_security, p_move_bps, p_now);
  if st.security_id is not null then
    update public.security_sim_state
       set fair_value_e4 = st.fair_value_e4,
           event_value_factor = st.event_value_factor,
           ema_fast = st.ema_fast,
           ema_slow = st.ema_slow,
           sentiment = greatest(-1, least(1, st.sentiment + coalesce(p_sentiment, 0))),
           updated_at = now()
     where security_id = p_security;
  end if;
  return v_res;
end;
$$;
comment on function public.market_force_shock(uuid, integer, double precision, timestamptz) is
  'Internal (ADR-214): a market force moves the price (as event_price_shock) and the mood, never the fair value.';

-- -----------------------------------------------------------------------------
-- Drawing forces once a minute
-- -----------------------------------------------------------------------------
create or replace function public.market_forces_run(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg      jsonb := public.config_jsonb('marketForces');
  v_now      timestamptz := coalesce(p_now, public.game_now());
  v_lead_min double precision;
  v_lead_max double precision;
  v_rel      integer;
  v_sent     double precision;
  v_words    jsonb;
  v_new      integer := 0;
  v_waves    integer := 0;
  v_force    jsonb;
  v_move     integer;
  v_strength smallint;
  v_head     text;
  v_body     text;
  v_news     bigint;
  v_kind     text;
  v_mean     double precision;
  v_names    text;
  v_sector   text;
  v_sec_name text;
  v_hit      uuid[];
  r          record;
begin
  if v_cfg is null or jsonb_typeof(v_cfg) <> 'object' then
    return jsonb_build_object('skipped', 'no_config');
  end if;
  v_lead_min := greatest(1, public.cfg_num(v_cfg, '{leadMinMinutes}', 3));
  v_lead_max := greatest(v_lead_min, public.cfg_num(v_cfg, '{leadMaxMinutes}', 15));
  v_rel      := least(10000, greatest(0, public.cfg_num(v_cfg, '{reliabilityBps}', 8500)))::integer;
  v_sent     := public.cfg_num(v_cfg, '{sentimentPerMove}', 2);
  v_words    := coalesce(v_cfg -> 'strengthWords', '["leicht", "spürbar", "deutlich"]'::jsonb);

  if to_regclass('pg_temp.market_force_heat_tmp') is not null then
    drop table pg_temp.market_force_heat_tmp;
  end if;
  create temporary table market_force_heat_tmp (
    security_id uuid primary key, name text, sector_key text, heat double precision, cold double precision
  ) on commit drop;
  insert into pg_temp.market_force_heat_tmp (security_id, name, sector_key, heat, cold)
  select sec.id, sec.name, sec.sector_key, h.heat, h.cold
    from public.securities sec
    join public.security_quotes q on q.security_id = sec.id
    join public.security_sim_state st on st.security_id = sec.id
    cross join lateral public.market_force_heat(
      q.last_price_e4, st.fair_value_e4,
      (select c.close_e4 from public.candles c
        where c.security_id = sec.id and c.interval = '1h'
          and c.bucket_start <= v_now - interval '24 hours' and c.bucket_start > v_now - interval '48 hours'
        order by c.bucket_start desc limit 1),
      (select c.close_e4 from public.candles c
        where c.security_id = sec.id and c.interval = '1h'
          and c.bucket_start <= v_now - interval '7 days' and c.bucket_start > v_now - interval '8 days'
        order by c.bucket_start desc limit 1),
      v_cfg) h
   where sec.kind = 'stock' and sec.status = 'listed'
     and not exists (select 1 from public.stock_tips x where x.security_id = sec.id and x.applied_at is null);

  -- 1. single forces
  for r in select * from pg_temp.market_force_heat_tmp loop
    if random() < 1 - exp(-greatest(0, public.market_force_chance_per_hour(r.heat, r.cold, v_cfg)) / 60.0) then
      v_force := public.market_force_pick(r.heat, r.cold, random(), v_cfg);
      continue when v_force is null;
      v_move := public.market_force_move_bps(v_force, r.heat, r.cold, random(), v_cfg);
      v_strength := case when v_move < 800 then 1 when v_move < 1600 then 2 else 3 end;
      v_head := replace(v_force ->> 'headline', '{name}', r.name);
      v_body := replace(replace(v_force ->> 'body', '{name}', r.name), '{w}', v_words ->> (v_strength - 1));
      insert into public.news_items (category, headline, body, importance, security_id, published_at)
      values ('market', v_head, v_body, v_strength, r.security_id, v_now) returning id into v_news;
      insert into public.stock_tips (security_id, news_item_id, direction, move_bps, strength, comes_true, headline, body,
                                     published_at, due_at, source, force_key, sentiment_delta)
      values (r.security_id, v_news, (v_force ->> 'direction')::smallint, v_move, v_strength, random() * 10000 < v_rel,
              v_head, v_body, v_now, v_now + make_interval(secs => 60 * (v_lead_min + random() * (v_lead_max - v_lead_min))),
              'market', v_force ->> 'key',
              greatest(-1, least(1, (v_force ->> 'direction')::integer * v_move / 10000.0 * v_sent)));
      v_new := v_new + 1;
      delete from pg_temp.market_force_heat_tmp where security_id = r.security_id;
    end if;
  end loop;

  -- 2. a wave over the hot stocks, or a relief rally for the cold ones
  select avg(t.heat) into v_mean from pg_temp.market_force_heat_tmp t
   where t.heat >= public.cfg_num(v_cfg, '{waves,minHeat}', 0.2);
  v_kind := null;
  if v_mean is not null and random() < 1 - exp(-least(public.cfg_num(v_cfg, '{waves,maxPerHour}', 1),
                                                       public.cfg_num(v_cfg, '{waves,basePerHour}', 0.02)
                                                       + public.cfg_num(v_cfg, '{waves,perHeatPerHour}', 0.25) * v_mean) / 60.0) then
    v_kind := (array['market', 'sector', 'rates'])[1 + floor(random() * 3)::integer];
  elsif exists (select 1 from pg_temp.market_force_heat_tmp t where t.cold > 0)
        and random() < 1 - exp(-public.cfg_num(v_cfg, '{waves,reliefPerHour}', 0.02) / 60.0) then
    v_kind := 'relief';
  end if;
  if v_kind = 'sector' then
    select t.sector_key, s.name into v_sector, v_sec_name
      from pg_temp.market_force_heat_tmp t join public.sectors s on s.key = t.sector_key
     where t.heat >= public.cfg_num(v_cfg, '{waves,minHeat}', 0.2)
     group by t.sector_key, s.name order by avg(t.heat) desc, count(*) desc limit 1;
    if v_sector is null then v_kind := 'market'; end if;
  end if;
  if v_kind is not null then
    select array_agg(x.security_id order by x.lvl desc), string_agg(x.name, ', ' order by x.lvl desc) into v_hit, v_names
      from (select t.security_id, t.name, case when v_kind = 'relief' then t.cold else t.heat end as lvl
              from pg_temp.market_force_heat_tmp t
             where case when v_kind = 'relief' then t.cold > 0
                        else t.heat >= public.cfg_num(v_cfg, '{waves,minHeat}', 0.2)
                             and (v_kind <> 'sector' or t.sector_key = v_sector) end
             order by 3 desc
             limit greatest(1, public.cfg_num(v_cfg, '{waves,maxStocks}', 6))::integer) x;
  end if;
  if v_hit is not null and cardinality(v_hit) > 0 then
    v_head := replace(v_cfg #>> array['waveTexts', v_kind, 'headline'], '{sector}', coalesce(v_sec_name, ''));
    v_body := replace(v_cfg #>> array['waveTexts', v_kind, 'body'], '{names}', v_names);
    insert into public.news_items (category, headline, body, importance, published_at)
    values ('market', v_head, v_body, 2, v_now) returning id into v_news;
    for r in select t.* from pg_temp.market_force_heat_tmp t where t.security_id = any (v_hit) loop
      v_move := public.market_force_move_bps(
        jsonb_build_object('direction', case when v_kind = 'relief' then 1 else -1 end, 'minMoveBps', 300, 'maxMoveBps', 1000),
        r.heat, r.cold, random(), v_cfg);
      v_strength := case when v_move < 800 then 1 when v_move < 1600 then 2 else 3 end;
      insert into public.stock_tips (security_id, news_item_id, direction, move_bps, strength, comes_true, headline, body,
                                     published_at, due_at, source, force_key, sentiment_delta)
      values (r.security_id, v_news, case when v_kind = 'relief' then 1 else -1 end, v_move, v_strength,
              random() * 10000 < v_rel, v_head, v_body, v_now,
              v_now + make_interval(secs => 60 * (v_lead_min + random() * (v_lead_max - v_lead_min))),
              'market', 'wave:' || v_kind,
              greatest(-1, least(1, case when v_kind = 'relief' then 1 else -1 end * v_move / 10000.0 * v_sent)));
    end loop;
    v_waves := 1;
  end if;
  return jsonb_build_object('forces', v_new, 'waves', v_waves, 'wave', v_kind);
end;
$$;
comment on function public.market_forces_run(timestamptz) is
  'Internal, every minute from stock_news_run_due (ADR-214): draws market forces against overheated or fallen stocks.';

-- -----------------------------------------------------------------------------
-- stock_news_run_due: the 1200 definition, market hints settle through market_force_shock and do not hold back the
-- ordinary news; draws the market forces at the end
-- -----------------------------------------------------------------------------
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
  v_forces   jsonb;
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
      if t.source = 'market' then
        -- ADR-214: a market force moves the price and the mood, not the fair value
        perform public.market_force_shock(t.security_id, t.direction * t.move_bps, t.sentiment_delta, v_now);
      else
        perform public.event_price_shock(t.security_id, t.direction * t.move_bps, v_now);
      end if;
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

  -- 2. a new hint when the last ordinary one is old enough (market forces do not count, ADR-214)
  if not exists (select 1 from public.stock_tips x
                  where x.published_at > v_now - make_interval(secs => v_every * 60 - 5) and x.source = 'news') then
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

  -- 3. market forces from outside (ADR-214)
  v_forces := public.market_forces_run(v_now);

  delete from public.stock_tips x
   where x.applied_at is not null
     and x.published_at < v_now - make_interval(hours => greatest(1, public.cfg_num(v_cfg, '{keepHours}', 24))::integer);
  return jsonb_build_object('settled', v_settled, 'published', v_new, 'market_forces', v_forces);
end;
$$;
comment on function public.stock_news_run_due(timestamptz) is
  'Internal, cron every minute (ADR-119, ADR-214): settles due stock hints, publishes a new one when it is time, draws market forces.';

revoke all on function public.market_force_heat(bigint, bigint, bigint, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.market_force_chance_per_hour(double precision, double precision, jsonb) from public, anon, authenticated;
revoke all on function public.market_force_weight(jsonb, double precision, double precision) from public, anon, authenticated;
revoke all on function public.market_force_pick(double precision, double precision, double precision, jsonb) from public, anon, authenticated;
revoke all on function public.market_force_move_bps(jsonb, double precision, double precision, double precision, jsonb) from public, anon, authenticated;
revoke all on function public.market_force_shock(uuid, integer, double precision, timestamptz) from public, anon, authenticated;
revoke all on function public.market_forces_run(timestamptz) from public, anon, authenticated;
revoke all on function public.stock_news_run_due(timestamptz) from public, anon, authenticated;
grant execute on function public.market_forces_run(timestamptz) to service_role;
grant execute on function public.stock_news_run_due(timestamptz) to service_role;
