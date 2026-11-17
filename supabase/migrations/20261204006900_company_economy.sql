-- =============================================================================
-- NEXA · 6900 · Company economy overhaul (ADR-180): awareness every hour, AI workers paid for used capacity
-- =============================================================================
-- * company_awareness_hour(): port of awarenessHour (src/lib/sim/startup.ts). Word of mouth, the hour's marketing
--   and decay move the awareness after every closed hour (before: once per quarter, invisible for six hours).
-- * company_ai_utilization_bps() / company_ai_wage_due_cents(): ports of aiUtilizationBps / aiWageDueCents. AI workers
--   serve what founder and players cannot; the full wage only for the used part, at least aiWorkerStandbyBps.
-- * player_company_close_hour (patched by replace): AI wages by utilization, the awareness step, and the parts in the
--   hour row (ai_utilization_bps, awareness_before, awareness_after, awareness_parts) so the page can say
--   "+0,8 Bekanntheit diese Stunde durch Marketing".
-- * player_company_close_quarter (patched by replace): the quarter no longer moves awareness, it only reports it.
-- * company_strengths_instant (patched by replace): awareness counts against companyHealth.strengths.awarenessFull.
-- * company_awareness_boost(): levers outside the hour (tasks, autopilot) add awareness at once and remember it in
--   player_companies.awareness_boost, which the next hour reports as its "extra" part.
-- The new numbers (market x 10, capacity x 1.5, marketing and decay) come with game_config (pnpm db:config).
-- Idempotent: runs unchanged as supabase/updates/20261204006900_company_economy.sql.

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.player_company_hours add column if not exists ai_utilization_bps integer;
alter table public.player_company_hours add column if not exists awareness_before double precision;
alter table public.player_company_hours add column if not exists awareness_after double precision;
alter table public.player_company_hours add column if not exists awareness_parts jsonb;
comment on column public.player_company_hours.ai_utilization_bps is
  'Share of the AI workers'' capacity the hour used, 0..10 000 (ADR-180); below the standby share they cost that.';
comment on column public.player_company_hours.awareness_parts is
  'What moved the awareness this hour (ADR-180): word_of_mouth, marketing, decay, extra (tasks, autopilot), shares.';
alter table public.player_companies add column if not exists awareness_boost double precision not null default 0;
comment on column public.player_companies.awareness_boost is
  'Awareness added since the last closed hour by tasks and the autopilot (ADR-180); the hour reports and resets it.';

