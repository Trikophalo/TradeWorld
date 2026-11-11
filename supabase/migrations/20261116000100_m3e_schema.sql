-- =============================================================================
-- NEXA · M3e · 0100 · Schema: quit notice, skills in postings, company products
--                     (ADR-061..064)
-- =============================================================================
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

alter table public.player_jobs add column if not exists notice_ends_at timestamptz;
comment on column public.player_jobs.notice_ends_at is 'Quit with notice (ADR-063): the job ends at this time (run_due_jobs); wages run until then.';
create index if not exists player_jobs_notice_idx on public.player_jobs (notice_ends_at) where notice_ends_at is not null and status = 'active';

alter table public.job_postings add column if not exists required_skills text[] not null default '{}';
comment on column public.job_postings.required_skills is 'Concrete skills an applicant must have learned (ADR-062, at most 4).';

alter table public.player_companies add column if not exists product_key text;
comment on column public.player_companies.product_key is 'Product of the company (startups.products[sector]); defines the skills of the growth stages (ADR-062).';
-- existing companies: the first product of their sector
update public.player_companies pc
   set product_key = public.config_jsonb('startups', array['products', c.sector_key]) -> 0 ->> 'key'
  from public.companies c
 where c.id = pc.company_id and pc.product_key is null
   and public.config_jsonb('startups', array['products', c.sector_key]) -> 0 ->> 'key' is not null;
grant select (product_key) on public.player_companies to authenticated;
