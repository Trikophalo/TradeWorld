-- =============================================================================
-- NEXA · 1700 · Popular stocks first (ADR-145) and a 10-minute IPO (ADR-146)
-- =============================================================================
-- A. Popularity: opening a stock's page counts as a view (record_security_view, once per player and stock within
--    marketPopularity.viewCooldownMinutes, at most maxViewsPerDay a day, the founder's own stock never). Every
--    refreshMinutes the snapshot build recomputes one score per listed stock from the views and investments
--    (distinct buyers and bought euros from trades and subscriptions) of the last windowDays days and stores it in
--    security_popularity. get_market_snapshot() reads it with one join, so the per-tick cache (ADR-123) stays cheap.
--    Port of src/lib/sim/popularity.ts (popularityScore, viewCounts).
-- B. IPO and capital increases: the subscription runs startups.ipo.subscriptionMinutes (10). AI investors subscribe
--    their share (aiTakeShare(quality) of the offer) evenly over the window, paid by the financial market. Once every
--    share is subscribed the offer closes at once and the company is listed; at the end of the window it is listed
--    with what was subscribed, the rest is not issued. Port of aiSubscribedE6 (src/lib/sim/startup.ts).
-- RPCs (authenticated): record_security_view(p_request_id uuid, p_ticker text) -> {"counted": boolean}.
-- Idempotent: runs unchanged as supabase/updates/20261204001700_market_popularity_ipo.sql.

-- ---------------------------------------------------------------------------
-- A. Popularity
-- ---------------------------------------------------------------------------
create table if not exists public.security_view_days (
  security_id uuid not null references public.securities (id) on delete cascade,
  day         date not null,
  views       integer not null default 0 check (views >= 0),
  primary key (security_id, day)
);
alter table public.security_view_days enable row level security;
revoke all on public.security_view_days from public, anon, authenticated;
comment on table public.security_view_days is 'Counted views of stock pages per day (ADR-145). Internal.';

create table if not exists public.security_view_marks (
  player_id   uuid not null references public.profiles (id) on delete cascade,
  security_id uuid not null references public.securities (id) on delete cascade,
  counted_at  timestamptz not null,
  primary key (player_id, security_id)
);
alter table public.security_view_marks enable row level security;
create index if not exists security_view_marks_security_idx on public.security_view_marks (security_id);
revoke all on public.security_view_marks from public, anon, authenticated;
comment on table public.security_view_marks is 'Last counted view per player and stock, for the view cooldown (ADR-145). Internal.';

create table if not exists public.security_popularity (
  security_id  uuid primary key references public.securities (id) on delete cascade,
  views        integer not null default 0,
  investors    integer not null default 0,
  bought_cents bigint not null default 0,
  score        bigint not null default 0,
  refreshed_at timestamptz not null default now()
);
alter table public.security_popularity enable row level security;
revoke all on public.security_popularity from public, anon, authenticated;
comment on table public.security_popularity is 'Popularity score per listed stock, refreshed with the market snapshot (ADR-145). Internal.';

create table if not exists public.market_popularity_state (
  id           boolean primary key default true check (id),
  refreshed_at timestamptz not null
);
alter table public.market_popularity_state enable row level security;
revoke all on public.market_popularity_state from public, anon, authenticated;
comment on table public.market_popularity_state is 'When security_popularity was last recomputed (ADR-145). Internal.';

