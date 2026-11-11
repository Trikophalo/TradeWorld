import { z } from "zod";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  GAME_ERROR_KEYS,
  GameError,
  type Candle,
  type GameEngine,
  type GameErrorKey,
  type MarketSnapshot,
  type OrderBook,
  type OrderResult,
  type Portfolio,
  type SecurityDetails,
} from "./types";

/*
 * Live engine: calls the Postgres RPCs (docs/DATA_MODEL.md, "M1 API") and
 * validates every response with Zod, so a server change shows up as a clear
 * error instead of a broken screen.
 */

const num = z.number();
const nnum = z.number().nullable();
const iso = z.string();

const securitySchema = z.object({
  id: z.string(),
  ticker: z.string(),
  name: z.string(),
  kind: z.enum(["stock", "bond"]),
  sector_key: z.string().nullable(),
  size_class: z.enum(["bluechip", "midcap", "penny"]).nullable(),
  last_price_e4: num,
  bid_e4: num,
  ask_e4: num,
  prev_close_e4: num,
  change_bps: num,
  day_high_e4: num,
  day_low_e4: num,
  day_volume: num,
  market_cap_cents: nnum,
  term_game_years: nnum.optional(),
  coupon_bps: nnum.optional(),
  yield_bps: nnum.optional(),
  matures_at: iso.nullable().optional(),
  face_value_cents: nnum.optional(),
});

const snapshotSchema = z.object({
  server_time: iso,
  tick_seq: num,
  session: z.enum(["regular", "after_hours"]),
  paused: z.boolean(),
  policy_rate_bps: num,
  index: z.object({ ticker: z.string(), name: z.string(), value_e4: num, prev_close_e4: num, change_bps: num }),
  securities: z.array(securitySchema),
});

const candleSchema = z.object({ t: num, o: num, h: num, l: num, c: num, v: num });
const levelSchema = z.object({ price_e4: num, quantity: num, players: num });
const bookSchema = z.object({ bids: z.array(levelSchema), asks: z.array(levelSchema) });

const detailsSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  market_cap_cents: nnum,
  shares_outstanding: nnum,
  pe_x100: nnum,
  dividend_yield_bps: nnum,
  revenue_cents: nnum,
  net_income_cents: nnum,
  margin_bps: nnum,
  news: z.array(z.object({ published_at: iso, headline: z.string(), body: z.string().nullable() })),
});

const portfolioSchema = z.object({
  cash_cents: num,
  reserved_cents: num,
  positions_value_cents: num,
  total_cents: num,
  loss_pot_cents: num,
  vault: z.object({
    accrued_cents: num,
    cap_cents: num,
    rate_cents_per_hour: num,
    last_claimed_at: iso.nullable(),
    full_at: iso,
    server_time: iso,
  }),
  positions: z.array(
    z.object({
      ticker: z.string(),
      name: z.string(),
      kind: z.enum(["stock", "bond"]),
      quantity: num,
      reserved_quantity: num,
      avg_price_e4: num,
      last_price_e4: num,
      market_value_cents: num,
      cost_basis_cents: num,
      unrealized_pnl_cents: num,
    }),
  ),
  open_orders: z.array(
    z.object({
      id: z.string(),
      ticker: z.string(),
      side: z.enum(["buy", "sell"]),
      type: z.enum(["market", "limit"]),
      quantity: num,
      filled_quantity: num,
      limit_price_e4: nnum,
      status: z.string(),
      created_at: iso,
    }),
  ),
  recent_trades: z.array(
    z.object({
      id: z.string(),
      ticker: z.string(),
      side: z.enum(["buy", "sell"]),
      quantity: num,
      price_e4: num,
      gross_cents: num,
      fee_cents: num,
      tax_cents: num,
      realized_pnl_cents: nnum,
      executed_at: iso,
    }),
  ),
  level: num.default(1),
  xp_total: num.default(0),
  xp_into_level: num.default(0),
  xp_for_next: num.default(0),
  tutorial_completed: z.boolean().default(false),
});

