/**
 * Type model of the NEXA simulation.
 *
 * Conventions (ADR-003): money is `bigint` cents (`*Cents`), prices are `bigint`
 * with scale 1 EUR = 10 000 (`*E4`), rates are integer basis points (`*Bps`).
 * Model quantities without money character (quality, awareness, sentiment,
 * pressure, aggregated AI holdings) are `number`.
 */
import type {
  CompanyTierId,
  DepartmentId,
  InvestorArchetypeId,
  SectorId,
  SegmentId,
  SizeClass,
} from "../../config/balance.ts";

export type {
  CompanyTierId,
  DepartmentId,
  InvestorArchetypeId,
  SectorId,
  SegmentId,
  SizeClass,
} from "../../config/balance.ts";

// --------------------------------------------------------------------------- PRNG

/** Seedable pseudo random number generator. Never use `Math.random()` in the sim. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] (both inclusive). */
  int(min: number, max: number): number;
  /** Normally distributed value. */
  normal(mean?: number, stdDev?: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /**
   * Independent sub-stream that only depends on the root seed and `parts`,
   * not on how many numbers were already drawn from this generator.
   */
  derive(...parts: readonly (number | string)[]): Rng;
}

// ------------------------------------------------------------------------- market

export type MarketSession = "open" | "after_hours";

export const INVESTOR_ARCHETYPES: readonly InvestorArchetypeId[] = [
  "market_maker",
  "value_fund",
  "momentum_trader",
  "pension_fund",
  "index_fund",
  "retail_herd",
];

/** Aggregated position of one AI investor archetype in one security (ADR-005). */
export interface ArchetypeState {
  /** Net shares held (market maker: inventory, may be negative). */
  readonly holdingShares: number;
}

export type ArchetypeStates = Readonly<Record<InvestorArchetypeId, ArchetypeState>>;

/** Per-security market state carried from tick to tick. Service-role only (ADR-008). */
export interface SecurityState {
  readonly id: string;
  readonly sectorId: SectorId;
  readonly sizeClass: SizeClass;
  readonly priceE4: bigint;
  /** Fundamental anchor, recomputed at quarter close and on fundamental events. */
  readonly fairValueE4: bigint;
  readonly sharesOutstanding: bigint;
  readonly freeFloatShares: bigint;
  /** News and hype sentiment in [-1, 1], decays every tick. */
  readonly sentiment: number;
  /** Exponential moving averages of the price (in E4 units, as number). */
  readonly emaFastE4: number;
  readonly emaSlowE4: number;
  readonly dividendYieldBps: number;
  readonly inIndex: boolean;
  /** Trading halted (insolvency, pending IPO); the tick leaves the price untouched. */
  readonly halted: boolean;
  readonly archetypes: ArchetypeStates;
}

export interface MarketState {
  /** Monotonic tick counter. */
  readonly tick: number;
  readonly securities: readonly SecurityState[];
}

/** Net executed player order flow in one security since the previous tick. */
export interface PlayerFlow {
  readonly securityId: string;
  /** Buys minus sells in shares (negative = net selling). */
  readonly netShares: bigint;
  /** Buys plus sells in shares. */
  readonly volumeShares: bigint;
}

/** Exogenous shock applied in a tick (news, earnings, trial result, index change). */
export interface TickShock {
  readonly securityId: string;
  /** Added to the sentiment, result clamped to [-1, 1]. */
  readonly sentimentDelta?: number;
  /** Immediate simple return applied to the price (0.6 = +60 %, -0.6 = -60 %). */
  readonly priceReturn?: number;
}

export interface TickInputs {
  readonly nowMs: number;
  readonly session: MarketSession;
  readonly policyRateBps: number;
  readonly playerFlows: readonly PlayerFlow[];
  readonly shocks: readonly TickShock[];
}

export interface Quote {
  readonly bidE4: bigint;
  readonly askE4: bigint;
  readonly midE4: bigint;
  readonly halfSpreadBps: number;
}

export type InvestorPressures = Readonly<Record<InvestorArchetypeId, number>>;

/** Output row for the tables `ticks` and the broadcast (ADR-013). */
export interface TickRecord {
  readonly securityId: string;
  readonly tick: number;
  readonly timeMs: number;
  readonly priceE4: bigint;
  readonly bidE4: bigint;
  readonly askE4: bigint;
  /** Synthetic AI volume plus player volume. */
  readonly volumeShares: bigint;
  /** Net pressure in shares per archetype (telemetry, service-role only). */
  readonly pressures: InvestorPressures;
  /** Log return of this tick. */
  readonly logReturn: number;
}

export interface TickResult {
  readonly state: MarketState;
  readonly records: readonly TickRecord[];
}

export type BookSide = "bid" | "ask";

