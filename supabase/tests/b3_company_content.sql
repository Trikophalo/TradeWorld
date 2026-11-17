-- =============================================================================
-- b3 · More company content (ADR-173): eight new task games, new business moves (tiers, listed only) and CEO
--      interviews (request, answer, decline, expiry, moderation, capped effects, aired once in the show)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''0b30b30b-0000-4000-8000-0000000000f1'''
\set g '''0b30b30b-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:f, 'Ceo_Clara') is not null and tests.signup(:g, 'Ceo_Gustav') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 20);
select tests.set_level(:g, 20);
select tests.fund(:f, 900000000, 'test:b3:f');
select tests.fund(:g, 90000000, 'test:b3:g');

-- =============================================================================
-- A. Task games: puzzles of every new game and the grading rules (same as src/lib/sim/company-tasks.ts)
-- =============================================================================
create or replace function tests.b3_puzzle(p_game text) returns jsonb language sql as $$
  select public.company_task_puzzle(t)
    from jsonb_array_elements((select value -> 'tasks' from public.game_config where key = 'companyTasks')) t
   where t ->> 'game' = p_game limit 1 $$;
grant execute on all functions in schema tests to public;

select tests.assert(
  (select count(distinct t ->> 'game') from jsonb_array_elements((select value -> 'tasks' from public.game_config where key = 'companyTasks')) t
    where t ->> 'game' in ('memory', 'timing', 'diff', 'quick', 'route', 'haggle', 'pack', 'catch')) = 8
  and (select count(*) from jsonb_array_elements((select value -> 'tasks' from public.game_config where key = 'companyTasks')) t
        where t ->> 'game' in ('memory', 'timing', 'diff', 'quick', 'route', 'haggle', 'pack', 'catch')) >= 16,
  'config: eight new games, each with tasks');

select tests.b3_puzzle('memory') as pm, tests.b3_puzzle('timing') as pt, tests.b3_puzzle('diff') as pd,
       tests.b3_puzzle('quick') as pq, tests.b3_puzzle('route') as pr, tests.b3_puzzle('haggle') as ph,
       tests.b3_puzzle('pack') as pp, tests.b3_puzzle('catch') as pc \gset
