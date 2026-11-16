-- ===== idempotent copy of migrations/20261204005500_nexamon_peak_prices.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5500 · Nexamon: Prismatic Peak costs 10.000 €, its cards are worth 1.5x (ADR-165)
-- =============================================================================
-- The pack price and the start prices come from game_config (nexamon, nexamon_cards). nexamon_sync() moves the
-- start price of every card to the new catalogue, but the market value only of cards that never moved. So an
-- existing database gets one push here: start price, market value, the day's reference and the value history of
-- every Prismatic Peak card times 1.5, and the AI sellers' asking prices after it. Players' own listings keep the
-- price their owner chose. Runs once (nexamon_meta.peak_scaled_at); on a new database it only sets the mark.

alter table public.nexamon_meta add column if not exists peak_scaled_at timestamptz;
comment on column public.nexamon_meta.peak_scaled_at is
  'When the Prismatic Peak values were scaled by 1.5 for the 10.000 € pack (migration 5500); set once.';

do $$
begin
  if exists (select 1 from public.nexamon_meta m where m.peak_scaled_at is not null) then
    return;
  end if;

  update public.nexamon_cards k
     set start_e4   = public.div_round_half_even(k.start_e4::numeric * 3, 2),
         value_e4   = public.div_round_half_even(k.value_e4::numeric * 3, 2),
         day_ref_e4 = public.div_round_half_even(k.day_ref_e4::numeric * 3, 2),
         updated_at = now()
   where k.set_key = 'prismatic_peak';

  update public.nexamon_value_points p
     set value_e4 = public.div_round_half_even(p.value_e4::numeric * 3, 2)
    from public.nexamon_cards k
   where k.card_key = p.card_key and k.set_key = 'prismatic_peak';

  update public.nexamon_listings l
     set price_cents = public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade))
    from public.nexamon_copies c, public.nexamon_cards k
   where l.seller_ai is not null and c.id = l.copy_id and k.card_key = l.card_key and k.set_key = 'prismatic_peak';

  -- The next nexamon_sync() reads the catalogue again: cards that never moved land exactly on their new start price.
  insert into public.nexamon_meta (id, catalogue_hash, synced_at, peak_scaled_at)
  values (true, null, null, now())
  on conflict (id) do update set catalogue_hash = null, peak_scaled_at = excluded.peak_scaled_at;
end
$$;
