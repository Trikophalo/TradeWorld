-- ===== idempotent copy of migrations/20261204011100_investor_confidence.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 011100 · Investor confidence and market mood (ADR-216)
-- =============================================================================
-- The owner: "Derzeit steigen Aktien nur. Es soll realistischer sein. Die KI-Anleger müssen richtigen Einfluss haben.
-- Deren Vertrauen ist das Wichtigste."
--
-- 1. security_sim_state.confidence (0..100, 50 = neutral): the investor confidence the tick trades on
--    (market_tick_at in 011110: confidence investors buy while it is high, sell while it is low, panic below 15).
-- 2. stock_confidence: per stock the fading event bumps (earnings, news, market forces, crises, scandals, dividends,
--    founder withdrawals and sells, capital increases), the last full set of factors (shown as reasons), the
--    chatter random walk and an hourly history. market_mood: the market-wide mood with bull, calm and bear phases
--    and a sector rotation.
-- 3. Bumps come from small triggers (hooks), no function is patched: stock_tips (news and market forces that came
--    true), player_company_events (crises, scandals, external events, their outcome), company_dividends,
--    player_companies.last_withdraw_at (founder withdrawal), trades (founder sells own shares), companies
--    .shares_outstanding (capital increase). AI earnings: simulate_ai_companies (full copy in 011120).
-- 4. investor_confidence_run(): every minute (cron nexa-investor-confidence) the mood moves, phases and the sector
--    rotation change (with a news item), player companies' quarter results become earnings bumps, every listed stock
--    gets its state factors (profit trend, reputation, crisis, country risk, management, volatility, mood, sector,
--    momentum, valuation, chatter), its confidence moves towards 50 + Σ factors, big swings become news.
-- 5. RPCs get_stock_confidence(p_ticker) and get_market_mood() for the stock page, market overview and company.
--
-- Formulas = src/lib/sim/investor-confidence.ts, values = game_config.investorConfidence
-- (src/config/investor-confidence.ts). Idempotent: runs unchanged as supabase/updates/20261204011100_investor_confidence.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.security_sim_state add column if not exists confidence double precision not null default 50;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'security_sim_state_confidence_check'
                    and conrelid = 'public.security_sim_state'::regclass) then
    alter table public.security_sim_state add constraint security_sim_state_confidence_check
      check (confidence between 0 and 100);
  end if;
end;
$$;
comment on column public.security_sim_state.confidence is
  'Investor confidence 0..100 (ADR-216); market_tick_at turns it into AI order flow. Set by investor_confidence_run().';

