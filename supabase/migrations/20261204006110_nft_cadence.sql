-- =============================================================================
-- NEXA · 6110 · NFT collectors are busy all day (ADR-170)
-- =============================================================================
-- Why the collectors seemed to act once a day: their offers stayed open 24 hours and at most maxOpenAiOffers (3)
-- collectors bid on one NFT, so an NFT got its three offers in the first minutes and then nothing until the next day;
-- their trades among themselves stopped at the day cap (300) by the afternoon, purchases at 60 a day; nobody bid in
-- player auctions. Now:
-- 1. A collector's offer runs out after nfts.ai.offerHours (2), so new offers come all day.
-- 2. Hourly caps: maxBuysPerHour (6) purchases from players, trade.perHour (24) trades among collectors; day caps
--    100 and 480. Purchases and auction bids together stay within ai.budgetCentsPerDay (300.000 EUR).
-- 3. Collectors bid in auctions (artwork_auctions.leader_ai, artwork_bids.bidder_ai): per minute and auction with
--    ai.auction.bidChanceBps, the minimum bid, only while it is at most their valuation. The money comes from the
--    households into art_escrow; an outbid collector gets it back to the households. A won auction makes the NFT a
--    collector's (they offer it again at their markup).
-- Idempotent: runs unchanged as supabase/updates/20261204006110_nft_cadence.sql.

-- ---------------------------------------------------------------------------
-- A. Schema: collectors as bidders
-- ---------------------------------------------------------------------------
alter table public.artwork_auctions add column if not exists leader_ai text;
alter table public.artwork_bids add column if not exists bidder_ai text;
alter table public.artwork_bids alter column bidder_id drop not null;
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'artwork_bids_bidder_check') then
    alter table public.artwork_bids add constraint artwork_bids_bidder_check
      check ((bidder_id is null) <> (bidder_ai is null) and (bidder_ai is null or char_length(bidder_ai) between 1 and 40));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'artwork_auctions_leader_check') then
    alter table public.artwork_auctions add constraint artwork_auctions_leader_check
      check (leader_id is null or leader_ai is null);
  end if;
end;
$do$;
comment on column public.artwork_auctions.leader_ai is 'ADR-170: an AI collector leads (leader_id is null then); money in art_escrow from the households.';
comment on column public.artwork_bids.bidder_ai is 'ADR-170: bid of an AI collector (bidder_id null).';

-- ---------------------------------------------------------------------------
-- B. Collectors bid in auctions
-- ---------------------------------------------------------------------------
-- What the collectors paid players today plus what they hold in player auctions
create or replace function public.nft_ai_spent_today(p_now timestamptz)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(s.price_cents) from public.artwork_sales s
                    where s.buyer_ai is not null and s.seller_ai is null and s.seller_id is not null
                      and s.at >= ((p_now at time zone 'Europe/Berlin')::date)::timestamp at time zone 'Europe/Berlin'), 0)
       + coalesce((select sum(au.current_cents) from public.artwork_auctions au
                    where au.status = 'open' and au.leader_ai is not null and au.seller_id is not null), 0);
$$;

