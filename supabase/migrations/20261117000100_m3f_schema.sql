-- =============================================================================
-- NEXA · M3f · 0100 · Schema: logos, tiers GmbH/AG, share offers (ADR-065..067)
-- =============================================================================
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- Error keys (M3f: NX058..NX060)
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
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- A. Logos
-- ---------------------------------------------------------------------------
alter table public.player_companies
  add column if not exists logo         jsonb check (logo is null or pg_column_size(logo) < 8192),
  add column if not exists logo_version integer not null default 0,
  add column if not exists logo_hidden  boolean not null default false;
comment on column public.player_companies.logo is 'Pixel logo {palette: [#rrggbb], grid: [16 x 16 chars]} from the editor (ADR-065).';
comment on column public.player_companies.logo_hidden is 'Hidden after startups.logo reports (3) until the founder sets a new logo.';
grant select (logo, logo_version, logo_hidden) on public.player_companies to authenticated;

create table if not exists public.company_logo_reports (
  company_id   uuid not null references public.player_companies (company_id) on delete cascade,
  logo_version integer not null,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (company_id, logo_version, reporter_id)
);
alter table public.company_logo_reports enable row level security;
create index if not exists company_logo_reports_reporter_idx on public.company_logo_reports (reporter_id);
comment on table public.company_logo_reports is 'One report per player and logo version. Internal.';

-- ---------------------------------------------------------------------------
-- D. Tiers: GmbH and AG
-- ---------------------------------------------------------------------------
do $$
declare
  v_con text;
begin
  select c.conname into v_con from pg_constraint c
   where c.conrelid = 'public.player_companies'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ~ 'garage' and pg_get_constraintdef(c.oid) !~ 'gmbh';
  if v_con is not null then
    execute format('alter table public.player_companies drop constraint %I', v_con);
    alter table public.player_companies add constraint player_companies_tier_check
      check (tier in ('garage', 'small_business', 'gmbh', 'ag'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Share offers (IPO, capital increase) and subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.company_share_offers (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  kind                 text not null check (kind in ('ipo', 'capital_increase')),
  price_cents          bigint not null check (price_cents > 0),
  shares_total_e6      bigint not null check (shares_total_e6 > 0),
  shares_offered_e6    bigint not null check (shares_offered_e6 > 0),
  shares_subscribed_e6 bigint not null default 0 check (shares_subscribed_e6 >= 0),
  shares_ai_e6         bigint not null default 0 check (shares_ai_e6 >= 0),
  status               text not null default 'open' check (status in ('open', 'closed')),
  security_id          uuid references public.securities (id),
  request_id           uuid,
  created_at           timestamptz not null default now(),
  ends_at              timestamptz not null,
  closed_at            timestamptz,
  check (shares_subscribed_e6 + shares_ai_e6 <= shares_offered_e6)
);
alter table public.company_share_offers enable row level security;
create index if not exists company_share_offers_company_idx on public.company_share_offers (company_id, created_at desc);
create index if not exists company_share_offers_open_idx on public.company_share_offers (status, ends_at) where status = 'open';
create index if not exists company_share_offers_security_idx on public.company_share_offers (security_id);
comment on table public.company_share_offers is 'IPO and capital increases of player companies (ADR-067). Public read.';

create table if not exists public.offer_subscriptions (
  id           bigint generated always as identity primary key,
  offer_id     uuid not null references public.company_share_offers (id) on delete cascade,
  player_id    uuid not null references public.profiles (id) on delete cascade,
  shares_e6    bigint not null check (shares_e6 > 0),
  amount_cents bigint not null check (amount_cents > 0),
  created_at   timestamptz not null default now()
);
alter table public.offer_subscriptions enable row level security;
create index if not exists offer_subscriptions_offer_idx on public.offer_subscriptions (offer_id);
create index if not exists offer_subscriptions_player_idx on public.offer_subscriptions (player_id, created_at desc);
comment on table public.offer_subscriptions is 'Subscriptions to share offers; the shares are delivered at the end of the subscription.';

do $$
begin
  revoke all on public.company_logo_reports from public, anon, authenticated;
  grant all on public.company_logo_reports to service_role;

  revoke all on public.company_share_offers from public, anon, authenticated;
  grant select on public.company_share_offers to authenticated;
  grant all on public.company_share_offers to service_role;
  drop policy if exists "public read" on public.company_share_offers;
  create policy "public read" on public.company_share_offers for select to authenticated using (true);

  revoke all on public.offer_subscriptions from public, anon, authenticated;
  grant select on public.offer_subscriptions to authenticated;
  grant all on public.offer_subscriptions to service_role;
  drop policy if exists "owner read" on public.offer_subscriptions;
  create policy "owner read" on public.offer_subscriptions for select to authenticated using (player_id = (select auth.uid()));
end;
$$;
