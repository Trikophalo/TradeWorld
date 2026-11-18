import { describe, expect, it } from "vitest";
import { demoHourCosts } from "./hour-costs";

const base = {
  hourStart: "2026-11-18T10:00:00Z",
  revenueCents: 100_000,
  profitCents: 20_000,
  playerWagesCents: 10_000,
  aiWagesCents: 5_000,
  fixedCents: 15_000,
  marketingCents: 5_000,
  talentsCents: 0,
  premiumBps: 40,
  overheadBps: 300,
};

describe("demo costs of the last hour (ADR-208, Nachtrag)", () => {
  it("splits the costs into fixed and variable parts that add up to revenue minus profit", () => {
    const c = demoHourCosts(base);
    expect(c.fixedCents).toBe(c.fixed.reduce((s, p) => s + p.cents, 0));
    expect(c.variableCents).toBe(c.variable.reduce((s, p) => s + p.cents, 0));
    expect(c.fixedCents + c.variableCents).toBe(base.revenueCents - base.profitCents);
    expect(c.fixed.find((p) => p.key === "insurance")?.cents).toBe(400);
    expect(c.fixed.find((p) => p.key === "overhead")?.cents).toBe(3_000);
    expect(c.variable.find((p) => p.key === "goods")?.cents).toBe(45_000 - 3_400);
  });

  it("never splits out more insurance and overhead than the goods cost", () => {
    const c = demoHourCosts({ ...base, profitCents: 64_000, premiumBps: 2_000, overheadBps: 2_000 });
    expect(c.variable.find((p) => p.key === "goods")?.cents).toBe(0);
    for (const p of [...c.fixed, ...c.variable]) expect(p.cents).toBeGreaterThanOrEqual(0);
  });

  it("is empty before the first hour", () => {
    expect(demoHourCosts({ ...base, hourStart: null })).toEqual({
      hourStart: null,
      revenueCents: 0,
      fixedCents: 0,
      variableCents: 0,
      fixed: [],
      variable: [],
    });
  });
});
