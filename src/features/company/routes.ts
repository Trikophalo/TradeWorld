import { BALANCE } from "@/config/balance";
import type { CampaignKind, MyCompany, PriceLevel } from "@/features/game/types";
import { campaignCostCents, campaignGainPerHourCents } from "@/lib/sim/campaigns";
import { supplyFreeCapacityCents, unmetDemandCents } from "@/lib/sim/deals";
import { priceEffect } from "@/lib/sim/startup";

/*
 * Profit routes (ADR-096): every lever of a player company with its state and an estimate in euros per hour,
 * from the numbers of the last closed hour and the same unit economics as the hourly close: demand and capacity in
 * goods at the normal price, revenue = sold × price factor, goods = sold × (1 − gross margin). Pure, so it is tested.
 */
export type RouteKey =
  "price" | "contract" | "staff" | "campaign" | "supplyBuy" | "supplySell" | "stake" | "expand" | "ipo";
export type RouteState = "active" | "possible" | "locked" | "fits";
export type Bottleneck = "customers" | "staff" | "balanced" | "waiting";

export interface ProfitRoute {
  key: RouteKey;
  state: RouteState;
  /** Estimated profit change per hour, null when there is nothing to estimate. */
  gainCentsPerHour: number | null;
  /** Campaign: profit over its whole run; expansion: the price. */
  totalCents?: number;
  /** Price strategy: the better level; campaign: the best kind. */
  priceLevel?: PriceLevel;
  campaign?: CampaignKind;
}

/** A fee of 60 % of the price as the example for supply contracts. */
export const EXAMPLE_FEE = 0.6;

type RouteInput = Pick<
  MyCompany,
  | "sector"
  | "live"
  | "priceLevel"
  | "contractWork"
  | "qualityBps"
  | "teamProductivityBps"
  | "aiWageCentsPerHour"
  | "headcount"
  | "maxEmployees"
  | "canExpand"
  | "expansionCostCents"
  | "canUpgrade"
  | "upgradeCostCents"
  | "listing"
  | "canGoPublic"
  | "campaign"
  | "campaignCosts"
>;

export function bottleneck(company: Pick<MyCompany, "live">): { kind: Bottleneck; cents: number } {
  const live = company.live;
  if (!live) return { kind: "waiting", cents: 0 };
  const d = live.demandPerHourCents;
  const c = live.capacityPerHourCents;
  if (d < c * 0.9) return { kind: "customers", cents: Math.round(c - d) };
  if (d > c * 1.1) return { kind: "staff", cents: Math.round(d - c) };
  return { kind: "balanced", cents: 0 };
}

export function profitRoutes(company: RouteInput, playerLevel: number, cfg = BALANCE): ProfitRoute[] {
  const sc = cfg.startups;
  const live = company.live;
  const quality = company.qualityBps / 10_000;
  const goods = 1 - sc.grossMargin[company.sector];
  const level = company.priceLevel;
  const current = priceEffect(level, quality, sc);
  const d = live?.demandPerHourCents ?? 0;
  const c = live?.capacityPerHourCents ?? 0;
  const sold = Math.min(d, c);
  const round = (x: number) => Math.round(x);
  const routes: ProfitRoute[] = [];

  // Price strategy: the same customers at another price and demand factor.
  if (live) {
    const gross = sold * (current.price - goods);
    let best: { level: PriceLevel; gain: number } | null = null;
    for (const alt of ["budget", "normal", "premium"] as const) {
      if (alt === level) continue;
      const e = priceEffect(alt, quality, sc);
      const altSold = Math.min((d / current.demand) * e.demand, c);
      const gain = altSold * (e.price - goods) - gross;
      if (gain > 0 && (!best || gain > best.gain)) best = { level: alt, gain };
    }
    routes.push(
      best
        ? { key: "price", state: "possible", gainCentsPerHour: round(best.gain), priceLevel: best.level }
        : { key: "price", state: "fits", gainCentsPerHour: null },
    );
  } else routes.push({ key: "price", state: "fits", gainCentsPerHour: null });

  // Contract work: a share of the free capacity at a small margin.
  const free = Math.max(0, c - sold);
  routes.push(
    company.contractWork
      ? { key: "contract", state: "active", gainCentsPerHour: live ? live.contractRevenuePerHourCents : null }
      : {
          key: "contract",
          state: "possible",
          gainCentsPerHour: live
            ? round(free * sc.contractWork.shareOfFreeCapacity * sc.contractWork.grossMargin)
            : null,
        },
  );

  // One more AI worker: capacity of one productivity unit, paid every hour.
  if (company.headcount >= company.maxEmployees) routes.push({ key: "staff", state: "locked", gainCentsPerHour: null });
  else if (live) {
    const perUnit = company.teamProductivityBps > 0 ? (c * 10_000) / company.teamProductivityBps : 0;
    const extraSold = Math.min(perUnit, Math.max(0, d - c));
    routes.push({
      key: "staff",
      state: "possible",
      gainCentsPerHour: round(extraSold * (current.price - goods) - company.aiWageCentsPerHour),
    });
  } else routes.push({ key: "staff", state: "possible", gainCentsPerHour: null });

  // Campaign: the best kind with average luck, over its whole run, minus its price.
  if (company.campaign)
    routes.push({ key: "campaign", state: "active", gainCentsPerHour: null, campaign: company.campaign.kind });
  else if (live) {
    let best: { kind: CampaignKind; total: number; perHour: number } | null = null;
    for (const kind of ["flyer", "online", "tv"] as const) {
      const perHour = campaignGainPerHourCents(kind, {
        demandCents: d,
        capacityCents: c,
        quality,
        price: current.price,
        grossMargin: sc.grossMargin[company.sector],
      });
      const cost = company.campaignCosts?.[kind] ?? campaignCostCents(kind, d, cfg);
      const total = perHour * sc.campaigns.kinds[kind].hours - cost;
      if (!best || total > best.total) best = { kind, total, perHour };
    }
    routes.push({
      key: "campaign",
      state: "possible",
      gainCentsPerHour: best && best.total > 0 ? best.perHour : null,
      totalCents: best ? round(best.total) : undefined,
      campaign: best?.kind,
    });
  } else routes.push({ key: "campaign", state: "possible", gainCentsPerHour: null });

  // Supply contracts with other players.
  const unmet = live ? unmetDemandCents(c, d) : 0;
  routes.push({
    key: "supplyBuy",
    state: "possible",
    gainCentsPerHour: unmet > 0 ? round(unmet * (current.price - EXAMPLE_FEE)) : null,
  });
  const sellable = live ? supplyFreeCapacityCents(c, d, company.contractWork, cfg) : 0;
  const sellMargin = EXAMPLE_FEE - goods;
  routes.push({
    key: "supplySell",
    state: "possible",
    gainCentsPerHour: sellable > 0 && sellMargin > 0 ? round(sellable * sellMargin) : null,
  });

  routes.push({ key: "stake", state: "possible", gainCentsPerHour: null });

  if (company.canExpand && company.expansionCostCents !== null) {
    routes.push({ key: "expand", state: "possible", gainCentsPerHour: null, totalCents: company.expansionCostCents });
  } else if (company.canUpgrade && company.upgradeCostCents !== null) {
    routes.push({ key: "expand", state: "possible", gainCentsPerHour: null, totalCents: company.upgradeCostCents });
  } else routes.push({ key: "expand", state: "locked", gainCentsPerHour: null });

  routes.push({
    key: "ipo",
    state: company.listing ? "active" : company.canGoPublic || playerLevel >= sc.ipo.minLevel ? "possible" : "locked",
    gainCentsPerHour: null,
  });
  return routes;
}
