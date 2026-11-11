import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { SKILL_BRANCHES, SKILL_NODES } from "../../config/skills.ts";
import {
  aiPostingSpec,
  aiSalaryCeiling,
  branchScores,
  emptyBranches,
  fitPercent,
  learnCheck,
  matchScore,
  maxRaiseBps,
  meetsRequirements,
  oneSalaryCents,
  payForSkill,
  productivityBps,
  skillNode,
} from "./skills.ts";

describe("skill tree", () => {
  it("has 8 branches with 10 skills each plus 6 hybrids", () => {
    expect(SKILL_NODES).toHaveLength(86);
    for (const branch of SKILL_BRANCHES) {
      expect(SKILL_NODES.filter((n) => n.branches.length === 1 && n.branches[0] === branch)).toHaveLength(10);
    }
    expect(SKILL_NODES.filter((n) => n.branches.length === 2)).toHaveLength(6);
  });

  it("has unique keys and only known, lower-tier prerequisites", () => {
    const keys = new Set(SKILL_NODES.map((n) => n.key));
    expect(keys.size).toBe(SKILL_NODES.length);
    for (const node of SKILL_NODES) {
      for (const req of node.requires) {
        const parent = skillNode(req);
        expect(parent, `${node.key} requires ${req}`).toBeDefined();
        expect(parent!.tier).toBeLessThan(node.tier);
      }
    }
  });

  it("every skill is reachable from the basics", () => {
    const learned = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of SKILL_NODES) {
        if (!learned.has(node.key) && node.requires.every((r) => learned.has(r))) {
          learned.add(node.key);
          grew = true;
        }
      }
    }
    expect(learned.size).toBe(SKILL_NODES.length);
  });

  it("a full branch scores 30, hybrids count for both branches", () => {
    const it = SKILL_NODES.filter((n) => n.branches.length === 1 && n.branches[0] === "it").map((n) => n.key);
    expect(branchScores(it).it).toBe(30);
    const scores = branchScores(["hybrid_fintech"]);
    expect(scores.it).toBe(4);
    expect(scores.finance).toBe(4);
  });
});

describe("learning", () => {
  const none = emptyBranches();

  it("needs all prerequisites and enough points", () => {
    expect(learnCheck("it_basics", new Set(), 1, none)).toBe("ok");
    expect(learnCheck("it_programming", new Set(), 5, none)).toBe("locked");
    expect(learnCheck("it_programming", new Set(["it_basics"]), 1, none)).toBe("points");
    expect(learnCheck("it_programming", new Set(["it_basics"]), 2, none)).toBe("ok");
    expect(learnCheck("it_basics", new Set(["it_basics"]), 9, none)).toBe("learned");
    expect(learnCheck("nope", new Set(), 9, none)).toBe("unknown");
  });

  it("spends branch points before free points", () => {
    const node = skillNode("it_programming")!;
    const pay = payForSkill(node, 5, { ...none, it: 1 });
    expect(pay).toEqual({ free: 1, branches: { it: 1 } });
    expect(payForSkill(node, 0, { ...none, finance: 5 })).toBeNull();
  });

  it("hybrids can use the points of either branch", () => {
    const node = skillNode("hybrid_fintech")!;
    expect(payForSkill(node, 0, { ...none, it: 2, finance: 2 })).toEqual({ free: 0, branches: { it: 2, finance: 2 } });
  });
});

describe("jobs", () => {
  const scores = { ...emptyBranches(), it: 10, finance: 1 };

  it("caps the match per branch at twice the requirement", () => {
    expect(matchScore([{ branch: "it", minScore: 2 }], scores)).toBe(4);
    expect(matchScore([{ branch: "it", minScore: 6 }], scores)).toBe(10);
    expect(matchScore([{ branch: "it", minScore: 0 }], scores)).toBe(2);
    expect(fitPercent([{ branch: "it", minScore: 2 }], scores)).toBe(100);
  });

  it("checks minimum scores", () => {
    expect(meetsRequirements([{ branch: "it", minScore: 6 }], scores)).toBe(true);
    expect(meetsRequirements([{ branch: "finance", minScore: 2 }], scores)).toBe(false);
  });

  it("a player is always more productive than an AI worker", () => {
    expect(productivityBps(0)).toBeGreaterThan(10_000);
    expect(productivityBps(12)).toBe(24_600);
    expect(productivityBps(1000)).toBe(BALANCE.jobs.maxProductivity * 10_000);
  });

  it("AI employers pay at most the cap", () => {
    expect(aiSalaryCeiling(10_000, 0)).toBe(10_000);
    expect(aiSalaryCeiling(10_000, 10)).toBe(13_000);
    expect(aiSalaryCeiling(10_000, 100)).toBe(15_000);
  });

  it("raises grow with the skills gained, one salary is 12 hours", () => {
    expect(maxRaiseBps(0)).toBe(0);
    expect(maxRaiseBps(4)).toBe(1_200);
    expect(oneSalaryCents(15_000)).toBe(180_000);
  });
});

describe("AI postings", () => {
  it("follow the sector branches and rotate the tiers", () => {
    const a = aiPostingSpec("tech", 0, 0, 0);
    expect(a).toMatchObject({ titleKey: "it_intern", tier: "intern", minLevel: 2 });
    expect(a.required).toEqual([{ branch: "it", minScore: 0 }]);
    const b = aiPostingSpec("tech", 1, 1, 0);
    expect(b.titleKey).toBe("sales_team_lead");
    expect(b.required).toEqual([
      { branch: "sales", minScore: 12 },
      { branch: "management", minScore: 6 },
    ]);
    expect(aiPostingSpec("tech", 0, 0, 1).tier).toBe("junior");
  });
});
