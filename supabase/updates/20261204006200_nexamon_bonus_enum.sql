-- ===== idempotent copy of migrations/20261204006200_nexamon_bonus_enum.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 6200 · Enum values for the Nexamon card bonuses (ADR-171)
-- =============================================================================
-- A new enum value cannot be used in the transaction that adds it (SQLSTATE 55P04), so the values get their own file
-- before 20261204006210_nexamon_card_bonuses.sql, which uses them only inside PL/pgSQL bodies.
--   ledger_tx_kind 'nexamon_set_reward'  households -> player cash (first completion of a Nexamon collection)
--   xp_source      'nexamon_set'         XP of the first completion of a Nexamon collection
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

alter type public.ledger_tx_kind add value if not exists 'nexamon_set_reward';
alter type public.xp_source add value if not exists 'nexamon_set';
