-- ===== idempotent copy of migrations/20261204011400_nexamon_pack_buy_limits.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 011400 · Buying packs back to back: a multi-buy is one action (ADR-182 Nachtrag)
-- =============================================================================
-- Until now every pack of a multi-buy (buy_nexamon_packs, 10 packs) took one hit of packs.perMinute (20) in the
-- fixed minute window: after two buys of 10 every further buy failed with rate_limited ("zu viele Aktionen").
-- * api_rate_limited(p_window_seconds): raises rate_limited (NX004) with the seconds until the current window ends
--   as the error detail; the client shows "Kurz warten: noch X s".
-- * nexamon_buy_pack_as(p_player, p_request_id, p_set, p_count): the purchase of one pack (latest buy_nexamon_pack,
--   8100: release, pack sale price, payment, pulls, missions), internal. With p_count it takes the hit of
--   packs.perMinute itself (a single buy), without it the caller has counted.
-- * buy_nexamon_pack (latest: 8100): the single buy, unchanged apart from the wait in the error.
-- * buy_nexamon_packs (latest: 7240): ONE hit of packs.perMinute for the whole buy (an action, like a single buy)
--   and one hit per pack of packs.maxPacksPerMinute (abuse cap on volume, default 100 packs a minute).
-- Idempotent: runs unchanged as supabase/updates/20261204011400_nexamon_pack_buy_limits.sql.

create or replace function public.api_rate_limited(p_window_seconds integer)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_now  numeric := extract(epoch from clock_timestamp());
  v_wait integer;
begin
  -- rate_limit_hit counts in fixed windows of p_window_seconds: the next one starts at the next multiple
  v_wait := greatest(1, ceil(p_window_seconds - mod(v_now, p_window_seconds))::integer);
  raise exception using errcode = 'NX004', message = 'rate_limited', detail = 'retry_after=' || v_wait;
end;
$$;
comment on function public.api_rate_limited(integer) is
  'Raises the API error rate_limited (NX004) with detail retry_after=<seconds until the fixed window of '
  'rate_limit_hit ends>; the client shows the wait.';

create or replace function public.nexamon_buy_pack_as(p_player uuid, p_request_id uuid, p_set text, p_count boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid := p_player;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_price  bigint;
  v_cash   bigint;
  v_pack   uuid := gen_random_uuid();
  v_cards  jsonb;
  r        record;
begin
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
  if not public.nexamon_set_released(p_set, public.game_now()) then
    perform public.api_error('nexamon_set_not_released');
  end if;
  -- ADR-193: a running pack sale of this set
  v_price := public.news_promo_pack_price(p_set, v_price, v_now);
  if p_count and not public.rate_limit_hit(v_player, 'nexamon_pack', coalesce((cfg #>> '{packs,perMinute}')::integer, 20), 60) then
    perform public.api_rate_limited(60);
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
    if public.nexamon_rarity_rank(r.rarity) >= 1 then
      perform public.mission_event(v_player, 'nexamon_rare', 1, null);
    end if;
    if public.nexamon_rarity_rank(r.rarity) >= 2 then
      perform public.mission_event(v_player, 'nexamon_ultra', 1, null);
    end if;
  end loop;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'pack_id', v_pack, 'set', p_set, 'price_cents', v_price, 'cards', v_cards,
    'packs_opened', (select count(*) from public.nexamon_packs p where p.player_id = v_player and p.set_key = p_set)));
end;
$function$;
comment on function public.nexamon_buy_pack_as(uuid, uuid, text, boolean) is
  'Internal: one booster pack bought and opened for a player (buy_nexamon_pack); p_count: take the packs.perMinute hit.';

create or replace function public.buy_nexamon_pack(p_request_id uuid, p_set text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return public.nexamon_buy_pack_as(public.require_player(), p_request_id, p_set, true);
end;
$function$;
comment on function public.buy_nexamon_pack(uuid, text) is
  'RPC: buys and opens a booster pack of a set (money to the households): five pulls in slot order with condition, '
  'population number and whether the card is new to the player (ADR-165); errors nexamon_locked, invalid_argument, '
  'nexamon_unknown, nexamon_set_not_released, rate_limited (detail retry_after=<s>), insufficient_funds.';

create or replace function public.buy_nexamon_packs(p_request_id uuid, p_set text, p_count integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_replay jsonb;
  v_packs  jsonb := '[]'::jsonb;
  v_one    jsonb;
  v_total  bigint := 0;
  v_ok     boolean := true;
  i        integer;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_set is null or p_count is null or p_count < 1
     or p_count > coalesce((cfg #>> '{packs,maxPerBuy}')::integer, 10) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_nexamon_packs');
  if v_replay is not null then
    return v_replay;
  end if;
  -- one action for the whole buy, and every pack against the volume cap
  if not public.rate_limit_hit(v_player, 'nexamon_pack', coalesce((cfg #>> '{packs,perMinute}')::integer, 20), 60) then
    perform public.api_rate_limited(60);
  end if;
  for i in 1 .. p_count loop
    v_ok := public.rate_limit_hit(v_player, 'nexamon_pack_volume', coalesce((cfg #>> '{packs,maxPacksPerMinute}')::integer, 100), 60)
            and v_ok;
  end loop;
  if not v_ok then
    perform public.api_rate_limited(60);
  end if;
  for i in 1 .. p_count loop
    v_one := public.nexamon_buy_pack_as(v_player, md5(p_request_id::text || ':pack:' || i)::uuid, p_set, false);
    v_packs := v_packs || jsonb_build_array(v_one);
    v_total := v_total + coalesce((v_one ->> 'price_cents')::bigint, 0);
  end loop;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'set', p_set, 'count', p_count, 'price_cents', v_total, 'packs', v_packs));
end;
$$;
comment on function public.buy_nexamon_packs(uuid, text, integer) is
  'RPC: buys 1..packs.maxPerBuy booster packs of a set at once (ADR-182), each like buy_nexamon_pack (payment, pulls), '
  'all or nothing -> {set, count, price_cents, packs: [buy_nexamon_pack answers in order]}; idempotent. The buy is one '
  'action of packs.perMinute; its packs count against packs.maxPacksPerMinute. Errors as buy_nexamon_pack and '
  'invalid_argument.';

do $do$
begin
  revoke all on function public.api_rate_limited(integer) from public, anon, authenticated;
  revoke all on function public.nexamon_buy_pack_as(uuid, uuid, text, boolean) from public, anon, authenticated;
  revoke all on function public.buy_nexamon_pack(uuid, text) from public, anon;
  grant execute on function public.buy_nexamon_pack(uuid, text) to authenticated;
  revoke all on function public.buy_nexamon_packs(uuid, text, integer) from public, anon;
  grant execute on function public.buy_nexamon_packs(uuid, text, integer) to authenticated;
end;
$do$;
