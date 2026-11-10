/**
 * NEXA 30 (spec 5.4): free-float market-cap weighted price index with a divisor.
 */
import { BALANCE } from "../../config/balance.ts";
import type { IndexConfig } from "../../config/balance.ts";
import type { IndexCandidate, IndexReview } from "./types.ts";
import { ZERO, orderValueCents } from "./money.ts";

export interface IndexConstituent {
  readonly priceE4: bigint;
  readonly freeFloatShares: bigint;
}

export function freeFloatMarketCapCents(constituent: IndexConstituent): bigint {
  return orderValueCents(constituent.freeFloatShares, constituent.priceE4);
}

export function totalFreeFloatCapCents(constituents: readonly IndexConstituent[]): bigint {
  let total = ZERO;
  for (const c of constituents) total += freeFloatMarketCapCents(c);
  return total;
}

/** Divisor that makes the index start at `baseLevel`. */
export function initialDivisor(constituents: readonly IndexConstituent[], cfg: IndexConfig = BALANCE.index): number {
  const cap = Number(totalFreeFloatCapCents(constituents));
  if (cap <= 0) throw new RangeError("index needs at least one constituent with positive market cap");
  return cap / cfg.baseLevel;
}

/** Index level = sum of free-float market caps / divisor. */
export function indexLevel(constituents: readonly IndexConstituent[], divisor: number): number {
  if (!(divisor > 0)) throw new RangeError("divisor must be > 0");
  return Number(totalFreeFloatCapCents(constituents)) / divisor;
}

/**
 * New divisor after a change of the basket or of share counts (inclusion,
 * removal, capital increase, buyback), computed at unchanged prices so that the
 * index level does not jump: `divisor' = divisor x capAfter / capBefore`.
 */
export function adjustDivisor(divisor: number, capBeforeCents: bigint, capAfterCents: bigint): number {
  if (capBeforeCents <= ZERO || capAfterCents <= ZERO) throw new RangeError("market caps must be > 0");
  return divisor * (Number(capAfterCents) / Number(capBeforeCents));
}

/** Weight of each constituent (sums to 1). */
export function indexWeights(constituents: readonly IndexConstituent[]): number[] {
  const total = Number(totalFreeFloatCapCents(constituents));
  return constituents.map((c) => (total > 0 ? Number(freeFloatMarketCapCents(c)) / total : 0));
}

/**
 * Membership review: the `size` largest eligible companies by free-float market
 * cap. A buffer avoids flip-flopping at the boundary: a member only leaves when
 * it drops below rank `size + buffer`, a newcomer only enters directly at rank
 * `size - buffer` or better; remaining seats are filled by rank.
 * While fewer than `size` companies are eligible, all of them are members.
 */
export function reviewIndexMembership(
  candidates: readonly IndexCandidate[],
  cfg: IndexConfig = BALANCE.index,
): IndexReview {
  const eligible = candidates
    .filter((c) => c.isMember || c.listedQuarters >= cfg.minListedQuarters)
    .map((c) => ({ candidate: c, cap: freeFloatMarketCapCents(c) }))
    .sort((a, b) => (a.cap === b.cap ? (a.candidate.securityId < b.candidate.securityId ? -1 : 1) : a.cap > b.cap ? -1 : 1));

  const chosen = new Set<string>();
  if (eligible.length <= cfg.size) {
    for (const e of eligible) chosen.add(e.candidate.securityId);
  } else {
    eligible.forEach((e, index) => {
      const rank = index + 1;
      if (e.candidate.isMember ? rank <= cfg.size + cfg.entryBuffer : rank <= cfg.size - cfg.entryBuffer) {
        chosen.add(e.candidate.securityId);
      }
    });
    // Fill free seats with the best-ranked remaining companies.
    for (const e of eligible) {
      if (chosen.size >= cfg.size) break;
      chosen.add(e.candidate.securityId);
    }
    // Trim surplus (cannot happen with buffer < size, kept for safety).
    for (let i = eligible.length - 1; i >= 0 && chosen.size > cfg.size; i--) {
      chosen.delete((eligible[i] as (typeof eligible)[number]).candidate.securityId);
    }
  }

  const members = eligible.filter((e) => chosen.has(e.candidate.securityId)).map((e) => e.candidate.securityId);
  const before = new Set(candidates.filter((c) => c.isMember).map((c) => c.securityId));
  return {
    members,
    added: members.filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !chosen.has(id)),
  };
}
