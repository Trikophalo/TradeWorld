-- =============================================================================
-- a1 · Company fixes (migration 5300): a company upgraded to GmbH expands and changes its strategy, banners with
--      1, 6, 7 and 16 colours, the hourly close survives a broken company and a late market quarter, move cooldowns
--      and campaign end times in the responses
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;
-- ADR-183: the reputation moves the demand of every company; the exact numbers here assume it stays neutral
select tests.set_cfg('companyHealth', '{reputation,demandMaxEffect}', '0') is null as rep_neutral \gset

\set a '''0a1c0a1c-0000-4000-8000-0000000000a1'''
\set b '''0a1c0a1c-0000-4000-8000-0000000000b2'''
select tests.signup(:a, 'Gesa_Ausbau') is not null and tests.signup(:b, 'Bert_Bruch') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 20);
select tests.set_level(:b, 6);
select tests.fund(:a, 90000000, 'test:a1:a');
select tests.fund(:b, 1000000, 'test:a1:b');
select coalesce(value -> 'demandNoise', '0.1') as noise0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{demandNoise}', '0');
-- values the assertions need while a player is logged in (internal functions are not callable by players)
select public.company_expansion_cost_cents(0) as cost0, public.company_expansion_cost_cents(1) as cost1,
       public.cfg_num(public.company_moves_cfg(), '{cooldownFactor}', 2) as cooldown,
       public.config_double('startups', '{campaigns,kinds,flyer,hours}', 24)::int as flyer_hours \gset

-- a banner with n colours: every palette index is used
create or replace function tests.banner_n(n integer) returns jsonb language sql as $$
  select jsonb_build_object(
    'palette', (select jsonb_agg('#' || lpad(to_hex(i * 1000 + 17), 6, '0') order by i) from generate_series(0, n - 1) i),
    'grid', (select jsonb_agg((select string_agg(substr('0123456789abcdefg', ((x + y) % n) + 1, 1), '' order by x)
                                 from generate_series(0, 47) x) order by y) from generate_series(0, 11) y)) $$;
create or replace function tests.boom() returns trigger language plpgsql as $$
begin
  raise exception 'a1 test: this company cannot close its hour';
end $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. Small business -> GmbH (upgrade_company): expansion and strategy are open
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Gesa Werke', 'Maschinen nach Maß', 'tech', '#224466', 'small_business') -> 'company' as c0 \gset
select tests.assert(
  :'c0'::jsonb ->> 'tier' = 'small_business' and not (:'c0'::jsonb ->> 'can_expand')::boolean
  and :'c0'::jsonb -> 'expansion_cost_cents' = 'null'::jsonb,
  'small business: no expansion yet (can_expand false, cost null)');
select tests.throws_key($$select public.expand_company(gen_random_uuid())$$, 'company_upgrade_unavailable',
  'expand_company(): refused below the GmbH');
select public.upgrade_company(gen_random_uuid()) -> 'company' as c1 \gset
select public.get_my_company() -> 'company' as c2 \gset
select tests.assert(
  :'c1'::jsonb ->> 'tier' = 'gmbh' and (:'c1'::jsonb ->> 'can_expand')::boolean
  and (:'c1'::jsonb ->> 'expansion_cost_cents')::bigint = :cost0
  and (:'c1'::jsonb ->> 'expansion_level')::int = 0
  and :'c2'::jsonb ->> 'tier' = 'gmbh' and (:'c2'::jsonb ->> 'can_expand')::boolean
  and (:'c2'::jsonb ->> 'expansion_cost_cents')::bigint = :cost0,
  'upgrade_company() to GmbH: the answer and get_my_company say can_expand with the cost of level 1');
