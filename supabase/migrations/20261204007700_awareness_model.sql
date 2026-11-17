-- =============================================================================
-- NEXA · 7700 · Awareness, one model (ADR-188): cap by size, hourly step, a ledger of every change
-- =============================================================================
-- * Before: the hourly step (ADR-180) added a fixed amount of marketing, took 2 % of the value per hour as decay and
--   stopped at a hidden stage cap (garage 50 %). Campaigns, tasks, moves, interviews, pitches, protests and the news
--   show wrote player_companies.awareness each in their own way, mostly without a trace; the diagnosis asked for more
--   awareness than the cap allowed; the strength "Bekanntheit" climbed 2 % of the gap per hour (4 of 100 after
--   three hours while the awareness stood at 49 %).
-- * Now (ports of src/lib/sim/awareness.ts):
--   company_awareness_cap(tier, stage, expansion)  tier base (garage 60 %) + per stage + per expansion level
--   company_awareness_step(...)                    marketing closes a share of the gap to the cap, word of mouth,
--                                                  slow decay toward the floor
--   company_awareness_add(company, source, delta)  every single event: capped, floored, booked
--   company_awareness_log                          what moved the awareness, per company, hour and source
--   get_company_awareness()                        value, cap and its parts, strength, last hour by source
-- Values come from game_config.startups.awareness; the defaults below equal src/config/balance.ts, so the functions
-- work before the update writes the new config. Idempotent: runs unchanged as supabase/updates/.

-- ---------------------------------------------------------------------------
-- A. The ledger
-- ---------------------------------------------------------------------------
create table if not exists public.company_awareness_log (
  company_id uuid not null references public.player_companies (company_id) on delete cascade,
  hour_start timestamptz not null,
  source     text not null,
  delta      double precision not null default 0,
  events     integer not null default 0 check (events >= 0),
  primary key (company_id, hour_start, source)
);
alter table public.company_awareness_log enable row level security;
revoke all on public.company_awareness_log from anon, authenticated;
comment on table public.company_awareness_log is
  'Awareness changes per company, hour and source (ADR-188): marketing, word_of_mouth, decay (hourly close), tasks, '
  'campaign, moves, interview, news, pitch, protest, event, rescale. delta in shares (0.01 = 1 point). Read through '
  'get_company_awareness(); kept for eight days.';

-- ---------------------------------------------------------------------------
-- B. Rules
-- ---------------------------------------------------------------------------
create or replace function public.company_awareness_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('startups') -> 'awareness', '{}'::jsonb);
$$;

-- awarenessCap: tier base + perStage x stage + perExpansionLevel x level, between min and cap.max
create or replace function public.company_awareness_cap(p_tier text, p_stage integer, p_expansion integer)
returns double precision
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a jsonb := public.company_awareness_cfg();
  v_base double precision;
begin
  v_base := public.cfg_num(a, array['cap', 'byTier', coalesce(p_tier, 'garage')],
              case p_tier when 'small_business' then 0.7 when 'gmbh' then 0.8 when 'ag' then 0.9 else 0.6 end);
  return least(public.cfg_num(a, '{cap,max}', 1),
               greatest(public.cfg_num(a, '{min}', 0.02),
                        v_base + public.cfg_num(a, '{cap,perStage}', 0.05) * greatest(0, coalesce(p_stage, 0))
                               + public.cfg_num(a, '{cap,perExpansionLevel}', 0.03) * greatest(0, coalesce(p_expansion, 0))));
end;
$$;

-- the cap of a company now (its tier, the stage its team reached, its expansion level)
create or replace function public.company_awareness_cap_of(p_company uuid)
returns double precision
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc public.player_companies;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return 1;
  end if;
  return public.company_awareness_cap(pc.tier, coalesce((public.player_company_team(p_company) ->> 'stage')::integer, 0),
                                      coalesce(pc.expansion_level, 0));
end;
$$;

