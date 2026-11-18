import { describe, expect, it } from "vitest";
import { COUNTRIES } from "@/config/countries";
import { countryFlagArt, countryFlagMini, FLAG_MINI_SIZE, FLAG_SIZE, FLAGS } from "./flags";
import { countryFlag, hqArt } from "./hq";

const key = (art: { grid: readonly string[]; palette: Readonly<Record<string, string>> }) =>
  art.grid.map((row) => [...row].map((c) => art.palette[c]!.toLowerCase()).join(",")).join("|");

describe("pixel flags of the game countries (ADR-208)", () => {
  it("every country key has its own flag, and only those", () => {
    expect(Object.keys(FLAGS).sort()).toEqual(COUNTRIES.map((c) => c.key).sort());
  });

  it("draws every flag on the same canvas with known colors", () => {
    for (const c of COUNTRIES) {
      for (const [art, size] of [
        [countryFlagArt(c.key)!, FLAG_SIZE],
        [countryFlagMini(c.key)!, FLAG_MINI_SIZE],
      ] as const) {
        expect(art.grid, c.key).toHaveLength(size.height);
        for (const row of art.grid) {
          expect(row, c.key).toHaveLength(size.width);
          for (const ch of row) expect(art.palette[ch], `${c.key}: ${ch}`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  it("no two countries share a flag, big or small", () => {
    const big = new Map<string, string>();
    const mini = new Map<string, string>();
    for (const c of COUNTRIES) {
      const b = key(countryFlagArt(c.key)!);
      const m = key(countryFlagMini(c.key)!);
      expect(big.get(b), `${c.key} looks like ${big.get(b)}`).toBeUndefined();
      expect(mini.get(m), `${c.key} (small) looks like ${mini.get(m)}`).toBeUndefined();
      big.set(b, c.key);
      mini.set(m, c.key);
    }
  });

  it("each flag matches its key: it uses the colors of its country", () => {
    for (const c of COUNTRIES) {
      const used = new Set(
        countryFlagArt(c.key)!
          .grid.join("")
          .split("")
          .map((ch) => FLAGS[c.key]!.palette[ch]!.toLowerCase()),
      );
      for (const color of c.flag) expect(used.has(color.toLowerCase()), `${c.key} uses ${color}`).toBe(true);
    }
    // the reported mix-up: China is red with yellow stars, Germany black-red-gold
    expect(countryFlagArt("cn")!.grid[0]).toBe("r".repeat(15));
    expect(FLAGS.cn!.palette.r).toBe("#de2910");
    expect(countryFlagArt("de")!.grid.map((r) => r[0])).toEqual(["k", "k", "k", "r", "r", "r", "y", "y", "y"]);
  });

  it("countryFlag falls back to stripes for an unknown key", () => {
    expect(countryFlag({ key: "xx", flag: ["#000000", "#ffffff"] }).grid[0]).toHaveLength(6);
    expect(countryFlag(COUNTRIES[0]!)).toEqual(countryFlagArt(COUNTRIES[0]!.key));
  });

  it("the headquarters flies the flag of its own country", () => {
    for (const c of COUNTRIES) {
      const art = hqArt({ tier: 1, flag: c.flag, country: c.key });
      const mini = countryFlagMini(c.key)!;
      const colors = new Set(Object.values(art.palette).map((v) => v.toLowerCase()));
      for (const v of Object.values(mini.palette)) expect(colors.has(v.toLowerCase()), c.key).toBe(true);
    }
    const cn = hqArt({ tier: 1, flag: ["#de2910", "#ffde00"], country: "cn" });
    const de = hqArt({ tier: 1, flag: ["#1a1a1a", "#dd0000", "#ffce00"], country: "de" });
    expect(cn.grid).not.toEqual(de.grid);
  });
});
