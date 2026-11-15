import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { livingBonus, ownerLivingBonus, tenantLivingBonus } from "./living.ts";

describe("living bonus (ADR-161)", () => {
  it("grows with the home and with the Wohnwert", () => {
    expect(ownerLivingBonus("flat", 0)).toEqual({ cents: 800, xp: 1 });
    expect(ownerLivingBonus("flat", 50)).toEqual({ cents: 1_400, xp: 2 });
    expect(ownerLivingBonus("flat", 100)).toEqual({ cents: 2_000, xp: 3 });
    expect(ownerLivingBonus("house", 90)).toEqual({ cents: 11_280, xp: 5 });
    expect(ownerLivingBonus("luxury_villa", 100)).toEqual({ cents: 80_000, xp: 10 });
    expect(ownerLivingBonus("flat", 150)).toEqual(ownerLivingBonus("flat", 100));
    const tiers = BALANCE.property.tiers.map((t) => ownerLivingBonus(t.key, 60));
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]!.cents).toBeGreaterThan(tiers[i - 1]!.cents);
      expect(tiers[i]!.xp).toBeGreaterThanOrEqual(tiers[i - 1]!.xp);
    }
  });

  it("stays a bonus: a day in the luxury villa brings less than a fifth of a percent of its price", () => {
    const day = ownerLivingBonus("luxury_villa", 100).cents * 24;
    const price = BALANCE.property.tiers.find((t) => t.key === "luxury_villa")!.priceCents;
    expect(day * 500).toBeLessThan(price);
  });

  it("a tenant gets half, and never more money than the rent per hour", () => {
    expect(tenantLivingBonus("villa", 100, 40_000)).toEqual({ cents: 15_000, xp: 4 });
    expect(tenantLivingBonus("villa", 100, 1_000)).toEqual({ cents: 1_000, xp: 4 });
    expect(tenantLivingBonus("flat", 0, 3_000)).toEqual({ cents: 400, xp: 0 });
  });

  it("one bonus per hour: the own home or the rented place, whichever brings more", () => {
    expect(livingBonus({ own: null, rented: null })).toBeNull();
    expect(livingBonus({ own: { tier: "flat", wohnwert: 100 }, rented: null })).toEqual({
      cents: 2_000,
      xp: 3,
      source: "own",
    });
    expect(
      livingBonus({
        own: { tier: "flat", wohnwert: 100 },
        rented: { tier: "villa", wohnwert: 100, rentCentsPerHour: 40_000 },
      }),
    ).toEqual({ cents: 15_000, xp: 4, source: "tenant" });
    expect(
      livingBonus({
        own: { tier: "flat", wohnwert: 100 },
        rented: { tier: "villa", wohnwert: 100, rentCentsPerHour: 100 },
      }),
    ).toEqual({ cents: 2_000, xp: 3, source: "own" });
    expect(livingBonus({ own: null, rented: { tier: "flat", wohnwert: 90, rentCentsPerHour: 2_760 } })?.source).toBe(
      "tenant",
    );
  });
});
