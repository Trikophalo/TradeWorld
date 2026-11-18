-- =============================================================================
-- e0 · The vault grows with the player (ADR-201): level bonus on the vault income (half even, before the treasury
--      factor), Festgeld in the vault (cash -> reserve and back, interest from the treasury at maturity, none when
--      broken early), limits (level, term, minimum, cap per level, open count, cash), idempotency, money invariant,
--      reset voids open deposits.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0e0a0e0a-0000-4000-8000-0000000000a1'''
\set b '''0e0a0e0a-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Ve_Anna') is not null and tests.signup(:b, 'Ve_Bruno') is not null as ok \gset
create or replace function tests.e0_reserve(p_player uuid) returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where owner_player_id = p_player and kind = 'player_reserve' $$;
create or replace function tests.e0_cash(p_player uuid) returns bigint language sql as $$
  select balance_cents from public.ledger_accounts where owner_player_id = p_player and kind = 'player_cash' $$;
create or replace function tests.e0_treasury() returns bigint language sql as $$
  select coalesce((select balance_cents from public.ledger_accounts where system_key = 'treasury'), 0) $$;
grant execute on all functions in schema tests to public;

select tests.assert(
  (value ->> 'levelBonusBps')::integer = 800 and (value ->> 'levelBonusMaxLevel')::integer = 40
  and (value #>> '{deposits,minLevel}')::integer = 5 and (value #>> '{deposits,capCentsPerLevel}')::bigint = 2500000
  and jsonb_array_length(value #> '{deposits,terms}') = 3,
  'e0: config vault (8 % per level up to 40, deposits from level 5, 25.000 € per level, three terms)')
  from public.game_config where key = 'vault';

-- 1. level bonus ------------------------------------------------------------------------------------------------
select tests.assert(public.vault_level_factor_bps(1) = 10000 and public.vault_level_factor_bps(5) = 13200
  and public.vault_level_factor_bps(30) = 33200 and public.vault_level_factor_bps(99) = 41200
  and public.vault_level_factor_bps(null) = 10000,
  'vault_level_factor_bps(): +8 % per level above 1, capped at level 40');

select tests.set_level(:a, 15);
select public.vault_status(:a) as vs \gset
select tests.assert(
  (:'vs'::jsonb ->> 'level')::integer = 15 and (:'vs'::jsonb ->> 'level_factor_bps')::integer = 21200
  and (:'vs'::jsonb ->> 'base_rate_cents_per_hour')::bigint
      = public.div_round_half_even(public.player_basic_income_cents_per_hour(:a)::numeric * 21200, 10000)
  and (:'vs'::jsonb ->> 'income_cents_per_hour')::bigint = public.player_basic_income_cents_per_hour(:a)
  and (:'vs'::jsonb ->> 'rate_cents_per_hour')::bigint
      = (:'vs'::jsonb ->> 'base_rate_cents_per_hour')::bigint * (:'vs'::jsonb ->> 'factor_bps')::integer / 10000
  and (:'vs'::jsonb ->> 'cap_hours')::double precision = public.player_vault_cap_hours(:a),
  'vault_status(): level 15 pays 2,12 x the basic income before the treasury factor ' || :'vs');

-- 2. deposits: limits ------------------------------------------------------------------------------------------
select tests.set_level(:b, 4);
select tests.login_as('authenticated', :b);
select tests.throws_key($$select public.open_vault_deposit(gen_random_uuid(), 100000, 7)$$, 'locked',
  'open_vault_deposit(): needs level 5');
reset role;

-- give :a cash from the treasury (balanced)
select public.state_payout(:a, 50000000, 0, 'admin_adjustment', 'e0 test cash', 'profile', :a, 'e0:cash:' || :a) is not null as ok \gset
select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.open_vault_deposit(gen_random_uuid(), 100000, 2)$$, 'invalid_argument',
  'open_vault_deposit(): only the configured terms');
select tests.throws_key($$select public.open_vault_deposit(gen_random_uuid(), 99999, 1)$$, 'deposit_too_small',
  'open_vault_deposit(): at least 1.000 €');
select tests.throws_key($$select public.open_vault_deposit(gen_random_uuid(), 37500001, 1)$$, 'deposit_limit',
  'open_vault_deposit(): at most 25.000 € per level (375.000 € at level 15)');
reset role;

select tests.e0_cash(:a) as cash0 \gset
select tests.e0_reserve(:a) as res0 \gset
select tests.e0_treasury() as tr0 \gset
\set r1 '''0e0a0e0a-0000-4000-8000-0000000000c1'''
\set r2 '''0e0a0e0a-0000-4000-8000-0000000000c2'''
select tests.login_as('authenticated', :a);
select public.open_vault_deposit(:r1, 10000000, 7) as o1 \gset
select public.open_vault_deposit(:r1, 10000000, 7) as o1b \gset
select public.open_vault_deposit(:r2, 5000000, 1) as o2 \gset
reset role;
select tests.assert(:'o1'::jsonb = :'o1b'::jsonb and jsonb_array_length(:'o1'::jsonb -> 'deposits') = 1
  and (:'o1'::jsonb -> 'deposits' -> 0 ->> 'rate_bps')::integer = 1400
  and (:'o1'::jsonb ->> 'cap_cents')::bigint = 37500000
  and (:'o2'::jsonb ->> 'open_cents')::bigint = 15000000,
  'open_vault_deposit(): idempotent, 14 % for 7 days, open total ' || :'o2');
select tests.assert(tests.e0_cash(:a) = :cash0::bigint - 15000000 and tests.e0_reserve(:a) = :res0::bigint + 15000000
  and tests.e0_treasury() = :tr0::bigint,
  'open_vault_deposit(): the principal moves from cash to the reserve, the treasury is untouched');

select tests.login_as('authenticated', :a);
select tests.throws_key($$select public.open_vault_deposit(gen_random_uuid(), 22500001, 3)$$, 'deposit_limit',
  'open_vault_deposit(): the cap counts every open deposit');
select public.open_vault_deposit(gen_random_uuid(), 100000, 3) is not null as ok \gset
select tests.throws_key($$select public.open_vault_deposit(gen_random_uuid(), 100000, 3)$$, 'deposit_limit',
  'open_vault_deposit(): at most three open deposits');
reset role;

-- 3. break early, collect at maturity ------------------------------------------------------------------------------
select d.id as d7 from public.vault_deposits d where d.player_id = :a and d.term_days = 7 \gset
select d.id as d1 from public.vault_deposits d where d.player_id = :a and d.term_days = 1 \gset
select tests.e0_cash(:a) as cash1 \gset
select tests.login_as('authenticated', :a);
select public.close_vault_deposit(gen_random_uuid(), :d1) as c1 \gset
select tests.throws_key(format($$select public.close_vault_deposit(gen_random_uuid(), %s)$$, :d1), 'deposit_not_found',
  'close_vault_deposit(): a closed deposit cannot be closed again');
reset role;
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.close_vault_deposit(gen_random_uuid(), %s)$$, :d7), 'deposit_not_found',
  'close_vault_deposit(): not another player''s deposit');
