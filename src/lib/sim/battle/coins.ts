/**
 * Geldregen (ADR-160): coins and gold bars fall onto random tiles (a shadow shows where); whoever stands there when
 * one lands, or walks over it later, takes it. Bears fall too: they stun whoever they land on and knock coins out of
 * their pockets. Most coins after the time wins; at a draw, who got there first. Mirrored by public.battle_sim_coins.
 */
import type { CoinsParams } from "../../../config/battles.ts";
import {
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

export const COIN = 0;
export const GOLD = 1;
export const BEAR = 2;

export interface Drop {
  tile: number;
  /** The tick it lands. */
  land: number;
  type: number;
  taken: boolean;
}

export interface CoinsState extends GridBase {
  score: number[];
  /** Tick of the last coin, for draws. */
  reach: number[];
  drops: Drop[];
  first: number;
  dropIndex: number;
  nextDrop: number;
  every: number;
}

export function coinsInit(seed: number, n: number, params: SimParams<CoinsParams>): CoinsState {
  const g = params.game;
  return {
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
    drops: [],
    first: 0,
    dropIndex: 0,
    nextDrop: g.firstDrop,
    every: Math.max(g.dropEveryMin, g.dropEvery - Math.floor(n / 3)),
  };
}

export function coinsClone(s: CoinsState): CoinsState {
  return {
    ...s,
    p: clonePlayers(s.p),
    score: [...s.score],
    reach: [...s.reach],
    drops: s.drops.map((d) => ({ ...d })),
  };
}

export function coinsStep(s: CoinsState, inputs: string, params: SimParams<CoinsParams>): void {
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
  if (t === s.nextDrop) {
    const r = battleHash(s.seed, 300, s.dropIndex);
    const roll = Math.floor(r / 65_536) % 100;
    const gold = t >= g.durationTicks - g.jackpotTicks ? g.jackpotGoldPct : g.goldPct;
    const type = roll < g.bearPct ? BEAR : roll < g.bearPct + gold ? GOLD : COIN;
    s.drops.push({ tile: r % (s.w * s.h), land: t + g.fallTicks, type, taken: false });
    s.dropIndex += 1;
    s.nextDrop = t + s.every;
  }
  while (s.first < s.drops.length && s.drops[s.first]!.land + g.lifeTicks <= t) s.first += 1;
  for (let k = s.first; k < s.drops.length; k++) {
    const d = s.drops[k]!;
    if (d.taken || t < d.land || t >= d.land + g.lifeTicks) continue;
    const x = d.tile % s.w;
    const y = Math.floor(d.tile / s.w);
    if (d.type === BEAR) {
      d.taken = true;
      for (let i = 0; i < p.n; i++) {
        if (p.out[i]! >= 0 || p.x[i] !== x || p.y[i] !== y) continue;
        p.stun[i] = g.bearStunTicks;
        s.score[i]! -= Math.min(s.score[i]!, g.bearLoss);
      }
      continue;
    }
    for (let i = 0; i < p.n; i++) {
      if (p.out[i]! >= 0 || p.x[i] !== x || p.y[i] !== y) continue;
      s.score[i]! += d.type === GOLD ? g.goldValue : 1;
      s.reach[i] = t;
      d.taken = true;
      break;
    }
  }
  checkEnd(s, g.durationTicks);
  s.tick = t + 1;
}

export function coinsRanking(s: CoinsState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? 1 : 0, s.score[i]!, s.score[i]! > 0 ? -s.reach[i]! : 0]);
}
