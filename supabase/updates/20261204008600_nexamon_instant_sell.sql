-- ===== idempotent copy of migrations/20261204008600_nexamon_instant_sell.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 8600 · Nexamon: selling fresh pulls to the game at once (ADR-196)
-- =============================================================================
-- * instant_sell_nexamon(p_request_id, p_copy_ids): right after a pack opening (single, multi-buy, sealed) or a won
--   Pack Battle, the caller sells exactly those freshly pulled copies to the game for instantSell.payoutBps (90 %) of
--   their value incl. condition, each copy rounded half-even. Only raw copies the caller owns, from a pack
--   (source 'pack'), created at most instantSell.windowSeconds ago, never graded, listed or sold (no row in
--   nexamon_sales), of a released set. Paid by the households through the ledger like the bulk sale; every copy
--   lowers its card's value by quickSell.dropBps like the bulk sale (kind 'quick', never counted as a trade).
-- * Rarities the AI may not hold (ai.excludedRarities: One of One, uranium) go to the game's vault
--   (ai_owner = instantSell.vaultOwner): the AI guard lets exactly that owner hold them, the AI never lists them
--   (listedPerCard 0) and nexamon_ai_reset() never retires them.
-- * The bulk fee itself is config only (quickSell.bps 8000 = 20 % fee since ADR-196).
-- Idempotent: runs unchanged as supabase/updates/20261204008600_nexamon_instant_sell.sql.

