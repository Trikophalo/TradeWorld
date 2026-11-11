/**
 * Client-side shapes of the game state. They mirror the JSON returned by the
 * Supabase RPCs (docs/DATA_MODEL.md, section "M1 API"), converted to camelCase.
 * Money is in cents, prices in e4 (euro × 10_000), share quantities in e6
 * (millionths, fractional shares, ADR-040), rates in basis points.
 * Plain `number` is safe for each value; products of quantity and price are
 * computed with BigInt (src/features/market/order-schema.ts).
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
  dayVolumeE6: number;
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
  /** Closed money system (ADR-041). Null in old server versions. */
  economy: { moneySupplyCents: number; treasuryCents: number; basicIncomeFactorBps: number } | null;
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
  quantityE6: number;
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
  quantityE6: number;
  reservedQuantityE6: number;
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
  quantityE6: number;
  filledQuantityE6: number;
  limitPriceE4: number | null;
  status: string;
  createdAt: string;
}

export interface Trade {
  id: string;
  ticker: string;
  side: OrderSide;
  quantityE6: number;
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
  /** Effective rate after the treasury factor. */
  rateCentsPerHour: number;
  /** Treasury factor on the basic income, 10_000 = full. */
  factorBps: number;
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
  nickname: string;
  /** When the next name change is possible; null = now. */
  nicknameChangeAvailableAt: string | null;
  missionsClaimable: number;
  streakDays: number;
}

/** Either a quantity (fractions allowed) or an amount in cents; the server works out the other. */
export interface OrderInput {
  requestId: string;
  ticker: string;
  side: OrderSide;
  type: OrderType;
  quantityE6?: number | null;
  amountCents?: number | null;
  limitPriceE4?: number | null;
}

export interface OrderResult {
  orderId: string;
  status: "filled" | "open" | "partially_filled";
  quantityE6: number;
  filledQuantityE6: number;
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

export interface RichListEntry {
  rank: number;
  kind: "player" | "tycoon";
  id: string;
  name: string;
  description: string | null;
  netWorthCents: number;
  change24hBps: number | null;
  rankChange24h: number | null;
  isMe: boolean;
}

export interface RichList {
  serverTime: string;
  total: number;
  entries: RichListEntry[];
  me: { rank: number; netWorthCents: number; next: { rank: number; name: string; gapCents: number } | null } | null;
}

export interface RichNews {
  publishedAt: string;
  headline: string;
  body: string | null;
  kind: string;
}

export type RichListScope = "all" | "players";

export type MissionKind = "quick" | "daily" | "weekly" | "milestone";

export interface Mission {
  id: string;
  key: string;
  title: string;
  description: string | null;
  progress: number;
  target: number;
  /** XP the player receives (multiplier already applied). */
  xp: number;
  status: "active" | "completed" | "claimed";
  expiresAt: string | null;
}

export interface MissionGroup {
  kind: MissionKind;
  resetsAt: string | null;
  missions: Mission[];
}

/** Client-only events that count for a few quick missions. */
export type TrackedEvent = "view_security" | "open_rich_list" | "open_rules";

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
  "invalid_argument",
  "invalid_interval",
  "forbidden",
  "order_too_small",
  "market_illiquid",
  "name_too_short",
  "name_too_long",
  "name_invalid_chars",
  "name_profanity",
  "name_reserved",
  "name_taken",
  "name_change_too_soon",
  "mission_not_found",
  "mission_not_completed",
  "mission_already_claimed",
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
  richList(scope: RichListScope, limit: number, offset: number): Promise<RichList>;
  richNews(limit: number): Promise<RichNews[]>;
  checkNickname(nickname: string): Promise<{ allowed: boolean; reason: GameErrorKey | null }>;
  changeNickname(requestId: string, nickname: string): Promise<{ nickname: string; nextChangeAt: string }>;
  missions(): Promise<MissionGroup[]>;
  claimMission(requestId: string, missionId: string): Promise<ProgressResult>;
  checkIn(requestId: string): Promise<ProgressResult & { streakDays: number; alreadyCheckedIn: boolean }>;
  track(event: TrackedEvent, ref?: string): Promise<void>;
}
