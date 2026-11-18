-- =============================================================================
-- NEXA · 011000 · Research priced from the earnings, not from the size (ADR-215)
-- =============================================================================
-- The owner: "Die Forschung kostet derzeit mehr mit dem Firmenwert, aber irgendwann ist es unmöglich weiter zu
-- forschen, weil der Unternehmenswert viel stärker steigt als der Gewinn. Es muss irgendwie möglich sein, Forschung zu
-- betreiben, ohne 10 Tage warten zu müssen."
--
-- Before: a research step of a listed company cost max(minCostCents, costHours x average revenue per hour) with
-- 6 / 18 / 48 / 120 hours of revenue. Revenue grows with the size, the margin shrinks (ADR-209 friction, 45 % -> 14 %),
-- so a step at the top cost up to 35 days of profit.
-- After (game_config.listed.research, src/lib/sim/listed.ts researchCostCents):
--   P     = average operating profit per hour (player_company_hours.profit_cents) of the last refProfit.windowHours
--           hours, at least refProfit.minCents
--   price = min(maxProfitHours x P, max(minCostCentsByTier[tier], profitHoursByTier[tier] x P x (1 + growthPerDoneBps
--           x research steps started so far / 10 000)))
--   slow  ("Sparforschung", p_slow = true): floor(price x slow.costBps / 10 000), duration x slow.hoursFactor
-- Neither the company value nor the market cap nor the revenue enter the price.
-- New: listed_avg_profit(uuid), listed_ref_profit(uuid), listed_research_started(uuid),
--      listed_research_cost(jsonb, bigint, integer, boolean).
-- Changed (latest full definitions from 20261204005410_listed_actions.sql): company_invest gets p_slow boolean
-- default false (the old two-argument function is dropped, two-argument calls keep working); listed_state prices
-- research with the new formula and adds ref_profit_cents, avg_profit_cents, research_started and per item
-- slow_cost_cents and slow_hours (research only, null otherwise). Idempotent.

-- ---------------------------------------------------------------------------
-- A. The earnings capacity and the price
-- ---------------------------------------------------------------------------
-- avgProfitCents: raw average operating profit per hour of the window (may be negative; 0 without hours)
create or replace function public.listed_avg_profit(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select round(avg(h.profit_cents))::bigint
                     from (select x.profit_cents from public.player_company_hours x
                            where x.company_id = p_company order by x.hour_start desc
                            limit greatest(1, public.cfg_num(public.listed_cfg(), '{research,refProfit,windowHours}', 48)::integer)) h), 0);
$$;
comment on function public.listed_avg_profit(uuid) is
  'Average operating profit per hour of the last research.refProfit.windowHours closed hours (ADR-215); 0 without hours.';

