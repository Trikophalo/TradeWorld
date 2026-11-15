import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  aiStayHours,
  aiTenantChanceBps,
  demandLevel,
  fairRentCentsPerHour,
  hourlyPrice,
  noticeEndMs,
  rentLimits,
  tenantXp,
  wohnwert,
  wohnwertTips,
  type WohnwertPiece,
} from "./rentals.ts";

const piece = (
  category: string,
  tier: string,
  priceCents: number,
  w: number,
  h: number,
  layer: WohnwertPiece["layer"] = "object",
): WohnwertPiece => ({ category, tier, priceCents, w, h, layer });

/** The flat of the SQL test (supabase/tests/9q_rentals.sql): nine standard pieces on three layers. */
const FLAT: WohnwertPiece[] = [
  piece("seating", "standard", 240_000, 3, 1), // sofa_leather
  piece("beds", "standard", 150_000, 3, 3), // bed_double
  piece("tables", "standard", 140_000, 2, 2), // table_oak
  piece("kitchen", "standard", 70_000, 1, 1), // kitchen_fridge
  piece("bath", "standard", 110_000, 1, 1), // shower
  piece("plants", "standard", 16_000, 1, 1), // plant_monstera
  piece("rugs", "standard", 65_000, 3, 2, "floor"), // rug_wool
  piece("decor", "standard", 9_000, 1, 1, "top"), // lamp_table
  piece("plants", "standard", 6_000, 1, 1, "top"), // vase_flowers
];

describe("Wohnwert (ADR-158)", () => {
  it("an empty home is worth nothing, a good floor a little", () => {
    expect(wohnwert("flat", "laminate", []).total).toBe(0);
    expect(wohnwert("flat", "parquet", []).total).toBe(6);
  });

  it("the furnished flat of the SQL test reaches 90, with parquet 96", () => {
    const w = wohnwert("flat", "laminate", FLAT);
    expect(w.parts).toEqual({ value: 30, variety: 20, fill: 20, layers: 10, style: 10, floor: 0 });
    expect(w.total).toBe(90);
    expect(w.valueCents).toBe(806_000);
    expect(w.targetCents).toBe(500_000);
    expect(w.categories).toBe(8);
    expect(w.coverageBps).toBe(3958);
    expect(wohnwert("flat", "parquet", FLAT).total).toBe(96);
    expect(wohnwert("flat", "gold", FLAT).total).toBe(100);
  });

  it("a single mattress gives a few points; the same pieces count less in a bigger home", () => {
    const one = wohnwert("flat", "laminate", [piece("beds", "budget", 15_000, 2, 2)]);
    expect(one.parts).toEqual({ value: 0, variety: 2, fill: 5, layers: 0, style: 1, floor: 0 });
    expect(one.total).toBe(8);
    expect(wohnwert("villa", "laminate", FLAT).total).toBeLessThan(wohnwert("flat", "laminate", FLAT).total);
  });

  it("a crammed floor loses the fill points, mixed styles lose style points", () => {
    const crammed = Array.from({ length: 42 }, () => piece("seating", "budget", 1_000, 1, 1));
    const w = wohnwert("flat", "laminate", crammed);
    expect(w.coverageBps).toBe(8750);
    expect(w.parts.fill).toBe(0);
    const between = Array.from({ length: 34 }, () => piece("seating", "budget", 1_000, 1, 1));
    // 34 / 48 = 7083 bps: between idealMax 5500 and zeroAt 8500
    expect(wohnwert("flat", "laminate", between).parts.fill).toBe(Math.floor((20 * (8500 - 7083)) / 3000));
    const mixed = [
      piece("seating", "budget", 1, 1, 1),
      piece("seating", "standard", 1, 1, 1),
      piece("seating", "premium", 1, 1, 1),
      piece("seating", "luxury", 1, 1, 1),
      piece("seating", "ultra", 1, 1, 1),
      piece("seating", "ultra", 1, 1, 1),
    ];
    expect(wohnwert("flat", "laminate", mixed).parts.style).toBe(3);
  });

  it("tips name what is missing most", () => {
    const one = wohnwert("flat", "laminate", [piece("beds", "budget", 15_000, 2, 2)]);
    expect(wohnwertTips(one).map((t) => t.tip)).toEqual(["value", "variety", "fillLow"]);
    expect(wohnwertTips(wohnwert("flat", "laminate", FLAT))).toEqual([{ tip: "floor", points: 10 }]);
    const crammed = Array.from({ length: 42 }, () => piece("seating", "budget", 1_000, 1, 1));
    expect(wohnwertTips(wohnwert("flat", "laminate", crammed), 10).some((t) => t.tip === "fillHigh")).toBe(true);
  });
});

