-- ===== idempotent copy of migrations/20261204003900_rentals_enum.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 3900 · Enum values for renting out places in the home (ADR-158)
-- =============================================================================
-- A new enum value cannot be used in the transaction that adds it (SQLSTATE 55P04), so the values get their own file
-- before 20261204003950_rentals.sql, which uses them only inside PL/pgSQL bodies.
--   ledger_tx_kind 'rent'       tenant (player cash or the households) -> owner's cash
--   xp_source      'home_rent'  XP of a player tenant per paid hour (Wohnwert)
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

alter type public.ledger_tx_kind add value if not exists 'rent';
alter type public.xp_source add value if not exists 'home_rent';
