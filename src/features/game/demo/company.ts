import type { DemoCompanyEventsState } from "./company-events";
import type { DemoListedState, ListedHourFacts } from "./listed";
import type { EventModifiers } from "@/lib/sim/company-events";
import {
  campaignCostCents,
  campaignDemandFactor,
  campaignFactor,
  campaignLuck,
  campaignResonance,
  type Campaign,
} from "@/lib/sim/campaigns";
import { BALANCE } from "@/config/balance";
import { awarenessAdd, awarenessCap, awarenessOfCap } from "@/lib/sim/awareness";
import { SKILL_BRANCHES, type SkillBranch } from "@/config/skills";
import type { SectorKey } from "@/components/pixel/art";
import { matchScore, productivityBps } from "@/lib/sim/skills";
import {
  aiSubscribedE6,
  ipoFilled,
  capacityCents,
  capitalIncreasePriceCents,
  closeStartupHour,
  issueAiFactor,
  postIssueFairCents,
  closeStartupQuarter,
  founderFactor,
  issuePriceCents,
  needsFullTimeFounder,
  companyStage,
  productOf,
  fixedCostCents,
  maxEmployees,
  canExpand,
  effectivePotentialCents,
  expansionCostCents,
  founderPayoutCents,
  isValidFounderPayout,
  type PriceLevel,
  type StartupHourInput,
  potentialEstimate,
  potentialFromUniform,
  startupValueCents,
  type StartupTier,
} from "@/lib/sim/startup";
import { formatMoney } from "@/lib/format";
import {
  EMPTY_STRENGTHS,
  strengthsInstant,
  strengthsNextReward,
  strengthsOverall,
  strengthsRewardBps,
  strengthsStep,
} from "@/lib/sim/company-strengths";
import {
  reputationDemandFactor,
  reputationDrivers,
  reputationStep,
  reputationTargetAll,
} from "@/lib/sim/company-reputation";
import { DEMO_COMPANIES } from "@/lib/demo/market";
import { dissolve, isInsolvent } from "@/lib/sim/insolvency";
import { hasForbiddenSymbol, isValidBanner, isValidLogo, type CompanyLogoData } from "@/lib/sim/logo";
import {
  GameError,
  type CampaignKind,
  type CompanyAutopilot,
  type CompanyAwareness,
  type CompanyWorth,
  type ChatMessage,
  type CloseCompanyResult,
  type Dissolution,
  type CompanyPosting,
  type CompanyQuarter,
  type CreatePostingInput,
  type FoundCompanyInput,
  type GameEngine,
  type GameErrorKey,
  type MyCompany,
  type Offer,
} from "../types";

/*
 * Demo part for player companies (ADR-057). Same formulas as the database; a quarter
 * closes every six hours, or at once with `closeQuarterNow` (button in demo mode).
 * In the demo there are no other players, so applications and team stay empty.
 */

const { startups, company: companyCfg, jobs } = BALANCE;
const HOUR_MS = 3_600_000;
const reputationCfg = BALANCE.companyHealth.reputation;
const QUARTER_MS = BALANCE.time.quarterHours * HOUR_MS;
const SUBSCRIPTION_MS = startups.ipo.subscriptionMinutes * 60_000;
const berlinDay = (at: number) => new Intl.DateTimeFormat("en-CA", { timeZone: BALANCE.time.timezone }).format(at);

/** One operating hour of the demo company (ADR-072). */
interface DemoHour {
  at: number;
  demandCents: number;
  capacityCents: number;
  revenueCents: number;
  cogsCents: number;
  fixedCents: number;
  marketingCents: number;
  aiWagesCents: number;
  payFactorBps: number;
  profitCents: number;
  /** Contract work (ADR-083); older demo hours have none. */
  contractRevenueCents?: number;
  /** Automatic CEO payout (ADR-086). */
  founderPayoutCents?: number;
  /** Supply contracts and silent partners (ADR-098). */
  supplyRevenueCents?: number;
  supplyFeePaidCents?: number;
  supplyFeeIncomeCents?: number;
  supplyGoodsCents?: number;
  stakePayoutCents?: number;
  /** ADR-180: AI capacity used, awareness step of the hour. */
  aiUtilizationBps?: number;
  awarenessBefore?: number;
  awarenessAfter?: number;
  awarenessParts?: { wordOfMouth: number; marketing: number; decay: number; extra: number; cap: number };
  /** ADR-183: reputation after the hour, its target and the drivers. */
  reputation?: number;
  reputationTarget?: number;
  reputationDrivers?: Record<string, number>;
}

/** One hour as the deals part sees it (ADR-098). */
export type DemoHourView = Pick<DemoHour, "at" | "demandCents" | "capacityCents" | "profitCents">;

interface DemoReport extends CompanyQuarter {
  closedAt: number;
}

export interface DemoCompanyState {
  id: string;
  /** ADR-180: awareness added by tasks and the autopilot since the last closed hour. */
  awarenessBoost?: number;
  /** ADR-188: the awareness cap of the last closed hour (tier, stage, expansion). */
  awarenessCap?: number;
  /** ADR-183: reputation 0..100 (listed companies mirror the listed state). */
  reputation?: number;
  name: string;
  idea: string;
  sector: SectorKey;
  color: string;
  tier: StartupTier;
  foundedAt: number;
  potentialAnnualCents: number;
  awareness: number;
  quality: number;
  /** Task momentum (ADR-148): demand multiplier from solved tasks, drifts toward 1 each hour. */
  taskMomentum?: number;
  quartersActive: number;
  cashCents: number;
  unpaidCents: number;
  marketingCents: number;
  aiWorkers: number;
  /** Hourly operations (ADR-072): start of the next hour to close, the last day of hours, this quarter's hours. */
  lastHourAt?: number;
  hours?: DemoHour[];
  quarterHours?: DemoHour[];
  /** Skills AI workers were hired for (ADR-071); older demo companies have none. */
  aiWorkerSkills?: string[];
  lastClosedAt: number;
  reports: DemoReport[];
  estimateSeeds: [number, number];
  postings: CompanyPosting[];
  seq: number;
  /** Product (ADR-062); older demo companies get the first product of their sector. */
  productKey?: string;
  /** Pixel logo (ADR-065). */
  logo?: CompanyLogoData | null;
  /** Pixel banner (ADR-078). */
  banner?: CompanyLogoData | null;
  /** Going public (ADR-067). In the demo AI investors and made-up fellow players subscribe. */
  listing?: {
    status: "subscription" | "listed";
    ticker: string;
    sharesTotal: number;
    founderShares: number;
    lastPriceCents: number | null;
    offer: {
      id: string;
      kind: "ipo" | "capital_increase";
      priceCents: number;
      offered: number;
      /** Start of the subscription (older demo offers: derived from the end). */
      startsAt?: number;
      endsAt: number;
      /** ADR-170: AI investors subscribe only up to the fair value (1 or 0; older demo offers: 1). */
      aiFactor?: number;
    } | null;
    /** ADR-170: start of the last capital increase (one per capitalIncreaseCooldownHours). */
    lastCapitalIncreaseAt?: number;
  } | null;
  /** Quarter closes in a row with open bills (ADR-058). */
  distressQuarters?: number;
  /** Profit levers and expansion (ADR-083); older demo companies: normal price, contract work on, level 0. */
  priceLevel?: PriceLevel;
  contractWork?: boolean;
  expansionLevel?: number;
  /** Automatic CEO payout share (ADR-086), default 0. */
  founderPayoutBps?: number;
  /** Crises, chances and news (ADR-091). */
  events?: DemoCompanyEventsState;
  /** Marketing campaign (ADR-097). */
  campaign?: (Campaign & { id: string; costCents: number; luck: number }) | null;
  chat?: ChatMessage[];
  /** Listed companies (ADR-167): research, mood, reputation, books, board (demo/listed.ts). */
  listed?: DemoListedState;
}

export interface DemoDissolution extends Dissolution {
  atMs: number;
}

