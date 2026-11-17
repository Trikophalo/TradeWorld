-- =============================================================================
-- NEXA · 6510 · Nexamon: One of One pulls, AI exclusions, trade-only value (ADR-174)
-- =============================================================================
-- * nexamon_open_pack(): in a player's pack (never the AI's), slot oneOfOne.slot of a set with One of Ones first
--   rolls 1 in oneOfOne.packs. On a hit, under an advisory lock, it takes one of the set's One of Ones that is not in
--   nexamon_one_of_ones yet (uniformly), mints the one copy and registers it; if none is left the slot rolls the
--   normal table. A One of One pull posts the feed item nexamon_one_of_one and tells every active player
--   (notification nexamon_one_of_one). Port of nexamonOpenPack (src/lib/sim/nexamon.ts).
-- * nexamon_rarity_rank(): from game_config.nexamon_rarities.rank (src/config/nexamon/types.ts), so a set's own
--   rarities rank too; one_of_one above legendary (Pack Battle tie-break).
-- * A set with an entry in packRules of kind 'tiers' fills its pack by that rule (nexamonTierRarities): every tier,
--   best first, with 1 / packs and min..max cards from the last slot backwards, the rest the base rarity.
-- * nexamon_pressure_bps(): 0 for value.tradeOnlyRarities (the value moves only through player trades).
-- * nexamon_ai_buy_chance_bps(): 0 for ai.excludedRarities (the AI never buys a One of One).
-- * nexamon_battle_pull(): a One of One counts for the "ultra or better" mission like a legendary.
-- Idempotent: runs unchanged as supabase/updates/20261204006510_nexamon_one_of_one_pulls.sql.

