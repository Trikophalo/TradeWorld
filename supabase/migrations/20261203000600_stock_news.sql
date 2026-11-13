-- =============================================================================
-- NEXA · 0600 · Stock news with a lead: hints that announce a price move (ADR-119)
-- =============================================================================
-- Every few minutes one listed stock gets a news item that points up or down ("Analysten erwarten ..."). After a
-- lead time the move happens (event_price_shock, as for announced events), or the hint fizzles: most hints come
-- true, not all. Players who read the news can position themselves before the move.
--
-- stock_tips (internal, no client rights): the hidden plan per hint.
-- stock_news_run_due(p_now) (internal, cron every minute): settles due hints, publishes a new one when it is time.
-- get_stock_news(p_limit) (authenticated) -> {"items": [STOCK_NEWS], "reliability_bps"}
--   STOCK_NEWS = {"id", "ticker", "name", "headline", "body", "direction": "up"|"down", "strength": 1..3,
--                 "published_at", "due_at", "status": "open"|"confirmed"|"fizzled", "move_bps": integer|null}
--   move_bps is only told once a hint is settled.
-- Values: game_config.stockNews (everyMinutes, leadMinMinutes, leadMaxMinutes, minMoveBps, maxMoveBps,
-- reliabilityBps, keepHours); enabled only while the key exists, so older configs publish nothing.
-- Idempotent: runs unchanged as supabase/updates/20261203000600_stock_news.sql.

create table if not exists public.stock_tips (
  id            bigint generated always as identity primary key,
  security_id   uuid not null references public.securities (id) on delete cascade,
  news_item_id  bigint references public.news_items (id) on delete set null,
  result_news_id bigint references public.news_items (id) on delete set null,
  direction     smallint not null check (direction in (-1, 1)),
  move_bps      integer not null check (move_bps > 0),
  strength      smallint not null check (strength between 1 and 3),
  comes_true    boolean not null,
  headline      text not null,
  body          text not null,
  published_at  timestamptz not null default now(),
  due_at        timestamptz not null,
  applied_at    timestamptz
);
alter table public.stock_tips enable row level security;
create index if not exists stock_tips_published_idx on public.stock_tips (published_at desc);
create index if not exists stock_tips_open_idx on public.stock_tips (due_at) where applied_at is null;
create index if not exists stock_tips_security_idx on public.stock_tips (security_id);
create index if not exists stock_tips_news_idx on public.stock_tips (news_item_id);
create index if not exists stock_tips_result_news_idx on public.stock_tips (result_news_id);
comment on table public.stock_tips is 'Stock news with a lead (ADR-119): the hidden plan per hint. Internal; read through get_stock_news().';
revoke all on public.stock_tips from public, anon, authenticated;

create or replace function public.stock_news_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg      jsonb := public.config_jsonb('stockNews');
  v_now      timestamptz := coalesce(p_now, public.game_now());
  v_every    double precision;
  v_lead_min double precision;
  v_lead_max double precision;
  v_min      integer;
  v_max      integer;
  v_rel      integer;
  v_settled  integer := 0;
  v_new      integer := 0;
  t          public.stock_tips;
  s          record;
  v_dir      smallint;
  v_move     integer;
  v_strength smallint;
  v_head     text;
  v_body     text;
  v_news     bigint;
  v_up       text[] := array[
    'Analysten heben den Daumen für {name}', '{name}: Großauftrag in Sicht', 'Gerücht: {name} steht vor starken Zahlen',
    '{name} gewinnt neue Kunden', 'Insider rechnen bei {name} mit Rückenwind'];
  v_down     text[] := array[
    'Analysten warnen vor {name}', '{name}: Lieferprobleme befürchtet', 'Gerücht: {name} verfehlt die Erwartungen',
    '{name} verliert einen wichtigen Kunden', 'Gegenwind für {name} erwartet'];
  v_words    text[] := array['leicht', 'spürbar', 'deutlich'];
