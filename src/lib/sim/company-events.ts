/**
 * Company events (ADR-091): rolling a crisis or chance, the price and success chance of every response step, and the
 * effect on demand, capacity and costs while the event is in force. Postgres mirrors these functions.
 */
import { COMPANY_EVENTS } from "../../config/company-events.ts";
import type {
  CompanyEventArchetype,
  CompanyEventsConfig,
  CompanyEventStep,
  EventSector,
} from "../../config/company-events.ts";
import {
  sizeDecades,
  sizedChancePerDay,
  sizedChanceShare,
  sizedSeverityUniform,
  sizedWeight,
  type SizeContext,
} from "./macro.ts";

export type Severity = 1 | 2 | 3;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function archetypeOf(key: string, cfg: CompanyEventsConfig = COMPANY_EVENTS): CompanyEventArchetype | undefined {
  return cfg.archetypes.find((a) => a.key === key);
}

/** Severity from a uniform number in [0, 1). */
export function rollSeverity(u: number, cfg: CompanyEventsConfig = COMPANY_EVENTS): Severity {
  const [w1, w2] = cfg.severityWeights;
  if (u < w1) return 1;
  if (u < w1 + w2) return 2;
  return 3;
}

/**
 * Weighted pick of an archetype of the given polarity that fits the sector. External archetypes (ADR-209) only with
 * a size context and from their minimum company value, weighted by size, country and lobby (sizedWeight).
 */
export function pickArchetype(
  u: number,
  sector: EventSector,
  polarity: "crisis" | "chance",
  cfg: CompanyEventsConfig = COMPANY_EVENTS,
  size?: SizeContext,
): CompanyEventArchetype {
  const pool = cfg.archetypes
    .filter((a) => a.polarity === polarity && (!a.sectors || a.sectors.includes(sector)))
    .map((a) => ({ a, w: Math.max(0, sizedWeight(a, size)) }))
    .filter((x) => x.w > 0);
  const total = pool.reduce((s, x) => s + x.w, 0);
  let x = clamp(u, 0, 0.999_999) * total;
  for (const p of pool) {
    x -= p.w;
    if (x < 0) return p.a;
  }
  return pool.at(-1)!.a;
}

export interface EventRollContext {
  readonly sector: EventSector;
  /** Hours since the company was founded. */
  readonly ageHours: number;
  /** Hours since the last event started; null when there never was one. */
  readonly hoursSinceLast: number | null;
  /** An event is still open or in force. */
  readonly hasActive: boolean;
  /** ADR-209: company value, country risk and lobby level; without it the roll is the one of a small company. */
  readonly size?: SizeContext;
}

/**
 * The daily roll (one per company and Berlin day): null, or the archetype and severity of a new event. `u` are four
 * uniform numbers: happens?, crisis or chance?, which archetype?, how bad?
 */
export function rollCompanyEvent(
  u: readonly [number, number, number, number],
  ctx: EventRollContext,
  cfg: CompanyEventsConfig = COMPANY_EVENTS,
): { archetype: CompanyEventArchetype; severity: Severity } | null {
  if (ctx.hasActive || ctx.ageHours < cfg.minAgeHours) return null;
  if (ctx.hoursSinceLast !== null && ctx.hoursSinceLast < cfg.minGapHours) return null;
  const decades = ctx.size ? sizeDecades(ctx.size.worthCents) : 0;
  if (u[0] >= sizedChancePerDay(cfg.chancePerDay, decades)) return null;
  const polarity = u[1] < sizedChanceShare(cfg.chanceShare, decades) ? "chance" : "crisis";
  return {
    archetype: pickArchetype(u[2], ctx.sector, polarity, cfg, ctx.size),
    severity: rollSeverity(sizedSeverityUniform(u[3], decades), cfg),
  };
}

/** One cost unit for this company: bigger companies pay more for the same lobbying. */
export function costUnitCents(fixedCostCentsPerQuarter: number, cfg: CompanyEventsConfig = COMPANY_EVENTS): number {
  return Math.max(cfg.costUnit.minUnitCents, Math.round(fixedCostCentsPerQuarter * cfg.costUnit.unitShareOfFixed));
}

/** Price of a step in cents; retries cost a share again, severity makes everything dearer. */
export function stepCostCents(
  step: CompanyEventStep,
  unitCents: number,
  severity: Severity,
  retry = false,
  cfg: CompanyEventsConfig = COMPANY_EVENTS,
): number {
  const base = step.cost * unitCents * (1 + 0.25 * (severity - 1));
  return Math.round(retry ? base * cfg.retryCostShare : base);
}

