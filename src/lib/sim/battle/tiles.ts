/**
 * Wackelparkett (ADR-177): a tile you leave cracks and breaks `breakDelay` ticks later (shorter over time); the hole
 * grows back after `regrow` ticks (longer over time). Standing still for idleMax ticks breaks your own tile. Holes
 * cannot be entered; whoever stands on a tile when it breaks falls. Last one standing. Mirrored by
 * public.battle_sim_tiles.
 */
import type { TilesParams } from "../../../config/battles.ts";
import {
  ALIVE_KEY,
  advance,
  checkEnd,
  clonePlayers,
  countIdle,
  inBounds,
  rankByKeys,
  readInputs,
  spawnPlayers,
  walk,
  type GridBase,
  type SimParams,
} from "./core.ts";

export interface TilesState extends GridBase {
  /** Per tile: -1 solid, else the tick it breaks. */
  crack: number[];
  /** Per tile: a hole until this tick (0: never was one). */
  hole: number[];
}

export const tilesBreakDelay = (g: TilesParams, t: number): number =>
  Math.max(g.breakMin, g.breakStart - Math.floor(t / g.breakStepEvery));
export const tilesRegrow = (g: TilesParams, t: number): number => g.regrowStart + Math.floor(t / g.regrowGrowEvery);
export const tilesHole = (s: TilesState, tile: number, t: number): boolean => s.hole[tile]! > t;

export function tilesInit(seed: number, n: number, params: SimParams<TilesParams>): TilesState {
  return {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    crack: Array<number>(params.w * params.h).fill(-1),
    hole: Array<number>(params.w * params.h).fill(0),
  };
}

export function tilesClone(s: TilesState): TilesState {
  return { ...s, p: clonePlayers(s.p), crack: [...s.crack], hole: [...s.hole] };
}

export function tilesStep(s: TilesState, inputs: string, params: SimParams<TilesParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  const before = [...p.steps];
  walk(
    p,
    codes,
    (x, y) => inBounds(s.w, s.h, x, y) && !tilesHole(s, y * s.w + x, t),
    () => params.stepTicks,
  );
  countIdle(p);
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0) continue;
    if (p.steps[i] !== before[i]) {
      const from = p.fy[i]! * s.w + p.fx[i]!;
      if (s.crack[from]! < 0) s.crack[from] = t + tilesBreakDelay(g, t);
    } else if (p.idle[i]! >= g.idleMax) {
      const tile = p.y[i]! * s.w + p.x[i]!;
      if (s.crack[tile]! < 0) s.crack[tile] = t;
    }
  }
  for (let tile = 0; tile < s.crack.length; tile++) {
    const c = s.crack[tile]!;
    if (c >= 0 && c <= t) {
      s.crack[tile] = -1;
      s.hole[tile] = t + tilesRegrow(g, t);
    }
  }
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! < 0 && tilesHole(s, p.y[i]! * s.w + p.x[i]!, t)) p.out[i] = t;
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

/** Last one standing first; at the same tick, who walked more; then the lot. */
export function tilesRanking(s: TilesState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, s.p.steps[i]!]);
}
