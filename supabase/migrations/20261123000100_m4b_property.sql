-- =============================================================================
-- NEXA · M4b · 0100 · Property: own home, furniture, floors, garage (ADR-082)
-- =============================================================================
-- docs/PROPERTY.md. A player buys a home (property.tiers; skipping tiers is
-- allowed, the current home is taken in at property.tradeInBps), furniture
-- (furniture_catalog, supabase/seeds/furniture.sql), floor materials (once each,
-- property.floors; price 0 = owned by default) and cars (car_catalog; one per
-- garage slot of the tier). Every purchase is paid to the households (ledger
-- kind lifestyle_purchase); furniture from the inventory and cars can be sold
-- back for property.resaleBps of the price paid (lifestyle_sale, from the
-- households). The home counts at its trade-in value, furniture, cars and bought
-- floors at their resale value towards the net worth. Homes are public: every
-- player can look at the home and garage of another (without the inventory).
-- Mirrors src/lib/sim/property.ts.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Tables (internal: read through the RPCs, never written by clients)
-- ---------------------------------------------------------------------------
-- Catalogue (generated: supabase/seeds/furniture.sql from scripts/gen-furniture.ts)
create table if not exists public.furniture_catalog (
  key         text primary key check (key ~ '^[a-z0-9_]{1,40}$'),
  name        text not null check (char_length(name) between 1 and 60),
  category    text not null check (category in ('seating', 'tables', 'beds', 'kitchen', 'bath', 'plants', 'decor', 'tech', 'rugs', 'fun')),
  tier        text not null check (tier in ('budget', 'standard', 'premium', 'luxury', 'ultra')),
  price_cents bigint not null check (price_cents > 0),
  width       smallint not null check (width between 1 and 10),
  height      smallint not null check (height between 1 and 10),
  layer       text not null check (layer in ('floor', 'object'))
);
alter table public.furniture_catalog enable row level security;
comment on table public.furniture_catalog is
  'Furniture of the home (ADR-082): size in floor tiles, layer floor = rug (lies under objects). Seed: supabase/seeds/furniture.sql. Internal (RPCs).';

create table if not exists public.car_catalog (
  key         text primary key check (key ~ '^[a-z0-9_]{1,40}$'),
  name        text not null check (char_length(name) between 1 and 60),
  brand       text not null check (char_length(brand) between 1 and 60),
  tier        text not null check (tier in ('budget', 'standard', 'premium', 'luxury', 'ultra')),
  price_cents bigint not null check (price_cents > 0)
);
alter table public.car_catalog enable row level security;
comment on table public.car_catalog is 'Cars for the garage (ADR-082, invented brands). Seed: supabase/seeds/furniture.sql. Internal (RPCs).';

-- A row exists once the player bought a home or a floor; tier null = no home yet.
create table if not exists public.player_homes (
  player_id    uuid primary key references public.profiles (id) on delete cascade,
  tier         text check (tier is null or tier ~ '^[a-z_]{1,30}$'),
  wall_color   text not null check (wall_color ~ '^#[0-9a-f]{6}$'),
  floor        text not null default 'laminate' check (floor ~ '^[a-z_]{1,30}$'),
  floors_owned text[] not null default array['laminate']::text[],
  updated_at   timestamptz not null default now()
);
alter table public.player_homes enable row level security;
drop trigger if exists set_updated_at on public.player_homes;
create trigger set_updated_at before update on public.player_homes for each row execute function public.set_updated_at();
comment on table public.player_homes is
  'Home of a player (ADR-082): tier (property.tiers key, null = none yet), wall colour, floor in use, floor materials bought. Internal (RPCs).';

create table if not exists public.player_furniture (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references public.profiles (id) on delete cascade,
  item_key         text not null references public.furniture_catalog (key) on update cascade,
  price_paid_cents bigint not null check (price_paid_cents >= 0),
  placed           boolean not null default false,
  x                smallint check (x is null or x >= 0),
  y                smallint check (y is null or y >= 0),
  rot              smallint not null default 0 check (rot in (0, 90)),
  bought_at        timestamptz not null default now(),
  constraint player_furniture_placed check (placed = (x is not null and y is not null))
);
alter table public.player_furniture enable row level security;
create index if not exists player_furniture_player_idx on public.player_furniture (player_id, bought_at);
create index if not exists player_furniture_item_idx on public.player_furniture (item_key);
comment on table public.player_furniture is
  'Furniture a player owns (ADR-082): placed with x, y (top left tile) and rot 0|90 in the home, else in the inventory. Internal (RPCs).';

create table if not exists public.player_cars (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references public.profiles (id) on delete cascade,
  car_key          text not null references public.car_catalog (key) on update cascade,
  slot             smallint not null check (slot >= 0),
  price_paid_cents bigint not null check (price_paid_cents >= 0),
  bought_at        timestamptz not null default now(),
  constraint player_cars_slot_uq unique (player_id, slot)
);
alter table public.player_cars enable row level security;
create index if not exists player_cars_car_idx on public.player_cars (car_key);
comment on table public.player_cars is 'Cars in the garage of a player (ADR-082), one per slot. Internal (RPCs).';