select public.company_deposit(gen_random_uuid(), 30000000) is not null as ok \gset
select public.expand_company(gen_random_uuid()) -> 'company' as c3 \gset
select tests.assert(
  (:'c3'::jsonb ->> 'expansion_level')::int = 1 and (:'c3'::jsonb ->> 'can_expand')::boolean
  and (:'c3'::jsonb ->> 'expansion_cost_cents')::bigint = :cost1
  and (:'c3'::jsonb ->> 'max_employees')::int = 30,
  'expand_company(): a company upgraded to GmbH reaches level 1, the next step is priced, 30 places');
select public.set_company_strategy(gen_random_uuid(), 'premium', false) -> 'company' as c4 \gset
select public.set_company_strategy(gen_random_uuid(), 'budget', true) -> 'company' as c5 \gset
select tests.assert(
  :'c4'::jsonb ->> 'price_level' = 'premium' and not (:'c4'::jsonb ->> 'contract_work')::boolean
  and :'c5'::jsonb ->> 'price_level' = 'budget' and (:'c5'::jsonb ->> 'contract_work')::boolean
  and public.get_my_company() -> 'company' ->> 'price_level' = 'budget',
  'set_company_strategy(): works for a GmbH, the answer carries the new strategy');
select public.set_company_strategy(gen_random_uuid(), 'normal', true) is not null as ok \gset
reset role;
select tests.company_of(:a) as aco \gset
-- an AG expands too (the tier after an IPO)
select tests.assert(public.company_can_expand('gmbh') and public.company_can_expand('ag')
  and not public.company_can_expand('small_business') and not public.company_can_expand('garage'),
  'company_can_expand(): GmbH and AG');
select tests.assert(
  public.company_expansion_cost_cents(46) > public.company_expansion_cost_cents(45)
  and public.company_expansion_cost_cents(47) = 9000000000000000000
  and public.company_expansion_cost_cents(5000) = 9000000000000000000,
  'company_expansion_cost_cents(): capped instead of "bigint out of range" at very high levels');

-- =============================================================================
-- B. Banners with 1, 6, 7 and 16 colours (index characters 0-9a-f)
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.set_company_banner(gen_random_uuid(), tests.banner_n(1)) -> 'company' -> 'banner' as b1 \gset
select public.set_company_banner(gen_random_uuid(), tests.banner_n(6)) -> 'company' -> 'banner' as b6 \gset
select public.set_company_banner(gen_random_uuid(), tests.banner_n(7)) -> 'company' -> 'banner' as b7 \gset
select public.set_company_banner(gen_random_uuid(), tests.banner_n(16)) -> 'company' -> 'banner' as b16 \gset
select tests.assert(
  :'b1'::jsonb = tests.banner_n(1) and :'b6'::jsonb = tests.banner_n(6) and :'b7'::jsonb = tests.banner_n(7)
  and :'b16'::jsonb = tests.banner_n(16) and :'b16'::jsonb #>> '{grid,0}' ~ 'f'
  and public.get_my_company() -> 'company' -> 'banner' = tests.banner_n(16),
  'set_company_banner(): 1, 6, 7 and 16 colours are saved and come back unchanged');
select tests.throws_key($$select public.set_company_banner(gen_random_uuid(), tests.banner_n(17))$$, 'invalid_argument',
  'set_company_banner(): 17 colours are refused');
select tests.throws_key(
  $$select public.set_company_banner(gen_random_uuid(), jsonb_set(tests.banner_n(7), '{grid,3}', to_jsonb(repeat('7', 48))))$$,
  'invalid_argument', 'set_company_banner(): an index beyond the palette is refused');
select tests.assert(
  public.set_company_banner(gen_random_uuid(), null) -> 'company' -> 'banner' = 'null'::jsonb,
  'set_company_banner(null): removes the banner');
select public.set_company_banner(gen_random_uuid(), tests.banner_n(16)) is not null as ok \gset
reset role;

-- =============================================================================
-- C. Hourly close: real data after the first closed hour; a broken company does not stop the others
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.found_company(gen_random_uuid(), 'Berts Bude', 'Dinge, die kaputt gehen', 'tech', '#664422', 'garage') is not null as ok \gset
select tests.assert(
  public.get_my_company() -> 'company' -> 'hours' = '[]'::jsonb,
  'before the first closed hour: hours is empty (the client shows "first hour is running")');
