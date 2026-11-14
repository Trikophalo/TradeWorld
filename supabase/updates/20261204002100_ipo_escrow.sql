-- ===== idempotent copy of migrations/20261204002100_ipo_escrow.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 2100 · IPO: money back when it fails, nothing paid out before (ADR-151)
-- =============================================================================
-- Subscription money no longer goes into the company's cash. It waits in the system account "offer_escrow" until
-- the subscription ends:
--   * IPO fully subscribed (startups.ipo.minFillBps of the offered shares, players and AI investors together):
--     the company is listed, the money goes to the company in one booking. AI investors pay only now.
--   * IPO not full when the window ends, or the company was closed meanwhile: the offer fails. Every player gets
--     the full amount back, the company stays private and may try again.
--   * Capital increase: as before it issues what was subscribed, but the money also waits until the end.
-- So a founder can never pay out subscription money before the company is at the stock market.
-- Offers that are open while this update runs for the first time end under the old rules (their money is already
-- in the company's cash).
-- Idempotent: runs unchanged as supabase/updates/20261204002100_ipo_escrow.sql.

-- ---------------------------------------------------------------------------
-- A. Escrow account, offer columns, notification type
-- ---------------------------------------------------------------------------
insert into public.ledger_accounts (kind, system_key, label, allow_negative) values
  ('system', 'offer_escrow', 'Share offers: subscription money until the subscription ends (ADR-151)', false)
on conflict do nothing;

do $$
declare
  r record;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'company_share_offers' and column_name = 'escrow_cents') then
    for r in select o.id from public.company_share_offers o where o.status = 'open' order by o.id loop
      perform public.close_share_offer(r.id);
    end loop;
  end if;
end;
$$;

alter table public.company_share_offers add column if not exists escrow_cents bigint not null default 0 check (escrow_cents >= 0);
alter table public.company_share_offers drop constraint if exists company_share_offers_status_check;
alter table public.company_share_offers add constraint company_share_offers_status_check
  check (status in ('open', 'closed', 'failed'));
comment on column public.company_share_offers.escrow_cents is
  'Money of the players'' subscriptions waiting in the system account offer_escrow (ADR-151); 0 once the offer ended.';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('ipo_result', 'market', 'Börsengang', 'Ein Börsengang, bei dem du dabei bist, ist geglückt oder geplatzt.',
        'notif_bell', true, true, true, 298)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Subscribing: players pay into the escrow, AI investors are only counted
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
    'status', case when o.status = 'failed' then 'failed'
                   when o.status = 'open' and o.ends_at > now() then 'open' else 'closed' end,
    'mine', exists (select 1 from public.player_companies pc where pc.company_id = o.company_id and pc.founder_id = p_viewer),
    'my_shares_e6', coalesce((select sum(s.shares_e6) from public.offer_subscriptions s
                               where s.offer_id = o.id and s.player_id = p_viewer), 0)::bigint,
    'my_amount_cents', coalesce((select sum(s.amount_cents) from public.offer_subscriptions s
                                  where s.offer_id = o.id and s.player_id = p_viewer), 0)::bigint,
    'value_cents', public.company_value_cents(c.id),
    'last_quarter', public.company_last_quarter_json(c.id))
    from public.company_share_offers o join public.companies c on c.id = o.company_id
   where o.id = p_offer_id;
$$;

