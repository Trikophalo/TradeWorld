-- ===== idempotent copy of migrations/20261204007350_company_growth_path.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 7350 · Wachstum & Ausbau as one path (ADR-191)
--
-- The growth stages of the product (ADR-062, derived from the team's skills) and the endless expansion levels
-- (ADR-083, player_companies.expansion_level) are shown as one continuous path. Both keep their rules and rewards.
--
-- Collision fixed here: places of a player company are `maxEmployees(tier) + employeesPerLevel × expansion_level`
-- (company_max_employees). upgrade_company (legal form) and the IPO completion (ipo_escrow) overwrite the stored
-- copy companies.max_employees with the bare tier value, so after a stage change the bought expansion places vanish
-- from everything that reads the column (company profile, public views, the "hire" missions), while hiring itself
-- still counted them: players saw their expansion "reset" and missions blocked. Now the column is derived: a trigger
-- recomputes it whenever the tier or the level changes and whenever anything writes it. One server function returns
-- the whole path (stage, level, step, next) for the page and the tests.
-- Idempotent: create or replace, drop trigger if exists.
-- =============================================================================

-- The stored places always equal the rule (tier + expansion), whoever writes the row.
create or replace function public.company_seats_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
begin
  select public.company_max_employees(new.id) into v_max;
  if v_max is not null then
    new.max_employees := v_max;
  end if;
  return new;
end;
$$;
comment on function public.company_seats_guard() is
  'Trigger (ADR-191): companies.max_employees of a player company is derived from tier and expansion level.';

drop trigger if exists company_seats_guard on public.companies;
create trigger company_seats_guard
  before update of max_employees on public.companies
  for each row execute function public.company_seats_guard();

create or replace function public.company_seats_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tier is distinct from old.tier or new.expansion_level is distinct from old.expansion_level then
    update public.companies set max_employees = public.company_max_employees(new.company_id) where id = new.company_id;
  end if;
  return new;
end;
$$;
comment on function public.company_seats_sync() is
  'Trigger (ADR-191): a new legal form or expansion level updates the places of the company.';

drop trigger if exists company_seats_sync on public.player_companies;
create trigger company_seats_sync
  after update of tier, expansion_level on public.player_companies
  for each row execute function public.company_seats_sync();

-- Repair the companies that already lost their expansion places.
update public.companies c
   set max_employees = public.company_max_employees(c.id)
  from public.player_companies pc
 where pc.company_id = c.id
   and c.max_employees is distinct from public.company_max_employees(c.id);

-- The whole path in one place: growth stages first, then the endless levels (src/features/company/progress.ts).
create or replace function public.company_growth_path(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'stage', s.stage,
           'stages', s.total,
           'expansion_level', pc.expansion_level,
           'step', s.stage + pc.expansion_level,
           'next', case when s.stage < s.total then jsonb_build_object('kind', 'stage', 'n', s.stage + 1)
                        else jsonb_build_object('kind', 'level', 'n', pc.expansion_level + 1) end,
           'can_expand', public.company_can_expand(pc.tier),
           'next_cost_cents', case when public.company_can_expand(pc.tier)
                                   then public.company_expansion_cost_cents(pc.expansion_level) end,
           'max_employees', public.company_max_employees(pc.company_id))
    from public.player_companies pc
    cross join lateral (
      select public.company_stage(pc.company_id) as stage,
             jsonb_array_length(coalesce(public.company_product(pc.company_id) -> 'stages', '[]'::jsonb)) as total) s
   where pc.company_id = p_company;
$$;
comment on function public.company_growth_path(uuid) is
  'Wachstum & Ausbau as one path (ADR-191): stage, stages, expansion level, step = stage + level, next, next cost, places.';

do $$
begin
  revoke all on function public.company_seats_guard() from public, anon, authenticated;
  revoke all on function public.company_seats_sync() from public, anon, authenticated;
  revoke all on function public.company_growth_path(uuid) from public, anon, authenticated;
  grant execute on function public.company_growth_path(uuid) to service_role;
end;
$$;