describe("rent (ADR-158)", () => {
  it("the fair rent grows from 20 % to 100 % of the reference rent", () => {
    expect(fairRentCentsPerHour("flat", 0)).toBe(600);
    expect(fairRentCentsPerHour("flat", 50)).toBe(1_800);
    expect(fairRentCentsPerHour("flat", 90)).toBe(2_760);
    expect(fairRentCentsPerHour("flat", 100)).toBe(3_000);
    expect(fairRentCentsPerHour("luxury_villa", 100)).toBe(100_000);
  });

  it("the owner's price lies between 5 % of the reference and 150 % of the fair rent; a day costs 24 hours", () => {
    expect(rentLimits("flat", 90, "hour")).toEqual({ minCents: 150, maxCents: 4_140, fairCents: 2_760 });
    expect(rentLimits("flat", 90, "day")).toEqual({ minCents: 3_600, maxCents: 99_360, fairCents: 66_240 });
    expect(hourlyPrice(99_360, "day")).toBe(4_140);
    expect(hourlyPrice(1_000, "hour")).toBe(1_000);
  });

  it("AI tenants: none below the minimum Wohnwert, more for a nicer home and a lower price", () => {
    expect(aiTenantChanceBps("flat", 24, 100)).toBe(0);
    expect(aiTenantChanceBps("flat", 50, 1_800)).toBe(3_000);
    expect(aiTenantChanceBps("flat", 100, 3_000)).toBe(6_000);
    expect(aiTenantChanceBps("flat", 100, 4_500)).toBe(3_000);
    expect(aiTenantChanceBps("flat", 90, 150)).toBe(10_000);
    expect(aiTenantChanceBps("flat", 90, 2_760)).toBeLessThan(aiTenantChanceBps("flat", 90, 1_000));
    expect(demandLevel(0)).toBe("none");
    expect(demandLevel(10_000)).toBe("high");
  });

  it("AI tenants stay one to five days, in whole periods", () => {
    expect(aiStayHours(0, "hour")).toBe(24);
    expect(aiStayHours(0.999999, "hour")).toBe(120);
    expect(aiStayHours(0.5, "day") % 24).toBe(0);
    for (let r = 0; r < 1; r += 0.01) {
      const h = aiStayHours(r, "hour");
      expect(h).toBeGreaterThanOrEqual(BALANCE.rentals.ai.stayMinHours);
      expect(h).toBeLessThanOrEqual(BALANCE.rentals.ai.stayMaxHours);
    }
  });

  it("notice ends a tenancy at a period end after the minimum duration and the notice period", () => {
    const H = 3_600_000;
    expect(noticeEndMs(0, 0, "hour")).toBe(24 * H);
    expect(noticeEndMs(0, 20 * H, "hour")).toBe(32 * H);
    expect(noticeEndMs(0, 20.5 * H, "hour")).toBe(33 * H);
    expect(noticeEndMs(0, 20 * H, "day")).toBe(48 * H);
  });

  it("tenants get XP per paid hour by Wohnwert", () => {
    expect(tenantXp(100, 1)).toBe(5);
    expect(tenantXp(50, 1)).toBe(2);
    expect(tenantXp(90, 24)).toBe(108);
  });
});
