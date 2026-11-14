-- ===== idempotent copy of migrations/20261204000800_nfts.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0800 · NFTs: royalties, AI collectors, offer chat (ADR-135)
-- =============================================================================
-- The pixel artworks of ADR-080 are called NFTs now (texts only: tables, RPCs and the route keep their names; the
-- display code becomes NFT-0042). New:
-- 1. Royalties: every resale (auction, fixed price, accepted offer, AI purchase) pays the creator
--    nfts.royaltyBps of the price, out of the proceeds, even if the creator no longer owns the NFT
--    (ledger kind artwork_royalty, artworks.royalties_cents, artwork_sales.royalty_cents, notification nft_royalty).
-- 2. Fixed price: the owner lists an NFT for a price (ask_cents); anyone buys it at that price (buy_artwork).
-- 3. Offer chat under every NFT (artwork_messages): text 1..nfts.chat.maxLength through the word filter, optional
--    price offer (no reservation, checked on accept), the owner accepts one (accept_artwork_offer).
-- 4. AI collectors (nfts_run_due, cron nexa-nfts every minute): value an NFT (nft_ai_value_cents: mint cost or last
--    price, likes, creator reputation, age), buy listings only at or below that value (households money), write
--    lowball offers in the chat, hold what they bought (ai_owner) and resell it, accepting good offers.
-- 5. Minting: 1.5 times the previous cost instead of double (balance.ts), mint XP (xp source nft_mint), mint_cents
--    stored as the collectors' anchor. Creators ranking (get_art_rankings.creators), sort "wanted" and "for_sale".
-- 6. Texts: unlock, notification types, missions and feed labels say NFT; new missions for NFTs.
--
-- RPCs (authenticated): get_artwork_chat(p_artwork_id uuid), post_artwork_message(p_request_id uuid,
--   p_artwork_id uuid, p_text text, p_offer_cents bigint default null), accept_artwork_offer(p_request_id uuid,
--   p_message_id bigint), set_artwork_price(p_request_id uuid, p_artwork_id uuid, p_ask_cents bigint),
--   buy_artwork(p_request_id uuid, p_artwork_id uuid, p_price_cents bigint).
-- Errors: nft_text_invalid NX121, nft_offer_closed NX122, nft_offer_unfunded NX123, nft_not_for_sale NX124,
--   nft_price_changed NX125.
-- Idempotent: runs unchanged as supabase/updates/20261204000800_nfts.sql.

-- ---------------------------------------------------------------------------
-- A. Enum values, notification types, texts
-- ---------------------------------------------------------------------------
-- (only used inside PL/pgSQL bodies, so they may be added in the same transaction)
alter type public.ledger_tx_kind add value if not exists 'artwork_royalty';
alter type public.xp_source add value if not exists 'nft_mint';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('nft_offer', 'social', 'Angebot für dein NFT', 'Jemand hat im Chat ein Preisangebot für dein NFT gemacht.', 'notif_bell',
        true, true, false, 296),
       ('nft_sale', 'social', 'NFT verkauft', 'Jemand hat dein NFT gekauft.', 'notif_bell', true, true, false, 297),
       ('nft_royalty', 'social', 'Lizenzgebühr', 'Dein NFT wurde weiterverkauft, du bekommst deinen Anteil.', 'notif_bell',
        true, false, false, 298)
on conflict (key) do nothing;
update public.notification_types set description = 'Jemand hat dein Gebot auf ein NFT überboten.'
 where key = 'art_outbid' and description <> 'Jemand hat dein Gebot auf ein NFT überboten.';
update public.unlocks
   set title = 'NFTs', description = 'Präge eigene Pixel-NFTs, sammle Unikate und verdiene an jedem Weiterverkauf.'
 where key = 'artworks' and title <> 'NFTs';

-- mission texts: Kunstwerk -> NFT
update public.mission_templates
   set title = replace(replace(replace(replace(title, 'Kunstwerken', 'NFTs'), 'Kunstwerke', 'NFTs'), 'Kunstwerk', 'NFT'),
                       'Male dein erstes NFT', 'Präge dein erstes NFT'),
       description = replace(replace(replace(replace(replace(description, 'Kunstwerke', 'NFTs'), 'Kunstwerk', 'NFT'),
                                             'Kunstmarkt', 'NFT-Markt'), 'Kunst-Editor', 'NFT-Editor'), 'Werke', 'NFTs'),
       updated_at = now()
 where title like '%Kunstwerk%' or description like '%Kunstwerk%' or description like '%Kunstmarkt%'
    or description like '%Kunst-Editor%' or (metric like 'art\_%' and description like '%Werke%');

-- feed labels (feed_item_label): "Kunstwerk „…“ gemalt" -> "NFT „…“ geprägt"
do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
begin
  if position('Kunstwerk „' in v_def) > 0 then
    v_def := replace(replace(v_def, '“ gemalt''', '“ geprägt'''), 'Kunstwerk „', 'NFT „');
    execute v_def;
  end if;
end;
$do$;

