-- =============================================================================
-- NEXA · M5a · 0150 · Enum values for cryptocurrencies (ADR-101)
-- =============================================================================
-- A new enum value cannot be used in the transaction that adds it (SQLSTATE 55P04). The values live in their own
-- migration file, so a migration run with one transaction per file (supabase db push, verify_local.sh) has committed
-- them before 20261201000200_m5a_crypto.sql starts. That migration and its update copy use them only inside PL/pgSQL
-- bodies, never at the top level, so update-to-latest.sql (one transaction for everything) works as well: the coins
-- are seeded by run_due_jobs() after the commit (crypto_bootstrap()).
--   security_kind  'crypto'          coins trade as securities (positions, quotes, candles, portfolio, net worth)
--   ledger_tx_kind 'crypto_buy'      player cash -> pool (plus the order fee to the treasury)
--                  'crypto_sell'     pool -> player cash (order fee and tax to the treasury)
--                  'crypto_flow'     financial market <-> pool (seed, AI flows, dead coins), hacks: pool -> treasury
--                  'crypto_fee'      own coin: founding and development actions, player -> treasury
--                  'crypto_launch'   own coin: the creator's liquidity, player -> pool
--                  'crypto_payout'   pool -> holders when a coin is closed or delisted (tax to the treasury)
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

alter type public.security_kind add value if not exists 'crypto';
alter type public.ledger_tx_kind add value if not exists 'crypto_buy';
alter type public.ledger_tx_kind add value if not exists 'crypto_sell';
alter type public.ledger_tx_kind add value if not exists 'crypto_flow';
alter type public.ledger_tx_kind add value if not exists 'crypto_fee';
alter type public.ledger_tx_kind add value if not exists 'crypto_launch';
alter type public.ledger_tx_kind add value if not exists 'crypto_payout';
