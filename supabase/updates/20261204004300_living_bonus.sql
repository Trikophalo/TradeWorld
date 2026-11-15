-- ===== idempotent copy of migrations/20261204004300_living_bonus.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 4300 · Living bonus, furniture prices by home, furnished home value, free rent prices (ADR-161)
-- =============================================================================
-- * Living bonus: every hour a player who lives in a home (own home, or a rented place) gets money from the
--   households (ledger kind living_bonus) and XP (source home_living). More for a bigger home and a higher Wohnwert;
--   a tenant gets livingBonus.tenantShareBps of that home's bonus, the money at most his rent per hour. One bonus per
--   player and hour (the better of own home and rented place), only for players active in the last activeDays.
--   Job living_bonus_run_due(now) (pg_cron nexa-living-bonus, every minute; pays the running hour once),
--   payments in living_bonus_payments, a daily summary (notification living_bonus_summary).
--   port of src/lib/sim/living.ts.
-- * Furniture costs property.furniturePriceBps of the catalogue price by the home the buyer lives in. The piece keeps
--   this list price (player_furniture.list_cents, the old pieces: the catalogue price); the Wohnwert counts it.
-- * Placed furniture is part of the home: property.furnishedValueBps of the price paid in the home value (net worth,
--   rich list), the inventory stays at resaleBps. PROPERTY gets furnishing_cents and value_cents per piece.
-- * Rent prices are free (ADR-161): rentals.minPriceCents .. rentals.maxPriceCentsPerHour per hour.
-- * get_property(): rental.living_bonus (source, cents, xp, tier, wohnwert, owner).
-- Idempotent: runs unchanged as supabase/updates/20261204004300_living_bonus.sql.

-- ---------------------------------------------------------------------------
-- A. List price of every piece of furniture
-- ---------------------------------------------------------------------------
alter table public.player_furniture add column if not exists list_cents bigint;
update public.player_furniture f set list_cents = k.price_cents
  from public.furniture_catalog k
 where k.key = f.item_key and f.list_cents is null;
update public.player_furniture set list_cents = price_paid_cents where list_cents is null;

-- rows inserted without a list price (tests, older code paths) take the catalogue price
create or replace function public.player_furniture_list_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.list_cents is null then
    new.list_cents := coalesce((select k.price_cents from public.furniture_catalog k where k.key = new.item_key),
                               new.price_paid_cents, 0);
  end if;
  return new;
end;
$$;
drop trigger if exists player_furniture_list_default on public.player_furniture;
create trigger player_furniture_list_default before insert on public.player_furniture
  for each row execute function public.player_furniture_list_default();
alter table public.player_furniture alter column list_cents set not null;
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'player_furniture_list_cents_check') then
    alter table public.player_furniture add constraint player_furniture_list_cents_check check (list_cents >= 0);
  end if;
end;
$do$;
comment on column public.player_furniture.list_cents is
  'List price at purchase: catalogue price x property.furniturePriceBps of the home (ADR-161); the Wohnwert counts it.';

-- ---------------------------------------------------------------------------
-- B. Rules (port of src/lib/sim/property.ts)
-- ---------------------------------------------------------------------------
-- furniturePriceCents
create or replace function public.property_furniture_list_cents(p_catalog_cents bigint, p_tier text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_catalog_cents, 0)
         * coalesce((public.property_config() #>> array['furniturePriceBps', coalesce(p_tier, 'flat')])::bigint,
                    (case coalesce(p_tier, 'flat') when 'apartment' then 12500 when 'house' then 15000 when 'villa' then 20000
                                                   when 'luxury_villa' then 30000 else 10000 end))
         / 10000;
$$;

create or replace function public.property_furnished_bps()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.property_config() ->> 'furnishedValueBps')::bigint, 6000);
$$;

-- furnishedValueCents summed over the placed pieces
create or replace function public.player_furnishing_value_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(f.price_paid_cents * public.property_furnished_bps() / 10000), 0)::bigint
    from public.player_furniture f where f.player_id = p_player and f.placed;
