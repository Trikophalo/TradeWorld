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
\o :fixture_dir/counter_offer.json
select public.counter_offer(gen_random_uuid(), :'fx_app2', 9500);
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
update public.player_jobs set last_paid_at = last_paid_at - interval '61 minutes', raise_base_score = raise_base_score - 1
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
\o :fixture_dir/get_my_job_none.json
select public.get_my_job();
\o
reset role;

-- M2b employer side (UI in M4): written to employer/, not yet part of the client contract test
\set boss '''f1f1f1f1-0000-4000-8000-0000000000f2'''
\set fco '''f1f1f1f1-0000-4000-8000-0000000000c1'''
select tests.signup(:boss, 'Fixture_Chefin') is not null as ok \gset
insert into public.companies (id, name, slug, sector_key, legal_form, founder_id, shares_outstanding)
values (:fco, 'Fixture Werkstatt GmbH', 'fixture-werkstatt', 'tech', 'gmbh', :boss, 1000);
insert into public.ledger_accounts (kind, owner_company_id) values ('company_cash', :fco);
select public.ledger_transfer(public.ledger_system_account('households'),
  (select id from public.ledger_accounts where owner_company_id = :fco and kind = 'company_cash'), 50000000, 'transfer',
  'Fixture-Kapital', 'company', :fco, 'fixture:m2b:company') is not null as ok \gset
select tests.login_as('authenticated', :boss) is null as ok \gset
\o :fixture_dir/employer/create_job_posting.json
select public.create_job_posting(gen_random_uuid(), :fco, 'intern', 'Werkstudium Software',
  '[{"branch": "it", "min_score": 1}]', 18000, 2);
\o
select id as fx_post from public.job_postings where company_id = :fco \gset
select tests.login_as('authenticated', :p) is null as ok \gset
select public.apply_for_job(gen_random_uuid(), :'fx_post', 20000, 'Gern im Team.') ->> 'id' as fx_papp \gset
select tests.login_as('authenticated', :boss) is null as ok \gset
\o :fixture_dir/employer/get_company_applications.json
select public.get_company_applications(:fco);
\o :fixture_dir/employer/respond_application.json
select public.respond_application(gen_random_uuid(), :'fx_papp', 'counter', 19000);
\o
select tests.login_as('authenticated', :p) is null as ok \gset
select public.sign_contract(gen_random_uuid(), :'fx_papp', 'M1 1 L9 9') is not null as ok \gset
reset role;
update public.player_jobs set raise_base_score = raise_base_score - 1 where player_id = :p and status = 'active';
select id as fx_pjob from public.player_jobs where company_id = :fco and status = 'active' \gset
select tests.login_as('authenticated', :p) is null as ok \gset
select public.request_raise(gen_random_uuid(), 200) is not null as ok \gset
select tests.login_as('authenticated', :boss) is null as ok \gset
\o :fixture_dir/employer/get_company_team.json
select public.get_company_team(:fco);
\o :fixture_dir/employer/respond_raise.json
select public.respond_raise(gen_random_uuid(), :'fx_pjob', true);
\o :fixture_dir/employer/fire_employee.json
select public.fire_employee(gen_random_uuid(), :'fx_pjob');
\o :fixture_dir/employer/close_job_posting.json
select public.close_job_posting(gen_random_uuid(), :'fx_post');
\o
reset role;
