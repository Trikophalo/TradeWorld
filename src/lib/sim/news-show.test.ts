import { describe, expect, it } from "vitest";
import { NEWS_SHOW_RULES } from "../../config/news-show.ts";
import {
  fillScript,
  movePercent,
  nextShowAt,
  pickScript,
  pickTopics,
  scriptPlaceholders,
  showDurationMs,
  showPhase,
  showSlot,
  usedKeys,
} from "./news-show.ts";

const HOUR = 3_600_000;
const R = NEWS_SHOW_RULES;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

describe("NEXA Nachrichten: timeline", () => {
  it("a show belongs to the full hour, with a grace for the first viewer", () => {
    const hour = 500_000 * HOUR;
    expect(showSlot(hour)).toBe(hour);
    expect(showSlot(hour + (R.waitMinutes * 60 - 1) * 1000)).toBe(hour);
    expect(showSlot(hour + R.waitMinutes * 60_000)).toBe(hour + HOUR);
    expect(nextShowAt(hour)).toBe(hour + HOUR);
    expect(nextShowAt(hour + 1)).toBe(hour + HOUR);
  });

  it("every viewer computes the same phase from the start time", () => {
    const start = 1_000_000;
    const seg = R.segmentSeconds * 1000;
    const intro = R.introSeconds * 1000;
    expect(showPhase(start + 500, start, 3)).toEqual({ mode: "intro", elapsedMs: 500 });
    expect(showPhase(start + intro, start, 3)).toEqual({ mode: "live", segmentIndex: 0, elapsedMs: 0 });
    expect(showPhase(start + intro + seg * 2 + 700, start, 3)).toEqual({
      mode: "live",
      segmentIndex: 2,
      elapsedMs: 700,
    });
    expect(showPhase(start + intro + seg * 3 + 10, start, 3)).toEqual({ mode: "outro", elapsedMs: 10 });
    expect(showPhase(start + showDurationMs(3), start, 3)).toEqual({ mode: "over" });
    expect(showPhase(start - 5, start, 3)).toEqual({ mode: "intro", elapsedMs: 0 });
  });

  it("every script fits into its segment at the typing speed", () => {
    const room = R.segmentSeconds * R.charsPerSecond;
    for (const [kind, kit] of Object.entries(R.texts)) {
      const longestReason = Math.max(...kit.reasons.map((r) => r.length));
      for (const frame of kit.frames) {
        // placeholders grow: allow 120 characters for names, amounts and a company's idea
        const length = frame.text.length + longestReason + 120;
        expect(length, `${kind}: ${frame.headline}`).toBeLessThan(room);
        expect(frame.text, `${kind}: ${frame.headline}`).toContain("{reason}");
      }
    }
  });
});

describe("NEXA Nachrichten: scripts never repeat soon", () => {
  it("fills placeholders and formats moves", () => {
    expect(fillScript("{stock} fällt um {move}, {x}", { stock: "BRZ", move: "12 %" })).toBe("BRZ fällt um 12 %, {x}");
    expect(movePercent(-1240)).toBe("12,4 %");
  });

  it("uses every combination of a kind once before any comes back", () => {
    const rng = seeded(4);
    const kit = R.texts.stockDown;
    const total = kit.frames.length * kit.reasons.length;
    const used: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < total; i++) {
      const pick = pickScript("stockDown", used, rng);
      expect(seen.has(pick.key), `repeat after ${i} shows`).toBe(false);
      seen.add(pick.key);
      used.push(...usedKeys(pick));
    }
    expect(seen.size).toBe(total);
    // and the same reason does not come twice in a row
    const reasons = [...seen].map((k) => k.split(":")[2]);
    for (let i = 1; i < kit.reasons.length; i++) expect(reasons[i]).not.toBe(reasons[i - 1]);
  });

  it("has hundreds of different news before the kit runs out", () => {
    const combos = Object.values(R.texts).reduce((n, kit) => n + kit.frames.length * kit.reasons.length, 0);
    expect(combos).toBeGreaterThan(350);
  });
});

