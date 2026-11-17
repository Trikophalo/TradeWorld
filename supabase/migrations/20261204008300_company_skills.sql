-- =============================================================================
-- NEXA · 8300 · Fertigkeiten of player companies (ADR-194)
-- =============================================================================
-- * company_skills: the learned level of every Fertigkeit per company and when its last level is trained.
-- * learn_company_skill(request, key): the next level. Needs the skill of the map for that level, held by the founder
--   or a player with an active job in the company; costs company money (ledger company cash -> households) and
--   training hours. Idempotent by request_id.
-- * get_company_skills(): every Fertigkeit with level, training, requirement (missing skill), cost and effect.
-- * company_skills_hour_effect(company, hour): the capped terms of the hour (src/lib/sim/company-skills.ts).
-- * listed_hour_effect: full redefinition of the live function (7300, unchanged otherwise); its result is multiplied
--   with company_skills_hour_effect, so the hourly close (7720) takes the terms without being redefined. Profit and
--   with it the fair value of listed companies follow through the existing path.
-- Values in game_config "companySkills" (src/config/company-skills.ts). Idempotent: runs unchanged as supabase/updates/.

create table if not exists public.company_skills (
  company_id uuid not null references public.companies(id) on delete cascade,
  skill_key  text not null,
  level      smallint not null check (level between 1 and 20),
  ready_at   timestamptz not null,
  spent_cents bigint not null default 0 check (spent_cents >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, skill_key)
);
alter table public.company_skills enable row level security;
drop policy if exists company_skills_own on public.company_skills;
create policy company_skills_own on public.company_skills for select to authenticated
  using (exists (select 1 from public.companies c
                  where c.id = company_skills.company_id and (select auth.uid()) in (c.founder_id, c.ceo_id)));
revoke insert, update, delete on public.company_skills from anon, authenticated;
drop trigger if exists set_updated_at on public.company_skills;
create trigger set_updated_at before update on public.company_skills
  for each row execute function public.set_updated_at();

create or replace function public.company_skills_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'companySkills'), '{}'::jsonb);
$$;

-- the definition of one Fertigkeit, or null
create or replace function public.company_skill_def(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s from jsonb_array_elements(coalesce(public.company_skills_cfg() -> 'skills', '[]'::jsonb)) s
   where s ->> 'key' = p_key limit 1;
$$;

-- skills of the map held in the company: the founder's and those of players with an active job there
create or replace function public.company_held_skills(p_company uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct ps.skill_key), '{}'::text[])
    from public.player_skills ps
   where ps.player_id in (select c.founder_id from public.companies c where c.id = p_company
                          union
                          select pj.player_id from public.player_jobs pj
                           where pj.company_id = p_company and pj.status = 'active');
$$;

