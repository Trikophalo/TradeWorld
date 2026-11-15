import { describe, expect, it } from "vitest";
import { catalogItemByKey } from "@/config/accessory-catalog";
import { ACCESSORIES } from "@/config/accessories";
import { BATTLE_ACCESSORIES } from "@/config/battle-accessories";
import { BATTLE_KINDS } from "@/config/battles";
import * as ART from "./battle-art";
import { BATTLE_ACCESSORY_ART } from "./battle-accessories";
import type { PixelArt } from "./pixel-icon";
import { FIGURE_HEIGHT, FIGURE_WIDTH, dressedFigure, orderWorn } from "./player-figure";

function wellFormed(name: string, art: PixelArt) {
  const width = art.grid[0]!.length;
  for (const row of art.grid) {
    expect(row.length, name).toBe(width);
    for (const ch of row) if (ch !== ".") expect(art.palette[ch], `${name}: ${ch}`).toBeDefined();
  }
}

describe("battle pixel art (ADR-160)", () => {
  it("every sprite and icon is a rectangle with a colour for each character", () => {
    for (const [name, value] of Object.entries(ART)) {
      if (Array.isArray(value)) value.forEach((a, i) => wellFormed(`${name}[${i}]`, a as PixelArt));
      else if (value && typeof value === "object" && "grid" in value) wellFormed(name, value as PixelArt);
    }
    for (const kind of BATTLE_KINDS) {
      wellFormed(kind, ART.BATTLE_ICONS[kind]);
      expect(ART.BATTLE_ICONS[kind].grid).toHaveLength(16);
    }
  });

  it("the exclusive accessories have art on the figure and never clash with the shop", () => {
    expect(BATTLE_ACCESSORIES.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(BATTLE_ACCESSORY_ART).sort()).toEqual(BATTLE_ACCESSORIES.map((a) => a.key).sort());
    for (const item of BATTLE_ACCESSORIES) {
      expect(ACCESSORIES.some((a) => a.key === item.key)).toBe(false);
      expect(item.exclusive).toBe(true);
      expect("priceCents" in item).toBe(false);
      const art = BATTLE_ACCESSORY_ART[item.key]!;
      wellFormed(item.key, { grid: art.grid, palette: art.palette });
      expect(art.x + art.grid[0]!.length).toBeLessThanOrEqual(FIGURE_WIDTH);
      expect(art.y + art.grid.length).toBeLessThanOrEqual(FIGURE_HEIGHT);
      expect(catalogItemByKey(item.key)?.slot).toBe(item.slot);
    }
  });

  it("a won accessory shows on the dressed figure", () => {
    expect(orderWorn(["battle_crown", "mini_bull"])).toEqual(["battle_crown", "mini_bull"]);
    expect(dressedFigure("rookie", ["battle_crown"]).grid).not.toEqual(dressedFigure("rookie", []).grid);
  });
});