create table if not exists public.stock_confidence (
  security_id  uuid primary key references public.securities (id) on delete cascade,
  confidence   double precision not null default 50 check (confidence between 0 and 100),
  target       double precision not null default 50 check (target between 0 and 100),
  events       jsonb not null default '{}'::jsonb check (jsonb_typeof(events) = 'object'),
  factors      jsonb not null default '{}'::jsonb check (jsonb_typeof(factors) = 'object'),
  chatter      double precision not null default 0,
  history      jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  history_hour timestamptz,
  news_at      timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.stock_confidence enable row level security;
drop trigger if exists set_updated_at on public.stock_confidence;
create trigger set_updated_at before update on public.stock_confidence for each row execute function public.set_updated_at();
comment on table public.stock_confidence is
  'Investor confidence of a stock (ADR-216): fading event bumps (events), all factors of the last run (factors, points), '
  'chatter, hourly history (newest last). Internal; read through get_stock_confidence().';

create table if not exists public.market_mood (
  id               boolean primary key default true check (id),
  mood             double precision not null default 50 check (mood between 0 and 100),
  phase            text not null default 'calm' check (phase in ('bull', 'calm', 'bear')),
  phase_started_at timestamptz not null default now(),
  phase_ends_at    timestamptz not null default now() + interval '20 hours',
  sector_tilts     jsonb not null default '{}'::jsonb check (jsonb_typeof(sector_tilts) = 'object'),
  rotation_at      timestamptz not null default now() + interval '12 hours',
  history          jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  history_hour     timestamptz,
  last_run_at      timestamptz,
  last_quarter_id  bigint,
  updated_at       timestamptz not null default now()
);
alter table public.market_mood enable row level security;
drop trigger if exists set_updated_at on public.market_mood;
create trigger set_updated_at before update on public.market_mood for each row execute function public.set_updated_at();
comment on table public.market_mood is
  'Market mood (Marktstimmung, ADR-216): one row; phase bull/calm/bear with its end, sector tilts of the rotation, '
  'hourly history. Internal; read through get_market_mood().';
insert into public.market_mood (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- B. Formulas (src/lib/sim/investor-confidence.ts)
-- ---------------------------------------------------------------------------

-- confidenceSignal: gain x (C - 50) / 50, panic below panicBelow, euphoria above 100 - panicBelow, in [-1, 1]
create or replace function public.investor_confidence_signal(p_conf double precision, p_flow jsonb)
returns double precision
language plpgsql
immutable
set search_path = ''
as $$
declare
  c      double precision := least(100, greatest(0, coalesce(p_conf, 50)));
  v_pb   double precision := greatest(0.001, public.cfg_num(p_flow, '{panicBelow}', 15));
  v_pg   double precision := public.cfg_num(p_flow, '{panicGain}', 0.8);
  v_s    double precision := public.cfg_num(p_flow, '{gain}', 1) * (c - 50) / 50;
begin
  if c < v_pb then
    v_s := v_s - v_pg * (v_pb - c) / v_pb;
  elsif c > 100 - v_pb then
    v_s := v_s + v_pg * (c - (100 - v_pb)) / v_pb;
  end if;
  return greatest(-1, least(1, v_s));
end;
$$;

-- aiGrowthPerGameYear: sector growth x trendShare + cycleGrowth x (mood - 50) / 50
create or replace function public.investor_confidence_ai_growth(p_sector_bps double precision, p_mood double precision, p_cfg jsonb)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_sector_bps, 0) / 10000.0 * public.cfg_num(p_cfg, '{aiFundamentals,trendShare}', 0.1)
       + public.cfg_num(p_cfg, '{aiFundamentals,cycleGrowthPerGameYear}', 0.08) * (coalesce(p_mood, 50) - 50) / 50;
$$;

-- stateFactors (points, rounded to 0.1, zeros left out)
create or replace function public.investor_confidence_state(
  p_profit_recent double precision, p_profit_prior double precision, p_reputation double precision,
  p_crisis_severity integer, p_incident_severity integer, p_country_risk double precision, p_talent_tiers double precision, p_coceo boolean,
  p_volatility double precision, p_mood double precision, p_sector_tilt double precision,
  p_log_return_24h double precision, p_log_premium double precision, p_chatter double precision, p_cfg jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  s     jsonb := coalesce(p_cfg -> 'state', '{}'::jsonb);
  f     jsonb := '{}'::jsonb;
  v     double precision;
  k     text;
  v_out jsonb := '{}'::jsonb;
begin
  if p_profit_recent is not null and p_profit_prior is not null then
    f := f || jsonb_build_object('profit',
      public.cfg_num(s, '{profitMax}', 8) * tanh((p_profit_recent - p_profit_prior) / greatest(abs(p_profit_prior), 100))
      + case when p_profit_recent < 0 then public.cfg_num(s, '{lossPoints}', -5) else 0 end);
  end if;
  if p_reputation is not null then
    f := f || jsonb_build_object('reputation', (p_reputation - 50) * public.cfg_num(s, '{reputationPerPoint}', 0.2));
  end if;
  if coalesce(p_crisis_severity, 0) > 0 then
    f := f || jsonb_build_object('crisis', public.cfg_num(s, '{crisisPerSeverity}', -3) * p_crisis_severity);
  end if;
  if coalesce(p_incident_severity, 0) > 0 then
    f := f || jsonb_build_object('incident_open', public.cfg_num(s, '{incidentPerSeverity}', -5) * p_incident_severity);
  end if;
  if p_country_risk is not null then
    f := f || jsonb_build_object('country', -public.cfg_num(s, '{countryPerRisk}', 0.12) * p_country_risk);
  end if;
  if coalesce(p_talent_tiers, 0) > 0 or coalesce(p_coceo, false) then
    f := f || jsonb_build_object('management', least(public.cfg_num(s, '{managementMax}', 7),
      public.cfg_num(s, '{managementPerTier}', 0.6) * coalesce(p_talent_tiers, 0)
      + case when coalesce(p_coceo, false) then public.cfg_num(s, '{managementCoCeo}', 2) else 0 end));
  end if;
  if p_volatility is not null then
    f := f || jsonb_build_object('volatility', -least(public.cfg_num(s, '{volatilityMax}', 10),
      public.cfg_num(s, '{volatilityPerSigma}', 120) * greatest(0, p_volatility - public.cfg_num(s, '{volatilityFree}', 0.025))));
  end if;
  f := f || jsonb_build_object('macro', (coalesce(p_mood, 50) - 50) * public.cfg_num(s, '{macroPerPoint}', 0.5));
  if coalesce(p_sector_tilt, 0) <> 0 then
    f := f || jsonb_build_object('sector', p_sector_tilt);
  end if;
  if p_log_return_24h is not null then
    f := f || jsonb_build_object('momentum',
      public.cfg_num(s, '{momentumMax}', 10) * tanh(p_log_return_24h / public.cfg_num(s, '{momentumScale}', 0.15)));
  end if;
  f := f || jsonb_build_object('valuation',
    -public.cfg_num(s, '{valuationMax}', 12) * tanh(coalesce(p_log_premium, 0) / public.cfg_num(s, '{valuationScale}', 0.35)));
  f := f || jsonb_build_object('chatter', coalesce(p_chatter, 0));
  for k, v in select e.key, e.value::double precision from jsonb_each_text(f) e loop
    v := round(v::numeric, 1)::double precision;
    if v <> 0 then
      v_out := v_out || jsonb_build_object(k, v);
    end if;
  end loop;
  return v_out;
end;
$$;

-- confidenceTarget: 50 + Σ factors, clamped to 0..100
create or replace function public.investor_confidence_target(p_factors jsonb)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select least(100, greatest(0, 50 + coalesce((select sum(e.value::double precision) from jsonb_each_text(p_factors) e), 0)));
$$;

-- topReasons: |points| >= minPoints, strongest first, at most maxReasons
create or replace function public.investor_confidence_reasons(p_factors jsonb, p_cfg jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'points', round(x.v::numeric, 1)) order by abs(x.v) desc, x.key), '[]'::jsonb)
    from (select e.key, e.value::double precision as v
            from jsonb_each_text(coalesce(p_factors, '{}'::jsonb)) e
           where abs(e.value::double precision) >= public.cfg_num(p_cfg, '{reasons,minPoints}', 1.5)
           order by abs(e.value::double precision) desc, e.key
           limit greatest(1, public.cfg_num(p_cfg, '{reasons,maxReasons}', 4))::integer) x;
$$;

