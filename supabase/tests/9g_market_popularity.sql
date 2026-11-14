-- =============================================================================
-- 9g · Player stocks in the market list, popularity (ADR-145) and the 10-minute IPO (ADR-146)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''09f09f09-0000-4000-8000-0000000000f1'''
\set g '''09f09f09-0000-4000-8000-0000000000f2'''
\set a '''09f09f09-0000-4000-8000-0000000000a1'''
\set b '''09f09f09-0000-4000-8000-0000000000b1'''
\set c '''09f09f09-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 5 where code = 'M1-TESTS';
select tests.signup(:f, 'Pop_Frida') is not null and tests.signup(:g, 'Pop_Gero') is not null
   and tests.signup(:a, 'Pop_Anton') is not null and tests.signup(:b, 'Pop_Berta') is not null
   and tests.signup(:c, 'Pop_Carl') is not null as ok \gset
select tests.set_level(:f, 10);
select tests.set_level(:g, 10);
select tests.fund(:f, 1000000, 'test:9g:f');
select tests.fund(:g, 1000000, 'test:9g:g');
select tests.fund(:a, 30000000, 'test:9g:a');
select tests.fund(:b, 1000000, 'test:9g:b');

-- =============================================================================
-- A. Filled: the subscription that takes the last share lists the company at once
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Gipfelwerk', 'Bergschuhe nach Maß', 'retail', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 20) -> 'company' -> 'listing' -> 'offer' as o1 \gset
reset role;
select (:'o1'::jsonb ->> 'id') as offer1, tests.company_of(:f) as fco \gset
select tests.assert(
  (select ends_at - created_at = interval '10 minutes' and status = 'open' from public.company_share_offers where id = :'offer1')
  and (:'o1'::jsonb ->> 'mine')::boolean and (:'o1'::jsonb ->> 'shares_ai_e6')::bigint = 0
  and :'o1'::jsonb ?& array['starts_at', 'ends_at', 'shares_subscribed_e6', 'shares_ai_e6'],
  'go_public(): the subscription runs startups.ipo.subscriptionMinutes (10) and shows the AI share');

select (select price_cents from public.company_share_offers where id = :'offer1') as p1,
       (select shares_offered_e6 from public.company_share_offers where id = :'offer1') as off1 \gset
select tests.cash(:a) as a0, tests.company_cash(:'fco') as cc0 \gset
select tests.login_as('authenticated', :a);
select public.subscribe_offer(gen_random_uuid(), :'offer1', 1000000000) as sub1 \gset
reset role;
select ticker as t1, security_id as sec1 from public.companies where id = :'fco' \gset
select tests.assert(
  (:'sub1'::jsonb ->> 'completed')::boolean
  and (:'sub1'::jsonb ->> 'shares_e6')::bigint = :off1::bigint
  and (:'sub1'::jsonb ->> 'amount_cents')::bigint = ceil(:off1::numeric * :p1::bigint / 1000000)
  and tests.cash(:a) = :a0::bigint - (:'sub1'::jsonb ->> 'amount_cents')::bigint
  and tests.company_cash(:'fco') = :cc0::bigint + (:'sub1'::jsonb ->> 'amount_cents')::bigint
  and (select status = 'closed' and shares_ai_e6 = 0 from public.company_share_offers where id = :'offer1')
  and (select phase = 'listed' and legal_form = 'ag' from public.companies where id = :'fco')
  and tests.qty_e6(:a, :'t1') = :off1::bigint,
  'subscribe_offer(): the last share lists the company at once (ADR-146), the money goes through the ledger');
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.subscribe_offer(gen_random_uuid(), %L, 10000)$$, :'offer1'), 'offer_closed',
  'subscribe_offer(): a listed IPO takes no more money');
reset role;

-- the player stock is in the same list as the AI stocks, with popularity
select tests.login_as('authenticated', :c);
select (select x from jsonb_array_elements(public.get_market_snapshot() -> 'securities') x where x ->> 'ticker' = :'t1') as snap1 \gset
reset role;
select tests.assert(
  :'snap1'::jsonb ->> 'company_kind' = 'player' and :'snap1'::jsonb ->> 'kind' = 'stock'
  and :'snap1'::jsonb ? 'popularity' and (:'snap1'::jsonb ->> 'company_id')::uuid = :'fco'::uuid,
  'get_market_snapshot(): a listed player company is in the stock list, marked as a player company');