create or replace function public.nexamon_rarity_rank(p_rarity text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (g.value #>> array['rank', p_rarity])::integer from public.game_config g where g.key = 'nexamon_rarities'),
                  array_position(array['common', 'rare', 'ultra', 'prisma', 'legendary', 'one_of_one'], p_rarity) - 1, -1);
$$;

-- nexamonPressureBps: (demand - supply) / want, -10 000 .. +10 000; a card nobody pulled yet stands still, a
-- trade-only rarity too
create or replace function public.nexamon_pressure_bps(p_rarity text, p_population bigint, p_supply bigint, p_recent_buys bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(p_population, 0) <= 0
                   or coalesce(public.nexamon_cfg() #> '{value,tradeOnlyRarities}', '[]'::jsonb) ? p_rarity then 0
              else least(10000, greatest(-10000,
                     trunc((public.nexamon_demand_milli(p_rarity, p_population, p_recent_buys) - 1000 * greatest(0, coalesce(p_supply, 0)))::numeric
                           * 10 / coalesce((public.nexamon_cfg() #>> array['value', 'pressure', 'want', p_rarity])::numeric, 1))))::integer
         end;
$$;

do $do$
declare
  v_def text := pg_get_functiondef('public.nexamon_ai_buy_chance_bps(bigint, bigint, text, double precision, text, bigint)'::regprocedure);
  v_old text := $t$  if coalesce(p_price, 0) <= 0 then$t$;
  v_new text := $t$  if coalesce(ai -> 'excludedRarities', '[]'::jsonb) ? p_rarity then
    return 0;
  end if;
  if coalesce(p_price, 0) <= 0 then$t$;
begin
  if position('excludedRarities' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'nexamon_ai_buy_chance_bps() has an unexpected shape; exclude ai.excludedRarities (ADR-174) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.nexamon_battle_pull(public.nexamon_battles, uuid, timestamptz)'::regprocedure);
  v_old text := $t$if r.rarity in ('ultra', 'prisma', 'legendary') then$t$;
  v_new text := $t$if r.rarity in ('ultra', 'prisma', 'legendary', 'one_of_one') then$t$;
begin
  if position('one_of_one' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'nexamon_battle_pull() has an unexpected shape; count One of Ones for the ultra mission (ADR-174) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- One of One for a player's pack: a free card of the set or null (none left, or the roll missed)
create or replace function public.nexamon_roll_one_of_one(p_set text, p_owner uuid, p_slot integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o     jsonb := coalesce(public.nexamon_cfg() -> 'oneOfOne', '{}'::jsonb);
  v_key text;
begin
  if p_owner is null or p_slot <> coalesce((o ->> 'slot')::integer, 5)
     or not exists (select 1 from public.nexamon_cards k where k.set_key = p_set and k.rarity = 'one_of_one' and k.in_catalogue) then
    return null;
  end if;
  if random() * greatest(1, coalesce((o ->> 'packs')::integer, 5000)) >= 1 then
    return null;
  end if;
  -- one pull at a time takes a One of One; the registry's primary key backs this up
  perform pg_advisory_xact_lock(7311651);
  select k.card_key into v_key
    from public.nexamon_cards k
   where k.set_key = p_set and k.rarity = 'one_of_one' and k.in_catalogue and k.population = 0
     and not exists (select 1 from public.nexamon_one_of_ones x where x.card_key = k.card_key)
   order by random() limit 1;
  return v_key;
end;
$$;

-- Opens one pack of a set for a player or an AI seller (nexamonOpenPack). -> the pulls in slot order
create or replace function public.nexamon_open_pack(p_set text, p_owner uuid, p_ai text, p_pack uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_size   integer := coalesce((public.nexamon_cfg() ->> 'packSize')::integer, 5);
  v_used   text[] := '{}';
  v_out    jsonb := '[]'::jsonb;
  v_rarity text;
  v_key    text;
  v_cond   text;
  v_new    boolean;
  v_copy   uuid;
  v_nick   text;
  v_name   text;
  v_rule   jsonb := public.nexamon_cfg() #> array['packRules', p_set];
  v_slots  text[];
  v_base   text := 'common';
  v_free   integer;
  v_cnt    integer;
  v_hit    boolean;
  k        public.nexamon_cards;
  s        integer;
  i        integer;
  r        record;
  t        record;
begin
  -- a set's own tier rule: the rarity of every slot first (nexamonTierRarities)
  if v_rule is not null and v_rule ->> 'kind' = 'tiers' then
    v_base := coalesce(v_rule ->> 'base', 'common');
    v_slots := array_fill(v_base, array[v_size]);
    v_free := v_size;
    for t in select x from jsonb_array_elements(coalesce(v_rule -> 'tiers', '[]'::jsonb)) x loop
      v_hit := floor(random() * greatest(1, coalesce((t.x ->> 'packs')::integer, 1))) = 0;
      v_cnt := coalesce((t.x ->> 'min')::integer, 1)
               + floor(random() * (greatest(0, coalesce((t.x ->> 'max')::integer, 1) - coalesce((t.x ->> 'min')::integer, 1)) + 1))::integer;
      if v_hit then
        for i in 1 .. v_cnt loop
          exit when v_free < 1;
          v_slots[v_free] := t.x ->> 'rarity';
          v_free := v_free - 1;
        end loop;
      end if;
    end loop;
  end if;
  for s in 1 .. v_size loop
    v_key := public.nexamon_roll_one_of_one(p_set, p_owner, s);
    if v_key is not null then
      v_rarity := 'one_of_one';
    else
      v_rarity := case when v_slots is not null then v_slots[s]
                       when s >= 4 then public.nexamon_slot_rarity(s, random()) else 'common' end;
      select c.card_key into v_key from public.nexamon_cards c
       where c.set_key = p_set and c.rarity = v_rarity and c.in_catalogue
         and (v_rarity <> v_base or c.card_key <> all (v_used))
       order by random() limit 1;
    end if;
    if v_key is null then
      perform public.api_error('nexamon_unknown');
    end if;
    v_used := v_used || v_key;
    v_cond := public.nexamon_roll_condition(random());
    v_new := p_owner is not null
             and not exists (select 1 from public.nexamon_copies x where x.owner_id = p_owner and x.card_key = v_key);
    v_copy := public.nexamon_mint_copy(v_key, p_owner, p_ai, v_cond, case when p_owner is null then 'ai_pack' else 'pack' end,
                                       p_pack, p_now);
    select * into k from public.nexamon_cards where card_key = v_key;
    v_out := v_out || jsonb_build_object(
      'slot', s, 'copy_id', v_copy, 'card_key', v_key, 'rarity', v_rarity, 'condition', v_cond, 'is_new', v_new,
      'serial', k.population, 'population', k.population,
      'value_cents', public.nexamon_copy_value_cents(k.value_e4, v_cond, null));
    if v_rarity = 'one_of_one' then
      begin
        insert into public.nexamon_one_of_ones (card_key, copy_id, player_id, pack_id, pulled_at)
        values (v_key, v_copy, p_owner, p_pack, p_now);
      exception when unique_violation then
        perform public.api_error('nexamon_one_of_one_taken');
      end;
      select p.nickname into v_nick from public.profiles p where p.id = p_owner;
      v_name := coalesce((select g.value ->> v_key from public.game_config g where g.key = 'nexamon_names'), v_key);
      perform public.feed_post(p_owner, 'nexamon_one_of_one',
                               jsonb_build_object('card_key', v_key, 'set', p_set, 'rarity', v_rarity, 'name', v_name,
                                                  'serial', 1, 'condition', v_cond),
                               'nexamon:1of1:' || v_key);
      for r in select p.id from public.profiles p where not p.is_deactivated loop
        perform public.social_notify(r.id, 'nexamon_one_of_one', 'One of One gezogen!',
          coalesce(v_nick, '?') || ' hat ' || v_name || ' gezogen. Diese Karte gibt es im ganzen Spiel nur ein einziges Mal.',
          jsonb_build_object('card_key', v_key, 'set', p_set, 'nickname', v_nick),
          '/nexamon/' || v_key, 'nexamon:1of1:' || v_key);
      end loop;
    elsif p_owner is not null and coalesce(cfg -> 'feedRarities', '[]'::jsonb) ? v_rarity then
      perform public.feed_post(p_owner, 'nexamon_pull',
                               jsonb_build_object('card_key', v_key, 'set', p_set, 'rarity', v_rarity, 'serial', k.population,
                                                  'condition', v_cond),
                               'nexamon:pull:' || v_copy::text);
    end if;
  end loop;
  return v_out;
end;
$$;
