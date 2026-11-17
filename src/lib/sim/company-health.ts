/**
 * Company health (ADR-162): eight factors that explain why a player company earns or loses money, each rated
 * 0..100 against what profit needs, with a reason in numbers and the hourly profit a fix would bring.
 *
 * The analysis replays the operating hour of `closeStartupHour` (ADR-072) from what the company page already knows:
 * the last closed hour (demand, capacity, costs), awareness, quality, price strategy, team and cash. Demand of the
 * last hour is split back into its parts (awareness, quality, price, event, campaign, task momentum), so every
 * factor can be changed on its own and the hour computed again. Pure: no clock, no randomness.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig, CampaignKind, SectorId } from "../../config/balance.ts";
import {
  capacityCents as teamCapacityCents,
  expansionCapacityFactor,
  fixedCostCents,
  aiUtilizationBps,
  aiWageDueCents,
  marketingGain,
  priceEffect,
} from "./startup.ts";
import type { PriceLevel, StartupTier } from "./startup.ts";

export const HEALTH_FACTORS = [
  "awareness",
  "capacity",
  "quality",
  "image",
  "price",
  "team",
  "cash",
  "momentum",
] as const;
export type HealthFactorKey = (typeof HEALTH_FACTORS)[number];
export type HealthStatus = "good" | "ok" | "weak" | "critical";

/** Demand, capacity and cost factors of a company event (see eventModifiers in company-events.ts). */
export interface HealthEventEffect {
  readonly demandFactor: number;
  readonly capacityFactor: number;
  readonly extraCostShare: number;
}

/** The company as the company page sees it: a structural subset of `MyCompany`. */
export interface HealthCompany {
  readonly sector: SectorId;
  readonly tier: StartupTier;
  readonly priceLevel: PriceLevel;
  readonly contractWork: boolean;
  readonly expansionLevel: number;
  readonly stage: number;
  readonly stages: readonly {
    readonly stage: number;
    readonly reached: boolean;
    readonly skills: readonly {
      readonly key: string;
      readonly coveredBy: string | null;
      readonly coveredByAi: boolean;
    }[];
  }[];
  readonly awarenessBps: number;
  readonly qualityBps: number;
  readonly marketingCentsPerQuarter: number;
  readonly aiWorkers: number;
  readonly aiWageCentsPerHour: number;
  readonly headcount: number;
  readonly maxEmployees: number;
  /** Capacity of the team per quarter, before stage and expansion bonuses. */
  readonly capacityCents: number;
  readonly cashCents: number;
  readonly unpaidCents: number;
  readonly distress: boolean;
  readonly distressQuarters: number;
  readonly graceQuarters: number;
  /** The owner's range of the yearly market (legal form and expansion included). */
  readonly estimateLowCents: number;
  readonly estimateHighCents: number;
  readonly payFactorBps: number;
  readonly campaign: { readonly demandBps: number } | null;
  readonly campaignCosts: Readonly<Record<CampaignKind, number>> | null;
  readonly canExpand: boolean;
  readonly canUpgrade: boolean;
  readonly live: {
    readonly revenuePerHourCents: number;
    readonly profitPerHourCents: number;
    readonly payFactorBps: number;
    readonly contractRevenuePerHourCents: number;
    readonly demandPerHourCents: number;
    readonly capacityPerHourCents: number;
    readonly fixedPerHourCents: number;
    readonly aiWagesPerHourCents: number;
    readonly marketingPerHourCents: number;
  } | null;
  readonly lastQuarter: { readonly wagesCents: number } | null;
}

/** What the company page knows besides the company: task momentum, open tasks and the current event. */
export interface HealthExtras {
  /** Demand multiplier from solved tasks (ADR-148), 1 = none. */
  readonly momentum?: number;
  readonly openTasks?: number;
  /** A crisis or chance with its effect now and once it is fully in force (crisis) or won (chance). */
  readonly event?: {
    readonly polarity: "crisis" | "chance";
    readonly severity: number;
    readonly now: HealthEventEffect;
    readonly full: HealthEventEffect;
  } | null;
}

