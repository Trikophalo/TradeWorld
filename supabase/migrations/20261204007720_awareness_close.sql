-- =============================================================================
-- NEXA · 7720 · Awareness, one model (ADR-188): the hourly close and the strength "Bekanntheit"
-- =============================================================================
-- * player_company_close_hour: full redefinition of the live function (6600, 6900, 7300, 7310 changed it; copied
--   from the database after 7310). Only the awareness block changed: company_awareness_step with the company's cap,
--   served share and reputation, the parts booked in company_awareness_log, the hour row's awareness_parts with the
--   cap and all sources, the strength counted as awareness / cap.
-- * company_strengths_instant: the awareness score is 100 x (awareness / cap); the caller divides.
-- * company_strengths_step: the awareness score follows with awarenessFollowPerHour (25 % of the gap per hour, both
--   ways) instead of 2 % up, so it cannot stand at 4 while the awareness is at 49 %.
-- Idempotent: runs unchanged as supabase/updates/.

create or replace function public.company_strengths_instant(p_awareness double precision, p_quality double precision, p_demand double precision, p_capacity double precision, p_revenue bigint, p_profit bigint, p_pay_factor_bps integer, p_cash bigint, p_unpaid bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg     jsonb := public.company_strengths_cfg();
  v_costs double precision := greatest(1, coalesce(p_revenue, 0) - coalesce(p_profit, 0));
begin
  return jsonb_build_object(
    -- ADR-188: p_awareness is the awareness as a share of the company's cap (the caller divides)
    'awareness', least(100.0, greatest(0.0, 100 * coalesce(p_awareness, 0))),
    'quality', least(100.0, greatest(0.0, 100 * coalesce(p_quality, 0))),
    'delivery', case when coalesce(p_demand, 0) > 0
                     then least(100.0, greatest(0.0, 100 * coalesce(p_capacity, 0) / p_demand)) else 50 end,
    'margin', case when coalesce(p_revenue, 0) > 0
                   then least(100.0, greatest(0.0, 100.0 * p_profit / p_revenue / public.cfg_num(cfg, '{marginFull}', 0.25)))
                   else 0 end,
    'team', least(100.0, greatest(0.0, coalesce(p_pay_factor_bps, 0) / 100.0)),
    'finance', case when coalesce(p_unpaid, 0) > 0 then 0
                    else least(100.0, greatest(0.0, 100.0 * coalesce(p_cash, 0) / (v_costs * public.cfg_num(cfg, '{cashHoursFull}', 24)))) end);
end;
$function$;

create or replace function public.company_strengths_step(p_prev jsonb, p_instant jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg  jsonb := public.company_strengths_cfg();
  k    text;
  p    double precision;
  v    double precision;
  out  jsonb := '{}'::jsonb;
begin
  foreach k in array array['awareness', 'quality', 'delivery', 'margin', 'team', 'finance'] loop
    p := coalesce((p_prev ->> k)::double precision, 0);
    v := coalesce((p_instant ->> k)::double precision, 0);
    out := out || jsonb_build_object(k, least(100.0, greatest(0.0,
             p + case when k = 'awareness' then public.cfg_num(cfg, '{awarenessFollowPerHour}', 0.25)  -- ADR-188
                      when v > p then public.cfg_num(cfg, '{gainPerHour}', 0.02) else public.cfg_num(cfg, '{decayPerHour}', 0.05) end
                 * (v - p))));
  end loop;
  return out;
end;
$function$;

create or replace function public.player_company_close_hour(p_company uuid, p_hour_start timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pc        public.player_companies;
  v_momentum double precision;
  v_lx      jsonb;
  v_lxc     bigint := 0;
  v_sbonus  bigint := 0;  -- ADR-176 (company_strengths)
  v_aiutil  integer := 0;  -- ADR-180
  v_awh     jsonb;
  v_aw0     double precision;
  v_q0      double precision;
  v_boost   double precision;
  v_awcap   double precision;  -- ADR-188
  v_awnext  double precision;
  v_sscore  jsonb;
  v_scash   bigint;
  c         public.companies;
  v_su      jsonb := coalesce(public.config_jsonb('startups'), '{}'::jsonb);
  v_hours   double precision := greatest(1, public.config_double('time', '{quarterHours}', 6));
  v_start   timestamptz := date_trunc('hour', p_hour_start);
  v_end     timestamptz;
  v_qid     bigint;
  v_team    jsonb;
  v_price   jsonb;
  v_ev      jsonb;
  v_camp    public.company_campaigns;
  v_stage   integer;
  v_demand  double precision;
  v_cap     double precision;
  v_sold    double precision;
  v_ctr     double precision;
  v_own     bigint;
  v_crev    bigint;
  v_hhbal   bigint;
  v_rev     bigint;
  v_cogs    bigint;
  v_gross   bigint;
  v_aidue   bigint;
  v_aipaid  bigint;
  v_pdue    bigint := 0;
  v_ppaid   bigint := 0;
  v_due     bigint;
  v_factor  integer;
  v_fixed   bigint;
  v_mk      bigint;
  v_costs   bigint;
  v_paid    bigint := 0;
  v_unpaid  bigint := 0;
  v_settle  bigint := 0;
  v_cash    bigint;
  v_acc     uuid;
  v_hh      uuid;
  v_profit  bigint;
  v_owed    bigint;
  v_free    bigint;
  v_stakes  bigint := 0;
  v_sp      bigint;
  v_payout  bigint := 0;
  v_bps     integer;
  v_until   timestamptz;
  v_news    bigint;
  k         text;
  j         record;
  s         record;
begin
  if p_company is null or p_hour_start is null then
    return null;
  end if;
  select * into pc from public.player_companies where company_id = p_company and status = 'active' for update;
  if pc.company_id is null then
    return null;
  end if;
  -- task momentum (ADR-148): solved tasks lift demand; it drifts back toward 1 every hour, so it must be kept up
  v_momentum := greatest(1.0, 1.0 + (coalesce(pc.task_momentum, 1.0) - 1.0)
                  * (1.0 - public.cfg_num(public.company_tasks_cfg(), '{momentum,decayPerHourBps}', 300) / 10000.0));
  if v_momentum <> coalesce(pc.task_momentum, 1.0) then
    update public.player_companies set task_momentum = v_momentum where company_id = p_company;
    pc.task_momentum := v_momentum;
  end if;
  if exists (select 1 from public.player_company_hours h where h.company_id = p_company and h.hour_start = v_start) then
    update public.player_companies set last_hour_at = greatest(last_hour_at, v_start + interval '1 hour')
     where company_id = p_company and last_hour_at < v_start + interval '1 hour';
    return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'skipped', 'already_closed');
  end if;
  v_end := v_start + interval '1 hour';
  select * into c from public.companies where id = p_company;
  select gq.id into v_qid from public.game_quarters gq where gq.starts_at <= v_start and gq.ends_at > v_start;
  v_team := public.player_company_team(p_company);
  v_acc := public.company_cash_account(p_company);
  v_hh := public.ledger_system_account('households');
  k := 'pch:' || p_company::text || ':' || to_char(v_start at time zone 'UTC', 'YYYYMMDDHH24');
  -- company event of this hour (ADR-091): demand and capacity factors, extra costs as a share of the own revenue
  v_ev := public.company_event_hour_effect(p_company, v_start, v_end);
  -- marketing campaign (ADR-097, campaignDemandFactor): its factor when the hour starts inside its window
  v_camp := public.company_campaign_at(p_company, v_start);
  -- listed companies (ADR-167): research, products, regions, benefits, mood and reputation as terms of the hour
  v_lx := public.listed_hour_effect(p_company, v_start);
  pc.awareness := least(1.0, pc.awareness + (v_lx ->> 'awareness_add')::double precision);
  pc.quality := least(1.0, greatest(0.0, pc.quality + (v_lx ->> 'quality_add')::double precision));

  -- sales of the hour with the quarter's awareness and quality; demand and capacity count in units at the
  -- normal price, the price strategy changes both price and demand (ADR-083)
  v_price := public.company_price_effect(pc.price_level, pc.quality);
  v_stage := least(greatest(coalesce((v_team ->> 'stage')::integer, 0), 0),
                   greatest(jsonb_array_length(coalesce(v_su #> '{stages,awarenessCaps}', '[1]'::jsonb)) - 1, 0));
  v_demand := pc.potential_annual_cents * public.company_market_factor(pc.tier, pc.expansion_level) / 4.0 / v_hours
            * pc.awareness * (0.5 + 0.5 * pc.quality)
            * exp(public.cfg_num(v_su, '{demandNoise}', 0.1) * public.gauss_random())
            * (v_price ->> 'demand')::double precision
            * (v_ev ->> 'demand_factor')::double precision
            * greatest(0, coalesce(v_camp.demand_factor, 1))
            * coalesce(pc.task_momentum, 1.0)
            * (v_lx ->> 'demand_factor')::double precision;
  v_cap := (v_team ->> 'team_productivity_bps')::double precision / 10000.0
         * public.cfg_num(v_su, array['capacityCentsPerProductivity', c.sector_key], 250000)
         * (1 + public.cfg_num(v_su, '{stages,capacityBonusPerStage}', 0.25) * v_stage)
         * public.company_capacity_factor(pc.expansion_level)
         * (v_ev ->> 'capacity_factor')::double precision
         * (v_lx ->> 'capacity_factor')::double precision / v_hours;
  v_sold := least(v_demand, v_cap);
  -- contract work: a share of the unused capacity at the normal price (ADR-083)
  v_ctr := case when pc.contract_work
                then greatest(0, v_cap - v_sold) * public.cfg_num(v_su, '{contractWork,shareOfFreeCapacity}', 0.25)
                else 0 end;
  v_own := round((v_sold * (v_price ->> 'price')::double precision)::numeric)::bigint;
  v_crev := round(v_ctr::numeric)::bigint;
  -- closed money system: the households pay at most what they have (own sales first)
  v_hhbal := greatest(0, coalesce((select a.balance_cents from public.ledger_accounts a where a.id = v_hh), 0));
  if v_own + v_crev > v_hhbal then
    v_own := least(v_own, v_hhbal);
    v_crev := least(v_crev, v_hhbal - v_own);
    v_sold := least(v_sold, v_own / greatest((v_price ->> 'price')::double precision, 0.0001));
    v_ctr := v_crev;
  end if;
  v_rev := v_own + v_crev;
  -- goods; an event's extra costs (or savings) move with the own revenue, goods never cost less than nothing
  v_cogs := round(greatest(0, v_sold * (1 - public.cfg_num(v_su, array['grossMargin', c.sector_key], 0.5)) * (v_lx ->> 'cogs_factor')::double precision
                              + v_own * (v_ev ->> 'extra_cost_share')::double precision)::numeric)::bigint
          + round((v_ctr * (1 - public.cfg_num(v_su, '{contractWork,grossMargin}', 0.3)))::numeric)::bigint;
  v_gross := v_rev - v_cogs;

  -- presence (ADR-103): employees away for careers.inactivity.fireAfterHours lose the job first, paid up to that moment
  for j in select pj.id from public.player_jobs pj where pj.company_id = p_company and pj.status = 'active' order by pj.id loop
    perform public.job_absence_check(j.id, v_end);
  end loop;
  -- wages due: AI workers and the hourly contract wages of the players (the founder draws no wage)
  -- ADR-180: AI workers fill what founder and players cannot; the full wage only for the used capacity
  v_aiutil := public.company_ai_utilization_bps(v_sold, v_cap, pc.ai_workers,
                (v_team ->> 'team_productivity_bps')::double precision / 10000.0);
  v_aidue := public.company_ai_wage_due_cents(pc.ai_workers, v_aiutil);
  for j in select pj.id, pj.salary_cents_per_hour, pj.notice_ends_at from public.player_jobs pj
            where pj.company_id = p_company and pj.status = 'active' order by pj.id loop
    v_until := least(v_end, coalesce(j.notice_ends_at, v_end));
    v_pdue := v_pdue + j.salary_cents_per_hour * public.job_payable_minutes(j.id, v_until) / 60;
  end loop;
  v_due := v_aidue + v_pdue;
  -- never more than the hour earned; everyone gets the same share (ADR-072)
  v_factor := case when v_due <= 0 then 10000 else least(10000, greatest(0, v_gross) * 10000 / v_due)::integer end;
  v_aipaid := v_aidue * v_factor / 10000;

  -- money: revenue (own sales and contract work) from the households, goods and AI wages back to them
  if v_rev > 0 then
    perform public.ledger_transfer(v_hh, v_acc, v_rev, 'company_revenue',
                                   'Umsatz ' || to_char(v_start at time zone 'Europe/Berlin', 'HH24') || ' Uhr',
                                   'company', p_company, k || ':revenue', pc.founder_id);
  end if;
  -- strengths bonus (ADR-176): the reward tier of the scores before this hour
  select cst.scores into v_sscore from public.company_strengths cst where cst.company_id = p_company;
  if v_rev > 0 and public.company_strengths_reward_bps(coalesce(v_sscore, '{}'::jsonb)) > 0 then
    v_sbonus := least(floor(v_rev * public.company_strengths_reward_bps(v_sscore) / 10000.0)::bigint,
                      greatest(0, coalesce((select a.balance_cents from public.ledger_accounts a where a.id = v_hh), 0)));
    if v_sbonus > 0 then
      perform public.ledger_transfer(v_hh, v_acc, v_sbonus, 'company_revenue', 'Stärken-Bonus',
                                     'company', p_company, k || ':strengths', pc.founder_id);
      v_rev := v_rev + v_sbonus;
    end if;
  end if;
  if v_cogs + v_aipaid > 0 then
    perform public.ledger_transfer(v_acc, v_hh, v_cogs + v_aipaid, 'company_costs', 'Wareneinsatz und KI-Kräfte',
                                   'company', p_company, k || ':goods', pc.founder_id);
  end if;
  -- players: the hour (up to the end of a notice) at contract wage x factor, with XP and branch minutes
  update public.player_companies set pay_factor_bps = v_factor where company_id = p_company;
  for j in select pj.id, pj.player_id, pj.notice_ends_at from public.player_jobs pj
            where pj.company_id = p_company and pj.status = 'active' order by pj.id loop
    v_until := least(v_end, coalesce(j.notice_ends_at, v_end));
    perform public.lock_player_accounts(j.player_id);
    v_ppaid := v_ppaid + public.accrue_job_salary(j.id, v_until);
  end loop;

  -- fixed costs (with the expansion level) and marketing from the cash; the rest becomes an open bill
  -- efficiency upgrade of the founder (ADR-100): the hour's fixed costs x (10 000 − fixedCostDiscountBps) / 10 000
  v_fixed := public.apply_bps(round((public.company_fixed_cost_cents(pc.tier, pc.expansion_level) / v_hours)::numeric)::bigint,
                              10000 - public.player_fixed_cost_discount_bps(pc.founder_id));
  v_fixed := round(v_fixed * (v_lx ->> 'fixed_factor')::double precision)::bigint;  -- ADR-167
  v_mk := round((pc.marketing_cents_per_quarter / v_hours)::numeric)::bigint;
  v_costs := v_fixed + v_mk;
  select greatest(0, a.balance_cents) into v_cash from public.ledger_accounts a where a.id = v_acc;
  v_paid := least(v_costs, coalesce(v_cash, 0));
  if v_paid > 0 then
    perform public.ledger_transfer(v_acc, v_hh, v_paid, 'company_costs', 'Fixkosten und Marketing',
                                   'company', p_company, k || ':costs', pc.founder_id);
  end if;
  v_unpaid := v_costs - v_paid;
  if v_unpaid = 0 and pc.unpaid_cents > 0 then
    select greatest(0, a.balance_cents) into v_cash from public.ledger_accounts a where a.id = v_acc;
    v_settle := least(pc.unpaid_cents, coalesce(v_cash, 0));
    if v_settle > 0 then
      perform public.ledger_transfer(v_acc, v_hh, v_settle, 'company_costs', 'Offene Rechnungen',
                                     'company', p_company, k || ':settle', pc.founder_id);
    end if;
  end if;

  -- listed companies (ADR-167): running costs of products, regions, machines, benefits and the tax advisor
  v_lxc := public.listed_hour_costs(p_company, v_start, k);
  v_fixed := v_fixed + v_lxc;
  v_paid := v_paid + v_lxc;
  v_profit := v_rev - v_cogs - v_ppaid - v_aipaid - v_fixed - v_mk;
  v_owed := pc.unpaid_cents + v_unpaid - v_settle;

  -- stakes (ADR-098, stakePayoutCents): every running stake whose term holds this hour takes its share of a
  -- profitable hour (rounded down), never more than the free cash; served before the CEO payout. The hour is marked
  -- as handled (settled_until) whether it paid or not.
  for s in select x.id, x.investor_id, x.share_bps from public.deals x
            where x.kind = 'stake' and x.status = 'active' and x.company_id = p_company
              and x.settled_until <= v_start and x.ends_at > v_start
            order by x.accepted_at, x.id for update of x
  loop
    v_sp := 0;
    if v_profit > 0 then
      select a.balance_cents - v_owed - public.listed_reserved_cents(p_company) into v_free from public.ledger_accounts a where a.id = v_acc;
      v_sp := least(v_profit * s.share_bps / 10000, greatest(0, coalesce(v_free, 0)));
    end if;
    if v_sp > 0 then
      perform public.lock_player_accounts(s.investor_id);
      perform public.ledger_transfer(v_acc, public.ledger_player_account(s.investor_id, 'player_cash'), v_sp, 'dividend',
                                     'Gewinnanteil ' || c.name || ' ' || to_char(v_start at time zone 'Europe/Berlin', 'HH24') || ' Uhr',
                                     'deal', s.id, k || ':stake:' || s.id::text, s.investor_id);
      perform public.loan_withhold(s.investor_id, v_sp, k || ':stake:' || s.id::text);
      v_stakes := v_stakes + v_sp;
    end if;
    update public.deals set payouts_cents = payouts_cents + v_sp, settled_until = v_end where id = s.id;
  end loop;

  -- automatic CEO payout (ADR-086, founderPayoutCents): after the hour's own bookings and the stakes, a share of the
  -- profit left after the stake payouts (rounded down) moves from the company cash to the founder's private cash like
  -- company_withdraw, never more than the free cash. A transfer, not a cost: profit_cents stays as computed above.
  v_bps := least(10000, greatest(0, least(coalesce(pc.founder_payout_bps, 0), public.listed_payout_cap_bps(p_company, v_start))));
  if v_profit - v_stakes > 0 and v_bps > 0 then
    select a.balance_cents - v_owed - public.listed_reserved_cents(p_company) into v_free from public.ledger_accounts a where a.id = v_acc;
    v_payout := least((v_profit - v_stakes) * v_bps / 10000, greatest(0, coalesce(v_free, 0)));
  end if;
  if v_payout > 0 then
    perform public.lock_player_accounts(pc.founder_id);
    perform public.ledger_transfer(v_acc, public.ledger_player_account(pc.founder_id, 'player_cash'), v_payout, 'transfer',
                                   'CEO-Auszahlung ' || to_char(v_start at time zone 'Europe/Berlin', 'HH24') || ' Uhr',
                                   'company', p_company, k || ':payout', pc.founder_id);
    perform public.loan_withhold(pc.founder_id, v_payout, k || ':payout');
  end if;

  -- record hour (ADR-091): beating an earlier best hour is news, at most one item per Berlin day (updated while the
  -- day's record keeps rising and no AI text was written for it)
  if v_profit > coalesce(pc.best_hour_profit_cents, 0) and coalesce(pc.best_hour_profit_cents, 0) > 0 then
    select n.id into v_news from public.company_news n
     where n.company_id = p_company and n.kind = 'record_hour'
       and ((n.payload ->> 'hour_start')::timestamptz at time zone 'Europe/Berlin')::date
           = (v_start at time zone 'Europe/Berlin')::date
     order by n.id desc limit 1;
    if v_news is null then
      perform public.company_news_add(p_company, 'record_hour',
                                      jsonb_build_object('profit_cents', v_profit, 'hour_start', v_start));
    else
      update public.company_news set payload = jsonb_build_object('profit_cents', v_profit, 'hour_start', v_start)
       where id = v_news and ai_headline is null;
    end if;
  end if;

  update public.player_companies
     set unpaid_cents = v_owed,
         distress = v_owed > 0,
         last_hour_at = greatest(pc.last_hour_at, v_end),
         best_hour_profit_cents = greatest(best_hour_profit_cents, v_profit)
   where company_id = p_company;
  insert into public.player_company_hours (company_id, hour_start, game_quarter_id, demand_cents, capacity_cents, revenue_cents,
                                           contract_revenue_cents, cogs_cents, fixed_cents, marketing_cents, player_wages_due_cents,
                                           player_wages_paid_cents, ai_wages_due_cents, ai_wages_paid_cents, pay_factor_bps,
                                           paid_costs_cents, unpaid_added_cents, profit_cents, founder_payout_cents, event_id,
                                           stake_payout_cents, campaign_id)
  values (p_company, v_start, v_qid, round(v_demand::numeric)::bigint, round(v_cap::numeric)::bigint, v_rev,
          v_crev, v_cogs, v_fixed, v_mk, v_pdue, v_ppaid, v_aidue, v_aipaid, v_factor, v_paid, v_unpaid, v_profit, v_payout,
          (v_ev ->> 'event_id')::uuid, v_stakes, v_camp.id);

  -- strengths (ADR-176): every score moves a step toward what this hour showed
  update public.player_company_hours set strength_bonus_cents = v_sbonus where company_id = p_company and hour_start = v_start;
  -- ADR-188: one awareness model. Marketing closes a share of the gap to the cap (tier, stage, expansion), word of
  -- mouth from served customers and reputation, slow decay toward the floor. Single events of this hour (tasks,
  -- campaigns, moves, ...) are already in the value and in company_awareness_log; the hour books its three parts there
  -- too (decay takes any clamp, so the parts always add up).
  select x.awareness, x.quality into v_aw0, v_q0 from public.player_companies x where x.company_id = p_company;
  select coalesce(sum(l.delta), 0) into v_boost from public.company_awareness_log l
   where l.company_id = p_company and l.hour_start = v_start and l.source not in ('marketing', 'word_of_mouth', 'decay');
  v_awcap := public.company_awareness_cap(pc.tier, v_stage, coalesce(pc.expansion_level, 0));
  v_awh := public.company_awareness_step(v_aw0, v_awcap, v_q0,
             (public.company_price_effect(pc.price_level, v_q0) ->> 'awareness')::double precision, v_mk::double precision,
             pc.potential_annual_cents * public.company_market_factor(pc.tier, pc.expansion_level),
             case when v_demand > 0 then v_sold / v_demand else 1 end, coalesce(pc.reputation, 50));
  v_awnext := (v_awh ->> 'next')::double precision;
  update public.player_companies set awareness = v_awnext, awareness_boost = 0 where company_id = p_company;
  perform public.company_awareness_log_add(p_company, v_start, 'marketing', (v_awh ->> 'marketing')::double precision);
  perform public.company_awareness_log_add(p_company, v_start, 'word_of_mouth', (v_awh ->> 'word_of_mouth')::double precision);
  perform public.company_awareness_log_add(p_company, v_start, 'decay', v_awnext - v_aw0
             - (v_awh ->> 'marketing')::double precision - (v_awh ->> 'word_of_mouth')::double precision);
  delete from public.company_awareness_log l where l.company_id = p_company and l.hour_start < v_start - interval '8 days';
  update public.player_company_hours
     set ai_utilization_bps = v_aiutil, awareness_before = v_aw0 - v_boost,
         awareness_after = v_awnext,
         awareness_parts = jsonb_build_object('word_of_mouth', v_awh -> 'word_of_mouth', 'marketing', v_awh -> 'marketing',
                                              'decay', -(v_awnext - v_aw0 - (v_awh ->> 'marketing')::double precision
                                                         - (v_awh ->> 'word_of_mouth')::double precision),
                                              'extra', v_boost, 'cap', v_awcap,
                                              'sources', public.company_awareness_hour_json(p_company, v_start))
   where company_id = p_company and hour_start = v_start;
  select greatest(0, a.balance_cents) into v_scash from public.ledger_accounts a where a.id = v_acc;
  insert into public.company_strengths as cs (company_id, scores, hours, updated_at)
  values (p_company,
          public.company_strengths_step('{}'::jsonb,
            public.company_strengths_instant(v_awnext / greatest(0.01, v_awcap), pc.quality, v_demand, v_cap, v_rev, v_profit, v_factor, v_scash, v_owed)),
          1, now())
  on conflict (company_id) do update
    set scores = public.company_strengths_step(cs.scores,
                   public.company_strengths_instant(v_awnext / greatest(0.01, v_awcap), pc.quality, v_demand, v_cap, v_rev, v_profit, v_factor, v_scash, v_owed)),
        hours = cs.hours + 1, updated_at = now();
  perform public.listed_hour_after(p_company, v_start, v_demand, v_cap, v_rev, v_profit, v_factor, v_payout);  -- ADR-167
  return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'quarter_id', v_qid, 'revenue_cents', v_rev,
                            'contract_revenue_cents', v_crev, 'profit_cents', v_profit, 'pay_factor_bps', v_factor,
                            'player_wages_paid_cents', v_ppaid, 'ai_wages_paid_cents', v_aipaid, 'unpaid_added_cents', v_unpaid,
                            'founder_payout_cents', v_payout, 'event_id', v_ev -> 'event_id', 'stake_payout_cents', v_stakes,
                            'campaign_id', v_camp.id);
end;
$function$;
