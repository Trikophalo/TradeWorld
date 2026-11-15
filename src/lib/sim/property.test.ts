import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  furnishedValueCents,
  furniturePriceCents,
  invalidPlacements,
  nextTier,
  propertyValueCents,
  resaleCents,
  rotated,
  upgradeCostCents,
} from "./property.ts";

const sizes: Record<string, { w: number; h: number; layer: "floor" | "object" | "top"; surface?: boolean }> = {
  sofa: { w: 3, h: 1, layer: "object" },
  chair: { w: 1, h: 1, layer: "object" },
  rug: { w: 3, h: 2, layer: "floor" },
  table: { w: 2, h: 1, layer: "object", surface: true },
  lamp: { w: 1, h: 1, layer: "top" },
};
const footprint = (id: string) => sizes[id.split("#")[0]!];

describe("property (ADR-082)", () => {
  it("climbs the ladder from flat to luxury villa, each more expensive", () => {
    expect(nextTier(null)).toBe("flat");
    expect(nextTier("villa")).toBe("luxury_villa");
    expect(nextTier("luxury_villa")).toBeNull();
    const prices = BALANCE.property.tiers.map((t) => t.priceCents);
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThan(prices[i - 1]!);
  });

  it("an upgrade costs the new price minus half the old one", () => {
    expect(upgradeCostCents(null, "flat")).toBe(2_500_000);
    expect(upgradeCostCents("flat", "apartment")).toBe(10_000_000 - 1_250_000);
  });

  it("selling brings 40 % back", () => {
    expect(resaleCents(100_000)).toBe(40_000);
    expect(propertyValueCents("flat", [100_000])).toBe(1_250_000 + 40_000);
  });

  it("furniture costs more in bigger homes (ADR-161)", () => {
    expect(furniturePriceCents(100_000, null)).toBe(100_000);
    expect(furniturePriceCents(100_000, "flat")).toBe(100_000);
    expect(furniturePriceCents(100_000, "apartment")).toBe(125_000);
    expect(furniturePriceCents(100_000, "house")).toBe(150_000);
    expect(furniturePriceCents(100_000, "villa")).toBe(200_000);
    expect(furniturePriceCents(100_000, "luxury_villa")).toBe(300_000);
    expect(furniturePriceCents(1_999, "apartment")).toBe(2_498);
  });

  it("placed furniture is part of the home: 60 % of the price paid instead of 40 % (ADR-161)", () => {
    expect(furnishedValueCents(100_000)).toBe(60_000);
    expect(propertyValueCents("flat", [100_000], undefined, [200_000])).toBe(1_250_000 + 40_000 + 120_000);
    expect(propertyValueCents(null, [], undefined, [])).toBe(0);
  });

  it("rotation swaps width and height", () => {
    expect(rotated({ w: 3, h: 1, layer: "object" }, 90)).toEqual({ w: 1, h: 3 });
  });

  it("pieces must lie on the floor and must not overlap within a layer; rugs lie under furniture", () => {
    expect(
      invalidPlacements(
        [
          { id: "rug#1", x: 0, y: 0, rot: 0 },
          { id: "sofa#1", x: 0, y: 0, rot: 0 },
          { id: "chair#1", x: 3, y: 0, rot: 0 },
        ],
        footprint,
        8,
        6,
      ),
    ).toEqual([]);
    expect(
      invalidPlacements(
        [
          { id: "sofa#1", x: 0, y: 0, rot: 0 },
          { id: "chair#1", x: 2, y: 0, rot: 0 },
        ],
        footprint,
        8,
        6,
      ).sort(),
    ).toEqual(["chair#1", "sofa#1"]);
    expect(invalidPlacements([{ id: "sofa#1", x: 6, y: 0, rot: 0 }], footprint, 8, 6)).toEqual(["sofa#1"]);
    expect(invalidPlacements([{ id: "sofa#1", x: 7, y: 3, rot: 90 }], footprint, 8, 6)).toEqual([]);
  });

  it("small things stand on tables and counters only, one per tile (ADR-100)", () => {
    const on = [
      { id: "table#1", x: 2, y: 2, rot: 0 as const },
      { id: "lamp#1", x: 2, y: 2, rot: 0 as const },
      { id: "lamp#2", x: 3, y: 2, rot: 0 as const },
    ];
    expect(invalidPlacements(on, footprint, 8, 6)).toEqual([]);
    // On the floor or on a sofa: not allowed.
    expect(invalidPlacements([{ id: "lamp#1", x: 0, y: 0, rot: 0 }], footprint, 8, 6)).toEqual(["lamp#1"]);
    expect(
      invalidPlacements(
        [
          { id: "sofa#1", x: 0, y: 0, rot: 0 },
          { id: "lamp#1", x: 1, y: 0, rot: 0 },
        ],
        footprint,
        8,
        6,
      ),
    ).toEqual(["lamp#1"]);
    // Two things on the same tile of a table clash.
    expect(
      invalidPlacements(
        [
          { id: "table#1", x: 2, y: 2, rot: 0 },
          { id: "lamp#1", x: 2, y: 2, rot: 0 },
          { id: "lamp#2", x: 2, y: 2, rot: 0 },
        ],
        footprint,
        8,
        6,
      ).sort(),
    ).toEqual(["lamp#1", "lamp#2"]);
  });
});
