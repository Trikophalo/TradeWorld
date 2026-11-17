-- ===== idempotent copy of migrations/20261204006100_stock_pump.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 6100 · No money from pumping the own stock (ADR-170)
-- =============================================================================
-- The loop: a founder takes cash out of the company, buys the own stock (the price rises by the player impact),
-- then lets the company issue new shares (capital increase). AI investors subscribed their usual 60 to 100 % at
-- 90 % of the pushed market price (at least 1 EUR) and paid it into the company cash, which the founder withdrew
-- again. Each round printed money from the financial market; with a stock at 0.45 EUR a 25 % increase brought
-- 250.000 EUR. The fix:
-- 1. AI investors pay at most the fair value: in a capital increase they take their share
--    only while the price is at most aiMaxPremiumBps (100 %) of the fair value, fair = (company value + new money)
--    / shares after the increase (company_share_offers.ai_factor 1 or 0, set when the offer starts).
-- 2. A capital increase at most once per capitalIncreaseCooldownHours (capital_increase_cooldown, NX221).
-- 3. Issue proceeds (IPO, capital increase) cannot be withdrawn for issueProceedsLockHours
--    (issue_proceeds_locked, NX222).
-- 4. Insider rule: a founder cannot buy the own stock for insiderCooldownHours after money went from the company
--    to him (withdrawal, payout, dividend) (insider_cooldown, NX220).
-- 5. Player stocks move at most dailyBandBps around the previous close per day; the founder's own shares no
--    longer lift the value funds' anchor (holdings premium).
-- Idempotent: runs unchanged as supabase/updates/20261204006100_stock_pump.sql.

-- ---------------------------------------------------------------------------
-- A. Error keys
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
  v_a   text := $q$    else 'NX007'
$q$;
begin
  if position('''insider_cooldown''' in v_def) = 0 then
    if position(v_a in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add insider_cooldown (NX220 to NX222) by hand';
    end if;
    execute replace(v_def, v_a, $q$    when 'insider_cooldown'           then 'NX220'
    when 'capital_increase_cooldown'  then 'NX221'
    when 'issue_proceeds_locked'      then 'NX222'
$q$ || v_a);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- B. Helpers
-- ---------------------------------------------------------------------------
alter table public.company_share_offers add column if not exists ai_factor double precision not null default 1;
comment on column public.company_share_offers.ai_factor is
  'ADR-170: share of their usual part AI investors subscribe (issue_ai_factor at the start of a capital increase; 1 for IPOs).';

-- issueAiFactor (src/lib/sim/startup.ts): AI investors pay at most the fair value
create or replace function public.issue_ai_factor(p_fair_cents double precision, p_price_cents double precision)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when coalesce(p_fair_cents, 0) <= 0 or coalesce(p_price_cents, 0) <= 0 then 0
           when p_price_cents * 10000 > p_fair_cents * public.config_double('startups', '{ipo,aiMaxPremiumBps}', 10000) then 0
           else 1
         end;
$$;

-- Issue proceeds (IPO, capital increase) of the last issueProceedsLockHours in the company cash
create or replace function public.listed_issue_locked_cents(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.amount_cents), 0)::bigint
    from public.ledger_accounts ca
    join public.ledger_entries e on e.account_id = ca.id and e.amount_cents > 0
    join public.ledger_transactions t on t.id = e.transaction_id and t.ref_type = 'share_offer'
   where ca.owner_company_id = p_company and ca.kind = 'company_cash'
     and e.created_at > now() - public.config_double('startups', '{ipo,issueProceedsLockHours}', 72) * interval '1 hour';
$$;