create or replace function public.nft_ai_bid_auctions(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ai       jsonb := public.nfts_cfg() -> 'ai';
  v_escrow uuid := public.ledger_system_account('art_escrow');
  v_house  uuid := public.ledger_system_account('households');
  v_window double precision := public.config_double('artworks', '{auction,antiSnipeMinutes}', 2) * 60;
  au       public.artwork_auctions;
  r        record;
  a        public.artworks;
  v_n      integer := 0;
  v_min    bigint;
  v_value  bigint;
  v_name   text;
  v_cash   bigint;
  v_bid    bigint;
  v_entries jsonb;
begin
  if ai is null or ai -> 'auction' is null then
    return 0;
  end if;
  for r in select x.id from public.artwork_auctions x
            where x.status = 'open' and x.ends_at > p_now order by x.ends_at, x.id limit 50 loop
    exit when v_n >= coalesce((ai #>> '{auction,maxBidsPerRun}')::integer, 0);
    continue when random() * 10000 >= coalesce((ai #>> '{auction,bidChanceBps}')::integer, 0);
    select * into au from public.artwork_auctions where id = r.id for update skip locked;
    continue when au.id is null or au.status <> 'open' or au.ends_at <= p_now;
    v_min := public.artwork_min_bid_cents(au.start_cents, au.current_cents);
    v_value := public.nft_ai_value_cents(au.artwork_id, p_now);
    -- never above the valuation; player auctions within the daily budget
    continue when v_min > v_value;
    continue when au.seller_id is not null
              and public.nft_ai_spent_today(p_now) - case when au.leader_ai is not null then coalesce(au.current_cents, 0) else 0 end
                  + v_min > coalesce((ai ->> 'budgetCentsPerDay')::bigint, 0);
    select x.balance_cents into v_cash from public.ledger_accounts x where x.id = v_house;
    continue when coalesce(v_cash, 0) < v_min;
    select c into v_name from jsonb_array_elements_text(ai -> 'collectors') c
     where c is distinct from au.leader_ai order by random() limit 1;
    continue when v_name is null;
    select * into a from public.artworks where id = au.artwork_id;

    insert into public.artwork_bids (auction_id, bidder_id, bidder_ai, amount_cents, at)
    values (au.id, null, v_name, v_min, p_now) returning id into v_bid;
    v_entries := jsonb_build_array(jsonb_build_object('account_id', v_house, 'amount_cents', -v_min),
                                   jsonb_build_object('account_id', v_escrow, 'amount_cents', v_min));
    if au.current_cents is not null and au.leader_id is not null then
      v_entries := v_entries
        || jsonb_build_object('account_id', v_escrow, 'amount_cents', -au.current_cents)
        || jsonb_build_object('account_id', public.ledger_player_account(au.leader_id, 'player_cash'), 'amount_cents', au.current_cents);
    elsif au.current_cents is not null and au.leader_ai is not null then
      v_entries := v_entries
        || jsonb_build_object('account_id', v_escrow, 'amount_cents', -au.current_cents)
        || jsonb_build_object('account_id', v_house, 'amount_cents', au.current_cents);
    end if;
    perform public.ledger_post('artwork_bid', v_entries, 'Gebot eines KI-Sammlers', 'artwork_auction', au.id,
                               'art:aibid:' || v_bid::text, null,
                               jsonb_build_object('amount_cents', v_min, 'collector', v_name,
                                                  'refunded_player', au.leader_id, 'refunded_cents', au.current_cents));
    update public.artwork_auctions
       set leader_id = null, leader_ai = v_name, current_cents = v_min, bids = bids + 1,
           ends_at = case when extract(epoch from (au.ends_at - p_now)) < v_window
                          then p_now + make_interval(secs => v_window) else au.ends_at end
     where id = au.id;
    if au.leader_id is not null then
      perform public.social_notify(au.leader_id, 'art_outbid', v_name || ' hat dich überboten',
        '„' || a.title || '“ (' || public.artwork_code(a.serial) || '): neues Gebot ' || public.format_eur(v_min),
        jsonb_build_object('auction_id', au.id, 'artwork_id', a.id, 'code', public.artwork_code(a.serial), 'title', a.title,
                           'amount_cents', v_min, 'nickname', v_name),
        '/artworks', 'art_outbid:' || au.id::text || ':' || (au.bids + 1)::text);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.nft_ai_spent_today(timestamptz) from public, anon, authenticated;
revoke all on function public.nft_ai_bid_auctions(timestamptz) from public, anon, authenticated;
grant execute on function public.nft_ai_spent_today(timestamptz) to service_role;
grant execute on function public.nft_ai_bid_auctions(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- C. nfts_run_due: hourly caps, budget, shorter collector offers, auction bids
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.nfts_run_due(timestamp with time zone)'::regprocedure);
  v_d   text := $t$  v_price   bigint;
$t$;
  v_b0  text := $t$  select count(*) into v_buys from public.artwork_sales s where s.buyer_ai is not null and s.seller_ai is null and s.at >= v_day;
$t$;
  v_b1  text := $t$      continue when v_buys >= (ai ->> 'maxBuysPerDay')::integer or random() * 10000 >= (ai ->> 'buyChanceBps')::integer;
$t$;
  v_b2  text := $t$      v_buys := v_buys + 1;
$t$;
  v_o   text := $t$perform public.nft_notify_offer(v_id);
$t$;
  v_t0  text := $t$   where s.seller_ai is not null and s.buyer_ai is not null and s.at >= v_day;
$t$;
  v_t1  text := $t$    exit when v_traded >= (ai #>> '{trade,perRun}')::integer or v_trades >= (ai #>> '{trade,perDay}')::integer;
$t$;
  v_t2  text := $t$    v_trades := v_trades + 1;
$t$;
  v_r   text := $t$  return jsonb_build_object('sold', v_sold,$t$;
begin
  if position('maxBuysPerHour' in v_def) > 0 then
    return;
  end if;
  if position(v_d in v_def) = 0 or position(v_b0 in v_def) = 0 or position(v_b1 in v_def) = 0
     or position(v_b2 in v_def) = 0 or position(v_o in v_def) = 0 or position(v_t0 in v_def) = 0
     or position(v_t1 in v_def) = 0 or position(v_t2 in v_def) = 0 or position(v_r in v_def) = 0 then
    raise exception 'nfts_run_due() has an unexpected shape; add the hourly caps (ADR-170) by hand';
  end if;
  v_def := replace(v_def, v_d, v_d || $t$  v_hbuys    integer;
  v_htrades  integer;
  v_spent    bigint;
$t$);
  v_def := replace(v_def, v_b0, v_b0 || $t$  -- ADR-170: hourly caps and a daily budget spread the collectors' activity over the day
  select count(*) into v_hbuys from public.artwork_sales s
   where s.buyer_ai is not null and s.seller_ai is null and s.at > v_now - interval '1 hour';
  v_spent := public.nft_ai_spent_today(v_now);
$t$);
  v_def := replace(v_def, v_b1, $t$      continue when v_buys >= (ai ->> 'maxBuysPerDay')::integer or random() * 10000 >= (ai ->> 'buyChanceBps')::integer
                    or v_hbuys >= coalesce((ai ->> 'maxBuysPerHour')::integer, 1000000)
                    or v_spent + a.ask_cents > coalesce((ai ->> 'budgetCentsPerDay')::bigint, 9000000000000000000);
$t$);
  v_def := replace(v_def, v_b2, v_b2 || $t$      v_hbuys := v_hbuys + 1;
      v_spent := v_spent + a.ask_cents;
$t$);
  v_def := replace(v_def, v_o, $t$update public.artwork_messages
       set expires_at = least(expires_at, v_now + make_interval(mins => round(coalesce((ai ->> 'offerHours')::numeric, 24) * 60)::integer))
     where id = v_id;
    perform public.nft_notify_offer(v_id);
$t$);
  v_def := replace(v_def, v_t0, v_t0 || $t$  select count(*) into v_htrades from public.artwork_sales s
   where s.seller_ai is not null and s.buyer_ai is not null and s.at > v_now - interval '1 hour';
$t$);
  v_def := replace(v_def, v_t1, $t$    exit when v_traded >= (ai #>> '{trade,perRun}')::integer or v_trades >= (ai #>> '{trade,perDay}')::integer
              or v_htrades >= coalesce((ai #>> '{trade,perHour}')::integer, 1000000);
$t$);
  v_def := replace(v_def, v_t2, v_t2 || $t$    v_htrades := v_htrades + 1;
$t$);
  v_def := replace(v_def, v_r, $t$  return jsonb_build_object('bids', public.nft_ai_bid_auctions(v_now), 'sold', v_sold,$t$);
  execute v_def;
end;
$do$;

-- ---------------------------------------------------------------------------
-- D. Auctions with a collector in the lead
-- ---------------------------------------------------------------------------
-- bid_artwork: an outbid collector's money goes back to the households
do $do$
declare
  v_def text := pg_get_functiondef('public.bid_artwork(uuid, uuid, bigint)'::regprocedure);
  v_a   text := $t$      jsonb_build_object('account_id', public.ledger_player_account(au.leader_id, 'player_cash'), 'amount_cents', au.current_cents));
  end if;
$t$;
  v_b   text := $t$     set leader_id = v_player, current_cents = p_amount_cents,$t$;
begin
  if position('leader_ai' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 or position(v_b in v_def) = 0 then
    raise exception 'bid_artwork() has an unexpected shape; add the collector bids (ADR-170) by hand';
  end if;
  v_def := replace(v_def, v_a, v_a || $t$  if au.leader_id is null and au.leader_ai is not null and au.current_cents is not null then
    v_entries := jsonb_build_array(
      jsonb_build_object('account_id', v_escrow, 'amount_cents', -au.current_cents),
      jsonb_build_object('account_id', public.ledger_system_account('households'), 'amount_cents', au.current_cents));
  end if;
$t$);
  v_def := replace(v_def, v_b, $t$     set leader_id = v_player, leader_ai = null, current_cents = p_amount_cents,$t$);
  execute v_def;
end;
$do$;

-- artwork_settle_auction: a collector wins (the households paid into the escrow)
do $do$
declare
  v_def text := pg_get_functiondef('public.artwork_settle_auction(uuid)'::regprocedure);
  v_a   text := $t$  if au.leader_id is null or au.current_cents is null then$t$;
  v_b   text := $t$else au.seller_id end, null, au.leader_id, null,$t$;
  v_c   text := $t$  perform public.mission_event(au.leader_id, 'art_won', 1, null);$t$;
begin
  if position('leader_ai' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 or position(v_b in v_def) = 0 or position(v_c in v_def) = 0 then
    raise exception 'artwork_settle_auction() has an unexpected shape; add the collector bids (ADR-170) by hand';
  end if;
  v_def := replace(v_def, v_a, $t$  if (au.leader_id is null and au.leader_ai is null) or au.current_cents is null then$t$);
  v_def := replace(v_def, v_b, $t$else au.seller_id end, null, au.leader_id, au.leader_ai,$t$);
  v_def := replace(v_def, v_c, $t$  if au.leader_id is not null then
    perform public.mission_event(au.leader_id, 'art_won', 1, null);
  end if;$t$);
  execute v_def;
end;
$do$;

-- accept_auction and cancel_auction: a collector's bid counts like a player's
do $do$
declare
  v_def text := pg_get_functiondef('public.accept_auction(uuid, uuid)'::regprocedure);
  v_a   text := $t$  if au.leader_id is null or au.current_cents is null then$t$;
begin
  if position('leader_ai' in v_def) = 0 then
    if position(v_a in v_def) = 0 then
      raise exception 'accept_auction() has an unexpected shape; add the collector bids (ADR-170) by hand';
    end if;
    execute replace(v_def, v_a, $t$  if (au.leader_id is null and au.leader_ai is null) or au.current_cents is null then$t$);
  end if;
  v_def := pg_get_functiondef('public.cancel_auction(uuid, uuid)'::regprocedure);
  v_a := $t$  if au.leader_id is not null then$t$;
  if position('leader_ai' in v_def) = 0 then
    if position(v_a in v_def) = 0 then
      raise exception 'cancel_auction() has an unexpected shape; add the collector bids (ADR-170) by hand';
    end if;
    execute replace(v_def, v_a, $t$  if au.leader_id is not null or au.leader_ai is not null then$t$);
  end if;
end;
$do$;

-- artwork_json: the leading collector's name
do $do$
declare
  v_def text := pg_get_functiondef('public.artwork_json(uuid, uuid)'::regprocedure);
  v_a   text := $t$'leader', (select p.nickname from public.profiles p where p.id = au.leader_id),$t$;
begin
  if position('au.leader_ai' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 then
    raise exception 'artwork_json() has an unexpected shape; add the leading collector (ADR-170) by hand';
  end if;
  execute replace(v_def, v_a, $t$'leader', coalesce((select p.nickname from public.profiles p where p.id = au.leader_id), au.leader_ai),$t$);
end;
$do$;

-- artworks_wipe_player: a collector's bid in the player's auction goes back to the households
do $do$
declare
  v_def text := pg_get_functiondef('public.artworks_wipe_player(uuid, text)'::regprocedure);
  v_a   text := $t$    if r.seller_id = p_player then
      update public.artwork_auctions set status = 'cancelled'$t$;
begin
  if position('leader_ai' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 then
    raise exception 'artworks_wipe_player() has an unexpected shape; add the collector bids (ADR-170) by hand';
  end if;
  execute replace(v_def, v_a, $t$    if r.leader_id is null and r.leader_ai is not null and r.current_cents is not null then
      perform public.ledger_transfer(v_escrow, public.ledger_system_account('households'), r.current_cents,
                                     'artwork_refund', 'Gebot zurück (Auktion beendet)', 'artwork_auction', r.id,
                                     p_key || ':art:' || r.id::text, null);
    end if;
$t$ || v_a);
end;
$do$;