reset role;
select tests.assert((:'c1'::jsonb -> 'closed' ->> 'matured')::boolean = false
  and (:'c1'::jsonb -> 'closed' ->> 'interest_cents')::bigint = 0
  and tests.e0_cash(:a) = :cash1::bigint + 5000000
  and (select status from public.vault_deposits where id = :d1) = 'broken',
  'close_vault_deposit(): early, the principal comes back without interest');

update public.vault_deposits set matures_at = public.game_now() - interval '1 minute' where id = :d7;
select public.basic_income_factor_bps() as fbps \gset
select tests.e0_cash(:a) as cash2 \gset
select tests.e0_treasury() as tr2 \gset
\set r3 '''0e0a0e0a-0000-4000-8000-0000000000c3'''
select tests.login_as('authenticated', :a);
select public.close_vault_deposit(:r3, :d7) as c7 \gset
select public.close_vault_deposit(:r3, :d7) as c7b \gset
reset role;
select public.vault_deposit_interest_cents(10000000, 1400, :fbps) as want \gset
select tests.assert(:'c7'::jsonb = :'c7b'::jsonb and (:'c7'::jsonb -> 'closed' ->> 'matured')::boolean
  and (:'c7'::jsonb -> 'closed' ->> 'interest_cents')::bigint = least(:want::bigint, :tr2::bigint)
  and :want::bigint = public.div_round_half_even(10000000::numeric * 1400 * :fbps, 100000000)
  and tests.e0_cash(:a) = :cash2::bigint + 10000000 + (:'c7'::jsonb -> 'closed' ->> 'interest_cents')::bigint
  and tests.e0_treasury() = :tr2::bigint - (:'c7'::jsonb -> 'closed' ->> 'interest_cents')::bigint
  and (select status from public.vault_deposits where id = :d7) = 'paid'
  and (:'c7'::jsonb ->> 'earned_cents')::bigint = (:'c7'::jsonb -> 'closed' ->> 'interest_cents')::bigint,
  'close_vault_deposit(): at maturity principal plus 14 % x treasury factor from the treasury, once ' || :'c7');

-- 4. reset voids open deposits ---------------------------------------------------------------------------------------
select count(*) as open_before from public.vault_deposits where player_id = :a and status = 'open' \gset
update public.player_private set account_reset_at = public.game_now() where player_id = :a;
select tests.assert(:open_before::integer = 1
  and not exists (select 1 from public.vault_deposits where player_id = :a and status = 'open')
  and exists (select 1 from public.vault_deposits where player_id = :a and status = 'void'),
  'a reset of the account voids the open deposits');

-- 5. get_vault_deposits answers the terms -----------------------------------------------------------------------------
select tests.login_as('authenticated', :a);
select public.get_vault_deposits() as g \gset
reset role;
select tests.assert(jsonb_array_length(:'g'::jsonb -> 'terms') = 3
  and (:'g'::jsonb -> 'terms' -> 2 ->> 'days')::integer = 7 and (:'g'::jsonb ->> 'open_cents')::bigint = 0
  and (:'g'::jsonb ->> 'min_level')::integer = 5,
  'get_vault_deposits(): terms sorted by days, nothing open after the reset');
