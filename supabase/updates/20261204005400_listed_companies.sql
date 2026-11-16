-- ===== idempotent copy of migrations/20261204005400_listed_companies.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5400 · Listed player companies: research, satisfaction, reputation, the hour (ADR-167)
-- =============================================================================
-- Everything here applies only while companies.phase = 'listed'; private companies get the neutral value from every
-- function. Values: game_config.listed (src/config/listed.ts), formulas: src/lib/sim/listed.ts.
-- * Tables (internal, RPC only): listed_companies (reputation, satisfaction, books, restrictions),
--   company_investments (research, products, regions, machines, acquisitions, licences, benefits, actions),
--   listed_company_hours (history), company_budgets (money earmarked by the board), company_dividends,
--   board_motions, board_votes, company_tax_periods.
-- * The operating hour: player_company_close_hour() is patched (not redefined) at eight places: listed_hour_effect()
--   gives awareness/quality add-ons and factors for demand, capacity, goods and fixed costs; listed_hour_costs() pays
--   the running costs (they count as fixed costs); the payout honours the board's cap and never touches earmarked
--   money; listed_hour_after() moves satisfaction and reputation, lets AI workers quit, finishes projects, runs the
--   tax office and the board.
-- * Patched by replace as well: company_withdraw (earmarked money, withdrawal ban), set_founder_payout (cap),
--   set_company_strategy (price lock), company_dissolve (taxes first, clean-up), player_company_close_quarter (the
--   fair share price follows the reputation), account_wipe, api_error (NX190 to NX204).
-- Idempotent: runs unchanged as supabase/updates/20261204005400_listed_companies.sql.

-- ---------------------------------------------------------------------------
-- A. Error keys, notification types
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''board_not_shareholder''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'chat_already_member'        then 'NX162'
$q$, $q$    when 'chat_already_member'        then 'NX162'
    when 'not_listed'                 then 'NX190'
    when 'item_unknown'               then 'NX191'
    when 'item_locked'                then 'NX192'
    when 'item_running'               then 'NX193'
    when 'budget_reserved'            then 'NX194'
    when 'withdraw_blocked'           then 'NX195'
    when 'payout_capped'              then 'NX196'
    when 'strategy_locked'            then 'NX197'
    when 'books_nothing'              then 'NX198'
    when 'tax_nothing_due'            then 'NX199'
    when 'dividend_limit'             then 'NX200'
    when 'board_no_right'             then 'NX201'
    when 'board_motion_unknown'       then 'NX202'
    when 'board_limit'                then 'NX203'
    when 'board_not_shareholder'      then 'NX204'
