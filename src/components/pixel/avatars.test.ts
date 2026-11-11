import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { AVATAR_ART, avatarArt } from "./avatars.ts";

describe("avatar portraits", () => {
  it("there is art for every portrait in the balance config and nothing else", () => {
    expect(Object.keys(AVATAR_ART).sort()).toEqual(BALANCE.avatars.portraits.map((p) => p.key).sort());
  });

  for (const [key, art] of Object.entries(AVATAR_ART)) {
    it(`${key} is a 16×16 grid with at most ten palette colours`, () => {
      expect(art.grid).toHaveLength(16);
      for (const row of art.grid) {
        expect(row).toHaveLength(16);
        for (const char of row) expect(Object.keys(art.palette)).toContain(char);
      }
      expect(Object.keys(art.palette).length).toBeLessThanOrEqual(10);
    });
  }

  it("falls back to the rookie", () => {
    expect(avatarArt("nope")).toBe(AVATAR_ART.rookie);
    expect(avatarArt(null)).toBe(AVATAR_ART.rookie);
  });
});