export interface CompanyHost {
  company(): DemoCompanyState | null;
  setCompany(company: DemoCompanyState | null): void;
  level(): number;
  cashCents(): number;
  addCash(cents: number): void;
  addXp(base: number): number;
  hasJob(): boolean;
  branchScores(): Record<SkillBranch, number>;
  /** Learned skill keys of the founder (the only team member with skills in the demo). */
  learnedSkills(): string[];
  /** Name check like for nicknames. */
  nameViolation(name: string): GameErrorKey | null;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
  nickname(): string;
  avatarKey(): string;
  /** Forced loan of the founder (ADR-058). */
  addDebt(cents: number): void;
  lastDissolution(): DemoDissolution | null;
  setLastDissolution(value: DemoDissolution): void;
  foundingLockedUntil(): number | null;
  lockFounding(until: number): void;
  startFounderNotice(): void;
  /** Effect of the company's current crisis or chance in this hour (ADR-091). */
  eventModifiers?(company: DemoCompanyState, at: number): EventModifiers;
  /** Severity of an open or running crisis, 0 for none (ADR-183: reputation). */
  crisisSeverity?(company: DemoCompanyState): number;
  /** Silent partners' share of a profitable hour, paid before the founder (ADR-098); returns what was paid. */
  stakePayout?(company: DemoCompanyState, profitCents: number, freeCashCents: number): number;
  /** Listed companies (ADR-167): terms of the hour, the board's limits, the hour's follow-up (demo/listed.ts). */
  listed?: {
    hourTerms(company: DemoCompanyState, at: number): StartupHourInput["listed"] | undefined;
    afterHour(company: DemoCompanyState, hour: ListedHourFacts): void;
    payoutCapBps(company: DemoCompanyState, at: number): number;
    reservedCents(company: DemoCompanyState): number;
    withdraw(company: DemoCompanyState, amountCents: number): void;
    withdrawn(company: DemoCompanyState, amountCents: number): void;
    payoutCheck(company: DemoCompanyState, bps: number): void;
    strategyCheck(company: DemoCompanyState, priceLevel: PriceLevel): void;
  };
  /** Supply contracts after the hour (ADR-098): books into the company and returns the hour's supply lines. */
  afterHour?(
    company: DemoCompanyState,
    hour: DemoHourView,
  ): Partial<Pick<DemoHour, "supplyRevenueCents" | "supplyFeePaidCents" | "supplyFeeIncomeCents" | "supplyGoodsCents">>;
}

/** Campaign prices from the last hour's demand (ADR-097). */
function campaignCosts(company: DemoCompanyState): Record<CampaignKind, number> {
  const last = company.hours?.at(-1);
  const demand = last
    ? last.demandCents
    : (company.potentialAnnualCents / 4 / BALANCE.time.quarterHours) * company.awareness;
  return {
    flyer: campaignCostCents("flyer", demand),
    online: campaignCostCents("online", demand),
    tv: campaignCostCents("tv", demand),
  };
}

function campaignView(company: DemoCompanyState): MyCompany["campaign"] {
  const c = company.campaign;
  if (!c || Date.now() >= c.endsAt) return null;
  return {
    id: c.id,
    kind: c.kind,
    startedAt: new Date(c.startedAt).toISOString(),
    endsAt: new Date(c.endsAt).toISOString(),
    costCents: c.costCents,
    demandBps: Math.round((c.demandFactor - 1) * 10_000),
    resonance: campaignResonance(c.luck),
  };
}

export const productKeyOf = (company: Pick<DemoCompanyState, "sector" | "productKey">) =>
  productOf(company.sector, company.productKey ?? "").key;

const smallBusiness = () => companyCfg.tiers.find((t) => t.id === "small_business")!;

export function foundingCostCents(tier: StartupTier): number {
  if (tier === "gmbh") return startups.gmbh.foundingCostCents;
  return tier === "garage" ? startups.garage.foundingCostCents : smallBusiness().foundingCostCents;
}

/** The next self-funded step: garage → small business → GmbH; the AG only by IPO (ADR-067). */
export function nextStep(tier: StartupTier): { tier: StartupTier; level: number; cost: number } | null {
  if (tier === "garage")
    return {
      tier: "small_business",
      level: foundingLevel("small_business"),
      cost: foundingCostCents("small_business") - foundingCostCents("garage") * startups.upgradeCreditShare,
    };
  if (tier === "small_business")
    return {
      tier: "gmbh",
      level: startups.gmbh.minLevel,
      cost: startups.gmbh.foundingCostCents - foundingCostCents("small_business") * startups.upgradeCreditShare,
    };
  return null;
}

export function foundingLevel(tier: StartupTier): number {
  if (tier === "gmbh") return startups.gmbh.minLevel;
  return tier === "garage" ? startups.garage.minLevel : smallBusiness().minLevel;
}

/** The founder's productivity: a player in the first two branches of the sector (ADR-057). */
export function founderProductivityBps(sector: SectorKey, scores: Record<SkillBranch, number>): number {
  const branches = jobs.sectorBranches[sector] ?? [];
  const required = branches.slice(0, 2).map((branch) => ({ branch, minScore: 0 }));
  return productivityBps(matchScore(required, scores));
}

function sectorScore(sector: SectorKey, scores: Record<SkillBranch, number>): number {
  const branches = new Set<SkillBranch>(jobs.sectorBranches[sector] ?? []);
  return SKILL_BRANCHES.filter((b) => branches.has(b)).reduce((sum, b) => sum + scores[b], 0);
}