-- ---------------------------------------------------------------------------
-- C. Bumps (event factors) and the hooks that set them
-- ---------------------------------------------------------------------------
create or replace function public.investor_confidence_bump(p_security uuid, p_key text, p_delta double precision,
                                                           p_now timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := coalesce(public.config_jsonb('investorConfidence'), '{}'::jsonb);
  v_max double precision;
begin
  if p_security is null or p_delta is null or p_delta = 0 or p_key is null or p_delta = 'NaN'::double precision then
    return;
  end if;
  if not exists (select 1 from public.securities s where s.id = p_security and s.kind = 'stock') then
    return;
  end if;
  v_max := public.cfg_num(v_cfg, array['events', p_key, 'max'], 20);
  insert into public.stock_confidence (security_id) values (p_security) on conflict (security_id) do nothing;
  update public.stock_confidence sc
     set events = sc.events || jsonb_build_object(p_key,
                    greatest(-v_max, least(v_max, coalesce((sc.events ->> p_key)::double precision, 0) + p_delta))),
         updated_at = coalesce(p_now, now())
   where sc.security_id = p_security;
end;
$$;
comment on function public.investor_confidence_bump(uuid, text, double precision, timestamptz) is
  'Internal (ADR-216): adds an event bump to a stock''s investor confidence, capped at ±events.<key>.max.';

create or replace function public.investor_confidence_bump_company(p_company uuid, p_key text, p_delta double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sec uuid;
begin
  select c.security_id into v_sec
    from public.companies c join public.securities s on s.id = c.security_id
   where c.id = p_company and s.status = 'listed';
  if v_sec is not null then
    perform public.investor_confidence_bump(v_sec, p_key, p_delta);
  end if;
end;
$$;

-- stock news and market forces that came true
create or replace function public.investor_confidence_on_tip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := coalesce(public.config_jsonb('investorConfidence'), '{}'::jsonb);
  v_key text := case when new.source = 'market' then 'market' else 'news' end;
begin
  if new.applied_at is not null and old.applied_at is null and new.comes_true then
    perform public.investor_confidence_bump(new.security_id, v_key,
      new.direction * new.move_bps / 1000.0 * public.cfg_num(v_cfg, array['events', v_key, 'pointsPerTenPercent'], 5));
  end if;
  return null;
end;
$$;
drop trigger if exists stock_tips_investor_confidence on public.stock_tips;
create trigger stock_tips_investor_confidence after update of applied_at on public.stock_tips
  for each row execute function public.investor_confidence_on_tip();

-- crises, chances, scandals, external events and stock incidents of player companies, the chosen strategy, the outcome
create or replace function public.investor_confidence_on_company_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg      jsonb := coalesce(public.config_jsonb('investorConfidence'), '{}'::jsonb);
  v_incident boolean := coalesce((new.definition ->> 'incident')::boolean, false);
  v_scandal  boolean;
  v_ext      boolean;
  v_key      text;
  v_delta    double precision := 0;
begin
  v_scandal := new.archetype in (select jsonb_array_elements_text(coalesce(v_cfg -> 'scandalArchetypes', '[]'::jsonb)));
  v_ext := new.archetype in (select jsonb_array_elements_text(coalesce(v_cfg -> 'externalArchetypes', '[]'::jsonb)));
  v_key := case when v_incident then 'incident' when v_scandal and new.polarity = 'crisis' then 'scandal' else 'event' end;
  if tg_op = 'INSERT' then
    if v_incident then
      v_delta := -public.cfg_num(v_cfg, '{events,incident,perSeverity}', 9) * new.severity;
    elsif new.polarity = 'chance' then
      v_delta := public.cfg_num(v_cfg, '{events,event,solvedPerSeverity}', 3) * new.severity;
    elsif v_scandal then
      v_delta := -public.cfg_num(v_cfg, '{events,scandal,perSeverity}', 7) * new.severity;
    else
      v_delta := -public.cfg_num(v_cfg, '{events,event,perSeverity}', 5) * new.severity
                 * case when v_ext then public.cfg_num(v_cfg, '{externalWeight}', 1.3) else 1 end;
    end if;
  else
    -- a cheap way out of a stock incident: the investors notice
    if v_incident and new.strategy is distinct from old.strategy and new.strategy is not null
       and new.strategy in (select jsonb_array_elements_text(coalesce(v_cfg #> '{incidents,badStrategies}', '[]'::jsonb))) then
      v_delta := -public.cfg_num(v_cfg, '{events,incident,badStrategyPerSeverity}', 6) * new.severity;
    end if;
    if new.polarity = 'crisis' and new.status is distinct from old.status then
      if new.status = 'solved' then
        v_delta := v_delta + case when v_incident then public.cfg_num(v_cfg, '{events,incident,solvedPerSeverity}', 4)
                                  else public.cfg_num(v_cfg, '{events,event,solvedPerSeverity}', 3) end
                             * new.severity * greatest(0.3, new.mitigation);
      elsif new.status = 'in_force' and old.status = 'open' then
        v_delta := v_delta - case when v_incident then public.cfg_num(v_cfg, '{events,incident,lostPerSeverity}', 5)
                                  else public.cfg_num(v_cfg, '{events,event,lostPerSeverity}', 4) end * new.severity;
      end if;
    end if;
  end if;
  if v_delta <> 0 then
    perform public.investor_confidence_bump_company(new.company_id, v_key, v_delta);
  end if;
  return null;
end;
$$;
drop trigger if exists player_company_events_investor_confidence on public.player_company_events;
create trigger player_company_events_investor_confidence after insert or update of status, strategy on public.player_company_events
  for each row execute function public.investor_confidence_on_company_event();

-- every step of a stock incident: confidence comes back step by step, a failed step costs some
create or replace function public.investor_confidence_on_event_step()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb;
  ev    public.player_company_events;
begin
  if new.status is not distinct from old.status or new.status not in ('succeeded', 'failed') or new.discarded then
    return null;
  end if;
  select * into ev from public.player_company_events e where e.id = new.event_id;
  if ev.id is null or not coalesce((ev.definition ->> 'incident')::boolean, false) then
    return null;
  end if;
  v_cfg := coalesce(public.config_jsonb('investorConfidence'), '{}'::jsonb);
  perform public.investor_confidence_bump_company(ev.company_id, 'incident',
    case when new.status = 'succeeded' then public.cfg_num(v_cfg, '{events,incident,stepSucceededPerSeverity}', 2.5)
         else -public.cfg_num(v_cfg, '{events,incident,stepFailedPerSeverity}', 1.5) end * ev.severity);
  return null;
end;
$$;
drop trigger if exists company_event_steps_investor_confidence on public.company_event_steps;
create trigger company_event_steps_investor_confidence after update of status on public.company_event_steps
  for each row execute function public.investor_confidence_on_event_step();

-- dividends: the payout against the market cap
create or replace function public.investor_confidence_on_dividend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg  jsonb := coalesce(public.config_jsonb('investorConfidence'), '{}'::jsonb);
  v_mcap bigint;
  v_sec  uuid;
begin
  select c.security_id, q.market_cap_cents into v_sec, v_mcap
    from public.companies c join public.security_quotes q on q.security_id = c.security_id
   where c.id = new.company_id;
  if v_sec is not null and new.total_cents > 0 then
    perform public.investor_confidence_bump_company(new.company_id, 'payout',
      greatest(public.cfg_num(v_cfg, '{events,payout,min}', 1),
               least(public.cfg_num(v_cfg, '{events,payout,max}', 10),
                     case when coalesce(v_mcap, 0) > 0 then new.total_cents * 100.0 / v_mcap else 0 end
                     * public.cfg_num(v_cfg, '{events,payout,pointsPerPercentYield}', 4))));
  end if;
  return null;
end;
$$;
drop trigger if exists company_dividends_investor_confidence on public.company_dividends;
create trigger company_dividends_investor_confidence after insert on public.company_dividends
  for each row execute function public.investor_confidence_on_dividend();

-- the founder takes money out of a listed company: share of the cash before the withdrawal
create or replace function public.investor_confidence_on_withdraw()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := coalesce(public.config_jsonb('investorConfidence'), '{}'::jsonb);
  v_amount bigint;
  v_cash   bigint;
  v_share  double precision;
begin
  if new.last_withdraw_at is null or new.last_withdraw_at is not distinct from old.last_withdraw_at then
    return null;
  end if;
  select abs(e.amount_cents) into v_amount
    from public.ledger_transactions t
    join public.ledger_entries e on e.transaction_id = t.id
    join public.ledger_accounts a on a.id = e.account_id and a.kind = 'company_cash' and a.owner_company_id = new.company_id
   where t.ref_id = new.company_id and t.idempotency_key like 'withdraw:%'
   order by t.created_at desc, e.id desc limit 1;
  if coalesce(v_amount, 0) <= 0 then
    return null;
  end if;
  select a.balance_cents into v_cash from public.ledger_accounts a
   where a.owner_company_id = new.company_id and a.kind = 'company_cash';
  v_share := least(1, v_amount::double precision / greatest(1, coalesce(v_cash, 0) + v_amount));
  perform public.investor_confidence_bump_company(new.company_id, 'withdraw',
    -greatest(public.cfg_num(v_cfg, '{events,withdraw,min}', 2),
              least(public.cfg_num(v_cfg, '{events,withdraw,max}', 30),
                    public.cfg_num(v_cfg, '{events,withdraw,perCashShare}', 32) * v_share)));
  return null;
end;
$$;
drop trigger if exists player_companies_investor_confidence on public.player_companies;
create trigger player_companies_investor_confidence after update of last_withdraw_at on public.player_companies
  for each row execute function public.investor_confidence_on_withdraw();

-- the founder sells shares of his own company: share of his stake
create or replace function public.investor_confidence_on_trade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg     jsonb;
  v_company uuid;
  v_left    bigint;
  v_share   double precision;
begin
  if new.side <> 'sell' or new.position_side <> 'long' then
    return null;
  end if;
  select c.id into v_company
    from public.companies c join public.player_companies pc on pc.company_id = c.id
   where c.security_id = new.security_id and pc.founder_id = new.player_id;
  if v_company is null then
    return null;
  end if;
  v_cfg := coalesce(public.config_jsonb('investorConfidence'), '{}'::jsonb);
  select coalesce(sum(p.quantity_e6), 0) into v_left from public.positions p
   where p.player_id = new.player_id and p.security_id = new.security_id and p.status = 'open' and p.side = 'long';
  v_share := least(1, new.quantity_e6::double precision / greatest(1, v_left + new.quantity_e6));
  perform public.investor_confidence_bump_company(v_company, 'insider',
    -least(public.cfg_num(v_cfg, '{events,insider,max}', 25),
           public.cfg_num(v_cfg, '{events,insider,base}', 3) + public.cfg_num(v_cfg, '{events,insider,perStakeShare}', 25) * v_share));
  return null;
end;
$$;
drop trigger if exists trades_investor_confidence on public.trades;
create trigger trades_investor_confidence after insert on public.trades
  for each row execute function public.investor_confidence_on_trade();

-- capital increase: new shares against the old count
create or replace function public.investor_confidence_on_shares()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := coalesce(public.config_jsonb('investorConfidence'), '{}'::jsonb);
begin
  -- the shares issued at the IPO itself are no dilution: only a stock listed for a while counts
  if new.security_id is not null and old.shares_outstanding > 0 and new.shares_outstanding > old.shares_outstanding
     and exists (select 1 from public.securities s where s.id = new.security_id and s.status = 'listed'
                    and coalesce(s.listed_at, s.created_at) < now() - interval '10 minutes') then
    perform public.investor_confidence_bump_company(new.id, 'dilution',
      -least(public.cfg_num(v_cfg, '{events,dilution,max}', 18),
             public.cfg_num(v_cfg, '{events,dilution,perNewShare}', 40)
             * (new.shares_outstanding::double precision / old.shares_outstanding - 1)));
  end if;
  return null;
end;
$$;
drop trigger if exists companies_investor_confidence on public.companies;
create trigger companies_investor_confidence after update of shares_outstanding on public.companies
  for each row execute function public.investor_confidence_on_shares();

-- ---------------------------------------------------------------------------
-- D. Stock incidents: drawn for listed player companies, the hotter the stock the more often
-- ---------------------------------------------------------------------------
create or replace function public.investor_confidence_incidents_run(p_now timestamptz, p_minutes double precision)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc   jsonb := coalesce(public.config_jsonb('investorConfidence', '{incidents}'), '{}'::jsonb);
  v_mf    jsonb := coalesce(public.config_jsonb('marketForces'), '{}'::jsonb);
  v_keys  text[];
  v_key   text;
  v_sev   integer;
  v_id    uuid;
  v_rate  double precision;
  v_n     integer := 0;
  r       record;
begin
  select array_agg(a.x ->> 'key' order by a.ord) into v_keys
    from jsonb_array_elements(coalesce(public.company_events_cfg() -> 'archetypes', '[]'::jsonb)) with ordinality a(x, ord)
   where coalesce((a.x ->> 'incident')::boolean, false);
  if v_keys is null or cardinality(v_keys) = 0 then
    return 0;
  end if;
  for r in
    select c.id as company_id, s.id as security_id, s.name, s.sector_key, q.market_cap_cents, h.heat
      from public.companies c
      join public.player_companies pc on pc.company_id = c.id and pc.status = 'active'
      join public.securities s on s.id = c.security_id and s.kind = 'stock' and s.status = 'listed'
      join public.security_quotes q on q.security_id = s.id
      join public.security_sim_state st on st.security_id = s.id
      cross join lateral public.market_force_heat(
        q.last_price_e4, st.fair_value_e4,
        (select c1.close_e4 from public.candles c1
          where c1.security_id = s.id and c1.interval = '1h'
            and c1.bucket_start <= p_now - interval '24 hours' and c1.bucket_start > p_now - interval '48 hours'
          order by c1.bucket_start desc limit 1),
        (select c2.close_e4 from public.candles c2
          where c2.security_id = s.id and c2.interval = '1h'
            and c2.bucket_start <= p_now - interval '7 days' and c2.bucket_start > p_now - interval '8 days'
          order by c2.bucket_start desc limit 1),
        v_mf) h
     where not c.is_ai
       and coalesce(s.listed_at, s.created_at) <= p_now - make_interval(secs => public.cfg_num(v_inc, '{minListedHours}', 6) * 3600)
       and not exists (select 1 from public.player_company_events ev
                        where ev.company_id = c.id and ev.status not in ('over', 'expired'))
       and not exists (select 1 from public.player_company_events ev
                        where ev.company_id = c.id and coalesce((ev.definition ->> 'incident')::boolean, false)
                          and ev.started_at > p_now - make_interval(secs => public.cfg_num(v_inc, '{cooldownHours}', 24) * 3600))
  loop
    v_rate := least(public.cfg_num(v_inc, '{maxPerHour}', 0.5),
                    public.cfg_num(v_inc, '{basePerHour}', 0.001) + public.cfg_num(v_inc, '{perHeatPerHour}', 0.07) * greatest(0, r.heat))
            * (1 + public.cfg_num(v_inc, '{perWorthDecade}', 0.25)
                   * greatest(0, log(greatest(1, coalesce(r.market_cap_cents, 0))::numeric / 100000000)::double precision));
    continue when random() >= 1 - exp(-v_rate * greatest(1, p_minutes) / 60.0);
    v_sev := case when r.heat >= public.cfg_num(v_inc, '{severity3Heat}', 1.6) then 3
                  when r.heat >= public.cfg_num(v_inc, '{severity2Heat}', 0.6) then 2 else 1 end;
    v_key := v_keys[1 + floor(random() * cardinality(v_keys))::integer];
    v_id := public.company_event_start(r.company_id, v_key, v_sev, p_now);
    continue when v_id is null;
    -- stock news (Mr. Doodle reads news_items)
    insert into public.news_items (category, headline, body, importance, security_id, company_id, sector_key, published_at)
    values ('market', replace(coalesce(v_inc #>> array['news', v_key, '0'], 'Schwerer Vorfall bei {name}'), '{name}', r.name),
            v_inc #>> array['news', v_key, '1'], least(3, v_sev + 1), r.security_id, r.company_id, r.sector_key, p_now);
    -- a clear note for the founder beside the usual crisis note
    perform public.company_event_notify(v_id,
      replace(coalesce(v_inc #>> array['news', v_key, '0'], 'Schwerer Vorfall bei {name}'), '{name}', r.name),
      coalesce(v_inc #>> '{founderNote}', 'Die Anleger verlieren das Vertrauen. Reagiere in der Firma.'),
      'company_event:' || v_id::text || ':incident');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
comment on function public.investor_confidence_incidents_run(timestamptz, double precision) is
  'Internal (ADR-216): draws stock incidents (companyEvents archetypes with incident) for listed player companies by heat and size.';

-- ---------------------------------------------------------------------------
-- E. The minute job
-- ---------------------------------------------------------------------------
create or replace function public.investor_confidence_run(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg     jsonb := public.config_jsonb('investorConfidence');
  v_now     timestamptz := coalesce(p_now, public.game_now());
  m         public.market_mood;
  v_min     double precision;
  v_target  double precision;
  v_tau     double precision;
  v_phase   text;
  v_hours   double precision;
  v_total   double precision;
  v_x       double precision;
  v_up      text;
  v_down    text;
  v_up_n    text;
  v_down_n  text;
  v_quarter bigint;
  v_prev_q  bigint;
  v_prior_q bigint;
  v_hl      double precision;
  v_events  jsonb;
  v_factors jsonb;
  v_chatter double precision;
  v_conf    double precision;
  v_tgt     double precision;
  v_hist    jsonb;
  v_ago     double precision;
  v_keep    integer;
  v_n       integer := 0;
  v_news    integer := 0;
  v_inc     integer := 0;
  v_smooth  double precision;
  k         text;
  v         double precision;
  r         record;
begin
  if v_cfg is null or jsonb_typeof(v_cfg) <> 'object' then
    return jsonb_build_object('skipped', 'no_config');
  end if;
  -- never beside a running tick (same lock as the tick and the stock news)
  perform pg_advisory_xact_lock(7311001);
  insert into public.market_mood (id) values (true) on conflict (id) do nothing;
  select * into m from public.market_mood where id for update;
  v_min := least(60, greatest(1, coalesce(extract(epoch from (v_now - m.last_run_at)) / 60.0, 1)));
  v_keep := greatest(2, public.cfg_num(v_cfg, '{news,historyHours}', 24)::integer + 1);

  -- 1. market mood: a new phase when the old one ended, then a step towards its target ----------------
  if v_now >= m.phase_ends_at or m.last_run_at is null then
    if m.last_run_at is null and v_now < m.phase_ends_at then
      v_phase := m.phase;  -- first run: keep the seeded calm phase
    else
      select sum(public.cfg_num(p.value, '{weight}', 1)) into v_total from jsonb_each(v_cfg #> '{mood,phases}') p;
      v_x := random() * coalesce(v_total, 1);
      for k, v in select p.key, public.cfg_num(p.value, '{weight}', 1) from jsonb_each(v_cfg #> '{mood,phases}') p order by p.key loop
        v_phase := k;
        v_x := v_x - v;
        exit when v_x < 0;
      end loop;
      v_phase := coalesce(v_phase, 'calm');
      v_hours := public.cfg_num(v_cfg, array['mood', 'phases', v_phase, 'minHours'], 12)
               + random() * (public.cfg_num(v_cfg, array['mood', 'phases', v_phase, 'maxHours'], 36)
                             - public.cfg_num(v_cfg, array['mood', 'phases', v_phase, 'minHours'], 12));
      if v_phase is distinct from m.phase then
        insert into public.news_items (category, headline, body, importance, published_at)
        values ('market', v_cfg #>> array['newsTexts', 'phases', v_phase, '0'],
                v_cfg #>> array['newsTexts', 'phases', v_phase, '1'], 3, v_now);
        v_news := v_news + 1;
        m.phase_started_at := v_now;
      end if;
      m.phase := v_phase;
      m.phase_ends_at := v_now + make_interval(secs => v_hours * 3600);
    end if;
  end if;
  v_target := public.cfg_num(v_cfg, array['mood', 'phases', m.phase, 'target'], 50);
  v_tau := greatest(1, public.cfg_num(v_cfg, '{mood,tauHours}', 5) * 60);
  m.mood := least(100, greatest(0, m.mood + (v_target - m.mood) * (1 - power(1 - 1 / v_tau, v_min))
                                   + public.cfg_num(v_cfg, '{mood,sigmaPerMinute}', 0.35) * sqrt(v_min) * public.gauss_random()));

  -- 2. sector rotation -----------------------------------------------------------------------------------
  if v_now >= m.rotation_at then
    select s.key, s.name into v_up, v_up_n from public.sectors s order by random() limit 1;
    select s.key, s.name into v_down, v_down_n from public.sectors s where s.key <> v_up order by random() limit 1;
    if v_up is not null and v_down is not null then
      m.sector_tilts := jsonb_build_object(v_up, public.cfg_num(v_cfg, '{mood,rotation,tilt}', 7),
                                           v_down, -public.cfg_num(v_cfg, '{mood,rotation,tilt}', 7));
      insert into public.news_items (category, headline, body, importance, published_at)
      values ('market', replace(replace(v_cfg #>> '{newsTexts,rotation,0}', '{up}', v_up_n), '{down}', v_down_n),
              replace(replace(v_cfg #>> '{newsTexts,rotation,1}', '{up}', v_up_n), '{down}', v_down_n), 2, v_now);
      v_news := v_news + 1;
    end if;
    m.rotation_at := v_now + make_interval(secs => 3600 * (public.cfg_num(v_cfg, '{mood,rotation,minHours}', 12)
                       + random() * (public.cfg_num(v_cfg, '{mood,rotation,maxHours}', 36)
                                     - public.cfg_num(v_cfg, '{mood,rotation,minHours}', 12))));
  end if;

  -- 3. quarter results of listed player companies: profit of the last quarter against the one before ----
  select gq.id into v_quarter from public.game_quarters gq where gq.starts_at <= v_now order by gq.starts_at desc limit 1;
  if v_quarter is not null and m.last_quarter_id is not null and v_quarter <> m.last_quarter_id then
    select gq.id into v_prev_q from public.game_quarters gq
     where gq.starts_at < (select g2.starts_at from public.game_quarters g2 where g2.id = v_quarter)
     order by gq.starts_at desc limit 1;
    select gq.id into v_prior_q from public.game_quarters gq
     where gq.starts_at < (select g2.starts_at from public.game_quarters g2 where g2.id = v_prev_q)
     order by gq.starts_at desc limit 1;
    for r in
      select c.security_id,
             (select sum(h.profit_cents) from public.player_company_hours h where h.company_id = c.id and h.game_quarter_id = v_prev_q) as recent,
             (select sum(h.profit_cents) from public.player_company_hours h where h.company_id = c.id and h.game_quarter_id = v_prior_q) as prior
        from public.companies c join public.securities s on s.id = c.security_id
       where not c.is_ai and s.status = 'listed' and s.kind = 'stock'
    loop
      if r.recent is not null and r.prior is not null then
        perform public.investor_confidence_bump(r.security_id, 'earnings',
          public.cfg_num(v_cfg, '{events,earnings,perSurprise}', 30)
          * greatest(-1, least(1, (r.recent - r.prior)::double precision / greatest(abs(r.prior), 100))), v_now);
      end if;
    end loop;
  end if;
  m.last_quarter_id := coalesce(v_quarter, m.last_quarter_id);

  -- 3b. stock incidents for overheated player stocks
  v_inc := public.investor_confidence_incidents_run(v_now, v_min);

  -- 4. every listed stock ---------------------------------------------------------------------------------
  v_smooth := 1 - power(1 - least(1, greatest(0, public.cfg_num(v_cfg, '{smoothingPerMinute}', 0.075))), v_min);
  insert into public.stock_confidence (security_id, confidence)
  select s.id, st.confidence from public.securities s join public.security_sim_state st on st.security_id = s.id
   where s.kind = 'stock' and s.status = 'listed'
  on conflict (security_id) do nothing;
  for r in
    select s.id, s.name, s.sector_key, c.id as company_id, c.is_ai, q.last_price_e4 as price, st.fair_value_e4 as fair,
           sc.confidence, sc.events, sc.chatter, sc.history, sc.history_hour, sc.news_at,
           (select c1.close_e4 from public.candles c1
             where c1.security_id = s.id and c1.interval = '1h'
               and c1.bucket_start <= v_now - interval '24 hours' and c1.bucket_start > v_now - interval '48 hours'
             order by c1.bucket_start desc limit 1) as p24,
           (select case when count(x.lr) >= 3 then stddev_samp(x.lr) end
              from (select ln(c2.close_e4::double precision / nullif(lag(c2.close_e4) over (order by c2.bucket_start), 0)) as lr
                      from public.candles c2
                     where c2.security_id = s.id and c2.interval = '1h' and c2.bucket_start > v_now - interval '25 hours'
                       and c2.close_e4 > 0) x) as vol,
           case when c.is_ai then
                  (select array_agg(y.net_income_cents order by y.starts_at desc)
                     from (select qr.net_income_cents, gq.starts_at from public.company_quarter_reports qr
                             join public.game_quarters gq on gq.id = qr.game_quarter_id
                            where qr.company_id = c.id order by gq.starts_at desc limit 2) y)
                else array[(select sum(h.profit_cents) from public.player_company_hours h
                             where h.company_id = c.id and h.hour_start >= v_now - interval '6 hours'),
                           (select sum(h.profit_cents) from public.player_company_hours h
                             where h.company_id = c.id and h.hour_start >= v_now - interval '12 hours'
                               and h.hour_start < v_now - interval '6 hours')]
           end as profits,
           pc.reputation,
           (select max(ev.severity) from public.player_company_events ev
             where ev.company_id = c.id and ev.polarity = 'crisis' and ev.status in ('open', 'accepted', 'in_force')
               and not coalesce((ev.definition ->> 'incident')::boolean, false)) as crisis,
           (select max(ev.severity) from public.player_company_events ev
             where ev.company_id = c.id and ev.status in ('open', 'accepted', 'in_force')
               and coalesce((ev.definition ->> 'incident')::boolean, false)) as incident,
           case when c.is_ai then null else public.company_country(c.id) end as country,
           tl.tiers, tl.coceo
      from public.securities s
      join public.companies c on c.id = s.company_id
      join public.security_quotes q on q.security_id = s.id
      join public.security_sim_state st on st.security_id = s.id
      join public.stock_confidence sc on sc.security_id = s.id
      left join public.player_companies pc on pc.company_id = c.id
      left join lateral (select sum(t.tier + 1)::double precision as tiers, bool_or(t.is_coceo) as coceo
                           from public.talents t where t.company_id = c.id) tl on true
     where s.kind = 'stock' and s.status = 'listed'
     for update of sc
  loop
    -- event bumps fade
    v_events := '{}'::jsonb;
    for k, v in select e.key, e.value::double precision from jsonb_each_text(r.events) e loop
      v_hl := public.cfg_num(v_cfg, array['events', k, 'halfLifeHours'], 12);
      v := case when v_hl > 0 then v * power(0.5, v_min / 60.0 / v_hl) else 0 end;
      if abs(v) >= 0.05 then
        v_events := v_events || jsonb_build_object(k, v);
      end if;
    end loop;
    -- chatter: a random walk of rumours, pulled back with tau
    v_chatter := r.chatter * power(1 - 1 / greatest(1, public.cfg_num(v_cfg, '{state,chatterTauHours}', 6) * 60), v_min)
               + public.cfg_num(v_cfg, '{state,chatterSigma}', 0.45) * sqrt(v_min) * public.gauss_random();
    v_factors := public.investor_confidence_state(
      r.profits[1]::double precision, r.profits[2]::double precision, r.reputation, r.crisis, r.incident,
      case when r.country is not null then
        (public.cfg_num(public.country_cfg(r.country), '{politicalRisk}', 0) + public.cfg_num(public.country_cfg(r.country), '{warRisk}', 0)) / 2
      end,
      r.tiers, r.coceo, r.vol, m.mood, public.cfg_num(m.sector_tilts, array[coalesce(r.sector_key, '')], 0),
      case when r.p24 > 0 and r.price > 0 then ln(r.price::double precision / r.p24) end,
      case when r.fair > 0 and r.price > 0 then ln(r.price::double precision / r.fair) else 0 end,
      v_chatter, v_cfg);
    -- display: rounded event bumps plus the state factors
    for k, v in select e.key, e.value::double precision from jsonb_each_text(v_events) e loop
      if round(v::numeric, 1) <> 0 then
        v_factors := v_factors || jsonb_build_object(k, round(v::numeric, 1));
      end if;
    end loop;
    v_tgt := public.investor_confidence_target(v_factors);
    v_conf := least(100, greatest(0, r.confidence + (v_tgt - r.confidence) * v_smooth));
    -- hourly history (newest last)
    v_hist := r.history;
    if r.history_hour is null or date_trunc('hour', v_now) > r.history_hour then
      v_hist := v_hist || to_jsonb(round(v_conf::numeric, 1));
      while jsonb_array_length(v_hist) > v_keep loop
        v_hist := v_hist - 0;
      end loop;
    end if;
    -- a news item on a big swing within 6 hours
    v_ago := case when jsonb_array_length(v_hist) >= 7 then (v_hist ->> (jsonb_array_length(v_hist) - 7))::double precision end;
    if v_ago is not null and abs(v_conf - v_ago) >= public.cfg_num(v_cfg, '{news,swingPoints}', 15)
       and (r.news_at is null or r.news_at < v_now - make_interval(hours => public.cfg_num(v_cfg, '{news,cooldownHours}', 12)::integer)) then
      insert into public.news_items (category, headline, body, importance, security_id, company_id, sector_key, published_at)
      values ('market',
              replace(v_cfg #>> array['newsTexts', case when v_conf < v_ago then 'swingDown' else 'swingUp' end, '0'], '{name}', r.name),
              replace(replace(replace(v_cfg #>> array['newsTexts', case when v_conf < v_ago then 'swingDown' else 'swingUp' end, '1'],
                '{name}', r.name), '{from}', round(v_ago)::text), '{to}', round(v_conf)::text),
              2, r.id, r.company_id, r.sector_key, v_now);
      r.news_at := v_now;
      v_news := v_news + 1;
    end if;
    update public.stock_confidence
       set confidence = v_conf, target = v_tgt, events = v_events, factors = v_factors, chatter = v_chatter,
           history = v_hist, history_hour = date_trunc('hour', v_now), news_at = r.news_at, updated_at = v_now
     where security_id = r.id;
    update public.security_sim_state set confidence = v_conf where security_id = r.id;
    v_n := v_n + 1;
  end loop;

  -- 5. mood history and save ----------------------------------------------------------------------------
  if m.history_hour is null or date_trunc('hour', v_now) > m.history_hour then
    m.history := m.history || to_jsonb(round(m.mood::numeric, 1));
    while jsonb_array_length(m.history) > v_keep loop
      m.history := m.history - 0;
    end loop;
    m.history_hour := date_trunc('hour', v_now);
  end if;
  update public.market_mood
     set mood = m.mood, phase = m.phase, phase_started_at = m.phase_started_at, phase_ends_at = m.phase_ends_at,
         sector_tilts = m.sector_tilts, rotation_at = m.rotation_at, history = m.history, history_hour = m.history_hour,
         last_run_at = v_now, last_quarter_id = m.last_quarter_id, updated_at = now()
   where id;
  return jsonb_build_object('stocks', v_n, 'mood', round(m.mood::numeric, 1), 'phase', m.phase, 'news', v_news,
                            'incidents', v_inc);
end;
$$;
comment on function public.investor_confidence_run(timestamptz) is
  'Internal, cron every minute (ADR-216): moves the market mood and every listed stock''s investor confidence.';

-- ---------------------------------------------------------------------------
-- F. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.market_mood_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mood', round(m.mood::numeric, 1),
    'phase', m.phase,
    'phase_started_at', m.phase_started_at,
    'trend', round((m.mood - coalesce((m.history ->> 0)::double precision, m.mood))::numeric, 1),
    'history', m.history,
    'sectors', coalesce((select jsonb_agg(jsonb_build_object('sector', t.key, 'points', round(t.value::numeric, 1)) order by t.value::double precision desc)
                           from jsonb_each_text(m.sector_tilts) t), '[]'::jsonb))
    from public.market_mood m where m.id;
$$;

create or replace function public.get_stock_confidence(p_ticker text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id  uuid;
  v_cfg jsonb := coalesce(public.config_jsonb('investorConfidence'), '{}'::jsonb);
  v_res jsonb;
begin
  perform public.require_player();
  v_id := public.resolve_security(p_ticker);
  if v_id is null or not exists (select 1 from public.securities s where s.id = v_id and s.kind = 'stock') then
    perform public.api_error('unknown_security');
  end if;
  select jsonb_build_object(
           'ticker', s.ticker,
           'confidence', round(coalesce(sc.confidence, st.confidence, 50)::numeric, 1),
           'target', round(coalesce(sc.target, st.confidence, 50)::numeric, 1),
           'trend', round((coalesce(sc.confidence, 50)
                           - coalesce((sc.history ->> 0)::double precision, sc.confidence, 50))::numeric, 1),
           'history', coalesce(sc.history, '[]'::jsonb),
           'reasons', public.investor_confidence_reasons(sc.factors, v_cfg),
           'market', public.market_mood_json(),
           'updated_at', sc.updated_at)
    into v_res
    from public.securities s
    join public.security_sim_state st on st.security_id = s.id
    left join public.stock_confidence sc on sc.security_id = s.id
   where s.id = v_id;
  return v_res;
end;
$$;
comment on function public.get_stock_confidence(text) is
  'RPC (ADR-216): investor confidence of a stock: value, target, 24-hour trend, hourly history, top reasons, market mood.';

create or replace function public.get_market_mood()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  perform public.require_player();
  select public.market_mood_json() || jsonb_build_object(
           'avg_confidence', coalesce((select round(avg(sc.confidence)::numeric, 1) from public.stock_confidence sc
                                         join public.securities s on s.id = sc.security_id where s.status = 'listed'), 50),
           'confident', (select count(*) from public.stock_confidence sc join public.securities s on s.id = sc.security_id
                          where s.status = 'listed' and sc.confidence >= 50),
           'stocks', (select count(*) from public.stock_confidence sc join public.securities s on s.id = sc.security_id
                       where s.status = 'listed'),
           'leaders', coalesce((select jsonb_agg(jsonb_build_object('ticker', x.ticker, 'name', x.name, 'confidence', x.c)
                                                 order by x.c desc, x.ticker)
                                  from (select s.ticker, s.name, round(sc.confidence::numeric, 1) as c
                                          from public.stock_confidence sc join public.securities s on s.id = sc.security_id
                                         where s.status = 'listed' order by sc.confidence desc, s.ticker limit 3) x), '[]'::jsonb),
           'laggards', coalesce((select jsonb_agg(jsonb_build_object('ticker', x.ticker, 'name', x.name, 'confidence', x.c)
                                                  order by x.c, x.ticker)
                                   from (select s.ticker, s.name, round(sc.confidence::numeric, 1) as c
                                           from public.stock_confidence sc join public.securities s on s.id = sc.security_id
                                          where s.status = 'listed' order by sc.confidence, s.ticker limit 3) x), '[]'::jsonb))
    into v_res;
  return v_res;
end;
$$;
comment on function public.get_market_mood() is
  'RPC (ADR-216): market mood (0..100, phase, 24-hour trend, history, sector rotation), average confidence, leaders, laggards.';

-- ---------------------------------------------------------------------------
-- G. Grants and the cron job
-- ---------------------------------------------------------------------------
do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.investor_confidence_signal(double precision, jsonb)',
    'public.investor_confidence_ai_growth(double precision, double precision, jsonb)',
    'public.investor_confidence_state(double precision, double precision, double precision, integer, integer, double precision, double precision, boolean, double precision, double precision, double precision, double precision, double precision, double precision, jsonb)',
    'public.investor_confidence_target(jsonb)',
    'public.investor_confidence_reasons(jsonb, jsonb)',
    'public.investor_confidence_bump(uuid, text, double precision, timestamptz)',
    'public.investor_confidence_bump_company(uuid, text, double precision)',
    'public.investor_confidence_on_tip()',
    'public.investor_confidence_on_company_event()',
    'public.investor_confidence_on_event_step()',
    'public.investor_confidence_incidents_run(timestamptz, double precision)',
    'public.investor_confidence_on_dividend()',
    'public.investor_confidence_on_withdraw()',
    'public.investor_confidence_on_trade()',
    'public.investor_confidence_on_shares()',
    'public.investor_confidence_run(timestamptz)',
    'public.market_mood_json()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  grant execute on function public.investor_confidence_run(timestamptz) to service_role;
  foreach f in array array['public.get_stock_confidence(text)', 'public.get_market_mood()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-investor-confidence';
    perform cron.schedule('nexa-investor-confidence', '* * * * *', 'select public.investor_confidence_run()');
  end if;
end;
$do$;
