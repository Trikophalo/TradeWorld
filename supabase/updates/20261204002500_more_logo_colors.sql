-- ===== idempotent copy of migrations/20261204002500_more_logo_colors.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 2500 · Logos and banners with up to 16 colours like NFTs
-- =============================================================================
-- startups.logo.maxColors and startups.banner.maxColors go from 6 to 16. Grid characters are 0-9 then a-f (as for
-- artworks), so the validators build their character class from that alphabet instead of "0-(n-1)".
-- Idempotent: runs unchanged as supabase/updates/20261204002500_more_logo_colors.sql.
do $do$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.logo_valid(jsonb)'::regprocedure);
  if position($t$'^[.0-' || (v_n - 1) || ']{'$t$ in v_def) > 0 then
    execute replace(v_def, $t$'^[.0-' || (v_n - 1) || ']{'$t$, $t$'^[.' || substr('0123456789abcdef', 1, v_n) || ']{'$t$);
  end if;
  v_def := pg_get_functiondef('public.banner_valid(jsonb)'::regprocedure);
  if position($t$'^[.0-' || (v_n - 1) || ']{'$t$ in v_def) > 0 then
    execute replace(v_def, $t$'^[.0-' || (v_n - 1) || ']{'$t$, $t$'^[.' || substr('0123456789abcdef', 1, v_n) || ']{'$t$);
  end if;
end;
$do$;
