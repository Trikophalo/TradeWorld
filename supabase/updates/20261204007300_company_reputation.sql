-- ===== idempotent copy of migrations/20261204007300_company_reputation.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 7300 · Reputation for every player company, an hourly close that never fails on its extras (ADR-183)
-- =============================================================================
-- * Before: only listed companies had a reputation (listed_companies.reputation, ADR-167), and its target moved only
--   with payouts, dividends, investments, research and scandals. A listed company without those sat at exactly 50
--   ("Ruf bewegt sich nicht"); private companies had none, although the dashboard spoke of it.
-- * Now: player_companies.reputation for every company (listed ones mirror listed_companies.reputation, which stays
--   the source for all listed rules). Each closed hour judges quality, delivery, price, wages, bills, crises and a
--   running campaign (company_reputation_drivers, port of reputationDrivers in src/lib/sim/company-reputation.ts);
--   listed companies add these to their shareholder target. The hour row keeps value, target and drivers.
-- * The reputation moves the demand of private companies too (listed_hour_effect, companyHealth.reputation).
-- * CEO interviews move the reputation of every company (company_interview_finish), tax penalties keep their
--   one-off drops (listed_reputation_bump now also updates the mirror).
-- * listed_hour_after runs every extra step (projects, quits and notices, fair value, missions, tax office, board,
--   reputation) in its own sub-block: an error there is logged in job_runs ('company_hour_step') and shown on the
--   dashboard, but never rolls back the company's hour again (one failing extra used to cost the whole hour: no
--   hours, no "Verlauf", every "bringt" 0 €, a frozen reputation).
-- All functions are full redefinitions (no text patches), so small differences of the live function text do not
-- matter. Idempotent: runs unchanged as supabase/updates/20261204007300_company_reputation.sql.

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.player_companies add column if not exists reputation double precision not null default 50;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'player_companies_reputation_check'
                    and conrelid = 'public.player_companies'::regclass) then
    alter table public.player_companies
      add constraint player_companies_reputation_check check (reputation between 0 and 100);
  end if;
end;
$$;
comment on column public.player_companies.reputation is
  'Reputation of the company 0..100 (ADR-183), every company; listed companies mirror listed_companies.reputation.';
alter table public.player_company_hours add column if not exists reputation double precision;
alter table public.player_company_hours add column if not exists reputation_target double precision;
alter table public.player_company_hours add column if not exists reputation_drivers jsonb;
comment on column public.player_company_hours.reputation_drivers is
  'What moved the reputation target this hour (ADR-183): quality, delivery, price, wages, bills, crisis, campaign '
  '(and for listed companies base, items, greed, reinvest, dividends, scandal).';

-- listed companies start from what they had as listed companies
update public.player_companies pc set reputation = l.reputation
  from public.listed_companies l
 where l.company_id = pc.company_id and pc.reputation <> l.reputation;

-- ---------------------------------------------------------------------------
-- B. Rules (ports of src/lib/sim/company-reputation.ts)
-- ---------------------------------------------------------------------------
create or replace function public.company_reputation_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('companyHealth') -> 'reputation', '{}'::jsonb);
$$;

