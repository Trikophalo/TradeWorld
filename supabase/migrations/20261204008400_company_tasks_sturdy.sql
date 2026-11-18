-- =============================================================================
-- NEXA · 8400 · Company tasks: one broken task never stops the board (ADR-211)
-- =============================================================================
-- Live report: "Firmenaufgaben funktionieren gerade nicht mehr". company_tasks_run_due() (cron nexa-company-tasks,
-- every minute) did everything for every company in ONE transaction: a single error anywhere (an AI result, a missed
-- deadline, the autopilot of one company, the cleanup) rolled the whole minute back. No new tasks, no AI results, no
-- deadlines, for every company, every minute, until the cause was gone. Latest full definitions with these changes:
-- * company_tasks_run_due (7620): every task, every company and every step runs in its own sub-transaction; an error
--   is written to job_runs (job_name 'company_tasks', status 'failed', error = the message, details = step and task or
--   company) and the run goes on. Tasks handed to someone who is no longer in the company (quit, fired, or a clone)
--   go back to open, instead of waiting for the deadline and its penalty.
-- * company_autopilot_run (6910): every company in its own sub-transaction, errors to job_runs likewise.
-- * company_task_grade_more (6920): an answer without its list ("{}") scored full marks for receipts and shelf
--   (jsonb_typeof(null) <> 'array' is null, least(10000, null) is 10000); now 0, like gradeMore (TS).
-- * Clones (ADR-206) work on their own and never open the task board: company_tasks_state (1800) marks them
--   (people[].is_clone), delegate_company_task (0100) and set_job_supervisor (0100) do not hand tasks or reports to
--   them (task_not_allowed). Tasks already handed to a clone go back to open (see above).
-- Idempotent: runs unchanged as supabase/updates/20261204008400_company_tasks_sturdy.sql.

-- The clone column of 9800 (ADR-206), the same statement: this file sorts before it but is written after it.
alter table public.player_jobs add column if not exists is_clone boolean not null default false;

