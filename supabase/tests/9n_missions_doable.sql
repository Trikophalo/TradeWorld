-- =============================================================================
-- 9n · Missions are always doable; one-off property mission (ADR-154)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''09d29d29-0000-4000-8000-0000000000f1'''
\set h '''09d29d29-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:f, 'Doable_Frida') is not null and tests.signup(:h, 'Doable_Hanna') is not null as ok \gset
select tests.set_level(:f, 10);
select tests.set_level(:h, 10);
select tests.fund(:f, 5000000, 'test:9n:f');
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Vollhaus', 'Alles ausgebucht', 'retail', '#336699', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:f) as fco \gset

-- a company with a free place: hiring is doable; full: not
select tests.assert(
  public.mission_doable(:f, 'q_ai_worker', 'ai_worker_hired') and public.mission_doable(:f, 'm_first_ai_worker', 'ai_worker_hired')
  and not public.mission_doable(:h, 'q_ai_worker', 'ai_worker_hired'),
  'mission_doable(): hiring needs an own company with a free place');
update public.player_companies set ai_workers = 1 where company_id = :'fco';
select tests.assert(
  not public.mission_doable(:f, 'm_first_ai_worker', 'ai_worker_hired') and public.mission_doable(:f, 'q_ai_worker', 'ai_worker_hired'),
  'mission_doable(): "your first AI worker" is gone once there is one; another hire is still fine');
update public.player_companies set ai_workers = (select max_employees from public.companies where id = :'fco') where company_id = :'fco';
select tests.assert(
  not public.mission_doable(:f, 'q_ai_worker', 'ai_worker_hired') and not public.mission_doable(:f, 'q_job_post', 'job_posted'),
  'mission_doable(): a full company gets no hiring or posting missions');

-- an impossible active mission without progress expires and is replaced
delete from public.player_missions where player_id = :f;
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward)
values (:f, 'q_ai_worker', 'quick', (public.game_now() at time zone 'Europe/Berlin')::date, 1, 20);
select public.missions_assign(:f) as n \gset
select tests.assert(
  (select status = 'expired' from public.player_missions where player_id = :f and template_key = 'q_ai_worker')
  and (select count(*) from public.player_missions where player_id = :f and kind = 'quick' and status = 'active') >= 1
  and not exists (select 1 from public.player_missions m join public.mission_templates t on t.key = m.template_key
                   where m.player_id = :f and m.status = 'active' and not public.mission_doable(:f, t.key, t.metric)),
  'missions_assign(): an impossible mission makes room; every active mission is doable');

-- the property mission: once, 2500 base XP (5000 with the multiplier), first among the milestones, only without a home
select tests.set_level(:h, 14);
select tests.login_as('authenticated', :h);
select public.get_my_missions() is not null as ok \gset
reset role;
select tests.assert(
  (select title = 'Kauf dir ein Grundstück' and xp_min = 2500 and xp_max = 2500 and (params ->> 'fixedXp')::boolean
     from public.mission_templates where key = 'm_home_first')
  and (select xp_reward = 2500 from public.player_missions where player_id = :h and template_key = 'm_home_first')
  and public.mission_doable(:h, 'm_home_first', 'home_bought'),
  'm_home_first: buy a property, fixed 2500 base XP, handed out at the property level');
insert into public.player_homes (player_id, tier, wall_color) values (:h, 'flat', '#c9b79c');
select tests.assert(
  not public.mission_doable(:h, 'm_home_first', 'home_bought')
  and public.mission_doable(:h, 'm_home_upgrade', 'home_upgraded')
  and not public.mission_doable(:h, 'm_home_car', 'car_bought')
  and public.mission_doable(:h, 'q_furniture', 'furniture_bought'),
  'mission_doable(): with a flat no "buy a home", but moving up and furniture; no car without a garage');