$$;
comment on function public.player_furnishing_value_cents(uuid) is
  'What the placed furniture adds to the home value (ADR-161): furnishedValueBps of the price paid.';

-- propertyValueCents: home at tradeInBps, placed furniture at furnishedValueBps, the rest at resaleBps
create or replace function public.player_property_value_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select public.property_config() as cfg),
       b as (select (c.cfg ->> 'resaleBps')::bigint as bps from c)
  select public.property_trade_in_cents((select h.tier from public.player_homes h where h.player_id = p_player))
       + public.player_furnishing_value_cents(p_player)
       + coalesce((select sum(f.price_paid_cents * b.bps / 10000) from public.player_furniture f, b
                    where f.player_id = p_player and not f.placed), 0)::bigint
       + coalesce((select sum(k.price_paid_cents * b.bps / 10000) from public.player_cars k, b where k.player_id = p_player), 0)::bigint
       + coalesce((select sum((c.cfg #>> array['floors', m])::bigint * b.bps / 10000)
                     from public.player_homes h cross join lateral unnest(h.floors_owned) m, b, c
                    where h.player_id = p_player and jsonb_typeof(c.cfg #> array['floors', m]) = 'number'), 0)::bigint;
$$;
comment on function public.player_property_value_cents(uuid) is
  'Value of a player''s property for the net worth (ADR-082, ADR-161): home at tradeInBps, placed furniture at '
  'furnishedValueBps, other furniture, cars and bought floors at resaleBps.';

-- ---------------------------------------------------------------------------
-- C. Buying furniture at the price of the home; the Wohnwert counts the list price
-- ---------------------------------------------------------------------------
create or replace function public.buy_furniture(p_request_id uuid, p_item_key text, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_price  bigint;
  v_list   bigint;
  v_cash   bigint;
  v_cost   bigint;
  v_disc   integer;
  v_tier   text;
begin
  v_player := public.require_player();
  perform public.property_require_unlock(v_player);
  -- docs/PROPERTY.md: 1 to 20 pieces per purchase
  if p_request_id is null or p_item_key is null or p_count is null or p_count < 1 or p_count > 20 then
    perform public.api_error('invalid_argument');
  end if;
  select c.price_cents into v_price from public.furniture_catalog c where c.key = p_item_key;
  if v_price is null then
    perform public.api_error('item_not_found');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_furniture');
  if v_replay is not null then
    return v_replay;
  end if;
  -- ADR-161: bigger homes, dearer furniture (list price); the makler upgrade (ADR-100) comes off it
  select h.tier into v_tier from public.player_homes h where h.player_id = v_player;
  if public.property_tier(v_tier) is null then
    v_tier := null;
  end if;
  v_list := public.property_furniture_list_cents(v_price, v_tier);
  v_disc := public.player_property_discount_bps(v_player);
  v_price := public.apply_bps(v_list, 10000 - v_disc);
  v_cost := v_price * p_count;
  v_cash := public.lock_player_accounts(v_player);
  if v_cash < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('households'),
                                   v_cost, 'lifestyle_purchase', 'Möbel gekauft', 'furniture', null,
                                   'property:furniture:' || v_player::text || ':' || p_request_id::text, v_player,
                                   jsonb_build_object('item_key', p_item_key, 'count', p_count, 'price_cents', v_price,
                                                      'list_cents', v_list, 'home_tier', v_tier, 'discount_bps', v_disc));
  end if;
  insert into public.player_furniture (player_id, item_key, price_paid_cents, list_cents)
  select v_player, p_item_key, v_price, v_list from generate_series(1, p_count);
  perform public.mission_event(v_player, 'furniture_bought', p_count, p_item_key);
  return public.request_complete(v_player, p_request_id, public.property_state(v_player, v_player));
end;
$$;
comment on function public.buy_furniture(uuid, text, integer) is
  'RPC: buys 1..20 pieces of furniture into the inventory at the price of the home (ADR-161), less the makler upgrade '
  '(stored as price paid, the list price for the Wohnwert); errors property_locked, invalid_argument, item_not_found, '
  'insufficient_funds.';

-- home_wohnwert(): the value part counts the list prices of the placed pieces
do $do$
declare
  v_def text := pg_get_functiondef('public.home_wohnwert(uuid)'::regprocedure);
begin
  if position('sum(f.list_cents)' in v_def) = 0 then
    if position('select coalesce(sum(k.price_cents), 0)::bigint, count(distinct k.category)::integer,' in v_def) = 0 then
      raise exception 'home_wohnwert() has an unexpected shape; count the list prices by hand';
    end if;
    execute replace(v_def, 'select coalesce(sum(k.price_cents), 0)::bigint, count(distinct k.category)::integer,',
                    'select coalesce(sum(f.list_cents), 0)::bigint, count(distinct k.category)::integer,');
  end if;
end;
$do$;

-- PROPERTY: value per piece (list price) and what the furnishing adds to the home value
do $do$
declare
  v_def text := pg_get_functiondef('public.property_json(uuid)'::regprocedure);
begin
  if position('furnishing_cents' in v_def) = 0 then
    if position($q$jsonb_build_object('id', f.id, 'item_key', f.item_key, 'x', f.x, 'y', f.y, 'rot', f.rot)$q$ in v_def) = 0
       or position($q$'value_cents', public.player_property_value_cents(p_player));$q$ in v_def) = 0 then
      raise exception 'property_json() has an unexpected shape; add the furnishing by hand';
    end if;
    v_def := replace(v_def, $q$jsonb_build_object('id', f.id, 'item_key', f.item_key, 'x', f.x, 'y', f.y, 'rot', f.rot)$q$,
                     $q$jsonb_build_object('id', f.id, 'item_key', f.item_key, 'x', f.x, 'y', f.y, 'rot', f.rot, 'value_cents', f.list_cents)$q$);
    v_def := replace(v_def, $q$'value_cents', public.player_property_value_cents(p_player));$q$,
                     $q$'value_cents', public.player_property_value_cents(p_player),
    'furnishing_cents', public.player_furnishing_value_cents(p_player));$q$);
    execute v_def;
  end if;
end;
$do$;

create or replace function public.property_inventory_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'furniture', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'item_key', f.item_key, 'value_cents', f.list_cents)
                                            order by f.bought_at, f.id)
                             from public.player_furniture f where f.player_id = p_player and not f.placed), '[]'::jsonb),
    'cars', '[]'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- D. Free rent prices (ADR-161)
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
    "fairMinShareBps": 2000, "minPriceCents": 100, "maxPriceCentsPerHour": 10000000,
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
comment on function public.rentals_cfg() is 'Internal: game_config rentals (ADR-158, ADR-161) with the balance.ts values as fallback.';

