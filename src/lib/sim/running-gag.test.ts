import { describe, expect, it } from "vitest";
import { NEWS_RUNNING_GAGS, type RunningGagConfig } from "../../config/running-gags.ts";
import { buildGagSegment, gagChatLines, gagDays, gagLinePool, matchesNamePattern, pickIndex } from "./running-gag.ts";

const cfg: RunningGagConfig = NEWS_RUNNING_GAGS.vulcan;

/** A small deterministic generator (mulberry32). */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALLOWED = new Set(["company", "founder", "days", "episode", "when"]);
/** Nothing about any real company: places, exchanges, people, permits, resources. */
const BANNED = [
  /resources/i,
  /lithium/i,
  /\basx\b/i,
  /frankfurt/i,
  /oberrhein/i,
  /landau/i,
  /karlsruhe/i,
  /pfalz/i,
  /australien/i,
  /genehmigung/i,
  /behörde/i,
  /betrug/i,
  /insolvenz/i,
  /\bceo\b/i,
];

describe("running gag: company match and counter", () => {
  it("matches the name pattern like SQL ILIKE", () => {
    expect(matchesNamePattern("Vulcan Energy", cfg.namePattern)).toBe(true);
    expect(matchesNamePattern("VULCAN ENERGY GmbH", cfg.namePattern)).toBe(true);
    expect(matchesNamePattern("Die Vulcan Energy", cfg.namePattern)).toBe(false);
    expect(matchesNamePattern("Vulcan Energie", cfg.namePattern)).toBe(false);
    expect(matchesNamePattern("a.b", "a_b")).toBe(true);
  });

  it("counts days from the founding day as day 1", () => {
    expect(gagDays(0, 0)).toBe(1);
    expect(gagDays(0, 86_400_000 * 3 + 5)).toBe(4);
  });

  it("escalates: later episodes may use more lines", () => {
    expect(gagLinePool(cfg, cfg.lines.length, 0)).toBe(cfg.escalateStart);
    expect(gagLinePool(cfg, cfg.lines.length, 1_000)).toBe(cfg.lines.length);
  });
});

describe("running gag: line picking", () => {
  it("never picks the last line again", () => {
    const random = seeded(7);
    let last: number | null = null;
    for (let i = 0; i < 2_000; i += 1) {
      const next = pickIndex(5, last, random);
      expect(next).not.toBe(last);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(5);
      last = next;
    }
    expect(pickIndex(1, 0, random)).toBe(0);
  });

  it("builds segments without an immediate repeat and reaches every line over time", () => {
    const random = seeded(42);
    const seen = new Set<number>();
    let last: number | null = null;
    for (let episode = 1; episode <= 400; episode += 1) {
      const seg = buildGagSegment(
        cfg,
        { company: "Vulcan Energy", founder: "Bohr_Boris", days: 9, episode, lastLine: last },
        random,
      );
      expect(seg.line).not.toBe(last);
      expect(seg.line).toBeLessThan(gagLinePool(cfg, cfg.lines.length, episode - 1));
      last = seg.line;
      seen.add(seg.line);
    }
    expect(seen.size).toBe(cfg.lines.length);
  });

  it("names the player company and its founder in every segment, placeholders filled", () => {
    const random = seeded(3);
    for (let episode = 1; episode <= 200; episode += 1) {
      const seg = buildGagSegment(
        cfg,
        {
          company: "Vulcan Energy",
          founder: "Bohr_Boris",
          days: 12,
          episode,
          lastLine: null,
          phase: episode % 2 ? "listed" : "ipo",
        },
        random,
      );
      const first = seg.text.split(/(?<=[.!?“])\s/)[0]!;
      expect(first).toContain("Vulcan Energy");
      expect(first).toContain("Bohr_Boris");
      expect(first).toMatch(/Spielerfirma|NEXA/);
      expect(seg.text + seg.headline).not.toMatch(/\{\w+\}/);
      expect(seg.text.length).toBeLessThanOrEqual(420);
      expect(seg.headline.length).toBeLessThanOrEqual(90);
    }
  });

  it("writes the chat: annoyed viewers and the recurring fans, no line twice", () => {
    const lines = gagChatLines(
      cfg,
      { company: "Vulcan Energy", founder: "B", days: 3, episode: 2 },
      ["Jürgen"],
      22,
      seeded(1),
    );
    expect(lines.filter((l) => !l.fan)).toHaveLength(cfg.chat.annoyedPerSegment);
    expect(lines.filter((l) => l.fan)).toHaveLength(cfg.chat.fansPerSegment);
    expect(new Set(lines.map((l) => l.body)).size).toBe(lines.length);
    for (const l of lines) {
      if (l.fan) expect(cfg.chat.fanNames).toContain(l.name);
      expect(l.atSeconds).toBeGreaterThanOrEqual(-cfg.chat.leadSeconds);
      expect(l.atSeconds).toBeLessThanOrEqual(22 + cfg.chat.tailSeconds);
      expect(l.body).not.toMatch(/\{\w+\}/);
    }
  });
});

describe("running gag: texts", () => {
  const all = [
    ...cfg.headlines,
    ...cfg.intros,
    ...cfg.whens,
    ...cfg.lines.map((l) => l.text),
    ...cfg.phaseLines.ipo,
    ...cfg.phaseLines.listed,
    ...cfg.chat.annoyed,
    ...cfg.chat.fans,
  ];

  it("has enough variety", () => {
    expect(cfg.lines.length).toBeGreaterThanOrEqual(30);
    expect(cfg.chat.annoyed.length).toBeGreaterThanOrEqual(25);
    expect(cfg.chat.fans.length).toBeGreaterThanOrEqual(15);
    expect(cfg.chat.fanNames.length).toBeGreaterThanOrEqual(2);
    expect(new Set(all).size).toBe(all.length);
  });

  it("uses only known placeholders and every host line says when", () => {
    for (const text of all) for (const [, key] of text.matchAll(/\{(\w+)\}/g)) expect(ALLOWED).toContain(key);
    for (const line of cfg.lines) expect(line.text).toContain("{when}");
    for (const intro of cfg.intros) {
      expect(intro).toContain("{company}");
      expect(intro).toContain("{founder}");
    }
  });

  it("says nothing about real companies, places or people", () => {
    for (const text of all) for (const word of BANNED) expect(text).not.toMatch(word);
  });
});
