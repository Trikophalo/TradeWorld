-- =============================================================================
-- NEXA · 3950 · Wohnwert and renting out places in the home (ADR-158)
-- =============================================================================
-- * Wohnwert (0..100) of a furnished home: home_wohnwert(player), port of wohnwert() in src/lib/sim/rentals.ts
--   (value of the placed pieces against the home price, variety, fill, layers, style, floor).
-- * A player with a home offers its places (rentals.places per tier) per hour or per day (rental_offers). AI
--   tenants move in by chance (Wohnwert, price against the fair rent) and pay from the households; players rent a
--   place with rent_home(). Rent is paid in advance per period through the ledger (kind rent) to the owner.
-- * Tenancies (rental_tenancies) run at least rentals.minHours; notice ends them at the first period end after
--   rentals.noticeHours. A player tenant who cannot pay is out at once. Payments: rental_payments.
-- * RPCs (authenticated): get_rentals(), get_rental_market(), set_rental_offer(request, period, price, open),
--   rent_home(request, owner nickname), end_tenancy(request, tenancy id). Internal: rentals_run_due(now)
--   (pg_cron nexa-rentals, every minute). get_property() adds the "rental" part (Wohnwert, places, tenants).
-- * Notifications rental_new_tenant, rental_ended, rental_rent_summary; feed home_rented (villa and up).
-- * Missions: rental_offered, tenant_found, rent_earned, wohnwert, home_rented (templates below).
-- * Errors: rent_price_out_of_range NX140, rent_own_home NX141, rental_not_offered NX142, rental_full NX143,
--   already_renting NX144, tenancy_not_found NX145.
-- Idempotent: runs unchanged as supabase/updates/20261204003950_rentals.sql.

-- ---------------------------------------------------------------------------
-- A. Error keys
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
  v_new text := $q$    when 'rent_price_out_of_range'    then 'NX140'
    when 'rent_own_home'              then 'NX141'
    when 'rental_not_offered'         then 'NX142'
    when 'rental_full'                then 'NX143'
    when 'already_renting'            then 'NX144'
    when 'tenancy_not_found'          then 'NX145'
    else 'NX007'$q$;
