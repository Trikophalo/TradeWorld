-- =============================================================================
-- NEXA · M3d · 0200 · Profit-linked pay (ADR-058) and insolvency with private
--                     liability and forced loans (ADR-052, docs/PLAYER_COMPANIES.md 3)
-- =============================================================================
-- Mirrors src/lib/sim/payroll.ts (payFactorBps, distributeBonus) and
-- src/lib/sim/insolvency.ts (dissolve, isInsolvent, withholdIncome).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Forced loans: open debt and withholding of private income
-- ---------------------------------------------------------------------------
create or replace function public.player_debt_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.outstanding_cents), 0)::bigint from public.player_loans l where l.player_id = p_player and l.status = 'open';
$$;

-- Keeps back startups.insolvency.loanWithholdingBps of a private income that was just
-- credited to the player's cash (withholdIncome) and repays the open forced loans
-- (oldest first) into the financial-market pot. Returns the amount repaid.
create or replace function public.loan_withhold(p_player uuid, p_income_cents bigint, p_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share  bigint;
  v_left   bigint;
  v_take   bigint;
  v_total  bigint := 0;
  l        record;
begin
  if p_player is null or coalesce(p_income_cents, 0) <= 0
     or not exists (select 1 from public.player_loans pl where pl.player_id = p_player and pl.status = 'open') then
    return 0;
  end if;
  v_share := p_income_cents * public.config_double('startups', '{insolvency,loanWithholdingBps}', 5000)::bigint / 10000;
  v_share := least(v_share, greatest(0, coalesce((select a.balance_cents from public.ledger_accounts a
                                                   where a.owner_player_id = p_player and a.kind = 'player_cash'), 0)));
  v_left := v_share;
  for l in select pl.id, pl.outstanding_cents from public.player_loans pl
            where pl.player_id = p_player and pl.status = 'open' order by pl.created_at, pl.id for update loop
    exit when v_left <= 0;
    v_take := least(v_left, l.outstanding_cents);
    if v_take > 0 then
      perform public.ledger_transfer(public.ledger_player_account(p_player, 'player_cash'), public.ledger_system_account('market'),
                                     v_take, 'transfer', 'Tilgung Zwangskredit', 'player_loan', l.id,
                                     'loan:' || l.id::text || ':' || coalesce(p_key, gen_random_uuid()::text), p_player);
      update public.player_loans
         set outstanding_cents = outstanding_cents - v_take,
             status = case when outstanding_cents - v_take = 0 then 'repaid' else status end,
             closed_at = case when outstanding_cents - v_take = 0 then now() else closed_at end
       where id = l.id;
      v_left := v_left - v_take;
      v_total := v_total + v_take;
    end if;
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dissolution (insolvency or voluntary close): dissolve()
-- ---------------------------------------------------------------------------
create or replace function public.company_dissolve(p_company uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc        public.player_companies;
  c         public.companies;
  j         record;
  v_acc     uuid;
  v_hh      uuid := public.ledger_system_account('households');
  v_unit    double precision := greatest(1, public.config_double('jobs', '{salaryUnitHours}', 12));
  v_sev     bigint := 0;
  v_n       integer := 0;
  v_cash    bigint;
  v_total   bigint;
  v_fromc   bigint;
  v_rest    bigint;
  v_fcash   bigint;
  v_fromf   bigint;
  v_loan    bigint;
  v_tof     bigint;
  v_id      uuid := gen_random_uuid();
  v_amount  bigint;
  k         text;
begin
  select * into pc from public.player_companies where company_id = p_company and status = 'active' for update;
  if pc.company_id is null then
    return null;
  end if;
  select * into c from public.companies where id = p_company;
  v_acc := public.company_cash_account(p_company);
  k := 'dissolve:' || p_company::text;

  -- wages up to now first (from the company's cash, as when firing)
  for j in select pj.id, pj.player_id from public.player_jobs pj where pj.company_id = p_company and pj.status = 'active' order by pj.id loop
    perform public.lock_player_accounts(j.player_id);
    perform public.accrue_job_salary(j.id);
  end loop;
  select coalesce(sum(round(pj.salary_cents_per_hour * v_unit)::bigint), 0), count(*)
    into v_sev, v_n
    from public.player_jobs pj where pj.company_id = p_company and pj.status = 'active';

  select greatest(0, a.balance_cents) into v_cash from public.ledger_accounts a where a.id = v_acc;
  v_total := greatest(0, pc.unpaid_cents) + v_sev;
  v_fromc := least(coalesce(v_cash, 0), v_total);
  v_rest := v_total - v_fromc;
  perform public.lock_player_accounts(pc.founder_id);
  select greatest(0, a.balance_cents) into v_fcash from public.ledger_accounts a
   where a.owner_player_id = pc.founder_id and a.kind = 'player_cash';
  v_fromf := least(coalesce(v_fcash, 0), v_rest);
  v_loan := v_rest - v_fromf;
  v_tof := coalesce(v_cash, 0) - v_fromc;

  -- the founder's private part and the forced loan go into the company cash first
  if v_fromf > 0 then
    perform public.ledger_transfer(public.ledger_player_account(pc.founder_id, 'player_cash'), v_acc, v_fromf, 'capital_injection',
                                   'Haftung des Gründers', 'company', p_company, k || ':founder', pc.founder_id);
  end if;
  insert into public.company_dissolutions (id, company_id, founder_id, company_name, reason, unpaid_cents, severances_cents,
                                           total_debt_cents, from_company_cents, from_founder_cents, loan_cents, to_founder_cents,
                                           employees)
  values (v_id, p_company, pc.founder_id, c.name, p_reason, greatest(0, pc.unpaid_cents), v_sev, v_total, v_fromc, v_fromf,
          v_loan, v_tof, v_n);
  if v_loan > 0 then
    perform public.ledger_transfer(public.ledger_system_account('market'), v_acc, v_loan, 'transfer',
                                   'Zwangskredit', 'company', p_company, k || ':loan', pc.founder_id);
    insert into public.player_loans (player_id, kind, dissolution_id, principal_cents, outstanding_cents)
    values (pc.founder_id, 'forced', v_id, v_loan, v_loan);
  end if;

  -- creditors: open bills, then one salary severance per employee
  if pc.unpaid_cents > 0 then
    perform public.ledger_transfer(v_acc, v_hh, pc.unpaid_cents, 'company_costs', 'Offene Rechnungen (Auflösung)',
                                   'company', p_company, k || ':bills', pc.founder_id);
  end if;
  for j in select pj.id, pj.player_id, pj.salary_cents_per_hour from public.player_jobs pj
            where pj.company_id = p_company and pj.status = 'active' order by pj.id loop
    v_amount := round(j.salary_cents_per_hour * v_unit)::bigint;
    if v_amount > 0 then
      perform public.ledger_transfer(v_acc, public.ledger_player_account(j.player_id, 'player_cash'), v_amount, 'salary',
                                     'Abfindung: ein Gehalt', 'player_job', j.id, k || ':severance:' || j.id::text, j.player_id);
      perform public.loan_withhold(j.player_id, v_amount, k || ':severance:' || j.id::text);
    end if;
    update public.player_jobs
       set status = 'ended', ended_at = now(),
           end_reason = case when p_reason = 'insolvent' then 'company_insolvent'::public.job_end_reason
                             else 'fired'::public.job_end_reason end
     where id = j.id;
  end loop;
  -- what is left goes to the founder
  if v_tof > 0 then
    perform public.ledger_transfer(v_acc, public.ledger_player_account(pc.founder_id, 'player_cash'), v_tof, 'transfer',
                                   'Restguthaben der Firma', 'company', p_company, k || ':rest', pc.founder_id);
    perform public.loan_withhold(pc.founder_id, v_tof, k || ':rest');
  end if;

  update public.job_postings set status = 'closed' where company_id = p_company and status = 'open';
  update public.job_applications a set status = 'closed'
    from public.job_postings p
   where p.id = a.posting_id and p.company_id = p_company and a.status in ('pending', 'offered');
  update public.player_companies
     set status = 'dissolved', dissolved_at = now(), ai_workers = 0, unpaid_cents = 0, distress = false
   where company_id = p_company;
  update public.companies set phase = 'dissolved', dissolved_at = now() where id = p_company;
  if p_reason = 'insolvent' then
    update public.profiles
       set founding_locked_until = now() + make_interval(secs => public.config_double('startups', '{insolvency,foundingLockoutDays}', 3) * 86400)
     where id = pc.founder_id;
  end if;
  perform public.company_system_message(p_company,
    case when p_reason = 'insolvent' then 'Die Firma ist insolvent und wurde aufgelöst.' else 'Die Firma wurde geschlossen.' end);

  return jsonb_build_object(
    'from_company_cents', v_fromc,
    'from_founder_cents', v_fromf,
    'loan_cents', v_loan,
    'to_founder_cents', v_tof,
    'total_debt_cents', v_total);
end;
$$;

create or replace function public.close_company(p_request_id uuid)
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
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'close_company');
  if v_replay is not null then
    return v_replay;
  end if;
  return public.request_complete(v_player, p_request_id, public.company_dissolve(v_company, 'closed'));
end;
$$;


-- accrue_job_salary as in M2b; player companies pay wage x pay factor, base wages kept, loans withheld
create or replace function public.accrue_job_salary(p_job_id uuid, p_now timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := coalesce(p_now, public.game_now());
  j         public.player_jobs;
  v_ai      boolean;
  v_day     date := (coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date;
  v_paid    integer;
  v_elapsed integer;
  v_minutes integer;
  v_amount  bigint;
  v_pay     bigint := 0;
  v_company uuid;
  v_bal     bigint;
  v_tx      uuid;
  v_xph     double precision;
  v_hours   integer;
  v_xp      integer := 0;
  v_hpp     double precision := greatest(1, public.config_double('skills', '{workHoursPerBranchPoint}', 6));
  v_nb      integer;
  v_share   integer;
  v_bwm     jsonb;
  v_base    bigint;
  v_bp      jsonb;
  v_before  integer;
  r         record;
  k         integer := 0;
begin
  select * into j from public.player_jobs where id = p_job_id and status = 'active' for update;
  if j.id is null then
    return 0;
  end if;
  v_elapsed := floor(extract(epoch from (v_now - j.last_paid_at)) / 60)::integer;
  if v_elapsed < 1 then
    return 0;
  end if;
  v_paid := case when j.paid_day = v_day then j.paid_minutes_today else 0 end;
  v_minutes := least(v_elapsed, greatest(0, (public.config_double('careers', '{paidHoursPerDayCap}', 12) * 60)::integer - v_paid));
  select c.is_ai into v_ai from public.companies c where c.id = j.company_id;

  if v_minutes > 0 then
    v_base := j.salary_cents_per_hour * v_minutes / 60;
    -- player companies pay the contract wage x pay factor of the quarter (ADR-058)
    v_amount := v_base * coalesce((select pc.pay_factor_bps from public.player_companies pc
                                    where pc.company_id = j.company_id and pc.status = 'active'), 10000) / 10000;
    select a.id, a.balance_cents into v_company, v_bal
      from public.ledger_accounts a where a.owner_company_id = j.company_id and a.kind = 'company_cash';
    v_pay := least(v_amount, greatest(coalesce(v_bal, 0), 0));
    if v_pay > 0 then
      v_tx := public.ledger_transfer(v_company, public.ledger_player_account(j.player_id, 'player_cash'), v_pay, 'salary',
                                     'Lohn', 'player_job', j.id,
                                     'salary:' || j.id::text || ':' || to_char(v_now, 'YYYYMMDDHH24MISSUS'), j.player_id);
      perform public.loan_withhold(j.player_id, v_pay, 'salary:' || j.id::text || ':' || to_char(v_now, 'YYYYMMDDHH24MISSUS'));
    end if;
    -- work XP per full paid hour (player companies: workHour.playerCompanyMultiplier)
    v_xph := public.config_double('progression', '{xpSources,workHour,xp}', 40)
           * case when v_ai then 1 else public.config_double('progression', '{xpSources,workHour,playerCompanyMultiplier}', 1.5) end;
    v_hours := (j.experience_minutes + v_minutes) / 60 - j.experience_minutes / 60;
    if v_hours > 0 then
      v_xp := public.grant_xp(j.player_id, 'work_hour', round(v_xph * v_hours)::integer,
                              'work:' || j.id::text || ':' || ((j.experience_minutes + v_minutes) / 60), 'player_job', j.id);
    end if;
    insert into public.salary_payouts (player_job_id, player_id, pay_day, period_start, period_end, minutes_paid, amount_cents,
                                       xp_awarded, ledger_transaction_id, base_amount_cents)
    values (j.id, j.player_id, v_day, j.last_paid_at, v_now, v_minutes, v_pay, v_xp, v_tx, v_base);

    -- branch work minutes and branch points
    perform public.skill_points_ensure(j.player_id);
    select sp.branch_work_minutes, sp.branch_points into v_bwm, v_bp
      from public.player_skill_points sp where sp.player_id = j.player_id for update;
    v_nb := greatest(1, jsonb_array_length(j.required));
    for r in select x ->> 'branch' as branch from jsonb_array_elements(j.required) x loop
      v_share := v_minutes / v_nb + case when k = 0 then v_minutes % v_nb else 0 end;
      v_before := coalesce((v_bwm ->> r.branch)::integer, 0);
      v_bwm := jsonb_set(v_bwm, array[r.branch], to_jsonb(v_before + v_share));
      v_bp := jsonb_set(v_bp, array[r.branch], to_jsonb(coalesce((v_bp ->> r.branch)::integer, 0)
              + ((v_before + v_share) / (v_hpp * 60)::integer - v_before / (v_hpp * 60)::integer)));
      k := k + 1;
    end loop;
    update public.player_skill_points set branch_work_minutes = v_bwm, branch_points = v_bp where player_id = j.player_id;
  end if;

  update public.player_jobs
     set last_paid_at = last_paid_at + make_interval(mins => v_elapsed),
         paid_day = v_day,
         paid_minutes_today = v_paid + v_minutes,
         experience_minutes = experience_minutes + v_minutes,
         earned_total_cents = earned_total_cents + v_pay,
         pay_factor_bps = case when v_minutes > 0 and v_amount > 0 then (v_pay * 10000 / v_amount)::integer else pay_factor_bps end
   where id = j.id;
  return v_pay;
end;
$$;

-- job_state as in M2b plus pay factor of the company, last bonus and work task fields
create or replace function public.job_state(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j        public.player_jobs;
  v_match  integer;
  v_base   bigint;
  v_max    integer;
  v_ai     boolean;
  v_today  date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_cool   double precision := public.config_double('jobs', '{raiseRequest,cooldownDays}', 7);
  v_factor integer;
  v_bonus  bigint;
  v_next   timestamptz;
  v_open   boolean;
begin
  select * into j from public.player_jobs where player_id = p_player and status = 'active';
  if j.id is null then
    return jsonb_build_object('job', null);
  end if;
  select c.is_ai into v_ai from public.companies c where c.id = j.company_id;
  v_match := public.job_match_score(public.player_branch_scores(p_player), j.required);
  v_max := greatest(0, public.config_double('jobs', '{raiseRequest,maxRaiseBpsPerScore}', 300)::integer * (v_match - j.raise_base_score));
  if v_ai then
    v_base := coalesce((public.career_tier(j.tier::text) ->> 'salaryCentsPerHour')::bigint, j.salary_cents_per_hour);
    v_max := least(v_max, greatest(0, floor((public.ai_salary_ceiling(v_base, v_match)::numeric / j.salary_cents_per_hour - 1) * 10000)::integer));
  end if;
  -- player companies: pay factor of the quarter x share the company could pay at the last payout
  select pc.pay_factor_bps * j.pay_factor_bps / 10000,
         coalesce((select sum(sp.bonus_cents) from public.salary_payouts sp join public.game_quarters gq on gq.id = pc.last_closed_quarter_id
                    where sp.player_job_id = j.id and sp.bonus_cents > 0 and sp.period_end = gq.ends_at), 0)
    into v_factor, v_bonus
    from public.player_companies pc where pc.company_id = j.company_id and pc.status = 'active';
  v_factor := coalesce(v_factor, j.pay_factor_bps);
  -- work tasks (ADR-059): next one intervalHours after the last, the first right after signing
  select t.created_at + make_interval(secs => public.config_double('careers', '{workTask,intervalHours}', 3) * 3600)
    into v_next
    from public.player_work_tasks t where t.player_job_id = j.id order by t.created_at desc limit 1;
  v_next := coalesce(v_next, j.started_at);
  v_open := exists (select 1 from public.player_work_tasks t
                     where t.player_job_id = j.id and t.status in ('open', 'started') and t.expires_at > now());
  return jsonb_build_object('job', jsonb_build_object(
    'id', j.id,
    'company', public.company_json(j.company_id),
    'tier', j.tier,
    'title_key', j.title_key,
    'title', case when j.title_key is null then j.title end,
    'required', j.required,
    'salary_cents_per_hour', j.salary_cents_per_hour,
    'pay_factor_bps', v_factor,
    'effective_salary_cents_per_hour', j.salary_cents_per_hour * v_factor / 10000,
    'last_bonus_cents', coalesce(v_bonus, 0),
    'next_work_task_at', v_next,
    'work_task_open', v_open,
    'productivity_bps', public.job_productivity_bps(v_match),
    'started_at', j.started_at,
    'paid_hours_today', case when j.paid_day = v_today then round(j.paid_minutes_today / 60.0, 2) else 0 end,
    'paid_hours_cap', public.config_double('careers', '{paidHoursPerDayCap}', 12),
    'earned_total_cents', j.earned_total_cents,
    'raise_available_at', case when j.raise_requested_at is null
                                    or j.raise_requested_at + make_interval(secs => v_cool * 86400) <= now() then null
                               else j.raise_requested_at + make_interval(secs => v_cool * 86400) end,
    'raise_max_bps', v_max,
    'pending_raise', case when j.pending_raise_bps is not null
                          then jsonb_build_object('requested_bps', j.pending_raise_bps, 'created_at', j.pending_raise_at) end,
    'quit_cost_cents', j.salary_cents_per_hour * public.config_double('jobs', '{salaryUnitHours}', 12)::bigint,
    'signature', j.signature));
end;
$$;
-- quarter close as in M3c plus pay factor, bonus, distress quarters, chat lines and insolvency
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
  v_quality := least(1, greatest(0, pc.quality + public.cfg_num(v_su, '{quality,adjustPerQuarter}', 0.35) * (v_target - pc.quality)));
  v_mk := pc.marketing_cents_per_quarter;
  if v_mk > 0 then
    v_half := greatest(public.cfg_num(v_su, '{awareness,marketingMinHalfSaturationCents}', 50000),
                       pc.potential_annual_cents / 4.0 * public.cfg_num(v_su, '{awareness,marketingHalfSaturationShare}', 0.1));
    v_gain := public.cfg_num(v_su, '{awareness,marketingMaxGain}', 0.12) * v_mk / (v_mk + v_half);
  end if;
  v_aw := least(1, greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
            pc.awareness
            + public.cfg_num(v_su, '{awareness,growthPerQuarter}', 0.3) * pc.awareness * (1 - pc.awareness) * (0.5 + v_quality)
            + v_gain
            - public.cfg_num(v_su, '{awareness,decayPerQuarter}', 0.03) * pc.awareness));

  v_demand := v_qpot * v_aw * (0.5 + 0.5 * v_quality) * exp(public.cfg_num(v_su, '{demandNoise}', 0.1) * public.gauss_random());
  v_cap := (v_team ->> 'team_productivity_bps')::double precision / 10000.0
         * public.cfg_num(v_su, array['capacityCentsPerProductivity', c.sector_key], 250000);
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
  create temporary table if not exists pg_temp.nexa_bonus (job_id uuid, player_id uuid, bonus bigint) on commit drop;
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

-- COMPANY adds pay_factor_bps, distress_quarters, grace_quarters; last_quarter adds bonus_cents
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
  if pc.tier = 'garage' then
    v_cost := greatest(0, (v_sb ->> 'foundingCostCents')::bigint
                          - round((v_tier ->> 'foundingCostCents')::bigint
                                  * public.config_double('startups', '{upgradeCreditShare}', 1))::bigint);
  end if;
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'idea', pc.idea,
    'sector', c.sector_key,
    'color', c.brand_color,
    'tier', pc.tier,
    'founded_at', c.founded_at,
    'cash_cents', v_cash,
    'value_cents', public.company_value_cents(p_company),
    'unpaid_cents', pc.unpaid_cents,
    'distress', pc.distress,
    'distress_quarters', pc.distress_quarters,
    'grace_quarters', public.config_double('startups', '{insolvency,graceQuarters}', 4)::integer,
    'pay_factor_bps', pc.pay_factor_bps,
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
    'can_upgrade', pc.tier = 'garage' and coalesce(v_level, 1) >= (v_sb ->> 'minLevel')::integer,
    'upgrade_cost_cents', v_cost,
    'last_quarter', v_last,
    'history', v_hist);
end;
$$;

create or replace function public.get_my_company()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
begin
  return jsonb_build_object(
    'company', (select public.company_state(pc.company_id) from public.player_companies pc
                 where pc.founder_id = v_player and pc.status = 'active'),
    'last_dissolution', (select jsonb_build_object('company_name', d.company_name, 'reason', d.reason, 'at', d.created_at,
                                                   'total_debt_cents', d.total_debt_cents, 'from_founder_cents', d.from_founder_cents,
                                                   'loan_cents', d.loan_cents)
                           from public.company_dissolutions d
                          where d.founder_id = v_player and d.created_at > now() - interval '7 days'
                          order by d.created_at desc limit 1));
end;
$$;

create or replace function public.require_own_company()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_company uuid;
begin
  select pc.company_id into v_company from public.player_companies pc where pc.founder_id = v_player and pc.status = 'active';
  if v_company is null then
    perform public.api_error('company_not_found');
  end if;
  return v_company;
end;
$$;

create or replace function public.player_company_value_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.company_value_cents(pc.company_id) from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active'), 0)::bigint;
$$;

-- found_company as in M3c plus the founding lockout after an insolvency
create or replace function public.found_company(p_request_id uuid, p_name text, p_idea text, p_sector text, p_color text,
                                                p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_idea   text := btrim(coalesce(p_idea, ''));
  v_reason text;
  v_tier   jsonb;
  v_level  integer;
  v_cost   bigint;
  v_cash   bigint;
  v_id     uuid := gen_random_uuid();
  v_acc    uuid;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'found_company');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  if coalesce(p_tier, '') not in ('garage', 'small_business')
     or not exists (select 1 from public.sectors s where s.key = p_sector)
     or public.config_jsonb('startups', array['capacityCentsPerProductivity', p_sector]) is null
     or coalesce(p_color, '') !~ '^#[0-9a-fA-F]{6}$'
     or char_length(v_idea) not between 1 and 120 then
    perform public.api_error('invalid_argument');
  end if;
  if public.text_has_profanity(v_idea) then
    perform public.api_error('name_profanity');
  end if;
  perform 1 from public.profiles p where p.id = v_player for update;
  if exists (select 1 from public.player_companies pc where pc.founder_id = v_player and pc.status = 'active') then
    perform public.api_error('company_exists');
  end if;
  if exists (select 1 from public.profiles p where p.id = v_player and p.founding_locked_until > now()) then
    perform public.api_error('founding_locked');
  end if;
  if exists (select 1 from public.player_jobs j where j.player_id = v_player and j.status = 'active') then
    perform public.api_error('job_active_exists');
  end if;
  v_reason := public.name_violation(p_name, 'company');
  if v_reason is not null then
    perform public.api_error(v_reason);
  end if;
  v_tier := public.company_tier_cfg(p_tier);
  select p.level into v_level from public.profiles p where p.id = v_player;
  if v_level < (v_tier ->> 'minLevel')::integer then
    perform public.api_error('company_level_too_low');
  end if;
  v_cost := (v_tier ->> 'foundingCostCents')::bigint;
  perform public.lock_player_accounts(v_player);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;

  insert into public.companies (id, name, slug, description, sector_key, is_ai, legal_form, phase, founder_id, ceo_id,
                                brand_color, shares_outstanding, max_employees, founded_quarter_id, founded_at)
  values (v_id, p_name, trim(both '-' from lower(regexp_replace(p_name, '[^A-Za-z0-9]+', '-', 'g'))) || '-' || left(v_id::text, 8),
          v_idea, p_sector, false, 'small_business', 'private', v_player, v_player, lower(p_color), 1,
          (v_tier ->> 'maxEmployees')::integer, (public.current_game_quarter()).id, now());
  insert into public.ledger_accounts (kind, owner_company_id, label) values ('company_cash', v_id, 'Firmenkasse')
  returning id into v_acc;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), v_acc, v_cost, 'company_founding',
                                   'Gründung ' || p_name, 'company', v_id, 'found:' || v_id::text, v_player);
  end if;
  insert into public.player_companies (company_id, founder_id, idea, tier, potential_annual_cents, awareness, quality, request_id)
  values (v_id, v_player, v_idea, p_tier, public.startup_potential_from_uniform(1 - random()),
          public.config_double('startups', '{awareness,initial}', 0.03), public.config_double('startups', '{quality,base}', 0.25),
          p_request_id);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_id)));
