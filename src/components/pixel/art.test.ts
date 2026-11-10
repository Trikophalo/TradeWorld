import { describe, expect, it } from "vitest";
import { ALL_PIXEL_ART } from "./art";
import { buildPixelPaths } from "./pixel-icon";

describe("pixel art", () => {
  for (const [name, art] of Object.entries(ALL_PIXEL_ART)) {
    it(`${name} is a square grid that only uses palette colours`, () => {
      const size = art.grid.length;
      expect([12, 16, 24]).toContain(size);
      for (const row of art.grid) {
        expect(row.length, `row "${row}"`).toBe(size);
        for (const char of row) {
          if (char !== ".") expect(Object.keys(art.palette)).toContain(char);
        }
      }
      expect(Object.keys(art.palette).length).toBeLessThanOrEqual(6);
    });
  }

  it("merges horizontal runs into one path per colour", () => {
    const paths = buildPixelPaths(["aab", "..b"], { a: "red", b: "blue" });
    expect(paths).toEqual([
      { color: "red", d: "M0 0h2v1h-2z" },
      { color: "blue", d: "M2 0h1v1h-1zM2 1h1v1h-1z" },
    ]);
  });
});
