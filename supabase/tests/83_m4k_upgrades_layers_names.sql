-- =============================================================================
-- 83 · M4k: upgrades with level stages and five new effects, three furniture layers, unique names,
--      deals with the company (ADR-100), presence at work (ADR-103), org chart
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set u '''08308308-0000-4000-8000-0000000000a1'''
\set h '''08308308-0000-4000-8000-0000000000b1'''
\set f '''08308308-0000-4000-8000-0000000000c1'''
\set g '''08308308-0000-4000-8000-0000000000d1'''
\set k '''08308308-0000-4000-8000-0000000000e1'''
\set s '''08308308-0000-4000-8000-0000000000f1'''
\set t '''08308308-0000-4000-8000-0000000000f2'''
\set n '''08308308-0000-4000-8000-0000000000f3'''
\set w '''08308308-0000-4000-8000-0000000000f4'''
\set r '''08308308-0000-4000-8000-0000000000f5'''
\set e '''08308308-0000-4000-8000-0000000000f6'''
\set rq1 '''08308308-0000-4000-8000-000000000101'''
\set rq2 '''08308308-0000-4000-8000-000000000102'''
\set rq3 '''08308308-0000-4000-8000-000000000103'''
-- the M1 test invite code is shared by every test file; give this one its own room
update public.invite_codes set max_uses = max_uses + 15 where code = 'M1-TESTS';
select tests.signup(:u, 'Ute_Stufen') is not null and tests.signup(:h, 'Hugo_Heim') is not null
   and tests.signup(:f, 'Fred_Fabrik') is not null and tests.signup(:g, 'Gina_Gleich') is not null
   and tests.signup(:k, 'Kai_Kopie') is not null and tests.signup(:s, 'Sven_Liefert') is not null
   and tests.signup(:t, 'Tina_Kauft') is not null and tests.signup(:n, 'Nils_Neu') is not null
   and tests.signup(:w, 'Wim_Weg') is not null and tests.signup(:r, 'Rita_Rueck') is not null
   and tests.signup(:e, 'Eva_Team') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:u, 4);
select tests.set_level(:h, 8);
select tests.set_level(x, 6) from unnest(array[:f, :g, :k, :s, :t, :w, :r, :e]::uuid[]) x;
select tests.set_level(:n, 5);
select tests.fund(:u, 20000000, 'test:m4k:u');
select tests.fund(:h, 80000000, 'test:m4k:h');
select tests.fund(:f, 5000000, 'test:m4k:f');
select tests.fund(:g, 2000000, 'test:m4k:g');
select tests.fund(:k, 2000000, 'test:m4k:k');
select tests.fund(:s, 5000000, 'test:m4k:s');
select tests.fund(:t, 5000000, 'test:m4k:t');

-- p_minutes of work right now (as if the last payout was p_minutes ago, nothing paid today)
create or replace function tests.m4k_work(p_job uuid, p_minutes integer) returns bigint language plpgsql as $$
begin
  update public.player_jobs set last_paid_at = now() - make_interval(mins => p_minutes),
         paid_day = (now() at time zone 'Europe/Berlin')::date, paid_minutes_today = 0
   where id = p_job;
  return public.accrue_job_salary(p_job, now());
end;
$$;
create or replace function tests.m4k_buy(p_player uuid, p_key text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform tests.login_as('authenticated', p_player);
  v := public.buy_upgrade(gen_random_uuid(), p_key);
  reset role;
  return v;
end;
$$;
-- reads player_furniture while a player is logged in (no client access to the table)
create or replace function tests.m4k_place(p_player uuid, p_key text, p_x integer, p_y integer, p_n integer default 1)
returns jsonb language sql security definer as $$
  select jsonb_build_object('id', f.id, 'x', p_x, 'y', p_y, 'rot', 0)
    from public.player_furniture f where f.player_id = p_player and f.item_key = p_key
   order by f.bought_at, f.id offset p_n - 1 limit 1 $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. Rules, schema, error key
-- =============================================================================
select tests.assert(
  (select array_agg(public.upgrade_stage_level('vault', l) order by l) from generate_series(0, 6) l) = array[1, 3, 5, 7, 9, 11, null]
  and (select array_agg(public.upgrade_stage_level('income', l) order by l) from generate_series(0, 3) l) = array[3, 7, 11, null]
  and (select array_agg(public.upgrade_stage_level('study', l) order by l) from generate_series(0, 3) l) = array[2, 6, 10, null]
  and (select array_agg(public.upgrade_stage_level('mentor', l) order by l) from generate_series(0, 3) l) = array[4, 8, 12, null]
  and (select array_agg(public.upgrade_stage_level('overtime', l) order by l) from generate_series(0, 2) l) = array[5, 11, null]
  and (select array_agg(public.upgrade_stage_level('rhetoric', l) order by l) from generate_series(0, 3) l) = array[5, 10, 15, null]
  and (select array_agg(public.upgrade_stage_level('artist', l) order by l) from generate_series(0, 3) l) = array[4, 7, 10, null]
  and (select array_agg(public.upgrade_stage_level('efficiency', l) order by l) from generate_series(0, 3) l) = array[6, 10, 14, null]
  and (select array_agg(public.upgrade_stage_level('makler', l) order by l) from generate_series(0, 3) l) = array[8, 12, 16, null]
  and (select array_agg(public.upgrade_stage_level('crypto_wallet', l) order by l) from generate_series(0, 2) l) = array[10, 15, null]
  and public.upgrade_stage_level('jetpack', 0) is null,
  'upgradeStageLevel: stage n from minLevel + (n - 1) x levelStep (vault 1, 3, 5, 7, 9, 11; mentor 4, 8, 12; wallet 10, 15)');
select tests.assert(
  (select array_agg(public.upgrade_cost_cents('mentor', l) order by l) from generate_series(0, 3) l)
    = array[600000, 1800000, 5400000, null]::bigint[]
  and (select array_agg(public.upgrade_cost_cents('artist', l) order by l) from generate_series(0, 3) l)
    = array[500000, 1250000, 3125000, null]::bigint[]
  and (select array_agg(public.upgrade_cost_cents('efficiency', l) order by l) from generate_series(0, 3) l)
    = array[1200000, 3000000, 7500000, null]::bigint[]
  and (select array_agg(public.upgrade_cost_cents('makler', l) order by l) from generate_series(0, 3) l)
    = array[1500000, 3750000, 9375000, null]::bigint[]
  and (select array_agg(public.upgrade_cost_cents('crypto_wallet', l) order by l) from generate_series(0, 2) l)
    = array[2000000, 6000000, null]::bigint[],
  'upgradeCostCents of the new upgrades (mentor 6.000 / 18.000 / 54.000 EUR, makler 15.000 / 37.500 / 93.750 EUR)');
select tests.assert(
  public.player_upgrade_levels(:u) = '{"vault": 0, "income": 0, "study": 0, "overtime": 0, "rhetoric": 0, "mentor": 0,
                                       "artist": 0, "efficiency": 0, "makler": 0, "crypto_wallet": 0}'::jsonb
  and public.player_work_xp_bps(:u) = 10000 and public.player_art_discount_bps(:u) = 0
  and public.player_fixed_cost_discount_bps(:u) = 0 and public.player_property_discount_bps(:u) = 0,
  'upgradeEffects at level 0: all ten keys 0, work XP 10 000 bps, no discounts');
