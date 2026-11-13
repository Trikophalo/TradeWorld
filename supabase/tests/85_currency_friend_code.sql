-- =============================================================================
-- 85 · The game's own currency in server texts (ADR-110) and the friend code (ADR-111)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''08508508-0000-4000-8000-0000000000a1'''
\set b '''08508508-0000-4000-8000-0000000000b1'''
\set c '''08508508-0000-4000-8000-0000000000c1'''
\set rq1 '''08508508-0000-4000-8000-000000000101'''
\set rq2 '''08508508-0000-4000-8000-000000000102'''
\set rq3 '''08508508-0000-4000-8000-000000000103'''
\set rq4 '''08508508-0000-4000-8000-000000000104'''
update public.invite_codes set max_uses = max_uses + 5 where code = 'M1-TESTS';
select tests.signup(:a, 'Anna_Wirbt') is not null and tests.signup(:b, 'Bert_Kommt') is not null
   and tests.signup(:c, 'Cleo_Auch') is not null as ok \gset

-- Currency ---------------------------------------------------------------------------------------------------------
select tests.assert(
  public.format_eur(123456) = '1.235 NX' and public.format_eur(-5600) = '-56 NX'
  and public.format_eur_short(42000000000) = '420,0 Mio. NX' and public.format_eur_short(40000000) = '400 Tsd. NX'
  and public.mission_text('Sammlung im Wert von {target}', 'art_collection_value', 200000) = 'Sammlung im Wert von 2.000 NX',
  'money texts of the server say NX: format_eur, format_eur_short, mission_text');
select tests.assert(
  public.crypto_event_text('depeg', 'Eins-Stabil') ->> 'body' = 'Der Stablecoin ist nicht mehr 1 NX wert.',
  'crypto_event_text(depeg): the peg is 1 NX');
select tests.assert(
  not exists (select 1 from public.unlocks where description like '%€%')
  and not exists (select 1 from public.achievements where description like '%€%')
  and not exists (select 1 from public.random_event_definitions where description like '%€%')
  and not exists (select 1 from public.notifications where title like '%€%' or body like '%€%')
  and exists (select 1 from public.unlocks where description like '% NX%'),
  'stored texts carry no euro sign any more');
select tests.assert(
  not exists (select 1 from public.securities where name = 'Euro-Stabil')
  and (select count(*) from public.securities where ticker = 'EUS' and name <> 'Eins-Stabil') = 0,
  'the stablecoin EUS is called Eins-Stabil');

-- Friend code ------------------------------------------------------------------------------------------------------
select tests.login_as('authenticated', :a) is null as ok \gset
select public.get_friend_code() as fa \gset
reset role;
select 'NEXA-' || tag as code_a, tag as tag_a from public.profiles where id = :a \gset
select 'NEXA-' || tag as code_b from public.profiles where id = :b \gset
select tests.assert(
  :'fa'::jsonb ->> 'code' = :'code_a' and (:'fa'::jsonb ->> 'bonus_cents')::bigint = 500000
  and (:'fa'::jsonb ->> 'redeemed')::boolean = false and :'fa'::jsonb -> 'redeemed_from' = 'null'::jsonb
  and :'fa'::jsonb -> 'redeemed_at' = 'null'::jsonb and (:'fa'::jsonb ->> 'invited')::int = 0,
  'get_friend_code(): {code NEXA-<tag>, bonus_cents 500000, redeemed false, redeemed_from null, redeemed_at null, invited 0}');

select tests.cash(:b) as cash_b0 \gset
select tests.login_as('authenticated', :b) is null as ok \gset
select tests.throws_key($$select public.redeem_friend_code(gen_random_uuid(), 'NEXA-0000')$$, 'friend_code_unknown',
  'redeem_friend_code(): a code that cannot exist -> friend_code_unknown NX104');
select tests.throws_key($$select public.redeem_friend_code(gen_random_uuid(), '')$$, 'friend_code_unknown',
  'redeem_friend_code(): empty -> friend_code_unknown');
select tests.throws_key(format($$select public.redeem_friend_code(gen_random_uuid(), %L)$$, :'code_b'), 'friend_code_self',
  'redeem_friend_code(): the own code -> friend_code_self NX105');
select tests.throws_key($$select public.redeem_friend_code(null, 'NEXA-ABCD')$$, 'invalid_argument',
  'redeem_friend_code(): no request id -> invalid_argument');
