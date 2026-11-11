-- ===== idempotent copy of migrations/20261111000100_m1_foundation.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M1 · 0100 · Foundation: columns, numeric helpers, config readers,
--                    API errors, levels/XP, sign-up with a pre-filled vault
-- =============================================================================
-- M1 runs entirely inside Postgres (pg_cron + PL/pgSQL, see docs/DATA_MODEL.md
-- "Nachtrag: M1"). This file is written idempotently so that the identical
-- copy in supabase/updates/ can be pasted into an existing project any number
-- of times.
--
-- API error contract: every player RPC raises
--   raise exception using errcode = '<NX0xx>', message = '<key>'
-- through public.api_error(key). Codes:
--   NX001 insufficient_funds      NX004 rate_limited       NX006 forbidden
--   NX007 invalid_quantity / invalid_price / invalid_argument / invalid_interval
--   NX010 not_authenticated       NX011 unknown_security   NX012 not_tradable
--   NX013 insufficient_position   NX014 order_not_found    NX015 order_not_open
--   NX016 market_paused           NX017 nothing_to_claim   NX018 locked
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New columns and enum values
-- ---------------------------------------------------------------------------
alter table public.security_sim_state
  add column if not exists ema_fast        double precision,
  add column if not exists ema_slow        double precision,
  add column if not exists maker_inventory double precision not null default 0,
  add column if not exists price_deviation double precision not null default 0;
comment on column public.security_sim_state.ema_fast is 'Fast EMA of the price (about 30 s), momentum signal.';
comment on column public.security_sim_state.ema_slow is 'Slow EMA of the price (about 5 min), momentum signal.';
comment on column public.security_sim_state.maker_inventory is 'Market maker inventory in shares taken from player flow; hedged into the market over time.';
comment on column public.security_sim_state.price_deviation is 'Bonds: log deviation of the price from the yield-implied price (AR(1) noise plus player flow).';

alter table public.player_private
  add column if not exists tutorial_completed_at timestamptz,
  add column if not exists tax_loss_pot_cents    bigint not null default 0 check (tax_loss_pot_cents >= 0);
comment on column public.player_private.tutorial_completed_at is 'Set once by complete_tutorial(); grants the tutorial XP exactly once.';
comment on column public.player_private.tax_loss_pot_cents is 'Capital gains loss pot (Verlusttopf): realised losses not yet offset against gains. Never refunded.';

alter type public.xp_source add value if not exists 'tutorial';

-- ---------------------------------------------------------------------------
-- 2. Numeric helpers (ADR-003: money is rounded once, half to even)
-- ---------------------------------------------------------------------------
create or replace function public.div_round_half_even(p_num numeric, p_den numeric)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_q numeric;
  v_r numeric;
begin
  if p_den is null or p_den = 0 or p_num is null then
    return null;
  end if;
  v_q := trunc(p_num / p_den);
  v_r := abs(p_num - v_q * p_den) * 2;
  if v_r > abs(p_den) or (v_r = abs(p_den) and mod(v_q, 2) <> 0) then
    v_q := v_q + sign(p_num) * sign(p_den);
  end if;
  return v_q::bigint;
end;
$$;
comment on function public.div_round_half_even(numeric, numeric) is 'Integer division rounded half to even (banker''s rounding), mirrors divRoundHalfEven() in src/lib/sim/money.ts.';

create or replace function public.order_value_cents(p_quantity bigint, p_price_e4 bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select public.div_round_half_even(p_quantity::numeric * p_price_e4, 100);
$$;
comment on function public.order_value_cents(bigint, bigint) is 'ADR-003: round_half_even(quantity x price_e4 / 100) in cents. The only place where a price turns into money.';

create or replace function public.apply_bps(p_amount bigint, p_bps numeric)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select public.div_round_half_even(p_amount::numeric * p_bps, 10000);
$$;

-- Standard normal random number (Box-Muller). SQL may use random(); the
-- deterministic reference stays the TypeScript simulation.
create or replace function public.gauss_random()
returns double precision
language sql
volatile
set search_path = ''
as $$
  select sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random());
$$;

