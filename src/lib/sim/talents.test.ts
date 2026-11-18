import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { TALENT_POOL, TALENT_ROLES, generateTalentPool } from "../../config/talents.ts";
import {
  talentCoCeoEligible,
  talentCoCeoPick,
  talentCoCeoSpendLimit,
  talentMood,
  talentOfferAccepted,
  talentOfferChecks,
  talentOfferCost,
  talentPoachMinCost,
  talentSatisfactionStep,
  talentStyle,
  talentWageFloor,
  talentsEffectBps,
  talentsHourFactors,
} from "./talents.ts";

const cfg = BALANCE.talents;
const rich = { reputation: 80, awarenessBps: 9_000, formRank: 4, expansionLevel: 2, freeCashCents: 1e12 };

describe("talent pool", () => {
  it("has 15 Stellen with perRole talents each, unique keys and unique names", () => {
    expect(TALENT_ROLES).toHaveLength(15);
    expect(TALENT_POOL).toHaveLength(15 * cfg.perRole);
    expect(cfg.countByTier.reduce((a, b) => a + b, 0)).toBe(cfg.perRole);
    expect(new Set(TALENT_POOL.map((t) => t.key)).size).toBe(TALENT_POOL.length);
    expect(new Set(TALENT_POOL.map((t) => `${t.firstName} ${t.lastName}`)).size).toBe(TALENT_POOL.length);
  });
  it("is deterministic", () => {
    expect(generateTalentPool()).toEqual(TALENT_POOL);
  });
  it("better tiers demand more and give more; wages are whole euros; traits differ", () => {
    for (const role of TALENT_ROLES) {
      const of = TALENT_POOL.filter((t) => t.role === role.key);
      const avg = (tier: number, f: (t: (typeof of)[number]) => number) => {
        const xs = of.filter((t) => t.tier === tier).map(f);
        return xs.reduce((a, b) => a + b, 0) / xs.length;
      };
      for (let tier = 1; tier < 5; tier++) {
        expect(avg(tier, (t) => t.wageCents)).toBeGreaterThan(avg(tier - 1, (t) => t.wageCents));
        expect(avg(tier, (t) => t.effectBps)).toBeGreaterThan(avg(tier - 1, (t) => t.effectBps));
      }
    }
    for (const t of TALENT_POOL) {
      expect(t.wageCents % 100).toBe(0);
      expect(t.traits[0]).not.toBe(t.traits[1]);
      expect(t.benefits.length).toBeGreaterThanOrEqual(cfg.benefitsByTier[t.tier]!);
    }
  });
});

describe("wages (Nachtrag ADR-199)", () => {
  it("rise steeply: about x5 per tier, a Legende costs 40.000 € per hour before role and traits", () => {
    expect(cfg.wageCentsByTier).toEqual([6_000, 30_000, 150_000, 800_000, 4_000_000]);
    for (let tier = 1; tier < 5; tier++) {
      expect(cfg.wageCentsByTier[tier]! / cfg.wageCentsByTier[tier - 1]!).toBeGreaterThanOrEqual(5);
    }
    const legends = TALENT_POOL.filter((t) => t.tier === 4).map((t) => t.wageCents);
    expect(Math.min(...legends)).toBeGreaterThanOrEqual(2_500_000);
  });
  it("the floor of a hired talent is the demand, for a Mit-GF plus the premium", () => {
    expect(talentWageFloor(150_000, false)).toBe(150_000);
    expect(talentWageFloor(150_000, true)).toBe(195_000);
    expect(talentWageFloor(150_050, true)).toBe(195_100);
  });
});

describe("offers", () => {
  const t = TALENT_POOL.find((x) => x.tier === 3)!;
  it("costs wage plus benefits", () => {
    expect(talentOfferCost(10_000, ["company_car", "bonus", "say"])).toBe(10_000 + 1_500 + 1_000);
    expect(talentOfferCost(10_000, ["bonus", "bonus"])).toBe(11_000);
  });
  it("accepts only when every demand is met", () => {
    const ok = talentOfferChecks(t, { wageCents: t.wageCents, benefits: [...t.benefits] }, rich);
    expect(talentOfferAccepted(ok)).toBe(true);
    const low = talentOfferChecks(t, { wageCents: t.wageCents - 100, benefits: [...t.benefits] }, rich);
    expect(low.find((c) => c.key === "wage")?.ok).toBe(false);
    expect(talentOfferAccepted(low)).toBe(false);
    const poor = talentOfferChecks(
      t,
      { wageCents: t.wageCents, benefits: [...t.benefits] },
      { ...rich, reputation: 10, freeCashCents: 0 },
    );
    expect(poor.filter((c) => !c.ok).map((c) => c.key)).toEqual(["reputation", "cash"]);
    if (t.benefits.length > 0) {
      expect(talentOfferAccepted(talentOfferChecks(t, { wageCents: t.wageCents * 2, benefits: [] }, rich))).toBe(false);
    }
  });
  it("poaching needs a margin, loyalty raises it", () => {
    expect(talentPoachMinCost(10_000, ["sporty", "night_owl"])).toBe(11_500);
    expect(talentPoachMinCost(10_000, ["loyal", "family"])).toBe(15_000);
    expect(talentPoachMinCost(10_000, ["diva", "bold"])).toBe(10_000);
  });
});

