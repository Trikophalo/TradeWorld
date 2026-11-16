/**
 * CEO interviews (ADR-173): who gets asked, which questions, how the Mini-KI judges the answers and what the whole
 * interview does to the company. Mirrors company_interview_*() in supabase/migrations/20261204006420_ceo_interviews.sql;
 * the server is the authority, this runs the demo. Pure: randomness comes in as `rng` (0 ≤ x < 1).
 */
import type { InterviewQuestionConfig, InterviewTone, InterviewWhen } from "../../config/interviews.ts";
import { INTERVIEW_QUESTIONS, INTERVIEW_RULES } from "../../config/interviews.ts";

type Rules = typeof INTERVIEW_RULES;

/** What the server knows about the company when it asks. */
export interface InterviewFacts {
  tier: "garage" | "small_business" | "gmbh" | "ag";
  listed: boolean;
  /** Operating profit of the last report, null without one. */
  profitCents: number | null;
  /** Mood of a listed company's staff, 0..100. */
  satisfaction: number | null;
  /** Dismissals in the last layoffHours. */
  layoffs: number;
  /** A scandal about the company in a show of the last scandalHours. */
  scandal: boolean;
  /** Employees (people, not AI). */
  staff: number;
  /** Awareness in bps (10 000 = 100 %). */
  awarenessBps: number;
}

export function whenHolds(when: InterviewWhen, f: InterviewFacts, rules: Rules = INTERVIEW_RULES): boolean {
  switch (when) {
    case "always":
      return true;
    case "profit":
      return f.profitCents !== null && f.profitCents > 0;
    case "loss":
      return f.profitCents !== null && f.profitCents < 0;
    case "listed":
      return f.listed;
    case "unhappy":
      return f.satisfaction !== null && f.satisfaction < rules.unhappyBelow;
    case "happy":
      return f.satisfaction !== null && f.satisfaction >= rules.happyFrom;
    case "layoffs":
      return f.layoffs > 0;
    case "scandal":
      return f.scandal;
    case "big":
      return f.tier === "gmbh" || f.tier === "ag";
    case "small":
      return f.tier === "garage" || f.tier === "small_business";
    case "solo":
      return f.staff === 0;
    case "famous":
      return f.awarenessBps >= rules.awarenessFamousBps;
    case "unknown":
      return f.awarenessBps < rules.awarenessUnknownBps;
  }
}

/** A notable event makes a request more likely: a scandal, layoffs or a loss. */
export function hasNotableEvent(f: InterviewFacts): boolean {
  return f.scandal || f.layoffs > 0 || (f.profitCents !== null && f.profitCents < 0);
}

/** Chance of a request per day in bps; the hourly job rolls a 24th of it. */
export function interviewChancePerDayBps(f: InterviewFacts, rules: Rules = INTERVIEW_RULES): number {
  const bps =
    rules.chancePerDayBps +
    rules.tierBonusBps[f.tier] +
    (f.listed ? rules.listedBonusBps : 0) +
    (hasNotableEvent(f) ? rules.eventBonusBps : 0);
  return Math.min(rules.maxChancePerDayBps, bps);
}

function shuffled<T>(list: readonly T[], rng: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The questions: up to maxSituational that fit the situation, the rest from "always"; never one twice. */
export function pickInterviewQuestions(
  f: InterviewFacts,
  rng: () => number,
  pool: readonly InterviewQuestionConfig[] = INTERVIEW_QUESTIONS,
  rules: Rules = INTERVIEW_RULES,
): InterviewQuestionConfig[] {
  const fitting = pool.filter((x) => x.when !== "always" && whenHolds(x.when, f, rules));
  const always = pool.filter((x) => x.when === "always");
  return [...shuffled(fitting, rng).slice(0, rules.maxSituational), ...shuffled(always, rng)].slice(0, rules.count);
}

/** Fills {name} placeholders; unknown ones stay. */
export function fillInterview(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (key in values ? String(values[key]) : all));
}

export type InterviewVerdict = InterviewTone | "none";

/** An answer: free text, or the index of a quick answer. */
export interface InterviewAnswerInput {
  text?: string | null;
  quick?: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The Mini-KI's judgement of one answer, points -2..+2: a quick answer counts by its tone; a free answer gains a
 * point per good word (general and the question's own, at most maxGood), loses one per bad word (at most maxBad),
 * gains one when it is long and loses one when it is very short. Empty: nonePoints.
 */
export function judgeInterviewAnswer(
  question: Pick<InterviewQuestionConfig, "quick" | "good">,
  answer: InterviewAnswerInput,
  rules: Rules = INTERVIEW_RULES,
): { verdict: InterviewVerdict; points: number; text: string } {
  const j = rules.judge;
  if (answer.quick != null && question.quick[answer.quick]) {
    const pick = question.quick[answer.quick]!;
    return { verdict: pick.tone, points: j.quickPoints[pick.tone], text: pick.text };
  }
  const text = (answer.text ?? "").trim().replace(/\s+/g, " ");
  if (text.length < rules.minChars) return { verdict: "none", points: j.nonePoints, text: "" };
  const lower = text.toLowerCase();
  const goodWords = new Set([...j.good, ...(question.good ?? [])]);
  const good = [...goodWords].filter((w) => lower.includes(w)).length;
  const bad = j.bad.filter((w) => lower.includes(w)).length;
  let points = Math.min(good, j.maxGood) - Math.min(bad, j.maxBad);
  if (text.length >= j.longChars) points += 1;
  if (text.length < j.shortChars) points -= 1;
  points = clamp(points, -2, 2);
  return { verdict: points >= 1 ? "good" : points <= -1 ? "bad" : "ok", points, text };
}

/** Effects of a finished interview, capped: awareness bps (100 = +1 point) and reputation (listed only). */
export function interviewEffects(
  outcome: { kind: "answered"; points: number } | { kind: "declined" } | { kind: "expired" },
  listed: boolean,
  rules: Rules = INTERVIEW_RULES,
): { awarenessBps: number; reputation: number } {
  const e = rules.effects;
  if (outcome.kind === "declined") {
    return { awarenessBps: e.declineAwarenessBps, reputation: listed ? e.declineReputation : 0 };
  }
  if (outcome.kind === "expired") {
    return { awarenessBps: e.ignoreAwarenessBps, reputation: listed ? e.ignoreReputation : 0 };
  }
  return {
    awarenessBps: clamp(outcome.points * e.awarenessPerPointBps, -e.maxAwarenessBps, e.maxAwarenessBps),
    reputation: listed ? clamp(outcome.points * e.reputationPerPoint, -e.maxReputation, e.maxReputation) : 0,
  };
}

/** "+1,2 %" for an awareness change in bps of the 0..1 scale (100 bps = 1 point). */
export function interviewPercent(bps: number): string {
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : "±";
  const v = (Math.abs(bps) / 100).toFixed(1).replace(".", ",").replace(/,0$/, "");
  return `${sign}${v} %`;
}
