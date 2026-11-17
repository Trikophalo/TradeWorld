-- =============================================================================
-- NEXA · 6600 · Company strengths: slow scores with a revenue bonus, the hourly close in plain sight (ADR-176)
-- =============================================================================
-- * company_strengths: six scores 0..100 per player company (awareness, quality, delivery, margin, team, finance).
--   Every closed hour moves each score a small step toward what the hour showed (companyHealth.strengths:
--   gainPerHour up, decayPerHour down), so 100 takes days. Port of src/lib/sim/company-strengths.ts.
-- * player_company_close_hour (patched by replace): the floor of the mean reaches a reward tier -> the households pay
--   that share of the hour's revenue on top (strength_bonus_cents, part of revenue_cents); after the hour the
--   scores move.
-- * company_state (patched by replace): 'strengths' with the scores, the reward and the next tier, plus the last
--   failure of the hourly close of this company from job_runs ('close_error'), so a stuck close is visible in the
--   game instead of only in the database (ADR-176: hours that never close explain an empty "Verlauf").
-- Idempotent: runs unchanged as supabase/updates/20261204006600_company_strengths.sql.

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
create table if not exists public.company_strengths (
  company_id uuid primary key references public.player_companies (company_id) on delete cascade,
  scores     jsonb not null default '{}'::jsonb,
  hours      integer not null default 0 check (hours >= 0),
  updated_at timestamptz not null default now()
);
alter table public.company_strengths enable row level security;
drop trigger if exists set_updated_at on public.company_strengths;
create trigger set_updated_at before update on public.company_strengths
  for each row execute function public.set_updated_at();
revoke all on public.company_strengths from anon, authenticated;
comment on table public.company_strengths is
  'Company strengths (ADR-176): six slow scores 0..100 per player company, moved by every closed hour. Read through '
  'company_state() only.';

alter table public.player_company_hours add column if not exists strength_bonus_cents bigint not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'player_company_hours_strength_bonus_check'
                    and conrelid = 'public.player_company_hours'::regclass) then
    alter table public.player_company_hours add constraint player_company_hours_strength_bonus_check
      check (strength_bonus_cents >= 0);
  end if;
end;
$$;
comment on column public.player_company_hours.strength_bonus_cents is
  'Part of revenue_cents the households paid as strengths bonus (ADR-176).';

-- ---------------------------------------------------------------------------
-- B. Rules (port of src/lib/sim/company-strengths.ts)
-- ---------------------------------------------------------------------------
create or replace function public.company_strengths_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('companyHealth') -> 'strengths',
                  '{"gainPerHour": 0.02, "decayPerHour": 0.05, "marginFull": 0.25, "cashHoursFull": 24,
                    "rewards": [{"at": 50, "bps": 200}, {"at": 75, "bps": 500}, {"at": 90, "bps": 1000}, {"at": 98, "bps": 1500}]}'::jsonb);
$$;

create or replace function public.company_strengths_instant(p_awareness double precision, p_quality double precision,
  p_demand double precision, p_capacity double precision, p_revenue bigint, p_profit bigint, p_pay_factor_bps integer,
  p_cash bigint, p_unpaid bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.company_strengths_cfg();
  v_costs double precision := greatest(1, coalesce(p_revenue, 0) - coalesce(p_profit, 0));
begin
  return jsonb_build_object(
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
$$;

create or replace function public.company_strengths_step(p_prev jsonb, p_instant jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
             p + case when v > p then public.cfg_num(cfg, '{gainPerHour}', 0.02) else public.cfg_num(cfg, '{decayPerHour}', 0.05) end
                 * (v - p))));
  end loop;
  return out;
end;
$$;

create or replace function public.company_strengths_overall(p_scores jsonb)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select (coalesce((p_scores ->> 'awareness')::double precision, 0) + coalesce((p_scores ->> 'quality')::double precision, 0)
        + coalesce((p_scores ->> 'delivery')::double precision, 0) + coalesce((p_scores ->> 'margin')::double precision, 0)
        + coalesce((p_scores ->> 'team')::double precision, 0) + coalesce((p_scores ->> 'finance')::double precision, 0)) / 6;
$$;

create or replace function public.company_strengths_reward_bps(p_scores jsonb)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max((r ->> 'bps')::integer), 0)
    from jsonb_array_elements(public.company_strengths_cfg() -> 'rewards') r
   where floor(public.company_strengths_overall(p_scores)) >= (r ->> 'at')::double precision;
$$;

