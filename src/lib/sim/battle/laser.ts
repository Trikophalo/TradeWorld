/**
 * Laserschranke (ADR-160): laser beams sweep through the arena after a warning, a horizontal beam (line 0) from
 * row to row, a vertical one (line 1) from column to column, a tile every ticksPerTile; some have a gap. Walking
 * away does not help: jump. Pressing the action (a new press) jumps for jumpTicks, then you have to land for
 * jumpCool. A beam on your tile while you are on the ground costs a heart (then a moment invulnerable). Three
 * hearts; the last one standing wins. Mirrored by public.battle_sim_laser.
 */
import type { LaserParams } from "../../../config/battles.ts";
import {
  ALIVE_KEY,
  actOf,
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

export interface Laser {
  /** 0: a horizontal beam moving along y, 1: a vertical beam moving along x. */
  line: number;
  /** +1 towards higher y / x, -1 back. */
  dir: number;
  /** The tile along the beam that does not burn (-1: none). */
  gap: number;
  /** The tick it enters (the warning starts warnTicks before). */
  t0: number;
}

export interface LaserState extends GridBase {
  hearts: number[];
  inv: number[];
  /** Ticks left in the air, and on the ground before the next jump. */
  air: number[];
  jcool: number[];
  /** The action was held the tick before (a jump needs a new press). */
  held: number[];
  jumps: number[];
  lasers: Laser[];
  first: number;
  spawn: number;
  nextSpawn: number;
}

/** How many tiles a beam travels. */
export const laserLength = (s: { w: number; h: number }, l: Laser): number => (l.line === 0 ? s.h : s.w);

/** The row (line 0) or column (line 1) the beam is on at `tick`, or -1 when it is not in the arena. */
export function laserAt(s: { w: number; h: number }, l: Laser, tick: number, ticksPerTile: number): number {
  if (tick < l.t0) return -1;
  const k = Math.floor((tick - l.t0) / ticksPerTile);
  const len = laserLength(s, l);
  if (k >= len) return -1;
  return l.dir > 0 ? k : len - 1 - k;
}

export function laserInit(seed: number, n: number, params: SimParams<LaserParams>): LaserState {
  const fill = (v: number) => Array<number>(n).fill(v);
  return {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    hearts: fill(params.game.hearts),
    inv: fill(0),
    air: fill(0),
    jcool: fill(0),
    held: fill(0),
    jumps: fill(0),
    lasers: [],
    first: 0,
    spawn: 0,
    nextSpawn: params.game.firstSpawn,
  };
}

export function laserClone(s: LaserState): LaserState {
  return {
    ...s,
    p: clonePlayers(s.p),
    hearts: [...s.hearts],
    inv: [...s.inv],
    air: [...s.air],
    jcool: [...s.jcool],
    held: [...s.held],
    jumps: [...s.jumps],
    lasers: [...s.lasers],
  };
}

export function laserStep(s: LaserState, inputs: string, params: SimParams<LaserParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0) continue;
    if (s.inv[i]! > 0) s.inv[i]! -= 1;
    if (s.air[i]! > 0) {
      s.air[i]! -= 1;
      if (s.air[i] === 0) s.jcool[i] = g.jumpCool;
    } else if (s.jcool[i]! > 0) s.jcool[i]! -= 1;
    const act = actOf(codes[i]!);
    if (act && s.held[i] === 0 && s.air[i] === 0 && s.jcool[i] === 0) {
      s.air[i] = g.jumpTicks;
      s.jumps[i]! += 1;
    }
    s.held[i] = act ? 1 : 0;
  }
  walk(
    p,
    codes,
    (x, y) => inBounds(s.w, s.h, x, y),
    () => params.stepTicks,
  );
  if (t === s.nextSpawn) {
    const count = Math.min(g.countMax, 1 + Math.floor(s.spawn / g.countGrowEvery));
    for (let b = 0; b < count; b++) {
      const r = battleHash(s.seed, 1000 + s.spawn, b);
      const line = r % 2;
      const dir = Math.floor(r / 2) % 2 === 0 ? 1 : -1;
      const gap = Math.floor(r / 4) % 100 < g.gapPct ? Math.floor(r / 400) % (line === 0 ? s.w : s.h) : -1;
      s.lasers.push({ line, dir, gap, t0: t + g.warnTicks + b * g.staggerTicks });
    }
    s.spawn += 1;
    s.nextSpawn = t + Math.max(g.spawnEveryMin, g.spawnEvery - s.spawn * g.spawnEveryStep);
  }
  while (s.first < s.lasers.length) {
    const l = s.lasers[s.first]!;
    if (t < l.t0 + laserLength(s, l) * g.ticksPerTile) break;
    s.first += 1;
  }
  for (let k = s.first; k < s.lasers.length; k++) {
    const l = s.lasers[k]!;
    const at = laserAt(s, l, t, g.ticksPerTile);
    if (at < 0) continue;
    for (let i = 0; i < p.n; i++) {
      if (p.out[i]! >= 0 || s.inv[i]! > 0 || s.air[i]! > 0) continue;
      const across = l.line === 0 ? p.y[i]! : p.x[i]!;
      const along = l.line === 0 ? p.x[i]! : p.y[i]!;
      if (across !== at || along === l.gap) continue;
      s.hearts[i]! -= 1;
      s.inv[i] = g.invulnTicks;
      if (s.hearts[i]! <= 0) p.out[i] = t;
    }
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

export function laserRanking(s: LaserState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, s.hearts[i]!, s.p.steps[i]!]);
}
