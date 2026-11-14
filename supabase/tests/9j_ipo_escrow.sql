-- =============================================================================
-- 9j · IPO: money back when it fails, nothing paid out before the listing (ADR-151)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''09a19a19-0000-4000-8000-0000000000f1'''
\set g '''09a19a19-0000-4000-8000-0000000000f2'''
\set a '''09a19a19-0000-4000-8000-0000000000a1'''
\set b '''09a19a19-0000-4000-8000-0000000000b1'''
\set c '''09a19a19-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 5 where code = 'M1-TESTS';
select tests.signup(:f, 'Esc_Frida') is not null and tests.signup(:g, 'Esc_Gero') is not null
   and tests.signup(:a, 'Esc_Anton') is not null and tests.signup(:b, 'Esc_Berta') is not null
   and tests.signup(:c, 'Esc_Carl') is not null as ok \gset
select tests.set_level(:f, 10);
select tests.set_level(:g, 10);
select tests.fund(:f, 1000000, 'test:9j:f');
select tests.fund(:g, 1000000, 'test:9j:g');
select tests.fund(:a, 30000000, 'test:9j:a');
select tests.fund(:b, 1000000, 'test:9j:b');
select tests.fund(:c, 1000000, 'test:9j:c');

select tests.assert(
  public.config_bigint('startups', '{ipo,minFillBps}', -1) = 10000
  and exists (select 1 from public.ledger_accounts where system_key = 'offer_escrow' and kind = 'system' and not allow_negative)
  and exists (select 1 from public.notification_types where key = 'ipo_result' and is_mandatory),
  'config: an IPO needs every offered share (minFillBps 10000); escrow account and notification type exist');

-- =============================================================================
-- A. Not full at the end: the IPO fails, everybody gets the full amount back, the company stays private
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Wackelwerk', 'Stühle mit drei Beinen', 'retail', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 30) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer1 \gset
reset role;
select tests.company_of(:f) as fco \gset
update public.player_companies set quality = 0 where company_id = :'fco';
select tests.cash(:a) as a0, tests.cash(:b) as b0, tests.cash(:f) as f0, tests.company_cash(:'fco') as cc0 \gset
select balance_cents as mk0 from public.ledger_accounts where system_key = 'market' \gset
select balance_cents as esc0 from public.ledger_accounts where system_key = 'offer_escrow' \gset
select tests.login_as('authenticated', :a);
select public.subscribe_offer(gen_random_uuid(), :'offer1', 500000) as s1 \gset
select public.subscribe_offer(gen_random_uuid(), :'offer1', 250000) as s2 \gset
reset role;
select tests.login_as('authenticated', :b);
select public.subscribe_offer(gen_random_uuid(), :'offer1', 100000) as s3 \gset
reset role;
select (:'s1'::jsonb ->> 'amount_cents')::bigint + (:'s2'::jsonb ->> 'amount_cents')::bigint as paid_a,
       (:'s3'::jsonb ->> 'amount_cents')::bigint as paid_b \gset
select tests.assert(
  tests.cash(:a) = :a0::bigint - :paid_a::bigint and tests.cash(:b) = :b0::bigint - :paid_b::bigint
  and tests.company_cash(:'fco') = :cc0::bigint
  and (select balance_cents from public.ledger_accounts where system_key = 'offer_escrow') = :esc0::bigint + :paid_a::bigint + :paid_b::bigint
  and (select escrow_cents = :paid_a::bigint + :paid_b::bigint from public.company_share_offers where id = :'offer1')
  and (:'s2'::jsonb -> 'offer' ->> 'my_amount_cents')::bigint = :paid_a::bigint
  and :'s2'::jsonb -> 'offer' ->> 'status' = 'open',
  'subscribe_offer(): the money waits in the escrow, the company cash does not move (ADR-151)');

-- the founder cannot take any of it out: the company cash is what it was
select tests.login_as('authenticated', :f);
select tests.throws_key(format($$select public.company_withdraw(gen_random_uuid(), %s)$$, :cc0::bigint + 1), 'insufficient_funds',
  'company_withdraw(): subscription money is not in the company cash before the listing');
reset role;

