/**
 * Capital gains tax with loss carry-forward (spec 10): 25 % on realised gains.
 * Losses are never refunded; they reduce future taxable gains.
 */
import { BALANCE } from "../../config/balance.ts";
import { ZERO, applyBps } from "./money.ts";

export interface TaxSettlement {
  /** Tax due now, >= 0. */
  readonly taxCents: bigint;
  /** Loss pot after this settlement, >= 0. */
  readonly lossCarryForwardCents: bigint;
  /** Part of the gain that was offset by earlier losses. */
  readonly offsetCents: bigint;
}

/**
 * Settles one realised profit or loss (after fees) against the player's loss pot.
 *
 * - loss: the pot grows by the loss, no tax, no refund
 * - gain: the pot is used up first, the remainder is taxed
 */
export function settleCapitalGainsTax(
  realizedPnlCents: bigint,
  lossCarryForwardCents: bigint,
  taxBps: number = BALANCE.trading.capitalGainsTaxBps,
): TaxSettlement {
  const pot = lossCarryForwardCents > ZERO ? lossCarryForwardCents : ZERO;
  if (realizedPnlCents <= ZERO) {
    return { taxCents: ZERO, lossCarryForwardCents: pot - realizedPnlCents, offsetCents: ZERO };
  }
  const offsetCents = realizedPnlCents < pot ? realizedPnlCents : pot;
  const taxable = realizedPnlCents - offsetCents;
  return {
    taxCents: applyBps(taxable, taxBps),
    lossCarryForwardCents: pot - offsetCents,
    offsetCents,
  };
}

/** Flat withholding tax on coupons and dividends (no loss offsetting). */
export function withholdingTaxCents(
  grossCents: bigint,
  taxBps: number = BALANCE.trading.incomeTaxOnCouponsAndDividendsBps,
): bigint {
  return grossCents > ZERO ? applyBps(grossCents, taxBps) : ZERO;
}
