import { describe, expect, it } from "vitest";
import { COUNTRIES, WORLD_RULES } from "../../config/countries.ts";
import {
  countryFactors,
  countryScore,
  imageBonusAfter,
  imageBonusWithCampaign,
  imageCampaignCostCents,
  locationFeeCents,
  NEUTRAL_WORLD_EFFECT,
  relocationCostCents,
  subsidiaryHourlyCostCents,
  subsidiaryRamp,
  subsidiarySetupCostCents,
  subsidiaryShare,
  subsidiaryUnlocked,
  worldHourEffect,
  worldUnlockProgress,
} from "./world.ts";

describe("countries (ADR-208)", () => {
  it("has 15 to 25 countries with unique keys and positions on the map", () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(15);
    expect(COUNTRIES.length).toBeLessThanOrEqual(25);
    expect(new Set(COUNTRIES.map((c) => c.key)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) {
      expect(c.map.x).toBeGreaterThanOrEqual(0);
      expect(c.map.x).toBeLessThanOrEqual(100);
      expect(c.map.y).toBeGreaterThanOrEqual(0);
      expect(c.map.y).toBeLessThanOrEqual(100);
      expect(c.flag.length).toBeGreaterThan(0);
    }
  });

  it("is balanced: every country's score lies within the tolerance of the mean", () => {
    const scores = COUNTRIES.map((c) => countryScore(c));
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    for (const [i, s] of scores.entries()) {
      expect(Math.abs(s - mean), COUNTRIES[i]!.key).toBeLessThanOrEqual(WORLD_RULES.balance.tolerance);
    }
  });

  it("keeps the realistic profiles: China cheap but weaker image, Germany expensive labour but strong image", () => {
    const by = (k: string) => COUNTRIES.find((c) => c.key === k)!;
    expect(by("cn").productionCostBps).toBeLessThan(by("de").productionCostBps);
    expect(by("cn").imageBps).toBeLessThan(by("de").imageBps);
    expect(by("de").labourCostBps).toBeGreaterThan(10_000);
    expect(by("us").demandPotentialBps).toBeGreaterThan(by("de").demandPotentialBps);
    expect(by("us").taxRateBps).toBeGreaterThan(by("ie").taxRateBps);
  });

  it("has no country that is best in every trait", () => {
    for (const c of COUNTRIES) {
      const others = COUNTRIES.filter((o) => o !== c);
      const dominates = others.every(
        (o) =>
          c.productionCostBps <= o.productionCostBps &&
          c.labourCostBps <= o.labourCostBps &&
          c.demandPotentialBps >= o.demandPotentialBps &&
          c.taxRateBps <= o.taxRateBps,
      );
      expect(dominates, c.key).toBe(false);
    }
  });
});

