-- ===== idempotent copy of migrations/20261204000900_fix_new_ai_fundamentals.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0900 · The ten new AI companies get earnings that fit their prices (fix for ADR-130)
-- =============================================================================
-- Several of the ten companies of ADR-130 started far above the value their earnings justify (fair value = EPS x
-- sector P/E): Knusperkönig at 0,74 € with a fair value of about 0,31 €, Memeland 0,51 € vs. 0,19 €, Nordbrise and
-- Orbitfracht about 40 % too high. The simulation pulls prices to the fair value, so these stocks kept falling and
-- traders lost money. Their costs are set so that the start price matches the sector P/E; the fair value of all ten
-- goes back to the start price. The add function (seed of a fresh database) gets the same numbers.
-- Idempotent: runs unchanged as supabase/updates/20261204000900_fix_new_ai_fundamentals.sql.

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
      ('HLX', 'Helix Robotik', 'helix-robotik', 'tech', 'midcap', 'Baut Haushaltsroboter, die putzen, kochen und den Müll rausbringen. Manchmal auch den Hund.', '#3DDC97', 18000000, 214000, 55000000, 51560714, 1.1, 0.95, 1.05, 'none', 0, 1600),
      ('MEM', 'Memeland Media', 'memeland-media', 'tech', 'penny', 'Kurzvideo-App für Memes. Kaum Gewinn, riesige Fangemeinde, und die Aktie macht, was das Internet will.', '#FF4FD8', 90000000, 5100, 3000000, 2590179, 0.75, 0.85, 1.1, 'none', 0, 60),
      ('LUX', 'Glanz & Gloria', 'glanz-und-gloria', 'retail', 'bluechip', 'Luxuskonzern für Uhren, Schmuck und Handtaschen. Verkauft Status, auch wenn die Wirtschaft schwächelt.', '#D4AF37', 40000000, 960000, 520000000, 451428571, 1.35, 1.45, 1.2, 'stable', 4000, 9000),
      ('SNK', 'Knusperkönig', 'knusperkoenig', 'retail', 'penny', 'Chips-Marke mit verrückten Sorten wie Gurke-Vanille. Jeder neue Geschmack ist ein Hit oder ein Desaster.', '#FF9F1C', 55000000, 7400, 12000000, 11273214, 0.95, 0.8, 0.95, 'none', 0, 340),
      ('WND', 'Nordbrise Offshore', 'nordbrise-offshore', 'energy', 'midcap', 'Betreibt Windparks in der Nordsee. Verdient prächtig bei Sturm und leidet bei Flaute.', '#6EC1E4', 25000000, 272000, 95000000, 79545455, 1.1, 0.9, 1.0, 'stable', 3000, 1900),
      ('FSN', 'Sonnenkern Fusion', 'sonnenkern-fusion', 'energy', 'penny', 'Will die Kernfusion in einen Container bauen. Noch kein Strom, aber jede Menge Hoffnung.', '#FF5E5B', 70000000, 3600, 200000, 1800000, 0.85, 0.55, 1.3, 'none', 0, 75),
      ('MTH', 'Methusalem Bio', 'methusalem-bio', 'pharma', 'penny', 'Forscht an Pillen gegen das Altern. Die Mäuse im Labor werden immer älter, die Aktionäre nervöser.', '#B388EB', 65000000, 5800, 1500000, 2200000, 0.9, 0.6, 1.2, 'none', 0, 110),
      ('PFW', 'Pfotenwohl', 'pfotenwohl', 'pharma', 'midcap', 'Medikamente und Futter für Haustiere. Wer Hund und Katze liebt, spart nicht beim Tierarzt.', '#8BC34A', 16000000, 315000, 64000000, 58272727, 1.15, 1.0, 1.0, 'growth', 2000, 2300),
      ('DRN', 'Luftpost Drohnen', 'luftpost-drohnen', 'logistics', 'penny', 'Liefert Pakete per Drohne in 20 Minuten. Wenn kein Wind weht und keine Möwe angreift.', '#00B4D8', 50000000, 6900, 7000000, 7200000, 0.9, 0.7, 0.95, 'none', 0, 180),
      ('OFR', 'Orbitfracht', 'orbitfracht', 'logistics', 'midcap', 'Bringt Satelliten und Fracht ins All. Jeder Start ist ein Ereignis, jeder Fehlstart auch.', '#5C6BC0', 22000000, 188000, 70000000, 63106667, 1.05, 0.85, 1.05, 'none', 0, 1400)
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