-- rentLimits: {min_cents, max_cents, fair_cents} per period; the owner decides between a minimum and a safety maximum
create or replace function public.rental_limits(p_tier text, p_wohnwert integer, p_period text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select public.rentals_cfg() as v),
       x as (select public.rental_fair_hour_cents(p_tier, p_wohnwert) as fair,
                    greatest(1, coalesce((c.v ->> 'minPriceCents')::bigint, 100)) as mn,
                    coalesce((c.v ->> 'maxPriceCentsPerHour')::bigint, 10000000) as mx
               from c)
  select jsonb_build_object(
    'min_cents', x.mn * public.rental_period_hours(p_period),
    'max_cents', greatest(x.mn, x.mx) * public.rental_period_hours(p_period),
    'fair_cents', x.fair * public.rental_period_hours(p_period))
    from x;
$$;

-- ---------------------------------------------------------------------------
-- E. Living bonus (port of src/lib/sim/living.ts)
-- ---------------------------------------------------------------------------
insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('living_bonus_summary', 'economy', 'Wohnbonus', 'Einmal am Tag: was dir dein Zuhause gestern gebracht hat.',
        'notif_bell', true, false, false, 303)
on conflict (key) do nothing;

create table if not exists public.living_bonus_payments (
  player_id  uuid not null references public.profiles (id) on delete cascade,
  hour_start timestamptz not null,
  source     text not null check (source in ('own', 'tenant')),
  tier       text not null,
  wohnwert   integer not null check (wohnwert between 0 and 100),
  cents      bigint not null default 0 check (cents >= 0),
  xp         integer not null default 0 check (xp >= 0),
  created_at timestamptz not null default now(),
  primary key (player_id, hour_start)
);
create index if not exists living_bonus_payments_created_idx on public.living_bonus_payments (created_at);
alter table public.living_bonus_payments enable row level security;
revoke all on public.living_bonus_payments from public, anon, authenticated;
grant all on public.living_bonus_payments to service_role;
comment on table public.living_bonus_payments is
  'One living bonus per player and hour (ADR-161): money and XP for living in a home. Kept paymentsKeepDays. Internal.';

