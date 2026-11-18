-- =============================================================================
-- NEXA · Diagnose: Warum steigen Spieler-Aktien? (ADR-217) — nur lesend, im Supabase SQL Editor ausführen
-- =============================================================================
-- Jede Abfrage einzeln markieren und ausführen ("Run selected"). Nichts wird verändert.
-- Teil 1 bis 5 laufen vor und nach dem Update; Teil 6 erst nach dem Update (Tabelle player_stock_valuation).

-- 1) Laufen die Minuten-Jobs? (Takt, Vertrauen, Bewertung der Spieleraktien)
select j.jobname, d.status, count(*) as laeufe, max(d.start_time) as zuletzt, max(left(d.return_message, 200)) as meldung
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid
 where j.jobname in ('nexa-market', 'nexa-investor-confidence', 'nexa-player-valuation')
   and d.start_time > now() - interval '3 hours'
 group by j.jobname, d.status
 order by j.jobname, d.status;

-- 2) Spieleraktien: Kurs gegen fairen Wert, Vertrauen, Änderung über 24 Stunden und 7 Tage
select s.ticker, c.name,
       round(q.last_price_e4 / 1e4, 4) as kurs,
       round(st.fair_value_e4 / 1e4, 4) as fair,
       round(q.last_price_e4::numeric / nullif(st.fair_value_e4, 0), 2) as kurs_zu_fair,
       round(sc.confidence::numeric, 1) as vertrauen,
       round(sc.target::numeric, 1) as vertrauen_ziel,
       round(100 * (q.last_price_e4::numeric / nullif(h24.close_e4, 0) - 1), 1) as aenderung_24h_pct,
       round(100 * (q.last_price_e4::numeric / nullif(h7.close_e4, 0) - 1), 1) as aenderung_7t_pct
  from public.securities s
  join public.companies c on c.id = s.company_id and not c.is_ai
  join public.security_quotes q on q.security_id = s.id
  join public.security_sim_state st on st.security_id = s.id
  left join public.stock_confidence sc on sc.security_id = s.id
  left join lateral (select c1.close_e4 from public.candles c1
                      where c1.security_id = s.id and c1.interval = '1h' and c1.bucket_start <= now() - interval '24 hours'
                      order by c1.bucket_start desc limit 1) h24 on true
  left join lateral (select c2.close_e4 from public.candles c2
                      where c2.security_id = s.id and c2.interval = '1h' and c2.bucket_start <= now() - interval '7 days'
                      order by c2.bucket_start desc limit 1) h7 on true
 where s.kind = 'stock' and s.status = 'listed'
 order by aenderung_7t_pct desc nulls last;

-- 3) Die Ursache: Woraus besteht der faire Wert? (alte Formel: Kasse + 4 × Quartalsgewinn × KGV × 0,5)
--    kasse_anteil_pct = wie viel des alten Firmenwerts nur gehortete Kasse ist;
--    kasse_plus_7t = Gewinn der letzten 7 Tage, der in der Firma liegen blieb (Gewinn − CEO-Auszahlung)
select c.name,
       round(coalesce(a.balance_cents, 0) / 100.0) as kasse_eur,
       round(pc.unpaid_cents / 100.0) as offene_rechnungen_eur,
       round(public.company_value_cents(c.id) / 100.0) as firmenwert_alt_eur,
       round(100.0 * greatest(0, coalesce(a.balance_cents, 0) - pc.unpaid_cents)
             / nullif(public.company_value_cents(c.id), 0), 1) as kasse_anteil_pct,
       round(coalesce(h.profit7, 0) / 100.0) as gewinn_7t_eur,
       round(coalesce(h.payout7, 0) / 100.0) as ceo_auszahlung_7t_eur,
       round((coalesce(h.profit7, 0) - coalesce(h.payout7, 0)) / 100.0) as kasse_plus_7t_eur,
       round(coalesce(h.profit24, 0) / 100.0) as gewinn_24h_eur,
       round(coalesce(h.profit48, 0) / 100.0) as gewinn_24h_davor_eur,
       pc.last_withdraw_at as letzte_entnahme
  from public.companies c
  join public.player_companies pc on pc.company_id = c.id
  join public.securities s on s.id = c.security_id and s.kind = 'stock' and s.status = 'listed'
  left join public.ledger_accounts a on a.owner_company_id = c.id and a.kind = 'company_cash'
  left join lateral (
    select sum(x.profit_cents) filter (where x.hour_start >= now() - interval '7 days') as profit7,
           sum(x.founder_payout_cents) filter (where x.hour_start >= now() - interval '7 days') as payout7,
           sum(x.profit_cents) filter (where x.hour_start >= now() - interval '24 hours') as profit24,
           sum(x.profit_cents) filter (where x.hour_start >= now() - interval '48 hours'
                                          and x.hour_start < now() - interval '24 hours') as profit48
      from public.player_company_hours x where x.company_id = c.id) h on true
 where not c.is_ai
 order by kasse_anteil_pct desc nulls last;