-- =============================================================================
-- B. Not filled: AI investors subscribe over the window, at the end it lists with what was subscribed
-- =============================================================================
select tests.login_as('authenticated', :g);
select public.found_company(gen_random_uuid(), 'Talwerk', 'Wanderkarten', 'retail', '#663399', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 30) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer2 \gset
reset role;
select tests.company_of(:g) as gco \gset
select tests.login_as('authenticated', :b);
select public.subscribe_offer(gen_random_uuid(), :'offer2', 10000) as sub2 \gset
reset role;
-- half of the window has passed
update public.company_share_offers set created_at = now() - interval '5 minutes', ends_at = now() + interval '5 minutes'
 where id = :'offer2';
select tests.company_cash(:'gco') as gc1 \gset
select public.close_due_offers() as closed_mid \gset
select o.shares_ai_e6 as ai_mid, o.shares_offered_e6 as off2, o.price_cents as p2, pc.quality as q2
  from public.company_share_offers o join public.player_companies pc on pc.company_id = o.company_id where o.id = :'offer2' \gset
select tests.assert(
  not (:'sub2'::jsonb ->> 'completed')::boolean
  and (select status = 'open' from public.company_share_offers where id = :'offer2')
  and :ai_mid::bigint > 0
  and abs(:ai_mid::bigint - floor(:off2::bigint * least(1, 0.2 + 0.5 * :q2::numeric)) / 2) <= :off2::bigint / 100
  and tests.company_cash(:'gco') = :gc1::bigint + floor(:ai_mid::numeric * :p2::bigint / 1000000),
  'close_due_offers(): AI investors subscribe their share evenly over the window (aiSubscribedE6), paid by the market');
-- the window is over
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer2';
select public.close_due_offers() as closed_end \gset
select ticker as t2, shares_outstanding as so2 from public.companies where id = :'gco' \gset
select tests.assert(
  :closed_end::int >= 1
  and (select status = 'closed' and shares_ai_e6 = floor(:off2::bigint * least(1, 0.2 + 0.5 * :q2::numeric))
         and shares_subscribed_e6 + shares_ai_e6 < shares_offered_e6 from public.company_share_offers where id = :'offer2')
  and (select phase = 'listed' from public.companies where id = :'gco')
  and :so2::bigint = (700000000000 + (select shares_subscribed_e6 + shares_ai_e6 from public.company_share_offers where id = :'offer2')) / 1000000
  and tests.qty_e6(:b, :'t2') = (:'sub2'::jsonb ->> 'shares_e6')::bigint
  and tests.qty_e6(:g, :'t2') = 700000000000
  and tests.company_cash(:'gco')
      = :gc1::bigint + floor((select shares_ai_e6 from public.company_share_offers where id = :'offer2')::numeric * :p2::bigint / 1000000),
  'end of the window: listed with what was subscribed, AI investors got their full share, the rest is not issued');

-- =============================================================================
-- C. Views: once per player and stock within the cooldown, never the founder's own stock
-- =============================================================================
select tests.login_as('authenticated', :c);
select public.record_security_view(gen_random_uuid(), :'t1') as v1 \gset
select public.record_security_view(gen_random_uuid(), lower(:'t1')) as v2 \gset
select public.record_security_view(gen_random_uuid(), 'ZZZZ') as v3 \gset
select tests.throws_key($$select public.record_security_view(null, 'KLS')$$, 'invalid_argument', 'record_security_view(): needs a request id');
reset role;
select tests.login_as('authenticated', :f);
select public.record_security_view(gen_random_uuid(), :'t1') as v4 \gset
reset role;
select tests.login_as('authenticated', :b);
select public.record_security_view(gen_random_uuid(), :'t1') as v5 \gset
reset role;
select tests.assert(
  (:'v1'::jsonb ->> 'counted')::boolean and not (:'v2'::jsonb ->> 'counted')::boolean
  and not (:'v3'::jsonb ->> 'counted')::boolean and not (:'v4'::jsonb ->> 'counted')::boolean
  and (:'v5'::jsonb ->> 'counted')::boolean
  and (select sum(views) from public.security_view_days where security_id = :'sec1') = 2,
  'record_security_view(): counts a player once per stock within the cooldown, not unknown tickers, not the founder');