-- popularityScore: views x view + investors x investor + floor(sqrt(bought euros) x volume)
create or replace function public.security_popularity_score(p_views bigint, p_investors bigint, p_bought_cents bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (greatest(coalesce(p_views, 0), 0) * public.cfg_num(c.v, '{weights,view}', 1)
          + greatest(coalesce(p_investors, 0), 0) * public.cfg_num(c.v, '{weights,investor}', 20)
          + floor(sqrt(greatest(floor(coalesce(p_bought_cents, 0) / 100.0), 0)) * public.cfg_num(c.v, '{weights,volume}', 0.2)))::bigint
    from (select coalesce(public.config_jsonb('marketPopularity'), '{}'::jsonb) as v) c;
$$;

create or replace function public.record_security_view(p_request_id uuid, p_ticker text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_cfg    jsonb := coalesce(public.config_jsonb('marketPopularity'), '{}'::jsonb);
  v_sec    uuid;
  v_hit    boolean;
begin
  if p_request_id is null or p_ticker is null then
    perform public.api_error('invalid_argument');
  end if;
  select s.id into v_sec from public.securities s
   where s.ticker = upper(btrim(p_ticker)) and s.kind = 'stock' and s.status = 'listed';
  -- unknown tickers, bonds and the founder's own stock do not count
  if v_sec is null or exists (select 1 from public.securities s join public.player_companies pc on pc.company_id = s.company_id
                               where s.id = v_sec and pc.founder_id = v_player) then
    return jsonb_build_object('counted', false);
  end if;
  -- naturally idempotent: a repeat within the cooldown changes nothing
  insert into public.security_view_marks as m (player_id, security_id, counted_at)
  values (v_player, v_sec, now())
  on conflict (player_id, security_id) do update set counted_at = excluded.counted_at
   where m.counted_at <= now() - make_interval(mins => public.cfg_num(v_cfg, '{viewCooldownMinutes}', 30)::integer)
  returning true into v_hit;
  if v_hit is null
     or not public.rate_limit_hit(v_player, 'security_view', public.cfg_num(v_cfg, '{maxViewsPerDay}', 200)::integer, 86400) then
    return jsonb_build_object('counted', false);
  end if;
  insert into public.security_view_days as d (security_id, day, views)
  values (v_sec, (now() at time zone 'UTC')::date, 1)
  on conflict (security_id, day) do update set views = d.views + 1;
  return jsonb_build_object('counted', true);
end;
$$;

-- Recomputes security_popularity from the last windowDays days: views, distinct investors (buy trades and
-- subscriptions, the founder excluded) and the euros they put in. One index range scan per listed stock.
create or replace function public.refresh_security_popularity()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := coalesce(public.config_jsonb('marketPopularity'), '{}'::jsonb);
  v_days  integer := greatest(1, public.cfg_num(v_cfg, '{windowDays}', 3)::integer);
  v_today date := (now() at time zone 'UTC')::date;
  v_since timestamptz := now() - make_interval(days => v_days);
  v_n     integer;
begin
  delete from public.security_view_days where day <= v_today - v_days;
  delete from public.security_view_marks
   where counted_at < now() - make_interval(mins => greatest(public.cfg_num(v_cfg, '{viewCooldownMinutes}', 30)::integer, 1440));
  delete from public.security_popularity p
   where not exists (select 1 from public.securities s where s.id = p.security_id and s.kind = 'stock' and s.status = 'listed');
  insert into public.security_popularity as p (security_id, views, investors, bought_cents, score, refreshed_at)
  select s.id, coalesce(v.views, 0), coalesce(i.investors, 0), coalesce(i.bought, 0),
         public.security_popularity_score(coalesce(v.views, 0), coalesce(i.investors, 0), coalesce(i.bought, 0)), now()
    from public.securities s
    left join public.player_companies pc on pc.company_id = s.company_id
    left join lateral (select sum(d.views)::bigint as views from public.security_view_days d
                        where d.security_id = s.id and d.day > v_today - v_days) v on true
    left join lateral (
      select count(distinct x.player_id)::bigint as investors, coalesce(sum(x.cents), 0)::bigint as bought
        from (select t.player_id, t.gross_cents as cents from public.trades t
               where t.security_id = s.id and t.executed_at > v_since and t.side = 'buy'
              union all
              select os.player_id, os.amount_cents from public.offer_subscriptions os
                join public.company_share_offers o on o.id = os.offer_id
               where o.security_id = s.id and os.created_at > v_since) x
       where x.player_id is distinct from pc.founder_id) i on true
   where s.kind = 'stock' and s.status = 'listed'
   order by s.id
  on conflict (security_id) do update
    set views = excluded.views, investors = excluded.investors, bought_cents = excluded.bought_cents,
        score = excluded.score, refreshed_at = excluded.refreshed_at;
  get diagnostics v_n = row_count;
  insert into public.market_popularity_state (id, refreshed_at) values (true, now())
  on conflict (id) do update set refreshed_at = excluded.refreshed_at;
  return v_n;
end;
$$;

-- The snapshot of ADR-123 plus the popularity score per stock. The score is recomputed with the build of a tick when
-- it is older than refreshMinutes (one caller at a time).
create or replace function public.get_market_snapshot()
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
  v_pop_at  timestamptz;
begin
  perform public.require_player();
  select coalesce(r.tick_seq, 0) into v_tick from public.sim_runtime r where r.id;
  select * into v_cache from public.market_snapshot_cache c where c.id;
  -- the same tick, and not older than a minute (a paused market still refreshes its economy figures)
  if v_cache.id is not null and v_cache.tick_seq = coalesce(v_tick, 0) and v_cache.built_at > now() - interval '1 minute' then
    return v_cache.payload || jsonb_build_object('server_time', v_now);
  end if;

  select s.refreshed_at into v_pop_at from public.market_popularity_state s where s.id;
  if (v_pop_at is null or v_pop_at <= now() - make_interval(
        mins => public.cfg_num(coalesce(public.config_jsonb('marketPopularity'), '{}'::jsonb), '{refreshMinutes}', 5)::integer))
     and pg_try_advisory_xact_lock(7311045) then
    perform public.refresh_security_popularity();
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
           'company_kind', case when c.id is not null and not c.is_ai then 'player' else 'ai' end,
           'popularity', case when s.kind = 'stock' then coalesce(pop.score, 0) else 0 end)
         order by case s.kind when 'stock' then 0 else 1 end, sec.sort_order, b.term_game_years, s.ticker), '[]'::jsonb)
    into v_secs
    from public.securities s
    join public.security_quotes q on q.security_id = s.id
    left join public.companies c on c.id = s.company_id
    left join public.sectors sec on sec.key = s.sector_key
    left join public.bonds b on b.security_id = s.id
    left join public.security_popularity pop on pop.security_id = s.id
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
comment on function public.get_market_snapshot() is
  'RPC: quotes, index, economy and popularity of the latest tick, built once per tick (ADR-123, ADR-145).';

