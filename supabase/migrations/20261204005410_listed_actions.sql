-- =============================================================================
-- NEXA · 5410 · Listed player companies: investments, dividends, board, books and taxes (ADR-167)
-- =============================================================================
-- RPCs (all with request_id where they write, all founder-only unless noted):
--   get_listed_company()                               -> {listed: LISTED | null}
--   company_invest(request_id, key)                    -> {listed}   research, product, region, machine, ..., benefit, action
--   company_invest_stop(request_id, key)               -> {listed}   retire a product, region, licence or benefit
--   company_declare_dividend(request_id, total_cents)  -> {listed, dividend}
--   company_books_close(request_id, answers, pay)      -> {listed, period}
--   company_tax_pay(request_id)                        -> {listed, paid_cents}
--   company_tax_advisor(request_id, hire)              -> {listed}
--   get_company_accounting(days, before)               -> {cash_cents, days, totals, entries, next_before}
--   get_company_board(company_id)                      -> {board}    every shareholder and the founder
--   board_propose(request_id, company_id, kind, params)-> {board}    shareholders with more than board.minShareBps
--   board_vote(request_id, motion_id, yes)             -> {board}    every shareholder
-- Errors: not_listed, item_unknown, item_locked, item_running, budget_reserved, books_nothing, tax_nothing_due,
-- dividend_limit, board_no_right, board_motion_unknown, board_limit, board_not_shareholder, insufficient_funds,
-- invalid_argument, company_not_found.
-- Idempotent: runs unchanged as supabase/updates/20261204005410_listed_actions.sql.

-- ---------------------------------------------------------------------------
-- A. Investments
-- ---------------------------------------------------------------------------
-- Projects whose time is up: the level in work becomes active
create or replace function public.listed_finish_due(p_company uuid, p_at timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         record;
  v_founder uuid;
  v_name    text;
  v_n       integer := 0;
begin
  select pc.founder_id, c.name into v_founder, v_name
    from public.player_companies pc join public.companies c on c.id = pc.company_id where pc.company_id = p_company;
  for r in update public.company_investments ci
              set level = ci.level + 1, status = 'active', ready_at = null
            where ci.company_id = p_company and ci.ready_at is not null and ci.ready_at <= coalesce(p_at, now())
              and ci.status in ('running', 'active', 'paused')
        returning ci.key, ci.kind, ci.level loop
    v_n := v_n + 1;
    if r.kind = 'research' then
      perform public.mission_event(v_founder, 'research_done', 1, r.key);
      if public.cfg_num(public.listed_item(r.key), '{tier}', 0) >= 4 then
        perform public.feed_post(v_founder, 'research_done', jsonb_build_object('company', v_name, 'item', r.key),
                                 'research:' || p_company::text || ':' || r.key);
      end if;
    elsif r.kind = 'product' then
      perform public.mission_event(v_founder, 'product_launched', 1, r.key);
    elsif r.kind = 'region' then
      perform public.mission_event(v_founder, 'region_opened', 1, r.key);
    end if;
    perform public.social_notify(v_founder, 'company_project', 'Fertig bei ' || v_name,
      case r.kind when 'research' then 'Eine Forschung ist abgeschlossen.' when 'product' then 'Ein neues Produkt ist am Markt.'
                  when 'region' then 'Ein neuer Markt ist eröffnet.' else 'Ein Ausbau ist fertig.' end,
      jsonb_build_object('company_id', p_company, 'item', r.key, 'kind', r.kind, 'level', r.level), '/company',
      'project:' || p_company::text || ':' || r.key || ':' || r.level::text);
  end loop;
  return v_n;
end;
$$;

-- The caller's own listed company, or the error not_listed
create or replace function public.listed_require()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.require_own_company();
begin
  if not public.listed_is(v_company) then
    perform public.api_error('not_listed');
  end if;
  perform public.listed_ensure(v_company);
  return v_company;
end;
$$;

create or replace function public.company_invest(p_request_id uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  v_item    jsonb;
  ci        public.company_investments;
  v_kind    text;
  v_level   integer;
  v_cost    bigint;
  v_budget  bigint;
  v_cash    bigint;
  v_unpaid  bigint;
  v_hours   double precision;
  v_owned   boolean;
begin
  v_company := public.listed_require();
  v_player := public.require_player();
  if p_request_id is null or p_key is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'company_invest');
  if v_replay is not null then
    return v_replay;
  end if;
  perform 1 from public.listed_companies l where l.company_id = v_company for update;
  perform public.listed_finish_due(v_company, now());
  v_item := public.listed_item(p_key);
  if v_item is null then
    perform public.api_error('item_unknown');
  end if;
  v_kind := v_item ->> 'kind';
  select * into ci from public.company_investments x where x.company_id = v_company and x.key = p_key for update;
  v_owned := ci.key is not null and ci.status in ('active', 'paused') and ci.level > 0;
  if exists (select 1 from jsonb_array_elements_text(coalesce(v_item -> 'requires', '[]'::jsonb)) q(k)
              where not exists (select 1 from public.company_investments x
                                 where x.company_id = v_company and x.key = q.k and x.status in ('active', 'paused') and x.level > 0)) then
    perform public.api_error('item_locked');
  end if;
  if v_kind = 'action' then
    if ci.last_used_at is not null
       and ci.last_used_at + make_interval(secs => public.cfg_num(v_item, '{cooldownHours}', 0) * 3600) > now() then
      perform public.api_error('item_running');
    end if;
    v_level := 0;
  else
    if ci.ready_at is not null or (v_owned and ci.level >= public.cfg_num(v_item, '{maxLevel}', 1)) then
      perform public.api_error('item_running');
    end if;
    v_level := case when v_owned then ci.level else 0 end;
  end if;

  -- the price: from the budget of the item's purpose first, then from the free cash
  v_cost := public.listed_item_cost(v_item, v_level, public.listed_ref_revenue(v_company), public.company_headcount(v_company));
  select coalesce((select b.amount_cents from public.company_budgets b
                    where b.company_id = v_company and b.purpose = v_item ->> 'purpose'), 0) into v_budget;
  select a.balance_cents, pc.unpaid_cents into v_cash, v_unpaid
    from public.ledger_accounts a join public.player_companies pc on pc.company_id = a.owner_company_id
   where a.owner_company_id = v_company and a.kind = 'company_cash';
  if v_cost > v_cash - v_unpaid - (public.listed_reserved_cents(v_company) - v_budget) then
    perform public.api_error(case when v_cost <= v_cash - v_unpaid then 'budget_reserved' else 'insufficient_funds' end);
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.company_cash_account(v_company), public.ledger_system_account('households'), v_cost,
      'company_costs',
      case v_kind when 'research' then 'Forschung' when 'product' then 'Produktentwicklung' when 'region' then 'Neuer Markt'
                  when 'machine' then 'Maschinen und Anlagen' when 'acquisition' then 'Firmenkauf' when 'licence' then 'Lizenz'
                  when 'benefit' then 'Benefit einrichten' else 'Aktion fürs Team' end || ': ' || p_key,
      'company', v_company, 'invest:' || p_request_id::text, v_player,
      jsonb_build_object('cat', public.listed_kind_category(v_kind), 'item', p_key, 'one_off', true));
    update public.company_budgets set amount_cents = amount_cents - least(amount_cents, v_cost), updated_at = now()
     where company_id = v_company and purpose = v_item ->> 'purpose';
  end if;

  v_hours := public.cfg_num(v_item, '{hours}', 0);
  if v_kind = 'action' then
    insert into public.company_investments (company_id, key, kind, status, level, last_used_at, spent_cents)
    values (v_company, p_key, v_kind, 'active', 0, now(), v_cost)
    on conflict (company_id, key) do update set last_used_at = now(), spent_cents = public.company_investments.spent_cents + v_cost;
    update public.listed_companies
       set satisfaction = least(100.0, satisfaction + public.cfg_num(v_item, '{boost}', 0))
     where company_id = v_company;
    perform public.mission_event(v_player, 'team_action', 1, p_key);
  else
    insert into public.company_investments (company_id, key, kind, status, level, ready_at, spent_cents)
    values (v_company, p_key, v_kind, case when v_hours > 0 then 'running' else 'active' end, case when v_hours > 0 then 0 else 1 end,
            case when v_hours > 0 then now() + make_interval(secs => v_hours * 3600) end, v_cost)
    on conflict (company_id, key) do update
      set status = case when v_hours > 0 and not v_owned then 'running' when v_hours > 0 then public.company_investments.status else 'active' end,
          level = case when v_hours > 0 then v_level else v_level + 1 end,
          ready_at = case when v_hours > 0 then now() + make_interval(secs => v_hours * 3600) end,
          spent_cents = public.company_investments.spent_cents + v_cost;
    if v_kind = 'research' then
      perform public.mission_event(v_player, 'research_started', 1, p_key);
    elsif v_kind = 'benefit' then
      perform public.mission_event(v_player, 'benefit_added', 1, p_key);
    end if;
  end if;
  perform public.mission_event(v_player, 'listed_invested', 1, p_key);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('listed', public.listed_state(v_company)));
end;
$$;
comment on function public.company_invest(uuid, text) is
  'RPC (founder, listed company): buys or starts an item of game_config.listed.items (ADR-167); errors not_listed, '
  'item_unknown, item_locked, item_running, budget_reserved, insufficient_funds.';

create or replace function public.company_invest_stop(p_request_id uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  v_item    jsonb;
  ci        public.company_investments;
begin
  v_company := public.listed_require();
  v_player := public.require_player();
  if p_request_id is null or p_key is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'company_invest_stop');
  if v_replay is not null then
    return v_replay;
  end if;
  v_item := public.listed_item(p_key);
  select * into ci from public.company_investments x where x.company_id = v_company and x.key = p_key for update;
  if v_item is null or ci.key is null or ci.status = 'retired'
     or v_item ->> 'kind' not in ('product', 'region', 'licence', 'benefit') then
    perform public.api_error('item_unknown');
  end if;
  -- nothing that is still in use may depend on it
  if exists (select 1 from public.company_investments x
              where x.company_id = v_company and x.status <> 'retired' and x.key <> p_key
                and coalesce(public.listed_item(x.key) -> 'requires', '[]'::jsonb) ? p_key) then
    perform public.api_error('item_locked');
  end if;
  if v_item ->> 'kind' = 'benefit' and ci.status = 'active' then
    -- a benefit taken away hurts at once
    update public.listed_companies
       set satisfaction = greatest(0.0, satisfaction - public.cfg_num(v_item, '{effects,satisfaction}', 0))
     where company_id = v_company;
  end if;
  update public.company_investments set status = 'retired', level = 0, ready_at = null
   where company_id = v_company and key = p_key;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('listed', public.listed_state(v_company)));
