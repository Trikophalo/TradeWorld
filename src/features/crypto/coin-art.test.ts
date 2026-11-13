import { describe, expect, it } from "vitest";
import { coinArt, shade } from "./coin-art";

describe("coin art", () => {
  it("shades towards black and white", () => {
    expect(shade("#808080", -1)).toBe("#000000");
    expect(shade("#808080", 1)).toBe("#ffffff");
    expect(shade("#808080", 0)).toBe("#808080");
    expect(shade("oops", 0.5)).toBe("oops");
  });

  it("draws a square 16×16 coin with a category mark", () => {
    for (const category of ["stable", "major", "alt", "meme", "player"] as const) {
      const art = coinArt("#4f8cff", category);
      expect(art.grid).toHaveLength(16);
      for (const row of art.grid) expect(row).toHaveLength(16);
      expect(art.grid.join("")).toContain("g");
      for (const ch of new Set(art.grid.join("").replace(/\./g, ""))) expect(art.palette[ch]).toBeDefined();
    }
  });
});
