-- =============================================================================
-- NEXA · 9500 · Toplists: one valuation per list, every asset class in the net worth (ADR-203)
-- =============================================================================
-- Before, four formulas valued the same things differently:
--   * the company page showed company_value_cents (cash - unpaid + 4 x profit x P/E x discount), also for a listed
--     company; "Top-Unternehmen" showed a listed company at shares x last price; the company profile at the stored
--     security_quotes.market_cap_cents (written at other times, partly from the fair value)
--   * rich_list_entries() (Forbes 100, "Alle", league, snapshots) counted company_value_cents of a LISTED company on
--     top of the founder's shares in the depot (counted twice), player_net_worth_cents() (business card, missions)
--     did not; neither counted Nexamon cards, the vault or subscription money waiting in the escrow
--   * the home page added cash, depot and company value on the client (no NFTs, property, deals)
-- Now:
--   company_worth_cents(company): THE value of a company. Listed (phase 'listed' with a quote): market cap = shares
--     outstanding x last price. Otherwise (private player company): company_value_cents, the value the company page
--     always showed. Used by the company page (get_my_company.company.worth), the company profile, "Top-Unternehmen"
--     and the founder's stake in the net worth.
--   player_wealth_parts(player | null): THE net worth, in parts (one row per player; null = every active player):
--     cash (all own ledger accounts), depot (open positions at bid, without the own listed company), company (own
--     private company at company_worth_cents, own listed company: own shares x last price, the price of the market
--     cap), cards (Nexamon copies without grade at market value), slabs (graded copies, Black Labels with the hype
--     factor), nfts (last sale price), property (home, furniture, cars, floors at their resale value), vault (accrued
--     basic income), escrow (subscription money of open offers), deals (ADR-098) and debt (forced loans, negative).
--     total = the sum. player_net_worth_cents() and rich_list_entries() read only this.
--   rich_list_rows(): rich_list_entries() plus the main source of a fortune (largest part).
--   company_ranking_rows(): every active player company and every listed AI company at company_worth_cents with the
--     rank among all and among player companies; company_rank_snapshots every richList.companySnapshotMinutes
--     (pg_cron nexa-company-ranking) for the change against yesterday.
--   Weekly league: the net worth without the vault (basic income is free money, ADR-089); the running season is
--     re-based once so the new definition does not count as growth.
-- RPCs: get_rich_list (+ source per entry), get_company_ranking(p_scope, p_limit, p_sector) (+ basis, price, change
--   and rank change against yesterday, sector filter, own entry in full), get_my_net_worth() (new: the parts),
--   company_state (+ worth, so get_my_company and every company answer), get_company_profile (value from company_worth_cents, + value_basis).
-- Idempotent: runs unchanged as supabase/updates/20261204009500_toplists.sql.

