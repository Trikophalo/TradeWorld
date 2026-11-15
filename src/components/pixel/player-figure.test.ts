import { describe, expect, it } from "vitest";
import { ACCESSORIES, ACCESSORY_RARITIES, ACCESSORY_SETS, ACCESSORY_SLOTS, accessoryByKey } from "@/config/accessories";
import { BALANCE } from "@/config/balance";
import { ACCESSORY_ART } from "./accessories";
import { AVATAR_ART } from "./avatars";
import { FIGURE_HEIGHT, FIGURE_WIDTH, dressedFigure, figureColors, orderWorn, playerFigure } from "./player-figure";

const COLOR = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0\.\d+)\)|\$[sdheoc])$/;
const at = (art: { grid: readonly string[]; palette: Readonly<Record<string, string>> }, x: number, y: number) =>
  art.palette[art.grid[y]![x]!] ?? null;

describe("accessory catalogue (ADR-155)", () => {
  it("has well over 100 accessories with unique keys, every slot and rarity", () => {
    expect(ACCESSORIES.length).toBeGreaterThanOrEqual(120);
    expect(new Set(ACCESSORIES.map((a) => a.key)).size).toBe(ACCESSORIES.length);
    for (const slot of ACCESSORY_SLOTS)
      expect(
        ACCESSORIES.some((a) => a.slot === slot),
        slot,
      ).toBe(true);
    for (const rarity of ACCESSORY_RARITIES)
      expect(
        ACCESSORIES.some((a) => a.rarity === rarity),
        rarity,
      ).toBe(true);
    expect(BALANCE.accessories.items).toBe(ACCESSORIES);
  });

  it("keys are snake_case, prices whole cents, levels from 1, texts present", () => {
    for (const a of ACCESSORIES) {
      expect(a.key).toMatch(/^[a-z][a-z0-9_]{2,31}$/);
      expect(Number.isSafeInteger(a.priceCents) && a.priceCents > 0, a.key).toBe(true);
      expect(a.minLevel).toBeGreaterThanOrEqual(1);
      expect(a.name.length).toBeGreaterThan(2);
      expect(a.description.length).toBeGreaterThan(10);
    }
  });

  it("a rarer tier always costs more than every item of the tier below", () => {
    const range = (r: string) => ACCESSORIES.filter((a) => a.rarity === r).map((a) => a.priceCents);
    for (let i = 1; i < ACCESSORY_RARITIES.length; i++) {
      expect(Math.min(...range(ACCESSORY_RARITIES[i]!))).toBeGreaterThan(
        Math.max(...range(ACCESSORY_RARITIES[i - 1]!)),
      );
    }
    // common ones are affordable from the starting capital (several of them), legendary ones cost millions,
    // the mythic showpieces hundreds of millions
    expect(Math.max(...range("common"))).toBeLessThan(BALANCE.economy.startingCapitalCents / 3);
    expect(Math.min(...range("common"))).toBeLessThan(BALANCE.economy.startingCapitalCents / 10);
    expect(Math.min(...range("legendary"))).toBeGreaterThanOrEqual(500_000_000);
    expect(Math.min(...range("mythic"))).toBeGreaterThanOrEqual(10_000_000_000);
    for (const a of ACCESSORIES) expect(Number.isSafeInteger(a.priceCents), a.key).toBe(true);
  });

  it("every slot has something for new players and a rare-or-better piece", () => {
    for (const slot of ACCESSORY_SLOTS) {
      const inSlot = ACCESSORIES.filter((a) => a.slot === slot);
      expect(
        inSlot.some((a) => a.rarity === "common" && a.minLevel === 1),
        slot,
      ).toBe(true);
      expect(inSlot.length, slot).toBeGreaterThanOrEqual(12);
    }
  });

  it("themed sets are known and have at least four pieces", () => {
    for (const a of ACCESSORIES) if (a.set) expect(ACCESSORY_SETS, a.key).toContain(a.set);
    for (const set of ACCESSORY_SETS)
      expect(ACCESSORIES.filter((a) => a.set === set).length, set).toBeGreaterThanOrEqual(4);
  });
});

