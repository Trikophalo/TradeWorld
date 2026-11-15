-- ===== idempotent copy of migrations/20261204003200_news_audience.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 3200 · The studio audience of NEXA Nachrichten and players on the TV with their figure (ADR-157)
-- =============================================================================
-- * player_figure_json(player): the public look of a player, {nickname, avatar_key, accessories}; one helper for
--   every place that draws someone's dressed figure (internal, never with an id).
-- * get_news_show() returns "audience": everyone who watched within the last 20 seconds (the caller included), as
--   their figure with "friend" and "me", the caller first, then friends, then the others by name; at most
--   newsShow.audience.max.
-- * Segments about a player (loser, winner, gossip, scandal/hype of a founder, the creator of an NFT) carry that
--   player's "figure", read when the show is fetched, so it is always the current look.
-- * news_show_chat_json() marks the lines of the made-up viewers ("bot"), so the client gives them a figure of
--   their own.
-- Idempotent: runs unchanged as supabase/updates/20261204003200_news_audience.sql.

-- The public look of a player: nickname, portrait, worn accessories (back to front); null when unknown or gone.
create or replace function public.player_figure_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('nickname', p.nickname, 'avatar_key', p.avatar_key,
                            'accessories', public.player_worn_accessories(p.id))
    from public.profiles p
   where p.id = p_player and not p.is_deactivated;
$$;
comment on function public.player_figure_json(uuid) is
  'Internal: a player''s dressed figure for others (ADR-157): nickname, avatar_key, accessories; never the id.';

-- The chat: players and made-up viewers ("bot"); lines of the latter appear when their time has come.
create or replace function public.news_show_chat_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nickname', m.nickname, 'body', m.body, 'at', m.created_at,
                                               'mine', coalesce(m.player_id = p_player, false),
                                               'bot', m.bot_name is not null)
                            order by m.created_at, m.id), '[]'::jsonb)
    from (select x.id, x.body, x.created_at, x.player_id, x.bot_name, coalesce(x.bot_name, p.nickname) as nickname
            from public.news_show_messages x left join public.profiles p on p.id = x.player_id
           where x.created_at > public.game_now() - interval '75 minutes' and x.created_at <= public.game_now()
             and coalesce(x.bot_name, p.nickname) is not null
           order by x.created_at desc, x.id desc
           limit coalesce((public.news_show_cfg() #>> '{chat,history}')::integer, 60)) m;
$$;

-- Who watches right now, as figures: the caller first, then friends, then the others (by name, so nobody jumps).
create or replace function public.news_show_audience_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.player_figure_json(a.player_id)
                            || jsonb_build_object('friend', a.friend, 'me', a.me)
                            order by a.me desc, a.friend desc, lower(a.nickname), a.player_id), '[]'::jsonb)
    from (select v.player_id, p.nickname, v.player_id = p_player as me,
                 exists (select 1 from public.friendships f
                          where f.status = 'accepted'
                            and ((f.requester_id = p_player and f.addressee_id = v.player_id)
                              or (f.addressee_id = p_player and f.requester_id = v.player_id))) as friend
            from public.news_show_viewers v
            join public.profiles p on p.id = v.player_id and not p.is_deactivated
           where v.seen_at > public.game_now() - interval '20 seconds'
           order by me desc, friend desc, lower(p.nickname), v.player_id
           limit greatest(1, coalesce((public.news_show_cfg() #>> '{audience,max}')::integer, 12))) a;
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
    if public.news_show_start(u.id, v_now) then
      perform public.news_show_after_start(u.id, v_now);
    end if;
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
    'audience', public.news_show_audience_json(v_player),
    'upcoming', case when u.id is null then null else jsonb_build_object(
                  'id', u.id, 'airs_at', u.airs_at,
                  'needs_script', u.writer = 'mini' and u.ai_requested_at is null) end,
    'show', case when s.id is null then null else jsonb_build_object(
              'id', s.id, 'airs_at', s.airs_at, 'started_at', s.started_at, 'writer', s.writer,
              'segments', coalesce((select jsonb_agg(jsonb_build_object('kind', x ->> 'kind', 'mood', coalesce(x ->> 'mood', 'neutral'),
                                                                        'headline', x ->> 'headline',
                                                                        'text', x ->> 'text', 'effects', x -> 'effects')
                                                     || case when fig.f is null then '{}'::jsonb
                                                             else jsonb_build_object('figure', fig.f) end
                                                      order by ord)
                                      from jsonb_array_elements(s.segments) with ordinality t(x, ord)
                                      left join lateral (
                                        select public.player_figure_json((x -> 'subject' ->> 'player_id')::uuid) as f
                                         where x -> 'subject' ->> 'player_id' is not null) fig on true),
                                   '[]'::jsonb)) end,
    'chat', public.news_show_chat_json(v_player));
end;
$$;

revoke all on function public.player_figure_json(uuid) from public, anon, authenticated;
revoke all on function public.news_show_audience_json(uuid) from public, anon, authenticated;
revoke all on function public.news_show_chat_json(uuid) from public, anon, authenticated;
grant execute on function public.player_figure_json(uuid) to service_role;
revoke all on function public.get_news_show() from public, anon;
grant execute on function public.get_news_show() to authenticated;
comment on function public.get_news_show() is
  'RPC: NEXA Nachrichten (ADR-150/152/157): the show to watch, the next airing, viewers, the studio audience as '
  'figures, segments (with the figure of the player they are about) and the live chat; starts this hour''s show for '
  'its first viewer.';
