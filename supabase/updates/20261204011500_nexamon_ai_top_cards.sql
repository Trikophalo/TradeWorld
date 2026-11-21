-- ===== idempotent copy of migrations/20261204011500_nexamon_ai_top_cards.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 011500 · Nexamon: the AI buys the most expensive cards at market value too (ADR-195, Nachtrag)
-- =============================================================================
-- Owner: "Die KI soll auch die teuersten Karten auf dem Markt für Marktpreis oder weniger kaufen."
-- * nexamon_ai_buy_chance_bps(): at or below the copy's value 10 000 for every rarity, One of One and uranium
--   included (raw or slab, Black Label too); above the value unchanged (ADR-195), never for those two rarities.
-- * nexamon_run_due(), section 2: a One of One or uranium card goes to the game's vault (instantSell.vaultOwner,
--   "NEXA-Tresor"; the AI guard allows exactly that owner). If the households' cash cannot pay a buy at or below
--   the value, the treasury tops them up by exactly the shortfall (ledger 'transfer' treasury -> households, sum 0,
--   key nexamon:ai:fund:<listing>:<run>) as long as it keeps ai.treasuryFloorCents; otherwise the buy is logged
--   (raise log, result ai_unaffordable) and the listing stays for the next run. A buy that errors is logged and
--   skipped (result ai_failed) instead of rolling back the whole minute job.
-- * nexamon_run_due(), section 2b: the vault puts a copy it held at least vault.minHoldHours back on sale with a
--   chance of vault.relistChancePerDayBps per day, at value + vault.premiumMinBps..premiumMaxBps
--   (nexamon_vault_ask_cents, nexamonVaultAskCents), at most vault.maxListed at a time; withdrawn after listHours.
-- * nexamon_ai_restock() never lists a vault copy (slabs included); nexamon_ai_reset() keeps the vault's listings.
-- Latest definitions copied: nexamon_ai_buy_chance_bps / nexamon_run_due (8500), nexamon_ai_restock (7100),
-- nexamon_ai_reset (8600).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- nexamonAiBuyChanceBps: 10 000 at or below the value (every rarity); above it rare, never for the vault rarities
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
  v_pop   bigint;
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
  -- One of Ones and uranium: the vault buys at or below the value only (ADR-195, Nachtrag)
  if coalesce(ai -> 'excludedRarities', '[]'::jsonb) ? p_rarity then
    return 0;
  end if;
  v_max := floor(p_value::numeric * (10000 + public.nexamon_ai_premium_bps(p_condition, p_grade)) / 10000)::bigint;
  if p_price > v_max then
    return 0;
  end if;
  v_min := coalesce((ai ->> 'buyChanceMinShareBps')::bigint, 10000);
  v_pop := floor((10000 - v_min)::numeric * public.nexamon_popularity_bps(p_rarity, p_population) / 10000)::bigint;
  v_full := floor(coalesce((ai ->> 'buyChanceBps')::numeric, 0) * (v_min + v_pop) / 10000)::bigint;
  v_share := 10000 - floor((10000 - coalesce((ai ->> 'atMaxChanceBps')::numeric, 0)) * (p_price - p_value) / (v_max - p_value))::bigint;
  return floor(v_full::numeric * v_share / 10000)::integer;
end;
$$;

-- nexamonVaultAskCents: the vault's ask, value + premiumMinBps .. premiumMaxBps (u in [0, 1))
create or replace function public.nexamon_vault_ask_cents(p_value bigint, p_u double precision)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(1, floor(coalesce(p_value, 0)::numeric
           * (10000 + coalesce((v ->> 'premiumMinBps')::integer, 1500)
              + floor((coalesce((v ->> 'premiumMaxBps')::integer, 2500) - coalesce((v ->> 'premiumMinBps')::integer, 1500))
                      * least(1, greatest(0, coalesce(p_u, 0)))::numeric)) / 10000)::bigint)
    from (select coalesce(public.nexamon_cfg() -> 'vault', '{}'::jsonb) as v) c;
$$;

