/**
 * Central bank (spec 5.1): the policy rate follows the growth of the money
 * supply measured from the ledger (ADR-007).
 */
import { BALANCE } from "../../config/balance.ts";
import type { CentralBankConfig } from "../../config/balance.ts";
import { ZERO } from "./money.ts";

export interface MoneySupplySample {
  /** Sum of all player and player-company cash accounts. */
  readonly moneySupplyCents: bigint;
  readonly activePlayers: number;
}

/**
 * Growth of the money supply per active player in bps between two samples.
 * Per-capita, so that a new player joining (with starting capital) is not
 * mistaken for inflation.
 */
export function moneyGrowthBps(previous: MoneySupplySample, current: MoneySupplySample): number {
  if (previous.moneySupplyCents <= ZERO || previous.activePlayers <= 0 || current.activePlayers <= 0) return 0;
  const before = Number(previous.moneySupplyCents) / previous.activePlayers;
  const after = Number(current.moneySupplyCents) / current.activePlayers;
  return Math.round((after / before - 1) * 10_000);
}

/** Scales growth measured over `windowQuarters` to one game year (compounded). */
export function annualizeGrowthBps(growthBps: number, windowQuarters: number, quartersPerYear = 4): number {
  if (windowQuarters <= 0) return 0;
  const factor = Math.max(0, 1 + growthBps / 10_000);
  return Math.round((Math.pow(factor, quartersPerYear / windowQuarters) - 1) * 10_000);
}

export interface RateDecision {
  readonly previousRateBps: number;
  readonly newRateBps: number;
  readonly changeBps: number;
  readonly direction: "hike" | "cut" | "hold";
  /** Deviation of the measured money growth from the target. */
  readonly gapBps: number;
}

/**
 * Rate decision: one step of `stepBps` per full tolerance band that the annual
 * money growth deviates from the target, at most `maxStepsPerDecision`, inside
 * [minRateBps, maxRateBps]. Inside the band the rate drifts one step back
 * towards the neutral rate.
 */
export function decidePolicyRate(
  currentRateBps: number,
  annualMoneyGrowthBps: number,
  cfg: CentralBankConfig = BALANCE.centralBank,
): RateDecision {
  const gapBps = annualMoneyGrowthBps - cfg.targetMoneyGrowthBps;
  let steps = Math.trunc(gapBps / cfg.toleranceBandBps);
  steps = Math.min(cfg.maxStepsPerDecision, Math.max(-cfg.maxStepsPerDecision, steps));

  let target = currentRateBps + steps * cfg.stepBps;
  if (steps === 0 && currentRateBps !== cfg.neutralRateBps) {
    const towardsNeutral = Math.sign(cfg.neutralRateBps - currentRateBps) * cfg.stepBps;
    const drifted = currentRateBps + towardsNeutral;
    // Do not overshoot the neutral rate.
    target = Math.sign(cfg.neutralRateBps - drifted) === -Math.sign(towardsNeutral) ? cfg.neutralRateBps : drifted;
  }
  const newRateBps = Math.min(cfg.maxRateBps, Math.max(cfg.minRateBps, target));
  const changeBps = newRateBps - currentRateBps;
  return {
    previousRateBps: currentRateBps,
    newRateBps,
    changeBps,
    direction: changeBps > 0 ? "hike" : changeBps < 0 ? "cut" : "hold",
    gapBps,
  };
}

/** True if a rate decision is due at the close of `quarterIndex`. */
export function isRateDecisionQuarter(quarterIndex: number, cfg: CentralBankConfig = BALANCE.centralBank): boolean {
  return quarterIndex % cfg.decisionEveryQuarters === cfg.decisionEveryQuarters - 1;
}
