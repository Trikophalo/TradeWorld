-- =============================================================================
-- NEXA · 1600 · Maintenance + scheduling (pg_cron / pg_net)
-- =============================================================================
-- Scheduling is skipped cleanly when pg_cron is not installed (local
-- verification, plain Postgres). Edge function URL and secret are NOT hard
-- coded; they are read from Supabase Vault:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'nexa_functions_base_url');
--   select vault.create_secret('<service role key or dedicated secret>',  'nexa_cron_secret');
-- Fallback without Vault: rows 'functions_base_url' / 'cron_secret' in
-- public.internal_settings. While neither is configured, invoke_edge_function()
-- is a no-op returning NULL.
-- =============================================================================

create or replace function public.invoke_edge_function(p_function text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url        text;
  v_secret     text;
  v_request_id bigint;
begin
  if p_function is null or p_function !~ '^[a-z0-9][a-z0-9-]*$' then
    raise exception 'invalid edge function name' using errcode = 'NX007';
  end if;
  if to_regnamespace('net') is null then
    return null; -- pg_net not installed
  end if;

  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
      into v_url using 'nexa_functions_base_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
      into v_secret using 'nexa_cron_secret';
  end if;
  if v_url is null then
    select s.value into v_url from public.internal_settings s where s.key = 'functions_base_url';
  end if;
  if v_secret is null then
    select s.value into v_secret from public.internal_settings s where s.key = 'cron_secret';
  end if;
  if v_url is null or v_secret is null then
    return null; -- not configured yet
  end if;

  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 5000)'
    into v_request_id
    using rtrim(v_url, '/') || '/' || p_function,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
          coalesce(p_body, '{}'::jsonb);
  return v_request_id;
end;
$$;
comment on function public.invoke_edge_function(text, jsonb) is 'Internal: async POST to a Supabase Edge Function via pg_net; URL/secret from Vault (fallback internal_settings). NULL = skipped.';

-- Daily housekeeping: calendar, tick partitions, retention of volatile tables.
create or replace function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quarters   integer;
  v_partitions integer;
  v_deleted    bigint;
  v_result     jsonb := '{}'::jsonb;
begin
  v_quarters   := public.ensure_game_quarters(3);
  v_partitions := public.maintain_price_tick_partitions(3, 3);
  v_result := jsonb_build_object('quarters_created', v_quarters, 'partition_changes', v_partitions);

  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  v_result := v_result || jsonb_build_object('rate_limits', v_deleted);

  delete from public.player_requests where created_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  v_result := v_result || jsonb_build_object('player_requests', v_deleted);

  delete from public.sim_tick_log where started_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  v_result := v_result || jsonb_build_object('sim_tick_log', v_deleted);

  delete from public.candles
   where (interval = '1m' and bucket_start < now() - interval '7 days')
      or (interval = '5m' and bucket_start < now() - interval '30 days');
  get diagnostics v_deleted = row_count;
  v_result := v_result || jsonb_build_object('candles', v_deleted);

  delete from public.portfolio_snapshots
   where (granularity = '5m' and taken_at < now() - interval '2 days')
      or (granularity = '1h' and taken_at < now() - interval '30 days');
  get diagnostics v_deleted = row_count;
  v_result := v_result || jsonb_build_object('portfolio_snapshots', v_deleted);

  delete from public.player_login_events where created_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  v_result := v_result || jsonb_build_object('player_login_events', v_deleted);

  delete from public.notifications
   where (expires_at is not null and expires_at < now())
      or (read_at is not null and created_at < now() - interval '30 days');
  get diagnostics v_deleted = row_count;
  v_result := v_result || jsonb_build_object('notifications', v_deleted);

  return v_result;
end;
$$;
comment on function public.run_maintenance() is 'Internal: daily housekeeping (game calendar, tick partitions, retention deletes).';

revoke all on function public.invoke_edge_function(text, jsonb) from public, anon, authenticated;
revoke all on function public.run_maintenance() from public, anon, authenticated;
grant execute on function public.invoke_edge_function(text, jsonb) to service_role;
grant execute on function public.run_maintenance() to service_role;

-- Initialise the calendar so that current_game_quarter() works right away.
do $$ begin perform public.ensure_game_quarters(3); end $$;

-- ---------------------------------------------------------------------------
-- Schedules (only when pg_cron exists)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available: skipping NEXA schedules';
    return;
  end if;

  create extension if not exists pg_cron;
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  else
    raise notice 'pg_net is not available: edge function schedules will be no-ops';
  end if;

  -- ADR-004: once per minute; the function loops 12 ticks of 5 s.
  perform cron.schedule('nexa-tick-runner', '* * * * *',
    $job$select public.invoke_edge_function('tick-runner')$job$);

  -- Quarter boundaries are on full hours (02/08/14/20 Europe/Berlin); the
  -- runner checks game_quarters and is idempotent via job_runs.
  perform cron.schedule('nexa-quarter-runner', '0 * * * *',
    $job$select public.invoke_edge_function('quarter-runner')$job$);

  perform cron.schedule('nexa-ensure-quarters', '5 * * * *',
    $job$select public.ensure_game_quarters(3)$job$);

  perform cron.schedule('nexa-maintenance', '17 3 * * *',
    $job$select public.run_maintenance()$job$);
end;
$$;
