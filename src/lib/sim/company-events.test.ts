import { describe, expect, it } from "vitest";
import { COMPANY_EVENTS } from "../../config/company-events.ts";
import {
  announcementShockBps,
  archetypeOf,
  canStartStep,
  costUnitCents,
  eventModifiers,
  eventPhase,
  pickArchetype,
  resolutionShockBps,
  rollCompanyEvent,
  rollSeverity,
  stepCostCents,
  stepSucceeds,
  stepSuccessBps,
} from "./company-events.ts";

const H = 3_600_000;
const ctx = { sector: "energy" as const, ageHours: 100, hoursSinceLast: null, hasActive: false };

describe("company events catalog (ADR-091)", () => {
  it("every archetype is answerable with real work, and crises can be sat out", () => {
    for (const a of COMPANY_EVENTS.archetypes) {
      const working = a.strategies.filter((s) => s.steps.length > 0);
      expect(working.length, a.key).toBeGreaterThanOrEqual(1);
      // Not one click: at least one strategy needs two or more steps.
      expect(
        working.some((s) => s.steps.length >= 2),
        a.key,
      ).toBe(true);
      expect(
        a.strategies.some((s) => s.steps.length === 0),
        a.key,
      ).toBe(true);
      for (const s of working) for (const step of s.steps) expect(step.hours).toBeGreaterThan(0);
    }
    const keys = COMPANY_EVENTS.archetypes.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("rolling (at most one a day)", () => {
  it("rolls nothing while an event runs, too early or too soon after the last", () => {
    const u = [0, 0.9, 0.5, 0.1] as const;
    expect(rollCompanyEvent(u, { ...ctx, hasActive: true })).toBeNull();
    expect(rollCompanyEvent(u, { ...ctx, ageHours: 1 })).toBeNull();
    expect(rollCompanyEvent(u, { ...ctx, hoursSinceLast: 5 })).toBeNull();
    expect(rollCompanyEvent([0.99, 0.9, 0.5, 0.1], ctx)).toBeNull();
    expect(rollCompanyEvent(u, ctx)).not.toBeNull();
  });

  it("chooses crisis or chance, and only archetypes of the sector", () => {
    expect(rollCompanyEvent([0, 0.1, 0.5, 0.1], ctx)!.archetype.polarity).toBe("chance");
    expect(rollCompanyEvent([0, 0.9, 0.5, 0.1], ctx)!.archetype.polarity).toBe("crisis");
    for (let i = 0; i < 100; i++) {
      const a = pickArchetype(i / 100, "pharma", "crisis");
      expect(!a.sectors || a.sectors.includes("pharma")).toBe(true);
    }
  });

  it("severity follows the weights", () => {
    expect(rollSeverity(0.1)).toBe(1);
    expect(rollSeverity(0.6)).toBe(2);
    expect(rollSeverity(0.95)).toBe(3);
  });
});

describe("responding takes money, time, people and know-how", () => {
  const lobby = archetypeOf("regulation")!.strategies.find((s) => s.key === "lobby")!;
  const hearing = lobby.steps.find((s) => s.key === "hearing")!;

  it("bigger companies and worse events cost more; retries cost a share", () => {
    expect(costUnitCents(15_000)).toBe(COMPANY_EVENTS.costUnit.minUnitCents);
    expect(costUnitCents(600_000)).toBeGreaterThan(costUnitCents(15_000));
    expect(stepCostCents(hearing, 20_000, 3)).toBeGreaterThan(stepCostCents(hearing, 20_000, 1));
    expect(stepCostCents(hearing, 20_000, 1, true)).toBeLessThan(stepCostCents(hearing, 20_000, 1));
  });

  it("know-how raises the chance, severity lowers it, within 5 % and 100 %", () => {
    expect(stepSuccessBps(hearing, 1, 10)).toBeGreaterThan(stepSuccessBps(hearing, 1, 0));
    expect(stepSuccessBps(hearing, 3, 0)).toBeLessThan(stepSuccessBps(hearing, 1, 0));
    expect(stepSuccessBps(hearing, 1, 1_000)).toBeLessThanOrEqual(10_000);
    expect(stepSuccessBps({ ...hearing, baseBps: 0 }, 3, 0)).toBe(500);
    expect(stepSucceeds(6_000, 0.59)).toBe(true);
    expect(stepSucceeds(6_000, 0.61)).toBe(false);
  });

  it("some steps need people", () => {
    const alliance = lobby.steps.find((s) => s.key === "alliance")!;
    expect(canStartStep(alliance, 1)).toBe(false);
    expect(canStartStep(alliance, 2)).toBe(true);
  });
});

describe("effect on the business", () => {
  const crisis = archetypeOf("regulation")!;
  const chance = archetypeOf("viral_trend")!;
  const t = { startedAt: 0, deadlineAt: 30 * H, resolvedAt: null };

  it("a crisis bites a little while open, fully after the deadline, then passes", () => {
    expect(eventPhase(crisis, t, 10 * H)).toBe("open");
    expect(eventPhase(crisis, t, 31 * H)).toBe("in_force");
    expect(eventPhase(crisis, t, (30 + crisis.lastsHours + 1) * H)).toBe("over");
    const open = eventModifiers(crisis, 1, "open", 0);
    const full = eventModifiers(crisis, 1, "in_force", 0);
    expect(open.demandFactor).toBeLessThan(1);
    expect(full.demandFactor).toBeLessThan(open.demandFactor);
    expect(full.extraCostShare).toBeGreaterThan(0);
  });

  it("a solved crisis does no harm; severity makes it worse", () => {
    expect(eventModifiers(crisis, 1, "in_force", 1)).toEqual({ demandFactor: 1, capacityFactor: 1, extraCostShare: 0 });
    expect(eventModifiers(crisis, 3, "in_force", 0).demandFactor).toBeLessThan(
      eventModifiers(crisis, 1, "in_force", 0).demandFactor,
    );
  });

  it("a chance only pays after a successful response", () => {
    expect(eventModifiers(chance, 1, "open", 0).demandFactor).toBe(1);
    expect(eventPhase(chance, { ...t, deadlineAt: 12 * H, resolvedAt: 5 * H }, 20 * H)).toBe("in_force");
    expect(eventModifiers(chance, 1, "in_force", 1).demandFactor).toBeGreaterThan(1);
    expect(eventPhase(chance, { ...t, deadlineAt: 12 * H }, 13 * H)).toBe("over");
  });

  it("a running step ties up capacity", () => {
    expect(eventModifiers(crisis, 1, "open", 0, 0.3).capacityFactor).toBeCloseTo(0.7, 5);
  });

  it("listed companies: the share drops on a crisis and recovers when it is solved", () => {
    expect(announcementShockBps("crisis", 2)).toBeLessThan(0);
    expect(announcementShockBps("chance", 2)).toBeGreaterThan(0);
    expect(resolutionShockBps("crisis", 2, 1)).toBe(-announcementShockBps("crisis", 2));
    expect(resolutionShockBps("crisis", 2, 0)).toBe(0);
  });
});
