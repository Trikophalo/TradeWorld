import { BALANCE } from "@/config/balance";

/*
 * Order maths shared by the order form and the demo engine. Share quantities
 * are millionths (e6, fractional shares, ADR-040); money is cents, prices e4.
 * Products of quantity and price exceed 2^53, so they are computed in BigInt.
 * The server computes the binding numbers; this is for previews and the demo.
 */

export const ORDER_FEE_CENTS = BALANCE.trading.orderFeeCents;
export const QUANTITY_SCALE = BALANCE.trading.quantityScale;
export const MIN_ORDER_CENTS = BALANCE.trading.minOrderValueCents;
export const MAX_QUANTITY_E6 = BALANCE.trading.maxOrderQuantity * QUANTITY_SCALE;

/** quantity × price, divided down to cents, so 1 share at 1 € = 100 cents. */
const DIVISOR = BigInt(QUANTITY_SCALE) * BigInt(100);

function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * BigInt(2);
  if (twice > denominator || (twice === denominator && quotient % BigInt(2) !== BigInt(0))) return quotient + BigInt(1);
  return quotient;
}

/** Value in cents of `quantityE6` shares at `priceE4`, rounded half to even like the server. */
export function valueCents(quantityE6: number, priceE4: number): number {
  return Number(roundHalfEven(BigInt(Math.round(quantityE6)) * BigInt(Math.round(priceE4)), DIVISOR));
}

/** Shares (e6) bought for a budget that includes the fee: what a neo-broker does with "buy for 50 €". */
export function quantityE6ForBudget(budgetCents: number, priceE4: number, feeCents = ORDER_FEE_CENTS): number {
  if (priceE4 <= 0 || budgetCents <= feeCents) return 0;
  return Number((BigInt(budgetCents - feeCents) * DIVISOR) / BigInt(priceE4));
}

/** Shares (e6) to sell so that the gross proceeds reach `amountCents` (rounded up). */
export function quantityE6ForProceeds(amountCents: number, priceE4: number): number {
  if (priceE4 <= 0 || amountCents <= 0) return 0;
  const numerator = BigInt(amountCents) * DIVISOR;
  const price = BigInt(priceE4);
  return Number((numerator + price - BigInt(1)) / price);
}

/** Parses a euro amount as typed by German players ("1.234,56", "50", "12,5") into cents. Null if invalid. */
export function parseEuroCents(input: string): number | null {
  const text = input.trim().replace(/\s|€/g, "");
  if (!text) return null;
  const normalised = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^\d+(\.\d{0,2})?$/.test(normalised)) return null;
  return Math.round(Number(normalised) * 100);
}

/** Parses a price in euros with up to four decimals into e4. Null if invalid or not positive. */
export function parsePriceE4(input: string): number | null {
  const text = input.trim().replace(/\s|€/g, "");
  const normalised = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^\d+(\.\d{0,4})?$/.test(normalised)) return null;
  const value = Math.round(Number(normalised) * 10_000);
  return value > 0 ? value : null;
}

/** Parses a share quantity with up to six decimals ("2", "0,5", "1,234567") into e6. Null if invalid or zero. */
export function parseQuantityE6(input: string): number | null {
  const text = input.trim().replace(/\s/g, "");
  const normalised = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^\d+(\.\d{0,6})?$/.test(normalised)) return null;
  const [whole = "0", fraction = ""] = normalised.split(".");
  const value = Number(whole) * QUANTITY_SCALE + Number(fraction.padEnd(6, "0"));
  return value > 0 ? value : null;
}