/** A concrete change the player can make; Mira turns these into buttons. */
export type HealthLever =
  | { readonly kind: "marketing"; readonly cents: number }
  | { readonly kind: "campaign"; readonly campaign: CampaignKind; readonly costCents: number }
  | { readonly kind: "price"; readonly level: PriceLevel }
  | { readonly kind: "contractWork" }
  | { readonly kind: "hireAi"; readonly count: number }
  | { readonly kind: "dismissAi"; readonly count: number }
  | { readonly kind: "skill"; readonly skill: string }
  | { readonly kind: "train" }
  | { readonly kind: "expand" }
  | { readonly kind: "upgrade" }
  | { readonly kind: "tasks"; readonly open: number }
  | { readonly kind: "event" }
  | { readonly kind: "deposit"; readonly cents: number }
  | { readonly kind: "move"; readonly goal: "cash" | "awareness" | "quality" };

export interface HealthFactor {
  readonly key: HealthFactorKey;
  /** 0..100 */
  readonly score: number;
  readonly status: HealthStatus;
  /** Message key under "companyHealth.reasons" and its values (…Cents are money, …Pct are whole percent). */
  readonly reason: { readonly key: string; readonly values: Readonly<Record<string, number>> };
  /** Estimated extra profit per hour once this is fixed (cents, ≥ 0). */
  readonly impactCents: number;
  /** What to do, most effective first. */
  readonly levers: readonly HealthLever[];
}

