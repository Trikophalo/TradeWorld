-- =============================================================================
-- Fixed and variable costs of the last closed hour (ADR-208, Nachtrag)
-- =============================================================================
-- The dashboard shows two tiles "Fixkosten" and "Variable Kosten" per hour; tapping one opens where the money went.
-- get_company_hour_costs() reads the last row of player_company_hours of the own company and the ledger bookings of
-- that hour (exact idempotency keys of player_company_close_hour, listed_hour_costs and world_hour_costs), so the parts
-- add up to what the hour really paid. Nothing is written; no schema change.
--   fixed:    wages_players, wages_ai, talents (current hourly cost of the hired talents), rent (base fixed costs with
--             the country factor), marketing, upkeep (research, products, expansion, benefits of listed companies),
--             advisor, subsidiaries, insurance, overhead (ADR-209: both are a share of the own revenue and part of
--             cogs_cents; split out with macro_friction at today's company value)
--   variable: goods (cogs_cents minus insurance and overhead), profit_share (ADR-206, job_rewards of the hour),
--             location_fee (Standortgebühr, ADR-208), supply_fees (supply contracts, ADR-098)
-- New RPC (founder): get_company_hour_costs(). Idempotent.

create or replace function public.company_hour_costs_json(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h        public.player_company_hours;
  pc       public.player_companies;
  v_acc    uuid;
  k        text;
  v_lx     jsonb := '{}'::jsonb;
  v_subs   bigint := 0;
  v_fee    bigint := 0;
  v_upkeep bigint := 0;
  v_adv    bigint := 0;
  v_rent   bigint;
  v_tal    bigint;
  v_share  bigint;
  v_own    bigint;
  v_total  double precision;
  v_prem   double precision;
  v_ins    bigint;
  v_over   bigint;
  v_goods  bigint;
  v_fixed  jsonb;
  v_var    jsonb;
  r        record;
begin
  select * into pc from public.player_companies where company_id = p_company;
  select * into h from public.player_company_hours x where x.company_id = p_company order by x.hour_start desc limit 1;
  if h.company_id is null then
    return jsonb_build_object('company_id', p_company, 'hour_start', null, 'revenue_cents', 0, 'fixed_cents', 0,
                              'variable_cents', 0, 'fixed', '[]'::jsonb, 'variable', '[]'::jsonb);
  end if;
  v_acc := public.company_cash_account(p_company);
  k := 'pch:' || p_company::text || ':' || to_char(h.hour_start at time zone 'UTC', 'YYYYMMDDHH24');
  -- what left the cash under the hour's exact keys
  for r in select t.idempotency_key as key, coalesce(sum(-e.amount_cents), 0)::bigint as cents
             from public.ledger_transactions t
             join public.ledger_entries e on e.transaction_id = t.id and e.account_id = v_acc
            where t.idempotency_key = any (array[k || ':lx:research', k || ':lx:product', k || ':lx:expansion',
                                                 k || ':lx:benefit', k || ':lx:advisor', k || ':world:subs',
                                                 k || ':world:fee'])
            group by t.idempotency_key loop
    if r.key = k || ':lx:advisor' then
      v_adv := greatest(0, r.cents);
    elsif r.key = k || ':world:subs' then
      v_subs := greatest(0, r.cents);
    elsif r.key = k || ':world:fee' then
      v_fee := greatest(0, r.cents);
    else
      v_upkeep := v_upkeep + greatest(0, r.cents);
    end if;
  end loop;
  -- fixed_cents holds the base fixed costs plus the listed and world costs of the hour
  v_rent := greatest(0, h.fixed_cents - v_upkeep - v_adv - v_subs - v_fee);
  select coalesce(sum(public.talent_offer_cost(t.wage_cents, t.benefits)), 0)::bigint into v_tal
    from public.talents t where t.company_id = p_company;
  select coalesce(sum(j.amount_cents), 0)::bigint into v_share
    from public.job_rewards j
   where j.company_id = p_company and j.kind = 'profit_share'
     and j.source_key like 'profit:%:' || floor(extract(epoch from h.hour_start))::bigint::text;
  -- ADR-209: overhead and the insurance premium move with the own revenue inside cogs_cents
  v_own := greatest(0, h.revenue_cents - coalesce(h.contract_revenue_cents, 0) - coalesce(h.strength_bonus_cents, 0));
  v_total := coalesce((public.macro_friction(public.company_worth_cents(p_company), pc.insurance_level)
                       ->> 'extra_cost_share')::double precision, 0);
  v_prem := public.cfg_num(public.macro_cfg(),
                           array['insurance', 'levels', greatest(0, coalesce(pc.insurance_level, 0))::text, 'premiumBps'], 0)
            / 10000.0;
  v_ins := floor(v_own * least(v_prem, v_total))::bigint;
  v_over := floor(v_own * greatest(0, v_total - v_prem))::bigint;
  if v_ins + v_over > h.cogs_cents then
    v_ins := case when v_ins + v_over > 0 then h.cogs_cents * v_ins / (v_ins + v_over) else 0 end;
    v_over := h.cogs_cents - v_ins;
  end if;
  v_goods := greatest(0, h.cogs_cents - v_ins - v_over);
  v_fixed := jsonb_build_array(
    jsonb_build_object('key', 'wages_players', 'cents', coalesce(h.player_wages_paid_cents, 0)),
    jsonb_build_object('key', 'wages_ai', 'cents', coalesce(h.ai_wages_paid_cents, 0)),
    jsonb_build_object('key', 'talents', 'cents', v_tal),
    jsonb_build_object('key', 'rent', 'cents', v_rent),
    jsonb_build_object('key', 'marketing', 'cents', coalesce(h.marketing_cents, 0)),
    jsonb_build_object('key', 'upkeep', 'cents', v_upkeep),
    jsonb_build_object('key', 'advisor', 'cents', v_adv),
    jsonb_build_object('key', 'subsidiaries', 'cents', v_subs),
    jsonb_build_object('key', 'insurance', 'cents', v_ins),
    jsonb_build_object('key', 'overhead', 'cents', v_over));
  v_var := jsonb_build_array(
    jsonb_build_object('key', 'goods', 'cents', v_goods),
    jsonb_build_object('key', 'profit_share', 'cents', v_share),
    jsonb_build_object('key', 'location_fee', 'cents', v_fee),
    jsonb_build_object('key', 'supply_fees', 'cents', coalesce(h.supply_fee_paid_cents, 0)));
  return jsonb_build_object(
    'company_id', p_company,
    'hour_start', h.hour_start,
    'revenue_cents', h.revenue_cents,
    'fixed_cents', (select coalesce(sum((x ->> 'cents')::bigint), 0) from jsonb_array_elements(v_fixed) x),
    'variable_cents', (select coalesce(sum((x ->> 'cents')::bigint), 0) from jsonb_array_elements(v_var) x),
    'fixed', v_fixed,
    'variable', v_var);
end;
$$;
revoke all on function public.company_hour_costs_json(uuid) from public, anon, authenticated;

create or replace function public.get_company_hour_costs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.company_hour_costs_json(public.require_own_company());
end;
$$;
comment on function public.get_company_hour_costs() is
  'RPC (founder): fixed and variable costs of the last closed hour of the own company, each split by where they '
  'arise (ADR-208, Nachtrag).';
revoke all on function public.get_company_hour_costs() from public, anon;
grant execute on function public.get_company_hour_costs() to authenticated;
