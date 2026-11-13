-- =============================================================================
-- 80 · M4i: upgrades (ADR-093) and the career ladder with promotions (ADR-094)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set u '''08008008-0000-4000-8000-0000000000a1'''
\set n '''08008008-0000-4000-8000-0000000000b1'''
\set e '''08008008-0000-4000-8000-0000000000c1'''
\set b '''08008008-0000-4000-8000-0000000000d1'''
\set w '''08008008-0000-4000-8000-0000000000e1'''
\set rq '''08008008-0000-4000-8000-0000000000f1'''
\set rp '''08008008-0000-4000-8000-0000000000f2'''
\set rpe '''08008008-0000-4000-8000-0000000000f3'''
select tests.signup(:u, 'Uwe_Ausbau') is not null and tests.signup(:n, 'Nina_Knapp') is not null
   and tests.signup(:e, 'Emil_Aufstieg') is not null and tests.signup(:b, 'Berta_Chefin') is not null
   and tests.signup(:w, 'Wim_Werkbank') is not null as ok \gset
update public.sim_runtime set is_paused = false;
-- level 11: every vault stage (ADR-100: stage n from level 1 + (n - 1) x 2)
select tests.set_level(:u, 11);
select tests.set_level(:n, 2);
select tests.set_level(:e, 2);
select tests.set_level(:b, 6);
select tests.set_level(:w, 5);
select tests.fund(:u, 25000000, 'test:m4i:u');
select tests.fund(:e, 30000000, 'test:m4i:e');
select tests.fund(:b, 5000000, 'test:m4i:b');

create or replace function tests.m4i_treasury() returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where system_key = 'treasury' $$;
-- buys p_n levels of an upgrade in a row, one result per purchase
create or replace function tests.m4i_buy(p_player uuid, p_key text, p_n integer) returns jsonb language plpgsql as $$
declare
  v_out jsonb := '[]'::jsonb;
begin
  perform tests.login_as('authenticated', p_player);
  for i in 1 .. p_n loop
    v_out := v_out || jsonb_build_array(public.buy_upgrade(gen_random_uuid(), p_key));
  end loop;
  reset role;
  return v_out;
end;
$$;
-- p_minutes of work right now (as if the last payout was p_minutes ago, nothing paid today)
create or replace function tests.m4i_work(p_job uuid, p_minutes integer) returns bigint language plpgsql as $$
begin
  update public.player_jobs set last_paid_at = now() - make_interval(mins => p_minutes),
         paid_day = (now() at time zone 'Europe/Berlin')::date, paid_minutes_today = 0
   where id = p_job;
  return public.accrue_job_salary(p_job, now());
end;
$$;
grant execute on all functions in schema tests to public;

select public.config_double('economy', '{vaultCapHours}', 8) as cap0,
       public.config_bigint('economy', '{basicIncomeCentsPerHour}', 10000) as inc0,
       public.config_double('skills', '{workHoursPerBranchPoint}', 6) as hpp0,
       public.config_double('careers', '{paidHoursPerDayCap}', 12) as paid0 \gset

-- =============================================================================
-- A. Rules (port of upgrades.ts)
-- =============================================================================
select tests.assert(
  (select array_agg(public.upgrade_cost_cents('vault', l) order by l) from generate_series(0, 6) l)
    = array[300000, 600000, 1200000, 2400000, 4800000, 9600000, null]::bigint[]
  and (select array_agg(public.upgrade_cost_cents('income', l) order by l) from generate_series(0, 3) l)
    = array[400000, 1200000, 3600000, null]::bigint[]
  and (select array_agg(public.upgrade_cost_cents('study', l) order by l) from generate_series(0, 3) l)
    = array[800000, 2400000, 7200000, null]::bigint[]
  and (select array_agg(public.upgrade_cost_cents('overtime', l) order by l) from generate_series(0, 2) l)
    = array[2000000, 6000000, null]::bigint[]
  and (select array_agg(public.upgrade_cost_cents('rhetoric', l) order by l) from generate_series(0, 3) l)
    = array[1000000, 2500000, 6250000, null]::bigint[]
  and public.upgrade_cost_cents('jetpack', 0) is null,
  'upgradeCostCents: base x growth^level in whole euros (rhetoric 10.000 / 25.000 / 62.500 EUR), null when maxed');
select tests.assert(
  public.player_upgrade_levels(:u) = '{"vault": 0, "income": 0, "study": 0, "overtime": 0, "rhetoric": 0, "mentor": 0, "artist": 0, "efficiency": 0, "makler": 0, "crypto_wallet": 0}'::jsonb
  and public.player_vault_cap_hours(:u) = :cap0 and public.player_basic_income_cents_per_hour(:u) = :inc0
  and public.player_work_hours_per_branch_point(:u) = :hpp0 and public.player_paid_hours_cap(:u) = :paid0
  and public.player_promotion_bonus_bps(:u) = 0,
  'upgradeEffects at level 0: the base values of economy, skills and careers');

