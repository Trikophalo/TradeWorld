-- =============================================================================
-- NEXA · 5210 · Nexamon: collectible cards with booster packs, grading and a card market (ADR-165)
-- =============================================================================
-- * Catalogue: game_config.nexamon_cards (key, set, number, rarity, startPriceCents of 231 cards, written by
--   `pnpm db:config` from src/config/nexamon), rules in game_config.nexamon (src/config/nexamon-rules.ts).
--   nexamon_sync() mirrors the catalogue into nexamon_cards (idempotent, by a hash) and gives the AI sellers their
--   starting stock. A card's start price always follows the catalogue, its market value only while it never moved.
-- * Units: a card's market value is a price (value_e4 = euros x 10 000); money is cents, rounded half to even once
--   (nexamon_copy_value_cents). A copy is worth value x condition factor, in a slab value x grade factor.
-- * Packs: buy_nexamon_pack() takes the pack price to the households and pulls 5 cards. Slots 1 to 3 are commons,
--   slot 4 rolls ultra/rare/common, slot 5 legendary/prisma/ultra/rare/common (odds in parts of 3600). Every pull
--   raises the card's population by one; the copy carries that number (serial) and a rolled condition.
-- * Market: one copy per listing at a free price; the seller pays market.feeBps to the households. AI sellers offer
--   their stock at the copy's value + 10 % and follow the value; AI collectors buy player listings only up to the
--   copy's value (households money), limited per card and week and per set and day.
-- * Value: sales near the value move it a bounded step (nexamon_sell), supply against demand moves it once per hour
--   (nexamon_pressure_step); floor, cap and a corridor per Berlin day (nexamon_set_value). Anti-manipulation: only
--   prices within the band count, one counted sale per pair of players, card and day, three per buyer and day.
-- * Grading by "ASP": 50 % of the copy's value, one hour, grade 1..10 rolled at the end by the copy's condition;
--   crack_nexamon_slab() returns the raw card without a refund.
-- * Job nexamon_run_due() (cron nexa-nexamon, every minute): finishes gradings, AI packs, AI purchases, AI listings,
--   the hourly value step. Port of src/lib/sim/nexamon.ts.
--
-- RPCs (authenticated): get_nexamon(), buy_nexamon_pack(p_request_id, p_set), get_nexamon_collection(p_set),
--   get_nexamon_card(p_key), get_nexamon_market(p_set, p_rarity, p_sort, p_page, p_seller, p_card_key, p_graded),
--   list_nexamon_card(p_request_id, p_copy_id, p_price_cents), unlist_nexamon_card(p_request_id, p_listing_id),
--   buy_nexamon_listing(p_request_id, p_listing_id, p_price_cents), sell_nexamon_to_ai(p_request_id, p_copy_ids),
--   grade_nexamon_card(p_request_id, p_copy_id), crack_nexamon_slab(p_request_id, p_copy_id).
-- Errors: nexamon_locked NX163, nexamon_unknown NX164, nexamon_not_owner NX165, nexamon_listed NX166,
--   nexamon_not_listed NX167, nexamon_price_changed NX168, nexamon_listing_limit NX169, nexamon_grading NX170,
--   nexamon_not_raw NX171, nexamon_not_graded NX172, nexamon_not_sellable NX173, nexamon_own_listing NX174,
--   nexamon_grading_limit NX175.
-- Idempotent: runs unchanged as supabase/updates/20261204005210_nexamon.sql.

-- ---------------------------------------------------------------------------
-- A. Error keys, notification types
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''nexamon_grading_limit''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'chat_already_member'        then 'NX162'
$q$, $q$    when 'chat_already_member'        then 'NX162'
    when 'nexamon_locked'             then 'NX163'
    when 'nexamon_unknown'            then 'NX164'
    when 'nexamon_not_owner'          then 'NX165'
    when 'nexamon_listed'             then 'NX166'
    when 'nexamon_not_listed'         then 'NX167'
    when 'nexamon_price_changed'      then 'NX168'
    when 'nexamon_listing_limit'      then 'NX169'
    when 'nexamon_grading'            then 'NX170'
    when 'nexamon_not_raw'            then 'NX171'
    when 'nexamon_not_graded'         then 'NX172'
    when 'nexamon_not_sellable'       then 'NX173'
    when 'nexamon_own_listing'        then 'NX174'
    when 'nexamon_grading_limit'      then 'NX175'