create or replace function public.company_strengths_json(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s    public.company_strengths;
  v_sc jsonb;
  v_ov double precision;
  v_nx jsonb;
  j    public.job_runs;
begin
  select * into s from public.company_strengths where company_id = p_company;
  v_sc := coalesce(s.scores, '{}'::jsonb);
  v_ov := public.company_strengths_overall(v_sc);
  select r into v_nx from jsonb_array_elements(public.company_strengths_cfg() -> 'rewards') r
   where (r ->> 'at')::double precision > floor(v_ov) order by (r ->> 'at')::double precision limit 1;
  select * into j from public.job_runs x where x.job_name = 'company_hours' and x.run_key = p_company::text and x.status = 'failed';
  return jsonb_build_object(
    'scores', jsonb_build_object(
      'awareness', round(coalesce((v_sc ->> 'awareness')::numeric, 0), 2), 'quality', round(coalesce((v_sc ->> 'quality')::numeric, 0), 2),
      'delivery', round(coalesce((v_sc ->> 'delivery')::numeric, 0), 2), 'margin', round(coalesce((v_sc ->> 'margin')::numeric, 0), 2),
      'team', round(coalesce((v_sc ->> 'team')::numeric, 0), 2), 'finance', round(coalesce((v_sc ->> 'finance')::numeric, 0), 2)),
    'overall', round(v_ov::numeric, 2),
    'hours', coalesce(s.hours, 0),
    'reward_bps', public.company_strengths_reward_bps(v_sc),
    'next', v_nx,
    'close_error', case when j.id is not null
                        then jsonb_build_object('at', j.finished_at, 'error', left(j.error, 200),
                                                'failures', coalesce((j.details ->> 'failures')::integer, 1)) end);
end;
$$;

revoke all on function public.company_strengths_cfg() from public, anon;
revoke all on function public.company_strengths_instant(double precision, double precision, double precision, double precision, bigint, bigint, integer, bigint, bigint) from public, anon, authenticated;
revoke all on function public.company_strengths_step(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.company_strengths_reward_bps(jsonb) from public, anon, authenticated;
revoke all on function public.company_strengths_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- C. The hour: bonus on the revenue, then the scores move
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.player_company_close_hour(uuid, timestamptz)'::regprocedure);
  v_d   text := $t$  v_lxc     bigint := 0;
$t$;
  v_a   text := $t$  if v_cogs + v_aipaid > 0 then
$t$;
  v_b   text := $t$  perform public.listed_hour_after(p_company, v_start, v_demand, v_cap, v_rev, v_profit, v_factor, v_payout);  -- ADR-167$t$;
begin
  if position('company_strengths' in v_def) > 0 then
    return;
  end if;
  if position(v_d in v_def) = 0 or position(v_a in v_def) = 0 or position(v_b in v_def) = 0 then
    raise exception 'player_company_close_hour() has an unexpected shape; add the strengths (ADR-176) by hand';
  end if;
  v_def := replace(v_def, v_d, v_d || $t$  v_sbonus  bigint := 0;  -- ADR-176 (company_strengths)
  v_sscore  jsonb;
  v_scash   bigint;
$t$);
  -- the bonus: the households pay the reward share of the hour's revenue on top, as far as they can
  v_def := replace(v_def, v_a, $t$  -- strengths bonus (ADR-176): the reward tier of the scores before this hour
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
$t$ || v_a);
  v_def := replace(v_def, v_b, $t$  -- strengths (ADR-176): every score moves a step toward what this hour showed
  update public.player_company_hours set strength_bonus_cents = v_sbonus where company_id = p_company and hour_start = v_start;
  select greatest(0, a.balance_cents) into v_scash from public.ledger_accounts a where a.id = v_acc;
  insert into public.company_strengths as cs (company_id, scores, hours, updated_at)
  values (p_company,
          public.company_strengths_step('{}'::jsonb,
            public.company_strengths_instant(pc.awareness, pc.quality, v_demand, v_cap, v_rev, v_profit, v_factor, v_scash, v_owed)),
          1, now())
  on conflict (company_id) do update
    set scores = public.company_strengths_step(cs.scores,
                   public.company_strengths_instant(pc.awareness, pc.quality, v_demand, v_cap, v_rev, v_profit, v_factor, v_scash, v_owed)),
        hours = cs.hours + 1, updated_at = now();
$t$ || v_b);
  execute v_def;
end;
$do$;

-- ---------------------------------------------------------------------------
-- D. The company page reads them
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.company_state(uuid)'::regprocedure);
  v_a   text := $t$'campaign_costs', public.company_campaign_costs(p_company));$t$;
begin
  if position('company_strengths_json' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) > 0 then
    execute replace(v_def, v_a, $t$'campaign_costs', public.company_campaign_costs(p_company),
         -- ADR-176: slow strengths with their reward, and a stuck hourly close
         'strengths', public.company_strengths_json(p_company));$t$);
  elsif v_def ~ $r$'campaign_costs',\s*public\.company_campaign_costs\(p_company\)\s*\)$r$ then
    -- the live text can differ in white space: match it loosely
    execute regexp_replace(v_def, $r$('campaign_costs',\s*public\.company_campaign_costs\(p_company\))(\s*\))$r$,
      E'\\1,\n         ''strengths'', public.company_strengths_json(p_company)\\2');
  else
    -- never block the whole update on this read-only addition; the page treats a missing 'strengths' as empty
    raise warning 'company_state() has an unexpected shape; strengths (ADR-176) are not added to it';
  end if;
end;
$do$;
