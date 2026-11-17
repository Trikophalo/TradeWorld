/**
 * Market order fill plan (ADR-126, ADR-170, ADR-189). The same formula runs as `public.order_fill_plan()` in
 * Postgres; the order preview (`quote_order`) and the execution (`place_order`) both call it, so what the player sees
 * before confirming is what is executed.
 *
 * Price path: the n-th share costs `touch × (1 ± a × (pending + n))`, `a` = relative move per whole share. The
 * average price of q shares is `touch × (1 ± a × (pending + q / 2))` (the order pays half of the move it causes).
 *
 * Limits (ADR-189): the price of the last share may move at most `maxMoveBps` away from the touch price, and for
 * player stocks it stays inside the daily band. A market order fills only up to that point; the rest is not executed
 * and reported (`limitedBy`). Without this a 96.000 € sale of a penny stock filled at half the quote.
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
  readonly maxMoveBps: number;
  /** Daily band (player stocks) or null. */
  readonly bandLowE4: number | null;
  readonly bandHighE4: number | null;
  readonly minPriceE4: number;
}

export type FillLimit = "impact" | "band" | null;

export interface FillPlan {
  readonly requestedE6: number;
  readonly fillE6: number;
  readonly unfilledE6: number;
  readonly avgPriceE4: number;
  readonly lastPriceE4: number;
  readonly grossCents: number;
  /** Buy: gross + fee. Sell: gross − fee (before tax). */
  readonly netCents: number;
  /** Average price against the touch, in bps (≥ 0): what the order pays for its own move. */
  readonly slippageBps: number;
  /** Move of the price by this order (last share against touch), signed bps. */
  readonly impactBps: number;
  readonly limitedBy: FillLimit;
}

const SCALE = 1_000_000;

/** value of q (e6) at price (e4) in cents, half-even like `public.value_cents`. */
function valueCents(quantityE6: number, priceE4: number): number {
  const exact = (quantityE6 * priceE4) / 100_000_000;
  const floor = Math.floor(exact);
  const frac = exact - floor;
  if (Math.abs(frac - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(exact);
}

/** Average fill price (e4) of q shares (e6), never below the minimum price. */
export function avgFillPriceE4(input: FillPlanInput, quantityE6: number): number {
  const dir = input.side === "buy" ? 1 : -1;
  const p = input.touchE4 * (1 + dir * input.slope * (input.pendingShares + quantityE6 / SCALE / 2));
  return Math.max(input.minPriceE4, Math.round(p));
}

/** Largest quantity (e6) whose last share stays within the move cap and the band, and which bound binds first. */
export function maxFillE6(input: FillPlanInput): { readonly maxE6: number; readonly by: "impact" | "band" } {
  const dir = input.side === "buy" ? 1 : -1;
  const cap = input.maxMoveBps / 10_000;
  const capBound = input.touchE4 * (1 + dir * cap);
  const band = dir > 0 ? input.bandHighE4 : input.bandLowE4;
  let bound = capBound;
  let by: "impact" | "band" = "impact";
  if (band !== null && (dir > 0 ? band < capBound : band > capBound)) {
    bound = band;
    by = "band";
  }
  if (dir < 0 && input.minPriceE4 > bound) bound = input.minPriceE4;
  if (input.slope <= 0) return { maxE6: Number.MAX_SAFE_INTEGER, by };
  const move = dir * (bound / input.touchE4 - 1);
  const shares = move / input.slope - input.pendingShares;
  return { maxE6: Math.max(0, Math.floor(shares * SCALE)), by };
}

/** Quantity (e6) for an amount: solves the quadratic price path exactly. */
export function quantityForAmountE6(input: FillPlanInput, amountCents: number): number {
  const touchCents = input.touchE4 / 100; // cents per whole share
  const a = input.slope;
  const pos = input.pendingShares;
  if (input.side === "buy") {
    const net = amountCents - input.feeCents;
    if (net <= 0) return 0;
    // (a/2)·T·q² + T(1 + a·pos)·q − net = 0
    const A = (a / 2) * touchCents;
    const B = touchCents * (1 + a * pos);
    const q = A > 0 ? (-B + Math.sqrt(B * B + 4 * A * net)) / (2 * A) : net / B;
    return Math.max(0, Math.floor(q * SCALE));
  }
  // (a/2)·T·q² − T(1 − a·pos)·q + amount = 0, smaller root; no root: the most proceeds possible
  const A = (a / 2) * touchCents;
  const B = touchCents * (1 - a * pos);
  if (A <= 0) return Math.ceil((amountCents / B) * SCALE);
  const disc = B * B - 4 * A * amountCents;
  const q = disc >= 0 ? (B - Math.sqrt(disc)) / (2 * A) : B / (2 * A);
  return Math.max(0, Math.ceil(q * SCALE));
}

/** The fill plan of a market order. */
export function planMarketOrder(input: FillPlanInput): FillPlan {
  let requestedE6 = input.quantityE6 !== null ? input.quantityE6 : quantityForAmountE6(input, input.amountCents ?? 0);
  // A buy by amount never spends more than the amount: the average price is rounded to 0,0001 €.
  if (input.quantityE6 === null && input.side === "buy" && requestedE6 > 0) {
    const budget = (input.amountCents ?? 0) - input.feeCents;
    const gross = valueCents(requestedE6, avgFillPriceE4(input, requestedE6));
    if (gross > budget) requestedE6 = Math.floor((requestedE6 * budget) / gross);
  }
  const { maxE6, by } = maxFillE6(input);
  const fillE6 = Math.min(requestedE6, maxE6);
  const limitedBy: FillLimit = fillE6 < requestedE6 ? by : null;
  const dir = input.side === "buy" ? 1 : -1;
  const avgPriceE4 = fillE6 > 0 ? avgFillPriceE4(input, fillE6) : input.touchE4;
  const lastPriceE4 = Math.max(
    input.minPriceE4,
    Math.round(input.touchE4 * (1 + dir * input.slope * (input.pendingShares + fillE6 / SCALE))),
  );
  const grossCents = fillE6 > 0 ? valueCents(fillE6, avgPriceE4) : 0;
  return {
    requestedE6,
    fillE6,
    unfilledE6: requestedE6 - fillE6,
    avgPriceE4,
    lastPriceE4,
    grossCents,
    netCents: fillE6 > 0 ? grossCents + dir * input.feeCents : 0,
    slippageBps: Math.round((Math.abs(avgPriceE4 - input.touchE4) / input.touchE4) * 10_000),
    impactBps: Math.round(dir * input.slope * (fillE6 / SCALE) * 10_000),
    limitedBy,
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
