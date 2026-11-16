import { describe, expect, it } from "vitest";
import { INTERVIEW_QUESTIONS, INTERVIEW_RULES } from "../../config/interviews.ts";
import {
  fillInterview,
  interviewChancePerDayBps,
  interviewEffects,
  interviewPercent,
  judgeInterviewAnswer,
  pickInterviewQuestions,
  whenHolds,
  type InterviewFacts,
} from "./interviews.ts";

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

const garage: InterviewFacts = {
  tier: "garage",
  listed: false,
  profitCents: null,
  satisfaction: null,
  layoffs: 0,
  scandal: false,
  staff: 0,
  awarenessBps: 300,
};
const R = INTERVIEW_RULES;

describe("CEO interviews (ADR-173)", () => {
  it("the pool has keys once, three quick answers of every tone and enough questions for every situation", () => {
    expect(new Set(INTERVIEW_QUESTIONS.map((x) => x.key)).size).toBe(INTERVIEW_QUESTIONS.length);
    for (const x of INTERVIEW_QUESTIONS) {
      expect(x.quick.map((a) => a.tone).sort(), x.key).toEqual(["bad", "good", "ok"]);
      expect(x.text.length, x.key).toBeLessThan(160);
    }
    expect(INTERVIEW_QUESTIONS.filter((x) => x.when === "always").length).toBeGreaterThanOrEqual(R.count);
  });

  it("chance: bigger, listed and companies after an event are asked more often, capped", () => {
    const base = interviewChancePerDayBps(garage);
    expect(base).toBe(R.chancePerDayBps);
    expect(interviewChancePerDayBps({ ...garage, tier: "ag" })).toBe(base + R.tierBonusBps.ag);
    expect(interviewChancePerDayBps({ ...garage, listed: true })).toBe(base + R.listedBonusBps);
    expect(interviewChancePerDayBps({ ...garage, scandal: true })).toBe(base + R.eventBonusBps);
    expect(interviewChancePerDayBps({ ...garage, profitCents: -5 })).toBe(base + R.eventBonusBps);
    expect(interviewChancePerDayBps({ ...garage, tier: "ag", listed: true, scandal: true })).toBe(R.maxChancePerDayBps);
  });

  it("questions fit the situation: at most maxSituational situational ones, never twice, never unfitting", () => {
    const listedLoss: InterviewFacts = {
      ...garage,
      tier: "ag",
      listed: true,
      profitCents: -100_00,
      satisfaction: 30,
      layoffs: 2,
      scandal: true,
      staff: 12,
    };
    const rng = seeded(4);
    for (let k = 0; k < 50; k++) {
      const qs = pickInterviewQuestions(listedLoss, rng);
      expect(qs).toHaveLength(R.count);
      expect(new Set(qs.map((x) => x.key)).size).toBe(R.count);
      expect(qs.filter((x) => x.when !== "always").length).toBe(R.maxSituational);
      for (const x of qs) expect(whenHolds(x.when, listedLoss), x.key).toBe(true);
    }
    const plain = pickInterviewQuestions(garage, seeded(9));
    for (const x of plain) expect(["always", "small", "solo", "unknown"]).toContain(x.when);
    expect(whenHolds("profit", garage)).toBe(false);
    expect(whenHolds("happy", { ...garage, satisfaction: 80 })).toBe(true);
  });

  it("Mini-KI: quick answers by tone, free text by good and bad words and length, empty is none", () => {
    const question = INTERVIEW_QUESTIONS.find((x) => x.key === "scandal")!;
    expect(judgeInterviewAnswer(question, { quick: 0 })).toMatchObject({ verdict: "good", points: 1 });
    expect(judgeInterviewAnswer(question, { quick: 1 })).toMatchObject({ verdict: "ok", points: 0 });
    expect(judgeInterviewAnswer(question, { quick: 2 })).toMatchObject({ verdict: "bad", points: -1 });
    expect(
      judgeInterviewAnswer(question, {
        text: "Wir entschuldigen uns bei allen Kunden und klären alles transparent auf, Schritt für Schritt.",
      }),
    ).toMatchObject({ verdict: "good", points: 2 });
    expect(judgeInterviewAnswer(question, { text: "Kein Kommentar, ist mir egal." })).toMatchObject({
      verdict: "bad",
      points: -2,
    });
    expect(judgeInterviewAnswer(question, { text: "Mal sehen." })).toMatchObject({ verdict: "ok", points: 0 });
    expect(judgeInterviewAnswer(question, { text: "Nö" })).toMatchObject({ verdict: "bad", points: -1 });
    expect(judgeInterviewAnswer(question, { text: " " })).toMatchObject({
      verdict: "none",
      points: R.judge.nonePoints,
    });
    // a quick index that does not exist falls back to the text
    expect(judgeInterviewAnswer(question, { quick: 7, text: "" }).verdict).toBe("none");
  });

  it("effects are capped; declining costs a little, ignoring a bit more; reputation only for listed", () => {
    const e = R.effects;
    expect(interviewEffects({ kind: "answered", points: 6 }, false)).toEqual({
      awarenessBps: Math.min(6 * e.awarenessPerPointBps, e.maxAwarenessBps),
      reputation: 0,
    });
    expect(interviewEffects({ kind: "answered", points: 99 }, true)).toEqual({
      awarenessBps: e.maxAwarenessBps,
      reputation: e.maxReputation,
    });
    expect(interviewEffects({ kind: "answered", points: -99 }, true)).toEqual({
      awarenessBps: -e.maxAwarenessBps,
      reputation: -e.maxReputation,
    });
    expect(interviewEffects({ kind: "declined" }, true)).toEqual({
      awarenessBps: e.declineAwarenessBps,
      reputation: e.declineReputation,
    });
    expect(interviewEffects({ kind: "expired" }, false).awarenessBps).toBeLessThan(e.declineAwarenessBps);
  });

  it("fills placeholders and formats the effect", () => {
    expect(fillInterview("{ceo} von {company} {x}", { ceo: "Mia", company: "Kiosk" })).toBe("Mia von Kiosk {x}");
    expect(interviewPercent(150)).toBe("+1,5 %");
    expect(interviewPercent(-200)).toBe("−2 %");
  });
});
