-- ===== idempotent copy of migrations/20261204001400_nft_market.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1400 · A living NFT market: the AI collectors trade among themselves (ADR-141)
-- =============================================================================
-- Popular NFTs are wanted: open offers and sales of the last days raise what the collectors pay (nft_demand_bps, on
-- top of likes). The collectors trade among themselves: per minute an NFT a collector holds is bought by another one
-- with a chance that grows with popularity; the price follows the buyer's taste around the fair value (mint cost or
-- floor x bonuses, not the last price) and moves part of the way from the last price, so prices go up and down. The
-- buyer offers it again (nft_after_sale). The money stays with the households; the creator gets the royalty.
-- Port of src/lib/sim/nfts.ts (nftDemandBps, nftFairCents, nftAiTradeChanceBps, nftAiTradePriceCents).
-- Idempotent: runs unchanged as supabase/updates/20261204001400_nft_market.sql.

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
  update public.artwork_messages set offer_status = 'closed'
   where artwork_id = a.id and offer_status = 'open' and id is distinct from p_accepted;
  -- an AI collector offers what it bought at its valuation (this sale included; offers that just closed no longer count as demand, ADR-141) x resaleMarkup
  if p_buyer_ai is not null then
    update public.artworks set ask_cents = public.nft_ai_ask_cents(public.nft_ai_value_cents(a.id, v_now)), listed_at = v_now
     where id = a.id;
  end if;
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

