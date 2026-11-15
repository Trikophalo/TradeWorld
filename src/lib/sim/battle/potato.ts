/**
 * Giftaktie (ADR-160): hot potato with a toxic stock. One player holds it (and runs a little faster); walking into
 * someone passes it on (not straight back within `passBackTicks`). When the fuse burns down it goes off and the
 * holder is out; after a pause a random remaining player gets a new one. The last one left wins. Mirrored by
 * public.battle_sim_potato.
 */
import type { PotatoParams } from "../../../config/battles.ts";
import {
  ALIVE_KEY,
  advance,
  aliveCount,
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

export interface PotatoState extends GridBase {
  wall: boolean[];
  holder: number;
  round: number;
  nextRound: number;
  bang: number;
  /** When the current fuse was lit (for drawing how far it burnt). */
  lit: number;
  lastHolder: number;
  passTick: number;
  held: number[];
}

export function potatoInit(seed: number, n: number, params: SimParams<PotatoParams>): PotatoState {
  const wall = Array<boolean>(params.w * params.h).fill(false);
  for (const [x, y] of params.game.walls) wall[y * params.w + x] = true;
  return {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    wall,
    holder: -1,
    round: 0,
    nextRound: params.game.firstRound,
    bang: 0,
    lit: 0,
    lastHolder: -1,
    passTick: -1_000_000,
    held: Array<number>(n).fill(0),
  };
}

export function potatoClone(s: PotatoState): PotatoState {
  return { ...s, p: clonePlayers(s.p), held: [...s.held] };
}

export function potatoStep(s: PotatoState, inputs: string, params: SimParams<PotatoParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  const holder = s.holder;
  let passTo = -1;
  walk(
    p,
    codes,
    (x, y) => inBounds(s.w, s.h, x, y) && !s.wall[y * s.w + x],
    (i) => (i === holder ? g.holderStepTicks : params.stepTicks),
    (i, j) => {
      if (i === holder && p.out[holder]! < 0 && (j !== s.lastHolder || t - s.passTick >= g.passBackTicks)) passTo = j;
    },
  );
  if (passTo >= 0) {
    s.lastHolder = holder;
    s.holder = passTo;
    s.passTick = t;
    p.stun[passTo] = g.receiverStunTicks;
  }
  if (s.holder < 0 && t >= s.nextRound && aliveCount(p) >= 2) {
    const alive: number[] = [];
    for (let i = 0; i < p.n; i++) if (p.out[i]! < 0) alive.push(i);
    s.holder = alive[battleHash(s.seed, 401, s.round) % alive.length]!;
    const seconds =
      Math.max(g.fuseMinSeconds, g.fuseBaseSeconds - s.n) + (battleHash(s.seed, 402, s.round) % g.fuseJitterSeconds);
    s.lit = t;
    s.bang = t + seconds * params.tps;
    s.lastHolder = -1;
    s.passTick = -1_000_000;
  }
  if (s.holder >= 0) {
    const h = s.holder;
    s.held[h]! += 1;
    if (p.out[h]! >= 0 || t >= s.bang) {
      if (p.out[h]! < 0) p.out[h] = t;
      s.holder = -1;
      s.round += 1;
      s.nextRound = t + g.pauseTicks;
    }
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

export function potatoRanking(s: PotatoState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, -s.held[i]!, s.p.steps[i]!]);
}
