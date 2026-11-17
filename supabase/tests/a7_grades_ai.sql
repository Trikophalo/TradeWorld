-- =============================================================================
-- a7 · Nexamon: half grades 8.5 and 9.5, a rarer 10, AI collectors at market value (ADR-165, migrations 6000/6010)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0e7a7000-0000-4000-8000-0000000000a1'''
\set b '''0e7a7000-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Hg_Anna') is not null and tests.signup(:b, 'Hg_Bruno') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.fund(:a, 2000000000, 'test:a7:a');
select tests.fund(:b, 2000000000, 'test:a7:b');

-- the rules as seeded; the AI stays quiet unless a section wakes it (no budget = no purchases)
select value as nx_cfg from public.game_config where key = 'nexamon' \gset
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0}');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{ai,legendaryListChanceBps}', '0');
select tests.set_cfg('nexamon', '{value,pressure,perRun}', '0');
select public.nexamon_sync();

create or replace function tests.nx_slab_value(p_card text, p_grade double precision) returns bigint language sql security definer as $$
  select public.nexamon_copy_value_cents((tests.nx(p_card)).value_e4, 'mint', p_grade, p_card) $$;
grant execute on function tests.nx_slab_value(text, double precision) to public;

-- =============================================================================
-- A. Rules: the grade table per condition, exact over the 10 000 rolls, and the value factors
-- =============================================================================
select tests.assert(
  :'nx_cfg'::jsonb #> '{grading,grades}' = '[1, 2, 3, 4, 5, 6, 7, 8, 8.5, 9, 9.5, 10]'::jsonb
  and (:'nx_cfg'::jsonb #>> '{grading,feeBps}')::integer = 4000
  and (select bool_and((select sum(x::integer) from jsonb_array_elements_text(w) x) = 10000 and jsonb_array_length(w) = 12)
         from jsonb_each(:'nx_cfg'::jsonb #> '{grading,gradeWeightsBps}') e(c, w)),
  'grading: twelve grades with 8.5 and 9.5, a full table of twelve per condition, fee 40 %');
select tests.assert(
  (select jsonb_object_agg(c, d)
     from (select c, (select jsonb_object_agg(g, n order by g)
                        from (select public.nexamon_roll_asp_grade(c, (i + 0.5) / 10000) as g, count(*) as n
                                from generate_series(0, 9999) i group by 1) x) as d
             from unnest(array['poor', 'good', 'near_mint', 'mint']) c) y)
  = '{"mint": {"7": 500, "8": 1200, "8.5": 1800, "9": 3000, "9.5": 2000, "10": 1000, "11": 500},
      "near_mint": {"6": 500, "7": 1200, "8": 2200, "8.5": 2400, "9": 2400, "9.5": 950, "10": 250, "11": 100},
      "good": {"4": 750, "5": 1200, "6": 2000, "7": 2500, "8": 1700, "8.5": 1000, "9": 600, "9.5": 200, "10": 50},
      "poor": {"1": 800, "2": 1200, "3": 1500, "4": 2000, "5": 2000, "6": 1500, "7": 700, "8": 200, "8.5": 50, "9": 30,
               "9.5": 15, "10": 5}}'::jsonb,
  'nexamon_roll_asp_grade(): exact odds over the 10 000 rolls per condition, half grades and Black Label included');
select tests.assert(
  public.nexamon_copy_factor_bps('mint', 8) = 12000 and public.nexamon_copy_factor_bps('mint', 8.5) = 14000
  and public.nexamon_copy_factor_bps('mint', 9) = 17000 and public.nexamon_copy_factor_bps('mint', 9.5) = 23000
  and public.nexamon_copy_factor_bps('mint', 10) = 40000 and public.nexamon_copy_factor_bps('mint', 11) = 100000
  and public.nexamon_copy_factor_bps('good', 7) = 9000
  and public.nexamon_grade_text(9.5) = '9,5' and public.nexamon_grade_text(10) = '10' and public.nexamon_grade_text(8.5) = '8,5'
  and public.nexamon_grade_index(9.5) = 10 and public.nexamon_grade_index(11) = 11 and public.nexamon_grade_index(1) = 0,
  'value factors 8 = 1.2, 8.5 = 1.4, 9 = 1.7, 9.5 = 2.3, 10 = 4, Black Label = 10; a half grade reads "9,5"');
select tests.throws($$update public.nexamon_copies set grade = 7.5 where id = (select id from public.nexamon_copies limit 1)$$,
  '23514', 'nexamon_copies.grade: only the grades ASP gives (no 7.5)');

-- =============================================================================
-- B. Half grades stored and valued: forced rolls give a 9.5 and an 8.5
-- =============================================================================
select tests.nx_give(:a, 'sa-021', 'mint') as h1 \gset
select tests.nx_give(:a, 'sa-021', 'good') as h2 \gset
select tests.login_as('authenticated', :a);
select public.grade_nexamon_card(gen_random_uuid(), :'h1') is not null
   and public.grade_nexamon_card(gen_random_uuid(), :'h2') is not null as ok \gset
reset role;
select tests.set_cfg('nexamon', '{grading,gradeWeightsBps,mint}', '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10000, 0]');
select tests.set_cfg('nexamon', '{grading,gradeWeightsBps,good}', '[0, 0, 0, 0, 0, 0, 0, 0, 10000, 0, 0, 0]');
select public.nexamon_finish_gradings(null, public.game_now() + interval '61 minutes') as done \gset
select tests.set_cfg('nexamon', '{grading}', :'nx_cfg'::jsonb -> 'grading');
select tests.login_as('authenticated', :a);
select public.get_nexamon_card('sa-021') as card \gset
reset role;
select tests.assert(
  :done = 2 and (tests.nx_copy(:'h1')).grade = 9.5 and (tests.nx_copy(:'h2')).grade = 8.5
  and (select (x ->> 'grade')::double precision from jsonb_array_elements(:'card'::jsonb -> 'copies') x where x ->> 'id' = :'h1') = 9.5
  and (select (x ->> 'value_cents')::bigint from jsonb_array_elements(:'card'::jsonb -> 'copies') x where x ->> 'id' = :'h1')
      = public.div_round_half_even((tests.nx('sa-021')).value_e4::numeric * public.nexamon_grade_factor_bps(9.5, 'sa-021'), 1000000)
  and :'card'::jsonb -> 'graded' = '[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0]'::jsonb
  and (select count(*) from public.notifications where player_id = :a and type_key = 'nexamon_graded'
         and title = 'Paket von ASP' and not payload ? 'grade') = 2,
  'half grades: stored as 9.5 and 8.5, a 9.5 by popularity (1.8x-2.6x), 8.5 1.4x, counted in their own buckets; the notification keeps the grade secret');

-- =============================================================================
-- C. AI collectors: at or below the value at once (no chance needed), above it up to the condition premium
-- =============================================================================
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', :'nx_cfg'::jsonb #> '{ai,dailyBudgetPacks}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.nx_give(:a, 'sa-022', 'mint') as m1 \gset
select tests.nx_give(:a, 'sa-023', 'poor') as p1 \gset
select tests.nx_give(:a, 'sa-024', 'near_mint') as n1 \gset
select tests.nx_value('sa-022', 'mint') as v22 \gset
select tests.nx_value('sa-023', 'poor') as v23 \gset
select tests.nx_value('sa-024', 'near_mint') as v24 \gset
select tests.nx_slab_value('sa-021', 9.5) as v21 \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'m1', :v22) is not null
   and public.list_nexamon_card(gen_random_uuid(), :'p1', :v23::bigint - 1) is not null
   and public.list_nexamon_card(gen_random_uuid(), :'n1', :v24::bigint * 108 / 100) is not null
   and public.list_nexamon_card(gen_random_uuid(), :'h1', :v21) is not null as ok \gset
reset role;
select tests.cash(:a) as cash_a \gset
select tests.households() as hh \gset
select public.nexamon_run_due() as run1 \gset
select tests.assert(
  (:'run1'::jsonb ->> 'ai_bought')::integer = 3
  and (tests.nx_copy(:'m1')).ai_owner is not null and (tests.nx_copy(:'p1')).ai_owner is not null
  and (tests.nx_copy(:'h1')).ai_owner is not null and (tests.nx_copy(:'h1')).grade = 9.5
  and tests.nx_listing(:'n1') is not null
  and tests.cash(:a) = :cash_a::bigint + (:v22::bigint - floor(:v22::bigint * 0.05)) + (:v23::bigint - 1 - floor((:v23::bigint - 1) * 0.05))
                       + (:v21::bigint - floor(:v21::bigint * 0.05))
  and tests.households() = :hh::bigint - (tests.cash(:a) - :cash_a::bigint),
  'within one minute run the AI buys every listing at or below the value (raw and a 9.5 slab at its full value), '
  'without any chance; above the value only by chance (off here)');
-- the condition premium: near mint up to +8 %, poor nothing, mint up to +12 %
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '10000');
select tests.set_cfg('nexamon', '{ai,buyChanceMinShareBps}', '10000');
select tests.set_cfg('nexamon', '{ai,atMaxChanceBps}', '10000');
select tests.nx_give(:a, 'sa-023', 'poor') as p2 \gset
select tests.nx_give(:a, 'sa-022', 'mint') as m2 \gset
select tests.nx_value('sa-023', 'poor') as v23b \gset
select tests.nx_value('sa-022', 'mint') as v22b \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'p2', :v23b::bigint + 1) is not null
   and public.list_nexamon_card(gen_random_uuid(), :'m2', :v22b::bigint * 112 / 100 + 1) is not null as ok \gset