-- after the pause it counts again
update public.security_view_marks set counted_at = now() - interval '31 minutes' where player_id = :c and security_id = :'sec1';
select tests.login_as('authenticated', :c);
select public.record_security_view(gen_random_uuid(), :'t1') as v6 \gset
reset role;
-- at most maxViewsPerDay a day
select tests.set_cfg('marketPopularity', '{maxViewsPerDay}', '2');
select tests.login_as('authenticated', :c);
select public.record_security_view(gen_random_uuid(), 'KLS') as v7 \gset
reset role;
select tests.set_cfg('marketPopularity', '{maxViewsPerDay}', '200');
select tests.assert(
  (:'v6'::jsonb ->> 'counted')::boolean and not (:'v7'::jsonb ->> 'counted')::boolean
  and (select sum(views) from public.security_view_days where security_id = :'sec1') = 3
  and not has_table_privilege('authenticated', 'public.security_view_days', 'select')
  and not has_table_privilege('authenticated', 'public.security_popularity', 'select'),
  'record_security_view(): again after viewCooldownMinutes, at most maxViewsPerDay a day, no direct client access');

-- =============================================================================
-- D. Popularity order: views and investments, recomputed with the snapshot
-- =============================================================================
select tests.assert(
  public.security_popularity_score(0, 0, 0) = 0
  and public.security_popularity_score(3, 1, 1000000) = 3 + 20 + 20
  and public.security_popularity_score(0, 0, 99) = 0,
  'security_popularity_score(): views + 20 per investor + floor(sqrt(euros) x 0.2), same as popularityScore');
insert into public.security_view_days (security_id, day, views)
values (:'sec1', (now() at time zone 'UTC')::date - 10, 50) on conflict do nothing;
-- the snapshot recomputes a stale ranking
update public.market_popularity_state set refreshed_at = now() - interval '1 hour';
delete from public.market_snapshot_cache where true;
select tests.login_as('authenticated', :c);
select public.get_market_snapshot() -> 'securities' as secs \gset
reset role;
select (select (x ->> 'popularity')::bigint from jsonb_array_elements(:'secs'::jsonb) x where x ->> 'ticker' = :'t1') as pop1,
       (select (x ->> 'popularity')::bigint from jsonb_array_elements(:'secs'::jsonb) x where x ->> 'ticker' = :'t2') as pop2 \gset
select tests.assert(
  not exists (select 1 from public.security_view_days where day <= (now() at time zone 'UTC')::date - 3)
  and (select views = 3 and investors = 1 and bought_cents = (:'sub1'::jsonb ->> 'amount_cents')::bigint
              and score = public.security_popularity_score(3, 1, (:'sub1'::jsonb ->> 'amount_cents')::bigint)
         from public.security_popularity where security_id = :'sec1')
  and :pop1::bigint = (select score from public.security_popularity where security_id = :'sec1')
  and :pop1::bigint > :pop2::bigint and :pop2::bigint > 0
  and (select refreshed_at > now() - interval '1 minute' from public.market_popularity_state),
  'get_market_snapshot(): stale popularity is recomputed (views and investors of the window), more viewed and invested ranks higher');
-- a fresh ranking is not recomputed on every build
select tests.login_as('authenticated', :c);
select public.record_security_view(gen_random_uuid(), :'t2') is not null as ok \gset
reset role;
delete from public.market_snapshot_cache where true;
select tests.login_as('authenticated', :c);
select (select (x ->> 'popularity')::bigint from jsonb_array_elements(public.get_market_snapshot() -> 'securities') x
         where x ->> 'ticker' = :'t2') as pop2b \gset
reset role;
select tests.assert(:pop2b::bigint = :pop2::bigint,
  'the ranking waits refreshMinutes before it is recomputed (cheap with many players)');

select tests.assert(not exists (select 1 from public.ledger_audit()) and tests.money_invariant() = 'ok',
  'ledger audit and money invariant hold after the IPOs');
