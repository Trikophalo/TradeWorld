-- =============================================================================
-- NEXA · 6710 · Nexamon: sealed booster packs (ADR-177)
-- =============================================================================
-- Booster packs a player owns but has not opened yet ("Ungeöffnete Booster" in Collectibles): won in news battles
-- or bought to open later. Opening one runs exactly the pull of a bought pack (public.nexamon_open_pack, called by
-- name; the population, the live opening trigger on nexamon_packs and the missions as with buy_nexamon_pack), but
-- charges nothing. buy_nexamon_pack itself stays untouched.
-- * Table nexamon_sealed_packs (owner, set, source battle | bought, price paid, created_at, opened_at, pack_id).
-- * nexamon_grant_sealed_packs(player, set, count, source, battle) -> count: internal, used by the battle prizes.
-- * RPC get_nexamon_sealed_packs(): the unopened packs of the caller (works while Nexamon is still locked).
-- * RPC open_nexamon_sealed_pack(request_id, pack_id): opens one (answer like buy_nexamon_pack plus sealed_id).
-- * RPC buy_nexamon_sealed_pack(request_id, set, count): charges like buy_nexamon_pack (same set price, same
--   ledger kind nexamon_pack, cash -> households, same rate limit) and puts count packs into the inventory.
-- Errors: sealed_pack_unknown NX290 (and those of buy_nexamon_pack).
-- Idempotent: runs unchanged as supabase/updates/20261204006710_nexamon_sealed_packs.sql.

-- ---------------------------------------------------------------------------
-- A. Error key
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
  v_new text := $q$    when 'sealed_pack_unknown'        then 'NX290'
    else 'NX007'$q$;
