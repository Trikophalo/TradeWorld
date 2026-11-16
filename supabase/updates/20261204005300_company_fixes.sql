-- ===== idempotent copy of migrations/20261204005300_company_fixes.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5300 · Company fixes: the hourly close survives a broken company, move cooldowns carry their length
-- =============================================================================
-- * player_companies_run_due(): every company closes its hours and quarters in its own subtransaction. Before, one
--   company whose close raised (any error in wages, stakes, events, missions ...) rolled back the whole minute job,
--   so NO company closed an hour and every founder saw "the first operating hour is running" for ever. A failing
--   company is now skipped, written to job_runs ('company_hours', company id) with the error text and retried the
--   next minute; a company that closes again clears its entry. Companies that are furthest behind come first and
--   one run closes at most 600 hours in total, so a backlog after an outage cannot run into the statement timeout
--   (which would roll back everything again); the next minute goes on.
-- * The company's quarter report no longer waits for game_quarters.status = 'closed': it only sums the company's own
--   hours. Before, a late or failing market quarter close (run_due_part core) stopped every company at the quarter
--   boundary; after seven days without a closed hour the page fell back to "the first operating hour is running".
-- * company_moves_state(): every move carries rest_minutes, the pause after a start (duration x (1 + cooldownFactor),
--   shortened by the founder's move_tempo upgrade), so the client can show the cooldown before and while it runs.
-- * company_expansion_cost_cents(): capped at the largest bigint; at very high levels the power overflowed and
--   COMPANY (get_my_company and every company RPC) answered with "bigint out of range".
-- Idempotent: runs unchanged as supabase/updates/20261204005300_company_fixes.sql.

-- ---------------------------------------------------------------------------
-- A. Hourly close: one subtransaction per company
-- ---------------------------------------------------------------------------
create or replace function public.player_companies_run_due()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now    timestamptz := public.game_now();
  v_limit  timestamptz := date_trunc('hour', public.game_now());
  r        record;
  q        record;
  v_at     timestamptz;
  v_last   timestamptz;
  v_hours  integer := 0;
  v_quart  integer := 0;
  v_failed integer := 0;
  v_budget constant integer := 600;
  v_h0     integer;
  v_q0     integer;
  v_k      integer;
  v_kq     integer;
  v_moved  boolean;
  v_err    text;
begin
  for r in
    select pc.company_id, c.founded_at
      from public.player_companies pc join public.companies c on c.id = pc.company_id
     where pc.status = 'active'
     order by pc.last_hour_at, pc.company_id
  loop
    exit when v_hours >= v_budget;
    v_h0 := v_hours;
    v_q0 := v_quart;
    begin
      v_k := 0;
      v_kq := 0;
      loop
        v_moved := false;
        -- quarters whose hours are all closed (the company report is the sum of its own hours: it does not wait
        -- for close_game_quarter of the market any more)
        for q in
          select gq.id from public.game_quarters gq, public.player_companies pc
           where pc.company_id = r.company_id and pc.status = 'active'
             and gq.ends_at <= pc.last_hour_at
             and gq.ends_at > coalesce((select x.ends_at from public.game_quarters x where x.id = pc.last_closed_quarter_id), r.founded_at)
             and not exists (select 1 from public.player_company_reports rp where rp.company_id = r.company_id and rp.game_quarter_id = gq.id)
           order by gq.ends_at limit greatest(0, 8 - v_kq)
        loop
          exit when not exists (select 1 from public.player_companies x where x.company_id = r.company_id and x.status = 'active');
          if (public.player_company_close_quarter(r.company_id, q.id) ->> 'skipped') is null then
            v_quart := v_quart + 1;
            v_kq := v_kq + 1;
            v_moved := true;
          end if;
        end loop;
        -- hours up to the next unreported quarter end
        loop
          select pc.last_hour_at,
                 coalesce((select x.ends_at from public.game_quarters x where x.id = pc.last_closed_quarter_id), r.founded_at)
            into v_at, v_last
            from public.player_companies pc where pc.company_id = r.company_id and pc.status = 'active';
          exit when v_at is null or v_at + interval '1 hour' > v_limit or v_k >= 48 or v_hours >= v_budget;
          exit when exists (select 1 from public.game_quarters gq
                             where gq.ends_at <= v_at and gq.ends_at > v_last
                               and not exists (select 1 from public.player_company_reports rp
                                                where rp.company_id = r.company_id and rp.game_quarter_id = gq.id));
          perform public.player_company_close_hour(r.company_id, v_at);
          v_hours := v_hours + 1;
          v_k := v_k + 1;
          v_moved := true;
        end loop;
        exit when not v_moved or v_k >= 48 or v_kq >= 8 or v_hours >= v_budget;
      end loop;
      -- closed again after an earlier failure: the entry goes
      if v_hours > v_h0 or v_quart > v_q0 then
        delete from public.job_runs j where j.job_name = 'company_hours' and j.run_key = r.company_id::text;
      end if;
    exception when others then
      -- this company's work of the run is rolled back; the others go on, the next minute tries again
      v_err := sqlstate || ': ' || sqlerrm;
      v_hours := v_h0;
      v_quart := v_q0;
      v_failed := v_failed + 1;
      raise warning 'NEXA: hourly close of company % failed: %', r.company_id, v_err;
      insert into public.job_runs (job_name, run_key, status, finished_at, error, details)
      values ('company_hours', r.company_id::text, 'failed', now(), v_err, jsonb_build_object('failures', 1))
      on conflict (job_name, run_key) do update
        set status = 'failed', finished_at = now(), error = excluded.error,
            details = jsonb_build_object('failures', coalesce((public.job_runs.details ->> 'failures')::integer, 0) + 1);
    end;
  end loop;
  -- keep about one week of hours
  delete from public.player_company_hours where hour_start < v_now - interval '7 days';
  return jsonb_build_object('hours', v_hours, 'quarters', v_quart, 'failed', v_failed);
end;
$$;
comment on function public.player_companies_run_due() is
  'Internal, every minute (run_due_part companies): closes the due hours and quarters of every player company, each '
  'company in its own subtransaction; a failing company is logged in job_runs (company_hours) and retried.';
revoke all on function public.player_companies_run_due() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B. Business moves: the pause after a start as rest_minutes
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.company_moves_state(uuid)'::regprocedure);
  v_old text := $t$'available_at', (select max($t$;
  v_new text := $t$'rest_minutes', ceil(extract(epoch from public.company_move_rest(mv, v_cfg, v_tempo)) / 60.0)::integer,
                 'available_at', (select max($t$;
begin
  if position('rest_minutes' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'company_moves_state(): anchor for rest_minutes not found';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- C. Expansion cost: no overflow at very high levels
-- ---------------------------------------------------------------------------
create or replace function public.company_expansion_cost_cents(p_level integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select least(9000000000000000000::double precision,
               round(public.config_double('startups', '{expansion,baseCostCents}', 10000000)
                     * power(public.config_double('startups', '{expansion,costGrowth}', 1.8),
                             least(1000, greatest(0, coalesce(p_level, 0))))))::bigint;
$$;