const orderResultSchema = z.object({
  order_id: z.string(),
  status: z.enum(["filled", "open", "partially_filled"]),
  filled_quantity: num,
  avg_price_e4: nnum,
  gross_cents: num,
  fee_cents: num,
  tax_cents: num,
  realized_pnl_cents: nnum,
  cash_cents: num,
  xp_awarded: num.default(0),
  level: num.default(1),
  xp_total: num.default(0),
});

const progressSchema = z.object({ xp_awarded: num, level: num, xp_total: num });

function toErrorKey(message: string | undefined): GameErrorKey {
  return (GAME_ERROR_KEYS as readonly string[]).includes(message ?? "") ? (message as GameErrorKey) : "unknown";
}

async function rpc<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new GameError("not_authenticated");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (process.env.NODE_ENV !== "production") console.warn(`[rpc ${fn}]`, error);
    throw new GameError(toErrorKey(error.message));
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error(`[rpc ${fn}] unexpected response`, parsed.error.issues.slice(0, 3));
    throw new GameError("unknown");
  }
  return parsed.data;
}

export const liveEngine: GameEngine = {
  async snapshot(): Promise<MarketSnapshot> {
    const s = await rpc("get_market_snapshot", {}, snapshotSchema);
    return {
      serverTime: s.server_time,
      tickSeq: s.tick_seq,
      session: s.session,
      paused: s.paused,
      policyRateBps: s.policy_rate_bps,
      index: {
        ticker: s.index.ticker,
        name: s.index.name,
        valueE4: s.index.value_e4,
        prevCloseE4: s.index.prev_close_e4,
        changeBps: s.index.change_bps,
      },
      securities: s.securities.map((x) => ({
        id: x.id,
        ticker: x.ticker,
        name: x.name,
        kind: x.kind,
        sector: (x.sector_key as MarketSnapshot["securities"][number]["sector"]) ?? null,
        sizeClass: x.size_class,
        lastE4: x.last_price_e4,
        bidE4: x.bid_e4,
        askE4: x.ask_e4,
        prevCloseE4: x.prev_close_e4,
        changeBps: x.change_bps,
        dayHighE4: x.day_high_e4,
        dayLowE4: x.day_low_e4,
        dayVolume: x.day_volume,
        marketCapCents: x.market_cap_cents,
        bond:
          x.kind === "bond" && x.term_game_years != null && x.matures_at
            ? {
                termGameYears: x.term_game_years,
                couponBps: x.coupon_bps ?? 0,
                yieldBps: x.yield_bps ?? 0,
                maturesAt: x.matures_at,
                faceValueCents: x.face_value_cents ?? 10_000,
              }
            : null,
      })),
    };
  },

  async candles(ticker, interval, limit): Promise<Candle[]> {
    const rows = await rpc(
      "get_candles",
      { p_ticker: ticker, p_interval: interval, p_limit: limit },
      z.array(candleSchema),
    );
    return rows.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
  },

  async orderBook(ticker, levels): Promise<OrderBook> {
    const b = await rpc("get_order_book", { p_ticker: ticker, p_levels: levels }, bookSchema);
    const map = (l: z.infer<typeof levelSchema>) => ({ priceE4: l.price_e4, quantity: l.quantity, players: l.players });
    return { bids: b.bids.map(map), asks: b.asks.map(map) };
  },

  async details(ticker): Promise<SecurityDetails> {
    const d = await rpc("get_security_details", { p_ticker: ticker }, detailsSchema);
    return {
      ticker: d.ticker,
      name: d.name,
      description: d.description,
      marketCapCents: d.market_cap_cents,
      sharesOutstanding: d.shares_outstanding,
      peX100: d.pe_x100,
      dividendYieldBps: d.dividend_yield_bps,
      revenueCents: d.revenue_cents,
      netIncomeCents: d.net_income_cents,
      marginBps: d.margin_bps,
      news: d.news.map((n) => ({ publishedAt: n.published_at, headline: n.headline, body: n.body })),
    };
  },

  async portfolio(): Promise<Portfolio> {
    const p = await rpc("get_my_portfolio", {}, portfolioSchema);
    return {
      cashCents: p.cash_cents,
      reservedCents: p.reserved_cents,
      positionsValueCents: p.positions_value_cents,
      totalCents: p.total_cents,
      lossPotCents: p.loss_pot_cents,
      vault: {
        accruedCents: p.vault.accrued_cents,
        capCents: p.vault.cap_cents,
        rateCentsPerHour: p.vault.rate_cents_per_hour,
        lastClaimedAt: p.vault.last_claimed_at,
        fullAt: p.vault.full_at,
        serverTime: p.vault.server_time,
      },
      positions: p.positions.map((x) => ({
        ticker: x.ticker,
        name: x.name,
        kind: x.kind,
        quantity: x.quantity,
        reservedQuantity: x.reserved_quantity,
        avgPriceE4: x.avg_price_e4,
        lastPriceE4: x.last_price_e4,
        marketValueCents: x.market_value_cents,
        costBasisCents: x.cost_basis_cents,
        unrealizedPnlCents: x.unrealized_pnl_cents,
      })),
      openOrders: p.open_orders.map((o) => ({
        id: o.id,
        ticker: o.ticker,
        side: o.side,
        type: o.type,
        quantity: o.quantity,
        filledQuantity: o.filled_quantity,
        limitPriceE4: o.limit_price_e4,
        status: o.status,
        createdAt: o.created_at,
      })),
      recentTrades: p.recent_trades.map((t) => ({
        id: t.id,
        ticker: t.ticker,
        side: t.side,
        quantity: t.quantity,
        priceE4: t.price_e4,
        grossCents: t.gross_cents,
        feeCents: t.fee_cents,
        taxCents: t.tax_cents,
        realizedPnlCents: t.realized_pnl_cents,
        executedAt: t.executed_at,
      })),
      level: p.level,
      xpTotal: p.xp_total,
      xpIntoLevel: p.xp_into_level,
      xpForNext: p.xp_for_next,
      tutorialCompleted: p.tutorial_completed,
    };
  },

  async placeOrder(input): Promise<OrderResult> {
    const r = await rpc(
      "place_order",
      {
        p_request_id: input.requestId,
        p_ticker: input.ticker,
        p_side: input.side,
        p_type: input.type,
        p_quantity: input.quantity,
        p_limit_price_e4: input.type === "limit" ? (input.limitPriceE4 ?? null) : null,
      },
      orderResultSchema,
    );
    return {
      orderId: r.order_id,
      status: r.status,
      filledQuantity: r.filled_quantity,
      avgPriceE4: r.avg_price_e4,
      grossCents: r.gross_cents,
      feeCents: r.fee_cents,
      taxCents: r.tax_cents,
      realizedPnlCents: r.realized_pnl_cents,
      cashCents: r.cash_cents,
      xpAwarded: r.xp_awarded,
      level: r.level,
      xpTotal: r.xp_total,
    };
  },

  async cancelOrder(requestId, orderId) {
    await rpc("cancel_order", { p_request_id: requestId, p_order_id: orderId }, z.object({ order_id: z.string() }));
  },

  async claimVault(requestId) {
    const r = await rpc("claim_vault", { p_request_id: requestId }, z.object({ claimed_cents: num, cash_cents: num }));
    return { claimedCents: r.claimed_cents, cashCents: r.cash_cents };
  },

  async completeTutorial(requestId) {
    const r = await rpc("complete_tutorial", { p_request_id: requestId }, progressSchema);
    return { xpAwarded: r.xp_awarded, level: r.level, xpTotal: r.xp_total };
  },
};
