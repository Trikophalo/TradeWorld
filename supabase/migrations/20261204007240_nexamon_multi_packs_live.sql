-- =============================================================================
-- NEXA · 7240 · Nexamon: several packs at once, live openings that go on (ADR-182)
-- =============================================================================
-- * buy_nexamon_packs(p_request_id, p_set, p_count): 1 to packs.maxPerBuy packs of a set in one call. Every pack
--   goes through buy_nexamon_pack() with its own request id derived from p_request_id (payment, pulls, missions,
--   rate limit packs.perMinute per pack), all or nothing; the answer lists the packs in order and is idempotent.
-- * A live opening goes on (live.continueSeconds): a player's next pack (bought, sealed or from a multi-buy) that
--   starts while their pack session runs or at most continueSeconds after it ended joins that session instead of
--   starting a new one. If the shown pack is fully revealed, the session switches to the new pack at once
--   (pack_no + 1); otherwise the pack waits in nexamon_live.queue and the session switches when the opener reports
--   a card of it (nexamon_live_progress) or, without reports, when the shown pack is fully revealed by the fallback
--   pace and live.lingerMs passed (get_nexamon_live). Spectators keep their live id and their viewer row.
-- * get_nexamon_live() answers pack_no in addition.
-- Idempotent: runs unchanged as supabase/updates/20261204007240_nexamon_multi_packs_live.sql.

alter table public.nexamon_live add column if not exists pack_no integer not null default 1;
alter table public.nexamon_live add column if not exists queue jsonb not null default '[]'::jsonb;
comment on column public.nexamon_live.pack_no is 'Which pack of a continued live opening is shown (1 = the first; ADR-182).';
comment on column public.nexamon_live.queue is
  'Packs of the same player waiting in a continued live opening: [{pack_id, set, cards}] in order (ADR-182).';

