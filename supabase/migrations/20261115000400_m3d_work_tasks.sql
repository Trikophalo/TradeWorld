-- =============================================================================
-- NEXA · M3d · 0400 · Work tasks (ADR-059, docs/JOBS_AND_SKILLS.md 6a)
-- =============================================================================
-- Mirrors src/lib/sim/work-tasks.ts: workTaskKind, draw ranges, isClear,
-- loanCostCents, customerProfitCents, analystProfitCents, correctOption,
-- gradeWorkTask. Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- uniform integer in [p_min, p_max] (rng.int)
create or replace function public.random_int(p_min integer, p_max integer)
returns integer
language sql
volatile
set search_path = ''
as $$
  select p_min + floor(random() * (p_max - p_min + 1))::integer;
$$;

create or replace function public.work_task_kind_for(p_branch text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_branch in ('finance', 'law') then 'finance_choice'
              when p_branch in ('sales', 'logistics', 'management') then 'sales_pick'
              else 'analyst_estimate' end;
$$;

-- Index of the right answer (correctOption)
create or replace function public.work_task_correct(p_kind text, p_params jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_a bigint;
  v_b bigint;
begin
  if p_kind = 'finance_choice' then
    select (o ->> 'fee_cents')::bigint + round((p_params ->> 'amount_cents')::numeric * (o ->> 'rate_bps')::bigint
                                               * (p_params ->> 'years')::bigint / 10000)::bigint
      into v_a from (select p_params -> 'offers' -> 0 as o) x;
    select (o ->> 'fee_cents')::bigint + round((p_params ->> 'amount_cents')::numeric * (o ->> 'rate_bps')::bigint
                                               * (p_params ->> 'years')::bigint / 10000)::bigint
      into v_b from (select p_params -> 'offers' -> 1 as o) x;
    return case when v_a <= v_b then 0 else 1 end;
  elsif p_kind = 'sales_pick' then
    return (select (o - 1)::integer
              from jsonb_array_elements(p_params -> 'customers') with ordinality a(c, o)
             order by (c ->> 'units')::bigint * ((c ->> 'price_cents')::bigint - (c ->> 'unit_cost_cents')::bigint)
                      - (c ->> 'service_cents')::bigint desc, o
             limit 1);
  end if;
  return (select (o - 1)::integer
            from jsonb_array_elements(p_params -> 'options') with ordinality a(v, o)
           where (v #>> '{}')::bigint = round((p_params ->> 'revenue_cents')::numeric * (10000 - (p_params ->> 'cogs_bps')::bigint) / 10000)::bigint
                                        - (p_params ->> 'fixed_cents')::bigint - (p_params ->> 'marketing_cents')::bigint
           order by o limit 1);
end;
$$;

-- isClear: the best option wins by at least 5 % (finance, sales), distinct options (analyst)
create or replace function public.work_task_is_clear(p_kind text, p_params jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_a  bigint;
  v_b  bigint;
  v_p  bigint[];
begin
  if p_kind = 'finance_choice' then
    select array_agg((o ->> 'fee_cents')::bigint + round((p_params ->> 'amount_cents')::numeric * (o ->> 'rate_bps')::bigint
                                                         * (p_params ->> 'years')::bigint / 10000)::bigint order by n)
      into v_p from jsonb_array_elements(p_params -> 'offers') with ordinality x(o, n);
    v_a := v_p[1]; v_b := v_p[2];
    return abs(v_a - v_b) >= 0.05 * greatest(v_a, v_b, 1);
  elsif p_kind = 'sales_pick' then
    select array_agg(p order by p desc) into v_p
      from (select (c ->> 'units')::bigint * ((c ->> 'price_cents')::bigint - (c ->> 'unit_cost_cents')::bigint)
                   - (c ->> 'service_cents')::bigint as p
              from jsonb_array_elements(p_params -> 'customers') c) x;
    return v_p[1] > 0 and v_p[1] - v_p[2] >= 0.05 * abs(v_p[1]);
  end if;
  return (select count(distinct v) = count(*) from jsonb_array_elements(p_params -> 'options') v);
end;
$$;

-- One draw in the ranges of draw() in work-tasks.ts
create or replace function public.work_task_draw(p_kind text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_rev   bigint;
  v_cogs  bigint;
  v_fixed bigint;
  v_mk    bigint;
  v_right bigint;
  v_opts  bigint[];
  v_tmp   bigint;
  i       integer;
  j       integer;
begin
  if p_kind = 'finance_choice' then
    return jsonb_build_object(
      'amount_cents', public.random_int(2, 40)::bigint * 1000000,
      'years', public.random_int(1, 5),
      'offers', jsonb_build_array(
        jsonb_build_object('rate_bps', public.random_int(15, 90) * 10, 'fee_cents', round(public.random_int(0, 60) * 5000 / 100.0)::bigint * 100),
        jsonb_build_object('rate_bps', public.random_int(15, 90) * 10, 'fee_cents', round(public.random_int(0, 60) * 5000 / 100.0)::bigint * 100)));
  elsif p_kind = 'sales_pick' then
    return jsonb_build_object('customers', (
      select jsonb_agg(jsonb_build_object('units', x.units, 'price_cents', x.cost + x.margin, 'unit_cost_cents', x.cost,
                                          'service_cents', x.service) order by x.n)
        from (select n, public.random_int(5, 60) * 100 as cost, public.random_int(5, 80) * 10 as units,
                     public.random_int(2, 40) * 100 as margin,
                     round(public.random_int(0, 40) * 25000 / 100.0)::bigint * 100 as service
                from generate_series(1, 3) n) x));
  end if;
  v_rev := public.random_int(20, 400)::bigint * 100000;
  v_cogs := public.random_int(25, 70)::bigint * 100;
  v_fixed := public.random_int(2, 60)::bigint * 100000;
  v_mk := public.random_int(0, 20)::bigint * 100000;
  v_right := round(v_rev::numeric * (10000 - v_cogs) / 10000)::bigint - v_fixed - v_mk;
  v_opts := array[v_right,
                  v_right + v_fixed,                                                -- forgot the fixed costs
                  round(v_rev::numeric * v_cogs / 10000)::bigint - v_fixed - v_mk,  -- swapped margin
                  v_right - v_mk - round(v_rev * 0.1)::bigint];                     -- made-up extra cost
  for i in reverse 4 .. 2 loop                                                      -- Fisher-Yates
    j := public.random_int(1, i);
    v_tmp := v_opts[i]; v_opts[i] := v_opts[j]; v_opts[j] := v_tmp;
  end loop;
  return jsonb_build_object('revenue_cents', v_rev, 'cogs_bps', v_cogs, 'fixed_cents', v_fixed, 'marketing_cents', v_mk,
                            'options', to_jsonb(v_opts));
end;
$$;

-- generateWorkTask: redraw until the answer is clear (at most 21 extra draws)
create or replace function public.work_task_generate(p_kind text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_params jsonb;
  n        integer := 0;
begin
  loop
    v_params := public.work_task_draw(p_kind);
    exit when n > 20 or public.work_task_is_clear(p_kind, v_params);
    n := n + 1;
  end loop;
  return v_params;
end;
$$;

create or replace function public.work_task_json(p_task public.player_work_tasks)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', p_task.id, 'kind', p_task.kind, 'params', p_task.params, 'created_at', p_task.created_at,
                            'expires_at', p_task.expires_at, 'started_at', p_task.started_at);
$$;

create or replace function public.get_work_task()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  j        public.player_jobs;
  t        public.player_work_tasks;
  v_last   timestamptz;
  v_int    double precision := public.config_double('careers', '{workTask,intervalHours}', 3);
  v_kind   text;
  v_params jsonb;
begin
  select * into j from public.player_jobs where player_id = v_player and status = 'active';
  if j.id is null then
    return jsonb_build_object('task', null, 'next_task_at', null);
  end if;
  perform 1 from public.profiles p where p.id = v_player for update;
  update public.player_work_tasks set status = 'expired'
   where player_id = v_player and status in ('open', 'started') and expires_at <= now();
  select * into t from public.player_work_tasks
   where player_job_id = j.id and status in ('open', 'started') order by created_at desc limit 1;
  if t.id is null then
    select max(x.created_at) into v_last from public.player_work_tasks x where x.player_job_id = j.id;
    if v_last is null or v_last + make_interval(secs => v_int * 3600) <= now() then
      v_kind := public.work_task_kind_for(j.required -> 0 ->> 'branch');
      v_params := public.work_task_generate(v_kind);
      insert into public.player_work_tasks (player_id, player_job_id, kind, params, correct_index, expires_at)
      values (v_player, j.id, v_kind, v_params, public.work_task_correct(v_kind, v_params),
              now() + make_interval(secs => public.config_double('careers', '{workTask,expiresHours}', 3) * 3600))
      returning * into t;
    end if;
  end if;
  if t.id is not null and t.started_at is null then
    update public.player_work_tasks set status = 'started', started_at = now() where id = t.id returning * into t;
  end if;
  select max(x.created_at) into v_last from public.player_work_tasks x where x.player_job_id = j.id;
  return jsonb_build_object(
    'task', case when t.id is not null then public.work_task_json(t) end,
    'next_task_at', coalesce(v_last + make_interval(secs => v_int * 3600), now()));
end;
$$;

create or replace function public.submit_work_task(p_request_id uuid, p_task_id uuid, p_choice integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  t         public.player_work_tasks;
  j         public.player_jobs;
  v_correct boolean;
  v_secs    double precision;
  v_min     integer := public.config_double('progression', '{xpSources,workTask,minXp}', 50)::integer;
  v_max     integer := public.config_double('progression', '{xpSources,workTask,maxXp}', 150)::integer;
  v_base    integer;
  v_share   integer;
  v_xp      integer;
  v_wage    bigint;
  v_bonus   bigint := 0;
  v_acc     uuid;
  v_bal     bigint;
  v_prof    public.profiles;
  v_nopt    integer;
begin
  v_player := public.require_player();
  if p_request_id is null or p_choice is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'submit_work_task');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into t from public.player_work_tasks where id = p_task_id and player_id = v_player for update;
  if t.id is null then
    perform public.api_error('work_task_not_found');
  end if;
  if t.status = 'done' then
    perform public.api_error('work_task_done');
  end if;
  if t.status = 'expired' or t.expires_at <= now() then
    update public.player_work_tasks set status = 'expired' where id = t.id;
    perform public.api_error('work_task_expired');
  end if;
  select * into j from public.player_jobs where id = t.player_job_id and status = 'active';
  if j.id is null then
    perform public.api_error('no_active_job');
  end if;
  v_nopt := case t.kind when 'finance_choice' then 2 when 'sales_pick' then 3 else 4 end;
  if p_choice < 0 or p_choice >= v_nopt then
    perform public.api_error('invalid_argument');
  end if;

  -- gradeWorkTask
  v_correct := p_choice = t.correct_index;
  v_secs := extract(epoch from (now() - coalesce(t.started_at, now())));
  if not v_correct then
    v_base := v_min; v_share := 0;
  elsif v_secs <= public.config_double('careers', '{workTask,fastAnswerSeconds}', 45) then
    v_base := v_max; v_share := 1;
  else
    v_base := round((v_min + v_max) / 2.0)::integer; v_share := 1;
  end if;
  v_xp := public.grant_xp(v_player, 'work_task', v_base, 'work_task:' || t.id::text, 'work_task', t.id);

  -- bonus: bonusSalaryHours x effective hourly wage, paid by the employer from its cash
  if v_share > 0 then
    v_wage := (public.job_state(v_player) -> 'job' ->> 'effective_salary_cents_per_hour')::bigint;
    v_bonus := round(v_share * public.config_double('careers', '{workTask,bonusSalaryHours}', 1) * coalesce(v_wage, 0))::bigint;
    perform public.lock_player_accounts(v_player);
    v_acc := public.company_cash_account(j.company_id);
    select greatest(0, a.balance_cents) into v_bal from public.ledger_accounts a where a.id = v_acc;
    v_bonus := least(v_bonus, coalesce(v_bal, 0));
    if v_bonus > 0 then
      perform public.ledger_transfer(v_acc, public.ledger_player_account(v_player, 'player_cash'), v_bonus, 'work_bonus',
                                     'Bonus Arbeitsaufgabe', 'work_task', t.id, 'work_task:' || t.id::text, v_player);
      perform public.loan_withhold(v_player, v_bonus, 'work_task:' || t.id::text);
    end if;
  end if;

  update public.player_work_tasks
     set status = 'done', choice = p_choice, correct = v_correct, xp_awarded = v_xp, bonus_cents = v_bonus,
         answered_at = now(), started_at = coalesce(started_at, now())
   where id = t.id;
  select * into v_prof from public.profiles where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'correct', v_correct, 'correct_index', t.correct_index, 'xp', v_xp, 'bonus_cents', v_bonus,
    'level', v_prof.level, 'xp_total', v_prof.xp_total));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.random_int(integer, integer)', 'public.work_task_kind_for(text)',
                           'public.work_task_correct(text, jsonb)', 'public.work_task_is_clear(text, jsonb)',
                           'public.work_task_draw(text)', 'public.work_task_generate(text)',
                           'public.work_task_json(public.player_work_tasks)', 'public.get_work_task()',
                           'public.submit_work_task(uuid, uuid, integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.get_work_task() to authenticated;
  grant execute on function public.submit_work_task(uuid, uuid, integer) to authenticated;
end;
$$;