reset role;
select public.nexamon_run_due() as run2 \gset
select tests.assert(
  (tests.nx_copy(:'n1')).ai_owner is not null
  and tests.nx_listing(:'p2') is not null and tests.nx_listing(:'m2') is not null,
  'the premium: near mint at +8 % sells; poor one cent above the value and mint above +12 % never');
select public.nexamon_ai_buy_chance_bps(10600, 10000, 'mint', null, 'common', 1000000) as ch_mid,
       public.nexamon_ai_buy_chance_bps(11200, 10000, 'mint', null, 'common', 1000000) as ch_max,
       public.nexamon_ai_buy_chance_bps(10001, 10000, 'mint', null, 'common', 1000000) as ch_low \gset
select tests.set_cfg('nexamon', '{ai}', :'nx_cfg'::jsonb -> 'ai');
select public.nexamon_ai_buy_chance_bps(11200, 10000, 'mint', null, 'common', 1000000) as ch_real,
       public.nexamon_ai_buy_chance_bps(10000, 10000, 'poor', null, 'common', 1000000) as ch_value,
       public.nexamon_ai_buy_chance_bps(11500, 10000, 'mint', 10, 'common', 1000000) as ch_ten,
       public.nexamon_ai_buy_chance_bps(11501, 10000, 'mint', 10, 'common', 1000000) as ch_ten_over,
       public.nexamon_ai_buy_chance_bps(12000, 10000, 'mint', 11, 'common', 1000000) as ch_black,
       public.nexamon_ai_premium_bps('good', null) as pr_good, public.nexamon_ai_premium_bps('mint', 8.5) as pr_85 \gset
