import { describe, expect, it } from "vitest";
import { emptyBranches } from "./skills.ts";
import {
  nextTier,
  promotedSalaryCents,
  promotionChanceBps,
  promotionCheck,
  promotionGranted,
  type PromotionInput,
} from "./promotion.ts";

const scores = (values: Partial<ReturnType<typeof emptyBranches>>) => ({ ...emptyBranches(), ...values });

const intern: PromotionInput = { tier: "intern", level: 5, scores: scores({ it: 2 }), mainBranch: "it", rankHours: 12 };

describe("career ladder", () => {
  it("goes up one rank at a time and ends at C-level", () => {
    expect(nextTier("intern")).toBe("junior");
    expect(nextTier("team_lead")).toBe("c_level");
    expect(nextTier("c_level")).toBeNull();
  });
});

describe("promotion requirements", () => {
  it("lists level, main branch and hours for junior", () => {
    const check = promotionCheck(intern);
    expect(check.next).toBe("junior");
    expect(check.requirements.map((r) => [r.key, r.need, r.have, r.met])).toEqual([
      ["level", 5, 5, true],
      ["branch", 2, 2, true],
      ["hours", 12, 12, true],
    ]);
    expect(check.ready).toBe(true);
    expect(check.chanceBps).toBe(4_000);
  });

  it("is not ready while one requirement is missing, and the chance is 0", () => {
    const check = promotionCheck({ ...intern, rankHours: 11.9 });
    expect(check.ready).toBe(false);
    expect(check.requirements.find((r) => r.key === "hours")).toMatchObject({ have: 11, met: false });
    expect(check.chanceBps).toBe(0);
  });

  it("asks for management from team lead on, unless the job is in management", () => {
    const senior: PromotionInput = {
      tier: "senior",
      level: 20,
      scores: scores({ it: 12, management: 5 }),
      mainBranch: "it",
      rankHours: 72,
    };
    const check = promotionCheck(senior);
    expect(check.next).toBe("team_lead");
    expect(check.requirements.find((r) => r.key === "management")).toMatchObject({ need: 6, have: 5, met: false });
    expect(check.ready).toBe(false);
    const manager = promotionCheck({ ...senior, mainBranch: "management", scores: scores({ management: 12 }) });
    expect(manager.requirements.some((r) => r.key === "management")).toBe(false);
    expect(manager.ready).toBe(true);
  });

  it("has nothing above C-level", () => {
    expect(promotionCheck({ ...intern, tier: "c_level" })).toEqual({
      next: null,
      requirements: [],
      ready: false,
      chanceBps: 0,
    });
  });
});

describe("promotion chance", () => {
  it("grows with every score point above the requirement and with rhetoric, up to the cap", () => {
    expect(promotionChanceBps(0)).toBe(4_000);
    expect(promotionChanceBps(3)).toBe(6_400);
    expect(promotionChanceBps(3, 1_000)).toBe(7_400);
    expect(promotionChanceBps(50, 1_500)).toBe(9_000);
    expect(promotionCheck({ ...intern, scores: scores({ it: 4 }), bonusBps: 500 }).chanceBps).toBe(6_100);
  });

  it("decides with a uniform draw", () => {
    expect(promotionGranted(4_000, 0.39)).toBe(true);
    expect(promotionGranted(4_000, 0.4)).toBe(false);
  });
});

describe("wage after a promotion", () => {
  it("is the base wage of the new rank or 15 % more, whichever is higher", () => {
    expect(promotedSalaryCents(15_000, "junior")).toBe(30_000);
    expect(promotedSalaryCents(40_000, "junior")).toBe(46_000);
  });
});
