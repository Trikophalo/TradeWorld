/**
 * Government bonds (spec 5.1): yield from policy rate and maturity, coupon and
 * present-value price. All rates are per game year.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BondsConfig } from "../../config/balance.ts";
import { applyBps, divRoundHalfEven, roundToBigInt } from "./money.ts";

/**
 * Yield of a newly issued bond: policy rate + maturity spread, clamped to the
 * 2..4 % corridor of the spec. Unknown maturities interpolate the spread
 * linearly between the configured ones.
 */
export function bondYieldBps(policyRateBps: number, maturityYears: number, cfg: BondsConfig = BALANCE.bonds): number {
  const raw = policyRateBps + maturitySpreadBps(maturityYears, cfg);
  return Math.round(Math.min(cfg.maxYieldBps, Math.max(cfg.minYieldBps, raw)));
}

function maturitySpreadBps(maturityYears: number, cfg: BondsConfig): number {
  const sorted = [...cfg.maturities].sort((a, b) => a.years - b.years);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return 0;
  if (maturityYears <= first.years) return first.spreadBps;
  if (maturityYears >= last.years) return last.spreadBps;
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted[i - 1];
    const hi = sorted[i];
    if (lo && hi && maturityYears <= hi.years) {
      const t = (maturityYears - lo.years) / (hi.years - lo.years);
      return lo.spreadBps + t * (hi.spreadBps - lo.spreadBps);
    }
  }
  return last.spreadBps;
}

/** Coupon paid at one quarter close for `nominalCents` of bonds with an annual coupon. */
export function bondCouponCents(nominalCents: bigint, couponBps: number, cfg: BondsConfig = BALANCE.bonds): bigint {
  return divRoundHalfEven(applyBps(nominalCents, couponBps), BigInt(cfg.couponsPerGameYear));
}

/**
 * Clean price of a bond in percent of face value as E4 (1 000 000 = 100.0000 %):
 * present value of the remaining coupons and the redemption, discounted with the
 * current market yield for the remaining maturity. Price falls when yields rise.
 */
export function bondPriceE4(
  couponBps: number,
  marketYieldBps: number,
  remainingCoupons: number,
  cfg: BondsConfig = BALANCE.bonds,
): bigint {
  const n = Math.max(0, Math.floor(remainingCoupons));
  const periods = cfg.couponsPerGameYear;
  const coupon = couponBps / 10_000 / periods;
  const y = marketYieldBps / 10_000 / periods;
  let pv = 0;
  for (let k = 1; k <= n; k++) pv += coupon / Math.pow(1 + y, k);
  pv += 1 / Math.pow(1 + y, n);
  return roundToBigInt(pv * 1_000_000);
}

/** Market value in cents of `nominalCents` face value at a percent-of-par E4 price. */
export function bondValueCents(nominalCents: bigint, pricePercentE4: bigint): bigint {
  return divRoundHalfEven(nominalCents * pricePercentE4, BigInt(1_000_000));
}
