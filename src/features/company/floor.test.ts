import { describe, expect, it } from "vitest";
import { bubbleLeftMs, bubbleText, floorRhythm, onlineCount } from "./floor";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const at = (secondsAgo: number) => ({
  lastMessage: { body: "Hallo", at: new Date(NOW - secondsAgo * 1000).toISOString() },
});

describe("company floor bubbles (ADR-156)", () => {
  it("shows a message for bubbleSeconds and then not any more", () => {
    expect(bubbleLeftMs(at(10), NOW, 120)).toBe(110_000);
    expect(bubbleLeftMs(at(119), NOW, 120)).toBe(1_000);
    expect(bubbleLeftMs(at(120), NOW, 120)).toBeNull();
    expect(bubbleLeftMs(at(500), NOW, 120)).toBeNull();
    expect(bubbleLeftMs({ lastMessage: null }, NOW, 120)).toBeNull();
    expect(bubbleLeftMs(at(10), NOW, 0)).toBeNull();
  });

  it("treats a message from a server clock ahead of ours as fresh", () => {
    expect(bubbleLeftMs(at(-30), NOW, 120)).toBe(120_000);
  });

  it("ignores broken timestamps", () => {
    expect(bubbleLeftMs({ lastMessage: { body: "x", at: "gestern" } }, NOW, 120)).toBeNull();
  });

  it("cuts long texts at a word and keeps short ones", () => {
    expect(bubbleText("  Kaffee   ist fertig ")).toBe("Kaffee ist fertig");
    const long =
      "Wer hat eigentlich den letzten Kaffee getrunken und die Kanne nicht wieder aufgefüllt, ehrlich jetzt?";
    const cut = bubbleText(long, 40);
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut.endsWith("…")).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(bubbleText("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("company floor figures", () => {
  it("gives every name its own stable rhythm", () => {
    expect(floorRhythm("Anna")).toEqual(floorRhythm("Anna"));
    expect(floorRhythm("Anna")).not.toEqual(floorRhythm("Bruno"));
    const r = floorRhythm("Clara");
    expect(r.delay).toBeGreaterThanOrEqual(0);
    expect(r.delay).toBeLessThan(1);
    expect(r.duration).toBeGreaterThanOrEqual(1.6);
    expect(r.duration).toBeLessThan(2.5);
  });

  it("counts who is online", () => {
    expect(onlineCount([{ online: true }, { online: false }, { online: true }])).toBe(2);
  });
});
