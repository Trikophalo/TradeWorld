-- =============================================================================
-- c4 · Business figures at the stock exchange (ADR-184): a listed player company shows revenue of the last closed
--      hour, revenue and profit of the last 24 hours, the previous day for the trend, reputation and awareness;
--      AI companies show their latest quarterly report. Public, read-only, nothing beyond these aggregates.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''0c4c4c4c-0000-4000-8000-0000000000f1'''
\set i '''0c4c4c4c-0000-4000-8000-0000000000a2'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:f, 'Bs_Gruender') is not null and tests.signup(:i, 'Bs_Anleger') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:f, 20);
select tests.set_level(:i, 20);
select tests.fund(:f, 90000000, 'test:c4:f');
select tests.fund(:i, 900000000, 'test:c4:i');

-- ---------------------------------------------------------------------------
-- 1. A player company goes public
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Umsatzwerk', 'Zahlen für alle', 'retail', '#446688', 'small_business') is not null as ok \gset
reset role;
select tests.company_of(:f) as co \gset
select tests.set_company_cash(:'co', 5000000);
select tests.login_as('authenticated', :f);
select public.hire_ai_workers(gen_random_uuid(), 3) is not null as ok \gset
select public.go_public(gen_random_uuid(), 40) -> 'company' -> 'listing' -> 'offer' ->> 'id' as offer \gset
reset role;
select price_cents as iprice from public.company_share_offers where id = :'offer' \gset
select tests.login_as('authenticated', :i);
select public.subscribe_offer(gen_random_uuid(), :'offer', 250000 * :iprice) is not null as ok \gset
reset role;
update public.player_companies set quality = 1 where company_id = :'co';
update public.company_share_offers set ends_at = now() - interval '1 second' where id = :'offer';
select public.close_due_offers() is not null as ok \gset
select tests.assert(public.listed_is(:'co'), 'c4: the company went public');
select c.ticker as tkr from public.companies c where c.id = :'co' \gset

-- the stock is listed, but no hour closed yet: zero revenue, no trend, the reputation and awareness already show
update public.player_companies set potential_annual_cents = 50000000, awareness = 0.42, quality = 0.8, reputation = 61.6
 where company_id = :'co';
delete from public.player_company_hours where company_id = :'co';
select tests.login_as('authenticated', :i);
select public.get_stock_revenue(:'tkr') -> 'figures' -> 0 as g0 \gset
reset role;
select tests.assert(
  :'g0'::jsonb ->> 'company_kind' = 'player' and :'g0'::jsonb ->> 'period' = 'day'
  and (:'g0'::jsonb ->> 'revenue_cents')::bigint = 0 and (:'g0'::jsonb ->> 'hours')::integer = 0
  and :'g0'::jsonb -> 'prev_revenue_cents' = 'null'::jsonb and :'g0'::jsonb -> 'last_hour_at' = 'null'::jsonb
  and (:'g0'::jsonb ->> 'reputation')::integer = 62 and (:'g0'::jsonb ->> 'awareness_bps')::integer = 4200,
  'c4: a freshly listed company shows 0 € without a trend, reputation and awareness already');

-- ---------------------------------------------------------------------------
-- 2. Hours close: the figures are the sums of the hours, the previous day sets the trend
-- ---------------------------------------------------------------------------
select date_trunc('hour', public.game_now()) - interval '3 hours' as h0 \gset
update public.player_companies set last_hour_at = :'h0' where company_id = :'co';
select public.player_company_close_hour(:'co', :'h0') is not null as ok \gset
select public.player_company_close_hour(:'co', :'h0'::timestamptz + interval '1 hour') is not null as ok \gset
select public.player_company_close_hour(:'co', :'h0'::timestamptz + interval '2 hours') is not null as ok \gset
select tests.assert((select count(*) from public.player_company_hours where company_id = :'co') = 3,
  'c4: three hours closed');
-- the oldest hour moves into the previous day, with a known revenue
update public.player_company_hours set hour_start = :'h0'::timestamptz - interval '30 hours', revenue_cents = 1000
 where company_id = :'co' and hour_start = :'h0';
select tests.login_as('authenticated', :i);
select public.get_stock_revenue(:'tkr') -> 'figures' -> 0 as g1 \gset
select public.get_stock_revenue() as all1 \gset
reset role;
select coalesce(sum(revenue_cents), 0) as rev24, coalesce(sum(profit_cents), 0) as profit24
  from public.player_company_hours where company_id = :'co' and hour_start >= :'h0'::timestamptz - interval '21 hours' \gset
select revenue_cents as lastrev, hour_start as lastat from public.player_company_hours
 where company_id = :'co' order by hour_start desc limit 1 \gset
