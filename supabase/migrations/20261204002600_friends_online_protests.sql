-- =============================================================================
-- NEXA · 2600 · Friends online, finished campaigns leave the news after an hour
-- =============================================================================
-- * friends_json(): every friend carries "online" (active in the last social.onlineMinutes, default 10;
--   profiles.last_active_at is refreshed by require_player at most every 5 minutes) and "last_active_at";
--   online friends come first.
-- * protests_state(): a finished campaign stays visible for protests.visibleAfterMinutes (60) instead of a day.
-- Idempotent: runs unchanged as supabase/updates/20261204002600_friends_online_protests.sql.

create or replace function public.friends_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'level', p.level,
                                          'since', coalesce(f.responded_at, f.updated_at),
                                          'online', coalesce(p.last_active_at > public.game_now() - make_interval(
                                                      mins => coalesce(public.config_double('social', '{onlineMinutes}', 10), 10)::integer), false),
                                          'last_active_at', p.last_active_at)
                       order by coalesce(p.last_active_at > public.game_now() - make_interval(
                                  mins => coalesce(public.config_double('social', '{onlineMinutes}', 10), 10)::integer), false) desc,
                                lower(p.nickname), p.id)
        from public.friendships f
        join public.profiles p on p.id = case when f.requester_id = p_player then f.addressee_id else f.requester_id end
       where f.status = 'accepted' and p_player in (f.requester_id, f.addressee_id) and not p.is_deactivated), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'level', p.level, 'at', f.updated_at)
                       order by f.updated_at desc, p.id)
        from public.friendships f join public.profiles p on p.id = f.requester_id
       where f.status = 'pending' and f.addressee_id = p_player and not p.is_deactivated), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'level', p.level, 'at', f.updated_at)
                       order by f.updated_at desc, p.id)
        from public.friendships f join public.profiles p on p.id = f.addressee_id
       where f.status = 'pending' and f.requester_id = p_player and not p.is_deactivated), '[]'::jsonb));
$$;

do $do$
declare
  v_def text := pg_get_functiondef('public.protests_state(uuid)'::regprocedure);
  v_old text := $t$x.resolved_at > now() - interval '1 day'$t$;
  v_new text := $t$x.resolved_at > now() - make_interval(mins => coalesce((public.protests_cfg() ->> 'visibleAfterMinutes')::integer, 60))$t$;
begin
  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
