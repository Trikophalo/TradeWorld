-- =============================================================================
-- Dumps one real response of every read/write RPC (M1, M2, M2b) as JSON files, so the
-- frontend's Zod schemas can be tested against the database (contract test:
-- src/features/game/api.test.ts). Run by verify_local.sh when
-- NEXA_FIXTURE_DIR is set. Not an assertion file.
-- =============================================================================
\set QUIET 1
\set p '''f1f1f1f1-0000-4000-8000-0000000000f1'''
select tests.signup(:p, 'Fixture') is not null as ok \gset
update public.sim_runtime set is_paused = false;
-- enough XP for limit orders and bonds
update public.profiles set xp_total = public.xp_total_for_level(6) + 500, level = 6 where id = :p;
select public.market_tick() is not null as ok \gset
select public.rich_list_snapshot(true) is not null as ok \gset
select public.rich_news('rich_rank_entry', :p, 'Fixture', null, 87, 100, 1234567, null) is null as ok \gset
\pset tuples_only on
\pset format unaligned
select tests.login_as('authenticated', :p) is null as ok \gset
-- assign missions first, so the trades below complete some of them
select public.get_my_missions() is not null as ok \gset

\o :fixture_dir/complete_tutorial.json
select public.complete_tutorial(gen_random_uuid());
\o :fixture_dir/claim_vault.json
select public.claim_vault(gen_random_uuid());
\o :fixture_dir/place_order_market.json
select public.place_order(gen_random_uuid(), 'VLT', 'buy', 'market', 5000000);
\o :fixture_dir/place_order_limit.json
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'limit', 2000000, 10000);
\o :fixture_dir/place_order_bond.json
select public.place_order(gen_random_uuid(), 'NXB02', 'buy', 'market', 3000000);
\o :fixture_dir/place_order_sell.json
select public.place_order(gen_random_uuid(), 'VLT', 'sell', 'market', 2000000);
\o :fixture_dir/place_order_amount.json
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', null, null, 25000);
\o :fixture_dir/get_market_snapshot.json
select public.get_market_snapshot();
\o :fixture_dir/get_candles.json
select public.get_candles('VLT', '5m', 20);
\o :fixture_dir/get_candles_index.json
select public.get_candles('NEXA30', '1y', 10);
\o :fixture_dir/get_order_book.json
select public.get_order_book('KLS', 6);
\o :fixture_dir/get_security_details.json
select public.get_security_details('VLT');
\o :fixture_dir/get_my_portfolio.json
select public.get_my_portfolio();
\o :fixture_dir/cancel_order.json
select public.cancel_order(gen_random_uuid(), (select id from public.orders where player_id = :p and status = 'open' limit 1));
\o :fixture_dir/get_rich_list.json
select public.get_rich_list(5, 0, 'all');
\o :fixture_dir/get_rich_list_players.json
select public.get_rich_list(5, 0, 'players');
\o :fixture_dir/get_rich_list_news.json
select public.get_rich_list_news(5);
\o :fixture_dir/check_nickname.json
select public.check_nickname('Fixture_Zwei');
\o :fixture_dir/check_nickname_rejected.json
select public.check_nickname('Admin');
\o :fixture_dir/change_nickname.json
select public.change_nickname(gen_random_uuid(), 'Fixture_Neu');
\o :fixture_dir/daily_check_in.json
select public.daily_check_in(gen_random_uuid());
\o :fixture_dir/track_event.json
select public.track_event('open_rich_list');
\o :fixture_dir/get_my_missions.json
select public.get_my_missions();
\o :fixture_dir/claim_mission.json
select public.claim_mission(gen_random_uuid(),
  (select m.id from public.player_missions m where m.player_id = :p and m.status = 'completed' order by m.created_at limit 1));
\o :fixture_dir/get_my_portfolio_after_missions.json
select public.get_my_portfolio();
\o
reset role;