create or replace function public.nft_demand_bps(p_artwork uuid, p_now timestamptz default null,
                                              p_exclude uuid default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((d ->> 'offerBps')::bigint, 0)
           * least((select count(distinct coalesce(m.author_id::text, m.ai_name)) from public.artwork_messages m
                     where m.artwork_id = p_artwork and m.offer_status = 'open'
                       and (p_exclude is null or m.author_id is distinct from p_exclude)), coalesce((d ->> 'maxOffers')::bigint, 0))
       + coalesce((d ->> 'saleBps')::bigint, 0)
           * least((select count(*) from public.artwork_sales s
                     where s.artwork_id = p_artwork
                       and s.at >= coalesce(p_now, public.game_now()) - make_interval(days => coalesce((d ->> 'days')::integer, 7))),
                   coalesce((d ->> 'maxSales')::bigint, 0))
    from (select coalesce(public.nfts_cfg() #> '{ai,demand}', '{}'::jsonb) as d) c;
$$;

create or replace function public.nft_fair_cents(p_artwork uuid, p_now timestamptz default null)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ai      jsonb := public.nfts_cfg() -> 'ai';
  a       public.artworks;
  v_base  bigint;
  v_likes bigint;
  v_sales bigint := 0;
  v_days  bigint;
begin
  select * into a from public.artworks where id = p_artwork;
  if a.id is null then
    return null;
  end if;
  v_base := greatest(coalesce(a.mint_cents, case when a.origin = 'game' then public.artwork_gallery_start_cents(a.rarity) end, 0),
                     coalesce((ai ->> 'floorCents')::bigint, 100000));
  select count(*) into v_likes from public.artwork_likes l where l.artwork_id = a.id;
  if a.creator_id is not null then
    select count(*) into v_sales from public.artwork_sales s join public.artworks x on x.id = s.artwork_id
     where x.creator_id = a.creator_id;
  end if;
  v_days := greatest(0, floor(extract(epoch from (coalesce(p_now, public.game_now()) - a.created_at)) / 86400))::bigint;
  return floor(v_base::numeric * (10000
           + (ai ->> 'likeBps')::bigint * least(v_likes, (ai ->> 'maxLikes')::bigint)
           + (ai ->> 'creatorSaleBps')::bigint * least(v_sales, (ai ->> 'maxCreatorSales')::bigint)
           + (ai ->> 'ageBpsPerDay')::bigint * least(v_days, (ai ->> 'maxAgeDays')::bigint)
           + public.nft_demand_bps(a.id, p_now)) / 10000)::bigint;
end;
$$;

create or replace function public.nft_ai_trade_price_cents(p_last bigint, p_fair bigint, p_u double precision)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nfts_cfg();
  t        jsonb := public.nfts_cfg() #> '{ai,trade}';
  v_taste  integer;
  v_target bigint;
  v_last   bigint;
begin
  v_taste := (t ->> 'tasteMinBps')::integer
           + floor(least(greatest(coalesce(p_u, 0), 0), 0.999999) * ((t ->> 'tasteMaxBps')::integer - (t ->> 'tasteMinBps')::integer))::integer;
  v_target := floor(p_fair::numeric * v_taste / 10000)::bigint;
  v_last := coalesce(p_last, v_target);
  return greatest((cfg ->> 'minAskCents')::bigint,
                  (round((v_last + trunc((v_target - v_last)::numeric * (t ->> 'reversionBps')::integer / 10000)) / 100.0) * 100)::bigint);
end;
$$;

-- The valuation without the demand of one bidder: their own offer must not raise the price they have to beat.
create or replace function public.nft_ai_value_excluding(p_artwork uuid, p_now timestamptz, p_exclude uuid)
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
           + coalesce((ai ->> 'ageBpsPerDay')::bigint, 100) * least(v_days, coalesce((ai ->> 'maxAgeDays')::bigint, 30))
           + public.nft_demand_bps(a.id, p_now, p_exclude);
  return floor(v_anchor::numeric * (10000 + v_bonus) / 10000)::bigint;
end;
$$;

create or replace function public.nft_ai_value_cents(p_artwork uuid, p_now timestamptz default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select public.nft_ai_value_excluding(p_artwork, p_now, null);
$$;

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
  v_trades  integer;
  v_traded  integer := 0;
  v_price   bigint;
begin
  if cfg = '{}'::jsonb or ai is null then
    return jsonb_build_object('skipped', 'no config');
  end if;
  update public.artwork_messages set offer_status = 'expired' where offer_status = 'open' and expires_at <= v_now;
  get diagnostics v_expired = row_count;
  -- purchases from players; trades between collectors have their own cap (ADR-141)
  select count(*) into v_buys from public.artwork_sales s where s.buyer_ai is not null and s.seller_ai is null and s.at >= v_day;

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
    v_value := public.nft_ai_value_excluding(a.id, v_now, r.author_id);
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

  -- 4. The collectors trade among themselves (ADR-141): popular NFTs change hands more often; the price follows the
  --    buyer's taste around the fair value and moves only part of the way from the last price.
  select count(*) into v_trades from public.artwork_sales s
   where s.seller_ai is not null and s.buyer_ai is not null and s.at >= v_day;
  for r in select x.id, x.ai_owner, x.value_cents,
                  (select count(*) from public.artwork_likes l where l.artwork_id = x.id) as likes,
                  (select count(distinct coalesce(m.author_id::text, m.ai_name)) from public.artwork_messages m
                    where m.artwork_id = x.id and m.offer_status = 'open') as offers,
                  (select count(*) from public.artwork_sales s where s.artwork_id = x.id
                    and s.at >= v_now - make_interval(days => (ai #>> '{demand,days}')::integer)) as sales
             from public.artworks x
            where x.ai_owner is not null and x.owner_id is null
              and coalesce(x.listed_at, x.created_at) <= v_now - make_interval(mins => (ai #>> '{trade,minHoldMinutes}')::integer)
              and not exists (select 1 from public.artwork_auctions au where au.artwork_id = x.id and au.status = 'open')
            order by random() limit 200 loop
    exit when v_traded >= (ai #>> '{trade,perRun}')::integer or v_trades >= (ai #>> '{trade,perDay}')::integer;
    continue when random() * 10000 >= least((ai #>> '{trade,maxChanceBps}')::numeric,
      floor((ai #>> '{trade,chanceBps}')::numeric * (10000 + (ai #>> '{trade,likeWeightBps}')::numeric * r.likes
            + (ai #>> '{trade,offerWeightBps}')::numeric * r.offers + (ai #>> '{trade,saleWeightBps}')::numeric * r.sales) / 10000));
    select * into a from public.artworks where id = r.id for update skip locked;
    continue when a.id is null or a.ai_owner is distinct from r.ai_owner;
    -- the buyer is always another collector
    select c into v_name from jsonb_array_elements_text(ai -> 'collectors') c where c <> a.ai_owner order by random() limit 1;
    continue when v_name is null;
    v_price := public.nft_ai_trade_price_cents(a.value_cents, public.nft_fair_cents(a.id, v_now), random());
    perform public.nft_sell(a.id, null, v_name, v_price, 'ai',
                            'art:trade:' || a.id::text || ':' || floor(extract(epoch from v_now))::bigint::text);
    perform public.nft_ai_post(a.id, v_name, 'chat', public.nft_pick('{ai,lines,trade}', random()), null);
    v_traded := v_traded + 1;
    v_trades := v_trades + 1;
  end loop;

  return jsonb_build_object('sold', v_sold, 'offers', v_msgs, 'answered', v_answers, 'expired', v_expired,
                            'traded', v_traded);
end;
$$;

revoke all on function public.nft_demand_bps(uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.nft_ai_value_excluding(uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.nft_fair_cents(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.nft_ai_trade_price_cents(bigint, bigint, double precision) from public, anon, authenticated;