select tests.assert(
  jsonb_array_length(:'pm'::jsonb #> '{puzzle,cards}') = 8
  and public.company_task_grade('timing', :'pt'::jsonb -> 'solution', jsonb_build_object('stops', :'pt'::jsonb #> '{puzzle,targets}')) = 10000
  and public.company_task_grade('diff', :'pd'::jsonb -> 'solution', jsonb_build_object('picked', :'pd'::jsonb #> '{solution,targets}')) = 10000
  and (select count(*) from jsonb_array_elements(:'pd'::jsonb #> '{puzzle,left}') with ordinality l(v, i)
         join jsonb_array_elements(:'pd'::jsonb #> '{puzzle,right}') with ordinality r(v, i) using (i) where l.v <> r.v)
      = jsonb_array_length(:'pd'::jsonb #> '{solution,targets}')
  and public.company_task_grade('quick', :'pq'::jsonb -> 'solution', :'pq'::jsonb -> 'solution') = 10000
  and (select bool_and((p -> 'options' -> (c #>> '{}')::int)::int
                       = case p ->> 'op' when 'add' then (p ->> 'a')::int + (p ->> 'b')::int when 'mul' then (p ->> 'a')::int * (p ->> 'b')::int
                                         when 'sub' then (p ->> 'a')::int - (p ->> 'b')::int else (p ->> 'a')::int * (p ->> 'b')::int / 100 end)
         from jsonb_array_elements(:'pq'::jsonb #> '{puzzle,problems}') with ordinality x(p, i)
         join jsonb_array_elements(:'pq'::jsonb #> '{solution,choices}') with ordinality y(c, i) using (i))
  and jsonb_array_length(:'pr'::jsonb #> '{puzzle,points}') = 5
  and (:'pr'::jsonb #>> '{solution,best}')::int > 0
  and public.company_task_grade('haggle', :'ph'::jsonb -> 'solution', jsonb_build_object('choices',
        (select jsonb_agg((select o - 1 from jsonb_array_elements(r) with ordinality z(v, o) where v = '0'::jsonb) order by i)
           from jsonb_array_elements(:'ph'::jsonb #> '{puzzle,rounds}') with ordinality x(r, i)))) = 10000
  and (:'pp'::jsonb #>> '{solution,best}')::int > 0
  and public.company_task_grade('catch', :'pc'::jsonb -> 'solution', jsonb_build_object('picked', :'pc'::jsonb #> '{solution,targets}')) = 10000
  and jsonb_array_length(:'pc'::jsonb #> '{solution,targets}') >= 2,
  'company_task_puzzle(): every new game builds a solvable puzzle; the perfect answer scores 10 000');

select tests.assert(
  public.company_task_grade('memory', '{"cards": [0, 1, 0, 1], "miss_bps": 500}', '{"pairs": [[0, 2], [1, 3]], "misses": 1}') = 9500
  and public.company_task_grade('memory', '{"cards": [0, 1, 0, 1], "miss_bps": 500}', '{"pairs": [[0, 2], [0, 2], [0, 1]], "misses": 0}') = 5000
  and public.company_task_grade('memory', '{"cards": [0, 1, 0, 1], "miss_bps": 500}', '{"pairs": "x"}') = 0
  and public.company_task_grade('route', '{"points": [[0,0],[3,0],[0,3],[3,3],[1,0]], "best": 12, "step_bps": 1000}', '{"order": [1, 2, 3, 4]}') = 4000
  and public.company_task_route_best('[[0,0],[3,0],[0,3],[3,3],[1,0]]') = 12
  and public.company_task_grade('route', '{"points": [[0,0],[3,0],[0,3],[3,3],[1,0]], "best": 12, "step_bps": 1000}', '{"order": [1, 1, 3, 4]}') = 0
  and public.company_task_grade('pack', '{"weights": [5,4,3,2], "values": [10,8,4,5], "cap": 7, "best": 15}', '{"picked": [1, 2]}') = 8000
  and public.company_task_grade('pack', '{"weights": [5,4,3,2], "values": [10,8,4,5], "cap": 7, "best": 15}', '{"picked": [0, 1]}') = 0
  and public.company_task_pack_best('{5,4,3,2}', '{10,8,4,5}', 7) = 15
  and public.company_task_grade('haggle', '{"rounds": [[2,0,1],[0,1,2],[1,2,0]], "ok_bps": 5000}', '{"choices": [2, 1, 0]}') = 5000
  and public.company_task_grade('haggle', '{"rounds": [[2,0,1],[0,1,2],[1,2,0]], "ok_bps": 5000}', '{"choices": [9, 0, 2]}') = 6666
  and public.company_task_grade('timing', '{"stops": [50, 50, 50], "tolerance": 5}', '{"stops": [55, 40, 80]}') = 5000,
  'company_task_grade(): memory, route, pack, haggle and timing score like the client rules (ADR-173)');

-- =============================================================================
-- B. Business moves: tiers, listed only, a new move runs and pays out
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Clara Werke', 'Interviews und Züge', 'tech', '#336699', 'garage') is not null as ok \gset
select public.company_deposit(gen_random_uuid(), 500000000) is not null as ok \gset
select public.get_company_moves() as mv \gset
reset role;
select tests.company_of(:f) as co \gset
select tests.assert(
  exists (select 1 from jsonb_array_elements(:'mv'::jsonb -> 'moves') m where m ->> 'key' = 'supplier_switch')
  and not exists (select 1 from jsonb_array_elements(:'mv'::jsonb -> 'moves') m
                   where m ->> 'key' in ('trade_fair', 'patent_filing', 'tv_commercial', 'bond_issue', 'capital_markets_day', 'buyback_signal')),
  'company_moves_state(): a garage sees the new moves for everyone, not those from a tier on or for listed companies');
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.start_company_move(gen_random_uuid(), 'tv_commercial')$$, 'move_unknown',
  'start_company_move(): a move above the tier is unknown');
select public.start_company_move(gen_random_uuid(), 'supplier_switch') -> 'running' -> 0 ->> 'id' as run_id \gset
reset role;
select balance_cents as cash0 from public.ledger_accounts where id = public.company_cash_account(:'co') \gset
update public.company_moves set chance_bps = 10000, ends_at = now() - interval '1 minute' where id = :'run_id'::bigint;
select public.company_moves_run_due(now()) is not null as ok \gset
select tests.assert(
  (select status = 'success' and payout_cents = round(cost_cents * 15000 / 10000.0) from public.company_moves where id = :'run_id'::bigint)
  and (select balance_cents from public.ledger_accounts where id = public.company_cash_account(:'co'))
      = :cash0 + (select payout_cents from public.company_moves where id = :'run_id'::bigint),
  'a new cash move (normal risk) pays cost x 1.5 into the company cash');
update public.player_companies set tier = 'ag' where company_id = :'co';
select tests.login_as('authenticated', :f);
select public.get_company_moves() as mv \gset
select public.start_company_move(gen_random_uuid(), 'bond_issue') -> 'running' as running \gset
reset role;
select tests.assert(
  exists (select 1 from jsonb_array_elements(:'mv'::jsonb -> 'moves') m where m ->> 'key' = 'tv_commercial')
  and exists (select 1 from jsonb_array_elements(:'mv'::jsonb -> 'moves') m where m ->> 'key' = 'bond_issue'
                and (m ->> 'cost_cents')::bigint = round(6000000 * 1.8))
  and not exists (select 1 from jsonb_array_elements(:'mv'::jsonb -> 'moves') m where m ->> 'key' = 'capital_markets_day')
  and exists (select 1 from jsonb_array_elements(:'running'::jsonb) r where r ->> 'key' = 'bond_issue'),
  'an AG sees and starts the moves from its tier on (cost = tier base x factor), still not the listed-only ones');
update public.player_companies set tier = 'garage' where company_id = :'co';

-- =============================================================================
-- C. CEO interviews
-- =============================================================================
select value as icfg from public.game_config where key = 'interviews' \gset
select term as badword from public.blocked_name_terms where category <> 'reserved' and match_mode in ('token', 'substring') order by term limit 1 \gset
select tests.assert(
  jsonb_array_length(:'icfg'::jsonb -> 'pool') >= 20 and (:'icfg'::jsonb ->> 'count')::int = 3
  and not exists (select 1 from jsonb_array_elements(:'icfg'::jsonb -> 'pool') q where jsonb_array_length(q -> 'quick') <> 3),
  'config: at least 20 questions with three quick answers each');
select tests.assert(
  public.company_interview_chance_bps('{"tier": "garage"}', :'icfg'::jsonb) = (:'icfg'::jsonb ->> 'chancePerDayBps')::int
  and public.company_interview_chance_bps('{"tier": "ag", "listed": true, "scandal": true}', :'icfg'::jsonb)
      = (:'icfg'::jsonb ->> 'maxChancePerDayBps')::int
  and public.company_interview_chance_bps('{"tier": "gmbh", "layoffs": 2}', :'icfg'::jsonb)
      = least((:'icfg'::jsonb ->> 'maxChancePerDayBps')::int, (:'icfg'::jsonb ->> 'chancePerDayBps')::int
              + (:'icfg'::jsonb #>> '{tierBonusBps,gmbh}')::int + (:'icfg'::jsonb ->> 'eventBonusBps')::int),
  'company_interview_chance_bps(): bigger, listed and companies after an event are asked more often, capped');
select tests.assert(
  (public.company_interview_judge('{"quick": [{"text": "Gut", "tone": "good"}, {"text": "So", "tone": "ok"}, {"text": "Mies", "tone": "bad"}]}',
                                  '{"quick": 2}', :'icfg'::jsonb) ->> 'verdict') = 'bad'
  and (public.company_interview_judge('{"quick": [], "good": ["entschuldig"]}',
         '{"text": "Wir entschuldigen uns bei allen Kunden und klären alles transparent auf, Schritt für Schritt."}', :'icfg'::jsonb) ->> 'points')::int = 2
  and (public.company_interview_judge('{"quick": []}', '{"text": "Kein Kommentar, ist mir egal."}', :'icfg'::jsonb) ->> 'points')::int = -2
  and (public.company_interview_judge('{"quick": []}', '{"text": "Mal sehen."}', :'icfg'::jsonb) ->> 'verdict') = 'ok'
  and (public.company_interview_judge('{"quick": []}', '{"text": "   "}', :'icfg'::jsonb) ->> 'verdict') = 'none',
  'company_interview_judge(): the Mini-KI rules of src/lib/sim/interviews.ts');

-- a request: three fitting questions, a notification; only one open at a time
select awareness as aw0 from public.player_companies where company_id = :'co' \gset
select public.company_interview_request(:'co', now()) as iv \gset
select tests.assert(
  :'iv' <> '' and public.company_interview_request(:'co', now()) is null
  and (select jsonb_array_length(questions) = 3 and status = 'requested' and expires_at = requested_at + interval '6 hours'
              and ceo_id = :f::uuid
         from public.company_interviews where id = :'iv'::bigint)
  and not exists (select 1 from public.company_interviews i, jsonb_array_elements(i.questions) q
                   where i.id = :'iv'::bigint and (position('{' in q ->> 'text') > 0 or q ->> 'when' in ('listed', 'big', 'profit')))
  and exists (select 1 from public.notifications n where n.player_id = :f::uuid and n.type_key = 'company_interview'),
  'company_interview_request(): three questions that fit a garage, texts filled in, one open request, the founder is told');

-- RLS: nobody reads the table directly; another player cannot answer
select tests.login_as('authenticated', :g);
select tests.assert(not has_table_privilege('authenticated', 'public.company_interviews', 'select'),
  'RLS: company_interviews are not readable by clients');
select tests.throws_key(format($$select public.answer_company_interview(gen_random_uuid(), %s, '[{}, {}, {}]')$$, :'iv'),
  'interview_not_found', 'answer_company_interview(): only the asked CEO answers');
reset role;

select tests.login_as('authenticated', :f);
select public.get_company_interview() as gi \gset
select tests.assert(
  (:'gi'::jsonb #>> '{interview,status}') = 'requested'
  and jsonb_array_length(:'gi'::jsonb #> '{interview,questions,0,quick}') = 3
  and not (:'gi'::jsonb::text like '%"tone"%') and not (:'gi'::jsonb::text like '%"good"%'),
  'get_company_interview(): the open request with questions and quick answers, without the tones');
-- moderation: too long, forbidden words
select tests.throws_key(format($$select public.answer_company_interview(gen_random_uuid(), %s, %L)$$, :'iv',
  jsonb_build_array(jsonb_build_object('text', repeat('x', 241)), '{}'::jsonb, '{}'::jsonb)), 'interview_text_invalid',
  'answer_company_interview(): answers longer than maxChars are refused');
select tests.throws_key(format($$select public.answer_company_interview(gen_random_uuid(), %s, %L)$$, :'iv',
  jsonb_build_array(jsonb_build_object('text', 'Das ist ' || :'badword'), '{}'::jsonb, '{}'::jsonb)), 'interview_text_invalid',
  'answer_company_interview(): the word filter applies');
select tests.throws_key(format($$select public.answer_company_interview(gen_random_uuid(), %s, '[{}]')$$, :'iv'),
  'invalid_argument', 'answer_company_interview(): one answer per question');
\set rq '''0b30b30b-1111-4000-8000-000000000001'''
select public.answer_company_interview(:rq, :'iv'::bigint, jsonb_build_array(
  jsonb_build_object('text', 'Wir danken unseren Kunden und dem ganzen Team, ehrlich und transparent, jeden einzelnen Tag aufs Neue.'),
  jsonb_build_object('quick', 0),
  jsonb_build_object('text', 'Danke an das Team und die Kunden, wir investieren in Qualität und hören fair zu, jeden Tag.'))) as ans \gset
select public.answer_company_interview(:rq, :'iv'::bigint, '[]'::jsonb) as ans2 \gset
select tests.throws_key(format($$select public.answer_company_interview(gen_random_uuid(), %s, '[{}, {}, {}]')$$, :'iv'),
  'interview_closed', 'answer_company_interview(): an answered interview is closed');
reset role;
select tests.assert(
  (:'ans'::jsonb #>> '{interview,status}') = 'answered' and :'ans'::jsonb = :'ans2'::jsonb
  and (select status = 'answered' and score = 5 and awareness_bps = least(300, 5 * 60) and reputation_delta = 2.5  -- ADR-183: private companies too
              and jsonb_array_length(answers) = 3 and answers -> 1 ->> 'verdict' = 'good'
              and (answers -> 0 ->> 'reaction') <> ''
         from public.company_interviews where id = :'iv'::bigint)
  and (select awareness from public.player_companies where company_id = :'co') between :aw0 + 0.0299 and :aw0 + 0.0301,
  'answer_company_interview(): judged 2 + 1 + 2, awareness +3 points (capped at maxAwarenessBps), reputation +2.5 (every company since ADR-183), idempotent by request id');

-- the show: three interview segments with the CEO as subject; aired once
insert into public.news_shows (airs_at, segments)
values (date_trunc('hour', now()) + interval '9 days', public.news_show_build(now())) returning id as show \gset
select segments as segs from public.news_shows where id = :'show'::bigint \gset
select tests.assert(
  (select count(*) from jsonb_array_elements(:'segs'::jsonb) x where x ->> 'kind' = 'interview') = 3
  and (select bool_and(x -> 'subject' ->> 'player_id' = :f and x ->> 'text' like '%Ceo_Clara sagt: »%'
                       and x ->> 'mood' in ('proud', 'laughing', 'smug', 'confused', 'shocked', 'angry'))
         from jsonb_array_elements(:'segs'::jsonb) x where x ->> 'kind' = 'interview')
  and position('news_show_interviews' in pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure)) > 0,
  'news_show_build(): the answered interview is three segments, the host reads the answers, the CEO is on screen');
select public.news_show_start(:'show'::bigint, date_trunc('hour', now()) + interval '9 days 1 minute') as started \gset
select tests.assert(
  :'started'::boolean
  and (select aired_at is not null and show_id = :'show'::bigint from public.company_interviews where id = :'iv'::bigint)
  and exists (select 1 from public.news_items n where n.category::text = 'company' and n.headline like 'Interview mit Ceo_Clara%')
  and not exists (select 1 from jsonb_array_elements(public.news_show_interviews(now())) x
                   where (x -> 'subject' ->> 'interview_id')::bigint = :'iv'::bigint),
  'news_show_start(): the interview is marked aired once, the feed files it under companies, it never airs again');

-- declined and ignored: a little awareness lost, one "kein Kommentar" segment
update public.company_interviews set requested_at = requested_at - interval '1 day' where id = :'iv'::bigint;
select awareness as aw1 from public.player_companies where company_id = :'co' \gset
select public.company_interview_request(:'co', now()) as iv2 \gset
select tests.login_as('authenticated', :f);
select public.decline_company_interview(gen_random_uuid(), :'iv2'::bigint) as dec \gset
reset role;
select public.company_interview_request(:'co', now()) as iv3 \gset
update public.company_interviews set expires_at = now() - interval '1 minute' where id = :'iv3'::bigint;
select public.company_interviews_run_due(now()) as due \gset
select tests.assert(
  (:'dec'::jsonb #>> '{interview,status}') = 'declined'
  and (select status from public.company_interviews where id = :'iv3'::bigint) = 'expired'
  and (:'due'::jsonb ->> 'expired')::int >= 1
  and abs((select awareness from public.player_companies where company_id = :'co')
          - (:aw1 + ((:'icfg'::jsonb #>> '{effects,declineAwarenessBps}')::int + (:'icfg'::jsonb #>> '{effects,ignoreAwarenessBps}')::int) / 10000.0)) < 0.00001,
  'decline and expiry: "kein Kommentar" costs declineAwarenessBps, ignoring ignoreAwarenessBps');
select tests.assert(
  (select count(*) = 1 and bool_and(x ->> 'headline' = 'Clara Werke: kein Kommentar' and x -> 'effects' -> 0 ->> 'tone' = 'loss')
     from jsonb_array_elements(public.news_show_interviews(now())) x),
  'news_show_interviews(): a declined interview is one "kein Kommentar" segment, perShow = 1');

-- the hourly roll: an active founder of a listed-size company is asked at most once an hour
select tests.login_as('authenticated', :g);
select public.found_company(gen_random_uuid(), 'Gustav AG', 'Groß und laut', 'tech', '#663399', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:g) as gco \gset
update public.player_companies set tier = 'ag' where company_id = :'gco';
update public.profiles set last_active_at = now() where id = :g::uuid;
select tests.set_cfg('interviews', '{chancePerDayBps}', '900000');
select tests.set_cfg('interviews', '{maxChancePerDayBps}', '900000');
select public.company_interviews_run_due(now()) is not null as ok \gset
select public.company_interviews_run_due(now()) is not null as ok \gset
select tests.assert(
  (select count(*) from public.company_interviews where company_id = :'gco') = 1
  and (select count(*) from public.company_interview_rolls where company_id = :'gco') = 1
  and exists (select 1 from public.company_interviews i, jsonb_array_elements(i.questions) q
               where i.company_id = :'gco' and q ->> 'when' in ('big', 'solo', 'unknown', 'always')),
  'company_interviews_run_due(): the roll asks the founder once and does not roll again within the hour');
select tests.set_cfg('interviews', '{chancePerDayBps}', (:'icfg'::jsonb -> 'chancePerDayBps'));
select tests.set_cfg('interviews', '{maxChancePerDayBps}', (:'icfg'::jsonb -> 'maxChancePerDayBps'));
select tests.login_as('authenticated', :g);
select tests.assert(
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public' and grantee = 'authenticated'
      and routine_name in ('company_interviews_run_due', 'company_interview_request', 'company_interview_finish', 'news_show_interviews')) = 0,
  'grants: players cannot run the job, request or finish interviews');
reset role;
