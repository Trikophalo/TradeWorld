-- =============================================================================
-- NEXA · M3d · 0300 · Company chat (ADR-060)
-- =============================================================================
-- Members: the founder of an active player company and players with an active
-- job there. System lines come from company_system_message().
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- The chat company of a player: own active company, else the employer if it is an active player company.
create or replace function public.chat_company_of(p_player uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select pc.company_id from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active'),
    (select j.company_id from public.player_jobs j
       join public.player_companies pc on pc.company_id = j.company_id and pc.status = 'active'
      where j.player_id = p_player and j.status = 'active' limit 1));
$$;

create or replace function public.company_message_json(p_id bigint, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'author', pr.nickname, 'avatar_key', pr.avatar_key,
           'is_me', m.author_id is not null and m.author_id = p_viewer,
           'is_founder', m.author_id is not null and m.author_id = pc.founder_id,
           'body', m.body, 'created_at', m.created_at)
    from public.company_messages m
    left join public.profiles pr on pr.id = m.author_id
    left join public.player_companies pc on pc.company_id = m.company_id
   where m.id = p_id;
$$;

create or replace function public.get_company_chat(p_before_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_company uuid := public.chat_company_of(v_player);
  v_limit   integer := greatest(1, public.config_double('startups', '{chat,historyLimit}', 100)::integer);
  c         public.companies;
begin
  if v_company is null then
    return jsonb_build_object('company', null, 'members', 0, 'messages', '[]'::jsonb);
  end if;
  select * into c from public.companies where id = v_company;
  return jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'color', c.brand_color),
    'members', 1 + (select count(*) from public.player_jobs j where j.company_id = v_company and j.status = 'active')::integer,
    'messages', coalesce((
      select jsonb_agg(public.company_message_json(x.id, v_player) order by x.id)
        from (select m.id from public.company_messages m
               where m.company_id = v_company and (p_before_id is null or m.id < p_before_id)
               order by m.id desc limit v_limit) x), '[]'::jsonb));
end;
$$;

create or replace function public.post_company_message(p_request_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  v_company uuid;
  v_body    text := btrim(coalesce(p_body, ''));
  v_id      bigint;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'post_company_message');
  if v_replay is not null then
    return v_replay;
  end if;
  v_company := public.chat_company_of(v_player);
  if v_company is null then
    perform public.api_error('not_in_company');
  end if;
  if v_body = '' or char_length(v_body) > public.config_double('startups', '{chat,maxMessageLength}', 300) then
    perform public.api_error('invalid_argument');
  end if;
  if public.text_has_profanity(v_body) then
    perform public.api_error('name_profanity');
  end if;
  if (select count(*) from public.company_messages m
       where m.author_id = v_player and m.created_at > now() - interval '1 minute')
     >= public.config_double('startups', '{chat,maxMessagesPerMinute}', 10) then
    perform public.api_error('rate_limited');
  end if;
  insert into public.company_messages (company_id, author_id, kind, body)
  values (v_company, v_player, 'player', v_body)
  returning id into v_id;
  return public.request_complete(v_player, p_request_id, public.company_message_json(v_id, v_player));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.chat_company_of(uuid)', 'public.company_message_json(bigint, uuid)',
                           'public.get_company_chat(bigint)', 'public.post_company_message(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.get_company_chat(bigint) to authenticated;
  grant execute on function public.post_company_message(uuid, text) to authenticated;
end;
$$;
