import { describe, expect, it } from "vitest";
import { NEWS_SHOW_RULES } from "./news-show";
import { NEWS_RAMBLE_EXTRA, NEWS_TOPIC_GROUPS, NEWS_TOPICS, type NewsTopicKey } from "./news-topics";
import { NEWS_TOPIC_GROUPS_FRESH } from "./news-topics-fresh";

const keys = Object.keys(NEWS_TOPICS) as NewsTopicKey[];
const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))];

/** Every text of a topic, and all new texts of the show. */
const textsOf = (key: NewsTopicKey) => [
  ...NEWS_TOPICS[key].frames.flatMap((frame) => [frame.headline, frame.text]),
  ...NEWS_TOPICS[key].reasons,
];
const ALL_TEXTS = [...keys.flatMap(textsOf), ...NEWS_RAMBLE_EXTRA];

/**
 * A small list of words that must never be in a script: slurs, protected traits as a punchline, sexual words,
 * self-harm and violence, real tragedies. Lower case, matched as parts of words.
 */
const BANNED = [
  "selbstmord",
  "suizid",
  "umbring",
  "erschieß",
  "erhäng",
  "aufhäng",
  "vergewalt",
  "nazi",
  "hitler",
  "holocaust",
  "jude",
  "jüdi",
  "moslem",
  "muslim",
  "islam",
  "christ ",
  "schwul",
  "lesb",
  "transe",
  "tunte",
  "behindert",
  "krüppel",
  "spast",
  "mongo",
  "hure",
  "nutte",
  "schlampe",
  "fotze",
  "wichs",
  "fick",
  "porno",
  "titten",
  "neger",
  "zigeuner",
  "kanake",
  "ausländer",
  "flüchtling",
  "asylant",
  "hässlich",
  "fettsack",
  "fette ",
  "dicke ",
  "krebs",
  "terror",
  "amoklauf",
  "attentat",
  "erdbeben",
  "tsunami",
  "corona",
  "ukraine",
  "kindersch",
];

describe("NEXA Nachrichten topics (ADR-169)", () => {
  it("has many topics in every group, each a full script", () => {
    expect(keys.length).toBeGreaterThanOrEqual(40);
    // the groups of season three (ADR-210) start with at least three topics each
    const fresh: readonly string[] = NEWS_TOPIC_GROUPS_FRESH;
    for (const group of NEWS_TOPIC_GROUPS)
      expect(keys.filter((key) => NEWS_TOPICS[key].group === group).length, group).toBeGreaterThanOrEqual(
        fresh.includes(group) ? 3 : 5,
      );
    for (const key of keys) {
      const topic = NEWS_TOPICS[key];
      expect(topic.frames.length, key).toBeGreaterThanOrEqual(3);
      expect(topic.reasons.length, key).toBeGreaterThanOrEqual(7);
      expect(topic.moods.length, key).toBeGreaterThanOrEqual(1);
      expect(topic.weight, key).toBeGreaterThan(0);
      expect(new Set(topic.reasons).size, key).toBe(topic.reasons.length);
      expect(new Set(topic.frames.map((frame) => frame.headline)).size, key).toBe(topic.frames.length);
    }
    expect(ALL_TEXTS.length).toBeGreaterThan(550);
    expect(new Set(ALL_TEXTS.filter((text) => text.length > 40)).size).toBe(
      ALL_TEXTS.filter((text) => text.length > 40).length,
    );
  });

  it("is part of the show's config: texts, moods and the list of the draw", () => {
    for (const key of keys) {
      expect(NEWS_SHOW_RULES.texts[key].frames, key).toBe(NEWS_TOPICS[key].frames);
      expect(NEWS_SHOW_RULES.moods[key], key).toBe(NEWS_TOPICS[key].moods);
      expect(NEWS_SHOW_RULES.topics.list[key].group, key).toBe(NEWS_TOPICS[key].group);
    }
    for (const extra of NEWS_RAMBLE_EXTRA) expect(NEWS_SHOW_RULES.texts.ramble.reasons).toContain(extra);
    expect(NEWS_SHOW_RULES.topics.ords.length).toBeGreaterThanOrEqual(NEWS_SHOW_RULES.topics.count);
    // the show stays under five minutes
    const seconds =
      NEWS_SHOW_RULES.introSeconds +
      NEWS_SHOW_RULES.maxSegments * NEWS_SHOW_RULES.segmentSeconds +
      NEWS_SHOW_RULES.outroSeconds;
    expect(seconds).toBeLessThan(300);
  });

  it("uses only the placeholders a topic declares, and every frame has its reason", () => {
    for (const key of keys) {
      const topic = NEWS_TOPICS[key];
      const slots: readonly string[] = topic.slots;
      for (const frame of topic.frames) {
        expect(frame.text, `${key}: ${frame.headline}`).toContain("{reason}");
        expect(frame.headline, key).not.toContain("{reason}");
        for (const name of placeholders(frame.headline + frame.text).filter((p) => p !== "reason"))
          expect(slots, `${key}: {${name}} in "${frame.headline}"`).toContain(name);
      }
      // reasons are fixed sentences: nothing is filled in there
      for (const reason of topic.reasons) expect(placeholders(reason), `${key}: ${reason}`).toEqual([]);
      // every declared placeholder is used by at least one frame
      const used = new Set(topic.frames.flatMap((frame) => placeholders(frame.headline + frame.text)));
      for (const slot of slots) expect(used.has(slot), `${key}: {${slot}} unused`).toBe(true);
    }
    for (const extra of NEWS_RAMBLE_EXTRA) expect(placeholders(extra), extra).toEqual([]);
  });

  it("fills completely with one value per declared placeholder", () => {
    for (const key of keys) {
      const topic = NEWS_TOPICS[key];
      for (const frame of topic.frames) {
        let text = `${frame.headline} ${frame.text}`.replace("{reason}", topic.reasons[0]!);
        for (const slot of topic.slots) text = text.replaceAll(`{${slot}}`, "X");
        expect(text, `${key}: ${frame.headline}`).not.toMatch(/[{}]/);
      }
    }
  });

  it("has no banned word, no stray braces and no currency other than €", () => {
    for (const text of ALL_TEXTS) {
      const lower = ` ${text.toLowerCase()} `;
      for (const word of BANNED) expect(lower.includes(word), `"${word}" in: ${text}`).toBe(false);
      expect(text.replace(/\{\w+\}/g, ""), text).not.toMatch(/[{}]/);
      expect(text, text).not.toMatch(/\$|Euro\b|Dollar/);
    }
  });

  it("names real public figures only in the digressions, as hearsay", () => {
    const people = NEWS_SHOW_RULES.ramble.people;
    for (const key of keys)
      for (const text of textsOf(key))
        for (const person of people) expect(text.includes(person), `${person} in ${key}`).toBe(false);
    for (const extra of NEWS_RAMBLE_EXTRA)
      if (people.some((person) => extra.includes(person))) expect(extra, extra).toMatch(/angeblich|soll /);
  });

  it("teases a player only through what the story says: the name is never part of an insult", () => {
    // the name slot stands alone (not glued into a word), so a nickname cannot turn a sentence into something else
    for (const key of keys)
      for (const frame of NEWS_TOPICS[key].frames)
        for (const text of [frame.headline, frame.text])
          expect(text, key).not.toMatch(/\w\{(name|victim)\}|\{(name|victim)\}\w/);
  });
});