do $$
declare
  t text;
begin
  foreach t in array array['furniture_catalog', 'car_catalog', 'player_homes', 'player_furniture', 'player_cars'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- B. Error keys (M4b: NX074..NX080)
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
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;
comment on function public.api_error(text) is 'Raises the API error <key> with its NX SQLSTATE. The client shows a text per key (error.message).';

-- ---------------------------------------------------------------------------
-- C. Rules (port of src/lib/sim/property.ts)
-- ---------------------------------------------------------------------------
-- The property section of game_config (fallback: the values of src/config/balance.ts)
create or replace function public.property_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('property'), '{
    "tiers": [
      {"key": "flat", "priceCents": 2500000, "width": 8, "height": 6, "garageSlots": 0, "minLevel": 4},
      {"key": "apartment", "priceCents": 10000000, "width": 10, "height": 8, "garageSlots": 0, "minLevel": 8},
      {"key": "house", "priceCents": 50000000, "width": 13, "height": 9, "garageSlots": 2, "minLevel": 14},
      {"key": "villa", "priceCents": 250000000, "width": 16, "height": 11, "garageSlots": 4, "minLevel": 22},
      {"key": "luxury_villa", "priceCents": 1500000000, "width": 20, "height": 13, "garageSlots": 8, "minLevel": 30}],
    "tradeInBps": 5000,
    "resaleBps": 4000,
    "floors": {"laminate": 0, "carpet": 150000, "tiles": 400000, "parquet": 600000, "stone": 1500000, "marble": 6000000, "gold": 100000000},
    "wallColors": ["#f3efe4", "#ffffff", "#d9d4c7", "#8f9bb3", "#3a4256", "#1b1e2b", "#c8e6c9", "#2f7a4a",
                   "#bfe6ff", "#2f5fd0", "#ffe0b2", "#ff9a52", "#f8bbd0", "#7a2f7a", "#c8553d", "#ffd15c"]
  }'::jsonb);
$$;
comment on function public.property_config() is 'Internal: game_config property (ADR-082) with the balance.ts values as fallback.';

-- tierConfig + tierIndex: the tier object plus "idx" (0 = cheapest), null for an unknown key or null
create or replace function public.property_tier(p_tier text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select t.v || jsonb_build_object('idx', t.ord - 1)
    from jsonb_array_elements(public.property_config() -> 'tiers') with ordinality as t(v, ord)
   where p_tier is not null and t.v ->> 'key' = p_tier
   limit 1;
$$;

-- trade-in of a home: floor(price x tradeInBps / 10000); no home = 0
create or replace function public.property_trade_in_cents(p_tier text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (t.v ->> 'priceCents')::bigint * (public.property_config() ->> 'tradeInBps')::bigint / 10000
                     from jsonb_array_elements(public.property_config() -> 'tiers') t(v)
                    where p_tier is not null and t.v ->> 'key' = p_tier limit 1), 0);
$$;

-- upgradeCostCents: target price minus the trade-in of the current home, never below 0
create or replace function public.property_upgrade_cost_cents(p_current text, p_target text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, (public.property_tier(p_target) ->> 'priceCents')::bigint - public.property_trade_in_cents(p_current));
$$;

-- resaleCents: floor(price x resaleBps / 10000)
create or replace function public.property_resale_cents(p_price_cents bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, coalesce(p_price_cents, 0)) * (public.property_config() ->> 'resaleBps')::bigint / 10000;
$$;

