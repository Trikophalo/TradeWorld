/**
 * Listed player companies (ADR-167): research, products, expansion, benefits, satisfaction, reputation, dividends,
 * the board, bookkeeping and taxes. Everything here applies only while companies.phase = 'listed'.
 *
 * Plain data, no imports: runs unchanged in Deno and is mirrored in Postgres (game_config.listed).
 */
export type ListedItemKind =
  "research" | "product" | "region" | "machine" | "acquisition" | "licence" | "benefit" | "action";
/** What a board budget may be spent on (ADR-167). */
export type ListedPurpose = "research" | "products" | "expansion" | "benefits" | "marketing";
export type ResearchBranch =
  "quality" | "efficiency" | "brand" | "automation" | "logistics" | "sustainability" | "finance";

/** Lasting effects of an item while it is active, per level. All optional, all additive across items. */
export interface ListedEffects {
  /** Demand, relative (bps). */
  readonly demandBps?: number;
  /** Market size, relative (bps); multiplies demand like demandBps, shown separately. */
  readonly marketBps?: number;
  /** Capacity, relative (bps). */
  readonly capacityBps?: number;
  /** Quality, absolute points (bps of 1). */
  readonly qualityBps?: number;
  /** Awareness, absolute points (bps of 1). */
  readonly awarenessBps?: number;
  /** Cost of goods, relative saving (bps). */
  readonly marginBps?: number;
  /** Fixed costs, relative change (bps, negative = cheaper). */
  readonly fixedCostBps?: number;
  /** Corporate tax rate, change in bps of the rate (negative = lower). */
  readonly taxRateBps?: number;
  /** Points on the satisfaction target. */
  readonly satisfaction?: number;
  /** Points on the reputation target. */
  readonly reputation?: number;
}

export interface ListedItem {
  readonly key: string;
  readonly kind: ListedItemKind;
  /** Research only: the branch of the tree and the step in it (1 = first). */
  readonly branch?: ResearchBranch;
  readonly tier?: number;
  /** The board budget that may pay for it. */
  readonly purpose: ListedPurpose;
  /** One-off price: max(minCostCents, costHours x reference revenue per hour) x costGrowth^level. */
  readonly costHours: number;
  readonly minCostCents: number;
  /** One-off price on top, per head (players and AI workers, at least one). */
  readonly costPerHeadCents?: number;
  /** Hours until it is active (research, development, building); 0 = at once. */
  readonly hours: number;
  /** Keys that must be active first. */
  readonly requires?: readonly string[];
  /** Machines: how often it can be bought (default 1); the price grows by costGrowth per level. */
  readonly maxLevel?: number;
  readonly costGrowth?: number;
  /** Running cost per hour: bps of the reference revenue per hour, per level. */
  readonly upkeepBps?: number;
  /** Running cost per hour and head. */
  readonly upkeepPerHeadCents?: number;
  /** Actions: hours until it can be used again, and the satisfaction points it adds at once. */
  readonly cooldownHours?: number;
  readonly boost?: number;
  readonly effects: ListedEffects;
}

const RESEARCH_TIERS = [
  { costHours: 6, minCostCents: 100_000, hours: 1 },
  { costHours: 18, minCostCents: 500_000, hours: 3 },
  { costHours: 48, minCostCents: 2_500_000, hours: 8 },
  { costHours: 120, minCostCents: 15_000_000, hours: 24 },
] as const;

/** One branch of the research tree: four steps, each needs the one before; the last one also a step elsewhere. */
function branch(
  name: ResearchBranch,
  purpose: ListedPurpose,
  effects: readonly [ListedEffects, ListedEffects, ListedEffects, ListedEffects],
  topNeeds: string,
): ListedItem[] {
  return effects.map((e, i) => ({
    key: `r_${name}_${i + 1}`,
    kind: "research" as const,
    branch: name,
    tier: i + 1,
    purpose,
    ...RESEARCH_TIERS[i]!,
    requires: i === 0 ? [] : i === 3 ? [`r_${name}_${i}`, topNeeds] : [`r_${name}_${i}`],
    effects: e,
  }));
}