-- ---------------------------------------------------------------------------
-- A. The value of a company
-- ---------------------------------------------------------------------------
create or replace function public.company_worth_cents(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when c.phase = 'listed' and q.last_price_e4 is not null
              then public.div_round_half_even(c.shares_outstanding::numeric * q.last_price_e4, 100)::bigint
              when exists (select 1 from public.player_companies pc where pc.company_id = c.id)
              then public.company_value_cents(c.id) end
    from public.companies c
    left join public.security_quotes q on q.security_id = c.security_id
   where c.id = p_company;
$$;
comment on function public.company_worth_cents(uuid) is
  'The value of a company everywhere (ADR-203): listed = shares outstanding x last price (market cap), private player '
  'company = company_value_cents. Null for an unlisted AI company.';

create or replace function public.company_worth_json(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'cents', public.company_worth_cents(c.id),
           'basis', case when c.phase = 'listed' and q.last_price_e4 is not null then 'market_cap' else 'company_value' end,
           'company_value_cents', case when exists (select 1 from public.player_companies pc where pc.company_id = c.id)
                                       then public.company_value_cents(c.id) end,
           'price_e4', case when c.phase = 'listed' then q.last_price_e4 end,
           'shares', case when c.phase = 'listed' then c.shares_outstanding end)
    from public.companies c
    left join public.security_quotes q on q.security_id = c.security_id
   where c.id = p_company;
$$;
comment on function public.company_worth_json(uuid) is
  'Value of a company with its basis (ADR-203): {cents, basis market_cap | company_value, company_value_cents, price_e4, shares}.';

-- ---------------------------------------------------------------------------
-- B. The net worth in parts
-- ---------------------------------------------------------------------------
create or replace function public.player_wealth_parts(p_player uuid default null)
returns table (player_id uuid, cash_cents bigint, depot_cents bigint, company_cents bigint, cards_cents bigint,
               slabs_cents bigint, nfts_cents bigint, property_cents bigint, vault_cents bigint, escrow_cents bigint,
               deals_cents bigint, debt_cents bigint, total_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select p.id, pc.company_id as own_company,
           case when c.phase = 'listed' and q.last_price_e4 is not null then c.security_id end as own_security,
           q.last_price_e4 as own_last_e4
      from public.profiles p
      left join public.player_companies pc on pc.founder_id = p.id and pc.status = 'active'
      left join public.companies c on c.id = pc.company_id
      left join public.security_quotes q on q.security_id = c.security_id
     where (p_player is null and not p.is_deactivated) or p.id = p_player
  ), parts as (
    select b.id,
           coalesce((select sum(a.balance_cents) from public.ledger_accounts a where a.owner_player_id = b.id), 0)::bigint
             as cash,
           coalesce((select sum(public.value_cents(x.quantity_e6, coalesce(xq.bid_e4, xq.last_price_e4)))
                       from public.positions x join public.security_quotes xq on xq.security_id = x.security_id
                      where x.player_id = b.id and x.status = 'open' and x.quantity_e6 > 0
                        and x.security_id is distinct from b.own_security), 0)::bigint as depot,
           case when b.own_company is null then 0::bigint
                when b.own_security is null then coalesce(public.company_worth_cents(b.own_company), 0)
                else coalesce((select sum(public.value_cents(x.quantity_e6, b.own_last_e4)) from public.positions x
                                where x.player_id = b.id and x.security_id = b.own_security and x.status = 'open'
                                  and x.quantity_e6 > 0), 0)::bigint end as company,
           coalesce((select sum(public.nexamon_copy_value_cents(k.value_e4, n.condition, n.grade, n.card_key))
                       from public.nexamon_copies n join public.nexamon_cards k on k.card_key = n.card_key
                      where n.owner_id = b.id and n.grade is null), 0)::bigint as cards,
           coalesce((select sum(public.nexamon_copy_value_cents(k.value_e4, n.condition, n.grade, n.card_key))
                       from public.nexamon_copies n join public.nexamon_cards k on k.card_key = n.card_key
                      where n.owner_id = b.id and n.grade is not null), 0)::bigint as slabs,
           public.player_art_value_cents(b.id) as nfts,
           public.player_property_value_cents(b.id) as property,
           coalesce((public.vault_status(b.id) ->> 'accrued_cents')::bigint, 0) as vault,
           coalesce((select sum(s.amount_cents) from public.offer_subscriptions s
                       join public.company_share_offers o on o.id = s.offer_id
                      where s.player_id = b.id and o.status = 'open' and o.escrow_cents > 0), 0)::bigint as escrow,
           public.player_deal_balance_cents(b.id) as deals,
           -public.player_debt_cents(b.id) as debt
      from base b
  )
  select x.id, x.cash, x.depot, x.company, x.cards, x.slabs, x.nfts, x.property, x.vault, x.escrow, x.deals, x.debt,
         (x.cash + x.depot + x.company + x.cards + x.slabs + x.nfts + x.property + x.vault + x.escrow + x.deals + x.debt)::bigint
    from parts x;
$$;
comment on function public.player_wealth_parts(uuid) is
  'THE net worth in parts (ADR-203), one row per player (null = every active player): cash, depot at bid without the '
  'own listed company, company (company_worth_cents or own shares at the last price), Nexamon cards and slabs at '
  'market value, NFTs, property, vault, escrow, deals, debt (negative); total = the sum.';

create or replace function public.player_net_worth_cents(p_player uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select w.total_cents from public.player_wealth_parts(p_player) w), 0)::bigint;
$$;
comment on function public.player_net_worth_cents(uuid) is 'Net worth of a player: player_wealth_parts().total_cents (ADR-203).';

-- the rich list with the main source of every fortune
create or replace function public.rich_list_rows()
returns table (entity_kind text, entity_id uuid, name text, description text, net_worth_cents bigint, rank_all integer,
               rank_players integer, source text)
language sql
stable
security definer
set search_path = ''
as $$
  with players as (
    select w.player_id as id, p.nickname, w.total_cents as nw,
           (select s.k from (values ('cash', w.cash_cents + w.vault_cents + w.escrow_cents), ('depot', w.depot_cents),
                                    ('company', w.company_cents), ('cards', w.cards_cents + w.slabs_cents),
                                    ('nfts', w.nfts_cents), ('property', w.property_cents)) s(k, v)
             where s.v > 0 order by s.v desc, s.k limit 1) as source
      from public.player_wealth_parts(null) w join public.profiles p on p.id = w.player_id
  ), tycoons as (
    select t.id, t.name, t.description,
           t.cash_cents + coalesce(sum(public.value_cents(h.quantity_e6, coalesce(q.bid_e4, q.last_price_e4))), 0)::bigint as nw
      from public.rich_tycoons t
      left join public.rich_tycoon_holdings h on h.tycoon_id = t.id
      left join public.security_quotes q on q.security_id = h.security_id
     group by t.id
  ), allx as (
    select 'player'::text as entity_kind, id as entity_id, nickname as name, null::text as description, nw, source from players
    union all
    select 'tycoon', id, name, description, nw, 'depot' from tycoons
  )
  select x.entity_kind, x.entity_id, x.name, x.description, x.nw,
         (row_number() over (order by x.nw desc, x.entity_kind, x.entity_id))::integer,
         case when x.entity_kind = 'player'
              then (row_number() over (partition by x.entity_kind order by x.nw desc, x.entity_id))::integer end,
         x.source
    from allx x;