-- ---------------------------------------------------------------------------
-- B. Rules (ports of src/lib/sim/startup.ts)
-- ---------------------------------------------------------------------------
create or replace function public.company_awareness_hour(p_awareness double precision, p_quality double precision,
  p_marketing_cents double precision, p_potential double precision, p_price_awareness double precision, p_stage integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_su    jsonb := coalesce(public.config_jsonb('startups'), '{}'::jsonb);
  v_hours double precision := greatest(1, public.config_double('time', '{quarterHours}', 6));
  v_a     double precision := coalesce(p_awareness, 0);
  v_caps  jsonb := coalesce(v_su #> '{stages,awarenessCaps}', '[1]'::jsonb);
  v_stage integer := least(greatest(coalesce(p_stage, 0), 0), greatest(jsonb_array_length(v_caps) - 1, 0));
  v_min   double precision := public.cfg_num(v_su, '{awareness,min}', 0.01);
  v_cap   double precision;
  v_wom   double precision;
  v_mk    double precision := 0;
  v_mkq   double precision := greatest(0, coalesce(p_marketing_cents, 0)) * v_hours;
  v_half  double precision;
  v_decay double precision;
begin
  v_cap := greatest(v_min, coalesce((v_caps ->> v_stage)::double precision, 1));
  v_wom := public.cfg_num(v_su, '{awareness,growthPerQuarter}', 0.2) / v_hours * coalesce(p_price_awareness, 1)
           * v_a * (1 - v_a) * (0.5 + coalesce(p_quality, 0));
  if v_mkq > 0 then
    v_half := greatest(public.cfg_num(v_su, '{awareness,marketingMinHalfSaturationCents}', 50000),
                       coalesce(p_potential, 0) / 4.0 * public.cfg_num(v_su, '{awareness,marketingHalfSaturationShare}', 0.01));
    v_mk := public.cfg_num(v_su, '{awareness,marketingMaxGain}', 0.24) * v_mkq / (v_mkq + v_half) / v_hours;
  end if;
  v_decay := public.cfg_num(v_su, '{awareness,decayPerQuarter}', 0.12) / v_hours * v_a;
  return jsonb_build_object('before', v_a, 'next', least(v_cap, greatest(v_min, v_a + v_wom + v_mk - v_decay)),
                            'word_of_mouth', v_wom, 'marketing', v_mk, 'decay', v_decay, 'cap', v_cap);
end;
$$;

create or replace function public.company_ai_utilization_bps(p_sold double precision, p_capacity double precision,
  p_ai_workers integer, p_units double precision)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_ai_workers, 0) <= 0 or coalesce(p_units, 0) <= 0 or coalesce(p_capacity, 0) <= 0 then 0
              else floor(least(1.0, greatest(0.0,
                     (p_sold - (p_capacity - p_capacity * least(p_ai_workers::double precision, p_units) / p_units))
                     / (p_capacity * least(p_ai_workers::double precision, p_units) / p_units))) * 10000)::integer end;
$$;

create or replace function public.company_ai_wage_due_cents(p_ai_workers integer, p_utilization_bps integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(p_ai_workers, 0) <= 0 then 0::bigint
              else (p_ai_workers::bigint * public.config_bigint('startups', '{aiWorkerWageCentsPerHour}', 12000)
                    * greatest(public.config_bigint('startups', '{aiWorkerStandbyBps}', 2500),
                               least(10000, coalesce(p_utilization_bps, 0)))::bigint) / 10000 end;
$$;

-- Levers outside the hour (ADR-180): add awareness at once (never above the stage's cap), remembered for the hour.
create or replace function public.company_awareness_boost(p_company uuid, p_add double precision)
returns double precision
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc     public.player_companies;
  v_su   jsonb := coalesce(public.config_jsonb('startups'), '{}'::jsonb);
  v_caps jsonb := coalesce(v_su #> '{stages,awarenessCaps}', '[1]'::jsonb);
  v_cap  double precision;
  v_new  double precision;
begin
  select * into pc from public.player_companies where company_id = p_company and status = 'active' for update;
  if pc.company_id is null or coalesce(p_add, 0) = 0 then
    return 0;
  end if;
  v_cap := coalesce((v_caps ->> least(greatest(coalesce((public.player_company_team(p_company) ->> 'stage')::integer, 0), 0),
                                        greatest(jsonb_array_length(v_caps) - 1, 0)))::double precision, 1);
  if p_add > 0 then
    v_new := least(greatest(v_cap, pc.awareness), pc.awareness + p_add);
  else
    v_new := greatest(public.cfg_num(v_su, '{awareness,min}', 0.01), pc.awareness + p_add);
  end if;
  update public.player_companies
     set awareness = v_new, awareness_boost = awareness_boost + (v_new - pc.awareness)
   where company_id = p_company;
  return v_new - pc.awareness;
end;
$$;
revoke all on function public.company_awareness_boost(uuid, double precision) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- C. The hourly close (patched by replace; clear error when an anchor is missing)
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text := pg_get_functiondef('public.player_company_close_hour(uuid, timestamptz)'::regprocedure);
  a1 text := $a$  v_aidue := pc.ai_workers * public.config_bigint('startups', '{aiWorkerWageCentsPerHour}', 12000);$a$;
  b1 text := $b$  -- ADR-180: AI workers fill what founder and players cannot; the full wage only for the used capacity
  v_aiutil := public.company_ai_utilization_bps(v_sold, v_cap, pc.ai_workers,
                (v_team ->> 'team_productivity_bps')::double precision / 10000.0);
  v_aidue := public.company_ai_wage_due_cents(pc.ai_workers, v_aiutil);$b$;
  a2 text := $a$  update public.player_company_hours set strength_bonus_cents = v_sbonus where company_id = p_company and hour_start = v_start;$a$;
  b2 text := $b$  update public.player_company_hours set strength_bonus_cents = v_sbonus where company_id = p_company and hour_start = v_start;
  -- ADR-180: awareness moves every hour (word of mouth, the hour's marketing, decay); boosts since the last hour
  -- (tasks, autopilot) are reported as "extra"
  select x.awareness, x.quality, x.awareness_boost into v_aw0, v_q0, v_boost
    from public.player_companies x where x.company_id = p_company;
  v_awh := public.company_awareness_hour(v_aw0, v_q0, v_mk::double precision,
             pc.potential_annual_cents * public.company_market_factor(pc.tier, pc.expansion_level),
             (public.company_price_effect(pc.price_level, v_q0) ->> 'awareness')::double precision, v_stage);
  update public.player_companies set awareness = (v_awh ->> 'next')::double precision, awareness_boost = 0
   where company_id = p_company;
  update public.player_company_hours
     set ai_utilization_bps = v_aiutil, awareness_before = v_aw0 - coalesce(v_boost, 0),
         awareness_after = (v_awh ->> 'next')::double precision,
         awareness_parts = jsonb_build_object('word_of_mouth', v_awh -> 'word_of_mouth', 'marketing', v_awh -> 'marketing',
                                              'decay', v_awh -> 'decay', 'extra', coalesce(v_boost, 0), 'cap', v_awh -> 'cap')
   where company_id = p_company and hour_start = v_start;$b$;
  a3 text := $a$  v_sbonus  bigint := 0;  -- ADR-176 (company_strengths)$a$;
  b3 text := $b$  v_sbonus  bigint := 0;  -- ADR-176 (company_strengths)
  v_aiutil  integer := 0;  -- ADR-180
  v_awh     jsonb;
  v_aw0     double precision;
  v_q0      double precision;
  v_boost   double precision;$b$;
begin
  if position('ADR-180' in v_def) > 0 then
    return;
  end if;
  if position(a1 in v_def) = 0 then raise exception 'NEXA 6900: close_hour anchor (AI wages) missing'; end if;
  if position(a2 in v_def) = 0 then raise exception 'NEXA 6900: close_hour anchor (strength bonus) missing'; end if;
  if position(a3 in v_def) = 0 then raise exception 'NEXA 6900: close_hour anchor (declare) missing'; end if;
  v_def := replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3);
  execute v_def;
end;
$patch$;

-- the quarter reports the awareness, it no longer moves it
do $patch$
declare
  v_def text := pg_get_functiondef('public.player_company_close_quarter(uuid, bigint)'::regprocedure);
  a1 text := $a$  -- profit bonus (ADR-058)$a$;
begin
  if position('ADR-180' in v_def) > 0 then
    return;
  end if;
  if position(a1 in v_def) = 0 then raise exception 'NEXA 6900: close_quarter anchor (profit bonus) missing'; end if;
  v_def := replace(v_def, a1, '  v_aw := pc.awareness;  -- ADR-180: awareness moves every hour, the quarter only reports it' || chr(10) || a1);
  execute v_def;
end;
$patch$;

-- strengths: awareness against awarenessFull (ADR-180)
do $patch$
declare
  v_def text := pg_get_functiondef('public.company_strengths_instant(double precision, double precision, double precision, double precision, bigint, bigint, integer, bigint, bigint)'::regprocedure);
  a1 text := $a$'awareness', least(100.0, greatest(0.0, 100 * coalesce(p_awareness, 0))),$a$;
  b1 text := $b$'awareness', least(100.0, greatest(0.0, 100 * coalesce(p_awareness, 0)
                                    / greatest(0.01, public.cfg_num(cfg, '{awarenessFull}', 1)))),  -- ADR-180$b$;
begin
  if position('ADR-180' in v_def) > 0 then
    return;
  end if;
  if position(a1 in v_def) = 0 then raise exception 'NEXA 6900: strengths_instant anchor missing'; end if;
  execute replace(v_def, a1, b1);
end;
$patch$;