-- display code NFT-0042 (was ART-0042)
create or replace function public.artwork_code(p_serial bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'NFT-' || case when p_serial < 10000 then lpad(p_serial::text, 4, '0') else p_serial::text end;
$$;

-- ---------------------------------------------------------------------------
-- B. Tables
-- ---------------------------------------------------------------------------
alter table public.artworks add column if not exists mint_cents bigint;
alter table public.artworks add column if not exists ask_cents bigint;
alter table public.artworks add column if not exists listed_at timestamptz;
alter table public.artworks add column if not exists ai_owner text;
alter table public.artworks add column if not exists royalties_cents bigint not null default 0;
alter table public.artworks drop constraint if exists artworks_nft_check;
alter table public.artworks add constraint artworks_nft_check check (
  (mint_cents is null or mint_cents > 0) and (ask_cents is null or ask_cents > 0) and royalties_cents >= 0
  and (ai_owner is null or (owner_id is null and char_length(ai_owner) between 1 and 40)));
create index if not exists artworks_listed_idx on public.artworks (listed_at) where ask_cents is not null;
create index if not exists artworks_ai_owner_idx on public.artworks (ai_owner) where ai_owner is not null;
comment on column public.artworks.ask_cents is 'Fixed price ("Sofort kaufen", ADR-135); null = not for sale.';
comment on column public.artworks.ai_owner is 'Name of the AI collector holding it (owner_id null); null = a player or the gallery.';
comment on column public.artworks.mint_cents is 'What minting cost; the AI collectors'' anchor for a never-sold NFT (ADR-135).';
comment on column public.artworks.royalties_cents is 'Royalties paid to the creator from resales of this NFT so far (ADR-135).';

-- the mint cost of older player NFTs: the price of their position among the creator's NFTs
update public.artworks a set mint_cents = x.cost
  from (select y.id, public.artwork_create_cost_cents((row_number() over (partition by y.creator_id
                                                                      order by y.created_at, y.serial) - 1)::integer) as cost
          from public.artworks y where y.origin = 'player' and y.creator_id is not null) x
 where x.id = a.id and a.mint_cents is null;

alter table public.artwork_sales alter column auction_id drop not null;
alter table public.artwork_sales alter column buyer_id drop not null;
alter table public.artwork_sales add column if not exists kind text not null default 'auction';
alter table public.artwork_sales add column if not exists seller_ai text;
alter table public.artwork_sales add column if not exists buyer_ai text;
alter table public.artwork_sales add column if not exists royalty_cents bigint not null default 0;
alter table public.artwork_sales add column if not exists creator_id uuid;
alter table public.artwork_sales drop constraint if exists artwork_sales_nft_check;
alter table public.artwork_sales add constraint artwork_sales_nft_check check (
  kind in ('auction', 'buy', 'offer', 'ai') and royalty_cents >= 0 and (buyer_id is not null or buyer_ai is not null));
create index if not exists artwork_sales_creator_idx on public.artwork_sales (creator_id) where royalty_cents > 0;
create index if not exists artwork_sales_ai_idx on public.artwork_sales (at) where buyer_ai is not null;
comment on table public.artwork_sales is
  'Completed NFT sales (ADR-080, ADR-135): kind auction | buy (fixed price) | offer (accepted chat offer) | ai (AI '
  'collector bought). seller_id null = gallery or AI (seller_ai); buyer_ai = AI collector. fee_cents = what went to the '
  'households, royalty_cents = what the creator (creator_id) got. Internal (RPCs).';

create table if not exists public.artwork_messages (
  id           bigint generated always as identity primary key,
  artwork_id   uuid not null references public.artworks (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete cascade,
  ai_name      text check (ai_name is null or char_length(ai_name) between 1 and 40),
  kind         text not null default 'chat' check (kind in ('chat', 'offer', 'sale')),
  body         text not null check (char_length(body) between 1 and 200),
  offer_cents  bigint check (offer_cents is null or offer_cents > 0),
  offer_status text check (offer_status is null or offer_status in ('open', 'accepted', 'declined', 'closed', 'expired')),
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint artwork_messages_shape_check check (
    ((kind = 'offer') = (offer_status is not null)) and ((kind = 'chat') = (offer_cents is null))
    and (kind = 'sale' or ((author_id is null) <> (ai_name is null))))
);
alter table public.artwork_messages enable row level security;
revoke all on public.artwork_messages from public, anon, authenticated;
grant all on public.artwork_messages to service_role;
create index if not exists artwork_messages_artwork_idx on public.artwork_messages (artwork_id, id desc);
create index if not exists artwork_messages_author_idx on public.artwork_messages (author_id, created_at desc);
create index if not exists artwork_messages_open_idx on public.artwork_messages (artwork_id) where offer_status = 'open';
comment on table public.artwork_messages is
  'Offer chat under each NFT (ADR-135): chat lines, price offers (offer_status) and sale notes (kind sale: body = buyer, '
  'offer_cents = price). author_id = player, ai_name = AI collector. Internal; read through get_artwork_chat().';

-- ---------------------------------------------------------------------------
-- C. Error keys (NX121..NX125)
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''nft_price_changed''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'protest_own'                then 'NX120'
$q$, $q$    when 'protest_own'                then 'NX120'
    when 'nft_text_invalid'           then 'NX121'
    when 'nft_offer_closed'           then 'NX122'
    when 'nft_offer_unfunded'         then 'NX123'
    when 'nft_not_for_sale'           then 'NX124'
    when 'nft_price_changed'          then 'NX125'
$q$);
    if position('''nft_price_changed''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the NFT error keys by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- D. Rules (port of src/lib/sim/nfts.ts)
-- ---------------------------------------------------------------------------
create or replace function public.nfts_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'nfts'), '{}'::jsonb);
$$;

-- nftAiValueCents: anchor x (10 000 + likes, reputation and age bonuses) / 10 000, rounded down
create or replace function public.nft_ai_value_cents(p_artwork uuid, p_now timestamptz default null)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ai       jsonb := public.nfts_cfg() -> 'ai';
  a        public.artworks;
  v_anchor bigint;
  v_likes  bigint;
  v_sales  bigint := 0;
  v_days   bigint;
  v_bonus  bigint;
begin
  select * into a from public.artworks where id = p_artwork;
  if a.id is null then
    return null;
  end if;
  v_anchor := greatest(coalesce(a.value_cents, 0),
                       coalesce(a.mint_cents, case when a.origin = 'game' then public.artwork_gallery_start_cents(a.rarity) end, 0),
                       coalesce((ai ->> 'floorCents')::bigint, 100000));
  select count(*) into v_likes from public.artwork_likes l where l.artwork_id = a.id;
  if a.creator_id is not null then
    select count(*) into v_sales from public.artwork_sales s join public.artworks x on x.id = s.artwork_id
     where x.creator_id = a.creator_id;
  end if;
  v_days := greatest(0, floor(extract(epoch from (coalesce(p_now, public.game_now()) - a.created_at)) / 86400))::bigint;
  v_bonus := coalesce((ai ->> 'likeBps')::bigint, 400) * least(v_likes, coalesce((ai ->> 'maxLikes')::bigint, 40))
           + coalesce((ai ->> 'creatorSaleBps')::bigint, 300) * least(v_sales, coalesce((ai ->> 'maxCreatorSales')::bigint, 10))
           + coalesce((ai ->> 'ageBpsPerDay')::bigint, 100) * least(v_days, coalesce((ai ->> 'maxAgeDays')::bigint, 30));
  return floor(v_anchor::numeric * (10000 + v_bonus) / 10000)::bigint;
end;
$$;
comment on function public.nft_ai_value_cents(uuid, timestamptz) is
  'Internal: what the AI collectors think an NFT is worth (port of nftAiValueCents, ADR-135).';

-- nftLowballCents: lowballMin..lowballMax of the value, down to whole euros, at least minOfferCents
create or replace function public.nft_lowball_cents(p_value bigint, p_u double precision)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg   jsonb := public.nfts_cfg();
  v_min integer := (cfg #>> '{ai,lowballMinBps}')::integer;
  v_max integer := (cfg #>> '{ai,lowballMaxBps}')::integer;
  v_bps integer;
begin
  v_bps := v_min + floor(least(greatest(coalesce(p_u, 0), 0), 0.999999) * (v_max - v_min))::integer;
  return greatest((cfg ->> 'minOfferCents')::bigint, (floor(p_value::numeric * v_bps / 10000 / 100) * 100)::bigint);
end;
$$;

-- nftAiAskCents: value x resaleMarkup, up to whole euros
create or replace function public.nft_ai_ask_cents(p_value bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (ceil(p_value::numeric * (public.nfts_cfg() #>> '{ai,resaleMarkupBps}')::integer / 10000 / 100) * 100)::bigint;
$$;

-- a random element of a text array in the config (AI names and lines)
create or replace function public.nft_pick(p_path text[], p_u double precision)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select (public.nfts_cfg() #> p_path) ->> least(jsonb_array_length(public.nfts_cfg() #> p_path) - 1,
                                                 floor(greatest(p_u, 0) * jsonb_array_length(public.nfts_cfg() #> p_path))::integer);
$$;

-- The creator's royalty on a sale by p_seller (null = gallery or AI) to p_buyer: royaltyBps of the price, rounded down;
-- 0 when the creator sells or buys, there is no creator or the creator's cash account cannot receive money.
create or replace function public.nft_royalty_for(p_artwork uuid, p_seller uuid, p_buyer uuid, p_price bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
begin
  select a.creator_id into v_creator from public.artworks a where a.id = p_artwork;
  if v_creator is null or v_creator = p_seller or v_creator = p_buyer or coalesce(p_price, 0) <= 0
     or not exists (select 1 from public.ledger_accounts x where x.owner_player_id = v_creator and x.kind = 'player_cash'
                      and not x.is_frozen) then
    return 0;
  end if;
  return floor(p_price::numeric * (public.nfts_cfg() ->> 'royaltyBps')::integer / 10000)::bigint;
end;
$$;

-- Pays the royalty from the account that holds the proceeds (escrow, buyer or households) to the creator
create or replace function public.nft_pay_royalty(p_artwork uuid, p_from uuid, p_royalty bigint, p_price bigint, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.artworks;
begin
  if coalesce(p_royalty, 0) <= 0 then
    return;
  end if;
  select * into a from public.artworks where id = p_artwork;
  perform public.ledger_transfer(p_from, public.ledger_player_account(a.creator_id, 'player_cash'), p_royalty,
                                 'artwork_royalty', 'Lizenzgebühr für ein NFT', 'artwork', a.id, p_key || ':royalty',
                                 a.creator_id, jsonb_build_object('price_cents', p_price, 'royalty_cents', p_royalty));
  perform public.loan_withhold(a.creator_id, p_royalty, p_key || ':royalty');
  update public.artworks set royalties_cents = royalties_cents + p_royalty where id = a.id;
  perform public.social_notify(a.creator_id, 'nft_royalty', 'Lizenzgebühr: ' || public.format_eur(p_royalty),
    '„' || a.title || '“ (' || public.artwork_code(a.serial) || ') wurde für ' || public.format_eur(p_price) || ' weiterverkauft.',
    jsonb_build_object('artwork_id', a.id, 'code', public.artwork_code(a.serial), 'title', a.title,
                       'price_cents', p_price, 'royalty_cents', p_royalty),
    '/artworks', 'nft_royalty:' || p_key);
  perform public.mission_event(a.creator_id, 'nft_royalty', 1, null);
end;
$$;

-- An AI collector writes in the chat of an NFT
create or replace function public.nft_ai_post(p_artwork uuid, p_name text, p_kind text, p_body text, p_offer bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.artwork_messages (artwork_id, ai_name, kind, body, offer_cents, offer_status, expires_at, created_at)
  values (p_artwork, p_name, p_kind, left(p_body, 200), p_offer, case when p_kind = 'offer' then 'open' end,
          case when p_kind = 'offer'
               then public.game_now() + make_interval(hours => (public.nfts_cfg() #>> '{chat,offerHours}')::integer) end,
          public.game_now())
  returning id into v_id;
  return v_id;
end;
$$;

-- The owner (a player) hears about an offer in the chat
create or replace function public.nft_notify_offer(p_message bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.artwork_messages;
  a public.artworks;
  v_from text;
begin
  select * into m from public.artwork_messages where id = p_message;
  select * into a from public.artworks where id = m.artwork_id;
  if a.owner_id is null or m.offer_cents is null then
    return;
  end if;
  v_from := coalesce(m.ai_name, (select p.nickname from public.profiles p where p.id = m.author_id), 'Jemand');
  perform public.social_notify(a.owner_id, 'nft_offer', v_from || ' bietet ' || public.format_eur(m.offer_cents),
    '„' || a.title || '“ (' || public.artwork_code(a.serial) || '): ' || m.body,
    jsonb_build_object('artwork_id', a.id, 'code', public.artwork_code(a.serial), 'title', a.title,
                       'amount_cents', m.offer_cents, 'nickname', v_from, 'message_id', m.id),
    '/artworks', 'nft_offer:' || m.id::text);
end;
$$;

-- After every sale: owner and value, the sale row, open offers closed, a sale note in the chat, the seller's
-- notification (not for auctions, they end on a known time), missions. p_auction null = direct sale.
create or replace function public.nft_after_sale(p_artwork uuid, p_seller uuid, p_seller_ai text, p_buyer uuid, p_buyer_ai text,
                                                 p_price bigint, p_fee bigint, p_royalty bigint, p_kind text,
                                                 p_auction uuid, p_accepted bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       public.artworks;
  v_buyer text;
  v_now   timestamptz := public.game_now();
begin
  v_buyer := coalesce(p_buyer_ai, (select p.nickname from public.profiles p where p.id = p_buyer), 'Ehemaliger Spieler');
  update public.artworks
     set owner_id = p_buyer, ai_owner = p_buyer_ai, value_cents = p_price, ask_cents = null, listed_at = null
   where id = p_artwork
  returning * into a;
  insert into public.artwork_sales (artwork_id, auction_id, seller_id, buyer_id, seller_ai, buyer_ai, price_cents, fee_cents,
                                    royalty_cents, creator_id, kind, at)
  values (a.id, p_auction, p_seller, p_buyer, p_seller_ai, p_buyer_ai, p_price, p_fee, p_royalty,
          case when p_royalty > 0 then a.creator_id end, p_kind, v_now);
  -- an AI collector offers what it bought at its valuation (this sale included) x resaleMarkup
  if p_buyer_ai is not null then
    update public.artworks set ask_cents = public.nft_ai_ask_cents(public.nft_ai_value_cents(a.id, v_now)), listed_at = v_now
     where id = a.id;
  end if;
  update public.artwork_messages set offer_status = 'closed'
   where artwork_id = a.id and offer_status = 'open' and id is distinct from p_accepted;
  insert into public.artwork_messages (artwork_id, kind, body, offer_cents, created_at)
  values (a.id, 'sale', left(v_buyer, 200), p_price, v_now);
  if p_kind <> 'auction' then
    if p_seller is not null then
      perform public.social_notify(p_seller, 'nft_sale', '„' || a.title || '“ verkauft',
        v_buyer || ' hat dein NFT ' || public.artwork_code(a.serial) || ' für ' || public.format_eur(p_price) || ' gekauft.',
        jsonb_build_object('artwork_id', a.id, 'code', public.artwork_code(a.serial), 'title', a.title,
                           'price_cents', p_price, 'buyer', v_buyer),
        '/artworks', 'nft_sale:' || a.id::text || ':' || extract(epoch from v_now)::bigint::text);
      perform public.mission_event(p_seller, 'art_sold', 1, null);
    end if;
    if p_buyer is not null then
      perform public.mission_event(p_buyer, 'nft_bought', 1, null);
    end if;
  end if;
end;
$$;

-- A direct sale (fixed price, accepted offer, AI purchase or AI resale) at p_price: the buyer (a player, or the
-- households for an AI collector) pays; the seller gets the price minus fee and royalty (an AI seller's or a frozen
-- seller's part goes to the households), the creator the royalty. -> {price_cents, fee_cents, royalty_cents}
create or replace function public.nft_sell(p_artwork uuid, p_buyer uuid, p_buyer_ai text, p_price bigint, p_kind text,
                                           p_key text, p_accepted bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         public.artworks;
  v_from    uuid;
  v_to      uuid;
  v_house   uuid := public.ledger_system_account('households');
  v_royalty bigint;
  v_fee     bigint;
  v_raw     jsonb;
  v_entries jsonb;
begin
  select * into a from public.artworks where id = p_artwork for update;
  if a.id is null then
    perform public.api_error('artwork_not_found');
  end if;
  if a.owner_id is null and a.ai_owner is null then
    perform public.api_error('forbidden');
  end if;
  if exists (select 1 from public.artwork_auctions x where x.artwork_id = a.id and x.status = 'open') then
    perform public.api_error('already_on_auction');
  end if;
  if (p_buyer is null) = (p_buyer_ai is null) or p_buyer = a.owner_id or coalesce(p_price, 0) <= 0 then
    perform public.api_error('invalid_argument');
  end if;
  v_from := case when p_buyer is not null then public.ledger_player_account(p_buyer, 'player_cash') else v_house end;
  if a.owner_id is not null then
    select x.id into v_to from public.ledger_accounts x
     where x.owner_player_id = a.owner_id and x.kind = 'player_cash' and not x.is_frozen;
  end if;
  v_royalty := public.nft_royalty_for(a.id, a.owner_id, p_buyer, p_price);
  if v_to is null then
    v_fee := p_price - v_royalty;
    v_raw := jsonb_build_array(jsonb_build_object('account_id', v_from, 'amount_cents', -(p_price - v_royalty)),
                               jsonb_build_object('account_id', v_house, 'amount_cents', p_price - v_royalty));
  else
    v_fee := floor(p_price::numeric * public.config_double('artworks', '{auction,feeBps}', 1000)::integer / 10000)::bigint;
    v_raw := jsonb_build_array(jsonb_build_object('account_id', v_from, 'amount_cents', -(p_price - v_royalty)),
                               jsonb_build_object('account_id', v_to, 'amount_cents', p_price - v_fee - v_royalty),
                               jsonb_build_object('account_id', v_house, 'amount_cents', v_fee));
  end if;
  -- one entry per account (the households can be buyer and fee receiver at once)
  select coalesce(jsonb_agg(jsonb_build_object('account_id', x.acc, 'amount_cents', x.amt) order by x.acc), '[]'::jsonb)
    into v_entries
    from (select (e ->> 'account_id')::uuid as acc, sum((e ->> 'amount_cents')::bigint)::bigint as amt
            from jsonb_array_elements(v_raw) e group by 1 having sum((e ->> 'amount_cents')::bigint) <> 0) x;
  begin
    if jsonb_array_length(v_entries) >= 2 then
      perform public.ledger_post('artwork_sale', v_entries, 'NFT verkauft', 'artwork', a.id, p_key, p_buyer,
                                 jsonb_build_object('price_cents', p_price, 'fee_cents', v_fee, 'royalty_cents', v_royalty,
                                                    'kind', p_kind, 'buyer_ai', p_buyer_ai, 'seller_ai', a.ai_owner));
    end if;
    perform public.nft_pay_royalty(a.id, v_from, v_royalty, p_price, p_key);
  exception when sqlstate 'NX001' then
    perform public.api_error('insufficient_funds');
  end;
  if v_to is not null then
    perform public.loan_withhold(a.owner_id, p_price - v_fee - v_royalty, p_key);
  end if;
  perform public.nft_after_sale(a.id, a.owner_id, a.ai_owner, p_buyer, p_buyer_ai, p_price, v_fee, v_royalty, p_kind, null,
                                p_accepted);
  return jsonb_build_object('price_cents', p_price, 'fee_cents', v_fee, 'royalty_cents', v_royalty);
end;
$$;
comment on function public.nft_sell(uuid, uuid, text, bigint, text, text, bigint) is
  'Internal: direct sale of an NFT with fee and creator royalty (ADR-135). Errors artwork_not_found, forbidden, '
  'already_on_auction, invalid_argument, insufficient_funds.';

-- ---------------------------------------------------------------------------
-- E. Redefined artwork functions (latest definitions of ADR-080 / ADR-100, extended)
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
    'ai_owner', a.ai_owner,
    'pixels', jsonb_build_object('palette', a.pixels -> 'palette', 'grid', a.pixels -> 'grid'),
    'value_cents', a.value_cents,
    'ask_cents', a.ask_cents,
    'royalty_bps', (public.nfts_cfg() ->> 'royaltyBps')::integer,
    'royalties_cents', a.royalties_cents,
    'offers', (select count(*) from public.artwork_messages m
                where m.artwork_id = a.id and m.offer_status = 'open' and m.expires_at > v_now),
    'best_offer_cents', (select max(m.offer_cents) from public.artwork_messages m
                          where m.artwork_id = a.id and m.offer_status = 'open' and m.expires_at > v_now),
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
comment on function public.artwork_json(uuid, uuid) is
  'ARTWORK as seen by p_viewer (liked, my_bid_cents); docs/ARTWORKS.md section 8, NFT fields of ADR-135.';

-- Closes one auction if it is open and due: the leader gets the NFT, the creator the royalty (ADR-135), the seller
-- the rest minus the fee, the households the fee (gallery: everything but the royalty); without a bid the NFT stays.
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
  v_royalty bigint;
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
  v_royalty := public.nft_royalty_for(au.artwork_id, case when au.by_gallery then null else au.seller_id end, au.leader_id,
                                       au.current_cents);
  -- seller: a player whose cash account can still receive money, else the households take it all
  if not au.by_gallery and au.seller_id is not null then
    select a.id into v_seller from public.ledger_accounts a
     where a.owner_player_id = au.seller_id and a.kind = 'player_cash' and not a.is_frozen;
  end if;
  if v_seller is null then
    v_fee := au.current_cents - v_royalty;
    v_entries := jsonb_build_array(jsonb_build_object('account_id', v_escrow, 'amount_cents', -(au.current_cents - v_royalty)),
                                   jsonb_build_object('account_id', v_house, 'amount_cents', au.current_cents - v_royalty));
  else
    v_fee := floor(au.current_cents * public.config_double('artworks', '{auction,feeBps}', 1000)::integer / 10000.0)::bigint;
    v_entries := jsonb_build_array(jsonb_build_object('account_id', v_escrow, 'amount_cents', -(au.current_cents - v_royalty)),
                                   jsonb_build_object('account_id', v_seller, 'amount_cents', au.current_cents - v_fee - v_royalty));
    if v_fee > 0 then
      v_entries := v_entries || jsonb_build_object('account_id', v_house, 'amount_cents', v_fee);
    end if;
  end if;
  perform public.ledger_post('artwork_sale', v_entries, 'NFT versteigert', 'artwork_auction', au.id, v_key, au.leader_id,
                             jsonb_build_object('price_cents', au.current_cents, 'fee_cents', v_fee, 'royalty_cents', v_royalty,
                                                'artwork_id', au.artwork_id));
  perform public.nft_pay_royalty(au.artwork_id, v_escrow, v_royalty, au.current_cents, v_key);
  if v_seller is not null then
    perform public.loan_withhold(au.seller_id, au.current_cents - v_fee - v_royalty, v_key);
  end if;

  update public.artwork_auctions set status = 'sold', closed_at = v_now where id = au.id;
  perform public.nft_after_sale(au.artwork_id, case when au.by_gallery then null else au.seller_id end, null, au.leader_id, null,
                                au.current_cents, v_fee, v_royalty, 'auction', au.id, null);

  perform public.mission_event(au.leader_id, 'art_won', 1, null);
  if not au.by_gallery then
    perform public.mission_event(au.seller_id, 'art_sold', 1, null);
  end if;
  return 'sold';
end;
$$;
comment on function public.artwork_settle_auction(uuid) is
  'Internal: closes one due NFT auction (sale with fee and creator royalty, or unsold).';

-- The feed post of a big purchase: direct sales have no auction id
create or replace function public.feed_on_art_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.artworks;
begin
  if new.price_cents < public.config_bigint('social', '{feed,artMinPriceCents}', 1000000) or new.buyer_id is null then
    return null;
  end if;
  select * into a from public.artworks x where x.id = new.artwork_id;
  perform public.feed_post(new.buyer_id, 'art_won',
    jsonb_build_object('title', a.title, 'code', public.artwork_code(a.serial), 'price_cents', new.price_cents),
    'art_won:' || coalesce(new.auction_id::text, 'sale:' || new.id::text));
  return null;
end;
$$;

-- The gallery auctions only NFTs nobody holds (not those of AI collectors)
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
     where a.owner_id is null and a.ai_owner is null
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
  'Internal: starts the gallery auctions due today (artworks.gallery, ADR-080), not of NFTs AI collectors hold. Idempotent.';

-- Account reset/delete: also the listings and the open offers of the player end (ADR-135)
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
  update public.artwork_messages m set offer_status = 'closed'
   where m.offer_status = 'open'
     and (m.author_id = p_player or m.artwork_id in (select a.id from public.artworks a where a.owner_id = p_player));
  update public.artworks set owner_id = null, ask_cents = null, listed_at = null where owner_id = p_player;
  delete from public.artwork_likes where player_id = p_player;
end;
$$;
comment on function public.artworks_wipe_player(uuid, text) is
  'Internal (account_wipe): releases the NFTs, auctions, bids, listings and offers of a player.';

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
  if v_sort not in ('hot', 'price', 'new', 'ending', 'wanted', 'for_sale') or v_origin not in ('all', 'game', 'player') then
    perform public.api_error('invalid_argument');
  end if;
  with base as (
    select a.id, a.serial, a.created_at,
           coalesce(au.current_cents, a.value_cents, au.start_cents) as price,
           au.ends_at, a.ask_cents,
           (select count(*) from public.artwork_messages m
             where m.artwork_id = a.id and m.offer_status = 'open' and m.expires_at > v_now) as offers,
           (select max(m.offer_cents) from public.artwork_messages m
             where m.artwork_id = a.id and m.offer_status = 'open' and m.expires_at > v_now) as best_offer,
           public.artwork_hot((select count(*) from public.artwork_likes l where l.artwork_id = a.id),
                              coalesce(au.bids, 0), a.created_at, v_now) as hot
      from public.artworks a
      left join public.artwork_auctions au on au.artwork_id = a.id and au.status = 'open'
     where (v_origin = 'all' or a.origin = v_origin)
       and (not v_auction or au.id is not null)
       and (v_sort <> 'for_sale' or (a.ask_cents is not null and au.id is null))
  ), ordered as (
    select b.id,
           row_number() over (order by
             case when v_sort = 'hot' then b.hot end desc nulls last,
             case when v_sort = 'price' then b.price end desc nulls last,
             case when v_sort = 'new' then b.created_at end desc nulls last,
             case when v_sort = 'ending' then b.ends_at end asc nulls last,
             case when v_sort = 'wanted' then b.offers end desc nulls last,
             case when v_sort = 'wanted' then b.best_offer end desc nulls last,
             case when v_sort = 'for_sale' then b.ask_cents end asc nulls last,
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
  'RPC: marketplace page {server_time, total, entries: [ARTWORK]}; sort hot|price|new|ending|wanted|for_sale '
  '(for_sale: only fixed-price listings, cheapest first), origin all|game|player (ADR-080, ADR-135).';

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
                         'seller', case when s.seller_id is null then s.seller_ai
                                        else coalesce(ps.nickname, 'Ehemaliger Spieler') end,
                         'buyer', coalesce(s.buyer_ai, pb.nickname, 'Ehemaliger Spieler'),
                         'kind', s.kind, 'royalty_cents', s.royalty_cents) order by s.at desc, s.id desc)
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
  'RPC: {artwork: ARTWORK, sales: [{at, price_cents, seller, buyer, kind, royalty_cents}], bids: [{nickname, amount_cents, at}]} '
  '(ADR-080, ADR-135).';

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
    'next_cost_cents', public.player_artwork_create_cost_cents(v_player, v_painted),
    'unlocked', coalesce((select p.level from public.profiles p where p.id = v_player), 1) >= public.unlock_level('artworks'),
    'royalties_cents', coalesce((select sum(a.royalties_cents) from public.artworks a where a.creator_id = v_player), 0)::bigint,
    'royalty_bps', (public.nfts_cfg() ->> 'royaltyBps')::integer,
    'mint_xp', (public.nfts_cfg() ->> 'mintXp')::integer);
end;
$$;
comment on function public.get_art_studio() is
  'RPC: {painted, next_cost_cents, unlocked, royalties_cents, royalty_bps, mint_xp} for the NFT studio (ADR-080, ADR-100, ADR-135).';

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
               order by a.value_cents desc, a.serial limit v_limit) t), '[]'::jsonb),
    -- creators by royalties earned (ADR-135)
    'creators', coalesce((
      select jsonb_agg(jsonb_build_object('rank', c.rnk, 'nickname', c.nickname, 'avatar_key', c.avatar_key,
                                          'count', c.n, 'royalties_cents', c.roy, 'is_me', c.creator_id = v_player) order by c.rnk)
        from (select x.*, row_number() over (order by x.roy desc, x.n desc, lower(x.nickname)) as rnk
                from (select a.creator_id, p.nickname, p.avatar_key, count(*) as n,
                             coalesce(sum(a.royalties_cents), 0)::bigint as roy
                        from public.artworks a join public.profiles p on p.id = a.creator_id
                       where not p.is_deactivated and a.origin = 'player'
                       group by a.creator_id, p.nickname, p.avatar_key) x) c
       where c.rnk <= v_limit), '[]'::jsonb));
end;
$$;
comment on function public.get_art_rankings(integer) is
  'RPC: largest collections, most valuable NFTs and creators by royalties (ADR-080, ADR-135).';

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
    'created', (select count(*) from public.artworks a where a.creator_id = v_target),
    'royalties_cents', coalesce((select sum(a.royalties_cents) from public.artworks a where a.creator_id = v_target), 0)::bigint,
    'artworks', coalesce((select jsonb_agg(public.artwork_json(a.id, v_player)
                                           order by a.value_cents desc nulls last, a.created_at desc, a.serial desc)
                            from public.artworks a where a.owner_id = v_target), '[]'::jsonb));
end;
$$;
comment on function public.get_collection(text) is
  'RPC: {nickname, count, value_cents, created, royalties_cents, artworks: [ARTWORK]} of a player (ADR-080, ADR-135).';

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
  v_xp      integer;
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
  -- unique titles (ADR-100): lookalikes count as the same title; the lock serialises two painters of one title
  perform pg_advisory_xact_lock(hashtextextended('artwork_title:' || public.name_key(v_title), 0));
  if public.artwork_title_taken(v_title) then
    perform public.api_error('name_taken');
  end if;
  if public.logo_has_forbidden_symbol(p_pixels -> 'grid') then
    perform public.api_error('logo_forbidden');
  end if;
  -- one painting at a time per player (the count decides the price)
  perform 1 from public.profiles p where p.id = v_player for update;
  select count(*) into v_painted from public.artworks a where a.creator_id = v_player;
  -- artist upgrade (ADR-100): the price x (10 000 − artDiscountBps) / 10 000
  v_cost := public.player_artwork_create_cost_cents(v_player, v_painted);
  v_cash := public.lock_player_accounts(v_player);
  if v_cash < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('treasury'),
                                 v_cost, 'artwork_creation', 'NFT geprägt', 'artwork', v_id,
                                 'art:create:' || v_id::text, v_player, jsonb_build_object('painted_before', v_painted,
                                                                   'discount_bps', public.player_art_discount_bps(v_player)));
  insert into public.artworks (id, title, origin, rarity, creator_id, owner_id, pixels, mint_cents)
  values (v_id, v_title, 'player', null, v_player, v_player,
          jsonb_build_object('palette', p_pixels -> 'palette', 'grid', p_pixels -> 'grid'), v_cost);
  perform public.mission_event(v_player, 'art_painted', 1, null);
  -- minting is worth XP (ADR-135)
  v_xp := public.grant_xp(v_player, 'nft_mint', coalesce((public.nfts_cfg() ->> 'mintXp')::integer, 0),
                          'nft_mint:' || v_id::text, 'artwork', v_id);
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'artwork', public.artwork_json(v_id, v_player),
    'cost_cents', v_cost,
    'xp', coalesce(v_xp, 0),
    'next_cost_cents', public.player_artwork_create_cost_cents(v_player, v_painted + 1)));
end;
$$;
comment on function public.create_artwork(uuid, text, jsonb) is
  'RPC: mints a new NFT (cost x1.5 per NFT, less the artist upgrade, paid to the treasury; mint XP); errors artworks_locked, '
  'invalid_argument, name_* (name_taken: the title or a lookalike exists), logo_forbidden, insufficient_funds.';

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
  -- an auction replaces the fixed price (ADR-135)
  update public.artworks set ask_cents = null, listed_at = null where id = a.id and ask_cents is not null;
  insert into public.artwork_auctions (artwork_id, seller_id, by_gallery, start_cents, ends_at, created_at)
  values (a.id, v_player, false, p_start_cents, v_now + make_interval(hours => p_hours), v_now);
  perform public.mission_event(v_player, 'art_auction_started', 1, null);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('artwork', public.artwork_json(a.id, v_player)));
end;
$$;
comment on function public.start_auction(uuid, uuid, bigint, integer) is
  'RPC: the owner offers an NFT at auction (start >= artworks.auction.minStartCents, hours in durationsHours; ends a '
  'fixed price); errors forbidden, already_on_auction.';

-- ---------------------------------------------------------------------------
-- F. Offer chat, fixed price and buying (RPCs)
-- ---------------------------------------------------------------------------
create or replace function public.nft_chat_json(p_artwork uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'artwork_id', a.id,
    'is_owner', a.owner_id is not distinct from p_viewer,
    'ask_cents', a.ask_cents,
    'min_offer_cents', (public.nfts_cfg() ->> 'minOfferCents')::bigint,
    'max_length', (public.nfts_cfg() #>> '{chat,maxLength}')::integer,
    'my_offer_cents', (select m.offer_cents from public.artwork_messages m
                        where m.artwork_id = a.id and m.author_id = p_viewer and m.offer_status = 'open'
                          and m.expires_at > public.game_now() order by m.id desc limit 1),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'author', coalesce(m.ai_name, p.nickname, case when m.kind <> 'sale' then 'Ehemaliger Spieler' end),
               'ai', m.ai_name is not null,
               'kind', m.kind,
               'text', m.body,
               'offer_cents', m.offer_cents,
               'offer_status', case when m.offer_status = 'open' and m.expires_at <= public.game_now() then 'expired'
                                    else m.offer_status end,
               'expires_at', m.expires_at,
               'at', m.created_at,
               'mine', m.author_id is not distinct from p_viewer and m.author_id is not null) order by m.id)
        from (select * from public.artwork_messages x where x.artwork_id = a.id order by x.id desc
               limit (public.nfts_cfg() #>> '{chat,history}')::integer) m
        left join public.profiles p on p.id = m.author_id), '[]'::jsonb))
  from public.artworks a where a.id = p_artwork;
$$;

create or replace function public.get_artwork_chat(p_artwork_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  v_player := public.require_player();
  if p_artwork_id is null or not exists (select 1 from public.artworks a where a.id = p_artwork_id) then
    perform public.api_error('artwork_not_found');
  end if;
  return public.nft_chat_json(p_artwork_id, v_player);
end;
$$;

create or replace function public.post_artwork_message(p_request_id uuid, p_artwork_id uuid, p_text text,
                                                       p_offer_cents bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nfts_cfg();
  v_player uuid;
  v_replay jsonb;
  v_text   text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  a        public.artworks;
  v_cash   bigint;
  v_id     bigint;
begin
  v_player := public.require_player();
  perform public.artworks_require_unlock(v_player);
  if p_request_id is null or p_artwork_id is null then
    perform public.api_error('invalid_argument');
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > (cfg #>> '{chat,maxLength}')::integer
     or public.text_has_profanity(v_text) then
    perform public.api_error('nft_text_invalid');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'post_artwork_message');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into a from public.artworks where id = p_artwork_id;
  if a.id is null then
    perform public.api_error('artwork_not_found');
  end if;
  -- one writer at a time, at most perMinute messages a minute
  perform 1 from public.profiles p where p.id = v_player for update;
  if (select count(*) from public.artwork_messages m
       where m.author_id = v_player and m.created_at > public.game_now() - interval '1 minute')
     >= (cfg #>> '{chat,perMinute}')::integer then
    perform public.api_error('rate_limited');
  end if;
  if p_offer_cents is null then
    insert into public.artwork_messages (artwork_id, author_id, kind, body, created_at)
    values (a.id, v_player, 'chat', v_text, public.game_now());
  else
    if a.owner_id = v_player then
      perform public.api_error('own_artwork');
    end if;
    if a.owner_id is null and a.ai_owner is null then
      perform public.api_error('forbidden');
    end if;
    if p_offer_cents < (cfg ->> 'minOfferCents')::bigint then
      perform public.api_error('bid_too_low');
    end if;
    select x.balance_cents into v_cash from public.ledger_accounts x where x.owner_player_id = v_player and x.kind = 'player_cash';
    if coalesce(v_cash, 0) < p_offer_cents then
      perform public.api_error('insufficient_funds');
    end if;
    -- a new offer replaces the own older one
    update public.artwork_messages set offer_status = 'closed'
     where artwork_id = a.id and author_id = v_player and offer_status = 'open';
    insert into public.artwork_messages (artwork_id, author_id, kind, body, offer_cents, offer_status, expires_at, created_at)
    values (a.id, v_player, 'offer', v_text, p_offer_cents, 'open',
            public.game_now() + make_interval(hours => (cfg #>> '{chat,offerHours}')::integer), public.game_now())
    returning id into v_id;
    perform public.nft_notify_offer(v_id);
    perform public.mission_event(v_player, 'nft_offer', 1, a.id::text);
  end if;
  perform public.mission_event(v_player, 'nft_chat', 1, a.id::text);
  return public.request_complete(v_player, p_request_id, public.nft_chat_json(a.id, v_player));
end;
$$;

create or replace function public.accept_artwork_offer(p_request_id uuid, p_message_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  m        public.artwork_messages;
  a        public.artworks;
  v_cash   bigint;
  v_res    jsonb;
begin
  v_player := public.require_player();
  perform public.artworks_require_unlock(v_player);
  if p_request_id is null or p_message_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'accept_artwork_offer');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into m from public.artwork_messages where id = p_message_id;
  if m.id is null or m.kind <> 'offer' then
    perform public.api_error('nft_offer_closed');
  end if;
  select * into a from public.artworks where id = m.artwork_id for update;
  if a.owner_id is distinct from v_player then
    perform public.api_error('forbidden');
  end if;
  select * into m from public.artwork_messages where id = p_message_id for update;
  if m.offer_status <> 'open' or m.expires_at <= public.game_now() then
    perform public.api_error('nft_offer_closed');
  end if;
  if exists (select 1 from public.artwork_auctions x where x.artwork_id = a.id and x.status = 'open') then
    perform public.api_error('already_on_auction');
  end if;
  if m.author_id is not null then
    select x.balance_cents into v_cash from public.ledger_accounts x where x.owner_player_id = m.author_id and x.kind = 'player_cash';
  else
    select x.balance_cents into v_cash from public.ledger_accounts x where x.id = public.ledger_system_account('households');
  end if;
  if coalesce(v_cash, 0) < m.offer_cents then
    perform public.api_error('nft_offer_unfunded');
  end if;
  update public.artwork_messages set offer_status = 'accepted' where id = m.id;
  begin
    v_res := public.nft_sell(a.id, m.author_id, m.ai_name, m.offer_cents, case when m.ai_name is null then 'offer' else 'ai' end,
                             'art:offer:' || m.id::text, m.id);
  exception when sqlstate 'NX001' then
    perform public.api_error('nft_offer_unfunded');
  end;
  if m.ai_name is not null then
    perform public.nft_ai_post(a.id, m.ai_name, 'chat', public.nft_pick('{ai,lines,buy}', random()), null);
  end if;
  return public.request_complete(v_player, p_request_id,
    jsonb_build_object('artwork', public.artwork_json(a.id, v_player)) || v_res);
end;
$$;

create or replace function public.set_artwork_price(p_request_id uuid, p_artwork_id uuid, p_ask_cents bigint)
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
  if p_request_id is null or p_artwork_id is null
     or (p_ask_cents is not null and p_ask_cents < (public.nfts_cfg() ->> 'minAskCents')::bigint) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_artwork_price');
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
  update public.artworks
     set ask_cents = p_ask_cents, listed_at = case when p_ask_cents is null then null else public.game_now() end
   where id = a.id;
  if p_ask_cents is not null then
    perform public.mission_event(v_player, 'nft_listed', 1, a.id::text);
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('artwork', public.artwork_json(a.id, v_player)));
end;
$$;

create or replace function public.buy_artwork(p_request_id uuid, p_artwork_id uuid, p_price_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  a        public.artworks;
  v_cash   bigint;
  v_res    jsonb;
begin
  v_player := public.require_player();
  perform public.artworks_require_unlock(v_player);
  if p_request_id is null or p_artwork_id is null or p_price_cents is null or p_price_cents < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_artwork');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into a from public.artworks where id = p_artwork_id for update;
  if a.id is null then
    perform public.api_error('artwork_not_found');
  end if;
  if a.owner_id = v_player then
    perform public.api_error('own_artwork');
  end if;
  if a.ask_cents is null or (a.owner_id is null and a.ai_owner is null)
     or exists (select 1 from public.artwork_auctions x where x.artwork_id = a.id and x.status = 'open') then
    perform public.api_error('nft_not_for_sale');
  end if;
  if a.ask_cents <> p_price_cents then
    perform public.api_error('nft_price_changed');
  end if;
  v_cash := public.lock_player_accounts(v_player);
  if v_cash < a.ask_cents then
    perform public.api_error('insufficient_funds');
  end if;
  v_res := public.nft_sell(a.id, v_player, null, a.ask_cents, 'buy', 'art:buy:' || p_request_id::text);
  if a.ai_owner is not null then
    perform public.nft_ai_post(a.id, a.ai_owner, 'chat', public.nft_pick('{ai,lines,accept}', random()), null);
  end if;
  return public.request_complete(v_player, p_request_id,
    jsonb_build_object('artwork', public.artwork_json(a.id, v_player)) || v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- G. AI collectors (cron nexa-nfts, every minute)
-- ---------------------------------------------------------------------------
create or replace function public.nfts_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.nfts_cfg();
  ai        jsonb := public.nfts_cfg() -> 'ai';
  v_now     timestamptz := coalesce(p_now, public.game_now());
  v_day     timestamptz := ((coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date)::timestamp
                           at time zone 'Europe/Berlin';
  v_house   uuid := public.ledger_system_account('households');
  v_buys    integer;
  v_msgs    integer := 0;
  v_sold    integer := 0;
  v_answers integer := 0;
  v_expired integer;
  v_value   bigint;
  v_name    text;
  v_id      bigint;
  v_cash    bigint;
  a         public.artworks;
  r         record;
begin
  if cfg = '{}'::jsonb or ai is null then
    return jsonb_build_object('skipped', 'no config');
  end if;
  update public.artwork_messages set offer_status = 'expired' where offer_status = 'open' and expires_at <= v_now;
  get diagnostics v_expired = row_count;
  select count(*) into v_buys from public.artwork_sales s where s.buyer_ai is not null and s.at >= v_day;

  -- 1. fixed-price listings of players: bought at a good price, else maybe a lowball offer
  for r in select x.id, x.ask_cents from public.artworks x
            where x.ask_cents is not null and x.owner_id is not null
              and not exists (select 1 from public.artwork_auctions au where au.artwork_id = x.id and au.status = 'open')
            order by x.listed_at, x.id limit 100 loop
    select * into a from public.artworks where id = r.id for update skip locked;
    continue when a.id is null or a.ask_cents is distinct from r.ask_cents or a.owner_id is null;
    v_value := public.nft_ai_value_cents(a.id, v_now);
    if a.ask_cents <= v_value then
      continue when v_buys >= (ai ->> 'maxBuysPerDay')::integer or random() * 10000 >= (ai ->> 'buyChanceBps')::integer;
      select x.balance_cents into v_cash from public.ledger_accounts x where x.id = v_house;
      continue when coalesce(v_cash, 0) < a.ask_cents;
      v_name := public.nft_pick('{ai,collectors}', random());
      perform public.nft_sell(a.id, null, v_name, a.ask_cents, 'ai',
                              'art:ai:' || a.id::text || ':' || floor(extract(epoch from v_now))::bigint::text);
      perform public.nft_ai_post(a.id, v_name, 'chat', public.nft_pick('{ai,lines,buy}', random()), null);
      v_buys := v_buys + 1;
      v_sold := v_sold + 1;
    elsif v_msgs < (ai ->> 'maxMessagesPerRun')::integer
          and random() * 10000 < (ai ->> 'listedOfferChanceBps')::integer
          and not exists (select 1 from public.artwork_messages m where m.artwork_id = a.id and m.ai_name is not null
                            and m.offer_status = 'open') then
      v_id := public.nft_ai_post(a.id, public.nft_pick('{ai,collectors}', random()), 'offer',
                                 public.nft_pick('{ai,lines,offer}', random()), public.nft_lowball_cents(v_value, random()));
      perform public.nft_notify_offer(v_id);
      v_msgs := v_msgs + 1;
    end if;
  end loop;

  -- 2. NFTs players keep: now and then a lowball offer
  for r in select x.id from public.artworks x
            where x.owner_id is not null and x.ask_cents is null
              and not exists (select 1 from public.artwork_auctions au where au.artwork_id = x.id and au.status = 'open')
              and not exists (select 1 from public.artwork_messages m where m.artwork_id = x.id and m.ai_name is not null
                                and m.offer_status = 'open')
            order by random() limit greatest(0, (ai ->> 'maxMessagesPerRun')::integer - v_msgs) loop
    continue when random() * 10000 >= (ai ->> 'unlistedOfferChanceBps')::integer;
    v_id := public.nft_ai_post(r.id, public.nft_pick('{ai,collectors}', random()), 'offer',
                               public.nft_pick('{ai,lines,offer}', random()),
                               public.nft_lowball_cents(public.nft_ai_value_cents(r.id, v_now), random()));
    perform public.nft_notify_offer(v_id);
    v_msgs := v_msgs + 1;
  end loop;

  -- 3. NFTs the AI holds: player offers from acceptBps of the value are accepted, others declined
  for r in select m.id, m.artwork_id, m.author_id, m.offer_cents from public.artwork_messages m
             join public.artworks x on x.id = m.artwork_id
            where x.ai_owner is not null and m.offer_status = 'open' and m.author_id is not null
            order by m.id limit 50 loop
    select * into a from public.artworks where id = r.artwork_id for update skip locked;
    continue when a.id is null or a.ai_owner is null;
    v_value := public.nft_ai_value_cents(a.id, v_now);
    select x.balance_cents into v_cash from public.ledger_accounts x where x.owner_player_id = r.author_id and x.kind = 'player_cash';
    if r.offer_cents::numeric * 10000 >= v_value::numeric * (ai ->> 'acceptBps')::integer and coalesce(v_cash, 0) >= r.offer_cents then
      update public.artwork_messages set offer_status = 'accepted' where id = r.id;
      v_name := a.ai_owner;
      perform public.nft_sell(a.id, r.author_id, null, r.offer_cents, 'offer', 'art:offer:' || r.id::text, r.id);
      perform public.nft_ai_post(a.id, v_name, 'chat', public.nft_pick('{ai,lines,accept}', random()), null);
    else
      update public.artwork_messages set offer_status = 'declined' where id = r.id;
      perform public.nft_ai_post(a.id, a.ai_owner, 'chat', public.nft_pick('{ai,lines,decline}', random()), null);
    end if;
    v_answers := v_answers + 1;
  end loop;

  return jsonb_build_object('sold', v_sold, 'offers', v_msgs, 'answered', v_answers, 'expired', v_expired);
end;
$$;
comment on function public.nfts_run_due(timestamptz) is
  'Internal (cron nexa-nfts, every minute): AI collectors buy listings at or below their valuation, write lowball '
  'offers, answer offers on the NFTs they hold; open offers expire (ADR-135).';

-- ---------------------------------------------------------------------------
-- H. New missions (metrics nft_offer, nft_chat, nft_listed, nft_bought, nft_royalty; art_sold for direct sales too)
-- ---------------------------------------------------------------------------
insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  ('q_nft_chat', 'quick', 'Schreib im Chat eines NFTs', 'Lob, Frage oder Spruch: Hauptsache freundlich.', 'mission_art', 'nft_chat', 'count', '{"unlock":"artworks"}'::jsonb, 1, 1, 20, 30, 4, null, false, 40, 0),
  ('q_nft_offer', 'quick', 'Mach ein Preisangebot für ein NFT', 'Im Chat unter dem NFT. Vielleicht nimmt der Besitzer an.', 'mission_art', 'nft_offer', 'count', '{"unlock":"artworks"}'::jsonb, 1, 1, 30, 40, 4, null, false, 45, 0),
  ('q_nft_list', 'quick', 'Stell ein NFT zum Festpreis ein', 'Die KI-Sammler kaufen, wenn der Preis fair ist.', 'mission_art', 'nft_listed', 'count', '{"unlock":"artworks","requires":"artwork"}'::jsonb, 1, 1, 30, 40, 4, null, false, 35, 0),
  ('d_nft_offers_2', 'daily', 'Mach {target} Preisangebote für NFTs', 'Verschiedene NFTs zählen.', 'mission_art', 'nft_offer', 'distinct', '{"unlock":"artworks"}'::jsonb, 2, 3, 200, 250, 4, null, false, 45, 0),
  ('d_nft_buy', 'daily', 'Kauf ein NFT', 'Zum Festpreis oder per angenommenem Angebot.', 'mission_art', 'nft_bought', 'count', '{"unlock":"artworks"}'::jsonb, 1, 1, 250, 300, 4, null, false, 30, 0),
  ('w_nft_sell', 'weekly', 'Verkauf {target} NFTs', 'An Spieler oder KI-Sammler, per Auktion, Festpreis oder Angebot.', 'mission_art', 'art_sold', 'count', '{"unlock":"artworks","requires":"artwork"}'::jsonb, 1, 2, 700, 900, 4, null, false, 40, 1),
  ('w_nft_royalty', 'weekly', 'Verdiene {target} Lizenzgebühren', 'Jedes Mal, wenn ein NFT von dir weiterverkauft wird.', 'mission_art', 'nft_royalty', 'count', '{"unlock":"artworks"}'::jsonb, 1, 2, 800, 1000, 4, null, false, 30, 1),
  ('m_nft_first_royalty', 'milestone', 'Deine erste Lizenzgebühr', 'Ein NFT von dir wurde weiterverkauft.', 'mission_art', 'nft_royalty', 'count', '{"unlock":"artworks"}'::jsonb, 1, 1, 600, 600, 4, 23, false, 60, 1),
  ('m_nft_royalty_10', 'milestone', '10 Lizenzgebühren', 'Deine NFTs sind gefragt.', 'mission_art', 'nft_royalty', 'count', '{"unlock":"artworks"}'::jsonb, 10, 10, 1500, 1500, 4, 25, false, 40, 1)
on conflict (key) do update
   set kind = excluded.kind, title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params, target_min = excluded.target_min,
       target_max = excluded.target_max, xp_min = excluded.xp_min, xp_max = excluded.xp_max, min_level = excluded.min_level,
       chain_order = excluded.chain_order, scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true, updated_at = now();

-- ---------------------------------------------------------------------------
-- I. Privileges and the job
-- ---------------------------------------------------------------------------
revoke all on function public.nfts_cfg() from public, anon, authenticated;
revoke all on function public.nft_ai_value_cents(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.nft_lowball_cents(bigint, double precision) from public, anon, authenticated;
revoke all on function public.nft_ai_ask_cents(bigint) from public, anon, authenticated;
revoke all on function public.nft_pick(text[], double precision) from public, anon, authenticated;
revoke all on function public.nft_royalty_for(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.nft_pay_royalty(uuid, uuid, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.nft_ai_post(uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.nft_notify_offer(bigint) from public, anon, authenticated;
revoke all on function public.nft_after_sale(uuid, uuid, text, uuid, text, bigint, bigint, bigint, text, uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.nft_sell(uuid, uuid, text, bigint, text, text, bigint) from public, anon, authenticated;
revoke all on function public.nft_chat_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public.nfts_run_due(timestamptz) from public, anon, authenticated;
grant execute on function public.nfts_run_due(timestamptz) to service_role;
revoke all on function public.get_artwork_chat(uuid) from public, anon;
revoke all on function public.post_artwork_message(uuid, uuid, text, bigint) from public, anon;
revoke all on function public.accept_artwork_offer(uuid, bigint) from public, anon;
revoke all on function public.set_artwork_price(uuid, uuid, bigint) from public, anon;
revoke all on function public.buy_artwork(uuid, uuid, bigint) from public, anon;
grant execute on function public.get_artwork_chat(uuid) to authenticated;
grant execute on function public.post_artwork_message(uuid, uuid, text, bigint) to authenticated;
grant execute on function public.accept_artwork_offer(uuid, bigint) to authenticated;
grant execute on function public.set_artwork_price(uuid, uuid, bigint) to authenticated;
grant execute on function public.buy_artwork(uuid, uuid, bigint) to authenticated;
comment on function public.get_artwork_chat(uuid) is
  'RPC: the offer chat of an NFT {artwork_id, is_owner, ask_cents, min_offer_cents, max_length, my_offer_cents, '
  'messages: [{id, author, ai, kind, text, offer_cents, offer_status, expires_at, at, mine}]} (ADR-135).';
comment on function public.post_artwork_message(uuid, uuid, text, bigint) is
  'RPC: writes in the chat of an NFT, optionally with a price offer (replaces the own open one); errors nft_text_invalid, '
  'rate_limited, artwork_not_found, own_artwork, forbidden (gallery), bid_too_low, insufficient_funds (ADR-135).';
comment on function public.accept_artwork_offer(uuid, bigint) is
  'RPC: the owner sells at an offer from the chat (fee and royalty); errors forbidden, nft_offer_closed, '
  'nft_offer_unfunded, already_on_auction -> {artwork, price_cents, fee_cents, royalty_cents} (ADR-135).';
comment on function public.set_artwork_price(uuid, uuid, bigint) is
  'RPC: the owner sets a fixed price (null = not for sale); errors forbidden, already_on_auction -> {artwork} (ADR-135).';
comment on function public.buy_artwork(uuid, uuid, bigint) is
  'RPC: buys an NFT at its fixed price (p_price_cents = the price seen); errors nft_not_for_sale, nft_price_changed, '
  'own_artwork, insufficient_funds -> {artwork, price_cents, fee_cents, royalty_cents} (ADR-135).';

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-nfts';
    perform cron.schedule('nexa-nfts', '* * * * *', 'select public.nfts_run_due()');
  end if;
end;
$do$;
