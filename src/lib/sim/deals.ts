/**
 * Deals between players and trust (ADR-098): terms checks, loan repayment, the hourly supply settlement, stake payouts
 * and the trust score. The database applies the same rules; the UI and the demo use these functions.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";
import type { DealKind, TrustBand } from "../../config/deals.ts";
import { applyBps, divFloor, maxBig, minBig, roundToBigInt } from "./money.ts";

// ------------------------------------------------------------------ terms

export interface LoanTerms {
  readonly principalCents: number;
  readonly interestBps: number;
  readonly hours: number;
}

export interface SupplyTerms {
  /** Goods the supplier produces at most per hour, in cents at the buyer's normal price. */
  readonly volumeCentsPerHour: number;
  /** Fee per delivered unit as a share of the normal price. */
  readonly feeBps: number;
  readonly prepayBps: number;
  readonly hours: number;
}

export interface StakeTerms {
  readonly amountCents: number;
  /** Share of every profitable hour. */
  readonly shareBps: number;
  readonly hours: number;
}

export type TermsError = "amount" | "interest" | "hours" | "fee" | "prepay" | "share" | "volume" | "size";

/** Biggest company deal for a company of this value (ADR-100): a share of the value, at least the minimum. */
export function dealSizeLimitCents(companyValueCents: number, cfg: BalanceConfig = BALANCE): number {
  const d = cfg.deals;
  return Math.max(d.minSizeCents, Math.floor((Math.max(0, companyValueCents) * d.sizeShareOfValueBps) / 10_000));
}

const inRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

/** Most a lender may lend at this level (abuse guard). */
export function maxLoanPrincipalCents(lenderLevel: number, cfg: BalanceConfig = BALANCE): number {
  return Math.max(1, Math.floor(lenderLevel)) * cfg.deals.loan.maxPrincipalCentsPerLevel;
}

export function loanTermsError(t: LoanTerms, lenderLevel: number, cfg: BalanceConfig = BALANCE): TermsError | null {
  const l = cfg.deals.loan;
  if (!inRange(t.principalCents, l.minPrincipalCents, maxLoanPrincipalCents(lenderLevel, cfg))) return "amount";
  if (!inRange(t.interestBps, 0, l.maxInterestBps)) return "interest";
  if (!inRange(t.hours, l.minHours, l.maxHours)) return "hours";
  return null;
}

export function supplyTermsError(t: SupplyTerms, cfg: BalanceConfig = BALANCE): TermsError | null {
  const s = cfg.deals.supply;
  if (!Number.isInteger(t.volumeCentsPerHour) || t.volumeCentsPerHour < s.minVolumeCentsPerHour) return "volume";
  if (!inRange(t.feeBps, s.minFeeBps, s.maxFeeBps)) return "fee";
  if (!inRange(t.prepayBps, 0, s.maxPrepayBps)) return "prepay";
  if (!inRange(t.hours, s.minHours, s.maxHours)) return "hours";
  return null;
}

/**
 * A new stake may not push all running stakes of the company above the total cap.
 * `runningShareBps` = sum of the company's running stakes.
 */
export function stakeTermsError(t: StakeTerms, runningShareBps = 0, cfg: BalanceConfig = BALANCE): TermsError | null {
  const s = cfg.deals.stake;
  if (!Number.isInteger(t.amountCents) || t.amountCents < s.minAmountCents) return "amount";
  if (!inRange(t.shareBps, 1, s.maxShareBps) || runningShareBps + t.shareBps > s.maxTotalShareBps) return "share";
  if (!inRange(t.hours, s.minHours, s.maxHours)) return "hours";
  return null;
}

// ------------------------------------------------------------------ loans

/** What the borrower owes in total: principal plus the interest for the whole term. */
export function loanDueCents(principalCents: bigint, interestBps: number): bigint {
  return principalCents + applyBps(principalCents, interestBps);
}

/** Collecting at the due date (or a repayment): as much as the free cash allows. */
export function loanCollect(remainingCents: bigint, freeCashCents: bigint): { paidCents: bigint; leftCents: bigint } {
  const paid = maxBig(0n, minBig(remainingCents, freeCashCents));
  return { paidCents: paid, leftCents: remainingCents - paid };
}

export type LoanPhase = "running" | "overdue" | "defaulted";

/** Phase of an unpaid loan at a time (ms). */
export function loanPhase(dueAt: number, at: number, cfg: BalanceConfig = BALANCE): LoanPhase {
  if (at < dueAt) return "running";
  return at < dueAt + cfg.deals.loan.defaultAfterHours * 3_600_000 ? "overdue" : "defaulted";
}

// ------------------------------------------------------------------ supply

/** Supplier capacity a contract may use: free capacity, minus the share sold as anonymous contract work. */
export function supplyFreeCapacityCents(
  capacityCents: number,
  demandCents: number,
  contractWork: boolean,
  cfg: BalanceConfig = BALANCE,
): number {
  const free = Math.max(0, capacityCents - demandCents);
  return contractWork ? free * (1 - cfg.startups.contractWork.shareOfFreeCapacity) : free;
}

/** Demand the buyer could not serve itself this hour. */
export function unmetDemandCents(capacityCents: number, demandCents: number): number {
  return Math.max(0, demandCents - capacityCents);
}

