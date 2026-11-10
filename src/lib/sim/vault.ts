/**
 * Basic income vault (spec 8.1): accrues by the millisecond, holds at most
 * `vaultCapHours` of income; everything beyond is lost.
 */
import { BALANCE } from "../../config/balance.ts";
import type { EconomyConfig } from "../../config/balance.ts";
import { ZERO } from "./money.ts";

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
