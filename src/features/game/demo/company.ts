import type { DemoCompanyEventsState } from "./company-events";
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
import { SKILL_BRANCHES, type SkillBranch } from "@/config/skills";
import type { SectorKey } from "@/components/pixel/art";
import { matchScore, productivityBps } from "@/lib/sim/skills";
import {
  aiTakeShare,
  capacityCents,
  capitalIncreasePriceCents,
  closeStartupHour,
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
  potentialEstimate,
  potentialFromUniform,
  startupValueCents,
  type StartupTier,
} from "@/lib/sim/startup";
import { formatMoney } from "@/lib/format";
import { dissolve, isInsolvent } from "@/lib/sim/insolvency";
import { hasForbiddenSymbol, isValidBanner, isValidLogo, type CompanyLogoData } from "@/lib/sim/logo";
import {
  GameError,
  type CampaignKind,
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
const QUARTER_MS = BALANCE.time.quarterHours * HOUR_MS;
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
}

/** One hour as the deals part sees it (ADR-098). */
export type DemoHourView = Pick<DemoHour, "at" | "demandCents" | "capacityCents" | "profitCents">;

interface DemoReport extends CompanyQuarter {
  closedAt: number;
}

export interface DemoCompanyState {
  id: string;
  name: string;
  idea: string;
  sector: SectorKey;
  color: string;
  tier: StartupTier;
  foundedAt: number;
  potentialAnnualCents: number;
  awareness: number;
  quality: number;
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
  /** Going public (ADR-067). In the demo AI investors are the only subscribers. */
  listing?: {
    status: "subscription" | "listed";
    ticker: string;
    sharesTotal: number;
    founderShares: number;
    lastPriceCents: number | null;
    offer: { id: string; kind: "ipo" | "capital_increase"; priceCents: number; offered: number; endsAt: number } | null;
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
  /** Silent partners' share of a profitable hour, paid before the founder (ADR-098); returns what was paid. */
  stakePayout?(company: DemoCompanyState, profitCents: number, freeCashCents: number): number;
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
      },
    );
    const revenue = Number(r.revenueCents);
    const costs = Number(r.cogsCents + r.aiWagesPaidCents + r.fixedCents + r.marketingCents);
    const available = company.cashCents + revenue;
    const paid = Math.min(costs, Math.max(0, available));
    company.cashCents = available - paid;
    company.unpaidCents += costs - paid;
    // Silent partners first (ADR-098), then the automatic CEO payout (ADR-086).
    const stakes =
      Number(r.profitCents) > 0
        ? (host.stakePayout?.(company, Number(r.profitCents), company.cashCents - company.unpaidCents) ?? 0)
        : 0;
    company.cashCents -= stakes;
    // Automatic CEO payout (ADR-086): a share of a profitable hour, never more than the free cash.
    const payout = Number(
      founderPayoutCents(r.profitCents, company.founderPayoutBps ?? 0, BigInt(company.cashCents - company.unpaidCents)),
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
    };
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
    if (company.listing?.offer && company.listing.offer.endsAt <= now) resolveOffer(company);
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
      sharesSubscribedE6: 0,
      endsAt: new Date(offer.endsAt).toISOString(),
      status: "open",
      mySharesE6: 0,
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

  /** End of a subscription: AI investors take their share, the rest is not issued (ADR-067). */
  function resolveOffer(company: DemoCompanyState) {
    const listing = company.listing;
    const offer = listing?.offer;
    if (!listing || !offer) return;
    const sold = Math.floor(offer.offered * aiTakeShare(company.quality));
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
      `Zeichnung beendet: ${sold.toLocaleString("de-DE")} Aktien zu ${formatMoney(offer.priceCents)} ausgegeben.`,
    );
    host.persist();
  }

  function tickerFor(name: string): string {
    const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
    return (letters.slice(0, 3) || "NEX").padEnd(3, "X");
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
      })),
      founderPayoutBps: company.founderPayoutBps ?? 0,
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
        if (host.company()) throw new GameError("company_exists");
        // The AG only comes by going public (ADR-067); bigger forms can be founded directly (ADR-083).
        if (input.tier === "ag") throw new GameError("invalid_argument");
        const locked = host.foundingLockedUntil();
        if (locked !== null && locked > Date.now()) throw new GameError("founding_locked");
        if (host.level() < foundingLevel(input.tier)) throw new GameError("company_level_too_low");
        const violation = host.nameViolation(input.name.trim());
        if (violation) throw new GameError(violation);
        const cost = foundingCostCents(input.tier);
        if (host.cashCents() < cost) throw new GameError("insufficient_funds");
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
        if (amountCents > company.cashCents - company.unpaidCents) throw new GameError("insufficient_funds");
        company.cashCents -= amountCents;
        host.addCash(amountCents);
      }),

    setCompanyStrategy: (requestId, priceLevel, contractWork) =>
      mutate(requestId, (company) => {
        if (!["budget", "normal", "premium"].includes(priceLevel)) throw new GameError("invalid_argument");
        company.priceLevel = priceLevel;
        company.contractWork = contractWork;
      }),

    setFounderPayout: (requestId, bps) =>
      mutate(requestId, (company) => {
        if (!isValidFounderPayout(bps)) throw new GameError("invalid_argument");
        company.founderPayoutBps = bps;
      }),

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
        const cap = startups.stages.awarenessCaps[stageOf(company)] ?? 1;
        company.awareness = Math.min(cap, Math.max(company.awareness, company.awareness + spec.awareness));
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
            endsAt: Date.now() + startups.ipo.subscriptionHours * 3_600_000,
          },
        };
        system(company, `Börsengang gestartet: ${pct} % der Firma werden 12 Stunden lang gezeichnet.`);
      }),

    capitalIncrease: (requestId, sharePercent) =>
      mutate(requestId, (company) => {
        const listing = company.listing;
        if (!listing || listing.status !== "listed" || listing.offer) throw new GameError("invalid_argument");
        const pct = Math.round(sharePercent);
        if (pct < 1 || pct > startups.ipo.capitalIncreaseMaxPercent) throw new GameError("invalid_argument");
        listing.offer = {
          id: `${company.id}-ci-${company.seq}`,
          kind: "capital_increase",
          priceCents: capitalIncreasePriceCents(listing.lastPriceCents ?? startups.ipo.minIssuePriceCents),
          offered: Math.floor((listing.sharesTotal * pct) / 100),
          endsAt: Date.now() + startups.ipo.subscriptionHours * 3_600_000,
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
    fixedCostCents,
  };
}
