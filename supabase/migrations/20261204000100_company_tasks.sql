-- =============================================================================
-- NEXA · 0100 · Company tasks, supervisors and the news feed (ADR-129)
-- =============================================================================
-- Every player company gets small tasks that fit its product (game_config.companyTasks.tasks; product "*" = every
-- company), e.g. "pack every T-shirt in size M" for a fashion label. Someone has to do a task before its deadline
-- with a tiny game (pick, count, sort, order, seq, math). The server builds the puzzle, keeps the solution and grades
-- the answer; the time runs from opening. Success pays value x score from the households into the company cash,
-- a wrong answer or a missed deadline costs value x penaltyBps (company_costs). Every result is company news.
--
-- Hierarchy: the founder assigns a supervisor (player_jobs.supervisor_id, a higher rank) to employees. The founder
-- delegates any task; an employee may take open tasks and pass tasks of their own to their direct reports. From
-- aiDelegateMinTier on, tasks may go to the AI workers: slower (and slower with every queued task), less valuable,
-- not always right. With tasks_auto_ai the AI takes open tasks shortly before the deadline.
--
-- New tasks appear only while someone of the company was active recently, so a sleeping company does not bleed.
--
-- Tables (RLS, no client rights): company_tasks, fun_news. RPCs (authenticated):
--   get_company_tasks() -> TASKS (founder or employee of a player company)
--   delegate_company_task(p_request_id uuid, p_task_id bigint, p_to text) -> TASKS   p_to: 'me' | 'ai' | nickname
--   start_company_task(p_request_id uuid, p_task_id bigint) -> PLAY {"id","key","game","puzzle","opened_at","seconds",...}
--   submit_company_task(p_request_id uuid, p_task_id bigint, p_answer jsonb) -> RESULT
--   set_job_supervisor(p_request_id uuid, p_nickname text, p_supervisor text) -> TASKS (founder)
--   set_company_tasks_auto_ai(p_request_id uuid, p_on boolean) -> TASKS (founder)
--   get_news_feed(p_kind text default 'all', p_limit integer default 40) -> {"items": [...]}
-- Internal: company_tasks_run_due(p_now) (cron nexa-company-tasks), fun_news_run_due(p_now) (cron nexa-fun-news).
-- Errors: task_not_found NX110, task_taken NX111, task_not_allowed NX112, task_closed NX113, no_ai_workers NX114.
-- Idempotent: runs unchanged as supabase/updates/20261204000100_company_tasks.sql.

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.player_jobs add column if not exists supervisor_id uuid references public.profiles (id) on delete set null;
create index if not exists player_jobs_supervisor_idx on public.player_jobs (supervisor_id) where supervisor_id is not null;
comment on column public.player_jobs.supervisor_id is 'Direct supervisor in a player company (ADR-129); null = the founder.';

alter table public.player_companies add column if not exists tasks_auto_ai boolean not null default true;
alter table public.player_companies add column if not exists tasks_last_created_at timestamptz;

create table if not exists public.company_tasks (
  id             bigint generated always as identity primary key,
  company_id     uuid not null references public.companies (id) on delete cascade,
  task_key       text not null,
  branch         text not null,
  game           text not null check (game in ('pick', 'count', 'sort', 'order', 'seq', 'math')),
  status         text not null default 'open'
                 check (status in ('open', 'assigned', 'playing', 'ai', 'success', 'failure', 'missed')),
  value_cents    bigint not null check (value_cents > 0),
  created_at     timestamptz not null default now(),
  due_at         timestamptz not null,
  assignee_id    uuid references public.profiles (id) on delete set null,
  assignee_ai    boolean not null default false,
  assigned_by    uuid references public.profiles (id) on delete set null,
  assigned_at    timestamptz,
  ai_done_at     timestamptz,
  ai_chance_bps  integer,
  opened_at      timestamptz,
  puzzle         jsonb,
  solution       jsonb,
  answer         jsonb,
  score_bps      integer,
  result_cents   bigint not null default 0,
  done_by        uuid references public.profiles (id) on delete set null,
  resolved_at    timestamptz
);
alter table public.company_tasks enable row level security;
revoke all on public.company_tasks from public, anon, authenticated;
create index if not exists company_tasks_company_idx on public.company_tasks (company_id, created_at desc);
create index if not exists company_tasks_active_idx on public.company_tasks (due_at)
  where status in ('open', 'assigned', 'playing', 'ai');