-- 4) Vorfälle (ADR-216) und Marktkräfte (ADR-214) der letzten 7 Tage je Spieleraktie
select c.name,
       (select count(*) from public.player_company_events ev
         where ev.company_id = c.id and coalesce((ev.definition ->> 'incident')::boolean, false)
           and ev.started_at > now() - interval '7 days') as vorfaelle_7t,
       (select count(*) from public.player_company_events ev
         where ev.company_id = c.id and ev.status not in ('over', 'expired')) as offene_krisen,
       (select count(*) from public.stock_tips t
         where t.security_id = s.id and t.source = 'market' and t.created_at > now() - interval '7 days') as marktkraefte_7t,
       (select round(min(q2.change_bps) / 100.0, 1) from public.security_quotes q2 where q2.security_id = s.id) as heute_pct
  from public.companies c
  join public.securities s on s.id = c.security_id and s.kind = 'stock' and s.status = 'listed'
 where not c.is_ai
 order by vorfaelle_7t desc;

-- 5) Marktstimmung (gilt auch für Spieleraktien) und Anteil der Wochen im Minus: Spieler gegen KI
select mood as stimmung, phase, phase_ends_at as phase_endet, sector_tilts as branchen from public.market_mood;
with w as (
  select c.is_ai, s.id,
         (select c1.close_e4 from public.candles c1 where c1.security_id = s.id and c1.interval = '1h'
           order by c1.bucket_start desc limit 1)::numeric
         / nullif((select c2.close_e4 from public.candles c2 where c2.security_id = s.id and c2.interval = '1h'
                    and c2.bucket_start <= now() - interval '7 days' order by c2.bucket_start desc limit 1), 0) - 1 as r7
    from public.securities s join public.companies c on c.id = s.company_id
   where s.kind = 'stock' and s.status = 'listed')
select case when is_ai then 'KI' else 'Spieler' end as gruppe, count(r7) as aktien,
       round(100 * percentile_cont(0.5) within group (order by r7)::numeric, 1) as median_7t_pct,
       round(100.0 * count(*) filter (where r7 < 0) / nullif(count(r7), 0), 0) as im_minus_pct
  from w group by is_ai;

-- 6) Nach dem Update (ADR-217): die neue Bewertung je Spieleraktie
--    multiple = Wachstum × Stimmung × Branchenzyklus; shock = Schocks von außen (Krise), läuft mit 3 h Halbwertszeit aus
select s.ticker, c.name,
       round((v.parts ->> 'yearly_profit_cents')::numeric / 100) as gewinn_spieljahr_eur,
       round((v.parts ->> 'counted_cash_cents')::numeric / 100) as gezaehlte_kasse_eur,
       round((v.parts ->> 'cash_cents')::numeric / 100) as kasse_eur,
       round(v.anchor_cents / 100.0) as kassen_anker_eur,
       round((v.parts ->> 'growth')::numeric, 2) as wachstum,
       round((v.parts ->> 'mood')::numeric, 2) as stimmung,
       round((v.parts ->> 'cycle')::numeric, 2) as branchenzyklus,
       round((v.parts ->> 'multiple')::numeric, 2) as multiple,
       round(v.shock::numeric, 3) as schock,
       round(st.fair_value_e4 / 1e4, 4) as fair,
       v.run_at as aktualisiert
  from public.player_stock_valuation v
  join public.securities s on s.id = v.security_id
  join public.companies c on c.id = v.company_id
  join public.security_sim_state st on st.security_id = v.security_id
 order by c.name;
