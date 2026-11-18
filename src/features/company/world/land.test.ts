import { describe, expect, it } from "vitest";
import { COUNTRIES } from "@/config/countries";
import { WORLD_KEYS, WORLD_RLE } from "./world-raster.generated";
import {
  cellOf,
  countryAt,
  decodeRow,
  LAND_GRID,
  lonLatOf,
  MAP_COLS,
  MAP_ROWS,
  WORLD_PALETTES,
  worldMapCodes,
  worldMapPixels,
} from "./land";

describe("the pixel world map (ADR-208)", () => {
  it("is at least 4 × as detailed as the old 90 × 35 map, in the same projection", () => {
    expect(MAP_COLS).toBeGreaterThanOrEqual(90 * 4);
    expect(MAP_ROWS).toBeGreaterThanOrEqual(35 * 4);
    // 360° wide, 140° high: square degrees
    expect(MAP_COLS / MAP_ROWS).toBeCloseTo(360 / 140, 5);
    expect(LAND_GRID).toHaveLength(MAP_ROWS);
    for (const row of LAND_GRID) expect(row).toHaveLength(MAP_COLS);
    expect(decodeRow("3.2#a")).toBe("...##a");
    expect(WORLD_RLE).toHaveLength(MAP_ROWS);
  });

  it("puts every country marker on the land of that very country", () => {
    expect([...WORLD_KEYS]).toEqual(COUNTRIES.map((c) => c.key));
    for (const c of COUNTRIES) {
      const { col, row } = cellOf(c.map);
      expect(countryAt(col, row), c.key).toBe(c.key);
    }
  });

  it("knows land and sea where they are", () => {
    const at = (lon: number, lat: number) =>
      LAND_GRID[Math.floor(((80 - lat) / 140) * MAP_ROWS)]![Math.floor(((lon + 180) / 360) * MAP_COLS)]!;
    expect(at(-30, 30)).toBe("."); // Atlantic
    expect(at(-150, 0)).toBe("."); // Pacific
    expect(at(75, -20)).toBe("."); // Indian Ocean
    expect(at(51, 42)).toBe("."); // Caspian Sea
    expect(at(25, 20)).not.toBe("."); // Sahara
    expect(at(-87.5, 47.6)).toBe("o"); // Lake Superior
    expect(at(33, -1)).toBe("o"); // Lake Victoria
    expect(at(-40, 72)).not.toBe("."); // Greenland
    const { lon, lat } = lonLatOf(0, 0);
    expect(lon).toBeCloseTo(-180 + 180 / MAP_COLS, 6);
    expect(lat).toBeCloseTo(80 - 70 / MAP_ROWS, 6);
  });

  it("draws borders, coasts, terrain and waves with colors of both themes", () => {
    const codes = worldMapCodes();
    const used = new Set(codes.join(""));
    for (const k of ["d", "w", "s", "S", "o", "c", "g", "f", "F", "y", "i", "t", "m", "M", "b", "B"])
      expect(used.has(k), k).toBe(true);
    for (const theme of ["light", "dark"] as const)
      for (const k of used) expect(WORLD_PALETTES[theme][k], `${theme}: ${k}`).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("paints RGBA pixels and tints the selected country", () => {
    const plain = worldMapPixels("dark");
    const marked = worldMapPixels("dark", "cn");
    expect(plain).toHaveLength(MAP_COLS * MAP_ROWS * 4);
    const { col, row } = cellOf(COUNTRIES.find((c) => c.key === "cn")!.map);
    const i = (row * MAP_COLS + col) * 4;
    expect([...marked.slice(i, i + 3)]).not.toEqual([...plain.slice(i, i + 3)]);
    const j = 0; // top left: sea, never tinted
    expect([...marked.slice(j, j + 4)]).toEqual([...plain.slice(j, j + 4)]);
    expect(plain[3]).toBe(255);
  });
});