select tests.assert(
  :ch_low = 10000 and :ch_mid = 10000 and :ch_max = 10000 and :ch_value = 10000
  and :ch_real > 0 and :ch_real < 3000 and :ch_ten > 0 and :ch_ten_over = 0 and :ch_black = 0
  and :pr_good = 300 and :pr_85 = 700,
  'nexamon_ai_buy_chance_bps(): certain at the value, falling above it, 0 above the premium (10 and Black Label: +15 %, ADR-195)');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');

-- =============================================================================
-- D. Anti-manipulation: a dumped listing sells but does not move the value; counted AI buys per card and window
-- =============================================================================
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', :'nx_cfg'::jsonb #> '{ai,dailyBudgetPacks}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.nx_give(:a, 'sa-025', 'mint') as d1 \gset
select (tests.nx('sa-025')).value_e4 as e25 \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'d1', tests.nx_value('sa-025', 'mint') / 2) is not null as ok \gset
reset role;
select public.nexamon_run_due() is not null as ok \gset
select tests.assert(
  (tests.nx_copy(:'d1')).ai_owner is not null and (tests.nx('sa-025')).value_e4 = :e25
  and (select count(*) from public.nexamon_sales where copy_id = :'d1' and kind = 'ai_buy' and not counted) = 1,
  'a listing at half the value is bought, but outside the band it does not move the value');
select tests.set_cfg('nexamon', '{ai,buysPerCardWindow}', '{"common": 1, "rare": 1, "ultra": 1, "prisma": 1, "legendary": 1}');
select tests.nx_give(:a, 'sa-026', 'mint') as w1 \gset
select tests.nx_give(:a, 'sa-026', 'mint') as w2 \gset
select (tests.nx('sa-026')).value_e4 as e26 \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'w1', tests.nx_value('sa-026', 'mint')) is not null as ok \gset
reset role;
select public.nexamon_run_due() is not null as ok \gset
select (tests.nx('sa-026')).value_e4 as e26b \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'w2', tests.nx_value('sa-026', 'mint')) is not null as ok \gset
reset role;
select public.nexamon_run_due() is not null as ok \gset
select tests.assert(
  :e26b::bigint > :e26::bigint and (tests.nx('sa-026')).value_e4 = :e26b::bigint
  and (tests.nx_copy(:'w1')).ai_owner is not null and (tests.nx_copy(:'w2')).ai_owner is not null
  and (select count(*) from public.nexamon_sales where card_key = 'sa-026' and kind = 'ai_buy' and counted) = 1,
  'both copies sell at once, but only buysPerCardWindow AI buys per card and window lift the value');
select tests.set_cfg('nexamon', '{ai}', :'nx_cfg'::jsonb -> 'ai');
-- no budget: a listing above the value waits; at the value it still sells (ADR-195)
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '10000');
select tests.set_cfg('nexamon', '{ai,buyChanceMinShareBps}', '10000');
select tests.set_cfg('nexamon', '{ai,atMaxChanceBps}', '10000');
select tests.nx_give(:a, 'sa-027', 'mint') as nb \gset
select tests.nx_give(:a, 'sa-027', 'mint') as nb2 \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'nb', tests.nx_value('sa-027', 'mint') * 105 / 100) is not null as ok \gset
select public.list_nexamon_card(gen_random_uuid(), :'nb2', tests.nx_value('sa-027', 'mint')) is not null as ok \gset
reset role;
select public.nexamon_run_due() is not null as ok \gset
select tests.assert(tests.nx_listing(:'nb') is not null and tests.nx_listing(:'nb2') is null,
  'the households'' daily budget per set stops buys above the value only; at the value the AI buys (ADR-195)');

update public.game_config set value = :'nx_cfg'::jsonb where key = 'nexamon';
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after half grades and AI collectors');
