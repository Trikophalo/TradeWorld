-- =============================================================================
-- NEXA · 7020 · The collectors talk: reactions to the art and to the players (ADR-181)
-- =============================================================================
-- 1. Offer texts follow the critic score (nft_offer_text): copies and poor art get mocking lines, great art praise
--    or a compliment on its best sub-score, the middle a comment on the weakest or best sub-score or the classic
--    lines; now and then a collector's own catchphrase (nfts.ai.talk.personas). No line repeats one of the last
--    talk.recentLines AI lines of the chat (nft_line).
-- 2. Collectors answer players (nfts_run_due step 3b): a player's message that is the newest in the chat for at least
--    talk.replyDelayMinutes gets an answer from the AI owner or the collector who spoke there last, by keyword intent
--    (nft_intent: insult, higher, lower, no, yes, question, other). Asked for more (or told no) by the owner, the
--    collector raises its open offer by talk.counterStepBps up to talk.counterCeilingBps of its valuation (within the
--    daily budget of ADR-170), else says it is final. Every reply invites the next message: conversations go on.
-- 3. An offer ignored for talk.followupMinutes gets one nudge (step 3c).
-- 4. Purchases, offers and trades among collectors are as likely as nft_quality_chance_bps says (none below
--    ai.quality.noInterestBelow), lowball offers shift with the score (7010).
-- Ports of src/lib/sim/nft-talk.ts. Without nfts.ai.talk in game_config the collectors keep their old lines.
-- Idempotent: runs unchanged as supabase/updates/20261204007020_nft_talk.sql.

