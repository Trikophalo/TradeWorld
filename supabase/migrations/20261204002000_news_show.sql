-- =============================================================================
-- NEXA · 2000 · NEXA Nachrichten: the hourly live show with Mr. Doodle Dangle (ADR-150)
-- =============================================================================
-- Once an hour, at the full hour, the anchor Mr. Doodle Dangle reads the news live. A show has a handful of segments
-- with real effects, decided by the server: the player who lost most gets roasted (and a small consolation), a
-- player's company has a scandal or a hype (awareness, task momentum, share price), listed stocks and a whole sector
-- jump, open company tasks get more or less valuable, and a hint for the coming hour ends the show.
--
-- A show only happens when a real player watches: it starts when the first viewer calls get_news_show() at the full
-- hour or up to newsShow.waitMinutes after it (started_at); only then the effects apply. Without viewers it is
-- cancelled and nothing happens. Every viewer computes the phase from started_at, so all see the same.
--
-- Scripts: the Mini-KI builds them from frames x reasons in game_config.newsShow.texts and remembers what it used
-- (news_show_used), so nothing repeats for hundreds of shows. With a Claude key the edge function news-anchor rewrites
-- the draft per company before the show (news_show_claim_script / news_show_script_context / store_news_show_script).
--
-- RPCs (authenticated):
--   get_news_show() -> {"now", "next_airs_at", "viewers", "upcoming": {"id", "airs_at", "needs_script"} | null,
--                       "show": SHOW | null, "chat": [{"id", "nickname", "body", "at", "mine"}]}
--     SHOW = {"id", "airs_at", "started_at", "writer", "segments": [{"kind", "headline", "text",
--             "effects": [{"label", "tone"}]}]}   -- the show of this hour once it started, replayable for a while
--   post_news_show_message(p_request_id uuid, p_body text) -> {"chat": [...]}   -- errors chat_text_invalid, rate_limited
--   news_show_claim_script(p_show_id bigint) -> boolean   -- true once: this caller may ask Claude
-- Internal: news_show_run_due(p_now) (cron nexa-news-show, every minute).
-- Idempotent: runs unchanged as supabase/updates/20261204002000_news_show.sql.