-- AI investors: their share of the offer after the time passed (ADR-149). They are only counted here and pay when
-- the offer succeeds (close_share_offer). Returns the shares (e6) added.
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
begin
  select * into o from public.company_share_offers where id = p_offer_id and status = 'open' for update;
  if o.id is null then
    return 0;
  end if;
  select coalesce(pc.quality, 0) into v_q from public.player_companies pc where pc.company_id = o.company_id;
  v_target := floor(o.shares_offered_e6
                    * least(1, greatest(0, public.cfg_num(v_ipo, '{aiTakeBase}', 0.2)
                                           + public.cfg_num(v_ipo, '{aiTakePerQuality}', 0.5) * coalesce(v_q, 0))))::bigint;
  v_frac := case when p_final or o.ends_at <= o.created_at then 1
                 else least(1, greatest(0, extract(epoch from (coalesce(p_now, now()) - o.created_at))
                                           / extract(epoch from (o.ends_at - o.created_at)))) end;
  v_frac := 1 - power(1 - v_frac, greatest(1, public.cfg_num(v_ipo, '{aiPace}', 1)));
  v_due := least(floor(v_target * v_frac)::bigint, o.shares_offered_e6 - o.shares_subscribed_e6);
  v_add := v_due - o.shares_ai_e6;
  if v_add <= 0 then
    return 0;
  end if;
  update public.company_share_offers set shares_ai_e6 = shares_ai_e6 + v_add where id = o.id;
  return v_add;
end;
$$;

-- One tap: the amount buys as many shares as are left. The money waits in the escrow; the subscription that fills
-- the offer lists the company.
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
  if o.status <> 'open' or o.ends_at <= now()
     or exists (select 1 from public.companies c where c.id = o.company_id and c.phase in ('insolvent', 'dissolved')) then
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
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('offer_escrow'),
                                 v_cost, 'transfer', 'Zeichnung von Aktien (bis zum Börsenstart verwahrt)', 'share_offer', o.id,
                                 'subscribe:' || p_request_id::text, v_player);
  insert into public.offer_subscriptions (offer_id, player_id, shares_e6, amount_cents) values (o.id, v_player, v_shares, v_cost);
  update public.company_share_offers
     set shares_subscribed_e6 = shares_subscribed_e6 + v_shares, escrow_cents = escrow_cents + v_cost
   where id = o.id
  returning shares_subscribed_e6 + shares_ai_e6 >= shares_offered_e6 into v_full;
  -- every share is taken: listed at once (ADR-146)
  if v_full then
    perform public.close_share_offer(o.id);
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'shares_e6', v_shares, 'amount_cents', v_cost, 'completed', v_full, 'offer', public.offer_json(o.id, v_player)));
end;
$$;

-- ---------------------------------------------------------------------------
-- C. The end of an offer: failed (everything back) or done (money to the company)
-- ---------------------------------------------------------------------------
-- Money of subscriptions that no longer exist (the player reset the account) goes to the state.
create or replace function public.share_offer_escrow_rest(p_offer_id uuid, p_cents bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_cents, 0) <= 0 then
    return;
  end if;
  perform public.ledger_transfer(public.ledger_system_account('offer_escrow'),
                                 public.ledger_system_account(case when public.money_genesis_done() then 'treasury' else 'mint' end),
                                 p_cents, 'transfer', 'Verfallene Zeichnungen', 'share_offer', p_offer_id,
                                 'offer-rest:' || p_offer_id::text, null);
end;
$$;

