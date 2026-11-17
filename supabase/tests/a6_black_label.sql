-- =============================================================================
-- a6 · Nexamon: the Black Label, one tier above an ASP 10 (ADR-165, migration 5850)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0e7a6000-0000-4000-8000-0000000000a1'''
\set b '''0e7a6000-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Bl_Anna') is not null and tests.signup(:b, 'Bl_Bruno') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.fund(:a, 2000000000, 'test:a6:a');
select tests.fund(:b, 2000000000, 'test:a6:b');

-- the rules as seeded; the AI stays quiet unless a section wakes it
select value as nx_cfg from public.game_config where key = 'nexamon' \gset
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.set_cfg('nexamon', '{ai,legendaryListChanceBps}', '0');
select tests.set_cfg('nexamon', '{value,pressure,perRun}', '0');
select public.nexamon_sync();

-- =============================================================================
-- A. Rules (port of src/lib/sim/nexamon.ts): mint 5 %, near mint 1 %, out of the chance for a 10, worth 10x
-- =============================================================================
select tests.assert(
  :'nx_cfg'::jsonb #> '{grading,blackLabel}' = '{"chanceBps": {"mint": 500, "near_mint": 100}, "valueBps": 100000}'::jsonb
  and public.nexamon_roll_asp_grade('mint', 0) = 7 and public.nexamon_roll_asp_grade('mint', 0.9499) = 10
  and public.nexamon_roll_asp_grade('mint', 0.95) = 11 and public.nexamon_roll_asp_grade('mint', 0.999999) = 11
  and public.nexamon_roll_asp_grade('near_mint', 0.9899) = 10 and public.nexamon_roll_asp_grade('near_mint', 0.99) = 11
  and public.nexamon_roll_asp_grade('good', 0.999999) = 10 and public.nexamon_roll_asp_grade('poor', 0.999999) = 10,
  'nexamon_roll_asp_grade(): the Black Label (11) sits on the highest rolls of mint and near mint copies only');
select tests.assert(
  (select jsonb_object_agg(g, n order by g)
     from (select public.nexamon_roll_asp_grade('mint', (i + 0.5) / 10000) as g, count(*) as n
             from generate_series(0, 9999) i group by 1) x)
    = '{"7": 500, "8": 1200, "8.5": 1800, "9": 3000, "9.5": 2000, "10": 1000, "11": 500}'::jsonb
  and (select count(*) from generate_series(0, 9999) i, unnest(array['poor', 'good']) c
        where public.nexamon_roll_asp_grade(c, (i + 0.5) / 10000) > 10) = 0
  and (select count(*) from generate_series(0, 9999) i where public.nexamon_roll_asp_grade('near_mint', (i + 0.5) / 10000) = 11) = 100
  and (select count(*) from generate_series(0, 9999) i where public.nexamon_roll_asp_grade('near_mint', (i + 0.5) / 10000) = 10) = 250,
  'exact odds over the 10 000 rolls: mint 5 % Black Label, 10 % 10, 20 % 9.5 …; near mint 1 % Black Label, 2.5 % 10');
select tests.assert(
  public.nexamon_copy_factor_bps('mint', 11) = 100000 and public.nexamon_copy_factor_bps('mint', 10) = 40000
  and public.nexamon_copy_factor_bps('poor', 11) = 100000
  and tests.nx_value('sa-001', 'mint', 11) = 10 * tests.nx_value('sa-001', 'mint')
  and tests.nx_value('sa-001', 'mint', 10) between 2.5 * tests.nx_value('sa-001', 'mint') - 1 and 4 * tests.nx_value('sa-001', 'mint') + 1
  and tests.nx_value('sa-001', 'mint') = public.div_round_half_even((tests.nx('sa-001')).value_e4, 100),
  'nexamon_copy_factor_bps(): a Black Label is worth ten times the card, a plain 10 2.5 to 4 times by popularity (ADR-174)');
-- the configured chances are honoured; never more than the chance for a 10
select tests.set_cfg('nexamon', '{grading,blackLabel,chanceBps}', '{"mint": 20000}');
select public.nexamon_roll_asp_grade('mint', 0.84) as r_nine, public.nexamon_roll_asp_grade('mint', 0.86) as r_all,
       public.nexamon_roll_asp_grade('near_mint', 0.9999) as r_nm \gset