end;
$$;
comment on function public.company_invest_stop(uuid, text) is
  'RPC (founder, listed company): retires a product, region, licence or benefit, no money back (ADR-167); errors '
  'not_listed, item_unknown, item_locked.';

-- ---------------------------------------------------------------------------
-- B. Shareholders and dividends
-- ---------------------------------------------------------------------------
create or replace function public.board_holdings(p_company uuid)
returns table (player_id uuid, qty_e6 bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.player_id, sum(p.quantity_e6)::bigint
    from public.positions p join public.companies c on c.security_id = p.security_id
   where c.id = p_company and p.status = 'open' and p.side = 'long' and p.quantity_e6 > 0
   group by p.player_id;
$$;

-- All shares (e6): the shares outstanding, or what players hold when that is more (old positions, ADR-153)
create or replace function public.board_total_e6(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce((select c.shares_outstanding from public.companies c where c.id = p_company), 0) * 1000000,
                  coalesce((select sum(h.qty_e6) from public.board_holdings(p_company) h), 0), 1)::bigint;
$$;

create or replace function public.board_my_e6(p_company uuid, p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select h.qty_e6 from public.board_holdings(p_company) h where h.player_id = p_player), 0)::bigint;
$$;

-- Pays a dividend from the company cash: every player holding gets its share (rounded down), the AI float the rest
create or replace function public.listed_pay_dividend(p_company uuid, p_total bigint, p_source text, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c         public.companies;
  pc        public.player_companies;
  l         public.listed_companies;
  v_acc     uuid := public.company_cash_account(p_company);
  v_total6  bigint := public.board_total_e6(p_company);
  v_uid     text := gen_random_uuid()::text;
  v_players bigint := 0;
  v_n       integer := 0;
  v_amt     bigint;
  v_float   bigint;
  v_id      bigint;
  v_today   date := (now() at time zone 'Europe/Berlin')::date;
  h         record;
begin
  select * into c from public.companies where id = p_company;
  select * into pc from public.player_companies where company_id = p_company;
  select * into l from public.listed_companies where company_id = p_company for update;
  for h in select x.player_id, x.qty_e6 from public.board_holdings(p_company) x order by x.player_id loop
    v_amt := floor(p_total::numeric * h.qty_e6 / v_total6)::bigint;
    continue when v_amt <= 0;
    perform public.lock_player_accounts(h.player_id);
    perform public.ledger_transfer(v_acc, public.ledger_player_account(h.player_id, 'player_cash'), v_amt, 'dividend',
                                   'Dividende ' || c.name, 'company', p_company, 'dividend:' || v_uid || ':' || h.player_id::text,
                                   p_by, jsonb_build_object('cat', 'dividend'));
    perform public.loan_withhold(h.player_id, v_amt, 'dividend:' || v_uid || ':' || h.player_id::text);
    perform public.social_notify(h.player_id, 'company_dividend', 'Dividende von ' || c.name,
      public.format_eur(v_amt) || ' für deine Aktien.', jsonb_build_object('company_id', p_company, 'amount_cents', v_amt),
      '/portfolio', 'dividend:' || v_uid);
    v_players := v_players + v_amt;
    v_n := v_n + 1;
  end loop;
  v_float := p_total - v_players;
  if v_float > 0 then
    perform public.ledger_transfer(v_acc, public.ledger_system_account('market'), v_float, 'dividend',
                                   'Dividende ' || c.name || ' (Streubesitz)', 'company', p_company, 'dividend:' || v_uid || ':float',
                                   p_by, jsonb_build_object('cat', 'dividend'));
  end if;
  insert into public.company_dividends (company_id, source, total_cents, players_cents, float_cents, shares_e6, holders)
  values (p_company, p_source, p_total, v_players, v_float, v_total6, v_n)
  returning id into v_id;
  if p_total > l.best_dividend_cents then
    perform public.feed_post(pc.founder_id, 'record_dividend', jsonb_build_object('company', c.name, 'amount_cents', p_total),
                             'record_dividend:' || v_id::text);
  end if;
  update public.listed_companies
     set dividend_streak = case when dividend_day = v_today then dividend_streak
                                when dividend_day = v_today - 1 then dividend_streak + 1 else 1 end,
         dividend_day = v_today, best_dividend_cents = greatest(best_dividend_cents, p_total)
   where company_id = p_company;
  perform public.company_system_message(p_company, 'Dividende: ' || public.format_eur(p_total) || ' an die Aktionäre ausgeschüttet.');
  return jsonb_build_object('id', v_id, 'total_cents', p_total, 'players_cents', v_players, 'float_cents', v_float, 'holders', v_n);
end;
$$;

create or replace function public.company_declare_dividend(p_request_id uuid, p_total_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.listed_cfg();
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  v_free    bigint;
  v_div     jsonb;
begin
  v_company := public.listed_require();
  v_player := public.require_player();
  if p_request_id is null or p_total_cents is null or p_total_cents < public.cfg_num(cfg, '{dividends,minTotalCents}', 10000) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'company_declare_dividend');
  if v_replay is not null then
    return v_replay;
  end if;
  perform 1 from public.player_companies pc where pc.company_id = v_company for update;
  if (select count(*) from public.company_dividends d
       where d.company_id = v_company and d.source = 'founder'
         and (d.paid_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date)
     >= public.cfg_num(cfg, '{dividends,perDay}', 1) then
    perform public.api_error('dividend_limit');
  end if;
  v_free := greatest(0, public.listed_free_cash(v_company));
  if p_total_cents > v_free then
    perform public.api_error('insufficient_funds');
  end if;
  if p_total_cents > v_free * public.cfg_num(cfg, '{dividends,maxShareOfFreeCashBps}', 5000)::bigint / 10000 then
    perform public.api_error('dividend_limit');
  end if;
  v_div := public.listed_pay_dividend(v_company, p_total_cents, 'founder', v_player);
  perform public.mission_event(v_player, 'dividend_paid', 1, v_div ->> 'id');
  perform public.mission_event(v_player, 'dividend_cents', p_total_cents, v_div ->> 'id');
  return public.request_complete(v_player, p_request_id,
    jsonb_build_object('listed', public.listed_state(v_company), 'dividend', v_div));
end;
$$;
comment on function public.company_declare_dividend(uuid, bigint) is
  'RPC (founder, listed company): pays a dividend of p_total_cents from the free cash to all shareholders, at most '
  'dividends.perDay per Berlin day and maxShareOfFreeCashBps of the free cash (ADR-167); errors not_listed, '
  'invalid_argument, dividend_limit, insufficient_funds.';

-- ---------------------------------------------------------------------------
-- C. Books and taxes
-- ---------------------------------------------------------------------------
-- The category of a booking on the company cash account
create or replace function public.listed_ledger_category(p_kind text, p_key text, p_meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_meta, '{}'::jsonb) ? 'cat' then p_meta ->> 'cat'
    when p_kind = 'company_revenue' then 'revenue'
    when p_kind in ('salary', 'payroll', 'work_bonus') then 'wages'
    when p_kind = 'company_costs' and coalesce(p_key, '') like '%:goods' then 'goods'
    when p_kind = 'company_costs' and (coalesce(p_key, '') like '%:costs' or coalesce(p_key, '') like '%:settle') then 'fixed'
    when p_kind = 'company_costs' then 'costs'
    when p_kind in ('tax', 'tax_refund') then 'tax'
    when p_kind = 'fine' then 'penalty'
    when p_kind = 'dividend' then 'dividend'
    when p_kind = 'transfer' and (coalesce(p_key, '') like 'withdraw:%' or coalesce(p_key, '') like '%:payout') then 'payout'
    when p_kind = 'transfer' and coalesce(p_key, '') like 'offer-%' then 'capital'
    when p_kind in ('capital_injection', 'company_founding', 'company_conversion', 'ipo_proceeds', 'capital_increase',
                    'angel_investment', 'ipo_subscription', 'ipo_refund') then 'capital'
    when p_kind in ('transfer', 'loan_disbursement', 'loan_repayment', 'loan_interest', 'insolvency_distribution',
                    'reversal', 'admin_adjustment') then 'transfer'
    else 'costs' end;
$$;

create or replace function public.listed_is_operating(p_category text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_category in ('revenue', 'goods', 'wages', 'fixed', 'research', 'product', 'expansion', 'benefit', 'advisor', 'costs');
$$;

-- Revenue, operating costs and the net amount per category of the bookings in (p_from, p_to]
create or replace function public.listed_period_sums(p_company uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select public.listed_ledger_category(t.kind::text, t.idempotency_key, t.metadata) as cat, e.amount_cents
      from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
     where e.account_id = public.company_cash_account(p_company) and e.created_at > p_from and e.created_at <= p_to
  )
  select jsonb_build_object(
    'revenue_cents', coalesce((select sum(amount_cents) from e where cat = 'revenue'), 0)::bigint,
    'costs_cents', coalesce((select -sum(amount_cents) from e where public.listed_is_operating(cat) and cat <> 'revenue'), 0)::bigint,
    'by_category', coalesce((select jsonb_object_agg(x.cat, x.s) from (select cat, sum(amount_cents)::bigint as s from e group by cat) x),
                            '{}'::jsonb));
$$;

-- The receipts of the open period: picked from the templates by the company and the period, with their category
create or replace function public.listed_books_receipts(p_company uuid, p_from timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.pos, 'key', q.x ->> 'key', 'category', q.x ->> 'category',
                                               'amount_cents', 1000 + (hashtext(p_company::text || p_from::text || (q.x ->> 'key'))::bigint & 2147483647) % 49000)
                            order by q.pos), '[]'::jsonb)
    from (select t.x, row_number() over (order by md5(p_company::text || p_from::text || t.ord::text)) as pos
            from jsonb_array_elements(coalesce(public.listed_cfg() #> '{taxes,receipts}', '[]'::jsonb)) with ordinality t(x, ord)) q
   where q.pos <= greatest(0, public.cfg_num(public.listed_cfg(), '{taxes,check,receipts}', 3)::integer);
$$;

create or replace function public.listed_tax_rate_bps(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(public.cfg_num(public.listed_cfg(), '{taxes,minRateBps}', 800),
                  public.cfg_num(public.listed_cfg(), '{taxes,rateBps}', 1500)
                  + public.cfg_num(public.listed_effects(p_company), '{taxRateBps}', 0))::integer;
$$;

-- The open bookkeeping period as the founder sees it
create or replace function public.listed_books_preview(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.listed_cfg();
  l       public.listed_companies;
  s       jsonb;
  v_rev   bigint;
  v_costs bigint;
  v_hours double precision;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_done  boolean;
  v_rate  integer := public.listed_tax_rate_bps(p_company);
begin
  select * into l from public.listed_companies where company_id = p_company;
  s := public.listed_period_sums(p_company, l.books_until, now());
  v_rev := (s ->> 'revenue_cents')::bigint;
  v_costs := (s ->> 'costs_cents')::bigint;
  v_hours := extract(epoch from (now() - l.books_until)) / 3600.0;
  v_done := l.books_day is not null and l.books_day >= v_today;
  return jsonb_build_object(
    'period_start', l.books_until,
    'revenue_cents', v_rev,
    'costs_cents', v_costs,
    'profit_cents', v_rev - v_costs,
    'by_category', s -> 'by_category',
    'loss_carry_cents', l.loss_carry_cents,
    'rate_bps', v_rate,
    'estimated_tax_cents', greatest(0, (greatest(0, v_rev - v_costs - l.loss_carry_cents) * v_rate) / 10000),
    'receipts', (select coalesce(jsonb_agg(r - 'category' order by (r ->> 'id')::integer), '[]'::jsonb)
                   from jsonb_array_elements(public.listed_books_receipts(p_company, l.books_until)) r),
    'receipt_categories', coalesce(cfg #> '{taxes,receiptCategories}', '[]'::jsonb),
    'can_close', v_rev > 0 and not v_done,
    'done_today', v_done,
    'hours_open', round(v_hours::numeric, 2),
    'stage', case when v_rev <= 0 then 'none'
                  when v_hours >= public.cfg_num(cfg, '{taxes,estimateAfterHours}', 60) then 'estimate'
                  when v_hours >= public.cfg_num(cfg, '{taxes,lateFeeAfterHours}', 42) then 'late'
                  when v_hours >= public.cfg_num(cfg, '{taxes,reminderAfterHours}', 30) then 'reminder'
                  else 'open' end,
    'reminder_at', l.books_until + make_interval(secs => public.cfg_num(cfg, '{taxes,reminderAfterHours}', 30) * 3600),
    'late_fee_at', l.books_until + make_interval(secs => public.cfg_num(cfg, '{taxes,lateFeeAfterHours}', 42) * 3600),
    'estimate_at', l.books_until + make_interval(secs => public.cfg_num(cfg, '{taxes,estimateAfterHours}', 60) * 3600),
    'streak', l.books_streak,
    'last_day', l.books_day);
end;
$$;

-- Closes the open period: by the founder (p_correct receipts right), the advisor or the tax office (estimate)
create or replace function public.listed_books_do(p_company uuid, p_by text, p_correct integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.listed_cfg();
  l        public.listed_companies;
  s        jsonb;
  v_rev    bigint;
  v_costs  bigint;
  v_profit bigint;
  v_rate   integer := public.listed_tax_rate_bps(p_company);
  v_carry  bigint;
  v_used   bigint := 0;
  v_tax_on bigint := 0;
  v_gross  bigint := 0;
  v_disc   bigint := 0;
  v_tax    bigint := 0;
  v_pen    bigint := 0;
  v_bps    integer;
  v_today  date := (now() at time zone 'Europe/Berlin')::date;
  v_streak integer;
  v_id     bigint;
  v_owner  uuid;
begin
  select * into l from public.listed_companies where company_id = p_company for update;
  if l.company_id is null then
    return null;
  end if;
  s := public.listed_period_sums(p_company, l.books_until, now());
  v_rev := (s ->> 'revenue_cents')::bigint;
  v_costs := (s ->> 'costs_cents')::bigint;
  v_profit := v_rev - v_costs;
  v_carry := l.loss_carry_cents;
  if p_by = 'finanzamt' then
    -- estimateTax: at least a margin on the revenue, no loss carried, a surcharge on the tax
    v_tax_on := greatest(v_profit, (v_rev * public.cfg_num(cfg, '{taxes,estimate,marginBps}', 2500)::bigint) / 10000, 0);
    v_tax := (v_tax_on * v_rate) / 10000;
    v_pen := (v_tax * public.cfg_num(cfg, '{taxes,estimate,surchargeBps}', 2500)::bigint) / 10000;
  elsif v_profit <= 0 then
    v_carry := v_carry - v_profit;
  else
    -- booksTax: the carried loss first, the tax rounded down, the discount off the tax
    v_used := least(v_carry, v_profit);
    v_tax_on := v_profit - v_used;
    v_carry := v_carry - v_used;
    v_gross := (v_tax_on * v_rate) / 10000;
    v_bps := case when p_by = 'advisor' then public.cfg_num(cfg, '{taxes,advisor,discountBps}', 800)::integer
                  when coalesce(p_correct, 0) >= public.cfg_num(cfg, '{taxes,check,receipts}', 3)
                  then public.cfg_num(cfg, '{taxes,check,discountBps}', 500)::integer else 0 end;
    v_disc := (v_gross * v_bps) / 10000;
    v_tax := v_gross - v_disc;
  end if;
  insert into public.company_tax_periods (company_id, kind, period_start, period_end, revenue_cents, costs_cents, profit_cents,
                                          loss_used_cents, taxable_cents, rate_bps, discount_cents, tax_cents, penalty_cents, status,
                                          closed_by, check_correct, due_at, paid_at)
  values (p_company, 'books', l.books_until, now(), v_rev, v_costs, v_profit, v_used, v_tax_on, v_rate, v_disc, v_tax, v_pen,
          case when v_tax + v_pen = 0 then 'paid' else 'due' end, p_by, p_correct,
          now() + make_interval(secs => public.cfg_num(cfg, '{taxes,payWithinHours}', 24) * 3600),
          case when v_tax + v_pen = 0 then now() end)
  returning id into v_id;
  v_streak := case when p_by = 'finanzamt' then 0
                   when l.books_day = v_today then greatest(1, l.books_streak)
                   when l.books_day = v_today - 1 then l.books_streak + 1 else 1 end;
  update public.listed_companies
     set books_until = now(), books_day = v_today, books_stage = 0, loss_carry_cents = v_carry, books_streak = v_streak
   where company_id = p_company;
  if p_by <> 'finanzamt' then
    select pc.founder_id into v_owner from public.player_companies pc where pc.company_id = p_company;
    perform public.mission_event(v_owner, 'books_done', 1, v_id::text);
    perform public.mission_event(v_owner, 'books_streak', v_streak, v_id::text);
  end if;
  return v_id;
end;
$$;

-- Pays due taxes and penalties from the company cash to the treasury, oldest first. Voluntary: whole periods only,
-- up to p_limit. Forced (tax office): whatever the cash holds.
create or replace function public.listed_tax_collect(p_company uuid, p_limit bigint, p_force boolean)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc   uuid := public.company_cash_account(p_company);
  v_tre   uuid := public.ledger_system_account('treasury');
  v_owner uuid;
  v_avail bigint;
  v_rest  bigint;
  v_pay   bigint;
  v_taxp  bigint;
  v_done  bigint := 0;
  p       record;
begin
  select pc.founder_id into v_owner from public.player_companies pc where pc.company_id = p_company;
  select greatest(0, a.balance_cents) into v_avail from public.ledger_accounts a where a.id = v_acc;
  v_avail := least(coalesce(v_avail, 0), coalesce(p_limit, v_avail));
  for p in select * from public.company_tax_periods x where x.company_id = p_company and x.status = 'due'
            order by x.id for update loop
    v_rest := p.tax_cents + p.penalty_cents - p.paid_cents;
    v_pay := least(v_rest, v_avail);
    exit when v_pay <= 0 or (not p_force and v_pay < v_rest);
    v_taxp := least(v_pay, greatest(0, p.tax_cents - p.paid_cents));
    if v_taxp > 0 then
      perform public.ledger_transfer(v_acc, v_tre, v_taxp, 'tax', 'Körperschaftsteuer', 'company', p_company,
                                     'ctax:' || p.id::text || ':' || p.paid_cents::text, v_owner, jsonb_build_object('cat', 'tax'));
    end if;
    if v_pay - v_taxp > 0 then
      perform public.ledger_transfer(v_acc, v_tre, v_pay - v_taxp, 'fine', 'Zuschläge des Finanzamts', 'company', p_company,
                                     'cfine:' || p.id::text || ':' || p.paid_cents::text, v_owner, jsonb_build_object('cat', 'penalty'));
    end if;
    update public.company_tax_periods
       set paid_cents = paid_cents + v_pay,
           status = case when v_pay = v_rest then 'paid' else 'due' end,
           paid_at = case when v_pay = v_rest then now() else paid_at end
     where id = p.id;
    if v_pay = v_rest and p.kind = 'books' and p.closed_by <> 'finanzamt' and p.tax_cents > 0 and p.stage = 0 and now() <= p.due_at then
      perform public.mission_event(v_owner, 'tax_paid', 1, p.id::text);
    end if;
    v_avail := v_avail - v_pay;
    v_done := v_done + v_pay;
  end loop;
  return v_done;
end;
$$;

create or replace function public.listed_tax_due_cents(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(x.tax_cents + x.penalty_cents - x.paid_cents) from public.company_tax_periods x
                    where x.company_id = p_company and x.status = 'due'), 0)::bigint;
$$;

create or replace function public.company_books_close(p_request_id uuid, p_answers text[] default null, p_pay boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  l         public.listed_companies;
  v_correct integer;
  v_id      bigint;
  v_paid    bigint := 0;
begin
  v_company := public.listed_require();
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'company_books_close');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into l from public.listed_companies where company_id = v_company for update;
  if not (public.listed_books_preview(v_company) ->> 'can_close')::boolean then
    perform public.api_error('books_nothing');
  end if;
  -- gradeReceipts: how many receipts are in the right category
  select count(*) into v_correct
    from jsonb_array_elements(public.listed_books_receipts(v_company, l.books_until)) r
   where (coalesce(p_answers, '{}'::text[]))[(r ->> 'id')::integer] = r ->> 'category';
  v_id := public.listed_books_do(v_company, 'founder', v_correct);
  if coalesce(p_pay, false) and public.listed_tax_due_cents(v_company) > 0 then
    v_paid := public.listed_tax_collect(v_company, null, false);
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'listed', public.listed_state(v_company), 'paid_cents', v_paid,
    'period', (select public.listed_tax_period_json(x) from public.company_tax_periods x where x.id = v_id)));
end;
$$;
comment on function public.company_books_close(uuid, text[], boolean) is
  'RPC (founder, listed company): closes the books of the open period, once per Berlin day with revenue (ADR-167). '
  'p_answers: the category of every receipt in order (all right: tax discount); p_pay pays what is due at once when '
  'the cash allows. Errors not_listed, books_nothing.';

create or replace function public.listed_tax_period_json(p public.company_tax_periods)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'period_start', p.period_start, 'period_end', p.period_end,
                            'revenue_cents', p.revenue_cents, 'costs_cents', p.costs_cents, 'profit_cents', p.profit_cents,
                            'loss_used_cents', p.loss_used_cents, 'taxable_cents', p.taxable_cents, 'rate_bps', p.rate_bps,
                            'discount_cents', p.discount_cents, 'tax_cents', p.tax_cents, 'penalty_cents', p.penalty_cents,
                            'paid_cents', p.paid_cents, 'status', p.status, 'closed_by', p.closed_by,
                            'check_correct', p.check_correct, 'stage', p.stage, 'due_at', p.due_at, 'paid_at', p.paid_at);
$$;

create or replace function public.company_tax_pay(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  v_due     bigint;
  v_paid    bigint;
begin
  v_company := public.listed_require();
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'company_tax_pay');
  if v_replay is not null then
    return v_replay;
  end if;
  perform 1 from public.player_companies pc where pc.company_id = v_company for update;
  v_due := public.listed_tax_due_cents(v_company);
  if v_due <= 0 then
    perform public.api_error('tax_nothing_due');
  end if;
  if coalesce((select a.balance_cents from public.ledger_accounts a where a.id = public.company_cash_account(v_company)), 0) < v_due then
    perform public.api_error('insufficient_funds');
  end if;
  v_paid := public.listed_tax_collect(v_company, null, false);
  return public.request_complete(v_player, p_request_id,
    jsonb_build_object('listed', public.listed_state(v_company), 'paid_cents', v_paid));
end;
$$;
comment on function public.company_tax_pay(uuid) is
  'RPC (founder, listed company): pays all due taxes and penalties from the company cash to the treasury (ADR-167); '
  'errors not_listed, tax_nothing_due, insufficient_funds.';

create or replace function public.company_tax_advisor(p_request_id uuid, p_hire boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
begin
  v_company := public.listed_require();
  v_player := public.require_player();
  if p_request_id is null or p_hire is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'company_tax_advisor');
  if v_replay is not null then
    return v_replay;
  end if;
  update public.listed_companies set advisor = p_hire where company_id = v_company;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('listed', public.listed_state(v_company)));
end;
$$;
comment on function public.company_tax_advisor(uuid, boolean) is
  'RPC (founder, listed company): hires or dismisses the tax advisor, who is paid by the hour, closes the books every '
  'day and pays the tax (ADR-167); error not_listed.';

-- The tax office sends an audit: a company event of the crisis system (no second event while one is running)
create or replace function public.listed_audit(p_company uuid, p_severity integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_name  text;
begin
  select pc.founder_id, c.name into v_owner, v_name
    from public.player_companies pc join public.companies c on c.id = pc.company_id where pc.company_id = p_company;
  perform public.company_event_start(p_company, coalesce(public.listed_cfg() #>> '{taxes,auditArchetype}', 'tax_audit'),
                                     least(3, greatest(1, p_severity)));
  perform public.feed_post(v_owner, 'tax_audit', jsonb_build_object('company', v_name),
                           'tax_audit:' || p_company::text || ':' || (now() at time zone 'Europe/Berlin')::date::text);
end;
$$;

-- Every hour: the advisor closes the books of a new day and pays; otherwise the tax office reminds, charges a late
-- fee and finally estimates. Unpaid taxes get a surcharge and are collected by force.
create or replace function public.listed_tax_office(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.listed_cfg();
  l       public.listed_companies;
  v_owner uuid;
  v_name  text;
  v_rev   bigint;
  v_hours double precision;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_fee   bigint;
  v_add   bigint;
  v_force boolean := false;
  p       record;
begin
  select * into l from public.listed_companies where company_id = p_company for update;
  if l.company_id is null then
    return;
  end if;
  select pc.founder_id, c.name into v_owner, v_name
    from public.player_companies pc join public.companies c on c.id = pc.company_id where pc.company_id = p_company;
  v_rev := (public.listed_period_sums(p_company, l.books_until, now()) ->> 'revenue_cents')::bigint;
  v_hours := extract(epoch from (now() - l.books_until)) / 3600.0;
  if l.advisor then
    if v_rev > 0 and (l.books_day is null or l.books_day < v_today) then
      perform public.listed_books_do(p_company, 'advisor', 0);
    end if;
    perform public.listed_tax_collect(p_company, greatest(0, public.listed_free_cash(p_company)), false);
  elsif v_rev > 0 then
    if v_hours >= public.cfg_num(cfg, '{taxes,estimateAfterHours}', 60) then
      perform public.listed_books_do(p_company, 'finanzamt', 0);
      perform public.listed_reputation_bump(p_company, -public.cfg_num(cfg, '{reputation,penalty,estimate}', 6));
      perform public.social_notify(v_owner, 'tax_office', 'Finanzamt: Steuer geschätzt',
        'Du hast die Bücher von ' || v_name || ' nicht gemacht. Das Finanzamt hat geschätzt und schlägt einen Zuschlag auf.',
        jsonb_build_object('company_id', p_company), '/company', 'tax-est:' || p_company::text || ':' || l.books_until::text);
      perform public.feed_post(v_owner, 'tax_penalty', jsonb_build_object('company', v_name, 'reason', 'estimate'),
                               'tax_penalty:est:' || p_company::text || ':' || l.books_until::text);
      perform public.listed_audit(p_company, 1);
    elsif v_hours >= public.cfg_num(cfg, '{taxes,lateFeeAfterHours}', 42) and l.books_stage < 2 then
      v_fee := greatest(public.cfg_num(cfg, '{taxes,lateFee,minCents}', 5000)::bigint,
                        (v_rev * public.cfg_num(cfg, '{taxes,lateFee,revenueBps}', 50)::bigint) / 10000);
      insert into public.company_tax_periods (company_id, kind, period_start, period_end, penalty_cents, closed_by, due_at)
      values (p_company, 'late_fee', l.books_until, now(), v_fee, 'finanzamt',
              now() + make_interval(secs => public.cfg_num(cfg, '{taxes,payWithinHours}', 24) * 3600));
      update public.listed_companies set books_stage = 2 where company_id = p_company;
      perform public.listed_reputation_bump(p_company, -public.cfg_num(cfg, '{reputation,penalty,lateFee}', 3));
      perform public.social_notify(v_owner, 'tax_office', 'Finanzamt: Verspätungszuschlag',
        'Die Bücher von ' || v_name || ' sind überfällig: ' || public.format_eur(v_fee) || ' Zuschlag. Mach sie jetzt, sonst schätzt das Finanzamt.',
        jsonb_build_object('company_id', p_company, 'amount_cents', v_fee), '/company',
        'tax-fee:' || p_company::text || ':' || l.books_until::text);
      perform public.feed_post(v_owner, 'tax_penalty', jsonb_build_object('company', v_name, 'reason', 'late_fee', 'amount_cents', v_fee),
                               'tax_penalty:fee:' || p_company::text || ':' || l.books_until::text);
    elsif v_hours >= public.cfg_num(cfg, '{taxes,reminderAfterHours}', 30) and l.books_stage < 1 then
      update public.listed_companies set books_stage = 1 where company_id = p_company;
      perform public.social_notify(v_owner, 'tax_office', 'Finanzamt: Bücher fällig',
        'Mach die Bücher von ' || v_name || '. Sonst kommt ein Verspätungszuschlag.',
        jsonb_build_object('company_id', p_company), '/company', 'tax-rem:' || p_company::text || ':' || l.books_until::text);
    end if;
  end if;

  -- unpaid taxes: a surcharge after the deadline, then collection by force
  for p in select * from public.company_tax_periods x where x.company_id = p_company and x.status = 'due'
            order by x.id for update loop
    if p.stage = 0 and now() > p.due_at then
      v_add := (greatest(0, p.tax_cents - p.paid_cents) * public.cfg_num(cfg, '{taxes,latePaymentBps}', 500)::bigint) / 10000;
      update public.company_tax_periods set stage = 1, penalty_cents = penalty_cents + v_add where id = p.id;
      perform public.social_notify(v_owner, 'tax_office', 'Finanzamt: Steuer überfällig',
        'Die Steuer von ' || v_name || ' ist nicht bezahlt. Säumniszuschlag: ' || public.format_eur(v_add) || '.',
        jsonb_build_object('company_id', p_company, 'amount_cents', v_add), '/company', 'tax-late:' || p.id::text);
    elsif p.stage = 1
          and now() > p.due_at + make_interval(secs => public.cfg_num(cfg, '{taxes,enforceAfterHours}', 48) * 3600) then
      v_add := (greatest(0, p.tax_cents - p.paid_cents) * public.cfg_num(cfg, '{taxes,enforcementBps}', 1000)::bigint) / 10000;
      update public.company_tax_periods set stage = 2, penalty_cents = penalty_cents + v_add where id = p.id;
      perform public.listed_reputation_bump(p_company, -public.cfg_num(cfg, '{reputation,penalty,enforcement}', 8));
      perform public.social_notify(v_owner, 'tax_office', 'Finanzamt: Vollstreckung',
        'Das Finanzamt holt sich die Steuer von ' || v_name || ' jetzt direkt aus der Kasse.',
        jsonb_build_object('company_id', p_company), '/company', 'tax-force:' || p.id::text);
      perform public.feed_post(v_owner, 'tax_penalty', jsonb_build_object('company', v_name, 'reason', 'enforcement'),
                               'tax_penalty:force:' || p.id::text);
      perform public.listed_audit(p_company, 2);
      v_force := true;
    elsif p.stage >= 2 then
      v_force := true;
    end if;
  end loop;
  if v_force then
    perform public.listed_tax_collect(p_company, null, true);
  end if;
end;
$$;

-- The books: bookings of the company cash account by category, per day and one by one
create or replace function public.get_company_accounting(p_days integer default 7, p_before bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.listed_require();
  v_acc     uuid := public.company_cash_account(v_company);
  v_days    integer := least(30, greatest(1, coalesce(p_days, 7)));
  v_page    integer := greatest(1, public.cfg_num(public.listed_cfg(), '{accountingPageSize}', 50)::integer);
  v_from    timestamptz;
  v_entries jsonb;
begin
  v_from := (((now() at time zone 'Europe/Berlin')::date - (v_days - 1))::timestamp) at time zone 'Europe/Berlin';
  select coalesce(jsonb_agg(x.j order by x.id desc), '[]'::jsonb) into v_entries
    from (select e.id, jsonb_build_object('id', e.id, 'at', e.created_at, 'amount_cents', e.amount_cents,
                   'balance_after_cents', e.balance_after_cents, 'description', t.description, 'kind', t.kind,
                   'category', public.listed_ledger_category(t.kind::text, t.idempotency_key, t.metadata),
                   'item', t.metadata ->> 'item') as j
            from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
           where e.account_id = v_acc and (p_before is null or e.id < p_before)
           order by e.id desc limit v_page) x;
  return jsonb_build_object(
    'cash_cents', (select a.balance_cents from public.ledger_accounts a where a.id = v_acc),
    'from', v_from,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'in_cents', d.inc, 'out_cents', d.outc, 'operating_cents', d.op,
                                          'by_category', d.cats) order by d.day desc)
        from (select q.day, coalesce(sum(q.s) filter (where q.s > 0), 0)::bigint as inc, coalesce(-sum(q.s) filter (where q.s < 0), 0)::bigint as outc,
                     coalesce(sum(q.s) filter (where public.listed_is_operating(q.cat)), 0)::bigint as op,
                     jsonb_object_agg(q.cat, q.s) as cats
                from (select (e.created_at at time zone 'Europe/Berlin')::date as day,
                             public.listed_ledger_category(t.kind::text, t.idempotency_key, t.metadata) as cat,
                             sum(e.amount_cents)::bigint as s
                        from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                       where e.account_id = v_acc and e.created_at >= v_from
                       group by 1, 2) q
               group by q.day) d), '[]'::jsonb),
    'totals', coalesce((
      select jsonb_object_agg(q.cat, q.s)
        from (select public.listed_ledger_category(t.kind::text, t.idempotency_key, t.metadata) as cat, sum(e.amount_cents)::bigint as s
                from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
               where e.account_id = v_acc and e.created_at >= v_from
               group by 1) q), '{}'::jsonb),
    'entries', v_entries,
    'next_before', case when jsonb_array_length(v_entries) >= v_page then (v_entries -> -1 ->> 'id')::bigint end);
end;
$$;
comment on function public.get_company_accounting(integer, bigint) is
  'RPC (founder, listed company): the books (ADR-167). Real bookings of the company cash account by category: sums '
  'per Berlin day for the last p_days (1 to 30), and the single bookings, newest first, paged by p_before. Error not_listed.';

-- ---------------------------------------------------------------------------
-- D. The board
-- ---------------------------------------------------------------------------
-- What a passed motion does
create or replace function public.board_execute(p_motion bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        public.board_motions;
  v_amt    bigint;
  v_until  timestamptz;
  v_paid   bigint := 0;
  v_cash   bigint;
  v_unpaid bigint;
  v_owner  uuid;
begin
  select * into m from public.board_motions where id = p_motion;
  v_until := now() + make_interval(days => coalesce((m.params ->> 'days')::integer, 1));
  select pc.founder_id into v_owner from public.player_companies pc where pc.company_id = m.company_id;
  if m.kind = 'earmark' then
    v_amt := least((m.params ->> 'amount_cents')::bigint, greatest(0, public.listed_free_cash(m.company_id)));
    if v_amt > 0 then
      insert into public.company_budgets (company_id, purpose, amount_cents) values (m.company_id, m.params ->> 'purpose', v_amt)
      on conflict (company_id, purpose) do update
        set amount_cents = public.company_budgets.amount_cents + excluded.amount_cents, updated_at = now();
    end if;
    return jsonb_build_object('amount_cents', v_amt);
  elsif m.kind = 'release' then
    delete from public.company_budgets b where b.company_id = m.company_id and b.purpose = m.params ->> 'purpose'
    returning b.amount_cents into v_amt;
    return jsonb_build_object('amount_cents', coalesce(v_amt, 0));
  elsif m.kind = 'dividend' then
    v_amt := least((m.params ->> 'amount_cents')::bigint, greatest(0, public.listed_free_cash(m.company_id)));
    if v_amt > 0 then
      return public.listed_pay_dividend(m.company_id, v_amt, 'board', m.proposer_id);
    end if;
    return jsonb_build_object('total_cents', 0);
  elsif m.kind = 'payout_cap' then
    update public.listed_companies set payout_cap_bps = (m.params ->> 'bps')::integer, payout_cap_until = v_until
     where company_id = m.company_id;
    update public.player_companies set founder_payout_bps = least(founder_payout_bps, (m.params ->> 'bps')::integer)
     where company_id = m.company_id;
    return jsonb_build_object('until', v_until);
  elsif m.kind = 'withdraw_ban' then
    update public.listed_companies set withdraw_block_until = v_until where company_id = m.company_id;
    return jsonb_build_object('until', v_until);
  elsif m.kind = 'price_level' then
    update public.listed_companies set price_lock = m.params ->> 'price_level', price_lock_until = v_until
     where company_id = m.company_id;
    update public.player_companies set price_level = m.params ->> 'price_level' where company_id = m.company_id;
    return jsonb_build_object('until', v_until);
  elsif m.kind = 'debt' then
    -- taxes and penalties first, then open bills
    v_amt := (m.params ->> 'amount_cents')::bigint;
    v_paid := public.listed_tax_collect(m.company_id, v_amt, true);
    select greatest(0, a.balance_cents), pc.unpaid_cents into v_cash, v_unpaid
      from public.ledger_accounts a join public.player_companies pc on pc.company_id = a.owner_company_id
     where a.owner_company_id = m.company_id and a.kind = 'company_cash';
    v_amt := least(v_amt - v_paid, v_cash, v_unpaid);
    if v_amt > 0 then
      perform public.ledger_transfer(public.company_cash_account(m.company_id), public.ledger_system_account('households'), v_amt,
                                     'company_costs', 'Offene Rechnungen (Geschäftsrat)', 'company', m.company_id,
                                     'board-debt:' || m.id::text, v_owner, jsonb_build_object('cat', 'fixed'));
      update public.player_companies set unpaid_cents = unpaid_cents - v_amt, distress = unpaid_cents - v_amt > 0
       where company_id = m.company_id;
      v_paid := v_paid + v_amt;
    end if;
    return jsonb_build_object('amount_cents', v_paid);
  end if;
  return '{}'::jsonb;
end;
$$;

-- Counts a motion: by shares held now; the AI float votes yes on shareholder protection while the reputation is
-- low. Ends it when the time is up (p_final) or one side holds more than half of all shares.
create or replace function public.board_tally(p_motion bigint, p_final boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.listed_cfg();
  m        public.board_motions;
  v_total  bigint;
  v_yes    bigint;
  v_no     bigint;
  v_float  bigint;
  v_ai     bigint := 0;
  v_rep    double precision;
  v_status text;
  v_result jsonb := '{}'::jsonb;
  v_owner  uuid;
  v_name   text;
  r        record;
begin
  select * into m from public.board_motions where id = p_motion for update;
  if m.id is null or m.status <> 'open' then
    return m.status;
  end if;
  v_total := public.board_total_e6(m.company_id);
  select coalesce(sum(h.qty_e6) filter (where v.yes), 0), coalesce(sum(h.qty_e6) filter (where not v.yes), 0)
    into v_yes, v_no
    from public.board_votes v join public.board_holdings(m.company_id) h on h.player_id = v.player_id
   where v.motion_id = m.id;
  v_float := greatest(0, v_total - coalesce((select sum(h.qty_e6) from public.board_holdings(m.company_id) h), 0));
  select l.reputation into v_rep from public.listed_companies l where l.company_id = m.company_id;
  if coalesce(cfg #> '{board,aiVote,kinds}', '[]'::jsonb) ? m.kind
     and coalesce(v_rep, 50) < public.cfg_num(cfg, '{board,aiVote,reputationBelow}', 40) then
    v_ai := v_float;
  end if;
  if not (coalesce(p_final, false) or (v_yes + v_ai) * 2 > v_total or v_no * 2 >= v_total) then
    update public.board_motions set yes_e6 = v_yes, no_e6 = v_no, ai_e6 = v_ai, total_e6 = v_total where id = m.id;
    return 'open';
  end if;
  v_status := case when (v_yes + v_ai + v_no)::numeric * 10000 < v_total::numeric * public.cfg_num(cfg, '{board,quorumBps}', 3000) then 'no_quorum'
                   when v_yes + v_ai > v_no then 'passed' else 'rejected' end;
  update public.board_motions
     set status = v_status, closed_at = now(), yes_e6 = v_yes, no_e6 = v_no, ai_e6 = v_ai, total_e6 = v_total
   where id = m.id;
  select pc.founder_id, c.name into v_owner, v_name
    from public.player_companies pc join public.companies c on c.id = pc.company_id where pc.company_id = m.company_id;
  if v_status = 'passed' then
    v_result := public.board_execute(m.id);
    update public.board_motions set result = v_result where id = m.id;
    -- a decision without the founder's yes is a revolt
    if m.proposer_id is distinct from v_owner
       and not exists (select 1 from public.board_votes v where v.motion_id = m.id and v.player_id = v_owner and v.yes) then
      perform public.feed_post(coalesce(m.proposer_id, v_owner), 'board_revolt',
                               jsonb_build_object('company', v_name, 'kind', m.kind), 'board_revolt:' || m.id::text);
    end if;
  end if;
  for r in select h.player_id from public.board_holdings(m.company_id) h
           union select v_owner loop
    perform public.social_notify(r.player_id, 'board',
      'Geschäftsrat ' || v_name || ': ' || case v_status when 'passed' then 'Antrag angenommen'
                                                when 'rejected' then 'Antrag abgelehnt' else 'Antrag ohne Mehrheit' end,
      public.board_motion_label(m.kind, m.params),
      jsonb_build_object('company_id', m.company_id, 'motion_id', m.id, 'status', v_status),
      '/company?board=' || m.company_id::text, 'board-result:' || m.id::text);
  end loop;
  perform public.company_system_message(m.company_id, 'Geschäftsrat: ' || public.board_motion_label(m.kind, m.params) || ' – '
    || case v_status when 'passed' then 'angenommen.' when 'rejected' then 'abgelehnt.' else 'nicht beschlussfähig.' end);
  return v_status;
end;
$$;

-- Short German description of a motion (notifications, company chat)
create or replace function public.board_motion_label(p_kind text, p_params jsonb)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'earmark' then public.format_eur((p_params ->> 'amount_cents')::bigint) || ' reservieren für '
                        || case p_params ->> 'purpose' when 'research' then 'Forschung' when 'products' then 'Produkte'
                                                       when 'expansion' then 'Ausbau' when 'benefits' then 'Benefits'
                                                       else 'Marketing' end
    when 'release' then 'Budget freigeben: '
                        || case p_params ->> 'purpose' when 'research' then 'Forschung' when 'products' then 'Produkte'
                                                       when 'expansion' then 'Ausbau' when 'benefits' then 'Benefits'
                                                       else 'Marketing' end
    when 'dividend' then 'Dividende von ' || public.format_eur((p_params ->> 'amount_cents')::bigint)
    when 'payout_cap' then 'CEO-Auszahlung höchstens ' || ((p_params ->> 'bps')::integer / 100) || ' % für '
                           || (p_params ->> 'days') || ' Tage'
    when 'withdraw_ban' then 'Keine Entnahmen für ' || (p_params ->> 'days') || ' Tage'
    when 'price_level' then 'Preisstrategie ' || case p_params ->> 'price_level' when 'budget' then 'günstig'
                                                   when 'premium' then 'Premium' else 'normal' end
                            || ' für ' || (p_params ->> 'days') || ' Tage'
    when 'debt' then 'Schulden tilgen bis ' || public.format_eur((p_params ->> 'amount_cents')::bigint)
    else p_kind end;
$$;

create or replace function public.board_close_due(p_company uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n integer := 0;
begin
  for r in select m.id, m.closes_at <= now() as due from public.board_motions m
            where m.company_id = p_company and m.status = 'open' order by m.id loop
    if public.board_tally(r.id, r.due) <> 'open' then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

create or replace function public.board_motion_json(m public.board_motions, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'params', m.params, 'status', m.status, 'label', public.board_motion_label(m.kind, m.params),
    'proposer', (select p.nickname from public.profiles p where p.id = m.proposer_id),
    'mine', m.proposer_id is not distinct from p_viewer,
    'created_at', m.created_at, 'closes_at', m.closes_at, 'closed_at', m.closed_at,
    'yes_e6', m.yes_e6, 'no_e6', m.no_e6, 'ai_e6', m.ai_e6, 'total_e6', m.total_e6,
    'my_vote', (select case when v.yes then 'yes' else 'no' end from public.board_votes v
                 where v.motion_id = m.id and v.player_id = p_viewer),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'yes', v.yes) order by v.voted_at)
                         from public.board_votes v join public.profiles p on p.id = v.player_id where v.motion_id = m.id), '[]'::jsonb),
    'result', m.result);
$$;

create or replace function public.board_state(p_company uuid, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.listed_cfg();
  c       public.companies;
  pc      public.player_companies;
  l       public.listed_companies;
  v_total bigint := public.board_total_e6(p_company);
  v_mine  bigint := public.board_my_e6(p_company, p_viewer);
  v_held  bigint;
begin
  select * into c from public.companies where id = p_company;
  select * into pc from public.player_companies where company_id = p_company;
  select * into l from public.listed_companies where company_id = p_company;
  select coalesce(sum(h.qty_e6), 0) into v_held from public.board_holdings(p_company) h;
  return jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'ticker', c.ticker, 'color', c.brand_color),
    'is_founder', pc.founder_id = p_viewer,
    'total_e6', v_total,
    'my_e6', v_mine,
    'my_share_bps', (v_mine::numeric * 10000 / v_total)::integer,
    'float_e6', greatest(0, v_total - v_held),
    'min_share_bps', public.cfg_num(cfg, '{board,minShareBps}', 2000)::integer,
    'can_convene', v_mine::numeric * 10000 > v_total::numeric * public.cfg_num(cfg, '{board,minShareBps}', 2000)
                   and (select count(*) from public.board_motions m where m.company_id = p_company and m.status = 'open')
                       < public.cfg_num(cfg, '{board,maxOpen}', 2)
                   and not exists (select 1 from public.board_motions m
                                    where m.company_id = p_company and m.proposer_id = p_viewer
                                      and m.created_at > now() - make_interval(secs => public.cfg_num(cfg, '{board,cooldownHours}', 6) * 3600)),
    'can_vote', v_mine > 0,
    'reputation', round(coalesce(l.reputation, 50)::numeric, 1),
    'ai_votes', coalesce(l.reputation, 50) < public.cfg_num(cfg, '{board,aiVote,reputationBelow}', 40),
    'cash_cents', (select a.balance_cents from public.ledger_accounts a where a.owner_company_id = p_company and a.kind = 'company_cash'),
    'free_cash_cents', public.listed_free_cash(p_company),
    'holders', coalesce((select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'share_bps', (h.qty_e6::numeric * 10000 / v_total)::integer,
                                                             'is_founder', h.player_id = pc.founder_id, 'me', h.player_id = p_viewer)
                                          order by h.qty_e6 desc)
                           from public.board_holdings(p_company) h join public.profiles p on p.id = h.player_id), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(jsonb_build_object('purpose', b.purpose, 'amount_cents', b.amount_cents) order by b.purpose)
                           from public.company_budgets b where b.company_id = p_company and b.amount_cents > 0), '[]'::jsonb),
    'restrictions', jsonb_build_object(
      'payout_cap_bps', case when l.payout_cap_until > now() then l.payout_cap_bps end,
      'payout_cap_until', case when l.payout_cap_until > now() then l.payout_cap_until end,
      'withdraw_block_until', case when l.withdraw_block_until > now() then l.withdraw_block_until end,
      'price_lock', case when l.price_lock_until > now() then l.price_lock end,
      'price_lock_until', case when l.price_lock_until > now() then l.price_lock_until end),
    'founder_payout_bps', pc.founder_payout_bps,
    'motions', coalesce((select jsonb_agg(public.board_motion_json(m, p_viewer) order by m.id desc)
                           from public.board_motions m where m.company_id = p_company and m.status = 'open'), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(public.board_motion_json(x, p_viewer) order by x.id desc)
                           from (select * from public.board_motions m where m.company_id = p_company and m.status <> 'open'
                                  order by m.id desc limit greatest(1, public.cfg_num(cfg, '{board,historyLimit}', 20)::integer)) x),
                        '[]'::jsonb));