begin
  if position('''sealed_pack_unknown''' in v_def) = 0 then
    if position($q$    else 'NX007'$q$ in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the sealed pack error key (ADR-177) by hand';
    end if;
    execute replace(v_def, $q$    else 'NX007'$q$, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- B. Table (internal: read and written only by the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.nexamon_sealed_packs (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.profiles (id) on delete cascade,
  set_key     text not null,
  source      text not null check (source in ('battle', 'bought')),
  price_cents bigint not null default 0 check (price_cents >= 0),
  battle_id   bigint,
  created_at  timestamptz not null default now(),
  opened_at   timestamptz,
  pack_id     uuid
);
create index if not exists nexamon_sealed_packs_player_idx on public.nexamon_sealed_packs (player_id, created_at);
alter table public.nexamon_sealed_packs enable row level security;
revoke all on public.nexamon_sealed_packs from public, anon, authenticated;
grant all on public.nexamon_sealed_packs to service_role;
comment on table public.nexamon_sealed_packs is
  'Sealed Nexamon booster packs (ADR-177): won in news battles (source battle) or bought to open later (bought, '
  'price_cents paid). opened_at/pack_id once opened (nexamon_packs). Internal (RPCs get_nexamon_sealed_packs, '
  'open_nexamon_sealed_pack, buy_nexamon_sealed_pack).';

-- ---------------------------------------------------------------------------
-- C. Helpers
-- ---------------------------------------------------------------------------
-- p_count sealed packs of a set for a player; 0 for an unknown set or a count below 1
create or replace function public.nexamon_grant_sealed_packs(p_player uuid, p_set text, p_count integer, p_source text,
                                                            p_battle bigint default null, p_price_cents bigint default 0)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_player is null or coalesce(p_count, 0) < 1
     or public.nexamon_cfg() #> array['sets', p_set] is null then
    return 0;
  end if;
  insert into public.nexamon_sealed_packs (player_id, set_key, source, price_cents, battle_id, created_at)
  select p_player, p_set, p_source, greatest(0, coalesce(p_price_cents, 0)), p_battle, public.game_now()
    from generate_series(1, p_count);
  return p_count;
end;
$$;
revoke all on function public.nexamon_grant_sealed_packs(uuid, text, integer, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.nexamon_grant_sealed_packs(uuid, text, integer, text, bigint, bigint) to service_role;

-- The unopened packs of a player, oldest first
create or replace function public.nexamon_sealed_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'set', s.set_key, 'name', coalesce(public.nexamon_cfg() #>> array['sets', s.set_key, 'name'], s.set_key),
           'source', s.source, 'price_cents', s.price_cents, 'created_at', s.created_at)
           order by s.created_at, s.id), '[]'::jsonb)
    from public.nexamon_sealed_packs s
   where s.player_id = p_player and s.opened_at is null;
$$;
revoke all on function public.nexamon_sealed_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_nexamon_sealed_packs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
begin
  return jsonb_build_object('packs', public.nexamon_sealed_json(v_player), 'unlocked', public.nexamon_unlocked(v_player),
                            'server_time', public.game_now());
end;
$$;
comment on function public.get_nexamon_sealed_packs() is
  'RPC: the caller''s unopened Nexamon booster packs (ADR-177), oldest first, and whether Nexamon is unlocked.';
revoke all on function public.get_nexamon_sealed_packs() from public, anon;
grant execute on function public.get_nexamon_sealed_packs() to authenticated;

create or replace function public.open_nexamon_sealed_pack(p_request_id uuid, p_pack_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_pack   uuid := gen_random_uuid();
  v_cards  jsonb;
  s        public.nexamon_sealed_packs;
  r        record;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_pack_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'open_nexamon_sealed_pack');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into s from public.nexamon_sealed_packs x
   where x.id = p_pack_id and x.player_id = v_player and x.opened_at is null
   for update;
  if s.id is null then
    perform public.api_error('sealed_pack_unknown');
  end if;
  if not exists (select 1 from public.nexamon_cards k where k.set_key = s.set_key and k.in_catalogue) then
    perform public.api_error('nexamon_unknown');
  end if;
  if not public.rate_limit_hit(v_player, 'nexamon_pack', coalesce((cfg #>> '{packs,perMinute}')::integer, 20), 60) then
    perform public.api_error('rate_limited');
  end if;
  perform public.nexamon_sync(v_now);
  -- the pull of a bought pack, without the money
  v_cards := public.nexamon_open_pack(s.set_key, v_player, null, v_pack, v_now);
  insert into public.nexamon_packs (id, player_id, set_key, price_cents, cards, opened_at)
  values (v_pack, v_player, s.set_key, s.price_cents, v_cards, v_now);
  update public.nexamon_sealed_packs set opened_at = v_now, pack_id = v_pack where id = s.id;
  update public.nexamon_set_state set player_packs_opened = player_packs_opened + 1 where set_key = s.set_key;
  perform public.mission_event(v_player, 'nexamon_pack', 1, null);
  for r in select x ->> 'rarity' as rarity from jsonb_array_elements(v_cards) x loop
    if r.rarity <> 'common' then
      perform public.mission_event(v_player, 'nexamon_rare', 1, null);
    end if;
    if r.rarity in ('ultra', 'prisma', 'legendary') then
      perform public.mission_event(v_player, 'nexamon_ultra', 1, null);
    end if;
  end loop;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'pack_id', v_pack, 'sealed_id', s.id, 'set', s.set_key, 'price_cents', s.price_cents, 'cards', v_cards,
    'packs_opened', (select count(*) from public.nexamon_packs p where p.player_id = v_player and p.set_key = s.set_key),
    'sealed_left', (select count(*) from public.nexamon_sealed_packs x where x.player_id = v_player and x.opened_at is null)));
end;
$$;
comment on function public.open_nexamon_sealed_pack(uuid, uuid) is
  'RPC: opens one of the caller''s sealed booster packs (ADR-177) with the pull of a bought pack (nexamon_open_pack), '
  'no charge; answer as buy_nexamon_pack plus sealed_id and sealed_left; errors nexamon_locked, invalid_argument, '
  'sealed_pack_unknown, nexamon_unknown, rate_limited.';
revoke all on function public.open_nexamon_sealed_pack(uuid, uuid) from public, anon;
grant execute on function public.open_nexamon_sealed_pack(uuid, uuid) to authenticated;

create or replace function public.buy_nexamon_sealed_pack(p_request_id uuid, p_set text, p_count integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_price  bigint;
  v_total  bigint;
  v_cash   bigint;
  v_max    integer := coalesce((public.nexamon_cfg() #>> '{packs,perMinute}')::integer, 20);
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_set is null or p_count is null or p_count < 1 or p_count > v_max then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_nexamon_sealed_pack');
  if v_replay is not null then
    return v_replay;
  end if;
  v_price := (cfg #>> array['sets', p_set, 'packPriceCents'])::bigint;
  if v_price is null or v_price < 0 or not exists (select 1 from public.nexamon_cards k where k.set_key = p_set and k.in_catalogue) then
    perform public.api_error('nexamon_unknown');
  end if;
  if not public.rate_limit_hit(v_player, 'nexamon_pack', v_max, 60) then
    perform public.api_error('rate_limited');
  end if;
  v_total := v_price * p_count;
  v_cash := public.lock_player_accounts(v_player);
  if v_cash < v_total then
    perform public.api_error('insufficient_funds');
  end if;
  if v_total > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('households'),
                                   v_total, 'nexamon_pack',
                                   'Booster gekauft (ungeöffnet): ' || p_count || ' × ' || coalesce(cfg #>> array['sets', p_set, 'name'], p_set),
                                   'nexamon_pack', null, 'nexamon:sealed:' || v_player::text || ':' || p_request_id::text, v_player,
                                   jsonb_build_object('set', p_set, 'price_cents', v_price, 'count', p_count, 'sealed', true));
  end if;
  perform public.nexamon_grant_sealed_packs(v_player, p_set, p_count, 'bought', null, v_price);
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'set', p_set, 'count', p_count, 'price_cents', v_total, 'packs', public.nexamon_sealed_json(v_player)));
end;
$$;
comment on function public.buy_nexamon_sealed_pack(uuid, text, integer) is
  'RPC: buys p_count booster packs of a set without opening them (ADR-177): same price and ledger kind as '
  'buy_nexamon_pack, the packs go to the sealed inventory; errors nexamon_locked, invalid_argument, nexamon_unknown, '
  'rate_limited, insufficient_funds.';
revoke all on function public.buy_nexamon_sealed_pack(uuid, text, integer) from public, anon;
grant execute on function public.buy_nexamon_sealed_pack(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- E. A wiped account loses its sealed packs too (account_wipe patched by replace; a deleted profile cascades)
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.account_wipe(uuid, text)'::regprocedure);
  v_old text := $t$  perform public.nexamon_wipe_player(p_player);$t$;
begin
  if position('nexamon_sealed_packs' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'account_wipe() has an unexpected shape; delete the sealed packs (ADR-177) by hand';
    end if;
    execute replace(v_def, v_old, v_old || $t$
  delete from public.nexamon_sealed_packs where player_id = p_player;$t$);
  end if;
end;
$do$;
