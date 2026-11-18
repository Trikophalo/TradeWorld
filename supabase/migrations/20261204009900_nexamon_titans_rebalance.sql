-- =============================================================================
-- NEXA · 9900 · Nexamon: Titans Revenge diamond x 1.3, uranium x 0.918828, the pack's value unchanged (ADR-207)
-- =============================================================================
-- The start prices come from game_config.nexamon_cards (TITAN_REBALANCE_FACTOR in src/config/nexamon/titans-draft.ts).
-- nexamon_sync() moves the start price of every card to the new catalogue, but the market value only of cards that
-- never moved. So an existing database gets one relative push here, like the Prismatic Peak scaling (migration 5500):
-- * nexamon_scale_card_values(set, rarity, num, den): start price, market value, the day's reference and the value
--   history (nexamon_value_points) of every card of that set and rarity x num / den (half-even), and the AI sellers'
--   asking prices after it (nexamon_ai_ask_cents of the copy's value). Copies and slabs have no value of their own
--   (card value x condition or grade factor), they follow at once. Players' own listings keep the price their owner
--   chose. Past sales (nexamon_sales) stay as they were.
-- * Titans Revenge diamond x 13/10, uranium x 918828/1000000: the market drift of every card stays (relative), the
--   ratios inside a rarity too. At catalogue values the pack keeps its expected value (89.901 EUR, +0,4 ct).
-- * Then the catalogue hash is cleared: the next nexamon_sync() puts the start prices (and the values of cards that
--   never moved) exactly on the new catalogue, whichever ran first. Values of moved cards only change here.
-- * Runs once (public.data_migrations 'nexamon_titans_rebalance_207'), however often the update script is executed.
-- Idempotent: runs unchanged as supabase/updates/20261204009900_nexamon_titans_rebalance.sql.

create or replace function public.nexamon_scale_card_values(p_set text, p_rarity text, p_num bigint, p_den bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_num is null or p_den is null or p_num <= 0 or p_den <= 0 then
    raise exception 'nexamon_scale_card_values: factor must be positive' using errcode = '22023';
  end if;
  update public.nexamon_cards k
     set start_e4   = greatest(1, public.div_round_half_even(k.start_e4::numeric * p_num, p_den)),
         value_e4   = greatest(1, public.div_round_half_even(k.value_e4::numeric * p_num, p_den)),
         day_ref_e4 = greatest(1, public.div_round_half_even(k.day_ref_e4::numeric * p_num, p_den)),
         updated_at = now()
   where k.set_key = p_set and k.rarity = p_rarity;
  get diagnostics v_n = row_count;

  update public.nexamon_value_points p
     set value_e4 = greatest(1, public.div_round_half_even(p.value_e4::numeric * p_num, p_den))
    from public.nexamon_cards k
   where k.card_key = p.card_key and k.set_key = p_set and k.rarity = p_rarity;

  update public.nexamon_listings l
     set price_cents = public.nexamon_ai_ask_cents(
           public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade::double precision, k.card_key))
    from public.nexamon_copies c, public.nexamon_cards k
   where l.seller_ai is not null and c.id = l.copy_id and k.card_key = l.card_key
     and k.set_key = p_set and k.rarity = p_rarity;
  return v_n;
end;
$$;
revoke all on function public.nexamon_scale_card_values(text, text, bigint, bigint) from public, anon, authenticated;
comment on function public.nexamon_scale_card_values(text, text, bigint, bigint) is
  'Rebalance (ADR-207): start price, market value, day reference and value history of every card of a set and rarity '
  'x num / den (half-even); AI listings re-priced, player listings untouched. Returns the cards scaled. Internal.';

do $$
begin
  if exists (select 1 from public.data_migrations where key = 'nexamon_titans_rebalance_207') then
    return;
  end if;
  perform public.nexamon_scale_card_values('titans_revenge', 'diamond', 13, 10);
  perform public.nexamon_scale_card_values('titans_revenge', 'uranium', 918828, 1000000);
  update public.nexamon_meta set catalogue_hash = null;
  insert into public.data_migrations (key) values ('nexamon_titans_rebalance_207') on conflict do nothing;
end
$$;