end;
$$;

-- The company whose board the caller may see: a listed company where the caller is the founder or holds shares
create or replace function public.board_require(p_company uuid, p_player uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := coalesce(p_company, (select pc.company_id from public.player_companies pc
                                          where pc.founder_id = p_player and pc.status = 'active'));
begin
  if v_company is null then
    perform public.api_error('company_not_found');
  end if;
  if not public.listed_is(v_company) then
    perform public.api_error('not_listed');
  end if;
  if public.board_my_e6(v_company, p_player) <= 0
     and not exists (select 1 from public.player_companies pc where pc.company_id = v_company and pc.founder_id = p_player) then
    perform public.api_error('board_not_shareholder');
  end if;
  perform public.listed_ensure(v_company);
  return v_company;
end;
$$;

create or replace function public.get_company_board(p_company_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_company uuid := public.board_require(p_company_id, v_player);
begin
  perform public.board_close_due(v_company);
  return jsonb_build_object('board', public.board_state(v_company, v_player));
end;
$$;
comment on function public.get_company_board(uuid) is
  'RPC (founder or shareholder of a listed company; null = own company): the board with holders, budgets, '
  'restrictions, open motions and their history (ADR-167). Errors company_not_found, not_listed, board_not_shareholder.';

create or replace function public.board_propose(p_request_id uuid, p_company_id uuid, p_kind text, p_params jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.listed_cfg();
  v_player  uuid := public.require_player();
  v_company uuid;
  v_replay  jsonb;
  v_params  jsonb := '{}'::jsonb;
  v_days    integer;
  v_amount  bigint;
  v_bps     integer;
  v_id      bigint;
  v_name    text;
  r         record;
begin
  v_company := public.board_require(p_company_id, v_player);
  if p_request_id is null or p_kind is null or not coalesce(cfg #> '{board,kinds}', '[]'::jsonb) ? p_kind then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'board_propose');
  if v_replay is not null then
    return v_replay;
  end if;
  perform 1 from public.listed_companies l where l.company_id = v_company for update;
  perform public.board_close_due(v_company);
  -- more than board.minShareBps of all shares
  if not (public.board_my_e6(v_company, v_player)::numeric * 10000
          > public.board_total_e6(v_company)::numeric * public.cfg_num(cfg, '{board,minShareBps}', 2000)) then
    perform public.api_error('board_no_right');
  end if;
  if (select count(*) from public.board_motions m where m.company_id = v_company and m.status = 'open')
       >= public.cfg_num(cfg, '{board,maxOpen}', 2)
     or exists (select 1 from public.board_motions m
                 where m.company_id = v_company and m.proposer_id = v_player
                   and m.created_at > now() - make_interval(secs => public.cfg_num(cfg, '{board,cooldownHours}', 6) * 3600)) then
    perform public.api_error('board_limit');
  end if;

  v_days := (p_params ->> 'days')::integer;
  v_amount := (p_params ->> 'amount_cents')::bigint;
  if p_kind in ('payout_cap', 'withdraw_ban', 'price_level')
     and (v_days is null or v_days < 1 or v_days > public.cfg_num(cfg, '{board,maxDays}', 7)) then
    perform public.api_error('invalid_argument');
  end if;
  if p_kind in ('earmark', 'dividend', 'debt') and (v_amount is null or v_amount < 1) then
    perform public.api_error('invalid_argument');
  end if;
  if p_kind in ('earmark', 'release') and not coalesce(cfg #> '{board,purposes}', '[]'::jsonb) ? coalesce(p_params ->> 'purpose', '') then
    perform public.api_error('invalid_argument');
  end if;
  if p_kind = 'earmark' then
    if v_amount > (select greatest(0, a.balance_cents) from public.ledger_accounts a
                    where a.owner_company_id = v_company and a.kind = 'company_cash')
                  * public.cfg_num(cfg, '{board,earmarkMaxShareOfCashBps}', 8000)::bigint / 10000 then
      perform public.api_error('insufficient_funds');
    end if;
    v_params := jsonb_build_object('purpose', p_params ->> 'purpose', 'amount_cents', v_amount);
  elsif p_kind = 'release' then
    v_params := jsonb_build_object('purpose', p_params ->> 'purpose');
  elsif p_kind = 'dividend' then
    if v_amount < public.cfg_num(cfg, '{dividends,minTotalCents}', 10000) then
      perform public.api_error('invalid_argument');
    end if;
    v_params := jsonb_build_object('amount_cents', v_amount);
  elsif p_kind = 'payout_cap' then
    v_bps := (p_params ->> 'bps')::integer;
    if v_bps is null or v_bps < 0 or v_bps > 10000
       or v_bps % greatest(1, public.cfg_num(cfg, '{board,payoutCapStepBps}', 500)::integer) <> 0 then
      perform public.api_error('invalid_argument');
    end if;
    v_params := jsonb_build_object('bps', v_bps, 'days', v_days);
  elsif p_kind = 'withdraw_ban' then
    v_params := jsonb_build_object('days', v_days);
  elsif p_kind = 'price_level' then
    if coalesce(p_params ->> 'price_level', '') not in ('budget', 'normal', 'premium') then
      perform public.api_error('invalid_argument');
    end if;
    v_params := jsonb_build_object('price_level', p_params ->> 'price_level', 'days', v_days);
  else
    v_params := jsonb_build_object('amount_cents', v_amount);
  end if;

  insert into public.board_motions (company_id, proposer_id, kind, params, closes_at)
  values (v_company, v_player, p_kind, v_params, now() + make_interval(secs => public.cfg_num(cfg, '{board,voteHours}', 12) * 3600))
  returning id into v_id;
  insert into public.board_votes (motion_id, player_id, yes) values (v_id, v_player, true);
  select c.name into v_name from public.companies c where c.id = v_company;
  for r in select h.player_id from public.board_holdings(v_company) h
           union select pc.founder_id from public.player_companies pc where pc.company_id = v_company loop
    continue when r.player_id = v_player;
    perform public.social_notify(r.player_id, 'board', 'Geschäftsrat ' || v_name || ': neuer Antrag',
      public.board_motion_label(p_kind, v_params) || '. Stimme mit deinen Aktien ab.',
      jsonb_build_object('company_id', v_company, 'motion_id', v_id), '/company?board=' || v_company::text,
      'board-new:' || v_id::text);
  end loop;
  perform public.mission_event(v_player, 'board_motion', 1, v_id::text);
  perform public.board_tally(v_id, false);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('board', public.board_state(v_company, v_player)));
end;
$$;
comment on function public.board_propose(uuid, uuid, text, jsonb) is
  'RPC (shareholder with more than board.minShareBps of a listed company, the founder included): convenes the board '
  'with a motion (ADR-167). kind: earmark {purpose, amount_cents} | release {purpose} | dividend {amount_cents} | '
  'payout_cap {bps, days} | withdraw_ban {days} | price_level {price_level, days} | debt {amount_cents}. Errors '
  'not_listed, board_not_shareholder, board_no_right, board_limit, invalid_argument, insufficient_funds.';

create or replace function public.board_vote(p_request_id uuid, p_motion_id bigint, p_yes boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_replay  jsonb;
  m         public.board_motions;
begin
  if p_request_id is null or p_motion_id is null or p_yes is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'board_vote');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into m from public.board_motions where id = p_motion_id for update;
  if m.id is null or not public.listed_is(m.company_id) then
    perform public.api_error('board_motion_unknown');
  end if;
  if public.board_my_e6(m.company_id, v_player) <= 0 then
    perform public.api_error('board_not_shareholder');
  end if;
  if m.status <> 'open' or m.closes_at <= now() then
    perform public.board_close_due(m.company_id);
    perform public.api_error('board_motion_unknown');
  end if;
  insert into public.board_votes (motion_id, player_id, yes) values (m.id, v_player, p_yes)
  on conflict (motion_id, player_id) do update set yes = excluded.yes, voted_at = now();
  perform public.mission_event(v_player, 'board_vote', 1, m.id::text);
  perform public.board_tally(m.id, false);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('board', public.board_state(m.company_id, v_player)));
end;
$$;
comment on function public.board_vote(uuid, bigint, boolean) is
  'RPC (shareholder): votes yes or no on an open motion; the weight is the holding when it is counted, a vote can be '
  'changed until then (ADR-167). Errors board_motion_unknown, board_not_shareholder.';

-- ---------------------------------------------------------------------------
-- E. The state of a listed company (founder)
-- ---------------------------------------------------------------------------
create or replace function public.listed_state(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.listed_cfg();
  c        public.companies;
  pc       public.player_companies;
  l        public.listed_companies;
  h        public.listed_company_hours;
  v_fx     jsonb := public.listed_effects(p_company);
  v_ref    bigint := public.listed_ref_revenue(p_company);
  v_heads  integer := public.company_headcount(p_company);
  v_cash   bigint;
  v_free   bigint := public.listed_free_cash(p_company);
  v_sat    jsonb;
  v_today  date := (now() at time zone 'Europe/Berlin')::date;
  v_green  double precision;
  v_red    double precision;
  v_total  bigint := public.board_total_e6(p_company);
  v_mine   bigint;
begin
  select * into c from public.companies where id = p_company;
  select * into pc from public.player_companies where company_id = p_company;
  select * into l from public.listed_companies where company_id = p_company;
  if l.company_id is null then
    return null;
  end if;
  select * into h from public.listed_company_hours x where x.company_id = p_company order by x.hour_start desc limit 1;
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_company_id = p_company and a.kind = 'company_cash';
  v_sat := public.listed_satisfaction_effect(l.satisfaction);
  v_green := public.cfg_num(cfg, '{satisfaction,green}', 60);
  v_red := public.cfg_num(cfg, '{satisfaction,red}', 35);
  v_mine := public.board_my_e6(p_company, pc.founder_id);
  return jsonb_build_object(
    'company_id', p_company, 'name', c.name, 'ticker', c.ticker,
    'cash_cents', v_cash, 'unpaid_cents', pc.unpaid_cents, 'reserved_cents', public.listed_reserved_cents(p_company),
    'free_cash_cents', v_free, 'ref_revenue_cents', v_ref, 'headcount', v_heads,
    'founder_payout_bps', pc.founder_payout_bps,
    'reputation', jsonb_build_object(
      'value', round(l.reputation::numeric, 2), 'target', round(coalesce(h.rep_target, l.reputation)::numeric, 2),
      'demand_factor', round((1 + public.cfg_num(cfg, '{reputation,demandMaxEffect}', 0.2) * (l.reputation - 50) / 50.0)::numeric, 4),
      'price_factor', round(l.price_factor::numeric, 4),
      'payout_ratio_bps', coalesce((h.drivers ->> 'payout_ratio_bps')::integer, 0),
      'drivers', coalesce(h.drivers -> 'reputation', '{}'::jsonb)),
    'satisfaction', jsonb_build_object(
      'value', round(l.satisfaction::numeric, 2), 'target', round(coalesce(h.sat_target, l.satisfaction)::numeric, 2),
      'zone', case when l.satisfaction >= v_green then 'green' when l.satisfaction >= v_red then 'yellow' else 'red' end,
      'green', v_green, 'red', v_red,
      'capacity_factor', round((v_sat ->> 'capacity_factor')::numeric, 4),
      'quality_add_bps', round((v_sat ->> 'quality_add')::numeric * 10000)::integer,
      'red_hours', l.red_hours,
      'drivers', coalesce(h.drivers -> 'satisfaction', '{}'::jsonb)),
    'effects', v_fx,
    'hour', public.listed_hour_effect_calc(v_fx, l.satisfaction, l.reputation),
    'upkeep', l.last_upkeep,
    'upkeep_per_hour_cents', coalesce((
      select sum(public.listed_item_upkeep(public.listed_item(ci.key), ci.level, v_ref, v_heads))
        from public.company_investments ci
       where ci.company_id = p_company and ci.status = 'active' and ci.level > 0 and ci.kind <> 'action'), 0)::bigint
      + case when l.advisor then public.listed_advisor_wage(v_ref) else 0 end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', t.x ->> 'key', 'kind', t.x ->> 'kind',
               'status', case when ci.key is null or ci.status = 'retired' or (t.x ->> 'kind' = 'action') then 'none'
                              when ci.ready_at is not null and ci.level = 0 then 'running' else ci.status end,
               'level', coalesce(case when ci.status <> 'retired' then ci.level end, 0),
               'max_level', public.cfg_num(t.x, '{maxLevel}', 1)::integer,
               'ready_at', case when ci.status <> 'retired' then ci.ready_at end,
               'cooldown_until', case when t.x ->> 'kind' = 'action' and ci.last_used_at is not null
                                           and ci.last_used_at + make_interval(secs => public.cfg_num(t.x, '{cooldownHours}', 0) * 3600) > now()
                                      then ci.last_used_at + make_interval(secs => public.cfg_num(t.x, '{cooldownHours}', 0) * 3600) end,
               'cost_cents', public.listed_item_cost(t.x, case when t.x ->> 'kind' = 'action' or ci.key is null or ci.status = 'retired' then 0 else ci.level end, v_ref, v_heads),
               'upkeep_cents', public.listed_item_upkeep(t.x, greatest(1, coalesce(case when ci.status <> 'retired' then ci.level end, 1)), v_ref, v_heads),
               'missing', coalesce((select jsonb_agg(q.k) from jsonb_array_elements_text(coalesce(t.x -> 'requires', '[]'::jsonb)) q(k)
                                     where not exists (select 1 from public.company_investments r
                                                        where r.company_id = p_company and r.key = q.k
                                                          and r.status in ('active', 'paused') and r.level > 0)), '[]'::jsonb))
             order by t.ord)
        from jsonb_array_elements(coalesce(cfg -> 'items', '[]'::jsonb)) with ordinality t(x, ord)
        left join public.company_investments ci on ci.company_id = p_company and ci.key = t.x ->> 'key'), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(jsonb_build_object('purpose', b.purpose, 'amount_cents', b.amount_cents) order by b.purpose)
                           from public.company_budgets b where b.company_id = p_company and b.amount_cents > 0), '[]'::jsonb),
    'restrictions', jsonb_build_object(
      'payout_cap_bps', case when l.payout_cap_until > now() then l.payout_cap_bps end,
      'payout_cap_until', case when l.payout_cap_until > now() then l.payout_cap_until end,
      'withdraw_block_until', case when l.withdraw_block_until > now() then l.withdraw_block_until end,
      'price_lock', case when l.price_lock_until > now() then l.price_lock end,
      'price_lock_until', case when l.price_lock_until > now() then l.price_lock_until end),
    'dividends', jsonb_build_object(
      'max_cents', greatest(0, v_free) * public.cfg_num(cfg, '{dividends,maxShareOfFreeCashBps}', 5000)::bigint / 10000,
      'min_cents', public.cfg_num(cfg, '{dividends,minTotalCents}', 10000)::bigint,
      'can_declare', (select count(*) from public.company_dividends d
                       where d.company_id = p_company and d.source = 'founder'
                         and (d.paid_at at time zone 'Europe/Berlin')::date = v_today) < public.cfg_num(cfg, '{dividends,perDay}', 1),
      'streak', case when l.dividend_day >= v_today - 1 then l.dividend_streak else 0 end,
      'total_e6', v_total,
      'founder_share_bps', (v_mine::numeric * 10000 / v_total)::integer,
      'last', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'source', d.source, 'total_cents', d.total_cents,
                                                            'players_cents', d.players_cents, 'float_cents', d.float_cents,
                                                            'holders', d.holders, 'paid_at', d.paid_at) order by d.id desc)
                          from (select * from public.company_dividends x where x.company_id = p_company order by x.id desc
                                 limit greatest(1, public.cfg_num(cfg, '{dividends,historyLimit}', 20)::integer)) d), '[]'::jsonb)),
    'books', public.listed_books_preview(p_company),
    'taxes', jsonb_build_object(
      'due_cents', public.listed_tax_due_cents(p_company),
      'rate_bps', public.listed_tax_rate_bps(p_company),
      'loss_carry_cents', l.loss_carry_cents,
      'advisor', l.advisor,
      'advisor_wage_cents', public.listed_advisor_wage(v_ref),
      'advisor_discount_bps', public.cfg_num(cfg, '{taxes,advisor,discountBps}', 800)::integer,
      'periods', coalesce((select jsonb_agg(public.listed_tax_period_json(x) order by x.id desc)
                             from (select * from public.company_tax_periods p where p.company_id = p_company order by p.id desc
                                    limit greatest(1, public.cfg_num(cfg, '{taxes,historyLimit}', 30)::integer)) x), '[]'::jsonb)),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', x.hour_start, 'satisfaction', round(x.satisfaction::numeric, 2),
                                                             'reputation', round(x.reputation::numeric, 2),
                                                             'demand_factor', round(x.demand_factor::numeric, 4),
                                                             'capacity_factor', round(x.capacity_factor::numeric, 4),
                                                             'upkeep_cents', x.upkeep_cents) order by x.hour_start)
                           from (select * from public.listed_company_hours y where y.company_id = p_company
                                  order by y.hour_start desc limit greatest(1, public.cfg_num(cfg, '{historyHours}', 72)::integer)) x),
                        '[]'::jsonb),
    'board', jsonb_build_object(
      'open_motions', (select count(*) from public.board_motions m where m.company_id = p_company and m.status = 'open'),
      'to_vote', (select count(*) from public.board_motions m
                   where m.company_id = p_company and m.status = 'open'
                     and not exists (select 1 from public.board_votes v where v.motion_id = m.id and v.player_id = pc.founder_id)),
      'my_share_bps', (v_mine::numeric * 10000 / v_total)::integer,
      'can_convene', v_mine::numeric * 10000 > v_total::numeric * public.cfg_num(cfg, '{board,minShareBps}', 2000)));
