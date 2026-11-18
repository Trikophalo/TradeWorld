-- ===== idempotent copy of migrations/20261204011200_player_stock_valuation.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 011200 · Player stocks valued from expected profit, not from piled-up cash (ADR-217)
-- =============================================================================
-- The owner (after ADR-214 and ADR-216 were live): "Alle Spieler-Aktien steigen immer noch ununterbrochen."
--
-- Root cause: the fair value of a listed player company was its company value (company_value_cents, ADR-067/167):
-- cash − open bills + 4 × last quarter's profit × sector P/E × 0,5, written at every quarter close
-- (player_company_close_quarter) and scaled by the reputation factor. A player company keeps its profit as cash
-- (no dividends; ADR-216 even punishes founder withdrawals), so every quarter (6 hours) the cash and with it the
-- fair value rose by one quarter's profit, ≈ 3 % of the value: about +13 % a day and +60 to +140 % a week, also for
-- a company whose profit did not grow at all. The value fund pulls the price to that line within the hour; confidence,
-- herd and incidents only wobbled around a line that only went up.
--
-- Now (formulas = src/lib/sim/player-valuation.ts, values = game_config.playerValuation):
--   value = counted cash + expected yearly profit × sector P/E × peDiscount × multiple
--   * expected yearly profit = operating profit of the last 24 hours (one game year; scaled up from at least 6 hours)
--   * multiple = growth × mood × sector cycle in [0,45; 2]: growth expectation priced in at once
--     (e^clamp(0,8 × ln(profit per hour of the last 24 h / the 24 h before), ±0,4)), market mood
--     (e^(0,01 × (mood − 50))), sector P/E cycles (e^(0,25 × sin(2π (h / period + phase))), 83 to 149 hours)
--   * counted cash = min(cash, reserve) + 3 % of the cash above it, reserve = max(anchor, 0,5 × yearly profit);
--     anchor = free cash when the stock is first valued this way (or listed) plus capital increases, never above the
--     cash. At least 20 % of the free cash.
--   fair value per share = value / shares × reputation factor (ADR-167) × shock.
-- player_stock_valuation_run() (cron nexa-player-valuation, every minute) writes it. Changes from outside the model
-- (crisis shocks ADR-091, market events, the old formula at the quarter close is ignored) are kept as a shock factor
-- that fades with a 3-hour half-life; the first run starts with the old fair value as shock, so nothing jumps.
-- Nothing else is rewritten: the quarter close keeps its line, the reputation step keeps scaling (both are accounted).
-- Idempotent: runs unchanged as supabase/updates/20261204011200_player_stock_valuation.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
create table if not exists public.player_stock_valuation (
  security_id     uuid primary key references public.securities (id) on delete cascade,
  company_id      uuid not null references public.companies (id) on delete cascade,
  anchor_cents    bigint not null default 0 check (anchor_cents >= 0),
  last_cash_cents bigint not null default 0,
  shares          bigint not null default 0,
  shock           double precision not null default 1 check (shock > 0),
  written_e4      bigint,
  price_factor    double precision not null default 1 check (price_factor > 0),
  quarter_id      bigint,
  parts           jsonb not null default '{}'::jsonb check (jsonb_typeof(parts) = 'object'),
  run_at          timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists player_stock_valuation_company_idx on public.player_stock_valuation (company_id);
alter table public.player_stock_valuation enable row level security;
drop trigger if exists set_updated_at on public.player_stock_valuation;
create trigger set_updated_at before update on public.player_stock_valuation
  for each row execute function public.set_updated_at();
comment on table public.player_stock_valuation is
  'Valuation of a listed player stock (ADR-217): cash anchor, shock factor from outside the model, the last written '
  'fair value and its parts (profit, multiple, counted cash). Internal; written by player_stock_valuation_run().';

-- ---------------------------------------------------------------------------
-- B. Formulas (src/lib/sim/player-valuation.ts)
-- ---------------------------------------------------------------------------

-- playerCompanyValue: {value_cents, yearly_profit_cents, counted_cash_cents, growth, mood, cycle, multiple}
create or replace function public.player_valuation_value(
  p_recent double precision, p_hours double precision, p_prior double precision, p_prior_hours double precision,
  p_cash double precision, p_anchor double precision, p_sector text, p_pe double precision, p_discount double precision,
  p_mood double precision, p_epoch_hours double precision, p_cfg jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ph      double precision := public.cfg_num(p_cfg, '{profitHours}', 24);
  v_minh    double precision := public.cfg_num(p_cfg, '{minProfitHours}', 6);
  v_yearly  double precision;
  v_rec     double precision;
  v_pri     double precision;
  v_g       double precision;
  v_max     double precision := public.cfg_num(p_cfg, '{growth,maxLog}', 0.4);
  v_growth  double precision;
  v_mood    double precision;
  v_period  double precision;
  v_phase   double precision;
  v_cycle   double precision;
  v_mult    double precision;
  v_reserve double precision;
  v_cash    double precision;
  v_value   double precision;
begin
  v_yearly := case when coalesce(p_hours, 0) <= 0 then 0
                   else greatest(0, p_recent * v_ph / greatest(p_hours, v_minh)) end;
  -- growth expectation from the average hourly profit
  if p_prior is null or coalesce(p_hours, 0) <= 0 then
    v_g := 0;
  else
    v_rec := p_recent / greatest(1, p_hours);
    v_pri := p_prior / greatest(1, p_prior_hours);
    v_g := case when v_rec > 0 and v_pri > 0 then ln(v_rec / v_pri)
                when v_rec > v_pri then 10 when v_rec < v_pri then -10 else 0 end;
  end if;
  v_growth := exp(greatest(-v_max, least(v_max, public.cfg_num(p_cfg, '{growth,perLogGrowth}', 0.8) * v_g)));
  v_mood := exp(public.cfg_num(p_cfg, '{mood,perPoint}', 0.01) * (least(100, greatest(0, coalesce(p_mood, 50))) - 50));
  v_period := public.cfg_num(p_cfg, array['sectorCycle', 'sectors', coalesce(p_sector, ''), 'periodHours'],
                             public.cfg_num(p_cfg, '{sectorCycle,fallback,periodHours}', 113));
  v_phase := public.cfg_num(p_cfg, array['sectorCycle', 'sectors', coalesce(p_sector, ''), 'phase'],
                            public.cfg_num(p_cfg, '{sectorCycle,fallback,phase}', 0.45));
  v_cycle := exp(public.cfg_num(p_cfg, '{sectorCycle,amplitude}', 0.25)
                 * sin(2 * pi() * (p_epoch_hours / greatest(1, v_period) + v_phase)));
  v_mult := greatest(public.cfg_num(p_cfg, '{minMultiple}', 0.45),
                     least(public.cfg_num(p_cfg, '{maxMultiple}', 2), v_growth * v_mood * v_cycle));
  -- counted cash: 1x up to the reserve, a little above it
  if p_cash <= 0 then
    v_cash := p_cash;
  else
    v_reserve := greatest(coalesce(p_anchor, 0), public.cfg_num(p_cfg, '{reserveYears}', 0.5) * v_yearly);
    v_cash := least(p_cash, v_reserve) + public.cfg_num(p_cfg, '{excessCashWeight}', 0.03) * greatest(0, p_cash - v_reserve);
  end if;
  v_value := greatest(0, public.cfg_num(p_cfg, '{liquidationWeight}', 0.2) * p_cash,
                      v_cash + v_yearly * p_pe * p_discount * v_mult);
  return jsonb_build_object('value_cents', v_value, 'yearly_profit_cents', v_yearly, 'counted_cash_cents', v_cash,
                            'growth', v_growth, 'mood', v_mood, 'cycle', v_cycle, 'multiple', v_mult);
end;
$$;

-- fadeShock: ln(factor) halves every shockHalfLifeHours
create or replace function public.player_valuation_fade(p_factor double precision, p_minutes double precision, p_cfg jsonb)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_factor, 0) <= 0 then 1::double precision
              else exp(ln(p_factor) * power(0.5, greatest(0, p_minutes) / 60.0
                                                 / greatest(0.01, public.cfg_num(p_cfg, '{shockHalfLifeHours}', 3)))) end;
$$;

-- nextAnchor: never above the free cash, plus what a capital increase brought in
create or replace function public.player_valuation_anchor(p_anchor bigint, p_cash bigint, p_last_cash bigint, p_shares_grew boolean)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select greatest(0, least(coalesce(p_anchor, 0) + case when p_shares_grew then greatest(0, p_cash - coalesce(p_last_cash, p_cash)) else 0 end,
                           greatest(0, p_cash)))::bigint;
$$;

-- ---------------------------------------------------------------------------
-- C. The minute job
-- ---------------------------------------------------------------------------
create or replace function public.player_stock_valuation_run(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := coalesce(public.config_jsonb('playerValuation'), '{}'::jsonb);
  v_now    timestamptz := coalesce(p_now, public.game_now());
  v_ph     double precision := public.cfg_num(coalesce(public.config_jsonb('playerValuation'), '{}'::jsonb), '{profitHours}', 24);
  v_disc   double precision := public.config_double('startups', '{valuationPeDiscount}', 0.5);
  v_mood   double precision;
  v_epoch  double precision := extract(epoch from coalesce(p_now, public.game_now())) / 3600.0;
  v_val    jsonb;
  v_anchor bigint;
  v_shock  double precision;
  v_x      double precision;
  v_min    double precision;
  v_fair   bigint;
  v_model  double precision;
  v_n      integer := 0;
  r        record;
begin
  -- never beside a running tick (same lock as the tick and the confidence job)
  perform pg_advisory_xact_lock(7311001);
  select m.mood into v_mood from public.market_mood m where m.id;
  for r in
    select s.id as security_id, c.id as company_id, s.sector_key, c.shares_outstanding,
           pc.last_closed_quarter_id,
           greatest(0, coalesce((select a.balance_cents from public.ledger_accounts a
                                  where a.owner_company_id = c.id and a.kind = 'company_cash'), 0)) - pc.unpaid_cents as cash,
           st.fair_value_e4 as fair,
           public.listed_price_factor(c.id) as pf,
           (select sum(h.profit_cents) from public.player_company_hours h
             where h.company_id = c.id and h.hour_start >= v_now - make_interval(secs => v_ph * 3600)) as recent,
           (select count(*) from public.player_company_hours h
             where h.company_id = c.id and h.hour_start >= v_now - make_interval(secs => v_ph * 3600)) as recent_n,
           (select sum(h.profit_cents) from public.player_company_hours h
             where h.company_id = c.id and h.hour_start >= v_now - make_interval(secs => 2 * v_ph * 3600)
               and h.hour_start < v_now - make_interval(secs => v_ph * 3600)) as prior,
           (select count(*) from public.player_company_hours h
             where h.company_id = c.id and h.hour_start >= v_now - make_interval(secs => 2 * v_ph * 3600)
               and h.hour_start < v_now - make_interval(secs => v_ph * 3600)) as prior_n,
           v.security_id is not null as known, v.anchor_cents, v.last_cash_cents, v.shares, v.shock, v.written_e4,
           v.price_factor as v_pf, v.quarter_id, v.run_at
      from public.companies c
      join public.player_companies pc on pc.company_id = c.id
      join public.securities s on s.id = c.security_id and s.kind = 'stock' and s.status = 'listed'
      join public.security_sim_state st on st.security_id = s.id
      left join public.player_stock_valuation v on v.security_id = s.id
     where not c.is_ai and c.phase = 'listed' and coalesce(c.shares_outstanding, 0) > 0
  loop
    v_val := public.player_valuation_value(
      coalesce(r.recent, 0)::double precision, r.recent_n::double precision,
      -- the prior game year counts once most of its hours exist
      case when r.prior_n >= 0.75 * v_ph then r.prior::double precision end, r.prior_n::double precision,
      r.cash::double precision,
      (case when r.known then public.player_valuation_anchor(r.anchor_cents, r.cash, r.last_cash_cents,
                                                              r.shares_outstanding > coalesce(r.shares, r.shares_outstanding))
            else greatest(0, r.cash) end)::double precision,
      r.sector_key, public.config_double('sectors', array[coalesce(r.sector_key, ''), 'peRatio'], 15), v_disc,
      coalesce(v_mood, 50), v_epoch, v_cfg);
    v_anchor := case when r.known then public.player_valuation_anchor(r.anchor_cents, r.cash, r.last_cash_cents,
                                                                       r.shares_outstanding > coalesce(r.shares, r.shares_outstanding))
                     else greatest(0, r.cash) end;
    v_model := (v_val ->> 'value_cents')::double precision * 100 / r.shares_outstanding * coalesce(r.pf, 1);
    if not r.known or r.written_e4 is null then
      -- first run: start from the fair value as it is and let the difference fade
      v_shock := greatest(0.2, least(5, coalesce(r.fair, 0)::double precision / greatest(1, v_model)));
      v_min := 0;
    else
      v_min := least(60, greatest(0, extract(epoch from (v_now - coalesce(r.run_at, v_now))) / 60.0));
      -- a change from outside since the last run (crisis shock, market event), not the reputation step and not the
      -- old formula at a quarter close
      if r.last_closed_quarter_id is distinct from r.quarter_id then
        v_x := 1;
      else
        v_x := r.fair::double precision * r.v_pf / greatest(1, r.written_e4::double precision * coalesce(r.pf, 1));
      end if;
      v_shock := greatest(0.05, least(20, coalesce(r.shock, 1) * v_x));
    end if;
    v_shock := public.player_valuation_fade(v_shock, v_min, v_cfg);
    v_fair := greatest(1, round(v_model * v_shock))::bigint;
    update public.security_sim_state set fair_value_e4 = v_fair where security_id = r.security_id;
    insert into public.player_stock_valuation as t (security_id, company_id, anchor_cents, last_cash_cents, shares, shock,
                                                    written_e4, price_factor, quarter_id, parts, run_at)
    values (r.security_id, r.company_id, v_anchor, r.cash, r.shares_outstanding, v_shock, v_fair, coalesce(r.pf, 1),
            r.last_closed_quarter_id, v_val || jsonb_build_object('shock', v_shock, 'cash_cents', r.cash), v_now)
    on conflict (security_id) do update
       set company_id = excluded.company_id, anchor_cents = excluded.anchor_cents, last_cash_cents = excluded.last_cash_cents,
           shares = excluded.shares, shock = excluded.shock, written_e4 = excluded.written_e4,
           price_factor = excluded.price_factor, quarter_id = excluded.quarter_id, parts = excluded.parts,
           run_at = excluded.run_at;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('stocks', v_n);
end;
$$;
comment on function public.player_stock_valuation_run(timestamptz) is
  'Internal, cron every minute (ADR-217): fair value of every listed player stock from expected profit × multiple '
  '(growth, market mood, sector cycle), counted cash and a fading shock factor.';

-- ---------------------------------------------------------------------------
-- D. Grants and the cron job
-- ---------------------------------------------------------------------------
do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.player_valuation_value(double precision, double precision, double precision, double precision, double precision, double precision, text, double precision, double precision, double precision, double precision, jsonb)',
    'public.player_valuation_fade(double precision, double precision, jsonb)',
    'public.player_valuation_anchor(bigint, bigint, bigint, boolean)',
    'public.player_stock_valuation_run(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  grant execute on function public.player_stock_valuation_run(timestamptz) to service_role;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-player-valuation';
    perform cron.schedule('nexa-player-valuation', '* * * * *', 'select public.player_stock_valuation_run()');
  end if;
end;
$do$;