-- The offer fails: every subscriber gets the full amount back, an IPO leaves the company private.
create or replace function public.share_offer_cancel(p_offer_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o        public.company_share_offers;
  c        public.companies;
  v_founder uuid;
  v_back   bigint := 0;
  v_n      integer := 0;
  v_pct    integer;
  r        record;
begin
  select * into o from public.company_share_offers where id = p_offer_id and status = 'open' for update;
  if o.id is null then
    return null;
  end if;
  select * into c from public.companies where id = o.company_id for update;
  select pc.founder_id into v_founder from public.player_companies pc where pc.company_id = o.company_id;
  v_pct := floor((o.shares_subscribed_e6 + o.shares_ai_e6)::numeric * 100 / o.shares_offered_e6)::integer;
  for r in select x.player_id, sum(x.amount_cents)::bigint as cents from public.offer_subscriptions x
            where x.offer_id = o.id group by x.player_id order by x.player_id loop
    perform public.ledger_transfer(public.ledger_system_account('offer_escrow'), public.ledger_player_account(r.player_id, 'player_cash'),
                                   r.cents, 'transfer', 'Zeichnung zurück: ' || c.name, 'share_offer', o.id,
                                   'offer-refund:' || o.id::text || ':' || r.player_id::text, r.player_id);
    v_back := v_back + r.cents;
    v_n := v_n + 1;
    perform public.social_notify(r.player_id, 'ipo_result', 'Geld zurück: ' || c.name,
      case when o.kind = 'ipo' then 'Der Börsengang ist geplatzt. ' else 'Die Kapitalerhöhung ist geplatzt. ' end
        || 'Du hast ' || public.format_eur(r.cents) || ' vollständig zurückbekommen.',
      jsonb_build_object('offer_id', o.id, 'company_id', c.id, 'amount_cents', r.cents, 'result', 'failed'),
      '/portfolio', 'offer-failed:' || o.id::text);
  end loop;
  perform public.share_offer_escrow_rest(o.id, o.escrow_cents - v_back);
  update public.company_share_offers set status = 'failed', closed_at = now(), escrow_cents = 0 where id = o.id;
  if o.kind = 'ipo' and c.phase = 'ipo' then
    update public.companies set phase = 'private' where id = c.id;
  end if;
  if c.phase not in ('insolvent', 'dissolved') then
    perform public.company_system_message(c.id,
      case when o.kind = 'ipo'
           then 'Börsengang geplatzt: nur ' || v_pct || ' % der Aktien wurden gezeichnet. Alle Anleger haben ihr Geld zurück, '
                || 'die Firma bleibt privat. Du kannst es jederzeit noch einmal versuchen.'
           else 'Kapitalerhöhung geplatzt. Alle Anleger haben ihr Geld zurück.' end);
    perform public.social_notify(v_founder, 'ipo_result',
      case when o.kind = 'ipo' then 'Börsengang geplatzt' else 'Kapitalerhöhung geplatzt' end,
      'Nur ' || v_pct || ' % der Aktien wurden gezeichnet. Alle Anleger haben ihr Geld zurück. Mit mehr Qualität zeichnen '
        || 'mehr Investoren, und Mitspieler können den Rest übernehmen.',
      jsonb_build_object('offer_id', o.id, 'company_id', c.id, 'result', 'failed'), '/company', 'offer-failed:' || o.id::text);
  end if;
  return jsonb_build_object('offer_id', o.id, 'failed', true, 'reason', p_reason, 'refunded_cents', v_back, 'subscribers', v_n);
end;
$$;

-- End of a subscription (full, or the window is over). An IPO that is not full, or an offer of a closed company,
-- fails and everybody gets the money back. Otherwise the money of the players leaves the escrow, AI investors pay,
-- the shares are delivered and an IPO lists the company.
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
  v_issued bigint;
  v_live   bigint;
  v_pay    bigint;
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
  select * into o from public.company_share_offers where id = p_offer_id;
  select * into c from public.companies where id = o.company_id for update;
  if c.phase in ('insolvent', 'dissolved') then
    return public.share_offer_cancel(p_offer_id, 'company_closed');
  end if;
  perform public.share_offer_ai_topup(p_offer_id, now(), true);
  select * into o from public.company_share_offers where id = p_offer_id;
  select * into pc from public.player_companies where company_id = o.company_id;
  v_price4 := o.price_cents * 100;
  v_ai := o.shares_ai_e6;
  v_issued := o.shares_subscribed_e6 + v_ai;
  -- ADR-151: an IPO needs minFillBps of the offered shares, otherwise everybody gets the money back
  if o.kind = 'ipo'
     and v_issued::numeric * 10000 < o.shares_offered_e6::numeric * public.cfg_num(v_ipo, '{minFillBps}', 10000) then
    return public.share_offer_cancel(p_offer_id, 'unfilled');
  end if;

  -- the money: players' subscriptions out of the escrow, AI investors pay now (floor(shares x price))
  select coalesce(sum(x.amount_cents), 0)::bigint into v_live from public.offer_subscriptions x where x.offer_id = o.id;
  v_live := least(v_live, o.escrow_cents);
  if v_live > 0 then
    perform public.ledger_transfer(public.ledger_system_account('offer_escrow'), public.company_cash_account(o.company_id), v_live,
                                   'transfer', 'Zeichnungen der Anleger', 'share_offer', o.id,
                                   'offer-release:' || o.id::text, pc.founder_id);
  end if;
  perform public.share_offer_escrow_rest(o.id, o.escrow_cents - v_live);
  v_pay := floor(v_ai::numeric * o.price_cents / 1000000)::bigint;
  if v_pay > 0 then
    perform public.ledger_transfer(public.ledger_system_account('market'), public.company_cash_account(o.company_id), v_pay,
                                   'transfer', 'Zeichnung durch Investoren', 'share_offer', o.id,
                                   'offer-ai:' || o.id::text, pc.founder_id);
  end if;

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
    perform public.social_notify(s.player_id, 'ipo_result',
      case when o.kind = 'ipo' then c.name || ' ist an der Börse' else 'Kapitalerhöhung: ' || c.name end,
      'Deine gezeichneten Aktien liegen jetzt in deinem Depot.',
      jsonb_build_object('offer_id', o.id, 'company_id', c.id, 'result', 'listed'), '/portfolio', 'offer-done:' || o.id::text);
  end loop;
  update public.company_share_offers
     set status = 'closed', closed_at = now(), security_id = v_sec, escrow_cents = 0
   where id = o.id;
  perform public.company_system_message(c.id,
    case when o.kind = 'ipo' then 'Börsengang abgeschlossen: ' || v_ticker || ' ist an der Börse. '
                                  || public.format_eur(v_live + v_pay) || ' sind in der Firmenkasse.'
         else 'Kapitalerhöhung abgeschlossen: ' || public.format_eur(v_live + v_pay) || ' sind in der Firmenkasse.' end);
  return jsonb_build_object('offer_id', o.id, 'issued_e6', v_issued, 'ai_e6', v_ai, 'security_id', v_sec,
                            'proceeds_cents', v_live + v_pay);
end;
$$;

-- Every minute (run_due_part): AI investors subscribe their share of the time passed; full or due offers end, and
-- so do offers of companies that were closed meanwhile (their subscribers get the money back).
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
  for r in select o.id, o.ends_at <= v_now as due, c.phase in ('insolvent', 'dissolved') as gone
             from public.company_share_offers o join public.companies c on c.id = o.company_id
            where o.status = 'open' order by o.ends_at, o.id loop
    if not r.due and not r.gone then
      perform public.share_offer_ai_topup(r.id, v_now, false);
    end if;
    if r.due or r.gone or exists (select 1 from public.company_share_offers o
                                   where o.id = r.id and o.shares_subscribed_e6 + o.shares_ai_e6 >= o.shares_offered_e6) then
      perform public.close_share_offer(r.id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- The go_public message tells the rule (the function is otherwise unchanged).
do $do$
declare
  v_def text := pg_get_functiondef('public.go_public(uuid, integer)'::regprocedure);
  v_old text := $t$ Minuten; sind alle Aktien gezeichnet, ist die Firma sofort an der Börse.'$t$;
  v_new text := $t$ Minuten. Sind alle Aktien gezeichnet, ist die Firma sofort an der Börse und das Geld kommt in die Kasse. '
                                                   || 'Wird es nicht voll, bekommen alle ihr Geld zurück.'$t$;
begin
  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.share_offer_ai_topup(uuid, timestamptz, boolean)', 'public.offer_json(uuid, uuid)',
    'public.subscribe_offer(uuid, uuid, bigint)', 'public.close_share_offer(uuid)',
    'public.share_offer_cancel(uuid, text)', 'public.share_offer_escrow_rest(uuid, bigint)', 'public.close_due_offers(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.subscribe_offer(uuid, uuid, bigint) to authenticated;
end;
$$;
comment on function public.share_offer_cancel(uuid, text) is
  'Internal: a share offer fails, every subscriber gets the full amount back out of the escrow (ADR-151).';
comment on function public.close_share_offer(uuid) is
  'Internal: end of a share offer. A full IPO lists the company and releases the escrow to it; an IPO below startups.ipo.minFillBps fails with full refunds (ADR-151).';
