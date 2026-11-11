-- =============================================================================
-- NEXA · M3e · 0200 · Skill map, quit notice, automatic work, AI offers,
--                     skill-specific postings, products and stages, trainings,
--                     employer view (ADR-061..064)
-- =============================================================================
-- Mirrors src/lib/sim/skills.ts (isReachable, neighbours) and src/lib/sim/startup.ts
-- (companyStage, trainingFor, closeStartupQuarter with stage).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Skill map: entry fields or a learned neighbour on the hex map (ADR-061)
-- ---------------------------------------------------------------------------
create or replace function public.skill_reachable(p_player uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((n ->> 'entry')::boolean, false)
      or exists (
           select 1
             from jsonb_array_elements(coalesce(public.config_jsonb('skills', '{tree}'), '[]'::jsonb)) o
             join public.player_skills s on s.player_id = p_player and s.skill_key = o ->> 'key'
             join (values (1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)) d(dq, dr)
               on (o ->> 'q')::integer = (n ->> 'q')::integer + d.dq and (o ->> 'r')::integer = (n ->> 'r')::integer + d.dr)
    from (select public.skill_node(p_key) as n) x
   where x.n is not null;
$$;

-- ---------------------------------------------------------------------------
-- F. Products and growth stages (ADR-062)
-- ---------------------------------------------------------------------------
-- The product of a company (unknown or missing key: the first product of the sector, productOf)
create or replace function public.company_product(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
           (select p from jsonb_array_elements(coalesce(public.config_jsonb('startups', array['products', c.sector_key]), '[]'::jsonb)) p
             where p ->> 'key' = pc.product_key limit 1),
           public.config_jsonb('startups', array['products', c.sector_key]) -> 0)
    from public.player_companies pc join public.companies c on c.id = pc.company_id
   where pc.company_id = p_company;
$$;

-- Learned skills of the team: founder first, then active employees by start
create or replace function public.company_team_skills(p_company uuid)
returns table (skill_key text, nickname text, ord integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.skill_key, pr.nickname, t.ord
    from (select pc.founder_id as player_id, 0 as ord, null::timestamptz as since
            from public.player_companies pc where pc.company_id = p_company
          union all
          select j.player_id, 1, j.started_at from public.player_jobs j where j.company_id = p_company and j.status = 'active') t
    join public.player_skills s on s.player_id = t.player_id
    join public.profiles pr on pr.id = t.player_id
   order by t.ord, t.since nulls first, pr.nickname;
$$;

-- companyStage: highest stage whose skills (and those of all earlier stages) the team knows
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
  for st in select x from jsonb_array_elements(v_stages) x loop
    exit when exists (select 1 from jsonb_array_elements_text(st) k where not (k = any (v_have)));
    v_stage := v_stage + 1;
  end loop;
  return v_stage;
end;
$$;

-- stages for COMPANY: [{stage, reached, skills: [{key, covered_by}]}]
create or replace function public.company_stages_json(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'stage', o,
           'reached', o <= public.company_stage(p_company),
           'skills', (select coalesce(jsonb_agg(jsonb_build_object(
                                'key', k,
                                'covered_by', (select t.nickname from public.company_team_skills(p_company) t
                                                where t.skill_key = k order by t.ord limit 1)) order by ko), '[]'::jsonb)
                        from jsonb_array_elements_text(st) with ordinality y(k, ko))) order by o), '[]'::jsonb)
    from jsonb_array_elements(coalesce(public.company_product(p_company) -> 'stages', '[]'::jsonb)) with ordinality x(st, o);
$$;

-- trainingFor(tier): cost and wage raise
create or replace function public.training_for(p_tier integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'cost_cents', coalesce((c -> greatest(0, least(jsonb_array_length(c) - 1, coalesce(p_tier, 1) - 1)))::bigint, 0),
    'raise_bps', coalesce((r -> greatest(0, least(jsonb_array_length(r) - 1, coalesce(p_tier, 1) - 1)))::integer, 0))
    from (select coalesce(public.config_jsonb('startups', '{training,costCentsByTier}'), '[]'::jsonb) as c,
                 coalesce(public.config_jsonb('startups', '{training,wageRaiseBpsByTier}'), '[]'::jsonb) as r) x;
$$;

