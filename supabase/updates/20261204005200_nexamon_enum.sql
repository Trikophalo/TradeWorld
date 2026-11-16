-- ===== idempotent copy of migrations/20261204005200_nexamon_enum.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5200 · Enum values for the Nexamon collectible cards (ADR-165)
-- =============================================================================
-- A new enum value cannot be used in the transaction that adds it (SQLSTATE 55P04), so the values get their own file
-- before 20261204005210_nexamon.sql, which uses them only inside PL/pgSQL bodies.
--   ledger_tx_kind 'nexamon_pack'     player cash -> households (a booster pack)
--   ledger_tx_kind 'nexamon_sale'     buyer (player cash or the households) -> seller's cash, fee -> households
--   ledger_tx_kind 'nexamon_grading'  player cash -> households (ASP's fee)
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

alter type public.ledger_tx_kind add value if not exists 'nexamon_pack';
alter type public.ledger_tx_kind add value if not exists 'nexamon_sale';
alter type public.ledger_tx_kind add value if not exists 'nexamon_grading';