-- M2b: avatars, daily reward, skills, jobs, player card -----------------------------
insert into public.player_skill_points (player_id, free_points) values (:p, 6)
on conflict (player_id) do update set free_points = 6;
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/set_avatar.json
select public.set_avatar(gen_random_uuid(), 'coder');
\o :fixture_dir/get_daily_reward.json
select public.get_daily_reward();
\o :fixture_dir/claim_daily_reward.json
select public.claim_daily_reward(gen_random_uuid());
\o :fixture_dir/get_daily_reward_claimed.json
select public.get_daily_reward();
\o
select public.learn_skill(gen_random_uuid(), 'it_basics') is not null as ok \gset
\o :fixture_dir/learn_skill.json
select public.learn_skill(gen_random_uuid(), 'it_programming');
\o :fixture_dir/get_my_skills.json
select public.get_my_skills();
\o :fixture_dir/get_job_board.json
select public.get_job_board();
\o
select x ->> 'id' as fx_job, x ->> 'salary_cents_per_hour' as fx_wage
  from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean
 order by (x ->> 'match_score')::int desc, x ->> 'id' limit 1 \gset
select x ->> 'id' as fx_job2
  from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean and x ->> 'id' <> :'fx_job'
 order by x ->> 'id' limit 1 \gset
\o :fixture_dir/apply_for_job.json
select public.apply_for_job(gen_random_uuid(), :'fx_job', :fx_wage, 'Ich lerne schnell.');
\o
select public.apply_for_job(gen_random_uuid(), :'fx_job2', 9000, null) ->> 'id' as fx_app2 \gset
\o :fixture_dir/withdraw_application.json
select public.withdraw_application(gen_random_uuid(), :'fx_app2');
\o :fixture_dir/get_my_applications.json
select public.get_my_applications();
\o :fixture_dir/sign_contract.json
select public.sign_contract(gen_random_uuid(),
  (select a.id from public.job_applications a where a.player_id = :p and a.status = 'offered' order by a.created_at limit 1),
  'M2 14 C6 4 10 4 14 12 S22 18 26 8');
\o
reset role;
-- one paid hour and a raise opportunity (as if a skill had been learned since the hire)
update public.player_jobs set last_paid_at = last_paid_at - interval '61 minutes', raise_base_score = raise_base_score - 1,
       salary_cents_per_hour = salary_cents_per_hour - 1000
 where player_id = :p and status = 'active';
select public.accrue_salaries() >= 0 as ok \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_my_job.json
select public.get_my_job();
\o :fixture_dir/get_player_card.json
select public.get_player_card('fixture_neu');
\o :fixture_dir/request_raise.json
select public.request_raise(gen_random_uuid(), greatest(1, (public.get_my_job() -> 'job' ->> 'raise_max_bps')::int));
\o :fixture_dir/quit_job.json
select public.quit_job(gen_random_uuid());
\o :fixture_dir/get_my_job_notice.json
select public.get_my_job();
\o :fixture_dir/cancel_quit.json
select public.cancel_quit(gen_random_uuid());
\o :fixture_dir/get_employer.json
select public.get_employer();
\o :fixture_dir/quit_job_now.json
select public.quit_job(gen_random_uuid(), true);
\o :fixture_dir/get_my_job_none.json
select public.get_my_job();
\o :fixture_dir/get_employer_none.json
select public.get_employer();
\o
reset role;

-- M3c: the fixture player founds a company and runs it as employer (top-level fixtures)
\set boss '''f1f1f1f1-0000-4000-8000-0000000000f2'''
select tests.signup(:boss, 'Fixture_Chefin') is not null as ok \gset
update public.profiles set level = 3, xp_total = public.xp_total_for_level(3) where id = :boss;
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/check_company_name.json
select public.check_company_name('Fixture Labor');
\o :fixture_dir/check_company_name_rejected.json
select public.check_company_name('KlarSoft');
\o :fixture_dir/get_my_company_none.json
select public.get_my_company();
\o :fixture_dir/found_company.json
select public.found_company(gen_random_uuid(), 'Fixture Labor', 'Werkzeuge für Bastler', 'tech', '#2266cc', 'garage');
\o :fixture_dir/set_company_logo.json
select public.set_company_logo(gen_random_uuid(), '{"palette": ["#112233", "#ffcc00"], "grid": ["................", "................",
  "....00000000....", "....01111110....", "....01111110....", "....00000000....", "................", "................",
  "................", "................", "................", "................", "................", "................",
  "................", "................"]}');
\o :fixture_dir/set_company_marketing.json
select public.set_company_marketing(gen_random_uuid(), 25000);
\o :fixture_dir/set_ai_workers.json
select public.set_ai_workers(gen_random_uuid(), 1);
\o :fixture_dir/company_deposit.json
select public.company_deposit(gen_random_uuid(), 100000);
\o :fixture_dir/company_withdraw.json
select public.company_withdraw(gen_random_uuid(), 50000);
\o
reset role;
select company_id as fco from public.player_companies where founder_id = :p \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/create_job_posting.json
select public.create_job_posting(gen_random_uuid(), :'fco', 'intern', 'Werkstudium Software',
  '[{"branch": "it", "min_score": 0}]', 18000, 1);