-- =============================================================================
-- B. get_upgrades / buy_upgrade: arguments, level lock, cash
-- =============================================================================
select tests.login_as('authenticated', :u);
select public.get_upgrades() as g0 \gset
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'jetpack')$$, 'invalid_argument',
  'buy_upgrade(): unknown key');
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), null)$$, 'invalid_argument', 'buy_upgrade(): key required');
select tests.throws_key($$select public.buy_upgrade(null, 'vault')$$, 'invalid_argument', 'buy_upgrade(): request_id required');
reset role;
select tests.assert(:'g0'::jsonb = '{"levels": {"vault": 0, "income": 0, "study": 0, "overtime": 0, "rhetoric": 0, "mentor": 0, "artist": 0, "efficiency": 0, "makler": 0, "crypto_wallet": 0}}'::jsonb,
  'get_upgrades(): all ten keys (ADR-100) with level 0');

-- Nina: level 2, 2.999 EUR
select public.ledger_transfer(public.ledger_player_account(:n, 'player_cash'), public.ledger_system_account('households'),
  tests.cash(:n), 'transfer', 'Test-Leerung', 'player', :n, 'test:m4i:drain') is not null as ok \gset
select tests.fund(:n, 299900, 'test:m4i:n');
select tests.login_as('authenticated', :n);
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'income')$$, 'locked',
  'buy_upgrade(): income needs level 3 (minLevel)');
select tests.throws($$select public.buy_upgrade(gen_random_uuid(), 'rhetoric')$$, 'NX018',
  'buy_upgrade(): the level lock comes before the price (rhetoric from level 5, 10.000 EUR) -> locked NX018');
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'vault')$$, 'insufficient_funds',
  'buy_upgrade(): 2.999 EUR are not enough for 3.000 EUR');
reset role;
insert into public.player_upgrades (player_id, key, level) values (:n, 'vault', 6);
select tests.login_as('authenticated', :n);
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'vault')$$, 'upgrade_maxed',
  'buy_upgrade(): maxed comes first (before level and cash)');
reset role;
delete from public.player_upgrades where player_id = :n;
select tests.assert(
  tests.cash(:n) = 299900 and not exists (select 1 from public.player_upgrades where player_id = :n)
  and not exists (select 1 from public.ledger_transactions where initiated_by = :n and kind = 'upgrade_purchase'),
  'buy_upgrade(): refused purchases book nothing');

-- =============================================================================
-- C. Uwe buys the vault up to the top: prices, ledger, treasury
-- =============================================================================
-- a vault that has stood full for 30 hours
update public.vaults set accrual_started_at = public.game_now() - interval '30 hours' where player_id = :u;
select tests.cash(:u) as uc0 \gset
select tests.m4i_treasury() as tr0 \gset
select tests.m4i_buy(:u, 'vault', 6) as vb \gset
select tests.assert(
  (select array_agg((x ->> 'level')::int order by i) from jsonb_array_elements(:'vb'::jsonb) with ordinality t(x, i)) = array[1, 2, 3, 4, 5, 6]
  and (select array_agg((x ->> 'cost_cents')::bigint order by i) from jsonb_array_elements(:'vb'::jsonb) with ordinality t(x, i))
      = array[300000, 600000, 1200000, 2400000, 4800000, 9600000]::bigint[]
  and (select bool_and(x ->> 'key' = 'vault') from jsonb_array_elements(:'vb'::jsonb) x)
  and :'vb'::jsonb -> 5 -> 'levels' = '{"vault": 6, "income": 0, "study": 0, "overtime": 0, "rhetoric": 0, "mentor": 0, "artist": 0, "efficiency": 0, "makler": 0, "crypto_wallet": 0}'::jsonb
  and tests.cash(:u) = :uc0::bigint - 18900000 and tests.m4i_treasury() = :tr0::bigint + 18900000,
  'buy_upgrade(): six vault levels for 3.000 to 96.000 EUR (189.000 EUR), {key, level, cost_cents, levels}; paid to the treasury');
