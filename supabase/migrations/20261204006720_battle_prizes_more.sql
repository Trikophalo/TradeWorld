-- =============================================================================
-- NEXA · 6720 · News battles: accessories and sealed Nexamon booster packs as prizes (ADR-177)
-- =============================================================================
-- Two more prize kinds next to xp, money, skin and nft (battles.prizes.weights), chosen when the lobby opens and shown
-- before the battle:
-- * accessory {"kind":"accessory","tier":"rare"}: the tier is drawn from prizes.accessoryTiers; the winner gets a
--   random accessory of the shop catalogue (ADR-155, not the battle exclusives) of that tier they do not own yet. When
--   they own all of them: the money prize instead (fallback).
-- * packs {"kind":"packs","packs":[{"set","count"}]}: sealed booster packs of up to two sets worth at most
--   prizes.packsCapCents together (set prices from game_config.nexamon, battle_pick_packs mirrors pickPackPrize in
--   src/lib/sim/battle/prizes.ts), at most prizes.packsMax packs. They go to nexamon_sealed_packs (source battle).
--   No set fits: the money prize.
-- NFTs stay as before (ADR-160): a gallery NFT nobody owns is handed over (artworks.owner_id), else money.
--   battle_pick_packs(cap, max, u1..u4)  new, internal
--   battle_open, battle_prize_json, battle_prize_label, battle_pay   redefined (copies of 4720 plus the new kinds)
-- Idempotent: runs unchanged as supabase/updates/20261204006720_battle_prizes_more.sql.

