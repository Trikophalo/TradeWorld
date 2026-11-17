-- ===== idempotent copy of migrations/20261204007030_nft_quality_json.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 7030 · The critics' verdict in the NFT JSON (ADR-181)
-- =============================================================================
-- artwork_json gets 'quality': {score, best, worst, copy} (null while unrated). The market shows the score as a
-- small badge, the owner sees the verdict with the strongest and the weakest aspect. Sub-scores stay internal.
-- Idempotent: runs unchanged as supabase/updates/20261204007030_nft_quality_json.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.artwork_json(uuid, uuid)'::regprocedure);
  v_a   text := $t$    'ai_owner', a.ai_owner,
$t$;
begin
  if position('''quality''' in v_def) > 0 then
    return;
  end if;
  if position(v_a in v_def) = 0 then
    raise exception 'artwork_json() has an unexpected shape; add the critic score (ADR-181) by hand';
  end if;
  execute replace(v_def, v_a, v_a || $t$    'quality', case when a.quality is null then null else jsonb_build_object(
      'score', a.quality, 'best', a.quality_detail ->> 'best', 'worst', a.quality_detail ->> 'worst',
      'copy', a.quality_detail ->> 'copy') end,
$t$);
end;
$do$;
