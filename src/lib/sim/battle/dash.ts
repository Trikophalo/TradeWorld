/**
 * Dividenden-Dash (ADR-160): a few dividend coins lie on free tiles; whoever steps on one first takes it, and a new
 * one appears elsewhere (it can be taken after spawnDelay). Every goldEvery-th coin is a special dividend. Walking
 * into someone with the action held tackles them: they cannot move for tackleStun, the tackler waits tackleCool.
 * When several want the same free tile, the one with fewer dividends gets it (then the lot): no standoffs.
 * First to `target` wins at once; else the most at the end, at a draw who got there first. Mirrored by
 * public.battle_sim_dash.
 */
import type { DashParams } from "../../../config/battles.ts";
import {
  actOf,
  advance,
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

export interface DashState extends GridBase {
  score: number[];
  /** Tick of the last coin, for draws. */
  reach: number[];
  cool: number[];
  tackles: number[];
  /** The coins: tile, the tick from which it can be taken, its number. */
  ct: number[];
  ca: number[];
  cn: number[];
  nextCoin: number;
}

/** What coin number `index` is worth. */
export const dashValue = (g: DashParams, index: number): number => ((index + 1) % g.goldEvery === 0 ? g.goldValue : 1);

/** A free tile for coin number `index`: from a tile drawn from the seed onwards, the first without player or coin. */
function freeTile(s: DashState, index: number): number {
  const size = s.w * s.h;
  const start = battleHash(s.seed, 700, index) % size;
  for (let k = 0; k < size; k++) {
    const tile = (start + k) % size;
    if (playerAt(s.p, tile % s.w, Math.floor(tile / s.w)) >= 0) continue;
    if (s.ct.includes(tile)) continue;
    return tile;
  }
  return start;
}

export function dashInit(seed: number, n: number, params: SimParams<DashParams>): DashState {
  const g = params.game;
  const count = Math.min(g.coinsMax, 1 + Math.floor(n / g.coinsPerPlayers));
  const s: DashState = {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    score: Array<number>(n).fill(0),
    reach: Array<number>(n).fill(0),
    cool: Array<number>(n).fill(0),
    tackles: Array<number>(n).fill(0),
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

export function dashClone(s: DashState): DashState {
  return {
    ...s,
    p: clonePlayers(s.p),
    score: [...s.score],
    reach: [...s.reach],
    cool: [...s.cool],
    tackles: [...s.tackles],
    ct: [...s.ct],
    ca: [...s.ca],
    cn: [...s.cn],
  };
}

export function dashStep(s: DashState, inputs: string, params: SimParams<DashParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  for (let i = 0; i < p.n; i++) if (p.out[i]! < 0 && s.cool[i]! > 0) s.cool[i]! -= 1;
  const hits: [number, number][] = [];
  // a tile two want goes to the one with fewer dividends, then by lot
  walkContested(
    p,
    codes,
    (x, y) => inBounds(s.w, s.h, x, y),
    params.stepTicks,
    (i) => s.score[i]! * 4_294_967_296 + battleHash(s.seed, 7000 + t, i),
    (i, j) => {
      if (actOf(codes[i]!) && s.cool[i] === 0) hits.push([i, j]);
    },
  );
  for (const [i, j] of hits) {
    p.stun[j] = Math.max(p.stun[j]!, g.tackleStun);
    s.cool[i] = g.tackleCool;
    s.tackles[i]! += 1;
  }
  for (let c = 0; c < s.ct.length; c++) {
    if (t < s.ca[c]!) continue;
    const tile = s.ct[c]!;
    const j = playerAt(p, tile % s.w, Math.floor(tile / s.w));
    if (j < 0) continue;
    s.score[j]! += dashValue(g, s.cn[c]!);
    s.reach[j] = t;
    s.ct[c] = -1;
    s.ct[c] = freeTile(s, s.nextCoin);
    s.ca[c] = t + g.spawnDelay;
    s.cn[c] = s.nextCoin;
    s.nextCoin += 1;
  }
  let won = false;
  for (let i = 0; i < p.n; i++) if (p.out[i]! < 0 && s.score[i]! >= g.target) won = true;
  if (won) {
    s.done = true;
    s.endTick = t;
  } else checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

export function dashRanking(s: DashState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? 1 : 0, s.score[i]!, s.score[i]! > 0 ? -s.reach[i]! : 0]);
}
