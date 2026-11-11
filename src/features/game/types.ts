/**
 * Client-side shapes of the game state. They mirror the JSON returned by the
 * Supabase RPCs (docs/DATA_MODEL.md, section "M1 API"), converted to camelCase.
 * Money is in cents, prices in e4 (euro × 10_000), rates in basis points.
 * Plain `number` is safe here: every value stays far below 2^53.
 */
import type { SectorKey } from "@/components/pixel/art";

export type SecurityKind = "stock" | "bond";
export type SizeClass = "bluechip" | "midcap" | "penny";
export type Session = "regular" | "after_hours";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type CandleInterval = "1m" | "5m" | "1h" | "1q" | "1y";

export interface Security {
  id: string;
  ticker: string;
  name: string;
  kind: SecurityKind;
  sector: SectorKey | null;
  sizeClass: SizeClass | null;
  lastE4: number;
  bidE4: number;
  askE4: number;
  prevCloseE4: number;
  changeBps: number;
  dayHighE4: number;
  dayLowE4: number;
  dayVolume: number;
  marketCapCents: number | null;
  bond: {
    termGameYears: number;
    couponBps: number;
    yieldBps: number;
    maturesAt: string;
    faceValueCents: number;
  } | null;
}

export interface MarketSnapshot {
  serverTime: string;
  tickSeq: number;
  session: Session;
  paused: boolean;
  policyRateBps: number;
  index: { ticker: string; name: string; valueE4: number; prevCloseE4: number; changeBps: number };
  securities: Security[];
}

export interface Candle {
  /** Unix seconds */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BookLevel {
  priceE4: number;
  quantity: number;
  players: number;
}

export interface OrderBook {
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface NewsItem {
  publishedAt: string;
  headline: string;
  body: string | null;
}

export interface SecurityDetails {
  ticker: string;
  name: string;
  description: string | null;
  marketCapCents: number | null;
  sharesOutstanding: number | null;
  peX100: number | null;
  dividendYieldBps: number | null;
  revenueCents: number | null;
  netIncomeCents: number | null;
  marginBps: number | null;
  news: NewsItem[];
}

export interface Position {
  ticker: string;
  name: string;
  kind: SecurityKind;
  quantity: number;
  reservedQuantity: number;
  avgPriceE4: number;
  lastPriceE4: number;
  marketValueCents: number;
  costBasisCents: number;
  unrealizedPnlCents: number;
}

export interface OpenOrder {
  id: string;
  ticker: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  filledQuantity: number;
  limitPriceE4: number | null;
  status: string;
  createdAt: string;
}

export interface Trade {
  id: string;
  ticker: string;
  side: OrderSide;
  quantity: number;
  priceE4: number;
  grossCents: number;
  feeCents: number;
  taxCents: number;
  realizedPnlCents: number | null;
  executedAt: string;
}

export interface Vault {
  accruedCents: number;
  capCents: number;
  rateCentsPerHour: number;
  lastClaimedAt: string | null;
  fullAt: string;
  serverTime: string;
}

export interface Portfolio {
  cashCents: number;
  reservedCents: number;
  positionsValueCents: number;
  totalCents: number;
  lossPotCents: number;
  vault: Vault;
  positions: Position[];
  openOrders: OpenOrder[];
  recentTrades: Trade[];
  level: number;
  xpTotal: number;
  xpIntoLevel: number;
  xpForNext: number;
  tutorialCompleted: boolean;
}

export interface OrderInput {
  requestId: string;
  ticker: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPriceE4?: number | null;
}

export interface OrderResult {
  orderId: string;
  status: "filled" | "open" | "partially_filled";
  filledQuantity: number;
  avgPriceE4: number | null;
  grossCents: number;
  feeCents: number;
  taxCents: number;
  realizedPnlCents: number | null;
  cashCents: number;
  xpAwarded: number;
  level: number;
  xpTotal: number;
}

export interface ProgressResult {
  xpAwarded: number;
  level: number;
  xpTotal: number;
}

/** Error keys the server raises (message of the Postgres exception). Texts: messages/de.json "errors". */
export const GAME_ERROR_KEYS = [
  "not_authenticated",
  "unknown_security",
  "not_tradable",
  "invalid_quantity",
  "invalid_price",
  "insufficient_funds",
  "insufficient_position",
  "order_not_found",
  "order_not_open",
  "rate_limited",
  "market_paused",
  "nothing_to_claim",
  "locked",
] as const;
export type GameErrorKey = (typeof GAME_ERROR_KEYS)[number] | "unknown";

export class GameError extends Error {
  constructor(public readonly key: GameErrorKey) {
    super(key);
    this.name = "GameError";
  }
}

/** Everything the game can do. Implemented by the live Supabase API and by the offline demo. */
export interface GameEngine {
  snapshot(): Promise<MarketSnapshot>;
  candles(ticker: string, interval: CandleInterval, limit: number): Promise<Candle[]>;
  orderBook(ticker: string, levels: number): Promise<OrderBook>;
  details(ticker: string): Promise<SecurityDetails>;
  portfolio(): Promise<Portfolio>;
  placeOrder(input: OrderInput): Promise<OrderResult>;
  cancelOrder(requestId: string, orderId: string): Promise<void>;
  claimVault(requestId: string): Promise<{ claimedCents: number; cashCents: number }>;
  completeTutorial(requestId: string): Promise<ProgressResult>;
}
