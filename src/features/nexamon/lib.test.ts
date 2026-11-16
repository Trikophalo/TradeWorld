import { describe, expect, it } from "vitest";
import {
  clampGrade,
  estimatePixelTextWidth,
  fitTextScale,
  formatCardNumber,
  formatSerial,
  GRADE_WORDS,
  gradeWordKey,
  hasFoil,
  isHit,
  pixelScale,
  rarityRank,
  SWIPE_DISTANCE,
  swipeOutcome,
  TEAR_DISTANCE,
  tearProgress,
} from "./lib";

describe("card numbers and serials", () => {
  it("pads the number and the set size to three digits", () => {
    expect(formatCardNumber(12)).toBe("012/077");
    expect(formatCardNumber(77)).toBe("077/077");
    expect(formatCardNumber(1, 231)).toBe("001/231");
    expect(formatCardNumber(-3)).toBe("000/077");
    expect(formatCardNumber(7.9)).toBe("007/077");
  });

  it("shows a serial with eight digits", () => {
    expect(formatSerial(7)).toBe("00000007");
    expect(formatSerial("481516")).toBe("00481516");
    expect(formatSerial("ASP-12-34")).toBe("00001234");
    expect(formatSerial(123456789012)).toBe("56789012");
  });
});

describe("grades", () => {
  it("has a word for every grade from 1 to 10", () => {
    expect(Object.keys(GRADE_WORDS)).toHaveLength(10);
    expect(gradeWordKey(10)).toBe("gemMint");
    expect(gradeWordKey(9)).toBe("mint");
    expect(gradeWordKey(7)).toBe("nearMint");
    expect(gradeWordKey(1)).toBe("poor");
  });

  it("holds any number between 1 and 10", () => {
    expect(clampGrade(0)).toBe(1);
    expect(clampGrade(11)).toBe(10);
    expect(clampGrade(8.6)).toBe(9);
    expect(clampGrade(Number.NaN)).toBe(1);
    expect(gradeWordKey(99)).toBe("gemMint");
  });
});

describe("rarities", () => {
  it("orders them and marks rare or better as a hit with foil", () => {
    expect(rarityRank("common")).toBeLessThan(rarityRank("rare"));
    expect(rarityRank("prisma")).toBeLessThan(rarityRank("legendary"));
    expect(isHit("common")).toBe(false);
    expect(["rare", "ultra", "prisma", "legendary"].every((r) => isHit(r as "rare"))).toBe(true);
    expect(hasFoil("common")).toBe(false);
  });
});

describe("text fitting", () => {
  it("estimates narrow and wide letters", () => {
    expect(estimatePixelTextWidth("", 6)).toBe(0);
    expect(estimatePixelTextWidth("II", 6)).toBeLessThan(estimatePixelTextWidth("AA", 6));
    expect(estimatePixelTextWidth("MM", 6)).toBeGreaterThan(estimatePixelTextWidth("AA", 6));
  });

  it("leaves short names alone, squeezes long ones and stops at the minimum", () => {
    expect(fitTextScale("Tropfel", 6, 35)).toBe(1);
    const long = fitTextScale("Voltaquila", 6, 35);
    expect(long).toBeLessThan(1);
    expect(estimatePixelTextWidth("Voltaquila", 6) * long).toBeCloseTo(35);
    expect(fitTextScale("Ein sehr langer Kartenname", 6, 35)).toBe(0.62);
    expect(fitTextScale("Ein sehr langer Kartenname", 6, 35, 0.5)).toBeGreaterThanOrEqual(0.5);
  });

  it("measures a tear along the seal", () => {
    expect(tearProgress(0, 200)).toBe(0);
    expect(tearProgress(-50, 200)).toBe(0);
    expect(tearProgress(70, 200)).toBeCloseTo(0.5);
    expect(tearProgress(200 * TEAR_DISTANCE, 200)).toBe(1);
    expect(tearProgress(500, 200)).toBe(1);
    expect(tearProgress(50, 0)).toBe(0);
  });

  it("keeps pixel scales whole", () => {
    expect(pixelScale(2.4)).toBe(2);
    expect(pixelScale(0)).toBe(1);
    expect(pixelScale(3)).toBe(3);
  });
});

describe("swipeOutcome", () => {
  const width = 216;

  it("lets a card fall back after a short, slow pull (peeking)", () => {
    expect(swipeOutcome({ dx: 60, dy: -10, vx: 40, vy: 0, width })).toEqual({ away: false, dirX: 0, dirY: 0 });
    expect(swipeOutcome({ dx: 0, dy: 0, vx: 0, vy: 0, width }).away).toBe(false);
  });

  it("throws a card that was dragged far enough, along the drag", () => {
    const out = swipeOutcome({ dx: width * SWIPE_DISTANCE + 1, dy: 0, vx: 0, vy: 0, width });
    expect(out).toEqual({ away: true, dirX: 1, dirY: 0 });
    const up = swipeOutcome({ dx: 0, dy: -200, vx: 0, vy: 0, width });
    expect(up.dirY).toBe(-1);
  });

  it("throws a card on a quick flick, along the flick", () => {
    const out = swipeOutcome({ dx: -20, dy: 4, vx: -900, vy: 0, width });
    expect(out).toEqual({ away: true, dirX: -1, dirY: 0 });
    // Speed without any travel is a tap, not a flick.
    expect(swipeOutcome({ dx: 2, dy: 0, vx: 2000, vy: 0, width }).away).toBe(false);
  });

  it("returns a unit direction", () => {
    const out = swipeOutcome({ dx: 150, dy: 150, vx: 0, vy: 0, width });
    expect(Math.hypot(out.dirX, out.dirY)).toBeCloseTo(1);
  });
});