select tests.assert(
  (select count(*) from public.ledger_transactions t where t.initiated_by = :u and t.kind = 'upgrade_purchase'
      and t.ref_type = 'upgrade' and t.idempotency_key like 'upgrade:' || :u || ':vault:%') = 6
  and not exists (select 1 from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
                   where t.initiated_by = :u and t.kind = 'upgrade_purchase' group by t.id
                  having sum(e.amount_cents) <> 0 or count(*) <> 2
                      or coalesce(sum(e.amount_cents) filter (where e.account_id = public.ledger_system_account('treasury')), 0) <= 0
                      or coalesce(sum(e.amount_cents) filter (where e.account_id = public.ledger_player_account(:u, 'player_cash')), 0)
                         <> -sum(e.amount_cents) filter (where e.account_id = public.ledger_system_account('treasury')))
  and not exists (select 1 from public.ledger_audit()),
  'buy_upgrade(): every purchase is one balanced transfer player_cash -> treasury (kind upgrade_purchase); ledger audit clean');
select tests.login_as('authenticated', :u);
select tests.throws($$select public.buy_upgrade(gen_random_uuid(), 'vault')$$, 'NX083',
  'buy_upgrade(): a seventh vault level -> upgrade_maxed NX083');
-- idempotent per request_id
select public.buy_upgrade(:rq, 'income') as ib1 \gset
select public.buy_upgrade(:rq, 'income') as ib2 \gset
select public.get_upgrades() as g1 \gset
reset role;
select tests.assert(
  :'ib1'::jsonb = :'ib2'::jsonb and (:'ib1'::jsonb ->> 'level')::int = 1 and (:'ib1'::jsonb ->> 'cost_cents')::bigint = 400000
  and tests.cash(:u) = :uc0::bigint - 18900000 - 400000
  and :'g1'::jsonb = '{"levels": {"vault": 6, "income": 1, "study": 0, "overtime": 0, "rhetoric": 0, "mentor": 0, "artist": 0, "efficiency": 0, "makler": 0, "crypto_wallet": 0}}'::jsonb
  and (select count(*) from public.ledger_transactions where initiated_by = :u and kind = 'upgrade_purchase') = 7,
  'buy_upgrade(): the same request_id twice answers the same and charges once; get_upgrades() shows the levels');

-- =============================================================================
-- D. Vault and basic income with the upgrades
-- =============================================================================
select tests.login_as('authenticated', :u);
select public.get_my_portfolio() -> 'vault' as uv \gset
reset role;
select tests.assert(
  (:'uv'::jsonb ->> 'rate_cents_per_hour')::bigint
     = round(:inc0::numeric * 11000 / 10000)::bigint * (:'uv'::jsonb ->> 'factor_bps')::int / 10000
  and (:'uv'::jsonb ->> 'cap_cents')::bigint = round((:'uv'::jsonb ->> 'rate_cents_per_hour')::bigint * (:cap0 + 12))
  and (:'uv'::jsonb ->> 'full_at')::timestamptz
      = (select v.accrual_started_at + make_interval(secs => (:cap0 + 12) * 3600) from public.vaults v where v.player_id = :u)
  and public.player_basic_income_cents_per_hour(:u) = round(:inc0::numeric * 1.1)::bigint
  and public.player_vault_cap_hours(:u) = :cap0 + 12,
  'portfolio vault: rate = basic income +10 % (income 1) x treasury factor, cap = rate x (8 + 6 x 2) hours, full_at');
select tests.assert(
  ((public.vault_status(:u)) ->> 'accrued_seconds')::bigint between (:cap0 * 3600)::bigint and (:cap0 * 3600)::bigint + 300,
  'buy_upgrade(vault) on a full vault: it keeps what it held (8 h) and fills on from there, the full hours earn nothing');
select tests.login_as('authenticated', :u);
select public.claim_vault(gen_random_uuid()) as uc \gset
reset role;
select tests.assert(
  (:'uc'::jsonb ->> 'full_at')::timestamptz between public.game_now() + make_interval(secs => (:cap0 + 12) * 3600) - interval '5 minutes'
                                                and public.game_now() + make_interval(secs => (:cap0 + 12) * 3600),
  'claim_vault(): full_at = now + 20 hours with the biggest vault');

-- =============================================================================
-- E. Emil, intern at an AI company: promotion state, study, overtime, hours in the rank
-- =============================================================================
select tests.login_as('authenticated', :e);
select x ->> 'id' as epost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where x ->> 'tier' = 'intern' and (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean
 order by x ->> 'id' limit 1 \gset
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'epost', 15000, null) ->> 'id')::uuid,
                            'M1 1 L4 4') is not null as ok \gset
reset role;
select j.id as ejob, j.salary_cents_per_hour as ewage, c.name as ename
  from public.player_jobs j join public.companies c on c.id = j.company_id where j.player_id = :e and j.status = 'active' \gset
