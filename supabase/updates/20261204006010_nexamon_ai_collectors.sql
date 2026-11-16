-- ===== idempotent copy of migrations/20261204006010_nexamon_ai_collectors.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 6010 · Nexamon: AI collectors buy at market value at once and pay a premium for good copies (ADR-165)
-- =============================================================================
-- Rule (game_config.nexamon.ai; src/config/nexamon-rules.ts, nexamonAiBuyChanceBps, nexamonAiBuyCounts):
--   * a player's listing at or below the copy's value (market value x condition or grade factor) is bought on the
--     next run of the minute job: no chance roll, no weekly cap; only the households' budget per set and Berlin day
--     (dailyBudgetPacks pack prices) and their cash stop it
--   * above the value AI collectors pay at most value x (1 + premium): raw by condition (premiumBps), slabs by grade
--     (gradePremiumBps in the order of grading.grades, blackLabelPremiumBps); the chance per minute is buyChanceBps
--     x (1 + popularity) just above the value and falls linearly to atMaxChanceBps of it at the maximum
--   * better copies first (highest value factor), at most maxBuysPerRun a run
--   * the value: an AI buy moves the card's value (aiBuyBumpBps x popularity, as before) only if its price per card
--     lies within value.trade.bandBps of the value and the card had fewer than buysPerCardWindow[rarity] counted AI
--     buys in buyWindowDays; otherwise the copy still sells but the value stays (anti-manipulation)
--   * the old caps buyMaxBps (100 %) and gradedBuyMaxBps (70 % for slabs) are gone: a slab at its value sells
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- nexamonAiPremiumBps
create or replace function public.nexamon_ai_premium_bps(p_condition text, p_grade double precision)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ai jsonb := public.nexamon_cfg() -> 'ai';
begin
  if p_grade is null then
    return coalesce((ai #>> array['premiumBps', p_condition])::integer, 0);
  end if;
  if p_grade >= 10.75 then
    return coalesce((ai ->> 'blackLabelPremiumBps')::integer, 0);
  end if;
  return coalesce((ai #>> array['gradePremiumBps', public.nexamon_grade_index(p_grade)::text])::integer, 0);
end;
$$;

-- nexamonAiBuyChanceBps: 10 000 at or below the value; above it the falling chance up to value x (1 + premium)
create or replace function public.nexamon_ai_buy_chance_bps(p_price bigint, p_value bigint, p_condition text, p_grade double precision,
                                                            p_rarity text, p_population bigint)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ai      jsonb := public.nexamon_cfg() -> 'ai';
  v_full  bigint;
  v_max   bigint;
  v_share bigint;
begin
  if coalesce(p_price, 0) <= 0 then
    return 0;
  end if;
  if p_price <= p_value then
    return 10000;
  end if;
  v_max := floor(p_value::numeric * (10000 + public.nexamon_ai_premium_bps(p_condition, p_grade)) / 10000)::bigint;
  if p_price > v_max then
    return 0;
  end if;
  v_full := least(10000, floor(coalesce((ai ->> 'buyChanceBps')::numeric, 0)
                               * (10000 + public.nexamon_popularity_bps(p_rarity, p_population)) / 10000))::bigint;
  v_share := 10000 - floor((10000 - coalesce((ai ->> 'atMaxChanceBps')::numeric, 0)) * (p_price - p_value) / (v_max - p_value))::bigint;
  return floor(v_full::numeric * v_share / 10000)::integer;
end;
$$;

-- nexamon_sell(): an AI buy moves the value only at a plausible price and a few times per card and window
do $do$
declare
  v_def text := pg_get_functiondef('public.nexamon_sell(uuid, uuid, text, text, timestamptz)'::regprocedure);
  v_old text := $t$  if v_kind = 'ai_buy' then
    v_counted := true;$t$;
  v_new text := $t$  if v_kind = 'ai_buy' then
    -- nexamonAiBuyCounts: within the band of the value, at most ai.buysPerCardWindow counted AI buys per window
    v_norm := public.div_round_half_even(l.price_cents::numeric * 100 * 10000, greatest(1, v_factor));
    select count(*) into v_pair from public.nexamon_sales s
     where s.card_key = k.card_key and s.kind = 'ai_buy' and s.counted
       and s.at >= p_now - make_interval(days => coalesce((cfg #>> '{ai,buyWindowDays}')::integer, 1));
    v_counted := v_norm > 0
                 and abs(v_norm - k.value_e4)::numeric * 10000 <= k.value_e4::numeric * coalesce((t ->> 'bandBps')::integer, 2500)
                 and v_pair < coalesce((cfg #>> array['ai', 'buysPerCardWindow', k.rarity])::integer, 0);$t$;
begin
  if position('nexamonAiBuyCounts' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'nexamon_sell() has an unexpected shape; add the counting rule of AI buys (ADR-165) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- The minute job with the new AI collectors (copied from 5210, section 2 replaced).
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
  v_chance  integer;
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

  -- 2. AI collectors buy player listings (nexamonAiBuyChanceBps): at or below the copy's value always, on this run;
  --    above it up to value x (1 + premium by condition or grade) with a falling chance per minute; better copies
  --    first; only the households' budget per set and Berlin day and their cash stop them
  for r in select l.id, l.price_cents, l.card_key, c.condition, c.grade, k.value_e4, k.rarity, k.population, k.set_key
             from public.nexamon_listings l
             join public.nexamon_copies c on c.id = l.copy_id
             join public.nexamon_cards k on k.card_key = l.card_key
            where l.seller_id is not null
            order by public.nexamon_copy_factor_bps(c.condition, c.grade) desc, random()
            limit 500 loop
    exit when v_bought >= coalesce((ai ->> 'maxBuysPerRun')::integer, 100);
    continue when not exists (select 1 from public.nexamon_listings l where l.id = r.id);
    v_value := public.nexamon_copy_value_cents(r.value_e4, r.condition, r.grade);
    v_chance := public.nexamon_ai_buy_chance_bps(r.price_cents, v_value, r.condition, r.grade, r.rarity, r.population);
    continue when v_chance <= 0;
    continue when v_chance < 10000 and random() * 10000 >= v_chance;
    select coalesce(sum(s.price_cents), 0) into v_spent
      from public.nexamon_sales s join public.nexamon_cards k on k.card_key = s.card_key
     where s.kind = 'ai_buy' and s.at >= v_day and k.set_key = r.set_key;
    continue when v_spent + r.price_cents
                  > coalesce((ai ->> 'dailyBudgetPacks')::bigint, 0) * coalesce((cfg #>> array['sets', r.set_key, 'packPriceCents'])::bigint, 0);
    select a.balance_cents into v_cash from public.ledger_accounts a where a.id = v_house;
    continue when coalesce(v_cash, 0) < r.price_cents;
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
  'player listings (at or below the value always, above it with a premium by condition or grade), moves the values '
  'by supply and demand.';

do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.nexamon_ai_premium_bps(text, double precision)',
    'public.nexamon_ai_buy_chance_bps(bigint, bigint, text, double precision, text, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$do$;
