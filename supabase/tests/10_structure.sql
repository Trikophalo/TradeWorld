-- =============================================================================
-- 10 · Structural guarantees: RLS everywhere, closed privileges, conventions
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

-- (a) RLS enabled on every table (incl. partitioned tables and partitions)
select tests.assert(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')) >= 100,
  'schema has at least 100 tables (' ||
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition) || ' logical tables)');

select tests.assert(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  'RLS is enabled on every table in public: missing = ' || coalesce((
    select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity), 'none'));

-- anon: no privilege of any kind on any relation, column, sequence or function
select tests.assert(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
       and case when c.relkind in ('r', 'p', 'v', 'm')
                then has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate')
                     or has_any_column_privilege('anon', c.oid, 'select, insert, update')
                else false end),
  'anon has no table/view/column privileges in public');
select tests.assert(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
       and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'usage, select, update') else false end),
  'anon has no sequence privileges in public');
select tests.assert(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
       and p.proname <> 'check_nickname'),
  'anon cannot execute any function in public (except check_nickname for the registration form)');

-- authenticated: executable functions are the read-only helper allowlist plus
-- (once the M1 migrations/update are applied) the M1 RPCs; nothing else.
-- 55_m1_security.sql checks the M1 set exactly.
select tests.assert(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute'))
  <@ array['are_friends', 'can_read_ledger_transaction', 'current_game_quarter', 'game_day', 'game_now',
           'has_unlock', 'is_admin', 'is_company_insider', 'owns_ledger_account',
           -- M1 RPCs
           'admin_close_quarter', 'admin_run_tick', 'admin_set_paused', 'cancel_order', 'claim_vault',
           'complete_tutorial', 'get_candles', 'get_market_snapshot', 'get_my_portfolio', 'get_order_book',
           'get_security_details', 'place_order',
           -- M2 RPCs
           'change_nickname', 'check_nickname', 'claim_mission', 'daily_check_in', 'get_my_missions',
           'get_rich_list', 'get_rich_list_news', 'track_event',
           -- M2b RPCs
           'apply_for_job', 'claim_daily_reward', 'close_job_posting', 'counter_offer', 'create_job_posting', 'fire_employee',
           'get_company_applications', 'get_company_team', 'get_daily_reward', 'get_job_board', 'get_my_applications', 'get_my_job',
           'get_my_skills', 'get_player_card', 'learn_skill', 'quit_job', 'request_raise', 'respond_application',
           'respond_raise', 'set_avatar', 'sign_contract', 'withdraw_application',
           -- M3c RPCs
           'check_company_name', 'company_deposit', 'company_withdraw', 'found_company', 'get_company_postings',
           'get_my_company', 'set_ai_workers', 'set_company_marketing', 'upgrade_company',
           -- M3d RPCs
           'close_company', 'get_company_chat', 'get_work_task', 'post_company_message', 'submit_work_task',
           -- M3e RPCs
           'cancel_quit', 'get_employer', 'train_employee']
  and array['are_friends', 'can_read_ledger_transaction', 'current_game_quarter', 'game_day', 'game_now',
            'has_unlock', 'is_admin', 'is_company_insider', 'owns_ledger_account']
      <@ (select coalesce(array_agg(p.proname::text), '{}')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')),
  'authenticated can execute the 9 allowlisted helper functions and (after M1) the M1 RPCs, nothing else');

-- authenticated: write privileges only on the documented client-writable tables
select tests.assert(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
      and case when c.relkind in ('r', 'p', 'v')
               then has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate')
                    or has_any_column_privilege('authenticated', c.oid, 'insert, update')
               else false end)
  = array['notification_preferences', 'notifications', 'player_achievements', 'player_settings',
          'player_unlocks', 'push_subscriptions', 'watchlist_items'],
  'authenticated has write privileges on exactly the 7 client-writable tables');

