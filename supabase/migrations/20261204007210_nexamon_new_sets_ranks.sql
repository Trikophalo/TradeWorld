-- =============================================================================
-- NEXA · 7210 · Nexamon: rarities of the new sets count by rank (ADR-182)
-- =============================================================================
-- Titans Revenge brings its own rarities (iron, titanium, diamond, uranium). Where the code named the classic ones,
-- it now asks nexamon_rarity_rank() (game_config.nexamon_rarities.rank):
-- * the pack missions in buy_nexamon_pack(), open_nexamon_sealed_pack() and nexamon_battle_pull(): "rare or better"
--   is rank >= 1 (iron, rank 0, is not), "ultra or better" rank >= 2 (titanium, diamond, uranium, One of One too);
-- * get_nexamon_market(): the rarity filter takes every known rarity (rank >= 0), not only the classic five.
-- Idempotent: runs unchanged as supabase/updates/20261204007210_nexamon_new_sets_ranks.sql.

do $do$
declare
  v_fn   text;
  v_def  text;
  v_rare text := $t$if r.rarity <> 'common' then$t$;
  v_ult1 text := $t$if r.rarity in ('ultra', 'prisma', 'legendary') then$t$;
  v_ult2 text := $t$if r.rarity in ('ultra', 'prisma', 'legendary', 'one_of_one') then$t$;
begin
  foreach v_fn in array array[
    'public.buy_nexamon_pack(uuid, text)', 'public.open_nexamon_sealed_pack(uuid, uuid)',
    'public.nexamon_battle_pull(public.nexamon_battles, uuid, timestamptz)'
  ] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    if position('nexamon_rarity_rank(r.rarity) >= 2' in v_def) = 0 then
      if position(v_rare in v_def) = 0 or (position(v_ult1 in v_def) = 0 and position(v_ult2 in v_def) = 0) then
        raise exception '% has an unexpected shape; count the pack missions by rarity rank (ADR-182) by hand', v_fn;
      end if;
      execute replace(replace(replace(v_def, v_ult2, 'if public.nexamon_rarity_rank(r.rarity) >= 2 then'),
                              v_ult1, 'if public.nexamon_rarity_rank(r.rarity) >= 2 then'),
                      v_rare, 'if public.nexamon_rarity_rank(r.rarity) >= 1 then');
    end if;
  end loop;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef(
    'public.get_nexamon_market(text, text, text, integer, text, text, boolean, boolean)'::regprocedure);
  v_old text := $t$p_rarity not in ('common', 'rare', 'ultra', 'prisma', 'legendary')$t$;
  v_new text := $t$public.nexamon_rarity_rank(p_rarity) < 0$t$;
begin
  if position(v_new in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'get_nexamon_market() has an unexpected shape; accept every known rarity (ADR-182) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
