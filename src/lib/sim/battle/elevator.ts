/**
 * Fahrstuhl zum Mond (ADR-160): the arena climbs a rising chart. y is the world row as on the screen at the start
 * (smaller is higher, it goes below zero); the screen shows the rows -cam .. h - 1 - cam and climbs one row at a
 * time, ever faster. Every barrierEvery-th row (counted from the bottom, r = h - 1 - y) is a bar of candles with a
 * few gaps drawn from the seed, fewer higher up. Whoever is below the bottom edge of the screen is out; nobody can
 * leave it at the top. The last one standing wins; at the end, who got highest. Mirrored by
 * public.battle_sim_elevator.
 */
import type { ElevatorParams } from "../../../config/battles.ts";
import {
  ALIVE_KEY,
  advance,
  checkEnd,
  clonePlayers,
  rankByKeys,
  readInputs,
  spawnPlayers,
  walk,
  type GridBase,
  type SimParams,
} from "./core.ts";
import { battleHash } from "./hash.ts";

export interface ElevatorState extends GridBase {
  /** Rows the screen has climbed. */
  cam: number;
  rises: number;
  nextRise: number;
  /** The tick of the last rise (for drawing it smoothly). */
  lastRise: number;
  /** The highest row (smallest y) each player reached. */
  best: number[];
  /** Per row r from the bottom: the gaps as a bit mask (0: no barrier); filled up to the top of the screen. */
  masks: number[];
}

/** The gaps of barrier row r as a bit mask over the columns, or 0 when r is no barrier. */
export function elevatorMask(seed: number, g: ElevatorParams, w: number, r: number): number {
  if (r <= 0 || r % g.barrierEvery !== 0) return 0;
  const count = Math.max(g.gapMin, g.gapStart - Math.floor(r / g.gapShrinkEvery));
  const cols = Array.from({ length: w }, (_, x) => x);
  const h = (x: number) => battleHash(seed, 900 + r, x);
  cols.sort((a, b) => h(a) - h(b) || a - b);
  let mask = 0;
  for (const x of cols.slice(0, count)) mask |= 1 << x;
  return mask;
}

function fillMasks(s: ElevatorState, g: ElevatorParams): void {
  while (s.masks.length < s.cam + s.h) s.masks.push(elevatorMask(s.seed, g, s.w, s.masks.length));
}

/** The tile (x, y) is a candle of a barrier. */
export function elevatorSolid(s: ElevatorState, x: number, y: number): boolean {
  const r = s.h - 1 - y;
  const mask = s.masks[r] ?? 0;
  return mask !== 0 && (mask & (1 << x)) === 0;
}

export function elevatorInit(seed: number, n: number, params: SimParams<ElevatorParams>): ElevatorState {
  const s: ElevatorState = {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    cam: 0,
    rises: 0,
    nextRise: params.game.firstRise,
    lastRise: -1_000,
    best: [],
    masks: [],
  };
  s.best = [...s.p.y];
  fillMasks(s, params.game);
  return s;
}

export function elevatorClone(s: ElevatorState): ElevatorState {
  return { ...s, p: clonePlayers(s.p), best: [...s.best], masks: [...s.masks] };
}

export function elevatorStep(s: ElevatorState, inputs: string, params: SimParams<ElevatorParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  advance(p);
  walk(
    p,
    codes,
    (x, y) => x >= 0 && x < s.w && y <= s.h - 1 && y >= -s.cam && !elevatorSolid(s, x, y),
    () => params.stepTicks,
  );
  if (t === s.nextRise) {
    s.cam += 1;
    s.rises += 1;
    s.lastRise = t;
    s.nextRise = t + Math.max(g.riseMin, g.riseStart - Math.floor(s.rises / g.riseStepEvery) * g.riseStep);
    fillMasks(s, g);
  }
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0) continue;
    if (p.y[i]! > s.h - 1 - s.cam) p.out[i] = t;
    else s.best[i] = Math.min(s.best[i]!, p.y[i]!);
  }
  checkEnd(s, g.maxTicks);
  s.tick = t + 1;
}

export function elevatorRanking(s: ElevatorState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? ALIVE_KEY : s.p.out[i]!, -s.best[i]!, s.p.steps[i]!]);
}