-- column-level: the dangerous columns are not writable
select tests.assert(
  not has_column_privilege('authenticated', 'public.notifications', 'title', 'update')
  and not has_column_privilege('authenticated', 'public.notifications', 'player_id', 'update')
  and has_column_privilege('authenticated', 'public.notifications', 'read_at', 'update')
  and not has_column_privilege('authenticated', 'public.player_settings', 'player_id', 'update')
  and not has_column_privilege('authenticated', 'public.player_unlocks', 'unlock_key', 'update')
  and not has_column_privilege('authenticated', 'public.player_achievements', 'unlocked_at', 'update')
  and not has_table_privilege('authenticated', 'public.notifications', 'insert'),
  'column grants are narrow (only read_at / seen_at / settings columns)');

-- simulation internals and other server-only tables: not even SELECT
select tests.assert(
  not exists (
    select 1 from unnest(array[
      'security_sim_state', 'sector_sim_state', 'ai_investors', 'ai_investor_holdings', 'sim_runtime',
      'sim_rng_streams', 'sim_tick_log', 'job_runs', 'internal_settings', 'admin_users',
      'insider_violations', 'work_task_solutions', 'scheduled_event_secrets', 'macro_event_definitions',
      'random_event_definitions', 'news_templates', 'news_item_effects', 'league_entry_baselines',
      'rate_limits', 'player_requests', 'player_login_events', 'push_deliveries', 'invite_code_redemptions',
      'price_ticks_default']) as t
     where has_table_privilege('authenticated', ('public.' || t)::regclass, 'select')
        or has_any_column_privilege('authenticated', ('public.' || t)::regclass, 'select')),
  'authenticated has no SELECT on internal tables (fair value, sentiment, AI holdings, lease, RNG ...)');

-- every table without any policy must be one without grants (internal)
select tests.assert(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
       and case when c.relkind in ('r', 'p') then has_table_privilege('authenticated', c.oid, 'select') else false end
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  'every table readable by authenticated has at least one RLS policy');

-- no policy for anon / public
select tests.assert(
  not exists (
    select 1 from pg_policies where schemaname = 'public' and (roles && array['anon', 'public']::name[])),
  'no RLS policy targets anon or PUBLIC');

-- all views are security_invoker
select tests.assert(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
  'all ' || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'v') || ' views are security_invoker');