-- AI investors come in over the window, but pay nothing yet
update public.company_share_offers set created_at = now() - interval '30 minutes', ends_at = now() + interval '30 minutes'
 where id = :'offer1';
select public.close_due_offers() is not null as ok \gset
select tests.assert(
  (select shares_ai_e6 > 0 and status = 'open' from public.company_share_offers where id = :'offer1')
  and tests.company_cash(:'fco') = :cc0::bigint
  and (select balance_cents from public.ledger_accounts where system_key = 'market') = :mk0::bigint,
  'AI investors are counted during the window and pay nothing before the listing');

-- the window ends: quality 0 means 60 % from the AI, the players took far less than the other 40 %
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer1';
select public.close_due_offers() as closed1 \gset
select tests.login_as('authenticated', :a);
select (select x from jsonb_array_elements(public.get_offers() -> 'offers') x where x ->> 'id' = :'offer1') as o1a \gset
select tests.throws_key(format($$select public.subscribe_offer(gen_random_uuid(), %L, 10000)$$, :'offer1'), 'offer_closed',
  'subscribe_offer(): a failed IPO takes no more money');
reset role;
select tests.login_as('authenticated', :f);
select public.get_my_company() -> 'company' as after1 \gset
reset role;
select tests.assert(
  :closed1::int >= 1
  and (select status = 'failed' and escrow_cents = 0 and closed_at is not null and security_id is null
         from public.company_share_offers where id = :'offer1')
  and tests.cash(:a) = :a0::bigint and tests.cash(:b) = :b0::bigint and tests.cash(:f) = :f0::bigint
  and tests.company_cash(:'fco') = :cc0::bigint
  and (select balance_cents from public.ledger_accounts where system_key = 'offer_escrow') = :esc0::bigint
  and (select balance_cents from public.ledger_accounts where system_key = 'market') = :mk0::bigint
  and (select phase = 'private' and security_id is null and ticker is null from public.companies where id = :'fco')
  and (select tier <> 'ag' from public.player_companies where company_id = :'fco')
  and not exists (select 1 from public.positions p where p.player_id in (:a, :b, :f)
                   and p.security_id in (select id from public.securities where company_id = :'fco'))
  and :'o1a'::jsonb ->> 'status' = 'failed' and (:'o1a'::jsonb ->> 'my_amount_cents')::bigint = :paid_a::bigint
  and :'after1'::jsonb -> 'listing' = 'null'::jsonb and (:'after1'::jsonb ->> 'can_go_public')::boolean,
  'IPO not full at the end: it fails, every player has the full amount back, AI investors paid nothing, the company stays private and may try again');
select tests.assert(
  (select count(*) = 1 from public.notifications n where n.player_id = :a and n.type_key = 'ipo_result'
      and n.payload ->> 'result' = 'failed' and (n.payload ->> 'amount_cents')::bigint = :paid_a::bigint)
  and (select count(*) = 1 from public.notifications n where n.player_id = :b and n.type_key = 'ipo_result')
  and (select count(*) = 1 from public.notifications n where n.player_id = :f and n.type_key = 'ipo_result'
      and n.payload ->> 'result' = 'failed')
  and exists (select 1 from public.company_messages m where m.company_id = :'fco' and m.body like 'Börsengang geplatzt%'),
  'a failed IPO tells every subscriber and the founder, and the company chat');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds after the refunds');

-- =============================================================================
-- B. Second try, filled by players: listed at once, the money reaches the company in one booking
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.go_public(gen_random_uuid(), 20) -> 'company' -> 'listing' -> 'offer' as o2 \gset
reset role;
select (:'o2'::jsonb ->> 'id') as offer2 \gset
select tests.login_as('authenticated', :b);
select public.subscribe_offer(gen_random_uuid(), :'offer2', 50000) as s4 \gset
reset role;
select tests.company_cash(:'fco') as cc1 \gset
select tests.login_as('authenticated', :a);
select public.subscribe_offer(gen_random_uuid(), :'offer2', 1000000000) as s5 \gset
reset role;
select tests.assert(
  :'offer2' <> :'offer1' and :cc1::bigint = :cc0::bigint
  and (:'s5'::jsonb ->> 'completed')::boolean
  and (select status = 'closed' and escrow_cents = 0 from public.company_share_offers where id = :'offer2')
  and (select phase = 'listed' from public.companies where id = :'fco')
  and tests.company_cash(:'fco') = :cc0::bigint + (:'s4'::jsonb ->> 'amount_cents')::bigint + (:'s5'::jsonb ->> 'amount_cents')::bigint
  and (select balance_cents from public.ledger_accounts where system_key = 'offer_escrow') = :esc0::bigint
  and (select count(*) = 1 from public.notifications n where n.player_id = :b and n.type_key = 'ipo_result'
        and n.payload ->> 'result' = 'listed'),
  'second try, filled by players: listed at once and only now the money is in the company cash');

