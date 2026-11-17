import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { detectIntent, nftCounterCents, nftOfferPath, normalizeChat, pickLine } from "./nft-talk.ts";
import { nftAiValueCents, nftFairCents, nftLowballCents, nftQualityChanceBps, nftQualityValueBps } from "./nfts.ts";

const talk = BALANCE.nfts.ai.talk;
const base = { lastSaleCents: null, mintCents: 1_000_000, likes: 0, creatorSales: 0, ageDays: 0 };

describe("chat intents (ADR-181)", () => {
  it("normalizes case, punctuation and question marks", () => {
    expect(normalizeChat("Echt?! NEIN.")).toBe(" echt ? nein ");
  });

  it.each([
    ["Ja, gerne!", "yes"],
    ["ok deal", "yes"],
    ["Nein danke", "no"],
    ["nö", "no"],
    ["Das ist zu wenig, leg was drauf", "higher"],
    ["Nein, ich will mehr", "higher"],
    ["Geht es auch billiger?", "lower"],
    ["Du Idiot", "insult"],
    ["Warum willst du das?", "question"],
    ["Wie viel?", "question"],
    ["Schönes Wetter heute", "other"],
    ["Jahrmarkt", "other"],
  ] as const)("%s -> %s", (text, intent) => {
    expect(detectIntent(text)).toBe(intent);
  });
});

describe("line picking", () => {
  const lines = ["a", "b", "c", "d"];
  it("picks by u and skips recent lines", () => {
    expect(pickLine(lines, 0)).toBe("a");
    expect(pickLine(lines, 0.99)).toBe("d");
    expect(pickLine(lines, 0, ["a"])).toBe("b");
    expect(pickLine(lines, 0.99, ["d", "a"])).toBe("b");
    expect(pickLine(lines, 0.5, lines)).toBe("c");
    expect(pickLine([], 0.5)).toBe("");
  });

  it("never repeats one of the last lines in a long conversation", () => {
    const all = talk.lines.followup;
    const said: string[] = [];
    for (let i = 0; i < 60; i++) {
      const recent = said.slice(-talk.recentLines);
      const line = pickLine(all, ((i * 7919) % 1000) / 1000, recent);
      expect(recent).not.toContain(line);
      said.push(line);
    }
  });

  it("has plenty of lines, short enough for the chat", () => {
    const flat = (o: unknown): string[] =>
      Array.isArray(o) ? (o as string[]) : o && typeof o === "object" ? Object.values(o).flatMap(flat) : [];
    const all = [...flat(talk.lines), ...flat(talk.personas)];
    expect(all.length).toBeGreaterThanOrEqual(120);
    expect(new Set(all).size).toBe(all.length);
    for (const l of all) expect(l.length).toBeLessThanOrEqual(BALANCE.nfts.chat.maxLength);
    for (const name of BALANCE.nfts.ai.collectors)
      expect(talk.personas[name as keyof typeof talk.personas]).toBeTruthy();
  });
});

describe("offer texts follow the critic", () => {
  it("mocks poor art and copies, praises great art, comments in between", () => {
    expect(nftOfferPath(80, "exact", "harmony", 100, "outline", 40, 0.1)).toBe("copy");
    expect(nftOfferPath(20, null, "harmony", 100, "outline", 40, 0.1)).toBe("mock");
    expect(nftOfferPath(90, null, "harmony", 100, "outline", 40, 0.1)).toBe("praise");
    expect(nftOfferPath(90, null, "harmony", 100, "outline", 40, 0.7)).toBe("good.harmony");
    expect(nftOfferPath(60, null, "harmony", 100, "outline", 40, 0.1)).toBe("bad.outline");
    expect(nftOfferPath(60, null, "harmony", 100, "outline", 40, 0.5)).toBe("good.harmony");
    expect(nftOfferPath(60, null, "harmony", 100, "outline", 40, 0.9)).toBe("offer");
    expect(nftOfferPath(null, null, null, 0, null, 0, 0.1)).toBe("offer");
  });
});

describe("quality in the collectors' money (ADR-181)", () => {
  it("scales the valuation anchor from 60 % to 140 %, neutral at 50", () => {
    expect(nftQualityValueBps(null)).toBe(10_000);
    expect(nftQualityValueBps(0)).toBe(6_000);
    expect(nftQualityValueBps(100)).toBe(14_000);
    expect(nftAiValueCents({ ...base, quality: 90 })).toBe(1_320_000);
    expect(nftAiValueCents({ ...base, quality: 10 })).toBe(680_000);
    expect(nftAiValueCents(base)).toBe(1_000_000);
    // the last price is not scaled, so the factor never compounds
    expect(nftAiValueCents({ ...base, lastSaleCents: 2_000_000, quality: 100 })).toBe(2_000_000);
    expect(nftFairCents({ ...base, quality: 100 })).toBe(1_400_000);
  });

  it("makes offers and purchases more likely for good art, none for junk", () => {
    expect(nftQualityChanceBps(1_000, null)).toBe(1_100);
    expect(nftQualityChanceBps(1_000, 90)).toBe(1_820);
    expect(nftQualityChanceBps(1_000, 20)).toBe(560);
    expect(nftQualityChanceBps(1_000, 9)).toBe(0);
  });

  it("shifts lowball offers with the score", () => {
    expect(nftLowballCents(1_000_000, 0)).toBe(650_000);
    expect(nftLowballCents(1_000_000, 0, BALANCE.nfts, 100)).toBe(800_000);
    expect(nftLowballCents(1_000_000, 0, BALANCE.nfts, 0)).toBe(500_000);
    expect(nftLowballCents(1_000_000, 0, BALANCE.nfts, 33)).toBe(599_000);
    expect(nftLowballCents(1_000_000, 0.999, BALANCE.nfts, 100)).toBe(1_000_000);
  });

  it("raises a haggled offer step by step up to the ceiling", () => {
    expect(nftCounterCents(700_000, 1_000_000)).toBe(756_000);
    expect(nftCounterCents(900_000, 1_000_000)).toBe(950_000);
    expect(nftCounterCents(950_000, 1_000_000)).toBeNull();
  });
});