select tests.set_cfg('nexamon', '{grading,blackLabel,valueBps}', '50000');
select public.nexamon_copy_factor_bps('mint', 11) as r_factor \gset
select tests.set_cfg('nexamon', '{grading}', :'nx_cfg'::jsonb -> 'grading');
select tests.assert(
  :r_nine = 9.5 and :r_all = 11 and :r_nm = 10 and :r_factor = 50000,
  'grading.blackLabel: chances per condition and value come from the config; the chance is capped by the chance for a 10');
select tests.throws($$update public.nexamon_copies set grade = 12 where id = (select id from public.nexamon_copies limit 1)$$,
  '23514', 'nexamon_copies.grade: 1 to 11 only');

-- =============================================================================
-- B. Grading with a forced roll: mint copies come back with the Black Label, a near mint copy with a 10
-- =============================================================================
select tests.nx_give(:a, 'sa-001', 'mint') as k1 \gset
select tests.nx_give(:a, 'sa-001', 'mint') as k2 \gset
select tests.nx_give(:a, 'sa-001', 'mint') as k3 \gset
select tests.nx_give(:a, 'sa-001', 'mint') as k4 \gset
select tests.nx_give(:a, 'sa-001', 'near_mint') as n1 \gset
select tests.nx_value('sa-001', 'mint') as v1 \gset
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward) values
  (:a, 'm_nexamon_first_black_label', 'milestone', date '1999-01-03', 1, 3000),
  (:a, 'm_nexamon_first_ten', 'milestone', date '1999-01-03', 1, 1500);
select tests.login_as('authenticated', :a);
select public.grade_nexamon_card(gen_random_uuid(), :'k1') is not null and public.grade_nexamon_card(gen_random_uuid(), :'k2') is not null
   and public.grade_nexamon_card(gen_random_uuid(), :'k3') is not null and public.grade_nexamon_card(gen_random_uuid(), :'k4') is not null
   and public.grade_nexamon_card(gen_random_uuid(), :'n1') is not null as ok \gset
reset role;
-- every roll of a mint or near mint copy is a 10; every 10 of a mint copy is a Black Label
select tests.set_cfg('nexamon', '{grading,gradeWeightsBps,mint}', '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10000]');
select tests.set_cfg('nexamon', '{grading,gradeWeightsBps,near_mint}', '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10000]');
select tests.set_cfg('nexamon', '{grading,blackLabel,chanceBps}', '{"mint": 10000}');
select public.nexamon_finish_gradings(null, public.game_now() + interval '61 minutes') as done \gset
select tests.set_cfg('nexamon', '{grading}', :'nx_cfg'::jsonb -> 'grading');
select tests.assert(
  :done = 5
  and (tests.nx_copy(:'k1')).grade = 11 and (tests.nx_copy(:'k2')).grade = 11 and (tests.nx_copy(:'k3')).grade = 11
  and (tests.nx_copy(:'k4')).grade = 11 and (tests.nx_copy(:'n1')).grade = 10
  and (tests.nx_copy(:'k1')).condition = 'mint' and (tests.nx_copy(:'k1')).grading_until is null,
  'nexamon_finish_gradings(): forced, every mint copy gets the Black Label, the near mint copy only its 10');
select tests.assert(
  -- the grade stays a surprise (5960): every copy is announced as a sealed package, without the grade
  (select count(*) from public.notifications where player_id = :a and type_key = 'nexamon_graded' and title = 'Paket von ASP'
      and body like '%versiegelte Paket%' and body not like '%Note%' and body not like '%Black Label%'
      and not (payload ? 'grade') and not (payload ? 'black_label')) = 5
  and (select count(*) from public.feed_items where actor_id = :a and kind = 'nexamon_black_label') = 0
  and public.feed_item_label('nexamon_black_label', '{"serial": 7}') = 'Black Label von ASP für eine Nexamon-Karte geholt (Nummer 7)'
  and public.feed_item_label('nexamon_pull', '{"serial": 1}') = 'legendäre Nexamon-Karte gezogen (Nummer 1)'
  and position($$'nexamon_black_label'$$ in pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure)) > 0
  and position($$'nexamon_pull'$$ in pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure)) > 0,
  'the ASP notification never names the grade; no Black Label feed item before the owner opens the package (labels stay)');
