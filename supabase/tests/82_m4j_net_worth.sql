-- =============================================================================
-- 82 · M4j addendum: deals count in the net worth (ADR-098)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''08208208-0000-4000-8000-0000000000a1'''
\set b '''08208208-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 5 where code = 'M1-TESTS';
select tests.signup(:a, 'Lea_Leiht') is not null and tests.signup(:b, 'Ben_Borgt') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(x, 6) from unnest(array[:a, :b]::uuid[]) x;
select tests.fund(:a, 5000000, 'test:m4jnw:a');
select nickname as b_nick from public.profiles where id = :b \gset
select public.player_net_worth_cents(:a) as nw_a0, public.player_net_worth_cents(:b) as nw_b0 \gset

select tests.assert(public.player_deal_balance_cents(:a) = 0 and public.player_deal_balance_cents(:b) = 0,
  'player_deal_balance_cents(): 0 without deals');

select tests.login_as('authenticated', :a);
select (public.propose_deal(gen_random_uuid(), 'loan', 'lender', :'b_nick',
          '{"principal_cents": 1000000, "interest_bps": 1000, "hours": 48}'::jsonb, null) ->> 'id') as lid \gset
reset role;
select tests.login_as('authenticated', :b);
select public.respond_deal(gen_random_uuid(), :'lid'::uuid, true) is not null as ok \gset
reset role;

select tests.assert(
  public.player_deal_balance_cents(:a) = 1100000 and public.player_deal_balance_cents(:b) = -1100000,
  'loan: the lender holds what is owed, the borrower owes principal plus interest');
select tests.assert(
  public.player_net_worth_cents(:a) = :nw_a0::bigint + 100000
  and public.player_net_worth_cents(:b) = :nw_b0::bigint - 100000,
  'a loan does not make the borrower richer: both net worths move by the interest only');
select tests.assert(
  (select e.net_worth_cents from public.rich_list_entries() e where e.entity_id = :b) = public.player_net_worth_cents(:b),
  'rich_list_entries() counts the loan like player_net_worth_cents()');

select tests.login_as('authenticated', :b);
select public.repay_loan(gen_random_uuid(), :'lid'::uuid, 1100000) is not null as ok \gset
reset role;
select tests.assert(
  public.player_deal_balance_cents(:a) = 0 and public.player_deal_balance_cents(:b) = 0
  and public.player_net_worth_cents(:a) = :nw_a0::bigint + 100000
  and public.player_net_worth_cents(:b) = :nw_b0::bigint - 100000,
  'repaid: nothing is owed any more, the interest stays with the lender');
