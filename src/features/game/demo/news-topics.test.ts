import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { NEWS_TOPICS, type NewsTopicKey } from "@/config/news-topics";
import { fillScript, pickTopics, scriptPlaceholders } from "@/lib/sim/news-show";
import { demoTopicCandidates } from "./news-topics";

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

describe("NEXA Nachrichten topics in the demo (ADR-169)", () => {
  it("has a candidate with every value for every topic, whatever the dice say", () => {
    for (const seed of [1, 7, 42, 2026]) {
      const candidates = demoTopicCandidates({
        players: ["Freundin_Frieda"],
        stocks: ["Volta Energie AG"],
        random: seeded(seed),
      });
      expect(candidates.map((c) => c.topic).sort()).toEqual(Object.keys(NEWS_TOPICS).sort());
      for (const candidate of candidates) {
        const topic = NEWS_TOPICS[candidate.topic];
        for (const frame of topic.frames)
          for (const reason of topic.reasons) {
            const text = fillScript(`${frame.headline} ${frame.text.replace("{reason}", reason)}`, candidate.values);
            expect(scriptPlaceholders(text), `${candidate.topic}: ${text}`).toEqual([]);
            expect(text, candidate.topic).not.toMatch(/undefined|NaN|\{|\}/);
          }
        for (const value of Object.values(candidate.values))
          expect(String(value).length, candidate.topic).toBeGreaterThan(0);
        // a story with a name is about a fellow player, never glued to the demo player
        expect(candidate.player != null, candidate.topic).toBe(
          (topic.slots as readonly string[]).includes("name") || candidate.topic === "cardSale",
        );
      }
    }
  });

  it("works without friends and without stocks", () => {
    const candidates = demoTopicCandidates({ players: [], stocks: [], random: seeded(3) });
    expect(candidates.length).toBe(Object.keys(NEWS_TOPICS).length);
    expect(candidates.find((c) => c.topic === "pTradeLoss")!.values.stock).toBeTruthy();
  });

  it("a demo show draws topics.count stories from different groups and rotates", () => {
    const rng = seeded(11);
    let last: string[] = [];
    const seen = new Set<string>();
    for (let show = 0; show < 30; show++) {
      const picks = pickTopics(demoTopicCandidates({ players: [], stocks: ["A"], random: rng }), last, rng);
      expect(picks.length).toBe(BALANCE.newsShow.topics.count);
      expect(new Set(picks.map((p) => NEWS_TOPICS[p.topic as NewsTopicKey].group)).size).toBe(picks.length);
      for (const pick of picks) expect(last, `show ${show}`).not.toContain(pick.topic);
      last = picks.map((p) => p.topic);
      for (const topic of last) seen.add(topic);
    }
    // variety: most of the topics came up within 30 shows
    expect(seen.size).toBeGreaterThan(30);
  });
});
