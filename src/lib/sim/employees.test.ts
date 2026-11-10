import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { effectiveSkillPoints, marketSalaryCents, onboardingFactor } from "./employees.ts";

describe("employees", () => {
  const base = { skill: 5, quartersEmployed: 10, traitKey: null, isPlayer: false };

  it("ramps up during onboarding", () => {
    expect(onboardingFactor(0)).toBe(0.4);
    expect(onboardingFactor(1)).toBe(0.7);
    expect(onboardingFactor(2)).toBe(1);
    expect(onboardingFactor(40)).toBe(1);
  });

  it("converts skill to capacity points", () => {
    expect(effectiveSkillPoints(base)).toBeCloseTo(5 ** 1.1, 12);
    expect(effectiveSkillPoints({ ...base, quartersEmployed: 0 })).toBeCloseTo(5 ** 1.1 * 0.4, 12);
    expect(effectiveSkillPoints({ ...base, skill: 99 })).toBeCloseTo(10 ** 1.1, 12);
  });

  it("real players are twice as productive", () => {
    expect(effectiveSkillPoints({ ...base, isPlayer: true })).toBeCloseTo(
      effectiveSkillPoints(base) * BALANCE.employees.playerProductivityMultiplier,
      12,
    );
  });

  it("applies traits", () => {
    expect(effectiveSkillPoints({ ...base, traitKey: "ambitious" })).toBeCloseTo(5 ** 1.1 * 1.15, 12);
    expect(effectiveSkillPoints({ ...base, traitKey: "unknown" })).toBeCloseTo(5 ** 1.1, 12);
  });

  it("salary grows faster than capacity with skill", () => {
    const low = Number(marketSalaryCents(3)) / effectiveSkillPoints({ ...base, skill: 3 });
    const high = Number(marketSalaryCents(9)) / effectiveSkillPoints({ ...base, skill: 9 });
    expect(high).toBeGreaterThan(low);
    expect(marketSalaryCents(1)).toBe(BigInt(BALANCE.employees.salaryBaseCentsPerQuarter));
    expect(marketSalaryCents(5, "genius") > marketSalaryCents(5)).toBe(true);
  });
});
