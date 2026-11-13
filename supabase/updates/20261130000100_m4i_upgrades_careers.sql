-- ===== idempotent copy of migrations/20261130000100_m4i_upgrades_careers.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M4i · 0100 · Upgrades and the career ladder with promotions (ADR-093, ADR-094)
-- =============================================================================
-- Mirrors src/lib/sim/upgrades.ts (upgradeCostCents, upgradeEffects, basicIncomeCentsPerHour, upgradeCheck) and
-- src/lib/sim/promotion.ts (nextTier, rankScore, promotionRequirements, promotionChanceBps, promotionCheck,
-- promotedSalaryCents, promotionGranted). Numbers: game_config 'upgrades' (src/config/upgrades.ts) and
-- careers.promotion (src/config/balance.ts); every helper falls back to the same defaults.
--
-- Schema:
--   player_upgrades (player_id, key, level)  bought upgrade levels; owner read, no client writes
--   player_jobs.rank_minutes                 paid minutes in the current rank (backfilled once, see section A)
--   player_jobs.promotion_retry_at           next promotion request after a no
--   player_jobs.pending_promotion_at         request waiting for a player boss (expires after requestValidHours)
--   player_jobs.promoted_at                  last promotion
-- Upgrade effects wired in: vault_status and claim_vault (vault size, basic income before the treasury factor),
-- accrue_job_salary and job_payable_minutes (paid hours per day, work hours per branch point, rank minutes),
-- skills_state (branch progress), job_state (paid_hours_cap, rank_hours, promotion), get_company_team.
-- RPCs: get_upgrades, buy_upgrade, request_promotion, promote_employee, decline_promotion.
-- New error keys: upgrade_maxed (NX083), promotion_not_ready (NX084), promotion_too_soon (NX085),
-- promotion_pending (NX086). New notification types: promotion_request, promotion_result. New feed kind: promoted.
-- New ledger kind: upgrade_purchase (player cash -> treasury).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter type public.ledger_tx_kind add value if not exists 'upgrade_purchase';

create table if not exists public.player_upgrades (
  player_id  uuid not null references public.profiles (id) on delete cascade,
  key        text not null check (key in ('vault', 'income', 'study', 'overtime', 'rhetoric')),
  level      integer not null check (level >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, key)
);
alter table public.player_upgrades enable row level security;
comment on table public.player_upgrades is
  'Upgrades bought with game money (ADR-093): one row per player and key, level 0..upgrades.<key>.maxLevel. '
  'Owner read; written only by buy_upgrade.';
do $$
begin
  revoke all on public.player_upgrades from public, anon, authenticated;
  grant select on public.player_upgrades to authenticated;
  grant all on public.player_upgrades to service_role;
  drop policy if exists "owner read" on public.player_upgrades;
  create policy "owner read" on public.player_upgrades for select to authenticated
    using (player_id = (select auth.uid()));
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.player_upgrades'::regclass) then
    create trigger set_updated_at before update on public.player_upgrades
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

-- rank_minutes: added once. Existing active jobs get their paid minutes so far (experience_minutes counts exactly the
-- paid minutes of the job), at most the hours the next rank needs: nobody is promoted on old hours alone twice, and a
-- long-standing employee can ask right away.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'player_jobs' and column_name = 'rank_minutes') then
    alter table public.player_jobs add column rank_minutes integer not null default 0 check (rank_minutes >= 0);
    update public.player_jobs j
       set rank_minutes = least(j.experience_minutes, 2000000000::bigint,
             coalesce(60 * ceil(public.cfg_num(public.config_jsonb('careers', '{promotion,hoursByTier}'),
                                               array[case j.tier when 'intern' then 'junior' when 'junior' then 'senior'
                                                                 when 'senior' then 'team_lead' when 'team_lead' then 'c_level' end],
                                               case j.tier when 'intern' then 12 when 'junior' then 36 when 'senior' then 72
                                                           when 'team_lead' then 120 end))::bigint,
                      j.experience_minutes))::integer
     where j.status = 'active' and j.experience_minutes > 0;
  end if;
end;
$$;
alter table public.player_jobs
  add column if not exists promotion_retry_at   timestamptz,
  add column if not exists pending_promotion_at timestamptz,
  add column if not exists promoted_at          timestamptz;
comment on column public.player_jobs.rank_minutes is
  'Paid minutes in the current rank (ADR-094); hours = floor(rank_minutes / 60), back to 0 on a promotion.';
comment on column public.player_jobs.promotion_retry_at is 'Next promotion request allowed from here (after a no).';
comment on column public.player_jobs.pending_promotion_at is
  'Promotion request waiting for a player boss; void after careers.promotion.requestValidHours.';
