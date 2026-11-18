/**
 * Listed player companies (ADR-167): what research, products, regions, machines and benefits cost and bring, how
 * employee satisfaction and reputation move, dividends, the board's votes, bookkeeping and corporate tax.
 *
 * Pure: no clock, no randomness, numbers in, numbers out. The database runs the same formulas in PL/pgSQL
 * (listed_* functions); the demo and the UI use these. Money is whole cents (numbers: company amounts stay far
 * below 2^53).
 */
import { BALANCE } from "../../config/balance.ts";
import type { BoardMotionKind, LedgerCategory, ListedEffects, ListedItem, ListedRules } from "../../config/listed.ts";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const RULES: ListedRules = BALANCE.listed;

export type ListedItemStatus = "running" | "active" | "paused" | "retired";
/** An item the company owns: only `active` ones have an effect. */
export interface OwnedItem {
  readonly key: string;
  readonly status: ListedItemStatus;
  readonly level: number;
}

export function itemByKey(key: string, cfg: ListedRules = RULES): ListedItem | undefined {
  return cfg.items.find((i) => i.key === key);
}

// ------------------------------------------------------------------ prices

/** The company's size for prices: average revenue per hour of the last hours, never below the minimum. */
export function refRevenueCents(hourRevenuesCents: readonly number[], cfg: ListedRules = RULES): number {
  const hours = hourRevenuesCents.slice(-cfg.refRevenue.windowHours);
  const avg = hours.length > 0 ? hours.reduce((s, r) => s + r, 0) / hours.length : 0;
  return Math.max(cfg.refRevenue.minCents, Math.round(avg));
}

/** Raw average operating profit per hour of the research window (may be negative; 0 without hours). */
export function avgProfitCents(hourProfitsCents: readonly number[], cfg: ListedRules = RULES): number {
  const hours = hourProfitsCents.slice(-cfg.research.refProfit.windowHours);
  return hours.length > 0 ? Math.round(hours.reduce((s, p) => s + p, 0) / hours.length) : 0;
}

/** The earnings capacity research is priced from (ADR-215): average profit per hour, never below the minimum. */
export function refProfitCents(hourProfitsCents: readonly number[], cfg: ListedRules = RULES): number {
  return Math.max(cfg.research.refProfit.minCents, avgProfitCents(hourProfitsCents, cfg));
}

/**
 * Price of a research step (ADR-215): profitHoursByTier x reference profit, grown by every research step started so
 * far, at least the floor of the tier, never more than maxProfitHours of reference profit. Slow: costBps of it.
 */
export function researchCostCents(
  item: ListedItem,
  refProfit: number,
  researchStarted: number,
  slow = false,
  cfg: ListedRules = RULES,
): number {
  const r = cfg.research;
  const i = clamp(Math.floor(item.tier ?? 1), 1, r.profitHoursByTier.length) - 1;
  const p = Math.max(r.refProfit.minCents, refProfit);
  const hours =
    r.profitHoursByTier[i]! * (1 + (r.growthPerDoneBps * Math.max(0, Math.floor(researchStarted))) / 10_000);
  const full = Math.round(Math.min(r.maxProfitHours * p, Math.max(r.minCostCentsByTier[i]!, hours * p)));
  return slow ? Math.floor((full * r.slow.costBps) / 10_000) : full;
}

/** Duration of a research step in hours; slow research takes hoursFactor times as long. */
export function researchHours(item: ListedItem, slow = false, cfg: ListedRules = RULES): number {
  return slow ? item.hours * cfg.research.slow.hoursFactor : item.hours;
}

/** How many hours of the average profit a price is (null without profit). */
export function profitHoursOf(costCents: number, avgProfitPerHourCents: number): number | null {
  return avgProfitPerHourCents > 0 ? costCents / avgProfitPerHourCents : null;
}

/**
 * Hours until the company can pay `costCents` from what it may spend now plus its average profit (0 = now, null =
 * not without profit).
 */
export function affordableInHours(
  costCents: number,
  spendableCents: number,
  avgProfitPerHourCents: number,
): number | null {
  const gap = costCents - Math.max(0, spendableCents);
  if (gap <= 0) return 0;
  return avgProfitPerHourCents > 0 ? Math.ceil(gap / avgProfitPerHourCents) : null;
}

const heads = (headcount: number) => Math.max(1, Math.floor(headcount));