-- ---------------------------------------------------------------------------
-- B. Quit with notice (ADR-063)
-- ---------------------------------------------------------------------------
create or replace function public.quit_job(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  j        public.player_jobs;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'quit_job');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into j from public.player_jobs where player_id = v_player and status = 'active' for update;
  if j.id is null then
    perform public.api_error('no_active_job');
  end if;
  if j.notice_ends_at is null then
    update public.player_jobs
       set notice_ends_at = now() + make_interval(secs => public.config_double('jobs', '{quitNoticeHours}', 24) * 3600)
     where id = j.id
    returning * into j;
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('notice_ends_at', j.notice_ends_at));
end;
$$;

create or replace function public.cancel_quit(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  j        public.player_jobs;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'cancel_quit');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into j from public.player_jobs where player_id = v_player and status = 'active' for update;
  if j.id is null then
    perform public.api_error('no_active_job');
  end if;
  if j.notice_ends_at is null then
    perform public.api_error('invalid_argument');
  end if;
  update public.player_jobs set notice_ends_at = null where id = j.id;
  return public.request_complete(v_player, p_request_id, public.job_state(v_player));
end;
$$;

-- Ends jobs whose notice is over: wages until the end of the notice, then end_reason 'quit'.
create or replace function public.process_quit_notices(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  r     record;
  v_n   integer := 0;
begin
  for r in select j.id, j.player_id, j.company_id, j.notice_ends_at from public.player_jobs j
            where j.status = 'active' and j.notice_ends_at is not null and j.notice_ends_at <= v_now
            order by j.notice_ends_at, j.id loop
    perform public.lock_player_accounts(r.player_id);
    perform public.accrue_job_salary(r.id, r.notice_ends_at);
    update public.player_jobs set status = 'ended', ended_at = r.notice_ends_at, end_reason = 'quit' where id = r.id;
    perform public.company_system_message(r.company_id,
      (select pr.nickname from public.profiles pr where pr.id = r.player_id) || ' hat gekündigt.');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Automatic work: no new work tasks (ADR-064)
-- ---------------------------------------------------------------------------
create or replace function public.get_work_task()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_player();
  return jsonb_build_object('task', null, 'next_task_at', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Trainings
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
-- G. The employer as seen by an employee
-- ---------------------------------------------------------------------------
create or replace function public.get_employer()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  j        public.player_jobs;
  c        public.companies;
  pc       public.player_companies;
  v_last   jsonb;
begin
  select * into j from public.player_jobs where player_id = v_player and status = 'active';
  if j.id is null then
    return jsonb_build_object('employer', null);
  end if;
  select * into c from public.companies where id = j.company_id;
  select * into pc from public.player_companies where company_id = j.company_id and status = 'active';
  if c.is_ai then
    select jsonb_build_object('label', 'J' || gq.game_year || ' Q' || gq.quarter, 'revenue_cents', r.revenue_cents,
                              'profit_cents', r.net_income_cents)
      into v_last
      from public.company_quarter_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
     where r.company_id = c.id order by gq.ends_at desc limit 1;
  else
    select jsonb_build_object('label', r.label, 'revenue_cents', r.revenue_cents, 'profit_cents', r.operating_profit_cents)
      into v_last
      from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
     where r.company_id = c.id order by gq.ends_at desc limit 1;
  end if;
  return jsonb_build_object('employer', jsonb_build_object(
    'company', public.company_json(c.id),
    'kind', case when c.is_ai then 'ai' else 'player' end,
    'product_key', case when pc.company_id is not null then public.company_product(c.id) ->> 'key' end,
    'stage', case when pc.company_id is not null then public.company_stage(c.id) end,
    'tier', pc.tier,
    'founder', case when pc.company_id is not null then (select pr.nickname from public.profiles pr where pr.id = pc.founder_id) end,
    'team_size', (select count(*) from public.player_jobs x where x.company_id = c.id and x.status = 'active')::integer
                 + case when pc.company_id is not null then 1 else 0 end,
    'last_quarter', v_last,
    'pay_factor_bps', coalesce(pc.pay_factor_bps, 10000)));
end;
$$;


-- learn_skill as in M2b with the hex map rule (ADR-061)
create or replace function public.learn_skill(p_request_id uuid, p_skill_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_node   jsonb;
  v_cost   integer;
  v_left   integer;
  v_bp     jsonb;
  v_take   integer;
  sp       public.player_skill_points;
  b        record;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'learn_skill');
  if v_replay is not null then
    return v_replay;
  end if;
  v_node := public.skill_node(p_skill_key);
  if v_node is null then
    perform public.api_error('skill_unknown');
  end if;
  perform public.skill_points_ensure(v_player);
  select * into sp from public.player_skill_points where player_id = v_player for update;
  if exists (select 1 from public.player_skills s where s.player_id = v_player and s.skill_key = p_skill_key) then
    perform public.api_error('skill_learned');
  end if;
  if not public.skill_reachable(v_player, p_skill_key) then
    perform public.api_error('skill_locked');
  end if;
  v_cost := coalesce((public.config_jsonb('skills', '{costByTier}') ->> ((v_node ->> 'tier')::integer - 1))::integer,
                     (v_node ->> 'tier')::integer);
  v_bp := coalesce(sp.branch_points, '{}'::jsonb);
  if (select coalesce(sum(coalesce((v_bp ->> x)::integer, 0)), 0) from jsonb_array_elements_text(v_node -> 'branches') x)
     + sp.free_points < v_cost then
    perform public.api_error('skill_points_insufficient');
  end if;
  v_left := v_cost;
  for b in
    select x as branch, coalesce((v_bp ->> x)::integer, 0) as pts
      from jsonb_array_elements_text(v_node -> 'branches') x order by 2 desc, 1
  loop
    exit when v_left = 0;
    v_take := least(v_left, b.pts);
    if v_take > 0 then
      v_bp := jsonb_set(v_bp, array[b.branch], to_jsonb(b.pts - v_take));
      v_left := v_left - v_take;
    end if;
  end loop;
  update public.player_skill_points
     set branch_points = v_bp, free_points = free_points - v_left
   where player_id = v_player;
  insert into public.player_skills (player_id, skill_key) values (v_player, p_skill_key);
  return public.request_complete(v_player, p_request_id,
    public.skills_state(v_player) || jsonb_build_object('learned_key', p_skill_key));
end;
$$;

-- job_state: quit notice, no quit cost, no work tasks
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
  -- automatic work (ADR-064): no new work tasks
  v_next := null;
  v_open := false;
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
    'quit_cost_cents', 0,
    'notice_ends_at', j.notice_ends_at,
    'signature', j.signature));