end;
$$;

create or replace function public.company_withdraw(p_request_id uuid, p_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  v_free    bigint;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_amount_cents is null or p_amount_cents < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'company_withdraw');
  if v_replay is not null then
    return v_replay;
  end if;
  perform 1 from public.player_companies pc where pc.company_id = v_company for update;
  select a.balance_cents - pc.unpaid_cents into v_free
    from public.ledger_accounts a join public.player_companies pc on pc.company_id = a.owner_company_id
   where a.owner_company_id = v_company and a.kind = 'company_cash';
  if coalesce(v_free, 0) < p_amount_cents then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.company_cash_account(v_company), public.ledger_player_account(v_player, 'player_cash'),
                                 p_amount_cents, 'transfer', 'Entnahme', 'company', v_company,
                                 'withdraw:' || p_request_id::text, v_player);
  perform public.loan_withhold(v_player, p_amount_cents, 'withdraw:' || p_request_id::text);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

create or replace function public.player_companies_close_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  q   record;
  v_n integer := 0;
begin
  for r in
    select pc.company_id, c.founded_at,
           (select gq.ends_at from public.game_quarters gq where gq.id = pc.last_closed_quarter_id) as last_end
      from public.player_companies pc join public.companies c on c.id = pc.company_id
     where pc.status = 'active'
     order by pc.company_id
  loop
    for q in
      select gq.id from public.game_quarters gq
       where gq.status = 'closed' and gq.ends_at > coalesce(r.last_end, r.founded_at)
       order by gq.ends_at limit 8
    loop
      exit when not exists (select 1 from public.player_companies x where x.company_id = r.company_id and x.status = 'active');
      if (public.player_company_close_quarter(r.company_id, q.id) ->> 'skipped') is null then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$$;

