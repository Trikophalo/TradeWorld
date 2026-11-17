/**
 * Crash-Regen (ADR-177): market crashes rain down in waves. Wave k is announced at its tick; each of its crashes hits
 * a plus of five tiles warnTicks later. Standing on a hit tile costs a heart (then invulnTicks safe); without hearts
 * you are out. The waves come faster and bigger. Last one standing. Mirrored by public.battle_sim_crash.
 */
import type { CrashParams } from "../../../config/battles.ts";
import {
  ALIVE_KEY,
  advance,
  checkEnd,
  clonePlayers,
  inBounds,
  rankByKeys,
  readInputs,
  spawnPlayers,
  walk,
  type GridBase,
  type SimParams,
} from "./core.ts";
import { battleHash } from "./hash.ts";

export interface CrashState extends GridBase {
  hearts: number[];
  inv: number[];
  /** The next wave to hit, and the tick it was announced. */
  hit: number;
  hitAt: number;
}

/** Ticks between the announcement of wave k and of wave k + 1. */
export const crashGap = (g: CrashParams, k: number): number =>
  Math.max(g.waveEveryMin, g.waveEvery - k * g.waveEveryStep);

/** The tick wave k is announced. */
export function crashWaveTick(g: CrashParams, k: number): number {
  let t = g.firstWave;
  for (let j = 0; j < k; j++) t += crashGap(g, j);
  return t;
}

/** The centre tiles of the crashes of wave k. */
export function crashCentres(seed: number, g: CrashParams, n: number, w: number, h: number, k: number): number[] {
  const count = Math.min(g.countMax, g.countStart + Math.floor(k / 2) + Math.floor(n / g.countPerPlayers));
  return Array.from({ length: count }, (_, m) => battleHash(seed, 1100 + k, m) % (w * h));
}

/** Whether tile (x, y) is hit by a crash at centre `c` (a plus of five tiles). */
export function crashHits(w: number, c: number, x: number, y: number): boolean {
  return Math.abs((c % w) - x) + Math.abs(Math.floor(c / w) - y) <= 1;
}

export function crashInit(seed: number, n: number, params: SimParams<CrashParams>): CrashState {
  return {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    hearts: Array<number>(n).fill(params.game.hearts),
    inv: Array<number>(n).fill(0),
    hit: 0,
    hitAt: params.game.firstWave,
  };
}

export function crashClone(s: CrashState): CrashState {
  return { ...s, p: clonePlayers(s.p), hearts: [...s.hearts], inv: [...s.inv] };
}

export function crashStep(s: CrashState, inputs: string, params: SimParams<CrashParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  for (let i = 0; i < p.n; i++) if (p.out[i]! < 0 && s.inv[i]! > 0) s.inv[i]! -= 1;
  walk(
    p,
    codes,
    (x, y) => inBounds(s.w, s.h, x, y),
    () => params.stepTicks,
  );
  if (s.hitAt + g.warnTicks === t) {
    const centres = crashCentres(s.seed, g, s.n, s.w, s.h, s.hit);
    for (let i = 0; i < p.n; i++) {
      if (p.out[i]! >= 0 || s.inv[i]! > 0) continue;
      if (!centres.some((c) => crashHits(s.w, c, p.x[i]!, p.y[i]!))) continue;
      s.hearts[i]! -= 1;
      s.inv[i] = g.invulnTicks;
      if (s.hearts[i]! <= 0) p.out[i] = t;
    }
    s.hitAt += crashGap(g, s.hit);
    s.hit += 1;
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

/** Last one standing; at the same tick the most hearts; then the lot. */
export function crashRanking(s: CrashState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, s.hearts[i]!]);
}