$$;
comment on function public.rich_list_rows() is
  'Rich list (ADR-203): every active player at player_wealth_parts().total_cents and every AI tycoon, ranks among all '
  'and among players, the main source of the fortune (cash, depot, company, cards, nfts, property).';

create or replace function public.rich_list_entries()
returns table (entity_kind text, entity_id uuid, name text, description text, net_worth_cents bigint, rank_all integer, rank_players integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.entity_kind, r.entity_id, r.name, r.description, r.net_worth_cents, r.rank_all, r.rank_players
    from public.rich_list_rows() r;
$$;

-- ---------------------------------------------------------------------------
-- C. Company ranking rows and snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.company_rank_snapshots (
  taken_at     timestamptz not null,
  company_id   uuid not null,
  value_cents  bigint not null,
  rank_all     integer not null,
  rank_players integer,
  primary key (taken_at, company_id)
);
alter table public.company_rank_snapshots enable row level security;
create index if not exists company_rank_snapshots_company_idx on public.company_rank_snapshots (company_id, taken_at desc);
revoke all on public.company_rank_snapshots from public, anon, authenticated;
grant all on public.company_rank_snapshots to service_role;
comment on table public.company_rank_snapshots is
  'Top-Unternehmen every richList.companySnapshotMinutes (ADR-203), kept richList.snapshotKeepDays, for the change '
  'against yesterday. Internal.';

create or replace function public.company_ranking_rows()
returns table (company_id uuid, kind text, value_cents bigint, rank_all integer, rank_players integer)
language sql
stable
security definer
set search_path = ''
as $$
  with lst as (
    select c.id, 'player'::text as kind, public.company_worth_cents(c.id) as value_cents, c.name
      from public.player_companies pc join public.companies c on c.id = pc.company_id
     where pc.status = 'active'
    union all
    select c.id, 'ai', public.company_worth_cents(c.id), c.name
      from public.companies c
      join public.securities s on s.id = c.security_id and s.status = 'listed' and s.kind = 'stock'
      join public.security_quotes qt on qt.security_id = s.id
     where c.is_ai
       and not exists (select 1 from public.player_companies pc where pc.company_id = c.id)
  )
  select l.id, l.kind, coalesce(l.value_cents, 0),
         (row_number() over (order by coalesce(l.value_cents, 0) desc, l.name, l.id))::integer,
         case when l.kind = 'player'
              then (row_number() over (partition by l.kind order by coalesce(l.value_cents, 0) desc, l.name, l.id))::integer end
    from lst l;
$$;
comment on function public.company_ranking_rows() is
  'Top-Unternehmen (ADR-203): active player companies and listed AI companies at company_worth_cents, rank among all '
  'and among player companies.';

create or replace function public.company_ranking_snapshot(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now  timestamptz := clock_timestamp() + (public.game_now() - now());
  v_prev timestamptz;
  v_min  double precision := greatest(1, public.config_double('richList', '{companySnapshotMinutes}', 30));
  v_keep double precision := greatest(2, public.config_double('richList', '{snapshotKeepDays}', 8));
  v_rows integer;
begin
  select max(s.taken_at) into v_prev from public.company_rank_snapshots s;
  if not p_force and v_prev is not null and v_prev > v_now - make_interval(secs => v_min * 60 - 5) then
    return jsonb_build_object('skipped', 'recent');
  end if;
  insert into public.company_rank_snapshots (taken_at, company_id, value_cents, rank_all, rank_players)
  select v_now, r.company_id, r.value_cents, r.rank_all, r.rank_players from public.company_ranking_rows() r
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  delete from public.company_rank_snapshots s where s.taken_at < v_now - make_interval(secs => v_keep * 86400);
  return jsonb_build_object('rows', v_rows, 'taken_at', v_now);
end;
$$;
comment on function public.company_ranking_snapshot(boolean) is
  'Internal, cron (ADR-203): snapshot of Top-Unternehmen, at most every richList.companySnapshotMinutes; prunes old ones.';

-- ---------------------------------------------------------------------------
-- D. RPCs
-- ---------------------------------------------------------------------------
-- get_rich_list as in M4d (20261125000100), plus the source of every fortune
create or replace function public.get_rich_list(p_limit integer default 100, p_offset integer default 0, p_scope text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_limit   integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_scope   text := coalesce(p_scope, 'all');
  v_now     timestamptz := public.game_now();
  v_snap    timestamptz;
  v_out     jsonb;
begin
  v_player := public.require_player();
  if v_scope not in ('all', 'players') then
    perform public.api_error('invalid_argument');
  end if;
  -- the latest snapshot that is at least 24 h old
  select max(s.taken_at) into v_snap from public.rich_list_snapshots s where s.taken_at <= v_now - interval '24 hours';

  with lst as materialized (
    select e.entity_kind, e.entity_id, e.name, e.description, e.net_worth_cents, e.source,
           case when v_scope = 'players' then e.rank_players else e.rank_all end as rnk,
           case when s.net_worth_cents > 0 then round((e.net_worth_cents - s.net_worth_cents) * 10000.0 / s.net_worth_cents)::integer end as change_bps,
           case when s.entity_id is not null
                then (case when v_scope = 'players' then s.rank_players else s.rank_all end)
                   - (case when v_scope = 'players' then e.rank_players else e.rank_all end) end as rank_change
      from public.rich_list_rows() e
      left join public.rich_list_snapshots s on s.taken_at = v_snap and s.entity_kind = e.entity_kind and s.entity_id = e.entity_id
     where v_scope = 'all' or e.entity_kind = 'player'
  ), me as (
    select * from lst where entity_kind = 'player' and entity_id = v_player
  )
  select jsonb_build_object(
           'server_time', v_now,
           'total', (select count(*) from lst),
           'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                          'rank', x.rnk, 'kind', x.entity_kind, 'id', x.entity_id, 'name', x.name, 'description', x.description,
                          'net_worth_cents', x.net_worth_cents, 'change_24h_bps', x.change_bps, 'rank_change_24h', x.rank_change,
                          'is_me', x.entity_kind = 'player' and x.entity_id = v_player,
                          'source', x.source,
                          'avatar_key', case when x.entity_kind = 'player'
                                             then (select pr.avatar_key from public.profiles pr where pr.id = x.entity_id)
                                             else public.tycoon_avatar_key(x.entity_id) end,
                          'tag', case when x.entity_kind = 'player'
                                      then (select pr.tag from public.profiles pr where pr.id = x.entity_id) end) order by x.rnk), '[]'::jsonb)
                         from (select * from lst order by rnk offset v_offset limit v_limit) x),
           'me', (select jsonb_build_object(
                           'rank', m.rnk, 'net_worth_cents', m.net_worth_cents,
                           'change_24h_bps', m.change_bps, 'rank_change_24h', m.rank_change, 'source', m.source,
                           'next', (select jsonb_build_object('rank', n.rnk, 'name', n.name, 'gap_cents', n.net_worth_cents - m.net_worth_cents)
                                      from lst n where n.rnk = m.rnk - 1))
                    from me m))
    into v_out;
  return v_out;
