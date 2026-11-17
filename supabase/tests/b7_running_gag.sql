-- =============================================================================
-- b7 · NEXA Nachrichten: running gags (ADR-179). "Vulcan Energy" never starts drilling: the gag runs while the
--      player company exists, counts its aired episodes, never repeats a line twice in a row, the made-up viewers
--      react (annoyed ones and the fans), it stops after the dissolution and starts at 1 again with a new company.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set v '''0b7b7b7b-0000-4000-8000-0000000000a1'''
\set co '''0b7b7b7b-0000-4000-8000-0000000000c1'''
\set co2 '''0b7b7b7b-0000-4000-8000-0000000000c2'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:v, 'Bohr_Boris') is not null as ok \gset

select tests.assert(
  (select jsonb_array_length(value #> '{runningGags,vulcan,lines}') >= 30
          and jsonb_array_length(value #> '{runningGags,vulcan,chat,annoyed}') >= 25
          and jsonb_array_length(value #> '{runningGags,vulcan,chat,fans}') >= 15
          and value #>> '{runningGags,vulcan,namePattern}' = 'vulcan energy%'
     from public.game_config where key = 'newsShow'),
  'config: the Vulcan gag with its pattern, host lines, annoyed lines and fan lines');

delete from public.news_shows;
delete from public.news_show_messages;
select tests.set_cfg('newsShow', '{runningGags,vulcan,chanceBps}', '10000');
select tests.set_cfg('newsShow', '{maxSegments}', '600');
select tests.set_cfg('newsShow', '{waitMinutes}', '60');
select tests.set_cfg('newsShow', '{chat,bots,names}', '["Jürgen Test"]');

-- A. without the company there is no gag
select tests.assert(
  not exists (select 1 from jsonb_array_elements(public.news_show_build(now())) x where x ->> 'kind' = 'gag'),
  'no player company named Vulcan Energy: no gag');

insert into public.companies (id, name, slug, sector_key, legal_form, founder_id, shares_outstanding, founded_at)
values (:co, 'VULCAN Energy', 'vulcan-energy-b7', 'tech', 'gmbh', :v, 1000, now() - interval '4 days 1 hour');

-- B. with the company: a gag segment that names the player company and the founder, the counter from founding
select (select x from jsonb_array_elements(public.news_show_build(now())) x where x ->> 'kind' = 'gag') as g1 \gset
select tests.assert(
  :'g1'::jsonb is not null
  and :'g1'::jsonb ->> 'text' like '%VULCAN Energy%' and :'g1'::jsonb ->> 'text' like '%Bohr_Boris%'
  and (:'g1'::jsonb ->> 'text' like '%Spielerfirma%' or :'g1'::jsonb ->> 'text' like '%NEXA%')
  and (:'g1'::jsonb ->> 'text') || (:'g1'::jsonb ->> 'headline') not like '%{%'
  and (:'g1'::jsonb -> 'subject' -> 'values' ->> 'days')::int = 5
  and (:'g1'::jsonb -> 'subject' -> 'values' ->> 'episode')::int = 1
  and :'g1'::jsonb -> 'apply' -> 0 ->> 'type' = 'gag' and :'g1'::jsonb -> 'effects' = '[]'::jsonb
  and :'g1'::jsonb ->> 'mood' in ('neutral', 'shocked', 'crying', 'laughing', 'angry', 'smug', 'confused', 'proud'),
  'the gag: player company and founder named, Tag 5 since founding, episode 1, no effects, a known mood');

-- C. aired shows count episodes, the viewers react, no line twice in a row
create temporary table b7_lines (episode integer, line integer);
do $$
declare
  v_show bigint;
  v_segs jsonb;
  k      integer;
begin
  for k in 1..6 loop
    v_segs := public.news_show_build(now());
    insert into public.news_shows (airs_at, segments) values (now() - make_interval(secs => 100 - k), v_segs) returning id into v_show;
    perform tests.assert(public.news_show_start(v_show, now()), 'gag show ' || k || ' starts');
    perform public.news_show_after_start(v_show, now());
    insert into b7_lines
    select (x -> 'subject' -> 'values' ->> 'episode')::int, (x -> 'apply' -> 0 ->> 'line')::int
      from jsonb_array_elements(v_segs) x where x ->> 'kind' = 'gag';
  end loop;
end;
$$;
select tests.assert(
  (select episodes = 6 and last_line is not null from public.news_running_gags where gag_key = 'vulcan' and company_id = :co)
  and (select array_agg(episode order by episode) = array[1, 2, 3, 4, 5, 6] from b7_lines)
  and not exists (select 1 from b7_lines a join b7_lines b on b.episode = a.episode + 1 where a.line = b.line),
  'every aired show counts one episode; the host line never repeats right away');
select tests.assert(
  (select count(*) from public.news_show_messages m
    where m.bot_name in (select jsonb_array_elements_text(value #> '{runningGags,vulcan,chat,fanNames}') from public.game_config where key = 'newsShow')) >= 6
  and (select count(*) from public.news_show_messages m
        where m.bot_name = 'Jürgen Test'
          and m.body in (select replace(replace(replace(l, '{company}', 'VULCAN Energy'), '{founder}', 'Bohr_Boris'), '{days}', '5')
                           from public.game_config g, jsonb_array_elements_text(g.value #> '{runningGags,vulcan,chat,annoyed}') l
                          where g.key = 'newsShow' and l not like '%{episode}%')) >= 1
  and not exists (select 1 from public.news_show_messages where bot_name is not null and body like '%{%'),
  'the chat: annoyed viewers and the die-hard fans under their own names, placeholders filled');
select tests.assert(
  (select news_show_start(id, now()) from public.news_shows order by id desc limit 1) is false
  and (select episodes from public.news_running_gags where company_id = :co) = 6,
  'a show starts once: the episode is counted once');

-- D. Claude's rewrite keeps the gag as drafted
insert into public.news_shows (airs_at, segments) values (now() + interval '2 hours', public.news_show_build(now())) returning id as cs \gset
select public.store_news_show_script(:cs, (select jsonb_agg(jsonb_build_object('headline', 'Neu', 'text', 'Ganz neuer Text hier.', 'mood', 'crying'))
                                             from jsonb_array_elements((select segments from public.news_shows where id = :cs)))) as stored \gset
select tests.assert(
  :'stored'::boolean
  and (select bool_and(case when x ->> 'kind' = 'gag' then x ->> 'text' like '%VULCAN Energy%' else x ->> 'text' = 'Ganz neuer Text hier.' end)
         from public.news_shows s, jsonb_array_elements(s.segments) x where s.id = :cs),
  'store_news_show_script(): Claude rewrites the others, the gag stays as drafted');
delete from public.news_shows where id = :cs;

-- E. dissolved: the gag stops; a new company with the name starts at episode 1
update public.companies set phase = 'dissolved', dissolved_at = now() where id = :co;
select tests.assert(
  not exists (select 1 from jsonb_array_elements(public.news_show_build(now())) x where x ->> 'kind' = 'gag'),
  'after the dissolution the gag stops');
insert into public.companies (id, name, slug, sector_key, legal_form, founder_id, shares_outstanding)
values (:co2, 'Vulcan Energy', 'vulcan-energy-b7-2', 'tech', 'gmbh', :v, 1000);
select tests.assert(
  (select (x -> 'subject' -> 'values' ->> 'episode')::int = 1 and (x -> 'subject' -> 'values' ->> 'days')::int = 1
          and (x -> 'subject' ->> 'company_id')::uuid = :co2
     from jsonb_array_elements(public.news_show_build(now())) x where x ->> 'kind' = 'gag'),
  'a new Vulcan Energy brings the gag back, counter from 1');

-- F. chance 0 switches it off
select tests.set_cfg('newsShow', '{runningGags,vulcan,chanceBps}', '0');
select tests.assert(
  not exists (select 1 from jsonb_array_elements(public.news_show_build(now())) x where x ->> 'kind' = 'gag'),
  'chanceBps 0: no gag');

-- clean up
update public.companies set phase = 'dissolved', dissolved_at = now() where id = :co2;
delete from public.news_shows;
delete from public.news_show_messages;
select tests.set_cfg('newsShow', '{runningGags,vulcan,chanceBps}', '7000');
select tests.set_cfg('newsShow', '{waitMinutes}', '10');
