-- =============================================================================
-- e6 · Weltkarte (ADR-208): the gate at 10 Mio. € company value, the HQ price to the treasury (idempotent), upgrade
--      prices and seats, the subsidiary gate, the same-country rule and the hard cap, the market leader's fee bounded
--      by maxFeeBps and paid to the leader in the close, the country terms in the close (goods and fixed costs), the
--      relocation cooldown and price, image campaigns, the map with all players, the money invariant.
--      Four players: Anna and Bruno in Germany, Clara in China, Dora not placed.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0e6e6e6e-0000-4000-8000-0000000000a1'''
\set b '''0e6e6e6e-0000-4000-8000-0000000000b1'''
\set c '''0e6e6e6e-0000-4000-8000-0000000000c1'''
\set d '''0e6e6e6e-0000-4000-8000-0000000000d1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:a, 'Wk_Anna') is not null and tests.signup(:b, 'Wk_Bruno') is not null
   and tests.signup(:c, 'Wk_Clara') is not null and tests.signup(:d, 'Wk_Dora') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 20);
select tests.set_level(:b, 20);
select tests.set_level(:c, 20);
select tests.set_level(:d, 20);
select tests.fund(:a, 90000000, 'test:e6:a');
select tests.fund(:b, 90000000, 'test:e6:b');
select tests.fund(:c, 90000000, 'test:e6:c');
select tests.fund(:d, 90000000, 'test:e6:d');
select tests.set_cfg('startups', '{demandNoise}', '0') is null as ok \gset

select tests.assert((value ->> 'unlockWorthCents')::bigint = 1000000000
                    and jsonb_array_length(value -> 'countries') between 15 and 25
                    and jsonb_array_length(value -> 'hqTiers') = 5
                    and (value #>> '{hqTiers,0,costCents}')::bigint = 100000000
                    and (value #>> '{lobby,maxFeeBps}')::integer = 300,
  'e6: config world (15..25 countries, 5 tiers, HQ 1 Mio. €, fee at most 3 %)') from public.game_config where key = 'world';
select tests.assert(public.country_cfg('de') ->> 'name' = 'Deutschland' and public.country_cfg('xx') is null,
  'e6: country_cfg knows Germany and nothing else');

select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Welt Anna', 'Global', 'tech', '#224466', 'garage') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :b);
select public.found_company(gen_random_uuid(), 'Welt Bruno', 'Global', 'tech', '#446622', 'garage') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select public.found_company(gen_random_uuid(), 'Welt Clara', 'Global', 'tech', '#662244', 'garage') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :d);
select public.found_company(gen_random_uuid(), 'Welt Dora', 'Global', 'tech', '#226644', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:a) as aco \gset
select tests.company_of(:b) as bco \gset
select tests.company_of(:c) as cco \gset
select tests.company_of(:d) as dco \gset
update public.player_companies set potential_annual_cents = 30000000, quality = 0.5, awareness = 0.3, reputation = 50,
                                   task_momentum = 1, marketing_cents_per_quarter = 0
 where company_id in (:'aco', :'bco', :'cco', :'dco');
select tests.set_company_cash(:'aco', 500000000);
select tests.money_invariant() = 'ok' as inv0 \gset

-- ---------------------------------------------------------------------------
-- 1. The gate at 10 Mio. € and the HQ price
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :a);
select public.get_world() as w0 \gset
select tests.throws_key($$select public.world_place_hq(gen_random_uuid(), 'de')$$, 'world_locked',
  'e6: below 10 Mio. € company value there is no headquarters');
