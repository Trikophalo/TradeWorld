-- ===== idempotent copy of migrations/20261204000600_protests.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0600 · Campaigns against other companies (ADR-133)
-- =============================================================================
-- A player starts a campaign against any company (AI or player, not the own one): boycott call, shitstorm, petition
-- or protest march. Fixed kinds without free text. It costs protests.startCostCents. Players join for free, AI
-- supporters join on their own every minute, but only up to aiMax, so players must make up the rest of the goal.
-- At the goal a roll decides: only with effectChance (base + per player supporter, at most max) does it really hurt:
-- a listed company's price falls a little (event_price_shock), a player company also loses awareness. Otherwise it
-- fizzles out. Without the goal after durationHours it expires. Results are market news (news tab).
--
-- Tables company_protests, company_protest_supporters (RLS, no client rights). RPCs (authenticated):
--   get_protests() -> CAMPAIGNS
--   start_protest(p_request_id uuid, p_company_id uuid, p_kind text) -> CAMPAIGNS
--   join_protest(p_request_id uuid, p_protest_id bigint) -> CAMPAIGNS
-- Internal: protests_run_due(p_now) (cron nexa-protests, every minute).
-- Errors: protest_busy NX117, protest_joined NX118, protest_closed NX119, protest_own NX120, plus
-- insufficient_funds, company_not_found, locked.
-- Idempotent: runs unchanged as supabase/updates/20261204000600_protests.sql.

create table if not exists public.company_protests (
  id             bigint generated always as identity primary key,
  company_id     uuid not null references public.companies (id) on delete cascade,
  kind           text not null check (kind in ('boycott', 'shitstorm', 'petition', 'protest_march')),
  started_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  ends_at        timestamptz not null,
  goal           integer not null check (goal > 0),
  ai_supporters  integer not null default 0 check (ai_supporters >= 0),
  status         text not null default 'open' check (status in ('open', 'hit', 'fizzled', 'expired')),
  effect_bps     integer,
  resolved_at    timestamptz
);
alter table public.company_protests enable row level security;
revoke all on public.company_protests from public, anon, authenticated;
create index if not exists company_protests_company_idx on public.company_protests (company_id, created_at desc);
create index if not exists company_protests_open_idx on public.company_protests (status, ends_at) where status = 'open';
create index if not exists company_protests_started_by_idx on public.company_protests (started_by);

create table if not exists public.company_protest_supporters (
  protest_id  bigint not null references public.company_protests (id) on delete cascade,
  player_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (protest_id, player_id)
);
alter table public.company_protest_supporters enable row level security;
revoke all on public.company_protest_supporters from public, anon, authenticated;
create index if not exists company_protest_supporters_player_idx on public.company_protest_supporters (player_id);
comment on table public.company_protests is 'Campaigns against companies (ADR-133). Internal; read through get_protests().';

do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''protest_own''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'pitch_busy'                  then 'NX116'
$q$, $q$    when 'pitch_busy'                  then 'NX116'
    when 'protest_busy'               then 'NX117'
    when 'protest_joined'             then 'NX118'
    when 'protest_closed'             then 'NX119'
    when 'protest_own'                then 'NX120'