end;
$$;

-- apply_for_job: AI postings offer the ceiling, required skills are checked
create or replace function public.apply_for_job(p_request_id uuid, p_posting_id uuid, p_salary_wish_cents_per_hour bigint,
                                                p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  p        public.job_postings;
  v_tier   jsonb;
  v_scores jsonb;
  v_level  integer;
  v_id     uuid := gen_random_uuid();
  v_msg    text := nullif(btrim(coalesce(p_message, '')), '');
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'apply_for_job');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  select * into p from public.job_postings where id = p_posting_id;
  if p.id is null or p.status <> 'open' or (p.expires_at is not null and p.expires_at <= now()) then
    perform public.api_error('job_not_found');
  end if;
  if not p.is_ai and (p_salary_wish_cents_per_hour is null or p_salary_wish_cents_per_hour < 1) then
    perform public.api_error('invalid_argument');
  end if;
  if v_msg is not null and char_length(v_msg) > public.config_double('jobs', '{applicationMessageMaxLength}', 140) then
    perform public.api_error('invalid_argument');
  end if;
  if public.text_has_profanity(v_msg) then
    perform public.api_error('name_profanity');
  end if;
  v_tier := public.career_tier(p.tier::text);
  select pr.level into v_level from public.profiles pr where pr.id = v_player;
  if v_level < coalesce((v_tier ->> 'minLevel')::integer, 1) then
    perform public.api_error('job_level_too_low');
  end if;
  v_scores := public.player_branch_scores(v_player);
  if not public.job_skills_ok(v_scores, p.required)
     or exists (select 1 from unnest(p.required_skills) k
                 where not exists (select 1 from public.player_skills s where s.player_id = v_player and s.skill_key = k)) then
    perform public.api_error('job_skills_missing');
  end if;
  -- AI employers offer the personal ceiling; a wish is ignored (ADR-064)
  if p.is_ai then
    p_salary_wish_cents_per_hour := public.ai_salary_ceiling(p.salary_cents_per_hour, public.job_match_score(v_scores, p.required));
  end if;
  perform 1 from public.profiles pr where pr.id = v_player for update;
  if exists (select 1 from public.job_applications a
              where a.player_id = v_player and a.posting_id = p.id
                and (a.status = 'pending' or (a.status = 'offered' and a.offer_expires_at > now()))) then
    perform public.api_error('application_exists');
  end if;
  if (select count(*) from public.job_applications a
       where a.player_id = v_player
         and (a.status = 'pending' or (a.status = 'offered' and a.offer_expires_at > now())))
     >= public.config_double('jobs', '{maxOpenApplications}', 5) then
    perform public.api_error('application_limit');
  end if;

  insert into public.job_applications (id, posting_id, player_id, request_id, salary_wish_cents_per_hour, message, status,
                                       offer_salary_cents_per_hour, offer_expires_at)
  values (v_id, p.id, v_player, p_request_id, p_salary_wish_cents_per_hour, v_msg,
          case when p.is_ai then 'offered' else 'pending' end,
          case when p.is_ai then least(p_salary_wish_cents_per_hour,
                                       public.ai_salary_ceiling(p.salary_cents_per_hour, public.job_match_score(v_scores, p.required))) end,
          case when p.is_ai then now() + make_interval(secs => public.config_double('jobs', '{offerValidHours}', 48) * 3600) end);
  return public.request_complete(v_player, p_request_id, public.application_json(v_id));
