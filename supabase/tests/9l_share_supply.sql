-- =============================================================================
-- 9l · Stocks have a supply: nobody holds more shares than exist (ADR-153)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''09c19c19-0000-4000-8000-0000000000f1'''
\set a '''09c19c19-0000-4000-8000-0000000000a1'''
\set b '''09c19c19-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:f, 'Float_Frida') is not null and tests.signup(:a, 'Float_Anton') is not null
   and tests.signup(:b, 'Float_Berta') is not null as ok \gset
select tests.set_level(:f, 10);
select tests.set_level(:a, 10);
select tests.set_level(:b, 10);
select tests.fund(:f, 1000000, 'test:9l:f');
select tests.fund(:a, 90000000, 'test:9l:a');
select tests.fund(:b, 90000000, 'test:9l:b');

-- a player company goes public; one player takes every offered share
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Knappwerk', 'Seltene Dinge', 'retail', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 20) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.login_as('authenticated', :a);
select (public.subscribe_offer(gen_random_uuid(), :'offer', 9000000000) ->> 'completed')::boolean as listed \gset
reset role;
select c.ticker as tkr, c.security_id as sec, c.shares_outstanding as so, c.id as fco
  from public.companies c join public.player_companies pc on pc.company_id = c.id where pc.founder_id = :f \gset
select tests.assert(
  :'listed'::boolean and :so::bigint = 1000000
  and public.security_free_float_e6(:'sec') = 0
  and (select public.security_free_float_e6(s.id) > 0 from public.securities s where s.ticker = 'KLS')
  and (select public.security_free_float_e6(s.id) is null from public.securities s where s.kind = 'bond' limit 1),
  'security_free_float_e6(): all shares are with players, so nothing is free; AI stocks have plenty, bonds no limit');

-- nothing left: a buy fails
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.place_order(gen_random_uuid(), %L, 'buy', 'market', 1000000)$$, :'tkr'), 'no_shares_left',
  'place_order(): no share left to buy (NX129)');
select tests.throws_key(format($$select public.place_order(gen_random_uuid(), %L, 'buy', 'market', null, null, 100000)$$, :'tkr'), 'no_shares_left',
  'place_order(): the same for a buy by amount');
reset role;

-- somebody sells: exactly these shares can be bought again, a bigger order gets what is there
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), :'tkr', 'sell', 'market', 2000000000) ->> 'status' as sold \gset
reset role;
select public.security_free_float_e6(:'sec') as float1 \gset
select tests.login_as('authenticated', :b);
select public.place_order(gen_random_uuid(), :'tkr', 'buy', 'market', 5000000000) as buy1 \gset
select tests.throws_key(format($$select public.place_order(gen_random_uuid(), %L, 'buy', 'market', 1000000)$$, :'tkr'), 'no_shares_left',
  'place_order(): after the float is bought, nothing is left again');
reset role;
select tests.assert(
  :'sold' = 'filled' and :float1::bigint = 2000000000
  and :'buy1'::jsonb ->> 'status' = 'filled'
  and tests.qty_e6(:b, :'tkr') = 2000000000
  and (select sum(p.quantity_e6) from public.positions p where p.security_id = :'sec' and p.status = 'open') = :so::bigint * 1000000
  and public.security_free_float_e6(:'sec') = 0,
  'a sale frees shares; a bigger buy order gets exactly what is free; players never hold more than exists');

-- new shares only through the founder: a capital increase
select tests.login_as('authenticated', :f);
select public.capital_increase(gen_random_uuid(), 10) -> 'company' -> 'listing' -> 'offer' ->> 'id' as ci \gset
reset role;
update public.player_companies set quality = 1 where company_id = :'fco';
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'ci';
select public.close_due_offers() is not null as ok \gset
select shares_outstanding as so2 from public.companies where id = :'fco' \gset
select tests.assert(:so2::bigint = 1100000 and public.security_free_float_e6(:'sec') = 100000000000,
  'capital increase: the new shares (taken by AI investors) are the new free float');

-- buying from the new float lowers it by exactly what was bought
select tests.login_as('authenticated', :a);
select public.place_order(gen_random_uuid(), :'tkr', 'buy', 'market', 5000000) as buy2 \gset
reset role;
select tests.assert(
  :'buy2'::jsonb ->> 'status' = 'filled'
  and public.security_free_float_e6(:'sec') = 100000000000 - 5000000
  and (select sum(p.quantity_e6) from public.positions p where p.security_id = :'sec' and p.status = 'open') <= :so2::bigint * 1000000,
  'a buy lowers the free float by what was bought');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds');
-- keep the market snapshot of the fixtures at the AI stocks
update public.securities set status = 'delisted', delisted_at = now() where id = :'sec';