/** One-off price of the next level of an item (`level` = levels owned so far, 0 for the first). */
export function itemCostCents(item: ListedItem, level: number, refCents: number, headcount: number): number {
  const base = Math.max(item.minCostCents, item.costHours * refCents);
  const grown = Math.round(base * Math.pow(item.costGrowth ?? 1, Math.max(0, Math.floor(level))));
  return grown + (item.costPerHeadCents ?? 0) * heads(headcount);
}

/** Running cost per hour of an item at `level` (at least 1). */
export function itemUpkeepCents(item: ListedItem, level: number, refCents: number, headcount: number): number {
  const perLevel = Math.round(((item.upkeepBps ?? 0) * refCents) / 10_000);
  return perLevel * Math.max(1, Math.floor(level)) + (item.upkeepPerHeadCents ?? 0) * heads(headcount);
}

/** Requirements of an item that are not active yet. */
export function missingRequirements(item: ListedItem, owned: readonly OwnedItem[]): string[] {
  const active = new Set(
    owned.filter((o) => (o.status === "active" || o.status === "paused") && o.level > 0).map((o) => o.key),
  );
  return (item.requires ?? []).filter((key) => !active.has(key));
}

/** Whether the item can be started now: known, requirements met, not running, below its top level. */
export function canStartItem(item: ListedItem, owned: readonly OwnedItem[]): boolean {
  const mine = owned.find((o) => o.key === item.key);
  if (missingRequirements(item, owned).length > 0) return false;
  if (!mine || mine.status === "retired") return true;
  if (item.kind === "action") return true;
  return mine.status === "active" && mine.level < (item.maxLevel ?? 1);
}

// ------------------------------------------------------------------ effects

export type EffectTotals = Required<ListedEffects>;

/** Sum of the effects of all active items (per level). */
export function sumEffects(owned: readonly OwnedItem[], cfg: ListedRules = RULES): EffectTotals {
  const total: { -readonly [K in keyof EffectTotals]: number } = {
    demandBps: 0,
    marketBps: 0,
    capacityBps: 0,
    qualityBps: 0,
    awarenessBps: 0,
    marginBps: 0,
    fixedCostBps: 0,
    taxRateBps: 0,
    satisfaction: 0,
    reputation: 0,
  };
  for (const o of owned) {
    if (o.status !== "active") continue;
    const item = itemByKey(o.key, cfg);
    if (!item) continue;
    const level = Math.max(1, Math.floor(o.level));
    for (const [k, v] of Object.entries(item.effects)) total[k as keyof EffectTotals] += (v ?? 0) * level;
  }
  return total;
}

// ------------------------------------------------------------------ satisfaction

export interface SatisfactionInput {
  /** Satisfaction points of the active benefits and research. */
  readonly benefitPoints: number;
  /** Share of the wages paid in the hour (10 000 = all). */
  readonly payFactorBps: number;
  /** Wage factor from crises and a falling share price (ADR-131), 10 000 = full. */
  readonly payMoodBps: number;
  /** Demand / capacity of the hour. */
  readonly utilization: number;
  /** Severity of the open crisis (0 = none) and whether it is a scandal. */
  readonly crisisSeverity: number;
  readonly scandal: boolean;
  /** Points from recent dismissals (already faded). */
  readonly layoffHeat: number;
  /** Founder payouts / profit of the last day, in bps. */
  readonly payoutRatioBps: number;
  readonly profitCents: number;
}

export interface SatisfactionDrivers {
  readonly base: number;
  readonly benefits: number;
  readonly wages: number;
  readonly workload: number;
  readonly crisis: number;
  readonly layoffs: number;
  readonly greed: number;
  readonly success: number;
}

/** Share (0..1) of the greed penalty: nothing up to freeRatioBps, everything from fullRatioBps. */
export function greedShare(payoutRatioBps: number, cfg: ListedRules = RULES): number {
  const g = cfg.reputation.greed;
  return clamp((payoutRatioBps - g.freeRatioBps) / Math.max(1, g.fullRatioBps - g.freeRatioBps), 0, 1);
}