export function createCompanyEngine(host: CompanyHost) {
  const own = () => {
    const company = host.company();
    if (!company) throw new GameError("company_not_found");
    return company;
  };

  /** Each stage with its skills and who covers them (in the demo only the founder). */
  function stagesOf(company: DemoCompanyState): MyCompany["stages"] {
    const known = new Set(host.learnedSkills());
    const reached = stageOf(company);
    return productOf(company.sector, productKeyOf(company)).stages.map((skills, i) => ({
      stage: i + 1,
      reached: i < reached,
      skills: skills.map((key) => ({
        key,
        coveredBy: known.has(key) ? host.nickname() : null,
        coveredByAi: !known.has(key) && aiSkills(company).includes(key),
      })),
    }));
  }

  const aiSkills = (company: DemoCompanyState) => company.aiWorkerSkills ?? [];

  /** AI workers hired for a skill cover it like a specialist (ADR-071). */
  function stageOf(company: DemoCompanyState): number {
    return companyStage(
      company.sector,
      productKeyOf(company),
      new Set([...host.learnedSkills(), ...aiSkills(company)]),
    );
  }

  /** Keeps at most one AI worker per skill and never more skills than AI workers. */
  function setAiCount(company: DemoCompanyState, count: number) {
    const skills = aiSkills(company);
    const general = company.aiWorkers - skills.length;
    const drop = Math.max(0, company.aiWorkers - count - general);
    company.aiWorkerSkills = drop > 0 ? skills.slice(0, skills.length - drop) : skills;
    company.aiWorkers = count;
    if (needsFullTimeFounder(count) && host.hasJob()) {
      host.startFounderNotice();
      system(
        company,
        `Ab ${startups.fullTimeFromEmployees} Mitarbeitern arbeitet ${host.nickname()} Vollzeit in der Firma.`,
      );
    }
  }

  function productivityList(company: DemoCompanyState): number[] {
    return [
      Math.round(founderProductivityBps(company.sector, host.branchScores()) * founderFactor(host.hasJob())),
      ...Array<number>(company.aiWorkers).fill(10_000),
    ];
  }

  /** One operating hour: sell, pay players and AI workers with the same factor, book fixed costs and marketing. */
  function closeHour(company: DemoCompanyState, at: number) {
    // Task momentum (ADR-148) drifts back toward 1 every hour, so it must be kept up.
    const mom = BALANCE.companyTasks.momentum;
    company.taskMomentum = Math.max(1, 1 + ((company.taskMomentum ?? 1) - 1) * (1 - mom.decayPerHourBps / 10_000));
    const r = closeStartupHour(
      {
        potentialAnnualCents: company.potentialAnnualCents,
        awareness: company.awareness,
        quality: company.quality,
        quartersActive: company.quartersActive,
        cashCents: BigInt(company.cashCents),
      },
      {
        sector: company.sector,
        tier: company.tier,
        marketingCentsPerQuarter: BigInt(company.marketingCents),
        productivityBps: productivityList(company),
        aiWorkers: company.aiWorkers,
        stage: stageOf(company),
        noise: (Math.random() + Math.random() + Math.random() - 1.5) * 2,
        playerWagesCents: 0,
        priceLevel: company.priceLevel ?? "normal",
        contractWork: company.contractWork ?? true,
        expansionLevel: company.expansionLevel ?? 0,
        event: host.eventModifiers?.(company, at),
        campaignFactor: campaignDemandFactor(company.campaign, at),
        taskMomentum: company.taskMomentum ?? 1,
        listed: host.listed?.hourTerms(company, at),
        reputationDemandFactor: reputationDemandFactor(company.reputation ?? reputationCfg.start),
        reputation: company.reputation ?? reputationCfg.start,
      },
    );
    // ADR-180: awareness moves every hour; boosts since the last hour (tasks, autopilot) count as "extra"
    const awarenessExtra = company.awarenessBoost ?? 0;
    company.awarenessBoost = 0;
    company.awareness = r.awareness.next;
    company.awarenessCap = r.awareness.cap;
    const revenue = Number(r.revenueCents);
    const costs = Number(r.cogsCents + r.aiWagesPaidCents + r.fixedCents + r.marketingCents);
    const available = company.cashCents + revenue;
    const paid = Math.min(costs, Math.max(0, available));
    company.cashCents = available - paid;
    company.unpaidCents += costs - paid;
    // Silent partners first (ADR-098), then the automatic CEO payout (ADR-086).
    const reserved = host.listed?.reservedCents(company) ?? 0;
    const stakes =
      Number(r.profitCents) > 0
        ? (host.stakePayout?.(company, Number(r.profitCents), company.cashCents - company.unpaidCents - reserved) ?? 0)
        : 0;
    company.cashCents -= stakes;
    // Automatic CEO payout (ADR-086): a share of a profitable hour, never more than the free cash. Listed companies
    // (ADR-167): never above the board's cap, never from money the board earmarked.
    const payout = Number(
      founderPayoutCents(
        r.profitCents,
        Math.min(company.founderPayoutBps ?? 0, host.listed?.payoutCapBps(company, at) ?? 10_000),
        BigInt(company.cashCents - company.unpaidCents - reserved),
      ),
    );
    if (payout > 0) {
      company.cashCents -= payout;
      host.addCash(payout);
    }
    const hour: DemoHour = {
      at,
      demandCents: Number(r.demandCents),
      capacityCents: Number(r.capacityCents),
      revenueCents: revenue,
      cogsCents: Number(r.cogsCents),
      fixedCents: Number(r.fixedCents),
      marketingCents: Number(r.marketingCents),
      aiWagesCents: Number(r.aiWagesPaidCents),
      payFactorBps: r.payFactorBps,
      profitCents: Number(r.profitCents),
      contractRevenueCents: Number(r.contractRevenueCents),
      founderPayoutCents: payout,
      stakePayoutCents: stakes,
      aiUtilizationBps: r.aiUtilizationBps,
      awarenessBefore: r.awareness.before - awarenessExtra,
      awarenessAfter: r.awareness.next,
      awarenessParts: {
        wordOfMouth: r.awareness.wordOfMouth,
        marketing: r.awareness.marketing,
        decay: r.awareness.decay,
        extra: awarenessExtra,
        cap: r.awareness.cap,
      },
    };
    // ADR-183: every company has a reputation; listed companies add their shareholder target (demo/listed.ts)
    const drivers = reputationDrivers({
      quality: company.quality,
      demandCents: hour.demandCents,
      capacityCents: hour.capacityCents,
      priceLevel: company.priceLevel ?? "normal",
      payFactorBps: r.payFactorBps,
      unpaidCents: company.unpaidCents,
      crisisSeverity: host.crisisSeverity?.(company) ?? 0,
      campaign: campaignDemandFactor(company.campaign, at) !== 1,
    });
    if (!company.listing || company.listing.status !== "listed") {
      const target = reputationTargetAll(drivers);
      company.reputation = reputationStep(
        company.reputation ?? reputationCfg.start,
        target,
        reputationCfg.adjustPerHour,
      );
      hour.reputation = company.reputation;
      hour.reputationTarget = target;
      hour.reputationDrivers = { ...drivers };
    }
    const supply = host.afterHour?.(company, hour) ?? {};
    Object.assign(hour, supply);
    hour.profitCents +=
      (supply.supplyRevenueCents ?? 0) +
      (supply.supplyFeeIncomeCents ?? 0) -
      (supply.supplyFeePaidCents ?? 0) -
      (supply.supplyGoodsCents ?? 0);
    company.hours = [...(company.hours ?? []), hour].slice(-24);
    company.quarterHours = [...(company.quarterHours ?? []), hour];
    company.lastHourAt = at + HOUR_MS;
    host.listed?.afterHour(company, {
      at,
      demandCents: hour.demandCents,
      capacityCents: hour.capacityCents,
      revenueCents: revenue,
      cogsCents: hour.cogsCents,
      aiWagesCents: hour.aiWagesCents,
      fixedCents: hour.fixedCents,
      listedCostsCents: Number(r.listedCostsCents),
      marketingCents: hour.marketingCents,
      profitCents: Number(r.profitCents),
      payoutCents: payout,
      reputationDrivers: drivers,
      payFactorBps: r.payFactorBps,
    });
  }

  /** Closes the quarter: sums its hours, moves awareness and quality on, pays XP, counts distress. */
  function closeQuarter(company: DemoCompanyState, now: number) {
    // Hours not run yet (demo shortcut) are run first, so a quarter always has its hours.
    const missing = BALANCE.time.quarterHours - (company.quarterHours?.length ?? 0);
    for (let i = 0; i < missing; i++) closeHour(company, company.lastHourAt ?? now);
    const hours = company.quarterHours ?? [];
    const sum = (pick: (h: DemoHour) => number) => hours.reduce((total, h) => total + pick(h), 0);
    const result = closeStartupQuarter(
      {
        potentialAnnualCents: company.potentialAnnualCents,
        awareness: company.awareness,
        quality: company.quality,
        quartersActive: company.quartersActive,
        cashCents: BigInt(company.cashCents),
      },
      {
        sector: company.sector,
        tier: company.tier,
        marketingCents: BigInt(company.marketingCents),
        productivityBps: productivityList(company),
        aiWorkers: company.aiWorkers,
        teamSectorScore: sectorScore(company.sector, host.branchScores()),
        stage: stageOf(company),
        noise: 0,
        priceLevel: company.priceLevel ?? "normal",
        expansionLevel: company.expansionLevel ?? 0,
      },
    );
    const demand = sum((h) => h.demandCents);
    const capacity = sum((h) => h.capacityCents);
    const profit = sum((h) => h.profitCents);
    company.quarterHours = [];
    if (company.unpaidCents > 0) {
      company.aiWorkers = 0;
      company.aiWorkerSkills = [];
    }
    company.awareness = result.next.awareness;
    company.quality = result.next.quality;
    company.quartersActive += 1;
    company.lastClosedAt = now;
    company.estimateSeeds = [Math.random(), Math.random()];
    company.seq += 1;
    company.reports.push({
      label: `Q${((company.seq - 1) % 4) + 1}/${Math.floor((company.seq - 1) / 4) + 1}`,
      demandCents: demand,
      capacityCents: capacity,
      revenueCents: sum((h) => h.revenueCents),
      cogsCents: sum((h) => h.cogsCents),
      fixedCents: sum((h) => h.fixedCents),
      aiWorkerCents: sum((h) => h.aiWagesCents),
      marketingCents: sum((h) => h.marketingCents),
      wagesCents: 0,
      operatingProfitCents: profit,
      utilizationBps: capacity > 0 ? Math.round(Math.min(1, demand / capacity) * 10_000) : 10_000,
      bonusCents: 0,
      closedAt: now,
    });
    company.reports = company.reports.slice(-12);
    if (profit > 0) host.addXp(BALANCE.progression.xpSources.profitableCompanyQuarter.xp);
    const last = company.reports.at(-1)!;
    system(
      company,
      `Quartal ${last.label}: Umsatz ${formatMoney(last.revenueCents, { whole: true })}, Gewinn ${formatMoney(
        last.operatingProfitCents,
        { whole: true },
      )}.`,
    );
    company.distressQuarters = company.unpaidCents > 0 ? (company.distressQuarters ?? 0) + 1 : 0;
    if (isInsolvent(company.distressQuarters)) {
      dissolveCompany(company, "insolvent", now);
      return;
    }
    if (company.distressQuarters > 0) {
      const left = startups.insolvency.graceQuarters - company.distressQuarters;
      system(
        company,
        `Achtung: offene Rechnungen. Noch ${left} ${left === 1 ? "Quartal" : "Quartale"} bis zur Insolvenz.`,
      );
    }
  }

  function system(company: DemoCompanyState, body: string) {
    const chat = (company.chat ??= []);
    chat.push({
      id: (chat.at(-1)?.id ?? 0) + 1,
      kind: "system",
      author: null,
      avatarKey: null,
      isMe: false,
      isFounder: false,
      body,
      createdAt: new Date().toISOString(),
    });
    company.chat = chat.slice(-startups.chat.historyLimit);
  }

  /** Dissolution with private liability (ADR-058). In the demo there are no employees. */
  function dissolveCompany(company: DemoCompanyState, reason: "insolvent" | "closed", now: number): CloseCompanyResult {
    const r = dissolve({
      companyCashCents: BigInt(company.cashCents),
      unpaidCents: BigInt(company.unpaidCents),
      severancesCents: [],
      founderCashCents: BigInt(Math.max(0, host.cashCents())),
    });
    host.addCash(-Number(r.fromFounderCents));
    if (r.toFounderCents > BigInt(0)) host.addCash(Number(r.toFounderCents));
    if (r.loanCents > BigInt(0)) host.addDebt(Number(r.loanCents));
    if (reason === "insolvent") host.lockFounding(now + startups.insolvency.foundingLockoutDays * 86_400_000);
    host.setLastDissolution({
      companyName: company.name,
      reason,
      at: new Date(now).toISOString(),
      atMs: now,
      totalDebtCents: Number(r.totalDebtCents),
      fromFounderCents: Number(r.fromFounderCents),
      loanCents: Number(r.loanCents),
    });
    host.setCompany(null);
    host.persist();
    return {
      fromCompanyCents: Number(r.fromCompanyCents),
      fromFounderCents: Number(r.fromFounderCents),
      loanCents: Number(r.loanCents),
      toFounderCents: Number(r.toFounderCents),
      totalDebtCents: Number(r.totalDebtCents),
    };
  }

  /** Close every quarter that is due (the demo catches up after a break, at most a day). */
  function catchUp(now = Date.now()) {
    const company = host.company();
    if (!company) return;
    if (company.listing?.offer && (company.listing.offer.endsAt <= now || offerFull(company, now)))
      resolveOffer(company);
    // Hours first, the quarter when its hours are done; at most two days are caught up.
    let steps = 0;
    company.lastHourAt ??= company.lastClosedAt;
    while (host.company() === company && steps < 48) {
      const quarterEnd = company.lastClosedAt + QUARTER_MS;
      if (company.lastHourAt + HOUR_MS <= Math.min(now, quarterEnd)) closeHour(company, company.lastHourAt);
      else if (now >= quarterEnd) closeQuarter(company, quarterEnd);
      else break;
      steps += 1;
    }
    if (host.company() === company && now - company.lastClosedAt >= QUARTER_MS) {
      company.lastClosedAt = now;
      company.lastHourAt = now;
      company.quarterHours = [];
    }
    if (steps > 0) host.persist();
  }

  function liveOf(company: DemoCompanyState): MyCompany["live"] {
    const hours = company.hours ?? [];
    const last = hours.at(-1);
    if (!last) return null;
    const today = berlinDay(Date.now());
    const todays = hours.filter((h) => berlinDay(h.at) === today);
    const quarter = company.quarterHours ?? [];
    return {
      lastHourAt: new Date(last.at + HOUR_MS).toISOString(),
      revenuePerHourCents: last.revenueCents,
      profitPerHourCents: last.profitCents,
      payFactorBps: last.payFactorBps,
      todayRevenueCents: todays.reduce((a, h) => a + h.revenueCents, 0),
      todayProfitCents: todays.reduce((a, h) => a + h.profitCents, 0),
      quarterRevenueCents: quarter.reduce((a, h) => a + h.revenueCents, 0),
      quarterProfitCents: quarter.reduce((a, h) => a + h.profitCents, 0),
      contractRevenuePerHourCents: last.contractRevenueCents ?? 0,
      demandPerHourCents: last.demandCents,
      capacityPerHourCents: last.capacityCents,
      fixedPerHourCents: last.fixedCents,
      aiWagesPerHourCents: last.aiWagesCents,
      marketingPerHourCents: last.marketingCents,
      founderPayoutPerHourCents: last.founderPayoutCents ?? 0,
      todayFounderPayoutCents: todays.reduce((a, h) => a + (h.founderPayoutCents ?? 0), 0),
    };
  }

  function valueCents(company: DemoCompanyState): number {
    const last = company.reports.at(-1);
    return Number(
      startupValueCents(
        BigInt(company.cashCents - company.unpaidCents),
        BigInt(last?.operatingProfitCents ?? 0),
        company.sector,
      ),
    );
  }

  /** THE value of the company (ADR-203): listed at shares x last price, private at the company value. */
  function worthOf(company: DemoCompanyState): CompanyWorth {
    const fundamental = valueCents(company);
    const l = company.listing;
    if (l?.status === "listed" && l.lastPriceCents !== null) {
      return {
        cents: l.sharesTotal * l.lastPriceCents,
        basis: "market_cap",
        companyValueCents: fundamental,
        priceE4: l.lastPriceCents * 100,
        shares: l.sharesTotal,
      };
    }
    return { cents: fundamental, basis: "company_value", companyValueCents: fundamental, priceE4: null, shares: null };
  }

  /** Fraction of the subscription window that has passed. */
  function offerProgress(company: DemoCompanyState, at: number): number {
    const offer = company.listing!.offer!;
    const startsAt = offer.startsAt ?? offer.endsAt - SUBSCRIPTION_MS;
    const window = offer.endsAt - startsAt;
    return window <= 0 ? 1 : Math.min(1, Math.max(0, (at - startsAt) / window));
  }

  /** Made-up fellow players subscribe up to demoPlayersShare of the offer, evenly over the window (demo only). */
  function playerShares(company: DemoCompanyState, at: number, final = false): number {
    const offer = company.listing!.offer!;
    const t = final ? 1 : offerProgress(company, at);
    return Math.floor(offer.offered * startups.ipo.demoPlayersShare * t);
  }

  /** AI investors subscribe their share over the window, most of it early (ADR-146, ADR-149). */
  function aiShares(company: DemoCompanyState, at: number, final = false): number {
    const offer = company.listing!.offer!;
    const startsAt = offer.startsAt ?? offer.endsAt - SUBSCRIPTION_MS;
    const window = offer.endsAt - startsAt;
    const e6 = aiSubscribedE6(
      offer.offered * 1_000_000,
      playerShares(company, at, final) * 1_000_000,
      company.quality,
      final ? window : at - startsAt,
      window,
      startups,
      offer.aiFactor ?? 1,
    );
    return Math.floor(e6 / 1_000_000);
  }

  function offerView(company: DemoCompanyState): Offer {
    const offer = company.listing!.offer!;
    return {
      id: offer.id,
      kind: offer.kind,
      company: {
        id: company.id,
        name: company.name,
        color: company.color,
        logo: company.logo ?? null,
        sector: company.sector,
        productKey: productKeyOf(company),
        stage: stageOf(company),
      },
      ticker: company.listing!.status === "listed" ? company.listing!.ticker : null,
      priceCents: offer.priceCents,
      sharesOfferedE6: offer.offered * 1_000_000,
      sharesSubscribedE6: playerShares(company, Date.now()) * 1_000_000,
      sharesAiE6: aiShares(company, Date.now()) * 1_000_000,
      startsAt: new Date(offer.startsAt ?? offer.endsAt - SUBSCRIPTION_MS).toISOString(),
      endsAt: new Date(offer.endsAt).toISOString(),
      status: "open",
      mine: true,
      mySharesE6: 0,
      myAmountCents: 0,
      valueCents: valueCents(company),
      lastQuarter: company.reports.at(-1)
        ? {
            label: company.reports.at(-1)!.label,
            revenueCents: company.reports.at(-1)!.revenueCents,
            profitCents: company.reports.at(-1)!.operatingProfitCents,
          }
        : null,
    };
  }

  /**
   * End of a subscription (ADR-146, ADR-151): full, or the window is over. The money was held back until now. A full
   * IPO lists the company and pays it out; an IPO that is not full fails, everybody gets the money back and the
   * company stays private. A capital increase issues what was subscribed.
   */
  function resolveOffer(company: DemoCompanyState) {
    const listing = company.listing;
    const offer = listing?.offer;
    if (!listing || !offer) return;
    const sold = Math.min(
      offer.offered,
      playerShares(company, offer.endsAt, true) + aiShares(company, offer.endsAt, true),
    );
    if (offer.kind === "ipo" && !ipoFilled(offer.offered, sold)) {
      company.listing = null;
      system(
        company,
        `Börsengang geplatzt: nur ${Math.floor((100 * sold) / offer.offered)} % der Aktien wurden gezeichnet. Alle Anleger haben ihr Geld zurück, die Firma bleibt privat. Du kannst es jederzeit noch einmal versuchen.`,
      );
      host.persist();
      return;
    }
    company.cashCents += sold * offer.priceCents;
    if (offer.kind === "ipo") {
      listing.sharesTotal = listing.founderShares + sold;
      listing.status = "listed";
      company.tier = "ag";
    } else {
      listing.sharesTotal += sold;
    }
    listing.lastPriceCents = offer.priceCents;
    listing.offer = null;
    system(
      company,
      `Zeichnung beendet: ${sold.toLocaleString("de-DE")} Aktien zu ${formatMoney(offer.priceCents)} ausgegeben. ${formatMoney(sold * offer.priceCents, { whole: true })} sind in der Firmenkasse.`,
    );
    host.persist();
  }

  /** Every offered share is subscribed: the offer ends at once (ADR-146). */
  function offerFull(company: DemoCompanyState, at: number): boolean {
    const offer = company.listing?.offer;
    return !!offer && playerShares(company, at) + aiShares(company, at) >= offer.offered;
  }

  /** Three letters from the name, not one of the demo market's tickers (the stock joins that list, ADR-145). */
  function tickerFor(name: string): string {
    const letters = (name.toUpperCase().replace(/[^A-Z]/g, "") || "NEX").padEnd(4, "X");
    const taken = new Set(DEMO_COMPANIES.map((c) => c.ticker));
    for (let i = 2; i < letters.length; i++) {
      const candidate = letters.slice(0, 2) + letters[i];
      if (!taken.has(candidate)) return candidate;
    }
    return letters.slice(0, 4);
  }

  function view(company: DemoCompanyState): MyCompany {
    const productivity = productivityList(company);
    const [u1, u2] = company.estimateSeeds;
    const level = company.expansionLevel ?? 0;
    const marketFactor = effectivePotentialCents(1, company.tier, level);
    const estimate = potentialEstimate(company.potentialAnnualCents * marketFactor, company.quartersActive, u1, u2);
    const last = company.reports.at(-1) ?? null;
    const step = nextStep(company.tier);
    return {
      id: company.id,
      name: company.name,
      idea: company.idea,
      sector: company.sector,
      color: company.color,
      tier: company.tier,
      foundedAt: new Date(company.foundedAt).toISOString(),
      productKey: productKeyOf(company),
      stage: stageOf(company),
      stages: stagesOf(company),
      cashCents: company.cashCents,
      valueCents: valueCents(company),
      unpaidCents: company.unpaidCents,
      distress: company.unpaidCents > 0,
      awarenessBps: Math.round(company.awareness * 10_000),
      qualityBps: Math.round(company.quality * 10_000),
      quartersActive: company.quartersActive,
      estimateLowCents: estimate.lowCents,
      estimateHighCents: estimate.highCents,
      marketingCentsPerQuarter: company.marketingCents,
      aiWorkers: company.aiWorkers,
      aiWorkerCostCents: startups.aiWorkerCostCentsPerQuarter,
      aiWageCentsPerHour: startups.aiWorkerWageCentsPerHour,
      live: liveOf(company),
      hours: (company.hours ?? []).map((h) => ({
        hourStart: new Date(h.at).toISOString(),
        revenueCents: h.revenueCents,
        profitCents: h.profitCents,
        contractRevenueCents: h.contractRevenueCents ?? 0,
        founderPayoutCents: h.founderPayoutCents ?? 0,
        supplyRevenueCents: h.supplyRevenueCents ?? 0,
        supplyFeePaidCents: h.supplyFeePaidCents ?? 0,
        supplyFeeIncomeCents: h.supplyFeeIncomeCents ?? 0,
        supplyGoodsCents: h.supplyGoodsCents ?? 0,
        stakePayoutCents: h.stakePayoutCents ?? 0,
        demandCents: h.demandCents,
        capacityCents: h.capacityCents,
        strengthBonusCents: 0,
        aiUtilizationBps: h.aiUtilizationBps ?? null,
        aiWagesPaidCents: h.aiWagesCents,
        playerWagesPaidCents: 0,
        reputation: h.reputation ?? null,
      })),
      reputation: demoReputation(company),
      closeWarnings: [],
      worth: worthOf(company),
      founderPayoutBps: company.founderPayoutBps ?? 0,
      strengths: demoStrengths(company),
      campaign: campaignView(company),
      campaignCosts: campaignCosts(company),
      priceLevel: company.priceLevel ?? "normal",
      contractWork: company.contractWork ?? true,
      expansionLevel: level,
      canExpand: canExpand(company.tier),
      expansionCostCents: canExpand(company.tier) ? expansionCostCents(level) : null,
      marketFactor,
      maxEmployees: maxEmployees(company.tier, BALANCE, level),
      employees: 0,
      openPostings: company.postings.filter((p) => p.status === "open").length,
      pendingApplications: 0,
      founderProductivityBps: productivity[0]!,
      teamProductivityBps: productivity.reduce((a, b) => a + b, 0),
      capacityCents: Math.round(capacityCents(productivity, company.sector)),
      nextQuarterAt: new Date(company.lastClosedAt + QUARTER_MS).toISOString(),
      canUpgrade: step !== null && host.level() >= step.level,
      upgradeCostCents: step?.cost ?? null,
      lastQuarter: last,
      history: company.reports.map((r) => ({
        label: r.label,
        revenueCents: r.revenueCents,
        profitCents: r.operatingProfitCents,
      })),
      payFactorBps: 10_000,
      logo: company.logo ?? null,
      logoHidden: false,
      banner: company.banner ?? null,
      founderHasJob: host.hasJob(),
      fullTimeFrom: startups.fullTimeFromEmployees,
      headcount: company.aiWorkers,
      listing: company.listing
        ? {
            status: company.listing.status,
            ticker: company.listing.status === "listed" ? company.listing.ticker : null,
            sharesTotalE6: company.listing.sharesTotal * 1_000_000,
            founderSharesE6: company.listing.founderShares * 1_000_000,
            offer: company.listing.offer ? offerView(company) : null,
            lastPriceE4: company.listing.lastPriceCents === null ? null : company.listing.lastPriceCents * 100,
          }
        : null,
      canGoPublic:
        !company.listing &&
        (startups.ipo.fromTiers as readonly string[]).includes(company.tier) &&
        host.level() >= startups.ipo.minLevel,
      canCapitalIncrease: company.listing?.status === "listed" && !company.listing.offer,
      distressQuarters: company.distressQuarters ?? 0,
      graceQuarters: startups.insolvency.graceQuarters,
      aiWorkerSkills: aiSkills(company),
      trainingFrom: startups.training.fromEmployees,
    };
  }

  const mutate = (requestId: string, run: (company: DemoCompanyState) => void): Promise<MyCompany> =>
    Promise.resolve().then(() =>
      host.idempotent(requestId, () => {
        catchUp();
        const company = own();
        run(company);
        return view(company);
      }),
    );

  const engine: Pick<
    GameEngine,
    | "checkCompanyName"
    | "foundCompany"
    | "myCompany"
    | "closeCompany"
    | "companyChat"
    | "postCompanyMessage"
    | "setCompanyMarketing"
    | "setAiWorkers"
    | "hireAiWorkers"
    | "dismissAiWorker"
    | "companyDeposit"
    | "companyWithdraw"
    | "upgradeCompany"
    | "setCompanyStrategy"
    | "expandCompany"
    | "setFounderPayout"
    | "startCampaign"
    | "companyOrg"
    | "companyPostings"
    | "createJobPosting"
    | "closeJobPosting"
    | "companyApplications"
    | "respondApplication"
    | "companyTeam"
    | "fireEmployee"
    | "respondRaise"
    | "promoteEmployee"
    | "declinePromotion"
    | "trainEmployee"
    | "setCompanyLogo"
    | "setCompanyBanner"
    | "reportCompanyLogo"
    | "goPublic"
    | "capitalIncrease"
    | "offers"
    | "subscribeOffer"
  > = {
    async checkCompanyName(name) {
      const reason = host.nameViolation(name.trim());
      return { allowed: reason === null, reason };
    },

    async foundCompany(input: FoundCompanyInput) {
      return host.idempotent(input.requestId, () => {
        const previous = host.company();
        if (previous && !input.replace) throw new GameError("company_exists");
        // The AG only comes by going public (ADR-067); bigger forms can be founded directly (ADR-083).
        if (input.tier === "ag") throw new GameError("invalid_argument");
        const locked = host.foundingLockedUntil();
        if (locked !== null && locked > Date.now()) throw new GameError("founding_locked");
        if (host.level() < foundingLevel(input.tier)) throw new GameError("company_level_too_low");
        const violation = host.nameViolation(input.name.trim());
        if (violation) throw new GameError(violation);
        const cost = foundingCostCents(input.tier);
        if (host.cashCents() < cost) throw new GameError("insufficient_funds");
        // Replacing: the old company is closed like "Firma auflösen", its name becomes free.
        if (previous) {
          catchUp();
          dissolveCompany(previous, "closed", Date.now());
        }
        host.addCash(-cost);
        const now = Date.now();
        const company: DemoCompanyState = {
          id: `demo-company-${now}`,
          name: input.name.trim(),
          idea: input.idea.trim().slice(0, 120),
          sector: input.sector,
          color: input.color,
          tier: input.tier,
          productKey: productOf(input.sector, input.product).key,
          foundedAt: now,
          potentialAnnualCents: potentialFromUniform(1 - Math.random()),
          awareness: startups.foundingAwareness[input.tier as Exclude<StartupTier, "ag">],
          quality: startups.quality.base,
          contractWork: true,
          quartersActive: 0,
          cashCents: cost,
          unpaidCents: 0,
          marketingCents: 0,
          aiWorkers: 0,
          lastClosedAt: now,
          lastHourAt: now,
          reports: [],
          estimateSeeds: [Math.random(), Math.random()],
          postings: [],
          seq: 0,
        };
        host.setCompany(company);
        return view(company);
      });
    },

    async myCompany() {
      catchUp();
      const company = host.company();
      const last = host.lastDissolution();
      const recent = last && Date.now() - last.atMs < 7 * 86_400_000 ? last : null;
      return {
        company: company ? view(company) : null,
        lastDissolution: recent
          ? {
              companyName: recent.companyName,
              reason: recent.reason,
              at: recent.at,
              totalDebtCents: recent.totalDebtCents,
              fromFounderCents: recent.fromFounderCents,
              loanCents: recent.loanCents,
            }
          : null,
      };
    },

    async closeCompany(requestId) {
      return host.idempotent(requestId, () => {
        catchUp();
        return dissolveCompany(own(), "closed", Date.now());
      });
    },

    async companyChat() {
      catchUp();
      const company = host.company();
      if (!company) return { company: null, members: 0, messages: [] };
      return {
        company: { id: company.id, name: company.name, color: company.color },
        members: 1,
        messages: (company.chat ?? []).slice(-startups.chat.historyLimit),
      };
    },

    async postCompanyMessage(requestId, body) {
      return host.idempotent(requestId, () => {
        const company = host.company();
        if (!company) throw new GameError("not_in_company");
        const text = body.trim();
        if (!text || text.length > startups.chat.maxMessageLength) throw new GameError("invalid_argument");
        if (host.nameViolation(text.replace(/[^A-Za-z0-9_ ]/g, "")) === "name_profanity")
          throw new GameError("name_profanity");
        const chat = (company.chat ??= []);
        const message: ChatMessage = {
          id: (chat.at(-1)?.id ?? 0) + 1,
          kind: "player",
          author: host.nickname(),
          avatarKey: host.avatarKey(),
          isMe: true,
          isFounder: true,
          body: text,
          createdAt: new Date().toISOString(),
        };
        chat.push(message);
        company.chat = chat.slice(-startups.chat.historyLimit);
        return message;
      });
    },

    setCompanyMarketing: (requestId, marketingCents) =>
      mutate(requestId, (company) => {
        if (!Number.isInteger(marketingCents) || marketingCents < 0) throw new GameError("invalid_argument");
        company.marketingCents = marketingCents;
      }),

    setAiWorkers: (requestId, count) =>
      mutate(requestId, (company) => {
        if (!Number.isInteger(count) || count < 0) throw new GameError("invalid_argument");
        if (count > maxEmployees(company.tier, BALANCE, company.expansionLevel ?? 0))
          throw new GameError("employee_limit");
        setAiCount(company, count);
      }),

    hireAiWorkers: (requestId, count, skill) =>
      mutate(requestId, (company) => {
        if (!Number.isInteger(count) || count < 1) throw new GameError("invalid_argument");
        if (company.aiWorkers + count > maxEmployees(company.tier, BALANCE, company.expansionLevel ?? 0))
          throw new GameError("employee_limit");
        if (skill) {
          const all = productOf(company.sector, productKeyOf(company)).stages.flat();
          if (count !== 1 || !all.includes(skill)) throw new GameError("invalid_argument");
          if (aiSkills(company).includes(skill)) throw new GameError("skill_already_covered");
          company.aiWorkerSkills = [...aiSkills(company), skill];
        }
        setAiCount(company, company.aiWorkers + count);
      }),

    dismissAiWorker: (requestId, skill) =>
      mutate(requestId, (company) => {
        if (company.aiWorkers === 0) throw new GameError("invalid_argument");
        const skills = aiSkills(company);
        if (skill) {
          if (!skills.includes(skill)) throw new GameError("invalid_argument");
          company.aiWorkerSkills = skills.filter((k) => k !== skill);
        } else if (company.aiWorkers === skills.length) {
          company.aiWorkerSkills = skills.slice(0, -1);
        }
        company.aiWorkers -= 1;
      }),

    companyDeposit: (requestId, amountCents) =>
      mutate(requestId, (company) => {
        if (!Number.isInteger(amountCents) || amountCents <= 0) throw new GameError("invalid_argument");
        if (host.cashCents() < amountCents) throw new GameError("insufficient_funds");
        host.addCash(-amountCents);
        const toBills = Math.min(company.unpaidCents, amountCents);
        company.unpaidCents -= toBills;
        company.cashCents += amountCents - toBills;
      }),

    companyWithdraw: (requestId, amountCents) =>
      mutate(requestId, (company) => {
        if (!Number.isInteger(amountCents) || amountCents <= 0) throw new GameError("invalid_argument");
        host.listed?.withdraw(company, amountCents);
        if (amountCents > company.cashCents - company.unpaidCents) throw new GameError("insufficient_funds");
        company.cashCents -= amountCents;
        host.addCash(amountCents);
        host.listed?.withdrawn(company, amountCents);
      }),

    setCompanyStrategy: (requestId, priceLevel, contractWork) =>
      mutate(requestId, (company) => {
        if (!["budget", "normal", "premium"].includes(priceLevel)) throw new GameError("invalid_argument");
        host.listed?.strategyCheck(company, priceLevel);
        company.priceLevel = priceLevel;
        company.contractWork = contractWork;
      }),

    setFounderPayout: (requestId, bps) =>
      mutate(requestId, (company) => {
        if (!isValidFounderPayout(bps)) throw new GameError("invalid_argument");
        host.listed?.payoutCheck(company, bps);
        company.founderPayoutBps = bps;
      }),

    // Demo companies have only the founder and AI workers (ADR-104).
    async companyOrg(companyId) {
      const company = own();
      if (company.id !== companyId) throw new GameError("company_not_found");
      return {
        company: { id: company.id, name: company.name, tier: company.tier },
        founder: { nickname: host.nickname(), tag: null, avatarKey: host.avatarKey(), isMe: true },
        members: [],
        talents: [],
        aiWorkers: company.aiWorkers,
        aiWorkerSkills: company.aiWorkerSkills ?? [],
      };
    },

    startCampaign: (requestId, _companyId, kind) =>
      mutate(requestId, (company) => {
        if (!(kind in startups.campaigns.kinds)) throw new GameError("invalid_argument");
        const now = Date.now();
        if (company.campaign && now < company.campaign.endsAt) throw new GameError("campaign_running");
        const cost = campaignCosts(company)[kind];
        if (company.cashCents - company.unpaidCents < cost) throw new GameError("insufficient_funds");
        company.cashCents -= cost;
        const luck = campaignLuck(Math.random());
        const spec = startups.campaigns.kinds[kind];
        company.campaign = {
          id: `campaign-${++company.seq}`,
          kind,
          startedAt: now,
          endsAt: now + spec.hours * HOUR_MS,
          demandFactor: campaignFactor(kind, company.quality, luck),
          costCents: cost,
          luck,
        };
        // ADR-188: the same cap as the hour, booked as an extra of the next hour
        const cap = awarenessCap(company.tier, stageOf(company), company.expansionLevel ?? 0);
        const add = awarenessAdd(company.awareness, cap, spec.awareness);
        company.awareness += add;
        company.awarenessBoost = (company.awarenessBoost ?? 0) + add;
      }).then((c) => c.campaign!),

    expandCompany: (requestId) =>
      mutate(requestId, (company) => {
        if (!canExpand(company.tier)) throw new GameError("company_upgrade_unavailable");
        const cost = expansionCostCents(company.expansionLevel ?? 0);
        if (company.cashCents - company.unpaidCents < cost) throw new GameError("insufficient_funds");
        company.cashCents -= cost;
        company.expansionLevel = (company.expansionLevel ?? 0) + 1;
        system(company, `Ausbaustufe ${company.expansionLevel} erreicht: mehr Markt, mehr Plätze, mehr Kapazität.`);
      }),

    upgradeCompany: (requestId) =>
      mutate(requestId, (company) => {
        const step = nextStep(company.tier);
        if (!step || host.level() < step.level) throw new GameError("company_upgrade_unavailable");
        if (host.cashCents() < step.cost) throw new GameError("insufficient_funds");
        host.addCash(-step.cost);
        company.cashCents += step.cost;
        company.tier = step.tier;
      }),

    async companyPostings() {
      return host.company()?.postings ?? [];
    },

    async createJobPosting(input: CreatePostingInput) {
      host.idempotent(input.requestId, () => {
        const company = own();
        if (input.required.length === 0 || input.salaryCentsPerHour <= 0 || input.slots < 1)
          throw new GameError("invalid_argument");
        const violation = host.nameViolation(input.title.trim());
        if (violation === "name_profanity") throw new GameError(violation);
        company.postings.unshift({
          id: `${company.id}-posting-${company.postings.length + 1}`,
          tier: input.tier,
          title: input.title.trim(),
          titleKey: null,
          required: input.required,
          salaryCentsPerHour: input.salaryCentsPerHour,
          slots: input.slots,
          slotsOpen: input.slots,
          status: "open",
          applicationsPending: 0,
          postedAt: new Date().toISOString(),
          requiredSkills: input.requiredSkills,
        });
        return null;
      });
    },

    async closeJobPosting(requestId, postingId) {
      host.idempotent(requestId, () => {
        const posting = own().postings.find((p) => p.id === postingId);
        if (!posting) throw new GameError("job_not_found");
        posting.status = "closed";
        return null;
      });
    },

    async companyApplications() {
      return [];
    },
    async respondApplication() {
      throw new GameError("application_not_found");
    },
    async companyTeam() {
      return [];
    },
    async fireEmployee() {
      throw new GameError("no_active_job");
    },
    async respondRaise() {
      throw new GameError("invalid_argument");
    },
    // Demo companies have no player employees to promote (ADR-094).
    async promoteEmployee() {
      throw new GameError("job_not_found");
    },
    async declinePromotion() {
      throw new GameError("job_not_found");
    },
    async trainEmployee() {
      throw new GameError("no_active_job");
    },

    setCompanyLogo: (requestId, logo) =>
      mutate(requestId, (company) => {
        if (!isValidLogo(logo)) throw new GameError("invalid_argument");
        // Drawn once at the start (ADR-076); only a logo hidden after reports may be replaced.
        if (company.logo) throw new GameError("logo_locked");
        if (hasForbiddenSymbol(logo)) throw new GameError("logo_forbidden");
        company.logo = { palette: [...logo.palette], grid: [...logo.grid] };
      }),

    setCompanyBanner: (requestId, banner) =>
      mutate(requestId, (company) => {
        if (banner === null) {
          company.banner = null;
          return;
        }
        if (!isValidBanner(banner)) throw new GameError("invalid_argument");
        if (hasForbiddenSymbol(banner)) throw new GameError("logo_forbidden");
        company.banner = { palette: [...banner.palette], grid: [...banner.grid] };
      }),

    async reportCompanyLogo() {
      // In the demo there are no other players' logos to report.
    },

    goPublic: (requestId, sharePercent) =>
      mutate(requestId, (company) => {
        if (company.listing) throw new GameError("already_listed");
        if (
          !(startups.ipo.fromTiers as readonly string[]).includes(company.tier) ||
          host.level() < startups.ipo.minLevel
        )
          throw new GameError("locked");
        const pct = Math.round(sharePercent);
        if (pct < startups.ipo.minSharePercent || pct > startups.ipo.maxSharePercent)
          throw new GameError("invalid_argument");
        const total = startups.ipo.sharesTotal;
        const offered = Math.floor((total * pct) / 100);
        company.listing = {
          status: "subscription",
          ticker: tickerFor(company.name),
          sharesTotal: total,
          founderShares: total - offered,
          lastPriceCents: null,
          offer: {
            id: `${company.id}-ipo`,
            kind: "ipo",
            priceCents: issuePriceCents(BigInt(valueCents(company))),
            offered,
            startsAt: Date.now(),
            endsAt: Date.now() + SUBSCRIPTION_MS,
          },
        };
        system(
          company,
          `Börsengang gestartet: ${pct} % der Firma werden höchstens ${startups.ipo.subscriptionMinutes} Minuten lang gezeichnet.`,
        );
      }),

    capitalIncrease: (requestId, sharePercent) =>
      mutate(requestId, (company) => {
        const listing = company.listing;
        if (!listing || listing.status !== "listed" || listing.offer) throw new GameError("invalid_argument");
        const pct = Math.round(sharePercent);
        if (pct < 1 || pct > startups.ipo.capitalIncreaseMaxPercent) throw new GameError("invalid_argument");
        const now = Date.now();
        if (
          listing.lastCapitalIncreaseAt !== undefined &&
          now - listing.lastCapitalIncreaseAt < startups.ipo.capitalIncreaseCooldownHours * 3_600_000
        ) {
          throw new GameError("capital_increase_cooldown");
        }
        const priceCents = capitalIncreasePriceCents(listing.lastPriceCents ?? startups.ipo.minIssuePriceCents);
        const offered = Math.floor((listing.sharesTotal * pct) / 100);
        listing.lastCapitalIncreaseAt = now;
        listing.offer = {
          id: `${company.id}-ci-${company.seq}`,
          kind: "capital_increase",
          priceCents,
          offered,
          startsAt: now,
          endsAt: now + SUBSCRIPTION_MS,
          // ADR-170: AI investors pay at most the fair value after the increase
          aiFactor: issueAiFactor(
            postIssueFairCents(valueCents(company), listing.sharesTotal, offered, priceCents),
            priceCents,
          ),
        };
      }),

    async offers() {
      catchUp();
      const company = host.company();
      return company?.listing?.offer ? [offerView(company)] : [];
    },

    async subscribeOffer() {
      // The only offer in the demo is the player's own; founders cannot subscribe to it.
      throw new GameError("forbidden");
    },
  };

  return {
    engine,
    catchUp,
    /** Demo only: close the running quarter at once. */
    closeQuarterNow: () => {
      const company = host.company();
      if (!company) return;
      // Demo shortcut: a running subscription ends with the quarter.
      if (company.listing?.offer) resolveOffer(company);
      closeQuarter(company, Date.now());
      host.persist();
    },
    valueCents: () => {
      const company = host.company();
      return company ? valueCents(company) : 0;
    },
    /** ADR-203: the value Top-Unternehmen shows, or null without a company. */
    worth: (): CompanyWorth | null => {
      const company = host.company();
      return company ? worthOf(company) : null;
    },
    /** ADR-203: the founder's stake in the net worth: the worth, or the own shares at the last price once listed. */
    stakeCents: (): number => {
      const company = host.company();
      if (!company) return 0;
      const w = worthOf(company);
      return w.basis === "market_cap" ? company.listing!.founderShares * (w.priceE4! / 100) : w.cents;
    },
    fixedCostCents,
    /** The listed own company as a stock of the demo market (ADR-145), or null. */
    listedStock: (): DemoListedStock | null => {
      const company = host.company();
      const listing = company?.listing;
      if (!company || listing?.status !== "listed") return null;
      const priceCents = listing.lastPriceCents ?? startups.ipo.minIssuePriceCents;
      return {
        companyId: company.id,
        ticker: listing.ticker,
        name: company.name,
        sector: company.sector,
        color: company.color,
        logo: company.logo ?? null,
        priceE4: priceCents * 100,
        marketCapCents: listing.sharesTotal * priceCents,
      };
    },
  };
}