-- reputationDrivers: points per driver, 0 is neutral
create or replace function public.company_reputation_drivers(p_quality double precision, p_demand double precision,
  p_capacity double precision, p_price_level text, p_pay_factor_bps integer, p_unpaid bigint, p_severity integer,
  p_campaign boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.company_reputation_cfg();
  v_q       double precision := least(1.0, greatest(0.0, coalesce(p_quality, 0)));
  v_neutral double precision := least(0.99, greatest(0.01, public.cfg_num(cfg, '{qualityNeutral}', 0.4)));
  v_rel     double precision;
  v_served  double precision;
  v_paid    double precision := least(1.0, greatest(0.0, coalesce(p_pay_factor_bps, 10000) / 10000.0));
  v_premium double precision := public.config_double('startups', '{pricing,premiumMinQuality}', 0.5);
begin
  v_rel := case when v_q >= v_neutral then (v_q - v_neutral) / (1 - v_neutral) else (v_q - v_neutral) / v_neutral end;
  v_served := case when coalesce(p_demand, 0) > 0 then least(1.0, greatest(0.0, coalesce(p_capacity, 0) / p_demand)) else 1 end;
  return jsonb_build_object(
    'quality', case when v_rel >= 0 then public.cfg_num(cfg, '{qualityMax}', 10) * v_rel
                    else public.cfg_num(cfg, '{qualityMaxLoss}', 5) * v_rel end,
    'delivery', -public.cfg_num(cfg, '{deliveryMaxLoss}', 8) * (1 - v_served),
    'price', case when p_price_level = 'premium' and v_q < v_premium then -public.cfg_num(cfg, '{premiumLowQualityLoss}', 6)
                  when p_price_level = 'budget' then public.cfg_num(cfg, '{budgetGain}', 2)
                  else 0 end,
    'wages', -public.cfg_num(cfg, '{wagesMaxLoss}', 10) * (1 - v_paid),
    'bills', case when coalesce(p_unpaid, 0) > 0 then -public.cfg_num(cfg, '{billsLoss}', 6) else 0 end,
    'crisis', -public.cfg_num(cfg, '{crisisPerSeverity}', 3) * least(3, greatest(0, coalesce(p_severity, 0))),
    'campaign', case when coalesce(p_campaign, false) then public.cfg_num(cfg, '{campaignGain}', 3) else 0 end);
end;
$$;

-- reputationTargetAll: base (or the listed target) + the drivers, 0..100
create or replace function public.company_reputation_target(p_drivers jsonb, p_listed_target double precision default null)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select least(100.0, greatest(0.0,
           coalesce(p_listed_target, public.cfg_num(public.company_reputation_cfg(), '{base}', 50))
           + coalesce((select sum(v::double precision) from jsonb_each_text(coalesce(p_drivers, '{}'::jsonb)) x(k, v)), 0)));
$$;

-- reputationDemandFactor
create or replace function public.company_reputation_demand_factor(p_value double precision)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select 1 + public.cfg_num(public.company_reputation_cfg(), '{demandMaxEffect}', 0.2)
             * (least(100.0, greatest(0.0, coalesce(p_value, 50))) - 50) / 50.0;
$$;

-- The drivers of one closed hour of a company, from what the hour and the company show
create or replace function public.company_reputation_drivers_of(p_company uuid, p_hour_start timestamptz,
  p_demand double precision, p_capacity double precision, p_pay_factor_bps integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc    public.player_companies;
  v_sev integer;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return '{}'::jsonb;
  end if;
  select max(e.severity) into v_sev from public.player_company_events e
   where e.company_id = p_company and e.polarity = 'crisis' and e.status in ('open', 'in_force');
  return public.company_reputation_drivers(pc.quality, p_demand, p_capacity, pc.price_level::text, p_pay_factor_bps,
                                           pc.unpaid_cents, coalesce(v_sev, 0),
                                           (public.company_campaign_at(p_company, p_hour_start)).id is not null);
end;
$$;

-- Stores the reputation of the hour: the company (and its listed mirror) and the hour row
create or replace function public.company_reputation_record(p_company uuid, p_hour_start timestamptz, p_value double precision,
  p_target double precision, p_drivers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.player_companies set reputation = least(100.0, greatest(0.0, p_value)) where company_id = p_company;
  update public.player_company_hours
     set reputation = least(100.0, greatest(0.0, p_value)), reputation_target = p_target, reputation_drivers = p_drivers
   where company_id = p_company and hour_start = date_trunc('hour', p_hour_start);
end;
$$;

-- One-off change of any company's reputation (interviews; tax penalties of listed companies)
create or replace function public.company_reputation_bump(p_company uuid, p_points double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_points, 0) = 0 then
    return;
  end if;
  update public.player_companies set reputation = least(100.0, greatest(0.0, reputation + p_points))
   where company_id = p_company;
  update public.listed_companies set reputation = least(100.0, greatest(0.0, reputation + p_points))
   where company_id = p_company;
end;
$$;

-- An extra step of the hourly close failed: logged and shown, the hour itself stays
create or replace function public.company_close_warn(p_company uuid, p_step text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise warning 'NEXA: hourly close of company %, step % failed: %', p_company, p_step, p_error;
  insert into public.job_runs (job_name, run_key, status, finished_at, error, details)
  values ('company_hour_step', p_company::text || ':' || p_step, 'failed', now(), left(p_error, 500),
          jsonb_build_object('failures', 1, 'step', p_step, 'company_id', p_company))
  on conflict (job_name, run_key) do update
    set status = 'failed', finished_at = now(), error = excluded.error,
        details = jsonb_build_object('failures', coalesce((public.job_runs.details ->> 'failures')::integer, 0) + 1,
                                     'step', p_step, 'company_id', p_company);
end;
$$;

-- What failed in the last day, for the dashboard
create or replace function public.company_close_warnings_json(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('step', j.details ->> 'step', 'at', j.finished_at, 'error', left(j.error, 200),
                                               'failures', coalesce((j.details ->> 'failures')::integer, 1))
                            order by j.finished_at desc), '[]'::jsonb)
    from public.job_runs j
   where j.job_name = 'company_hour_step' and j.run_key like p_company::text || ':%' and j.status = 'failed'
     and j.finished_at > now() - interval '24 hours';
$$;

-- The reputation as the company page shows it
create or replace function public.company_reputation_json(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc   public.player_companies;
  v_l  double precision;
  h    record;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  select l.reputation into v_l from public.listed_companies l where l.company_id = p_company;
  select x.reputation_target, x.reputation_drivers, x.hour_start into h from public.player_company_hours x
   where x.company_id = p_company and x.reputation_drivers is not null order by x.hour_start desc limit 1;
  return jsonb_build_object(
    'value', round(coalesce(v_l, pc.reputation)::numeric, 2),
    'target', round(coalesce(h.reputation_target, v_l, pc.reputation)::numeric, 2),
    'demand_factor', round(public.company_reputation_demand_factor(coalesce(v_l, pc.reputation))::numeric, 4),
    'drivers', coalesce(h.reputation_drivers, '{}'::jsonb),
    'at', h.hour_start,
    'history', coalesce((select jsonb_agg(jsonb_build_object('hour_start', y.hour_start, 'value', round(y.reputation::numeric, 2),
                                                             'target', round(coalesce(y.reputation_target, y.reputation)::numeric, 2))
                                          order by y.hour_start)
                           from (select x.hour_start, x.reputation, x.reputation_target from public.player_company_hours x
                                  where x.company_id = p_company and x.reputation is not null
                                  order by x.hour_start desc limit 48) y), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Full redefinitions of the listed functions that touch the reputation
-- ---------------------------------------------------------------------------
create or replace function public.listed_ensure(p_company uuid)
returns public.listed_companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  l   public.listed_companies;
  cfg jsonb := public.listed_cfg();
begin
  if not public.listed_is(p_company) then
    return null;
  end if;
  select * into l from public.listed_companies where company_id = p_company;
  if l.company_id is null then
    -- ADR-183: a company going public keeps the reputation it earned as a private company
    insert into public.listed_companies (company_id, reputation, satisfaction, books_until, ai_workers_seen)
    values (p_company,
            coalesce((select pc.reputation from public.player_companies pc where pc.company_id = p_company),
                     public.cfg_num(cfg, '{reputation,start}', 50)),
            public.cfg_num(cfg, '{satisfaction,start}', 60), now(),
            (select pc.ai_workers from public.player_companies pc where pc.company_id = p_company))
    on conflict (company_id) do nothing;
    select * into l from public.listed_companies where company_id = p_company;
  end if;
  return l;
end;
$$;

create or replace function public.listed_reputation_bump(p_company uuid, p_points double precision)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.listed_companies set reputation = least(100.0, greatest(0.0, reputation + coalesce(p_points, 0)))
   where company_id = p_company;
  update public.player_companies pc set reputation = l.reputation
    from public.listed_companies l
   where l.company_id = p_company and pc.company_id = p_company;
$$;

-- The terms of the hour: listed companies as before; private companies get their reputation's demand factor (ADR-183)
create or replace function public.listed_hour_effect(p_company uuid, p_hour_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l    public.listed_companies;
  v_df double precision := 1;
begin
  l := public.listed_ensure(p_company);
  if l.company_id is null then
    begin
      v_df := public.company_reputation_demand_factor(
                (select pc.reputation from public.player_companies pc where pc.company_id = p_company));
    exception when others then
      v_df := 1;
    end;
    return jsonb_build_object('awareness_add', 0, 'quality_add', 0, 'demand_factor', coalesce(v_df, 1), 'capacity_factor', 1,
                              'cogs_factor', 1, 'fixed_factor', 1, 'listed', false);
  end if;
  return public.listed_hour_effect_calc(public.listed_effects(p_company), l.satisfaction, l.reputation)
         || jsonb_build_object('listed', true);
end;
$$;

-- After the hour: reputation of every company; for listed ones also finished projects, mood, quits, history, fair
-- value, tax office, board. Every extra step in its own block (ADR-183).
create or replace function public.listed_hour_after(p_company uuid, p_hour_start timestamptz, p_demand double precision,
  p_capacity double precision, p_revenue bigint, p_profit bigint, p_pay_factor_bps integer, p_payout bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.listed_cfg();
  rcfg      jsonb := public.company_reputation_cfg();
  l         public.listed_companies;
  pc        public.player_companies;
  c         public.companies;
  v_end     timestamptz := p_hour_start + interval '1 hour';
  v_win     interval;
  v_fx      jsonb;
  v_eff     jsonb;
  v_acc     uuid;
  v_fired   integer;
  v_gone    integer;
  v_heat    double precision;
  v_profit  bigint;
  v_rev     bigint;
  v_pay     bigint;
  v_inv     bigint;
  v_div     bigint;
  v_ratio   integer;
  v_sev     integer;
  v_scandal boolean;
  v_st      jsonb;
  v_rt      jsonb;
  v_op      jsonb := '{}'::jsonb;
  v_target  double precision;
  v_sat     double precision;
  v_rep     double precision;
  v_red     integer;
  v_quit    boolean := false;
  v_today   date := (now() at time zone 'Europe/Berlin')::date;
  v_quits   integer;
  v_pf      double precision;
  v_streak  integer;
  r         record;
begin
  -- warnings of earlier hours are replaced by this hour's
  delete from public.job_runs j where j.job_name = 'company_hour_step' and j.run_key like p_company::text || ':%';

  -- ADR-183: the operational drivers of the reputation, for every company
  begin
    v_op := public.company_reputation_drivers_of(p_company, p_hour_start, p_demand, p_capacity, p_pay_factor_bps);
  exception when others then
    v_op := '{}'::jsonb;
    perform public.company_close_warn(p_company, 'reputation', sqlstate || ': ' || sqlerrm);
  end;

  l := public.listed_ensure(p_company);
  if l.company_id is null then
    -- a private company: only the reputation moves
    begin
      select * into pc from public.player_companies where company_id = p_company;
      v_target := public.company_reputation_target(v_op);
      v_rep := least(100.0, greatest(0.0, coalesce(pc.reputation, 50)
                                          + public.cfg_num(rcfg, '{adjustPerHour}', 0.08) * (v_target - coalesce(pc.reputation, 50))));
      perform public.company_reputation_record(p_company, p_hour_start, v_rep, v_target, v_op);
    exception when others then
      perform public.company_close_warn(p_company, 'reputation', sqlstate || ': ' || sqlerrm);
    end;
    return;
  end if;
  select * into l from public.listed_companies where company_id = p_company for update;
  select * into pc from public.player_companies where company_id = p_company;
  select * into c from public.companies where id = p_company;
  v_acc := public.company_cash_account(p_company);

  -- projects whose time is up become active (research, products, regions, machine levels)
  begin
    perform public.listed_finish_due(p_company, greatest(v_end, now()));
  exception when others then
    perform public.company_close_warn(p_company, 'projects', sqlstate || ': ' || sqlerrm);
  end;

  v_fx := public.listed_effects(p_company);
  v_eff := public.listed_hour_effect_calc(v_fx, l.satisfaction, l.reputation);

  -- dismissals: AI workers gone since the last hour (own quits were already counted out), players fired
  select count(*) into v_fired from public.player_jobs j
   where j.company_id = p_company and j.status = 'ended' and j.end_reason = 'fired'
     and j.ended_at > coalesce(l.layoff_checked_at, now() - interval '1 hour');
  v_gone := greatest(0, coalesce(l.ai_workers_seen, pc.ai_workers) - pc.ai_workers) + coalesce(v_fired, 0);
  v_heat := greatest(0, l.layoff_heat) * (1 - public.cfg_num(cfg, '{satisfaction,layoffs,decayPerHour}', 0.08))
          + v_gone * public.cfg_num(cfg, '{satisfaction,layoffs,perHead}', 3);

  -- the reputation window: profit and revenue of the hours, payouts, withdrawals, investments, dividends
  v_win := make_interval(hours => greatest(1, public.cfg_num(cfg, '{reputation,windowHours}', 24)::integer));
  select coalesce(sum(h.profit_cents), 0), coalesce(sum(h.revenue_cents), 0), coalesce(sum(h.founder_payout_cents), 0)
    into v_profit, v_rev, v_pay
    from public.player_company_hours h where h.company_id = p_company and h.hour_start > v_end - v_win;
  v_pay := v_pay + coalesce((
    select sum(-e.amount_cents) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
     where e.account_id = v_acc and e.amount_cents < 0 and e.created_at > now() - v_win
       and t.idempotency_key like 'withdraw:%'), 0);
  select coalesce(sum(-e.amount_cents), 0) into v_inv
    from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
   where e.account_id = v_acc and e.amount_cents < 0 and e.created_at > now() - v_win
     and t.metadata ->> 'one_off' = 'true';
  select coalesce(sum(d.total_cents), 0) into v_div from public.company_dividends d
   where d.company_id = p_company and d.paid_at > now() - v_win;
  v_ratio := public.listed_payout_ratio_bps(v_pay, v_profit, v_rev);

  select max(e.severity), bool_or(coalesce(cfg #> '{satisfaction,crisis,scandals}', '[]'::jsonb) ? e.archetype)
    into v_sev, v_scandal
    from public.player_company_events e
   where e.company_id = p_company and e.polarity = 'crisis' and e.status in ('open', 'in_force');

  -- mood
  v_st := public.listed_satisfaction_target(public.cfg_num(v_fx, '{satisfaction}', 0), p_pay_factor_bps,
            public.company_pay_mood_bps(p_company), case when p_capacity > 0 then p_demand / p_capacity else 1 end,
            coalesce(v_sev, 0), coalesce(v_scandal, false), v_heat, v_ratio, p_profit);
  v_sat := least(100.0, greatest(0.0, l.satisfaction + public.cfg_num(cfg, '{satisfaction,adjustPerHour}', 0.15)
                                                       * ((v_st ->> 'target')::double precision - l.satisfaction)));
  v_red := case when v_sat < public.cfg_num(cfg, '{satisfaction,red}', 35) then l.red_hours + 1 else 0 end;
  v_quits := case when l.quits_day = v_today then l.quits_today else 0 end;
  if v_red > 0 then
    -- an AI worker leaves every N-th hour in a row in the red zone
    if pc.ai_workers > 0 and v_red % greatest(1, public.cfg_num(cfg, '{satisfaction,quits,everyRedHours}', 3)::integer) = 0 then
      update public.player_companies set ai_workers = ai_workers - 1 where company_id = p_company and ai_workers > 0;
      pc.ai_workers := pc.ai_workers - 1;
      v_quit := true;
      v_quits := v_quits + 1;
      begin
        perform public.social_notify(pc.founder_id, 'team_mood', 'Kündigung bei ' || c.name,
          'Eine KI-Kraft hat hingeschmissen: Die Stimmung ist im Keller.',
          jsonb_build_object('company_id', p_company), '/company', 'quit:' || p_company::text || ':' || p_hour_start::text);
        perform public.company_system_message(p_company, 'Eine KI-Kraft hat gekündigt. Die Stimmung im Team ist schlecht.');
        if v_quits = greatest(1, public.cfg_num(cfg, '{satisfaction,quits,massQuitFrom}', 3)::integer) then
          perform public.feed_post(pc.founder_id, 'mass_quit', jsonb_build_object('company', c.name, 'count', v_quits),
                                   'mass_quit:' || p_company::text || ':' || v_today::text);
        end if;
      exception when others then
        perform public.company_close_warn(p_company, 'quit_notice', sqlstate || ': ' || sqlerrm);
      end;
    end if;
    -- players are not forced out: they are told, at most once per interval
    if l.mood_notified_at is null
       or l.mood_notified_at < now() - make_interval(hours => greatest(1, public.cfg_num(cfg, '{satisfaction,quits,notifyEveryHours}', 24)::integer)) then
      begin
        for r in select j.player_id from public.player_jobs j where j.company_id = p_company and j.status = 'active' loop
          perform public.social_notify(r.player_id, 'team_mood', 'Miese Stimmung bei ' || c.name,
            'Die Zufriedenheit im Team ist im roten Bereich. Vielleicht ist ein anderer Job besser für dich.',
            jsonb_build_object('company_id', p_company), '/career', 'mood:' || p_company::text || ':' || v_today::text);
        end loop;
        perform public.social_notify(pc.founder_id, 'team_mood', 'Stimmung im Keller',
          'Die Mitarbeiterzufriedenheit bei ' || c.name || ' ist im roten Bereich. Kapazität und Qualität sinken.',
          jsonb_build_object('company_id', p_company), '/company', 'mood-f:' || p_company::text || ':' || v_today::text);
      exception when others then
        perform public.company_close_warn(p_company, 'mood_notice', sqlstate || ': ' || sqlerrm);
      end;
      l.mood_notified_at := now();
    end if;
  end if;

  -- reputation: the shareholder target (ADR-167) plus the operational drivers of every company (ADR-183)
  v_streak := case when l.dividend_day is not null and l.dividend_day >= v_today - 1 then l.dividend_streak else 0 end;
  v_rt := public.listed_reputation_target(public.cfg_num(v_fx, '{reputation}', 0), v_pay, v_profit, v_rev, v_inv, v_div,
                                          v_streak, coalesce(v_scandal, false));
  v_target := public.company_reputation_target(v_op, (v_rt ->> 'target')::double precision);
  v_rep := least(100.0, greatest(0.0, l.reputation + public.cfg_num(cfg, '{reputation,adjustPerHour}', 0.08)
                                                     * (v_target - l.reputation)));
  if v_rep < public.cfg_num(cfg, '{reputation,greed,feedBelow}', 35)
     and v_ratio >= public.cfg_num(cfg, '{reputation,greed,fullRatioBps}', 10000) * 0.8 then
    begin
      perform public.feed_post(pc.founder_id, 'greedy_founder', jsonb_build_object('company', c.name, 'ratio_bps', v_ratio),
                               'greedy:' || p_company::text || ':' || v_today::text);
    exception when others then
      perform public.company_close_warn(p_company, 'greed_feed', sqlstate || ': ' || sqlerrm);
    end;
  end if;

  -- the fair share price follows the reputation
  v_pf := 1 + public.cfg_num(cfg, '{reputation,priceMaxEffect}', 0.25) * (v_rep - 50) / 50.0;
  begin
    if c.security_id is not null and v_pf <> l.price_factor then
      update public.security_sim_state
         set fair_value_e4 = greatest(1, round(fair_value_e4 / l.price_factor * v_pf))::bigint
       where security_id = c.security_id;
    end if;
  exception when others then
    v_pf := l.price_factor;
    perform public.company_close_warn(p_company, 'fair_value', sqlstate || ': ' || sqlerrm);
  end;

  update public.listed_companies
     set satisfaction = v_sat, reputation = v_rep, price_factor = v_pf, layoff_heat = v_heat, layoff_checked_at = now(),
         ai_workers_seen = pc.ai_workers, red_hours = v_red, quits_day = v_today, quits_today = v_quits,
         mood_notified_at = l.mood_notified_at, dividend_streak = v_streak
   where company_id = p_company;
  insert into public.listed_company_hours (company_id, hour_start, satisfaction, sat_target, reputation, rep_target, demand_factor,
                                           capacity_factor, upkeep_cents, upkeep, drivers)
  values (p_company, p_hour_start, v_sat, (v_st ->> 'target')::double precision, v_rep, v_target,
          (v_eff ->> 'demand_factor')::double precision, (v_eff ->> 'capacity_factor')::double precision,
          coalesce((select sum(v::bigint) from jsonb_each_text(l.last_upkeep) x(k, v)), 0), l.last_upkeep,
          jsonb_build_object('satisfaction', v_st -> 'drivers', 'reputation', (v_rt -> 'drivers') || v_op,
                             'payout_ratio_bps', v_ratio, 'ai_quit', v_quit))
  on conflict (company_id, hour_start) do nothing;
  delete from public.listed_company_hours h
   where h.company_id = p_company
     and h.hour_start < p_hour_start - make_interval(hours => greatest(24, public.cfg_num(cfg, '{historyHours}', 72)::integer) * 2);
  -- ADR-183: the same value on the company and in the hour row
  perform public.company_reputation_record(p_company, p_hour_start, v_rep, v_target, (v_rt -> 'drivers') || v_op);

  -- missions: an hour in the green zone
  if v_sat >= public.cfg_num(cfg, '{satisfaction,green}', 60) then
    begin
      perform public.mission_event(pc.founder_id, 'satisfaction_green', 1, p_hour_start::text);
    exception when others then
      perform public.company_close_warn(p_company, 'missions', sqlstate || ': ' || sqlerrm);
    end;
  end if;

  -- the tax advisor, the tax office, the board
  begin
    perform public.listed_tax_office(p_company);
  exception when others then
    perform public.company_close_warn(p_company, 'tax_office', sqlstate || ': ' || sqlerrm);
  end;
  begin
    perform public.board_close_due(p_company);
  exception when others then
    perform public.company_close_warn(p_company, 'board', sqlstate || ': ' || sqlerrm);
  end;
end;
$$;

-- CEO interviews (ADR-173) move the reputation of every company now, not only of listed ones (ADR-183)
create or replace function public.company_interview_finish(p_id bigint, p_status text, p_answers jsonb, p_points integer,
                                                           p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e        jsonb := coalesce(public.interviews_cfg() -> 'effects', '{}'::jsonb);
  iv       public.company_interviews;
  v_aw     integer;
  v_rep    double precision;
  v_max    integer := coalesce((e ->> 'maxAwarenessBps')::integer, 300);
  v_maxr   double precision := coalesce((e ->> 'maxReputation')::double precision, 3);
begin
  select * into iv from public.company_interviews where id = p_id for update;
  if iv.id is null or iv.status <> 'requested' then
    return;
  end if;
  v_aw := case p_status
            when 'answered' then greatest(-v_max, least(v_max, coalesce(p_points, 0) * coalesce((e ->> 'awarenessPerPointBps')::integer, 60)))
            when 'declined' then coalesce((e ->> 'declineAwarenessBps')::integer, -80)
            else coalesce((e ->> 'ignoreAwarenessBps')::integer, -120) end;
  v_rep := case when p_status = 'answered' then greatest(-v_maxr, least(v_maxr, coalesce(p_points, 0) * coalesce((e ->> 'reputationPerPoint')::double precision, 0.5)))
                when p_status = 'declined' then coalesce((e ->> 'declineReputation')::double precision, -0.5)
                else coalesce((e ->> 'ignoreReputation')::double precision, -1) end;
  update public.player_companies pc
     set awareness = least(1, greatest(0, coalesce(pc.awareness, 0) + v_aw / 10000.0))
   where pc.company_id = iv.company_id and pc.status = 'active';
  if v_rep <> 0 then
    perform public.listed_ensure(iv.company_id);
    perform public.company_reputation_bump(iv.company_id, v_rep);
  end if;
  update public.company_interviews
     set status = p_status, answers = p_answers, score = p_points, awareness_bps = v_aw, reputation_delta = v_rep,
         answered_at = p_now
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- D. Grants: internal helpers only for the server
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.company_reputation_cfg()',
    'public.company_reputation_drivers(double precision, double precision, double precision, text, integer, bigint, integer, boolean)',
    'public.company_reputation_target(jsonb, double precision)',
    'public.company_reputation_demand_factor(double precision)',
    'public.company_reputation_drivers_of(uuid, timestamptz, double precision, double precision, integer)',
    'public.company_reputation_record(uuid, timestamptz, double precision, double precision, jsonb)',
    'public.company_reputation_bump(uuid, double precision)',
    'public.company_close_warn(uuid, text, text)',
    'public.company_close_warnings_json(uuid)',
    'public.company_reputation_json(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
