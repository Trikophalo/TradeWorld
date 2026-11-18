import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import type { ProgressionConfig } from "../../config/balance.ts";
import { activeDailyXp, daysBetweenLevels, levelPace } from "./level-pace.ts";
import { levelFromTotalXp, totalXpForLevel } from "./progression.ts";

/** The curve before ADR-202 (ADR-055 and ADR-142), to compare against. */
const BEFORE: ProgressionConfig = { ...BALANCE.progression, xpBase: 250, missionXpScalePerLevel: 0.15 };

describe("level pace (ADR-202)", () => {
  it("an active player levels about 1.3 to 1.4 times as fast as before, not more", () => {
    const before = levelPace(BEFORE);
    const after = levelPace();
    const speed = before.bands.map((band, i) => band.days / after.bands[i]!.days);
    for (const s of speed) {
      expect(s).toBeGreaterThan(1.25);
      expect(s).toBeLessThan(1.45);
    }
    const total = before.total / after.total;
    expect(total).toBeGreaterThan(1.3);
    expect(total).toBeLessThan(1.45);
  });

  it("stays a long game: level 30 after weeks, level 40 after a month", () => {
    expect(daysBetweenLevels(1, 10)).toBeGreaterThan(1.5);
    expect(daysBetweenLevels(1, 30)).toBeGreaterThan(14);
    expect(daysBetweenLevels(1, 40)).toBeGreaterThan(28);
  });

  it("collects more XP per day with the level (missions scale)", () => {
    expect(activeDailyXp(20)).toBeGreaterThan(activeDailyXp(10));
    expect(activeDailyXp(10)).toBeGreaterThan(activeDailyXp(1));
  });

  it("never costs anybody a level: every level needs at most the XP of the old curve", () => {
    for (let level = 1; level <= 500; level++) {
      expect(totalXpForLevel(level)).toBeLessThanOrEqual(totalXpForLevel(level, BEFORE));
    }
    for (const xp of [0, 99, 100, 5_000, 50_000, 500_000, 5_000_000]) {
      expect(levelFromTotalXp(xp)).toBeGreaterThanOrEqual(levelFromTotalXp(xp, BEFORE));
    }
  });
});