export interface CompanyHealth {
  readonly factors: readonly HealthFactor[];
  /** The point that costs the most (largest impact), or the lowest score when nothing costs money. */
  readonly weakest: HealthFactorKey;
  /** Profit of the last hour, or the modelled hour before the first one. */
  readonly profitPerHourCents: number;
  /** Mean of the eight scores. */
  readonly score: number;
  /** No hour closed yet: numbers are estimates from awareness, quality and the market range. */
  readonly estimated: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const pct = (share: number) => Math.round(share * 100);
const cents = (v: number) => Math.round(v);

/** The hour as a set of knobs: change one, compute the profit again. */
interface Hour {
  /** Demand per hour at the normal price for awareness 1 and quality factor 1, before price, event, campaign. */
  readonly reach: number;
  readonly awareness: number;
  readonly quality: number;
  readonly priceLevel: PriceLevel;
  readonly event: HealthEventEffect;
  readonly campaign: number;
  readonly momentum: number;
  /** Capacity per hour before the event's capacity factor. */
  readonly capacity: number;
  readonly aiWorkers: number;
  readonly contractWork: boolean;
  readonly marketing: number;
  readonly fixed: number;
  readonly playerWagesDue: number;
}

interface HourResult {
  readonly demand: number;
  readonly capacity: number;
  readonly revenue: number;
  readonly gross: number;
  readonly profit: number;
  readonly wagesDue: number;
}

function simulate(h: Hour, c: HealthCompany, cfg: BalanceConfig): HourResult {
  const sc = cfg.startups;
  const pricing = priceEffect(h.priceLevel, h.quality, sc);
  const demand =
    h.reach *
    h.awareness *
    (0.5 + 0.5 * h.quality) *
    pricing.demand *
    h.event.demandFactor *
    Math.max(0, h.campaign) *
    Math.max(1, h.momentum);
  const capacity = h.capacity * h.event.capacityFactor;
  const sold = Math.min(demand, capacity);
  const contract = h.contractWork ? (capacity - sold) * sc.contractWork.shareOfFreeCapacity : 0;
  const own = sold * pricing.price;
  const revenue = own + contract;
  const cogs =
    Math.max(0, sold * (1 - sc.grossMargin[c.sector]) + own * h.event.extraCostShare) +
    contract * (1 - sc.contractWork.grossMargin);
  const gross = revenue - cogs;
  // ADR-180: AI workers cost the full wage only for the capacity the hour used, else the standby share
  const units = h.capacity / Math.max(1e-9, capacityPerWorker(c, cfg));
  const aiDue = aiWageDueCents(h.aiWorkers, aiUtilizationBps(sold, capacity, h.aiWorkers, units), {
    ...cfg,
    startups: { ...sc, aiWorkerWageCentsPerHour: c.aiWageCentsPerHour },
  });
  const wagesDue = aiDue + h.playerWagesDue;
  const paid = Math.min(wagesDue, Math.max(0, gross));
  return { demand, capacity, revenue, gross, profit: gross - paid - h.fixed - h.marketing, wagesDue };
}

const NO_EVENT: HealthEventEffect = { demandFactor: 1, capacityFactor: 1, extraCostShare: 0 };

/** Capacity one more worker of normal productivity adds per hour (stage and expansion bonuses included). */
function capacityPerWorker(c: HealthCompany, cfg: BalanceConfig): number {
  const sc = cfg.startups;
  const stage = clamp(Math.floor(c.stage), 0, sc.stages.awarenessCaps.length - 1);
  return (
    (teamCapacityCents([10_000], c.sector, sc) *
      (1 + sc.stages.capacityBonusPerStage * stage) *
      expansionCapacityFactor(c.expansionLevel, sc)) /
    cfg.time.quarterHours
  );
}

/** Splits the last hour (or the modelled first hour) into the knobs of `simulate`. */
function baseHour(c: HealthCompany, x: HealthExtras, cfg: BalanceConfig): { hour: Hour; estimated: boolean } {
  const sc = cfg.startups;
  const hours = cfg.time.quarterHours;
  const awareness = Math.max(sc.awareness.min, c.awarenessBps / 10_000);
  const quality = clamp(c.qualityBps / 10_000, 0, 1);
  const event = x.event?.now ?? NO_EVENT;
  const campaign = 1 + (c.campaign ? c.campaign.demandBps / 10_000 : 0);
  const momentum = Math.max(1, x.momentum ?? 1);
  const pricing = priceEffect(c.priceLevel, quality, sc);
  const stage = clamp(Math.floor(c.stage), 0, sc.stages.awarenessCaps.length - 1);
  const live = c.live;
  const qualityFactor = 0.5 + 0.5 * quality;
  const boosts = pricing.demand * event.demandFactor * campaign * momentum;

  if (live) {
    const capacity = live.capacityPerHourCents / Math.max(0.05, event.capacityFactor);
    const sold = Math.min(live.demandPerHourCents, live.capacityPerHourCents);
    const own = live.revenuePerHourCents - live.contractRevenuePerHourCents;
    const cogs =
      Math.max(0, sold * (1 - sc.grossMargin[c.sector]) + own * event.extraCostShare) +
      live.contractRevenuePerHourCents * (1 - sc.contractWork.grossMargin);
    // What is left after goods, AI wages, fixed costs and marketing went to the players.
    const playerPaid = Math.max(
      0,
      live.revenuePerHourCents -
        live.profitPerHourCents -
        live.fixedPerHourCents -
        live.marketingPerHourCents -
        live.aiWagesPerHourCents -
        cogs,
    );
    const factor = live.payFactorBps / 10_000;
    const playerWagesDue =
      factor > 0.001 ? playerPaid / factor : c.lastQuarter ? c.lastQuarter.wagesCents / hours : playerPaid;
    return {
      estimated: false,
      hour: {
        reach: live.demandPerHourCents / Math.max(1e-9, awareness * qualityFactor * boosts),
        awareness,
        quality,
        priceLevel: c.priceLevel,
        event,
        campaign,
        momentum,
        capacity,
        aiWorkers: c.aiWorkers,
        contractWork: c.contractWork,
        marketing: live.marketingPerHourCents,
        fixed: live.fixedPerHourCents,
        playerWagesDue,
      },
    };
  }
  // Before the first hour: the middle of the owner's market range stands in for the hidden market size.
  const market = Math.sqrt(Math.max(1, c.estimateLowCents) * Math.max(1, c.estimateHighCents));
  return {
    estimated: true,
    hour: {
      reach: market / 4 / hours,
      awareness,
      quality,
      priceLevel: c.priceLevel,
      event,
      campaign,
      momentum,
      capacity:
        (c.capacityCents *
          (1 + sc.stages.capacityBonusPerStage * stage) *
          expansionCapacityFactor(c.expansionLevel, sc)) /
        hours,
      aiWorkers: c.aiWorkers,
      contractWork: c.contractWork,
      marketing: c.marketingCentsPerQuarter / hours,
      fixed: fixedCostCents(c.tier, cfg, c.expansionLevel) / hours,
      playerWagesDue: c.lastQuarter ? c.lastQuarter.wagesCents / hours : 0,
    },
  };
}

function statusOf(score: number, cfg: BalanceConfig): HealthStatus {
  const s = cfg.companyHealth.status;
  return score >= s.good ? "good" : score >= s.ok ? "ok" : score >= s.weak ? "weak" : "critical";
}

/** Marketing per quarter that buys half the possible awareness gain: the sensible budget for growth. */
export function suggestedMarketingCents(c: HealthCompany, cfg: BalanceConfig = BALANCE): number {
  const market = Math.sqrt(Math.max(1, c.estimateLowCents) * Math.max(1, c.estimateHighCents));
  const a = cfg.startups.awareness;
  const half = Math.max(a.marketingMinHalfSaturationCents, (market / 4) * a.marketingHalfSaturationShare);
  // the page's marketing slider ends at a fifth of the quarter's upper market estimate
  const max = Math.max(100_000, Math.round(c.estimateHighCents / 4 / 5 / 1_000) * 1_000);
  return Math.min(max, Math.round(half / 1_000) * 1_000);
}

/** Awareness one quarter of this marketing adds (diminishing returns, see marketingGain). */
function awarenessFromMarketing(marketingCents: number, c: HealthCompany, cfg: BalanceConfig): number {
  const market = Math.sqrt(Math.max(1, c.estimateLowCents) * Math.max(1, c.estimateHighCents));
  return marketingGain(marketingCents, market, cfg.startups);
}

/**
 * Rates the eight factors of a player company. Every factor says how far it is from what profit needs (0..100),
 * why in numbers, and how much more the hour would earn once it is fixed.
 */
export function companyHealth(
  company: HealthCompany,
  cfg: BalanceConfig = BALANCE,
  extras: HealthExtras = {},
): CompanyHealth {
  const hc = cfg.companyHealth;
  const sc = cfg.startups;
  const { hour, estimated } = baseHour(company, extras, cfg);
  const base = simulate(hour, company, cfg);
  const gain = (h: Partial<Hour>) => Math.max(0, simulate({ ...hour, ...h }, company, cfg).profit - base.profit);
  const stage = clamp(Math.floor(company.stage), 0, sc.stages.awarenessCaps.length - 1);
  const cap = Math.max(sc.awareness.min, sc.stages.awarenessCaps[stage] ?? 1);
  const perWorker = capacityPerWorker(company, cfg) * hour.event.capacityFactor;
  const freeSlots = Math.max(0, company.maxEmployees - company.headcount);
  const factors: HealthFactor[] = [];
  const add = (
    key: HealthFactorKey,
    share: number,
    reason: HealthFactor["reason"],
    impact: number,
    levers: HealthLever[],
  ) => {
    const score = Math.round(clamp(share, 0, 1) * 100);
    const impactCents = impact >= hc.minImpactCents ? cents(impact) : 0;
    factors.push({ key, score, status: statusOf(score, cfg), reason, impactCents, levers });
  };
  const demand = base.demand;
  const capacity = base.capacity;

  // 1. Awareness: enough customers know the company to fill what it can make?
  {
    const a = hour.awareness;
    const needed = demand >= capacity ? a : (a * capacity) / Math.max(1, demand);
    const target = Math.min(cap, needed);
    const capped = needed > cap + 1e-6;
    const share = demand >= capacity ? 1 : a / needed;
    const marketing = suggestedMarketingCents(company, cfg);
    const atCap = capped && a >= cap - 0.005;
    const skill = nextSkill(company);
    const levers: HealthLever[] = [];
    // At the stage's cap only the next stage helps; more marketing would buy nothing.
    if (atCap && skill) levers.push({ kind: "skill", skill });
    if (
      !atCap &&
      company.marketingCentsPerQuarter < marketing &&
      awarenessFromMarketing(marketing, company, cfg) > 0.001
    )
      levers.push({ kind: "marketing", cents: marketing });
    const campaign = cheapestCampaign(company);
    if (campaign && demand < capacity) levers.push(campaign);
    levers.push({ kind: "move", goal: "awareness" });
    add(
      "awareness",
      share,
      demand >= capacity
        ? {
            key: "awareness.enough",
            values: { awarenessPct: pct(a), demandCents: cents(demand), capacityCents: cents(capacity) },
          }
        : atCap
          ? { key: "awareness.capped", values: { awarenessPct: pct(a), capPct: pct(cap), stage } }
          : {
              key: "awareness.low",
              values: {
                awarenessPct: pct(a),
                neededPct: pct(target),
                demandCents: cents(demand),
                capacityCents: cents(capacity),
              },
            },
      target > a ? gain({ awareness: target }) : 0,
      levers,
    );
  }

  // 2. Capacity: sold out loses sales, idle paid capacity costs wages.
  {
    if (demand > capacity) {
      const missing = demand - capacity;
      const count = Math.max(1, Math.ceil(missing / Math.max(1, perWorker)));
      const fit = Math.min(count, freeSlots);
      // More hands at AI wages, as many as there are places; without a free place, the first one after growing.
      const hands = Math.max(1, fit);
      const impact = gain({
        capacity: hour.capacity + (hands * perWorker) / hour.event.capacityFactor,
        aiWorkers: hour.aiWorkers + hands,
      });
      const levers: HealthLever[] = [];
      if (fit > 0) levers.push({ kind: "hireAi", count: fit });
      if (fit < count) levers.push(company.canExpand ? { kind: "expand" } : { kind: "upgrade" });
      if (hour.priceLevel !== "premium" && hour.quality >= sc.pricing.premiumMinQuality)
        levers.push({ kind: "price", level: "premium" });
      add(
        "capacity",
        capacity / demand,
        {
          key: fit < count ? "capacity.soldOutFull" : "capacity.soldOut",
          values: { demandCents: cents(demand), capacityCents: cents(capacity), count, free: freeSlots },
        },
        impact,
        levers,
      );
    } else {
      const idle = capacity - demand;
      const spare = Math.min(hour.aiWorkers, Math.floor(idle / Math.max(1, perWorker)));
      const dismiss =
        spare > 0
          ? gain({
              aiWorkers: hour.aiWorkers - spare,
              capacity: hour.capacity - (spare * perWorker) / hour.event.capacityFactor,
            })
          : 0;
      const contract = hour.contractWork ? 0 : gain({ contractWork: true });
      const impact = Math.max(dismiss, contract);
      const options: [number, HealthLever][] = [
        [contract, { kind: "contractWork" }],
        [dismiss, { kind: "dismissAi", count: spare }],
      ];
      const levers = options
        .filter(([v]) => v > 0)
        .sort((x, y) => y[0] - x[0])
        .map(([, l]) => l);
      const costs = Math.max(1, base.wagesDue + hour.fixed);
      add(
        "capacity",
        1 - impact / costs,
        impact > 0
          ? {
              key: "capacity.idle",
              values: {
                utilizationPct: pct(demand / Math.max(1, capacity)),
                idleCents: cents(idle),
                demandCents: cents(demand),
                capacityCents: cents(capacity),
              },
            }
          : {
              key: "capacity.fits",
              values: { utilizationPct: pct(demand / Math.max(1, capacity)), capacityCents: cents(capacity) },
            },
        impact,
        levers,
      );
    }
  }

  // 3. Quality: more demand, and premium needs it.
  {
    const q = hour.quality;
    const target = Math.max(hc.qualityTarget, hour.priceLevel === "premium" ? sc.pricing.premiumMinQuality : 0);
    const scared = hour.priceLevel === "premium" && q < sc.pricing.premiumMinQuality;
    add(
      "quality",
      scared ? Math.min(q / target, 0.3) : q / target,
      scared
        ? { key: "quality.premium", values: { qualityPct: pct(q), neededPct: pct(sc.pricing.premiumMinQuality) } }
        : q >= target
          ? { key: "quality.good", values: { qualityPct: pct(q) } }
          : { key: "quality.low", values: { qualityPct: pct(q), neededPct: pct(target) } },
      q < target ? gain({ quality: target }) : 0,
      q < target
        ? [
            ...(scared ? [{ kind: "price", level: "normal" } as const] : []),
            ...(nextSkill(company) ? [{ kind: "skill", skill: nextSkill(company)! } as const] : []),
            { kind: "train" },
            { kind: "move", goal: "quality" },
          ]
        : [],
    );
  }

  // 4. Image: crises (scandals, strikes, bad reviews) and campaigns move demand.
  {
    const ev = extras.event ?? null;
    if (ev && ev.polarity === "crisis") {
      const worst = {
        demandFactor: Math.min(ev.now.demandFactor, ev.full.demandFactor),
        capacityFactor: Math.min(ev.now.capacityFactor, ev.full.capacityFactor),
        extraCostShare: Math.max(ev.now.extraCostShare, ev.full.extraCostShare),
      };
      const hit = Math.max(1 - worst.demandFactor, 1 - worst.capacityFactor, worst.extraCostShare);
      // What the crisis costs at its worst (an open crisis is about to bite in full) against a calm hour.
      const atWorst = simulate({ ...hour, event: worst }, company, cfg);
      const calm = simulate({ ...hour, event: NO_EVENT }, company, cfg);
      add(
        "image",
        hc.imageCalm - hit * hc.imageHitWeight,
        { key: "image.crisis", values: { hitPct: pct(hit), severity: ev.severity } },
        Math.max(0, calm.profit - Math.min(base.profit, atWorst.profit)),
        [{ kind: "event" }],
      );
    } else if (ev && ev.polarity === "chance") {
      const won = gain({ event: ev.full });
      add(
        "image",
        ev.now.demandFactor > 1 || ev.now.capacityFactor > 1 ? 1 : hc.imageCalm,
        {
          key: ev.now.demandFactor > 1 ? "image.chanceWon" : "image.chance",
          values: { gainPct: pct(ev.full.demandFactor - 1) },
        },
        won,
        won > 0 ? [{ kind: "event" }] : [],
      );
    } else {
      const running = hour.campaign > 1;
      const campaign = cheapestCampaign(company);
      add(
        "image",
        running ? 1 : hc.imageCalm,
        running
          ? { key: "image.campaign", values: { gainPct: pct(hour.campaign - 1) } }
          : { key: "image.calm", values: {} },
        0,
        !running && campaign && demand < capacity ? [campaign] : [],
      );
    }
  }

  // 5. Price: the strategy that earns the most right now.
  {
    const levels: PriceLevel[] = ["budget", "normal", "premium"];
    const results = levels.map((level) => ({ level, r: simulate({ ...hour, priceLevel: level }, company, cfg) }));
    const best = results.reduce((a, b) => (b.r.profit > a.r.profit + 1 ? b : a), {
      level: hour.priceLevel,
      r: base,
    });
    const impact = best.r.profit - base.profit;
    const share = best.r.gross > 0 ? clamp(base.gross / best.r.gross, 0, 1) : 1;
    add(
      "price",
      impact >= hc.minImpactCents ? share : 1,
      impact >= hc.minImpactCents
        ? { key: `price.better.${best.level}`, values: { gainCents: cents(impact) } }
        : { key: `price.fits.${hour.priceLevel}`, values: {} },
      impact,
      impact >= hc.minImpactCents ? [{ kind: "price", level: best.level }] : [],
    );
  }

  // 6. Team: wages the hour can pay, skills for the next stage.
  {
    const next = company.stages.find((s) => !s.reached && s.stage > company.stage) ?? null;
    const missing = next ? next.skills.filter((s) => !s.coveredBy && !s.coveredByAi) : [];
    const covered = next && next.skills.length > 0 ? 1 - missing.length / next.skills.length : 1;
    const pay = clamp((company.live?.payFactorBps ?? company.payFactorBps) / 10_000, 0, 1);
    const stageShare = hc.teamFloor + (1 - hc.teamFloor) * covered;
    let impact = 0;
    if (next && missing.length > 0) {
      const factor =
        (1 + sc.stages.capacityBonusPerStage * (stage + 1)) / (1 + sc.stages.capacityBonusPerStage * stage);
      const nextCap = sc.stages.awarenessCaps[Math.min(stage + 1, sc.stages.awarenessCaps.length - 1)] ?? 1;
      impact = gain({
        capacity: hour.capacity * factor,
        aiWorkers: hour.aiWorkers + missing.length,
        quality: Math.min(1, hour.quality + sc.stages.qualityBonusPerStage),
        awareness: hour.awareness >= cap - 0.005 ? Math.min(nextCap, hour.awareness + 0.05) : hour.awareness,
      });
    }
    const levers: HealthLever[] = missing.slice(0, 2).map((s) => ({ kind: "skill", skill: s.key }));
    if (missing.length > 0) levers.push({ kind: "train" });
    add(
      "team",
      Math.min(pay, stageShare),
      pay < 0.999
        ? { key: "team.unpaid", values: { payPct: pct(pay), wagesCents: cents(base.wagesDue) } }
        : next && missing.length > 0
          ? { key: "team.missing", values: { count: missing.length, stage: next.stage } }
          : next
            ? { key: "team.ready", values: { stage: next.stage } }
            : { key: "team.complete", values: { headcount: company.headcount } },
      impact,
      levers,
    );
  }

  // 7. Cash and costs: how long the cash lasts, open bills, money that buys nothing.
  {
    const free = company.cashCents - company.unpaidCents;
    const burn = Math.max(0, -base.profit);
    const costs = hour.fixed + hour.marketing;
    // Marketing at the stage's awareness cap buys nothing more.
    const wasted = hour.marketing > 0 && hour.awareness >= cap - 0.005 ? gain({ marketing: 0 }) : 0;
    let share: number;
    let reason: HealthFactor["reason"];
    const levers: HealthLever[] = [];
    if (company.unpaidCents > 0 || company.distress) {
      const left = Math.max(0, company.graceQuarters - company.distressQuarters);
      share = 0.25 * (left / Math.max(1, company.graceQuarters));
      reason = { key: "cash.unpaid", values: { unpaidCents: company.unpaidCents, quarters: Math.max(1, left) } };
      levers.push({ kind: "deposit", cents: company.unpaidCents });
    } else if (burn > 0) {
      const runway = free / burn;
      share = 0.9 * clamp(runway / hc.runwayTargetHours, 0, 1);
      reason = { key: "cash.burn", values: { hours: Math.floor(runway), lossCents: cents(burn), cashCents: free } };
      if (runway < hc.runwayTargetHours)
        levers.push({ kind: "deposit", cents: Math.max(0, cents(burn * hc.runwayTargetHours - free)) });
    } else if (free < costs * hc.reserveHours) {
      share = 0.7;
      reason = { key: "cash.thin", values: { cashCents: free, hours: hc.reserveHours } };
    } else {
      share = 1;
      reason = { key: "cash.fine", values: { cashCents: free } };
    }
    if (wasted > 0) {
      share = Math.min(share, 0.75);
      levers.unshift({ kind: "marketing", cents: 0 });
      if (share >= 0.7) reason = { key: "cash.marketingWasted", values: { marketingCents: cents(hour.marketing) } };
    }
    levers.push({ kind: "move", goal: "cash" });
    add("cash", share, reason, wasted, levers);
  }

  // 8. Momentum: solved tasks lift demand (ADR-148); it fades, so it has to be kept up.
  {
    const max = cfg.companyTasks.momentum.maxBps / 10_000;
    const target = 1 + max * hc.momentumTargetShare;
    const m = hour.momentum;
    const open = Math.max(0, extras.openTasks ?? 0);
    add(
      "momentum",
      hc.momentumFloor + (1 - hc.momentumFloor) * clamp((m - 1) / Math.max(1e-9, target - 1), 0, 1),
      {
        key: m >= target ? "momentum.high" : open > 0 ? "momentum.open" : "momentum.low",
        values: { boostPct: pct(m - 1), maxPct: pct(max), open },
      },
      m < target ? gain({ momentum: target }) : 0,
      m < target ? [{ kind: "tasks", open }] : [],
    );
  }

  const byImpact = [...factors].sort((a, b) => b.impactCents - a.impactCents || a.score - b.score);
  const weakest = byImpact[0]!.impactCents > 0 ? byImpact[0]! : [...factors].sort((a, b) => a.score - b.score)[0]!;
  return {
    factors,
    weakest: weakest.key,
    profitPerHourCents: company.live ? company.live.profitPerHourCents : cents(base.profit),
    score: Math.round(factors.reduce((s, f) => s + f.score, 0) / factors.length),
    estimated,
  };
}

/** Profit of the hour as the analysis rebuilds it (should match the last hour; used by the tests). */
export function modelProfitCents(company: HealthCompany, cfg: BalanceConfig = BALANCE, extras: HealthExtras = {}) {
  return cents(simulate(baseHour(company, extras, cfg).hour, company, cfg).profit);
}

/** The first uncovered skill of the next stage. */
function nextSkill(c: HealthCompany): string | null {
  const next = c.stages.find((s) => !s.reached && s.stage > c.stage);
  return next?.skills.find((s) => !s.coveredBy && !s.coveredByAi)?.key ?? null;
}

/** The cheapest campaign the company can afford from its free cash, or null. */
function cheapestCampaign(c: HealthCompany): HealthLever | null {
  if (!c.campaignCosts || c.campaign) return null;
  const free = c.cashCents - c.unpaidCents;
  const kinds = (Object.keys(c.campaignCosts) as CampaignKind[])
    .filter((k) => c.campaignCosts![k] <= free)
    .sort((a, b) => c.campaignCosts![a] - c.campaignCosts![b]);
  const kind = kinds[0];
  return kind ? { kind: "campaign", campaign: kind, costCents: c.campaignCosts[kind] } : null;
}
