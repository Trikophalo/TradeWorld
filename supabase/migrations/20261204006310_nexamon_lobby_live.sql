-- =============================================================================
-- NEXA · 6310 · Nexamon: who is on the Collectibles tab, live openings and spectators (ADR-172)
-- =============================================================================
-- * nexamon_lobby(p_allow_watch): the Collectibles page asks every presence.pingSeconds. It marks the caller as on
--   the tab (presence only, no game state: no request id, like last_active_at) and returns the friends on the tab as
--   figures (nickname, level, avatar_key, accessories, opening, battling), the running live openings, the caller's
--   open and running Pack Battles and the battle limits.
-- * Every bought pack is a live opening (trigger on nexamon_packs) unless the opener switched watching off. The
--   opener's page reports each card as it shows: nexamon_live_progress(p_pack_id, p_revealed) -> viewers, reactions.
-- * get_nexamon_live(p_live_id): a spectator's view (counts them as a viewer): only the cards the opener has seen,
--   after live.staleMs of silence one more every live.fallbackSlotMs (liveVisibleCards).
-- * nexamon_live_react(p_request_id, p_live_id, p_emoji): an emoji burst (live.reactions, live.reactionsPerMinute).
-- Errors: nexamon_locked, invalid_argument, nexamon_live_unknown, rate_limited.
-- Idempotent: runs unchanged as supabase/updates/20261204006310_nexamon_lobby_live.sql.

create or replace function public.nexamon_ms(p_ms numeric)
returns interval
language sql
immutable
set search_path = ''
as $$
  select make_interval(secs => coalesce(p_ms, 0) / 1000.0);
$$;

-- A player as a figure on the tab: name, level, portrait and worn accessories
create or replace function public.nexamon_figure_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('nickname', p.nickname, 'level', p.level, 'avatar_key', p.avatar_key,
                            'accessories', public.player_worn_accessories(p.id))
    from public.profiles p where p.id = p_player;
$$;