reset role;
select tests.company_of(:b) as bco \gset
-- nine full hours are due for both
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) - interval '9 hours'
 where company_id in (:'aco', :'bco');
update public.companies set founded_at = date_trunc('hour', public.game_now()) - interval '9 hours' where id in (:'aco', :'bco');
-- the market quarters that ended in these nine hours count as not closed yet (restored below)
create temporary table a1_quarters as
  select gq.id, gq.status from public.game_quarters gq
   where gq.ends_at > date_trunc('hour', public.game_now()) - interval '9 hours' and gq.ends_at <= public.game_now();
update public.game_quarters gq set status = 'active' from a1_quarters q where q.id = gq.id;
select format('create trigger a1_boom before insert on public.player_company_hours for each row when (new.company_id = %L) execute function tests.boom()', :'bco') as mk \gset
:mk;
select public.player_companies_run_due() as due1 \gset
select tests.assert(
  (:'due1'::jsonb ->> 'failed')::int = 1
  and (select count(*) from public.player_company_hours where company_id = :'aco') = 9
  and (select last_hour_at = date_trunc('hour', public.game_now()) from public.player_companies where company_id = :'aco')
  and (select count(*) from public.player_company_hours where company_id = :'bco') = 0
  and (select j.status = 'failed' and j.error like '%a1 test%' from public.job_runs j
        where j.job_name = 'company_hours' and j.run_key = :'bco'),
  'player_companies_run_due(): one company whose close raises is skipped and logged, the other closes all nine hours');
-- the nine hours cross at least one quarter end: the company report does not wait for the market's quarter close
-- (a fresh database has no quarter that ended in the last nine hours at every time of day: then there is nothing to
--  report and the check holds trivially; before ADR-176 this made verify_local.sh, and with it the deploy, fail by
--  the clock)
select tests.assert(
  not exists (select 1 from a1_quarters)
  or (select count(*) from public.player_company_reports where company_id = :'aco') >= 1
  and exists (select 1 from public.game_quarters gq join public.player_company_reports r on r.game_quarter_id = gq.id
               where r.company_id = :'aco' and gq.status <> 'closed'),
  'quarter report of a company: written from its own hours although the market quarter is not closed yet');
update public.game_quarters gq set status = q.status from a1_quarters q where q.id = gq.id;
select tests.login_as('authenticated', :a);
select public.get_my_company() -> 'company' as c6 \gset
reset role;
select h.revenue_cents as h_rev, h.profit_cents as h_profit, h.demand_cents as h_demand, h.capacity_cents as h_cap,
       h.fixed_cents as h_fixed
  from public.player_company_hours h where h.company_id = :'aco' order by h.hour_start desc limit 1 \gset
