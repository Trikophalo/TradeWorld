-- =============================================================================
-- NEXA · M3f · 0300 · GmbH and AG, IPO with subscription, capital increases
--                     (ADR-067)
-- =============================================================================
-- Mirrors src/lib/sim/startup.ts (fixedCostCents / maxEmployees for gmbh and ag,
-- issuePriceCents, aiTakeShare, capitalIncreasePriceCents).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- D. Tiers
-- ---------------------------------------------------------------------------
create or replace function public.company_tier_cfg(p_tier text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case p_tier
    when 'garage' then jsonb_build_object(
      'minLevel', greatest(public.config_double('startups', '{garage,minLevel}', 3)::integer, public.unlock_level('found_garage')),
      'foundingCostCents', public.config_bigint('startups', '{garage,foundingCostCents}', 250000),
      'fixedCostCentsPerQuarter', public.config_bigint('startups', '{garage,fixedCostCentsPerQuarter}', 15000),
      'maxEmployees', public.config_double('startups', '{garage,maxEmployees}', 2)::integer)
    when 'small_business' then (
      select jsonb_build_object(
        'minLevel', greatest(coalesce((t ->> 'minLevel')::integer, 10), public.unlock_level('found_small_business')),
        'foundingCostCents', coalesce((t ->> 'foundingCostCents')::bigint, 1500000),
        'fixedCostCentsPerQuarter', coalesce((t ->> 'fixedCostCentsPerQuarter')::bigint, 200000),
        'maxEmployees', coalesce((t ->> 'maxEmployees')::integer, 5))
        from (select coalesce((select x from jsonb_array_elements(coalesce(public.config_jsonb('company', '{tiers}'), '[]'::jsonb)) x
                                where x ->> 'id' = 'small_business' limit 1), '{}'::jsonb) as t) s)
    when 'gmbh' then jsonb_build_object(
      'minLevel', public.config_double('startups', '{gmbh,minLevel}', 15)::integer,
      'foundingCostCents', public.config_bigint('startups', '{gmbh,foundingCostCents}', 6000000),
      'fixedCostCentsPerQuarter', public.config_bigint('startups', '{gmbh,fixedCostCentsPerQuarter}', 600000),
      'maxEmployees', public.config_double('startups', '{gmbh,maxEmployees}', 20)::integer)
    when 'ag' then jsonb_build_object(
      'minLevel', null,
      'foundingCostCents', null,
      'fixedCostCentsPerQuarter', public.config_bigint('startups', '{ag,fixedCostCentsPerQuarter}', 1000000),
      'maxEmployees', public.config_double('startups', '{ag,maxEmployees}', 100)::integer)
  end;
$$;

-- The next self-funded step (garage -> small business -> GmbH; the AG only by an IPO)
create or replace function public.company_next_tier(p_tier text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_tier when 'garage' then 'small_business' when 'small_business' then 'gmbh' end;
$$;

-- Price of the next step: founding cost of the next tier minus that of the current one
-- (from the garage: x startups.upgradeCreditShare)
create or replace function public.company_upgrade_cost(p_tier text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.company_next_tier(p_tier) is null then null
              else greatest(0, (public.company_tier_cfg(public.company_next_tier(p_tier)) ->> 'foundingCostCents')::bigint
                               - round((public.company_tier_cfg(p_tier) ->> 'foundingCostCents')::bigint
                                       * case when p_tier = 'garage' then public.config_double('startups', '{upgradeCreditShare}', 1)
                                              else 1 end)::bigint) end;
$$;

create or replace function public.upgrade_company(p_request_id uuid)
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
  v_next    text;
  v_cfg     jsonb;
  v_cost    bigint;
  v_cash    bigint;
  v_level   integer;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'upgrade_company');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  v_next := public.company_next_tier(pc.tier);
  if v_next is null then
    perform public.api_error('company_upgrade_unavailable');
  end if;
  v_cfg := public.company_tier_cfg(v_next);
  select p.level into v_level from public.profiles p where p.id = v_player;
  if v_level < (v_cfg ->> 'minLevel')::integer then
    perform public.api_error('company_level_too_low');
  end if;
  v_cost := public.company_upgrade_cost(pc.tier);
  perform public.lock_player_accounts(v_player);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.company_cash_account(v_company),
                                   v_cost, 'company_conversion', case v_next when 'gmbh' then 'GmbH' else 'Kleinunternehmen' end,
                                   'company', v_company, 'upgrade:' || v_company::text || ':' || v_next, v_player);
  end if;
  update public.player_companies set tier = v_next where company_id = v_company;
  update public.companies set max_employees = (v_cfg ->> 'maxEmployees')::integer,
                              legal_form = case when v_next = 'gmbh' then 'gmbh'::public.legal_form else legal_form end
   where id = v_company;
  perform public.company_full_time_check(v_company);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Share offers
-- ---------------------------------------------------------------------------
create or replace function public.company_last_quarter_json(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('label', r.label, 'revenue_cents', r.revenue_cents, 'profit_cents', r.operating_profit_cents)
    from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
   where r.company_id = p_company order by gq.ends_at desc limit 1;
$$;

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
    'ends_at', o.ends_at,
    'status', case when o.status = 'open' and o.ends_at > now() then 'open' else 'closed' end,
    'my_shares_e6', coalesce((select sum(s.shares_e6) from public.offer_subscriptions s
                               where s.offer_id = o.id and s.player_id = p_viewer), 0)::bigint,
    'value_cents', public.company_value_cents(c.id),
    'last_quarter', public.company_last_quarter_json(c.id))
    from public.company_share_offers o join public.companies c on c.id = o.company_id
   where o.id = p_offer_id;
$$;

create or replace function public.company_open_offer(p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.company_share_offers o where o.company_id = p_company and o.status = 'open'
   order by o.created_at desc limit 1;
$$;

-- listing part of COMPANY
create or replace function public.company_listing_json(p_company uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.phase = 'listed' then jsonb_build_object(
      'status', 'listed', 'ticker', c.ticker, 'shares_total_e6', c.shares_outstanding * 1000000,
      'founder_shares_e6', coalesce((select sum(p.quantity_e6) from public.positions p
                                      where p.player_id = pc.founder_id and p.security_id = c.security_id and p.status = 'open'), 0)::bigint,
      'offer', case when public.company_open_offer(c.id) is not null then public.offer_json(public.company_open_offer(c.id), p_viewer) end,
      'last_price_e4', (select q.last_price_e4 from public.security_quotes q where q.security_id = c.security_id))
    when c.phase = 'ipo' then (
      select jsonb_build_object(
        'status', 'subscription', 'ticker', null, 'shares_total_e6', o.shares_total_e6,
        'founder_shares_e6', o.shares_total_e6 - o.shares_offered_e6,
        'offer', public.offer_json(o.id, p_viewer), 'last_price_e4', null)
        from public.company_share_offers o where o.id = public.company_open_offer(c.id))
  end
    from public.companies c join public.player_companies pc on pc.company_id = c.id
   where c.id = p_company;
$$;

-- Ticker from the name: 3-4 capital letters, unique among securities and index keys
create or replace function public.company_make_ticker(p_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_l     text := upper(regexp_replace(translate(coalesce(p_name, ''), 'ÄÖÜäöüßÀÁÂÉÈÊÍÓÚàáâéèêíóú', 'AOUAOUSAAAEEEIOUAAAEEEIOU'), '[^A-Za-z]', '', 'g'));
  v_c     text;
  i       integer;
  j       integer;
begin
  v_l := rpad(v_l, 4, 'X');
  for v_c in
    select x from (values (substr(v_l, 1, 3), 1), (substr(v_l, 1, 4), 2)) t(x, o) order by o
  loop
    if not exists (select 1 from public.securities s where s.ticker = v_c)
       and not exists (select 1 from public.indices ix where upper(ix.key) = v_c) then
      return v_c;
    end if;
  end loop;
  for i in 2 .. char_length(v_l) loop
    for j in i + 1 .. char_length(v_l) loop
      v_c := substr(v_l, 1, 1) || substr(v_l, i, 1) || substr(v_l, j, 1);
      if not exists (select 1 from public.securities s where s.ticker = v_c)
         and not exists (select 1 from public.indices ix where upper(ix.key) = v_c) then
        return v_c;
      end if;
    end loop;
  end loop;
  loop
    v_c := substr(v_l, 1, 1) || chr(65 + floor(random() * 26)::integer) || chr(65 + floor(random() * 26)::integer)
        || chr(65 + floor(random() * 26)::integer);
    if not exists (select 1 from public.securities s where s.ticker = v_c)
       and not exists (select 1 from public.indices ix where upper(ix.key) = v_c) then
      return v_c;
    end if;
  end loop;
end;
$$;

-- Books shares into a depot (FIFO lot, cost at the issue price)
create or replace function public.grant_position(p_player uuid, p_security uuid, p_quantity_e6 bigint, p_price_e4 bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos public.positions;
begin
  if coalesce(p_quantity_e6, 0) <= 0 then
    return;
  end if;
  select * into v_pos from public.positions
   where player_id = p_player and security_id = p_security and status = 'open' and side = 'long' for update;
  if v_pos.id is null then
    insert into public.positions (player_id, security_id, quantity_e6, avg_entry_price_e4, cost_basis_cents, opened_at)
    values (p_player, p_security, 0, p_price_e4, 0, public.game_now())
    returning * into v_pos;
  end if;
  insert into public.position_lots (position_id, player_id, security_id, quantity_initial_e6, quantity_open_e6, price_e4, acquired_at)
  values (v_pos.id, p_player, p_security, p_quantity_e6, p_quantity_e6, p_price_e4, public.game_now());
  update public.positions p
     set quantity_e6 = p.quantity_e6 + p_quantity_e6,
         cost_basis_cents = (select coalesce(sum(public.value_cents(l.quantity_open_e6, l.price_e4)), 0)::bigint
                               from public.position_lots l where l.position_id = v_pos.id and l.quantity_open_e6 > 0),
         avg_entry_price_e4 = (select coalesce(public.div_round_half_even(sum(l.quantity_open_e6::numeric * l.price_e4),
                                                                          sum(l.quantity_open_e6)), p_price_e4)
                                 from public.position_lots l where l.position_id = v_pos.id and l.quantity_open_e6 > 0)
   where p.id = v_pos.id;
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
  if v_level < public.cfg_num(v_ipo, '{minLevel}', 12) then
    perform public.api_error('company_level_too_low');
  end if;
  if not (coalesce(v_ipo -> 'fromTiers', '["small_business", "gmbh"]'::jsonb) ? pc.tier) then
    perform public.api_error('company_upgrade_unavailable');
  end if;
  v_total := public.cfg_num(v_ipo, '{sharesTotal}', 1000000)::bigint * 1000000;
  -- issuePriceCents: company value over all shares, at least minIssuePriceCents
  v_price := greatest(public.cfg_num(v_ipo, '{minIssuePriceCents}', 100)::bigint,
                      round(public.company_value_cents(v_company)::numeric / public.cfg_num(v_ipo, '{sharesTotal}', 1000000)::numeric)::bigint);
  insert into public.company_share_offers (company_id, kind, price_cents, shares_total_e6, shares_offered_e6, request_id, ends_at)
  values (v_company, 'ipo', v_price, v_total, v_total * p_share_percent / 100, p_request_id,
          now() + make_interval(secs => public.cfg_num(v_ipo, '{subscriptionHours}', 12) * 3600));
  update public.companies set phase = 'ipo' where id = v_company;
  perform public.company_system_message(v_company, 'Börsengang: ' || p_share_percent || ' % der Aktien zu '
                                                   || public.format_eur(v_price) || ' je Aktie, Zeichnung läuft.');
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
          now() + make_interval(secs => public.cfg_num(v_ipo, '{subscriptionHours}', 12) * 3600));
  perform public.company_system_message(v_company, 'Kapitalerhöhung: neue Aktien zu ' || public.format_eur(v_price)
                                                   || ' je Aktie, Zeichnung läuft.');
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

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
  if o.shares_offered_e6 - o.shares_subscribed_e6 <= 0 then
    perform public.api_error('offer_sold_out');
  end if;
  v_shares := least(floor(p_amount_cents::numeric * 1000000 / o.price_cents)::bigint, o.shares_offered_e6 - o.shares_subscribed_e6);
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
  update public.company_share_offers set shares_subscribed_e6 = shares_subscribed_e6 + v_shares where id = o.id;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'shares_e6', v_shares, 'amount_cents', v_cost, 'offer', public.offer_json(o.id, v_player)));
end;
$$;

-- End of a subscription: AI investors take aiTakeShare(quality) of the rest, shares are delivered,
-- an IPO lists the company (run_due_jobs)
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
  v_ipo    jsonb := coalesce(public.config_jsonb('startups', '{ipo}'), '{}'::jsonb);
  v_ai     bigint;
  v_aicost bigint;
  v_issued bigint;
  v_sec    uuid;
  v_ticker text;
  v_price4 bigint;
  v_shares bigint;
  v_half   bigint;
  s        record;
begin
  select * into o from public.company_share_offers where id = p_offer_id and status = 'open' for update;
  if o.id is null then
    return null;
  end if;
  select * into c from public.companies where id = o.company_id for update;
  select * into pc from public.player_companies where company_id = o.company_id;
  v_price4 := o.price_cents * 100;
  -- aiTakeShare(quality) of the unsubscribed shares, paid by the financial market
  v_ai := floor((o.shares_offered_e6 - o.shares_subscribed_e6)
                * least(1, greatest(0, public.cfg_num(v_ipo, '{aiTakeBase}', 0.2) + public.cfg_num(v_ipo, '{aiTakePerQuality}', 0.5) * coalesce(pc.quality, 0))))::bigint;
  v_aicost := floor(v_ai::numeric * o.price_cents / 1000000)::bigint;
  if v_aicost > 0 then
    perform public.ledger_transfer(public.ledger_system_account('market'), public.company_cash_account(o.company_id), v_aicost,
                                   'transfer', 'Zeichnung durch Investoren', 'share_offer', o.id, 'offer-ai:' || o.id::text, pc.founder_id);
  end if;
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
     set status = 'closed', closed_at = now(), shares_ai_e6 = v_ai, security_id = v_sec
   where id = o.id;
  perform public.company_system_message(c.id,
    case when o.kind = 'ipo' then 'Börsengang abgeschlossen: ' || v_ticker || ' ist an der Börse.'
         else 'Kapitalerhöhung abgeschlossen.' end);
  return jsonb_build_object('offer_id', o.id, 'issued_e6', v_issued, 'ai_e6', v_ai, 'security_id', v_sec);
end;
$$;

create or replace function public.close_due_offers(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n integer := 0;
begin
  for r in select o.id from public.company_share_offers o
            where o.status = 'open' and o.ends_at <= coalesce(p_now, now()) order by o.ends_at, o.id loop
    perform public.close_share_offer(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.get_offers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
begin
  return jsonb_build_object('offers', coalesce((
    select jsonb_agg(public.offer_json(o.id, v_player) order by o.status = 'closed', o.ends_at)
      from public.company_share_offers o
     where o.status = 'open' or o.closed_at > now() - interval '24 hours'), '[]'::jsonb));
end;
$$;


-- COMPANY: next tier, listing, IPO and capital increase flags
create or replace function public.company_state(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc       public.player_companies;
  c        public.companies;
  v_team   jsonb;
  v_tier   jsonb;
  v_sb     jsonb;
  v_level  integer;
  v_cash   bigint;
  v_spread double precision;
  v_last   jsonb;
  v_hist   jsonb;
  v_cost   bigint;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  select * into c from public.companies where id = p_company;
  v_team := public.player_company_team(p_company);
  v_tier := public.company_tier_cfg(pc.tier);
  v_sb := public.company_tier_cfg('small_business');
  select p.level into v_level from public.profiles p where p.id = pc.founder_id;
  v_cash := coalesce((select a.balance_cents from public.ledger_accounts a where a.owner_company_id = p_company and a.kind = 'company_cash'), 0);
  v_spread := public.config_double('startups', '{estimate,initialSpread}', 2.3)
            * power(public.config_double('startups', '{estimate,decayPerQuarter}', 0.85), pc.quarters_active);
  select jsonb_build_object(
           'label', r.label, 'demand_cents', r.demand_cents, 'capacity_cents', r.capacity_cents,
           'revenue_cents', r.revenue_cents, 'cogs_cents', r.cogs_cents, 'fixed_cents', r.fixed_cents,
           'ai_worker_cents', r.ai_worker_cents, 'marketing_cents', r.marketing_cents, 'wages_cents', r.wages_cents,
           'operating_profit_cents', r.operating_profit_cents, 'utilization_bps', r.utilization_bps,
           'bonus_cents', r.bonus_cents)
    into v_last
    from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
   where r.company_id = p_company order by gq.ends_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('label', h.label, 'revenue_cents', h.revenue_cents,
                                               'profit_cents', h.operating_profit_cents) order by h.ends_at), '[]'::jsonb)
    into v_hist
    from (select r.label, r.revenue_cents, r.operating_profit_cents, gq.ends_at
            from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
           where r.company_id = p_company order by gq.ends_at desc limit 12) h;
  v_cost := public.company_upgrade_cost(pc.tier);
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'idea', pc.idea,
    'sector', c.sector_key,
    'color', c.brand_color,
    'logo', public.company_logo(p_company),
    'logo_hidden', pc.logo_hidden,
    'founder_has_job', exists (select 1 from public.player_jobs x where x.player_id = pc.founder_id and x.status = 'active'),
    'full_time_from', public.config_double('startups', '{fullTimeFromEmployees}', 5)::integer,
    'headcount', public.company_headcount(p_company),
    'tier', pc.tier,
    'founded_at', c.founded_at,
    'cash_cents', v_cash,
    'value_cents', public.company_value_cents(p_company),
    'unpaid_cents', pc.unpaid_cents,
    'distress', pc.distress,
    'distress_quarters', pc.distress_quarters,
    'grace_quarters', public.config_double('startups', '{insolvency,graceQuarters}', 4)::integer,
    'pay_factor_bps', pc.pay_factor_bps,
    'product_key', public.company_product(p_company) ->> 'key',
    'stage', (v_team ->> 'stage')::integer,
    'stages', public.company_stages_json(p_company),
    'awareness_bps', round(pc.awareness * 10000)::integer,
    'quality_bps', round(pc.quality * 10000)::integer,
    'quarters_active', pc.quarters_active,
    'estimate_low_cents', round(pc.potential_annual_cents
                                * exp(-v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':low'))))::bigint,
    'estimate_high_cents', round(pc.potential_annual_cents
                                 * exp(v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':high'))))::bigint,
    'marketing_cents_per_quarter', pc.marketing_cents_per_quarter,
    'ai_workers', pc.ai_workers,
    'ai_worker_cost_cents', public.config_bigint('startups', '{aiWorkerCostCentsPerQuarter}', 70000),
    'max_employees', (v_tier ->> 'maxEmployees')::integer,
    'employees', (v_team ->> 'employees')::integer,
    'open_postings', (select count(*) from public.job_postings jp where jp.company_id = p_company and jp.status = 'open')::integer,
    'pending_applications', (select count(*) from public.job_applications a join public.job_postings jp on jp.id = a.posting_id
                              where jp.company_id = p_company and a.status = 'pending')::integer,
    'founder_productivity_bps', (v_team ->> 'founder_productivity_bps')::integer,
    'team_productivity_bps', (v_team ->> 'team_productivity_bps')::integer,
    'capacity_cents', (v_team ->> 'capacity_cents')::bigint,
    'next_quarter_at', coalesce((public.current_game_quarter()).ends_at, public.game_now()),
    'can_upgrade', public.company_next_tier(pc.tier) is not null
                   and coalesce(v_level, 1) >= (public.company_tier_cfg(public.company_next_tier(pc.tier)) ->> 'minLevel')::integer,
    'listing', public.company_listing_json(p_company, pc.founder_id),
    'can_go_public', c.phase = 'private' and public.company_open_offer(p_company) is null
                     and coalesce(public.config_jsonb('startups', '{ipo,fromTiers}'), '["small_business", "gmbh"]'::jsonb) ? pc.tier
                     and coalesce(v_level, 1) >= public.config_double('startups', '{ipo,minLevel}', 12),
    'can_capital_increase', c.phase = 'listed' and public.company_open_offer(p_company) is null,
    'upgrade_cost_cents', v_cost,
    'last_quarter', v_last,
    'history', v_hist);
