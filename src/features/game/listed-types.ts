import type { BoardMotionKind, LedgerCategory, ListedItemKind, ListedPurpose } from "@/config/listed";
import type { BooksStage, EffectTotals, ListedHourEffect, SatisfactionZone } from "@/lib/sim/listed";
import type { PriceLevel } from "@/lib/sim/startup";

/*
 * Listed player companies (ADR-167): what the company page needs for the tabs Dashboard, Controlling, Mitarbeiter,
 * Buchhaltung and Geschäftsrat. Names, descriptions and static values of the items live in the catalogue
 * (BALANCE.listed.items) and in messages (listed.items.*); the server sends the state and the current prices.
 */

/** `none`: not owned (or an action); `running`: the first level is in work; `paused`: the cash could not pay it. */
export type ListedItemStatus = "none" | "running" | "active" | "paused";

export interface ListedItemState {
  key: string;
  kind: ListedItemKind;
  status: ListedItemStatus;
  /** Finished levels (0 = not owned yet). */
  level: number;
  maxLevel: number;
  /** When the level in work is finished (also set while an owned machine gets its next level). */
  readyAt: string | null;
  /** Actions: when it can be used again. */
  cooldownUntil: string | null;
  /** Price of the next level now. */
  costCents: number;
  /** Research only (ADR-215): price and duration of the slow "Sparforschung"; null for other kinds. */
  slowCostCents: number | null;
  slowHours: number | null;
  /** Running cost per hour at the current (or first) level. */
  upkeepCents: number;
  /** Requirements that are not met yet (item keys). */
  missing: string[];
}

export interface ListedRestrictions {
  payoutCapBps: number | null;
  payoutCapUntil: string | null;
  withdrawBlockUntil: string | null;
  priceLock: PriceLevel | null;
  priceLockUntil: string | null;
}

export interface ListedBudget {
  purpose: ListedPurpose;
  amountCents: number;
}

export interface ListedDividend {
  id: number;
  source: "founder" | "board";
  totalCents: number;
  playersCents: number;
  floatCents: number;
  holders: number;
  paidAt: string;
}

export interface BooksReceipt {
  /** Position 1..n: the answers are given in this order. */
  id: number;
  /** Receipt template (messages: listed.receipts.<key>). */
  key: string;
  amountCents: number;
}

/** The open bookkeeping period. */
export interface ListedBooks {
  periodStart: string;
  revenueCents: number;
  /** Operating costs, investments included. */
  costsCents: number;
  profitCents: number;
  /** Net amount per category in the period (negative = money out). */
  byCategory: Partial<Record<LedgerCategory, number>>;
  lossCarryCents: number;
  rateBps: number;
  /** Tax without any discount if the books were closed now. */
  estimatedTaxCents: number;
  receipts: BooksReceipt[];
  receiptCategories: LedgerCategory[];
  /** Revenue in the period and not closed yet today. */
  canClose: boolean;
  doneToday: boolean;
  hoursOpen: number;
  /** `none`: no revenue yet. From `reminder` on the tax office is waiting. */
  stage: BooksStage;
  reminderAt: string;
  lateFeeAt: string;
  estimateAt: string;
  /** Berlin days in a row with closed books. */
  streak: number;
  lastDay: string | null;
}

export interface TaxPeriod {
  id: number;
  kind: "books" | "late_fee";
  periodStart: string;
  periodEnd: string;
  revenueCents: number;
  costsCents: number;
  profitCents: number;
  lossUsedCents: number;
  taxableCents: number;
  rateBps: number;
  discountCents: number;
  taxCents: number;
  penaltyCents: number;
  paidCents: number;
  status: "due" | "paid";
  closedBy: "founder" | "advisor" | "finanzamt";
  checkCorrect: number | null;
  /** 0 = in time, 1 = surcharge for paying late, 2 = collected by force. */
  stage: number;
  dueAt: string;
  paidAt: string | null;
}

export interface ListedTaxes {
  dueCents: number;
  rateBps: number;
  lossCarryCents: number;
  advisor: boolean;
  advisorWageCents: number;
  advisorDiscountBps: number;
  periods: TaxPeriod[];
}

export interface ListedHistoryPoint {
  at: string;
  satisfaction: number;
  reputation: number;
  demandFactor: number;
  capacityFactor: number;
  upkeepCents: number;
}

export interface ListedCompany {
  companyId: string;
  name: string;
  ticker: string | null;
  cashCents: number;
  unpaidCents: number;
  /** Earmarked by the board; not part of the free cash. */
  reservedCents: number;
  freeCashCents: number;
  /** Average revenue per hour the prices are derived from. */
  refRevenueCents: number;
  /** ADR-215: average profit per hour research is priced from (at least the minimum). */
  refProfitCents: number;
  /** Raw average profit per hour of the same window (may be negative): for "how many hours of profit". */
  avgProfitCents: number;
  /** Research steps started so far (each makes the next one a little dearer). */
  researchStarted: number;
  headcount: number;
  founderPayoutBps: number;
  reputation: {
    value: number;
    target: number;
    demandFactor: number;
    priceFactor: number;
    /** Founder payouts and withdrawals of the last day against the profit. */
    payoutRatioBps: number;
    /** Parts of the target: base, items, greed, reinvest, dividends, scandal. */
    drivers: Record<string, number>;
  };
  satisfaction: {
    value: number;
    target: number;
    zone: SatisfactionZone;
    green: number;
    red: number;
    capacityFactor: number;
    qualityAddBps: number;
    redHours: number;
    /** Parts of the target: base, benefits, wages, workload, crisis, layoffs, greed, success. */
    drivers: Record<string, number>;
  };
  /** Sum of the effects of all active items. */
  effects: EffectTotals;
  /** The terms the next operating hour runs with. */
  hour: ListedHourEffect;
  /** Running costs paid in the last hour, per books category. */
  upkeep: Partial<Record<LedgerCategory, number>>;
  upkeepPerHourCents: number;
  /** Every item of the catalogue, in catalogue order. */
  items: ListedItemState[];
  budgets: ListedBudget[];
  restrictions: ListedRestrictions;
  dividends: {
    maxCents: number;
    minCents: number;
    canDeclare: boolean;
    streak: number;
    totalE6: number;
    founderShareBps: number;
    last: ListedDividend[];
  };
  books: ListedBooks;
  taxes: ListedTaxes;
  history: ListedHistoryPoint[];
  board: { openMotions: number; toVote: number; myShareBps: number; canConvene: boolean };
}