end;
$$;

create or replace function public.counter_offer(p_request_id uuid, p_application_id uuid, p_salary_wish_cents_per_hour bigint)
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
begin
  v_player := public.require_player();
  if p_request_id is null or p_salary_wish_cents_per_hour is null or p_salary_wish_cents_per_hour < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'counter_offer');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into a from public.job_applications where id = p_application_id and player_id = v_player for update;
  if a.id is null or a.status not in ('pending', 'offered') then
    perform public.api_error('application_not_found');
  end if;
  if a.status = 'offered' and a.offer_expires_at <= now() then
    perform public.api_error('offer_expired');
  end if;
  select * into p from public.job_postings where id = a.posting_id;
  if p.is_ai then
    perform public.api_error('invalid_argument');           -- AI employers already offer their maximum
  end if;
  if false then
    update public.job_applications
       set salary_wish_cents_per_hour = p_salary_wish_cents_per_hour, status = 'offered',
           offer_salary_cents_per_hour = least(p_salary_wish_cents_per_hour,
             public.ai_salary_ceiling(p.salary_cents_per_hour, public.job_match_score(public.player_branch_scores(v_player), p.required))),
           offer_expires_at = now() + make_interval(secs => public.config_double('jobs', '{offerValidHours}', 48) * 3600)
     where id = a.id;
  else
    update public.job_applications
       set salary_wish_cents_per_hour = p_salary_wish_cents_per_hour, status = 'pending',
           offer_salary_cents_per_hour = null, offer_expires_at = null
     where id = a.id;
  end if;
  return public.request_complete(v_player, p_request_id, public.application_json(a.id));
end;
$$;

create or replace function public.posting_json(p_posting_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'company', public.company_json(p.company_id), 'tier', p.tier,
                            'title_key', p.title_key, 'title', p.title, 'required', p.required,
                            'required_skills', to_jsonb(p.required_skills))
    from public.job_postings p where p.id = p_posting_id;
$$;

create or replace function public.get_job_board()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_scores jsonb;
  v_level  integer;
begin
  v_player := public.require_player();
  perform public.refresh_ai_job_postings();
  v_scores := public.player_branch_scores(v_player);
  select p.level into v_level from public.profiles p where p.id = v_player;
  return jsonb_build_object(
    'postings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'company', public.company_json(p.company_id), 'tier', p.tier,
               'title_key', p.title_key, 'title', p.title,
               'min_level', coalesce((public.career_tier(p.tier::text) ->> 'minLevel')::integer, 1),
               'required', p.required,
               'required_skills', to_jsonb(p.required_skills),
               'salary_cents_per_hour', p.salary_cents_per_hour,
               'max_salary_cents_per_hour', case when p.is_ai then public.ai_salary_ceiling(p.salary_cents_per_hour,
                                                    public.job_match_score(v_scores, p.required)) end,
               'match_score', public.job_match_score(v_scores, p.required),
               'eligible', v_level >= coalesce((public.career_tier(p.tier::text) ->> 'minLevel')::integer, 1)
                           and public.job_skills_ok(v_scores, p.required)
                           and not exists (select 1 from unnest(p.required_skills) k
                                            where not exists (select 1 from public.player_skills s
                                                               where s.player_id = v_player and s.skill_key = k)),
               'slots_open', case when p.slots is null
                                  then public.config_double('jobs', '{aiSlotsOpen}', 99)::integer  -- unlimited (AI)
                                  else greatest(0, p.slots - (select count(*) from public.player_jobs j
                                                               where j.posting_id = p.id and j.status = 'active'))::integer end,
               'posted_at', p.posted_at, 'expires_at', p.expires_at,
               'my_application', (select jsonb_build_object('id', a.id,
                                          'status', case when a.status = 'offered' and a.offer_expires_at <= now() then 'expired' else a.status end)
                                    from public.job_applications a
                                   where a.posting_id = p.id and a.player_id = v_player
                                   order by a.created_at desc limit 1))
             order by p.is_ai, p.salary_cents_per_hour desc, p.posted_at desc, p.id)
        from public.job_postings p
       where p.status = 'open' and (p.expires_at is null or p.expires_at > now())), '[]'::jsonb),
    'next_refresh_at', (public.current_game_quarter()).ends_at);
