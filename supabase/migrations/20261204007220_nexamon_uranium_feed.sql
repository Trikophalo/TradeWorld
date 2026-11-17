-- =============================================================================
-- NEXA · 7220 · Nexamon: a uranium pull in the feed (ADR-182)
-- =============================================================================
-- feedRarities now holds "uranium" too (Titans Revenge). feed_item_label() named every nexamon_pull a legendary
-- card; it now says "Uranium-Karte" for a uranium pull.
-- Idempotent: runs unchanged as supabase/updates/20261204007220_nexamon_uranium_feed.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
  v_old text := $t$when 'nexamon_pull' then 'legendäre Nexamon-Karte gezogen (Nummer '$t$;
  v_new text := $t$when 'nexamon_pull' then case p_payload ->> 'rarity' when 'uranium' then 'Uranium-Karte'
                                            else 'legendäre Nexamon-Karte' end || ' gezogen (Nummer '$t$;
begin
  if position('Uranium-Karte' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'feed_item_label() has an unexpected shape; name a uranium pull (ADR-182) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
