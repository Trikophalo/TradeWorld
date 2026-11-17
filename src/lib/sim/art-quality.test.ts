import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ART_QUALITY_KEYS,
  artCopyKind,
  artQuality,
  artQualityExtremes,
  artSignature,
  hueBucket,
  type ArtGrid,
} from "./art-quality.ts";

interface Case {
  pixels: ArtGrid;
  copy: "exact" | "near" | null;
  score: number;
  sub: Record<string, number>;
}

// The same cases run in SQL (supabase/tests/b9_nft_quality.sql): both sides must agree exactly.
const raw = readFileSync(new URL("../../../supabase/tests/art_quality_cases.inc", import.meta.url), "utf8");
const json = raw.slice(raw.indexOf("$cases$") + 7, raw.lastIndexOf("$cases$"));
const CASES = JSON.parse(json) as Record<string, Case>;

describe("art quality (ADR-181)", () => {
  it("gives exactly the shared scores and sub-scores", () => {
    const originals = [artSignature(CASES.simple!.pixels)];
    for (const [name, c] of Object.entries(CASES)) {
      const copy = name.endsWith("copy") ? artCopyKind(artSignature(c.pixels), originals) : null;
      expect(copy, name).toBe(c.copy);
      const q = artQuality(c.pixels, copy);
      expect(q.score, name).toBe(c.score);
      for (const k of ART_QUALITY_KEYS) expect(q.sub[k], `${name}.${k}`).toBe(c.sub[k]);
    }
  });

  it("rates empty, flood fills, noise and scribbles low, sprites high", () => {
    const s = (k: string) => artQuality(CASES[k]!.pixels).score;
    expect(s("empty")).toBe(0);
    expect(s("fill")).toBeLessThan(25);
    expect(s("noise")).toBeLessThan(25);
    expect(s("scribble")).toBeLessThan(60);
    expect(s("simple")).toBeGreaterThanOrEqual(75);
    expect(s("detailed")).toBeGreaterThan(s("simple"));
    expect(s("detailed")).toBeGreaterThanOrEqual(90);
  });

  it("flags recoloured and near copies and caps them", () => {
    const sig = artSignature(CASES.simple!.pixels);
    expect(artSignature(CASES.copy!.pixels)).toBe(sig);
    expect(artCopyKind(sig, [sig])).toBe("exact");
    expect(artCopyKind(artSignature(CASES.nearcopy!.pixels), [sig])).toBe("near");
    expect(artCopyKind(artSignature(CASES.detailed!.pixels), [sig])).toBeNull();
    expect(artQuality(CASES.simple!.pixels, "exact").score).toBe(5);
    expect(artQuality(CASES.simple!.pixels, "near").score).toBe(15);
  });

  it("names the strongest and the weakest sub-score", () => {
    const { best, worst } = artQualityExtremes(artQuality(CASES.scribble!.pixels).sub);
    expect(best).toBe("harmony");
    expect(worst).toBe("contrast");
  });

  it("sorts hues into 30-degree buckets and ignores greys", () => {
    expect(hueBucket([255, 0, 0], 20)).toBe(0);
    expect(hueBucket([0, 255, 0], 20)).toBe(4);
    expect(hueBucket([0, 0, 255], 20)).toBe(8);
    expect(hueBucket([255, 0, 128], 20)).toBe(10);
    expect(hueBucket([128, 128, 128], 20)).toBe(-1);
    expect(hueBucket([0, 0, 0], 20)).toBe(-1);
  });
});
