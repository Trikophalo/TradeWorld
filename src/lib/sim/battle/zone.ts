/**
 * Goldrausch-Zone (ADR-177): a golden zone around the middle of the arena (Chebyshev radius) shrinks ring by ring.
 * Nobody can walk out of it; whoever stands outside when it shrinks is out. Coins appear on free tiles inside the
 * zone (as in Dividenden-Dash: who steps on one first takes it, every goldEvery-th is gold). Last one standing,
 * at the same tick the most coins. Mirrored by public.battle_sim_zone.
 */
import type { ZoneParams } from "../../../config/battles.ts";
import {
  ALIVE_KEY,
  advance,
  checkEnd,
  clonePlayers,
  playerAt,
  rankByKeys,
  readInputs,
  spawnPlayers,
  walkContested,
  type GridBase,
  type SimParams,
} from "./core.ts";
import { battleHash } from "./hash.ts";

export interface ZoneState extends GridBase {
  /** Current radius of the zone around (cx, cy). */
  r: number;
  cx: number;
  cy: number;
  score: number[];
  reach: number[];
  /** The coins: tile, the tick from which it can be taken, its number. */
  ct: number[];
  ca: number[];
  cn: number[];
  nextCoin: number;
}

/** The radius that covers the whole arena. */
export const zoneStartRadius = (w: number, h: number): number => Math.max(Math.floor(w / 2), Math.floor(h / 2));

/** The tick of shrink number k (0-based). */
export const zoneShrinkTick = (g: ZoneParams, k: number): number => g.firstShrink + k * g.shrinkEvery;

/** Chebyshev distance of a tile from the middle. */
export const zoneDist = (s: Pick<ZoneState, "cx" | "cy">, x: number, y: number): number =>
  Math.max(Math.abs(x - s.cx), Math.abs(y - s.cy));

export const zoneValue = (g: ZoneParams, index: number): number => ((index + 1) % g.goldEvery === 0 ? g.goldValue : 1);

/** Whether the zone shrinks at tick t, given the start and the current radius. */
export function zoneShrinksAt(g: ZoneParams, r0: number, r: number, t: number): boolean {
  if (r <= g.radiusMin) return false;
  return t === zoneShrinkTick(g, r0 - r);
}

/** A free tile inside the zone for coin number `index`: from a drawn tile on, the first without player or coin. */
function freeTile(s: ZoneState, index: number): number {
  const size = s.w * s.h;
  const start = battleHash(s.seed, 710, index) % size;
  for (let k = 0; k < size; k++) {
    const tile = (start + k) % size;
    const x = tile % s.w;
    const y = Math.floor(tile / s.w);
    if (zoneDist(s, x, y) > s.r) continue;
    if (playerAt(s.p, x, y) >= 0) continue;
    if (s.ct.includes(tile)) continue;
    return tile;
  }
  return s.cy * s.w + s.cx;
}

export function zoneInit(seed: number, n: number, params: SimParams<ZoneParams>): ZoneState {
  const g = params.game;
  const count = Math.min(g.coinsMax, 1 + Math.floor(n / g.coinsPerPlayers));
  const s: ZoneState = {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    r: zoneStartRadius(params.w, params.h),
    cx: Math.floor(params.w / 2),
    cy: Math.floor(params.h / 2),
    score: Array<number>(n).fill(0),
    reach: Array<number>(n).fill(0),
    ct: [],
    ca: [],
    cn: [],
    nextCoin: 0,
  };
  for (let c = 0; c < count; c++) {
    s.ct.push(freeTile(s, s.nextCoin));
    s.ca.push(g.firstCoin);
    s.cn.push(s.nextCoin);
    s.nextCoin += 1;
  }
  return s;
}

export function zoneClone(s: ZoneState): ZoneState {
  return {
    ...s,
    p: clonePlayers(s.p),
    score: [...s.score],
    reach: [...s.reach],
    ct: [...s.ct],
    ca: [...s.ca],
    cn: [...s.cn],
  };
}

function respawnCoin(s: ZoneState, c: number, from: number): void {
  s.ct[c] = -1;
  s.ct[c] = freeTile(s, s.nextCoin);
  s.ca[c] = from;
  s.cn[c] = s.nextCoin;
  s.nextCoin += 1;
}

export function zoneStep(s: ZoneState, inputs: string, params: SimParams<ZoneParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  // a coin two want goes to the one with fewer coins, then by lot (walkContested)
  walkContested(
    p,
    codes,
    (x, y) => x >= 0 && y >= 0 && x < s.w && y < s.h && zoneDist(s, x, y) <= s.r,
    params.stepTicks,
    (i) => s.score[i]! * 4_294_967_296 + battleHash(s.seed, 7100 + t, i),
  );
  if (zoneShrinksAt(g, zoneStartRadius(s.w, s.h), s.r, t)) {
    s.r -= 1;
    for (let i = 0; i < p.n; i++) {
      if (p.out[i]! < 0 && zoneDist(s, p.x[i]!, p.y[i]!) > s.r) p.out[i] = t;
    }
    for (let c = 0; c < s.ct.length; c++) {
      const tile = s.ct[c]!;
      if (zoneDist(s, tile % s.w, Math.floor(tile / s.w)) > s.r) respawnCoin(s, c, t + g.spawnDelay);
    }
  }
  for (let c = 0; c < s.ct.length; c++) {
    if (t < s.ca[c]!) continue;
    const tile = s.ct[c]!;
    const j = playerAt(p, tile % s.w, Math.floor(tile / s.w));
    if (j < 0) continue;
    s.score[j]! += zoneValue(g, s.cn[c]!);
    s.reach[j] = t;
    respawnCoin(s, c, t + g.spawnDelay);
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

/** Last one standing; at the same tick the most coins, then who got the last one first. */
export function zoneRanking(s: ZoneState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [
    s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!,
    s.score[i]!,
    s.score[i]! > 0 ? -s.reach[i]! : 0,
  ]);
}
