import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { SKILL_BRANCHES, SKILL_NODES } from "../../config/skills.ts";
import {
  companySkill,
  companySkillBps,
  companySkillHourEffect,
  effectiveLevel,
  levelPrice,
  missingSkill,
  unlockedBy,
} from "./company-skills.ts";

const cfg = BALANCE.companySkills;

describe("company skills config", () => {
  it("covers every area of the skill map", () => {
    for (const b of SKILL_BRANCHES)
      expect(
        cfg.skills.some((s) => s.branch === b),
        b,
      ).toBe(true);
  });
  it("every level needs an existing skill of its area, never an easier one than the level before", () => {
    for (const s of cfg.skills) {
      expect(s.requires).toHaveLength(cfg.maxLevel);
      let tier = 0;
      for (const key of s.requires) {
        const node = SKILL_NODES.find((n) => n.key === key);
        expect(node, key).toBeDefined();
        expect(node!.branches).toContain(s.branch);
        expect(node!.tier).toBeGreaterThanOrEqual(tier);
        tier = node!.tier;
      }
    }
  });
  it("prices rise with the level", () => {
    for (let l = 2; l <= cfg.maxLevel; l++) {
      expect(levelPrice(l)!.costCents).toBeGreaterThan(levelPrice(l - 1)!.costCents);
    }
    expect(levelPrice(0)).toBeNull();
    expect(levelPrice(cfg.maxLevel + 1)).toBeNull();
  });
});

describe("company skill effects", () => {
  it("nothing learned changes nothing", () => {
    expect(companySkillHourEffect({})).toEqual({
      demandFactor: 1,
      capacityFactor: 1,
      cogsFactor: 1,
      fixedFactor: 1,
      qualityAdd: 0,
    });
  });
  it("data analysis level 3 lifts the demand by 3 %", () => {
    expect(companySkillHourEffect({ data_analysis: 3 }).demandFactor).toBeCloseTo(1.03, 10);
  });
  it("cost control and contracts lower costs", () => {
    const e = companySkillHourEffect({ cost_control: 2, contracts: 1 });
    expect(e.fixedFactor).toBeCloseTo(0.96, 10);
    expect(e.cogsFactor).toBeCloseTo(0.99, 10);
  });
  it("every kind stops at its cap, even with everything at the maximum", () => {
    const all = Object.fromEntries(cfg.skills.map((s) => [s.key, 99]));
    const b = companySkillBps(all);
    for (const k of Object.keys(b) as (keyof typeof b)[]) expect(b[k]).toBeLessThanOrEqual(cfg.capBps[k]);
    const e = companySkillHourEffect(all);
    expect(e.demandFactor).toBeLessThanOrEqual(1.1);
    expect(e.capacityFactor).toBeLessThanOrEqual(1.1);
    expect(e.cogsFactor).toBeGreaterThanOrEqual(0.92);
    expect(e.fixedFactor).toBeGreaterThanOrEqual(0.9);
    expect(e.qualityAdd).toBeLessThanOrEqual(0.05);
  });
  it("a level in training counts one lower", () => {
    expect(effectiveLevel(3, 2_000, 1_000)).toBe(2);
    expect(effectiveLevel(3, 1_000, 1_000)).toBe(3);
    expect(effectiveLevel(1, null, 0)).toBe(1);
  });
});

describe("requirements", () => {
  const data = companySkill("data_analysis")!;
  it("names the missing skill of the map", () => {
    expect(missingSkill(data, 1, new Set())).toBe("it_data");
    expect(missingSkill(data, 1, new Set(["it_data"]))).toBeNull();
    expect(missingSkill(data, 2, new Set(["it_data"]))).toBe("it_ml");
  });
  it("the skill map knows what a skill opens in the company", () => {
    expect(unlockedBy("it_data")).toEqual([{ key: "data_analysis", level: 1 }]);
    expect(unlockedBy("it_basics")).toEqual([]);
  });
});
