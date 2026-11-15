-- ===== idempotent copy of migrations/20261204004100_daily_mint_cost.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 4100 · The NFT mint price starts again at the base every real day
-- =============================================================================
-- The price of the next NFT counted every NFT a player ever minted (base x factor ^ n). Now only the ones minted
-- today (Berlin day): the first NFT of every day costs artworks.createBaseCostCents (15.000 €) again.
-- Every function that counted "artworks created by the player" for the price is patched to count today's only.
-- Idempotent: runs unchanged as supabase/updates/20261204004100_daily_mint_cost.sql.

create or replace function public.player_artworks_minted_today(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.artworks a
   where a.creator_id = p_player
     and a.created_at >= ((public.game_now() at time zone 'Europe/Berlin')::date)::timestamp at time zone 'Europe/Berlin';
$$;
revoke all on function public.player_artworks_minted_today(uuid) from public, anon, authenticated;
grant execute on function public.player_artworks_minted_today(uuid) to service_role;
comment on function public.player_artworks_minted_today(uuid) is
  'Internal: NFTs a player minted today (Berlin day); the mint price grows with them and resets at midnight.';

do $do$
declare
  r     record;
  v_def text;
  v_old text := $t$select count(*) into v_painted from public.artworks a where a.creator_id = v_player;$t$;
  v_new text := $t$v_painted := public.player_artworks_minted_today(v_player);$t$;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    v_def := pg_get_functiondef(r.oid);
    if position(v_old in v_def) > 0 then
      execute replace(v_def, v_old, v_new);
    end if;
  end loop;
end;
$do$;
