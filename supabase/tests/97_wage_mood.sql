-- =============================================================================
-- 97 · Crises and falling share prices cut wages (ADR-131)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''09709709-0000-4000-8000-0000000000f1'''
\set w '''09709709-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:f, 'Lohn_Chefin') is not null and tests.signup(:w, 'Lohn_Arbeiter') is not null as ok \gset
select tests.set_level(:f, 12);
select tests.set_level(:w, 6);
select tests.fund(:f, 20000000, 'test:wage:f');
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Lohnwerk', 'Schrauben', 'tech', '#335577', 'garage')
  -> 'company' ->> 'id' as cid \gset
select public.company_deposit(gen_random_uuid(), 5000000) is not null as ok \gset
reset role;
select tests.hire(:f, :w, 20000) as job \gset

select tests.assert(public.company_pay_mood_bps(:'cid') = 10000, 'company_pay_mood_bps(): full wage without crisis');

-- a severity-2 scandal: 2 x 5 % + 5 % = 15 % less
insert into public.player_company_events (company_id, archetype, polarity, severity, status, definition, started_at, deadline_at)
values (:'cid', 'quality_scandal', 'crisis', 2, 'open', '{}'::jsonb, now(), now() + interval '2 hours');
select tests.assert(public.company_pay_mood_bps(:'cid') = 8500, 'company_pay_mood_bps(): a scandal of severity 2 costs 15 %');
select tests.work_hours(:'job', 1) as paid \gset
select tests.assert(
  :paid::bigint = 20000 * 8500 / 10000
  and (select pay_factor_bps from public.player_jobs where id = :'job') = 8500,
  'accrue_job_salary(): the employee gets 85 % and sees the wage factor 85 %');

update public.game_config set value = jsonb_set(value, '{maxShareBps}', '2000') where key = 'wageMood';
-- an AI employer whose share fell 50 % today: half of what is beyond 3 %, at most 20 %; 7 %: 2 %
update public.security_quotes q set change_bps = 0
  from public.companies c where c.ticker = 'KLS' and q.security_id = c.security_id;
select tests.assert(
  (select public.company_pay_mood_bps(c.id) from public.companies c where c.ticker = 'KLS') = 10000,
  'company_pay_mood_bps(): an AI company without a price fall pays in full');
update public.security_quotes q set change_bps = -5000
  from public.companies c where c.ticker = 'KLS' and q.security_id = c.security_id;
select tests.assert(
  (select public.company_pay_mood_bps(c.id) from public.companies c where c.ticker = 'KLS') = 8000,
  'company_pay_mood_bps(): a falling share price cuts wages, at most 20 %');
update public.security_quotes q set change_bps = -700
  from public.companies c where c.ticker = 'KLS' and q.security_id = c.security_id;
select tests.assert(
  (select public.company_pay_mood_bps(c.id) from public.companies c where c.ticker = 'KLS') = 9800,
  'company_pay_mood_bps(): 7 % down costs 2 % of the wage (3 % are free)');
update public.security_quotes q set change_bps = 0
  from public.companies c where c.ticker = 'KLS' and q.security_id = c.security_id;
