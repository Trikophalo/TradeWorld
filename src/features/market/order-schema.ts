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