create or replace function public.sign_contract(p_request_id uuid, p_application_id uuid, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  a        public.job_applications;
  p        public.job_postings;
  v_scores jsonb;
begin
  v_player := public.require_player();
  if p_request_id is null or p_signature is null or char_length(p_signature) < 1 or char_length(p_signature) > 8000 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'sign_contract');
  if v_replay is not null then
    return v_replay;
  end if;
  perform 1 from public.profiles pr where pr.id = v_player for update;
  select * into a from public.job_applications where id = p_application_id and player_id = v_player for update;
  if a.id is null then
    perform public.api_error('application_not_found');
  end if;
  if a.status <> 'offered' then
    perform public.api_error('application_not_offered');
  end if;
  if a.offer_expires_at <= now() then
    perform public.api_error('offer_expired');
  end if;
  if exists (select 1 from public.player_jobs j where j.player_id = v_player and j.status = 'active') then
    perform public.api_error('job_active_exists');
  end if;
  if exists (select 1 from public.player_companies pc where pc.founder_id = v_player and pc.status = 'active') then
    perform public.api_error('owns_company');
  end if;
  select * into p from public.job_postings where id = a.posting_id;
  -- player companies: players with an active job there + AI workers <= max employees of the tier
  if exists (select 1 from public.player_companies pc where pc.company_id = p.company_id and pc.status = 'active'
                and (select count(*) from public.player_jobs j where j.company_id = pc.company_id and j.status = 'active')
                    + pc.ai_workers + 1 > (public.company_tier_cfg(pc.tier) ->> 'maxEmployees')::integer) then
    perform public.api_error('employee_limit');
  end if;
  if p.slots is not null
     and (select count(*) from public.player_jobs j where j.posting_id = p.id and j.status = 'active') >= p.slots then
    perform public.api_error('job_not_found');
  end if;
  v_scores := public.player_branch_scores(v_player);
  insert into public.player_jobs (player_id, company_id, request_id, tier, title, title_key, required, salary_cents_per_hour,
                                  ceiling_cents_per_hour, raise_base_score, posting_id, application_id, signature,
                                  last_paid_at, started_at, paid_day, paid_minutes_today)
  values (v_player, p.company_id, p_request_id, p.tier, coalesce(p.title, p.title_key), p.title_key, p.required,
          a.offer_salary_cents_per_hour,
          case when p.is_ai then public.ai_salary_ceiling(p.salary_cents_per_hour, public.job_match_score(v_scores, p.required)) end,
          public.job_match_score(v_scores, p.required), p.id, a.id, p_signature,
          public.game_now(), public.game_now(), (public.game_now() at time zone 'Europe/Berlin')::date, 0);
  update public.job_applications set status = 'signed', signature = p_signature where id = a.id;
  update public.job_applications set status = 'closed'
   where player_id = v_player and id <> a.id and status in ('pending', 'offered');
  perform public.company_system_message(p.company_id,
    (select pr.nickname from public.profiles pr where pr.id = v_player) || ' ist jetzt im Team.');
  return public.request_complete(v_player, p_request_id, public.job_state(v_player));