begin
  if position('''tenancy_not_found''' in v_def) = 0 then
    if position($q$    else 'NX007'$q$ in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the rental error keys by hand';
    end if;
    execute replace(v_def, $q$    else 'NX007'$q$, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- B. Notification types
-- ---------------------------------------------------------------------------
insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values
  ('rental_new_tenant', 'economy', 'Neuer Mieter', 'Jemand ist in dein Zuhause eingezogen.', 'notif_bell', true, true, false, 300),
  ('rental_ended', 'economy', 'Mietvertrag beendet', 'Ein Mietvertrag ist ausgelaufen, gekündigt oder geplatzt.', 'notif_bell',
   true, false, false, 301),
  ('rental_rent_summary', 'economy', 'Mieteinnahmen', 'Einmal am Tag: was deine Mieter gestern gezahlt haben.', 'notif_bell',
   true, false, false, 302)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- C. Tables (internal: read and written only by the RPCs and the job below)
-- ---------------------------------------------------------------------------
create table if not exists public.rental_offers (
  owner_id    uuid primary key references public.profiles (id) on delete cascade,
  period      text not null check (period in ('hour', 'day')),
  price_cents bigint not null check (price_cents > 0),
  is_open     boolean not null default true,
  ai_check_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rental_offers_open_idx on public.rental_offers (ai_check_at) where is_open;
alter table public.rental_offers enable row level security;
drop trigger if exists set_updated_at on public.rental_offers;
create trigger set_updated_at before update on public.rental_offers for each row execute function public.set_updated_at();
revoke all on public.rental_offers from public, anon, authenticated;
grant all on public.rental_offers to service_role;
comment on table public.rental_offers is
  'Offer of a player to rent out the places of the own home (ADR-158): period hour|day, price per place. Internal (RPCs).';

create table if not exists public.rental_tenancies (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  tenant_id   uuid references public.profiles (id) on delete set null,
  is_ai       boolean not null,
  tenant_name text not null check (char_length(tenant_name) between 1 and 40),
  period      text not null check (period in ('hour', 'day')),
  price_cents bigint not null check (price_cents > 0),
  started_at  timestamptz not null,
  next_due_at timestamptz not null,
  ends_at     timestamptz,
  notice_by   text check (notice_by in ('tenant', 'owner')),
  status      text not null default 'active' check (status in ('active', 'ended')),
  end_reason  text check (end_reason in ('notice_tenant', 'notice_owner', 'unpaid', 'ai_left', 'ai_unhappy', 'account_reset')),
  ended_at    timestamptz,
  paid_cents  bigint not null default 0 check (paid_cents >= 0),
  xp_total    integer not null default 0 check (xp_total >= 0),
  created_at  timestamptz not null default now(),
  constraint rental_tenancies_tenant check (is_ai or tenant_id is not null or status = 'ended'),
  constraint rental_tenancies_not_self check (tenant_id is distinct from owner_id)
);
create index if not exists rental_tenancies_owner_idx on public.rental_tenancies (owner_id, status);
create index if not exists rental_tenancies_tenant_idx on public.rental_tenancies (tenant_id, status);
create index if not exists rental_tenancies_due_idx on public.rental_tenancies (next_due_at) where status = 'active';
create index if not exists rental_tenancies_ends_idx on public.rental_tenancies (ends_at) where status = 'active';
alter table public.rental_tenancies enable row level security;
revoke all on public.rental_tenancies from public, anon, authenticated;
grant all on public.rental_tenancies to service_role;
comment on table public.rental_tenancies is
  'A place rented in a home (ADR-158): an AI tenant (households pay) or a player; paid in advance per period. Internal.';

create table if not exists public.rental_payments (
  id           bigint generated always as identity primary key,
  tenancy_id   uuid not null references public.rental_tenancies (id) on delete cascade,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  tenant_id    uuid references public.profiles (id) on delete set null,
  period_start timestamptz not null,
  amount_cents bigint not null check (amount_cents > 0),
  xp           integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint rental_payments_period_uq unique (tenancy_id, period_start)
);
create index if not exists rental_payments_owner_idx on public.rental_payments (owner_id, created_at);
create index if not exists rental_payments_tenant_idx on public.rental_payments (tenant_id);
create index if not exists rental_payments_created_idx on public.rental_payments (created_at);
alter table public.rental_payments enable row level security;
revoke all on public.rental_payments from public, anon, authenticated;
grant all on public.rental_payments to service_role;
comment on table public.rental_payments is
  'One rent payment per tenancy and period (ADR-158), kept rentals.paymentsKeepDays for the daily summary. Internal.';

-- ---------------------------------------------------------------------------
-- D. Rules (port of src/lib/sim/rentals.ts)
-- ---------------------------------------------------------------------------
create or replace function public.rentals_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('rentals'), '{
    "places": {"flat": 1, "apartment": 2, "house": 3, "villa": 4, "luxury_villa": 6},
    "baseRentCentsPerHour": {"flat": 3000, "apartment": 6000, "house": 15000, "villa": 40000, "luxury_villa": 100000},
    "fairMinShareBps": 2000, "minPriceBps": 500, "minPriceCents": 100, "maxPriceBps": 15000,
    "periods": ["hour", "day"], "minHours": 24, "noticeHours": 12,
    "ai": {"minWohnwert": 25, "chanceBps": 6000, "maxPriceFactorBps": 20000, "checkEveryMinutes": 60,
           "stayMinHours": 24, "stayMaxHours": 120,
           "names": ["Anja K.", "Ben S.", "Carla M.", "Deniz Y.", "Elif A.", "Finn H.", "Greta W.", "Hannes B.", "Ida L.",
                     "Jonas P.", "Kira T.", "Luca R.", "Mia F.", "Nils O.", "Olga V.", "Paul D.", "Rosa N.", "Sami E.",
                     "Tilda G.", "Udo Z.", "Vera C.", "Willi J.", "Yara I.", "Zoe Q."]},
    "tenantXpPerHour": 5, "maxTenanciesAsTenant": 1, "feedMinTier": "villa", "paymentsKeepDays": 30, "marketLimit": 30,
    "wohnwert": {"valueTargetBps": 2000,
                 "points": {"value": 30, "variety": 20, "fill": 20, "layers": 10, "style": 10, "floor": 10},
                 "varietyTarget": 7, "fill": {"idealMinBps": 3000, "idealMaxBps": 5500, "zeroAtBps": 8500},
                 "styleMinPieces": 6,
                 "floorPoints": {"laminate": 0, "carpet": 3, "tiles": 4, "parquet": 6, "stone": 7, "marble": 9, "gold": 10}}
  }'::jsonb);
$$;
comment on function public.rentals_cfg() is 'Internal: game_config rentals (ADR-158) with the balance.ts values as fallback.';

-- wohnwert(): the Wohnwert of the player's home as it is furnished now; null without a home
create or replace function public.home_wohnwert(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        jsonb := public.rentals_cfg() -> 'wohnwert';
  v_tier   text;
  v_floor  text;
  t        jsonb;
  v_area   bigint;
  v_value  bigint;
  v_target bigint;
  v_cats   integer;
  v_cov    bigint;
  v_bps    bigint;
  v_rugs   integer;
  v_tops   integer;
  v_n      integer;
  v_top    integer;
  p_val    integer := (c #>> '{points,value}')::integer;
  p_var    integer := (c #>> '{points,variety}')::integer;
  p_fill   integer := (c #>> '{points,fill}')::integer;
  p_lay    integer := (c #>> '{points,layers}')::integer;
  p_sty    integer := (c #>> '{points,style}')::integer;
  p_flo    integer := (c #>> '{points,floor}')::integer;
  v_vtgt   integer := (c ->> 'varietyTarget')::integer;
  v_imin   bigint := (c #>> '{fill,idealMinBps}')::bigint;
  v_imax   bigint := (c #>> '{fill,idealMaxBps}')::bigint;
  v_zero   bigint := (c #>> '{fill,zeroAtBps}')::bigint;
  v_smin   integer := (c ->> 'styleMinPieces')::integer;
  s_value  integer;
  s_var    integer;
  s_fill   integer;
  s_lay    integer;
  s_sty    integer := 0;
  s_flo    integer;
begin
  select h.tier, h.floor into v_tier, v_floor from public.player_homes h where h.player_id = p_player;
  t := public.property_tier(v_tier);
  if t is null then
    return null;
  end if;
  v_area := greatest(1, (t ->> 'width')::bigint * (t ->> 'height')::bigint);
  select coalesce(sum(k.price_cents), 0)::bigint, count(distinct k.category)::integer,
         coalesce(sum(k.width::bigint * k.height) filter (where k.layer = 'object'), 0)::bigint,
         (count(*) filter (where k.layer = 'floor'))::integer, (count(*) filter (where k.layer = 'top'))::integer,
         count(*)::integer
    into v_value, v_cats, v_cov, v_rugs, v_tops, v_n
    from public.player_furniture f join public.furniture_catalog k on k.key = f.item_key
   where f.player_id = p_player and f.placed;
  select coalesce(max(x.n), 0)::integer into v_top
    from (select count(*) as n from public.player_furniture f join public.furniture_catalog k on k.key = f.item_key
           where f.player_id = p_player and f.placed group by k.tier) x;

  v_target := greatest(1, (t ->> 'priceCents')::bigint * (c ->> 'valueTargetBps')::bigint / 10000);
  s_value := least(p_val::bigint, p_val::bigint * v_value / v_target)::integer;
  s_var := (p_var * least(v_cats, v_vtgt) / v_vtgt)::integer;
  v_bps := v_cov * 10000 / v_area;
  s_fill := case when v_bps < v_imin then (p_fill * v_bps / v_imin)::integer
                 when v_bps <= v_imax then p_fill
                 when v_bps >= v_zero then 0
                 else (p_fill * (v_zero - v_bps) / (v_zero - v_imax))::integer end;
  s_lay := case when v_rugs > 0 then p_lay / 2 else 0 end + case when v_tops > 0 then p_lay - p_lay / 2 else 0 end;
  if v_n > 0 then
    s_sty := (p_sty::bigint * v_top * least(v_n, v_smin) / (v_n::bigint * v_smin))::integer;
  end if;
  s_flo := least(p_flo, coalesce((c #>> array['floorPoints', coalesce(v_floor, 'laminate')])::integer, 0));
  return jsonb_build_object(
    'total', least(100, s_value + s_var + s_fill + s_lay + s_sty + s_flo),
    'parts', jsonb_build_object('value', s_value, 'variety', s_var, 'fill', s_fill, 'layers', s_lay, 'style', s_sty,
                                'floor', s_flo),
    'value_cents', v_value, 'target_cents', v_target, 'categories', v_cats, 'coverage_bps', v_bps,
    'rugs', v_rugs, 'tops', v_tops, 'pieces', v_n);
end;
$$;
comment on function public.home_wohnwert(uuid) is
  'Wohnwert of a player''s home (ADR-158, port of wohnwert() in src/lib/sim/rentals.ts); null without a home.';

create or replace function public.home_wohnwert_total(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.home_wohnwert(p_player) ->> 'total')::integer, 0);
$$;

create or replace function public.rental_period_hours(p_period text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_period = 'day' then 24 else 1 end;
$$;

create or replace function public.rental_places(p_tier text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.rentals_cfg() #>> array['places', coalesce(p_tier, '')])::integer, 0);
$$;

-- fairRentCentsPerHour
create or replace function public.rental_fair_hour_cents(p_tier text, p_wohnwert integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select public.rentals_cfg() as v)
  select coalesce((c.v #>> array['baseRentCentsPerHour', p_tier])::bigint, 0)
         * ((c.v ->> 'fairMinShareBps')::bigint * 100
            + (10000 - (c.v ->> 'fairMinShareBps')::bigint) * greatest(0, least(100, coalesce(p_wohnwert, 0))))
         / 1000000
    from c;
$$;

-- rentLimits: {min_cents, max_cents, fair_cents} per period
create or replace function public.rental_limits(p_tier text, p_wohnwert integer, p_period text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select public.rentals_cfg() as v),
       x as (select public.rental_fair_hour_cents(p_tier, p_wohnwert) as fair,
                    greatest((c.v ->> 'minPriceCents')::bigint,
                             coalesce((c.v #>> array['baseRentCentsPerHour', p_tier])::bigint, 0)
                             * (c.v ->> 'minPriceBps')::bigint / 10000) as mn,
                    (c.v ->> 'maxPriceBps')::bigint as maxbps
               from c)
  select jsonb_build_object(
    'min_cents', x.mn * public.rental_period_hours(p_period),
    'max_cents', greatest(x.mn, x.fair * x.maxbps / 10000) * public.rental_period_hours(p_period),
    'fair_cents', x.fair * public.rental_period_hours(p_period))
    from x;
$$;

-- aiTenantChanceBps
create or replace function public.rental_ai_chance_bps(p_tier text, p_wohnwert integer, p_hour_cents bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select public.rentals_cfg() -> 'ai' as v),
       x as (select greatest(1, public.rental_fair_hour_cents(p_tier, p_wohnwert)) as fair)
  select case when coalesce(p_wohnwert, 0) < (c.v ->> 'minWohnwert')::integer then 0
              else least(10000, (c.v ->> 'chanceBps')::bigint * least(100, p_wohnwert)
                                * greatest(0, least((c.v ->> 'maxPriceFactorBps')::bigint, 20000 - p_hour_cents * 10000 / x.fair))
                                / 1000000)::integer end
    from c, x;
$$;

-- aiStayHours
create or replace function public.rental_stay_hours(p_roll double precision, p_period text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select public.rentals_cfg() -> 'ai' as v),
       x as (select (c.v ->> 'stayMinHours')::integer as mn,
                    (c.v ->> 'stayMaxHours')::integer - (c.v ->> 'stayMinHours')::integer + 1 as span from c)
  select (ceil((x.mn + least(x.span - 1, floor(greatest(0, p_roll) * x.span)::integer))::numeric
               / public.rental_period_hours(p_period)) * public.rental_period_hours(p_period))::integer
    from x;
$$;

-- noticeEndMs: first period end >= max(start + minHours, now + noticeHours)
create or replace function public.rental_notice_end(p_started timestamptz, p_now timestamptz, p_period text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select public.rentals_cfg() as v),
       x as (select greatest(p_started + make_interval(hours => (c.v ->> 'minHours')::integer),
                             p_now + make_interval(hours => (c.v ->> 'noticeHours')::integer)) as earliest,
                    public.rental_period_hours(p_period) * 3600 as secs
               from c)
  select p_started + make_interval(secs => (x.secs * greatest(1, ceil(extract(epoch from (x.earliest - p_started)) / x.secs)))::double precision)
    from x;
$$;

-- tenantXp
create or replace function public.rental_tenant_xp(p_wohnwert integer, p_hours integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce((public.rentals_cfg() ->> 'tenantXpPerHour')::bigint, 0) * greatest(0, least(100, coalesce(p_wohnwert, 0)))
          * greatest(0, p_hours) / 100)::integer;
$$;

-- ---------------------------------------------------------------------------
-- E. JSON
-- ---------------------------------------------------------------------------
-- Tenants of a home as others see them: name, AI or player (with the dressed figure), since when
create or replace function public.rental_tenants_json(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', coalesce(p.nickname, r.tenant_name), 'is_ai', r.is_ai,
           'avatar_key', p.avatar_key,
           'accessories', case when p.id is null then '[]'::jsonb else public.player_worn_accessories(p.id) end,
           'since', r.started_at)
         order by r.started_at, r.id), '[]'::jsonb)
    from public.rental_tenancies r
    left join public.profiles p on p.id = r.tenant_id
   where r.owner_id = p_owner and r.status = 'active';
$$;

-- The "rental" part of PROPERTY: Wohnwert, places, open offer, tenants; renting = where the player lives as a tenant
create or replace function public.property_rental_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'wohnwert', public.home_wohnwert_total(p_player),
    'places', public.rental_places((select h.tier from public.player_homes h where h.player_id = p_player)),
    'offer_open', coalesce((select o.is_open from public.rental_offers o where o.owner_id = p_player), false),
    'tenants', public.rental_tenants_json(p_player),
    'renting', (select jsonb_build_object('owner', o.nickname, 'tier', h.tier)
                  from public.rental_tenancies r
                  join public.profiles o on o.id = r.owner_id
                  left join public.player_homes h on h.player_id = r.owner_id
                 where r.tenant_id = p_player and r.status = 'active'
                 order by r.started_at desc limit 1));
$$;

create or replace function public.property_state(p_target uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'property', public.property_json(p_target),
    'inventory', case when p_target = p_viewer then public.property_inventory_json(p_target) end,
    'rental', public.property_rental_json(p_target));
$$;

-- RENTALS of a player: the own home (Wohnwert, limits), the offer, the tenants, the place rented elsewhere
create or replace function public.rentals_state(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tier  text;
  v_w     jsonb;
  v_total integer;
  o       public.rental_offers;
  v_home  jsonb;
  v_rent  jsonb;
begin
  select h.tier into v_tier from public.player_homes h where h.player_id = p_player;
  v_w := public.home_wohnwert(p_player);
  v_total := coalesce((v_w ->> 'total')::integer, 0);
  select * into o from public.rental_offers x where x.owner_id = p_player;
  if v_w is not null then
    v_home := jsonb_build_object(
      'tier', v_tier,
      'places', public.rental_places(v_tier),
      'wohnwert', v_w,
      'limits', jsonb_build_object('hour', public.rental_limits(v_tier, v_total, 'hour'),
                                   'day', public.rental_limits(v_tier, v_total, 'day')));
  end if;
  select jsonb_build_object(
           'id', r.id, 'owner', op.nickname, 'owner_avatar_key', op.avatar_key,
           'owner_accessories', public.player_worn_accessories(op.id),
           'tier', h.tier, 'wohnwert', public.home_wohnwert_total(r.owner_id),
           'period', r.period, 'price_cents', r.price_cents, 'started_at', r.started_at, 'next_due_at', r.next_due_at,
           'ends_at', r.ends_at, 'notice_by', r.notice_by, 'paid_cents', r.paid_cents, 'xp_total', r.xp_total,
           'property', public.property_json(r.owner_id), 'tenants', public.rental_tenants_json(r.owner_id))
    into v_rent
    from public.rental_tenancies r
    join public.profiles op on op.id = r.owner_id
    left join public.player_homes h on h.player_id = r.owner_id
   where r.tenant_id = p_player and r.status = 'active'
   order by r.started_at desc
   limit 1;
  return jsonb_build_object(
    'home', v_home,
    'offer', case when o.owner_id is null then null else jsonb_build_object(
               'period', o.period, 'price_cents', o.price_cents, 'is_open', o.is_open, 'ai_check_at', o.ai_check_at,
               'chance_bps', case when v_tier is null then 0
                                  else public.rental_ai_chance_bps(v_tier, v_total, o.price_cents / public.rental_period_hours(o.period)) end) end,
    'tenants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'name', coalesce(p.nickname, r.tenant_name), 'is_ai', r.is_ai, 'avatar_key', p.avatar_key,
               'accessories', case when p.id is null then '[]'::jsonb else public.player_worn_accessories(p.id) end,
               'period', r.period, 'price_cents', r.price_cents, 'started_at', r.started_at, 'next_due_at', r.next_due_at,
               'ends_at', r.ends_at, 'notice_by', r.notice_by, 'paid_cents', r.paid_cents)
             order by r.started_at, r.id)
        from public.rental_tenancies r left join public.profiles p on p.id = r.tenant_id
       where r.owner_id = p_player and r.status = 'active'), '[]'::jsonb),
    'past', coalesce((
      select jsonb_agg(x.j order by x.ended_at desc, x.id)
        from (select r.id, r.ended_at,
                     jsonb_build_object('id', r.id, 'name', coalesce(p.nickname, r.tenant_name), 'is_ai', r.is_ai,
                                        'ended_at', r.ended_at, 'end_reason', r.end_reason, 'paid_cents', r.paid_cents) as j
                from public.rental_tenancies r left join public.profiles p on p.id = r.tenant_id
               where r.owner_id = p_player and r.status = 'ended'
               order by r.ended_at desc, r.id limit 8) x), '[]'::jsonb),
    'earned_7d_cents', coalesce((select sum(y.amount_cents) from public.rental_payments y
                                  where y.owner_id = p_player and y.created_at > now() - interval '7 days'), 0)::bigint,
    'earned_total_cents', coalesce((select sum(r.paid_cents) from public.rental_tenancies r where r.owner_id = p_player), 0)::bigint,
    'renting', v_rent);
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Internal: charging, ending, AI tenants
-- ---------------------------------------------------------------------------
-- Ends a tenancy now and tells the player(s) involved.
create or replace function public.rental_end(p_tenancy uuid, p_reason text, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.rental_tenancies;
  v_owner  text;
  v_tenant text;
  v_why    text;
begin
  update public.rental_tenancies
     set status = 'ended', end_reason = p_reason, ended_at = p_at
   where id = p_tenancy and status = 'active'
  returning * into r;
  if r.id is null then
    return;
  end if;
  select p.nickname into v_owner from public.profiles p where p.id = r.owner_id;
  v_tenant := coalesce((select p.nickname from public.profiles p where p.id = r.tenant_id), r.tenant_name);
  v_why := case p_reason
             when 'notice_tenant' then 'Gekündigt vom Mieter.'
             when 'notice_owner' then 'Gekündigt vom Vermieter.'
             when 'unpaid' then 'Die Miete konnte nicht bezahlt werden.'
             when 'ai_unhappy' then 'Zu ungemütlich: Der Wohnwert ist unter das Minimum gefallen.'
             when 'account_reset' then 'Das Konto wurde zurückgesetzt.'
             else 'Die Mietzeit ist vorbei.' end;
  perform public.social_notify(r.owner_id, 'rental_ended', v_tenant || ' ist ausgezogen', v_why,
                               jsonb_build_object('tenancy_id', r.id, 'reason', p_reason, 'name', v_tenant), '/property',
                               'rental_end:' || r.id::text);
  if r.tenant_id is not null and p_reason <> 'account_reset' then
    perform public.social_notify(r.tenant_id, 'rental_ended', 'Mietvertrag bei ' || coalesce(v_owner, '?') || ' beendet', v_why,
                                 jsonb_build_object('tenancy_id', r.id, 'reason', p_reason, 'owner', v_owner), '/property/rentals',
                                 'rental_end:' || r.id::text);
  end if;
end;
$$;

-- Charges the due periods of one tenancy up to p_now (at most 48 at once). Returns the periods paid.
create or replace function public.rental_charge(p_tenancy uuid, p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.rental_tenancies;
  v_w    integer;
  v_cash bigint;
  v_xp   integer;
  v_got  integer;
  v_n    integer := 0;
  v_hrs  integer;
begin
  select * into r from public.rental_tenancies where id = p_tenancy and status = 'active' for update;
  if r.id is null then
    return 0;
  end if;
  v_hrs := public.rental_period_hours(r.period);
  v_w := public.home_wohnwert_total(r.owner_id);
  -- player tenant and owner: both accounts, in a fixed order (no deadlock with a payment the other way)
  if r.tenant_id is not null then
    perform public.lock_player_accounts(least(r.owner_id, r.tenant_id));
    perform public.lock_player_accounts(greatest(r.owner_id, r.tenant_id));
  end if;
  while r.next_due_at <= p_now and (r.ends_at is null or r.next_due_at < r.ends_at) and v_n < 48 loop
    if r.is_ai then
      if v_w < (public.rentals_cfg() #>> '{ai,minWohnwert}')::integer then
        perform public.rental_end(r.id, 'ai_unhappy', p_now);
        return v_n;
      end if;
      perform public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(r.owner_id, 'player_cash'),
                                     r.price_cents, 'rent', 'Miete von ' || r.tenant_name, 'rental_tenancy', r.id,
                                     'rent:' || r.id::text || ':' || to_char(r.next_due_at at time zone 'UTC', 'YYYYMMDDHH24MISS'),
                                     r.owner_id, jsonb_build_object('period', r.period, 'ai', true));
      v_xp := 0;
    else
      if r.tenant_id is null then
        perform public.rental_end(r.id, 'account_reset', p_now);
        return v_n;
      end if;
      select a.balance_cents into v_cash from public.ledger_accounts a
       where a.owner_player_id = r.tenant_id and a.kind = 'player_cash';
      if coalesce(v_cash, 0) < r.price_cents then
        perform public.rental_end(r.id, 'unpaid', p_now);
        return v_n;
      end if;
      perform public.ledger_transfer(public.ledger_player_account(r.tenant_id, 'player_cash'),
                                     public.ledger_player_account(r.owner_id, 'player_cash'),
                                     r.price_cents, 'rent', 'Miete', 'rental_tenancy', r.id,
                                     'rent:' || r.id::text || ':' || to_char(r.next_due_at at time zone 'UTC', 'YYYYMMDDHH24MISS'),
                                     r.tenant_id, jsonb_build_object('period', r.period, 'ai', false));
      v_xp := public.rental_tenant_xp(v_w, v_hrs);
      v_got := public.grant_xp(r.tenant_id, 'home_rent', v_xp,
                               'rent:' || r.id::text || ':' || to_char(r.next_due_at at time zone 'UTC', 'YYYYMMDDHH24MISS'),
                               'rental_tenancy', r.id);
      v_xp := coalesce(v_got, 0);
    end if;
    insert into public.rental_payments (tenancy_id, owner_id, tenant_id, period_start, amount_cents, xp)
    values (r.id, r.owner_id, r.tenant_id, r.next_due_at, r.price_cents, v_xp);
    perform public.loan_withhold(r.owner_id, r.price_cents,
                                 'rent:' || r.id::text || ':' || to_char(r.next_due_at at time zone 'UTC', 'YYYYMMDDHH24MISS'));
    perform public.mission_event(r.owner_id, 'rent_earned', r.price_cents, null);
    update public.rental_tenancies
       set next_due_at = next_due_at + make_interval(hours => v_hrs), paid_cents = paid_cents + r.price_cents,
           xp_total = xp_total + v_xp
     where id = r.id
    returning * into r;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- AI tenants for one open offer whose check is due: one roll per free place (p_rolls for tests, else random()).
create or replace function public.rental_ai_arrivals(p_owner uuid, p_now timestamptz, p_rolls double precision[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.rentals_cfg();
  o       public.rental_offers;
  v_tier  text;
  v_w     integer;
  v_free  integer;
  v_bps   integer;
  v_names jsonb := coalesce(cfg #> '{ai,names}', '["Mia F."]'::jsonb);
  v_name  text;
  v_id    uuid;
  v_stay  integer;
  v_n     integer := 0;
  v_roll  double precision;
  i       integer;
begin
  select * into o from public.rental_offers where owner_id = p_owner and is_open for update;
  if o.owner_id is null then
    return 0;
  end if;
  update public.rental_offers
     set ai_check_at = p_now + make_interval(mins => greatest(1, (cfg #>> '{ai,checkEveryMinutes}')::integer))
   where owner_id = p_owner;
  select h.tier into v_tier from public.player_homes h where h.player_id = p_owner;
  if v_tier is null or not exists (select 1 from public.profiles p where p.id = p_owner and not p.is_deactivated) then
    return 0;
  end if;
  v_w := public.home_wohnwert_total(p_owner);
  v_free := public.rental_places(v_tier)
            - (select count(*) from public.rental_tenancies r where r.owner_id = p_owner and r.status = 'active')::integer;
  v_bps := public.rental_ai_chance_bps(v_tier, v_w, o.price_cents / public.rental_period_hours(o.period));
  if v_free <= 0 or v_bps <= 0 then
    return 0;
  end if;
  for i in 1 .. v_free loop
    v_roll := coalesce(p_rolls[i], random());
    continue when v_roll * 10000 >= v_bps;
    v_name := v_names ->> floor(random() * jsonb_array_length(v_names))::integer;
    v_stay := public.rental_stay_hours(random(), o.period);
    insert into public.rental_tenancies (owner_id, tenant_id, is_ai, tenant_name, period, price_cents, started_at, next_due_at, ends_at)
    values (p_owner, null, true, v_name, o.period, o.price_cents, p_now, p_now, p_now + make_interval(hours => v_stay))
    returning id into v_id;
    perform public.rental_charge(v_id, p_now);
    perform public.social_notify(p_owner, 'rental_new_tenant', v_name || ' ist eingezogen',
                                 'Neu in deinem Zuhause. Miete: ' || public.format_eur(o.price_cents)
                                 || case when o.period = 'day' then ' am Tag.' else ' pro Stunde.' end,
                                 jsonb_build_object('tenancy_id', v_id, 'name', v_name, 'ai', true), '/property',
                                 'rental_new:' || v_id::text);
    perform public.mission_event(p_owner, 'tenant_found', 1, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Job (pg_cron nexa-rentals, every minute)
-- ---------------------------------------------------------------------------
create or replace function public.rentals_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.rentals_cfg();
  v_now    timestamptz := coalesce(p_now, public.game_now());
  r        record;
  v_paid   integer := 0;
  v_ended  integer := 0;
  v_moved  integer := 0;
  v_day    date := (coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date;
  v_run    bigint;
  v_notes  integer := 0;
begin
  if not pg_try_advisory_xact_lock(7311158) then
    return jsonb_build_object('skipped', 'busy');
  end if;
  -- 1. rent that is due (up to the end of the tenancy)
  for r in select t.id from public.rental_tenancies t
            where t.status = 'active' and t.next_due_at <= v_now and (t.ends_at is null or t.next_due_at < t.ends_at)
            order by t.next_due_at, t.id limit 500 loop
    v_paid := v_paid + public.rental_charge(r.id, v_now);
  end loop;
  -- 2. tenancies whose time is up
  for r in select t.id, t.is_ai, t.notice_by from public.rental_tenancies t
            where t.status = 'active' and t.ends_at <= v_now order by t.ends_at, t.id limit 500 loop
    perform public.rental_end(r.id, case r.notice_by when 'tenant' then 'notice_tenant' when 'owner' then 'notice_owner'
                                         else 'ai_left' end, v_now);
    v_ended := v_ended + 1;
  end loop;
  -- 3. AI tenants for open offers (one check per offer every ai.checkEveryMinutes)
  for r in select o.owner_id from public.rental_offers o where o.is_open and o.ai_check_at <= v_now
            order by o.ai_check_at, o.owner_id limit 200 loop
    v_moved := v_moved + public.rental_ai_arrivals(r.owner_id, v_now, null);
  end loop;
  -- 4. once a day: yesterday's rent per owner, old payments pruned
  insert into public.job_runs (job_name, run_key) values ('rental_summary', v_day::text)
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is not null then
    for r in select y.owner_id, sum(y.amount_cents)::bigint as cents, count(distinct y.tenancy_id)::integer as tenants
               from public.rental_payments y
              where y.created_at >= ((v_day - 1)::timestamp at time zone 'Europe/Berlin')
                and y.created_at < (v_day::timestamp at time zone 'Europe/Berlin')
              group by y.owner_id loop
      perform public.social_notify(r.owner_id, 'rental_rent_summary', 'Mieteinnahmen gestern: ' || public.format_eur(r.cents),
                                   case when r.tenants = 1 then 'Von einem Mieter.' else 'Von ' || r.tenants || ' Mietern.' end,
                                   jsonb_build_object('cents', r.cents, 'tenants', r.tenants, 'day', (v_day - 1)::text), '/property',
                                   'rent_summary:' || (v_day - 1)::text);
      v_notes := v_notes + 1;
    end loop;
    delete from public.rental_payments y
     where y.created_at < now() - make_interval(days => greatest(1, coalesce((cfg ->> 'paymentsKeepDays')::integer, 30)));
    delete from public.job_runs j where j.job_name = 'rental_summary' and j.started_at < now() - interval '30 days';
    update public.job_runs set status = 'succeeded', finished_at = now() where id = v_run;
  end if;
  return jsonb_build_object('paid', v_paid, 'ended', v_ended, 'moved_in', v_moved, 'summaries', v_notes);
end;
$$;
comment on function public.rentals_run_due(timestamptz) is
  'Internal, cron every minute (ADR-158): due rent, ended tenancies, AI tenants for open offers, the daily summary.';

-- Account reset or deletion: tenancies of the player end (as a tenant the owner is told), the offer and own tenants go.
create or replace function public.rentals_wipe_player(p_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select t.id from public.rental_tenancies t where t.tenant_id = p_player and t.status = 'active' loop
    perform public.rental_end(r.id, 'account_reset', public.game_now());
  end loop;
  update public.rental_payments set tenant_id = null where tenant_id = p_player;
  update public.rental_tenancies set tenant_id = null where tenant_id = p_player;
  delete from public.rental_payments where owner_id = p_player;
  delete from public.rental_tenancies where owner_id = p_player;
  delete from public.rental_offers where owner_id = p_player;
end;
$$;

-- ---------------------------------------------------------------------------
-- H. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_rentals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.rentals_state(public.require_player());
end;
$$;
comment on function public.get_rentals() is 'RPC: RENTALS of the caller (ADR-158): Wohnwert, offer, tenants, the place rented elsewhere.';

create or replace function public.get_rental_market()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_limit  integer := greatest(1, coalesce((public.rentals_cfg() ->> 'marketLimit')::integer, 30));
begin
  return jsonb_build_object('offers', coalesce((
    select jsonb_agg(x.j order by x.w desc, x.price, x.nick)
      from (select y.*
              from (select p.nickname as nick, o.price_cents / public.rental_period_hours(o.period) as price,
                           public.home_wohnwert_total(o.owner_id) as w,
                           public.rental_places(h.tier)
                             - (select count(*) from public.rental_tenancies r where r.owner_id = o.owner_id and r.status = 'active')::integer
                             as free,
                           o.*, h.tier, p.avatar_key, p.id as pid
                      from public.rental_offers o
                      join public.profiles p on p.id = o.owner_id and not p.is_deactivated
                      join public.player_homes h on h.player_id = o.owner_id and h.tier is not null
                     where o.is_open and o.owner_id <> v_player) y
             where y.free > 0
             order by y.w desc, y.price, y.nick
             limit v_limit) z
      cross join lateral (select z.w, z.price, z.nick, jsonb_build_object(
               'owner', z.nick, 'avatar_key', z.avatar_key, 'accessories', public.player_worn_accessories(z.pid),
               'tier', z.tier, 'wohnwert', z.w, 'period', z.period, 'price_cents', z.price_cents,
               'places', public.rental_places(z.tier), 'free', z.free,
               'property', public.property_json(z.pid), 'tenants', public.rental_tenants_json(z.pid)) as j) x), '[]'::jsonb));
end;
$$;
comment on function public.get_rental_market() is
  'RPC: open rental offers of other players with a free place (ADR-158), best Wohnwert first, at most rentals.marketLimit.';

create or replace function public.set_rental_offer(p_request_id uuid, p_period text, p_price_cents bigint, p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_tier   text;
  v_w      integer;
  v_lim    jsonb;
  o        public.rental_offers;
  v_now    timestamptz := public.game_now();
begin
  v_player := public.require_player();
  perform public.property_require_unlock(v_player);
  if p_request_id is null or p_period is null or p_period not in ('hour', 'day') or p_price_cents is null or p_open is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_rental_offer');
  if v_replay is not null then
    return v_replay;
  end if;
  select h.tier into v_tier from public.player_homes h where h.player_id = v_player for update;
  if public.property_tier(v_tier) is null then
    perform public.api_error('no_home');
  end if;
  v_w := public.home_wohnwert_total(v_player);
  v_lim := public.rental_limits(v_tier, v_w, p_period);
  if p_price_cents < (v_lim ->> 'min_cents')::bigint or p_price_cents > (v_lim ->> 'max_cents')::bigint then
    perform public.api_error('rent_price_out_of_range');
  end if;
  select * into o from public.rental_offers where owner_id = v_player for update;
  insert into public.rental_offers as ro (owner_id, period, price_cents, is_open, ai_check_at)
  values (v_player, p_period, p_price_cents, p_open, v_now)
  on conflict (owner_id) do update
     set period = excluded.period, price_cents = excluded.price_cents, is_open = excluded.is_open,
         ai_check_at = case when excluded.is_open and not ro.is_open then v_now else ro.ai_check_at end;
  if p_open and (o.owner_id is null or not o.is_open) then
    perform public.mission_event(v_player, 'rental_offered', 1, null);
  end if;
  return public.request_complete(v_player, p_request_id, public.rentals_state(v_player));
end;
$$;
comment on function public.set_rental_offer(uuid, text, bigint, boolean) is
  'RPC: offers (or closes) the places of the own home per hour or day at a price within rentals limits (ADR-158); '
  'errors property_locked, invalid_argument, no_home, rent_price_out_of_range.';

create or replace function public.rent_home(p_request_id uuid, p_owner text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.rentals_cfg();
  v_player uuid;
  v_replay jsonb;
  v_owner  uuid;
  v_onick  text;
  v_me     text;
  o        public.rental_offers;
  v_tier   text;
  v_cash   bigint;
  v_id     uuid;
  v_now    timestamptz := public.game_now();
  v_feed   integer;
begin
  v_player := public.require_player();
  perform public.property_require_unlock(v_player);
  if p_request_id is null or p_owner is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'rent_home');
  if v_replay is not null then
    return v_replay;
  end if;
  select p.id, p.nickname into v_owner, v_onick from public.profiles p
   where lower(p.nickname) = lower(btrim(p_owner)) and not p.is_deactivated;
  if v_owner is null then
    perform public.api_error('player_not_found');
  end if;
  if v_owner = v_player then
    perform public.api_error('rent_own_home');
  end if;
  -- the offer row serialises renting the places of one home
  select * into o from public.rental_offers where owner_id = v_owner for update;
  select h.tier into v_tier from public.player_homes h where h.player_id = v_owner;
  if o.owner_id is null or not o.is_open or public.property_tier(v_tier) is null then
    perform public.api_error('rental_not_offered');
  end if;
  perform public.lock_player_accounts(least(v_owner, v_player));
  perform public.lock_player_accounts(greatest(v_owner, v_player));
  select p.nickname into v_me from public.profiles p where p.id = v_player for update;
  if (select count(*) from public.rental_tenancies r where r.tenant_id = v_player and r.status = 'active')
     >= greatest(1, coalesce((cfg ->> 'maxTenanciesAsTenant')::integer, 1)) then
    perform public.api_error('already_renting');
  end if;
  if (select count(*) from public.rental_tenancies r where r.owner_id = v_owner and r.status = 'active') >= public.rental_places(v_tier) then
    perform public.api_error('rental_full');
  end if;
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < o.price_cents then
    perform public.api_error('insufficient_funds');
  end if;
  insert into public.rental_tenancies (owner_id, tenant_id, is_ai, tenant_name, period, price_cents, started_at, next_due_at)
  values (v_owner, v_player, false, left(v_me, 40), o.period, o.price_cents, v_now, v_now)
  returning id into v_id;
  perform public.rental_charge(v_id, v_now);
  perform public.social_notify(v_owner, 'rental_new_tenant', v_me || ' ist eingezogen',
                               v_me || ' mietet einen Platz in deinem Zuhause für ' || public.format_eur(o.price_cents)
                               || case when o.period = 'day' then ' am Tag.' else ' pro Stunde.' end,
                               jsonb_build_object('tenancy_id', v_id, 'name', v_me, 'ai', false), '/players/' || v_me,
                               'rental_new:' || v_id::text);
  perform public.mission_event(v_owner, 'tenant_found', 1, null);
  perform public.mission_event(v_player, 'home_rented', 1, null);
  v_feed := (public.property_tier(coalesce(cfg ->> 'feedMinTier', 'villa')) ->> 'idx')::integer;
  if (public.property_tier(v_tier) ->> 'idx')::integer >= coalesce(v_feed, 99) then
    perform public.feed_post(v_player, 'home_rented', jsonb_build_object('owner', v_onick, 'tier', v_tier),
                             'home_rented:' || v_id::text);
  end if;
  return public.request_complete(v_player, p_request_id, public.rentals_state(v_player));
end;
$$;
comment on function public.rent_home(uuid, text) is
  'RPC: rents a place in another player''s home (ADR-158), the first period is paid at once; errors property_locked, '
  'invalid_argument, player_not_found, rent_own_home, rental_not_offered, already_renting, rental_full, insufficient_funds.';

create or replace function public.end_tenancy(p_request_id uuid, p_tenancy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  r        public.rental_tenancies;
  v_end    timestamptz;
  v_me     text;
  v_by     text;
begin
  v_player := public.require_player();
  if p_request_id is null or p_tenancy_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'end_tenancy');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into r from public.rental_tenancies
   where id = p_tenancy_id and status = 'active' and v_player in (owner_id, tenant_id) for update;
  if r.id is null then
    perform public.api_error('tenancy_not_found');
  end if;
  v_by := case when r.owner_id = v_player then 'owner' else 'tenant' end;
  v_end := public.rental_notice_end(r.started_at, public.game_now(), r.period);
  if r.ends_at is null or v_end < r.ends_at then
    update public.rental_tenancies set ends_at = v_end, notice_by = v_by where id = r.id;
    select p.nickname into v_me from public.profiles p where p.id = v_player;
    if v_by = 'owner' and r.tenant_id is not null then
      perform public.social_notify(r.tenant_id, 'rental_ended', v_me || ' hat dir gekündigt',
                                   'Dein Mietvertrag endet am ' || to_char(v_end at time zone 'Europe/Berlin', 'DD.MM. "um" HH24:MI "Uhr"') || '.',
                                   jsonb_build_object('tenancy_id', r.id, 'ends_at', v_end), '/property/rentals',
                                   'rental_notice:' || r.id::text);
    elsif v_by = 'tenant' then
      perform public.social_notify(r.owner_id, 'rental_ended', v_me || ' hat gekündigt',
                                   'Der Mietvertrag endet am ' || to_char(v_end at time zone 'Europe/Berlin', 'DD.MM. "um" HH24:MI "Uhr"') || '.',
                                   jsonb_build_object('tenancy_id', r.id, 'ends_at', v_end), '/property',
                                   'rental_notice:' || r.id::text);
    end if;
  end if;
  return public.request_complete(v_player, p_request_id, public.rentals_state(v_player));
end;
$$;
comment on function public.end_tenancy(uuid, uuid) is
  'RPC: owner or tenant gives notice (ADR-158): the tenancy ends at the first period end after the minimum duration and '
  'the notice period; errors invalid_argument, tenancy_not_found.';

-- ---------------------------------------------------------------------------
-- I. Hooks into existing functions (patched in place)
-- ---------------------------------------------------------------------------
-- save_layout: the Wohnwert after saving counts for missions
do $do$
declare
  v_def text := pg_get_functiondef('public.save_layout(uuid, text, text, jsonb)'::regprocedure);
  v_old text := $t$  perform public.mission_event(v_player, 'furniture_placed', v_n, null);$t$;
  v_new text := $t$  perform public.mission_event(v_player, 'furniture_placed', v_n, null);
  perform public.mission_event(v_player, 'wohnwert', public.home_wohnwert_total(v_player), null);$t$;
begin
  if position('''wohnwert''' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'save_layout() has an unexpected shape; add the Wohnwert mission event by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- account_wipe: tenancies end and the offer goes
do $do$
declare
  v_def text := pg_get_functiondef('public.account_wipe(uuid, text)'::regprocedure);
  v_old text := $t$  perform public.deals_wipe_player(p_player, p_key);$t$;
  v_new text := $t$  perform public.deals_wipe_player(p_player, p_key);

  -- rentals (ADR-158): tenancies end, the offer and the own tenants go
  perform public.rentals_wipe_player(p_player);$t$;
begin
  if position('rentals_wipe_player' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'account_wipe() has an unexpected shape; add rentals_wipe_player by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- mission_doable: renting needs a home, an offer only when none is open, renting a place a free offer
do $do$
declare
  v_def text := pg_get_functiondef('public.mission_doable(uuid, text, text)'::regprocedure);
  v_old text := $t$    -- "your first ..." only for who has not done it yet$t$;
  v_new text := $t$    -- rentals (ADR-158)
    when p_metric = 'rental_offered' then
      exists (select 1 from home where home.tier is not null)
      and not exists (select 1 from public.rental_offers o where o.owner_id = p_player and o.is_open)
    when p_metric in ('tenant_found', 'rent_earned', 'wohnwert') then exists (select 1 from home where home.tier is not null)
    when p_metric = 'home_rented' then
      not exists (select 1 from public.rental_tenancies r where r.tenant_id = p_player and r.status = 'active')
      and exists (select 1 from public.rental_offers o join public.player_homes h on h.player_id = o.owner_id
                   where o.is_open and o.owner_id <> p_player and h.tier is not null
                     and (select count(*) from public.rental_tenancies r where r.owner_id = o.owner_id and r.status = 'active')
                         < public.rental_places(h.tier))
    -- "your first ..." only for who has not done it yet$t$;
begin
  if position('rental_offered' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'mission_doable() has an unexpected shape; add the rental metrics by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- rent counts as money in mission texts ("{target}" in euros)
do $do$
declare
  v_def text := pg_get_functiondef('public.mission_is_money_metric(text)'::regprocedure);
begin
  if position('rent_earned' in v_def) = 0 then
    if position($t$'art_collection_value')$t$ in v_def) = 0 then
      raise exception 'mission_is_money_metric() has an unexpected shape; add rent_earned by hand';
    end if;
    execute replace(v_def, $t$'art_collection_value')$t$, $t$'art_collection_value', 'rent_earned')$t$);
  end if;
end;
$do$;

-- the feed names a big rental
do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
  v_old text := $t$    when 'car_bought' then 'Neues Auto'$t$;
  v_new text := $t$    when 'car_bought' then 'Neues Auto'
    when 'home_rented' then 'Wohnt jetzt bei ' || coalesce(p_payload ->> 'owner', '?')$t$;
begin
  if position('home_rented' in v_def) = 0 and position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- J. Missions
-- ---------------------------------------------------------------------------
insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  ('m_rent_offer', 'milestone', 'Biete einen Platz zur Miete an', 'Richte dein Zuhause schön ein und vermiete einen Platz darin.',
   'mission_home', 'rental_offered', 'count', '{"unlock":"property"}'::jsonb, 1, 1, 400, 400, 8, 2, false, 60, 1),
  ('m_rent_tenant', 'milestone', 'Dein erster Mieter', 'Ein KI-Mieter oder ein Mitspieler zieht bei dir ein.',
   'mission_home', 'tenant_found', 'count', '{"unlock":"property"}'::jsonb, 1, 1, 600, 600, 8, 3, false, 60, 1),
  ('m_wohnwert_60', 'milestone', 'Wohnwert {target}', 'Mehr Vielfalt, ein Teppich, etwas auf dem Tisch: Speichere eine Einrichtung mit Wohnwert 60.',
   'mission_home', 'wohnwert', 'max', '{"unlock":"property"}'::jsonb, 60, 60, 700, 700, 8, 4, false, 60, 1),
  ('m_wohnwert_90', 'milestone', 'Wohnwert {target}', 'Ein Zuhause wie aus dem Magazin.',
   'mission_home', 'wohnwert', 'max', '{"unlock":"property"}'::jsonb, 90, 90, 1500, 1500, 8, 20, false, 50, 1),
  ('m_rent_home', 'milestone', 'Wohne zur Miete', 'Miete einen Platz im Zuhause eines Mitspielers.',
   'mission_home', 'home_rented', 'count', '{"unlock":"property"}'::jsonb, 1, 1, 500, 500, 8, 5, false, 50, 1),
  ('d_rent_earn', 'daily', 'Nimm {target} Miete ein', 'Deine Mieter zahlen, du kassierst.',
   'mission_home', 'rent_earned', 'sum', '{"unlock":"property"}'::jsonb, 20000, 40000, 250, 350, 8, null, false, 40, 0),
  ('w_rent_earn', 'weekly', 'Nimm {target} Miete ein', 'Eine Woche Vermieterleben.',
   'mission_home', 'rent_earned', 'sum', '{"unlock":"property"}'::jsonb, 200000, 400000, 800, 1000, 8, null, false, 40, 1)
on conflict (key) do update
   set title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params,
       target_min = excluded.target_min, target_max = excluded.target_max, xp_min = excluded.xp_min,
       xp_max = excluded.xp_max, min_level = excluded.min_level, chain_order = excluded.chain_order,
       scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true, updated_at = now();

-- ---------------------------------------------------------------------------
-- K. Grants and the cron job
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.rentals_cfg()', 'public.home_wohnwert(uuid)', 'public.home_wohnwert_total(uuid)',
    'public.rental_period_hours(text)', 'public.rental_places(text)', 'public.rental_fair_hour_cents(text, integer)',
    'public.rental_limits(text, integer, text)', 'public.rental_ai_chance_bps(text, integer, bigint)',
    'public.rental_stay_hours(double precision, text)', 'public.rental_notice_end(timestamptz, timestamptz, text)',
    'public.rental_tenant_xp(integer, integer)', 'public.rental_tenants_json(uuid)', 'public.property_rental_json(uuid)',
    'public.property_state(uuid, uuid)', 'public.rentals_state(uuid)', 'public.rental_end(uuid, text, timestamptz)',
    'public.rental_charge(uuid, timestamptz)', 'public.rental_ai_arrivals(uuid, timestamptz, double precision[])',
    'public.rentals_run_due(timestamptz)', 'public.rentals_wipe_player(uuid)',
    'public.get_rentals()', 'public.get_rental_market()', 'public.set_rental_offer(uuid, text, bigint, boolean)',
    'public.rent_home(uuid, text)', 'public.end_tenancy(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_rentals()', 'public.get_rental_market()', 'public.set_rental_offer(uuid, text, bigint, boolean)',
    'public.rent_home(uuid, text)', 'public.end_tenancy(uuid, uuid)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-rentals';
    perform cron.schedule('nexa-rentals', '* * * * *', 'select public.rentals_run_due()');
  end if;
end;
$do$;
