-- ===== idempotent copy of migrations/20261203000900_snapshot_cache.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0900 · The market snapshot is built once per tick, not once per request (ADR-123)
-- =============================================================================
-- Every open tab asks for get_market_snapshot() every tick. The answer is the same for every player, but each call
-- built it anew (all quotes, logos, money supply over the ledger): about 0.5 s of database time per call, thousands
-- of calls an hour. Now the first call of a tick builds it and stores it in market_snapshot_cache; every other call
-- of that tick reads the stored answer. Only server_time is added per call.
-- Idempotent: runs unchanged as supabase/updates/20261203000900_snapshot_cache.sql.

create table if not exists public.market_snapshot_cache (
  id        boolean primary key default true check (id),
  tick_seq  bigint not null,
  built_at  timestamptz not null,
  payload   jsonb not null
);
alter table public.market_snapshot_cache enable row level security;
revoke all on public.market_snapshot_cache from public, anon, authenticated;
comment on table public.market_snapshot_cache is 'The market snapshot of the latest tick (ADR-123). Internal; read through get_market_snapshot().';

-- Not stable any more: the first call of a tick writes the cache.
drop function if exists public.get_market_snapshot();
create function public.get_market_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := public.game_now();
  v_tick    bigint;
  v_cache   public.market_snapshot_cache;
  v_index   jsonb;
  v_secs    jsonb;
  v_payload jsonb;
begin
  perform public.require_player();
  select coalesce(r.tick_seq, 0) into v_tick from public.sim_runtime r where r.id;
  select * into v_cache from public.market_snapshot_cache c where c.id;
  -- the same tick, and not older than a minute (a paused market still refreshes its economy figures)
  if v_cache.id is not null and v_cache.tick_seq = coalesce(v_tick, 0) and v_cache.built_at > now() - interval '1 minute' then
    return v_cache.payload || jsonb_build_object('server_time', v_now);
  end if;

  select jsonb_build_object(
           'ticker', upper(i.key), 'name', s.name, 'value_e4', q.last_price_e4,
           'prev_close_e4', coalesce(q.prev_close_e4, q.last_price_e4), 'change_bps', q.change_bps,
           'day_high_e4', q.day_high_e4, 'day_low_e4', q.day_low_e4)
    into v_index
    from public.indices i
    join public.securities s on s.id = i.security_id
    join public.security_quotes q on q.security_id = s.id
   order by i.created_at
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'ticker', s.ticker, 'name', s.name, 'kind', s.kind,
           'sector_key', s.sector_key, 'size_class', c.tier,
           'last_price_e4', q.last_price_e4, 'bid_e4', q.bid_e4, 'ask_e4', q.ask_e4,
           'prev_close_e4', coalesce(q.prev_close_e4, q.last_price_e4), 'change_bps', q.change_bps,
           'day_high_e4', coalesce(q.day_high_e4, q.last_price_e4), 'day_low_e4', coalesce(q.day_low_e4, q.last_price_e4),
           'day_volume_e6', q.day_volume_e6, 'market_cap_cents', case when s.kind = 'stock' then q.market_cap_cents end,
           'term_game_years', b.term_game_years, 'coupon_bps', b.coupon_bps,
           'yield_bps', case when s.kind = 'bond' then q.yield_bps end,
           'matures_at', b.matures_at, 'face_value_cents', b.face_value_cents,
           'company_id', s.company_id, 'brand_color', c.brand_color,
           'logo', case when s.company_id is not null then public.company_logo(s.company_id) end,
           'company_kind', case when c.id is not null and not c.is_ai then 'player' else 'ai' end)
         order by case s.kind when 'stock' then 0 else 1 end, sec.sort_order, b.term_game_years, s.ticker), '[]'::jsonb)
    into v_secs
    from public.securities s
    join public.security_quotes q on q.security_id = s.id
    left join public.companies c on c.id = s.company_id
    left join public.sectors sec on sec.key = s.sector_key
    left join public.bonds b on b.security_id = s.id
   where s.status = 'listed' and s.kind in ('stock', 'bond');

  v_payload := jsonb_build_object(
    'tick_seq',        (select r.tick_seq from public.sim_runtime r where r.id),
    'last_tick_at',    (select r.last_tick_at from public.sim_runtime r where r.id),
    'session',         public.market_session_at(v_now),
    'paused',          coalesce((select r.is_paused from public.sim_runtime r where r.id), false),
    'policy_rate_bps', (select cb.policy_rate_bps from public.central_bank_state cb where cb.id),
    'day_start',       public.trading_day_start(v_now),
    'index',           v_index,
    'securities',      v_secs,
    'economy',         jsonb_build_object(
                         'money_supply_cents',      public.money_supply_cents(),
                         'treasury_cents',          public.treasury_balance_cents(),
                         'basic_income_factor_bps', public.basic_income_factor_bps(),
                         'total_supply_cents',      public.config_bigint('money', '{totalSupplyCents}', 1000000000000)));

  insert into public.market_snapshot_cache (id, tick_seq, built_at, payload)
  values (true, coalesce(v_tick, 0), now(), v_payload)
  on conflict (id) do update set tick_seq = excluded.tick_seq, built_at = excluded.built_at, payload = excluded.payload;
  return v_payload || jsonb_build_object('server_time', v_now);
end;
$$;
comment on function public.get_market_snapshot() is 'RPC: quotes, index and economy of the latest tick, built once per tick (ADR-123).';
revoke all on function public.get_market_snapshot() from public, anon;
grant execute on function public.get_market_snapshot() to authenticated, service_role;

-- Listings, names, colours and logos change within a tick (IPO, new logo): then the cached answer is dropped.
create or replace function public.market_snapshot_invalidate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.market_snapshot_cache;
  return null;
end;
$$;
revoke all on function public.market_snapshot_invalidate() from public, anon, authenticated;

drop trigger if exists market_snapshot_securities_ins on public.securities;
create trigger market_snapshot_securities_ins after insert or delete on public.securities
  for each statement execute function public.market_snapshot_invalidate();
drop trigger if exists market_snapshot_securities_upd on public.securities;
create trigger market_snapshot_securities_upd after update on public.securities
  for each row when (old.status is distinct from new.status or old.name is distinct from new.name
                     or old.sector_key is distinct from new.sector_key or old.company_id is distinct from new.company_id)
  execute function public.market_snapshot_invalidate();
drop trigger if exists market_snapshot_companies_upd on public.companies;
create trigger market_snapshot_companies_upd after update on public.companies
  for each row when (old.brand_color is distinct from new.brand_color or old.is_ai is distinct from new.is_ai
                     or old.tier is distinct from new.tier)
  execute function public.market_snapshot_invalidate();
drop trigger if exists market_snapshot_logos_upd on public.player_companies;
create trigger market_snapshot_logos_upd after update on public.player_companies
  for each row when (old.logo is distinct from new.logo or old.logo_hidden is distinct from new.logo_hidden)
  execute function public.market_snapshot_invalidate();
