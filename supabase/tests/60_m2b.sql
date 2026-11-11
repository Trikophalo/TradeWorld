-- =============================================================================
-- 60 · M2b: avatars, daily rewards, skills, jobs (player and employer side),
--      player card, wiring into portfolio / rich list / missions
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0a2b2b2b-0000-4000-8000-0000000000a1'''
\set d '''0a2b2b2b-0000-4000-8000-0000000000d1'''
\set s '''0a2b2b2b-0000-4000-8000-0000000000b1'''
\set w '''0a2b2b2b-0000-4000-8000-0000000000e1'''
\set e '''0a2b2b2b-0000-4000-8000-0000000000e2'''
\set f '''0a2b2b2b-0000-4000-8000-0000000000f1'''
select tests.signup(:a, 'Ava_Tar') is not null and tests.signup(:d, 'Dora_Daily') is not null
   and tests.signup(:w, 'Willi_Werk') is not null and tests.signup(:e, 'Erna_Chefin') is not null
   and tests.signup(:f, 'Fritz_Frei') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 4);
select tests.set_level(:w, 6);
select tests.set_level(:e, 12);
select tests.set_level(:f, 6);
select (public.game_now() at time zone 'Europe/Berlin')::date as bday \gset

-- helpers ---------------------------------------------------------------------------
create or replace function tests.give_points(p_player uuid, p_free integer) returns void language sql as $$
  insert into public.player_skill_points (player_id, free_points) values (p_player, p_free)
  on conflict (player_id) do update set free_points = excluded.free_points $$;
create or replace function tests.company_cash(p_company uuid) returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where owner_company_id = p_company and kind = 'company_cash' $$;
-- rewinds today's daily reward so the next claim is computed from the given history
create or replace function tests.reset_reward(p_player uuid, p_last date, p_cycle smallint, p_freeze smallint) returns void
language sql as $$
  delete from public.daily_reward_claims where player_id = p_player and claim_day = (public.game_now() at time zone 'Europe/Berlin')::date;
  delete from public.daily_logins where player_id = p_player and login_day = (public.game_now() at time zone 'Europe/Berlin')::date;
  delete from public.xp_events where player_id = p_player
     and dedupe_key = 'daily_reward:' || (public.game_now() at time zone 'Europe/Berlin')::date;
  update public.login_streaks
     set last_login_day = p_last, reward_last_day = p_last, reward_cycle_day = p_cycle, current_streak = 5,
         freeze_tokens = p_freeze,
         freeze_granted_week = (public.game_now() at time zone 'Europe/Berlin')::date
                               - (extract(isodow from (public.game_now() at time zone 'Europe/Berlin')::date)::integer - 1)
   where player_id = p_player $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. Avatars
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.get_my_portfolio() as pf0 \gset
select public.set_avatar(gen_random_uuid(), 'punk') as av1 \gset
select tests.throws_key($$select public.set_avatar(gen_random_uuid(), 'gamer')$$, 'avatar_locked', 'set_avatar(): portrait above the level is locked');
select tests.throws_key($$select public.set_avatar(gen_random_uuid(), 'dragon')$$, 'avatar_unknown', 'set_avatar(): unknown key');
select public.get_my_portfolio() as pf1 \gset
reset role;
select tests.assert(
  :'pf0'::jsonb ->> 'avatar_key' = 'rookie' and :'av1'::jsonb = '{"avatar_key": "punk"}'::jsonb
  and :'pf1'::jsonb ->> 'avatar_key' = 'punk',
  'avatars: default rookie, set_avatar() returns {avatar_key}, portfolio shows the new portrait');
select tests.assert(
  :'pf1'::jsonb ?& array['avatar_key', 'skill_points_free', 'daily_reward_claimable']
  and jsonb_typeof(:'pf1'::jsonb -> 'skill_points_free') = 'number'
  and (:'pf1'::jsonb ->> 'daily_reward_claimable')::boolean,
  'get_my_portfolio(): avatar_key, skill_points_free, daily_reward_claimable');

-- old players (no skill point row, avatar column default) still get every field
delete from public.player_skill_points where player_id = :f;
select tests.login_as('authenticated', :f);
select public.get_my_portfolio() as pfold \gset
reset role;
select tests.assert(
  :'pfold'::jsonb ->> 'avatar_key' = 'rookie' and (:'pfold'::jsonb ->> 'skill_points_free')::int = 0,
  'get_my_portfolio(): players without a skill point row read avatar rookie and 0 free points');

-- rich list
select tests.login_as('authenticated', :a);
select public.get_rich_list(500) as rl \gset
reset role;
select tests.assert(
  (select bool_and(x ? 'avatar_key') from jsonb_array_elements(:'rl'::jsonb -> 'entries') x)
  and (select bool_and(x ->> 'avatar_key' is not null) from jsonb_array_elements(:'rl'::jsonb -> 'entries') x where x ->> 'kind' = 'tycoon')
  and (select x ->> 'avatar_key' from jsonb_array_elements(:'rl'::jsonb -> 'entries') x where x ->> 'id' = :a) = 'punk'
  and (select bool_and(x ->> 'avatar_key' = public.tycoon_avatar_key((x ->> 'id')::uuid))
         from jsonb_array_elements(:'rl'::jsonb -> 'entries') x where x ->> 'kind' = 'tycoon')
  and (select count(distinct x ->> 'avatar_key') from jsonb_array_elements(:'rl'::jsonb -> 'entries') x where x ->> 'kind' = 'tycoon') >= 8
  and not exists (select 1 from jsonb_array_elements(:'rl'::jsonb -> 'entries') x
                    join jsonb_array_elements(public.config_jsonb('avatars', '{portraits}')) p on p ->> 'key' = x ->> 'avatar_key'
                   where x ->> 'kind' = 'tycoon' and (p ->> 'level')::int > 25),
  'get_rich_list(): avatar_key on every entry, tycoons deterministic from portraits up to level 25');

-- =============================================================================
-- B. Daily rewards
-- =============================================================================
select public.treasury_balance_cents() as tr0 \gset
select tests.cash(:d) as dcash0 \gset
select tests.login_as('authenticated', :d);
select public.get_daily_reward() as g0 \gset
select public.claim_daily_reward(gen_random_uuid()) as c1 \gset
select tests.throws_key($$select public.claim_daily_reward(gen_random_uuid())$$, 'daily_reward_claimed', 'claim_daily_reward(): once per day');
select public.get_daily_reward() as g1 \gset
select public.daily_check_in(gen_random_uuid()) as chk \gset
reset role;
select tests.assert(
  :'g0'::jsonb ?& array['day', 'claimable', 'streak_days', 'freezes_left', 'next_reset_at', 'cycle']
  and (:'g0'::jsonb ->> 'day')::int = 1 and (:'g0'::jsonb ->> 'claimable')::boolean
  and jsonb_array_length(:'g0'::jsonb -> 'cycle') = 7
  and (select bool_and(c ?& array['day', 'xp', 'cash_cents', 'skill_points']) and bool_and((c ->> 'day')::int = o)
         from jsonb_array_elements(:'g0'::jsonb -> 'cycle') with ordinality x(c, o))
  and (:'g0'::jsonb -> 'cycle' -> 0 ->> 'xp')::int = (public.config_jsonb('dailyRewards', '{cycle}') -> 0 ->> 'xp')::int,
  'get_daily_reward(): day 1 claimable for a new player, 7 cycle entries with base values');
select tests.assert(
  :'c1'::jsonb ?& array['day', 'xp', 'cash_cents', 'skill_points', 'streak_days', 'level', 'xp_total', 'leveled_up']
  and (:'c1'::jsonb ->> 'day')::int = 1 and (:'c1'::jsonb ->> 'streak_days')::int = 1
  and (:'c1'::jsonb ->> 'xp')::int = round(50 * public.config_double('progression', '{xpMultiplier}', 2))
  and (:'c1'::jsonb ->> 'cash_cents')::bigint = 10000
  and tests.cash(:d) = :dcash0 + 10000 and public.treasury_balance_cents() = :tr0 - 10000,
  'claim_daily_reward(): day 1 = 50 XP x multiplier and 100 EUR from the treasury (ledger), streak 1');
select tests.assert(
  (:'g1'::jsonb ->> 'day')::int = 2 and not (:'g1'::jsonb ->> 'claimable')::boolean
  and (:'g1'::jsonb ->> 'streak_days')::int = 1
  and (:'chk'::jsonb ->> 'already_checked_in')::boolean
  and exists (select 1 from public.daily_logins where player_id = :d and login_day = :'bday'::date),
  'after claiming: next day 2 shown, not claimable; the claim performed the daily check-in');

-- continue: yesterday was day 3 -> today day 4 (1 skill point)
select tests.reset_reward(:d, (:'bday'::date - 1), 3::smallint, 0::smallint);
select coalesce((select free_points from public.player_skill_points where player_id = :d), 0) as dsp0 \gset
select tests.login_as('authenticated', :d);
select public.claim_daily_reward(gen_random_uuid()) as c4 \gset
reset role;
select tests.assert(
  (:'c4'::jsonb ->> 'day')::int = 4 and (:'c4'::jsonb ->> 'skill_points')::int = 1
  and (:'c4'::jsonb ->> 'streak_days')::int = 6
  and (select free_points from public.player_skill_points where player_id = :d) = :dsp0 + 1,
  'claim_daily_reward(): consecutive day continues the cycle (3 -> 4), day 4 grants a free skill point');

-- day 7 wraps to day 1
select tests.reset_reward(:d, (:'bday'::date - 1), 7::smallint, 0::smallint);
select tests.login_as('authenticated', :d);
select public.get_daily_reward() ->> 'day' as gw \gset
select public.claim_daily_reward(gen_random_uuid()) ->> 'day' as cw \gset
reset role;
select tests.assert(:'gw'::int = 1 and :'cw'::int = 1, 'after day 7 the cycle starts again at day 1');

-- one missed day with a freeze left: continues, freeze used
select tests.reset_reward(:d, (:'bday'::date - 2), 4::smallint, 1::smallint);
select tests.login_as('authenticated', :d);
select public.get_daily_reward() as gf \gset
select public.claim_daily_reward(gen_random_uuid()) as cf \gset
select public.get_daily_reward() as gf2 \gset
reset role;
select tests.assert(
  (:'gf'::jsonb ->> 'day')::int = 5 and (:'gf'::jsonb ->> 'freezes_left')::int = 1
  and (:'cf'::jsonb ->> 'day')::int = 5 and (:'cf'::jsonb ->> 'freeze_used')::boolean
  and (:'cf'::jsonb ->> 'streak_days')::int = 6
  and (:'gf2'::jsonb ->> 'freezes_left')::int = 0,
  'one missed day with a freeze left: day continues (4 -> 5), the freeze is used up');

-- one missed day without a freeze: back to day 1
select tests.reset_reward(:d, (:'bday'::date - 2), 4::smallint, 0::smallint);
select tests.login_as('authenticated', :d);
select public.claim_daily_reward(gen_random_uuid()) as cr \gset
reset role;
select tests.assert(
  (:'cr'::jsonb ->> 'day')::int = 1 and not (:'cr'::jsonb ->> 'freeze_used')::boolean and (:'cr'::jsonb ->> 'streak_days')::int = 1,
  'one missed day without a freeze: the cycle resets to day 1');

-- two missed days: reset even with a freeze
select tests.reset_reward(:d, (:'bday'::date - 3), 5::smallint, 1::smallint);
select tests.login_as('authenticated', :d);
select public.claim_daily_reward(gen_random_uuid()) ->> 'day' as c2m \gset
reset role;
select tests.assert(:'c2m'::int = 1, 'two missed days: the cycle resets to day 1 even with a freeze');

-- request_id replay
select tests.reset_reward(:d, (:'bday'::date - 1), 1::smallint, 0::smallint);
select gen_random_uuid() as rq \gset
select tests.login_as('authenticated', :d);
select public.claim_daily_reward(:'rq') as r1 \gset
select public.claim_daily_reward(:'rq') as r2 \gset
reset role;
select tests.assert(:'r1'::jsonb = :'r2'::jsonb and (:'r1'::jsonb ->> 'day')::int = 2,
  'claim_daily_reward(): the same request_id replays the stored answer');

-- =============================================================================
-- C. Skills
-- =============================================================================
select tests.signup(:s, 'Sina_Skill') is not null as ok \gset
select tests.set_level(:s, 3);
select tests.give_points(:s, 0);
select tests.login_as('authenticated', :s);
select public.get_my_skills() as k0 \gset
select tests.throws_key($$select public.learn_skill(gen_random_uuid(), 'it_basics')$$, 'skill_points_insufficient', 'learn_skill(): no points');
select tests.throws_key($$select public.learn_skill(gen_random_uuid(), 'time_travel')$$, 'skill_unknown', 'learn_skill(): unknown key');
reset role;
select tests.assert(
  :'k0'::jsonb ?& array['free_points', 'branch_points', 'branch_progress', 'branch_scores', 'learned']
  and (select count(*) from jsonb_object_keys(:'k0'::jsonb -> 'branch_points')) = 8
  and (select count(*) from jsonb_object_keys(:'k0'::jsonb -> 'branch_progress')) = 8
  and (select count(*) from jsonb_object_keys(:'k0'::jsonb -> 'branch_scores')) = 8
  and (:'k0'::jsonb -> 'branch_scores') ?& array['it', 'finance', 'law', 'craft', 'sales', 'management', 'science', 'logistics']
  and jsonb_array_length(:'k0'::jsonb -> 'learned') = 0,
  'get_my_skills(): free points, all 8 branches for points, progress and scores, learned list');

update public.player_skill_points set free_points = 3, branch_points = '{"it": 2, "finance": 1}' where player_id = :s;
select tests.login_as('authenticated', :s);
select tests.throws_key($$select public.learn_skill(gen_random_uuid(), 'it_networks')$$, 'skill_locked', 'learn_skill(): not an entry field and no learned neighbour (ADR-061)');
select public.learn_skill(gen_random_uuid(), 'it_basics') as l1 \gset
select tests.throws_key($$select public.learn_skill(gen_random_uuid(), 'it_basics')$$, 'skill_learned', 'learn_skill(): already learned');
select public.learn_skill(gen_random_uuid(), 'it_programming') as l2 \gset
select public.learn_skill(gen_random_uuid(), 'finance_basics') as l3 \gset
reset role;
select tests.assert(
  :'l1'::jsonb ->> 'learned_key' = 'it_basics'
  and (:'l1'::jsonb -> 'branch_points' ->> 'it')::int = 1 and (:'l1'::jsonb ->> 'free_points')::int = 3
  and (:'l2'::jsonb -> 'branch_points' ->> 'it')::int = 0 and (:'l2'::jsonb ->> 'free_points')::int = 2
  and (:'l2'::jsonb -> 'branch_scores' ->> 'it')::int = 3
  and (:'l3'::jsonb -> 'branch_points' ->> 'finance')::int = 0 and (:'l3'::jsonb ->> 'free_points')::int = 2
  and jsonb_array_length(:'l3'::jsonb -> 'learned') = 3,
  'learn_skill(): cost by tier (1, 2), branch points of the skill''s branch first, then free points; scores = sum of scoreByTier');
select tests.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname ~ '(unlearn|forget|reset)_skill'),
  'skills are irreversible: no unlearn RPC');

-- level-ups grant free points (grant_xp hook)
select free_points as sp_before from public.player_skill_points where player_id = :s \gset
select public.grant_xp(:s, 'mission', 5000, 'test:m2b:levelup') as gx \gset
select tests.assert(
  (select free_points from public.player_skill_points where player_id = :s)
    = :sp_before + ((select level from public.profiles where id = :s) - 3) * public.config_double('skills', '{freePointsPerLevel}', 1)::int
  and (select level from public.profiles where id = :s) > 3,
  'grant_xp(): every level gained adds skills.freePointsPerLevel free points');

-- mission skill points: weekly and milestone 1, quick 0
select tests.assert(
  not exists (select 1 from public.mission_templates where mode is not null and kind in ('weekly', 'milestone') and reward_skill_points <> 1)
  and not exists (select 1 from public.mission_templates where mode is not null and kind in ('quick', 'daily') and reward_skill_points <> 0),
  'mission templates: weekly and milestones grant 1 skill point, quick and daily none');
select public.missions_assign(:s) >= 0 as ok \gset
update public.player_missions set status = 'completed', progress = target, completed_at = now()
 where player_id = :s and kind in ('weekly', 'quick') and status = 'active';
select id as wm from public.player_missions where player_id = :s and kind = 'weekly' and status = 'completed' limit 1 \gset
select id as qm from public.player_missions where player_id = :s and kind = 'quick' and status = 'completed' limit 1 \gset
select sp.free_points as sp_m, p.level as lv_m from public.player_skill_points sp join public.profiles p on p.id = sp.player_id where sp.player_id = :s \gset
select tests.login_as('authenticated', :s);
select public.claim_mission(gen_random_uuid(), :'wm') as cmw \gset
select public.claim_mission(gen_random_uuid(), :'qm') as cmq \gset
reset role;
select tests.assert(
  (:'cmw'::jsonb ->> 'skill_points')::int = 1 and (:'cmq'::jsonb ->> 'skill_points')::int = 0
  and (select free_points from public.player_skill_points where player_id = :s)
      = :sp_m + 1 + ((select level from public.profiles where id = :s) - :lv_m) * public.config_double('skills', '{freePointsPerLevel}', 1)::int,
  'claim_mission(): weekly mission adds 1 free skill point ("skill_points" in the answer), quick none');

-- =============================================================================
-- D. Jobs, player side (AI companies)
-- =============================================================================
select tests.login_as('authenticated', :w);
select public.get_job_board() as jb \gset
select public.get_job_board() as jb2 \gset
reset role;
select (q.game_year - 1) * 4 + (q.quarter - 1) as qseq, q.id as qid from public.current_game_quarter() q \gset
select tests.assert(
  :'jb'::jsonb ?& array['postings', 'next_refresh_at']
  and jsonb_array_length(:'jb'::jsonb -> 'postings')
      = public.config_double('jobs', '{aiPostingsPerCompany}', 2)::int
        * (select count(*) from public.companies where is_ai and phase = 'listed' and ticker is not null)
  and (select bool_and(x ?& array['id', 'company', 'tier', 'title_key', 'title', 'min_level', 'required', 'salary_cents_per_hour',
                                  'max_salary_cents_per_hour', 'match_score', 'eligible', 'slots_open', 'posted_at', 'expires_at',
                                  'my_application'])
              and bool_and((x -> 'company') ?& array['id', 'name', 'ticker', 'sector', 'color', 'is_ai'])
         from jsonb_array_elements(:'jb'::jsonb -> 'postings') x)
  and (select array_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(:'jb'::jsonb -> 'postings') x)
      = (select array_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(:'jb2'::jsonb -> 'postings') x),
  'get_job_board(): aiPostingsPerCompany postings per listed AI company with every field; refresh is idempotent');
select tests.assert(
  not exists (
    select 1
      from (select c.id, c.sector_key, (row_number() over (order by c.ticker) - 1)::int as ci
              from public.companies c where c.is_ai and c.phase = 'listed' and c.ticker is not null) c
      join public.job_postings p on p.company_id = c.id and p.is_ai and p.game_quarter_id = :qid
      cross join lateral (select public.config_jsonb('jobs', '{sectorBranches}') -> c.sector_key as list,
                                 public.config_jsonb('careers', '{tiers}') as tiers) l
      cross join lateral (select l.list ->> ((c.ci + p.ai_slot) % jsonb_array_length(l.list)) as branch,
                                 l.tiers -> ((2 * c.ci + p.ai_slot + :qseq) % 5) as tier) x
     where p.title_key <> x.branch || '_' || (x.tier ->> 'id')
        or p.tier::text <> x.tier ->> 'id'
        or p.title is not null
        or p.salary_cents_per_hour <> (x.tier ->> 'salaryCentsPerHour')::bigint
        or p.required -> 0 <> jsonb_build_object('branch', x.branch, 'min_score',
                                                 (public.config_jsonb('jobs', '{tierMinScore}') ->> (x.tier ->> 'id'))::int)
        or jsonb_array_length(p.required) <> case when x.tier ->> 'id' in ('team_lead', 'c_level') and x.branch <> 'management'
                                                  then 2 else 1 end
        or (jsonb_array_length(p.required) = 2 and p.required -> 1 <> jsonb_build_object('branch', 'management', 'min_score',
                                                 (public.config_jsonb('jobs', '{tierMinScore}') ->> (x.tier ->> 'id'))::int / 2)))
  and (select count(distinct tier) from public.job_postings where is_ai and game_quarter_id = :qid) = 5,
  'AI postings are deterministic: branch = sectorBranches[(c+i) % len], tier = tiers[(2c+i+q) % 5], min_score from tierMinScore');
select tests.assert(
  (select bool_and(x -> 'max_salary_cents_per_hour' is not null
                   and (x ->> 'slots_open')::int = public.config_double('jobs', '{aiSlotsOpen}', 99)::int)
     from jsonb_array_elements(:'jb'::jsonb -> 'postings') x where (x -> 'company' ->> 'is_ai')::boolean)
  and not exists (select 1 from jsonb_array_elements(:'jb'::jsonb -> 'postings') x where (x ->> 'eligible')::boolean
                    and x ->> 'tier' <> 'intern'),
  'board for a player without skills: AI ceilings shown, slots unlimited (jobs.aiSlotsOpen), only intern jobs eligible');

-- skills for Willi: it_basics + it_programming = IT score 3; fixture AI posting (it_junior at KlarSoft) for a stable test
insert into public.job_postings (company_id, tier, title_key, required, salary_cents_per_hour, is_ai, ai_slot, status,
                                 game_quarter_id, posted_at, expires_at)
select c.id, 'junior', 'it_junior', '[{"branch": "it", "min_score": 2}]', 30000, true, 99, 'open', :qid, q.starts_at, q.ends_at
  from public.companies c, public.current_game_quarter() q where c.ticker = 'KLS';
select tests.give_points(:w, 3);
select tests.login_as('authenticated', :w);
select public.learn_skill(gen_random_uuid(), 'it_basics') is not null as ok \gset
select public.learn_skill(gen_random_uuid(), 'it_programming') is not null as ok \gset
select x ->> 'id' as pj from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where x ->> 'title_key' = 'it_junior' and x -> 'company' ->> 'ticker' = 'KLS' and (x ->> 'eligible')::boolean limit 1 \gset
select x ->> 'id' as pj2, x ->> 'max_salary_cents_per_hour' as pj2max from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where (x ->> 'eligible')::boolean and x ->> 'id' <> :'pj' order by x ->> 'id' limit 1 \gset
select x ->> 'id' as psen from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where x ->> 'tier' = 'senior' order by x ->> 'id' limit 1 \gset
select x ->> 'id' as pnotit from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where x ->> 'tier' = 'junior' and not (x ->> 'eligible')::boolean order by x ->> 'id' limit 1 \gset
select public.apply_for_job(gen_random_uuid(), :'pj', 999999, 'Ich programmiere gern.') as ap1 \gset
select tests.throws_key(format($$select public.apply_for_job(gen_random_uuid(), %L, 30000, null)$$, :'pj'),
  'application_exists', 'apply_for_job(): one open application per posting');
select tests.throws_key(format($$select public.apply_for_job(gen_random_uuid(), %L, 30000, null)$$, :'psen'),
  'job_level_too_low', 'apply_for_job(): senior needs level 12');
select tests.throws_key(format($$select public.apply_for_job(gen_random_uuid(), %L, 30000, null)$$, :'pnotit'),
  'job_skills_missing', 'apply_for_job(): required branch score missing');
select tests.throws_key(format($$select public.apply_for_job(gen_random_uuid(), %L, 30000, 'Ich bin ein Arschloch')$$, :'pj2'),
  'name_profanity', 'apply_for_job(): the name filter applies to the message');
select tests.throws_key(format($$select public.apply_for_job(gen_random_uuid(), %L, 30000, repeat('x', 141))$$, :'pj2'),
  'invalid_argument', 'apply_for_job(): message longer than applicationMessageMaxLength');
select tests.throws_key($$select public.apply_for_job(gen_random_uuid(), gen_random_uuid(), 30000, null)$$,
  'job_not_found', 'apply_for_job(): unknown posting');
select public.apply_for_job(gen_random_uuid(), :'pj2', null, null) as ap2 \gset
select tests.throws_key(format($$select public.counter_offer(gen_random_uuid(), %L, 999999)$$, :'ap2'::jsonb ->> 'id'),
  'invalid_argument', 'counter_offer(): AI employers already offer their maximum (ADR-064)');
select public.withdraw_application(gen_random_uuid(), (:'ap2'::jsonb ->> 'id')::uuid) as wd2 \gset
select tests.throws_key(format($$select public.withdraw_application(gen_random_uuid(), %L)$$, :'ap2'::jsonb ->> 'id'),
  'application_not_found', 'withdraw_application(): only open applications');
select tests.throws_key(format($$select public.sign_contract(gen_random_uuid(), %L, 'M1 1')$$, :'ap2'::jsonb ->> 'id'),
  'application_not_offered', 'sign_contract(): declined application');
select public.get_my_applications() as ma \gset
reset role;
select tests.assert(
  :'ap1'::jsonb ?& array['id', 'status', 'posting', 'salary_wish_cents_per_hour', 'offer_salary_cents_per_hour',
                         'offer_expires_at', 'message', 'created_at', 'updated_at']
  and (:'ap1'::jsonb -> 'posting') ?& array['id', 'company', 'tier', 'title_key', 'title', 'required']
  and :'ap1'::jsonb ->> 'status' = 'offered'
  and (:'ap1'::jsonb ->> 'offer_salary_cents_per_hour')::bigint = public.ai_salary_ceiling(30000, 3)
  and public.ai_salary_ceiling(30000, 3) = 32700
  and (:'ap1'::jsonb ->> 'offer_expires_at')::timestamptz between now() + interval '47 hours' and now() + interval '49 hours',
  'apply_for_job() at an AI company: offered at once, offer = min(wish, base x (1 + 3% x match 3)) = 327 EUR, valid 48 h');
select tests.assert(
  (:'ap2'::jsonb ->> 'offer_salary_cents_per_hour')::bigint = :pj2max and :'ap2'::jsonb ->> 'status' = 'offered'
  and :'wd2'::jsonb ->> 'status' = 'declined'
  and jsonb_array_length(:'ma'::jsonb -> 'applications') = 2
  and (:'ma'::jsonb -> 'applications' -> 0 ->> 'id') = :'ap2'::jsonb ->> 'id',
  'AI offer = personal ceiling without a wish (ADR-064); withdraw of an offer = declined; newest first');

-- application limit (maxOpenApplications = 5): fill with intern applications from another player
select tests.give_points(:f, 0);
select tests.login_as('authenticated', :f);
do $$
declare
  r record;
  n integer := 0;
begin
  for r in select x ->> 'id' as id from jsonb_array_elements(public.get_job_board() -> 'postings') x
            where (x ->> 'eligible')::boolean order by x ->> 'id' loop
    n := n + 1;
    if n <= 5 then
      perform public.apply_for_job(gen_random_uuid(), r.id::uuid, 10000, null);
    else
      perform tests.throws_key(format('select public.apply_for_job(gen_random_uuid(), %L, 10000, null)', r.id),
                               'application_limit', 'apply_for_job(): at most maxOpenApplications open applications');
      exit;
    end if;
  end loop;
  perform tests.assert(n = 6, 'enough eligible intern postings for the limit test (' || n || ')');
end;
$$;
reset role;

-- expired offer
update public.job_applications set offer_expires_at = now() - interval '1 minute'
 where player_id = :f and status = 'offered' and id = (select id from public.job_applications where player_id = :f order by id limit 1);
select id as fexp from public.job_applications where player_id = :f and offer_expires_at < now() \gset
select tests.login_as('authenticated', :f);
select tests.throws_key(format($$select public.sign_contract(gen_random_uuid(), %L, 'M1 1')$$, :'fexp'),
  'offer_expired', 'sign_contract(): expired offer');
select public.get_my_applications() as fma \gset
reset role;
select tests.assert(
  (select x ->> 'status' from jsonb_array_elements(:'fma'::jsonb -> 'applications') x where x ->> 'id' = :'fexp') = 'expired',
  'an offer past offer_expires_at reads as expired');

-- sign the AI contract
select tests.cash(:w) as wcash0 \gset
select tests.login_as('authenticated', :w);
select public.sign_contract(gen_random_uuid(), (:'ap1'::jsonb ->> 'id')::uuid, 'M10 10 L20 20') as sg \gset
select tests.throws_key(format($$select public.sign_contract(gen_random_uuid(), %L, 'M1 1')$$, :'ap1'::jsonb ->> 'id'),
  'application_not_offered', 'sign_contract(): already signed');
select public.get_my_job() as mj \gset
select public.get_player_card('WILLI_WERK') as card \gset
select tests.throws_key($$select public.get_player_card('niemand_hier')$$, 'player_not_found', 'get_player_card(): unknown nickname');
reset role;
select id as wjob, company_id as wco from public.player_jobs where player_id = :w and status = 'active' \gset
select tests.assert(
  :'sg'::jsonb = :'mj'::jsonb
  and (:'mj'::jsonb -> 'job') ?& array['id', 'company', 'tier', 'title_key', 'title', 'required', 'salary_cents_per_hour',
                                      'pay_factor_bps', 'effective_salary_cents_per_hour', 'productivity_bps', 'started_at',
                                      'paid_hours_today', 'paid_hours_cap', 'earned_total_cents', 'raise_available_at',
                                      'raise_max_bps', 'pending_raise', 'quit_cost_cents', 'signature']
  and (:'mj'::jsonb -> 'job' ->> 'salary_cents_per_hour')::bigint = 32700
  and (:'mj'::jsonb -> 'job' ->> 'pay_factor_bps')::int = 10000
  and (:'mj'::jsonb -> 'job' ->> 'productivity_bps')::int = 15000 + 800 * 3
  and (:'mj'::jsonb -> 'job' ->> 'raise_max_bps')::int = 0
  and (:'mj'::jsonb -> 'job' ->> 'quit_cost_cents')::bigint = 0 and :'mj'::jsonb -> 'job' ? 'notice_ends_at'
  and :'mj'::jsonb -> 'job' ->> 'signature' = 'M10 10 L20 20'
  and (select status from public.job_applications where id = (:'ap1'::jsonb ->> 'id')::uuid) = 'signed',
  'sign_contract() returns the get_my_job shape: base wage, pay factor, productivity 1.5 + 0.08 x match, no quit cost (ADR-063)');
select tests.assert(
  :'card'::jsonb ?& array['nickname', 'avatar_key', 'level', 'rank', 'net_worth_cents', 'streak_days', 'skills_learned',
                          'branch_scores', 'top_skills', 'job', 'company', 'member_since']
  and :'card'::jsonb ->> 'nickname' = 'Willi_Werk' and (:'card'::jsonb ->> 'skills_learned')::int = 2
  and (:'card'::jsonb -> 'branch_scores' ->> 'it')::int = 3
  and :'card'::jsonb -> 'top_skills' = '[{"key": "it_programming", "tier": 2}, {"key": "it_basics", "tier": 1}]'::jsonb
  and :'card'::jsonb -> 'job' ->> 'title_key' = 'it_junior' and :'card'::jsonb -> 'company' = 'null'::jsonb,
  'get_player_card(): case-insensitive, skills, top skills by tier, current job');

-- a second contract is not possible
select tests.login_as('authenticated', :w);
select public.apply_for_job(gen_random_uuid(), :'pj2', 20000, null) as ap3 \gset
select tests.throws_key(format($$select public.sign_contract(gen_random_uuid(), %L, 'M1 1')$$, :'ap3'::jsonb ->> 'id'),
  'job_active_exists', 'sign_contract(): only one active job');
reset role;

-- salary accrual from the company's cash
select tests.company_cash(:'wco') as cc0 \gset
select tests.cash(:w) as wc1 \gset
select coalesce(sum(amount), 0) as wxp0 from public.xp_events where player_id = :w and source = 'work_hour' \gset
update public.player_jobs set last_paid_at = (:'bday'::date + time '01:00') at time zone 'Europe/Berlin',
       paid_day = :'bday'::date, paid_minutes_today = 0 where id = :'wjob';
select public.accrue_job_salary(:'wjob', (:'bday'::date + time '08:00') at time zone 'Europe/Berlin') as paid7 \gset
select tests.assert(
  :paid7::bigint = 32700 * 7 and tests.cash(:w) = :wc1 + 32700 * 7 and tests.company_cash(:'wco') = :cc0 - 32700 * 7
  and (select sum(amount) from public.xp_events where player_id = :w and source = 'work_hour') - :wxp0
      = round(7 * public.config_double('progression', '{xpSources,workHour,xp}', 40) * public.config_double('progression', '{xpMultiplier}', 2))
  and (select (branch_points ->> 'it')::int from public.player_skill_points where player_id = :w) = 1
  and (select (branch_work_minutes ->> 'it')::int from public.player_skill_points where player_id = :w) = 420,
  'accrual: 7 h x contract wage from the AI company''s cash (ledger), work XP per hour, 6 work hours = 1 IT branch point');
select public.accrue_job_salary(:'wjob', (:'bday'::date + time '22:00') at time zone 'Europe/Berlin') as paid20 \gset
select tests.assert(:paid20::bigint = 32700 * 5
  and (select paid_minutes_today from public.player_jobs where id = :'wjob') = 720,
  'accrual: at most careers.paidHoursPerDayCap (12) paid hours per day');
select tests.login_as('authenticated', :w);
select public.get_my_job() -> 'job' as mj2 \gset
select public.get_my_skills() as wsk \gset
reset role;
select tests.assert(
  (:'mj2'::jsonb ->> 'earned_total_cents')::bigint = 32700 * 12
  and (:'wsk'::jsonb -> 'branch_progress' ->> 'it')::numeric between 0 and 1,
  'get_my_job(): earned_total_cents; get_my_skills(): branch_progress fraction to the next point');

-- raise: learn it_networks (match 3 -> 4), AI caps at the ceiling
select tests.login_as('authenticated', :w);
select public.learn_skill(gen_random_uuid(), 'it_networks') is not null as ok \gset
select (public.get_my_job() -> 'job' ->> 'raise_max_bps')::int as rmax \gset
select tests.throws_key(format($$select public.request_raise(gen_random_uuid(), %s)$$, :rmax + 1), 'raise_too_high',
  'request_raise(): above raise_max_bps');
select public.request_raise(gen_random_uuid(), :rmax) as rr \gset
select tests.throws_key($$select public.request_raise(gen_random_uuid(), 1)$$, 'raise_too_soon', 'request_raise(): cooldown');
select public.get_my_job() -> 'job' as mj3 \gset
reset role;
select tests.assert(
  :rmax = least(300, floor((public.ai_salary_ceiling(30000, 4)::numeric / 32700 - 1) * 10000)::int)
  and :'rr'::jsonb ->> 'status' = 'accepted'
  and (:'rr'::jsonb ->> 'salary_cents_per_hour')::bigint <= public.ai_salary_ceiling(30000, 4)
  and (:'rr'::jsonb ->> 'salary_cents_per_hour')::bigint > 32700
  and (:'mj3'::jsonb ->> 'raise_available_at')::timestamptz > now() + interval '6 days'
  and (:'mj3'::jsonb ->> 'raise_max_bps')::int = 0,
  'request_raise() at an AI company: accepted at once up to the personal ceiling, then 7 days cooldown');

-- quit with one day notice (ADR-063): no payment, the job ends when the notice is over
select tests.cash(:w) as wc2 \gset
select tests.login_as('authenticated', :w);
select public.quit_job(gen_random_uuid()) as qj \gset
select coalesce(public.cancel_quit(gen_random_uuid()) -> 'job' ->> 'notice_ends_at', 'none') as qcancel \gset
select public.quit_job(gen_random_uuid()) is not null as ok \gset
reset role;
update public.player_jobs set notice_ends_at = now() - interval '1 minute', last_paid_at = now() - interval '1 minute'
 where id = :'wjob';
select public.process_quit_notices() as qn \gset
select tests.login_as('authenticated', :w);
select public.get_my_job() as mj4 \gset
select tests.throws_key($$select public.quit_job(gen_random_uuid())$$, 'no_active_job', 'quit_job(): no job');
select tests.throws_key($$select public.request_raise(gen_random_uuid(), 10)$$, 'no_active_job', 'request_raise(): no job');
reset role;
select tests.assert(
  (:'qj'::jsonb ->> 'notice_ends_at')::timestamptz between now() + interval '23 hours' and now() + interval '25 hours'
  and :'qcancel' = 'none' and :qn::int >= 1
  and tests.cash(:w) >= :wc2::bigint
  and :'mj4'::jsonb = '{"job": null}'::jsonb
  and (select end_reason from public.player_jobs where id = :'wjob') = 'quit',
  'quit_job(): one day notice without payment, cancel_quit() takes it back, the job ends after the notice');

-- =============================================================================
-- E. Employer side (fixture company owned by Erna)
-- =============================================================================
insert into public.companies (id, name, slug, sector_key, legal_form, founder_id, shares_outstanding)
values ('0a2b2b2b-0000-4000-8000-0000000000c1', 'Erna Code GmbH', 'erna-code', 'tech', 'gmbh', :e, 1000);
insert into public.ledger_accounts (kind, owner_company_id) values ('company_cash', '0a2b2b2b-0000-4000-8000-0000000000c1');
\set co '''0a2b2b2b-0000-4000-8000-0000000000c1'''
select public.ledger_transfer(public.ledger_system_account('households'),
  (select id from public.ledger_accounts where owner_company_id = :co and kind = 'company_cash'), 100000000, 'transfer',
  'Testkapital', 'company', :co, 'test:m2b:company') is not null as ok \gset

select tests.login_as('authenticated', :w);
select tests.throws_key(format($$select public.create_job_posting(gen_random_uuid(), %L, 'junior', 'Backend', '[{"branch":"it","min_score":2}]', 20000, 1)$$, :co),
  'employer_only', 'create_job_posting(): only the owner');
select tests.throws_key(format($$select public.get_company_applications(%L)$$, :co), 'employer_only', 'get_company_applications(): only the owner');
select tests.throws_key(format($$select public.get_company_team(%L)$$, :co), 'employer_only', 'get_company_team(): only the owner');
reset role;
select tests.login_as('authenticated', :e);
select tests.throws_key(format($$select public.create_job_posting(gen_random_uuid(), (select id from public.companies where ticker = 'KLS'), 'junior', 'Backend', '[{"branch":"it","min_score":2}]', 20000, 1)$$),
  'employer_only', 'create_job_posting(): never for AI companies');
select tests.throws_key(format($$select public.create_job_posting(gen_random_uuid(), %L, 'boss', 'Backend', '[{"branch":"it","min_score":2}]', 20000, 1)$$, :co),
  'invalid_argument', 'create_job_posting(): unknown tier');
select tests.throws_key(format($$select public.create_job_posting(gen_random_uuid(), %L, 'junior', 'Backend', '[{"branch":"magic","min_score":2}]', 20000, 1)$$, :co),
  'invalid_argument', 'create_job_posting(): unknown branch');
select public.create_job_posting(gen_random_uuid(), :co, 'junior', 'Backend-Entwicklung',
  '[{"branch":"it","min_score":2},{"branch":"management","min_score":0}]', 24000, 1) as cp \gset
select public.create_job_posting(gen_random_uuid(), :co, 'intern', 'Praktikum Vertrieb', '[{"branch":"sales","min_score":0}]', 9000, 2) as cp2 \gset
reset role;
select tests.assert(
  :'cp'::jsonb ->> 'title' = 'Backend-Entwicklung' and :'cp'::jsonb ->> 'title_key' is null
  and not (:'cp'::jsonb -> 'company' ->> 'is_ai')::boolean and (:'cp'::jsonb ->> 'slots')::int = 1,
  'create_job_posting(): own title, slots, player company');

select tests.login_as('authenticated', :w);
select public.get_job_board() as jbw \gset
select public.apply_for_job(gen_random_uuid(), (:'cp'::jsonb ->> 'id')::uuid, 26000, 'Gern bei Erna.') as pa \gset
reset role;
select tests.assert(
  (select x -> 'max_salary_cents_per_hour' = 'null'::jsonb and (x ->> 'slots_open')::int = 1 and (x ->> 'eligible')::boolean
     from jsonb_array_elements(:'jbw'::jsonb -> 'postings') x where x ->> 'id' = :'cp'::jsonb ->> 'id')
  and :'pa'::jsonb ->> 'status' = 'pending' and :'pa'::jsonb -> 'offer_salary_cents_per_hour' = 'null'::jsonb,
  'player company posting on the board (no AI ceiling, slots_open); application stays pending');

select tests.login_as('authenticated', :e);
select public.get_company_applications(:co) as ca \gset
select public.respond_application(gen_random_uuid(), (:'pa'::jsonb ->> 'id')::uuid, 'counter', 22000) as rc \gset
reset role;
select tests.login_as('authenticated', :w);
select public.counter_offer(gen_random_uuid(), (:'pa'::jsonb ->> 'id')::uuid, 24000) as wco2 \gset
reset role;
select tests.login_as('authenticated', :e);
select public.respond_application(gen_random_uuid(), (:'pa'::jsonb ->> 'id')::uuid, 'accept') as racc \gset
select tests.throws_key(format($$select public.respond_application(gen_random_uuid(), %L, 'reject')$$, :'pa'::jsonb ->> 'id'),
  'application_not_found', 'respond_application(): only pending applications');
reset role;
select tests.assert(
  (select x -> 'applicant' ?& array['nickname', 'avatar_key', 'level', 'branch_scores', 'match_score']
          and x -> 'applicant' ->> 'nickname' = 'Willi_Werk' and (x -> 'applicant' ->> 'match_score')::int = 4
     from jsonb_array_elements(:'ca'::jsonb -> 'applications') x where x ->> 'id' = :'pa'::jsonb ->> 'id')
  and :'rc'::jsonb ->> 'status' = 'offered' and (:'rc'::jsonb ->> 'offer_salary_cents_per_hour')::bigint = 22000
  and :'wco2'::jsonb ->> 'status' = 'pending'
  and :'racc'::jsonb ->> 'status' = 'offered' and (:'racc'::jsonb ->> 'offer_salary_cents_per_hour')::bigint = 24000,
  'employer: applications with applicant summary; counter -> offered at 220 EUR; player counters -> pending; accept -> offered at the wish');

select tests.login_as('authenticated', :w);
select public.sign_contract(gen_random_uuid(), (:'pa'::jsonb ->> 'id')::uuid, 'M0 0 L5 5') as sg2 \gset
reset role;
select id as ejob from public.player_jobs where player_id = :w and status = 'active' \gset
select tests.assert(
  (:'sg2'::jsonb -> 'job' ->> 'salary_cents_per_hour')::bigint = 24000 and :'sg2'::jsonb -> 'job' ->> 'title' = 'Backend-Entwicklung'
  and (select status from public.job_applications where id = (:'ap3'::jsonb ->> 'id')::uuid) = 'closed',
  'sign_contract() at a player company; other open applications are closed');

-- slots: the single slot is taken
select tests.login_as('authenticated', :f);
select tests.throws_key(format($$select public.apply_for_job(gen_random_uuid(), %L, 24000, null)$$, :'cp'::jsonb ->> 'id'),
  'job_skills_missing', 'player company posting: required skills are checked as well');
reset role;

-- accrual from company cash, XP with the player company multiplier, pay factor when the company runs dry
select tests.company_cash(:co) as ec0 \gset
select coalesce(sum(amount), 0) as exp0 from public.xp_events where player_id = :w and source = 'work_hour' \gset
update public.player_jobs set last_paid_at = (:'bday'::date + time '01:00') at time zone 'Europe/Berlin',
       paid_day = :'bday'::date, paid_minutes_today = 0 where id = :'ejob';
select public.accrue_job_salary(:'ejob', (:'bday'::date + time '03:00') at time zone 'Europe/Berlin') as ep2 \gset
select tests.assert(
  :ep2::bigint = 48000 and tests.company_cash(:co) = :ec0 - 48000
  and (select sum(amount) from public.xp_events where player_id = :w and source = 'work_hour') - :exp0
      = round(2 * public.config_double('progression', '{xpSources,workHour,xp}', 40)
                * public.config_double('progression', '{xpSources,workHour,playerCompanyMultiplier}', 1.5)
                * public.config_double('progression', '{xpMultiplier}', 2)),
  'player company: wage from the company cash, work XP x playerCompanyMultiplier');
select public.ledger_transfer((select id from public.ledger_accounts where owner_company_id = :co and kind = 'company_cash'),
  public.ledger_system_account('households'), tests.company_cash(:co) - 36000, 'transfer', 'Test: Kasse leeren', 'company', :co,
  'test:m2b:drain') is not null as ok \gset
select tests.cash(:e) as ecash \gset
select public.accrue_job_salary(:'ejob', (:'bday'::date + time '06:00') at time zone 'Europe/Berlin') as ep3 \gset
select tests.assert(
  :ep3::bigint = 36000 and tests.company_cash(:co) = 0 and tests.cash(:e) = :ecash
  and (select pay_factor_bps from public.player_jobs where id = :'ejob') = 5000,
  'player company short of cash: pays what it can (pay_factor_bps 5000), never from the owner''s private account');

-- raise at a player company: pending, employer decides
select tests.give_points(:w, 1);
select tests.login_as('authenticated', :w);
select public.learn_skill(gen_random_uuid(), 'management_basics') is not null as ok \gset
select public.get_my_job() -> 'job' ->> 'raise_max_bps' as ermax \gset
select public.request_raise(gen_random_uuid(), 250) as err \gset
reset role;
select tests.login_as('authenticated', :e);
select public.get_company_team(:co) as team \gset
select public.respond_raise(gen_random_uuid(), :'ejob', true) as rra \gset
select tests.throws_key(format($$select public.respond_raise(gen_random_uuid(), %L, true)$$, :'ejob'),
  'invalid_argument', 'respond_raise(): nothing pending');
reset role;
select tests.assert(
  :'ermax'::int = 300 and :'err'::jsonb = '{"status": "pending", "salary_cents_per_hour": 24000}'::jsonb
  and jsonb_array_length(:'team'::jsonb -> 'members') = 1
  and (:'team'::jsonb -> 'members' -> 0) ?& array['player_job_id', 'nickname', 'avatar_key', 'title', 'salary_cents_per_hour',
                                                 'productivity_bps', 'started_at', 'pending_raise']
  and (:'team'::jsonb -> 'members' -> 0 -> 'pending_raise' ->> 'requested_bps')::int = 250
  and :'rra'::jsonb = '{"status": "accepted", "salary_cents_per_hour": 24600}'::jsonb,
  'request_raise() at a player company: pending; get_company_team() shows it; respond_raise(accept) raises 240 -> 246 EUR');
select tests.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname ~ '(lower|cut|reduce)_(salary|wage)'),
  'the employer can never lower a wage (no RPC)');

-- fire: one salary severance from the company; insufficient cash first
select tests.login_as('authenticated', :e);
select tests.throws_key(format($$select public.fire_employee(gen_random_uuid(), %L)$$, :'ejob'),
  'insufficient_funds', 'fire_employee(): severance needs company cash');
reset role;
select public.ledger_transfer(public.ledger_system_account('households'),
  (select id from public.ledger_accounts where owner_company_id = :co and kind = 'company_cash'), 1000000, 'transfer',
  'Testkapital 2', 'company', :co, 'test:m2b:company2') is not null as ok \gset
select tests.cash(:w) as wc3 \gset
select tests.login_as('authenticated', :e);
select public.fire_employee(gen_random_uuid(), :'ejob') as fe \gset
select tests.throws_key(format($$select public.fire_employee(gen_random_uuid(), %L)$$, :'ejob'),
  'no_active_job', 'fire_employee(): already ended');
select public.close_job_posting(gen_random_uuid(), (:'cp2'::jsonb ->> 'id')::uuid) as cl \gset
reset role;
select tests.assert(
  (:'fe'::jsonb ->> 'severance_cents')::bigint = 24600 * 12 and :'fe'::jsonb ->> 'status' = 'fired'
  and tests.cash(:w) >= :wc3 + 24600 * 12
  and (select end_reason from public.player_jobs where id = :'ejob') = 'fired'
  and :'cl'::jsonb ->> 'status' = 'closed',
  'fire_employee(): one salary severance company -> employee; close_job_posting()');
select tests.login_as('authenticated', :f);
select tests.throws_key(format($$select public.apply_for_job(gen_random_uuid(), %L, 9000, null)$$, :'cp2'::jsonb ->> 'id'),
  'job_not_found', 'apply_for_job(): closed posting');
select tests.throws_key(format($$select public.close_job_posting(gen_random_uuid(), %L)$$, :'cp'::jsonb ->> 'id'),
  'employer_only', 'close_job_posting(): only the owner');
select tests.throws_key(format($$select public.respond_raise(gen_random_uuid(), %L, true)$$, :'wjob'),
  'no_active_job', 'respond_raise(): ended job');
reset role;

-- =============================================================================
-- RLS and the money system
-- =============================================================================
select tests.login_as('authenticated', :w);
select tests.throws($$insert into public.player_skills (player_id, skill_key) values (auth.uid(), 'it_ai')$$, '42501',
  'player_skills: no direct inserts');
select tests.throws($$update public.player_skill_points set free_points = 99$$, '42501', 'player_skill_points: no direct updates');
select tests.throws($$insert into public.job_postings (company_id, tier, title, required, salary_cents_per_hour) values
  ('0a2b2b2b-0000-4000-8000-0000000000c1', 'junior', 'Hack', '[{"branch":"it","min_score":0}]', 1)$$, '42501',
  'job_postings: no direct inserts');
select tests.assert(not has_column_privilege('authenticated', 'public.profiles', 'avatar_key', 'UPDATE'),
  'profiles.avatar_key only via set_avatar()');
select count(*) as other_apps from public.job_applications where player_id <> auth.uid() \gset
select count(*) as other_sp from public.player_skill_points where player_id <> auth.uid() \gset
select count(*) as vis_post from public.job_postings \gset
reset role;
select tests.assert(:other_apps = 0 and :other_sp = 0 and :vis_post > 0,
  'RLS: applications and skill points owner-only, postings public');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after M2b flows (salaries, quit, severance, rewards)');
