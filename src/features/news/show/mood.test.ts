import { describe, expect, it } from "vitest";
import { ANCHOR_MOODS } from "@/components/pixel/news-art";
import { MOOD_REACTION, defaultMood, isAnchorMood, segmentMood, speechDelayMs, type MoodSource } from "./mood";

const gain = { tone: "gain" } as const;
const loss = { tone: "loss" } as const;
const neutral = { tone: "neutral" } as const;
const story = (kind: string, ...effects: MoodSource["effects"][number][]): MoodSource => ({ kind, effects });

describe("the anchor's moods", () => {
  it("greets and says goodbye with a straight face", () => {
    expect(defaultMood(story("intro"))).toBe("neutral");
    expect(defaultMood(story("outro", gain))).toBe("neutral");
  });

  it("has a face for the kinds that are about a player or a company", () => {
    expect(defaultMood(story("loser", loss, loss))).toBe("smug");
    expect(defaultMood(story("winner", gain))).toBe("proud");
    expect(defaultMood(story("scandal", loss, loss, gain))).toBe("shocked");
    expect(defaultMood(story("hype", gain, gain))).toBe("laughing");
    expect(defaultMood(story("gossip", neutral))).toBe("smug");
    expect(defaultMood(story("ramble"))).toBe("confused");
  });

  it("reads market news by what the effects add up to", () => {
    expect(defaultMood(story("stock"))).toBe("neutral");
    expect(defaultMood(story("stock", neutral))).toBe("neutral");
    expect(defaultMood(story("stock", gain))).toBe("proud");
    expect(defaultMood(story("stock", loss))).toBe("shocked");
    expect(defaultMood(story("stock", loss, gain))).toBe("confused");
    expect(defaultMood(story("sector", loss))).toBe("angry");
    expect(defaultMood(story("tasks", loss, neutral))).toBe("angry");
    expect(defaultMood(story("world", gain))).toBe("laughing");
    expect(defaultMood(story("crypto", loss))).toBe("crying");
    expect(defaultMood(story("crypto"))).toBe("confused");
    expect(defaultMood(story("nft", gain))).toBe("smug");
    expect(defaultMood(story("nft", loss))).toBe("crying");
  });

  it("judges kinds it does not know by their effects alone", () => {
    expect(defaultMood(story("weather"))).toBe("neutral");
    expect(defaultMood(story("weather", gain))).toBe("proud");
    expect(defaultMood(story("weather", loss))).toBe("shocked");
    expect(defaultMood(story("weather", gain, loss))).toBe("confused");
    // Names of Object.prototype are not kinds.
    expect(defaultMood(story("constructor", loss))).toBe("shocked");
    expect(defaultMood(story("toString"))).toBe("neutral");
  });

  it("only ever answers with a known mood", () => {
    const kinds = ["intro", "loser", "winner", "scandal", "hype", "stock", "sector", "world", "tasks", "crypto"];
    for (const kind of [...kinds, "nft", "gossip", "ramble", "outro", "other"]) {
      for (const effects of [[], [gain], [loss], [gain, loss], [neutral]]) {
        expect(ANCHOR_MOODS).toContain(defaultMood({ kind, effects }));
      }
    }
  });

  it("takes the mood the server sends, and ignores one it does not know", () => {
    expect(segmentMood({ ...story("stock", gain), mood: "crying" })).toBe("crying");
    expect(segmentMood({ ...story("stock", gain), mood: "neutral" })).toBe("neutral");
    expect(segmentMood({ ...story("stock", gain), mood: "ecstatic" })).toBe("proud");
    expect(segmentMood({ ...story("stock", gain), mood: null })).toBe("proud");
    expect(segmentMood(story("stock", gain))).toBe("proud");
    // defaultMood itself never looks at the field.
    expect(defaultMood({ ...story("stock", gain), mood: "crying" } as MoodSource)).toBe("proud");
    expect(isAnchorMood("smug")).toBe(true);
    expect(isAnchorMood("Smug")).toBe(false);
    expect(isAnchorMood(undefined)).toBe(false);
  });

  it("lets him react before he reads, except with a straight face", () => {
    expect(MOOD_REACTION.startMs).toBeLessThan(MOOD_REACTION.endMs);
    // The reaction itself takes between 0.6 and 1 second.
    expect(MOOD_REACTION.endMs - MOOD_REACTION.startMs).toBeGreaterThanOrEqual(600);
    expect(MOOD_REACTION.endMs - MOOD_REACTION.startMs).toBeLessThanOrEqual(1000);
    expect(speechDelayMs("neutral")).toBe(0);
    for (const mood of ANCHOR_MOODS) {
      if (mood !== "neutral") expect(speechDelayMs(mood)).toBe(MOOD_REACTION.endMs);
    }
  });
});
