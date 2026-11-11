-- ===== idempotent copy of migrations/20261110001700_company_market_segments.sql =====
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'market_segment') then
    create type public.market_segment as enum ('local', 'regional', 'national', 'international');
  end if;
end $$;

alter table public.company_quarter_reports
  add column if not exists market_segment       public.market_segment,
  add column if not exists segment_demand_cents bigint check (segment_demand_cents >= 0),
  add column if not exists uncovered_quarters   smallint not null default 0 check (uncovered_quarters >= 0),
  add column if not exists grace_quarters_left  smallint check (grace_quarters_left >= 0);

comment on column public.company_quarter_reports.market_segment is
  'Market the company sold in this quarter; follows from its legal form.';
comment on column public.company_quarter_reports.segment_demand_cents is
  'Total customer spending in that market this quarter (the 100 % of the market-share chart).';
comment on column public.company_quarter_reports.uncovered_quarters is
  'Consecutive quarter closes with negative cash, including this one.';
comment on column public.company_quarter_reports.grace_quarters_left is
  'Closes left before insolvency; null while cash is positive.';
