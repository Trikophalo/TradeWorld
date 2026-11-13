-- =============================================================================
-- NEXA · M4g · 0100 · Announced events (ADR-090)
-- =============================================================================
-- Plans and resolves the rows of public.scheduled_events (created in 1100, unused until now):
--   opening_bell / closing_bell  daily at time.marketOpenHour / marketCloseHour (Europe/Berlin), informational
--   earnings      at the end of every game quarter for the events.schedule.earningsTopCompanies largest
--                 AI companies by market cap; outcome from company_quarter_reports (the earnings sentiment
--                 itself is applied by simulate_ai_companies at the quarter close, unchanged)
--   pharma_trial  per pharma AI company and quarter with events.pharmaTrial.probabilityPerQuarter,
--                 announced announceLeadQuarters ahead (scheduled in the middle of that quarter); the hidden
--                 success probability (by size class) lives in scheduled_event_secrets. Resolution mirrors
--                 resolvePharmaTrial (src/lib/sim/events.ts): the move is a real, persistent price shock;
--                 fair value, EMAs and the new security_sim_state.event_value_factor move by the same factor
--                 (fair_value_from_fundamentals multiplies by it), so value funds do not revert the jump
--   rate_decision on isRateDecisionQuarter quarters (src/lib/sim/central-bank.ts), announced once the
--                 quarter announceLeadQuarters before has ended; decidePolicyRate on the per-capita growth of
--                 the money supply (player + player-company accounts per active player) against the
--                 money_supply_snapshots row measurementWindowQuarters earlier (no such row: rate held)
-- Every event is planned at most events.schedule.horizonHours ahead and idempotently (dedupe_key).
-- run_due_jobs() calls events_run_due(): planning every 15 minutes, resolution of due events every
-- minute (late events after a downtime are resolved once), a money supply snapshot per closed quarter.
-- Holders of a pharma stock get the notification event_holding.
-- New RPC get_events(p_limit) -> {server_time, upcoming: [EVENT], recent: [EVENT]}
--   EVENT = {id, kind, importance, scheduled_at, announced_at, status, ticker, company_name, sector, outcome}
--   outcome null until resolved; bells {}; earnings {revenue_cents, net_income_cents, eps_e4,
--   revenue_change_bps, net_income_change_bps, surprise: beat|miss|inline}; pharma_trial {success, move_bps,
--   price_before_e4, price_after_e4}; rate_decision {old_bps, new_bps, money_growth_bps (null: no measurement)}
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.security_sim_state
  add column if not exists event_value_factor double precision not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'security_sim_state_event_value_factor_check'
                    and conrelid = 'public.security_sim_state'::regclass) then
    alter table public.security_sim_state add constraint security_sim_state_event_value_factor_check
      check (event_value_factor > 0);
  end if;
end;
$$;
comment on column public.security_sim_state.event_value_factor is
  'Multiplier on the fair value from binary events (pharma trials, ADR-090), 1 = neutral. Mirrors eventValueFactor in src/lib/sim/fair-value.ts.';

alter table public.money_supply_snapshots add column if not exists active_players integer;
comment on column public.money_supply_snapshots.active_players is
  'Players with a daily login in the last centralBank.activePlayerWindowDays days when the snapshot was taken (per-capita money growth, ADR-090).';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('event_holding', 'market', 'Ereignis in deinem Depot', 'Ein angekündigtes Ereignis hat eine Aktie aus deinem Depot bewegt.',
        'notif_clock', true, false, false, 105)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Fair value with the event factor (as in M1, times security_sim_state.event_value_factor)
