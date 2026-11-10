/**
 * Company loans (spec 6.7): interest = policy rate + risk premium from
 * reputation, leverage and profitability; credit line from level and reputation.
 */
import { BALANCE } from "../../config/balance.ts";
import type { LoansConfig } from "../../config/balance.ts";
import { ZERO, divRoundHalfEven, applyBps, scaleByFloat } from "./money.ts";

export interface LoanRiskInput {
  readonly policyRateBps: number;
  /** Founder reputation 0..100. */
  readonly reputation: number;
  /** Debt after the new loan. */
  readonly debtCents: bigint;
  readonly equityCents: bigint;
  /** Trailing four quarter operating profit before interest. */
  readonly trailingOperatingProfitCents: bigint;
  /** Skill 1..10 of the CFO, 0 without one. */
  readonly cfoSkill: number;
}

export interface LoanRate {
  readonly rateBps: number;
  readonly riskPremiumBps: number;
}

/** Risk premium in bps, clamped to [minPremiumBps, maxPremiumBps]. */
export function loanRiskPremiumBps(input: LoanRiskInput, cfg: LoansConfig = BALANCE.loans): number {
  const reputation = Math.min(100, Math.max(0, input.reputation));
  let premium = cfg.basePremiumBps + (100 - reputation) * cfg.reputationBpsPerPoint;

  // Leverage: debt-to-equity, non-positive equity counts as maximally levered.
  if (input.debtCents > ZERO) {
    const leverage =
      input.equityCents > ZERO
        ? cfg.leverageBpsPerDebtToEquity * (Number(input.debtCents) / Number(input.equityCents))
        : cfg.maxLeveragePremiumBps;
    premium += Math.min(cfg.maxLeveragePremiumBps, leverage);
  }

  // Profitability: loss makers pay extra, strong interest coverage earns a discount.
  if (input.trailingOperatingProfitCents <= ZERO) {
    premium += cfg.lossMakingPremiumBps;
  } else if (input.debtCents > ZERO) {
    const interestAtBase = Number(input.debtCents) * ((input.policyRateBps + cfg.basePremiumBps) / 10_000);
    const coverage = interestAtBase > 0 ? Number(input.trailingOperatingProfitCents) / interestAtBase : Infinity;
    const discount = Math.max(0, coverage - 1) * cfg.coverageDiscountBpsPerTurn;
    premium -= Math.min(cfg.maxCoverageDiscountBps, discount);
  } else {
    premium -= cfg.maxCoverageDiscountBps;
  }

  premium -= Math.max(0, input.cfoSkill) * cfg.cfoDiscountBpsPerSkill;
  return Math.round(Math.min(cfg.maxPremiumBps, Math.max(cfg.minPremiumBps, premium)));
}

/** Annual (game year) loan rate = policy rate + risk premium. */
export function loanRateBps(input: LoanRiskInput, cfg: LoansConfig = BALANCE.loans): LoanRate {
  const riskPremiumBps = loanRiskPremiumBps(input, cfg);
  return { rateBps: input.policyRateBps + riskPremiumBps, riskPremiumBps };
}

/** Interest for one quarter on an annual rate. */
export function quarterlyInterestCents(debtCents: bigint, annualRateBps: number, quartersPerYear = 4): bigint {
  if (debtCents <= ZERO) return ZERO;
  return divRoundHalfEven(applyBps(debtCents, annualRateBps), BigInt(quartersPerYear));
}

/** Credit line from the founder's level (spec 9.3) scaled by reputation (0.5x..1.5x). */
export function creditLineCents(level: number, reputation: number, cfg: LoansConfig = BALANCE.loans): bigint {
  let base = 0;
  for (const step of cfg.creditLinesByLevel) if (level >= step.level) base = Math.max(base, step.limitCents);
  if (base === 0) return ZERO;
  const r = Math.min(100, Math.max(0, reputation)) / 100;
  const factor =
    cfg.creditLineReputationFactorMin + (cfg.creditLineReputationFactorMax - cfg.creditLineReputationFactorMin) * r;
  return scaleByFloat(BigInt(base), factor);
}