-- ---------------------------------------------------------------------------
-- A. The pack pick (src/lib/sim/battle/prizes.ts: pickPackPrize)
-- ---------------------------------------------------------------------------
create or replace function public.battle_pick_packs(p_cap bigint, p_max integer, p_u1 double precision,
                                                    p_u2 double precision, p_u3 double precision, p_u4 double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_keys   text[];
  v_prices bigint[];
  v_n      integer;
  v_main   integer;
  v_mmax   integer;
  v_mcount integer;
  v_rest   bigint;
  v_sec    integer := null;
  v_smax   integer;
  v_out    jsonb;
  k        integer;
begin
  select array_agg(x.key order by x.price desc, x.key), array_agg(x.price order by x.price desc, x.key)
    into v_keys, v_prices
    from (select e.key, (e.value ->> 'packPriceCents')::bigint as price
            from jsonb_each(coalesce(public.nexamon_cfg() -> 'sets', '{}'::jsonb)) e
           where (e.value ->> 'packPriceCents')::bigint > 0 and (e.value ->> 'packPriceCents')::bigint <= p_cap
             and exists (select 1 from public.nexamon_cards c where c.set_key = e.key and c.in_catalogue)) x;
  v_n := coalesce(array_length(v_keys, 1), 0);
  if v_n = 0 or p_max < 1 then
    return '[]'::jsonb;
  end if;
  v_main := least(v_n - 1, floor(p_u1 * v_n)::integer) + 1;
  v_mmax := least(p_max::bigint, p_cap / v_prices[v_main])::integer;
  v_mcount := 1 + least(v_mmax - 1, floor(p_u2 * v_mmax)::integer);
  v_out := jsonb_build_array(jsonb_build_object('set', v_keys[v_main], 'count', v_mcount));
  v_rest := p_cap - v_mcount * v_prices[v_main];
  if p_u3 < 0.5 then
    -- the cheapest other set that still fits
    for k in reverse v_n .. 1 loop
      if k <> v_main and v_prices[k] <= v_rest then v_sec := k; exit; end if;
    end loop;
    if v_sec is not null then
      v_smax := least((p_max - v_mcount)::bigint, v_rest / v_prices[v_sec])::integer;
      if v_smax >= 1 then
        v_out := v_out || jsonb_build_object('set', v_keys[v_sec], 'count', 1 + least(v_smax - 1, floor(p_u4 * v_smax)::integer));
      end if;
    end if;
  end if;
  return v_out;
end;
$$;
revoke all on function public.battle_pick_packs(bigint, integer, double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- The packs of a prize with names and their total price at the current set prices
create or replace function public.battle_packs_json(p_packs jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('kind', 'packs',
    'packs', coalesce(jsonb_agg(jsonb_build_object('set', x ->> 'set', 'count', (x ->> 'count')::integer,
                                                   'name', coalesce(public.nexamon_cfg() #>> array['sets', x ->> 'set', 'name'], x ->> 'set'))
                                order by ord), '[]'::jsonb),
    'cents', coalesce(sum((x ->> 'count')::bigint * coalesce((public.nexamon_cfg() #>> array['sets', x ->> 'set', 'packPriceCents'])::bigint, 0)), 0))
    from jsonb_array_elements(coalesce(p_packs, '[]'::jsonb)) with ordinality as e(x, ord);
$$;
revoke all on function public.battle_packs_json(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B. Opening a lobby draws the prize (4720 plus accessory and packs)
-- ---------------------------------------------------------------------------
create or replace function public.battle_open(p_now timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg    jsonb := public.battles_cfg();
  w      jsonb := cfg #> '{prizes,weights}';
  tw     jsonb := cfg #> '{prizes,accessoryTiers}';
  v_tot  double precision;
  v_roll double precision;
  v_kind text := 'xp';
  v_art  uuid;
  v_id   bigint;
  v_prize jsonb;
  v_tier text;
  v_packs jsonb;
  k      text;
begin
  perform pg_advisory_xact_lock(7311160);
  if exists (select 1 from public.battles b where b.status in ('open', 'running')) then
    return null;
  end if;
  select sum(value::double precision) into v_tot from jsonb_each_text(coalesce(w, '{}'::jsonb));
  v_roll := random() * coalesce(v_tot, 0);
  for k in select key from jsonb_each_text(coalesce(w, '{}'::jsonb)) order by key loop
    v_roll := v_roll - (w ->> k)::double precision;
    if v_roll < 0 then v_kind := k; exit; end if;
  end loop;
  if v_kind = 'nft' then
    v_art := public.battle_free_artwork();
    if v_art is null then v_kind := 'money'; end if;
  elsif v_kind = 'skin' and coalesce(jsonb_array_length(cfg -> 'accessories'), 0) = 0 then
    v_kind := 'xp';
  elsif v_kind = 'accessory' then
    -- the tier: weighted, keys in sorted order (pickWeighted)
    select sum(value::double precision) into v_tot from jsonb_each_text(coalesce(tw, '{}'::jsonb)) where value::double precision > 0;
    v_roll := random() * coalesce(v_tot, 0);
    for k in select key from jsonb_each_text(coalesce(tw, '{}'::jsonb)) where value::double precision > 0 order by key loop
      v_tier := k;
      v_roll := v_roll - (tw ->> k)::double precision;
      exit when v_roll < 0;
    end loop;
    if v_tier is null then v_kind := 'money'; end if;
  elsif v_kind = 'packs' then
    v_packs := public.battle_pick_packs(coalesce((cfg #>> '{prizes,packsCapCents}')::bigint, 0),
                                        coalesce((cfg #>> '{prizes,packsMax}')::integer, 1),
                                        random(), random(), random(), random());
    if jsonb_array_length(v_packs) = 0 then v_kind := 'money'; end if;
  end if;
  v_prize := jsonb_build_object('kind', v_kind);
  if v_kind = 'accessory' then v_prize := v_prize || jsonb_build_object('tier', v_tier); end if;
  if v_kind = 'packs' then v_prize := v_prize || jsonb_build_object('packs', v_packs); end if;
  insert into public.battles (status, seed, prize, artwork_id, opened_at)
  values ('open', floor(random() * 4294967296)::bigint, v_prize, v_art, p_now)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. What the prize is worth, its label, the payout (4720 plus accessory and packs)
-- ---------------------------------------------------------------------------
create or replace function public.battle_prize_json(p_battle public.battles, p_players integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg  jsonb := public.battles_cfg() -> 'prizes';
  v_n  integer := greatest(coalesce(p_players, 0), coalesce((public.battles_cfg() #>> '{lobby,minPlayers}')::integer, 3));
  v_mult double precision := coalesce((public.config_jsonb('progression') ->> 'xpMultiplier')::double precision, 1);
  a    public.artworks;
begin
  if p_battle.result ? 'prize' then
    return p_battle.result -> 'prize';
  end if;
  case p_battle.prize ->> 'kind'
    when 'xp' then
      return jsonb_build_object('kind', 'xp', 'xp',
        round(((cfg ->> 'xpBase')::integer + (cfg ->> 'xpPerPlayer')::integer * v_n) * v_mult)::integer);
    when 'money' then
      return jsonb_build_object('kind', 'money', 'cents',
        (cfg ->> 'moneyBaseCents')::bigint + (cfg ->> 'moneyPerPlayerCents')::bigint * v_n);
    when 'skin' then
      return jsonb_build_object('kind', 'skin', 'accessories',
        coalesce((select jsonb_agg(x ->> 'key') from jsonb_array_elements(public.battles_cfg() -> 'accessories') x), '[]'::jsonb));
    when 'accessory' then
      return jsonb_build_object('kind', 'accessory', 'tier', coalesce(p_battle.prize ->> 'tier', 'rare'));
    when 'packs' then
      return public.battle_packs_json(p_battle.prize -> 'packs');
    when 'nft' then
      select * into a from public.artworks x where x.id = p_battle.artwork_id;
      if a.id is null then
        return jsonb_build_object('kind', 'money', 'cents',
          (cfg ->> 'moneyBaseCents')::bigint + (cfg ->> 'moneyPerPlayerCents')::bigint * v_n);
      end if;
      return jsonb_build_object('kind', 'nft', 'artwork',
        jsonb_build_object('id', a.id, 'title', a.title, 'serial', a.serial, 'rarity', a.rarity, 'pixels', a.pixels));
    else
      return jsonb_build_object('kind', 'xp', 'xp', 0);
  end case;
end;
$$;

create or replace function public.battle_prize_label(p_prize jsonb)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_prize ->> 'kind'
    when 'xp' then coalesce(p_prize ->> 'xp', '0') || ' XP'
    when 'money' then public.format_eur((p_prize ->> 'cents')::bigint)
    when 'skin' then 'das exklusive Accessoire „' || coalesce(p_prize ->> 'name', 'Battle-Skin') || '“'
    when 'accessory' then case when p_prize ? 'name' then 'das Accessoire „' || (p_prize ->> 'name') || '“'
                               else 'ein zufälliges Accessoire (' || case p_prize ->> 'tier' when 'rare' then 'selten'
                                 when 'epic' then 'episch' when 'legendary' then 'legendär' when 'mythic' then 'mythisch'
                                 else 'gewöhnlich' end || ')' end
    when 'packs' then coalesce((select string_agg((x ->> 'count') || ' × ' || coalesce(x ->> 'name', x ->> 'set'), ' + ')
                                  from jsonb_array_elements(p_prize -> 'packs') x), 'Booster') || ' (ungeöffnet)'
    when 'nft' then 'das NFT „' || coalesce(p_prize #>> '{artwork,title}', 'NFT') || '“'
    else 'Ruhm und Ehre' end;
$$;

create or replace function public.battle_pay(p_battle public.battles, p_winner uuid, p_players integer, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.battles_cfg();
  v_prize jsonb := public.battle_prize_json(p_battle, p_players);
  v_money jsonb := jsonb_build_object('kind', 'money', 'cents',
                     (cfg #>> '{prizes,moneyBaseCents}')::bigint + (cfg #>> '{prizes,moneyPerPlayerCents}')::bigint
                       * greatest(p_players, (cfg #>> '{lobby,minPlayers}')::integer), 'fallback', true);
  v_key   text;
  v_name  text;
  v_art   uuid;
  v_xp    integer;
  v_cents bigint;
  v_got   integer := 0;
  a       public.artworks;
  v_e     jsonb;
begin
  if p_winner is null
     or public.battle_prize_wins_today(p_winner, p_now) >= coalesce((cfg #>> '{prizes,dailyPrizeCap}')::integer, 3) then
    return null;
  end if;
  if v_prize ->> 'kind' = 'skin' then
    select x ->> 'key', x ->> 'name' into v_key, v_name
      from jsonb_array_elements(cfg -> 'accessories') x
     where not exists (select 1 from public.player_accessories o where o.player_id = p_winner and o.accessory_key = x ->> 'key')
     order by random() limit 1;
    if v_key is null then
      v_prize := v_money;
    else
      insert into public.player_accessories (player_id, accessory_key, price_paid_cents) values (p_winner, v_key, 0)
      on conflict do nothing;
      return jsonb_build_object('kind', 'skin', 'key', v_key, 'name', v_name);
    end if;
  elsif v_prize ->> 'kind' = 'accessory' then
    -- a random shop accessory of the tier the winner does not own (never a battle exclusive)
    select i ->> 'key', i ->> 'name' into v_key, v_name
      from jsonb_array_elements(coalesce(public.accessories_cfg() -> 'items', '[]'::jsonb)) i
     where i ->> 'rarity' = v_prize ->> 'tier' and not coalesce((i ->> 'exclusive')::boolean, false)
       and not exists (select 1 from public.player_accessories o where o.player_id = p_winner and o.accessory_key = i ->> 'key')
     order by random() limit 1;
    if v_key is null then
      v_prize := v_money;
    else
      insert into public.player_accessories (player_id, accessory_key, price_paid_cents) values (p_winner, v_key, 0)
      on conflict do nothing;
      return jsonb_build_object('kind', 'accessory', 'tier', v_prize ->> 'tier', 'key', v_key, 'name', v_name);
    end if;
  elsif v_prize ->> 'kind' = 'packs' then
    for v_e in select e from jsonb_array_elements(v_prize -> 'packs') e loop
      v_got := v_got + public.nexamon_grant_sealed_packs(p_winner, v_e ->> 'set', (v_e ->> 'count')::integer, 'battle', p_battle.id, 0);
    end loop;
    if v_got > 0 then
      return v_prize;
    end if;
    v_prize := v_money;
  elsif v_prize ->> 'kind' = 'nft' then
    v_art := p_battle.artwork_id;
    if not exists (select 1 from public.artworks x where x.id = v_art and x.owner_id is null and x.ai_owner is null
                     and not exists (select 1 from public.artwork_auctions y where y.artwork_id = x.id and y.status = 'open')) then
      v_art := public.battle_free_artwork(p_battle.artwork_id);
    end if;
    if v_art is null then
      v_prize := v_money;
    else
      update public.artworks set owner_id = p_winner, ask_cents = null, listed_at = null where id = v_art
      returning * into a;
      return jsonb_build_object('kind', 'nft', 'artwork',
        jsonb_build_object('id', a.id, 'title', a.title, 'serial', a.serial, 'rarity', a.rarity, 'pixels', a.pixels));
    end if;
  end if;
  if v_prize ->> 'kind' = 'xp' then
    v_xp := public.grant_xp(p_winner, 'battle'::public.xp_source,
      (cfg #>> '{prizes,xpBase}')::integer + (cfg #>> '{prizes,xpPerPlayer}')::integer
        * greatest(p_players, (cfg #>> '{lobby,minPlayers}')::integer),
      'battle:' || p_battle.id, 'battle', null);
    return jsonb_build_object('kind', 'xp', 'xp', v_xp);
  end if;
  v_cents := (v_prize ->> 'cents')::bigint;
  if v_cents > 0 then
    perform public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(p_winner, 'player_cash'),
                                   v_cents, 'battle_prize'::public.ledger_tx_kind, 'News-Battle gewonnen', 'battle', null,
                                   'battle:' || p_battle.id, p_winner, jsonb_build_object('battle_id', p_battle.id));
  end if;
  return v_prize;
end;
$$;
