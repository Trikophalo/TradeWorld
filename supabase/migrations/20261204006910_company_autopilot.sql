-- =============================================================================
-- NEXA · 6910 · Company autopilot and task pay with the strengths (ADR-180)
-- =============================================================================
-- * company_autopilot: per company on/off (founder). While on, company_autopilot_run() (called by the minutely
--   company_tasks_run_due) takes every open task that waited companyTasks.autopilot.delayMinutes and resolves it
--   without a mini-game: chance = base + (max - base) x mood (src/lib/sim/company-autopilot.ts), mood = employee
--   satisfaction (listed) or the "Team" strength (private). Success pays rewardBps of a perfect run x the chance above
--   100 %; failure costs failPenaltyBps. Without anyone active it creates a task every everyMinutes itself, at most
--   maxPerDay autopilot tasks per Berlin day. company_autopilot_log keeps every result; from summaryHour the founder
--   gets one notification with the night's summary.
-- * company_task_resolve (patched by replace): the autopilot share, the strengths pay factor on every success
--   (company_task_pay_factor_bps, 0.9x..1.5x) and awareness for every solved task (company_awareness_boost).
-- * get_company_autopilot() / set_company_autopilot(): state, today's numbers, the log and the last hour's economy.
-- Idempotent: runs unchanged as supabase/updates/20261204006910_company_autopilot.sql.

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.company_tasks add column if not exists autopilot_chance_bps integer;
comment on column public.company_tasks.autopilot_chance_bps is
  'Set when the autopilot resolved the task (ADR-180): the chance it had, in bps (up to 12 000).';

create table if not exists public.company_autopilot (
  company_id      uuid primary key references public.player_companies (company_id) on delete cascade,
  enabled         boolean not null default false,
  enabled_at      timestamptz,
  summary_sent_on date,
  updated_at      timestamptz not null default now()
);
alter table public.company_autopilot enable row level security;
drop trigger if exists set_updated_at on public.company_autopilot;
create trigger set_updated_at before update on public.company_autopilot
  for each row execute function public.set_updated_at();
revoke all on public.company_autopilot from anon, authenticated;
comment on table public.company_autopilot is
  'Autopilot per player company (ADR-180). Read and written through get_company_autopilot / set_company_autopilot.';

create table if not exists public.company_autopilot_log (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.player_companies (company_id) on delete cascade,
  task_id      bigint,
  task_key     text not null,
  success      boolean not null,
  result_cents bigint not null,
  chance_bps   integer not null check (chance_bps >= 0),
  at           timestamptz not null default now()
);
create index if not exists company_autopilot_log_company_at on public.company_autopilot_log (company_id, at desc);
alter table public.company_autopilot_log enable row level security;
revoke all on public.company_autopilot_log from anon, authenticated;
comment on table public.company_autopilot_log is
  'Every task the autopilot resolved (ADR-180); kept 7 days. Read through get_company_autopilot.';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('company_autopilot', 'company', 'Autopilot', 'Morgens: was der Autopilot deiner Firma über Nacht erledigt hat.',
        'notif_company', true, true, false, 211)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Rules (ports of src/lib/sim/company-autopilot.ts)
-- ---------------------------------------------------------------------------
create or replace function public.company_strengths_overall_of(p_company uuid)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.company_strengths_overall(s.scores) from public.company_strengths s
                    where s.company_id = p_company), 0);
$$;

