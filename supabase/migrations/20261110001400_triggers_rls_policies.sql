-- =============================================================================
-- NEXA · 1400 · updated_at triggers, small guards, grants and RLS policies
-- =============================================================================
-- Access model (ADR-008), one category per table:
--   public_read   every signed-in player may read all rows and columns
--   owner_read    only rows with player_id = auth.uid()
--   custom        participant / insider / time-gated policies (see below)
--   admin_read    readable by admins only (is_admin())
--   internal      no grant and no policy: service_role only
-- Clients never INSERT/UPDATE/DELETE game tables. The few harmless direct
-- writes (settings, watchlist, notification read flag/preferences, push
-- subscriptions, "seen" flags) use column-level grants plus owner policies.
-- anon gets nothing at all.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. updated_at trigger on every table that has the column
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and not c.relispartition
       and not exists (
         select 1 from pg_catalog.pg_trigger t where t.tgrelid = c.oid and t.tgname = 'set_updated_at'
       )
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      r.relname);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Caps for client-writable tables
-- ---------------------------------------------------------------------------
create or replace function public.enforce_row_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max   integer := tg_argv[0]::integer;
  v_count integer;
begin
  execute format('select count(*) from public.%I where player_id = $1', tg_table_name)
    into v_count using new.player_id;
  if v_count >= v_max then
    raise exception 'limit of % rows per player reached for %', v_max, tg_table_name using errcode = 'NX004';
  end if;
  return new;
end;
$$;

create trigger watchlist_items_cap
  before insert on public.watchlist_items
  for each row execute function public.enforce_row_cap('200');
create trigger push_subscriptions_cap
  before insert on public.push_subscriptions
  for each row execute function public.enforce_row_cap('10');

-- ---------------------------------------------------------------------------
-- 3. RLS helper functions
-- ---------------------------------------------------------------------------
create or replace function public.has_unlock(p_unlock_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.player_unlocks u
     where u.player_id = (select auth.uid()) and u.unlock_key = p_unlock_key
  );
$$;
comment on function public.has_unlock(text) is 'RLS/RPC helper: the caller has unlocked the feature.';

create or replace function public.owns_ledger_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ledger_accounts a
     where a.id = p_account_id
       and (
         a.owner_player_id = (select auth.uid())
         or (a.owner_company_id is not null and public.is_company_insider(a.owner_company_id))
       )
  );
$$;
comment on function public.owns_ledger_account(uuid) is 'RLS helper: account belongs to the caller or to a company the caller is an insider of.';

create or replace function public.can_read_ledger_transaction(p_transaction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ledger_entries e
     where e.transaction_id = p_transaction_id
       and public.owns_ledger_account(e.account_id)
  );
$$;
comment on function public.can_read_ledger_transaction(uuid) is 'RLS helper: the transaction touches an account the caller may read.';

-- ---------------------------------------------------------------------------
-- 4. Reset privileges: nothing for anon/authenticated/PUBLIC, all for service
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all routines  in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all routines in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- Functions players may call directly (RLS helpers and read-only game time).
grant execute on function public.is_admin()                          to authenticated;
grant execute on function public.is_company_insider(uuid)            to authenticated;
grant execute on function public.are_friends(uuid, uuid)             to authenticated;
grant execute on function public.has_unlock(text)                    to authenticated;
grant execute on function public.owns_ledger_account(uuid)           to authenticated;
grant execute on function public.can_read_ledger_transaction(uuid)   to authenticated;
grant execute on function public.game_now()                          to authenticated;
grant execute on function public.game_day(timestamptz)               to authenticated;
grant execute on function public.current_game_quarter()              to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Table classification -> grants + standard policies
-- ---------------------------------------------------------------------------
-- (plain temp table, dropped explicitly: works with and without a wrapping transaction)
create temporary table _rls_classes (table_name text primary key, class text not null);

insert into _rls_classes (class, table_name)
select 'public_read', t from unnest(array[
  -- config / time
  'game_config_public_keys', 'game_quarters', 'market_status',
  -- progression catalogues
  'levels', 'unlocks', 'achievements', 'cosmetic_items', 'lifestyle_items', 'mission_templates',
  -- players (public card + public status symbols)
  'profiles', 'player_lifestyle_items',
  -- market
  'sectors', 'securities', 'bonds', 'option_contracts', 'indices', 'index_memberships',
  'security_quotes', 'price_ticks', 'candles', 'order_book_levels', 'security_distributions',
  'central_bank_state', 'central_bank_decisions', 'macro_indicators', 'macro_indicator_history',
  -- companies
  'companies', 'sector_quarter_stats', 'company_events', 'employee_traits',
  'cap_table_entries', 'share_issuances', 'share_lockups', 'insolvency_proceedings',
  -- IPO / governance
  'ipos', 'ipo_prospectus_forecasts', 'ipo_use_of_proceeds', 'guidance', 'shareholder_votes',
  'corporate_actions', 'reputation_events', 'insider_blackout_windows',
  -- careers
  'job_definitions', 'work_task_definitions',
  -- social / events
  'league_seasons', 'league_entries', 'notification_types', 'scheduled_events', 'macro_events'
]) as t;

