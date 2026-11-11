import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { floodFill, isValidLogo, logoArt } from "./logo.ts";
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