const RESEARCH: ListedItem[] = [
  ...branch(
    "quality",
    "research",
    [{ qualityBps: 300 }, { qualityBps: 500 }, { qualityBps: 800 }, { qualityBps: 1_200, demandBps: 400 }],
    "r_efficiency_2",
  ),
  ...branch(
    "efficiency",
    "research",
    [{ marginBps: 200 }, { marginBps: 300 }, { marginBps: 500 }, { marginBps: 800, capacityBps: 500 }],
    "r_automation_2",
  ),
  ...branch(
    "brand",
    "marketing",
    [{ awarenessBps: 200 }, { awarenessBps: 300 }, { awarenessBps: 500 }, { awarenessBps: 500, demandBps: 800 }],
    "r_quality_2",
  ),
  ...branch(
    "automation",
    "research",
    [{ capacityBps: 500 }, { capacityBps: 800 }, { capacityBps: 1_200 }, { capacityBps: 2_000, marginBps: 300 }],
    "r_efficiency_2",
  ),
  ...branch(
    "logistics",
    "research",
    [
      { capacityBps: 300, marginBps: 100 },
      { marketBps: 500 },
      { fixedCostBps: -500 },
      { marketBps: 1_000, marginBps: 200 },
    ],
    "r_automation_2",
  ),
  ...branch(
    "sustainability",
    "research",
    [
      { reputation: 2 },
      { reputation: 3, marginBps: 100 },
      { reputation: 3, satisfaction: 3 },
      { reputation: 5, demandBps: 500 },
    ],
    "r_brand_2",
  ),
  ...branch(
    "finance",
    "research",
    [{ taxRateBps: -100 }, { fixedCostBps: -300 }, { taxRateBps: -150 }, { taxRateBps: -150, marginBps: 300 }],
    "r_logistics_2",
  ),
];

const PRODUCTS: ListedItem[] = [
  {
    key: "p_second",
    kind: "product",
    purpose: "products",
    costHours: 12,
    minCostCents: 300_000,
    hours: 2,
    upkeepBps: 150,
    effects: { demandBps: 800 },
  },
  {
    key: "p_budget",
    kind: "product",
    purpose: "products",
    costHours: 16,
    minCostCents: 400_000,
    hours: 3,
    requires: ["r_efficiency_1"],
    upkeepBps: 200,
    effects: { demandBps: 1_200, qualityBps: -200 },
  },
  {
    key: "p_premium",
    kind: "product",
    purpose: "products",
    costHours: 30,
    minCostCents: 1_000_000,
    hours: 6,
    requires: ["r_quality_2"],
    upkeepBps: 300,
    effects: { demandBps: 1_000, qualityBps: 400 },
  },
  {
    key: "p_subscription",
    kind: "product",
    purpose: "products",
    costHours: 36,
    minCostCents: 1_500_000,
    hours: 8,
    requires: ["r_brand_1", "p_second"],
    upkeepBps: 350,
    effects: { demandBps: 1_800 },
  },
  {
    key: "p_merch",
    kind: "product",
    purpose: "products",
    costHours: 8,
    minCostCents: 200_000,
    hours: 2,
    requires: ["r_brand_2"],
    upkeepBps: 100,
    effects: { demandBps: 400, awarenessBps: 200 },
  },
  {
    key: "p_enterprise",
    kind: "product",
    purpose: "products",
    costHours: 80,
    minCostCents: 6_000_000,
    hours: 16,
    requires: ["r_quality_3", "p_premium"],
    upkeepBps: 500,
    effects: { demandBps: 3_000 },
  },
];

const REGIONS: ListedItem[] = [
  {
    key: "g_south",
    kind: "region",
    purpose: "expansion",
    costHours: 20,
    minCostCents: 600_000,
    hours: 4,
    upkeepBps: 200,
    effects: { marketBps: 1_000 },
  },
  {
    key: "g_dach",
    kind: "region",
    purpose: "expansion",
    costHours: 40,
    minCostCents: 2_000_000,
    hours: 8,
    requires: ["g_south"],
    upkeepBps: 300,
    effects: { marketBps: 1_500 },
  },
  {
    key: "g_europe",
    kind: "region",
    purpose: "expansion",
    costHours: 80,
    minCostCents: 6_000_000,
    hours: 12,
    requires: ["g_dach", "l_export"],
    upkeepBps: 400,
    effects: { marketBps: 2_500 },
  },
  {
    key: "g_america",
    kind: "region",
    purpose: "expansion",
    costHours: 140,
    minCostCents: 15_000_000,
    hours: 24,
    requires: ["g_europe", "r_logistics_2"],
    upkeepBps: 500,
    effects: { marketBps: 3_500 },
  },
  {
    key: "g_asia",
    kind: "region",
    purpose: "expansion",
    costHours: 200,
    minCostCents: 30_000_000,
    hours: 36,
    requires: ["g_america", "r_logistics_4"],
    upkeepBps: 600,
    effects: { marketBps: 5_000 },
  },
];