insert into _rls_classes (class, table_name)
select 'owner_read', t from unnest(array[
  'player_private', 'player_settings', 'player_unlocks', 'xp_events', 'xp_daily_counters',
  'vaults', 'vault_claims', 'login_streaks', 'daily_logins', 'player_missions', 'player_cosmetics',
  'player_random_events', 'player_bankruptcies',
  'orders', 'positions', 'trades', 'position_lots', 'margin_events', 'financing_charges',
  'player_tax_years', 'distribution_payouts', 'watchlist_items', 'portfolio_snapshots',
  'capital_injections', 'ipo_subscriptions', 'shareholder_vote_ballots',
  'player_jobs', 'salary_payouts', 'work_tasks', 'salary_negotiations',
  'notifications', 'notification_preferences', 'push_subscriptions'
]) as t;

insert into _rls_classes (class, table_name)
select 'custom', t from unnest(array[
  'game_config', 'player_achievements', 'analyst_ratings',
  'ledger_accounts', 'ledger_transactions', 'ledger_entries',
  'company_state', 'company_products', 'company_quarter_decisions', 'company_quarter_reports',
  'employees', 'applicants', 'poaching_offers', 'stock_option_grants', 'stock_option_vesting_events',
  'loans', 'loan_payments', 'takeover_offers', 'angel_offers', 'job_offers',
  'friendships', 'feed_items', 'news_items'
]) as t;

insert into _rls_classes (class, table_name)
select 'admin_read', t from unnest(array[
  'admin_actions', 'suspicious_activity', 'invite_codes', 'money_supply_snapshots'
]) as t;

insert into _rls_classes (class, table_name)
select 'internal', t from unnest(array[
  'admin_users', 'internal_settings', 'sim_runtime', 'sim_rng_streams', 'sim_tick_log', 'job_runs',
  'invite_code_redemptions', 'random_event_definitions',
  'sector_sim_state', 'security_sim_state', 'ai_investors', 'ai_investor_holdings',
  'insider_violations', 'work_task_solutions', 'league_entry_baselines', 'push_deliveries',
  'scheduled_event_secrets', 'macro_event_definitions', 'news_templates', 'news_item_effects',
  'rate_limits', 'player_requests', 'player_login_events'
]) as t;

do $$
declare
  r         record;
  v_missing text;
  v_unknown text;
begin
  -- every table must be classified, and every classified table must exist
  select string_agg(c.relname, ', ' order by c.relname) into v_missing
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
     and not exists (select 1 from _rls_classes k where k.table_name = c.relname);
  if v_missing is not null then
    raise exception 'tables without RLS classification: %', v_missing;
  end if;

  select string_agg(k.table_name, ', ' order by k.table_name) into v_unknown
    from _rls_classes k
   where to_regclass('public.' || quote_ident(k.table_name)) is null;
  if v_unknown is not null then
    raise exception 'classified tables that do not exist: %', v_unknown;
  end if;

  -- safety net: RLS on everything (incl. partitions)
  for r in
    select c.relname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;

  for r in select * from _rls_classes order by table_name loop
    if r.class = 'public_read' then
      execute format('grant select on public.%I to authenticated', r.table_name);
      execute format('create policy "public read" on public.%I for select to authenticated using (true)', r.table_name);
    elsif r.class = 'owner_read' then
      execute format('grant select on public.%I to authenticated', r.table_name);
      execute format(
        'create policy "owner read" on public.%I for select to authenticated using (player_id = (select auth.uid()))',
        r.table_name);
    elsif r.class = 'admin_read' then
      execute format('grant select on public.%I to authenticated', r.table_name);
      execute format(
        'create policy "admin read" on public.%I for select to authenticated using ((select public.is_admin()))',
        r.table_name);
    elsif r.class = 'custom' then
      execute format('grant select on public.%I to authenticated', r.table_name);
    end if;
    -- internal: nothing
  end loop;
end;
$$;

drop table _rls_classes;

-- ---------------------------------------------------------------------------
-- 6. Custom SELECT policies
-- ---------------------------------------------------------------------------

-- game_config: allowlisted documents for players, everything for admins
create policy "public keys or admin" on public.game_config for select to authenticated
  using (
    exists (select 1 from public.game_config_public_keys k where k.key = game_config.key)
    or (select public.is_admin())
  );

-- achievements: unlocked ones are public, progress is private
create policy "unlocked or own" on public.player_achievements for select to authenticated
  using (unlocked_at is not null or player_id = (select auth.uid()));

-- analyst reports: level-7 unlock, only once published
create policy "unlocked feature" on public.analyst_ratings for select to authenticated
  using (published_at <= now() and (select public.has_unlock('analyst_reports')));

-- ledger: own accounts and accounts of companies the caller is an insider of
create policy "own accounts" on public.ledger_accounts for select to authenticated
  using (
    owner_player_id = (select auth.uid())
    or (owner_company_id is not null and public.is_company_insider(owner_company_id))
  );
create policy "entries of own accounts" on public.ledger_entries for select to authenticated
  using (public.owns_ledger_account(account_id));