end;
$$;

create or replace function public.get_player_card(p_nickname text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p      public.profiles;
  v_job  jsonb;
begin
  perform public.require_player();
  select * into p from public.profiles x where lower(x.nickname) = lower(btrim(coalesce(p_nickname, ''))) and not x.is_deactivated;
  if p.id is null then
    perform public.api_error('player_not_found');
  end if;
  select jsonb_build_object('company_name', c.name, 'title_key', j.title_key, 'title', case when j.title_key is null then j.title end,
                            'tier', j.tier, 'since', j.started_at)
    into v_job
    from public.player_jobs j join public.companies c on c.id = j.company_id
   where j.player_id = p.id and j.status = 'active';
  return jsonb_build_object(
    'nickname',        p.nickname,
    'avatar_key',      p.avatar_key,
    'level',           p.level,
    'rank',            public.player_rich_rank(p.id),
    'net_worth_cents', public.player_net_worth_cents(p.id),
    'streak_days',     public.player_streak_days(p.id),
    'skills_learned',  (select count(*) from public.player_skills s where s.player_id = p.id)::integer,
    'branch_scores',   public.player_branch_scores(p.id),
    'top_skills',      coalesce((select jsonb_agg(jsonb_build_object('key', x.skill_key, 'tier', x.tier) order by x.tier desc, x.learned_at)
                                   from (select s.skill_key, s.learned_at, (public.skill_node(s.skill_key) ->> 'tier')::integer as tier
                                           from public.player_skills s where s.player_id = p.id
                                          order by 3 desc nulls last, s.learned_at limit 3) x), '[]'::jsonb),
    'job',             v_job,
    'company',         (select jsonb_build_object('name', c.name, 'ticker', c.ticker)
                          from public.player_companies pc join public.companies c on c.id = pc.company_id
                         where pc.founder_id = p.id and pc.status = 'active'),
    'member_since',    p.created_at);
end;
$$;

-- get_my_portfolio plus debt_cents, debt_withholding_bps, founding_locked_until
create or replace function public.get_my_portfolio()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player    uuid;
  v_cash      bigint;
  v_reserved  bigint;
  v_positions jsonb;
  v_value     bigint;
  v_bid_value bigint;
  v_orders    jsonb;
  v_trades    jsonb;
  v_prof      public.profiles;
  v_priv      public.player_private;
  v_level     jsonb;
  v_days      double precision := public.config_double('names', '{nicknameChangeDays}', 60);
  v_today     date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_streak    integer;
  ls          public.login_streaks;
begin
  v_player := public.require_player();
  select coalesce(sum(a.balance_cents) filter (where a.kind = 'player_cash'), 0),
         coalesce(sum(a.balance_cents) filter (where a.kind = 'player_reserve'), 0)
    into v_cash, v_reserved
    from public.ledger_accounts a where a.owner_player_id = v_player;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ticker', x.ticker, 'name', x.name, 'kind', x.kind, 'quantity_e6', x.quantity_e6,
           'reserved_quantity_e6', x.reserved_quantity_e6, 'avg_price_e4', x.avg_entry_price_e4,
           'last_price_e4', x.last_price_e4, 'market_value_cents', x.mv, 'cost_basis_cents', x.cost_basis_cents,
           'unrealized_pnl_cents', x.mv - x.cost_basis_cents, 'realized_pnl_cents', x.realized_pnl_cents,
           'change_bps', x.change_bps, 'opened_at', x.opened_at)
           order by x.mv desc), '[]'::jsonb),
         coalesce(sum(x.mv), 0)::bigint,
         coalesce(sum(x.bv), 0)::bigint
    into v_positions, v_value, v_bid_value
    from (select s.ticker, s.name, s.kind, p.quantity_e6, p.reserved_quantity_e6, p.avg_entry_price_e4, p.cost_basis_cents,
                 p.realized_pnl_cents, p.opened_at, q.last_price_e4, q.change_bps,
                 public.value_cents(p.quantity_e6, q.last_price_e4) as mv,
                 public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)) as bv
            from public.positions p
            join public.securities s on s.id = p.security_id
            join public.security_quotes q on q.security_id = p.security_id
           where p.player_id = v_player and p.status = 'open' and p.quantity_e6 > 0) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'ticker', s.ticker, 'side', o.side, 'type', o.type, 'quantity_e6', o.quantity_e6,
           'filled_quantity_e6', o.filled_quantity_e6, 'limit_price_e4', o.limit_price_e4, 'status', o.status,
           'reserved_cents', o.reserved_cents, 'created_at', o.created_at)
           order by o.created_at desc), '[]'::jsonb)
    into v_orders
    from public.orders o join public.securities s on s.id = o.security_id
   where o.player_id = v_player and o.status in ('open', 'partially_filled');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'ticker', t.ticker, 'side', t.side, 'quantity_e6', t.quantity_e6, 'price_e4', t.price_e4,
           'gross_cents', t.gross_cents, 'fee_cents', t.fee_cents, 'tax_cents', t.tax_cents,
           'realized_pnl_cents', t.realized_pnl_cents, 'xp_awarded', t.xp_awarded, 'executed_at', t.executed_at)
           order by t.executed_at desc), '[]'::jsonb)
    into v_trades
    from (select tr.*, s.ticker from public.trades tr join public.securities s on s.id = tr.security_id
           where tr.player_id = v_player order by tr.executed_at desc limit 50) t;

  select * into v_prof from public.profiles where id = v_player;
  select * into v_priv from public.player_private where player_id = v_player;
  select * into ls from public.login_streaks where player_id = v_player;
  v_level := public.level_progress(v_prof.xp_total);
  v_streak := case when ls.last_login_day >= v_today - 1 then ls.current_streak
                   when ls.last_login_day = v_today - 2 and ls.freeze_tokens > 0 then ls.current_streak
                   else 0 end;

  return jsonb_build_object(
    'cash_cents',            v_cash,
    'reserved_cents',        v_reserved,
    'positions_value_cents', v_value,
    'total_cents',           v_cash + v_reserved + v_value,
    'net_worth_cents',       v_cash + v_reserved + v_bid_value,
    'loss_pot_cents',        coalesce(v_priv.tax_loss_pot_cents, 0),
    'vault',                 public.vault_status(v_player) - 'accrued_seconds' - 'base_rate_cents_per_hour',
    'positions',             v_positions,
    'open_orders',           v_orders,
    'recent_trades',         v_trades,
    'level',                 v_prof.level,
    'xp_total',              v_prof.xp_total,
    'xp_into_level',         (v_level ->> 'xp_into_level')::bigint,
    'xp_for_next',           (v_level ->> 'xp_for_next')::bigint,
    'tutorial_completed',    v_priv.tutorial_completed_at is not null,
    'nickname',              v_prof.nickname,
    'nickname_change_available_at',
                             case when v_prof.nickname_changed_at is null
                                    or v_prof.nickname_changed_at + make_interval(secs => v_days * 86400) <= now() then null
                                  else v_prof.nickname_changed_at + make_interval(secs => v_days * 86400) end,
    'missions_claimable',    (select count(*) from public.player_missions m
                               where m.player_id = v_player and m.status = 'completed'
                                 and (m.expires_at is null or m.expires_at > public.game_now()))::integer,
    'streak_days',           coalesce(v_streak, 0),
    'avatar_key',            coalesce(v_prof.avatar_key, 'rookie'),
    'skill_points_free',     coalesce((select sp.free_points from public.player_skill_points sp where sp.player_id = v_player), 0),
    'daily_reward_claimable', not exists (select 1 from public.daily_reward_claims c
                                           where c.player_id = v_player
                                             and c.claim_day = (public.game_now() at time zone 'Europe/Berlin')::date),
    'company_value_cents',   public.player_company_value_cents(v_player),
    'debt_cents',            public.player_debt_cents(v_player),
    'debt_withholding_bps',  public.config_double('startups', '{insolvency,loanWithholdingBps}', 5000)::integer,
    'founding_locked_until', case when v_prof.founding_locked_until > now() then v_prof.founding_locked_until end,
    'server_time',           public.game_now());