-- ---------------------------------------------------------------------------
-- B. A 10-minute subscription
-- ---------------------------------------------------------------------------
create or replace function public.offer_json(p_offer_id uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'kind', o.kind,
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'color', c.brand_color, 'logo', public.company_logo(c.id),
                                  'sector', c.sector_key, 'product_key', public.company_product(c.id) ->> 'key',
                                  'stage', public.company_stage(c.id)),
    'ticker', c.ticker,
    'price_cents', o.price_cents,
    'shares_offered_e6', o.shares_offered_e6,
    'shares_subscribed_e6', o.shares_subscribed_e6,
    'shares_ai_e6', o.shares_ai_e6,
    'starts_at', o.created_at,
    'ends_at', o.ends_at,
    'status', case when o.status = 'open' and o.ends_at > now() then 'open' else 'closed' end,
    'mine', exists (select 1 from public.player_companies pc where pc.company_id = o.company_id and pc.founder_id = p_viewer),
    'my_shares_e6', coalesce((select sum(s.shares_e6) from public.offer_subscriptions s
                               where s.offer_id = o.id and s.player_id = p_viewer), 0)::bigint,
    'value_cents', public.company_value_cents(c.id),
    'last_quarter', public.company_last_quarter_json(c.id))
    from public.company_share_offers o join public.companies c on c.id = o.company_id
   where o.id = p_offer_id;
$$;

-- aiSubscribedE6: AI investors subscribe aiTakeShare(quality) of the offer evenly over the window (all of it with
-- p_final), never more than players left free; paid by the financial market. Returns the shares (e6) added.
create or replace function public.share_offer_ai_topup(p_offer_id uuid, p_now timestamptz, p_final boolean)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  o        public.company_share_offers;
  v_ipo    jsonb := coalesce(public.config_jsonb('startups', '{ipo}'), '{}'::jsonb);
  v_q      double precision;
  v_target bigint;
  v_frac   numeric;
  v_due    bigint;
  v_add    bigint;
  v_pay    bigint;
  v_founder uuid;