end;
$$;

drop function if exists public.create_job_posting(uuid, uuid, text, text, jsonb, bigint, integer);
create or replace function public.create_job_posting(p_request_id uuid, p_company_id uuid, p_tier text, p_title text,
                                                     p_required jsonb, p_salary_cents_per_hour bigint, p_slots integer,
                                                     p_required_skills text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_id     uuid := gen_random_uuid();
  v_zero   jsonb := public.skill_branch_zero();
begin
  v_player := public.require_company_owner(p_company_id);
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'create_job_posting');
  if v_replay is not null then
    return v_replay;
  end if;
  if public.career_tier(p_tier) is null
     or p_title is null or char_length(btrim(p_title)) not between 3 and 60
     or p_salary_cents_per_hour is null or p_salary_cents_per_hour < 1
     or p_slots is null or p_slots not between 1 and 100
     or p_required is null or jsonb_typeof(p_required) <> 'array' or jsonb_array_length(p_required) not between 1 and 8
     or exists (select 1 from jsonb_array_elements(p_required) r
                 where not (v_zero ? coalesce(r ->> 'branch', ''))
                    or jsonb_typeof(r -> 'min_score') <> 'number' or (r ->> 'min_score')::integer < 0)
     or cardinality(coalesce(p_required_skills, '{}')) > 4
     or exists (select 1 from unnest(coalesce(p_required_skills, '{}')) k where public.skill_node(k) is null) then
    perform public.api_error('invalid_argument');
  end if;
  if public.text_has_profanity(p_title) then
    perform public.api_error('name_profanity');
  end if;
  insert into public.job_postings (id, company_id, tier, title, required, salary_cents_per_hour, slots, is_ai, status,
                                   created_by, request_id, required_skills)
  values (v_id, p_company_id, p_tier::public.job_tier, btrim(p_title),
          (select jsonb_agg(jsonb_build_object('branch', r ->> 'branch', 'min_score', (r ->> 'min_score')::integer))
             from jsonb_array_elements(p_required) r),
          p_salary_cents_per_hour, p_slots, false, 'open', v_player, p_request_id,
          (select coalesce(array_agg(distinct k), '{}') from unnest(coalesce(p_required_skills, '{}')) k));
  return public.request_complete(v_player, p_request_id, public.posting_json(v_id)
    || jsonb_build_object('salary_cents_per_hour', p_salary_cents_per_hour, 'slots', p_slots, 'status', 'open'));
end;
$$;

create or replace function public.get_company_postings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := public.require_own_company();
begin
  return jsonb_build_object('postings', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'tier', p.tier, 'title', p.title, 'title_key', p.title_key, 'required', p.required,
             'required_skills', to_jsonb(p.required_skills),
             'salary_cents_per_hour', p.salary_cents_per_hour, 'slots', coalesce(p.slots, 1),
             'slots_open', greatest(0, coalesce(p.slots, 1) - (select count(*) from public.player_jobs j
                                                                 where j.posting_id = p.id and j.status = 'active'))::integer,
             'status', p.status,
             'applications_pending', (select count(*) from public.job_applications a
                                       where a.posting_id = p.id and a.status = 'pending')::integer,
             'posted_at', p.posted_at)
             order by p.status = 'closed', p.posted_at desc, p.id)
      from public.job_postings p
     where p.company_id = v_company and (p.status = 'open' or p.updated_at > now() - interval '7 days')), '[]'::jsonb));
end;
$$;

