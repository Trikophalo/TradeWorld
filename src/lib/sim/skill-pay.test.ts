import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  aiSalaryCeiling,
  emptyBranches,
  hourProfitShares,
  matchScore,
  profitShareBps,
  skillPayBps,
  skillPayCeiling,
  stockGrantChanceBps,
  type JobRequirement,
} from "./skills.ts";

const scores = (part: Partial<ReturnType<typeof emptyBranches>>) => ({ ...emptyBranches(), ...part });
const senior: JobRequirement[] = [{ branch: "it", minScore: 6 }];
const lead: JobRequirement[] = [
  { branch: "it", minScore: 12 },
  { branch: "management", minScore: 6 },
];

describe("skill-scaled pay (ADR-206)", () => {
  it("adds the relevant branch scores and every learned skill", () => {
    expect(skillPayBps(senior, scores({}), 0)).toBe(10_000);
    // 1 + 0.03 × 12 + 0.005 × 15
    expect(skillPayBps(senior, scores({ it: 12 }), 15)).toBe(14_350);
    // unrelated branches do not count, the learned skills still do
    expect(skillPayBps(senior, scores({ law: 30 }), 10)).toBe(10_500);
  });

  it("pays a lot more than the old capped ceiling for many skills", () => {
    const s = scores({ it: 30 });
    const before = aiSalaryCeiling(70_000, matchScore(senior, s));
    const after = skillPayCeiling(70_000, senior, s, 40);
    expect(before).toBe(95_200); // 1.36 x: the match score stops at twice the requirement
    expect(after).toBe(147_000); // 2.1 x
  });

  it("counts each branch at most up to the cap and stops at the multiplier", () => {
    const cap = BALANCE.jobs.skillPay.relevantScoreCapPerBranch;
    expect(skillPayBps(senior, scores({ it: cap + 50 }), 0)).toBe(skillPayBps(senior, scores({ it: cap }), 0));
    expect(skillPayCeiling(130_000, lead, scores({ it: 40, management: 20 }), 60)).toBe(390_000);
  });
});

describe("profit share and employee shares (ADR-206)", () => {
  it("starts at Senior and rises with the rank to at most 5 %", () => {
    expect(profitShareBps("intern")).toBe(0);
    expect(profitShareBps("junior", 300)).toBe(0);
    expect(profitShareBps("senior")).toBe(50);
    expect(profitShareBps("team_lead")).toBe(200);
    expect(profitShareBps("c_level")).toBe(500);
    expect(profitShareBps("c_level", 300)).toBe(500);
    expect(profitShareBps("senior", 300)).toBe(350);
  });

  it("splits at most the company cap of an hour and nothing without profit", () => {
    expect(hourProfitShares(1_000_000, [50, 200, 500])).toEqual([5_000, 20_000, 50_000]);
    // 10 × 5 % = 50 % asked, 25 % allowed: everyone gets half
    expect(hourProfitShares(1_000_000, Array(10).fill(500))).toEqual(Array(10).fill(25_000));
    expect(hourProfitShares(-5, [500])).toEqual([0]);
  });

  it("gives a chance for shares that grows with the rank", () => {
    expect(stockGrantChanceBps("intern")).toBe(0);
    expect(stockGrantChanceBps("senior")).toBe(300);
    expect(stockGrantChanceBps("c_level", 500)).toBe(1_300);
  });
});
