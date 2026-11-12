-- =============================================================================
-- NEXA · seed.sql · reference data
-- =============================================================================
-- Idempotent (every insert uses ON CONFLICT DO NOTHING / idempotency keys), so
-- it is safe to run again after `supabase db reset` or by hand.
-- Display texts are German (game language); identifiers and comments English.
-- NOT seeded here: game_config (generated from src/config/balance.ts via
-- `pnpm db:config`).
-- Units: *_cents = euro cents, *_e4 = 1/10000 euro, *_bps = basis points.
-- =============================================================================

-- Make sure the calendar exists (bond terms and ledger postings refer to it).
do $$ begin perform public.ensure_game_quarters(3); end $$;

-- ---------------------------------------------------------------------------
-- 1. Sectors (spec 6.1). base_demand_cents = shared demand per quarter.
-- ---------------------------------------------------------------------------
insert into public.sectors (key, name, description, icon_key, typical_risk, base_pe, base_demand_cents, demand_growth_bps, sort_order) values
  ('tech',      'Tech/Software', 'Wenig Kapital, langsamer Start, dann explosives Wachstum.',      'sector_tech',      'Ein Produkt floppt',          28,  48240000000, 150, 1),
  ('retail',    'Einzelhandel',  'Stabil, kleine Margen, ständige Preiskriege.',                   'sector_retail',    'Ein Konkurrent unterbietet',  14, 228500000000,  40, 2),
  ('energy',    'Energie',       'Kapitalintensiv und abhängig vom Rohstoffpreis.',                'sector_energy',    'Ölpreis-Event',               12, 145600000000,  30, 3),
  ('pharma',    'Pharma',        'Lange Entwicklung, binäre Studienergebnisse.',                   'sector_pharma',    'Eine Studie scheitert',       22,  53240000000,  80, 4),
  ('logistics', 'Logistik',      'Skaliert über Mitarbeiter und Fuhrpark.',                        'sector_logistics', 'Lohnkosten und Konjunktur',   16,  95700000000,  50, 5)
on conflict (key) do nothing;

