-- ===== idempotent copy of migrations/20261204002200_company_chat_notify.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 2200 · Company chat: a notification when somebody writes
-- =============================================================================
-- post_company_message() now tells the other members of the company (founder and active employees). To keep the
-- bell calm, a member gets no second notification of the same company while the first one is still unread.
-- The type "company_chat" can be switched off in the notification settings.
-- Idempotent: runs unchanged as supabase/updates/20261204002200_company_chat_notify.sql.

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('company_chat', 'company', 'Firmenchat', 'Jemand hat in den Chat deiner Firma geschrieben.',
        'notif_bell', true, true, false, 297)
on conflict (key) do nothing;

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
  v_nick    text;
  v_name    text;
  r         record;
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

  -- everybody else in the company hears about it, once until they have read it
  select p.nickname into v_nick from public.profiles p where p.id = v_player;
  select c.name into v_name from public.companies c where c.id = v_company;
  for r in select m.player_id
             from (select pc.founder_id as player_id from public.player_companies pc
                    where pc.company_id = v_company and pc.status = 'active'
                   union
                   select j.player_id from public.player_jobs j where j.company_id = v_company and j.status = 'active') m
            where m.player_id is not null and m.player_id <> v_player
              and not exists (select 1 from public.notifications n
                               where n.player_id = m.player_id and n.type_key = 'company_chat' and n.read_at is null
                                 and n.payload ->> 'company_id' = v_company::text)
            order by m.player_id loop
    perform public.social_notify(r.player_id, 'company_chat', 'Firmenchat: ' || v_name,
      v_nick || ': ' || case when char_length(v_body) > 120 then left(v_body, 117) || '...' else v_body end,
      jsonb_build_object('company_id', v_company, 'message_id', v_id, 'author_id', v_player),
      '/career/chat', 'company-chat:' || v_id::text);
  end loop;
  return public.request_complete(v_player, p_request_id, public.company_message_json(v_id, v_player));
end;
$$;
revoke all on function public.post_company_message(uuid, text) from public, anon;
grant execute on function public.post_company_message(uuid, text) to authenticated, service_role;