reset role;
select tests.assert(:'w0'::jsonb -> 'me' = 'null'::jsonb and (:'w0'::jsonb #>> '{company,worth_cents}')::bigint < 1000000000
                    and (:'w0'::jsonb ->> 'unlock_worth_cents')::bigint = 1000000000,
  'e6: get_world shows the gate and the own value');
select tests.set_company_cash(:'aco', 6000000000);
select tests.set_company_cash(:'bco', 2000000000);
select tests.set_company_cash(:'cco', 2000000000);
select tests.set_company_cash(:'dco', 2000000000);
select tests.treasury() as t0 \gset
select tests.company_cash(:'aco') as ca0 \gset
select max_employees as seats0 from public.companies where id = :'aco' \gset
\set rq '''0e6e6e6e-1111-4000-8000-000000000001'''
select tests.login_as('authenticated', :a);
select public.world_place_hq(:rq, 'de') as p1 \gset
select public.world_place_hq(:rq, 'de') as p1b \gset
select tests.throws_key($$select public.world_place_hq(gen_random_uuid(), 'fr')$$, 'world_placed',
  'e6: one headquarters per company');
select tests.throws_key($$select public.world_place_hq(gen_random_uuid(), 'atlantis')$$, 'invalid_argument',
  'e6: unknown countries are refused');
reset role;
select tests.assert(:'p1'::jsonb = :'p1b'::jsonb and (:'p1'::jsonb #>> '{me,country}') = 'de'
                    and (:'p1'::jsonb #>> '{me,hq_tier}')::integer = 1
                    and tests.company_cash(:'aco') = :ca0::bigint - 100000000
                    and tests.treasury() = :t0::bigint + 100000000
                    and public.company_country(:'aco') = 'de'
                    and (select count(*) from public.ledger_transactions where idempotency_key like 'world:hq:' || :'aco' || ':%') = 1,
  'e6: the HQ costs 1 Mio. € once (idempotent), company cash to the treasury');
select tests.assert((select max_employees from public.companies where id = :'aco') = :seats0::integer + 5,
  'e6: the office building brings 5 seats');

-- ---------------------------------------------------------------------------
-- 2. Upgrades: exponential prices, seats, the last tier
-- ---------------------------------------------------------------------------
select tests.company_cash(:'aco') as ca1 \gset
select tests.login_as('authenticated', :a);
select public.world_upgrade_hq(gen_random_uuid()) as u2 \gset
reset role;
select tests.assert((:'u2'::jsonb #>> '{me,hq_tier}')::integer = 2 and tests.company_cash(:'aco') = :ca1::bigint - 400000000
                    and (select max_employees from public.companies where id = :'aco') = :seats0::integer + 20
                    and (:'u2'::jsonb #>> '{me,next_tier_cost_cents}')::bigint = 1500000000
                    and (select invested_cents from public.company_locations where company_id = :'aco') = 500000000,
  'e6: tier 2 costs 4 Mio. €, adds 15 seats; tier 3 would cost 15 Mio. €');
select tests.assert((select bool_and((public.world_hq_tier_cfg(n + 1) ->> 'costCents')::bigint
                                     >= 3 * (public.world_hq_tier_cfg(n) ->> 'costCents')::bigint) from generate_series(1, 4) n),
  'e6: every tier costs at least three times the one before');

-- ---------------------------------------------------------------------------
-- 3. Subsidiaries: the gate, the HQ country, the cap
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :b);
select public.world_place_hq(gen_random_uuid(), 'de') is not null as ok \gset
select tests.throws_key($$select public.world_open_subsidiary(gen_random_uuid(), 'pl')$$, 'world_subsidiary_locked',
  'e6: a small company (tier 1, below 50 Mio. €) opens no subsidiary');
reset role;
select tests.login_as('authenticated', :c);
select public.world_place_hq(gen_random_uuid(), 'cn') is not null as ok \gset
reset role;
select tests.company_cash(:'aco') as ca2 \gset
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.world_open_subsidiary(gen_random_uuid(), 'de')$$, 'world_same_country',
  'e6: no subsidiary in the HQ country');
select public.world_open_subsidiary(gen_random_uuid(), 'vn') as s1 \gset
select public.world_open_subsidiary(gen_random_uuid(), 'us') as s2 \gset
select tests.throws_key($$select public.world_open_subsidiary(gen_random_uuid(), 'vn')$$, 'world_same_country',
  'e6: one subsidiary per country');
reset role;
select tests.assert(tests.company_cash(:'aco') = :ca2::bigint - 300000000 - 480000000
                    and jsonb_array_length(:'s2'::jsonb #> '{me,subsidiaries}') = 2,
  'e6: subsidiaries cost 3 Mio. €, then 4.8 Mio. € (growing setup price)');
insert into public.company_subsidiaries (company_id, country_key, setup_cost_cents)
values (:'aco', 'mx', 0), (:'aco', 'in', 0);
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.world_open_subsidiary(gen_random_uuid(), 'br')$$, 'world_subsidiary_cap',
  'e6: at most four subsidiaries');
reset role;
delete from public.company_subsidiaries where company_id = :'aco' and country_key in ('mx', 'in', 'us');
-- ramped up: a share of the revenue at Vietnam's terms (cheaper goods), the running costs at x 1
update public.company_subsidiaries set opened_at = public.game_now() - interval '30 days' where company_id = :'aco';
select public.world_hour_effect(:'aco', public.game_now()) as ea \gset
select tests.assert(tests.near((:'ea'::jsonb ->> 'subsidiary_share')::float8, 0.15)
                    and tests.near((:'ea'::jsonb ->> 'cogs_factor')::float8, 0.85 * 1.1 + 0.15 * 0.78)
                    and public.world_subsidiary_hourly_cost(1000) = 60000 and public.world_subsidiary_hourly_cost(0) = 180000,
  'e6: a ramped-up subsidiary takes 15 % of the revenue at its terms; running costs fall from x 3 to x 1');

-- ---------------------------------------------------------------------------
-- 4. Lobby: the leader of Germany asks a bounded fee, Bruno pays it in the close
-- ---------------------------------------------------------------------------
select tests.assert(public.country_market_leader('de') = :'aco'::uuid and public.company_is_market_leader(:'aco')
                    and not public.company_is_market_leader(:'bco') and public.country_market_leader('fr') is null,
  'e6: the largest company of a country leads it');
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.world_set_location_fee(gen_random_uuid(), 100)$$, 'world_not_leader',
  'e6: only the market leader sets a fee');
reset role;
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.world_set_location_fee(gen_random_uuid(), 301)$$, 'invalid_argument',
  'e6: the fee never exceeds 3 %');
select public.world_set_location_fee(gen_random_uuid(), 300) is not null as ok \gset
select tests.throws_key($$select public.world_set_location_fee(gen_random_uuid(), 200)$$, 'locked',
  'e6: the fee changes at most once a day');
reset role;
select tests.assert(exists (select 1 from public.notifications n where n.player_id = :b and n.type_key = 'world_location'),
  'e6: Bruno hears about the fee');
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) - interval '1 hour'
 where company_id in (:'bco', :'cco', :'dco');