describe("NEXA Nachrichten: the draw of the topics (ADR-169)", () => {
  const rules = {
    ...R,
    topics: {
      ...R.topics,
      count: 3,
      list: {
        a1: { group: "a", weight: 10 },
        a2: { group: "a", weight: 10 },
        b1: { group: "b", weight: 10 },
        c1: { group: "c", weight: 1 },
        c2: { group: "c", weight: 1 },
        off: { group: "d", weight: 0 },
      },
    },
  } as unknown as typeof R;
  const all = ["a1", "a2", "b1", "c1", "c2", "off"].map((topic) => ({ topic }));

  it("finds the placeholders of a text", () => {
    expect(scriptPlaceholders("{name} zahlt {amount}, {name} weint. {reason}")).toEqual(["name", "amount", "reason"]);
    expect(scriptPlaceholders("nichts")).toEqual([]);
  });

  it("takes topics.count stories, one per topic, from as many groups as it can", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const picks = pickTopics(all, [], seeded(seed), rules);
      expect(picks.length).toBe(3);
      expect(new Set(picks.map((p) => p.topic)).size).toBe(3);
      expect(new Set(picks.map((p) => p.topic[0])).size).toBe(3);
      expect(picks.map((p) => p.topic)).not.toContain("off");
    }
  });

  it("leaves out what ran in the last show while there are alternatives, and only then", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const picks = pickTopics(all, ["a1", "b1"], seeded(seed), rules).map((p) => p.topic);
      // a2, c1 and c2 are fresh: they come first, the repeats stay out
      expect(picks.sort()).toEqual(["a2", "c1", "c2"]);
    }
    const forced = pickTopics(all.slice(0, 3), ["a1", "a2", "b1"], seeded(5), rules);
    expect(forced.length).toBe(3);
    const two = pickTopics(
      [{ topic: "a1" }, { topic: "b1" }, { topic: "c1" }, { topic: "c2" }],
      ["c1"],
      seeded(9),
      rules,
    );
    expect(two.map((p) => p.topic).sort()).toEqual(["a1", "b1", "c2"]);
  });

  it("tells one story per player and skips players who are in the show already", () => {
    const candidates = [
      { topic: "a1", player: "p1" },
      { topic: "b1", player: "p1" },
      { topic: "c1", player: "p2" },
      { topic: "c2", player: null },
    ];
    for (let seed = 1; seed <= 30; seed++) {
      const picks = pickTopics(candidates, [], seeded(seed), rules);
      expect(picks.filter((p) => p.player === "p1").length).toBeLessThanOrEqual(1);
      expect(pickTopics(candidates, [], seeded(seed), rules, ["p1", "p2"]).map((p) => p.topic)).toEqual(["c2"]);
    }
  });

  it("follows the weights, ignores unknown topics and survives an empty list", () => {
    let heavy = 0;
    const one = { ...rules, topics: { ...rules.topics, count: 1 } } as unknown as typeof R;
    for (let seed = 1; seed <= 400; seed++)
      if (pickTopics([{ topic: "a1" }, { topic: "c1" }], [], seeded(seed * 7919), one)[0]!.topic === "a1") heavy++;
    expect(heavy).toBeGreaterThan(320);
    expect(pickTopics([{ topic: "unknown" }, { topic: "off" }], [], seeded(1), rules)).toEqual([]);
    expect(pickTopics([], [], seeded(1), rules)).toEqual([]);
    expect(
      pickTopics(all, [], seeded(1), { ...rules, topics: { ...rules.topics, count: 0 } } as unknown as typeof R),
    ).toEqual([]);
  });

  it("the real config gives a show with data three stories and a quiet server too", () => {
    const quiet = Object.entries(R.topics.list)
      .filter(([, meta]) => meta.slots.length === 0)
      .map(([topic]) => ({ topic }));
    expect(quiet.length).toBeGreaterThanOrEqual(7);
    expect(pickTopics(quiet, [], seeded(2)).length).toBe(R.topics.count);
  });
});