const MACHINES: ListedItem[] = [
  {
    key: "m_machines",
    kind: "machine",
    purpose: "expansion",
    costHours: 10,
    minCostCents: 300_000,
    hours: 2,
    maxLevel: 5,
    costGrowth: 1.6,
    upkeepBps: 50,
    effects: { capacityBps: 400 },
  },
  {
    key: "m_datacenter",
    kind: "machine",
    purpose: "expansion",
    costHours: 14,
    minCostCents: 500_000,
    hours: 3,
    maxLevel: 3,
    costGrowth: 1.8,
    upkeepBps: 60,
    effects: { marginBps: 150, capacityBps: 200 },
  },
  {
    key: "m_showroom",
    kind: "machine",
    purpose: "marketing",
    costHours: 12,
    minCostCents: 400_000,
    hours: 3,
    maxLevel: 3,
    costGrowth: 1.7,
    upkeepBps: 60,
    effects: { awarenessBps: 200, demandBps: 150 },
  },
];

const ACQUISITIONS: ListedItem[] = [
  {
    key: "a_kleinhirn",
    kind: "acquisition",
    purpose: "expansion",
    costHours: 90,
    minCostCents: 8_000_000,
    hours: 6,
    requires: ["r_automation_2"],
    upkeepBps: 200,
    effects: { capacityBps: 1_000, qualityBps: 300 },
  },
  {
    key: "a_datenkrake",
    kind: "acquisition",
    purpose: "expansion",
    costHours: 110,
    minCostCents: 10_000_000,
    hours: 6,
    requires: ["r_brand_2"],
    upkeepBps: 250,
    effects: { demandBps: 1_500 },
  },
  {
    key: "a_robobutze",
    kind: "acquisition",
    purpose: "expansion",
    costHours: 130,
    minCostCents: 12_000_000,
    hours: 8,
    requires: ["r_efficiency_3"],
    upkeepBps: 200,
    effects: { marginBps: 600, capacityBps: 500 },
  },
];

const LICENCES: ListedItem[] = [
  {
    key: "l_patent",
    kind: "licence",
    purpose: "research",
    costHours: 10,
    minCostCents: 300_000,
    hours: 1,
    upkeepBps: 100,
    effects: { qualityBps: 500 },
  },
  {
    key: "l_brand",
    kind: "licence",
    purpose: "marketing",
    costHours: 10,
    minCostCents: 300_000,
    hours: 1,
    upkeepBps: 120,
    effects: { demandBps: 600 },
  },
  {
    key: "l_export",
    kind: "licence",
    purpose: "expansion",
    costHours: 15,
    minCostCents: 500_000,
    hours: 2,
    upkeepBps: 50,
    effects: {},
  },
];

/** Benefits: a small setup price, then a running cost per head and hour; they lift the satisfaction target. */
function benefit(
  key: string,
  minCostCents: number,
  upkeepPerHeadCents: number,
  satisfaction: number,
  more: ListedEffects = {},
): ListedItem {
  return {
    key,
    kind: "benefit",
    purpose: "benefits",
    costHours: 0,
    minCostCents,
    hours: 0,
    upkeepPerHeadCents,
    effects: { satisfaction, ...more },
  };
}

