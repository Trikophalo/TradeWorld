/**
 * Basic income vault (spec 8.1): accrues by the millisecond, holds at most
 * `vaultCapHours` of income; everything beyond is lost.
 */
import { BALANCE } from "../../config/balance.ts";
import type { EconomyConfig, VaultConfig, VaultDepositTerm } from "../../config/balance.ts";
import { BPS_DENOMINATOR, divRoundHalfEven, ZERO } from "./money.ts";

const MS_PER_HOUR = 3_600_000;

export interface VaultStatus {
  readonly accruedCents: bigint;
  readonly capCents: bigint;
  readonly isFull: boolean;
  /** Milliseconds until the vault is full, 0 if it already is. */
  readonly msUntilFull: number;
}

export function vaultStatus(lastClaimMs: number, nowMs: number, cfg: EconomyConfig = BALANCE.economy): VaultStatus {
  const capMs = cfg.vaultCapHours * MS_PER_HOUR;
  const elapsedMs = Math.max(0, Math.floor(nowMs - lastClaimMs));
  const countedMs = Math.min(elapsedMs, capMs);
  const rate = BigInt(cfg.basicIncomeCentsPerHour);
  const capCents = rate * BigInt(cfg.vaultCapHours);
  const accruedCents = countedMs <= 0 ? ZERO : (rate * BigInt(countedMs)) / BigInt(MS_PER_HOUR);
  return {
    accruedCents,
    capCents,
    isFull: countedMs >= capMs,
    msUntilFull: capMs - countedMs,
  };
}

/** Amount paid out by "empty the vault" at `nowMs`. */
export function vaultAccruedCents(lastClaimMs: number, nowMs: number, cfg: EconomyConfig = BALANCE.economy): bigint {
  return vaultStatus(lastClaimMs, nowMs, cfg).accruedCents;
}

/**
 * Passive salary for the time since the last payout, limited to the paid hours
 * of the (Berlin) day. `paidMsToday` is what was already paid today.
 */
export function salaryAccruedCents(
  salaryCentsPerHour: bigint,
  elapsedMs: number,
  paidMsToday: number,
  paidHoursPerDayCap: number = BALANCE.careers.paidHoursPerDayCap,
): { readonly cents: bigint; readonly paidMs: number } {
  const remainingMs = Math.max(0, paidHoursPerDayCap * MS_PER_HOUR - Math.max(0, paidMsToday));
  const paidMs = Math.min(Math.max(0, Math.floor(elapsedMs)), remainingMs);
  return { cents: (salaryCentsPerHour * BigInt(paidMs)) / BigInt(MS_PER_HOUR), paidMs };
}

// ------------------------------------------------------------------ the vault grows with the player (ADR-201)

/** Level bonus of the vault income in bps: 10 000 + levelBonusBps for every level above 1, up to the max level. */
export function vaultLevelFactorBps(level: number, cfg: VaultConfig = BALANCE.vault): number {
  const counted = Math.min(Math.max(1, Math.floor(level)), cfg.levelBonusMaxLevel);
  return 10_000 + cfg.levelBonusBps * (counted - 1);
}

/**
 * Vault income per hour before the treasury factor: the basic income with the upgrades times the level bonus,
 * rounded half even (as `vault_status` does).
 */
export function vaultRateCentsPerHour(
  incomeCentsPerHour: number,
  level: number,
  cfg: VaultConfig = BALANCE.vault,
): number {
  const scaled = divRoundHalfEven(
    BigInt(Math.round(incomeCentsPerHour)) * BigInt(vaultLevelFactorBps(level, cfg)),
    BPS_DENOMINATOR,
  );
  return Number(scaled);
}

/** All open deposits of a player together hold at most this. */
export function vaultDepositCapCents(level: number, cfg: VaultConfig = BALANCE.vault): number {
  return Math.max(0, Math.floor(level)) * cfg.deposits.capCentsPerLevel;
}

/** The term with this many days, or null if there is none. */
export function vaultDepositTerm(days: number, cfg: VaultConfig = BALANCE.vault): VaultDepositTerm | null {
  return cfg.deposits.terms.find((term) => term.days === days) ?? null;
}

/** Interest of a deposit at maturity: amount × rate × treasury factor, rounded half even once. */
export function vaultDepositInterestCents(amountCents: bigint, rateBps: number, factorBps = 10_000): bigint {
  if (amountCents <= ZERO || rateBps <= 0 || factorBps <= 0) return ZERO;
  return divRoundHalfEven(amountCents * BigInt(rateBps) * BigInt(factorBps), BPS_DENOMINATOR * BPS_DENOMINATOR);
}

export type VaultDepositCheck = "ok" | "level" | "term" | "too_small" | "cash" | "cap" | "max_open";

/** Why a new deposit is refused, in the order the server checks it. */
export function vaultDepositCheck(
  input: {
    readonly level: number;
    readonly amountCents: number;
    readonly days: number;
    readonly cashCents: number;
    readonly openCents: number;
    readonly openCount: number;
  },
  cfg: VaultConfig = BALANCE.vault,
): VaultDepositCheck {
  if (input.level < cfg.deposits.minLevel) return "level";
  if (!vaultDepositTerm(input.days, cfg)) return "term";
  if (input.amountCents < cfg.deposits.minCents) return "too_small";
  if (input.openCount >= cfg.deposits.maxOpen) return "max_open";
  if (input.openCents + input.amountCents > vaultDepositCapCents(input.level, cfg)) return "cap";
  if (input.amountCents > input.cashCents) return "cash";
  return "ok";
}
