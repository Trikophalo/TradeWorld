/**
 * Leverage, shorts, liquidation and financing costs (spec 10).
 *
 * Model
 * - Long with leverage L: the player posts `entry x qty / L` as margin and
 *   borrows the rest. Equity = price x qty - borrowed.
 * - Short with leverage L: the player posts `entry x qty / L` as margin, the
 *   sale proceeds stay locked. Equity = margin + (entry - price) x qty.
 * - Liquidation when equity <= maintenanceMargin x price x qty.
 */
import { BALANCE } from "../../config/balance.ts";
import type { SizeClass, TradingConfig } from "../../config/balance.ts";
import { BPS_DENOMINATOR, ZERO, applyBps, divCeil, divFloor, divRoundHalfEven, orderValueCents } from "./money.ts";

export type PositionSide = "long" | "short";

/** Highest leverage a player of `level` may use. */
export function maxLeverageForLevel(level: number, cfg: TradingConfig = BALANCE.trading): number {
  let max = 1;
  for (const tier of cfg.leverageTiers) if (level >= tier.level) max = Math.max(max, tier.maxLeverage);
  return max;
}

/** Margin the player has to post for a position. */
export function initialMarginCents(quantity: bigint, entryPriceE4: bigint, leverage: number): bigint {
  assertLeverage(leverage);
  return divCeil(orderValueCents(quantity, entryPriceE4), BigInt(leverage));
}

/**
 * Price at which a position is liquidated, `null` if it cannot be liquidated
 * (unlevered long).
 *
 *   long:  P_liq = entry x (1 - 1/L) / (1 - m)
 *   short: P_liq = entry x (1 + 1/L) / (1 + m)
 *
 * Rounded conservatively for the system: up for longs, down for shorts.
 * Accrued financing costs reduce equity; pass them as `accruedCostsPerShareE4`
 * to shift the price accordingly.
 */
export function liquidationPriceE4(
  side: PositionSide,
  entryPriceE4: bigint,
  leverage: number,
  maintenanceMarginBps: number = BALANCE.trading.maintenanceMarginBps,
  accruedCostsPerShareE4: bigint = ZERO,
): bigint | null {
  assertLeverage(leverage);
  if (entryPriceE4 <= ZERO) throw new RangeError("entry price must be > 0");
  const l = BigInt(leverage);
  const m = BigInt(maintenanceMarginBps);
  if (side === "long") {
    if (leverage === 1 && accruedCostsPerShareE4 <= ZERO) return null;
    // equity/share = P - entry x (L-1)/L - costs <= m x P
    const borrowedTimesL = entryPriceE4 * (l - BigInt(1)) + accruedCostsPerShareE4 * l;
    return divCeil(borrowedTimesL * BPS_DENOMINATOR, l * (BPS_DENOMINATOR - m));
  }
  // equity/share = entry/L + entry - P - costs <= m x P
  const numeratorTimesL = entryPriceE4 * (l + BigInt(1)) - accruedCostsPerShareE4 * l;
  const price = divFloor(numeratorTimesL * BPS_DENOMINATOR, l * (BPS_DENOMINATOR + m));
  return price < ZERO ? ZERO : price;
}

export type MarginStatus = "ok" | "margin_call" | "liquidation";

export interface MarginCheck {
  readonly equityCents: bigint;
  readonly notionalCents: bigint;
  /** Equity / notional in bps (may be negative). */
  readonly marginBps: number;
  readonly status: MarginStatus;
}

/** Current equity and status of a position at `priceE4`. */
export function checkMargin(
  side: PositionSide,
  quantity: bigint,
  entryPriceE4: bigint,
  leverage: number,
  priceE4: bigint,
  accruedCostsCents: bigint = ZERO,
  cfg: TradingConfig = BALANCE.trading,
): MarginCheck {
  assertLeverage(leverage);
  const entryValue = orderValueCents(quantity, entryPriceE4);
  const notionalCents = orderValueCents(quantity, priceE4);
  const margin = divCeil(entryValue, BigInt(leverage));
  const equityCents =
    side === "long"
      ? notionalCents - (entryValue - margin) - accruedCostsCents
      : margin + entryValue - notionalCents - accruedCostsCents;
  const marginBps = notionalCents > ZERO ? Number(divRoundHalfEven(equityCents * BPS_DENOMINATOR, notionalCents)) : 0;
  const unleveredLong = side === "long" && leverage === 1;
  let status: MarginStatus = "ok";
  if (!unleveredLong) {
    if (marginBps <= cfg.maintenanceMarginBps) status = "liquidation";
    else if (marginBps <= cfg.marginCallWarningMarginBps) status = "margin_call";
  }
  return { equityCents, notionalCents, marginBps, status };
}

/**
 * Financing cost for borrowed money or borrowed shares, accrued by the second
 * so that there is no cut-off time to dodge. `annualRateBps` is per game year.
 */
export function accruedFinancingCents(
  notionalCents: bigint,
  annualRateBps: number,
  heldSeconds: number,
  secondsPerGameYear: number,
): bigint {
  if (notionalCents <= ZERO || heldSeconds <= 0) return ZERO;
  const annual = applyBps(notionalCents, annualRateBps);
  return divCeil(annual * BigInt(Math.floor(heldSeconds)), BigInt(secondsPerGameYear));
}

/** Annual financing rate of a leveraged long: policy rate + financing spread. */
export function leverageFinancingRateBps(policyRateBps: number, cfg: TradingConfig = BALANCE.trading): number {
  return policyRateBps + cfg.financingSpreadBps;
}

/** Annual cost of a short: borrow fee by size class (the policy rate is not credited). */
export function shortBorrowRateBps(sizeClass: SizeClass, cfg: TradingConfig = BALANCE.trading): number {
  return cfg.borrowFeeBps[sizeClass];
}

function assertLeverage(leverage: number): void {
  if (!Number.isInteger(leverage) || leverage < 1) throw new RangeError(`invalid leverage: ${leverage}`);
}