do $$
declare
  v_state text;
begin
  begin
    perform public.api_error('deal_too_big');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  if v_state is distinct from 'NX095' then
    raise exception 'ASSERTION FAILED: deal_too_big raised %', v_state;
  end if;
  raise notice 'ok - api_error: deal_too_big NX095';
end;
$$;
select tests.assert(
  (select count(*) from public.furniture_catalog) = 87
  and (select count(*) from public.furniture_catalog where layer = 'top') = 18
  and (select count(*) from public.furniture_catalog where layer = 'floor') = 6
  and (select count(*) from public.furniture_catalog where surface) = 16
  and not exists (select 1 from public.furniture_catalog where surface and layer <> 'object')
  and (select bool_and(width = 1 and height = 1) from public.furniture_catalog where layer = 'top'),
  'catalogue: 87 pieces, 18 small things on top (1 x 1), 16 objects with a surface (seed ran twice)');
select tests.throws($$insert into public.furniture_catalog (key, name, category, tier, price_cents, width, height, layer, surface)
                      values ('test_bad', 'Kaputt', 'decor', 'budget', 100, 1, 1, 'top', true)$$, '23514',
  'furniture_catalog: only objects carry a surface');
select tests.throws($$insert into public.furniture_catalog (key, name, category, tier, price_cents, width, height, layer)
                      values ('test_bad', 'Kaputt', 'decor', 'budget', 100, 1, 1, 'wall')$$, '23514',
  'furniture_catalog: layer floor, object or top');
select tests.assert(
  public.deal_supply_max_cost_cents(30000, 24, 5000) = 360000 and public.deal_supply_max_cost_cents(3, 1, 5000) = 2
  and public.deal_supply_max_cost_cents(5, 1, 5000) = 2 and public.deal_size_limit_cents(null) is null,
  'supplyMaxCostCents: applyBps(volume x hours, fee) half even; no limit without a company');

-- =============================================================================
-- B. Upgrades: level stages
-- =============================================================================
select tests.m4k_buy(:u, 'vault') ->> 'level' as v1 \gset
select tests.m4k_buy(:u, 'vault') ->> 'level' as v2 \gset
select tests.login_as('authenticated', :u);
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'vault')$$, 'locked',
  'buy_upgrade(): vault stage 3 needs level 5 (level 4)');
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'makler')$$, 'locked',
  'buy_upgrade(): makler from level 8');
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'crypto_wallet')$$, 'locked',
  'buy_upgrade(): crypto_wallet from level 10');
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'teleporter')$$, 'invalid_argument',
  'buy_upgrade(): unknown key');
select public.buy_upgrade(:rq1, 'mentor') as m1 \gset
select public.buy_upgrade(:rq1, 'mentor') as m1b \gset
select tests.throws_key($$select public.buy_upgrade(gen_random_uuid(), 'mentor')$$, 'locked',
  'buy_upgrade(): mentor stage 2 needs level 8');
select public.buy_upgrade(gen_random_uuid(), 'artist') ->> 'cost_cents' as a1 \gset
select public.get_upgrades() as gu \gset
reset role;
select tests.assert(
  :v1::int = 1 and :v2::int = 2 and :'m1'::jsonb = :'m1b'::jsonb
  and (:'m1'::jsonb ->> 'level')::int = 1 and (:'m1'::jsonb ->> 'cost_cents')::bigint = 600000 and :a1::bigint = 500000
  and :'gu'::jsonb = '{"levels": {"vault": 2, "income": 0, "study": 0, "overtime": 0, "rhetoric": 0, "mentor": 1, "artist": 1,
                                  "efficiency": 0, "makler": 0, "crypto_wallet": 0}}'::jsonb
  and (:'m1'::jsonb #>> '{levels,mentor}')::int = 1 and (:'m1'::jsonb #>> '{levels,artist}')::int = 0,
  'buy_upgrade(): vault 1 and 2 at level 4 (stages from 1 and 3), mentor and artist from level 4, replay-safe; '
  || 'get_upgrades() shows all ten keys');
select tests.set_level(:u, 10);
select tests.m4k_buy(:u, 'crypto_wallet') ->> 'level' as cw \gset
select tests.assert(
  :cw::int = 1 and exists (select 1 from public.player_upgrades where player_id = :u and key = 'crypto_wallet' and level = 1)
  and public.player_upgrade_level(:u, 'crypto_wallet') = 1,
  'crypto_wallet: bought from level 10, player_upgrade_level(p, ''crypto_wallet'') for the crypto pool fees');
select tests.set_level(:u, 4);

