-- ===== idempotent copy of migrations/20261204005350_mission_reset.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5350 · Affordable missions and one reset per real day (ADR-166)
-- =============================================================================
-- * mission_affordable(): quick, daily and weekly missions are only handed out when the player (or the own company)
--   has the money for them: buys and volume against cash and holdings, purchases against the cheapest offer,
--   AI workers against the company's wage reserve, business moves against the company cash. Milestones stay
--   saving goals. mission_doable() asks it first (patched by replace).
-- * mission_money_cap(): money targets (buy value, volume, profit) are clamped to a share of the player's means
--   when the mission is assigned; below a sensible minimum the mission is not handed out at all.
-- * reset_missions(): once per Berlin day (progression.missionResetsPerDay) the open quick, daily and weekly
--   missions are replaced by new ones; completed ones and milestones stay. A template that was reset does not come
--   back for 20 hours. get_my_missions() reports reset_available and next_reset_at.
-- * Errors: mission_reset_used NX176, mission_reset_nothing NX177.
-- Idempotent: runs unchanged as supabase/updates/20261204005350_mission_reset.sql.

-- ---------------------------------------------------------------------------
-- A. Error keys, schema
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''mission_reset_used''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'nexamon_grading_limit'      then 'NX175'
$q$, $q$    when 'nexamon_grading_limit'      then 'NX175'
    when 'mission_reset_used'         then 'NX176'
    when 'mission_reset_nothing'      then 'NX177'