// ------------------------------------------------------------------ accounting

export interface AccountingDay {
  /** Berlin day, YYYY-MM-DD. */
  day: string;
  inCents: number;
  outCents: number;
  /** Net of the operating categories (the day's taxable result). */
  operatingCents: number;
  byCategory: Partial<Record<LedgerCategory, number>>;
}

export interface AccountingEntry {
  id: number;
  at: string;
  amountCents: number;
  balanceAfterCents: number;
  description: string | null;
  category: LedgerCategory;
  /** Catalogue item the booking belongs to, if any. */
  item: string | null;
}

export interface CompanyAccounting {
  cashCents: number;
  from: string;
  days: AccountingDay[];
  totals: Partial<Record<LedgerCategory, number>>;
  entries: AccountingEntry[];
  /** Pass as `before` for the next page; null at the end. */
  nextBefore: number | null;
}

// ------------------------------------------------------------------ board

export type BoardMotionInput =
  | { kind: "earmark"; purpose: ListedPurpose; amountCents: number }
  | { kind: "release"; purpose: ListedPurpose }
  | { kind: "dividend"; amountCents: number }
  | { kind: "payout_cap"; bps: number; days: number }
  | { kind: "withdraw_ban"; days: number }
  | { kind: "price_level"; priceLevel: PriceLevel; days: number }
  | { kind: "debt"; amountCents: number };

export interface BoardMotion {
  id: number;
  kind: BoardMotionKind;
  params: { purpose?: ListedPurpose; amountCents?: number; bps?: number; days?: number; priceLevel?: PriceLevel };
  status: "open" | "passed" | "rejected" | "no_quorum" | "cancelled";
  /** Short German description from the server. */
  label: string;
  proposer: string | null;
  mine: boolean;
  createdAt: string;
  closesAt: string;
  closedAt: string | null;
  /** Shares (e6) for and against as counted last; aiE6 is the AI float's part of yes. */
  yesE6: number;
  noE6: number;
  aiE6: number;
  totalE6: number;
  myVote: "yes" | "no" | null;
  votes: { nickname: string; yes: boolean }[];
  /** What the passed motion did (amount_cents, until, total_cents). */
  result: Record<string, unknown>;
}

export interface CompanyBoard {
  company: { id: string; name: string; ticker: string | null; color: string | null };
  isFounder: boolean;
  totalE6: number;
  myE6: number;
  myShareBps: number;
  floatE6: number;
  minShareBps: number;
  /** More than minShareBps of the shares, no cooldown, room for another motion. */
  canConvene: boolean;
  canVote: boolean;
  reputation: number;
  /** The AI float currently votes yes on shareholder protection. */
  aiVotes: boolean;
  cashCents: number;
  freeCashCents: number;
  holders: { nickname: string; shareBps: number; isFounder: boolean; me: boolean }[];
  budgets: ListedBudget[];
  restrictions: ListedRestrictions;
  founderPayoutBps: number;
  motions: BoardMotion[];
  history: BoardMotion[];
}

// ------------------------------------------------------------------ engine

export interface ListedEngine {
  /** The own listed company; null while the company is private. */
  listedCompany(): Promise<ListedCompany | null>;
  /**
   * Buys or starts an item: research, product, region, machine level, acquisition, licence, benefit or action.
   * `slow`: research only, the cheaper and longer "Sparforschung" (ADR-215).
   */
  companyInvest(requestId: string, key: string, slow?: boolean): Promise<ListedCompany>;
  /** Retires a product, region, licence or benefit. */
  companyInvestStop(requestId: string, key: string): Promise<ListedCompany>;
  declareDividend(
    requestId: string,
    totalCents: number,
  ): Promise<{ listed: ListedCompany; dividend: { totalCents: number; playersCents: number; floatCents: number } }>;
  /** Closes the books: `answers` holds a category per receipt, in order; `pay` pays the tax at once. */
  closeCompanyBooks(
    requestId: string,
    answers: string[],
    pay: boolean,
  ): Promise<{ listed: ListedCompany; period: TaxPeriod; paidCents: number }>;
  payCompanyTax(requestId: string): Promise<{ listed: ListedCompany; paidCents: number }>;
  setTaxAdvisor(requestId: string, hire: boolean): Promise<ListedCompany>;
  companyAccounting(days?: number, before?: number | null): Promise<CompanyAccounting>;
  /** The board of a listed company the player founded or holds shares of (null = own company). */
  companyBoard(companyId?: string | null): Promise<CompanyBoard>;
  proposeBoardMotion(requestId: string, companyId: string | null, motion: BoardMotionInput): Promise<CompanyBoard>;
  voteBoardMotion(requestId: string, motionId: number, yes: boolean): Promise<CompanyBoard>;
}

/** Query key of the own listed company (TanStack Query): Mira and the company page share it. */
export const LISTED_COMPANY_KEY = ["company", "listed"] as const;