-- =============================================================================
-- C. Mentor: more XP from paid work hours
-- =============================================================================
select tests.login_as('authenticated', :u);
select x ->> 'id' as upost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where x ->> 'tier' = 'intern' and (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean
 order by x ->> 'id' limit 1 \gset
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'upost', 15000, null) ->> 'id')::uuid,
                            'M1 1 L3 3') is not null as ok \gset
reset role;
select j.id as ujob from public.player_jobs j where j.player_id = :u and j.status = 'active' \gset
select tests.m4k_work(:'ujob', 120) >= 0 as ok \gset
select tests.assert(
  public.player_work_xp_bps(:u) = 11000
  and (select sp.xp_awarded from public.salary_payouts sp where sp.player_job_id = :'ujob' order by sp.period_end desc limit 1)
      = round(round(public.config_double('progression', '{xpSources,workHour,xp}', 40) * 2 * 1.1)
              * public.config_double('progression', '{xpMultiplier}', 2))::int,
  'mentor 1: two paid hours give work XP x 1.1 (11 000 bps), then the XP multiplier');

-- =============================================================================
-- D. Artist: cheaper paintings; unique artwork titles
-- =============================================================================
select count(*) as upainted from public.artworks where creator_id = :u \gset
select tests.login_as('authenticated', :u);
select public.get_art_studio() as st \gset
select public.create_artwork(:rq2, 'Ute malt Sterne', tests.art()) as cu \gset
select public.create_artwork(:rq2, 'Ute malt Sterne', tests.art()) as cu2 \gset
select public.check_artwork_title('  ute   MALT sterne ') as ct1 \gset
select public.check_artwork_title('Ut3 malt St3rne') as ct2 \gset
select public.check_artwork_title('Abendrot ueber der Boerse') as ct3 \gset
select public.check_artwork_title('Ganz neuer Titel') as ct4 \gset
select public.check_artwork_title('Ab') as ct5 \gset
select public.check_artwork_title(repeat('Lang ', 9)) as ct6 \gset
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', 'UTE MALT STERNE', tests.art()),
  'name_taken', 'create_artwork(): a lookalike of an existing title (case) -> name_taken');
select tests.throws_key(format('select public.create_artwork(gen_random_uuid(), %L, %L)', 'Abendrot über der Börse', tests.art()),
  'name_taken', 'create_artwork(): the title of a gallery artwork -> name_taken');
reset role;
select tests.assert(
  (:'st'::jsonb ->> 'next_cost_cents')::bigint = public.apply_bps(public.artwork_create_cost_cents(:upainted), 9000)
  and (:'cu'::jsonb ->> 'cost_cents')::bigint = public.apply_bps(public.artwork_create_cost_cents(:upainted), 9000)
  and (:'cu'::jsonb ->> 'next_cost_cents')::bigint = public.apply_bps(public.artwork_create_cost_cents(:upainted + 1), 9000)
  and :'cu'::jsonb = :'cu2'::jsonb
  and (select t.metadata ->> 'discount_bps' from public.ledger_transactions t
        where t.idempotency_key = 'art:create:' || (:'cu'::jsonb #>> '{artwork,id}')) = '1000',
  'artist 1: painting costs 90 % (get_art_studio, create_artwork cost and next cost); the replay answers the same');
select tests.assert(
  :'ct1'::jsonb = '{"allowed": false, "reason": "name_taken"}'::jsonb
  and :'ct2'::jsonb = '{"allowed": false, "reason": "name_taken"}'::jsonb
  and :'ct3'::jsonb = '{"allowed": false, "reason": "name_taken"}'::jsonb
  and :'ct4'::jsonb = '{"allowed": true, "reason": null}'::jsonb
  and :'ct5'::jsonb = '{"allowed": false, "reason": "name_too_short"}'::jsonb
  and :'ct6'::jsonb = '{"allowed": false, "reason": "name_too_long"}'::jsonb,
  'check_artwork_title(): spaces and case, leet digits and umlauts count as the same title; length rules as create_artwork');

-- =============================================================================
-- E. Company names: unique among existing companies, freed by closing; replacing the own company
-- =============================================================================
select tests.login_as('authenticated', :g);
select public.found_company(gen_random_uuid(), 'Gleich Werk', 'Schrauben nach Maß', 'tech', '#335577', 'garage') -> 'company' ->> 'name' as gname \gset
select public.check_company_name('Gleich Werk') as gn_own \gset
reset role;
select tests.login_as('authenticated', :k);
select public.check_company_name('gleich werk') as gn1 \gset
select public.check_company_name('Gle1ch Werk') as gn2 \gset
select public.check_company_name('Gleich Werke') as gn3 \gset
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'GLEICH WERK', 'Kopie', 'tech', '#335577', 'garage')$$,
  'name_taken', 'found_company(): a lookalike of an active company -> name_taken');
reset role;
select tests.assert(
  :'gname' = 'Gleich Werk' and :'gn_own'::jsonb = '{"allowed": true, "reason": null}'::jsonb
  and :'gn1'::jsonb = '{"allowed": false, "reason": "name_taken"}'::jsonb
  and :'gn2'::jsonb = '{"allowed": false, "reason": "name_taken"}'::jsonb
  and :'gn3'::jsonb = '{"allowed": true, "reason": null}'::jsonb,
  'check_company_name(): lookalikes of an active company are taken (case, leet digits); the founder''s own name is free for them');
-- closing frees the name
select tests.login_as('authenticated', :g);
select public.close_company(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :k);
select public.check_company_name('Gleich Werk') as gn4 \gset
select public.found_company(gen_random_uuid(), 'Gleich Werk', 'Neue Schrauben', 'tech', '#553377', 'garage') -> 'company' as kco \gset
reset role;
select tests.assert(
  :'gn4'::jsonb = '{"allowed": true, "reason": null}'::jsonb and :'kco'::jsonb ->> 'name' = 'Gleich Werk'
  and (select count(*) from public.companies where lower(name) = 'gleich werk') = 2
  and (select count(*) from public.companies where lower(name) = 'gleich werk' and dissolved_at is null) = 1,
  'a closed company frees its name: another player founds "Gleich Werk" again (the old one stays dissolved)');

