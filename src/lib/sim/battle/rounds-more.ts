/**
 * The round games of the addendum to ADR-160: Tresorknacker, Ticker-Tippen, Mehr oder Weniger and Wer bietet mehr?.
 * As in rounds.ts the server keeps the solutions secret and judges every answer with its own clock
 * (public.battle_rounds_eval_more in supabase/migrations/20261204004910_more_battle_games.sql); this is the same
 * judging for the demo and the tests. Pure: answers and their times come in.
 */
import type { AuctionParams, HigherParams, TickerParams, VaultParams } from "../../../config/battles.ts";
import { ALIVE_KEY, rankByKeys } from "./core.ts";
import type { RoundAnswer, RoundResult, RoundsState } from "./rounds.ts";

/** All four follow the quiz timing: the answer time, then the reveal. */
export function roundTimes(
  startMs: number,
  round: number,
  g: { answerMs: number; revealMs: number },
): { opens: number; closes: number; ends: number } {
  const opens = startMs + round * (g.answerMs + g.revealMs);
  return { opens, closes: opens + g.answerMs, ends: opens + g.answerMs + g.revealMs };
}

/** Points for a fast answer: base + speed × the share of the answer time left. */
export function speedPoints(ms: number, answerMs: number, base: number, speed: number): number {
  const left = Math.max(0, Math.min(answerMs, answerMs - ms));
  return base + Math.floor((speed * left) / answerMs);
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

function applyLeft(s: RoundsState, left: readonly number[], round: number): void {
  for (let i = 0; i < s.out.length; i++) if (s.out[i]! < 0 && left[i]! >= 0 && left[i]! <= round) s.out[i] = round;
}

/** Ranking of the games without hearts: still in, points, then the less time. */
export function pointsRanking(seed: number, s: RoundsState): number[] {
  return rankByKeys(seed, s.out.length, (i) => [s.out[i]! < 0 ? 1 : 0, s.points[i]!, -s.time[i]!]);
}

// ---------------------------------------------------------------- Tresorknacker

/** A try at code `code`: digits in the right place, right digits in the wrong place. */
export function vaultFeedback(code: string, guess: string): { hits: number; near: number } {
  let hits = 0;
  let near = 0;
  for (let k = 0; k < guess.length; k++) {
    if (guess[k] === code[k]) hits++;
    else if (code.includes(guess[k]!)) near++;
  }
  return { hits, near };
}

/** A try is `digits` different digits 1..symbols. */
export function vaultValid(guess: string, g: VaultParams): boolean {
  if (guess.length !== g.digits) return false;
  const seen = new Set<string>();
  for (const ch of guess) {
    const d = ch.charCodeAt(0) - 48;
    if (d < 1 || d > g.symbols || seen.has(ch)) return false;
    seen.add(ch);
  }
  return true;
}

export interface VaultTry {
  slot: number;
  code: string;
  /** ms after the round opened. */
  ms: number;
}

export const vaultPoints = (ms: number, tries: number, g: VaultParams): number =>
  speedPoints(ms, g.answerMs, g.basePoints, g.speedPoints) + g.tryBonus * Math.max(0, g.maxTries - tries);

/** tries[r]: every valid try in round r in the order the server got them (only the first maxTries count). */
export function vaultEval(
  n: number,
  codes: readonly string[],
  tries: readonly (readonly VaultTry[])[],
  left: readonly number[],
  closed: number,
  g: VaultParams,
): RoundsState {
  const s = start(n, 1);
  const rounds = Math.min(codes.length, g.rounds);
  for (let r = 0; r < Math.min(closed, rounds) && !s.done; r++) {
    applyLeft(s, left, r);
    const result: RoundResult = { round: r, answers: [], lost: [] };
    for (const i of alive(s)) {
      const mine = (tries[r] ?? []).filter((x) => x.slot === i).slice(0, g.maxTries);
      const k = mine.findIndex((x) => x.code === codes[r]);
      const cracked = k >= 0;
      const points = cracked ? vaultPoints(mine[k]!.ms, k + 1, g) : 0;
      s.points[i]! += points;
      s.time[i]! += cracked ? Math.min(g.answerMs, Math.max(0, mine[k]!.ms)) : g.answerMs;
      if (mine.length > 0)
        result.answers.push({
          slot: i,
          choice: cracked ? k + 1 : mine.length,
          ms: cracked ? mine[k]!.ms : mine.at(-1)!.ms,
          points,
          right: cracked,
        });
    }
    s.results.push(result);
    if (alive(s).length <= 1 || r === rounds - 1) s.done = true;
  }
  if (alive(s).length <= 1) s.done = true;
  return s;
}

// ---------------------------------------------------------------- Ticker-Tippen

/** answers[r]: the first tap of every player (choice = the option). A wrong tap costs wrongPoints. */
export function tickerEval(
  n: number,
  correct: readonly number[],
  answers: readonly (readonly RoundAnswer[])[],
  left: readonly number[],
  closed: number,
  g: TickerParams,
): RoundsState {
  const s = start(n, 1);
  const rounds = Math.min(correct.length, g.rounds);
  for (let r = 0; r < Math.min(closed, rounds) && !s.done; r++) {
    applyLeft(s, left, r);
    const result: RoundResult = { round: r, answers: [], lost: [] };
    for (const i of alive(s)) {
      const a = answers[r]?.find((x) => x.slot === i);
      if (!a) {
        s.time[i]! += g.answerMs;
        continue;
      }
      const right = a.choice === correct[r];
      const points = right ? speedPoints(a.ms, g.answerMs, g.basePoints, g.speedPoints) : -g.wrongPoints;
      s.points[i]! += points;
      s.time[i]! += right ? Math.min(g.answerMs, Math.max(0, a.ms)) : g.answerMs;
      result.answers.push({ slot: i, choice: a.choice, ms: a.ms, points, right });
    }
    s.results.push(result);
    if (alive(s).length <= 1 || r === rounds - 1) s.done = true;
  }
  if (alive(s).length <= 1) s.done = true;
  return s;
}

// ---------------------------------------------------------------- Mehr oder Weniger

export const higherHearts = (n: number, g: HigherParams): number => (n <= g.smallGroup ? g.heartsSmall : g.heartsLarge);

/** choice 0 = higher, 1 = lower. Wrong or none costs a heart, unless that would be everyone still in. */
export function higherEval(
  n: number,
  correct: readonly number[],
  answers: readonly (readonly RoundAnswer[])[],
  left: readonly number[],
  closed: number,
  g: HigherParams,
): RoundsState {
  const s = start(n, higherHearts(n, g));
  const rounds = Math.min(correct.length, g.rounds);
  for (let r = 0; r < Math.min(closed, rounds) && !s.done; r++) {
    applyLeft(s, left, r);
    const inGame = alive(s);
    const result: RoundResult = { round: r, answers: [], lost: [] };
    const losers: number[] = [];
    for (const i of inGame) {
      const a = answers[r]?.find((x) => x.slot === i);
      const right = a !== undefined && a.choice === correct[r];
      const points = right ? speedPoints(a.ms, g.answerMs, g.basePoints, g.speedPoints) : 0;
      s.points[i]! += points;
      s.time[i]! += a ? Math.min(g.answerMs, Math.max(0, a.ms)) : g.answerMs;
      if (a) result.answers.push({ slot: i, choice: a.choice, ms: a.ms, points, right });
      if (!right) losers.push(i);
    }
    if (losers.length > 0 && losers.length < inGame.length) {
      for (const i of losers) {
        s.hearts[i]! -= 1;
        if (s.hearts[i]! <= 0) s.out[i] = r;
      }
      result.lost = losers;
    }
    s.results.push(result);
    if (alive(s).length <= 1 || r === rounds - 1) s.done = true;
  }
  if (alive(s).length <= 1) s.done = true;
  return s;
}

export function higherRanking(seed: number, s: RoundsState): number[] {
  return rankByKeys(seed, s.out.length, (i) => [
    s.out[i]! < 0 ? ALIVE_KEY : s.out[i]!,
    s.hearts[i]!,
    s.points[i]!,
    -s.time[i]!,
  ]);
}

/**
 * A chart with trends for Mehr oder Weniger: prices in cents, `count` of them. A move goes on in the same direction
 * with trendPct %, by moveMinBps..moveMaxBps; it never stays flat.
 */
export function higherSeries(count: number, g: HigherParams, random: () => number): number[] {
  const out: number[] = [Math.round(5_000 + random() * 15_000)];
  let dir = random() < 0.5 ? 1 : -1;
  while (out.length < count) {
    if (random() * 100 >= g.trendPct) dir = -dir;
    const bps = g.moveMinBps + Math.floor(random() * (g.moveMaxBps - g.moveMinBps + 1));
    const last = out.at(-1)!;
    const move = Math.max(1, Math.round((last * bps) / 10_000));
    let next = last + dir * move;
    if (next < 100) {
      dir = 1;
      next = last + move;
    }
    out.push(next);
  }
  return out;
}

// ---------------------------------------------------------------- Wer bietet mehr?

export interface AuctionState extends RoundsState {
  /** Play money left per player. */
  budget: number[];
}

/**
 * answers[r]: the first bid of every player (value, whole play money). The highest bid above zero wins the item's
 * points and pays the bid; at a draw the earlier bid, then the lot. A bid above what is left does not count.
 */
export function auctionEval(
  seed: number,
  n: number,
  items: readonly number[],
  answers: readonly (readonly RoundAnswer[])[],
  left: readonly number[],
  closed: number,
  g: AuctionParams,
): AuctionState {
  const s: AuctionState = { ...start(n, 1), budget: Array<number>(n).fill(g.budget) };
  const rounds = Math.min(items.length, g.rounds);
  const lot = rankByKeys(seed, n, () => []);
  for (let r = 0; r < Math.min(closed, rounds) && !s.done; r++) {
    applyLeft(s, left, r);
    const result: RoundResult = { round: r, answers: [], lost: [] };
    const bids = alive(s)
      .map((i) => ({ i, a: answers[r]?.find((x) => x.slot === i) }))
      .filter((x): x is { i: number; a: RoundAnswer } => x.a?.value !== undefined)
      .filter((x) => x.a.value! >= 0 && x.a.value! <= s.budget[x.i]!);
    const ranked = [...bids].sort(
      (a, b) => b.a.value! - a.a.value! || a.a.ms - b.a.ms || lot.indexOf(a.i) - lot.indexOf(b.i),
    );
    const winner = ranked[0] && ranked[0].a.value! > 0 ? ranked[0] : null;
    for (const { i, a } of ranked) {
      const won = winner?.i === i;
      if (won) {
        s.points[i]! += items[r]!;
        s.budget[i]! -= a.value!;
      }
      s.time[i]! += Math.min(g.answerMs, Math.max(0, a.ms));
      result.answers.push({ slot: i, value: a.value, ms: a.ms, points: won ? items[r]! : 0, right: won });
    }
    s.results.push(result);
    if (alive(s).length <= 1 || r === rounds - 1) s.done = true;
  }
  if (alive(s).length <= 1) s.done = true;
  return s;
}

/** Most points, then the most play money left, then the less time. */
export function auctionRanking(seed: number, s: AuctionState): number[] {
  return rankByKeys(seed, s.out.length, (i) => [s.out[i]! < 0 ? 1 : 0, s.points[i]!, s.budget[i]!, -s.time[i]!]);
}