end;
$$;
comment on function public.get_rich_list(integer, integer, text) is
  'RPC: rich list (ADR-042, ADR-203): players (and AI tycoons for scope all) by player_wealth_parts().total_cents, '
  'change and rank change against the snapshot 24 h ago, main source of every fortune.';

-- get_company_ranking: one valuation (company_worth_cents), change against yesterday, sector filter
drop function if exists public.get_company_ranking(text, integer);
create or replace function public.get_company_ranking(p_scope text default 'players', p_limit integer default 100,
                                                      p_sector text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_scope  text := coalesce(p_scope, 'players');
  v_limit  integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_now    timestamptz := public.game_now();
  v_snap   timestamptz;
  v_out    jsonb;
begin
  v_player := public.require_player();
  if v_scope not in ('players', 'all')
     or (p_sector is not null and not exists (select 1 from public.sectors s where s.key = p_sector)) then
    perform public.api_error('invalid_argument');
  end if;
  select max(s.taken_at) into v_snap from public.company_rank_snapshots s where s.taken_at <= v_now - interval '24 hours';

  with rk as materialized (
    select r.*, case when v_scope = 'players' then r.rank_players else r.rank_all end as rnk
      from public.company_ranking_rows() r
     where v_scope = 'all' or r.kind = 'player'
  ), lst as materialized (
    select r.company_id as id, r.kind, r.value_cents, r.rnk, c.name, coalesce(c.brand_color, '#808080') as color,
           case when r.kind = 'player' then public.company_logo(c.id) end as logo, c.ticker, c.sector_key,
           pc.tier, pr.nickname as founder,
           case when c.phase = 'listed' and qt.last_price_e4 is not null then 'market_cap' else 'company_value' end as basis,
           case when c.phase = 'listed' then qt.last_price_e4 end as price_e4,
           case when r.kind = 'player'
                then (select x.revenue_cents from public.player_company_reports x join public.game_quarters gq on gq.id = x.game_quarter_id
                       where x.company_id = c.id order by gq.ends_at desc limit 1) end as revenue_cents,
           case when r.kind = 'player'
                then 1 + pc.ai_workers + (select count(*) from public.player_jobs j where j.company_id = c.id and j.status = 'active')::integer
           end as team_size,
           coalesce(pc.founder_id = v_player, false) as is_mine,
           case when s.value_cents > 0 then round((r.value_cents - s.value_cents) * 10000.0 / s.value_cents)::integer end as change_bps,
           case when s.company_id is not null
                then (case when v_scope = 'players' then s.rank_players else s.rank_all end) - r.rnk end as rank_change
      from rk r
      join public.companies c on c.id = r.company_id
      left join public.player_companies pc on pc.company_id = c.id
      left join public.profiles pr on pr.id = pc.founder_id
      left join public.security_quotes qt on qt.security_id = c.security_id
      left join public.company_rank_snapshots s on s.taken_at = v_snap and s.company_id = r.company_id
     where p_sector is null or c.sector_key = p_sector
  )
  select jsonb_build_object(
           'server_time', v_now,
           'total', (select count(*) from lst)::integer,
           'entries', coalesce((select jsonb_agg(public.company_ranking_entry_json(to_jsonb(x)) order by x.rnk)
                                  from (select * from lst order by rnk limit v_limit) x), '[]'::jsonb),
           'mine', (select public.company_ranking_entry_json(to_jsonb(x)) from lst x where x.is_mine and x.kind = 'player' limit 1))
    into v_out;
  return v_out;
end;
$$;
comment on function public.get_company_ranking(text, integer, text) is
  'RPC: Top-Unternehmen (ADR-074, ADR-203): active player companies (players) plus listed AI companies (all), all at '
  'company_worth_cents (listed: market cap, private: company value), optional sector, change against yesterday.';

create or replace function public.company_ranking_entry_json(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
           'rank', p -> 'rnk', 'company_id', p -> 'id', 'kind', p -> 'kind', 'name', p -> 'name', 'color', p -> 'color',
           'logo', p -> 'logo', 'ticker', p -> 'ticker', 'sector', p -> 'sector_key', 'tier', p -> 'tier',
           'founder', p -> 'founder', 'value_cents', p -> 'value_cents', 'basis', p -> 'basis', 'price_e4', p -> 'price_e4',
           'revenue_cents', p -> 'revenue_cents', 'team_size', p -> 'team_size', 'is_mine', p -> 'is_mine',
           'change_24h_bps', p -> 'change_bps', 'rank_change_24h', p -> 'rank_change');
$$;

-- the own net worth in parts
create or replace function public.get_my_net_worth()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  w        record;
begin
  select * into w from public.player_wealth_parts(v_player);
  return jsonb_build_object(
    'server_time', public.game_now(),
    'total_cents', coalesce(w.total_cents, 0),
    'parts', jsonb_build_object(
      'cash_cents', coalesce(w.cash_cents, 0), 'depot_cents', coalesce(w.depot_cents, 0),
      'company_cents', coalesce(w.company_cents, 0), 'cards_cents', coalesce(w.cards_cents, 0),
      'slabs_cents', coalesce(w.slabs_cents, 0), 'nfts_cents', coalesce(w.nfts_cents, 0),
      'property_cents', coalesce(w.property_cents, 0), 'vault_cents', coalesce(w.vault_cents, 0),
      'escrow_cents', coalesce(w.escrow_cents, 0), 'deals_cents', coalesce(w.deals_cents, 0),
      'debt_cents', coalesce(w.debt_cents, 0)),
    'company', (select jsonb_build_object('name', c.name) || public.company_worth_json(c.id)
                  from public.player_companies pc join public.companies c on c.id = pc.company_id
                 where pc.founder_id = v_player and pc.status = 'active'));
end;
$$;
comment on function public.get_my_net_worth() is
  'RPC: the own net worth in parts (ADR-203), exactly what the rich list counts; plus the own company''s value.';

-- company_state as in 20261204007310_company_page_data.sql (full copy), plus the value for the toplist
create or replace function public.company_state(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc       public.player_companies;
  c        public.companies;
  v_team   jsonb;
  v_tier   jsonb;
  v_sb     jsonb;
  v_level  integer;
  v_cash   bigint;
  v_spread double precision;
  v_last   jsonb;
  v_hist   jsonb;
  v_cost   bigint;
  v_mf     double precision;
  v_camp   public.company_campaigns;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  select * into c from public.companies where id = p_company;
  v_team := public.player_company_team(p_company);
  v_tier := public.company_tier_cfg(pc.tier);
  v_sb := public.company_tier_cfg('small_business');
  select p.level into v_level from public.profiles p where p.id = pc.founder_id;
  v_cash := coalesce((select a.balance_cents from public.ledger_accounts a where a.owner_company_id = p_company and a.kind = 'company_cash'), 0);
  v_spread := public.config_double('startups', '{estimate,initialSpread}', 2.3)
            * power(public.config_double('startups', '{estimate,decayPerQuarter}', 0.85), pc.quarters_active);
  select jsonb_build_object(
           'label', r.label, 'demand_cents', r.demand_cents, 'capacity_cents', r.capacity_cents,
           'revenue_cents', r.revenue_cents, 'cogs_cents', r.cogs_cents, 'fixed_cents', r.fixed_cents,
           'ai_worker_cents', r.ai_worker_cents, 'marketing_cents', r.marketing_cents, 'wages_cents', r.wages_cents,
           'operating_profit_cents', r.operating_profit_cents, 'utilization_bps', r.utilization_bps,
           'bonus_cents', r.bonus_cents)
    into v_last
    from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
   where r.company_id = p_company order by gq.ends_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('label', h.label, 'revenue_cents', h.revenue_cents,
                                               'profit_cents', h.operating_profit_cents) order by h.ends_at), '[]'::jsonb)
    into v_hist
    from (select r.label, r.revenue_cents, r.operating_profit_cents, gq.ends_at
            from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
           where r.company_id = p_company order by gq.ends_at desc limit 12) h;
  v_cost := public.company_upgrade_cost(pc.tier);
  -- the estimate describes the market the company reaches (ADR-083)
  v_mf := public.company_market_factor(pc.tier, pc.expansion_level);
  v_camp := public.company_campaign_at(p_company, public.game_now());
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'idea', pc.idea,
    'sector', c.sector_key,
    'color', c.brand_color,
    'logo', public.company_logo(p_company),
    'logo_hidden', pc.logo_hidden,
    'founder_has_job', exists (select 1 from public.player_jobs x where x.player_id = pc.founder_id and x.status = 'active'),
    'full_time_from', public.config_double('startups', '{fullTimeFromEmployees}', 5)::integer,
    'training_from', public.config_double('startups', '{training,fromEmployees}', 5)::integer,
    'headcount', public.company_headcount(p_company),
    'tier', pc.tier,
    'founded_at', c.founded_at,
    'cash_cents', v_cash,
    'value_cents', public.company_value_cents(p_company),
    'unpaid_cents', pc.unpaid_cents,
    'distress', pc.distress,
    'distress_quarters', pc.distress_quarters,
    'grace_quarters', public.config_double('startups', '{insolvency,graceQuarters}', 4)::integer,
    'pay_factor_bps', pc.pay_factor_bps,
    'product_key', public.company_product(p_company) ->> 'key',
    'stage', (v_team ->> 'stage')::integer,
    'stages', public.company_stages_json(p_company),
    'awareness_bps', round(pc.awareness * 10000)::integer,
    'quality_bps', round(pc.quality * 10000)::integer,
    'quarters_active', pc.quarters_active,
    'estimate_low_cents', round(pc.potential_annual_cents * v_mf
                                * exp(-v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':low'))))::bigint,
    'estimate_high_cents', round(pc.potential_annual_cents * v_mf
                                 * exp(v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':high'))))::bigint,
    'marketing_cents_per_quarter', pc.marketing_cents_per_quarter,
    'ai_workers', pc.ai_workers,
    'ai_worker_cost_cents', public.config_bigint('startups', '{aiWorkerCostCentsPerQuarter}', 72000),
    'ai_wage_cents_per_hour', public.config_bigint('startups', '{aiWorkerWageCentsPerHour}', 12000),
    'ai_worker_skills', to_jsonb(pc.ai_worker_skills),
    'max_employees', public.company_max_employees(p_company),
    'employees', (v_team ->> 'employees')::integer,
    'open_postings', (select count(*) from public.job_postings jp where jp.company_id = p_company and jp.status = 'open')::integer,
    'pending_applications', (select count(*) from public.job_applications a join public.job_postings jp on jp.id = a.posting_id
                              where jp.company_id = p_company and a.status = 'pending')::integer,
    'founder_productivity_bps', (v_team ->> 'founder_productivity_bps')::integer,
    'team_productivity_bps', (v_team ->> 'team_productivity_bps')::integer,
    'capacity_cents', round((v_team ->> 'capacity_cents')::bigint * public.company_capacity_factor(pc.expansion_level))::bigint,
    'next_quarter_at', coalesce((public.current_game_quarter()).ends_at, public.game_now()),
    'can_upgrade', public.company_next_tier(pc.tier) is not null
                   and coalesce(v_level, 1) >= (public.company_tier_cfg(public.company_next_tier(pc.tier)) ->> 'minLevel')::integer,
    'listing', public.company_listing_json(p_company, pc.founder_id),
    'can_go_public', c.phase = 'private' and public.company_open_offer(p_company) is null
                     and coalesce(public.config_jsonb('startups', '{ipo,fromTiers}'), '["garage", "small_business", "gmbh"]'::jsonb) ? pc.tier
                     and coalesce(v_level, 1) >= public.config_double('startups', '{ipo,minLevel}', 6),
    'can_capital_increase', c.phase = 'listed' and public.company_open_offer(p_company) is null,
    'upgrade_cost_cents', v_cost,
    'last_quarter', v_last,
    'history', v_hist,
    'live', public.company_live_json(p_company),
    'hours', public.company_hours_json(p_company))
    || jsonb_build_object(
         'banner', pc.banner,
         -- ADR-083: price strategy, contract work, expansion
         'price_level', pc.price_level,
         'contract_work', pc.contract_work,
         'expansion_level', pc.expansion_level,
         'can_expand', public.company_can_expand(pc.tier),
         'expansion_cost_cents', case when public.company_can_expand(pc.tier)
                                      then public.company_expansion_cost_cents(pc.expansion_level) end,
         'market_factor', round(v_mf::numeric, 4),
         -- ADR-086: share of the hourly profit paid to the founder automatically
         'founder_payout_bps', pc.founder_payout_bps,
         -- ADR-097: the running campaign and the current prices (from the demand of the last closed hour)
         'campaign', case when v_camp.id is not null then public.campaign_json(v_camp.id) end,
         'campaign_costs', public.company_campaign_costs(p_company),
         -- ADR-176: slow strengths with their reward, and a stuck hourly close
         'strengths', public.company_strengths_json(p_company),
         -- ADR-183: the reputation of every company and extra steps of the close that failed
         'reputation', public.company_reputation_json(p_company),
         'close_warnings', public.company_close_warnings_json(p_company),
         -- ADR-203: the value of the company as Top-Unternehmen and the net worth count it
         'worth', public.company_worth_json(p_company));
