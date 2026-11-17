-- ===== idempotent copy of migrations/20261204006850_news_used_keys_distinct.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- news_show_after_start(): mark every subject key of the show as used once. The old statement selected
-- `distinct ukey, clock_timestamp()`, and clock_timestamp() differs per row, so two segments with the same subject
-- key reached ON CONFLICT twice in one command ("cannot affect row a second time"). Idempotent replace-patch.
do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_after_start(bigint, timestamptz)'::regprocedure);
  v_old text := $t$select distinct x -> 'subject' ->> 'ukey', clock_timestamp()
    from jsonb_array_elements(s.segments) x where x -> 'subject' ->> 'ukey' is not null$t$;
  v_new text := $t$select k.ukey, clock_timestamp()
    from (select distinct x -> 'subject' ->> 'ukey' as ukey
            from jsonb_array_elements(s.segments) x where x -> 'subject' ->> 'ukey' is not null) k$t$;
begin
  if position(v_new in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'news_show_after_start() has an unexpected shape; dedupe the used subject keys by hand';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$do$;
