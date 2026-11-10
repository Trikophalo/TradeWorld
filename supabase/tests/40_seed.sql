-- =============================================================================
-- 40 · Seed data (f)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

select tests.assert((select count(*) from public.sectors) = 5, '5 sectors');
select tests.assert((select count(*) from public.companies where is_ai) = 15, '15 AI companies');
select tests.assert(
  (select count(*) from (select sector_key from public.companies where is_ai
                          group by sector_key having count(*) = 3 and count(distinct tier) = 3) x) = 5,
  'each sector has one bluechip, one midcap and one penny stock');
select tests.assert(
  (select array_agg(ticker order by ticker) from public.companies where is_ai)
  = array['ALM','BRZ','EBX','FGD','FPT','GNV','KFR','KLS','NDL','NPH','PXW','QSL','RKW','SFX','VLT'],
  'tickers match ADR-014');
select tests.assert(
  (select count(*) from public.companies c
     join public.securities s on s.id = c.security_id and s.kind = 'stock' and s.status = 'listed' and s.ticker = c.ticker
     join public.security_quotes q on q.security_id = s.id and q.bid_e4 < q.last_price_e4 and q.ask_e4 > q.last_price_e4
     join public.security_sim_state ss on ss.security_id = s.id and ss.fair_value_e4 = q.last_price_e4
     join public.company_state cs on cs.company_id = c.id and cs.quality > 0 and cs.awareness > 0 and cs.baseline_revenue_cents > 0
     join public.ledger_accounts a on a.owner_company_id = c.id and a.kind = 'company_cash' and a.balance_cents > 0
    where c.is_ai and c.description is not null and c.shares_outstanding > 0
      and q.market_cap_cents = round(c.shares_outstanding::numeric * q.last_price_e4 / 100)) = 15,
  'every AI company has description, stock, quote with spread, sim state, fundamentals and a funded cash account');
select tests.assert(
  (select count(*) from public.securities s join public.security_quotes q on q.security_id = s.id
    where s.kind = 'stock' and (q.last_price_e4 % s.tick_size_e4 <> 0 or q.bid_e4 % s.tick_size_e4 <> 0)) = 0,
  'start prices and quotes are on the tick grid');
select tests.assert(
  (select min(q.last_price_e4) < 10000 and max(q.last_price_e4) > 1000000
     from public.security_quotes q join public.securities s on s.id = q.security_id where s.kind = 'stock'),
  'price range spans penny stocks (< 1 EUR) to bluechips (> 100 EUR)');
select tests.assert(
  (select eps_ttm_e4 = 30000 and ttm_revenue_cents = 168000000000 from public.companies where ticker = 'KLS'),
  'KlarSoft: EPS 3.00 EUR, TTM revenue 1.68 bn EUR (unit conversion check)');

select tests.assert(
  (select array_agg(b.term_game_years order by b.term_game_years) from public.bonds b) = array[1, 2, 5, 10]::smallint[],
  'government bonds with 1, 2, 5 and 10 game-year terms');
select tests.assert(
  (select bool_and(b.coupon_bps between 200 and 400 and (b.matures_at at time zone 'Europe/Berlin') = (b.issued_at at time zone 'Europe/Berlin') + make_interval(days => b.term_game_years)
                   and q.last_price_e4 = 1000000)
     from public.bonds b join public.security_quotes q on q.security_id = b.security_id),
  'bond coupons 2-4 %, maturity = term in real days, quoted at par');

select tests.assert(
  (select count(*) from public.indices i join public.securities s on s.id = i.security_id
    where i.key = 'NEXA30' and s.kind = 'index' and i.max_members = 30) = 1,
  'index NEXA 30 exists');
select tests.assert(
  (select count(*) = 15 and abs(sum(weight_bps) - 10000) <= 15 from public.index_memberships where left_at is null),
  '15 index members, weights sum to ~100 %');
select tests.assert(
  (select abs((select sum(q.market_cap_cents) from public.index_memberships m
                 join public.security_quotes q on q.security_id = m.member_security_id) / i.divisor - i.base_value_e4) < 1
     from public.indices i),
  'index divisor reproduces the base level of 1000.0000 points');

select tests.assert(
  (select array_agg(key order by key) from public.ai_investors)
  = array['index_fund', 'market_maker', 'momentum_trader', 'pension_fund', 'retail_herd', 'value_fund'],
  '6 AI investor archetypes');
select tests.assert((select policy_rate_bps from public.central_bank_state) = 300, 'policy rate starts at 300 bps');