end;
$$;

-- get_company_profile as in 20261204000200_missions_ai_companies.sql, value from company_worth_cents
create or replace function public.get_company_profile(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  c        public.companies;
  pc       public.player_companies;
  r        public.player_company_reports;
  q        public.security_quotes;
  v_listed boolean := false;
begin
  select * into c from public.companies where id = p_company_id and dissolved_at is null;
  if c.id is null then
    perform public.api_error('company_not_found');
  end if;
  select * into pc from public.player_companies where company_id = c.id;
  if pc.company_id is not null then
    select x.* into r from public.player_company_reports x join public.game_quarters gq on gq.id = x.game_quarter_id
     where x.company_id = c.id order by gq.ends_at desc limit 1;
  end if;
  if c.security_id is not null then
    select * into q from public.security_quotes where security_id = c.security_id;
    v_listed := exists (select 1 from public.securities s where s.id = c.security_id and s.status = 'listed');
  end if;

  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', c.id, 'name', c.name, 'ticker', c.ticker, 'sector', c.sector_key, 'is_ai', c.is_ai,
      'tier', coalesce(pc.tier, c.tier::text), 'brand_color', c.brand_color, 'logo', public.company_logo(c.id),
      'idea', coalesce(pc.idea, c.description), 'founded_at', c.founded_at, 'listed', v_listed,
      'price_e4', case when v_listed then q.last_price_e4 end, 'change_bps', case when v_listed then q.change_bps end),
    'founder', (select jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key)
                  from public.profiles p where p.id = coalesce(pc.founder_id, c.founder_id)),
    'facts', jsonb_build_object(
      -- ADR-203: the same value as on the company page and in Top-Unternehmen
      'value_cents', public.company_worth_cents(c.id),
      'value_basis', case when c.phase = 'listed' and q.last_price_e4 is not null then 'market_cap'
                          when pc.company_id is not null then 'company_value' end,
      'revenue_cents', case when r.company_id is not null then r.revenue_cents
                            when c.is_ai then c.ttm_revenue_cents end,
      'profit_cents', case when r.company_id is not null then r.operating_profit_cents
                           when c.is_ai then c.ttm_net_income_cents end,
      'period', case when r.company_id is not null then 'quarter' when c.is_ai then 'ttm' end,
      'staff', case when pc.company_id is not null
                    then 1 + pc.ai_workers + (select count(*) from public.player_jobs j
                                               where j.company_id = c.id and j.status = 'active')::integer
                    else c.employee_count end,
      'max_staff', c.max_employees,
      'ai_workers', coalesce(pc.ai_workers, 0),
      'product', pc.product_key,
      'stage', case when pc.company_id is not null then public.company_stage(c.id) end,
      'quality_bps', case when r.company_id is not null then r.quality_bps end,
      'awareness_bps', case when r.company_id is not null then r.awareness_bps end),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key, 'tier', j.tier,
                                          'title', coalesce(j.title, j.title_key), 'since', j.started_at)
                       order by case j.tier::text when 'c_level' then 5 when 'team_lead' then 4 when 'senior' then 3
                                                  when 'junior' then 2 else 1 end desc, j.started_at, p.nickname)
        from public.player_jobs j join public.profiles p on p.id = j.player_id
       where j.company_id = c.id and j.status = 'active'), '[]'::jsonb),
    -- ADR-130: latest market news about the company (quarterly results, stock hints, events)
    'news', coalesce((
      select jsonb_agg(jsonb_build_object('headline', n.headline, 'body', n.body, 'category', n.category,
                                          'published_at', n.published_at) order by n.published_at desc)
        from (select ni.headline, ni.body, ni.category, ni.published_at
                from public.news_items ni
               where (ni.company_id = c.id or (c.security_id is not null and ni.security_id = c.security_id))
                 and ni.published_at <= public.game_now()
               order by ni.published_at desc limit 6) n), '[]'::jsonb));
