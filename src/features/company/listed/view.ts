import type { BoardMotionKind, ListedEffects, ListedItem, ResearchBranch } from "@/config/listed";
import type {
  BoardMotion,
  BoardMotionInput,
  CompanyBoard,
  ListedCompany,
  ListedHistoryPoint,
  ListedItemState,
  TaxPeriod,
} from "@/features/game/listed-types";
import { affordableInHours, profitHoursOf } from "@/lib/sim/listed";

/*
 * Pure helpers of the listed-company pages (ADR-167, UI): what is due, how the research tree is laid out, how an
 * effect reads, whether a motion is valid, where a gauge needle points. No React, no clock: time is passed in.
 */

// ------------------------------------------------------------------ effects

export interface EffectChip {
  key: keyof ListedEffects;
  /** Value as it is shown: bps for relative effects, points for satisfaction and reputation. */
  value: number;
  unit: "bps" | "points";
  good: boolean;
}

/** Effects where a negative number is the good news. */
const LOWER_IS_BETTER: readonly (keyof ListedEffects)[] = ["fixedCostBps", "taxRateBps"];
const EFFECT_ORDER: readonly (keyof ListedEffects)[] = [
  "demandBps",
  "marketBps",
  "capacityBps",
  "qualityBps",
  "awarenessBps",
  "marginBps",
  "fixedCostBps",
  "taxRateBps",
  "satisfaction",
  "reputation",
];

/** The lasting effects of an item as chips, in a fixed order; `levels` multiplies them (machines). */
export function effectChips(effects: ListedEffects, levels = 1): EffectChip[] {
  const chips: EffectChip[] = [];
  for (const key of EFFECT_ORDER) {
    const raw = effects[key];
    if (!raw) continue;
    const value = raw * Math.max(1, levels);
    chips.push({
      key,
      value,
      unit: key === "satisfaction" || key === "reputation" ? "points" : "bps",
      good: LOWER_IS_BETTER.includes(key) ? value < 0 : value > 0,
    });
  }
  return chips;
}

// ------------------------------------------------------------------ catalogue

export interface CatalogueEntry {
  item: ListedItem;
  state: ListedItemState;
}

/** Joins the static catalogue with the server state, in catalogue order; unknown keys are skipped. */
export function joinCatalogue(items: readonly ListedItem[], states: readonly ListedItemState[]): CatalogueEntry[] {
  const byKey = new Map(states.map((s) => [s.key, s]));
  const out: CatalogueEntry[] = [];
  for (const item of items) {
    const state = byKey.get(item.key);
    if (state) out.push({ item, state });
  }
  return out;
}

export interface ResearchRow {
  branch: ResearchBranch;
  /** Tier 1..n, in order. */
  steps: CatalogueEntry[];
  done: number;
}

/** The research tree: one row per branch, steps ordered by tier. */
export function researchTree(entries: readonly CatalogueEntry[]): ResearchRow[] {
  const rows = new Map<ResearchBranch, CatalogueEntry[]>();
  for (const e of entries) {
    if (e.item.kind !== "research" || !e.item.branch) continue;
    const list = rows.get(e.item.branch) ?? [];
    list.push(e);
    rows.set(e.item.branch, list);
  }
  return [...rows.entries()].map(([branch, steps]) => {
    const sorted = [...steps].sort((a, b) => (a.item.tier ?? 0) - (b.item.tier ?? 0));
    return { branch, steps: sorted, done: sorted.filter((s) => s.state.status === "active").length };
  });
}

export type ItemPhase = "locked" | "available" | "running" | "active" | "paused" | "cooldown" | "maxed";

/** What the player can do with an item right now (`now` = server time, epoch ms). */
export function itemPhase(e: CatalogueEntry, now: number): ItemPhase {
  const { state, item } = e;
  if (state.readyAt !== null && Date.parse(state.readyAt) > now) return "running";
  if (item.kind === "action") {
    return state.cooldownUntil !== null && Date.parse(state.cooldownUntil) > now ? "cooldown" : "available";
  }
  if (state.status === "running") return "running";
  if (state.status === "paused") return "paused";
  if (state.status === "active") return state.level < state.maxLevel ? "active" : "maxed";
  return state.missing.length > 0 ? "locked" : "available";
}

/** Whether "buy" (or "next level") is offered: nothing in work, requirements met, a level left. */
export function canBuyItem(e: CatalogueEntry, now: number): boolean {
  const phase = itemPhase(e, now);
  if (phase === "available") return true;
  return phase === "active" && e.state.level < e.state.maxLevel && e.state.missing.length === 0;
}

/** Products, regions, licences and benefits can be retired (no money back). */
export function canStopItem(e: CatalogueEntry): boolean {
  return (
    ["product", "region", "licence", "benefit"].includes(e.item.kind) &&
    (e.state.status === "active" || e.state.status === "paused")
  );
}

