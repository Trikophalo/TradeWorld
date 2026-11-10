/**
 * Shared sector demand (spec 6.2): attractiveness, market share, capacity-capped
 * revenue allocation and marketing with diminishing returns.
 *
 * All values here are model quantities (`number`). Demand and revenue are passed
 * as cents in `number` (sector demand is far below 2^53) and converted to bigint
 * by the caller (`closeQuarter`).
 */
import { BALANCE } from "../../config/balance.ts";
import type { CompanyConfig } from "../../config/balance.ts";

export interface AttractivenessInput {
  /** Product quality, > 0 (scale 1..100). */
  readonly quality: number;
  /** Awareness in (0, 1]. */
  readonly awareness: number;
  /** Unit price, > 0 (any consistent unit, the sim uses cents). */
  readonly price: number;
}

/** `quality^1.2 x awareness^0.8 / price^1.5` (exponents from the config). */
export function attractiveness(
  input: AttractivenessInput,
  cfg: CompanyConfig["attractiveness"] = BALANCE.company.attractiveness,
): number {
  const { quality, awareness, price } = input;
  if (!(price > 0)) throw new RangeError(`price must be > 0, got ${price}`);
  if (quality <= 0 || awareness <= 0) return 0;
  return (
    (Math.pow(quality, cfg.qualityExponent) * Math.pow(awareness, cfg.awarenessExponent)) /
    Math.pow(price, cfg.priceExponent)
  );
}

/** Market shares proportional to attractiveness. Sums to 1 unless every value is 0. */
export function marketShares(attractivenessValues: readonly number[]): number[] {
  let total = 0;
  for (const a of attractivenessValues) total += Math.max(0, a);
  if (total <= 0) return attractivenessValues.map(() => 0);
  return attractivenessValues.map((a) => Math.max(0, a) / total);
}

export interface DemandClaim {
  readonly attractiveness: number;
  /** Maximum revenue the company can serve (capacity units x unit price). */
  readonly capacityRevenue: number;
}

export interface DemandAllocation {
  /** Revenue per company, same order as the input. */
  readonly revenues: number[];
  /** Realised share of the sector demand per company (sums to <= 1). */
  readonly shares: number[];
  /** Demand that could not be served by anyone. */
  readonly unservedDemand: number;
}

/**
 * Distributes sector demand by attractiveness, capped by capacity.
 *
 * Decision (documented in docs/SIMULATION.md): demand a capped company cannot
 * serve is NOT lost. Those customers buy from the remaining companies, again in
 * proportion to attractiveness ("water filling"). Only when every company with
 * positive attractiveness is at capacity does demand stay unserved.
 */
export function allocateDemand(sectorDemand: number, claims: readonly DemandClaim[]): DemandAllocation {
  const revenues = claims.map(() => 0);
  const demand = Math.max(0, sectorDemand);
  let remaining = demand;
  let open: number[] = [];
  claims.forEach((claim, i) => {
    if (claim.attractiveness > 0 && claim.capacityRevenue > 0) open.push(i);
  });

  while (open.length > 0 && remaining > 0) {
    let totalAttractiveness = 0;
    for (const i of open) totalAttractiveness += (claims[i] as DemandClaim).attractiveness;
    const capped: number[] = [];
    for (const i of open) {
      const claim = claims[i] as DemandClaim;
      const offered = (remaining * claim.attractiveness) / totalAttractiveness;
      if (offered >= claim.capacityRevenue) capped.push(i);
    }
    if (capped.length === 0) {
      for (const i of open) {
        const claim = claims[i] as DemandClaim;
        revenues[i] = (remaining * claim.attractiveness) / totalAttractiveness;
      }
      remaining = 0;
      break;
    }
    for (const i of capped) {
      const claim = claims[i] as DemandClaim;
      revenues[i] = claim.capacityRevenue;
      remaining -= claim.capacityRevenue;
    }
    const cappedSet = new Set(capped);
    open = open.filter((i) => !cappedSet.has(i));
  }

  const unservedDemand = Math.max(0, remaining);
  const shares = revenues.map((r) => (demand > 0 ? r / demand : 0));
  return { revenues, shares, unservedDemand };
}

/**
 * Awareness gain of one quarter from a marketing budget.
 * `gain = gainAtReference x (budget / referenceBudget) ^ log2(1.4)`, capped.
 * Doubling the budget multiplies the gain by 1.4 (spec 6.3).
 */
export function marketingAwarenessGain(
  budget: number,
  referenceBudget: number,
  cfg: CompanyConfig["marketing"] = BALANCE.company.marketing,
): number {
  if (budget <= 0 || referenceBudget <= 0) return 0;
  const gain = cfg.gainAtReferenceBudget * Math.pow(budget / referenceBudget, cfg.diminishingReturnsExponent);
  return Math.min(cfg.maxGainPerQuarter, gain);
}

/**
 * Awareness after one quarter: part of the existing awareness is forgotten, the
 * marketing gain converts a share of the not-yet-aware market (second source of
 * diminishing returns: saturation).
 */
export function nextAwareness(
  awareness: number,
  budget: number,
  referenceBudget: number,
  cfg: CompanyConfig["marketing"] = BALANCE.company.marketing,
): number {
  const kept = awareness * (1 - cfg.awarenessDecayPerQuarter);
  const gain = marketingAwarenessGain(budget, referenceBudget, cfg);
  const next = kept + (1 - kept) * gain;
  return Math.min(1, Math.max(cfg.minAwareness, next));
}