begin
  if v_cfg is null or jsonb_typeof(v_cfg) <> 'object' then
    return jsonb_build_object('skipped', 'no_config');
  end if;
  -- same lock as the minute job: never beside a running tick
  perform pg_advisory_xact_lock(7311001);
  v_every    := greatest(1, public.cfg_num(v_cfg, '{everyMinutes}', 12));
  v_lead_min := greatest(1, public.cfg_num(v_cfg, '{leadMinMinutes}', 10));
  v_lead_max := greatest(v_lead_min, public.cfg_num(v_cfg, '{leadMaxMinutes}', 40));
  v_min      := greatest(1, public.cfg_num(v_cfg, '{minMoveBps}', 300))::integer;
  v_max      := greatest(v_min, public.cfg_num(v_cfg, '{maxMoveBps}', 1200)::integer);
  v_rel      := least(10000, greatest(0, public.cfg_num(v_cfg, '{reliabilityBps}', 7500)))::integer;

  -- 1. hints whose time has come
  for t in select * from public.stock_tips x where x.applied_at is null and x.due_at <= v_now order by x.due_at for update loop
    select sec.name, sec.status into s from public.securities sec where sec.id = t.security_id;
    if t.comes_true and s.status = 'listed' then
      perform public.event_price_shock(t.security_id, t.direction * t.move_bps, v_now);
      v_head := case when t.direction > 0 then s.name || ' legt zu: Die Erwartungen haben sich bestätigt'
                     else s.name || ' gibt nach: Die Warnungen haben sich bestätigt' end;
    else
      v_head := 'Entwarnung bei ' || s.name || ': Die Meldung hat sich nicht bestätigt';
    end if;
    insert into public.news_items (category, headline, body, importance, security_id, published_at)
    values ('company', v_head, null, 1, t.security_id, v_now) returning id into v_news;
    update public.stock_tips set applied_at = v_now, result_news_id = v_news where id = t.id;
    v_settled := v_settled + 1;
  end loop;

  -- 2. a new hint when the last one is old enough
  if not exists (select 1 from public.stock_tips x where x.published_at > v_now - make_interval(secs => v_every * 60 - 5)) then
    select sec.id, sec.name into s
      from public.securities sec
     where sec.kind = 'stock' and sec.status = 'listed'
       and not exists (select 1 from public.stock_tips x where x.security_id = sec.id and x.applied_at is null)
     order by random() limit 1;
    if s.id is not null then
      v_dir := case when random() < 0.5 then 1 else -1 end;
      v_move := v_min + floor(random() * (v_max - v_min + 1))::integer;
      v_strength := least(3, 1 + floor(3.0 * (v_move - v_min) / greatest(1, v_max - v_min + 1)))::smallint;
      v_head := replace(case when v_dir > 0 then v_up[1 + floor(random() * array_length(v_up, 1))::integer]
                             else v_down[1 + floor(random() * array_length(v_down, 1))::integer] end, '{name}', s.name);
      v_body := case when v_dir > 0 then 'Beobachter rechnen in Kürze mit einem ' || v_words[v_strength] || ' steigenden Kurs.'
                     else 'Beobachter rechnen in Kürze mit einem ' || v_words[v_strength] || ' fallenden Kurs.' end
                || ' Sicher ist das nicht.';
      insert into public.news_items (category, headline, body, importance, security_id, published_at)
      values ('company', v_head, v_body, v_strength, s.id, v_now) returning id into v_news;
      insert into public.stock_tips (security_id, news_item_id, direction, move_bps, strength, comes_true, headline, body,
                                     published_at, due_at)
      values (s.id, v_news, v_dir, v_move, v_strength, random() * 10000 < v_rel, v_head, v_body, v_now,
              v_now + make_interval(secs => 60 * (v_lead_min + random() * (v_lead_max - v_lead_min))));
      v_new := 1;
    end if;
  end if;

  delete from public.stock_tips x
   where x.applied_at is not null
     and x.published_at < v_now - make_interval(hours => greatest(1, public.cfg_num(v_cfg, '{keepHours}', 24))::integer);
  return jsonb_build_object('settled', v_settled, 'published', v_new);
end;
$$;
comment on function public.stock_news_run_due(timestamptz) is
  'Internal, cron every minute (ADR-119): settles due stock hints and publishes a new one when it is time.';

create or replace function public.get_stock_news(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  v_player := public.require_player();
  return jsonb_build_object(
    'reliability_bps', least(10000, greatest(0, public.config_double('stockNews', '{reliabilityBps}', 7500)))::integer,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'ticker', s.ticker, 'name', s.name, 'headline', x.headline, 'body', x.body,
               'direction', case when x.direction > 0 then 'up' else 'down' end, 'strength', x.strength,
               'published_at', x.published_at, 'due_at', x.due_at,
               'status', case when x.applied_at is null then 'open' when x.comes_true then 'confirmed' else 'fizzled' end,
               'move_bps', case when x.applied_at is not null and x.comes_true then x.direction * x.move_bps end)
             order by x.published_at desc, x.id desc)
        from (select t.* from public.stock_tips t order by t.published_at desc, t.id desc
               limit least(50, greatest(1, coalesce(p_limit, 20)))) x
        join public.securities s on s.id = x.security_id), '[]'::jsonb));
end;
$$;
comment on function public.get_stock_news(integer) is 'RPC: the latest stock hints with their state (ADR-119).';

revoke all on function public.stock_news_run_due(timestamptz) from public, anon, authenticated;
grant execute on function public.stock_news_run_due(timestamptz) to service_role;
revoke all on function public.get_stock_news(integer) from public, anon;
grant execute on function public.get_stock_news(integer) to authenticated, service_role;

-- Its own cron job, so the minute job stays short. Skipped where pg_cron is not installed (local tests).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'nexa-stock-news') then
      perform cron.unschedule('nexa-stock-news');
    end if;
    perform cron.schedule('nexa-stock-news', '* * * * *', 'select public.stock_news_run_due()');
  end if;
end;
$$;