$q$);
    if position('''nexamon_grading_limit''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the Nexamon error keys by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('nexamon_sale', 'social', 'Nexamon-Karte verkauft', 'Jemand hat eine deiner Nexamon-Karten gekauft.', 'notif_bell',
        true, true, false, 299),
       ('nexamon_graded', 'social', 'Grading fertig', 'ASP hat deine Nexamon-Karte bewertet.', 'notif_bell',
        true, true, false, 300)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Tables (internal: read and written only by the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.nexamon_cards (
  card_key        text primary key check (char_length(card_key) between 1 and 32),
  set_key         text not null check (char_length(set_key) between 1 and 32),
  number          integer not null check (number > 0),
  rarity          text not null check (rarity in ('common', 'rare', 'ultra', 'prisma', 'legendary')),
  start_e4        bigint not null check (start_e4 > 0),
  value_e4        bigint not null check (value_e4 > 0),
  population      bigint not null default 0 check (population >= 0),
  counted_trades  bigint not null default 0 check (counted_trades >= 0),
  day_ref_e4      bigint not null check (day_ref_e4 > 0),
  day_ref_on      date not null,
  moved_at        timestamptz,
  first_pulled_at timestamptz,
  pressure_at     timestamptz,
  seeded          boolean not null default false,
  in_catalogue    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (set_key, number)
);
create index if not exists nexamon_cards_set_rarity_idx on public.nexamon_cards (set_key, rarity);
create index if not exists nexamon_cards_pressure_idx on public.nexamon_cards (pressure_at nulls first);
drop trigger if exists set_updated_at on public.nexamon_cards;
create trigger set_updated_at before update on public.nexamon_cards for each row execute function public.set_updated_at();
alter table public.nexamon_cards enable row level security;
revoke all on public.nexamon_cards from public, anon, authenticated;
grant all on public.nexamon_cards to service_role;
comment on table public.nexamon_cards is
  'Nexamon cards (ADR-165): one row per card of the catalogue with its market value (value_e4 = euros x 10 000), '
  'population, counted trades and the day''s reference value. moved_at null = the value still follows the catalogue. '
  'Internal (nexamon_sync, RPCs).';

create table if not exists public.nexamon_copies (
  id                uuid primary key default gen_random_uuid(),
  card_key          text not null references public.nexamon_cards (card_key),
  serial            bigint not null check (serial > 0),
  owner_id          uuid references public.profiles (id) on delete cascade,
  ai_owner          text check (ai_owner is null or char_length(ai_owner) between 1 and 40),
  condition         text not null check (condition in ('poor', 'good', 'near_mint', 'mint')),
  grade             smallint check (grade is null or grade between 1 and 10),
  graded_at         timestamptz,
  grading_until     timestamptz,
  grading_fee_cents bigint check (grading_fee_cents is null or grading_fee_cents >= 0),
  source            text not null check (source in ('pack', 'ai_pack', 'seed')),
  pack_id           uuid,
  acquired_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint nexamon_copies_owner_check check ((owner_id is null) <> (ai_owner is null)),
  constraint nexamon_copies_grading_check check (grading_until is null or grade is null),
  unique (card_key, serial)
);
create index if not exists nexamon_copies_owner_idx on public.nexamon_copies (owner_id, card_key) where owner_id is not null;
create index if not exists nexamon_copies_ai_idx on public.nexamon_copies (card_key) where ai_owner is not null;
create index if not exists nexamon_copies_grading_idx on public.nexamon_copies (grading_until) where grading_until is not null;
alter table public.nexamon_copies enable row level security;
revoke all on public.nexamon_copies from public, anon, authenticated;
grant all on public.nexamon_copies to service_role;
comment on table public.nexamon_copies is
  'Nexamon copies (ADR-165): every pulled card with its population number (serial), condition, owner (a player or an '
  'AI seller) and, after grading by ASP, its grade. grading_until = at ASP until then. Internal (RPCs).';

create table if not exists public.nexamon_listings (
  id          uuid primary key default gen_random_uuid(),
  copy_id     uuid not null unique references public.nexamon_copies (id) on delete cascade,
  card_key    text not null references public.nexamon_cards (card_key),
  seller_id   uuid references public.profiles (id) on delete cascade,
  seller_ai   text check (seller_ai is null or char_length(seller_ai) between 1 and 40),
  price_cents bigint not null check (price_cents > 0),
  created_at  timestamptz not null default now(),
  constraint nexamon_listings_seller_check check ((seller_id is null) <> (seller_ai is null))
);
create index if not exists nexamon_listings_card_idx on public.nexamon_listings (card_key, price_cents);
create index if not exists nexamon_listings_seller_idx on public.nexamon_listings (seller_id) where seller_id is not null;
create index if not exists nexamon_listings_new_idx on public.nexamon_listings (created_at desc);
alter table public.nexamon_listings enable row level security;
revoke all on public.nexamon_listings from public, anon, authenticated;
grant all on public.nexamon_listings to service_role;
comment on table public.nexamon_listings is
  'Open listings of the Nexamon market (ADR-165): one copy at a price, by a player or an AI seller. A row disappears '
  'when the copy is sold or taken back. Internal (RPCs).';

create table if not exists public.nexamon_sales (
  id              bigint generated always as identity primary key,
  card_key        text not null references public.nexamon_cards (card_key),
  copy_id         uuid references public.nexamon_copies (id) on delete set null,
  seller_id       uuid references public.profiles (id) on delete set null,
  seller_ai       text,
  buyer_id        uuid references public.profiles (id) on delete set null,
  buyer_ai        text,
  price_cents     bigint not null check (price_cents >= 0),
  fee_cents       bigint not null default 0 check (fee_cents >= 0),
  condition       text not null,
  grade           smallint,
  factor_bps      integer not null,
  kind            text not null check (kind in ('market', 'ai_buy', 'quick')),
  counted         boolean not null default false,
  value_before_e4 bigint not null,
  value_after_e4  bigint not null,
  at              timestamptz not null default now()
);
create index if not exists nexamon_sales_card_idx on public.nexamon_sales (card_key, at desc);
create index if not exists nexamon_sales_buyer_idx on public.nexamon_sales (buyer_id, card_key, at) where buyer_id is not null;
create index if not exists nexamon_sales_ai_idx on public.nexamon_sales (at) where kind = 'ai_buy';
create index if not exists nexamon_sales_copy_idx on public.nexamon_sales (copy_id) where copy_id is not null;
create index if not exists nexamon_sales_seller_idx on public.nexamon_sales (seller_id, card_key, at) where seller_id is not null;
alter table public.nexamon_sales enable row level security;
revoke all on public.nexamon_sales from public, anon, authenticated;
grant all on public.nexamon_sales to service_role;
comment on table public.nexamon_sales is
  'Sales of Nexamon copies (ADR-165): kind market (a listing bought by a player), ai_buy (an AI collector bought a '
  'player''s listing), quick (instant sale to the AI). counted = the sale moved the card''s value. Internal (RPCs).';

create table if not exists public.nexamon_packs (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.profiles (id) on delete cascade,
  set_key     text not null,
  price_cents bigint not null check (price_cents >= 0),
  cards       jsonb not null,
  opened_at   timestamptz not null default now()
);
create index if not exists nexamon_packs_player_idx on public.nexamon_packs (player_id, opened_at desc);
alter table public.nexamon_packs enable row level security;
revoke all on public.nexamon_packs from public, anon, authenticated;
grant all on public.nexamon_packs to service_role;
comment on table public.nexamon_packs is
  'Booster packs players opened (ADR-165) with the five pulls. The AI''s packs are only counted in '
  'nexamon_set_state. Internal (RPC buy_nexamon_pack).';

create table if not exists public.nexamon_value_points (
  card_key text not null references public.nexamon_cards (card_key) on delete cascade,
  at       timestamptz not null,
  value_e4 bigint not null check (value_e4 > 0),
  primary key (card_key, at)
);
alter table public.nexamon_value_points enable row level security;
revoke all on public.nexamon_value_points from public, anon, authenticated;
grant all on public.nexamon_value_points to service_role;
comment on table public.nexamon_value_points is
  'Value history of the Nexamon cards (ADR-165): the last value of every hour in which it changed. Internal.';

create table if not exists public.nexamon_set_state (
  set_key             text primary key,
  ai_packs_at         timestamptz not null default now(),
  ai_packs_opened     bigint not null default 0,
  player_packs_opened bigint not null default 0
);
alter table public.nexamon_set_state enable row level security;
revoke all on public.nexamon_set_state from public, anon, authenticated;
grant all on public.nexamon_set_state to service_role;
comment on table public.nexamon_set_state is
  'Per Nexamon set (ADR-165): until when the AI''s packs are opened and how many packs were opened. Internal.';

create table if not exists public.nexamon_meta (
  id             boolean primary key default true check (id),
  catalogue_hash text,
  synced_at      timestamptz
);
alter table public.nexamon_meta enable row level security;
revoke all on public.nexamon_meta from public, anon, authenticated;
grant all on public.nexamon_meta to service_role;
comment on table public.nexamon_meta is
  'One row (ADR-165): hash of the catalogue nexamon_sync() mirrored last. Internal.';

-- ---------------------------------------------------------------------------
-- C. Rules (port of src/lib/sim/nexamon.ts; fallbacks as in src/config/nexamon-rules.ts)
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'nexamon'), '{}'::jsonb);
$$;

create or replace function public.nexamon_catalogue()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'nexamon_cards'), '[]'::jsonb);
$$;

-- nexamonSlotRarity: slots 1..3 common; slot 4 and slot 5 roll in parts of odds.denominator, best rarity first
create or replace function public.nexamon_slot_rarity(p_slot integer, p_u double precision)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o      jsonb := public.nexamon_cfg() -> 'odds';
  t      jsonb;
  v_den  integer := coalesce((public.nexamon_cfg() #>> '{odds,denominator}')::integer, 3600);
  v_n    integer;
  v_edge integer := 0;
  r      text;
begin
  t := case when p_slot = 5 then o -> 'slot5' when p_slot = 4 then o -> 'slot4' end;
  if t is null then
    return 'common';
  end if;
  v_n := floor(least(greatest(coalesce(p_u, 0), 0), 0.999999999) * v_den)::integer;
  foreach r in array array['legendary', 'prisma', 'ultra', 'rare'] loop
    v_edge := v_edge + coalesce((t ->> r)::integer, 0);
    if v_n < v_edge then
      return r;
    end if;
  end loop;
  return 'common';
end;
$$;

-- nexamonRollCondition: conditions.order, worst first, weights in basis points
create or replace function public.nexamon_roll_condition(p_u double precision)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c      jsonb := public.nexamon_cfg() -> 'conditions';
  v_n    integer := floor(least(greatest(coalesce(p_u, 0), 0), 0.999999999) * 10000)::integer;
  v_edge integer := 0;
  v_last text := 'near_mint';
  r      text;
begin
  for r in select x from jsonb_array_elements_text(coalesce(c -> 'order', '[]'::jsonb)) with ordinality t(x, ord) order by ord loop
    v_edge := v_edge + coalesce((c -> 'weightBps' ->> r)::integer, 0);
    v_last := r;
    if v_n < v_edge then
      return r;
    end if;
  end loop;
  return v_last;
end;
$$;

-- nexamonRollGrade: grading.gradeWeightsBps[condition], index 0 = grade 1
create or replace function public.nexamon_roll_grade(p_condition text, p_u double precision)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w      jsonb := public.nexamon_cfg() #> array['grading', 'gradeWeightsBps', p_condition];
  v_n    integer := floor(least(greatest(coalesce(p_u, 0), 0), 0.999999999) * 10000)::integer;
  v_edge integer := 0;
  g      integer;
begin
  for g in 1 .. 10 loop
    v_edge := v_edge + coalesce((w ->> (g - 1))::integer, 0);
    if v_n < v_edge then
      return g;
    end if;
  end loop;
  return 10;
end;
$$;

-- nexamonCopyFactorBps: the grade's factor in a slab, else 100 % from "good" upwards, minus a step per condition below
create or replace function public.nexamon_copy_factor_bps(p_condition text, p_grade integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.nexamon_cfg();
  v_good  integer;
  v_this  integer;
begin
  if p_grade is not null then
    return coalesce((cfg #>> array['grading', 'valueBps', (least(greatest(p_grade, 1), 10) - 1)::text])::integer, 10000);
  end if;
  select max(ord) filter (where x = 'good'), max(ord) filter (where x = p_condition) into v_good, v_this
    from jsonb_array_elements_text(coalesce(cfg #> '{conditions,order}', '[]'::jsonb)) with ordinality t(x, ord);
  return greatest(0, 10000 - greatest(0, coalesce(v_good, 0) - coalesce(v_this, coalesce(v_good, 0)))
                               * coalesce((cfg #>> '{conditions,belowGoodStepBps}')::integer, 500));
end;
$$;

-- nexamonCopyValueCents: the one place where a card's price becomes money (half to even)
create or replace function public.nexamon_copy_value_cents(p_value_e4 bigint, p_condition text, p_grade integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select public.div_round_half_even(p_value_e4::numeric * public.nexamon_copy_factor_bps(p_condition, p_grade), 1000000);
$$;

-- nexamonAiAskCents: the copy's value + 10 %
create or replace function public.nexamon_ai_ask_cents(p_copy_value bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce((public.nexamon_cfg() #>> '{market,minPriceCents}')::bigint, 10),
                  public.div_round_half_even(p_copy_value::numeric * coalesce((public.nexamon_cfg() #>> '{ai,askBps}')::integer, 11000),
                                             10000));
$$;

-- nexamonPopularityBps: rarity plus a bonus for a low population
create or replace function public.nexamon_popularity_bps(p_rarity text, p_population bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(10000,
           coalesce((p -> 'rarityBps' ->> p_rarity)::integer, 0)
           + floor(coalesce((p ->> 'scarceBonusBps')::numeric, 0) * coalesce((p -> 'popRef' ->> p_rarity)::numeric, 1)
                   / (coalesce((p -> 'popRef' ->> p_rarity)::numeric, 1) + greatest(0, coalesce(p_population, 0))))::integer)
    from (select coalesce(public.nexamon_cfg() #> '{value,popularity}', '{}'::jsonb) as p) c;
$$;

-- nexamonDemandMilli: want x (popRef + seed) / (popRef + population) + recent purchases, in thousandths of a copy
create or replace function public.nexamon_demand_milli(p_rarity text, p_population bigint, p_recent_buys bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select floor(1000 * coalesce((cfg #>> array['value', 'pressure', 'want', p_rarity])::numeric, 1)
               * (coalesce((cfg #>> array['value', 'popularity', 'popRef', p_rarity])::numeric, 1)
                  + coalesce((cfg #>> array['ai', 'seedCopies', p_rarity])::numeric, 0))
               / (coalesce((cfg #>> array['value', 'popularity', 'popRef', p_rarity])::numeric, 1) + greatest(0, coalesce(p_population, 0))))::bigint
       + coalesce((cfg #>> '{value,pressure,buyWeightMilli}')::bigint, 0)
         * least(greatest(0, coalesce(p_recent_buys, 0)), coalesce((cfg #>> '{value,pressure,maxBuys}')::bigint, 0))
    from (select public.nexamon_cfg() as cfg) c;
$$;

-- nexamonPressureBps: (demand - supply) / want, -10 000 .. +10 000; a card nobody pulled yet stands still
create or replace function public.nexamon_pressure_bps(p_rarity text, p_population bigint, p_supply bigint, p_recent_buys bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(p_population, 0) <= 0 then 0
              else least(10000, greatest(-10000,
                     trunc((public.nexamon_demand_milli(p_rarity, p_population, p_recent_buys) - 1000 * greatest(0, coalesce(p_supply, 0)))::numeric
                           * 10 / coalesce((public.nexamon_cfg() #>> array['value', 'pressure', 'want', p_rarity])::numeric, 1))))::integer
         end;
$$;

-- nexamonCapBps and nexamonValueBounds: floor and cap of a card's value in e4
create or replace function public.nexamon_bounds(p_start_e4 bigint, p_first_pulled timestamptz, p_trades bigint, p_now timestamptz,
                                                 out floor_e4 bigint, out cap_e4 bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v      jsonb := public.nexamon_cfg() -> 'value';
  v_days bigint := greatest(0, floor(extract(epoch from (p_now - coalesce(p_first_pulled, p_now))) / 86400))::bigint;
  v_cap  bigint;
begin
  v_cap := least(coalesce((v ->> 'capMaxBps')::bigint, 200000),
                 coalesce((v ->> 'capBaseBps')::bigint, 30000) + coalesce((v ->> 'capPerDayBps')::bigint, 0) * v_days
                 + coalesce((v ->> 'capPerTradeBps')::bigint, 0) * greatest(0, coalesce(p_trades, 0)));
  floor_e4 := public.div_round_half_even(p_start_e4::numeric * coalesce((v ->> 'floorBps')::bigint, 2000), 10000);
  cap_e4 := public.div_round_half_even(p_start_e4::numeric * v_cap, 10000);
end;
$$;

-- ---------------------------------------------------------------------------
-- D. Unlock, catalogue sync, minting, AI listings, the value
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_unlocked(p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.level from public.profiles p where p.id = p_player), 1) >= public.unlock_level('nexamon');
$$;

create or replace function public.nexamon_require_unlock(p_player uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.nexamon_unlocked(p_player) then
    perform public.api_error('nexamon_locked');
  end if;
end;
$$;

-- A new copy: the card's population goes up by one, the copy carries that number.
create or replace function public.nexamon_mint_copy(p_card text, p_owner uuid, p_ai text, p_condition text, p_source text,
                                                    p_pack uuid, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serial bigint;
  v_id     uuid;
begin
  update public.nexamon_cards
     set population = population + 1, first_pulled_at = coalesce(first_pulled_at, p_now), updated_at = p_now
   where card_key = p_card
  returning population into v_serial;
  if v_serial is null then
    perform public.api_error('nexamon_unknown');
  end if;
  insert into public.nexamon_copies (card_key, serial, owner_id, ai_owner, condition, source, pack_id, acquired_at, created_at)
  values (p_card, v_serial, p_owner, p_ai, p_condition, p_source, p_pack, p_now, p_now)
  returning id into v_id;
  return v_id;
end;
$$;

-- The AI sellers offer up to ai.listedPerCard copies of a card from their stock (p_extra more, for a legendary).
create or replace function public.nexamon_ai_restock(p_card text, p_now timestamptz, p_extra integer default 0)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  k        public.nexamon_cards;
  v_limit  integer;
  v_listed integer;
  v_n      integer := 0;
  r        record;
begin
  select * into k from public.nexamon_cards where card_key = p_card;
  if k.card_key is null then
    return 0;
  end if;
  v_limit := coalesce((public.nexamon_cfg() #>> array['ai', 'listedPerCard', k.rarity])::integer, 0) + greatest(0, coalesce(p_extra, 0));
  select count(*) into v_listed from public.nexamon_listings l where l.card_key = p_card and l.seller_ai is not null;
  for r in select c.id, c.ai_owner, c.condition, c.grade from public.nexamon_copies c
            where c.card_key = p_card and c.ai_owner is not null
              and not exists (select 1 from public.nexamon_listings l where l.copy_id = c.id)
            order by c.acquired_at, c.serial
            limit greatest(0, v_limit - v_listed) loop
    insert into public.nexamon_listings (copy_id, card_key, seller_ai, price_cents, created_at)
    values (r.id, p_card, r.ai_owner,
            public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(k.value_e4, r.condition, r.grade)), p_now);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Sets a card's value inside its bounds (nexamonClampValue): the corridor of the Berlin day, then floor and cap.
-- The AI's listings follow at once, the hour's point of the value history is written. -> the new value
create or replace function public.nexamon_set_value(p_card text, p_value_e4 bigint, p_now timestamptz, p_counted boolean default false)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       jsonb := public.nexamon_cfg() -> 'value';
  k       public.nexamon_cards;
  v_day   date := (p_now at time zone 'Europe/Berlin')::date;
  v_ref   bigint;
  v_trades bigint;
  b       record;
  v_new   bigint;
begin
  select * into k from public.nexamon_cards where card_key = p_card for update;
  if k.card_key is null then
    return null;
  end if;
  v_ref := case when k.day_ref_on = v_day then k.day_ref_e4 else k.value_e4 end;
  v_trades := k.counted_trades + case when p_counted then 1 else 0 end;
  select * into b from public.nexamon_bounds(k.start_e4, k.first_pulled_at, v_trades, p_now);
  v_new := least(greatest(p_value_e4,
                          public.div_round_half_even(v_ref::numeric * (10000 - coalesce((v ->> 'dayMaxFallBps')::bigint, 2000)), 10000)),
                 public.div_round_half_even(v_ref::numeric * (10000 + coalesce((v ->> 'dayMaxRiseBps')::bigint, 1500)), 10000));
  v_new := greatest(1, greatest(b.floor_e4, least(b.cap_e4, v_new)));
  update public.nexamon_cards
     set value_e4 = v_new, day_ref_e4 = v_ref, day_ref_on = v_day, counted_trades = v_trades,
         moved_at = case when v_new <> k.value_e4 then p_now else moved_at end, updated_at = p_now
   where card_key = p_card;
  if v_new <> k.value_e4 then
    update public.nexamon_listings l
       set price_cents = public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(v_new, c.condition, c.grade))
      from public.nexamon_copies c
     where l.card_key = p_card and l.seller_ai is not null and c.id = l.copy_id;
    insert into public.nexamon_value_points (card_key, at, value_e4)
    values (p_card, date_trunc('hour', p_now), v_new)
    on conflict (card_key, at) do update set value_e4 = excluded.value_e4;
  end if;
  return v_new;
end;
$$;

-- Mirrors the catalogue (game_config.nexamon_cards) into nexamon_cards and gives the AI sellers their starting stock.
-- Cheap when nothing changed (hash). -> number of cards written
create or replace function public.nexamon_sync(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.nexamon_cfg();
  v_cat   jsonb := public.nexamon_catalogue();
  v_now   timestamptz := coalesce(p_now, public.game_now());
  v_hash  text;
  v_n     integer := 0;
  v_names jsonb := coalesce(public.nexamon_cfg() #> '{ai,sellers}', '[]'::jsonb);
  v_seed  integer;
  r       record;
  i       integer;
begin
  if jsonb_typeof(v_cat) <> 'array' or jsonb_array_length(v_cat) = 0 or cfg = '{}'::jsonb then
    return 0;
  end if;
  v_hash := md5(v_cat::text || coalesce((cfg #> '{ai,seedCopies}')::text, '') || coalesce(cfg #>> '{ai,seedPrismaCards}', '')
                || coalesce((cfg -> 'sets')::text, '') || v_names::text);
  if exists (select 1 from public.nexamon_meta m where m.catalogue_hash = v_hash) then
    return 0;
  end if;
  perform pg_advisory_xact_lock(7311650);
  if exists (select 1 from public.nexamon_meta m where m.catalogue_hash = v_hash) then
    return 0;
  end if;

  insert into public.nexamon_cards (card_key, set_key, number, rarity, start_e4, value_e4, day_ref_e4, day_ref_on, created_at, updated_at)
  select x ->> 'key', x ->> 'set', (x ->> 'number')::integer, x ->> 'rarity', (x ->> 'startPriceCents')::bigint * 100,
         (x ->> 'startPriceCents')::bigint * 100, (x ->> 'startPriceCents')::bigint * 100,
         (v_now at time zone 'Europe/Berlin')::date, v_now, v_now
    from jsonb_array_elements(v_cat) x
   where (x ->> 'startPriceCents')::bigint > 0
  on conflict (card_key) do update
     set set_key = excluded.set_key, number = excluded.number, rarity = excluded.rarity, start_e4 = excluded.start_e4,
         -- a card that never moved follows the catalogue's start price
         value_e4 = case when public.nexamon_cards.moved_at is null then excluded.start_e4 else public.nexamon_cards.value_e4 end,
         day_ref_e4 = case when public.nexamon_cards.moved_at is null then excluded.start_e4 else public.nexamon_cards.day_ref_e4 end,
         in_catalogue = true, updated_at = excluded.updated_at;
  get diagnostics v_n = row_count;
  update public.nexamon_cards k set in_catalogue = false
   where k.in_catalogue and not exists (select 1 from jsonb_array_elements(v_cat) x where x ->> 'key' = k.card_key);
  -- the AI's listings of cards that never moved follow the new start price
  update public.nexamon_listings l
     set price_cents = public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade))
    from public.nexamon_copies c, public.nexamon_cards k
   where l.seller_ai is not null and c.id = l.copy_id and k.card_key = l.card_key and k.moved_at is null;

  insert into public.nexamon_set_state (set_key, ai_packs_at)
  select s.key, v_now from jsonb_each(coalesce(cfg -> 'sets', '{}'::jsonb)) s
  on conflict (set_key) do nothing;

  -- starting stock of the AI sellers: no legendary, prismas only for the cheapest cards of a set
  if jsonb_array_length(v_names) > 0 then
    for r in select k.card_key, k.rarity, k.number,
                    row_number() over (partition by k.set_key, k.rarity order by k.start_e4, k.number) - 1 as price_rank
               from public.nexamon_cards k where not k.seeded and k.in_catalogue order by k.set_key, k.number loop
      v_seed := coalesce((cfg #>> array['ai', 'seedCopies', r.rarity])::integer, 0);
      if r.rarity = 'prisma' and r.price_rank >= coalesce((cfg #>> '{ai,seedPrismaCards}')::integer, 0) then
        v_seed := 0;
      end if;
      for i in 1 .. v_seed loop
        perform public.nexamon_mint_copy(r.card_key, null, v_names ->> ((r.number + i) % jsonb_array_length(v_names)),
                                         public.nexamon_roll_condition(random()), 'seed', null, v_now);
      end loop;
      update public.nexamon_cards set seeded = true where card_key = r.card_key;
      perform public.nexamon_ai_restock(r.card_key, v_now);
    end loop;
  end if;

  insert into public.nexamon_meta (id, catalogue_hash, synced_at) values (true, v_hash, v_now)
  on conflict (id) do update set catalogue_hash = excluded.catalogue_hash, synced_at = excluded.synced_at;
  return v_n;
end;
$$;
comment on function public.nexamon_sync(timestamptz) is
  'Internal: mirrors game_config.nexamon_cards into nexamon_cards and seeds the AI sellers'' stock (ADR-165). '
  'Idempotent; does nothing while the catalogue hash is unchanged.';

-- Opens one pack of a set for a player or an AI seller (nexamonOpenPack). -> the pulls in slot order
create or replace function public.nexamon_open_pack(p_set text, p_owner uuid, p_ai text, p_pack uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_size   integer := coalesce((public.nexamon_cfg() ->> 'packSize')::integer, 5);
  v_used   text[] := '{}';
  v_out    jsonb := '[]'::jsonb;
  v_rarity text;
  v_key    text;
  v_cond   text;
  v_new    boolean;
  v_copy   uuid;
  k        public.nexamon_cards;
  s        integer;
begin
  for s in 1 .. v_size loop
    v_rarity := case when s >= 4 then public.nexamon_slot_rarity(s, random()) else 'common' end;
    select c.card_key into v_key from public.nexamon_cards c
     where c.set_key = p_set and c.rarity = v_rarity and c.in_catalogue
       and (v_rarity <> 'common' or c.card_key <> all (v_used))
     order by random() limit 1;
    if v_key is null then
      perform public.api_error('nexamon_unknown');
    end if;
    v_used := v_used || v_key;
    v_cond := public.nexamon_roll_condition(random());
    v_new := p_owner is not null
             and not exists (select 1 from public.nexamon_copies x where x.owner_id = p_owner and x.card_key = v_key);
    v_copy := public.nexamon_mint_copy(v_key, p_owner, p_ai, v_cond, case when p_owner is null then 'ai_pack' else 'pack' end,
                                       p_pack, p_now);
    select * into k from public.nexamon_cards where card_key = v_key;
    v_out := v_out || jsonb_build_object(
      'slot', s, 'copy_id', v_copy, 'card_key', v_key, 'rarity', v_rarity, 'condition', v_cond, 'is_new', v_new,
      'serial', k.population, 'population', k.population,
      'value_cents', public.nexamon_copy_value_cents(k.value_e4, v_cond, null));
    if p_owner is not null and coalesce(cfg -> 'feedRarities', '[]'::jsonb) ? v_rarity then
      perform public.feed_post(p_owner, 'nexamon_pull',
                               jsonb_build_object('card_key', v_key, 'set', p_set, 'rarity', v_rarity, 'serial', k.population,
                                                  'condition', v_cond),
                               'nexamon:pull:' || v_copy::text);
    end if;
  end loop;
  return v_out;
end;
$$;

-- A listing is sold to a player (p_buyer) or an AI collector (p_buyer_ai): the buyer pays the price, a selling player
-- gets it minus the fee (an AI seller's or a frozen seller's part goes to the households). The sale moves the card's
-- value if it counts (nexamonSaleCounts, nexamonValueAfterSale, nexamonValueAfterAiBuy).
create or replace function public.nexamon_sell(p_listing uuid, p_buyer uuid, p_buyer_ai text, p_key text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.nexamon_cfg();
  t         jsonb := public.nexamon_cfg() #> '{value,trade}';
  l         public.nexamon_listings;
  c         public.nexamon_copies;
  k         public.nexamon_cards;
  v_house   uuid := public.ledger_system_account('households');
  v_from    uuid;
  v_to      uuid;
  v_fee     bigint;
  v_raw     jsonb;
  v_entries jsonb;
  v_factor  integer;
  v_norm    bigint;
  v_diff    bigint;
  v_step    bigint;
  v_pop     integer;
  v_pair    bigint := 0;
  v_today   bigint := 0;
  v_counted boolean := false;
  v_target  bigint;
  v_after   bigint;
  v_kind    text := case when p_buyer_ai is not null then 'ai_buy' else 'market' end;
  v_day     timestamptz := ((p_now at time zone 'Europe/Berlin')::date)::timestamp at time zone 'Europe/Berlin';
  v_name    text;
begin
  select * into l from public.nexamon_listings where id = p_listing for update;
  if l.id is null then
    perform public.api_error('nexamon_not_listed');
  end if;
  if (p_buyer is null) = (p_buyer_ai is null) or p_buyer = l.seller_id then
    perform public.api_error('invalid_argument');
  end if;
  select * into c from public.nexamon_copies where id = l.copy_id for update;
  select * into k from public.nexamon_cards where card_key = l.card_key for update;

  -- money
  v_from := case when p_buyer is not null then public.ledger_player_account(p_buyer, 'player_cash') else v_house end;
  if l.seller_id is not null then
    select x.id into v_to from public.ledger_accounts x
     where x.owner_player_id = l.seller_id and x.kind = 'player_cash' and not x.is_frozen;
  end if;
  if v_to is null then
    v_fee := l.price_cents;
    v_raw := jsonb_build_array(jsonb_build_object('account_id', v_from, 'amount_cents', -l.price_cents),
                               jsonb_build_object('account_id', v_house, 'amount_cents', l.price_cents));
  else
    v_fee := floor(l.price_cents::numeric * coalesce((cfg #>> '{market,feeBps}')::integer, 500) / 10000)::bigint;
    v_raw := jsonb_build_array(jsonb_build_object('account_id', v_from, 'amount_cents', -l.price_cents),
                               jsonb_build_object('account_id', v_to, 'amount_cents', l.price_cents - v_fee),
                               jsonb_build_object('account_id', v_house, 'amount_cents', v_fee));
  end if;
  -- one entry per account (the households can be buyer and fee receiver at once)
  select coalesce(jsonb_agg(jsonb_build_object('account_id', x.acc, 'amount_cents', x.amt) order by x.acc), '[]'::jsonb)
    into v_entries
    from (select (e ->> 'account_id')::uuid as acc, sum((e ->> 'amount_cents')::bigint)::bigint as amt
            from jsonb_array_elements(v_raw) e group by 1 having sum((e ->> 'amount_cents')::bigint) <> 0) x;
  begin
    if jsonb_array_length(v_entries) >= 2 then
      perform public.ledger_post('nexamon_sale', v_entries, 'Nexamon-Karte verkauft', 'nexamon_copy', c.id, p_key, p_buyer,
                                 jsonb_build_object('card_key', k.card_key, 'serial', c.serial, 'price_cents', l.price_cents,
                                                    'fee_cents', v_fee, 'kind', v_kind, 'buyer_ai', p_buyer_ai,
                                                    'seller_ai', l.seller_ai));
    end if;
  exception when sqlstate 'NX001' then
    perform public.api_error('insufficient_funds');
  end;
  if v_to is not null then
    perform public.loan_withhold(l.seller_id, l.price_cents - v_fee, p_key);
  end if;

  -- the value
  v_factor := public.nexamon_copy_factor_bps(c.condition, c.grade);
  v_pop := public.nexamon_popularity_bps(k.rarity, k.population);
  if v_kind = 'ai_buy' then
    v_counted := true;
    v_target := k.value_e4 + floor(k.value_e4::numeric * coalesce((cfg #>> '{value,aiBuyBumpBps}')::integer, 0) * v_pop / 100000000)::bigint;
  else
    v_norm := public.div_round_half_even(l.price_cents::numeric * 100 * 10000, greatest(1, v_factor));
    if l.seller_id is not null then
      select count(*) into v_pair from public.nexamon_sales s
       where s.card_key = k.card_key and s.counted
         and s.at > p_now - make_interval(hours => coalesce((t ->> 'pairHours')::integer, 24))
         and ((s.seller_id = l.seller_id and s.buyer_id = p_buyer) or (s.seller_id = p_buyer and s.buyer_id = l.seller_id));
    end if;
    select count(*) into v_today from public.nexamon_sales s
     where s.card_key = k.card_key and s.counted and s.buyer_id = p_buyer and s.at >= v_day;
    v_counted := v_norm > 0
                 and abs(v_norm - k.value_e4)::numeric * 10000 <= k.value_e4::numeric * coalesce((t ->> 'bandBps')::integer, 2500)
                 and v_pair < 1 and v_today < coalesce((t ->> 'perPlayerDay')::integer, 3);
    v_target := k.value_e4;
    if v_counted then
      v_diff := v_norm - k.value_e4;
      v_step := least(public.div_round_half_even(abs(v_diff)::numeric * coalesce((t ->> 'weightBps')::integer, 2000), 10000),
                      greatest(1, floor(k.value_e4::numeric * coalesce((t ->> 'maxStepBps')::integer, 200) / 10000)::bigint));
      if v_diff > 0 then
        v_step := floor(v_step::numeric * greatest(v_pop, coalesce((t ->> 'minPopularityBps')::integer, 2500)) / 10000)::bigint;
      end if;
      v_target := k.value_e4 + sign(v_diff)::integer * v_step;
    end if;
  end if;

  -- the copy changes hands
  delete from public.nexamon_listings where id = l.id;
  update public.nexamon_copies set owner_id = p_buyer, ai_owner = p_buyer_ai, acquired_at = p_now where id = c.id;
  v_after := case when v_counted then public.nexamon_set_value(k.card_key, v_target, p_now, true) else k.value_e4 end;
  insert into public.nexamon_sales (card_key, copy_id, seller_id, seller_ai, buyer_id, buyer_ai, price_cents, fee_cents, condition,
                                    grade, factor_bps, kind, counted, value_before_e4, value_after_e4, at)
  values (k.card_key, c.id, l.seller_id, l.seller_ai, p_buyer, p_buyer_ai, l.price_cents, v_fee, c.condition, c.grade, v_factor,
          v_kind, v_counted, k.value_e4, v_after, p_now);
  perform public.nexamon_ai_restock(k.card_key, p_now);

  if l.seller_id is not null then
    v_name := coalesce(p_buyer_ai, (select p.nickname from public.profiles p where p.id = p_buyer), 'Ehemaliger Spieler');
    perform public.social_notify(l.seller_id, 'nexamon_sale', 'Nexamon-Karte verkauft',
      v_name || ' hat deine Karte für ' || public.format_eur(l.price_cents) || ' gekauft.',
      jsonb_build_object('card_key', k.card_key, 'serial', c.serial, 'grade', c.grade, 'condition', c.condition,
                         'price_cents', l.price_cents, 'fee_cents', v_fee, 'buyer', v_name),
      '/nexamon', 'nexamon_sale:' || l.id::text);
    perform public.mission_event(l.seller_id, 'nexamon_sold', 1, null);
  end if;
  if p_buyer is not null then
    perform public.mission_event(p_buyer, 'nexamon_bought', 1, null);
  end if;
  return jsonb_build_object('price_cents', l.price_cents, 'fee_cents', v_fee, 'counted', v_counted,
                            'copy_id', c.id, 'card_key', k.card_key);
end;
$$;
comment on function public.nexamon_sell(uuid, uuid, text, text, timestamptz) is
  'Internal: sells a Nexamon listing to a player or an AI collector (ledger, fee, value step, notification; ADR-165). '
  'Errors nexamon_not_listed, invalid_argument, insufficient_funds.';

-- One supply and demand step of a card (nexamonValueAfterPressure); a legendary the AI holds may go on sale.
create or replace function public.nexamon_pressure_step(p_card text, p_now timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg        jsonb := public.nexamon_cfg();
  p          jsonb := public.nexamon_cfg() #> '{value,pressure}';
  k          public.nexamon_cards;
  v_supply   bigint;
  v_buys     bigint;
  v_pressure integer;
  v_target   bigint;
  v_new      bigint;
begin
  select * into k from public.nexamon_cards where card_key = p_card for update;
  if k.card_key is null then
    return null;
  end if;
  -- offered at a plausible price: at most the copy's value x (1 + band)
  select count(*) into v_supply
    from public.nexamon_listings l join public.nexamon_copies c on c.id = l.copy_id
   where l.card_key = p_card
     and l.price_cents::numeric * 10000 <= public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade)::numeric
                                           * (10000 + coalesce((cfg #>> '{value,trade,bandBps}')::integer, 2500));
  select count(*) into v_buys from public.nexamon_sales s
   where s.card_key = p_card and s.counted and s.kind <> 'quick'
     and s.at >= p_now - make_interval(days => coalesce((p ->> 'buyDays')::integer, 7));
  v_pressure := public.nexamon_pressure_bps(k.rarity, k.population, v_supply, v_buys);
  if v_pressure > 0 then
    v_target := k.value_e4 + floor(k.value_e4::numeric * v_pressure * coalesce((p ->> 'upStepBps')::integer, 0)
                                   * public.nexamon_popularity_bps(k.rarity, k.population) / 1000000000000)::bigint;
  else
    v_target := k.value_e4 - floor(k.value_e4::numeric * (-v_pressure) * coalesce((p ->> 'downStepBps')::integer, 0) / 100000000)::bigint;
  end if;
  v_new := case when v_target <> k.value_e4 then public.nexamon_set_value(p_card, v_target, p_now) else k.value_e4 end;
  update public.nexamon_cards set pressure_at = p_now where card_key = p_card;
  if k.rarity = 'legendary' and random() * 10000 < coalesce((cfg #>> '{ai,legendaryListChanceBps}')::integer, 0)
     and not exists (select 1 from public.nexamon_listings l where l.card_key = p_card and l.seller_ai is not null) then
    perform public.nexamon_ai_restock(p_card, p_now, 1);
  end if;
  return v_new;
end;
$$;

-- ASP is done: grades are rolled by condition (nexamonRollGrade). p_player null = everybody's.
create or replace function public.nexamon_finish_gradings(p_player uuid default null, p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now   timestamptz := coalesce(p_now, public.game_now());
  v_n     integer := 0;
  v_grade integer;
  r       record;
begin
  for r in select c.id, c.owner_id, c.card_key, c.condition, c.serial from public.nexamon_copies c
            where c.grading_until is not null and c.grading_until <= v_now
              and (p_player is null or c.owner_id = p_player)
            order by c.grading_until, c.id limit 200
            for update skip locked loop
    v_grade := public.nexamon_roll_grade(r.condition, random());
    update public.nexamon_copies set grade = v_grade, graded_at = v_now, grading_until = null where id = r.id;
    if r.owner_id is not null then
      perform public.social_notify(r.owner_id, 'nexamon_graded', 'ASP-Note: ' || v_grade::text,
        'Deine Nexamon-Karte ist zurück von ASP, Note ' || v_grade::text || ' von 10.',
        jsonb_build_object('copy_id', r.id, 'card_key', r.card_key, 'serial', r.serial, 'grade', v_grade, 'condition', r.condition),
        '/nexamon', 'nexamon_graded:' || r.id::text || ':' || extract(epoch from v_now)::bigint::text);
      perform public.mission_event(r.owner_id, 'nexamon_graded', 1, null);
      if v_grade = 10 then
        perform public.mission_event(r.owner_id, 'nexamon_ten', 1, null);
      end if;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- E. JSON views
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_copy_json(p_copy uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', c.id, 'card_key', c.card_key, 'serial', c.serial, 'condition', c.condition, 'grade', c.grade,
           'state', case when c.grading_until is not null then 'grading' when c.grade is not null then 'graded' else 'raw' end,
           'grading_until', c.grading_until, 'graded_at', c.graded_at,
           'value_cents', public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade),
           'listing', (select jsonb_build_object('id', l.id, 'price_cents', l.price_cents, 'listed_at', l.created_at)
                         from public.nexamon_listings l where l.copy_id = c.id),
           'acquired_at', c.acquired_at)
    from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
   where c.id = p_copy;
$$;

create or replace function public.nexamon_listing_json(p_listing uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', l.id, 'copy_id', c.id, 'card_key', l.card_key, 'set', k.set_key, 'rarity', k.rarity, 'serial', c.serial,
           'condition', c.condition, 'grade', c.grade, 'price_cents', l.price_cents,
           'value_cents', public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade),
           'seller', coalesce(l.seller_ai, (select p.nickname from public.profiles p where p.id = l.seller_id), 'Ehemaliger Spieler'),
           'seller_ai', l.seller_ai is not null, 'mine', l.seller_id is not distinct from p_viewer and l.seller_id is not null,
           'listed_at', l.created_at)
    from public.nexamon_listings l
    join public.nexamon_copies c on c.id = l.copy_id
    join public.nexamon_cards k on k.card_key = l.card_key
   where l.id = p_listing;
$$;

create or replace function public.nexamon_card_json(p_card text, p_viewer uuid, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'card_key', k.card_key, 'set', k.set_key, 'number', k.number, 'rarity', k.rarity,
           'value_cents', public.div_round_half_even(k.value_e4, 100),
           'start_cents', public.div_round_half_even(k.start_e4, 100),
           'change_bps', case when k.day_ref_on = (p_now at time zone 'Europe/Berlin')::date and k.day_ref_e4 > 0
                              then public.div_round_half_even((k.value_e4 - k.day_ref_e4)::numeric * 10000, k.day_ref_e4) else 0 end,
           'population', k.population,
           'listed', (select count(*) from public.nexamon_listings l where l.card_key = k.card_key),
           'owned', (select count(*) from public.nexamon_copies c where c.card_key = k.card_key and c.owner_id = p_viewer),
           'popularity_bps', public.nexamon_popularity_bps(k.rarity, k.population),
           'floor_cents', public.div_round_half_even(b.floor_e4, 100),
           'cap_cents', public.div_round_half_even(b.cap_e4, 100))
    from public.nexamon_cards k,
         lateral public.nexamon_bounds(k.start_e4, k.first_pulled_at, k.counted_trades, p_now) b
   where k.card_key = p_card;
$$;

-- ---------------------------------------------------------------------------
-- F. RPCs: reading
-- ---------------------------------------------------------------------------
create or replace function public.get_nexamon()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid := public.require_player();
  v_now    timestamptz := public.game_now();
  v_sets   jsonb;
  v_col    jsonb;
begin
  perform public.nexamon_sync(v_now);
  perform public.nexamon_finish_gradings(v_player, v_now);
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', s.key, 'name', s.value ->> 'name', 'pack_price_cents', (s.value ->> 'packPriceCents')::bigint,
           'cards', (select count(*) from public.nexamon_cards k where k.set_key = s.key and k.in_catalogue),
           'owned_distinct', (select count(distinct c.card_key) from public.nexamon_copies c
                                join public.nexamon_cards k on k.card_key = c.card_key
                               where c.owner_id = v_player and k.set_key = s.key),
           'owned_copies', (select count(*) from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
                             where c.owner_id = v_player and k.set_key = s.key),
           'packs_opened', (select count(*) from public.nexamon_packs p where p.player_id = v_player and p.set_key = s.key),
           'population', (select coalesce(sum(k.population), 0) from public.nexamon_cards k where k.set_key = s.key))
           order by (s.value ->> 'packPriceCents')::bigint, s.key), '[]'::jsonb)
    into v_sets
    from jsonb_each(coalesce(cfg -> 'sets', '{}'::jsonb)) s;
  select jsonb_build_object(
           'copies', count(*), 'distinct', count(distinct c.card_key),
           'value_cents', coalesce(sum(public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade)), 0),
           'listed', count(*) filter (where exists (select 1 from public.nexamon_listings l where l.copy_id = c.id)),
           'grading', count(*) filter (where c.grading_until is not null),
           'graded', count(*) filter (where c.grade is not null))
    into v_col
    from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
   where c.owner_id = v_player;
  return jsonb_build_object(
    'unlocked', public.nexamon_unlocked(v_player), 'unlock_level', public.unlock_level('nexamon'),
    'pack_size', coalesce((cfg ->> 'packSize')::integer, 5), 'sets', v_sets, 'collection', v_col,
    'limits', jsonb_build_object('max_listings', coalesce((cfg #>> '{market,maxListings}')::integer, 30),
                                 'max_grading', coalesce((cfg #>> '{grading,maxOpen}')::integer, 10),
                                 'packs_per_minute', coalesce((cfg #>> '{packs,perMinute}')::integer, 20)),
    'server_time', v_now);
end;
$$;
comment on function public.get_nexamon() is
  'RPC: the Nexamon overview (ADR-165): unlock, the sets with pack prices and the own progress, the own collection in '
  'numbers, limits. Finishes the caller''s due gradings.';

create or replace function public.get_nexamon_collection(p_set text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_now    timestamptz := public.game_now();
begin
  perform public.nexamon_require_unlock(v_player);
  perform public.nexamon_sync(v_now);
  perform public.nexamon_finish_gradings(v_player, v_now);
  if p_set is not null and not exists (select 1 from public.nexamon_cards k where k.set_key = p_set) then
    perform public.api_error('nexamon_unknown');
  end if;
  return jsonb_build_object(
    'cards', (select coalesce(jsonb_agg(public.nexamon_card_json(k.card_key, v_player, v_now) order by k.set_key, k.number), '[]'::jsonb)
                from public.nexamon_cards k where k.in_catalogue and (p_set is null or k.set_key = p_set)),
    'copies', (select coalesce(jsonb_agg(public.nexamon_copy_json(x.id) order by x.set_key, x.number, x.serial), '[]'::jsonb)
                 from (select c.id, c.serial, k.set_key, k.number
                         from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
                        where c.owner_id = v_player and (p_set is null or k.set_key = p_set)
                        order by k.set_key, k.number, c.serial limit 5000) x),
    'server_time', v_now);
end;
$$;
comment on function public.get_nexamon_collection(text) is
  'RPC: every card of the catalogue (or one set) with value, population, copies on the market and the own count, and '
  'the own copies with condition, grade and listing (ADR-165); errors nexamon_locked, nexamon_unknown.';

create or replace function public.get_nexamon_card(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid := public.require_player();
  v_now    timestamptz := public.game_now();
  k        public.nexamon_cards;
begin
  perform public.nexamon_require_unlock(v_player);
  perform public.nexamon_sync(v_now);
  perform public.nexamon_finish_gradings(v_player, v_now);
  select * into k from public.nexamon_cards where card_key = p_key;
  if k.card_key is null then
    perform public.api_error('nexamon_unknown');
  end if;
  return jsonb_build_object(
    'card', public.nexamon_card_json(k.card_key, v_player, v_now),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('at', h.at, 'value_cents', public.div_round_half_even(h.value_e4, 100))
                                          order by h.at), '[]'::jsonb)
                  from (select v.at, v.value_e4 from public.nexamon_value_points v
                         where v.card_key = k.card_key and v.at > date_trunc('hour', k.created_at)
                           and v.at >= v_now - make_interval(days => coalesce((cfg #>> '{market,historyDays}')::integer, 60))
                        union all
                        -- the start (the hour the card appeared), so a chart has a first point
                        select date_trunc('hour', k.created_at), k.start_e4
                         where k.created_at >= v_now - make_interval(days => coalesce((cfg #>> '{market,historyDays}')::integer, 60))
                        union all
                        select v_now, k.value_e4) h),
    'graded', (select jsonb_agg((select count(*) from public.nexamon_copies c where c.card_key = k.card_key and c.grade = g) order by g)
                 from generate_series(1, 10) g),
    'listings', (select coalesce(jsonb_agg(public.nexamon_listing_json(x.id, v_player) order by x.price_cents, x.created_at, x.id), '[]'::jsonb)
                   from (select l.id, l.price_cents, l.created_at from public.nexamon_listings l
                          where l.card_key = k.card_key order by l.price_cents, l.created_at, l.id limit 30) x),
    'copies', (select coalesce(jsonb_agg(public.nexamon_copy_json(c.id) order by c.serial), '[]'::jsonb)
                 from public.nexamon_copies c where c.card_key = k.card_key and c.owner_id = v_player),
    'sales', (select coalesce(jsonb_agg(jsonb_build_object(
                       'at', x.at, 'price_cents', x.price_cents, 'condition', x.condition, 'grade', x.grade, 'kind', x.kind,
                       'seller', coalesce(x.seller_ai, (select p.nickname from public.profiles p where p.id = x.seller_id), 'Ehemaliger Spieler'),
                       'buyer', coalesce(x.buyer_ai, (select p.nickname from public.profiles p where p.id = x.buyer_id), 'Ehemaliger Spieler'))
                       order by x.at desc, x.id desc), '[]'::jsonb)
                from (select * from public.nexamon_sales s where s.card_key = k.card_key
                       order by s.at desc, s.id desc limit coalesce((cfg #>> '{market,recentSales}')::integer, 20)) x),
    'server_time', v_now);
end;
$$;
comment on function public.get_nexamon_card(text) is
  'RPC: one Nexamon card (ADR-165): value, bounds, population, value history (start, hourly points, now), graded '
  'copies per grade, the cheapest '
  'listings, the own copies and the latest sales; errors nexamon_locked, nexamon_unknown.';

create or replace function public.get_nexamon_market(p_set text default null, p_rarity text default null, p_sort text default 'new',
                                                     p_page integer default 1, p_seller text default 'all',
                                                     p_card_key text default null, p_graded boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_now    timestamptz := public.game_now();
  v_size   integer := coalesce((public.nexamon_cfg() #>> '{market,pageSize}')::integer, 24);
  v_page   integer := greatest(1, coalesce(p_page, 1));
  v_sort   text := coalesce(p_sort, 'new');
  v_seller text := coalesce(p_seller, 'all');
  v_total  bigint;
  v_rows   jsonb;
begin
  perform public.nexamon_require_unlock(v_player);
  perform public.nexamon_sync(v_now);
  if v_sort not in ('new', 'price_asc', 'price_desc', 'deal', 'value', 'number')
     or v_seller not in ('all', 'players', 'ai', 'mine')
     or (p_rarity is not null and p_rarity not in ('common', 'rare', 'ultra', 'prisma', 'legendary')) then
    perform public.api_error('invalid_argument');
  end if;
  with f as (
    select l.id, l.price_cents, l.created_at, k.set_key, k.number, k.value_e4,
           public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade) as copy_value
      from public.nexamon_listings l
      join public.nexamon_copies c on c.id = l.copy_id
      join public.nexamon_cards k on k.card_key = l.card_key
     where (p_set is null or k.set_key = p_set)
       and (p_rarity is null or k.rarity = p_rarity)
       and (p_card_key is null or l.card_key = p_card_key)
       and (p_graded is null or (c.grade is not null) = p_graded)
       and case v_seller when 'players' then l.seller_id is not null when 'ai' then l.seller_ai is not null
                         when 'mine' then l.seller_id = v_player else true end
  ), page as (
    select f.*, row_number() over (
             order by case when v_sort = 'price_asc' then f.price_cents end asc nulls last,
                      case when v_sort = 'price_desc' then f.price_cents end desc nulls last,
                      case when v_sort = 'deal' then f.price_cents::numeric / greatest(f.copy_value, 1) end asc nulls last,
                      case when v_sort = 'value' then f.value_e4 end desc nulls last,
                      case when v_sort = 'number' then f.set_key end asc nulls last,
                      case when v_sort = 'number' then f.number end asc nulls last,
                      f.created_at desc, f.id) as rn,
           count(*) over () as total
      from f
  )
  select coalesce(max(p.total), 0),
         coalesce(jsonb_agg(public.nexamon_listing_json(p.id, v_player) order by p.rn)
                    filter (where p.rn > (v_page - 1) * v_size and p.rn <= v_page * v_size), '[]'::jsonb)
    into v_total, v_rows
    from page p;
  return jsonb_build_object('listings', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size,
                            'pages', greatest(1, ceil(v_total::numeric / v_size))::integer, 'server_time', v_now);
end;
$$;
comment on function public.get_nexamon_market(text, text, text, integer, text, text, boolean) is
  'RPC: the listings of the Nexamon market (ADR-165), filtered by set, rarity, seller (all, players, ai, mine), card '
  'and graded, sorted (new, price_asc, price_desc, deal, value, number), in pages; errors nexamon_locked, '
  'invalid_argument.';

-- ---------------------------------------------------------------------------
-- G. RPCs: packs, market, grading
-- ---------------------------------------------------------------------------
create or replace function public.buy_nexamon_pack(p_request_id uuid, p_set text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_price  bigint;
  v_cash   bigint;
  v_pack   uuid := gen_random_uuid();
  v_cards  jsonb;
  r        record;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_set is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_nexamon_pack');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.nexamon_sync(v_now);
  v_price := (cfg #>> array['sets', p_set, 'packPriceCents'])::bigint;
  if v_price is null or v_price < 0 or not exists (select 1 from public.nexamon_cards k where k.set_key = p_set and k.in_catalogue) then
    perform public.api_error('nexamon_unknown');
  end if;
  if not public.rate_limit_hit(v_player, 'nexamon_pack', coalesce((cfg #>> '{packs,perMinute}')::integer, 20), 60) then
    perform public.api_error('rate_limited');
  end if;
  v_cash := public.lock_player_accounts(v_player);
  if v_cash < v_price then
    perform public.api_error('insufficient_funds');
  end if;
  if v_price > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('households'),
                                   v_price, 'nexamon_pack', 'Booster gekauft: ' || coalesce(cfg #>> array['sets', p_set, 'name'], p_set),
                                   'nexamon_pack', v_pack, 'nexamon:pack:' || v_player::text || ':' || p_request_id::text, v_player,
                                   jsonb_build_object('set', p_set, 'price_cents', v_price));
  end if;
  v_cards := public.nexamon_open_pack(p_set, v_player, null, v_pack, v_now);
  insert into public.nexamon_packs (id, player_id, set_key, price_cents, cards, opened_at)
  values (v_pack, v_player, p_set, v_price, v_cards, v_now);
  update public.nexamon_set_state set player_packs_opened = player_packs_opened + 1 where set_key = p_set;
  perform public.mission_event(v_player, 'nexamon_pack', 1, null);
  for r in select x ->> 'rarity' as rarity from jsonb_array_elements(v_cards) x loop
    if r.rarity <> 'common' then
      perform public.mission_event(v_player, 'nexamon_rare', 1, null);
    end if;
    if r.rarity in ('ultra', 'prisma', 'legendary') then
      perform public.mission_event(v_player, 'nexamon_ultra', 1, null);
    end if;
  end loop;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'pack_id', v_pack, 'set', p_set, 'price_cents', v_price, 'cards', v_cards,
    'packs_opened', (select count(*) from public.nexamon_packs p where p.player_id = v_player and p.set_key = p_set)));
end;
$$;
comment on function public.buy_nexamon_pack(uuid, text) is
  'RPC: buys and opens a booster pack of a set (money to the households): five pulls in slot order with condition, '
  'population number and whether the card is new to the player (ADR-165); errors nexamon_locked, invalid_argument, '
  'nexamon_unknown, rate_limited, insufficient_funds.';

-- An own copy, locked: errors nexamon_unknown, nexamon_not_owner
create or replace function public.nexamon_own_copy(p_player uuid, p_copy uuid)
returns public.nexamon_copies
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.nexamon_copies;
begin
  select * into c from public.nexamon_copies where id = p_copy for update;
  if c.id is null then
    perform public.api_error('nexamon_unknown');
  end if;
  if c.owner_id is distinct from p_player then
    perform public.api_error('nexamon_not_owner');
  end if;
  return c;
end;
$$;

create or replace function public.list_nexamon_card(p_request_id uuid, p_copy_id uuid, p_price_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        jsonb := public.nexamon_cfg() -> 'market';
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  c        public.nexamon_copies;
  v_id     uuid;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_copy_id is null or p_price_cents is null
     or p_price_cents < coalesce((m ->> 'minPriceCents')::bigint, 10)
     or p_price_cents > coalesce((m ->> 'maxPriceCents')::bigint, 100000000000) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'list_nexamon_card');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'nexamon_listing', coalesce((m ->> 'actionsPerMinute')::integer, 30), 60) then
    perform public.api_error('rate_limited');
  end if;
  perform public.lock_player_accounts(v_player);
  c := public.nexamon_own_copy(v_player, p_copy_id);
  if c.grading_until is not null then
    perform public.api_error('nexamon_grading');
  end if;
  if exists (select 1 from public.nexamon_listings l where l.copy_id = c.id) then
    perform public.api_error('nexamon_listed');
  end if;
  if (select count(*) from public.nexamon_listings l where l.seller_id = v_player) >= coalesce((m ->> 'maxListings')::integer, 30) then
    perform public.api_error('nexamon_listing_limit');
  end if;
  insert into public.nexamon_listings (copy_id, card_key, seller_id, price_cents, created_at)
  values (c.id, c.card_key, v_player, p_price_cents, v_now)
  returning id into v_id;
  perform public.mission_event(v_player, 'nexamon_listed', 1, null);
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'listing', public.nexamon_listing_json(v_id, v_player), 'copy', public.nexamon_copy_json(c.id)));
end;
$$;
comment on function public.list_nexamon_card(uuid, uuid, bigint) is
  'RPC: offers an own copy on the Nexamon market at a free price (ADR-165); errors nexamon_locked, invalid_argument, '
  'rate_limited, nexamon_unknown, nexamon_not_owner, nexamon_grading, nexamon_listed, nexamon_listing_limit.';

create or replace function public.unlist_nexamon_card(p_request_id uuid, p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  l        public.nexamon_listings;
begin
  v_player := public.require_player();
  if p_request_id is null or p_listing_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'unlist_nexamon_card');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'nexamon_listing',
                               coalesce((public.nexamon_cfg() #>> '{market,actionsPerMinute}')::integer, 30), 60) then
    perform public.api_error('rate_limited');
  end if;
  select * into l from public.nexamon_listings where id = p_listing_id for update;
  if l.id is null then
    perform public.api_error('nexamon_not_listed');
  end if;
  if l.seller_id is distinct from v_player then
    perform public.api_error('nexamon_not_owner');
  end if;
  delete from public.nexamon_listings where id = l.id;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('copy', public.nexamon_copy_json(l.copy_id)));
end;
$$;
comment on function public.unlist_nexamon_card(uuid, uuid) is
  'RPC: takes an own listing off the Nexamon market (ADR-165); errors invalid_argument, rate_limited, '
  'nexamon_not_listed, nexamon_not_owner.';

create or replace function public.buy_nexamon_listing(p_request_id uuid, p_listing_id uuid, p_price_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  l        public.nexamon_listings;
  v_cash   bigint;
  v_res    jsonb;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_listing_id is null or p_price_cents is null or p_price_cents < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_nexamon_listing');
  if v_replay is not null then
    return v_replay;
  end if;
  v_cash := public.lock_player_accounts(v_player);
  select * into l from public.nexamon_listings where id = p_listing_id for update;
  if l.id is null then
    perform public.api_error('nexamon_not_listed');
  end if;
  if l.seller_id = v_player then
    perform public.api_error('nexamon_own_listing');
  end if;
  if l.price_cents <> p_price_cents then
    perform public.api_error('nexamon_price_changed');
  end if;
  if v_cash < l.price_cents then
    perform public.api_error('insufficient_funds');
  end if;
  v_res := public.nexamon_sell(l.id, v_player, null, 'nexamon:buy:' || p_request_id::text, v_now);
  return public.request_complete(v_player, p_request_id,
    v_res || jsonb_build_object('copy', public.nexamon_copy_json(l.copy_id),
                                'card', public.nexamon_card_json(l.card_key, v_player, v_now)));
end;
$$;
comment on function public.buy_nexamon_listing(uuid, uuid, bigint) is
  'RPC: buys a listing of the Nexamon market at the price seen (ADR-165) -> {copy, card, price_cents, fee_cents, '
  'counted}; errors nexamon_locked, invalid_argument, nexamon_not_listed, nexamon_own_listing, nexamon_price_changed, '
  'insufficient_funds.';

create or replace function public.sell_nexamon_to_ai(p_request_id uuid, p_copy_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  q        jsonb := public.nexamon_cfg() -> 'quickSell';
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_names  jsonb := coalesce(public.nexamon_cfg() #> '{ai,sellers}', '[]'::jsonb);
  v_ids    uuid[];
  v_id     uuid;
  c        public.nexamon_copies;
  k        public.nexamon_cards;
  v_price  bigint;
  v_total  bigint := 0;
  v_after  bigint;
  v_cards  text[] := '{}';
  v_sold   jsonb := '[]'::jsonb;
  v_card   text;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_copy_ids, '{}'::uuid[])) x where x is not null;
  if p_request_id is null or coalesce(array_length(v_ids, 1), 0) < 1
     or array_length(v_ids, 1) > coalesce((q ->> 'maxPerCall')::integer, 50) or jsonb_array_length(v_names) = 0 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'sell_nexamon_to_ai');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.lock_player_accounts(v_player);
  foreach v_id in array v_ids loop
    c := public.nexamon_own_copy(v_player, v_id);
    if c.grading_until is not null then
      perform public.api_error('nexamon_grading');
    end if;
    if exists (select 1 from public.nexamon_listings l where l.copy_id = c.id) then
      perform public.api_error('nexamon_listed');
    end if;
    select * into k from public.nexamon_cards where card_key = c.card_key for update;
    if c.grade is not null or not coalesce(q -> 'rarities', '[]'::jsonb) ? k.rarity then
      perform public.api_error('nexamon_not_sellable');
    end if;
    v_price := floor(public.nexamon_copy_value_cents(k.value_e4, c.condition, null)::numeric * coalesce((q ->> 'bps')::integer, 5000) / 10000)::bigint;
    v_total := v_total + v_price;
    update public.nexamon_copies
       set owner_id = null, ai_owner = v_names ->> ((k.number + c.serial)::integer % jsonb_array_length(v_names)), acquired_at = v_now
     where id = c.id;
    -- dumping lowers the value a little (nexamonValueAfterQuickSell)
    v_after := public.nexamon_set_value(k.card_key,
      k.value_e4 - floor(k.value_e4::numeric * coalesce((q ->> 'dropBps')::integer, 0) / 10000)::bigint, v_now);
    insert into public.nexamon_sales (card_key, copy_id, seller_id, buyer_ai, price_cents, fee_cents, condition, grade, factor_bps,
                                      kind, counted, value_before_e4, value_after_e4, at)
    values (k.card_key, c.id, v_player, v_names ->> ((k.number + c.serial)::integer % jsonb_array_length(v_names)), v_price, 0,
            c.condition, null, public.nexamon_copy_factor_bps(c.condition, null), 'quick', false, k.value_e4, v_after, v_now);
    v_sold := v_sold || jsonb_build_object('copy_id', c.id, 'card_key', k.card_key, 'price_cents', v_price);
    if not (k.card_key = any (v_cards)) then
      v_cards := v_cards || k.card_key;
    end if;
  end loop;
  if v_total > 0 then
    begin
      perform public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(v_player, 'player_cash'),
                                     v_total, 'nexamon_sale', 'Nexamon-Karten an Sammler verkauft', 'nexamon_quick', null,
                                     'nexamon:quick:' || v_player::text || ':' || p_request_id::text, v_player,
                                     jsonb_build_object('copies', jsonb_array_length(v_sold), 'total_cents', v_total));
    exception when sqlstate 'NX001' then
      perform public.api_error('nexamon_not_sellable');
    end;
    perform public.loan_withhold(v_player, v_total, 'nexamon:quick:' || p_request_id::text);
  end if;
  foreach v_card in array v_cards loop
    perform public.nexamon_ai_restock(v_card, v_now);
  end loop;
  return public.request_complete(v_player, p_request_id,
    jsonb_build_object('sold', v_sold, 'count', jsonb_array_length(v_sold), 'total_cents', v_total));
end;
$$;
comment on function public.sell_nexamon_to_ai(uuid, uuid[]) is
  'RPC: sells raw bulk copies (quickSell.rarities) to the AI at once for quickSell.bps of their value (ADR-165) -> '
  '{sold: [{copy_id, card_key, price_cents}], count, total_cents}; errors nexamon_locked, invalid_argument, '
  'nexamon_unknown, nexamon_not_owner, nexamon_grading, nexamon_listed, nexamon_not_sellable.';

create or replace function public.grade_nexamon_card(p_request_id uuid, p_copy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g        jsonb := public.nexamon_cfg() -> 'grading';
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  c        public.nexamon_copies;
  k        public.nexamon_cards;
  v_cash   bigint;
  v_fee    bigint;
  v_until  timestamptz;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_copy_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'grade_nexamon_card');
  if v_replay is not null then
    return v_replay;
  end if;
  v_cash := public.lock_player_accounts(v_player);
  c := public.nexamon_own_copy(v_player, p_copy_id);
  if c.grading_until is not null then
    perform public.api_error('nexamon_grading');
  end if;
  if c.grade is not null then
    perform public.api_error('nexamon_not_raw');
  end if;
  if exists (select 1 from public.nexamon_listings l where l.copy_id = c.id) then
    perform public.api_error('nexamon_listed');
  end if;
  if (select count(*) from public.nexamon_copies x where x.owner_id = v_player and x.grading_until is not null)
     >= coalesce((g ->> 'maxOpen')::integer, 10) then
    perform public.api_error('nexamon_grading_limit');
  end if;
  select * into k from public.nexamon_cards where card_key = c.card_key;
  -- nexamonGradingFeeCents: half of what the copy is worth right now
  v_fee := greatest(coalesce((g ->> 'minFeeCents')::bigint, 100),
                    public.div_round_half_even(public.nexamon_copy_value_cents(k.value_e4, c.condition, null)::numeric
                                               * coalesce((g ->> 'feeBps')::integer, 5000), 10000));
  if v_cash < v_fee then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('households'),
                                 v_fee, 'nexamon_grading', 'ASP-Grading', 'nexamon_copy', c.id,
                                 'nexamon:grade:' || v_player::text || ':' || p_request_id::text, v_player,
                                 jsonb_build_object('card_key', c.card_key, 'serial', c.serial, 'fee_cents', v_fee));
  v_until := v_now + make_interval(mins => coalesce((g ->> 'minutes')::integer, 60));
  update public.nexamon_copies set grading_until = v_until, grading_fee_cents = v_fee where id = c.id;
  return public.request_complete(v_player, p_request_id,
    jsonb_build_object('copy', public.nexamon_copy_json(c.id), 'fee_cents', v_fee, 'ready_at', v_until));
end;
$$;
comment on function public.grade_nexamon_card(uuid, uuid) is
  'RPC: sends an own raw copy to ASP: grading.feeBps of its value to the households, back after grading.minutes with a '
  'grade (ADR-165) -> {copy, fee_cents, ready_at}; errors nexamon_locked, invalid_argument, nexamon_unknown, '
  'nexamon_not_owner, nexamon_grading, nexamon_not_raw, nexamon_listed, nexamon_grading_limit, insufficient_funds.';

create or replace function public.crack_nexamon_slab(p_request_id uuid, p_copy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  c        public.nexamon_copies;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_copy_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'crack_nexamon_slab');
  if v_replay is not null then
    return v_replay;
  end if;
  c := public.nexamon_own_copy(v_player, p_copy_id);
  if c.grading_until is not null then
    perform public.api_error('nexamon_grading');
  end if;
  if c.grade is null then
    perform public.api_error('nexamon_not_graded');
  end if;
  if exists (select 1 from public.nexamon_listings l where l.copy_id = c.id) then
    perform public.api_error('nexamon_listed');
  end if;
  update public.nexamon_copies set grade = null, graded_at = null, grading_fee_cents = null where id = c.id;
  return public.request_complete(v_player, p_request_id,
    jsonb_build_object('copy', public.nexamon_copy_json(c.id), 'old_grade', c.grade));
end;
$$;
comment on function public.crack_nexamon_slab(uuid, uuid) is
  'RPC: cracks the slab of an own graded copy: the raw card with its condition comes back, no refund (ADR-165) -> '
  '{copy, old_grade}; errors nexamon_locked, invalid_argument, nexamon_unknown, nexamon_not_owner, nexamon_grading, '
  'nexamon_not_graded, nexamon_listed.';

-- ---------------------------------------------------------------------------
-- H. The job (cron nexa-nexamon, every minute)
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.nexamon_cfg();
  ai        jsonb := public.nexamon_cfg() -> 'ai';
  v_now     timestamptz := coalesce(p_now, public.game_now());
  v_day     timestamptz := ((coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date)::timestamp
                           at time zone 'Europe/Berlin';
  v_house   uuid := public.ledger_system_account('households');
  v_names   jsonb := coalesce(public.nexamon_cfg() #> '{ai,sellers}', '[]'::jsonb);
  v_graded  integer;
  v_packs   integer := 0;
  v_bought  integer := 0;
  v_steps   integer := 0;
  v_due     integer;
  v_n       integer;
  v_per     numeric;
  v_pulls   jsonb;
  v_cash    bigint;
  v_value   bigint;
  v_spent   bigint;
  v_name    text;
  r         record;
  x         record;
  i         integer;
begin
  if cfg = '{}'::jsonb or ai is null or jsonb_array_length(v_names) = 0 then
    return jsonb_build_object('skipped', 'no config');
  end if;
  perform public.nexamon_sync(v_now);
  v_graded := public.nexamon_finish_gradings(null, v_now);

  -- 1. the AI opens packs: its pulls raise the populations and go into its stock
  for r in select s.* from public.nexamon_set_state s order by s.set_key for update loop
    v_per := coalesce((ai #>> array['packsPerHour', r.set_key])::numeric, 0);
    continue when v_per <= 0 or not exists (select 1 from public.nexamon_cards k where k.set_key = r.set_key and k.in_catalogue);
    v_due := floor(extract(epoch from (v_now - r.ai_packs_at)) / 3600 * v_per)::integer;
    continue when v_due < 1;
    v_n := least(v_due, coalesce((ai ->> 'maxPacksPerRun')::integer, 5));
    for i in 1 .. v_n loop
      v_name := v_names ->> floor(random() * jsonb_array_length(v_names))::integer;
      v_pulls := public.nexamon_open_pack(r.set_key, null, v_name, null, v_now);
      for x in select distinct p ->> 'card_key' as card_key from jsonb_array_elements(v_pulls) p loop
        perform public.nexamon_ai_restock(x.card_key, v_now);
      end loop;
    end loop;
    v_packs := v_packs + v_n;
    update public.nexamon_set_state
       set ai_packs_opened = ai_packs_opened + v_n,
           -- a long pause is not caught up on: the backlog is dropped
           ai_packs_at = case when v_due > v_n * 20 then v_now else ai_packs_at + make_interval(secs => v_n * 3600 / v_per) end
     where set_key = r.set_key;
  end loop;

  -- 2. AI collectors buy player listings up to the copy's value: limited per card and week, per set and day
  for r in select l.id, l.price_cents, l.card_key from public.nexamon_listings l
            where l.seller_id is not null order by random() limit 200 loop
    exit when v_bought >= coalesce((ai ->> 'maxBuysPerRun')::integer, 5);
    select l.price_cents, c.condition, c.grade, k.value_e4, k.rarity, k.population, k.set_key
      into x
      from public.nexamon_listings l
      join public.nexamon_copies c on c.id = l.copy_id
      join public.nexamon_cards k on k.card_key = l.card_key
     where l.id = r.id;
    continue when x is null;
    v_value := public.nexamon_copy_value_cents(x.value_e4, x.condition, x.grade);
    -- nexamonAiWouldBuy
    continue when x.price_cents::numeric * 10000
                  > v_value::numeric * coalesce((ai ->> case when x.grade is null then 'buyMaxBps' else 'gradedBuyMaxBps' end)::integer, 10000);
    continue when (select count(*) from public.nexamon_sales s
                    where s.card_key = r.card_key and s.kind = 'ai_buy'
                      and s.at >= v_now - make_interval(days => coalesce((ai ->> 'buyWindowDays')::integer, 7)))
                  >= coalesce((ai #>> array['buysPerCardWindow', x.rarity])::integer, 0);
    select coalesce(sum(s.price_cents), 0) into v_spent
      from public.nexamon_sales s join public.nexamon_cards k on k.card_key = s.card_key
     where s.kind = 'ai_buy' and s.at >= v_day and k.set_key = x.set_key;
    continue when v_spent + x.price_cents
                  > coalesce((ai ->> 'dailyBudgetPacks')::bigint, 0) * coalesce((cfg #>> array['sets', x.set_key, 'packPriceCents'])::bigint, 0);
    -- nexamonAiBuyChanceBps
    continue when random() * 10000 >= least(10000, floor(coalesce((ai ->> 'buyChanceBps')::numeric, 0)
                                                         * (10000 + public.nexamon_popularity_bps(x.rarity, x.population)) / 10000));
    select a.balance_cents into v_cash from public.ledger_accounts a where a.id = v_house;
    continue when coalesce(v_cash, 0) < x.price_cents;
    v_name := v_names ->> floor(random() * jsonb_array_length(v_names))::integer;
    perform public.nexamon_sell(r.id, null, v_name, 'nexamon:ai:' || r.id::text, v_now);
    v_bought := v_bought + 1;
  end loop;

  -- 3. supply against demand, once per pressure.everyMinutes and card
  for r in select k.card_key from public.nexamon_cards k
            where k.in_catalogue
              and (k.pressure_at is null
                   or k.pressure_at <= v_now - make_interval(mins => coalesce((cfg #>> '{value,pressure,everyMinutes}')::integer, 60)))
            order by k.pressure_at nulls first, k.card_key
            limit coalesce((cfg #>> '{value,pressure,perRun}')::integer, 80) loop
    perform public.nexamon_pressure_step(r.card_key, v_now);
    v_steps := v_steps + 1;
  end loop;

  delete from public.nexamon_value_points
   where at < v_now - make_interval(days => coalesce((cfg #>> '{market,historyDays}')::integer, 60) + 1);
  return jsonb_build_object('graded', v_graded, 'ai_packs', v_packs, 'ai_bought', v_bought, 'value_steps', v_steps);
end;
$$;
comment on function public.nexamon_run_due(timestamptz) is
  'Job (cron nexa-nexamon, every minute; ADR-165): finishes gradings, opens the AI''s packs, lets AI collectors buy '
  'fairly priced player listings, runs the hourly supply and demand step of the card values.';

-- ---------------------------------------------------------------------------
-- I. Account reset, feed label, news show, missions
-- ---------------------------------------------------------------------------
-- The copies of a leaving player go to the AI sellers (the populations stay true); listings and gradings end.
create or replace function public.nexamon_wipe_player(p_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names jsonb := coalesce(public.nexamon_cfg() #> '{ai,sellers}', '[]'::jsonb);
  v_now   timestamptz := public.game_now();
  r       record;
begin
  delete from public.nexamon_listings where seller_id = p_player;
  update public.nexamon_copies c
     set owner_id = null, ai_owner = coalesce(v_names ->> (c.serial % greatest(1, jsonb_array_length(v_names)))::integer, 'Karten-Kalle'),
         grading_until = null, grading_fee_cents = null, acquired_at = v_now
   where c.owner_id = p_player;
  delete from public.nexamon_packs where player_id = p_player;
  for r in select distinct c.card_key from public.nexamon_copies c
            where c.ai_owner is not null and c.acquired_at = v_now loop
    perform public.nexamon_ai_restock(r.card_key, v_now);
  end loop;
end;
$$;
comment on function public.nexamon_wipe_player(uuid) is
  'Internal (account_wipe): ends the Nexamon listings and gradings of a player and hands the copies to the AI sellers.';

do $do$
declare
  v_def text := pg_get_functiondef('public.account_wipe(uuid, text)'::regprocedure);
  v_old text := $t$  perform public.friend_chats_wipe_player(p_player);$t$;
  v_new text := $t$  perform public.friend_chats_wipe_player(p_player);

  -- Nexamon cards (ADR-165): listings and gradings end, the copies go to the AI sellers
  perform public.nexamon_wipe_player(p_player);$t$;
begin
  if position('nexamon_wipe_player' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'account_wipe() has an unexpected shape; add nexamon_wipe_player by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
  v_old text := $t$    when 'car_bought' then 'Neues Auto'$t$;
  v_new text := $t$    when 'car_bought' then 'Neues Auto'
    when 'nexamon_pull' then 'legendäre Nexamon-Karte gezogen (Nummer ' || coalesce(p_payload ->> 'serial', '?') || ')'$t$;
begin
  if position('nexamon_pull' in v_def) = 0 and position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- NEXA Nachrichten: a legendary pull is gossip (the feed kind joins the list of good news)
do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure);
  v_old text := $t$'big_trade', 'rug_pull', 'loan_defaulted'$t$;
  v_new text := $t$'big_trade', 'nexamon_pull', 'rug_pull', 'loan_defaulted'$t$;
begin
  if position('nexamon_pull' in v_def) = 0 and position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  ('d_nexamon_pack', 'daily', 'Öffne einen Nexamon-Booster', 'Fünf Karten, mit Glück etwas Seltenes.', 'mission_art', 'nexamon_pack', 'count', '{"unlock":"nexamon"}'::jsonb, 1, 1, 200, 250, 10, null, false, 25, 0),
  ('w_nexamon_sell', 'weekly', 'Verkauf {target} Nexamon-Karten am Markt', 'An Spieler oder KI-Sammler.', 'mission_art', 'nexamon_sold', 'count', '{"unlock":"nexamon"}'::jsonb, 1, 2, 700, 900, 10, null, false, 25, 1),
  ('m_nexamon_first_pack', 'milestone', 'Dein erster Booster', 'Öffne einen Nexamon-Booster.', 'mission_art', 'nexamon_pack', 'count', '{"unlock":"nexamon"}'::jsonb, 1, 1, 300, 300, 10, 130, false, 60, 1),
  ('m_nexamon_packs_10', 'milestone', '10 Booster geöffnet', 'Die Sammlung wächst.', 'mission_art', 'nexamon_pack', 'count', '{"unlock":"nexamon"}'::jsonb, 10, 10, 800, 800, 10, 132, false, 50, 1),
  ('m_nexamon_first_rare', 'milestone', 'Deine erste Rare', 'Zieh eine Rare oder etwas Besseres.', 'mission_art', 'nexamon_rare', 'count', '{"unlock":"nexamon"}'::jsonb, 1, 1, 400, 400, 10, 131, false, 50, 1),
  ('m_nexamon_first_ultra', 'milestone', 'Deine erste Ultra Rare', 'Zieh eine Ultra Rare oder etwas Besseres.', 'mission_art', 'nexamon_ultra', 'count', '{"unlock":"nexamon"}'::jsonb, 1, 1, 1000, 1000, 10, 134, false, 40, 1),
  ('m_nexamon_first_sale', 'milestone', 'Erste Karte verkauft', 'Verkauf eine Nexamon-Karte am Markt.', 'mission_art', 'nexamon_sold', 'count', '{"unlock":"nexamon"}'::jsonb, 1, 1, 500, 500, 10, 133, false, 50, 1),
  ('m_nexamon_first_ten', 'milestone', 'Die erste 10', 'Lass eine Karte bei ASP bewerten und hol die Bestnote.', 'mission_art', 'nexamon_ten', 'count', '{"unlock":"nexamon"}'::jsonb, 1, 1, 1500, 1500, 10, 136, false, 40, 1)
on conflict (key) do update
   set kind = excluded.kind, title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params, target_min = excluded.target_min,
       target_max = excluded.target_max, xp_min = excluded.xp_min, xp_max = excluded.xp_max, min_level = excluded.min_level,
       chain_order = excluded.chain_order, scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true, updated_at = now();

-- ---------------------------------------------------------------------------
-- J. Privileges and the job
-- ---------------------------------------------------------------------------
do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.nexamon_cfg()', 'public.nexamon_catalogue()', 'public.nexamon_slot_rarity(integer, double precision)',
    'public.nexamon_roll_condition(double precision)', 'public.nexamon_roll_grade(text, double precision)',
    'public.nexamon_copy_factor_bps(text, integer)', 'public.nexamon_copy_value_cents(bigint, text, integer)',
    'public.nexamon_ai_ask_cents(bigint)', 'public.nexamon_popularity_bps(text, bigint)',
    'public.nexamon_demand_milli(text, bigint, bigint)', 'public.nexamon_pressure_bps(text, bigint, bigint, bigint)',
    'public.nexamon_bounds(bigint, timestamptz, bigint, timestamptz)', 'public.nexamon_unlocked(uuid)',
    'public.nexamon_require_unlock(uuid)', 'public.nexamon_mint_copy(text, uuid, text, text, text, uuid, timestamptz)',
    'public.nexamon_ai_restock(text, timestamptz, integer)', 'public.nexamon_set_value(text, bigint, timestamptz, boolean)',
    'public.nexamon_sync(timestamptz)', 'public.nexamon_open_pack(text, uuid, text, uuid, timestamptz)',
    'public.nexamon_sell(uuid, uuid, text, text, timestamptz)', 'public.nexamon_pressure_step(text, timestamptz)',
    'public.nexamon_finish_gradings(uuid, timestamptz)', 'public.nexamon_copy_json(uuid)',
    'public.nexamon_listing_json(uuid, uuid)', 'public.nexamon_card_json(text, uuid, timestamptz)',
    'public.nexamon_own_copy(uuid, uuid)', 'public.nexamon_run_due(timestamptz)', 'public.nexamon_wipe_player(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_nexamon()', 'public.get_nexamon_collection(text)', 'public.get_nexamon_card(text)',
    'public.get_nexamon_market(text, text, text, integer, text, text, boolean)', 'public.buy_nexamon_pack(uuid, text)',
    'public.list_nexamon_card(uuid, uuid, bigint)', 'public.unlist_nexamon_card(uuid, uuid)',
    'public.buy_nexamon_listing(uuid, uuid, bigint)', 'public.sell_nexamon_to_ai(uuid, uuid[])',
    'public.grade_nexamon_card(uuid, uuid)', 'public.crack_nexamon_slab(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$do$;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-nexamon';
    perform cron.schedule('nexa-nexamon', '* * * * *', 'select public.nexamon_run_due()');
  end if;
end;
$do$;
