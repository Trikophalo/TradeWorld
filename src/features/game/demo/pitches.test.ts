import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { miniJudge, pitchChanceBps } from "./pitches";

describe("own strategies (ADR-132)", () => {
  it("the Mini-KI rates a fitting answer higher and warns of PR stunts", () => {
    const fair = miniJudge("Wir zahlen mehr Lohn, verhandeln einen Tarif und hören dem Team zu.", "strike");
    const film = miniJudge("Ich mache einen Imagefilm.", "strike");
    expect(fair.fit).toBeGreaterThan(film.fit);
    expect(film.backfire).toBeGreaterThan(fair.backfire);
    expect(film.risky).toBe(1);
  });

  it("chance grows with the fit and stays below the maximum", () => {
    expect(pitchChanceBps(0)).toBe(BALANCE.pitches.chanceBaseBps);
    expect(pitchChanceBps(50)).toBe(5_000);
    expect(pitchChanceBps(90)).toBe(8_200);
    expect(pitchChanceBps(100)).toBe(BALANCE.pitches.maxChanceBps);
  });

  it("every crisis, chance and move goal has keywords for the Mini-KI", () => {
    const topics = [...BALANCE.companyEvents.archetypes.map((a) => a.key), "cash", "awareness", "quality"];
    for (const topic of topics) expect(BALANCE.pitches.mini.good[topic]?.length ?? 0, topic).toBeGreaterThan(3);
  });
});
