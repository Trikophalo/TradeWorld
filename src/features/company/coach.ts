import { BALANCE } from "@/config/balance";
import type { MyCompany } from "@/features/game/types";

/*
 * The profit coach (ADR-083): reads the last operating hour and names the bottleneck with the next step.
 * Pure function, so the rules are tested and the card only renders.
 */
export type CoachTip =
  | "waiting"
  | "contractOff"
  | "aiIdle"
  | "aiUnpaid"
  | "fewCustomers"
  | "tryBudget"
  | "premiumLowQuality"
  | "soldOut"
  | "tryPremium"
  | "marketingHigh"
  | "fixedHigh"
  | "upgrade"
  | "expand"
  | "healthy";

export type CoachAction =
  "contractOn" | "budget" | "normal" | "premium" | "marketing" | "dismissAi" | "hire" | "upgrade" | "expand";

export interface CoachAdvice {
  tip: CoachTip;
  tone: "warn" | "tip" | "good";
  action: CoachAction | null;
}

/** One hour of the company in money, split for the profit bar. */
export interface HourBreakdown {
  ownRevenueCents: number;
  contractRevenueCents: number;
  /** Goods and player wages: what remains of the revenue after profit and the other costs. */
  goodsAndWagesCents: number;
  aiWagesCents: number;
  fixedCents: number;
  marketingCents: number;
  profitCents: number;
}

export function hourBreakdown(live: NonNullable<MyCompany["live"]>): HourBreakdown {
  const own = live.revenuePerHourCents - live.contractRevenuePerHourCents;
  const goodsAndWages = Math.max(
    0,
    live.revenuePerHourCents -
      live.profitPerHourCents -
      live.fixedPerHourCents -
      live.marketingPerHourCents -
      live.aiWagesPerHourCents,
  );
  return {
    ownRevenueCents: Math.max(0, own),
    contractRevenueCents: live.contractRevenuePerHourCents,
    goodsAndWagesCents: goodsAndWages,
    aiWagesCents: live.aiWagesPerHourCents,
    fixedCents: live.fixedPerHourCents,
    marketingCents: live.marketingPerHourCents,
    profitCents: live.profitPerHourCents,
  };
}

type CoachInput = Pick<
  MyCompany,
  | "live"
  | "contractWork"
  | "priceLevel"
  | "qualityBps"
  | "awarenessBps"
  | "aiWorkers"
  | "teamProductivityBps"
  | "canUpgrade"
  | "canExpand"
  | "expansionCostCents"
  | "cashCents"
  | "maxEmployees"
  | "headcount"
>;

/** The most important hints first, at most `limit`. */
export function coachAdvice(c: CoachInput, limit = 3, cfg = BALANCE.startups): CoachAdvice[] {
  const live = c.live;
  if (!live) return [{ tip: "waiting", tone: "tip", action: null }];
  const out: CoachAdvice[] = [];
  const add = (tip: CoachTip, tone: CoachAdvice["tone"], action: CoachAdvice["action"]) => {
    if (!out.some((a) => a.tip === tip)) out.push({ tip, tone, action });
  };

  const demand = live.demandPerHourCents;
  const capacity = live.capacityPerHourCents;
  const quality = c.qualityBps / 10_000;
  const losing = live.profitPerHourCents < 0;
  // Capacity of the AI workers alone: their share of the team's productivity.
  const aiCapacity = c.teamProductivityBps > 0 ? (capacity * c.aiWorkers * 10_000) / c.teamProductivityBps : 0;
  const gross = live.revenuePerHourCents - Math.max(0, hourBreakdown(live).goodsAndWagesCents);

  if (!c.contractWork && capacity > demand * 1.2) add("contractOff", "warn", "contractOn");
  if (c.priceLevel === "premium" && quality < cfg.pricing.premiumMinQuality) add("premiumLowQuality", "warn", "normal");
  if (c.aiWorkers > 0 && demand < capacity - aiCapacity * 0.5) add("aiIdle", "warn", "dismissAi");
  else if (c.aiWorkers > 0 && live.payFactorBps < 10_000) add("aiUnpaid", "warn", "dismissAi");
  if (demand < capacity * 0.5) {
    add("fewCustomers", "tip", "marketing");
    if (c.priceLevel !== "budget") add("tryBudget", "tip", "budget");
  }
  if (live.marketingPerHourCents > 0 && live.marketingPerHourCents > gross * 0.5 && losing)
    add("marketingHigh", "warn", "marketing");
  if (demand >= capacity * 0.98) {
    add("soldOut", "good", c.headcount < c.maxEmployees ? "hire" : null);
    if (c.priceLevel !== "premium" && quality >= cfg.pricing.premiumMinQuality) add("tryPremium", "tip", "premium");
  }
  if (losing && live.fixedPerHourCents > gross) add("fixedHigh", "warn", null);
  if (!losing) {
    if (c.canUpgrade) add("upgrade", "good", "upgrade");
    if (c.canExpand && c.expansionCostCents !== null && c.cashCents >= c.expansionCostCents)
      add("expand", "good", "expand");
  }
  if (out.length === 0) add("healthy", "good", null);

  const rank = { warn: 0, tip: 1, good: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, limit);
}
