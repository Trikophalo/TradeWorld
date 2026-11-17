-- =============================================================================
-- NEXA · 6210 · Nexamon: card bonuses and collections (ADR-171)
-- =============================================================================
-- Rule (game_config.nexamon.bonuses; src/config/nexamon-rules.ts; port of src/lib/sim/nexamon-bonuses.ts):
--   * a card of bonuses.rarities (ultra, prisma, legendary), or a rare numbered bonuses.extraNumbers, gives
--     rarityBps[rarity] x setBps[set] / 10 000 bps of the kind typeKind[type] (the card type comes from
--     game_config.nexamon_types) while the player owns a copy that is NOT listed; the best such copy boosts it
--     (slab of slab.minGrade or better x gradeBps, Black Label x blackLabelBps)
--   * collections per set: "type" (every card of a type), "complete" (all 77), "master" (all 77 and every prisma and
--     legendary as an own unlisted slab of grade masterMinGrade or better); while complete they add sets.<kind>.bps x
--     setBps (type: to the type's kind, complete: to sets.complete.kind, master: to every kind)
--   * per kind: raw = sum; effective = raw up to the knee (kneeShareBps of the cap), above it tailBps of the rest,
--     at most caps[kind]
--   * the first completion of a collection pays rewardPacks pack prices of the set from the households (as far as
--     they have it; ledger kind nexamon_set_reward) and rewardXp XP (source nexamon_set), once per player
-- Model:
--   nexamon_player_bonuses           cache per player: effective and raw bps per kind, the active sources, the
--                                    collections; written only by nexamon_bonus_recompute()
--   nexamon_collection_completions   first completion of a collection per player (the reward is paid once)
--   nexamon_bonus_recompute(player)  THE entry point: recomputes the cache, notifies (nexamon_bonus) when bonuses
--                                    come or go, rewards first completions (notification nexamon_set, mission events
--                                    nexamon_bonus_card, nexamon_type_collection, nexamon_set_complete,
--                                    nexamon_master_set, feed kind nexamon_master_set). Every code path that moves a
--                                    copy calls it through the deferred triggers below (pack, buy, sell, list,
--                                    unlist, grading, crack, AI buys, wipes); other features that move copies (pack
--                                    battles) get it for free, or may call it directly.
--   triggers nexamon_copies_bonus / nexamon_listings_bonus: deferred constraint triggers, run at commit once per
--                                    player and transaction, so a sale shows the final state only
-- Applied where the upgrades already apply (ADR-134), as one more source:
--   player_upgrade_bps(): wage_bonus + wage, vault_interest + vault, daily_bonus + daily, task_pay + company
--                         (accrue_job_salary, claim_vault, claim_daily_reward, company_task_resolve)
--   player_xp_bonus_bps(): + xp for every source, + mission_xp for 'mission', + trade_xp for 'trade' (grant_xp)
-- RPC get_nexamon_bonuses(); nexamon_card_json() gets `bonus` {kind, bps, boosted_bps, active} (null: no bonus).
-- Mission templates m_nexamon_first_bonus, m_nexamon_first_type_set, m_nexamon_first_full_set.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Tables (internal)
-- ---------------------------------------------------------------------------
create table if not exists public.nexamon_player_bonuses (
  player_id   uuid primary key references public.profiles (id) on delete cascade,
  effective   jsonb not null default '{}'::jsonb,
  raw         jsonb not null default '{}'::jsonb,
  sources     jsonb not null default '[]'::jsonb,
  collections jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);
alter table public.nexamon_player_bonuses enable row level security;
revoke all on public.nexamon_player_bonuses from public, anon, authenticated;
grant all on public.nexamon_player_bonuses to service_role;
comment on table public.nexamon_player_bonuses is
  'Nexamon card bonuses per player (ADR-171): effective {kind: bps} after stacking and cap, raw {kind: bps}, the '
  'active sources [{id, card_key, kind, bps}] and the collections. Cache, written by nexamon_bonus_recompute().';

create table if not exists public.nexamon_collection_completions (
  player_id    uuid not null references public.profiles (id) on delete cascade,
  set_key      text not null,
  kind         text not null check (kind in ('type', 'complete', 'master')),
  type_key     text not null default '',
  first_at     timestamptz not null default now(),
  reward_cents bigint not null default 0 check (reward_cents >= 0),
  reward_xp    integer not null default 0 check (reward_xp >= 0),
  primary key (player_id, set_key, kind, type_key)
);
alter table public.nexamon_collection_completions enable row level security;
revoke all on public.nexamon_collection_completions from public, anon, authenticated;
grant all on public.nexamon_collection_completions to service_role;
comment on table public.nexamon_collection_completions is
  'First completion of a Nexamon collection per player (ADR-171): type (type_key = the type), complete or master; '
  'the one-time reward paid then. Badges on the profile. Internal.';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('nexamon_bonus', 'social', 'Karten-Bonus', 'Ein Bonus deiner Nexamon-Karten ist aktiv geworden oder weggefallen.',
        'notif_bell', true, false, false, 301),
       ('nexamon_set', 'social', 'Sammlung komplett', 'Du hast eine Nexamon-Sammlung vervollständigt.', 'notif_bell',
        true, true, false, 302)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Rules (port of src/lib/sim/nexamon-bonuses.ts)
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_types()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select g.value from public.game_config g where g.key = 'nexamon_types'), '{}'::jsonb);
$$;