/** Where the satisfaction is heading this hour, and why. */
export function satisfactionTarget(
  input: SatisfactionInput,
  cfg: ListedRules = RULES,
): { target: number; drivers: SatisfactionDrivers } {
  const s = cfg.satisfaction;
  const w = s.workload;
  const over = clamp((input.utilization - w.overFrom) / Math.max(0.0001, w.overFull - w.overFrom), 0, 1);
  const drivers: SatisfactionDrivers = {
    base: s.base,
    benefits: clamp(input.benefitPoints, 0, s.benefitsMax),
    wages:
      -s.wages.unpaidMaxLoss * (1 - clamp(input.payFactorBps, 0, 10_000) / 10_000) -
      s.wages.moodMaxLoss * (1 - clamp(input.payMoodBps, 0, 10_000) / 10_000),
    workload: over > 0 ? -w.overMaxLoss * over : input.utilization < w.underBelow ? -w.underLoss : 0,
    crisis:
      input.crisisSeverity > 0
        ? -(
            s.crisis.perSeverity * Math.min(3, Math.floor(input.crisisSeverity)) +
            (input.scandal ? s.crisis.scandal : 0)
          )
        : 0,
    layoffs: -clamp(input.layoffHeat, 0, s.layoffs.max),
    greed: -s.greedMaxLoss * greedShare(input.payoutRatioBps, cfg),
    success: input.profitCents > 0 ? s.success.profitHour : input.profitCents < 0 ? s.success.lossHour : 0,
  };
  const sum = Object.values(drivers).reduce((a, b) => a + b, 0);
  return { target: clamp(sum, 0, 100), drivers };
}

/** One hour of drift of a 0..100 value toward its target. */
export function stepToward(value: number, target: number, ratePerHour: number): number {
  return clamp(value + ratePerHour * (target - value), 0, 100);
}

export type SatisfactionZone = "green" | "yellow" | "red";

export function satisfactionZone(value: number, cfg: ListedRules = RULES): SatisfactionZone {
  return value >= cfg.satisfaction.green ? "green" : value >= cfg.satisfaction.red ? "yellow" : "red";
}

/** What the mood does to the hour: capacity factor and quality (absolute, never positive). */
export function satisfactionEffect(
  value: number,
  cfg: ListedRules = RULES,
): { capacityFactor: number; qualityAdd: number } {
  const s = cfg.satisfaction;
  const e = s.effect;
  const v = clamp(value, 0, 100);
  if (v >= s.green) {
    const up = clamp((v - s.green) / Math.max(1, e.highFull - s.green), 0, 1);
    return { capacityFactor: 1 + e.highCapacityMaxGain * up, qualityAdd: 0 };
  }
  const down = (s.green - v) / s.green;
  return { capacityFactor: 1 - e.lowCapacityMaxLoss * down, qualityAdd: -e.lowQualityMaxLoss * down };
}

/** Dismissals raise the heat, every hour lets it fade. */
export function layoffHeatNext(heat: number, dismissedNow: number, cfg: ListedRules = RULES): number {
  const l = cfg.satisfaction.layoffs;
  return Math.max(0, heat) * (1 - l.decayPerHour) + Math.max(0, dismissedNow) * l.perHead;
}

/** Whether an AI worker leaves this hour: every N-th hour in a row in the red zone. */
export function aiWorkerQuits(redHoursInRow: number, aiWorkers: number, cfg: ListedRules = RULES): boolean {
  const every = cfg.satisfaction.quits.everyRedHours;
  return aiWorkers > 0 && redHoursInRow > 0 && redHoursInRow % every === 0;
}

// ------------------------------------------------------------------ reputation

/** Founder payouts and withdrawals against the profit of the same window (bps); the profit counts at least a floor. */
export function payoutRatioBps(
  payoutCents: number,
  profitCents: number,
  revenueCents: number,
  cfg: ListedRules = RULES,
): number {
  if (payoutCents <= 0) return 0;
  const base = Math.max(profitCents, revenueCents * cfg.reputation.minProfitShareOfRevenue, 1);
  return Math.round((payoutCents * 10_000) / base);
}

export interface ReputationInput {
  /** Reputation points of active research. */
  readonly itemPoints: number;
  /** All over the reputation window: */
  readonly payoutCents: number;
  readonly profitCents: number;
  readonly revenueCents: number;
  readonly investedCents: number;
  readonly dividendCents: number;
  /** Berlin days in a row with a dividend. */
  readonly dividendStreak: number;
  readonly scandal: boolean;
}

export interface ReputationDrivers {
  readonly base: number;
  readonly items: number;
  readonly greed: number;
  readonly reinvest: number;
  readonly dividends: number;
  readonly scandal: number;
}

