/*
 * What each person in the company costs and brings per month (owner's wish, ADR-167 UI; reworked in ADR-183).
 * The game has no calendar month: a month here is 30 real days, scaled from the last closed hours (up to 24).
 *
 * The split follows the hourly close (ADR-180): founder and players serve the demand first, the AI workers only what
 * is left. So an AI worker brings revenue only for the part of its capacity the hour used, and an idle one brings
 * nothing while it still costs the standby share. Unused capacity earns contract work, split by who had it free.
 * The strengths bonus travels with the sales. Costs are the wages the hours actually paid (players by their salary
 * share, AI workers per head); servers before 7310 send neither, then the full wages count as before.
 *
 * Before ADR-183 the revenue was split by productivity alone and every AI worker counted at the full wage. Without a
 * closed hour (a new company, or an hourly close that fails on the server) everything showed "bringt 0 €".
 * Pure: no React, no clock.
 */

export const MONTH_DAYS = 30;

/** One closed hour as the company page has it (MyCompany.hours). */
export interface StaffHour {
  revenueCents: number;
  contractRevenueCents: number;
  strengthBonusCents?: number;
  demandCents?: number | null;
  capacityCents?: number | null;
  aiUtilizationBps?: number | null;
  aiWagesPaidCents?: number | null;
  playerWagesPaidCents?: number | null;
}

export interface StaffValueInput {
  founder: { nickname: string; productivityBps: number };
  members: { id: string; nickname: string; salaryCentsPerHour: number; productivityBps: number }[];
  aiWorkers: number;
  aiWageCentsPerHour: number;
  /** Productivity of one AI worker (bps; 1 = 10 000). */
  aiProductivityBps: number;
  /** The last closed hours, oldest first (any number; the last 24 count). */
  hours: readonly StaffHour[];
  paidHoursPerDay: number;
}

export interface StaffValueRow {
  id: string;
  kind: "founder" | "player" | "ai";
  name: string;
  costCents: number;
  contributionCents: number;
  /** Contribution minus cost. */
  netCents: number;
  /** null for the founder (no wage): never judged. */
  worth: "yes" | "no" | null;
}

export interface StaffValue {
  rows: StaffValueRow[];
  costCents: number;
  contributionCents: number;
  /** No closed hour yet: contributions are 0 and not judged. */
  noRevenue: boolean;
  /** Closed hours the numbers come from. */
  hours: number;
  /** Mean share of the AI workers' capacity the hours used (0..10 000); null without AI workers or data. */
  aiUtilizationBps: number | null;
}

const share = (value: number, part: number, whole: number) => (whole > 0 ? (value * part) / whole : 0);