end;
$$;

-- net worth subtracts the open forced loans
create or replace function public.rich_list_entries()
returns table (entity_kind text, entity_id uuid, name text, description text, net_worth_cents bigint, rank_all integer, rank_players integer)
language sql
stable
security definer
set search_path = ''
as $$
  with players as (
    select p.id,
           coalesce(a.cash, 0) + coalesce(v.val, 0) + coalesce(public.company_value_cents(pc.company_id), 0)
             - coalesce(d.debt, 0) as nw,
           p.nickname
      from public.profiles p
      left join (select owner_player_id, sum(balance_cents)::bigint as cash from public.ledger_accounts
                  where owner_player_id is not null group by owner_player_id) a on a.owner_player_id = p.id
      left join (select pos.player_id, sum(public.value_cents(pos.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))::bigint as val
                   from public.positions pos join public.security_quotes q on q.security_id = pos.security_id
                  where pos.status = 'open' and pos.quantity_e6 > 0 group by pos.player_id) v on v.player_id = p.id
      left join public.player_companies pc on pc.founder_id = p.id and pc.status = 'active'
      left join (select l.player_id, sum(l.outstanding_cents)::bigint as debt from public.player_loans l
                  where l.status = 'open' group by l.player_id) d on d.player_id = p.id
     where not p.is_deactivated
  ), tycoons as (
    select t.id, t.name, t.description,
           t.cash_cents + coalesce(sum(public.value_cents(h.quantity_e6, coalesce(q.bid_e4, q.last_price_e4))), 0)::bigint as nw
      from public.rich_tycoons t
      left join public.rich_tycoon_holdings h on h.tycoon_id = t.id
      left join public.security_quotes q on q.security_id = h.security_id
     group by t.id
  ), allx as (
    select 'player'::text as entity_kind, id as entity_id, nickname as name, null::text as description, nw from players
    union all
    select 'tycoon', id, name, description, nw from tycoons
  )
  select x.entity_kind, x.entity_id, x.name, x.description, x.nw,
         (row_number() over (order by x.nw desc, x.entity_kind, x.entity_id))::integer,
         case when x.entity_kind = 'player'
              then (row_number() over (partition by x.entity_kind order by x.nw desc, x.entity_id))::integer end
    from allx x;
$$;

create or replace function public.player_net_worth_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(a.balance_cents) from public.ledger_accounts a where a.owner_player_id = p_player), 0)::bigint
       + coalesce((select sum(public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))
                     from public.positions p join public.security_quotes q on q.security_id = p.security_id
                    where p.player_id = p_player and p.status = 'open' and p.quantity_e6 > 0), 0)::bigint
       -- founder's player company (ADR-057): cash - unpaid + earnings value
       + public.player_company_value_cents(p_player)
       - public.player_debt_cents(p_player);
$$;