-- replace: Fred founds, then founds again with p_replace
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Fred Fabrik', 'Teile aus Holz', 'tech', '#224466', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:f) as fco_old \gset
select public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(:'fco_old'), 700000,
  'transfer', 'Test-Kapital', 'company', :'fco_old', 'test:m4k:fco') is not null as ok \gset
select tests.cash(:f) as fcash0 \gset
select balance_cents as fco_cash from public.ledger_accounts where owner_company_id = :'fco_old' and kind = 'company_cash' \gset
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Fred Neu', 'Teile aus Stahl', 'tech', '#224466', 'garage')$$,
  'company_exists', 'found_company(): without p_replace an active company -> company_exists');
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Fred Neu', 'Teile aus Stahl', 'tech', '#224466', 'gmbh', null, true)$$,
  'company_level_too_low', 'found_company(p_replace): a refused founding closes nothing');
select public.found_company(:rq3, 'Fred Fabrik', 'Teile aus Stahl', 'retail', '#446622', 'garage', null, true) as fr \gset
select public.found_company(:rq3, 'Fred Fabrik', 'Teile aus Stahl', 'retail', '#446622', 'garage', null, true) as fr2 \gset
reset role;
select tests.assert(
  :'fr'::jsonb = :'fr2'::jsonb and :'fr'::jsonb -> 'company' ->> 'name' = 'Fred Fabrik'
  and :'fr'::jsonb -> 'company' ->> 'sector' = 'retail' and (:'fr'::jsonb #>> '{company,id}')::uuid <> :'fco_old'::uuid
  and (select status from public.player_companies where company_id = :'fco_old') = 'dissolved'
  and (select phase::text = 'dissolved' and dissolved_at is not null from public.companies where id = :'fco_old')
  and (select count(*) from public.player_companies where founder_id = :f and status = 'active') = 1
  and exists (select 1 from public.company_dissolutions d where d.company_id = :'fco_old' and d.reason = 'closed'
                 and d.to_founder_cents = :fco_cash::bigint and d.company_name = 'Fred Fabrik')
  and exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'dissolve:' || :'fco_old' || ':rest')
  and tests.cash(:f) = :fcash0::bigint + :fco_cash::bigint - 250000
  and (select balance_cents from public.ledger_accounts where owner_company_id = :'fco_old' and kind = 'company_cash') = 0,
  'found_company(p_replace): the old company is closed like close_company (rest to the founder), the new one founded '
  || 'with the same name in one transaction; replay-safe');
-- a replacement that cannot be paid rolls back the closing as well
select company_id as fco_new from public.player_companies where founder_id = :f and status = 'active' \gset
select public.ledger_transfer(public.ledger_player_account(:f, 'player_cash'), public.ledger_system_account('households'),
  tests.cash(:f), 'transfer', 'Test-Leerung', 'player', :f, 'test:m4k:fdrain') is not null as ok \gset
select public.ledger_transfer(public.company_cash_account(:'fco_new'), public.ledger_system_account('households'),
  (select balance_cents from public.ledger_accounts where owner_company_id = :'fco_new' and kind = 'company_cash'),
  'transfer', 'Test-Leerung', 'company', :'fco_new', 'test:m4k:fcodrain') is not null as ok \gset
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.found_company(gen_random_uuid(), 'Fred Pleite', 'Nichts', 'tech', '#224466', 'garage', null, true)$$,
  'insufficient_funds', 'found_company(p_replace): no money for the new company');
reset role;
select tests.assert(
  (select status from public.player_companies where company_id = :'fco_new') = 'active'
  and not exists (select 1 from public.company_dissolutions where company_id = :'fco_new')
  and not exists (select 1 from public.companies where name = 'Fred Pleite'),
  'found_company(p_replace): when the new founding fails, the old company stays (one transaction)');

-- =============================================================================
-- F. Efficiency: fixed costs of the own company
-- =============================================================================
select tests.fund(:f, 2000000, 'test:m4k:f2');
select tests.m4k_buy(:f, 'efficiency') ->> 'level' as ef \gset
select date_trunc('hour', now()) - interval '2 hours' as fh \gset
select public.player_company_close_hour(:'fco_new', :'fh'::timestamptz) is not null as ok \gset
select tests.login_as('authenticated', :f);
select public.get_my_company() -> 'company' -> 'live' as flive \gset
reset role;
select tests.assert(
  :ef::int = 1 and public.player_fixed_cost_discount_bps(:f) = 500
  and (select h.fixed_cents from public.player_company_hours h where h.company_id = :'fco_new' and h.hour_start = :'fh'::timestamptz)
      = public.apply_bps(round(public.company_fixed_cost_cents('garage', 0)
                               / greatest(1, public.config_double('time', '{quarterHours}', 6)))::bigint, 9500)
  and (:'flive'::jsonb ->> 'fixed_per_hour_cents')::bigint
      = (select h.fixed_cents from public.player_company_hours h where h.company_id = :'fco_new' order by h.hour_start desc limit 1),
  'efficiency 1: the hourly close books 95 % of the fixed costs, COMPANY.live.fixed_per_hour_cents shows them');

-- =============================================================================
-- G. Makler: homes, furniture, floors and cars 5 % cheaper; the price paid is stored
-- =============================================================================
select tests.m4k_buy(:h, 'makler') ->> 'level' as mk \gset
select tests.cash(:h) as hc0 \gset
select tests.login_as('authenticated', :h);
select public.buy_home(gen_random_uuid(), 'flat') ->> 'cost_cents' as hflat \gset
select public.buy_furniture(gen_random_uuid(), 'table_oak', 1) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'kitchen_counter', 1) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'chair_wood', 1) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'rug_checker', 1) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'laptop', 2) is not null as ok \gset
select public.buy_furniture(gen_random_uuid(), 'lamp_table', 1) is not null as ok \gset
select public.buy_floor(gen_random_uuid(), 'carpet') is not null as ok \gset
reset role;
select tests.assert(
  :mk::int = 1 and public.player_property_discount_bps(:h) = 500 and :hflat::bigint = 2375000
  and (select price_paid_cents from public.player_furniture where player_id = :h and item_key = 'table_oak') = 133000
  and (select price_paid_cents from public.player_furniture where player_id = :h and item_key = 'laptop' limit 1) = 133000
  and tests.cash(:h) = :hc0::bigint - 2375000 - 133000 - 23750 - 7600 - 13300 - 2 * 133000 - 8550 - 142500,
  'makler 1 (15.000 EUR): flat 23.750 EUR, oak table 1.330 EUR (stored as price paid), carpet 1.425 EUR');
