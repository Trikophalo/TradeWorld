/**
 * Bullen-Rodeo (ADR-160): everybody rides a bull. The bull bucks in a direction drawn from the seed (the same for
 * all); within the window the player has to press that direction, a new press (holding it from before does not
 * count). The first press in the window counts: right scores the ticks left in the window, wrong or none costs a
 * grip at the end of the window, unless every rider missed. The windows shrink. Out without grip; the last one on a
 * bull wins, at the end the most grip, then points. Mirrored by public.battle_sim_rodeo.
 */
import type { RodeoParams } from "../../../config/battles.ts";
import {
  ALIVE_KEY,
  checkEnd,
  dirOf,
  rankByKeys,
  readInputs,
  spawnPlayers,
  type GridBase,
  type SimParams,
} from "./core.ts";
import { battleHash } from "./hash.ts";

export const RODEO_NONE = 0;
export const RODEO_HIT = 1;
export const RODEO_MISS = 2;

export interface RodeoState extends GridBase {
  grip: number[];
  score: number[];
  /** Tick of the last hit (draws). */
  reach: number[];
  /** The direction held the tick before (a press is a change to a direction). */
  prev: number[];
  /** This cue: RODEO_NONE, RODEO_HIT or RODEO_MISS per player, and the tick of the press. */
  resp: number[];
  respTick: number[];
  /** The last finished cue: how it went per player. */
  last: number[];
  lastEnd: number;
  /** Index of the current (or next) cue. */
  cue: number;
  /** The open cue: start, direction 1..4, window in ticks; start -1 while waiting for the next one. */
  cueStart: number;
  cueDir: number;
  cueWin: number;
  nextCue: number;
}

export function rodeoWindow(g: RodeoParams, cue: number): number {
  return Math.max(g.windowMin, g.windowStart - cue * g.windowStep);
}

export function rodeoInit(seed: number, n: number, params: SimParams<RodeoParams>): RodeoState {
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
    grip: fill(params.game.grip),
    score: fill(0),
    reach: fill(0),
    prev: fill(0),
    resp: fill(RODEO_NONE),
    respTick: fill(-1),
    last: fill(RODEO_NONE),
    lastEnd: -1_000,
    cue: 0,
    cueStart: -1,
    cueDir: 0,
    cueWin: 0,
    nextCue: params.game.firstCue,
  };
}

export function rodeoClone(s: RodeoState): RodeoState {
  return {
    ...s,
    p: { ...s.p, out: [...s.p.out], xrun: [...s.p.xrun] },
    grip: [...s.grip],
    score: [...s.score],
    reach: [...s.reach],
    prev: [...s.prev],
    resp: [...s.resp],
    respTick: [...s.respTick],
    last: [...s.last],
  };
}

export function rodeoStep(s: RodeoState, inputs: string, params: SimParams<RodeoParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  if (t === s.nextCue) {
    s.cueStart = t;
    s.cueDir = 1 + (battleHash(s.seed, 1100, s.cue) % 4);
    s.cueWin = rodeoWindow(g, s.cue);
    s.resp.fill(RODEO_NONE);
    s.respTick.fill(-1);
    s.nextCue = -1;
  }
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0) continue;
    const d = dirOf(codes[i]!);
    if (s.cueStart >= 0 && s.resp[i] === RODEO_NONE && d > 0 && d !== s.prev[i]) {
      s.respTick[i] = t;
      if (d === s.cueDir) {
        s.resp[i] = RODEO_HIT;
        s.score[i]! += s.cueWin - (t - s.cueStart);
        s.reach[i] = t;
      } else s.resp[i] = RODEO_MISS;
    }
    s.prev[i] = d;
  }
  if (s.cueStart >= 0 && t === s.cueStart + s.cueWin - 1) {
    const losers: number[] = [];
    let alive = 0;
    for (let i = 0; i < p.n; i++) {
      if (p.out[i]! >= 0) continue;
      alive += 1;
      if (s.resp[i] !== RODEO_HIT) losers.push(i);
    }
    s.last.fill(RODEO_NONE);
    for (let i = 0; i < p.n; i++) if (p.out[i]! < 0) s.last[i] = s.resp[i] === RODEO_HIT ? RODEO_HIT : RODEO_MISS;
    if (losers.length < alive)
      for (const i of losers) {
        s.grip[i]! -= 1;
        if (s.grip[i]! <= 0) p.out[i] = t;
      }
    s.lastEnd = t;
    s.cue += 1;
    s.cueStart = -1;
    s.nextCue = t + 1 + g.gapMin + (battleHash(s.seed, 1101, s.cue) % g.gapJitter);
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

export function rodeoRanking(s: RodeoState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, s.grip[i]!, s.score[i]!]);
}
