-- ===== idempotent copy of migrations/20261127000200_m4f_league.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M4f · 0200 · Weekly league (ADR-089)
-- =============================================================================
-- Season = Berlin calendar week (Monday 00:00 to next Monday 00:00 Europe/Berlin, game time).
-- Every active player gets an entry and a baseline the first time a season is refreshed after
-- they exist: start_net_worth_cents = net worth as in the rich list (rich_list_entries()).
--   growth_bps = round_half_even((current - start - net_inflow) * 10 000 / max(start, social.league.minBaselineCents))
-- net_inflow_cents counts free money (vault basic income, daily reward cash) via triggers on
-- vault_claims and daily_reward_claims; wages, company payouts, trading and art are performance.
-- public.social_run_due() (called by run_due_jobs every minute):
--   1. closes due seasons (final recompute, status finished, winner_id = rank 1, feed item league_won,
--      notification league_result to every ranked participant),
--   2. ensures the current season, refreshes it every social.league.updateEveryMinutes,
--   3. deletes feed items older than social.feed.keepDays (with the refresh).
-- RPC get_league(scope 'all' | 'friends', week 'current' | 'last'); get_player_card gains trophies.
-- Errors: invalid_argument (unknown scope or week).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.league_seasons add column if not exists refreshed_at timestamptz;
comment on column public.league_seasons.refreshed_at is 'Game time of the last standings refresh (ADR-089); null = never.';

-- ---------------------------------------------------------------------------
-- B. Helpers
-- ---------------------------------------------------------------------------
-- Monday (Europe/Berlin) of the week that contains p_at
create or replace function public.league_week_start(p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'Europe/Berlin')::date - (extract(isodow from (p_at at time zone 'Europe/Berlin'))::integer - 1);
$$;

