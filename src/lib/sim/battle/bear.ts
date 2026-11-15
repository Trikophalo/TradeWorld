/**
 * Bärenjagd (ADR-160): bears leave their den in the middle one after another and chase the closest player, one tile
 * per step (towards the larger distance first, around the pillars and the other bears). Whoever a bear reaches, or
 * walks into one, is out; the bear then sits and eats for a moment. Bears get faster over time. The last one
 * standing wins. Mirrored by public.battle_sim_bear.
 */
import type { BearParams } from "../../../config/battles.ts";
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

export interface BearState extends GridBase {
  wall: boolean[];
  /** Bears in the arena (the first `bears` entries of the arrays). */
  bears: number;
  bx: number[];
  by: number[];
  /** The tile of a bear's last step's start and its length in ticks (for drawing). */
  bfx: number[];
  bfy: number[];
  bst: number[];
  /** The tick of a bear's last step. */
  bat: number[];
  /** The next tick a bear may step. */
  bnext: number[];
  /** A bear sits and eats until this tick. */
  beat: number[];
  /** The player a bear is after (-1: nobody). */
  btarget: number[];
}

/** Ticks per step of a bear at tick t. */
export function bearStepTicks(g: BearParams, t: number): number {
  return Math.max(g.stepMin, g.stepStart - Math.floor(t / g.speedEvery));
}

export function bearInit(seed: number, n: number, params: SimParams<BearParams>): BearState {
  const g = params.game;
  const wall = Array<boolean>(params.w * params.h).fill(false);
  for (const [x, y] of g.pillars) wall[y * params.w + x] = true;
  const k = g.bearTicks.length;
  const fill = (v: number) => Array<number>(k).fill(v);
  return {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, g.spawns ?? params.spawns),
    wall,
    bears: 0,
    bx: fill(g.den[0]!),
    by: fill(g.den[1]!),
    bfx: fill(g.den[0]!),
    bfy: fill(g.den[1]!),
    bst: fill(1),
    bat: fill(-1000),
    bnext: fill(0),
    beat: fill(0),
    btarget: fill(-1),
  };
}

export function bearClone(s: BearState): BearState {
  return {
    ...s,
    p: clonePlayers(s.p),
    bx: [...s.bx],
    by: [...s.by],
    bfx: [...s.bfx],
    bfy: [...s.bfy],
    bst: [...s.bst],
    bat: [...s.bat],
    bnext: [...s.bnext],
    beat: [...s.beat],
    btarget: [...s.btarget],
  };
}

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export function bearStep(s: BearState, inputs: string, params: SimParams<BearParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  const ox = [...p.x];
  const oy = [...p.y];
  walk(
    p,
    codes,
    (x, y) => inBounds(s.w, s.h, x, y) && !s.wall[y * s.w + x],
    () => params.stepTicks,
  );
  // a new bear comes out of the den
  if (s.bears < g.bearTicks.length && t >= g.bearTicks[s.bears]!) {
    const k = s.bears;
    s.bx[k] = g.den[0]!;
    s.by[k] = g.den[1]!;
    s.bfx[k] = s.bx[k]!;
    s.bfy[k] = s.by[k]!;
    s.bnext[k] = t + g.stepStart;
    s.bears += 1;
  }
  const moved = Array<boolean>(s.bears).fill(false);
  for (let k = 0; k < s.bears; k++) {
    if (t < s.bnext[k]! || t < s.beat[k]!) continue;
    let target = -1;
    let bestD = 0;
    let bestL = 0;
    for (let i = 0; i < p.n; i++) {
      if (p.out[i]! >= 0) continue;
      const d = Math.abs(p.x[i]! - s.bx[k]!) + Math.abs(p.y[i]! - s.by[k]!);
      const lot = battleHash(s.seed, 601, i);
      if (target < 0 || d < bestD || (d === bestD && lot < bestL)) {
        target = i;
        bestD = d;
        bestL = lot;
      }
    }
    s.btarget[k] = target;
    if (target < 0) continue;
    const dx = p.x[target]! - s.bx[k]!;
    const dy = p.y[target]! - s.by[k]!;
    const sx = sign(dx);
    const sy = sign(dy);
    const flip = battleHash(s.seed, 602, t) % 2 === 1 ? -1 : 1;
    const cands: [number, number][] = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (sx !== 0) cands.push([sx, 0]);
      if (sy !== 0) cands.push([0, sy]);
      cands.push([0, flip], [0, -flip]);
    } else {
      if (sy !== 0) cands.push([0, sy]);
      if (sx !== 0) cands.push([sx, 0]);
      cands.push([flip, 0], [-flip, 0]);
    }
    const step = bearStepTicks(g, t);
    s.bnext[k] = t + step;
    for (const [cx, cy] of cands) {
      const nx = s.bx[k]! + cx;
      const ny = s.by[k]! + cy;
      if (!inBounds(s.w, s.h, nx, ny) || s.wall[ny * s.w + nx]) continue;
      let taken = false;
      for (let j = 0; j < s.bears; j++) if (j !== k && s.bx[j] === nx && s.by[j] === ny) taken = true;
      if (taken) continue;
      s.bfx[k] = s.bx[k]!;
      s.bfy[k] = s.by[k]!;
      s.bx[k] = nx;
      s.by[k] = ny;
      s.bst[k] = step;
      s.bat[k] = t;
      moved[k] = true;
      break;
    }
  }
  // caught: on the bear's tile, or swapped tiles with it this tick
  for (let k = 0; k < s.bears; k++) {
    for (let i = 0; i < p.n; i++) {
      if (p.out[i]! >= 0) continue;
      const on = p.x[i] === s.bx[k] && p.y[i] === s.by[k];
      const swap =
        moved[k] &&
        (ox[i] !== p.x[i] || oy[i] !== p.y[i]) &&
        ox[i] === s.bx[k] &&
        oy[i] === s.by[k] &&
        p.x[i] === s.bfx[k] &&
        p.y[i] === s.bfy[k];
      if (!on && !swap) continue;
      p.out[i] = t;
      s.beat[k] = t + g.eatTicks;
    }
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

export function bearRanking(s: BearState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, s.p.steps[i]!]);
}