const BENEFITS: ListedItem[] = [
  benefit("b_obstkorb", 5_000, 40, 3),
  benefit("b_kaffee", 8_000, 50, 3),
  benefit("b_tischkicker", 60_000, 10, 2),
  benefit("b_hundebuero", 10_000, 20, 2),
  benefit("b_massagesessel", 150_000, 20, 2),
  benefit("b_jobrad", 20_000, 120, 3),
  benefit("b_fitness", 30_000, 150, 4),
  benefit("b_homeoffice", 50_000, 100, 5),
  benefit("b_weiterbildung", 40_000, 250, 4, { qualityBps: 200 }),
  benefit("b_feelgood", 100_000, 300, 5),
  benefit("b_betriebsrente", 80_000, 400, 6),
  benefit("b_kita", 500_000, 500, 7),
  benefit("b_bonus", 0, 900, 8, { capacityBps: 300 }),
  benefit("b_viertagewoche", 200_000, 300, 10, { capacityBps: -600 }),
];

/** One-off actions: paid at once, the satisfaction jumps and then drifts back. */
function action(
  key: string,
  minCostCents: number,
  costPerHeadCents: number,
  boost: number,
  cooldownHours: number,
): ListedItem {
  return {
    key,
    kind: "action",
    purpose: "benefits",
    costHours: 0,
    minCostCents,
    costPerHeadCents,
    hours: 0,
    cooldownHours,
    boost,
    effects: {},
  };
}

const ACTIONS: ListedItem[] = [
  action("x_pizza", 5_000, 1_500, 3, 6),
  action("x_teamevent", 30_000, 6_000, 8, 24),
  action("x_firmenfeier", 100_000, 12_000, 12, 72),
  action("x_sonderbonus", 0, 50_000, 15, 48),
];

export const LISTED_ITEMS: readonly ListedItem[] = [
  ...RESEARCH,
  ...PRODUCTS,
  ...REGIONS,
  ...MACHINES,
  ...ACQUISITIONS,
  ...LICENCES,
  ...BENEFITS,
  ...ACTIONS,
];

/** The categories of the company's books (ADR-167). Operating ones count for the taxable profit. */
export const LEDGER_CATEGORIES = [
  "revenue",
  "goods",
  "wages",
  "fixed",
  "research",
  "product",
  "expansion",
  "benefit",
  "advisor",
  "costs",
  "capital",
  "payout",
  "dividend",
  "tax",
  "penalty",
  "transfer",
] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];
export const OPERATING_CATEGORIES: readonly LedgerCategory[] = [
  "revenue",
  "goods",
  "wages",
  "fixed",
  "research",
  "product",
  "expansion",
  "benefit",
  "advisor",
  "costs",
];

export const BOARD_MOTION_KINDS = [
  "earmark",
  "release",
  "dividend",
  "payout_cap",
  "withdraw_ban",
  "price_level",
  "debt",
] as const;
export type BoardMotionKind = (typeof BOARD_MOTION_KINDS)[number];
export const LISTED_PURPOSES: readonly ListedPurpose[] = ["research", "products", "expansion", "benefits", "marketing"];