-- awarenessHour: one closed hour. p_marketing_cents = the hour's marketing, p_potential = effective annual potential,
-- p_served = sold / demand (0..1), p_reputation 0..100. Returns before, next, marketing, word_of_mouth, decay, cap.
create or replace function public.company_awareness_step(p_awareness double precision, p_cap double precision,
  p_quality double precision, p_price_awareness double precision, p_marketing_cents double precision,
  p_potential double precision, p_served double precision, p_reputation double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a       jsonb := public.company_awareness_cfg();
  v_hours double precision := greatest(1, public.config_double('time', '{quarterHours}', 6));
  v_min   double precision := public.cfg_num(a, '{min}', 0.02);
  v_a     double precision := least(1, greatest(0, coalesce(p_awareness, 0)));
  v_cap   double precision;
  v_q     double precision := greatest(0, coalesce(p_marketing_cents, 0)) * v_hours;
  v_half  double precision;
  v_rate  double precision := 0;
  v_mk    double precision;
  v_wom   double precision;
  v_decay double precision;
begin
  v_cap := least(1, greatest(v_min, coalesce(p_cap, 1)));
  if v_q > 0 then
    v_half := greatest(public.cfg_num(a, '{marketingMinHalfSaturationCents}', 50000),
                       greatest(0, coalesce(p_potential, 0)) / 4.0 * public.cfg_num(a, '{marketingHalfSaturationShare}', 0.01));
    v_rate := public.cfg_num(a, '{marketingMaxRatePerHour}', 0.06) * v_q / (v_q + v_half);
  end if;
  v_mk := v_rate * greatest(0, v_cap - v_a);
  v_wom := public.cfg_num(a, '{wordOfMouthPerHour}', 0.008) * v_a * greatest(0, 1 - v_a / v_cap)
           * (0.5 + least(1, greatest(0, coalesce(p_quality, 0)))) * greatest(0, coalesce(p_price_awareness, 1))
           * least(1, greatest(0, coalesce(p_served, 1))) * (0.5 + least(100, greatest(0, coalesce(p_reputation, 50))) / 100.0);
  v_decay := public.cfg_num(a, '{decayPerHour}', 0.004) * greatest(0, v_a - v_min);
  return jsonb_build_object('before', v_a,
                            'next', least(greatest(v_cap, v_a), greatest(v_min, v_a + v_mk + v_wom - v_decay)),
                            'marketing', v_mk, 'word_of_mouth', v_wom, 'decay', v_decay, 'cap', v_cap);
end;
$$;

-- book a change (no change of the value itself)
create or replace function public.company_awareness_log_add(p_company uuid, p_hour timestamptz, p_source text,
  p_delta double precision)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.company_awareness_log as l (company_id, hour_start, source, delta, events)
  values (p_company, date_trunc('hour', p_hour), p_source, coalesce(p_delta, 0), 1)
  on conflict (company_id, hour_start, source) do update
    set delta = l.delta + excluded.delta, events = l.events + 1;
$$;

-- awarenessAdd: a single event (task, campaign, move, interview, news, pitch, protest, event). A gain stops at the
-- cap (nothing when already above it), a loss at the floor. Returns the applied change; booked in the open hour.
create or replace function public.company_awareness_add(p_company uuid, p_source text, p_delta double precision)
returns double precision
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc      public.player_companies;
  v_min   double precision := public.cfg_num(public.company_awareness_cfg(), '{min}', 0.02);
  v_cap   double precision;
  v_apply double precision;
begin
  select * into pc from public.player_companies where company_id = p_company and status = 'active' for update;
  if pc.company_id is null or coalesce(p_delta, 0) = 0 then
    return 0;
  end if;
  if p_delta > 0 then
    v_cap := public.company_awareness_cap_of(p_company);
    v_apply := greatest(0, least(p_delta, v_cap - pc.awareness));
  else
    v_apply := least(0, greatest(p_delta, v_min - pc.awareness));
  end if;
  if v_apply <> 0 then
    update public.player_companies set awareness = awareness + v_apply where company_id = p_company;
  end if;
  perform public.company_awareness_log_add(p_company, public.game_now(), coalesce(p_source, 'event'), v_apply);
  return v_apply;
end;
$$;

-- ADR-180 name for tasks and the autopilot: now a booked event of the source "tasks"
create or replace function public.company_awareness_boost(p_company uuid, p_add double precision)
returns double precision
language sql
security definer
set search_path = ''
as $$
  select public.company_awareness_add(p_company, 'tasks', p_add);
$$;

-- one hour of the ledger as {source: delta}
create or replace function public.company_awareness_hour_json(p_company uuid, p_hour timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(l.source, l.delta), '{}'::jsonb)
    from public.company_awareness_log l
   where l.company_id = p_company and l.hour_start = date_trunc('hour', p_hour);
$$;

-- What the page shows: the value, its cap and why, the strength, the last closed hour and the time since by source,
-- and the last 24 closed hours.
create or replace function public.company_awareness_json(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc      public.player_companies;
  a       jsonb := public.company_awareness_cfg();
  v_stage integer;
  v_last  timestamptz;
  v_score double precision;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  v_stage := coalesce((public.player_company_team(p_company) ->> 'stage')::integer, 0);
  select max(h.hour_start) into v_last from public.player_company_hours h where h.company_id = p_company;
  select (s.scores ->> 'awareness')::double precision into v_score from public.company_strengths s where s.company_id = p_company;
  return jsonb_build_object(
    'awareness', pc.awareness,
    'cap', public.company_awareness_cap(pc.tier, v_stage, coalesce(pc.expansion_level, 0)),
    'floor', public.cfg_num(a, '{min}', 0.02),
    'tier', pc.tier,
    'stage', v_stage,
    'expansion_level', coalesce(pc.expansion_level, 0),
    'tier_cap', public.company_awareness_cap(pc.tier, 0, 0),
    'per_stage', public.cfg_num(a, '{cap,perStage}', 0.05),
    'per_expansion_level', public.cfg_num(a, '{cap,perExpansionLevel}', 0.03),
    'strength', coalesce(v_score, 0),
    'last_hour', case when v_last is null then null else jsonb_build_object(
      'hour_start', v_last, 'parts', public.company_awareness_hour_json(p_company, v_last)) end,
    'since', (select coalesce(jsonb_object_agg(x.source, x.delta), '{}'::jsonb)
                from (select l.source, sum(l.delta) as delta from public.company_awareness_log l
                       where l.company_id = p_company and l.hour_start > coalesce(v_last, '-infinity'::timestamptz)
                       group by l.source) x),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('hour_start', h.hour_start, 'after', h.awareness_after)
                                          order by h.hour_start), '[]'::jsonb)
                  from (select hh.hour_start, hh.awareness_after from public.player_company_hours hh
                         where hh.company_id = p_company and hh.awareness_after is not null
                         order by hh.hour_start desc limit 24) h));
end;
$$;

create or replace function public.get_company_awareness()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  m        record;
begin
  select * into m from public.company_task_member(v_player);
  if m.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  return public.company_awareness_json(m.company_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.company_awareness_cfg()',
    'public.company_awareness_cap(text, integer, integer)',
    'public.company_awareness_cap_of(uuid)',
    'public.company_awareness_step(double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision)',
    'public.company_awareness_log_add(uuid, timestamptz, text, double precision)',
    'public.company_awareness_add(uuid, text, double precision)',
    'public.company_awareness_boost(uuid, double precision)',
    'public.company_awareness_hour_json(uuid, timestamptz)',
    'public.company_awareness_json(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
revoke all on function public.get_company_awareness() from public, anon;
grant execute on function public.get_company_awareness() to authenticated;
