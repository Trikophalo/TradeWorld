-- ===== idempotent copy of migrations/20261204008500_nexamon_ai_buys_expensive.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 8500 · Nexamon: AI collectors buy expensive cards at market value too (ADR-195)
-- =============================================================================
-- Root cause: every AI buy counted against the households' budget per set and Berlin day (ai.dailyBudgetPacks x
-- pack price, e.g. 60 000 EUR in Mystic Energy), so a 1.5 M EUR card at its value never sold; above the value the AI
-- bought far too often (30 % x (1 + popularity) per minute, Black Label up to +20 %).
-- Rule (game_config.nexamon.ai; src/lib/sim/nexamon.ts nexamonAiBuyChanceBps, nexamonAiPremiumBps):
--   * at or below the copy's value (with the card, as shown in the UI): bought on the next minute run, any price,
--     no budget; fair listings come first in each run; only the households' cash stops it
--   * above the value: at most value x (1 + min(premium by condition or grade, ai.maxPremiumBps = 15 %)); chance per
--     minute buyChanceMinBps + (buyChanceBps - buyChanceMinBps) x popularity, falling linearly to atMaxChanceBps of
--     it at the maximum; only these buys check ai.dailyBudgetPacks (all AI buys of the set that day count)
--   * unchanged: never the AI's own listings, never ai.excludedRarities, nexamon_sell() idempotent per listing
-- Latest definitions copied: nexamon_ai_premium_bps / nexamon_ai_buy_chance_bps (6010 + 6510 patch),
-- nexamon_run_due (6010 + 6540 patch, card-aware value and factor).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- nexamonAiPremiumBps: by condition or grade, never above ai.maxPremiumBps
create or replace function public.nexamon_ai_premium_bps(p_condition text, p_grade double precision)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ai    jsonb := public.nexamon_cfg() -> 'ai';
  v_max integer := coalesce((public.nexamon_cfg() #>> '{ai,maxPremiumBps}')::integer, 1500);
begin
  if p_grade is null then
    return least(v_max, coalesce((ai #>> array['premiumBps', p_condition])::integer, 0));
  end if;
  if p_grade >= 10.75 then
    return least(v_max, coalesce((ai ->> 'blackLabelPremiumBps')::integer, 0));
  end if;
  return least(v_max, coalesce((ai #>> array['gradePremiumBps', public.nexamon_grade_index(p_grade)::text])::integer, 0));
end;
$$;

-- nexamonAiBuyChanceBps: 10 000 at or below the value; above it rare, rising with popularity, falling with the premium
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
  v_min   bigint;
  v_full  bigint;
  v_max   bigint;
  v_share bigint;
begin
  if coalesce(ai -> 'excludedRarities', '[]'::jsonb) ? p_rarity then
    return 0;
  end if;
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
  v_min := coalesce((ai ->> 'buyChanceMinBps')::bigint, 0);
  v_full := v_min + floor((coalesce((ai ->> 'buyChanceBps')::bigint, 0) - v_min)::numeric
                          * public.nexamon_popularity_bps(p_rarity, p_population) / 10000)::bigint;
  v_share := 10000 - floor((10000 - coalesce((ai ->> 'atMaxChanceBps')::numeric, 0)) * (p_price - p_value) / (v_max - p_value))::bigint;
  return floor(v_full::numeric * v_share / 10000)::integer;
end;
$$;

-- The minute job (latest definition, section 2 replaced).
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

  -- 2. AI collectors buy player listings (nexamonAiBuyChanceBps, ADR-195): at or below the copy's value (with the
  --    card, as the UI shows it) always, on this run, whatever the price and without a budget; above it up to
  --    value x (1 + premium, at most ai.maxPremiumBps) rarely, more often for popular cards. Fair listings first,
  --    then better copies; only buys above the value check the households' budget per set and Berlin day; their
  --    cash stops every buy. nexamon_sell() keys each buy by the listing (no double buys).
  for r in select q.* from (
             select l.id, l.price_cents, l.card_key, c.condition, c.grade, k.value_e4, k.rarity, k.population, k.set_key,
                    public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade, c.card_key) as copy_value,
                    public.nexamon_copy_factor_bps(c.condition, c.grade, c.card_key) as factor
               from public.nexamon_listings l
               join public.nexamon_copies c on c.id = l.copy_id
               join public.nexamon_cards k on k.card_key = l.card_key
              where l.seller_id is not null) q
            order by (q.price_cents <= q.copy_value) desc, q.factor desc, random()
            limit 500 loop
    exit when v_bought >= coalesce((ai ->> 'maxBuysPerRun')::integer, 100);
    continue when not exists (select 1 from public.nexamon_listings l where l.id = r.id);
    v_value := r.copy_value;
    v_chance := public.nexamon_ai_buy_chance_bps(r.price_cents, v_value, r.condition, r.grade, r.rarity, r.population);
    continue when v_chance <= 0;
    continue when v_chance < 10000 and random() * 10000 >= v_chance;
    if v_chance < 10000 then
      select coalesce(sum(s.price_cents), 0) into v_spent
        from public.nexamon_sales s join public.nexamon_cards k on k.card_key = s.card_key
       where s.kind = 'ai_buy' and s.at >= v_day and k.set_key = r.set_key;
      continue when v_spent + r.price_cents
                    > coalesce((ai ->> 'dailyBudgetPacks')::bigint, 0) * coalesce((cfg #>> array['sets', r.set_key, 'packPriceCents'])::bigint, 0);
    end if;
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
  'Job (cron nexa-nexamon, every minute; ADR-165, ADR-195): finishes gradings, opens the AI''s packs, lets AI collectors buy '
  'player listings (at or below the value always, whatever the price; above it rarely, at most +15 %), moves the values '
  'by supply and demand.';

do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.nexamon_ai_premium_bps(text, double precision)',
    'public.nexamon_ai_buy_chance_bps(bigint, bigint, text, double precision, text, bigint)',
    'public.nexamon_run_due(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$do$;
