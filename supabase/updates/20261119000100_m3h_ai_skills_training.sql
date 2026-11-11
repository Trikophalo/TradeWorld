-- ===== idempotent copy of migrations/20261119000100_m3h_ai_skills_training.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M3h · 0100 · AI workers for stage skills, trainings from a team size (ADR-071)
-- =============================================================================
-- player_companies.ai_worker_skills: one entry (skill key) per AI worker hired
-- for a stage skill; AI workers beyond the array length are general ones.
-- Invariant: cardinality(ai_worker_skills) <= ai_workers, no duplicates. A
-- trigger keeps it for every path that lowers ai_workers (set_ai_workers,
-- quarter close in distress, dissolution, account reset): general AI workers go
-- first, then skilled ones from the end of the array.
-- companyStage counts skills covered by AI workers like learned team skills.
-- Trainings unlock from startups.training.fromEmployees (headcount).
-- Error keys (M3h): skill_already_covered NX062, training_locked NX063.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.player_companies add column if not exists ai_worker_skills text[] not null default '{}';
comment on column public.player_companies.ai_worker_skills is
  'Stage skill keys covered by AI workers (one AI worker each, hire order); AI workers beyond its length are general.';

-- keeps the invariant: no nulls or duplicates (first one wins), at most one entry per AI worker
create or replace function public.player_companies_ai_skills_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.ai_worker_skills := coalesce((select array_agg(x.s order by x.o)
                                      from (select u.s, min(u.o) as o
                                              from unnest(new.ai_worker_skills) with ordinality u(s, o)
                                             where u.s is not null
                                             group by u.s) x), '{}'::text[]);
  if cardinality(new.ai_worker_skills) > new.ai_workers then
    new.ai_worker_skills := new.ai_worker_skills[1:greatest(new.ai_workers, 0)];
  end if;
  return new;
end;
$$;
comment on function public.player_companies_ai_skills_guard() is
  'Trigger: ai_worker_skills without duplicates and never longer than ai_workers (skilled AI workers are dropped from the end).';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'ai_worker_skills_guard' and tgrelid = 'public.player_companies'::regclass) then
    create trigger ai_worker_skills_guard before insert or update of ai_workers, ai_worker_skills on public.player_companies
      for each row execute function public.player_companies_ai_skills_guard();
  end if;
  if not exists (select 1 from pg_constraint where conname = 'player_companies_ai_worker_skills_check'
                                              and conrelid = 'public.player_companies'::regclass) then
    alter table public.player_companies add constraint player_companies_ai_worker_skills_check
      check (cardinality(ai_worker_skills) <= ai_workers);
  end if;
  grant select (ai_worker_skills) on public.player_companies to authenticated;
end;
$$;

-- ---------------------------------------------------------------------------
-- B. Stages: AI workers cover skills like team members
-- ---------------------------------------------------------------------------
-- companyStage: highest stage whose skills (and those of all earlier stages) the team or an AI worker covers
create or replace function public.company_stage(p_company uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stages jsonb := coalesce(public.company_product(p_company) -> 'stages', '[]'::jsonb);
  v_have   text[];
  v_stage  integer := 0;
  st       jsonb;
begin
  select coalesce(array_agg(distinct t.skill_key), '{}') into v_have from public.company_team_skills(p_company) t;
  v_have := v_have || coalesce((select pc.ai_worker_skills from public.player_companies pc where pc.company_id = p_company),
                               '{}'::text[]);
  for st in select x from jsonb_array_elements(v_stages) x loop
    exit when exists (select 1 from jsonb_array_elements_text(st) k where not (k = any (v_have)));
    v_stage := v_stage + 1;
  end loop;
  return v_stage;
end;
$$;

-- stages for COMPANY: [{stage, reached, skills: [{key, covered_by, covered_by_ai}]}]
-- covered_by: nickname of the first team member with the skill; covered_by_ai: only an AI worker covers it
create or replace function public.company_stages_json(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'stage', o,
           'reached', o <= v.stage,
           'skills', (select coalesce(jsonb_agg(jsonb_build_object(
                                'key', k,
                                'covered_by', cb.nickname,
                                'covered_by_ai', cb.nickname is null and k = any (v.ai)) order by ko), '[]'::jsonb)
                        from jsonb_array_elements_text(st) with ordinality y(k, ko)
                        left join lateral (select t.nickname from public.company_team_skills(p_company) t
                                            where t.skill_key = k order by t.ord limit 1) cb on true)) order by o), '[]'::jsonb)
    from jsonb_array_elements(coalesce(public.company_product(p_company) -> 'stages', '[]'::jsonb)) with ordinality x(st, o),
         (select public.company_stage(p_company) as stage,
                 coalesce((select pc.ai_worker_skills from public.player_companies pc where pc.company_id = p_company),
                          '{}'::text[]) as ai) v;
