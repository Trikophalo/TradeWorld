-- =============================================================================
-- 65 · M3f: logos and reports, quit at once, founders with a job, GmbH,
--      IPO with subscription, capital increase
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''0f3f3f3f-0000-4000-8000-0000000000f1'''
\set r1 '''0f3f3f3f-0000-4000-8000-0000000000a1'''
\set r2 '''0f3f3f3f-0000-4000-8000-0000000000a2'''
\set r3 '''0f3f3f3f-0000-4000-8000-0000000000a3'''
select tests.signup(:f, 'Fenja_Firma') is not null and tests.signup(:r1, 'Rolf_Eins') is not null
   and tests.signup(:r2, 'Rita_Zwei') is not null and tests.signup(:r3, 'Rudi_Drei') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 15);
select tests.set_level(:r1, 6);
select tests.set_level(:r2, 6);
select tests.set_level(:r3, 6);
select tests.fund(:f, 20000000, 'test:m3f:f');
select tests.fund(:r1, 5000000, 'test:m3f:r1');
select tests.fund(:r2, 5000000, 'test:m3f:r2');
select tests.fund(:r3, 5000000, 'test:m3f:r3');
\set logo '''{"palette": ["#112233", "#ffcc00"], "grid": ["................", "................", "....00000000....", "....01111110....", "....01111110....", "....00000000....", "................", "................", "................", "................", "................", "................", "................", "................", "................", "................"]}'''

-- =============================================================================
-- A. Logos (ADR-065)
-- =============================================================================
select tests.assert(
  public.logo_valid(:logo::jsonb)
  and not public.logo_valid(jsonb_set(:logo::jsonb, '{palette,0}', '"#AABBCC"'))
  and not public.logo_valid(jsonb_set(:logo::jsonb, '{palette}', '["#000000","#000001","#000002","#000003","#000004","#000005","#000006"]'))
  and not public.logo_valid(jsonb_set(:logo::jsonb, '{grid,0}', '"..............."'))
  and not public.logo_valid(jsonb_set(:logo::jsonb, '{grid,0}', '"2..............."'))
  and not public.logo_valid(jsonb_set(:logo::jsonb, '{grid}', (select jsonb_agg(case when n = 3 then '....0000000.....' else '................' end) from generate_series(1, 16) n)))
  and not public.logo_valid('{"palette": ["#112233"]}'),
  'logo_valid(): like isValidLogo (lowercase hex, at most 6 colours, 16 x 16, indices of the palette, at least 8 pixels)');

-- =============================================================================
-- C. Founders with a job (ADR-066)
-- =============================================================================
select tests.login_as('authenticated', :f);
select x ->> 'id' as fpost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean order by x ->> 'id' limit 1 \gset
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'fpost', null, null) ->> 'id')::uuid, 'M1 1')
       is not null as ok \gset
select public.found_company(gen_random_uuid(), 'Fenja Pixel', 'Logos für Vereine', 'tech', '#123456', 'garage') -> 'company' as fc \gset
select tests.throws_key($$select public.set_company_logo(gen_random_uuid(), '{"palette": ["#000000"], "grid": []}')$$,
  'invalid_argument', 'set_company_logo(): invalid logo');
select public.set_company_logo(gen_random_uuid(), :logo::jsonb) -> 'company' as fl \gset
select tests.throws_key(format($$select public.report_company_logo(gen_random_uuid(), %L)$$, :'fc'::jsonb ->> 'id'),
  'invalid_argument', 'report_company_logo(): not the own logo');
select public.get_my_job() -> 'job' as fj \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.assert(
  (:'fc'::jsonb ->> 'founder_has_job')::boolean and (:'fc'::jsonb ->> 'full_time_from')::int = 5
  and (:'fc'::jsonb ->> 'headcount')::int = 0 and (:'fc'::jsonb ->> 'founder_productivity_bps')::int = 7500
  and :'fc'::jsonb -> 'logo' = 'null'::jsonb and not (:'fc'::jsonb ->> 'logo_hidden')::boolean
  and :'fl'::jsonb -> 'logo' = :logo::jsonb
  and (:'fj'::jsonb ->> 'quit_now_cost_cents')::bigint = (:'fj'::jsonb ->> 'salary_cents_per_hour')::bigint * 12,
  'found_company() while employed; the founder works at half productivity (founderFactor); set_company_logo(); quit_now_cost_cents');

-- logo everywhere a company goes to the client; reports hide it
select tests.login_as('authenticated', :r1);
select public.get_market_snapshot() -> 'securities' -> 0 as snap0 \gset
select public.report_company_logo(gen_random_uuid(), :'fco') as rep1 \gset
select public.report_company_logo(gen_random_uuid(), :'fco') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :r2);
select public.report_company_logo(gen_random_uuid(), :'fco') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_my_company() -> 'company' as fc2 \gset
reset role;
select tests.login_as('authenticated', :r3);
select public.report_company_logo(gen_random_uuid(), :'fco') is not null as ok \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_my_company() -> 'company' as fc3 \gset
select public.set_company_logo(gen_random_uuid(), jsonb_set(:logo::jsonb, '{palette,1}', '"#00ff00"')) -> 'company' as fc4 \gset
reset role;
select tests.assert(
  :'rep1'::jsonb = '{"reported": true}'::jsonb
  and :'snap0'::jsonb ->> 'company_kind' = 'ai' and :'snap0'::jsonb -> 'logo' = 'null'::jsonb
  and :'fc2'::jsonb -> 'logo' = :logo::jsonb
  and :'fc3'::jsonb -> 'logo' = 'null'::jsonb and (:'fc3'::jsonb ->> 'logo_hidden')::boolean
  and not (:'fc4'::jsonb ->> 'logo_hidden')::boolean and :'fc4'::jsonb -> 'logo' -> 'palette' ->> 1 = '#00ff00'
  and public.company_json(:'fco') -> 'logo' -> 'palette' ->> 1 = '#00ff00'
  and (public.company_json((select company_id from public.player_jobs where player_id = :f and status = 'active')) -> 'logo') = 'null'::jsonb,
  'reports: one per player and logo, the third hides it; a new logo is visible again; company objects and the snapshot carry logo and kind');

-- =============================================================================
-- B. Quit at once
-- =============================================================================
select company_id as fjco, salary_cents_per_hour as fwage from public.player_jobs where player_id = :f and status = 'active' \gset
select tests.company_cash(:'fjco') as jcc \gset
select tests.cash(:f) as fcash \gset
select tests.login_as('authenticated', :f);
select public.quit_job(gen_random_uuid()) ->> 'notice_ends_at' as fnotice \gset
select public.quit_job(gen_random_uuid(), true) as fq \gset
select public.get_my_job() as fj2 \gset
reset role;
select tests.assert(
  :'fnotice' is not null
  and :'fq'::jsonb = jsonb_build_object('ended', true, 'paid_cents', :fwage::bigint * 12)
  and :'fj2'::jsonb = '{"job": null}'::jsonb
  and tests.company_cash(:'fjco') >= :jcc::bigint + :fwage::bigint * 12
  and tests.cash(:f) <= :fcash::bigint - :fwage::bigint * 12 + 2 * :fwage::bigint
  and (select end_reason = 'quit' from public.player_jobs where player_id = :f order by started_at desc limit 1),
  'quit_job(p_immediate): also during a notice; quitNowCostHours x wage to the employer, the job ends at once');
select tests.login_as('authenticated', :r1);
select x ->> 'id' as rpost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where (x ->> 'eligible')::boolean and (x -> 'company' ->> 'is_ai')::boolean order by x ->> 'id' limit 1 \gset
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'rpost', null, null) ->> 'id')::uuid, 'M1 1')
       is not null as ok \gset
reset role;
select public.ledger_transfer(public.ledger_player_account(:r1, 'player_cash'), public.ledger_system_account('households'),
  tests.cash(:r1), 'transfer', 'Test: leeren', 'player', :r1, 'test:m3f:r1drain') is not null as ok \gset
select tests.login_as('authenticated', :r1);
select tests.throws_key($$select public.quit_job(gen_random_uuid(), true)$$, 'insufficient_funds', 'quit_job(p_immediate): needs the money');
reset role;

-- full time from 5 people: the founder gives notice at the other job
select tests.login_as('authenticated', :f);
select public.sign_contract(gen_random_uuid(), (public.apply_for_job(gen_random_uuid(), :'fpost', null, null) ->> 'id')::uuid, 'M1 1')
       is not null as ok \gset
select public.upgrade_company(gen_random_uuid()) -> 'company' ->> 'tier' as up1 \gset
select public.set_ai_workers(gen_random_uuid(), 4) -> 'company' as h4 \gset
reset role;
select notice_ends_at is null as nonotice from public.player_jobs where player_id = :f and status = 'active' \gset
select tests.login_as('authenticated', :f);
select public.set_ai_workers(gen_random_uuid(), 5) -> 'company' as h5 \gset
reset role;
select tests.assert(
  :'up1' = 'small_business' and (:'h4'::jsonb ->> 'headcount')::int = 4 and :'nonotice'::boolean
  and (:'h5'::jsonb ->> 'headcount')::int = 5
  and (select notice_ends_at > now() + interval '23 hours' from public.player_jobs where player_id = :f and status = 'active')
  and exists (select 1 from public.company_messages where company_id = :'fco'
                and body = 'Ab 5 Mitarbeitern arbeitet Fenja_Firma Vollzeit in der Firma.'),
  'from 5 people (players + AI workers) the founder works full time: notice at the other job, chat line');
select tests.login_as('authenticated', :f);
select public.quit_job(gen_random_uuid(), true) is not null as ok \gset
select tests.throws_key(format($$select public.sign_contract(gen_random_uuid(), %L, 'M1 1')$$,
  public.apply_for_job(gen_random_uuid(), :'fpost', null, null) ->> 'id'),
  'owns_company', 'sign_contract(): no job for founders of companies with 5 or more people');
reset role;

-- =============================================================================
-- D. GmbH
-- =============================================================================
select tests.cash(:f) as fc0 \gset
select tests.login_as('authenticated', :f);
select public.get_my_company() -> 'company' as sbc \gset
select public.upgrade_company(gen_random_uuid()) -> 'company' as gm \gset
select tests.throws_key($$select public.upgrade_company(gen_random_uuid())$$, 'company_upgrade_unavailable', 'the AG only by an IPO');
reset role;
select tests.assert(
  (:'sbc'::jsonb ->> 'upgrade_cost_cents')::bigint = 4500000 and (:'sbc'::jsonb ->> 'can_upgrade')::boolean
  and :'gm'::jsonb ->> 'tier' = 'gmbh' and (:'gm'::jsonb ->> 'max_employees')::int = 20
  and :'gm'::jsonb -> 'upgrade_cost_cents' = 'null'::jsonb and not (:'gm'::jsonb ->> 'can_upgrade')::boolean
  and tests.cash(:f) = :fc0::bigint - 4500000
  and (select legal_form = 'gmbh' and max_employees = 20 from public.companies where id = :'fco'),
  'upgrade_company(): small business -> GmbH for the founding cost difference (45.000 EUR), 20 places');

-- =============================================================================
-- E. IPO with subscription
-- =============================================================================
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.go_public(gen_random_uuid(), 5)$$, 'invalid_argument', 'go_public(): at least minSharePercent');
select public.go_public(gen_random_uuid(), 30) -> 'company' as ipo \gset
select tests.throws_key($$select public.go_public(gen_random_uuid(), 30)$$, 'already_listed', 'go_public(): only once');
select tests.throws_key(format($$select public.subscribe_offer(gen_random_uuid(), %L, 10000)$$, :'ipo'::jsonb -> 'listing' -> 'offer' ->> 'id'),
  'invalid_argument', 'subscribe_offer(): not the founder');
reset role;
select (:'ipo'::jsonb -> 'listing' -> 'offer' ->> 'id') as offer \gset
select tests.cash(:r2) as r2c \gset
select tests.company_cash(:'fco') as cc0 \gset
select tests.login_as('authenticated', :r2);
select public.get_offers() as offers \gset
select public.subscribe_offer(gen_random_uuid(), :'offer', 50050) as sub \gset
reset role;
select tests.login_as('authenticated', :r3);
select public.subscribe_offer(gen_random_uuid(), :'offer', 20000) is not null as ok \gset
reset role;
select tests.assert(
  :'ipo'::jsonb -> 'listing' ->> 'status' = 'subscription' and :'ipo'::jsonb -> 'listing' -> 'ticker' = 'null'::jsonb
  and (:'ipo'::jsonb -> 'listing' ->> 'shares_total_e6')::bigint = 1000000000000
  and (:'ipo'::jsonb -> 'listing' ->> 'founder_shares_e6')::bigint = 700000000000
  and (:'ipo'::jsonb -> 'listing' -> 'offer' ->> 'shares_offered_e6')::bigint = 300000000000
  and (:'ipo'::jsonb -> 'listing' -> 'offer' ->> 'price_cents')::bigint = greatest(100, round((:'ipo'::jsonb ->> 'value_cents')::numeric / 1000000))
  and (:'ipo'::jsonb -> 'listing' -> 'offer') ?& array['id', 'kind', 'company', 'ticker', 'price_cents', 'shares_offered_e6',
        'shares_subscribed_e6', 'ends_at', 'status', 'my_shares_e6', 'value_cents', 'last_quarter']
  and (:'ipo'::jsonb -> 'listing' -> 'offer' -> 'company') ?& array['id', 'name', 'color', 'logo', 'sector', 'product_key', 'stage']
  and not (:'ipo'::jsonb ->> 'can_go_public')::boolean
  and exists (select 1 from jsonb_array_elements(:'offers'::jsonb -> 'offers') x where x ->> 'id' = :'offer')
  and (:'sub'::jsonb ->> 'shares_e6')::bigint = 500500000 and (:'sub'::jsonb ->> 'amount_cents')::bigint = 50050
  and (:'sub'::jsonb -> 'offer' ->> 'my_shares_e6')::bigint = 500500000
  and tests.cash(:r2) = :r2c::bigint - 50050 and tests.company_cash(:'fco') = :cc0::bigint + 50050 + 20000,
  'go_public(30 %): subscription at the issue price; subscribe_offer() buys fractional shares, the money goes to the company');

-- end of the subscription
create or replace function tests.qty_e6(p_player uuid, p_ticker text) returns bigint language sql as $$
  select coalesce(sum(p.quantity_e6), 0)::bigint from public.positions p join public.securities s on s.id = p.security_id
   where p.player_id = p_player and s.ticker = p_ticker and p.status = 'open' $$;
grant execute on function tests.qty_e6(uuid, text) to public;
select (select price_cents from public.company_share_offers where id = :'offer') as iprice \gset
select balance_cents as mk0 from public.ledger_accounts where system_key = 'market' \gset
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() as closed \gset
select security_id as sec, ticker as tkr, shares_outstanding as so from public.companies where id = :'fco' \gset
select tests.login_as('authenticated', :r2);
select tests.throws_key(format($$select public.subscribe_offer(gen_random_uuid(), %L, 10000)$$, :'offer'), 'offer_closed', 'subscribe_offer(): closed');
select (select x from jsonb_array_elements(public.get_market_snapshot() -> 'securities') x where x ->> 'id' = :'sec') as snap \gset
reset role;
select tests.login_as('authenticated', :f);
select public.get_my_company() -> 'company' as listed \gset
reset role;
select tests.assert(
  :closed::int >= 1 and :'tkr' ~ '^[A-Z]{3,4}$'
  and (select kind = 'stock' and status = 'listed' and sector_key = 'tech' from public.securities where id = :'sec')
  and (select tier = 'penny' and phase = 'listed' and legal_form = 'ag' from public.companies where id = :'fco')
  and (select tier = 'ag' from public.player_companies where company_id = :'fco')
  and (select shares_ai_e6 > 0 and status = 'closed' from public.company_share_offers where id = :'offer')
  and :so::bigint = (700000000000 + 500500000 + 200000000 + (select shares_ai_e6 from public.company_share_offers where id = :'offer')) / 1000000
  and tests.qty_e6(:f, :'tkr') = 700000000000 and tests.qty_e6(:r2, :'tkr') = 500500000
  and (select avg_entry_price_e4 = :iprice::bigint * 100 from public.positions where player_id = :r2 and security_id = :'sec')
  and (select balance_cents from public.ledger_accounts where system_key = 'market')
      = :mk0::bigint - floor((select shares_ai_e6 from public.company_share_offers where id = :'offer')::numeric * :iprice::bigint / 1000000)
  and :'listed'::jsonb -> 'listing' ->> 'status' = 'listed' and :'listed'::jsonb -> 'listing' ->> 'ticker' = :'tkr'
  and (:'listed'::jsonb -> 'listing' ->> 'founder_shares_e6')::bigint = 700000000000
  and (:'listed'::jsonb ->> 'can_capital_increase')::boolean
  and :'snap'::jsonb ->> 'company_kind' = 'player' and :'snap'::jsonb -> 'logo' -> 'palette' is not null
  and :'snap'::jsonb ->> 'size_class' = 'penny'
  and public.player_company_value_cents(:f) = 0,
  'IPO end: AI investors take part of the rest (paid by the financial market), the stock is listed as a penny stock, subscribers and the founder get their shares');

-- listed player stocks trade like any other
select tests.login_as('authenticated', :r2);
select public.place_order(gen_random_uuid(), :'tkr', 'sell', 'market', 100000000) ->> 'status' as sold \gset
reset role;
select (public.market_tick_at(((public.game_day(now() + interval '3 days')::timestamp + interval '12 hours') at time zone 'Europe/Berlin')) ->> 'securities')::int as ticked \gset
select tests.assert(:'sold' = 'filled' and tests.qty_e6(:r2, :'tkr') = 400500000 and :ticked::int >= 20,
  'the player stock trades and ticks like the AI stocks');

-- quarter close sets the fair value per share
select public.player_company_close_quarter(:'fco', (public.current_game_quarter()).id) is not null as ok \gset
select tests.assert(
  (select fair_value_e4 from public.security_sim_state where security_id = :'sec')
    = greatest(1, public.company_value_cents(:'fco') * 100 / :so::bigint),
  'quarter close: fair value per share = company value / shares outstanding');

-- capital increase
select tests.login_as('authenticated', :f);
select tests.throws_key($$select public.capital_increase(gen_random_uuid(), 30)$$, 'invalid_argument', 'capital_increase(): at most 25 %');
select public.capital_increase(gen_random_uuid(), 10) -> 'company' -> 'listing' -> 'offer' as ci \gset
reset role;
update public.company_share_offers set shares_subscribed_e6 = shares_offered_e6 where id = (:'ci'::jsonb ->> 'id')::uuid;
select tests.login_as('authenticated', :r3);
select tests.throws_key(format($$select public.subscribe_offer(gen_random_uuid(), %L, 10000)$$, :'ci'::jsonb ->> 'id'), 'offer_sold_out',
  'subscribe_offer(): sold out');
reset role;
update public.company_share_offers set shares_subscribed_e6 = 0 where id = (:'ci'::jsonb ->> 'id')::uuid;
select tests.login_as('authenticated', :r3);
select public.subscribe_offer(gen_random_uuid(), (:'ci'::jsonb ->> 'id')::uuid, 30000) ->> 'shares_e6' as r3s \gset
reset role;
update public.company_share_offers set ends_at = now() - interval '1 second' where id = (:'ci'::jsonb ->> 'id')::uuid;
select public.close_due_offers() is not null as ok \gset
select tests.assert(
  :'ci'::jsonb ->> 'kind' = 'capital_increase' and :'ci'::jsonb ->> 'ticker' = :'tkr'
  and (:'ci'::jsonb ->> 'shares_offered_e6')::bigint = :so::bigint * 100000
  and (:'ci'::jsonb ->> 'price_cents')::bigint
      = greatest(100, round((select last_price_e4 from public.security_quotes where security_id = :'sec') / 100.0 * 0.9))
  and (select shares_outstanding from public.companies where id = :'fco')
      = (:so::bigint * 1000000 + :r3s::bigint + (select shares_ai_e6 from public.company_share_offers where id = (:'ci'::jsonb ->> 'id')::uuid)) / 1000000
  and tests.qty_e6(:r3, :'tkr') = 200000000 + :r3s::bigint,
  'capital_increase(): new shares at the market price x 0.9, shares outstanding grow, subscribers get them');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds (subscriptions, AI investors, trades)');
-- keep the market snapshot of the fixtures at the 15 AI stocks
update public.securities set status = 'delisted', delisted_at = now() where id = :'sec';