-- execute_fill as in M3c; sell proceeds are subject to loan withholding
create or replace function public.execute_fill(
  p_order_id    uuid,
  p_quantity bigint,
  p_price_e4    bigint,
  p_resting     boolean default false,
  p_system      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o            public.orders;
  s            public.securities;
  v_trading    jsonb := coalesce(public.config_jsonb('trading'), '{}'::jsonb);
  v_prog       jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_now        timestamptz := public.game_now();
  v_cash       uuid;
  v_reserve    uuid;
  v_counter    uuid;
  v_treasury   uuid;
  v_counter_ok boolean;
  v_counter_bal bigint;
  v_gross      bigint;
  v_fee        bigint := 0;
  v_tax        bigint := 0;
  v_pnl        bigint;
  v_cost       bigint := 0;
  v_release    bigint := 0;
  v_cash_delta bigint;
  v_balance    bigint;
  v_pos        public.positions;
  v_basis_new  bigint;
  v_avg_new    bigint;
  v_trade_id   uuid := gen_random_uuid();
  v_tx         uuid;
  v_xp         integer := 0;
  v_wash       boolean := false;
  v_first      boolean;
  v_pot        bigint;
  v_offset     bigint;
  v_left       bigint;
  v_take       bigint;
  v_entries    jsonb;
  v_tick_seq   bigint;
  v_year       integer;
  lot          record;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % does not exist', p_order_id using errcode = 'NX007';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > o.quantity_e6 - o.filled_quantity_e6 then
    raise exception 'invalid fill quantity % for order %', p_quantity, p_order_id using errcode = 'NX007';
  end if;
  if p_price_e4 is null or p_price_e4 <= 0 then
    raise exception 'invalid fill price %', p_price_e4 using errcode = 'NX007';
  end if;
  select * into s from public.securities where id = o.security_id;
  v_first := o.filled_quantity_e6 = 0;

  v_gross := public.value_cents(p_quantity, p_price_e4);
  if o.fee_cents = 0 and not p_system then
    v_fee := greatest(0, public.cfg_num(v_trading, '{orderFeeCents}', 100))::bigint;
  end if;
  v_cash     := public.ledger_player_account(o.player_id, 'player_cash');
  v_reserve  := public.ledger_player_account(o.player_id, 'player_reserve');
  v_treasury := public.ledger_system_account('treasury');
  v_counter  := case when s.kind = 'bond' then v_treasury else public.ledger_system_account('market') end;
  select a.balance_cents into v_balance from public.ledger_accounts a where a.id = v_cash;
  select a.balance_cents, a.allow_negative into v_counter_bal, v_counter_ok from public.ledger_accounts a where a.id = v_counter;

  select * into v_pos
    from public.positions p
   where p.player_id = o.player_id and p.security_id = o.security_id
     and p.side = 'long' and p.leverage = 1 and p.status = 'open'
     for update;

  if o.side = 'buy' then
    if p_resting then
      v_release := o.reserved_cents;
    end if;
    v_cash_delta := v_release - v_gross - v_fee;
    if v_balance + v_cash_delta < 0 then
      perform public.api_error('insufficient_funds');
    end if;
    if v_pos.id is null then
      insert into public.positions (player_id, security_id, quantity_e6, avg_entry_price_e4, cost_basis_cents, opened_at)
      values (o.player_id, o.security_id, 0, p_price_e4, 0, v_now)
      returning * into v_pos;
    end if;
  else
    if v_pos.id is null
       or v_pos.quantity_e6 < p_quantity
       or (not p_resting and v_pos.quantity_e6 - v_pos.reserved_quantity_e6 < p_quantity)
       or (p_resting and v_pos.reserved_quantity_e6 < p_quantity) then
      perform public.api_error('insufficient_position');
    end if;
    -- the financial market (or the treasury for bonds) must be able to pay
    v_counter_bal := v_counter_bal - v_gross;
    if v_counter = v_treasury then
      v_counter_bal := v_counter_bal + v_fee;
    end if;
    if not v_counter_ok and v_counter_bal < 0 then
      perform public.api_error('market_illiquid');
    end if;
    v_left := p_quantity;
    for lot in
      select l.id, l.quantity_open_e6
        from public.position_lots l
       where l.position_id = v_pos.id and l.quantity_open_e6 > 0
       order by l.acquired_at, l.id
         for update
    loop
      exit when v_left = 0;
      v_take := least(v_left, lot.quantity_open_e6);
      update public.position_lots
         set quantity_open_e6 = quantity_open_e6 - v_take,
             closed_at = case when quantity_open_e6 - v_take = 0 then v_now else closed_at end
       where id = lot.id;
      v_left := v_left - v_take;
    end loop;
    select coalesce(sum(public.value_cents(l.quantity_open_e6, l.price_e4)), 0)::bigint
      into v_basis_new
      from public.position_lots l where l.position_id = v_pos.id and l.quantity_open_e6 > 0;
    v_cost := v_pos.cost_basis_cents - v_basis_new;
    if v_left > 0 then
      v_cost := v_cost + public.value_cents(v_left, v_pos.avg_entry_price_e4);
    end if;
    v_cost := greatest(v_cost, 0);

    v_pnl := v_gross - v_fee - v_cost;
    select pp.tax_loss_pot_cents into v_pot
      from public.player_private pp where pp.player_id = o.player_id for update;
    v_pot := coalesce(v_pot, 0);
    if v_pnl <= 0 then
      v_pot := v_pot - v_pnl;
    else
      v_offset := least(v_pnl, v_pot);
      v_tax := public.apply_bps(v_pnl - v_offset, public.cfg_num(v_trading, '{capitalGainsTaxBps}', 2500)::numeric);
      v_pot := v_pot - v_offset;
    end if;
    update public.player_private set tax_loss_pot_cents = v_pot where player_id = o.player_id;

    v_cash_delta := v_gross - v_fee - v_tax;
    if v_balance + v_cash_delta < 0 then
      perform public.api_error('insufficient_funds');
    end if;
    v_wash := exists (
      select 1 from public.trades t
       where t.player_id = o.player_id and t.security_id = o.security_id and t.side = 'buy'
         and t.executed_at > v_now - make_interval(secs => public.cfg_num(v_trading, '{washTradeWindowSeconds}', 600)));
  end if;

  -- ledger: one balanced transaction per fill (entries on the same account merged)
  select coalesce(jsonb_agg(jsonb_build_object('account_id', x.account_id, 'amount_cents', x.amount)), '[]'::jsonb)
    into v_entries
    from (select e.account_id, sum(e.amount)::bigint as amount
            from (values
              (v_cash,     v_cash_delta),
              (v_reserve,  -v_release),
              (v_counter,  case when o.side = 'buy' then v_gross else -v_gross end),
              (v_treasury, v_fee + v_tax)
            ) as e(account_id, amount)
           group by e.account_id
          having sum(e.amount) <> 0) x;
  if jsonb_array_length(v_entries) >= 2 then
    v_tx := public.ledger_post(
      case when p_system then 'bond_redemption'::public.ledger_tx_kind
           when o.side = 'buy' then 'trade_buy'::public.ledger_tx_kind
           else 'trade_sell'::public.ledger_tx_kind end,
      v_entries,
      case when o.side = 'buy' then 'Kauf ' else 'Verkauf ' end || s.ticker,
      'order', o.id, 'fill:' || v_trade_id::text, o.player_id,
      jsonb_build_object('quantity_e6', p_quantity, 'price_e4', p_price_e4, 'trade_id', v_trade_id));
  end if;
  -- forced loan: part of the net sell proceeds repays it (ADR-052)
  if o.side = 'sell' and v_cash_delta > 0 then
    perform public.loan_withhold(o.player_id, v_cash_delta, 'fill:' || v_trade_id::text);
  end if;

  -- XP: one trade XP per order, not below progression.xpSources.trade.minOrderValueCents,
  -- not for closing a position opened inside the wash-trade window
  if not p_system and not v_wash
     and v_gross >= public.cfg_num(v_prog, '{xpSources,trade,minOrderValueCents}', 10000) then
    v_xp := public.grant_xp(o.player_id, 'trade', public.cfg_num(v_prog, '{xpSources,trade,xp}', 10)::integer,
                            'trade:' || o.id::text, 'trade', v_trade_id);
  end if;

  select r.tick_seq into v_tick_seq from public.sim_runtime r where r.id;
  insert into public.trades (
    id, order_id, player_id, security_id, position_id, side, quantity_e6, price_e4, gross_cents, fee_cents,
    tax_cents, realized_pnl_cents, counterparty, ledger_transaction_id, tick_seq, is_wash_trade, xp_awarded, executed_at)
  values (
    v_trade_id, o.id, o.player_id, o.security_id, v_pos.id, o.side, p_quantity, p_price_e4, v_gross, v_fee,
    v_tax, case when o.side = 'sell' then v_pnl end,
    case when p_system then 'issuer'::public.trade_counterparty else 'market_maker'::public.trade_counterparty end,
    v_tx, v_tick_seq, v_wash, v_xp, v_now);

  if o.side = 'buy' then
    insert into public.position_lots (position_id, player_id, security_id, trade_id, quantity_initial_e6, quantity_open_e6, price_e4, acquired_at)
    values (v_pos.id, o.player_id, o.security_id, v_trade_id, p_quantity, p_quantity, p_price_e4, v_now);
    select coalesce(sum(public.value_cents(l.quantity_open_e6, l.price_e4)), 0)::bigint,
           coalesce(public.div_round_half_even(sum(l.quantity_open_e6::numeric * l.price_e4), sum(l.quantity_open_e6)), p_price_e4)
      into v_basis_new, v_avg_new
      from public.position_lots l where l.position_id = v_pos.id and l.quantity_open_e6 > 0;
    update public.positions
       set quantity_e6 = quantity_e6 + p_quantity, cost_basis_cents = v_basis_new, avg_entry_price_e4 = v_avg_new
     where id = v_pos.id;
  else
    select coalesce(public.div_round_half_even(sum(l.quantity_open_e6::numeric * l.price_e4), sum(l.quantity_open_e6)), 0)
      into v_avg_new
      from public.position_lots l where l.position_id = v_pos.id and l.quantity_open_e6 > 0;
    update public.positions
       set quantity_e6 = quantity_e6 - p_quantity,
           reserved_quantity_e6 = case when p_resting then reserved_quantity_e6 - p_quantity else reserved_quantity_e6 end,
           cost_basis_cents = v_basis_new,
           avg_entry_price_e4 = case when quantity_e6 - p_quantity = 0 then avg_entry_price_e4 else v_avg_new end,
           realized_pnl_cents = realized_pnl_cents + v_pnl,
           status = case when quantity_e6 - p_quantity = 0 then 'closed'::public.position_status else status end,
           closed_at = case when quantity_e6 - p_quantity = 0 then v_now else closed_at end
     where id = v_pos.id;

    v_year := coalesce((select q.game_year from public.current_game_quarter() q), 0);
    insert into public.player_tax_years as t (player_id, game_year, realized_gains_cents, realized_losses_cents, tax_paid_cents)
    values (o.player_id, v_year, greatest(v_pnl, 0), greatest(-v_pnl, 0), v_tax)
    on conflict (player_id, game_year) do update
      set realized_gains_cents  = t.realized_gains_cents + excluded.realized_gains_cents,
          realized_losses_cents = t.realized_losses_cents + excluded.realized_losses_cents,
          tax_paid_cents        = t.tax_paid_cents + excluded.tax_paid_cents,
          updated_at            = now();
  end if;

  update public.orders
     set filled_quantity_e6   = filled_quantity_e6 + p_quantity,
         avg_fill_price_e4    = public.div_round_half_even(
                                  coalesce(avg_fill_price_e4, 0)::numeric * filled_quantity_e6 + p_price_e4::numeric * p_quantity,
                                  filled_quantity_e6 + p_quantity),
         fee_cents            = fee_cents + v_fee,
         reserved_cents       = case when p_resting and side = 'buy' then 0 else reserved_cents end,
         reserved_quantity_e6 = case when p_resting and side = 'sell' then reserved_quantity_e6 - p_quantity else reserved_quantity_e6 end,
         status               = case when filled_quantity_e6 + p_quantity >= quantity_e6 then 'filled'::public.order_status
                                     else 'partially_filled'::public.order_status end,
         filled_at            = case when filled_quantity_e6 + p_quantity >= quantity_e6 then v_now else filled_at end
   where id = o.id;

  update public.security_quotes
     set day_volume_e6 = day_volume_e6 + p_quantity, day_turnover_cents = day_turnover_cents + v_gross
   where security_id = o.security_id;
  if not p_system then
    update public.security_sim_state
       set pending_player_flow_e6 = pending_player_flow_e6 + case when o.side = 'buy' then p_quantity else -p_quantity end,
           pending_player_volume_e6 = pending_player_volume_e6 + p_quantity
     where security_id = o.security_id;

    -- missions
    if v_first then
      perform public.mission_event(o.player_id, 'trade', 1, null);
      perform public.mission_event(o.player_id, case when o.side = 'buy' then 'buy' else 'sell' end, 1, null);
    end if;
    perform public.mission_event(o.player_id, 'trade_value', v_gross, null);
    perform public.mission_event(o.player_id, 'trading_day', 1, to_char(v_now at time zone 'Europe/Berlin', 'YYYY-MM-DD'));
    perform public.mission_event(o.player_id, 'distinct_security', 1, s.ticker);
    if o.side = 'buy' then
      perform public.mission_event(o.player_id, 'buy_value', v_gross, null);
      if s.kind = 'bond' then
        perform public.mission_event(o.player_id, 'bond_bought', 1, null);
      elsif s.sector_key is not null then
        perform public.mission_event(o.player_id, 'buy_sector', 1, s.sector_key);
        perform public.mission_event(o.player_id, 'sectors_bought', 1, s.sector_key);
      end if;
    elsif v_pnl > 0 then
      perform public.mission_event(o.player_id, 'realized_profit', v_pnl, null);
    end if;
  end if;

  return jsonb_build_object(
    'trade_id', v_trade_id, 'quantity_e6', p_quantity, 'price_e4', p_price_e4, 'gross_cents', v_gross,
    'fee_cents', v_fee, 'tax_cents', v_tax, 'realized_pnl_cents', case when o.side = 'sell' then v_pnl end,
    'xp_awarded', v_xp, 'wash_trade', v_wash);
end;
$$;

create or replace function public.claim_vault(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  v_status  jsonb;
  v_amount  bigint;
  v_now     timestamptz := public.game_now();
  v_tx      uuid;
  v_total   integer;
  v_counted integer;
  v_hours   double precision := greatest(0, public.config_double('economy', '{vaultCapHours}', 8));
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'claim_vault');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  perform public.lock_player_accounts(v_player);
  perform 1 from public.vaults where player_id = v_player for update;
  v_status := public.vault_status(v_player);
  v_amount := coalesce((v_status ->> 'accrued_cents')::bigint, 0);
  if v_amount < greatest(1, public.config_bigint('economy', '{vaultMinClaimCents}', 100)) then
    perform public.api_error('nothing_to_claim');
  end if;

  v_tx := public.state_payout(v_player, v_amount, 0, 'vault_claim', 'Grundeinkommen aus dem Tresor', 'vault', null,
                              'vault:' || v_player::text || ':' || p_request_id::text);
  perform public.loan_withhold(v_player, v_amount, 'vault:' || v_player::text || ':' || p_request_id::text);

  select greatest(0, floor(extract(epoch from (v_now - v.accrual_started_at))))::integer into v_total
    from public.vaults v where v.player_id = v_player;
  v_counted := (v_status ->> 'accrued_seconds')::integer;
  insert into public.vault_claims (player_id, request_id, amount_cents, accrued_seconds, forfeited_seconds, ledger_transaction_id)
  values (v_player, p_request_id, v_amount, v_counted, greatest(0, v_total - v_counted), v_tx)
  on conflict (player_id, request_id) do nothing;
  update public.vaults
     set accrual_started_at = v_now, last_claimed_at = v_now,
         total_claimed_cents = total_claimed_cents + v_amount, full_notified_at = null
   where player_id = v_player;
  perform public.mission_event(v_player, 'vault_claim', 1, null);

  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'claimed_cents', v_amount,
    'cash_cents',    (select a.balance_cents from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash'),
    'full_at',       v_now + make_interval(secs => v_hours * 3600),
    'factor_bps',    (v_status ->> 'factor_bps')::integer));
