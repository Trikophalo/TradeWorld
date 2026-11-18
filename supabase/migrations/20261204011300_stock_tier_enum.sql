-- =============================================================================
-- NEXA · 011300 · Enum values for the stock tiers of player companies (ADR-218)
-- =============================================================================
-- Listed player companies climb penny → smallcap → midcap → largecap → bluechip by market cap
-- (20261204011320_player_stock_tiers.sql). A new enum value cannot be used in the transaction that adds it (SQLSTATE
-- 55P04), so the values get their own file; later files use them only inside PL/pgSQL bodies (as text, cast at run
-- time). Every lookup keyed by companies.tier (impact depth, spread, noise, AI interest) reads game_config, which
-- carries the new keys. Order of the enum: largest first.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

alter type public.company_tier add value if not exists 'largecap' after 'bluechip';
alter type public.company_tier add value if not exists 'smallcap' after 'midcap';