create or replace function public.nexamon_copies_ai_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ai_owner is not null
     and new.ai_owner is distinct from (public.nexamon_cfg() #>> '{instantSell,vaultOwner}')
     and coalesce(public.nexamon_cfg() #> '{ai,excludedRarities}', '["one_of_one"]'::jsonb)
         ? (select k.rarity from public.nexamon_cards k where k.card_key = new.card_key) then
    perform public.api_error('nexamon_ai_excluded');
  end if;
  return new;
end;
$$;

create or replace function public.nexamon_ai_reset(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$declare
  ai        jsonb := public.nexamon_cfg() -> 'ai';
  v_now     timestamptz := coalesce(p_now, public.game_now());
  v_hours   integer := coalesce((public.nexamon_cfg() #>> '{ai,listingResetHours}')::integer, 0);
  v_last    timestamptz;
  v_deleted integer := 0;
  v_retired integer := 0;
  v_listed  integer := 0;
  r         record;
begin
  if v_hours <= 0 then
    return jsonb_build_object('skipped', 'off');
  end if;
  perform pg_advisory_xact_lock(7311652);
  select m.ai_reset_at into v_last from public.nexamon_meta m where m.id;
  if v_last is not null and v_now < v_last + make_interval(hours => v_hours) then
    return jsonb_build_object('skipped', 'not due');
  end if;
  delete from public.nexamon_listings where seller_ai is not null;
  get diagnostics v_deleted = row_count;
  -- retire the raw stock above the cap, the newest copies first; graded copies are never retired
  with ranked as (
    select c.id, row_number() over (partition by c.card_key order by c.acquired_at, c.serial) as n,
           coalesce((ai #>> array['stockCap', k.rarity])::integer, 1000000) as cap
      from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
     where c.ai_owner is not null and c.grade is null and c.grading_until is null
       and c.ai_owner is distinct from (public.nexamon_cfg() #>> '{instantSell,vaultOwner}')
  )
  delete from public.nexamon_copies c using ranked x where x.id = c.id and x.n > x.cap;
  get diagnostics v_retired = row_count;
  for r in select distinct c.card_key from public.nexamon_copies c where c.ai_owner is not null loop
    v_listed := v_listed + public.nexamon_ai_restock(r.card_key, v_now);
  end loop;
  insert into public.nexamon_meta (id, ai_reset_at) values (true, v_now)
  on conflict (id) do update set ai_reset_at = excluded.ai_reset_at;
  return jsonb_build_object('deleted', v_deleted, 'retired', v_retired, 'listed', v_listed);
end;
$$;
comment on function public.nexamon_ai_reset(timestamptz) is
  'Internal (cron nexa-nexamon-ai-reset): every ai.listingResetHours the AI''s listings are removed, its raw stock '
  'above ai.stockCap retired (slabs and the game''s vault never), and it lists again at the current value, held slabs '
  'whose time has come included (ADR-174, ADR-165, ADR-196).';

create or replace function public.instant_sell_nexamon(p_request_id uuid, p_copy_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q        jsonb := public.nexamon_cfg() -> 'quickSell';
  i        jsonb := public.nexamon_cfg() -> 'instantSell';
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_names  jsonb := coalesce(public.nexamon_cfg() #> '{ai,sellers}', '[]'::jsonb);
  v_vault  text := coalesce(public.nexamon_cfg() #>> '{instantSell,vaultOwner}', 'NEXA-Tresor');
  v_excl   jsonb := coalesce(public.nexamon_cfg() #> '{ai,excludedRarities}', '["one_of_one"]'::jsonb);
  v_window integer := coalesce((public.nexamon_cfg() #>> '{instantSell,windowSeconds}')::integer, 900);
  v_bps    integer := coalesce((public.nexamon_cfg() #>> '{instantSell,payoutBps}')::integer, 9000);
  v_ids    uuid[];
  v_id     uuid;
  c        public.nexamon_copies;
  k        public.nexamon_cards;
  v_buyer  text;
  v_value  bigint;
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
     or array_length(v_ids, 1) > coalesce((i ->> 'maxPerCall')::integer, 200) or jsonb_array_length(v_names) = 0 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'instant_sell_nexamon');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'nexamon_instant', coalesce((i ->> 'callsPerMinute')::integer, 20), 60) then
    perform public.api_error('rate_limited');
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
    -- only a fresh pull: raw, from a pack, within the window, never sold (a market or AI sale leaves a row)
    if c.grade is not null or c.graded_at is not null or c.source <> 'pack'
       or c.created_at < v_now - make_interval(secs => v_window)
       or not public.nexamon_set_released(k.set_key, v_now)
       or exists (select 1 from public.nexamon_sales s where s.copy_id = c.id) then
      perform public.api_error('nexamon_not_sellable');
    end if;
    v_value := public.nexamon_copy_value_cents(k.value_e4, c.condition, null);
    v_price := public.div_round_half_even(v_value::numeric * v_bps, 10000)::bigint;
    v_total := v_total + v_price;
    v_buyer := case when v_excl ? k.rarity then v_vault
                    else v_names ->> ((k.number + c.serial)::integer % jsonb_array_length(v_names)) end;
    update public.nexamon_copies set owner_id = null, ai_owner = v_buyer, acquired_at = v_now where id = c.id;
    -- like the bulk sale, dumping lowers the value a little (nexamonValueAfterQuickSell)
    v_after := public.nexamon_set_value(k.card_key,
      k.value_e4 - floor(k.value_e4::numeric * coalesce((q ->> 'dropBps')::integer, 0) / 10000)::bigint, v_now);
    insert into public.nexamon_sales (card_key, copy_id, seller_id, buyer_ai, price_cents, fee_cents, condition, grade, factor_bps,
                                      kind, counted, value_before_e4, value_after_e4, at)
    values (k.card_key, c.id, v_player, v_buyer, v_price, 0, c.condition, null,
            public.nexamon_copy_factor_bps(c.condition, null), 'quick', false, k.value_e4, v_after, v_now);
    v_sold := v_sold || jsonb_build_object('copy_id', c.id, 'card_key', k.card_key, 'price_cents', v_price);
    if not (k.card_key = any (v_cards)) then
      v_cards := v_cards || k.card_key;
    end if;
  end loop;
  if v_total > 0 then
    begin
      perform public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(v_player, 'player_cash'),
                                     v_total, 'nexamon_sale', 'Frisch gezogene Nexamon-Karten an das Spiel verkauft',
                                     'nexamon_instant', null, 'nexamon:instant:' || v_player::text || ':' || p_request_id::text,
                                     v_player, jsonb_build_object('copies', jsonb_array_length(v_sold), 'total_cents', v_total));
    exception when sqlstate 'NX001' then
      perform public.api_error('nexamon_not_sellable');
    end;
    perform public.loan_withhold(v_player, v_total, 'nexamon:instant:' || p_request_id::text);
  end if;
  foreach v_card in array v_cards loop
    perform public.nexamon_ai_restock(v_card, v_now);
  end loop;
  return public.request_complete(v_player, p_request_id,
    jsonb_build_object('sold', v_sold, 'count', jsonb_array_length(v_sold), 'total_cents', v_total));
end;
$$;
comment on function public.instant_sell_nexamon(uuid, uuid[]) is
  'RPC: sells freshly pulled copies (pack, multi-buy, sealed pack, won Pack Battle; at most instantSell.windowSeconds '
  'old, never graded, listed or sold) to the game at once for instantSell.payoutBps of their value (ADR-196) -> '
  '{sold: [{copy_id, card_key, price_cents}], count, total_cents}; errors nexamon_locked, invalid_argument, '
  'rate_limited, nexamon_unknown, nexamon_not_owner, nexamon_grading, nexamon_listed, nexamon_not_sellable.';

do $do$
begin
  revoke all on function public.nexamon_ai_reset(timestamptz) from public, anon, authenticated;
  revoke all on function public.instant_sell_nexamon(uuid, uuid[]) from public, anon;
  grant execute on function public.instant_sell_nexamon(uuid, uuid[]) to authenticated;
end;
$do$;