$q$);
    if position('''board_not_shareholder''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the listed company error keys (NX190 to NX204) by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('tax_office', 'company', 'Finanzamt', 'Bücher, Steuern, Mahnungen und Strafen deiner börsennotierten Firma.',
        'notif_company', true, true, true, 206),
       ('team_mood', 'company', 'Stimmung im Team', 'Die Mitarbeiterzufriedenheit ist schlecht oder jemand hat gekündigt.',
        'notif_company', true, true, false, 207),
       ('board', 'company', 'Geschäftsrat', 'Ein Antrag im Geschäftsrat einer Firma, an der du Aktien hältst.',
        'notif_company', true, true, false, 208),
       ('company_dividend', 'market', 'Dividende', 'Eine Firma, an der du Aktien hältst, hat eine Dividende gezahlt.',
        'notif_bell', true, false, false, 299),
       ('company_project', 'company', 'Projekt fertig', 'Eine Forschung, ein Produkt oder ein Ausbau deiner Firma ist fertig.',
        'notif_company', true, false, false, 209)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Tables (internal)
-- ---------------------------------------------------------------------------
create table if not exists public.listed_companies (
  company_id           uuid primary key references public.companies (id) on delete cascade,
  reputation           double precision not null default 50 check (reputation between 0 and 100),
  satisfaction         double precision not null default 60 check (satisfaction between 0 and 100),
  price_factor         double precision not null default 1 check (price_factor > 0),
  ref_revenue_cents    bigint not null default 0 check (ref_revenue_cents >= 0),
  layoff_heat          double precision not null default 0 check (layoff_heat >= 0),
  layoff_checked_at    timestamptz,
  ai_workers_seen      integer,
  red_hours            integer not null default 0,
  quits_day            date,
  quits_today          integer not null default 0,
  mood_notified_at     timestamptz,
  last_upkeep          jsonb not null default '{}'::jsonb,
  books_until          timestamptz not null default now(),
  books_day            date,
  books_streak         integer not null default 0,
  books_stage          smallint not null default 0,
  loss_carry_cents     bigint not null default 0 check (loss_carry_cents >= 0),
  advisor              boolean not null default false,
  payout_cap_bps       integer check (payout_cap_bps between 0 and 10000),
  payout_cap_until     timestamptz,
  withdraw_block_until timestamptz,
  price_lock           text check (price_lock in ('budget', 'normal', 'premium')),
  price_lock_until     timestamptz,
  dividend_day         date,
  dividend_streak      integer not null default 0,
  best_dividend_cents  bigint not null default 0,
  created_at           timestamptz not null default now()
);
alter table public.listed_companies enable row level security;
comment on table public.listed_companies is
  'Listed player companies (ADR-167): reputation, employee satisfaction, bookkeeping state and the board''s restrictions. Internal (RPCs).';

create table if not exists public.company_investments (
  company_id   uuid not null references public.companies (id) on delete cascade,
  key          text not null check (key ~ '^[a-z0-9_]+$'),
  kind         text not null,
  status       text not null check (status in ('running', 'active', 'paused', 'retired')),
  level        integer not null default 0 check (level >= 0),
  ready_at     timestamptz,
  last_used_at timestamptz,
  spent_cents  bigint not null default 0,
  started_at   timestamptz not null default now(),
  primary key (company_id, key)
);
alter table public.company_investments enable row level security;
comment on table public.company_investments is
  'What a listed company bought from game_config.listed.items (ADR-167): level counts the finished levels, ready_at the one in work. Internal.';

create table if not exists public.listed_company_hours (
  company_id      uuid not null references public.companies (id) on delete cascade,
  hour_start      timestamptz not null,
  satisfaction    double precision not null,
  sat_target      double precision not null,
  reputation      double precision not null,
  rep_target      double precision not null,
  demand_factor   double precision not null,
  capacity_factor double precision not null,
  upkeep_cents    bigint not null default 0,
  upkeep          jsonb not null default '{}'::jsonb,
  drivers         jsonb not null default '{}'::jsonb,
  primary key (company_id, hour_start)
);
alter table public.listed_company_hours enable row level security;
comment on table public.listed_company_hours is 'Hourly history of a listed company: mood, reputation, factors, running costs (ADR-167). Internal.';

create table if not exists public.company_budgets (
  company_id   uuid not null references public.companies (id) on delete cascade,
  purpose      text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  updated_at   timestamptz not null default now(),
  primary key (company_id, purpose)
);
alter table public.company_budgets enable row level security;
drop trigger if exists set_updated_at on public.company_budgets;
create trigger set_updated_at before update on public.company_budgets for each row execute function public.set_updated_at();
comment on table public.company_budgets is
  'Company cash earmarked by the board for a purpose (ADR-167): not free cash, the founder cannot withdraw it. Internal.';

create table if not exists public.company_dividends (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references public.companies (id) on delete cascade,
  source        text not null check (source in ('founder', 'board')),
  total_cents   bigint not null check (total_cents > 0),
  players_cents bigint not null,
  float_cents   bigint not null,
  shares_e6     bigint not null,
  holders       integer not null,
  paid_at       timestamptz not null default now()
);
alter table public.company_dividends enable row level security;
create index if not exists company_dividends_company_idx on public.company_dividends (company_id, id desc);
comment on table public.company_dividends is 'Dividends a listed player company paid (ADR-167). Internal.';

create table if not exists public.board_motions (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies (id) on delete cascade,
  proposer_id  uuid references public.profiles (id) on delete set null,
  kind         text not null,
  params       jsonb not null default '{}'::jsonb,
  status       text not null default 'open' check (status in ('open', 'passed', 'rejected', 'no_quorum', 'cancelled')),
  created_at   timestamptz not null default now(),
  closes_at    timestamptz not null,
  closed_at    timestamptz,
  yes_e6       bigint not null default 0,
  no_e6        bigint not null default 0,
  ai_e6        bigint not null default 0,
  total_e6     bigint not null default 0,
  result       jsonb not null default '{}'::jsonb
);
alter table public.board_motions enable row level security;
create index if not exists board_motions_company_idx on public.board_motions (company_id, id desc);
create index if not exists board_motions_proposer_idx on public.board_motions (proposer_id) where proposer_id is not null;
comment on table public.board_motions is 'Motions of the board of a listed company (ADR-167). Internal.';

create table if not exists public.board_votes (
  motion_id bigint not null references public.board_motions (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  yes       boolean not null,
  voted_at  timestamptz not null default now(),
  primary key (motion_id, player_id)
);
alter table public.board_votes enable row level security;
create index if not exists board_votes_player_idx on public.board_votes (player_id);
comment on table public.board_votes is 'One vote per shareholder and motion; the weight is the holding when the motion is counted (ADR-167). Internal.';

create table if not exists public.company_tax_periods (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references public.companies (id) on delete cascade,
  kind            text not null default 'books' check (kind in ('books', 'late_fee')),
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  revenue_cents   bigint not null default 0,
  costs_cents     bigint not null default 0,
  profit_cents    bigint not null default 0,
  loss_used_cents bigint not null default 0,
  taxable_cents   bigint not null default 0,
  rate_bps        integer not null default 0,
  discount_cents  bigint not null default 0,
  tax_cents       bigint not null default 0 check (tax_cents >= 0),
  penalty_cents   bigint not null default 0 check (penalty_cents >= 0),
  paid_cents      bigint not null default 0 check (paid_cents >= 0),
  status          text not null default 'due' check (status in ('due', 'paid')),
  closed_by       text not null check (closed_by in ('founder', 'advisor', 'finanzamt')),
  check_correct   smallint,
  stage           smallint not null default 0,
  due_at          timestamptz not null,
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.company_tax_periods enable row level security;
create index if not exists company_tax_periods_company_idx on public.company_tax_periods (company_id, id desc);
comment on table public.company_tax_periods is
  'Closed bookkeeping periods of a listed company with the corporate tax and penalties due (ADR-167). Internal.';

do $$
declare
  t text;
begin
  foreach t in array array['listed_companies', 'company_investments', 'listed_company_hours', 'company_budgets',
                           'company_dividends', 'board_motions', 'board_votes', 'company_tax_periods'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Config and formulas (the same as src/lib/sim/listed.ts)
-- ---------------------------------------------------------------------------
create or replace function public.listed_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'listed'), '{}'::jsonb);
$$;

create or replace function public.listed_item(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select t.x from jsonb_array_elements(coalesce(public.listed_cfg() -> 'items', '[]'::jsonb)) t(x)
   where t.x ->> 'key' = p_key limit 1;
$$;

-- Whether the company is an active player company at the stock exchange
create or replace function public.listed_is(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.companies c join public.player_companies pc on pc.company_id = c.id
                  where c.id = p_company and c.phase = 'listed' and pc.status = 'active');
$$;

-- The listed row of a company, created on first use; null for private companies
create or replace function public.listed_ensure(p_company uuid)
returns public.listed_companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  l   public.listed_companies;
  cfg jsonb := public.listed_cfg();
begin
  if not public.listed_is(p_company) then
    return null;
  end if;
  select * into l from public.listed_companies where company_id = p_company;
  if l.company_id is null then
    insert into public.listed_companies (company_id, reputation, satisfaction, books_until, ai_workers_seen)
    values (p_company, public.cfg_num(cfg, '{reputation,start}', 50), public.cfg_num(cfg, '{satisfaction,start}', 60), now(),
            (select pc.ai_workers from public.player_companies pc where pc.company_id = p_company))
    on conflict (company_id) do nothing;
    select * into l from public.listed_companies where company_id = p_company;
  end if;
  return l;
end;
$$;

-- refRevenueCents: average revenue per hour of the last hours, never below the minimum
create or replace function public.listed_ref_revenue(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(public.cfg_num(public.listed_cfg(), '{refRevenue,minCents}', 20000)::bigint,
                  coalesce((select round(avg(h.revenue_cents))::bigint
                              from (select x.revenue_cents from public.player_company_hours x
                                     where x.company_id = p_company order by x.hour_start desc
                                     limit greatest(1, public.cfg_num(public.listed_cfg(), '{refRevenue,windowHours}', 24)::integer)) h), 0));
$$;

-- itemCostCents: max(minCostCents, costHours x reference revenue) x costGrowth^level + costPerHeadCents x heads
create or replace function public.listed_item_cost(p_item jsonb, p_level integer, p_ref bigint, p_heads integer)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select round((greatest(public.cfg_num(p_item, '{minCostCents}', 0), public.cfg_num(p_item, '{costHours}', 0) * p_ref)
                * power(public.cfg_num(p_item, '{costGrowth}', 1), greatest(0, coalesce(p_level, 0))))::numeric)::bigint
       + public.cfg_num(p_item, '{costPerHeadCents}', 0)::bigint * greatest(1, coalesce(p_heads, 0));
$$;

-- itemUpkeepCents: round(upkeepBps x reference revenue / 10 000) x level + upkeepPerHeadCents x heads
create or replace function public.listed_item_upkeep(p_item jsonb, p_level integer, p_ref bigint, p_heads integer)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select round(public.cfg_num(p_item, '{upkeepBps}', 0)::numeric * p_ref / 10000)::bigint * greatest(1, coalesce(p_level, 1))
       + public.cfg_num(p_item, '{upkeepPerHeadCents}', 0)::bigint * greatest(1, coalesce(p_heads, 0));
$$;

-- The books category of an item kind
create or replace function public.listed_kind_category(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'research' then 'research' when 'product' then 'product'
                     when 'benefit' then 'benefit' when 'action' then 'benefit' else 'expansion' end;
$$;

-- sumEffects: effects of all active items, per level
create or replace function public.listed_effects(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'demandBps', coalesce(sum(public.cfg_num(i.x, '{effects,demandBps}', 0) * i.lv), 0),
    'marketBps', coalesce(sum(public.cfg_num(i.x, '{effects,marketBps}', 0) * i.lv), 0),
    'capacityBps', coalesce(sum(public.cfg_num(i.x, '{effects,capacityBps}', 0) * i.lv), 0),
    'qualityBps', coalesce(sum(public.cfg_num(i.x, '{effects,qualityBps}', 0) * i.lv), 0),
    'awarenessBps', coalesce(sum(public.cfg_num(i.x, '{effects,awarenessBps}', 0) * i.lv), 0),
    'marginBps', coalesce(sum(public.cfg_num(i.x, '{effects,marginBps}', 0) * i.lv), 0),
    'fixedCostBps', coalesce(sum(public.cfg_num(i.x, '{effects,fixedCostBps}', 0) * i.lv), 0),
    'taxRateBps', coalesce(sum(public.cfg_num(i.x, '{effects,taxRateBps}', 0) * i.lv), 0),
    'satisfaction', coalesce(sum(public.cfg_num(i.x, '{effects,satisfaction}', 0) * i.lv), 0),
    'reputation', coalesce(sum(public.cfg_num(i.x, '{effects,reputation}', 0) * i.lv), 0))
    from (select public.listed_item(ci.key) as x, greatest(1, ci.level) as lv
            from public.company_investments ci
           where ci.company_id = p_company and ci.status = 'active' and ci.level > 0) i
   where i.x is not null;
$$;

-- greedShare: 0 up to freeRatioBps, 1 from fullRatioBps
create or replace function public.listed_greed_share(p_ratio_bps double precision)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select least(1.0, greatest(0.0,
           (p_ratio_bps - public.cfg_num(public.listed_cfg(), '{reputation,greed,freeRatioBps}', 3000))
           / greatest(1.0, public.cfg_num(public.listed_cfg(), '{reputation,greed,fullRatioBps}', 10000)
                           - public.cfg_num(public.listed_cfg(), '{reputation,greed,freeRatioBps}', 3000))));
$$;

-- payoutRatioBps: founder payouts and withdrawals / max(profit, share of the revenue, 1)
create or replace function public.listed_payout_ratio_bps(p_payout bigint, p_profit bigint, p_revenue bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(p_payout, 0) <= 0 then 0
              else round(p_payout * 10000.0
                         / greatest(p_profit, p_revenue * public.cfg_num(public.listed_cfg(), '{reputation,minProfitShareOfRevenue}', 0.05), 1))::integer
         end;
$$;

-- satisfactionTarget: where the mood is heading this hour, with its drivers
create or replace function public.listed_satisfaction_target(p_benefits double precision, p_pay_factor_bps integer,
  p_pay_mood_bps integer, p_utilization double precision, p_crisis integer, p_scandal boolean, p_layoff_heat double precision,
  p_payout_ratio_bps integer, p_profit bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s      jsonb := coalesce(public.listed_cfg() -> 'satisfaction', '{}'::jsonb);
  v_over double precision;
  d      jsonb;
  v_sum  double precision;
begin
  v_over := least(1.0, greatest(0.0, (p_utilization - public.cfg_num(s, '{workload,overFrom}', 0.95))
                                     / greatest(0.0001, public.cfg_num(s, '{workload,overFull}', 1.5)
                                                        - public.cfg_num(s, '{workload,overFrom}', 0.95))));
  d := jsonb_build_object(
    'base', public.cfg_num(s, '{base}', 50),
    'benefits', least(public.cfg_num(s, '{benefitsMax}', 40), greatest(0, p_benefits)),
    'wages', -public.cfg_num(s, '{wages,unpaidMaxLoss}', 25) * (1 - least(10000, greatest(0, p_pay_factor_bps)) / 10000.0)
             - public.cfg_num(s, '{wages,moodMaxLoss}', 10) * (1 - least(10000, greatest(0, p_pay_mood_bps)) / 10000.0),
    'workload', case when v_over > 0 then -public.cfg_num(s, '{workload,overMaxLoss}', 12) * v_over
                     when p_utilization < public.cfg_num(s, '{workload,underBelow}', 0.35) then -public.cfg_num(s, '{workload,underLoss}', 4)
                     else 0 end,
    'crisis', case when coalesce(p_crisis, 0) > 0
                   then -(public.cfg_num(s, '{crisis,perSeverity}', 4) * least(3, p_crisis)
                          + case when p_scandal then public.cfg_num(s, '{crisis,scandal}', 6) else 0 end)
                   else 0 end,
    'layoffs', -least(public.cfg_num(s, '{layoffs,max}', 15), greatest(0, p_layoff_heat)),
    'greed', -public.cfg_num(s, '{greedMaxLoss}', 10) * public.listed_greed_share(p_payout_ratio_bps),
    'success', case when p_profit > 0 then public.cfg_num(s, '{success,profitHour}', 3)
                    when p_profit < 0 then public.cfg_num(s, '{success,lossHour}', -3) else 0 end);
  select sum(v::double precision) into v_sum from jsonb_each_text(d) x(k, v);
  return jsonb_build_object('target', least(100.0, greatest(0.0, v_sum)), 'drivers', d);
end;
$$;

-- satisfactionEffect: capacity factor and quality add-on (never positive) of the mood
create or replace function public.listed_satisfaction_effect(p_value double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s       jsonb := coalesce(public.listed_cfg() -> 'satisfaction', '{}'::jsonb);
  v       double precision := least(100.0, greatest(0.0, coalesce(p_value, 0)));
  v_green double precision := public.cfg_num(s, '{green}', 60);
  v_x     double precision;
begin
  if v >= v_green then
    v_x := least(1.0, greatest(0.0, (v - v_green) / greatest(1.0, public.cfg_num(s, '{effect,highFull}', 90) - v_green)));
    return jsonb_build_object('capacity_factor', 1 + public.cfg_num(s, '{effect,highCapacityMaxGain}', 0.06) * v_x, 'quality_add', 0);
  end if;
  v_x := (v_green - v) / v_green;
  return jsonb_build_object('capacity_factor', 1 - public.cfg_num(s, '{effect,lowCapacityMaxLoss}', 0.3) * v_x,
                            'quality_add', -public.cfg_num(s, '{effect,lowQualityMaxLoss}', 0.15) * v_x);
end;
$$;

-- reputationTarget: where the reputation is heading, with its drivers
create or replace function public.listed_reputation_target(p_items double precision, p_payout bigint, p_profit bigint,
  p_revenue bigint, p_invested bigint, p_dividends bigint, p_streak integer, p_scandal boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r       jsonb := coalesce(public.listed_cfg() -> 'reputation', '{}'::jsonb);
  v_base  double precision := greatest(p_profit, p_revenue * public.cfg_num(r, '{minProfitShareOfRevenue}', 0.05), 1);
  v_ratio integer := public.listed_payout_ratio_bps(p_payout, p_profit, p_revenue);
  d       jsonb;
  v_sum   double precision;
begin
  d := jsonb_build_object(
    'base', public.cfg_num(r, '{base}', 50),
    'items', coalesce(p_items, 0),
    'greed', -public.cfg_num(r, '{greed,maxLoss}', 35) * public.listed_greed_share(v_ratio),
    'reinvest', public.cfg_num(r, '{reinvest,maxGain}', 12)
                * least(1.0, greatest(0.0, greatest(0, p_invested) * 10000.0 / v_base / public.cfg_num(r, '{reinvest,fullRatioBps}', 5000))),
    'dividends', public.cfg_num(r, '{dividend,maxGain}', 12)
                 * least(1.0, greatest(0.0, greatest(0, p_dividends) * 10000.0 / v_base / public.cfg_num(r, '{dividend,fullRatioBps}', 2000)))
                 + least(public.cfg_num(r, '{dividend,streakMax}', 6), greatest(0, coalesce(p_streak, 0)))
                   * public.cfg_num(r, '{dividend,streakPerDay}', 1),
    'scandal', case when p_scandal then -public.cfg_num(r, '{scandalLoss}', 5) else 0 end);
  select sum(v::double precision) into v_sum from jsonb_each_text(d) x(k, v);
  return jsonb_build_object('target', least(100.0, greatest(0.0, v_sum)), 'drivers', d, 'payout_ratio_bps', v_ratio);
end;
$$;

-- listedHourEffect: items, mood and reputation as the terms of the hourly close
create or replace function public.listed_hour_effect_calc(p_effects jsonb, p_satisfaction double precision, p_reputation double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg   jsonb := public.listed_cfg();
  v_sat jsonb := public.listed_satisfaction_effect(p_satisfaction);
  v_x   double precision := (least(100.0, greatest(0.0, coalesce(p_reputation, 50))) - 50) / 50.0;
begin
  return jsonb_build_object(
    'awareness_add', public.cfg_num(p_effects, '{awarenessBps}', 0) / 10000.0,
    'quality_add', public.cfg_num(p_effects, '{qualityBps}', 0) / 10000.0 + (v_sat ->> 'quality_add')::double precision,
    'demand_factor', (1 + public.cfg_num(p_effects, '{demandBps}', 0) / 10000.0) * (1 + public.cfg_num(p_effects, '{marketBps}', 0) / 10000.0)
                     * (1 + public.cfg_num(cfg, '{reputation,demandMaxEffect}', 0.2) * v_x),
    'capacity_factor', greatest(0.1, 1 + public.cfg_num(p_effects, '{capacityBps}', 0) / 10000.0) * (v_sat ->> 'capacity_factor')::double precision,
    'cogs_factor', greatest(0.5, 1 - public.cfg_num(p_effects, '{marginBps}', 0) / 10000.0),
    'fixed_factor', greatest(0.5, 1 + public.cfg_num(p_effects, '{fixedCostBps}', 0) / 10000.0));
end;
$$;

-- Money earmarked by the board (0 for every company without budgets)
create or replace function public.listed_reserved_cents(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(b.amount_cents) from public.company_budgets b where b.company_id = p_company), 0)::bigint;
$$;

-- Free cash: company cash minus open bills minus earmarked money
create or replace function public.listed_free_cash(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.balance_cents from public.ledger_accounts a where a.owner_company_id = p_company and a.kind = 'company_cash'), 0)
       - coalesce((select pc.unpaid_cents from public.player_companies pc where pc.company_id = p_company), 0)
       - public.listed_reserved_cents(p_company);
$$;

-- The founder's payout share is capped while a board decision holds (10 000 = no cap)
create or replace function public.listed_payout_cap_bps(p_company uuid, p_at timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select l.payout_cap_bps from public.listed_companies l
                    where l.company_id = p_company and l.payout_cap_bps is not null and l.payout_cap_until > coalesce(p_at, now())
                      and public.listed_is(p_company)), 10000);
$$;

-- Factor on the fair share price from the reputation (1 for private companies)
create or replace function public.listed_price_factor(p_company uuid)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select l.price_factor from public.listed_companies l
                    where l.company_id = p_company and public.listed_is(p_company)), 1.0);
$$;

-- One-off drop (or gain) of the reputation
create or replace function public.listed_reputation_bump(p_company uuid, p_points double precision)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.listed_companies set reputation = least(100.0, greatest(0.0, reputation + coalesce(p_points, 0)))
   where company_id = p_company;
$$;

-- ---------------------------------------------------------------------------
-- D. The operating hour
-- ---------------------------------------------------------------------------
-- Terms of the hour; neutral for private companies
create or replace function public.listed_hour_effect(p_company uuid, p_hour_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listed_companies;
begin
  l := public.listed_ensure(p_company);
  if l.company_id is null then
    return jsonb_build_object('awareness_add', 0, 'quality_add', 0, 'demand_factor', 1, 'capacity_factor', 1,
                              'cogs_factor', 1, 'fixed_factor', 1, 'listed', false);
  end if;
  return public.listed_hour_effect_calc(public.listed_effects(p_company), l.satisfaction, l.reputation)
         || jsonb_build_object('listed', true);
end;
$$;

-- Hourly wage of the tax advisor
create or replace function public.listed_advisor_wage(p_ref bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(public.cfg_num(public.listed_cfg(), '{taxes,advisor,minWageCentsPerHour}', 4000)::bigint,
                  round(p_ref::numeric * public.cfg_num(public.listed_cfg(), '{taxes,advisor,revenueBps}', 100)::numeric / 10000)::bigint);
$$;

-- Running costs of the hour: every active item is paid from the cash (one booking per category); what the cash
-- cannot pay pauses until it can. Returns what was paid (it counts as fixed costs of the hour).
create or replace function public.listed_hour_costs(p_company uuid, p_hour_start timestamptz, p_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  l        public.listed_companies;
  pc       public.player_companies;
  v_acc    uuid;
  v_hh     uuid := public.ledger_system_account('households');
  v_ref    bigint;
  v_heads  integer;
  v_left   bigint;
  v_up     bigint;
  v_cat    text;
  v_sums   jsonb := '{}'::jsonb;
  v_total  bigint := 0;
  v_amount bigint;
  r        record;
begin
  l := public.listed_ensure(p_company);
  if l.company_id is null then
    return 0;
  end if;
  select * into pc from public.player_companies where company_id = p_company;
  v_acc := public.company_cash_account(p_company);
  v_ref := public.listed_ref_revenue(p_company);
  v_heads := public.company_headcount(p_company);
  select greatest(0, a.balance_cents) into v_left from public.ledger_accounts a where a.id = v_acc;
  for r in select ci.key, ci.kind, ci.level, ci.status from public.company_investments ci
            where ci.company_id = p_company and ci.status in ('active', 'paused') and ci.level > 0 and ci.kind <> 'action'
            order by array_position(array['product', 'region', 'machine', 'acquisition', 'licence', 'research', 'benefit'], ci.kind), ci.key loop
    v_up := public.listed_item_upkeep(public.listed_item(r.key), r.level, v_ref, v_heads);
    continue when public.listed_item(r.key) is null;
    if v_up <= v_left then
      v_left := v_left - v_up;
      if v_up > 0 then
        v_cat := public.listed_kind_category(r.kind);
        v_sums := v_sums || jsonb_build_object(v_cat, coalesce((v_sums ->> v_cat)::bigint, 0) + v_up);
      end if;
      if r.status = 'paused' then
        update public.company_investments set status = 'active' where company_id = p_company and key = r.key;
      end if;
    elsif r.status = 'active' then
      update public.company_investments set status = 'paused' where company_id = p_company and key = r.key;
    end if;
  end loop;
  -- the tax advisor leaves when the wage cannot be paid
  if l.advisor then
    v_up := public.listed_advisor_wage(v_ref);
    if v_up <= v_left then
      v_left := v_left - v_up;
      v_sums := v_sums || jsonb_build_object('advisor', v_up);
    else
      update public.listed_companies set advisor = false where company_id = p_company;
      perform public.social_notify(pc.founder_id, 'tax_office', 'Steuerberater hat gekündigt',
        'Die Kasse reichte nicht für das Honorar. Du machst die Bücher wieder selbst.',
        jsonb_build_object('company_id', p_company), '/company', 'advisor-gone:' || p_key);
    end if;
  end if;
  for v_cat, v_amount in select k, v::bigint from jsonb_each_text(v_sums) x(k, v) loop
    perform public.ledger_transfer(v_acc, v_hh, v_amount, 'company_costs',
      case v_cat when 'product' then 'Produkte: laufende Kosten' when 'expansion' then 'Standorte und Anlagen: laufende Kosten'
                 when 'benefit' then 'Benefits fürs Team' when 'advisor' then 'Steuerberater' else 'Laufende Kosten' end,
      'company', p_company, p_key || ':lx:' || v_cat, pc.founder_id, jsonb_build_object('cat', v_cat));
    v_total := v_total + v_amount;
    if v_cat = 'benefit' then
      update public.company_budgets set amount_cents = greatest(0, amount_cents - v_amount), updated_at = now()
       where company_id = p_company and purpose = 'benefits';
    end if;
  end loop;
  update public.listed_companies set last_upkeep = v_sums, ref_revenue_cents = v_ref where company_id = p_company;
  return v_total;
end;
$$;

-- After the hour: finished projects, mood, reputation, quits, history, fair value, tax office, board.
create or replace function public.listed_hour_after(p_company uuid, p_hour_start timestamptz, p_demand double precision,
  p_capacity double precision, p_revenue bigint, p_profit bigint, p_pay_factor_bps integer, p_payout bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.listed_cfg();
  l         public.listed_companies;
  pc        public.player_companies;
  c         public.companies;
  v_end     timestamptz := p_hour_start + interval '1 hour';
  v_win     interval;
  v_fx      jsonb;
  v_eff     jsonb;
  v_acc     uuid;
  v_fired   integer;
  v_gone    integer;
  v_heat    double precision;
  v_profit  bigint;
  v_rev     bigint;
  v_pay     bigint;
  v_inv     bigint;
  v_div     bigint;
  v_ratio   integer;
  v_sev     integer;
  v_scandal boolean;
  v_st      jsonb;
  v_rt      jsonb;
  v_sat     double precision;
  v_rep     double precision;
  v_red     integer;
  v_quit    boolean := false;
  v_today   date := (now() at time zone 'Europe/Berlin')::date;
  v_quits   integer;
  v_pf      double precision;
  v_streak  integer;
  r         record;
begin
  l := public.listed_ensure(p_company);
  if l.company_id is null then
    return;
  end if;
  select * into l from public.listed_companies where company_id = p_company for update;
  select * into pc from public.player_companies where company_id = p_company;
  select * into c from public.companies where id = p_company;
  v_acc := public.company_cash_account(p_company);

  -- projects whose time is up become active (research, products, regions, machine levels)
  perform public.listed_finish_due(p_company, greatest(v_end, now()));

  v_fx := public.listed_effects(p_company);
  v_eff := public.listed_hour_effect_calc(v_fx, l.satisfaction, l.reputation);

  -- dismissals: AI workers gone since the last hour (own quits were already counted out), players fired
  select count(*) into v_fired from public.player_jobs j
   where j.company_id = p_company and j.status = 'ended' and j.end_reason = 'fired'
     and j.ended_at > coalesce(l.layoff_checked_at, now() - interval '1 hour');
  v_gone := greatest(0, coalesce(l.ai_workers_seen, pc.ai_workers) - pc.ai_workers) + coalesce(v_fired, 0);
  v_heat := greatest(0, l.layoff_heat) * (1 - public.cfg_num(cfg, '{satisfaction,layoffs,decayPerHour}', 0.08))
          + v_gone * public.cfg_num(cfg, '{satisfaction,layoffs,perHead}', 3);

  -- the reputation window: profit and revenue of the hours, payouts, withdrawals, investments, dividends
  v_win := make_interval(hours => greatest(1, public.cfg_num(cfg, '{reputation,windowHours}', 24)::integer));
  select coalesce(sum(h.profit_cents), 0), coalesce(sum(h.revenue_cents), 0), coalesce(sum(h.founder_payout_cents), 0)
    into v_profit, v_rev, v_pay
    from public.player_company_hours h where h.company_id = p_company and h.hour_start > v_end - v_win;
  v_pay := v_pay + coalesce((
    select sum(-e.amount_cents) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
     where e.account_id = v_acc and e.amount_cents < 0 and e.created_at > now() - v_win
       and t.idempotency_key like 'withdraw:%'), 0);
  select coalesce(sum(-e.amount_cents), 0) into v_inv
    from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
   where e.account_id = v_acc and e.amount_cents < 0 and e.created_at > now() - v_win
     and t.metadata ->> 'one_off' = 'true';
  select coalesce(sum(d.total_cents), 0) into v_div from public.company_dividends d
   where d.company_id = p_company and d.paid_at > now() - v_win;
  v_ratio := public.listed_payout_ratio_bps(v_pay, v_profit, v_rev);

  select max(e.severity), bool_or(coalesce(cfg #> '{satisfaction,crisis,scandals}', '[]'::jsonb) ? e.archetype)
    into v_sev, v_scandal
    from public.player_company_events e
   where e.company_id = p_company and e.polarity = 'crisis' and e.status in ('open', 'in_force');

  -- mood
  v_st := public.listed_satisfaction_target(public.cfg_num(v_fx, '{satisfaction}', 0), p_pay_factor_bps,
            public.company_pay_mood_bps(p_company), case when p_capacity > 0 then p_demand / p_capacity else 1 end,
            coalesce(v_sev, 0), coalesce(v_scandal, false), v_heat, v_ratio, p_profit);
  v_sat := least(100.0, greatest(0.0, l.satisfaction + public.cfg_num(cfg, '{satisfaction,adjustPerHour}', 0.15)
                                                       * ((v_st ->> 'target')::double precision - l.satisfaction)));
  v_red := case when v_sat < public.cfg_num(cfg, '{satisfaction,red}', 35) then l.red_hours + 1 else 0 end;
  v_quits := case when l.quits_day = v_today then l.quits_today else 0 end;
  if v_red > 0 then
    -- an AI worker leaves every N-th hour in a row in the red zone
    if pc.ai_workers > 0 and v_red % greatest(1, public.cfg_num(cfg, '{satisfaction,quits,everyRedHours}', 3)::integer) = 0 then
      update public.player_companies set ai_workers = ai_workers - 1 where company_id = p_company and ai_workers > 0;
      pc.ai_workers := pc.ai_workers - 1;
      v_quit := true;
      v_quits := v_quits + 1;
      perform public.social_notify(pc.founder_id, 'team_mood', 'Kündigung bei ' || c.name,
        'Eine KI-Kraft hat hingeschmissen: Die Stimmung ist im Keller.',
        jsonb_build_object('company_id', p_company), '/company', 'quit:' || p_company::text || ':' || p_hour_start::text);
      perform public.company_system_message(p_company, 'Eine KI-Kraft hat gekündigt. Die Stimmung im Team ist schlecht.');
      if v_quits = greatest(1, public.cfg_num(cfg, '{satisfaction,quits,massQuitFrom}', 3)::integer) then
        perform public.feed_post(pc.founder_id, 'mass_quit', jsonb_build_object('company', c.name, 'count', v_quits),
                                 'mass_quit:' || p_company::text || ':' || v_today::text);
      end if;
    end if;
    -- players are not forced out: they are told, at most once per interval
    if l.mood_notified_at is null
       or l.mood_notified_at < now() - make_interval(hours => greatest(1, public.cfg_num(cfg, '{satisfaction,quits,notifyEveryHours}', 24)::integer)) then
      for r in select j.player_id from public.player_jobs j where j.company_id = p_company and j.status = 'active' loop
        perform public.social_notify(r.player_id, 'team_mood', 'Miese Stimmung bei ' || c.name,
          'Die Zufriedenheit im Team ist im roten Bereich. Vielleicht ist ein anderer Job besser für dich.',
          jsonb_build_object('company_id', p_company), '/career', 'mood:' || p_company::text || ':' || v_today::text);
      end loop;
      perform public.social_notify(pc.founder_id, 'team_mood', 'Stimmung im Keller',
        'Die Mitarbeiterzufriedenheit bei ' || c.name || ' ist im roten Bereich. Kapazität und Qualität sinken.',
        jsonb_build_object('company_id', p_company), '/company', 'mood-f:' || p_company::text || ':' || v_today::text);
      l.mood_notified_at := now();
    end if;
  end if;

  -- reputation
  v_streak := case when l.dividend_day is not null and l.dividend_day >= v_today - 1 then l.dividend_streak else 0 end;
  v_rt := public.listed_reputation_target(public.cfg_num(v_fx, '{reputation}', 0), v_pay, v_profit, v_rev, v_inv, v_div,
                                          v_streak, coalesce(v_scandal, false));
  v_rep := least(100.0, greatest(0.0, l.reputation + public.cfg_num(cfg, '{reputation,adjustPerHour}', 0.08)
                                                     * ((v_rt ->> 'target')::double precision - l.reputation)));
  if v_rep < public.cfg_num(cfg, '{reputation,greed,feedBelow}', 35)
     and v_ratio >= public.cfg_num(cfg, '{reputation,greed,fullRatioBps}', 10000) * 0.8 then
    perform public.feed_post(pc.founder_id, 'greedy_founder', jsonb_build_object('company', c.name, 'ratio_bps', v_ratio),
                             'greedy:' || p_company::text || ':' || v_today::text);
  end if;

  -- the fair share price follows the reputation
  v_pf := 1 + public.cfg_num(cfg, '{reputation,priceMaxEffect}', 0.25) * (v_rep - 50) / 50.0;
  if c.security_id is not null and v_pf <> l.price_factor then
    update public.security_sim_state
       set fair_value_e4 = greatest(1, round(fair_value_e4 / l.price_factor * v_pf))::bigint
     where security_id = c.security_id;
  end if;

  update public.listed_companies
     set satisfaction = v_sat, reputation = v_rep, price_factor = v_pf, layoff_heat = v_heat, layoff_checked_at = now(),
         ai_workers_seen = pc.ai_workers, red_hours = v_red, quits_day = v_today, quits_today = v_quits,
         mood_notified_at = l.mood_notified_at, dividend_streak = v_streak
   where company_id = p_company;
  insert into public.listed_company_hours (company_id, hour_start, satisfaction, sat_target, reputation, rep_target, demand_factor,
                                           capacity_factor, upkeep_cents, upkeep, drivers)
  values (p_company, p_hour_start, v_sat, (v_st ->> 'target')::double precision, v_rep, (v_rt ->> 'target')::double precision,
          (v_eff ->> 'demand_factor')::double precision, (v_eff ->> 'capacity_factor')::double precision,
          coalesce((select sum(v::bigint) from jsonb_each_text(l.last_upkeep) x(k, v)), 0), l.last_upkeep,
          jsonb_build_object('satisfaction', v_st -> 'drivers', 'reputation', v_rt -> 'drivers', 'payout_ratio_bps', v_ratio,
                             'ai_quit', v_quit))
  on conflict (company_id, hour_start) do nothing;
  delete from public.listed_company_hours h
   where h.company_id = p_company
     and h.hour_start < p_hour_start - make_interval(hours => greatest(24, public.cfg_num(cfg, '{historyHours}', 72)::integer) * 2);

  -- missions: an hour in the green zone
  if v_sat >= public.cfg_num(cfg, '{satisfaction,green}', 60) then
    perform public.mission_event(pc.founder_id, 'satisfaction_green', 1, p_hour_start::text);
  end if;

  -- the tax advisor, the tax office, the board
  perform public.listed_tax_office(p_company);
  perform public.board_close_due(p_company);
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Patches of existing functions (replace on the current definition; clear errors when the shape changed)
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.player_company_close_hour(uuid, timestamptz)'::regprocedure);
  v_old text[];
  v_new text[];
  i     integer;
begin
  if position('listed_hour_effect' in v_def) > 0 then
    return;
  end if;
  v_old := array[
    -- 1. variables
    $t$  v_momentum double precision;$t$,
    -- 2. terms of the hour, right after the campaign: awareness and quality of this hour
    $t$  v_camp := public.company_campaign_at(p_company, v_start);$t$,
    -- 3. demand
    $t$            * coalesce(pc.task_momentum, 1.0);$t$,
    -- 4. capacity
    $t$         * (v_ev ->> 'capacity_factor')::double precision / v_hours;$t$,
    -- 5. goods
    $t$v_sold * (1 - public.cfg_num(v_su, array['grossMargin', c.sector_key], 0.5))$t$,
    -- 6. fixed costs
    $t$  v_mk := round((pc.marketing_cents_per_quarter / v_hours)::numeric)::bigint;$t$,
    -- 7. running costs, part of the fixed costs and of the profit
    $t$  v_profit := v_rev - v_cogs - v_ppaid - v_aipaid - v_fixed - v_mk;$t$,
    -- 8. the board's payout cap
    $t$  v_bps := least(10000, greatest(0, coalesce(pc.founder_payout_bps, 0)));$t$,
    -- 9. earmarked money is not free cash (stakes and payout)
    $t$select a.balance_cents - v_owed into v_free from public.ledger_accounts a where a.id = v_acc;$t$,
    -- 10. after the hour
    $t$  return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'quarter_id', v_qid, 'revenue_cents', v_rev,$t$];
  v_new := array[
    $t$  v_momentum double precision;
  v_lx      jsonb;
  v_lxc     bigint := 0;$t$,
    $t$  v_camp := public.company_campaign_at(p_company, v_start);
  -- listed companies (ADR-167): research, products, regions, benefits, mood and reputation as terms of the hour
  v_lx := public.listed_hour_effect(p_company, v_start);
  pc.awareness := least(1.0, pc.awareness + (v_lx ->> 'awareness_add')::double precision);
  pc.quality := least(1.0, greatest(0.0, pc.quality + (v_lx ->> 'quality_add')::double precision));$t$,
    $t$            * coalesce(pc.task_momentum, 1.0)
            * (v_lx ->> 'demand_factor')::double precision;$t$,
    $t$         * (v_ev ->> 'capacity_factor')::double precision
         * (v_lx ->> 'capacity_factor')::double precision / v_hours;$t$,
    $t$v_sold * (1 - public.cfg_num(v_su, array['grossMargin', c.sector_key], 0.5)) * (v_lx ->> 'cogs_factor')::double precision$t$,
    $t$  v_fixed := round(v_fixed * (v_lx ->> 'fixed_factor')::double precision)::bigint;  -- ADR-167
  v_mk := round((pc.marketing_cents_per_quarter / v_hours)::numeric)::bigint;$t$,
    $t$  -- listed companies (ADR-167): running costs of products, regions, machines, benefits and the tax advisor
  v_lxc := public.listed_hour_costs(p_company, v_start, k);
  v_fixed := v_fixed + v_lxc;
  v_paid := v_paid + v_lxc;
  v_profit := v_rev - v_cogs - v_ppaid - v_aipaid - v_fixed - v_mk;$t$,
    $t$  v_bps := least(10000, greatest(0, least(coalesce(pc.founder_payout_bps, 0), public.listed_payout_cap_bps(p_company, v_start))));$t$,
    $t$select a.balance_cents - v_owed - public.listed_reserved_cents(p_company) into v_free from public.ledger_accounts a where a.id = v_acc;$t$,
    $t$  perform public.listed_hour_after(p_company, v_start, v_demand, v_cap, v_rev, v_profit, v_factor, v_payout);  -- ADR-167
  return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'quarter_id', v_qid, 'revenue_cents', v_rev,$t$];
  for i in 1 .. array_length(v_old, 1) loop
    if position(v_old[i] in v_def) = 0 then
      raise exception 'player_company_close_hour() has an unexpected shape: anchor % of the listed company hooks (ADR-167) is missing: %',
        i, v_old[i];
    end if;
    v_def := replace(v_def, v_old[i], v_new[i]);
  end loop;
  execute v_def;
end;
$do$;

-- company_withdraw: earmarked money is not free, the board can forbid withdrawals
do $do$
declare
  v_def text := pg_get_functiondef('public.company_withdraw(uuid, bigint)'::regprocedure);
  v_a   text := $t$  select a.balance_cents - pc.unpaid_cents into v_free$t$;
  v_b   text := $t$  perform 1 from public.player_companies pc where pc.company_id = v_company for update;$t$;
begin
  if position('listed_withdraw_check' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 or position(v_b in v_def) = 0 then
    raise exception 'company_withdraw() has an unexpected shape; add the checks of the listed company (ADR-167) by hand';
  end if;
  v_def := replace(v_def, v_b, v_b || $t$
  perform public.listed_withdraw_check(v_company, p_amount_cents);  -- ADR-167$t$);
  v_def := replace(v_def, v_a, $t$  select a.balance_cents - pc.unpaid_cents - public.listed_reserved_cents(v_company) into v_free$t$);
  execute v_def;
end;
$do$;

-- A withdrawal of a listed company: forbidden while the board's ban holds; money earmarked by the board is not free
create or replace function public.listed_withdraw_check(p_company uuid, p_amount_cents bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free bigint;
begin
  if not public.listed_is(p_company) then
    return;
  end if;
  if exists (select 1 from public.listed_companies l where l.company_id = p_company and l.withdraw_block_until > now()) then
    perform public.api_error('withdraw_blocked');
  end if;
  if public.listed_reserved_cents(p_company) > 0 then
    select a.balance_cents - pc.unpaid_cents into v_free
      from public.ledger_accounts a join public.player_companies pc on pc.company_id = a.owner_company_id
     where a.owner_company_id = p_company and a.kind = 'company_cash';
    if coalesce(v_free, 0) >= p_amount_cents and public.listed_free_cash(p_company) < p_amount_cents then
      perform public.api_error('budget_reserved');
    end if;
  end if;
end;
$$;

-- set_founder_payout: not above the board's cap
do $do$
declare
  v_def text := pg_get_functiondef('public.set_founder_payout(uuid, integer)'::regprocedure);
  v_a   text := $t$  update public.player_companies set founder_payout_bps = p_bps where company_id = v_company;$t$;
begin
  if position('listed_payout_cap_bps' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 then
    raise exception 'set_founder_payout() has an unexpected shape; add the payout cap of the board (ADR-167) by hand';
  end if;
  execute replace(v_def, v_a, $t$  if p_bps > public.listed_payout_cap_bps(v_company, now()) then
    perform public.api_error('payout_capped');  -- ADR-167
  end if;
$t$ || v_a);
end;
$do$;

-- set_company_strategy: the board can fix the price level
do $do$
declare
  v_def text := pg_get_functiondef('public.set_company_strategy(uuid, text, boolean)'::regprocedure);
  v_a   text := $t$  update public.player_companies set price_level = p_price_level, contract_work = p_contract_work where company_id = v_company;$t$;
begin
  if position('strategy_locked' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 then
    raise exception 'set_company_strategy() has an unexpected shape; add the price lock of the board (ADR-167) by hand';
  end if;
  execute replace(v_def, v_a, $t$  if exists (select 1 from public.listed_companies l
              where l.company_id = v_company and l.price_lock is not null and l.price_lock_until > now()
                and l.price_lock <> p_price_level and public.listed_is(v_company)) then
    perform public.api_error('strategy_locked');  -- ADR-167
  end if;
$t$ || v_a);
end;
$do$;

-- company_dissolve: open taxes are paid from the cash first, motions end, budgets go
do $do$
declare
  v_def text := pg_get_functiondef('public.company_dissolve(uuid, text)'::regprocedure);
  v_a   text := $t$  k := 'dissolve:' || p_company::text;$t$;
begin
  if position('listed_before_dissolve' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 then
    raise exception 'company_dissolve() has an unexpected shape; add listed_before_dissolve (ADR-167) by hand';
  end if;
  execute replace(v_def, v_a, v_a || $t$
  perform public.listed_before_dissolve(p_company);  -- ADR-167$t$);
end;
$do$;

-- player_company_close_quarter: the fair value per share follows the reputation
do $do$
declare
  v_def text := pg_get_functiondef('public.player_company_close_quarter(uuid, bigint)'::regprocedure);
  v_a   text := $t$       set fair_value_e4 = greatest(1, public.company_value_cents(p_company) * 100 / greatest(c.shares_outstanding, 1))$t$;
begin
  if position('listed_price_factor' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 then
    raise exception 'player_company_close_quarter() has an unexpected shape; add listed_price_factor (ADR-167) by hand';
  end if;
  execute replace(v_def, v_a, $t$       set fair_value_e4 = greatest(1, round(public.company_value_cents(p_company) * 100 / greatest(c.shares_outstanding, 1)
                                                * public.listed_price_factor(p_company))::bigint)$t$);
end;
$do$;

-- account_wipe: the player's votes and open motions go
do $do$
declare
  v_def text := pg_get_functiondef('public.account_wipe(uuid, text)'::regprocedure);
  v_old text := $t$  perform public.deals_wipe_player(p_player, p_key);$t$;
begin
  if position('listed_wipe_player' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'account_wipe() has an unexpected shape; add listed_wipe_player (ADR-167) by hand';
    end if;
    execute replace(v_def, v_old, v_old || $t$

  -- board of listed companies (ADR-167): the player's votes and open motions go
  perform public.listed_wipe_player(p_player);$t$);
  end if;
end;
$do$;

create or replace function public.listed_wipe_player(p_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.board_votes v where v.player_id = p_player;
  update public.board_motions set status = 'cancelled', closed_at = now()
   where proposer_id = p_player and status = 'open';
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.listed_cfg()', 'public.listed_item(text)', 'public.listed_is(uuid)', 'public.listed_ensure(uuid)',
    'public.listed_ref_revenue(uuid)', 'public.listed_item_cost(jsonb, integer, bigint, integer)',
    'public.listed_item_upkeep(jsonb, integer, bigint, integer)', 'public.listed_kind_category(text)',
    'public.listed_effects(uuid)', 'public.listed_greed_share(double precision)',
    'public.listed_payout_ratio_bps(bigint, bigint, bigint)',
    'public.listed_satisfaction_target(double precision, integer, integer, double precision, integer, boolean, double precision, integer, bigint)',
    'public.listed_satisfaction_effect(double precision)',
    'public.listed_reputation_target(double precision, bigint, bigint, bigint, bigint, bigint, integer, boolean)',
    'public.listed_hour_effect_calc(jsonb, double precision, double precision)', 'public.listed_reserved_cents(uuid)',
    'public.listed_free_cash(uuid)', 'public.listed_payout_cap_bps(uuid, timestamptz)', 'public.listed_price_factor(uuid)',
    'public.listed_reputation_bump(uuid, double precision)', 'public.listed_hour_effect(uuid, timestamptz)',
    'public.listed_advisor_wage(bigint)', 'public.listed_hour_costs(uuid, timestamptz, text)',
    'public.listed_hour_after(uuid, timestamptz, double precision, double precision, bigint, bigint, integer, bigint)',
    'public.listed_withdraw_check(uuid, bigint)', 'public.listed_wipe_player(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
