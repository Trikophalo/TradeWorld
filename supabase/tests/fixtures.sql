-- =============================================================================
-- Dumps one real response of every read/write RPC (M1 to M4j) as JSON files, so the
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
\o :fixture_dir/quote_order.json
select public.quote_order('VLT', 'buy', null, 100000);
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
\o :fixture_dir/set_company_banner.json
select public.set_company_banner(gen_random_uuid(), jsonb_build_object('palette', '["#112233", "#ffcc00"]'::jsonb,
  'grid', (select to_jsonb(array_agg(case when y in (0, 11) then repeat('0', 48) else '0' || repeat('1', 46) || '0' end order by y))
             from generate_series(0, 11) y)));
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
-- two operating hours for COMPANY.live and COMPANY.hours (ADR-072)
select public.player_company_close_hour(:'fco', date_trunc('hour', now()) - interval '2 hours') is not null as ok \gset
select public.player_company_close_hour(:'fco', date_trunc('hour', now()) - interval '1 hour') is not null as ok \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_my_company.json
select public.get_my_company();
\o :fixture_dir/get_company_ranking.json
select public.get_company_ranking('players', 5);
\o :fixture_dir/get_company_ranking_all.json
select public.get_company_ranking('all', 5);
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
select public.hire_ai_workers(gen_random_uuid(), 1, 'it_networks');
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
\o :fixture_dir/get_company_floor.json
select public.get_company_floor();
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
-- a top company for a moment: AI investors take the rest, the IPO is full and lists (ADR-151)
select quality as fx_q from public.player_companies where company_id = :'fco' \gset
update public.player_companies set quality = 1 where company_id = :'fco';
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'fx_offer';
select public.close_due_offers() is not null as ok \gset
update public.player_companies set quality = :fx_q where company_id = :'fco';
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_my_company_listed.json
select public.get_my_company();
\o :fixture_dir/capital_increase.json
select public.capital_increase(gen_random_uuid(), 10);
\o
reset role;
update public.company_share_offers set ends_at = now() - interval '1 second' where company_id = :'fco' and status = 'open';
select public.close_due_offers() is not null as ok \gset
-- listed companies (ADR-167): investments, books, taxes, dividends, the board
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_listed_company.json
select public.get_listed_company();
\o :fixture_dir/company_invest.json
select public.company_invest(gen_random_uuid(), 'b_obstkorb');
\o :fixture_dir/company_invest_stop.json
select public.company_invest_stop(gen_random_uuid(), 'b_obstkorb');
\o :fixture_dir/company_tax_advisor.json
select public.company_tax_advisor(gen_random_uuid(), false);
\o :fixture_dir/company_declare_dividend.json
select public.company_declare_dividend(gen_random_uuid(), 20000);
\o
reset role;
select public.player_company_close_hour(:'fco', date_trunc('hour', now()) - interval '3 hours') is not null as ok \gset
insert into public.company_tax_periods (company_id, kind, period_start, period_end, penalty_cents, closed_by, due_at)
values (:'fco', 'late_fee', now() - interval '2 days', now(), 5000, 'finanzamt', now() + interval '1 day');
insert into public.board_motions (company_id, proposer_id, kind, params, closes_at)
values (:'fco', :boss, 'withdraw_ban', '{"days": 2}', now() + interval '12 hours');
select max(id) as fx_motion from public.board_motions where company_id = :'fco' \gset
insert into public.board_votes (motion_id, player_id, yes) values (:fx_motion, :boss, true);
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/company_books_close.json
select public.company_books_close(gen_random_uuid(), array['revenue', 'goods', 'wages'], false);
\o :fixture_dir/company_tax_pay.json
select public.company_tax_pay(gen_random_uuid());
\o :fixture_dir/get_company_accounting.json
select public.get_company_accounting(7, null);
\o :fixture_dir/get_company_board.json
select public.get_company_board(null);
\o :fixture_dir/board_vote.json
select public.board_vote(gen_random_uuid(), :fx_motion, false);
\o :fixture_dir/board_propose.json
select public.board_propose(gen_random_uuid(), :'fco', 'earmark', '{"purpose": "research", "amount_cents": 50000}');
-- business figures at the stock exchange (ADR-184): the list and the listed player company's detail
\o :fixture_dir/get_stock_revenue.json
select public.get_stock_revenue();
\o :fixture_dir/get_stock_revenue_detail.json
select public.get_stock_revenue((select c.ticker from public.companies c where c.id = :'fco'));
\o
reset role;
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
\o :fixture_dir/get_company_floor_none.json
select public.get_company_floor();
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

