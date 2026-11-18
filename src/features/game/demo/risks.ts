import { BALANCE } from "@/config/balance";
import {
  effectiveCoverage,
  frictionModifiers,
  lobbyBonusBps,
  lobbyPoliticalFactor,
  sizeDecades,
  sizedChancePerDay,
  sizedChanceShare,
  sizedWeight,
  worthUnitCents,
} from "@/lib/sim/macro";
import type { CompanyRisks } from "../types";

/*
 * Demo of the "Risiken" card (ADR-209): the same formulas as get_company_risks, for the company of the demo player.
 */
interface DemoInsurance {
  level: number;
  prev: number;
  changedAt: number | null;
}

const state: { insurance: DemoInsurance; lobby: number } = {
  insurance: { level: 0, prev: 0, changedAt: null },
  lobby: 0,
};

export function demoRisks(
  companyId: string,
  worthCents: number,
  refRevenueCents: number,
  now = Date.now(),
): CompanyRisks {
  const ce = BALANCE.companyEvents;
  const m = BALANCE.macro;
  const decades = sizeDecades(worthCents);
  const chance = sizedChancePerDay(ce.chancePerDay, decades);
  const share = sizedChanceShare(ce.chanceShare, decades);
  const size = { worthCents, lobbyLevel: state.lobby };
  const crises = ce.archetypes.filter((a) => a.polarity === "crisis" && (!a.sectors || a.sectors.includes("tech")));
  const total = crises.reduce((s, a) => s + sizedWeight(a, size), 0);
  const ins = state.insurance;
  const hours = ins.changedAt === null ? null : (now - ins.changedAt) / 3_600_000;
  const waitUntil = ins.changedAt === null ? null : ins.changedAt + m.insurance.changeWaitHours * 3_600_000;
  const friction = frictionModifiers(worthCents, 0);
  return {
    companyId,
    worthCents,
    decades,
    eventPivotCents: m.events.worthPivotCents,
    frictionPivotCents: m.friction.worthPivotCents,
    saturationBps: Math.round(friction.demandFactor * 10_000),
    overheadBps: Math.round(friction.extraCostShare * 10_000),
    chancePerDayBps: Math.round(chance * 10_000),
    crisisShareBps: Math.round((1 - share) * 10_000),
    unitCents: Math.max(ce.costUnit.minUnitCents, worthUnitCents(worthCents)),
    exposure: crises
      .filter((a) => a.external)
      .map((a) => ({
        archetype: a.key,
        bps: total > 0 ? Math.round(((chance * (1 - share) * sizedWeight(a, size)) / total) * 10_000) : 0,
        insurable: a.insurable ?? false,
        risk: a.risk ?? null,
      }))
      .filter((e) => e.bps > 0)
      .sort((a, b) => b.bps - a.bps || a.archetype.localeCompare(b.archetype)),
    upcoming: ce.archetypes
      .filter((a) => a.external && (a.minWorthCents ?? 0) > worthCents)
      .map((a) => ({ archetype: a.key, fromCents: a.minWorthCents ?? 0 }))
      .sort((a, b) => a.fromCents - b.fromCents || a.archetype.localeCompare(b.archetype)),
    refRevenueCents,
    insurance: {
      level: ins.level,
      coverageBps: Math.round(effectiveCoverage(ins.level, ins.prev, hours) * 10_000),
      changedAt: ins.changedAt === null ? null : new Date(ins.changedAt).toISOString(),
      fullFrom: waitUntil !== null && waitUntil > now ? new Date(waitUntil).toISOString() : null,
      levels: m.insurance.levels.map((l, i) => ({
        level: i,
        key: l.key,
        coverageBps: Math.round(l.coverage * 10_000),
        premiumBps: l.premiumBps,
        premiumCentsPerHour: Math.floor((refRevenueCents * l.premiumBps) / 10_000),
      })),
    },
    lobby: {
      level: state.lobby,
      max: m.lobby.maxLevel,
      bonusBps: lobbyBonusBps(state.lobby),
      politicalCutBps: Math.round((1 - lobbyPoliticalFactor(state.lobby)) * 10_000),
      leader: false,
    },
    country: null,
  };
}

export function demoSetInsurance(level: number, now = Date.now()): void {
  const max = BALANCE.macro.insurance.levels.length - 1;
  if (!Number.isInteger(level) || level < 0 || level > max) throw new Error("invalid_argument");
  const ins = state.insurance;
  if (ins.level === level) return;
  const settled = ins.changedAt === null || now - ins.changedAt >= BALANCE.macro.insurance.changeWaitHours * 3_600_000;
  state.insurance = { level, prev: settled ? ins.level : Math.min(ins.level, ins.prev), changedAt: now };
}