\o
select id as fx_post from public.job_postings where company_id = :'fco' \gset
select tests.login_as('authenticated', :boss) is null as ok \gset
select public.apply_for_job(gen_random_uuid(), :'fx_post', 20000, 'Gern im Team.') ->> 'id' as fx_papp \gset
\o :fixture_dir/report_company_logo.json
select public.report_company_logo(gen_random_uuid(), :'fco');
\o
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_company_postings.json
select public.get_company_postings();
\o :fixture_dir/get_company_applications.json
select public.get_company_applications(:'fco');
\o :fixture_dir/respond_application.json
select public.respond_application(gen_random_uuid(), :'fx_papp', 'counter', 19000);
\o
select tests.login_as('authenticated', :boss) is null as ok \gset
select public.sign_contract(gen_random_uuid(), :'fx_papp', 'M1 1 L9 9') is not null as ok \gset
reset role;
update public.player_jobs set raise_base_score = raise_base_score - 1 where player_id = :boss and status = 'active';
select id as fx_pjob from public.player_jobs where company_id = :'fco' and status = 'active' \gset
select tests.login_as('authenticated', :boss) is null as ok \gset
select public.request_raise(gen_random_uuid(), 200) is not null as ok \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_company_team.json
select public.get_company_team(:'fco');
\o :fixture_dir/respond_raise.json
select public.respond_raise(gen_random_uuid(), :'fx_pjob', true);
\o :fixture_dir/fire_employee.json
select public.fire_employee(gen_random_uuid(), :'fx_pjob');
\o :fixture_dir/close_job_posting.json
select public.close_job_posting(gen_random_uuid(), :'fx_post');
\o
reset role;
-- one quarter closed, level 10 and money for the upgrade
select public.player_company_close_quarter(:'fco', (select id from public.game_quarters order by ends_at <= now() desc, ends_at desc limit 1))
       is not null as ok \gset
update public.profiles set level = 10, xp_total = public.xp_total_for_level(10) where id = :p;
select public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(:p, 'player_cash'),
  2000000, 'transfer', 'Fixture-Kapital', 'player', :p, 'fixture:m3c:upgrade') is not null as ok \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_my_company.json
select public.get_my_company();
\o :fixture_dir/upgrade_company.json
select public.upgrade_company(gen_random_uuid());
\o :fixture_dir/get_player_card_founder.json
select public.get_player_card('fixture_neu');
\o :fixture_dir/get_my_portfolio_founder.json
select public.get_my_portfolio();
\o
reset role;

-- M3d: chat, work task, voluntary close of the fixture company
select tests.login_as('authenticated', :p) is null as ok \gset
select public.create_job_posting(gen_random_uuid(), :'fco', 'intern', 'Werkstudium Daten',
  '[{"branch": "finance", "min_score": 0}]', 18000, 1) ->> 'id' as fx_post2 \gset
