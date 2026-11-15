/**
 * Kurssturz (ADR-160): the trading floor breaks away. Every wave cracks a few random tiles that fall `warnTicks`
 * later; standing still for `stompTicks` cracks your own tile. Whoever stands on a fallen tile (or walks onto a
 * hole) is out; the last one standing wins. Mirrored by public.battle_sim_floor.
 */
import type { FloorParams } from "../../../config/battles.ts";
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
import { battleHash } from "./hash.ts";

export interface FloorState extends GridBase {
  /** Per tile: 0 solid, else the tick it falls (cracked until then, a hole from then on). */
  crack: number[];
  wave: number;
  nextWave: number;
}

export function floorInit(seed: number, n: number, params: SimParams<FloorParams>): FloorState {
  return {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    crack: Array<number>(params.w * params.h).fill(0),
    wave: 0,
    nextWave: params.game.firstWave,
  };
}

export function floorClone(s: FloorState): FloorState {
  return { ...s, p: clonePlayers(s.p), crack: [...s.crack] };
}

/** A tile is gone at `tick`. */
export const floorGone = (s: FloorState, tile: number, tick: number): boolean => {
  const c = s.crack[tile]!;
  return c > 0 && tick >= c;
};

export function floorStep(s: FloorState, inputs: string, params: SimParams<FloorParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  walk(
    p,
    codes,
    (x, y) => inBounds(s.w, s.h, x, y),
    () => params.stepTicks,
  );
  countIdle(p);
  if (t === s.nextWave) {
    const solid: number[] = [];
    for (let i = 0; i < s.crack.length; i++) if (s.crack[i] === 0) solid.push(i);
    const k =
      solid.length <= g.endgameTiles ? 1 : Math.min(g.crackMax, g.crackStart + Math.floor(s.wave / g.crackGrowEvery));
    const h = (tile: number) => battleHash(s.seed, 100 + s.wave, tile);
    solid.sort((a, b) => h(a) - h(b) || a - b);
    for (const tile of solid.slice(0, k)) s.crack[tile] = t + g.warnTicks;
    s.wave += 1;
    s.nextWave = t + Math.max(g.waveEveryMin, g.waveEvery - s.wave * g.waveEveryStep);
  }
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0 || p.idle[i]! < g.stompTicks) continue;
    const tile = p.y[i]! * s.w + p.x[i]!;
    if (s.crack[tile] === 0) s.crack[tile] = t + g.warnTicks;
  }
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0) continue;
    if (floorGone(s, p.y[i]! * s.w + p.x[i]!, t)) p.out[i] = t;
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

/** Last one standing first; at the same tick, who walked more; then the lot. */
export function floorRanking(s: FloorState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, s.p.steps[i]!]);
}
