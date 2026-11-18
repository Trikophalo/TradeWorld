-- ===== idempotent copy of migrations/20261204010410_macro_tax_unplaced.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 10410 · Tax rate of a company without a headquarters (ADR-209 with ADR-208)
-- =============================================================================
-- With the world map present, world_tax_rate_bps() is null for a company that has not placed its headquarters yet.
-- macro_tax_rate_bps() (latest full definition from 10100) then fell to the minimum rate instead of the listed rate;
-- it now uses the listed rate whenever the world map has no rate for the company.
-- Idempotent: runs unchanged as supabase/updates/20261204010410_macro_tax_unplaced.sql.

-- The base rate: the world map's blended country rate when present (ADR-208), else the listed rate; research on top
create or replace function public.macro_tax_rate_bps(p_company uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_world integer;
begin
  if to_regprocedure('public.world_tax_rate_bps(uuid)') is not null then
    v_world := public.world_tax_rate_bps(p_company);
    if v_world is not null then
      return greatest(public.cfg_num(public.listed_cfg(), '{taxes,minRateBps}', 800),
                      v_world + public.cfg_num(public.listed_effects(p_company), '{taxRateBps}', 0))::integer;
    end if;
  end if;
  return public.listed_tax_rate_bps(p_company);
end;
$$;
revoke all on function public.macro_tax_rate_bps(uuid) from public, anon, authenticated;
