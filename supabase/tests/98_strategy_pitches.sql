-- =============================================================================
-- 98 · Own strategies judged by Claude or the Mini-KI (ADR-132)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''09809809-0000-4000-8000-0000000000f1'''
\set o '''09809809-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:f, 'Pitch_Chefin') is not null and tests.signup(:o, 'Pitch_Fremd') is not null as ok \gset
select tests.set_level(:f, 12);
select tests.fund(:f, 30000000, 'test:pitch:f');
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Faire Schuhe', 'Turnschuhe aus Hanf', 'retail', '#447744', 'garage')
  -> 'company' ->> 'id' as cid \gset
select public.company_deposit(gen_random_uuid(), 10000000) is not null as ok \gset
select tests.throws_key($$select public.submit_company_pitch(gen_random_uuid(), 'event', 'Wir reden mit allen.')$$,
  'event_closed', 'submit_company_pitch(): an own crisis strategy needs a crisis');
select tests.throws_key($$select public.submit_company_pitch(gen_random_uuid(), 'move', 'kurz', 'cash')$$,
  'pitch_text_invalid', 'submit_company_pitch(): the text needs a few words (NX115)');
reset role;

-- a strike: bad pay. "Imagefilm" is risky, wages are a good answer.
insert into public.player_company_events (company_id, archetype, polarity, severity, status, definition, started_at, deadline_at)
values (:'cid', 'strike', 'crisis', 2, 'open', '{"strategies": []}'::jsonb, now(), now() + interval '2 hours')
returning id as eid \gset
select tests.assert(
  (public.pitch_mini_judge('Wir zahlen mehr Lohn, verhandeln einen Tarif und hören dem Team zu.', 'strike') ->> 'fit')::int
    > (public.pitch_mini_judge('Ich mache einen Imagefilm.', 'strike') ->> 'fit')::int
  and (public.pitch_mini_judge('Ich mache einen Imagefilm.', 'strike') ->> 'backfire')::int
    > (public.pitch_mini_judge('Wir zahlen mehr Lohn.', 'strike') ->> 'backfire')::int,
  'pitch_mini_judge(): a fitting answer rates higher, a PR stunt risks a backfire');

select tests.login_as('authenticated', :f);
select public.submit_company_pitch(gen_random_uuid(), 'event', 'Ich mache einen Imagefilm über unser tolles Team.') as s1 \gset
select tests.throws_key($$select public.submit_company_pitch(gen_random_uuid(), 'event', 'Und noch eine Idee für alle.')$$,
  'pitch_busy', 'submit_company_pitch(): one own strategy per crisis at a time (NX116)');
reset role;
select id as p1, cost_cents as c1 from public.company_pitches where company_id = :'cid' and kind = 'event' \gset
select tests.assert(
  (:'s1'::jsonb -> 'pitches' -> 0 ->> 'status') = 'judging' and :c1::bigint > 0,
  'submit_company_pitch(): the pitch waits for the judge and costs money');

-- Claude did not answer: the Mini-KI judges after the wait, then the roll decides
select public.company_pitches_run_due(now() + interval '2 minutes') is not null as ok \gset
select tests.assert(
  (select status = 'running' and judge = 'mini' and backfire > 10 and chance_bps between 1000 and 9000 and verdict like '%Schönfärberei%'
     from public.company_pitches where id = :p1),
  'company_pitches_run_due(): the Mini-KI judges unanswered pitches and warns of a PR stunt');
select awareness as aw0 from public.player_companies where company_id = :'cid' \gset
select public.company_pitch_resolve(:p1, 0.99, 0.0) as out1 \gset
select tests.assert(
  :'out1' = 'backfire'
  and (select awareness < :aw0::double precision from public.player_companies where company_id = :'cid')
  and exists (select 1 from public.company_news n where n.company_id = :'cid' and n.kind = 'pitch_backfire'),
  'company_pitch_resolve(): a backfire costs awareness and money and makes news');

-- Claude's judgment through the service role; a good answer solves the crisis
select tests.login_as('authenticated', :f);
select public.submit_company_pitch(gen_random_uuid(), 'event', 'Wir zahlen faire Löhne und verhandeln offen.') is not null as ok \gset
reset role;
select id as p2 from public.company_pitches where company_id = :'cid' and status = 'judging' \gset
select public.store_pitch_judgment(:p2, 90, 5, '', 'ok', 'no', 'oh') as j0 \gset
select public.store_pitch_judgment(:p2, 90, 5, 'Gute Idee, passt zur Lage.', 'Alle sind wieder zufrieden.',
                                   'Es bleibt alles beim Alten.', 'Leider glaubt niemand daran.') as j1 \gset
select public.store_pitch_judgment(:p2, 10, 90, 'x', 'y', 'z', 'w') as j2 \gset
select tests.assert(
  not :'j0'::boolean and :'j1'::boolean and not :'j2'::boolean
  and (select judge = 'claude' and fit = 90 and chance_bps = 8200 from public.company_pitches where id = :p2),
  'store_pitch_judgment(): texts are checked, the judgment counts once, fit 90 is an 82 % chance');
select public.company_pitch_resolve(:p2, 0.1, 0.9) as out2 \gset
select tests.assert(
  :'out2' = 'success'
  and (select status = 'solved' and mitigation > 0.35 from public.player_company_events where id = :'eid')
  and exists (select 1 from public.company_news n where n.company_id = :'cid' and n.kind = 'pitch_success'
                and n.payload ->> 'outcome' = 'Alle sind wieder zufrieden.'),
  'company_pitch_resolve(): success solves the crisis, the news uses Claude''s line');

-- an own business move: cash, success pays more than it cost
select tests.login_as('authenticated', :f);
select public.submit_company_pitch(gen_random_uuid(), 'move', 'Wir verkaufen Schuhe im Abo an Laufvereine.', 'cash') is not null as ok \gset
reset role;
select id as p3, cost_cents as c3 from public.company_pitches where company_id = :'cid' and kind = 'move' \gset
select public.company_pitches_run_due(now() + interval '2 minutes') is not null as ok \gset
select public.company_pitch_resolve(:p3, 0.0, 0.9) as out3 \gset
select tests.assert(
  :'out3' = 'success' and (select result_cents > cost_cents from public.company_pitches where id = :p3),
  'own business move: success pays back more than the cost');

select tests.login_as('authenticated', :o);
select tests.throws_key(format('select public.company_pitch_context(%s)', :p3), 'company_not_found',
  'company_pitch_context(): only for the founder');
reset role;
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'closed money system after own strategies');
select tests.throws($$select public.api_error('pitch_busy')$$, 'NX116', 'pitch_busy is NX116');