export interface OrderBookLevel {
  readonly side: BookSide;
  readonly priceE4: bigint;
  readonly quantity: bigint;
  /** `market_maker` levels are synthetic, `player` levels are real limit orders. */
  readonly source: "market_maker" | "player";
  /** Limit order id for player levels. */
  readonly orderId?: string;
}

export interface OrderBook {
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
}

export interface Fill {
  readonly priceE4: bigint;
  readonly quantity: bigint;
  readonly source: "market_maker" | "player";
  readonly orderId?: string;
}

export interface ExecutionResult {
  readonly fills: readonly Fill[];
  readonly filledQuantity: bigint;
  readonly unfilledQuantity: bigint;
  /** Sum of the fill values, each rounded half-even (ADR-003). */
  readonly valueCents: bigint;
  /** Volume weighted average price, 0 if nothing was filled. */
  readonly averagePriceE4: bigint;
}

export interface PriceTick {
  readonly timeMs: number;
  readonly priceE4: bigint;
  readonly volumeShares: bigint;
}

export interface Candle {
  readonly startMs: number;
  readonly openE4: bigint;
  readonly highE4: bigint;
  readonly lowE4: bigint;
  readonly closeE4: bigint;
  readonly volumeShares: bigint;
}

// -------------------------------------------------------------------------- macro

export type MacroEventKind = "sector_crisis" | "commodity_shock" | "recession" | "tech_boom";

/** A running macro effect that multiplies sector demand until it expires. */
export interface MacroEffect {
  readonly kind: MacroEventKind;
  /** `null` = all sectors. */
  readonly sectorId: SectorId | null;
  readonly demandFactor: number;
  readonly quartersRemaining: number;
}

export interface MacroState {
  /** Number of the quarter being closed (0-based, monotonically increasing). */
  readonly quarterIndex: number;
  readonly policyRateBps: number;
  /** Oil price index, 1 = baseline. */
  readonly oilIndex: number;
  /** Business cycle index, 1 = baseline. */
  readonly cycleIndex: number;
  readonly activeEffects: readonly MacroEffect[];
}

// ---------------------------------------------------------------------- companies

/** Aggregated capacity of one department, prepared by the caller from the employee rows. */
export interface DepartmentState {
  /** Sum of `effectiveSkillPoints()` of all employees (onboarding, traits, player bonus applied). */
  readonly effectiveSkillPoints: number;
  readonly payrollCents: bigint;
}

export interface ProductProject {
  readonly id: string;
  readonly quartersRemaining: number;
  /** Quality points added when the project completes. */
  readonly qualityGain: number;
}

export type CompanyStatus = "active" | "insolvent";

export interface LeadershipSkills {
  /** Skill 1..10 or 0 if the position is vacant. */
  readonly cfo: number;
  readonly cto: number;
  readonly coo: number;
  readonly headOfSales: number;
}

/** One company (AI or player) as seen by the quarter simulation. */
export interface CompanyState {
  readonly id: string;
  readonly sectorId: SectorId;
  readonly tier: CompanyTierId;
  readonly status: CompanyStatus;
  readonly isPlayerCompany: boolean;
  readonly founderId: string | null;
  /** Reputation 0..100 of the founder, `null` for AI companies. */
  readonly founderReputation: number | null;
  readonly listed: boolean;
  readonly cashCents: bigint;
  readonly debtCents: bigint;
  /** Annual (game year) interest rate on `debtCents`. */
  readonly loanRateBps: number;
  /** Equity at book value, used for leverage and the fair value floor. */
  readonly bookEquityCents: bigint;
  readonly sharesOutstanding: bigint;
  readonly quality: number;
  readonly awareness: number;
  readonly unitPriceCents: bigint;
  readonly fixedCostCents: bigint;
  readonly departments: Readonly<Record<DepartmentId, DepartmentState>>;
  readonly leadership: LeadershipSkills;
  readonly projects: readonly ProductProject[];
  /** Revenue guidance the founder gave for the quarter being closed, if any. */
  readonly guidanceRevenueCents: bigint | null;
  /** Consecutive quarters that ended with uncovered costs. */
  readonly uncoveredQuarters: number;
  readonly quartersActive: number;
  /** Oldest first, at most the last 8 quarters. */
  readonly revenueHistoryCents: readonly bigint[];
  readonly netIncomeHistoryCents: readonly bigint[];
  /** Multiplier on the fair value from binary events (pharma pipeline), 1 = neutral. */
  readonly eventValueFactor: number;
}

/** Decisions of the founder (or the AI policy) that apply at the quarter close. */
export interface QuarterDecision {
  readonly companyId: string;
  readonly unitPriceCents?: bigint;
  readonly marketingBudgetCents?: bigint;
  readonly dividendPerShareCents?: bigint;
  /** Guidance for the NEXT quarter. */
  readonly guidanceRevenueCents?: bigint | null;
}

export interface QuarterState {
  readonly macro: MacroState;
  readonly companies: readonly CompanyState[];
}