select tests.assert(
  (select count(distinct tier) = 5 and count(*) >= 15 and count(distinct company_id) >= 8 from public.job_definitions),
  'job definitions cover all 5 tiers across the AI companies');
select tests.assert(
  (select bool_and(ok) from (
     select (tier, min(min_level)) in (('intern', 2), ('junior', 5), ('senior', 12), ('team_lead', 20), ('c_level', 25)) as ok
       from public.job_definitions group by tier) x),
  'job tiers unlock at levels 2, 5, 12, 20, 25');

select tests.assert((select count(*) from public.achievements) >= 40,
  'at least 40 achievements (' || (select count(*) from public.achievements) || ')');
select tests.assert(
  (select count(*) from public.achievements
    where title in ('All In', 'Wolf der NEXA', 'Totalverlust', 'Diamond Hands', 'Orakel', 'Rentier', 'Glockenschläger', 'Index-Aufsteiger')) = 8,
  'the 8 achievements from the spec are present');
select tests.assert(
  not exists (select 1 from public.achievements where icon_key !~ '^[a-z0-9_]+$')
  and (select count(distinct icon_key) from public.achievements) = (select count(*) from public.achievements),
  'every achievement has its own emoji-free icon_key');
select tests.assert(
  not exists (
    select 1 from public.achievements
     where title || description ~ ('[' || U&'\2600' || '-' || U&'\27BF' || U&'\+01F000' || '-' || U&'\+01FAFF' || ']')),
  'achievement texts contain no emoji');

select tests.assert(
  (select array_agg(price_cents order by price_cents) from public.lifestyle_items)
  = array[2500000, 15000000, 150000000, 2000000000, 10000000000]::bigint[]
  and (select bool_and(upkeep_cents_per_quarter > 0) from public.lifestyle_items)
  and (select reputation_bonus from public.lifestyle_items where key = 'penthouse') = 5,
  '5 lifestyle items with spec prices, upkeep and the penthouse bonus');
select tests.assert(
  (select count(*) from public.random_event_definitions
    where key in ('inheritance', 'tax_audit', 'headhunter', 'golf_tip')) = 4,
  'random events from the spec are defined');
select tests.assert((select count(*) from public.macro_event_definitions) >= 4, 'macro event definitions seeded');
select tests.assert(
  (select count(*) filter (where kind = 'daily') >= 3 and count(*) filter (where kind = 'weekly') >= 1
          and count(*) filter (where kind = 'intro') >= 1 from public.mission_templates)
  and (select bool_and(xp_min >= 200 and xp_max <= 400) from public.mission_templates where kind = 'daily'),
  'mission templates: dailies (200-400 XP), weekly challenge, intro missions');
select tests.assert(
  (select count(*) = 50 from public.levels)
  and (select xp_to_next from public.levels where level = 1) = 100
  and (select xp_to_next from public.levels where level = 10) = 3162
  and (select xp_to_next from public.levels where level = 20) = 8944
  and (select xp_to_next is null from public.levels where level = 50)
  and (select xp_cumulative from public.levels where level = 3) = 383,
  'XP curve: 50 levels, round(100 * n^1.5)');
select tests.assert(
  (select count(*) from public.unlocks) >= 16
  and (select level from public.unlocks where key = 'short_selling') = 8
  and (select level from public.unlocks where key = 'ipo') = 25
  and not exists (select 1 from public.unlocks u where u.intro_mission_key is not null
                   and not exists (select 1 from public.mission_templates m where m.key = u.intro_mission_key and m.kind = 'intro')),
  'unlocks seeded with levels and intro missions');
select tests.assert(
  (select count(*) from public.ledger_accounts
    where kind = 'system' and system_key in ('mint', 'payroll', 'fees', 'taxes', 'market', 'upkeep', 'interest')) = 7,
  'system ledger accounts from ADR-007 exist');
select tests.assert((select count(*) from public.invite_codes where code like 'NEXA-%') >= 2, 'invite codes seeded');
select tests.assert((select count(*) from public.notification_types) >= 20, 'notification types seeded');
select tests.assert((select count(*) from public.game_config) = 0, 'game_config is NOT seeded here (generated from balance.ts)');

-- seed.sql ran twice: nothing duplicated
select tests.assert(
  (select count(*) from public.ledger_transactions where kind = 'opening_balance') = 15
  and (select count(*) from public.securities) = 20
  and (select count(*) from public.cap_table_entries) = 15,
  'seed is idempotent (15 opening balances, 20 securities, 15 cap table rows after two runs)');
select tests.assert((select count(*) from public.ledger_audit()) = 0, 'ledger is consistent after seeding');