-- the capped terms of the hour; a level in training counts one lower (companySkillHourEffect)
create or replace function public.company_skills_hour_effect(p_company uuid, p_hour_start timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg   jsonb := public.company_skills_cfg();
  v_max integer := coalesce((cfg ->> 'maxLevel')::integer, 5);
  d     double precision := 0;
  ca    double precision := 0;
  co    double precision := 0;
  fx    double precision := 0;
  q     double precision := 0;
  r     record;
  v_b   double precision;
begin
  for r in select s.skill_key,
                  least(v_max, greatest(0, case when s.ready_at > p_hour_start then s.level - 1 else s.level end)) as lvl,
                  public.company_skill_def(s.skill_key) as def
             from public.company_skills s where s.company_id = p_company
  loop
    continue when r.def is null;
    v_b := coalesce((r.def ->> 'perLevelBps')::double precision, 0) * r.lvl;
    case r.def ->> 'effect'
      when 'demand' then d := d + v_b;
      when 'capacity' then ca := ca + v_b;
      when 'cogs' then co := co + v_b;
      when 'fixed' then fx := fx + v_b;
      when 'quality' then q := q + v_b;
      else null;
    end case;
  end loop;
  d := least(d, public.cfg_num(cfg, '{capBps,demand}', 1000));
  ca := least(ca, public.cfg_num(cfg, '{capBps,capacity}', 1000));
  co := least(co, public.cfg_num(cfg, '{capBps,cogs}', 800));
  fx := least(fx, public.cfg_num(cfg, '{capBps,fixed}', 1000));
  q := least(q, public.cfg_num(cfg, '{capBps,quality}', 500));
  return jsonb_build_object('demand_factor', 1 + d / 10000.0, 'capacity_factor', 1 + ca / 10000.0,
                            'cogs_factor', 1 - co / 10000.0, 'fixed_factor', 1 - fx / 10000.0, 'quality_add', q / 10000.0,
                            'demand_bps', d, 'capacity_bps', ca, 'cogs_bps', co, 'fixed_bps', fx, 'quality_bps', q);
end;
$$;

-- The terms of the hour (7300): listed companies as before; private companies get their reputation's demand factor
-- (ADR-183). ADR-194: both multiplied with the company's Fertigkeiten.
create or replace function public.listed_hour_effect(p_company uuid, p_hour_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l    public.listed_companies;
  v_df double precision := 1;
  v_r  jsonb;
  v_sk jsonb;
begin
  l := public.listed_ensure(p_company);
  if l.company_id is null then
    begin
      v_df := public.company_reputation_demand_factor(
                (select pc.reputation from public.player_companies pc where pc.company_id = p_company));
    exception when others then
      v_df := 1;
    end;
    v_r := jsonb_build_object('awareness_add', 0, 'quality_add', 0, 'demand_factor', coalesce(v_df, 1), 'capacity_factor', 1,
                              'cogs_factor', 1, 'fixed_factor', 1, 'listed', false);
  else
    v_r := public.listed_hour_effect_calc(public.listed_effects(p_company), l.satisfaction, l.reputation)
           || jsonb_build_object('listed', true);
  end if;
  -- ADR-194: Fertigkeiten; a failure never stops the close
  begin
    v_sk := public.company_skills_hour_effect(p_company, p_hour_start);
    v_r := v_r || jsonb_build_object(
      'demand_factor', (v_r ->> 'demand_factor')::double precision * (v_sk ->> 'demand_factor')::double precision,
      'capacity_factor', (v_r ->> 'capacity_factor')::double precision * (v_sk ->> 'capacity_factor')::double precision,
      'cogs_factor', (v_r ->> 'cogs_factor')::double precision * (v_sk ->> 'cogs_factor')::double precision,
      'fixed_factor', (v_r ->> 'fixed_factor')::double precision * (v_sk ->> 'fixed_factor')::double precision,
      'quality_add', (v_r ->> 'quality_add')::double precision + (v_sk ->> 'quality_add')::double precision,
      'skills', v_sk);
  exception when others then
    null;
  end;
  return v_r;
end;
$$;

-- one company's Fertigkeiten as the page shows them
create or replace function public.company_skills_json(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg    jsonb := public.company_skills_cfg();
  v_max  integer := coalesce((cfg ->> 'maxLevel')::integer, 5);
  v_now  timestamptz := public.game_now();
  v_held text[] := public.company_held_skills(p_company);
  v_cash bigint;
  v_out  jsonb := '[]'::jsonb;
  s      jsonb;
  cs     public.company_skills;
  v_lvl  integer;
  v_need text;
  v_per  integer;
begin
  select a.balance_cents - coalesce(pc.unpaid_cents, 0) into v_cash
    from public.ledger_accounts a join public.player_companies pc on pc.company_id = p_company
   where a.owner_company_id = p_company and a.kind = 'company_cash';
  for s in select x from jsonb_array_elements(coalesce(cfg -> 'skills', '[]'::jsonb)) x loop
    cs := null;
    select * into cs from public.company_skills k where k.company_id = p_company and k.skill_key = s ->> 'key';
    v_lvl := coalesce(cs.level, 0);
    v_need := case when v_lvl < v_max then s -> 'requires' ->> v_lvl end;
    v_per := coalesce((s ->> 'perLevelBps')::integer, 0);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', s ->> 'key', 'branch', s ->> 'branch', 'effect', s ->> 'effect',
      'level', v_lvl, 'max_level', v_max,
      'training_until', case when cs.ready_at > v_now then cs.ready_at end,
      'requires', s -> 'requires',
      'next_requires', v_need,
      'missing', case when v_need is not null and not (v_need = any (v_held)) then v_need end,
      'next_cost_cents', case when v_lvl < v_max then coalesce((cfg -> 'costCentsByLevel' ->> v_lvl)::bigint, 0) end,
      'next_hours', case when v_lvl < v_max then coalesce((cfg -> 'trainingHoursByLevel' ->> v_lvl)::integer, 0) end,
      'effect_bps', v_per * v_lvl,
      'next_effect_bps', case when v_lvl < v_max then v_per * (v_lvl + 1) end));
  end loop;
  return jsonb_build_object('company_id', p_company, 'free_cash_cents', greatest(0, coalesce(v_cash, 0)),
                            'skills', v_out, 'total', public.company_skills_hour_effect(p_company, v_now),
                            'cap_bps', coalesce(cfg -> 'capBps', '{}'::jsonb));
end;
$$;

create or replace function public.get_company_skills()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_co     uuid;
begin
  select pc.company_id into v_co from public.player_companies pc
   where pc.founder_id = v_player and pc.status = 'active' limit 1;
  if v_co is null then
    perform public.api_error('company_not_found');
  end if;
  return public.company_skills_json(v_co);
end;
$$;
comment on function public.get_company_skills() is 'RPC: the Fertigkeiten of the own company (ADR-194).';

create or replace function public.learn_company_skill(p_request_id uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  pc       public.player_companies;
  cfg      jsonb := public.company_skills_cfg();
  v_def    jsonb;
  v_max    integer;
  cs       public.company_skills;
  v_lvl    integer;
  v_need   text;
  v_cost   bigint;
  v_hours  double precision;
  v_free   bigint;
  v_now    timestamptz := public.game_now();
begin
  v_player := public.require_player();
  if p_request_id is null or p_key is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'learn_company_skill');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where founder_id = v_player and status = 'active' for update;
  if pc.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  v_def := public.company_skill_def(p_key);
  if v_def is null then
    perform public.api_error('invalid_argument');
  end if;
  v_max := coalesce((cfg ->> 'maxLevel')::integer, 5);
  select * into cs from public.company_skills k where k.company_id = pc.company_id and k.skill_key = p_key for update;
  v_lvl := coalesce(cs.level, 0);
  if v_lvl >= v_max then
    perform public.api_error('invalid_argument');
  end if;
  if cs.ready_at > v_now then
    perform public.api_error('locked');  -- the last level is still in training
  end if;
  v_need := v_def -> 'requires' ->> v_lvl;
  if v_need is not null and not (v_need = any (public.company_held_skills(pc.company_id))) then
    perform public.api_error('skill_locked');
  end if;
  v_cost := coalesce((cfg -> 'costCentsByLevel' ->> v_lvl)::bigint, 0);
  v_hours := coalesce((cfg -> 'trainingHoursByLevel' ->> v_lvl)::double precision, 0);
  -- free cash: open bills come first (as campaigns and expansions)
  select a.balance_cents - pc.unpaid_cents into v_free
    from public.ledger_accounts a where a.owner_company_id = pc.company_id and a.kind = 'company_cash' for update;
  if coalesce(v_free, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.company_cash_account(pc.company_id), public.ledger_system_account('households'),
                                   v_cost, 'company_costs', 'Fertigkeit: Schulung', 'company', pc.company_id,
                                   'company_skill:' || pc.company_id::text || ':' || p_request_id::text, v_player);
  end if;
  insert into public.company_skills as k (company_id, skill_key, level, ready_at, spent_cents, updated_at)
  values (pc.company_id, p_key, v_lvl + 1, v_now + make_interval(secs => v_hours * 3600), v_cost, now())
  on conflict (company_id, skill_key) do update
    set level = k.level + 1, ready_at = excluded.ready_at, spent_cents = k.spent_cents + excluded.spent_cents,
        updated_at = now();
  return public.request_complete(v_player, p_request_id,
           public.company_skills_json(pc.company_id) || jsonb_build_object('learned_key', p_key, 'learned_level', v_lvl + 1));
end;
$$;
comment on function public.learn_company_skill(uuid, text) is
  'RPC: the next level of a Fertigkeit of the own company (ADR-194); idempotent. Errors skill_locked, locked, insufficient_funds.';

revoke all on function public.company_skills_cfg() from public, anon, authenticated;
revoke all on function public.company_skill_def(text) from public, anon, authenticated;
revoke all on function public.company_held_skills(uuid) from public, anon, authenticated;
revoke all on function public.company_skills_hour_effect(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.company_skills_json(uuid) from public, anon, authenticated;
revoke all on function public.listed_hour_effect(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_company_skills() from public, anon;
grant execute on function public.get_company_skills() to authenticated;
revoke all on function public.learn_company_skill(uuid, text) from public, anon;
grant execute on function public.learn_company_skill(uuid, text) to authenticated;