-- SECURITY DEFINER functions pin an empty search_path
select tests.assert(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not coalesce(p.proconfig @> array['search_path=""'], false)),
  'every SECURITY DEFINER function sets search_path = '''' (' ||
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef) || ' functions)');

-- every foreign key is covered by an index (leading columns)
select tests.assert(
  not exists (
    select 1
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where con.contype = 'f' and n.nspname = 'public' and not c.relispartition
       and not exists (
         select 1 from pg_index i
          where i.indrelid = con.conrelid
            and i.indpred is null
            and (i.indkey::smallint[])[0:cardinality(con.conkey) - 1] @> con.conkey
       )
       -- partial indexes are fine when the FK column is nullable and the predicate is "is not null"
       and not exists (
         select 1 from pg_index i
          where i.indrelid = con.conrelid
            and i.indpred is not null
            and (i.indkey::smallint[])[0:cardinality(con.conkey) - 1] @> con.conkey
            and pg_get_expr(i.indpred, i.indrelid) ~* 'is not null'
       )),
  'every foreign key has a covering index: missing = ' || coalesce((
    select string_agg(c.relname || '.' || con.conname, ', ')
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where con.contype = 'f' and n.nspname = 'public' and not c.relispartition
       and not exists (
         select 1 from pg_index i
          where i.indrelid = con.conrelid
            and (i.indpred is null or pg_get_expr(i.indpred, i.indrelid) ~* 'is not null')
            and (i.indkey::smallint[])[0:cardinality(con.conkey) - 1] @> con.conkey)), 'none'));

-- unit conventions
select tests.assert(
  not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and (column_name like '%\_cents' or column_name like '%\_e4')
       and data_type <> 'bigint' and table_name not like 'v\_%'),
  'all *_cents and *_e4 columns are bigint');
select tests.assert(
  not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and column_name like '%\_bps'
       and data_type not in ('integer', 'smallint') and table_name not like 'v\_%'),
  'all *_bps columns are integers');
select tests.assert(
  not exists (
    select 1 from information_schema.columns c
      join information_schema.tables t using (table_schema, table_name)
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and c.data_type in ('numeric', 'real', 'money')),
  'no numeric/real/money columns in tables (money is integer, model values double precision)');
select tests.assert(
  not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and data_type = 'timestamp without time zone'),
  'no timestamp without time zone columns');
select tests.assert(
  (select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_enum e
     join pg_type t on t.oid = e.enumtypid where t.typname = 'candle_interval')
  = array['1m', '5m', '1h', '1q', '1y'],
  'candle intervals are 1m, 5m, 1h, 1q, 1y');
select tests.assert(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
       and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'set_updated_at')),
  'every table with updated_at has the set_updated_at trigger');

-- price_ticks is partitioned with RLS on the partitions
select tests.assert(
  (select count(*) from pg_inherits i join pg_class p on p.oid = i.inhparent where p.relname = 'price_ticks') >= 4,
  'price_ticks has daily partitions plus a default partition');

-- game calendar -----------------------------------------------------------------
select tests.assert((select count(*) >= 16 and count(*) % 4 = 0 from public.game_quarters), 'ensure_game_quarters created at least 4 game days (16 quarters)');
select tests.assert(public.ensure_game_quarters(3) = 0, 'ensure_game_quarters is idempotent');
select tests.assert(
  (select array_agg(h order by h) from (
     select distinct extract(hour from starts_at at time zone 'Europe/Berlin')::int as h from public.game_quarters) x)
  = array[2, 8, 14, 20],
  'quarters start at 02, 08, 14 and 20 o''clock Europe/Berlin');
select tests.assert(
  not exists (select 1 from public.game_quarters q
               where (q.quarter, extract(hour from q.starts_at at time zone 'Europe/Berlin')::int)
                     not in ((1, 8), (2, 14), (3, 20), (4, 2))),
  'Q1 = 08:00, Q2 = 14:00, Q3 = 20:00, Q4 = 02:00');
select tests.assert(
  not exists (
    select 1 from public.game_quarters a join public.game_quarters b
      on (b.game_year, b.quarter) = (case when a.quarter = 4 then a.game_year + 1 else a.game_year end,
                                     case when a.quarter = 4 then 1 else a.quarter + 1 end)
     where a.ends_at <> b.starts_at),
  'quarters are contiguous');
select tests.assert((public.current_game_quarter()).id is not null, 'current_game_quarter() returns a row');
select tests.assert(
  (select status from public.game_quarters where id = (public.current_game_quarter()).id) = 'active',
  'the running quarter is marked active');

-- DST: within the next 370 days there is exactly one 5 h quarter (spring
-- forward) and one 7 h quarter (fall back); all others are 6 h. Rolled back.
begin;
select tests.assert(public.ensure_game_quarters(370) > 1400, 'calendar can be extended 370 days ahead');
select tests.assert(
  (select array_agg(h order by h) from (
     select distinct round(extract(epoch from ends_at - starts_at) / 3600)::int as h from public.game_quarters) x)
  = array[5, 6, 7],
  'quarter lengths over a year are 6 h plus the DST quarters (5 h and 7 h)');
select tests.assert(
  (select count(*) filter (where ends_at - starts_at = interval '5 hours') = 1
      and count(*) filter (where ends_at - starts_at = interval '7 hours') = 1 from public.game_quarters),
  'exactly one 5 h and one 7 h quarter per year');
select tests.assert(
  not exists (select 1 from public.game_quarters group by game_year having count(*) <> 4),
  'every game year has exactly 4 quarters');
rollback;

-- admin time offset moves game time
begin;
update public.sim_runtime set time_offset = interval '6 hours';
select tests.assert(public.game_now() > now() + interval '5 hours', 'game_now() honours the admin time offset');
select tests.assert(
  (public.current_game_quarter()).starts_at >
  (select starts_at from public.game_quarters where starts_at <= now() and ends_at > now()),
  'current_game_quarter() follows the time offset');
rollback;

-- cron guard: no pg_cron here, so nothing was scheduled and the invoker is a no-op
select tests.assert(public.invoke_edge_function('tick-runner') is null, 'invoke_edge_function() is a no-op without pg_net/config');
select tests.assert((public.run_maintenance()) ? 'quarters_created', 'run_maintenance() runs');