-- How long one pack of a live opening lasts without reports (staleMs + every card at the fallback pace + lingerMs)
create or replace function public.nexamon_live_pack_ms()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((c #>> '{live,staleMs}')::numeric, 10000)
         + coalesce((c ->> 'packSize')::numeric, 5) * coalesce((c #>> '{live,fallbackSlotMs}')::numeric, 2500)
         + coalesce((c #>> '{live,lingerMs}')::numeric, 8000)
    from (select public.nexamon_cfg() as c) x;
$$;

-- Switches a continued live opening to the queued pack p_pack (and drops the queued packs before it)
create or replace function public.nexamon_live_promote(p_live uuid, p_pack uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l     public.nexamon_live;
  v_idx integer;
  v_q   jsonb;
begin
  select * into l from public.nexamon_live x where x.id = p_live for update;
  select o - 1 into v_idx from jsonb_array_elements(l.queue) with ordinality as e(x, o) where x ->> 'pack_id' = p_pack::text;
  if v_idx is null then
    return;
  end if;
  v_q := l.queue -> v_idx;
  update public.nexamon_live
     set pack_id = p_pack, set_key = v_q ->> 'set', cards = v_q -> 'cards', progress = 0, progress_at = null,
         started_at = p_now, pack_no = l.pack_no + v_idx + 1,
         queue = coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(l.queue) with ordinality as e(x, o)
                            where o > v_idx + 1), '[]'::jsonb),
         ends_at = greatest(l.ends_at, p_now + public.nexamon_ms(public.nexamon_live_pack_ms()))
   where id = l.id;
end;
$$;
revoke all on function public.nexamon_live_promote(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.nexamon_live_pack_ms() from public, anon, authenticated;

-- A bought pack becomes a live opening, unless the opener does not want spectators; a pack right after the last one
-- continues that session (ADR-182)
create or replace function public.nexamon_pack_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg    jsonb := public.nexamon_cfg();
  v_size integer := coalesce((public.nexamon_cfg() ->> 'packSize')::integer, 5);
  v_ms   numeric := public.nexamon_live_pack_ms();
  l      public.nexamon_live;
begin
  if not coalesce((select x.allow_watch from public.nexamon_presence x where x.player_id = new.player_id), true) then
    return new;
  end if;
  select * into l from public.nexamon_live x
   where x.player_id = new.player_id and x.kind = 'pack' and x.started_at <= new.opened_at
     and x.ends_at > new.opened_at - make_interval(secs => coalesce((cfg #>> '{live,continueSeconds}')::integer, 30))
   order by x.started_at desc limit 1
   for update;
  if l.id is null then
    insert into public.nexamon_live (player_id, kind, pack_id, set_key, cards, started_at, ends_at)
    values (new.player_id, 'pack', new.id, new.set_key, new.cards, new.opened_at, new.opened_at + public.nexamon_ms(v_ms))
    on conflict (pack_id) do nothing;
  elsif jsonb_array_length(l.queue) = 0 and (l.progress >= v_size or l.ends_at <= new.opened_at) then
    -- the shown pack is over: the session shows the new one at once
    update public.nexamon_live
       set pack_id = new.id, set_key = new.set_key, cards = new.cards, progress = 0, progress_at = null,
           started_at = new.opened_at, pack_no = l.pack_no + 1, ends_at = new.opened_at + public.nexamon_ms(v_ms)
     where id = l.id;
  else
    update public.nexamon_live
       set queue = l.queue || jsonb_build_array(jsonb_build_object('pack_id', new.id, 'set', new.set_key, 'cards', new.cards)),
           ends_at = greatest(l.ends_at, new.opened_at + public.nexamon_ms(v_ms * (jsonb_array_length(l.queue) + 2)))
     where id = l.id;
  end if;
  return new;
end;
$$;

create or replace function public.nexamon_live_progress(p_pack_id uuid, p_revealed integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_now    timestamptz := public.game_now();
  l        public.nexamon_live;
begin
  v_player := public.require_player();
  if p_pack_id is null or p_revealed is null then
    perform public.api_error('invalid_argument');
  end if;
  select * into l from public.nexamon_live x where x.pack_id = p_pack_id and x.player_id = v_player for update;
  if l.id is null then
    -- the opener moved on to a pack that waits in their continued session: it is shown now (ADR-182)
    select * into l from public.nexamon_live x
     where x.player_id = v_player and x.kind = 'pack' and x.queue @> jsonb_build_array(jsonb_build_object('pack_id', p_pack_id::text))
     for update;
    if l.id is not null then
      perform public.nexamon_live_promote(l.id, p_pack_id, v_now);
      select * into l from public.nexamon_live x where x.id = l.id;
    end if;
  end if;
  if l.id is null then
    -- watching is off, or the pack is not the caller's: nothing to report, nobody watches
    return jsonb_build_object('live_id', null, 'viewers', 0, 'reactions', '[]'::jsonb);
  end if;
  if greatest(0, least(coalesce((cfg ->> 'packSize')::integer, 5), p_revealed)) > l.progress then
    update public.nexamon_live
       set progress = greatest(0, least(coalesce((cfg ->> 'packSize')::integer, 5), p_revealed)), progress_at = v_now,
           ends_at = least(started_at + public.nexamon_ms(coalesce((cfg #>> '{live,maxMs}')::numeric, 120000)),
                           greatest(ends_at, v_now + public.nexamon_ms(coalesce((cfg #>> '{live,lingerMs}')::numeric, 8000))))
     where id = l.id;
  elsif l.progress_at is null or l.progress_at < v_now - interval '2 seconds' then
    -- the opener still looks at the card: the fallback pace waits
    update public.nexamon_live set progress_at = v_now where id = l.id;
  end if;
  return jsonb_build_object('live_id', l.id, 'viewers', public.nexamon_live_viewer_count(l.id, v_now),
                            'reactions', public.nexamon_live_reactions_json(l.id, v_now));
end;
$$;
comment on function public.nexamon_live_progress(uuid, integer) is
  'RPC (live opening, ADR-172, ADR-182): the opener''s page reports how many cards of a bought pack it has shown; a '
  'pack waiting in the continued session becomes the shown one. Returns {live_id, viewers, reactions}; without a live '
  'opening (watching off) live_id is null. Errors invalid_argument.';

create or replace function public.get_nexamon_live(p_live_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_now    timestamptz := public.game_now();
  l        public.nexamon_live;
  v_n      integer;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  select * into l from public.nexamon_live x where x.id = p_live_id;
  if l.id is null or l.started_at > v_now then
    perform public.api_error('nexamon_live_unknown');
  end if;
  -- a waiting pack of a silent opener follows once the shown one is out and lingered (ADR-182)
  if jsonb_array_length(l.queue) > 0
     and public.nexamon_live_visible(l, v_now) >= coalesce((cfg ->> 'packSize')::integer, 5)
     and coalesce(l.progress_at, l.started_at) + public.nexamon_ms(public.nexamon_live_pack_ms()) <= v_now then
    perform public.nexamon_live_promote(l.id, (l.queue -> 0 ->> 'pack_id')::uuid, v_now);
    select * into l from public.nexamon_live x where x.id = p_live_id;
  end if;
  if l.player_id <> v_player and l.ends_at > v_now then
    insert into public.nexamon_live_viewers (live_id, player_id, seen_at) values (l.id, v_player, v_now)
    on conflict (live_id, player_id) do update set seen_at = excluded.seen_at;
  end if;
  v_n := case when l.player_id = v_player or l.ends_at <= v_now then coalesce(jsonb_array_length(l.cards), 0)
              else public.nexamon_live_visible(l, v_now) end;
  return public.nexamon_live_row_json(l, v_player, v_now) || jsonb_build_object(
    'pack_no', l.pack_no,
    'progress', v_n,
    'cards', case when l.kind = 'pack'
                  then coalesce((select jsonb_agg(jsonb_build_object('slot', (x ->> 'slot')::integer, 'card_key', x ->> 'card_key',
                                                                     'rarity', x ->> 'rarity', 'condition', x ->> 'condition',
                                                                     'serial', (x ->> 'serial')::bigint,
                                                                     'value_cents', (x ->> 'value_cents')::bigint)
                                                  order by (x ->> 'slot')::integer)
                                   from jsonb_array_elements(l.cards) x where (x ->> 'slot')::integer <= v_n), '[]'::jsonb)
                  else '[]'::jsonb end,
    'done', l.ends_at <= v_now,
    'reactions', public.nexamon_live_reactions_json(l.id, v_now),
    'server_time', v_now);
end;
$$;
comment on function public.get_nexamon_live(uuid) is
  'RPC (spectating, ADR-172, ADR-182): one live opening with the cards the opener has already seen (fallback pace after '
  'live.staleMs), which pack of a continued session it is (pack_no), viewers and recent reactions; counts the caller '
  'as a viewer. Errors nexamon_locked, nexamon_live_unknown.';

-- Several packs of one set in one call (ADR-182)
create or replace function public.buy_nexamon_packs(p_request_id uuid, p_set text, p_count integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_packs  jsonb := '[]'::jsonb;
  v_one    jsonb;
  v_total  bigint := 0;
  i        integer;
begin
  v_player := public.require_player();
  if p_request_id is null or p_set is null or p_count is null or p_count < 1
     or p_count > coalesce((public.nexamon_cfg() #>> '{packs,maxPerBuy}')::integer, 10) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_nexamon_packs');
  if v_replay is not null then
    return v_replay;
  end if;
  for i in 1 .. p_count loop
    v_one := public.buy_nexamon_pack(md5(p_request_id::text || ':pack:' || i)::uuid, p_set);
    v_packs := v_packs || jsonb_build_array(v_one);
    v_total := v_total + coalesce((v_one ->> 'price_cents')::bigint, 0);
  end loop;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'set', p_set, 'count', p_count, 'price_cents', v_total, 'packs', v_packs));
end;
$$;
comment on function public.buy_nexamon_packs(uuid, text, integer) is
  'RPC: buys 1..packs.maxPerBuy booster packs of a set at once (ADR-182), each like buy_nexamon_pack (payment, pulls, '
  'rate limit), all or nothing -> {set, count, price_cents, packs: [buy_nexamon_pack answers in order]}; idempotent. '
  'Errors as buy_nexamon_pack and invalid_argument.';
do $do$
begin
  revoke all on function public.buy_nexamon_packs(uuid, text, integer) from public, anon;
  grant execute on function public.buy_nexamon_packs(uuid, text, integer) to authenticated;
end;
$do$;

-- =============================================================================
-- Release times (ADR-182): a set with sets.<set>.releaseAt cannot be opened, bought, sealed or battled before it
-- (error nexamon_set_not_released NX310); AI packs of it pull nothing and the AI gets no starting stock of it before.
-- =============================================================================
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
  v_old text := $q$    when 'nexamon_ai_excluded'        then 'NX271'
$q$;
begin
  if position('''nexamon_set_not_released''' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the error key nexamon_set_not_released (ADR-182) by hand';
    end if;
    execute replace(v_def, v_old, v_old || $q$    when 'nexamon_set_not_released'   then 'NX310'
$q$);
  end if;
end;
$do$;

create or replace function public.nexamon_set_released(p_set text, p_now timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.nexamon_cfg() #>> array['sets', p_set, 'releaseAt'])::timestamptz <= p_now, true);
$$;
comment on function public.nexamon_set_released(text, timestamptz) is
  'Internal: whether a Nexamon set is out at p_now (sets.<set>.releaseAt, none = always; ADR-182).';

do $do$
declare
  v_fn   text;
  v_def  text;
  v_old  text := $t$  if v_price is null or v_price < 0 or not exists (select 1 from public.nexamon_cards k where k.set_key = p_set and k.in_catalogue) then
    perform public.api_error('nexamon_unknown');
  end if;$t$;
  v_new  text := $t$  if v_price is null or v_price < 0 or not exists (select 1 from public.nexamon_cards k where k.set_key = p_set and k.in_catalogue) then
    perform public.api_error('nexamon_unknown');
  end if;
  if not public.nexamon_set_released(p_set, public.game_now()) then
    perform public.api_error('nexamon_set_not_released');
  end if;$t$;
begin
  foreach v_fn in array array[
    'public.buy_nexamon_pack(uuid, text)', 'public.buy_nexamon_sealed_pack(uuid, text, integer)',
    'public.challenge_nexamon_battle(uuid, text, text)'
  ] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    if position('nexamon_set_not_released' in v_def) = 0 then
      if position(v_old in v_def) = 0 then
        raise exception '% has an unexpected shape; refuse unreleased sets (ADR-182) by hand', v_fn;
      end if;
      execute replace(v_def, v_old, v_new);
    end if;
  end loop;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.nexamon_open_pack(text, uuid, text, uuid, timestamptz)'::regprocedure);
  v_old text := $t$begin
  -- a set's own tier rule$t$;
  v_new text := $t$begin
  -- a set before its release (ADR-182): an AI pack pulls nothing, a player's pack is refused
  if not public.nexamon_set_released(p_set, p_now) then
    if p_owner is null then
      return '[]'::jsonb;
    end if;
    perform public.api_error('nexamon_set_not_released');
  end if;
  -- a set's own tier rule$t$;
begin
  if position('nexamon_set_released' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'nexamon_open_pack() has an unexpected shape; refuse unreleased sets (ADR-182) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

do $do$
declare
  v_def  text := pg_get_functiondef('public.nexamon_grant_sealed_packs(uuid, text, integer, text, bigint, bigint)'::regprocedure);
  v_old1 text := $t$     or public.nexamon_cfg() #> array['sets', p_set] is null then$t$;
  v_new1 text := $t$     or public.nexamon_cfg() #> array['sets', p_set] is null
     or not public.nexamon_set_released(p_set, public.game_now()) then$t$;
  v_def2 text := pg_get_functiondef('public.nexamon_sync(timestamptz)'::regprocedure);
  v_old2 text := $t$from public.nexamon_cards k where not k.seeded and k.in_catalogue order by k.set_key, k.number loop$t$;
  v_new2 text := $t$from public.nexamon_cards k where not k.seeded and k.in_catalogue
                and public.nexamon_set_released(k.set_key, v_now) order by k.set_key, k.number loop$t$;
  v_old3 text := $t$|| coalesce((cfg -> 'sets')::text, '') || v_names::text);$t$;
  v_new3 text := $t$|| coalesce((cfg -> 'sets')::text, '') || v_names::text
                || coalesce((select string_agg(s.key, ',' order by s.key) from jsonb_each(coalesce(cfg -> 'sets', '{}'::jsonb)) s
                              where public.nexamon_set_released(s.key, v_now)), ''));$t$;
begin
  if position('nexamon_set_released' in v_def) = 0 then
    if position(v_old1 in v_def) = 0 then
      raise exception 'nexamon_grant_sealed_packs() has an unexpected shape; refuse unreleased sets (ADR-182) by hand';
    end if;
    execute replace(v_def, v_old1, v_new1);
  end if;
  if position('nexamon_set_released' in v_def2) = 0 then
    if position(v_old2 in v_def2) = 0 or position(v_old3 in v_def2) = 0 then
      raise exception 'nexamon_sync() has an unexpected shape; seed unreleased sets later (ADR-182) by hand';
    end if;
    -- the hash also covers which sets are out, so the first sync after a release seeds the new set
    execute replace(replace(v_def2, v_old2, v_new2), v_old3, v_new3);
  end if;
end;
$do$;

-- =============================================================================
-- News show: Mr. Doodle Dangle announces new sets (ADR-182, newsShow.announcements)
-- =============================================================================
-- Exactly one show carries an announcement: the one whose air slot (the full hour of p_now + 30 minutes, so a
-- draft written ten minutes early or a late restart count for their hour) equals the announcement's `at`. It opens
-- with one segment per announced set (kind "release", ord 1): headline and text from the config, "{time}" =
-- releaseAt in Berlin time, and `nexamon` {set, card_key} for the studio TV (the pack and a highlight card).
-- news_announcements_aired remembers the slot an announcement went into: a rebuilt show of that slot gets it again
-- (it replaces the draft), every other slot never. Claude's rewrite keeps the segments as drafted.
create table if not exists public.news_announcements_aired (
  announcement_at timestamptz primary key,
  slot            timestamptz not null,
  first_at        timestamptz not null default now()
);
alter table public.news_announcements_aired enable row level security;
revoke all on public.news_announcements_aired from public, anon, authenticated;
comment on table public.news_announcements_aired is
  'The show slot every newsShow.announcements entry went into (ADR-182): it airs in that slot only. Server only.';

create or replace function public.news_show_announcements(p_now timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a      jsonb;
  s      jsonb;
  v_at   timestamptz;
  v_slot timestamptz := date_trunc('hour', p_now + interval '30 minutes');
  v_had  timestamptz;
  v_out  jsonb := '[]'::jsonb;
begin
  for a in select x from jsonb_array_elements(coalesce(public.news_show_cfg() -> 'announcements', '[]'::jsonb)) x loop
    v_at := (a ->> 'at')::timestamptz;
    continue when v_at is null or v_slot < v_at or v_slot >= v_at + interval '1 hour';
    insert into public.news_announcements_aired (announcement_at, slot, first_at) values (v_at, v_slot, p_now)
    on conflict (announcement_at) do nothing;
    select x.slot into v_had from public.news_announcements_aired x where x.announcement_at = v_at;
    continue when v_had is distinct from v_slot;
    for s in select y from jsonb_array_elements(coalesce(a -> 'sets', '[]'::jsonb)) y loop
      v_out := v_out || jsonb_build_object(
        'kind', 'release',
        'mood', case when s ->> 'mood' in ('neutral', 'shocked', 'crying', 'laughing', 'angry', 'smug', 'confused', 'proud')
                     then s ->> 'mood' else 'proud' end,
        'headline', left(coalesce(s ->> 'headline', ''), 90),
        'text', replace(coalesce(s ->> 'text', ''), '{time}',
                        to_char(((a ->> 'releaseAt')::timestamptz) at time zone 'Europe/Berlin', 'HH24:MI')),
        'effects', '[]'::jsonb,
        'apply', '[]'::jsonb,
        'subject', jsonb_build_object('type', 'release', 'set', s ->> 'set'),
        'nexamon', jsonb_build_object('set', s ->> 'set', 'card_key', s ->> 'cardKey'),
        'ord', 1);
    end loop;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.news_show_announcements(timestamptz) from public, anon, authenticated;

do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure);
  v_old text := $t$  v_segs := v_segs || public.news_show_interviews(p_now);$t$;
begin
  if position('news_show_announcements' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'news_show_build() has an unexpected shape; add the call of news_show_announcements() (ADR-182) by hand';
    end if;
    execute replace(v_def, v_old, $t$  -- announcements of new Nexamon sets (ADR-182): first in the show
  v_segs := v_segs || public.news_show_announcements(p_now);
$t$ || v_old);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.store_news_show_script(bigint, jsonb)'::regprocedure);
  v_old text := $t$case when o.x ->> 'kind' = 'gag' then o.x else n.x end$t$;
  v_new text := $t$case when o.x ->> 'kind' in ('gag', 'release') then o.x else n.x end$t$;
begin
  if position(v_new in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'store_news_show_script() has an unexpected shape; keep release segments (ADR-182) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