export interface DemoListedStock {
  companyId: string;
  ticker: string;
  name: string;
  sector: SectorKey;
  color: string;
  logo: CompanyLogoData | null;
  priceE4: number;
  marketCapCents: number;
}

/** Reputation (ADR-183) as the company page shows it, from the kept hours. */
export function demoReputation(company: DemoCompanyState): MyCompany["reputation"] {
  const hours = (company.hours ?? []).filter((h) => h.reputation !== undefined);
  const last = hours.at(-1);
  const value = company.reputation ?? reputationCfg.start;
  return {
    value,
    target: last?.reputationTarget ?? value,
    demandFactor: reputationDemandFactor(value),
    drivers: last?.reputationDrivers ?? {},
    at: last ? new Date(last.at).toISOString() : null,
    history: hours.map((h) => ({
      hourStart: new Date(h.at).toISOString(),
      value: h.reputation ?? value,
      target: h.reputationTarget ?? h.reputation ?? value,
    })),
  };
}

/** Strengths (ADR-176) in the demo: replayed from the kept hours with the same rules as the server. */
export function demoStrengths(company: DemoCompanyState): MyCompany["strengths"] {
  const cfg = BALANCE.companyHealth.strengths;
  let scores = EMPTY_STRENGTHS;
  for (const h of company.hours ?? []) {
    scores = strengthsStep(
      scores,
      strengthsInstant(
        {
          // ADR-188: the score counts the awareness against the cap of that hour
          awareness: awarenessOfCap(
            h.awarenessAfter ?? company.awareness,
            h.awarenessParts?.cap ?? company.awarenessCap ?? awarenessCap(company.tier, 0, company.expansionLevel ?? 0),
          ),
          quality: company.quality,
          demandCents: h.demandCents,
          capacityCents: h.capacityCents,
          revenueCents: h.revenueCents,
          profitCents: h.profitCents,
          payFactorBps: h.payFactorBps,
          cashCents: company.cashCents,
          unpaidCents: company.unpaidCents ?? 0,
        },
        cfg,
      ),
      cfg,
    );
  }
  return {
    scores: { ...scores },
    overall: strengthsOverall(scores),
    hours: company.hours?.length ?? 0,
    rewardBps: strengthsRewardBps(scores, cfg),
    next: strengthsNextReward(scores, cfg),
    closeError: null,
  };
}

