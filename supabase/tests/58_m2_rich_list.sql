-- =============================================================================
-- 58 · M2 rich list: AI tycoons, ranking, 24 h changes, rank news
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set r1 '''0e1e1e1e-0000-4000-8000-00000000001e'''
\set r2 '''0e2e2e2e-0000-4000-8000-00000000002e'''

-- tycoons ----------------------------------------------------------------------------
select tests.assert(
  (select count(*) from public.rich_tycoons) = 120
  and (select sum(cash_cents) from public.rich_tycoons) = (select balance_cents from public.ledger_accounts where system_key = 'tycoons')
  and (select count(distinct name) from public.rich_tycoons) = 120
  and (select count(*) from public.rich_tycoons where founder_company_id is not null) = 25,
  '120 AI tycoons, unique names, 25 founders, their cash is exactly the tycoon money (' ||
  (select round(sum(cash_cents) / 100.0) from public.rich_tycoons) || ' EUR)');
select tests.assert(
  not exists (select 1 from public.rich_tycoon_holdings h join public.securities s on s.id = h.security_id
                join public.companies c on c.id = s.company_id
               group by c.id, c.shares_outstanding having sum(h.quantity_e6) > c.shares_outstanding * 600000)
  and not exists (select 1 from public.rich_tycoons t join public.rich_tycoon_holdings h on h.tycoon_id = t.id
                    join public.companies c on c.security_id = h.security_id and c.id = t.founder_company_id
                   where h.quantity_e6 > c.shares_outstanding * 400000),
  'tycoons hold at most 60 % of any company, founders at most 40 % of their own');
select tests.assert(true, 'tycoon top 10: ' || string_agg(rank_all || '. ' || name || ' (' || description || ') ' ||
    public.format_eur_short(net_worth_cents), '; ' order by rank_all))
  from public.rich_list_entries() where entity_kind = 'tycoon' and rank_all <= 10;
select tests.assert(true, 'tycoon net worth percentiles p10/p25/p50/p75/p90/max: ' ||
  (select string_agg(public.format_eur_short(v), ' / ' order by o) from unnest(array[
     percentile_disc(0.1) within group (order by net_worth_cents), percentile_disc(0.25) within group (order by net_worth_cents),
     percentile_disc(0.5) within group (order by net_worth_cents), percentile_disc(0.75) within group (order by net_worth_cents),
     percentile_disc(0.9) within group (order by net_worth_cents), max(net_worth_cents)]) with ordinality as u(v, o)))
  from public.rich_list_entries() where entity_kind = 'tycoon';
select tests.assert(
  (select max(net_worth_cents) between 30000000000 and 50000000000 and min(net_worth_cents) between 1000000 and 2500000
     from public.rich_list_entries() where entity_kind = 'tycoon'),
  'tycoon wealth spans about 15 000 EUR to 400 Mio. EUR (moves with share prices)');

-- get_rich_list ---------------------------------------------------------------------
select tests.signup(:r1, 'Rita_Reich') is not null and tests.signup(:r2, 'Rolf_Reich') is not null as ok \gset
select tests.login_as('authenticated', :r1);
select public.get_rich_list() as rl \gset
select public.get_rich_list(10, 0, 'players') as rlp \gset
select public.get_rich_list(5, 100) as rl2 \gset
select tests.throws_key($$select public.get_rich_list(10, 0, 'aliens')$$, 'invalid_argument', 'unknown scope');
reset role;
select tests.assert(
  :'rl'::jsonb ?& array['server_time', 'total', 'entries', 'me']
  and (:'rl'::jsonb ->> 'total')::int = (select count(*) from public.profiles where not is_deactivated) + 120
  and jsonb_array_length(:'rl'::jsonb -> 'entries') = 100
  and (select bool_and((x ->> 'rank')::int = o) and bool_and(x ?& array['rank', 'kind', 'id', 'name', 'description', 'net_worth_cents',
                                                                     'change_24h_bps', 'rank_change_24h', 'is_me'])
         from jsonb_array_elements(:'rl'::jsonb -> 'entries') with ordinality a(x, o))
  and (select bool_and(z.nw <= z.prev) is not false
         from (select (x ->> 'net_worth_cents')::bigint as nw, lag((x ->> 'net_worth_cents')::bigint) over (order by o) as prev
                 from jsonb_array_elements(:'rl'::jsonb -> 'entries') with ordinality a(x, o)) z where z.prev is not null),
  'get_rich_list(): total = players + 120 tycoons, 100 entries ranked 1..100 with every field');
