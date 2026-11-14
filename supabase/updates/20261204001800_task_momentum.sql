-- ===== idempotent copy of migrations/20261204001800_task_momentum.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1800 · Solved tasks compound company profit: task momentum (ADR-148)
-- =============================================================================
-- Every solved company task lifts the company's "Schwung" (task_momentum), a demand multiplier on top of everything
-- else. Perfect runs and human work lift it more; a failed or missed task lowers it. It drifts back toward 1 every
-- hour (momentum.decayPerHourBps), so a company only keeps high earnings by keeping the tasks solved. Higher demand
-- means more revenue, which funds upgrades and more staff, which solve more tasks -- so good play compounds.
-- Idempotent: runs unchanged as supabase/updates/20261204001800_task_momentum.sql.

alter table public.player_companies add column if not exists task_momentum double precision not null default 1
  check (task_momentum >= 1);
comment on column public.player_companies.task_momentum is
  'Demand multiplier from solved tasks (ADR-148); lifted on success, lowered on failure, drifts toward 1 each hour.';

create or replace function public.company_task_momentum_apply(p_company uuid, p_score integer, p_by_ai boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m     jsonb := coalesce(public.company_tasks_cfg() -> 'momentum', '{}'::jsonb);
  v_now double precision;
  v_delta double precision;
begin
  if (m ->> 'maxBps') is null then
    return;  -- momentum not configured
  end if;
  if p_score is not null and p_score >= (public.company_tasks_cfg() ->> 'passScoreBps')::integer then
    -- the gain scales with the score; perfect runs add a bonus; the AI lifts it less than a person
    v_delta := coalesce((m ->> 'perSolveBps')::numeric, 0) * p_score / 10000.0
             + case when p_score >= 10000 then coalesce((m ->> 'perfectBonusBps')::numeric, 0) else 0 end;
    if p_by_ai then
      v_delta := v_delta * coalesce((m ->> 'aiBps')::numeric, 5000) / 10000.0;
    end if;
  else
    v_delta := -coalesce((m ->> 'penaltyBps')::numeric, 0);  -- failed or missed
  end if;
  select coalesce(task_momentum, 1.0) into v_now from public.player_companies where company_id = p_company for update;
  update public.player_companies
     set task_momentum = least(1.0 + coalesce((m ->> 'maxBps')::numeric, 0) / 10000.0,
                               greatest(1.0, v_now + v_delta / 10000.0))
   where company_id = p_company;
end;
$$;
revoke all on function public.company_task_momentum_apply(uuid, integer, boolean) from public, anon, authenticated;
comment on function public.company_task_momentum_apply(uuid, integer, boolean) is
  'Internal: a resolved task lifts or lowers the company''s task_momentum (ADR-148).';

create or replace function public.company_task_resolve(p_task_id bigint, p_score integer, p_by_ai boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.company_tasks_cfg();
  t         public.company_tasks;
  v_ok      boolean;
  v_amount  bigint := 0;
  v_avail   bigint;
  v_status  text;
  v_xp      integer := 0;
  v_nick    text;
begin
  select * into t from public.company_tasks where id = p_task_id for update;
  if t.id is null or t.status in ('success', 'failure', 'missed') then
    return null;
  end if;
  v_ok := p_score is not null and p_score >= (cfg ->> 'passScoreBps')::integer;
  if v_ok then
    v_amount := (t.value_cents * p_score) / 10000;
    if p_by_ai then
      v_amount := (v_amount * (cfg -> 'ai' ->> 'valueBps')::integer) / 10000;
    end if;
    -- ADR-134 task_pay of the founder
    v_amount := v_amount + public.apply_bps(v_amount, public.company_upgrade_bps(t.company_id, 'task_pay'));
    select a.balance_cents into v_avail from public.ledger_accounts a
     where a.id = public.ledger_system_account('households') for update;
    v_amount := least(v_amount, greatest(coalesce(v_avail, 0), 0));
    if v_amount > 0 then
      perform public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(t.company_id),
                                     v_amount, 'company_revenue', 'Aufgabe erledigt: ' || t.task_key, 'company', t.company_id,
                                     'task:result:' || t.id::text, t.done_by, jsonb_build_object('task', t.task_key));
    end if;
    v_status := 'success';
  else
    v_amount := (t.value_cents * (cfg ->> 'penaltyBps')::integer) / 10000;
    -- ADR-134 task_safety of the founder
    v_amount := v_amount - public.apply_bps(v_amount, public.company_upgrade_bps(t.company_id, 'task_safety'));
    select a.balance_cents into v_avail from public.ledger_accounts a
     where a.id = public.company_cash_account(t.company_id) for update;
    v_amount := least(v_amount, greatest(coalesce(v_avail, 0), 0));
    if v_amount > 0 then
      perform public.ledger_transfer(public.company_cash_account(t.company_id), public.ledger_system_account('households'),
                                     v_amount, 'company_costs', 'Aufgabe verpatzt: ' || t.task_key, 'company', t.company_id,
                                     'task:result:' || t.id::text, t.done_by, jsonb_build_object('task', t.task_key));
    end if;
    v_status := case when p_score is null then 'missed' else 'failure' end;
    v_amount := -v_amount;
  end if;
  -- task momentum (ADR-148): every resolved task moves the company's long-term demand
  perform public.company_task_momentum_apply(t.company_id, p_score, p_by_ai);

  -- missions (ADR-130): done right, done perfectly
  if v_ok and t.done_by is not null and not p_by_ai then
    perform public.mission_event(t.done_by, 'task_done', 1, t.id::text);
    if p_score >= 10000 then
      perform public.mission_event(t.done_by, 'task_perfect', 1, t.id::text);
    end if;
  end if;
  if t.done_by is not null and not p_by_ai then
    v_xp := public.grant_xp(t.done_by, 'work_task',
                            case when v_ok then (cfg -> 'xp' ->> 'success')::integer else (cfg -> 'xp' ->> 'failure')::integer end,
                            'company_task:' || t.id::text, 'company_task', null);
  end if;
  update public.company_tasks
     set status = v_status, score_bps = p_score, result_cents = v_amount, resolved_at = public.game_now()
   where id = t.id;
  select p.nickname into v_nick from public.profiles p where p.id = coalesce(t.done_by, t.assignee_id);
  perform public.company_news_add(t.company_id, 'task_' || v_status,
    jsonb_build_object('task', t.task_key, 'amount_cents', v_amount, 'nickname', v_nick, 'ai', p_by_ai));
  return jsonb_build_object('status', v_status, 'score_bps', p_score, 'result_cents', v_amount, 'xp', v_xp);
end;
$$;

create or replace function public.player_company_close_hour(p_company uuid, p_hour_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc        public.player_companies;
  v_momentum double precision;
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
            * coalesce(pc.task_momentum, 1.0);
  v_cap := (v_team ->> 'team_productivity_bps')::double precision / 10000.0
         * public.cfg_num(v_su, array['capacityCentsPerProductivity', c.sector_key], 250000)
         * (1 + public.cfg_num(v_su, '{stages,capacityBonusPerStage}', 0.25) * v_stage)
         * public.company_capacity_factor(pc.expansion_level)
         * (v_ev ->> 'capacity_factor')::double precision / v_hours;
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
  v_cogs := round(greatest(0, v_sold * (1 - public.cfg_num(v_su, array['grossMargin', c.sector_key], 0.5))
                              + v_own * (v_ev ->> 'extra_cost_share')::double precision)::numeric)::bigint
          + round((v_ctr * (1 - public.cfg_num(v_su, '{contractWork,grossMargin}', 0.3)))::numeric)::bigint;
  v_gross := v_rev - v_cogs;

  -- presence (ADR-103): employees away for careers.inactivity.fireAfterHours lose the job first, paid up to that moment
  for j in select pj.id from public.player_jobs pj where pj.company_id = p_company and pj.status = 'active' order by pj.id loop
    perform public.job_absence_check(j.id, v_end);
  end loop;
  -- wages due: AI workers and the hourly contract wages of the players (the founder draws no wage)
  v_aidue := pc.ai_workers * public.config_bigint('startups', '{aiWorkerWageCentsPerHour}', 12000);
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
      select a.balance_cents - v_owed into v_free from public.ledger_accounts a where a.id = v_acc;
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
  v_bps := least(10000, greatest(0, coalesce(pc.founder_payout_bps, 0)));
  if v_profit - v_stakes > 0 and v_bps > 0 then
    select a.balance_cents - v_owed into v_free from public.ledger_accounts a where a.id = v_acc;
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

  return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'quarter_id', v_qid, 'revenue_cents', v_rev,
                            'contract_revenue_cents', v_crev, 'profit_cents', v_profit, 'pay_factor_bps', v_factor,
                            'player_wages_paid_cents', v_ppaid, 'ai_wages_paid_cents', v_aipaid, 'unpaid_added_cents', v_unpaid,
                            'founder_payout_cents', v_payout, 'event_id', v_ev -> 'event_id', 'stake_payout_cents', v_stakes,
                            'campaign_id', v_camp.id);
end;
$$;

create or replace function public.company_tasks_state(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.company_tasks_cfg();
  m        record;
  pc       public.player_companies;
  c        public.companies;
  v_ai_ok  boolean;
begin
  select * into m from public.company_task_member(p_player);
  if m.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  select * into pc from public.player_companies where company_id = m.company_id;
  select * into c from public.companies where id = m.company_id;
  v_ai_ok := pc.ai_workers > 0
             and (m.is_founder or public.job_tier_rank(m.tier) >= public.job_tier_rank(cfg ->> 'aiDelegateMinTier'));
  return jsonb_build_object(
    'role', case when m.is_founder then 'founder' else 'employee' end,
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'tier', pc.tier, 'product', pc.product_key),
    'momentum', coalesce(pc.task_momentum, 1.0),  -- ADR-148
    'my_tier', m.tier,
    'auto_ai', pc.tasks_auto_ai,
    'ai_workers', pc.ai_workers,
    'ai_minutes', public.company_task_ai_minutes(m.company_id),
    'can_use_ai', v_ai_ok,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nickname', p.nickname, 'tag', p.tag, 'tier', j.tier, 'is_me', j.player_id = p_player,
               'supervisor', (select s.nickname from public.profiles s where s.id = j.supervisor_id),
               'reports_to_me', case when m.is_founder then j.supervisor_id is null
                                     else coalesce(j.supervisor_id = p_player, false) end,
               'open_tasks', (select count(*) from public.company_tasks t
                               where t.company_id = m.company_id and t.assignee_id = j.player_id
                                 and t.status in ('assigned', 'playing')))
             order by public.job_tier_rank(j.tier::text) desc, p.nickname)
        from public.player_jobs j join public.profiles p on p.id = j.player_id
       where j.company_id = m.company_id and j.status = 'active'), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'key', t.task_key, 'game', t.game, 'branch', t.branch, 'status', t.status,
               'value_cents', t.value_cents, 'created_at', t.created_at, 'due_at', t.due_at,
               'assignee', (select p.nickname from public.profiles p where p.id = t.assignee_id),
               'assignee_ai', t.assignee_ai,
               'assigned_by', (select p.nickname from public.profiles p where p.id = t.assigned_by),
               'ai_done_at', t.ai_done_at, 'opened_at', t.opened_at,
               'mine', coalesce(t.assignee_id = p_player, false),
               'can_delegate', t.status in ('open', 'assigned')
                               and (m.is_founder or t.status = 'open' or t.assignee_id = p_player))
             order by t.due_at)
        from public.company_tasks t
       where t.company_id = m.company_id and t.status in ('open', 'assigned', 'playing', 'ai')), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h order by h ->> 'resolved_at' desc)
        from (select jsonb_build_object('id', t.id, 'key', t.task_key, 'status', t.status, 'result_cents', t.result_cents,
                                        'score_bps', t.score_bps, 'ai', t.assignee_ai, 'resolved_at', t.resolved_at,
                                        'done_by', (select p.nickname from public.profiles p
                                                     where p.id = coalesce(t.done_by, t.assignee_id))) as h
                from public.company_tasks t
               where t.company_id = m.company_id and t.status in ('success', 'failure', 'missed')
               order by t.resolved_at desc
               limit (cfg ->> 'historyLimit')::integer) x), '[]'::jsonb));
end;
$$;
