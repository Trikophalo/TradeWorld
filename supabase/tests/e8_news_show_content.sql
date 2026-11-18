-- =============================================================================
-- e8 · NEXA Nachrichten, season three: new topics, no repeats, a chat that reacts (ADR-210)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0e8e8e8e-0000-4000-8000-0000000000a1'''
\set b '''0e8e8e8e-0000-4000-8000-0000000000b1'''
\set c '''0e8e8e8e-0000-4000-8000-0000000000c1'''
\set d '''0e8e8e8e-0000-4000-8000-0000000000d1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:a, 'Frisch_Anna') is not null and tests.signup(:b, 'Frisch_Bert') is not null
   and tests.signup(:c, 'Frisch_Cleo') is not null and tests.signup(:d, 'Frisch_Dirk') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(x, 6) from unnest(array[:a, :b]::uuid[]) x;
select tests.fund(x, 1000000, 'test:e8:' || x::text) from unnest(array[:a, :b]::uuid[]) x;
select tests.set_cfg('newsPromos', '{chanceBps}', '0');

create or replace function tests.e8_found(p_player uuid, p_name text) returns uuid language plpgsql as $$
begin
  perform tests.login_as('authenticated', p_player);
  perform public.found_company(gen_random_uuid(), p_name, 'Alles für alle', 'tech', '#335577', 'garage');
  reset role;
  return tests.company_of(p_player);
end;
$$;
-- One topic alone (every other weight 0), told about the test players only; '{}' when it has nothing to tell.
create or replace function tests.e8_topic(p_key text)
returns jsonb
language plpgsql
as $$
declare
  v_cfg  jsonb;
  v_out  jsonb;
  v_seen uuid[];