-- The AI sellers offer up to ai.listedPerCard raw copies of a card (p_extra more, for a legendary) and every slab
-- whose hold has passed; the vault's copies never (it relists on its own, nexamon_run_due section 2b).
create or replace function public.nexamon_ai_restock(p_card text, p_now timestamptz, p_extra integer default 0)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  k        public.nexamon_cards;
  v_vault  text := coalesce(public.nexamon_cfg() #>> '{instantSell,vaultOwner}', 'NEXA-Tresor');
  v_limit  integer;
  v_listed integer;
  v_n      integer := 0;
  r        record;
begin
  select * into k from public.nexamon_cards where card_key = p_card;
  if k.card_key is null then
    return 0;
  end if;
  v_limit := coalesce((public.nexamon_cfg() #>> array['ai', 'listedPerCard', k.rarity])::integer, 0) + greatest(0, coalesce(p_extra, 0));
  select count(*) into v_listed from public.nexamon_listings l join public.nexamon_copies c on c.id = l.copy_id
   where l.card_key = p_card and l.seller_ai is not null and l.seller_ai is distinct from v_vault and c.grade is null;
  for r in select c.id, c.ai_owner, c.condition, c.grade from public.nexamon_copies c
            where c.card_key = p_card and c.ai_owner is not null and c.ai_owner is distinct from v_vault and c.grade is null
              and not exists (select 1 from public.nexamon_listings l where l.copy_id = c.id)
            order by c.acquired_at, c.serial
            limit greatest(0, v_limit - v_listed) loop
    insert into public.nexamon_listings (copy_id, card_key, seller_ai, price_cents, created_at)
    values (r.id, p_card, r.ai_owner,
            public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(k.value_e4, r.condition, r.grade, k.card_key)), p_now);
    v_n := v_n + 1;
  end loop;
  -- slabs never leave circulation: once held long enough, the AI lists every one of them
  for r in select c.id, c.ai_owner, c.condition, c.grade from public.nexamon_copies c
            where c.card_key = p_card and c.ai_owner is not null and c.ai_owner is distinct from v_vault
              and c.grade is not null and c.grading_until is null
              and coalesce(c.ai_hold_until, '-infinity'::timestamptz) <= p_now
              and not exists (select 1 from public.nexamon_listings l where l.copy_id = c.id)
            order by c.acquired_at, c.serial loop
    insert into public.nexamon_listings (copy_id, card_key, seller_ai, price_cents, created_at)
    values (r.id, p_card, r.ai_owner,
            public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(k.value_e4, r.condition, r.grade, k.card_key)), p_now);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Every ai.listingResetHours: the AI's offers go (the vault's stay), its raw stock above the cap is retired (slabs
-- and the vault never), then it lists again, held slabs whose time has come included.
create or replace function public.nexamon_ai_reset(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ai        jsonb := public.nexamon_cfg() -> 'ai';
  v_vault   text := coalesce(public.nexamon_cfg() #>> '{instantSell,vaultOwner}', 'NEXA-Tresor');
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
  delete from public.nexamon_listings where seller_ai is not null and seller_ai is distinct from v_vault;
  get diagnostics v_deleted = row_count;
  -- retire the raw stock above the cap, the newest copies first; graded copies and the vault are never retired
  with ranked as (
    select c.id, row_number() over (partition by c.card_key order by c.acquired_at, c.serial) as n,
           coalesce((ai #>> array['stockCap', k.rarity])::integer, 1000000) as cap
      from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
     where c.ai_owner is not null and c.grade is null and c.grading_until is null
       and c.ai_owner is distinct from v_vault
  )
  delete from public.nexamon_copies c using ranked x where x.id = c.id and x.n > x.cap;
  get diagnostics v_retired = row_count;
  for r in select distinct c.card_key from public.nexamon_copies c
            where c.ai_owner is not null and c.ai_owner is distinct from v_vault loop
    v_listed := v_listed + public.nexamon_ai_restock(r.card_key, v_now);
  end loop;
  insert into public.nexamon_meta (id, ai_reset_at) values (true, v_now)
  on conflict (id) do update set ai_reset_at = excluded.ai_reset_at;
  return jsonb_build_object('deleted', v_deleted, 'retired', v_retired, 'listed', v_listed);
end;
$$;
comment on function public.nexamon_ai_reset(timestamptz) is
  'Internal (cron nexa-nexamon-ai-reset): every ai.listingResetHours the AI''s listings are removed (the vault''s '
  'stay), its raw stock above ai.stockCap retired (slabs and the game''s vault never), and it lists again at the '
  'current value, held slabs whose time has come included (ADR-174, ADR-165, ADR-196, ADR-195 Nachtrag).';

-- The minute job (latest definition from 8500; section 2 extended, section 2b new).
create or replace function public.nexamon_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.nexamon_cfg();
  ai        jsonb := public.nexamon_cfg() -> 'ai';
  vt        jsonb := coalesce(public.nexamon_cfg() -> 'vault', '{}'::jsonb);
  v_now     timestamptz := coalesce(p_now, public.game_now());
  v_day     timestamptz := ((coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date)::timestamp
                           at time zone 'Europe/Berlin';
  v_house   uuid := public.ledger_system_account('households');
  v_state   uuid := public.ledger_system_account('treasury');
  v_names   jsonb := coalesce(public.nexamon_cfg() #> '{ai,sellers}', '[]'::jsonb);
  v_excl    jsonb := coalesce(public.nexamon_cfg() #> '{ai,excludedRarities}', '["one_of_one"]'::jsonb);
  v_vault   text := coalesce(public.nexamon_cfg() #>> '{instantSell,vaultOwner}', 'NEXA-Tresor');
  v_floor   bigint := coalesce((public.nexamon_cfg() #>> '{ai,treasuryFloorCents}')::bigint, 0);
  v_graded  integer;
  v_packs   integer := 0;
  v_bought  integer := 0;
  v_unaff   integer := 0;
  v_failed  integer := 0;
  v_funded  bigint := 0;
  v_vlisted integer := 0;
  v_relist  integer := 0;
  v_steps   integer := 0;
  v_due     integer;
  v_n       integer;
  v_per     numeric;
  v_pulls   jsonb;
  v_cash    bigint;
  v_tcash   bigint;
  v_short   bigint;
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

  -- 2. AI collectors buy player listings (nexamonAiBuyChanceBps, ADR-195 and Nachtrag): at or below the copy's value
  --    (with the card, as the UI shows it) always, on this run, whatever the price and rarity and without a budget;
  --    One of Ones and uranium cards go to the game's vault. Above the value up to value x (1 + premium, at most
  --    ai.maxPremiumBps) rarely, more often for popular cards, never for the vault rarities. Fair listings first, then
  --    better copies; only buys above the value check the households' budget per set and Berlin day. A buy at or below
  --    the value the households cannot pay is topped up by the treasury (shortfall only, down to ai.treasuryFloorCents);
  --    if even that is not enough, it is logged and retried on the next run. nexamon_sell() keys each buy by the
  --    listing (no double buys).
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
    if r.price_cents > v_value then
      select coalesce(sum(s.price_cents), 0) into v_spent
        from public.nexamon_sales s join public.nexamon_cards k on k.card_key = s.card_key
       where s.kind = 'ai_buy' and s.at >= v_day and k.set_key = r.set_key;
      continue when v_spent + r.price_cents
                    > coalesce((ai ->> 'dailyBudgetPacks')::bigint, 0) * coalesce((cfg #>> array['sets', r.set_key, 'packPriceCents'])::bigint, 0);
    end if;
    begin
      select a.balance_cents into v_cash from public.ledger_accounts a where a.id = v_house;
      if coalesce(v_cash, 0) < r.price_cents then
        -- premium buys are never funded; a buy at or below the value is (nexamonAiFundingCents)
        continue when r.price_cents > v_value;
        v_short := r.price_cents - greatest(0, coalesce(v_cash, 0));
        select a.balance_cents into v_tcash from public.ledger_accounts a where a.id = v_state;
        if coalesce(v_tcash, 0) - v_short < v_floor then
          v_unaff := v_unaff + 1;
          raise log 'nexamon_run_due: AI buy of listing % (% cents, % %) not affordable: households % cents, treasury % cents, floor % cents; retried next run',
            r.id, r.price_cents, r.card_key, r.rarity, coalesce(v_cash, 0), coalesce(v_tcash, 0), v_floor;
          continue;
        end if;
        perform public.ledger_transfer(v_state, v_house, v_short, 'transfer',
                                       'Staatskasse stockt die Haushalte für einen Nexamon-Kauf zum Marktwert auf',
                                       'nexamon_listing', r.id,
                                       'nexamon:ai:fund:' || r.id::text || ':' || extract(epoch from v_now)::bigint::text, null,
                                       jsonb_build_object('card_key', r.card_key, 'price_cents', r.price_cents,
                                                          'households_cents', coalesce(v_cash, 0), 'shortfall_cents', v_short));
        v_funded := v_funded + v_short;
      end if;
      v_name := case when v_excl ? r.rarity then v_vault
                     else v_names ->> floor(random() * jsonb_array_length(v_names))::integer end;
      perform public.nexamon_sell(r.id, null, v_name, 'nexamon:ai:' || r.id::text, v_now);
      v_bought := v_bought + 1;
    exception when others then
      -- one broken buy must not roll back the whole minute job; the listing stays and is tried again
      v_failed := v_failed + 1;
      raise warning 'nexamon_run_due: AI buy of listing % failed: % (%)', r.id, sqlerrm, sqlstate;
    end;
  end loop;

  -- 2b. the game's vault puts a One of One or uranium card back on the market now and then, above its value
  delete from public.nexamon_listings l
   where l.seller_ai = v_vault
     and l.created_at <= v_now - make_interval(hours => coalesce((vt ->> 'listHours')::integer, 24));
  select count(*) into v_vlisted from public.nexamon_listings l where l.seller_ai = v_vault;
  if coalesce((vt ->> 'relistChancePerDayBps')::integer, 0) > 0 then
    for r in select c.id, c.card_key, c.condition, c.grade, k.value_e4
               from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
              where c.ai_owner = v_vault and c.grading_until is null
                and c.acquired_at <= v_now - make_interval(hours => coalesce((vt ->> 'minHoldHours')::integer, 72))
                and not exists (select 1 from public.nexamon_listings l where l.copy_id = c.id)
              order by random() loop
      exit when v_vlisted >= coalesce((vt ->> 'maxListed')::integer, 0);
      continue when random() * 10000 * 1440 >= (vt ->> 'relistChancePerDayBps')::numeric;
      insert into public.nexamon_listings (copy_id, card_key, seller_ai, price_cents, created_at)
      values (r.id, r.card_key, v_vault,
              public.nexamon_vault_ask_cents(public.nexamon_copy_value_cents(r.value_e4, r.condition, r.grade, r.card_key), random()),
              v_now);
      v_vlisted := v_vlisted + 1;
      v_relist := v_relist + 1;
    end loop;
  end if;

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
  return jsonb_build_object('graded', v_graded, 'ai_packs', v_packs, 'ai_bought', v_bought, 'ai_unaffordable', v_unaff,
                            'ai_failed', v_failed, 'ai_funded_cents', v_funded, 'vault_listed', v_relist,
                            'value_steps', v_steps);
end;
$$;
comment on function public.nexamon_run_due(timestamptz) is
  'Job (cron nexa-nexamon, every minute; ADR-165, ADR-195 and Nachtrag): finishes gradings, opens the AI''s packs, '
  'lets AI collectors buy player listings (at or below the value always, whatever the price and rarity, One of Ones '
  'and uranium into the game''s vault, a shortfall of the households funded by the treasury; above it rarely, at '
  'most +15 %), lets the vault relist now and then above the value, moves the values by supply and demand.';

do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.nexamon_ai_buy_chance_bps(bigint, bigint, text, double precision, text, bigint)',
    'public.nexamon_vault_ask_cents(bigint, double precision)',
    'public.nexamon_ai_restock(text, timestamptz, integer)',
    'public.nexamon_ai_reset(timestamptz)',
    'public.nexamon_run_due(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$do$;
