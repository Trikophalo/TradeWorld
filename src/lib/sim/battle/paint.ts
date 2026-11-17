/**
 * Farbrausch (ADR-177): every tile a player stands on takes their colour. The action throws a paint bomb that colours
 * the square of bombRadius around them (every bombCool ticks); a tile two bombs hit in the same tick stays as it was.
 * The most tiles at the end wins. Mirrored by public.battle_sim_paint.
 */
import type { PaintParams } from "../../../config/battles.ts";
import {
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

export interface PaintState extends GridBase {
  /** Per tile: the slot whose colour it has, -1 none. */
  own: number[];
  /** Tiles per player. */
  score: number[];
  cool: number[];
  bombs: number[];
}

function paintTile(s: PaintState, tile: number, slot: number): void {
  const old = s.own[tile]!;
  if (old === slot) return;
  if (old >= 0) s.score[old]! -= 1;
  s.own[tile] = slot;
  s.score[slot]! += 1;
}

export function paintInit(seed: number, n: number, params: SimParams<PaintParams>): PaintState {
  const s: PaintState = {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    own: Array<number>(params.w * params.h).fill(-1),
    score: Array<number>(n).fill(0),
    cool: Array<number>(n).fill(0),
    bombs: Array<number>(n).fill(0),
  };
  for (let i = 0; i < n; i++) paintTile(s, s.p.y[i]! * s.w + s.p.x[i]!, i);
  return s;
}

export function paintClone(s: PaintState): PaintState {
  return { ...s, p: clonePlayers(s.p), own: [...s.own], score: [...s.score], cool: [...s.cool], bombs: [...s.bombs] };
}

export function paintStep(s: PaintState, inputs: string, params: SimParams<PaintParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  for (let i = 0; i < p.n; i++) if (p.out[i]! < 0 && s.cool[i]! > 0) s.cool[i]! -= 1;
  walk(
    p,
    codes,
    (x, y) => inBounds(s.w, s.h, x, y),
    () => params.stepTicks,
  );
  // paint bombs: a tile claimed by exactly one bomb this tick takes its colour
  const claim = Array<number>(s.own.length).fill(-1);
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0 || !actOf(codes[i]!) || s.cool[i]! > 0) continue;
    s.cool[i] = g.bombCool;
    s.bombs[i]! += 1;
    for (let dy = -g.bombRadius; dy <= g.bombRadius; dy++)
      for (let dx = -g.bombRadius; dx <= g.bombRadius; dx++) {
        const x = p.x[i]! + dx;
        const y = p.y[i]! + dy;
        if (!inBounds(s.w, s.h, x, y)) continue;
        const tile = y * s.w + x;
        claim[tile] = claim[tile] === -1 ? i : -2;
      }
  }
  for (let tile = 0; tile < claim.length; tile++) if (claim[tile]! >= 0) paintTile(s, tile, claim[tile]!);
  for (let i = 0; i < p.n; i++) if (p.out[i]! < 0) paintTile(s, p.y[i]! * s.w + p.x[i]!, i);
  checkEnd(s, g.durationTicks);
  s.tick = t + 1;
}

/** Still in first, then the most tiles, then the lot. */
export function paintRanking(s: PaintState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? 1 : 0, s.score[i]!]);
}
