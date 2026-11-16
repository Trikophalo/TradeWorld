/*
 * What each person in the company costs and brings per month (owner's wish, ADR-167 UI). The game has no calendar
 * month: a month here is 30 real days. Players are paid at most `paidHoursPerDay` hours a day, AI workers every
 * operating hour (24 a day). The contribution is the revenue of the last 24 closed hours × 30, split by the share
 * of the team's productivity a person brings (the capacity the company sells from). Pure: no React, no clock.
 */

export const MONTH_DAYS = 30;

export interface StaffValueInput {
  founder: { nickname: string; productivityBps: number };
  members: { id: string; nickname: string; salaryCentsPerHour: number; productivityBps: number }[];
  aiWorkers: number;
  aiWageCentsPerHour: number;
  /** Productivity of one AI worker (bps; 1 = 10 000). */
  aiProductivityBps: number;
  /** Sum of everyone's productivity as the server counts it. */
  teamProductivityBps: number;
  /** Revenue of the last closed hours (any number; scaled to a day). */
  hourRevenuesCents: readonly number[];
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
}

export function staffValue(x: StaffValueInput): StaffValue {
  const hours = x.hourRevenuesCents.slice(-24);
  const noRevenue = hours.length === 0;
  const perDay = noRevenue ? 0 : (hours.reduce((s, v) => s + v, 0) / hours.length) * 24;
  const revenueMonth = perDay * MONTH_DAYS;
  const total = Math.max(1, x.teamProductivityBps);
  const share = (bps: number) => Math.round((revenueMonth * Math.max(0, bps)) / total);
  const judge = (net: number): "yes" | "no" | null => (noRevenue ? null : net >= 0 ? "yes" : "no");

  const rows: StaffValueRow[] = [];
  const founder = share(x.founder.productivityBps);
  rows.push({
    id: "founder",
    kind: "founder",
    name: x.founder.nickname,
    costCents: 0,
    contributionCents: founder,
    netCents: founder,
    worth: null,
  });
  for (const m of x.members) {
    const cost = m.salaryCentsPerHour * x.paidHoursPerDay * MONTH_DAYS;
    const contribution = share(m.productivityBps);
    rows.push({
      id: m.id,
      kind: "player",
      name: m.nickname,
      costCents: cost,
      contributionCents: contribution,
      netCents: contribution - cost,
      worth: judge(contribution - cost),
    });
  }
  for (let i = 0; i < x.aiWorkers; i++) {
    const cost = x.aiWageCentsPerHour * 24 * MONTH_DAYS;
    const contribution = share(x.aiProductivityBps);
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
  };
}