-- main branch IT for the assertions (an AI intern posting of the IT branch)
update public.player_jobs set required = '[{"branch": "it", "min_score": 0}]', title_key = 'it_intern', title = 'it_intern'
 where id = :'ejob';
select greatest(round(:ewage * 1.15), 30000)::bigint as enext \gset
select tests.login_as('authenticated', :e);
select public.get_my_job() -> 'job' as j0 \gset
select tests.throws($$select public.request_promotion(gen_random_uuid())$$, 'NX084',
  'request_promotion(): requirements not met -> promotion_not_ready NX084');
reset role;
select tests.assert(
  (:'j0'::jsonb ->> 'rank_hours')::numeric = 0 and (:'j0'::jsonb ->> 'tier') = 'intern'
  and :'j0'::jsonb -> 'promotion' = jsonb_build_object(
    'next_tier', 'junior', 'main_branch', 'it',
    'requirements', '[{"key": "level", "branch": null, "need": 5, "have": 2, "met": false},
                      {"key": "branch", "branch": "it", "need": 2, "have": 0, "met": false},
                      {"key": "hours", "branch": null, "need": 12, "have": 0, "met": false}]'::jsonb,
    'ready', false, 'boss', 'ai', 'chance_bps', 0, 'retry_at', null, 'pending_since', null,
    'next_salary_cents_per_hour', :enext),
  'get_my_job(): a fresh intern sees rank_hours 0 and promotion {next_tier junior, level 5, IT score 2, 12 hours, AI boss, '
  || 'chance 0, wage max(+15 %, 300 EUR)}');
select tests.login_as('authenticated', :u);
select tests.throws_key($$select public.request_promotion(gen_random_uuid())$$, 'no_active_job',
  'request_promotion(): without a job -> no_active_job');
reset role;

-- study: one work hour less per branch point
insert into public.player_skill_points (player_id) values (:e) on conflict (player_id) do nothing;
update public.player_skill_points set branch_work_minutes = '{}', branch_points = '{}' where player_id = :e;
select tests.login_as('authenticated', :e);
select public.buy_upgrade(gen_random_uuid(), 'study') ->> 'cost_cents' as sc \gset
select public.get_my_skills() as esk \gset
reset role;
select tests.m4i_work(:'ejob', 300) >= 0 as ok \gset
select tests.assert(
  :sc::bigint = 800000 and public.player_work_hours_per_branch_point(:e) = greatest(3, :hpp0 - 1)
  and (:'esk'::jsonb ->> 'work_hours_per_branch_point')::numeric = greatest(3, :hpp0 - 1)
  and (select (branch_points ->> 'it')::int = 1 and (branch_work_minutes ->> 'it')::int = 300
         from public.player_skill_points where player_id = :e)
  and (select rank_minutes = 300 and experience_minutes = 300 from public.player_jobs where id = :'ejob'),
  'study 1 (8.000 EUR): 5 work hours give an IT branch point (6 without); get_my_skills() shows the hours; rank_minutes counts the paid minutes');

-- overtime: one more paid hour a day (needs level 5)
select tests.set_level(:e, 5);
update public.player_jobs set paid_day = (now() at time zone 'Europe/Berlin')::date, paid_minutes_today = :paid0::int * 60,
       last_paid_at = now() - interval '2 hours'
 where id = :'ejob';
select public.job_payable_minutes(:'ejob', now()) as pm0 \gset
select tests.login_as('authenticated', :e);
select public.get_my_job() -> 'job' ->> 'paid_hours_cap' as pc0 \gset
select public.buy_upgrade(gen_random_uuid(), 'overtime') ->> 'level' as ol \gset
select public.get_my_job() -> 'job' ->> 'paid_hours_cap' as pc1 \gset
reset role;
select public.job_payable_minutes(:'ejob', now()) as pm1 \gset
select public.accrue_job_salary(:'ejob', now()) >= 0 as ok \gset
select tests.assert(
  :pm0::int = 0 and :pc0::numeric = :paid0 and :ol::int = 1 and :pc1::numeric = :paid0 + 1 and :pm1::int = 60
  and (select paid_minutes_today = (:paid0::int + 1) * 60 and rank_minutes = 360 from public.player_jobs where id = :'ejob'),
  format('overtime 1: paid_hours_cap %s -> %s; after the cap one more hour is paid (job_payable_minutes, accrue_job_salary)',
         :paid0, :paid0::int + 1));