export interface SegmentQuarterResult {
  readonly segmentId: SegmentId;
  readonly demandCents: bigint;
  /** Revenue that went to the anonymous established suppliers of the segment. */
  readonly incumbentRevenueCents: bigint;
  /** Demand nobody could serve because every supplier was at capacity. */
  readonly unservedDemandCents: bigint;
}

export interface SectorQuarterResult {
  readonly sectorId: SectorId;
  /** Demand of the international segment (the sector figure shown in news and charts). */
  readonly demandCents: bigint;
  /** Unserved demand of the international segment. */
  readonly unservedDemandCents: bigint;
  readonly segments: readonly SegmentQuarterResult[];
}

export interface CompanyQuarterReport {
  readonly companyId: string;
  readonly quarterIndex: number;
  readonly segmentId: SegmentId;
  /** Demand of the company's segment in this quarter. */
  readonly segmentDemandCents: bigint;
  /** Realised share of the segment demand. */
  readonly marketShare: number;
  /** Share before the capacity cap (pure attractiveness share, incumbents included in the total). */
  readonly attractivenessShare: number;
  readonly unitsSold: number;
  readonly capacityUnits: number;
  readonly revenueCents: bigint;
  readonly productionCostCents: bigint;
  readonly payrollCents: bigint;
  readonly fixedCostCents: bigint;
  readonly marketingCents: bigint;
  readonly interestCents: bigint;
  readonly taxCents: bigint;
  readonly netIncomeCents: bigint;
  readonly dividendPerShareCents: bigint;
  readonly dividendTotalCents: bigint;
  readonly cashAfterCents: bigint;
  /** Trailing four quarter earnings per share in cents (may be negative). */
  readonly epsTtmCents: number;
  /** Relative deviation of revenue from guidance, `null` without guidance. */
  readonly guidanceDeviation: number | null;
  /** New fair value for listed companies, `null` otherwise. */
  readonly fairValueE4: bigint | null;
  /** Consecutive quarter closes with negative cash, including this one. */
  readonly uncoveredQuarters: number;
  /** Quarter closes left until insolvency if the cash stays negative; `null` while cash is positive. */
  readonly graceQuartersLeft: number | null;
  readonly becameInsolvent: boolean;
}

export type NewsScope = "market" | "sector" | "company";

/** A news item as data. Text comes from i18n templates keyed by `templateKey`. */
export interface NewsItem {
  readonly templateKey: string;
  readonly scope: NewsScope;
  readonly sectorId?: SectorId;
  readonly companyId?: string;
  /** Template variables, already formatted-neutral (numbers, ids, strings). */
  readonly vars: Readonly<Record<string, string | number>>;
  /** Sentiment shock handed to the next tick for the affected securities. */
  readonly sentimentDelta: number;
  /** 1 = routine, 3 = headline. */
  readonly importance: 1 | 2 | 3;
}

export type ReputationEventKind =
  "guidance_met" | "guidance_missed" | "reliable_dividend" | "dividend_cut" | "insolvency";

export interface ReputationEvent {
  readonly playerId: string;
  readonly companyId: string;
  readonly kind: ReputationEventKind;
  readonly delta: number;
}

export type XpEventKind = "profitable_company_quarter";

export interface XpEvent {
  readonly playerId: string;
  readonly kind: XpEventKind;
  readonly xp: number;
  readonly companyId?: string;
}

export interface QuarterResult {
  readonly state: QuarterState;
  readonly sectors: readonly SectorQuarterResult[];
  readonly reports: readonly CompanyQuarterReport[];
  readonly news: readonly NewsItem[];
  readonly reputationEvents: readonly ReputationEvent[];
  readonly xpEvents: readonly XpEvent[];
  /** Shocks for the first tick after the close (earnings surprises, macro events). */
  readonly shocks: readonly TickShock[];
}

// ------------------------------------------------------------------------- events

export type ScheduledEventKind = "rate_decision" | "earnings" | "pharma_trial" | "oil_report";

export interface ScheduledEvent {
  readonly kind: ScheduledEventKind;
  /** Quarter at whose close the event resolves. */
  readonly dueQuarterIndex: number;
  readonly companyId?: string;
}

export interface PharmaTrialResult {
  readonly success: boolean;
  /** Simple return applied to price and `eventValueFactor` (positive or negative). */
  readonly priceReturn: number;
}

// ------------------------------------------------------------------------- people

export interface EmployeeInput {
  readonly skill: number;
  readonly quartersEmployed: number;
  readonly traitKey: string | null;
  readonly isPlayer: boolean;
}

// -------------------------------------------------------------------------- index

export interface IndexCandidate {
  readonly securityId: string;
  readonly priceE4: bigint;
  readonly freeFloatShares: bigint;
  readonly listedQuarters: number;
  readonly isMember: boolean;
}

export interface IndexReview {
  readonly members: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
}
