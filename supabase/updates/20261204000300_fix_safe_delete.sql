-- ===== idempotent copy of migrations/20261204000300_fix_safe_delete.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0300 · Snapshot cache: DELETE with a WHERE clause (fix for ADR-123)
-- =============================================================================
-- Supabase runs API requests with pg-safeupdate, which rejects DELETE and UPDATE without a WHERE clause. The cache
-- invalidation trigger of the market snapshot deleted with a bare "delete from", so saving a company logo (and every
-- other change that fires the trigger inside an RPC) failed live, while local tests without the extension passed.
-- Idempotent: runs unchanged as supabase/updates/20261204000300_fix_safe_delete.sql.

create or replace function public.market_snapshot_invalidate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.market_snapshot_cache where true;
  return null;
end;
$$;
revoke all on function public.market_snapshot_invalidate() from public, anon, authenticated;
