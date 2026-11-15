-- ===== idempotent copy of migrations/20261204003300_company_floor.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 3300 · The company floor: everybody at work as their dressed figure, with speech bubbles (ADR-156)
-- =============================================================================
-- get_company_floor() returns the workplace of the caller for the pixel scene on the job page and the company page:
-- * a player company (the chat company, founder or active employee): the founder and every active employee with
--   portrait (avatar_key), worn accessories (back to front), role founder/employee, job title, online (active in the
--   last social.onlineMinutes, default 10), me, and the newest own player message of the last startups.chat
--   .bubbleSeconds (default 120) as last_message {body, at}; system lines never count. Writing goes through
--   post_company_message() (same rules and limits), so the scene and the chat show the same words.
-- * an AI company (the caller has an active job there): the caller and up to startups.chat.floorMaxMembers - 1
--   coworkers with an active job at the same company (online first), without chat and without bubbles.
-- * otherwise company null and no members.
-- No ids leave the server: nicknames only, like friends_json().
-- Idempotent: runs unchanged as supabase/updates/20261204003300_company_floor.sql.

create or replace function public.company_floor_member_json(p_player uuid, p_viewer uuid, p_role text, p_title text,
                                                            p_company uuid, p_bubbles boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'nickname', p.nickname,
    'avatar_key', p.avatar_key,
    'accessories', public.player_worn_accessories(p.id),
    'role', p_role,
    'title', p_title,
    'online', coalesce(p.last_active_at > public.game_now() - make_interval(
                mins => coalesce(public.config_double('social', '{onlineMinutes}', 10), 10)::integer), false),
    'me', p.id = p_viewer,
    'last_message', case when p_bubbles then (
      select jsonb_build_object('body', m.body, 'at', m.created_at)
        from public.company_messages m
       where m.company_id = p_company and m.author_id = p.id and m.kind = 'player'
         and m.created_at > now() - make_interval(
               secs => coalesce(public.config_double('startups', '{chat,bubbleSeconds}', 120), 120))
       order by m.id desc
       limit 1) end)
    from public.profiles p
   where p.id = p_player;
$$;
revoke all on function public.company_floor_member_json(uuid, uuid, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.company_floor_member_json(uuid, uuid, text, text, uuid, boolean) to service_role;

create or replace function public.get_company_floor()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_company uuid := public.chat_company_of(v_player);
  v_max     integer := greatest(2, coalesce(public.config_double('startups', '{chat,floorMaxMembers}', 24), 24)::integer);
  v_secs    integer := coalesce(public.config_double('startups', '{chat,bubbleSeconds}', 120), 120)::integer;
  v_ai      boolean := false;
  v_online  interval := make_interval(mins => coalesce(public.config_double('social', '{onlineMinutes}', 10), 10)::integer);
  c         public.companies;
  v_members jsonb;
  v_workers integer := 0;
begin
  if v_company is null then
    select j.company_id into v_company
      from public.player_jobs j join public.companies co on co.id = j.company_id and co.is_ai
     where j.player_id = v_player and j.status = 'active'
     limit 1;
    v_ai := v_company is not null;
  end if;
  if v_company is null then
    return jsonb_build_object('company', null, 'chat', false, 'ai_workers', 0, 'bubble_seconds', v_secs,
                              'members', '[]'::jsonb);
  end if;
  select * into c from public.companies where id = v_company;

  if v_ai then
    select coalesce(jsonb_agg(public.company_floor_member_json(x.player_id, v_player, 'employee', x.title, v_company, false)
                              order by x.ord), '[]'::jsonb)
      into v_members
      from (select j.player_id, j.title,
                   row_number() over (order by (j.player_id = v_player) desc,
                                               coalesce(p.last_active_at > public.game_now() - v_online, false) desc,
                                               p.last_active_at desc nulls last, lower(p.nickname), j.player_id) as ord
              from public.player_jobs j join public.profiles p on p.id = j.player_id
             where j.company_id = v_company and j.status = 'active' and not p.is_deactivated) x
     where x.ord <= v_max;
  else
    select coalesce(pc.ai_workers, 0) into v_workers from public.player_companies pc where pc.company_id = v_company;
    select coalesce(jsonb_agg(public.company_floor_member_json(x.player_id, v_player, x.role, x.title, v_company, true)
                              order by x.ord, x.nick, x.player_id), '[]'::jsonb)
      into v_members
      from (select pc.founder_id as player_id, 'founder' as role, null::text as title, 0 as ord, ''::text as nick
              from public.player_companies pc
             where pc.company_id = v_company and pc.status = 'active' and pc.founder_id is not null
            union all
            select j.player_id, 'employee', j.title, 1, lower(p.nickname)
              from public.player_jobs j join public.profiles p on p.id = j.player_id
             where j.company_id = v_company and j.status = 'active' and not p.is_deactivated) x;
  end if;

  return jsonb_build_object(
    'company', jsonb_build_object('name', c.name, 'color', c.brand_color, 'kind', case when v_ai then 'ai' else 'player' end,
                                  'logo', case when v_ai then null else public.company_logo(c.id) end),
    'chat', not v_ai,
    'ai_workers', v_workers,
    'bubble_seconds', v_secs,
    'members', v_members);
end;
$$;
revoke all on function public.get_company_floor() from public, anon;
grant execute on function public.get_company_floor() to authenticated, service_role;
comment on function public.get_company_floor() is
  'RPC: the workplace of the caller as a pixel scene (ADR-156): company {name, color, kind, logo}, chat, ai_workers, '
  'bubble_seconds and members [{nickname, avatar_key, accessories, role, title, online, me, last_message}]; no ids.';
