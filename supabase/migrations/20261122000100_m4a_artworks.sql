-- =============================================================================
-- NEXA · M4a · 0100 · Artworks: pixel art, gallery, auctions, collections (ADR-080)
-- =============================================================================
-- docs/ARTWORKS.md. Every artwork is unique (32 x 32 pixels, up to 16 colours).
-- The 36 artworks of the game (supabase/seeds/artworks.sql) belong to the NEXA
-- gallery (owner_id null), which auctions artworks.gallery.auctionsPerDay of them
-- per Berlin day. Players paint their own (the cost doubles with every artwork,
-- paid to the treasury), like, auction and bid. Bids are reserved in the system
-- account art_escrow; an outbid leader is refunded in the same posting. A sale pays
-- the seller the price minus artworks.auction.feeBps, the fee (gallery sales: all
-- of it) goes to the households. Value = last sale price; it counts towards the
-- net worth. Mirrors src/lib/sim/artworks.ts.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Ledger: transaction kinds and the escrow account
-- ---------------------------------------------------------------------------
-- (new enum values are only used inside PL/pgSQL bodies, so they may be added in
-- the same transaction that creates the functions)
alter type public.ledger_tx_kind add value if not exists 'artwork_creation';
alter type public.ledger_tx_kind add value if not exists 'artwork_bid';
alter type public.ledger_tx_kind add value if not exists 'artwork_refund';
alter type public.ledger_tx_kind add value if not exists 'artwork_sale';

insert into public.ledger_accounts (kind, system_key, label, allow_negative) values
  ('system', 'art_escrow', 'Artworks: reserved bids of running auctions (ADR-080)', false)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- B. Tables (internal: read through the RPCs, never written by clients)
-- ---------------------------------------------------------------------------
create table if not exists public.artworks (
  id          uuid primary key default gen_random_uuid(),
  serial      bigint not null unique check (serial > 0),
  gallery_key text unique,
  title       text not null check (char_length(title) between 1 and 80),
  origin      text not null check (origin in ('game', 'player')),
  rarity      text check (rarity in ('common', 'rare', 'legendary')),
  creator_id  uuid references public.profiles (id) on delete set null,
  owner_id    uuid references public.profiles (id) on delete set null,
  pixels      jsonb not null check (jsonb_typeof(pixels) = 'object' and pg_column_size(pixels) < 16384),
  value_cents bigint check (value_cents is null or value_cents > 0),
  created_at  timestamptz not null default now(),
  constraint artworks_origin_key check ((origin = 'game') = (gallery_key is not null))
);
alter table public.artworks enable row level security;
create index if not exists artworks_owner_idx on public.artworks (owner_id) where owner_id is not null;
create index if not exists artworks_creator_idx on public.artworks (creator_id) where creator_id is not null;
create index if not exists artworks_value_idx on public.artworks (value_cents desc) where value_cents is not null;
comment on table public.artworks is
  'Unique pixel artworks (ADR-080). serial = display code ART-0042; owner_id null = NEXA gallery; value_cents = last sale price (null = never sold). Internal (RPCs).';

create table if not exists public.artwork_auctions (
  id            uuid primary key default gen_random_uuid(),
  artwork_id    uuid not null references public.artworks (id) on delete cascade,
  seller_id     uuid references public.profiles (id) on delete set null,
  by_gallery    boolean not null default false,
  start_cents   bigint not null check (start_cents > 0),
  ends_at       timestamptz not null,
  status        text not null default 'open' check (status in ('open', 'sold', 'unsold', 'cancelled')),
  leader_id     uuid references public.profiles (id) on delete set null,
  current_cents bigint check (current_cents is null or current_cents > 0),
  bids          integer not null default 0 check (bids >= 0),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);
alter table public.artwork_auctions enable row level security;
create index if not exists artwork_auctions_artwork_idx on public.artwork_auctions (artwork_id, created_at desc);
create unique index if not exists artwork_auctions_open_uq on public.artwork_auctions (artwork_id) where status = 'open';
create index if not exists artwork_auctions_due_idx on public.artwork_auctions (ends_at) where status = 'open';
create index if not exists artwork_auctions_seller_idx on public.artwork_auctions (seller_id) where seller_id is not null;
create index if not exists artwork_auctions_leader_idx on public.artwork_auctions (leader_id) where leader_id is not null;
create index if not exists artwork_auctions_gallery_idx on public.artwork_auctions (created_at) where by_gallery;
comment on table public.artwork_auctions is
  'Auctions of artworks; at most one open per artwork. by_gallery = started by the NEXA gallery (seller_id null). current_cents is held in art_escrow while open. Internal (RPCs).';