select tests.assert(
  (select count(*) from public.player_missions where player_id = :a and period_start = date '1999-01-03' and status = 'completed') = 2
  and (select count(*) from public.mission_templates where key = 'm_nexamon_first_black_label' and metric = 'nexamon_black_label'
         and params ->> 'unlock' = 'nexamon' and is_active) = 1,
  'missions: a Black Label counts as a 10 and for the mission of the first Black Label');

-- =============================================================================
-- C. Reading: value x10, the population counts Black Labels on their own, the market filters them
-- =============================================================================
select tests.nx_value('sa-001', 'mint', 11) as bl \gset
select tests.login_as('authenticated', :a);
select public.get_nexamon_card('sa-001') as card \gset
select public.list_nexamon_card(gen_random_uuid(), :'k1', :bl) as l1 \gset
select public.list_nexamon_card(gen_random_uuid(), :'n1', tests.nx_value('sa-001', 'mint', 10)) as l2 \gset
select public.get_nexamon_market(p_card_key => 'sa-001', p_black_label => true) as m_black \gset
select public.get_nexamon_market(p_card_key => 'sa-001', p_graded => true) as m_slabs \gset
select public.get_nexamon_market(p_card_key => 'sa-001', p_graded => true, p_black_label => false) as m_plain \gset
select public.get_nexamon_market(p_card_key => 'sa-001', p_sort => 'price_desc') as m_all \gset
select public.get_nexamon_market(p_card_key => 'sa-001', p_graded => false, p_black_label => true) as m_none \gset
reset role;
select tests.assert(
  :bl = 10 * :v1
  and :'card'::jsonb -> 'graded' = '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]'::jsonb and (:'card'::jsonb ->> 'black_labels')::integer = 4
  and (select count(*) from jsonb_array_elements(:'card'::jsonb -> 'copies') x
        where (x ->> 'grade')::integer = 11 and x ->> 'state' = 'graded' and (x ->> 'value_cents')::bigint = :bl) = 4
  and (:'l1'::jsonb #>> '{listing,grade}')::integer = 11 and (:'l1'::jsonb #>> '{listing,value_cents}')::bigint = :bl,
  'get_nexamon_card(): graded has the twelve grades, black_labels counts the Black Labels; a copy is worth 10x');
select tests.assert(
  (:'m_black'::jsonb ->> 'total')::integer = 1 and :'m_black'::jsonb #>> '{listings,0,copy_id}' = :'k1'
  and (:'m_black'::jsonb #>> '{listings,0,grade}')::integer = 11
  and (:'m_slabs'::jsonb ->> 'total')::integer = 2
  and (:'m_plain'::jsonb ->> 'total')::integer = 1 and :'m_plain'::jsonb #>> '{listings,0,copy_id}' = :'n1'
  and :'m_all'::jsonb #>> '{listings,0,copy_id}' = :'k1'
  and (:'m_none'::jsonb ->> 'total')::integer = 0
  and has_function_privilege('authenticated', 'public.get_nexamon_market(text, text, text, integer, text, text, boolean, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.get_nexamon_market(text, text, text, integer, text, text, boolean, boolean)', 'execute')
  and (select count(*) from pg_proc where proname = 'get_nexamon_market') = 1,
  'get_nexamon_market(): p_black_label filters the Black Labels in or out; one function, for players only');

-- =============================================================================
-- D. Trading: a sale between players at 10x is a sale at the value; the AI buys the slab at its value
-- =============================================================================
select (tests.nx('sa-001')).value_e4 as e4_before \gset
select tests.login_as('authenticated', :b);
select public.buy_nexamon_listing(gen_random_uuid(), (:'l1'::jsonb #>> '{listing,id}')::uuid, :bl) as buy \gset
reset role;
select tests.assert(
  (tests.nx_copy(:'k1')).owner_id = :b and (tests.nx_copy(:'k1')).grade = 11
  and (select count(*) from public.nexamon_sales where copy_id = :'k1' and kind = 'market' and grade = 11 and factor_bps = 100000
         and price_cents = :bl and counted and value_after_e4 = value_before_e4) = 1
  and (tests.nx('sa-001')).value_e4 = :e4_before,
  'a Black Label sold for ten times the value counts as a sale at the value: grade 11 and factor 100 000 on record');
-- AI collectors: above value x (1 + 20 %) never, at the value at once (the premium itself: a7_grades_ai.sql)
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', :'nx_cfg'::jsonb #> '{ai,dailyBudgetPacks}');
select tests.nx_value('sa-001', 'mint', 11) as bl2 \gset
select tests.login_as('authenticated', :a);
select public.list_nexamon_card(gen_random_uuid(), :'k2', :bl2::bigint * 12 / 10 + 1) as l3 \gset
reset role;
select public.nexamon_run_due() as run1 \gset
select tests.nx_listing(:'k2') is not null as kept \gset
select tests.nx_value('sa-001', 'mint', 11) as bl3 \gset
select tests.login_as('authenticated', :a);
select public.unlist_nexamon_card(gen_random_uuid(), (:'l3'::jsonb #>> '{listing,id}')::uuid) is not null as ok \gset
select public.list_nexamon_card(gen_random_uuid(), :'k2', :bl3) is not null as ok \gset
reset role;
select tests.cash(:a) as cash_a \gset
select public.nexamon_run_due() as run3 \gset
select tests.set_cfg('nexamon', '{ai,dailyBudgetPacks}', '0');
select tests.assert(
  :'kept'::boolean
  and (tests.nx_copy(:'k2')).ai_owner is not null and (tests.nx_copy(:'k2')).owner_id is null and (tests.nx_copy(:'k2')).grade = 11
  and (select count(*) from public.nexamon_sales where copy_id = :'k2' and kind = 'ai_buy' and grade = 11 and factor_bps = 100000
         and price_cents = :bl3) = 1
  and tests.cash(:a) = :cash_a::bigint + :bl3::bigint - floor(:bl3::bigint * 0.05),
  'AI collectors leave a Black Label above its value x 1.2 and buy it at once at ten times the card');
-- the AI seller offers its Black Label 10 % above ten times the card
select tests.assert(
  (select l.price_cents from public.nexamon_listings l where l.copy_id = :'k2') is null
  or (select l.price_cents from public.nexamon_listings l where l.copy_id = :'k2')
     = public.nexamon_ai_ask_cents(tests.nx_value('sa-001', 'mint', 11)),
  'an AI seller asks 10 % above the Black Label''s value');
-- no instant sale of a slab
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.sell_nexamon_to_ai(gen_random_uuid(), array[%L]::uuid[])$$, :'k3'),
  'nexamon_not_sellable', 'sell_nexamon_to_ai(): no Black Label slab');
select tests.throws_key(format($$select public.grade_nexamon_card(gen_random_uuid(), %L)$$, :'k3'), 'nexamon_not_raw',
  'grade_nexamon_card(): a Black Label is not graded again');
reset role;

-- =============================================================================
-- E. Cracking a Black Label: the raw mint card comes back, the label is gone
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.crack_nexamon_slab(gen_random_uuid(), :'k3') as cr \gset
select public.get_nexamon_card('sa-001') as card2 \gset
reset role;
select tests.assert(
  (:'cr'::jsonb ->> 'old_grade')::integer = 11 and :'cr'::jsonb #>> '{copy,state}' = 'raw' and :'cr'::jsonb #>> '{copy,grade}' is null
  and :'cr'::jsonb #>> '{copy,condition}' = 'mint'
  and (:'cr'::jsonb #>> '{copy,value_cents}')::bigint = tests.nx_value('sa-001', 'mint')
  and (tests.nx_copy(:'k3')).grade is null and (tests.nx_copy(:'k3')).graded_at is null
  and (:'card2'::jsonb ->> 'black_labels')::integer = 3
  and :'card2'::jsonb -> 'graded' = '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]'::jsonb,
  'crack_nexamon_slab(): a cracked Black Label is a raw mint card again (old_grade 11), worth the card');

-- =============================================================================
-- F. Account reset: the Black Label lives on with the AI sellers; the config goes back
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.reset_account(gen_random_uuid(), 'Bl_Anna') is not null as ok \gset
reset role;
select tests.assert(
  (tests.nx_copy(:'k4')).owner_id is null and (tests.nx_copy(:'k4')).ai_owner is not null and (tests.nx_copy(:'k4')).grade = 11
  and not exists (select 1 from public.nexamon_copies where owner_id = :a)
  and (tests.nx_copy(:'k1')).owner_id = :b and (tests.nx_copy(:'k1')).grade = 11,
  'reset_account(): a Black Label goes to the AI sellers with its label; other players keep theirs');
update public.game_config set value = :'nx_cfg'::jsonb where key = 'nexamon';
select tests.assert(tests.money_invariant() = 'ok', 'ledger invariant holds after the Black Label tests');
