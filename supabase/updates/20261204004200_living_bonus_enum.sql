-- ===== idempotent copy of migrations/20261204004200_living_bonus_enum.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 4200 · Enum values for the living bonus (ADR-161)
-- =============================================================================
-- A new enum value cannot be used in the transaction that adds it (SQLSTATE 55P04), so the values get their own file
-- before 20261204004300_living_bonus.sql, which uses them only inside PL/pgSQL bodies.
--   ledger_tx_kind 'living_bonus'  households -> player cash, every hour a player lives in a home
--   xp_source      'home_living'   XP of the living bonus
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

alter type public.ledger_tx_kind add value if not exists 'living_bonus';
alter type public.xp_source add value if not exists 'home_living';