end;
$$;

create or replace function public.claim_daily_reward(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  v_today   date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_monday  date;
  v_next    jsonb;
  v_day     integer;
  v_cell    jsonb;
  v_old_lvl integer;
  v_xp      integer;
  v_cash    bigint := 0;
  v_sp      integer;
  v_streak  integer;
  v_freeze  boolean;
  ls        public.login_streaks;
  v_prof    public.profiles;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'claim_daily_reward');
  if v_replay is not null then
    return v_replay;
  end if;
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  perform public.lock_player_accounts(v_player);
  insert into public.login_streaks (player_id) values (v_player) on conflict do nothing;
  select * into ls from public.login_streaks where player_id = v_player for update;
  if exists (select 1 from public.daily_reward_claims c where c.player_id = v_player and c.claim_day = v_today) then
    perform public.api_error('daily_reward_claimed');
  end if;

  v_next := public.daily_reward_next(v_player);
  v_day := (v_next ->> 'day')::integer;
  v_freeze := (v_next ->> 'freeze_needed')::boolean;
  if ls.freeze_granted_week is null or ls.freeze_granted_week < v_monday then
    ls.freeze_tokens := public.config_double('dailyRewards', '{freezesPerWeek}', 1)::smallint;
    ls.freeze_granted_week := v_monday;
  end if;

  -- daily check-in: streak and mission event (once per day, shared with daily_check_in)
  if ls.last_login_day is distinct from v_today then
    if ls.last_login_day = v_today - 1 then
      v_streak := ls.current_streak + 1;
    elsif ls.last_login_day = v_today - 2 and (v_freeze or ls.freeze_tokens > 0) then
      v_streak := ls.current_streak + 1;
      v_freeze := true;
    else
      v_streak := 1;
    end if;
    insert into public.daily_logins (player_id, login_day, streak_day, xp_awarded, freeze_used)
    values (v_player, v_today, v_streak, 0, v_freeze)
    on conflict do nothing;
    perform public.mission_event(v_player, 'check_in', 1, v_today::text);
  else
    v_streak := ls.current_streak;
  end if;
  if v_freeze then
    ls.freeze_tokens := greatest(0, ls.freeze_tokens - 1);
  end if;
  update public.login_streaks
     set current_streak = v_streak, longest_streak = greatest(longest_streak, v_streak), last_login_day = v_today,
         freeze_tokens = ls.freeze_tokens, freeze_granted_week = ls.freeze_granted_week,
         reward_cycle_day = v_day, reward_last_day = v_today
   where player_id = v_player;

  -- rewards of the cycle day
  v_cell := coalesce(public.config_jsonb('dailyRewards', '{cycle}'), '[]'::jsonb) -> (v_day - 1);
  select p.level into v_old_lvl from public.profiles p where p.id = v_player;
  v_xp := public.grant_xp(v_player, 'daily_login', coalesce((v_cell ->> 'xp')::integer, 0),
                          'daily_reward:' || v_today::text, 'daily_reward', null);
  v_cash := public.state_pay_partial(v_player, coalesce((v_cell ->> 'cashCents')::bigint, 0), 'login_bonus',
                                     'Tägliche Belohnung, Tag ' || v_day, 'daily_reward:' || v_player::text || ':' || v_today::text);
  perform public.loan_withhold(v_player, v_cash, 'daily_reward:' || v_player::text || ':' || v_today::text);
  v_sp := greatest(0, coalesce((v_cell ->> 'skillPoints')::integer, 0));
  if v_sp > 0 then
    perform public.skill_points_ensure(v_player);
    update public.player_skill_points set free_points = free_points + v_sp where player_id = v_player;
  end if;
  insert into public.daily_reward_claims (player_id, claim_day, cycle_day, xp_awarded, cash_cents, skill_points, freeze_used)
  values (v_player, v_today, v_day, v_xp, v_cash, v_sp, v_freeze);

  select * into v_prof from public.profiles where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'day', v_day, 'xp', v_xp, 'cash_cents', v_cash, 'skill_points', v_sp, 'streak_days', v_streak,
    'level', v_prof.level, 'xp_total', v_prof.xp_total, 'leveled_up', v_prof.level > v_old_lvl,
    'freeze_used', v_freeze));