begin
  select * into o from public.company_share_offers where id = p_offer_id and status = 'open' for update;
  if o.id is null then
    return 0;
  end if;
  select coalesce(pc.quality, 0), pc.founder_id into v_q, v_founder from public.player_companies pc where pc.company_id = o.company_id;
  v_target := floor(o.shares_offered_e6
                    * least(1, greatest(0, public.cfg_num(v_ipo, '{aiTakeBase}', 0.2)
                                           + public.cfg_num(v_ipo, '{aiTakePerQuality}', 0.5) * coalesce(v_q, 0))))::bigint;
  v_frac := case when p_final or o.ends_at <= o.created_at then 1
                 else least(1, greatest(0, extract(epoch from (coalesce(p_now, now()) - o.created_at))
                                           / extract(epoch from (o.ends_at - o.created_at)))) end;
  v_due := least(floor(v_target * v_frac)::bigint, o.shares_offered_e6 - o.shares_subscribed_e6);
  v_add := v_due - o.shares_ai_e6;
  if v_add <= 0 then
    return 0;
  end if;
  -- telescoping: the payments add up to floor(all AI shares x price) exactly
  v_pay := floor((o.shares_ai_e6 + v_add)::numeric * o.price_cents / 1000000)::bigint
         - floor(o.shares_ai_e6::numeric * o.price_cents / 1000000)::bigint;
  if v_pay > 0 then
    perform public.ledger_transfer(public.ledger_system_account('market'), public.company_cash_account(o.company_id), v_pay,
                                   'transfer', 'Zeichnung durch Investoren', 'share_offer', o.id,
                                   'offer-ai:' || o.id::text || ':' || (o.shares_ai_e6 + v_add)::text, v_founder);
  end if;
  update public.company_share_offers set shares_ai_e6 = shares_ai_e6 + v_add where id = o.id;
  return v_add;
end;
$$;

create or replace function public.go_public(p_request_id uuid, p_share_percent integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  pc        public.player_companies;
  c         public.companies;
  v_ipo     jsonb := coalesce(public.config_jsonb('startups', '{ipo}'), '{}'::jsonb);
  v_total   bigint;
  v_price   bigint;
  v_level   integer;
  v_minutes integer := greatest(1, public.cfg_num(v_ipo, '{subscriptionMinutes}', 10)::integer);
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_share_percent is null
     or p_share_percent < public.cfg_num(v_ipo, '{minSharePercent}', 10) or p_share_percent > public.cfg_num(v_ipo, '{maxSharePercent}', 49) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'go_public');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  select * into c from public.companies where id = v_company;
  if c.phase in ('ipo', 'listed') or public.company_open_offer(v_company) is not null then
    perform public.api_error('already_listed');
  end if;
  select p.level into v_level from public.profiles p where p.id = v_player;
  if v_level < public.cfg_num(v_ipo, '{minLevel}', 6) then
    perform public.api_error('company_level_too_low');
  end if;
  if not (coalesce(v_ipo -> 'fromTiers', '["garage", "small_business", "gmbh"]'::jsonb) ? pc.tier) then
    perform public.api_error('company_upgrade_unavailable');
  end if;
  v_total := public.cfg_num(v_ipo, '{sharesTotal}', 1000000)::bigint * 1000000;
  -- issuePriceCents: company value over all shares, at least minIssuePriceCents
  v_price := greatest(public.cfg_num(v_ipo, '{minIssuePriceCents}', 100)::bigint,
                      round(public.company_value_cents(v_company)::numeric / public.cfg_num(v_ipo, '{sharesTotal}', 1000000)::numeric)::bigint);
  insert into public.company_share_offers (company_id, kind, price_cents, shares_total_e6, shares_offered_e6, request_id, ends_at)
  values (v_company, 'ipo', v_price, v_total, v_total * p_share_percent / 100, p_request_id,
          now() + make_interval(mins => v_minutes));
  update public.companies set phase = 'ipo' where id = v_company;
  perform public.company_system_message(v_company, 'Börsengang: ' || p_share_percent || ' % der Aktien zu '
                                                   || public.format_eur(v_price) || ' je Aktie. Die Zeichnung läuft höchstens '
                                                   || v_minutes || ' Minuten; sind alle Aktien gezeichnet, ist die Firma sofort an der Börse.');
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

