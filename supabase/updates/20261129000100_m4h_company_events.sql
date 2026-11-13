-- ===== idempotent copy of migrations/20261129000100_m4h_company_events.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M4h · 0100 · Company events, response steps and company news (ADR-091)
-- =============================================================================
-- Mirrors src/lib/sim/company-events.ts (rollCompanyEvent, rollSeverity, pickArchetype, costUnitCents,
-- stepCostCents, stepSuccessBps, canStartStep, stepSucceeds, announcementShockBps, resolutionShockBps,
-- eventPhase, eventModifiers) and the event input of closeStartupHour (src/lib/sim/startup.ts).
-- Catalog and numbers: game_config 'companyEvents' (src/config/company-events.ts). Every event stores a snapshot
-- of its archetype (player_company_events.definition), so a balancing change never breaks a running event.
--
-- Tables (RLS on, no client grants; read through the RPCs):
--   player_company_events  one crisis or chance of a player company (company_events is the older, unused timeline)
--   company_event_steps    the paid, timed and possibly failing steps of the chosen strategy
--   company_event_rolls    one roll per company and Berlin day
--   company_news           what happened in a company (events, founding, growth, IPO, hires, record hours)
--   company_ai_profiles    product words written by Claude (Edge Function, service role)
-- New columns: player_company_hours.event_id, player_companies.best_hour_profit_cents.
--
-- Jobs: company_events_run_due() (one line in run_due_jobs): due steps, deadlines, end of the effect,
-- the daily roll (at a company-specific time between rollWindowHours, default 7 to 21 o'clock Berlin), news pruning.
-- Hourly close: player_company_close_hour applies the event modifiers (demand, capacity, extra costs) and
-- writes the record_hour news. Other company news come from triggers (founded, upgraded, expanded, ipo, hired).
-- RPCs: choose_event_strategy, start_event_step, get_company_event, get_company_news, company_ai_context;
-- service role only: store_company_ai_profile, store_company_event_text, store_company_news_text.
-- New error keys: event_closed (NX081), event_needs_staff (NX082). New notification type: company_event.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
create table if not exists public.player_company_events (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  archetype            text not null check (archetype ~ '^[a-z0-9_]+$'),
  polarity             text not null check (polarity in ('crisis', 'chance')),
  severity             smallint not null check (severity between 1 and 3),
  status               text not null default 'open'
                       check (status in ('open', 'accepted', 'solved', 'in_force', 'expired', 'over')),
  definition           jsonb not null check (jsonb_typeof(definition) = 'object'),
  started_at           timestamptz not null,
  deadline_at          timestamptz not null,
  resolved_at          timestamptz,
  over_at              timestamptz,
  strategy             text,
  mitigation           double precision not null default 0 check (mitigation between 0 and 1),
  bonus_applied        boolean not null default false,
  announce_shock_bps   integer,
  resolution_shock_bps integer,
  ai_headline          text check (ai_headline is null or char_length(ai_headline) between 1 and 120),
  ai_body              text check (ai_body is null or char_length(ai_body) between 1 and 600),
  ai_cause             text check (ai_cause is null or char_length(ai_cause) between 1 and 60),
  created_at           timestamptz not null default now()
);
alter table public.player_company_events enable row level security;
create index if not exists player_company_events_company_idx on public.player_company_events (company_id, started_at desc);
-- at most one event per company that is not over yet
create unique index if not exists player_company_events_active_uq on public.player_company_events (company_id)
  where status not in ('over', 'expired');
create index if not exists player_company_events_status_idx on public.player_company_events (status, deadline_at)
  where status not in ('over', 'expired');
comment on table public.player_company_events is
  'Crises and chances of player companies (ADR-091). definition = snapshot of the archetype from game_config companyEvents; '
  'mitigation = share of the damage removed (crisis) or of the chance won; *_shock_bps = share price moves of a listed company. '
  'Internal (RPCs).';

create table if not exists public.company_event_steps (
  id           bigint generated always as identity primary key,
  event_id     uuid not null references public.player_company_events (id) on delete cascade,
  idx          integer not null check (idx >= 0),
  strategy     text not null,
  key          text not null,
  status       text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at   timestamptz not null,
  ends_at      timestamptz not null,
  resolved_at  timestamptz,
  cost_cents   bigint not null default 0 check (cost_cents >= 0),
  success_bps  integer not null check (success_bps between 0 and 10000),
  retry        boolean not null default false,
  capacity_hit double precision not null default 0 check (capacity_hit between 0 and 1),
  discarded    boolean not null default false,
  request_id   uuid,
  created_at   timestamptz not null default now()
);
alter table public.company_event_steps enable row level security;
create index if not exists company_event_steps_event_idx on public.company_event_steps (event_id, id);
create unique index if not exists company_event_steps_running_uq on public.company_event_steps (event_id) where status = 'running';
create index if not exists company_event_steps_due_idx on public.company_event_steps (ends_at) where status = 'running';
comment on table public.company_event_steps is
  'Steps of an event response (ADR-091): paid from the free company cash at the start, resolved at ends_at against '
  'success_bps. discarded = progress of a strategy the founder switched away from (money spent stays spent). Internal (RPCs).';

create table if not exists public.company_event_rolls (
  company_id uuid not null references public.companies (id) on delete cascade,
  berlin_day date not null,
  rolled_at  timestamptz not null default now(),
  event_id   uuid,
  primary key (company_id, berlin_day)
);
alter table public.company_event_rolls enable row level security;
comment on table public.company_event_rolls is
  'One event roll per player company and Berlin day (ADR-091); event_id = the event it started, if any. Internal.';

create table if not exists public.company_news (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  kind        text not null check (kind ~ '^[a-z0-9_]+$'),
  payload     jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  ai_headline text check (ai_headline is null or char_length(ai_headline) between 1 and 120),
  ai_body     text check (ai_body is null or char_length(ai_body) between 1 and 600),
  created_at  timestamptz not null default now()
);
alter table public.company_news enable row level security;
create index if not exists company_news_company_idx on public.company_news (company_id, created_at desc, id desc);
create index if not exists company_news_created_idx on public.company_news (created_at);
comment on table public.company_news is
  'Company news feed (ADR-091): kind + payload = variables for the i18n template; ai_headline/ai_body written once by '
  'the Edge Function. Kept companyEvents.newsKeepDays (30) days. Internal (RPCs).';

create table if not exists public.company_ai_profiles (
  company_id uuid primary key references public.companies (id) on delete cascade,
  words      jsonb not null check (jsonb_typeof(words) = 'object'),
  created_at timestamptz not null default now()
);
alter table public.company_ai_profiles enable row level security;
comment on table public.company_ai_profiles is
  'Product words for the story composer, written once by Claude (store_company_ai_profile): slots product, input, tax, '
  'rule, risk, trend, buyer, critic, place, each 1..5 strings. Internal (RPCs).';

revoke all on public.player_company_events, public.company_event_steps, public.company_event_rolls, public.company_news,
              public.company_ai_profiles from anon, authenticated;

alter table public.player_company_hours add column if not exists event_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'player_company_hours_event_id_fkey'
                    and conrelid = 'public.player_company_hours'::regclass) then
    alter table public.player_company_hours add constraint player_company_hours_event_id_fkey
      foreign key (event_id) references public.player_company_events (id) on delete set null;
  end if;
end;
$$;
create index if not exists player_company_hours_event_idx on public.player_company_hours (event_id) where event_id is not null;
comment on column public.player_company_hours.event_id is 'Company event that changed this hour (ADR-091), if any.';

alter table public.player_companies add column if not exists best_hour_profit_cents bigint not null default 0;
comment on column public.player_companies.best_hour_profit_cents is
  'Best hourly profit so far (record_hour news, ADR-091). Internal.';
update public.player_companies pc
   set best_hour_profit_cents = h.best
  from (select x.company_id, max(x.profit_cents) as best from public.player_company_hours x group by x.company_id) h
 where h.company_id = pc.company_id and h.best > pc.best_hour_profit_cents;