begin
  select value into v_cfg from public.game_config where key = 'newsShow';
  select coalesce(array_agg(p.id), '{}') into v_seen from public.profiles p where p.nickname not like 'Frisch\_%';
  update public.game_config
     set value = jsonb_set(jsonb_set(value, '{topics,count}', '1'), '{topics,list}',
           (select jsonb_object_agg(t.key, case when t.key = p_key then t.value else t.value || '{"weight": 0}'::jsonb end)
              from jsonb_each(v_cfg #> '{topics,list}') t))
   where key = 'newsShow';
  v_out := public.news_show_topics(now(), v_seen, '{}', '[]'::jsonb);
  update public.game_config set value = v_cfg where key = 'newsShow';
  -- the events from outside come along in every draw (ADR-210): the story of the topic asked for
  return coalesce((select x from jsonb_array_elements(v_out) x where x #>> '{subject,topic}' = p_key limit 1), '{}'::jsonb);
end;
$$;
create or replace function tests.e8_said(p_seg jsonb) returns text language sql as $$
  select coalesce(p_seg ->> 'headline', '') || ' | ' || coalesce(p_seg ->> 'text', '')
$$;

-- A. config: the new topics with scripts and moods, chat pools, polls, emotes, more viewer names
select tests.assert(
  (select (g.value #>> '{topics,count}')::int >= 3
          and (g.value #>> '{fresh,noRepeatShows}')::int >= 3
          and (select count(*) from jsonb_each(g.value #> '{topics,list}') t where t.value ->> 'group' in ('world', 'talent', 'rank')) >= 15
          and not exists (
                select 1 from unnest(array['worldHq', 'worldHqUp', 'worldLeader', 'worldFee', 'worldSub', 'worldEvent',
                                           'worldEventWon', 'worldEventLost', 'worldWeather', 'talentStar', 'talentPoach', 'talentQuit',
                                           'talentCoceo', 'talentMarket', 'cloneJob', 'rankForbes', 'rankCompany',
                                           'rankWeekLoser', 'cardBlackLabel', 'cardTwist', 'cardSpree', 'pVault',
                                           'pVaultPaid', 'pStreak', 'corpSkill', 'corpLogo', 'oddOracle']) k
                 where jsonb_array_length(coalesce(g.value #> array['texts', k, 'frames'], '[]'::jsonb)) < 3
                    or jsonb_array_length(coalesce(g.value #> array['texts', k, 'reasons'], '[]'::jsonb)) < 10
                    or jsonb_array_length(coalesce(g.value #> array['moods', k], '[]'::jsonb)) < 1
                    or jsonb_array_length(coalesce(g.value #> array['fresh', 'chat', 'topics', k], '[]'::jsonb)) < 5)
          and jsonb_array_length(g.value #> '{fresh,chat,polls,list}') >= 10
          and jsonb_array_length(g.value #> '{fresh,transitions}') >= 20
     from public.game_config g where g.key = 'newsShow'),
  'config: 27 new topics with 3+ frames, 10+ reasons, moods and chat lines; polls and segues');
select tests.assert(
  position('news_show_topic_cands_fresh' in pg_get_functiondef('public.news_show_topics(timestamptz, uuid[], uuid[], jsonb)'::regprocedure)) > 0
  and position('news_show_segue' in pg_get_functiondef('public.news_show_topics(timestamptz, uuid[], uuid[], jsonb)'::regprocedure)) > 0
  and exists (select 1 from pg_trigger where tgname = 'news_shows_fresh_chat' and not tgisinternal)
  and not has_function_privilege('authenticated', 'public.news_show_topic_cands_fresh(timestamptz, interval)', 'execute')
  and not has_function_privilege('authenticated', 'public.news_show_fresh_chat(bigint, timestamptz)', 'execute'),
  'hooks: the topics read the new candidates and segues, a trigger writes the chat, players cannot call them');

delete from public.news_shows;
delete from public.news_show_used where key like 'fact:%';

-- B. nothing happened yet: the Börsen-Orakel and the weather carry, complete and about nobody
select tests.assert(
  (select x ->> 'kind' = 'ramble' and tests.e8_said(x) like '%Orakel%' and tests.e8_said(x) not like '%{%'
          and not (x -> 'subject' ? 'player_id')
     from (select tests.e8_topic('oddOracle') x) q)
  and (select x #>> '{subject,topic}' = 'worldWeather' and tests.e8_said(x) not like '%{%'
              and (x #>> '{subject,values,country}') is not null
         from (select tests.e8_topic('worldWeather') x) q),
  'no data needed: the Börsen-Orakel and the Wetter auf der Weltkarte');
select tests.assert(tests.e8_topic('worldHq') = '{}'::jsonb and tests.e8_topic('talentStar') = '{}'::jsonb
                    and tests.e8_topic('rankWeekLoser') = '{}'::jsonb and tests.e8_topic('pVault') = '{}'::jsonb,
  'without their facts the new topics stay silent');

-- C. the facts appear as stories
select tests.e8_found(:a, 'Frischwerk AG') as co_a \gset
select tests.e8_found(:b, 'Bertsche Bohnen') as co_b \gset
-- Weltkarte: a new headquarters in Japan, market leader there with a fee, a subsidiary, an upgrade
insert into public.company_locations (company_id, country_key, placed_at, hq_tier)
values (:'co_a', 'jp', now() - interval '1 hour', 1), (:'co_b', 'de', now() - interval '3 days', 4)
on conflict (company_id) do update set country_key = excluded.country_key, placed_at = excluded.placed_at, hq_tier = excluded.hq_tier;
update public.company_locations set updated_at = now() - interval '5 minutes' where company_id = :'co_b';
insert into public.country_lobby (country_key, leader_company_id, fee_bps, fee_set_at, updated_at)
values ('jp', :'co_a', 700, now() - interval '10 minutes', now() - interval '10 minutes')
on conflict (country_key) do update set leader_company_id = excluded.leader_company_id, fee_bps = excluded.fee_bps,
                                        fee_set_at = excluded.fee_set_at;
insert into public.company_subsidiaries (company_id, country_key, opened_at) values (:'co_b', 'us', now() - interval '20 minutes')
on conflict do nothing;
select tests.e8_topic('worldHq') as s \gset
select tests.assert(
  :'s'::jsonb #>> '{subject,topic}' = 'worldHq' and :'s'::jsonb ->> 'kind' = 'world'
  and tests.e8_said(:'s'::jsonb) like '%Frischwerk AG%' and tests.e8_said(:'s'::jsonb) like '%Japan%'
  and :'s'::jsonb #>> '{subject,player_id}' = :a and tests.e8_said(:'s'::jsonb) not like '%{%',
  'worldHq: the new headquarters with company, country and founder in the picture');
select tests.e8_topic('worldLeader') as s \gset
select tests.e8_topic('worldFee') as f \gset
select tests.assert(
  tests.e8_said(:'s'::jsonb) like '%Frischwerk AG%' and tests.e8_said(:'s'::jsonb) like '%Japan%'
  and tests.e8_said(:'f'::jsonb) like '%7%' and tests.e8_said(:'f'::jsonb) like '%Japan%',
  'worldLeader and worldFee: the market leader of Japan and its location fee');
select tests.e8_topic('worldSub') as s \gset
select tests.e8_topic('worldHqUp') as u \gset
select tests.assert(
  tests.e8_said(:'s'::jsonb) like '%Bertsche Bohnen%' and :'s'::jsonb #>> '{subject,values,count}' = '1'
  and :'u'::jsonb #>> '{subject,values,tier}' = '4' and tests.e8_said(:'u'::jsonb) like '%Deutschland%',
  'worldSub and worldHqUp: a subsidiary with its number, a headquarters on tier 4');
-- events from outside get their own segments: an earthquake hits one company (new), the other overcame a strike
-- (follow-up) and sat out a tariff dispute (follow-up)
insert into public.player_company_events (company_id, archetype, polarity, severity, status, definition, started_at, deadline_at)
values (:'co_a', 'earthquake', 'crisis', 2, 'open', '{"insurable": true}'::jsonb, now() - interval '30 minutes', now() + interval '1 day');
insert into public.player_company_events (company_id, archetype, polarity, severity, status, definition, started_at, deadline_at, resolved_at, strategy)
values (:'co_b', 'union_strike', 'crisis', 1, 'solved', '{}'::jsonb, now() - interval '30 hours', now() + interval '1 day', now() - interval '1 hour', 'mediation');
insert into public.player_company_events (company_id, archetype, polarity, severity, status, definition, started_at, deadline_at)
values (:'co_b', 'tariffs', 'crisis', 3, 'expired', '{}'::jsonb, now() - interval '30 hours', now() - interval '2 hours');
-- (other tests may have left events of their own companies: only ours are looked at, the cap is lifted)
select tests.set_cfg('newsShow', '{fresh,events,max}', '50');
select public.news_show_event_segments(now(), interval '24 hours') as all_evs \gset
select coalesce(jsonb_agg(x order by o), '[]'::jsonb) as evs
  from jsonb_array_elements(:'all_evs'::jsonb) with ordinality t(x, o)
 where tests.e8_said(x) ~ '(Frischwerk AG|Bertsche Bohnen)' \gset
select tests.assert(
  jsonb_array_length(:'evs'::jsonb) = 3
  and (select array_agg(x #>> '{subject,topic}' order by o) from jsonb_array_elements(:'evs'::jsonb) with ordinality t(x, o))
      = array['worldEvent', 'worldEventWon', 'worldEventLost']
  and (select bool_and((x ->> 'ord')::int between 21 and 21 + jsonb_array_length(:'all_evs'::jsonb)) from jsonb_array_elements(:'evs'::jsonb) x)
  and tests.e8_said(:'evs'::jsonb -> 0) like '%Erdbeben%' and tests.e8_said(:'evs'::jsonb -> 0) like '%Frischwerk AG%'
  and tests.e8_said(:'evs'::jsonb -> 0) like '%Japan%' and tests.e8_said(:'evs'::jsonb -> 0) like '%ernst%'
  and tests.e8_said(:'evs'::jsonb -> 0) like '%Versichert ist dagegen nichts.%'
  and tests.e8_said(:'evs'::jsonb -> 0) like '%noch nicht gewählt%'
  and :'evs'::jsonb #>> '{0,subject,player_id}' = :a
  and tests.e8_said(:'evs'::jsonb -> 1) like '%Streik%' and tests.e8_said(:'evs'::jsonb -> 1) like '%Bertsche Bohnen%'
  and tests.e8_said(:'evs'::jsonb -> 1) like '%Schlichtung%'
  and tests.e8_said(:'evs'::jsonb -> 2) like '%Zollstreit%' and tests.e8_said(:'evs'::jsonb -> 2) like '%Ausgesessen%'
  and not exists (select 1 from jsonb_array_elements(:'evs'::jsonb) x where tests.e8_said(x) like '%{%'),
  'events from outside: one segment each, new first with company, country, severity, insurance and response; follow-ups when solved or lost');
-- they come before the lot, whatever the weights, and every event is told once
select tests.assert(
  (select count(*) from jsonb_array_elements(public.news_show_topics(now(), '{}', '{}', '[]'::jsonb)) x
    where x #>> '{subject,topic}' like 'worldEvent%' and tests.e8_said(x) ~ '(Frischwerk AG|Bertsche Bohnen)') = 3,
  'events from outside: always in the show, outside the topic lot');
insert into public.news_show_used (key) select x #>> '{subject,ukey}' from jsonb_array_elements(:'evs'::jsonb) x
on conflict (key) do nothing;
select tests.assert(
  not exists (select 1 from jsonb_array_elements(public.news_show_event_segments(now(), interval '24 hours')) x
               where tests.e8_said(x) ~ '(Frischwerk AG|Bertsche Bohnen)'),
  'events from outside: once told, never again');
select tests.set_cfg('newsShow', '{fresh,events,max}', '3');
delete from public.news_show_used where key like 'fact:event%';
-- Talente and clones
insert into public.talents (talent_key, role_key, tier, first_name, last_name, avatar_key, wage_demand_cents)
values ('e8_star', 'sales', 4, 'Greta', 'Glanzlicht', 'seller', 250000) on conflict (talent_key) do nothing;
insert into public.talent_events (company_id, talent_key, kind, payload)
values (:'co_a', 'e8_star', 'hired', '{"name": "Greta Glanzlicht", "role": "sales", "tier": 3}'),
       (:'co_b', 'e8_star', 'poached', '{"name": "Greta Glanzlicht", "role": "sales", "to_name": "Frischwerk AG"}');
select tests.e8_topic('talentStar') as s \gset
select tests.e8_topic('talentPoach') as p \gset
select tests.e8_topic('talentMarket') as m \gset
select tests.assert(
  tests.e8_said(:'s'::jsonb) like '%Greta Glanzlicht%' and tests.e8_said(:'s'::jsonb) like '%Vertrieb%'
  and tests.e8_said(:'p'::jsonb) like '%Bertsche Bohnen%' and tests.e8_said(:'p'::jsonb) like '%Frischwerk AG%'
  and :'m'::jsonb #>> '{subject,topic}' = 'talentMarket' and tests.e8_said(:'m'::jsonb) not like '%{%'
  and not (:'m'::jsonb -> 'subject' ? 'player_id'),
  'talentStar, talentPoach, talentMarket: star hire, poaching drama with both companies, the best free talent');
insert into public.player_jobs (player_id, company_id, request_id, tier, title, salary_cents_per_hour, is_clone, started_at)
values (:c, :'co_a', gen_random_uuid(), 'junior', 'Klon-Praktikant', 1000, true, now() - interval '2 hours');
select tests.e8_topic('cloneJob') as s \gset
select tests.assert(tests.e8_said(:'s'::jsonb) like '%Frisch_Cleo%' and tests.e8_said(:'s'::jsonb) like '%Klon-Praktikant%',
  'cloneJob: the clone of a player has a job');
-- toplists: Cleo climbs, Dirk is the Pleite der Woche
insert into public.rich_list_snapshots (taken_at, entity_kind, entity_id, net_worth_cents, rank_all, rank_players)
values (now() - interval '7 days', 'player', :d, 2000000, 3, 3),
       (now() - interval '24 hours', 'player', :c, 900000, 20, 20),
       (now() - interval '24 hours', 'player', :d, 1500000, 4, 4),
       (now(), 'player', :c, 1900000, 6, 6),
       (now(), 'player', :d, 800000, 9, 9)
on conflict (taken_at, entity_kind, entity_id) do update set net_worth_cents = excluded.net_worth_cents, rank_all = excluded.rank_all;
select tests.e8_topic('rankForbes') as s \gset
select tests.e8_topic('rankWeekLoser') as w \gset
select tests.assert(
  :'s'::jsonb #>> '{subject,player_id}' = :c and :'s'::jsonb #>> '{subject,values,places}' = '14'
  and :'w'::jsonb #>> '{subject,player_id}' = :d and tests.e8_said(:'w'::jsonb) like '%Pleite der Woche%'
  and tests.e8_said(:'w'::jsonb) like '%60%',
  'rankForbes and rankWeekLoser: 14 places up, and the Pleite der Woche with minus 60 %');
-- Festgeld, streaks, company skills, a Black Label
insert into public.vault_deposits (player_id, request_id, amount_cents, term_days, rate_bps, created_at, matures_at)
values (:b, gen_random_uuid(), 2500000, 7, 300, now() - interval '1 hour', now() + interval '6 days');
insert into public.login_streaks (player_id, current_streak, longest_streak, last_login_day)
values (:d, 14, 14, current_date) on conflict (player_id) do update set current_streak = 14, last_login_day = current_date;
insert into public.company_skills (company_id, skill_key, level, ready_at) values (:'co_a', 'research', 5, now() - interval '1 minute')
on conflict (company_id, skill_key) do update set level = 5, ready_at = excluded.ready_at;
insert into public.nexamon_copies (card_key, serial, owner_id, condition, grade, graded_at, grading_fee_cents, source)
select k.card_key, coalesce((select max(serial) from public.nexamon_copies c where c.card_key = k.card_key), 0) + 1,
       :c, 'mint', 11, now() - interval '10 minutes', 50000, 'seed'
  from public.nexamon_cards k order by k.card_key limit 1;
select tests.e8_topic('pVault') as v \gset
select tests.e8_topic('pStreak') as k \gset
select tests.e8_topic('corpSkill') as s \gset
select tests.e8_topic('cardBlackLabel') as l \gset
select tests.assert(
  tests.e8_said(:'v'::jsonb) like '%Frisch_Bert%' and :'v'::jsonb #>> '{subject,values,days}' = '7'
  and tests.e8_said(:'k'::jsonb) like '%14%' and :'k'::jsonb #>> '{subject,player_id}' = :d
  and tests.e8_said(:'s'::jsonb) like '%Forschen & Testen%' and :'s'::jsonb #>> '{subject,values,level}' = '5'
  and tests.e8_said(:'l'::jsonb) like '%Black Label%' and :'l'::jsonb #>> '{subject,player_id}' = :c,
  'pVault, pStreak, corpSkill, cardBlackLabel: Festgeld, a 14-day streak, a skill on level 5, a Black Label');
-- a redrawn logo (ADR-200)
update public.player_companies set logo_redrawn_at = now() - interval '10 minutes' where company_id = :'co_b';
select tests.e8_topic('corpLogo') as g \gset
select tests.assert(
  tests.e8_said(:'g'::jsonb) like '%Logo%' and tests.e8_said(:'g'::jsonb) like '%Bertsche Bohnen%'
  and :'g'::jsonb #>> '{subject,player_id}' = :b and tests.e8_said(:'g'::jsonb) not like '%{%',
  'corpLogo: a founder redrew the logo of the company, with the price');
-- a full draw with everything: one story per player, every text complete, the new groups take part
select tests.set_cfg('newsShow', '{topics,count}', '500');
select public.news_show_topics(now(), (select array_agg(p.id) from public.profiles p where p.nickname not like 'Frisch\_%'), '{}', '[]'::jsonb) as allsegs \gset
select tests.set_cfg('newsShow', '{topics,count}', '4');
select tests.assert(
  -- (events from outside have one segment each, possibly several of a kind)
  (select count(*) = count(distinct x #>> '{subject,topic}') from jsonb_array_elements(:'allsegs'::jsonb) x
    where x #>> '{subject,topic}' not like 'worldEvent%')
  and not exists (select 1 from jsonb_array_elements(:'allsegs'::jsonb) x where tests.e8_said(x) like '%{%')
  and (select count(distinct x #>> '{subject,group}') filter (where x #>> '{subject,group}' in ('world', 'talent', 'rank'))
         from jsonb_array_elements(:'allsegs'::jsonb) x) >= 2,
  'all topics at once: each once, complete texts, the new groups take part (one story per player decides which)');

-- D. no repeats within newsShow.fresh.noRepeatShows shows
delete from public.news_shows;
delete from public.news_show_used where key like 'oddOracle:%' or key like 'r:oddOracle:%' or key like 'f:oddOracle:%';
create temporary table e8_picks (n integer, reason text, frame text);
do $$
declare
  v_kit jsonb := public.news_show_cfg() -> 'texts' -> 'oddOracle';
  v_s   jsonb;
begin
  for i in 1 .. (public.news_show_cfg() #>> '{fresh,noRepeatShows}')::integer + 1 loop
    insert into public.news_shows (airs_at, status, created_at)
    values (date_trunc('hour', now()) - make_interval(hours => 50 - i), 'cancelled', clock_timestamp());
    v_s := public.news_show_pick('oddOracle');
    insert into e8_picks values (i,
      (select r from jsonb_array_elements_text(v_kit -> 'reasons') r where position(r in v_s ->> 'text') > 0 limit 1),
      v_s ->> 'headline');
  end loop;
end;
$$;
select tests.assert(
  (select count(distinct reason) = count(*) and count(reason) = count(*) from e8_picks)
  and (select count(distinct frame) = 3 from e8_picks where n <= 3),
  'news_show_pick: no reason twice within the window, and every frame once before one comes back');
select tests.set_cfg('newsShow', '{fresh,transitionChanceBps}', '10000');
create temporary table e8_segues (n integer, said text);
do $$
begin
  for i in 1 .. 6 loop
    insert into public.news_shows (airs_at, status, created_at)
    values (date_trunc('hour', now()) - make_interval(hours => 30 - i), 'cancelled', clock_timestamp());
    insert into e8_segues values (i, public.news_show_segue('{"kind": "world", "text": "Text."}'::jsonb) ->> 'text');
  end loop;
end;
$$;
select tests.assert(
  (select count(distinct said) = 6 and bool_and(said like '% Text.') from e8_segues),
  'segues: a different one in front of each topic within the window');

-- E. the chat reacts to what is on air; real players' chat stays as it is
delete from public.news_shows;
select tests.set_cfg('newsShow', '{fresh,chat,polls,chanceBps}', '10000');
select count(*) as player_lines from public.news_show_messages where player_id is not null \gset
create or replace function tests.e8_show(p_at timestamptz) returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  insert into public.news_shows (airs_at, status, segments)
  values (p_at, 'scheduled', jsonb_build_array(
    jsonb_build_object('kind', 'world', 'headline', 'x', 'text', 'y',
      'subject', jsonb_build_object('type', 'topic', 'topic', 'worldLeader', 'group', 'world',
                                    'values', jsonb_build_object('company', 'Frischwerk AG', 'country', 'Japan'))),
    jsonb_build_object('kind', 'loser', 'headline', 'x', 'text', 'y',
      'subject', jsonb_build_object('values', jsonb_build_object('name', 'Frisch_Dirk', 'amount', '1 €', 'pct', '5 %'))),
    jsonb_build_object('kind', 'cards', 'headline', 'x', 'text', 'y',
      'subject', jsonb_build_object('type', 'topic', 'topic', 'cardBlackLabel', 'group', 'cards',
                                    'values', jsonb_build_object('name', 'Frisch_Cleo', 'card', 'Glitzerdrache', 'fee', '500 €')))))
  returning id into v_id;
  update public.news_shows set status = 'aired', started_at = p_at where id = v_id;
  return v_id;
end;
$$;
select tests.e8_show(date_trunc('hour', now()) + interval '2 hours') as show1 \gset
select airs_at as at1 from public.news_shows where id = :show1 \gset
create temporary table e8_chat1 as
select m.bot_name, m.body, extract(epoch from m.created_at - :'at1'::timestamptz) as sec
  from public.news_show_messages m where m.player_id is null and m.created_at >= :'at1'::timestamptz;
select (g.value #>> '{introSeconds}')::int as intro, (g.value #>> '{segmentSeconds}')::int as seg,
       g.value #> '{fresh,chat}' as fc
  from public.game_config g where g.key = 'newsShow' \gset
select tests.assert(
  -- two lines from the worldLeader pool, filled, during the first segment
  (select count(*) = 2 from e8_chat1 c
    where c.sec between :intro and :intro + :seg
      and exists (select 1 from jsonb_array_elements_text(:'fc'::jsonb -> 'topics' -> 'worldLeader') l
                   where public.news_show_fill(l, '{"company": "Frischwerk AG", "country": "Japan"}') = c.body))
  -- the loser segment gets loser lines, with the name filled in
  and (select count(*) = 2 from e8_chat1 c
        where c.sec between :intro + :seg and :intro + 2 * :seg
          and exists (select 1 from jsonb_array_elements_text(:'fc'::jsonb -> 'kinds' -> 'loser') l
                       where public.news_show_fill(l, '{"name": "Frisch_Dirk"}') = c.body))
  -- emotes after the Black Label
  and (select count(*) >= (:'fc'::jsonb #>> '{burst,countMin}')::int from e8_chat1 c
        where c.sec between :intro + 2 * :seg and :intro + 3 * :seg
          and :'fc'::jsonb -> 'burst' -> 'emotes' ? c.body)
  -- one poll with votes, filled
  and (select count(*) = 1 from e8_chat1 c where c.bot_name = :'fc'::jsonb #>> '{polls,host}' and c.body not like '%{%')
  and (select count(*) >= (:'fc'::jsonb #>> '{polls,votesMin}')::int from e8_chat1 c where :'fc'::jsonb -> 'polls' -> 'votes' ? c.body)
  and not exists (select 1 from e8_chat1 c where c.body like '%{%'),
  'chat: lines about the segment on air (topic and kind), emotes after a big pull, a poll with votes');
select tests.assert(
  (select count(*) from public.news_show_messages where player_id is not null) = :player_lines,
  'chat: the lines of real players are untouched');
select tests.e8_show(date_trunc('hour', now()) + interval '3 hours') as show2 \gset
select airs_at as at2 from public.news_shows where id = :show2 \gset
select tests.assert(
  not exists (select 1 from public.news_show_messages m
               where m.player_id is null and m.created_at >= :'at2'::timestamptz
                 and m.body in (select body from e8_chat1 where body not in
                                  (select jsonb_array_elements_text(:'fc'::jsonb -> 'burst' -> 'emotes')
                                   union select jsonb_array_elements_text(:'fc'::jsonb -> 'polls' -> 'votes')))),
  'chat: the next show says other lines and asks another question');

delete from public.news_shows;
drop function tests.e8_show(timestamptz);
drop function tests.e8_topic(text);
drop function tests.e8_said(jsonb);
drop function tests.e8_found(uuid, text);