describe("accessory art", () => {
  it("every accessory has art and every art belongs to an accessory", () => {
    expect(Object.keys(ACCESSORY_ART).sort()).toEqual(ACCESSORIES.map((a) => a.key).sort());
  });

  it("every sprite is rectangular, fits the figure canvas and only uses palette colours", () => {
    for (const [key, art] of Object.entries(ACCESSORY_ART)) {
      const width = art.grid[0]!.length;
      expect(
        art.grid.every((row) => row.length === width),
        key,
      ).toBe(true);
      expect(art.x >= 0 && art.y >= 0, key).toBe(true);
      expect(art.x + width, key).toBeLessThanOrEqual(FIGURE_WIDTH);
      expect(art.y + art.grid.length, key).toBeLessThanOrEqual(FIGURE_HEIGHT);
      const used = new Set(art.grid.join("").replace(/\./g, ""));
      for (const ch of used) expect(art.palette[ch], `${key}: ${ch}`).toBeDefined();
      for (const [ch, color] of Object.entries(art.palette)) {
        expect(color, `${key}: ${ch}`).toMatch(COLOR);
        expect(used.has(ch), `${key}: unused colour ${ch}`).toBe(true);
      }
      expect(used.size, key).toBeLessThanOrEqual(10);
    }
  });
});

describe("player figure", () => {
  it("is 24×32 for every portrait and takes the portrait's colours", () => {
    for (const key of Object.keys(AVATAR_ART)) {
      const art = playerFigure(key);
      expect(art.grid).toHaveLength(FIGURE_HEIGHT);
      expect(art.grid.every((row) => row.length === FIGURE_WIDTH)).toBe(true);
      for (const ch of new Set(art.grid.join("").replace(/\./g, ""))) expect(art.palette[ch]).toBeDefined();
      // skin on the cheek, outfit on the chest
      expect(at(art, 9, 11)).toBe(figureColors(key).s);
      expect(at(art, 8, 20)).toBe(figureColors(key).o);
    }
    expect(playerFigure("unknown")).toEqual(playerFigure("rookie"));
  });

  it("dresses every accessory alone and all slots together without breaking the canvas", () => {
    for (const a of ACCESSORIES) {
      const art = dressedFigure("rookie", [a.key]);
      expect(art.grid).toHaveLength(FIGURE_HEIGHT);
      expect(art.grid.every((row) => row.length === FIGURE_WIDTH)).toBe(true);
      expect(art).not.toEqual(playerFigure("rookie"));
    }
    const full = ["angel_wings", "tuxedo", "monocle", "top_hat", "money_bag", "parrot"];
    const art = dressedFigure("trader", full);
    expect(Object.keys(art.palette).length).toBeLessThanOrEqual(62);
  });

  it("layers back to front: wings behind the body, the held thing under the gripping hand, the pet on top", () => {
    const plain = playerFigure("rookie");
    const winged = dressedFigure("rookie", ["angel_wings"]);
    expect(at(winged, 8, 20)).toBe(at(plain, 8, 20));
    expect(at(winged, 1, 14)).not.toBeNull();
    const held = dressedFigure("rookie", ["laser_sword"]);
    expect(at(held, 18, 23)).toBe(figureColors("rookie").s);
    expect(at(held, 18, 10)).not.toBeNull();
    // the pet is drawn after the hat and the face
    const both = dressedFigure("rookie", ["parrot", "laser_eyes"]);
    expect(Object.values(ACCESSORY_ART.parrot!.palette)).toContain(at(both, 3, 12));
    expect(at(dressedFigure("rookie", ["laser_eyes"]), 3, 12)).toBe(ACCESSORY_ART.laser_eyes!.palette.r);
  });

  it("wears one accessory per slot in a fixed order; unknown keys are ignored", () => {
    expect(orderWorn(["parrot", "cowboy_hat", "crown", "nope", "jetpack", "tuxedo"])).toEqual([
      "jetpack",
      "tuxedo",
      "cowboy_hat",
      "parrot",
    ]);
    expect(dressedFigure("rookie", ["cowboy_hat", "crown"])).toEqual(dressedFigure("rookie", ["cowboy_hat"]));
    expect(dressedFigure("rookie", ["nope"])).toEqual(playerFigure("rookie"));
    for (const key of orderWorn(ACCESSORIES.map((a) => a.key))) expect(accessoryByKey(key)).toBeDefined();
  });

  it("accessories with the wearer's colours take them", () => {
    const robe = dressedFigure("lawyer", ["bathrobe"]);
    expect(at(robe, 11, 17)).toBe(figureColors("lawyer").s);
  });
});