$q$);
    if position('''mission_reset_used''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the mission reset error keys by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

alter table public.player_missions add column if not exists reset_at timestamptz;
comment on column public.player_missions.reset_at is
  'Set when the player swapped this mission with reset_missions() (ADR-166); such a row no longer fills a slot.';

create table if not exists public.mission_resets (
  player_id  uuid not null references public.profiles (id) on delete cascade,
  reset_day  date not null,
  used       integer not null default 1 check (used >= 0),
  last_at    timestamptz not null default now(),
  primary key (player_id, reset_day)
);
comment on table public.mission_resets is
  'How often a player swapped the open missions on a Berlin day (ADR-166). Written only by reset_missions().';
-- internal: read and written only by the mission functions
alter table public.mission_resets enable row level security;
revoke all on public.mission_resets from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B. What a player can afford
-- ---------------------------------------------------------------------------
-- Upper limit in cents for the money target of a mission; null means "no limit".
create or replace function public.mission_money_cap(p_player uuid, p_kind text, p_metric text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg  jsonb := coalesce(public.config_jsonb('progression', '{missionAfford}'), '{}'::jsonb);
  v_cash bigint;
  v_hold bigint;
begin
  if p_metric not in ('buy_value', 'trade_value', 'realized_profit') or p_kind not in ('quick', 'daily', 'weekly') then
    return null;
  end if;
  select greatest(a.balance_cents, 0) into v_cash
    from public.ledger_accounts a where a.owner_player_id = p_player and a.kind = 'player_cash';
  v_cash := coalesce(v_cash, 0);
  -- one buy has to fit into the cash at hand
  if p_metric = 'buy_value' then
    return floor(v_cash * public.cfg_num(v_cfg, '{buyShareBps}', 5000) / 10000)::bigint;
  end if;
  -- volume and profit come from everything that can be traded: cash and open positions
  select coalesce(sum(public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4))), 0)::bigint into v_hold
    from public.positions p join public.security_quotes q on q.security_id = p.security_id
   where p.player_id = p_player and p.status = 'open' and p.quantity_e6 > 0;
  if p_metric = 'trade_value' then
    return floor((v_cash + v_hold) * public.cfg_num(v_cfg, array['volumeShareBps', p_kind],
                                                    case p_kind when 'quick' then 5000 when 'daily' then 10000 else 30000 end)
                 / 10000)::bigint;
  end if;
  return floor((v_cash + v_hold) * public.cfg_num(v_cfg, array['profitShareBps', p_kind],
                                                  case p_kind when 'quick' then 100 when 'daily' then 200 else 1000 end)
               / 10000)::bigint;
end;
$$;
revoke all on function public.mission_money_cap(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mission_money_cap(uuid, text, text) to service_role;
comment on function public.mission_money_cap(uuid, text, text) is
  'Highest money target (cents) a quick, daily or weekly mission may get for this player; null = no limit (ADR-166).';

create or replace function public.mission_affordable(p_player uuid, p_key text, p_metric text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb;
  t        record;
  v_level  integer;
  v_cash   bigint;
  v_ccash  bigint;
  v_n      integer;
  v_cap    bigint;
  v_tmin   bigint;
  v_cost   bigint;
  v_count  integer;
  v_tier   text;
  pc       public.player_companies;
begin
  if p_metric not in ('buy_value', 'trade_value', 'realized_profit', 'buy', 'buy_sector', 'bond_bought', 'sectors_bought',
                      'company_deposit', 'accessory_bought', 'furniture_bought', 'art_bid', 'art_won', 'nft_bought',
                      'nft_offer', 'ai_worker_hired', 'move_started', 'move_success') then
    return true;
  end if;
  select mt.kind, mt.target_min, mt.scale_with_level into t from public.mission_templates mt where mt.key = p_key;
  -- milestones are saving goals: they stay, however far away
  if t.kind is null or t.kind not in ('quick', 'daily', 'weekly') then
    return true;
  end if;
  v_cfg := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  select greatest(a.balance_cents, 0) into v_cash
    from public.ledger_accounts a where a.owner_player_id = p_player and a.kind = 'player_cash';
  v_cash := coalesce(v_cash, 0);
  select p.level into v_level from public.profiles p where p.id = p_player;
  v_level := coalesce(v_level, 1);
  -- a week leaves time to earn the rest: only part of a weekly count has to be affordable right now
  v_n := case when t.kind = 'weekly'
              then greatest(1, ceil(t.target_min * public.cfg_num(v_cfg, '{missionAfford,weeklyCountShareBps}', 5000) / 10000)::integer)
              else greatest(1, t.target_min::integer) end;

  if p_metric in ('buy_value', 'trade_value', 'realized_profit') then
    v_cap := public.mission_money_cap(p_player, t.kind, p_metric);
    v_tmin := case when t.scale_with_level
                   then round(t.target_min * least(public.cfg_num(v_cfg, '{missionTargetScaleMax}', 5),
                                                    1 + public.cfg_num(v_cfg, '{missionTargetScalePerLevel}', 0.2) * (v_level - 1))
                              / 100)::bigint * 100
                   else t.target_min end;
    -- the target is clamped to the cap when the mission is assigned; below the minimum it is not worth a mission
    return v_cap >= least(v_tmin,
                          case when p_metric = 'realized_profit'
                               then public.cfg_num(v_cfg, '{missionAfford,minProfitTargetCents}', 500)
                               else public.cfg_num(v_cfg, '{missionAfford,minBuyTargetCents}', 2000) end::bigint);
  elsif p_metric in ('buy', 'buy_sector', 'bond_bought', 'sectors_bought', 'company_deposit') then
    -- fractions make every security affordable; a little cash is still needed
    return v_cash >= public.cfg_num(v_cfg, '{missionAfford,minCashCents}', 1000)::bigint;
  elsif p_metric = 'accessory_bought' then
    -- the cheapest pieces the player does not own yet
    select count(*), coalesce(sum(s.price), 0) into v_count, v_cost
      from (select (x ->> 'priceCents')::bigint as price
              from jsonb_array_elements(coalesce(public.accessories_cfg() -> 'items', '[]'::jsonb)) x
             where not coalesce((x ->> 'exclusive')::boolean, false)
               and coalesce((x ->> 'minLevel')::integer, 1) <= v_level
               and (x ->> 'priceCents') is not null
               and not exists (select 1 from public.player_accessories a
                                where a.player_id = p_player and a.accessory_key = x ->> 'key')
             order by 1 limit v_n) s;
    return v_count >= v_n and v_cost <= v_cash;
  elsif p_metric = 'furniture_bought' then
    select h.tier into v_tier from public.player_homes h where h.player_id = p_player;
    if public.property_tier(v_tier) is null then
      v_tier := null;
    end if;
    select min(c.price_cents) into v_cost from public.furniture_catalog c;
    if v_cost is null then
      return false;
    end if;
    v_cost := public.apply_bps(public.property_furniture_list_cents(v_cost, v_tier),
                               10000 - public.player_property_discount_bps(p_player));
    return v_cost * v_n <= v_cash;
  elsif p_metric in ('art_bid', 'art_won', 'nft_bought') then
    -- an open auction whose next bid fits; buying also works with a listed NFT
    return exists (select 1 from public.artwork_auctions au join public.artworks a on a.id = au.artwork_id
                    where au.status = 'open' and au.ends_at > public.game_now()
                      and au.seller_id is distinct from p_player and a.owner_id is distinct from p_player
                      and public.artwork_min_bid_cents(au.start_cents, au.current_cents) <= v_cash)
        or (p_metric = 'nft_bought'
            and exists (select 1 from public.artworks a
                         where a.ask_cents is not null and a.ask_cents <= v_cash
                           and a.owner_id is distinct from p_player and (a.owner_id is not null or a.ai_owner is not null)
                           and not exists (select 1 from public.artwork_auctions x
                                            where x.artwork_id = a.id and x.status = 'open')));
  elsif p_metric = 'nft_offer' then
    return v_cash >= coalesce((public.nfts_cfg() ->> 'minOfferCents')::bigint, 0);
  end if;

  -- the rest is paid by the own company
  select * into pc from public.player_companies c where c.founder_id = p_player and c.status = 'active' limit 1;
  if pc.company_id is null then
    return true;  -- mission_doable() and the requirement decide
  end if;
  select greatest(a.balance_cents, 0) into v_ccash
    from public.ledger_accounts a where a.id = public.company_cash_account(pc.company_id);
  v_ccash := coalesce(v_ccash, 0);
  if p_metric = 'ai_worker_hired' then
    -- no open wages, and the cash covers the wages of all AI workers (the new ones included) for some hours
    return coalesce(pc.unpaid_cents, 0) <= 0
       and v_ccash >= (pc.ai_workers + v_n)::bigint
                      * public.config_bigint('startups', '{aiWorkerWageCentsPerHour}', 12000)
                      * public.cfg_num(v_cfg, '{missionAfford,aiWageHours}', 6)::bigint;
  end if;
  -- move_started, move_success: the cheapest business move, as often as the mission asks
  select min((m ->> 'cost_cents')::bigint) into v_cost
    from jsonb_array_elements(public.company_moves_state(pc.company_id) -> 'moves') m;
  return v_cost is not null and v_cost * v_n <= v_ccash;
end;
$$;
revoke all on function public.mission_affordable(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mission_affordable(uuid, text, text) to service_role;
comment on function public.mission_affordable(uuid, text, text) is
  'Can the player (or the own company) pay for this quick, daily or weekly mission right now? (ADR-166)';

-- mission_doable(): money first
do $do$
declare
  v_def text := pg_get_functiondef('public.mission_doable(uuid, text, text)'::regprocedure);
  v_old text := $t$  select case
    -- hiring needs a free place$t$;
  v_new text := $t$  select case
    -- ADR-166: nothing the player cannot pay for
    when not public.mission_affordable(p_player, p_key, p_metric) then false
    -- hiring needs a free place$t$;
begin
  if position('mission_affordable' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'mission_doable() has an unexpected shape; add mission_affordable() by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- C. missions_assign(): clamped money targets, reset rows free their slot
-- ---------------------------------------------------------------------------
create or replace function public.missions_assign(p_player uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prog     jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_now      timestamptz := public.game_now();
  v_today    date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_monday   date;
  v_level    integer;
  v_scale    double precision;
  v_xpscale  double precision;
  v_cscale   double precision;
  v_need     integer;
  v_n        integer := 0;
  v_kind     text;
  v_period   date;
  v_expires  timestamptz;
  v_rank     integer;
  v_target   bigint;
  v_cap      bigint;
  t          record;
begin
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  select p.level into v_level from public.profiles p where p.id = p_player for update;
  if v_level is null then
    return 0;
  end if;
  v_scale := least(public.cfg_num(v_prog, '{missionTargetScaleMax}', 5),
                   1 + public.cfg_num(v_prog, '{missionTargetScalePerLevel}', 0.2) * (v_level - 1));
  -- ADR-159: counted missions get harder with the level
  v_cscale := least(public.cfg_num(v_prog, '{missionCountScaleMax}', 1),
                    1 + public.cfg_num(v_prog, '{missionCountScalePerLevel}', 0) * (v_level - 1));
  -- ADR-142: mission XP grows with the level, so missions stay worth it as levels need more XP
  v_xpscale := least(public.cfg_num(v_prog, '{missionXpScaleMax}', 1),
                     1 + public.cfg_num(v_prog, '{missionXpScalePerLevel}', 0) * (v_level - 1));

  -- ADR-154: a mission nobody can finish any more (the company is full, the home is bought) makes room for another;
  -- ADR-166: the same for a quick mission the player can no longer pay for
  update public.player_missions m set status = 'expired', expires_at = least(coalesce(m.expires_at, v_now), v_now)
    from public.mission_templates mt
   where mt.key = m.template_key and m.player_id = p_player and m.status = 'active' and m.progress = 0
     and m.kind in ('quick', 'milestone') and mt.mode <> 'state'
     and not public.mission_doable(p_player, mt.key, mt.metric);

  -- expire what ran out
  update public.player_missions set status = 'expired'
   where player_id = p_player and status in ('active', 'completed') and expires_at is not null and expires_at <= v_now;

  foreach v_kind in array array['quick', 'daily', 'weekly', 'milestone'] loop
    if v_kind = 'quick' then
      v_need := public.cfg_num(v_prog, '{xpSources,quickMission,active}', 3)::integer
              - (select count(*) from public.player_missions m where m.player_id = p_player and m.kind = 'quick' and m.status in ('active', 'completed'));
      v_period := v_today; v_expires := null;
    elsif v_kind = 'daily' then
      -- ADR-166: a mission swapped by reset_missions() no longer fills its slot
      v_need := public.cfg_num(v_prog, '{xpSources,dailyMission,perDay}', 3)::integer
              - (select count(*) from public.player_missions m
                  where m.player_id = p_player and m.kind = 'daily' and m.period_start = v_today and m.reset_at is null);
      v_period := v_today; v_expires := ((v_today + 1)::timestamp) at time zone 'Europe/Berlin';
    elsif v_kind = 'weekly' then
      v_need := public.cfg_num(v_prog, '{xpSources,weeklyMission,perWeek}', 3)::integer
              - (select count(*) from public.player_missions m
                  where m.player_id = p_player and m.kind = 'weekly' and m.period_start = v_monday and m.reset_at is null);
      v_period := v_monday; v_expires := ((v_monday + 7)::timestamp) at time zone 'Europe/Berlin';
    else
      v_need := public.cfg_num(v_prog, '{xpSources,milestoneMission,visible}', 3)::integer
              - (select count(*) from public.player_missions m where m.player_id = p_player and m.kind = 'milestone' and m.status in ('active', 'completed'));
      v_period := date '2000-01-01'; v_expires := null;
    end if;
    continue when v_need <= 0;

    for t in
      select mt.*
        from public.mission_templates mt
       where mt.kind = v_kind and mt.mode is not null and mt.is_active
         and mt.min_level <= v_level
         and (not (mt.params ? 'unlock') or v_level >= public.unlock_level(mt.params ->> 'unlock'))
         and public.mission_requirement_ok(p_player, mt.params ->> 'requires')
         and public.mission_doable(p_player, mt.key, mt.metric)
         -- a swapped mission may come back after 20 hours (a week has more days than templates to burn)
         and not exists (select 1 from public.player_missions m
                          where m.player_id = p_player and m.template_key = mt.key
                            and ((m.period_start = v_period
                                  and (v_kind = 'milestone' or m.reset_at is null or m.reset_at > v_now - interval '20 hours'))
                                 or (v_kind = 'quick' and (m.status in ('active', 'completed')
                                                           or m.created_at > v_now - interval '24 hours'
                                                           or m.reset_at > v_now - interval '20 hours'))
                                 or v_kind = 'milestone'))
       order by case when v_kind = 'milestone' then mt.chain_order end,
                -ln(1 - random()) / greatest(mt.weight, 1)
       limit v_need
    loop
      if t.metric = 'rich_rank_improve' then
        v_rank := public.player_rich_rank(p_player);
        continue when v_rank is null or v_rank <= 1;
      end if;
      v_target := case when t.scale_with_level and public.mission_is_money_metric(t.metric)
                       then round((t.target_min + floor(random() * (t.target_max - t.target_min + 1))) * v_scale / 100)::bigint * 100
                       when t.mode in ('count', 'sum') and not public.mission_is_money_metric(t.metric)
                            and (v_kind in ('daily', 'weekly') or (v_kind = 'quick' and t.target_min >= 2))
                       then greatest(t.target_min, round((t.target_min + floor(random() * (t.target_max - t.target_min + 1))) * v_cscale))::bigint
                       else t.target_min + floor(random() * (t.target_max - t.target_min + 1))::bigint end;
      -- ADR-166: a money target never asks for more than the player can move (full euros)
      v_cap := public.mission_money_cap(p_player, v_kind, t.metric);
      if v_cap is not null and v_target > v_cap then
        v_target := greatest(v_cap / 100 * 100, 1);
      end if;
      insert into public.player_missions as pm (player_id, template_key, kind, period_start, target, xp_reward, expires_at, state)
      values (p_player, t.key, v_kind, v_period, v_target,
              case when coalesce((t.params ->> 'fixedXp')::boolean, false)
                   then t.xp_min + floor(random() * (t.xp_max - t.xp_min + 1))::integer
                   else round((t.xp_min + floor(random() * (t.xp_max - t.xp_min + 1))) * v_xpscale)::integer end,
              v_expires,
              case when t.metric = 'rich_rank_improve' then jsonb_build_object('baseline_rank', v_rank) else '{}'::jsonb end)
      -- a row swapped long enough ago is used again (one row per template and period)
      on conflict (player_id, template_key, period_start) do update
         set status = 'active', progress = 0, target = excluded.target, xp_reward = excluded.xp_reward,
             expires_at = excluded.expires_at, state = excluded.state, reset_at = null,
             completed_at = null, claimed_at = null, created_at = now()
       where pm.reset_at is not null and pm.reset_at <= v_now - interval '20 hours';
      if found then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  if v_n > 0 then
    perform public.mission_refresh_state(p_player);
  end if;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- D. The missions answer, the reset
-- ---------------------------------------------------------------------------
create or replace function public.missions_state(p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mult   double precision := public.config_double('progression', '{xpMultiplier}', 2);
  v_today  date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_monday date;
  v_limit  integer := public.config_bigint('progression', '{missionResetsPerDay}', 1)::integer;
  v_used   integer;
begin
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  perform public.missions_assign(p_player);
  perform public.mission_refresh_state(p_player);
  select coalesce((select r.used from public.mission_resets r where r.player_id = p_player and r.reset_day = v_today), 0)
    into v_used;
  return jsonb_build_object(
    'server_time', public.game_now(),
    -- ADR-166: one swap of the open missions per Berlin day
    'reset_available', v_used < v_limit,
    'next_reset_at', case when v_limit > 0 and v_used >= v_limit
                          then ((v_today + 1)::timestamp) at time zone 'Europe/Berlin' end,
    'groups', (
      select jsonb_agg(jsonb_build_object(
               'kind', g.kind,
               'resets_at', case g.kind when 'daily' then ((v_today + 1)::timestamp) at time zone 'Europe/Berlin'
                                        when 'weekly' then ((v_monday + 7)::timestamp) at time zone 'Europe/Berlin' end,
               'missions', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', m.id, 'key', m.template_key,
                          'title', public.mission_text(t.title, t.metric, m.target),
                          'description', public.mission_text(t.description, t.metric, m.target),
                          'progress', m.progress, 'target', m.target,
                          'xp', greatest(0, round(m.xp_reward * v_mult))::integer,
                          'status', m.status, 'expires_at', m.expires_at)
                          order by t.chain_order nulls last, m.created_at, m.id)
                   from public.player_missions m
                   join public.mission_templates t on t.key = m.template_key
                  where m.player_id = p_player and m.kind = g.kind
                    and case g.kind
                          when 'quick' then m.status in ('active', 'completed')
                          when 'daily' then m.period_start = v_today and m.status <> 'expired'
                          when 'weekly' then m.period_start = v_monday and m.status <> 'expired'
                          else m.status in ('active', 'completed') end), '[]'::jsonb))
               order by g.ord)
        from (values ('quick', 1), ('daily', 2), ('weekly', 3), ('milestone', 4)) as g(kind, ord)));
end;
$$;
revoke all on function public.missions_state(uuid) from public, anon, authenticated;
grant execute on function public.missions_state(uuid) to service_role;
comment on function public.missions_state(uuid) is
  'The missions of a player in the shape of get_my_missions(), with the state of the daily reset (ADR-166).';

create or replace function public.get_my_missions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.missions_state(public.require_player());
end;
$$;
revoke all on function public.get_my_missions() from public, anon;
grant execute on function public.get_my_missions() to authenticated, service_role;

create or replace function public.reset_missions(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_today  date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_monday date;
  v_limit  integer := public.config_bigint('progression', '{missionResetsPerDay}', 1)::integer;
  v_used   integer;
  v_n      integer;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'reset_missions');
  if v_replay is not null then
    return v_replay;
  end if;
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  -- one reset at a time
  perform 1 from public.profiles p where p.id = v_player for update;
  select coalesce((select r.used from public.mission_resets r where r.player_id = v_player and r.reset_day = v_today), 0)
    into v_used;
  if v_used >= v_limit then
    perform public.api_error('mission_reset_used');
  end if;
  -- open quick, daily and weekly missions go; finished ones wait for their claim, milestones stay
  update public.player_missions m
     set status = 'expired', reset_at = v_now, expires_at = least(coalesce(m.expires_at, v_now), v_now)
   where m.player_id = v_player and m.status = 'active'
     and (m.expires_at is null or m.expires_at > v_now)
     and (m.kind = 'quick'
          or (m.kind = 'daily' and m.period_start = v_today)
          or (m.kind = 'weekly' and m.period_start = v_monday));
  get diagnostics v_n = row_count;
  if v_n = 0 then
    perform public.api_error('mission_reset_nothing');
  end if;
  insert into public.mission_resets (player_id, reset_day, used, last_at) values (v_player, v_today, 1, v_now)
  on conflict (player_id, reset_day) do update set used = public.mission_resets.used + 1, last_at = excluded.last_at;
  return public.request_complete(v_player, p_request_id,
    public.missions_state(v_player) || jsonb_build_object('replaced', v_n));
end;
$$;
revoke all on function public.reset_missions(uuid) from public, anon;
grant execute on function public.reset_missions(uuid) to authenticated, service_role;
comment on function public.reset_missions(uuid) is
  'Swaps the open quick, daily and weekly missions for new ones, progression.missionResetsPerDay times per Berlin day (ADR-166).';