insert into public.sector_sim_state (sector_key)
select key from public.sectors
on conflict (sector_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The 15 AI companies (ADR-014)
--    revenue/costs are per quarter in whole euros; price in e4.
-- ---------------------------------------------------------------------------
create temporary table _seed_companies (
  ticker text primary key, name text, slug text, sector_key text, tier public.company_tier,
  description text, brand_color text,
  shares bigint, price_e4 bigint, revenue_eur bigint, costs_eur bigint,
  quality double precision, awareness double precision, price_index double precision,
  dividend_policy public.dividend_policy, payout_bps integer, employees integer
);

insert into _seed_companies values
  -- Tech/Software
  ('KLS', 'KlarSoft AG',         'klarsoft',         'tech',      'bluechip', 'Marktführer für Unternehmenssoftware. Verdient verlässlich an Lizenzen und Cloud-Abos.',              '#4C8DFF',  50000000,  840000,  420000000,  382500000, 1.35, 1.60, 1.10, 'growth',  2000, 14500),
  ('PXW', 'Pixelwerk Studios',   'pixelwerk-studios','tech',      'midcap',   'Spielestudio mit treuer Fangemeinde. Jeder neue Titel kann ein Hit oder ein Flop werden.',            '#B36BFF',  20000000,  235000,   60000000,   55500000, 1.15, 1.05, 1.00, 'none',       0,  1800),
  ('QSL', 'QuantenSprung Labs',  'quantensprung-labs','tech',     'penny',    'Forscht an Quantenchips. Große Versprechen, kaum Umsatz, hoher Kapitalbedarf.',                       '#35D0BA',  40000000,    4200,    2400000,    2900000, 0.90, 0.55, 1.20, 'none',       0,   140),
  -- Retail
  ('BRZ', 'Brotzeit Handel AG',  'brotzeit-handel',  'retail',    'bluechip', 'Größte Supermarktkette des Landes. Kleine Margen, aber Kundschaft bei jeder Konjunktur.',             '#F2A93B',  80000000,  412000, 1960000000, 1901200000, 1.10, 1.70, 0.98, 'stable',  5000, 62000),
  ('KFR', 'Kaufrausch Märkte',   'kaufrausch-maerkte','retail',   'midcap',   'Einkaufszentren und Onlineshop für Mode und Elektronik. Lebt von der Kauflaune.',                     '#FF6B8B',  25000000,  158000,  280000000,  273000000, 1.05, 1.15, 1.02, 'stable',  3500,  9800),
  ('FGD', 'Fundgrube Discount',  'fundgrube-discount','retail',   'penny',    'Restposten-Discounter mit aggressiven Preisen. Ein schlechter Monat kann die Kasse leeren.',          '#C2C95B',  60000000,    6500,   45000000,   44400000, 0.80, 0.70, 0.82, 'none',       0,  2100),
  -- Energy
  ('VLT', 'Volta Energie AG',    'volta-energie',    'energy',    'bluechip', 'Strom- und Gasversorger mit eigenen Kraftwerken. Solide Dividende, hängt am Rohstoffpreis.',          '#FFD23F', 100000000,  564000, 1300000000, 1182500000, 1.20, 1.55, 1.05, 'payout',  6500, 21000),
  ('RKW', 'Rheinkraft Werke',    'rheinkraft-werke', 'energy',    'midcap',   'Regionaler Versorger mit Wasser- und Gaskraftwerken entlang des Rheins.',                             '#5BC0EB',  30000000,  189000,  150000000,  138200000, 1.05, 0.95, 1.00, 'stable',  4500,  3200),
  ('SFX', 'SolarFuchs',          'solarfuchs',       'energy',    'penny',    'Junger Solaranlagenbauer. Wächst schnell, schreibt aber noch rote Zahlen.',                           '#FF8C42',  50000000,    8800,    6000000,    6500000, 0.95, 0.60, 0.92, 'none',       0,   260),
  -- Pharma
  ('NPH', 'NeuroPharm AG',       'neuropharm',       'pharma',    'bluechip', 'Pharmakonzern mit Blockbustern gegen Nervenkrankheiten und einer vollen Studienpipeline.',            '#6EE7A0',  60000000, 1125000,  480000000,  403300000, 1.40, 1.45, 1.15, 'stable',  4000, 11800),
  ('ALM', 'Alpenmed',            'alpenmed',         'pharma',    'midcap',   'Hersteller von Generika und Naturheilmitteln aus dem Alpenraum. Unspektakulär, aber profitabel.',     '#8FD3F4',  15000000,  346000,   52000000,   46100000, 1.10, 0.90, 0.95, 'growth',  2000,  1500),
  ('GNV', 'GenoVita Biotech',    'genovita-biotech', 'pharma',    'penny',    'Biotech-Start-up mit einem einzigen Wirkstoffkandidaten. Die nächste Studie entscheidet alles.',      '#E86AF0',  80000000,    3100,     400000,    2100000, 0.85, 0.50, 1.25, 'none',       0,    90),
  -- Logistics
  ('NDL', 'Nordlicht Logistik AG','nordlicht-logistik','logistics','bluechip','Containerschiffe, Lkw-Flotte und Lagerhallen. Bewegt Waren für das halbe Land.',                      '#7AA2F7',  70000000,  478000,  870000000,  817700000, 1.20, 1.50, 1.04, 'stable',  4500, 38000),
  ('EBX', 'Eilbote Express',     'eilbote-express',  'logistics', 'midcap',   'Paketdienst für die letzte Meile. Wächst mit dem Onlinehandel, leidet unter Lohnkosten.',             '#F7768E',  20000000,  124000,   78000000,   74100000, 1.05, 1.10, 0.97, 'stable',  3000,  7400),
  ('FPT', 'Frachtpilot',         'frachtpilot',      'logistics', 'penny',    'Frachtbörse per App: vermittelt freie Lkw-Ladeflächen. Kleines Team, dünne Marge.',                   '#9ECE6A',  45000000,    5400,    9000000,    8700000, 0.90, 0.65, 0.90, 'none',       0,   120);

insert into public.companies (
  id, name, slug, ticker, description, sector_key, is_ai, tier, legal_form, phase, logo_key, brand_color,
  shares_outstanding, max_employees, employee_count, dividend_policy, dividend_payout_bps,
  ttm_revenue_cents, ttm_net_income_cents, eps_ttm_e4, listed_at
)
select
  md5('nexa:company:' || s.ticker)::uuid, s.name, s.slug, s.ticker, s.description, s.sector_key, true, s.tier, 'ag', 'listed',
  'logo_' || lower(s.ticker), s.brand_color,
  s.shares, 100000, s.employees, s.dividend_policy, s.payout_bps,
  s.revenue_eur * 100 * 4,
  (s.revenue_eur - s.costs_eur) * 100 * 4,
  round((s.revenue_eur - s.costs_eur)::numeric * 100 * 4 * 100 / s.shares)::bigint,
  now()
from _seed_companies s
on conflict (id) do nothing;

insert into public.company_state (
  company_id, quality, awareness, price_index, capacity_cents,
  baseline_revenue_cents, baseline_costs_cents, fixed_costs_cents
)
select
  md5('nexa:company:' || s.ticker)::uuid, s.quality, s.awareness, s.price_index,
  s.revenue_eur * 120,          -- capacity = 120 % of baseline revenue
  s.revenue_eur * 100, s.costs_eur * 100,
  s.costs_eur * 25              -- 25 % of costs are fixed
from _seed_companies s
on conflict (company_id) do nothing;

-- stock securities
insert into public.securities (id, kind, ticker, name, company_id, sector_key, status, tick_size_e4, is_shortable, max_leverage, listed_at)
select
  md5('nexa:security:' || s.ticker)::uuid, 'stock', s.ticker, s.name,
  md5('nexa:company:' || s.ticker)::uuid, s.sector_key, 'listed',
  case when s.price_e4 < 10000 then 10 else 100 end,
  true,
  case s.tier when 'bluechip' then 10 when 'midcap' then 5 else 2 end,
  now()
from _seed_companies s
on conflict (id) do nothing;

update public.companies c
   set security_id = md5('nexa:security:' || c.ticker)::uuid
 where c.is_ai and c.security_id is null and c.ticker is not null
   and exists (select 1 from public.securities s where s.id = md5('nexa:security:' || c.ticker)::uuid);

-- initial quotes (bid/ask = one half-spread around the start price)
insert into public.security_quotes (
  security_id, last_price_e4, bid_e4, ask_e4, prev_close_e4, day_open_e4, day_high_e4, day_low_e4, market_cap_cents
)
select
  md5('nexa:security:' || s.ticker)::uuid,
  s.price_e4,
  s.price_e4 - h.half, s.price_e4 + h.half,
  s.price_e4, s.price_e4, s.price_e4, s.price_e4,
  round(s.shares::numeric * s.price_e4 / 100)::bigint
from _seed_companies s
cross join lateral (
  select case when s.price_e4 < 10000 then 10 else 100 end as tick,
         case s.tier when 'bluechip' then 6 when 'midcap' then 20 else 150 end as spread_bps
) t
cross join lateral (
  select greatest(t.tick, (s.price_e4 * t.spread_bps / 20000 / t.tick) * t.tick) as half
) h
on conflict (security_id) do nothing;

-- hidden simulation anchor
insert into public.security_sim_state (security_id, fair_value_e4, volatility, liquidity_shares, spread_bps)
select
  md5('nexa:security:' || s.ticker)::uuid,
  s.price_e4,
  case s.tier when 'bluechip' then 0.0004 when 'midcap' then 0.0008 else 0.0025 end,
  case s.tier when 'bluechip' then 400000 when 'midcap' then 120000 else 600000 end,
  case s.tier when 'bluechip' then 6 when 'midcap' then 20 else 150 end
from _seed_companies s
on conflict (security_id) do nothing;

-- AI companies are fully in free float (held by AI investors and later players)
insert into public.cap_table_entries (company_id, holder_kind, label, shares)
select md5('nexa:company:' || s.ticker)::uuid, 'public_float', 'Streubesitz', s.shares
from _seed_companies s
on conflict do nothing;

insert into public.share_issuances (id, company_id, kind, shares, price_e4, proceeds_cents, shares_outstanding_after)
select md5('nexa:issuance:' || s.ticker)::uuid, md5('nexa:company:' || s.ticker)::uuid, 'founding', s.shares, s.price_e4, 0, s.shares
from _seed_companies s
on conflict (id) do nothing;

-- company cash accounts with one quarter of costs as opening balance
insert into public.ledger_accounts (kind, owner_company_id, label)
select 'company_cash', md5('nexa:company:' || s.ticker)::uuid, 'Cash ' || s.ticker
from _seed_companies s
on conflict do nothing;

do $$
declare
  r record;
begin
  for r in
    select s.ticker, s.costs_eur * 100 as amount_cents, a.id as account_id
      from _seed_companies s
      join public.ledger_accounts a
        on a.owner_company_id = md5('nexa:company:' || s.ticker)::uuid and a.kind = 'company_cash'
  loop
    perform public.ledger_transfer(
      public.ledger_system_account('mint'), r.account_id, r.amount_cents,
      'opening_balance', 'Opening balance ' || r.ticker, 'company',
      md5('nexa:company:' || r.ticker)::uuid, 'opening_balance:' || r.ticker);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Index NEXA 30 (base 1000.0000 points) with all 15 stocks
-- ---------------------------------------------------------------------------
insert into public.securities (id, kind, ticker, name, status, tick_size_e4, is_tradable, is_shortable, max_leverage, listed_at)
values (md5('nexa:security:NX30')::uuid, 'index', 'NX30', 'NEXA 30', 'listed', 1, false, false, 1, now())
on conflict (id) do nothing;

insert into public.indices (security_id, key, description, base_value_e4, divisor, max_members)
select
  md5('nexa:security:NX30')::uuid, 'NEXA30',
  'Leitindex der 30 größten börsennotierten Unternehmen nach Marktkapitalisierung.',
  10000000,
  (select sum(round(s.shares::numeric * s.price_e4 / 100)) from _seed_companies s)::double precision / 10000000,
  30
on conflict (security_id) do nothing;

insert into public.security_quotes (security_id, last_price_e4, prev_close_e4, day_open_e4, day_high_e4, day_low_e4, market_cap_cents)
select md5('nexa:security:NX30')::uuid, 10000000, 10000000, 10000000, 10000000, 10000000,
       (select sum(round(s.shares::numeric * s.price_e4 / 100)) from _seed_companies s)::bigint
on conflict (security_id) do nothing;

insert into public.index_memberships (index_security_id, member_security_id, weight_bps)
select
  md5('nexa:security:NX30')::uuid,
  md5('nexa:security:' || s.ticker)::uuid,
  round(s.shares::numeric * s.price_e4 * 10000 / (select sum(x.shares::numeric * x.price_e4) from _seed_companies x))::integer
from _seed_companies s
on conflict do nothing;

drop table _seed_companies;

-- ---------------------------------------------------------------------------
-- 4. Government bonds: 1, 2, 5 and 10 game years (1 game year = 1 real day).
--    Price is quoted per 100 EUR face value; coupons track the 3 % policy rate.
-- ---------------------------------------------------------------------------
insert into public.securities (id, kind, ticker, name, status, tick_size_e4, is_shortable, max_leverage, listed_at)
select md5('nexa:security:' || b.ticker)::uuid, 'bond', b.ticker, b.name, 'listed', 100, false, 2, now()
from (values
  ('NXB01', 'Staatsanleihe 1 Jahr'),
  ('NXB02', 'Staatsanleihe 2 Jahre'),
  ('NXB05', 'Staatsanleihe 5 Jahre'),
  ('NXB10', 'Staatsanleihe 10 Jahre')
) as b(ticker, name)
on conflict (id) do nothing;

insert into public.bonds (security_id, issuer, series, term_game_years, coupon_bps, face_value_cents, rating, issued_at, matures_at)
select
  md5('nexa:security:' || b.ticker)::uuid, 'state', b.ticker || '-001', b.years, b.coupon_bps, 10000, 'AAA',
  (public.game_day()::timestamp + interval '8 hours') at time zone 'Europe/Berlin',
  ((public.game_day() + b.years)::timestamp + interval '8 hours') at time zone 'Europe/Berlin'
from (values ('NXB01', 1, 250), ('NXB02', 2, 280), ('NXB05', 5, 330), ('NXB10', 10, 380)) as b(ticker, years, coupon_bps)
on conflict (security_id) do nothing;

insert into public.security_quotes (security_id, last_price_e4, bid_e4, ask_e4, prev_close_e4, day_open_e4, day_high_e4, day_low_e4, yield_bps)
select md5('nexa:security:' || b.ticker)::uuid, 1000000, 999500, 1000500, 1000000, 1000000, 1000000, 1000000, b.coupon_bps
from (values ('NXB01', 250), ('NXB02', 280), ('NXB05', 330), ('NXB10', 380)) as b(ticker, coupon_bps)
on conflict (security_id) do nothing;

insert into public.security_sim_state (security_id, fair_value_e4, volatility, liquidity_shares, spread_bps)
select md5('nexa:security:' || b.ticker)::uuid, 1000000, b.vol, 1000000, 10
from (values ('NXB01', 0.00002), ('NXB02', 0.00004), ('NXB05', 0.00008), ('NXB10', 0.00014)) as b(ticker, vol)
on conflict (security_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Central bank, macro indicators
-- ---------------------------------------------------------------------------
insert into public.central_bank_state (id, policy_rate_bps) values (true, 300)
on conflict (id) do nothing;

insert into public.macro_indicators (key, name, unit, value, description) values
  ('oil_price',           'Ölpreis',            'EUR/Barrel', 80,  'Steigt der Ölpreis, profitieren Energiewerte, Logistik leidet.'),
  ('consumer_confidence', 'Konsumklima',        'Punkte',     100, 'Kauflaune der Haushalte. Treibt vor allem den Einzelhandel.'),
  ('wage_index',          'Lohnindex',          'Punkte',     100, 'Lohnniveau. Belastet personalintensive Branchen wie Logistik.'),
  ('business_cycle',      'Konjunkturindex',    'Punkte',     100, 'Gesamtwirtschaftliche Lage. Wirkt auf die Nachfrage aller Branchen.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. AI investor archetypes (spec 5.3, ADR-005). Internal.
-- ---------------------------------------------------------------------------
insert into public.ai_investors (key, name, description, cash_cents, params) values
  ('market_maker',  'Marktmacher',
   'Stellt immer Kauf- und Verkaufsangebote mit Spread und sorgt für Grundliquidität.',
   500000000000, '{"quoteLevels": 5, "inventorySkew": 0.3, "afterHoursSpreadFactor": 3, "afterHoursDepthFactor": 0.3}'),
  ('value_fund',    'Value-Fonds',
   'Kauft unter dem fairen Wert, verkauft darüber und reagiert langsam.',
   2000000000000, '{"reactionSpeed": 0.02, "threshold": 0.05, "maxWeightBps": 1200}'),
  ('momentum_trader', 'Momentum-Trader',
   'Springt auf Trends auf und verstärkt Bewegungen.',
   600000000000, '{"lookbackTicks": 120, "gain": 0.6, "stopBps": 400}'),
  ('pension_fund',  'Rentenfonds',
   'Schichtet je nach Leitzins zwischen Anleihen und Dividendenaktien um.',
   3000000000000, '{"neutralRateBps": 300, "rateSensitivity": 1.5, "minDividendYieldBps": 250}'),
  ('index_fund',    'Indexfonds',
   'Hält die NEXA-30-Aktien nach Marktkapitalisierung und kauft bei Indexaufnahme.',
   2500000000000, '{"index": "NEXA30", "rebalanceSpeed": 0.1, "inclusionBuyDays": 1}'),
  ('retail_herd',   'Kleinanleger-Herde',
   'Reagiert emotional auf News und Hype und übertreibt in beide Richtungen.',
   400000000000, '{"newsGain": 1.8, "hypeDecay": 0.97, "panicThreshold": -0.08}')
on conflict (key) do nothing;

insert into public.sim_rng_streams (stream_key, seed) values
  ('market', 20261110), ('events', 4242), ('hr', 1337), ('regulator', 9001), ('player_events', 777)
on conflict (stream_key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Levels 1..50 (ADR-055): xp_to_next = 100 at level 1, then round(250 * n^1.5)
--    (progression.firstLevelXp / xpBase; game_config is loaded after this file)
-- ---------------------------------------------------------------------------
insert into public.levels (level, xp_to_next, xp_cumulative)
select
  n,
  case when n = 1 then 100 when n < 50 then round(250 * power(n, 1.5))::bigint end,
  case when n = 1 then 0
       else 100 + coalesce((select sum(round(250 * power(m, 1.5)))::bigint from generate_series(2, n - 1) as m), 0) end
from generate_series(1, 50) as n
on conflict (level) do update set xp_to_next = excluded.xp_to_next, xp_cumulative = excluded.xp_cumulative;

-- ---------------------------------------------------------------------------
-- 8. Mission templates (daily: 200-400 XP, 3 per day; weekly; unlock intros)
-- ---------------------------------------------------------------------------
insert into public.mission_templates (key, kind, title, description, icon_key, metric, target_min, target_max, xp_min, xp_max, reward_cents, min_level) values
  ('daily_trades',          'daily',  'Aktiv am Markt',        'Führe {target} Trades aus.',                                      'mission_trade',    'trades_executed',           3,       5, 200, 300, 0, 1),
  ('daily_profit_trade',    'daily',  'Im Plus',               'Schließe {target} Trades mit Gewinn.',                            'mission_profit',   'profitable_trades_closed',  1,       2, 250, 400, 0, 1),
  ('daily_volume',          'daily',  'Umsatz machen',         'Handle Wertpapiere im Wert von {target}.',                        'mission_volume',   'traded_volume_cents',  200000, 1000000, 200, 350, 0, 1),
  ('daily_vault',           'daily',  'Kasse machen',          'Leere deinen Tresor {target}-mal.',                               'mission_vault',    'vault_claims',              1,       2, 200, 250, 0, 1),
  ('daily_sectors',         'daily',  'Über den Tellerrand',   'Kaufe Aktien aus {target} verschiedenen Branchen.',               'mission_sectors',  'sectors_bought',            2,       3, 250, 350, 0, 1),
  ('daily_work_task',       'daily',  'Fleißig im Job',        'Erledige {target} Arbeitsaufgaben.',                              'mission_work',     'work_tasks_completed',      1,       2, 250, 350, 0, 2),
  ('daily_limit_fill',      'daily',  'Geduld zahlt sich aus', 'Lass {target} Limit-Orders ausführen.',                           'mission_limit',    'limit_orders_filled',       1,       2, 250, 350, 0, 3),
  ('daily_bond',            'daily',  'Sicherer Hafen',        'Kaufe Staatsanleihen im Wert von {target}.',                      'mission_bond',     'bonds_bought_cents',   100000,  500000, 200, 300, 0, 5),
  ('daily_short',           'daily',  'Gegen den Strom',       'Eröffne {target} Short-Position.',                                'mission_short',    'shorts_opened',             1,       1, 300, 400, 0, 8),
  ('daily_company_decision','daily',  'Chefsache',             'Reiche die Quartalsentscheidungen deiner Firma ein.',             'mission_company',  'quarter_decisions_submitted', 1,     1, 300, 400, 0, 10),
  ('daily_opening_bell',    'daily',  'Früher Vogel',          'Führe {target} Trades in der ersten Handelsstunde aus.',          'mission_bell',     'opening_hour_trades',       1,       2, 250, 350, 0, 1),
  ('weekly_growth',         'weekly', 'Wochen-Challenge: Wachstum', 'Steigere deinen Portfoliowert diese Woche um {target} %.',   'mission_growth',   'portfolio_growth_bps',    300,     800, 1000, 1500, 0, 1),
  ('weekly_trades',         'weekly', 'Wochen-Challenge: Vieltrader', 'Führe diese Woche {target} Trades aus.',                   'mission_trade',    'trades_executed',          30,      60,  800, 1200, 0, 1),
  ('weekly_work',           'weekly', 'Wochen-Challenge: Arbeitstier', 'Sammle diese Woche {target} bezahlte Arbeitsminuten.',    'mission_work',     'paid_work_minutes',      1200,    2400,  800, 1200, 0, 2),
  ('intro_first_trade',     'intro',  'Dein erster Trade',     'Kaufe deine erste Aktie per Market-Order.',                       'mission_trade',    'trades_executed',           1,       1, 100, 100, 0, 1),
  ('intro_first_vault',     'intro',  'Erstes Grundeinkommen', 'Leere zum ersten Mal deinen Tresor.',                             'mission_vault',    'vault_claims',              1,       1, 100, 100, 0, 1),
  ('intro_first_job',       'intro',  'Erster Arbeitstag',     'Nimm deinen ersten Job an.',                                      'mission_work',     'jobs_started',              1,       1, 150, 150, 0, 2),
  ('intro_first_limit',     'intro',  'Preis festlegen',       'Platziere deine erste Limit-Order.',                              'mission_limit',    'limit_orders_placed',       1,       1, 150, 150, 0, 3),
  ('intro_first_stop',      'intro',  'Sicherheitsnetz',       'Sichere eine Position mit einem Stop-Loss ab.',                   'mission_stop',     'stop_orders_placed',        1,       1, 150, 150, 0, 5),
  ('intro_first_bond',      'intro',  'Erste Anleihe',         'Kaufe deine erste Staatsanleihe.',                                'mission_bond',     'bond_trades',               1,       1, 150, 150, 0, 5),
  ('intro_first_short',     'intro',  'Mach deinen ersten Short-Trade', 'Setze mit einem Leerverkauf auf fallende Kurse.',        'mission_short',    'shorts_opened',             1,       1, 250, 250, 0, 8),
  ('intro_found_company',   'intro',  'Gründe dein Unternehmen', 'Gründe dein erstes Kleinunternehmen.',                          'mission_company',  'companies_founded',         1,       1, 500, 500, 0, 10),
  ('intro_first_leverage',  'intro',  'Mit Hebel handeln',     'Eröffne deine erste gehebelte Position.',                         'mission_leverage', 'leveraged_positions_opened', 1,      1, 300, 300, 0, 12)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Unlocks (spec 9.3). key is what has_unlock() checks server side.
-- ---------------------------------------------------------------------------
insert into public.unlocks (key, level, title, description, icon_key, intro_mission_key, sort_order) values
  ('market_orders',         1,  'Aktienhandel',            'Kaufe und verkaufe Aktien per Market-Order.',                                   'unlock_trade',     'intro_first_trade',    10),
  ('basic_income',          1,  'Grundeinkommen',          '100 € pro Stunde landen in deinem Tresor, auch wenn du offline bist.',          'unlock_vault',     'intro_first_vault',    11),
  ('jobs_intern',           2,  'Erster Job',              'Bewirb dich als Praktikant und verdiene ein Gehalt.',                           'unlock_job',       'intro_first_job',      20),
  ('limit_orders',          3,  'Limit-Order',             'Lege den Preis fest, zu dem du kaufen oder verkaufen willst.',                  'unlock_limit',     'intro_first_limit',    30),
  ('watchlist',             3,  'Watchlist',               'Behalte deine Lieblingsaktien im Blick.',                                       'unlock_watchlist', null,                   31),
  ('stop_loss',             5,  'Stop-Loss',               'Begrenze Verluste automatisch.',                                                'unlock_stop',      'intro_first_stop',     50),
  ('bonds',                 5,  'Staatsanleihen',          'Sichere Zinsen mit Laufzeiten von 1 bis 10 Spieljahren.',                       'unlock_bond',      'intro_first_bond',     51),
  ('jobs_junior',           5,  'Junior-Jobs',             'Besser bezahlte Jobs mit anspruchsvolleren Aufgaben.',                          'unlock_job',       null,                   52),
  ('analyst_reports',       7,  'Analystenberichte',       'Kursziele der Analysten. Manchmal liegen sie daneben.',                         'unlock_analyst',   null,                   70),
  ('short_selling',         8,  'Leerverkäufe',            'Verdiene an fallenden Kursen.',                                                 'unlock_short',     'intro_first_short',    80),
  ('artworks',              8,  'Artworks',                'Male eigene Pixel-Kunst, sammle Unikate und biete in Auktionen mit.',          'unlock_art',       null,                   81),
  ('found_small_business', 10,  'Kleinunternehmen gründen','Gründe deine eigene Firma und führe sie durch die Quartale.',                   'unlock_company',   'intro_found_company', 100),
  ('leverage_2x',          12,  'Hebel 2×',                'Handle mit doppeltem Einsatz. Gewinne und Verluste verdoppeln sich.',           'unlock_leverage',  'intro_first_leverage',120),
  ('jobs_senior',          12,  'Senior-Jobs',             'Senior-Positionen mit deutlich höherem Gehalt.',                                'unlock_job',       null,                  121),
  ('personal_loan',        15,  'Kleinkredit',             'Leihe dir bis zu 50.000 €.',                                                    'unlock_loan',      null,                  150),
  ('business_angel',       15,  'Business Angel',          'Investiere vorbörslich in die Firmen anderer Spieler.',                         'unlock_angel',     null,                  151),
  ('leverage_5x',          18,  'Hebel 5×',                'Fünffacher Hebel für erfahrene Trader.',                                        'unlock_leverage',  null,                  180),
  ('expand_small_business',18,  'Firmenerweiterung',       'Erweitere dein Kleinunternehmen auf bis zu 20 Mitarbeiter.',                    'unlock_company',   null,                  181),
  ('found_gmbh',           20,  'GmbH gründen',            'Gründe eine GmbH oder wandle dein Kleinunternehmen um.',                        'unlock_company',   null,                  200),
  ('company_loans',        20,  'Firmenkredite',           'Kredite bis 250.000 € für dein Unternehmen.',                                   'unlock_loan',      null,                  201),
  ('jobs_team_lead',       20,  'Teamleitung',             'Führungsjobs mit Verantwortung.',                                               'unlock_job',       null,                  202),
  ('found_ag',             25,  'Aktiengesellschaft',      'Wandle deine Firma in eine AG um und bereite den Börsengang vor.',              'unlock_company',   null,                  250),
  ('ipo',                  25,  'Börsengang',              'Bring dein Unternehmen an die Börse.',                                          'unlock_ipo',       null,                  251),
  ('jobs_c_level',         25,  'C-Level-Jobs',            'Werde CFO oder COO und triff echte Entscheidungen.',                            'unlock_job',       null,                  252),
  ('leverage_10x',         30,  'Hebel 10×',               'Maximaler Hebel. Maximales Risiko.',                                            'unlock_leverage',  null,                  300),
  ('options',              30,  'Optionen',                'Handle Calls und Puts.',                                                        'unlock_options',   null,                  301),
  ('takeovers',            35,  'Übernahmen',              'Übernimm andere Firmen, freundlich oder feindlich.',                            'unlock_takeover',  null,                  350),
  ('holding',              40,  'Holding',                 'Führe mehrere Firmen gleichzeitig.',                                            'unlock_holding',   null,                  400),
  ('legend',               50,  'Börsenlegende',           'Titel „Börsenlegende“, goldener Profilrahmen und Platz in der Hall of Fame.',   'unlock_legend',    null,                  500)
on conflict (key) do nothing;

update public.mission_templates m
   set required_unlock_key = v.unlock_key
  from (values
    ('daily_limit_fill', 'limit_orders'), ('daily_bond', 'bonds'), ('daily_short', 'short_selling'),
    ('daily_company_decision', 'found_small_business'), ('daily_work_task', 'jobs_intern'), ('weekly_work', 'jobs_intern')
  ) as v(mission_key, unlock_key)
 where m.key = v.mission_key and m.required_unlock_key is null;

-- ---------------------------------------------------------------------------
-- 10. Achievements (>= 40, spec 11.2). icon_key = pixel icon component.
-- ---------------------------------------------------------------------------
insert into public.achievements (key, title, description, icon_key, category, metric, threshold, xp_reward, is_hidden, sort_order) values
  -- the eight from the spec
  ('all_in',            'All In',                'Schließe einen Trade mit 10×-Hebel im Gewinn.',                              'ach_all_in',          'risk',        'leverage_10x_profit_trades',        1,  1000, false,  10),
  ('wolf_of_nexa',      'Wolf der NEXA',         'Mache 100.000 € Gewinn an einem einzigen Tag.',                              'ach_wolf',            'trading',     'daily_realized_profit_cents', 10000000,  5000, false,  20),
  ('total_loss',        'Totalverlust',          'Eine deiner Positionen wurde liquidiert.',                                   'ach_skull',           'risk',        'liquidations',                      1,   250, false,  30),
  ('diamond_hands',     'Diamond Hands',         'Halte eine Aktie 14 Tage und verkaufe sie mit mindestens +50 %.',            'ach_diamond',         'trading',     'diamond_hands_sales',               1,  2500, false,  40),
  ('oracle',            'Orakel',                'Schätze 5 Quartalszahlen in Folge richtig.',                                 'ach_brain',           'career',      'earnings_estimate_streak',          5,  2000, false,  50),
  ('rentier',           'Rentier',               'Kassiere 10.000 € Dividende in einer Woche.',                                'ach_bank',            'wealth',      'weekly_dividends_cents',      1000000,  3000, false,  60),
  ('bell_ringer',       'Glockenschläger',       'Bringe deine eigene Firma an die Börse.',                                    'ach_bell',            'company',     'ipos_completed',                    1,  7500, false,  70),
  ('index_climber',     'Index-Aufsteiger',      'Deine Firma wird in den NEXA 30 aufgenommen.',                               'ach_crown',           'company',     'index_inclusions',                  1, 10000, false,  80),
  -- trading
  ('first_trade',       'Erster Handel',         'Führe deinen ersten Trade aus.',                                             'ach_first_trade',     'trading',     'trades_executed',                   1,   100, false, 100),
  ('trades_100',        'Stammkunde',            'Führe 100 Trades aus.',                                                      'ach_trades_100',      'trading',     'trades_executed',                 100,   500, false, 110),
  ('trades_1000',       'Parketthai',            'Führe 1.000 Trades aus.',                                                    'ach_trades_1000',     'trading',     'trades_executed',                1000,  2500, false, 120),
  ('first_profit',      'Erster Gewinn',         'Schließe einen Trade mit Gewinn.',                                           'ach_first_profit',    'trading',     'profitable_trades_closed',          1,   100, false, 130),
  ('profit_10k',        'Fünfstellig',           'Mache 10.000 € Gewinn mit einem einzigen Trade.',                            'ach_profit_10k',      'trading',     'max_trade_profit_cents',      1000000,  1000, false, 140),
  ('patience',          'Geduldsspiel',          'Deine erste Limit-Order wurde ausgeführt.',                                  'ach_hourglass',       'trading',     'limit_orders_filled',               1,   150, false, 150),
  ('emergency_brake',   'Notbremse',             'Ein Stop-Loss hat dich vor Schlimmerem bewahrt.',                            'ach_brake',           'trading',     'stop_orders_triggered',             1,   200, false, 160),
  ('early_bird',        'Früher Vogel',          'Handle an 5 Tagen in der ersten Handelsstunde.',                             'ach_early_bird',      'trading',     'opening_hour_trade_days',           5,   400, false, 170),
  ('diversified',       'Breit aufgestellt',     'Halte gleichzeitig Aktien aus allen fünf Branchen.',                         'ach_pie',             'trading',     'sectors_held',                      5,   400, false, 180),
  ('bond_ladder',       'Leiterbauer',           'Halte gleichzeitig Staatsanleihen aller vier Laufzeiten.',                   'ach_ladder',          'trading',     'bond_terms_held',                   4,   500, false, 190),
  -- risk
  ('pessimist',         'Schwarzseher',          'Schließe deinen ersten Leerverkauf mit Gewinn.',                             'ach_bear',            'risk',        'profitable_shorts_closed',          1,   500, false, 200),
  ('caught_cold',       'Kalt erwischt',         'Schließe einen Short mit mehr als 30 % Verlust.',                            'ach_ice',             'risk',        'short_squeeze_losses',              1,   300, true,  210),
  ('penny_jackpot',     'Pennystock-Jackpot',    'Verdopple deinen Einsatz mit einem Pennystock.',                             'ach_jackpot',         'risk',        'penny_doublings',                   1,  1500, false, 220),
  ('margin_survivor',   'Auf Messers Schneide',  'Überstehe einen Margin Call, ohne liquidiert zu werden.',                    'ach_knife',           'risk',        'margin_calls_survived',             1,   800, false, 230),
  ('trial_winner',      'Studienglück',          'Halte eine Pharma-Aktie durch ein positives Studienergebnis.',               'ach_pill',            'risk',        'pharma_trials_won',                 1,  1200, false, 240),
  -- wealth
  ('millionaire',       'Erste Million',         'Erreiche ein Gesamtvermögen von 1 Mio. €.',                                  'ach_million',         'wealth',      'net_worth_cents',             100000000,  2500, false, 300),
  ('ten_millionaire',   'Zehnfacher Millionär',  'Erreiche ein Gesamtvermögen von 10 Mio. €.',                                 'ach_ten_million',     'wealth',      'net_worth_cents',            1000000000,  5000, false, 310),
  ('hundred_millionaire','Hundert Millionen',    'Erreiche ein Gesamtvermögen von 100 Mio. €.',                                'ach_hundred_million', 'wealth',      'net_worth_cents',           10000000000, 10000, false, 320),
  ('vulture',           'Pleitegeier',           'Du bist bankrottgegangen. Das passiert den Besten.',                         'ach_vulture',         'wealth',      'bankruptcies',                      1,   200, true,  330),
  ('comeback',          'Comeback',              'Erreiche nach einem Bankrott wieder 100.000 € Vermögen.',                    'ach_phoenix',         'wealth',      'comebacks',                         1,  2000, false, 340),
  ('saver',             'Sparfuchs',             'Leere 10 randvolle Tresore.',                                                'ach_vault',           'wealth',      'full_vault_claims',                10,   300, false, 350),
  ('dividend_collector','Kuponschneider',        'Erhalte Dividenden von 5 verschiedenen Unternehmen.',                        'ach_coupon',          'wealth',      'dividend_companies',                5,   600, false, 360),
  -- progression
  ('streak_7',          'Wochenstammgast',       'Logge dich 7 Tage in Folge ein.',                                            'ach_streak_7',        'progression', 'login_streak',                      7,   300, false, 400),
  ('streak_30',         'Dauerbrenner',          'Logge dich 30 Tage in Folge ein.',                                           'ach_streak_30',       'progression', 'login_streak',                     30,  1500, false, 410),
  ('streak_100',        'Urgestein',             'Logge dich 100 Tage in Folge ein.',                                          'ach_streak_100',      'progression', 'login_streak',                    100,  5000, false, 420),
  ('dutiful',           'Pflichtbewusst',        'Schließe 50 tägliche Missionen ab.',                                         'ach_checklist',       'progression', 'missions_completed',               50,   800, false, 430),
  ('level_10',          'Gründerzeit',           'Erreiche Level 10.',                                                         'ach_level_10',        'progression', 'level',                            10,   500, false, 440),
  ('level_25',          'Börsenreif',            'Erreiche Level 25.',                                                         'ach_level_25',        'progression', 'level',                            25,  2000, false, 450),
  ('level_50',          'Börsenlegende',         'Erreiche Level 50.',                                                         'ach_level_50',        'progression', 'level',                            50, 10000, false, 460),
  -- career
  ('first_day',         'Erster Arbeitstag',     'Tritt deinen ersten Job an.',                                                'ach_briefcase',       'career',      'jobs_started',                      1,   100, false, 500),
  ('promoted',          'Beförderung',           'Werde zum ersten Mal befördert.',                                            'ach_promotion',       'career',      'promotions',                        1,   400, false, 510),
  ('executive_floor',   'Chefetage',             'Übernimm einen C-Level-Job.',                                                'ach_executive',       'career',      'c_level_jobs',                      1,  3000, false, 520),
  ('negotiator',        'Verhandlungsgeschick',  'Gewinne 3 Gehaltsverhandlungen.',                                            'ach_handshake',       'career',      'negotiations_won',                  3,   600, false, 530),
  ('busy_bee',          'Fleißbiene',            'Erledige 100 Arbeitsaufgaben.',                                              'ach_bee',             'career',      'work_tasks_completed',            100,  1000, false, 540),
  ('turncoat',          'Seitenwechsler',        'Wechsle zu einem direkten Konkurrenten deines Arbeitgebers.',                'ach_turncoat',        'career',      'competitor_switches',               1,   500, true,  550),
  -- company
  ('founder',           'Gründergeist',          'Gründe dein erstes Unternehmen.',                                            'ach_founder',         'company',     'companies_founded',                 1,  1000, false, 600),
  ('break_even',        'Schwarze Null',         'Schließe ein Quartal mit Gewinn ab.',                                        'ach_break_even',      'company',     'profitable_quarters',               1,   500, false, 610),
  ('six_figures',       'Sechsstellig',          'Erziele 100.000 € Umsatz in einem Quartal.',                                 'ach_six_figures',     'company',     'quarter_revenue_cents',       10000000,  1000, false, 620),
  ('market_leader',     'Marktführer',           'Halte den größten Marktanteil deiner Branche.',                              'ach_podium',          'company',     'sector_leader_quarters',            1,  5000, false, 630),
  ('employer',          'Arbeitgeber',           'Beschäftige 20 Mitarbeiter.',                                                'ach_team',            'company',     'employees',                        20,   800, false, 640),
  ('promise_kept',      'Wort gehalten',         'Halte 4 Prognosen in Folge ein.',                                            'ach_seal',            'company',     'guidance_met_streak',               4,  1500, false, 650),
  ('dividend_king',     'Dividendenkönig',       'Zahle 8 Quartale in Folge eine Dividende.',                                  'ach_dividend_king',   'company',     'dividend_streak',                   8,  3000, false, 660),
  ('caught',            'Erwischt',              'Die Finanzaufsicht hat dich beim Insiderhandel ertappt.',                    'ach_handcuffs',       'company',     'insider_violations_detected',       1,   100, true,  670),
  -- social / lifestyle
  ('angel_investor',    'Business Angel',        'Investiere vorbörslich in die Firma eines anderen Spielers.',                'ach_angel',           'social',      'angel_investments',                 1,   600, false, 700),
  ('networker',         'Netzwerker',            'Füge 3 Freunde hinzu.',                                                      'ach_network',         'social',      'friends',                           3,   200, false, 710),
  ('league_champion',   'Liga-Champion',         'Gewinne die Wochenliga.',                                                    'ach_trophy',          'social',      'league_wins',                       1,  1500, false, 720),
  ('time_is_money',     'Zeit ist Geld',         'Kaufe dir eine Rolex.',                                                      'ach_watch',           'lifestyle',   'lifestyle_rolex',                   1,   300, false, 800),
  ('island_owner',      'Inselbegabung',         'Kaufe dir deine eigene Insel.',                                              'ach_island',          'lifestyle',   'lifestyle_island',                  1, 10000, false, 810)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 11. Cosmetics (starter set), lifestyle items (spec 11.3)
-- ---------------------------------------------------------------------------
insert into public.cosmetic_items (key, kind, slot, title, icon_key, unlock_level, unlock_achievement_key, is_default, sort_order) values
  ('title_newcomer',        'title',         null,        'Neuling',           'title_newcomer',  1,    null,              true,  10),
  ('title_founder',         'title',         null,        'Gründer',           'title_founder',   null, 'founder',         false, 20),
  ('title_league_champion', 'title',         null,        'Liga-Champion',     'title_trophy',    null, 'league_champion', false, 30),
  ('title_vulture',         'title',         null,        'Pleitegeier',       'title_vulture',   null, 'vulture',         false, 40),
  ('title_legend',          'title',         null,        'Börsenlegende',     'title_legend',    50,   null,              false, 50),
  ('frame_default',         'profile_frame', null,        'Standardrahmen',    'frame_default',   1,    null,              true,  10),
  ('frame_silver',          'profile_frame', null,        'Silberrahmen',      'frame_silver',    25,   null,              false, 20),
  ('frame_gold',            'profile_frame', null,        'Goldener Rahmen',   'frame_gold',      50,   null,              false, 30),
  ('head_default',          'avatar_part',   'head',      'Standardkopf',      'avatar_head_1',   1,    null,              true,  10),
  ('hair_short',            'avatar_part',   'hair',      'Kurzhaarschnitt',   'avatar_hair_1',   1,    null,              true,  10),
  ('hair_long',             'avatar_part',   'hair',      'Lange Haare',       'avatar_hair_2',   1,    null,              true,  20),
  ('outfit_hoodie',         'avatar_part',   'outfit',    'Hoodie',            'avatar_outfit_1', 1,    null,              true,  10),
  ('outfit_suit',           'avatar_part',   'outfit',    'Anzug',             'avatar_outfit_2', 12,   null,              false, 20),
  ('accessory_glasses',     'avatar_part',   'accessory', 'Brille',            'avatar_acc_1',    5,    null,              false, 10),
  ('accessory_crown',       'avatar_part',   'accessory', 'Krone',             'avatar_acc_2',    null, 'index_climber',   false, 20)
on conflict (key) do nothing;

insert into public.lifestyle_items (key, title, description, icon_key, price_cents, upkeep_cents_per_quarter, reputation_bonus, sort_order) values
  ('rolex',     'Rolex',        'Eine Uhr, die mehr kostet als dein erstes Depot. Wartung inklusive.',                      'lifestyle_rolex',           2500000,      5000, 0, 1),
  ('porsche',   'Porsche',      'Sportwagen mit Versicherung, Garage und Spritkosten.',                                     'lifestyle_porsche',        15000000,     75000, 0, 2),
  ('penthouse', 'Penthouse',    'Wohnen über den Dächern der Stadt. Macht Eindruck bei Investoren: +5 % Reputation.',       'lifestyle_penthouse',     150000000,    600000, 5, 3),
  ('jet',       'Privatjet',    'Nie wieder Economy. Crew, Hangar und Kerosin gehen ins Geld.',                             'lifestyle_jet',          2000000000,  15000000, 0, 4),
  ('island',    'Eigene Insel', 'Dein privates Paradies. Der Unterhalt ist so groß wie die Aussicht.',                      'lifestyle_island',      10000000000,  60000000, 0, 5)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 12. Random events (spec 11.4) and macro events (spec 5.5). Internal params.
-- ---------------------------------------------------------------------------
insert into public.random_event_definitions (key, title, description, icon_key, effect, params, weight, min_level, cooldown_hours, requires_choice) values
  ('inheritance',   'Erbschaft',                 'Eine entfernte Tante hat dir etwas hinterlassen: +5.000 €.',                              'event_inheritance', 'cash_fixed',   '{"amountCents": 500000}',                       40, 1, 72, false),
  ('tax_audit',     'Steuerprüfung',             'Das Finanzamt hat nachgerechnet: −3 % deines Bargelds.',                                  'event_tax_audit',   'cash_percent', '{"bps": -300, "maxCents": 50000000}',           40, 3, 72, false),
  ('headhunter',    'Headhunter ruft an',        'Ein Headhunter bietet dir einen Jobwechsel mit +30 % Gehalt an.',                         'event_headhunter',  'salary_offer', '{"raiseBps": 3000, "validHours": 12}',          30, 5, 96, true),
  ('golf_tip',      'Tipp aus dem Golfclub',     'Jemand flüstert dir zu, welche Aktie bald steigen soll. Ob das stimmt?',                  'event_golf_tip',    'market_tip',   '{"accuracyBps": 6000, "horizonHours": 6}',      35, 7, 48, false),
  ('found_wallet',  'Fundsache',                 'Du findest eine Geldbörse und bekommst Finderlohn: +250 €.',                              'event_wallet',      'cash_fixed',   '{"amountCents": 25000}',                        60, 1, 24, false),
  ('parking_ticket','Strafzettel',               'Falsch geparkt vor der Börse: −60 €.',                                                    'event_ticket',      'cash_fixed',   '{"amountCents": -6000}',                        50, 1, 24, false),
  ('seminar',       'Fachvortrag',               'Du besuchst einen Vortrag über Bilanzanalyse und lernst dazu: +150 XP.',                  'event_seminar',     'xp',           '{"xp": 150}',                                   45, 2, 48, false)
on conflict (key) do nothing;

insert into public.macro_event_definitions (key, kind, title, description, icon_key, effects, weight, duration_quarters) values
  ('sector_crisis',  'sector_crisis',   'Branchenkrise',    'Die Branche {sector} gerät unter Druck: Nachfrage und Stimmung brechen ein.',   'macro_crisis',    '{"target": "random_sector", "demandFactor": 0.8, "sentiment": -0.5}',                                   30, 2),
  ('oil_shock',      'commodity_shock', 'Rohstoffschock',   'Der Ölpreis springt nach oben. Energiewerte profitieren, Logistik leidet.',     'macro_oil',       '{"indicator": "oil_price", "change": 0.3, "sectors": {"energy": 0.4, "logistics": -0.4}}',            25, 2),
  ('oil_glut',       'commodity_shock', 'Ölschwemme',       'Der Ölpreis fällt deutlich. Logistik atmet auf, Energiewerte geben nach.',      'macro_oil',       '{"indicator": "oil_price", "change": -0.25, "sectors": {"energy": -0.35, "logistics": 0.3}}',         20, 2),
  ('recession',      'recession',       'Konjunkturdelle',  'Die Wirtschaft kühlt ab. Die Nachfrage sinkt in allen Branchen.',               'macro_recession', '{"indicator": "business_cycle", "change": -0.1, "demandFactor": 0.9, "sentiment": -0.3}',             15, 3),
  ('tech_boom',      'tech_boom',       'Tech-Boom',        'Technologiewerte sind gefragt wie nie. Die Branche wächst sprunghaft.',         'macro_boom',      '{"sectors": {"tech": 0.6}, "demandFactor": 1.25, "sentiment": 0.5}',                                  20, 2)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 13. News templates (variables in {braces}). Internal.
-- ---------------------------------------------------------------------------
insert into public.news_templates (key, category, headline_template, body_template, sentiment, importance) values
  ('earnings_beat',      'earnings',     '{company} übertrifft die Erwartungen',                  '{company} meldet {revenue} Umsatz und {profit} Gewinn im {quarter}. Analysten hatten weniger erwartet.',      0.6, 2),
  ('earnings_miss',      'earnings',     '{company} enttäuscht mit Quartalszahlen',               '{company} verfehlt im {quarter} die Prognosen: {revenue} Umsatz, {profit} Ergebnis.',                         -0.6, 2),
  ('earnings_inline',    'earnings',     '{company} liefert solide Zahlen',                       '{company} erreicht im {quarter} {revenue} Umsatz und liegt damit im Rahmen der Erwartungen.',                 0.1, 1),
  ('rate_hike',          'central_bank', 'Zentralbank erhöht den Leitzins auf {rate}',            'Die Währungshüter reagieren auf die wachsende Geldmenge. Anleihen werden attraktiver, Aktien geraten unter Druck.', -0.4, 3),
  ('rate_cut',           'central_bank', 'Zentralbank senkt den Leitzins auf {rate}',             'Billigeres Geld soll die Wirtschaft ankurbeln. An der Börse kommt das gut an.',                                0.4, 3),
  ('rate_hold',          'central_bank', 'Leitzins bleibt bei {rate}',                            'Die Zentralbank sieht keinen Handlungsbedarf.',                                                                 0.0, 1),
  ('trial_success',      'company',      'Durchbruch bei {company}: Studie erfolgreich',          'Der Wirkstoffkandidat von {company} erreicht alle Studienziele. Die Zulassung rückt näher.',                    0.9, 3),
  ('trial_failure',      'company',      'Rückschlag für {company}: Studie gescheitert',          'Die entscheidende Studie von {company} verfehlt ihr Ziel. Anleger reagieren geschockt.',                       -0.9, 3),
  ('oil_report_up',      'commodity',    'Ölpreis steigt auf {price}',                            'Der Ölpreis-Report zeigt knappe Lager. Energieversorger profitieren, Logistiker zahlen drauf.',                 0.0, 2),
  ('oil_report_down',    'commodity',    'Ölpreis fällt auf {price}',                             'Volle Lager drücken den Preis. Gut für Logistik, schlecht für Energiewerte.',                                   0.0, 2),
  ('ipo_announced',      'ipo',          '{company} will an die Börse',                           '{founder} bringt {company} an die NEXA. Preisspanne: {low} bis {high} je Aktie.',                               0.3, 2),
  ('ipo_success',        'ipo',          '{company} feiert Börsendebüt',                          'Die Aktie von {company} startet zu {price}. Das Orderbuch war {coverage}-fach überzeichnet.',                   0.5, 3),
  ('ipo_failed',         'ipo',          'Börsengang von {company} geplatzt',                     'Zu wenig Nachfrage: {company} sagt den Börsengang ab.',                                                        -0.5, 2),
  ('index_inclusion',    'index',        '{company} steigt in den NEXA 30 auf',                   'Indexfonds müssen die Aktie von {company} jetzt kaufen.',                                                       0.7, 3),
  ('insolvency',         'company',      '{company} meldet Insolvenz an',                         'Die laufenden Kosten waren zwei Quartale lang nicht gedeckt. Die Aktie stürzt ab.',                            -1.0, 3),
  ('insider_fine',       'regulator',    'Finanzaufsicht bestraft Insiderhandel bei {company}',   '{player} hat im Sperrfenster gehandelt und muss {fine} Strafe zahlen.',                                        -0.2, 2),
  ('opening_bell',       'market',       'Die Börse ist eröffnet',                                'Handelsstart an der NEXA. In der ersten Stunde gibt es den Eröffnungsbonus.',                                   0.0, 1),
  ('closing_bell',       'market',       'Schlussglocke an der NEXA',                             'Der Haupthandel ist beendet. Nachbörslich sind die Spreads größer.',                                            0.0, 1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 14. Notification types (each can be switched off individually, spec 11.6)
-- ---------------------------------------------------------------------------
insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory, sort_order) values
  ('vault_full',           'income',   'Tresor voll',                 'Dein Tresor ist voll. Weiteres Grundeinkommen verfällt.',           'notif_vault',     true, true,  false,  10),
  ('salary_paid',          'income',   'Gehalt eingegangen',          'Dein Gehalt wurde gutgeschrieben.',                                 'notif_salary',    true, false, false,  20),
  ('order_filled',         'trading',  'Order ausgeführt',            'Eine deiner Orders wurde ausgeführt.',                              'notif_order',     true, false, false,  30),
  ('order_cancelled',      'trading',  'Order beendet',               'Eine Order ist abgelaufen oder wurde abgelehnt.',                   'notif_order',     true, false, false,  40),
  ('margin_warning',       'trading',  'Margin-Warnung',              'Eine Hebelposition nähert sich dem Liquidationspreis.',             'notif_warning',   true, true,  false,  50),
  ('margin_call',          'trading',  'Margin Call',                 'Deine Position steht kurz vor der Liquidation.',                    'notif_alarm',     true, true,  true,   60),
  ('liquidation',          'trading',  'Position liquidiert',         'Eine Position wurde automatisch aufgelöst.',                        'notif_skull',     true, true,  true,   70),
  ('dividend_received',    'trading',  'Dividende erhalten',          'Eine Dividende oder ein Kupon wurde ausgezahlt.',                   'notif_dividend',  true, false, false,  80),
  ('earnings_own_stocks',  'market',   'Quartalszahlen',              'Ein Unternehmen aus deinem Depot hat Zahlen veröffentlicht.',       'notif_report',    true, true,  false,  90),
  ('event_starting',       'market',   'Event startet',               'Ein angekündigtes Event beginnt in Kürze.',                         'notif_clock',     true, true,  false, 100),
  ('watchlist_move',       'market',   'Watchlist-Bewegung',          'Eine Aktie deiner Watchlist bewegt sich stark.',                    'notif_chart',     true, false, false, 110),
  ('job_offer',            'career',   'Jobangebot',                  'Du hast ein Jobangebot erhalten.',                                  'notif_briefcase', true, true,  false, 120),
  ('work_task_available',  'career',   'Neue Arbeitsaufgabe',         'Eine neue Arbeitsaufgabe wartet auf dich.',                         'notif_task',      true, false, false, 130),
  ('promotion',            'career',   'Beförderung',                 'Du wurdest befördert.',                                             'notif_promotion', true, false, false, 140),
  ('level_up',             'progress', 'Level-up',                    'Du hast ein neues Level erreicht.',                                 'notif_level',     true, false, false, 150),
  ('achievement_unlocked', 'progress', 'Erfolg freigeschaltet',       'Du hast einen Erfolg freigeschaltet.',                              'notif_trophy',    true, false, false, 160),
  ('mission_completed',    'progress', 'Mission abgeschlossen',       'Eine Mission ist erfüllt. Hol dir die Belohnung ab.',               'notif_mission',   true, false, false, 170),
  ('streak_at_risk',       'progress', 'Login-Serie in Gefahr',       'Logge dich heute noch ein, um deine Serie zu halten.',              'notif_flame',     true, false, false, 180),
  ('random_event',         'progress', 'Zufallsereignis',             'Dir ist etwas Unerwartetes passiert.',                              'notif_dice',      true, false, false, 190),
  ('company_quarter',      'company',  'Quartalsabschluss',           'Das Quartal deiner Firma wurde abgeschlossen.',                     'notif_company',   true, false, false, 200),
  ('insolvency_warning',   'company',  'Insolvenzgefahr',             'Deine Firma konnte die laufenden Kosten nicht decken.',             'notif_alarm',     true, true,  true,  210),
  ('angel_offer',          'company',  'Business-Angel-Angebot',      'Es gibt ein neues Beteiligungsangebot.',                            'notif_angel',     true, false, false, 220),
  ('ipo_update',           'company',  'Börsengang',                  'Neuigkeiten zu einem Börsengang, an dem du beteiligt bist.',        'notif_bell',      true, false, false, 230),
  ('takeover_offer',       'company',  'Übernahmeangebot',            'Für deine Firma liegt ein Übernahmeangebot vor.',                   'notif_takeover',  true, false, false, 240),
  ('shareholder_vote',     'company',  'Hauptversammlung',            'Eine Abstimmung, bei der du stimmberechtigt bist, wurde eröffnet.', 'notif_vote',      true, false, false, 250),
  ('regulator_fine',       'company',  'Strafe der Finanzaufsicht',   'Die Finanzaufsicht hat eine Strafe gegen dich verhängt.',           'notif_gavel',     true, false, true,  260),
  ('friend_request',       'social',   'Freundschaftsanfrage',        'Jemand möchte mit dir befreundet sein.',                            'notif_friend',    true, false, false, 270),
  ('friend_activity',      'social',   'Aktivität von Freunden',      'Ein Freund hat etwas Bemerkenswertes geschafft.',                   'notif_feed',      true, false, false, 280),
  ('league_result',        'social',   'Liga-Ergebnis',               'Die Wochenliga ist ausgewertet.',                                   'notif_trophy',    true, false, false, 290),
  ('system',               'system',   'Systemmeldung',               'Wichtige Hinweise zum Spielbetrieb.',                               'notif_info',      true, false, true,  300)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 15. Employee traits, work task types
-- ---------------------------------------------------------------------------
insert into public.employee_traits (key, name, description, effects) values
  ('ambitious',     'Ehrgeizig',       '+15 % Leistung, kündigt bei Gehaltsstopp schneller.',                  '{"productivity": 1.15, "raiseExpectation": 1.5}'),
  ('loyal',         'Loyal',           'Bleibt auch in schlechten Zeiten. Lässt sich kaum abwerben.',          '{"loyaltyDecay": 0.5, "poachResistance": 1.5}'),
  ('creative',      'Kreativ',         'Bringt die Produktqualität schneller voran.',                          '{"qualityGain": 1.2}'),
  ('frugal',        'Genügsam',        'Gibt sich mit weniger Gehalt zufrieden.',                              '{"salaryExpectation": 0.9}'),
  ('mentor',        'Mentor',          'Verkürzt die Einarbeitungszeit neuer Kollegen der Abteilung.',         '{"onboardingSpeed": 1.5}'),
  ('perfectionist', 'Perfektionist',   'Höhere Qualität, aber langsamere Ergebnisse.',                         '{"qualityGain": 1.25, "productivity": 0.9}'),
  ('networker',     'Netzwerker',      'Steigert die Bekanntheit, wechselt aber gern den Arbeitgeber.',        '{"awarenessGain": 1.15, "loyaltyDecay": 1.3}'),
  ('steady',        'Zuverlässig',     'Keine Überraschungen: konstante Leistung, selten krank.',              '{"productivityVariance": 0.5}')
on conflict (key) do nothing;

insert into public.work_task_definitions (key, task_kind, title, description, icon_key, min_tier, duration_seconds, xp_min, xp_max, bonus_bps_of_hourly, config) values
  ('estimate_earnings', 'analyst_estimate', 'Quartalszahlen schätzen',  'Schätze den Umsatz eines Unternehmens im laufenden Quartal.',       'task_estimate', 'junior',    45, 50, 150, 7500, '{"toleranceBps": [500, 1500, 3000]}'),
  ('pick_customer',     'sales_pick',       'Besten Kunden wählen',     'Wähle aus drei Kundenprofilen das vielversprechendste aus.',        'task_customer', 'intern',    30, 50, 150, 5000, '{"options": 3}'),
  ('compare_loans',     'finance_choice',   'Kreditangebote vergleichen','Entscheide dich zwischen zwei Kreditangeboten für das günstigere.', 'task_loan',     'junior',    40, 50, 150, 6000, '{"options": 2}'),
  ('sort_inbox',        'generic',          'Posteingang sortieren',    'Ordne eingehende Vorgänge der richtigen Abteilung zu.',             'task_inbox',    'intern',    20, 50, 120, 4000, '{"items": 5}'),
  ('plan_campaign',     'sales_pick',       'Kampagne auswählen',       'Wähle die Marketingkampagne mit dem besten Verhältnis aus Kosten und Reichweite.', 'task_campaign', 'team_lead', 50, 80, 150, 8000, '{"options": 3}'),
  ('liquidity_check',   'finance_choice',   'Liquidität prüfen',        'Entscheide, ob die Firma einen Kredit aufnehmen oder Rücklagen nutzen sollte.',    'task_liquidity','c_level',   60, 80, 150, 10000, '{"options": 2}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 16. Job board of the AI companies (spec 8.2): 5 tiers, salary per hour
-- ---------------------------------------------------------------------------
insert into public.job_definitions (key, company_id, tier, title, description, specialty, task_kind, min_level, salary_cents_per_hour, grants_options, has_decisions)
select j.key, c.id, j.tier::public.job_tier, j.title, j.description, j.specialty::public.employee_specialty,
       j.task_kind::public.work_task_kind, j.min_level, j.salary, false, j.has_decisions
from (values
  -- intern (level 2, ~150 EUR/h)
  ('brz_intern_assistant',   'BRZ', 'intern',    'Assistenz im Filialbüro',        'Du unterstützt die Filialleitung bei Brotzeit Handel.',                      'sales',       'generic',           2,  15000, false),
  ('fgd_intern_stock',       'FGD', 'intern',    'Aushilfe im Lager',              'Du sortierst Restposten bei Fundgrube Discount.',                            'production',  'generic',           2,  14000, false),
  ('ebx_intern_sorting',     'EBX', 'intern',    'Praktikum Paketzentrum',         'Du hilfst im Paketzentrum von Eilbote Express.',                             'production',  'generic',           2,  14500, false),
  ('pxw_intern_qa',          'PXW', 'intern',    'Praktikum Spieletest',           'Du testest neue Spiele bei Pixelwerk Studios und meldest Fehler.',           'development', 'generic',           2,  15500, false),
  -- junior (level 5, ~300 EUR/h)
  ('vlt_junior_analyst',     'VLT', 'junior',    'Junior-Analyst',                 'Du wertest Marktdaten für Volta Energie aus und schätzt Quartalszahlen.',    'finance',     'analyst_estimate',  5,  30000, false),
  ('kfr_junior_buyer',       'KFR', 'junior',    'Junior-Einkäufer',               'Du wählst Sortimente für Kaufrausch Märkte aus.',                            'sales',       'sales_pick',        5,  29000, false),
  ('alm_junior_lab',         'ALM', 'junior',    'Junior-Laborassistenz',          'Du dokumentierst Versuchsreihen bei Alpenmed.',                              'development', 'generic',           5,  30500, false),
  ('ndl_junior_dispatcher',  'NDL', 'junior',    'Junior-Disponent',               'Du planst Touren für Nordlicht Logistik.',                                   'production',  'finance_choice',    5,  29500, false),
  -- senior (level 12, ~700 EUR/h)
  ('nph_senior_sales',       'NPH', 'senior',    'Senior Sales',                   'Du betreust die Großkunden von NeuroPharm.',                                 'sales',       'sales_pick',       12,  70000, false),
  ('kls_senior_developer',   'KLS', 'senior',    'Senior-Entwickler',              'Du entwickelst die Cloud-Plattform von KlarSoft weiter.',                    'development', 'analyst_estimate', 12,  72000, false),
  ('rkw_senior_controller',  'RKW', 'senior',    'Senior-Controller',              'Du prüfst Budgets und Finanzierungen bei Rheinkraft Werke.',                 'finance',     'finance_choice',   12,  68000, false),
  ('brz_senior_category',    'BRZ', 'senior',    'Senior Category Manager',        'Du steuerst Preise und Aktionen ganzer Warengruppen bei Brotzeit Handel.',   'marketing',   'sales_pick',       12,  69000, false),
  -- team lead (level 20, ~1300 EUR/h)
  ('ndl_lead_sales',         'NDL', 'team_lead', 'Leitung Vertrieb',               'Du führst das Vertriebsteam von Nordlicht Logistik.',                        'sales',       'sales_pick',       20, 130000, false),
  ('kls_lead_product',       'KLS', 'team_lead', 'Leitung Produktentwicklung',     'Du verantwortest die Produktplanung bei KlarSoft.',                          'development', 'analyst_estimate', 20, 135000, false),
  ('vlt_lead_treasury',      'VLT', 'team_lead', 'Leitung Treasury',               'Du steuerst die Finanzmittel von Volta Energie.',                            'finance',     'finance_choice',   20, 128000, false),
  -- c-level at the large AI companies (level 25, ~2500 EUR/h, real decisions)
  ('nph_cfo',                'NPH', 'c_level',   'CFO',                            'Als Finanzvorstand von NeuroPharm verwaltest du Liquidität und Kredite.',    'finance',     'finance_choice',   25, 250000, true),
  ('kls_cfo',                'KLS', 'c_level',   'CFO',                            'Als Finanzvorstand von KlarSoft verantwortest du Bilanz und Prognosen.',     'finance',     'finance_choice',   25, 255000, true),
  ('vlt_cfo',                'VLT', 'c_level',   'CFO',                            'Als Finanzvorstand von Volta Energie sicherst du die Finanzierung der Kraftwerke.', 'finance', 'finance_choice', 25, 250000, true),
  ('brz_coo',                'BRZ', 'c_level',   'COO',                            'Als operativer Vorstand von Brotzeit Handel führst du das Tagesgeschäft.',   'production',  'sales_pick',       25, 245000, true)
) as j(key, ticker, tier, title, description, specialty, task_kind, min_level, salary, has_decisions)
join public.companies c on c.ticker = j.ticker and c.is_ai
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 17. Invite codes for the closed alpha (ADR-010). Replace before going live.
-- ---------------------------------------------------------------------------
insert into public.invite_codes (code, max_uses, note) values
  ('NEXA-FREUNDE-2026', 8, 'Closed alpha: the four friends plus spare seats'),
  ('NEXA-ADMIN-7Q4X',   2, 'Owner/admin accounts')
on conflict (code) do nothing;
