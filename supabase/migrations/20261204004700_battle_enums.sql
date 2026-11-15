-- =============================================================================
-- NEXA · 4700 · Enum values for the news battles (ADR-160)
-- =============================================================================
-- A new enum value cannot be used in the transaction that adds it (SQLSTATE 55P04). The values live in their own
-- migration file; 20261204004720_news_battles.sql uses them only inside PL/pgSQL bodies, so update-to-latest.sql
-- (one transaction for everything) works as well.
--   xp_source      'battle'        XP prize of a news battle
--   ledger_tx_kind 'battle_prize'  money prize: households -> winner
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

alter type public.xp_source add value if not exists 'battle';
alter type public.ledger_tx_kind add value if not exists 'battle_prize';