create or replace function public.get_company_applications(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_company_owner(p_company_id);
  return jsonb_build_object('applications', coalesce((
    select jsonb_agg(public.application_json(a.id) || jsonb_build_object('applicant', jsonb_build_object(
             'nickname', pr.nickname, 'avatar_key', pr.avatar_key, 'level', pr.level,
             'branch_scores', public.player_branch_scores(pr.id),
             'match_score', public.job_match_score(public.player_branch_scores(pr.id), p.required),
             'skills', coalesce((select jsonb_agg(s.skill_key order by s.skill_key) from public.player_skills s
                                  where s.player_id = pr.id
                                    and (s.skill_key = any (p.required_skills)
                                         or s.skill_key in (select jsonb_array_elements_text(st)
                                                              from jsonb_array_elements(coalesce(public.company_product(p.company_id) -> 'stages', '[]'::jsonb)) st))),
                                '[]'::jsonb)))
             order by a.created_at desc, a.id)
      from public.job_applications a
      join public.job_postings p on p.id = a.posting_id
      join public.profiles pr on pr.id = a.player_id
     where p.company_id = p_company_id and a.created_at > now() - interval '30 days'), '[]'::jsonb));
end;
$$;

create or replace function public.get_company_team(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_company_owner(p_company_id);
  return jsonb_build_object('members', coalesce((
    select jsonb_agg(jsonb_build_object(
             'player_job_id', j.id, 'nickname', pr.nickname, 'avatar_key', pr.avatar_key,
             'title', coalesce(j.title, j.title_key), 'salary_cents_per_hour', j.salary_cents_per_hour,
             'productivity_bps', public.job_productivity_bps(public.job_match_score(public.player_branch_scores(pr.id), j.required)),
             'started_at', j.started_at,
             'notice_ends_at', j.notice_ends_at,
             'skills', coalesce((select jsonb_agg(s.skill_key order by s.skill_key) from public.player_skills s
                                  where s.player_id = pr.id), '[]'::jsonb),
             'pending_raise', case when j.pending_raise_bps is not null
                                   then jsonb_build_object('requested_bps', j.pending_raise_bps, 'created_at', j.pending_raise_at) end)
             order by j.started_at, j.id)
      from public.player_jobs j join public.profiles pr on pr.id = j.player_id
     where j.company_id = p_company_id and j.status = 'active'), '[]'::jsonb));
end;
$$;

drop function if exists public.found_company(uuid, text, text, text, text, text);
create or replace function public.found_company(p_request_id uuid, p_name text, p_idea text, p_sector text, p_color text,
                                                p_tier text, p_product text default null)
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
     or char_length(v_idea) not between 1 and 120
     or (p_product is not null
         and not exists (select 1 from jsonb_array_elements(coalesce(public.config_jsonb('startups', array['products', p_sector]), '[]'::jsonb)) x
                          where x ->> 'key' = p_product)) then
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
  insert into public.player_companies (company_id, founder_id, idea, tier, potential_annual_cents, awareness, quality, request_id,
                                       product_key)
  values (v_id, v_player, v_idea, p_tier, public.startup_potential_from_uniform(1 - random()),
          public.config_double('startups', '{awareness,initial}', 0.03), public.config_double('startups', '{quality,base}', 0.25),
          p_request_id,
          coalesce(p_product, public.config_jsonb('startups', array['products', p_sector]) -> 0 ->> 'key'));
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_id)));
end;
$$;