describe("country terms", () => {
  const de = COUNTRIES.find((c) => c.key === "de")!;
  it("turns traits into factors; image lifts demand with half weight", () => {
    const f = countryFactors(de);
    expect(f.cogs).toBeCloseTo(de.productionCostBps / 10_000);
    expect(f.fixed).toBeCloseTo(de.labourCostBps / 10_000);
    expect(f.demand).toBeCloseTo((de.demandPotentialBps / 10_000) * (1 + (de.imageBps - 10_000) / 20_000));
    expect(countryFactors(de, 1_000).demand).toBeGreaterThan(f.demand);
  });

  it("is neutral without a headquarters", () => {
    expect(worldHourEffect(null)).toEqual(NEUTRAL_WORLD_EFFECT);
  });

  it("blends a ramped-up subsidiary into the headquarters' terms", () => {
    const e = worldHourEffect({ country: "de", imageBonusBps: 0, tier: 1 }, [
      { country: "vn", imageBonusBps: 0, hoursOpen: 10_000 },
    ]);
    expect(e.subsidiaryShare).toBeCloseTo(0.15);
    expect(e.cogsFactor).toBeCloseTo(0.85 * 1.1 + 0.15 * 0.78);
  });

  it("gives diminishing returns per subsidiary and respects the cap", () => {
    expect(subsidiaryShare(1, 10_000)).toBeLessThan(subsidiaryShare(0, 10_000));
    const many = Array.from({ length: 10 }, (_, i) => ({
      country: COUNTRIES[i + 1]!.key,
      imageBonusBps: 0,
      hoursOpen: 10_000,
    }));
    const e = worldHourEffect({ country: "de", imageBonusBps: 0, tier: 5 }, many);
    const max = WORLD_RULES.subsidiaries.max;
    const expected = Array.from({ length: max }, (_, i) => subsidiaryShare(i, 10_000)).reduce((a, b) => a + b, 0);
    expect(e.subsidiaryShare).toBeCloseTo(expected);
    expect(e.demandFactor).toBeLessThanOrEqual(WORLD_RULES.effects.maxFactorBps / 10_000);
  });

  it("gives the market leader a tax discount", () => {
    const plain = worldHourEffect({ country: "de", imageBonusBps: 0, tier: 1 });
    const lead = worldHourEffect({ country: "de", imageBonusBps: 0, tier: 1, leader: true });
    expect(lead.taxRateBps).toBe(Math.round((plain.taxRateBps * 9_000) / 10_000));
  });
});

describe("prices", () => {
  it("makes every HQ tier much more expensive than the last", () => {
    const tiers = WORLD_RULES.hqTiers;
    expect(tiers[0]!.costCents).toBe(100_000_000);
    for (let i = 1; i < tiers.length; i++)
      expect(tiers[i]!.costCents).toBeGreaterThanOrEqual(3 * tiers[i - 1]!.costCents);
  });

  it("ramps subsidiaries up: costs fall from x3 to x1, the share rises", () => {
    expect(subsidiaryRamp(0)).toBe(0);
    expect(subsidiaryRamp(WORLD_RULES.subsidiaries.rampUpHours)).toBe(1);
    expect(subsidiaryHourlyCostCents(0)).toBe(180_000);
    expect(subsidiaryHourlyCostCents(1e6)).toBe(60_000);
    expect(subsidiarySetupCostCents(1)).toBe(300_000_000);
    expect(subsidiarySetupCostCents(2)).toBe(480_000_000);
  });

  it("prices relocation and image campaigns with a floor", () => {
    expect(relocationCostCents(0)).toBe(WORLD_RULES.relocation.minCostCents);
    expect(relocationCostCents(10_000_000_000)).toBe(2_000_000_000);
    expect(imageCampaignCostCents(0)).toBe(WORLD_RULES.imageCampaign.minCostCents);
    expect(imageCampaignCostCents(100_000_000_000)).toBe(500_000_000);
  });

  it("caps and fades the image bonus", () => {
    expect(imageBonusWithCampaign(2_800)).toBe(WORLD_RULES.imageCampaign.maxBonusBps);
    expect(imageBonusAfter(500, 2)).toBe(300);
    expect(imageBonusAfter(100, 30)).toBe(0);
  });

  it("bounds the location fee by the cap and the free cash", () => {
    expect(locationFeeCents(100_000, 300, 1e9)).toBe(3_000);
    expect(locationFeeCents(100_000, 5_000, 1e9)).toBe(3_000);
    expect(locationFeeCents(100_000, 300, 1_000)).toBe(1_000);
    expect(locationFeeCents(-5, 300, 1e9)).toBe(0);
  });

  it("opens the map at 10 Mio. € and subsidiaries by value or tier", () => {
    expect(worldUnlockProgress(500_000_000)).toBe(0.5);
    expect(worldUnlockProgress(5e9)).toBe(1);
    expect(subsidiaryUnlocked(1e9, 1)).toBe(false);
    expect(subsidiaryUnlocked(1e9, 2)).toBe(true);
    expect(subsidiaryUnlocked(6e9, 1)).toBe(true);
    expect(subsidiaryUnlocked(6e9, 0)).toBe(false);
  });
});