export function reputationTarget(
  input: ReputationInput,
  cfg: ListedRules = RULES,
): { target: number; drivers: ReputationDrivers; payoutRatioBps: number } {
  const r = cfg.reputation;
  const base = Math.max(input.profitCents, input.revenueCents * r.minProfitShareOfRevenue, 1);
  const ratio = payoutRatioBps(input.payoutCents, input.profitCents, input.revenueCents, cfg);
  const share = (cents: number, fullBps: number) => clamp((Math.max(0, cents) * 10_000) / base / fullBps, 0, 1);
  const drivers: ReputationDrivers = {
    base: r.base,
    items: input.itemPoints,
    greed: -r.greed.maxLoss * greedShare(ratio, cfg),
    reinvest: r.reinvest.maxGain * share(input.investedCents, r.reinvest.fullRatioBps),
    dividends:
      r.dividend.maxGain * share(input.dividendCents, r.dividend.fullRatioBps) +
      clamp(input.dividendStreak, 0, r.dividend.streakMax) * r.dividend.streakPerDay,
    scandal: input.scandal ? -r.scandalLoss : 0,
  };
  const sum = Object.values(drivers).reduce((a, b) => a + b, 0);
  return { target: clamp(sum, 0, 100), drivers, payoutRatioBps: ratio };
}

/** What the reputation does: demand factor of the hour and factor on the fair share price. */
export function reputationEffect(
  value: number,
  cfg: ListedRules = RULES,
): { demandFactor: number; priceFactor: number } {
  const x = (clamp(value, 0, 100) - 50) / 50;
  return { demandFactor: 1 + cfg.reputation.demandMaxEffect * x, priceFactor: 1 + cfg.reputation.priceMaxEffect * x };
}

// ------------------------------------------------------------------ the hour

/** How a listed company changes its operating hour (input of closeStartupHour). */
export interface ListedHourEffect {
  readonly awarenessAdd: number;
  readonly qualityAdd: number;
  readonly demandFactor: number;
  readonly capacityFactor: number;
  readonly cogsFactor: number;
  readonly fixedFactor: number;
}

export const NEUTRAL_HOUR_EFFECT: ListedHourEffect = {
  awarenessAdd: 0,
  qualityAdd: 0,
  demandFactor: 1,
  capacityFactor: 1,
  cogsFactor: 1,
  fixedFactor: 1,
};

/** Items, mood and reputation as the terms of the hourly close. */
export function listedHourEffect(
  effects: EffectTotals,
  satisfaction: number,
  reputation: number,
  cfg: ListedRules = RULES,
): ListedHourEffect {
  const sat = satisfactionEffect(satisfaction, cfg);
  const rep = reputationEffect(reputation, cfg);
  return {
    awarenessAdd: effects.awarenessBps / 10_000,
    qualityAdd: effects.qualityBps / 10_000 + sat.qualityAdd,
    demandFactor: (1 + effects.demandBps / 10_000) * (1 + effects.marketBps / 10_000) * rep.demandFactor,
    capacityFactor: Math.max(0.1, 1 + effects.capacityBps / 10_000) * sat.capacityFactor,
    cogsFactor: Math.max(0.5, 1 - effects.marginBps / 10_000),
    fixedFactor: Math.max(0.5, 1 + effects.fixedCostBps / 10_000),
  };
}

// ------------------------------------------------------------------ dividends

/** The most a founder may pay out as one dividend: a share of the free cash. */
export function maxDividendCents(freeCashCents: number, cfg: ListedRules = RULES): number {
  return Math.max(0, Math.floor((Math.max(0, freeCashCents) * cfg.dividends.maxShareOfFreeCashBps) / 10_000));
}

/**
 * Splits a dividend over the shares: every player holding gets its share rounded down, the AI float (all other
 * shares) gets the rest, so the sum is exactly the total.
 */
export function dividendSplit(
  totalCents: number,
  sharesTotalE6: number,
  holdingsE6: readonly number[],
): { players: number[]; floatCents: number } {
  const total = Math.max(0, Math.floor(totalCents));
  const players = holdingsE6.map((q) => (sharesTotalE6 > 0 ? Math.floor((total * Math.max(0, q)) / sharesTotalE6) : 0));
  return { players, floatCents: total - players.reduce((s, p) => s + p, 0) };
}