create or replace function public.nexamon_on_tab(p_player uuid, p_now timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.nexamon_presence x
                  where x.player_id = p_player
                    and x.seen_at > p_now - make_interval(secs => coalesce((public.nexamon_cfg() #>> '{presence,presenceSeconds}')::integer, 60)));
$$;

-- How many cards of a live pack a spectator may see at p_now (liveVisibleCards)
create or replace function public.nexamon_live_visible(l public.nexamon_live, p_now timestamptz)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_size   integer := coalesce((cfg ->> 'packSize')::integer, 5);
  v_silent numeric;
  v_extra  integer := 0;
begin
  v_silent := extract(epoch from (p_now - coalesce(l.progress_at, l.started_at))) * 1000
              - coalesce((cfg #>> '{live,staleMs}')::numeric, 10000);
  if v_silent >= 0 then
    v_extra := floor(v_silent / greatest(1, coalesce((cfg #>> '{live,fallbackSlotMs}')::numeric, 2500)))::integer + 1;
  end if;
  return greatest(0, least(v_size, l.progress + v_extra));
end;
$$;

create or replace function public.nexamon_live_viewer_count(p_live uuid, p_now timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.nexamon_live_viewers v
   where v.live_id = p_live
     and v.seen_at > p_now - make_interval(secs => coalesce((public.nexamon_cfg() #>> '{live,viewerSeconds}')::integer, 10));
$$;

create or replace function public.nexamon_live_reactions_json(p_live uuid, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'emoji', r.emoji, 'at', r.at) order by r.id), '[]'::jsonb)
    from (select * from public.nexamon_live_reactions x
           where x.live_id = p_live and x.at > p_now - interval '12 seconds'
           order by x.id desc limit 30) r;
$$;

-- A bought pack becomes a live opening, unless the opener does not want spectators
create or replace function public.nexamon_pack_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.nexamon_cfg();
begin
  if coalesce((select x.allow_watch from public.nexamon_presence x where x.player_id = new.player_id), true) then
    insert into public.nexamon_live (player_id, kind, pack_id, set_key, cards, started_at, ends_at)
    values (new.player_id, 'pack', new.id, new.set_key, new.cards, new.opened_at,
            new.opened_at + public.nexamon_ms(coalesce((cfg #>> '{live,staleMs}')::numeric, 10000)
                                              + coalesce((cfg ->> 'packSize')::numeric, 5) * coalesce((cfg #>> '{live,fallbackSlotMs}')::numeric, 2500)
                                              + coalesce((cfg #>> '{live,lingerMs}')::numeric, 8000)))
    on conflict (pack_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists nexamon_pack_live on public.nexamon_packs;
create trigger nexamon_pack_live after insert on public.nexamon_packs for each row execute function public.nexamon_pack_live();

-- One live opening as the lobby lists it
create or replace function public.nexamon_live_row_json(l public.nexamon_live, p_viewer uuid, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', l.id, 'kind', l.kind, 'set', l.set_key, 'battle_id', l.battle_id,
                            'player', public.nexamon_figure_json(l.player_id),
                            'opponent', case when l.kind = 'battle'
                                          then public.nexamon_figure_json((select b.opponent_id from public.nexamon_battles b where b.id = l.battle_id)) end,
                            'is_me', l.player_id = p_viewer
                                     or (l.kind = 'battle' and exists (select 1 from public.nexamon_battles b
                                                                        where b.id = l.battle_id and p_viewer in (b.challenger_id, b.opponent_id))),
                            'started_at', l.started_at, 'ends_at', l.ends_at,
                            'viewers', public.nexamon_live_viewer_count(l.id, p_now));
$$;

-- A Pack Battle as the players and spectators see it at p_now: the pulls only from the shared start, slot by slot
-- (battleKnownSlots), totals of what is known, the winner from decide_at (minus leadMs)
create or replace function public.nexamon_battle_json(b public.nexamon_battles, p_viewer uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.nexamon_cfg();
  v_size  integer := coalesce((cfg ->> 'packSize')::integer, 5);
  v_lead  numeric := coalesce((cfg #>> '{battles,leadMs}')::numeric, 800);
  v_tear  numeric := coalesce((cfg #>> '{battles,tearMs}')::numeric, 2400);
  v_slot  numeric := coalesce((cfg #>> '{battles,slotMs}')::numeric, 1800);
  v_known integer := 0;
  v_done  boolean := false;
  v_status text := b.status;
  v_ms    numeric;
  v_ca    jsonb := '[]'::jsonb;
  v_oa    jsonb := '[]'::jsonb;
  v_live  uuid;
begin
  if b.status = 'pending' and b.expires_at <= p_now then
    v_status := 'expired';
  end if;
  if b.status = 'accepted' then
    v_status := case when p_now >= b.ends_at then 'done' else 'running' end;
    if p_now >= b.starts_at then
      v_ms := extract(epoch from (p_now - b.starts_at)) * 1000 - v_tear + v_lead;
      if v_ms >= 0 then
        v_known := least(v_size, floor(v_ms / v_slot)::integer + 1);
      end if;
    end if;
    v_done := p_now >= b.decide_at - public.nexamon_ms(v_lead);
    select coalesce(jsonb_agg(x order by (x ->> 'slot')::integer), '[]'::jsonb) into v_ca
      from jsonb_array_elements(coalesce(b.challenger_cards, '[]'::jsonb)) x where (x ->> 'slot')::integer <= v_known;
    select coalesce(jsonb_agg(x order by (x ->> 'slot')::integer), '[]'::jsonb) into v_oa
      from jsonb_array_elements(coalesce(b.opponent_cards, '[]'::jsonb)) x where (x ->> 'slot')::integer <= v_known;
  end if;
  select l.id into v_live from public.nexamon_live l where l.battle_id = b.id;
  return jsonb_build_object(
    'id', b.id, 'set', b.set_key, 'status', v_status, 'price_cents', b.price_cents,
    'challenger', public.nexamon_figure_json(b.challenger_id), 'opponent', public.nexamon_figure_json(b.opponent_id),
    'me', case when p_viewer = b.challenger_id then 'challenger' when p_viewer = b.opponent_id then 'opponent' end,
    'created_at', b.created_at, 'expires_at', b.expires_at, 'accepted_at', b.accepted_at, 'starts_at', b.starts_at,
    'decide_at', b.decide_at, 'ends_at', b.ends_at, 'tear_ms', v_tear, 'slot_ms', v_slot,
    'challenger_cards', v_ca, 'opponent_cards', v_oa,
    'challenger_cents', coalesce((select sum((x ->> 'value_cents')::bigint) from jsonb_array_elements(v_ca) x), 0),
    'opponent_cents', coalesce((select sum((x ->> 'value_cents')::bigint) from jsonb_array_elements(v_oa) x), 0),
    'winner', case when v_done then case when b.winner_id = b.challenger_id then 'challenger'
                                         when b.winner_id = b.opponent_id then 'opponent' end end,
    'tie_break', case when v_done then b.tie_break end,
    'coin_seed', case when v_done then b.coin_seed end,
    'abort_reason', b.abort_reason,
    'live_id', v_live,
    'viewers', case when v_live is null then 0 else public.nexamon_live_viewer_count(v_live, p_now) end,
    'reactions', case when v_live is null then '[]'::jsonb else public.nexamon_live_reactions_json(v_live, p_now) end,
    'server_time', p_now);
end;
$$;

create or replace function public.nexamon_lobby(p_allow_watch boolean default true)
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
  v_secs   integer := coalesce((cfg #>> '{presence,presenceSeconds}')::integer, 60);
  v_max    integer := coalesce((cfg #>> '{presence,maxPlayers}')::integer, 24);
  v_last   timestamptz;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  insert into public.nexamon_presence (player_id, seen_at, allow_watch)
  values (v_player, v_now, coalesce(p_allow_watch, true))
  on conflict (player_id) do update set seen_at = excluded.seen_at, allow_watch = excluded.allow_watch;
  -- open challenges past their time are expired; old live openings go
  update public.nexamon_battles set status = 'expired', responded_at = expires_at
   where status = 'pending' and expires_at <= v_now and v_player in (challenger_id, opponent_id);
  delete from public.nexamon_live where ends_at < v_now - interval '1 hour';
  select max(b.created_at) into v_last from public.nexamon_battles b where b.challenger_id = v_player;
  return jsonb_build_object(
    'players', coalesce((
      select jsonb_agg(public.nexamon_figure_json(p.id) || jsonb_build_object(
                         'is_friend', true,
                         'opening', exists (select 1 from public.nexamon_live l where l.player_id = p.id and l.kind = 'pack' and l.ends_at > v_now),
                         'battling', exists (select 1 from public.nexamon_battles b
                                              where p.id in (b.challenger_id, b.opponent_id)
                                                and ((b.status = 'accepted' and b.ends_at > v_now) or (b.status = 'pending' and b.expires_at > v_now))))
                       order by x.seen_at desc, p.id)
        from (select y.player_id, y.seen_at from public.nexamon_presence y
                join public.friendships f on f.status = 'accepted'
                 and ((f.requester_id = v_player and f.addressee_id = y.player_id) or (f.addressee_id = v_player and f.requester_id = y.player_id))
               where y.seen_at > v_now - make_interval(secs => v_secs) and y.player_id <> v_player
               order by y.seen_at desc limit v_max) x
        join public.profiles p on p.id = x.player_id and not p.is_deactivated), '[]'::jsonb),
    'live', coalesce((
      select jsonb_agg(public.nexamon_live_row_json(l, v_player, v_now) order by l.started_at desc)
        from (select * from public.nexamon_live z where z.ends_at > v_now and z.started_at <= v_now
               order by z.started_at desc limit coalesce((cfg #>> '{live,maxSessions}')::integer, 12)) l), '[]'::jsonb),
    'battles', coalesce((
      select jsonb_agg(public.nexamon_battle_json(b, v_player, v_now) order by b.created_at desc)
        from public.nexamon_battles b
       where v_player in (b.challenger_id, b.opponent_id)
         and ((b.status = 'pending' and b.expires_at > v_now) or (b.status = 'accepted' and b.ends_at > v_now))), '[]'::jsonb),
    'limits', jsonb_build_object(
      'per_hour', coalesce((cfg #>> '{battles,perHour}')::integer, 6),
      'used', (select count(*) from public.nexamon_battles b
                where v_player in (b.challenger_id, b.opponent_id) and b.status = 'accepted' and b.accepted_at > v_now - interval '1 hour'),
      'cooldown_until', case when v_last is not null
                               and v_last + make_interval(secs => coalesce((cfg #>> '{battles,cooldownSeconds}')::integer, 20)) > v_now
                             then v_last + make_interval(secs => coalesce((cfg #>> '{battles,cooldownSeconds}')::integer, 20)) end),
    'allow_watch', coalesce(p_allow_watch, true),
    'server_time', v_now);
end;
$$;
comment on function public.nexamon_lobby(boolean) is
  'RPC (presence, ADR-172): marks the caller as on the Collectibles tab and returns {players: friends on the tab as '
  'figures with opening/battling, live: running live openings, battles: own open and running Pack Battles, limits, '
  'allow_watch, server_time}; errors nexamon_locked.';

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
  'RPC (live opening, ADR-172): the opener''s page reports how many cards of a bought pack it has shown; returns '
  '{live_id, viewers, reactions}. Without a live opening (watching off) live_id is null. Errors invalid_argument.';

create or replace function public.get_nexamon_live(p_live_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
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
  if l.player_id <> v_player and l.ends_at > v_now then
    insert into public.nexamon_live_viewers (live_id, player_id, seen_at) values (l.id, v_player, v_now)
    on conflict (live_id, player_id) do update set seen_at = excluded.seen_at;
  end if;
  v_n := case when l.player_id = v_player or l.ends_at <= v_now then coalesce(jsonb_array_length(l.cards), 0)
              else public.nexamon_live_visible(l, v_now) end;
  return public.nexamon_live_row_json(l, v_player, v_now) || jsonb_build_object(
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
  'RPC (spectating, ADR-172): one live opening with the cards the opener has already seen (fallback pace after '
  'live.staleMs), viewers and recent reactions; counts the caller as a viewer. Errors nexamon_locked, nexamon_live_unknown.';

create or replace function public.nexamon_live_react(p_request_id uuid, p_live_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  l        public.nexamon_live;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_live_id is null or p_emoji is null
     or not coalesce(cfg #> '{live,reactions}', '[]'::jsonb) ? p_emoji then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'nexamon_live_react');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into l from public.nexamon_live x where x.id = p_live_id;
  if l.id is null or l.ends_at <= v_now or l.started_at > v_now then
    perform public.api_error('nexamon_live_unknown');
  end if;
  if not public.rate_limit_hit(v_player, 'nexamon_react', coalesce((cfg #>> '{live,reactionsPerMinute}')::integer, 30), 60) then
    perform public.api_error('rate_limited');
  end if;
  insert into public.nexamon_live_reactions (live_id, player_id, emoji, at) values (l.id, v_player, p_emoji, v_now);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('reactions', public.nexamon_live_reactions_json(l.id, v_now)));
end;
$$;
comment on function public.nexamon_live_react(uuid, uuid, text) is
  'RPC (spectating, ADR-172): an emoji burst on a live opening (live.reactions); returns {reactions}. Errors '
  'nexamon_locked, invalid_argument, nexamon_live_unknown, rate_limited.';

do $do$
declare
  f text;
begin
  foreach f in array array['public.nexamon_lobby(boolean)', 'public.nexamon_live_progress(uuid, integer)',
                           'public.get_nexamon_live(uuid)', 'public.nexamon_live_react(uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.nexamon_ms(numeric)', 'public.nexamon_figure_json(uuid)', 'public.nexamon_on_tab(uuid, timestamptz)',
                           'public.nexamon_live_visible(public.nexamon_live, timestamptz)',
                           'public.nexamon_live_viewer_count(uuid, timestamptz)',
                           'public.nexamon_live_reactions_json(uuid, timestamptz)', 'public.nexamon_pack_live()',
                           'public.nexamon_live_row_json(public.nexamon_live, uuid, timestamptz)',
                           'public.nexamon_battle_json(public.nexamon_battles, uuid, timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$do$;