end;
$$;

create or replace function public.get_listed_company()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.require_own_company();
begin
  if not public.listed_is(v_company) then
    return jsonb_build_object('listed', null);
  end if;
  perform public.listed_ensure(v_company);
  perform public.listed_finish_due(v_company, now());
  perform public.board_close_due(v_company);
  return jsonb_build_object('listed', public.listed_state(v_company));
end;
$$;
comment on function public.get_listed_company() is
  'RPC (founder): everything a listed company adds (ADR-167): reputation, satisfaction, items with prices, budgets, '
  'dividends, books, taxes, history. {listed: null} while the company is private. Error company_not_found.';

-- Before a listed company is dissolved: taxes are paid from the cash as far as it goes, motions end, budgets go
create or replace function public.listed_before_dissolve(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.listed_companies l where l.company_id = p_company) then
    return;
  end if;
  perform public.listed_tax_collect(p_company, null, true);
  update public.company_tax_periods set status = 'paid', paid_at = now() where company_id = p_company and status = 'due';
  update public.board_motions set status = 'cancelled', closed_at = now() where company_id = p_company and status = 'open';
  delete from public.company_budgets where company_id = p_company;
  update public.listed_companies
     set advisor = false, payout_cap_until = null, withdraw_block_until = null, price_lock_until = null
   where company_id = p_company;