-- detectIntent: the first intent of talk.intentOrder with a keyword as a whole word (or phrase), else 'other'
create or replace function public.nft_intent(p_text text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  talk     jsonb := public.nfts_cfg() #> '{ai,talk}';
  v_t      text;
  v_intent text;
begin
  v_t := ' ' || btrim(regexp_replace(replace(lower(coalesce(p_text, '')), '?', ' ? '), '[^a-z0-9äöüß?]+', ' ', 'g')) || ' ';
  for v_intent in select jsonb_array_elements_text(coalesce(talk -> 'intentOrder', '[]'::jsonb)) loop
    if exists (select 1 from jsonb_array_elements_text(coalesce(talk #> array['intents', v_intent], '[]'::jsonb)) w
                where position(' ' || w || ' ' in v_t) > 0) then
      return v_intent;
    end if;
  end loop;
  return 'other';
end;
$$;

-- pickLine: the line at u, moving on while it is one of the last talk.recentLines AI lines of this chat
create or replace function public.nft_line(p_artwork uuid, p_lines jsonb, p_u double precision)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_len    integer := coalesce(jsonb_array_length(p_lines), 0);
  v_start  integer;
  v_recent text[];
  v_line   text;
begin
  if v_len = 0 then
    return null;
  end if;
  v_start := least(v_len - 1, floor(greatest(coalesce(p_u, 0), 0) * v_len)::integer);
  select coalesce(array_agg(x.body), '{}') into v_recent
    from (select m.body from public.artwork_messages m where m.artwork_id = p_artwork and m.ai_name is not null
           order by m.id desc limit coalesce((public.nfts_cfg() #>> '{ai,talk,recentLines}')::integer, 0)) x;
  for k in 0 .. v_len - 1 loop
    v_line := p_lines ->> ((v_start + k) % v_len);
    if not (v_line = any (v_recent)) then
      return v_line;
    end if;
  end loop;
  return p_lines ->> v_start;
end;
$$;

-- A collector's line from a list below nfts.ai (e.g. {lines,buy}, {talk,lines,reply,yes}); for offers, praise,
-- nudges and small talk sometimes the collector's own catchphrase; unknown lists fall back to {lines,offer}.
create or replace function public.nft_say(p_artwork uuid, p_name text, p_path text[], p_u double precision)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ai      jsonb := public.nfts_cfg() -> 'ai';
  v_lines jsonb := ai #> p_path;
begin
  if p_path::text in ('{lines,offer}', '{talk,lines,praise}', '{talk,lines,followup}', '{talk,lines,reply,other}')
     and jsonb_typeof(ai #> array['talk', 'personas', p_name]) = 'array'
     and random() * 10000 < coalesce((ai #>> '{talk,personaChanceBps}')::integer, 0) then
    v_lines := ai #> array['talk', 'personas', p_name];
  end if;
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) = 0 then
    v_lines := ai #> '{lines,offer}';
  end if;
  return coalesce(public.nft_line(p_artwork, v_lines, p_u), '…');
end;
$$;

-- nftOfferPath: which offer text fits the critic score ('copy', 'mock', 'praise', 'good.<key>', 'bad.<key>', 'offer')
create or replace function public.nft_offer_path(p_quality integer, p_copy text, p_best text, p_best_score integer,
                                                 p_worst text, p_worst_score integer, p_u double precision)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when p_copy is not null then 'copy'
           when p_quality is null then 'offer'
           when p_quality < (q ->> 'mockBelow')::integer then 'mock'
           when p_quality >= (q ->> 'praiseFrom')::integer then
             case when p_u < 0.5 or p_best is null then 'praise' else 'good.' || p_best end
           when p_u < 1.0 / 3 and p_worst is not null and p_worst_score < (q ->> 'badBelow')::integer then 'bad.' || p_worst
           when p_u >= 1.0 / 3 and p_u < 2.0 / 3 and p_best is not null and p_best_score >= (q ->> 'goodFrom')::integer
             then 'good.' || p_best
           else 'offer' end
    from (select coalesce(public.nfts_cfg() #> '{ai,quality}', '{}'::jsonb) as q) c;
$$;

-- The text of a collector's offer on an NFT
create or replace function public.nft_offer_text(p_artwork uuid, p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a      public.artworks;
  v_path text;
begin
  select * into a from public.artworks where id = p_artwork;
  if public.nfts_cfg() #> '{ai,talk,lines}' is null then
    return public.nft_say(p_artwork, p_name, '{lines,offer}', random());
  end if;
  v_path := public.nft_offer_path(a.quality, a.quality_detail ->> 'copy', a.quality_detail ->> 'best',
                                  (a.quality_detail #>> array['sub', a.quality_detail ->> 'best'])::integer,
                                  a.quality_detail ->> 'worst',
                                  (a.quality_detail #>> array['sub', a.quality_detail ->> 'worst'])::integer, random());
  return public.nft_say(p_artwork, p_name,
                        case when v_path = 'offer' then '{lines,offer}'::text[]
                             else array['talk', 'lines'] || string_to_array(v_path, '.') end, random());
end;
$$;

-- nftCounterCents: the open offer + counterStepBps (whole euros), at most counterCeilingBps of the valuation
create or replace function public.nft_counter_cents(p_previous bigint, p_value bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when v_next > p_previous then v_next end
    from (select least(floor(p_value::numeric * (t ->> 'counterCeilingBps')::integer / 10000 / 100)::bigint * 100,
                       floor(p_previous::numeric * (10000 + (t ->> 'counterStepBps')::integer) / 10000 / 100)::bigint * 100) as v_next
            from (select public.nfts_cfg() #> '{ai,talk}' as t) c) x;
$$;

revoke all on function public.nft_intent(text) from public, anon, authenticated;
revoke all on function public.nft_line(uuid, jsonb, double precision) from public, anon, authenticated;
revoke all on function public.nft_say(uuid, text, text[], double precision) from public, anon, authenticated;
revoke all on function public.nft_offer_path(integer, text, text, integer, text, integer, double precision) from public, anon, authenticated;
revoke all on function public.nft_offer_text(uuid, text) from public, anon, authenticated;
revoke all on function public.nft_counter_cents(bigint, bigint) from public, anon, authenticated;
grant execute on function public.nft_intent(text) to service_role;
grant execute on function public.nft_line(uuid, jsonb, double precision) to service_role;
grant execute on function public.nft_say(uuid, text, text[], double precision) to service_role;
grant execute on function public.nft_offer_path(integer, text, text, integer, text, integer, double precision) to service_role;
grant execute on function public.nft_offer_text(uuid, text) to service_role;
grant execute on function public.nft_counter_cents(bigint, bigint) to service_role;

-- nfts_run_due: copy of the latest definition (20261204006110 on top of 5000 and 1400), with the critic score and the chat
create or replace function public.nfts_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  v_hbuys    integer;
  v_htrades  integer;
  v_spent    bigint;
  v_replies  integer := 0;
  v_follow   integer := 0;
  v_intent   text;
  v_offer    public.artwork_messages;
  talk       jsonb := coalesce(public.nfts_cfg() #> '{ai,talk}', '{}'::jsonb);
begin
  if cfg = '{}'::jsonb or ai is null then
    return jsonb_build_object('skipped', 'no config');
  end if;
  update public.artwork_messages set offer_status = 'expired' where offer_status = 'open' and expires_at <= v_now;
  get diagnostics v_expired = row_count;
  -- ADR-181: NFTs without a critic score yet (e.g. from before the config) are rated now
  for r in select x.id from public.artworks x where x.quality is null order by x.created_at, x.serial limit 20 loop
    perform public.artwork_rate_quality(r.id);
  end loop;
  -- purchases from players; trades between collectors have their own cap (ADR-141)
  select count(*) into v_buys from public.artwork_sales s where s.buyer_ai is not null and s.seller_ai is null and s.at >= v_day;
  -- ADR-170: hourly caps and a daily budget spread the collectors' activity over the day
  select count(*) into v_hbuys from public.artwork_sales s
   where s.buyer_ai is not null and s.seller_ai is null and s.at > v_now - interval '1 hour';
  v_spent := public.nft_ai_spent_today(v_now);

  -- 1. fixed-price listings of players: bought at a good price, else maybe a lowball offer
  for r in select x.id, x.ask_cents from public.artworks x
            where x.ask_cents is not null and x.owner_id is not null
              and not exists (select 1 from public.artwork_auctions au where au.artwork_id = x.id and au.status = 'open')
            order by x.listed_at, x.id limit 100 loop
    select * into a from public.artworks where id = r.id for update skip locked;
    continue when a.id is null or a.ask_cents is distinct from r.ask_cents or a.owner_id is null;
    v_value := public.nft_ai_value_cents(a.id, v_now);
    if a.ask_cents <= v_value then
      continue when v_buys >= (ai ->> 'maxBuysPerDay')::integer
                    or random() * 10000 >= public.nft_quality_chance_bps((ai ->> 'buyChanceBps')::numeric, a.quality)
                    or v_hbuys >= coalesce((ai ->> 'maxBuysPerHour')::integer, 1000000)
                    or v_spent + a.ask_cents > coalesce((ai ->> 'budgetCentsPerDay')::bigint, 9000000000000000000);
      select x.balance_cents into v_cash from public.ledger_accounts x where x.id = v_house;
      continue when coalesce(v_cash, 0) < a.ask_cents;
      v_name := public.nft_pick('{ai,collectors}', random());
      perform public.nft_sell(a.id, null, v_name, a.ask_cents, 'ai',
                              'art:ai:' || a.id::text || ':' || floor(extract(epoch from v_now))::bigint::text);
      perform public.nft_ai_post(a.id, v_name, 'chat', public.nft_say(a.id, v_name, '{lines,buy}', random()), null);
      v_buys := v_buys + 1;
      v_hbuys := v_hbuys + 1;
      v_spent := v_spent + a.ask_cents;
      v_sold := v_sold + 1;
    elsif v_msgs < (ai ->> 'maxMessagesPerRun')::integer
          and random() * 10000 < public.nft_quality_chance_bps((ai ->> 'listedOfferChanceBps')::numeric, a.quality)
          and (select count(*) from public.artwork_messages m where m.artwork_id = a.id and m.ai_name is not null
                 and m.offer_status = 'open') < coalesce((ai ->> 'maxOpenAiOffers')::integer, 1)
          and public.nft_free_collector(a.id, random()) is not null then
      v_name := public.nft_free_collector(a.id, random());
      v_id := public.nft_ai_post(a.id, v_name, 'offer', public.nft_offer_text(a.id, v_name),
                                 public.nft_lowball_cents(v_value, random(), a.quality::integer));
      update public.artwork_messages
       set expires_at = least(expires_at, v_now + make_interval(mins => round(coalesce((ai ->> 'offerHours')::numeric, 24) * 60)::integer))
     where id = v_id;
    perform public.nft_notify_offer(v_id);
      v_msgs := v_msgs + 1;
    end if;
  end loop;

  -- 2. NFTs players keep: now and then a lowball offer
  for r in select x.id, x.quality from public.artworks x
            where x.owner_id is not null and x.ask_cents is null
              and not exists (select 1 from public.artwork_auctions au where au.artwork_id = x.id and au.status = 'open')
              and (select count(*) from public.artwork_messages m where m.artwork_id = x.id and m.ai_name is not null
                     and m.offer_status = 'open') < coalesce((ai ->> 'maxOpenAiOffers')::integer, 1)
            order by random() limit greatest(0, (ai ->> 'maxMessagesPerRun')::integer - v_msgs) loop
    continue when random() * 10000 >= public.nft_quality_chance_bps((ai ->> 'unlistedOfferChanceBps')::numeric, r.quality);
    continue when public.nft_free_collector(r.id, 0.5) is null;
    v_name := public.nft_free_collector(r.id, random());
    v_id := public.nft_ai_post(r.id, v_name, 'offer', public.nft_offer_text(r.id, v_name),
                               public.nft_lowball_cents(public.nft_ai_value_cents(r.id, v_now), random(), r.quality::integer));
    update public.artwork_messages
       set expires_at = least(expires_at, v_now + make_interval(mins => round(coalesce((ai ->> 'offerHours')::numeric, 24) * 60)::integer))
     where id = v_id;
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
      perform public.nft_ai_post(a.id, v_name, 'chat', public.nft_say(a.id, v_name, '{lines,accept}', random()), null);
    else
      update public.artwork_messages set offer_status = 'declined' where id = r.id;
      perform public.nft_ai_post(a.id, a.ai_owner, 'chat', public.nft_say(a.id, a.ai_owner, '{lines,decline}', random()), null);
    end if;
    v_answers := v_answers + 1;
  end loop;

  -- 3b. ADR-181: collectors answer players in the chat (the AI owner, else the collector who spoke last). Asked for
  --     more (or told no) by the owner, a collector raises its open offer up to its ceiling, within the budget.
  if talk ? 'lines' then
    for r in select m.id, m.artwork_id, m.author_id, m.body from public.artwork_messages m
              where m.author_id is not null
                and m.created_at > v_now - make_interval(mins => coalesce((talk ->> 'replyWindowMinutes')::integer, 30))
                and m.created_at <= v_now - make_interval(mins => coalesce((talk ->> 'replyDelayMinutes')::integer, 1))
                and not exists (select 1 from public.artwork_messages n where n.artwork_id = m.artwork_id and n.id > m.id)
              order by m.id limit 50 loop
      exit when v_replies >= coalesce((talk ->> 'maxRepliesPerRun')::integer, 0);
      select * into a from public.artworks where id = r.artwork_id for update skip locked;
      continue when a.id is null;
      v_name := a.ai_owner;
      if v_name is null then
        select m.ai_name into v_name from public.artwork_messages m
         where m.artwork_id = a.id and m.ai_name is not null
           and m.created_at > v_now - make_interval(hours => coalesce((talk ->> 'memoryHours')::integer, 6))
         order by m.id desc limit 1;
      end if;
      continue when v_name is null;
      v_intent := public.nft_intent(r.body);
      v_offer := null;
      select * into v_offer from public.artwork_messages m
       where m.artwork_id = a.id and m.ai_name = v_name and m.offer_status = 'open' and m.expires_at > v_now
       order by m.id desc limit 1;
      if v_intent in ('higher', 'no') and v_offer.id is not null and a.owner_id = r.author_id then
        v_price := public.nft_counter_cents(v_offer.offer_cents, public.nft_ai_value_cents(a.id, v_now));
        if v_price is not null
           and public.nft_ai_spent_today(v_now) + v_price <= coalesce((ai ->> 'budgetCentsPerDay')::bigint, 9000000000000000000) then
          update public.artwork_messages set offer_status = 'closed' where id = v_offer.id;
          v_id := public.nft_ai_post(a.id, v_name, 'offer', public.nft_say(a.id, v_name, '{talk,lines,counter}', random()), v_price);
          update public.artwork_messages
             set expires_at = least(expires_at, v_now + make_interval(mins => round(coalesce((ai ->> 'offerHours')::numeric, 24) * 60)::integer))
           where id = v_id;
          perform public.nft_notify_offer(v_id);
        else
          perform public.nft_ai_post(a.id, v_name, 'chat', public.nft_say(a.id, v_name, '{talk,lines,final}', random()), null);
        end if;
      else
        perform public.nft_ai_post(a.id, v_name, 'chat',
                                   public.nft_say(a.id, v_name, array['talk', 'lines', 'reply', v_intent], random()), null);
      end if;
      v_replies := v_replies + 1;
    end loop;

    -- 3c. ADR-181: an ignored offer gets a nudge (once: the nudge is the newest message then)
    for r in select m.id, m.artwork_id, m.ai_name from public.artwork_messages m
               join public.artworks x on x.id = m.artwork_id
              where m.offer_status = 'open' and m.ai_name is not null and m.expires_at > v_now and x.owner_id is not null
                and m.created_at <= v_now - make_interval(mins => coalesce((talk ->> 'followupMinutes')::integer, 30))
                and not exists (select 1 from public.artwork_messages n where n.artwork_id = m.artwork_id and n.id > m.id)
              order by m.id limit 50 loop
      exit when v_follow >= coalesce((talk ->> 'maxFollowupsPerRun')::integer, 0);
      continue when random() * 10000 >= coalesce((talk ->> 'followupChanceBps')::integer, 0);
      perform public.nft_ai_post(r.artwork_id, r.ai_name, 'chat',
                                 public.nft_say(r.artwork_id, r.ai_name, '{talk,lines,followup}', random()), null);
      v_follow := v_follow + 1;
    end loop;
  end if;

  -- 4. The collectors trade among themselves (ADR-141): popular NFTs change hands more often; the price follows the
  --    buyer's taste around the fair value and moves only part of the way from the last price.
  select count(*) into v_trades from public.artwork_sales s
   where s.seller_ai is not null and s.buyer_ai is not null and s.at >= v_day;
  select count(*) into v_htrades from public.artwork_sales s
   where s.seller_ai is not null and s.buyer_ai is not null and s.at > v_now - interval '1 hour';
  for r in select x.id, x.ai_owner, x.value_cents, x.quality,
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
    exit when v_traded >= (ai #>> '{trade,perRun}')::integer or v_trades >= (ai #>> '{trade,perDay}')::integer
              or v_htrades >= coalesce((ai #>> '{trade,perHour}')::integer, 1000000);
    continue when random() * 10000 >= public.nft_quality_chance_bps(least((ai #>> '{trade,maxChanceBps}')::numeric,
      floor((ai #>> '{trade,chanceBps}')::numeric * (10000 + (ai #>> '{trade,likeWeightBps}')::numeric * r.likes
            + (ai #>> '{trade,offerWeightBps}')::numeric * r.offers + (ai #>> '{trade,saleWeightBps}')::numeric * r.sales) / 10000)),
      r.quality);
    select * into a from public.artworks where id = r.id for update skip locked;
    continue when a.id is null or a.ai_owner is distinct from r.ai_owner;
    -- the buyer is always another collector
    select c into v_name from jsonb_array_elements_text(ai -> 'collectors') c where c <> a.ai_owner order by random() limit 1;
    continue when v_name is null;
    v_price := public.nft_ai_trade_price_cents(a.value_cents, public.nft_fair_cents(a.id, v_now), random());
    perform public.nft_sell(a.id, null, v_name, v_price, 'ai',
                            'art:trade:' || a.id::text || ':' || floor(extract(epoch from v_now))::bigint::text);
    perform public.nft_ai_post(a.id, v_name, 'chat', public.nft_say(a.id, v_name, '{lines,trade}', random()), null);
    v_traded := v_traded + 1;
    v_trades := v_trades + 1;
    v_htrades := v_htrades + 1;
  end loop;

  return jsonb_build_object('bids', public.nft_ai_bid_auctions(v_now), 'sold', v_sold, 'offers', v_msgs, 'answered', v_answers, 'replies', v_replies, 'followups', v_follow, 'expired', v_expired,
                            'traded', v_traded);
end;
$function$;