-- price of a floor material, null = unknown material
create or replace function public.property_floor_price_cents(p_material text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when jsonb_typeof(public.property_config() #> array['floors', p_material]) = 'number'
              then (public.property_config() #>> array['floors', p_material])::bigint end;
$$;

-- a material is owned when bought or free (price 0: laminate)
create or replace function public.property_floor_owned(p_owned text[], p_material text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.property_floor_price_cents(p_material) is not null
     and (p_material = any (coalesce(p_owned, '{}'::text[])) or public.property_floor_price_cents(p_material) = 0);
$$;

create or replace function public.property_require_unlock(p_player uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select p.level from public.profiles p where p.id = p_player), 1) < public.unlock_level('property') then
    perform public.api_error('property_locked');
  end if;
end;
$$;

-- propertyValueCents: trade-in of the home + resale of every piece of furniture, car and bought floor
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
       + coalesce((select sum(f.price_paid_cents * b.bps / 10000) from public.player_furniture f, b where f.player_id = p_player), 0)::bigint
       + coalesce((select sum(k.price_paid_cents * b.bps / 10000) from public.player_cars k, b where k.player_id = p_player), 0)::bigint
       + coalesce((select sum((c.cfg #>> array['floors', m])::bigint * b.bps / 10000)
                     from public.player_homes h cross join lateral unnest(h.floors_owned) m, b, c
                    where h.player_id = p_player and jsonb_typeof(c.cfg #> array['floors', m]) = 'number'), 0)::bigint;
$$;
comment on function public.player_property_value_cents(uuid) is
  'Value of a player''s property for the net worth (ADR-082): home at tradeInBps, furniture, cars and bought floors at resaleBps.';

-- The home row of a player (created with the first wall colour if missing), locked.
create or replace function public.property_home_for_update(p_player uuid)
returns public.player_homes
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.player_homes;
begin
  insert into public.player_homes (player_id, wall_color)
  values (p_player, coalesce(lower(public.property_config() #>> '{wallColors,0}'), '#f3efe4'))
  on conflict (player_id) do nothing;
  select * into h from public.player_homes where player_id = p_player for update;
  return h;
end;
$$;

-- ---------------------------------------------------------------------------
-- D. PROPERTY and INVENTORY (JSON of docs/PROPERTY.md section 2)
-- ---------------------------------------------------------------------------
create or replace function public.property_json(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg  jsonb := public.property_config();
  h      public.player_homes;
  t      jsonb;
  v_nick text;
begin
  select p.nickname into v_nick from public.profiles p where p.id = p_player;
  select * into h from public.player_homes where player_id = p_player;
  t := public.property_tier(h.tier);
  return jsonb_build_object(
    'owner', v_nick,
    'tier', case when t is null then null else h.tier end,
    'width', coalesce((t ->> 'width')::integer, 0),
    'height', coalesce((t ->> 'height')::integer, 0),
    'garage_slots', coalesce((t ->> 'garageSlots')::integer, 0),
    'wall_color', coalesce(h.wall_color, lower(v_cfg #>> '{wallColors,0}'), '#f3efe4'),
    'floor', coalesce(h.floor, 'laminate'),
    'floors_owned', coalesce((select jsonb_agg(f.k order by (f.v #>> '{}')::bigint, f.k)
                                from jsonb_each(v_cfg -> 'floors') f(k, v)
                               where jsonb_typeof(f.v) = 'number'
                                 and ((f.v #>> '{}')::bigint = 0 or f.k = any (coalesce(h.floors_owned, '{}'::text[])))), '[]'::jsonb),
    'placed', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'item_key', f.item_key, 'x', f.x, 'y', f.y, 'rot', f.rot)
                                         order by f.bought_at, f.id)
                          from public.player_furniture f where f.player_id = p_player and f.placed), '[]'::jsonb),
    'garage', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'car_key', c.car_key, 'slot', c.slot) order by c.slot)
                          from public.player_cars c where c.player_id = p_player), '[]'::jsonb),
    'value_cents', public.player_property_value_cents(p_player));
end;
$$;
comment on function public.property_json(uuid) is 'PROPERTY of a player (docs/PROPERTY.md section 2); public for every player.';

-- INVENTORY: furniture that is not placed; cars always stand in the garage
create or replace function public.property_inventory_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'furniture', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'item_key', f.item_key) order by f.bought_at, f.id)
                             from public.player_furniture f where f.player_id = p_player and not f.placed), '[]'::jsonb),
    'cars', '[]'::jsonb);
$$;

-- {property, inventory}: the inventory only for the owner
create or replace function public.property_state(p_target uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'property', public.property_json(p_target),
    'inventory', case when p_target = p_viewer then public.property_inventory_json(p_target) end);
$$;

-- ---------------------------------------------------------------------------
-- E. Read RPC
-- ---------------------------------------------------------------------------
-- p_nickname null = the caller. Other players' homes and garages are public, their inventory is not.
create or replace function public.get_property(p_nickname text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_target uuid;
begin
  v_player := public.require_player();
  if p_nickname is null then
    v_target := v_player;
  else
    select p.id into v_target from public.profiles p where lower(p.nickname) = lower(btrim(p_nickname));
  end if;
  if v_target is null then
    perform public.api_error('player_not_found');
  end if;
  return public.property_state(v_target, v_player);
end;
$$;
comment on function public.get_property(text) is
  'RPC: {property, inventory} of a player (ADR-082); inventory only for the own home (else null); error player_not_found.';

-- ---------------------------------------------------------------------------
-- F. Write RPCs (unlock level property, idempotent per request_id, money to the households)
-- ---------------------------------------------------------------------------
-- Moving up (skipping tiers allowed): price minus the trade-in of the current home. All
-- furniture goes back into the inventory, the cars stay in the garage.
create or replace function public.buy_home(p_request_id uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  h        public.player_homes;
  t        jsonb;
  cur      jsonb;
  v_cash   bigint;
  v_cost   bigint;
begin
  v_player := public.require_player();
  perform public.property_require_unlock(v_player);
  t := public.property_tier(p_tier);
  if p_request_id is null or t is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_home');
  if v_replay is not null then
    return v_replay;
  end if;
  v_cash := public.lock_player_accounts(v_player);
  h := public.property_home_for_update(v_player);
  if coalesce((select p.level from public.profiles p where p.id = v_player), 1) < (t ->> 'minLevel')::integer then
    perform public.api_error('property_locked');
  end if;
  cur := public.property_tier(h.tier);
  if cur is not null and (t ->> 'idx')::integer <= (cur ->> 'idx')::integer then
    perform public.api_error('invalid_tier');
  end if;
  v_cost := public.property_upgrade_cost_cents(case when cur is null then null else h.tier end, p_tier);
  if v_cash < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('households'),
                                   v_cost, 'lifestyle_purchase',
                                   case when cur is null then 'Eigene Bleibe gekauft' else 'Umzug in eine größere Bleibe' end,
                                   'player_home', v_player, 'property:home:' || v_player::text || ':' || p_request_id::text, v_player,
                                   jsonb_build_object('from', case when cur is null then null else h.tier end, 'to', p_tier,
                                                      'trade_in_cents', public.property_trade_in_cents(case when cur is null then null else h.tier end)));
  end if;
  update public.player_furniture set placed = false, x = null, y = null, rot = 0 where player_id = v_player and placed;
  update public.player_homes set tier = p_tier, updated_at = now() where player_id = v_player;
  perform public.mission_event(v_player, 'home_bought', 1, p_tier);
  if cur is not null then
    perform public.mission_event(v_player, 'home_upgraded', 1, p_tier);
  end if;
  return public.request_complete(v_player, p_request_id,
    public.property_state(v_player, v_player) || jsonb_build_object('cost_cents', v_cost));
end;
$$;
comment on function public.buy_home(uuid, text) is
  'RPC: buys the first or a bigger home (cost = price - trade-in of the current one; furniture back into the inventory); errors property_locked, invalid_argument, invalid_tier, insufficient_funds.';

-- p_count pieces of one item into the inventory (a home is not required)
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
  v_cash   bigint;
  v_cost   bigint;
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
  v_cost := v_price * p_count;
  v_cash := public.lock_player_accounts(v_player);
  if v_cash < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('households'),
                                 v_cost, 'lifestyle_purchase', 'Möbel gekauft', 'furniture', null,
                                 'property:furniture:' || v_player::text || ':' || p_request_id::text, v_player,
                                 jsonb_build_object('item_key', p_item_key, 'count', p_count, 'price_cents', v_price));
  insert into public.player_furniture (player_id, item_key, price_paid_cents)
  select v_player, p_item_key, v_price from generate_series(1, p_count);
  perform public.mission_event(v_player, 'furniture_bought', p_count, p_item_key);
  return public.request_complete(v_player, p_request_id, public.property_state(v_player, v_player));
end;
$$;
comment on function public.buy_furniture(uuid, text, integer) is
  'RPC: buys 1..20 pieces of furniture into the inventory; errors property_locked, invalid_argument, item_not_found, insufficient_funds.';

-- once per material, usable in every home; an owned material costs nothing again
create or replace function public.buy_floor(p_request_id uuid, p_material text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_price  bigint;
  v_cash   bigint;
  h        public.player_homes;
begin
  v_player := public.require_player();
  perform public.property_require_unlock(v_player);
  v_price := public.property_floor_price_cents(p_material);
  if p_request_id is null or v_price is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_floor');
  if v_replay is not null then
    return v_replay;
  end if;
  v_cash := public.lock_player_accounts(v_player);
  h := public.property_home_for_update(v_player);
  if not public.property_floor_owned(h.floors_owned, p_material) then
    if v_cash < v_price then
      perform public.api_error('insufficient_funds');
    end if;
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('households'),
                                   v_price, 'lifestyle_purchase', 'Bodenbelag gekauft', 'player_home', v_player,
                                   'property:floor:' || v_player::text || ':' || p_material, v_player,
                                   jsonb_build_object('material', p_material));
    update public.player_homes set floors_owned = array_append(floors_owned, p_material), updated_at = now()
     where player_id = v_player;
  end if;
  return public.request_complete(v_player, p_request_id, public.property_state(v_player, v_player));
end;
$$;
comment on function public.buy_floor(uuid, text) is
  'RPC: buys a floor material once (owned or free: no charge); errors property_locked, invalid_argument, insufficient_funds.';

-- p_placed is the whole layout [{id, x, y, rot}]; everything else goes back into the inventory.
create or replace function public.save_layout(p_request_id uuid, p_wall_color text, p_floor text, p_placed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  h        public.player_homes;
  t        jsonb;
  v_w      integer;
  v_h      integer;
  v_n      integer;
begin
  v_player := public.require_player();
  perform public.property_require_unlock(v_player);
  if p_request_id is null or p_wall_color is null or p_floor is null or jsonb_typeof(p_placed) is distinct from 'array'
     or not coalesce(public.property_config() -> 'wallColors' @> to_jsonb(lower(p_wall_color)), false) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'save_layout');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into h from public.player_homes where player_id = v_player for update;
  t := public.property_tier(h.tier);
  if t is null then
    perform public.api_error('no_home');
  end if;
  if not public.property_floor_owned(h.floors_owned, p_floor) then
    perform public.api_error('floor_not_owned');
  end if;
  v_w := (t ->> 'width')::integer;
  v_h := (t ->> 'height')::integer;

  -- shape: {id: uuid, x, y: integers >= 0, rot: 0 | 90}
  if exists (select 1 from jsonb_array_elements(p_placed) e
              where jsonb_typeof(e) is distinct from 'object'
                 or jsonb_typeof(e -> 'id') is distinct from 'string'
                 or (e ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 or jsonb_typeof(e -> 'x') is distinct from 'number' or (e ->> 'x') !~ '^[0-9]{1,4}$'
                 or jsonb_typeof(e -> 'y') is distinct from 'number' or (e ->> 'y') !~ '^[0-9]{1,4}$'
                 or jsonb_typeof(e -> 'rot') is distinct from 'number' or (e ->> 'rot') not in ('0', '90')) then
    perform public.api_error('layout_invalid');
  end if;
  -- every id once and owned by the caller
  select count(*) into v_n from jsonb_array_elements(p_placed);
  if v_n <> (select count(distinct (e ->> 'id')::uuid) from jsonb_array_elements(p_placed) e)
     or v_n <> (select count(*) from jsonb_array_elements(p_placed) e
                  join public.player_furniture f on f.id = (e ->> 'id')::uuid and f.player_id = v_player) then
    perform public.api_error('layout_invalid');
  end if;
  -- invalidPlacements: inside the floor, no two pieces of the same layer on one tile (rugs lie under objects)
  if exists (
       with p as (
         select (e ->> 'x')::integer as x, (e ->> 'y')::integer as y, c.layer,
                case when (e ->> 'rot') = '90' then c.height else c.width end::integer as w,
                case when (e ->> 'rot') = '90' then c.width else c.height end::integer as hh
           from jsonb_array_elements(p_placed) e
           join public.player_furniture f on f.id = (e ->> 'id')::uuid
           join public.furniture_catalog c on c.key = f.item_key)
       select 1 from p where p.x + p.w > v_w or p.y + p.hh > v_h)
  then
    perform public.api_error('layout_invalid');
  end if;
  if exists (
       with p as (
         select (e ->> 'x')::integer as x, (e ->> 'y')::integer as y, c.layer,
                case when (e ->> 'rot') = '90' then c.height else c.width end::integer as w,
                case when (e ->> 'rot') = '90' then c.width else c.height end::integer as hh
           from jsonb_array_elements(p_placed) e
           join public.player_furniture f on f.id = (e ->> 'id')::uuid
           join public.furniture_catalog c on c.key = f.item_key)
       select 1 from p
         cross join lateral generate_series(p.x, p.x + p.w - 1) cx
         cross join lateral generate_series(p.y, p.y + p.hh - 1) cy
        group by p.layer, cx, cy
       having count(*) > 1)
  then
    perform public.api_error('layout_invalid');
  end if;

  update public.player_furniture set placed = false, x = null, y = null, rot = 0 where player_id = v_player and placed;
  update public.player_furniture f
     set placed = true, x = (e ->> 'x')::smallint, y = (e ->> 'y')::smallint, rot = (e ->> 'rot')::smallint
    from jsonb_array_elements(p_placed) e
   where f.id = (e ->> 'id')::uuid and f.player_id = v_player;
  update public.player_homes set wall_color = lower(p_wall_color), floor = p_floor, updated_at = now() where player_id = v_player;
  perform public.mission_event(v_player, 'furniture_placed', v_n, null);
  return public.request_complete(v_player, p_request_id, public.property_state(v_player, v_player));
end;
$$;
comment on function public.save_layout(uuid, text, text, jsonb) is
  'RPC: replaces the layout, wall colour and floor of the home; errors property_locked, invalid_argument (wall colour), no_home, floor_not_owned, layout_invalid.';

-- into the first free garage slot of the home
create or replace function public.buy_car(p_request_id uuid, p_car_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  h        public.player_homes;
  t        jsonb;
  v_price  bigint;
  v_cash   bigint;
  v_slots  integer;
  v_slot   integer;
  v_id     uuid := gen_random_uuid();
begin
  v_player := public.require_player();
  perform public.property_require_unlock(v_player);
  if p_request_id is null or p_car_key is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_car');
  if v_replay is not null then
    return v_replay;
  end if;
  v_cash := public.lock_player_accounts(v_player);
  select * into h from public.player_homes where player_id = v_player for update;
  t := public.property_tier(h.tier);
  if t is null then
    perform public.api_error('no_home');
  end if;
  select c.price_cents into v_price from public.car_catalog c where c.key = p_car_key;
  if v_price is null then
    perform public.api_error('item_not_found');
  end if;
  v_slots := coalesce((t ->> 'garageSlots')::integer, 0);
  select min(s) into v_slot from generate_series(0, v_slots - 1) s
   where not exists (select 1 from public.player_cars c where c.player_id = v_player and c.slot = s);
  if v_slot is null then
    perform public.api_error('garage_full');
  end if;
  if v_cash < v_price then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('households'),
                                 v_price, 'lifestyle_purchase', 'Auto gekauft', 'car', v_id,
                                 'property:car:' || v_id::text, v_player, jsonb_build_object('car_key', p_car_key));
  insert into public.player_cars (id, player_id, car_key, slot, price_paid_cents) values (v_id, v_player, p_car_key, v_slot, v_price);
  perform public.mission_event(v_player, 'car_bought', 1, p_car_key);
  return public.request_complete(v_player, p_request_id, public.property_state(v_player, v_player));
end;
$$;
comment on function public.buy_car(uuid, text) is
  'RPC: buys a car into the first free garage slot; errors property_locked, invalid_argument, no_home, item_not_found, garage_full, insufficient_funds.';

-- Furniture from the inventory (not placed) or a car, for resaleBps of the price paid, from the households.
create or replace function public.sell_item(p_request_id uuid, p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_paid   bigint;
  v_key    text;
  v_refund bigint;
begin
  v_player := public.require_player();
  perform public.property_require_unlock(v_player);
  if p_request_id is null or p_id is null or p_kind is null or p_kind not in ('furniture', 'car') then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'sell_item');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.lock_player_accounts(v_player);
  if p_kind = 'furniture' then
    delete from public.player_furniture f where f.id = p_id and f.player_id = v_player and not f.placed
    returning f.price_paid_cents, f.item_key into v_paid, v_key;
  else
    delete from public.player_cars c where c.id = p_id and c.player_id = v_player
    returning c.price_paid_cents, c.car_key into v_paid, v_key;
  end if;
  if v_paid is null then
    perform public.api_error('item_not_found');
  end if;
  v_refund := public.property_resale_cents(v_paid);
  if v_refund > 0 then
    perform public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(v_player, 'player_cash'),
                                   v_refund, 'lifestyle_sale', case when p_kind = 'car' then 'Auto verkauft' else 'Möbel verkauft' end,
                                   p_kind, p_id, 'property:sell:' || p_id::text, v_player,
                                   jsonb_build_object('item_key', v_key, 'price_paid_cents', v_paid));
    perform public.loan_withhold(v_player, v_refund, 'property:sell:' || p_id::text);
  end if;
  return public.request_complete(v_player, p_request_id,
    public.property_state(v_player, v_player) || jsonb_build_object('refund_cents', v_refund));
end;
$$;
comment on function public.sell_item(uuid, text, uuid) is
  'RPC: sells furniture from the inventory or a car for resaleBps of the price paid; errors property_locked, invalid_argument, item_not_found.';

-- ---------------------------------------------------------------------------
-- G. Net worth with property (rich list, player card, state missions)
-- ---------------------------------------------------------------------------
create or replace function public.player_net_worth_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(a.balance_cents) from public.ledger_accounts a where a.owner_player_id = p_player), 0)::bigint
       + coalesce((select sum(public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))
                     from public.positions p join public.security_quotes q on q.security_id = p.security_id
                    where p.player_id = p_player and p.status = 'open' and p.quantity_e6 > 0), 0)::bigint
       -- founder's player company (ADR-057): cash - unpaid + earnings value
       + public.player_company_value_cents(p_player)
       -- artworks at their last sale price (ADR-080)
       + public.player_art_value_cents(p_player)
       -- home, furniture, cars and floors (ADR-082)
       + public.player_property_value_cents(p_player)
       - public.player_debt_cents(p_player);
$$;

-- rich_list_entries as in M4a plus the value of the property
create or replace function public.rich_list_entries()
returns table (entity_kind text, entity_id uuid, name text, description text, net_worth_cents bigint, rank_all integer, rank_players integer)
language sql
stable
security definer
set search_path = ''
as $$
  with players as (
    select p.id,
           coalesce(a.cash, 0) + coalesce(v.val, 0) + coalesce(public.company_value_cents(pc.company_id), 0)
             + coalesce(art.val, 0) + public.player_property_value_cents(p.id) - coalesce(d.debt, 0) as nw,
           p.nickname
      from public.profiles p
      left join (select owner_player_id, sum(balance_cents)::bigint as cash from public.ledger_accounts
                  where owner_player_id is not null group by owner_player_id) a on a.owner_player_id = p.id
      left join (select pos.player_id, sum(public.value_cents(pos.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))::bigint as val
                   from public.positions pos join public.security_quotes q on q.security_id = pos.security_id
                  where pos.status = 'open' and pos.quantity_e6 > 0 group by pos.player_id) v on v.player_id = p.id
      left join public.player_companies pc on pc.founder_id = p.id and pc.status = 'active'
      left join (select l.player_id, sum(l.outstanding_cents)::bigint as debt from public.player_loans l
                  where l.status = 'open' group by l.player_id) d on d.player_id = p.id
      left join (select aw.owner_id, sum(aw.value_cents)::bigint as val from public.artworks aw
                  where aw.owner_id is not null and aw.value_cents is not null group by aw.owner_id) art on art.owner_id = p.id
     where not p.is_deactivated
  ), tycoons as (
    select t.id, t.name, t.description,
           t.cash_cents + coalesce(sum(public.value_cents(h.quantity_e6, coalesce(q.bid_e4, q.last_price_e4))), 0)::bigint as nw
      from public.rich_tycoons t
      left join public.rich_tycoon_holdings h on h.tycoon_id = t.id
      left join public.security_quotes q on q.security_id = h.security_id
     group by t.id
  ), allx as (
    select 'player'::text as entity_kind, id as entity_id, nickname as name, null::text as description, nw from players
    union all
    select 'tycoon', id, name, description, nw from tycoons
  )
  select x.entity_kind, x.entity_id, x.name, x.description, x.nw,
         (row_number() over (order by x.nw desc, x.entity_kind, x.entity_id))::integer,
         case when x.entity_kind = 'player'
              then (row_number() over (partition by x.entity_kind order by x.nw desc, x.entity_id))::integer end
    from allx x;
$$;

-- ---------------------------------------------------------------------------
-- H. Account reset/delete removes the property (account_wipe as in M4a plus
--    player_homes, player_furniture, player_cars; no refund: the money went to
--    the households when it was spent)
-- ---------------------------------------------------------------------------
create or replace function public.account_wipe(p_player uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nick    text;
  v_company uuid;
  v_state   uuid := public.ledger_system_account(case when public.money_genesis_done() then 'treasury' else 'mint' end);
  v_bal     bigint;
  r         record;
begin
  perform public.lock_player_accounts(p_player);
  select p.nickname into v_nick from public.profiles p where p.id = p_player for update;

  -- artworks (ADR-080): back to the gallery, auctions cancelled, reserved bids back to the cash
  perform public.artworks_wipe_player(p_player, p_key);

  -- own company: open share offers are settled first, then it is dissolved like close_company
  select pc.company_id into v_company from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active';
  if v_company is not null then
    for r in select o.id from public.company_share_offers o where o.company_id = v_company and o.status = 'open' order by o.id loop
      perform public.close_share_offer(r.id);
    end loop;
    perform public.company_dissolve(v_company, 'closed');
  end if;

  -- subscriptions to other companies' open offers lapse (the money stays with the company)
  for r in select s.offer_id, sum(s.shares_e6)::bigint as q from public.offer_subscriptions s
            join public.company_share_offers o on o.id = s.offer_id and o.status = 'open'
           where s.player_id = p_player group by s.offer_id order by s.offer_id loop
    update public.company_share_offers set shares_subscribed_e6 = greatest(0, shares_subscribed_e6 - r.q) where id = r.offer_id;
  end loop;

  -- job: wages up to now, then ended without notice or fee
  for r in select pj.id, pj.company_id from public.player_jobs pj where pj.player_id = p_player and pj.status = 'active' order by pj.id loop
    perform public.accrue_job_salary(r.id);
    update public.player_jobs set status = 'ended', ended_at = now(), end_reason = 'quit', notice_ends_at = null where id = r.id;
    perform public.company_system_message(r.company_id, v_nick || ' hat das Unternehmen verlassen.');
  end loop;

  -- open orders release their reservations; holdings are given up
  for r in select o.id from public.orders o
            where o.player_id = p_player and o.status in ('pending', 'open', 'partially_filled') order by o.id loop
    perform public.cancel_order_internal(r.id);
  end loop;
  update public.positions
     set status = 'closed', closed_at = now(), quantity_e6 = 0, reserved_quantity_e6 = 0, cost_basis_cents = 0,
         margin_cents = 0, borrowed_cents = 0, liquidation_price_e4 = null
   where player_id = p_player and status = 'open';

  -- game state of the player (M4b: home, furniture and cars are given up without a refund)
  for r in select * from (values
             ('position_lots', 'player_id'), ('xp_events', 'player_id'), ('xp_daily_counters', 'player_id'),
             ('vault_claims', 'player_id'), ('daily_logins', 'player_id'), ('player_missions', 'player_id'),
             ('player_achievements', 'player_id'), ('player_cosmetics', 'player_id'), ('player_lifestyle_items', 'player_id'),
             ('player_random_events', 'player_id'), ('player_bankruptcies', 'player_id'), ('margin_events', 'player_id'),
             ('financing_charges', 'player_id'), ('player_tax_years', 'player_id'), ('distribution_payouts', 'player_id'),
             ('watchlist_items', 'player_id'), ('portfolio_snapshots', 'player_id'), ('stock_option_grants', 'player_id'),
             ('loans', 'player_id'), ('cap_table_entries', 'player_id'), ('share_lockups', 'player_id'),
             ('capital_injections', 'player_id'), ('takeover_offers', 'bidder_player_id'), ('angel_offers', 'investor_player_id'),
             ('ipo_subscriptions', 'player_id'), ('shareholder_vote_ballots', 'player_id'), ('reputation_events', 'player_id'),
             ('insider_violations', 'player_id'), ('salary_payouts', 'player_id'), ('work_tasks', 'player_id'),
             ('salary_negotiations', 'player_id'), ('player_work_tasks', 'player_id'), ('player_jobs', 'player_id'),
             ('job_offers', 'to_player_id'), ('job_applications', 'player_id'), ('player_skills', 'player_id'),
             ('player_skill_points', 'player_id'), ('daily_reward_claims', 'player_id'), ('player_loans', 'player_id'),
             ('offer_subscriptions', 'player_id'), ('notifications', 'player_id'), ('feed_items', 'actor_id'),
             ('league_entries', 'player_id'), ('league_entry_baselines', 'player_id'), ('company_logo_reports', 'reporter_id'),
             ('player_unlocks', 'player_id'), ('player_furniture', 'player_id'), ('player_cars', 'player_id'),
             ('player_homes', 'player_id')
           ) as t(tbl, col) loop
    execute format('delete from public.%I where %I = $1', r.tbl, r.col) using p_player;
  end loop;
  delete from public.rich_list_snapshots where entity_kind = 'player' and entity_id = p_player;

  -- money back to the state: one balanced posting per account
  for r in select a.id from public.ledger_accounts a where a.owner_player_id = p_player and a.balance_cents > 0 order by a.id loop
    select a.balance_cents into v_bal from public.ledger_accounts a where a.id = r.id;
    perform public.ledger_transfer(r.id, v_state, v_bal, 'transfer', 'Konto zurückgesetzt', 'profile', p_player,
                                   p_key || ':' || r.id::text, p_player);
  end loop;

  update public.profiles
     set level = 1, xp_total = 0, reputation = 50, title_key = null, frame_key = null,
         bankrupt_until = null, founding_locked_until = null
   where id = p_player;
  update public.player_private
     set founding_ban_until = null, bankruptcy_count = 0, career_experience_minutes = 0, ipo_investment_limit_cents = null,
         tutorial_completed_at = null, tax_loss_pot_cents = 0
   where player_id = p_player;
end;
$$;
comment on function public.account_wipe(uuid, text) is 'Internal: cleanup shared by reset_account() and delete_account().';

-- ---------------------------------------------------------------------------
-- I. Missions (metrics home_bought, home_upgraded, furniture_bought (sum),
--    furniture_placed (max: pieces placed in one saved layout), car_bought)
-- ---------------------------------------------------------------------------
insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  ('q_home_furniture', 'quick',     'Kauf ein Möbelstück',                       'Im Möbelhaus auf dem Tab „Grundstück“.',             'mission_home', 'furniture_bought', 'sum',   '{"unlock":"property"}', 1, 1, 30, 50, 4, null, false, 40, 0),
  ('m_home_first',     'milestone', 'Kauf deine erste Bleibe',                   'Eine eigene Wohnung gibt es ab Level 4.',            'mission_home', 'home_bought',      'count', '{"unlock":"property"}', 1, 1, 300, 300, 4, 20, false, 100, 1),
  ('m_home_furnish',   'milestone', 'Stell {target} Möbel in deiner Bleibe auf', 'Teppiche zählen mit. Speichere die Einrichtung.',    'mission_home', 'furniture_placed', 'max',   '{"unlock":"property"}', 5, 5, 400, 400, 4, 21, false, 100, 1),
  ('m_home_upgrade',   'milestone', 'Zieh in eine größere Bleibe',               'Deine alte Bleibe wird zur Hälfte angerechnet.',     'mission_home', 'home_upgraded',    'count', '{"unlock":"property"}', 1, 1, 800, 800, 8, 23, false, 100, 1),
  ('m_home_car',       'milestone', 'Stell dein erstes Auto in die Garage',      'Eine Garage gibt es ab dem Haus.',                   'mission_home', 'car_bought',       'count', '{"unlock":"property"}', 1, 1, 1000, 1000, 14, 25, false, 100, 1)
on conflict (key) do update
   set kind = excluded.kind, title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params, target_min = excluded.target_min,
       target_max = excluded.target_max, xp_min = excluded.xp_min, xp_max = excluded.xp_max, min_level = excluded.min_level,
       chain_order = excluded.chain_order, scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true;

-- ---------------------------------------------------------------------------
-- J. Unlock row (seed.sql has it too; levels exist only after seed.sql on a new database)
-- ---------------------------------------------------------------------------
insert into public.unlocks (key, level, title, description, icon_key, intro_mission_key, sort_order)
select 'property', 4, 'Grundstück', 'Kauf dir eine eigene Bleibe, richte sie ein und stell Autos in die Garage.', 'unlock_home', null, 40
 where exists (select 1 from public.levels l where l.level = 4)
on conflict (key) do nothing;
insert into public.player_unlocks (player_id, unlock_key)
select p.id, 'property' from public.profiles p
 where p.level >= 4 and exists (select 1 from public.unlocks u where u.key = 'property')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- K. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.api_error(text)', 'public.property_config()', 'public.property_tier(text)', 'public.property_trade_in_cents(text)',
    'public.property_upgrade_cost_cents(text, text)', 'public.property_resale_cents(bigint)',
    'public.property_floor_price_cents(text)', 'public.property_floor_owned(text[], text)', 'public.property_require_unlock(uuid)',
    'public.player_property_value_cents(uuid)', 'public.property_home_for_update(uuid)', 'public.property_json(uuid)',
    'public.property_inventory_json(uuid)', 'public.property_state(uuid, uuid)', 'public.get_property(text)',
    'public.buy_home(uuid, text)', 'public.buy_furniture(uuid, text, integer)', 'public.buy_floor(uuid, text)',
    'public.save_layout(uuid, text, text, jsonb)', 'public.buy_car(uuid, text)', 'public.sell_item(uuid, text, uuid)',
    'public.player_net_worth_cents(uuid)', 'public.rich_list_entries()', 'public.account_wipe(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_property(text)', 'public.buy_home(uuid, text)', 'public.buy_furniture(uuid, text, integer)',
    'public.buy_floor(uuid, text)', 'public.save_layout(uuid, text, text, jsonb)', 'public.buy_car(uuid, text)',
    'public.sell_item(uuid, text, uuid)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