// ------------------------------------------------------------------ board

/** A motion needs more than minShareBps of all shares. */
export function canConvene(myE6: number, totalE6: number, cfg: ListedRules = RULES): boolean {
  return totalE6 > 0 && myE6 * 10_000 > totalE6 * cfg.board.minShareBps;
}

/** How the AI float votes: yes on shareholder protection while the reputation is low, otherwise it abstains. */
export function aiFloatVote(kind: BoardMotionKind, reputation: number, cfg: ListedRules = RULES): "yes" | "abstain" {
  const ai = cfg.board.aiVote;
  return (ai.kinds as readonly string[]).includes(kind) && reputation < ai.reputationBelow ? "yes" : "abstain";
}

export type BoardOutcome = "passed" | "rejected" | "no_quorum";

/** Result of a vote by shares: quorum on the votes cast, then yes must beat no. */
export function boardOutcome(yesE6: number, noE6: number, totalE6: number, cfg: ListedRules = RULES): BoardOutcome {
  if ((yesE6 + noE6) * 10_000 < totalE6 * cfg.board.quorumBps) return "no_quorum";
  return yesE6 > noE6 ? "passed" : "rejected";
}

/** A vote can end early once one side holds more than half of all shares. */
export function boardDecided(yesE6: number, noE6: number, totalE6: number): boolean {
  return yesE6 * 2 > totalE6 || noE6 * 2 >= totalE6;
}

// ------------------------------------------------------------------ books and taxes

export function isOperating(category: LedgerCategory): boolean {
  return (
    category === "revenue" ||
    category === "goods" ||
    category === "wages" ||
    category === "fixed" ||
    category === "research" ||
    category === "product" ||
    category === "expansion" ||
    category === "benefit" ||
    category === "advisor" ||
    category === "costs"
  );
}

/** Corporate tax rate of a company: the base rate plus the research effects, never below the minimum. */
export function taxRateBps(effectTaxRateBps: number, cfg: ListedRules = RULES): number {
  return Math.max(cfg.taxes.minRateBps, cfg.taxes.rateBps + effectTaxRateBps);
}

export interface BooksResult {
  readonly profitCents: number;
  readonly lossUsedCents: number;
  readonly taxableCents: number;
  readonly discountCents: number;
  readonly taxCents: number;
  readonly lossCarryCents: number;
}

/**
 * Closes a bookkeeping period: profit = revenue minus operating costs (investments included). A loss is carried
 * forward, a profit first uses up the carried loss; the tax is rounded down, the discount (clean books, advisor)
 * is taken off the tax.
 */
export function booksTax(
  revenueCents: number,
  costsCents: number,
  lossCarryCents: number,
  rateBps: number,
  discountBps: number,
  /** ADR-209: length of the period; with it the progressive brackets apply. */
  periodHours?: number,
): BooksResult {
  const profit = revenueCents - costsCents;
  const carry = Math.max(0, lossCarryCents);
  if (profit <= 0) {
    return {
      profitCents: profit,
      lossUsedCents: 0,
      taxableCents: 0,
      discountCents: 0,
      taxCents: 0,
      lossCarryCents: carry - profit,
    };
  }
  const used = Math.min(carry, profit);
  const taxable = profit - used;
  const gross =
    periodHours === undefined
      ? Math.floor((taxable * rateBps) / 10_000)
      : progressiveTaxCents(taxable, rateBps, periodHours);
  const discount = Math.floor((gross * clamp(discountBps, 0, 10_000)) / 10_000);
  return {
    profitCents: profit,
    lossUsedCents: used,
    taxableCents: taxable,
    discountCents: discount,
    taxCents: gross - discount,
    lossCarryCents: carry - used,
  };
}

/** The tax office's estimate when the books were skipped: a minimum margin, no loss carried, a surcharge. */
export function estimateTax(
  revenueCents: number,
  costsCents: number,
  rateBps: number,
  cfg: ListedRules = RULES,
  /** ADR-209: length of the period; with it the progressive brackets apply. */
  periodHours?: number,
): { taxableCents: number; taxCents: number; surchargeCents: number } {
  const e = cfg.taxes.estimate;
  const taxable = Math.max(revenueCents - costsCents, Math.floor((revenueCents * e.marginBps) / 10_000), 0);
  const tax =
    periodHours === undefined
      ? Math.floor((taxable * rateBps) / 10_000)
      : progressiveTaxCents(taxable, rateBps, periodHours, cfg);
  return { taxableCents: taxable, taxCents: tax, surchargeCents: Math.floor((tax * e.surchargeBps) / 10_000) };
}