/** A span of hours as it reads: under 1 hour, whole hours up to two days, then days with one decimal. */
export type HourSpan = { unit: "lessHour" } | { unit: "hours"; value: number } | { unit: "days"; value: number };

export function hourSpan(hours: number): HourSpan {
  if (hours < 1) return { unit: "lessHour" };
  if (hours < 48) return { unit: "hours", value: Math.round(hours) };
  return { unit: "days", value: Math.round((hours / 24) * 10) / 10 };
}

export interface ResearchPrice {
  /** The price in hours of the average profit (null without profit). */
  profit: HourSpan | null;
  /** When it can be paid from what may be spent now plus the profit: "now", a span, or null = only with profit. */
  affordable: "now" | HourSpan | null;
}

/**
 * What a research price means for the company (ADR-215): how many hours or days of its average profit it is and
 * when the company can afford it at that profit.
 */
export function researchPrice(costCents: number, spendableCents: number, avgProfitCents: number): ResearchPrice {
  const share = profitHoursOf(costCents, avgProfitCents);
  const wait = affordableInHours(costCents, spendableCents, avgProfitCents);
  return {
    profit: share === null ? null : hourSpan(share),
    affordable: wait === null ? null : wait === 0 ? "now" : hourSpan(wait),
  };
}

/** Running costs per hour against the reference revenue, in bps (0 without revenue). */
export function upkeepShareBps(upkeepCents: number, refRevenueCents: number): number {
  return refRevenueCents > 0 ? Math.round((upkeepCents * 10_000) / refRevenueCents) : 0;
}

// ------------------------------------------------------------------ gauge and history

/** Needle angle of a half-circle gauge: −90° at 0, +90° at 100. */
export function gaugeAngle(value: number): number {
  return (Math.min(100, Math.max(0, value)) / 100) * 180 - 90;
}

/** A point on the gauge arc (centre cx/cy, radius r) for a value 0..100; SVG coordinates. */
export function gaugePoint(value: number, cx: number, cy: number, r: number): { x: number; y: number } {
  const angle = Math.PI * (1 - Math.min(100, Math.max(0, value)) / 100);
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
}

