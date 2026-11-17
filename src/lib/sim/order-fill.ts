/**
 * Market order fill plan (ADR-126, ADR-170, ADR-189). The same formula runs as `public.market_order_plan()` in
 * Postgres; the order preview (`quote_order`) and the execution (`place_order`) both use it, so what the player sees
 * before confirming is what is executed.
 *
 * Price path: the n-th share moves the price by `min(a × n, maxMove)` (a = relative move per whole share, n counted
 * from the player flow already pending this tick). Small orders pay half their own move as before (ADR-126). Large
 * orders cannot move the price further than one tick can (`maxMove` = `trading.maxTickReturnBps`), so beyond that
 * point every further share fills at the saturated price instead of sliding towards zero. There is no size limit:
 * any quantity fills completely. For player stocks no share fills outside the daily band (ADR-170).
 */

export interface FillPlanInput {
  readonly side: "buy" | "sell";
  /** Best ask (buy) or bid (sell), e4. */
  readonly touchE4: number;
  /** Relative price move per whole share. */
  readonly slope: number;
  /** Whole shares already pushed in the same direction this tick. */
  readonly pendingShares: number;
  /** Requested quantity (e6) or null when an amount is given. */
  readonly quantityE6: number | null;
  /** Buy: budget including the fee. Sell: wanted gross proceeds. */
  readonly amountCents: number | null;
  readonly feeCents: number;
  /** Largest move the order flow can cause (fraction × 10 000). */
  readonly maxMoveBps: number;
  /** Daily band (player stocks) or null. */
  readonly bandLowE4: number | null;
  readonly bandHighE4: number | null;
  readonly minPriceE4: number;
}

export interface FillPlan {
  readonly quantityE6: number;
  readonly avgPriceE4: number;
  /** Price of the last share. */
  readonly lastPriceE4: number;
  readonly grossCents: number;
  /** Buy: gross + fee. Sell: gross − fee (before tax). */
  readonly netCents: number;
  /** Average price against the touch, in bps (≥ 0): what the order pays for its own move. */
  readonly slippageBps: number;
  /** Move of the price by this order (last share against touch), signed bps. */
  readonly impactBps: number;
}

const SCALE = 1_000_000;

/** value of q (e6) at price (e4) in cents, half-even like `public.value_cents`. */
function valueCents(quantityE6: number, priceE4: number): number {
  const exact = (quantityE6 * priceE4) / 100_000_000;
  const floor = Math.floor(exact);
  if (Math.abs(exact - floor - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(exact);
}

/** ∫₀ˣ min(a·t, M) dt: the summed move of the first x shares. */
export function moveIntegral(x: number, slope: number, maxMove: number): number {
  if (slope <= 0) return 0;
  const k = maxMove / slope;
  return x <= k ? (slope * x * x) / 2 : maxMove * x - (maxMove * k) / 2;
}

function clampBand(input: FillPlanInput, priceE4: number): number {
  // the band only stops a move away from the quote: a sale never fills above the bid, a buy never below the ask
  const p =
    input.side === "sell"
      ? Math.min(input.touchE4, Math.max(input.bandLowE4 ?? priceE4, priceE4))
      : Math.max(input.touchE4, Math.min(input.bandHighE4 ?? priceE4, priceE4));
  return Math.max(input.minPriceE4, p);
}

/** Average fill price (e4) of q shares (e6). */
export function avgFillPriceE4(input: FillPlanInput, quantityE6: number): number {
  const dir = input.side === "buy" ? 1 : -1;
  const m = input.maxMoveBps / 10_000;
  const q = quantityE6 / SCALE;
  if (q <= 0) return input.touchE4;
  const x0 = input.pendingShares;
  const avgMove = (moveIntegral(x0 + q, input.slope, m) - moveIntegral(x0, input.slope, m)) / q;
  return clampBand(input, Math.round(input.touchE4 * (1 + dir * avgMove)));
}

/** Quantity (e6) whose gross (buy: plus fee) matches the amount, by bisection along the price path. */
export function quantityForAmountE6(input: FillPlanInput, amountCents: number): number {
  const target = input.side === "buy" ? amountCents - input.feeCents : amountCents;
  if (target <= 0) return 0;
  const gross = (qE6: number) => valueCents(qE6, avgFillPriceE4(input, qE6));
  let lo = 0;
  const floorPrice = input.side === "buy" ? input.touchE4 : input.touchE4 * (1 - input.maxMoveBps / 10_000);
  let hi = Math.ceil((target * 100_000_000) / Math.max(1, Math.min(floorPrice, input.bandLowE4 ?? floorPrice))) + 1;
  for (let i = 0; i < 200 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (gross(mid) <= target) lo = mid;
    else hi = mid;
  }
  // buy: never more than the amount; sell: at least the amount
  return input.side === "buy" ? lo : gross(lo) >= target ? lo : hi;
}

/** The fill plan of a market order. Every quantity fills completely. */
export function planMarketOrder(input: FillPlanInput): FillPlan {
  const quantityE6 = input.quantityE6 !== null ? input.quantityE6 : quantityForAmountE6(input, input.amountCents ?? 0);
  const dir = input.side === "buy" ? 1 : -1;
  const m = input.maxMoveBps / 10_000;
  const avgPriceE4 = avgFillPriceE4(input, quantityE6);
  const ownMove = Math.min(input.slope * (input.pendingShares + quantityE6 / SCALE), m);
  const lastPriceE4 = clampBand(input, Math.round(input.touchE4 * (1 + dir * ownMove)));
  const grossCents = quantityE6 > 0 ? valueCents(quantityE6, avgPriceE4) : 0;
  return {
    quantityE6,
    avgPriceE4,
    lastPriceE4,
    grossCents,
    netCents: quantityE6 > 0 ? grossCents + dir * input.feeCents : 0,
    slippageBps: Math.round((Math.abs(avgPriceE4 - input.touchE4) / input.touchE4) * 10_000),
    impactBps: Math.round(((lastPriceE4 - input.touchE4) / input.touchE4) * 10_000),
  };
}

/** Relative move per whole share of a stock (ADR-126): 1 % per `depthCentsPer100Bps` of value at the touch. */
export function stockSlope(
  touchE4: number,
  depthCentsPer100Bps: number,
  shareDepth: number,
  impactBpsPerDepth: number,
): number {
  const fromShares = impactBpsPerDepth / 10_000 / Math.max(1, shareDepth);
  return Math.max(fromShares, (0.01 * (touchE4 / 100)) / Math.max(1, depthCentsPer100Bps));
}