/** Awareness, its cap and what moved it (ADR-188), shaped like get_company_awareness. */
export function demoAwareness(company: DemoCompanyState): CompanyAwareness {
  const a = BALANCE.startups.awareness;
  const level = company.expansionLevel ?? 0;
  const last = company.hours?.at(-1);
  const p = last?.awarenessParts;
  const cap = p?.cap ?? company.awarenessCap ?? awarenessCap(company.tier, 0, level);
  const tierCap = awarenessCap(company.tier, 0, 0);
  const stage = Math.max(0, Math.round((cap - tierCap - a.cap.perExpansionLevel * level) / a.cap.perStage));
  const extra = company.awarenessBoost ?? 0;
  return {
    awareness: company.awareness,
    cap,
    floor: a.min,
    tier: company.tier,
    stage,
    expansionLevel: level,
    tierCap,
    perStage: a.cap.perStage,
    perExpansionLevel: a.cap.perExpansionLevel,
    strength: demoStrengths(company)?.scores.awareness ?? 0,
    lastHour:
      last && p
        ? {
            hourStart: new Date(last.at).toISOString(),
            parts: { marketing: p.marketing, word_of_mouth: p.wordOfMouth, decay: -p.decay, tasks: p.extra },
          }
        : null,
    since: extra !== 0 ? { tasks: extra } : {},
    history: (company.hours ?? [])
      .slice(-24)
      .filter((h) => h.awarenessAfter !== undefined)
      .map((h) => ({ hourStart: new Date(h.at).toISOString(), after: h.awarenessAfter ?? company.awareness })),
  };
}

/** The last closed hour for the autopilot card (ADR-180), shaped like get_company_autopilot.last_hour. */
export function demoLastHour(company: DemoCompanyState | null): CompanyAutopilot["lastHour"] {
  const h = company?.hours?.at(-1);
  if (!company || !h) return null;
  return {
    hourStart: new Date(h.at).toISOString(),
    revenueCents: h.revenueCents,
    profitCents: h.profitCents,
    demandCents: h.demandCents,
    capacityCents: h.capacityCents,
    aiWorkers: company.aiWorkers,
    aiWagesDueCents: h.aiWagesCents,
    aiUtilizationBps: h.aiUtilizationBps ?? null,
    awarenessBefore: h.awarenessBefore ?? null,
    awarenessAfter: h.awarenessAfter ?? null,
    awarenessParts: h.awarenessParts ?? null,
  };
}