-- refProfitCents: the average profit, never below the minimum
create or replace function public.listed_ref_profit(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(public.cfg_num(public.listed_cfg(), '{research,refProfit,minCents}', 20000)::bigint,
                  public.listed_avg_profit(p_company));
$$;
comment on function public.listed_ref_profit(uuid) is
  'The earnings capacity research is priced from (ADR-215): listed_avg_profit, at least research.refProfit.minCents.';

-- Research steps the company has started so far (running, active or paused)
create or replace function public.listed_research_started(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.company_investments ci
   where ci.company_id = p_company and ci.kind = 'research'
     and ((ci.status in ('active', 'paused') and ci.level > 0) or ci.status = 'running');
$$;

-- researchCostCents of src/lib/sim/listed.ts
create or replace function public.listed_research_cost(p_item jsonb, p_ref_profit bigint, p_started integer,
                                                       p_slow boolean default false)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.listed_cfg();
  v_n     integer := greatest(1, jsonb_array_length(coalesce(cfg #> '{research,profitHoursByTier}', '[0]'::jsonb)));
  v_i     integer := least(v_n, greatest(1, floor(public.cfg_num(p_item, '{tier}', 1))::integer)) - 1;
  v_p     double precision := greatest(public.cfg_num(cfg, '{research,refProfit,minCents}', 20000), coalesce(p_ref_profit, 0));
  v_hours double precision;
  v_full  bigint;
begin
  v_hours := public.cfg_num(cfg, array['research', 'profitHoursByTier', v_i::text], 0)
             * (1 + (public.cfg_num(cfg, '{research,growthPerDoneBps}', 0) * greatest(0, coalesce(p_started, 0))) / 10000);
  v_full := round(least(public.cfg_num(cfg, '{research,maxProfitHours}', 40) * v_p,
                        greatest(public.cfg_num(cfg, array['research', 'minCostCentsByTier', v_i::text], 0), v_hours * v_p))::numeric)::bigint;
  if coalesce(p_slow, false) then
    return v_full * public.cfg_num(cfg, '{research,slow,costBps}', 5000)::bigint / 10000;
  end if;
  return v_full;
end;
$$;
comment on function public.listed_research_cost(jsonb, bigint, integer, boolean) is
  'Price of a research step from the earnings (ADR-215): profitHoursByTier x reference profit x level growth, at least '
  'the tier floor, at most maxProfitHours of profit; slow = costBps of it. Same numbers as researchCostCents (TS).';

-- ---------------------------------------------------------------------------
-- B. company_invest with the research price and the slow option (latest definition: 20261204005410)
-- ---------------------------------------------------------------------------
drop function if exists public.company_invest(uuid, text);

create or replace function public.company_invest(p_request_id uuid, p_key text, p_slow boolean default false)
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
  v_slow    boolean := coalesce(p_slow, false);
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
  if v_slow and v_kind <> 'research' then
    perform public.api_error('invalid_argument');
  end if;
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
  -- ADR-215: research from the earnings (and the steps started so far), everything else from the revenue
  v_cost := case when v_kind = 'research'
                 then public.listed_research_cost(v_item, public.listed_ref_profit(v_company),
                                                  public.listed_research_started(v_company), v_slow)
                 else public.listed_item_cost(v_item, v_level, public.listed_ref_revenue(v_company),
                                              public.company_headcount(v_company)) end;
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
      jsonb_build_object('cat', public.listed_kind_category(v_kind), 'item', p_key, 'one_off', true)
        || case when v_slow then jsonb_build_object('slow', true) else '{}'::jsonb end);
    update public.company_budgets set amount_cents = amount_cents - least(amount_cents, v_cost), updated_at = now()
     where company_id = v_company and purpose = v_item ->> 'purpose';
  end if;

  v_hours := public.cfg_num(v_item, '{hours}', 0)
             * case when v_slow then public.cfg_num(public.listed_cfg(), '{research,slow,hoursFactor}', 3) else 1 end;
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
comment on function public.company_invest(uuid, text, boolean) is
  'RPC (founder, listed company): buys or starts an item of game_config.listed.items (ADR-167); research is priced from '
  'the earnings, p_slow = Sparforschung (cheaper, longer; research only) (ADR-215); errors not_listed, item_unknown, '
  'item_locked, item_running, budget_reserved, insufficient_funds, invalid_argument.';

-- ---------------------------------------------------------------------------
-- C. listed_state with the research price, the earnings and the slow option (latest definition: 20261204005410)
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
  v_profit bigint := public.listed_ref_profit(p_company);
  v_avg    bigint := public.listed_avg_profit(p_company);
  v_rs     integer := public.listed_research_started(p_company);
  v_slowh  double precision := public.cfg_num(public.listed_cfg(), '{research,slow,hoursFactor}', 3);
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
    'ref_profit_cents', v_profit, 'avg_profit_cents', v_avg, 'research_started', v_rs,
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
               'cost_cents', case when t.x ->> 'kind' = 'research' then public.listed_research_cost(t.x, v_profit, v_rs, false)
                                  else public.listed_item_cost(t.x, case when t.x ->> 'kind' = 'action' or ci.key is null or ci.status = 'retired' then 0 else ci.level end, v_ref, v_heads) end,
               'slow_cost_cents', case when t.x ->> 'kind' = 'research' then public.listed_research_cost(t.x, v_profit, v_rs, true) end,
               'slow_hours', case when t.x ->> 'kind' = 'research' then public.cfg_num(t.x, '{hours}', 0) * v_slowh end,
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

-- ---------------------------------------------------------------------------
-- D. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.listed_avg_profit(uuid)', 'public.listed_ref_profit(uuid)', 'public.listed_research_started(uuid)',
    'public.listed_research_cost(jsonb, bigint, integer, boolean)', 'public.company_invest(uuid, text, boolean)',
    'public.listed_state(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'grant execute on function public.company_invest(uuid, text, boolean) to authenticated';
end;
$$;