create index if not exists company_tasks_assignee_idx on public.company_tasks (assignee_id) where assignee_id is not null;
create index if not exists company_tasks_assigned_by_idx on public.company_tasks (assigned_by);
create index if not exists company_tasks_done_by_idx on public.company_tasks (done_by);
comment on table public.company_tasks is 'Tasks of player companies with mini-games (ADR-129). Internal; read through get_company_tasks().';

create table if not exists public.fun_news (
  id          bigint generated always as identity primary key,
  item_key    text not null check (item_key ~ '^[a-z0-9_]+$'),
  company     text,
  ticker      text,
  nickname    text,
  created_at  timestamptz not null default now()
);
alter table public.fun_news enable row level security;
revoke all on public.fun_news from public, anon, authenticated;
create index if not exists fun_news_created_idx on public.fun_news (created_at desc);
comment on table public.fun_news is 'Funny filler news for the news tab (ADR-129); texts live in the client (funNews.items).';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('company_task', 'company', 'Neue Aufgabe', 'Jemand hat dir in der Firma eine Aufgabe gegeben.',
        'notif_company', true, true, false, 207)
on conflict (key) do nothing;

-- Error keys: patch api_error() after the last known key (same way as ADR-127)
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''no_ai_workers''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'move_resting'                then 'NX109'
$q$, $q$    when 'move_resting'                then 'NX109'
    when 'task_not_found'              then 'NX110'
    when 'task_taken'                  then 'NX111'
    when 'task_not_allowed'            then 'NX112'
    when 'task_closed'                 then 'NX113'
    when 'no_ai_workers'               then 'NX114'
