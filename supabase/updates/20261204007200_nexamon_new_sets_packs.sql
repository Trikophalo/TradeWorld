-- ===== idempotent copy of migrations/20261204007200_nexamon_new_sets_packs.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 7200 · Nexamon: packs of Titans Revenge and Yin Yang (ADR-182)
-- =============================================================================
-- * nexamon_slot_rarity(set, slot, u): the slot table of a set, its entry in setOdds (Yin Yang: every chance from
--   ultra upwards x 0.9, in parts of 36 000) or else odds. Port of nexamonSlotRarity(slot, u, cfg, set).
-- * nexamon_open_pack(): rolls slots 4 and 5 on the set's own table; in an AI pack (no owner) a tier of a rarity in
--   ai.excludedRarities (Titans Revenge's uranium) is skipped, its slots stay the base rarity (iron). Before, the
--   AI guard trigger would have stopped the whole AI pack run.
-- The cards (30 + 110) and the rules (packRules.titans_revenge, setOdds.yin_yang, quickSell.setRarities) come from
-- game_config (`pnpm db:config`); nexamon_sync() mirrors the new sets and seeds the AI stock on its next run.
-- Idempotent: runs unchanged as supabase/updates/20261204007200_nexamon_new_sets_packs.sql.

create or replace function public.nexamon_slot_rarity(p_set text, p_slot integer, p_u double precision)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o      jsonb := coalesce(public.nexamon_cfg() #> array['setOdds', coalesce(p_set, '')], public.nexamon_cfg() -> 'odds');
  t      jsonb;
  v_den  integer := coalesce((o ->> 'denominator')::integer, 3600);
  v_n    integer;
  v_edge integer := 0;
  r      text;
begin
  t := case when p_slot = 5 then o -> 'slot5' when p_slot = 4 then o -> 'slot4' end;
  if t is null then
    return 'common';
  end if;
  v_n := floor(least(greatest(coalesce(p_u, 0), 0), 0.999999999) * v_den)::integer;
  foreach r in array array['legendary', 'prisma', 'ultra', 'rare'] loop
    v_edge := v_edge + coalesce((t ->> r)::integer, 0);
    if v_n < v_edge then
      return r;
    end if;
  end loop;
  return 'common';
end;
$$;
comment on function public.nexamon_slot_rarity(text, integer, double precision) is
  'Internal: the rarity of pack slot p_slot for the roll p_u on the slot table of set p_set (setOdds, else odds; ADR-182).';
revoke all on function public.nexamon_slot_rarity(text, integer, double precision) from public, anon, authenticated;
grant execute on function public.nexamon_slot_rarity(text, integer, double precision) to service_role;

do $do$
declare
  v_def  text := pg_get_functiondef('public.nexamon_open_pack(text, uuid, text, uuid, timestamptz)'::regprocedure);
  v_old1 text := $t$when s >= 4 then public.nexamon_slot_rarity(s, random()) else 'common' end;$t$;
  v_new1 text := $t$when s >= 4 then public.nexamon_slot_rarity(p_set, s, random()) else 'common' end;$t$;
  v_old2 text := $t$      if v_hit then
        for i in 1 .. v_cnt loop$t$;
  v_new2 text := $t$      if v_hit and not (p_owner is null
                        and coalesce(cfg #> '{ai,excludedRarities}', '[]'::jsonb) ? (t.x ->> 'rarity')) then
        for i in 1 .. v_cnt loop$t$;
begin
  if position('nexamon_slot_rarity(p_set' in v_def) = 0 then
    if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then
      raise exception 'nexamon_open_pack() has an unexpected shape; roll the set''s own slot table and skip AI-excluded tiers (ADR-182) by hand';
    end if;
    execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
  end if;
end;
$do$;