-- ---------------------------------------------------------------------------
-- A. Errors of the task runs, readable in job_runs
-- ---------------------------------------------------------------------------
create or replace function public.company_tasks_log_error(p_step text, p_ref text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise warning 'company tasks (%, %): %', p_step, p_ref, p_error;
  insert into public.job_runs (job_name, run_key, status, finished_at, error, details)
  values ('company_tasks', p_step || ':' || coalesce(p_ref, '-') || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'),
          'failed', now(), left(p_error, 2000), jsonb_build_object('step', p_step, 'ref', p_ref))
  on conflict (job_name, run_key) do nothing;
end;
$$;
revoke all on function public.company_tasks_log_error(text, text, text) from public, anon, authenticated;

-- Whether p_player may still work on tasks of p_company: the founder or someone with an own (not a clone's) job there.
create or replace function public.company_task_holder_ok(p_company uuid, p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.player_companies pc where pc.company_id = p_company and pc.founder_id = p_player)
      or exists (select 1 from public.player_jobs j where j.company_id = p_company and j.player_id = p_player
                   and j.status = 'active' and not j.is_clone);
$$;
revoke all on function public.company_task_holder_ok(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B. The minute run (latest: 7620), every step on its own
-- ---------------------------------------------------------------------------
create or replace function public.company_tasks_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.company_tasks_cfg();
  v_now     timestamptz := coalesce(p_now, public.game_now());
  r         record;
  v_ai      integer := 0;
  v_missed  integer := 0;
  v_new     integer := 0;
  v_back    integer := 0;
  v_errors  integer := 0;
  v_target  integer;
  v_open    integer;
  v_def     jsonb;
  b         jsonb := cfg -> 'board';
begin
  if cfg -> 'tasks' is null then
    return jsonb_build_object('skipped', 'no config');
  end if;
  -- AI results; late is wrong
  for r in select * from public.company_tasks where status = 'ai' and ai_done_at <= v_now order by ai_done_at for update skip locked loop
    begin
      perform public.company_task_resolve(r.id,
        case when r.ai_done_at <= r.due_at and random() * 10000 < r.ai_chance_bps then 10000 else 0 end, true);
      v_ai := v_ai + 1;
    exception when others then
      v_errors := v_errors + 1;
      perform public.company_tasks_log_error('ai', r.id::text, sqlerrm);
    end;
  end loop;
  -- games opened and never answered
  for r in select t.* from public.company_tasks t
            where t.status = 'playing'
              and t.opened_at + make_interval(secs => coalesce((cfg -> 'games' -> t.game ->> 'seconds')::integer, 60)
                                                      + coalesce((cfg ->> 'graceSeconds')::integer, 0) + 60) <= v_now
            for update skip locked loop
    begin
      update public.company_tasks set done_by = assignee_id where id = r.id;
      perform public.company_task_resolve(r.id, 0, false);
    exception when others then
      v_errors := v_errors + 1;
      perform public.company_tasks_log_error('playing', r.id::text, sqlerrm);
    end;
  end loop;
  -- ADR-211: handed to someone who left the company (or to a clone): open again for the others
  for r in select t.id, t.company_id, t.assignee_id from public.company_tasks t
            where t.status = 'assigned' and t.assignee_id is not null and t.due_at > v_now
              and not public.company_task_holder_ok(t.company_id, t.assignee_id)
            for update of t skip locked loop
    begin
      update public.company_tasks
         set status = 'open', assignee_id = null, assignee_ai = false, assigned_by = null, assigned_at = null
       where id = r.id;
      v_back := v_back + 1;
    exception when others then
      v_errors := v_errors + 1;
      perform public.company_tasks_log_error('reopen', r.id::text, sqlerrm);
    end;
  end loop;
  -- auto AI shortly before the deadline
  for r in select t.id, pc.founder_id from public.company_tasks t
             join public.player_companies pc on pc.company_id = t.company_id
            where t.status = 'open' and pc.tasks_auto_ai and pc.ai_workers > 0
              and t.due_at - make_interval(mins => (b ->> 'autoAiBeforeDueMinutes')::integer) <= v_now and t.due_at > v_now
            for update of t skip locked loop
    begin
      perform public.company_task_to_ai(r.id, null);
    exception when others then
      v_errors := v_errors + 1;
      perform public.company_tasks_log_error('auto_ai', r.id::text, sqlerrm);
    end;
  end loop;
  -- missed deadlines
  for r in select * from public.company_tasks where status in ('open', 'assigned') and due_at <= v_now for update skip locked loop
    begin
      perform public.company_task_resolve(r.id, null, false);
      v_missed := v_missed + 1;
    exception when others then
      v_errors := v_errors + 1;
      perform public.company_tasks_log_error('missed', r.id::text, sqlerrm);
    end;
  end loop;
  -- new tasks for companies with someone active
  for r in select pc.company_id, pc.tier, pc.product_key, pc.ai_workers,
                  (select count(*) from public.player_jobs j where j.company_id = pc.company_id and j.status = 'active') as staff
             from public.player_companies pc
            where pc.status = 'active'
              and (pc.tasks_last_created_at is null
                   or pc.tasks_last_created_at <= v_now - make_interval(mins => (b ->> 'everyMinutes')::integer))
              and exists (select 1 from public.profiles p
                           where p.last_active_at > v_now - make_interval(mins => (b ->> 'activeMinutes')::integer)
                             and (p.id = pc.founder_id
                                  or exists (select 1 from public.player_jobs j where j.player_id = p.id
                                               and j.company_id = pc.company_id and j.status = 'active')))
  loop
    begin
      v_target := least((b ->> 'max')::integer,
                        (b ->> 'base')::integer + (1 + r.staff + coalesce(r.ai_workers, 0)) / (b ->> 'membersPerTask')::integer);
      select count(*) into v_open from public.company_tasks t
       where t.company_id = r.company_id and t.status in ('open', 'assigned', 'playing', 'ai');
      continue when v_open >= v_target;
      v_def := null;
      select x into v_def from jsonb_array_elements(cfg -> 'tasks') x
       where (x ->> 'product' = '*' or x ->> 'product' = r.product_key)
         and not exists (select 1 from public.company_tasks t where t.company_id = r.company_id and t.task_key = x ->> 'key'
                           and t.status in ('open', 'assigned', 'playing', 'ai'))
       -- ADR-186: weighted draw; the first of this order is task i with probability weight_i / sum of weights
       order by -ln(1.0 - random()) / greatest(coalesce((x ->> 'weight')::numeric, 1), 0.001)
       limit 1;
      continue when v_def is null;
      insert into public.company_tasks (company_id, task_key, branch, game, value_cents, created_at, due_at)
      values (r.company_id, v_def ->> 'key', v_def ->> 'branch', v_def ->> 'game',
              greatest(1, round((cfg -> 'valueCentsByTier' ->> r.tier::text)::numeric * (v_def ->> 'factor')::numeric)::bigint),
              v_now, v_now + make_interval(mins => (v_def ->> 'minutes')::integer));
      update public.player_companies set tasks_last_created_at = v_now where company_id = r.company_id;
      v_new := v_new + 1;
    exception when others then
      v_errors := v_errors + 1;
      perform public.company_tasks_log_error('new', r.company_id::text || ':' || coalesce(v_def ->> 'key', '-'), sqlerrm);
    end;
  end loop;
  begin
    perform public.company_autopilot_run(v_now);  -- ADR-180
  exception when others then
    v_errors := v_errors + 1;
    perform public.company_tasks_log_error('autopilot', null, sqlerrm);
  end;
  begin
    delete from public.company_tasks where resolved_at < v_now - interval '3 days';
    delete from public.job_runs j where j.job_name = 'company_tasks' and j.started_at < now() - interval '7 days';
  exception when others then
    v_errors := v_errors + 1;
    perform public.company_tasks_log_error('cleanup', null, sqlerrm);
  end;
  return jsonb_build_object('ai', v_ai, 'missed', v_missed, 'new', v_new, 'reopened', v_back, 'errors', v_errors);
end;
$$;

revoke all on function public.company_tasks_run_due(timestamptz) from public, anon, authenticated;
grant execute on function public.company_tasks_run_due(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- C. Autopilot (latest: 6910), every company on its own
-- ---------------------------------------------------------------------------
create or replace function public.company_autopilot_run(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.company_tasks_cfg();
  ap       jsonb := public.company_tasks_cfg() -> 'autopilot';
  v_now    timestamptz := coalesce(p_now, public.game_now());
  v_day0   timestamptz := date_trunc('day', coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  r        record;
  t        record;
  v_def    jsonb;
  v_today  integer;
  v_left   integer;
  v_chance integer;
  v_ok     boolean;
  v_res    jsonb;
  v_done   integer := 0;
  v_new    integer := 0;
  v_sent   integer := 0;
  s        record;
begin
  if ap is null then
    return jsonb_build_object('skipped', 'no config');
  end if;
  for r in select a.company_id, a.enabled_at, a.summary_sent_on, pc.founder_id, pc.tier, pc.product_key, pc.tasks_last_created_at,
                  c.name
             from public.company_autopilot a
             join public.player_companies pc on pc.company_id = a.company_id and pc.status = 'active'
             join public.companies c on c.id = a.company_id
            where a.enabled
            order by a.company_id
  loop
    begin  -- ADR-211: one company's error never stops the others
      select count(*) into v_today from public.company_autopilot_log l where l.company_id = r.company_id and l.at >= v_day0;
      v_left := (ap ->> 'maxPerDay')::integer - v_today;
      -- nobody around: the autopilot brings its own work, slowly
      if v_left > 0
         and (r.tasks_last_created_at is null or r.tasks_last_created_at <= v_now - make_interval(mins => (ap ->> 'everyMinutes')::integer))
         and not exists (select 1 from public.company_tasks x where x.company_id = r.company_id and x.status in ('open', 'assigned', 'playing', 'ai'))
      then
        v_def := null;
        select x into v_def from jsonb_array_elements(cfg -> 'tasks') x
         where x ->> 'product' = '*' or x ->> 'product' = r.product_key
         order by random() limit 1;
        if v_def is not null then
          insert into public.company_tasks (company_id, task_key, branch, game, value_cents, created_at, due_at)
          values (r.company_id, v_def ->> 'key', v_def ->> 'branch', v_def ->> 'game',
                  greatest(1, round((cfg -> 'valueCentsByTier' ->> r.tier::text)::numeric * (v_def ->> 'factor')::numeric)::bigint),
                  v_now - make_interval(mins => (ap ->> 'delayMinutes')::integer),
                  v_now + make_interval(mins => (v_def ->> 'minutes')::integer));
          update public.player_companies set tasks_last_created_at = v_now where company_id = r.company_id;
          v_new := v_new + 1;
        end if;
      end if;
      -- every open task that waited long enough (people get the first minutes)
      for t in select x.id, x.task_key from public.company_tasks x
                where x.company_id = r.company_id and x.status = 'open' and x.due_at > v_now
                  and x.created_at <= v_now - make_interval(mins => (ap ->> 'delayMinutes')::integer)
                order by x.created_at, x.id
                limit greatest(0, v_left)
                for update skip locked
      loop
        v_chance := public.company_autopilot_chance_bps(r.company_id);
        v_ok := v_chance >= 10000 or random() * 10000 < v_chance;
        update public.company_tasks
           set autopilot_chance_bps = v_chance, assignee_ai = true, assignee_id = null, done_by = null
         where id = t.id;
        v_res := public.company_task_resolve(t.id, case when v_ok then 10000 else 0 end, true);
        insert into public.company_autopilot_log (company_id, task_id, task_key, success, result_cents, chance_bps, at)
        values (r.company_id, t.id, t.task_key, v_ok, coalesce((v_res ->> 'result_cents')::bigint, 0), v_chance, v_now);
        v_done := v_done + 1;
      end loop;
      -- the morning summary: once per Berlin day from summaryHour, about everything since the last one
      if extract(hour from v_now at time zone 'Europe/Berlin') >= (ap ->> 'summaryHour')::integer
         and (r.summary_sent_on is null or r.summary_sent_on < (v_now at time zone 'Europe/Berlin')::date) then
        select count(*) as n, count(*) filter (where l.success) as ok, coalesce(sum(l.result_cents), 0) as cents into s
          from public.company_autopilot_log l
         where l.company_id = r.company_id
           and l.at > greatest(coalesce(r.enabled_at, v_now - interval '1 day'), v_day0 - interval '1 day'
                                 + make_interval(hours => (ap ->> 'summaryHour')::integer));
        if s.n > 0 then
          perform public.social_notify(r.founder_id, 'company_autopilot', 'Autopilot: ' || s.n || ' Aufgaben erledigt',
            r.name || ': ' || s.ok || ' erfolgreich, ' || (s.n - s.ok) || ' daneben, '
              || case when s.cents >= 0 then '+' else '−' end
              || to_char(abs(s.cents) / 100.0, 'FM999G999G990D00') || ' €.',
            jsonb_build_object('done', s.n, 'success', s.ok, 'cents', s.cents), '/company',
            'autopilot:' || r.company_id::text || ':' || to_char(v_now at time zone 'Europe/Berlin', 'YYYY-MM-DD'));
          v_sent := v_sent + 1;
        end if;
        update public.company_autopilot set summary_sent_on = (v_now at time zone 'Europe/Berlin')::date
         where company_id = r.company_id;
      end if;
    exception when others then
      perform public.company_tasks_log_error('autopilot', r.company_id::text, sqlerrm);
    end;
  end loop;
  delete from public.company_autopilot_log where at < v_now - interval '7 days';
  return jsonb_build_object('done', v_done, 'new', v_new, 'summaries', v_sent);
end;
$$;
revoke all on function public.company_autopilot_run(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D. Grading of the five games of 6920: a missing list scores 0
-- ---------------------------------------------------------------------------
create or replace function public.company_task_grade_more(p_game text, p_solution jsonb, p_answer jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total integer;
  v_sum   bigint;
  v_n     integer;
  v_cells integer[];
  v_ok    integer := 0;
  v_i     integer;
begin
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' then
    return 0;
  end if;
  if p_game = 'restock' then
    if coalesce(jsonb_typeof(p_answer -> 'values'), '') <> 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> 'values');
    select coalesce(sum(case when a.v is null or jsonb_typeof(a.v) <> 'number' or (a.v #>> '{}')::numeric % 1 <> 0 then 0
                             when abs((a.v #>> '{}')::numeric - (s.v #>> '{}')::numeric) = 0 then 10000
                             when abs((a.v #>> '{}')::numeric - (s.v #>> '{}')::numeric) = 1 then 5000 else 0 end), 0)
      into v_sum
      from jsonb_array_elements(p_solution -> 'values') with ordinality s(v, i)
      left join jsonb_array_elements(p_answer -> 'values') with ordinality a(v, i) on a.i = s.i;
    return (v_sum / greatest(v_total, 1))::integer;
  elsif p_game = 'receipts' then
    if coalesce(jsonb_typeof(p_answer -> 'picked'), '') <> 'array' or jsonb_array_length(p_answer -> 'picked') = 0 then
      return 0;
    end if;
    v_n := jsonb_array_length(p_solution -> 'amounts');
    if exists (select 1 from jsonb_array_elements(p_answer -> 'picked') e
                where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric % 1 <> 0
                   or (e #>> '{}')::numeric < 0 or (e #>> '{}')::numeric >= v_n) then
      return 0;
    end if;
    if (select count(distinct e #>> '{}') from jsonb_array_elements(p_answer -> 'picked') e) <> jsonb_array_length(p_answer -> 'picked') then
      return 0;
    end if;
    select sum((p_solution -> 'amounts' ->> ((e #>> '{}')::numeric::integer))::bigint) into v_sum
      from jsonb_array_elements(p_answer -> 'picked') e;
    if v_sum is null then
      return 0;
    end if;
    return greatest(0, least(10000, 10000 - abs(v_sum - (p_solution ->> 'target')::bigint) * (p_solution ->> 'step_bps')::integer))::integer;
  elsif p_game in ('offer', 'pattern') then
    if coalesce(jsonb_typeof(p_answer -> 'choices'), '') <> 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> 'choices');
    select count(*) into v_n
      from jsonb_array_elements(p_solution -> 'choices') with ordinality s(v, i)
      join jsonb_array_elements(p_answer -> 'choices') with ordinality a(v, i) on a.i = s.i
     where a.v = s.v;
    return (v_n * 10000) / greatest(v_total, 1);
  elsif p_game = 'shelf' then
    if coalesce(jsonb_typeof(p_answer -> 'grid'), '') <> 'array' or jsonb_array_length(p_answer -> 'grid') <> 16 then
      return 0;
    end if;
    if exists (select 1 from jsonb_array_elements(p_answer -> 'grid') e
                where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric % 1 <> 0
                   or (e #>> '{}')::numeric not between 0 and 3) then
      return 0;
    end if;
    select array_agg((e #>> '{}')::numeric::integer order by i) into v_cells
      from jsonb_array_elements(p_answer -> 'grid') with ordinality x(e, i);
    -- the givens stay
    if exists (select 1 from generate_series(0, 15) c
                where not (p_solution -> 'blanks') @> to_jsonb(c)
                  and v_cells[c + 1] <> (p_solution -> 'grid' ->> c)::integer) then
      return 0;
    end if;
    for v_i in select (b #>> '{}')::integer from jsonb_array_elements(p_solution -> 'blanks') b loop
      if not exists (select 1 from generate_series(0, 15) j
                      where j <> v_i and v_cells[j + 1] = v_cells[v_i + 1]
                        and (j / 4 = v_i / 4 or j % 4 = v_i % 4
                             or ((j / 4) / 2 = (v_i / 4) / 2 and (j % 4) / 2 = (v_i % 4) / 2))) then
        v_ok := v_ok + 1;
      end if;
    end loop;
    return (v_ok * 10000) / greatest(jsonb_array_length(p_solution -> 'blanks'), 1);
  end if;
  return 0;
end;
$$;
revoke all on function public.company_task_grade_more(text, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- E. Clones on the board (latest: company_tasks_state 1800, delegate_company_task and set_job_supervisor 0100)
-- ---------------------------------------------------------------------------
create or replace function public.company_tasks_state(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.company_tasks_cfg();
  m        record;
  pc       public.player_companies;
  c        public.companies;
  v_ai_ok  boolean;
begin
  select * into m from public.company_task_member(p_player);
  if m.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  select * into pc from public.player_companies where company_id = m.company_id;
  select * into c from public.companies where id = m.company_id;
  v_ai_ok := pc.ai_workers > 0
             and (m.is_founder or public.job_tier_rank(m.tier) >= public.job_tier_rank(cfg ->> 'aiDelegateMinTier'));
  return jsonb_build_object(
    'role', case when m.is_founder then 'founder' else 'employee' end,
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'tier', pc.tier, 'product', pc.product_key),
    'momentum', coalesce(pc.task_momentum, 1.0),  -- ADR-148
    'my_tier', m.tier,
    'auto_ai', pc.tasks_auto_ai,
    'ai_workers', pc.ai_workers,
    'ai_minutes', public.company_task_ai_minutes(m.company_id),
    'can_use_ai', v_ai_ok,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nickname', p.nickname, 'tag', p.tag, 'tier', j.tier, 'is_me', j.player_id = p_player and not j.is_clone,
               'is_clone', j.is_clone,  -- ADR-211: a clone works on its own, no tasks for it
               'supervisor', (select s.nickname from public.profiles s where s.id = j.supervisor_id),
               'reports_to_me', case when m.is_founder then j.supervisor_id is null
                                     else coalesce(j.supervisor_id = p_player, false) end,
               'open_tasks', (select count(*) from public.company_tasks t
                               where t.company_id = m.company_id and t.assignee_id = j.player_id
                                 and t.status in ('assigned', 'playing')))
             order by public.job_tier_rank(j.tier::text) desc, p.nickname)
        from public.player_jobs j join public.profiles p on p.id = j.player_id
       where j.company_id = m.company_id and j.status = 'active'), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'key', t.task_key, 'game', t.game, 'branch', t.branch, 'status', t.status,
               'value_cents', t.value_cents, 'created_at', t.created_at, 'due_at', t.due_at,
               'assignee', (select p.nickname from public.profiles p where p.id = t.assignee_id),
               'assignee_ai', t.assignee_ai,
               'assigned_by', (select p.nickname from public.profiles p where p.id = t.assigned_by),
               'ai_done_at', t.ai_done_at, 'opened_at', t.opened_at,
               'mine', coalesce(t.assignee_id = p_player, false),
               'can_delegate', t.status in ('open', 'assigned')
                               and (m.is_founder or t.status = 'open' or t.assignee_id = p_player))
             order by t.due_at)
        from public.company_tasks t
       where t.company_id = m.company_id and t.status in ('open', 'assigned', 'playing', 'ai')), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h order by h ->> 'resolved_at' desc)
        from (select jsonb_build_object('id', t.id, 'key', t.task_key, 'status', t.status, 'result_cents', t.result_cents,
                                        'score_bps', t.score_bps, 'ai', t.assignee_ai, 'resolved_at', t.resolved_at,
                                        'done_by', (select p.nickname from public.profiles p
                                                     where p.id = coalesce(t.done_by, t.assignee_id))) as h
                from public.company_tasks t
               where t.company_id = m.company_id and t.status in ('success', 'failure', 'missed')
               order by t.resolved_at desc
               limit (cfg ->> 'historyLimit')::integer) x), '[]'::jsonb));
end;
$$;
revoke all on function public.company_tasks_state(uuid) from public, anon, authenticated;

create or replace function public.delegate_company_task(p_request_id uuid, p_task_id bigint, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.company_tasks_cfg();
  v_player  uuid;
  v_replay  jsonb;
  m         record;
  t         public.company_tasks;
  v_target  uuid;
  v_tnick   text;
  v_me      text;
begin
  v_player := public.require_player();
  if p_request_id is null or p_task_id is null or p_to is null or length(p_to) > 40 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'delegate_company_task');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into m from public.company_task_member(v_player);
  select * into t from public.company_tasks where id = p_task_id for update;
  if t.id is null or m.company_id is null or t.company_id <> m.company_id then
    perform public.api_error('task_not_found');
  end if;
  if t.status not in ('open', 'assigned') or t.due_at <= public.game_now() then
    perform public.api_error('task_closed');
  end if;
  -- who may hand this task on: the founder always, others only open tasks or their own
  if not m.is_founder and t.status = 'assigned' and t.assignee_id is distinct from v_player then
    perform public.api_error('task_taken');
  end if;

  if p_to = 'ai' then
    if not m.is_founder and public.job_tier_rank(m.tier) < public.job_tier_rank(cfg ->> 'aiDelegateMinTier') then
      perform public.api_error('task_not_allowed');
    end if;
    perform public.company_task_to_ai(t.id, v_player);
    perform public.mission_event(v_player, 'task_delegated', 1, t.id::text);
  else
    if p_to = 'me' then
      v_target := v_player;
    else
      -- ADR-211: never to a clone (it cannot open the board)
      select j.player_id into v_target
        from public.player_jobs j join public.profiles p on p.id = j.player_id
       where j.company_id = m.company_id and j.status = 'active' and not j.is_clone and lower(p.nickname) = lower(p_to);
      if v_target is null then
        perform public.api_error('task_not_allowed');
      end if;
      -- employees delegate only to their own direct reports
      if not m.is_founder and not exists (select 1 from public.player_jobs j where j.player_id = v_target
                                             and j.company_id = m.company_id and j.status = 'active'
                                             and not j.is_clone and j.supervisor_id = v_player) then
        perform public.api_error('task_not_allowed');
      end if;
    end if;
    update public.company_tasks
       set status = 'assigned', assignee_id = v_target, assignee_ai = false, assigned_by = v_player,
           assigned_at = public.game_now(), ai_done_at = null
     where id = t.id;
    if v_target <> v_player then
      perform public.mission_event(v_player, 'task_delegated', 1, t.id::text);
      select p.nickname into v_me from public.profiles p where p.id = v_player;
      select p.nickname into v_tnick from public.profiles p where p.id = v_target;
      perform public.social_notify(v_target, 'company_task', v_me || ' gibt dir eine Aufgabe',
        'Erledige sie vor Ablauf der Frist im Job-Tab.', jsonb_build_object('task_id', t.id, 'task', t.task_key),
        '/job', 'company_task:' || t.id::text || ':' || v_target::text);
    end if;
  end if;
  return public.request_complete(v_player, p_request_id, public.company_tasks_state(v_player));
end;
$$;
revoke all on function public.delegate_company_task(uuid, bigint, text) from public, anon;
grant execute on function public.delegate_company_task(uuid, bigint, text) to authenticated;

create or replace function public.set_job_supervisor(p_request_id uuid, p_nickname text, p_supervisor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  pc        public.player_companies;
  j         public.player_jobs;
  s         public.player_jobs;
begin
  v_player := public.require_player();
  if p_request_id is null or p_nickname is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_job_supervisor');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where founder_id = v_player and status = 'active';
  if pc.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  select x.* into j from public.player_jobs x join public.profiles p on p.id = x.player_id
   where x.company_id = pc.company_id and x.status = 'active' and lower(p.nickname) = lower(p_nickname)
   for update of x;
  if j.id is null then
    perform public.api_error('task_not_allowed');
  end if;
  if p_supervisor is null or p_supervisor = '' then
    update public.player_jobs set supervisor_id = null where id = j.id;
  else
    -- ADR-211: a clone leads nobody (it never opens the board)
    select x.* into s from public.player_jobs x join public.profiles p on p.id = x.player_id
     where x.company_id = pc.company_id and x.status = 'active' and not x.is_clone and lower(p.nickname) = lower(p_supervisor);
    -- a supervisor has a higher rank, so the chain never loops
    if s.id is null or s.id = j.id or public.job_tier_rank(s.tier::text) <= public.job_tier_rank(j.tier::text) then
      perform public.api_error('task_not_allowed');
    end if;
    update public.player_jobs set supervisor_id = s.player_id where id = j.id;
  end if;
  return public.request_complete(v_player, p_request_id, public.company_tasks_state(v_player));
end;
$$;
revoke all on function public.set_job_supervisor(uuid, text, text) from public, anon;
grant execute on function public.set_job_supervisor(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- F. Once: tasks already handed to a clone or to someone who left are open again
-- ---------------------------------------------------------------------------
update public.company_tasks t
   set status = 'open', assignee_id = null, assignee_ai = false, assigned_by = null, assigned_at = null
 where t.status = 'assigned' and t.assignee_id is not null
   and not public.company_task_holder_ok(t.company_id, t.assignee_id);