-- typed sloppily: lower case, a space instead of the dash
select public.redeem_friend_code(:rq1, ' nexa ' || lower(:'tag_a') || ' ') as r1 \gset
select public.redeem_friend_code(:rq1, 'something else') as r1b \gset
reset role;
select tests.assert(
  :'r1'::jsonb ->> 'code' = :'code_b' and (:'r1'::jsonb ->> 'redeemed')::boolean
  and :'r1'::jsonb -> 'redeemed_from' = jsonb_build_object('nickname', 'Anna_Wirbt', 'tag', :'tag_a')
  and :'r1'::jsonb ->> 'redeemed_at' is not null
  and (:'r1'::jsonb ->> 'paid_cents')::bigint = 500000
  and (:'r1'::jsonb ->> 'cash_after_cents')::bigint = :cash_b0 + 500000
  and tests.cash(:b) = :cash_b0 + 500000
  and :'r1b'::jsonb = :'r1'::jsonb,
  'redeem_friend_code(): 5.000 NX from the treasury once, {..., redeemed_from, paid_cents, cash_after_cents}; the same request replays');
select tests.assert(
  (select count(*) from public.ledger_transactions t where t.idempotency_key like 'friend_code:' || :b || '%') >= 1
  and (select friend_code_from from public.profiles where id = :b) = :a
  and (select count(*) from public.notifications n where n.player_id = :a and n.type_key = 'friend_code_redeemed'
          and n.body = 'Bert_Kommt ist mit deinem Code dabei.' and n.link = '/friends') = 1,
  'the bonus is a ledger booking, the profile remembers the friend, the owner of the code is told');

select tests.login_as('authenticated', :b) is null as ok \gset
select tests.throws_key(format($$select public.redeem_friend_code(gen_random_uuid(), %L)$$, :'code_a'), 'friend_code_used',
  'redeem_friend_code(): a second time -> friend_code_used NX106');
reset role;
select tests.assert(tests.cash(:b) = :cash_b0 + 500000, 'no second bonus');

-- the bare tag and "#tag" work too; friends may redeem each other's codes
select tests.login_as('authenticated', :c) is null as ok \gset
select public.redeem_friend_code(:rq2, '#' || :'tag_a') as r2 \gset
reset role;
select tests.login_as('authenticated', :a) is null as ok \gset
select public.redeem_friend_code(:rq3, :'code_b') as r3 \gset
select public.get_friend_code() as fa2 \gset
reset role;
select tests.assert(
  (:'r2'::jsonb ->> 'paid_cents')::bigint = 500000 and (:'r3'::jsonb ->> 'paid_cents')::bigint = 500000
  and (:'fa2'::jsonb ->> 'invited')::int = 2 and (:'fa2'::jsonb ->> 'redeemed')::boolean
  and :'fa2'::jsonb -> 'redeemed_from' ->> 'nickname' = 'Bert_Kommt',
  'the tag alone is enough; the code owner sees 2 friends and may redeem a friend''s code in turn');

-- the bonus is a config value
select tests.set_cfg('social', array['friendCode', 'bonusCents'], '123400'::jsonb);
select tests.login_as('authenticated', :a) is null as ok \gset
select public.get_friend_code() as fa3 \gset
reset role;
select tests.assert((:'fa3'::jsonb ->> 'bonus_cents')::bigint = 123400, 'the bonus comes from social.friendCode.bonusCents');
select tests.set_cfg('social', array['friendCode', 'bonusCents'], '500000'::jsonb);

select tests.throws($$select public.api_error('friend_code_unknown')$$, 'NX104', 'friend_code_unknown is NX104');
select tests.throws($$select public.api_error('friend_code_self')$$, 'NX105', 'friend_code_self is NX105');
select tests.throws($$select public.api_error('friend_code_used')$$, 'NX106', 'friend_code_used is NX106');
select tests.throws($$select public.api_error('coin_not_launched')$$, 'NX103', 'coin_not_launched (M5a) is still NX103');
select tests.assert(
  not has_function_privilege('authenticated', 'public.friend_code_state(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.get_friend_code()', 'execute')
  and has_function_privilege('authenticated', 'public.redeem_friend_code(uuid, text)', 'execute'),
  'grants: the RPCs for authenticated, the helpers internal');
select tests.assert((select count(*) from public.ledger_audit()) = 0 and tests.money_invariant() = 'ok',
  'closed money system after the friend code tests');