-- ready: level 5, IT score 3 (basics 1 + programming 2), 12 hours in the rank
insert into public.player_skills (player_id, skill_key) values (:e, 'it_basics'), (:e, 'it_programming') on conflict do nothing;
select tests.m4i_work(:'ejob', 360) >= 0 as ok \gset
select tests.login_as('authenticated', :e);
select public.get_my_job() -> 'job' as j1 \gset
select public.buy_upgrade(gen_random_uuid(), 'rhetoric') ->> 'cost_cents' as rc \gset
select public.get_my_job() -> 'job' -> 'promotion' as p2 \gset
reset role;
select tests.assert(
  (:'j1'::jsonb ->> 'rank_hours')::numeric = 12.0
  and (:'j1'::jsonb -> 'promotion' ->> 'ready')::boolean
  and (select bool_and((r ->> 'met')::boolean) from jsonb_array_elements(:'j1'::jsonb -> 'promotion' -> 'requirements') r)
  and :'j1'::jsonb -> 'promotion' -> 'requirements' -> 1 = '{"key": "branch", "branch": "it", "need": 2, "have": 3, "met": true}'::jsonb
  and :'j1'::jsonb -> 'promotion' -> 'requirements' -> 2 = '{"key": "hours", "branch": null, "need": 12, "have": 12, "met": true}'::jsonb
  and (:'j1'::jsonb -> 'promotion' ->> 'chance_bps')::int = 4800,
  'promotion ready: chance 40 % + 8 % for the one IT point above the requirement = 4800 bps');
select tests.assert(:rc::bigint = 1000000 and (:'p2'::jsonb ->> 'chance_bps')::int = 5300,
  'rhetoric 1 (10.000 EUR): +5 % chance with AI bosses (5300 bps)');

-- the AI boss says no (chance forced to 0): retry after 24 hours
select value -> 'promotion' as promo0 from public.game_config where key = 'careers' \gset
select tests.set_cfg('careers', '{promotion,maxChanceBps}', '0');
select tests.login_as('authenticated', :e);
select public.request_promotion(:rp) as d1 \gset
select public.request_promotion(:rp) as d1b \gset
select tests.throws($$select public.request_promotion(gen_random_uuid())$$, 'NX085',
  'request_promotion(): during the wait after a no -> promotion_too_soon NX085');
select public.get_my_job() -> 'job' -> 'promotion' as p3 \gset
reset role;
select tests.assert(
  :'d1'::jsonb ->> 'status' = 'declined' and :'d1'::jsonb ->> 'tier' = 'intern'
  and (:'d1'::jsonb ->> 'salary_cents_per_hour')::bigint = :ewage::bigint and (:'d1'::jsonb ->> 'chance_bps')::int = 0
  and (:'d1'::jsonb ->> 'retry_at')::timestamptz between now() + interval '23 hours 55 minutes' and now() + interval '24 hours'
  and :'d1'::jsonb = :'d1b'::jsonb
  and (select tier = 'intern' and rank_minutes = 720 and promotion_retry_at = (:'d1'::jsonb ->> 'retry_at')::timestamptz
         from public.player_jobs where id = :'ejob')
  and (:'p3'::jsonb ->> 'retry_at')::timestamptz = (:'d1'::jsonb ->> 'retry_at')::timestamptz,
  'request_promotion() at an AI boss, no: {status declined, tier, salary, retry_at = now + 24 h, chance_bps}; idempotent; '
  || 'job unchanged, promotion.retry_at');

-- the AI boss says yes (chance forced to 100 %)
update public.player_jobs set promotion_retry_at = now() - interval '1 second' where id = :'ejob';
select tests.set_cfg('careers', '{promotion,maxChanceBps}', '10000');
select tests.set_cfg('careers', '{promotion,baseChanceBps}', '10000');
select tests.login_as('authenticated', :e);
select public.request_promotion(:rpe) as y1 \gset
select public.request_promotion(:rpe) as y1b \gset
select public.get_my_job() -> 'job' as j2 \gset
reset role;
select tests.set_cfg('careers', '{promotion}', :'promo0'::jsonb);
select tests.assert(
  :'y1'::jsonb = jsonb_build_object('status', 'promoted', 'tier', 'junior', 'salary_cents_per_hour', :enext,
                                    'retry_at', null, 'chance_bps', 10000)
  and :'y1'::jsonb = :'y1b'::jsonb,
  'request_promotion() at an AI boss, yes: {status promoted, tier junior, salary max(+15 %, 300 EUR), retry_at null, chance_bps}');
select tests.assert(
  (select tier = 'junior' and salary_cents_per_hour = :enext and rank_minutes = 0 and promoted_at is not null
          and promotion_retry_at is null and pending_promotion_at is null
          and title_key = 'it_junior' and title = 'it_junior' and required = '[{"branch": "it", "min_score": 2}]'::jsonb
          and raise_base_score = 3 and ceiling_cents_per_hour = public.ai_salary_ceiling(30000, 3)
     from public.player_jobs where id = :'ejob'),
  'promotion at an AI company: rank junior, new wage, hours 0, raise baseline = match score, title and requirements of the '
  || 'AI posting it_junior');