select tests.assert(
  (:'g1'::jsonb ->> 'revenue_cents')::bigint = :'rev24'::bigint and :'rev24'::bigint > 0
  and (:'g1'::jsonb ->> 'profit_cents')::bigint = :'profit24'::bigint
  and (:'g1'::jsonb ->> 'hours')::integer = 2
  and (:'g1'::jsonb ->> 'last_hour_revenue_cents')::bigint = :'lastrev'::bigint
  and (:'g1'::jsonb ->> 'last_hour_at')::timestamptz = :'lastat'::timestamptz,
  'c4: revenue and profit of the last 24 hours are the sums of the closed hours, the last hour is the newest one');
select tests.assert(
  (:'g1'::jsonb ->> 'prev_revenue_cents')::bigint = 2000
  and jsonb_array_length(:'g1'::jsonb -> 'history') = 2
  and (:'g1'::jsonb #>> '{history,1}')::bigint = :'lastrev'::bigint,
  'c4: the previous day counts per hour (1 hour of 10 € → 20 € for 2 hours), the sparkline holds the day oldest first');
select tests.assert(
  (select array_agg(k order by k) from jsonb_object_keys(:'g1'::jsonb) k)
    = array['awareness_bps', 'company_kind', 'game_year', 'history', 'hours', 'last_hour_at', 'last_hour_revenue_cents',
            'period', 'prev_revenue_cents', 'profit_cents', 'quarter', 'reputation', 'revenue_cents', 'ticker'],
  'c4: only the public aggregates leave the server (no cash, wages or costs)');

-- ---------------------------------------------------------------------------
-- 3. The list: every listed stock, player and AI, without the sparkline
-- ---------------------------------------------------------------------------
select tests.assert(
  exists (select 1 from jsonb_array_elements(:'all1'::jsonb -> 'figures') e
           where e ->> 'ticker' = :'tkr' and e ->> 'company_kind' = 'player'
             and (e ->> 'revenue_cents')::bigint = :'rev24'::bigint and jsonb_array_length(e -> 'history') = 0)
  and exists (select 1 from jsonb_array_elements(:'all1'::jsonb -> 'figures') e
               where e ->> 'ticker' = 'VLT' and e ->> 'company_kind' = 'ai' and e ->> 'period' = 'quarter'
                 and e -> 'reputation' = 'null'::jsonb)
  and jsonb_array_length(:'all1'::jsonb -> 'figures')
      = (select count(*) from public.securities s where s.kind = 'stock' and s.status = 'listed' and s.company_id is not null),
  'c4: the list carries every listed stock (player and AI), compact without history');

-- ---------------------------------------------------------------------------
-- 4. AI companies: the latest published report, the one before for the trend
-- ---------------------------------------------------------------------------
select s.company_id as vco from public.securities s where s.ticker = 'VLT' \gset
select r.revenue_cents as vrev, r.net_income_cents as vnet, gq.game_year as vyear, gq.quarter as vq
  from public.company_quarter_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
 where r.company_id = :'vco' and r.published_at is not null and r.published_at <= now()
 order by gq.starts_at desc limit 1 \gset
select tests.login_as('authenticated', :i);
select public.get_stock_revenue('VLT') -> 'figures' -> 0 as gv \gset
reset role;
select tests.assert(
  (:'gv'::jsonb ->> 'revenue_cents')::bigint = :'vrev'::bigint
  and (:'gv'::jsonb ->> 'profit_cents')::bigint = :'vnet'::bigint
  and (:'gv'::jsonb ->> 'game_year')::integer = :'vyear'::integer
  and (:'gv'::jsonb ->> 'quarter')::integer = :'vq'::integer
  and jsonb_array_length(:'gv'::jsonb -> 'history') between 1 and 8,
  'c4: an AI company shows its latest published quarterly report with game year and quarter');

-- ---------------------------------------------------------------------------
-- 5. Access: signed-in players only, unknown tickers fail, bonds have no figures
-- ---------------------------------------------------------------------------
select tests.assert(
  not has_function_privilege('anon', 'public.get_stock_revenue(text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_stock_revenue(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.stock_figures_json(uuid, boolean)', 'execute'),
  'c4: the RPC is for signed-in players, the helper is internal');
select tests.login_as('authenticated', :i);
select tests.throws_key($$select public.get_stock_revenue('NOPE')$$, 'unknown_security', 'c4: unknown ticker');
select jsonb_array_length(public.get_stock_revenue('NXB02') -> 'figures') as nb \gset
reset role;
select tests.assert(:nb = 0, 'c4: a bond has no business figures');
