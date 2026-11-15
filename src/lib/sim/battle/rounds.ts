/**
 * The round games of the news battles (ADR-160): Börsenquiz, Schätz den Kurs and Die Glocke. The server keeps the
 * answers secret and judges every answer with its own clock (public.battle_rounds_state); this is the same judging
 * for the demo and the tests. Pure: answers and their times come in.
 */
import type { BellParams, EstimateParams, QuizParams } from "../../../config/battles.ts";
import { ALIVE_KEY, rankByKeys } from "./core.ts";

export interface RoundAnswer {
  slot: number;
  /** Quiz: the option 0..3. */
  choice?: number;
  /** Estimate: the guess. */
  value?: number;
  /**
   * Quiz/estimate: ms after the round opened. Bell: the reaction in ms from the bell (negative: pressed too early).
   */
  ms: number;
}

export interface RoundResult {
  round: number;
  answers: { slot: number; choice?: number; value?: number; ms: number; points: number; right: boolean }[];
  /** Slots that lost a heart this round. */
  lost: number[];
}

export interface RoundsState {
  hearts: number[];
  points: number[];
  /** Quiz and bell: summed answer time, estimate: summed error in basis points (lower is better). */
  time: number[];
  /** -1 still in, else the round the player went out in. */
  out: number[];
  results: RoundResult[];
  done: boolean;
}

const alive = (s: RoundsState) => s.out.flatMap((o, i) => (o < 0 ? [i] : []));

function start(n: number, hearts: number): RoundsState {
  return {
    hearts: Array<number>(n).fill(hearts),
    points: Array<number>(n).fill(0),
    time: Array<number>(n).fill(0),
    out: Array<number>(n).fill(-1),
    results: [],
    done: false,
  };
}

/** Players who left before round r ended are out in round r. */
function applyLeft(s: RoundsState, left: readonly number[], round: number): void {
  for (let i = 0; i < s.out.length; i++) if (s.out[i]! < 0 && left[i]! >= 0 && left[i]! <= round) s.out[i] = round;
}

/** The losers lose a heart, unless that would be everyone still in. */
function loseHearts(s: RoundsState, losers: number[], round: number): number[] {
  const inGame = alive(s);
  if (losers.length === 0 || losers.length >= inGame.length) return [];
  for (const i of losers) {
    s.hearts[i]! -= 1;
    if (s.hearts[i]! <= 0) s.out[i] = round;
  }
  return losers;
}

// ---------------------------------------------------------------- Börsenquiz

export function quizTimes(
  startMs: number,
  round: number,
  g: QuizParams,
): { opens: number; closes: number; ends: number } {
  const opens = startMs + round * (g.answerMs + g.revealMs);
  return { opens, closes: opens + g.answerMs, ends: opens + g.answerMs + g.revealMs };
}

export function quizPoints(ms: number, g: QuizParams): number {
  const left = Math.max(0, Math.min(g.answerMs, g.answerMs - ms));
  return g.basePoints + Math.floor((g.speedPoints * left) / g.answerMs);
}

/**
 * Judges the first `closed` rounds. `correct[r]` is the right option of round r, `answers[r]` the first answer of
 * every player in it, `left[i]` the round a player left in (-1: still there).
 */
export function quizEval(
  n: number,
  correct: readonly number[],
  answers: readonly (readonly RoundAnswer[])[],
  left: readonly number[],
  closed: number,
  g: QuizParams,
): RoundsState {
  const s = start(n, g.hearts);
  for (let r = 0; r < Math.min(closed, g.rounds) && !s.done; r++) {
    applyLeft(s, left, r);
    const inGame = alive(s);
    const result: RoundResult = { round: r, answers: [], lost: [] };
    const losers: number[] = [];
    for (const i of inGame) {
      const a = answers[r]?.find((x) => x.slot === i);
      const right = a !== undefined && a.choice === correct[r];
      const points = right ? quizPoints(a.ms, g) : 0;
      s.points[i]! += points;
      s.time[i]! += a ? Math.min(g.answerMs, Math.max(0, a.ms)) : g.answerMs;
      if (a) result.answers.push({ slot: i, choice: a.choice, ms: a.ms, points, right });
      if (!right) losers.push(i);
    }
    result.lost = loseHearts(s, losers, r);
    s.results.push(result);
    if (alive(s).length <= 1 || r === g.rounds - 1) s.done = true;
  }
  if (alive(s).length <= 1) s.done = true;
  return s;
}

export function quizRanking(seed: number, s: RoundsState): number[] {
  return rankByKeys(seed, s.out.length, (i) => [
    s.out[i]! < 0 ? ALIVE_KEY : s.out[i]!,
    s.hearts[i]!,
    s.points[i]!,
    -s.time[i]!,
  ]);
}

// ---------------------------------------------------------------- Schätz den Kurs

export function estimateTimes(
  startMs: number,
  round: number,
  g: EstimateParams,
): { opens: number; closes: number; ends: number } {
  const opens = startMs + round * (g.answerMs + g.revealMs);
  return { opens, closes: opens + g.answerMs, ends: opens + g.answerMs + g.revealMs };
}

