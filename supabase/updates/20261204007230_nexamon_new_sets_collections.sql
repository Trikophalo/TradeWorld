-- ===== idempotent copy of migrations/20261204007230_nexamon_new_sets_collections.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 7230 · Nexamon: collections of the new sets (ADR-182)
-- =============================================================================
-- Titans Revenge has types with only one or two (iron) cards, and its pack costs 100.000 €. A type collection paid
-- rewardPacks x the pack price on its first completion, so one cheap iron card could have paid 300.000 €.
-- nexamon_bonus_recompute():
-- * a type with fewer than bonuses.sets.type.minCards cards in a set is no collection (3; every classic set has at
--   least three cards of each type, so nothing changes there);
-- * a reward pack is worth bonuses.sets.rewardPackCents[set] where set (Titans Revenge: 10.000 €), else the pack
--   price as before.
-- Port of nexamonCollections / nexamonCollectionReward (src/lib/sim/nexamon-bonuses.ts).
-- Idempotent: runs unchanged as supabase/updates/20261204007230_nexamon_new_sets_collections.sql.

do $do$
declare
  v_def  text := pg_get_functiondef('public.nexamon_bonus_recompute(uuid)'::regprocedure);
  v_old1 text := $t$     group by o.set_key, o.type$t$;
  v_new1 text := $t$     group by o.set_key, o.type
    having count(*) >= coalesce((b #>> '{sets,type,minCards}')::integer, 1)$t$;
  v_old2 text := $t$* coalesce((cfg #>> array['sets', r.set_key, 'packPriceCents'])::bigint, 0);$t$;
  v_new2 text := $t$* coalesce((b #>> array['sets', 'rewardPackCents', r.set_key])::bigint,
                         (cfg #>> array['sets', r.set_key, 'packPriceCents'])::bigint, 0);$t$;
begin
  if position('minCards' in v_def) = 0 then
    if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then
      raise exception 'nexamon_bonus_recompute() has an unexpected shape; add type.minCards and rewardPackCents (ADR-182) by hand';
    end if;
    execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
  end if;
end;
$do$;
