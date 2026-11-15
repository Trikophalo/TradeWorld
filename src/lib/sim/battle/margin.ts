/**
 * Margin Call (ADR-160): a round lights up safe tiles (green candles) on tiles nobody stands on, then the gong
 * comes; every player not on a safe tile is out. The first warmupRounds rounds have spare tiles, then there is one
 * fewer than players; the time until the gong shrinks every round. When nobody makes it, nobody is out. The last
 * one standing wins; at the same tick, who was closer to a safe tile. Mirrored by public.battle_sim_margin.
 */
import type { MarginParams } from "../../../config/battles.ts";
import {
  ALIVE_KEY,
  advance,
  aliveCount,
  checkEnd,
  clonePlayers,
  inBounds,
  playerAt,
  rankByKeys,
  readInputs,
  spawnPlayers,
  walkContested,
  type GridBase,
  type SimParams,
} from "./core.ts";
import { battleHash } from "./hash.ts";

export interface MarginState extends GridBase {
  /** Per tile: 1 safe in this round. */
  safe: number[];
  round: number;
  /** When the tiles of this round lit up and when the gong comes (-1: no round open). */
  shown: number;
  call: number;
  /** The next round lights up then (-1: a round is open). */
  nextRound: number;
  /** The tick of the last gong (for drawing). */
  lastCall: number;
  /** Distance to the nearest safe tile when a player went out (ties). */
  dist: number[];
}

/** Ticks from the tiles lighting up to the gong in round r. */
export const marginShowTicks = (g: MarginParams, round: number): number =>
  Math.max(g.showMin, g.showTicks - round * g.showStep);

export function marginInit(seed: number, n: number, params: SimParams<MarginParams>): MarginState {
  return {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    safe: Array<number>(params.w * params.h).fill(0),
    round: 0,
    shown: -1,
    call: -1,
    nextRound: params.game.firstRound,
    lastCall: -1_000,
    dist: Array<number>(n).fill(0),
  };
}

export function marginClone(s: MarginState): MarginState {
  return { ...s, p: clonePlayers(s.p), safe: [...s.safe], dist: [...s.dist] };
}

export function marginStep(s: MarginState, inputs: string, params: SimParams<MarginParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  // a tile two want goes to one of them by lot (musical chairs, not a standoff)
  walkContested(
    p,
    codes,
    (x, y) => inBounds(s.w, s.h, x, y),
    params.stepTicks,
    (i) => battleHash(s.seed, 5000 + t, i),
  );
  if (t === s.nextRound) {
    const count = Math.max(1, aliveCount(p) - 1 + Math.max(0, g.warmupRounds - s.round));
    const free: number[] = [];
    for (let tile = 0; tile < s.w * s.h; tile++)
      if (playerAt(p, tile % s.w, Math.floor(tile / s.w)) < 0) free.push(tile);
    const h = (tile: number) => battleHash(s.seed, 800 + s.round, tile);
    free.sort((a, b) => h(a) - h(b) || a - b);
    s.safe.fill(0);
    for (const tile of free.slice(0, count)) s.safe[tile] = 1;
    s.shown = t;
    s.call = t + marginShowTicks(g, s.round);
    s.nextRound = -1;
  }
  if (t === s.call) {
    const failing: number[] = [];
    let alive = 0;
    for (let i = 0; i < p.n; i++) {
      if (p.out[i]! >= 0) continue;
      alive += 1;
      if (s.safe[p.y[i]! * s.w + p.x[i]!] !== 1) failing.push(i);
    }
    if (failing.length < alive) {
      for (const i of failing) {
        let best = 1_000;
        for (let tile = 0; tile < s.w * s.h; tile++)
          if (s.safe[tile] === 1)
            best = Math.min(best, Math.abs((tile % s.w) - p.x[i]!) + Math.abs(Math.floor(tile / s.w) - p.y[i]!));
        p.out[i] = t;
        s.dist[i] = best;
      }
    }
    s.round += 1;
    s.lastCall = t;
    s.call = -1;
    s.nextRound = t + g.pauseTicks;
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

export function marginRanking(s: MarginState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, -s.dist[i]!, s.p.steps[i]!]);
}
