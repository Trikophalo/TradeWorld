-- =============================================================================
-- NEXA · M3g · 0100 · AI workers lower the reachable quality (ADR-069)
-- =============================================================================
-- Mirrors src/lib/sim/startup.ts (closeStartupQuarter): the quality target is
-- multiplied by 1 − aiQualityPenalty × AI workers / team size.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

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
  -- AI workers do standard work (ADR-069)
  v_target := v_target * (1 - public.cfg_num(v_su, '{aiQualityPenalty}', 0.3)
              * pc.ai_workers::double precision
              / greatest(1, 1 + coalesce((v_team ->> 'employees')::integer, 0) + pc.ai_workers));
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
