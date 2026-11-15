import { describe, expect, it } from "vitest";
import { ACCESSORIES, ACCESSORY_SETS, accessoryByKey } from "@/config/accessories";
import {
  DEFAULT_WARDROBE_FILTER,
  canBuyNow,
  filterAccessories,
  groupBySet,
  isFiltered,
  normalize,
  type WardrobeFilter,
} from "./filter";

const context = { owned: ["party_hat"], level: 3, cashCents: 300_000 };
const run = (patch: Partial<WardrobeFilter>, ctx = context) =>
  filterAccessories(ACCESSORIES, { ...DEFAULT_WARDROBE_FILTER, ...patch }, ctx);

describe("wardrobe filter (ADR-155)", () => {
  it("shows everything by default, slot by slot and cheapest first", () => {
    const all = run({});
    expect(all).toHaveLength(ACCESSORIES.length);
    expect(all[0]!.slot).toBe("head");
    expect(all.at(-1)!.slot).toBe("back");
    const heads = all.filter((a) => a.slot === "head").map((a) => a.priceCents);
    expect(heads).toEqual(heads.toSorted((a, b) => a - b));
    expect(isFiltered(DEFAULT_WARDROBE_FILTER)).toBe(false);
  });

  it("filters by slot, rarity and search words (case and umlauts ignored)", () => {
    expect(run({ slot: "pet" }).every((a) => a.slot === "pet")).toBe(true);
    expect(run({ rarity: "mythic" }).every((a) => a.rarity === "mythic")).toBe(true);
    expect(run({ query: "KURBIS" }).map((a) => a.key)).toEqual(["pumpkin_head"]);
    expect(run({ query: "klopapier" }).map((a) => a.key)).toContain("toilet_paper_crown");
    expect(run({ query: "hut", slot: "head" }).length).toBeGreaterThan(2);
    expect(run({ query: "gibt es nicht xyz" })).toEqual([]);
    expect(normalize("Größe Ärger")).toBe("grosse arger");
    expect(isFiltered({ ...DEFAULT_WARDROBE_FILTER, query: "hut" })).toBe(true);
  });

  it("sorts by price both ways and rarest first", () => {
    const asc = run({ sort: "priceAsc" }).map((a) => a.priceCents);
    expect(asc).toEqual(asc.toSorted((a, b) => a - b));
    const desc = run({ sort: "priceDesc" });
    expect(desc[0]!.rarity).toBe("mythic");
    expect(run({ sort: "rarity" }).at(-1)!.rarity).toBe("common");
  });

  it("only affordable: not owned, level reached, enough cash", () => {
    const buyable = run({ affordableOnly: true });
    expect(buyable.length).toBeGreaterThan(5);
    for (const a of buyable) expect(canBuyNow(a, context)).toBe(true);
    expect(buyable.map((a) => a.key)).not.toContain("party_hat");
    expect(canBuyNow(accessoryByKey("crown")!, { owned: [], level: 99, cashCents: 1 })).toBe(false);
    expect(canBuyNow(accessoryByKey("crown")!, { owned: [], level: 1, cashCents: 10 ** 12 })).toBe(false);
    expect(run({ affordableOnly: true }, { owned: [], level: 1, cashCents: 0 })).toEqual([]);
  });

  it("groups by themed set in catalogue order, loose pieces last", () => {
    const groups = groupBySet(run({}));
    expect(groups.map((g) => g.set)).toEqual([...ACCESSORY_SETS, null]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(ACCESSORIES.length);
    expect(groups.find((g) => g.set === "pirate")!.items.map((a) => a.key)).toContain("eye_patch");
    expect(groupBySet(run({ slot: "pet", rarity: "mythic" })).map((g) => g.set)).toEqual(["royal"]);
  });
});
