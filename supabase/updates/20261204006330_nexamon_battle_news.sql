-- ===== idempotent copy of migrations/20261204006330_nexamon_battle_news.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 6330 · Nexamon Pack Battles in the feed and as gossip for NEXA Nachrichten (ADR-172)
-- =============================================================================
-- * feed_item_label(): the kinds nexamon_battle_won (every win, for the friends) and nexamon_battle_big (a win of at
--   least battles.gossipMinCents).
-- * news_show_build(): nexamon_battle_big joins the gossip sources, next to nexamon_pull.
-- Replace-patches anchored on the nexamon_pull kind; a clear error if the anchor is missing.
-- Idempotent: runs unchanged as supabase/updates/20261204006330_nexamon_battle_news.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
  v_old text := $t$    when 'nexamon_pull' then$t$;
  v_new text := $t$    when 'nexamon_battle_won' then 'Pack Battle gegen ' || coalesce(p_payload ->> 'other', '?') || ' gewonnen'
    when 'nexamon_battle_big' then 'Großer Sieg im Pack Battle gegen ' || coalesce(p_payload ->> 'other', '?') || ': '
      || public.format_eur(coalesce((p_payload ->> 'total_cents')::bigint, 0)) || ' an Karten abgeräumt'
    when 'nexamon_pull' then$t$;
begin
  if position('nexamon_battle_big' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'feed_item_label() has an unexpected shape; add the feed kinds nexamon_battle_won/_big (ADR-172) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure);
  v_old text := $t$'nexamon_pull',$t$;
  v_new text := $t$'nexamon_pull', 'nexamon_battle_big',$t$;
begin
  if position('nexamon_battle_big' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'news_show_build() has an unexpected shape; add the feed kind nexamon_battle_big (ADR-172) to the gossip source by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