update public.company_state cs set baseline_costs_cents = 5156071400, fixed_costs_cents = 1289017850
  from public.companies c where c.id = cs.company_id and c.ticker = 'HLX' and c.is_ai;
update public.companies set ttm_net_income_cents = 1375714400, eps_ttm_e4 = 7643
 where ticker = 'HLX' and is_ai;
update public.company_state cs set baseline_costs_cents = 259017900, fixed_costs_cents = 64754475
  from public.companies c where c.id = cs.company_id and c.ticker = 'MEM' and c.is_ai;
update public.companies set ttm_net_income_cents = 163928400, eps_ttm_e4 = 182
 where ticker = 'MEM' and is_ai;
update public.company_state cs set baseline_costs_cents = 45142857100, fixed_costs_cents = 11285714275
  from public.companies c where c.id = cs.company_id and c.ticker = 'LUX' and c.is_ai;
update public.companies set ttm_net_income_cents = 27428571600, eps_ttm_e4 = 68571
 where ticker = 'LUX' and is_ai;
update public.company_state cs set baseline_costs_cents = 1127321400, fixed_costs_cents = 281830350
  from public.companies c where c.id = cs.company_id and c.ticker = 'SNK' and c.is_ai;
update public.companies set ttm_net_income_cents = 290714400, eps_ttm_e4 = 529
 where ticker = 'SNK' and is_ai;
update public.company_state cs set baseline_costs_cents = 7954545500, fixed_costs_cents = 1988636375
  from public.companies c where c.id = cs.company_id and c.ticker = 'WND' and c.is_ai;
update public.companies set ttm_net_income_cents = 6181818000, eps_ttm_e4 = 24727
 where ticker = 'WND' and is_ai;
update public.company_state cs set baseline_costs_cents = 5827272700, fixed_costs_cents = 1456818175
  from public.companies c where c.id = cs.company_id and c.ticker = 'PFW' and c.is_ai;
update public.companies set ttm_net_income_cents = 2290909200, eps_ttm_e4 = 14318
 where ticker = 'PFW' and is_ai;
update public.company_state cs set baseline_costs_cents = 6310666700, fixed_costs_cents = 1577666675
  from public.companies c where c.id = cs.company_id and c.ticker = 'OFR' and c.is_ai;
update public.companies set ttm_net_income_cents = 2757333200, eps_ttm_e4 = 12533
 where ticker = 'OFR' and is_ai;

update public.security_sim_state ss set fair_value_e4 = 214000
  from public.companies c where c.security_id = ss.security_id and c.ticker = 'HLX' and c.is_ai;
update public.security_sim_state ss set fair_value_e4 = 5100
  from public.companies c where c.security_id = ss.security_id and c.ticker = 'MEM' and c.is_ai;
update public.security_sim_state ss set fair_value_e4 = 960000
  from public.companies c where c.security_id = ss.security_id and c.ticker = 'LUX' and c.is_ai;
update public.security_sim_state ss set fair_value_e4 = 7400
  from public.companies c where c.security_id = ss.security_id and c.ticker = 'SNK' and c.is_ai;
update public.security_sim_state ss set fair_value_e4 = 272000
  from public.companies c where c.security_id = ss.security_id and c.ticker = 'WND' and c.is_ai;
update public.security_sim_state ss set fair_value_e4 = 3600
  from public.companies c where c.security_id = ss.security_id and c.ticker = 'FSN' and c.is_ai;
update public.security_sim_state ss set fair_value_e4 = 5800
  from public.companies c where c.security_id = ss.security_id and c.ticker = 'MTH' and c.is_ai;
update public.security_sim_state ss set fair_value_e4 = 315000
  from public.companies c where c.security_id = ss.security_id and c.ticker = 'PFW' and c.is_ai;
update public.security_sim_state ss set fair_value_e4 = 6900
  from public.companies c where c.security_id = ss.security_id and c.ticker = 'DRN' and c.is_ai;
update public.security_sim_state ss set fair_value_e4 = 188000
  from public.companies c where c.security_id = ss.security_id and c.ticker = 'OFR' and c.is_ai;
