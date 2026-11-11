-- ===== idempotent copy of migrations/20261118000200_m3g_account_reset.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M3g · 0200 · Reset and delete the own account
-- =============================================================================
-- reset_account(): back to the state of a freshly signed-up player. Kept: the
-- auth user, nickname, avatar, settings, notification preferences, friendships,
-- push subscriptions, idempotency journal, rate limits and anti-cheat records.
-- delete_account(): the same cleanup, then the auth user (and with it the
-- profile) is deleted; the nickname is free again.
--
-- The ledger, trades, orders and positions are immutable or referenced by
-- immutable history. They outlive a deleted player: their player columns keep
-- the UUID as an anonymous reference (no foreign key any more), the player's
-- ledger accounts stay with balance 0 and are frozen. Every money movement of
-- the cleanup is a balanced posting against the state (treasury; the mint
-- before the world genesis).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. History outlives a deleted player
-- ---------------------------------------------------------------------------
alter table public.ledger_accounts     drop constraint if exists ledger_accounts_owner_player_fk;
alter table public.ledger_transactions drop constraint if exists ledger_transactions_initiated_by_fk;
alter table public.trades              drop constraint if exists trades_player_id_fkey;
alter table public.orders              drop constraint if exists orders_player_id_fkey;
alter table public.positions           drop constraint if exists positions_player_id_fkey;
comment on column public.ledger_accounts.owner_player_id is
  'Owning player. No foreign key: the accounts of a deleted player stay (balance 0, frozen) so the ledger history remains complete.';

alter table public.player_private add column if not exists account_reset_at timestamptz;
comment on column public.player_private.account_reset_at is 'Last reset_account() (game time); trades up to it are no longer shown to the player.';