-- Number inside an already loaded config document with a fallback.
create or replace function public.cfg_num(p_doc jsonb, p_path text[], p_fallback double precision)
returns double precision
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := p_doc #> p_path;
  if v is null or jsonb_typeof(v) <> 'number' then
    return p_fallback;
  end if;
  return (v #>> '{}')::double precision;
end;
$$;

create or replace function public.config_double(p_key text, p_path text[], p_fallback double precision)
returns double precision
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.cfg_num(public.config_jsonb(p_key), p_path, p_fallback);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. API errors and caller identity
-- ---------------------------------------------------------------------------
create or replace function public.api_error(p_key text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
begin
  v_code := case p_key
    when 'insufficient_funds'    then 'NX001'
    when 'rate_limited'          then 'NX004'
    when 'forbidden'             then 'NX006'
    when 'invalid_quantity'      then 'NX007'
    when 'invalid_price'         then 'NX007'
    when 'invalid_argument'      then 'NX007'
    when 'invalid_interval'      then 'NX007'
    when 'not_authenticated'     then 'NX010'
    when 'unknown_security'      then 'NX011'
    when 'not_tradable'          then 'NX012'
    when 'insufficient_position' then 'NX013'
    when 'order_not_found'       then 'NX014'
    when 'order_not_open'        then 'NX015'
    when 'market_paused'         then 'NX016'
    when 'nothing_to_claim'      then 'NX017'
    when 'locked'                then 'NX018'
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;
comment on function public.api_error(text) is 'Raises the API error <key> with its NX SQLSTATE. The client shows a text per key (error.message).';

create or replace function public.require_player()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid) then
    perform public.api_error('not_authenticated');
  end if;
  return v_uid;
end;
$$;

-- Admin guard for the admin_* RPCs.
create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform public.api_error('not_authenticated');
  end if;
  if not public.is_admin() then
    perform public.api_error('forbidden');
  end if;
  return (select auth.uid());
end;
$$;

-- Resolves a ticker (securities.ticker) or an index key (indices.key, e.g. NEXA30).
create or replace function public.resolve_security(p_ticker text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t  text := upper(btrim(coalesce(p_ticker, '')));
  v_id uuid;
begin
  select s.id into v_id from public.securities s where s.ticker = v_t;
  if v_id is null then
    select i.security_id into v_id from public.indices i where upper(i.key) = v_t;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Game clock helpers (Europe/Berlin wall clock, ADR-006)
-- ---------------------------------------------------------------------------
-- Session: regular between time.marketOpenHour and time.marketCloseHour, else after_hours.
create or replace function public.market_session_at(p_at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_time  jsonb := coalesce(public.config_jsonb('time'), '{}'::jsonb);
  v_local timestamp := p_at at time zone 'Europe/Berlin';
  v_hour  double precision := extract(hour from v_local) + extract(minute from v_local) / 60.0;
begin
  if v_hour >= public.cfg_num(v_time, '{marketOpenHour}', 8)
     and v_hour < public.cfg_num(v_time, '{marketCloseHour}', 22) then
    return 'regular';
  end if;
  return 'after_hours';
end;
$$;

-- Start of the trading day: the most recent closing bell (22:00 Berlin) at or before p_at.
create or replace function public.trading_day_start(p_at timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_close double precision := public.config_double('time', '{marketCloseHour}', 22);
  v_off   interval := make_interval(secs => v_close * 3600);
begin
  return (((p_at at time zone 'Europe/Berlin') - v_off)::date + v_off) at time zone 'Europe/Berlin';
end;
$$;

-- Bucket start of the game quarter that contains p_at (08/14/20/02 Berlin, same rule as ensure_game_quarters).
create or replace function public.quarter_bucket_start(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((date_trunc('hour', l) - make_interval(hours => (extract(hour from l)::integer % 6))) + interval '2 hours')
         at time zone 'Europe/Berlin'
    from (select (p_at at time zone 'Europe/Berlin') - interval '2 hours' as l) x;
$$;

-- Bucket start of the game year (= game day, 08:00 Berlin) that contains p_at.
create or replace function public.game_year_bucket_start(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (((p_at at time zone 'Europe/Berlin') - interval '8 hours')::date + interval '8 hours') at time zone 'Europe/Berlin';
$$;

-- ---------------------------------------------------------------------------
-- 5. Levels, unlocks and XP (mirrors src/lib/sim/progression.ts)
-- ---------------------------------------------------------------------------
create or replace function public.level_progress(p_xp bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prog  jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_base  double precision := public.cfg_num(v_prog, '{xpBase}', 100);
  v_exp   double precision := public.cfg_num(v_prog, '{xpExponent}', 1.5);
  v_max   integer := public.cfg_num(v_prog, '{maxLevel}', 50)::integer;
  v_level integer := 1;
  v_rem   bigint := greatest(coalesce(p_xp, 0), 0);
  v_need  bigint;
begin
  loop
    if v_level >= v_max then
      return jsonb_build_object('level', v_level, 'xp_into_level', v_rem, 'xp_for_next', 0);
    end if;
    v_need := round(v_base * power(v_level, v_exp))::bigint;
    if v_rem < v_need then
      return jsonb_build_object('level', v_level, 'xp_into_level', v_rem, 'xp_for_next', v_need);
    end if;
    v_rem := v_rem - v_need;
    v_level := v_level + 1;
  end loop;
end;
$$;
comment on function public.level_progress(bigint) is 'Level, XP inside the level and XP needed for the next level for a total XP (curve from game_config progression).';

create or replace function public.level_for_xp(p_xp bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (public.level_progress(p_xp) ->> 'level')::integer;
$$;

-- Level at which a feature unlocks: game_config progression.unlocks, then the unlocks table, else 1.
create or replace function public.unlock_level(p_key text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_arr   jsonb := public.config_jsonb('progression', '{unlocks}');
  v_level integer;
begin
  if v_arr is not null and jsonb_typeof(v_arr) = 'array' then
    select min((u ->> 'level')::integer) into v_level
      from jsonb_array_elements(v_arr) u
     where u ->> 'key' = p_key and jsonb_typeof(u -> 'level') = 'number';
  end if;
  if v_level is null then
    select u.level into v_level from public.unlocks u where u.key = p_key;
  end if;
  return coalesce(v_level, 1);
end;
$$;

-- Grants XP once per dedupe key. Applies progression.xpMultiplier exactly
-- here (scaledXp), enforces the daily trade cap, keeps profiles.xp_total and
-- profiles.level in sync and grants the unlock rows of the new level.
-- Returns the XP credited (0 when capped or deduplicated).
create or replace function public.grant_xp(
  p_player     uuid,
  p_source     public.xp_source,
  p_base_xp    integer,
  p_dedupe_key text default null,
  p_ref_type   text default null,
  p_ref_id     uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prog   jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_mult   double precision := public.cfg_num(v_prog, '{xpMultiplier}', 2);
  v_day    date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_amount integer;
  v_cap    integer;
  v_count  integer;
  v_id     bigint;
  v_total  bigint;
  v_level  integer;
begin
  if p_player is null or p_base_xp is null or p_base_xp <= 0 then
    return 0;
  end if;
  v_amount := greatest(0, round(p_base_xp * v_mult))::integer;
  if v_amount <= 0 then
    return 0;
  end if;

  if p_source = 'trade' then
    v_cap := public.cfg_num(v_prog, '{xpSources,trade,maxTradesPerDay}', 30)::integer;
    select c.event_count into v_count
      from public.xp_daily_counters c
     where c.player_id = p_player and c.game_day = v_day and c.source = p_source
       for update;
    if coalesce(v_count, 0) >= v_cap then
      return 0;
    end if;
  end if;

  insert into public.xp_events (player_id, source, amount, multiplier_bps, ref_type, ref_id, dedupe_key, game_day)
  values (p_player, p_source, v_amount, round(v_mult * 10000)::integer, p_ref_type, p_ref_id, p_dedupe_key, v_day)
  on conflict (player_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    return 0;
  end if;

  insert into public.xp_daily_counters as c (player_id, game_day, source, event_count, xp_sum)
  values (p_player, v_day, p_source, 1, v_amount)
  on conflict (player_id, game_day, source)
  do update set event_count = c.event_count + 1, xp_sum = c.xp_sum + excluded.xp_sum;

  update public.profiles p set xp_total = p.xp_total + v_amount where p.id = p_player
  returning p.xp_total into v_total;
  v_level := public.level_for_xp(v_total);
  update public.profiles p set level = v_level where p.id = p_player and p.level <> v_level;
  update public.xp_events e set level_after = v_level where e.id = v_id;

  insert into public.player_unlocks (player_id, unlock_key)
  select p_player, u.key from public.unlocks u where u.level <= v_level
  on conflict do nothing;

  return v_amount;
end;
$$;
comment on function public.grant_xp(uuid, public.xp_source, integer, text, text, uuid) is 'Internal: credits XP (x progression.xpMultiplier) once per dedupe key, daily trade cap, level and unlocks. Returns the XP credited.';

-- ---------------------------------------------------------------------------
-- 6. Sign-up: same as migration 1300, plus a vault that already holds
--    economy.vaultInitialHours of basic income (the tutorial claims it).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta            jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code            text  := nullif(upper(btrim(coalesce(v_meta ->> 'invite_code', ''))), '');
  v_invite_required boolean := public.config_boolean('auth', '{inviteRequired}', true);
  v_age_required    boolean := public.config_boolean('auth', '{ageConfirmationRequired}', true);
  v_age_confirmed   boolean := lower(coalesce(v_meta ->> 'age_confirmed', 'false')) in ('true', '1', 'yes');
  v_start_cents     bigint  := greatest(public.config_bigint('economy', '{startingCapitalCents}', 1000000), 0);
  v_vault_hours     double precision := greatest(0, least(
                        public.config_double('economy', '{vaultInitialHours}', 2),
                        public.config_double('economy', '{vaultCapHours}', 8)));
  v_invite          public.invite_codes;
  v_base            text;
  v_nickname        text;
  v_attempt         integer := 0;
  v_cash_account    uuid;
begin
  -- 18+ confirmation ---------------------------------------------------------
  if v_age_required and not v_age_confirmed then
    raise exception 'age confirmation (18+) is required' using errcode = 'NX007';
  end if;

  -- invite code ---------------------------------------------------------------
  if v_code is not null then
    select i.* into v_invite from public.invite_codes i where i.code = v_code for update;
    if not found
       or not v_invite.is_active
       or (v_invite.expires_at is not null and v_invite.expires_at <= now())
       or v_invite.used_count >= v_invite.max_uses then
      if v_invite_required then
        raise exception 'invite code is invalid, expired or used up' using errcode = 'NX005';
      end if;
      v_code := null;
    end if;
  elsif v_invite_required then
    raise exception 'an invite code is required' using errcode = 'NX005';
  end if;

  -- nickname -------------------------------------------------------------------
  v_base := left(regexp_replace(coalesce(v_meta ->> 'nickname', ''), '[^A-Za-z0-9_]', '', 'g'), 20);
  if length(v_base) < 3 then
    v_base := 'Trader';
    v_nickname := v_base || (floor(random() * 90000) + 10000)::integer::text;
  else
    v_nickname := v_base;
  end if;
  while exists (select 1 from public.profiles p where lower(p.nickname) = lower(v_nickname)) loop
    v_attempt := v_attempt + 1;
    if v_attempt > 20 then
      raise exception 'could not generate a unique nickname' using errcode = 'NX007';
    end if;
    v_nickname := left(v_base, 15) || (floor(random() * 90000) + 10000)::integer::text;
  end loop;

  -- player rows ----------------------------------------------------------------
  insert into public.profiles (id, nickname) values (new.id, v_nickname);
  insert into public.player_private (player_id, age_confirmed_at)
  values (new.id, case when v_age_confirmed then now() end);
  insert into public.player_settings (player_id) values (new.id);
  insert into public.vaults (player_id, accrual_started_at)
  values (new.id, public.game_now() - make_interval(secs => v_vault_hours * 3600));
  insert into public.login_streaks (player_id) values (new.id);

  insert into public.player_unlocks (player_id, unlock_key)
  select new.id, u.key from public.unlocks u where u.level <= 1;

  insert into public.notification_preferences (player_id, type_key, in_app_enabled, push_enabled)
  select new.id, t.key, t.default_in_app, t.default_push from public.notification_types t;

  -- ledger: cash + reserve account, starting capital from the mint -------------
  insert into public.ledger_accounts (kind, owner_player_id, label)
  values ('player_cash', new.id, 'Cash')
  returning id into v_cash_account;
  insert into public.ledger_accounts (kind, owner_player_id, label)
  values ('player_reserve', new.id, 'Reserved (orders, subscriptions, margin)');

  if v_start_cents > 0 then
    perform public.ledger_transfer(
      public.ledger_system_account('mint'),
      v_cash_account,
      v_start_cents,
      'starting_capital',
      'Starting capital',
      'profile',
      new.id,
      'starting_capital:' || new.id::text,
      new.id
    );
  end if;

  -- consume the invite ---------------------------------------------------------
  if v_code is not null then
    update public.invite_codes set used_count = used_count + 1 where code = v_code;
    insert into public.invite_code_redemptions (code, player_id) values (v_code, new.id);
  end if;

  return new;
end;
$$;
comment on function public.handle_new_user() is 'Trigger on auth.users: validates invite/age, creates profile, settings, vault (pre-filled with economy.vaultInitialHours), ledger accounts, starting capital, notification defaults.';

-- ---------------------------------------------------------------------------
-- 7. Privileges: everything in this file is internal
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.div_round_half_even(numeric, numeric)', 'public.order_value_cents(bigint, bigint)',
    'public.apply_bps(bigint, numeric)', 'public.gauss_random()', 'public.cfg_num(jsonb, text[], double precision)',
    'public.config_double(text, text[], double precision)', 'public.api_error(text)', 'public.require_player()',
    'public.require_admin()', 'public.resolve_security(text)', 'public.market_session_at(timestamptz)',
    'public.trading_day_start(timestamptz)', 'public.quarter_bucket_start(timestamptz)',
    'public.game_year_bucket_start(timestamptz)', 'public.level_progress(bigint)', 'public.level_for_xp(bigint)',
    'public.unlock_level(text)', 'public.grant_xp(uuid, public.xp_source, integer, text, text, uuid)',
    'public.handle_new_user()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
