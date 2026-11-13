-- ===== idempotent copy of migrations/20261203001000_split_minute_job.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1000 · The minute job in five short parts (ADR-123)
-- =============================================================================
-- run_due_jobs() did everything in one transaction: on the live database about 13 seconds every minute, holding the
-- tick lock and the rows it touched; players waited behind it. The cron job now runs run_due_part() for five parts,
-- each its own short transaction:
--   core       calendar, bootstrap, crypto, quarter closes, bonds, daily maintenance
--   companies  operating hours of player companies, company events, deals (in this order, as before)
--   jobs       quit notices, share offers, AI job postings, wages
--   art        artwork auctions
--   social     rich list snapshot, feed and league, announced events
-- run_due_jobs() stays and runs all parts in one go (tests, manual catch-up).
-- Also (ADR-117): missions about limit orders that are still running are ended.
-- Idempotent: runs unchanged as supabase/updates/20261203001000_split_minute_job.sql.

create or replace function public.run_due_part(p_part text)
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
  if p_part = 'core' then
  perform public.ensure_game_quarters(3);

  if not exists (select 1 from public.candles limit 1) or not public.money_genesis_done()
     or not exists (select 1 from public.rich_tycoons) then
    v_result := v_result || jsonb_build_object('bootstrap', public.market_bootstrap());
  end if;

  -- cryptocurrencies (ADR-101) first: coin rows are locked before any ledger account (same order as trades)
  v_result := v_result || jsonb_build_object('crypto', public.crypto_run_due(v_now));

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
  -- bonds that matured between quarter closes (or after a downtime)
  if exists (select 1 from public.bonds bd join public.securities s on s.id = bd.security_id
              where s.status = 'listed' and bd.matures_at <= v_now) then
    v_result := v_result || jsonb_build_object('bonds_redeemed', public.redeem_matured_bonds(v_now));
  end if;
  v_result := v_result || jsonb_build_object('bonds_issued', public.ensure_bond_series());

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
  elsif p_part = 'companies' then
  v_result := v_result || jsonb_build_object('player_companies', public.player_companies_run_due());
  v_result := v_result || jsonb_build_object('company_events', public.company_events_run_due());
  -- deals between players (ADR-098): after the company hours, so supply contracts see both companies' hours
  v_result := v_result || jsonb_build_object('deals', public.deals_run_due());

  elsif p_part = 'jobs' then
  -- jobs: AI postings of the running quarter, wages of AI-company jobs in whole hours
  v_result := v_result || jsonb_build_object('quit_notices', public.process_quit_notices(null));
  v_result := v_result || jsonb_build_object('share_offers', public.close_due_offers(null));
  v_result := v_result || jsonb_build_object('job_postings', public.refresh_ai_job_postings(),
                                             'salaries_paid', public.accrue_salaries(null));

  elsif p_part = 'art' then
  -- artworks (ADR-080): due auctions are settled, the gallery starts the auctions of the day
  v_result := v_result || jsonb_build_object('artworks', public.artworks_run_due());

  elsif p_part = 'social' then
  -- rich list snapshot every richList.snapshotMinutes (rank news, 24 h changes, state missions)
  v_result := v_result || jsonb_build_object('rich_list', public.rich_list_snapshot(false));

  -- weekly league and feed upkeep (M4f, ADR-088/089) and announced events (M4g, ADR-090): kept in this redefinition
  v_result := v_result || jsonb_build_object('social', public.social_run_due());
  v_result := v_result || jsonb_build_object('events', public.events_run_due());

  else
    perform public.api_error('invalid_argument');
  end if;
  return v_result;
end;
$$;
comment on function public.run_due_part(text) is
  'Internal, cron every minute (ADR-123): one part of the due jobs (core, companies, jobs, art, social), own transaction.';
revoke all on function public.run_due_part(text) from public, anon, authenticated;
grant execute on function public.run_due_part(text) to service_role;

do $$
declare
  p text;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'nexa-due-jobs') then
      perform cron.unschedule('nexa-due-jobs');
    end if;
    foreach p in array array['core', 'companies', 'jobs', 'art', 'social'] loop
      if exists (select 1 from cron.job where jobname = 'nexa-due-' || p) then
        perform cron.unschedule('nexa-due-' || p);
      end if;
      perform cron.schedule('nexa-due-' || p, '* * * * *', format('select public.run_due_part(%L)', p));
    end loop;
  end if;
end;
$$;

-- Limit orders are gone (ADR-117): running missions about them end as well.
update public.player_missions m set status = 'expired'
  from public.mission_templates t
 where t.key = m.template_key and m.status = 'active'
   and t.metric in ('limit_orders_placed', 'limit_orders_filled');