-- M4a: artworks (ADR-080): painting, likes, auctions with a bid, a gallery sale
select tests.fund(:p, 10000000, 'fixture:m4a:p');
\set fx_k '''f1f1f1f1-0000-4000-8000-0000000000fa'''
select tests.signup(:fx_k, 'Fixture_Kunst') is not null as ok \gset
select tests.set_level(:fx_k, 8);
select tests.fund(:fx_k, 3000000, 'fixture:m4a:k');
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/create_artwork.json
select public.create_artwork(gen_random_uuid(), 'Fixture im Abendrot', tests.art(array['#1b1440', '#ffc46b', '#c8486b'], '2'));
\o
select (public.create_artwork(gen_random_uuid(), 'Zweites Fixture', tests.art()) #>> '{artwork,id}')::uuid as fx_art2 \gset
reset role;
select id as fx_art from public.artworks where creator_id = :p and title = 'Fixture im Abendrot' \gset
insert into public.artwork_auctions (artwork_id, by_gallery, start_cents, ends_at, created_at)
select a.id, true, public.artwork_gallery_start_cents(a.rarity), public.game_now() + interval '6 hours', public.game_now() - interval '2 days'
  from public.artworks a
 where a.owner_id is null and a.origin = 'game'
   and not exists (select 1 from public.artwork_auctions x where x.artwork_id = a.id and x.status = 'open')
 order by a.serial limit 1
returning id as fx_gau, artwork_id as fx_gart, start_cents as fx_gstart \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/start_auction.json
select public.start_auction(gen_random_uuid(), :'fx_art', 50000, 24);
\o
select (public.start_auction(gen_random_uuid(), :'fx_art2', 50000, 1) #>> '{artwork,auction,id}')::uuid as fx_au2 \gset
\o :fixture_dir/cancel_auction.json
select public.cancel_auction(gen_random_uuid(), :'fx_au2');
\o
reset role;
select id as fx_au1 from public.artwork_auctions where artwork_id = :'fx_art' and status = 'open' \gset
select tests.login_as('authenticated', :fx_k) is null as ok \gset
\o :fixture_dir/like_artwork.json
select public.like_artwork(gen_random_uuid(), :'fx_art', true);
\o :fixture_dir/bid_artwork.json
select public.bid_artwork(gen_random_uuid(), :'fx_au1', 50000);
\o
select public.bid_artwork(gen_random_uuid(), :'fx_gau', :fx_gstart) is not null as ok \gset
reset role;
update public.artwork_auctions set ends_at = public.game_now() - interval '1 second' where id = :'fx_gau';
select public.artworks_run_due() is not null as ok \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_artwork.json
select public.get_artwork(:'fx_art');
\o :fixture_dir/get_artwork_sold.json
select public.get_artwork(:'fx_gart');
\o :fixture_dir/get_artworks.json
select public.get_artworks('hot', 'all', false, 6, 0);
\o :fixture_dir/get_artworks_auctions.json
select public.get_artworks('ending', 'all', true, 6, 0);
\o :fixture_dir/get_art_studio.json
select public.get_art_studio();
\o :fixture_dir/get_art_rankings.json
select public.get_art_rankings(5);
\o :fixture_dir/get_collection.json
select public.get_collection('Fixture_Kunst');
\o :fixture_dir/get_collection_own.json
select public.get_collection(null);
\o
reset role;
-- the owner sells to the highest bid at once
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/accept_auction.json
select public.accept_auction(gen_random_uuid(), :'fx_au1');
\o
reset role;

-- M4b: property (ADR-082): a player without a home, a flat with a layout, the move to a house,
-- a car, a sale, and another player's view (no inventory)
\set fx_h '''f1f1f1f1-0000-4000-8000-0000000000fb'''
select tests.signup(:fx_h, 'Fixture_Heim') is not null as ok \gset
select tests.set_level(:fx_h, 14);
select tests.fund(:fx_h, 60000000, 'fixture:m4b:h');
select tests.login_as('authenticated', :fx_h) is null as ok \gset
\o :fixture_dir/get_property_empty.json
select public.get_property(null);
\o :fixture_dir/buy_home.json
select public.buy_home(gen_random_uuid(), 'flat');
\o :fixture_dir/buy_furniture.json
select public.buy_furniture(gen_random_uuid(), 'sofa_leather', 1);
\o
select public.buy_furniture(gen_random_uuid(), 'rug_wool', 1) as fx_bf \gset
select public.buy_furniture(gen_random_uuid(), 'plant_small', 2) is not null as ok \gset
\o :fixture_dir/buy_floor.json
select public.buy_floor(gen_random_uuid(), 'parquet');
\o :fixture_dir/save_layout.json
select public.save_layout(gen_random_uuid(), '#2f5fd0', 'parquet',
         (select jsonb_agg(case e ->> 'item_key'
                             when 'rug_wool' then jsonb_build_object('id', e ->> 'id', 'x', 1, 'y', 1, 'rot', 0)
                             when 'sofa_leather' then jsonb_build_object('id', e ->> 'id', 'x', 1, 'y', 1, 'rot', 0)
                             else jsonb_build_object('id', e ->> 'id', 'x', 7, 'y', 0, 'rot', 90) end)
            from jsonb_array_elements(:'fx_bf'::jsonb #> '{inventory,furniture}') e));
\o :fixture_dir/buy_home_upgrade.json
select public.buy_home(gen_random_uuid(), 'house');
\o :fixture_dir/buy_car.json
select public.buy_car(gen_random_uuid(), 'car_electric');
\o
select (public.buy_car(gen_random_uuid(), 'car_city') #> '{property,garage}' -> 1 ->> 'id')::uuid as fx_car2 \gset
\o :fixture_dir/sell_item.json
select public.sell_item(gen_random_uuid(), 'furniture',
         (select (e ->> 'id')::uuid from jsonb_array_elements(public.get_property(null) #> '{inventory,furniture}') e
           where e ->> 'item_key' = 'plant_small' limit 1));
\o :fixture_dir/sell_item_car.json
select public.sell_item(gen_random_uuid(), 'car', :'fx_car2');
\o :fixture_dir/get_property.json
select public.get_property(null);
\o
reset role;
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_property_other.json
select public.get_property('Fixture_Heim');
\o
reset role;

-- M4c: company levers (ADR-083) with a GmbH, friends (ADR-084)
\set fx_g '''f1f1f1f1-0000-4000-8000-0000000000fc'''
select tests.signup(:fx_g, 'Fixture_Gmbh') is not null as ok \gset
select tests.set_level(:fx_g, 15);
select tests.fund(:fx_g, 20000000, 'fixture:m4c:g');
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/found_company_gmbh.json
select public.found_company(gen_random_uuid(), 'Fixture Werke', 'Maschinen nach Maß', 'tech', '#336699', 'gmbh');
\o :fixture_dir/set_company_strategy.json
select public.set_company_strategy(gen_random_uuid(), 'premium', true);
-- M4e: automatic CEO payout (ADR-086); the expanded company below closes an hour with it
\o :fixture_dir/set_founder_payout.json
select public.set_founder_payout(gen_random_uuid(), 2500);
\o
select public.company_deposit(gen_random_uuid(), 10000000) is not null as ok \gset
\o :fixture_dir/expand_company.json
select public.expand_company(gen_random_uuid());
\o
reset role;
select company_id as fx_gco from public.player_companies where founder_id = :fx_g \gset
select public.player_company_close_hour(:'fx_gco', date_trunc('hour', now()) - interval '1 hour') is not null as ok \gset
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/get_my_company_expanded.json
select public.get_my_company();
\o :fixture_dir/get_friends_empty.json
select public.get_friends();
\o :fixture_dir/send_friend_request.json
select public.send_friend_request(gen_random_uuid(), 'Fixture_Heim');
\o
select public.send_friend_request(gen_random_uuid(), 'Fixture_Kunst') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :fx_k) is null as ok \gset
\o :fixture_dir/respond_friend_request.json
select public.respond_friend_request(gen_random_uuid(), 'Fixture_Gmbh', true);
\o
reset role;
select tests.login_as('authenticated', :p) is null as ok \gset
select public.send_friend_request(gen_random_uuid(), 'Fixture_Gmbh') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/get_friends.json
select public.get_friends();
\o :fixture_dir/remove_friend.json
select public.remove_friend(gen_random_uuid(), 'Fixture_Heim');
\o
reset role;

-- M4d: player search by nickname and by tag (ADR-085)
select tag as fx_heim_tag from public.profiles where nickname = 'Fixture_Heim' \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/search_players.json
select public.search_players('fixture');
\o :fixture_dir/search_players_tag.json
select public.search_players('#' || :'fx_heim_tag');
\o :fixture_dir/search_players_empty.json
select public.search_players('x');
\o
reset role;

-- M4f: friends feed, reactions, notifications (ADR-088) and the weekly league (ADR-089).
-- Feed items come from the triggers of the steps above; last week's league is rebuilt and closed.
\set fx_e '''f1f1f1f1-0000-4000-8000-0000000000fd'''
select tests.signup(:fx_e, 'Fixture_Leer') is not null as ok \gset
select tests.login_as('authenticated', :fx_g) is null as ok \gset
select public.respond_friend_request(gen_random_uuid(), 'Fixture_Neu', true) is not null as ok \gset
reset role;
delete from public.league_seasons where week_start = public.league_week_start(public.game_now()) - 7;
select public.league_ensure_season(public.game_now() - interval '7 days') as fx_ls \gset
select public.league_refresh(:'fx_ls') is not null as ok \gset
update public.league_entry_baselines set start_net_worth_cents = current_net_worth_cents - 250000
 where season_id = :'fx_ls' and player_id = :fx_g;
select public.league_close(:'fx_ls') is not null as ok \gset
update public.league_seasons set refreshed_at = null where week_start = public.league_week_start(public.game_now());
select public.social_run_due() is not null as ok \gset
select tests.login_as('authenticated', :fx_e) is null as ok \gset
\o :fixture_dir/get_feed_empty.json
select public.get_feed();
\o
reset role;
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/get_feed.json
select public.get_feed(null, 5);
\o :fixture_dir/react_feed.json
select public.react_feed(gen_random_uuid(), (select id from public.feed_items where actor_id = :p order by id desc limit 1));
\o :fixture_dir/get_league.json
select public.get_league('all', 'last');
\o :fixture_dir/get_league_friends.json
select public.get_league('friends', 'current');
\o
reset role;
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_notifications.json
select public.get_notifications(10);
\o :fixture_dir/mark_notifications_read.json
select public.mark_notifications_read(null);
\o
reset role;

-- =============================================================================
-- M4g: announced events (ADR-090). One resolved event of every kind (outcome shapes), then the
-- upcoming events from the real clock. Test leftovers at pinned future times are removed first.
-- =============================================================================
delete from public.scheduled_events;
select gq.id as fx_eq, gq.status as fx_eq_status from public.game_quarters gq
 order by (exists (select 1 from public.company_quarter_reports r where r.game_quarter_id = gq.id)) desc,
          abs(extract(epoch from gq.ends_at - public.game_now())) limit 1 \gset
select public.simulate_ai_companies(:fx_eq) is not null as ok \gset
update public.game_quarters set status = 'closed' where id = :fx_eq;
insert into public.scheduled_events (kind, title, importance, company_id, security_id, sector_key, game_quarter_id, dedupe_key,
                                     announced_at, scheduled_at)
select k.kind::public.scheduled_event_kind, k.title, k.imp, c.id, case when k.with_company then c.security_id end,
       case when k.with_company then c.sector_key end, :fx_eq, 'fixture:' || k.kind,
       public.game_now() - interval '6 hours', public.game_now() - k.ago
  from (values ('closing_bell', 'Börsenschluss', 1, false, interval '4 minutes', 'VLT'),
               ('earnings', 'Quartalszahlen', 2, true, interval '3 minutes', 'VLT'),
               ('pharma_trial', 'Studienergebnis', 3, true, interval '2 minutes', 'ALM'),
               ('rate_decision', 'Zinsentscheid der Zentralbank', 3, false, interval '1 minute', 'VLT'))
       k(kind, title, imp, with_company, ago, ticker)
  join public.securities s on s.ticker = k.ticker
  join public.companies c on c.id = s.company_id
 order by k.ago desc;
update public.scheduled_events e set company_id = null where e.kind in ('closing_bell', 'rate_decision');
insert into public.scheduled_event_secrets (event_id, params)
select id, '{"success_probability": 1}'::jsonb from public.scheduled_events where kind = 'pharma_trial';
select public.events_resolve_due(public.game_now()) is not null as ok \gset
update public.game_quarters set status = :'fx_eq_status' where id = :fx_eq;
select public.events_plan(public.game_now()) is not null as ok \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_events.json
select public.get_events(20);
\o
reset role;

-- M4h: company events, response steps and company news (ADR-091) -------------------------------------------------
-- (separate block; a garage with a missed chance in its history and an open crisis with one finished step)
\set fx_e '''f1f1f1f1-0000-4000-8000-0000000000fe'''
select tests.signup(:fx_e, 'Fixture_Krise') is not null as ok \gset
select tests.set_level(:fx_e, 6);
select tests.fund(:fx_e, 5000000, 'fixture:m4h:e');
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/get_company_event_none.json
select public.get_company_event();
\o
reset role;
select tests.login_as('authenticated', :fx_e) is null as ok \gset
select public.found_company(gen_random_uuid(), 'Fixture Krisenstab', 'Strom vom Dach', 'energy', '#aa5533', 'garage') is not null as ok \gset
reset role;
select company_id as fx_eco from public.player_companies where founder_id = :fx_e \gset
select public.company_event_start(:'fx_eco', 'viral_trend', 1, now() - interval '13 hours') is not null as ok \gset
select public.company_events_run_due(now(), false) is not null as ok \gset
select public.company_event_start(:'fx_eco', 'regulation', 2, now()) as fx_ev \gset
select tests.login_as('service_role') is null as ok \gset
select public.store_company_ai_profile(:'fx_eco', '{"product": ["Solarziegel"], "input": ["Silizium", "Glas"], "tax": ["Stromsteuer"],
  "rule": ["Bauordnung"], "risk": ["Hagel"], "trend": ["Balkonkraftwerk"], "buyer": ["Hausbesitzer", "Stadtwerke"],
  "critic": ["Denkmalschutz"], "place": ["Dachboden"]}'::jsonb) as ok \gset
select public.store_company_event_text(:'fx_ev', 'Neue Bauordnung bremst Solardächer',
  'Die Stadt verlangt für jede Dachanlage ein Gutachten. Fixture Krisenstab muss reagieren.', 'Bauamt') as ok \gset
reset role;
select tests.login_as('authenticated', :fx_e) is null as ok \gset
\o :fixture_dir/choose_event_strategy.json
select public.choose_event_strategy(gen_random_uuid(), :'fx_ev', 'lobby');
\o :fixture_dir/start_event_step.json
select public.start_event_step(gen_random_uuid(), :'fx_ev');
\o
reset role;
-- the step is resolved now with a fixed draw instead of waiting for run_due_jobs and the server's randomness
select public.company_event_resolve_step(id, 0) as ok from public.company_event_steps
 where event_id = :'fx_ev' and status = 'running' \gset
select id as fx_nid from public.company_news where company_id = :'fx_eco' and kind = 'founded' \gset
select tests.login_as('service_role') is null as ok \gset
select public.store_company_news_text(:fx_nid, 'Fixture Krisenstab geht ans Netz', 'Strom vom Dach, gebaut in der Garage.') as ok \gset
reset role;
select tests.login_as('authenticated', :fx_e) is null as ok \gset
\o :fixture_dir/get_company_event.json
select public.get_company_event();
\o :fixture_dir/get_company_news.json
select public.get_company_news();
\o :fixture_dir/company_ai_context.json
select public.company_ai_context();
\o
reset role;

-- M4i: upgrades (ADR-093) and promotions (ADR-094) ---------------------------------------------------------------
-- (separate block; an AI intern who is turned down once and then promoted, and a player company whose boss
-- sees a request in the team list, declines it and promotes anyway)
\set fx_i '''f1f1f1f1-0000-4000-8000-0000000001a1'''
\set fx_c '''f1f1f1f1-0000-4000-8000-0000000001a2'''
\set fx_m '''f1f1f1f1-0000-4000-8000-0000000001a3'''
select tests.signup(:fx_i, 'Fixture_Aufstieg') is not null and tests.signup(:fx_c, 'Fixture_Chef') is not null
   and tests.signup(:fx_m, 'Fixture_Team') is not null as ok \gset
select tests.set_level(:fx_i, 5);
select tests.set_level(:fx_c, 6);
select tests.set_level(:fx_m, 5);
select tests.fund(:fx_i, 5000000, 'fixture:m4i:i');
select tests.fund(:fx_c, 5000000, 'fixture:m4i:c');
select tests.login_as('authenticated', :fx_i) is null as ok \gset
\o :fixture_dir/get_upgrades.json
select public.get_upgrades();
\o :fixture_dir/buy_upgrade.json
select public.buy_upgrade(gen_random_uuid(), 'vault');
\o :fixture_dir/get_upgrades_bought.json
select public.get_upgrades();
\o
select x ->> 'id' as fx_ipost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where x ->> 'tier' = 'intern' and (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean
 order by x ->> 'id' limit 1 \gset
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'fx_ipost', 15000, null) ->> 'id')::uuid,
                            'M1 1 L5 5') is not null as ok \gset
reset role;
-- IT as main branch, level 5, IT score 3, 12.5 hours in the rank: ready for junior
update public.player_jobs set required = '[{"branch": "it", "min_score": 0}]', title_key = 'it_intern', title = 'it_intern',
       rank_minutes = 750
 where player_id = :fx_i and status = 'active';
insert into public.player_skills (player_id, skill_key) values (:fx_i, 'it_basics'), (:fx_i, 'it_programming') on conflict do nothing;
select value -> 'promotion' as fx_promo from public.game_config where key = 'careers' \gset
select tests.login_as('authenticated', :fx_i) is null as ok \gset
\o :fixture_dir/get_my_job_promotion_ready.json
select public.get_my_job();
\o
reset role;
-- the AI boss's answer is forced: first no (chance 0), then yes (chance 100 %)
select tests.set_cfg('careers', '{promotion,maxChanceBps}', '0');
select tests.login_as('authenticated', :fx_i) is null as ok \gset
\o :fixture_dir/request_promotion_declined.json
select public.request_promotion(gen_random_uuid());
\o
reset role;
update public.player_jobs set promotion_retry_at = null where player_id = :fx_i and status = 'active';
select tests.set_cfg('careers', '{promotion,maxChanceBps}', '10000');
select tests.set_cfg('careers', '{promotion,baseChanceBps}', '10000');
select tests.login_as('authenticated', :fx_i) is null as ok \gset
\o :fixture_dir/request_promotion.json
select public.request_promotion(gen_random_uuid());
\o
reset role;
select tests.set_cfg('careers', '{promotion}', :'fx_promo'::jsonb);
-- player company: hire, request, team list, no, promotion by the boss
select tests.login_as('authenticated', :fx_c) is null as ok \gset
select public.found_company(gen_random_uuid(), 'Fixture Leitern', 'Leitern für jede Höhe', 'tech', '#447799', 'garage')
       is not null as ok \gset
reset role;
select company_id as fx_cco from public.player_companies where founder_id = :fx_c \gset
select tests.login_as('authenticated', :fx_c) is null as ok \gset
select public.create_job_posting(gen_random_uuid(), :'fx_cco', 'intern', 'Werkstudium Leitern',
  '[{"branch": "it", "min_score": 0}]', 20000, 1) ->> 'id' as fx_cpost \gset
select tests.login_as('authenticated', :fx_m) is null as ok \gset
select public.apply_for_job(gen_random_uuid(), :'fx_cpost', 20000, null) ->> 'id' as fx_capp \gset
select tests.login_as('authenticated', :fx_c) is null as ok \gset
select public.respond_application(gen_random_uuid(), :'fx_capp', 'accept', null) is not null as ok \gset
select tests.login_as('authenticated', :fx_m) is null as ok \gset
select public.sign_contract(gen_random_uuid(), :'fx_capp', 'M1 1 L6 6') is not null as ok \gset
reset role;
select id as fx_mjob from public.player_jobs where player_id = :fx_m and status = 'active' \gset
update public.player_jobs set rank_minutes = 750 where id = :'fx_mjob';
insert into public.player_skills (player_id, skill_key) values (:fx_m, 'it_basics'), (:fx_m, 'it_programming') on conflict do nothing;
select tests.login_as('authenticated', :fx_m) is null as ok \gset
\o :fixture_dir/request_promotion_pending.json
select public.request_promotion(gen_random_uuid());
\o :fixture_dir/get_my_job_promotion_pending.json
select public.get_my_job();
\o
select tests.login_as('authenticated', :fx_c) is null as ok \gset
\o :fixture_dir/get_company_team_promotion.json
select public.get_company_team(:'fx_cco');
\o :fixture_dir/decline_promotion.json
select public.decline_promotion(gen_random_uuid(), :'fx_cco', :'fx_mjob');
\o :fixture_dir/promote_employee.json
select public.promote_employee(gen_random_uuid(), :'fx_cco', :'fx_mjob', null);
\o
reset role;

-- M4j: marketing campaigns, deals between players and trust (ADR-097/098) ---------------------------------------
-- (the M1 test invite code is shared by every block; give this one its own room)
update public.invite_codes set max_uses = max_uses + 20 where code = 'M1-TESTS';
-- (separate block: a supplier with a tech garage, a buyer with a retail garage and an investor without a company)
\set fx_da '''f1f1f1f1-0000-4000-8000-00000000d4a1'''
\set fx_db '''f1f1f1f1-0000-4000-8000-00000000d4b1'''
\set fx_dc '''f1f1f1f1-0000-4000-8000-00000000d4c1'''
select tests.signup(:fx_da, 'Fixture_Lieferant') is not null and tests.signup(:fx_db, 'Fixture_Abnehmer') is not null
   and tests.signup(:fx_dc, 'Fixture_Anleger') is not null as ok \gset
select tests.set_level(x, 6) from unnest(array[:fx_da, :fx_db, :fx_dc]::uuid[]) x;
select tests.fund(:fx_da, 5000000, 'fixture:m4j:a');
select tests.fund(:fx_db, 5000000, 'fixture:m4j:b');
select tests.fund(:fx_dc, 2000000, 'fixture:m4j:c');
select tests.login_as('authenticated', :fx_db);
select public.found_company(gen_random_uuid(), 'Fixture Abnahme', 'Alles für den Laden', 'retail', '#55aa33', 'garage') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :fx_da);
select public.found_company(gen_random_uuid(), 'Fixture Lieferwerk', 'Teile auf Abruf', 'tech', '#3355aa', 'garage') is not null as ok \gset
select company_id as fx_dco from public.player_companies where founder_id = :fx_da and status = 'active' \gset
\o :fixture_dir/start_campaign.json
select public.start_campaign(gen_random_uuid(), :'fx_dco', 'flyer');
\o :fixture_dir/get_my_company_campaign.json
select public.get_my_company();
\o :fixture_dir/propose_deal.json
select public.propose_deal(gen_random_uuid(), 'loan', 'lender', 'Fixture_Abnehmer',
         '{"principal_cents": 100000, "interest_bps": 1000, "hours": 48}', 'Für den Wareneinkauf');
\o :fixture_dir/propose_deal_supply.json
select public.propose_deal(gen_random_uuid(), 'supply', 'supplier', 'Fixture_Abnehmer',
         '{"volume_cents_per_hour": 30000, "fee_bps": 5000, "prepay_bps": 2000, "hours": 24}', null);
\o :fixture_dir/propose_deal_board.json
select public.propose_deal(gen_random_uuid(), 'stake', 'company', null, '{"amount_cents": 100000, "share_bps": 2000, "hours": 72}',
                           'Wer steigt ein?');
\o
select public.propose_deal(gen_random_uuid(), 'loan', 'lender', 'Fixture_Abnehmer',
         '{"principal_cents": 20000, "interest_bps": 0, "hours": 24}', null) ->> 'id' as fx_dl2 \gset
select public.propose_deal(gen_random_uuid(), 'loan', 'lender', null, '{"principal_cents": 20000, "interest_bps": 0, "hours": 24}',
                           null) ->> 'id' as fx_dl3 \gset
\o :fixture_dir/cancel_deal.json
select public.cancel_deal(gen_random_uuid(), :'fx_dl3');
\o
reset role;
select id as fx_dl1 from public.deals where proposer_id = :fx_da and kind = 'loan' and principal_cents = 100000 \gset
select id as fx_ds1 from public.deals where proposer_id = :fx_da and kind = 'supply' \gset
select id as fx_dk1 from public.deals where proposer_id = :fx_da and kind = 'stake' \gset
select tests.login_as('authenticated', :fx_dc);
\o :fixture_dir/get_deal_board.json
select public.get_deal_board();
\o :fixture_dir/respond_deal_stake.json
select public.respond_deal(gen_random_uuid(), :'fx_dk1', true);
\o
reset role;
select tests.login_as('authenticated', :fx_db);
\o :fixture_dir/get_deals_incoming.json
select public.get_deals();
\o :fixture_dir/respond_deal.json
select public.respond_deal(gen_random_uuid(), :'fx_dl1', true);
\o :fixture_dir/respond_deal_supply.json
select public.respond_deal(gen_random_uuid(), :'fx_ds1', true);
\o :fixture_dir/respond_deal_declined.json
select public.respond_deal(gen_random_uuid(), :'fx_dl2', false);
\o :fixture_dir/repay_loan.json
select public.repay_loan(gen_random_uuid(), :'fx_dl1', 40000);
\o
reset role;
select tests.login_as('authenticated', :fx_da);
\o :fixture_dir/forgive_loan.json
select public.forgive_loan(gen_random_uuid(), :'fx_dl1');
\o :fixture_dir/break_deal.json
select public.break_deal(gen_random_uuid(), :'fx_ds1');
\o :fixture_dir/get_deals.json
select public.get_deals();
\o
reset role;
select tests.login_as('authenticated', 'f1f1f1f1-0000-4000-8000-0000000000fd');
\o :fixture_dir/get_deals_empty.json
select public.get_deals();
\o :fixture_dir/get_player_card_trust.json
select public.get_player_card('Fixture_Lieferant');
\o
reset role;

-- M4k: upgrade stages, unique names, replacing the own company, the top layer, presence and the org chart
-- (ADR-100, ADR-103)
update public.invite_codes set max_uses = max_uses + 5 where code = 'M1-TESTS';
\set fx_n '''f1f1f1f1-0000-4000-8000-0000000001b1'''
select tests.signup(:fx_n, 'Fixture_Neustart') is not null as ok \gset
select tests.set_level(:fx_n, 8);
select tests.fund(:fx_n, 5000000, 'fixture:m4k:n');
select tests.login_as('authenticated', :fx_n) is null as ok \gset
\o :fixture_dir/check_artwork_title.json
select public.check_artwork_title('Fixture im Morgenrot');
\o :fixture_dir/check_artwork_title_rejected.json
select public.check_artwork_title('FIXTURE IM ABENDROT');
\o :fixture_dir/buy_upgrade_makler.json
select public.buy_upgrade(gen_random_uuid(), 'makler');
\o
select public.found_company(gen_random_uuid(), 'Fixture Erstling', 'Erste Idee', 'tech', '#335577', 'garage') is not null as ok \gset
\o :fixture_dir/check_company_name_own.json
select public.check_company_name('Fixture Erstling');
\o :fixture_dir/found_company_replace.json
select public.found_company(gen_random_uuid(), 'Fixture Zweitling', 'Zweite Idee', 'retail', '#553377', 'garage', null, true);
\o
reset role;
select tests.login_as('authenticated', :fx_h) is null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'table_oak', 1) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'laptop', 1) -> 'inventory' -> 'furniture' as fx_inv \gset
\o :fixture_dir/save_layout_top.json
select public.save_layout(gen_random_uuid(), '#2f5fd0', 'parquet',
         (select jsonb_agg(case e ->> 'item_key' when 'table_oak' then jsonb_build_object('id', e ->> 'id', 'x', 2, 'y', 2, 'rot', 0)
                                                 else jsonb_build_object('id', e ->> 'id', 'x', 3, 'y', 3, 'rot', 0) end)
            from jsonb_array_elements(:'fx_inv'::jsonb) e where e ->> 'item_key' in ('table_oak', 'laptop')));
\o
reset role;
select tests.login_as('authenticated', :fx_c) is null as ok \gset
\o :fixture_dir/get_company_org.json
select public.get_company_org(:'fx_cco');
\o
reset role;
select tests.login_as('authenticated', :fx_m) is null as ok \gset
\o :fixture_dir/get_company_org_member.json
select public.get_company_org(:'fx_cco');
\o
reset role;

-- M5a: cryptocurrencies and own coins (ADR-101) -------------------------------------------------------------------
-- (the coins were seeded by run_due_jobs() in the assertions; a trader and a creator of their own)
update public.invite_codes set max_uses = max_uses + 5 where code = 'M1-TESTS';
\set fx_ca '''f1f1f1f1-0000-4000-8000-00000000c5a1'''
\set fx_cb '''f1f1f1f1-0000-4000-8000-00000000c5b1'''
\set fx_logo '''{"palette": ["#2bc3d9", "#111318"], "grid": ["................", "................", "....00000000....", "....01111110....", "....01111110....", "....00000000....", "................", "................", "................", "................", "................", "................", "................", "................", "................", "................"]}'''
select tests.signup(:fx_ca, 'Fixture_Coiner') is not null and tests.signup(:fx_cb, 'Fixture_Halter') is not null as ok \gset
select tests.set_level(:fx_ca, 14);
select tests.set_level(:fx_cb, 10);
select tests.fund(:fx_ca, 10000000, 'fixture:m5a:a');
select tests.fund(:fx_cb, 5000000, 'fixture:m5a:b');
update public.sim_runtime set is_paused = false;
select public.crypto_run_due() is not null as ok \gset
select public.market_tick() is not null as ok \gset
select tests.login_as('authenticated', :fx_cb) is null as ok \gset
\o :fixture_dir/get_crypto_market.json
select public.get_crypto_market();
\o :fixture_dir/crypto_trade.json
select public.crypto_trade(gen_random_uuid(), 'KTL', 'buy', 100000, null, 200);
\o
reset role;
select p.quantity_e6 / 2 as fx_half from public.positions p join public.securities s on s.id = p.security_id
 where p.player_id = :fx_cb and s.ticker = 'KTL' and p.status = 'open' \gset
select tests.login_as('authenticated', :fx_cb) is null as ok \gset
\o :fixture_dir/crypto_trade_sell.json
select public.crypto_trade(gen_random_uuid(), 'KTL', 'sell', null, :fx_half);
\o :fixture_dir/get_coin.json
select public.get_coin('KTL');
\o :fixture_dir/get_candles_crypto.json
select public.get_candles('KTL', '5m', 20);
\o :fixture_dir/get_my_portfolio_crypto.json
select public.get_my_portfolio();
\o
reset role;
select tests.login_as('authenticated', :fx_ca) is null as ok \gset
\o :fixture_dir/get_my_coin_none.json
select public.get_my_coin();
\o :fixture_dir/check_coin_name.json
select public.check_coin_name('Fixture Taler', 'FXT');
\o :fixture_dir/check_coin_name_rejected.json
select public.check_coin_name('Fixture Taler', 'KTL');
\o :fixture_dir/create_coin.json
select public.create_coin(gen_random_uuid(), 'Fixture Taler', 'FXT', :fx_logo);
\o :fixture_dir/start_coin_action.json
select public.start_coin_action(gen_random_uuid(), 'audit');
\o :fixture_dir/get_my_coin.json
select public.get_my_coin();
\o
reset role;
-- the audit ends (resolved by the minute job), then the launch
update public.crypto_coin_actions set ends_at = started_at
 where coin_id = (select c.id from public.crypto_coins c where c.creator_id = :fx_ca and c.status = 'draft');
update public.crypto_state set hour_done = date_bin('1 hour', public.game_now(), '2000-01-01 00:00:00+00'::timestamptz);
select public.crypto_run_due() is not null as ok \gset
select tests.login_as('authenticated', :fx_ca) is null as ok \gset
\o :fixture_dir/launch_coin.json
select public.launch_coin(gen_random_uuid(), 1000, 1000000, 2000);
\o
select tests.login_as('authenticated', :fx_cb) is null as ok \gset
select public.crypto_trade(gen_random_uuid(), 'FXT', 'buy', 100000) is not null as ok \gset
\o :fixture_dir/get_coin_player.json
select public.get_coin('FXT');
\o
select tests.login_as('authenticated', :fx_ca) is null as ok \gset
\o :fixture_dir/crypto_trade_rug_pull.json
select public.crypto_trade(gen_random_uuid(), 'FXT', 'sell', null, 7500000000);
\o :fixture_dir/burn_coin_tokens.json
select public.burn_coin_tokens(gen_random_uuid(), 250000000);
\o :fixture_dir/get_my_coin_listed.json
select public.get_my_coin();
\o :fixture_dir/get_crypto_market_with_own_coin.json
select public.get_crypto_market();
\o :fixture_dir/discontinue_coin.json
select public.discontinue_coin(gen_random_uuid());
\o
reset role;

-- Friend code (ADR-111) -------------------------------------------------------------------------------------------
update public.invite_codes set max_uses = max_uses + 5 where code = 'M1-TESTS';
\set fx_fa '''f1f1f1f1-0000-4000-8000-00000000fc01'''
\set fx_fb '''f1f1f1f1-0000-4000-8000-00000000fc02'''
select tests.signup(:fx_fa, 'Fixture_Werber') is not null and tests.signup(:fx_fb, 'Fixture_Gast') is not null as ok \gset
select 'NEXA-' || tag as fx_code from public.profiles where id = :fx_fa \gset
select tests.login_as('authenticated', :fx_fb) is null as ok \gset
\o :fixture_dir/get_friend_code.json
select public.get_friend_code();
\o :fixture_dir/redeem_friend_code.json
select public.redeem_friend_code(gen_random_uuid(), :'fx_code');
\o :fixture_dir/get_friend_code_redeemed.json
select public.get_friend_code();
\o
reset role;

-- Stock news with a lead (ADR-119) -----------------------------------------------------------------------------------
select public.stock_news_run_due() is not null as ok \gset
update public.stock_tips set due_at = published_at where id = (select min(id) from public.stock_tips);
select public.stock_news_run_due(public.game_now() + interval '1 hour') is not null as ok \gset
select tests.login_as('authenticated', :fx_fb) is null as ok \gset
\o :fixture_dir/get_stock_news.json
select public.get_stock_news(10);
\o
reset role;

-- Friends' investments (ADR-121) -------------------------------------------------------------------------------------
select tests.fund(:fx_fb, 2000000, 'fixture:holdings') is not null as ok \gset
select tests.login_as('authenticated', :fx_fb) is null as ok \gset
select public.place_order(gen_random_uuid(), 'KLS', 'buy', 'market', null, null, 500000) is not null as ok \gset
\o :fixture_dir/get_player_holdings.json
select public.get_player_holdings('Fixture_Gast');
\o
reset role;
select tests.login_as('authenticated', :fx_fa) is null as ok \gset
\o :fixture_dir/get_player_holdings_private.json
select public.get_player_holdings('Fixture_Gast');
\o
reset role;

-- Portfolio chart (ADR-124) ----------------------------------------------------------------------------------------
select public.rich_list_snapshot(true) is not null as ok \gset
select tests.login_as('authenticated', :fx_fb) is null as ok \gset
\o :fixture_dir/get_my_net_worth_history.json
select public.get_my_net_worth_history(24);
\o
reset role;

-- Company profile (ADR-125) ----------------------------------------------------------------------------------------
select c.id as fx_ai_company from public.companies c where c.is_ai and c.ticker = 'KLS' \gset
select pc.company_id as fx_player_company from public.player_companies pc join public.companies c on c.id = pc.company_id
 where c.dissolved_at is null limit 1 \gset
select tests.login_as('authenticated', :fx_fb) is null as ok \gset
\o :fixture_dir/get_company_profile.json
select public.get_company_profile(:'fx_ai_company');
\o :fixture_dir/get_company_profile_player.json
select public.get_company_profile(:'fx_player_company');
\o
reset role;

-- Business moves (ADR-127) -----------------------------------------------------------------------------------------
select tests.fund(:fx_g, 5000000, 'fixture:moves') is not null as ok \gset
select tests.login_as('authenticated', :fx_g) is null as ok \gset
select public.company_deposit(gen_random_uuid(), 5000000) is not null as ok \gset
\o :fixture_dir/get_company_moves.json
select public.get_company_moves();
\o
select public.get_company_moves() -> 'moves' -> 0 ->> 'key' as fx_move \gset
\o :fixture_dir/start_company_move.json
select public.start_company_move(gen_random_uuid(), :'fx_move');
\o
reset role;
select public.company_moves_run_due(now() + interval '2 hours') is not null as ok \gset
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/get_company_moves_history.json
select public.get_company_moves();
\o
reset role;

-- CEO interviews (ADR-173) ------------------------------------------------------------------------------------------
select company_id as fx_gco from public.player_companies where founder_id = :fx_g and status = 'active' \gset
select public.company_interview_request(:'fx_gco', now()) is not null as ok \gset
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/get_company_interview.json
select public.get_company_interview();
\o :fixture_dir/answer_company_interview.json
select public.answer_company_interview(gen_random_uuid(), (public.get_company_interview() #>> '{interview,id}')::bigint,
  '[{"text": "Danke an das ganze Team und unsere Kunden."}, {"quick": 0}, {"text": ""}]');
\o
reset role;
update public.company_interviews set requested_at = requested_at - interval '2 days' where company_id = :'fx_gco';
select public.company_interview_request(:'fx_gco', now()) is not null as ok \gset
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/decline_company_interview.json
select public.decline_company_interview(gen_random_uuid(), (public.get_company_interview() #>> '{interview,id}')::bigint);
\o
reset role;

-- Company tasks, supervisors and the news feed (ADR-129) -------------------------------------------------------------
\set fx_ta '''f1f1f1f1-0000-4000-8000-0000000007a1'''
\set fx_tb '''f1f1f1f1-0000-4000-8000-0000000007b1'''
\set fx_tc '''f1f1f1f1-0000-4000-8000-0000000007c1'''
select tests.signup(:fx_ta, 'Fx_Taskboss') is not null and tests.signup(:fx_tb, 'Fx_Taskmid') is not null
   and tests.signup(:fx_tc, 'Fx_Tasknew') is not null as ok \gset
select tests.set_level(:fx_ta, 12);
select tests.set_level(:fx_tb, 6);
select tests.set_level(:fx_tc, 6);
select tests.fund(:fx_ta, 20000000, 'fixture:tasks') is not null as ok \gset
select tests.login_as('authenticated', :fx_ta) is null as ok \gset
select public.found_company(gen_random_uuid(), 'Fixture Mode', 'Shirts', 'retail', '#aa3366', 'garage', 'fashion')
  -> 'company' ->> 'id' as fx_tco \gset
select public.company_deposit(gen_random_uuid(), 2000000) is not null as ok \gset
reset role;
select tests.hire(:fx_ta, :fx_tb, 20000) as fx_tbj \gset
select tests.hire(:fx_ta, :fx_tc, 20000) as fx_tcj \gset
update public.player_jobs set tier = 'senior' where id = :'fx_tbj';
update public.player_jobs set tier = 'intern' where id = :'fx_tcj';
update public.player_companies set ai_workers = 1 where company_id = :'fx_tco';
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, due_at)
values (:'fx_tco', 'pack_shirts', 'logistics', 'pick', 44000, now() + interval '40 minutes'),
       (:'fx_tco', 'payroll_check', 'finance', 'math', 44000, now() + interval '40 minutes'),
       (:'fx_tco', 'runway_order', 'sales', 'seq', 36000, now() + interval '40 minutes');
select id as fx_t1 from public.company_tasks where company_id = :'fx_tco' and task_key = 'pack_shirts' \gset
select id as fx_t2 from public.company_tasks where company_id = :'fx_tco' and task_key = 'payroll_check' \gset
select id as fx_t3 from public.company_tasks where company_id = :'fx_tco' and task_key = 'runway_order' \gset
select tests.login_as('authenticated', :fx_ta) is null as ok \gset
\o :fixture_dir/set_job_supervisor.json
select public.set_job_supervisor(gen_random_uuid(), 'Fx_Tasknew', 'Fx_Taskmid');
\o :fixture_dir/delegate_company_task.json
select public.delegate_company_task(gen_random_uuid(), :fx_t1, 'Fx_Taskmid');
\o :fixture_dir/delegate_company_task_ai.json
select public.delegate_company_task(gen_random_uuid(), :fx_t3, 'ai');
\o :fixture_dir/set_company_tasks_auto_ai.json
select public.set_company_tasks_auto_ai(gen_random_uuid(), false);
\o :fixture_dir/start_company_task.json
select public.start_company_task(gen_random_uuid(), :fx_t2);
\o
reset role;
select solution ->> 'value' as fx_tv from public.company_tasks where id = :fx_t2 \gset
select tests.login_as('authenticated', :fx_ta) is null as ok \gset
\o :fixture_dir/submit_company_task.json
select public.submit_company_task(gen_random_uuid(), :fx_t2, jsonb_build_object('value', :'fx_tv'::int));
\o
reset role;
-- autopilot (ADR-180): one logged result, then on and off again
insert into public.company_autopilot_log (company_id, task_id, task_key, success, result_cents, chance_bps)
values (:'fx_tco', null, 'pay_invoices', true, 12345, 9000);
select tests.login_as('authenticated', :fx_ta) is null as ok \gset
\o :fixture_dir/set_company_autopilot.json
select public.set_company_autopilot(gen_random_uuid(), true);
\o :fixture_dir/get_company_autopilot.json
select public.get_company_autopilot();
\o :fixture_dir/get_company_awareness.json
select public.get_company_awareness();
\o
select public.set_company_autopilot(gen_random_uuid(), false) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :fx_tb) is null as ok \gset
\o :fixture_dir/get_company_tasks.json
select public.get_company_tasks();
\o
reset role;
select public.fun_news_run_due(now()) is not null as ok \gset
select tests.login_as('authenticated', :fx_tc) is null as ok \gset
\o :fixture_dir/get_news_feed.json
select public.get_news_feed('all', 30);
\o :fixture_dir/get_company_org_supervisor.json
select public.get_company_org(:'fx_tco');
\o
reset role;

-- Own strategies (ADR-132) ----------------------------------------------------------------------------------------
insert into public.player_company_events (company_id, archetype, polarity, severity, status, definition, started_at, deadline_at)
values (:'fx_tco', 'strike', 'crisis', 1, 'open', '{"strategies": []}'::jsonb, now(), now() + interval '2 hours');
select tests.login_as('authenticated', :fx_ta) is null as ok \gset
\o :fixture_dir/submit_company_pitch.json
select public.submit_company_pitch(gen_random_uuid(), 'event', 'Wir zahlen fairere Löhne und reden offen mit dem Team.');
\o
reset role;
select public.company_pitches_run_due(now() + interval '2 minutes') is not null as ok \gset
select tests.login_as('authenticated', :fx_ta) is null as ok \gset
\o :fixture_dir/get_company_pitches.json
select public.get_company_pitches();
\o
reset role;

-- Protest campaigns (ADR-133) -------------------------------------------------------------------------------------
select tests.set_level(:fx_tb, 6);
select tests.fund(:fx_tc, 1000000, 'fixture:protest') is not null as ok \gset
select c.id as fx_kls from public.companies c where c.ticker = 'KLS' \gset
select tests.login_as('authenticated', :fx_tc) is null as ok \gset
\o :fixture_dir/start_protest.json
select public.start_protest(gen_random_uuid(), :'fx_kls', 'petition');
\o
reset role;
select id as fx_pr from public.company_protests where company_id = :'fx_kls' and status = 'open' \gset
select tests.login_as('authenticated', :fx_ta) is null as ok \gset
\o :fixture_dir/join_protest.json
select public.join_protest(gen_random_uuid(), :fx_pr);
\o :fixture_dir/get_protests.json
select public.get_protests();
\o
reset role;

-- Finn's tours on the server --------------------------------------------------------------------------------------
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/mark_tour_seen.json
select public.mark_tour_seen(gen_random_uuid(), 'visit_company');
\o :fixture_dir/get_seen_tours.json
select public.get_seen_tours();
\o
reset role;

-- Popular stocks first (ADR-145) -----------------------------------------------------------------------------------
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/record_security_view.json
select public.record_security_view(gen_random_uuid(), 'KLS');
\o
reset role;

-- NFTs (ADR-135): fixed price, offer chat with an accepted offer, a purchase, an AI collector's offer ----------------
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/set_artwork_price.json
select public.set_artwork_price(gen_random_uuid(), :'fx_art2', 400000);
\o
reset role;
select tests.login_as('authenticated', :fx_k) is null as ok \gset
\o :fixture_dir/post_artwork_message.json
select public.post_artwork_message(gen_random_uuid(), :'fx_art2', 'Schönes Bild!');
\o :fixture_dir/post_artwork_message_offer.json
select public.post_artwork_message(gen_random_uuid(), :'fx_art2', 'Wäre das ein Preis?', 300000);
\o
reset role;
select id as fx_offer from public.artwork_messages where artwork_id = :'fx_art2' and author_id = :fx_k and offer_status = 'open' \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_artwork_chat.json
select public.get_artwork_chat(:'fx_art2');
\o :fixture_dir/accept_artwork_offer.json
select public.accept_artwork_offer(gen_random_uuid(), :fx_offer);
\o
reset role;
select tests.login_as('authenticated', :fx_k) is null as ok \gset
select public.set_artwork_price(gen_random_uuid(), :'fx_art2', 450000) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/buy_artwork.json
select public.buy_artwork(gen_random_uuid(), :'fx_art2', 450000);
\o
select public.set_artwork_price(gen_random_uuid(), :'fx_art2', 90000000) is not null as ok \gset
reset role;
update public.game_config set value = jsonb_set(value, '{ai,listedOfferChanceBps}', '10000') where key = 'nfts';
select public.nfts_run_due(now()) is not null as ok \gset
update public.game_config set value = jsonb_set(value, '{ai,listedOfferChanceBps}', '800') where key = 'nfts';
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_artwork_chat_ai.json
select public.get_artwork_chat(:'fx_art2');
\o :fixture_dir/get_artworks_for_sale.json
select public.get_artworks('for_sale', 'all', false, 6, 0);
\o
reset role;

-- NEXA Nachrichten (ADR-150): this hour's show starts for its first viewer, a chat line ------------------------------
delete from public.news_shows;
delete from public.news_show_messages;
update public.game_config set value = jsonb_set(value, '{waitMinutes}', '60') where key = 'newsShow';
insert into public.news_shows (airs_at, segments) values (date_trunc('hour', now()), public.news_show_build(now()));
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/post_news_show_message.json
select public.post_news_show_message(gen_random_uuid(), 'Was für eine Sendung 💀📉');
\o :fixture_dir/get_news_show.json
select public.get_news_show();
\o
reset role;
update public.game_config set value = jsonb_set(value, '{waitMinutes}', '10') where key = 'newsShow';

-- Accessories and poking friends (ADR-155) ---------------------------------------------------------------------------
select tests.fund(:p, 5000000, 'fixture:accessories');
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/buy_accessory.json
select public.buy_accessory(gen_random_uuid(), 'party_hat');
\o
select public.buy_accessory(gen_random_uuid(), 'sunglasses') is not null as ok \gset
\o :fixture_dir/wear_accessory.json
select public.wear_accessory(gen_random_uuid(), 'sunglasses', false);
\o :fixture_dir/get_accessories.json
select public.get_accessories();
\o
reset role;
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/poke_friend.json
select public.poke_friend(gen_random_uuid(), 'Fixture_Kunst');
\o :fixture_dir/get_friends_dressed.json
select public.get_friends();
\o
reset role;

-- Renting out places in the home (ADR-158): Fixture_Heim offers its house, an AI tenant and the fixture player move in
select tests.login_as('authenticated', :fx_h) is null as ok \gset
\o :fixture_dir/set_rental_offer.json
select public.set_rental_offer(gen_random_uuid(), 'hour', 1000, true);
\o
reset role;
insert into public.rental_tenancies (owner_id, is_ai, tenant_name, period, price_cents, started_at, next_due_at, ends_at)
values (:fx_h, true, 'Mia F.', 'hour', 1000, now(), now() + interval '1 hour', now() + interval '2 days');
select tests.set_level(:p, greatest(10, (select level from public.profiles where id = :p)));
select tests.fund(:p, 1000000, 'fixture:rentals');
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_rental_market.json
select public.get_rental_market();
\o :fixture_dir/rent_home.json
select public.rent_home(gen_random_uuid(), 'Fixture_Heim');
\o :fixture_dir/get_property_renting.json
select public.get_property(null);
\o
reset role;
select tests.login_as('authenticated', :fx_h) is null as ok \gset
\o :fixture_dir/get_rentals.json
select public.get_rentals();
\o
reset role;
select r.id as fx_ten from public.rental_tenancies r where r.tenant_id = :p and r.status = 'active' \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/end_tenancy.json
select public.end_tenancy(gen_random_uuid(), :'fx_ten');
\o :fixture_dir/get_rentals_tenant.json
select public.get_rentals();
\o
reset role;
-- many battles in one hour here: no hourly limit for the fixtures
update public.game_config set value = jsonb_set(value, '{lobby,perHour}', '1000') where key = 'battles';
-- News battles (ADR-160): the lobby, a quiz, an estimate, the bell, an action game, the podium ------------------------
\set fb1 '''f1f1f1f1-0000-4000-8000-0000000000b1'''
\set fb2 '''f1f1f1f1-0000-4000-8000-00000000b2a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:fb1, 'Fixture_Bat1') is not null and tests.signup(:fb2, 'Fixture_Bat2') is not null as ok \gset
update public.profiles set level = 3, xp_total = public.xp_total_for_level(3) where id in (:fb1, :fb2);
update public.battle_players set active = false where active;
update public.battles set status = 'cancelled', finished_at = now() where status in ('open', 'running');
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_battle.json
select public.get_battle();
\o
reset role;
-- a sealed booster prize (ADR-177), as the lobby shows it
update public.battles set prize = '{"kind":"packs","packs":[{"set":"super_apex","count":1},{"set":"mystic_energy","count":5}]}'
 where status = 'open';
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_battle_packs.json
select public.get_battle();
\o :fixture_dir/battle_join.json
select public.battle_join(gen_random_uuid());
\o :fixture_dir/battle_leave.json
select public.battle_leave(gen_random_uuid());
\o
select public.battle_join(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :fb1) is null as ok \gset
select public.get_battle() is not null and public.battle_join(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :fb2) is null as ok \gset
select public.get_battle() is not null and public.battle_join(gen_random_uuid()) is not null as ok \gset
reset role;
update public.battles set countdown_ends_at = now() - interval '1 second', prize = '{"kind":"money"}' where status = 'open';
select public.battle_maintain(now()) is null as ok \gset
update public.battles set kind = 'quiz', params = public.battle_params('quiz'), plan = public.battle_plan('quiz', public.battle_params('quiz')),
                          started_at = now() - interval '12 seconds', ends_at = now() + interval '90 seconds'
 where status = 'running';
select id as fx_bid from public.battles where status = 'running' \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/battle_answer.json
select public.battle_answer(gen_random_uuid(), :fx_bid, 1, 2, null);
\o :fixture_dir/get_battle_quiz.json
select public.get_battle();
\o
reset role;
update public.battles set kind = 'estimate', params = public.battle_params('estimate'),
                          plan = public.battle_plan('estimate', public.battle_params('estimate')),
                          started_at = now() - interval '17 seconds'
 where status = 'running';
select tests.login_as('authenticated', :p) is null as ok \gset
select public.battle_answer(gen_random_uuid(), :fx_bid, 1, null, 123.45) is not null as ok \gset
\o :fixture_dir/get_battle_estimate.json
select public.get_battle();
\o
reset role;
update public.battles set kind = 'bell', params = public.battle_params('bell'),
                          plan = '{"waits":[1500,2000,2500,3000,3500,4000,1500,2000,2500]}', started_at = now() - interval '3500 milliseconds'
 where status = 'running';
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_battle_bell.json
select public.get_battle();
\o
reset role;
-- the round games of the addendum to ADR-160: a try at the vault, the chart, a sealed bid
delete from public.battle_answers where battle_id = :fx_bid;
update public.battles set kind = 'vault', params = public.battle_params('vault'),
                          plan = public.battle_plan('vault', public.battle_params('vault')), started_at = now() - interval '2 seconds'
 where status = 'running';
select tests.login_as('authenticated', :p) is null as ok \gset
select public.battle_answer(gen_random_uuid(), :fx_bid, 0, 123, null) is not null as ok \gset
\o :fixture_dir/get_battle_vault.json
select public.get_battle();
\o
reset role;
delete from public.battle_answers where battle_id = :fx_bid;
update public.battles set kind = 'higher', params = public.battle_params('higher'),
                          plan = public.battle_plan('higher', public.battle_params('higher')), started_at = now() - interval '9 seconds'
 where status = 'running';
select tests.login_as('authenticated', :p) is null as ok \gset
select public.battle_answer(gen_random_uuid(), :fx_bid, 1, 0, null) is not null as ok \gset
\o :fixture_dir/get_battle_higher.json
select public.get_battle();
\o
reset role;
delete from public.battle_answers where battle_id = :fx_bid;
update public.battles set kind = 'auction', params = public.battle_params('auction'),
                          plan = public.battle_plan('auction', public.battle_params('auction')), started_at = now() - interval '15 seconds'
 where status = 'running';
select tests.login_as('authenticated', :p) is null as ok \gset
select public.battle_answer(gen_random_uuid(), :fx_bid, 1, null, 120) is not null as ok \gset
\o :fixture_dir/get_battle_auction.json
select public.get_battle();
\o
reset role;
update public.battles set kind = 'floor', params = public.battle_params('floor'), plan = '{}',
                          started_at = now() - interval '2 seconds', ends_at = now() + interval '70 seconds'
 where status = 'running';
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/battle_sync.json
select public.battle_sync(:fx_bid, 30, '2222', 0, null);
\o
reset role;
update public.battles set started_at = now() - interval '80 seconds', ends_at = now() - interval '1 second' where status = 'running';
select public.battle_maintain(now()) is null as ok \gset
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/get_battle_recent.json
select public.get_battle();
\o
reset role;

-- Chats with friends (ADR-164): Fixture_Gmbh writes to Fixture_Kunst, then a group with Kunst and Fixture_Neu
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/open_direct_chat.json
select public.open_direct_chat(gen_random_uuid(), 'Fixture_Kunst');
\o
select public.open_direct_chat(gen_random_uuid(), 'Fixture_Kunst') -> 'chat' ->> 'id' as fx_dm \gset
\o :fixture_dir/post_chat_message.json
select public.post_chat_message(gen_random_uuid(), :fx_dm, 'Hallo Kunst 👋');
\o :fixture_dir/create_group_chat.json
select public.create_group_chat(gen_random_uuid(), 'Fixture Runde', array['Fixture_Kunst']);
\o
reset role;
select max(id) as fx_grp from public.friend_chats where name = 'Fixture Runde' \gset
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/add_group_member.json
select public.add_group_member(gen_random_uuid(), :fx_grp, 'Fixture_Neu');
\o :fixture_dir/rename_group.json
select public.rename_group(gen_random_uuid(), :fx_grp, 'Fixture Bullen');
\o
select public.post_chat_message(gen_random_uuid(), :fx_grp, 'Wer kauft mit?') is not null as ok \gset
\o :fixture_dir/remove_group_member.json
select public.remove_group_member(gen_random_uuid(), :fx_grp, 'Fixture_Neu');
\o :fixture_dir/leave_group.json
select public.leave_group(gen_random_uuid(), :fx_grp);
\o
reset role;
select tests.login_as('authenticated', :fx_k) is null as ok \gset
\o :fixture_dir/get_chats.json
select public.get_chats();
\o :fixture_dir/get_chat.json
select public.get_chat(:fx_dm);
\o :fixture_dir/mark_chat_read.json
select public.mark_chat_read(:fx_dm);
\o
reset role;

-- Nexamon collectible cards (ADR-165): Fixture_Gmbh opens a pack, lists, grades and sells; Fixture_Heim buys
select tests.fund(:fx_g, 50000000, 'fixture:nexamon:g') is null as ok \gset
select tests.fund(:fx_h, 50000000, 'fixture:nexamon:h') is null as ok \gset
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/buy_nexamon_pack.json
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy');
\o
-- sealed packs (ADR-177): bought to open later, then one opened
\o :fixture_dir/buy_nexamon_sealed_pack.json
select public.buy_nexamon_sealed_pack(gen_random_uuid(), 'mystic_energy', 2);
\o :fixture_dir/get_nexamon_sealed_packs.json
select public.get_nexamon_sealed_packs();
\o
select public.get_nexamon_sealed_packs() #>> '{packs,0,id}' as fx_sealed \gset
\o :fixture_dir/open_nexamon_sealed_pack.json
select public.open_nexamon_sealed_pack(gen_random_uuid(), :'fx_sealed');
\o :fixture_dir/buy_nexamon_packs.json
select public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 2);
\o
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy') -> 'cards' as fx_nx \gset
select :'fx_nx'::jsonb #>> '{0,copy_id}' as fx_nx1 \gset
select :'fx_nx'::jsonb #>> '{1,copy_id}' as fx_nx2 \gset
select :'fx_nx'::jsonb #>> '{2,copy_id}' as fx_nx3 \gset
select :'fx_nx'::jsonb #>> '{0,card_key}' as fx_nxk \gset
select (:'fx_nx'::jsonb #>> '{0,value_cents}')::bigint as fx_nxv \gset
\o :fixture_dir/get_nexamon.json
select public.get_nexamon();
\o :fixture_dir/list_nexamon_card.json
select public.list_nexamon_card(gen_random_uuid(), :'fx_nx1', :fx_nxv);
\o
reset role;
select id as fx_nxl from public.nexamon_listings where copy_id = :'fx_nx1' \gset
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/unlist_nexamon_card.json
select public.unlist_nexamon_card(gen_random_uuid(), :'fx_nxl');
\o
select public.list_nexamon_card(gen_random_uuid(), :'fx_nx1', :fx_nxv) #>> '{listing,id}' as fx_nxl \gset
\o :fixture_dir/grade_nexamon_card.json
select public.grade_nexamon_card(gen_random_uuid(), :'fx_nx2');
\o :fixture_dir/sell_nexamon_to_ai.json
select public.sell_nexamon_to_ai(gen_random_uuid(), array[:'fx_nx3']::uuid[]);
\o
-- ADR-174: several copies at once, bulk to the game (commons of a fresh pack)
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy') -> 'cards' as fx_nb \gset
select public.list_nexamon_cards(gen_random_uuid(), :'fx_nb'::jsonb #>> '{0,card_key}', :'fx_nb'::jsonb #>> '{0,condition}', null, 1, 500) as fx_lst \gset
\o :fixture_dir/list_nexamon_cards.json
select :'fx_lst'::jsonb;
\o
select array_agg(x ->> 'id')::text as fx_nxls from jsonb_array_elements(:'fx_lst'::jsonb -> 'listings') x \gset
\o :fixture_dir/unlist_nexamon_cards.json
select public.unlist_nexamon_cards(gen_random_uuid(), :'fx_nxls'::uuid[]);
\o
\o :fixture_dir/bulk_sell_nexamon.json
select public.bulk_sell_nexamon(gen_random_uuid(), array[(:'fx_nb'::jsonb #>> '{1,copy_id}')::uuid]);
\o
-- ADR-196: a fresh pull sold to the game at once
\o :fixture_dir/instant_sell_nexamon.json
select public.instant_sell_nexamon(gen_random_uuid(), array[(:'fx_nb'::jsonb #>> '{2,copy_id}')::uuid]);
\o
reset role;
update public.nexamon_copies set grading_until = public.game_now() - interval '1 second' where id = :'fx_nx2';
select tests.login_as('authenticated', :fx_h) is null as ok \gset
\o :fixture_dir/get_nexamon_market.json
select public.get_nexamon_market(p_set => 'mystic_energy', p_sort => 'price_asc');
\o :fixture_dir/get_nexamon_market_players.json
select public.get_nexamon_market(p_seller => 'players');
\o :fixture_dir/buy_nexamon_listing.json
select public.buy_nexamon_listing(gen_random_uuid(), :'fx_nxl', :fx_nxv);
\o :fixture_dir/get_nexamon_card.json
select public.get_nexamon_card(:'fx_nxk');
\o
reset role;
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/get_nexamon_collection.json
select public.get_nexamon_collection('mystic_energy');
\o :fixture_dir/crack_nexamon_slab.json
select public.crack_nexamon_slab(gen_random_uuid(), :'fx_nx2');
\o
reset role;
-- card bonuses (ADR-171): a prisma so a bonus is active
select public.nexamon_mint_copy('me-071', :fx_g, null, 'mint', 'pack', null, public.game_now()) is not null as ok \gset
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/get_nexamon_bonuses.json
select public.get_nexamon_bonuses();
\o
reset role;
-- Fixture_Heim looks at Fixture_Gmbh's collectibles on their profile
select tests.login_as('authenticated', :fx_h) is null as ok \gset
\o :fixture_dir/get_player_nexamon.json
select public.get_player_nexamon('Fixture_Gmbh');
\o
reset role;

-- mission reset (ADR-166): the first fixture player swaps the open missions
select tests.login_as('authenticated', :p) is null as ok \gset
\o :fixture_dir/reset_missions.json
select public.reset_missions(gen_random_uuid());
\o
-- ADR-202: and skips one of the new ones
\o :fixture_dir/skip_mission.json
select public.skip_mission(gen_random_uuid(),
  (select m.id from public.player_missions m where m.player_id = :p and m.kind = 'quick' and m.status = 'active'
    order by m.draw_seq limit 1));
\o
reset role;

-- Company fixes (5300): a small business upgraded to GmbH with closed hours, a 16-colour banner, a running campaign
-- and a resting business move
\set fx_u '''f1f1f1f1-0000-4000-8000-0000000000a9'''
select tests.signup(:fx_u, 'Fixture_Umbau') is not null as ok \gset
select tests.set_level(:fx_u, 20);
select tests.fund(:fx_u, 90000000, 'fixture:a1:u');
select tests.login_as('authenticated', :fx_u) is null as ok \gset
select public.found_company(gen_random_uuid(), 'Fixture Umbau', 'Aus klein wird groß', 'tech', '#335577', 'small_business') is not null as ok \gset
select public.upgrade_company(gen_random_uuid()) is not null as ok \gset
select public.company_deposit(gen_random_uuid(), 30000000) is not null as ok \gset
reset role;
select company_id as fx_uco from public.player_companies where founder_id = :fx_u \gset
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) - interval '3 hours' where company_id = :'fx_uco';
select public.player_companies_run_due() is not null as ok \gset
select tests.login_as('authenticated', :fx_u) is null as ok \gset
select public.start_campaign(gen_random_uuid(), :'fx_uco', 'flyer') is not null as ok \gset
\o :fixture_dir/set_company_banner_16_colours.json
select public.set_company_banner(gen_random_uuid(), jsonb_build_object(
  'palette', (select jsonb_agg('#' || lpad(to_hex(i * 1000 + 17), 6, '0') order by i) from generate_series(0, 15) i),
  'grid', (select jsonb_agg((select string_agg(substr('0123456789abcdef', ((x + y) % 16) + 1, 1), '' order by x)
                               from generate_series(0, 47) x) order by y) from generate_series(0, 11) y)));
\o :fixture_dir/start_company_move_resting.json
select public.start_company_move(gen_random_uuid(), (public.get_company_moves() #>> '{moves,0,key}'));
\o :fixture_dir/get_my_company_gmbh_upgraded.json
select public.get_my_company();
\o
reset role;

-- Pack Battles and live openings (6300-6330): two friends on the Collectibles tab, a challenge taken back, a battle
-- played to the end, a live pack with a spectator and a reaction
\set fx_pa '''f1f1f1f1-0000-4000-8000-0000000c2a11'''
\set fx_pb '''f1f1f1f1-0000-4000-8000-0000000c2b11'''
select tests.signup(:fx_pa, 'Fixture_PackA') is not null and tests.signup(:fx_pb, 'Fixture_PackB') is not null as ok \gset
select tests.set_level(:fx_pa, 12);
select tests.set_level(:fx_pb, 12);
select tests.fund(:fx_pa, 50000000, 'fixture:b2:a');
select tests.fund(:fx_pb, 50000000, 'fixture:b2:b');
insert into public.friendships (requester_id, addressee_id, status, responded_at) values (:fx_pa, :fx_pb, 'accepted', now());
update public.game_config set value = jsonb_set(value, '{battles,cooldownSeconds}', '0') where key = 'nexamon';
select tests.login_as('authenticated', :fx_pb) is null as ok \gset
select public.nexamon_lobby(true) is not null as ok \gset
select tests.login_as('authenticated', :fx_pa) is null as ok \gset
\o :fixture_dir/challenge_nexamon_battle.json
select public.challenge_nexamon_battle(gen_random_uuid(), 'Fixture_PackB', 'mystic_energy');
\o
select (public.nexamon_lobby(true) #>> '{battles,0,id}')::uuid as fx_pb1 \gset
\o :fixture_dir/cancel_nexamon_battle.json
select public.cancel_nexamon_battle(gen_random_uuid(), :'fx_pb1');
\o
select (public.challenge_nexamon_battle(gen_random_uuid(), 'Fixture_PackB', 'mystic_energy') #>> '{battle,id}')::uuid as fx_pb2 \gset
select tests.login_as('authenticated', :fx_pb) is null as ok \gset
\o :fixture_dir/respond_nexamon_battle.json
select public.respond_nexamon_battle(gen_random_uuid(), :'fx_pb2', true);
\o :fixture_dir/nexamon_lobby.json
select public.nexamon_lobby(true);
\o
reset role;
update public.nexamon_battles
   set accepted_at = accepted_at - interval '30 seconds', starts_at = starts_at - interval '30 seconds',
       decide_at = decide_at - interval '30 seconds', ends_at = ends_at - interval '30 seconds'
 where id = :'fx_pb2';
select tests.login_as('authenticated', :fx_pa) is null as ok \gset
\o :fixture_dir/get_nexamon_battle.json
select public.get_nexamon_battle(:'fx_pb2');
\o
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy') ->> 'pack_id' as fx_ppk \gset
\o :fixture_dir/nexamon_live_progress.json
select public.nexamon_live_progress(:'fx_ppk', 2);
\o
reset role;
select id as fx_pl from public.nexamon_live where pack_id = :'fx_ppk' \gset
select tests.login_as('authenticated', :fx_pb) is null as ok \gset
\o :fixture_dir/get_nexamon_live.json
select public.get_nexamon_live(:'fx_pl');
\o :fixture_dir/nexamon_live_react.json
select public.nexamon_live_react(gen_random_uuid(), :'fx_pl', '🔥');
\o
reset role;

-- Pack Battles with a lineup and seats (8000): an open lobby the friend sees, then joined and played
select tests.login_as('authenticated', :fx_pa) is null as ok \gset
\o :fixture_dir/create_nexamon_pack_battle.json
select public.create_nexamon_pack_battle(gen_random_uuid(), array['mystic_energy', 'super_apex'], 2, array['Fixture_PackB']);
\o
select (public.nexamon_lobby(true) #>> '{battles,0,id}')::uuid as fx_pb3 \gset
select tests.login_as('authenticated', :fx_pb) is null as ok \gset
\o :fixture_dir/nexamon_lobby_open_battle.json
select public.nexamon_lobby(true);
\o :fixture_dir/join_nexamon_pack_battle.json
select public.join_nexamon_pack_battle(gen_random_uuid(), :'fx_pb3');
\o
reset role;
update public.nexamon_battles
   set accepted_at = accepted_at - interval '60 seconds', starts_at = starts_at - interval '60 seconds',
       decide_at = decide_at - interval '60 seconds', ends_at = ends_at - interval '60 seconds'
 where id = :'fx_pb3';
select tests.login_as('authenticated', :fx_pb) is null as ok \gset
\o :fixture_dir/get_nexamon_battle_multi.json
select public.get_nexamon_battle(:'fx_pb3');
\o
reset role;

-- News-Aktionen (ADR-193) --------------------------------------------------------------------------------------------
select company_id as fx_npco from public.player_companies where founder_id = :fx_g and status = 'active' limit 1 \gset
insert into public.player_company_hours (company_id, hour_start, demand_cents, capacity_cents, revenue_cents, cogs_cents,
                                         fixed_cents, marketing_cents, pay_factor_bps, profit_cents)
values (:'fx_npco', date_trunc('hour', public.game_now()) - interval '3 hours', 0, 0, 123400, 0, 0, 0, 10000, 0)
on conflict do nothing;
delete from public.news_promos where ends_at > public.game_now();
insert into public.news_promos (kind, bps, starts_at, ends_at, headline, body)
values ('tax_return', 1000, public.game_now() - interval '1 minute', public.game_now() + interval '14 minutes',
        'Steuererklärung mit Rückzahlung', 'Das NEXA-Finanzamt zahlt zurück.');
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/get_news_promo.json
select public.get_news_promo();
\o :fixture_dir/file_news_tax_return.json
select public.file_news_tax_return(gen_random_uuid());
\o
reset role;
delete from public.news_promos;

-- Fertigkeiten (ADR-194) ---------------------------------------------------------------------------------------------
insert into public.player_skills (player_id, skill_key) values (:fx_g, 'it_data') on conflict do nothing;
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/get_company_skills.json
select public.get_company_skills();
\o :fixture_dir/learn_company_skill.json
select public.learn_company_skill(gen_random_uuid(), 'data_analysis');
\o
reset role;

-- Clone and job perks (ADR-206) --------------------------------------------------------------------------------------
\set fx_cl '''f1f1f1f1-0000-4000-8000-0000000002a1'''
update public.invite_codes set max_uses = max_uses + 1 where code = 'M1-TESTS';
select tests.signup(:fx_cl, 'Fixture_Klon') is not null as ok \gset
select tests.set_level(:fx_cl, 20);
select tests.fund(:fx_cl, 9000000, 'fixture:clone');
select tests.login_as('authenticated', :fx_cl) is null as ok \gset
\o :fixture_dir/get_clone_none.json
select public.get_clone();
\o :fixture_dir/get_clone_created.json
select public.create_clone(gen_random_uuid());
\o
select x ->> 'id' as fx_clpost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where x ->> 'tier' = 'intern' and (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean
 order by x ->> 'id' limit 1 \gset
\o :fixture_dir/apply_for_job_clone.json
select public.clone_apply_for_job(gen_random_uuid(), :'fx_clpost', 1, null);
\o
select public.clone_sign_contract(gen_random_uuid(), (select id from public.job_applications where player_id = :fx_cl and for_clone
                                                       order by created_at desc limit 1), 'M1 1') is not null as ok \gset
\o :fixture_dir/get_clone.json
select public.get_clone();
\o :fixture_dir/get_job_board_clone.json
select public.get_job_board();
\o
reset role;
select tests.login_as('authenticated', :fx_g) is null as ok \gset
\o :fixture_dir/set_job_posting_perks.json
select public.set_job_posting_perks(gen_random_uuid(),
  (public.create_job_posting(gen_random_uuid(), :'fx_npco', 'senior', 'Werkstudium Klone', '[{"branch": "it", "min_score": 0}]',
                             50000, 1) ->> 'id')::uuid, 200, 300);
\o
reset role;
