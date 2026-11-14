-- =============================================================================
-- 94 · No profit from moving the price oneself (ADR-126)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''09409409-0000-4000-8000-0000000000a1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Paul_Pumpe') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.fund(:a, 50000000, 'test:pump:a');
update public.sim_runtime set is_paused = false;

begin;
-- the game's tuning: strong player impact (ADR-120), no noise
update public.game_config
   set value = jsonb_set(jsonb_set(jsonb_set(value, '{playerImpact,depthCentsPer100Bps}',
                                   '{"bluechip": 2000000, "midcap": 500000, "penny": 100000}'), '{maxTickReturnBps}', '1000'),
                         '{playerImpact,maxHoldingsPremium}', '0.15')
 where key = 'trading';
select tests.set_cfg('aiInvestors', '{tickNoiseScale}', '0');
select s.ticker as tkr, s.id as sec from public.securities s join public.companies c on c.id = s.company_id
 where s.kind = 'stock' and s.status = 'listed' and c.tier = 'penny' order by s.ticker limit 1 \gset
select tests.neutral(:'sec');
select tests.cash(:a) as c0 \gset
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), :'tkr', 'buy', 'market', null, null, 1000000) as buy \gset
reset role;
select (tests.run_ticks(:'sec', public.game_now(), 1))[1] as r1 \gset
select coalesce(sum(p.quantity_e6 - p.reserved_quantity_e6), 0) as q1 from public.positions p
 where p.player_id = :a and p.security_id = :'sec' and p.status = 'open' \gset
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), :'tkr', 'sell', 'market', :q1::bigint) as sell \gset
reset role;
select tests.cash(:a) as c1 \gset
select tests.assert(:r1::double precision > 0.05,
  'the buy of 10.000 EUR lifts the penny stock ' || :'tkr' || ' at the next tick (' || round(:r1::numeric * 100, 1) || ' %)');
select tests.assert(:c1::bigint < :c0::bigint,
  'buy, one tick, sell: no profit from the own price move (' || ((:c1::bigint - :c0::bigint) / 100.0) || ' EUR)');

-- buy big, hold while the value funds react to the own holding, then sell
update public.game_config
   set value = jsonb_set(value, '{playerImpact,maxHoldingsPremium}',
                         to_jsonb(public.config_double('trading', '{playerImpact,maxHoldingsPremium}', 0.15)))
 where key = 'trading';
select tests.neutral(:'sec');
select tests.cash(:a) as h0 \gset
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), :'tkr', 'buy', 'market', null, null, 1400000) as buy2 \gset
reset role;
select (select sum(x) from unnest(tests.run_ticks(:'sec', public.game_now() + interval '1 minute', 60)) x) as g60 \gset
select coalesce(sum(p.quantity_e6 - p.reserved_quantity_e6), 0) as q2 from public.positions p
 where p.player_id = :a and p.security_id = :'sec' and p.status = 'open' \gset
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), :'tkr', 'sell', 'market', :q2::bigint) is not null as ok \gset
reset role;
select tests.cash(:a) as h1 \gset
select tests.assert(:h1::bigint < :h0::bigint,
  'buy 14.000 EUR, hold 60 ticks, sell: no profit from the own holding (' || ((:h1::bigint - :h0::bigint) / 100.0)
  || ' EUR, price moved ' || round(:g60::numeric * 100, 1) || ' % while held)');
rollback;
