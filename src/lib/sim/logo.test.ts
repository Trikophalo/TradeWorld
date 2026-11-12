import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { floodFill, hasForbiddenSymbol, isValidBanner, isValidLogo, logoArt } from "./logo.ts";
import {
  aiTakeShare,
  capitalIncreasePriceCents,
  founderFactor,
  issuePriceCents,
  maxEmployees,
  needsFullTimeFounder,
} from "./startup.ts";

const row = (s: string) => s.padEnd(16, ".");
const logo = { palette: ["#ff0000", "#00ff00"], grid: [row("0000"), row("1111"), ...Array(14).fill(row(""))] };

describe("company logo (ADR-065)", () => {
  it("accepts a 16×16 grid with palette indices only", () => {
    expect(isValidLogo(logo)).toBe(true);
    expect(isValidLogo({ ...logo, grid: logo.grid.slice(1) })).toBe(false);
    expect(isValidLogo({ ...logo, grid: [row("2222"), ...logo.grid.slice(1)] })).toBe(false);
    expect(isValidLogo({ ...logo, palette: ["red"] })).toBe(false);
    expect(isValidLogo({ ...logo, palette: Array(7).fill("#000000") })).toBe(false);
    expect(isValidLogo({ ...logo, grid: Array(16).fill(row("")) })).toBe(false);
  });

  it("turns into pixel art and fills areas", () => {
    expect(logoArt(logo).palette).toEqual({ 0: "#ff0000", 1: "#00ff00" });
    const filled = floodFill(Array(16).fill(row("")), 0, 0, "1");
    expect(filled.every((r) => r === "1".repeat(16))).toBe(true);
    expect(floodFill(logo.grid, 0, 0, "1")[0]).toBe(row("1111"));
  });
});

describe("founder with a job and company growth (ADR-066, ADR-067)", () => {
  it("halves the founder's productivity while working elsewhere, full time from 5 employees", () => {
    expect(founderFactor(true)).toBe(0.5);
    expect(founderFactor(false)).toBe(1);
    expect(needsFullTimeFounder(4)).toBe(false);
    expect(needsFullTimeFounder(5)).toBe(true);
  });

  it("grows from 2 to 100 employees", () => {
    expect([maxEmployees("garage"), maxEmployees("small_business"), maxEmployees("gmbh"), maxEmployees("ag")]).toEqual([
      2, 5, 20, 100,
    ]);
  });

  it("prices shares from the company value", () => {
    expect(issuePriceCents(BigInt(200_000_000))).toBe(200);
    expect(issuePriceCents(BigInt(0))).toBe(BALANCE.startups.ipo.minIssuePriceCents);
    expect(issuePriceCents(BigInt(500_000_000))).toBe(500);
    expect(capitalIncreasePriceCents(1_000)).toBe(900);
    expect(aiTakeShare(0)).toBeCloseTo(0.2);
    expect(aiTakeShare(1)).toBeCloseTo(0.7);
  });
});

describe("forbidden symbols (ADR-076)", () => {
  const blank = () => Array.from({ length: 16 }, () => ".".repeat(16).split(""));
  const draw = (pattern: readonly string[], scale: number, ox: number, oy: number, char = "0", base = blank()) => {
    pattern.forEach((row, y) =>
      row.split("").forEach((c, x) => {
        if (c !== "x") return;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) base[oy + y * scale + dy]![ox + x * scale + dx] = char;
      }),
    );
    return base.map((r) => r.join(""));
  };
  const cross = ["x.xxx", "x.x..", "xxxxx", "..x.x", "xxx.x"];
  const logo = (grid: string[], palette = ["#111318", "#ffffff"]) => ({ palette, grid });

  it("finds the symbol at any size, place and mirror image", () => {
    expect(hasForbiddenSymbol(logo(draw(cross, 1, 3, 4)))).toBe(true);
    expect(hasForbiddenSymbol(logo(draw(cross, 3, 0, 0)))).toBe(true);
    expect(
      hasForbiddenSymbol(
        logo(
          draw(
            cross.map((r) => r.split("").reverse().join("")),
            2,
            5,
            2,
          ),
        ),
      ),
    ).toBe(true);
  });

  it("finds it on a filled background and with one extra pixel", () => {
    const background = Array.from({ length: 16 }, () => "1".repeat(16).split(""));
    expect(hasForbiddenSymbol(logo(draw(cross, 2, 2, 2, "0", background)))).toBe(true);
    const grid = draw(cross, 1, 0, 0).map((r) => r.split(""));
    grid[1]![1] = "0";
    expect(hasForbiddenSymbol(logo(grid.map((r) => r.join(""))))).toBe(true);
  });

  it("lets ordinary logos through", () => {
    const plus = ["..x..", "..x..", "xxxxx", "..x..", "..x.."];
    const square = Array.from({ length: 16 }, (_, y) =>
      y < 2 || y > 13 ? "0".repeat(16) : "00" + ".".repeat(12) + "00",
    );
    expect(hasForbiddenSymbol(logo(draw(plus, 3, 0, 0)))).toBe(false);
    expect(hasForbiddenSymbol(logo(square))).toBe(false);
    expect(hasForbiddenSymbol(logo(Array.from({ length: 16 }, () => "0".repeat(16))))).toBe(false);
    const letters = draw(["xxx.x.x", "x...x.x", "xx...x.", "x...x.x", "xxx.x.x"], 2, 1, 3);
    expect(hasForbiddenSymbol(logo(letters))).toBe(false);
  });
});

describe("banner (ADR-078)", () => {
  const row = (c: string) => c.repeat(BALANCE.startups.banner.width);
  const banner = (grid: string[]) => ({ palette: ["#111318", "#ffd15c"], grid });
  it("is width × height with palette indices", () => {
    expect(isValidBanner(banner(Array.from({ length: BALANCE.startups.banner.height }, () => row("0"))))).toBe(true);
    expect(isValidBanner(banner(Array.from({ length: 16 }, () => row("0"))))).toBe(false);
    expect(isValidBanner(banner(Array.from({ length: BALANCE.startups.banner.height }, () => row("7"))))).toBe(false);
  });
  it("is checked for forbidden symbols too", () => {
    const grid = Array.from({ length: BALANCE.startups.banner.height }, () => row(".").split(""));
    ["x.xxx", "x.x..", "xxxxx", "..x.x", "xxx.x"].forEach((r, y) =>
      r.split("").forEach((c, x) => {
        if (c === "x") grid[y + 3]![x + 30] = "0";
      }),
    );
    expect(hasForbiddenSymbol(banner(grid.map((r) => r.join(""))))).toBe(true);
    expect(hasForbiddenSymbol(banner(Array.from({ length: 12 }, () => row("1"))))).toBe(false);
  });
});