$q$);
    if position('''no_ai_workers''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the task error keys by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- B. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.company_tasks_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'companyTasks'), '{}'::jsonb);
$$;

create or replace function public.job_tier_rank(p_tier text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_tier when 'c_level' then 5 when 'team_lead' then 4 when 'senior' then 3 when 'junior' then 2
                     when 'intern' then 1 else 0 end;
$$;

-- Random integer in [lo, hi]
create or replace function public.rand_between(p_lo integer, p_hi integer)
returns integer
language sql
volatile
set search_path = ''
as $$
  select p_lo + floor(random() * (p_hi - p_lo + 1))::integer;
$$;

-- Builds the puzzle of a task and its solution: {"puzzle": {...}, "solution": {...}}. Mirrors
-- src/lib/sim/company-tasks.ts (generatePuzzle).
create or replace function public.company_task_puzzle(p_task jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g        jsonb := public.company_tasks_cfg() -> 'games' -> (p_task ->> 'game');
  v_game   text := p_task ->> 'game';
  v_n      integer;
  v_tiles  jsonb;
  v_sol    jsonb;
  v_vals   integer[] := '{}';
  v_v      integer;
  a        integer;
  b        integer;
begin
  if v_game in ('pick', 'count') then
    v_n := public.rand_between((g ->> 'minTargets')::integer, (g ->> 'maxTargets')::integer);
    with t as (
      select i, case when i <= v_n then 0 else 1 + floor(random() * 2)::integer end as lab
        from generate_series(1, (g ->> 'tiles')::integer) i),
    s as (select lab, row_number() over (order by random()) - 1 as pos from t)
    select jsonb_agg(lab order by pos), coalesce(jsonb_agg(pos order by pos) filter (where lab = 0), '[]'::jsonb)
      into v_tiles, v_sol from s;
    if v_game = 'pick' then
      return jsonb_build_object('puzzle', jsonb_build_object('tiles', v_tiles), 'solution', jsonb_build_object('targets', v_sol));
    end if;
    return jsonb_build_object('puzzle', jsonb_build_object('tiles', v_tiles), 'solution', jsonb_build_object('count', v_n));
  elsif v_game = 'sort' then
    with s as (select i, row_number() over (order by random()) as pos from generate_series(0, (g ->> 'items')::integer - 1) i)
    select jsonb_agg(i order by pos), jsonb_agg(case when i < (g ->> 'items')::integer / 2 then 0 else 1 end order by pos)
      into v_tiles, v_sol from s;
    return jsonb_build_object('puzzle', jsonb_build_object('items', v_tiles), 'solution', jsonb_build_object('sides', v_sol));
  elsif v_game = 'order' then
    while coalesce(array_length(v_vals, 1), 0) < (g ->> 'items')::integer loop
      v_v := public.rand_between((g ->> 'min')::integer, (g ->> 'max')::integer);
      if not v_v = any (v_vals) then
        v_vals := v_vals || v_v;
      end if;
    end loop;
    select jsonb_agg(i - 1 order by case when coalesce((p_task ->> 'asc')::boolean, true) then v else -v end)
      into v_sol from unnest(v_vals) with ordinality as x(v, i);
    return jsonb_build_object('puzzle', jsonb_build_object('values', to_jsonb(v_vals)),
                              'solution', jsonb_build_object('order', v_sol));
  elsif v_game = 'seq' then
    select jsonb_agg(floor(random() * 4)::integer) into v_sol from generate_series(1, (g ->> 'length')::integer);
    return jsonb_build_object('puzzle', jsonb_build_object('sequence', v_sol, 'show_seconds', (g ->> 'showSeconds')::integer),
                              'solution', jsonb_build_object('sequence', v_sol));
  elsif v_game = 'math' then
    a := public.rand_between((p_task -> 'a' ->> 0)::integer, (p_task -> 'a' ->> 1)::integer);
    b := public.rand_between((p_task -> 'b' ->> 0)::integer, (p_task -> 'b' ->> 1)::integer);
    if p_task ->> 'op' = 'pct' then
      -- whole results: big amounts in hundreds, small ones in tens with rates in tens
      if (p_task -> 'a' ->> 1)::integer >= 1000 then
        a := greatest(100, (a / 100) * 100);
      else
        a := greatest(10, (a / 10) * 10);
        b := greatest(10, (b / 10) * 10);
      end if;
    end if;
    v_v := case p_task ->> 'op' when 'mul' then a * b when 'add' then a + b when 'sub' then a - b
                                when 'pct' then a * b / 100 end;
    return jsonb_build_object('puzzle', jsonb_build_object('a', a, 'b', b), 'solution', jsonb_build_object('value', v_v));
  end if;
  raise exception 'unknown task game %', v_game;
end;
$$;

-- Grades an answer: score in basis points (0..10000). Mirrors gradeAnswer in src/lib/sim/company-tasks.ts.
create or replace function public.company_task_grade(p_game text, p_solution jsonb, p_answer jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_hits    integer;
  v_wrong   integer;
  v_total   integer;
  v_diff    integer;
  v_key     text;
begin
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' then
    return 0;
  end if;
  if p_game = 'pick' then
    if jsonb_typeof(p_answer -> 'picked') <> 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> 'targets');
    select count(*) filter (where p_solution -> 'targets' @> to_jsonb(x)),
           count(*) filter (where not p_solution -> 'targets' @> to_jsonb(x))
      into v_hits, v_wrong
      from (select distinct x from jsonb_array_elements(p_answer -> 'picked') x) d;
    return greatest(0, least(10000, ((v_hits - v_wrong) * 10000) / greatest(v_total, 1)));
  elsif p_game in ('count', 'math') then
    v_key := case p_game when 'count' then 'count' else 'value' end;
    if jsonb_typeof(p_answer -> v_key) <> 'number' then
      return 0;
    end if;
    v_diff := abs((p_answer ->> v_key)::numeric - (p_solution ->> v_key)::numeric);
    return case when v_diff = 0 then 10000 when p_game = 'count' and v_diff = 1 then 5000 else 0 end;
  else
    v_key := case p_game when 'sort' then 'sides' when 'order' then 'order' else 'sequence' end;
    if jsonb_typeof(p_answer -> v_key) <> 'array' then
      return 0;
    end if;
    v_total := jsonb_array_length(p_solution -> v_key);
    select count(*) into v_hits
      from jsonb_array_elements(p_solution -> v_key) with ordinality s(v, i)
      join jsonb_array_elements(p_answer -> v_key) with ordinality a(v, i) on a.i = s.i
     where a.v = s.v;
    return (v_hits * 10000) / greatest(v_total, 1);
  end if;
end;
$$;

-- The caller's place in a player company: founder or active employee
create or replace function public.company_task_member(p_player uuid)
returns table (company_id uuid, is_founder boolean, tier text, job_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select pc.company_id, true, 'c_level'::text, null::uuid
    from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active'
  union all
  select j.company_id, false, j.tier::text, j.id
    from public.player_jobs j
    join public.player_companies pc on pc.company_id = j.company_id and pc.status = 'active'
   where j.player_id = p_player and j.status = 'active'
  limit 1;
$$;

-- Finishes a task: books the money, writes news, grants XP. p_score null = deadline missed.
create or replace function public.company_task_resolve(p_task_id bigint, p_score integer, p_by_ai boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.company_tasks_cfg();
  t         public.company_tasks;
  v_ok      boolean;
  v_amount  bigint := 0;
  v_avail   bigint;
  v_status  text;
  v_xp      integer := 0;
  v_nick    text;
begin
  select * into t from public.company_tasks where id = p_task_id for update;
  if t.id is null or t.status in ('success', 'failure', 'missed') then
    return null;
  end if;
  v_ok := p_score is not null and p_score >= (cfg ->> 'passScoreBps')::integer;
  if v_ok then
    v_amount := (t.value_cents * p_score) / 10000;
    if p_by_ai then
      v_amount := (v_amount * (cfg -> 'ai' ->> 'valueBps')::integer) / 10000;
    end if;
    select a.balance_cents into v_avail from public.ledger_accounts a
     where a.id = public.ledger_system_account('households') for update;
    v_amount := least(v_amount, greatest(coalesce(v_avail, 0), 0));
    if v_amount > 0 then
      perform public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(t.company_id),
                                     v_amount, 'company_revenue', 'Aufgabe erledigt: ' || t.task_key, 'company', t.company_id,
                                     'task:result:' || t.id::text, t.done_by, jsonb_build_object('task', t.task_key));
    end if;
    v_status := 'success';
  else
    v_amount := (t.value_cents * (cfg ->> 'penaltyBps')::integer) / 10000;
    select a.balance_cents into v_avail from public.ledger_accounts a
     where a.id = public.company_cash_account(t.company_id) for update;
    v_amount := least(v_amount, greatest(coalesce(v_avail, 0), 0));
    if v_amount > 0 then
      perform public.ledger_transfer(public.company_cash_account(t.company_id), public.ledger_system_account('households'),
                                     v_amount, 'company_costs', 'Aufgabe verpatzt: ' || t.task_key, 'company', t.company_id,
                                     'task:result:' || t.id::text, t.done_by, jsonb_build_object('task', t.task_key));
    end if;
    v_status := case when p_score is null then 'missed' else 'failure' end;
    v_amount := -v_amount;
  end if;
  -- missions (ADR-130): done right, done perfectly
  if v_ok and t.done_by is not null and not p_by_ai then
    perform public.mission_event(t.done_by, 'task_done', 1, t.id::text);
    if p_score >= 10000 then
      perform public.mission_event(t.done_by, 'task_perfect', 1, t.id::text);
    end if;
  end if;
  if t.done_by is not null and not p_by_ai then
    v_xp := public.grant_xp(t.done_by, 'work_task',
                            case when v_ok then (cfg -> 'xp' ->> 'success')::integer else (cfg -> 'xp' ->> 'failure')::integer end,
                            'company_task:' || t.id::text, 'company_task', null);
  end if;
  update public.company_tasks
     set status = v_status, score_bps = p_score, result_cents = v_amount, resolved_at = public.game_now()
   where id = t.id;
  select p.nickname into v_nick from public.profiles p where p.id = coalesce(t.done_by, t.assignee_id);
  perform public.company_news_add(t.company_id, 'task_' || v_status,
    jsonb_build_object('task', t.task_key, 'amount_cents', v_amount, 'nickname', v_nick, 'ai', p_by_ai));
  return jsonb_build_object('status', v_status, 'score_bps', p_score, 'result_cents', v_amount, 'xp', v_xp);
end;
$$;

-- Minutes the AI needs for a task right now: slower with every task it already works on
create or replace function public.company_task_ai_minutes(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select ceil((c -> 'ai' ->> 'minutes')::numeric
              * (1 + (select count(*) from public.company_tasks t where t.company_id = p_company and t.status = 'ai')
                   * (c -> 'ai' ->> 'slowdownPerQueuedBps')::numeric / 10000))::integer
    from (select public.company_tasks_cfg() as c) x;
$$;

create or replace function public.company_task_to_ai(p_task_id bigint, p_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.company_tasks_cfg();
  t       public.company_tasks;
  pc      public.player_companies;
  v_bonus integer := 0;
begin
  select * into t from public.company_tasks where id = p_task_id for update;
  select * into pc from public.player_companies where company_id = t.company_id;
  if coalesce(pc.ai_workers, 0) <= 0 then
    perform public.api_error('no_ai_workers');
  end if;
  if exists (select 1 from unnest(coalesce(pc.ai_worker_skills, '{}'::text[])) s where s like t.branch || '\_%') then
    v_bonus := (cfg -> 'ai' ->> 'skillBonusBps')::integer;
  end if;
  update public.company_tasks
     set status = 'ai', assignee_ai = true, assignee_id = null, assigned_by = p_by, assigned_at = public.game_now(),
         ai_done_at = public.game_now() + make_interval(mins => public.company_task_ai_minutes(t.company_id)),
         ai_chance_bps = least(9500, (cfg -> 'ai' ->> 'chanceBps')::integer + v_bonus)
   where id = t.id;
end;
$$;

-- State of the task board for one player
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
    'my_tier', m.tier,
    'auto_ai', pc.tasks_auto_ai,
    'ai_workers', pc.ai_workers,
    'ai_minutes', public.company_task_ai_minutes(m.company_id),
    'can_use_ai', v_ai_ok,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nickname', p.nickname, 'tag', p.tag, 'tier', j.tier, 'is_me', j.player_id = p_player,
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

-- ---------------------------------------------------------------------------
-- C. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_company_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.company_tasks_state(public.require_player());
end;
$$;

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
      select j.player_id into v_target
        from public.player_jobs j join public.profiles p on p.id = j.player_id
       where j.company_id = m.company_id and j.status = 'active' and lower(p.nickname) = lower(p_to);
      if v_target is null then
        perform public.api_error('task_not_allowed');
      end if;
      -- employees delegate only to their own direct reports
      if not m.is_founder and not exists (select 1 from public.player_jobs j where j.player_id = v_target
                                             and j.company_id = m.company_id and j.status = 'active'
                                             and j.supervisor_id = v_player) then
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

create or replace function public.company_task_play_json(t public.company_tasks)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', t.id, 'key', t.task_key, 'game', t.game, 'puzzle', t.puzzle, 'opened_at', t.opened_at,
                            'seconds', (public.company_tasks_cfg() -> 'games' -> t.game ->> 'seconds')::integer,
                            'value_cents', t.value_cents, 'due_at', t.due_at);
$$;

create or replace function public.start_company_task(p_request_id uuid, p_task_id bigint)
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
  v_def     jsonb;
  v_pz      jsonb;
begin
  v_player := public.require_player();
  if p_request_id is null or p_task_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'start_company_task');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into m from public.company_task_member(v_player);
  select * into t from public.company_tasks where id = p_task_id for update;
  if t.id is null or m.company_id is null or t.company_id <> m.company_id then
    perform public.api_error('task_not_found');
  end if;
  if t.status = 'playing' and t.assignee_id = v_player then
    return public.request_complete(v_player, p_request_id, public.company_task_play_json(t));
  end if;
  if t.status not in ('open', 'assigned') or t.due_at <= public.game_now() then
    perform public.api_error('task_closed');
  end if;
  if t.status = 'assigned' and t.assignee_id is distinct from v_player then
    perform public.api_error('task_taken');
  end if;
  select x into v_def from jsonb_array_elements(cfg -> 'tasks') x where x ->> 'key' = t.task_key;
  if v_def is null then
    perform public.api_error('task_not_found');
  end if;
  v_pz := public.company_task_puzzle(v_def);
  update public.company_tasks
     set status = 'playing', assignee_id = v_player, assignee_ai = false,
         assigned_by = coalesce(assigned_by, v_player), assigned_at = coalesce(assigned_at, public.game_now()),
         opened_at = public.game_now(), puzzle = v_pz -> 'puzzle', solution = v_pz -> 'solution'
   where id = t.id
  returning * into t;
  return public.request_complete(v_player, p_request_id, public.company_task_play_json(t));
end;
$$;

create or replace function public.submit_company_task(p_request_id uuid, p_task_id bigint, p_answer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.company_tasks_cfg();
  v_player  uuid;
  v_replay  jsonb;
  t         public.company_tasks;
  v_limit   numeric;
  v_score   integer;
  v_res     jsonb;
begin
  v_player := public.require_player();
  if p_request_id is null or p_task_id is null or p_answer is null or length(p_answer::text) > 2000 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'submit_company_task');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into t from public.company_tasks where id = p_task_id for update;
  if t.id is null or t.assignee_id is distinct from v_player then
    perform public.api_error('task_not_found');
  end if;
  if t.status <> 'playing' then
    perform public.api_error('task_closed');
  end if;
  v_limit := (cfg -> 'games' -> t.game ->> 'seconds')::numeric + (cfg ->> 'graceSeconds')::numeric;
  if extract(epoch from (public.game_now() - t.opened_at)) > v_limit then
    v_score := 0;
  else
    v_score := public.company_task_grade(t.game, t.solution, p_answer);
  end if;
  update public.company_tasks set answer = p_answer, done_by = v_player where id = t.id;
  v_res := public.company_task_resolve(t.id, v_score, false);
  return public.request_complete(v_player, p_request_id,
    v_res || jsonb_build_object('id', t.id, 'key', t.task_key, 'solution', t.solution, 'answer', p_answer,
                                'late', v_score = 0 and extract(epoch from (public.game_now() - t.opened_at)) > v_limit));
end;
$$;

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
    select x.* into s from public.player_jobs x join public.profiles p on p.id = x.player_id
     where x.company_id = pc.company_id and x.status = 'active' and lower(p.nickname) = lower(p_supervisor);
    -- a supervisor has a higher rank, so the chain never loops
    if s.id is null or s.id = j.id or public.job_tier_rank(s.tier::text) <= public.job_tier_rank(j.tier::text) then
      perform public.api_error('task_not_allowed');
    end if;
    update public.player_jobs set supervisor_id = s.player_id where id = j.id;
  end if;
  return public.request_complete(v_player, p_request_id, public.company_tasks_state(v_player));
end;
$$;

create or replace function public.set_company_tasks_auto_ai(p_request_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
begin
  v_player := public.require_player();
  if p_request_id is null or p_on is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_company_tasks_auto_ai');
  if v_replay is not null then
    return v_replay;
  end if;
  update public.player_companies set tasks_auto_ai = p_on where founder_id = v_player and status = 'active';
  if not found then
    perform public.api_error('company_not_found');
  end if;
  return public.request_complete(v_player, p_request_id, public.company_tasks_state(v_player));
end;
$$;

-- ---------------------------------------------------------------------------
-- D. Minute job: AI results, deadlines, auto AI, new tasks
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
    perform public.company_task_resolve(r.id,
      case when r.ai_done_at <= r.due_at and random() * 10000 < r.ai_chance_bps then 10000 else 0 end, true);
    v_ai := v_ai + 1;
  end loop;
  -- games opened and never answered
  for r in select t.* from public.company_tasks t
            where t.status = 'playing'
              and t.opened_at + make_interval(secs => (cfg -> 'games' -> t.game ->> 'seconds')::integer
                                                      + (cfg ->> 'graceSeconds')::integer + 60) <= v_now
            for update skip locked loop
    update public.company_tasks set done_by = assignee_id where id = r.id;
    perform public.company_task_resolve(r.id, 0, false);
  end loop;
  -- auto AI shortly before the deadline
  for r in select t.id, pc.founder_id from public.company_tasks t
             join public.player_companies pc on pc.company_id = t.company_id
            where t.status = 'open' and pc.tasks_auto_ai and pc.ai_workers > 0
              and t.due_at - make_interval(mins => (b ->> 'autoAiBeforeDueMinutes')::integer) <= v_now and t.due_at > v_now
            for update of t skip locked loop
    perform public.company_task_to_ai(r.id, null);
  end loop;
  -- missed deadlines
  for r in select * from public.company_tasks where status in ('open', 'assigned') and due_at <= v_now for update skip locked loop
    perform public.company_task_resolve(r.id, null, false);
    v_missed := v_missed + 1;
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
    v_target := least((b ->> 'max')::integer,
                      (b ->> 'base')::integer + (1 + r.staff + coalesce(r.ai_workers, 0)) / (b ->> 'membersPerTask')::integer);
    select count(*) into v_open from public.company_tasks t
     where t.company_id = r.company_id and t.status in ('open', 'assigned', 'playing', 'ai');
    continue when v_open >= v_target;
    select x into v_def from jsonb_array_elements(cfg -> 'tasks') x
     where (x ->> 'product' = '*' or x ->> 'product' = r.product_key)
       and not exists (select 1 from public.company_tasks t where t.company_id = r.company_id and t.task_key = x ->> 'key'
                         and t.status in ('open', 'assigned', 'playing', 'ai'))
     order by case when x ->> 'product' = '*' then random() * 2 else random() end
     limit 1;
    continue when v_def is null;
    insert into public.company_tasks (company_id, task_key, branch, game, value_cents, created_at, due_at)
    values (r.company_id, v_def ->> 'key', v_def ->> 'branch', v_def ->> 'game',
            greatest(1, round((cfg -> 'valueCentsByTier' ->> r.tier::text)::numeric * (v_def ->> 'factor')::numeric)::bigint),
            v_now, v_now + make_interval(mins => (v_def ->> 'minutes')::integer));
    update public.player_companies set tasks_last_created_at = v_now where company_id = r.company_id;
    v_new := v_new + 1;
  end loop;
  delete from public.company_tasks where resolved_at < v_now - interval '3 days';
  return jsonb_build_object('ai', v_ai, 'missed', v_missed, 'new', v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- E. News feed: stock tips, company news of all player companies, market news and funny news
-- ---------------------------------------------------------------------------
create or replace function public.fun_news_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := coalesce((select value from public.game_config where key = 'funNews'), '{}'::jsonb);
  v_now   timestamptz := coalesce(p_now, public.game_now());
  v_item  jsonb;
  v_co    record;
  v_nick  text;
begin
  if cfg -> 'items' is null then
    return jsonb_build_object('skipped', 'no config');
  end if;
  if exists (select 1 from public.fun_news f where f.created_at > v_now - make_interval(mins => (cfg ->> 'everyMinutes')::integer)) then
    return jsonb_build_object('skipped', 'too early');
  end if;
  select x into v_item from jsonb_array_elements(cfg -> 'items') x
   where not exists (select 1 from public.fun_news f where f.item_key = x ->> 'key'
                       and f.created_at > v_now - make_interval(hours => (cfg ->> 'repeatHours')::integer))
   order by random() limit 1;
  if v_item is null then
    return jsonb_build_object('skipped', 'all used');
  end if;
  select c.name, s.ticker into v_co from public.companies c join public.securities s on s.company_id = c.id
   where c.is_ai and s.status = 'listed' order by random() limit 1;
  select p.nickname into v_nick from public.profiles p
   where p.last_active_at > v_now - interval '1 day' and not p.is_deactivated order by random() limit 1;
  if v_item ->> 'needs' = 'player' and v_nick is null then
    return jsonb_build_object('skipped', 'no player');
  end if;
  insert into public.fun_news (item_key, company, ticker, nickname, created_at)
  values (v_item ->> 'key', v_co.name, v_co.ticker, v_nick, v_now);
  delete from public.fun_news where created_at < v_now - make_interval(hours => (cfg ->> 'keepHours')::integer);
  return jsonb_build_object('created', v_item ->> 'key');
end;
$$;

create or replace function public.get_news_feed(p_kind text default 'all', p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_limit  integer := least(greatest(coalesce(p_limit, 40), 1), 80);
  v_kind   text := coalesce(p_kind, 'all');
begin
  if v_kind not in ('all', 'stock', 'company', 'market', 'fun') then
    perform public.api_error('invalid_argument');
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(x.item order by x.at desc)
      from (
        (select jsonb_build_object('id', 's' || st.id, 'kind', 'stock', 'at', st.published_at, 'headline', st.headline,
                                   'body', st.body, 'ticker', s.ticker, 'name', c.name,
                                   'direction', case when st.direction > 0 then 'up' else 'down' end) as item,
                st.published_at as at
           from public.stock_tips st join public.securities s on s.id = st.security_id
           join public.companies c on c.id = s.company_id
          where v_kind in ('all', 'stock') and st.published_at <= public.game_now()
          order by st.published_at desc limit v_limit)
        union all
        (select jsonb_build_object('id', 'c' || n.id, 'kind', 'company', 'at', n.created_at, 'news_kind', n.kind,
                                   'payload', n.payload, 'name', c.name, 'product', pc.product_key, 'tier', pc.tier,
                                   'headline', n.ai_headline),
                n.created_at
           from public.company_news n join public.companies c on c.id = n.company_id
           join public.player_companies pc on pc.company_id = n.company_id
          where v_kind in ('all', 'company')
            and n.kind in ('task_success', 'task_failure', 'task_missed', 'founded', 'upgraded', 'expanded', 'ipo',
                           'hired', 'record_hour', 'pitch_success', 'pitch_failure', 'pitch_backfire')
          order by n.created_at desc limit v_limit)
        union all
        (select jsonb_build_object('id', 'm' || ni.id, 'kind', 'market', 'at', ni.published_at, 'headline', ni.headline,
                                   'body', ni.body, 'category', ni.category,
                                   'ticker', (select s.ticker from public.securities s where s.id = ni.security_id)),
                ni.published_at
           from public.news_items ni
          where v_kind in ('all', 'market') and ni.published_at <= public.game_now()
            and ni.category in ('macro', 'central_bank', 'ipo', 'index', 'regulator', 'market', 'earnings')
            and ni.importance >= case when ni.category = 'earnings' then 2 else 1 end
          order by ni.published_at desc limit v_limit)
        union all
        (select jsonb_build_object('id', 'f' || f.id, 'kind', 'fun', 'at', f.created_at, 'item_key', f.item_key,
                                   'name', f.company, 'ticker', f.ticker, 'nickname', f.nickname),
                f.created_at
           from public.fun_news f
          where v_kind in ('all', 'fun')
          order by f.created_at desc limit v_limit)
      ) x
     limit v_limit), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Org chart: who reports to whom
-- ---------------------------------------------------------------------------
create or replace function public.get_company_org(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  pc       public.player_companies;
  c        public.companies;
begin
  select * into pc from public.player_companies where company_id = p_company_id and status = 'active';
  if pc.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  select * into c from public.companies where id = p_company_id;
  -- open to every player (ADR-125): the org chart shows who works where, nothing more
  return jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'tier', pc.tier),
    'founder', (select jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key,
                                          'is_me', p.id = v_player)
                  from public.profiles p where p.id = pc.founder_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key, 'tier', j.tier,
                                          'title', coalesce(j.title, j.title_key), 'since', j.started_at,
                                          'is_me', j.player_id = v_player,
                                          'supervisor', (select s.nickname from public.profiles s where s.id = j.supervisor_id))
                       order by case j.tier::text when 'c_level' then 5 when 'team_lead' then 4 when 'senior' then 3
                                                  when 'junior' then 2 else 1 end desc, j.started_at, p.nickname)
        from public.player_jobs j join public.profiles p on p.id = j.player_id
       where j.company_id = p_company_id and j.status = 'active'), '[]'::jsonb),
    'ai_workers', pc.ai_workers,
    'ai_worker_skills', to_jsonb(coalesce(pc.ai_worker_skills, '{}'::text[])));
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Rights and jobs
-- ---------------------------------------------------------------------------
revoke all on function public.company_tasks_cfg() from public, anon, authenticated;
revoke all on function public.job_tier_rank(text) from public, anon, authenticated;
revoke all on function public.rand_between(integer, integer) from public, anon, authenticated;
revoke all on function public.company_task_puzzle(jsonb) from public, anon, authenticated;
revoke all on function public.company_task_grade(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.company_task_member(uuid) from public, anon, authenticated;
revoke all on function public.company_task_resolve(bigint, integer, boolean) from public, anon, authenticated;
revoke all on function public.company_task_ai_minutes(uuid) from public, anon, authenticated;
revoke all on function public.company_task_to_ai(bigint, uuid) from public, anon, authenticated;
revoke all on function public.company_tasks_state(uuid) from public, anon, authenticated;
revoke all on function public.company_task_play_json(public.company_tasks) from public, anon, authenticated;
revoke all on function public.company_tasks_run_due(timestamptz) from public, anon, authenticated;
revoke all on function public.fun_news_run_due(timestamptz) from public, anon, authenticated;
grant execute on function public.company_tasks_run_due(timestamptz) to service_role;
grant execute on function public.fun_news_run_due(timestamptz) to service_role;

revoke all on function public.get_company_tasks() from public, anon;
revoke all on function public.delegate_company_task(uuid, bigint, text) from public, anon;
revoke all on function public.start_company_task(uuid, bigint) from public, anon;
revoke all on function public.submit_company_task(uuid, bigint, jsonb) from public, anon;
revoke all on function public.set_job_supervisor(uuid, text, text) from public, anon;
revoke all on function public.set_company_tasks_auto_ai(uuid, boolean) from public, anon;
revoke all on function public.get_news_feed(text, integer) from public, anon;
grant execute on function public.get_company_tasks() to authenticated;
grant execute on function public.delegate_company_task(uuid, bigint, text) to authenticated;
grant execute on function public.start_company_task(uuid, bigint) to authenticated;
grant execute on function public.submit_company_task(uuid, bigint, jsonb) to authenticated;
grant execute on function public.set_job_supervisor(uuid, text, text) to authenticated;
grant execute on function public.set_company_tasks_auto_ai(uuid, boolean) to authenticated;
grant execute on function public.get_news_feed(text, integer) to authenticated;

comment on function public.get_company_tasks() is 'RPC: task board of the own player company (ADR-129).';
comment on function public.delegate_company_task(uuid, bigint, text) is 'RPC: take a task or hand it to a report or the AI (ADR-129).';
comment on function public.start_company_task(uuid, bigint) is 'RPC: open a task game; the time runs from here (ADR-129).';
comment on function public.submit_company_task(uuid, bigint, jsonb) is 'RPC: answer a task game; graded on the server (ADR-129).';
comment on function public.set_job_supervisor(uuid, text, text) is 'RPC: the founder sets who an employee reports to (ADR-129).';
comment on function public.set_company_tasks_auto_ai(uuid, boolean) is 'RPC: AI takes open tasks before the deadline (ADR-129).';
comment on function public.get_news_feed(text, integer) is 'RPC: stock, company, market and funny news in one feed (ADR-129).';

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('nexa-company-tasks', 'nexa-fun-news');
    perform cron.schedule('nexa-company-tasks', '* * * * *', 'select public.company_tasks_run_due()');
    perform cron.schedule('nexa-fun-news', '* * * * *', 'select public.fun_news_run_due()');
  end if;
end;
$do$;
