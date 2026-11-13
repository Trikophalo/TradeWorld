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
