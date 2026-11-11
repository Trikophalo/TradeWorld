import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  dailyLoginXp,
  isUnlocked,
  levelFromTotalXp,
  levelProgress,
  nextUnlocks,
  profitableCloseXp,
  scaledXp,
  totalXpForLevel,
  unlockLevel,
  unlocksAtLevel,
  unlocksUpToLevel,
  xpForNextLevel,
} from "./progression.ts";

describe("xp curve", () => {
  it("keeps level 2 at the tutorial reward and is 2.5 × the spec curve after (ADR-055)", () => {
    expect(xpForNextLevel(1)).toBe(100);
    expect(xpForNextLevel(2)).toBe(707);
    expect(xpForNextLevel(10)).toBe(7906); // spec: ca. 3160 × 2.5
    expect(xpForNextLevel(20)).toBe(22_361);
    expect(xpForNextLevel(50)).toBe(88_388);
  });

  it("is strictly increasing", () => {
    for (let n = 1; n < 50; n++) expect(xpForNextLevel(n + 1)).toBeGreaterThan(xpForNextLevel(n));
  });

  it("rejects invalid levels", () => {
    expect(() => xpForNextLevel(0)).toThrow(RangeError);
    expect(() => xpForNextLevel(1.5)).toThrow(RangeError);
  });

  it("accumulates total xp", () => {
    expect(totalXpForLevel(1)).toBe(0);
    expect(totalXpForLevel(2)).toBe(100);
    expect(totalXpForLevel(3)).toBe(100 + 707);
    expect(totalXpForLevel(10)).toBe(27_612);
  });

  it("levelFromTotalXp is the inverse of totalXpForLevel", () => {
    for (let level = 1; level <= 50; level++) {
      const total = totalXpForLevel(level);
      expect(levelFromTotalXp(total)).toBe(level);
      if (level > 1) expect(levelFromTotalXp(total - 1)).toBe(level - 1);
    }
  });

  it("has no practical level cap and tolerates bad input", () => {
    // Endless levels (ADR-039): 1e9 XP is far beyond level 50.
    expect(levelFromTotalXp(1e9)).toBeGreaterThan(500);
    expect(levelFromTotalXp(totalXpForLevel(120))).toBe(120);
    expect(levelFromTotalXp(-5)).toBe(1);
    expect(levelFromTotalXp(99.9)).toBe(1);
  });

  it("reports progress inside a level", () => {
    const p = levelProgress(150);
    expect(p).toMatchObject({ level: 2, xpIntoLevel: 50, xpForNext: 707, isMaxLevel: false });
    expect(p.progress).toBeCloseTo(50 / 707);
    expect(levelProgress(totalXpForLevel(77) + 10)).toMatchObject({ level: 77, xpIntoLevel: 10, isMaxLevel: false });
  });
});

describe("unlocks", () => {
  it("covers every row of spec 9.3", () => {
    const levels = [...new Set(BALANCE.progression.unlocks.map((u) => u.level))];
    expect(levels).toEqual([1, 2, 3, 5, 7, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 50]);
  });

  it("uses unique snake_case keys", () => {
    const keys = BALANCE.progression.unlocks.map((u) => u.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("returns the unlocks of a level", () => {
    expect(unlocksAtLevel(1).map((u) => u.key)).toEqual(["market_orders", "basic_income"]);
    expect(unlocksAtLevel(3).map((u) => u.key)).toEqual(["limit_orders", "watchlist"]);
    expect(unlocksAtLevel(4)).toEqual([]);
    expect(unlocksUpToLevel(3)).toHaveLength(5);
  });

  it("answers feature gates", () => {
    expect(isUnlocked("short_selling", 7)).toBe(false);
    expect(isUnlocked("short_selling", 8)).toBe(true);
    expect(isUnlocked("unknown", 50)).toBe(false);
    expect(unlockLevel("found_small_business")).toBe(10);
    expect(unlockLevel("leverage_2x")).toBe(12);
    expect(unlockLevel("nope")).toBeNull();
  });

  it("finds the next unlocks", () => {
    expect(nextUnlocks(3).map((u) => u.key)).toEqual(["stop_loss", "bonds", "junior_jobs"]);
    expect(nextUnlocks(50)).toEqual([]);
  });

  it("is consistent with the leverage tiers and job tiers", () => {
    expect(unlockLevel("leverage_2x")).toBe(BALANCE.trading.leverageTiers[1]?.level);
    expect(unlockLevel("leverage_5x")).toBe(BALANCE.trading.leverageTiers[2]?.level);
    expect(unlockLevel("leverage_10x")).toBe(BALANCE.trading.leverageTiers[3]?.level);
    expect(unlockLevel("short_selling")).toBe(BALANCE.trading.shortSellingMinLevel);
    expect(unlockLevel("first_job")).toBe(BALANCE.careers.tiers[0]?.minLevel);
    expect(unlockLevel("bonds")).toBe(BALANCE.bonds.minLevel);
  });
});

describe("xp sources", () => {
  it("grants 1 xp per 100 EUR profit, capped at 500", () => {
    expect(profitableCloseXp(BigInt(-1))).toBe(0);
    expect(profitableCloseXp(BigInt(9_999))).toBe(0);
    expect(profitableCloseXp(BigInt(123_456))).toBe(12);
    expect(profitableCloseXp(BigInt(100_000_000))).toBe(500);
  });

  it("adds a capped streak bonus to the login xp", () => {
    expect(dailyLoginXp(1)).toBe(50);
    expect(dailyLoginXp(4)).toBe(80);
    expect(dailyLoginXp(1000)).toBe(250);
  });

  it("applies the alpha multiplier exactly once, when XP are granted", () => {
    expect(BALANCE.progression.xpMultiplier).toBe(2);
    expect(scaledXp(40)).toBe(80);
    expect(scaledXp(500)).toBe(1000);
    expect(scaledXp(-5)).toBe(0);
    expect(scaledXp(33, { ...BALANCE.progression, xpMultiplier: 1.5 })).toBe(50);
    // Base values and the level curve are not scaled.
    expect(dailyLoginXp(1)).toBe(50);
    expect(xpForNextLevel(1)).toBe(100);
  });
});
