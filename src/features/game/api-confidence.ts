import { z } from "zod";
import type { GameEngine, MarketMood, MarketMoodBase, StockConfidence } from "./types";
import { rpc } from "./rpc";

/*
 * Investor confidence and market mood (ADR-216): get_stock_confidence(p_ticker) for the stock page and the company,
 * get_market_mood() for the market overview. All numbers come from the server.
 */
const num = z.number();
const moodBaseSchema = z.object({
  mood: num,
  phase: z.enum(["bull", "calm", "bear"]),
  phase_started_at: z.string().nullable(),
  trend: num,
  history: z.array(num),
  sectors: z.array(z.object({ sector: z.string(), points: num })),
});
const stockConfidenceSchema = z.object({
  ticker: z.string(),
  confidence: num,
  target: num,
  trend: num,
  history: z.array(num),
  reasons: z.array(z.object({ key: z.string(), points: num })),
  market: moodBaseSchema,
  updated_at: z.string().nullable(),
});
const pick = z.object({ ticker: z.string(), name: z.string(), confidence: num });
const marketMoodSchema = moodBaseSchema.extend({
  avg_confidence: num,
  confident: num,
  stocks: num,
  leaders: z.array(pick),
  laggards: z.array(pick),
});

export const CONFIDENCE_RPC_SCHEMAS = {
  get_stock_confidence: stockConfidenceSchema,
  get_market_mood: marketMoodSchema,
} as const;

function toMoodBase(r: z.infer<typeof moodBaseSchema>): MarketMoodBase {
  return {
    mood: r.mood,
    phase: r.phase,
    phaseStartedAt: r.phase_started_at,
    trend: r.trend,
    history: r.history,
    sectors: r.sectors.map((s) => ({ sector: s.sector, points: s.points })),
  };
}

export function toStockConfidence(r: z.infer<typeof stockConfidenceSchema>): StockConfidence {
  return {
    ticker: r.ticker,
    confidence: r.confidence,
    target: r.target,
    trend: r.trend,
    history: r.history,
    reasons: r.reasons.map((x) => ({ key: x.key, points: x.points })),
    market: toMoodBase(r.market),
  };
}

export function toMarketMood(r: z.infer<typeof marketMoodSchema>): MarketMood {
  return {
    ...toMoodBase(r),
    avgConfidence: r.avg_confidence,
    confident: r.confident,
    stocks: r.stocks,
    leaders: r.leaders,
    laggards: r.laggards,
  };
}

export const liveConfidenceEngine: Pick<GameEngine, "stockConfidence" | "marketMood"> = {
  async stockConfidence(ticker) {
    return toStockConfidence(await rpc("get_stock_confidence", { p_ticker: ticker }, stockConfidenceSchema));
  },
  async marketMood() {
    return toMarketMood(await rpc("get_market_mood", {}, marketMoodSchema));
  },
};
