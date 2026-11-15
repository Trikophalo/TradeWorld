-- =============================================================================
-- 9p · The company floor: members as dressed figures with speech bubbles (ADR-156)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''0f100f10-0000-4000-8000-0000000000f1'''
\set w '''0f100f10-0000-4000-8000-0000000000f2'''
\set v '''0f100f10-0000-4000-8000-0000000000f3'''
\set o '''0f100f10-0000-4000-8000-0000000000f4'''
\set x '''0f100f10-0000-4000-8000-0000000000f5'''
\set y '''0f100f10-0000-4000-8000-0000000000f6'''
update public.invite_codes set max_uses = max_uses + 6 where code = 'M1-TESTS';
select tests.signup(:f, 'Floor_Frida') is not null and tests.signup(:w, 'Floor_Willi') is not null
   and tests.signup(:v, 'Floor_Vera') is not null and tests.signup(:o, 'Floor_Otto') is not null
   and tests.signup(:x, 'Floor_Xaver') is not null and tests.signup(:y, 'Floor_Yuki') is not null as ok \gset
select tests.set_level(:f, 10);
select tests.set_level(:w, 3);
select tests.set_level(:v, 3);
select tests.set_level(:o, 10);
select tests.fund(:f, 3000000, 'test:9p:f');
select tests.fund(:o, 3000000, 'test:9p:o');

-- Frida founds a company and hires Willi and Vera; Otto has a company of his own
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Bodenständig', 'Teppiche für Büros', 'tech', '#3366ff', 'garage') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :o);
select public.found_company(gen_random_uuid(), 'Ottos Ecke', 'Kioske mit App', 'tech', '#aa3366', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.hire(:f, :w, 20000) is not null as ok \gset
select tests.hire(:f, :v, 20000) is not null as ok \gset
update public.player_companies set ai_workers = 2 where company_id = :'fco';

-- Willi wears a hat; Vera was last seen an hour ago
insert into public.player_accessories (player_id, accessory_key, price_paid_cents) values (:w, 'cowboy_hat', 0) on conflict do nothing;
insert into public.player_accessories_worn (player_id, slot, accessory_key) values (:w, 'head', 'cowboy_hat')
  on conflict do nothing;
update public.profiles set last_active_at = public.game_now() where id in (:f, :w);
update public.profiles set last_active_at = public.game_now() - interval '1 hour' where id = :v;

-- messages: an old one of Willi (no bubble), a fresh one of Frida, a system line (never a bubble)
select tests.login_as('authenticated', :f);
select public.post_company_message(gen_random_uuid(), 'Moin Team!') is not null as ok \gset
reset role;
insert into public.company_messages (company_id, author_id, kind, body, created_at)
values (:'fco', :w, 'player', 'Gestern war was los', now() - interval '1 hour');
insert into public.company_messages (company_id, author_id, kind, body)
values (:'fco', null, 'system', 'Quartal abgeschlossen');

-- =============================================================================
-- A. The founder sees everybody, in order, with figures and bubbles
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.get_company_floor() as ff \gset
reset role;
select tests.assert(
  :'ff'::jsonb -> 'company' ->> 'name' = 'Bodenständig'
  and :'ff'::jsonb -> 'company' ->> 'kind' = 'player'
  and :'ff'::jsonb -> 'company' ->> 'color' = '#3366ff'
  and (:'ff'::jsonb ->> 'chat')::boolean
  and (:'ff'::jsonb ->> 'ai_workers')::integer = 2
  and (:'ff'::jsonb ->> 'bubble_seconds')::integer = 120
  and jsonb_array_length(:'ff'::jsonb -> 'members') = 3
  and (select array_agg(m ->> 'nickname' order by n) from jsonb_array_elements(:'ff'::jsonb -> 'members') with ordinality as t(m, n))
      = array['Floor_Frida', 'Floor_Vera', 'Floor_Willi']
  and :'ff'::jsonb #>> '{members,0,role}' = 'founder'
  and (:'ff'::jsonb #>> '{members,0,me}')::boolean
  and :'ff'::jsonb #>> '{members,1,role}' = 'employee'
  and not (:'ff'::jsonb #>> '{members,1,me}')::boolean,
  'get_company_floor(): founder first, then the employees by name; company, chat, AI workers, bubble time');
select tests.assert(
  (:'ff'::jsonb #>> '{members,0,online}')::boolean
  and not (:'ff'::jsonb #>> '{members,1,online}')::boolean
  and (:'ff'::jsonb #>> '{members,2,online}')::boolean,
  'get_company_floor(): online = active in the last social.onlineMinutes');
select tests.assert(
  :'ff'::jsonb #> '{members,2,accessories}' = '["cowboy_hat"]'::jsonb
  and :'ff'::jsonb #> '{members,0,accessories}' = '[]'::jsonb
  and :'ff'::jsonb #>> '{members,2,avatar_key}' = (select avatar_key from public.profiles where id = :w)
  and :'ff'::jsonb #>> '{members,2,title}' = 'Werkstudium'
  and :'ff'::jsonb #> '{members,0,title}' = 'null'::jsonb,
  'get_company_floor(): portrait, worn accessories and job title of every member');
select tests.assert(
  :'ff'::jsonb #>> '{members,0,last_message,body}' = 'Moin Team!'
  and :'ff'::jsonb #> '{members,0,last_message,at}' is not null
  and :'ff'::jsonb #> '{members,1,last_message}' = 'null'::jsonb
  and :'ff'::jsonb #> '{members,2,last_message}' = 'null'::jsonb,
  'get_company_floor(): a fresh own message is a bubble; an hour-old one and system lines are not');
select tests.assert(
  :'ff'::jsonb::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  and not (:'ff'::jsonb -> 'company') ? 'id'
  and not exists (select 1 from jsonb_array_elements(:'ff'::jsonb -> 'members') m
                   where m ? 'id' or m ? 'player_id'),
  'get_company_floor(): no ids leave the server');

-- =============================================================================
-- B. An employee writes into the office: the same chat, a bubble over the own figure
-- =============================================================================
select tests.login_as('authenticated', :w);
select public.post_company_message(gen_random_uuid(), 'Kaffee ist fertig') is not null as ok \gset
select public.get_company_floor() as fw \gset
select public.get_company_chat() as cw \gset
reset role;
select tests.assert(
  jsonb_array_length(:'fw'::jsonb -> 'members') = 3
  and (select m ->> 'nickname' from jsonb_array_elements(:'fw'::jsonb -> 'members') m where (m ->> 'me')::boolean)
      = 'Floor_Willi'
  and (select m #>> '{last_message,body}' from jsonb_array_elements(:'fw'::jsonb -> 'members') m
        where m ->> 'nickname' = 'Floor_Willi') = 'Kaffee ist fertig'
  and (select m #>> '{last_message,body}' from jsonb_array_elements(:'fw'::jsonb -> 'members') m
        where m ->> 'nickname' = 'Floor_Frida') = 'Moin Team!'
  and (select count(*) from jsonb_array_elements(:'cw'::jsonb -> 'messages') m
        where m ->> 'body' = 'Kaffee ist fertig') = 1,
  'get_company_floor(): an employee sees the same floor; the newest message stands over the figure and in the chat');

-- the bubble time comes from game_config
update public.game_config set value = jsonb_set(value, '{chat,bubbleSeconds}', '1') where key = 'startups';
update public.company_messages set created_at = now() - interval '5 seconds' where company_id = :'fco';
select tests.login_as('authenticated', :w);
select public.get_company_floor() as fw2 \gset
reset role;
update public.game_config set value = jsonb_set(value, '{chat,bubbleSeconds}', '120') where key = 'startups';
select tests.assert(
  (:'fw2'::jsonb ->> 'bubble_seconds')::integer = 1
  and not exists (select 1 from jsonb_array_elements(:'fw2'::jsonb -> 'members') m
                   where m -> 'last_message' <> 'null'::jsonb),
  'get_company_floor(): bubbles fade after startups.chat.bubbleSeconds');

-- =============================================================================
-- C. Only the own company: another founder and an outsider
-- =============================================================================
select tests.login_as('authenticated', :o);
select public.get_company_floor() as fo \gset
reset role;
select tests.login_as('authenticated', :x);
select public.get_company_floor() as fx \gset
reset role;
select tests.assert(
  :'fo'::jsonb -> 'company' ->> 'name' = 'Ottos Ecke'
  and jsonb_array_length(:'fo'::jsonb -> 'members') = 1
  and :'fo'::jsonb #>> '{members,0,nickname}' = 'Floor_Otto'
  and :'fo'::jsonb::text !~ 'Floor_Frida|Moin Team',
  'get_company_floor(): another founder sees only his own company');
select tests.assert(
  :'fx'::jsonb = jsonb_build_object('company', null, 'chat', false, 'ai_workers', 0, 'bubble_seconds', 120,
                                    'members', '[]'::jsonb),
  'get_company_floor(): without a job or company: no company, no members');

-- =============================================================================
-- D. An AI company: coworkers without chat and without bubbles
-- =============================================================================
insert into public.player_jobs (player_id, company_id, job_definition_id, request_id, tier, title, salary_cents_per_hour)
select pl.id, j.company_id, j.id, gen_random_uuid(), j.tier, j.title, j.salary_cents_per_hour
  from (select jd.* from public.job_definitions jd join public.companies co on co.id = jd.company_id and co.is_ai
         where not exists (select 1 from public.player_jobs pj where pj.company_id = jd.company_id and pj.status = 'active')
         order by jd.key limit 1) j,
       (values (:x::uuid), (:y::uuid)) pl(id);
update public.profiles set last_active_at = public.game_now() where id = :y;
update public.profiles set last_active_at = public.game_now() - interval '2 hours' where id = :x;
select tests.login_as('authenticated', :x);
select public.get_company_floor() as fa \gset
select tests.throws_key($$select public.post_company_message(gen_random_uuid(), 'Hallo?')$$, 'not_in_company',
  'post_company_message(): no chat at an AI company');
reset role;
select tests.assert(
  :'fa'::jsonb -> 'company' ->> 'kind' = 'ai'
  and not (:'fa'::jsonb ->> 'chat')::boolean
  and :'fa'::jsonb -> 'company' -> 'logo' = 'null'::jsonb
  and (select array_agg(m ->> 'nickname' order by n) from jsonb_array_elements(:'fa'::jsonb -> 'members') with ordinality as t(m, n))
      = array['Floor_Xaver', 'Floor_Yuki']
  and (:'fa'::jsonb #>> '{members,0,me}')::boolean
  and not (:'fa'::jsonb #>> '{members,0,online}')::boolean
  and (:'fa'::jsonb #>> '{members,1,online}')::boolean
  and not exists (select 1 from jsonb_array_elements(:'fa'::jsonb -> 'members') m
                   where m ->> 'role' <> 'employee' or m -> 'last_message' <> 'null'::jsonb)
  and :'fa'::jsonb::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  'get_company_floor(): at an AI company the caller first, then coworkers online first; no chat, no ids');

-- the helper is internal
select tests.assert(
  not has_function_privilege('authenticated', 'public.company_floor_member_json(uuid, uuid, text, text, uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.get_company_floor()', 'execute')
  and not has_function_privilege('anon', 'public.get_company_floor()', 'execute'),
  'get_company_floor() for players only; company_floor_member_json() internal');
