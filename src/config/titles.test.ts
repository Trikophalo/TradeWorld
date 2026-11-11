import { describe, expect, it } from "vitest";
import { romanTier, titleForLevel } from "./titles";

describe("titles", () => {
  it("follows the level", () => {
    expect(titleForLevel(1).key).toBe("rookie");
    expect(titleForLevel(12).key).toBe("founder");
    expect(titleForLevel(49)).toEqual({ key: "tycoon", tier: 1 });
  });
  it("adds prestige tiers after level 50, endlessly", () => {
    expect(titleForLevel(50)).toEqual({ key: "legend", tier: 1 });
    expect(titleForLevel(60)).toEqual({ key: "legend", tier: 2 });
    expect(titleForLevel(135).tier).toBe(9);
    expect(romanTier(2)).toBe("II");
    expect(romanTier(1)).toBe("");
  });
});