-- =============================================================================
-- C. The company is closed during the subscription: the offer fails, the money goes back
-- =============================================================================
select tests.login_as('authenticated', :g);
select public.found_company(gen_random_uuid(), 'Kurzwerk', 'Kerzen ohne Docht', 'retail', '#663399', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 25) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer3 \gset
reset role;
select tests.company_of(:g) as gco \gset
select tests.cash(:c) as c0 \gset
select tests.login_as('authenticated', :c);
select public.subscribe_offer(gen_random_uuid(), :'offer3', 80000) as s6 \gset
reset role;
select tests.login_as('authenticated', :g);
select public.close_company(gen_random_uuid()) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key(format($$select public.subscribe_offer(gen_random_uuid(), %L, 10000)$$, :'offer3'), 'offer_closed',
  'subscribe_offer(): not into a closed company');
reset role;
select public.close_due_offers() is not null as ok \gset
select tests.assert(
  tests.cash(:c) = :c0::bigint
  and (select status = 'failed' and escrow_cents = 0 from public.company_share_offers where id = :'offer3')
  and (select phase in ('insolvent', 'dissolved') and security_id is null from public.companies where id = :'gco')
  and (select balance_cents from public.ledger_accounts where system_key = 'offer_escrow') = :esc0::bigint,
  'a company closed during the subscription: the offer fails at the next run and the subscriber has the money back');

-- =============================================================================
-- D. Capital increase: the money waits as well; a subscriber who resets the account loses it to the state
-- =============================================================================
select tests.login_as('authenticated', :f);
select public.capital_increase(gen_random_uuid(), 10) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer4 \gset
reset role;
select tests.company_cash(:'fco') as cc2 \gset
select tests.login_as('authenticated', :b);
select public.subscribe_offer(gen_random_uuid(), :'offer4', 40000) as s7 \gset
reset role;
select tests.login_as('authenticated', :c);
select public.subscribe_offer(gen_random_uuid(), :'offer4', 30000) as s8 \gset
reset role;
select tests.assert(
  tests.company_cash(:'fco') = :cc2::bigint
  and (select escrow_cents = (:'s7'::jsonb ->> 'amount_cents')::bigint + (:'s8'::jsonb ->> 'amount_cents')::bigint
         from public.company_share_offers where id = :'offer4'),
  'capital increase: the money waits in the escrow until the subscription ends');
select public.account_wipe(:c, 'test:9j:wipe') is null as ok \gset
select balance_cents as mk2 from public.ledger_accounts where system_key = 'market' \gset
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer4';
select public.close_due_offers() is not null as ok \gset
select tests.assert(
  (select status = 'closed' and escrow_cents = 0 and shares_subscribed_e6 = (:'s7'::jsonb ->> 'shares_e6')::bigint
         from public.company_share_offers where id = :'offer4')
  and tests.company_cash(:'fco') = :cc2::bigint + (:'s7'::jsonb ->> 'amount_cents')::bigint
      + (:mk2::bigint - (select balance_cents from public.ledger_accounts where system_key = 'market'))
  and (select balance_cents from public.ledger_accounts where system_key = 'offer_escrow') = :esc0::bigint,
  'capital increase end: issued with what was subscribed; the money of a subscription that no longer exists goes to the state, not to the company');

select tests.assert(
  (select status = 'failed' from public.company_share_offers where id = :'offer1')
  and public.share_offer_cancel(:'offer1', 'again') is null and public.close_share_offer(:'offer1') is null,
  'an ended offer is never settled twice');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds (escrow, refunds, listing, reset)');