create table if not exists public.artwork_bids (
  id           bigint generated always as identity primary key,
  auction_id   uuid not null references public.artwork_auctions (id) on delete cascade,
  bidder_id    uuid not null references public.profiles (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  at           timestamptz not null default now()
);
alter table public.artwork_bids enable row level security;
create index if not exists artwork_bids_auction_idx on public.artwork_bids (auction_id, id desc);
create index if not exists artwork_bids_bidder_idx on public.artwork_bids (bidder_id);
comment on table public.artwork_bids is 'Every bid of an artwork auction (history). Internal (RPCs).';

create table if not exists public.artwork_likes (
  artwork_id uuid not null references public.artworks (id) on delete cascade,
  player_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (artwork_id, player_id)
);
alter table public.artwork_likes enable row level security;
create index if not exists artwork_likes_player_idx on public.artwork_likes (player_id);
comment on table public.artwork_likes is 'One like per player and foreign artwork; can be taken back. Internal (RPCs).';

-- seller_id / buyer_id without foreign key: the sales history outlives a deleted player
create table if not exists public.artwork_sales (
  id          bigint generated always as identity primary key,
  artwork_id  uuid not null references public.artworks (id) on delete cascade,
  auction_id  uuid not null unique references public.artwork_auctions (id) on delete cascade,
  seller_id   uuid,
  buyer_id    uuid not null,
  price_cents bigint not null check (price_cents > 0),
  fee_cents   bigint not null default 0 check (fee_cents >= 0),
  at          timestamptz not null default now()
);
alter table public.artwork_sales enable row level security;
create index if not exists artwork_sales_artwork_idx on public.artwork_sales (artwork_id, at desc);
comment on table public.artwork_sales is
  'Completed artwork sales (seller_id null = gallery). fee_cents = what went to the households. Internal (RPCs).';

do $$
declare
  t text;
begin
  foreach t in array array['artworks', 'artwork_auctions', 'artwork_bids', 'artwork_likes', 'artwork_sales'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

-- ART-0001, ART-0002, ...: serials without gaps (the gallery seed runs with ON CONFLICT DO NOTHING
-- any number of times, so a sequence would lose numbers)
create or replace function public.artworks_assign_serial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.serial is null then
    perform pg_advisory_xact_lock(7311080);
    select coalesce(max(a.serial), 0) + 1 into new.serial from public.artworks a;
  end if;
  return new;
end;
$$;
drop trigger if exists artworks_assign_serial on public.artworks;
create trigger artworks_assign_serial
  before insert on public.artworks
  for each row execute function public.artworks_assign_serial();

-- ---------------------------------------------------------------------------
-- C. Error keys (M4a: NX066..NX073)
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
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;
comment on function public.api_error(text) is 'Raises the API error <key> with its NX SQLSTATE. The client shows a text per key (error.message).';

-- ---------------------------------------------------------------------------
-- D. Rules (port of src/lib/sim/artworks.ts)
-- ---------------------------------------------------------------------------
-- isValidArtwork: artworks.size rows of artworks.size chars from '.' and the palette
-- indices 0-9a-f below the palette length, 1..maxColors lowercase #rrggbb, >= 16 drawn pixels
create or replace function public.artwork_valid(p_art jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_size integer := public.config_double('artworks', '{size}', 32)::integer;
  v_max  integer := public.config_double('artworks', '{maxColors}', 16)::integer;
  v_n    integer;
  v_re   text;
begin
  if p_art is null or jsonb_typeof(p_art) <> 'object'
     or jsonb_typeof(p_art -> 'palette') is distinct from 'array' or jsonb_typeof(p_art -> 'grid') is distinct from 'array' then
    return false;
  end if;
  v_n := jsonb_array_length(p_art -> 'palette');
  if v_n < 1 or v_n > least(v_max, 16)
     or exists (select 1 from jsonb_array_elements(p_art -> 'palette') c
                 where jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#[0-9a-f]{6}$') then
    return false;
  end if;
  if jsonb_array_length(p_art -> 'grid') <> v_size then
    return false;
  end if;
  v_re := '^[.' || substr('0123456789abcdef', 1, v_n) || ']{' || v_size || '}$';
  if exists (select 1 from jsonb_array_elements(p_art -> 'grid') r
              where jsonb_typeof(r) <> 'string' or (r #>> '{}') !~ v_re) then
    return false;
  end if;
  return (select sum(char_length(replace(r #>> '{}', '.', ''))) from jsonb_array_elements(p_art -> 'grid') r) >= 16;
end;
$$;
comment on function public.artwork_valid(jsonb) is 'Port of isValidArtwork (src/lib/sim/artworks.ts, ADR-080).';

-- artworkCreateCostCents: base x factor ^ artworks already painted (capped far below the bigint limit)
create or replace function public.artwork_create_cost_cents(p_painted integer)
returns bigint
language sql
stable
set search_path = ''
as $$
  select least(round(public.config_double('artworks', '{createBaseCostCents}', 1500000)::numeric
                     * power(public.config_double('artworks', '{createCostFactor}', 2)::numeric, greatest(0, coalesce(p_painted, 0)))),
               1000000000000000000)::bigint;
$$;

-- minNextBidCents: start price without a bid, else current + minIncrementBps, rounded up to whole euros
create or replace function public.artwork_min_bid_cents(p_start_cents bigint, p_current_cents bigint)
returns bigint
language sql
stable
set search_path = ''
as $$
  select case when p_current_cents is null then p_start_cents
              else (ceil(p_current_cents::numeric
                         * (10000 + public.config_double('artworks', '{auction,minIncrementBps}', 500)::integer)
                         / 1000000) * 100)::bigint end;
$$;

-- hotScore: (likes x likeWeight + bids x bidWeight + 1) / (age in hours + 2) ^ gravity
create or replace function public.artwork_hot(p_likes bigint, p_bids bigint, p_created timestamptz, p_now timestamptz)
returns double precision
language sql
stable
set search_path = ''
as $$
  select (coalesce(p_likes, 0) * public.config_double('artworks', '{hot,likeWeight}', 1)
          + coalesce(p_bids, 0) * public.config_double('artworks', '{hot,bidWeight}', 3) + 1)
         / power(greatest(0, extract(epoch from (p_now - p_created)) / 3600.0) + 2, public.config_double('artworks', '{hot,gravity}', 1.5));
$$;

create or replace function public.artwork_code(p_serial bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'ART-' || case when p_serial < 10000 then lpad(p_serial::text, 4, '0') else p_serial::text end;
$$;

-- Title: trimmed, single spaces, 3..artworks.titleMaxLength chars, letters (incl. umlauts), digits,
-- space and simple punctuation, at least one letter; words through the name filter (text_has_profanity).
-- Returns NULL or the reason (the name filter's keys).
create or replace function public.artwork_title_violation(p_title text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_max integer := public.config_double('artworks', '{titleMaxLength}', 40)::integer;
begin
  if p_title is null or char_length(p_title) < 3 then
    return 'name_too_short';
  end if;
  if char_length(p_title) > v_max then
    return 'name_too_long';
  end if;
  if p_title !~ '^[A-Za-zÄÖÜäöüßÀ-ÿ0-9 &.,:;!?''"()„“‚‘–-]+$' or public.name_letters(p_title) = '' then
    return 'name_invalid_chars';
  end if;
  if public.text_has_profanity(p_title) then
    return 'name_profanity';
  end if;
  return null;
end;
$$;
comment on function public.artwork_title_violation(text) is
  'Internal: NULL or name_too_short / name_too_long / name_invalid_chars / name_profanity for an artwork title (already trimmed).';

create or replace function public.artworks_require_unlock(p_player uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select p.level from public.profiles p where p.id = p_player), 1) < public.unlock_level('artworks') then
    perform public.api_error('artworks_locked');
  end if;
end;
$$;

create or replace function public.player_art_value_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(a.value_cents), 0)::bigint from public.artworks a where a.owner_id = p_player;
$$;
comment on function public.player_art_value_cents(uuid) is 'Value of the artworks a player owns (last sale prices; never sold = 0).';

create or replace function public.artwork_gallery_start_cents(p_rarity text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select case p_rarity
           when 'legendary' then public.config_bigint('artworks', '{gallery,startPriceCents,legendary}', 15000000)
           when 'rare' then public.config_bigint('artworks', '{gallery,startPriceCents,rare}', 2500000)
           else public.config_bigint('artworks', '{gallery,startPriceCents,common}', 500000) end;
$$;

-- ---------------------------------------------------------------------------
-- E. ARTWORK (JSON of docs/ARTWORKS.md section 8)
-- ---------------------------------------------------------------------------
create or replace function public.artwork_json(p_artwork uuid, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a       public.artworks;
  au      public.artwork_auctions;
  v_likes bigint;
  v_now   timestamptz := public.game_now();
begin
  select * into a from public.artworks where id = p_artwork;
  if a.id is null then
    return null;
  end if;
  select * into au from public.artwork_auctions x where x.artwork_id = a.id and x.status = 'open';
  select count(*) into v_likes from public.artwork_likes l where l.artwork_id = a.id;
  return jsonb_build_object(
    'id', a.id,
    'code', public.artwork_code(a.serial),
    'title', a.title,
    'origin', a.origin,
    'rarity', a.rarity,
    'creator', (select p.nickname from public.profiles p where p.id = a.creator_id),
    'owner', (select p.nickname from public.profiles p where p.id = a.owner_id),
    'pixels', jsonb_build_object('palette', a.pixels -> 'palette', 'grid', a.pixels -> 'grid'),
    'value_cents', a.value_cents,
    'likes', v_likes,
    'liked', exists (select 1 from public.artwork_likes l where l.artwork_id = a.id and l.player_id = p_viewer),
    'created_at', a.created_at,
    'hot', round(public.artwork_hot(v_likes, coalesce(au.bids, 0), a.created_at, v_now)::numeric, 6),
    'auction', case when au.id is null then null else jsonb_build_object(
      'id', au.id,
      'ends_at', au.ends_at,
      'start_cents', au.start_cents,
      'current_cents', au.current_cents,
      'min_bid_cents', public.artwork_min_bid_cents(au.start_cents, au.current_cents),
      'bids', au.bids,
      'leader', (select p.nickname from public.profiles p where p.id = au.leader_id),
      'seller', case when au.by_gallery then null
                     else coalesce((select p.nickname from public.profiles p where p.id = au.seller_id), 'Ehemaliger Spieler') end,
      'my_bid_cents', case when au.leader_id = p_viewer then au.current_cents end) end);
end;
$$;
comment on function public.artwork_json(uuid, uuid) is 'ARTWORK as seen by p_viewer (liked, my_bid_cents); docs/ARTWORKS.md section 8.';

-- ---------------------------------------------------------------------------
-- F. Settlement, gallery and the job
-- ---------------------------------------------------------------------------
-- Closes one auction if it is open and due: the leader gets the artwork, the seller the
-- price minus the fee, the households the fee (gallery: the whole price); without a bid
-- the artwork stays with its owner. Returns 'sold', 'unsold' or null (not due).
create or replace function public.artwork_settle_auction(p_auction uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  au        public.artwork_auctions;
  v_now     timestamptz := public.game_now();
  v_fee     bigint;
  v_seller  uuid;
  v_escrow  uuid := public.ledger_system_account('art_escrow');
  v_house   uuid := public.ledger_system_account('households');
  v_entries jsonb;
  v_key     text;
begin
  select * into au from public.artwork_auctions where id = p_auction for update;
  if au.id is null or au.status <> 'open' or au.ends_at > v_now then
    return null;
  end if;
  if au.leader_id is null or au.current_cents is null then
    update public.artwork_auctions set status = 'unsold', closed_at = v_now where id = au.id;
    return 'unsold';
  end if;

  v_key := 'art:sale:' || au.id::text;
  -- seller: a player whose cash account can still receive money, else the households take it all
  if not au.by_gallery and au.seller_id is not null then
    select a.id into v_seller from public.ledger_accounts a
     where a.owner_player_id = au.seller_id and a.kind = 'player_cash' and not a.is_frozen;
  end if;
  if v_seller is null then
    v_fee := au.current_cents;
    v_entries := jsonb_build_array(jsonb_build_object('account_id', v_escrow, 'amount_cents', -au.current_cents),
                                   jsonb_build_object('account_id', v_house, 'amount_cents', au.current_cents));
  else
    v_fee := floor(au.current_cents * public.config_double('artworks', '{auction,feeBps}', 1000)::integer / 10000.0)::bigint;
    v_entries := jsonb_build_array(jsonb_build_object('account_id', v_escrow, 'amount_cents', -au.current_cents),
                                   jsonb_build_object('account_id', v_seller, 'amount_cents', au.current_cents - v_fee));
    if v_fee > 0 then
      v_entries := v_entries || jsonb_build_object('account_id', v_house, 'amount_cents', v_fee);
    end if;
  end if;
  perform public.ledger_post('artwork_sale', v_entries, 'Kunstwerk versteigert', 'artwork_auction', au.id, v_key, au.leader_id,
                             jsonb_build_object('price_cents', au.current_cents, 'fee_cents', v_fee, 'artwork_id', au.artwork_id));
  if v_seller is not null then
    perform public.loan_withhold(au.seller_id, au.current_cents - v_fee, v_key);
  end if;

  update public.artworks set owner_id = au.leader_id, value_cents = au.current_cents where id = au.artwork_id;
  insert into public.artwork_sales (artwork_id, auction_id, seller_id, buyer_id, price_cents, fee_cents, at)
  values (au.artwork_id, au.id, case when au.by_gallery then null else au.seller_id end, au.leader_id, au.current_cents, v_fee, v_now)
  on conflict (auction_id) do nothing;
  update public.artwork_auctions set status = 'sold', closed_at = v_now where id = au.id;

  perform public.mission_event(au.leader_id, 'art_won', 1, null);
  if not au.by_gallery then
    perform public.mission_event(au.seller_id, 'art_sold', 1, null);
  end if;
  return 'sold';
end;
$$;
comment on function public.artwork_settle_auction(uuid) is 'Internal: closes one due artwork auction (sale with fee, or unsold).';

-- The gallery auctions artworks.gallery.auctionsPerDay artworks per Berlin day, one per
-- slot of 24 h / auctionsPerDay (a job run that comes late starts the missed slots of the
-- day at once), each artworks.gallery.auctionHours long at its rarity's start price.
-- Candidates: artworks without owner and without an open auction, never auctioned by the
-- gallery today, unsold ones first, then the least often offered, then a daily shuffle.
create or replace function public.artworks_gallery_schedule(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := coalesce(p_now, public.game_now());
  v_day     date := (coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date;
  v_start   timestamptz;
  v_per     integer := greatest(0, public.config_double('artworks', '{gallery,auctionsPerDay}', 4)::integer);
  v_hours   double precision := greatest(0.1, public.config_double('artworks', '{gallery,auctionHours}', 6));
  v_due     integer;
  v_started integer;
  v_n       integer := 0;
  r         record;
begin
  if v_per = 0 then
    return 0;
  end if;
  v_start := v_day::timestamp at time zone 'Europe/Berlin';
  v_due := least(v_per, floor(extract(epoch from (v_now - v_start)) / (86400.0 / v_per))::integer + 1);
  select count(*) into v_started from public.artwork_auctions x
   where x.by_gallery and x.created_at >= v_start and x.created_at < v_start + interval '1 day';
  if v_started >= v_due then
    return 0;
  end if;
  for r in
    select a.id, a.rarity
      from public.artworks a
     where a.owner_id is null
       and not exists (select 1 from public.artwork_auctions x where x.artwork_id = a.id
                        and (x.status = 'open' or (x.by_gallery and x.created_at >= v_start)))
     order by (a.value_cents is null) desc,
              (select count(*) from public.artwork_auctions x where x.artwork_id = a.id and x.by_gallery),
              md5(a.id::text || v_day::text)
     limit v_due - v_started
  loop
    insert into public.artwork_auctions (artwork_id, seller_id, by_gallery, start_cents, ends_at, created_at)
    values (r.id, null, true, public.artwork_gallery_start_cents(r.rarity), v_now + make_interval(secs => v_hours * 3600), v_now)
    on conflict do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
comment on function public.artworks_gallery_schedule(timestamptz) is
  'Internal: starts the gallery auctions due today (artworks.gallery, ADR-080). Idempotent.';

create or replace function public.artworks_run_due()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sold   integer := 0;
  v_unsold integer := 0;
  v_res    text;
  r        record;
begin
  for r in select x.id from public.artwork_auctions x
            where x.status = 'open' and x.ends_at <= public.game_now()
            order by x.ends_at, x.id limit 200 loop
    v_res := public.artwork_settle_auction(r.id);
    if v_res = 'sold' then
      v_sold := v_sold + 1;
    elsif v_res = 'unsold' then
      v_unsold := v_unsold + 1;
    end if;
  end loop;
  return jsonb_build_object('sold', v_sold, 'unsold', v_unsold, 'gallery_started', public.artworks_gallery_schedule(null));
end;
$$;
comment on function public.artworks_run_due() is 'Internal (run_due_jobs): closes due artwork auctions, then schedules the gallery.';

-- Account reset/delete: the player's artworks go back to the gallery, auctions they sell are
-- cancelled (the leader is refunded), auctions they lead lose them as leader (their money
-- comes back to their cash before account_wipe returns it to the state), likes disappear.
create or replace function public.artworks_wipe_player(p_player uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_escrow uuid := public.ledger_system_account('art_escrow');
  r        record;
begin
  for r in select x.* from public.artwork_auctions x where x.status = 'open' and (x.seller_id = p_player or x.leader_id = p_player)
            order by x.id for update loop
    if r.leader_id is not null and r.current_cents is not null then
      perform public.ledger_transfer(v_escrow, public.ledger_player_account(r.leader_id, 'player_cash'), r.current_cents,
                                     'artwork_refund', 'Gebot zurück (Auktion beendet)', 'artwork_auction', r.id,
                                     p_key || ':art:' || r.id::text, r.leader_id);
    end if;
    if r.seller_id = p_player then
      update public.artwork_auctions set status = 'cancelled', closed_at = public.game_now() where id = r.id;
    else
      delete from public.artwork_bids b where b.auction_id = r.id and b.bidder_id = p_player;
      update public.artwork_auctions
         set leader_id = null, current_cents = null,
             bids = (select count(*) from public.artwork_bids b where b.auction_id = r.id)
       where id = r.id;
    end if;
  end loop;
  update public.artworks set owner_id = null where owner_id = p_player;
  delete from public.artwork_likes where player_id = p_player;
end;
$$;
comment on function public.artworks_wipe_player(uuid, text) is 'Internal (account_wipe): releases the artworks, auctions and bids of a player.';

-- ---------------------------------------------------------------------------
-- G. Read RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_artworks(p_sort text default 'hot', p_origin text default 'all',
                                               p_on_auction boolean default false, p_limit integer default 24,
                                               p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_sort    text := coalesce(p_sort, 'hot');
  v_origin  text := coalesce(p_origin, 'all');
  v_auction boolean := coalesce(p_on_auction, false);
  v_limit   integer := least(greatest(coalesce(p_limit, 24), 1), 100);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_now     timestamptz := public.game_now();
  v_total   bigint;
  v_entries jsonb;
begin
  v_player := public.require_player();
  if v_sort not in ('hot', 'price', 'new', 'ending') or v_origin not in ('all', 'game', 'player') then
    perform public.api_error('invalid_argument');
  end if;
  with base as (
    select a.id, a.serial, a.created_at,
           coalesce(au.current_cents, a.value_cents, au.start_cents) as price,
           au.ends_at,
           public.artwork_hot((select count(*) from public.artwork_likes l where l.artwork_id = a.id),
                              coalesce(au.bids, 0), a.created_at, v_now) as hot
      from public.artworks a
      left join public.artwork_auctions au on au.artwork_id = a.id and au.status = 'open'
     where (v_origin = 'all' or a.origin = v_origin)
       and (not v_auction or au.id is not null)
  ), ordered as (
    select b.id,
           row_number() over (order by
             case when v_sort = 'hot' then b.hot end desc nulls last,
             case when v_sort = 'price' then b.price end desc nulls last,
             case when v_sort = 'new' then b.created_at end desc nulls last,
             case when v_sort = 'ending' then b.ends_at end asc nulls last,
             b.hot desc, b.serial desc) as ord,
           count(*) over () as total
      from base b
  )
  select coalesce(max(o.total), 0),
         coalesce(jsonb_agg(public.artwork_json(o.id, v_player) order by o.ord)
                    filter (where o.ord > v_offset and o.ord <= v_offset + v_limit), '[]'::jsonb)
    into v_total, v_entries
    from ordered o;
  return jsonb_build_object('server_time', v_now, 'total', v_total, 'entries', v_entries);
end;
$$;
comment on function public.get_artworks(text, text, boolean, integer, integer) is
  'RPC: marketplace page {server_time, total, entries: [ARTWORK]}; sort hot|price|new|ending, origin all|game|player (ADR-080).';

create or replace function public.get_artwork(p_artwork_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_auction uuid;
begin
  v_player := public.require_player();
  if p_artwork_id is null or not exists (select 1 from public.artworks a where a.id = p_artwork_id) then
    perform public.api_error('artwork_not_found');
  end if;
  -- bids of the running auction, else of the latest one
  select x.id into v_auction from public.artwork_auctions x where x.artwork_id = p_artwork_id
   order by (x.status = 'open') desc, x.created_at desc, x.id limit 1;
  return jsonb_build_object(
    'artwork', public.artwork_json(p_artwork_id, v_player),
    'sales', coalesce((select jsonb_agg(jsonb_build_object(
                         'at', s.at, 'price_cents', s.price_cents,
                         'seller', case when s.seller_id is null then null
                                        else coalesce(ps.nickname, 'Ehemaliger Spieler') end,
                         'buyer', coalesce(pb.nickname, 'Ehemaliger Spieler')) order by s.at desc, s.id desc)
                         from public.artwork_sales s
                         left join public.profiles ps on ps.id = s.seller_id
                         left join public.profiles pb on pb.id = s.buyer_id
                        where s.artwork_id = p_artwork_id), '[]'::jsonb),
    'bids', coalesce((select jsonb_agg(jsonb_build_object('nickname', coalesce(p.nickname, 'Ehemaliger Spieler'),
                                                          'amount_cents', b.amount_cents, 'at', b.at) order by b.id desc)
                        from (select * from public.artwork_bids b0 where b0.auction_id = v_auction order by b0.id desc limit 50) b
                        left join public.profiles p on p.id = b.bidder_id), '[]'::jsonb));
end;
$$;
comment on function public.get_artwork(uuid) is
  'RPC: {artwork: ARTWORK, sales: [{at, price_cents, seller, buyer}], bids: [{nickname, amount_cents, at}]} (ADR-080).';

create or replace function public.get_art_studio()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_painted integer;
begin
  v_player := public.require_player();
  select count(*) into v_painted from public.artworks a where a.creator_id = v_player;
  return jsonb_build_object(
    'painted', v_painted,
    'next_cost_cents', public.artwork_create_cost_cents(v_painted),
    'unlocked', coalesce((select p.level from public.profiles p where p.id = v_player), 1) >= public.unlock_level('artworks'));
end;
$$;
comment on function public.get_art_studio() is 'RPC: {painted, next_cost_cents, unlocked} for the art editor (ADR-080).';

create or replace function public.get_art_rankings(p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_limit  integer := least(greatest(coalesce(p_limit, 10), 1), 100);
begin
  v_player := public.require_player();
  return jsonb_build_object(
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object('rank', c.rnk, 'nickname', c.nickname, 'avatar_key', c.avatar_key,
                                          'count', c.n, 'value_cents', c.val, 'is_me', c.owner_id = v_player) order by c.rnk)
        from (select x.*, row_number() over (order by x.val desc, x.n desc, lower(x.nickname)) as rnk
                from (select a.owner_id, p.nickname, p.avatar_key, count(*) as n, coalesce(sum(a.value_cents), 0)::bigint as val
                        from public.artworks a join public.profiles p on p.id = a.owner_id
                       where not p.is_deactivated
                       group by a.owner_id, p.nickname, p.avatar_key) x) c
       where c.rnk <= v_limit), '[]'::jsonb),
    'artworks', coalesce((
      select jsonb_agg(jsonb_build_object('rank', t.rnk, 'artwork', public.artwork_json(t.id, v_player)) order by t.rnk)
        from (select a.id, row_number() over (order by a.value_cents desc, a.serial) as rnk
                from public.artworks a where a.value_cents is not null
               order by a.value_cents desc, a.serial limit v_limit) t), '[]'::jsonb));
end;
$$;
comment on function public.get_art_rankings(integer) is
  'RPC: largest collections (sum of values) and most valuable artworks (ADR-080).';

-- p_nickname null = the caller
create or replace function public.get_collection(p_nickname text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_target uuid;
  v_nick   text;
begin
  v_player := public.require_player();
  if p_nickname is null then
    v_target := v_player;
  else
    select p.id into v_target from public.profiles p where lower(p.nickname) = lower(btrim(p_nickname));
  end if;
  select p.nickname into v_nick from public.profiles p where p.id = v_target;
  if v_nick is null then
    perform public.api_error('player_not_found');
  end if;
  return jsonb_build_object(
    'nickname', v_nick,
    'count', (select count(*) from public.artworks a where a.owner_id = v_target),
    'value_cents', public.player_art_value_cents(v_target),
    'artworks', coalesce((select jsonb_agg(public.artwork_json(a.id, v_player)
                                           order by a.value_cents desc nulls last, a.created_at desc, a.serial desc)
                            from public.artworks a where a.owner_id = v_target), '[]'::jsonb));
end;
$$;
comment on function public.get_collection(text) is 'RPC: {nickname, count, value_cents, artworks: [ARTWORK]} of a player (ADR-080).';

-- ---------------------------------------------------------------------------
-- H. Write RPCs (unlock level artworks, idempotent per request_id)
-- ---------------------------------------------------------------------------
create or replace function public.create_artwork(p_request_id uuid, p_title text, p_pixels jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  v_title   text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_reason  text;
  v_painted integer;
  v_cost    bigint;
  v_cash    bigint;
  v_id      uuid := gen_random_uuid();
begin
  v_player := public.require_player();
  perform public.artworks_require_unlock(v_player);
  if p_request_id is null or not public.artwork_valid(p_pixels) then
    perform public.api_error('invalid_argument');
  end if;
  v_reason := public.artwork_title_violation(v_title);
  if v_reason is not null then
    perform public.api_error(v_reason);
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'create_artwork');
  if v_replay is not null then
    return v_replay;
  end if;
  if public.logo_has_forbidden_symbol(p_pixels -> 'grid') then
    perform public.api_error('logo_forbidden');
  end if;
  -- one painting at a time per player (the count decides the price)
  perform 1 from public.profiles p where p.id = v_player for update;
  select count(*) into v_painted from public.artworks a where a.creator_id = v_player;
  v_cost := public.artwork_create_cost_cents(v_painted);
  v_cash := public.lock_player_accounts(v_player);
  if v_cash < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('treasury'),
                                 v_cost, 'artwork_creation', 'Kunstwerk gemalt', 'artwork', v_id,
                                 'art:create:' || v_id::text, v_player, jsonb_build_object('painted_before', v_painted));
  insert into public.artworks (id, title, origin, rarity, creator_id, owner_id, pixels)
  values (v_id, v_title, 'player', null, v_player, v_player,
          jsonb_build_object('palette', p_pixels -> 'palette', 'grid', p_pixels -> 'grid'));
  perform public.mission_event(v_player, 'art_painted', 1, null);
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'artwork', public.artwork_json(v_id, v_player),
    'cost_cents', v_cost,
    'next_cost_cents', public.artwork_create_cost_cents(v_painted + 1)));
end;
$$;
comment on function public.create_artwork(uuid, text, jsonb) is
  'RPC: paints a new artwork (cost doubles per artwork, paid to the treasury); errors artworks_locked, invalid_argument, name_*, logo_forbidden, insufficient_funds.';

create or replace function public.like_artwork(p_request_id uuid, p_artwork_id uuid, p_like boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  a        public.artworks;
begin
  v_player := public.require_player();
  perform public.artworks_require_unlock(v_player);
  if p_request_id is null or p_artwork_id is null or p_like is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'like_artwork');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into a from public.artworks where id = p_artwork_id;
  if a.id is null then
    perform public.api_error('artwork_not_found');
  end if;
  if a.owner_id = v_player or a.creator_id = v_player then
    perform public.api_error('own_artwork');
  end if;
  if p_like then
    insert into public.artwork_likes (artwork_id, player_id) values (a.id, v_player) on conflict do nothing;
    if found then
      perform public.mission_event(v_player, 'art_like', 1, a.id::text);
    end if;
  else
    delete from public.artwork_likes where artwork_id = a.id and player_id = v_player;
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'likes', (select count(*) from public.artwork_likes l where l.artwork_id = a.id),
    'liked', p_like));
end;
$$;
comment on function public.like_artwork(uuid, uuid, boolean) is
  'RPC: likes (p_like true) or unlikes a foreign artwork; errors artworks_locked, artwork_not_found, own_artwork.';

create or replace function public.start_auction(p_request_id uuid, p_artwork_id uuid, p_start_cents bigint, p_hours integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  a        public.artworks;
  v_now    timestamptz := public.game_now();
begin
  v_player := public.require_player();
  perform public.artworks_require_unlock(v_player);
  if p_request_id is null or p_artwork_id is null or p_hours is null or p_start_cents is null
     or p_start_cents < public.config_bigint('artworks', '{auction,minStartCents}', 10000)
     or not (coalesce(public.config_jsonb('artworks', '{auction,durationsHours}'), '[1, 6, 24]'::jsonb) @> to_jsonb(p_hours)) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'start_auction');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into a from public.artworks where id = p_artwork_id for update;
  if a.id is null then
    perform public.api_error('artwork_not_found');
  end if;
  if a.owner_id is distinct from v_player then
    perform public.api_error('forbidden');
  end if;
  if exists (select 1 from public.artwork_auctions x where x.artwork_id = a.id and x.status = 'open') then
    perform public.api_error('already_on_auction');
  end if;
  insert into public.artwork_auctions (artwork_id, seller_id, by_gallery, start_cents, ends_at, created_at)
  values (a.id, v_player, false, p_start_cents, v_now + make_interval(hours => p_hours), v_now);
  perform public.mission_event(v_player, 'art_auction_started', 1, null);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('artwork', public.artwork_json(a.id, v_player)));
end;
$$;
comment on function public.start_auction(uuid, uuid, bigint, integer) is
  'RPC: the owner offers an artwork (start >= artworks.auction.minStartCents, hours in durationsHours); errors forbidden, already_on_auction.';

create or replace function public.cancel_auction(p_request_id uuid, p_auction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  au       public.artwork_auctions;
begin
  v_player := public.require_player();
  perform public.artworks_require_unlock(v_player);
  if p_request_id is null or p_auction_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'cancel_auction');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into au from public.artwork_auctions where id = p_auction_id for update;
  if au.id is null then
    perform public.api_error('auction_not_found');
  end if;
  if au.by_gallery or au.seller_id is distinct from v_player then
    perform public.api_error('forbidden');
  end if;
  if au.status <> 'open' then
    perform public.api_error('auction_ended');
  end if;
  if au.leader_id is not null then
    perform public.api_error('auction_has_bids');
  end if;
  update public.artwork_auctions set status = 'cancelled', closed_at = public.game_now() where id = au.id;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('artwork', public.artwork_json(au.artwork_id, v_player)));
end;
$$;
comment on function public.cancel_auction(uuid, uuid) is
  'RPC: the seller cancels an auction without a bid; errors auction_not_found, forbidden, auction_ended, auction_has_bids.';

-- One posting per bid: the previous leader's reservation goes back to them and the new bid
-- moves from the bidder's cash into art_escrow (accounts locked together, in id order).
create or replace function public.bid_artwork(p_request_id uuid, p_auction_id uuid, p_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  au        public.artwork_auctions;
  v_owner   uuid;
  v_now     timestamptz := public.game_now();
  v_min     bigint;
  v_cash    bigint;
  v_escrow  uuid := public.ledger_system_account('art_escrow');
  v_entries jsonb := '[]'::jsonb;
  v_window  double precision := public.config_double('artworks', '{auction,antiSnipeMinutes}', 2) * 60;
  v_bid     bigint;
begin
  v_player := public.require_player();
  perform public.artworks_require_unlock(v_player);
  if p_request_id is null or p_auction_id is null or p_amount_cents is null or p_amount_cents < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'bid_artwork');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into au from public.artwork_auctions where id = p_auction_id for update;
  if au.id is null then
    perform public.api_error('auction_not_found');
  end if;
  if au.status <> 'open' or au.ends_at <= v_now then
    perform public.api_error('auction_ended');
  end if;
  select a.owner_id into v_owner from public.artworks a where a.id = au.artwork_id;
  if au.seller_id = v_player or v_owner = v_player then
    perform public.api_error('own_artwork');
  end if;
  v_min := public.artwork_min_bid_cents(au.start_cents, au.current_cents);
  if p_amount_cents < v_min then
    perform public.api_error('bid_too_low');
  end if;
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) + (case when au.leader_id = v_player then au.current_cents else 0 end) < p_amount_cents then
    perform public.api_error('insufficient_funds');
  end if;

  if au.leader_id is not null and au.current_cents is not null then
    v_entries := jsonb_build_array(
      jsonb_build_object('account_id', v_escrow, 'amount_cents', -au.current_cents),
      jsonb_build_object('account_id', public.ledger_player_account(au.leader_id, 'player_cash'), 'amount_cents', au.current_cents));
  end if;
  v_entries := v_entries
    || jsonb_build_object('account_id', public.ledger_player_account(v_player, 'player_cash'), 'amount_cents', -p_amount_cents)
    || jsonb_build_object('account_id', v_escrow, 'amount_cents', p_amount_cents);
  insert into public.artwork_bids (auction_id, bidder_id, amount_cents, at) values (au.id, v_player, p_amount_cents, v_now)
  returning id into v_bid;
  begin
    perform public.ledger_post('artwork_bid', v_entries, 'Gebot auf ein Kunstwerk', 'artwork_auction', au.id,
                               'art:bid:' || v_bid::text, v_player,
                               jsonb_build_object('amount_cents', p_amount_cents, 'refunded_player', au.leader_id,
                                                  'refunded_cents', au.current_cents));
  exception when sqlstate 'NX001' then
    perform public.api_error('insufficient_funds');
  end;
  update public.artwork_auctions
     set leader_id = v_player, current_cents = p_amount_cents, bids = bids + 1,
         ends_at = case when extract(epoch from (au.ends_at - v_now)) < v_window
                        then v_now + make_interval(secs => v_window) else au.ends_at end
   where id = au.id;
  perform public.mission_event(v_player, 'art_bid', 1, null);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('artwork', public.artwork_json(au.artwork_id, v_player)));
end;
$$;
comment on function public.bid_artwork(uuid, uuid, bigint) is
  'RPC: bids on an artwork auction (reserved in art_escrow, previous leader refunded, anti-snipe); errors auction_not_found, auction_ended, own_artwork, bid_too_low, insufficient_funds.';

-- ---------------------------------------------------------------------------
-- I. Net worth with art (rich list, player card, state missions)
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
       - public.player_debt_cents(p_player);
$$;

-- rich_list_entries as in M3d plus the value of the artworks
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
             + coalesce(art.val, 0) - coalesce(d.debt, 0) as nw,
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
-- J. Account reset/delete releases artworks (account_wipe as in M3g plus artworks)
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

  -- game state of the player
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
             ('player_unlocks', 'player_id')
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
-- K. run_due_jobs as in M3i plus artworks (auctions, gallery)
-- ---------------------------------------------------------------------------
create or replace function public.run_due_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz;
  v_result   jsonb := '{}'::jsonb;
  v_closed   jsonb := '[]'::jsonb;
  v_latest   bigint;
  q          record;
  v_run      bigint;
begin
  -- waits for a running tick (ticks only try the lock and skip)
  perform pg_advisory_xact_lock(7311001);
  v_now := public.game_now();
  perform public.ensure_game_quarters(3);

  if not exists (select 1 from public.candles limit 1) or not public.money_genesis_done()
     or not exists (select 1 from public.rich_tycoons) then
    v_result := v_result || jsonb_build_object('bootstrap', public.market_bootstrap());
  end if;

  -- first run on a database: older quarters are skipped, only the latest ended one is closed
  if not exists (select 1 from public.job_runs j where j.job_name = 'quarter_close') then
    select gq.id into v_latest from public.game_quarters gq
     where gq.ends_at <= v_now and gq.status <> 'closed' order by gq.ends_at desc limit 1;
    for q in select gq.id from public.game_quarters gq
              where gq.ends_at <= v_now and gq.status <> 'closed' and gq.id <> coalesce(v_latest, -1)
    loop
      update public.game_quarters set status = 'closed', closed_at = now() where id = q.id;
      insert into public.job_runs (job_name, run_key, status, finished_at, details)
      values ('quarter_close', q.id::text, 'succeeded', now(), '{"skipped": "before_first_run"}'::jsonb)
      on conflict do nothing;
    end loop;
  end if;

  for q in select gq.id from public.game_quarters gq
            where gq.ends_at <= v_now and gq.status <> 'closed'
            order by gq.ends_at limit 8
  loop
    v_closed := v_closed || public.close_game_quarter(q.id);
  end loop;
  v_result := v_result || jsonb_build_object('quarters', v_closed);
  -- player companies: operating hours (ADR-072), then every closed quarter since their founding (ADR-057)
  v_result := v_result || jsonb_build_object('player_companies', public.player_companies_run_due());

  -- bonds that matured between quarter closes (or after a downtime)
  if exists (select 1 from public.bonds bd join public.securities s on s.id = bd.security_id
              where s.status = 'listed' and bd.matures_at <= v_now) then
    v_result := v_result || jsonb_build_object('bonds_redeemed', public.redeem_matured_bonds(v_now));
  end if;
  v_result := v_result || jsonb_build_object('bonds_issued', public.ensure_bond_series());

  -- jobs: AI postings of the running quarter, wages of AI-company jobs in whole hours
  v_result := v_result || jsonb_build_object('quit_notices', public.process_quit_notices(null));
  v_result := v_result || jsonb_build_object('share_offers', public.close_due_offers(null));
  v_result := v_result || jsonb_build_object('job_postings', public.refresh_ai_job_postings(),
                                             'salaries_paid', public.accrue_salaries(null));

  -- artworks (ADR-080): due auctions are settled, the gallery starts the auctions of the day
  v_result := v_result || jsonb_build_object('artworks', public.artworks_run_due());

  -- rich list snapshot every richList.snapshotMinutes (rank news, 24 h changes, state missions)
  v_result := v_result || jsonb_build_object('rich_list', public.rich_list_snapshot(false));

  -- daily maintenance (first run per UTC day)
  insert into public.job_runs (job_name, run_key) values ('maintenance', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'))
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is not null then
    v_result := v_result || jsonb_build_object('maintenance', public.run_maintenance());
    -- price_ticks: keep about one day (candles hold the history), cron log: one day
    perform public.maintain_price_tick_partitions(3, 1);
    if to_regclass('cron.job_run_details') is not null then
      begin
        execute 'delete from cron.job_run_details where end_time < now() - interval ''1 day''';
      exception when others then
        raise warning 'NEXA: could not prune cron.job_run_details: %', sqlerrm;
      end;
    end if;
    delete from public.job_runs j where j.job_name = 'maintenance' and j.started_at < now() - interval '30 days';
    update public.job_runs set status = 'succeeded', finished_at = now() where id = v_run;
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- L. Unlock row (seed.sql has it too; levels exist only after seed.sql on a new database)
-- ---------------------------------------------------------------------------
insert into public.unlocks (key, level, title, description, icon_key, intro_mission_key, sort_order)
select 'artworks', 8, 'Artworks', 'Male eigene Pixel-Kunst, sammle Unikate und biete in Auktionen mit.', 'unlock_art', null, 81
 where exists (select 1 from public.levels l where l.level = 8)
on conflict (key) do nothing;
insert into public.player_unlocks (player_id, unlock_key)
select p.id, 'artworks' from public.profiles p
 where p.level >= 8 and exists (select 1 from public.unlocks u where u.key = 'artworks')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- M. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.artworks_assign_serial()', 'public.api_error(text)', 'public.artwork_valid(jsonb)',
    'public.artwork_create_cost_cents(integer)', 'public.artwork_min_bid_cents(bigint, bigint)',
    'public.artwork_hot(bigint, bigint, timestamptz, timestamptz)', 'public.artwork_code(bigint)',
    'public.artwork_title_violation(text)', 'public.artworks_require_unlock(uuid)', 'public.player_art_value_cents(uuid)',
    'public.artwork_gallery_start_cents(text)', 'public.artwork_json(uuid, uuid)', 'public.artwork_settle_auction(uuid)',
    'public.artworks_gallery_schedule(timestamptz)', 'public.artworks_run_due()', 'public.artworks_wipe_player(uuid, text)',
    'public.get_artworks(text, text, boolean, integer, integer)', 'public.get_artwork(uuid)', 'public.get_art_studio()',
    'public.get_art_rankings(integer)', 'public.get_collection(text)', 'public.create_artwork(uuid, text, jsonb)',
    'public.like_artwork(uuid, uuid, boolean)', 'public.start_auction(uuid, uuid, bigint, integer)',
    'public.cancel_auction(uuid, uuid)', 'public.bid_artwork(uuid, uuid, bigint)',
    'public.player_net_worth_cents(uuid)', 'public.rich_list_entries()', 'public.account_wipe(uuid, text)',
    'public.run_due_jobs()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_artworks(text, text, boolean, integer, integer)', 'public.get_artwork(uuid)', 'public.get_art_studio()',
    'public.get_art_rankings(integer)', 'public.get_collection(text)', 'public.create_artwork(uuid, text, jsonb)',
    'public.like_artwork(uuid, uuid, boolean)', 'public.start_auction(uuid, uuid, bigint, integer)',
    'public.cancel_auction(uuid, uuid)', 'public.bid_artwork(uuid, uuid, bigint)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