-- team: stage and capacity including the stage bonus
create or replace function public.player_company_team(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc       public.player_companies;
  v_sector text;
  v_list   jsonb;
  v_req    jsonb;
  v_fs     jsonb;
  v_found  integer;
  v_prod   bigint;
  v_score  integer;
  v_emp    integer := 0;
  v_s      jsonb;
  r        record;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  select c.sector_key into v_sector from public.companies c where c.id = p_company;
  v_list := coalesce(public.config_jsonb('jobs', array['sectorBranches', v_sector]), '[]'::jsonb);
  select coalesce(jsonb_agg(jsonb_build_object('branch', b, 'min_score', 0) order by o), '[]'::jsonb) into v_req
    from jsonb_array_elements_text(v_list) with ordinality x(b, o) where o <= 2;
  v_fs := public.player_branch_scores(pc.founder_id);
  v_found := public.job_productivity_bps(public.job_match_score(v_fs, v_req));
  select coalesce(sum(coalesce((v_fs ->> b)::integer, 0)), 0) into v_score from jsonb_array_elements_text(v_list) b;
  v_prod := v_found;
  for r in select j.player_id, j.required from public.player_jobs j where j.company_id = p_company and j.status = 'active' loop
    v_s := public.player_branch_scores(r.player_id);
    v_prod := v_prod + public.job_productivity_bps(public.job_match_score(v_s, r.required));
    v_score := v_score + (select coalesce(sum(coalesce((v_s ->> b)::integer, 0)), 0) from jsonb_array_elements_text(v_list) b);
    v_emp := v_emp + 1;
  end loop;
  v_prod := v_prod + pc.ai_workers * 10000;
  return jsonb_build_object(
    'founder_productivity_bps', v_found,
    'team_productivity_bps', v_prod,
    'employees', v_emp,
    'team_sector_score', v_score,
    'stage', public.company_stage(p_company),
    'capacity_cents', round(v_prod / 10000.0
                            * public.config_double('startups', array['capacityCentsPerProductivity', v_sector], 250000)
                            * (1 + public.config_double('startups', '{stages,capacityBonusPerStage}', 0.25) * public.company_stage(p_company)))::bigint);
end;
$$;

-- quarter close with the growth stage
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
  v_stage   integer;
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
  -- growth stage (ADR-062): quality bonus, awareness cap, capacity bonus
  v_stage := least(greatest((v_team ->> 'stage')::integer, 0),
                   greatest(jsonb_array_length(coalesce(v_su #> '{stages,awarenessCaps}', '[1]'::jsonb)) - 1, 0));
  v_target := least(1, v_target + public.cfg_num(v_su, '{stages,qualityBonusPerStage}', 0.05) * v_stage);
  v_quality := least(1, greatest(0, pc.quality + public.cfg_num(v_su, '{quality,adjustPerQuarter}', 0.35) * (v_target - pc.quality)));
  v_mk := pc.marketing_cents_per_quarter;
  if v_mk > 0 then
    v_half := greatest(public.cfg_num(v_su, '{awareness,marketingMinHalfSaturationCents}', 50000),
                       pc.potential_annual_cents / 4.0 * public.cfg_num(v_su, '{awareness,marketingHalfSaturationShare}', 0.1));
    v_gain := public.cfg_num(v_su, '{awareness,marketingMaxGain}', 0.12) * v_mk / (v_mk + v_half);
  end if;
  v_aw := least(greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
                         coalesce((v_su #>> array['stages', 'awarenessCaps', v_stage::text])::double precision, 1)),
          greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
            pc.awareness
            + public.cfg_num(v_su, '{awareness,growthPerQuarter}', 0.3) * pc.awareness * (1 - pc.awareness) * (0.5 + v_quality)
            + v_gain
            - public.cfg_num(v_su, '{awareness,decayPerQuarter}', 0.03) * pc.awareness));

  v_demand := v_qpot * v_aw * (0.5 + 0.5 * v_quality) * exp(public.cfg_num(v_su, '{demandNoise}', 0.1) * public.gauss_random());
  v_cap := (v_team ->> 'team_productivity_bps')::double precision / 10000.0
         * public.cfg_num(v_su, array['capacityCentsPerProductivity', c.sector_key], 250000)
         * (1 + public.cfg_num(v_su, '{stages,capacityBonusPerStage}', 0.25) * v_stage);
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
  if to_regclass('pg_temp.nexa_bonus') is null then
    create temporary table nexa_bonus (job_id uuid, player_id uuid, bonus bigint) on commit drop;
  end if;
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

create or replace function public.run_due_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz;
  v_result   jsonb := '{}'::jsonb;
  v_closed   jsonb := '[]'::jsonb;
  v_latest   bigint;
  q          record;
  v_run      bigint;
begin
  -- waits for a running tick (ticks only try the lock and skip)
  perform pg_advisory_xact_lock(7311001);
  v_now := public.game_now();
  perform public.ensure_game_quarters(3);

  if not exists (select 1 from public.candles limit 1) or not public.money_genesis_done()
     or not exists (select 1 from public.rich_tycoons) then
    v_result := v_result || jsonb_build_object('bootstrap', public.market_bootstrap());
  end if;

  -- first run on a database: older quarters are skipped, only the latest ended one is closed
  if not exists (select 1 from public.job_runs j where j.job_name = 'quarter_close') then
    select gq.id into v_latest from public.game_quarters gq
     where gq.ends_at <= v_now and gq.status <> 'closed' order by gq.ends_at desc limit 1;
    for q in select gq.id from public.game_quarters gq
              where gq.ends_at <= v_now and gq.status <> 'closed' and gq.id <> coalesce(v_latest, -1)
    loop
      update public.game_quarters set status = 'closed', closed_at = now() where id = q.id;
      insert into public.job_runs (job_name, run_key, status, finished_at, details)
      values ('quarter_close', q.id::text, 'succeeded', now(), '{"skipped": "before_first_run"}'::jsonb)
      on conflict do nothing;
    end loop;
  end if;

  for q in select gq.id from public.game_quarters gq
            where gq.ends_at <= v_now and gq.status <> 'closed'
            order by gq.ends_at limit 8
  loop
    v_closed := v_closed || public.close_game_quarter(q.id);
  end loop;
  v_result := v_result || jsonb_build_object('quarters', v_closed);
  -- player companies: every closed quarter since their founding (ADR-057)
  v_result := v_result || jsonb_build_object('player_company_quarters', public.player_companies_close_due());

  -- bonds that matured between quarter closes (or after a downtime)
  if exists (select 1 from public.bonds bd join public.securities s on s.id = bd.security_id
              where s.status = 'listed' and bd.matures_at <= v_now) then
    v_result := v_result || jsonb_build_object('bonds_redeemed', public.redeem_matured_bonds(v_now));
  end if;
  v_result := v_result || jsonb_build_object('bonds_issued', public.ensure_bond_series());

  -- jobs: AI postings of the running quarter, wages since the last run
  v_result := v_result || jsonb_build_object('quit_notices', public.process_quit_notices(null));
  v_result := v_result || jsonb_build_object('job_postings', public.refresh_ai_job_postings(),
                                             'salaries_paid', public.accrue_salaries(null));

  -- rich list snapshot every richList.snapshotMinutes (rank news, 24 h changes, state missions)
  v_result := v_result || jsonb_build_object('rich_list', public.rich_list_snapshot(false));

  -- daily maintenance (first run per UTC day)
  insert into public.job_runs (job_name, run_key) values ('maintenance', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'))
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is not null then
    v_result := v_result || jsonb_build_object('maintenance', public.run_maintenance());
    -- price_ticks: keep about one day (candles hold the history), cron log: one day
    perform public.maintain_price_tick_partitions(3, 1);
    if to_regclass('cron.job_run_details') is not null then
      begin
        execute 'delete from cron.job_run_details where end_time < now() - interval ''1 day''';
      exception when others then
        raise warning 'NEXA: could not prune cron.job_run_details: %', sqlerrm;
      end;
    end if;
    delete from public.job_runs j where j.job_name = 'maintenance' and j.started_at < now() - interval '30 days';
    update public.job_runs set status = 'succeeded', finished_at = now() where id = v_run;
  end if;
  return v_result;
end;
$$;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.skill_reachable(uuid, text)', 'public.company_product(uuid)', 'public.company_team_skills(uuid)',
    'public.company_stage(uuid)', 'public.company_stages_json(uuid)', 'public.training_for(integer)',
    'public.quit_job(uuid)', 'public.cancel_quit(uuid)', 'public.process_quit_notices(timestamptz)', 'public.get_work_task()',
    'public.train_employee(uuid, uuid, text)', 'public.get_employer()', 'public.learn_skill(uuid, text)', 'public.job_state(uuid)',
    'public.apply_for_job(uuid, uuid, bigint, text)', 'public.counter_offer(uuid, uuid, bigint)', 'public.posting_json(uuid)',
    'public.get_job_board()', 'public.create_job_posting(uuid, uuid, text, text, jsonb, bigint, integer, text[])',
    'public.get_company_postings()', 'public.get_company_applications(uuid)', 'public.get_company_team(uuid)',
    'public.found_company(uuid, text, text, text, text, text, text)', 'public.player_company_team(uuid)',
    'public.player_company_close_quarter(uuid, bigint)', 'public.company_state(uuid)', 'public.run_due_jobs()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.quit_job(uuid)', 'public.cancel_quit(uuid)', 'public.get_work_task()', 'public.train_employee(uuid, uuid, text)',
    'public.get_employer()', 'public.learn_skill(uuid, text)', 'public.apply_for_job(uuid, uuid, bigint, text)',
    'public.counter_offer(uuid, uuid, bigint)', 'public.get_job_board()',
    'public.create_job_posting(uuid, uuid, text, text, jsonb, bigint, integer, text[])', 'public.get_company_postings()',
    'public.get_company_applications(uuid)', 'public.get_company_team(uuid)',
    'public.found_company(uuid, text, text, text, text, text, text)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
