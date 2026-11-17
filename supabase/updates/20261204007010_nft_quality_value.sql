-- ===== idempotent copy of migrations/20261204007010_nft_quality_value.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 7010 · The collectors pay for quality (ADR-181)
-- =============================================================================
-- The critic score (artworks.quality, 7000) scales the collectors' valuation anchor (mint cost or floor, never the
-- last price, so it does not compound) by nfts.ai.quality.valueMinBps..valueMaxBps (score 50 = x 1.0). This moves
-- every purchase ceiling, offer, auction bid (nft_ai_value_cents) and the trades among collectors (nft_fair_cents).
-- Lowball offers shift with the score (nft_lowball_cents with p_quality). Ports of src/lib/sim/nfts.ts.
-- Copies of 20261204001400 (nft_fair_cents, nft_ai_value_excluding), the anchor changed.
-- Idempotent: runs unchanged as supabase/updates/20261204007010_nft_quality_value.sql.

-- ADR-181 effects need nfts.ai.quality before the new game_config is written (update-to-latest writes it at the end)
update public.game_config
   set value = jsonb_set(value, '{ai,quality}', '{"neutral":50,"valueMinBps":6000,"valueMaxBps":14000,"chanceMinBps":2000,"chanceMaxBps":20000,"noInterestBelow":10,"lowballShiftBps":1500,"mockBelow":35,"praiseFrom":75,"goodFrom":85,"badBelow":45}'::jsonb)
 where key = 'nfts' and value ? 'ai' and not (value -> 'ai' ? 'quality');