-- "+3,40 %" / "-0,25 %"
create or replace function public.format_growth_bps(p_bps bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_bps < 0 then '-' else '+' end
      || replace(to_char(abs(p_bps) / 100.0, 'FM999999990.00'), '.', ',') || ' %';
$$;

-- The season of the week that contains p_at (created as active if missing)
create or replace function public.league_ensure_season(p_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week date := public.league_week_start(p_at);
  v_id   uuid;
begin
  insert into public.league_seasons (week_start, starts_at, ends_at, status)
  values (v_week, v_week::timestamp at time zone 'Europe/Berlin', (v_week + 7)::timestamp at time zone 'Europe/Berlin', 'active')
  on conflict (week_start) do nothing;
  select s.id into v_id from public.league_seasons s where s.week_start = v_week;
  return v_id;
end;
$$;

-- Free money of a player counts as inflow of every open season that has started
create or replace function public.league_add_inflow(p_player uuid, p_cents bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_player is null or coalesce(p_cents, 0) = 0 then
    return;
  end if;
  update public.league_entry_baselines b
     set net_inflow_cents = b.net_inflow_cents + p_cents, updated_at = now()
    from public.league_seasons s
   where s.id = b.season_id and b.player_id = p_player and s.status <> 'finished' and s.starts_at <= public.game_now();
end;
$$;

-- Net worth, growth and rank of one season. p_add_new: active players without an entry join
-- with their current net worth as baseline. Returns the number of ranked entries.
create or replace function public.league_refresh(p_season uuid, p_add_new boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min   bigint := greatest(1, public.config_bigint('social', '{league,minBaselineCents}', 1000000));
  v_count integer;
begin
  with nw as materialized (
    select e.entity_id as player_id, e.net_worth_cents as nw
      from public.rich_list_entries() e where e.entity_kind = 'player'
  ), new_entries as (
    insert into public.league_entries (season_id, player_id)
    select p_season, n.player_id from nw n
     where p_add_new
       and not exists (select 1 from public.league_entries x where x.season_id = p_season and x.player_id = n.player_id)
    on conflict do nothing
    returning player_id
  ), new_baselines as (
    insert into public.league_entry_baselines (season_id, player_id, start_net_worth_cents, current_net_worth_cents)
    select p_season, x.player_id, n.nw, n.nw from new_entries x join nw n on n.player_id = x.player_id
    on conflict do nothing
    returning player_id
  )
  update public.league_entry_baselines b
     set current_net_worth_cents = n.nw, updated_at = now()
    from nw n
   where b.season_id = p_season and b.player_id = n.player_id and b.current_net_worth_cents <> n.nw;

  update public.league_entries e
     set growth_bps = greatest(-2000000000, least(2000000000, public.div_round_half_even(
                        (b.current_net_worth_cents - b.start_net_worth_cents - b.net_inflow_cents)::numeric * 10000,
                        greatest(b.start_net_worth_cents, v_min))))::integer,
         updated_at = now()
    from public.league_entry_baselines b
   where e.season_id = p_season and b.season_id = e.season_id and b.player_id = e.player_id;

  -- rank: growth, then the earlier account, then nickname; deactivated players are not ranked
  update public.league_entries e set rank = r.rk
    from (select x.player_id,
                 (row_number() over (order by x.growth_bps desc, p.created_at, lower(p.nickname), p.id))::integer as rk
            from public.league_entries x join public.profiles p on p.id = x.player_id
           where x.season_id = p_season and not p.is_deactivated) r
   where e.season_id = p_season and e.player_id = r.player_id and e.rank is distinct from r.rk;
  update public.league_entries e set rank = null
   where e.season_id = p_season and e.rank is not null
     and exists (select 1 from public.profiles p where p.id = e.player_id and p.is_deactivated);

  update public.league_seasons set refreshed_at = public.game_now(), updated_at = now() where id = p_season;
  select count(*) into v_count from public.league_entries e where e.season_id = p_season and e.rank is not null;
  return v_count;
end;
$$;

-- Final recompute, winner, feed item league_won, league_result for every ranked participant
create or replace function public.league_close(p_season uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.league_seasons;
  v_count  integer;
  v_winner uuid;
  v_growth integer;
  r        record;
begin
  select * into s from public.league_seasons x where x.id = p_season for update;
  if s.id is null or s.status = 'finished' then
    return null;
  end if;
  v_count := public.league_refresh(p_season, false);
  select e.player_id, e.growth_bps into v_winner, v_growth
    from public.league_entries e where e.season_id = p_season and e.rank = 1;
  update public.league_seasons set status = 'finished', winner_id = v_winner, updated_at = now() where id = p_season;
  if v_winner is not null then
    perform public.feed_post(v_winner, 'league_won', jsonb_build_object('week_start', s.week_start, 'growth_bps', v_growth),
                             'league_won:' || p_season::text);
  end if;
  for r in select e.player_id, e.rank, e.growth_bps from public.league_entries e
            where e.season_id = p_season and e.rank is not null order by e.rank
  loop
    perform public.social_notify(r.player_id, 'league_result',
      case when r.rank = 1 then 'Du hast die Wochenliga gewonnen!' else 'Wochenliga: Platz ' || r.rank end,
      'Platz ' || r.rank || ' von ' || v_count || ' · ' || public.format_growth_bps(r.growth_bps),
      jsonb_build_object('week_start', s.week_start, 'rank', r.rank, 'of', v_count, 'growth_bps', r.growth_bps),
      '/friends', 'league_result:' || p_season::text);
  end loop;
  return jsonb_build_object('week_start', s.week_start, 'entries', v_count, 'winner', v_winner);
end;
$$;

-- Periodic social work, called by run_due_jobs every minute (throttled here)
create or replace function public.social_run_due()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := public.game_now();
  v_closed  jsonb := '[]'::jsonb;
  v_season  uuid;
  v_last    timestamptz;
  v_count   integer;
  v_deleted bigint := 0;
  q         record;
begin
  for q in select s.id from public.league_seasons s
            where s.status <> 'finished' and s.ends_at <= v_now order by s.ends_at limit 8
  loop
    v_closed := v_closed || coalesce(public.league_close(q.id), 'null'::jsonb);
  end loop;
  v_season := public.league_ensure_season(v_now);
  select s.refreshed_at into v_last from public.league_seasons s where s.id = v_season;
  if v_last is not null
     and v_last > v_now - make_interval(secs => greatest(1, public.config_double('social', '{league,updateEveryMinutes}', 10)) * 60 - 5) then
    return jsonb_build_object('closed', v_closed, 'skipped', 'recent');
  end if;
  v_count := public.league_refresh(v_season, true);
  delete from public.feed_items fi
   where fi.created_at < now() - make_interval(days => greatest(1, public.config_double('social', '{feed,keepDays}', 30))::integer);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('closed', v_closed, 'league_entries', v_count, 'feed_deleted', v_deleted);
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Free money as league inflow
-- ---------------------------------------------------------------------------
create or replace function public.league_on_vault_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.league_add_inflow(new.player_id, new.amount_cents);
  return null;
end;
$$;
drop trigger if exists league_on_vault_claim on public.vault_claims;
create trigger league_on_vault_claim after insert on public.vault_claims
  for each row when (new.amount_cents > 0) execute function public.league_on_vault_claim();

create or replace function public.league_on_daily_reward()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.league_add_inflow(new.player_id, new.cash_cents);
  return null;
end;
$$;
drop trigger if exists league_on_daily_reward on public.daily_reward_claims;
create trigger league_on_daily_reward after insert on public.daily_reward_claims
  for each row when (new.cash_cents > 0) execute function public.league_on_daily_reward();

-- ---------------------------------------------------------------------------
-- D. RPC get_league
-- ---------------------------------------------------------------------------
create or replace function public.get_league(p_scope text default 'all', p_week text default 'current')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_now     timestamptz := public.game_now();
  v_current date := public.league_week_start(v_now);
  v_week    date;
  s         public.league_seasons;
  v_entries jsonb;
  v_me      jsonb;
  v_last    jsonb;
begin
  if p_scope is null or p_scope not in ('all', 'friends') or p_week is null or p_week not in ('current', 'last') then
    perform public.api_error('invalid_argument');
  end if;
  v_week := case when p_week = 'last' then v_current - 7 else v_current end;
  select * into s from public.league_seasons x where x.week_start = v_week;

  with x as (
    select e.player_id, e.growth_bps, p.nickname, p.tag, p.avatar_key, p.level,
           (row_number() over (order by e.rank nulls last, e.growth_bps desc, p.created_at, lower(p.nickname), p.id))::integer as rk
      from public.league_entries e join public.profiles p on p.id = e.player_id
     where e.season_id = s.id and not p.is_deactivated
       and (p_scope = 'all' or e.player_id = v_player or e.player_id in (select public.friend_ids(v_player)))
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank', x.rk, 'nickname', x.nickname, 'tag', x.tag, 'avatar_key', x.avatar_key,
                                               'level', x.level, 'growth_bps', x.growth_bps, 'is_me', x.player_id = v_player)
                            order by x.rk) filter (where x.rk <= 100), '[]'::jsonb),
         (select jsonb_build_object('rank', y.rk, 'growth_bps', y.growth_bps) from x y where y.player_id = v_player)
    into v_entries, v_me
    from x;

  select jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key, 'growth_bps', e.growth_bps,
                            'week_start', ls.week_start)
    into v_last
    from public.league_seasons ls
    join public.profiles p on p.id = ls.winner_id
    join public.league_entries e on e.season_id = ls.id and e.player_id = ls.winner_id
   where ls.status = 'finished' and ls.week_start < v_current and not p.is_deactivated
   order by ls.week_start desc
   limit 1;

  return jsonb_build_object(
    'season', jsonb_build_object(
      'week_start', v_week,
      'starts_at',  coalesce(s.starts_at, v_week::timestamp at time zone 'Europe/Berlin'),
      'ends_at',    coalesce(s.ends_at, (v_week + 7)::timestamp at time zone 'Europe/Berlin'),
      'status',     coalesce(s.status::text, case when p_week = 'last' then 'finished' else 'active' end)),
    'entries', v_entries,
    'me', v_me,
    'last_winner', v_last);
end;
$$;
comment on function public.get_league(text, text) is
  'RPC: weekly league standings (ADR-089); scope all | friends (me + accepted friends, re-numbered), week current | last.';

-- ---------------------------------------------------------------------------
-- E. get_player_card as in M4d plus trophies (closed seasons, ranks 1..3 within social.league.podium)
-- ---------------------------------------------------------------------------
create or replace function public.get_player_card(p_nickname text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p      public.profiles;
  v_job  jsonb;
  v_pod  integer := least(3, greatest(0, public.config_double('social', '{league,podium}', 3)::integer));
begin
  perform public.require_player();
  select * into p from public.profiles x where x.id = public.player_by_handle(p_nickname);
  if p.id is null then
    perform public.api_error('player_not_found');
  end if;
  select jsonb_build_object('company_name', c.name, 'title_key', j.title_key, 'title', case when j.title_key is null then j.title end,
                            'tier', j.tier, 'since', j.started_at)
    into v_job
    from public.player_jobs j join public.companies c on c.id = j.company_id
   where j.player_id = p.id and j.status = 'active';
  return jsonb_build_object(
    'nickname',        p.nickname,
    'tag',             p.tag,
    'avatar_key',      p.avatar_key,
    'level',           p.level,
    'rank',            public.player_rich_rank(p.id),
    'net_worth_cents', public.player_net_worth_cents(p.id),
    'streak_days',     public.player_streak_days(p.id),
    'skills_learned',  (select count(*) from public.player_skills s where s.player_id = p.id)::integer,
    'branch_scores',   public.player_branch_scores(p.id),
    'top_skills',      coalesce((select jsonb_agg(jsonb_build_object('key', x.skill_key, 'tier', x.tier) order by x.tier desc, x.learned_at)
                                   from (select s.skill_key, s.learned_at, (public.skill_node(s.skill_key) ->> 'tier')::integer as tier
                                           from public.player_skills s where s.player_id = p.id
                                          order by 3 desc nulls last, s.learned_at limit 3) x), '[]'::jsonb),
    'job',             v_job,
    'company',         (select jsonb_build_object('name', c.name, 'ticker', c.ticker)
                          from public.player_companies pc join public.companies c on c.id = pc.company_id
                         where pc.founder_id = p.id and pc.status = 'active'),
    'trophies',        (select jsonb_build_object('gold',   count(*) filter (where e.rank = 1),
                                                  'silver', count(*) filter (where e.rank = 2),
                                                  'bronze', count(*) filter (where e.rank = 3))
                          from public.league_entries e join public.league_seasons ls on ls.id = e.season_id
                         where e.player_id = p.id and ls.status = 'finished' and e.rank between 1 and v_pod),
    'member_since',    p.created_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- F. run_due_jobs as in M4a plus the social work (league, feed clean-up)
-- ---------------------------------------------------------------------------
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
  -- player companies: operating hours (ADR-072), then every closed quarter since their founding (ADR-057)
  v_result := v_result || jsonb_build_object('player_companies', public.player_companies_run_due());

  -- bonds that matured between quarter closes (or after a downtime)
  if exists (select 1 from public.bonds bd join public.securities s on s.id = bd.security_id
              where s.status = 'listed' and bd.matures_at <= v_now) then
    v_result := v_result || jsonb_build_object('bonds_redeemed', public.redeem_matured_bonds(v_now));
  end if;
  v_result := v_result || jsonb_build_object('bonds_issued', public.ensure_bond_series());

  -- jobs: AI postings of the running quarter, wages of AI-company jobs in whole hours
  v_result := v_result || jsonb_build_object('quit_notices', public.process_quit_notices(null));
  v_result := v_result || jsonb_build_object('share_offers', public.close_due_offers(null));
  v_result := v_result || jsonb_build_object('job_postings', public.refresh_ai_job_postings(),
                                             'salaries_paid', public.accrue_salaries(null));

  -- artworks (ADR-080): due auctions are settled, the gallery starts the auctions of the day
  v_result := v_result || jsonb_build_object('artworks', public.artworks_run_due());

  -- rich list snapshot every richList.snapshotMinutes (rank news, 24 h changes, state missions)
  v_result := v_result || jsonb_build_object('rich_list', public.rich_list_snapshot(false));

  -- weekly league and feed clean-up (ADR-088, ADR-089), throttled inside
  v_result := v_result || jsonb_build_object('social', public.social_run_due());

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

-- ---------------------------------------------------------------------------
-- G. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.league_week_start(timestamptz)', 'public.format_growth_bps(bigint)', 'public.league_ensure_season(timestamptz)',
    'public.league_add_inflow(uuid, bigint)', 'public.league_refresh(uuid, boolean)', 'public.league_close(uuid)',
    'public.social_run_due()', 'public.league_on_vault_claim()', 'public.league_on_daily_reward()',
    'public.get_league(text, text)', 'public.get_player_card(text)', 'public.run_due_jobs()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.get_league(text, text)', 'public.get_player_card(text)'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
