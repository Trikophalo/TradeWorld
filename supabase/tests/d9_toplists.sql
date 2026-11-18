-- =============================================================================
-- d5 · Toplists (ADR-203): one value per company everywhere (company page = Top-Unternehmen = profile = stake in
--      the net worth), the net worth is the sum of its parts (cash, depot, company, cards, slabs, NFTs, property,
--      vault, escrow, deals, debt) on the business card, the rich list and in get_my_net_worth; a listed company is
--      not counted twice; sector filter; change against yesterday; the weekly league leaves out the vault.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set p '''0d9d9d9d-0000-4000-8000-0000000000a1'''
\set l '''0d9d9d9d-0000-4000-8000-0000000000b1'''
\set h '''0d9d9d9d-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:p, 'Tl_Privat') is not null and tests.signup(:l, 'Tl_Boerse') is not null
   and tests.signup(:h, 'Tl_Halter') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(x, 12) from unnest(array[:p, :l, :h]::uuid[]) x;
select tests.fund(:p, 5000000, 'test:d5:p');
select tests.fund(:l, 5000000, 'test:d5:l');
select tests.fund(:h, 900000000, 'test:d5:h');
-- a full vault does not grow between two statements
update public.vaults set accrual_started_at = now() - interval '30 days' where player_id in (:p, :l, :h);

create or replace function tests.tl_sum(p_player uuid) returns boolean language sql security definer as $$
  select w.cash_cents + w.depot_cents + w.company_cents + w.cards_cents + w.slabs_cents + w.nfts_cents + w.property_cents
         + w.vault_cents + w.escrow_cents + w.deals_cents + w.debt_cents = w.total_cents
     and w.total_cents = public.player_net_worth_cents(p_player)
     and w.total_cents = (select e.net_worth_cents from public.rich_list_entries() e where e.entity_kind = 'player' and e.entity_id = p_player)
    from public.player_wealth_parts(p_player) w $$;
create or replace function tests.tl_rank_value(p_company uuid, p_scope text default 'players') returns bigint language sql security definer as $$
  select (e ->> 'value_cents')::bigint from jsonb_array_elements(public.get_company_ranking(p_scope, 500) -> 'entries') e
   where e ->> 'company_id' = p_company::text $$;
grant execute on all functions in schema tests to public;

-- =============================================================================
-- A. A private company: the company page, Top-Unternehmen, the profile and the net worth use one value
-- =============================================================================
select tests.login_as('authenticated', :p);
select public.found_company(gen_random_uuid(), 'Privatwert', 'Bleibt privat', 'tech', '#225588', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:p) as pco \gset
select tests.login_as('authenticated', :p);
select (public.get_my_company() -> 'company' -> 'worth') as pw \gset
select (public.get_my_company() -> 'company' ->> 'value_cents')::bigint as pv_old \gset
select tests.tl_rank_value(:'pco') as prank \gset
select (public.get_company_profile(:'pco') -> 'facts' ->> 'value_cents')::bigint as pprof \gset
select public.get_company_profile(:'pco') -> 'facts' ->> 'value_basis' as pbasis \gset
reset role;
select tests.assert(
  (:'pw'::jsonb ->> 'cents')::bigint = public.company_worth_cents(:'pco')
  and public.company_worth_cents(:'pco') = public.company_value_cents(:'pco')
  and :'pw'::jsonb ->> 'basis' = 'company_value' and :pv_old::bigint = public.company_value_cents(:'pco')
  and :prank::bigint = public.company_worth_cents(:'pco') and :pprof::bigint = public.company_worth_cents(:'pco')
  and :'pbasis' = 'company_value',
  'PRIVATE: company page (worth), Top-Unternehmen and company profile show company_worth_cents = company_value_cents');
select tests.assert(
  (select w.company_cents from public.player_wealth_parts(:p) w) = public.company_worth_cents(:'pco') and tests.tl_sum(:p),
  'PRIVATE: the founder''s company part is the same value; parts sum to the net worth = rich list');

-- =============================================================================
-- B. Every asset class: Nexamon card, slab, NFT, vault
-- =============================================================================
select tests.set_cfg('nexamon', '{ai,packsPerHour}', '{"mystic_energy": 0, "super_apex": 0, "prismatic_peak": 0, "cosmic_winds": 0}');
select tests.set_cfg('nexamon', '{ai,buyChanceBps}', '0');
select card_key as cr from public.nexamon_cards where set_key = 'mystic_energy' and rarity = 'rare' order by number limit 1 \gset
select public.player_net_worth_cents(:p) as nw0 \gset
select tests.nx_give(:p, :'cr', 'good') as raw1 \gset
select tests.nx_give(:p, :'cr', 'mint') as slab1 \gset
update public.nexamon_copies set grade = 9 where id = :'slab1';
select tests.assert(
  (select w.cards_cents from public.player_wealth_parts(:p) w) = tests.nx_value(:'cr', 'good')
  and (select w.slabs_cents from public.player_wealth_parts(:p) w) = tests.nx_value(:'cr', 'mint', 9)
  and public.player_net_worth_cents(:p) = :nw0::bigint + tests.nx_value(:'cr', 'good') + tests.nx_value(:'cr', 'mint', 9),
  'NEXAMON: a raw card at market value x condition, a slab at market value x grade, both in the net worth');
select tests.assert(
  (select w.vault_cents from public.player_wealth_parts(:p) w) = (public.vault_status(:p) ->> 'accrued_cents')::bigint
  and (select w.vault_cents from public.player_wealth_parts(:p) w) > 0
  and (select w.nfts_cents from public.player_wealth_parts(:p) w) = public.player_art_value_cents(:p)
  and (select w.property_cents from public.player_wealth_parts(:p) w) = public.player_property_value_cents(:p)
  and tests.tl_sum(:p),
  'VAULT, NFTs, PROPERTY: the vault counts with what claiming would pay; parts still sum to the net worth');
select tests.login_as('authenticated', :p);
select public.get_my_net_worth() as mynw \gset
select (public.get_rich_list(500, 0, 'players') -> 'me' ->> 'net_worth_cents')::bigint as rl_me \gset
select (public.get_rich_list(500, 0, 'players') -> 'me' ->> 'source') as rl_src \gset
reset role;
select tests.assert(
  (:'mynw'::jsonb ->> 'total_cents')::bigint = public.player_net_worth_cents(:p)
  and :rl_me::bigint = public.player_net_worth_cents(:p)
  and (select sum(v::bigint) from jsonb_each_text(:'mynw'::jsonb -> 'parts') x(k, v)) = (:'mynw'::jsonb ->> 'total_cents')::bigint
  and (:'mynw'::jsonb -> 'company' ->> 'cents')::bigint = public.company_worth_cents(:'pco')
  and :'rl_src' in ('cash', 'depot', 'company', 'cards', 'nfts', 'property'),
  'get_my_net_worth(): the parts sum to the total, which is the Forbes value; the own company at its worth');

-- =============================================================================
-- C. A listed company: market cap everywhere, the founder's shares are not counted twice
-- =============================================================================
select tests.login_as('authenticated', :l);
select public.found_company(gen_random_uuid(), 'Boersenwerk', 'An die Boerse', 'energy', '#336699', 'garage') is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select tests.company_of(:l) as lco \gset
select price_cents as iprice from public.company_share_offers where id = :'offer' \gset
select public.player_net_worth_cents(:h) as h0 \gset
select tests.login_as('authenticated', :h);
select public.subscribe_offer(gen_random_uuid(), :'offer', 350000 * :iprice) is not null as ok \gset
reset role;
select tests.assert(
  (select w.escrow_cents from public.player_wealth_parts(:h) w) = 350000 * :iprice::bigint
  and public.player_net_worth_cents(:h) = :h0::bigint and tests.tl_sum(:h),
  'ESCROW: money of an open subscription counts for the subscriber, subscribing does not make poorer');
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select c.security_id as lsec, c.shares_outstanding as lshares from public.companies c where c.id = :'lco' \gset
-- a market price far away from the earnings value (as on the live server: 3 Mio. against 49,4 Mio.)
update public.security_quotes set last_price_e4 = 123457, bid_e4 = 123000, ask_e4 = 124000 where security_id = :'lsec';
select tests.login_as('authenticated', :l);
select (public.get_my_company() -> 'company' -> 'worth') as lw \gset
select tests.tl_rank_value(:'lco') as lrank \gset
select tests.tl_rank_value(:'lco', 'all') as lrank_all \gset
select (public.get_company_profile(:'lco') -> 'facts' ->> 'value_cents')::bigint as lprof \gset
reset role;
select tests.assert(
  (select phase from public.companies where id = :'lco') = 'listed'
  and public.company_worth_cents(:'lco') = public.div_round_half_even(:lshares::numeric * 123457, 100)
  and (:'lw'::jsonb ->> 'cents')::bigint = public.company_worth_cents(:'lco') and :'lw'::jsonb ->> 'basis' = 'market_cap'
  and (:'lw'::jsonb ->> 'company_value_cents')::bigint = public.company_value_cents(:'lco')
  and :lrank::bigint = public.company_worth_cents(:'lco') and :lrank_all::bigint = public.company_worth_cents(:'lco')
  and :lprof::bigint = public.company_worth_cents(:'lco'),
  'LISTED: company page, Top-Unternehmen (both scopes) and profile show the market cap; the earnings value stays visible');
select tests.assert(
  (select w.company_cents from public.player_wealth_parts(:l) w)
    = (select public.value_cents(x.quantity_e6, 123457) from public.positions x where x.player_id = :l and x.security_id = :'lsec')
  and (select w.depot_cents from public.player_wealth_parts(:l) w) = 0
  and tests.tl_sum(:l)
  and public.player_net_worth_cents(:l) < (select w.cash_cents from public.player_wealth_parts(:l) w)
                                          + public.company_value_cents(:'lco')
                                          + (select public.value_cents(x.quantity_e6, 123000) from public.positions x
                                              where x.player_id = :l and x.security_id = :'lsec'),
  'LISTED: the founder''s stake = own shares x the same last price, not in the depot, not counted twice');
select tests.assert(
  (select w.depot_cents from public.player_wealth_parts(:h) w)
    = (select sum(public.value_cents(x.quantity_e6, coalesce(q.bid_e4, q.last_price_e4))) from public.positions x
         join public.security_quotes q on q.security_id = x.security_id where x.player_id = :h and x.status = 'open')
  and (select w.escrow_cents from public.player_wealth_parts(:h) w) = 0 and tests.tl_sum(:h),
  'SHAREHOLDER: other people''s shares are depot at the bid; the escrow is gone once the shares are delivered');

-- =============================================================================
-- D. Filter by sector, own entry, change against yesterday
-- =============================================================================
select tests.login_as('authenticated', :l);
select public.get_company_ranking('all', 500, 'energy') as rk_energy \gset
reset role;
select tests.assert(
  (select bool_and(e ->> 'sector' = 'energy') from jsonb_array_elements(:'rk_energy'::jsonb -> 'entries') e)
  and (:'rk_energy'::jsonb -> 'mine' ->> 'company_id') = :'lco'
  and (:'rk_energy'::jsonb -> 'mine' ->> 'basis') = 'market_cap'
  and (:'rk_energy'::jsonb -> 'mine' ->> 'price_e4')::bigint = 123457,
  'SECTOR: only energy companies; the own company comes in full with basis and price');
select tests.login_as('authenticated', :l);
select tests.throws_key($$select public.get_company_ranking('all', 10, 'kein_sektor')$$, 'invalid_argument',
  'get_company_ranking(): unknown sector rejected');
reset role;
select public.company_ranking_snapshot(true) ->> 'taken_at' as snap_at \gset
-- this snapshot becomes "yesterday", with half today's value of the listed company
delete from public.company_rank_snapshots where taken_at < now() - interval '23 hours';
update public.company_rank_snapshots set taken_at = taken_at - interval '25 hours' where taken_at = :'snap_at'::timestamptz;
update public.company_rank_snapshots set value_cents = value_cents / 2
 where company_id = :'lco' and taken_at = :'snap_at'::timestamptz - interval '25 hours';
select tests.login_as('authenticated', :l);
select public.get_company_ranking('players', 500) -> 'mine' as mine \gset
reset role;
select tests.assert(
  (:'mine'::jsonb ->> 'change_24h_bps')::integer between 9990 and 10010
  and (:'mine'::jsonb ->> 'rank_change_24h') is not null,
  'YESTERDAY: change against the snapshot 24 h ago (value doubled: +100 %), rank change present');

-- =============================================================================
-- E. Weekly league: the net worth without the vault
-- =============================================================================
select public.league_refresh(public.league_ensure_season(public.game_now()), true) is not null as ok \gset
select tests.assert(
  (select b.current_net_worth_cents from public.league_entry_baselines b
    where b.player_id = :p and b.season_id = public.league_ensure_season(public.game_now()))
  = (select w.total_cents - w.vault_cents from public.player_wealth_parts(:p) w),
  'LEAGUE: the weekly league counts every part except the vault (free money, ADR-089)');