select id as hchair from public.player_furniture where player_id = :h and item_key = 'chair_wood' \gset
select tests.login_as('authenticated', :h);
select public.sell_item(gen_random_uuid(), 'furniture', :'hchair') ->> 'refund_cents' as hrefund \gset
reset role;
select tests.set_level(:h, 14);
select tests.cash(:h) as hc1 \gset
select tests.login_as('authenticated', :h);
select public.buy_home(gen_random_uuid(), 'house') ->> 'cost_cents' as hhouse \gset
select public.buy_car(gen_random_uuid(), 'car_city') #> '{property,garage}' as hgarage \gset
reset role;
select tests.assert(
  :hrefund::bigint = 7600 * 4000 / 10000
  and :hhouse::bigint = public.apply_bps(50000000 - 1250000, 9500)
  and (select price_paid_cents from public.player_cars where player_id = :h and car_key = 'car_city') = 855000
  and tests.cash(:h) = :hc1::bigint - :hhouse::bigint - 855000
  and (select t.metadata ->> 'discount_bps' from public.ledger_transactions t
        where t.initiated_by = :h and t.ref_type = 'car') = '500',
  'makler: resale from the price paid (40 % of 76 EUR), the move to the house costs 95 % of price minus trade-in, '
  || 'the car 95 % (8.550 EUR)');

-- =============================================================================
-- H. Three layers: small things stand on surfaces, one per tile
-- =============================================================================
select tests.set_level(:h, 8);
-- a 2 x 1 test tray of the top layer, to see that a thing must stand completely on surfaces
insert into public.furniture_catalog (key, name, category, tier, price_cents, width, height, layer, surface)
values ('test_tray', 'Testtablett', 'decor', 'budget', 100, 2, 1, 'top', false) on conflict (key) do nothing;
insert into public.player_furniture (player_id, item_key, price_paid_cents) values (:h, 'test_tray', 100);
-- the house is 13 x 9: oak table (2 x 2, surface) at (0, 0), kitchen counter (1 x 1, surface) at (5, 0),
-- chair (object, no surface) at (3, 0), rug under the table at (0, 0)
select tests.login_as('authenticated', :h);
select public.save_layout(gen_random_uuid(), '#ffffff', 'carpet', jsonb_build_array(
  tests.m4k_place(:h, 'table_oak', 0, 0), tests.m4k_place(:h, 'rug_checker', 0, 0), tests.m4k_place(:h, 'kitchen_counter', 5, 0),
  tests.m4k_place(:h, 'laptop', 1, 0), tests.m4k_place(:h, 'laptop', 5, 0, 2), tests.m4k_place(:h, 'lamp_table', 0, 0),
  tests.m4k_place(:h, 'test_tray', 0, 1))) #> '{property,placed}' as hl \gset
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'carpet', jsonb_build_array(
  tests.m4k_place(:h, 'table_oak', 0, 0), tests.m4k_place(:h, 'laptop', 2, 0))),
  'layout_invalid', 'a laptop next to the table (no surface below) is invalid');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'carpet', jsonb_build_array(
  tests.m4k_place(:h, 'table_oak', 0, 0), tests.m4k_place(:h, 'laptop', 1, 1), tests.m4k_place(:h, 'lamp_table', 1, 1))),
  'layout_invalid', 'two small things on one tile are invalid');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'carpet', jsonb_build_array(
  tests.m4k_place(:h, 'rug_checker', 0, 0), tests.m4k_place(:h, 'laptop', 0, 0))),
  'layout_invalid', 'a rug is no surface');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'carpet', jsonb_build_array(
  tests.m4k_place(:h, 'table_oak', 0, 0), tests.m4k_place(:h, 'test_tray', 1, 0))),
  'layout_invalid', 'a 2 x 1 thing half on the table is invalid (completely on surfaces)');
select tests.throws_key(format('select public.save_layout(gen_random_uuid(), %L, %L, %L)', '#ffffff', 'carpet', jsonb_build_array(
  tests.m4k_place(:h, 'kitchen_counter', 3, 0), tests.m4k_place(:h, 'laptop', 3, 0), tests.m4k_place(:h, 'lamp_table', 3, 1))),
  'layout_invalid', 'a lamp below the counter (a tile without furniture) is invalid');
reset role;
select tests.assert(
  jsonb_array_length(:'hl'::jsonb) = 7
  and (select count(*) from public.player_furniture where player_id = :h and placed) = 7
  and (select x = 1 and y = 0 from public.player_furniture where player_id = :h and item_key = 'laptop' and placed
        order by bought_at, id limit 1),
  'save_layout(): rug, table and on it a laptop, a lamp and a 2 x 1 tray, a laptop on the counter: three layers on one tile');
delete from public.player_furniture where player_id = :h and item_key = 'test_tray';
delete from public.furniture_catalog where key = 'test_tray';

-- =============================================================================
-- I. Deals with the company: size limit by company value
-- =============================================================================
select tests.login_as('authenticated', :s);
select public.found_company(gen_random_uuid(), 'Sven Teile', 'Teile auf Abruf', 'tech', '#335577', 'garage') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :t);
select public.found_company(gen_random_uuid(), 'Tina Laden', 'Alles für den Laden', 'retail', '#553377', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:s) as sco \gset
select tests.company_of(:t) as tco \gset
select nickname as t_nick from public.profiles where id = :t \gset
select nickname as s_nick from public.profiles where id = :s \gset
select tests.assert(
  public.deal_size_limit_cents(:'sco') = greatest(5000000, public.company_value_cents(:'sco') * 5000 / 10000)
  and public.deal_size_limit_cents(:'sco') = 5000000,
  'dealSizeLimitCents: a fresh garage (value 2.500 EUR) may make deals up to the minimum of 50.000 EUR');