comment on column public.player_jobs.promoted_at is 'Time of the last promotion in this job.';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('promotion_result', 'career', 'Beförderung', 'Dein Chef hat über deine Beförderung entschieden.',
        'notif_promotion', true, true, false, 145),
       ('promotion_request', 'company', 'Bitte um Beförderung', 'Jemand aus deinem Team bittet um eine Beförderung.',
        'notif_briefcase', true, false, false, 226)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Error keys (M4i: NX083 to NX086)
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
    when 'insufficient_funds'          then 'NX001'
    when 'rate_limited'                then 'NX004'
    when 'forbidden'                   then 'NX006'
    when 'invalid_quantity'            then 'NX007'
    when 'invalid_price'               then 'NX007'
    when 'invalid_argument'            then 'NX007'
    when 'invalid_interval'            then 'NX007'
    when 'not_authenticated'           then 'NX010'
    when 'unknown_security'            then 'NX011'
    when 'not_tradable'                then 'NX012'
    when 'insufficient_position'       then 'NX013'
    when 'order_not_found'             then 'NX014'
    when 'order_not_open'              then 'NX015'
    when 'market_paused'               then 'NX016'
    when 'nothing_to_claim'            then 'NX017'
    when 'locked'                      then 'NX018'
    when 'name_too_short'              then 'NX019'
    when 'name_too_long'               then 'NX019'
    when 'name_invalid_chars'          then 'NX019'
    when 'name_profanity'              then 'NX019'
    when 'name_reserved'               then 'NX019'
    when 'name_taken'                  then 'NX019'
    when 'name_change_too_soon'        then 'NX020'
    when 'order_too_small'             then 'NX021'
    when 'market_illiquid'             then 'NX022'
    when 'mission_not_found'           then 'NX023'
    when 'mission_not_completed'       then 'NX024'
    when 'mission_already_claimed'     then 'NX025'
    when 'avatar_unknown'              then 'NX026'
    when 'avatar_locked'               then 'NX027'
    when 'daily_reward_claimed'        then 'NX028'
    when 'skill_unknown'               then 'NX029'
    when 'skill_learned'               then 'NX030'
    when 'skill_locked'                then 'NX031'
    when 'skill_points_insufficient'   then 'NX032'
    when 'job_not_found'               then 'NX033'
    when 'job_level_too_low'           then 'NX034'
    when 'job_skills_missing'          then 'NX035'
    when 'application_limit'           then 'NX036'
    when 'application_exists'          then 'NX037'
    when 'application_not_found'       then 'NX038'
    when 'application_not_offered'     then 'NX039'
    when 'offer_expired'               then 'NX040'
    when 'job_active_exists'           then 'NX041'
    when 'no_active_job'               then 'NX042'
    when 'raise_too_soon'              then 'NX043'
    when 'raise_too_high'              then 'NX044'
    when 'player_not_found'            then 'NX045'
    when 'employer_only'               then 'NX046'
    when 'company_exists'              then 'NX047'
    when 'company_not_found'           then 'NX048'
    when 'company_level_too_low'       then 'NX049'
    when 'owns_company'                then 'NX050'
    when 'employee_limit'              then 'NX051'
    when 'company_upgrade_unavailable' then 'NX052'
    when 'founding_locked'             then 'NX053'
    when 'not_in_company'              then 'NX054'
    when 'work_task_not_found'         then 'NX055'
    when 'work_task_expired'           then 'NX056'
    when 'work_task_done'              then 'NX057'
    when 'offer_closed'                then 'NX058'
    when 'offer_sold_out'              then 'NX059'
    when 'already_listed'              then 'NX060'
    when 'confirm_mismatch'            then 'NX061'
    when 'skill_already_covered'       then 'NX062'
    when 'training_locked'             then 'NX063'
    when 'logo_locked'                 then 'NX064'
    when 'logo_forbidden'              then 'NX065'
    when 'artworks_locked'             then 'NX066'
    when 'artwork_not_found'           then 'NX067'
    when 'auction_not_found'           then 'NX068'
    when 'auction_ended'               then 'NX069'
    when 'bid_too_low'                 then 'NX070'
    when 'own_artwork'                 then 'NX071'
    when 'already_on_auction'          then 'NX072'
    when 'auction_has_bids'            then 'NX073'
    when 'property_locked'             then 'NX074'
    when 'no_home'                     then 'NX075'
    when 'invalid_tier'                then 'NX076'
    when 'item_not_found'              then 'NX077'
    when 'layout_invalid'              then 'NX078'
    when 'floor_not_owned'             then 'NX079'
    when 'garage_full'                 then 'NX080'
    when 'event_closed'                then 'NX081'
    when 'event_needs_staff'           then 'NX082'
    when 'upgrade_maxed'               then 'NX083'
    when 'promotion_not_ready'         then 'NX084'
    when 'promotion_too_soon'          then 'NX085'
    when 'promotion_pending'           then 'NX086'
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;
comment on function public.api_error(text) is 'Raises the API error <key> with its NX SQLSTATE. The client shows a text per key (error.message).';

-- ---------------------------------------------------------------------------
-- C. Upgrade rules (port of src/lib/sim/upgrades.ts)
-- ---------------------------------------------------------------------------
-- Config of one upgrade: the defaults of src/config/upgrades.ts, overridden by game_config upgrades.<key>; null for an
-- unknown key.
create or replace function public.upgrade_cfg(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select d.v || coalesce(case when jsonb_typeof(c.v) = 'object' then c.v end, '{}'::jsonb)
    from (select '{"vault":    {"maxLevel": 6, "minLevel": 1, "baseCostCents": 300000,  "costGrowth": 2,   "perLevel": 2},
                   "income":   {"maxLevel": 3, "minLevel": 3, "baseCostCents": 400000,  "costGrowth": 3,   "perLevel": 1000},
                   "study":    {"maxLevel": 3, "minLevel": 2, "baseCostCents": 800000,  "costGrowth": 3,   "perLevel": 1},
                   "overtime": {"maxLevel": 2, "minLevel": 5, "baseCostCents": 2000000, "costGrowth": 3,   "perLevel": 1},
                   "rhetoric": {"maxLevel": 3, "minLevel": 5, "baseCostCents": 1000000, "costGrowth": 2.5, "perLevel": 500}}'::jsonb
                 -> p_key as v) d
   cross join lateral (select public.config_jsonb('upgrades', array[p_key]) as v) c
   where d.v is not null;
$$;
comment on function public.upgrade_cfg(text) is 'Internal: game_config upgrades.<key> with the defaults of src/config/upgrades.ts.';

-- levelOf: the stored level, 0 when absent, clamped to 0..maxLevel
create or replace function public.player_upgrade_level(p_player uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, least(floor(coalesce(public.cfg_num(public.upgrade_cfg(p_key), '{maxLevel}', 0), 0))::integer,
                           coalesce((select u.level from public.player_upgrades u
                                      where u.player_id = p_player and u.key = p_key), 0)));
$$;

-- {vault, income, study, overtime, rhetoric}: all five keys, always
create or replace function public.player_upgrade_levels(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'vault',    public.player_upgrade_level(p_player, 'vault'),
    'income',   public.player_upgrade_level(p_player, 'income'),
    'study',    public.player_upgrade_level(p_player, 'study'),
    'overtime', public.player_upgrade_level(p_player, 'overtime'),
    'rhetoric', public.player_upgrade_level(p_player, 'rhetoric'));
$$;