-- nftQualityValueBps / the factor of nftQualityChanceBps: min + (max - min) x score / 100, null = neutral
create or replace function public.nft_quality_factor_bps(p_quality integer, p_min text, p_max text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((q ->> p_min)::integer, 10000)
         + (coalesce((q ->> p_max)::integer, 10000) - coalesce((q ->> p_min)::integer, 10000))
           * greatest(0, least(100, coalesce(p_quality, (q ->> 'neutral')::integer, 50))) / 100
    from (select coalesce(public.nfts_cfg() #> '{ai,quality}', '{}'::jsonb) as q) c;
$$;

-- nftQualityChanceBps: a chance scaled by the score, 0 below noInterestBelow
create or replace function public.nft_quality_chance_bps(p_base numeric, p_quality integer)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_quality is not null
                   and p_quality < coalesce((public.nfts_cfg() #>> '{ai,quality,noInterestBelow}')::integer, 0) then 0
              else floor(coalesce(p_base, 0) * public.nft_quality_factor_bps(p_quality, 'chanceMinBps', 'chanceMaxBps') / 10000) end;
$$;

-- the valuation anchor from mint cost (or gallery start price) and floor, scaled by quality
create or replace function public.nft_quality_base_cents(p_artwork uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select floor(greatest(coalesce(a.mint_cents, case when a.origin = 'game' then public.artwork_gallery_start_cents(a.rarity) end, 0),
                        coalesce((public.nfts_cfg() #>> '{ai,floorCents}')::bigint, 100000))::numeric
               * public.nft_quality_factor_bps(a.quality, 'valueMinBps', 'valueMaxBps') / 10000)::bigint
    from public.artworks a where a.id = p_artwork;
$$;

create or replace function public.nft_fair_cents(p_artwork uuid, p_now timestamptz default null)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ai      jsonb := public.nfts_cfg() -> 'ai';
  a       public.artworks;
  v_base  bigint;
  v_likes bigint;
  v_sales bigint := 0;
  v_days  bigint;
begin
  select * into a from public.artworks where id = p_artwork;
  if a.id is null then
    return null;
  end if;
  v_base := public.nft_quality_base_cents(a.id);
  select count(*) into v_likes from public.artwork_likes l where l.artwork_id = a.id;
  if a.creator_id is not null then
    select count(*) into v_sales from public.artwork_sales s join public.artworks x on x.id = s.artwork_id
     where x.creator_id = a.creator_id;
  end if;
  v_days := greatest(0, floor(extract(epoch from (coalesce(p_now, public.game_now()) - a.created_at)) / 86400))::bigint;
  return floor(v_base::numeric * (10000
           + (ai ->> 'likeBps')::bigint * least(v_likes, (ai ->> 'maxLikes')::bigint)
           + (ai ->> 'creatorSaleBps')::bigint * least(v_sales, (ai ->> 'maxCreatorSales')::bigint)
           + (ai ->> 'ageBpsPerDay')::bigint * least(v_days, (ai ->> 'maxAgeDays')::bigint)
           + public.nft_demand_bps(a.id, p_now)) / 10000)::bigint;
end;
$$;

-- The valuation without the demand of one bidder: their own offer must not raise the price they have to beat.
create or replace function public.nft_ai_value_excluding(p_artwork uuid, p_now timestamptz, p_exclude uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ai       jsonb := public.nfts_cfg() -> 'ai';
  a        public.artworks;
  v_anchor bigint;
  v_likes  bigint;
  v_sales  bigint := 0;
  v_days   bigint;
  v_bonus  bigint;
begin
  select * into a from public.artworks where id = p_artwork;
  if a.id is null then
    return null;
  end if;
  -- ADR-181: the last price as it is, mint cost / floor scaled by the critic score
  v_anchor := greatest(coalesce(a.value_cents, 0), public.nft_quality_base_cents(a.id));
  select count(*) into v_likes from public.artwork_likes l where l.artwork_id = a.id;
  if a.creator_id is not null then
    select count(*) into v_sales from public.artwork_sales s join public.artworks x on x.id = s.artwork_id
     where x.creator_id = a.creator_id;
  end if;
  v_days := greatest(0, floor(extract(epoch from (coalesce(p_now, public.game_now()) - a.created_at)) / 86400))::bigint;
  v_bonus := coalesce((ai ->> 'likeBps')::bigint, 400) * least(v_likes, coalesce((ai ->> 'maxLikes')::bigint, 40))
           + coalesce((ai ->> 'creatorSaleBps')::bigint, 300) * least(v_sales, coalesce((ai ->> 'maxCreatorSales')::bigint, 10))
           + coalesce((ai ->> 'ageBpsPerDay')::bigint, 100) * least(v_days, coalesce((ai ->> 'maxAgeDays')::bigint, 30))
           + public.nft_demand_bps(a.id, p_now, p_exclude);
  return floor(v_anchor::numeric * (10000 + v_bonus) / 10000)::bigint;
end;
$$;

-- nftLowballCents with the score: the band shifts by trunc((score - 50) x lowballShiftBps / 50), at most 100 %
create or replace function public.nft_lowball_cents(p_value bigint, p_u double precision, p_quality integer)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg   jsonb := public.nfts_cfg();
  v_min integer := (cfg #>> '{ai,lowballMinBps}')::integer;
  v_max integer := (cfg #>> '{ai,lowballMaxBps}')::integer;
  v_bps integer;
begin
  v_bps := v_min + floor(least(greatest(coalesce(p_u, 0), 0), 0.999999) * (v_max - v_min))::integer;
  if p_quality is not null then
    v_bps := v_bps + (greatest(0, least(100, p_quality)) - 50) * coalesce((cfg #>> '{ai,quality,lowballShiftBps}')::integer, 0) / 50;
  end if;
  v_bps := least(10000, v_bps);
  return greatest((cfg ->> 'minOfferCents')::bigint, (floor(p_value::numeric * v_bps / 10000 / 100) * 100)::bigint);
end;
$$;

revoke all on function public.nft_quality_factor_bps(integer, text, text) from public, anon, authenticated;
revoke all on function public.nft_quality_chance_bps(numeric, integer) from public, anon, authenticated;
revoke all on function public.nft_quality_base_cents(uuid) from public, anon, authenticated;
revoke all on function public.nft_lowball_cents(bigint, double precision, integer) from public, anon, authenticated;
grant execute on function public.nft_quality_factor_bps(integer, text, text) to service_role;
grant execute on function public.nft_quality_chance_bps(numeric, integer) to service_role;
grant execute on function public.nft_quality_base_cents(uuid) to service_role;
grant execute on function public.nft_lowball_cents(bigint, double precision, integer) to service_role;