end;
$$;

-- Missions: a tax audit that was solved
create or replace function public.listed_audit_mission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archetype = 'tax_audit' and new.status = 'solved' and old.status is distinct from new.status then
    perform public.mission_event((select pc.founder_id from public.player_companies pc where pc.company_id = new.company_id),
                                 'audit_survived', 1, new.id::text);
  end if;
  return new;
end;
$$;
drop trigger if exists listed_audit_mission on public.player_company_events;
create trigger listed_audit_mission after update of status on public.player_company_events
  for each row execute function public.listed_audit_mission();

-- ---------------------------------------------------------------------------
-- F. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.listed_finish_due(uuid, timestamptz)', 'public.listed_require()', 'public.company_invest(uuid, text)',
    'public.company_invest_stop(uuid, text)', 'public.board_holdings(uuid)', 'public.board_total_e6(uuid)',
    'public.board_my_e6(uuid, uuid)', 'public.listed_pay_dividend(uuid, bigint, text, uuid)',
    'public.company_declare_dividend(uuid, bigint)', 'public.listed_ledger_category(text, text, jsonb)',
    'public.listed_is_operating(text)', 'public.listed_period_sums(uuid, timestamptz, timestamptz)',
    'public.listed_books_receipts(uuid, timestamptz)', 'public.listed_tax_rate_bps(uuid)', 'public.listed_books_preview(uuid)',
    'public.listed_books_do(uuid, text, integer)', 'public.listed_tax_collect(uuid, bigint, boolean)',
    'public.listed_tax_due_cents(uuid)', 'public.company_books_close(uuid, text[], boolean)',
    'public.listed_tax_period_json(public.company_tax_periods)', 'public.company_tax_pay(uuid)',
    'public.company_tax_advisor(uuid, boolean)', 'public.listed_audit(uuid, integer)', 'public.listed_tax_office(uuid)',
    'public.get_company_accounting(integer, bigint)', 'public.board_execute(bigint)', 'public.board_tally(bigint, boolean)',
    'public.board_motion_label(text, jsonb)', 'public.board_close_due(uuid)',
    'public.board_motion_json(public.board_motions, uuid)', 'public.board_state(uuid, uuid)',
    'public.board_require(uuid, uuid)', 'public.get_company_board(uuid)', 'public.board_propose(uuid, uuid, text, jsonb)',
    'public.board_vote(uuid, bigint, boolean)', 'public.listed_state(uuid)', 'public.get_listed_company()',
    'public.listed_before_dissolve(uuid)', 'public.listed_audit_mission()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_listed_company()', 'public.company_invest(uuid, text)', 'public.company_invest_stop(uuid, text)',
    'public.company_declare_dividend(uuid, bigint)', 'public.company_books_close(uuid, text[], boolean)',
    'public.company_tax_pay(uuid)', 'public.company_tax_advisor(uuid, boolean)',
    'public.get_company_accounting(integer, bigint)', 'public.get_company_board(uuid)',
    'public.board_propose(uuid, uuid, text, jsonb)', 'public.board_vote(uuid, bigint, boolean)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
