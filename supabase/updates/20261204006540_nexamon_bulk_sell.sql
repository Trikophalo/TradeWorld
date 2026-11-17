-- ===== idempotent copy of migrations/20261204006540_nexamon_bulk_sell.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 6540 · Nexamon: selling bulk to the game (ADR-174)
-- =============================================================================
-- * Bulk = raw copies of the bulk rarities of their set (quickSell.setRarities[set], else quickSell.rarities:
--   common and rare). The game buys them at once for their current value minus quickSell.bps' fee (35 %, the rule
--   since ADR-174; it was 50 %), paid by the households through the ledger. Every copy sold this way lowers its
--   card's value by quickSell.dropBps like before (a small push down, never counted as a trade).
-- * bulk_sell_nexamon(p_request_id, p_copy_ids): the collection's bulk mode; up to quickSell.maxPerCall (500)
--   copies, rate-limited (quickSell.callsPerMinute), idempotent; the same rules as sell_nexamon_to_ai(), which now
--   also reads the per-set bulk rarities.
-- Idempotent: runs unchanged as supabase/updates/20261204006540_nexamon_bulk_sell.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.sell_nexamon_to_ai(uuid, uuid[])'::regprocedure);
  v_old text := $t$not coalesce(q -> 'rarities', '[]'::jsonb) ? k.rarity$t$;
  v_new text := $t$not coalesce(q #> array['setRarities', k.set_key], q -> 'rarities', '[]'::jsonb) ? k.rarity$t$;
begin
  if position('setRarities' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'sell_nexamon_to_ai() has an unexpected shape; read quickSell.setRarities (ADR-174) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

create or replace function public.bulk_sell_nexamon(p_request_id uuid, p_copy_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'bulk_sell_nexamon');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'nexamon_bulk',
                               coalesce((public.nexamon_cfg() #>> '{quickSell,callsPerMinute}')::integer, 10), 60) then
    perform public.api_error('rate_limited');
  end if;
  return public.request_complete(v_player, p_request_id,
    public.sell_nexamon_to_ai(md5(p_request_id::text || ':bulk')::uuid, p_copy_ids));
end;
$$;
comment on function public.bulk_sell_nexamon(uuid, uuid[]) is
  'RPC: sells raw bulk copies to the game at once for their value minus the bulk fee (ADR-174) -> sold, count, '
  'total_cents; errors as sell_nexamon_to_ai and rate_limited.';

do $do$
begin
  revoke all on function public.bulk_sell_nexamon(uuid, uuid[]) from public, anon;
  grant execute on function public.bulk_sell_nexamon(uuid, uuid[]) to authenticated;
end;
$do$;

-- ---------------------------------------------------------------------------
-- A 10 is worth 2.5x to 4x, a 9.5 1.8x to 2.6x, by the card's popularity (nexamonGradeFactorBps)
-- ---------------------------------------------------------------------------
-- grading.tenFactorRange / nineHalfFactorRange: low end for popularity 0, high end for 10 000, linear, rounded down.
-- Every function that values a copy with its card at hand (nexamon_copy_value_cents(..., card), and the sale's
-- factor through nexamon_copy_factor_bps(condition, grade, card)) uses it; grading.valueBps stays the fallback.
create or replace function public.nexamon_grade_factor_bps(p_grade double precision, p_card text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g       jsonb := public.nexamon_cfg() -> 'grading';
  v_idx   integer := public.nexamon_grade_index(p_grade);
  v_num   double precision := coalesce((g #>> array['grades', v_idx::text])::double precision, 0);
  v_range jsonb;
  v_pop   integer;
begin
  v_range := case when v_num = 10 then g -> 'tenFactorRange' when v_num = 9.5 then g -> 'nineHalfFactorRange' end;
  if v_range is null or p_card is null then
    return coalesce((g #>> array['valueBps', v_idx::text])::integer, 10000);
  end if;
  select public.nexamon_popularity_bps(k.rarity, k.population) into v_pop from public.nexamon_cards k where k.card_key = p_card;
  if v_pop is null then
    return coalesce((g #>> array['valueBps', v_idx::text])::integer, 10000);
  end if;
  return (v_range ->> 0)::integer
         + floor(((v_range ->> 1)::bigint - (v_range ->> 0)::bigint) * least(10000, greatest(0, v_pop)) / 10000.0)::integer;
end;
$$;

create or replace function public.nexamon_copy_factor_bps(p_condition text, p_grade double precision, p_card text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_grade >= 10.75 and p_card is not null then public.nexamon_black_label_bps(p_card)
              when p_grade is not null and p_grade < 10.75 then public.nexamon_grade_factor_bps(p_grade, p_card)
              else public.nexamon_copy_factor_bps(p_condition, p_grade) end;
$$;

create or replace function public.nexamon_copy_value_cents(p_value_e4 bigint, p_condition text, p_grade double precision, p_card text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_grade >= 10.75 and p_card is not null
              then public.div_round_half_even(p_value_e4::numeric * public.nexamon_black_label_bps(p_card), 1000000)
              when p_grade is not null and p_card is not null
              then public.div_round_half_even(p_value_e4::numeric * public.nexamon_grade_factor_bps(p_grade, p_card), 1000000)
              else public.nexamon_copy_value_cents(p_value_e4, p_condition, p_grade) end;
$$;

-- the sale's factor (price per card) with the card at hand
do $do$
declare
  r     record;
  v_def text;
  v_new text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosrc like '%nexamon_copy_factor_bps(c.condition, c.grade)%'
              and p.proname <> 'nexamon_copy_factor_bps' loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, 'nexamon_copy_factor_bps(c.condition, c.grade)', 'nexamon_copy_factor_bps(c.condition, c.grade, c.card_key)');
    execute v_new;
  end loop;
  revoke all on function public.nexamon_grade_factor_bps(double precision, text) from public, anon, authenticated;
  revoke all on function public.nexamon_copy_factor_bps(text, double precision, text) from public, anon, authenticated;
end;
$do$;
