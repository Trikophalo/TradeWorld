-- =============================================================================
-- NEXA · 6530 · Nexamon: list, take back and sell several copies at once; the AI's offers reset (ADR-174)
-- =============================================================================
-- * list_nexamon_cards(p_request_id, p_card_key, p_condition, p_grade, p_count, p_price_cents): lists p_count own
--   copies of one card at one price per copy. Raw copies of p_condition (p_grade null) or slabs of grade p_grade;
--   never listed, never at ASP; oldest first (acquired_at, serial). Each copy goes through list_nexamon_card with a
--   request id derived from p_request_id, so the rules (listing limit, rate limit, missions) stay in one place; the
--   whole call is one transaction and idempotent by p_request_id. Errors as list_nexamon_card plus
--   nexamon_not_enough NX272 (fewer matching copies than p_count).
-- * unlist_nexamon_cards(p_request_id, p_listing_ids): takes several own listings back at once (same rules).
-- * nexamon_ai_reset(p_now): every ai.listingResetHours (6) all AI listings go; the AI's stock of a card above
--   ai.stockCap[rarity] is retired (the newest copies, slabs last; deleted, so nexamon_copies stops growing), then
--   the AI lists its normal amounts again at the current value. Population stays "copies ever pulled" (retired
--   copies still count, like a card that got lost). Cron nexa-nexamon-ai-reset, hourly; it acts once per period.
-- Idempotent: runs unchanged as supabase/updates/20261204006530_nexamon_bulk_and_ai_reset.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
  v_old text := $q$    when 'nexamon_ai_excluded'        then 'NX271'
$q$;
begin
  if position('''nexamon_not_enough''' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the error key nexamon_not_enough (ADR-174) by hand';
    end if;
    execute replace(v_def, v_old, v_old || $q$    when 'nexamon_not_enough'         then 'NX272'
$q$);
  end if;
end;
$do$;

alter table public.nexamon_meta add column if not exists ai_reset_at timestamptz;

create or replace function public.list_nexamon_cards(p_request_id uuid, p_card_key text, p_condition text, p_grade numeric,
                                                     p_count integer, p_price_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        jsonb := public.nexamon_cfg() -> 'market';
  v_player uuid;
  v_replay jsonb;
  v_ids    uuid[];
  v_out    jsonb := '[]'::jsonb;
  v_one    jsonb;
  i        integer;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_card_key is null or p_count is null or p_count < 1
     or p_count > coalesce((m ->> 'maxListings')::integer, 30)
     or (p_grade is null and p_condition is null) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'list_nexamon_cards');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.lock_player_accounts(v_player);
  if (select count(*) from public.nexamon_listings l where l.seller_id = v_player) + p_count
     > coalesce((m ->> 'maxListings')::integer, 30) then
    perform public.api_error('nexamon_listing_limit');
  end if;
  select array_agg(x.id order by x.acquired_at, x.serial) into v_ids
    from (select c.id, c.acquired_at, c.serial from public.nexamon_copies c
           where c.owner_id = v_player and c.card_key = p_card_key and c.grading_until is null
             and (case when p_grade is null then c.grade is null and c.condition = p_condition else c.grade = p_grade end)
             and not exists (select 1 from public.nexamon_listings l where l.copy_id = c.id)
           order by c.acquired_at, c.serial
           limit p_count) x;
  if coalesce(array_length(v_ids, 1), 0) < p_count then
    perform public.api_error('nexamon_not_enough');
  end if;
  for i in 1 .. p_count loop
    v_one := public.list_nexamon_card(md5(p_request_id::text || ':' || i)::uuid, v_ids[i], p_price_cents);
    v_out := v_out || jsonb_build_array(v_one);
  end loop;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'listings', (select coalesce(jsonb_agg(x -> 'listing'), '[]'::jsonb) from jsonb_array_elements(v_out) x),
    'copies', (select coalesce(jsonb_agg(x -> 'copy'), '[]'::jsonb) from jsonb_array_elements(v_out) x)));
end;
$$;
comment on function public.list_nexamon_cards(uuid, text, text, numeric, integer, bigint) is
  'RPC: lists p_count own copies of a card (raw of one condition, or slabs of one grade), oldest first, at one price '
  'each (ADR-174); errors as list_nexamon_card and nexamon_not_enough.';

create or replace function public.unlist_nexamon_cards(p_request_id uuid, p_listing_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_out    jsonb := '[]'::jsonb;
  i        integer;
begin
  v_player := public.require_player();
  if p_request_id is null or p_listing_ids is null or coalesce(array_length(p_listing_ids, 1), 0) = 0
     or array_length(p_listing_ids, 1) > coalesce((public.nexamon_cfg() #>> '{market,maxListings}')::integer, 30) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'unlist_nexamon_cards');
  if v_replay is not null then
    return v_replay;
  end if;
  for i in 1 .. array_length(p_listing_ids, 1) loop
    v_out := v_out || jsonb_build_array(
      public.unlist_nexamon_card(md5(p_request_id::text || ':' || i)::uuid, p_listing_ids[i]) -> 'copy');
  end loop;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('copies', v_out));
end;
$$;
comment on function public.unlist_nexamon_cards(uuid, uuid[]) is
  'RPC: takes several own listings off the Nexamon market at once (ADR-174); errors as unlist_nexamon_card.';

-- Every ai.listingResetHours: the AI's offers go, its stock above the cap is retired, then it lists again.
create or replace function public.nexamon_ai_reset(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  -- retire the stock above the cap: the newest raw copies first, slabs last
  with ranked as (
    select c.id, row_number() over (partition by c.card_key
                                    order by (c.grade is not null) desc, c.acquired_at, c.serial) as n,
           coalesce((ai #>> array['stockCap', k.rarity])::integer, 1000000) as cap
      from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
     where c.ai_owner is not null
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
  'Internal (cron nexa-nexamon-ai-reset): every ai.listingResetHours the AI''s listings are removed, its stock above '
  'ai.stockCap retired and its normal amounts listed again at the current value (ADR-174).';

do $do$
begin
  revoke all on function public.nexamon_ai_reset(timestamptz) from public, anon, authenticated;
  revoke all on function public.list_nexamon_cards(uuid, text, text, numeric, integer, bigint) from public, anon;
  revoke all on function public.unlist_nexamon_cards(uuid, uuid[]) from public, anon;
  grant execute on function public.list_nexamon_cards(uuid, text, text, numeric, integer, bigint) to authenticated;
  grant execute on function public.unlist_nexamon_cards(uuid, uuid[]) to authenticated;
  revoke all on function public.nexamon_roll_one_of_one(text, uuid, integer) from public, anon, authenticated;
  revoke all on function public.nexamon_copies_ai_guard() from public, anon, authenticated;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-nexamon-ai-reset';
    perform cron.schedule('nexa-nexamon-ai-reset', '23 * * * *', 'select public.nexamon_ai_reset()');
  end if;
end;
$do$;
