-- ===== idempotent copy of migrations/20261204005710_news_topics_hooks.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5710 · NEXA Nachrichten: the topics join the show (ADR-169)
-- =============================================================================
-- * news_show_build() asks news_show_topics() for its segments right before the running order is made; they carry
--   an "ord" between the old segments and count towards maxSegments.
-- * While topics are on (newsShow.topics.count > 0), the feed kinds that have a topic of their own are no longer
--   told as plain gossip, so nothing is told twice in two wordings.
-- * news_show_start(): the news feed files the kinds "tax" and "corp" under companies.
-- Patches of the functions as they are now; a missing anchor raises instead of silently doing nothing.
-- Idempotent: runs unchanged as supabase/updates/20261204005710_news_topics_hooks.sql.

do $do$
declare
  v_def   text := pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure);
  v_fill  text := $t$  if jsonb_array_length(v_segs) = 0 and v_tip is null then$t$;
  v_where text := $t$                 where f.created_at >= p_now - v_win$t$;
begin
  if position('news_show_topics' in v_def) = 0 then
    if position(v_fill in v_def) = 0 or position(v_where in v_def) = 0 then
      raise exception 'news_show_build() has an unexpected shape; add the call of news_show_topics() (ADR-169) by hand';
    end if;
    v_def := replace(v_def, v_fill,
      $t$  -- 10. more topics (ADR-169): collectibles, Finanzamt, listed companies, persons, odd bits
  v_segs := v_segs || public.news_show_topics(p_now, v_seen, v_skip_p, v_segs);

$t$ || v_fill);
    v_def := replace(v_def, v_where, v_where || $t$
                   and (coalesce((cfg #>> '{topics,count}')::integer, 0) <= 0
                        or f.kind not in ('tax_penalty', 'tax_audit', 'greedy_founder', 'mass_quit', 'record_dividend',
                                          'board_revolt', 'promoted', 'home_bought', 'car_bought', 'nexamon_pull'))$t$);
    execute v_def;
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_start(bigint, timestamptz)'::regprocedure);
  v_old text := $t$when seg ->> 'kind' in ('scandal', 'hype', 'stock') then 'company'$t$;
  v_new text := $t$when seg ->> 'kind' in ('scandal', 'hype', 'stock', 'tax', 'corp') then 'company'$t$;
begin
  if position(v_new in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'news_show_start() has an unexpected shape; file the kinds "tax" and "corp" (ADR-169) under companies by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