create policy "transactions of own accounts" on public.ledger_transactions for select to authenticated
  using (public.can_read_ledger_transaction(id));

-- company internals: insiders only
create policy "insiders" on public.company_state for select to authenticated
  using (public.is_company_insider(company_id));
create policy "insiders" on public.company_quarter_decisions for select to authenticated
  using (public.is_company_insider(company_id));
create policy "insiders" on public.applicants for select to authenticated
  using (public.is_company_insider(company_id));
create policy "insiders or self" on public.employees for select to authenticated
  using (player_id = (select auth.uid()) or public.is_company_insider(company_id));
create policy "offering company" on public.poaching_offers for select to authenticated
  using (public.is_company_insider(from_company_id));

-- products: public once active; pipeline only for insiders
create policy "active or insiders" on public.company_products for select to authenticated
  using (status = 'active' or public.is_company_insider(company_id));

-- quarterly reports: public from publication; insiders earlier (insider rule)
create policy "published or insiders" on public.company_quarter_reports for select to authenticated
  using ((published_at is not null and published_at <= now()) or public.is_company_insider(company_id));

create policy "holder or insiders" on public.stock_option_grants for select to authenticated
  using (player_id = (select auth.uid()) or public.is_company_insider(company_id));
create policy "via grant" on public.stock_option_vesting_events for select to authenticated
  using (exists (select 1 from public.stock_option_grants g where g.id = grant_id));

create policy "borrower" on public.loans for select to authenticated
  using (
    player_id = (select auth.uid())
    or (company_id is not null and public.is_company_insider(company_id))
  );
create policy "via loan" on public.loan_payments for select to authenticated
  using (exists (select 1 from public.loans l where l.id = loan_id));

create policy "bidder or target insiders" on public.takeover_offers for select to authenticated
  using (
    bidder_player_id = (select auth.uid())
    or public.is_company_insider(target_company_id)
    or (bidder_company_id is not null and public.is_company_insider(bidder_company_id))
  );

create policy "participants or open offers" on public.angel_offers for select to authenticated
  using (
    created_by = (select auth.uid())
    or investor_player_id = (select auth.uid())
    or public.is_company_insider(company_id)
    or (direction = 'company_offers' and status = 'open' and investor_player_id is null and ai_investor_key is null)
  );

create policy "participants" on public.job_offers for select to authenticated
  using (
    to_player_id = (select auth.uid())
    or offered_by = (select auth.uid())
    or public.is_company_insider(company_id)
  );

create policy "participants" on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

create policy "public, own or friends" on public.feed_items for select to authenticated
  using (
    visibility = 'public'
    or actor_id = (select auth.uid())
    or public.are_friends(actor_id, (select auth.uid()))
  );

create policy "published" on public.news_items for select to authenticated
  using (published_at <= now());

-- ---------------------------------------------------------------------------
-- 7. Narrow direct client writes (column grants + owner policies)
-- ---------------------------------------------------------------------------

-- UI settings
grant update (theme, chart_style, locale, sounds_enabled, animations_enabled, haptics_enabled,
              portfolio_visibility, show_playtime, hold_to_confirm, ui_state)
  on public.player_settings to authenticated;
create policy "owner update" on public.player_settings for update to authenticated
  using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

-- watchlist
grant insert (player_id, security_id, sort_order), update (sort_order), delete
  on public.watchlist_items to authenticated;
create policy "owner insert" on public.watchlist_items for insert to authenticated
  with check (player_id = (select auth.uid()));
create policy "owner update" on public.watchlist_items for update to authenticated
  using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));
create policy "owner delete" on public.watchlist_items for delete to authenticated
  using (player_id = (select auth.uid()));

-- notifications: mark as read
grant update (read_at) on public.notifications to authenticated;
create policy "owner mark read" on public.notifications for update to authenticated
  using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

-- notification preferences
grant insert (player_id, type_key, in_app_enabled, push_enabled), update (in_app_enabled, push_enabled)
  on public.notification_preferences to authenticated;
create policy "owner insert" on public.notification_preferences for insert to authenticated
  with check (player_id = (select auth.uid()));
create policy "owner update" on public.notification_preferences for update to authenticated
  using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

-- push subscriptions
grant insert (player_id, endpoint, p256dh, auth_key, user_agent),
      update (p256dh, auth_key, user_agent, revoked_at),
      delete
  on public.push_subscriptions to authenticated;
create policy "owner insert" on public.push_subscriptions for insert to authenticated
  with check (player_id = (select auth.uid()));
create policy "owner update" on public.push_subscriptions for update to authenticated
  using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));
create policy "owner delete" on public.push_subscriptions for delete to authenticated
  using (player_id = (select auth.uid()));

-- "seen" flags of unlock / achievement overlays
grant update (seen_at) on public.player_unlocks to authenticated;
create policy "owner mark seen" on public.player_unlocks for update to authenticated
  using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));
grant update (seen_at) on public.player_achievements to authenticated;
create policy "owner mark seen" on public.player_achievements for update to authenticated
  using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 8. Realtime: private notifications via postgres_changes (ADR-013)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