-- upgradeCostCents: round(baseCostCents x costGrowth^level / 100) x 100 (whole euros); null when maxed or unknown
create or replace function public.upgrade_cost_cents(p_key text, p_level integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when x.c is null or greatest(0, coalesce(p_level, 0)) >= public.cfg_num(x.c, '{maxLevel}', 0) then null
              else (round(public.cfg_num(x.c, '{baseCostCents}', 0)::numeric
                          * power(public.cfg_num(x.c, '{costGrowth}', 1)::numeric, greatest(0, coalesce(p_level, 0))::numeric)
                          / 100) * 100)::bigint end
    from (select public.upgrade_cfg(p_key) as c) x;
$$;

-- upgradeEffects().vaultCapHours
create or replace function public.player_vault_cap_hours(p_player uuid)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select public.config_double('economy', '{vaultCapHours}', 8)
       + public.player_upgrade_level(p_player, 'vault') * public.cfg_num(public.upgrade_cfg('vault'), '{perLevel}', 2);
$$;

-- basicIncomeCentsPerHour(): base x (10 000 + income level x perLevel) / 10 000, before the treasury factor
create or replace function public.player_basic_income_cents_per_hour(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select round(greatest(0, public.config_bigint('economy', '{basicIncomeCentsPerHour}', 10000))::numeric
               * (10000 + public.player_upgrade_level(p_player, 'income')
                          * public.cfg_num(public.upgrade_cfg('income'), '{perLevel}', 1000))::numeric
               / 10000)::bigint;
$$;

-- upgradeEffects().workHoursPerBranchPoint
create or replace function public.player_work_hours_per_branch_point(p_player uuid)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(public.config_double('upgrades', '{minWorkHoursPerBranchPoint}', 3),
                  public.config_double('skills', '{workHoursPerBranchPoint}', 6)
                  - public.player_upgrade_level(p_player, 'study') * public.cfg_num(public.upgrade_cfg('study'), '{perLevel}', 1));
$$;

-- upgradeEffects().paidHoursCap
create or replace function public.player_paid_hours_cap(p_player uuid)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select public.config_double('careers', '{paidHoursPerDayCap}', 12)
       + public.player_upgrade_level(p_player, 'overtime') * public.cfg_num(public.upgrade_cfg('overtime'), '{perLevel}', 1);
$$;

-- upgradeEffects().promotionBonusBps
create or replace function public.player_promotion_bonus_bps(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select round(public.player_upgrade_level(p_player, 'rhetoric')
               * public.cfg_num(public.upgrade_cfg('rhetoric'), '{perLevel}', 500))::integer;
$$;

-- ---------------------------------------------------------------------------
-- D. Vault: size and basic income with the upgrades (treasury factor on top, as before)
-- ---------------------------------------------------------------------------
create or replace function public.vault_status(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base    bigint := public.player_basic_income_cents_per_hour(p_player);
  v_hours   double precision := greatest(0, public.player_vault_cap_hours(p_player));
  v_factor  integer := public.basic_income_factor_bps();
  v_rate    bigint;
  v_now     timestamptz := public.game_now();
  v         public.vaults;
  v_ms      double precision;
begin
  select * into v from public.vaults where player_id = p_player;
  if not found then
    return null;
  end if;
  v_rate := v_base * v_factor / 10000;
  v_ms := least(greatest(0, extract(epoch from (v_now - v.accrual_started_at)) * 1000), v_hours * 3600000);
  return jsonb_build_object(
    'accrued_cents',       floor(v_rate * v_ms / 3600000)::bigint,
    'cap_cents',           round(v_rate * v_hours)::bigint,
    'rate_cents_per_hour', v_rate,
    'base_rate_cents_per_hour', v_base,
    'factor_bps',          v_factor,
    'last_claimed_at',     v.last_claimed_at,
    'full_at',             v.accrual_started_at + make_interval(secs => v_hours * 3600),
    'server_time',         v_now,
    'accrued_seconds',     floor(v_ms / 1000)::bigint);
end;
$$;

-- claim_vault as in M3d; full_at with the player's vault size
create or replace function public.claim_vault(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  v_status  jsonb;
  v_amount  bigint;
  v_now     timestamptz := public.game_now();
  v_tx      uuid;
  v_total   integer;
  v_counted integer;
  v_hours   double precision;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'claim_vault');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  perform public.lock_player_accounts(v_player);
  perform 1 from public.vaults where player_id = v_player for update;
  v_hours := greatest(0, public.player_vault_cap_hours(v_player));
  v_status := public.vault_status(v_player);
  v_amount := coalesce((v_status ->> 'accrued_cents')::bigint, 0);
  if v_amount < greatest(1, public.config_bigint('economy', '{vaultMinClaimCents}', 100)) then
    perform public.api_error('nothing_to_claim');
  end if;

  v_tx := public.state_payout(v_player, v_amount, 0, 'vault_claim', 'Grundeinkommen aus dem Tresor', 'vault', null,
                              'vault:' || v_player::text || ':' || p_request_id::text);
  perform public.loan_withhold(v_player, v_amount, 'vault:' || v_player::text || ':' || p_request_id::text);

  select greatest(0, floor(extract(epoch from (v_now - v.accrual_started_at))))::integer into v_total
    from public.vaults v where v.player_id = v_player;
  v_counted := (v_status ->> 'accrued_seconds')::integer;
  insert into public.vault_claims (player_id, request_id, amount_cents, accrued_seconds, forfeited_seconds, ledger_transaction_id)
  values (v_player, p_request_id, v_amount, v_counted, greatest(0, v_total - v_counted), v_tx)
  on conflict (player_id, request_id) do nothing;
  update public.vaults
     set accrual_started_at = v_now, last_claimed_at = v_now,
         total_claimed_cents = total_claimed_cents + v_amount, full_notified_at = null
   where player_id = v_player;
  perform public.mission_event(v_player, 'vault_claim', 1, null);

  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'claimed_cents', v_amount,
    'cash_cents',    (select a.balance_cents from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash'),
    'full_at',       v_now + make_interval(secs => v_hours * 3600),
    'factor_bps',    (v_status ->> 'factor_bps')::integer));
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Work: paid hours per day (overtime), branch points (study), minutes in the rank
-- ---------------------------------------------------------------------------
-- accrue_job_salary as in M3d plus the player's upgrades and rank_minutes
create or replace function public.accrue_job_salary(p_job_id uuid, p_now timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := coalesce(p_now, public.game_now());
  j         public.player_jobs;
  v_ai      boolean;
  v_day     date := (coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date;
  v_paid    integer;
  v_elapsed integer;
  v_minutes integer;
  v_amount  bigint;
  v_pay     bigint := 0;
  v_company uuid;
  v_bal     bigint;
  v_tx      uuid;
  v_xph     double precision;
  v_hours   integer;
  v_xp      integer := 0;
  v_hpp     double precision;
  v_nb      integer;
  v_share   integer;
  v_bwm     jsonb;
  v_base    bigint;
  v_bp      jsonb;
  v_before  integer;
  r         record;
  k         integer := 0;
begin
  select * into j from public.player_jobs where id = p_job_id and status = 'active' for update;
  if j.id is null then
    return 0;
  end if;
  v_elapsed := floor(extract(epoch from (v_now - j.last_paid_at)) / 60)::integer;
  if v_elapsed < 1 then
    return 0;
  end if;
  v_hpp := greatest(1, public.player_work_hours_per_branch_point(j.player_id));
  v_paid := case when j.paid_day = v_day then j.paid_minutes_today else 0 end;
  v_minutes := least(v_elapsed, greatest(0, (public.player_paid_hours_cap(j.player_id) * 60)::integer - v_paid));
  select c.is_ai into v_ai from public.companies c where c.id = j.company_id;

  if v_minutes > 0 then
    v_base := j.salary_cents_per_hour * v_minutes / 60;
    -- player companies pay the contract wage x pay factor of the quarter (ADR-058)
    v_amount := v_base * coalesce((select pc.pay_factor_bps from public.player_companies pc
                                    where pc.company_id = j.company_id and pc.status = 'active'), 10000) / 10000;
    select a.id, a.balance_cents into v_company, v_bal
      from public.ledger_accounts a where a.owner_company_id = j.company_id and a.kind = 'company_cash';
    v_pay := least(v_amount, greatest(coalesce(v_bal, 0), 0));
    if v_pay > 0 then
      v_tx := public.ledger_transfer(v_company, public.ledger_player_account(j.player_id, 'player_cash'), v_pay, 'salary',
                                     'Lohn', 'player_job', j.id,
                                     'salary:' || j.id::text || ':' || to_char(v_now, 'YYYYMMDDHH24MISSUS'), j.player_id);
      perform public.loan_withhold(j.player_id, v_pay, 'salary:' || j.id::text || ':' || to_char(v_now, 'YYYYMMDDHH24MISSUS'));
    end if;
    -- work XP per full paid hour (player companies: workHour.playerCompanyMultiplier)
    v_xph := public.config_double('progression', '{xpSources,workHour,xp}', 40)
           * case when v_ai then 1 else public.config_double('progression', '{xpSources,workHour,playerCompanyMultiplier}', 1.5) end;
    v_hours := (j.experience_minutes + v_minutes) / 60 - j.experience_minutes / 60;
    if v_hours > 0 then
      v_xp := public.grant_xp(j.player_id, 'work_hour', round(v_xph * v_hours)::integer,
                              'work:' || j.id::text || ':' || ((j.experience_minutes + v_minutes) / 60), 'player_job', j.id);
    end if;
    insert into public.salary_payouts (player_job_id, player_id, pay_day, period_start, period_end, minutes_paid, amount_cents,
                                       xp_awarded, ledger_transaction_id, base_amount_cents)
    values (j.id, j.player_id, v_day, j.last_paid_at, v_now, v_minutes, v_pay, v_xp, v_tx, v_base);

    -- branch work minutes and branch points (work hours per point with the study upgrade)
    perform public.skill_points_ensure(j.player_id);
    select sp.branch_work_minutes, sp.branch_points into v_bwm, v_bp
      from public.player_skill_points sp where sp.player_id = j.player_id for update;
    v_nb := greatest(1, jsonb_array_length(j.required));
    for r in select x ->> 'branch' as branch from jsonb_array_elements(j.required) x loop
      v_share := v_minutes / v_nb + case when k = 0 then v_minutes % v_nb else 0 end;
      v_before := coalesce((v_bwm ->> r.branch)::integer, 0);
      v_bwm := jsonb_set(v_bwm, array[r.branch], to_jsonb(v_before + v_share));
      v_bp := jsonb_set(v_bp, array[r.branch], to_jsonb(coalesce((v_bp ->> r.branch)::integer, 0)
              + ((v_before + v_share) / (v_hpp * 60)::integer - v_before / (v_hpp * 60)::integer)));
      k := k + 1;
    end loop;
    update public.player_skill_points set branch_work_minutes = v_bwm, branch_points = v_bp where player_id = j.player_id;
  end if;

  update public.player_jobs
     set last_paid_at = last_paid_at + make_interval(mins => v_elapsed),
         paid_day = v_day,
         paid_minutes_today = v_paid + v_minutes,
         experience_minutes = experience_minutes + v_minutes,
         rank_minutes = least(2000000000::bigint, rank_minutes::bigint + v_minutes)::integer,
         earned_total_cents = earned_total_cents + v_pay,
         pay_factor_bps = case when v_minutes > 0 and v_amount > 0 then (v_pay * 10000 / v_amount)::integer else pay_factor_bps end
   where id = j.id;
  return v_pay;
end;
$$;

-- job_payable_minutes as in M3i with the player's paid hours per day
create or replace function public.job_payable_minutes(p_job uuid, p_until timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when floor(extract(epoch from (p_until - j.last_paid_at)) / 60) < 1 then 0
                else least(floor(extract(epoch from (p_until - j.last_paid_at)) / 60)::integer,
                           greatest(0, (public.player_paid_hours_cap(j.player_id) * 60)::integer
                                       - case when j.paid_day = (p_until at time zone 'Europe/Berlin')::date
                                              then j.paid_minutes_today else 0 end)) end
      from public.player_jobs j
     where j.id = p_job and j.status = 'active'), 0);
$$;
comment on function public.job_payable_minutes(uuid, timestamptz) is
  'Minutes accrue_job_salary(p_job, p_until) would pay (elapsed whole minutes, limited by the player''s paid hours per day: '
  'careers.paidHoursPerDayCap plus the overtime upgrade).';

-- get_my_skills() shape as in M2b; progress with the player's work hours per branch point (study upgrade), which is
-- returned as well
create or replace function public.skills_state(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zero  jsonb := public.skill_branch_zero();
  v_hours double precision := greatest(1, public.player_work_hours_per_branch_point(p_player));
  sp      public.player_skill_points;
begin
  select * into sp from public.player_skill_points where player_id = p_player;
  return jsonb_build_object(
    'free_points',     coalesce(sp.free_points, 0),
    'branch_points',   v_zero || coalesce(sp.branch_points, '{}'::jsonb),
    'branch_progress', (select coalesce(jsonb_object_agg(k.key,
                                 round(((coalesce((sp.branch_work_minutes ->> k.key)::numeric, 0) % (v_hours * 60)::numeric)
                                        / (v_hours * 60)::numeric), 3)), '{}'::jsonb)
                          from jsonb_each(v_zero) k),
    'branch_scores',   public.player_branch_scores(p_player),
    'work_hours_per_branch_point', v_hours,
    'learned',         coalesce((select jsonb_agg(jsonb_build_object('key', s.skill_key, 'learned_at', s.learned_at)
                                                  order by s.learned_at, s.skill_key)
                                   from public.player_skills s where s.player_id = p_player), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Promotion rules (port of src/lib/sim/promotion.ts)
-- ---------------------------------------------------------------------------
-- careers.tiers, or the defaults of balance.ts
create or replace function public.career_tiers()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when jsonb_typeof(x.t) = 'array' and jsonb_array_length(x.t) > 0 then x.t
              else '[{"id": "intern", "minLevel": 2, "salaryCentsPerHour": 15000},
                     {"id": "junior", "minLevel": 5, "salaryCentsPerHour": 30000},
                     {"id": "senior", "minLevel": 12, "salaryCentsPerHour": 70000},
                     {"id": "team_lead", "minLevel": 20, "salaryCentsPerHour": 130000},
                     {"id": "c_level", "minLevel": 25, "salaryCentsPerHour": 250000}]'::jsonb end
    from (select public.config_jsonb('careers', '{tiers}') as t) x;
$$;

-- careers.promotion with the defaults of balance.ts (top-level keys)
create or replace function public.promotion_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select '{"hoursByTier": {"junior": 12, "senior": 36, "team_lead": 72, "c_level": 120},
           "managementFrom": ["team_lead", "c_level"], "baseChanceBps": 4000, "chancePerExtraScoreBps": 800,
           "maxChanceBps": 9000, "retryHours": 24, "raiseBps": 1500, "requestValidHours": 72}'::jsonb
         || coalesce(case when jsonb_typeof(x.p) = 'object' then x.p end, '{}'::jsonb)
    from (select public.config_jsonb('careers', '{promotion}') as p) x;
$$;

-- nextTier: the rank after p_tier, null at the top (or for an unknown rank)
create or replace function public.career_next_tier(p_tier text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with t as (select e ->> 'id' as id, i from jsonb_array_elements(public.career_tiers()) with ordinality x(e, i))
  select n.id from t n where n.i = (select c.i + 1 from t c where c.id = p_tier limit 1);
$$;

-- rankScore: jobs.tierMinScore[tier]
create or replace function public.career_tier_min_score(p_tier text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(floor(public.cfg_num(public.config_jsonb('jobs', '{tierMinScore}'), array[p_tier],
                                       case p_tier when 'intern' then 0 when 'junior' then 2 when 'senior' then 6
                                                   when 'team_lead' then 12 when 'c_level' then 20 else 0 end))::integer, 0);
$$;

-- German names of the ranks for notifications (as messages/de.json careerTiers)
create or replace function public.career_tier_phrase(p_tier text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_tier
    when 'intern'    then 'zum Praktikum'
    when 'junior'    then 'zum Junior'
    when 'senior'    then 'zum Senior'
    when 'team_lead' then 'zur Teamleitung'
    when 'c_level'   then 'in den Vorstand'
    else 'in einen neuen Rang'
  end;
$$;

-- promotionRequirements: [level, branch, management (team lead and C-level, not for management jobs), hours]
create or replace function public.promotion_requirements(p_next text, p_level integer, p_scores jsonb, p_main text,
                                                         p_rank_minutes bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select public.promotion_cfg() as p,
           public.career_tier_min_score(p_next) as score,
           coalesce((select floor(public.cfg_num(t, '{minLevel}', 1))::integer
                       from jsonb_array_elements(public.career_tiers()) t where t ->> 'id' = p_next limit 1), 1) as min_level
  ), r as (
    select 1 as ord, 'level' as key, null::text as branch, c.min_level as need, coalesce(p_level, 0) as have from c
    union all
    select 2, 'branch', p_main, c.score, coalesce((p_scores ->> p_main)::integer, 0) from c
    union all
    select 3, 'management', 'management', c.score / 2, coalesce((p_scores ->> 'management')::integer, 0) from c
     where coalesce(c.p -> 'managementFrom', '[]'::jsonb) ? p_next and p_main is distinct from 'management'
    union all
    -- whole hours worked against the hours of the rank (ceil keeps "have >= need" exact for whole hours)
    select 4, 'hours', null, ceil(public.cfg_num(c.p, array['hoursByTier', p_next], 0))::integer,
           (greatest(0, coalesce(p_rank_minutes, 0)) / 60)::integer from c
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', r.key, 'branch', r.branch, 'need', r.need, 'have', r.have,
                                               'met', r.have >= r.need) order by r.ord), '[]'::jsonb)
    from r;
$$;

-- promotionChanceBps: base + per score point above the requirement + rhetoric bonus, at most maxChanceBps
create or replace function public.promotion_chance_bps(p_extra_score integer, p_bonus_bps integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select round(least(public.cfg_num(x.p, '{maxChanceBps}', 9000),
                     public.cfg_num(x.p, '{baseChanceBps}', 4000)
                     + public.cfg_num(x.p, '{chancePerExtraScoreBps}', 800) * greatest(0, coalesce(p_extra_score, 0))
                     + greatest(0, coalesce(p_bonus_bps, 0))))::integer
    from (select public.promotion_cfg() as p) x;
$$;

-- promotedSalaryCents: + raiseBps, at least the base wage of the new rank
create or replace function public.promoted_salary_cents(p_current bigint, p_next text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(round(coalesce(p_current, 0)::numeric
                        * (10000 + public.cfg_num(public.promotion_cfg(), '{raiseBps}', 1500))::numeric / 10000)::bigint,
                  coalesce((select round(public.cfg_num(t, '{salaryCentsPerHour}', 0))::bigint
                              from jsonb_array_elements(public.career_tiers()) t where t ->> 'id' = p_next limit 1), 0));
$$;

-- Requirements of an AI posting of this rank (as refresh_ai_job_postings): main branch, plus half of it in
-- management from team lead on
create or replace function public.ai_job_required(p_main text, p_tier text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_array(jsonb_build_object('branch', p_main, 'min_score', x.s))
         || case when p_tier in ('team_lead', 'c_level') and p_main <> 'management'
                 then jsonb_build_array(jsonb_build_object('branch', 'management', 'min_score', x.s / 2))
                 else '[]'::jsonb end
    from (select public.career_tier_min_score(p_tier) as s) x;
$$;

-- promotionCheck for a job:
-- {next_tier, main_branch, requirements, ready, boss, chance_bps, retry_at, pending_since, next_salary_cents_per_hour}
create or replace function public.promotion_state(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j        public.player_jobs;
  v_ai     boolean;
  v_next   text;
  v_main   text;
  v_level  integer;
  v_reqs   jsonb := '[]'::jsonb;
  v_ready  boolean := false;
  v_chance integer := 0;
  v_branch jsonb;
  v_valid  double precision := public.cfg_num(public.promotion_cfg(), '{requestValidHours}', 72);
begin
  select * into j from public.player_jobs where id = p_job_id;
  if j.id is null then
    return null;
  end if;
  select c.is_ai into v_ai from public.companies c where c.id = j.company_id;
  v_ai := coalesce(v_ai, false);
  v_next := public.career_next_tier(j.tier::text);
  v_main := j.required -> 0 ->> 'branch';
  if v_next is not null then
    select p.level into v_level from public.profiles p where p.id = j.player_id;
    v_reqs := public.promotion_requirements(v_next, v_level, public.player_branch_scores(j.player_id), v_main, j.rank_minutes);
    v_ready := not exists (select 1 from jsonb_array_elements(v_reqs) r where not (r ->> 'met')::boolean);
    if v_ready then
      select r into v_branch from jsonb_array_elements(v_reqs) r where r ->> 'key' = 'branch';
      v_chance := public.promotion_chance_bps((v_branch ->> 'have')::integer - (v_branch ->> 'need')::integer,
                                              public.player_promotion_bonus_bps(j.player_id));
    end if;
  end if;
  return jsonb_build_object(
    'next_tier',     v_next,
    'main_branch',   v_main,
    'requirements',  v_reqs,
    'ready',         v_ready,
    'boss',          case when v_ai then 'ai' else 'player' end,
    'chance_bps',    case when v_ai then v_chance end,
    'retry_at',      case when j.promotion_retry_at > now() then j.promotion_retry_at end,
    'pending_since', case when j.pending_promotion_at + make_interval(secs => v_valid * 3600) > now()
                          then j.pending_promotion_at end,
    'next_salary_cents_per_hour', case when v_next is not null
                                       then public.promoted_salary_cents(j.salary_cents_per_hour, v_next) end);
end;
$$;
comment on function public.promotion_state(uuid) is
  'Internal: promotionCheck of a job (ADR-094); chance_bps only for AI bosses, pending_since only while the request is valid.';

-- The promotion itself (AI yes, promote_employee): next rank, new wage, hours and raise baseline start over, a pending
-- request and a retry wait end; AI jobs take the title and requirements of the AI posting of the new rank.
-- Feed item 'promoted' and notification 'promotion_result' to the employee.
create or replace function public.promotion_apply(p_job_id uuid, p_salary bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j       public.player_jobs;
  c       public.companies;
  v_next  text;
  v_main  text;
  v_req   jsonb;
  v_ai    boolean;
  v_match integer;
begin
  select * into j from public.player_jobs where id = p_job_id and status = 'active' for update;
  v_next := public.career_next_tier(j.tier::text);
  if j.id is null or v_next is null then
    perform public.api_error('promotion_not_ready');
  end if;
  if p_salary is null or p_salary < 1 then
    perform public.api_error('invalid_argument');
  end if;
  select * into c from public.companies where id = j.company_id;
  v_ai := coalesce(c.is_ai, false);
  v_main := j.required -> 0 ->> 'branch';
  v_req := case when v_ai and v_main is not null then public.ai_job_required(v_main, v_next) else j.required end;
  v_match := public.job_match_score(public.player_branch_scores(j.player_id), v_req);
  update public.player_jobs
     set tier = v_next::public.job_tier,
         salary_cents_per_hour = p_salary,
         rank_minutes = 0,
         promoted_at = now(),
         pending_promotion_at = null,
         promotion_retry_at = null,
         raise_base_score = v_match,
         pending_raise_bps = null,
         pending_raise_at = null,
         required = v_req,
         title_key = case when v_ai and j.title_key is not null and v_main is not null then v_main || '_' || v_next
                          else title_key end,
         title = case when v_ai and j.title_key is not null and v_main is not null then v_main || '_' || v_next
                      else title end,
         ceiling_cents_per_hour = case when v_ai
                                       then public.ai_salary_ceiling(coalesce((public.career_tier(v_next) ->> 'salaryCentsPerHour')::bigint,
                                                                              p_salary), v_match)
                                       else ceiling_cents_per_hour end
   where id = j.id;
  perform public.feed_post(j.player_id, 'promoted', jsonb_build_object('tier', v_next, 'company', c.name),
                           'promoted:' || j.id::text || ':' || v_next);
  perform public.social_notify(j.player_id, 'promotion_result', 'Befördert!',
    'Beförderung ' || public.career_tier_phrase(v_next) || ' bei ' || c.name || '. Neuer Lohn: '
      || public.format_eur(p_salary) || ' pro Stunde.',
    jsonb_build_object('status', 'promoted', 'player_job_id', j.id, 'company', c.name, 'tier', v_next,
                       'salary_cents_per_hour', p_salary),
    '/job', 'promotion_result:' || j.id::text || ':' || v_next);
  return jsonb_build_object('tier', v_next, 'salary_cents_per_hour', p_salary);
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Job and team views
-- ---------------------------------------------------------------------------
-- job_state as in M3f plus paid hours with overtime, rank_hours and promotion
create or replace function public.job_state(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j        public.player_jobs;
  v_match  integer;
  v_base   bigint;
  v_max    integer;
  v_ai     boolean;
  v_today  date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_cool   double precision := public.config_double('jobs', '{raiseRequest,cooldownDays}', 7);
  v_factor integer;
  v_bonus  bigint;
  v_next   timestamptz;
  v_open   boolean;
begin
  select * into j from public.player_jobs where player_id = p_player and status = 'active';
  if j.id is null then
    return jsonb_build_object('job', null);
  end if;
  select c.is_ai into v_ai from public.companies c where c.id = j.company_id;
  v_match := public.job_match_score(public.player_branch_scores(p_player), j.required);
  v_max := greatest(0, public.config_double('jobs', '{raiseRequest,maxRaiseBpsPerScore}', 300)::integer * (v_match - j.raise_base_score));
  if v_ai then
    v_base := coalesce((public.career_tier(j.tier::text) ->> 'salaryCentsPerHour')::bigint, j.salary_cents_per_hour);
    v_max := least(v_max, greatest(0, floor((public.ai_salary_ceiling(v_base, v_match)::numeric / j.salary_cents_per_hour - 1) * 10000)::integer));
  end if;
  -- player companies: pay factor of the quarter x share the company could pay at the last payout
  select pc.pay_factor_bps * j.pay_factor_bps / 10000,
         coalesce((select sum(sp.bonus_cents) from public.salary_payouts sp join public.game_quarters gq on gq.id = pc.last_closed_quarter_id
                    where sp.player_job_id = j.id and sp.bonus_cents > 0 and sp.period_end = gq.ends_at), 0)
    into v_factor, v_bonus
    from public.player_companies pc where pc.company_id = j.company_id and pc.status = 'active';
  v_factor := coalesce(v_factor, j.pay_factor_bps);
  -- automatic work (ADR-064): no new work tasks
  v_next := null;
  v_open := false;
  return jsonb_build_object('job', jsonb_build_object(
    'id', j.id,
    'company', public.company_json(j.company_id),
    'tier', j.tier,
    'title_key', j.title_key,
    'title', case when j.title_key is null then j.title end,
    'required', j.required,
    'salary_cents_per_hour', j.salary_cents_per_hour,
    'pay_factor_bps', v_factor,
    'effective_salary_cents_per_hour', j.salary_cents_per_hour * v_factor / 10000,
    'last_bonus_cents', coalesce(v_bonus, 0),
    'next_work_task_at', v_next,
    'work_task_open', v_open,
    'productivity_bps', public.job_productivity_bps(v_match),
    'started_at', j.started_at,
    'paid_hours_today', case when j.paid_day = v_today then round(j.paid_minutes_today / 60.0, 2) else 0 end,
    'paid_hours_cap', public.player_paid_hours_cap(p_player),
    'earned_total_cents', j.earned_total_cents,
    'raise_available_at', case when j.raise_requested_at is null
                                    or j.raise_requested_at + make_interval(secs => v_cool * 86400) <= now() then null
                               else j.raise_requested_at + make_interval(secs => v_cool * 86400) end,
    'raise_max_bps', v_max,
    'pending_raise', case when j.pending_raise_bps is not null
                          then jsonb_build_object('requested_bps', j.pending_raise_bps, 'created_at', j.pending_raise_at) end,
    'quit_cost_cents', 0,
    'quit_now_cost_cents', round(j.salary_cents_per_hour * public.config_double('jobs', '{quitNowCostHours}', 12))::bigint,
    'notice_ends_at', j.notice_ends_at,
    'signature', j.signature,
    'rank_hours', round(j.rank_minutes / 60.0, 1),
    'promotion', public.promotion_state(j.id)));
end;
$$;

-- get_company_team as in M3e plus rank, hours in the rank and the promotion state of every member
create or replace function public.get_company_team(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_company_owner(p_company_id);
  return jsonb_build_object('members', coalesce((
    select jsonb_agg(jsonb_build_object(
             'player_job_id', j.id, 'nickname', pr.nickname, 'avatar_key', pr.avatar_key,
             'title', coalesce(j.title, j.title_key), 'salary_cents_per_hour', j.salary_cents_per_hour,
             'productivity_bps', public.job_productivity_bps(public.job_match_score(public.player_branch_scores(pr.id), j.required)),
             'started_at', j.started_at,
             'notice_ends_at', j.notice_ends_at,
             'skills', coalesce((select jsonb_agg(s.skill_key order by s.skill_key) from public.player_skills s
                                  where s.player_id = pr.id), '[]'::jsonb),
             'pending_raise', case when j.pending_raise_bps is not null
                                   then jsonb_build_object('requested_bps', j.pending_raise_bps, 'created_at', j.pending_raise_at) end,
             'tier', j.tier,
             'rank_hours', round(j.rank_minutes / 60.0, 1),
             'promotion', (select jsonb_build_object('next_tier', ps -> 'next_tier', 'requirements', ps -> 'requirements',
                                                     'ready', ps -> 'ready', 'pending_since', ps -> 'pending_since',
                                                     'next_salary_cents_per_hour', ps -> 'next_salary_cents_per_hour')
                             from (select public.promotion_state(j.id) as ps) x))
             order by j.started_at, j.id)
      from public.player_jobs j join public.profiles pr on pr.id = j.player_id
     where j.company_id = p_company_id and j.status = 'active'), '[]'::jsonb));
end;
$$;

-- Feed label (body of the reaction notification) as in M4f plus 'promoted'
create or replace function public.feed_item_label(p_kind text, p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'level_up' then 'Level ' || coalesce(p_payload ->> 'level', '?') || ' erreicht'
    when 'big_trade' then 'Gewinn mit ' || coalesce(p_payload ->> 'ticker', 'einer Aktie')
    when 'company_founded' then coalesce(p_payload ->> 'name', 'Firma') || ' gegründet'
    when 'company_upgraded' then coalesce(p_payload ->> 'name', 'Firma') || ' aufgestiegen'
    when 'company_ipo' then coalesce(p_payload ->> 'name', 'Firma') || ' an der Börse'
    when 'company_expanded' then coalesce(p_payload ->> 'name', 'Firma') || ' erweitert'
    when 'art_won' then 'Kunstwerk „' || coalesce(p_payload ->> 'title', '?') || '“ ersteigert'
    when 'art_created' then 'Kunstwerk „' || coalesce(p_payload ->> 'title', '?') || '“ gemalt'
    when 'home_bought' then 'Neues Zuhause'
    when 'car_bought' then 'Neues Auto'
    when 'job_started' then 'Neuer Job bei ' || coalesce(p_payload ->> 'company_name', '?')
    when 'promoted' then 'Beförderung ' || public.career_tier_phrase(p_payload ->> 'tier')
    when 'streak' then coalesce(p_payload ->> 'days', '?') || ' Tage in Folge dabei'
    when 'league_won' then 'Wochenliga gewonnen'
    when 'friends_now' then 'Jetzt befreundet mit ' || coalesce(p_payload ->> 'other_nickname', '?')
    else 'Beitrag im Feed'
  end;
$$;

-- ---------------------------------------------------------------------------
-- H. RPCs: upgrades
-- ---------------------------------------------------------------------------
create or replace function public.get_upgrades()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object('levels', public.player_upgrade_levels(public.require_player()));
end;
$$;
comment on function public.get_upgrades() is 'RPC: {levels: {vault, income, study, overtime, rhetoric}} of the caller (ADR-093).';

-- Buys the next level: upgradeCheck order maxed, level, cash; the price goes from the player's cash to the treasury
-- that pays the basic income (closed money system, ADR-041).
create or replace function public.buy_upgrade(p_request_id uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  v_level   integer;
  v_cost    bigint;
  v_cash    bigint;
  v_old_cap double precision;
begin
  v_player := public.require_player();
  if p_request_id is null or p_key is null or p_key not in ('vault', 'income', 'study', 'overtime', 'rhetoric') then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_upgrade');
  if v_replay is not null then
    return v_replay;
  end if;
  v_cash := public.lock_player_accounts(v_player);
  if p_key = 'vault' then
    perform 1 from public.vaults where player_id = v_player for update;
  end if;
  v_level := public.player_upgrade_level(v_player, p_key);
  v_cost := public.upgrade_cost_cents(p_key, v_level);
  if v_cost is null then
    perform public.api_error('upgrade_maxed');
  end if;
  if coalesce((select p.level from public.profiles p where p.id = v_player), 0)
     < public.cfg_num(public.upgrade_cfg(p_key), '{minLevel}', 1) then
    perform public.api_error('locked');
  end if;
  if v_cash < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  v_old_cap := greatest(0, public.player_vault_cap_hours(v_player));
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('treasury'),
                                 v_cost, 'upgrade_purchase', 'Verbesserung gekauft', 'upgrade', null,
                                 'upgrade:' || v_player::text || ':' || p_key || ':' || p_request_id::text, v_player,
                                 jsonb_build_object('key', p_key, 'level', v_level + 1));
  insert into public.player_upgrades (player_id, key, level) values (v_player, p_key, v_level + 1)
  on conflict (player_id, key) do update set level = excluded.level;
  -- a bigger vault keeps what it holds and fills on from there: the time it stood full earns nothing afterwards
  if p_key = 'vault' then
    update public.vaults v
       set accrual_started_at = greatest(v.accrual_started_at, public.game_now() - make_interval(secs => v_old_cap * 3600)),
           full_notified_at = null
     where v.player_id = v_player;
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'key',        p_key,
    'level',      v_level + 1,
    'cost_cents', v_cost,
    'levels',     public.player_upgrade_levels(v_player)));
end;
$$;
comment on function public.buy_upgrade(uuid, text) is
  'RPC: buys the next level of an upgrade (ADR-093) -> {key, level, cost_cents, levels}; errors invalid_argument, '
  'upgrade_maxed, locked, insufficient_funds.';

-- ---------------------------------------------------------------------------
-- I. RPCs: promotions
-- ---------------------------------------------------------------------------
-- The employee asks. AI boss: decides now (server randomness against chance_bps); player boss: the request waits.
create or replace function public.request_promotion(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  j        public.player_jobs;
  c        public.companies;
  v_state  jsonb;
  v_next   text;
  v_wage   bigint;
  v_chance integer;
  v_retry  timestamptz;
  v_res    jsonb;
  v_nick   text;
  v_boss   uuid;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'request_promotion');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into j from public.player_jobs where player_id = v_player and status = 'active' for update;
  if j.id is null then
    perform public.api_error('no_active_job');
  end if;
  v_state := public.promotion_state(j.id);
  if v_state ->> 'pending_since' is not null then
    perform public.api_error('promotion_pending');
  end if;
  if v_state ->> 'retry_at' is not null then
    perform public.api_error('promotion_too_soon');
  end if;
  if not coalesce((v_state ->> 'ready')::boolean, false) then
    perform public.api_error('promotion_not_ready');
  end if;
  v_next := v_state ->> 'next_tier';
  v_wage := (v_state ->> 'next_salary_cents_per_hour')::bigint;
  select * into c from public.companies where id = j.company_id;

  if c.is_ai then
    v_chance := coalesce((v_state ->> 'chance_bps')::integer, 0);
    -- promotionGranted: u x 10 000 < chance
    if random() * 10000 < v_chance then
      v_res := public.promotion_apply(j.id, v_wage);
      return public.request_complete(v_player, p_request_id, jsonb_build_object(
        'status', 'promoted', 'tier', v_res ->> 'tier', 'salary_cents_per_hour', (v_res ->> 'salary_cents_per_hour')::bigint,
        'retry_at', null, 'chance_bps', v_chance));
    end if;
    v_retry := now() + make_interval(secs => public.cfg_num(public.promotion_cfg(), '{retryHours}', 24) * 3600);
    update public.player_jobs set promotion_retry_at = v_retry where id = j.id;
    return public.request_complete(v_player, p_request_id, jsonb_build_object(
      'status', 'declined', 'tier', j.tier, 'salary_cents_per_hour', j.salary_cents_per_hour,
      'retry_at', v_retry, 'chance_bps', v_chance));
  end if;

  -- player boss: the request waits for promote_employee / decline_promotion (founder and CEO are told)
  update public.player_jobs set pending_promotion_at = now() where id = j.id;
  select p.nickname into v_nick from public.profiles p where p.id = v_player;
  for v_boss in select distinct x from unnest(array[c.founder_id, c.ceo_id]) x where x is not null and x <> v_player loop
    perform public.social_notify(v_boss, 'promotion_request',
      v_nick || ' bittet um Beförderung ' || public.career_tier_phrase(v_next),
      'Die Anforderungen sind erfüllt. Neuer Lohn mindestens ' || public.format_eur(v_wage) || ' pro Stunde.',
      jsonb_build_object('player_job_id', j.id, 'company_id', c.id, 'nickname', v_nick, 'tier', j.tier, 'next_tier', v_next,
                         'min_salary_cents_per_hour', v_wage),
      '/company', 'promotion_request:' || j.id::text || ':' || floor(extract(epoch from now()))::bigint::text);
  end loop;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'status', 'pending', 'tier', j.tier, 'salary_cents_per_hour', j.salary_cents_per_hour,
    'retry_at', null, 'chance_bps', null));
end;
$$;
comment on function public.request_promotion(uuid) is
  'RPC: asks for the next rank (ADR-094) -> {status promoted|declined|pending, tier, salary_cents_per_hour, retry_at, chance_bps}; '
  'errors no_active_job, promotion_pending, promotion_too_soon, promotion_not_ready.';

-- Player boss promotes a member whose requirements are met, with or without a request; at least the formula wage.
create or replace function public.promote_employee(p_request_id uuid, p_company_id uuid, p_player_job_id uuid,
                                                   p_salary_cents_per_hour bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  j        public.player_jobs;
  v_state  jsonb;
  v_min    bigint;
  v_res    jsonb;
begin
  v_player := public.require_company_owner(p_company_id);
  if p_request_id is null or p_player_job_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'promote_employee');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into j from public.player_jobs
   where id = p_player_job_id and company_id = p_company_id and status = 'active' for update;
  if j.id is null then
    perform public.api_error('no_active_job');
  end if;
  if j.player_id = v_player then
    perform public.api_error('forbidden');
  end if;
  v_state := public.promotion_state(j.id);
  if not coalesce((v_state ->> 'ready')::boolean, false) then
    perform public.api_error('promotion_not_ready');
  end if;
  v_min := (v_state ->> 'next_salary_cents_per_hour')::bigint;
  if p_salary_cents_per_hour is not null and p_salary_cents_per_hour < v_min then
    perform public.api_error('invalid_argument');
  end if;
  v_res := public.promotion_apply(j.id, coalesce(p_salary_cents_per_hour, v_min));
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'status', 'promoted', 'tier', v_res ->> 'tier', 'salary_cents_per_hour', (v_res ->> 'salary_cents_per_hour')::bigint));
end;
$$;
comment on function public.promote_employee(uuid, uuid, uuid, bigint) is
  'RPC (founder/CEO): promotes a team member who meets the requirements (ADR-094) -> {status, tier, salary_cents_per_hour}; '
  'p_salary_cents_per_hour null = formula wage, lower = invalid_argument; errors employer_only, no_active_job, promotion_not_ready.';

-- Player boss says no to a waiting request: the employee may ask again after retryHours.
create or replace function public.decline_promotion(p_request_id uuid, p_company_id uuid, p_player_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  j        public.player_jobs;
  v_name   text;
  v_retry  timestamptz;
begin
  v_player := public.require_company_owner(p_company_id);
  if p_request_id is null or p_player_job_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'decline_promotion');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into j from public.player_jobs
   where id = p_player_job_id and company_id = p_company_id and status = 'active' for update;
  if j.id is null then
    perform public.api_error('no_active_job');
  end if;
  if public.promotion_state(j.id) ->> 'pending_since' is null then
    perform public.api_error('invalid_argument');
  end if;
  v_retry := now() + make_interval(secs => public.cfg_num(public.promotion_cfg(), '{retryHours}', 24) * 3600);
  update public.player_jobs set pending_promotion_at = null, promotion_retry_at = v_retry where id = j.id;
  select c.name into v_name from public.companies c where c.id = j.company_id;
  perform public.social_notify(j.player_id, 'promotion_result', 'Noch nicht befördert',
    v_name || ' hat deine Bitte um Beförderung abgelehnt. Nächster Versuch ab '
      || to_char(v_retry at time zone 'Europe/Berlin', 'DD.MM., HH24:MI') || ' Uhr.',
    jsonb_build_object('status', 'declined', 'player_job_id', j.id, 'company', v_name, 'tier', j.tier, 'retry_at', v_retry),
    '/job', 'promotion_result:' || j.id::text || ':declined:' || floor(extract(epoch from v_retry))::bigint::text);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('status', 'declined', 'retry_at', v_retry));
end;
$$;
comment on function public.decline_promotion(uuid, uuid, uuid) is
  'RPC (founder/CEO): declines a waiting promotion request (ADR-094) -> {status, retry_at}; errors employer_only, '
  'no_active_job, invalid_argument (no valid request).';

-- ---------------------------------------------------------------------------
-- J. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.api_error(text)', 'public.upgrade_cfg(text)', 'public.player_upgrade_level(uuid, text)',
    'public.player_upgrade_levels(uuid)', 'public.upgrade_cost_cents(text, integer)', 'public.player_vault_cap_hours(uuid)',
    'public.player_basic_income_cents_per_hour(uuid)', 'public.player_work_hours_per_branch_point(uuid)',
    'public.player_paid_hours_cap(uuid)', 'public.player_promotion_bonus_bps(uuid)', 'public.vault_status(uuid)',
    'public.accrue_job_salary(uuid, timestamptz)', 'public.job_payable_minutes(uuid, timestamptz)',
    'public.skills_state(uuid)', 'public.career_tiers()', 'public.promotion_cfg()', 'public.career_next_tier(text)',
    'public.career_tier_min_score(text)', 'public.career_tier_phrase(text)',
    'public.promotion_requirements(text, integer, jsonb, text, bigint)', 'public.promotion_chance_bps(integer, integer)',
    'public.promoted_salary_cents(bigint, text)', 'public.ai_job_required(text, text)', 'public.promotion_state(uuid)',
    'public.promotion_apply(uuid, bigint)', 'public.job_state(uuid)', 'public.feed_item_label(text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.claim_vault(uuid)', 'public.get_company_team(uuid)', 'public.get_upgrades()', 'public.buy_upgrade(uuid, text)',
    'public.request_promotion(uuid)', 'public.promote_employee(uuid, uuid, uuid, bigint)',
    'public.decline_promotion(uuid, uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;