$$;

-- ---------------------------------------------------------------------------
-- C. RPCs: hire and dismiss AI workers
-- ---------------------------------------------------------------------------
-- hire_ai_workers: p_count general AI workers, or (p_skill) one AI worker for a stage skill of the product
create or replace function public.hire_ai_workers(p_request_id uuid, p_count integer, p_skill text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  pc        public.player_companies;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_count is null or p_count < 1 or p_count > 1000
     or (p_skill is not null and p_count <> 1) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'hire_ai_workers');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  if p_skill is not null then
    if not exists (select 1
                     from jsonb_array_elements(coalesce(public.company_product(v_company) -> 'stages', '[]'::jsonb)) st,
                          jsonb_array_elements_text(st) k
                    where k = p_skill) then
      perform public.api_error('invalid_argument');
    end if;
    if p_skill = any (pc.ai_worker_skills) then
      raise exception using errcode = 'NX062', message = 'skill_already_covered';
    end if;
  end if;
  if pc.ai_workers + p_count
     + (select count(*) from public.player_jobs j where j.company_id = v_company and j.status = 'active')
     > (public.company_tier_cfg(pc.tier) ->> 'maxEmployees')::integer then
    perform public.api_error('employee_limit');
  end if;
  update public.player_companies
     set ai_workers = ai_workers + p_count,
         ai_worker_skills = case when p_skill is null then ai_worker_skills else ai_worker_skills || p_skill end
   where company_id = v_company;
  perform public.company_full_time_check(v_company);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;
comment on function public.hire_ai_workers(uuid, integer, text) is
  'RPC (founder): hires p_count general AI workers, or one AI worker that covers the stage skill p_skill.';

-- dismiss_ai_worker: the one covering p_skill, otherwise a general one (none left: the last skilled one)
create or replace function public.dismiss_ai_worker(p_request_id uuid, p_skill text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  pc        public.player_companies;
  v_n       integer;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'dismiss_ai_worker');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  v_n := cardinality(pc.ai_worker_skills);
  if p_skill is not null then
    if not (p_skill = any (pc.ai_worker_skills)) then
      perform public.api_error('invalid_argument');
    end if;
    update public.player_companies
       set ai_workers = ai_workers - 1, ai_worker_skills = array_remove(ai_worker_skills, p_skill)
     where company_id = v_company;
  elsif pc.ai_workers <= 0 then
    perform public.api_error('invalid_argument');
  elsif pc.ai_workers > v_n then
    update public.player_companies set ai_workers = ai_workers - 1 where company_id = v_company;
  else
    update public.player_companies
       set ai_workers = ai_workers - 1, ai_worker_skills = ai_worker_skills[1:v_n - 1]
     where company_id = v_company;
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;
comment on function public.dismiss_ai_worker(uuid, text) is
  'RPC (founder): dismisses the AI worker covering p_skill, otherwise a general one (or else the last skilled one).';

-- ---------------------------------------------------------------------------
-- D. Trainings from a team size
-- ---------------------------------------------------------------------------
create or replace function public.train_employee(p_request_id uuid, p_player_job_id uuid, p_skill_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  j        public.player_jobs;
  v_node   jsonb;
  v_tr     jsonb;
  v_cost   bigint;
  v_acc    uuid;
  v_bal    bigint;
  v_new    bigint;
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
  v_replay := public.request_begin(v_player, p_request_id, 'train_employee');
  if v_replay is not null then
    return v_replay;
  end if;
  if public.company_headcount(j.company_id) < public.config_double('startups', '{training,fromEmployees}', 5) then
    raise exception using errcode = 'NX063', message = 'training_locked';
  end if;
  v_node := public.skill_node(p_skill_key);
  if v_node is null then
    perform public.api_error('skill_unknown');
  end if;
  if exists (select 1 from public.player_skills s where s.player_id = j.player_id and s.skill_key = p_skill_key) then
    perform public.api_error('skill_learned');
  end if;
  v_tr := public.training_for((v_node ->> 'tier')::integer);
  v_cost := (v_tr ->> 'cost_cents')::bigint;
  v_acc := public.company_cash_account(j.company_id);
  select a.balance_cents into v_bal from public.ledger_accounts a where a.id = v_acc for update;
  if coalesce(v_bal, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(v_acc, public.ledger_system_account('households'), v_cost, 'company_costs',
                                   'Schulung ' || p_skill_key, 'player_job', j.id,
                                   'training:' || j.id::text || ':' || p_skill_key, v_player);
  end if;
  insert into public.player_skills (player_id, skill_key) values (j.player_id, p_skill_key);
  perform public.accrue_job_salary(j.id);
  v_new := round(j.salary_cents_per_hour * (1 + (v_tr ->> 'raise_bps')::integer / 10000.0))::bigint;
  update public.player_jobs set salary_cents_per_hour = v_new where id = j.id;
  perform public.company_system_message(j.company_id,
    (select pr.nickname from public.profiles pr where pr.id = j.player_id) || ' hat eine Schulung abgeschlossen.');
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'skill_key', p_skill_key, 'cost_cents', v_cost, 'salary_cents_per_hour', v_new));
end;
$$;

