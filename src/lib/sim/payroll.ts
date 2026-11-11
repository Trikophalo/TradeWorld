/**
 * Profit-linked pay at player companies (ADR-052, docs/JOBS_AND_SKILLS.md §6).
 *
 * - The contract wage is the base; the employer can never lower it.
 * - If a quarter's result before wages does not cover the wages, the wages paid
 *   in the next quarter fall automatically (pay factor), at most to `minFactor`.
 *   The employer never pays wages out of the private pocket.
 * - If the result is above the wages, `bonusShareOfProfit` of the surplus goes
 *   to the employees by wage weight, each at most `maxBonusFactor` × their base
 *   wages of the quarter. So wages rise when the company does well.
 */
import { BALANCE } from "../../config/balance.ts";
import type { JobsConfig } from "../../config/balance.ts";

/** Pay factor in bps for the next quarter from the last result before wages. */
export function payFactorBps(
  resultBeforeWagesCents: bigint,
  wagesCents: bigint,
  cfg: JobsConfig["profitLinkedPay"] = BALANCE.jobs.profitLinkedPay,
): number {
  if (wagesCents <= BigInt(0) || resultBeforeWagesCents >= wagesCents) return 10_000;
  const ratio = Number(resultBeforeWagesCents > BigInt(0) ? resultBeforeWagesCents : BigInt(0)) / Number(wagesCents);
  return Math.round(Math.max(cfg.minFactor, Math.min(1, ratio)) * 10_000);
}

export interface BonusInput {
  readonly id: string;
  /** Base wages earned in the quarter (hours × contract wage, before the pay factor). */
  readonly baseWagesCents: bigint;
}

/**
 * Splits the bonus pool (share of the surplus over the wages) by wage weight,
 * capped per employee. Rounded down to cents; what does not fit stays in the company.
 */
export function distributeBonus(
  resultBeforeWagesCents: bigint,
  wagesCents: bigint,
  employees: readonly BonusInput[],
  cfg: JobsConfig["profitLinkedPay"] = BALANCE.jobs.profitLinkedPay,
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  const surplus = resultBeforeWagesCents - wagesCents;
  const weight = employees.reduce((sum, e) => sum + e.baseWagesCents, BigInt(0));
  if (surplus <= BigInt(0) || weight <= BigInt(0)) return result;
  const pool = BigInt(Math.floor(Number(surplus) * cfg.bonusShareOfProfit));
  for (const e of employees) {
    const share = (pool * e.baseWagesCents) / weight;
    const cap = BigInt(Math.floor(Number(e.baseWagesCents) * cfg.maxBonusFactor));
    const bonus = share < cap ? share : cap;
    if (bonus > BigInt(0)) result.set(e.id, bonus);
  }
  return result;
}
