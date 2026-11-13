-- ===== idempotent copy of migrations/20261130000300_m4j_net_worth.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M4j · 0300 · Deals count in the net worth (ADR-098)
-- =============================================================================
-- A loan between players moves cash from the lender to the borrower. Without this addendum the borrower looked richer
-- and the lender poorer in the net worth, the rich list and the weekly league, so two friends could push one of them
-- up the league with a loan. From now on:
--   loans:    the lender holds what is still owed (active, overdue), the borrower owes it (also when defaulted)
--   stakes:   the investor's money counts for the investor, written off linearly over the term; the founder's company
--             owes the same amount (its cash already counts in the company value)
--   supply:   the prepayment not used yet belongs to the buyer and is owed by the supplier
-- player_net_worth_cents and rich_list_entries add player_deal_balance_cents. Idempotent.
-- =============================================================================

create or replace function public.player_deal_balance_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(case when d.lender_id = p_player and d.status in ('active', 'overdue')
                               then d.due_cents - d.repaid_cents else 0 end
                          - case when d.borrower_id = p_player and d.status in ('active', 'overdue', 'defaulted')
                                 then d.due_cents - d.repaid_cents else 0 end)
                from public.deals d
               where d.kind = 'loan' and (d.lender_id = p_player or d.borrower_id = p_player)), 0)::bigint
  + coalesce((select sum((case when d.investor_id = p_player then 1 else 0 end
                          - case when pc.founder_id = p_player then 1 else 0 end)
                         * floor(d.amount_cents
                                 * greatest(0::numeric, least(1::numeric,
                                     (extract(epoch from (d.ends_at - now())) / (d.hours * 3600.0))::numeric))))
                from public.deals d
                left join public.player_companies pc on pc.company_id = d.company_id
               where d.kind = 'stake' and d.status = 'active' and d.ends_at is not null
                 and (d.investor_id = p_player or pc.founder_id = p_player)), 0)::bigint
  + coalesce((select sum(case when pb.founder_id = p_player then d.prepay_left_cents else 0 end
                         - case when ps.founder_id = p_player then d.prepay_left_cents else 0 end)
                from public.deals d
                left join public.player_companies pb on pb.company_id = d.buyer_company_id
                left join public.player_companies ps on ps.company_id = d.supplier_company_id
               where d.kind = 'supply' and d.status = 'active' and d.prepay_left_cents > 0
                 and (pb.founder_id = p_player or ps.founder_id = p_player)), 0)::bigint;
$$;
comment on function public.player_deal_balance_cents(uuid) is
  'Net worth effect of running deals (ADR-098): loans owed to and by the player, stakes written off over their term, unused supply prepayments.';

create or replace function public.player_net_worth_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(a.balance_cents) from public.ledger_accounts a where a.owner_player_id = p_player), 0)::bigint
       + coalesce((select sum(public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))
                     from public.positions p join public.security_quotes q on q.security_id = p.security_id
                    where p.player_id = p_player and p.status = 'open' and p.quantity_e6 > 0), 0)::bigint
       -- founder's player company (ADR-057): cash - unpaid + earnings value
       + public.player_company_value_cents(p_player)
       -- artworks at their last sale price (ADR-080)
       + public.player_art_value_cents(p_player)
       -- home, furniture, cars and floors (ADR-082)
       + public.player_property_value_cents(p_player)
       - public.player_debt_cents(p_player)
       -- loans, stakes and prepayments between players (ADR-098)
       + public.player_deal_balance_cents(p_player);
$$;

-- rich_list_entries as in M4b plus the deals
create or replace function public.rich_list_entries()
returns table (entity_kind text, entity_id uuid, name text, description text, net_worth_cents bigint, rank_all integer, rank_players integer)
language sql
stable
security definer
set search_path = ''
as $$
  with players as (
    select p.id,
           coalesce(a.cash, 0) + coalesce(v.val, 0) + coalesce(public.company_value_cents(pc.company_id), 0)
             + coalesce(art.val, 0) + public.player_property_value_cents(p.id) - coalesce(d.debt, 0)
             + public.player_deal_balance_cents(p.id) as nw,
           p.nickname
      from public.profiles p
      left join (select owner_player_id, sum(balance_cents)::bigint as cash from public.ledger_accounts
                  where owner_player_id is not null group by owner_player_id) a on a.owner_player_id = p.id
      left join (select pos.player_id, sum(public.value_cents(pos.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))::bigint as val
                   from public.positions pos join public.security_quotes q on q.security_id = pos.security_id
                  where pos.status = 'open' and pos.quantity_e6 > 0 group by pos.player_id) v on v.player_id = p.id
      left join public.player_companies pc on pc.founder_id = p.id and pc.status = 'active'
      left join (select l.player_id, sum(l.outstanding_cents)::bigint as debt from public.player_loans l
                  where l.status = 'open' group by l.player_id) d on d.player_id = p.id
      left join (select aw.owner_id, sum(aw.value_cents)::bigint as val from public.artworks aw
                  where aw.owner_id is not null and aw.value_cents is not null group by aw.owner_id) art on art.owner_id = p.id
     where not p.is_deactivated
  ), tycoons as (
    select t.id, t.name, t.description,
           t.cash_cents + coalesce(sum(public.value_cents(h.quantity_e6, coalesce(q.bid_e4, q.last_price_e4))), 0)::bigint as nw
      from public.rich_tycoons t
      left join public.rich_tycoon_holdings h on h.tycoon_id = t.id
      left join public.security_quotes q on q.security_id = h.security_id
     group by t.id
  ), allx as (
    select 'player'::text as entity_kind, id as entity_id, nickname as name, null::text as description, nw from players
    union all
    select 'tycoon', id, name, description, nw from tycoons
  )
  select x.entity_kind, x.entity_id, x.name, x.description, x.nw,
         (row_number() over (order by x.nw desc, x.entity_kind, x.entity_id))::integer,
         case when x.entity_kind = 'player'
              then (row_number() over (partition by x.entity_kind order by x.nw desc, x.entity_id))::integer end
    from allx x;
$$;


do $$
declare
  f text;
begin
  foreach f in array array[
    'public.player_deal_balance_cents(uuid)', 'public.player_net_worth_cents(uuid)', 'public.rich_list_entries()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