-- ---------------------------------------------------------------------------
-- B. Error keys (M4h: NX081, NX082)
-- ---------------------------------------------------------------------------
create or replace function public.api_error(p_key text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
begin
  v_code := case p_key
    when 'insufficient_funds'          then 'NX001'
    when 'rate_limited'                then 'NX004'
    when 'forbidden'                   then 'NX006'
    when 'invalid_quantity'            then 'NX007'
    when 'invalid_price'               then 'NX007'
    when 'invalid_argument'            then 'NX007'
    when 'invalid_interval'            then 'NX007'
    when 'not_authenticated'           then 'NX010'
    when 'unknown_security'            then 'NX011'
    when 'not_tradable'                then 'NX012'
    when 'insufficient_position'       then 'NX013'
    when 'order_not_found'             then 'NX014'
    when 'order_not_open'              then 'NX015'
    when 'market_paused'               then 'NX016'
    when 'nothing_to_claim'            then 'NX017'
    when 'locked'                      then 'NX018'
    when 'name_too_short'              then 'NX019'
    when 'name_too_long'               then 'NX019'
    when 'name_invalid_chars'          then 'NX019'
    when 'name_profanity'              then 'NX019'
    when 'name_reserved'               then 'NX019'
    when 'name_taken'                  then 'NX019'
    when 'name_change_too_soon'        then 'NX020'
    when 'order_too_small'             then 'NX021'
    when 'market_illiquid'             then 'NX022'
    when 'mission_not_found'           then 'NX023'
    when 'mission_not_completed'       then 'NX024'
    when 'mission_already_claimed'     then 'NX025'
    when 'avatar_unknown'              then 'NX026'
    when 'avatar_locked'               then 'NX027'
    when 'daily_reward_claimed'        then 'NX028'
    when 'skill_unknown'               then 'NX029'
    when 'skill_learned'               then 'NX030'
    when 'skill_locked'                then 'NX031'
    when 'skill_points_insufficient'   then 'NX032'
    when 'job_not_found'               then 'NX033'
    when 'job_level_too_low'           then 'NX034'
    when 'job_skills_missing'          then 'NX035'
    when 'application_limit'           then 'NX036'
    when 'application_exists'          then 'NX037'
    when 'application_not_found'       then 'NX038'
    when 'application_not_offered'     then 'NX039'
    when 'offer_expired'               then 'NX040'
    when 'job_active_exists'           then 'NX041'
    when 'no_active_job'               then 'NX042'
    when 'raise_too_soon'              then 'NX043'
    when 'raise_too_high'              then 'NX044'
    when 'player_not_found'            then 'NX045'
    when 'employer_only'               then 'NX046'
    when 'company_exists'              then 'NX047'
    when 'company_not_found'           then 'NX048'
    when 'company_level_too_low'       then 'NX049'
    when 'owns_company'                then 'NX050'
    when 'employee_limit'              then 'NX051'
    when 'company_upgrade_unavailable' then 'NX052'
    when 'founding_locked'             then 'NX053'
    when 'not_in_company'              then 'NX054'
    when 'work_task_not_found'         then 'NX055'
    when 'work_task_expired'           then 'NX056'
    when 'work_task_done'              then 'NX057'
    when 'offer_closed'                then 'NX058'
    when 'offer_sold_out'              then 'NX059'
    when 'already_listed'              then 'NX060'
    when 'confirm_mismatch'            then 'NX061'
    when 'skill_already_covered'       then 'NX062'
    when 'training_locked'             then 'NX063'
    when 'logo_locked'                 then 'NX064'
    when 'logo_forbidden'              then 'NX065'
    when 'artworks_locked'             then 'NX066'
    when 'artwork_not_found'           then 'NX067'
    when 'auction_not_found'           then 'NX068'
    when 'auction_ended'               then 'NX069'
    when 'bid_too_low'                 then 'NX070'
    when 'own_artwork'                 then 'NX071'
    when 'already_on_auction'          then 'NX072'
    when 'auction_has_bids'            then 'NX073'
    when 'property_locked'             then 'NX074'
    when 'no_home'                     then 'NX075'
    when 'invalid_tier'                then 'NX076'
    when 'item_not_found'              then 'NX077'
    when 'layout_invalid'              then 'NX078'
    when 'floor_not_owned'             then 'NX079'
    when 'garage_full'                 then 'NX080'
    when 'event_closed'                then 'NX081'
    when 'event_needs_staff'           then 'NX082'
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;
comment on function public.api_error(text) is 'Raises the API error <key> with its NX SQLSTATE. The client shows a text per key (error.message).';

-- ---------------------------------------------------------------------------
-- C. Notification type
-- ---------------------------------------------------------------------------
insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('company_event', 'company', 'Krise oder Chance', 'Deine Firma steht vor einer Krise oder bekommt eine Chance.',
        'notif_company', true, true, false, 205)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- D. Rules (port of src/lib/sim/company-events.ts)
-- ---------------------------------------------------------------------------
create or replace function public.company_events_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('companyEvents'), '{}'::jsonb);
$$;
comment on function public.company_events_cfg() is 'Internal: game_config companyEvents (ADR-091), {} when missing.';