-- ---------------------------------------------------------------------------
-- E. COMPANY: ai_worker_skills and training_from
-- ---------------------------------------------------------------------------
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
  v_cost := public.company_upgrade_cost(pc.tier);
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'idea', pc.idea,
    'sector', c.sector_key,
    'color', c.brand_color,
    'logo', public.company_logo(p_company),
    'logo_hidden', pc.logo_hidden,
    'founder_has_job', exists (select 1 from public.player_jobs x where x.player_id = pc.founder_id and x.status = 'active'),
    'full_time_from', public.config_double('startups', '{fullTimeFromEmployees}', 5)::integer,
    'training_from', public.config_double('startups', '{training,fromEmployees}', 5)::integer,
    'headcount', public.company_headcount(p_company),
    'tier', pc.tier,
    'founded_at', c.founded_at,
    'cash_cents', v_cash,
    'value_cents', public.company_value_cents(p_company),
    'unpaid_cents', pc.unpaid_cents,
    'distress', pc.distress,
    'distress_quarters', pc.distress_quarters,
    'grace_quarters', public.config_double('startups', '{insolvency,graceQuarters}', 4)::integer,
    'pay_factor_bps', pc.pay_factor_bps,
    'product_key', public.company_product(p_company) ->> 'key',
    'stage', (v_team ->> 'stage')::integer,
    'stages', public.company_stages_json(p_company),
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
    'ai_worker_skills', to_jsonb(pc.ai_worker_skills),
    'max_employees', (v_tier ->> 'maxEmployees')::integer,
    'employees', (v_team ->> 'employees')::integer,
    'open_postings', (select count(*) from public.job_postings jp where jp.company_id = p_company and jp.status = 'open')::integer,
    'pending_applications', (select count(*) from public.job_applications a join public.job_postings jp on jp.id = a.posting_id
                              where jp.company_id = p_company and a.status = 'pending')::integer,
    'founder_productivity_bps', (v_team ->> 'founder_productivity_bps')::integer,
    'team_productivity_bps', (v_team ->> 'team_productivity_bps')::integer,
    'capacity_cents', (v_team ->> 'capacity_cents')::bigint,
    'next_quarter_at', coalesce((public.current_game_quarter()).ends_at, public.game_now()),
    'can_upgrade', public.company_next_tier(pc.tier) is not null
                   and coalesce(v_level, 1) >= (public.company_tier_cfg(public.company_next_tier(pc.tier)) ->> 'minLevel')::integer,
    'listing', public.company_listing_json(p_company, pc.founder_id),
    'can_go_public', c.phase = 'private' and public.company_open_offer(p_company) is null
                     and coalesce(public.config_jsonb('startups', '{ipo,fromTiers}'), '["small_business", "gmbh"]'::jsonb) ? pc.tier
                     and coalesce(v_level, 1) >= public.config_double('startups', '{ipo,minLevel}', 12),
    'can_capital_increase', c.phase = 'listed' and public.company_open_offer(p_company) is null,
    'upgrade_cost_cents', v_cost,
    'last_quarter', v_last,
    'history', v_hist);
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.player_companies_ai_skills_guard()', 'public.company_stage(uuid)', 'public.company_stages_json(uuid)',
    'public.hire_ai_workers(uuid, integer, text)', 'public.dismiss_ai_worker(uuid, text)',
    'public.train_employee(uuid, uuid, text)', 'public.company_state(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.hire_ai_workers(uuid, integer, text)', 'public.dismiss_ai_worker(uuid, text)', 'public.train_employee(uuid, uuid, text)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