select tests.assert(
  (:'rl'::jsonb -> 'me' ->> 'rank')::int > 1
  and (:'rl'::jsonb -> 'me' -> 'next' ->> 'rank')::int = (:'rl'::jsonb -> 'me' ->> 'rank')::int - 1
  and (:'rl'::jsonb -> 'me' -> 'next' ->> 'gap_cents')::bigint >= 0
  and (:'rl'::jsonb -> 'me' ->> 'net_worth_cents')::bigint = public.player_net_worth_cents(:r1),
  'me: own rank ' || (:'rl'::jsonb -> 'me' ->> 'rank') || ', ' || (:'rl'::jsonb -> 'me' -> 'next' ->> 'gap_cents') || ' cents to ' ||
  (:'rl'::jsonb -> 'me' -> 'next' ->> 'name'));
select tests.assert(
  (select bool_and(x ->> 'kind' = 'player') from jsonb_array_elements(:'rlp'::jsonb -> 'entries') x)
  and (:'rlp'::jsonb -> 'entries' -> 0 ->> 'rank')::int = 1
  and (:'rlp'::jsonb ->> 'total')::int = (select count(*) from public.profiles where not is_deactivated)
  and (:'rl2'::jsonb -> 'entries' -> 0 ->> 'rank')::int = 101,
  'scope players ranks players only; offset pages');

-- 24 h change, rank news (rolled back) ------------------------------------------------------
begin;
-- a snapshot from 25 h ago with half the current wealth of Rita
insert into public.rich_list_snapshots (taken_at, entity_kind, entity_id, net_worth_cents, rank_all, rank_players)
select now() - interval '25 hours', e.entity_kind, e.entity_id,
       case when e.entity_id = :r1 then e.net_worth_cents / 2 else e.net_worth_cents end, e.rank_all + 3, e.rank_players
  from public.rich_list_entries() e;
select tests.login_as('authenticated', :r1);
select public.get_rich_list(500) as rl3 \gset
reset role;
select tests.assert(
  (select (x ->> 'change_24h_bps')::int = 10000 and (x ->> 'rank_change_24h')::int = 3 and (x ->> 'is_me')::boolean
     from jsonb_array_elements(:'rl3'::jsonb -> 'entries') x where x ->> 'id' = :r1),
  'change_24h_bps and rank_change_24h against the snapshot 24 h ago (+100 %, 3 places up)');

-- Rita becomes the richest person, Rolf overtakes Rita among players later
select public.rich_list_snapshot(true) is not null as ok \gset
select public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(:r1), 50000000000, 'transfer', 'test') is not null as ok \gset
select public.rich_list_snapshot(true) as s1 \gset
select public.ledger_transfer(public.ledger_system_account('households'), public.ledger_player_account(:r2), 60000000000, 'transfer', 'test') is not null as ok \gset
select public.rich_list_snapshot(true) as s2 \gset
select tests.login_as('authenticated', :r2);
select public.get_rich_list_news(10) as news \gset
reset role;
\echo '   news:' :news
select tests.assert(
  (select count(*) from jsonb_array_elements(:'news'::jsonb) x where x ->> 'kind' = 'number_one' and x ->> 'player_id' = :r1) = 1
  and (select count(*) from jsonb_array_elements(:'news'::jsonb) x where x ->> 'kind' = 'players_one') >= 1
  and (select count(*) from jsonb_array_elements(:'news'::jsonb) x where x ->> 'kind' = 'overtake' and x ->> 'player_id' = :r2
         and x ->> 'headline' like '%Rita_Reich%') = 1
  and (select bool_and(x ?& array['published_at', 'headline', 'body', 'kind', 'player_id']) from jsonb_array_elements(:'news'::jsonb) x),
  'rank news: new number one, number one among players, overtaking');

-- top gainer of the day: at 22:00 Berlin or later
update public.sim_runtime
   set time_offset = (((now() at time zone 'Europe/Berlin')::date + interval '23 hours') at time zone 'Europe/Berlin') - now();
insert into public.rich_list_snapshots (taken_at, entity_kind, entity_id, net_worth_cents, rank_all, rank_players)
values (public.game_now() - interval '25 hours', 'player', :r2, 1000000, 200, 50) on conflict do nothing;
-- between 22:00 and 24:00 Berlin real time an earlier snapshot of this file already claimed the day's run
delete from public.job_runs where job_name = 'rich_top_gainer';
select public.rich_list_snapshot(true) as s3 \gset
select tests.assert(
  (select count(*) from public.news_items where template_key = 'rich_top_gainer') = 1,
  'from 22:00 the biggest 24 h gainer of the day makes the news (' ||
  (select headline from public.news_items where template_key = 'rich_top_gainer' limit 1) || ')');
rollback;

select tests.assert(
  (select count(distinct taken_at) from public.rich_list_snapshots) >= 1
  and not exists (select 1 from public.rich_list_snapshots where taken_at < now() - interval '8 days 1 hour'),
  'snapshots are kept for 8 days');