export function staffValue(x: StaffValueInput): StaffValue {
  const hours = x.hours.slice(-24);
  const noRevenue = hours.length === 0;
  const founderBps = Math.max(0, x.founder.productivityBps);
  const memberBps = x.members.map((m) => Math.max(0, m.productivityBps));
  const humanBps = founderBps + memberBps.reduce((s, v) => s + v, 0);
  const aiBps = Math.max(0, x.aiWorkers) * Math.max(0, x.aiProductivityBps);
  const totalBps = humanBps + aiBps;
  const salaries = x.members.reduce((s, m) => s + Math.max(0, m.salaryCentsPerHour), 0);

  // sums over the hours, per hour of revenue and cost
  let humanRevenue = 0;
  let aiRevenue = 0;
  let aiCost = 0;
  let playerCost = 0;
  const utilization: number[] = [];
  for (const h of hours) {
    const contract = Math.max(0, h.contractRevenueCents);
    const bonus = Math.max(0, h.strengthBonusCents ?? 0);
    const own = Math.max(0, h.revenueCents - contract - bonus);
    const sales = own + bonus;
    const aiShare = totalBps > 0 ? aiBps / totalBps : 0;
    if (h.capacityCents != null && h.demandCents != null && h.capacityCents > 0) {
      // ADR-180: founder and players serve first, the AI workers the rest
      const capacity = h.capacityCents;
      const sold = Math.min(Math.max(0, h.demandCents), capacity);
      const humanCap = capacity * (1 - aiShare);
      const humanSold = Math.min(sold, humanCap);
      const aiSold = sold - humanSold;
      humanRevenue += share(sales, humanSold, sold);
      aiRevenue += share(sales, aiSold, sold);
      const humanFree = humanCap - humanSold;
      const aiFree = capacity * aiShare - aiSold;
      humanRevenue += share(contract, humanFree, humanFree + aiFree);
      aiRevenue += share(contract, aiFree, humanFree + aiFree);
      if (aiBps > 0) utilization.push(capacity * aiShare > 0 ? (10_000 * aiSold) / (capacity * aiShare) : 0);
    } else if (h.aiUtilizationBps != null && aiBps > 0) {
      // no capacity in the row: the AI workers' share of the revenue follows their utilization
      const used = aiShare * (h.aiUtilizationBps / 10_000);
      const busy = 1 - aiShare + used;
      aiRevenue += share(h.revenueCents, used, busy);
      humanRevenue += share(h.revenueCents, 1 - aiShare, busy);
      utilization.push(h.aiUtilizationBps);
    } else {
      // servers before ADR-180: by productivity
      aiRevenue += h.revenueCents * aiShare;
      humanRevenue += h.revenueCents * (1 - aiShare);
    }
    aiCost += h.aiWagesPaidCents ?? x.aiWorkers * x.aiWageCentsPerHour;
    playerCost += h.playerWagesPaidCents ?? (salaries * x.paidHoursPerDay) / 24;
  }
  const n = Math.max(1, hours.length);
  const month = (sum: number) => Math.round((sum / n) * 24 * MONTH_DAYS);
  const judge = (net: number): "yes" | "no" | null => (noRevenue ? null : net >= 0 ? "yes" : "no");

  const rows: StaffValueRow[] = [];
  const founder = noRevenue ? 0 : month(share(humanRevenue, founderBps, humanBps));
  rows.push({
    id: "founder",
    kind: "founder",
    name: x.founder.nickname,
    costCents: 0,
    contributionCents: founder,
    netCents: founder,
    worth: null,
  });
  x.members.forEach((m, i) => {
    const contribution = noRevenue ? 0 : month(share(humanRevenue, memberBps[i]!, humanBps));
    const cost = noRevenue
      ? m.salaryCentsPerHour * x.paidHoursPerDay * MONTH_DAYS
      : month(share(playerCost, Math.max(0, m.salaryCentsPerHour), salaries));
    rows.push({
      id: m.id,
      kind: "player",
      name: m.nickname,
      costCents: cost,
      contributionCents: contribution,
      netCents: contribution - cost,
      worth: judge(contribution - cost),
    });
  });
  for (let i = 0; i < x.aiWorkers; i++) {
    const contribution = noRevenue ? 0 : month(aiRevenue / x.aiWorkers);
    const cost = noRevenue ? x.aiWageCentsPerHour * 24 * MONTH_DAYS : month(aiCost / x.aiWorkers);
    rows.push({
      id: `ai-${i}`,
      kind: "ai",
      name: `${i + 1}`,
      costCents: cost,
      contributionCents: contribution,
      netCents: contribution - cost,
      worth: judge(contribution - cost),
    });
  }
  rows.sort((a, b) => b.netCents - a.netCents);
  return {
    rows,
    costCents: rows.reduce((s, r) => s + r.costCents, 0),
    contributionCents: rows.reduce((s, r) => s + r.contributionCents, 0),
    noRevenue,
    hours: hours.length,
    aiUtilizationBps:
      utilization.length > 0 ? Math.round(utilization.reduce((s, v) => s + v, 0) / utilization.length) : null,
  };
}