-- task pay factor from the strengths: minBps at overall 0 .. maxBps at 100 (taskPayFactorBps)
create or replace function public.company_task_pay_factor_bps(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select floor(public.cfg_num(public.company_tasks_cfg(), '{strengthPay,minBps}', 9000)
               + (public.cfg_num(public.company_tasks_cfg(), '{strengthPay,maxBps}', 15000)
                  - public.cfg_num(public.company_tasks_cfg(), '{strengthPay,minBps}', 9000))
                 * least(100, greatest(0, public.company_strengths_overall_of(p_company))) / 100)::integer;
$$;

-- mood 0..1 (autopilotMood): satisfaction of a listed company, else the "Team" strength
create or replace function public.company_autopilot_mood(p_company uuid)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select least(1.0, greatest(0.0, coalesce(
    (select l.satisfaction from public.listed_companies l where l.company_id = p_company),
    (select (s.scores ->> 'team')::double precision from public.company_strengths s where s.company_id = p_company),
    0) / 100.0));
$$;

-- chance in bps (autopilotChanceBps)
create or replace function public.company_autopilot_chance_bps(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select floor(public.cfg_num(public.company_tasks_cfg(), '{autopilot,baseChanceBps}', 6000)
               + (public.cfg_num(public.company_tasks_cfg(), '{autopilot,maxChanceBps}', 12000)
                  - public.cfg_num(public.company_tasks_cfg(), '{autopilot,baseChanceBps}', 6000))
                 * public.company_autopilot_mood(p_company))::integer;
$$;

-- ---------------------------------------------------------------------------
-- C. Resolving a task (patched by replace)
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text := pg_get_functiondef('public.company_task_resolve(bigint, integer, boolean)'::regprocedure);
  a1 text := $a$    if p_by_ai then
      v_amount := (v_amount * (cfg -> 'ai' ->> 'valueBps')::integer) / 10000;
    end if;$a$;
  b1 text := $b$    if t.autopilot_chance_bps is not null then
      -- ADR-180 autopilot: its share of a perfect run, the chance above 100 % as a bonus
      v_amount := (v_amount * (cfg -> 'autopilot' ->> 'rewardBps')::integer) / 10000;
      v_amount := (v_amount * greatest(10000, t.autopilot_chance_bps)) / 10000;
    elsif p_by_ai then
      v_amount := (v_amount * (cfg -> 'ai' ->> 'valueBps')::integer) / 10000;
    end if;
    -- ADR-180: strong companies earn more per task (0.9x .. 1.5x by the six strengths)
    v_amount := (v_amount * public.company_task_pay_factor_bps(t.company_id)) / 10000;$b$;
  a2 text := $a$    v_amount := (t.value_cents * (cfg ->> 'penaltyBps')::integer) / 10000;$a$;
  b2 text := $b$    v_amount := (t.value_cents * case when t.autopilot_chance_bps is not null
                                      then (cfg -> 'autopilot' ->> 'failPenaltyBps')::integer
                                      else (cfg ->> 'penaltyBps')::integer end) / 10000;  -- ADR-180$b$;
  a3 text := $a$  perform public.company_task_momentum_apply(t.company_id, p_score, p_by_ai);$a$;
  b3 text := $b$  perform public.company_task_momentum_apply(t.company_id, p_score, p_by_ai);
  -- ADR-180: a solved task makes the company a little better known at once (AI and autopilot half)
  if v_ok then
    perform public.company_awareness_boost(t.company_id,
      public.config_double('startups', '{awareness,taskGain}', 0.002)
      * case when p_by_ai then public.config_double('startups', '{awareness,taskAiShareBps}', 5000) / 10000.0 else 1 end);
  end if;$b$;
begin
  if position('ADR-180' in v_def) > 0 then
    return;
  end if;
  if position(a1 in v_def) = 0 then raise exception 'NEXA 6910: task_resolve anchor (AI share) missing'; end if;
  if position(a2 in v_def) = 0 then raise exception 'NEXA 6910: task_resolve anchor (penalty) missing'; end if;
  if position(a3 in v_def) = 0 then raise exception 'NEXA 6910: task_resolve anchor (momentum) missing'; end if;
  execute replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3);
end;
$patch$;

-- ---------------------------------------------------------------------------
-- D. The autopilot run (every minute from company_tasks_run_due)
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
    select count(*) into v_today from public.company_autopilot_log l where l.company_id = r.company_id and l.at >= v_day0;
    v_left := (ap ->> 'maxPerDay')::integer - v_today;
    -- nobody around: the autopilot brings its own work, slowly
    if v_left > 0
       and (r.tasks_last_created_at is null or r.tasks_last_created_at <= v_now - make_interval(mins => (ap ->> 'everyMinutes')::integer))
       and not exists (select 1 from public.company_tasks x where x.company_id = r.company_id and x.status in ('open', 'assigned', 'playing', 'ai'))
    then
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
  end loop;
  delete from public.company_autopilot_log where at < v_now - interval '7 days';
  return jsonb_build_object('done', v_done, 'new', v_new, 'summaries', v_sent);
end;
$$;
revoke all on function public.company_autopilot_run(timestamptz) from public, anon, authenticated;

do $patch$
declare
  v_def text := pg_get_functiondef('public.company_tasks_run_due(timestamptz)'::regprocedure);
  a1 text := $a$  delete from public.company_tasks where resolved_at < v_now - interval '3 days';$a$;
begin
  if position('company_autopilot_run' in v_def) > 0 then
    return;
  end if;
  if position(a1 in v_def) = 0 then raise exception 'NEXA 6910: tasks_run_due anchor (cleanup) missing'; end if;
  execute replace(v_def, a1, '  perform public.company_autopilot_run(v_now);  -- ADR-180' || chr(10) || a1);
end;
$patch$;

-- ---------------------------------------------------------------------------
-- E. API
-- ---------------------------------------------------------------------------
create or replace function public.company_autopilot_json(p_company uuid, p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ap      jsonb := public.company_tasks_cfg() -> 'autopilot';
  v_now   timestamptz := public.game_now();
  v_day0  timestamptz := date_trunc('day', public.game_now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  a       public.company_autopilot;
  pc      public.player_companies;
  h       public.player_company_hours;
  v_today jsonb;
  v_log   jsonb;
begin
  select * into pc from public.player_companies where company_id = p_company;
  select * into a from public.company_autopilot where company_id = p_company;
  select jsonb_build_object('done', count(*), 'success', count(*) filter (where l.success),
                            'cents', coalesce(sum(l.result_cents), 0))
    into v_today from public.company_autopilot_log l where l.company_id = p_company and l.at >= v_day0;
  select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'key', x.task_key, 'success', x.success,
                                               'result_cents', x.result_cents, 'chance_bps', x.chance_bps) order by x.at desc, x.id desc), '[]'::jsonb)
    into v_log
    from (select * from public.company_autopilot_log l where l.company_id = p_company
           order by l.at desc, l.id desc limit coalesce((ap ->> 'logLimit')::integer, 15)) x;
  select * into h from public.player_company_hours x where x.company_id = p_company order by x.hour_start desc limit 1;
  return jsonb_build_object(
    'on', coalesce(a.enabled, false),
    'can_toggle', pc.founder_id = p_player,
    'mood', public.company_autopilot_mood(p_company),
    'chance_bps', public.company_autopilot_chance_bps(p_company),
    'reward_bps', (ap ->> 'rewardBps')::integer,
    'fail_penalty_bps', (ap ->> 'failPenaltyBps')::integer,
    'max_per_day', (ap ->> 'maxPerDay')::integer,
    'every_minutes', (ap ->> 'everyMinutes')::integer,
    'pay_factor_bps', public.company_task_pay_factor_bps(p_company),
    'today', v_today,
    'log', v_log,
    'last_hour', case when h.company_id is null then null else jsonb_build_object(
      'hour_start', h.hour_start, 'revenue_cents', h.revenue_cents, 'profit_cents', h.profit_cents,
      'demand_cents', h.demand_cents, 'capacity_cents', h.capacity_cents,
      'ai_workers', pc.ai_workers, 'ai_wages_due_cents', h.ai_wages_due_cents,
      'ai_utilization_bps', h.ai_utilization_bps,
      'awareness_before', h.awareness_before, 'awareness_after', h.awareness_after,
      'awareness_parts', h.awareness_parts) end);
