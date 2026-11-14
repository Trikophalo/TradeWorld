-- =============================================================================
-- NEXA · 0400 · Crises and falling share prices cut wages (ADR-131)
-- =============================================================================
-- company_pay_mood_bps(company): 10 000 normally. An open or running crisis of a player company costs
-- wageMood.crisisPerSeverityBps per severity level, scandals (wageMood.scandals) wageMood.scandalBps more. A listed
-- company whose share fell today by more than shareFallFreeBps costs a share of the rest (shareFallShare, at most
-- maxShareBps). Never
-- below wageMood.minBps. accrue_job_salary() multiplies the wage with it, for player companies and AI employers; the
-- cut shows as player_jobs.pay_factor_bps ("Lohnfaktor").
-- Idempotent: runs unchanged as supabase/updates/20261204000400_wage_mood.sql.

create or replace function public.company_pay_mood_bps(p_company uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := coalesce((select value from public.game_config where key = 'wageMood'), '{}'::jsonb);
  v_crisis integer := 0;
  v_share  integer := 0;
  v_change integer;
begin
  if cfg = '{}'::jsonb then
    return 10000;
  end if;
  select coalesce(max(e.severity * (cfg ->> 'crisisPerSeverityBps')::integer
                      + case when cfg -> 'scandals' ? e.archetype then (cfg ->> 'scandalBps')::integer else 0 end), 0)
    into v_crisis
    from public.player_company_events e
   where e.company_id = p_company and e.polarity = 'crisis' and e.status in ('open', 'in_force');
  select q.change_bps into v_change
    from public.companies c
    join public.securities s on s.id = c.security_id and s.status = 'listed'
    join public.security_quotes q on q.security_id = s.id
   where c.id = p_company;
  -- small daily swings are normal: only the part of the fall beyond shareFallFreeBps counts
  if coalesce(v_change, 0) < -(cfg ->> 'shareFallFreeBps')::integer then
    v_share := least((cfg ->> 'maxShareBps')::integer,
                     round((-v_change - (cfg ->> 'shareFallFreeBps')::integer) * (cfg ->> 'shareFallShare')::numeric)::integer);
  end if;
  return greatest((cfg ->> 'minBps')::integer, 10000 - v_crisis - v_share);
end;
$$;
revoke all on function public.company_pay_mood_bps(uuid) from public, anon, authenticated;
comment on function public.company_pay_mood_bps(uuid) is
  'Internal (ADR-131): wage factor from crises, scandals and today''s share price fall, 10 000 = full wage.';

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
  v_pres    integer := 10000;
  v_hpp     double precision;
  v_nb      integer;
  v_share   integer;
  v_bwm     jsonb;
  v_base    bigint;
  v_bp      jsonb;
  v_before  integer;
  v_full    bigint;
  v_mood    integer := 10000;
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
  v_hpp := greatest(1, public.player_work_hours_per_branch_point(j.player_id));
  v_paid := case when j.paid_day = v_day then j.paid_minutes_today else 0 end;
  v_minutes := least(v_elapsed, greatest(0, (public.player_paid_hours_cap(j.player_id) * 60)::integer - v_paid));
  select c.is_ai into v_ai from public.companies c where c.id = j.company_id;

  if v_minutes > 0 then
    -- presence (ADR-103): the share of the wage for these minutes, from the hours the player had been away by then
    -- (10 000 while active); it lowers the wage, the XP and what a player company pays
    v_pres := public.presence_pay_bps_between(j.player_id, j.last_paid_at, v_minutes);
    v_base := j.salary_cents_per_hour * v_minutes * v_pres / 600000;
    -- player companies pay the contract wage x pay factor of the quarter (ADR-058)
    v_amount := v_base * coalesce((select pc.pay_factor_bps from public.player_companies pc
                                    where pc.company_id = j.company_id and pc.status = 'active'), 10000) / 10000;
    -- ADR-131: crises, scandals and a falling share price cut the wage
    v_full := v_amount;
    v_mood := public.company_pay_mood_bps(j.company_id);
    v_amount := v_amount * v_mood / 10000;
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
      -- mentor upgrade (ADR-100): work XP x workXpBps / 10 000; presence share as for the wage (ADR-103)
      v_xp := public.grant_xp(j.player_id, 'work_hour',
                              round(v_xph * v_hours * public.player_work_xp_bps(j.player_id) / 10000.0 * v_pres / 10000.0)::integer,
                              'work:' || j.id::text || ':' || ((j.experience_minutes + v_minutes) / 60), 'player_job', j.id);
    end if;
    insert into public.salary_payouts (player_job_id, player_id, pay_day, period_start, period_end, minutes_paid, amount_cents,
                                       xp_awarded, ledger_transaction_id, base_amount_cents)
    values (j.id, j.player_id, v_day, j.last_paid_at, v_now, v_minutes, v_pay, v_xp, v_tx, v_base);

    -- branch work minutes and branch points (work hours per point with the study upgrade)
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
         rank_minutes = least(2000000000::bigint, rank_minutes::bigint + v_minutes)::integer,
         earned_total_cents = earned_total_cents + v_pay,
         pay_factor_bps = case when v_minutes > 0 and v_full > 0 then (v_pay * 10000 / v_full)::integer else pay_factor_bps end
   where id = j.id;
  return v_pay;
end;
$$;

