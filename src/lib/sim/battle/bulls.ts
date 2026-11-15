/**
 * Bullenreiten (ADR-160): bulls charge across a row or a column after a warning. A bull is two tiles long and runs a
 * tile every `ticksPerTile`; touching one costs a heart (stunned, then invulnerable for a moment). Three hearts;
 * the last one standing wins. Mirrored by public.battle_sim_bulls.
 */
import type { BullsParams } from "../../../config/battles.ts";
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

export interface Bull {
  /** 0 runs along a row, 1 along a column. */
  line: number;
  /** The row or column. */
  idx: number;
  /** +1 towards higher x / y, -1 back. */
  dir: number;
  /** The tick it enters the arena (the warning starts warnTicks before). */
  t0: number;
}

export interface BullsState extends GridBase {
  hearts: number[];
  inv: number[];
  bulls: Bull[];
  /** First bull that may still run. */
  first: number;
  spawn: number;
  nextSpawn: number;
}

export function bullsInit(seed: number, n: number, params: SimParams<BullsParams>): BullsState {
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
    bulls: [],
    first: 0,
    spawn: 0,
    nextSpawn: params.game.firstSpawn,
  };
}

export function bullsClone(s: BullsState): BullsState {
  return { ...s, p: clonePlayers(s.p), hearts: [...s.hearts], inv: [...s.inv], bulls: [...s.bulls] };
}

/** Length of a bull's line in tiles. */
export const bullLength = (s: { w: number; h: number }, b: Bull): number => (b.line === 0 ? s.w : s.h);

/** Head and tail coordinate along the line at `tick`, or null when it is not in the arena. */
export function bullAt(
  s: { w: number; h: number },
  b: Bull,
  tick: number,
  ticksPerTile: number,
): [number, number] | null {
  if (tick < b.t0) return null;
  const len = bullLength(s, b);
  const k = Math.floor((tick - b.t0) / ticksPerTile);
  if (k > len) return null;
  const head = b.dir > 0 ? k : len - 1 - k;
  return [head, head - b.dir];
}

export function bullsStep(s: BullsState, inputs: string, params: SimParams<BullsParams>): void {
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
  if (t === s.nextSpawn) {
    const count = Math.min(g.countMax, 1 + Math.floor(s.spawn / g.countGrowEvery));
    const from = s.bulls.length;
    for (let b = 0; b < count; b++) {
      const r = battleHash(s.seed, 200 + s.spawn, b);
      const line = r % 2;
      const idx = Math.floor(r / 2) % (line === 0 ? s.h : s.w);
      const dir = Math.floor(r / 64) % 2 === 0 ? 1 : -1;
      let twin = false;
      for (let k = from; k < s.bulls.length; k++) if (s.bulls[k]!.line === line && s.bulls[k]!.idx === idx) twin = true;
      if (!twin) s.bulls.push({ line, idx, dir, t0: t + g.warnTicks });
    }
    s.spawn += 1;
    s.nextSpawn = t + Math.max(g.spawnEveryMin, g.spawnEvery - s.spawn * g.spawnEveryStep);
  }
  while (s.first < s.bulls.length) {
    const b = s.bulls[s.first]!;
    if (t < b.t0 + (bullLength(s, b) + 1) * g.ticksPerTile) break;
    s.first += 1;
  }
  for (let k = s.first; k < s.bulls.length; k++) {
    const b = s.bulls[k]!;
    const at = bullAt(s, b, t, g.ticksPerTile);
    if (!at) continue;
    for (let i = 0; i < p.n; i++) {
      if (p.out[i]! >= 0 || s.inv[i]! > 0) continue;
      const along = b.line === 0 ? p.x[i]! : p.y[i]!;
      const across = b.line === 0 ? p.y[i]! : p.x[i]!;
      if (across !== b.idx || (along !== at[0] && along !== at[1])) continue;
      s.hearts[i]! -= 1;
      p.stun[i] = g.stunTicks;
      s.inv[i] = g.invulnTicks;
      if (s.hearts[i]! <= 0) p.out[i] = t;
    }
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

export function bullsRanking(s: BullsState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, s.hearts[i]!, s.p.steps[i]!]);
}