select tests.company_cash(:'aco') as ca3 \gset
select public.player_company_close_hour(:'bco', date_trunc('hour', public.game_now()) - interval '1 hour') is not null as ok \gset
select h.revenue_cents as brev from public.player_company_hours h
 where h.company_id = :'bco' and h.hour_start = date_trunc('hour', public.game_now()) - interval '1 hour' \gset
select coalesce(sum(-e.amount_cents), 0) as bfee from public.ledger_transactions t
  join public.ledger_entries e on e.transaction_id = t.id and e.account_id = public.company_cash_account(:'bco')
 where t.idempotency_key like 'pch:' || :'bco' || ':%:world:fee' \gset
select tests.assert(:brev::bigint > 0 and :bfee::bigint > 0 and :bfee::bigint <= :brev::bigint * 300 / 10000
                    and tests.company_cash(:'aco') = :ca3::bigint + :bfee::bigint
                    and (select fees_paid_cents from public.company_locations where company_id = :'bco') = :bfee::bigint,
  format('e6: Bruno pays %s of %s revenue (at most 3 %%) to the leader', :bfee, :brev));

-- ---------------------------------------------------------------------------
-- 5. Country terms in the close: China (goods x 0.84, fixed x 0.88) against an unplaced company
-- ---------------------------------------------------------------------------
select tests.assert(tests.near((public.listed_hour_effect(:'cco', public.game_now()) #>> '{world,cogs_factor}')::float8, 0.84)
                    and tests.near((public.listed_hour_effect(:'cco', public.game_now()) #>> '{world,fixed_factor}')::float8, 0.88)
                    and public.listed_hour_effect(:'dco', public.game_now()) -> 'world' is null,
  'e6: China''s terms are part of the hour, an unplaced company has none');
select public.player_company_close_hour(:'cco', date_trunc('hour', public.game_now()) - interval '1 hour') is not null as ok \gset
select public.player_company_close_hour(:'dco', date_trunc('hour', public.game_now()) - interval '1 hour') is not null as ok \gset
select hc.fixed_cents::float8 / greatest(1, hd.fixed_cents) as fratio
  from public.player_company_hours hc, public.player_company_hours hd
 where hc.company_id = :'cco' and hd.company_id = :'dco'
   and hc.hour_start = date_trunc('hour', public.game_now()) - interval '1 hour' and hd.hour_start = hc.hour_start \gset
select tests.assert(:fratio::float8 > 0.86 and :fratio::float8 < 0.90,
  format('e6: the close takes China''s labour costs (fixed costs x %s)', :fratio));
select tests.assert(public.world_tax_rate_bps(:'cco') = 2500 and public.world_tax_rate_bps(:'dco') is null
                    and public.world_tax_rate_bps(:'aco') < (public.country_cfg('de') ->> 'taxRateBps')::integer,
  'e6: tax rate of the country; the leader gets the lobby discount');

-- ---------------------------------------------------------------------------
-- 6. Relocation and image campaigns
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.world_relocate_hq(gen_random_uuid(), 'fr')$$, 'locked',
  'e6: no move during the cooldown');
reset role;
update public.company_locations set placed_at = public.game_now() - interval '8 days' where company_id = :'aco';
select tests.company_cash(:'aco') as ca4 \gset
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.world_relocate_hq(gen_random_uuid(), 'vn')$$, 'world_same_country',
  'e6: no move into a country with an own subsidiary');
select public.world_relocate_hq(gen_random_uuid(), 'fr') as m1 \gset
select public.world_image_campaign(gen_random_uuid(), 'fr') as i1 \gset
select tests.throws_key($$select public.world_image_campaign(gen_random_uuid(), 'fr')$$, 'locked',
  'e6: one image campaign per country and cooldown');
select tests.throws_key($$select public.world_image_campaign(gen_random_uuid(), 'jp')$$, 'world_not_placed',
  'e6: image campaigns only where the company is');
select public.world_save_hq_style(gen_random_uuid(), '{"wall": 3, "roof": 99, "roofKind": "dome", "deco": "<script>", "flag": false}') as st \gset
reset role;
select tests.assert((:'m1'::jsonb #>> '{me,country}') = 'fr'
                    and (:'i1'::jsonb #>> '{me,image,fr,bonus_bps}')::float8 = 500
                    and :'st'::jsonb #> '{me,hq_style}' = '{"wall": 3, "roof": 7, "sign": 0, "roofKind": "dome", "deco": "none", "flag": false}'::jsonb,
  'e6: moved to France, image +5 % there, the style is clamped to the options');
select tests.assert(tests.company_cash(:'aco') < :ca4::bigint - 50000000
                    and public.country_market_leader('de') = :'bco'::uuid,
  'e6: the move costs at least 0.5 Mio. €; Germany has a new leader and the old fee lapses');
select tests.assert(not exists (select 1 from public.country_lobby where country_key = 'de' and leader_company_id = :'bco'),
  'e6: the old leader''s fee does not pass to the next leader');

-- ---------------------------------------------------------------------------
-- 7. The map shows everyone; money stays whole
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :d);
select public.get_world() as wd \gset
select tests.throws_key($$select public.world_upgrade_hq(gen_random_uuid())$$, 'world_not_placed',
  'e6: no upgrade without a headquarters');
reset role;
select tests.assert((select count(*) from jsonb_array_elements(:'wd'::jsonb -> 'places') p
                      where p ->> 'company_id' in (:'aco', :'bco', :'cco') and p ->> 'kind' = 'hq') = 3
                    and (select count(*) from jsonb_array_elements(:'wd'::jsonb -> 'places') p
                          where p ->> 'company_id' = :'aco' and p ->> 'kind' = 'subsidiary') = 1
                    and (select bool_and(not (p ->> 'leader')::boolean) from jsonb_array_elements(:'wd'::jsonb -> 'places') p
                          where p ->> 'kind' = 'ai')
                    and :'wd'::jsonb -> 'me' = 'null'::jsonb,
  'e6: Dora sees every headquarters and subsidiary on the map; AI companies never lead');
select tests.assert(:'inv0'::boolean and tests.money_invariant() = 'ok', 'e6: the money invariant holds');