/** SVG path of the arc between two values on the gauge. */
export function gaugeArc(from: number, to: number, cx: number, cy: number, r: number): string {
  const a = gaugePoint(from, cx, cy, r);
  const b = gaugePoint(to, cx, cy, r);
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M ${f(a.x)} ${f(a.y)} A ${r} ${r} 0 0 1 ${f(b.x)} ${f(b.y)}`;
}

export interface LinePoint {
  x: number;
  y: number;
  at: string;
  value: number;
}

/** History values (0..100) as points in a box of width × height (y grows downwards). */
export function historyLine(
  history: readonly ListedHistoryPoint[],
  pick: (p: ListedHistoryPoint) => number,
  width: number,
  height: number,
): LinePoint[] {
  const n = history.length;
  return history.map((p, i) => {
    const value = Math.min(100, Math.max(0, pick(p)));
    return {
      x: n <= 1 ? width : Math.round((i / (n - 1)) * width * 100) / 100,
      y: Math.round((1 - value / 100) * height * 100) / 100,
      at: p.at,
      value,
    };
  });
}

export function linePath(points: readonly LinePoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

/** Drivers sorted by weight: what pushes up first, then what pulls down; `base` and zeros are left out. */
export function sortedDrivers(drivers: Record<string, number>): { key: string; value: number }[] {
  return Object.entries(drivers)
    .filter(([key, value]) => key !== "base" && Math.round(value * 10) !== 0)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
}

// ------------------------------------------------------------------ what is due

export type TodoKey = "books" | "tax" | "board" | "mood" | "research" | "paused";
export interface CompanyTodo {
  key: TodoKey;
  tone: "urgent" | "warn" | "normal";
  /** Section name for resolveCompanyTarget. */
  section: string;
  amountCents?: number;
  count?: number;
  /** When it gets worse (ISO), for a countdown. */
  deadline?: string;
}

/** The earliest unpaid tax period. */
export function nextTaxDue(periods: readonly TaxPeriod[]): TaxPeriod | null {
  const due = periods.filter((p) => p.status === "due").sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  return due[0] ?? null;
}

/** What the founder should look at, most urgent first. */
export function companyTodos(l: ListedCompany, now: number): CompanyTodo[] {
  const todos: CompanyTodo[] = [];
  const b = l.books;
  if (b.canClose && !l.taxes.advisor) {
    const late = b.stage === "late" || b.stage === "estimate";
    todos.push({
      key: "books",
      tone: late ? "urgent" : b.stage === "reminder" ? "warn" : "normal",
      section: "books",
      amountCents: b.estimatedTaxCents,
      deadline: b.stage === "estimate" ? undefined : b.stage === "late" ? b.estimateAt : b.lateFeeAt,
    });
  }
  if (l.taxes.dueCents > 0) {
    const period = nextTaxDue(l.taxes.periods);
    const late = period !== null && (period.stage > 0 || Date.parse(period.dueAt) <= now);
    todos.push({
      key: "tax",
      tone: late ? "urgent" : "warn",
      section: "taxes",
      amountCents: l.taxes.dueCents,
      deadline: period && !late ? period.dueAt : undefined,
    });
  }
  if (l.board.toVote > 0) todos.push({ key: "board", tone: "warn", section: "board", count: l.board.toVote });
  if (l.satisfaction.zone !== "green") {
    todos.push({ key: "mood", tone: l.satisfaction.zone === "red" ? "urgent" : "warn", section: "satisfaction" });
  }
  const paused = l.items.filter((i) => i.status === "paused").length;
  if (paused > 0) todos.push({ key: "paused", tone: "warn", section: "growth", count: paused });
  const research = l.items.filter((i) => i.kind === "research");
  const done = research.filter((i) => i.status === "active").length;
  const running = research.some((i) => i.status === "running" || i.readyAt !== null);
  const open = research.some((i) => i.status === "none" && i.missing.length === 0);
  if (done > 0 && !running && open) todos.push({ key: "research", tone: "normal", section: "research", count: done });
  const rank = { urgent: 0, warn: 1, normal: 2 } as const;
  return todos.sort((x, y) => rank[x.tone] - rank[y.tone]);
}

/** How pressing an unpaid tax period is. */
export function taxPeriodState(p: TaxPeriod, now: number): "paid" | "due" | "overdue" | "enforced" {
  if (p.status === "paid") return p.stage >= 2 ? "enforced" : "paid";
  if (p.stage >= 2) return "enforced";
  return p.stage >= 1 || Date.parse(p.dueAt) <= now ? "overdue" : "due";
}

// ------------------------------------------------------------------ board

export interface Tally {
  yesBps: number;
  noBps: number;
  /** Votes cast of all shares. */
  castBps: number;
  quorumMet: boolean;
  leading: "yes" | "no" | "tie";
}

/** Votes of a motion as shares of all shares. */
export function motionTally(m: Pick<BoardMotion, "yesE6" | "noE6" | "totalE6">, quorumBps: number): Tally {
  const total = Math.max(1, m.totalE6);
  const yesBps = Math.round((m.yesE6 * 10_000) / total);
  const noBps = Math.round((m.noE6 * 10_000) / total);
  return {
    yesBps,
    noBps,
    castBps: yesBps + noBps,
    quorumMet: yesBps + noBps >= quorumBps,
    leading: m.yesE6 > m.noE6 ? "yes" : m.noE6 > m.yesE6 ? "no" : "tie",
  };
}

export interface MotionRules {
  maxDays: number;
  earmarkMaxShareOfCashBps: number;
  payoutCapStepBps: number;
  minDividendCents: number;
}

export type MotionError = "amount" | "amountTooHigh" | "dividendMin" | "dividendMax" | "days" | "bps" | "noBudget";

/** Checks a motion before it is sent; null = fine. The server checks again. */
export function motionError(
  motion: BoardMotionInput,
  board: Pick<CompanyBoard, "cashCents" | "freeCashCents" | "budgets">,
  rules: MotionRules,
): MotionError | null {
  const whole = (n: number) => Number.isInteger(n) && n >= 1;
  if ("days" in motion && (!whole(motion.days) || motion.days > rules.maxDays)) return "days";
  switch (motion.kind) {
    case "earmark":
      if (!whole(motion.amountCents)) return "amount";
      if (motion.amountCents > (Math.max(0, board.cashCents) * rules.earmarkMaxShareOfCashBps) / 10_000)
        return "amountTooHigh";
      return null;
    case "release":
      return board.budgets.some((b) => b.purpose === motion.purpose && b.amountCents > 0) ? null : "noBudget";
    case "dividend":
      if (!whole(motion.amountCents)) return "amount";
      if (motion.amountCents < rules.minDividendCents) return "dividendMin";
      if (motion.amountCents > Math.max(0, board.freeCashCents)) return "dividendMax";
      return null;
    case "payout_cap":
      return Number.isInteger(motion.bps) &&
        motion.bps >= 0 &&
        motion.bps <= 10_000 &&
        motion.bps % rules.payoutCapStepBps === 0
        ? null
        : "bps";
    case "debt":
      return whole(motion.amountCents) ? null : "amount";
    default:
      return null;
  }
}

/** Which inputs a motion kind needs, for the form. */
export function motionFields(kind: BoardMotionKind): {
  purpose: boolean;
  amount: boolean;
  days: boolean;
  bps: boolean;
  priceLevel: boolean;
} {
  return {
    purpose: kind === "earmark" || kind === "release",
    amount: kind === "earmark" || kind === "dividend" || kind === "debt",
    days: kind === "payout_cap" || kind === "withdraw_ban" || kind === "price_level",
    bps: kind === "payout_cap",
    priceLevel: kind === "price_level",
  };
}