-- nexamonCardBonusDef: {kind, bps} of a raw copy, or null
create or replace function public.nexamon_card_bonus_def(p_rarity text, p_set text, p_number integer, p_type text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select public.nexamon_cfg() -> 'bonuses' as v)
  select case when b.v is null or p_type is null then null
              when not (coalesce(b.v -> 'rarities', '[]'::jsonb) ? p_rarity
                        or (p_rarity = 'rare' and coalesce(b.v -> 'extraNumbers', '[]'::jsonb) @> to_jsonb(p_number))) then null
              when b.v #>> array['typeKind', p_type] is null then null
              when coalesce((b.v #>> array['rarityBps', p_rarity])::bigint, 0)
                   * coalesce((b.v #>> array['setBps', p_set])::bigint, 10000) / 10000 <= 0 then null
              else jsonb_build_object('kind', b.v #>> array['typeKind', p_type],
                                      'bps', (coalesce((b.v #>> array['rarityBps', p_rarity])::bigint, 0)
                                              * coalesce((b.v #>> array['setBps', p_set])::bigint, 10000) / 10000)::integer)
         end
    from b;
$$;

-- nexamonSlabBoostBps
create or replace function public.nexamon_slab_boost_bps(p_grade double precision)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with s as (select public.nexamon_cfg() #> '{bonuses,slab}' as v)
  select case when p_grade >= 10.75 then coalesce((s.v ->> 'blackLabelBps')::integer, 10000)
              when p_grade >= coalesce((s.v ->> 'minGrade')::double precision, 9) then coalesce((s.v ->> 'gradeBps')::integer, 10000)
              else 10000 end
    from s;
$$;

-- nexamonStackBps
create or replace function public.nexamon_stack_bps(p_raw bigint, p_kind text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select public.nexamon_cfg() -> 'bonuses' as v),
       c as (select coalesce((b.v #>> array['caps', p_kind])::bigint, 0) as cap,
                    coalesce((b.v ->> 'kneeShareBps')::bigint, 5000) as knee_share,
                    coalesce((b.v ->> 'tailBps')::bigint, 5000) as tail
               from b),
       k as (select c.cap, c.tail, c.cap * c.knee_share / 10000 as knee, greatest(0, coalesce(p_raw, 0)) as raw from c)
  select least(k.cap, case when k.raw <= k.knee then k.raw else k.knee + (k.raw - k.knee) * k.tail / 10000 end)::integer
    from k;
$$;

-- "0,5 %" for 50 bps
create or replace function public.nexamon_bps_text(p_bps integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(trim(trailing '.' from trim(trailing '0' from to_char(coalesce(p_bps, 0) / 100.0, 'FM999990.00'))), '.', ',') || ' %';
$$;

create or replace function public.nexamon_bonus_kind_text(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'xp' then 'XP' when 'mission_xp' then 'Missions-XP' when 'trade_xp' then 'Handels-XP'
                     when 'wage' then 'Gehalt' when 'vault' then 'Tresorzinsen' when 'daily' then 'Tagesbonus'
                     when 'company' then 'Auftragserlöse' else coalesce(p_kind, '?') end;
$$;

-- the bonus of one card for a viewer: {kind, bps, boosted_bps, active, best_grade} (live, not from the cache)
create or replace function public.nexamon_card_bonus_json(p_card text, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select public.nexamon_card_bonus_def(k.rarity, k.set_key, k.number, public.nexamon_types() ->> k.card_key) as def
      from public.nexamon_cards k where k.card_key = p_card
  ), o as (
    select count(*) as n, max(c.grade) as best
      from public.nexamon_copies c
     where c.card_key = p_card and c.owner_id = p_viewer and p_viewer is not null
       and not exists (select 1 from public.nexamon_listings l where l.copy_id = c.id)
  )
  select case when d.def is null then null
              else d.def || jsonb_build_object(
                     'boosted_bps', ((d.def ->> 'bps')::bigint * public.nexamon_slab_boost_bps(o.best) / 10000)::integer,
                     'active', o.n > 0, 'best_grade', o.best) end
    from d, o;
$$;

-- ---------------------------------------------------------------------------
-- C. The cache: nexamon_bonus_recompute(player)
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_bonus_recompute(p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.nexamon_cfg();
  b         jsonb := public.nexamon_cfg() -> 'bonuses';
  v_types   jsonb := public.nexamon_types();
  v_now     timestamptz := public.game_now();
  v_cards   jsonb;
  v_cols    jsonb;
  v_sources jsonb;
  v_raw     jsonb := '{}'::jsonb;
  v_eff     jsonb := '{}'::jsonb;
  v_prev    jsonb;
  v_on      jsonb;
  v_off     jsonb;
  v_kind    text;
  v_sum     bigint;
  v_names   jsonb := coalesce((select g.value from public.game_config g where g.key = 'nexamon_names'), '{}'::jsonb);
  v_text    text;
  v_cents   bigint;
  v_xp      integer;
  v_hh      bigint;
  v_key     text;
  v_ok      text;
  r         record;
begin
  if p_player is null or not exists (select 1 from public.profiles p where p.id = p_player) then
    return null;
  end if;
  if b is null then
    delete from public.nexamon_player_bonuses where player_id = p_player;
    return null;
  end if;

  -- every catalogue card with the player's best unlisted copy
  if to_regclass('pg_temp.nx_bonus_own') is null then
    create temporary table nx_bonus_own (
      card_key text, set_key text, number integer, rarity text, type text, owned boolean, best double precision
    ) on commit drop;
  end if;
  truncate pg_temp.nx_bonus_own;
  insert into pg_temp.nx_bonus_own
  select k.card_key, k.set_key, k.number, k.rarity, v_types ->> k.card_key, o.card_key is not null, o.best
    from public.nexamon_cards k
    left join (select c.card_key, max(c.grade) as best
                 from public.nexamon_copies c
                where c.owner_id = p_player
                  and not exists (select 1 from public.nexamon_listings l where l.copy_id = c.id)
                group by c.card_key) o on o.card_key = k.card_key
   where k.in_catalogue;

  -- card sources
  select coalesce(jsonb_agg(jsonb_build_object('id', 'card:' || x.card_key, 'card_key', x.card_key, 'kind', x.def ->> 'kind',
                                               'bps', ((x.def ->> 'bps')::bigint * public.nexamon_slab_boost_bps(x.best) / 10000)::integer)
                            order by x.set_key, x.number), '[]'::jsonb)
    into v_cards
    from (select o.*, public.nexamon_card_bonus_def(o.rarity, o.set_key, o.number, o.type) as def
            from pg_temp.nx_bonus_own o where o.owned) x
   where x.def is not null;

  -- collections (nexamonCollections)
  with t as (
    select o.set_key, o.type, count(*) as need, count(*) filter (where o.owned) as have,
           coalesce(jsonb_agg(o.card_key order by o.number) filter (where not o.owned), '[]'::jsonb) as missing
      from pg_temp.nx_bonus_own o where o.type is not null group by o.set_key, o.type
  ), s as (
    select o.set_key, count(*) as need, count(*) filter (where o.owned) as have,
           coalesce(jsonb_agg(o.card_key order by o.number) filter (where not o.owned), '[]'::jsonb) as missing,
           count(*) filter (where coalesce(b #> '{sets,masterRarities}', '[]'::jsonb) ? o.rarity) as top,
           count(*) filter (where coalesce(b #> '{sets,masterRarities}', '[]'::jsonb) ? o.rarity and o.owned
                              and o.best >= coalesce((b #>> '{sets,masterMinGrade}')::double precision, 9)) as top_have,
           coalesce(jsonb_agg(o.card_key order by o.number)
                      filter (where not o.owned
                                 or (coalesce(b #> '{sets,masterRarities}', '[]'::jsonb) ? o.rarity
                                     and not coalesce(o.best >= coalesce((b #>> '{sets,masterMinGrade}')::double precision, 9), false))),
                    '[]'::jsonb) as master_missing
      from pg_temp.nx_bonus_own o group by o.set_key
  ), cols as (
    select t.set_key, 'type' as kind, t.type, t.have, t.need, t.missing, b #>> array['typeKind', t.type] as bonus_kind,
           (coalesce((b #>> '{sets,type,bps}')::bigint, 0) * coalesce((b #>> array['setBps', t.set_key])::bigint, 10000) / 10000)::integer as bonus_bps
      from t
    union all
    select s.set_key, 'complete', null, s.have, s.need, s.missing, b #>> '{sets,complete,kind}',
           (coalesce((b #>> '{sets,complete,bps}')::bigint, 0) * coalesce((b #>> array['setBps', s.set_key])::bigint, 10000) / 10000)::integer
      from s
    union all
    select s.set_key, 'master', null, s.have + s.top_have, s.need + s.top, s.master_missing, null,
           (coalesce((b #>> '{sets,master,bps}')::bigint, 0) * coalesce((b #>> array['setBps', s.set_key])::bigint, 10000) / 10000)::integer
      from s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', 'col:' || c.set_key || ':' || c.kind || coalesce(':' || c.type, ''), 'set', c.set_key, 'kind', c.kind,
           'type', c.type, 'have', c.have, 'need', c.need, 'complete', c.have = c.need, 'missing', c.missing,
           'bonus_kind', c.bonus_kind, 'bonus_bps', c.bonus_bps)
           order by c.set_key, case c.kind when 'type' then 0 when 'complete' then 1 else 2 end, c.type), '[]'::jsonb)
    into v_cols
    from cols c;

  -- collection sources: type and complete to one kind, master to every kind
  select v_cards || coalesce(jsonb_agg(jsonb_build_object('id', c ->> 'id', 'card_key', null, 'kind', k.kind,
                                                          'bps', (c ->> 'bonus_bps')::integer)), '[]'::jsonb)
    into v_sources
    from jsonb_array_elements(v_cols) c
    cross join lateral (select x as kind from jsonb_array_elements_text(
                          case when c ->> 'bonus_kind' is null then coalesce(b -> 'kinds', '[]'::jsonb)
                               else jsonb_build_array(c ->> 'bonus_kind') end) x) k
   where (c ->> 'complete')::boolean and (c ->> 'bonus_bps')::integer > 0;

  for v_kind in select jsonb_array_elements_text(coalesce(b -> 'kinds', '[]'::jsonb)) loop
    select coalesce(sum((s ->> 'bps')::bigint), 0) into v_sum from jsonb_array_elements(v_sources) s where s ->> 'kind' = v_kind;
    v_raw := v_raw || jsonb_build_object(v_kind, v_sum);
    v_eff := v_eff || jsonb_build_object(v_kind, public.nexamon_stack_bps(v_sum, v_kind));
  end loop;

  -- what came and what went (by source id, collections once)
  select p.sources into v_prev from public.nexamon_player_bonuses p where p.player_id = p_player for update;
  select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_on
    from (select s ->> 'id' as x from jsonb_array_elements(v_sources) s) n
   where not exists (select 1 from jsonb_array_elements(coalesce(v_prev, '[]'::jsonb)) p where p ->> 'id' = n.x);
  select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_off
    from (select p ->> 'id' as x from jsonb_array_elements(coalesce(v_prev, '[]'::jsonb)) p) o
   where not exists (select 1 from jsonb_array_elements(v_sources) s where s ->> 'id' = o.x);

  insert into public.nexamon_player_bonuses as t (player_id, effective, raw, sources, collections, computed_at)
  values (p_player, v_eff, v_raw, v_sources, v_cols, v_now)
  on conflict (player_id) do update
     set effective = excluded.effective, raw = excluded.raw, sources = excluded.sources,
         collections = excluded.collections, computed_at = excluded.computed_at;

  -- notifications: cards that start or stop giving a bonus (collections get their own below)
  if v_prev is not null then
    select string_agg(coalesce(v_names ->> substr(x, 6), substr(x, 6)) || ' (+'
                      || public.nexamon_bps_text((select (s ->> 'bps')::integer from jsonb_array_elements(v_sources) s where s ->> 'id' = x))
                      || ' ' || public.nexamon_bonus_kind_text((select s ->> 'kind' from jsonb_array_elements(v_sources) s where s ->> 'id' = x)) || ')',
                      ', ' order by x)
      into v_text
      from jsonb_array_elements_text(v_on) x where x like 'card:%';
    if v_text is not null then
      perform public.social_notify(p_player, 'nexamon_bonus', 'Karten-Bonus aktiv', 'Jetzt aktiv: ' || v_text || '.',
                                   jsonb_build_object('on', v_on), '/nexamon?tab=bonuses',
                                   'nexamon_bonus:on:' || p_player::text || ':' || txid_current()::text);
      perform public.mission_event(p_player, 'nexamon_bonus_card',
                                   (select count(*) from jsonb_array_elements_text(v_on) x where x like 'card:%'), null);
    end if;
    select string_agg(coalesce(v_names ->> substr(x, 6), substr(x, 6)), ', ' order by x)
      into v_text
      from jsonb_array_elements_text(v_off) x where x like 'card:%';
    if v_text is not null then
      perform public.social_notify(p_player, 'nexamon_bonus', 'Karten-Bonus weg',
                                   'Kein Bonus mehr von: ' || v_text || '. Verkaufte und angebotene Karten zählen nicht.',
                                   jsonb_build_object('off', v_off), '/nexamon?tab=bonuses',
                                   'nexamon_bonus:off:' || p_player::text || ':' || txid_current()::text);
    end if;
  elsif jsonb_array_length(v_cards) > 0 then
    perform public.mission_event(p_player, 'nexamon_bonus_card', jsonb_array_length(v_cards), null);
  end if;

  -- first completions: reward once
  for r in select c ->> 'set' as set_key, c ->> 'kind' as kind, coalesce(c ->> 'type', '') as type_key
             from jsonb_array_elements(v_cols) c where (c ->> 'complete')::boolean loop
    v_cents := coalesce((b #>> array['sets', r.kind, 'rewardPacks'])::bigint, 0)
               * coalesce((cfg #>> array['sets', r.set_key, 'packPriceCents'])::bigint, 0);
    v_xp := coalesce((b #>> array['sets', r.kind, 'rewardXp'])::integer, 0);
    insert into public.nexamon_collection_completions (player_id, set_key, kind, type_key, first_at, reward_cents, reward_xp)
    values (p_player, r.set_key, r.kind, r.type_key, v_now, 0, 0)
    on conflict do nothing
    returning kind into v_ok;
    continue when v_ok is null;
    v_ok := null;
    v_key := 'nexamon_set:' || p_player::text || ':' || r.set_key || ':' || r.kind || ':' || r.type_key;
    if v_cents > 0 then
      perform public.lock_player_accounts(p_player);
      select a.balance_cents into v_hh from public.ledger_accounts a where a.system_key = 'households' for update;
      v_cents := least(v_cents, greatest(0, coalesce(v_hh, 0)));
      if v_cents > 0 then
        perform public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(p_player, 'player_cash'),
                                       v_cents, 'nexamon_set_reward', 'Nexamon-Sammlung komplett', 'nexamon_set', null, v_key, p_player,
                                       jsonb_build_object('set', r.set_key, 'kind', r.kind, 'type', nullif(r.type_key, '')));
        perform public.loan_withhold(p_player, v_cents, v_key);
      end if;
    end if;
    v_xp := coalesce(public.grant_xp(p_player, 'nexamon_set', v_xp, v_key, 'nexamon_set', null), 0);
    update public.nexamon_collection_completions
       set reward_cents = v_cents, reward_xp = v_xp
     where player_id = p_player and set_key = r.set_key and kind = r.kind and type_key = r.type_key;
    v_text := coalesce(cfg #>> array['sets', r.set_key, 'name'], r.set_key);
    perform public.social_notify(p_player, 'nexamon_set',
      case r.kind when 'master' then 'Master-Set!' when 'complete' then 'Set komplett!' else 'Typ-Sammlung komplett' end,
      case r.kind when 'master' then 'Du hast das Master-Set von ' || v_text || ': alle Karten und jede Prisma und Legendary im Slab.'
                  when 'complete' then 'Du hast alle Karten von ' || v_text || '.'
                  else 'Alle Karten vom Typ ' || r.type_key || ' aus ' || v_text || ' sind in deiner Sammlung.' end
        || ' Belohnung: ' || (v_cents / 100)::text || ' € und ' || v_xp::text || ' XP, dazu ein Bonus, solange sie komplett bleibt.',
      jsonb_build_object('set', r.set_key, 'kind', r.kind, 'type', nullif(r.type_key, ''), 'cents', v_cents, 'xp', v_xp),
      '/nexamon?tab=bonuses', v_key);
    perform public.mission_event(p_player,
      case r.kind when 'master' then 'nexamon_master_set' when 'complete' then 'nexamon_set_complete' else 'nexamon_type_collection' end,
      1, null);
    if r.kind = 'master' then
      perform public.feed_post(p_player, 'nexamon_master_set', jsonb_build_object('set', r.set_key, 'name', v_text), v_key);
    end if;
  end loop;

  return jsonb_build_object('effective', v_eff, 'raw', v_raw, 'sources', v_sources, 'collections', v_cols);
end;
$$;
comment on function public.nexamon_bonus_recompute(uuid) is
  'Internal (ADR-171): recomputes a player''s Nexamon card bonuses (cache nexamon_player_bonuses), notifies about '
  'bonuses that come or go and rewards first completions of collections once. Call it after moving copies outside '
  'the usual RPCs; the deferred triggers on nexamon_copies and nexamon_listings already do.';

-- effective bonus of a kind (0 without cache or config)
create or replace function public.player_nexamon_bonus_bps(p_player uuid, p_kind text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (b.effective ->> p_kind)::integer from public.nexamon_player_bonuses b where b.player_id = p_player), 0);
$$;
comment on function public.player_nexamon_bonus_bps(uuid, text) is
  'Internal (ADR-171): a player''s effective Nexamon card bonus of a kind in bps (after stacking and cap).';

-- ---------------------------------------------------------------------------
-- D. Deferred triggers: once per player and transaction, at commit
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_bonus_touch(p_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done text := coalesce(current_setting('nexa.nx_bonus_done', true), '');
  v_tx   text := txid_current()::text;
begin
  if p_player is null then
    return;
  end if;
  if split_part(v_done, '|', 1) = v_tx and position(p_player::text in v_done) > 0 then
    return;
  end if;
  if split_part(v_done, '|', 1) <> v_tx then
    v_done := v_tx;
  end if;
  perform set_config('nexa.nx_bonus_done', v_done || '|' || p_player::text, true);
  perform public.nexamon_bonus_recompute(p_player);
end;
$$;

create or replace function public.nexamon_copies_bonus_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.nexamon_bonus_touch(old.owner_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.nexamon_bonus_touch(new.owner_id);
  end if;
  return null;
end;
$$;

create or replace function public.nexamon_listings_bonus_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.nexamon_bonus_touch(old.seller_id);
  else
    perform public.nexamon_bonus_touch(new.seller_id);
  end if;
  return null;
end;
$$;

drop trigger if exists nexamon_copies_bonus on public.nexamon_copies;
create constraint trigger nexamon_copies_bonus after insert or update of owner_id, grade, card_key or delete on public.nexamon_copies
  deferrable initially deferred for each row execute function public.nexamon_copies_bonus_trigger();
drop trigger if exists nexamon_listings_bonus on public.nexamon_listings;
create constraint trigger nexamon_listings_bonus after insert or delete on public.nexamon_listings
  deferrable initially deferred for each row execute function public.nexamon_listings_bonus_trigger();

-- ---------------------------------------------------------------------------
-- E. Applied where the upgrades apply (latest definitions: 20261204000700_more_upgrades.sql)
-- ---------------------------------------------------------------------------
create or replace function public.player_upgrade_bps(p_player uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_player is null then 0
              else least(10000, greatest(0, round(public.player_upgrade_level(p_player, p_key)
                                                  * coalesce(public.cfg_num(public.upgrade_cfg(p_key), '{perLevel}', 0), 0)))
                                + case p_key when 'wage_bonus' then public.player_nexamon_bonus_bps(p_player, 'wage')
                                             when 'vault_interest' then public.player_nexamon_bonus_bps(p_player, 'vault')
                                             when 'daily_bonus' then public.player_nexamon_bonus_bps(p_player, 'daily')
                                             when 'task_pay' then public.player_nexamon_bonus_bps(p_player, 'company')
                                             else 0 end)::integer end;
$$;
comment on function public.player_upgrade_bps(uuid, text) is
  'Internal (ADR-134, ADR-171): level x perLevel of a player''s upgrade in bps plus the Nexamon card bonus of the '
  'matching kind (wage_bonus: wage, vault_interest: vault, daily_bonus: daily, task_pay: company), 0..10 000; 0 for no player.';

create or replace function public.player_xp_bonus_bps(p_player uuid, p_source text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce(sum(least(10000, greatest(0, round(least(u.level, public.cfg_num(c.cfg, '{maxLevel}', 0))
                                                        * public.cfg_num(c.cfg, '{perLevel}', 0))))), 0)
          + public.player_nexamon_bonus_bps(p_player, 'xp')
          + case p_source when 'mission' then public.player_nexamon_bonus_bps(p_player, 'mission_xp')
                          when 'trade' then public.player_nexamon_bonus_bps(p_player, 'trade_xp')
                          else 0 end)::integer
    from public.player_upgrades u
   cross join lateral (select public.upgrade_cfg(u.key) as cfg) c
   where u.player_id = p_player and u.level > 0 and c.cfg is not null
     and jsonb_typeof(c.cfg -> 'xpSources') = 'array'
     and (c.cfg -> 'xpSources' ? p_source or c.cfg -> 'xpSources' ? '*');
$$;
comment on function public.player_xp_bonus_bps(uuid, text) is
  'Internal (ADR-134, ADR-171, xpBonusBps): extra XP of a source in bps from the XP upgrades of a player plus the '
  'Nexamon card bonuses xp (every source), mission_xp (mission) and trade_xp (trade).';

-- ---------------------------------------------------------------------------
-- F. Card JSON with the bonus (latest definition: 20261204005210_nexamon.sql)
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_card_json(p_card text, p_viewer uuid, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'card_key', k.card_key, 'set', k.set_key, 'number', k.number, 'rarity', k.rarity,
           'value_cents', public.div_round_half_even(k.value_e4, 100),
           'start_cents', public.div_round_half_even(k.start_e4, 100),
           'change_bps', case when k.day_ref_on = (p_now at time zone 'Europe/Berlin')::date and k.day_ref_e4 > 0
                              then public.div_round_half_even((k.value_e4 - k.day_ref_e4)::numeric * 10000, k.day_ref_e4) else 0 end,
           'population', k.population,
           'listed', (select count(*) from public.nexamon_listings l where l.card_key = k.card_key),
           'owned', (select count(*) from public.nexamon_copies c where c.card_key = k.card_key and c.owner_id = p_viewer),
           'popularity_bps', public.nexamon_popularity_bps(k.rarity, k.population),
           'floor_cents', public.div_round_half_even(b.floor_e4, 100),
           'cap_cents', public.div_round_half_even(b.cap_e4, 100),
           'bonus', public.nexamon_card_bonus_json(k.card_key, p_viewer))
    from public.nexamon_cards k,
         lateral public.nexamon_bounds(k.start_e4, k.first_pulled_at, k.counted_trades, p_now) b
   where k.card_key = p_card;
$$;

-- ---------------------------------------------------------------------------
-- G. RPC get_nexamon_bonuses()
-- ---------------------------------------------------------------------------
create or replace function public.get_nexamon_bonuses()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b        jsonb := public.nexamon_cfg() -> 'bonuses';
  v_player uuid := public.require_player();
  v_now    timestamptz := public.game_now();
  v_state  jsonb;
begin
  perform public.nexamon_require_unlock(v_player);
  perform public.nexamon_sync(v_now);
  perform public.nexamon_finish_gradings(v_player, v_now);
  v_state := coalesce(public.nexamon_bonus_recompute(v_player), '{}'::jsonb);
  return jsonb_build_object(
    'totals', (select coalesce(jsonb_agg(jsonb_build_object(
                        'kind', k, 'raw_bps', coalesce((v_state #>> array['raw', k])::integer, 0),
                        'effective_bps', coalesce((v_state #>> array['effective', k])::integer, 0),
                        'cap_bps', coalesce((b #>> array['caps', k])::integer, 0)) order by o), '[]'::jsonb)
                 from jsonb_array_elements_text(coalesce(b -> 'kinds', '[]'::jsonb)) with ordinality x(k, o)),
    'cards', (select coalesce(jsonb_agg(jsonb_build_object('card_key', k.card_key) || j.v order by k.set_key, k.number), '[]'::jsonb)
                from public.nexamon_cards k
               cross join lateral (select public.nexamon_card_bonus_json(k.card_key, v_player) as v) j
               where k.in_catalogue and j.v is not null),
    'collections', (select coalesce(jsonb_agg(c || jsonb_build_object('completed_at', x.first_at) order by o), '[]'::jsonb)
                      from jsonb_array_elements(coalesce(v_state -> 'collections', '[]'::jsonb)) with ordinality e(c, o)
                      left join public.nexamon_collection_completions x
                        on x.player_id = v_player and x.set_key = c ->> 'set' and x.kind = c ->> 'kind'
                       and x.type_key = coalesce(c ->> 'type', '')),
    'server_time', v_now);
end;
$$;
comment on function public.get_nexamon_bonuses() is
  'RPC (ADR-171): the caller''s Nexamon card bonuses: totals [{kind, raw_bps, effective_bps, cap_bps}], cards [{card_key, '
  'kind, bps, boosted_bps, active, best_grade}] (every card that gives a bonus), collections [{id, set, kind, type, '
  'have, need, complete, missing, bonus_kind, bonus_bps, completed_at}], server_time; error nexamon_locked.';
revoke all on function public.get_nexamon_bonuses() from public, anon;
grant execute on function public.get_nexamon_bonuses() to authenticated, service_role;

do $do$
begin
  revoke all on function public.nexamon_bonus_recompute(uuid) from public, anon, authenticated;
  revoke all on function public.nexamon_bonus_touch(uuid) from public, anon, authenticated;
  revoke all on function public.player_nexamon_bonus_bps(uuid, text) from public, anon, authenticated;
  revoke all on function public.nexamon_card_bonus_json(text, uuid) from public, anon, authenticated;
  revoke all on function public.nexamon_card_bonus_def(text, text, integer, text) from public, anon, authenticated;
end;
$do$;

-- ---------------------------------------------------------------------------
-- H. Feed and NEXA Nachrichten: a master set is news
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
  v_old text := $t$    when 'nexamon_pull' then$t$;
  v_new text := $t$    when 'nexamon_master_set' then 'Master-Set von ' || coalesce(p_payload ->> 'name', 'Nexamon') || ' komplett'
    when 'nexamon_pull' then$t$;
begin
  if position('nexamon_master_set' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'feed_item_label() has an unexpected shape; add the feed kind nexamon_master_set (ADR-171) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure);
  v_old text := $t$'nexamon_pull',$t$;
  v_new text := $t$'nexamon_pull', 'nexamon_master_set',$t$;
begin
  if position('nexamon_master_set' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'news_show_build() has an unexpected shape; add the feed kind nexamon_master_set (ADR-171) to the gossip source by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- I. Missions
-- ---------------------------------------------------------------------------
insert into public.mission_templates
  (key, kind, title, description, icon_key, metric, mode, params, target_min, target_max, xp_min, xp_max, min_level, chain_order,
   scale_with_level, weight, reward_skill_points)
values
  ('m_nexamon_first_bonus', 'milestone', 'Dein erster Karten-Bonus', 'Besitz eine Nexamon-Karte, die einen Account-Bonus bringt.', 'mission_art', 'nexamon_bonus_card', 'count', '{"unlock":"nexamon"}'::jsonb, 1, 1, 800, 800, 10, 171, false, 40, 1),
  ('m_nexamon_first_type_set', 'milestone', 'Erste Typ-Sammlung', 'Sammle alle Karten eines Typs aus einem Set.', 'mission_art', 'nexamon_type_collection', 'count', '{"unlock":"nexamon"}'::jsonb, 1, 1, 2000, 2000, 10, 172, false, 30, 1),
  ('m_nexamon_first_full_set', 'milestone', 'Ein Set komplett', 'Sammle alle 77 Karten eines Sets.', 'mission_art', 'nexamon_set_complete', 'count', '{"unlock":"nexamon"}'::jsonb, 1, 1, 6000, 6000, 10, 173, false, 20, 1)
on conflict (key) do update
   set kind = excluded.kind, title = excluded.title, description = excluded.description, icon_key = excluded.icon_key,
       metric = excluded.metric, mode = excluded.mode, params = excluded.params, target_min = excluded.target_min,
       target_max = excluded.target_max, xp_min = excluded.xp_min, xp_max = excluded.xp_max, min_level = excluded.min_level,
       chain_order = excluded.chain_order, scale_with_level = excluded.scale_with_level, weight = excluded.weight,
       reward_skill_points = excluded.reward_skill_points, is_active = true, updated_at = now();
