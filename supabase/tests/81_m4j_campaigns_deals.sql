-- =============================================================================
-- 81 · M4j: marketing campaigns, deals between players and trust (ADR-096 to ADR-098)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''08108108-0000-4000-8000-0000000000a1'''
\set b '''08108108-0000-4000-8000-0000000000b1'''
\set c '''08108108-0000-4000-8000-0000000000c1'''
\set d '''08108108-0000-4000-8000-0000000000d1'''
\set e '''08108108-0000-4000-8000-0000000000e1'''
\set f '''08108108-0000-4000-8000-0000000000f1'''
\set rq1 '''08108108-0000-4000-8000-000000000101'''
\set rq2 '''08108108-0000-4000-8000-000000000102'''
\set rq3 '''08108108-0000-4000-8000-000000000103'''
\set rq4 '''08108108-0000-4000-8000-000000000104'''
select tests.signup(:a, 'Anja_Lieferant') is not null and tests.signup(:b, 'Bodo_Kunde') is not null
   and tests.signup(:c, 'Cora_Teilhaber') is not null and tests.signup(:d, 'Dirk_Neuling') is not null
   and tests.signup(:e, 'Edda_Fremd') is not null and tests.signup(:f, 'Tore_Neustart') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(x, 6) from unnest(array[:a, :b, :c, :e, :f]::uuid[]) x;
select tests.set_level(:d, 2);
select tests.fund(:a, 5000000, 'test:m4j:a');
select tests.fund(:b, 2000000, 'test:m4j:b');
select tests.fund(:c, 2000000, 'test:m4j:c');
select tests.fund(:e, 500000, 'test:m4j:e');
select tests.fund(:f, 100000, 'test:m4j:f');
select nickname as a_nick from public.profiles where id = :a \gset
select nickname as b_nick from public.profiles where id = :b \gset
select nickname as c_nick from public.profiles where id = :c \gset
select nickname as e_nick from public.profiles where id = :e \gset
select nickname as f_nick from public.profiles where id = :f \gset
select tag as a_tag from public.profiles where id = :a \gset
select coalesce(value -> 'demandNoise', '0.1') as noise0 from public.game_config where key = 'startups' \gset
select tests.set_cfg('startups', '{demandNoise}', '0');
select (value #>> '{marketFactorByTier,garage}')::numeric as mf_garage from public.game_config where key = 'startups' \gset

-- a fresh company with 10 000 EUR extra cash (on top of the founding cost)
create or replace function tests.m4j_found(p_player uuid, p_name text, p_sector text) returns uuid language plpgsql as $$
declare
  v_co uuid;
begin
  perform tests.login_as('authenticated', p_player);
  perform public.found_company(gen_random_uuid(), p_name, 'Ideen für alle', p_sector, '#335577', 'garage');
  reset role;
  v_co := tests.company_of(p_player);
  perform public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(v_co), 1000000,
                                 'transfer', 'Test-Kapital', 'company', v_co, 'test:m4j:cash:' || v_co::text);
  return v_co;
end;
$$;
create or replace function tests.m4j_deal(p_id uuid) returns public.deals language sql as $$
  select * from public.deals where id = p_id $$;
create or replace function tests.m4j_notes(p_player uuid, p_type text) returns bigint language sql as $$
  select count(*) from public.notifications where player_id = p_player and type_key = p_type $$;
-- the notification of a type with this title (null when there is none)
create or replace function tests.m4j_note(p_player uuid, p_type text, p_title text) returns public.notifications language sql as $$
  select * from public.notifications where player_id = p_player and type_key = p_type and title = p_title
   order by created_at desc, id limit 1 $$;
-- leaves p_keep cents on a company cash
create or replace function tests.m4j_drain(p_company uuid, p_keep bigint, p_key text) returns void language plpgsql as $$
declare
  v bigint := tests.company_cash(p_company) - p_keep;
begin
  if v > 0 then
    perform public.ledger_transfer(public.company_cash_account(p_company), public.ledger_system_account('households'), v,
                                   'transfer', 'Test-Leerung', 'company', p_company, p_key);
  elsif v < 0 then
    perform public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(p_company), -v,
                                   'transfer', 'Test-Kapital', 'company', p_company, p_key);
  end if;
end;
$$;
-- leaves p_keep cents on a player's cash
create or replace function tests.m4j_drain_player(p_player uuid, p_keep bigint, p_key text) returns void language plpgsql as $$
declare
  v bigint := tests.cash(p_player) - p_keep;
begin
  if v > 0 then
    perform public.ledger_transfer(public.ledger_player_account(p_player, 'player_cash'), public.ledger_system_account('households'),
                                   v, 'transfer', 'Test-Leerung', 'player', p_player, p_key);
  elsif v < 0 then
    perform public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(p_player, 'player_cash'),
                                   -v, 'transfer', 'Test-Kapital', 'player', p_player, p_key);
  end if;
end;
$$;
create or replace function tests.m4j_hour(p_company uuid, p_hour timestamptz) returns public.player_company_hours language sql as $$
  select * from public.player_company_hours where company_id = p_company and hour_start = p_hour $$;
grant execute on all functions in schema tests to public;

select tests.m4j_found(:a, 'Lieferwerk Anja', 'tech') as aco \gset
select tests.m4j_found(:b, 'Kundenladen Bodo', 'retail') as bco \gset

-- =============================================================================
-- A. Campaign rules (port of campaigns.ts)
-- =============================================================================
select tests.assert(
  public.campaign_cost_cents('flyer', 10000) = 20000
  and public.campaign_cost_cents('flyer', 12345) = 24700
  and public.campaign_cost_cents('online', 3333) = 20000
  and public.campaign_cost_cents('online', 10000) = 60000
  and public.campaign_cost_cents('tv', 100000) = 1800000
  and public.campaign_cost_cents('tv', -5) = 20000,
  'campaignCostCents: max(200 EUR, costHours x demand of the last hour), whole euros');
select tests.assert(
  public.campaign_luck(0) = 0.4 and public.campaign_luck(1) = 1.6 and abs(public.campaign_luck(0.5) - 1.0) < 1e-12
  and public.campaign_luck(7) = 1.6
  and abs(public.campaign_factor('tv', 1, 1) - 1.7) < 1e-12
  and abs(public.campaign_factor('flyer', 0, 1) - 1.125) < 1e-12
  and abs(public.campaign_factor('online', 0.5, 1.6) - 1.48) < 1e-12
  and public.campaign_resonance(0.79) = 'weak' and public.campaign_resonance(0.8) = 'solid'
  and public.campaign_resonance(1.19) = 'solid' and public.campaign_resonance(1.2) = 'strong',
  'campaignLuck 0.4..1.6, campaignFactor 1 + demandBps x luck x (0.5 + 0.5 x quality), resonance weak / solid / strong');

-- 1 200 000 a year = 50 000 per operating hour; awareness 40 %, quality 100 % -> 20 000 per hour without a closed hour
update public.player_companies set potential_annual_cents = round(1200000 / :mf_garage), awareness = 0.4, quality = 1
 where company_id = :'aco';
select tests.login_as('authenticated', :a);
select public.get_my_company() -> 'company' as mc0 \gset
reset role;
select tests.assert(
  public.company_stage(:'aco') = 0
  and abs(public.company_demand_estimate_cents(:'aco') - 20000) < 1e-6
  and :'mc0'::jsonb -> 'campaign' = 'null'::jsonb
  and :'mc0'::jsonb -> 'campaign_costs' = '{"flyer": 40000, "online": 120000, "tv": 360000}'::jsonb,
  'COMPANY: no campaign; campaign_costs from the demand estimate (no closed hour yet)');

-- =============================================================================
-- B. start_campaign
-- =============================================================================
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.start_campaign(gen_random_uuid(), %L, 'flyer')$$, :'aco'), 'employer_only',
  'start_campaign(): only the owner or CEO');
reset role;
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.start_campaign(gen_random_uuid(), %L, 'radio')$$, :'aco'), 'invalid_argument',
  'start_campaign(): unknown kind');
select tests.throws_key(format($$select public.start_campaign(null, %L, 'flyer')$$, :'aco'), 'invalid_argument',
  'start_campaign(): request id required');
reset role;
update public.player_companies set unpaid_cents = tests.company_cash(:'aco') - 39999 where company_id = :'aco';
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.start_campaign(gen_random_uuid(), %L, 'flyer')$$, :'aco'), 'insufficient_funds',
  'start_campaign(): paid from the free cash (cash minus open bills)');
reset role;
update public.player_companies set unpaid_cents = 0 where company_id = :'aco';

select tests.company_cash(:'aco') as cc0 \gset
select balance_cents as hh0 from public.ledger_accounts where system_key = 'households' \gset
select tests.login_as('authenticated', :a);
select public.start_campaign(:rq1, :'aco', 'flyer') as camp1 \gset
select public.start_campaign(:rq1, :'aco', 'flyer') as camp1b \gset
select tests.throws_key(format($$select public.start_campaign(gen_random_uuid(), %L, 'tv')$$, :'aco'), 'campaign_running',
  'start_campaign(): one campaign at a time');
select public.get_my_company() -> 'company' as mc1 \gset
reset role;
select * from public.company_campaigns where id = (:'camp1'::jsonb ->> 'id')::uuid \gset c1_
-- the hour of the start: hours are counted from here on in this file
select date_trunc('hour', :'c1_started_at'::timestamptz) as h0 \gset
select tests.assert(
  (select array_agg(k order by k) from jsonb_object_keys(:'camp1'::jsonb) k)
    = array['cost_cents', 'demand_bps', 'ends_at', 'id', 'kind', 'resonance', 'started_at']
  and :'camp1'::jsonb ->> 'kind' = 'flyer' and (:'camp1'::jsonb ->> 'cost_cents')::bigint = 40000
  and (:'camp1'::jsonb ->> 'ends_at')::timestamptz - (:'camp1'::jsonb ->> 'started_at')::timestamptz = interval '24 hours'
  and (:'camp1'::jsonb ->> 'demand_bps')::int = round((:c1_demand_factor::float8 - 1) * 10000)
  and :'camp1'::jsonb ->> 'resonance' = public.campaign_resonance(:c1_luck::float8)
  and :c1_luck::float8 between 0.4 and 1.6
  and abs(:c1_demand_factor::float8 - public.campaign_factor('flyer', 1, :c1_luck::float8)) < 1e-12
  and :'camp1'::jsonb = :'camp1b'::jsonb,
  'start_campaign(): CAMPAIGN {id, kind, started_at, ends_at (+24 h), cost_cents, demand_bps, resonance}; luck rolled once; idempotent');
select tests.assert(
  tests.company_cash(:'aco') = :cc0::bigint - 40000
  and (select balance_cents from public.ledger_accounts where system_key = 'households') = :hh0::bigint + 40000
  and (select count(*) from public.ledger_transactions t
        where t.idempotency_key = 'campaign:' || :'aco' || ':' || :rq1 and t.kind = 'company_costs') = 1
  and (select sum(e.amount_cents) from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
        where t.idempotency_key = 'campaign:' || :'aco' || ':' || :rq1) = 0
  and (select count(*) from public.company_campaigns where company_id = :'aco') = 1,
  'start_campaign(): one balanced company_costs booking company cash -> households, charged once');
select tests.assert(
  abs((select awareness from public.player_companies where company_id = :'aco') - 0.405) < 1e-12
  and abs(:c1_awareness_gain::float8 - 0.005) < 1e-12
  and exists (select 1 from public.company_news n where n.company_id = :'aco' and n.kind = 'campaign_started'
                 and n.payload = jsonb_build_object('kind', 'flyer', 'resonance', :'camp1'::jsonb ->> 'resonance',
                                                    'demand_bps', (:'camp1'::jsonb ->> 'demand_bps')::int)),
  'start_campaign(): awareness +0.5 points at once; company news campaign_started {kind, resonance, demand_bps}');
select tests.assert(
  :'mc1'::jsonb -> 'campaign' = :'camp1'::jsonb
  and :'mc1'::jsonb -> 'campaign_costs' = '{"flyer": 40500, "online": 121500, "tv": 364500}'::jsonb,
  'COMPANY: campaign while it runs; campaign_costs follow the (higher) awareness');

-- the factor applies to hours that start inside the campaign window
select public.player_company_close_hour(:'aco', :'h0'::timestamptz - interval '1 hour') is not null as ok \gset
select public.player_company_close_hour(:'aco', :'h0'::timestamptz + interval '1 hour') is not null as ok \gset
select (tests.m4j_hour(:'aco', :'h0'::timestamptz - interval '1 hour')).demand_cents as d_out \gset
select (tests.m4j_hour(:'aco', :'h0'::timestamptz + interval '1 hour')).demand_cents as d_in \gset
select tests.assert(
  :d_out::bigint = 20250
  and abs(:d_in::bigint - round(20250 * :c1_demand_factor::float8)) <= 1
  and (tests.m4j_hour(:'aco', :'h0'::timestamptz - interval '1 hour')).campaign_id is null
  and (tests.m4j_hour(:'aco', :'h0'::timestamptz + interval '1 hour')).campaign_id = :'c1_id'::uuid
  and (public.company_campaign_at(:'aco', :'c1_ends_at'::timestamptz)).id is null
  and (public.company_campaign_at(:'aco', :'c1_ends_at'::timestamptz - interval '1 second')).id = :'c1_id'::uuid,
  'close_hour(): demand x the campaign factor for hours starting in [started_at, ends_at); campaign_id on the hour');
select tests.assert(
  public.company_campaign_costs(:'aco')
  = jsonb_build_object('flyer', public.campaign_cost_cents('flyer', :d_in), 'online', public.campaign_cost_cents('online', :d_in),
                       'tv', public.campaign_cost_cents('tv', :d_in))
  and (public.company_campaign_costs(:'aco') ->> 'online')::bigint = round(6 * :d_in::bigint / 100.0) * 100,
  'campaign_costs: from the demand of the last closed hour');

-- after the campaign: none in COMPANY; the next one is capped by the stage (stage 0: 50 %)
update public.company_campaigns set started_at = now() - interval '25 hours', ends_at = now() - interval '1 minute'
 where id = :'c1_id';
update public.player_companies set awareness = 0.498 where company_id = :'aco';
select tests.login_as('authenticated', :a);
select public.get_my_company() -> 'company' -> 'campaign' as mc2 \gset
select public.start_campaign(:rq2, :'aco', 'online') as camp2 \gset
reset role;
select tests.assert(
  :'mc2'::jsonb = 'null'::jsonb
  and (:'camp2'::jsonb ->> 'cost_cents')::bigint = public.campaign_cost_cents('online', :d_in)
  and (select awareness from public.player_companies where company_id = :'aco') = 0.5
  and abs((select awareness_gain from public.company_campaigns where id = (:'camp2'::jsonb ->> 'id')::uuid) - 0.002) < 1e-12,
  'start_campaign(): awareness capped by the stage (awarenessCaps[0] = 0.5); price from the last closed hour');
-- the second campaign lies in the past for the rest of this file
update public.company_campaigns set started_at = now() - interval '50 hours', ends_at = now() - interval '2 hours'
 where id = (:'camp2'::jsonb ->> 'id')::uuid;

-- =============================================================================
-- C. Trust (trustScore, trustBand)
-- =============================================================================
select tests.assert(
  public.player_trust(:e) = '{"score": 50, "band": "blank", "kept": 0, "broken": 0}'::jsonb
  and public.trust_band(0) = 'risky' and public.trust_band(29) = 'risky' and public.trust_band(30) = 'shaky'
  and public.trust_band(44) = 'shaky' and public.trust_band(45) = 'blank' and public.trust_band(59) = 'blank'
  and public.trust_band(60) = 'reliable' and public.trust_band(79) = 'reliable' and public.trust_band(80) = 'rock'
  and public.trust_band(100) = 'rock'
  and public.trust_delta('loanOverdue') = -6 and public.trust_delta('loanForgiven') = 2 and public.trust_delta('nonsense') = 0,
  'trust: start 50 (blank); bands risky 0 / shaky 30 / blank 45 / reliable 60 / rock 80; deltas from game_config');
select public.trust_add(:e, null, 'loanRepaidOnTime') + public.trust_add(:e, null, 'supplyKept') as t1 \gset
select tests.assert(
  :t1::int = 7 and public.player_trust(:e) = '{"score": 57, "band": "blank", "kept": 2, "broken": 0}'::jsonb,
  'trust: +4 (repaid on time) +3 (supply kept) = 57, kept 2');
select public.trust_add(:e, null, 'dealBroken') + public.trust_add(:e, null, 'dealBroken')
     + public.trust_add(:e, null, 'dealBroken') + public.trust_add(:e, null, 'loanDefaulted') as t2 \gset
select tests.assert(
  :t2::int = -48 and public.player_trust(:e) = '{"score": 9, "band": "risky", "kept": 2, "broken": 4}'::jsonb,
  'trust: three broken deals and a default: 9 (risky), broken 4');
insert into public.trust_events (player_id, reason, delta) values (:e, 'test', -100);
select tests.assert(public.trust_score(:e) = 0, 'trust: never below min (0)');
insert into public.trust_events (player_id, reason, delta) values (:e, 'test', 500);
select tests.assert(public.trust_score(:e) = 100 and public.trust_band(public.trust_score(:e)) = 'rock', 'trust: never above max (100)');
delete from public.trust_events where player_id = :e;

-- =============================================================================
-- D. propose_deal: checks
-- =============================================================================
select tests.login_as('authenticated', :d);
select tests.throws_key($$select public.propose_deal(gen_random_uuid(), 'loan', 'lender', null,
  '{"principal_cents": 100000, "interest_bps": 500, "hours": 48}', null)$$, 'locked', 'propose_deal(): from deals.minLevel (6)');
reset role;
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.propose_deal(gen_random_uuid(), 'gift', 'lender', null, '{}', null)$$, 'invalid_argument',
  'propose_deal(): unknown kind');
select tests.throws_key($$select public.propose_deal(gen_random_uuid(), 'loan', 'supplier', null, '{}', null)$$, 'invalid_argument',
  'propose_deal(): the role must fit the kind');
select tests.throws_key($$select public.propose_deal(gen_random_uuid(), 'loan', 'lender', 'Niemand_Da_Xyz',
  '{"principal_cents": 100000, "interest_bps": 500, "hours": 48}', null)$$, 'player_not_found', 'propose_deal(): unknown counterparty');
select tests.throws_key(format($$select public.propose_deal(gen_random_uuid(), 'loan', 'lender', %L,
  '{"principal_cents": 100000, "interest_bps": 500, "hours": 48}', null)$$, :'a_nick'), 'deal_self', 'propose_deal(): not with yourself');
select tests.throws_key(format($$select public.propose_deal(gen_random_uuid(), 'loan', 'lender', %L,
  '{"principal_cents": 100000, "interest_bps": 500, "hours": 48}', null)$$, '#' || :'a_tag'), 'deal_self',
  'propose_deal(): not with yourself (by tag)');
select tests.throws_key(format($$select public.propose_deal(gen_random_uuid(), 'loan', 'lender', %L, %L, null)$$, :'b_nick', x.t),
  'deal_terms', 'propose_deal(): loan terms ' || x.t)
  from (values ('{"principal_cents": 9999, "interest_bps": 500, "hours": 48}'),
               ('{"principal_cents": 12000001, "interest_bps": 500, "hours": 48}'),
               ('{"principal_cents": 100000, "interest_bps": 3001, "hours": 48}'),
               ('{"principal_cents": 100000, "interest_bps": -1, "hours": 48}'),
               ('{"principal_cents": 100000, "interest_bps": 500, "hours": 23}'),
               ('{"principal_cents": 100000, "interest_bps": 500, "hours": 721}'),
               ('{"principal_cents": "100000", "interest_bps": 500, "hours": 48}'),
               ('{"principal_cents": 100000.5, "interest_bps": 500, "hours": 48}'),
               ('{"interest_bps": 500, "hours": 48}'), ('[1, 2]')) x(t);
select tests.throws_key(format($$select public.propose_deal(gen_random_uuid(), 'supply', 'supplier', %L, %L, null)$$, :'b_nick', x.t),
  'deal_terms', 'propose_deal(): supply terms ' || x.t)
  from (values ('{"volume_cents_per_hour": 999, "fee_bps": 5000, "prepay_bps": 0, "hours": 24}'),
               ('{"volume_cents_per_hour": 1000, "fee_bps": 999, "prepay_bps": 0, "hours": 24}'),
               ('{"volume_cents_per_hour": 1000, "fee_bps": 9501, "prepay_bps": 0, "hours": 24}'),
               ('{"volume_cents_per_hour": 1000, "fee_bps": 5000, "prepay_bps": 5001, "hours": 24}'),
               ('{"volume_cents_per_hour": 1000, "fee_bps": 5000, "prepay_bps": 0, "hours": 337}')) x(t);
select tests.throws_key(format($$select public.propose_deal(gen_random_uuid(), 'stake', 'company', null, %L, null)$$, x.t),
  'deal_terms', 'propose_deal(): stake terms ' || x.t)
  from (values ('{"amount_cents": 9999, "share_bps": 1000, "hours": 24}'),
               ('{"amount_cents": 10000, "share_bps": 3001, "hours": 24}'),
               ('{"amount_cents": 10000, "share_bps": 0, "hours": 24}'),
               ('{"amount_cents": 10000, "share_bps": 1000, "hours": 721}')) x(t);
select tests.throws_key(format($$select public.propose_deal(gen_random_uuid(), 'loan', 'lender', %L,
  '{"principal_cents": 100000, "interest_bps": 500, "hours": 48}', %L)$$, :'b_nick', repeat('x', 141)), 'invalid_argument',
  'propose_deal(): message up to 140 characters');
select tests.throws_key(format($$select public.propose_deal(gen_random_uuid(), 'loan', 'lender', %L,
  '{"principal_cents": 100000, "interest_bps": 500, "hours": 48}', 'Du Arschloch')$$, :'b_nick'), 'name_profanity',
  'propose_deal(): the message passes the word filter');
select tests.throws_key(format($$select public.propose_deal(gen_random_uuid(), 'supply', 'supplier', %L,
  '{"volume_cents_per_hour": 1000, "fee_bps": 5000, "prepay_bps": 0, "hours": 24}', null)$$, :'e_nick'), 'deal_needs_company',
  'propose_deal(): the counterparty needs a company for its side');
reset role;
select tests.login_as('authenticated', :e);
select tests.throws_key($$select public.propose_deal(gen_random_uuid(), 'supply', 'supplier', null,
  '{"volume_cents_per_hour": 1000, "fee_bps": 5000, "prepay_bps": 0, "hours": 24}', null)$$, 'deal_needs_company',
  'propose_deal(): a supplier needs an own company');
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key(format($$select public.propose_deal(gen_random_uuid(), 'stake', 'investor', %L,
  '{"amount_cents": 10000, "share_bps": 1000, "hours": 24}', null)$$, :'e_nick'), 'deal_needs_company',
  'propose_deal(): a stake needs the counterparty''s company');
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.propose_deal(gen_random_uuid(), 'loan', 'borrower', 'Dirk_Neuling',
  '{"principal_cents": 4000001, "interest_bps": 0, "hours": 24}', null)$$, 'deal_terms',
  'propose_deal(): a targeted lender''s level caps the loan (level 2: 40 000 EUR)');
reset role;
select tests.assert(not exists (select 1 from public.deals where :a in (proposer_id, counterparty_id) or :b in (proposer_id, counterparty_id)),
  'propose_deal(): refused proposals store nothing');

-- =============================================================================
-- E. Loan 1: targeted, accepted, repaid on time (partly, then the rest)
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.propose_deal(:rq3, 'loan', 'lender', :'b_nick', '{"principal_cents": 100000, "interest_bps": 1000, "hours": 48}',
                           '  Für deinen Laden  ') as l1 \gset
select public.propose_deal(:rq3, 'loan', 'lender', :'b_nick', '{"principal_cents": 100000, "interest_bps": 1000, "hours": 48}',
                           '  Für deinen Laden  ') as l1b \gset
reset role;
select :'l1'::jsonb ->> 'id' as l1id \gset
select tests.assert(
  (select array_agg(k order by k) from jsonb_object_keys(:'l1'::jsonb) k)
    = array['accepted_at', 'broken_by_me', 'buyer_company', 'closed_at', 'company', 'counterparty', 'created_at', 'ends_at',
            'expires_at', 'id', 'is_proposer', 'kind', 'message', 'my_role', 'progress', 'proposer', 'proposer_role', 'status',
            'supplier_company', 'terms']
  and :'l1'::jsonb ->> 'proposer_role' = 'lender'
  and :'l1'::jsonb ->> 'kind' = 'loan' and :'l1'::jsonb ->> 'status' = 'open' and :'l1'::jsonb ->> 'my_role' = 'lender'
  and (:'l1'::jsonb ->> 'is_proposer')::boolean and not (:'l1'::jsonb ->> 'broken_by_me')::boolean
  and :'l1'::jsonb -> 'proposer' = jsonb_build_object('nickname', :'a_nick', 'tag', :'a_tag', 'avatar_key',
                                                       (select avatar_key from public.profiles where id = :a), 'level', 6,
                                                       'trust', '{"score": 50, "band": "blank"}'::jsonb)
  and :'l1'::jsonb -> 'counterparty' ->> 'nickname' = :'b_nick'
  and :'l1'::jsonb -> 'terms' = '{"principal_cents": 100000, "interest_bps": 1000, "hours": 48}'::jsonb
  and :'l1'::jsonb -> 'progress' = '{"due_cents": 110000, "repaid_cents": 0, "left_cents": 110000}'::jsonb
  and :'l1'::jsonb ->> 'message' = 'Für deinen Laden'
  and :'l1'::jsonb -> 'supplier_company' = 'null'::jsonb and :'l1'::jsonb -> 'company' = 'null'::jsonb
  and :'l1'::jsonb -> 'accepted_at' = 'null'::jsonb
  and (:'l1'::jsonb ->> 'expires_at')::timestamptz - (:'l1'::jsonb ->> 'created_at')::timestamptz = interval '48 hours'
  and :'l1'::jsonb = :'l1b'::jsonb
  and (select count(*) from public.deals where proposer_id = :a) = 1,
  'propose_deal(): DEAL of an open targeted loan (due = principal + interest), offer valid 48 h; idempotent');
select tests.assert(
  (tests.m4j_note(:b, 'deal_offer', :'a_nick' || ' bietet dir einen Kredit an')).link = '/deals'
  and (tests.m4j_note(:b, 'deal_offer', :'a_nick' || ' bietet dir einen Kredit an')).body
      = '1.000 NX für 2 Tage, 10 % Zinsen – „Für deinen Laden“'
  and (tests.m4j_note(:b, 'deal_offer', :'a_nick' || ' bietet dir einen Kredit an')).payload ->> 'deal_id' = :'l1id',
  'propose_deal(): the target gets a deal_offer notification');

-- visibility: the target sees it, a third player does not
select tests.login_as('authenticated', :e);
select count(*) as e_sees from public.deals where id = :'l1id' \gset
select public.get_deals() as e_deals \gset
select tests.throws_key(format($$select public.respond_deal(gen_random_uuid(), %L, true)$$, :'l1id'), 'deal_not_found',
  'respond_deal(): a stranger cannot answer a targeted offer');
reset role;
select tests.login_as('authenticated', :b);
select count(*) as b_sees from public.deals where id = :'l1id' \gset
select public.get_deals() as b_deals0 \gset
reset role;
select tests.login_as('authenticated', :a);
select public.get_deals() as a_deals0 \gset
select tests.throws_key(format($$select public.respond_deal(gen_random_uuid(), %L, true)$$, :'l1id'), 'deal_self',
  'respond_deal(): not the own offer');
reset role;
select tests.assert(
  :e_sees::int = 0 and :b_sees::int = 1
  and :'e_deals'::jsonb = '{"incoming": [], "outgoing": [], "running": [], "history": [],
                           "trust": {"score": 50, "band": "blank", "kept": 0, "broken": 0},
                           "limits": {"company_deal_max_cents": null, "loan_max_cents": 12000000}}'::jsonb
  and jsonb_array_length(:'b_deals0'::jsonb -> 'incoming') = 1 and :'b_deals0'::jsonb -> 'incoming' -> 0 ->> 'my_role' = 'borrower'
  and not (:'b_deals0'::jsonb -> 'incoming' -> 0 ->> 'is_proposer')::boolean
  and :'a_deals0'::jsonb -> 'outgoing' -> 0 ->> 'id' = :'l1id' and jsonb_array_length(:'a_deals0'::jsonb -> 'incoming') = 0,
  'RLS and get_deals(): the target sees the offer (incoming, my_role borrower), the proposer (outgoing), a stranger nothing');

select tests.cash(:a) as a0 \gset
select tests.cash(:b) as b0 \gset
select tests.login_as('authenticated', :b);
select public.respond_deal(:rq4, :'l1id', true) as l1a \gset
select public.respond_deal(:rq4, :'l1id', true) as l1a2 \gset
select tests.throws_key(format($$select public.respond_deal(gen_random_uuid(), %L, true)$$, :'l1id'), 'deal_closed',
  'respond_deal(): an accepted offer is closed');
select tests.throws_key(format($$select public.break_deal(gen_random_uuid(), %L)$$, :'l1id'), 'invalid_argument',
  'break_deal(): loans cannot be broken');
reset role;
select tests.assert(
  :'l1a'::jsonb ->> 'status' = 'active' and :'l1a'::jsonb ->> 'my_role' = 'borrower' and :'l1a'::jsonb = :'l1a2'::jsonb
  and (:'l1a'::jsonb ->> 'ends_at')::timestamptz - (:'l1a'::jsonb ->> 'accepted_at')::timestamptz = interval '48 hours'
  and (tests.m4j_deal(:'l1id')).lender_id = :a and (tests.m4j_deal(:'l1id')).borrower_id = :b
  and (tests.m4j_deal(:'l1id')).counterparty_id = :b and (tests.m4j_deal(:'l1id')).due_cents = 110000
  and tests.cash(:a) = :a0::bigint - 100000 and tests.cash(:b) = :b0::bigint + 100000
  and (select count(*) from public.ledger_transactions t where t.idempotency_key = 'deal:' || :'l1id' || ':principal'
          and t.kind = 'loan_disbursement' and t.ref_type = 'deal') = 1
  and not exists (select 1 from public.ledger_audit()),
  'respond_deal(): accepting a loan moves the principal lender -> borrower once (balanced); active for 48 h');
select tests.assert(
  (tests.m4j_note(:a, 'deal_result', :'b_nick' || ' hat deinen Kredit angenommen')).id is not null
  and exists (select 1 from public.feed_items fi where fi.actor_id = :b and fi.kind = 'deal_signed'
                 and fi.payload = jsonb_build_object('kind', 'loan', 'with', :'a_nick')),
  'respond_deal(): the proposer is told, the acceptor posts deal_signed {kind, with} in the feed');

select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.repay_loan(gen_random_uuid(), %L, 1000)$$, :'l1id'), 'invalid_argument',
  'repay_loan(): only the borrower');
reset role;
select tests.login_as('authenticated', :e);
select tests.throws_key(format($$select public.repay_loan(gen_random_uuid(), %L, 1000)$$, :'l1id'), 'deal_not_found',
  'repay_loan(): strangers do not see the loan');
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.repay_loan(gen_random_uuid(), %L, 0)$$, :'l1id'), 'invalid_argument',
  'repay_loan(): a positive amount');
select tests.throws_key(format($$select public.repay_loan(gen_random_uuid(), %L, 999999999)$$, :'l1id'), 'insufficient_funds',
  'repay_loan(): not more than the cash');
select public.repay_loan(:rq1, :'l1id', 50000) as r1 \gset
select public.repay_loan(:rq1, :'l1id', 50000) as r1b \gset
select tests.cash(:b) as b1 \gset
select public.repay_loan(:rq2, :'l1id', 200000) as r2 \gset
reset role;
select tests.assert(
  :'r1'::jsonb -> 'progress' = '{"due_cents": 110000, "repaid_cents": 50000, "left_cents": 60000}'::jsonb
  and :'r1'::jsonb ->> 'status' = 'active' and :'r1'::jsonb = :'r1b'::jsonb
  and :'r2'::jsonb ->> 'status' = 'completed' and (:'r2'::jsonb -> 'progress' ->> 'left_cents')::bigint = 0
  and tests.cash(:b) = :b1::bigint - 60000
  and tests.cash(:a) = :a0::bigint - 100000 + 110000
  and (:'r2'::jsonb ->> 'closed_at') is not null,
  'repay_loan(): pays min(amount, rest); idempotent; fully repaid = completed');
select tests.assert(
  public.player_trust(:b) = '{"score": 54, "band": "blank", "kept": 1, "broken": 0}'::jsonb
  and public.player_trust(:a) = '{"score": 51, "band": "blank", "kept": 0, "broken": 0}'::jsonb
  and public.trust_add(:b, :'l1id', 'loanRepaidOnTime') = 0
  and (select count(*) from public.trust_events where deal_id = :'l1id') = 2
  and (tests.m4j_note(:a, 'deal_result', :'b_nick' || ' hat den Kredit zurückgezahlt')).id is not null,
  'loan repaid on time: borrower +4 (kept 1), lender +1 (loanLent); once per deal and reason; lender told');

-- =============================================================================
-- F. Loan 2: open offer on the board (borrower), accepted by a lender, overdue, repaid late
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.propose_deal(gen_random_uuid(), 'loan', 'borrower', null, '{"principal_cents": 50000, "interest_bps": 0, "hours": 24}',
                           null) as l2 \gset
reset role;
select :'l2'::jsonb ->> 'id' as l2id \gset
select tests.login_as('authenticated', :e);
select count(*) as e_sees_board from public.deals where id = :'l2id' \gset
select public.get_deal_board() as board_e \gset
select tests.throws_key(format($$select public.respond_deal(gen_random_uuid(), %L, false)$$, :'l2id'), 'invalid_argument',
  'respond_deal(): an open board offer cannot be declined (it stays open)');
reset role;
select tests.login_as('authenticated', :b);
select public.get_deal_board() as board_b \gset
reset role;
select tests.assert(
  :'l2'::jsonb -> 'counterparty' = 'null'::jsonb and :'l2'::jsonb ->> 'my_role' = 'borrower'
  and :e_sees_board::int = 1
  and exists (select 1 from jsonb_array_elements(:'board_e'::jsonb -> 'offers') o
               where o ->> 'id' = :'l2id' and o -> 'my_role' = 'null'::jsonb and not (o ->> 'is_proposer')::boolean
                 and o ->> 'proposer_role' = 'borrower')
  and not exists (select 1 from jsonb_array_elements(:'board_b'::jsonb -> 'offers') o where o ->> 'id' = :'l2id')
  and not exists (select 1 from jsonb_array_elements(:'board_e'::jsonb -> 'offers') o where o ->> 'id' = :'l1id'),
  'board: open offers are visible to everyone (RLS, get_deal_board without own and targeted offers)');
select tests.cash(:a) as a2 \gset
select tests.login_as('authenticated', :a);
select public.respond_deal(gen_random_uuid(), :'l2id', true) as l2a \gset
reset role;
select tests.assert(
  :'l2a'::jsonb ->> 'my_role' = 'lender' and (tests.m4j_deal(:'l2id')).lender_id = :a
  and (tests.m4j_deal(:'l2id')).counterparty_id = :a and (tests.m4j_deal(:'l2id')).board
  and tests.cash(:a) = :a2::bigint - 50000,
  'respond_deal(): any eligible player takes a board offer, here as the lender');
-- the due date passed with only 100 EUR on the borrower's cash: collected once, then overdue
select tests.m4j_drain_player(:b, 10000, 'test:m4j:drain:b1');
update public.deals set accepted_at = now() - interval '25 hours', ends_at = now() - interval '1 hour' where id = :'l2id';
select public.deals_run_due(now()) as j1 \gset
select tests.assert(
  (tests.m4j_deal(:'l2id')).status = 'overdue' and (tests.m4j_deal(:'l2id')).repaid_cents = 10000
  and tests.cash(:b) = 0 and tests.cash(:a) = :a2::bigint - 50000 + 10000
  and (:'j1'::jsonb ->> 'loans_due')::int >= 1
  and public.trust_score(:b) = 54 - 6
  and (tests.m4j_note(:b, 'deal_result', 'Kredit überfällig')).id is not null
  and (tests.m4j_note(:a, 'deal_result', :'b_nick' || ' ist mit dem Kredit im Verzug')).id is not null,
  'due date: the free cash is collected once (100 EUR), the rest is overdue (-6), both are told');
select tests.fund(:b, 100000, 'test:m4j:b2');
select public.deals_run_due(now()) is not null as ok \gset
select tests.assert(
  (tests.m4j_deal(:'l2id')).repaid_cents = 10000 and tests.cash(:b) = 100000,
  'overdue: no automatic collection after the due date');
select tests.login_as('authenticated', :b);
select public.repay_loan(gen_random_uuid(), :'l2id', 40000) as l2r \gset
reset role;
select tests.assert(
  :'l2r'::jsonb ->> 'status' = 'completed' and tests.cash(:b) = 60000
  and public.player_trust(:b) = '{"score": 50, "band": "blank", "kept": 2, "broken": 0}'::jsonb
  and public.trust_score(:a) = 52,
  'repaid late: completed, borrower +2 (54 - 6 + 2), lender +1');

-- =============================================================================
-- G. Loan 3: defaulted, then forgiven
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.propose_deal(gen_random_uuid(), 'loan', 'lender', :'e_nick', '{"principal_cents": 20000, "interest_bps": 500, "hours": 24}',
                           null) ->> 'id' as l3id \gset
reset role;
select tests.login_as('authenticated', :e);
select public.respond_deal(gen_random_uuid(), :'l3id', true) is not null as ok \gset
reset role;
select tests.m4j_drain_player(:e, 0, 'test:m4j:drain:e1');
update public.deals set accepted_at = now() - interval '193 hours', ends_at = now() - interval '169 hours' where id = :'l3id';
select public.deals_run_due(now()) as j2 \gset
select tests.assert(
  (tests.m4j_deal(:'l3id')).status = 'defaulted' and (tests.m4j_deal(:'l3id')).repaid_cents = 0
  and (:'j2'::jsonb ->> 'loans_defaulted')::int >= 1
  and public.player_trust(:e) = '{"score": 32, "band": "shaky", "kept": 0, "broken": 1}'::jsonb
  and exists (select 1 from public.feed_items fi where fi.actor_id = :e and fi.kind = 'loan_defaulted'
                 and fi.payload = jsonb_build_object('with', :'a_nick'))
  and (tests.m4j_note(:e, 'deal_result', 'Kredit geplatzt')).id is not null
  and (tests.m4j_note(:a, 'deal_result', 'Kredit an ' || :'e_nick' || ' geplatzt')).id is not null,
  'default: overdue (-6) and defaultAfterHours (168) later defaulted (-12), feed loan_defaulted {with}, both told');
select tests.login_as('authenticated', :e);
select tests.throws_key(format($$select public.forgive_loan(gen_random_uuid(), %L)$$, :'l3id'), 'invalid_argument',
  'forgive_loan(): only the lender');
reset role;
select tests.login_as('authenticated', :a);
select public.forgive_loan(gen_random_uuid(), :'l3id') as l3f \gset
select tests.throws_key(format($$select public.forgive_loan(gen_random_uuid(), %L)$$, :'l3id'), 'deal_closed',
  'forgive_loan(): only once');
reset role;
select tests.assert(
  :'l3f'::jsonb ->> 'status' = 'forgiven' and (:'l3f'::jsonb -> 'progress' ->> 'left_cents')::bigint = 21000
  and public.trust_score(:a) = 52 + 2 + 1
  and (tests.m4j_note(:e, 'deal_result', :'a_nick' || ' hat dir den Rest erlassen')).id is not null,
  'forgive_loan(): forgiven, lender +2 (forgiven) +1 (lent), borrower told');

-- =============================================================================
-- H. Decline, cancel, expire, limits
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.propose_deal(gen_random_uuid(), 'loan', 'lender', :'b_nick', '{"principal_cents": 10000, "interest_bps": 0, "hours": 24}',
                           null) ->> 'id' as l4id \gset
select public.propose_deal(gen_random_uuid(), 'loan', 'lender', :'c_nick', '{"principal_cents": 10000, "interest_bps": 0, "hours": 24}',
                           null) ->> 'id' as l5id \gset
select public.propose_deal(gen_random_uuid(), 'loan', 'lender', null, '{"principal_cents": 10000, "interest_bps": 0, "hours": 24}',
                           null) ->> 'id' as l6id \gset
reset role;
select tests.login_as('authenticated', :b);
select public.respond_deal(gen_random_uuid(), :'l4id', false) as l4d \gset
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key(format($$select public.cancel_deal(gen_random_uuid(), %L)$$, :'l5id'), 'deal_not_found',
  'cancel_deal(): only the proposer');
reset role;
select tests.login_as('authenticated', :a);
select public.cancel_deal(gen_random_uuid(), :'l5id') as l5c \gset
select tests.throws_key(format($$select public.cancel_deal(gen_random_uuid(), %L)$$, :'l5id'), 'deal_closed',
  'cancel_deal(): only open offers');
reset role;
update public.deals set expires_at = now() - interval '1 minute' where id = :'l6id';
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.respond_deal(gen_random_uuid(), %L, true)$$, :'l6id'), 'deal_closed',
  'respond_deal(): an expired offer is closed');
reset role;
select public.deals_run_due(now()) as j3 \gset
select tests.assert(
  :'l4d'::jsonb ->> 'status' = 'declined' and (tests.m4j_deal(:'l4id')).closed_at is not null
  and (tests.m4j_note(:a, 'deal_result', :'b_nick' || ' hat deinen Kredit abgelehnt')).id is not null
  and :'l5c'::jsonb ->> 'status' = 'cancelled'
  and (tests.m4j_deal(:'l6id')).status = 'expired' and (:'j3'::jsonb ->> 'expired')::int >= 1,
  'declined (proposer told), cancelled by the proposer, expired by the job');
select tests.login_as('authenticated', :a);
select public.get_deals() as a_deals1 \gset
reset role;
select tests.assert(
  jsonb_array_length(:'a_deals1'::jsonb -> 'outgoing') = 0 and jsonb_array_length(:'a_deals1'::jsonb -> 'running') = 0
  and (select array_agg(x ->> 'status' order by x ->> 'status') from jsonb_array_elements(:'a_deals1'::jsonb -> 'history') x)
      = array['cancelled', 'completed', 'completed', 'declined', 'expired', 'forgiven']
  and :'a_deals1'::jsonb -> 'trust' = public.player_trust(:a),
  'get_deals(): history holds the closed deals newest first, trust of the caller');

select tests.set_cfg('deals', '{maxOpenOffers}', '1');
select tests.login_as('authenticated', :a);
select public.propose_deal(gen_random_uuid(), 'loan', 'lender', null, '{"principal_cents": 10000, "interest_bps": 0, "hours": 24}',
                           null) ->> 'id' as l7id \gset
select tests.throws_key($$select public.propose_deal(gen_random_uuid(), 'loan', 'lender', null,
  '{"principal_cents": 10000, "interest_bps": 0, "hours": 24}', null)$$, 'deal_limit', 'propose_deal(): maxOpenOffers');
reset role;
select tests.set_cfg('deals', '{maxOpenOffers}', '5');
select tests.set_cfg('deals', '{maxActivePerKind}', '0');
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.propose_deal(gen_random_uuid(), 'loan', 'lender', null,
  '{"principal_cents": 10000, "interest_bps": 0, "hours": 24}', null)$$, 'deal_limit', 'propose_deal(): maxActivePerKind');
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.respond_deal(gen_random_uuid(), %L, true)$$, :'l7id'), 'deal_limit',
  'respond_deal(): maxActivePerKind');
reset role;
select tests.set_cfg('deals', '{maxActivePerKind}', '5');
select tests.login_as('authenticated', :a);
select public.cancel_deal(gen_random_uuid(), :'l7id') is not null as ok \gset
reset role;

-- =============================================================================
-- I. Supply 1: targeted, prepayment, one settled hour, broken by the supplier (the prepayment stays)
-- =============================================================================
-- supplier: almost no own demand, so its capacity is free; buyer: far more demand than capacity
update public.player_companies set potential_annual_cents = 1, awareness = 0.5, quality = 1, contract_work = true
 where company_id = :'aco';
update public.player_companies set potential_annual_cents = 9600000, awareness = 0.5, quality = 1, price_level = 'normal'
 where company_id = :'bco';
select tests.login_as('authenticated', :a);
select public.propose_deal(gen_random_uuid(), 'supply', 'supplier', :'b_nick',
         '{"volume_cents_per_hour": 30000, "fee_bps": 5000, "prepay_bps": 5000, "hours": 24}', 'Ware auf Abruf') as s1 \gset
reset role;
select :'s1'::jsonb ->> 'id' as s1id \gset
select tests.company_cash(:'aco') as ac0 \gset
select tests.company_cash(:'bco') as bc0 \gset
select tests.login_as('authenticated', :b);
select public.respond_deal(gen_random_uuid(), :'s1id', true) as s1a \gset
reset role;
select tests.assert(
  :'s1'::jsonb -> 'terms' = '{"volume_cents_per_hour": 30000, "fee_bps": 5000, "prepay_bps": 5000, "hours": 24}'::jsonb
  and :'s1'::jsonb -> 'progress' = '{"delivered_cents": 0, "needed_cents": 0, "fees_paid_cents": 0, "prepay_cents": 180000,
                                     "prepay_left_cents": 0}'::jsonb
  and :'s1'::jsonb -> 'supplier_company' = jsonb_build_object('id', :'aco', 'name', 'Lieferwerk Anja')
  and :'s1'::jsonb -> 'buyer_company' = jsonb_build_object('id', :'bco', 'name', 'Kundenladen Bodo')
  and :'s1a'::jsonb ->> 'status' = 'active' and :'s1a'::jsonb ->> 'my_role' = 'buyer'
  and (:'s1a'::jsonb -> 'progress' ->> 'prepay_left_cents')::bigint = 180000
  and tests.company_cash(:'aco') = :ac0::bigint + 180000 and tests.company_cash(:'bco') = :bc0::bigint - 180000
  and (tests.m4j_deal(:'s1id')).settled_until = public.deal_first_hour((tests.m4j_deal(:'s1id')).accepted_at)
  and public.deal_first_hour('2026-11-13 10:20:00+00') = '2026-11-13 11:00:00+00'
  and public.deal_first_hour('2026-11-13 10:00:00+00') = '2026-11-13 10:00:00+00',
  'supply accepted: prepayment applyBps(applyBps(volume x hours, fee), prepay) = 1 800 EUR buyer -> supplier; from the next full hour');
-- one clean hour T1 for both companies
select :'h0'::timestamptz + interval '10 hours' as t1 \gset
update public.deals set settled_until = :'t1', ends_at = :'t1'::timestamptz + interval '24 hours' where id = :'s1id';
select public.player_company_close_hour(:'aco', :'t1') is not null and public.player_company_close_hour(:'bco', :'t1') is not null as ok \gset
select * from public.player_company_hours where company_id = :'aco' and hour_start = :'t1' \gset sa_
select * from public.player_company_hours where company_id = :'bco' and hour_start = :'t1' \gset sb_
select tests.company_cash(:'aco') as ac1 \gset
select tests.company_cash(:'bco') as bc1 \gset
select balance_cents as hh1 from public.ledger_accounts where system_key = 'households' \gset
select public.deals_run_due(now()) as j4 \gset
select tests.assert(
  :sa_contract_revenue_cents::bigint > 0
  and (:sa_capacity_cents::bigint - :sa_demand_cents::bigint) * 0.75 >= 30000
  and :sb_demand_cents::bigint - :sb_capacity_cents::bigint >= 30000,
  'setup: the supplier has free capacity (contract work takes 25 %), the buyer is sold out');
select tests.assert(
  (tests.m4j_deal(:'s1id')).delivered_cents = 30000 and (tests.m4j_deal(:'s1id')).needed_cents = 30000
  and (tests.m4j_deal(:'s1id')).fees_paid_cents = 15000 and (tests.m4j_deal(:'s1id')).prepay_left_cents = 165000
  and (tests.m4j_deal(:'s1id')).settled_until = :'t1'::timestamptz + interval '1 hour'
  and (tests.m4j_hour(:'bco', :'t1')).supply_in_cents = 30000
  and (tests.m4j_hour(:'bco', :'t1')).supply_revenue_cents = 30000
  and (tests.m4j_hour(:'bco', :'t1')).supply_fee_paid_cents = 15000
  and (tests.m4j_hour(:'bco', :'t1')).profit_cents = :sb_profit_cents::bigint + 15000
  and (tests.m4j_hour(:'aco', :'t1')).supply_out_cents = 30000
  and (tests.m4j_hour(:'aco', :'t1')).supply_fee_income_cents = 15000
  and (tests.m4j_hour(:'aco', :'t1')).supply_goods_cents = 7500
  and (tests.m4j_hour(:'aco', :'t1')).profit_cents = :sa_profit_cents::bigint + 7500
  and tests.company_cash(:'bco') = :bc1::bigint + 30000 and tests.company_cash(:'aco') = :ac1::bigint - 7500
  and (select balance_cents from public.ledger_accounts where system_key = 'households') = :hh1::bigint - 30000 + 7500
  and (:'j4'::jsonb ->> 'supply_hours')::int >= 1
  and not exists (select 1 from public.ledger_audit()),
  'supply hour: 300 EUR delivered (min(volume, unmet, free)), fee 50 % from the prepayment, buyer sells at its price, '
  'supplier pays the goods; profit of both hours adjusted; balanced');
select tests.assert(
  public.deal_settle_supply(:'s1id') = 0 and (tests.m4j_deal(:'s1id')).delivered_cents = 30000,
  'supply: an hour is settled only once (and only when both companies closed it)');
select tests.login_as('authenticated', :c);
select tests.throws_key(format($$select public.break_deal(gen_random_uuid(), %L)$$, :'s1id'), 'deal_not_found',
  'break_deal(): strangers do not see the contract');
reset role;
select tests.company_cash(:'bco') as bc2 \gset
select tests.login_as('authenticated', :a);
select public.break_deal(gen_random_uuid(), :'s1id') as s1x \gset
select tests.throws_key(format($$select public.break_deal(gen_random_uuid(), %L)$$, :'s1id'), 'deal_closed',
  'break_deal(): only active deals');
reset role;
select tests.assert(
  :'s1x'::jsonb ->> 'status' = 'broken' and (:'s1x'::jsonb ->> 'broken_by_me')::boolean
  and (:'s1x'::jsonb -> 'progress' ->> 'prepay_left_cents')::bigint = 165000
  and tests.company_cash(:'bco') = :bc2::bigint
  and public.trust_score(:a) = 55 - 12
  and exists (select 1 from public.feed_items fi where fi.actor_id = :a and fi.kind = 'deal_broken'
                 and fi.payload = jsonb_build_object('kind', 'supply', 'with', :'b_nick'))
  and (tests.m4j_note(:b, 'deal_result', :'a_nick' || ' hat den Liefervertrag beendet')).id is not null,
  'break_deal(): broken by the supplier, the prepayment left stays with it, dealBroken -12, feed deal_broken, buyer told');

-- =============================================================================
-- J. Supply 2: board offer of the buyer; fee partly from cash; a buyer short of money; short delivery at the end
-- =============================================================================
select tests.login_as('authenticated', :b);
select public.propose_deal(gen_random_uuid(), 'supply', 'buyer', null,
         '{"volume_cents_per_hour": 30000, "fee_bps": 9000, "prepay_bps": 1000, "hours": 24}', null) ->> 'id' as s2id \gset
reset role;
select tests.company_cash(:'bco') as bc3 \gset
select tests.login_as('authenticated', :a);
select public.respond_deal(gen_random_uuid(), :'s2id', true) as s2a \gset
reset role;
select :'h0'::timestamptz + interval '20 hours' as t2 \gset
update public.deals set settled_until = :'t2', ends_at = :'t2'::timestamptz + interval '4 hours', prepay_left_cents = 10000
 where id = :'s2id';
select tests.assert(
  :'s2a'::jsonb ->> 'my_role' = 'supplier' and (tests.m4j_deal(:'s2id')).prepay_cents = 64800
  and tests.company_cash(:'bco') = :bc3::bigint - 64800,
  'supply from the board: the supplier takes it, the buyer prepays 648 EUR');
-- T2: fee 270 EUR, 100 EUR from the prepayment, 170 EUR from the buyer's cash
select public.player_company_close_hour(:'aco', :'t2') is not null and public.player_company_close_hour(:'bco', :'t2') is not null as ok \gset
select tests.company_cash(:'aco') as ac4 \gset
select tests.company_cash(:'bco') as bc4 \gset
select public.deals_run_due(now()) is not null as ok \gset
select tests.assert(
  (tests.m4j_deal(:'s2id')).fees_paid_cents = 27000 and (tests.m4j_deal(:'s2id')).prepay_left_cents = 0
  and tests.company_cash(:'bco') = :bc4::bigint + 30000 - 17000 and tests.company_cash(:'aco') = :ac4::bigint + 17000 - 7500
  and (select count(*) from public.ledger_transactions t
        where t.idempotency_key = 'deal:' || :'s2id' || ':' || to_char(:'t2'::timestamptz at time zone 'UTC', 'YYYYMMDDHH24') || ':fee'
          and t.kind = 'company_costs') = 1,
  'supplyFeeSplit: the prepayment first, the rest from the buyer''s cash');
-- T2 + 1 h: budget price (0.8) below the fee (0.9) and only 10 EUR cash: the delivery shrinks to what the buyer can pay
select public.player_company_close_hour(:'aco', :'t2'::timestamptz + interval '1 hour') is not null as ok \gset
update public.player_companies set price_level = 'budget' where company_id = :'bco';
select public.player_company_close_hour(:'bco', :'t2'::timestamptz + interval '1 hour') is not null as ok \gset
update public.player_companies set unpaid_cents = 0 where company_id = :'bco';
select tests.m4j_drain(:'bco', 1000, 'test:m4j:drain:bco1');
select public.deals_run_due(now()) is not null as ok \gset
select tests.assert(
  (tests.m4j_deal(:'s2id')).delivered_cents = 30000 + 9990 and (tests.m4j_deal(:'s2id')).needed_cents = 30000 + 9990
  and (tests.m4j_deal(:'s2id')).fees_paid_cents = 27000 + 8991
  and (tests.m4j_hour(:'bco', :'t2'::timestamptz + interval '1 hour')).supply_revenue_cents = 7992
  and (tests.m4j_hour(:'aco', :'t2'::timestamptz + interval '1 hour')).supply_goods_cents = 2498
  and tests.company_cash(:'bco') = 1,
  'supply: a buyer short of money gets only what it can pay for (99,90 EUR at 0.9 fee / 0.8 price with 10 EUR cash)');
-- T2 + 2 h, T2 + 3 h: the supplier is sold out itself, nothing delivered; then the term is over: short
update public.player_companies set potential_annual_cents = 1000000000 where company_id = :'aco';
select public.player_company_close_hour(:'aco', :'t2'::timestamptz + interval '2 hours') is not null
   and public.player_company_close_hour(:'aco', :'t2'::timestamptz + interval '3 hours') is not null
   and public.player_company_close_hour(:'bco', :'t2'::timestamptz + interval '2 hours') is not null
   and public.player_company_close_hour(:'bco', :'t2'::timestamptz + interval '3 hours') is not null as ok \gset
select public.trust_score(:a) as ta0 \gset
select public.trust_score(:b) as tb0 \gset
select public.deals_run_due(now()) is not null as ok \gset
select tests.assert(
  (tests.m4j_deal(:'s2id')).status = 'completed' and (tests.m4j_deal(:'s2id')).delivered_cents = 39990
  and (tests.m4j_deal(:'s2id')).needed_cents = 99990
  and public.trust_score(:a) = :ta0::int - 4 and public.trust_score(:b) = :tb0::int + 3
  and exists (select 1 from public.trust_events where deal_id = :'s2id' and player_id = :a and reason = 'supplyShort')
  and (tests.m4j_note(:a, 'deal_result', 'Liefervertrag beendet: zu wenig geliefert')).id is not null,
  'supply end: delivered 40 % < keptDeliveryBps (50 %) of what was needed: supplier -4 (short), buyer +3');

-- =============================================================================
-- K. Supply 3: kept, the prepayment left goes back to the buyer
-- =============================================================================
update public.player_companies set potential_annual_cents = 1 where company_id = :'aco';
update public.player_companies set price_level = 'normal' where company_id = :'bco';
select tests.m4j_drain(:'bco', 500000, 'test:m4j:fill:bco2');
select tests.login_as('authenticated', :a);
select public.propose_deal(gen_random_uuid(), 'supply', 'supplier', :'b_nick',
         '{"volume_cents_per_hour": 20000, "fee_bps": 5000, "prepay_bps": 5000, "hours": 24}', null) ->> 'id' as s3id \gset
reset role;
select tests.login_as('authenticated', :b);
select public.respond_deal(gen_random_uuid(), :'s3id', true) is not null as ok \gset
reset role;
select :'h0'::timestamptz + interval '30 hours' as t3 \gset
update public.deals set settled_until = :'t3', ends_at = :'t3'::timestamptz + interval '1 hour' where id = :'s3id';
select public.player_company_close_hour(:'aco', :'t3') is not null and public.player_company_close_hour(:'bco', :'t3') is not null as ok \gset
select tests.company_cash(:'aco') as ac5 \gset
select tests.company_cash(:'bco') as bc5 \gset
select public.trust_score(:a) as ta1 \gset
select public.trust_score(:b) as tb1 \gset
select public.deals_run_due(now()) is not null as ok \gset
select tests.assert(
  (tests.m4j_deal(:'s3id')).status = 'completed' and (tests.m4j_deal(:'s3id')).prepay_cents = 120000
  and (tests.m4j_deal(:'s3id')).delivered_cents = 20000 and (tests.m4j_deal(:'s3id')).prepay_left_cents = 0
  and tests.company_cash(:'bco') = :bc5::bigint + 20000 + 110000
  and tests.company_cash(:'aco') = :ac5::bigint - 5000 - 110000
  and (select count(*) from public.ledger_transactions where idempotency_key = 'deal:' || :'s3id' || ':refund') = 1
  and public.trust_score(:a) = :ta1::int + 3 and public.trust_score(:b) = :tb1::int + 3
  and not exists (select 1 from public.ledger_audit()),
  'supply end: kept (both +3), the 1 100 EUR left of the prepayment go back to the buyer');

-- =============================================================================
-- L. Stakes: share cap, payout before the CEO payout, capped by the free cash, completed; broken by the founder
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.set_founder_payout(gen_random_uuid(), 5000) is not null as ok \gset
select public.propose_deal(gen_random_uuid(), 'stake', 'company', null, '{"amount_cents": 100000, "share_bps": 2000, "hours": 24}',
                           null) as k1 \gset
select public.propose_deal(gen_random_uuid(), 'stake', 'company', null, '{"amount_cents": 100000, "share_bps": 3000, "hours": 24}',
                           null) ->> 'id' as k1bid \gset
select tests.throws_key($$select public.propose_deal(gen_random_uuid(), 'stake', 'company', null,
  '{"amount_cents": 100000, "share_bps": 1, "hours": 24}', null)$$, 'stake_share_full',
  'propose_deal(): running and open stakes of a company stay within maxTotalShareBps (50 %)');
select public.cancel_deal(gen_random_uuid(), :'k1bid') is not null as ok \gset
reset role;
select :'k1'::jsonb ->> 'id' as k1id \gset
select tests.cash(:c) as cc_0 \gset
select tests.company_cash(:'aco') as ac6 \gset
select tests.login_as('authenticated', :c);
select public.respond_deal(gen_random_uuid(), :'k1id', true) as k1a \gset
reset role;
select tests.assert(
  :'k1'::jsonb -> 'company' = jsonb_build_object('id', :'aco', 'name', 'Lieferwerk Anja')
  and :'k1a'::jsonb ->> 'my_role' = 'investor' and (tests.m4j_deal(:'k1id')).investor_id = :c
  and tests.cash(:c) = :cc_0::bigint - 100000 and tests.company_cash(:'aco') = :ac6::bigint + 100000
  and (select count(*) from public.ledger_transactions where idempotency_key = 'deal:' || :'k1id' || ':stake'
          and kind = 'angel_investment') = 1,
  'stake accepted: the investor''s money goes into the company');
select :'h0'::timestamptz + interval '40 hours' as t4 \gset
update public.deals set settled_until = :'t4', ends_at = :'t4'::timestamptz + interval '2 hours' where id = :'k1id';
-- 2 400 000 a year at 50 % awareness: own sales below the capacity, a profitable hour
update public.player_companies set potential_annual_cents = 2400000, awareness = 0.5, quality = 1, unpaid_cents = 0
 where company_id = :'aco';
select tests.cash(:c) as cc_1 \gset
select tests.cash(:a) as ca_1 \gset
select public.player_company_close_hour(:'aco', :'t4') as k1h \gset
select * from public.player_company_hours where company_id = :'aco' and hour_start = :'t4' \gset k_
select tests.assert(
  :k_profit_cents::bigint > 0
  and :k_stake_payout_cents::bigint = :k_profit_cents::bigint * 2000 / 10000
  and :k_founder_payout_cents::bigint = (:k_profit_cents::bigint - :k_stake_payout_cents::bigint) * 5000 / 10000
  and (:'k1h'::jsonb ->> 'stake_payout_cents')::bigint = :k_stake_payout_cents::bigint
  and tests.cash(:c) = :cc_1::bigint + :k_stake_payout_cents::bigint
  and tests.cash(:a) = :ca_1::bigint + :k_founder_payout_cents::bigint
  and (tests.m4j_deal(:'k1id')).payouts_cents = :k_stake_payout_cents::bigint
  and (tests.m4j_deal(:'k1id')).settled_until = :'t4'::timestamptz + interval '1 hour'
  and (select count(*) from public.ledger_transactions
        where idempotency_key = 'pch:' || :'aco' || ':' || to_char(:'t4'::timestamptz at time zone 'UTC', 'YYYYMMDDHH24')
                                || ':stake:' || :'k1id' and kind = 'dividend') = 1,
  'stake payout: 20 % of the profitable hour (rounded down) to the investor before the CEO payout (50 % of the rest)');
-- T4 + 1 h: open bills eat the cash, only a tenth of the profit is free: the stake gets that, the founder nothing
select tests.m4j_drain(:'aco', 0, 'test:m4j:drain:aco1');
update public.player_companies set unpaid_cents = :k_profit_cents::bigint - :k_profit_cents::bigint / 10 where company_id = :'aco';
select tests.cash(:c) as cc_2 \gset
select tests.cash(:a) as ca_2 \gset
select public.player_company_close_hour(:'aco', :'t4'::timestamptz + interval '1 hour') is not null as ok \gset
select tests.assert(
  (tests.m4j_hour(:'aco', :'t4'::timestamptz + interval '1 hour')).profit_cents = :k_profit_cents::bigint
  and (tests.m4j_hour(:'aco', :'t4'::timestamptz + interval '1 hour')).stake_payout_cents = :k_profit_cents::bigint / 10
  and (tests.m4j_hour(:'aco', :'t4'::timestamptz + interval '1 hour')).founder_payout_cents = 0
  and tests.cash(:c) = :cc_2::bigint + :k_profit_cents::bigint / 10 and tests.cash(:a) = :ca_2::bigint
  and tests.company_cash(:'aco') = 0,
  'stake payout: never more than the free cash (cash minus open bills); the founder gets nothing then');
select public.trust_score(:a) as ta2 \gset
select public.deals_run_due(now()) is not null as ok \gset
select tests.login_as('authenticated', :a);
select public.get_my_company() -> 'company' -> 'hours' as k_hours \gset
reset role;
select tests.assert(
  (tests.m4j_deal(:'k1id')).status = 'completed'
  and (tests.m4j_deal(:'k1id')).payouts_cents = :k_stake_payout_cents::bigint + :k_profit_cents::bigint / 10
  and public.trust_score(:a) = :ta2::int + 3
  and (tests.m4j_note(:c, 'deal_result', 'Beteiligung beendet')).id is not null
  and (select bool_and(h ?& array['stake_payout_cents', 'supply_revenue_cents', 'supply_fee_paid_cents', 'supply_fee_income_cents',
                                   'supply_goods_cents', 'campaign_id'])
         from jsonb_array_elements(:'k_hours'::jsonb) h)
  and (:'k_hours'::jsonb -> -1 ->> 'stake_payout_cents')::bigint = :k_profit_cents::bigint / 10,
  'stake end: completed after the last hour of the term, founder +3 (stakeKept); COMPANY.hours carry the new columns');

-- a stake in the other company, ended early by its founder
select tests.login_as('authenticated', :c);
select public.propose_deal(gen_random_uuid(), 'stake', 'investor', :'b_nick', '{"amount_cents": 50000, "share_bps": 1000, "hours": 48}',
                           null) ->> 'id' as k2id \gset
reset role;
select tests.login_as('authenticated', :b);
select public.respond_deal(gen_random_uuid(), :'k2id', true) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select tests.throws_key(format($$select public.break_deal(gen_random_uuid(), %L)$$, :'k2id'), 'invalid_argument',
  'break_deal(): an investor cannot end a stake');
reset role;
select public.trust_score(:b) as tb2 \gset
select tests.login_as('authenticated', :b);
select public.break_deal(gen_random_uuid(), :'k2id') as k2x \gset
reset role;
select tests.assert(
  :'k2x'::jsonb ->> 'status' = 'broken' and :'k2x'::jsonb ->> 'my_role' = 'company'
  and public.trust_score(:b) = :tb2::int - 12
  and exists (select 1 from public.feed_items fi where fi.actor_id = :b and fi.kind = 'deal_broken'
                 and fi.payload = jsonb_build_object('kind', 'stake', 'with', :'c_nick'))
  and (tests.m4j_note(:c, 'deal_result', :'b_nick' || ' hat die Beteiligung beendet')).id is not null,
  'break_deal(): the founder ends a stake early (-12), the investor is told');

-- =============================================================================
-- M. RLS, player card, ledger
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.propose_deal(gen_random_uuid(), 'loan', 'lender', null, '{"principal_cents": 10000, "interest_bps": 0, "hours": 24}',
                           null) ->> 'id' as l8id \gset
reset role;
select tests.login_as('authenticated', :e);
select tests.assert(
  (select count(*) from public.deals where id = :'l8id') = 1
  and (select count(*) from public.deals where id in (:'l1id', :'s1id', :'k1id')) = 0
  and (select count(*) from public.trust_events where player_id <> :e) = 0
  and (select count(*) from public.trust_events where player_id = :e) = 2
  and (select count(*) from public.company_campaigns) = 0,
  'RLS: strangers see open board offers only; trust events and campaigns stay private');
select tests.throws($$insert into public.deals (kind, proposer_id, proposer_role, hours, expires_at, principal_cents, interest_bps)
  values ('loan', '08108108-0000-4000-8000-0000000000e1', 'lender', 24, now(), 10000, 0)$$, '42501', 'RLS: no client writes on deals');
select tests.throws($$update public.trust_events set delta = 100$$, '42501', 'RLS: no client writes on trust_events');
select public.get_player_card(:'b_nick') as card_b \gset
reset role;
select tests.login_as('authenticated', :a);
select tests.assert(
  (select count(*) from public.company_campaigns where company_id = :'aco') = 2
  and (select count(*) from public.deals where id in (:'l1id', :'s1id', :'k1id')) = 3,
  'RLS: founders see their campaigns, parties their deals');
select public.cancel_deal(gen_random_uuid(), :'l8id') is not null as ok \gset
reset role;
select tests.assert(
  :'card_b'::jsonb -> 'trust' = public.player_trust(:b)
  and (:'card_b'::jsonb -> 'trust') ?& array['score', 'band', 'kept', 'broken']
  and not exists (select 1 from public.ledger_audit()),
  'player card: trust {score, band, kept, broken}; ledger audit clean');
select tests.assert(
  public.feed_item_label('deal_signed', '{"kind": "loan", "with": "Ida"}') = 'Deal mit Ida per Handschlag'
  and public.feed_item_label('deal_broken', '{"kind": "supply", "with": "Ida"}') = 'Deal mit Ida gebrochen'
  and public.feed_item_label('loan_defaulted', '{"with": "Ida"}') = 'Kredit von Ida geplatzt'
  and public.feed_item_label('promoted', '{"tier": "senior", "company": "Ida AG"}') = 'Befördert bei Ida AG'
  and public.feed_item_label('level_up', '{"level": 5}') = 'Level 5 erreicht',
  'feed labels for the deal kinds (and M4i''s promoted)');

-- =============================================================================
-- N. Account reset: debts are collected first, the player's deals and trust go away
-- =============================================================================
select tests.login_as('authenticated', :c);
select public.propose_deal(gen_random_uuid(), 'loan', 'lender', :'f_nick', '{"principal_cents": 30000, "interest_bps": 1000, "hours": 24}',
                           null) ->> 'id' as l9id \gset
reset role;
select tests.login_as('authenticated', :f);
select public.respond_deal(gen_random_uuid(), :'l9id', true) is not null as ok \gset
reset role;
select public.trust_add(:f, null, 'dealBroken') is not null as ok \gset
select tests.cash(:c) as cc_3 \gset
select tests.login_as('authenticated', :f);
select public.reset_account(gen_random_uuid(), :'f_nick') is not null as ok \gset
reset role;
select tests.assert(
  tests.cash(:c) = :cc_3::bigint + 33000
  and not exists (select 1 from public.deals where id = :'l9id')
  and public.player_trust(:f) = '{"score": 50, "band": "blank", "kept": 0, "broken": 0}'::jsonb
  and (tests.m4j_note(:c, 'deal_result', :'f_nick' || ' hat neu angefangen')).id is not null
  and not exists (select 1 from public.ledger_audit()),
  'reset_account(): what the borrower owes goes to the lender first, then the deals and the trust events are gone');

select tests.set_cfg('startups', '{demandNoise}', :'noise0'::jsonb);
