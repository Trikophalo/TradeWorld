-- =============================================================================
-- NEXA · 8100 · News-Aktionen: the live show announces a promotion (ADR-193)
-- =============================================================================
-- * news_promos: one row per promotion (kind pack_sale | free_nft | tax_return), tied to the show that announced
--   it, running from the show start for newsPromos.durationMinutes. At most one runs at a time.
-- * news_promo_claims: who used a promotion (free NFT, tax return); one row per player and promotion.
-- * Trigger news_shows_promo (BEFORE UPDATE when a show goes on air): with chance newsPromos.chanceBps the show
--   brings a promotion of a kind other than the previous one; Mr. Doodle Dangle reads it as the last segment
--   (kind 'promo'), the news feed keeps it and every player active in the last notifyActiveDays days gets the
--   notification news_promo (once per player and promotion).
-- * pack_sale: buy_nexamon_pack and buy_nexamon_sealed_pack (latest definitions, 5210/6710 patched by 7240) take
--   their price from news_promo_pack_price: −discountBps for packs of the drawn released set while it runs.
--   buy_nexamon_packs (multi-buy) calls buy_nexamon_pack. Pack battles keep their price.
-- * free_nft: create_artwork (latest definition, 6110 era) mints the first NFT of a player within the promotion
--   without the fee and records the claim.
-- * tax_return: RPC file_news_tax_return pays newsPromos.taxReturn.shareBps of the sales revenue of the player's
--   active companies in the last windowHours closed hours, at most capCents, from the state treasury
--   (ledger kind tax_refund, sum 0, idempotent by request id). AI companies have no founder and never qualify.
-- * RPC get_news_promo: the running promotion with its end, the own claim and the own tax amount.
-- Idempotent: runs unchanged as supabase/updates/20261204008100_news_promos.sql.

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, sort_order)
values ('news_promo', 'social', 'News-Aktion', 'Mr. Doodle Dangle hat in der Show eine Aktion für alle angekündigt.',
        'notif_bell', true, false, 300)
on conflict (key) do nothing;

create table if not exists public.news_promos (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('pack_sale', 'free_nft', 'tax_return')),
  show_id    bigint unique references public.news_shows (id) on delete set null,
  set_key    text,
  bps        integer not null default 0,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  headline   text not null,
  body       text not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((kind = 'pack_sale') = (set_key is not null))
);
create index if not exists news_promos_ends_idx on public.news_promos (ends_at desc);
alter table public.news_promos enable row level security;
drop policy if exists news_promos_read on public.news_promos;
create policy news_promos_read on public.news_promos for select to authenticated using (true);
comment on table public.news_promos is
  'News-Aktionen (ADR-193): a promotion announced in the live show, from starts_at to ends_at; at most one at a time.';

create table if not exists public.news_promo_claims (
  promo_id     bigint not null references public.news_promos (id) on delete cascade,
  player_id    uuid not null references public.profiles (id) on delete cascade,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  revenue_cents bigint,
  ref_id       uuid,
  created_at   timestamptz not null default now(),
  primary key (promo_id, player_id)
);
alter table public.news_promo_claims enable row level security;
drop policy if exists news_promo_claims_own on public.news_promo_claims;
create policy news_promo_claims_own on public.news_promo_claims for select to authenticated
  using (player_id = (select auth.uid()));
comment on table public.news_promo_claims is
  'News-Aktionen (ADR-193): a free NFT (amount = fee saved, ref = artwork) or a tax return (amount = refund) per player.';

create or replace function public.news_promos_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'newsPromos'), '{}'::jsonb);
$$;

-- The promotion running at p_now (at most one).
create or replace function public.news_promo_active(p_now timestamptz)
returns public.news_promos
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.news_promos p
   where p.starts_at <= p_now and p.ends_at > p_now
   order by p.starts_at desc
   limit 1;
$$;

-- Price of a pack of p_set at p_now: the configured price, less the pack sale of that set while it runs.
create or replace function public.news_promo_pack_price(p_set text, p_price bigint, p_now timestamptz)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.news_promos;
begin
  if p_price is null or p_price <= 0 then
    return p_price;
  end if;
  v := public.news_promo_active(p_now);
  if v.id is not null and v.kind = 'pack_sale' and v.set_key = p_set then
    return public.apply_bps(p_price, 10000 - v.bps);
  end if;
  return p_price;
end;
$$;