/** Error of a guess in basis points of the true value, capped at 1 000 000 (100 times off). */
export function errorBps(value: number, truth: number): number {
  if (truth === 0) return value === 0 ? 0 : 1_000_000;
  return Math.min(1_000_000, Math.floor((Math.abs(value - truth) * 10_000) / Math.abs(truth)));
}

export function estimateEval(
  n: number,
  truths: readonly number[],
  answers: readonly (readonly RoundAnswer[])[],
  left: readonly number[],
  closed: number,
  g: EstimateParams,
): RoundsState {
  const s = start(n, 1);
  const rounds = Math.min(truths.length, g.rounds);
  for (let r = 0; r < Math.min(closed, rounds) && !s.done; r++) {
    applyLeft(s, left, r);
    const inGame = alive(s);
    const given = inGame
      .map((i) => ({ i, a: answers[r]?.find((x) => x.slot === i) }))
      .filter((x): x is { i: number; a: RoundAnswer } => x.a?.value !== undefined)
      .map((x) => ({ ...x, err: errorBps(x.a.value!, truths[r]!) }))
      .sort((a, b) => a.err - b.err || a.a.ms - b.a.ms || a.i - b.i);
    const factor = r === rounds - 1 ? g.lastRoundFactor : 1;
    const result: RoundResult = { round: r, answers: [], lost: [] };
    given.forEach(({ i, a, err }, rank) => {
      const bull = err <= g.bullseyeBps;
      const points = (given.length - rank + (bull ? g.bullseyeBonus : 0)) * factor;
      s.points[i]! += points;
      s.time[i]! += err;
      result.answers.push({ slot: i, value: a.value, ms: a.ms, points, right: bull });
    });
    for (const i of inGame) if (!given.some((x) => x.i === i)) s.time[i]! += 1_000_000;
    s.results.push(result);
    if (alive(s).length <= 1 || r === rounds - 1) s.done = true;
  }
  if (alive(s).length <= 1) s.done = true;
  return s;
}

export function estimateRanking(seed: number, s: RoundsState): number[] {
  return rankByKeys(seed, s.out.length, (i) => [s.out[i]! < 0 ? 1 : 0, s.points[i]!, -s.time[i]!]);
}

// ---------------------------------------------------------------- Die Glocke

export const bellRoundMs = (g: BellParams): number => g.readyMs + g.waitMaxMs + g.windowMs + g.resultMs;

export function bellTimes(
  startMs: number,
  round: number,
  waitMs: number,
  g: BellParams,
): { slot: number; bell: number; closes: number; ends: number } {
  const slot = startMs + round * bellRoundMs(g);
  const bell = slot + g.readyMs + waitMs;
  return { slot, bell, closes: bell + g.windowMs, ends: slot + bellRoundMs(g) };
}

export const bellHearts = (n: number, g: BellParams): number => (n <= g.smallGroup ? g.heartsSmall : g.heartsLarge);

/** answers[r]: ms = reaction from the bell (negative = false start); a press after the window does not count. */
export function bellEval(
  seed: number,
  n: number,
  answers: readonly (readonly RoundAnswer[])[],
  left: readonly number[],
  closed: number,
  g: BellParams,
): RoundsState {
  const s = start(n, bellHearts(n, g));
  for (let r = 0; r < Math.min(closed, g.maxRounds) && !s.done; r++) {
    applyLeft(s, left, r);
    const inGame = alive(s);
    const result: RoundResult = { round: r, answers: [], lost: [] };
    const losers: number[] = [];
    const valid: { i: number; ms: number }[] = [];
    for (const i of inGame) {
      const a = answers[r]?.find((x) => x.slot === i);
      if (!a || a.ms > g.windowMs) {
        losers.push(i);
        s.time[i]! += g.windowMs;
        continue;
      }
      const early = a.ms < 0;
      result.answers.push({ slot: i, ms: a.ms, points: 0, right: !early });
      if (early) {
        losers.push(i);
        s.time[i]! += g.windowMs;
      } else {
        valid.push({ i, ms: a.ms });
        s.time[i]! += a.ms;
      }
    }
    if (losers.length === 0 && valid.length > 1) {
      const lot = (i: number) => rankByKeys(seed, n, () => []).indexOf(i);
      valid.sort((a, b) => b.ms - a.ms || lot(b.i) - lot(a.i));
      const slowest = Math.min(inGame.length > g.smallGroup ? 2 : 1, valid.length - 1);
      for (const v of valid.slice(0, slowest)) losers.push(v.i);
    }
    result.lost = loseHearts(s, losers, r);
    s.results.push(result);
    if (alive(s).length <= 1 || r === g.maxRounds - 1) s.done = true;
  }
  if (alive(s).length <= 1) s.done = true;
  return s;
}

export function bellRanking(seed: number, s: RoundsState): number[] {
  return rankByKeys(seed, s.out.length, (i) => [s.out[i]! < 0 ? ALIVE_KEY : s.out[i]!, s.hearts[i]!, -s.time[i]!]);
}
