-- =============================================================================
-- NEXA · 1700 · Company market segments and insolvency grace period
-- =============================================================================
-- The company simulation (src/lib/sim/quarter.ts) splits every sector into
-- four markets, one per company tier, and replaces "insolvent after two
-- uncovered quarters" by a grace period (docs/DECISIONS.md, ADR-032).
-- The quarterly report stores what the player is shown about both.
-- =============================================================================

create type public.market_segment as enum ('local', 'regional', 'national', 'international');

alter table public.company_quarter_reports
  add column market_segment        public.market_segment,
  add column segment_demand_cents  bigint check (segment_demand_cents >= 0),
  add column uncovered_quarters    smallint not null default 0 check (uncovered_quarters >= 0),
  add column grace_quarters_left   smallint check (grace_quarters_left >= 0);

comment on column public.company_quarter_reports.market_segment is
  'Market the company sold in this quarter; follows from its legal form.';
comment on column public.company_quarter_reports.segment_demand_cents is
  'Total customer spending in that market this quarter (the 100 % of the market-share chart).';
comment on column public.company_quarter_reports.uncovered_quarters is
  'Consecutive quarter closes with negative cash, including this one.';
comment on column public.company_quarter_reports.grace_quarters_left is
  'Closes left before insolvency; null while cash is positive.';

comment on column public.company_state.uncovered_quarters is
  'Consecutive quarter closes with negative cash. Insolvency when it exceeds game_config company.insolvency.graceQuarters.';
comment on column public.company_state.state is
  'Simulation state as JSON, including the standing decisions (unit price, marketing budget, guidance) that apply every quarter until changed.';