end;
$$;

create or replace function public.quit_job(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_cash   bigint;
  j        public.player_jobs;
  v_cost   bigint;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'quit_job');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.lock_player_accounts(v_player);
  select * into j from public.player_jobs where player_id = v_player and status = 'active' for update;
  if j.id is null then
    perform public.api_error('no_active_job');
  end if;
  perform public.accrue_job_salary(j.id);
  v_cost := public.job_salary_unit_cents(j);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if v_cash < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'),
                                 (select a.id from public.ledger_accounts a where a.owner_company_id = j.company_id and a.kind = 'company_cash'),
                                 v_cost, 'transfer', 'Kündigung: ein Gehalt an die Firma', 'player_job', j.id,
                                 'quit:' || j.id::text, v_player);
  update public.player_jobs set status = 'ended', ended_at = now(), end_reason = 'quit' where id = j.id;
  perform public.company_system_message(j.company_id,
    (select pr.nickname from public.profiles pr where pr.id = v_player) || ' hat gekündigt.');
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'paid_cents', v_cost,
    'cash_cents', (select a.balance_cents from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash')));
end;
$$;

create or replace function public.fire_employee(p_request_id uuid, p_player_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  j        public.player_jobs;
  v_cost   bigint;
  v_acc    uuid;
  v_bal    bigint;
begin
  select * into j from public.player_jobs where id = p_player_job_id;
  if j.id is null or j.status <> 'active' then
    perform public.require_player();
    perform public.api_error('no_active_job');
  end if;
  v_player := public.require_company_owner(j.company_id);
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'fire_employee');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.lock_player_accounts(j.player_id);
  perform public.accrue_job_salary(j.id);
  select * into j from public.player_jobs where id = p_player_job_id for update;
  v_cost := public.job_salary_unit_cents(j);
  select a.id, a.balance_cents into v_acc, v_bal from public.ledger_accounts a where a.owner_company_id = j.company_id and a.kind = 'company_cash';
  if coalesce(v_bal, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(v_acc, public.ledger_player_account(j.player_id, 'player_cash'), v_cost, 'salary',
                                 'Abfindung: ein Gehalt', 'player_job', j.id, 'severance:' || j.id::text, j.player_id);
  perform public.loan_withhold(j.player_id, v_cost, 'severance:' || j.id::text);
  update public.player_jobs set status = 'ended', ended_at = now(), end_reason = 'fired' where id = j.id;
  perform public.company_system_message(j.company_id,
    (select pr.nickname from public.profiles pr where pr.id = j.player_id) || ' wurde entlassen.');
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'player_job_id', j.id, 'status', 'fired', 'severance_cents', v_cost));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.player_debt_cents(uuid)', 'public.loan_withhold(uuid, bigint, text)', 'public.company_dissolve(uuid, text)',
    'public.close_company(uuid)', 'public.accrue_job_salary(uuid, timestamptz)', 'public.job_state(uuid)',
    'public.player_company_close_quarter(uuid, bigint)', 'public.company_state(uuid)', 'public.get_my_company()',
    'public.require_own_company()', 'public.player_company_value_cents(uuid)',
    'public.found_company(uuid, text, text, text, text, text)', 'public.company_withdraw(uuid, bigint)',
    'public.player_companies_close_due()', 'public.sign_contract(uuid, uuid, text)', 'public.get_player_card(text)',
    'public.get_my_portfolio()', 'public.rich_list_entries()', 'public.player_net_worth_cents(uuid)',
    'public.execute_fill(uuid, bigint, bigint, boolean, boolean)', 'public.claim_vault(uuid)', 'public.claim_daily_reward(uuid)',
    'public.quit_job(uuid)', 'public.fire_employee(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.close_company(uuid)', 'public.get_my_company()', 'public.found_company(uuid, text, text, text, text, text)',
    'public.company_withdraw(uuid, bigint)', 'public.sign_contract(uuid, uuid, text)', 'public.get_player_card(text)',
    'public.get_my_portfolio()', 'public.claim_vault(uuid)', 'public.claim_daily_reward(uuid)', 'public.quit_job(uuid)',
    'public.fire_employee(uuid, uuid)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
