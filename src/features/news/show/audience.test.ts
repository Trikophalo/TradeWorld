import { describe, expect, it } from "vitest";
import { accessoryByKey } from "@/config/accessories";
import type { NewsShowAudienceMember, NewsShowChatMessage } from "@/features/game/types";
import { botFigure, bubblesAt, stageAudience, type AudienceRules } from "./audience";

const T0 = Date.parse("2026-11-15T18:00:00Z");
const RULES: AudienceRules = {
  max: 4,
  bubbleSeconds: 6,
  bubblesAtOnce: 2,
  bubbleMaxDelaySeconds: 10,
  botMinutes: 8,
  botAccessoriesMax: 3,
};

let seq = 0;
const line = (nickname: string, atSeconds: number, bot = false, body = "hallo"): NewsShowChatMessage => ({
  id: ++seq,
  nickname,
  body,
  at: new Date(T0 + atSeconds * 1000).toISOString(),
  mine: false,
  bot,
});
const member = (nickname: string, extra: Partial<NewsShowAudienceMember> = {}): NewsShowAudienceMember => ({
  nickname,
  avatarKey: "rookie",
  accessories: [],
  friend: false,
  me: false,
  ...extra,
});

describe("botFigure", () => {
  it("is stable per name, a known portrait and at most one accessory per slot", () => {
    for (const name of ["Jürgen Kowalski", "Chantal Schröder", "Emre Yıldırım", "Mandy Wuttke"]) {
      const a = botFigure(name, RULES);
      expect(botFigure(name, RULES)).toEqual(a);
      expect(a.avatarKey).not.toBe("finn_fan");
      expect(a.accessories.length).toBeLessThanOrEqual(RULES.botAccessoriesMax);
      const slots = a.accessories.map((key) => accessoryByKey(key)?.slot);
      expect(slots.every(Boolean)).toBe(true);
      expect(new Set(slots).size).toBe(slots.length);
    }
  });

  it("dresses different names differently", () => {
    const names = ["Jürgen", "Chantal", "Dieter", "Uschi", "Kevin", "Renate", "Horst", "Mandy"];
    const looks = new Set(names.map((n) => JSON.stringify(botFigure(n, RULES))));
    expect(looks.size).toBeGreaterThan(4);
  });

  it("wears nothing when no accessories are allowed", () => {
    expect(botFigure("Jürgen", { botAccessoriesMax: 0 }).accessories).toEqual([]);
  });
});

describe("stageAudience", () => {
  it("puts players first, then the made-up viewers who spoke lately, in the order they first spoke", () => {
    const chat = [
      line("Uschi", 30, true),
      line("Horst", 10, true),
      line("Uschi", 40, true),
      line("Alt", -9 * 60, true),
      line("Mila", 20),
    ];
    const stage = stageAudience(
      [member("Mila", { me: true }), member("Fritz", { friend: true })],
      chat,
      2,
      T0 + 60_000,
      RULES,
    );
    expect(stage.figures.map((f) => f.nickname)).toEqual(["Mila", "Fritz", "Horst", "Uschi"]);
    expect(stage.figures.map((f) => [f.me, f.friend, f.bot])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [false, false, true],
    ]);
    expect(stage.bots).toBe(2);
    expect(stage.hidden).toBe(0);
  });

  it("ignores lines from the future and caps the stage, counting the rest", () => {
    const chat = [line("A", 1, true), line("B", 2, true), line("C", 3, true), line("D", 500, true)];
    const stage = stageAudience([member("Mila", { me: true })], chat, 5, T0 + 10_000, RULES);
    expect(stage.figures.map((f) => f.nickname)).toEqual(["Mila", "A", "B", "C"]);
    // 4 players the server did not send
    expect(stage.hidden).toBe(4);
    const more = stageAudience([member("Mila", { me: true })], [...chat, line("E", 4, true)], 1, T0 + 10_000, RULES);
    expect(more.hidden).toBe(1);
  });
});

describe("bubblesAt", () => {
  const stage = new Set(["A", "B", "C", "D"]);

  it("shows a line for bubbleSeconds, only for people on the stage", () => {
    const chat = [line("A", 0), line("Zoe", 1)];
    expect(bubblesAt(chat, stage, T0 + 1_000, RULES).map((b) => b.nickname)).toEqual(["A"]);
    expect(bubblesAt(chat, stage, T0 + 5_999, RULES)).toHaveLength(1);
    expect(bubblesAt(chat, stage, T0 + 6_000, RULES)).toHaveLength(0);
    expect(bubblesAt(chat, stage, T0 - 1, RULES)).toHaveLength(0);
  });

  it("keeps at most bubblesAtOnce up; the next waits for a free place", () => {
    const chat = [line("A", 0), line("B", 1), line("C", 2)];
    expect(bubblesAt(chat, stage, T0 + 3_000, RULES).map((b) => b.nickname)).toEqual(["A", "B"]);
    const later = bubblesAt(chat, stage, T0 + 6_500, RULES);
    expect(later.map((b) => b.nickname)).toEqual(["B", "C"]);
    expect(later[1]!.from).toBe(T0 + 6_000);
    expect(later[1]!.until).toBe(T0 + 12_000);
    // B kept its height; C took the one A left
    expect(later.map((b) => b.lane)).toEqual([1, 0]);
  });

  it("drops a line that would wait too long", () => {
    const chat = [line("A", 0), line("B", 0), line("C", 0), line("D", 0), line("A", 1), line("B", 1)];
    const ids = new Set<number>();
    for (let s = 0; s < 30; s++) for (const b of bubblesAt(chat, stage, T0 + s * 1000, RULES)) ids.add(b.id);
    expect(ids.size).toBeLessThan(chat.length + 1);
    for (let s = 0; s < 30; s++) expect(bubblesAt(chat, stage, T0 + s * 1000, RULES).length).toBeLessThanOrEqual(2);
  });

  it("replaces a person's bubble with their newer line right away", () => {
    const chat = [line("A", 0, false, "eins"), line("A", 2, false, "zwei")];
    expect(bubblesAt(chat, stage, T0 + 3_000, RULES).map((b) => b.body)).toEqual(["zwei"]);
  });
});