export function lateFeeCents(revenueCents: number, cfg: ListedRules = RULES): number {
  const f = cfg.taxes.lateFee;
  return Math.max(f.minCents, Math.floor((Math.max(0, revenueCents) * f.revenueBps) / 10_000));
}

export type BooksStage = "none" | "open" | "reminder" | "late" | "estimate";

/** Where the open period stands: nothing to do without revenue, then reminder, late fee and estimate by age. */
export function booksStage(hoursOpen: number, revenueCents: number, cfg: ListedRules = RULES): BooksStage {
  const t = cfg.taxes;
  if (revenueCents <= 0) return "none";
  if (hoursOpen >= t.estimateAfterHours) return "estimate";
  if (hoursOpen >= t.lateFeeAfterHours) return "late";
  return hoursOpen >= t.reminderAfterHours ? "reminder" : "open";
}

/** Discount on the tax for a period: all receipts sorted right, or the advisor did it. */
export function booksDiscountBps(correct: number, byAdvisor: boolean, cfg: ListedRules = RULES): number {
  if (byAdvisor) return cfg.taxes.advisor.discountBps;
  return correct >= cfg.taxes.check.receipts ? cfg.taxes.check.discountBps : 0;
}

/** How many receipts were put into the right category. */
export function gradeReceipts(expected: readonly string[], answers: readonly string[]): number {
  return expected.reduce((n, category, i) => n + (answers[i] === category ? 1 : 0), 0);
}

/** Picks the receipts of a period from uniform numbers in [0, 1): distinct templates, in order. */
export function pickReceipts(uniforms: readonly number[], cfg: ListedRules = RULES): number[] {
  const pool = cfg.taxes.receipts.map((_, i) => i);
  const picked: number[] = [];
  for (let i = 0; i < cfg.taxes.check.receipts && pool.length > 0; i++) {
    const u = clamp(uniforms[i] ?? 0, 0, 0.999999);
    picked.push(pool.splice(Math.floor(u * pool.length), 1)[0]!);
  }
  return picked;
}

/**
 * Rate of the tax advisor on the reference revenue in bps (ADR-209): flat up to the pivot, then × growthPerDecade for
 * every tenfold revenue (exponential in the order of magnitude), at most maxRevenueBps.
 */
export function advisorRateBps(refCents: number, cfg: ListedRules = RULES): number {
  const a = cfg.taxes.advisor;
  if (!(refCents > a.pivotCentsPerHour)) return a.revenueBps;
  return Math.min(
    a.maxRevenueBps,
    a.revenueBps * Math.pow(a.growthPerDecade, Math.log10(refCents / a.pivotCentsPerHour)),
  );
}

/** Hourly wage of the tax advisor. */
export function advisorWageCents(refCents: number, cfg: ListedRules = RULES): number {
  const a = cfg.taxes.advisor;
  return Math.max(a.minWageCentsPerHour, Math.round((Math.max(0, refCents) * advisorRateBps(refCents, cfg)) / 10_000));
}

/**
 * Corporate tax with the progressive brackets (ADR-209): rate on everything, plus extraBps on the part above each
 * bracket's threshold; thresholds are per day and scaled to the period's hours. Rounded down.
 */
export function progressiveTaxCents(
  taxableCents: number,
  rateBps: number,
  periodHours: number,
  cfg: ListedRules = RULES,
) {
  const taxable = Math.max(0, Math.floor(taxableCents));
  const days = Math.max(1, periodHours) / 24;
  let tax = taxable * rateBps;
  for (const b of cfg.taxes.brackets) {
    const from = b.fromCentsPerDay * days;
    if (taxable > from) tax += (taxable - from) * b.extraBps;
  }
  return Math.floor(tax / 10_000);
}

/** Surcharge on an unpaid tax: once after the deadline, more when the tax office collects by force. */
export function latePaymentCents(taxCents: number, enforced: boolean, cfg: ListedRules = RULES): number {
  const bps = enforced ? cfg.taxes.enforcementBps : cfg.taxes.latePaymentBps;
  return Math.floor((Math.max(0, taxCents) * bps) / 10_000);
}