select tests.assert(
  jsonb_array_length(:'c6'::jsonb -> 'hours') = 9
  and (:'c6'::jsonb #>> '{live,revenue_per_hour_cents}')::bigint = :h_rev
  and (:'c6'::jsonb #>> '{live,profit_per_hour_cents}')::bigint = :h_profit
  and (:'c6'::jsonb #>> '{live,demand_per_hour_cents}')::bigint = :h_demand
  and (:'c6'::jsonb #>> '{live,capacity_per_hour_cents}')::bigint = :h_cap
  and (:'c6'::jsonb #>> '{live,fixed_per_hour_cents}')::bigint = :h_fixed
  and :h_cap > 0 and :h_demand > 0
  and (:'c6'::jsonb #>> '{live,last_hour_at}')::timestamptz = date_trunc('hour', public.game_now())
  and (:'c6'::jsonb #>> '{hours,8,profit_cents}')::bigint = :h_profit
  -- GmbH with expansion level 1: fixed costs per hour = quarter costs x 1.25 / quarterHours
  and :h_fixed = round(public.company_fixed_cost_cents('gmbh', 1) / public.config_double('time', '{quarterHours}', 6)),
  'get_my_company for the GmbH after closed hours: hours and live carry the last closed hour (cents per hour)');
-- the broken company heals: its hours are caught up, the log entry goes
drop trigger a1_boom on public.player_company_hours;
select public.player_companies_run_due() as due2 \gset
select tests.assert(
  (:'due2'::jsonb ->> 'failed')::int = 0 and (:'due2'::jsonb ->> 'hours')::int >= 9
  and (select count(*) from public.player_company_hours where company_id = :'bco') = 9
  and not exists (select 1 from public.job_runs j where j.job_name = 'company_hours' and j.run_key = :'bco')
  and (public.run_due_part('companies') #>> '{player_companies,hours}')::int = 0,
  'player_companies_run_due(): the skipped company catches up in a later run; nothing is closed twice');

-- =============================================================================
-- D. Business moves: the pause is in the answer before and after a start
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.get_company_moves() as m0 \gset
select :'m0'::jsonb #>> '{moves,0,key}' as mkey \gset
select tests.assert(
  not exists (select 1 from jsonb_array_elements(:'m0'::jsonb -> 'moves') m
               where (m ->> 'rest_minutes')::int
                     <> (m ->> 'minutes')::int * (1 + :cooldown)
                  or m -> 'available_at' <> 'null'::jsonb),
  'get_company_moves(): every move says rest_minutes = minutes x (1 + cooldownFactor); nothing rests yet');
select public.start_company_move(gen_random_uuid(), :'mkey') as m1 \gset
select tests.assert(
  (:'m1'::jsonb #>> '{moves,0,available_at}')::timestamptz
    = (:'m1'::jsonb #>> '{running,0,started_at}')::timestamptz
      + make_interval(mins => (:'m1'::jsonb #>> '{moves,0,rest_minutes}')::int)
  and (:'m1'::jsonb #>> '{moves,0,available_at}')::timestamptz > public.game_now()
  and :'m1'::jsonb #> '{moves,1,available_at}' = 'null'::jsonb,
  'start_company_move(): available_at = start + rest_minutes for the started move only');
select tests.throws_key(format($$select public.start_company_move(gen_random_uuid(), %L)$$, :'mkey'), 'move_resting',
  'start_company_move(): refused while the move runs (its pause has begun)');
reset role;
select public.company_moves_run_due(public.game_now() + interval '3 hours') is not null as ok \gset
select tests.login_as('authenticated', :a);
select tests.assert(
  (public.get_company_moves() #>> '{moves,0,available_at}')::timestamptz = (:'m1'::jsonb #>> '{moves,0,available_at}')::timestamptz
  and jsonb_array_length(public.get_company_moves() -> 'running') = 0,
  'get_company_moves(): after the result the move still rests until available_at');
select tests.throws_key(format($$select public.start_company_move(gen_random_uuid(), %L)$$, :'mkey'), 'move_resting',
  'start_company_move(): refused while the move rests');

-- =============================================================================
-- E. Marketing campaign: the end time is in COMPANY
-- =============================================================================
select public.start_campaign(gen_random_uuid(), :'aco', 'flyer') as k1 \gset
select public.get_my_company() -> 'company' -> 'campaign' as k2 \gset
select tests.assert(
  :'k2'::jsonb ->> 'id' = :'k1'::jsonb ->> 'id' and :'k2'::jsonb ->> 'kind' = 'flyer'
  and (:'k2'::jsonb ->> 'ends_at')::timestamptz
      = (:'k2'::jsonb ->> 'started_at')::timestamptz
        + make_interval(hours => :flyer_hours)
  and (:'k2'::jsonb ->> 'ends_at')::timestamptz > public.game_now(),
  'start_campaign(): get_my_company carries the running campaign with started_at and ends_at');
reset role;

select tests.set_cfg('startups', '{demandNoise}', :'noise0'::jsonb);
