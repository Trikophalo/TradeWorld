-- =============================================================================
-- NEXA · 6410 · More business moves, some only from a tier on or for listed companies (ADR-173)
-- =============================================================================
-- The new moves themselves are config (game_config.companyMoves.moves, src/config/company-moves.ts). Two new
-- optional fields of a move are honoured here:
--   minTier     the move is offered from this company tier on (garage < small_business < gmbh < ag)
--   listedOnly  the move is offered to listed companies only (listed_is())
-- company_moves_state() leaves out what the company may not start yet, so start_company_move() answers move_unknown
-- for it as for any move of another product. Patch of the function as it is now (after 5300); a missing anchor
-- raises instead of silently doing nothing.
-- Idempotent: runs unchanged as supabase/updates/20261204006410_more_company_moves.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.company_moves_state(uuid)'::regprocedure);
  v_old text := $t$         where o.mv ->> 'product' in ('*', coalesce(pc.product_key, ''))) x), '[]'::jsonb),$t$;
  v_new text := $t$         where o.mv ->> 'product' in ('*', coalesce(pc.product_key, ''))
           -- ADR-173: from a tier on, or for listed companies only
           and (o.mv ->> 'minTier' is null
                or coalesce(array_position(array['garage', 'small_business', 'gmbh', 'ag'], v_tier), 4)
                   >= coalesce(array_position(array['garage', 'small_business', 'gmbh', 'ag'], o.mv ->> 'minTier'), 1))
           and (not coalesce((o.mv ->> 'listedOnly')::boolean, false) or public.listed_is(p_company))) x), '[]'::jsonb),$t$;
begin
  if position('listedOnly' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'company_moves_state(): anchor for minTier/listedOnly (ADR-173) not found';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
