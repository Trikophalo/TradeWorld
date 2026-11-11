-- =============================================================================
-- NEXA · M2b · 0400 · Wiring: portfolio fields, avatars on the rich list,
--                     job postings and wages in run_due_jobs()
-- =============================================================================

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
           where tr.player_id = v_player order by tr.executed_at desc limit 50) t;

  select * into v_prof from public.profiles where id = v_player;
  select * into v_priv from public.player_private where player_id = v_player;
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
    'server_time',           public.game_now());
end;
$$;


create or replace function public.get_rich_list(p_limit integer default 100, p_offset integer default 0, p_scope text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_limit   integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_scope   text := coalesce(p_scope, 'all');
  v_now     timestamptz := public.game_now();
  v_snap    timestamptz;
  v_out     jsonb;
begin
  v_player := public.require_player();
  if v_scope not in ('all', 'players') then
    perform public.api_error('invalid_argument');
  end if;
  -- the latest snapshot that is at least 24 h old
  select max(s.taken_at) into v_snap from public.rich_list_snapshots s where s.taken_at <= v_now - interval '24 hours';

  with lst as materialized (
    select e.entity_kind, e.entity_id, e.name, e.description, e.net_worth_cents,
           case when v_scope = 'players' then e.rank_players else e.rank_all end as rnk,
           case when s.net_worth_cents > 0 then round((e.net_worth_cents - s.net_worth_cents) * 10000.0 / s.net_worth_cents)::integer end as change_bps,
           case when s.entity_id is not null
                then (case when v_scope = 'players' then s.rank_players else s.rank_all end)
                   - (case when v_scope = 'players' then e.rank_players else e.rank_all end) end as rank_change
      from public.rich_list_entries() e
      left join public.rich_list_snapshots s on s.taken_at = v_snap and s.entity_kind = e.entity_kind and s.entity_id = e.entity_id
     where v_scope = 'all' or e.entity_kind = 'player'
  ), me as (
    select * from lst where entity_kind = 'player' and entity_id = v_player
  )
  select jsonb_build_object(
           'server_time', v_now,
           'total', (select count(*) from lst),
           'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                          'rank', x.rnk, 'kind', x.entity_kind, 'id', x.entity_id, 'name', x.name, 'description', x.description,
                          'net_worth_cents', x.net_worth_cents, 'change_24h_bps', x.change_bps, 'rank_change_24h', x.rank_change,
                          'is_me', x.entity_kind = 'player' and x.entity_id = v_player,
                          'avatar_key', case when x.entity_kind = 'player'
                                             then (select pr.avatar_key from public.profiles pr where pr.id = x.entity_id)
                                             else public.tycoon_avatar_key(x.entity_id) end) order by x.rnk), '[]'::jsonb)
                         from (select * from lst order by rnk offset v_offset limit v_limit) x),
           'me', (select jsonb_build_object(
                           'rank', m.rnk, 'net_worth_cents', m.net_worth_cents,
                           'next', (select jsonb_build_object('rank', n.rnk, 'name', n.name, 'gap_cents', n.net_worth_cents - m.net_worth_cents)
                                      from lst n where n.rnk = m.rnk - 1))
                    from me m))
    into v_out;
  return v_out;
end;
$$;


create or replace function public.run_due_jobs()
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
  perform public.ensure_game_quarters(3);

  if not exists (select 1 from public.candles limit 1) or not public.money_genesis_done()
     or not exists (select 1 from public.rich_tycoons) then
    v_result := v_result || jsonb_build_object('bootstrap', public.market_bootstrap());
  end if;

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

  -- jobs: AI postings of the running quarter, wages since the last run
  v_result := v_result || jsonb_build_object('job_postings', public.refresh_ai_job_postings(),
                                             'salaries_paid', public.accrue_salaries(null));

  -- rich list snapshot every richList.snapshotMinutes (rank news, 24 h changes, state missions)
  v_result := v_result || jsonb_build_object('rich_list', public.rich_list_snapshot(false));

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
  return v_result;
end;
$$;
comment on function public.run_due_jobs() is 'pg_cron every minute: calendar, lazy bootstrap, due quarter closes, bond maturities and new series, AI job postings, salaries, rich list snapshots, daily maintenance.';

do $$
declare
  f text;
begin
  foreach f in array array['public.get_my_portfolio()', 'public.get_rich_list(integer, integer, text)', 'public.run_due_jobs()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.get_my_portfolio() to authenticated;
  grant execute on function public.get_rich_list(integer, integer, text) to authenticated;
end;
$$;