create or replace function public.living_bonus_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('livingBonus'), '{
    "centsPerHour": {"flat": 2000, "apartment": 5000, "house": 12000, "villa": 30000, "luxury_villa": 80000},
    "xpPerHour": {"flat": 3, "apartment": 4, "house": 6, "villa": 8, "luxury_villa": 10},
    "minShareBps": 4000, "tenantShareBps": 5000, "activeDays": 3, "paymentsKeepDays": 30
  }'::jsonb);
$$;
comment on function public.living_bonus_cfg() is 'Internal: game_config livingBonus (ADR-161) with the balance.ts values as fallback.';

-- ownerLivingBonus: {cents, xp}
create or replace function public.living_bonus_owner(p_tier text, p_wohnwert integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select public.living_bonus_cfg() as v),
       s as (select (c.v ->> 'minShareBps')::bigint * 100
                    + (10000 - (c.v ->> 'minShareBps')::bigint) * greatest(0, least(100, coalesce(p_wohnwert, 0))) as e6
               from c)
  select jsonb_build_object(
    'cents', coalesce((c.v #>> array['centsPerHour', coalesce(p_tier, '')])::bigint, 0) * s.e6 / 1000000,
    'xp', (coalesce((c.v #>> array['xpPerHour', coalesce(p_tier, '')])::bigint, 0) * s.e6 / 1000000)::integer)
    from c, s;
$$;

-- tenantLivingBonus: tenantShareBps of the owner's bonus, the money at most the rent per hour
create or replace function public.living_bonus_tenant(p_tier text, p_wohnwert integer, p_rent_hour_cents bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select (public.living_bonus_cfg() ->> 'tenantShareBps')::bigint as share),
       o as (select public.living_bonus_owner(p_tier, p_wohnwert) as v)
  select jsonb_build_object(
    'cents', least(greatest(0, coalesce(p_rent_hour_cents, 0)), (o.v ->> 'cents')::bigint * c.share / 10000),
    'xp', ((o.v ->> 'xp')::bigint * c.share / 10000)::integer)
    from c, o;
$$;

-- livingBonus: the one bonus of a player per hour (own home or the rented place, the one with more money); null if none
create or replace function public.player_living_bonus(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tier  text;
  v_w     integer;
  v_own   jsonb;
  v_rent  jsonb;
  r       record;
begin
  select h.tier into v_tier from public.player_homes h where h.player_id = p_player;
  if public.property_tier(v_tier) is not null then
    v_w := public.home_wohnwert_total(p_player);
    v_own := public.living_bonus_owner(v_tier, v_w)
             || jsonb_build_object('source', 'own', 'tier', v_tier, 'wohnwert', v_w, 'owner', null);
  end if;
  select t.owner_id, t.price_cents / public.rental_period_hours(t.period) as hour_cents, h.tier, o.nickname
    into r
    from public.rental_tenancies t
    join public.profiles o on o.id = t.owner_id
    join public.player_homes h on h.player_id = t.owner_id
   where t.tenant_id = p_player and t.status = 'active'
   order by t.started_at desc
   limit 1;
  if r.owner_id is not null and public.property_tier(r.tier) is not null then
    v_w := public.home_wohnwert_total(r.owner_id);
    v_rent := public.living_bonus_tenant(r.tier, v_w, r.hour_cents)
              || jsonb_build_object('source', 'tenant', 'tier', r.tier, 'wohnwert', v_w, 'owner', r.nickname);
  end if;
  if v_own is not null and (v_rent is null or (v_own ->> 'cents')::bigint > (v_rent ->> 'cents')::bigint
                            or ((v_own ->> 'cents')::bigint = (v_rent ->> 'cents')::bigint
                                and (v_own ->> 'xp')::integer >= (v_rent ->> 'xp')::integer)) then
    return v_own;
  end if;
  return v_rent;
end;
$$;
comment on function public.player_living_bonus(uuid) is
  'The living bonus of a player per hour (ADR-161, livingBonus() in src/lib/sim/living.ts): {source own|tenant, cents, '
  'xp, tier, wohnwert, owner}; null if the player lives nowhere.';

-- Pays the bonus of one player for one hour (once): money from the households if they have it, XP with the factor.
create or replace function public.living_bonus_pay(p_player uuid, p_hour timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b     jsonb := public.player_living_bonus(p_player);
  v_cents bigint;
  v_xp    integer;
  v_key   text;
  v_ok    uuid;
  v_hh    bigint;
begin
  if v_b is null then
    return null;
  end if;
  v_cents := greatest(0, (v_b ->> 'cents')::bigint);
  insert into public.living_bonus_payments (player_id, hour_start, source, tier, wohnwert, cents, xp)
  values (p_player, p_hour, v_b ->> 'source', v_b ->> 'tier', (v_b ->> 'wohnwert')::integer, 0, 0)
  on conflict (player_id, hour_start) do nothing
  returning player_id into v_ok;
  if v_ok is null then
    return null;
  end if;
  v_key := 'living:' || p_player::text || ':' || to_char(p_hour at time zone 'UTC', 'YYYYMMDDHH24');
  if v_cents > 0 then
    perform public.lock_player_accounts(p_player);
    select a.balance_cents into v_hh from public.ledger_accounts a where a.system_key = 'households' for update;
    if coalesce(v_hh, 0) >= v_cents then
      perform public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(p_player, 'player_cash'),
                                     v_cents, 'living_bonus', 'Wohnbonus', 'living_bonus', null, v_key, p_player,
                                     jsonb_build_object('source', v_b ->> 'source', 'tier', v_b ->> 'tier',
                                                        'wohnwert', (v_b ->> 'wohnwert')::integer));
      perform public.loan_withhold(p_player, v_cents, v_key);
    else
      v_cents := 0;
    end if;
  end if;
  v_xp := coalesce(public.grant_xp(p_player, 'home_living', (v_b ->> 'xp')::integer, v_key, 'living_bonus', null), 0);
  update public.living_bonus_payments set cents = v_cents, xp = v_xp where player_id = p_player and hour_start = p_hour;
  return jsonb_build_object('cents', v_cents, 'xp', v_xp, 'source', v_b ->> 'source');
end;
$$;

-- Job: the running hour for every player who lives somewhere and played lately; a daily summary.
create or replace function public.living_bonus_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.living_bonus_cfg();
  v_now   timestamptz := coalesce(p_now, public.game_now());
  v_hour  timestamptz := date_trunc('hour', coalesce(p_now, public.game_now()));
  v_day   date := (coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date;
  r       record;
  v_paid  integer := 0;
  v_notes integer := 0;
  v_run   bigint;
  v_got   jsonb;
begin
  if not pg_try_advisory_xact_lock(7311161) then
    return jsonb_build_object('skipped', 'busy');
  end if;
  for r in select p.id from public.profiles p
            where not p.is_deactivated
              and p.last_active_at >= v_now - make_interval(days => greatest(1, coalesce((cfg ->> 'activeDays')::integer, 3)))
              and (exists (select 1 from public.player_homes h where h.player_id = p.id and h.tier is not null)
                   or exists (select 1 from public.rental_tenancies t where t.tenant_id = p.id and t.status = 'active'))
              and not exists (select 1 from public.living_bonus_payments y where y.player_id = p.id and y.hour_start = v_hour)
            order by p.id limit 500 loop
    v_got := public.living_bonus_pay(r.id, v_hour);
    if v_got is not null then
      v_paid := v_paid + 1;
    end if;
  end loop;
  -- once a day: yesterday's bonus per player, old payments pruned
  insert into public.job_runs (job_name, run_key) values ('living_summary', v_day::text)
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is not null then
    for r in select y.player_id, sum(y.cents)::bigint as cents, sum(y.xp)::bigint as xp, count(*)::integer as hours
               from public.living_bonus_payments y
              where y.hour_start >= ((v_day - 1)::timestamp at time zone 'Europe/Berlin')
                and y.hour_start < (v_day::timestamp at time zone 'Europe/Berlin')
              group by y.player_id
             having sum(y.cents) > 0 or sum(y.xp) > 0 loop
      perform public.social_notify(r.player_id, 'living_bonus_summary',
                                   'Wohnbonus gestern: ' || public.format_eur(r.cents) || ' und ' || r.xp || ' XP',
                                   case when r.hours = 1 then 'Für eine Stunde in deinem Zuhause.'
                                        else 'Für ' || r.hours || ' Stunden in deinem Zuhause.' end,
                                   jsonb_build_object('cents', r.cents, 'xp', r.xp, 'hours', r.hours, 'day', (v_day - 1)::text),
                                   '/property', 'living_summary:' || (v_day - 1)::text);
      v_notes := v_notes + 1;
    end loop;
    delete from public.living_bonus_payments y
     where y.created_at < now() - make_interval(days => greatest(1, coalesce((cfg ->> 'paymentsKeepDays')::integer, 30)));
    delete from public.job_runs j where j.job_name = 'living_summary' and j.started_at < now() - interval '30 days';
    update public.job_runs set status = 'succeeded', finished_at = now() where id = v_run;
  end if;
  return jsonb_build_object('paid', v_paid, 'summaries', v_notes, 'hour', v_hour);
end;
$$;
comment on function public.living_bonus_run_due(timestamptz) is
  'Internal, cron every minute (ADR-161): the living bonus of the running hour for every player who lives somewhere '
  'and was active lately (once per player and hour), and the daily summary.';

-- The "rental" part of PROPERTY gets the living bonus
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
                 order by r.started_at desc limit 1),
    'living_bonus', public.player_living_bonus(p_player));
$$;

-- Account reset or deletion: the bonus payments go as well
do $do$
declare
  v_def text := pg_get_functiondef('public.rentals_wipe_player(uuid)'::regprocedure);
begin
  if position('living_bonus_payments' in v_def) = 0 then
    if position('  delete from public.rental_offers where owner_id = p_player;' in v_def) = 0 then
      raise exception 'rentals_wipe_player() has an unexpected shape; delete the living bonus payments by hand';
    end if;
    execute replace(v_def, '  delete from public.rental_offers where owner_id = p_player;',
                    '  delete from public.rental_offers where owner_id = p_player;
  delete from public.living_bonus_payments where player_id = p_player;');
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- F. Grants and the job
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.player_furniture_list_default()', 'public.property_furniture_list_cents(bigint, text)',
    'public.property_furnished_bps()', 'public.player_furnishing_value_cents(uuid)',
    'public.player_property_value_cents(uuid)', 'public.property_json(uuid)', 'public.property_inventory_json(uuid)',
    'public.home_wohnwert(uuid)', 'public.rentals_cfg()', 'public.rental_limits(text, integer, text)',
    'public.living_bonus_cfg()', 'public.living_bonus_owner(text, integer)',
    'public.living_bonus_tenant(text, integer, bigint)', 'public.player_living_bonus(uuid)',
    'public.living_bonus_pay(uuid, timestamptz)', 'public.living_bonus_run_due(timestamptz)',
    'public.property_rental_json(uuid)', 'public.rentals_wipe_player(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'revoke all on function public.buy_furniture(uuid, text, integer) from public, anon';
  execute 'grant execute on function public.buy_furniture(uuid, text, integer) to authenticated, service_role';
end;
$$;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-living-bonus';
    perform cron.schedule('nexa-living-bonus', '* * * * *', 'select public.living_bonus_run_due()');
  end if;
end;
$do$;
