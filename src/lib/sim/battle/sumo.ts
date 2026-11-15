/**
 * Sumo am Parkett (ADR-160): walking into someone shoves them one tile (with the action button two, then a
 * cooldown); the shover needs a moment to recover, so nobody can be pushed along helplessly. Whoever is pushed off
 * the ring is out. Nobody walks off by himself. The ring shrinks from the outside,
 * one ring of tiles at a time; the last one standing wins. Order-free like walk(): players being shoved cannot shove,
 * two pushers on one target cancel out, two targets shoved onto the same tile too. Mirrored by
 * public.battle_sim_sumo.
 */
import type { SumoParams } from "../../../config/battles.ts";
import {
  ALIVE_KEY,
  DX,
  DY,
  actOf,
  advance,
  checkEnd,
  clonePlayers,
  dirOf,
  inBounds,
  playerAt,
  rankByKeys,
  readInputs,
  spawnPlayers,
  type GridBase,
  type SimParams,
} from "./core.ts";

export interface SumoState extends GridBase {
  /** Per tile: the tick it falls (0 = never part of the ring). */
  fall: number[];
  pushes: number[];
  cool: number[];
}

export function sumoInit(seed: number, n: number, params: SimParams<SumoParams>): SumoState {
  const g = params.game;
  const cx = Math.floor(params.w / 2);
  const cy = Math.floor(params.h / 2);
  const fall: number[] = [];
  let maxRing = 0;
  for (let y = 0; y < params.h; y++)
    for (let x = 0; x < params.w; x++) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      if (dx + dy < g.cornerCut) maxRing = Math.max(maxRing, Math.max(dx, dy));
    }
  for (let y = 0; y < params.h; y++)
    for (let x = 0; x < params.w; x++) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      fall.push(dx + dy < g.cornerCut ? g.firstShrink + (maxRing - Math.max(dx, dy)) * g.shrinkEvery : 0);
    }
  return {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, g.spawns ?? params.spawns),
    fall,
    pushes: Array<number>(n).fill(0),
    cool: Array<number>(n).fill(0),
  };
}

export function sumoClone(s: SumoState): SumoState {
  return { ...s, p: clonePlayers(s.p), pushes: [...s.pushes], cool: [...s.cool] };
}

/** The tile (x, y) is part of the ring at `tick`. */
export function sumoSolid(s: SumoState, x: number, y: number, tick: number): boolean {
  if (!inBounds(s.w, s.h, x, y)) return false;
  const f = s.fall[y * s.w + x]!;
  return f > 0 && tick < f;
}

export function sumoStep(s: SumoState, inputs: string, params: SimParams<SumoParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const n = p.n;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  for (let i = 0; i < n; i++) if (p.out[i]! < 0 && s.cool[i]! > 0) s.cool[i]! -= 1;

  // intents: walk to a free tile of the ring, or shove whoever stands there
  const target = Array<number>(n).fill(-1);
  const dirs = Array<number>(n).fill(0);
  const power = Array<boolean>(n).fill(false);
  const walkTo = Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (p.out[i]! >= 0 || p.mv[i]! > 0 || p.stun[i]! > 0) continue;
    const d = dirOf(codes[i]!);
    if (d === 0) continue;
    p.face[i] = d;
    const nx = p.x[i]! + DX[d]!;
    const ny = p.y[i]! + DY[d]!;
    if (!inBounds(s.w, s.h, nx, ny)) continue;
    const j = playerAt(p, nx, ny);
    if (j >= 0) {
      target[i] = j;
      dirs[i] = d;
      power[i] = actOf(codes[i]!) && s.cool[i] === 0;
    } else if (sumoSolid(s, nx, ny, t)) walkTo[i] = ny * s.w + nx;
  }
  // whoever is being shoved cannot shove
  const aimed = Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) if (target[i]! >= 0) aimed[target[i]!]! += 1;
  for (let i = 0; i < n; i++) if (target[i]! >= 0 && aimed[i]! > 0) target[i] = -1;
  // two pushers on one target: nothing happens
  const count = Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) if (target[i]! >= 0) count[target[i]!]! += 1;
  const destX = Array<number>(n).fill(0);
  const destY = Array<number>(n).fill(0);
  const ok = Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const j = target[i]!;
    if (j < 0 || count[j]! !== 1) continue;
    const d = dirs[i]!;
    const free = (x: number, y: number) => {
      if (!inBounds(s.w, s.h, x, y)) return true;
      const k = playerAt(p, x, y);
      return k < 0 || k === i || k === j;
    };
    const x1 = p.x[j]! + DX[d]!;
    const y1 = p.y[j]! + DY[d]!;
    if (!free(x1, y1)) continue;
    let x = x1;
    let y = y1;
    if (power[i] && inBounds(s.w, s.h, x1, y1)) {
      const x2 = x1 + DX[d]!;
      const y2 = y1 + DY[d]!;
      if (free(x2, y2)) {
        x = x2;
        y = y2;
      }
    }
    destX[i] = x;
    destY[i] = y;
    ok[i] = true;
  }
  // two targets shoved onto the same tile: both pushes fail
  for (let i = 0; i < n; i++) {
    if (!ok[i] || !inBounds(s.w, s.h, destX[i]!, destY[i]!)) continue;
    for (let k = 0; k < n; k++)
      if (k !== i && ok[k] && destX[k] === destX[i] && destY[k] === destY[i]) {
        ok[i] = false;
        ok[k] = false;
      }
  }
  const ox = [...p.x];
  const oy = [...p.y];
  const shoved = Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    const j = target[i]!;
    shoved[j] = true;
    p.fx[j] = ox[j]!;
    p.fy[j] = oy[j]!;
    p.x[j] = destX[i]!;
    p.y[j] = destY[i]!;
    p.mv[j] = params.stepTicks;
    p.st[j] = params.stepTicks;
    p.stun[j] = g.stunTicks;
    p.fx[i] = ox[i]!;
    p.fy[i] = oy[i]!;
    p.x[i] = ox[j]!;
    p.y[i] = oy[j]!;
    p.mv[i] = params.stepTicks;
    p.st[i] = params.stepTicks;
    p.steps[i]! += 1;
    p.stun[i] = g.recoverTicks;
    s.pushes[i]! += 1;
    if (power[i]) s.cool[i] = g.powerCooldown;
  }
  // walks: a target nobody stood on and nobody stands on now, wanted by one player only
  for (let i = 0; i < n; i++) {
    if (walkTo[i]! < 0 || shoved[i] || ok[i]) continue;
    const tx = walkTo[i]! % s.w;
    const ty = Math.floor(walkTo[i]! / s.w);
    let blocked = false;
    for (let j = 0; j < n; j++) {
      if (j === i || p.out[j]! >= 0) continue;
      if ((ox[j] === tx && oy[j] === ty) || (p.x[j] === tx && p.y[j] === ty)) blocked = true;
      if (walkTo[j] === walkTo[i] && !shoved[j] && !ok[j]) blocked = true;
    }
    if (blocked) continue;
    p.fx[i] = ox[i]!;
    p.fy[i] = oy[i]!;
    p.x[i] = tx;
    p.y[i] = ty;
    p.mv[i] = params.stepTicks;
    p.st[i] = params.stepTicks;
    p.steps[i]! += 1;
  }
  for (let i = 0; i < n; i++) {
    if (p.out[i]! >= 0) continue;
    if (!sumoSolid(s, p.x[i]!, p.y[i]!, t)) p.out[i] = t;
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

export function sumoRanking(s: SumoState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, s.pushes[i]!, s.p.steps[i]!]);
}