end;
$$;

-- after the IPO the founder's shares are in the depot (no double counting)
create or replace function public.player_company_value_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.company_value_cents(pc.company_id) from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active'
                       and not exists (select 1 from public.companies c where c.id = pc.company_id and c.phase = 'listed')), 0)::bigint;
$$;

create or replace function public.player_company_close_quarter(p_company uuid, p_quarter_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc        public.player_companies;
  c         public.companies;
  q         public.game_quarters;
  v_su      jsonb := coalesce(public.config_jsonb('startups'), '{}'::jsonb);
  v_team    jsonb;
  v_tier    jsonb;
  v_qpot    double precision;
  v_target  double precision;
  v_quality double precision;
  v_mk      bigint;
  v_half    double precision;
  v_gain    double precision := 0;
  v_aw      double precision;
  v_demand  double precision;
  v_cap     double precision;
  v_rev     double precision;
  v_rev_c   bigint;
  v_cogs    bigint;
  v_fixed   bigint;
  v_aiw     bigint;
  v_op      bigint;
  v_costs   bigint;
  v_pay     bigint := 0;
  v_unpaid  bigint := 0;
  v_settle  bigint := 0;
  v_cash    bigint;
  v_acc     uuid;
  v_hh      uuid;
  v_wages   bigint;
  v_xp      integer := 0;
  v_ai      integer;
  k         text;
  v_bwages  bigint;
  v_factor  integer;
  v_pool    bigint;
  v_weight  bigint;
  v_btotal  bigint := 0;
  v_bpaid   bigint := 0;
  v_b       bigint;
  v_unpaid_total bigint;
  v_dq      integer;
  v_grace   integer := public.config_double('startups', '{insolvency,graceQuarters}', 4)::integer;
  v_plp     jsonb := coalesce(public.config_jsonb('jobs', '{profitLinkedPay}'), '{}'::jsonb);
  b         record;
  v_stage   integer;
begin
  select * into pc from public.player_companies where company_id = p_company and status = 'active' for update;
  select * into q from public.game_quarters where id = p_quarter_id;
  if pc.company_id is null or q.id is null then
    return null;
  end if;
  if exists (select 1 from public.player_company_reports r where r.company_id = p_company and r.game_quarter_id = p_quarter_id) then
    return jsonb_build_object('company_id', p_company, 'skipped', 'already_closed');
  end if;
  select * into c from public.companies where id = p_company;
  v_team := public.player_company_team(p_company);
  v_tier := public.company_tier_cfg(pc.tier);
  k := 'pcq:' || p_company::text || ':' || p_quarter_id::text;

  -- quality towards what the team can do, awareness by word of mouth and marketing
  v_qpot := pc.potential_annual_cents / 4.0;
  v_target := public.cfg_num(v_su, '{quality,base}', 0.25)
            + (1 - public.cfg_num(v_su, '{quality,base}', 0.25))
              * (greatest(0, (v_team ->> 'team_sector_score')::double precision)
                 / (greatest(0, (v_team ->> 'team_sector_score')::double precision) + public.cfg_num(v_su, '{quality,halfSaturationScore}', 20)));
  -- growth stage (ADR-062): quality bonus, awareness cap, capacity bonus
  v_stage := least(greatest((v_team ->> 'stage')::integer, 0),
                   greatest(jsonb_array_length(coalesce(v_su #> '{stages,awarenessCaps}', '[1]'::jsonb)) - 1, 0));
  v_target := least(1, v_target + public.cfg_num(v_su, '{stages,qualityBonusPerStage}', 0.05) * v_stage);
  v_quality := least(1, greatest(0, pc.quality + public.cfg_num(v_su, '{quality,adjustPerQuarter}', 0.35) * (v_target - pc.quality)));
  v_mk := pc.marketing_cents_per_quarter;
  if v_mk > 0 then
    v_half := greatest(public.cfg_num(v_su, '{awareness,marketingMinHalfSaturationCents}', 50000),
                       pc.potential_annual_cents / 4.0 * public.cfg_num(v_su, '{awareness,marketingHalfSaturationShare}', 0.1));
    v_gain := public.cfg_num(v_su, '{awareness,marketingMaxGain}', 0.12) * v_mk / (v_mk + v_half);
  end if;
  v_aw := least(greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
                         coalesce((v_su #>> array['stages', 'awarenessCaps', v_stage::text])::double precision, 1)),
          greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
            pc.awareness
            + public.cfg_num(v_su, '{awareness,growthPerQuarter}', 0.3) * pc.awareness * (1 - pc.awareness) * (0.5 + v_quality)
            + v_gain
            - public.cfg_num(v_su, '{awareness,decayPerQuarter}', 0.03) * pc.awareness));

  v_demand := v_qpot * v_aw * (0.5 + 0.5 * v_quality) * exp(public.cfg_num(v_su, '{demandNoise}', 0.1) * public.gauss_random());
  v_cap := (v_team ->> 'team_productivity_bps')::double precision / 10000.0
         * public.cfg_num(v_su, array['capacityCentsPerProductivity', c.sector_key], 250000)
         * (1 + public.cfg_num(v_su, '{stages,capacityBonusPerStage}', 0.25) * v_stage);
  v_rev := least(v_demand, v_cap);
  v_rev_c := round(v_rev::numeric)::bigint;
  v_cogs := round((v_rev * (1 - public.cfg_num(v_su, array['grossMargin', c.sector_key], 0.5)))::numeric)::bigint;
  v_fixed := (v_tier ->> 'fixedCostCentsPerQuarter')::bigint;
  v_aiw := pc.ai_workers * round(public.cfg_num(v_su, '{aiWorkerCostCentsPerQuarter}', 70000))::bigint;
  v_op := v_rev_c - v_cogs - v_fixed - v_aiw - v_mk;

  -- money (closed system): revenue from the households, costs back to them
  v_acc := public.company_cash_account(p_company);
  v_hh := public.ledger_system_account('households');
  if v_rev_c > 0 then
    v_pay := least(v_rev_c, greatest(0, (select a.balance_cents from public.ledger_accounts a where a.id = v_hh)));
    if v_pay > 0 then
      perform public.ledger_transfer(v_hh, v_acc, v_pay, 'company_revenue', 'Umsatz ' || public.game_quarter_label(q.id),
                                     'company', p_company, k || ':revenue', pc.founder_id);
    end if;
  end if;
  v_costs := v_cogs + v_fixed + v_aiw + v_mk;
  select a.balance_cents into v_cash from public.ledger_accounts a where a.id = v_acc;
  v_pay := least(v_costs, greatest(0, coalesce(v_cash, 0)));
  if v_pay > 0 then
    perform public.ledger_transfer(v_acc, v_hh, v_pay, 'company_costs', 'Kosten ' || public.game_quarter_label(q.id),
                                   'company', p_company, k || ':costs', pc.founder_id);
  end if;
  v_unpaid := v_costs - v_pay;
  v_ai := pc.ai_workers;
  if v_unpaid > 0 then
    v_ai := 0;                                  -- distress: the AI workers are let go
  elsif pc.unpaid_cents > 0 then
    select a.balance_cents into v_cash from public.ledger_accounts a where a.id = v_acc;
    v_settle := least(pc.unpaid_cents, greatest(0, coalesce(v_cash, 0)));
    if v_settle > 0 then
      perform public.ledger_transfer(v_acc, v_hh, v_settle, 'company_costs', 'Offene Rechnungen',
                                     'company', p_company, k || ':settle', pc.founder_id);
    end if;
  end if;

  select coalesce(sum(sp.amount_cents), 0) into v_wages
    from public.salary_payouts sp join public.player_jobs j on j.id = sp.player_job_id
   where j.company_id = p_company and sp.period_end > q.starts_at and sp.period_end <= q.ends_at;

  -- profit-linked pay (ADR-058): base wages of the quarter = paid hours x contract wage
  select coalesce(sum(coalesce(sp.base_amount_cents, sp.minutes_paid::bigint * j.salary_cents_per_hour / 60)), 0) into v_bwages
    from public.salary_payouts sp join public.player_jobs j on j.id = sp.player_job_id
   where j.company_id = p_company and sp.period_end > q.starts_at and sp.period_end <= q.ends_at;
  -- payFactorBps(result before wages, base wages)
  if v_bwages <= 0 or v_op >= v_bwages then
    v_factor := 10000;
  else
    v_factor := round(greatest(public.cfg_num(v_plp, '{minFactor}', 0.5), least(1, greatest(v_op, 0)::double precision / v_bwages)) * 10000)::integer;
  end if;
  -- distributeBonus: bonusShareOfProfit of the surplus by wage weight, at most maxBonusFactor x base wages
  if to_regclass('pg_temp.nexa_bonus') is null then
    create temporary table nexa_bonus (job_id uuid, player_id uuid, bonus bigint) on commit drop;
  end if;
  delete from pg_temp.nexa_bonus;
  if v_op - v_bwages > 0 then
    select coalesce(sum(x.w), 0) into v_weight
      from (select sum(coalesce(sp.base_amount_cents, sp.minutes_paid::bigint * j.salary_cents_per_hour / 60)) as w
              from public.salary_payouts sp join public.player_jobs j on j.id = sp.player_job_id
             where j.company_id = p_company and j.status = 'active' and sp.period_end > q.starts_at and sp.period_end <= q.ends_at
             group by j.id) x;
    if v_weight > 0 then
      v_pool := floor((v_op - v_bwages) * public.cfg_num(v_plp, '{bonusShareOfProfit}', 0.2))::bigint;
      insert into pg_temp.nexa_bonus (job_id, player_id, bonus)
      select x.id, x.player_id, least(v_pool * x.w / v_weight, floor(x.w * public.cfg_num(v_plp, '{maxBonusFactor}', 1))::bigint)
        from (select j.id, j.player_id, sum(coalesce(sp.base_amount_cents, sp.minutes_paid::bigint * j.salary_cents_per_hour / 60)) as w
                from public.salary_payouts sp join public.player_jobs j on j.id = sp.player_job_id
               where j.company_id = p_company and j.status = 'active' and sp.period_end > q.starts_at and sp.period_end <= q.ends_at
               group by j.id, j.player_id) x;
      delete from pg_temp.nexa_bonus where bonus <= 0;
      select coalesce(sum(bonus), 0) into v_btotal from pg_temp.nexa_bonus;
    end if;
  end if;
  if v_btotal > 0 then
    -- paid only from the cash that is there (scaled down proportionally)
    select greatest(0, a.balance_cents) into v_cash from public.ledger_accounts a where a.id = v_acc;
    for b in select * from pg_temp.nexa_bonus order by job_id loop
      v_b := case when v_cash >= v_btotal then b.bonus else b.bonus * v_cash / v_btotal end;
      if v_b > 0 then
        perform public.ledger_transfer(v_acc, public.ledger_player_account(b.player_id, 'player_cash'), v_b, 'work_bonus',
                                       'Bonus ' || public.game_quarter_label(q.id), 'player_job', b.job_id,
                                       k || ':bonus:' || b.job_id::text, b.player_id);
        perform public.loan_withhold(b.player_id, v_b, k || ':bonus:' || b.job_id::text);
        insert into public.salary_payouts (player_job_id, player_id, pay_day, period_start, period_end, minutes_paid, amount_cents,
                                           bonus_cents, base_amount_cents)
        values (b.job_id, b.player_id, (q.ends_at at time zone 'Europe/Berlin')::date, q.starts_at, q.ends_at, 0, 0, v_b, 0);
        v_bpaid := v_bpaid + v_b;
      end if;
    end loop;
  end if;

  if v_op > 0 then
    v_xp := public.grant_xp(pc.founder_id, 'company_quarter_profit',
                            public.config_double('progression', '{xpSources,profitableCompanyQuarter,xp}', 500)::integer,
                            'company_quarter:' || p_company::text || ':' || q.id::text, 'company', p_company);
  end if;

  v_unpaid_total := pc.unpaid_cents + v_unpaid - v_settle;
  v_dq := case when v_unpaid_total > 0 then pc.distress_quarters + 1 else 0 end;
  update public.player_companies
     set awareness = v_aw, quality = v_quality, quarters_active = quarters_active + 1, last_closed_quarter_id = q.id,
         unpaid_cents = v_unpaid_total, distress = v_unpaid_total > 0, distress_quarters = v_dq,
         ai_workers = v_ai, pay_factor_bps = v_factor
   where company_id = p_company;

  insert into public.player_company_reports (company_id, game_quarter_id, label, demand_cents, capacity_cents, revenue_cents,
                                             cogs_cents, fixed_cents, ai_worker_cents, marketing_cents, wages_cents,
                                             operating_profit_cents, utilization_bps, paid_costs_cents, unpaid_added_cents,
                                             awareness_bps, quality_bps, team_productivity_bps, team_sector_score,
                                             base_wages_cents, bonus_cents, pay_factor_bps)
  values (p_company, q.id, public.game_quarter_label(q.id), round(v_demand::numeric)::bigint, round(v_cap::numeric)::bigint,
          v_rev_c, v_cogs, v_fixed, v_aiw, v_mk, v_wages, v_op,
          round(case when v_cap > 0 then least(1, v_demand / v_cap) else 1 end * 10000)::integer,
          v_pay, v_unpaid, round(v_aw * 10000)::integer, round(v_quality * 10000)::integer,
          (v_team ->> 'team_productivity_bps')::integer, (v_team ->> 'team_sector_score')::integer,
          v_bwages, v_bpaid, v_factor);

  -- listed: fair value per share = company value / shares outstanding (ADR-067)
  if c.phase = 'listed' and c.security_id is not null then
    update public.security_sim_state
       set fair_value_e4 = greatest(1, public.company_value_cents(p_company) * 100 / greatest(c.shares_outstanding, 1))
     where security_id = c.security_id;
  end if;

  -- company chat
  perform public.company_system_message(p_company, 'Quartal ' || public.game_quarter_label(q.id) || ': Umsatz '
                                                   || public.format_eur(v_rev_c) || ', Gewinn ' || public.format_eur(v_op) || '.');
  if v_bpaid > 0 then
    perform public.company_system_message(p_company, 'Bonus für das Team: ' || public.format_eur(v_bpaid) || '.');
  end if;
  if v_factor <> pc.pay_factor_bps then
    perform public.company_system_message(p_company, 'Lohnfaktor ab jetzt ' || round(v_factor / 100.0) || ' %.');
  end if;
  -- insolvency after graceQuarters closes with open bills (isInsolvent)
  if v_dq >= v_grace then
    perform public.company_dissolve(p_company, 'insolvent');
  elsif v_dq > 0 then
    perform public.company_system_message(p_company, 'Achtung: offene Rechnungen. Noch ' || (v_grace - v_dq)
                                                     || case when v_grace - v_dq = 1 then ' Quartal' else ' Quartale' end
                                                     || ' bis zur Insolvenz.');
  end if;

  return jsonb_build_object('company_id', p_company, 'quarter_id', q.id, 'revenue_cents', v_rev_c,
                            'operating_profit_cents', v_op, 'unpaid_added_cents', v_unpaid, 'xp', v_xp,
                            'base_wages_cents', v_bwages, 'bonus_cents', v_bpaid, 'pay_factor_bps', v_factor,
                            'distress_quarters', v_dq, 'dissolved', v_dq >= v_grace);
end;
$$;

create or replace function public.run_due_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz;
  v_result   jsonb := '{}'::jsonb;
  v_closed   jsonb := '[]'::jsonb;
  v_latest   bigint;
  q          record;
  v_run      bigint;
begin
  -- waits for a running tick (ticks only try the lock and skip)
  perform pg_advisory_xact_lock(7311001);
  v_now := public.game_now();
  perform public.ensure_game_quarters(3);

  if not exists (select 1 from public.candles limit 1) or not public.money_genesis_done()
     or not exists (select 1 from public.rich_tycoons) then
    v_result := v_result || jsonb_build_object('bootstrap', public.market_bootstrap());
  end if;

  -- first run on a database: older quarters are skipped, only the latest ended one is closed
  if not exists (select 1 from public.job_runs j where j.job_name = 'quarter_close') then
    select gq.id into v_latest from public.game_quarters gq
     where gq.ends_at <= v_now and gq.status <> 'closed' order by gq.ends_at desc limit 1;
    for q in select gq.id from public.game_quarters gq
              where gq.ends_at <= v_now and gq.status <> 'closed' and gq.id <> coalesce(v_latest, -1)
    loop
      update public.game_quarters set status = 'closed', closed_at = now() where id = q.id;
      insert into public.job_runs (job_name, run_key, status, finished_at, details)
      values ('quarter_close', q.id::text, 'succeeded', now(), '{"skipped": "before_first_run"}'::jsonb)
      on conflict do nothing;
    end loop;
  end if;

  for q in select gq.id from public.game_quarters gq
            where gq.ends_at <= v_now and gq.status <> 'closed'
            order by gq.ends_at limit 8
  loop
    v_closed := v_closed || public.close_game_quarter(q.id);
  end loop;
  v_result := v_result || jsonb_build_object('quarters', v_closed);
  -- player companies: every closed quarter since their founding (ADR-057)
  v_result := v_result || jsonb_build_object('player_company_quarters', public.player_companies_close_due());

  -- bonds that matured between quarter closes (or after a downtime)
  if exists (select 1 from public.bonds bd join public.securities s on s.id = bd.security_id
              where s.status = 'listed' and bd.matures_at <= v_now) then
    v_result := v_result || jsonb_build_object('bonds_redeemed', public.redeem_matured_bonds(v_now));
  end if;
  v_result := v_result || jsonb_build_object('bonds_issued', public.ensure_bond_series());

  -- jobs: AI postings of the running quarter, wages since the last run
  v_result := v_result || jsonb_build_object('quit_notices', public.process_quit_notices(null));
  v_result := v_result || jsonb_build_object('share_offers', public.close_due_offers(null));
  v_result := v_result || jsonb_build_object('job_postings', public.refresh_ai_job_postings(),
                                             'salaries_paid', public.accrue_salaries(null));

  -- rich list snapshot every richList.snapshotMinutes (rank news, 24 h changes, state missions)
  v_result := v_result || jsonb_build_object('rich_list', public.rich_list_snapshot(false));

  -- daily maintenance (first run per UTC day)
  insert into public.job_runs (job_name, run_key) values ('maintenance', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'))
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is not null then
    v_result := v_result || jsonb_build_object('maintenance', public.run_maintenance());
    -- price_ticks: keep about one day (candles hold the history), cron log: one day
    perform public.maintain_price_tick_partitions(3, 1);
    if to_regclass('cron.job_run_details') is not null then
      begin
        execute 'delete from cron.job_run_details where end_time < now() - interval ''1 day''';
      exception when others then
        raise warning 'NEXA: could not prune cron.job_run_details: %', sqlerrm;
      end;
    end if;
    delete from public.job_runs j where j.job_name = 'maintenance' and j.started_at < now() - interval '30 days';
    update public.job_runs set status = 'succeeded', finished_at = now() where id = v_run;
  end if;
  return v_result;
end;
$$;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.company_tier_cfg(text)', 'public.company_next_tier(text)', 'public.company_upgrade_cost(text)',
    'public.upgrade_company(uuid)', 'public.company_last_quarter_json(uuid)', 'public.offer_json(uuid, uuid)',
    'public.company_open_offer(uuid)', 'public.company_listing_json(uuid, uuid)', 'public.company_make_ticker(text)',
    'public.grant_position(uuid, uuid, bigint, bigint)', 'public.go_public(uuid, integer)', 'public.capital_increase(uuid, integer)',
    'public.subscribe_offer(uuid, uuid, bigint)', 'public.close_share_offer(uuid)', 'public.close_due_offers(timestamptz)',
    'public.get_offers()', 'public.company_state(uuid)', 'public.player_company_value_cents(uuid)',
    'public.player_company_close_quarter(uuid, bigint)', 'public.run_due_jobs()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.upgrade_company(uuid)', 'public.go_public(uuid, integer)', 'public.capital_increase(uuid, integer)',
    'public.subscribe_offer(uuid, uuid, bigint)', 'public.get_offers()'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
