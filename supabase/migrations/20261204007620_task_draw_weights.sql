-- =============================================================================
-- NEXA · 7620 · Company tasks: weighted draw (ADR-186)
-- =============================================================================
-- Fewer maths and typing tasks, more drag and see games: every catalogue entry carries a draw weight (companyTasks.tasks
-- [].weight = kind weight x own product or generic, src/config/company-tasks.ts). company_tasks_run_due() in full (the
-- latest definition: 0100 with the autopilot call of 6910) draws by -ln(1 - random()) / weight, so task i comes
-- first with probability weight_i / sum of weights (pickWeightedTask, TS). Entries without a weight count 1.
-- Idempotent: runs unchanged as supabase/updates/20261204007620_task_draw_weights.sql.

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
  end loop;
  perform public.company_autopilot_run(v_now);  -- ADR-180
  delete from public.company_tasks where resolved_at < v_now - interval '3 days';
  return jsonb_build_object('ai', v_ai, 'missed', v_missed, 'new', v_new);
end;
$$;

revoke all on function public.company_tasks_run_due(timestamptz) from public, anon, authenticated;
grant execute on function public.company_tasks_run_due(timestamptz) to service_role;