create table if not exists public.news_shows (
  id              bigint generated always as identity primary key,
  airs_at         timestamptz not null unique,
  status          text not null default 'scheduled' check (status in ('scheduled', 'aired', 'cancelled')),
  segments        jsonb not null default '[]'::jsonb,
  writer          text not null default 'mini' check (writer in ('mini', 'claude')),
  ai_requested_at timestamptz,
  started_at      timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.news_shows enable row level security;
revoke all on public.news_shows from public, anon, authenticated;
comment on table public.news_shows is
  'NEXA Nachrichten (ADR-150): one show per full hour. segments carry the script, the public effect chips and the '
  'internal apply list. Internal; read through get_news_show().';

create table if not exists public.news_show_used (
  key     text primary key,
  used_at timestamptz not null default clock_timestamp()
);
alter table public.news_show_used enable row level security;
revoke all on public.news_show_used from public, anon, authenticated;
comment on table public.news_show_used is 'Scripts the Mini-KI used for a show (frame x reason), so news do not repeat. Internal.';

create table if not exists public.news_show_messages (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table public.news_show_messages enable row level security;
revoke all on public.news_show_messages from public, anon, authenticated;
create index if not exists news_show_messages_created_idx on public.news_show_messages (created_at desc);
create index if not exists news_show_messages_player_idx on public.news_show_messages (player_id, created_at desc);
comment on table public.news_show_messages is 'Live chat beside the news show (ADR-150). Internal; read through get_news_show().';

create table if not exists public.news_show_viewers (
  player_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at   timestamptz not null default now()
);
alter table public.news_show_viewers enable row level security;
revoke all on public.news_show_viewers from public, anon, authenticated;
comment on table public.news_show_viewers is 'Who has the news stream open right now (ADR-150). Internal.';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('news_show', 'social', 'In den Nachrichten', 'Mr. Doodle Dangle hat über dich oder deine Firma berichtet.',
        'notif_bell', true, true, false, 299)
on conflict (key) do nothing;

-- Error key NX128 ------------------------------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''chat_text_invalid''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'order_cooldown'             then 'NX127'
$q$, $q$    when 'order_cooldown'             then 'NX127'
    when 'chat_text_invalid'          then 'NX128'
$q$);
    if position('''chat_text_invalid''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the news show error key by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.news_show_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'newsShow'), '{}'::jsonb);
$$;

-- "12,4 %" from basis points, always positive (movePercent in src/lib/sim/news-show.ts)
create or replace function public.news_show_move(p_bps integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(replace(to_char(round(abs(p_bps) / 100.0, 1), 'FM999990.0'), '.', ','), ',0$', '') || ' %';
$$;

-- {placeholders} from a jsonb object of texts (fillScript)
create or replace function public.news_show_fill(p_text text, p_values jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := p_text;
  r record;
begin
  for r in select key, value from jsonb_each_text(coalesce(p_values, '{}'::jsonb)) loop
    v := replace(v, '{' || r.key || '}', coalesce(r.value, ''));
  end loop;
  return v;
end;
$$;

-- A frame and a reason for a kind: the combination used longest ago, among those the reason used longest ago,
-- then by chance (pickScript); remembers the pick. -> {"headline", "text"} with {reason} filled in
create or replace function public.news_show_pick(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  kit jsonb := public.news_show_cfg() -> 'texts' -> p_kind;
  r   record;
begin
  select f.ord - 1 as f, x.ord - 1 as r, f.val ->> 'headline' as headline, f.val ->> 'text' as body, x.val as reason
    into r
    from jsonb_array_elements(coalesce(kit -> 'frames', '[]'::jsonb)) with ordinality f(val, ord)
   cross join jsonb_array_elements_text(coalesce(kit -> 'reasons', '[]'::jsonb)) with ordinality x(val, ord)
    left join public.news_show_used u on u.key = p_kind || ':' || (f.ord - 1) || ':' || (x.ord - 1)
    left join public.news_show_used ur on ur.key = 'r:' || p_kind || ':' || (x.ord - 1)
   order by u.used_at nulls first, ur.used_at nulls first, random()
   limit 1;
  if r.headline is null then
    return null;
  end if;
  insert into public.news_show_used (key, used_at) values (p_kind || ':' || r.f || ':' || r.r, clock_timestamp())
  on conflict (key) do update set used_at = excluded.used_at;
  insert into public.news_show_used (key, used_at) values ('r:' || p_kind || ':' || r.r, clock_timestamp())
  on conflict (key) do update set used_at = excluded.used_at;
  return jsonb_build_object('headline', r.headline, 'text', replace(r.body, '{reason}', r.reason));
end;
$$;

-- One segment: script of the kind with the values filled in, the public effect chips, the internal apply list and
-- the facts for Claude.
create or replace function public.news_show_segment(p_kind text, p_script text, p_values jsonb, p_effects jsonb, p_apply jsonb,
                                                    p_subject jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s jsonb := public.news_show_pick(p_script);
begin
  if s is null then
    return null;
  end if;
  return jsonb_build_object(
    'kind', p_kind,
    'headline', public.news_show_fill(s ->> 'headline', p_values),
    'text', public.news_show_fill(s ->> 'text', p_values),
    'effects', coalesce(p_effects, '[]'::jsonb),
    'apply', coalesce(p_apply, '[]'::jsonb),
    'subject', coalesce(p_subject, '{}'::jsonb) || jsonb_build_object('values', p_values));
end;
$$;

-- ---------------------------------------------------------------------------
-- The draft of a show
-- ---------------------------------------------------------------------------
create or replace function public.news_show_build(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.news_show_cfg();
  v_segs    jsonb := '[]'::jsonb;
  v_seg     jsonb;
  v_tip     jsonb;
  v_last    jsonb;
  v_skip_p  uuid[];
  v_skip_c  uuid[];
  r         record;
  v_bps     integer;
  v_aw      integer;
  v_dir     integer;
  v_scandal boolean;
  v_effects jsonb;
  v_apply   jsonb;
  v_max     integer := coalesce((cfg ->> 'maxSegments')::integer, 7);
begin
  -- who was in the last show: not again right away
  select s.segments into v_last from public.news_shows s where s.status = 'aired' order by s.airs_at desc limit 1;
  select coalesce(array_agg((x -> 'subject' ->> 'player_id')::uuid) filter (where x -> 'subject' ? 'player_id'), '{}'),
         coalesce(array_agg((x -> 'subject' ->> 'company_id')::uuid) filter (where x -> 'subject' ? 'company_id'), '{}')
    into v_skip_p, v_skip_c
    from jsonb_array_elements(coalesce(v_last, '[]'::jsonb)) x;

  -- 1. the loser of the day: roast and a consolation
  select w.entity_id as player_id, p.nickname, w.first_nw - w.last_nw as loss,
         ((w.first_nw - w.last_nw) * 10000 / w.first_nw)::integer as bps
    into r
    from (select l.entity_id, l.nw as last_nw, f.nw as first_nw
            from (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                   where entity_kind = 'player' and taken_at >= p_now - interval '45 minutes'
                   order by entity_id, taken_at desc) l
            join (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                   where entity_kind = 'player'
                     and taken_at >= p_now - make_interval(hours => coalesce((cfg #>> '{loser,windowHours}')::integer, 24))
                   order by entity_id, taken_at asc) f using (entity_id)
           where f.nw > 0) w
    join public.profiles p on p.id = w.entity_id
   where w.entity_id <> all (v_skip_p)
     and (w.first_nw - w.last_nw) * 10000 / w.first_nw >= coalesce((cfg #>> '{loser,minLossBps}')::integer, 300)
   order by (w.first_nw - w.last_nw) * 10000 / w.first_nw desc, random()
   limit 1;
  if r.player_id is not null then
    v_bps := coalesce((cfg #>> '{loser,consolationCents}')::integer, 0);
    v_seg := public.news_show_segment('loser', 'loser',
      jsonb_build_object('name', r.nickname, 'amount', public.format_eur(r.loss), 'pct', public.news_show_move(r.bps)),
      case when v_bps > 0 then jsonb_build_array(jsonb_build_object('label', '+' || public.format_eur(v_bps) || ' Trostpflaster', 'tone', 'gain'))
           else '[]'::jsonb end,
      case when v_bps > 0 then jsonb_build_array(jsonb_build_object('type', 'cash', 'player_id', r.player_id, 'cents', v_bps))
           else '[]'::jsonb end,
      jsonb_build_object('type', 'player', 'player_id', r.player_id, 'name', r.nickname));
    if v_seg is not null then v_segs := v_segs || v_seg; end if;
  end if;

  -- 2. players' companies: a scandal or a hype
  for r in select pc.company_id, c.name, left(coalesce(nullif(btrim(pc.idea), ''), 'irgendwas mit Zukunft'), 90) as idea,
                  p.nickname as founder, pc.founder_id, sec.id as security_id, sec.ticker, c.sector_key
             from public.player_companies pc
             join public.companies c on c.id = pc.company_id
             join public.profiles p on p.id = pc.founder_id
             left join public.securities sec on sec.company_id = c.id and sec.kind = 'stock' and sec.status = 'listed'
            where pc.status = 'active' and pc.company_id <> all (v_skip_c)
            order by random()
            limit coalesce((cfg #>> '{company,count}')::integer, 2) loop
    v_scandal := random() * 10000 < coalesce((cfg #>> '{company,scandalShareBps}')::integer, 6000);
    v_dir := case when v_scandal then -1 else 1 end;
    v_aw := public.rand_between((cfg #>> '{company,awarenessMinBps}')::integer, (cfg #>> '{company,awarenessMaxBps}')::integer);
    v_bps := public.rand_between((cfg #>> '{company,stockMinBps}')::integer, (cfg #>> '{company,stockMaxBps}')::integer);
    v_effects := jsonb_build_array(jsonb_build_object(
      'label', 'Bekanntheit ' || case when v_scandal then '−' else '+' end || public.news_show_move(v_aw),
      'tone', case when v_scandal then 'loss' else 'gain' end));
    v_apply := jsonb_build_array(jsonb_build_object('type', 'company', 'company_id', r.company_id, 'awareness_bps', v_dir * v_aw,
                                                    'scandal', v_scandal));
    if r.security_id is not null then
      v_effects := v_effects || jsonb_build_object(
        'label', r.ticker || ' ' || case when v_scandal then '−' else '+' end || public.news_show_move(v_bps),
        'tone', case when v_scandal then 'loss' else 'gain' end);
      v_apply := v_apply || jsonb_build_object('type', 'stock', 'security_id', r.security_id, 'bps', v_dir * v_bps);
    end if;
    v_seg := public.news_show_segment(case when v_scandal then 'scandal' else 'hype' end,
      case when v_scandal then 'scandal' else 'hype' end,
      jsonb_build_object('company', r.name, 'idea', r.idea, 'founder', r.founder),
      v_effects, v_apply,
      jsonb_build_object('type', 'company', 'company_id', r.company_id, 'player_id', r.founder_id, 'name', r.name,
                         'idea', r.idea, 'founder', r.founder, 'sector', r.sector_key, 'scandal', v_scandal));
    if v_seg is not null then v_segs := v_segs || v_seg; end if;
  end loop;

  -- 3. listed stocks of the AI companies
  for r in select sec.id, sec.name, sec.ticker
             from public.securities sec join public.companies c on c.id = sec.company_id
            where sec.kind = 'stock' and sec.status = 'listed' and c.is_ai
            order by random()
            limit coalesce((cfg #>> '{stock,count}')::integer, 2) loop
    v_dir := case when random() < 0.5 then 1 else -1 end;
    v_bps := public.rand_between((cfg #>> '{stock,minBps}')::integer, (cfg #>> '{stock,maxBps}')::integer);
    v_seg := public.news_show_segment('stock', case when v_dir > 0 then 'stockUp' else 'stockDown' end,
      jsonb_build_object('stock', r.name, 'move', public.news_show_move(v_bps)),
      jsonb_build_array(jsonb_build_object('label', r.ticker || ' ' || case when v_dir > 0 then '+' else '−' end || public.news_show_move(v_bps),
                                           'tone', case when v_dir > 0 then 'gain' else 'loss' end)),
      jsonb_build_array(jsonb_build_object('type', 'stock', 'security_id', r.id, 'bps', v_dir * v_bps)),
      jsonb_build_object('type', 'stock', 'name', r.name, 'ticker', r.ticker, 'up', v_dir > 0));
    if v_seg is not null then v_segs := v_segs || v_seg; end if;
  end loop;

  -- 4. the world: a whole sector, or the value of open company tasks
  v_dir := case when random() < 0.5 then 1 else -1 end;
  if random() < 0.5 then
    select s.key, s.name into r from public.sectors s
     where exists (select 1 from public.securities sec where sec.sector_key = s.key and sec.kind = 'stock' and sec.status = 'listed')
     order by random() limit 1;
    if r.key is not null then
      v_bps := public.rand_between((cfg #>> '{sector,minBps}')::integer, (cfg #>> '{sector,maxBps}')::integer);
      v_seg := public.news_show_segment('sector', case when v_dir > 0 then 'sectorUp' else 'sectorDown' end,
        jsonb_build_object('sector', r.name, 'move', public.news_show_move(v_bps)),
        jsonb_build_array(jsonb_build_object('label', r.name || ' ' || case when v_dir > 0 then '+' else '−' end || public.news_show_move(v_bps),
                                             'tone', case when v_dir > 0 then 'gain' else 'loss' end)),
        jsonb_build_array(jsonb_build_object('type', 'sector', 'sector_key', r.key, 'bps', v_dir * v_bps)),
        jsonb_build_object('type', 'sector', 'name', r.name, 'up', v_dir > 0));
      if v_seg is not null then v_segs := v_segs || v_seg; end if;
    end if;
  else
    v_bps := public.rand_between((cfg #>> '{tasks,minBps}')::integer, (cfg #>> '{tasks,maxBps}')::integer);
    v_seg := public.news_show_segment('tasks', case when v_dir > 0 then 'tasksUp' else 'tasksDown' end,
      jsonb_build_object('move', public.news_show_move(v_bps)),
      jsonb_build_array(jsonb_build_object('label', 'Aufgaben ' || case when v_dir > 0 then '+' else '−' end || public.news_show_move(v_bps),
                                           'tone', case when v_dir > 0 then 'gain' else 'loss' end)),
      jsonb_build_array(jsonb_build_object('type', 'tasks', 'bps', v_dir * v_bps)),
      jsonb_build_object('type', 'tasks', 'up', v_dir > 0));
    if v_seg is not null then v_segs := v_segs || v_seg; end if;
  end if;

  -- 5. the winner of the day
  select w.entity_id as player_id, p.nickname, w.last_nw - w.first_nw as gain,
         ((w.last_nw - w.first_nw) * 10000 / w.first_nw)::integer as bps
    into r
    from (select l.entity_id, l.nw as last_nw, f.nw as first_nw
            from (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                   where entity_kind = 'player' and taken_at >= p_now - interval '45 minutes'
                   order by entity_id, taken_at desc) l
            join (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                   where entity_kind = 'player'
                     and taken_at >= p_now - make_interval(hours => coalesce((cfg #>> '{winner,windowHours}')::integer, 24))
                   order by entity_id, taken_at asc) f using (entity_id)
           where f.nw > 0) w
    join public.profiles p on p.id = w.entity_id
   where w.entity_id <> all (v_skip_p)
     and (w.last_nw - w.first_nw) * 10000 / w.first_nw >= coalesce((cfg #>> '{winner,minGainBps}')::integer, 300)
   order by (w.last_nw - w.first_nw) * 10000 / w.first_nw desc, random()
   limit 1;
  if r.player_id is not null then
    v_seg := public.news_show_segment('winner', 'winner',
      jsonb_build_object('name', r.nickname, 'amount', public.format_eur(r.gain), 'pct', public.news_show_move(r.bps)),
      '[]'::jsonb, '[]'::jsonb,
      jsonb_build_object('type', 'player', 'player_id', r.player_id, 'name', r.nickname));
    if v_seg is not null then v_segs := v_segs || v_seg; end if;
  end if;

  -- 6. the hint for the coming hour (settled by the stock news job, ADR-119)
  if public.config_jsonb('stockNews') is not null then
    select sec.id, sec.name, sec.ticker into r from public.securities sec
     where sec.kind = 'stock' and sec.status = 'listed'
       and not exists (select 1 from public.stock_tips x where x.security_id = sec.id and x.applied_at is null)
     order by random() limit 1;
    if r.id is not null then
      v_dir := case when random() < 0.5 then 1 else -1 end;
      v_bps := public.rand_between((cfg #>> '{tip,minBps}')::integer, (cfg #>> '{tip,maxBps}')::integer);
      v_tip := public.news_show_segment('tip', 'tip',
        jsonb_build_object('stock', r.name, 'move', cfg #>> array['tipWords', case when v_dir > 0 then 'up' else 'down' end]),
        jsonb_build_array(jsonb_build_object('label', r.ticker || ' ' || case when v_dir > 0 then '↑' else '↓' end || ' Tipp', 'tone', 'neutral')),
        jsonb_build_array(jsonb_build_object(
          'type', 'tip', 'security_id', r.id, 'direction', v_dir, 'bps', v_bps,
          'comes_true', random() * 10000 < coalesce((cfg #>> '{tip,reliabilityBps}')::integer, 7000),
          'lead_minutes', public.rand_between((cfg #>> '{tip,leadMinMinutes}')::integer, (cfg #>> '{tip,leadMaxMinutes}')::integer))),
        jsonb_build_object('type', 'tip', 'name', r.name, 'ticker', r.ticker, 'up', v_dir > 0));
    end if;
  end if;

  if jsonb_array_length(v_segs) = 0 and v_tip is null then
    v_seg := public.news_show_segment('world', 'filler', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '{"type": "filler"}'::jsonb);
    if v_seg is not null then v_segs := v_segs || v_seg; end if;
  end if;
  -- at most maxSegments, the hint always last
  if v_tip is not null then
    select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_segs
      from jsonb_array_elements(v_segs) with ordinality t(x, ord) where ord <= v_max - 1;
    v_segs := v_segs || v_tip;
  else
    select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_segs
      from jsonb_array_elements(v_segs) with ordinality t(x, ord) where ord <= v_max;
  end if;
  return v_segs;
end;
$$;
comment on function public.news_show_build(timestamptz) is
  'Internal: the draft of a news show (ADR-150): loser, player companies, AI stocks, sector or tasks, winner, hint.';

-- ---------------------------------------------------------------------------
-- Preparing, starting (with the effects), cancelling
-- ---------------------------------------------------------------------------
create or replace function public.news_show_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.news_show_cfg();
  v_now     timestamptz := coalesce(p_now, public.game_now());
  v_hour    timestamptz := date_trunc('hour', coalesce(p_now, public.game_now()));
  v_slot    timestamptz;
  v_made    integer := 0;
  v_gone    integer;
begin
  if cfg = '{}'::jsonb then
    return jsonb_build_object('skipped', 'no_config');
  end if;
  -- shows nobody came to
  update public.news_shows set status = 'cancelled'
   where status = 'scheduled' and airs_at + make_interval(mins => coalesce((cfg ->> 'waitMinutes')::integer, 10)) <= v_now;
  get diagnostics v_gone = row_count;
  -- the draft of the next show, a few minutes before the full hour (or still in time for this hour's)
  v_slot := case when v_now < v_hour + make_interval(mins => coalesce((cfg ->> 'waitMinutes')::integer, 10)) then v_hour
                 else v_hour + interval '1 hour' end;
  if v_slot - make_interval(mins => coalesce((cfg ->> 'prepareMinutes')::integer, 10)) <= v_now
     and not exists (select 1 from public.news_shows s where s.airs_at = v_slot) then
    perform pg_advisory_xact_lock(7311014);
    if not exists (select 1 from public.news_shows s where s.airs_at = v_slot) then
      insert into public.news_shows (airs_at, segments) values (v_slot, public.news_show_build(v_now));
      v_made := 1;
    end if;
  end if;
  delete from public.news_show_messages m
   where m.created_at < v_now - make_interval(hours => coalesce((cfg #>> '{chat,keepHours}')::integer, 24));
  delete from public.news_shows s where s.airs_at < v_now - interval '3 days';
  delete from public.news_show_viewers v where v.seen_at < v_now - interval '1 hour';
  return jsonb_build_object('prepared', v_made, 'cancelled', v_gone);
end;
$$;
comment on function public.news_show_run_due(timestamptz) is
  'Internal (cron nexa-news-show, every minute): drafts the next show, cancels shows without viewers, cleans up (ADR-150).';

-- The show starts: every effect applies now, once. Called from get_news_show() of the first viewer.
create or replace function public.news_show_start(p_show_id bigint, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.news_show_cfg();
  s       public.news_shows;
  seg     jsonb;
  a       jsonb;
  v_idx   integer := 0;
  v_house uuid := public.ledger_system_account('households');
  v_cash  bigint;
  v_news  bigint;
  v_sec   uuid;
  r       record;
begin
  select * into s from public.news_shows where id = p_show_id for update;
  if s.id is null or s.status <> 'scheduled' or p_now < s.airs_at
     or p_now >= s.airs_at + make_interval(mins => coalesce((cfg ->> 'waitMinutes')::integer, 10)) then
    return false;
  end if;
  for seg in select x from jsonb_array_elements(s.segments) x loop
    v_idx := v_idx + 1;
    v_sec := null;
    for a in select x from jsonb_array_elements(coalesce(seg -> 'apply', '[]'::jsonb)) x loop
      case a ->> 'type'
        when 'stock' then
          v_sec := (a ->> 'security_id')::uuid;
          if exists (select 1 from public.securities sec where sec.id = v_sec and sec.status = 'listed') then
            perform public.event_price_shock(v_sec, (a ->> 'bps')::integer, p_now);
          end if;
        when 'sector' then
          for r in select sec.id from public.securities sec
                    where sec.sector_key = a ->> 'sector_key' and sec.kind = 'stock' and sec.status = 'listed' loop
            perform public.event_price_shock(r.id, (a ->> 'bps')::integer, p_now);
          end loop;
        when 'company' then
          update public.player_companies pc
             set awareness = least(1, greatest(0.05, pc.awareness * (10000 + (a ->> 'awareness_bps')::numeric) / 10000)),
                 task_momentum = case when coalesce((a ->> 'scandal')::boolean, false)
                                      then greatest(1.0, 1.0 + (coalesce(pc.task_momentum, 1.0) - 1.0)
                                             * (1.0 - coalesce((cfg #>> '{company,momentumLossBps}')::numeric, 0) / 10000.0))
                                      else pc.task_momentum end
           where pc.company_id = (a ->> 'company_id')::uuid and pc.status = 'active';
        when 'tasks' then
          update public.company_tasks t
             set value_cents = greatest(100, (t.value_cents * (10000 + (a ->> 'bps')::bigint)) / 10000)
           where t.status in ('open', 'assigned');
        when 'cash' then
          select x.balance_cents into v_cash from public.ledger_accounts x where x.id = v_house for update;
          if coalesce(v_cash, 0) >= (a ->> 'cents')::bigint
             and exists (select 1 from public.profiles p where p.id = (a ->> 'player_id')::uuid) then
            perform public.ledger_transfer(v_house, public.ledger_player_account((a ->> 'player_id')::uuid, 'player_cash'),
                                           (a ->> 'cents')::bigint, 'random_event', 'NEXA Nachrichten: Trostpflaster',
                                           'player', (a ->> 'player_id')::uuid,
                                           'newsshow:' || s.id::text || ':' || v_idx::text, null,
                                           jsonb_build_object('show_id', s.id));
          end if;
        when 'tip' then
          v_sec := (a ->> 'security_id')::uuid;
          if exists (select 1 from public.securities sec where sec.id = v_sec and sec.status = 'listed')
             and not exists (select 1 from public.stock_tips x where x.security_id = v_sec and x.applied_at is null) then
            insert into public.news_items (category, headline, body, importance, security_id, published_at)
            values ('company', seg ->> 'headline', seg ->> 'text', 2, v_sec, p_now) returning id into v_news;
            insert into public.stock_tips (security_id, news_item_id, direction, move_bps, strength, comes_true, headline, body,
                                           published_at, due_at)
            values (v_sec, v_news, (a ->> 'direction')::smallint, (a ->> 'bps')::integer, 2, (a ->> 'comes_true')::boolean,
                    seg ->> 'headline', seg ->> 'text', p_now,
                    p_now + make_interval(mins => (a ->> 'lead_minutes')::integer));
          end if;
        else
          null;
      end case;
    end loop;
    -- the news feed keeps what was said (the hint wrote its own item above)
    if seg ->> 'kind' <> 'tip' then
      insert into public.news_items (category, headline, body, importance, security_id, published_at)
      values (case when seg ->> 'kind' in ('loser', 'winner') then 'player'
                   when seg ->> 'kind' in ('scandal', 'hype', 'stock') then 'company' else 'market' end::public.news_category,
              seg ->> 'headline', seg ->> 'text', 2, v_sec, p_now + make_interval(secs => v_idx));
    end if;
    -- whoever is talked about hears of it
    if seg -> 'subject' ? 'player_id'
       and exists (select 1 from public.profiles p where p.id = (seg -> 'subject' ->> 'player_id')::uuid) then
      perform public.social_notify((seg -> 'subject' ->> 'player_id')::uuid, 'news_show',
        'Mr. Doodle Dangle spricht über dich', seg ->> 'headline',
        jsonb_build_object('show_id', s.id, 'kind', seg ->> 'kind'), '/news',
        'news_show:' || s.id::text || ':' || v_idx::text);
    end if;
  end loop;
  update public.news_shows set status = 'aired', started_at = p_now where id = s.id;
  return true;
end;
$$;
comment on function public.news_show_start(bigint, timestamptz) is
  'Internal: starts a show for its first viewer and applies every effect once (ADR-150).';

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.news_show_chat_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nickname', m.nickname, 'body', m.body, 'at', m.created_at,
                                               'mine', m.player_id = p_player) order by m.id), '[]'::jsonb)
    from (select x.id, x.body, x.created_at, x.player_id, p.nickname
            from public.news_show_messages x join public.profiles p on p.id = x.player_id
           where x.created_at > public.game_now() - interval '75 minutes'
           order by x.id desc
           limit coalesce((public.news_show_cfg() #>> '{chat,history}')::integer, 60)) m;
$$;

create or replace function public.get_news_show()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.news_show_cfg();
  v_player uuid := public.require_player();
  v_now    timestamptz := public.game_now();
  v_hour   timestamptz := date_trunc('hour', public.game_now());
  v_wait   interval := make_interval(mins => coalesce((cfg ->> 'waitMinutes')::integer, 10));
  s        public.news_shows;
  u        public.news_shows;
begin
  -- I am watching
  insert into public.news_show_viewers (player_id, seen_at) values (v_player, v_now)
  on conflict (player_id) do update set seen_at = excluded.seen_at
   where public.news_show_viewers.seen_at < excluded.seen_at - interval '4 seconds';
  -- the draft may be missing when the job is late; this hour's show starts with its first viewer
  if not exists (select 1 from public.news_shows x
                  where x.airs_at = case when v_now < v_hour + v_wait then v_hour else v_hour + interval '1 hour' end) then
    perform public.news_show_run_due(v_now);
  end if;
  select * into u from public.news_shows x where x.airs_at = v_hour and x.status = 'scheduled';
  if u.id is not null and v_now < v_hour + v_wait then
    perform public.news_show_start(u.id, v_now);
  end if;
  -- the show to watch: the last one that aired, while it can be replayed
  select * into s from public.news_shows x
   where x.status = 'aired'
     and x.started_at > v_now - make_interval(mins => coalesce((cfg ->> 'replayMinutes')::integer, 55))
   order by x.airs_at desc limit 1;
  select * into u from public.news_shows x where x.status = 'scheduled' and x.airs_at > v_now order by x.airs_at limit 1;
  return jsonb_build_object(
    'now', v_now,
    'next_airs_at', coalesce(u.airs_at, v_hour + interval '1 hour'),
    'viewers', (select count(*) from public.news_show_viewers v where v.seen_at > v_now - interval '20 seconds'),
    'upcoming', case when u.id is null then null else jsonb_build_object(
                  'id', u.id, 'airs_at', u.airs_at,
                  'needs_script', u.writer = 'mini' and u.ai_requested_at is null) end,
    'show', case when s.id is null then null else jsonb_build_object(
              'id', s.id, 'airs_at', s.airs_at, 'started_at', s.started_at, 'writer', s.writer,
              'segments', coalesce((select jsonb_agg(jsonb_build_object('kind', x ->> 'kind', 'headline', x ->> 'headline',
                                                                        'text', x ->> 'text', 'effects', x -> 'effects')
                                                      order by ord)
                                      from jsonb_array_elements(s.segments) with ordinality t(x, ord)), '[]'::jsonb)) end,
    'chat', public.news_show_chat_json(v_player));
end;
$$;

create or replace function public.post_news_show_message(p_request_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.news_show_cfg();
  v_player uuid;
  v_replay jsonb;
  v_text   text := btrim(coalesce(p_body, ''));
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > coalesce((cfg #>> '{chat,maxLength}')::integer, 200)
     or v_text ~ '[\x00-\x08\x0b-\x1f]' or public.text_has_profanity(v_text) then
    perform public.api_error('chat_text_invalid');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'post_news_show_message');
  if v_replay is not null then
    return v_replay;
  end if;
  if (select count(*) from public.news_show_messages m
       where m.player_id = v_player and m.created_at > public.game_now() - interval '1 minute')
     >= coalesce((cfg #>> '{chat,perMinute}')::integer, 10) then
    perform public.api_error('rate_limited');
  end if;
  insert into public.news_show_messages (player_id, body, created_at) values (v_player, v_text, public.game_now());
  return public.request_complete(v_player, p_request_id, jsonb_build_object('chat', public.news_show_chat_json(v_player)));
end;
$$;

-- Claude polishes the draft (edge function news-anchor): one caller per show may ask
create or replace function public.news_show_claim_script(p_show_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_ok     boolean;
begin
  update public.news_shows set ai_requested_at = public.game_now()
   where id = p_show_id and status = 'scheduled' and writer = 'mini' and ai_requested_at is null
     and airs_at > public.game_now() + interval '20 seconds'
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.news_show_script_context(p_show_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'show_id', s.id, 'status', s.status, 'airs_at', s.airs_at,
    'segments', coalesce((select jsonb_agg(jsonb_build_object(
                             'kind', x ->> 'kind', 'headline', x ->> 'headline', 'text', x ->> 'text',
                             'effects', (select coalesce(jsonb_agg(e ->> 'label'), '[]'::jsonb) from jsonb_array_elements(x -> 'effects') e),
                             'facts', (x -> 'subject') - 'player_id' - 'company_id') order by ord)
                            from jsonb_array_elements(s.segments) with ordinality t(x, ord)), '[]'::jsonb))
    from public.news_shows s where s.id = p_show_id;
$$;

create or replace function public.store_news_show_script(p_show_id bigint, p_segments jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s      public.news_shows;
  v_new  jsonb;
begin
  select * into s from public.news_shows where id = p_show_id for update;
  if s.id is null or s.status <> 'scheduled' or jsonb_typeof(p_segments) <> 'array'
     or jsonb_array_length(p_segments) <> jsonb_array_length(s.segments) then
    return false;
  end if;
  if exists (select 1 from jsonb_array_elements(p_segments) x
              where not public.company_ai_text_ok(x ->> 'headline', 90, true)
                 or not public.company_ai_text_ok(x ->> 'text', 420, true)) then
    return false;
  end if;
  select jsonb_agg(o.x || jsonb_build_object('headline', btrim(n.x ->> 'headline'), 'text', btrim(n.x ->> 'text')) order by o.ord)
    into v_new
    from jsonb_array_elements(s.segments) with ordinality o(x, ord)
    join jsonb_array_elements(p_segments) with ordinality n(x, ord) using (ord);
  update public.news_shows set segments = v_new, writer = 'claude' where id = s.id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and the job
-- ---------------------------------------------------------------------------
revoke all on function public.news_show_cfg() from public, anon, authenticated;
revoke all on function public.news_show_move(integer) from public, anon, authenticated;
revoke all on function public.news_show_fill(text, jsonb) from public, anon, authenticated;
revoke all on function public.news_show_pick(text) from public, anon, authenticated;
revoke all on function public.news_show_segment(text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.news_show_build(timestamptz) from public, anon, authenticated;
revoke all on function public.news_show_run_due(timestamptz) from public, anon, authenticated;
revoke all on function public.news_show_start(bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.news_show_chat_json(uuid) from public, anon, authenticated;
revoke all on function public.news_show_script_context(bigint) from public, anon, authenticated;
revoke all on function public.store_news_show_script(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.news_show_run_due(timestamptz) to service_role;
grant execute on function public.news_show_script_context(bigint) to service_role;
grant execute on function public.store_news_show_script(bigint, jsonb) to service_role;
revoke all on function public.get_news_show() from public, anon;
revoke all on function public.post_news_show_message(uuid, text) from public, anon;
revoke all on function public.news_show_claim_script(bigint) from public, anon;
grant execute on function public.get_news_show() to authenticated;
grant execute on function public.post_news_show_message(uuid, text) to authenticated;
grant execute on function public.news_show_claim_script(bigint) to authenticated;
comment on function public.get_news_show() is
  'RPC: the live news show (ADR-150): next air time, viewers, the show of this hour once it started, the chat. '
  'Marks the caller as watching and starts this hour''s show for its first viewer.';
comment on function public.post_news_show_message(uuid, text) is
  'RPC: writes in the chat of the news show; errors chat_text_invalid (NX128), rate_limited (ADR-150).';
comment on function public.news_show_claim_script(bigint) is
  'RPC: true for the one caller who may ask Claude (edge function news-anchor) to polish a show''s draft (ADR-150).';

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-news-show';
    perform cron.schedule('nexa-news-show', '* * * * *', 'select public.news_show_run_due()');
  end if;
end;
$do$;