select tests.assert(
  :'j2'::jsonb ->> 'tier' = 'junior' and (:'j2'::jsonb ->> 'rank_hours')::numeric = 0
  and :'j2'::jsonb -> 'promotion' ->> 'next_tier' = 'senior'
  and :'j2'::jsonb -> 'promotion' -> 'requirements' -> 0 = '{"key": "level", "branch": null, "need": 12, "have": 5, "met": false}'::jsonb
  and :'j2'::jsonb -> 'promotion' -> 'requirements' -> 1 ->> 'need' = '6'
  and :'j2'::jsonb -> 'promotion' -> 'requirements' -> 2 ->> 'need' = '36'
  and not (:'j2'::jsonb -> 'promotion' ->> 'ready')::boolean,
  'after the promotion: next rank senior (level 12, IT 6, 36 hours), not ready');
select tests.assert(
  exists (select 1 from public.feed_items f where f.actor_id = :e and f.kind = 'promoted'
             and f.payload = jsonb_build_object('tier', 'junior', 'company', :'ename'))
  and exists (select 1 from public.notifications x where x.player_id = :e and x.type_key = 'promotion_result'
                 and x.title = 'Befördert!' and x.link = '/job' and x.payload ->> 'tier' = 'junior'
                 and x.body like 'Beförderung zum Junior bei %'),
  'promotion: feed item promoted {tier, company}, notification promotion_result "Befördert!" with link /job');

-- management from team lead on (not for management jobs), nothing above C-level
update public.player_jobs set tier = 'senior' where id = :'ejob';
select public.promotion_state(:'ejob') as ps_s \gset
update public.player_jobs set required = '[{"branch": "management", "min_score": 6}]' where id = :'ejob';
select public.promotion_state(:'ejob') as ps_m \gset
update public.player_jobs set tier = 'c_level', required = '[{"branch": "it", "min_score": 20}]' where id = :'ejob';
select public.promotion_state(:'ejob') as ps_c \gset
select tests.login_as('authenticated', :e);
select tests.throws_key($$select public.request_promotion(gen_random_uuid())$$, 'promotion_not_ready',
  'request_promotion(): at C-level there is no next rank -> promotion_not_ready');
reset role;
update public.player_jobs set tier = 'junior', required = '[{"branch": "it", "min_score": 2}]' where id = :'ejob';
select tests.assert(
  (select array_agg(r ->> 'key' order by i) from jsonb_array_elements(:'ps_s'::jsonb -> 'requirements') with ordinality t(r, i))
    = array['level', 'branch', 'management', 'hours']
  and :'ps_s'::jsonb -> 'requirements' -> 2 = '{"key": "management", "branch": "management", "need": 6, "have": 0, "met": false}'::jsonb
  and :'ps_s'::jsonb -> 'requirements' -> 1 ->> 'need' = '12' and :'ps_s'::jsonb -> 'requirements' -> 3 ->> 'need' = '72'
  and (select array_agg(r ->> 'key' order by i) from jsonb_array_elements(:'ps_m'::jsonb -> 'requirements') with ordinality t(r, i))
    = array['level', 'branch', 'hours']
  and :'ps_m'::jsonb ->> 'main_branch' = 'management'
  and :'ps_c'::jsonb ->> 'next_tier' is null and :'ps_c'::jsonb -> 'requirements' = '[]'::jsonb
  and not (:'ps_c'::jsonb ->> 'ready')::boolean and :'ps_c'::jsonb ->> 'next_salary_cents_per_hour' is null
  and (:'ps_c'::jsonb ->> 'chance_bps')::int = 0,
  'requirements: team lead needs half the score in management (not for management jobs); C-level has no next rank');

-- =============================================================================
-- F. Berta's company: request, pending, expiry, no, promotion by the boss
-- =============================================================================
create or replace function tests.m4i_hire(p_founder uuid, p_worker uuid, p_wage bigint) returns uuid language plpgsql as $$
declare
  v_co   uuid := tests.company_of(p_founder);
  v_post uuid;
  v_app  uuid;
begin
  perform tests.login_as('authenticated', p_founder);
  v_post := (public.create_job_posting(gen_random_uuid(), v_co, 'intern', 'Werkstudium', '[{"branch": "it", "min_score": 0}]',
                                       p_wage, 1) ->> 'id')::uuid;
  perform tests.login_as('authenticated', p_worker);
  v_app := (public.apply_for_job(gen_random_uuid(), v_post, p_wage, null) ->> 'id')::uuid;
  perform tests.login_as('authenticated', p_founder);
  perform public.respond_application(gen_random_uuid(), v_app, 'accept', null);
  perform tests.login_as('authenticated', p_worker);
  perform public.sign_contract(gen_random_uuid(), v_app, 'M1 1');
  reset role;
  return (select id from public.player_jobs where player_id = p_worker and status = 'active');
