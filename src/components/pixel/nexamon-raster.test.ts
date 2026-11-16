import { describe, expect, it } from "vitest";
import type { NexamonArt } from "@/config/nexamon/types";
import {
  blitArt,
  blitGrid,
  countOpaque,
  createRaster,
  cropRaster,
  ditherRect,
  fillRect,
  hexToRgb,
  isOpaque,
  mixHex,
  pixelHex,
  roundCorners,
  setPixel,
  validateArt,
} from "./nexamon-raster";

const art = (over: Partial<NexamonArt> = {}): NexamonArt => ({
  width: 60,
  height: 40,
  palette: { a: "#112233" },
  grid: Array.from({ length: 40 }, () => "a".repeat(60)),
  ...over,
});

describe("nexamon raster", () => {
  it("reads hex colours and rejects anything else", () => {
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
    expect(() => hexToRgb("red")).toThrow();
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("paints opaque pixels and blends translucent ones over what is there", () => {
    const r = createRaster(2, 1);
    setPixel(r, 0, 0, "#ff0000");
    setPixel(r, 0, 0, "#0000ff", 0.5);
    expect(pixelHex(r, 0, 0)).toBe("#800080");
    // On an empty pixel a translucent colour keeps its hue and only its alpha.
    setPixel(r, 1, 0, "#00ff00", 0.5);
    expect(pixelHex(r, 1, 0)).toBe("#00ff00");
    expect(r.data[7]).toBe(128);
    // Outside the raster nothing happens.
    setPixel(r, 5, 5, "#ffffff");
    expect(countOpaque(r)).toBe(2);
  });

  it("merges a grid onto a raster: transparent cells keep what is below", () => {
    const r = createRaster(4, 2);
    fillRect(r, 0, 0, 4, 2, "#111111");
    blitGrid(r, [".a.", "b.?"], { a: "#aa0000", b: "#00bb00" }, 1, 0);
    expect(pixelHex(r, 1, 0)).toBe("#111111");
    expect(pixelHex(r, 2, 0)).toBe("#aa0000");
    expect(pixelHex(r, 1, 1)).toBe("#00bb00");
    // A character without a palette entry is skipped, not drawn black.
    expect(pixelHex(r, 3, 1)).toBe("#111111");
  });

  it("clips artwork at the edges of the raster", () => {
    const r = createRaster(72, 100);
    blitArt(r, art(), 40, 90);
    expect(countOpaque(r)).toBe(32 * 10);
    expect(isOpaque(r, 39, 95)).toBe(false);
    expect(pixelHex(r, 71, 99)).toBe("#112233");
  });

  it("dithers a gradient with only the given colours, darkening downwards", () => {
    const r = createRaster(8, 16);
    ditherRect(r, 0, 0, 8, 16, ["#ffffff", "#000000"]);
    const seen = new Set<string>();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) seen.add(pixelHex(r, x, y)!);
    expect([...seen].sort()).toEqual(["#000000", "#ffffff"]);
    const whites = (y: number) => Array.from({ length: 8 }, (_, x) => pixelHex(r, x, y)).filter((c) => c === "#ffffff");
    expect(whites(0)).toHaveLength(8);
    expect(whites(15)).toHaveLength(0);
    expect(whites(1).length).toBeGreaterThan(whites(13).length);
  });

  it("cuts pixel corners and crops", () => {
    const r = createRaster(10, 10);
    fillRect(r, 0, 0, 10, 10, "#ffffff");
    roundCorners(r, 3);
    expect(isOpaque(r, 0, 0)).toBe(false);
    expect(isOpaque(r, 9, 9)).toBe(false);
    expect(isOpaque(r, 1, 0)).toBe(true);
    expect(countOpaque(r)).toBe(96);
    const part = cropRaster(r, 0, 0, 2, 2);
    expect([part.width, part.height, countOpaque(part)]).toEqual([2, 2, 3]);
  });
});

describe("validateArt", () => {
  it("accepts artwork of the right size for its rarity", () => {
    expect(validateArt(art(), "common")).toEqual([]);
    expect(validateArt(art(), "rare")).toEqual([]);
  });

  it("names every problem", () => {
    expect(validateArt(art(), "ultra")).toEqual(["size 60x40, expected 68x48"]);
    const broken = art({
      grid: [...Array.from({ length: 38 }, () => "a".repeat(60)), "a".repeat(59), `${"a".repeat(59)}z`],
      palette: { a: "#12345" },
    });
    expect(validateArt(broken, "common")).toEqual([
      "row 38 has 59 pixels, expected 60",
      "character 'z' is not in the palette",
      "palette 'a' is not a hex colour: #12345",
    ]);
    expect(validateArt(art({ grid: [] }), "common")[0]).toBe("0 rows, expected 40");
  });
});