select tests.login_as('authenticated', :s);
-- 400 000 x 24 h x 50 % = 4 800 000 fits; 450 000 x 24 h x 50 % = 5 400 000 does not
select tests.throws_key(format('select public.propose_deal(gen_random_uuid(), %L, %L, %L, %L, null)', 'supply', 'supplier', :'t_nick',
  '{"volume_cents_per_hour": 450000, "fee_bps": 5000, "prepay_bps": 0, "hours": 24}'), 'deal_too_big',
  'propose_deal(supply): the most it can cost (54.000 EUR) is above the limit (50.000 EUR)');
select tests.throws_key(format('select public.propose_deal(gen_random_uuid(), %L, %L, null, %L, null)', 'stake', 'company',
  '{"amount_cents": 5000001, "share_bps": 1000, "hours": 24}'), 'deal_too_big',
  'propose_deal(stake, company): more than the limit of the own company');
select (public.propose_deal(gen_random_uuid(), 'supply', 'supplier', :'t_nick',
          '{"volume_cents_per_hour": 400000, "fee_bps": 5000, "prepay_bps": 0, "hours": 24}', null) ->> 'id') as sd1 \gset
select public.get_deals() -> 'limits' as slim \gset
reset role;
select tests.login_as('authenticated', :g);
select tests.throws_key(format('select public.propose_deal(gen_random_uuid(), %L, %L, %L, %L, null)', 'stake', 'investor', :'t_nick',
  '{"amount_cents": 6000000, "share_bps": 1000, "hours": 24}'), 'deal_too_big',
  'propose_deal(stake, investor): more than the limit of the targeted company');
select public.get_deals() -> 'limits' as glim \gset
reset role;
select tests.login_as('authenticated', :n);
select tests.throws_key(format('select public.propose_deal(gen_random_uuid(), %L, %L, %L, %L, null)', 'loan', 'lender', :'t_nick',
  '{"principal_cents": 100000, "interest_bps": 500, "hours": 48}'), 'locked', 'propose_deal(): deals from level 6 (ADR-100)');
reset role;
select tests.assert(
  :'slim'::jsonb = jsonb_build_object('company_deal_max_cents', 5000000, 'loan_max_cents', 6 * 2000000)
  and :'glim'::jsonb = '{"company_deal_max_cents": null, "loan_max_cents": 12000000}'::jsonb,
  'get_deals().limits: {company_deal_max_cents (null without a company), loan_max_cents = level x 20.000 EUR}');

-- a valuable company may offer more on the board; the accepting company must be valuable enough as well
select public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(:'sco'), 20000000,
  'transfer', 'Test-Kapital', 'company', :'sco', 'test:m4k:sco') is not null as ok \gset
select public.deal_size_limit_cents(:'sco') as slimit \gset
select tests.login_as('authenticated', :s);
select (public.propose_deal(gen_random_uuid(), 'supply', 'supplier', null,
          '{"volume_cents_per_hour": 1000000, "fee_bps": 3000, "prepay_bps": 0, "hours": 24}', null) ->> 'id') as sd2 \gset
reset role;
select tests.login_as('authenticated', :t);
select tests.throws_key(format('select public.respond_deal(gen_random_uuid(), %L, true)', :'sd2'), 'deal_too_big',
  'respond_deal(supply): 72.000 EUR at most are above the limit of the buyer''s company (50.000 EUR)');
reset role;
select public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(:'tco'), 15000000,
  'transfer', 'Test-Kapital', 'company', :'tco', 'test:m4k:tco') is not null as ok \gset
select tests.login_as('authenticated', :t);
select public.respond_deal(gen_random_uuid(), :'sd2', true) ->> 'status' as sd2s \gset
reset role;
select tests.assert(
  :slimit::bigint = (public.company_value_cents(:'sco') * 5000 / 10000) and :slimit::bigint > 7200000
  and :'sd2s' = 'active' and (select status from public.deals where id = :'sd1') = 'open',
  'a company worth more than 100.000 EUR offers a 72.000 EUR contract; accepted once the buyer''s company is worth it too');
-- a stake offered by a company whose value fell below the amount: refused at the acceptance
select public.ledger_transfer(public.company_cash_account(:'tco'), public.ledger_system_account('households'), 15000000,
  'transfer', 'Test-Leerung', 'company', :'tco', 'test:m4k:tco2') is not null as ok \gset
select public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(:'tco'), 15000000,
  'transfer', 'Test-Kapital', 'company', :'tco', 'test:m4k:tco3') is not null as ok \gset
select tests.login_as('authenticated', :t);
select (public.propose_deal(gen_random_uuid(), 'stake', 'company', null, '{"amount_cents": 7000000, "share_bps": 1000, "hours": 24}',
                            null) ->> 'id') as tk1 \gset
reset role;
select public.ledger_transfer(public.company_cash_account(:'tco'), public.ledger_system_account('households'), 15000000,
  'transfer', 'Test-Leerung', 'company', :'tco', 'test:m4k:tco4') is not null as ok \gset
select tests.fund(:k, 8000000, 'test:m4k:k2');
select tests.login_as('authenticated', :k);
select tests.throws_key(format('select public.respond_deal(gen_random_uuid(), %L, true)', :'tk1'), 'deal_too_big',
  'respond_deal(stake): the company''s value fell, the amount is above its limit now');
reset role;

-- =============================================================================
-- J. Org chart of a player company
-- =============================================================================
select tests.hire(:s, :e, 20000) as ejob \gset
select tests.login_as('authenticated', :s);
select public.get_company_org(:'sco') as org_s \gset
reset role;
select tests.login_as('authenticated', :e);
select public.get_company_org(:'sco') as org_e \gset
reset role;
select tests.login_as('authenticated', :g);
select public.get_company_org(:'sco') -> 'company' ->> 'id' = :'sco' as org_open \gset
select tests.assert(:'org_open'::boolean, 'get_company_org(): open to every player since ADR-125 (it only shows who works where)');
select tests.throws_key(format('select public.get_company_org(%L)', :'fco_old'), 'company_not_found',
  'get_company_org(): not for a closed company');
