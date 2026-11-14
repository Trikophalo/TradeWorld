-- =============================================================================
-- 9h · Missions: more XP at higher levels; work for another real player once (ADR-142)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set lo '''09d19d19-0000-4000-8000-0000000000a1'''
\set hi '''09d19d19-0000-4000-8000-0000000000b1'''
\set f  '''09d19d19-0000-4000-8000-0000000000f1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:lo, 'Xp_Neuling') is not null and tests.signup(:hi, 'Xp_Profi') is not null
   and tests.signup(:f, 'Xp_Chefin') is not null as ok \gset
select tests.set_level(:lo, 2);
select tests.set_level(:hi, 21);
delete from public.player_missions where player_id in (:lo, :hi);
select public.missions_assign(:lo) is not null and public.missions_assign(:hi) is not null as ok \gset

-- the same template pays more at a higher level: x (1 + 0.15 x 20) = x 4 at level 21, x 1.15 at level 2
select tests.assert(
  (select bool_and(h.xp_reward >= floor(t.xp_min * 4) and h.xp_reward <= ceil(t.xp_max * 4))
     from public.player_missions h join public.mission_templates t on t.key = h.template_key
    where h.player_id = :hi and not coalesce((t.params ->> 'fixedXp')::boolean, false))
  and (select bool_and(l.xp_reward <= ceil(t.xp_max * 1.15))
     from public.player_missions l join public.mission_templates t on t.key = l.template_key
    where l.player_id = :lo and not coalesce((t.params ->> 'fixedXp')::boolean, false)),
  'missions_assign(): mission XP grow with the level (ADR-142)');

-- the milestone "work for a real player" comes first and keeps its 1250 base XP (x2 = 2500)
select tests.assert(
  (select xp_reward from public.player_missions where player_id = :hi and template_key = 'm_work_for_player') = 1250,
  'm_work_for_player: handed out before every other milestone, fixed 1250 base XP (2500 with the multiplier)');

-- taking a job at a player company completes it
select tests.set_level(:f, 10);
select tests.fund(:f, 20000000, 'test:xp:f');
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Xp Werkstatt', 'Fahrräder reparieren', 'logistics', '#335577', 'garage')
  is not null as ok \gset
reset role;
select tests.hire(:f, :hi, 2000) is not null as ok \gset
select tests.assert(
  (select status from public.player_missions where player_id = :hi and template_key = 'm_work_for_player') = 'completed',
  'player_job: starting at another player''s company completes the mission');