-- ---------------------------------------------------------------------------
create or replace function public.fair_value_from_fundamentals(p_company_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.companies;
  v_val    jsonb := coalesce(public.config_jsonb('valuation'), '{}'::jsonb);
  v_sec    jsonb;
  v_policy integer;
  v_pe     double precision;
  v_growth double precision := 0;
  v_recent numeric;
  v_prev   numeric;
  v_n      integer;
  v_macro  double precision;
  v_event  double precision;
  v_fv     double precision;
begin
  select * into c from public.companies where id = p_company_id;
  if c.id is null or c.shares_outstanding <= 0 or c.ttm_net_income_cents <= 0 then
    return null;
  end if;
  v_sec := coalesce(public.config_jsonb('sectors', array[c.sector_key]), '{}'::jsonb);
  v_pe := public.cfg_num(v_sec, '{peRatio}', coalesce((select s.base_pe from public.sectors s where s.key = c.sector_key), 15));
  select count(*), sum(x.revenue_cents) filter (where x.rn <= 4), sum(x.revenue_cents) filter (where x.rn > 4)
    into v_n, v_recent, v_prev
    from (select r.revenue_cents, row_number() over (order by gq.starts_at desc) as rn
            from public.company_quarter_reports r
            join public.game_quarters gq on gq.id = r.game_quarter_id
           where r.company_id = c.id and r.published_at is not null
           order by gq.starts_at desc limit 8) x;
  if v_n >= 8 and v_prev > 0 then
    v_growth := v_recent / v_prev - 1;
  end if;
  select cb.policy_rate_bps into v_policy from public.central_bank_state cb where cb.id;
  v_macro := greatest(public.cfg_num(v_val, '{macroFactorMin}', 0.6), least(public.cfg_num(v_val, '{macroFactorMax}', 1.3),
               1 - public.cfg_num(v_val, '{macroSensitivityPer100Bps}', 0.04)
                 * public.cfg_num(v_sec, '{sensitivity,valuationRate}', 1)
                 * (coalesce(v_policy, 300) - public.config_double('centralBank', '{neutralRateBps}', 300)) / 100.0));
  -- binary events (pharma trials, ADR-090): the fair value follows the price shock
  select st.event_value_factor into v_event from public.security_sim_state st where st.security_id = c.security_id;
  v_fv := (c.ttm_net_income_cents::double precision / c.shares_outstanding)        -- EPS in cents
        * v_pe
        * greatest(public.cfg_num(v_val, '{growthFactorMin}', 0.6),
                   least(public.cfg_num(v_val, '{growthFactorMax}', 1.8), 1 + public.cfg_num(v_val, '{growthWeight}', 1) * v_growth))
        * v_macro
        * coalesce(v_event, 1)
        * 100;                                                                        -- cents -> e4
  return greatest(public.config_double('trading', '{minPriceE4}', 1)::bigint, round(v_fv)::bigint);
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Helpers
-- ---------------------------------------------------------------------------
-- Game quarter by running index (0 = first quarter of game year 1), NULL row if it does not exist.
create or replace function public.game_quarter_by_index(p_index integer)
returns public.game_quarters
language sql
stable
security definer
set search_path = ''
as $$
  select gq.* from public.game_quarters gq
   where p_index >= 0 and gq.game_year = p_index / 4 + 1 and gq.quarter = p_index % 4 + 1;
$$;
comment on function public.game_quarter_by_index(integer) is
  'Internal (ADR-090): game quarter by running index (game_year - 1) * 4 + quarter - 1.';

-- Money supply sample (MoneySupplySample in src/lib/sim/central-bank.ts): all player and player-company
-- accounts (cash and reserve; AI companies are not part of the money supply), players with a daily login
-- in the last centralBank.activePlayerWindowDays days.
create or replace function public.events_money_sample(p_now timestamptz, out money_supply_cents bigint, out active_players integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(1, public.config_double('centralBank', '{activePlayerWindowDays}', 7))::integer;
begin
  select coalesce(sum(a.balance_cents), 0)::bigint into money_supply_cents
    from public.ledger_accounts a
    left join public.companies c on c.id = a.owner_company_id
   where a.kind in ('player_cash', 'player_reserve')
      or (a.kind in ('company_cash', 'company_reserve') and c.id is not null and not c.is_ai);
  select count(distinct dl.player_id)::integer into active_players
    from public.daily_logins dl
    join public.profiles p on p.id = dl.player_id
   where dl.login_day > (p_now at time zone 'Europe/Berlin')::date - v_days
     and dl.login_day <= (p_now at time zone 'Europe/Berlin')::date
     and not p.is_deactivated;
end;
$$;
comment on function public.events_money_sample(timestamptz) is
  'Internal (ADR-090): money supply of players and player companies, active players (central bank input).';

-- Snapshot of the money supply for the latest ended quarter (once per quarter; no backfill after a downtime).
create or replace function public.events_snapshot_money(p_now timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q      bigint;
  v_player bigint;
  v_comp   bigint;
  v_sample record;
  v_rows   integer;
begin
  select gq.id into v_q from public.game_quarters gq where gq.ends_at <= p_now order by gq.ends_at desc limit 1;
  if v_q is null or exists (select 1 from public.money_supply_snapshots m where m.game_quarter_id = v_q) then
    return null;
  end if;
  select coalesce(sum(a.balance_cents), 0)::bigint into v_player
    from public.ledger_accounts a where a.kind in ('player_cash', 'player_reserve');
  select * into v_sample from public.events_money_sample(p_now);
  v_comp := v_sample.money_supply_cents - v_player;
  insert into public.money_supply_snapshots (game_quarter_id, player_cents, company_cents, active_players)
  values (v_q, v_player, v_comp, v_sample.active_players)
  on conflict (game_quarter_id) do nothing;
  get diagnostics v_rows = row_count;
  return case when v_rows > 0 then v_q end;
end;
$$;
comment on function public.events_snapshot_money(timestamptz) is
  'Internal (ADR-090): money_supply_snapshots row of the latest ended quarter (players, player companies, active players).';

-- In-app notification, unless the player switched the type off (missing preference: the type's default)
create or replace function public.event_notify(p_player uuid, p_title text, p_body text, p_payload jsonb, p_link text, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.notification_types t where t.key = 'event_holding') then
    return;
  end if;
  if not coalesce((select np.in_app_enabled from public.notification_preferences np
                    where np.player_id = p_player and np.type_key = 'event_holding'),
                  (select t.default_in_app from public.notification_types t where t.key = 'event_holding'), true) then
    return;
  end if;
  insert into public.notifications (player_id, type_key, title, body, payload, link, dedupe_key)
  values (p_player, 'event_holding', p_title, p_body, coalesce(p_payload, '{}'::jsonb), p_link, p_dedupe)
  on conflict (player_id, dedupe_key) do nothing;
end;
$$;
comment on function public.event_notify(uuid, text, text, jsonb, text, text) is
  'Internal (ADR-090): event_holding notification, respecting the player''s preference.';

-- Persistent price shock of one stock by (10 000 + p_move_bps) / 10 000: quote, fair value, event factor and
-- EMAs move together (no momentum signal, no value-fund reversion), plus a price tick and the candles.
create or replace function public.event_price_shock(p_security uuid, p_move_bps integer, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch   constant timestamptz := '2000-01-01 00:00:00+00';
  v_min     bigint := greatest(1, public.config_double('trading', '{minPriceE4}', 1))::bigint;
  v_mult    numeric := greatest(1, 10000 + p_move_bps)::numeric;   -- MIN_EVENT_FACTOR 0.01 at -9 900 bps
  v_factor  double precision := greatest(1, 10000 + p_move_bps)::double precision / 10000;
  q         public.security_quotes;
  v_shares  bigint;
  v_before  bigint;
  v_after   bigint;
  v_bid     bigint;
  v_ask     bigint;
  v_ref     bigint;
  v_seq     bigint;
begin
  -- same lock order as market_tick_at: sim state first, then the quote
  update public.security_sim_state st
     set fair_value_e4 = greatest(v_min, public.div_round_half_even(st.fair_value_e4::numeric * v_mult, 10000)),
         event_value_factor = st.event_value_factor * v_factor,
         ema_fast = case when st.ema_fast is null then null else st.ema_fast * v_factor end,
         ema_slow = case when st.ema_slow is null then null else st.ema_slow * v_factor end,
         updated_at = now()
   where st.security_id = p_security;
  select * into q from public.security_quotes where security_id = p_security for update;
  if not found then
    return null;
  end if;
  select c.shares_outstanding into v_shares
    from public.securities s left join public.companies c on c.id = s.company_id where s.id = p_security;
  v_before := q.last_price_e4;
  v_after := greatest(v_min, public.div_round_half_even(v_before::numeric * v_mult, 10000));
  v_bid := greatest(v_min, public.div_round_half_even(coalesce(q.bid_e4, v_before)::numeric * v_mult, 10000));
  v_ask := public.div_round_half_even(coalesce(q.ask_e4, v_before)::numeric * v_mult, 10000);
  if v_ask <= v_bid then
    v_ask := v_bid + 1;
  end if;
  v_ref := coalesce(q.prev_close_e4, v_before);
  update public.security_quotes
     set last_price_e4 = v_after, bid_e4 = v_bid, ask_e4 = v_ask,
         day_high_e4 = greatest(coalesce(day_high_e4, v_after), v_after),
         day_low_e4 = least(coalesce(day_low_e4, v_after), v_after),
         change_bps = greatest(-1000000, least(1000000, round((v_after - v_ref) * 10000.0 / greatest(1, v_ref))))::integer,
         market_cap_cents = case when v_shares is null then market_cap_cents
                                 else public.div_round_half_even(v_shares::numeric * v_after, 100) end,
         updated_at = p_now
   where security_id = p_security;

  select r.tick_seq into v_seq from public.sim_runtime r where r.id;
  insert into public.price_ticks (security_id, ts, tick_seq, price_e4, volume_e6)
  values (p_security, p_now, coalesce(v_seq, 0), v_after, 0)
  on conflict do nothing;
  insert into public.candles as c (security_id, interval, bucket_start, open_e4, high_e4, low_e4, close_e4, volume_e6, tick_count)
  select p_security, iv.i, iv.b, v_before, greatest(v_before, v_after), least(v_before, v_after), v_after, 0, 1
    from (values
      ('1m'::public.candle_interval, date_bin('1 minute', p_now, v_epoch)),
      ('5m'::public.candle_interval, date_bin('5 minutes', p_now, v_epoch)),
      ('1h'::public.candle_interval, date_bin('1 hour', p_now, v_epoch)),
      ('1q'::public.candle_interval, public.quarter_bucket_start(p_now)),
      ('1y'::public.candle_interval, public.game_year_bucket_start(p_now))) as iv(i, b)
  on conflict (security_id, interval, bucket_start) do update
     set high_e4 = greatest(c.high_e4, excluded.high_e4),
         low_e4 = least(c.low_e4, excluded.low_e4),
         close_e4 = excluded.close_e4,
         tick_count = c.tick_count + 1;
  return jsonb_build_object('price_before_e4', v_before, 'price_after_e4', v_after);
end;
$$;
comment on function public.event_price_shock(uuid, integer, timestamptz) is
  'Internal (ADR-090): persistent price shock; quote, fair value, event factor and EMAs move by the same factor.';

-- ---------------------------------------------------------------------------
-- D. Planning (idempotent; p_now is the game time, tests pin it)
-- ---------------------------------------------------------------------------
create or replace function public.events_plan(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev       jsonb := coalesce(public.config_jsonb('events'), '{}'::jsonb);
  v_cb       jsonb := coalesce(public.config_jsonb('centralBank'), '{}'::jsonb);
  v_time     jsonb := coalesce(public.config_jsonb('time'), '{}'::jsonb);
  v_horizon  timestamptz := p_now + make_interval(secs => greatest(0, public.cfg_num(v_ev, '{schedule,horizonHours}', 24)) * 3600);
  v_top      integer := greatest(0, public.cfg_num(v_ev, '{schedule,earningsTopCompanies}', 3))::integer;
  v_open_h   double precision := public.cfg_num(v_time, '{marketOpenHour}', 8);
  v_close_h  double precision := public.cfg_num(v_time, '{marketCloseHour}', 22);
  v_p_trial  double precision := public.cfg_num(v_ev, '{pharmaTrial,probabilityPerQuarter}', 0.12);
  v_lead     integer := greatest(0, public.cfg_num(v_ev, '{pharmaTrial,announceLeadQuarters}', 2))::integer;
  v_warmup   integer := public.cfg_num(v_cb, '{warmupQuarters}', 56)::integer;
  v_every    integer := greatest(1, public.cfg_num(v_cb, '{decisionEveryQuarters}', 2))::integer;
  v_cb_lead  integer := greatest(0, public.cfg_num(v_cb, '{announceLeadQuarters}', 1))::integer;
  v_day      date;
  v_at       timestamptz;
  v_bells    integer := 0;
  v_earn     integer := 0;
  v_trials   integer := 0;
  v_rates    integer := 0;
  v_rows     integer;
  v_id       uuid;
  v_cur      public.game_quarters;
  v_target   public.game_quarters;
  v_ann      public.game_quarters;
  v_idx      integer;
  v_run      bigint;
  q          record;
  r          record;
begin
  -- 1. bells (Berlin wall clock, every day)
  for v_day in
    select d::date from generate_series((p_now at time zone 'Europe/Berlin')::date::timestamp,
                                        (v_horizon at time zone 'Europe/Berlin')::date::timestamp, interval '1 day') d
  loop
    for r in select * from (values ('opening_bell'::public.scheduled_event_kind, v_open_h, 'Börsenöffnung'),
                                   ('closing_bell'::public.scheduled_event_kind, v_close_h, 'Börsenschluss')) b(kind, hour, title)
    loop
      v_at := (v_day::timestamp + make_interval(secs => r.hour * 3600)) at time zone 'Europe/Berlin';
      if v_at > p_now and v_at <= v_horizon then
        insert into public.scheduled_events (kind, title, importance, game_quarter_id, dedupe_key, announced_at, scheduled_at)
        values (r.kind, r.title, 1,
                (select gq.id from public.game_quarters gq where gq.starts_at <= v_at and gq.ends_at > v_at),
                r.kind::text || ':' || to_char(v_day, 'YYYY-MM-DD'), p_now, v_at)
        on conflict (dedupe_key) do nothing;
        get diagnostics v_rows = row_count;
        v_bells := v_bells + v_rows;
      end if;
    end loop;
  end loop;

  -- 2. earnings: the largest AI companies by market cap, once per quarter
  for q in
    select gq.* from public.game_quarters gq
     where gq.ends_at > p_now and gq.ends_at <= v_horizon
       and not exists (select 1 from public.scheduled_events e where e.kind = 'earnings' and e.game_quarter_id = gq.id)
     order by gq.ends_at
  loop
    insert into public.scheduled_events (kind, title, importance, company_id, security_id, sector_key, game_quarter_id,
                                         dedupe_key, announced_at, scheduled_at)
    select 'earnings', 'Quartalszahlen ' || x.name, 2, x.id, x.security_id, x.sector_key, q.id,
           'earnings:' || q.id || ':' || x.id, p_now, q.ends_at
      from (select c.id, c.name, c.security_id, c.sector_key
              from public.companies c
              join public.securities s on s.id = c.security_id
              join public.security_quotes sq on sq.security_id = c.security_id
             where c.is_ai and c.phase = 'listed' and s.status = 'listed'
             order by sq.market_cap_cents desc nulls last, c.ticker
             limit v_top) x
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    v_earn := v_earn + v_rows;
  end loop;

  -- 3. pharma trials: one roll per pharma AI company and running quarter (rollPharmaTrialAnnouncement)
  select gq.* into v_cur from public.game_quarters gq where gq.starts_at <= p_now and gq.ends_at > p_now;
  if v_cur.id is not null then
    insert into public.job_runs (job_name, run_key, status, finished_at)
    values ('events_pharma_roll', v_cur.id::text, 'succeeded', now())
    on conflict (job_name, run_key) do nothing
    returning id into v_run;
    if v_run is not null then
      v_target := public.game_quarter_by_index((v_cur.game_year - 1) * 4 + v_cur.quarter - 1 + v_lead);
      if v_target.id is not null then
        v_at := v_target.starts_at + (v_target.ends_at - v_target.starts_at) / 2;
        for r in
          select c.id, c.name, c.security_id, c.sector_key, c.tier::text as tier
            from public.companies c join public.securities s on s.id = c.security_id
           where c.is_ai and c.phase = 'listed' and s.status = 'listed' and c.sector_key = 'pharma'
             and not exists (select 1 from public.scheduled_events e
                              where e.kind = 'pharma_trial' and e.company_id = c.id and e.status in ('scheduled', 'in_progress'))
           order by c.ticker
        loop
          if v_at > p_now and v_at <= v_horizon and random() < v_p_trial then
            v_id := null;
            insert into public.scheduled_events (kind, title, importance, company_id, security_id, sector_key, game_quarter_id,
                                                 dedupe_key, announced_at, scheduled_at)
            values ('pharma_trial', 'Studienergebnis ' || r.name, 3, r.id, r.security_id, r.sector_key, v_target.id,
                    'pharma_trial:' || r.id || ':' || v_target.id, p_now, v_at)
            on conflict (dedupe_key) do nothing
            returning id into v_id;
            if v_id is not null then
              insert into public.scheduled_event_secrets (event_id, params)
              values (v_id, jsonb_build_object('success_probability',
                        public.cfg_num(v_ev, array['pharmaTrial', 'successProbability', r.tier], 0.5)));
              v_trials := v_trials + 1;
            end if;
          end if;
        end loop;
      end if;
    end if;
  end if;

  -- 4. rate decisions (isRateDecisionQuarter, rateDecisionAnnouncementQuarter)
  for q in
    select gq.*, (gq.game_year - 1) * 4 + gq.quarter - 1 as idx from public.game_quarters gq
     where gq.ends_at > p_now and gq.ends_at <= v_horizon
     order by gq.ends_at
  loop
    v_idx := q.idx;
    if v_idx < v_warmup or v_idx % v_every <> v_every - 1 then
      continue;
    end if;
    if v_cb_lead > 0 then
      v_ann := public.game_quarter_by_index(v_idx - v_cb_lead);
      if v_ann.id is null or v_ann.ends_at > p_now then
        continue;
      end if;
    end if;
    insert into public.scheduled_events (kind, title, importance, game_quarter_id, dedupe_key, announced_at, scheduled_at)
    values ('rate_decision', 'Zinsentscheid der Zentralbank', 3, q.id, 'rate_decision:' || q.id, p_now, q.ends_at)
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_rates := v_rates + 1;
      update public.central_bank_state set next_decision_at = q.ends_at, updated_at = now() where id;
    end if;
  end loop;

  return jsonb_build_object('bells', v_bells, 'earnings', v_earn, 'pharma_trials', v_trials, 'rate_decisions', v_rates);
end;
$$;
comment on function public.events_plan(timestamptz) is
  'Internal (ADR-090): plans bells, earnings, pharma trials and rate decisions up to events.schedule.horizonHours ahead (idempotent).';

-- ---------------------------------------------------------------------------
-- E. Resolution
-- ---------------------------------------------------------------------------
-- Rate decision (decidePolicyRate, moneyGrowthBps, annualizeGrowthBps in src/lib/sim/central-bank.ts).
create or replace function public.event_rate_decision(p_quarter_id bigint, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cb      jsonb := coalesce(public.config_jsonb('centralBank'), '{}'::jsonb);
  v_window  integer := public.cfg_num(v_cb, '{measurementWindowQuarters}', 4)::integer;
  v_qpy     double precision := greatest(1, public.config_double('time', '{quartersPerGameYear}', 4));
  v_neutral integer := public.cfg_num(v_cb, '{neutralRateBps}', 300)::integer;
  v_step    integer := public.cfg_num(v_cb, '{stepBps}', 25)::integer;
  v_maxst   integer := public.cfg_num(v_cb, '{maxStepsPerDecision}', 2)::integer;
  v_band    double precision := greatest(1, public.cfg_num(v_cb, '{toleranceBandBps}', 400));
  v_tgt     integer := public.cfg_num(v_cb, '{targetMoneyGrowthBps}', 800)::integer;
  v_minr    integer := public.cfg_num(v_cb, '{minRateBps}', 50)::integer;
  v_maxr    integer := public.cfg_num(v_cb, '{maxRateBps}', 1000)::integer;
  v_sent25  double precision := public.config_double('events', '{rateDecisionSentimentPer25Bps}', -0.1);
  q         public.game_quarters;
  v_prevq   public.game_quarters;
  v_prev    public.money_supply_snapshots;
  v_cur     record;
  v_old     integer;
  v_growth  integer;
  v_annual  integer;
  v_gap     integer;
  v_steps   integer;
  v_target  integer;
  v_towards integer;
  v_drift   integer;
  v_new     integer;
  v_factor  double precision;
begin
  select * into q from public.game_quarters where id = p_quarter_id;
  select cb.policy_rate_bps into v_old from public.central_bank_state cb where cb.id for update;
  v_old := coalesce(v_old, public.cfg_num(v_cb, '{startRateBps}', 300)::integer);

  -- money growth per active player over the measurement window; without a comparable snapshot (new database,
  -- downtime) there is no measurement and the bank holds the rate
  select * into v_cur from public.events_money_sample(p_now);
  if q.id is not null and v_window > 0 then
    v_prevq := public.game_quarter_by_index((q.game_year - 1) * 4 + q.quarter - 1 - v_window);
    if v_prevq.id is not null then
      select * into v_prev from public.money_supply_snapshots m where m.game_quarter_id = v_prevq.id;
    end if;
  end if;
  if v_prev.game_quarter_id is not null and v_prev.player_cents + v_prev.company_cents > 0
     and coalesce(v_prev.active_players, 0) > 0 and v_cur.active_players > 0 then
    -- Math.round: half up
    v_growth := floor(((v_cur.money_supply_cents::double precision / v_cur.active_players)
                       / ((v_prev.player_cents + v_prev.company_cents)::double precision / v_prev.active_players) - 1) * 10000 + 0.5);
    v_factor := greatest(0, 1 + v_growth / 10000.0);
    v_annual := floor((power(v_factor, v_qpy / v_window) - 1) * 10000 + 0.5);
  end if;

  if v_annual is null then
    v_new := v_old;
  else
    v_gap := v_annual - v_tgt;
    v_steps := trunc(v_gap / v_band)::integer;
    v_steps := least(v_maxst, greatest(-v_maxst, v_steps));
    v_target := v_old + v_steps * v_step;
    if v_steps = 0 and v_old <> v_neutral then
      v_towards := sign(v_neutral - v_old)::integer * v_step;
      v_drift := v_old + v_towards;
      -- do not overshoot the neutral rate
      v_target := case when sign(v_neutral - v_drift) = -sign(v_towards) then v_neutral else v_drift end;
    end if;
    v_new := least(v_maxr, greatest(v_minr, v_target));
  end if;

  update public.central_bank_state
     set policy_rate_bps = v_new, last_decision_at = p_now, next_decision_at = null, updated_at = now()
   where id;
  insert into public.central_bank_decisions (game_quarter_id, previous_rate_bps, new_rate_bps, money_supply_cents, statement, decided_at)
  values (q.id, v_old, v_new, v_cur.money_supply_cents,
          case when v_new > v_old then 'Die Zentralbank erhöht den Leitzins.'
               when v_new < v_old then 'Die Zentralbank senkt den Leitzins.'
               else 'Die Zentralbank lässt den Leitzins unverändert.' end, p_now);
  if v_new <> v_old then
    -- sentiment shock on every listed stock (spec 16), fair values with the new macro factor
    update public.security_sim_state st
       set sentiment = greatest(-1, least(1, st.sentiment + (v_new - v_old) / 25.0 * v_sent25))
      from public.securities s
     where s.id = st.security_id and s.kind = 'stock' and s.status = 'listed';
    perform public.recompute_fair_values();
  end if;
  return jsonb_build_object('old_bps', v_old, 'new_bps', v_new, 'money_growth_bps', v_annual);
end;
$$;
comment on function public.event_rate_decision(bigint, timestamptz) is
  'Internal (ADR-090): decidePolicyRate on the per-capita money growth; updates central_bank_state.';

-- Resolves every due event (oldest first, at most 200 per call). Earnings wait for their quarter close.
create or replace function public.events_resolve_due(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev       jsonb := coalesce(public.config_jsonb('events'), '{}'::jsonb);
  v_min_mv   double precision := public.cfg_num(v_ev, '{pharmaTrial,minMove}', 0.5);
  v_max_mv   double precision := public.cfg_num(v_ev, '{pharmaTrial,maxMove}', 0.7);
  v_per_surp double precision := greatest(1e-9, public.cfg_num(v_ev, '{earnings,sentimentPerSurprise}', 3));
  e          record;
  v_out      jsonb;
  v_status   public.scheduled_event_status;
  v_q        public.game_quarters;
  v_rep      record;
  v_prev     record;
  v_shock    double precision;
  v_p        double precision;
  v_success  boolean;
  v_move     integer;
  v_price    jsonb;
  v_pct      text;
  h          record;
  v_done     integer := 0;
  v_waiting  integer := 0;
  v_cancel   integer := 0;
begin
  for e in
    select se.*, c.name as company_name, c.phase as company_phase, s.ticker, s.status as security_status
      from public.scheduled_events se
      left join public.companies c on c.id = se.company_id
      left join public.securities s on s.id = se.security_id
     where se.status in ('scheduled', 'in_progress') and se.scheduled_at <= p_now
     order by se.scheduled_at, se.id
     limit 200
       for update of se skip locked
  loop
    v_out := null;
    v_status := 'resolved';

    if e.kind in ('opening_bell', 'closing_bell') then
      -- informational; a bell missed by more than an hour (downtime) is dropped
      if p_now - e.scheduled_at > interval '1 hour' then
        v_status := 'cancelled';
      else
        v_out := '{}'::jsonb;
      end if;

    elsif e.kind = 'earnings' then
      select * into v_q from public.game_quarters where id = e.game_quarter_id;
      if v_q.id is not null and v_q.status <> 'closed' then
        v_waiting := v_waiting + 1;
        continue;
      end if;
      select r.revenue_cents, r.net_income_cents, r.eps_e4 into v_rep
        from public.company_quarter_reports r where r.company_id = e.company_id and r.game_quarter_id = e.game_quarter_id;
      if v_rep is null or v_rep.revenue_cents is null then
        v_status := 'cancelled';
      else
        select r.revenue_cents, r.net_income_cents into v_prev
          from public.company_quarter_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
         where r.company_id = e.company_id and gq.starts_at < v_q.starts_at
         order by gq.starts_at desc limit 1;
        -- the surprise behind the sentiment shock of simulate_ai_companies (its news effect)
        select ef.sentiment into v_shock
          from public.news_items n join public.news_item_effects ef on ef.news_item_id = n.id
         where n.company_id = e.company_id and n.game_quarter_id = e.game_quarter_id and n.category = 'earnings'
         order by n.id desc limit 1;
        v_out := jsonb_build_object(
          'revenue_cents', v_rep.revenue_cents, 'net_income_cents', v_rep.net_income_cents, 'eps_e4', v_rep.eps_e4,
          'revenue_change_bps', case when coalesce(v_prev.revenue_cents, 0) <> 0
                                     then round((v_rep.revenue_cents - v_prev.revenue_cents) * 10000.0 / abs(v_prev.revenue_cents))::bigint end,
          'net_income_change_bps', case when coalesce(v_prev.net_income_cents, 0) <> 0
                                        then round((v_rep.net_income_cents - v_prev.net_income_cents) * 10000.0
                                                   / abs(v_prev.net_income_cents))::bigint end,
          'surprise', case when coalesce(v_shock, 0) / v_per_surp > 0.05 then 'beat'
                           when coalesce(v_shock, 0) / v_per_surp < -0.05 then 'miss'
                           else 'inline' end);
      end if;

    elsif e.kind = 'pharma_trial' then
      if e.security_id is null or e.security_status is distinct from 'listed' then
        v_status := 'cancelled';
      else
        -- resolvePharmaTrial: success with the hidden probability, move uniform in [minMove, maxMove]
        select (sec.params ->> 'success_probability')::double precision into v_p
          from public.scheduled_event_secrets sec where sec.event_id = e.id;
        v_success := random() < coalesce(v_p, 0.5);
        v_move := round((v_min_mv + random() * (v_max_mv - v_min_mv)) * 10000)::integer;
        v_move := case when v_success then v_move else -v_move end;
        v_price := public.event_price_shock(e.security_id, v_move, p_now);
        v_out := jsonb_build_object('success', v_success, 'move_bps', v_move) || coalesce(v_price, '{}'::jsonb);
        v_pct := replace(to_char(abs(v_move) / 100.0, 'FM990.0'), '.', ',') || ' %';
        for h in
          select distinct p.player_id from public.positions p
           where p.security_id = e.security_id and p.status = 'open' and p.quantity_e6 > 0
        loop
          perform public.event_notify(
            h.player_id,
            case when v_success then 'Studie erfolgreich: ' else 'Studie gescheitert: ' end || e.company_name,
            e.ticker || case when v_success then ' steigt um ' else ' fällt um ' end || v_pct || '.',
            jsonb_build_object('event_id', e.id, 'kind', 'pharma_trial', 'ticker', e.ticker, 'success', v_success,
                               'move_bps', v_move),
            '/markets/' || e.ticker,
            'event:' || e.id);
        end loop;
      end if;

    elsif e.kind = 'rate_decision' then
      v_out := public.event_rate_decision(e.game_quarter_id, p_now);

    else
      v_out := '{}'::jsonb;
    end if;

    update public.scheduled_events
       set status = v_status, resolved_at = p_now, outcome = case when v_status = 'resolved' then v_out end, updated_at = now()
     where id = e.id;
    if v_status = 'resolved' then
      v_done := v_done + 1;
    else
      v_cancel := v_cancel + 1;
    end if;
  end loop;
  return jsonb_build_object('resolved', v_done, 'cancelled', v_cancel, 'waiting', v_waiting);
end;
$$;
comment on function public.events_resolve_due(timestamptz) is
  'Internal (ADR-090): resolves all due events once (late ones after a downtime too); earnings wait for the quarter close.';

-- Minute job part (called by run_due_jobs): planning every 15 minutes, resolution and money snapshot every call.
create or replace function public.events_run_due()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now    timestamptz := public.game_now();
  v_run    bigint;
  v_result jsonb := '{}'::jsonb;
  v_snap   bigint;
begin
  insert into public.job_runs (job_name, run_key, status, finished_at)
  values ('events_plan', to_char(date_bin('15 minutes', v_now, '2000-01-01 00:00:00+00'::timestamptz) at time zone 'UTC',
                                 'YYYY-MM-DD"T"HH24:MI'), 'succeeded', now())
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is not null then
    v_result := v_result || jsonb_build_object('planned', public.events_plan(v_now));
    delete from public.job_runs j
     where (j.job_name = 'events_plan' and j.started_at < now() - interval '1 day')
        or (j.job_name = 'events_pharma_roll' and j.started_at < now() - interval '30 days');
  end if;
  v_snap := public.events_snapshot_money(v_now);
  if v_snap is not null then
    v_result := v_result || jsonb_build_object('money_snapshot', v_snap);
  end if;
  if exists (select 1 from public.scheduled_events e where e.status in ('scheduled', 'in_progress') and e.scheduled_at <= v_now) then
    v_result := v_result || jsonb_build_object('resolved', public.events_resolve_due(v_now));
  end if;
  return v_result;
end;
$$;
comment on function public.events_run_due() is
  'Internal (run_due_jobs, ADR-090): plans events every 15 minutes, resolves due events, money supply snapshot per quarter.';

-- ---------------------------------------------------------------------------
-- F. RPC get_events
-- ---------------------------------------------------------------------------
create or replace function public.get_events(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now    timestamptz := public.game_now();
  v_limit  integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_recent interval := make_interval(secs => greatest(0, public.config_double('events', '{schedule,recentHours}', 24)) * 3600);
begin
  perform public.require_player();
  return jsonb_build_object(
    'server_time', v_now,
    'upcoming', coalesce((
      select jsonb_agg(x.j order by x.scheduled_at, x.id)
        from (select e.id, e.scheduled_at,
                     jsonb_build_object('id', e.id, 'kind', e.kind, 'importance', e.importance, 'scheduled_at', e.scheduled_at,
                                        'announced_at', e.announced_at, 'status', e.status, 'ticker', s.ticker,
                                        'company_name', c.name, 'sector', e.sector_key, 'outcome', null) as j
                from public.scheduled_events e
                left join public.companies c on c.id = e.company_id
                left join public.securities s on s.id = e.security_id
               where e.status in ('scheduled', 'in_progress')
               order by e.scheduled_at, e.id
               limit v_limit) x), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x.j order by x.resolved_at desc, x.scheduled_at desc, x.id)
        from (select e.id, e.scheduled_at, e.resolved_at,
                     jsonb_build_object('id', e.id, 'kind', e.kind, 'importance', e.importance, 'scheduled_at', e.scheduled_at,
                                        'announced_at', e.announced_at, 'status', e.status, 'ticker', s.ticker,
                                        'company_name', c.name, 'sector', e.sector_key, 'outcome', e.outcome) as j
                from public.scheduled_events e
                left join public.companies c on c.id = e.company_id
                left join public.securities s on s.id = e.security_id
               where e.status = 'resolved' and e.resolved_at > v_now - v_recent
               order by e.resolved_at desc, e.scheduled_at desc, e.id
               limit v_limit) x), '[]'::jsonb));
end;
$$;
comment on function public.get_events(integer) is
  'RPC (ADR-090): {server_time, upcoming, recent}; EVENT = {id, kind, importance, scheduled_at, announced_at, status, ticker, company_name, sector, outcome}.';

-- ---------------------------------------------------------------------------
-- G. run_due_jobs: call events_run_due() before the daily maintenance
-- ---------------------------------------------------------------------------
-- Injected into the current definition instead of redefining the whole function, so that other
-- additions to run_due_jobs() (migrations of the same milestone) are kept. Idempotent; fails loudly if
-- the anchor line is missing.
do $$
declare
  v_def    text;
  v_anchor constant text := '  -- daily maintenance (first run per UTC day)';
begin
  v_def := pg_get_functiondef('public.run_due_jobs()'::regprocedure);
  if position('public.events_run_due()' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'NEXA M4g: anchor "%" not found in run_due_jobs()', v_anchor;
  end if;
  v_def := replace(v_def, v_anchor,
    '  -- announced events (ADR-090): planning, resolution of due events, money supply snapshot' || chr(10)
    || '  v_result := v_result || jsonb_build_object(''events'', public.events_run_due());' || chr(10) || chr(10)
    || v_anchor);
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- H. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.fair_value_from_fundamentals(uuid)', 'public.game_quarter_by_index(integer)',
    'public.events_money_sample(timestamptz)', 'public.events_snapshot_money(timestamptz)',
    'public.event_notify(uuid, text, text, jsonb, text, text)', 'public.event_price_shock(uuid, integer, timestamptz)',
    'public.events_plan(timestamptz)', 'public.event_rate_decision(bigint, timestamptz)',
    'public.events_resolve_due(timestamptz)', 'public.events_run_due()', 'public.get_events(integer)',
    'public.run_due_jobs()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.get_events(integer) to authenticated;
end;
$$;