-- Insider rule: money went from the founder's company to him within insiderCooldownHours
create or replace function public.player_stock_insider_blocked(p_player uuid, p_security uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.companies c
      join public.player_companies pc on pc.company_id = c.id and pc.founder_id = p_player
      join public.ledger_accounts ca on ca.owner_company_id = c.id and ca.kind = 'company_cash'
      join public.ledger_entries e1 on e1.account_id = ca.id and e1.amount_cents < 0
       and e1.created_at > now() - public.config_double('trading', '{playerStocks,insiderCooldownHours}', 24) * interval '1 hour'
      join public.ledger_entries e2 on e2.transaction_id = e1.transaction_id and e2.amount_cents > 0
      join public.ledger_accounts pa on pa.id = e2.account_id and pa.owner_player_id = p_player and pa.kind = 'player_cash'
     where c.security_id = p_security);
$$;

revoke all on function public.issue_ai_factor(double precision, double precision) from public, anon, authenticated;
revoke all on function public.listed_issue_locked_cents(uuid) from public, anon, authenticated;
revoke all on function public.player_stock_insider_blocked(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_ai_factor(double precision, double precision) to service_role;
grant execute on function public.listed_issue_locked_cents(uuid) to service_role;
grant execute on function public.player_stock_insider_blocked(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- C. place_order: the insider rule
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.place_order(uuid, text, text, text, bigint, bigint, bigint)'::regprocedure);
  v_a   text := $t$  if s.kind = 'bond' and v_level < public.unlock_level('bonds') then
    perform public.api_error('locked');
  end if;
$t$;
begin
  if position('player_stock_insider_blocked' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 then
    raise exception 'place_order() has an unexpected shape; add the insider rule (ADR-170) by hand';
  end if;
  execute replace(v_def, v_a, v_a || $t$  -- ADR-170: no buying the own stock with money just taken out of the company
  if v_side = 'buy' and s.kind = 'stock' and public.player_stock_insider_blocked(v_player, s.id) then
    perform public.api_error('insider_cooldown');
  end if;
$t$);
end;
$do$;

-- ---------------------------------------------------------------------------
-- D. capital_increase: cooldown and the AI factor
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.capital_increase(uuid, integer)'::regprocedure);
  v_a   text := $t$  v_new := c.shares_outstanding * 1000000 * p_share_percent / 100;
$t$;
  v_b   text := $t$  perform public.company_system_message(v_company, 'Kapitalerhöhung: neue Aktien zu '$t$;
begin
  if position('capital_increase_cooldown' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 or position(v_b in v_def) = 0 then
    raise exception 'capital_increase() has an unexpected shape; add the cooldown and the AI factor (ADR-170) by hand';
  end if;
  v_def := replace(v_def, v_a, v_a || $t$  -- ADR-170: at most once per capitalIncreaseCooldownHours
  if exists (select 1 from public.company_share_offers o
              where o.company_id = v_company and o.kind = 'capital_increase'
                and o.created_at > now() - public.cfg_num(v_ipo, '{capitalIncreaseCooldownHours}', 24) * interval '1 hour') then
    perform public.api_error('capital_increase_cooldown');
  end if;
$t$);
  v_def := replace(v_def, v_b, $t$  -- ADR-170: AI investors pay at most the fair value after the increase
  update public.company_share_offers o
     set ai_factor = public.issue_ai_factor(
           (public.company_value_cents(v_company) * public.listed_price_factor(v_company) + v_new / 1000000.0 * v_price)
             / greatest(1, c.shares_outstanding + v_new / 1000000.0),
           v_price)
   where o.company_id = v_company and o.request_id = p_request_id and o.kind = 'capital_increase';
$t$ || v_b);
  execute v_def;
end;
$do$;

-- share_offer_ai_topup: the AI part times ai_factor
do $do$
declare
  v_def text := pg_get_functiondef('public.share_offer_ai_topup(uuid, timestamp with time zone, boolean)'::regprocedure);
  v_a   text := $t$  v_target := floor(o.shares_offered_e6
$t$;
begin
  if position('o.ai_factor' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 then
    raise exception 'share_offer_ai_topup() has an unexpected shape; add the AI factor (ADR-170) by hand';
  end if;
  execute replace(v_def, v_a, $t$  v_target := floor(o.shares_offered_e6 * greatest(0, least(1, o.ai_factor))
$t$);
end;
$do$;

-- ---------------------------------------------------------------------------
-- E. listed_withdraw_check: issue proceeds stay in the company for a while
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.listed_withdraw_check(uuid, bigint)'::regprocedure);
  v_a   text := $t$  if public.listed_reserved_cents(p_company) > 0 then
$t$;
begin
  if position('issue_proceeds_locked' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 then
    raise exception 'listed_withdraw_check() has an unexpected shape; add the issue lock (ADR-170) by hand';
  end if;
  execute replace(v_def, v_a, $t$  -- ADR-170: money raised from investors is not the founder's
  if public.listed_issue_locked_cents(p_company) > 0
     and public.listed_free_cash(p_company) - public.listed_issue_locked_cents(p_company) < p_amount_cents then
    perform public.api_error('issue_proceeds_locked');
  end if;
$t$ || v_a);
end;
$do$;

-- ---------------------------------------------------------------------------
-- F. market_tick_at: daily band for player stocks, no premium from the founder's own shares
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.market_tick_at(timestamp with time zone)'::regprocedure);
  v_d   text := $t$  c_bondvol   double precision;
$t$;
  v_c   text := $t$  c_bondvol   := public.cfg_num(v_bonds, '{volatilityMultiplier}', 3);
$t$;
  v_s   text := $t$           q.last_price_e4,
$t$;
  v_h   text := $t$      v_held := greatest(0, r.held_e6 / 1000000.0 * v_price / 100.0);
$t$;
  v_n   text := $t$      v_new := greatest(c_minprice, v_new);
      v_mm  := v_mm * (1 - c_mm_speed);
$t$;
begin
  if position('band_founder' in v_def) > 0 then
    return;
  end if;
  if position(v_d in v_def) = 0 or position(v_c in v_def) = 0 or position(v_s in v_def) = 0
     or position(v_h in v_def) = 0 or position(v_n in v_def) = 0 then
    raise exception 'market_tick_at() has an unexpected shape; add the player stock band (ADR-170) by hand';
  end if;
  v_def := replace(v_def, v_d, v_d || $t$  c_band      double precision;
  v_bref      double precision;
$t$);
  v_def := replace(v_def, v_c, v_c || $t$  c_band      := greatest(0, public.cfg_num(v_trading, '{playerStocks,dailyBandBps}', 0)) / 10000.0;
$t$);
  v_def := replace(v_def, v_s, $t$           q.last_price_e4, q.prev_close_e4 as band_prev_e4,
           (select pcx.founder_id from public.player_companies pcx where pcx.company_id = s.company_id) as band_founder,
           coalesce((select sum(px.quantity_e6) from public.positions px
                       join public.player_companies pcy on pcy.company_id = s.company_id and pcy.founder_id = px.player_id
                      where px.security_id = s.id and px.status = 'open' and px.side = 'long'), 0) as founder_e6,
$t$);
  v_def := replace(v_def, v_h, $t$      v_held := greatest(0, (r.held_e6 - r.founder_e6) / 1000000.0 * v_price / 100.0);
$t$);
  v_def := replace(v_def, v_n, $t$      v_new := greatest(c_minprice, v_new);
      -- ADR-170: a player stock stays within dailyBandBps of the previous close
      if r.band_founder is not null and c_band > 0 then
        v_bref := case when v_new_day then r.last_price_e4 else coalesce(r.band_prev_e4, r.last_price_e4) end;
        v_new := greatest(c_minprice, least(ceil(v_bref * (1 + c_band))::bigint,
                                            greatest(floor(v_bref / (1 + c_band))::bigint, v_new)));
      end if;
      v_mm  := v_mm * (1 - c_mm_speed);
$t$);
  execute v_def;
end;
$do$;