-- ---------------------------------------------------------------------------
-- B. Shared cleanup (internal)
-- ---------------------------------------------------------------------------
-- Ends everything game-related of a player and returns the cash to the state.
-- Leaves profile, settings and ledger accounts in place (balance 0).
create or replace function public.account_wipe(p_player uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nick    text;
  v_company uuid;
  v_state   uuid := public.ledger_system_account(case when public.money_genesis_done() then 'treasury' else 'mint' end);
  v_bal     bigint;
  r         record;
begin
  perform public.lock_player_accounts(p_player);
  select p.nickname into v_nick from public.profiles p where p.id = p_player for update;

  -- own company: open share offers are settled first, then it is dissolved like close_company
  select pc.company_id into v_company from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active';
  if v_company is not null then
    for r in select o.id from public.company_share_offers o where o.company_id = v_company and o.status = 'open' order by o.id loop
      perform public.close_share_offer(r.id);
    end loop;
    perform public.company_dissolve(v_company, 'closed');
  end if;

  -- subscriptions to other companies' open offers lapse (the money stays with the company)
  for r in select s.offer_id, sum(s.shares_e6)::bigint as q from public.offer_subscriptions s
            join public.company_share_offers o on o.id = s.offer_id and o.status = 'open'
           where s.player_id = p_player group by s.offer_id order by s.offer_id loop
    update public.company_share_offers set shares_subscribed_e6 = greatest(0, shares_subscribed_e6 - r.q) where id = r.offer_id;
  end loop;

  -- job: wages up to now, then ended without notice or fee
  for r in select pj.id, pj.company_id from public.player_jobs pj where pj.player_id = p_player and pj.status = 'active' order by pj.id loop
    perform public.accrue_job_salary(r.id);
    update public.player_jobs set status = 'ended', ended_at = now(), end_reason = 'quit', notice_ends_at = null where id = r.id;
    perform public.company_system_message(r.company_id, v_nick || ' hat das Unternehmen verlassen.');
  end loop;

  -- open orders release their reservations; holdings are given up
  for r in select o.id from public.orders o
            where o.player_id = p_player and o.status in ('pending', 'open', 'partially_filled') order by o.id loop
    perform public.cancel_order_internal(r.id);
  end loop;
  update public.positions
     set status = 'closed', closed_at = now(), quantity_e6 = 0, reserved_quantity_e6 = 0, cost_basis_cents = 0,
         margin_cents = 0, borrowed_cents = 0, liquidation_price_e4 = null
   where player_id = p_player and status = 'open';

  -- game state of the player
  for r in select * from (values
             ('position_lots', 'player_id'), ('xp_events', 'player_id'), ('xp_daily_counters', 'player_id'),
             ('vault_claims', 'player_id'), ('daily_logins', 'player_id'), ('player_missions', 'player_id'),
             ('player_achievements', 'player_id'), ('player_cosmetics', 'player_id'), ('player_lifestyle_items', 'player_id'),
             ('player_random_events', 'player_id'), ('player_bankruptcies', 'player_id'), ('margin_events', 'player_id'),
             ('financing_charges', 'player_id'), ('player_tax_years', 'player_id'), ('distribution_payouts', 'player_id'),
             ('watchlist_items', 'player_id'), ('portfolio_snapshots', 'player_id'), ('stock_option_grants', 'player_id'),
             ('loans', 'player_id'), ('cap_table_entries', 'player_id'), ('share_lockups', 'player_id'),
             ('capital_injections', 'player_id'), ('takeover_offers', 'bidder_player_id'), ('angel_offers', 'investor_player_id'),
             ('ipo_subscriptions', 'player_id'), ('shareholder_vote_ballots', 'player_id'), ('reputation_events', 'player_id'),
             ('insider_violations', 'player_id'), ('salary_payouts', 'player_id'), ('work_tasks', 'player_id'),
             ('salary_negotiations', 'player_id'), ('player_work_tasks', 'player_id'), ('player_jobs', 'player_id'),
             ('job_offers', 'to_player_id'), ('job_applications', 'player_id'), ('player_skills', 'player_id'),
             ('player_skill_points', 'player_id'), ('daily_reward_claims', 'player_id'), ('player_loans', 'player_id'),
             ('offer_subscriptions', 'player_id'), ('notifications', 'player_id'), ('feed_items', 'actor_id'),
             ('league_entries', 'player_id'), ('league_entry_baselines', 'player_id'), ('company_logo_reports', 'reporter_id'),
             ('player_unlocks', 'player_id')
           ) as t(tbl, col) loop
    execute format('delete from public.%I where %I = $1', r.tbl, r.col) using p_player;
  end loop;
  delete from public.rich_list_snapshots where entity_kind = 'player' and entity_id = p_player;

  -- money back to the state: one balanced posting per account
  for r in select a.id from public.ledger_accounts a where a.owner_player_id = p_player and a.balance_cents > 0 order by a.id loop
    select a.balance_cents into v_bal from public.ledger_accounts a where a.id = r.id;
    perform public.ledger_transfer(r.id, v_state, v_bal, 'transfer', 'Konto zurückgesetzt', 'profile', p_player,
                                   p_key || ':' || r.id::text, p_player);
  end loop;

  update public.profiles
     set level = 1, xp_total = 0, reputation = 50, title_key = null, frame_key = null,
         bankrupt_until = null, founding_locked_until = null
   where id = p_player;
  update public.player_private
     set founding_ban_until = null, bankruptcy_count = 0, career_experience_minutes = 0, ipo_investment_limit_cents = null,
         tutorial_completed_at = null, tax_loss_pot_cents = 0
   where player_id = p_player;
end;
$$;
comment on function public.account_wipe(uuid, text) is 'Internal: cleanup shared by reset_account() and delete_account().';

-- Checks the confirmation (the own nickname, case-insensitive, trimmed).
create or replace function public.account_confirm(p_player uuid, p_confirm text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_confirm is null
     or not exists (select 1 from public.profiles p where p.id = p_player and lower(p.nickname) = lower(btrim(p_confirm))) then
    raise exception using errcode = 'NX061', message = 'confirm_mismatch';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.reset_account(p_request_id uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player      uuid;
  v_replay      jsonb;
  v_now         timestamptz := public.game_now();
  v_start_cents bigint := greatest(public.config_bigint('economy', '{startingCapitalCents}', 1000000), 0);
  v_vault_hours double precision := greatest(0, least(
                    public.config_double('economy', '{vaultInitialHours}', 2),
                    public.config_double('economy', '{vaultCapHours}', 8)));
  v_key         text;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'reset_account');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.account_confirm(v_player, p_confirm);
  v_key := 'reset:' || v_player::text || ':' || p_request_id::text;

  perform public.account_wipe(v_player, v_key);

  -- what sign-up grants (handle_new_user)
  update public.vaults
     set accrual_started_at = public.game_now() - make_interval(secs => v_vault_hours * 3600),
         last_claimed_at = null, total_claimed_cents = 0, full_notified_at = null
   where player_id = v_player;
  update public.login_streaks
     set current_streak = 0, longest_streak = 0, last_login_day = null, freeze_tokens = 1, freeze_granted_week = null,
         reward_cycle_day = 0, reward_last_day = null
   where player_id = v_player;
  insert into public.player_unlocks (player_id, unlock_key)
  select v_player, u.key from public.unlocks u where u.level <= 1
  on conflict do nothing;
  update public.player_private set account_reset_at = v_now where player_id = v_player;
  if v_start_cents > 0 then
    perform public.state_payout(v_player, v_start_cents, 0, 'restart_capital', 'Starting capital (account reset)',
                                'profile', v_player, v_key || ':start');
  end if;

  return public.request_complete(v_player, p_request_id, jsonb_build_object('ok', true, 'reset_at', v_now));
end;
$$;
comment on function public.reset_account(uuid, text) is 'RPC: resets the own account to a fresh start (p_confirm = own nickname).';

create or replace function public.delete_account(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  v_player := public.require_player();
  perform public.account_confirm(v_player, p_confirm);
  perform public.account_wipe(v_player, 'delete:' || v_player::text);
  update public.ledger_accounts set is_frozen = true where owner_player_id = v_player;
  delete from auth.users where id = v_player;
  return jsonb_build_object('ok', true);
end;
$$;
comment on function public.delete_account(text) is 'RPC: deletes the own account (p_confirm = own nickname); the nickname is free again.';

-- ---------------------------------------------------------------------------
-- D. Portfolio: trades before the last reset are no longer shown
-- ---------------------------------------------------------------------------
create or replace function public.get_my_portfolio()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player    uuid;
  v_cash      bigint;
  v_reserved  bigint;
  v_positions jsonb;
  v_value     bigint;
  v_bid_value bigint;
  v_orders    jsonb;
  v_trades    jsonb;
  v_prof      public.profiles;
  v_priv      public.player_private;
  v_level     jsonb;
  v_days      double precision := public.config_double('names', '{nicknameChangeDays}', 60);
  v_today     date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_streak    integer;
  ls          public.login_streaks;
begin
  v_player := public.require_player();
  select * into v_priv from public.player_private where player_id = v_player;
  select coalesce(sum(a.balance_cents) filter (where a.kind = 'player_cash'), 0),
         coalesce(sum(a.balance_cents) filter (where a.kind = 'player_reserve'), 0)
    into v_cash, v_reserved
    from public.ledger_accounts a where a.owner_player_id = v_player;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ticker', x.ticker, 'name', x.name, 'kind', x.kind, 'quantity_e6', x.quantity_e6,
           'reserved_quantity_e6', x.reserved_quantity_e6, 'avg_price_e4', x.avg_entry_price_e4,
           'last_price_e4', x.last_price_e4, 'market_value_cents', x.mv, 'cost_basis_cents', x.cost_basis_cents,
           'unrealized_pnl_cents', x.mv - x.cost_basis_cents, 'realized_pnl_cents', x.realized_pnl_cents,
           'change_bps', x.change_bps, 'opened_at', x.opened_at)
           order by x.mv desc), '[]'::jsonb),
         coalesce(sum(x.mv), 0)::bigint,
         coalesce(sum(x.bv), 0)::bigint
    into v_positions, v_value, v_bid_value
    from (select s.ticker, s.name, s.kind, p.quantity_e6, p.reserved_quantity_e6, p.avg_entry_price_e4, p.cost_basis_cents,
                 p.realized_pnl_cents, p.opened_at, q.last_price_e4, q.change_bps,
                 public.value_cents(p.quantity_e6, q.last_price_e4) as mv,
                 public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)) as bv
            from public.positions p
            join public.securities s on s.id = p.security_id
            join public.security_quotes q on q.security_id = p.security_id
           where p.player_id = v_player and p.status = 'open' and p.quantity_e6 > 0) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'ticker', s.ticker, 'side', o.side, 'type', o.type, 'quantity_e6', o.quantity_e6,
           'filled_quantity_e6', o.filled_quantity_e6, 'limit_price_e4', o.limit_price_e4, 'status', o.status,
           'reserved_cents', o.reserved_cents, 'created_at', o.created_at)
           order by o.created_at desc), '[]'::jsonb)
    into v_orders
    from public.orders o join public.securities s on s.id = o.security_id
   where o.player_id = v_player and o.status in ('open', 'partially_filled');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'ticker', t.ticker, 'side', t.side, 'quantity_e6', t.quantity_e6, 'price_e4', t.price_e4,
           'gross_cents', t.gross_cents, 'fee_cents', t.fee_cents, 'tax_cents', t.tax_cents,
           'realized_pnl_cents', t.realized_pnl_cents, 'xp_awarded', t.xp_awarded, 'executed_at', t.executed_at)
           order by t.executed_at desc), '[]'::jsonb)
    into v_trades
    from (select tr.*, s.ticker from public.trades tr join public.securities s on s.id = tr.security_id
           where tr.player_id = v_player and tr.executed_at > coalesce(v_priv.account_reset_at, '-infinity'::timestamptz)
           order by tr.executed_at desc limit 50) t;

  select * into v_prof from public.profiles where id = v_player;
  select * into ls from public.login_streaks where player_id = v_player;
  v_level := public.level_progress(v_prof.xp_total);
  v_streak := case when ls.last_login_day >= v_today - 1 then ls.current_streak
                   when ls.last_login_day = v_today - 2 and ls.freeze_tokens > 0 then ls.current_streak
                   else 0 end;

  return jsonb_build_object(
    'cash_cents',            v_cash,
    'reserved_cents',        v_reserved,
    'positions_value_cents', v_value,
    'total_cents',           v_cash + v_reserved + v_value,
    'net_worth_cents',       v_cash + v_reserved + v_bid_value,
    'loss_pot_cents',        coalesce(v_priv.tax_loss_pot_cents, 0),
    'vault',                 public.vault_status(v_player) - 'accrued_seconds' - 'base_rate_cents_per_hour',
    'positions',             v_positions,
    'open_orders',           v_orders,
    'recent_trades',         v_trades,
    'level',                 v_prof.level,
    'xp_total',              v_prof.xp_total,
    'xp_into_level',         (v_level ->> 'xp_into_level')::bigint,
    'xp_for_next',           (v_level ->> 'xp_for_next')::bigint,
    'tutorial_completed',    v_priv.tutorial_completed_at is not null,
    'nickname',              v_prof.nickname,
    'nickname_change_available_at',
                             case when v_prof.nickname_changed_at is null
                                    or v_prof.nickname_changed_at + make_interval(secs => v_days * 86400) <= now() then null
                                  else v_prof.nickname_changed_at + make_interval(secs => v_days * 86400) end,
    'missions_claimable',    (select count(*) from public.player_missions m
                               where m.player_id = v_player and m.status = 'completed'
                                 and (m.expires_at is null or m.expires_at > public.game_now()))::integer,
    'streak_days',           coalesce(v_streak, 0),
    'avatar_key',            coalesce(v_prof.avatar_key, 'rookie'),
    'skill_points_free',     coalesce((select sp.free_points from public.player_skill_points sp where sp.player_id = v_player), 0),
    'daily_reward_claimable', not exists (select 1 from public.daily_reward_claims c
                                           where c.player_id = v_player
                                             and c.claim_day = (public.game_now() at time zone 'Europe/Berlin')::date),
    'company_value_cents',   public.player_company_value_cents(v_player),
    'debt_cents',            public.player_debt_cents(v_player),
    'debt_withholding_bps',  public.config_double('startups', '{insolvency,loanWithholdingBps}', 5000)::integer,
    'founding_locked_until', case when v_prof.founding_locked_until > now() then v_prof.founding_locked_until end,
    'server_time',           public.game_now());
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.account_wipe(uuid, text)', 'public.account_confirm(uuid, text)',
    'public.reset_account(uuid, text)', 'public.delete_account(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.reset_account(uuid, text)', 'public.delete_account(text)'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
