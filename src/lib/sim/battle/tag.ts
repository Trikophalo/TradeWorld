/**
 * Bulle und Bär (ADR-177): tag. One player is the bear and steps a little faster; walking into a bull makes that
 * bull the bear, frozen for freezeTicks so the old bear gets away. Whoever was the bear for the fewest ticks wins.
 * When the bear leaves, the alive player with the fewest bear ticks (then the lot) takes over. Mirrored by
 * public.battle_sim_tag.
 */
import type { TagParams } from "../../../config/battles.ts";
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

export interface TagState extends GridBase {
  /** The slot of the bear (-1: nobody left). */
  bear: number;
  /** Ticks each player was the bear. */
  held: number[];
  tags: number[];
}

/** The alive player with the fewest bear ticks, then the lot of the tick. */
function nextBear(s: TagState, t: number): number {
  let best = -1;
  for (let i = 0; i < s.n; i++) {
    if (s.p.out[i]! >= 0) continue;
    if (
      best < 0 ||
      s.held[i]! < s.held[best]! ||
      (s.held[i] === s.held[best] && battleHash(s.seed, 8000 + t, i) < battleHash(s.seed, 8000 + t, best))
    )
      best = i;
  }
  return best;
}

export function tagInit(seed: number, n: number, params: SimParams<TagParams>): TagState {
  return {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    bear: n > 0 ? battleHash(seed, 801, 0) % n : -1,
    held: Array<number>(n).fill(0),
    tags: Array<number>(n).fill(0),
  };
}

export function tagClone(s: TagState): TagState {
  return { ...s, p: clonePlayers(s.p), held: [...s.held], tags: [...s.tags] };
}

export function tagStep(s: TagState, inputs: string, params: SimParams<TagParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  if (s.bear < 0 || p.out[s.bear]! >= 0) s.bear = nextBear(s, t);
  let tagged = -1;
  walk(
    p,
    codes,
    (x, y) => inBounds(s.w, s.h, x, y),
    (i) => (i === s.bear ? g.bearStepTicks : params.stepTicks),
    (i, j) => {
      if (i === s.bear && tagged < 0) tagged = j;
    },
  );
  if (tagged >= 0) {
    s.tags[s.bear]! += 1;
    s.bear = tagged;
    p.stun[tagged] = g.freezeTicks;
  }
  if (s.bear >= 0) s.held[s.bear]! += 1;
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

/** Still in first, then the fewest bear ticks, then the most tags. */
export function tagRanking(s: TagState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? 1 : 0, -s.held[i]!, s.tags[i]!]);
}