$q$);
    if position('''protest_own''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the protest error keys by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

create or replace function public.protests_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'protests'), '{}'::jsonb);
$$;

create or replace function public.protests_state(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'start_cost_cents', (public.protests_cfg() ->> 'startCostCents')::bigint,
    'min_level', (public.protests_cfg() ->> 'minLevel')::integer,
    'protests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'kind', k.kind, 'company_id', k.company_id, 'company', c.name, 'ticker', c.ticker,
               'status', k.status, 'goal', k.goal, 'ai_supporters', k.ai_supporters,
               'players', (select count(*) from public.company_protest_supporters s where s.protest_id = k.id),
               'joined', exists (select 1 from public.company_protest_supporters s where s.protest_id = k.id and s.player_id = p_player),
               'started_by', (select p.nickname from public.profiles p where p.id = k.started_by),
               'mine', k.started_by = p_player,
               'against_me', exists (select 1 from public.player_companies pc where pc.company_id = k.company_id
                                       and pc.founder_id = p_player),
               'effect_bps', k.effect_bps, 'created_at', k.created_at, 'ends_at', k.ends_at, 'resolved_at', k.resolved_at)
             order by (k.status = 'open') desc, k.created_at desc)
        from (select * from public.company_protests x
               where x.status = 'open' or x.resolved_at > now() - interval '1 day'
               order by x.created_at desc limit 20) k
        join public.companies c on c.id = k.company_id), '[]'::jsonb));
$$;

create or replace function public.get_protests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.protests_state(public.require_player());
end;
$$;

create or replace function public.start_protest(p_request_id uuid, p_company_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.protests_cfg();
  v_player uuid;
  v_replay jsonb;
  v_cost   bigint := (cfg ->> 'startCostCents')::bigint;
  v_cash   bigint;
  v_id     bigint;
begin
  v_player := public.require_player();
  if p_request_id is null or p_company_id is null or not (cfg -> 'kinds' ? coalesce(p_kind, '')) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'start_protest');
  if v_replay is not null then
    return v_replay;
  end if;
  if (select p.level from public.profiles p where p.id = v_player) < (cfg ->> 'minLevel')::integer then
    perform public.api_error('locked');
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id and c.dissolved_at is null) then
    perform public.api_error('company_not_found');
  end if;
  if exists (select 1 from public.player_companies pc where pc.company_id = p_company_id and pc.founder_id = v_player)
     or exists (select 1 from public.player_jobs j where j.company_id = p_company_id and j.player_id = v_player
                  and j.status = 'active') then
    perform public.api_error('protest_own');
  end if;
  if exists (select 1 from public.company_protests k where k.company_id = p_company_id and k.status = 'open')
     or exists (select 1 from public.company_protests k where k.started_by = v_player
                  and k.created_at > public.game_now() - make_interval(hours => (cfg ->> 'starterCooldownHours')::integer)) then
    perform public.api_error('protest_busy');
  end if;
  select a.balance_cents into v_cash from public.ledger_accounts a
   where a.id = public.ledger_player_account(v_player, 'player_cash') for update;
  if coalesce(v_cash, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'),
                                   public.ledger_system_account('households'), v_cost, 'transfer', 'Kampagne gestartet',
                                   'company', p_company_id, 'protest:start:' || p_request_id::text, v_player);
  end if;
  insert into public.company_protests (company_id, kind, started_by, created_at, ends_at, goal)
  values (p_company_id, p_kind, v_player, public.game_now(),
          public.game_now() + make_interval(hours => (cfg ->> 'durationHours')::integer), (cfg ->> 'goal')::integer)
  returning id into v_id;
  insert into public.company_protest_supporters (protest_id, player_id) values (v_id, v_player);
  return public.request_complete(v_player, p_request_id, public.protests_state(v_player));
end;
$$;

create or replace function public.join_protest(p_request_id uuid, p_protest_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.protests_cfg();
  v_player uuid;
  v_replay jsonb;
  k        public.company_protests;
begin
  v_player := public.require_player();
  if p_request_id is null or p_protest_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'join_protest');
  if v_replay is not null then
    return v_replay;
  end if;
  if (select p.level from public.profiles p where p.id = v_player) < (cfg ->> 'minLevel')::integer then
    perform public.api_error('locked');
  end if;
  select * into k from public.company_protests where id = p_protest_id for update;
  if k.id is null or k.status <> 'open' or k.ends_at <= public.game_now() then
    perform public.api_error('protest_closed');
  end if;
  if exists (select 1 from public.player_companies pc where pc.company_id = k.company_id and pc.founder_id = v_player)
     or exists (select 1 from public.player_jobs j where j.company_id = k.company_id and j.player_id = v_player
                  and j.status = 'active') then
    perform public.api_error('protest_own');
  end if;
  if exists (select 1 from public.company_protest_supporters s where s.protest_id = k.id and s.player_id = v_player) then
    perform public.api_error('protest_joined');
  end if;
  insert into public.company_protest_supporters (protest_id, player_id) values (k.id, v_player);
  perform public.protest_check(k.id, random(), random());
  return public.request_complete(v_player, p_request_id, public.protests_state(v_player));
end;
$$;

-- At the goal: the roll; p_u decides whether it hurts, p_u2 how much
create or replace function public.protest_check(p_protest_id bigint, p_u double precision, p_u2 double precision)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.protests_cfg();
  k         public.company_protests;
  c         public.companies;
  v_players integer;
  v_chance  integer;
  v_bps     integer;
  v_label   text;
begin
  select * into k from public.company_protests where id = p_protest_id for update;
  if k.id is null or k.status <> 'open' then
    return null;
  end if;
  select count(*) into v_players from public.company_protest_supporters s where s.protest_id = k.id;
  if v_players + k.ai_supporters < k.goal then
    return 'open';
  end if;
  select * into c from public.companies where id = k.company_id;
  v_label := case k.kind when 'boycott' then 'Boykott-Aufruf' when 'shitstorm' then 'Shitstorm'
                         when 'petition' then 'Petition' else 'Protestmarsch' end;
  v_chance := least((cfg ->> 'effectChanceMaxBps')::integer,
                    (cfg ->> 'effectChanceBaseBps')::integer + v_players * (cfg ->> 'effectChancePerPlayerBps')::integer);
  if p_u * 10000 < v_chance then
    v_bps := (cfg ->> 'priceHitMinBps')::integer
             + floor(p_u2 * ((cfg ->> 'priceHitMaxBps')::integer - (cfg ->> 'priceHitMinBps')::integer + 1))::integer;
    if c.security_id is not null
       and exists (select 1 from public.securities s where s.id = c.security_id and s.status = 'listed') then
      perform public.event_price_shock(c.security_id, -v_bps, public.game_now());
    end if;
    update public.player_companies
       set awareness = greatest(0, awareness - (cfg ->> 'awarenessHit')::double precision)
     where company_id = c.id;
    if exists (select 1 from public.player_companies pc where pc.company_id = c.id) then
      perform public.company_news_add(c.id, 'protest_hit', jsonb_build_object('kind', k.kind, 'players', v_players));
    end if;
    update public.company_protests set status = 'hit', effect_bps = v_bps, resolved_at = public.game_now() where id = k.id;
    insert into public.news_items (category, headline, body, importance, company_id, security_id, published_at)
    values ('market', v_label || ' gegen ' || c.name || ' zeigt Wirkung',
            v_players || ' Spieler und ' || k.ai_supporters || ' weitere Unterstützer machen mit. Das Thema ist in aller Munde.',
            2, c.id, c.security_id, public.game_now());
    return 'hit';
  end if;
  update public.company_protests set status = 'fizzled', resolved_at = public.game_now() where id = k.id;
  insert into public.news_items (category, headline, body, importance, company_id, security_id, published_at)
  values ('market', v_label || ' gegen ' || c.name || ' verpufft',
          'Viele haben mitgemacht, doch Kunden und Anleger zucken nur mit den Schultern.', 1, c.id, c.security_id,
          public.game_now());
  return 'fizzled';
end;
$$;

create or replace function public.protests_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg    jsonb := public.protests_cfg();
  v_now  timestamptz := coalesce(p_now, public.game_now());
  r      record;
  v_add  integer;
  v_n    integer := 0;
begin
  if cfg = '{}'::jsonb then
    return jsonb_build_object('skipped', 'no config');
  end if;
  for r in select * from public.company_protests where status = 'open' order by created_at for update skip locked loop
    if r.ends_at <= v_now then
      update public.company_protests set status = 'expired', resolved_at = v_now where id = r.id;
      continue;
    end if;
    if r.ai_supporters < (cfg ->> 'aiMax')::integer and random() * 10000 < (cfg ->> 'aiJoinChanceBps')::integer then
      v_add := least((cfg ->> 'aiMax')::integer - r.ai_supporters,
                     1 + floor(random() * (cfg ->> 'aiPerMinuteMax')::integer)::integer);
      update public.company_protests set ai_supporters = ai_supporters + v_add where id = r.id;
      perform public.protest_check(r.id, random(), random());
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('grown', v_n);
end;
$$;

revoke all on function public.protests_cfg() from public, anon, authenticated;
revoke all on function public.protests_state(uuid) from public, anon, authenticated;
revoke all on function public.protest_check(bigint, double precision, double precision) from public, anon, authenticated;
revoke all on function public.protests_run_due(timestamptz) from public, anon, authenticated;
grant execute on function public.protests_run_due(timestamptz) to service_role;
revoke all on function public.get_protests() from public, anon;
revoke all on function public.start_protest(uuid, uuid, text) from public, anon;
revoke all on function public.join_protest(uuid, bigint) from public, anon;
grant execute on function public.get_protests() to authenticated;
grant execute on function public.start_protest(uuid, uuid, text) to authenticated;
grant execute on function public.join_protest(uuid, bigint) to authenticated;
comment on function public.get_protests() is 'RPC: open and recent campaigns against companies (ADR-133).';
comment on function public.start_protest(uuid, uuid, text) is 'RPC: start a campaign against a company (ADR-133).';
comment on function public.join_protest(uuid, bigint) is 'RPC: join a campaign (ADR-133).';

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-protests';
    perform cron.schedule('nexa-protests', '* * * * *', 'select public.protests_run_due()');
  end if;
end;
$do$;