create or replace function public.capital_increase(p_request_id uuid, p_share_percent integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  c         public.companies;
  v_ipo     jsonb := coalesce(public.config_jsonb('startups', '{ipo}'), '{}'::jsonb);
  v_price   bigint;
  v_new     bigint;
  v_minutes integer := greatest(1, public.cfg_num(v_ipo, '{subscriptionMinutes}', 10)::integer);
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_share_percent is null or p_share_percent < 1
     or p_share_percent > public.cfg_num(v_ipo, '{capitalIncreaseMaxPercent}', 25) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'capital_increase');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into c from public.companies where id = v_company for update;
  if c.phase <> 'listed' or c.security_id is null or public.company_open_offer(v_company) is not null then
    perform public.api_error('invalid_argument');
  end if;
  -- capitalIncreasePriceCents: market price x discount, at least minIssuePriceCents
  v_price := greatest(public.cfg_num(v_ipo, '{minIssuePriceCents}', 100)::bigint,
                      round((select q.last_price_e4 from public.security_quotes q where q.security_id = c.security_id) / 100.0
                            * public.cfg_num(v_ipo, '{capitalIncreaseDiscount}', 0.9))::bigint);
  v_new := c.shares_outstanding * 1000000 * p_share_percent / 100;
  insert into public.company_share_offers (company_id, kind, price_cents, shares_total_e6, shares_offered_e6, security_id,
                                           request_id, ends_at)
  values (v_company, 'capital_increase', v_price, c.shares_outstanding * 1000000 + v_new, v_new, c.security_id, p_request_id,
          now() + make_interval(mins => v_minutes));
  perform public.company_system_message(v_company, 'Kapitalerhöhung: neue Aktien zu ' || public.format_eur(v_price)
                                                   || ' je Aktie, die Zeichnung läuft höchstens ' || v_minutes || ' Minuten.');
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

-- One tap: the amount buys as many shares as are left. The subscription that fills the offer lists the company.
create or replace function public.subscribe_offer(p_request_id uuid, p_offer_id uuid, p_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  o        public.company_share_offers;
  v_shares bigint;
  v_cost   bigint;
  v_cash   bigint;
  v_full   boolean := false;
begin
  v_player := public.require_player();
  if p_request_id is null or p_amount_cents is null or p_amount_cents < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'subscribe_offer');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into o from public.company_share_offers where id = p_offer_id for update;
  if o.id is null then
    perform public.api_error('invalid_argument');
  end if;
  if o.status <> 'open' or o.ends_at <= now() then
    perform public.api_error('offer_closed');
  end if;
  if exists (select 1 from public.player_companies pc where pc.company_id = o.company_id and pc.founder_id = v_player) then
    perform public.api_error('invalid_argument');
  end if;
  if o.shares_offered_e6 - o.shares_subscribed_e6 - o.shares_ai_e6 <= 0 then
    perform public.api_error('offer_sold_out');
  end if;
  v_shares := least(floor(p_amount_cents::numeric * 1000000 / o.price_cents)::bigint,
                    o.shares_offered_e6 - o.shares_subscribed_e6 - o.shares_ai_e6);
  if v_shares <= 0 then
    perform public.api_error('invalid_argument');
  end if;
  v_cost := ceil(v_shares::numeric * o.price_cents / 1000000)::bigint;
  perform public.lock_player_accounts(v_player);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.company_cash_account(o.company_id),
                                 v_cost, 'transfer', 'Zeichnung von Aktien', 'share_offer', o.id,
                                 'subscribe:' || p_request_id::text, v_player);
  insert into public.offer_subscriptions (offer_id, player_id, shares_e6, amount_cents) values (o.id, v_player, v_shares, v_cost);
  update public.company_share_offers set shares_subscribed_e6 = shares_subscribed_e6 + v_shares where id = o.id
  returning shares_subscribed_e6 + shares_ai_e6 >= shares_offered_e6 into v_full;
  -- every share is taken: listed at once (ADR-146)
  if v_full then
    perform public.close_share_offer(o.id);
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'shares_e6', v_shares, 'amount_cents', v_cost, 'completed', v_full, 'offer', public.offer_json(o.id, v_player)));
end;
$$;

-- End of a subscription (full, or the window is over): AI investors get the rest of their share, the shares are
-- delivered, an IPO lists the company. What nobody subscribed is not issued.
create or replace function public.close_share_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o        public.company_share_offers;
  c        public.companies;
  pc       public.player_companies;
  v_ai     bigint;
  v_issued bigint;
  v_sec    uuid;
  v_ticker text;
  v_price4 bigint;
  v_shares bigint;
  v_half   bigint;
  s        record;