export interface SupplyHourInput {
  readonly volumeCentsPerHour: number;
  readonly feeBps: number;
  readonly buyerUnmetCents: number;
  readonly supplierFreeCents: number;
  /** Buyer's price factor (budget 0.8, normal 1, premium 1.3). */
  readonly buyerPrice: number;
  readonly supplierGrossMargin: number;
}

export interface SupplyHourResult {
  /** Goods delivered, in cents at the normal price. */
  readonly deliveredCents: bigint;
  /** What the buyer could have used: min(volume, unmet demand). */
  readonly neededCents: bigint;
  /** Buyer sells the goods at its price. */
  readonly buyerRevenueCents: bigint;
  /** Buyer pays the supplier per delivered unit. */
  readonly feeCents: bigint;
  /** Supplier's goods for the delivery. */
  readonly supplierGoodsCents: bigint;
}

export function supplyHour(input: SupplyHourInput): SupplyHourResult {
  const needed = Math.max(0, Math.min(input.volumeCentsPerHour, input.buyerUnmetCents));
  const delivered = roundToBigInt(Math.max(0, Math.min(needed, input.supplierFreeCents)));
  return {
    deliveredCents: delivered,
    neededCents: roundToBigInt(needed),
    buyerRevenueCents: roundToBigInt(Number(delivered) * input.buyerPrice),
    feeCents: applyBps(delivered, input.feeBps),
    supplierGoodsCents: roundToBigInt(Number(delivered) * (1 - input.supplierGrossMargin)),
  };
}

/** Most the contract can cost the buyer: full volume every hour. */
export function supplyMaxCostCents(t: SupplyTerms): bigint {
  return applyBps(BigInt(t.volumeCentsPerHour) * BigInt(t.hours), t.feeBps);
}

export function supplyPrepayCents(t: SupplyTerms): bigint {
  return applyBps(supplyMaxCostCents(t), t.prepayBps);
}

/** Fee of an hour: first from what is left of the prepayment, the rest from the buyer's cash. */
export function supplyFeeSplit(feeCents: bigint, prepayLeftCents: bigint): { fromPrepay: bigint; fromCash: bigint } {
  const fromPrepay = minBig(feeCents, maxBig(0n, prepayLeftCents));
  return { fromPrepay, fromCash: feeCents - fromPrepay };
}

/** At the end: kept when the supplier served at least keptDeliveryBps of what the buyer could use. */
export function supplyKept(deliveredCents: bigint, neededCents: bigint, cfg: BalanceConfig = BALANCE): boolean {
  if (neededCents <= 0n) return true;
  return deliveredCents * 10_000n >= neededCents * BigInt(cfg.deals.supply.keptDeliveryBps);
}

/** Profit per delivered unit for both sides, as a share of the normal price: shows whether a fee is fair. */
export function supplyMargins(feeBps: number, buyerPrice: number, supplierGrossMargin: number) {
  const fee = feeBps / 10_000;
  return { buyer: buyerPrice - fee, supplier: fee - (1 - supplierGrossMargin) };
}

// ------------------------------------------------------------------ stakes

/** Share of a profitable hour for one stake, never more than the free cash. */
export function stakePayoutCents(profitCents: bigint, shareBps: number, freeCashCents: bigint): bigint {
  if (profitCents <= 0n || shareBps <= 0) return 0n;
  return maxBig(0n, minBig(divFloor(profitCents * BigInt(shareBps), 10_000n), freeCashCents));
}

// ------------------------------------------------------------------ trust

export type TrustReason = keyof BalanceConfig["trust"]["deltas"];

export function trustScore(deltas: readonly number[], cfg: BalanceConfig = BALANCE): number {
  const t = cfg.trust;
  const sum = deltas.reduce((a, b) => a + b, 0);
  return Math.min(t.max, Math.max(t.min, t.start + sum));
}

export function trustBand(score: number, cfg: BalanceConfig = BALANCE): TrustBand {
  let band: TrustBand = cfg.trust.bands[0]!.key;
  for (const b of cfg.trust.bands) if (score >= b.from) band = b.key;
  return band;
}

/** Who gets which trust change when a deal ends. */
export function trustOnEnd(
  kind: DealKind,
  outcome: "kept" | "late" | "short" | "broken" | "forgiven",
  cfg: BalanceConfig = BALANCE,
): { obligor: number; other: number } {
  const d = cfg.trust.deltas;
  if (outcome === "broken") return { obligor: d.dealBroken, other: 0 };
  switch (kind) {
    case "loan":
      if (outcome === "forgiven") return { obligor: 0, other: d.loanForgiven + d.loanLent };
      return { obligor: outcome === "late" ? d.loanRepaidLate : d.loanRepaidOnTime, other: d.loanLent };
    case "supply":
      return outcome === "short"
        ? { obligor: d.supplyShort, other: d.supplyKept }
        : { obligor: d.supplyKept, other: d.supplyKept };
    case "stake":
      return { obligor: d.stakeKept, other: 0 };
  }
}

/** Integer floor of hours between two times (ms), for the term display. */
export function hoursLeft(endsAt: number, at: number): number {
  return Math.max(0, Number(divFloor(BigInt(Math.max(0, Math.round(endsAt - at))), 3_600_000n)));
}