-- archetypeOf
create or replace function public.company_event_archetype(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select x from jsonb_array_elements(coalesce(public.company_events_cfg() -> 'archetypes', '[]'::jsonb)) x
   where x ->> 'key' = p_key limit 1;
$$;

-- pickArchetype: weighted pick of an archetype of the polarity that fits the sector (catalog order)
create or replace function public.company_event_pick(p_u double precision, p_sector text, p_polarity text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total double precision;
  v_x     double precision;
  r       record;
  v_last  jsonb;
begin
  select coalesce(sum(greatest(0, public.cfg_num(t.x, '{weight}', 0))), 0) into v_total
    from jsonb_array_elements(coalesce(public.company_events_cfg() -> 'archetypes', '[]'::jsonb)) t(x)
   where t.x ->> 'polarity' = p_polarity
     and (jsonb_typeof(t.x -> 'sectors') is distinct from 'array' or t.x -> 'sectors' ? p_sector);
  v_x := least(greatest(coalesce(p_u, 0), 0), 0.999999) * v_total;
  for r in
    select t.x
      from jsonb_array_elements(coalesce(public.company_events_cfg() -> 'archetypes', '[]'::jsonb)) with ordinality t(x, ord)
     where t.x ->> 'polarity' = p_polarity
       and (jsonb_typeof(t.x -> 'sectors') is distinct from 'array' or t.x -> 'sectors' ? p_sector)
     order by t.ord
  loop
    v_x := v_x - greatest(0, public.cfg_num(r.x, '{weight}', 0));
    if v_x < 0 then
      return r.x;
    end if;
    v_last := r.x;
  end loop;
  return v_last;
end;
$$;

-- rollSeverity
create or replace function public.company_event_severity(p_u double precision)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_u < public.cfg_num(c, '{severityWeights,0}', 0.5) then 1
              when p_u < public.cfg_num(c, '{severityWeights,0}', 0.5) + public.cfg_num(c, '{severityWeights,1}', 0.35) then 2
              else 3 end
    from (select public.company_events_cfg() as c) x;
$$;

-- costUnitCents: max(minUnitCents, round(quarterly fixed costs × unitShareOfFixed))
create or replace function public.company_event_unit_cents(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(public.cfg_num(c, '{costUnit,minUnitCents}', 20000)::bigint,
                  round(public.company_fixed_cost_cents(pc.tier, pc.expansion_level)::numeric
                        * public.cfg_num(c, '{costUnit,unitShareOfFixed}', 0.5)::numeric)::bigint)
    from public.player_companies pc, (select public.company_events_cfg() as c) x
   where pc.company_id = p_company;
$$;

-- stepCostCents: cost × unit × (1 + 0.25 × (severity − 1)), a retry costs retryCostShare of it
create or replace function public.company_event_step_cost(p_step jsonb, p_unit bigint, p_severity integer, p_retry boolean default false)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select round(public.cfg_num(p_step, '{cost}', 0)::numeric * coalesce(p_unit, 0)
               * (1 + 0.25 * (p_severity - 1))
               * case when p_retry then public.cfg_num(public.company_events_cfg(), '{retryCostShare}', 0.5)::numeric else 1 end)::bigint;
$$;

-- stepSuccessBps: base + know-how of the team (capped) − severity penalty, between 500 and 10 000
create or replace function public.company_event_step_bps(p_step jsonb, p_severity integer, p_score double precision)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(10000, greatest(500, round((
           public.cfg_num(p_step, '{baseBps}', 0)
           + case when coalesce(p_step ->> 'branch', '') <> ''
                  then least(public.cfg_num(c, '{knowHow,maxBonusBps}', 2500),
                             greatest(0, coalesce(p_score, 0)) * public.cfg_num(c, '{knowHow,bpsPerPoint}', 150))
                  else 0 end
           - public.cfg_num(c, '{severityPenaltyBps}', 700) * (p_severity - 1))::numeric)::integer))
    from (select public.company_events_cfg() as c) x;
$$;

-- Team know-how: founder + current player employees, summed per branch (player_branch_scores as for jobs)
create or replace function public.company_event_team_scores(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_object_agg(b.key, coalesce(s.score, 0))
    from (values ('it'), ('finance'), ('law'), ('craft'), ('sales'), ('management'), ('science'), ('logistics')) b(key)
    left join (
      select x.key, sum(case when jsonb_typeof(x.value) = 'number' then (x.value #>> '{}')::numeric else 0 end)::integer as score
        from (select pc.founder_id as player_id from public.player_companies pc where pc.company_id = p_company
              union
              select j.player_id from public.player_jobs j where j.company_id = p_company and j.status = 'active') m
        cross join lateral jsonb_each(public.player_branch_scores(m.player_id)) x
       group by x.key) s on s.key = b.key;
$$;

-- People for canStartStep: founder + player employees + AI workers
create or replace function public.company_event_headcount(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select 1 + public.company_headcount(p_company);
$$;

-- When the effect ends: chance after a success resolved + lasts (else the deadline), crisis
-- min(deadline, resolved) + lasts
create or replace function public.company_event_ends_at(p_polarity text, p_lasts_hours double precision, p_deadline timestamptz,
                                                        p_resolved timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when p_polarity = 'chance' and p_resolved is null then p_deadline
    when p_polarity = 'chance' then p_resolved + make_interval(secs => greatest(0, coalesce(p_lasts_hours, 0)) * 3600)
    else least(p_deadline, coalesce(p_resolved, p_deadline)) + make_interval(secs => greatest(0, coalesce(p_lasts_hours, 0)) * 3600)
  end;
$$;

-- eventPhase
create or replace function public.company_event_phase(p_polarity text, p_lasts_hours double precision, p_deadline timestamptz,
                                                      p_resolved timestamptz, p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_polarity = 'chance' and p_resolved is null then case when p_at < p_deadline then 'open' else 'over' end
    when p_polarity = 'crisis' and p_resolved is null and p_at < p_deadline then 'open'
    when p_at < public.company_event_ends_at(p_polarity, p_lasts_hours, p_deadline, p_resolved) then 'in_force'
    else 'over'
  end;
$$;

-- eventModifiers: {demand_factor, capacity_factor, extra_cost_share}
create or replace function public.company_event_modifiers(p_def jsonb, p_severity integer, p_phase text, p_mitigation double precision,
                                                          p_capacity_hit double precision default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := public.company_events_cfg();
  v_scale double precision;
  v_share double precision := 0;
  v_s     double precision;
  v_m     double precision := least(1, greatest(0, coalesce(p_mitigation, 0)));
begin
  v_scale := public.cfg_num(v_cfg, array['severityScale', (p_severity - 1)::text],
                            case p_severity when 1 then 1 when 2 then 1.7 else 2.5 end);
  if p_def ->> 'polarity' = 'crisis' then
    if p_phase = 'open' then
      v_share := public.cfg_num(v_cfg, '{preDeadlineShare}', 0.25) * (1 - v_m);
    elsif p_phase = 'in_force' then
      v_share := 1 - v_m;
    end if;
  elsif p_phase = 'in_force' then
    v_share := v_m;
  end if;
  v_s := v_share * v_scale;
  return jsonb_build_object(
    'demand_factor', greatest(0.05, 1 + public.cfg_num(p_def, '{effect,demand}', 0) * v_s),
    'capacity_factor', greatest(0.05, (1 + public.cfg_num(p_def, '{effect,capacity}', 0) * v_s)
                                      * (1 - least(0.9, greatest(0, coalesce(p_capacity_hit, 0))))),
    'extra_cost_share', public.cfg_num(p_def, '{effect,cost}', 0) * v_s);
end;
$$;

-- The effect on one operating hour [p_from, p_to): the latest event started before the end of the hour, its phase
-- at the start of the hour, and the capacity tied up by steps in proportion to the part of the hour they ran.
create or replace function public.company_event_hour_effect(p_company uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e       public.player_company_events;
  v_hit   double precision;
  v_phase text;
begin
  select * into e from public.player_company_events ev
   where ev.company_id = p_company and ev.started_at < p_to
   order by ev.started_at desc limit 1;
  if e.id is null then
    return jsonb_build_object('event_id', null, 'demand_factor', 1, 'capacity_factor', 1, 'extra_cost_share', 0);
  end if;
  v_phase := public.company_event_phase(e.polarity, public.cfg_num(e.definition, '{lastsHours}', 0), e.deadline_at,
                                        e.resolved_at, p_from);
  select coalesce(sum(s.capacity_hit * extract(epoch from (least(s.ends_at, p_to) - greatest(s.started_at, p_from)))
                      / greatest(1, extract(epoch from (p_to - p_from)))), 0)
    into v_hit
    from public.company_event_steps s
   where s.event_id = e.id and s.capacity_hit > 0 and s.started_at < p_to and s.ends_at > p_from;
  if v_phase = 'over' and v_hit <= 0 then
    return jsonb_build_object('event_id', null, 'demand_factor', 1, 'capacity_factor', 1, 'extra_cost_share', 0);
  end if;
  return public.company_event_modifiers(e.definition, e.severity, v_phase, e.mitigation, v_hit)
         || jsonb_build_object('event_id', e.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- E. News and notifications
-- ---------------------------------------------------------------------------
create or replace function public.company_news_add(p_company uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_company is null or not exists (select 1 from public.companies c where c.id = p_company) then
    return null;
  end if;
  insert into public.company_news (company_id, kind, payload)
  values (p_company, p_kind, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.company_news_add(uuid, text, jsonb) is 'Internal: appends a company news item (ADR-091).';

-- In-app notification to the founder, unless switched off (missing preference: the type's default)
create or replace function public.company_event_notify(p_event uuid, p_title text, p_body text, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e         public.player_company_events;
  v_founder uuid;
begin
  select * into e from public.player_company_events where id = p_event;
  select pc.founder_id into v_founder from public.player_companies pc where pc.company_id = e.company_id;
  if v_founder is null or not exists (select 1 from public.notification_types t where t.key = 'company_event') then
    return;
  end if;
  if not coalesce((select np.in_app_enabled from public.notification_preferences np
                    where np.player_id = v_founder and np.type_key = 'company_event'),
                  (select t.default_in_app from public.notification_types t where t.key = 'company_event'), true) then
    return;
  end if;
  insert into public.notifications (player_id, type_key, title, body, payload, link, dedupe_key)
  values (v_founder, 'company_event', p_title, p_body,
          jsonb_build_object('company_id', e.company_id, 'event_id', e.id, 'archetype', e.archetype, 'polarity', e.polarity,
                             'severity', e.severity),
          '/company', p_dedupe)
  on conflict (player_id, dedupe_key) do nothing;
end;
$$;

-- founded, upgraded {tier}, expanded {level}
create or replace function public.company_news_player_company_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.company_news_add(new.company_id, 'founded', jsonb_build_object('tier', new.tier));
    return null;
  end if;
  -- the AG comes with the IPO, which has its own news
  if new.tier is distinct from old.tier and new.tier <> 'ag' then
    perform public.company_news_add(new.company_id, 'upgraded', jsonb_build_object('tier', new.tier));
  end if;
  if new.expansion_level > old.expansion_level then
    perform public.company_news_add(new.company_id, 'expanded', jsonb_build_object('level', new.expansion_level));
  end if;
  return null;
end;
$$;
drop trigger if exists company_news_player_company on public.player_companies;
create trigger company_news_player_company
  after insert or update of tier, expansion_level on public.player_companies
  for each row execute function public.company_news_player_company_trg();

-- ipo {ticker}
create or replace function public.company_news_listing_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.player_companies pc where pc.company_id = new.id) then
    perform public.company_news_add(new.id, 'ipo', jsonb_build_object('ticker', new.ticker));
  end if;
  return null;
end;
$$;
drop trigger if exists company_news_listing on public.companies;
create trigger company_news_listing
  after update of phase on public.companies
  for each row when (new.phase = 'listed' and old.phase is distinct from new.phase and not new.is_ai)
  execute function public.company_news_listing_trg();

-- hired {nickname, title}: a player signed with a player company
create or replace function public.company_news_hired_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.player_companies pc where pc.company_id = new.company_id) then
    perform public.company_news_add(new.company_id, 'hired',
      jsonb_build_object('nickname', (select p.nickname from public.profiles p where p.id = new.player_id), 'title', new.title));
  end if;
  return null;
end;
$$;
drop trigger if exists company_news_hired on public.player_jobs;
create trigger company_news_hired
  after insert on public.player_jobs
  for each row when (new.status = 'active')
  execute function public.company_news_hired_trg();

-- ---------------------------------------------------------------------------
-- F. Events: share shock, start, roll, steps, solution
-- ---------------------------------------------------------------------------
-- Listed company: moves price, quote, market cap, the value fund's fair value and both EMAs by the same factor (a level
-- shift, no artificial trend). Returns the applied bps, null when the company is not listed.
create or replace function public.company_event_share_shock(p_company uuid, p_bps integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c     public.companies;
  q     public.security_quotes;
  v_f   numeric;
  v_new bigint;
  v_bid bigint;
  v_ref bigint;
begin
  select * into c from public.companies where id = p_company;
  if c.id is null or c.phase <> 'listed' or c.security_id is null then
    return null;
  end if;
  select * into q from public.security_quotes where security_id = c.security_id for update;
  if q.security_id is null then
    return null;
  end if;
  if coalesce(p_bps, 0) = 0 then
    return 0;
  end if;
  v_f := 1 + p_bps / 10000.0;
  v_new := greatest(1, round(q.last_price_e4 * v_f))::bigint;
  v_bid := case when q.bid_e4 is null then null else greatest(1, round(q.bid_e4 * v_f))::bigint end;
  v_ref := coalesce(q.prev_close_e4, q.last_price_e4);
  update public.security_quotes
     set last_price_e4 = v_new,
         bid_e4 = v_bid,
         ask_e4 = case when q.ask_e4 is null then null else greatest(coalesce(v_bid, 0) + 1, round(q.ask_e4 * v_f))::bigint end,
         day_high_e4 = greatest(coalesce(q.day_high_e4, v_new), v_new),
         day_low_e4 = least(coalesce(q.day_low_e4, v_new), v_new),
         change_bps = greatest(-1000000, least(1000000, round((v_new - v_ref) * 10000.0 / greatest(1, v_ref))))::integer,
         market_cap_cents = public.div_round_half_even(c.shares_outstanding::numeric * v_new, 100),
         updated_at = now()
   where security_id = c.security_id;
  update public.security_sim_state
     set fair_value_e4 = greatest(1, round(fair_value_e4 * v_f))::bigint,
         ema_fast = ema_fast * v_f::double precision,
         ema_slow = ema_slow * v_f::double precision
   where security_id = c.security_id;
  return p_bps;
end;
$$;
comment on function public.company_event_share_shock(uuid, integer) is
  'Internal: share price shock of a listed player company (ADR-091); price, quote, market cap, fair value and EMAs move together.';

-- A new event (no gating; company_event_roll gates): deadline, news, notification, announcement shock when listed
create or replace function public.company_event_start(p_company uuid, p_archetype text, p_severity integer,
                                                      p_now timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz := coalesce(p_now, public.game_now());
  v_def      jsonb := public.company_event_archetype(p_archetype);
  v_size     double precision;
  v_bps      integer;
  v_shock    integer;
  v_deadline timestamptz;
  v_id       uuid;
  v_name     text;
begin
  if v_def is null or coalesce(p_severity, 0) not between 1 and 3 or v_def ->> 'polarity' not in ('crisis', 'chance') then
    return null;
  end if;
  perform 1 from public.player_companies pc where pc.company_id = p_company and pc.status = 'active' for update;
  if not found or exists (select 1 from public.player_company_events ev
                           where ev.company_id = p_company and ev.status not in ('over', 'expired')) then
    return null;
  end if;
  v_deadline := v_now + make_interval(secs => greatest(0, public.cfg_num(v_def, '{deadlineHours}', 24)) * 3600);
  insert into public.player_company_events (company_id, archetype, polarity, severity, definition, started_at, deadline_at)
  values (p_company, p_archetype, v_def ->> 'polarity', p_severity, v_def, v_now, v_deadline)
  returning id into v_id;
  -- announcementShockBps: crisis −size, chance +size/2
  v_size := public.cfg_num(public.company_events_cfg(), array['shareShockBps', (p_severity - 1)::text],
                           case p_severity when 1 then 400 when 2 then 900 else 1500 end);
  v_bps := case when v_def ->> 'polarity' = 'crisis' then -round(v_size::numeric) else round((v_size / 2)::numeric) end::integer;
  v_shock := public.company_event_share_shock(p_company, v_bps);
  update public.player_company_events set announce_shock_bps = v_shock where id = v_id;
  perform public.company_news_add(p_company, 'event_started',
    jsonb_build_object('event_id', v_id, 'archetype', p_archetype, 'polarity', v_def ->> 'polarity', 'severity', p_severity,
                       'deadline_at', v_deadline, 'share_shock_bps', v_shock));
  select c.name into v_name from public.companies c where c.id = p_company;
  perform public.company_event_notify(v_id,
    case when v_def ->> 'polarity' = 'crisis' then 'Krise bei ' || v_name else 'Chance für ' || v_name end,
    'Reagiere bis ' || to_char(v_deadline at time zone 'Europe/Berlin', 'DD.MM., HH24:MI') || ' Uhr.',
    'company_event:' || v_id::text || ':start');
  return v_id;
end;
$$;

-- When the daily roll of a company happens: a fixed time per company and Berlin day between rollWindowHours
create or replace function public.company_event_roll_at(p_company uuid, p_day date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  -- Berlin wall-clock time (also on the days the clocks change), then converted to an instant.
  select (p_day::timestamp
          + make_interval(secs => (public.cfg_num(c, '{rollWindowHours,0}', 7)
                                   + public.uniform_from_text(p_company::text || ':' || p_day::text)
                                     * greatest(0, public.cfg_num(c, '{rollWindowHours,1}', 21) - public.cfg_num(c, '{rollWindowHours,0}', 7)))
                                  * 3600)) at time zone 'Europe/Berlin'
    from (select public.company_events_cfg() as c) x;
$$;

-- rollCompanyEvent: one roll per company and Berlin day; p_u = [happens?, chance or crisis?, which?, how bad?]
-- (server randomness when null). Returns the new event or null.
create or replace function public.company_event_roll(p_company uuid, p_now timestamptz default null, p_u double precision[] default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now    timestamptz := coalesce(p_now, public.game_now());
  v_cfg    jsonb := public.company_events_cfg();
  v_day    date := (coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date;
  v_u      double precision[] := coalesce(p_u, array[random(), random(), random(), random()]);
  c        public.companies;
  v_last   timestamptz;
  v_arch   jsonb;
  v_id     uuid;
begin
  if jsonb_typeof(v_cfg -> 'archetypes') is distinct from 'array'
     or not exists (select 1 from public.player_companies pc where pc.company_id = p_company and pc.status = 'active') then
    return null;
  end if;
  insert into public.company_event_rolls (company_id, berlin_day, rolled_at) values (p_company, v_day, v_now)
  on conflict (company_id, berlin_day) do nothing;
  if not found then
    return null;
  end if;
  select * into c from public.companies where id = p_company;
  select max(ev.started_at) into v_last from public.player_company_events ev where ev.company_id = p_company;
  if exists (select 1 from public.player_company_events ev where ev.company_id = p_company and ev.status not in ('over', 'expired'))
     or extract(epoch from (v_now - c.founded_at)) / 3600 < public.cfg_num(v_cfg, '{minAgeHours}', 6)
     or (v_last is not null and extract(epoch from (v_now - v_last)) / 3600 < public.cfg_num(v_cfg, '{minGapHours}', 22))
     or v_u[1] >= public.cfg_num(v_cfg, '{chancePerDay}', 0.6) then
    return null;
  end if;
  v_arch := public.company_event_pick(v_u[3], c.sector_key,
                                      case when v_u[2] < public.cfg_num(v_cfg, '{chanceShare}', 0.4) then 'chance' else 'crisis' end);
  if v_arch is null then
    return null;
  end if;
  v_id := public.company_event_start(p_company, v_arch ->> 'key', public.company_event_severity(v_u[4]), v_now);
  update public.company_event_rolls set event_id = v_id where company_id = p_company and berlin_day = v_day;
  return v_id;
end;
$$;

-- The chosen strategy of an event (null when none or unknown)
create or replace function public.company_event_strategy_def(p_event public.player_company_events)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select s from jsonb_array_elements(coalesce(p_event.definition -> 'strategies', '[]'::jsonb)) s
   where s ->> 'key' = p_event.strategy limit 1;
$$;

-- Succeeded steps of the current attempt of the chosen strategy (finished by p_until, if given)
create or replace function public.company_event_done_steps(p_event uuid, p_until timestamptz default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.company_event_steps s join public.player_company_events e on e.id = s.event_id
   where s.event_id = p_event and not s.discarded and s.status = 'succeeded' and s.strategy = e.strategy
     and (p_until is null or s.resolved_at <= p_until);
$$;

-- A running step stops at p_at (failed and discarded, money spent stays spent); p_all also discards the progress of
-- the current attempt (switching the strategy)
create or replace function public.company_event_discard(p_event uuid, p_at timestamptz, p_all boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.company_event_steps
     set status = 'failed', discarded = true, ends_at = least(ends_at, greatest(started_at, p_at)), resolved_at = p_at
   where event_id = p_event and status = 'running';
  if p_all then
    update public.company_event_steps set discarded = true where event_id = p_event and not discarded;
  end if;
end;
$$;

-- Every step of the chosen strategy succeeded: solved, mitigation, bonus once, resolution shock, news, notification
create or replace function public.company_event_solve(p_event uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e       public.player_company_events;
  v_strat jsonb;
  v_mit   double precision;
  v_size  double precision;
  v_bps   integer;
  v_shock integer;
  v_name  text;
begin
  select * into e from public.player_company_events where id = p_event for update;
  if e.id is null or e.status not in ('open', 'in_force') then
    return;
  end if;
  v_strat := public.company_event_strategy_def(e);
  v_mit := least(1, greatest(0, public.cfg_num(v_strat, '{mitigation}', 0)));
  update public.player_company_events set status = 'solved', resolved_at = p_at, mitigation = v_mit where id = e.id;
  if not e.bonus_applied then
    update public.player_companies
       set awareness = least(1, greatest(0, awareness + public.cfg_num(v_strat, '{bonus,awareness}', 0))),
           quality = least(1, greatest(0, quality + public.cfg_num(v_strat, '{bonus,quality}', 0)))
     where company_id = e.company_id;
    update public.player_company_events set bonus_applied = true where id = e.id;
  end if;
  -- resolutionShockBps: crisis size × mitigation, chance size / 2 × mitigation
  v_size := public.cfg_num(public.company_events_cfg(), array['shareShockBps', (e.severity - 1)::text],
                           case e.severity when 1 then 400 when 2 then 900 else 1500 end);
  v_bps := round((case when e.polarity = 'crisis' then v_size * v_mit else v_size / 2 * v_mit end)::numeric)::integer;
  v_shock := public.company_event_share_shock(e.company_id, v_bps);
  update public.player_company_events set resolution_shock_bps = v_shock where id = e.id;
  perform public.company_news_add(e.company_id, 'event_solved',
    jsonb_build_object('event_id', e.id, 'archetype', e.archetype, 'polarity', e.polarity, 'severity', e.severity,
                       'strategy', e.strategy, 'mitigation', round(v_mit::numeric, 4)::double precision, 'share_shock_bps', v_shock));
  select c.name into v_name from public.companies c where c.id = e.company_id;
  perform public.company_event_notify(e.id,
    case when e.polarity = 'crisis' then 'Krise gemeistert: ' || v_name else 'Chance genutzt: ' || v_name end,
    null, 'company_event:' || e.id::text || ':solved');
end;
$$;

-- stepSucceeds: u × 10 000 < success_bps (server randomness when p_u is null). Returns the outcome.
create or replace function public.company_event_resolve_step(p_step bigint, p_u double precision default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  st      public.company_event_steps;
  e       public.player_company_events;
  v_ok    boolean;
  v_n     integer;
  v_name  text;
  v_def   jsonb;
begin
  select * into st from public.company_event_steps where id = p_step and status = 'running' and not discarded for update;
  if st.id is null then
    return null;
  end if;
  select * into e from public.player_company_events where id = st.event_id for update;
  v_ok := coalesce(p_u, random()) * 10000 < st.success_bps;
  update public.company_event_steps
     set status = case when v_ok then 'succeeded' else 'failed' end, resolved_at = st.ends_at
   where id = st.id;
  select c.name into v_name from public.companies c where c.id = e.company_id;
  v_def := public.company_event_strategy_def(e);
  if v_ok then
    perform public.company_news_add(e.company_id, 'event_step_done',
      jsonb_build_object('event_id', e.id, 'archetype', e.archetype, 'strategy', st.strategy, 'idx', st.idx, 'step', st.key,
                         'success', true));
    v_n := jsonb_array_length(coalesce(v_def -> 'steps', '[]'::jsonb));
    if e.status in ('open', 'in_force') and st.strategy = e.strategy and public.company_event_done_steps(e.id) >= v_n then
      perform public.company_event_solve(e.id, st.ends_at);
    else
      perform public.company_event_notify(e.id, 'Schritt geschafft bei ' || v_name, null,
                                          'company_event:' || e.id::text || ':step:' || st.id::text);
    end if;
  else
    perform public.company_news_add(e.company_id, 'event_step_failed',
      jsonb_build_object('event_id', e.id, 'archetype', e.archetype, 'strategy', st.strategy, 'idx', st.idx, 'step', st.key,
                         'success', false));
    perform public.company_event_notify(e.id, 'Schritt gescheitert bei ' || v_name,
                                        'Versuch es noch einmal oder wähle einen anderen Weg.',
                                        'company_event:' || e.id::text || ':step:' || st.id::text);
  end if;
  return v_ok;
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Periodic work (run_due_jobs): steps, deadlines, end of the effect, daily roll, pruning
-- ---------------------------------------------------------------------------
create or replace function public.company_events_run_due(p_now timestamptz default null, p_roll boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz := coalesce(p_now, public.game_now());
  v_day      date := (coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date;
  v_cfg      jsonb := public.company_events_cfg();
  v_steps    integer := 0;
  v_deadline integer := 0;
  v_over     integer := 0;
  v_started  integer := 0;
  v_strat    jsonb;
  v_n        integer;
  v_mit      double precision;
  v_end      timestamptz;
  ce         public.player_company_events;
  e          record;
  s          record;
  r          record;
begin
  -- 1. events of companies that are no longer active end silently
  for e in
    select ev.id from public.player_company_events ev
      left join public.player_companies pc on pc.company_id = ev.company_id
     where ev.status not in ('over', 'expired') and coalesce(pc.status, '') <> 'active'
  loop
    perform public.company_event_discard(e.id, v_now, false);
    update public.player_company_events set status = 'over', over_at = v_now where id = e.id;
  end loop;

  -- 2. steps that ended: success or failure (a success of the last step solves the event)
  for s in
    select st.id from public.company_event_steps st
     where st.status = 'running' and not st.discarded and st.ends_at <= v_now
     order by st.ends_at, st.id
  loop
    if public.company_event_resolve_step(s.id) is not null then
      v_steps := v_steps + 1;
    end if;
  end loop;

  -- 3. deadlines: a crisis comes into force (partial credit for the steps finished by the deadline), a chance is missed
  for ce in
    select ev.* from public.player_company_events ev where ev.status = 'open' and ev.deadline_at <= v_now
     order by ev.deadline_at for update
  loop
    if ce.polarity = 'crisis' then
      v_strat := public.company_event_strategy_def(ce);
      v_n := jsonb_array_length(coalesce(v_strat -> 'steps', '[]'::jsonb));
      v_mit := case when v_strat is null or v_n = 0 then 0
                    else least(1, greatest(0, public.cfg_num(v_strat, '{mitigation}', 0) * public.company_event_done_steps(ce.id, ce.deadline_at) / v_n
                                              * public.cfg_num(v_cfg, '{partialCredit}', 0.5))) end;
      update public.player_company_events set status = 'in_force', mitigation = v_mit where id = ce.id;
      perform public.company_news_add(ce.company_id, 'event_deadline',
        jsonb_build_object('event_id', ce.id, 'archetype', ce.archetype, 'polarity', ce.polarity, 'severity', ce.severity,
                           'mitigation', round(v_mit::numeric, 4)::double precision));
    else
      perform public.company_event_discard(ce.id, ce.deadline_at, false);
      update public.player_company_events set status = 'expired', over_at = ce.deadline_at where id = ce.id;
      perform public.company_news_add(ce.company_id, 'event_expired',
        jsonb_build_object('event_id', ce.id, 'archetype', ce.archetype, 'polarity', ce.polarity, 'severity', ce.severity));
    end if;
    v_deadline := v_deadline + 1;
  end loop;

  -- 4. the effect is over (eventPhase): in force, solved or sat out
  for ce in
    select ev.* from public.player_company_events ev where ev.status in ('in_force', 'solved', 'accepted') order by ev.started_at for update
  loop
    v_end := public.company_event_ends_at(ce.polarity, public.cfg_num(ce.definition, '{lastsHours}', 0), ce.deadline_at,
                                          ce.resolved_at);
    continue when public.company_event_phase(ce.polarity, public.cfg_num(ce.definition, '{lastsHours}', 0), ce.deadline_at,
                                             ce.resolved_at, v_now) <> 'over';
    perform public.company_event_discard(ce.id, v_end, false);
    update public.player_company_events set status = 'over', over_at = v_end where id = ce.id;
    perform public.company_news_add(ce.company_id, 'event_over',
      jsonb_build_object('event_id', ce.id, 'archetype', ce.archetype, 'polarity', ce.polarity, 'severity', ce.severity,
                         'status', ce.status));
    v_over := v_over + 1;
  end loop;

  -- 5. the daily roll, at the company's time of the day
  if p_roll and jsonb_typeof(v_cfg -> 'archetypes') = 'array' then
    for r in
      select pc.company_id from public.player_companies pc
       where pc.status = 'active'
         and not exists (select 1 from public.company_event_rolls x where x.company_id = pc.company_id and x.berlin_day = v_day)
         and public.company_event_roll_at(pc.company_id, v_day) <= v_now
       order by pc.company_id
    loop
      if public.company_event_roll(r.company_id, v_now, null) is not null then
        v_started := v_started + 1;
      end if;
    end loop;
  end if;

  -- 6. news and rolls are kept newsKeepDays (30)
  delete from public.company_news
   where created_at < now() - make_interval(days => public.cfg_num(v_cfg, '{newsKeepDays}', 30)::integer);
  delete from public.company_event_rolls
   where berlin_day < v_day - public.cfg_num(v_cfg, '{newsKeepDays}', 30)::integer;
  return jsonb_build_object('steps', v_steps, 'deadlines', v_deadline, 'over', v_over, 'started', v_started);
end;
$$;
comment on function public.company_events_run_due(timestamptz, boolean) is
  'run_due_jobs (ADR-091): resolves ended steps, deadlines (crisis in force with partial credit, chance missed), ends '
  'effects, rolls once per company and Berlin day (p_roll), prunes news. p_now for tests.';

-- ---------------------------------------------------------------------------
-- H. One operating hour as in M4e, with the event modifiers and the record hour
-- ---------------------------------------------------------------------------
create or replace function public.player_company_close_hour(p_company uuid, p_hour_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc        public.player_companies;
  c         public.companies;
  v_su      jsonb := coalesce(public.config_jsonb('startups'), '{}'::jsonb);
  v_hours   double precision := greatest(1, public.config_double('time', '{quarterHours}', 6));
  v_start   timestamptz := date_trunc('hour', p_hour_start);
  v_end     timestamptz;
  v_qid     bigint;
  v_team    jsonb;
  v_price   jsonb;
  v_ev      jsonb;
  v_stage   integer;
  v_demand  double precision;
  v_cap     double precision;
  v_sold    double precision;
  v_ctr     double precision;
  v_own     bigint;
  v_crev    bigint;
  v_hhbal   bigint;
  v_rev     bigint;
  v_cogs    bigint;
  v_gross   bigint;
  v_aidue   bigint;
  v_aipaid  bigint;
  v_pdue    bigint := 0;
  v_ppaid   bigint := 0;
  v_due     bigint;
  v_factor  integer;
  v_fixed   bigint;
  v_mk      bigint;
  v_costs   bigint;
  v_paid    bigint := 0;
  v_unpaid  bigint := 0;
  v_settle  bigint := 0;
  v_cash    bigint;
  v_acc     uuid;
  v_hh      uuid;
  v_profit  bigint;
  v_owed    bigint;
  v_free    bigint;
  v_payout  bigint := 0;
  v_bps     integer;
  v_until   timestamptz;
  v_news    bigint;
  k         text;
  j         record;
begin
  if p_company is null or p_hour_start is null then
    return null;
  end if;
  select * into pc from public.player_companies where company_id = p_company and status = 'active' for update;
  if pc.company_id is null then
    return null;
  end if;
  if exists (select 1 from public.player_company_hours h where h.company_id = p_company and h.hour_start = v_start) then
    update public.player_companies set last_hour_at = greatest(last_hour_at, v_start + interval '1 hour')
     where company_id = p_company and last_hour_at < v_start + interval '1 hour';
    return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'skipped', 'already_closed');
  end if;
  v_end := v_start + interval '1 hour';
  select * into c from public.companies where id = p_company;
  select gq.id into v_qid from public.game_quarters gq where gq.starts_at <= v_start and gq.ends_at > v_start;
  v_team := public.player_company_team(p_company);
  v_acc := public.company_cash_account(p_company);
  v_hh := public.ledger_system_account('households');
  k := 'pch:' || p_company::text || ':' || to_char(v_start at time zone 'UTC', 'YYYYMMDDHH24');
  -- company event of this hour (ADR-091): demand and capacity factors, extra costs as a share of the own revenue
  v_ev := public.company_event_hour_effect(p_company, v_start, v_end);

  -- sales of the hour with the quarter's awareness and quality; demand and capacity count in units at the
  -- normal price, the price strategy changes both price and demand (ADR-083)
  v_price := public.company_price_effect(pc.price_level, pc.quality);
  v_stage := least(greatest(coalesce((v_team ->> 'stage')::integer, 0), 0),
                   greatest(jsonb_array_length(coalesce(v_su #> '{stages,awarenessCaps}', '[1]'::jsonb)) - 1, 0));
  v_demand := pc.potential_annual_cents * public.company_market_factor(pc.tier, pc.expansion_level) / 4.0 / v_hours
            * pc.awareness * (0.5 + 0.5 * pc.quality)
            * exp(public.cfg_num(v_su, '{demandNoise}', 0.1) * public.gauss_random())
            * (v_price ->> 'demand')::double precision
            * (v_ev ->> 'demand_factor')::double precision;
  v_cap := (v_team ->> 'team_productivity_bps')::double precision / 10000.0
         * public.cfg_num(v_su, array['capacityCentsPerProductivity', c.sector_key], 250000)
         * (1 + public.cfg_num(v_su, '{stages,capacityBonusPerStage}', 0.25) * v_stage)
         * public.company_capacity_factor(pc.expansion_level)
         * (v_ev ->> 'capacity_factor')::double precision / v_hours;
  v_sold := least(v_demand, v_cap);
  -- contract work: a share of the unused capacity at the normal price (ADR-083)
  v_ctr := case when pc.contract_work
                then greatest(0, v_cap - v_sold) * public.cfg_num(v_su, '{contractWork,shareOfFreeCapacity}', 0.25)
                else 0 end;
  v_own := round((v_sold * (v_price ->> 'price')::double precision)::numeric)::bigint;
  v_crev := round(v_ctr::numeric)::bigint;
  -- closed money system: the households pay at most what they have (own sales first)
  v_hhbal := greatest(0, coalesce((select a.balance_cents from public.ledger_accounts a where a.id = v_hh), 0));
  if v_own + v_crev > v_hhbal then
    v_own := least(v_own, v_hhbal);
    v_crev := least(v_crev, v_hhbal - v_own);
    v_sold := least(v_sold, v_own / greatest((v_price ->> 'price')::double precision, 0.0001));
    v_ctr := v_crev;
  end if;
  v_rev := v_own + v_crev;
  -- goods; an event's extra costs (or savings) move with the own revenue, goods never cost less than nothing
  v_cogs := round(greatest(0, v_sold * (1 - public.cfg_num(v_su, array['grossMargin', c.sector_key], 0.5))
                              + v_own * (v_ev ->> 'extra_cost_share')::double precision)::numeric)::bigint
          + round((v_ctr * (1 - public.cfg_num(v_su, '{contractWork,grossMargin}', 0.3)))::numeric)::bigint;
  v_gross := v_rev - v_cogs;

  -- wages due: AI workers and the hourly contract wages of the players (the founder draws no wage)
  v_aidue := pc.ai_workers * public.config_bigint('startups', '{aiWorkerWageCentsPerHour}', 12000);
  for j in select pj.id, pj.salary_cents_per_hour, pj.notice_ends_at from public.player_jobs pj
            where pj.company_id = p_company and pj.status = 'active' order by pj.id loop
    v_until := least(v_end, coalesce(j.notice_ends_at, v_end));
    v_pdue := v_pdue + j.salary_cents_per_hour * public.job_payable_minutes(j.id, v_until) / 60;
  end loop;
  v_due := v_aidue + v_pdue;
  -- never more than the hour earned; everyone gets the same share (ADR-072)
  v_factor := case when v_due <= 0 then 10000 else least(10000, greatest(0, v_gross) * 10000 / v_due)::integer end;
  v_aipaid := v_aidue * v_factor / 10000;

  -- money: revenue (own sales and contract work) from the households, goods and AI wages back to them
  if v_rev > 0 then
    perform public.ledger_transfer(v_hh, v_acc, v_rev, 'company_revenue',
                                   'Umsatz ' || to_char(v_start at time zone 'Europe/Berlin', 'HH24') || ' Uhr',
                                   'company', p_company, k || ':revenue', pc.founder_id);
  end if;
  if v_cogs + v_aipaid > 0 then
    perform public.ledger_transfer(v_acc, v_hh, v_cogs + v_aipaid, 'company_costs', 'Wareneinsatz und KI-Kräfte',
                                   'company', p_company, k || ':goods', pc.founder_id);
  end if;
  -- players: the hour (up to the end of a notice) at contract wage x factor, with XP and branch minutes
  update public.player_companies set pay_factor_bps = v_factor where company_id = p_company;
  for j in select pj.id, pj.player_id, pj.notice_ends_at from public.player_jobs pj
            where pj.company_id = p_company and pj.status = 'active' order by pj.id loop
    v_until := least(v_end, coalesce(j.notice_ends_at, v_end));
    perform public.lock_player_accounts(j.player_id);
    v_ppaid := v_ppaid + public.accrue_job_salary(j.id, v_until);
  end loop;

  -- fixed costs (with the expansion level) and marketing from the cash; the rest becomes an open bill
  v_fixed := round((public.company_fixed_cost_cents(pc.tier, pc.expansion_level) / v_hours)::numeric)::bigint;
  v_mk := round((pc.marketing_cents_per_quarter / v_hours)::numeric)::bigint;
  v_costs := v_fixed + v_mk;
  select greatest(0, a.balance_cents) into v_cash from public.ledger_accounts a where a.id = v_acc;
  v_paid := least(v_costs, coalesce(v_cash, 0));
  if v_paid > 0 then
    perform public.ledger_transfer(v_acc, v_hh, v_paid, 'company_costs', 'Fixkosten und Marketing',
                                   'company', p_company, k || ':costs', pc.founder_id);
  end if;
  v_unpaid := v_costs - v_paid;
  if v_unpaid = 0 and pc.unpaid_cents > 0 then
    select greatest(0, a.balance_cents) into v_cash from public.ledger_accounts a where a.id = v_acc;
    v_settle := least(pc.unpaid_cents, coalesce(v_cash, 0));
    if v_settle > 0 then
      perform public.ledger_transfer(v_acc, v_hh, v_settle, 'company_costs', 'Offene Rechnungen',
                                     'company', p_company, k || ':settle', pc.founder_id);
    end if;
  end if;

  v_profit := v_rev - v_cogs - v_ppaid - v_aipaid - v_fixed - v_mk;
  v_owed := pc.unpaid_cents + v_unpaid - v_settle;

  -- automatic CEO payout (ADR-086, founderPayoutCents): after the hour's own bookings, a share of a positive profit
  -- (rounded down) moves from the company cash to the founder's private cash like company_withdraw, never more than
  -- the free cash (cash minus open bills). A transfer, not a cost: profit_cents stays as computed above.
  v_bps := least(10000, greatest(0, coalesce(pc.founder_payout_bps, 0)));
  if v_profit > 0 and v_bps > 0 then
    select a.balance_cents - v_owed into v_free from public.ledger_accounts a where a.id = v_acc;
    v_payout := least(v_profit * v_bps / 10000, greatest(0, coalesce(v_free, 0)));
  end if;
  if v_payout > 0 then
    perform public.lock_player_accounts(pc.founder_id);
    perform public.ledger_transfer(v_acc, public.ledger_player_account(pc.founder_id, 'player_cash'), v_payout, 'transfer',
                                   'CEO-Auszahlung ' || to_char(v_start at time zone 'Europe/Berlin', 'HH24') || ' Uhr',
                                   'company', p_company, k || ':payout', pc.founder_id);
    perform public.loan_withhold(pc.founder_id, v_payout, k || ':payout');
  end if;

  -- record hour (ADR-091): beating an earlier best hour is news, at most one item per Berlin day (updated while the
  -- day's record keeps rising and no AI text was written for it)
  if v_profit > coalesce(pc.best_hour_profit_cents, 0) and coalesce(pc.best_hour_profit_cents, 0) > 0 then
    select n.id into v_news from public.company_news n
     where n.company_id = p_company and n.kind = 'record_hour'
       and ((n.payload ->> 'hour_start')::timestamptz at time zone 'Europe/Berlin')::date
           = (v_start at time zone 'Europe/Berlin')::date
     order by n.id desc limit 1;
    if v_news is null then
      perform public.company_news_add(p_company, 'record_hour',
                                      jsonb_build_object('profit_cents', v_profit, 'hour_start', v_start));
    else
      update public.company_news set payload = jsonb_build_object('profit_cents', v_profit, 'hour_start', v_start)
       where id = v_news and ai_headline is null;
    end if;
  end if;

  update public.player_companies
     set unpaid_cents = v_owed,
         distress = v_owed > 0,
         last_hour_at = greatest(pc.last_hour_at, v_end),
         best_hour_profit_cents = greatest(best_hour_profit_cents, v_profit)
   where company_id = p_company;
  insert into public.player_company_hours (company_id, hour_start, game_quarter_id, demand_cents, capacity_cents, revenue_cents,
                                           contract_revenue_cents, cogs_cents, fixed_cents, marketing_cents, player_wages_due_cents,
                                           player_wages_paid_cents, ai_wages_due_cents, ai_wages_paid_cents, pay_factor_bps,
                                           paid_costs_cents, unpaid_added_cents, profit_cents, founder_payout_cents, event_id)
  values (p_company, v_start, v_qid, round(v_demand::numeric)::bigint, round(v_cap::numeric)::bigint, v_rev,
          v_crev, v_cogs, v_fixed, v_mk, v_pdue, v_ppaid, v_aidue, v_aipaid, v_factor, v_paid, v_unpaid, v_profit, v_payout,
          (v_ev ->> 'event_id')::uuid);

  return jsonb_build_object('company_id', p_company, 'hour_start', v_start, 'quarter_id', v_qid, 'revenue_cents', v_rev,
                            'contract_revenue_cents', v_crev, 'profit_cents', v_profit, 'pay_factor_bps', v_factor,
                            'player_wages_paid_cents', v_ppaid, 'ai_wages_paid_cents', v_aipaid, 'unpaid_added_cents', v_unpaid,
                            'founder_payout_cents', v_payout, 'event_id', v_ev -> 'event_id');
end;
$$;
comment on function public.player_company_close_hour(uuid, timestamptz) is
  'Closes one operating hour of a player company (closeStartupHour, ADR-072/083) with the company event of the hour '
  '(ADR-091), pays the automatic CEO payout (ADR-086) and writes the record_hour news; idempotent per (company, hour).';

-- ---------------------------------------------------------------------------
-- I. EVENT_STATE and the RPCs
-- ---------------------------------------------------------------------------
create or replace function public.company_event_company_json(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'idea', pc.idea, 'sector', c.sector_key,
                            'product_key', public.company_product(c.id) ->> 'key', 'tier', pc.tier)
    from public.companies c join public.player_companies pc on pc.company_id = c.id
   where c.id = p_company;
$$;

-- The company a player may look into: p_company when the player is its founder or a current employee (active
-- company), with p_company null the own company or else the player company the player works for. Null = no access.
create or replace function public.company_event_company_for(p_player uuid, p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_company is null then coalesce(
      (select pc.company_id from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active'),
      (select j.company_id from public.player_jobs j
         join public.player_companies pc on pc.company_id = j.company_id and pc.status = 'active'
        where j.player_id = p_player and j.status = 'active' order by j.started_at desc limit 1))
    else (select pc.company_id from public.player_companies pc
           where pc.company_id = p_company and pc.status = 'active'
             and (pc.founder_id = p_player
                  or exists (select 1 from public.player_jobs j
                              where j.company_id = p_company and j.player_id = p_player and j.status = 'active')))
  end;
$$;

-- EVENT_STATE (docs/DATA_MODEL.md, Nachtrag M4h)
create or replace function public.company_event_state(p_company uuid, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc        public.player_companies;
  e         public.player_company_events;
  v_unit    bigint := public.company_event_unit_cents(p_company);
  v_head    integer := public.company_event_headcount(p_company);
  v_scores  jsonb := public.company_event_team_scores(p_company);
  v_ev      jsonb;
  v_strat   jsonb;
  v_step    jsonb;
  v_next    jsonb;
  v_steps   jsonb;
  v_opts    jsonb;
  v_hist    jsonb;
  v_done    integer;
  v_n       integer;
  v_retry   boolean;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  select * into e from public.player_company_events ev
   where ev.company_id = p_company and ev.status not in ('over', 'expired')
   order by ev.started_at desc limit 1;
  if e.id is not null then
    v_strat := public.company_event_strategy_def(e);
    select coalesce(jsonb_agg(jsonb_build_object('idx', s.idx, 'strategy', s.strategy, 'key', s.key, 'status', s.status,
                                                 'started_at', s.started_at, 'ends_at', s.ends_at, 'cost_cents', s.cost_cents,
                                                 'success_bps', s.success_bps, 'retry', s.retry) order by s.id), '[]'::jsonb)
      into v_steps
      from public.company_event_steps s where s.event_id = e.id and not s.discarded;
    -- the step that can be started now (none while one runs)
    if e.status in ('open', 'in_force') and v_strat is not null
       and not exists (select 1 from public.company_event_steps s where s.event_id = e.id and s.status = 'running') then
      v_n := jsonb_array_length(coalesce(v_strat -> 'steps', '[]'::jsonb));
      v_done := public.company_event_done_steps(e.id);
      if v_done < v_n then
        v_step := v_strat -> 'steps' -> v_done;
        v_retry := exists (select 1 from public.company_event_steps s
                            where s.event_id = e.id and not s.discarded and s.status = 'failed'
                              and s.strategy = e.strategy and s.idx = v_done);
        v_next := jsonb_build_object(
          'strategy', e.strategy, 'idx', v_done, 'key', v_step ->> 'key',
          'cost_cents', public.company_event_step_cost(v_step, v_unit, e.severity, v_retry),
          'success_bps', public.company_event_step_bps(v_step, e.severity,
                                                       coalesce((v_scores ->> (v_step ->> 'branch'))::double precision, 0)),
          'staff', coalesce((v_step ->> 'staff')::integer, 0),
          'staff_ok', v_head >= coalesce((v_step ->> 'staff')::integer, 0),
          'hours', public.cfg_num(v_step, '{hours}', 0),
          'retry', v_retry);
      end if;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'strategy', s.x ->> 'key',
             'first_step_cost_cents', case when jsonb_array_length(coalesce(s.x -> 'steps', '[]'::jsonb)) > 0
                                           then public.company_event_step_cost(s.x -> 'steps' -> 0, v_unit, e.severity, false) end,
             'first_step_success_bps', case when jsonb_array_length(coalesce(s.x -> 'steps', '[]'::jsonb)) > 0
                                            then public.company_event_step_bps(s.x -> 'steps' -> 0, e.severity,
                                                   coalesce((v_scores ->> (s.x -> 'steps' -> 0 ->> 'branch'))::double precision, 0)) end)
           order by s.ord), '[]'::jsonb)
      into v_opts
      from jsonb_array_elements(coalesce(e.definition -> 'strategies', '[]'::jsonb)) with ordinality s(x, ord);
    v_ev := jsonb_build_object(
      'id', e.id, 'archetype', e.archetype, 'polarity', e.polarity, 'severity', e.severity, 'status', e.status,
      'started_at', e.started_at, 'deadline_at', e.deadline_at, 'resolved_at', e.resolved_at, 'over_at', e.over_at,
      'strategy', e.strategy, 'mitigation', round(e.mitigation::numeric, 4)::double precision,
      'ai_headline', e.ai_headline, 'ai_body', e.ai_body, 'ai_cause', e.ai_cause,
      'steps', v_steps, 'next', v_next, 'options', v_opts);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'archetype', h.archetype, 'polarity', h.polarity,
                                               'severity', h.severity, 'status', h.status, 'started_at', h.started_at,
                                               'resolved_at', h.resolved_at) order by h.started_at desc), '[]'::jsonb)
    into v_hist
    from (select ev.* from public.player_company_events ev
           where ev.company_id = p_company and ev.id is distinct from e.id
           order by ev.started_at desc limit 5) h;
  return jsonb_build_object(
    'company', public.company_event_company_json(p_company),
    'can_act', pc.founder_id = p_viewer and pc.status = 'active',
    'unit_cents', v_unit,
    'headcount', v_head,
    'branch_scores', v_scores,
    'event', v_ev,
    'history', v_hist,
    'profile_words', (select p.words from public.company_ai_profiles p where p.company_id = p_company));
end;
$$;

create or replace function public.get_company_event(p_company_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_company uuid;
begin
  v_company := public.company_event_company_for(v_player, p_company_id);
  if v_company is null then
    perform public.api_error('company_not_found');
  end if;
  return public.company_event_state(v_company, v_player);
end;
$$;
comment on function public.get_company_event(uuid) is
  'RPC (founder or current employee): EVENT_STATE of the own company (null) or the given one (ADR-091); else company_not_found.';

-- The founder's event (active company) for an action, locked; company_not_found for everyone else
create or replace function public.company_event_for_founder(p_player uuid, p_event uuid)
returns public.player_company_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.player_company_events;
begin
  select ev.* into e from public.player_company_events ev
    join public.player_companies pc on pc.company_id = ev.company_id and pc.status = 'active' and pc.founder_id = p_player
   where ev.id = p_event
   for update of ev;
  if e.id is null then
    perform public.api_error('company_not_found');
  end if;
  return e;
end;
$$;

create or replace function public.choose_event_strategy(p_request_id uuid, p_event_id uuid, p_strategy text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  e        public.player_company_events;
  v_strat  jsonb;
begin
  v_player := public.require_player();
  if p_request_id is null or p_event_id is null or coalesce(p_strategy, '') = '' then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'choose_event_strategy');
  if v_replay is not null then
    return v_replay;
  end if;
  e := public.company_event_for_founder(v_player, p_event_id);
  if e.status not in ('open', 'in_force') then
    perform public.api_error('event_closed');
  end if;
  select s into v_strat from jsonb_array_elements(coalesce(e.definition -> 'strategies', '[]'::jsonb)) s
   where s ->> 'key' = p_strategy limit 1;
  if v_strat is null then
    perform public.api_error('invalid_argument');
  end if;
  -- switching discards the progress of the old strategy (money spent stays spent)
  if e.strategy is distinct from p_strategy then
    perform public.company_event_discard(e.id, public.game_now(), true);
    update public.player_company_events set strategy = p_strategy where id = e.id;
  end if;
  -- accept / pass: sat out at once
  if jsonb_array_length(coalesce(v_strat -> 'steps', '[]'::jsonb)) = 0 then
    update public.player_company_events set status = 'accepted' where id = e.id;
  end if;
  return public.request_complete(v_player, p_request_id, public.company_event_state(e.company_id, v_player));
end;
$$;
comment on function public.choose_event_strategy(uuid, uuid, text) is
  'RPC (founder): chooses the strategy of an open or in-force event (ADR-091); switching discards step progress, '
  'accept/pass sets accepted. Errors invalid_argument, company_not_found, event_closed. -> EVENT_STATE';

create or replace function public.start_event_step(p_request_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  e        public.player_company_events;
  pc       public.player_companies;
  v_now    timestamptz := public.game_now();
  v_strat  jsonb;
  v_step   jsonb;
  v_n      integer;
  v_done   integer;
  v_retry  boolean;
  v_cost   bigint;
  v_bps    integer;
  v_free   bigint;
begin
  v_player := public.require_player();
  if p_request_id is null or p_event_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'start_event_step');
  if v_replay is not null then
    return v_replay;
  end if;
  e := public.company_event_for_founder(v_player, p_event_id);
  if e.status not in ('open', 'in_force') then
    perform public.api_error('event_closed');
  end if;
  v_strat := public.company_event_strategy_def(e);
  v_n := jsonb_array_length(coalesce(v_strat -> 'steps', '[]'::jsonb));
  v_done := public.company_event_done_steps(e.id);
  if v_strat is null or v_n = 0 or v_done >= v_n
     or exists (select 1 from public.company_event_steps s where s.event_id = e.id and s.status = 'running') then
    perform public.api_error('invalid_argument');
  end if;
  v_step := v_strat -> 'steps' -> v_done;
  -- canStartStep: founder, player employees and AI workers
  if public.company_event_headcount(e.company_id) < coalesce((v_step ->> 'staff')::integer, 0) then
    perform public.api_error('event_needs_staff');
  end if;
  v_retry := exists (select 1 from public.company_event_steps s
                      where s.event_id = e.id and not s.discarded and s.status = 'failed'
                        and s.strategy = e.strategy and s.idx = v_done);
  v_cost := public.company_event_step_cost(v_step, public.company_event_unit_cents(e.company_id), e.severity, v_retry);
  v_bps := public.company_event_step_bps(v_step, e.severity,
             coalesce((public.company_event_team_scores(e.company_id) ->> (v_step ->> 'branch'))::double precision, 0));
  -- paid from the free cash: open bills come first (as company_withdraw and expand_company)
  select * into pc from public.player_companies where company_id = e.company_id for update;
  select a.balance_cents - pc.unpaid_cents into v_free
    from public.ledger_accounts a where a.owner_company_id = e.company_id and a.kind = 'company_cash' for update;
  if coalesce(v_free, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.company_cash_account(e.company_id), public.ledger_system_account('households'), v_cost,
                                   'company_costs', 'Gegenmaßnahme', 'company', e.company_id,
                                   'event-step:' || e.id::text || ':' || p_request_id::text, v_player);
  end if;
  insert into public.company_event_steps (event_id, idx, strategy, key, status, started_at, ends_at, cost_cents, success_bps,
                                          retry, capacity_hit, request_id)
  values (e.id, v_done, e.strategy, v_step ->> 'key', 'running', v_now,
          v_now + make_interval(secs => greatest(0, public.cfg_num(v_step, '{hours}', 1)) * 3600),
          v_cost, v_bps, v_retry, least(1, greatest(0, public.cfg_num(v_step, '{capacityHit}', 0))), p_request_id);
  return public.request_complete(v_player, p_request_id, public.company_event_state(e.company_id, v_player));
end;
$$;
comment on function public.start_event_step(uuid, uuid) is
  'RPC (founder): starts the next step of the chosen strategy (ADR-091), paid from the free company cash. Errors '
  'invalid_argument, company_not_found, event_closed, event_needs_staff, insufficient_funds. -> EVENT_STATE';

create or replace function public.get_company_news(p_company_id uuid default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_company uuid;
begin
  v_company := public.company_event_company_for(v_player, p_company_id);
  if v_company is null then
    perform public.api_error('company_not_found');
  end if;
  return jsonb_build_object(
    'company', public.company_event_company_json(v_company),
    'profile_words', (select p.words from public.company_ai_profiles p where p.company_id = v_company),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'payload', n.payload, 'created_at', n.created_at,
                                          'ai_headline', n.ai_headline, 'ai_body', n.ai_body) order by n.created_at desc, n.id desc)
        from (select x.* from public.company_news x where x.company_id = v_company
               order by x.created_at desc, x.id desc limit least(100, greatest(1, coalesce(p_limit, 30)))) n), '[]'::jsonb));
end;
$$;
comment on function public.get_company_news(uuid, integer) is
  'RPC (founder or current employee): news of the own company (null) or the given one, newest first (ADR-091).';

-- ---------------------------------------------------------------------------
-- J. Texts written by Claude (Edge Function)
-- ---------------------------------------------------------------------------
create or replace function public.company_ai_context(p_company_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_company uuid;
begin
  v_company := public.company_event_company_for(v_player, p_company_id);
  if v_company is null then
    perform public.api_error('company_not_found');
  end if;
  return jsonb_build_object(
    'company', (select jsonb_build_object('id', c.id, 'name', c.name, 'idea', pc.idea, 'sector', c.sector_key,
                                          'product_key', public.company_product(c.id) ->> 'key')
                  from public.companies c join public.player_companies pc on pc.company_id = c.id where c.id = v_company),
    'has_profile', exists (select 1 from public.company_ai_profiles p where p.company_id = v_company),
    'events_without_text', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'archetype', e.archetype, 'polarity', e.polarity, 'severity', e.severity,
                                          'status', e.status) order by e.started_at desc)
        from (select x.* from public.player_company_events x where x.company_id = v_company and x.ai_headline is null
               order by x.started_at desc limit 5) e), '[]'::jsonb),
    'news_without_text', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'payload', n.payload) order by n.created_at desc, n.id desc)
        from (select x.* from public.company_news x where x.company_id = v_company and x.ai_headline is null
               order by x.created_at desc, x.id desc limit 5) n), '[]'::jsonb));
end;
$$;
comment on function public.company_ai_context(uuid) is
  'RPC (founder or current employee): what the Edge Function needs to write texts for a company (ADR-091).';

-- A text Claude wrote: 1..max characters, no control characters, no blocked term (text_has_profanity: the
-- blocked_name_terms rules per word, reserved terms excluded); null only when not required
create or replace function public.company_ai_text_ok(p_text text, p_max integer, p_required boolean default true)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_text is null then not p_required
              else char_length(p_text) between 1 and p_max and btrim(p_text) <> '' and p_text !~ '[[:cntrl:]]'
                   and not public.text_has_profanity(p_text) end;
$$;

create or replace function public.store_company_ai_profile(p_company_id uuid, p_words jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slots text[] := array['buyer', 'critic', 'input', 'place', 'product', 'risk', 'rule', 'tax', 'trend'];
  v_slot  text;
  v_list  jsonb;
begin
  if p_company_id is null or p_words is null or jsonb_typeof(p_words) <> 'object'
     or not exists (select 1 from public.player_companies pc where pc.company_id = p_company_id)
     or (select array_agg(k order by k) from jsonb_object_keys(p_words) k) is distinct from v_slots then
    return false;
  end if;
  foreach v_slot in array v_slots loop
    v_list := p_words -> v_slot;
    if jsonb_typeof(v_list) is distinct from 'array' then
      return false;
    end if;
    if jsonb_array_length(v_list) not between 1 and 5
       or exists (select 1 from jsonb_array_elements(v_list) w
                   where case when jsonb_typeof(w) = 'string' then not public.company_ai_text_ok(w #>> '{}', 40) else true end) then
      return false;
    end if;
  end loop;
  insert into public.company_ai_profiles (company_id, words) values (p_company_id, p_words)
  on conflict (company_id) do nothing;
  return found;
end;
$$;
comment on function public.store_company_ai_profile(uuid, jsonb) is
  'Service role (Edge Function): stores the product words of a company once; false when invalid or already stored.';

create or replace function public.store_company_event_text(p_event_id uuid, p_headline text, p_body text, p_cause text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event_id is null or not public.company_ai_text_ok(p_headline, 120) or not public.company_ai_text_ok(p_body, 600)
     or not public.company_ai_text_ok(p_cause, 60, false) then
    return false;
  end if;
  update public.player_company_events set ai_headline = p_headline, ai_body = p_body, ai_cause = p_cause
   where id = p_event_id and ai_headline is null;
  return found;
end;
$$;
comment on function public.store_company_event_text(uuid, text, text, text) is
  'Service role (Edge Function): stores headline (120), body (600) and cause (60, optional) of an event once.';

create or replace function public.store_company_news_text(p_news_id bigint, p_headline text, p_body text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_news_id is null or not public.company_ai_text_ok(p_headline, 120) or not public.company_ai_text_ok(p_body, 600, false) then
    return false;
  end if;
  update public.company_news set ai_headline = p_headline, ai_body = p_body
   where id = p_news_id and ai_headline is null;
  return found;
end;
$$;
comment on function public.store_company_news_text(bigint, text, text) is
  'Service role (Edge Function): stores headline (120) and body (600, optional) of a news item once.';

-- ---------------------------------------------------------------------------
-- K. run_due_jobs as in M4a plus social (M4f), announced events (M4g) and company events
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
  v_result := v_result || jsonb_build_object('company_events', public.company_events_run_due());

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

  -- weekly league and feed upkeep (M4f, ADR-088/089) and announced events (M4g, ADR-090): kept in this redefinition
  v_result := v_result || jsonb_build_object('social', public.social_run_due());
  v_result := v_result || jsonb_build_object('events', public.events_run_due());

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
-- L. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.api_error(text)', 'public.company_events_cfg()', 'public.company_event_archetype(text)',
    'public.company_event_pick(double precision, text, text)', 'public.company_event_severity(double precision)',
    'public.company_event_unit_cents(uuid)', 'public.company_event_step_cost(jsonb, bigint, integer, boolean)',
    'public.company_event_step_bps(jsonb, integer, double precision)', 'public.company_event_team_scores(uuid)',
    'public.company_event_headcount(uuid)',
    'public.company_event_ends_at(text, double precision, timestamptz, timestamptz)',
    'public.company_event_phase(text, double precision, timestamptz, timestamptz, timestamptz)',
    'public.company_event_modifiers(jsonb, integer, text, double precision, double precision)',
    'public.company_event_hour_effect(uuid, timestamptz, timestamptz)', 'public.company_news_add(uuid, text, jsonb)',
    'public.company_event_notify(uuid, text, text, text)', 'public.company_news_player_company_trg()',
    'public.company_news_listing_trg()', 'public.company_news_hired_trg()', 'public.company_event_share_shock(uuid, integer)',
    'public.company_event_start(uuid, text, integer, timestamptz)', 'public.company_event_roll_at(uuid, date)',
    'public.company_event_roll(uuid, timestamptz, double precision[])',
    'public.company_event_strategy_def(public.player_company_events)', 'public.company_event_done_steps(uuid, timestamptz)',
    'public.company_event_discard(uuid, timestamptz, boolean)', 'public.company_event_solve(uuid, timestamptz)',
    'public.company_event_resolve_step(bigint, double precision)', 'public.company_events_run_due(timestamptz, boolean)',
    'public.player_company_close_hour(uuid, timestamptz)', 'public.company_event_company_json(uuid)',
    'public.company_event_company_for(uuid, uuid)', 'public.company_event_state(uuid, uuid)',
    'public.company_event_for_founder(uuid, uuid)', 'public.get_company_event(uuid)',
    'public.choose_event_strategy(uuid, uuid, text)', 'public.start_event_step(uuid, uuid)',
    'public.get_company_news(uuid, integer)', 'public.company_ai_context(uuid)',
    'public.company_ai_text_ok(text, integer, boolean)', 'public.store_company_ai_profile(uuid, jsonb)',
    'public.store_company_event_text(uuid, text, text, text)', 'public.store_company_news_text(bigint, text, text)',
    'public.run_due_jobs()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_company_event(uuid)', 'public.choose_event_strategy(uuid, uuid, text)', 'public.start_event_step(uuid, uuid)',
    'public.get_company_news(uuid, integer)', 'public.company_ai_context(uuid)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
