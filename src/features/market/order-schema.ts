import { z } from "zod";
import { BALANCE } from "@/config/balance";
import { orderValueCents as simOrderValueCents } from "@/lib/sim/money";

/**
 * Shared between the order form and (from M1) the `place_order` RPC wrapper.
 * The database validates everything again: this schema is for fast feedback.
 */
export const orderDraftSchema = z.object({
  /** Client-generated id that makes the order idempotent. */
  requestId: z.uuid(),
  ticker: z.string().regex(/^[A-Z]{2,5}$/),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["market", "limit", "stop"]),
  quantity: z.number().int().min(1).max(100_000),
});

export type OrderDraft = z.infer<typeof orderDraftSchema>;

/** Fixed order fee in cents (BALANCE.trading). The RPC returns the binding amount from M1 on. */
export const ORDER_FEE_CENTS = BALANCE.trading.orderFeeCents;

/** quantity × price (scaled by 10_000) -> cents, with the same rounding as the server. */
export function orderValueCents(quantity: number, priceE4: number): number {
  return Number(simOrderValueCents(BigInt(quantity), BigInt(priceE4)));
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

/**
 * Whole shares bought for a euro budget: as many as fit after the fee.
 * The rest of the budget stays in cash (no fractional shares, ADR-036).
 */
export function quantityForBudget(budgetCents: number, priceE4: number, feeCents = ORDER_FEE_CENTS): number {
  if (priceE4 <= 0) return 0;
  let quantity = Math.floor(((budgetCents - feeCents) * 100) / priceE4);
  while (quantity > 0 && orderValueCents(quantity, priceE4) + feeCents > budgetCents) quantity--;
  return Math.max(0, quantity);
}

/** Shares to sell to raise roughly a euro amount (rounded up, so at least the amount comes in). */
export function quantityForProceeds(amountCents: number, priceE4: number): number {
  if (priceE4 <= 0) return 0;
  return Math.ceil((amountCents * 100) / priceE4);
}
