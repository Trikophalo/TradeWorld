import { describe, expect, it } from "vitest";
import de from "../../../../messages/de.json";
import { episodeVariant, showEpisode } from "./variants";

const studio = de.newsStudio;

describe("show variants (ADR-210)", () => {
  it("numbers a show by the hour it started in", () => {
    expect(showEpisode("2026-11-18T10:00:00Z")).toBe(showEpisode("2026-11-18T10:09:59Z"));
    expect(showEpisode("2026-11-18T11:00:00Z")! - showEpisode("2026-11-18T10:59:00Z")!).toBe(1);
    expect(showEpisode(null)).toBeNull();
    expect(showEpisode("kaputt")).toBeNull();
  });

  it("never repeats a variant within the length of the pool", () => {
    const list = ["a", "b", "c", "d"];
    const seen = [0, 1, 2, 3].map((i) => episodeVariant(list, 491_234 + i));
    expect(new Set(seen).size).toBe(4);
    expect(episodeVariant(list, 491_238)).toBe(seen[0]);
    expect(episodeVariant(list, -3)).toBeDefined();
    expect(episodeVariant([], 5)).toBeUndefined();
    expect(episodeVariant(list, null)).toBeUndefined();
  });

  it("has many German taglines and goodbyes without duplicates", () => {
    const taglines: readonly string[] = studio.introTaglines;
    const outros: readonly { headline: string; text: string }[] = studio.outros;
    expect(taglines.length).toBeGreaterThanOrEqual(20);
    expect(outros.length).toBeGreaterThanOrEqual(20);
    expect(new Set(taglines).size).toBe(taglines.length);
    expect(new Set(outros.map((o) => o.text)).size).toBe(outros.length);
    for (const line of [...taglines, ...outros.flatMap((o) => [o.headline, o.text]), ...studio.ticker]) {
      expect(line.length, line).toBeLessThanOrEqual(140);
      expect(line, line).not.toMatch(/[{}]|Vulcan|\$|Dollar/);
    }
    for (const tagline of taglines) expect(tagline.length, tagline).toBeLessThanOrEqual(60);
    // the old texts stay the first variants
    expect(taglines[0]).toBe(studio.introTagline);
    expect(outros[0]!.text).toBe(studio.outro);
  });
});