end;
$$;

create or replace function public.get_company_autopilot()
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
  return public.company_autopilot_json(m.company_id, v_player);
end;
$$;

create or replace function public.set_company_autopilot(p_request_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_replay jsonb;
  pc       public.player_companies;
begin
  if p_request_id is null or p_on is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_company_autopilot');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where founder_id = v_player and status = 'active';
  if pc.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  insert into public.company_autopilot as a (company_id, enabled, enabled_at, updated_at)
  values (pc.company_id, p_on, case when p_on then public.game_now() end, now())
  on conflict (company_id) do update
    set enabled = excluded.enabled,
        enabled_at = case when excluded.enabled and not a.enabled then excluded.enabled_at else a.enabled_at end,
        updated_at = now();
  return public.request_complete(v_player, p_request_id, public.company_autopilot_json(pc.company_id, v_player));
end;
$$;

revoke all on function public.company_autopilot_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_company_autopilot() from public, anon;
revoke all on function public.set_company_autopilot(uuid, boolean) from public, anon;
grant execute on function public.get_company_autopilot() to authenticated;
grant execute on function public.set_company_autopilot(uuid, boolean) to authenticated;

revoke all on function public.company_strengths_overall_of(uuid) from public, anon, authenticated;
revoke all on function public.company_task_pay_factor_bps(uuid) from public, anon, authenticated;
revoke all on function public.company_autopilot_mood(uuid) from public, anon, authenticated;
revoke all on function public.company_autopilot_chance_bps(uuid) from public, anon, authenticated;