end;
$$;
comment on function public.get_company_profile(uuid) is
  'RPC: public profile of any company with team, facts and latest news (ADR-125, ADR-130); value: company_worth_cents (ADR-203).';

-- ---------------------------------------------------------------------------
-- E. Weekly league: the net worth without the vault (as in M4f, 20261127000200)
-- ---------------------------------------------------------------------------
create or replace function public.league_refresh(p_season uuid, p_add_new boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min   bigint := greatest(1, public.config_bigint('social', '{league,minBaselineCents}', 1000000));
  v_count integer;
begin
  -- ADR-203: every part of the net worth except the vault (basic income is free money, ADR-089)
  with nw as materialized (
    select w.player_id, w.total_cents - w.vault_cents as nw from public.player_wealth_parts(null) w
  ), new_entries as (
    insert into public.league_entries (season_id, player_id)
    select p_season, n.player_id from nw n
     where p_add_new
       and not exists (select 1 from public.league_entries x where x.season_id = p_season and x.player_id = n.player_id)
    on conflict do nothing
    returning player_id
  ), new_baselines as (
    insert into public.league_entry_baselines (season_id, player_id, start_net_worth_cents, current_net_worth_cents)
    select p_season, x.player_id, n.nw, n.nw from new_entries x join nw n on n.player_id = x.player_id
    on conflict do nothing
    returning player_id
  )
  update public.league_entry_baselines b
     set current_net_worth_cents = n.nw, updated_at = now()
    from nw n
   where b.season_id = p_season and b.player_id = n.player_id and b.current_net_worth_cents <> n.nw;

  update public.league_entries e
     set growth_bps = greatest(-2000000000, least(2000000000, public.div_round_half_even(
                        (b.current_net_worth_cents - b.start_net_worth_cents - b.net_inflow_cents)::numeric * 10000,
                        greatest(b.start_net_worth_cents, v_min))))::integer,
         updated_at = now()
    from public.league_entry_baselines b
   where e.season_id = p_season and b.season_id = e.season_id and b.player_id = e.player_id;

  -- rank: growth, then the earlier account, then nickname; deactivated players are not ranked
  update public.league_entries e set rank = r.rk
    from (select x.player_id,
                 (row_number() over (order by x.growth_bps desc, p.created_at, lower(p.nickname), p.id))::integer as rk
            from public.league_entries x join public.profiles p on p.id = x.player_id
           where x.season_id = p_season and not p.is_deactivated) r
   where e.season_id = p_season and e.player_id = r.player_id and e.rank is distinct from r.rk;
  update public.league_entries e set rank = null
   where e.season_id = p_season and e.rank is not null
     and exists (select 1 from public.profiles p where p.id = e.player_id and p.is_deactivated);

  update public.league_seasons set refreshed_at = public.game_now(), updated_at = now() where id = p_season;
  select count(*) into v_count from public.league_entries e where e.season_id = p_season and e.rank is not null;
  return v_count;
end;
$$;

-- once: the running season keeps its growth (the start moves by what the new definition changes)
do $do$
declare
  v_run bigint;
begin
  insert into public.job_runs (job_name, run_key, status, finished_at)
  values ('toplists_rebase', '20261204009500', 'succeeded', now())
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is not null then
    update public.league_entry_baselines b
       set start_net_worth_cents = b.start_net_worth_cents + (w.total_cents - w.vault_cents - b.current_net_worth_cents),
           current_net_worth_cents = w.total_cents - w.vault_cents,
           updated_at = now()
      from public.league_seasons s, public.player_wealth_parts(null) w
     where s.id = b.season_id and s.status = 'active' and w.player_id = b.player_id;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- F. Rights, cron, first snapshot
-- ---------------------------------------------------------------------------
do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.company_worth_cents(uuid)', 'public.company_worth_json(uuid)', 'public.player_wealth_parts(uuid)',
    'public.player_net_worth_cents(uuid)', 'public.rich_list_rows()', 'public.rich_list_entries()',
    'public.company_ranking_rows()', 'public.company_ranking_snapshot(boolean)', 'public.company_ranking_entry_json(jsonb)',
    'public.league_refresh(uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_rich_list(integer, integer, text)', 'public.get_company_ranking(text, integer, text)',
    'public.get_my_net_worth()', 'public.get_company_profile(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-company-ranking';
    perform cron.schedule('nexa-company-ranking', '*/10 * * * *', 'select public.company_ranking_snapshot()');
  end if;
end;
$do$;

do $do$
begin
  perform public.company_ranking_snapshot(false);
end;
$do$;