reset role;
select tests.assert(
  :'org_s'::jsonb -> 'company' = jsonb_build_object('id', :'sco', 'name', 'Sven Teile', 'tier', 'garage')
  and :'org_s'::jsonb -> 'founder' ->> 'nickname' = 'Sven_Liefert' and (:'org_s'::jsonb #>> '{founder,is_me}')::boolean
  and :'org_s'::jsonb -> 'founder' ? 'tag' and :'org_s'::jsonb -> 'founder' ? 'avatar_key'
  and jsonb_array_length(:'org_s'::jsonb -> 'members') = 1
  and :'org_s'::jsonb -> 'members' -> 0 ->> 'nickname' = 'Eva_Team' and :'org_s'::jsonb -> 'members' -> 0 ->> 'tier' = 'intern'
  and :'org_s'::jsonb -> 'members' -> 0 ->> 'title' = 'Werkstudium' and :'org_s'::jsonb -> 'members' -> 0 ? 'since'
  and not (:'org_s'::jsonb #>> '{members,0,is_me}')::boolean
  and (:'org_e'::jsonb #>> '{members,0,is_me}')::boolean and not (:'org_e'::jsonb #>> '{founder,is_me}')::boolean
  and (:'org_s'::jsonb ->> 'ai_workers')::int = 0 and :'org_s'::jsonb -> 'ai_worker_skills' = '[]'::jsonb,
  'get_company_org(): company, founder, members with tier and title, AI workers; for the founder and the employees');

-- =============================================================================
-- K. Presence at work (ADR-103): less pay after 24 h away, the job ends after 120 h
-- =============================================================================
-- p_away ago the player was last active, p_paid ago the job was last paid; one transaction, so one now()
create or replace function tests.m4k_away(p_job uuid, p_away interval, p_paid interval) returns void language sql as $$
  update public.profiles set last_active_at = now() - p_away where id = (select player_id from public.player_jobs where id = p_job);
  update public.player_jobs set last_paid_at = now() - p_paid, paid_day = (now() at time zone 'Europe/Berlin')::date,
         paid_minutes_today = 0
   where id = p_job $$;
create or replace function tests.m4k_last_pay(p_job uuid) returns public.salary_payouts language sql as $$
  select * from public.salary_payouts where player_job_id = p_job order by id desc limit 1 $$;
grant execute on all functions in schema tests to public;
select tests.assert(
  public.presence_pay_bps(0) = 10000 and public.presence_pay_bps(23.99) = 10000 and public.presence_pay_bps(24) = 7500
  and public.presence_pay_bps(47.5) = 7500 and public.presence_pay_bps(48) = 5000 and public.presence_pay_bps(72) = 2500
  and public.presence_pay_bps(500) = 2500 and public.cfg_num(public.presence_cfg(), '{fireAfterHours}', 0) = 120,
  'presencePayBps: full pay up to 24 h away, then 75 %, from 48 h 50 %, from 72 h 25 %; the job ends after 120 h');

select tests.login_as('authenticated', :w);
select x ->> 'id' as wpost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where x ->> 'tier' = 'intern' and (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean
 order by x ->> 'id' limit 1 \gset
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'wpost', 15000, null) ->> 'id')::uuid,
                            'M1 1 L2 2') is not null as ok \gset
select public.get_my_job() -> 'job' -> 'presence' as wp0 \gset
reset role;
select j.id as wjob, j.salary_cents_per_hour as wwage, c.name as wco
  from public.player_jobs j join public.companies c on c.id = j.company_id where j.player_id = :w and j.status = 'active' \gset
select tests.assert(
  (:'wp0'::jsonb ->> 'pay_bps')::int = 10000
  and (:'wp0'::jsonb ->> 'fire_at')::timestamptz - (:'wp0'::jsonb ->> 'last_active_at')::timestamptz = interval '120 hours'
  and (:'wp0'::jsonb ->> 'last_active_at')::timestamptz between public.game_now() - interval '10 minutes' and public.game_now(),
  'get_my_job(): presence {last_active_at (the last few minutes), pay_bps 10 000, fire_at 120 hours later}');

select tests.m4k_away(:'wjob', interval '1 hour', interval '60 minutes');
select public.accrue_job_salary(:'wjob', now()) as wpay0 \gset
select tests.m4k_away(:'wjob', interval '30 hours', interval '60 minutes');
select public.accrue_job_salary(:'wjob', now()) as wpay1 \gset
select (tests.m4k_last_pay(:'wjob')).xp_awarded as wxp1 \gset
select tests.m4k_away(:'wjob', interval '24 hours 30 minutes', interval '60 minutes');
select public.accrue_job_salary(:'wjob', now()) as wpay2 \gset
select tests.assert(
  :wpay0::bigint = :wwage::bigint and :wpay1::bigint = :wwage::bigint * 60 * 7500 / 600000
  and :wpay2::bigint = :wwage::bigint * 60 * 8750 / 600000
  and (tests.m4k_last_pay(:'wjob')).amount_cents = :wpay2::bigint
  and :wxp1::int = round(round(public.config_double('progression', '{xpSources,workHour,xp}', 40) * 0.75)
                         * public.config_double('progression', '{xpMultiplier}', 2))::int,
  'accrue_job_salary(): an hour 1 h after the last visit is paid fully, 30 h after at 75 % (work XP as well), '
  || 'the hour across the 24 h mark half and half (87.5 %)');

-- the player comes back after 30 hours: the absence is kept, an hour of it paid afterwards gets 75 %
update public.profiles set last_active_at = now() - interval '30 hours' where id = :w;
select tests.login_as('authenticated', :w);
select public.get_upgrades() is not null as ok \gset
reset role;
update public.player_jobs set last_paid_at = now() - interval '60 minutes', paid_day = (now() at time zone 'Europe/Berlin')::date,
       paid_minutes_today = 0
 where id = :'wjob';
select public.accrue_job_salary(:'wjob', now()) as wpay3 \gset
select tests.assert(
  (select last_active_at > now() - interval '1 minute' from public.profiles where id = :w)
  and exists (select 1 from public.player_absences a where a.player_id = :w
                 and a.away_until - a.away_from between interval '30 hours' and interval '30 hours 1 minute')
  and :wpay3::bigint = :wwage::bigint * 60 * 7500 / 600000,
  'a call marks the player active (require_player); the 30 hours away are recorded, an hour of them paid later gets 75 %');

-- AI job: away for more than 120 hours, the hourly accrual ends the job (paid up to the 120th hour at 25 %)
select tests.m4k_away(:'wjob', interval '121 hours', interval '2 hours');
select public.accrue_salaries(now()) is not null as ok \gset
select tests.assert(
  (select status = 'ended' and end_reason::text = 'absent' from public.player_jobs where id = :'wjob')
  and (tests.m4k_last_pay(:'wjob')).minutes_paid = 60
  and (tests.m4k_last_pay(:'wjob')).amount_cents = :wwage::bigint * 60 * 2500 / 600000
  and exists (select 1 from public.notifications n where n.player_id = :w and n.type_key = 'job_absent' and n.title = 'Gekündigt'
                 and n.body = 'Du warst 5 Tage nicht da. Dein Job bei ' || :'wco' || ' ist beendet.' and n.link = '/job'),
  'accrue_salaries(): after 120 hours away the AI job ends (absent), the last hour paid at 25 %; notification "Gekündigt"');

-- player company: the hourly close ends the job of an absent employee and tells the founder
select pay_factor_bps as sco_pf from public.player_companies where company_id = :'sco' \gset
select tests.m4k_away(:'ejob', interval '121 hours', interval '2 hours');
select public.player_company_close_hour(:'sco', date_trunc('hour', now()) - interval '1 hour') is not null as ok \gset
select tests.assert(
  (select status = 'ended' and end_reason::text = 'absent' from public.player_jobs where id = :'ejob')
  and (tests.m4k_last_pay(:'ejob')).amount_cents
      = 20000::bigint * 60 * 2500 / 600000 * :sco_pf::int / 10000
  and exists (select 1 from public.notifications n where n.player_id = :e and n.type_key = 'job_absent')
  and exists (select 1 from public.notifications n where n.player_id = :s and n.type_key = 'employee_absent'
                 and n.body = 'Eva_Team ist nicht mehr erschienen und wurde gekündigt.' and n.link = '/company')
  and exists (select 1 from public.company_messages m where m.company_id = :'sco' and m.kind = 'system'
                 and m.body = 'Eva_Team ist nicht mehr erschienen und wurde gekündigt.'),
  'player_company_close_hour(): an employee away for 120 hours loses the job (the company pays the last hour at 25 %), '
  || 'the founder is told');

-- coming back after 130 hours: the first call ends the job before the visit counts
select tests.login_as('authenticated', :r);
select x ->> 'id' as rpost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where x ->> 'tier' = 'intern' and (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean
 order by x ->> 'id' limit 1 \gset
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'rpost', 15000, null) ->> 'id')::uuid,
                            'M1 1 L3 3') is not null as ok \gset