begin
  perform 1 from public.company_share_offers where id = p_offer_id and status = 'open' for update;
  if not found then
    return null;
  end if;
  perform public.share_offer_ai_topup(p_offer_id, now(), true);
  select * into o from public.company_share_offers where id = p_offer_id;
  select * into c from public.companies where id = o.company_id for update;
  select * into pc from public.player_companies where company_id = o.company_id;
  v_price4 := o.price_cents * 100;
  v_ai := o.shares_ai_e6;
  v_issued := o.shares_subscribed_e6 + v_ai;

  if o.kind = 'ipo' then
    v_shares := (o.shares_total_e6 - o.shares_offered_e6 + v_issued) / 1000000;
    v_ticker := public.company_make_ticker(c.name);
    insert into public.securities (kind, ticker, name, company_id, sector_key, status, listed_at)
    values ('stock', v_ticker, c.name, c.id, c.sector_key, 'listed', now())
    returning id into v_sec;
    v_half := greatest(1, v_price4 / 200);
    insert into public.security_quotes (security_id, last_price_e4, bid_e4, ask_e4, prev_close_e4, day_open_e4, day_high_e4, day_low_e4,
                                        market_cap_cents)
    values (v_sec, v_price4, greatest(1, v_price4 - v_half), v_price4 + v_half, v_price4, v_price4, v_price4, v_price4,
            v_shares * o.price_cents);
    insert into public.security_sim_state (security_id, fair_value_e4, ema_fast, ema_slow)
    values (v_sec, greatest(1, public.company_value_cents(c.id) * 100 / greatest(v_shares, 1)), v_price4, v_price4);
    update public.companies
       set security_id = v_sec, ticker = v_ticker, tier = 'penny', phase = 'listed', listed_at = now(), shares_outstanding = greatest(v_shares, 1),
           legal_form = 'ag', max_employees = (public.company_tier_cfg('ag') ->> 'maxEmployees')::integer
     where id = c.id;
    update public.player_companies set tier = 'ag' where company_id = c.id;
    -- the founder keeps everything that was not offered (cost basis 0)
    perform public.grant_position(pc.founder_id, v_sec, o.shares_total_e6 - o.shares_offered_e6, 0);
  else
    v_sec := c.security_id;
    update public.companies set shares_outstanding = (c.shares_outstanding * 1000000 + v_issued) / 1000000 where id = c.id;
  end if;
  for s in select x.player_id, sum(x.shares_e6)::bigint as q from public.offer_subscriptions x
            where x.offer_id = o.id group by x.player_id order by x.player_id loop
    perform public.grant_position(s.player_id, v_sec, s.q, v_price4);
  end loop;
  update public.company_share_offers
     set status = 'closed', closed_at = now(), security_id = v_sec
   where id = o.id;
  perform public.company_system_message(c.id,
    case when o.kind = 'ipo' then 'Börsengang abgeschlossen: ' || v_ticker || ' ist an der Börse.'
         else 'Kapitalerhöhung abgeschlossen.' end);
  return jsonb_build_object('offer_id', o.id, 'issued_e6', v_issued, 'ai_e6', v_ai, 'security_id', v_sec);
end;
$$;

-- Every minute (run_due_part): AI investors subscribe their share of the time passed; full or due offers close.
create or replace function public.close_due_offers(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r     record;
  v_now timestamptz := coalesce(p_now, now());
  v_n   integer := 0;
begin
  for r in select o.id, o.ends_at <= v_now as due from public.company_share_offers o
            where o.status = 'open' order by o.ends_at, o.id loop
    if not r.due then
      perform public.share_offer_ai_topup(r.id, v_now, false);
    end if;
    if r.due or exists (select 1 from public.company_share_offers o
                         where o.id = r.id and o.shares_subscribed_e6 + o.shares_ai_e6 >= o.shares_offered_e6) then
      perform public.close_share_offer(r.id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.security_popularity_score(bigint, bigint, bigint)', 'public.record_security_view(uuid, text)',
    'public.refresh_security_popularity()', 'public.share_offer_ai_topup(uuid, timestamptz, boolean)',
    'public.offer_json(uuid, uuid)', 'public.go_public(uuid, integer)', 'public.capital_increase(uuid, integer)',
    'public.subscribe_offer(uuid, uuid, bigint)', 'public.close_share_offer(uuid)', 'public.close_due_offers(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.record_security_view(uuid, text)', 'public.go_public(uuid, integer)', 'public.capital_increase(uuid, integer)',
    'public.subscribe_offer(uuid, uuid, bigint)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
revoke all on function public.get_market_snapshot() from public, anon;
grant execute on function public.get_market_snapshot() to authenticated, service_role;
comment on function public.record_security_view(uuid, text) is
  'RPC: counts a view of a stock page for the popularity ranking, once per player and stock within the cooldown (ADR-145).';
