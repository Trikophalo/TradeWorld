-- =============================================================================
-- 9a · More upgrades: money, XP, a bigger vault (ADR-134)
-- =============================================================================
-- Runs after 99_*.sql. Proves that the new upgrades really change the numbers on the server.
\set QUIET 1
set client_min_messages = notice;

\set x '''09a09a09-0000-4000-8000-0000000000a1'''
\set y '''09a09a09-0000-4000-8000-0000000000a2'''
\set f '''09a09a09-0000-4000-8000-0000000000f1'''
\set w '''09a09a09-0000-4000-8000-0000000000b1'''
\set rv '''09a09a09-0000-4000-8000-000000000101'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:x, 'Xaver_Upgrade') is not null and tests.signup(:y, 'Yara_Basis') is not null
   and tests.signup(:f, 'Frida_Upgrade') is not null and tests.signup(:w, 'Willi_Bonus') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:x, 6);
select tests.set_level(:y, 6);
select tests.set_level(:f, 12);
select tests.set_level(:w, 6);
select tests.fund(:x, 5000000, 'test:9a:x');
select tests.fund(:f, 40000000, 'test:9a:f');

-- sets an upgrade level directly (the purchase itself is tested in B)
create or replace function tests.m9a_set(p_player uuid, p_key text, p_level integer) returns void language sql as $$
  insert into public.player_upgrades (player_id, key, level) values (p_player, p_key, p_level)
  on conflict (player_id, key) do update set level = excluded.level $$;
create or replace function tests.m9a_treasury() returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where system_key = 'treasury' $$;
create or replace function tests.m9a_company_cash(p_company uuid) returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where id = public.company_cash_account(p_company) $$;
grant execute on all functions in schema tests to public;

select public.config_double('progression', '{xpMultiplier}', 2) as mult,
       public.config_double('economy', '{vaultCapHours}', 8) as cap0 \gset

-- =============================================================================
-- A. Rules: every key, defaults = game_config, prices and stages
-- =============================================================================
select tests.assert(
  array_length(public.upgrade_keys(), 1) = 32
  and (select count(*) from jsonb_object_keys(public.player_upgrade_levels(:x))) = 32
  and (select bool_and(public.player_upgrade_levels(:x) ->> k = '0') from unnest(public.upgrade_keys()) k)
  and (select bool_and(public.upgrade_cfg(k) = public.config_jsonb('upgrades', array[k])) from unnest(public.upgrade_keys()) k),
  'upgrade_keys(): 32 keys; player_upgrade_levels() has all of them; the SQL defaults are the generated game_config');
select tests.assert(
  (select array_agg(public.upgrade_stage_level('vault', l) order by l) from generate_series(0, 8) l)
    = array[1, 3, 5, 7, 9, 11, 13, 15, null]
  and (select array_agg(public.upgrade_cost_cents('vault', l) order by l) from generate_series(6, 8) l)
    = array[19200000, 38400000, null]::bigint[]
  and (select array_agg(public.upgrade_stage_level('ambition', l) order by l) from generate_series(0, 3) l) = array[18, 24, 30, null]
  and (select array_agg(public.upgrade_cost_cents('vault_interest', l) order by l) from generate_series(0, 4) l)
    = array[500000, 1250000, 3125000, 7812500, null]::bigint[]
  and (select array_agg(public.upgrade_cost_cents('strategist', l) order by l) from generate_series(0, 3) l)
    = array[2500000, 6250000, 15625000, null]::bigint[],
  'stages and prices: vault up to 8 stages (192.000 / 384.000 EUR at levels 13 / 15), ambition 18 / 24 / 30, '
  || 'vault_interest 5.000 .. 78.125 EUR, strategist 25.000 .. 156.250 EUR');

-- =============================================================================
-- B. Buying a new upgrade: level stages, ledger, all keys in the answer
-- =============================================================================
select tests.cash(:x) as xc0 \gset
select tests.m9a_treasury() as tr0 \gset
select tests.login_as('authenticated', :x);
select public.buy_upgrade(gen_random_uuid(), 'trader') as bt \gset
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'ambition')$$, 'locked',
  'buy_upgrade(): ambition needs level 18');
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'vault_xl')$$, 'locked',
  'buy_upgrade(): vault_xl needs level 14');
reset role;
select tests.assert(
  (:'bt'::jsonb ->> 'level')::int = 1 and (:'bt'::jsonb ->> 'cost_cents')::bigint = 200000
  and (:'bt'::jsonb #>> '{levels,trader}')::int = 1
  and (select count(*) from jsonb_object_keys(:'bt'::jsonb -> 'levels')) = 32
  and tests.cash(:x) = :xc0::bigint - 200000 and tests.m9a_treasury() = :tr0::bigint + 200000,
  'buy_upgrade(trader): 2.000 EUR from the cash to the treasury, the answer lists all 32 keys');

-- =============================================================================
-- C. XP: grant_xp() adds the XP upgrades of the source
-- =============================================================================
select public.grant_xp(:y, 'mission', 50, 'test:9a:y:m') as ym,
       public.grant_xp(:y, 'trade', 10, 'test:9a:y:t') as yt \gset
select tests.m9a_set(:x, 'mission_hunter', 2);
select public.grant_xp(:x, 'mission', 50, 'test:9a:x:m') as xm,
       public.grant_xp(:x, 'trade', 10, 'test:9a:x:t') as xt,
       public.grant_xp(:x, 'work_task', 60, 'test:9a:x:w') as xw \gset
select tests.m9a_set(:x, 'ambition', 1);
select public.grant_xp(:x, 'work_task', 60, 'test:9a:x:w2') as xw2 \gset
select tests.assert(
  :ym::int = round(50 * :mult)::int and :yt::int = round(10 * :mult)::int
  and :xm::int = round(50 * :mult * 1.2)::int and :xm::int > :ym::int
  and :xt::int = round(10 * :mult * 1.1)::int and :xt::int > :yt::int
  and :xw::int = round(60 * :mult)::int and :xw2::int = round(60 * :mult * 1.05)::int
  and public.player_xp_bonus_bps(:x, 'trade') = 1500 and public.player_xp_bonus_bps(:x, 'mission') = 2500
  and public.player_xp_bonus_bps(:x, 'work_task') = 500 and public.player_xp_bonus_bps(:y, 'trade') = 0
  and (select multiplier_bps from public.xp_events where player_id = :x and dedupe_key = 'test:9a:x:m')
      = round(:mult * 12000)::int,
  'grant_xp(): mission_hunter 2 = +20 % mission XP, trader 1 = +10 % trade XP, ambition +5 % on every source; '
  || 'other sources and other players unchanged');

-- =============================================================================
-- D. Vault: vault_xl holds more, vault_interest pays on top of a claim (treasury)
-- =============================================================================
select tests.m9a_set(:x, 'vault_xl', 2);
select tests.m9a_set(:x, 'vault_interest', 2);
update public.vaults set accrual_started_at = public.game_now() - interval '3 hours' where player_id = :x;
select tests.cash(:x) as xc1 \gset
select tests.m9a_treasury() as tr1 \gset
select tests.login_as('authenticated', :x);
select public.claim_vault(:rv) as vc \gset
reset role;
select amount_cents as vbase from public.vault_claims where player_id = :x and request_id = :rv \gset
select tests.assert(
  public.player_vault_cap_hours(:x) = :cap0 + 8
  and (public.vault_status(:x) ->> 'full_at')::timestamptz
      > public.game_now() + make_interval(secs => (:cap0 + 8) * 3600) - interval '1 minute'
  and :vbase::bigint > 0
  and (:'vc'::jsonb ->> 'interest_cents')::bigint = public.apply_bps(:vbase::bigint, 1000)
  and (:'vc'::jsonb ->> 'interest_cents')::bigint > 0
  and (:'vc'::jsonb ->> 'claimed_cents')::bigint = :vbase::bigint + public.apply_bps(:vbase::bigint, 1000)
  and tests.cash(:x) = :xc1::bigint + (:'vc'::jsonb ->> 'claimed_cents')::bigint
  and tests.m9a_treasury() = :tr1::bigint - (:'vc'::jsonb ->> 'claimed_cents')::bigint
  and exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'vault_interest:' || :x || ':' || :rv),
  'vault_xl 2: +8 h vault; vault_interest 2: +10 % on the claim from the treasury (claimed_cents, interest_cents)');

-- =============================================================================
-- E. Daily reward: daily_bonus (cash) and early_bird (XP)
-- =============================================================================
select tests.m9a_set(:x, 'daily_bonus', 2);
select tests.m9a_set(:x, 'early_bird', 1);
select tests.login_as('authenticated', :x);
select public.claim_daily_reward(gen_random_uuid()) as dr \gset
reset role;
select coalesce((public.config_jsonb('dailyRewards', '{cycle}') -> ((:'dr'::jsonb ->> 'day')::int - 1) ->> 'cashCents')::bigint, 0) as dcash,
       coalesce((public.config_jsonb('dailyRewards', '{cycle}') -> ((:'dr'::jsonb ->> 'day')::int - 1) ->> 'xp')::int, 0) as dxp \gset
select tests.assert(
  :dcash::bigint > 0
  and (:'dr'::jsonb ->> 'cash_cents')::bigint = public.apply_bps(:dcash::bigint, 15000)
  and (:'dr'::jsonb ->> 'xp')::int = round(:dxp * :mult * 1.25)::int,
  'claim_daily_reward(): daily_bonus 2 = +50 % cash, early_bird 1 + ambition 1 = +25 % XP');

-- =============================================================================
-- F. Wage: wage_bonus on top (treasury), wage_shield keeps more of a crisis wage
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Frida Fahrrad', 'Lastenräder für alle', 'retail', '#336699', 'garage')
  -> 'company' ->> 'id' as cid \gset
select public.company_deposit(gen_random_uuid(), 20000000) is not null as ok \gset
reset role;
select tests.hire(:f, :w, 20000) as wjob \gset
update public.profiles set last_active_at = now() where id in (:f, :w);
select tests.m4i_work(:'wjob', 60) as p0 \gset
select tests.m9a_set(:w, 'wage_bonus', 3);
select tests.cash(:w) as wc0 \gset
select tests.m4i_work(:'wjob', 60) as p1 \gset
select tests.assert(
  :p0::bigint > 0 and :p1::bigint = :p0::bigint
  and tests.cash(:w) = :wc0::bigint + :p1::bigint + public.apply_bps(:p1::bigint, 1500)
  and exists (select 1 from public.ledger_transactions t where t.idempotency_key like 'salary_bonus:' || :'wjob' || ':%'),
  'accrue_job_salary(): wage_bonus 3 = +15 % of the wage from the treasury, the company pays the same wage');
-- a crisis cuts the wage (ADR-131); the shield keeps 75 % of the cut
insert into public.player_company_events (company_id, archetype, polarity, severity, status, definition, started_at, deadline_at)
values (:'cid', 'strike', 'crisis', 3, 'open', '{"strategies": []}'::jsonb, now(), now() + interval '2 hours');
select public.company_pay_mood_bps(:'cid') as mood \gset
select tests.m9a_set(:w, 'wage_shield', 3);
select tests.m4i_work(:'wjob', 60) as p2 \gset
select tests.assert(
  :mood::int < 10000
  and (select pay_factor_bps from public.player_jobs where id = :'wjob')
      between 10000 - (10000 - :mood::int) * 2500 / 10000 - 1 and 10000 - (10000 - :mood::int) * 2500 / 10000
  and :p2::bigint > :p1::bigint * :mood::int / 10000,
  'accrue_job_salary(): wage_shield 3 = only a quarter of the crisis cut (' || :mood || ' bps -> '
  || (select pay_factor_bps from public.player_jobs where id = :'wjob') || ' bps)');
delete from public.player_company_events where company_id = :'cid';

-- =============================================================================
-- G. Company tasks: task_pay, task_safety, ai_turbo, ai_precision (the founder's upgrades)
-- =============================================================================
delete from public.company_tasks where company_id = :'cid';
insert into public.company_tasks (company_id, task_key, branch, game, value_cents, due_at)
values (:'cid', 'pay_invoices', 'finance', 'sort', 44000, now() + interval '40 minutes'),
       (:'cid', 'coffee_order', 'management', 'count', 44000, now() + interval '40 minutes'),
       (:'cid', 'shift_plan', 'management', 'order', 40000, now() + interval '40 minutes'),
       (:'cid', 'customer_mail', 'sales', 'sort', 40000, now() + interval '40 minutes');
select id as t1 from public.company_tasks where company_id = :'cid' and task_key = 'pay_invoices' \gset
select id as t2 from public.company_tasks where company_id = :'cid' and task_key = 'coffee_order' \gset
select id as t3 from public.company_tasks where company_id = :'cid' and task_key = 'shift_plan' \gset
select id as t4 from public.company_tasks where company_id = :'cid' and task_key = 'customer_mail' \gset
select (public.company_tasks_cfg() ->> 'penaltyBps')::int as pen,
       public.company_task_ai_minutes(:'cid') as aim0 \gset
select public.company_task_resolve(:t1, 10000, false) ->> 'result_cents' as r1,
       public.company_task_resolve(:t2, 0, false) ->> 'result_cents' as r2 \gset
select tests.m9a_set(:f, 'task_pay', 2);
select tests.m9a_set(:f, 'task_safety', 1);
select tests.m9a_set(:f, 'ai_turbo', 2);
select tests.m9a_company_cash(:'cid') as cc0 \gset
select public.company_task_resolve(:t3, 10000, false) ->> 'result_cents' as r3 \gset
select tests.m9a_company_cash(:'cid') as cc1 \gset
select public.company_task_resolve(:t4, 0, false) ->> 'result_cents' as r4 \gset
select tests.assert(
  :r1::bigint = 44000 and :r3::bigint = 48000 and :cc1::bigint = :cc0::bigint + 48000
  and :r2::bigint = -(44000 * :pen / 10000)
  and :r4::bigint = -((40000 * :pen / 10000) - public.apply_bps(40000 * :pen / 10000, 2500))
  and public.company_task_ai_minutes(:'cid')
      = ceil((public.company_tasks_cfg() -> 'ai' ->> 'minutes')::numeric * 7000 / 10000)::int
  and public.company_task_ai_minutes(:'cid') < :aim0::int,
  'company tasks: task_pay 2 = +20 % (40.000 -> 48.000 cents from the households), task_safety 1 = -25 % penalty, '
  || 'ai_turbo 2 = -30 % AI time (' || :aim0 || ' -> ' || public.company_task_ai_minutes(:'cid') || ' min)');

-- =============================================================================
-- H. Business moves, campaigns, crisis steps, own strategies (the founder's upgrades)
-- =============================================================================
select public.company_moves_state(:'cid') as ms0,
       public.company_campaign_costs(:'cid') as cc0,
       public.company_event_unit_cents(:'cid') as eu0,
       public.pitch_chance_bps_for(30, :'cid') as pc0 \gset
select tests.m9a_set(:f, 'move_luck', 3);
select tests.m9a_set(:f, 'dealmaker', 1);
select tests.m9a_set(:f, 'move_tempo', 2);
select tests.m9a_set(:f, 'ad_agency', 3);
select tests.m9a_set(:f, 'crisis_manager', 1);
select tests.m9a_set(:f, 'strategist', 2);
select public.company_moves_state(:'cid') as ms1 \gset
select tests.assert(
  (select bool_and((b ->> 'chance_bps')::int = least(9500, (a ->> 'chance_bps')::int + 900))
     from jsonb_array_elements(:'ms0'::jsonb -> 'moves') a
     join jsonb_array_elements(:'ms1'::jsonb -> 'moves') b on b ->> 'key' = a ->> 'key')
  and (select bool_and((b ->> 'payout_cents')::bigint = public.apply_bps((a ->> 'payout_cents')::bigint, 11000))
     from jsonb_array_elements(:'ms0'::jsonb -> 'moves') a
     join jsonb_array_elements(:'ms1'::jsonb -> 'moves') b on b ->> 'key' = a ->> 'key' where a ->> 'kind' = 'cash')
  and exists (select 1 from jsonb_array_elements(:'ms1'::jsonb -> 'moves') b where b ->> 'kind' = 'cash')
  and public.company_move_rest('{"minutes": 20}'::jsonb, '{"cooldownFactor": 2}'::jsonb, 3000)
      = interval '20 minutes' + interval '28 minutes'
  and public.company_move_rest('{"minutes": 20}'::jsonb, '{"cooldownFactor": 2}'::jsonb, 0) = interval '60 minutes',
  'business moves: move_luck 3 = +9 % chance, dealmaker 1 = +10 % payout of cash moves, '
  || 'move_tempo 2 = 30 % less rest (20 min move: 60 -> 48 min until the next run)');
select tests.assert(
  (public.company_campaign_costs(:'cid') ->> 'flyer')::bigint
    = round(((:'cc0'::jsonb ->> 'flyer')::bigint - public.apply_bps((:'cc0'::jsonb ->> 'flyer')::bigint, 3000))::numeric / 100) * 100
  and (public.company_campaign_costs(:'cid') ->> 'tv')::bigint < (:'cc0'::jsonb ->> 'tv')::bigint
  and public.company_event_unit_cents(:'cid') = :eu0::bigint - public.apply_bps(:eu0::bigint, 1000)
  and public.pitch_chance_bps_for(30, :'cid') = least((public.pitches_cfg() ->> 'maxChanceBps')::int, :pc0::int + 800)
  and :pc0::int = public.pitch_chance_bps(30),
  'ad_agency 3 = -30 % campaign price, crisis_manager 1 = -10 % cost unit of crisis steps, strategist 2 = +8 % '
  || 'chance of own strategies');
-- the move result pays the dealmaker bonus too
insert into public.company_moves (company_id, move_key, started_by, started_at, ends_at, cost_cents, chance_bps)
values (:'cid', 'bulk_purchase', :f, now() - interval '30 minutes', now() - interval '1 minute', 100000, 10000);
select tests.m9a_company_cash(:'cid') as mc0 \gset
select public.company_moves_run_due(now()) is not null as ok \gset
select tests.assert(
  (select payout_cents from public.company_moves where company_id = :'cid' and move_key = 'bulk_purchase')
    = public.apply_bps(round(100000 * (public.company_moves_cfg() #>> '{risk,safe,payoutBps}')::numeric / 10000)::bigint, 11000)
  and tests.m9a_company_cash(:'cid') = :mc0::bigint
      + (select payout_cents from public.company_moves where company_id = :'cid' and move_key = 'bulk_purchase'),
  'company_moves_run_due(): a successful cash move pays +10 % with dealmaker 1 (from the households)');

-- =============================================================================
-- I. Campaigns against companies: activist raises the effect chance of the starter
-- =============================================================================
select c.id as kls from public.companies c where c.ticker = 'KLS' \gset
select tests.m9a_set(:x, 'activist', 3);
insert into public.company_protests (company_id, kind, started_by, created_at, ends_at, goal, ai_supporters)
values (:'kls', 'petition', :y, now(), now() + interval '1 hour', 1, 1) returning id as k1 \gset
insert into public.company_protests (company_id, kind, started_by, created_at, ends_at, goal, ai_supporters)
values (:'kls', 'petition', :x, now(), now() + interval '1 hour', 1, 1) returning id as k2 \gset
-- a roll of 0.1 (1 000 bps): above the base chance, below base + 15 %
select public.protest_check(:k1, 0.1, 0.5) as o1, public.protest_check(:k2, 0.1, 0.5) as o2 \gset
select tests.assert(
  (public.protests_cfg() ->> 'effectChanceBaseBps')::int < 1000 and :'o1' = 'fizzled' and :'o2' = 'hit',
  'protest_check(): activist 3 = +15 % effect chance for campaigns the player started');

-- =============================================================================
-- J. Closed money system
-- =============================================================================
select tests.assert(not exists (select 1 from public.ledger_audit()),
  'ledger audit clean after all upgrade bonuses (treasury and households pay, nothing is minted)');