-- Sales revenue of the player's active companies in the last windowHours closed hours, and the refund.
create or replace function public.news_promo_tax(p_player uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.news_promos_cfg() -> 'taxReturn';
  v_to      timestamptz := date_trunc('hour', p_now);
  v_from    timestamptz := date_trunc('hour', p_now) - make_interval(hours => coalesce((cfg ->> 'windowHours')::integer, 24));
  v_cap     bigint := coalesce((cfg ->> 'capCents')::bigint, 5000000);
  v_owner   boolean;
  v_revenue bigint;
  v_refund  bigint;
begin
  v_owner := exists (select 1 from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active');
  select coalesce(sum(h.revenue_cents), 0)::bigint into v_revenue
    from public.player_company_hours h
    join public.player_companies pc on pc.company_id = h.company_id
   where pc.founder_id = p_player and pc.status = 'active'
     and h.hour_start >= v_from and h.hour_start < v_to;
  v_refund := case when v_revenue <= 0 then 0
                   else least(v_cap, public.apply_bps(v_revenue, coalesce((cfg ->> 'shareBps')::integer, 1000))) end;
  return jsonb_build_object('owner', v_owner, 'revenue_cents', v_revenue, 'refund_cents', v_refund, 'cap_cents', v_cap,
                            'share_bps', coalesce((cfg ->> 'shareBps')::integer, 1000));
end;
$$;

-- The draw (ADR-193): with p_roll < chanceBps a promotion of a kind other than the previous one. Rolls in [0, 1).
-- Returns the show segment for Mr. Doodle Dangle, or null.
create or replace function public.news_promo_draw(p_show_id bigint, p_now timestamptz,
                                                  p_roll double precision default random(),
                                                  p_pick double precision default random())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.news_promos_cfg();
  v_last  text;
  v_kinds text[];
  v_kind  text;
  v_set   text;
  v_bps   integer := 0;
  v_mins  integer := coalesce((cfg ->> 'durationMinutes')::integer, 15);
  v_line  jsonb;
  v_head  text;
  v_body  text;
  v_cap   bigint := coalesce((cfg #>> '{taxReturn,capCents}')::bigint, 5000000);
  v_name  text;
  v_id    bigint;
  r       record;
begin
  if p_roll * 10000 >= coalesce((cfg ->> 'chanceBps')::integer, 0)
     or (p_show_id is not null and exists (select 1 from public.news_promos p where p.show_id = p_show_id))
     or (public.news_promo_active(p_now)).id is not null then
    return null;
  end if;
  select p.kind into v_last from public.news_promos p order by p.starts_at desc, p.id desc limit 1;
  select coalesce(array_agg(k order by o), '{}') into v_kinds
    from jsonb_array_elements_text(coalesce(cfg -> 'kinds', '["pack_sale","free_nft","tax_return"]'::jsonb))
         with ordinality as x(k, o)
   where k is distinct from v_last;
  -- a pack sale needs a released set with a price; without one it is left out
  select s.key into v_set
    from jsonb_each(public.nexamon_cfg() -> 'sets') s
   where coalesce((s.value ->> 'packPriceCents')::bigint, 0) > 0
     and public.nexamon_set_released(s.key, p_now)
     and exists (select 1 from public.nexamon_cards k where k.set_key = s.key and k.in_catalogue)
   order by md5(s.key || p_pick::text)
   limit 1;
  if v_set is null then
    v_kinds := array_remove(v_kinds, 'pack_sale');
  end if;
  if cardinality(v_kinds) = 0 then
    return null;
  end if;
  v_kind := v_kinds[1 + least(cardinality(v_kinds) - 1, floor(p_pick * cardinality(v_kinds))::integer)];
  if v_kind <> 'pack_sale' then
    v_set := null;
  end if;
  v_bps := case v_kind when 'pack_sale' then coalesce((cfg #>> '{packSale,discountBps}')::integer, 2000)
                       when 'tax_return' then coalesce((cfg #>> '{taxReturn,shareBps}')::integer, 1000)
                       else 0 end;
  select x into v_line from jsonb_array_elements(cfg -> 'lines' -> v_kind) x order by random() limit 1;
  v_name := regexp_replace(coalesce(public.nexamon_cfg() #>> array['sets', v_set, 'name'], v_set, ''), '^Nexamon: ', '');
  select replace(replace(replace(replace(t, '{set}', v_name), '{pct}', (v_bps / 100)::text), '{minutes}', v_mins::text),
                 '{cap}', replace(to_char(v_cap / 100, 'FM999,999,999,999'), ',', '.') || ' €')
    into v_head from (select coalesce(v_line ->> 'headline', 'News-Aktion') t) q;
  select replace(replace(replace(replace(t, '{set}', v_name), '{pct}', (v_bps / 100)::text), '{minutes}', v_mins::text),
                 '{cap}', replace(to_char(v_cap / 100, 'FM999,999,999,999'), ',', '.') || ' €')
    into v_body from (select coalesce(v_line ->> 'text', '') t) q;
  insert into public.news_promos (kind, show_id, set_key, bps, starts_at, ends_at, headline, body)
  values (v_kind, p_show_id, v_set, v_bps, p_now, p_now + make_interval(mins => v_mins), v_head, v_body)
  returning id into v_id;
  insert into public.news_items (category, headline, body, importance, published_at)
  values ('market', v_head, v_body, 2, p_now + interval '59 seconds');
  for r in select p.id from public.profiles p
            where not p.is_deactivated
              and p.last_active_at >= p_now - make_interval(days => coalesce((cfg ->> 'notifyActiveDays')::integer, 7)) loop
    perform public.social_notify(r.id, 'news_promo', v_head, v_body,
      jsonb_build_object('promo_id', v_id, 'kind', v_kind, 'set', v_set),
      case v_kind when 'pack_sale' then '/nexamon' when 'free_nft' then '/artworks' else '/company' end,
      'news_promo:' || v_id::text);
  end loop;
  return jsonb_build_object('kind', 'promo', 'mood', 'proud', 'headline', v_head, 'text', v_body,
                            'effects', jsonb_build_array(jsonb_build_object('label', v_head, 'tone', 'gain')),
                            'promo', jsonb_build_object('id', v_id, 'kind', v_kind, 'set', v_set));
end;
$$;
revoke all on function public.news_promo_draw(bigint, timestamptz, double precision, double precision) from public, anon, authenticated;
revoke all on function public.news_promo_tax(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.news_promo_pack_price(text, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.news_promo_active(timestamptz) from public, anon, authenticated;
revoke all on function public.news_promos_cfg() from public, anon, authenticated;

-- A show going on air (news_show_start sets status 'aired') may bring a promotion as its last segment.
create or replace function public.news_shows_promo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seg jsonb;
begin
  v_seg := public.news_promo_draw(new.id, coalesce(new.started_at, public.game_now()));
  if v_seg is not null then
    new.segments := coalesce(new.segments, '[]'::jsonb) || jsonb_build_array(v_seg);
  end if;
  return new;
end;
$$;
revoke all on function public.news_shows_promo() from public, anon, authenticated;
drop trigger if exists news_shows_promo on public.news_shows;
create trigger news_shows_promo
  before update of status on public.news_shows
  for each row
  when (old.status = 'scheduled' and new.status = 'aired')
  execute function public.news_shows_promo();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_news_promo()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := (select auth.uid());
  v_now    timestamptz := public.game_now();
  v        public.news_promos;
  c        public.news_promo_claims;
begin
  if v_player is null then
    perform public.api_error('not_authenticated');
  end if;
  v := public.news_promo_active(v_now);
  if v.id is null then
    return jsonb_build_object('now', v_now, 'promo', null);
  end if;
  select * into c from public.news_promo_claims x where x.promo_id = v.id and x.player_id = v_player;
  return jsonb_build_object('now', v_now, 'promo', jsonb_build_object(
    'id', v.id, 'kind', v.kind, 'set', v.set_key, 'bps', v.bps, 'starts_at', v.starts_at, 'ends_at', v.ends_at,
    'headline', v.headline, 'text', v.body,
    'claimed', c.promo_id is not null, 'claimed_cents', c.amount_cents,
    'tax', case when v.kind = 'tax_return' then public.news_promo_tax(v_player, v_now) else null end));
end;
$$;
comment on function public.get_news_promo() is
  'RPC: the running News-Aktion (ADR-193) -> {now, promo: {id, kind, set, bps, starts_at, ends_at, headline, text, '
  'claimed, claimed_cents, tax: {owner, revenue_cents, refund_cents, cap_cents, share_bps} | null} | null}.';
revoke all on function public.get_news_promo() from public, anon;
grant execute on function public.get_news_promo() to authenticated;

create or replace function public.file_news_tax_return(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v        public.news_promos;
  v_tax    jsonb;
  v_refund bigint;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'file_news_tax_return');
  if v_replay is not null then
    return v_replay;
  end if;
  v := public.news_promo_active(v_now);
  if v.id is null or v.kind <> 'tax_return' then
    perform public.api_error('news_promo_inactive');
  end if;
  perform 1 from public.profiles p where p.id = v_player for update;
  if exists (select 1 from public.news_promo_claims x where x.promo_id = v.id and x.player_id = v_player) then
    perform public.api_error('news_promo_claimed');
  end if;
  v_tax := public.news_promo_tax(v_player, v_now);
  if not (v_tax ->> 'owner')::boolean then
    perform public.api_error('news_promo_no_company');
  end if;
  v_refund := (v_tax ->> 'refund_cents')::bigint;
  if v_refund <= 0 then
    perform public.api_error('tax_nothing_due');
  end if;
  -- the state pays from the treasury; an empty treasury pays nothing
  if coalesce((select x.balance_cents from public.ledger_accounts x where x.id = public.ledger_system_account('treasury') for update), 0)
     < v_refund then
    perform public.api_error('tax_nothing_due');
  end if;
  perform public.lock_player_accounts(v_player);
  perform public.ledger_transfer(public.ledger_system_account('treasury'), public.ledger_player_account(v_player, 'player_cash'),
                                 v_refund, 'tax_refund', 'Steuererklärung (News-Aktion)', 'news_promo', null,
                                 'news_promo:tax:' || v.id::text || ':' || v_player::text, v_player,
                                 jsonb_build_object('promo_id', v.id, 'revenue_cents', v_tax -> 'revenue_cents'));
  insert into public.news_promo_claims (promo_id, player_id, amount_cents, revenue_cents)
  values (v.id, v_player, v_refund, (v_tax ->> 'revenue_cents')::bigint);
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'promo_id', v.id, 'refund_cents', v_refund, 'revenue_cents', (v_tax ->> 'revenue_cents')::bigint));
end;
$$;
comment on function public.file_news_tax_return(uuid) is
  'RPC: files the tax return of a running tax_return News-Aktion (ADR-193), once per player -> '
  '{promo_id, refund_cents, revenue_cents}; idempotent. Errors news_promo_inactive, news_promo_claimed, '
  'news_promo_no_company, tax_nothing_due.';
revoke all on function public.file_news_tax_return(uuid) from public, anon;
grant execute on function public.file_news_tax_return(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Pack sale: the two pack purchases with the promotion price (full latest definitions)
-- ---------------------------------------------------------------------------
create or replace function public.buy_nexamon_pack(p_request_id uuid, p_set text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_price  bigint;
  v_cash   bigint;
  v_pack   uuid := gen_random_uuid();
  v_cards  jsonb;
  r        record;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_set is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_nexamon_pack');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.nexamon_sync(v_now);
  v_price := (cfg #>> array['sets', p_set, 'packPriceCents'])::bigint;
  if v_price is null or v_price < 0 or not exists (select 1 from public.nexamon_cards k where k.set_key = p_set and k.in_catalogue) then
    perform public.api_error('nexamon_unknown');
  end if;
  if not public.nexamon_set_released(p_set, public.game_now()) then
    perform public.api_error('nexamon_set_not_released');
  end if;
  -- ADR-193: a running pack sale of this set
  v_price := public.news_promo_pack_price(p_set, v_price, v_now);
  if not public.rate_limit_hit(v_player, 'nexamon_pack', coalesce((cfg #>> '{packs,perMinute}')::integer, 20), 60) then
    perform public.api_error('rate_limited');
  end if;
  v_cash := public.lock_player_accounts(v_player);
  if v_cash < v_price then
    perform public.api_error('insufficient_funds');
  end if;
  if v_price > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('households'),
                                   v_price, 'nexamon_pack', 'Booster gekauft: ' || coalesce(cfg #>> array['sets', p_set, 'name'], p_set),
                                   'nexamon_pack', v_pack, 'nexamon:pack:' || v_player::text || ':' || p_request_id::text, v_player,
                                   jsonb_build_object('set', p_set, 'price_cents', v_price));
  end if;
  v_cards := public.nexamon_open_pack(p_set, v_player, null, v_pack, v_now);
  insert into public.nexamon_packs (id, player_id, set_key, price_cents, cards, opened_at)
  values (v_pack, v_player, p_set, v_price, v_cards, v_now);
  update public.nexamon_set_state set player_packs_opened = player_packs_opened + 1 where set_key = p_set;
  perform public.mission_event(v_player, 'nexamon_pack', 1, null);
  for r in select x ->> 'rarity' as rarity from jsonb_array_elements(v_cards) x loop
    if public.nexamon_rarity_rank(r.rarity) >= 1 then
      perform public.mission_event(v_player, 'nexamon_rare', 1, null);
    end if;
    if public.nexamon_rarity_rank(r.rarity) >= 2 then
      perform public.mission_event(v_player, 'nexamon_ultra', 1, null);
    end if;
  end loop;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'pack_id', v_pack, 'set', p_set, 'price_cents', v_price, 'cards', v_cards,
    'packs_opened', (select count(*) from public.nexamon_packs p where p.player_id = v_player and p.set_key = p_set)));
end;
$function$;

create or replace function public.buy_nexamon_sealed_pack(p_request_id uuid, p_set text, p_count integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  if not public.nexamon_set_released(p_set, public.game_now()) then
    perform public.api_error('nexamon_set_not_released');
  end if;
  -- ADR-193: a running pack sale of this set
  v_price := public.news_promo_pack_price(p_set, v_price, v_now);
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
$function$;

-- ---------------------------------------------------------------------------
-- Free NFT: create_artwork (full latest definition) skips the fee once per player and promotion
-- ---------------------------------------------------------------------------
create or replace function public.create_artwork(p_request_id uuid, p_title text, p_pixels jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player  uuid;
  v_replay  jsonb;
  v_title   text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_reason  text;
  v_painted integer;
  v_cost    bigint;
  v_cash    bigint;
  v_xp      integer;
  v_id      uuid := gen_random_uuid();
  v_promo   public.news_promos;
  v_free    boolean := false;
  v_mint    bigint;
begin
  v_player := public.require_player();
  perform public.artworks_require_unlock(v_player);
  if p_request_id is null or not public.artwork_valid(p_pixels) then
    perform public.api_error('invalid_argument');
  end if;
  v_reason := public.artwork_title_violation(v_title);
  if v_reason is not null then
    perform public.api_error(v_reason);
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'create_artwork');
  if v_replay is not null then
    return v_replay;
  end if;
  -- unique titles (ADR-100): lookalikes count as the same title; the lock serialises two painters of one title
  perform pg_advisory_xact_lock(hashtextextended('artwork_title:' || public.name_key(v_title), 0));
  if public.artwork_title_taken(v_title) then
    perform public.api_error('name_taken');
  end if;
  if public.logo_has_forbidden_symbol(p_pixels -> 'grid') then
    perform public.api_error('logo_forbidden');
  end if;
  -- one painting at a time per player (the count decides the price)
  perform 1 from public.profiles p where p.id = v_player for update;
  v_painted := public.player_artworks_minted_today(v_player);
  -- artist upgrade (ADR-100): the price x (10 000 − artDiscountBps) / 10 000
  v_cost := public.player_artwork_create_cost_cents(v_player, v_painted);
  -- ADR-193: a running free-NFT promotion waives the fee once per player; the NFT keeps its normal mint value
  v_mint := v_cost;
  v_promo := public.news_promo_active(public.game_now());
  if v_promo.id is not null and v_promo.kind = 'free_nft'
     and not exists (select 1 from public.news_promo_claims x where x.promo_id = v_promo.id and x.player_id = v_player) then
    insert into public.news_promo_claims (promo_id, player_id, amount_cents, ref_id)
    values (v_promo.id, v_player, v_cost, v_id);
    v_free := true;
    v_cost := 0;
  end if;
  v_cash := public.lock_player_accounts(v_player);
  if v_cash < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('treasury'),
                                   v_cost, 'artwork_creation', 'NFT geprägt', 'artwork', v_id,
                                   'art:create:' || v_id::text, v_player, jsonb_build_object('painted_before', v_painted,
                                                                     'discount_bps', public.player_art_discount_bps(v_player)));
  end if;
  insert into public.artworks (id, title, origin, rarity, creator_id, owner_id, pixels, mint_cents)
  values (v_id, v_title, 'player', null, v_player, v_player,
          jsonb_build_object('palette', p_pixels -> 'palette', 'grid', p_pixels -> 'grid'), v_mint);
  perform public.mission_event(v_player, 'art_painted', 1, null);
  -- minting is worth XP (ADR-135)
  v_xp := public.grant_xp(v_player, 'nft_mint', coalesce((public.nfts_cfg() ->> 'mintXp')::integer, 0),
                          'nft_mint:' || v_id::text, 'artwork', v_id);
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'artwork', public.artwork_json(v_id, v_player),
    'cost_cents', v_cost,
    'free', v_free,
    'xp', coalesce(v_xp, 0),
    'next_cost_cents', public.player_artwork_create_cost_cents(v_player, v_painted + 1)));
end;
$function$;