end;
$$;
grant execute on all functions in schema tests to public;
select tests.login_as('authenticated', :b);
select public.found_company(gen_random_uuid(), 'Berta Bytes', 'Software für Bäckereien', 'tech', '#336699', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:b) as bco \gset
select tests.m4i_hire(:b, :w, 20000) as wjob \gset
insert into public.player_skills (player_id, skill_key) values (:w, 'it_basics'), (:w, 'it_programming') on conflict do nothing;
update public.player_jobs set rank_minutes = 720 where id = :'wjob';

select tests.login_as('authenticated', :b);
select public.get_company_team(:'bco') -> 'members' -> 0 as m0 \gset
reset role;
select tests.login_as('authenticated', :w);
select public.get_my_job() -> 'job' -> 'promotion' as wp0 \gset
select public.request_promotion(gen_random_uuid()) as wr1 \gset
select tests.throws($$select public.request_promotion(gen_random_uuid())$$, 'NX086',
  'request_promotion(): a request is waiting for the boss -> promotion_pending NX086');
select public.get_my_job() -> 'job' -> 'promotion' as wp1 \gset
reset role;
select tests.assert(
  :'m0'::jsonb ->> 'tier' = 'intern' and (:'m0'::jsonb ->> 'rank_hours')::numeric = 12.0
  and :'m0'::jsonb -> 'promotion' = jsonb_build_object(
    'next_tier', 'junior',
    'requirements', '[{"key": "level", "branch": null, "need": 5, "have": 5, "met": true},
                      {"key": "branch", "branch": "it", "need": 2, "have": 3, "met": true},
                      {"key": "hours", "branch": null, "need": 12, "have": 12, "met": true}]'::jsonb,
    'ready', true, 'pending_since', null, 'next_salary_cents_per_hour', 30000),
  'get_company_team(): tier, rank_hours and promotion {next_tier, requirements, ready, pending_since, next_salary_cents_per_hour}');
select tests.assert(
  :'wp0'::jsonb ->> 'boss' = 'player' and :'wp0'::jsonb -> 'chance_bps' = 'null'::jsonb and (:'wp0'::jsonb ->> 'ready')::boolean
  and :'wr1'::jsonb = '{"status": "pending", "tier": "intern", "salary_cents_per_hour": 20000, "retry_at": null, "chance_bps": null}'::jsonb
  and (:'wp1'::jsonb ->> 'pending_since')::timestamptz = (select pending_promotion_at from public.player_jobs where id = :'wjob')
  and exists (select 1 from public.notifications x where x.player_id = :b and x.type_key = 'promotion_request'
                 and x.title = 'Wim_Werkbank bittet um Beförderung zum Junior' and x.link = '/company'
                 and x.payload ->> 'player_job_id' = :'wjob' and (x.payload ->> 'min_salary_cents_per_hour')::bigint = 30000),
  'request_promotion() at a player company: {status pending, chance_bps null}; pending_since; the boss gets promotion_request');

-- only the boss decides; an old request expires after requestValidHours (72)
select tests.login_as('authenticated', :e);
select tests.throws_key(format($$select public.decline_promotion(gen_random_uuid(), %L, %L)$$, :'bco', :'wjob'), 'employer_only',
  'decline_promotion(): only founder or CEO');
select tests.throws_key(format($$select public.promote_employee(gen_random_uuid(), %L, %L, null)$$, :'bco', :'wjob'), 'employer_only',
  'promote_employee(): only founder or CEO');
reset role;
update public.player_jobs set pending_promotion_at = now() - interval '73 hours' where id = :'wjob';
select tests.login_as('authenticated', :b);
select coalesce(public.get_company_team(:'bco') -> 'members' -> 0 -> 'promotion' ->> 'pending_since', 'none') as mexp \gset
select tests.throws_key(format($$select public.decline_promotion(gen_random_uuid(), %L, %L)$$, :'bco', :'wjob'), 'invalid_argument',
  'decline_promotion(): an expired request cannot be declined');
reset role;
select tests.login_as('authenticated', :w);
select public.request_promotion(gen_random_uuid()) ->> 'status' as wr2 \gset
reset role;
select tests.assert(:'mexp' = 'none' and :'wr2' = 'pending',
  'a request older than 72 hours counts as gone: pending_since null, the employee may ask again');