describe("satisfaction", () => {
  const all = { paid: true, reputationOk: true, awarenessOk: true, benefitsOk: true, moraleBps: 0 };
  it("rises when all is met and falls per unmet demand, faster for divas", () => {
    expect(talentSatisfactionStep(7_000, all, ["sporty", "night_owl"])).toBe(7_250);
    expect(talentSatisfactionStep(7_000, { ...all, paid: false }, ["sporty", "night_owl"])).toBe(4_500);
    expect(talentSatisfactionStep(7_000, { ...all, paid: false }, ["diva", "sporty"])).toBe(7_000 - 3_750);
    expect(talentSatisfactionStep(7_000, { ...all, paid: false }, ["loyal", "sporty"])).toBe(7_000 - 1_500);
    expect(talentSatisfactionStep(9_900, { ...all, moraleBps: 500 }, [])).toBe(10_000);
  });
  it("an underpaid talent (risen demand, grace over) loses satisfaction every hour", () => {
    expect(talentSatisfactionStep(7_000, { ...all, underpaid: true }, ["sporty", "night_owl"])).toBe(
      7_000 - cfg.satisfaction.underpaidBps,
    );
    expect(talentSatisfactionStep(7_000, { ...all, underpaid: false }, ["sporty", "night_owl"])).toBe(7_250);
  });
  it("warns and quits at the thresholds", () => {
    expect(talentMood(8_000)).toBe("happy");
    expect(talentMood(3_000)).toBe("warning");
    expect(talentMood(1_000)).toBe("quit");
  });
});

describe("effects", () => {
  it("sums per kind and caps", () => {
    const bps = talentsEffectBps([
      { role: "sales", effectBps: 3_000 },
      { role: "strategy", effectBps: 2_000 },
      { role: "controlling", effectBps: 500 },
      { role: "nope", effectBps: 9_999 },
    ]);
    expect(bps.demand).toBe(cfg.capBps.demand);
    expect(bps.fixed).toBe(500);
    expect(talentsHourFactors(bps).fixedFactor).toBeCloseTo(0.95);
    expect(talentsHourFactors(bps).demandFactor).toBeCloseTo(1.35);
  });
});

describe("Mit-Geschäftsführer", () => {
  it("needs Senior, a leader one tier earlier", () => {
    expect(talentCoCeoEligible({ tier: 2, traits: ["sporty", "family"] })).toBe(true);
    expect(talentCoCeoEligible({ tier: 1, traits: ["sporty", "family"] })).toBe(false);
    expect(talentCoCeoEligible({ tier: 1, traits: ["leader", "family"] })).toBe(true);
  });
  it("picks by personality and spends within the budget", () => {
    const s = [
      { key: "fast", mitigation: 0.3, steps: 1 },
      { key: "thorough", mitigation: 0.9, steps: 3 },
      { key: "mid", mitigation: 0.7, steps: 1 },
    ];
    expect(talentStyle(["cautious", "loyal"])).toBe("cautious");
    expect(talentCoCeoPick(s, "cautious")).toBe("thorough");
    expect(talentCoCeoPick(s, "bold")).toBe("mid");
    expect(talentCoCeoPick(s, "balanced")).toBe("mid");
    expect(talentCoCeoPick([], "bold")).toBeNull();
    expect(talentCoCeoSpendLimit(100_000, 40_000, "bold")).toBe(60_000);
    expect(talentCoCeoSpendLimit(100_000, 40_000, "cautious")).toBe(30_000);
    expect(talentCoCeoSpendLimit(100_000, 140_000, "balanced")).toBe(0);
  });
});