/** Success chance in bps: base, plus know-how of the team, minus severity; between 5 % and 100 %. */
export function stepSuccessBps(
  step: CompanyEventStep,
  severity: Severity,
  teamBranchScore: number,
  cfg: CompanyEventsConfig = COMPANY_EVENTS,
): number {
  const knowHow = step.branch
    ? Math.min(cfg.knowHow.maxBonusBps, Math.max(0, teamBranchScore) * cfg.knowHow.bpsPerPoint)
    : 0;
  return clamp(Math.round(step.baseBps + knowHow - cfg.severityPenaltyBps * (severity - 1)), 500, 10_000);
}

/** Whether the team is big enough to start the step. */
export function canStartStep(step: CompanyEventStep, headcount: number): boolean {
  return headcount >= (step.staff ?? 0);
}

/** The step succeeds when the draw u in [0, 1) lies below the chance. */
export function stepSucceeds(successBps: number, u: number): boolean {
  return u * 10_000 < successBps;
}

/** Price move of a listed company's share when the event is announced (crisis down, chance up). */
export function announcementShockBps(
  polarity: "crisis" | "chance",
  severity: Severity,
  cfg: CompanyEventsConfig = COMPANY_EVENTS,
): number {
  const size = cfg.shareShockBps[severity - 1]!;
  return polarity === "crisis" ? -size : Math.round(size / 2);
}

/** Price move on resolution: a solved crisis wins back what it cost; a seized chance adds the rest. */
export function resolutionShockBps(
  polarity: "crisis" | "chance",
  severity: Severity,
  mitigation: number,
  cfg: CompanyEventsConfig = COMPANY_EVENTS,
): number {
  const size = cfg.shareShockBps[severity - 1]!;
  return Math.round(polarity === "crisis" ? size * mitigation : (size / 2) * mitigation);
}

export type EventPhase = "open" | "in_force" | "over";

export interface EventTiming {
  readonly startedAt: number;
  readonly deadlineAt: number;
  /** When the response finished successfully (chance won, crisis solved), else null. */
  readonly resolvedAt: number | null;
}

/** Where the event stands at `now`. */
export function eventPhase(archetype: CompanyEventArchetype, t: EventTiming, now: number): EventPhase {
  const lasts = archetype.lastsHours * 3_600_000;
  if (archetype.polarity === "chance") {
    if (t.resolvedAt !== null) return now < t.resolvedAt + lasts ? "in_force" : "over";
    return now < t.deadlineAt ? "open" : "over";
  }
  if (now < t.deadlineAt && t.resolvedAt === null) return "open";
  const from = Math.min(t.deadlineAt, t.resolvedAt ?? t.deadlineAt);
  return now < from + lasts ? "in_force" : "over";
}

export interface EventModifiers {
  /** Multiply demand with this. */
  readonly demandFactor: number;
  /** Multiply capacity with this. */
  readonly capacityFactor: number;
  /** Extra costs as a share of the revenue (negative = savings). */
  readonly extraCostShare: number;
}

export const NO_EVENT: EventModifiers = { demandFactor: 1, capacityFactor: 1, extraCostShare: 0 };

/**
 * The effect in this hour. Crisis: a share of the effect while open (urgency), the full effect after the deadline,
 * reduced by what the response achieved. Chance: only after a successful response, scaled by its strength.
 * `runningCapacityHit` is the share of capacity tied up by a running step.
 */
export function eventModifiers(
  archetype: CompanyEventArchetype,
  severity: Severity,
  phase: EventPhase,
  mitigation: number,
  runningCapacityHit = 0,
  cfg: CompanyEventsConfig = COMPANY_EVENTS,
): EventModifiers {
  const scale = cfg.severityScale[severity - 1]!;
  let share = 0;
  if (archetype.polarity === "crisis") {
    if (phase === "open") share = cfg.preDeadlineShare * (1 - mitigation);
    else if (phase === "in_force") share = 1 - mitigation;
  } else if (phase === "in_force") {
    share = mitigation;
  }
  const e = archetype.effect;
  // ADR-209: insurance takes its share of an insurable crisis (fixed when the event started)
  const insured = archetype.polarity === "crisis" ? clamp(archetype.insuredShare ?? 0, 0, 1) : 0;
  const leader = archetype.polarity === "crisis" ? clamp(archetype.leaderShare ?? 0, 0, 1) : 0;
  const s = share * scale * (1 - insured) * (1 - leader);
  return {
    demandFactor: Math.max(0.05, 1 + (e.demand ?? 0) * s),
    capacityFactor: Math.max(0.05, (1 + (e.capacity ?? 0) * s) * (1 - clamp(runningCapacityHit, 0, 0.9))),
    extraCostShare: (e.cost ?? 0) * s,
  };
}
