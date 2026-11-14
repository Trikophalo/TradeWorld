import { describe, expect, it } from "vitest";
import { NEWS_SHOW_RULES } from "../../config/news-show.ts";
import {
  fillScript,
  movePercent,
  nextShowAt,
  pickScript,
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
