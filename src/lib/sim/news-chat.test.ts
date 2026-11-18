import { describe, expect, it } from "vitest";
import { NEWS_FRESH } from "../../config/news-fresh.ts";
import { chatPool, fillChatLine, freshChatLines, type FreshChatSegment } from "./news-chat.ts";

const rules = NEWS_FRESH.chat;
const names = ["Jürgen Test", "Chantal Test", "Uschi Test"];

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

const SHOW: FreshChatSegment[] = [
  { kind: "world", topic: "worldLeader", values: { company: "Knusperkönig", country: "Japan" } },
  { kind: "loser", values: { name: "Dax_Dieter" } },
  { kind: "cards", topic: "cardBlackLabel", values: { name: "Zins_Zoe", card: "Glitzerdrache", fee: "500 €" } },
];
const opts = (seed: number, recent?: Set<string>) => ({
  introSeconds: 12,
  segmentSeconds: 22,
  names,
  random: seeded(seed),
  recent,
});

describe("the chat reacts to the segment on air (ADR-210)", () => {
  it("draws from the topic first, else from the kind", () => {
    expect(chatPool(rules, SHOW[0]!)).toBe(rules.topics.worldLeader);
    expect(chatPool(rules, SHOW[1]!)).toBe(rules.kinds.loser);
    expect(chatPool(rules, { kind: "nothing", values: {} })).toEqual([]);
    expect(fillChatLine("{company} in {country}", { company: "A" })).toBeNull();
    expect(fillChatLine("{company}!", { company: "A" })).toBe("A!");
  });

  it("writes lines in the window of their segment, filled, a storm after a big pull and at most one poll", () => {
    for (const seed of [1, 2, 3, 42]) {
      const lines = freshChatLines(SHOW, rules, opts(seed));
      const first = lines.filter((l) => l.type === "line" && l.atSeconds < 12 + 22);
      expect(first.length).toBe(rules.perSegment);
      for (const l of first) expect(rules.topics.worldLeader as readonly string[]).toContain(l.template);
      for (const l of lines) {
        expect(l.body).not.toMatch(/[{}]/);
        expect(l.atSeconds).toBeGreaterThanOrEqual(12);
        expect(l.atSeconds).toBeLessThan(12 + 3 * 22);
      }
      const emotes = lines.filter((l) => l.type === "emote");
      expect(emotes.length).toBeGreaterThanOrEqual(rules.burst.countMin);
      for (const e of emotes) expect(e.atSeconds).toBeGreaterThanOrEqual(12 + 2 * 22);
      expect(lines.filter((l) => l.type === "poll").length).toBeLessThanOrEqual(1);
      expect(lines.map((l) => l.atSeconds)).toEqual([...lines.map((l) => l.atSeconds)].sort((a, b) => a - b));
    }
  });

  it("keeps away from what aired in the last shows while the pool has others", () => {
    const one = freshChatLines(SHOW, rules, opts(5));
    const recent = new Set(one.flatMap((l) => (l.template ? [l.template] : [])));
    const two = freshChatLines(SHOW, rules, opts(6, recent));
    for (const l of two) if (l.template) expect(recent.has(l.template), l.body).toBe(false);
  });

  it("stays under the limit per show", () => {
    const many = Array.from({ length: 40 }, (_, i): FreshChatSegment => ({
      kind: "ramble",
      values: {},
      topic: i % 2 ? null : "oddOracle",
    }));
    const lines = freshChatLines(many, rules, opts(9));
    expect(lines.filter((l) => l.type === "line").length).toBeLessThanOrEqual(rules.maxPerShow);
    expect(freshChatLines(SHOW, rules, { ...opts(1), names: [] })).toEqual([]);
  });
});

describe("the text pools of season three (ADR-210)", () => {
  const chatLines = [
    ...Object.values(rules.topics).flat(),
    ...Object.values(rules.kinds).flat(),
    ...rules.polls.list.map((p) => p.question),
  ];
  it("has hundreds of chat lines, no duplicates within a pool, short enough for the chat", () => {
    expect(chatLines.length).toBeGreaterThan(250);
    for (const pool of [...Object.values(rules.topics), ...Object.values(rules.kinds)])
      expect(new Set(pool).size, pool[0]).toBe(pool.length);
    for (const line of chatLines) expect(line.length, line).toBeLessThanOrEqual(140);
    expect(new Set(rules.names).size).toBe(rules.names.length);
    expect(new Set(NEWS_FRESH.transitions).size).toBe(NEWS_FRESH.transitions.length);
    expect(new Set(rules.burst.emotes).size).toBe(rules.burst.emotes.length);
  });

  it("is German, about the game only, and keeps the running gag out of it", () => {
    const texts = [...chatLines, ...NEWS_FRESH.transitions, ...Object.values(NEWS_FRESH.events.responses)];
    const german =
      /[äöüßÄÖÜ]|\b(der|die|das|und|ist|nicht|ich|ein|eine|mit|zu|auf|für|wie|was|wer|sich|den|im|es|hat|noch|auch|jetzt|bei|von|mir|mein|wird|bin|so|an|in|bitte|gut|nie|immer|hier)\b/i;
    const english = /\b(the|and|you|is|this|what|not|with|my)\b/i;
    let germanCount = 0;
    for (const text of texts) {
      if (german.test(text)) germanCount += 1;
      expect(english.test(text), text).toBe(false);
      expect(text, text).not.toMatch(/Vulcan|\$|Dollar|Euro\b/);
    }
    // nearly every line reads German (a few are pure emotes or "GG")
    expect(germanCount / texts.length).toBeGreaterThan(0.8);
  });

  it("names every external event, every strategy word and every severity", () => {
    expect(Object.keys(NEWS_FRESH.eventNames).length).toBe(15);
    expect(NEWS_FRESH.events.severityNames.length).toBe(3);
    expect(NEWS_FRESH.events.ords.length).toBe(NEWS_FRESH.events.max);
  });
});