select tests.login_as('authenticated', :b);
select public.decline_promotion(gen_random_uuid(), :'bco', :'wjob') as dc \gset
select tests.throws_key(format($$select public.decline_promotion(gen_random_uuid(), %L, %L)$$, :'bco', :'wjob'), 'invalid_argument',
  'decline_promotion(): nothing waiting -> invalid_argument');
reset role;
select tests.login_as('authenticated', :w);
select tests.throws_key($$select public.request_promotion(gen_random_uuid())$$, 'promotion_too_soon',
  'request_promotion(): after the boss said no -> promotion_too_soon');
reset role;
select tests.assert(
  :'dc'::jsonb ->> 'status' = 'declined'
  and (:'dc'::jsonb ->> 'retry_at')::timestamptz between now() + interval '23 hours 55 minutes' and now() + interval '24 hours'
  and (select array_agg(k order by k) from jsonb_object_keys(:'dc'::jsonb) k) = array['retry_at', 'status']
  and (select pending_promotion_at is null and promotion_retry_at = (:'dc'::jsonb ->> 'retry_at')::timestamptz and tier = 'intern'
         from public.player_jobs where id = :'wjob')
  and exists (select 1 from public.notifications x where x.player_id = :w and x.type_key = 'promotion_result'
                 and x.title = 'Noch nicht befördert' and x.link = '/job' and x.payload ->> 'status' = 'declined'),
  'decline_promotion(): {status declined, retry_at = now + 24 h}; the employee is told ("Noch nicht befördert")');

-- the boss promotes anyway (with or without a request), at least with the formula wage
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.promote_employee(gen_random_uuid(), %L, %L, 25000)$$, :'bco', :'wjob'),
  'invalid_argument', 'promote_employee(): less than max(+15 %, 300 EUR) -> invalid_argument');
select public.promote_employee(:rq, :'bco', :'wjob', 40000) as pe1 \gset
select public.promote_employee(:rq, :'bco', :'wjob', 40000) as pe1b \gset
select tests.throws_key(format($$select public.promote_employee(gen_random_uuid(), %L, %L, null)$$, :'bco', :'wjob'),
  'promotion_not_ready', 'promote_employee(): right after a promotion the hours are missing -> promotion_not_ready');
select public.get_company_team(:'bco') -> 'members' -> 0 as m1 \gset
reset role;
select tests.assert(
  :'pe1'::jsonb = '{"status": "promoted", "tier": "junior", "salary_cents_per_hour": 40000}'::jsonb and :'pe1'::jsonb = :'pe1b'::jsonb
  and (select tier = 'junior' and salary_cents_per_hour = 40000 and rank_minutes = 0 and promotion_retry_at is null
              and pending_promotion_at is null and promoted_at is not null and title = 'Werkstudium'
              and required = '[{"branch": "it", "min_score": 0}]'::jsonb
         from public.player_jobs where id = :'wjob')
  and :'m1'::jsonb ->> 'tier' = 'junior' and :'m1'::jsonb -> 'promotion' ->> 'next_tier' = 'senior'
  and exists (select 1 from public.feed_items f where f.actor_id = :w and f.kind = 'promoted'
                 and f.payload = '{"tier": "junior", "company": "Berta Bytes"}'::jsonb)
  and exists (select 1 from public.notifications x where x.player_id = :w and x.type_key = 'promotion_result'
                 and x.title = 'Befördert!' and x.payload ->> 'tier' = 'junior'),
  'promote_employee(): {status promoted, tier, salary}; own title and requirements stay; retry wait cleared; feed and notification');

-- =============================================================================
-- G. Privileges, RLS, ledger
-- =============================================================================
select tests.login_as('authenticated', :e);
select count(*) as own_rows from public.player_upgrades \gset
select tests.throws($$insert into public.player_upgrades (player_id, key, level) values (auth.uid(), 'vault', 6)$$, '42501',
  'player_upgrades: no client writes');
reset role;
select tests.assert(
  :own_rows::int = 3 and (select count(*) from public.player_upgrades where player_id = :e) = 3
  and has_function_privilege('authenticated', 'public.buy_upgrade(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.promote_employee(uuid, uuid, uuid, bigint)', 'execute')
  and not has_function_privilege('anon', 'public.get_upgrades()', 'execute')
  and not has_function_privilege('authenticated', 'public.promotion_apply(uuid, bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.promotion_state(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.upgrade_cost_cents(text, integer)', 'execute')
  and not exists (select 1 from public.ledger_audit()),
  'player_upgrades: a player reads only own rows; RPCs for authenticated, helpers internal; ledger audit clean');
