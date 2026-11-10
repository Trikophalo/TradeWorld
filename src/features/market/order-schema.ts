import { z } from "zod";

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

/** Fixed order fee in cents. Placeholder for BALANCE.trading until the RPC returns the real quote. */
export const DEMO_ORDER_FEE_CENTS = 100;

/** quantity × price (scaled by 10_000) -> cents, rounded half to even like the server. */
export function orderValueCents(quantity: number, priceE4: number): number {
  const exact = (BigInt(quantity) * BigInt(priceE4)) / 100n;
  const remainder = (BigInt(quantity) * BigInt(priceE4)) % 100n;
  const roundUp = remainder > 50n || (remainder === 50n && exact % 2n === 1n);
  return Number(roundUp ? exact + 1n : exact);
}