reset role;
select id as rjob from public.player_jobs where player_id = :r and status = 'active' \gset
select tests.m4k_away(:'rjob', interval '130 hours', interval '11 hours');
select tests.login_as('authenticated', :r);
select public.get_my_job() -> 'job' as rj0 \gset
select public.get_my_job() -> 'job' as rj1 \gset
reset role;
select tests.assert(
  (select status = 'ended' and end_reason::text = 'absent' from public.player_jobs where id = :'rjob')
  and :'rj1'::jsonb = 'null'::jsonb and (tests.m4k_last_pay(:'rjob')).minutes_paid = 60
  and exists (select 1 from public.player_absences a where a.player_id = :r)
  and (select last_active_at > now() - interval '1 minute' from public.profiles where id = :r),
  'presence_touch(): after 130 hours away the next call ends the job (paid up to the 120th hour), then records the visit');

-- the paid hours a day: 8 without config (ADR-103), overtime on top
select value as careers0 from public.game_config where key = 'careers' \gset
update public.game_config set value = value #- '{paidHoursPerDayCap}' where key = 'careers';
select public.player_paid_hours_cap(:w) as cap_w \gset
select tests.set_cfg('careers', '{paidHoursPerDayCap}', '8');
update public.player_jobs set last_paid_at = now() - interval '60 minutes', paid_day = (now() at time zone 'Europe/Berlin')::date,
       paid_minutes_today = 450
 where id = :'ujob';
select public.job_payable_minutes(:'ujob', now()) as upm \gset
update public.game_config set value = :'careers0'::jsonb where key = 'careers';
select tests.assert(
  :cap_w::numeric = 8 and :upm::int = 30,
  'paid hours a day: careers.paidHoursPerDayCap falls back to 8; with 7.5 hours paid today half an hour is left');

-- =============================================================================
-- L. Grants, ledger
-- =============================================================================
select tests.assert(
  has_function_privilege('authenticated', 'public.check_artwork_title(text)', 'execute')
  and has_function_privilege('authenticated', 'public.found_company(uuid, text, text, text, text, text, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.check_artwork_title(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.deal_size_limit_cents(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.player_property_discount_bps(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.upgrade_stage_level(text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.artwork_title_taken(text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_company_org(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.presence_touch(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.job_absence_check(uuid, timestamptz)', 'execute')
  and not has_table_privilege('authenticated', 'public.player_absences', 'select')
  and (select count(*) from pg_proc where proname = 'found_company' and pronamespace = 'public'::regnamespace) = 1
  and not exists (select 1 from public.ledger_audit()),
  'grants: check_artwork_title, found_company and get_company_org for authenticated, helpers and player_absences internal; '
  || 'one found_company; ledger audit clean');
