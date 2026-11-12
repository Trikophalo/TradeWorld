-- =============================================================================
-- 75 · M4e: automatic CEO payout (ADR-086)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''07507507-0000-4000-8000-0000000000a1'''
\set b '''07507507-0000-4000-8000-0000000000b2'''
\set rq '''07507507-0000-4000-8000-0000000000f1'''
select tests.signup(:a, 'Alma_Auszahlung') is not null and tests.signup(:b, 'Bert_Fremd') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 6);
select tests.set_level(:b, 6);
select tests.fund(:a, 1000000, 'test:m4e:a');
select tests.fund(:b, 1000000, 'test:m4e:b');
-- deterministic demand for this file
select coalesce(value -> 'demandNoise', '0.1') as noise0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{demandNoise}', '0');
select (value #>> '{marketFactorByTier,garage}')::numeric as mf_garage from public.game_config where key = 'startups' \gset

select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Auszahl Werk', 'Kabel für alle', 'tech', '#225588', 'garage') -> 'company' as g0 \gset
reset role;
select tests.company_of(:a) as co \gset
-- 1 200 000 a year = 50 000 per operating hour; awareness 50 %, quality 100 % -> demand 25 000 / h
update public.player_companies set potential_annual_cents = round(1200000 / :mf_garage), awareness = 0.5, quality = 1
 where company_id = :'co';
select id as qid, starts_at as qs from public.game_quarters order by ends_at desc limit 1 \gset

-- =============================================================================
-- A. set_founder_payout: whole steps of startups.founderPayout, founder only
-- =============================================================================
select tests.assert(
  (:'g0'::jsonb ->> 'founder_payout_bps')::int = 0
  and (:'g0'::jsonb -> 'live') ?& array['founder_payout_per_hour_cents', 'today_founder_payout_cents']
  and (:'g0'::jsonb -> 'live' ->> 'founder_payout_per_hour_cents')::bigint = 0
  and (:'g0'::jsonb -> 'live' ->> 'today_founder_payout_cents')::bigint = 0,
  'COMPANY: founder_payout_bps 0 after founding; live payout fields 0 before the first hour');

select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.set_founder_payout(gen_random_uuid(), 2550)$$, 'invalid_argument',
  'set_founder_payout(): only whole steps of stepBps (500)');
select tests.throws_key($$select public.set_founder_payout(gen_random_uuid(), -500)$$, 'invalid_argument',
  'set_founder_payout(): not below 0');
select tests.throws_key($$select public.set_founder_payout(gen_random_uuid(), 10500)$$, 'invalid_argument',
  'set_founder_payout(): not above maxBps (10 000)');
select tests.throws_key($$select public.set_founder_payout(gen_random_uuid(), null)$$, 'invalid_argument',
  'set_founder_payout(): a share is required');
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.set_founder_payout(gen_random_uuid(), 5000)$$, 'company_not_found',
  'set_founder_payout(): only the founder of an active company');
reset role;
select tests.assert((select founder_payout_bps from public.player_companies where company_id = :'co') = 0,
  'set_founder_payout(): refused calls change nothing');

-- =============================================================================
-- B. 0 %: a profitable hour pays nothing
-- =============================================================================
select tests.cash(:a) as ac0 \gset
select tests.company_cash(:'co') as cc0 \gset
select (public.player_company_close_hour(:'co', :'qs'::timestamptz + interval '3 hours') ->> 'founder_payout_cents')::bigint as r0 \gset
select * from public.player_company_hours where company_id = :'co' and hour_start = :'qs'::timestamptz + interval '3 hours' \gset h0_
select tests.assert(
  :h0_profit_cents::bigint > 0 and :h0_founder_payout_cents::bigint = 0 and :r0::bigint = 0
  and tests.cash(:a) = :ac0::bigint and tests.company_cash(:'co') = :cc0::bigint + :h0_profit_cents::bigint,
  'close_hour(): 0 % pays nothing, the whole profit stays in the company');

-- =============================================================================
-- C. 50 %: half of the profit (rounded down) from the company to the founder
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.set_founder_payout(:rq, 5000) -> 'company' as s1 \gset
select public.set_founder_payout(:rq, 5000) -> 'company' as s1b \gset
reset role;
select tests.assert(
  (:'s1'::jsonb ->> 'founder_payout_bps')::int = 5000 and :'s1'::jsonb = :'s1b'::jsonb
  and (select founder_payout_bps from public.player_companies where company_id = :'co') = 5000,
  'set_founder_payout(): stores the share, {company} like set_company_strategy; idempotent per request_id');

select tests.cash(:a) as ac1 \gset
select tests.company_cash(:'co') as cc1 \gset
select balance_cents as hh1 from public.ledger_accounts where system_key = 'households' \gset
select (public.player_company_close_hour(:'co', :'qs'::timestamptz + interval '4 hours') ->> 'founder_payout_cents')::bigint as r1 \gset
select * from public.player_company_hours where company_id = :'co' and hour_start = :'qs'::timestamptz + interval '4 hours' \gset h1_
select 'pch:' || :'co' || ':' || to_char((:'qs'::timestamptz + interval '4 hours') at time zone 'UTC', 'YYYYMMDDHH24') || ':payout' as k1 \gset
select tests.assert(
  :h1_profit_cents::bigint > 0
  and :h1_profit_cents::bigint = :h1_revenue_cents::bigint - :h1_cogs_cents::bigint - :h1_fixed_cents::bigint
  and :h1_founder_payout_cents::bigint = :h1_profit_cents::bigint * 5000 / 10000 and :r1::bigint = :h1_founder_payout_cents::bigint
  and tests.cash(:a) = :ac1::bigint + :h1_founder_payout_cents::bigint
  and tests.company_cash(:'co') = :cc1::bigint + :h1_profit_cents::bigint - :h1_founder_payout_cents::bigint
  and (select balance_cents from public.ledger_accounts where system_key = 'households') = :hh1::bigint - :h1_profit_cents::bigint,
  'close_hour(): 50 % of the profit (rounded down) to the founder''s cash, out of the company cash; profit_cents not reduced');
select tests.assert(
  (select count(*) from public.ledger_transactions t where t.idempotency_key = :'k1' and t.kind = 'transfer'
      and t.ref_type = 'company' and t.ref_id = :'co'::uuid) = 1
  and (select sum(e.amount_cents) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.idempotency_key = :'k1') = 0
  and (select count(*) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.idempotency_key = :'k1') = 2
  and (select e.amount_cents from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.idempotency_key = :'k1' and e.account_id = public.ledger_player_account(:a, 'player_cash'))
      = :h1_founder_payout_cents::bigint
  and not exists (select 1 from public.ledger_audit()),
  'close_hour(): the payout is one balanced transfer company_cash -> player_cash (like company_withdraw); ledger audit clean');

select tests.login_as('authenticated', :a);
select public.get_my_company() -> 'company' as mc1 \gset
reset role;
select tests.assert(
  (:'mc1'::jsonb ->> 'founder_payout_bps')::int = 5000
  and (:'mc1'::jsonb -> 'live' ->> 'founder_payout_per_hour_cents')::bigint = :h1_founder_payout_cents::bigint
  and (:'mc1'::jsonb -> 'live' ->> 'profit_per_hour_cents')::bigint = :h1_profit_cents::bigint
  and (:'mc1'::jsonb -> 'live' ->> 'today_founder_payout_cents')::bigint
      = (select coalesce(sum(x.founder_payout_cents), 0) from public.player_company_hours x
          where x.company_id = :'co'
            and (x.hour_start at time zone 'Europe/Berlin')::date = (public.game_now() at time zone 'Europe/Berlin')::date)
  and (:'mc1'::jsonb -> 'hours' -> -1 ->> 'founder_payout_cents')::bigint = :h1_founder_payout_cents::bigint
  and (:'mc1'::jsonb -> 'hours' -> -2 ->> 'founder_payout_cents')::bigint = 0,
  'COMPANY: founder_payout_bps, live.founder_payout_per_hour_cents, live.today_founder_payout_cents, hours[].founder_payout_cents');

-- =============================================================================
-- D. The same hour again: skipped, nothing is paid twice
-- =============================================================================
select tests.cash(:a) as ac2 \gset
select tests.company_cash(:'co') as cc2 \gset
select public.player_company_close_hour(:'co', :'qs'::timestamptz + interval '4 hours') ->> 'skipped' as sk \gset
select tests.assert(
  :'sk' = 'already_closed' and tests.cash(:a) = :ac2::bigint and tests.company_cash(:'co') = :cc2::bigint
  and (select count(*) from public.ledger_transactions where idempotency_key = :'k1') = 1,
  'close_hour(): a closed hour is skipped, the payout is not booked twice');

-- =============================================================================
-- E. A loss hour pays nothing
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.set_company_strategy(gen_random_uuid(), 'normal', false) is not null as ok \gset
select public.set_founder_payout(gen_random_uuid(), 10000) is not null as ok \gset
reset role;
update public.player_companies set potential_annual_cents = 1 where company_id = :'co';
select tests.cash(:a) as ac3 \gset
select tests.company_cash(:'co') as cc3 \gset
select public.player_company_close_hour(:'co', :'qs'::timestamptz + interval '5 hours') is not null as ok \gset
select * from public.player_company_hours where company_id = :'co' and hour_start = :'qs'::timestamptz + interval '5 hours' \gset h2_
select tests.assert(
  :h2_profit_cents::bigint < 0 and :h2_founder_payout_cents::bigint = 0 and tests.cash(:a) = :ac3::bigint
  and tests.company_cash(:'co') = :cc3::bigint + :h2_profit_cents::bigint,
  'close_hour(): a loss hour pays nothing, even at 100 %');

-- =============================================================================
-- F. Never more than the free cash (cash minus open bills)
-- =============================================================================
update public.player_companies set potential_annual_cents = round(1200000 / :mf_garage) where company_id = :'co';
-- empty cash with an open bill of 30 EUR: the hour settles it first, only the rest may be paid out
select public.ledger_transfer(public.company_cash_account(:'co'), public.ledger_system_account('households'),
  tests.company_cash(:'co'), 'transfer', 'Test-Leerung', 'company', :'co', 'test:m4e:drain1') is not null as ok \gset
update public.player_companies set unpaid_cents = 3000 where company_id = :'co';
select tests.cash(:a) as ac4 \gset
select public.player_company_close_hour(:'co', :'qs'::timestamptz + interval '6 hours') is not null as ok \gset
select * from public.player_company_hours where company_id = :'co' and hour_start = :'qs'::timestamptz + interval '6 hours' \gset h3_
select tests.assert(
  :h3_profit_cents::bigint > 3000
  and :h3_founder_payout_cents::bigint = :h3_profit_cents::bigint - 3000
  and tests.cash(:a) = :ac4::bigint + :h3_founder_payout_cents::bigint
  and tests.company_cash(:'co') = 0
  and (select unpaid_cents from public.player_companies where company_id = :'co') = 0,
  'close_hour(): 100 % is capped by the free cash after the open bill is settled');

-- open bills larger than the cash: no free cash, no payout
select public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(:'co'), 5000,
  'transfer', 'Test-Kapital', 'company', :'co', 'test:m4e:fill1') is not null as ok \gset
update public.player_companies set unpaid_cents = 100000000 where company_id = :'co';
select tests.cash(:a) as ac5 \gset
select public.player_company_close_hour(:'co', :'qs'::timestamptz + interval '7 hours') is not null as ok \gset
select * from public.player_company_hours where company_id = :'co' and hour_start = :'qs'::timestamptz + interval '7 hours' \gset h4_
select tests.assert(
  :h4_profit_cents::bigint > 0 and :h4_founder_payout_cents::bigint = 0 and tests.cash(:a) = :ac5::bigint
  and tests.company_cash(:'co') = 0
  and (select unpaid_cents from public.player_companies where company_id = :'co') > 0
  and not exists (select 1 from public.ledger_audit()),
  'close_hour(): with open bills above the cash there is no free cash and no payout');

update public.player_companies set unpaid_cents = 0, distress = false where company_id = :'co';
select tests.set_cfg('startups', '{demandNoise}', :'noise0'::jsonb);