export const LISTED_RULES = {
  /** Prices follow the company's size: the average revenue per hour of the last hours, never below the minimum. */
  refRevenue: { windowHours: 24, minCents: 20_000 },
  satisfaction: {
    /** A fresh listing starts exactly at the green line: the first hour is neutral. */
    start: 60,
    /** Where it drifts without spending: below the green zone. */
    base: 50,
    adjustPerHour: 0.15,
    green: 60,
    red: 35,
    benefitsMax: 40,
    /** Wages not paid in full (pay factor), and cut by crises or a falling share (wage mood). */
    wages: { unpaidMaxLoss: 25, moodMaxLoss: 10 },
    /** Capacity use = demand / capacity: overtime above overFrom, idling below underBelow. */
    workload: { overFrom: 0.95, overFull: 1.5, overMaxLoss: 12, underBelow: 0.35, underLoss: 4 },
    crisis: { perSeverity: 4, scandal: 6, scandals: ["quality_scandal", "data_breach", "tax_audit"] },
    /** Dismissed AI workers and fired players: points per head, fading every hour. */
    layoffs: { perHead: 3, max: 15, decayPerHour: 0.08 },
    greedMaxLoss: 10,
    success: { profitHour: 3, lossHour: -3 },
    effect: {
      /** At 0 satisfaction: this share of the capacity and this much quality (absolute) are gone. */
      lowCapacityMaxLoss: 0.3,
      lowQualityMaxLoss: 0.15,
      /** From green up to highFull: up to this much extra capacity. */
      highCapacityMaxGain: 0.06,
      highFull: 90,
    },
    /** Below red: an AI worker leaves every N hours in red; players are told at most once per interval. */
    quits: { everyRedHours: 3, notifyEveryHours: 24, massQuitFrom: 3 },
  },
  reputation: {
    start: 50,
    base: 50,
    adjustPerHour: 0.08,
    windowHours: 24,
    /** Payouts are measured against the profit, at least this share of the revenue (no profit, no free payout). */
    minProfitShareOfRevenue: 0.05,
    /** Founder payouts and withdrawals over the window / profit: free up to freeRatioBps, full loss at fullRatioBps. */
    greed: { freeRatioBps: 3_000, fullRatioBps: 10_000, maxLoss: 35, feedBelow: 35 },
    /** One-off investments over the window / profit. */
    reinvest: { fullRatioBps: 5_000, maxGain: 12 },
    /** Dividends over the window / profit, plus a bonus per day in a row with a dividend. */
    dividend: { fullRatioBps: 2_000, maxGain: 12, streakPerDay: 1, streakMax: 6 },
    /** One-off drops for trouble with the tax office. */
    penalty: { lateFee: 3, estimate: 6, enforcement: 8 },
    scandalLoss: 5,
    /** At 0 / 100 reputation: demand and the fair share price move by this share. */
    demandMaxEffect: 0.2,
    priceMaxEffect: 0.25,
  },
  dividends: { perDay: 1, maxShareOfFreeCashBps: 5_000, minTotalCents: 10_000, historyLimit: 20 },
  board: {
    /** More than this share of all shares is needed to bring a motion. */
    minShareBps: 2_000,
    voteHours: 12,
    /** Votes cast (players and the AI float, when it votes) / all shares. */
    quorumBps: 3_000,
    maxOpen: 2,
    cooldownHours: 6,
    maxDays: 7,
    earmarkMaxShareOfCashBps: 8_000,
    payoutCapStepBps: 500,
    /** The AI float votes yes on these kinds while the reputation is below the threshold, otherwise it abstains. */
    aiVote: { reputationBelow: 40, kinds: ["payout_cap", "withdraw_ban", "dividend"] },
    kinds: BOARD_MOTION_KINDS,
    purposes: LISTED_PURPOSES,
    historyLimit: 20,
  },
  taxes: {
    /** Corporate tax on the taxable profit of a bookkeeping period. */
    rateBps: 1_500,
    minRateBps: 800,
    /** Hours since the open period began (with revenue in it). */
    reminderAfterHours: 30,
    lateFeeAfterHours: 42,
    estimateAfterHours: 60,
    lateFee: { minCents: 5_000, revenueBps: 50 },
    /** The tax office estimates: at least this margin on the revenue, plus a surcharge on the tax. */
    estimate: { marginBps: 2_500, surchargeBps: 2_500 },
    payWithinHours: 24,
    latePaymentBps: 500,
    enforceAfterHours: 48,
    enforcementBps: 1_000,
    /** The small check when closing the books: receipts to sort, tax discount when all are right. */
    check: { receipts: 3, discountBps: 500 },
    /** Tax advisor: hourly wage max(minWage, revenueBps of the reference revenue); books and payment on time. */
    advisor: { minWageCentsPerHour: 4_000, revenueBps: 100, discountBps: 800 },
    auditArchetype: "tax_audit",
    receipts: [
      { key: "customer_invoice", category: "revenue" },
      { key: "online_shop_payout", category: "revenue" },
      { key: "raw_material", category: "goods" },
      { key: "packaging", category: "goods" },
      { key: "payslip", category: "wages" },
      { key: "overtime", category: "wages" },
      { key: "office_rent", category: "fixed" },
      { key: "electricity", category: "fixed" },
      { key: "lab_equipment", category: "research" },
      { key: "prototype", category: "research" },
      { key: "fruit_basket", category: "benefit" },
      { key: "team_dinner", category: "benefit" },
    ],
    receiptCategories: ["revenue", "goods", "wages", "fixed", "research", "benefit"],
    historyLimit: 30,
  },
  historyHours: 72,
  accountingPageSize: 50,
  items: LISTED_ITEMS,
} as const;

export type ListedRules = typeof LISTED_RULES;