select tests.login_as('authenticated', :boss) is null as ok \gset
select public.apply_for_job(gen_random_uuid(), :'fx_post2', 18000, null) ->> 'id' as fx_papp2 \gset
-- counter offers only at player companies since M3e (AI employers offer their maximum)
\o :fixture_dir/counter_offer.json
select public.counter_offer(gen_random_uuid(), :'fx_papp2', 18500);
\o
select tests.login_as('authenticated', :p) is null as ok \gset
select public.respond_application(gen_random_uuid(), :'fx_papp2', 'accept', null) is not null as ok \gset
select tests.login_as('authenticated', :boss) is null as ok \gset
select public.sign_contract(gen_random_uuid(), :'fx_papp2', 'M2 2 L8 8') is not null as ok \gset
\o :fixture_dir/get_employer_player_company.json
select public.get_employer();
\o
reset role;
select id as fx_pjob2 from public.player_jobs where player_id = :boss and status = 'active' \gset
select tests.login_as('authenticated', :p) is null as ok \gset
-- M3h: an AI worker for the stage-1 skill, three general ones (trainings from 5 team members)
select public.set_ai_workers(gen_random_uuid(), 0) is not null as ok \gset
\o :fixture_dir/hire_ai_workers.json
select public.hire_ai_workers(gen_random_uuid(), 1, 'it_security');
\o
select public.hire_ai_workers(gen_random_uuid(), 3) is not null as ok \gset
\o :fixture_dir/train_employee.json
select public.train_employee(gen_random_uuid(), :'fx_pjob2', 'it_basics');
\o :fixture_dir/get_company_team_trained.json
select public.get_company_team(:'fco');
\o :fixture_dir/dismiss_ai_worker.json
select public.dismiss_ai_worker(gen_random_uuid());
\o
select tests.login_as('authenticated', :boss) is null as ok \gset
\o :fixture_dir/get_work_task.json
select public.get_work_task();
\o
reset role;
-- no new work tasks since M3e (ADR-064): an open task from before, for the submit fixture
insert into public.player_work_tasks (player_id, player_job_id, kind, params, correct_index, status, started_at, expires_at)
select j.player_id, j.id, 'finance_choice', t.p, public.work_task_correct('finance_choice', t.p), 'started', now(), now() + interval '3 hours'
  from public.player_jobs j, (select public.work_task_generate('finance_choice') as p) t
 where j.player_id = :boss and j.status = 'active';
select id as fx_task, correct_index as fx_ci from public.player_work_tasks where player_id = :boss order by created_at desc limit 1 \gset
select tests.login_as('authenticated', :boss) is null as ok \gset
\o :fixture_dir/submit_work_task.json
select public.submit_work_task(gen_random_uuid(), :'fx_task', :fx_ci);
\o :fixture_dir/get_work_task_none.json
select public.get_work_task();
\o :fixture_dir/get_my_job_with_task.json
select public.get_my_job();
\o :fixture_dir/post_company_message.json
select public.post_company_message(gen_random_uuid(), 'Moin zusammen!');
\o
select tests.login_as('authenticated', :p) is null as ok \gset
select public.post_company_message(gen_random_uuid(), 'Willkommen an Bord.') is not null as ok \gset
\o :fixture_dir/get_company_chat.json
select public.get_company_chat();
\o
reset role;
-- M3f: IPO with subscription and a capital increase (level 15, small business)
update public.profiles set level = 15, xp_total = public.xp_total_for_level(15) where id = :p;
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/go_public.json
select public.go_public(gen_random_uuid(), 20);
\o
reset role;
select id as fx_offer from public.company_share_offers where company_id = :'fco' and status = 'open' \gset
select tests.login_as('authenticated', :boss) is null as ok \gset
\o :fixture_dir/subscribe_offer.json
select public.subscribe_offer(gen_random_uuid(), :'fx_offer', 25000);
\o :fixture_dir/get_offers.json
select public.get_offers();
\o
reset role;
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'fx_offer';
select public.close_due_offers() is not null as ok \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_my_company_listed.json
select public.get_my_company();
\o :fixture_dir/capital_increase.json
select public.capital_increase(gen_random_uuid(), 10);
\o
reset role;
update public.company_share_offers set ends_at = now() - interval '1 second' where company_id = :'fco' and status = 'open';
select public.close_due_offers() is not null as ok \gset
update public.securities set status = 'delisted', delisted_at = now()
 where id = (select security_id from public.companies where id = :'fco');
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/close_company.json
select public.close_company(gen_random_uuid());
\o :fixture_dir/get_my_company_closed.json
select public.get_my_company();
\o :fixture_dir/get_my_portfolio_after_close.json
select public.get_my_portfolio();
\o
select tests.login_as('authenticated', :boss) is null as ok \gset
\o :fixture_dir/get_company_chat_none.json
select public.get_company_chat();
\o
reset role;

-- M3g: reset and delete the own account
select nickname as fx_boss_nick from public.profiles where id = :boss \gset
select tests.login_as('authenticated', :boss) is null as ok \gset
\o :fixture_dir/reset_account.json
select public.reset_account(gen_random_uuid(), :'fx_boss_nick');
\o
reset role;
\set fx_gone '''f1f1f1f1-0000-4000-8000-0000000000f9'''
select tests.signup(:fx_gone, 'Fixture_Weg') is not null as ok \gset
select tests.login_as('authenticated', :fx_gone) is null as ok \gset
\o :fixture_dir/delete_account.json
select public.delete_account('Fixture_Weg');
\o
reset role;
